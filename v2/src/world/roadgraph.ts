// Road graph for routing: nodes are road vertices (shared vertices are junctions, wherever they fall along a way),
// edges are the segments between them. Built straight from region road data so it spans tile and region seams
// and does not depend on which tiles are currently meshed. Binary-heap A*, one-way aware for driving.
import { RF, ROAD, type Road, type Region } from './region';

export type Mode = 'drive' | 'walk';
export interface Path { pts: number[]; len: number; time: number; mode: Mode }

const QUANT = 10; // 0.1 m: the packer rounds to this, so a shared vertex has identical coordinates in every region
const CELL = 64;
/** driving speed (m/s) per road class, indexed by ROAD.* */
const SPEED: Record<number, number> = { [ROAD.motorway]: 24, [ROAD.trunk]: 19, [ROAD.primary]: 16, [ROAD.secondary]: 14, [ROAD.tertiary]: 11, [ROAD.unclassified]: 9, [ROAD.residential]: 7, [ROAD.service]: 4, [ROAD.motorwayLink]: 16, [ROAD.link]: 12, [ROAD.track]: 3, [ROAD.construction]: 2 };
const VMAX = 24, WALK = 1.45;
const F_DRIVE = 1, F_WALK = 2;

export class RoadGraph {
  version = 0;
  // nodes
  nx: number[] = []; nz: number[] = [];
  private nodeKey = new Map<number, number>();
  private adj: number[][] = [];
  private uf: number[] = [];
  // segments (undirected edges)
  sa: number[] = []; sb: number[] = []; slen: number[] = []; scls: number[] = []; sdir: number[] = []; smask: number[] = []; sroad: number[] = [];
  roadNames: (string | null)[] = [];
  private built = new Set<string>();
  private regionKeys = new Set<string>();
  private grid = new Map<number, number[]>();

  get nodes() { return this.nx.length; }
  get segments() { return this.sa.length; }

  reset() {
    this.nx = []; this.nz = []; this.nodeKey.clear(); this.adj = []; this.uf = [];
    this.sa = []; this.sb = []; this.slen = []; this.scls = []; this.sdir = []; this.smask = []; this.sroad = []; this.roadNames = [];
    this.built.clear(); this.regionKeys.clear(); this.grid.clear(); this.version++;
  }

  /** Brings the graph up to date with the loaded regions, one region per call so a big map never stalls a frame.
   *  Returns true while regions are still waiting to be added. */
  sync(regions: Iterable<Region>): boolean {
    const list = [...regions]; const fresh = list.filter((r) => !this.regionKeys.has(`${r.i},${r.j}`));
    if (!fresh.length) return false;
    // loaded regions come and go as the player moves; rebuild from what is loaded once the cache outgrows it
    if (this.regionKeys.size + fresh.length > 14) { this.reset(); return this.sync(list); }
    const r = fresh[0]; this.regionKeys.add(`${r.i},${r.j}`); this.addRoads(r.roads, true);
    return fresh.length > 1;
  }

  /** Graph health for tests: connected pieces and loose ends. */
  stats() {
    const comps = new Map<number, number>(); let dead = 0;
    for (let n = 0; n < this.nx.length; n++) { const r = this.find(n); comps.set(r, (comps.get(r) ?? 0) + 1); if (this.adj[n].length === 1) dead++; }
    const sizes = [...comps.values()].sort((a, b) => b - a);
    return { nodes: this.nx.length, segments: this.sa.length, components: sizes.length, largest: sizes.slice(0, 5), deadEnds: dead };
  }

  private node(x: number, z: number) {
    const ix = Math.round(x * QUANT), iz = Math.round(z * QUANT); const key = (ix + 400000) * 1000003 + (iz + 400000);
    let id = this.nodeKey.get(key);
    if (id === undefined) { id = this.nx.length; this.nodeKey.set(key, id); this.nx.push(ix / QUANT); this.nz.push(iz / QUANT); this.adj.push([]); this.uf.push(id); }
    return id;
  }
  private find(a: number) { while (this.uf[a] !== a) { this.uf[a] = this.uf[this.uf[a]]; a = this.uf[a]; } return a; }
  private union(a: number, b: number) { a = this.find(a); b = this.find(b); if (a !== b) this.uf[a] = b; }

