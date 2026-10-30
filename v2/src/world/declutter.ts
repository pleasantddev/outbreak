// Declutter rules for the streamed city. One road corridor model (carriageway, kerb, walkway, drain) that buildings, compound walls,
// trees and shore walls all have to respect, so pavements and roads stay clear for walking and driving.
//
//   building clearance : the walkway line (see roadnet.ts) plus 0.9 m, so nothing stands on a sidewalk
//   wall clearance     : the whole verge (carriageway + kerb + walkway + drain) plus 0.2 m
//   tree clearance     : the whole verge plus 1.2 m
import { RF, ROAD, BK, type Road, type Building, type Water } from './region';
import { halfWidth, verge } from './roadspec';
import { polyArea, pointInPoly } from './geo';

const CELL = 24, GROW = 22;
const key = (i: number, j: number) => i * 65536 + j;

export class RoadClear {
  segs: number[] = []; hw: number[] = []; vg: number[] = []; walk: number[] = []; cls: number[] = [];
  private grid = new Map<number, number[]>();
  constructor(roads: Road[]) {
    for (const r of roads) {
      if (r.flags & (RF.bridge | RF.tunnel)) continue;
      if (r.pts.length < 4) continue;
      const hw = halfWidth(r), vg = verge(r);
      // where the sidewalk walkers use sits (roadnet.ts): hw + min(0.45 vg, 2.2) + 0.3, footpaths run on the line itself
      const wk = r.cls === ROAD.foot || r.cls === ROAD.steps ? 0 : hw + Math.min(vg * 0.45, 2.2) + 0.3;
      for (let k = 0; k < r.pts.length / 2 - 1; k++) {
        const ax = r.pts[k * 2], az = r.pts[k * 2 + 1], bx = r.pts[k * 2 + 2], bz = r.pts[k * 2 + 3];
        const si = this.hw.length; this.segs.push(ax, az, bx, bz); this.hw.push(hw); this.vg.push(vg); this.walk.push(wk); this.cls.push(r.cls);
        const i0 = Math.floor((Math.min(ax, bx) - GROW) / CELL), i1 = Math.floor((Math.max(ax, bx) + GROW) / CELL), j0 = Math.floor((Math.min(az, bz) - GROW) / CELL), j1 = Math.floor((Math.max(az, bz) + GROW) / CELL);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const kk = key(i, j); let l = this.grid.get(kk); if (!l) this.grid.set(kk, l = []); l.push(si); }
      }
    }
  }
  /** Distance to the nearest road centreline (99 when none is within about 20 m). */
  dist(x: number, z: number) {
    const l = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!l) return 99;
    let best = 99;
    for (let q = 0; q < l.length; q++) { const s = l[q] * 4; const d = this.segDist(x, z, s); if (d < best) best = d; }
    return best;
  }
  private segDist(x: number, z: number, s: number) {
    const S = this.segs; const ax = S[s], az = S[s + 1], dx = S[s + 2] - ax, dz = S[s + 3] - az; const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); return Math.hypot(ax + dx * t - x, az + dz * t - z);
  }
  /** Signed room to the nearest corridor: distance to a centreline minus that road's own limit (limit = hw + vgK * verge + add). Positive is clear. */
  room(x: number, z: number, mode: 'build' | 'wall' | 'tree') {
    const l = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!l) return 99;
    let best = 99;
    for (let q = 0; q < l.length; q++) {
      const si = l[q]; const d = this.segDist(x, z, si * 4);
      const lim = mode === 'build' ? (this.walk[si] === 0 ? this.hw[si] : this.walk[si]) + 0.9 : mode === 'wall' ? this.hw[si] + this.vg[si] + 0.2 : this.hw[si] + this.vg[si] + 1.2;
      const r = d - lim; if (r < best) best = r;
    }
    return best;
  }
  /** Poles and lamps must not stand on a carriageway or on a walking line of any road (they would snag walkers and cars). */
  poleBad(x: number, z: number) {
    const l = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!l) return false;
    for (let q = 0; q < l.length; q++) {
      const si = l[q]; const d = this.segDist(x, z, si * 4);
      if (d < this.hw[si] + 0.3) return true;
      const w = this.walk[si]; if (w > 0 ? Math.abs(d - w) < 0.7 : d < 0.8) return true;
    }
    return false;
  }
  /** Nearest segment: index, foot point and distance. */
  nearest(x: number, z: number) {
    const l = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!l) return null;
    let bs = -1, bd = 1e9, bx = 0, bz = 0;
    for (let q = 0; q < l.length; q++) {
      const s = l[q] * 4; const S = this.segs; const ax = S[s], az = S[s + 1], dx = S[s + 2] - ax, dz = S[s + 3] - az; const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); const px = ax + dx * t, pz = az + dz * t; const d = Math.hypot(px - x, pz - z);
      if (d < bd) { bd = d; bs = l[q]; bx = px; bz = pz; }
    }
    return bs < 0 ? null : { si: bs, d: bd, px: bx, pz: bz, hw: this.hw[bs], vg: this.vg[bs] };
  }
}

/** True for building kinds a real Lagos plot walls in: houses, flats and hotels. Shops, markets, stations, terminals, stands and sheds stay open. */
export function wallable(kind: number) { return kind === BK.house || kind === BK.flats || kind === BK.hotel || kind === BK.unfinished; }

