// A* over the city's waypoint graph, with a spatial hash for nearest-node lookups.
import type { City, NavNode } from '../world/cityGen';
import type { Vec3 } from './types';

export class Nav {
  nodes: NavNode[];
  edges: number[][];
  private grid = new Map<string, number[]>();
  private cell = 16;
  constructor(city: City) {
    this.nodes = city.nav.nodes;
    this.edges = city.nav.edges;
    for (const n of this.nodes) {
      if (!this.edges[n.id].length) continue;
      const k = this.key(n.p[0], n.p[2]);
      (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(n.id);
    }
  }
  private key(x: number, z: number) { return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; }

  /** Nearest node; with a visibility test, the nearest one we can actually walk to in a straight line. */
  nearestVisible(p: Vec3, visible: (a: Vec3, b: Vec3) => boolean, maxR = 32): number {
    const cands: [number, number][] = [];
    const cx = Math.floor(p.x / this.cell), cz = Math.floor(p.z / this.cell), r = Math.ceil(maxR / this.cell);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      for (const id of this.grid.get(`${cx + dx},${cz + dz}`) ?? []) {
        const n = this.nodes[id].p;
        cands.push([Math.hypot(n[0] - p.x, n[2] - p.z) + Math.abs(n[1] - p.y) * 3, id]);
      }
    }
    cands.sort((a, b) => a[0] - b[0]);
    const eye = { x: p.x, y: p.y + 0.9, z: p.z };
    for (const [, id] of cands.slice(0, 8)) { const n = this.nodes[id].p; if (visible(eye, { x: n[0], y: n[1] + 0.9, z: n[2] })) return id; }
    return cands.length ? cands[0][1] : this.nearest(p, maxR * 3);
  }

  nearest(p: Vec3, maxR = 48): number {
    let best = -1, bd = 1e9;
    const cx = Math.floor(p.x / this.cell), cz = Math.floor(p.z / this.cell), r = Math.ceil(maxR / this.cell);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const ids = this.grid.get(`${cx + dx},${cz + dz}`);
      if (!ids) continue;
      for (const id of ids) {
        const n = this.nodes[id].p;
        // vertical distance counts triple so we prefer the node on our own floor
        const d = Math.hypot(n[0] - p.x, n[2] - p.z) + Math.abs(n[1] - p.y) * 3;
        if (d < bd) { bd = d; best = id; }
      }
    }
    return best;
  }

  path(from: number, to: number, maxIter = 6000): number[] {
    if (from < 0 || to < 0) return [];
    if (from === to) return [to];
    const N = this.nodes;
    const h = (a: number) => { const p = N[a].p, q = N[to].p; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
    const g = new Map<number, number>([[from, 0]]);
    const came = new Map<number, number>();
    const open: [number, number][] = [[h(from), from]];
    const closed = new Set<number>();
    let it = 0;
    while (open.length && it++ < maxIter) {
      // small binary-heap-free pop: fine for graphs of a few thousand nodes
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      if (cur === to) {
        const out = [cur]; let c = cur;
        while (came.has(c)) { c = came.get(c)!; out.push(c); }
        return out.reverse();
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      const gc = g.get(cur)!;
      for (const nb of this.edges[cur]) {
        if (closed.has(nb)) continue;
        const p = N[cur].p, q = N[nb].p;
        const ng = gc + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        if (ng < (g.get(nb) ?? Infinity)) { g.set(nb, ng); came.set(nb, cur); open.push([ng + h(nb), nb]); }
      }
    }
    return [];
  }

  pos(id: number): Vec3 { const p = this.nodes[id].p; return { x: p[0], y: p[1], z: p[2] }; }
  randomNode(rnd: () => number, filter?: (n: NavNode) => boolean) {
    for (let i = 0; i < 200; i++) { const n = this.nodes[Math.floor(rnd() * this.nodes.length)]; if (this.edges[n.id].length && (!filter || filter(n))) return n.id; }
    return 0;
  }
}