  addRoads(roads: Road[], link = true) {
    for (const r of roads) {
      if (r.pts.length < 4 || r.flags & RF.tunnel) continue;
      const k = `${r.id}:${r.pts[0]}:${r.pts[1]}:${r.pts.length}`; if (this.built.has(k)) continue; this.built.add(k);
      const cls = r.cls; let mask = 0;
      if (cls <= ROAD.track && cls !== ROAD.busway || cls === ROAD.construction) mask |= F_DRIVE;
      if (cls !== ROAD.motorway && cls !== ROAD.motorwayLink && cls !== ROAD.busway) mask |= F_WALK;
      if (cls === ROAD.foot || cls === ROAD.steps) mask &= ~F_DRIVE;
      if (!mask) continue;
      const oneway = r.flags & RF.oneway || r.flags & RF.roundabout; const dir = oneway ? (r.flags & RF.reverse ? -1 : 1) : 0;
      let road = -1; if (r.name) { road = this.roadNames.length; this.roadNames.push(r.name); }
      let prev = this.node(r.pts[0], r.pts[1]);
      for (let q = 2; q < r.pts.length; q += 2) {
        const cur = this.node(r.pts[q], r.pts[q + 1]); if (cur === prev) continue;
        this.addSeg(prev, cur, cls, dir, mask, road); prev = cur;
      }
    }
    if (link) { this.linkDeadEnds(); this.version++; }
  }

  private addSeg(a: number, b: number, cls: number, dir: number, mask: number, road: number) {
    const id = this.sa.length; const len = Math.hypot(this.nx[b] - this.nx[a], this.nz[b] - this.nz[a]);
    this.sa.push(a); this.sb.push(b); this.slen.push(len); this.scls.push(cls); this.sdir.push(dir); this.smask.push(mask); this.sroad.push(road);
    this.adj[a].push(id); this.adj[b].push(id); this.union(a, b); this.indexSeg(id);
  }
  private indexSeg(id: number) {
    const a = this.sa[id], b = this.sb[id]; const x0 = this.nx[a], z0 = this.nz[a], x1 = this.nx[b], z1 = this.nz[b];
    const n = Math.max(1, Math.ceil(this.slen[id] / (CELL * 0.5))); let last = -1;
    for (let i = 0; i <= n; i++) {
      const t = i / n; const cx = Math.floor((x0 + (x1 - x0) * t) / CELL), cz = Math.floor((z0 + (z1 - z0) * t) / CELL); const key = (cx + 4000) * 10000 + (cz + 4000);
      if (key === last) continue; last = key;
      let l = this.grid.get(key); if (!l) { l = []; this.grid.set(key, l); }
      if (l[l.length - 1] !== id) l.push(id);
    }
  }

