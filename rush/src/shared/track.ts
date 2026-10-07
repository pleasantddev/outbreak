// Runtime track: a closed main loop plus optional shortcut branches, each a sampled centreline with width,
// elevation and bank. Every car, AI, pickup and server check asks this class where things are.
import { clamp, distSegment2 } from './math';

export interface TrackPath {
  pts: number[];          // flattened x, y, z per sample (every ~2 m)
  hw: number[];           // half width per sample
  bank: number[];         // bank angle per sample (radians, positive leans toward the right edge)
  closed: boolean;
  join?: [number, number]; // for branches: main-loop s where the branch leaves and rejoins
}
export interface Ramp { s0: number; s1: number; h: number; d0?: number; d1?: number } // d0..d1 limits a side ramp across the road
export interface PickupRow { s: number; d: number[] }
export interface BoostPad { s: number; d: number; len: number; w: number } // a BRT lane strip: s is its start, d its centre offset
export interface GridSlot { x: number; y: number; z: number; h: number }
export interface TrackData {
  id: string; name: string; tagline: string; district: string; laps: number; length: number;
  paths: TrackPath[];
  checkpoints: number[];
  pickups: PickupRow[];
  ramps: Ramp[];
  boosts: BoostPad[];
  grid: GridSlot[];
  intro: number[][];       // camera fly-through control points [x, y, z]
  landmarks: { name: string; x: number; z: number }[];
  surface: 'asphalt';
  par: number;             // gold medal lap time in seconds
  reverse?: boolean;
  base?: string;           // id of the forward layout for reverse variants
}

export interface TrackHint { path: number; i: number }
export interface TrackQuery {
  path: number; i: number; t: number;
  s: number;              // distance along this path
  sMain: number;          // progress mapped onto the main loop
  d: number;              // lateral offset, positive toward the right edge
  hw: number;
  groundY: number;
  tx: number; tz: number; // unit tangent
  rx: number; rz: number; // unit right vector
  outside: number;        // metres beyond the corridor edge (<= 0 means on track)
  slope: number;          // dy/ds of the surface
}

interface PathCache { n: number; x: Float64Array; y: Float64Array; z: Float64Array; s: Float64Array; tx: Float64Array; tz: Float64Array; hw: Float64Array; bank: Float64Array; len: number; closed: boolean; join?: [number, number] }

export class Track {
  data: TrackData;
  paths: PathCache[] = [];
  length: number;
  private grid = new Map<number, number[]>(); // cell -> packed (path << 20 | segment)
  private cell = 24;
  curvature: Float64Array;  // main path, per sample, signed (positive = turning right)

  constructor(data: TrackData) {
    this.data = data;
    for (const p of data.paths) this.paths.push(this.cachePath(p));
    this.length = this.paths[0].len;
    this.curvature = this.computeCurvature(this.paths[0]);
    this.buildIndex();
  }

