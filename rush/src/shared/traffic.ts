// Lagos rush hour as a pure function of time. Every vehicle's position comes from the room seed and the race
// clock, so every client draws the same traffic without a single network message. Vehicles ride lanes inside
// the track's traffic sections (real one way and two way roads from OSM), slow for bends, and turn in and out
// of side streets at the ends of a section.
import type { Track, TrafficSection } from './track';
import { Rng } from './rng';
import { clamp, smoothstep } from './math';

export type TrafficKind = 'danfo' | 'sedan' | 'keke' | 'okada' | 'brt' | 'molue' | 'tanker' | 'trailer';
export interface TrafficKindDef { len: number; w: number; h: number; heavy: boolean }
export const TRAFFIC_KINDS: Record<TrafficKind, TrafficKindDef> = {
  danfo: { len: 4.9, w: 2.0, h: 2.2, heavy: false },
  sedan: { len: 4.5, w: 1.8, h: 1.45, heavy: false },
  keke: { len: 2.9, w: 1.4, h: 1.8, heavy: false },
  okada: { len: 2.0, w: 0.8, h: 1.5, heavy: false },
  brt: { len: 12, w: 2.6, h: 3.2, heavy: true },
  molue: { len: 10, w: 2.5, h: 3.0, heavy: true },
  tanker: { len: 11, w: 2.5, h: 3.3, heavy: true },
  trailer: { len: 14, w: 2.6, h: 3.8, heavy: true },
};

interface Lane { section: number; dir: 1 | -1; frac: number; speed: number; f0: number; f1: number }
export interface TrafficCar { id: number; kind: TrafficKind; lane: number; phase: number; colour: number }
export interface TrafficPose { id: number; kind: TrafficKind; x: number; y: number; z: number; h: number; s: number; d: number; v: number; dir: 1 | -1; vis: number; colour: number }

const KERB_MIX: TrafficKind[] = ['keke', 'keke', 'okada', 'okada', 'danfo', 'molue', 'trailer', 'tanker', 'sedan'];
const FAST_MIX: TrafficKind[] = ['danfo', 'danfo', 'danfo', 'sedan', 'sedan', 'sedan', 'brt', 'okada', 'keke'];
const SPACING = [0, 240, 150, 96]; // F units between vehicles in a lane, by density

export class Traffic {
  cars: TrafficCar[] = [];
  lanes: Lane[] = [];
  private fCum: Float64Array;   // cumulative "slow distance" per main sample
  private fac: Float64Array;    // speed factor per sample
  private sAt: Float64Array;

  constructor(public track: Track, density: number, seed: number) {
    const c = track.paths[0];
    this.sAt = c.s.slice(0, c.n + 1);
    this.fac = new Float64Array(c.n);
    this.fCum = new Float64Array(c.n + 1);
    for (let i = 0; i < c.n; i++) this.fac[i] = clamp(Math.sqrt(3.2 / Math.max(Math.abs(track.curvature[i]), 1e-4)) / 14, 0.5, 1);
    for (let i = 0; i < c.n; i++) this.fCum[i + 1] = this.fCum[i] + (c.s[i + 1] - c.s[i]) / this.fac[i];
    if (density <= 0) return;
    const rng = new Rng(seed ^ 0x7a11c);
    const spacing = SPACING[clamp(Math.round(density), 0, 3)];
    track.data.traffic.forEach((sec: TrafficSection, si) => {
      const hw = Math.min(track.hwAt(sec.s0), track.hwAt((sec.s0 + sec.s1) / 2), track.hwAt(sec.s1));
      const f0 = this.F(sec.s0), f1 = this.F(sec.s1);
      const lanesPerDir = hw > 8.2 ? 2 : 1;
      const addLane = (dir: 1 | -1, frac: number, kerb: boolean) => {
        const li = this.lanes.length;
        this.lanes.push({ section: si, dir, frac, speed: kerb ? rng.range(8.5, 10.5) : rng.range(11.5, 14.5), f0, f1 });
        const span = f1 - f0;
        const count = Math.max(1, Math.floor(span / spacing));
        const step = span / count;
        for (let k = 0; k < count; k++) {
          const mix = kerb ? KERB_MIX : FAST_MIX;
          this.cars.push({ id: this.cars.length, kind: rng.pick(mix), lane: li, phase: k * step + rng.range(0, step * 0.4), colour: rng.int(0, 1 << 24) });
        }
      };
      if (sec.flow === 0) {
        for (let k = 0; k < lanesPerDir; k++) {
          // kerb-hugging lanes leave the crown of the road open, the way Lagos traffic squeezes through the middle
          const frac = lanesPerDir === 1 ? 0.64 : 0.3 + k * 0.42;
          addLane(1, frac, k === lanesPerDir - 1);
          addLane(-1, -frac, k === lanesPerDir - 1);
        }
      } else {
        const n = Math.max(1, Math.floor((hw * 2 - 1) / 3.3));
        for (let k = 0; k < n; k++) {
          const frac = -1 + (2 * (k + 0.5)) / n;
          // kerb lane is on the right of the flow direction; the fast lane stays free so there is always a way through
          const kerb = sec.flow === 1 ? k === n - 1 : k === 0;
          const fast = sec.flow === 1 ? k === 0 : k === n - 1;
          if (fast && n >= 2) continue;
          addLane(sec.flow as 1 | -1, frac, kerb);
        }
      }
    });
  }

