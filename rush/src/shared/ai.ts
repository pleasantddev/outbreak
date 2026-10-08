// AI racers. Each track gets one racing line (a minimum curvature path inside the corridor); each car model gets a
// speed profile along it from the same steering limits the physics uses. Drivers then add personality: a lane
// preference, how hard they brake, whether they drift for boost, how they use items, and the odd mistake.
import type { Track } from './track';
import type { CarDef } from './cars';
import type { CarInput, CarState } from './car';
import { driftMin } from './car';
import type { Hazard, ItemId } from './items';
import type { TrafficPose, TrafficKind } from './traffic';
import { TRAFFIC_KINDS } from './traffic';
import { clamp, wrapAngle } from './math';
import { Rng } from './rng';

const TRAFFIC_HALF_W = Object.fromEntries(Object.entries(TRAFFIC_KINDS).map(([k, v]) => [k, v.w / 2])) as Record<TrafficKind, number>;

export interface RacingLine { n: number; d: Float32Array; k: Float32Array; s: Float64Array; L: number }

/** Minimum curvature line inside the corridor, by constrained biharmonic smoothing of the lateral offset. */
export function computeRacingLine(track: Track): RacingLine {
  const c = track.paths[0];
  const n = c.n;
  const d = new Float64Array(n);
  const lim = new Float64Array(n);
  for (let i = 0; i < n; i++) lim[i] = Math.max(0, c.hw[i] - 1.7);
  const px = new Float64Array(n), pz = new Float64Array(n);
  const nx = new Float64Array(n), nz = new Float64Array(n);
  for (let i = 0; i < n; i++) { nx[i] = -c.tz[i]; nz[i] = c.tx[i]; }
  const at = (i: number) => (i + n) % n;
  for (let iter = 0; iter < 900; iter++) {
    for (let i = 0; i < n; i++) { px[i] = c.x[i] + nx[i] * d[i]; pz[i] = c.z[i] + nz[i] * d[i]; }
    const w = iter < 600 ? 0.5 : 0.3;
    for (let i = 0; i < n; i++) {
      const a = at(i - 2), b = at(i - 1), e = at(i + 1), f = at(i + 2);
      // biharmonic target pulls the point toward a smoothly curving line through its neighbours
      const tx = (-px[a] + 4 * px[b] + 4 * px[e] - px[f]) / 6;
      const tz = (-pz[a] + 4 * pz[b] + 4 * pz[e] - pz[f]) / 6;
      const t = (tx - c.x[i]) * nx[i] + (tz - c.z[i]) * nz[i];
      d[i] = clamp(d[i] + (t - d[i]) * w, -lim[i], lim[i]);
    }
  }
  for (let i = 0; i < n; i++) { px[i] = c.x[i] + nx[i] * d[i]; pz[i] = c.z[i] + nz[i] * d[i]; }
  // curvature of the line itself, over +-3 samples
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = at(i - 3), b = at(i + 3);
    const h1 = Math.atan2(px[i] - px[a], pz[i] - pz[a]), h2 = Math.atan2(px[b] - px[i], pz[b] - pz[i]);
    const ds = Math.hypot(px[i] - px[a], pz[i] - pz[a]) + Math.hypot(px[b] - px[i], pz[b] - pz[i]);
    k[i] = -wrapAngle(h2 - h1) / Math.max(1, ds * 0.5);
  }
  const ks = new Float32Array(n);
  for (let i = 0; i < n; i++) { let acc = 0; for (let j = -2; j <= 2; j++) acc += k[at(i + j)]; ks[i] = acc / 5; }
  return { n, d: Float32Array.from(d), k: ks, s: c.s, L: c.len };
}

