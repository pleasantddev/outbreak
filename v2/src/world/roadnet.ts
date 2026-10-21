// Drivable lanes and walkable kerbs built from the loaded regions, for traffic and pedestrians.
import { RF, ROAD, type Road } from './region';
import { halfWidth, lanesOf, verge, LANE, drivable } from './roadspec';

export interface Lane { id: number; road: Road; pts: number[]; len: number; speed: number; next: number[]; cls: number }
export interface Walk { pts: number[]; len: number }

const key = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;

export class RoadNet {
  lanes: Lane[] = []; walks: Walk[] = [];
  private grid = new Map<string, number[]>(); private wgrid = new Map<string, number[]>();
  private built = new Set<string>();
  static C = 80;
  /** Adds lanes for roads not seen before (dedupe by road piece). */
  addRoads(roads: Road[]) {
    const ends = new Map<string, number[]>();
    for (const r of roads) {
      const k = `${r.id}:${r.pts[0]}:${r.pts[1]}`; if (this.built.has(k)) continue; this.built.add(k);
      if (r.flags & RF.tunnel) continue;
      const bridge = !!(r.flags & RF.bridge);
      if (drivable(r.cls) && r.cls !== ROAD.track && !bridge) {
        const hw = halfWidth(r), n = lanesOf(r), one = !!(r.flags & RF.oneway);
        const perDir = one ? n : Math.max(1, Math.floor(n / 2));
        const lw = one ? (2 * hw) / n : hw / perDir;
        const speed = r.cls <= ROAD.trunk ? 19 : r.cls <= ROAD.secondary ? 15 : r.cls <= ROAD.unclassified ? 11 : r.cls === ROAD.residential ? 8 : 6;
        const dirs = one ? [r.flags & RF.reverse ? -1 : 1] : [1, -1];
        for (const dir of dirs) for (let li = 0; li < perDir; li++) {
          // Nigeria drives on the right: forward lanes sit right of the centreline
          const off = one ? -hw + lw * (li + 0.5) : (lw * (li + 0.5));
          const pts = offsetLine(r.pts, off, dir);
          if (pts.length < 4) continue;
          let len = 0; for (let q = 0; q < pts.length - 2; q += 2) len += Math.hypot(pts[q + 2] - pts[q], pts[q + 3] - pts[q + 1]);
          const id = this.lanes.length;
          this.lanes.push({ id, road: r, pts, len, speed, next: [], cls: r.cls });
          this.index(this.grid, pts, id);
          const ek = key(dir > 0 ? r.pts[r.pts.length - 2] : r.pts[0], dir > 0 ? r.pts[r.pts.length - 1] : r.pts[1]);
          if (!ends.has(ek)) ends.set(ek, []); ends.get(ek)!.push(id);
        }
      }
      if (!bridge && r.cls !== ROAD.motorway && r.cls !== ROAD.motorwayLink && r.cls !== ROAD.service && r.cls !== ROAD.track) {
        const hw = halfWidth(r), vg = verge(r);
        const off = r.cls === ROAD.foot || r.cls === ROAD.steps ? 0 : hw + Math.min(vg * 0.45, 2.2) + 0.3;
        for (const side of off ? [1, -1] : [1]) {
          const pts = offsetLine(r.pts, off * side, 1);
          if (pts.length < 4) continue;
          let len = 0; for (let q = 0; q < pts.length - 2; q += 2) len += Math.hypot(pts[q + 2] - pts[q], pts[q + 3] - pts[q + 1]);
          const id = this.walks.length; this.walks.push({ pts, len }); this.index(this.wgrid, pts, id);
        }
      }
    }
    // connect lanes whose start is near another lane's end (junctions)
    for (const l of this.lanes) if (!l.next.length) {
      const ex = l.pts[l.pts.length - 2], ez = l.pts[l.pts.length - 1];
      for (const c of this.near(ex, ez, 14)) { if (c === l.id) continue; const o = this.lanes[c]; const d = Math.hypot(o.pts[0] - ex, o.pts[1] - ez); if (d < 14) l.next.push(c); }
    }
    void ends;
  }
  private index(g: Map<string, number[]>, pts: number[], id: number) {
    const C = RoadNet.C; const seen = new Set<string>();
    for (let q = 0; q < pts.length; q += 2) { const k = `${Math.floor(pts[q] / C)},${Math.floor(pts[q + 1] / C)}`; if (seen.has(k)) continue; seen.add(k); if (!g.has(k)) g.set(k, []); g.get(k)!.push(id); }
  }
  near(x: number, z: number, r: number) {
    const C = RoadNet.C; const out = new Set<number>();
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) for (const id of this.grid.get(`${i},${j}`) ?? []) out.add(id);
    return [...out];
  }
  nearWalks(x: number, z: number, r: number) {
    const C = RoadNet.C; const out = new Set<number>();
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) for (const id of this.wgrid.get(`${i},${j}`) ?? []) out.add(id);
    return [...out];
  }
  /** Point and heading at distance s along a polyline. */
  static at(pts: number[], s: number) {
    for (let q = 0; q < pts.length - 2; q += 2) {
      const L = Math.hypot(pts[q + 2] - pts[q], pts[q + 3] - pts[q + 1]);
      if (s <= L || q >= pts.length - 4) { const t = L > 0 ? Math.min(1, s / L) : 0; return { x: pts[q] + (pts[q + 2] - pts[q]) * t, z: pts[q + 1] + (pts[q + 3] - pts[q + 1]) * t, yaw: Math.atan2(pts[q + 2] - pts[q], pts[q + 3] - pts[q + 1]) }; }
      s -= L;
    }
    return { x: pts[pts.length - 2], z: pts[pts.length - 1], yaw: 0 };
  }
  /** Closest position on a lane to (x, z): returns distance along the lane. */
  static project(pts: number[], x: number, z: number) {
    let best = 1e9, bs = 0, acc = 0;
    for (let q = 0; q < pts.length - 2; q += 2) {
      const ax = pts[q], az = pts[q + 1], dx = pts[q + 2] - ax, dz = pts[q + 3] - az; const L2 = dx * dx + dz * dz || 1; const L = Math.sqrt(L2);
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < best) { best = d; bs = acc + t * L; }
      acc += L;
    }
    return { s: bs, d: best };
  }
}

/** Offsets a polyline sideways (right of travel is negative lateral in our frame). dir -1 reverses it. */
function offsetLine(p: Float32Array, off: number, dir: number) {
  const n = p.length / 2; const out: number[] = [];
  const idx = (k: number) => (dir > 0 ? k : n - 1 - k);
  for (let k = 0; k < n; k++) {
    const i = idx(k), ip = idx(Math.max(0, k - 1)), inx = idx(Math.min(n - 1, k + 1));
    let tx = p[inx * 2] - p[ip * 2], tz = p[inx * 2 + 1] - p[ip * 2 + 1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    // x east, z south: the right-hand side of travel direction (tx, tz) is (-tz, tx)
    out.push(p[i * 2] - tz * off, p[i * 2 + 1] + tx * off);
  }
  return out;
}
export { LANE };