/** Sutherland-Hodgman clip of a polygon (flat x,z array) to the half-plane  sgn * cross(dir, p - a) >= lim. */
function clipHalf(P: number[], ax: number, az: number, dx: number, dz: number, sgn: number, lim: number) {
  const out: number[] = []; const n = P.length / 2; const f = (x: number, z: number) => sgn * (dx * (z - az) - dz * (x - ax)) - lim;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; const x0 = P[i * 2], z0 = P[i * 2 + 1], x1 = P[j * 2], z1 = P[j * 2 + 1]; const f0 = f(x0, z0), f1 = f(x1, z1);
    if (f0 >= 0) out.push(x0, z0);
    if ((f0 >= 0) !== (f1 >= 0)) { const t = f0 / (f0 - f1); out.push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t); }
  }
  return out;
}

/**
 * Cuts the part of a footprint that stands on a sidewalk or road away with a straight cut parallel to the road (a plan view slice, not a
 * vertex shove, so walls stay straight). A building that mostly sits on the road is dropped. Runs once per building and stores the result on it.
 */
export function fitBuilding(b: Building, rc: RoadClear) {
  if (b.fit) return !b.dead;
  b.fit = true;
  let P = Array.from(b.pts); const n0 = P.length / 2; if (n0 < 3) return true;
  const a0 = Math.abs(polyArea(P)); if (a0 < 1) return true;
  let cuts = 0;
  for (let pass = 0; pass < 4; pass++) {
    // deepest intrusion over the vertices and points along the edges
    let worst = 0.06, ws = -1, wx = 0, wz = 0; const m = P.length / 2;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m; const ax = P[i * 2], az = P[i * 2 + 1], bx = P[j * 2], bz = P[j * 2 + 1]; const L = Math.hypot(bx - ax, bz - az); const k = Math.max(1, Math.min(12, Math.ceil(L / 2.5)));
      for (let s = 0; s < k; s++) {
        const x = ax + ((bx - ax) * s) / k, z = az + ((bz - az) * s) / k; const nr = rc.nearest(x, z); if (!nr) continue;
        const lim = (rc.walk[nr.si] === 0 ? rc.hw[nr.si] : rc.walk[nr.si]) + 0.9; const intr = lim - nr.d;
        if (intr > worst) { worst = intr; ws = nr.si; wx = x; wz = z; }
      }
    }
    if (ws < 0) break;
    const S = rc.segs; const ax = S[ws * 4], az = S[ws * 4 + 1]; let dx = S[ws * 4 + 2] - ax, dz = S[ws * 4 + 3] - az; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const lim = (rc.walk[ws] === 0 ? rc.hw[ws] : rc.walk[ws]) + 0.9;
    // which side of the road the building is on: where most of its area is
    let cxs = 0, czs = 0; for (let i = 0; i < m; i++) { cxs += P[i * 2]; czs += P[i * 2 + 1]; } cxs /= m; czs /= m;
    const sd = (x: number, z: number) => dx * (z - az) - dz * (x - ax);
    let sgn = sd(cxs, czs) >= 0 ? 1 : -1; if (Math.abs(sd(cxs, czs)) < 0.4) sgn = sd(wx, wz) >= 0 ? 1 : -1;
    P = clipHalf(P, ax, az, dx, dz, sgn, lim); cuts++;
    if (P.length < 6 || Math.abs(polyArea(P)) < Math.max(9, a0 * 0.4)) { b.dead = true; return false; }
  }
  if (!cuts) return true;
  b.pts = Float32Array.from(P);
  let cx = 0, cz = 0; for (let i = 0; i < P.length; i += 2) { cx += P[i]; cz += P[i + 1]; } b.cx = cx / (P.length / 2); b.cz = cz / (P.length / 2); b.area = Math.abs(polyArea(P));
  return true;
}

/** A footprint that sits inside a bigger one (OSM often maps a building and its parts twice) is dropped from the smaller one. */
export function dropNested(list: (Building & { dead?: boolean })[]) {
  const live = list.filter((b) => !b.dead).sort((a, b) => b.area - a.area);
  for (let i = 0; i < live.length; i++) {
    const big = live[i]; if (big.dead) continue;
    let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; for (let k = 0; k < big.pts.length; k += 2) { bx0 = Math.min(bx0, big.pts[k]); bx1 = Math.max(bx1, big.pts[k]); bz0 = Math.min(bz0, big.pts[k + 1]); bz1 = Math.max(bz1, big.pts[k + 1]); }
    for (let j = i + 1; j < live.length; j++) {
      const s = live[j]; if (s.dead || s.area > big.area * 0.9) continue;
      if (s.cx < bx0 || s.cx > bx1 || s.cz < bz0 || s.cz > bz1) continue;
      let inside = 0; const n = s.pts.length / 2; for (let k = 0; k < n; k++) if (pointInPoly(s.pts[k * 2], s.pts[k * 2 + 1], big.pts)) inside++;
      if (inside / n >= 0.75 && pointInPoly(s.cx, s.cz, big.pts)) s.dead = true;
    }
  }
}

/** Shore wall pieces that would cut a road, a causeway or a pavement are left out. */
export function shoreWallOk(mx: number, mz: number, rc: RoadClear) { return rc.room(mx, mz, 'wall') > 1.5; }
export type { Water };