/** Fastest safe speed per sample for one car model on the racing line. */
export function speedProfile(track: Track, line: RacingLine, def: CarDef, drift: boolean): Float32Array {
  const n = line.n;
  const v = new Float32Array(n);
  const steer = def.steer * (drift ? 1.12 : 1);
  for (let i = 0; i < n; i++) {
    const kk = Math.abs(line.k[i]);
    // yaw the car can make at speed v: steer * (1 - 0.3 v / top); needs v * k
    const vc = (steer * 0.9) / (kk + (0.3 * steer) / def.topSpeed);
    v[i] = Math.min(def.topSpeed * 0.985, vc);
  }
  const ds = (i: number) => line.s[i + 1] - line.s[i];
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 1; k <= n; k++) {
      const i = k % n, h = (k - 1) % n;
      const a = def.accel * Math.max(0.08, 1 - Math.pow(v[h] / def.topSpeed, 1.7)) - 0.00055 * v[h] * v[h];
      v[i] = Math.min(v[i], Math.sqrt(v[h] * v[h] + 2 * Math.max(0.5, a) * ds(h)));
    }
    for (let k = n - 1; k >= 0; k--) { const j = (k + 1) % n; v[k] = Math.min(v[k], Math.sqrt(v[j] * v[j] + 2 * 21 * ds(k))); }
  }
  return v;
}

export type AiLevel = 'easy' | 'normal' | 'hard' | 'lagos';
export const AI_LEVELS: Record<AiLevel, { pace: number; drift: number; items: number; mistakes: number; label: string }> = {
  easy: { pace: 0.84, drift: 0, items: 0.45, mistakes: 0.05, label: 'Learner' },
  normal: { pace: 0.92, drift: 0.35, items: 0.7, mistakes: 0.025, label: 'Driver' },
  hard: { pace: 0.975, drift: 0.8, items: 0.9, mistakes: 0.01, label: 'Racer' },
  lagos: { pace: 1.0, drift: 1, items: 1, mistakes: 0.004, label: 'Lagos Legend' },
};

export interface AiPersona { name: string; crew: string; pace: number; aggression: number; lane: number; drifter: boolean }

export interface AiContext {
  time: number; dt: number; cars: CarState[]; self: number; place: number; count: number;
  hazards: Hazard[]; traffic: TrafficPose[];
  /** metres to the nearest human: positive when this AI is ahead */
  humanGap: number; catchUp: boolean; racing: boolean;
}

const lineCache = new WeakMap<Track, RacingLine>();
const profileCache = new WeakMap<Track, Map<string, Float32Array>>();
export function lineFor(track: Track) { let l = lineCache.get(track); if (!l) { l = computeRacingLine(track); lineCache.set(track, l); } return l; }
export function profileFor(track: Track, def: CarDef, drift: boolean) {
  let m = profileCache.get(track); if (!m) { m = new Map(); profileCache.set(track, m); }
  const key = def.id + (drift ? ':d' : '');
  let p = m.get(key); if (!p) { p = speedProfile(track, lineFor(track), def, drift); m.set(key, p); }
  return p;
}

export class AiDriver {
  line: RacingLine; prof: Float32Array;
  private rng: Rng;
  private stuckT = 0; private reverseT = 0; private mistakeT = 0; private mistakeK = 1;
  private sideBias = 0; private holdItemT = 0; private wantDrift = false; private driftHold = 0; private driftSlack = 0;
  private dPlan = 0;
  private obstacles: { gap: number; d: number; half: number; len: number; closing: number; v: number }[] = [];

  constructor(public track: Track, public def: CarDef, public persona: AiPersona, public level: AiLevel, seed: number) {
    this.line = lineFor(track);
    const L = AI_LEVELS[level];
    this.prof = profileFor(track, def, persona.drifter && L.drift > 0.5);
    this.rng = new Rng(seed);
    this.sideBias = persona.lane;
  }