  /** Slow-distance at s: travel time at unit speed, so vehicles bunch up in bends. */
  private F(s: number) {
    const i = this.track.indexAt(s);
    const t = (s - this.sAt[i]) / ((this.sAt[i + 1] - this.sAt[i]) || 1);
    return this.fCum[i] + (this.fCum[i + 1] - this.fCum[i]) * clamp(t, 0, 1);
  }
  private Finv(f: number) {
    let lo = 0, hi = this.fCum.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.fCum[mid] <= f) lo = mid; else hi = mid - 1; }
    const t = (f - this.fCum[lo]) / ((this.fCum[lo + 1] - this.fCum[lo]) || 1);
    return { s: this.sAt[lo] + (this.sAt[lo + 1] - this.sAt[lo]) * clamp(t, 0, 1), i: lo };
  }

  pose(car: TrafficCar, time: number, out?: TrafficPose): TrafficPose {
    const lane = this.lanes[car.lane];
    const sec = this.track.data.traffic[lane.section];
    const span = lane.f1 - lane.f0;
    const u = ((((car.phase + lane.speed * Math.max(0, time + 20)) % span) + span) % span);
    const fpos = lane.dir > 0 ? lane.f0 + u : lane.f1 - u;
    const { s, i } = this.Finv(fpos);
    const hw = this.track.hwAt(s);
    let d = lane.frac * Math.max(0.6, hw - 1.7);
    const k = this.track.curvature[i];
    // stay on the road round the inside of tight bends
    if (Math.abs(k) > 1e-3 && Math.sign(d) === Math.sign(k)) d = Math.sign(d) * Math.min(Math.abs(d), 0.8 / Math.abs(k));
    const p = this.track.pointAt(s, d, 0, false);
    const entry = lane.dir > 0 ? s - sec.s0 : sec.s1 - s;
    const exit = lane.dir > 0 ? sec.s1 - s : s - sec.s0;
    const o = out ?? ({} as TrafficPose);
    o.id = car.id; o.kind = car.kind; o.x = p.x; o.y = p.y; o.z = p.z; o.s = s; o.d = d; o.dir = lane.dir; o.colour = car.colour;
    o.h = lane.dir > 0 ? p.h : p.h + Math.PI;
    o.v = lane.speed * this.fac[i];
    o.vis = smoothstep(0, 14, entry) * smoothstep(0, 14, exit);
    return o;
  }

  poses(time: number, out: TrafficPose[] = []) {
    for (let i = 0; i < this.cars.length; i++) out[i] = this.pose(this.cars[i], time, out[i]);
    out.length = this.cars.length;
    return out;
  }
}
