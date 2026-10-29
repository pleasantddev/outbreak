// Quality ladder, device detection and the runtime governor.
//
// Resolution is never touched: the canvas always renders at the device pixel ratio (see pixelRatioFor), capped at 2 on
// desktop and 1.5 on phones, and never below 1. Everything that makes a frame cheaper is something else:
// shadow casters and cadence, ambient occlusion, anti-aliasing kind, bloom, the cloud model, shader variants,
// street light count, prop and tile detail ranges, view distance and crowd sizes.
//
// Every rung of LEVELS is a complete graphics + population configuration. Level 0 is the best looking, higher numbers are
// cheaper. The governor starts at a rung picked from the GPU string, memory, cores and touch, then moves while the game runs:
//   slow frames  -> next cheaper rung,
//   a long run of comfortable frames -> probes one rung up, never above the best rung the device is allowed.
// The player can pin a preset (Low / Medium / High) in the phone Settings app instead. The choice is persisted.

export type Pref = 'auto' | 'low' | 'medium' | 'high';
export type Tier = 'low' | 'medium' | 'high';

export interface Level {
  name: string;
  /** 0 off, 1 N8AO performance half res, 2 N8AO low half res, 3 N8AO medium full res */
  ao: 0 | 1 | 2 | 3;
  /** 0 none, 1 FXAA (one extra tap pattern, merged into the final pass), 2 SMAA */
  aa: 0 | 1 | 2;
  bloom: boolean;
  /** shadow map: size 0 means no shadows; half is the half extent of the box around the player; every = most frames between map redraws */
  shadowSize: number; shadowHalf: number; shadowEvery: number;
  /** 0 cheap analytic cloud layer in the sky dome, 1 ray marched volume (cloudScale of the screen, cloudSteps samples, redrawn every cloudEvery frames) */
  cloudMarch: 0 | 1; cloudScale: number; cloudSteps: number; cloudEvery: number;
  pmremSize: number; pmremEvery: number;
  /** tile streaming radius (m) */
  radius: number;
  /** tiles further than this (m) switch to the cheap far shaders and drop windows-level detail */
  farTiles: number;
  /** poles, lamps, trees and rooftop clutter are not drawn beyond this (m) */
  propRange: number;
  /** ground and facade shader variant: 0 full PBR, 1 fewer texture taps and no detail normal, 2 flat colour with one albedo tap */
  lite: 0 | 1 | 2;
  /** texture anisotropy */
  aniso: number;
  /** street light point lights used at night (each one is paid per pixel by every lit material) */
  streetLights: number;
  peds: number; traffic: number; parked: number; crowd: number;
  /** most skinned characters drawn at once, and how far (m) an actor is still drawn */
  skinned: number; actorDist: number; lodBias: number;
  /** cars further than this (m) are drawn as one merged mesh without doors, wheels or interior */
  carFar: number;
  rain: number;
}