  private cachePath(p: TrackPath): PathCache {
    const n = p.pts.length / 3;
    const c: PathCache = {
      n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), s: new Float64Array(n + 1), tx: new Float64Array(n), tz: new Float64Array(n),
      hw: new Float64Array(p.hw), bank: new Float64Array(p.bank), len: 0, closed: p.closed, join: p.join,
    };
    for (let i = 0; i < n; i++) { c.x[i] = p.pts[i * 3]; c.y[i] = p.pts[i * 3 + 1]; c.z[i] = p.pts[i * 3 + 2]; }
    const segs = p.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      const dx = c.x[j] - c.x[i], dz = c.z[j] - c.z[i], l = Math.hypot(dx, dz) || 1e-6;
      c.s[i + 1] = c.s[i] + l;
      c.tx[i] = dx / l; c.tz[i] = dz / l;
    }
    if (!p.closed) { c.tx[n - 1] = c.tx[n - 2]; c.tz[n - 1] = c.tz[n - 2]; }
    c.len = c.s[segs];
    return c;
  }

  private computeCurvature(c: PathCache) {
    const k = new Float64Array(c.n);
    const W = 6; // samples each side (about 12 m)
    for (let i = 0; i < c.n; i++) {
      const a = (i - W + c.n) % c.n, b = (i + W) % c.n;
      const ha = Math.atan2(c.tx[a], c.tz[a]), hb = Math.atan2(c.tx[b], c.tz[b]);
      let dh = hb - ha; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
      const ds = Math.max(1, (c.s[b] - c.s[a] + c.len) % c.len);
      // heading increases when turning left in this convention, so negate for "positive = right"
      k[i] = -dh / ds;
    }
    // light smoothing
    const out = new Float64Array(c.n);
    for (let i = 0; i < c.n; i++) { let acc = 0; for (let j = -3; j <= 3; j++) acc += k[(i + j + c.n) % c.n]; out[i] = acc / 7; }
    return out;
  }

  private key(x: number, z: number) { return (Math.floor(x / this.cell) + 4096) * 8192 + (Math.floor(z / this.cell) + 4096); }
  private buildIndex() {
    this.paths.forEach((c, pi) => {
      const segs = c.closed ? c.n : c.n - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % c.n;
        const pad = c.hw[i] + 12;
        const x0 = Math.min(c.x[i], c.x[j]) - pad, x1 = Math.max(c.x[i], c.x[j]) + pad;
        const z0 = Math.min(c.z[i], c.z[j]) - pad, z1 = Math.max(c.z[i], c.z[j]) + pad;
        for (let gx = Math.floor(x0 / this.cell); gx <= Math.floor(x1 / this.cell); gx++) for (let gz = Math.floor(z0 / this.cell); gz <= Math.floor(z1 / this.cell); gz++) {
          const k = (gx + 4096) * 8192 + (gz + 4096);
          let arr = this.grid.get(k); if (!arr) { arr = []; this.grid.set(k, arr); }
          arr.push((pi << 20) | i);
        }
      }
    });
  }

  private evalSeg(pi: number, i: number, x: number, z: number) {
    const c = this.paths[pi];
    const j = (i + 1) % c.n;
    const r = distSegment2(x, z, c.x[i], c.z[i], c.x[j], c.z[j]);
    return r;
  }

  /** Locate a point. The hint keeps queries cheap and stops a car on a bridge snapping to the road below. */
  query(x: number, y: number, z: number, hint?: TrackHint): TrackQuery {
    let best: { pi: number; i: number; t: number; d2: number; score: number } | null = null;
    const consider = (pi: number, i: number) => {
      const c = this.paths[pi];
      const segs = c.closed ? c.n : c.n - 1;
      if (i < 0 || i >= segs) return;
      const r = this.evalSeg(pi, i, x, z);
      const j = (i + 1) % c.n;
      const gy = c.y[i] + (c.y[j] - c.y[i]) * r.t;
      const dy = Math.abs(gy - y);
      // stacked corridors: strongly prefer the one at our height
      const score = r.d2 + (dy > 2.5 ? (dy - 2.5) * (dy - 2.5) * 400 : 0);
      if (!best || score < best.score) best = { pi, i, t: r.t, d2: r.d2, score };
    };
    if (hint) {
      const c = this.paths[hint.path];
      if (c) for (let k = -24; k <= 24; k++) { let i = hint.i + k; if (c.closed) i = (i + c.n) % c.n; consider(hint.path, i); }
    }
    const b0 = best as { d2: number; score: number } | null;
    if (!b0 || b0.d2 > 36 || b0.score > 400) {
      const arr = this.grid.get(this.key(x, z));
      if (arr) for (const packed of arr) consider(packed >> 20, packed & 0xfffff);
      // also always look at branches near us so shortcuts register as "on track"
      for (let pi = 1; pi < this.paths.length; pi++) { /* covered by grid */ }
      if (!best) {
        // far from everything: brute force on the main path
        for (let i = 0; i < this.paths[0].n; i += 2) consider(0, i);
      }
    } else {
      // near the hint: still check shortcut branches through the grid when we are close to an edge
      const arr = this.grid.get(this.key(x, z));
      if (arr) for (const packed of arr) if ((packed >> 20) !== (best as any).pi) consider(packed >> 20, packed & 0xfffff);
    }
    const b = best!;
    return this.describe(b.pi, b.i, b.t, x, z);
  }

  private describe(pi: number, i: number, t: number, x: number, z: number): TrackQuery {
    const c = this.paths[pi];
    const j = (i + 1) % c.n;
    const px = c.x[i] + (c.x[j] - c.x[i]) * t, pz = c.z[i] + (c.z[j] - c.z[i]) * t;
    const tx = c.tx[i], tz = c.tz[i];
    const rx = -tz, rz = tx; // right of tangent with y up: (-tz, 0, tx)
    const d = (x - px) * rx + (z - pz) * rz;
    const hw = c.hw[i] + (c.hw[j] - c.hw[i]) * t;
    const bank = c.bank[i] + (c.bank[j] - c.bank[i]) * t;
    const s = c.s[i] + (c.s[i + 1] - c.s[i]) * t;
    const baseY = c.y[i] + (c.y[j] - c.y[i]) * t;
    const segLen = (c.s[i + 1] - c.s[i]) || 1;
    let slope = (c.y[j] - c.y[i]) / segLen;
    let groundY = baseY + Math.tan(bank) * clamp(d, -hw, hw);
    let sMain = s;
    if (pi === 0) {
      const r = this.rampHeight(s, d);
      groundY += r.h; slope += r.slope;
    } else if (c.join) {
      const [a, b] = c.join;
      const span = ((b - a) + this.length) % this.length;
      sMain = (a + span * (s / (c.len || 1))) % this.length;
    }
    return { path: pi, i, t, s, sMain, d, hw, groundY, tx, tz, rx, rz, outside: Math.abs(d) - hw, slope };
  }

  /** Ramp kickers add height on the main path. Side ramps only cover part of the width and fade out over their edge. */
  rampHeight(s: number, d = 0) {
    for (const r of this.data.ramps) {
      if (s >= r.s0 && s <= r.s1) {
        let side = 1;
        if (r.d0 !== undefined && r.d1 !== undefined) {
          const inside = Math.min(d - r.d0, r.d1 - d);
          if (inside <= -0.6) continue;
          side = clamp((inside + 0.6) / 0.6, 0, 1);
        }
        const k = (s - r.s0) / (r.s1 - r.s0);
        // quadratic kicker: flat run-in, steep lip
        return { h: r.h * k * k * side, slope: ((2 * r.h * k) / (r.s1 - r.s0)) * side, lip: side > 0.5 ? r.s1 : -1 };
      }
    }
    return { h: 0, slope: 0, lip: -1 };
  }

  /** World position at a main-loop distance and lateral offset. */
  pointAt(s: number, d = 0, pi = 0) {
    const c = this.paths[pi];
    const L = c.len;
    let ss = c.closed ? ((s % L) + L) % L : clamp(s, 0, L);
    // binary search segment
    let lo = 0, hi = (c.closed ? c.n : c.n - 1) - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c.s[mid] <= ss) lo = mid; else hi = mid - 1; }
    const i = lo, j = (i + 1) % c.n;
    const t = (ss - c.s[i]) / ((c.s[i + 1] - c.s[i]) || 1);
    const tx = c.tx[i], tz = c.tz[i], rx = -tz, rz = tx;
    const x = c.x[i] + (c.x[j] - c.x[i]) * t + rx * d;
    const z = c.z[i] + (c.z[j] - c.z[i]) * t + rz * d;
    const bank = c.bank[i] + (c.bank[j] - c.bank[i]) * t;
    let y = c.y[i] + (c.y[j] - c.y[i]) * t + Math.tan(bank) * d;
    if (pi === 0) y += this.rampHeight(ss, d).h;
    const hw = c.hw[i] + (c.hw[j] - c.hw[i]) * t;
    return { x, y, z, h: Math.atan2(tx, tz), hw, i, tx, tz, rx, rz };
  }

  curvatureAt(s: number) {
    const c = this.paths[0];
    const ss = ((s % c.len) + c.len) % c.len;
    let lo = 0, hi = c.n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c.s[mid] <= ss) lo = mid; else hi = mid - 1; }
    return this.curvature[lo];
  }

  /** Signed main-loop gap from a to b in metres, wrapped to (-L/2, L/2]. */
  gap(a: number, b: number) { let g = b - a; const L = this.length; while (g > L / 2) g -= L; while (g <= -L / 2) g += L; return g; }

  bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of this.paths) for (let i = 0; i < c.n; i++) { minX = Math.min(minX, c.x[i]); maxX = Math.max(maxX, c.x[i]); minZ = Math.min(minZ, c.z[i]); maxZ = Math.max(maxZ, c.z[i]); }
    return { minX, maxX, minZ, maxZ };
  }
}
