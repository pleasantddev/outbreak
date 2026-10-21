// Quality ladder, device detection and the runtime governor.
//
// Every rung of LEVELS is a complete graphics + population configuration. Level 0 is the best looking, higher numbers are
// cheaper. The governor starts at a rung picked from the GPU string, memory, cores and touch, then moves while the game runs:
//   1. dynamic resolution (render scale 1.0 .. level.minScale) reacts to slow frames first,
//   2. when the scale bottoms out it steps to the next cheaper rung (AO, shadows, clouds, bloom, view distance, crowds),
//   3. after a long run of comfortable frames it probes upward again, never above the best rung the device is allowed.
// The player can pin a preset (Low / Medium / High) in the phone Settings app instead. The choice is persisted.

export type Pref = 'auto' | 'low' | 'medium' | 'high';
export type Tier = 'low' | 'medium' | 'high';

export interface Level {
  name: string;
  /** device pixel ratio cap before render scale is applied */
  dprCap: number; minScale: number;
  /** 0 off, 1 N8AO performance half res, 2 N8AO low half res, 3 N8AO medium full res */
  ao: 0 | 1 | 2 | 3;
  smaa: boolean; bloom: boolean;
  /** shadow map: size 0 means no shadows; half is the half extent of the box around the player; every = update every N frames */
  shadowSize: number; shadowHalf: number; shadowEvery: number;
  cloudScale: number; cloudSteps: number; cloudEvery: number;
  pmremSize: number; pmremEvery: number;
  radius: number;
  peds: number; traffic: number; parked: number; crowd: number;
  /** most skinned characters drawn at once, and how far (m) an actor is still drawn */
  skinned: number; actorDist: number; lodBias: number;
  rain: number;
}

export const LEVELS: Level[] = [
  { name: 'Ultra',  dprCap: 2,    minScale: 0.75, ao: 3, smaa: true,  bloom: true,  shadowSize: 4096, shadowHalf: 90, shadowEvery: 1, cloudScale: 0.4,  cloudSteps: 28, cloudEvery: 1, pmremSize: 128, pmremEvery: 8,  radius: 900, peds: 34, traffic: 16, parked: 12, crowd: 16, skinned: 30, actorDist: 150, lodBias: 1.25, rain: 1 },
  { name: 'High',   dprCap: 1.5,  minScale: 0.7,  ao: 2, smaa: true,  bloom: true,  shadowSize: 2048, shadowHalf: 80, shadowEvery: 1, cloudScale: 0.33, cloudSteps: 22, cloudEvery: 2, pmremSize: 128, pmremEvery: 12, radius: 800, peds: 30, traffic: 14, parked: 10, crowd: 14, skinned: 24, actorDist: 140, lodBias: 1.0,  rain: 1 },
  { name: 'Medium', dprCap: 1.25, minScale: 0.7,  ao: 1, smaa: true,  bloom: true,  shadowSize: 2048, shadowHalf: 70, shadowEvery: 2, cloudScale: 0.3,  cloudSteps: 18, cloudEvery: 3, pmremSize: 64,  pmremEvery: 20, radius: 700, peds: 24, traffic: 12, parked: 8,  crowd: 10, skinned: 18, actorDist: 130, lodBias: 0.9,  rain: 0.7 },
  { name: 'Medium-', dprCap: 1.25, minScale: 0.65, ao: 1, smaa: false, bloom: true,  shadowSize: 1024, shadowHalf: 55, shadowEvery: 2, cloudScale: 0.27, cloudSteps: 14, cloudEvery: 4, pmremSize: 64,  pmremEvery: 25, radius: 620, peds: 20, traffic: 10, parked: 7,  crowd: 8,  skinned: 14, actorDist: 120, lodBias: 0.8,  rain: 0.6 },
  { name: 'Low+',   dprCap: 1,    minScale: 0.6,  ao: 0, smaa: false, bloom: true,  shadowSize: 1024, shadowHalf: 45, shadowEvery: 3, cloudScale: 0.25, cloudSteps: 12, cloudEvery: 5, pmremSize: 64,  pmremEvery: 30, radius: 520, peds: 16, traffic: 8,  parked: 6,  crowd: 6,  skinned: 10, actorDist: 110, lodBias: 0.7,  rain: 0.5 },
  { name: 'Low',    dprCap: 1,    minScale: 0.55, ao: 0, smaa: false, bloom: false, shadowSize: 0,    shadowHalf: 40, shadowEvery: 1, cloudScale: 0.2,  cloudSteps: 10, cloudEvery: 6, pmremSize: 64,  pmremEvery: 40, radius: 440, peds: 12, traffic: 6,  parked: 5,  crowd: 4,  skinned: 8,  actorDist: 100, lodBias: 0.6,  rain: 0.35 },
  { name: 'Minimum', dprCap: 1,   minScale: 0.5,  ao: 0, smaa: false, bloom: false, shadowSize: 0,    shadowHalf: 40, shadowEvery: 1, cloudScale: 0.15, cloudSteps: 8,  cloudEvery: 12, pmremSize: 64, pmremEvery: 60, radius: 360, peds: 8,  traffic: 4,  parked: 3,  crowd: 0,  skinned: 5,  actorDist: 80,  lodBias: 0.5,  rain: 0.2 },
];