export const LEVELS: Level[] = [
  { name: 'Ultra',   ao: 3, aa: 2, bloom: true,  shadowSize: 4096, shadowHalf: 90, shadowEvery: 1, cloudMarch: 1, cloudScale: 0.4,  cloudSteps: 28, cloudEvery: 1, pmremSize: 128, pmremEvery: 8,  radius: 900, farTiles: 420, propRange: 560, lite: 0, aniso: 8, streetLights: 6, peds: 34, traffic: 16, parked: 12, crowd: 16, skinned: 30, actorDist: 150, lodBias: 1.25, carFar: 80, rain: 1 },
  { name: 'High',    ao: 2, aa: 2, bloom: true,  shadowSize: 2048, shadowHalf: 80, shadowEvery: 1, cloudMarch: 1, cloudScale: 0.33, cloudSteps: 22, cloudEvery: 2, pmremSize: 128, pmremEvery: 12, radius: 800, farTiles: 380, propRange: 480, lite: 0, aniso: 8, streetLights: 6, peds: 30, traffic: 14, parked: 10, crowd: 14, skinned: 24, actorDist: 140, lodBias: 1.0,  carFar: 70, rain: 1 },
  { name: 'Medium',  ao: 1, aa: 2, bloom: true,  shadowSize: 2048, shadowHalf: 70, shadowEvery: 2, cloudMarch: 1, cloudScale: 0.3,  cloudSteps: 18, cloudEvery: 3, pmremSize: 64,  pmremEvery: 20, radius: 700, farTiles: 330, propRange: 380, lite: 0, aniso: 4, streetLights: 4, peds: 24, traffic: 12, parked: 8,  crowd: 10, skinned: 18, actorDist: 130, lodBias: 0.9,  carFar: 60, rain: 0.7 },
  { name: 'Medium-', ao: 1, aa: 1, bloom: true,  shadowSize: 1024, shadowHalf: 55, shadowEvery: 2, cloudMarch: 1, cloudScale: 0.27, cloudSteps: 14, cloudEvery: 4, pmremSize: 64,  pmremEvery: 25, radius: 620, farTiles: 280, propRange: 300, lite: 1, aniso: 4, streetLights: 3, peds: 20, traffic: 10, parked: 7,  crowd: 8,  skinned: 14, actorDist: 120, lodBias: 0.8,  carFar: 50,  rain: 0.6 },
  { name: 'Low+',    ao: 0, aa: 1, bloom: true,  shadowSize: 1024, shadowHalf: 45, shadowEvery: 3, cloudMarch: 0, cloudScale: 0.25, cloudSteps: 12, cloudEvery: 5, pmremSize: 64,  pmremEvery: 30, radius: 520, farTiles: 230, propRange: 240, lite: 1, aniso: 2, streetLights: 2, peds: 16, traffic: 8,  parked: 6,  crowd: 6,  skinned: 10, actorDist: 110, lodBias: 0.7,  carFar: 45,  rain: 0.5 },
  { name: 'Low',     ao: 0, aa: 1, bloom: false, shadowSize: 0,    shadowHalf: 40, shadowEvery: 1, cloudMarch: 0, cloudScale: 0.2,  cloudSteps: 10, cloudEvery: 6, pmremSize: 64,  pmremEvery: 40, radius: 440, farTiles: 180, propRange: 190, lite: 2, aniso: 2, streetLights: 1, peds: 12, traffic: 6,  parked: 5,  crowd: 4,  skinned: 8,  actorDist: 100, lodBias: 0.6,  carFar: 40,  rain: 0.35 },
  { name: 'Minimum', ao: 0, aa: 1, bloom: false, shadowSize: 0,    shadowHalf: 40, shadowEvery: 1, cloudMarch: 0, cloudScale: 0.15, cloudSteps: 8,  cloudEvery: 12, pmremSize: 64, pmremEvery: 60, radius: 360, farTiles: 140, propRange: 150, lite: 2, aniso: 1, streetLights: 0, peds: 8,  traffic: 4,  parked: 3,  crowd: 0,  skinned: 5,  actorDist: 80,  lodBias: 0.5,  carFar: 35,  rain: 0.2 },
];

/** Manual presets map onto rungs of the ladder. */
export const PRESET_LEVEL: Record<Tier, number> = { high: 0, medium: 2, low: 5 };
export const NO_SHADOW_FROM = 5;

/**
 * The one place the render resolution is decided. Native device pixels, capped so a 3x phone panel does not shade nine
 * pixels per CSS pixel, and never below 1. It does not depend on the rung and the governor never changes it.
 */
export const DPR_CAP_DESKTOP = 2;
export const DPR_CAP_PHONE = 1.5;
export function pixelRatioFor(mobile: boolean, dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) {
  return Math.max(1, Math.min(dpr, mobile ? DPR_CAP_PHONE : DPR_CAP_DESKTOP));
}

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