  /** Road ends that nearly touch, or stop just short of another road (a junction vertex lost in simplification), get joined:
   *  to a node within 4 m, else to the nearest point of a segment within 7 m, splitting that segment there. */
  private linkDeadEnds() {
    const R = 4, cell = 8; const g = new Map<number, number[]>();
    const key = (x: number, z: number) => (Math.floor(x / cell) + 4000) * 10000 + (Math.floor(z / cell) + 4000);
    for (let i = 0; i < this.nx.length; i++) { const k = key(this.nx[i], this.nz[i]); let l = g.get(k); if (!l) { l = []; g.set(k, l); } l.push(i); }
    const ends: number[] = []; for (let i = 0; i < this.nx.length; i++) if (this.adj[i].length === 1) ends.push(i);
    for (const i of ends) {
      if (this.adj[i].length !== 1) continue;
      const x = this.nx[i], z = this.nz[i]; let best = -1, bd = R;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of g.get(key(x + a * cell, z + b * cell)) ?? []) {
        if (j === i || this.find(j) === this.find(i)) continue;
        const d = Math.hypot(this.nx[j] - x, this.nz[j] - z); if (d < bd) { bd = d; best = j; }
      }
      const own = this.adj[i][0];
      if (best >= 0) { this.addSeg(i, best, this.scls[own], 0, this.smask[own], -1); continue; }
      // nearest segment of another road
      let bs = -1, bt = 0, bdd = 7; const seen = new Set<number>();
      for (let ci = Math.floor((x - 7) / CELL); ci <= Math.floor((x + 7) / CELL); ci++) for (let cj = Math.floor((z - 7) / CELL); cj <= Math.floor((z + 7) / CELL); cj++) for (const sg of this.grid.get((ci + 4000) * 10000 + (cj + 4000)) ?? []) {
        if (seen.has(sg) || sg === own) continue; seen.add(sg);
        if (this.sa[sg] === i || this.sb[sg] === i || !(this.smask[sg] & this.smask[own])) continue;
        const a = this.sa[sg], b2 = this.sb[sg]; const ax = this.nx[a], az = this.nz[a], dx = this.nx[b2] - ax, dz = this.nz[b2] - az; const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
        if (d < bdd) { bdd = d; bs = sg; bt = t; }
      }
      if (bs < 0) continue;
      const a = this.sa[bs], b2 = this.sb[bs]; const px = this.nx[a] + (this.nx[b2] - this.nx[a]) * bt, pz = this.nz[a] + (this.nz[b2] - this.nz[a]) * bt;
      const n = this.node(px, pz);
      if (n !== a && n !== b2) this.splitSeg(bs, n);
      if (n !== i) this.addSeg(i, n, this.scls[own], 0, this.smask[own], -1);
    }
  }
  /** Cuts segment s at node n: s keeps a..n, a new segment takes n..b with the same properties. */
  private splitSeg(s: number, n: number) {
    const b = this.sb[s]; const adjB = this.adj[b]; const k = adjB.indexOf(s); if (k >= 0) adjB.splice(k, 1);
    this.sb[s] = n; this.slen[s] = Math.hypot(this.nx[n] - this.nx[this.sa[s]], this.nz[n] - this.nz[this.sa[s]]);
    this.adj[n].push(s); this.addSeg(n, b, this.scls[s], this.sdir[s], this.smask[s], this.sroad[s]);
  }

  private allowed(s: number, from: number, mode: Mode) {
    if (!(this.smask[s] & (mode === 'drive' ? F_DRIVE : F_WALK))) return false;
    if (mode === 'walk') return true;
    const d = this.sdir[s]; return d === 0 || (d > 0 ? this.sa[s] === from : this.sb[s] === from);
  }
  private speed(s: number, mode: Mode) { return mode === 'walk' ? WALK : SPEED[this.scls[s]] ?? 6; }

  /** Nearest usable road points around (x, z), best first, preferring ones on a well connected piece of network. */
  snap(x: number, z: number, mode: Mode, maxR = 400) {
    type Cand = { s: number; t: number; x: number; z: number; d: number };
    const flag = mode === 'drive' ? F_DRIVE : F_WALK;
    for (let R = 60; R <= maxR * 1.01; R *= 2.5) {
      const found: Cand[] = []; const seen = new Set<number>();
      for (let i = Math.floor((x - R) / CELL); i <= Math.floor((x + R) / CELL); i++) for (let j = Math.floor((z - R) / CELL); j <= Math.floor((z + R) / CELL); j++) for (const s of this.grid.get((i + 4000) * 10000 + (j + 4000)) ?? []) {
        if (seen.has(s)) continue; seen.add(s); if (!(this.smask[s] & flag)) continue;
        const a = this.sa[s], b = this.sb[s]; const ax = this.nx[a], az = this.nz[a], dx = this.nx[b] - ax, dz = this.nz[b] - az; const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); const px = ax + dx * t, pz = az + dz * t; const d = Math.hypot(px - x, pz - z);
        if (d <= R) found.push({ s, t, x: px, z: pz, d });
      }
      if (!found.length) continue;
      found.sort((p, q) => p.d - q.d);
      // components: skip stranded fragments unless nothing better is near
      const comp = (c: Cand) => this.find(this.sa[c.s]);
      const main = found.find((c) => this.componentSize(comp(c)) > 30);
      const lead = main ?? found[0];
      const out: Cand[] = []; const used = new Set<number>();
      for (const c of found) { if (c.d > lead.d + 40 || out.length >= 8) break; if (this.componentSize(comp(c)) <= 30 && main) continue; if (used.has(c.s)) continue; used.add(c.s); out.push(c); }
      return out;
    }
    return [];
  }
  private sizeCache = new Map<number, number>(); private sizeVer = -1;
  private componentSize(root: number) {
    if (this.sizeVer !== this.version + this.nx.length) { this.sizeCache.clear(); for (let n = 0; n < this.uf.length; n++) { const r = this.find(n); this.sizeCache.set(r, (this.sizeCache.get(r) ?? 0) + 1); } this.sizeVer = this.version + this.nx.length; }
    return this.sizeCache.get(root) ?? 0;
  }

  /** Name of the closest road to a point (for the street line in the HUD). */
  roadAt(x: number, z: number, maxR = 40) {
    let best = '', bd = maxR;
    const flag = F_DRIVE | F_WALK;
    for (let i = Math.floor((x - maxR) / CELL); i <= Math.floor((x + maxR) / CELL); i++) for (let j = Math.floor((z - maxR) / CELL); j <= Math.floor((z + maxR) / CELL); j++) for (const s of this.grid.get((i + 4000) * 10000 + (j + 4000)) ?? []) {
      if (this.sroad[s] < 0 || !(this.smask[s] & flag)) continue;
      const a = this.sa[s], b = this.sb[s]; const ax = this.nx[a], az = this.nz[a], dx = this.nx[b] - ax, dz = this.nz[b] - az; const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < bd) { bd = d; best = this.roadNames[this.sroad[s]] ?? ''; }
    }
    return best;
  }

  // ---- A* ----
  private g = new Float64Array(0); private stamp = new Int32Array(0); private prev = new Int32Array(0); private cur = 0;
  private hf: number[] = []; private hn: number[] = [];
  private push(f: number, n: number) {
    const hf = this.hf, hn = this.hn; let i = hf.length; hf.push(f); hn.push(n);
    while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hf[i] = hf[p]; hn[i] = hn[p]; i = p; }
    hf[i] = f; hn[i] = n;
  }
  private pop() {
    const hf = this.hf, hn = this.hn; const top = hn[0]; const f = hf.pop()!, n = hn.pop()!; const len = hf.length;
    if (len) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= len) break; if (c + 1 < len && hf[c + 1] < hf[c]) c++; if (hf[c] >= f) break; hf[i] = hf[c]; hn[i] = hn[c]; i = c; }
      hf[i] = f; hn[i] = n;
    }
    return top;
  }

  /** Fastest route over the graph between two world points, or null when the network does not connect them. */
  route(x0: number, z0: number, x1: number, z1: number, mode: Mode): Path | null {
    const N = this.nx.length; if (!N) return null;
    const starts = this.snap(x0, z0, mode), goals = this.snap(x1, z1, mode);
    if (!starts.length || !goals.length) return null;
    if (this.g.length < N) { this.g = new Float64Array(N + 1024); this.stamp = new Int32Array(N + 1024); this.prev = new Int32Array(N + 1024); this.cur = 0; }
    const stamp = ++this.cur, g = this.g, st = this.stamp, prev = this.prev;
    this.hf.length = 0; this.hn.length = 0;
    const gx = x1, gz = z1; const H = (n: number) => Math.hypot(this.nx[n] - gx, this.nz[n] - gz) / (mode === 'drive' ? VMAX : WALK);
    // seeds: from the snapped point along its segment to either end, as far as one-way rules permit
    let bestTotal = Infinity, bestEnd = -1, bestGoal = -1; const direct = { v: null as { cost: number; si: number; gi: number } | null };
    starts.forEach((c, si) => {
      const a = this.sa[c.s], b = this.sb[c.s]; const v = this.speed(c.s, mode); const L = this.slen[c.s];
      for (const [to, from, dist] of [[b, a, (1 - c.t) * L], [a, b, c.t * L]] as const) {
        if (!this.allowed(c.s, from, mode)) continue;
        const cost = dist / v + c.d / 3;
        if (st[to] !== stamp || cost < g[to]) { st[to] = stamp; g[to] = cost; prev[to] = -1 - si; this.push(cost + H(to), to); }
      }
      // start and goal on the same segment
      goals.forEach((q, gi) => { if (q.s !== c.s) return; const fwd = q.t >= c.t; const from = fwd ? a : b; if (!this.allowed(c.s, from, mode)) return; const cost = Math.abs(q.t - c.t) * L / v; if (!direct.v || cost < direct.v.cost) direct.v = { cost, si, gi }; });
    });
    // goal acceptance: a node reaches goal point Q when travel node -> Q along Q's segment is allowed
    const goalCost = new Map<number, { cost: number; gi: number }>();
    goals.forEach((q, gi) => {
      const a = this.sa[q.s], b = this.sb[q.s]; const v = this.speed(q.s, mode); const L = this.slen[q.s];
      for (const [from, dist] of [[a, q.t * L], [b, (1 - q.t) * L]] as const) {
        if (!this.allowed(q.s, from, mode)) continue;
        const cost = dist / v + q.d / 3; const o = goalCost.get(from); if (!o || cost < o.cost) goalCost.set(from, { cost, gi });
      }
    });
    let pops = 0;
    while (this.hf.length && pops++ < 400000) {
      const f = this.hf[0]; if (f >= bestTotal) break;
      const n = this.pop();
      const gn = g[n]; if (f > gn + H(n) + 1e-6) continue; // stale heap entry
      const gc = goalCost.get(n);
      if (gc && gn + gc.cost < bestTotal) { bestTotal = gn + gc.cost; bestEnd = n; bestGoal = gc.gi; }
      for (const s of this.adj[n]) {
        if (!this.allowed(s, n, mode)) continue;
        const m = this.sa[s] === n ? this.sb[s] : this.sa[s];
        let cost = gn + this.slen[s] / this.speed(s, mode);
        if (mode === 'drive' && this.scls[s] === ROAD.construction) cost += this.slen[s] * 0.3;
        if (st[m] !== stamp || cost < g[m] - 1e-9) { st[m] = stamp; g[m] = cost; prev[m] = n; this.push(cost + H(m), m); }
      }
    }
    const pts: number[] = [];
    const dv = direct.v;
    if (dv && dv.cost <= bestTotal) {
      const c = starts[dv.si], q = goals[dv.gi]; pts.push(x0, z0, c.x, c.z, q.x, q.z, x1, z1);
      return this.finish(pts, mode, dv.cost);
    }
    if (bestEnd < 0) return null;
    const chain: number[] = []; let n = bestEnd, si = 0;
    for (;;) { chain.push(n); const p = prev[n]; if (p < 0) { si = -1 - p; break; } n = p; }
    chain.reverse();
    const c = starts[si], q = goals[bestGoal];
    pts.push(x0, z0, c.x, c.z); for (const k of chain) pts.push(this.nx[k], this.nz[k]); pts.push(q.x, q.z, x1, z1);
    return this.finish(pts, mode, bestTotal);
  }

  private finish(raw: number[], mode: Mode, time: number): Path {
    const pts = simplify(raw, 0.6); let len = 0;
    for (let q = 0; q < pts.length - 2; q += 2) len += Math.hypot(pts[q + 2] - pts[q], pts[q + 3] - pts[q + 1]);
    return { pts, len, time, mode };
  }
}