/** Manual presets map onto rungs of the ladder. */
export const PRESET_LEVEL: Record<Tier, number> = { high: 0, medium: 2, low: 5 };
export const NO_SHADOW_FROM = 5;

export interface Detect { level: number; gpu: string; reason: string; software: boolean; mobile: boolean }

/** Reads the GPU string from a throwaway context. Never throws. */
export function readGpu(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : String(gl.getParameter(gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return s;
  } catch { return ''; }
}

/** Picks the starting rung. Heuristics only; the governor corrects whatever this gets wrong. */
export function detectDevice(gpuIn?: string): Detect {
  const gpu = (gpuIn ?? readGpu()).toLowerCase();
  const nav = navigator as any;
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const mem: number = nav.deviceMemory ?? 8; const cores: number = nav.hardwareConcurrency ?? 4;
  const ua = navigator.userAgent.toLowerCase();
  const mobile = touch && /android|iphone|ipad|mobile/.test(ua + ' ' + (nav.platform ?? '').toLowerCase()) || (touch && Math.min(screen.width, screen.height) < 820);
  let level = 3, reason = 'unknown gpu';
  const has = (re: RegExp) => re.test(gpu);
  const software = has(/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/);
  if (software) { level = 6; reason = 'software renderer'; }
  else if (has(/apple/) && !has(/apple gpu/) || has(/apple m\d/)) { level = mobile ? 3 : 1; reason = 'Apple silicon'; }
  else if (has(/apple gpu|apple a\d/)) { level = 3; reason = 'Apple mobile gpu'; }
  else if (has(/rtx\s?(20|30|40|50)\d\d|rx\s?(6|7|9)\d00|radeon pro w|arc\s?a[57]\d0|titan|rtx a\d/)) { level = 0; reason = 'discrete gpu'; }
  else if (has(/gtx\s?(16|10[5-8])\d|gtx\s?9[5-8]0|rx\s?(5[0-9]0|vega)|radeon rx|quadro|geforce/)) { level = has(/mx\s?\d|940|930|920/) ? 3 : 1; reason = has(/mx\s?\d/) ? 'entry laptop gpu' : 'mid discrete gpu'; }
  else if (has(/intel.*arc/)) { level = 2; reason = 'Intel Arc'; }
  else if (has(/iris xe|iris\(r\) xe|iris plus|iris pro|radeon.*graphics|radeon\(tm\) graphics|vega \d+/)) { level = 3; reason = 'integrated gpu (modern)'; }
  else if (has(/intel|uhd|hd graphics|gma/)) { level = 4; reason = 'integrated intel gpu'; }
  else if (has(/adreno.*\(?tm\)?\s?[78]\d\d|mali-g[78]\d|immortalis|xclipse/)) { level = 3; reason = 'recent phone gpu'; }
  else if (has(/adreno|mali|powervr|videocore|tegra/)) { level = 5; reason = 'older phone gpu'; }
  if (mobile && level < 3) level = 3;
  if (mem <= 2) level += 2; else if (mem <= 4 && level < 6) level += 1;
  if (cores <= 2 && level < 6) level += 1;
  level = Math.max(0, Math.min(6, level));
  return { level, gpu: gpu || 'unknown', reason: `${reason}, ${mem}GB, ${cores} cores${mobile ? ', phone' : ''}`, software, mobile };
}

export const PREF_KEY = 'hl.quality';
export function loadPref(): Pref {
  try { const v = localStorage.getItem(PREF_KEY); if (v === 'low' || v === 'medium' || v === 'high' || v === 'auto') return v; } catch { /* private mode */ }
  return 'auto';
}
export function savePref(p: Pref) { try { localStorage.setItem(PREF_KEY, p); } catch { /* private mode */ } }

export interface GovernorHooks { level(l: number, why: string): void; scale(s: number): void }

/**
 * Watches frame time and moves render scale and level. Call tick() once per rendered frame with the rAF delta.
 * Only the median of a short window is used, so a single tile build or GC pause never changes quality.
 */
export class Governor {
  pref: Pref; level: number; scale = 1; bootLevel: number; bestLevel: number;
  /** measured median frame time (ms) of the last window */
  ft = 16.7; fps = 60;
  log: { t: number; msg: string }[] = [];
  private win: number[] = []; private winT: number[] = [];
  private evalAt = 0; private cool = 0; private slow = 0; private good = 0; private probeAt = 0; private probeBack = 12; private probed: { t: number; scale: number } | null = null; private lastLevelUp = -1e9;
  private lockUpUntil = 0; private t0 = 0;
  /** milliseconds that count as too slow (about 51 fps) and as clearly fast (above 64 fps) */
  static SLOW = 19.6; static FAST = 15.6;
  constructor(pref: Pref, start: number, private hooks: GovernorHooks, allowShadowUp = true) {
    this.pref = pref;
    this.bootLevel = start; this.level = start;
    // never climb above two rungs better than the guess, and never into a rung that needs shaders compiled differently
    this.bestLevel = pref === 'auto' ? Math.max(start >= NO_SHADOW_FROM && !allowShadowUp ? NO_SHADOW_FROM : 0, start - 2) : start;
  }
  setPref(p: Pref, level: number) { this.pref = p; this.level = level; this.bootLevel = level; this.bestLevel = p === 'auto' ? Math.max(0, level - 2) : level; this.scale = 1; this.win.length = 0; this.winT.length = 0; this.cool = 1.5; this.slow = this.good = 0; this.probed = null; }
  private note(msg: string, now: number) { this.log.push({ t: +(now / 1000).toFixed(1), msg }); if (this.log.length > 40) this.log.shift(); }
  reset() { this.win.length = 0; this.winT.length = 0; this.slow = this.good = 0; }

  tick(dtMs: number, nowMs: number) {
    if (!this.t0) this.t0 = nowMs;
    if (dtMs > 0 && dtMs < 400) { this.win.push(dtMs); this.winT.push(nowMs); }
    while (this.winT.length && nowMs - this.winT[0] > 2200) { this.win.shift(); this.winT.shift(); }
    if (nowMs < this.evalAt) return; this.evalAt = nowMs + 500;
    if (this.win.length < 8) return;
    const s = this.win.slice().sort((a, b) => a - b); const med = s[s.length >> 1]; const p90 = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
    this.ft = med; this.fps = 1000 / med;
    if (this.pref !== 'auto') return;
    if (nowMs - this.t0 < 4000) return;              // loading, shader compiles and the first tile builds
    if (nowMs < this.cool) return;
    const slow = med > Governor.SLOW || p90 > Governor.SLOW * 1.7;
    const fast = med < Governor.FAST && p90 < Governor.SLOW;
    if (slow) { this.slow++; this.good = 0; } else { this.slow = 0; this.good += fast ? 1 : 0.5; }
    const L = LEVELS[this.level];
    // a probe that made things worse is undone at once and the next one is pushed further away
    if (this.probed && nowMs - this.probed.t < 7000 && slow) {
      this.setScale(this.probed.scale, nowMs, 'probe failed'); this.probed = null; this.probeBack = Math.min(180, this.probeBack * 2); this.probeAt = nowMs + this.probeBack * 1000; this.cool = nowMs + 1500; this.slow = 0; return;
    }
    if (this.probed && nowMs - this.probed.t >= 7000) this.probed = null;
    if (this.slow >= 2) {
      this.slow = 0; this.cool = nowMs + 2200;
      if (this.scale > L.minScale + 0.011) {
        const want = Math.max(0.7, Math.min(0.95, Governor.SLOW / Math.max(med, 1)));
        this.setScale(Math.max(L.minScale, Math.round(this.scale * Math.sqrt(want) * 20) / 20), nowMs, `slow ${med.toFixed(1)}ms`);
      } else if (this.level < LEVELS.length - 1) {
        this.level++; this.hooks.level(this.level, `slow ${med.toFixed(1)}ms at scale ${this.scale.toFixed(2)}`); this.note(`level ${this.level} ${LEVELS[this.level].name} (slow ${med.toFixed(1)}ms)`, nowMs);
        this.scale = 0.9; this.hooks.scale(this.scale);
        this.lockUpUntil = nowMs + 45000; this.probeAt = nowMs + 25000; this.probeBack = 20; this.win.length = 0; this.winT.length = 0;
      }
      return;
    }
    // headroom: go back up slowly
    if (this.good >= 16 && nowMs >= this.probeAt && nowMs >= this.lockUpUntil) {
      if (this.scale < 0.999) {
        const prev = this.scale; this.setScale(Math.min(1, Math.round((this.scale + 0.05) * 20) / 20), nowMs, 'headroom'); this.probed = { t: nowMs, scale: prev };
        this.good = 8; this.probeAt = nowMs + 4000; this.cool = nowMs + 1500;
      } else if (this.level > this.bestLevel && nowMs - this.lastLevelUp > 30000) {
        this.level--; this.lastLevelUp = nowMs; this.hooks.level(this.level, 'headroom'); this.note(`level ${this.level} ${LEVELS[this.level].name} (headroom)`, nowMs);
        this.scale = 0.85; this.hooks.scale(this.scale); this.probed = { t: nowMs, scale: 1 }; this.good = 0; this.cool = nowMs + 2500; this.probeAt = nowMs + this.probeBack * 1000; this.win.length = 0; this.winT.length = 0;
      }
    }
  }
  private setScale(s: number, now: number, why: string) { if (Math.abs(s - this.scale) < 0.001) return; this.scale = s; this.hooks.scale(s); this.note(`scale ${s.toFixed(2)} (${why})`, now); this.win.length = 0; this.winT.length = 0; }
}
