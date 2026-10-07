// Fast "how far is this point from the race corridor" lookups, used to keep buildings, props and parapets off the
// track and to decide what sits beside it.
import type { Track } from '../shared/track';

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

  /** Metres of clear ground between a point and the corridor edge (negative means inside the corridor). */
  gap(x: number, z: number, range = 60) {
    const n = this.nearest(x, z, range);
    return n ? n.d - n.hw : Infinity;
  }
}