/** Douglas-Peucker on a flat x,z polyline; iterative so long routes cannot overflow the stack. */
export function simplify(p: number[], tol: number): number[] {
  const n = p.length / 2; if (n <= 2) return p.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1; const stack: number[] = [0, n - 1];
  while (stack.length) {
    const j = stack.pop()!, i = stack.pop()!; let md = 0, mi = -1;
    const ax = p[i * 2], az = p[i * 2 + 1], dx = p[j * 2] - ax, dz = p[j * 2 + 1] - az; const L = Math.hypot(dx, dz) || 1e-9;
    for (let k = i + 1; k < j; k++) { const d = Math.abs((p[k * 2] - ax) * dz - (p[k * 2 + 1] - az) * dx) / L; if (d > md) { md = d; mi = k; } }
    if (mi >= 0 && md > tol) { keep[mi] = 1; stack.push(i, mi, mi, j); }
  }
  const out: number[] = []; for (let k = 0; k < n; k++) if (keep[k]) out.push(p[k * 2], p[k * 2 + 1]);
  // drop exact duplicates left by the snapped ends
  const o2: number[] = [out[0], out[1]]; for (let k = 2; k < out.length; k += 2) if (Math.hypot(out[k] - o2[o2.length - 2], out[k + 1] - o2[o2.length - 1]) > 0.05) o2.push(out[k], out[k + 1]);
  return o2;
}