  drive(c: CarState, ctx: AiContext, item: ItemId | null, out: CarInput): { useItem: boolean } {
    out.throttle = 0; out.brake = 0; out.steer = 0; out.drift = false; out.nitro = false; out.item = false; out.look = false; out.airPitch = 0;
    const tr = this.track, line = this.line, lvl = AI_LEVELS[this.level];
    const q = c.q;
    if (!q || c.respawnT > 0) return { useItem: false };
    const s = q.sMain;
    const v = Math.max(0, c.vf);
    const ix = tr.indexAt(s);

    // pace: level, persona, blackout, gentle catch up relative to the humans
    let pace = lvl.pace * this.persona.pace;
    if (c.blackoutT > 0) pace *= 0.86;
    if (ctx.catchUp) pace *= ctx.humanGap > 120 ? 0.955 : ctx.humanGap < -120 ? 1.035 : 1;
    if (this.mistakeT > 0) { this.mistakeT -= ctx.dt; pace *= this.mistakeK; }
    else if (this.rng.chance(lvl.mistakes * ctx.dt)) { this.mistakeT = this.rng.range(0.6, 1.6); this.mistakeK = this.rng.range(0.82, 1.06); }

    // lateral plan: score a fan of lanes across the road against the racing line and everything ahead of us
    const look = clamp(v * 0.42 + 7, 8, 34);
    const ia = tr.indexAt(s + look);
    const hwA = Math.min(tr.hwAt(s + look), tr.hwAt(s + look * 0.5));
    const lineD = line.d[ia] * 0.85 + this.sideBias * Math.min(1.6, hwA * 0.22);
    const lim = Math.max(0.4, hwA - 1.3);
    let bestD = lineD, bestScore = Infinity, blocked = false, bestBlockV = Infinity;
    const obstacles = this.obstacles;
    obstacles.length = 0;
    for (let j = 0; j < ctx.cars.length; j++) {
      if (j === ctx.self) continue;
      const o = ctx.cars[j];
      if (!o.q || o.respawnT > 0 || o.ghostT > 0) continue;
      const gap = tr.gap(s, o.q.sMain);
      const closing = v - o.vf;
      if (gap < -2 || gap > 30 || (closing < 1 && gap > 6)) continue;
      obstacles.push({ gap, d: o.q.d, half: 1.1, len: 2.3, closing: Math.max(1, closing), v: o.vf });
      if (gap > 0 && gap < 12 && Math.abs(o.q.d - q.d) < 2.2) blocked = true;
    }
    for (const hz of ctx.hazards) {
      if (hz.kind === 'rocket' || hz.kind === 'okada') continue;
      const gap = tr.gap(s, hz.s);
      if (gap < 0 || gap > 40) continue;
      obstacles.push({ gap, d: hz.d, half: 1.3, len: 1.2, closing: Math.max(1, v), v: 0 });
    }
    for (const t of ctx.traffic) {
      if (t.vis < 0.3) continue;
      const gap = tr.gap(s, t.s);
      const closing = t.dir > 0 ? v - t.v : v + t.v;
      const half = TRAFFIC_KINDS[t.kind].len / 2;
      if (gap < -half - 3 || closing <= 0.5 || gap > Math.min(80, 10 + half + closing * 1.6)) continue;
      obstacles.push({ gap, d: t.d, half: TRAFFIC_HALF_W[t.kind] + 0.15, len: half + 2.3, closing, v: t.dir > 0 ? t.v : -t.v });
    }
    for (let k = -6; k <= 6; k++) {
      const dc = (k / 6) * lim;
      let score = Math.abs(dc - lineD) * 0.35 + Math.abs(dc - this.dPlan) * 0.25 + Math.abs(dc - q.d) * 0.1;
      let blockV = Infinity;
      for (const ob of obstacles) {
        const tt = Math.max(0, ob.gap - ob.len) / ob.closing; // seconds until our nose reaches its tail
        if (tt > 2.8) continue;
        // where we will be laterally by then, moving from our current offset toward this lane
        const reach = clamp(tt / 0.8, 0, 1);
        const latAt = q.d + (dc - q.d) * reach;
        const clear = Math.abs(latAt - ob.d) - (ob.half + 1.05);
        if (clear < 0.7) score += (0.7 - clear) * 10 * (1 - tt / 2.8) + (clear < 0 ? 8 : 0);
        // only something properly ahead sets our pace: two cars side by side tucking in behind each other would
        // brake each other down into a crawling train
        if (clear < 0.1 && tt < 1.4 && ob.v > -1 && ob.gap > 1.5) blockV = Math.min(blockV, ob.v);
      }
      if (score < bestScore) { bestScore = score; bestD = dc; bestBlockV = blockV; }
    }
    this.dPlan += (bestD - this.dPlan) * Math.min(1, ctx.dt * 4);
    const target = clamp(this.dPlan, -lim, lim);

    // steering: pure pursuit toward the target point; while sliding, track the direction of travel instead
    let p = tr.pointAt(s + look, target);
    let ex = p.x - c.x, ez = p.z - c.z;
    const course = c.drifting && Math.hypot(c.vx, c.vz) > 4 ? Math.atan2(c.vx, c.vz) : c.h;
    let err = wrapAngle(Math.atan2(ex, ez) - course);
    if (c.wrongWayT > 0.8) { // facing backwards: aim along the track ahead so we turn round
      p = tr.pointAt(s + 14, 0); ex = p.x - c.x; ez = p.z - c.z; err = wrapAngle(Math.atan2(ex, ez) - c.h);
    }
    const dist = Math.max(4, Math.hypot(ex, ez));
    // positive yaw turns right in this convention, and a target to the right gives a negative error
    const yawWanted = (-2 * Math.sin(err) * Math.max(v, 6)) / dist;
    if (c.drifting) {
      const base = c.driftDir * this.def.steer * 0.95;
      const x = clamp((yawWanted / base - 0.78) / 0.5, -1, 1);
      out.steer = x * c.driftDir;
      this.driftSlack = yawWanted / base < 0.3 ? this.driftSlack + ctx.dt : 0;
    } else {
      const sf = clamp(Math.abs(c.vf) / 8, 0.25, 1) * (1 - 0.3 * clamp(Math.abs(c.vf) / this.def.topSpeed, 0, 1));
      out.steer = clamp(yawWanted / (this.def.steer * sf) - c.yawRate * 0.04, -1, 1);
    }

    // speed: profile ahead, scaled by pace
    // fastest speed from which every corner in the next 90 m can still be made under braking
    let vt = this.prof[ix] * pace;
    for (let a = 4; a < 90; a += 4) {
      const va = this.prof[tr.indexAt(s + a)] * pace;
      vt = Math.min(vt, Math.sqrt(va * va + 2 * 22 * a));
    }
    if (blocked && this.persona.aggression < 0.5) vt = Math.min(vt, v + 1);
    // nowhere to go: tuck in behind whatever fills the road
    if (bestBlockV < Infinity) vt = Math.min(vt, Math.max(4, bestBlockV - 1));
    if (!ctx.racing) vt = 0;
    if (v < vt - 0.5) out.throttle = 1;
    else if (v > vt + 1.5) { out.brake = clamp((v - vt) / 7, 0.2, 1); }
    else out.throttle = 0.35;

    // drifting for boost through long tight bends: only into the bend, never across it
    const kSigned = line.k[tr.indexAt(s + 8)] + line.k[tr.indexAt(s + 20)] + line.k[tr.indexAt(s + 32)];
    const kAhead = Math.abs(kSigned);
    if (!c.drifting && !this.wantDrift && this.persona.drifter && lvl.drift > 0 && kAhead > 0.075 && v > driftMin(this.def) + Math.min(5, this.def.topSpeed * 0.2)
      && Math.sign(out.steer) === Math.sign(kSigned) && Math.abs(out.steer) > 0.3 && this.rng.next() < lvl.drift * 0.25) { this.wantDrift = true; this.driftHold = 0; this.driftSlack = 0; }
    if (this.wantDrift) {
      this.driftHold += ctx.dt;
      const exitNow = kAhead < 0.03 || this.driftSlack > 0.25 || (c.driftTier >= 2 && kAhead < 0.05) || this.driftHold > 3.4 || (c.drifting && Math.abs(c.q!.d) > c.q!.hw - 1.2);
      if (exitNow && this.driftHold > 0.25) this.wantDrift = false;
      out.drift = this.wantDrift;
    }

    // nitro on straights
    const straight = Math.abs(line.k[tr.indexAt(s + 30)]) < 0.006 && Math.abs(line.k[tr.indexAt(s + 60)]) < 0.006;
    if (c.fuel > 0.3 && straight && v > this.def.topSpeed * 0.55 && (this.persona.aggression > 0.4 || c.fuel > 0.7)) out.nitro = true;

    // stuck: back out
    if (ctx.racing && v < 1.5 && c.grounded && c.spinT <= 0) this.stuckT += ctx.dt; else this.stuckT = Math.max(0, this.stuckT - ctx.dt);
    if (this.stuckT > 1.6) { this.reverseT = 1.1; this.stuckT = 0; }
    if (this.reverseT > 0) { this.reverseT -= ctx.dt; out.throttle = 0; out.brake = 1; out.steer = -out.steer; }

    // in the air: keep it clean
    if (!c.grounded) { out.steer = 0; out.airPitch = 0; }

    return { useItem: this.decideItem(c, ctx, item, straight) };
  }