/** What a manual choice (or Auto) changes, in plain words, for the Settings app. */
export const TIER_NOTES: Record<Pref, string> = {
  auto: 'Picks a starting level for your device, then drops the heavy extras if frames get slow and brings them back when there is room. The picture stays at full sharpness.',
  high: 'Soft sun shadows from buildings, trees, cars and people, ambient occlusion, SMAA, bloom, ray marched clouds, 800 m of city, six street lights, the biggest crowds.',
  medium: 'Shadows at 70 m, light ambient occlusion, SMAA, bloom, lighter clouds, 700 m of city, four street lights, medium crowds.',
  low: 'No shadow map, no ambient occlusion, FXAA, painted sky clouds, one street light, simpler ground and walls, 440 m of city, small crowds. Built to hold 60 fps on a weak phone.',
};

export interface GovernorHooks { level(l: number, why: string): void }

/**
 * Watches frame time and moves the rung. Call tick() once per rendered frame with the rAF delta.
 * Only the median of a short window is used, so a single tile build or GC pause never changes quality.
 * It never touches resolution.
 */
export class Governor {
  pref: Pref; level: number; bootLevel: number; bestLevel: number;
  /** measured median frame time (ms) of the last window */
  ft = 16.7; fps = 60;
  log: { t: number; msg: string }[] = [];
  private win: number[] = []; private winT: number[] = [];
  private evalAt = 0; private cool = 0; private slow = 0; private good = 0; private probeAt = 0; private probeBack = 20; private probed: { t: number; level: number } | null = null; private lastLevelUp = -1e9;
  private lockUpUntil = 0; private t0 = 0;
  /** milliseconds that count as too slow (about 51 fps) and as clearly fast (above 64 fps) */
  static SLOW = 19.6; static FAST = 15.6;
  constructor(pref: Pref, start: number, private hooks: GovernorHooks, allowShadowUp = true) {
    this.pref = pref;
    this.bootLevel = start; this.level = start;
    // never climb above two rungs better than the guess, and never into a rung that needs shaders compiled differently
    this.bestLevel = pref === 'auto' ? Math.max(start >= NO_SHADOW_FROM && !allowShadowUp ? NO_SHADOW_FROM : 0, start - 2) : start;
  }
  setPref(p: Pref, level: number) { this.pref = p; this.level = level; this.bootLevel = level; this.bestLevel = p === 'auto' ? Math.max(0, level - 2) : level; this.win.length = 0; this.winT.length = 0; this.cool = 1.5; this.slow = this.good = 0; this.probed = null; }
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
    // a probe one rung up that made things worse is undone at once and the next one is pushed further away
    if (this.probed && nowMs - this.probed.t < 7000 && slow) {
      const back = this.probed.level; this.probed = null; this.level = back; this.hooks.level(back, 'probe failed'); this.note(`level ${back} ${LEVELS[back].name} (probe failed)`, nowMs);
      this.probeBack = Math.min(180, this.probeBack * 2); this.probeAt = nowMs + this.probeBack * 1000; this.cool = nowMs + 2500; this.slow = 0; this.win.length = 0; this.winT.length = 0; return;
    }
    if (this.probed && nowMs - this.probed.t >= 7000) this.probed = null;
    if (this.slow >= 2) {
      this.slow = 0; this.cool = nowMs + 3000;
      if (this.level < LEVELS.length - 1) {
        this.level++; this.hooks.level(this.level, `slow ${med.toFixed(1)}ms`); this.note(`level ${this.level} ${LEVELS[this.level].name} (slow ${med.toFixed(1)}ms)`, nowMs);
        this.lockUpUntil = nowMs + 45000; this.probeAt = nowMs + 25000; this.probeBack = 20; this.win.length = 0; this.winT.length = 0;
      }
      return;
    }
    // headroom: go back up slowly, one rung at a time
    if (this.good >= 16 && nowMs >= this.probeAt && nowMs >= this.lockUpUntil && this.level > this.bestLevel && nowMs - this.lastLevelUp > 30000) {
      const prev = this.level; this.level--; this.lastLevelUp = nowMs; this.hooks.level(this.level, 'headroom'); this.note(`level ${this.level} ${LEVELS[this.level].name} (headroom)`, nowMs);
      this.probed = { t: nowMs, level: prev }; this.good = 0; this.cool = nowMs + 2500; this.probeAt = nowMs + this.probeBack * 1000; this.win.length = 0; this.winT.length = 0;
    }
  }
}
