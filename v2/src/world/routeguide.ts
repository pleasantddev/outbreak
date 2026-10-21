// Follows a graph route: recomputes only when the goal changes or the traveller leaves the route, trims the part already
// travelled, and reports the next turn. The caller feeds it the player position every frame; it is cheap.
import { RoadGraph, type Mode, type Path } from './roadgraph';

export interface Turn { dist: number; dir: 'left' | 'right' | 'uturn' | 'arrive' }

export class RouteGuide {
  path: Path | null = null;
  goal: { x: number; z: number } | null = null;
  mode: Mode = 'drive';
  /** what is left of the route: x,z pairs starting at the traveller's projected position */
  remaining: number[] = [];
  /** metres left along the route, and a rough time in seconds */
  left = 0; eta = 0;
  next: Turn | null = null;
  /** true while no route exists (graph not loaded yet, or the network does not connect) */
  lost = false;
  computes = 0; lastMs = 0;
  private cum: number[] = []; private idx = 0; private offT = 0; private cool = 0; private retryT = 0; private ver = -1; private uT = 0;
  constructor(public graph: RoadGraph) {}

  clear() { this.path = null; this.goal = null; this.remaining = []; this.next = null; this.left = 0; this.lost = false; this.cum = []; }

  update(dt: number, px: number, pz: number, mode: Mode, goal: { x: number; z: number } | null) {
    if (!goal) { if (this.goal) this.clear(); return; }
    this.cool -= dt; this.retryT -= dt;
    const changed = !this.goal || Math.hypot(goal.x - this.goal.x, goal.z - this.goal.z) > 2.5 || mode !== this.mode;
    if (changed) { this.goal = { x: goal.x, z: goal.z }; this.mode = mode; this.compute(px, pz); return; }
    if (!this.path) { if (this.retryT <= 0 || this.graph.version !== this.ver) this.compute(px, pz); return; }
    // progress along the route
    const p = this.path.pts; const nseg = p.length / 2 - 1; let best = 1e9, bi = this.idx, bt = 0;
    const scan = (a: number, b: number) => {
      for (let i = Math.max(0, a); i < Math.min(nseg, b); i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az; const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)); const d = Math.hypot(ax + dx * t - px, az + dz * t - pz);
        if (d < best) { best = d; bi = i; bt = t; }
      }
    };
    scan(this.idx - 2, this.idx + 40); if (best > 30) scan(0, nseg);
    this.idx = bi;
    const thr = this.mode === 'drive' ? 24 : 16;
    this.offT = best > thr ? this.offT + dt : 0;
    if (this.offT > 1.1 && this.cool <= 0) { this.compute(px, pz); return; }
    this.rebuild(bi, bt, px, pz);
  }

  private compute(px: number, pz: number) {
    const t0 = performance.now(); this.computes++;
    this.ver = this.graph.version; this.cool = 1.2; this.retryT = 3; this.offT = 0;
    const r = this.goal ? this.graph.route(px, pz, this.goal.x, this.goal.z, this.mode) : null;
    this.lastMs = performance.now() - t0;
    this.path = r; this.lost = !r; this.idx = 0;
    if (!r) { this.remaining = []; this.next = null; this.left = 0; this.cum = []; return; }
    this.cum = [0]; for (let i = 0; i < r.pts.length / 2 - 1; i++) this.cum.push(this.cum[i] + Math.hypot(r.pts[i * 2 + 2] - r.pts[i * 2], r.pts[i * 2 + 3] - r.pts[i * 2 + 1]));
    this.rebuild(0, 0, px, pz);
  }

  private rebuild(i: number, t: number, px: number, pz: number) {
    const p = this.path!.pts; const total = this.cum[this.cum.length - 1];
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
    const sx = ax + (bx - ax) * t, sz = az + (bz - az) * t;
    const rem = this.remaining; rem.length = 0; rem.push(px, pz, sx, sz);
    for (let k = i + 1; k < p.length / 2; k++) rem.push(p[k * 2], p[k * 2 + 1]);
    const along = this.cum[i] + (this.cum[i + 1] - this.cum[i]) * t;
    this.left = Math.max(0, total - along);
    this.eta = this.path!.time * (total > 0 ? this.left / total : 0);
    // next turn: first vertex ahead whose bearing change is sharp
    this.next = { dist: this.left, dir: 'arrive' };
    for (let k = i + 1; k < p.length / 2 - 1; k++) {
      const x0 = p[k * 2 - 2], z0 = p[k * 2 - 1], x1 = p[k * 2], z1 = p[k * 2 + 1], x2 = p[k * 2 + 2], z2 = p[k * 2 + 3];
      const a1 = Math.atan2(x1 - x0, z1 - z0), a2 = Math.atan2(x2 - x1, z2 - z1); let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > 0.55 && Math.hypot(x2 - x1, z2 - z1) > 6) { this.next = { dist: Math.max(0, this.cum[k] - along), dir: Math.abs(d) > 2.6 ? 'uturn' : d < 0 ? 'right' : 'left' }; break; }
    }
    void this.uT;
  }
}