  private decideItem(c: CarState, ctx: AiContext, item: ItemId | null, straight: boolean) {
    if (!item || !ctx.racing) { this.holdItemT = 0; return false; }
    this.holdItemT += ctx.dt;
    const lvl = AI_LEVELS[this.level];
    if (this.rng.next() > lvl.items * 0.08 + (this.holdItemT > 9 ? 0.2 : 0)) return false;
    const tr = this.track, s = c.q!.sMain;
    let behind = Infinity, ahead = Infinity, near = 0;
    for (let j = 0; j < ctx.cars.length; j++) {
      if (j === ctx.self || !ctx.cars[j].q) continue;
      const g = tr.gap(s, ctx.cars[j].q!.sMain);
      if (g < 0) behind = Math.min(behind, -g); else ahead = Math.min(ahead, g);
      if (Math.abs(g) < 9 && Math.abs(ctx.cars[j].q!.d - c.q!.d) < 6) near++;
    }
    switch (item) {
      case 'purewater': case 'pothole': return behind < 28 || this.holdItemT > 6;
      case 'horn': return near > 0;
      case 'rocket': return ahead < 70 || (ctx.place === 1 ? false : this.holdItemT > 5);
      case 'genboost': return straight;
      case 'blackout': case 'danfo': case 'okada': return this.holdItemT > 0.8;
    }
  }
}

