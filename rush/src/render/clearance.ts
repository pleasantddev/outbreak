// Fast "how far is this point from the race corridor" lookups, used to keep buildings, props and parapets off the
// track and to decide what sits beside it.
import { Track, type TrackData } from '../shared/track';

export interface Near { d: number; hw: number; y: number; s: number; path: number; i: number; rx: number; rz: number; side: number }

export class Clearance {
  private cell = 20;
  private grid = new Map<number, number[]>();
  private px: number[] = []; private pz: number[] = []; private py: number[] = []; private phw: number[] = []; private ps: number[] = [];
  private ppath: number[] = []; private pi: number[] = []; private ptx: number[] = []; private ptz: number[] = [];

  constructor(public track: Track | null) {
    if (!track) return;
    track.paths.forEach((c, pathIdx) => {
      for (let i = 0; i < c.n; i++) {
        const k = this.px.length;
        this.px.push(c.x[i]); this.pz.push(c.z[i]); this.py.push(c.y[i]); this.phw.push(c.hw[i]); this.ps.push(c.s[i]);
        this.ppath.push(pathIdx); this.pi.push(i); this.ptx.push(c.tx[i]); this.ptz.push(c.tz[i]);
        const key = this.key(c.x[i], c.z[i]);
        let arr = this.grid.get(key); if (!arr) { arr = []; this.grid.set(key, arr); } arr.push(k);
      }
    });
  }
  private key(x: number, z: number) { return (Math.floor(x / this.cell) + 2000) * 4000 + Math.floor(z / this.cell) + 2000; }

  /** Nearest corridor sample within `range` metres, or null. Distance is to the centreline. */
  nearest(x: number, z: number, range = 60): Near | null {
    if (!this.track) return null;
    const r = Math.ceil(range / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = range * range;
    for (let gx = cx - r; gx <= cx + r; gx++) for (let gz = cz - r; gz <= cz + r; gz++) {
      const arr = this.grid.get((gx + 2000) * 4000 + gz + 2000);
      if (!arr) continue;
      for (const k of arr) { const d = (this.px[k] - x) ** 2 + (this.pz[k] - z) ** 2; if (d < bd) { bd = d; best = k; } }
    }
    if (best < 0) return null;
    const rx = -this.ptz[best], rz = this.ptx[best];
    const side = Math.sign((x - this.px[best]) * rx + (z - this.pz[best]) * rz) || 1;
    return { d: Math.sqrt(bd), hw: this.phw[best], y: this.py[best], s: this.ps[best], path: this.ppath[best], i: this.pi[best], rx, rz, side };
  }

  /** Nearest corridor sample at roughly this height (within dy), ignoring stretches on other levels. */
  nearestAt(x: number, z: number, y: number, dy: number, range = 30): Near | null {
    if (!this.track) return null;
    const r = Math.ceil(range / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = range * range;
    for (let gx = cx - r; gx <= cx + r; gx++) for (let gz = cz - r; gz <= cz + r; gz++) {
      const arr = this.grid.get((gx + 2000) * 4000 + gz + 2000);
      if (!arr) continue;
      for (const k of arr) {
        if (Math.abs(this.py[k] - y) > dy) continue;
        const d = (this.px[k] - x) ** 2 + (this.pz[k] - z) ** 2; if (d < bd) { bd = d; best = k; }
      }
    }
    if (best < 0) return null;
    const rx = -this.ptz[best], rz = this.ptx[best];
    const side = Math.sign((x - this.px[best]) * rx + (z - this.pz[best]) * rz) || 1;
    return { d: Math.sqrt(bd), hw: this.phw[best], y: this.py[best], s: this.ps[best], path: this.ppath[best], i: this.pi[best], rx, rz, side };
  }

  /** Inside some other stretch of the corridor at about this height: not samples of `path` within `skip` of index i.
   *  A barrier or a post there would cut across lanes the car drives through. */
  insideOther(x: number, z: number, y: number, path: number, i: number, skip = 6, margin = -0.2) {
    if (!this.track) return false;
    const r = Math.ceil(16 / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const n = this.track.paths[path]?.n ?? 0;
    for (let gx = cx - r; gx <= cx + r; gx++) for (let gz = cz - r; gz <= cz + r; gz++) {
      const arr = this.grid.get((gx + 2000) * 4000 + gz + 2000);
      if (!arr) continue;
      for (const k of arr) {
        if (Math.abs(this.py[k] - y) > 3) continue;
        if (this.ppath[k] === path) { const di = Math.abs(this.pi[k] - i); if (Math.min(di, n - di) <= skip) continue; }
        const reach = this.phw[k] + margin;
        if (reach > 0 && (this.px[k] - x) ** 2 + (this.pz[k] - z) ** 2 < reach * reach) return true;
      }
    }
    return false;
  }

  /** Is any part of the corridor, at a road height between yMin and yMax, within `margin` metres of this point (plan
   *  view)? A pylon or a lamp post standing there would be in the way of a car on that stretch. */
  blocks(x: number, z: number, margin: number, yMin = -Infinity, yMax = Infinity) {
    if (!this.track) return false;
    const r = Math.ceil((margin + 14) / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let gx = cx - r; gx <= cx + r; gx++) for (let gz = cz - r; gz <= cz + r; gz++) {
      const arr = this.grid.get((gx + 2000) * 4000 + gz + 2000);
      if (!arr) continue;
      for (const k of arr) {
        if (this.py[k] < yMin || this.py[k] > yMax) continue;
        const reach = this.phw[k] + margin;
        if ((this.px[k] - x) ** 2 + (this.pz[k] - z) ** 2 < reach * reach) return true;
      }
    }
    return false;
  }

  /** Metres of clear ground between a point and the corridor edge (negative means inside the corridor). */
  gap(x: number, z: number, range = 60) {
    const n = this.nearest(x, z, range);
    return n ? n.d - n.hw : Infinity;
  }
}

/** One test across every official route: is a column of radius r, from the ground up to `top`, standing in any of
 *  them? Landmarks are shared by all routes, so their pylons have to keep clear of all of them at once. */
export function routeBlocker(tracks: TrackData[]) {
  const cs = tracks.filter((t) => !t.reverse && !t.custom).map((t) => new Clearance(new Track(t)));
  return (x: number, z: number, r: number, top: number) => cs.some((c) => c.blocks(x, z, r, -5, top - 1.5));
}