const FIRST = ['Tunde', 'Ngozi', 'Chidi', 'Aisha', 'Femi', 'Kemi', 'Emeka', 'Bola', 'Segun', 'Funmi', 'Ike', 'Zainab', 'Dayo', 'Ada', 'Musa', 'Tola', 'Uche', 'Yemi', 'Obinna', 'Halima', 'Kunle', 'Nneka', 'Sola', 'Bisi'];
const NICK = ['Agbero', 'Speed', 'Okada', 'Bridge', 'Gbedu', 'Wahala', 'Jollof', 'Express', 'Third Mainland', 'Danfo', 'Area', 'Molue', 'Suya', 'Owambe', 'Shayo', 'Burger'];
const CREWS = ['Oshodi Kings', 'Ikeja Night Runners', 'Mushin Motorworks', 'Isolo Drift Club', 'Ilupeju Iron', 'Agege Express', 'Surulere Sliders', 'Yaba Tech'];

export function makePersonas(count: number, seed: number): AiPersona[] {
  const rng = new Rng(seed ^ 0x51a7e);
  const used = new Set<string>();
  const out: AiPersona[] = [];
  for (let i = 0; i < count; i++) {
    let name = '';
    for (let tries = 0; tries < 20; tries++) {
      name = rng.chance(0.55) ? `${rng.pick(FIRST)} ${rng.pick(NICK)}` : rng.pick(FIRST);
      if (!used.has(name)) break;
    }
    used.add(name);
    out.push({ name, crew: rng.pick(CREWS), pace: rng.range(0.975, 1.012), aggression: rng.next(), lane: rng.range(-0.8, 0.8), drifter: rng.chance(0.7) });
  }
  return out;
}
