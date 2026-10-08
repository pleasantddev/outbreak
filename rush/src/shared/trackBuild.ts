// The race designer overlay: turns hand-placed waypoints into a race track by routing over the real road graph
// from OpenStreetMap, then smoothing, widening and dressing the route for racing. Designers add connectors where
// the real network has no turn (a U-turn through the median, a cut through a bus park), and place ramps.
// Shared so the GIS tool, the server and the tests all build identical tracks.
import type { WorldData, GraphEdge, GraphNode, RoadClass } from './world';
import { ROAD_COST } from './world';
import type { TrackData, TrackPath, Ramp, PickupRow, BoostPad, GridSlot } from './track';
import { Track } from './track';
import { clamp, lerp, distSegment2 } from './math';

export type XZ = [number, number];
/** A hand-authored connector between two roads. `via` points bend it (for a U-turn bulb, say). */
export interface TrackLink { a: XZ; b: XZ; via?: XZ[]; w?: number; roadA?: number; roadB?: number }
export interface TrackRampDef { at: XZ; side?: 'full' | 'left' | 'right'; h?: number; len?: number }
export interface TrackShortcutDef { name: string; route: XZ[]; hw?: number }
export interface TrackBoostDef { at: XZ; side?: 'left' | 'right' }
export interface TrackHazardDef { at: XZ; kind?: 'pothole' | 'purewater' }
export interface TrackDef {
  id: string; name: string; tagline: string; district: string; laps: number;
  /** Waypoints in driving order. Each snaps to the nearest road junction; the loop closes back to the first. */
  route: XZ[];
  links?: TrackLink[];
  /** Start line position. The grid forms behind it. */
  start: XZ;
  hw?: [number, number];
  widthScale?: number;
  cornerR?: number;
  shortcuts?: TrackShortcutDef[];
  ramps?: TrackRampDef[];
  autoRamps?: number;
  pickupRows?: number;
  brtLanes?: number;
  /** Designer placed pickup rows. When given they replace the automatic rows. */
  pickups?: XZ[];
  /** Designer placed BRT boost strips. When given they replace the automatic ones. */
  boosts?: TrackBoostDef[];
  /** Potholes and spills left in the road for the whole race. */
  hazards?: TrackHazardDef[];
  /** Designer placed checkpoints. When given they replace the evenly spaced ones. */
  checkpoints?: XZ[];
  /** Stretches closed to civilian traffic, each from one point to another in driving order. */
  noTraffic?: [XZ, XZ][];
  avoid?: number[];
  reverse?: boolean;
  base?: string;
}

interface Pt { x: number; z: number; y: number; w: number; f: number } // f: traffic flow, 1 with the race, -1 oncoming, 0 two way, 2 none
interface G { nodes: Map<number, GraphNode>; edges: (GraphEdge | null)[]; nextId: number; linkW: Map<number, number> }

const SAMPLE = 2; // metres between centreline samples

// ------------------------------------------------------------------------------------------- graph helpers

function cloneGraph(world: WorldData): G {
  const nodes = new Map<number, GraphNode>();
  for (const n of world.graph.nodes) nodes.set(n.id, { ...n, edges: [...n.edges] });
  const edges: (GraphEdge | null)[] = world.graph.edges.map((e) => ({ ...e, pts: e.pts.map((p) => [p[0], p[1], p[2] ?? 0]) }));
  return { nodes, edges, nextId: -1, linkW: new Map() };
}

const polyLen = (pts: number[][]) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };

/** Split the nearest drivable edge at a point and return the node there (or an existing node within 3 m). */
function splitAt(g: G, x: number, z: number, road?: number): { node: number; dist: number } {
  let best = { e: -1, k: 0, t: 0, d2: Infinity };
  g.edges.forEach((e, ei) => {
    if (!e || e.cls === 'path' || (road !== undefined && e.road !== road)) return;
    for (let k = 0; k < e.pts.length - 1; k++) {
      const r = distSegment2(x, z, e.pts[k][0], e.pts[k][1], e.pts[k + 1][0], e.pts[k + 1][1]);
      if (r.d2 < best.d2) best = { e: ei, k, t: r.t, d2: r.d2 };
    }
  });
  if (best.e < 0) throw new Error(`no road near ${x}, ${z}`);
  const e = g.edges[best.e]!;
  const a = e.pts[best.k], b = e.pts[best.k + 1];
  const px = lerp(a[0], b[0], best.t), pz = lerp(a[1], b[1], best.t), py = lerp(a[2], b[2], best.t);
  const na = g.nodes.get(e.a)!, nb = g.nodes.get(e.b)!;
  if (Math.hypot(na.x - px, na.z - pz) < 3) return { node: na.id, dist: Math.sqrt(best.d2) };
  if (Math.hypot(nb.x - px, nb.z - pz) < 3) return { node: nb.id, dist: Math.sqrt(best.d2) };
  const id = g.nextId--;
  const n: GraphNode = { id, x: px, z: pz, y: py, edges: [] };
  g.nodes.set(id, n);
  const p1 = [...e.pts.slice(0, best.k + 1), [px, pz, py]];
  const p2 = [[px, pz, py], ...e.pts.slice(best.k + 1)];
  const e1: GraphEdge = { ...e, id: g.edges.length, b: id, pts: p1, len: polyLen(p1) };
  const e2: GraphEdge = { ...e, id: g.edges.length + 1, a: id, pts: p2, len: polyLen(p2) };
  g.edges.push(e1, e2);
  g.edges[best.e] = null;
  na.edges = na.edges.filter((q) => q !== e.id).concat(e1.id);
  nb.edges = nb.edges.filter((q) => q !== e.id).concat(e2.id);
  n.edges.push(e1.id, e2.id);
  return { node: id, dist: Math.sqrt(best.d2) };
}

function addLink(g: G, link: TrackLink, warnings: string[]) {
  const A = splitAt(g, link.a[0], link.a[1], link.roadA);
  const B = splitAt(g, link.b[0], link.b[1], link.roadB);
  if (A.dist > 8) warnings.push(`link start ${link.a} is ${A.dist.toFixed(1)} m from a road`);
  if (B.dist > 8) warnings.push(`link end ${link.b} is ${B.dist.toFixed(1)} m from a road`);
  const na = g.nodes.get(A.node)!, nb = g.nodes.get(B.node)!;
  const raw = [[na.x, na.z], ...(link.via ?? []), [nb.x, nb.z]];
  const L = polyLen(raw);
  let acc = 0;
  const pts = raw.map((p, i) => { if (i > 0) acc += Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]); return [p[0], p[1], lerp(na.y, nb.y, L > 0 ? acc / L : 0)]; });
  const e: GraphEdge = { id: g.edges.length, a: na.id, b: nb.id, road: -1 - g.edges.length, len: L, cls: 'link', oneway: false, bridge: false, pts };
  g.edges.push(e);
  na.edges.push(e.id); nb.edges.push(e.id);
  g.linkW.set(e.road, link.w ?? 13);
}

function snapNode(g: G, x: number, z: number) {
  let best: GraphNode | null = null, bd = Infinity;
  for (const n of g.nodes.values()) {
    if (!n.edges.some((ei) => { const e = g.edges[ei]; return e && e.cls !== 'path'; })) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) { bd = d; best = n; }
  }
  return { node: best!, dist: bd };
}

// directed edge states: edgeId * 2 + (0 forward a->b, 1 backward)
const startNode = (g: G, s: number) => { const e = g.edges[s >> 1]!; return s & 1 ? e.b : e.a; };
const endNode = (g: G, s: number) => { const e = g.edges[s >> 1]!; return s & 1 ? e.a : e.b; };
function orientedPts(g: G, s: number) { const p = g.edges[s >> 1]!.pts; return s & 1 ? [...p].reverse() : p; }
function dirAt(pts: number[][], atEnd: boolean) {
  // direction over the first or last ~10 m so tiny segments at junctions do not decide the turn angle
  let acc = 0;
  if (!atEnd) {
    for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc >= 10 || i === pts.length - 1) { const dx = pts[i][0] - pts[0][0], dz = pts[i][1] - pts[0][1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; } }
  } else {
    const n = pts.length - 1;
    for (let i = n - 1; i >= 0; i--) { acc += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (acc >= 10 || i === 0) { const dx = pts[n][0] - pts[i][0], dz = pts[n][1] - pts[i][1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; } }
  }
  return [0, 1];
}
function turnCost(a: number[], b: number[]) {
  const th = Math.acos(clamp(a[0] * b[0] + a[1] * b[1], -1, 1));
  if (th <= 0.35) return 0;
  if (th <= 1.0) return (th - 0.35) * 25;
  if (th <= 1.75) return 16 + (th - 1.0) * 60;
  if (th <= 2.4) return 61 + (th - 1.75) * 400;
  return 3000;
}

class Heap {
  private k: number[] = []; private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v; k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
  }
  pop(): [number, number] {
    const k = this.k, v = this.v; const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv; let i = 0;
      for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; }
    }
    return top;
  }
}

function routeLeg(g: G, from: number, to: number, inState: number, used: Set<number>, avoid: Set<number>, allowed: (c: RoadClass) => boolean): number[] | null {
  if (from === to) return [];
  const dirCache = new Map<number, number[][]>();
  const dirs = (s: number) => { let d = dirCache.get(s); if (!d) { const p = orientedPts(g, s); d = [dirAt(p, false), dirAt(p, true)]; dirCache.set(s, d); } return d; };
  const edgeCost = (s: number) => {
    const e = g.edges[s >> 1]!;
    let c = e.len * ROAD_COST[e.cls];
    if (e.road < 0) c *= 0.5;
    if (e.oneway && s & 1) c *= 1.4;
    if (used.has(e.id)) c += e.len * 10 + 200;
    if (avoid.has(e.road)) c += 1e7;
    return c;
  };
  const dist = new Map<number, number>(), prev = new Map<number, number>();
  const heap = new Heap();
  const START = -2;
  const expand = (node: number, fromState: number, base: number, marker: number) => {
    for (const ei of g.nodes.get(node)!.edges) {
      const e = g.edges[ei];
      if (!e || !allowed(e.cls)) continue;
      for (const dir of [0, 1]) {
        const s = ei * 2 + dir;
        if (startNode(g, s) !== node) continue;
        if (fromState >= 0 && (s ^ 1) === fromState) continue;
        const c = base + edgeCost(s) + (fromState >= 0 ? turnCost(dirs(fromState)[1], dirs(s)[0]) : 0);
        if (c < (dist.get(s) ?? Infinity)) { dist.set(s, c); prev.set(s, marker); heap.push(c, s); }
      }
    }
  };
  expand(from, inState, 0, START);
  let pops = 0;
  while (heap.size && pops++ < 400000) {
    const [c, s] = heap.pop();
    if (c > (dist.get(s) ?? Infinity)) continue;
    if (endNode(g, s) === to) {
      const out = [s];
      let p = prev.get(s)!;
      while (p !== START) { out.push(p); p = prev.get(p)!; }
      return out.reverse();
    }
    expand(endNode(g, s), s, c, s);
  }
  return null;
}

// ------------------------------------------------------------------------------------------- polyline shaping

function despike(pts: Pt[], closed: boolean) {
  let changed = true;
  while (changed && pts.length > 4) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      if (!closed && (i === 0 || i === pts.length - 1)) continue;
      const a = pts[(i - 1 + pts.length) % pts.length], p = pts[i], b = pts[(i + 1) % pts.length];
      const ux = p.x - a.x, uz = p.z - a.z, vx = b.x - p.x, vz = b.z - p.z;
      const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
      if (lu < 0.3 || lv < 0.05 || (ux * vx + uz * vz) / (lu * lv) < -0.94) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}

function rdp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    let md = 0, mi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const r = distSegment2(pts[i].x, pts[i].z, pts[i0].x, pts[i0].z, pts[i1].x, pts[i1].z);
      const dyErr = Math.abs(pts[i].y - lerp(pts[i0].y, pts[i1].y, r.t));
      const d = Math.max(Math.sqrt(r.d2), dyErr * 2);
      if (d > md) { md = d; mi = i; }
    }
    if (mi >= 0 && md > tol) { keep[mi] = 1; stack.push([i0, mi], [mi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Replace each corner with a circular arc. Radius shrinks where the neighbouring segments are short. */
function fillet(pts: Pt[], closed: boolean, radius: (p: Pt) => number): Pt[] {
  const n = pts.length, out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) { out.push(pts[i]); continue; }
    const a = pts[(i - 1 + n) % n], p = pts[i], b = pts[(i + 1) % n];
    const ux = p.x - a.x, uz = p.z - a.z, lu = Math.hypot(ux, uz);
    const vx = b.x - p.x, vz = b.z - p.z, lv = Math.hypot(vx, vz);
    if (lu < 1e-6 || lv < 1e-6) { out.push(p); continue; }
    const dux = ux / lu, duz = uz / lu, dvx = vx / lv, dvz = vz / lv;
    const th = Math.acos(clamp(dux * dvx + duz * dvz, -1, 1));
    if (th < 0.03) { out.push(p); continue; }
    const t = Math.min(radius(p) * Math.tan(th / 2), lu * 0.5, lv * 0.5);
    const r = t / Math.tan(th / 2);
    const p0: Pt = { x: p.x - dux * t, z: p.z - duz * t, y: lerp(p.y, a.y, t / lu), w: lerp(p.w, a.w, t / lu), f: p.f };
    const p1: Pt = { x: p.x + dvx * t, z: p.z + dvz * t, y: lerp(p.y, b.y, t / lv), w: lerp(p.w, b.w, t / lv), f: b.f };
    let nx = -duz, nz = dux;
    if ((p1.x - p0.x) * nx + (p1.z - p0.z) * nz < 0) { nx = -nx; nz = -nz; }
    const cx = p0.x + nx * r, cz = p0.z + nz * r;
    const a0 = Math.atan2(p0.z - cz, p0.x - cx);
    const a1 = Math.atan2(p1.z - cz, p1.x - cx);
    let da = a1 - a0; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    const m = Math.max(1, Math.ceil((r * Math.abs(da)) / 1.5));
    for (let k = 0; k <= m; k++) {
      const f = k / m, ang = a0 + da * f;
      out.push({ x: cx + Math.cos(ang) * r, z: cz + Math.sin(ang) * r, y: lerp(p0.y, p1.y, f), w: lerp(p0.w, p1.w, f), f: f < 0.5 ? p0.f : p1.f });
    }
  }
  return out;
}

function resample(pts: Pt[], closed: boolean, step: number): Pt[] {
  const n = pts.length, segs = closed ? n : n - 1;
  const cum = [0];
  for (let i = 0; i < segs; i++) { const j = (i + 1) % n; cum.push(cum[i] + Math.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z)); }
  const L = cum[segs];
  const count = Math.max(4, Math.round(L / step));
  const ds = L / (closed ? count : count - 1);
  const out: Pt[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = Math.min(L, k * ds);
    while (seg < segs - 1 && cum[seg + 1] < s) seg++;
    const i = seg, j = (seg + 1) % n;
    const f = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
    out.push({ x: lerp(pts[i].x, pts[j].x, f), z: lerp(pts[i].z, pts[j].z, f), y: lerp(pts[i].y, pts[j].y, f), w: lerp(pts[i].w, pts[j].w, f), f: f < 0.5 ? pts[i].f : pts[j].f });
  }
  return out;
}

function smoothXZ(pts: Pt[], closed: boolean, passes: number) {
  const n = pts.length;
  for (let p = 0; p < passes; p++) {
    const xs = pts.map((q) => q.x), zs = pts.map((q) => q.z);
    for (let i = 0; i < n; i++) {
      if (!closed && (i < 2 || i > n - 3)) continue;
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      pts[i].x = 0.25 * xs[a] + 0.5 * xs[i] + 0.25 * xs[b];
      pts[i].z = 0.25 * zs[a] + 0.5 * zs[i] + 0.25 * zs[b];
    }
  }
}

function boxBlur(v: number[], closed: boolean, radius: number, passes: number) {
  const n = v.length;
  for (let p = 0; p < passes; p++) {
    const src = v.slice();
    for (let i = 0; i < n; i++) {
      let acc = 0, cnt = 0;
      for (let k = -radius; k <= radius; k++) {
        let j = i + k;
        if (closed) j = (j + n) % n; else if (j < 0 || j >= n) continue;
        acc += src[j]; cnt++;
      }
      v[i] = acc / cnt;
    }
  }
}

/** Ease elevation: smooth it, then lengthen approaches so no slope exceeds maxGrade (bridge tops are kept). */
function shapeElevation(pts: Pt[], closed: boolean, maxGrade: number) {
  const ys = pts.map((p) => p.y);
  boxBlur(ys, closed, 8, 3);
  const n = ys.length;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < n + (closed ? n : 0); i++) { const a = (i - 1) % n, b = i % n; ys[b] = Math.max(ys[b], ys[a] - maxGrade * SAMPLE); }
    for (let i = (closed ? 2 * n : n) - 2; i >= 0; i--) { const a = (i + 1) % n, b = i % n; ys[b] = Math.max(ys[b], ys[a] - maxGrade * SAMPLE); }
  }
  boxBlur(ys, closed, 3, 2);
  pts.forEach((p, i) => { p.y = Math.max(0, ys[i]); });
}

// ------------------------------------------------------------------------------------------- the builder

export function buildTrack(world: WorldData, def: TrackDef): { data: TrackData; warnings: string[] } {
  const warnings: string[] = [];
  const g = cloneGraph(world);
  for (const l of def.links ?? []) addLink(g, l, warnings);
  const roadW = new Map(world.roads.map((r) => [r.id, r.w]));
  const widthOf = (e: GraphEdge) => (e.road < 0 ? g.linkW.get(e.road) ?? 13 : roadW.get(e.road) ?? 10);
  const avoid = new Set(def.avoid ?? []);
  const allowed = (c: RoadClass) => c !== 'path';

  const wps = def.reverse ? [...def.route].reverse() : def.route;
  const nodes = wps.map(([x, z]) => {
    const s = snapNode(g, x, z);
    if (s.dist > 25) warnings.push(`waypoint ${x}, ${z} snapped ${s.dist.toFixed(0)} m away`);
    return s.node.id;
  });

  // two passes so the turn into the first leg is judged against the final leg's direction
  let states: number[] = [];
  let lastState = -1;
  for (let pass = 0; pass < 2; pass++) {
    states = [];
    const used = new Set<number>();
    let inState = pass === 0 ? -1 : lastState;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i], b = nodes[(i + 1) % nodes.length];
      const leg = routeLeg(g, a, b, inState, used, avoid, allowed);
      if (!leg) throw new Error(`${def.id}: no route from waypoint ${i} to ${(i + 1) % nodes.length}`);
      for (const s of leg) { states.push(s); used.add(s >> 1); }
      if (leg.length) inState = leg[leg.length - 1];
    }
    lastState = states[states.length - 1];
  }
  const usedEdges = new Set(states.map((s) => s >> 1));
  if (usedEdges.size < states.length) warnings.push(`${states.length - usedEdges.size} road segments are driven twice`);

  // concatenate into one closed polyline carrying height and road width
  let pts: Pt[] = [];
  for (const s of states) {
    const e = g.edges[s >> 1]!;
    const w = widthOf(e);
    const f = e.road < 0 ? 2 : !e.oneway ? 0 : s & 1 ? -1 : 1;
    orientedPts(g, s).forEach((p, k) => { if (k === 0 && pts.length) return; pts.push({ x: p[0], z: p[1], y: p[2] ?? 0, w, f }); });
  }
  if (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 0.5) pts.pop();
  pts = despike(pts, true);
  pts = rdp([...pts, pts[0]], 0.6).slice(0, -1);
  const corner = def.cornerR;
  pts = fillet(pts, true, (p) => corner ?? clamp(p.w * 1.15, 11, 26));
  pts = resample(pts, true, SAMPLE);
  smoothXZ(pts, true, 3);
  pts = resample(pts, true, SAMPLE);
  shapeElevation(pts, true, 0.085);

  // rotate so the start line is sample 0
  let si = 0, sd = Infinity;
  pts.forEach((p, i) => { const d = Math.hypot(p.x - def.start[0], p.z - def.start[1]); if (d < sd) { sd = d; si = i; } });
  if (sd > 20) warnings.push(`start is ${sd.toFixed(0)} m from the route`);
  pts = [...pts.slice(si), ...pts.slice(0, si)];

  // corridor width
  const [hwMin, hwMax] = def.hw ?? [6, 9.5];
  const scale = def.widthScale ?? 1;
  let hw = pts.map((p) => clamp((p.w / 2) * scale, hwMin, hwMax));
  boxBlur(hw, true, 10, 2);
  hw = resolveOverlaps(pts, hw, warnings);

  const n = pts.length;
  const main: TrackPath = { pts: [], hw: hw.map((v) => +v.toFixed(2)), bank: new Array(n).fill(0), closed: true };
  for (const p of pts) main.pts.push(+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2));
  const probe = new Track(stubData(def, [main]));
  const L = probe.length;
  // a touch of banking in tight corners
  const bank = Array.from(probe.curvature, (k) => clamp(-k * 1.6, -0.05, 0.05));
  boxBlur(bank, true, 6, 2);
  main.bank = bank.map((b) => +b.toFixed(3));

  // shortcuts
  const paths: TrackPath[] = [main];
  for (const sc of def.shortcuts ?? []) {
    const b = buildShortcut(g, probe, sc, usedEdges, def.reverse ?? false, warnings);
    if (b) paths.push(b);
  }

  const track = new Track(stubData(def, paths));
  const curvAbs = (s: number) => Math.abs(track.curvatureAt(s));
  const straightFor = (s0: number, len: number, lim: number) => { for (let s = s0; s <= s0 + len; s += 4) if (curvAbs(s) > lim) return false; return true; };
  const flatFor = (s0: number, len: number) => { const y0 = track.pointAt(s0).y; for (let s = s0; s <= s0 + len; s += 6) if (Math.abs(track.pointAt(s).y - y0) > 0.8) return false; return true; };
  const wrapD = (a: number, b: number) => Math.abs(track.gap(a, b));

  // ramps: designer placed, then automatic side kickers on long flat straights
  const ramps: Ramp[] = [];
  const rampAt = (s: number, side: 'full' | 'left' | 'right', h: number, len: number) => {
    const p = track.pointAt(s);
    const r: Ramp = { s0: +(s - len).toFixed(1), s1: +s.toFixed(1), h };
    if (side === 'left') { r.d0 = +(-p.hw).toFixed(2); r.d1 = +(-p.hw * 0.08).toFixed(2); }
    if (side === 'right') { r.d0 = +(p.hw * 0.08).toFixed(2); r.d1 = +p.hw.toFixed(2); }
    ramps.push(r);
  };
  for (const r of def.ramps ?? []) {
    const s = nearestS(track, r.at[0], r.at[1]);
    rampAt(s, r.side ?? 'full', r.h ?? 1.5, r.len ?? 12);
  }
  const autoN = def.autoRamps ?? 2;
  for (let k = 0; k < autoN; k++) {
    let bestS = -1, bestScore = -Infinity;
    for (let s = 160; s < L - 60; s += 6) {
      if (ramps.some((r) => wrapD(r.s1, s) < 220)) continue;
      if (!straightFor(s - 24, 24 + 70, 0.008) || !flatFor(s - 24, 90)) continue;
      const score = -Math.abs(s / L - (k + 0.5) / autoN); // spread them round the lap
      if (score > bestScore) { bestScore = score; bestS = s; }
    }
    if (bestS > 0) rampAt(bestS, k % 2 ? 'left' : 'right', 1.35, 11);
    else warnings.push('no straight long enough for an automatic ramp');
  }
  ramps.sort((a, b) => a.s0 - b.s0);

  // pickup rows: designer placed, or on straights away from the start and the ramps
  const pickups: PickupRow[] = [];
  const rowAt = (at: number) => {
    const p = track.pointAt(at);
    const count = p.hw > 7.6 ? 5 : 4;
    const span2 = p.hw - 2.2;
    pickups.push({ s: +at.toFixed(1), d: Array.from({ length: count }, (_, i) => +(-span2 + (2 * span2 * i) / (count - 1)).toFixed(2)) });
  };
  for (const at of def.pickups ?? []) {
    const ps = nearestS(track, at[0], at[1]);
    if (ps < 40 || ps > L - 20) { warnings.push(`pickup row at ${at} is on the start straight`); continue; }
    rowAt(ps);
  }
  pickups.sort((a, b) => a.s - b.s);
  const rows = def.pickups?.length ? 0 : def.pickupRows ?? clamp(Math.round(L / 520), 3, 6);
  for (let k = 0; k < rows; k++) {
    const target = (L * (k + 0.55)) / rows, span = L / (rows * 3);
    let bestS = target, bestC = Infinity;
    for (let s = target - span; s <= target + span; s += 4) {
      const ss = (s + L) % L;
      if (ss < 120 || ss > L - 30) continue;
      if (ramps.some((r) => wrapD(r.s0 - 10, ss) < 45 || wrapD(r.s1 + 40, ss) < 50)) continue;
      const c = curvAbs(ss) + curvAbs(ss + 20) + curvAbs(ss - 20);
      if (c < bestC) { bestC = c; bestS = ss; }
    }
    rowAt(bestS);
  }

  // BRT lane boost strips along the kerb: designer placed, or on straights
  const boosts: BoostPad[] = [];
  for (const b of def.boosts ?? []) {
    const bs = nearestS(track, b.at[0], b.at[1]);
    const p = track.pointAt(bs);
    const side = b.side ? (b.side === 'left' ? -1 : 1) : Math.sign((b.at[0] - p.x) * p.rx + (b.at[1] - p.z) * p.rz) || 1;
    boosts.push({ s: +bs.toFixed(1), d: +(side * (p.hw - 2.0)).toFixed(2), len: 44, w: 3.2 });
  }
  const lanes = def.boosts?.length ? 0 : def.brtLanes ?? 2;
  for (let k = 0; k < lanes; k++) {
    let bestS = -1, bestScore = -Infinity;
    for (let s = 80; s < L - 80; s += 6) {
      if (!straightFor(s, 48, 0.006)) continue;
      if (boosts.some((b) => wrapD(b.s, s) < 300) || ramps.some((r) => wrapD(r.s1, s) < 70) || pickups.some((r) => wrapD(r.s, s + 24) < 40)) continue;
      const score = -Math.abs(s / L - (k + 0.3) / lanes);
      if (score > bestScore) { bestScore = score; bestS = s; }
    }
    if (bestS < 0) continue;
    const p = track.pointAt(bestS);
    const side = k % 2 ? -1 : 1;
    boosts.push({ s: +bestS.toFixed(1), d: +(side * (p.hw - 2.0)).toFixed(2), len: 44, w: 3.2 });
  }

  // starting grid: two staggered columns behind the line
  const grid: GridSlot[] = [];
  for (let i = 0; i < 12; i++) {
    const row = Math.floor(i / 2), col = i % 2;
    const s = L - 9 - row * 7.5 - col * 3.75;
    const p0 = track.pointAt(s);
    const d = (col === 0 ? -1 : 1) * Math.min(p0.hw * 0.42, 3.4);
    const p = track.pointAt(s, d);
    grid.push({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), h: +p.h.toFixed(4) });
  }

  // landmarks and the intro fly-through
  const landmarks: { name: string; x: number; z: number }[] = [];
  const intro: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const s = (L * i) / 6 + L * 0.04;
    const p = track.pointAt(s);
    const k = track.curvatureAt(s);
    const off = (k >= 0 ? -1 : 1) * (p.hw + 14);
    intro.push([+(p.x + p.rx * off).toFixed(1), +(p.y + 16 + (i % 2) * 8).toFixed(1), +(p.z + p.rz * off).toFixed(1), +s.toFixed(1)]);
  }
  for (const t of world.terminals) {
    const s = nearestS(track, t.centre[0], t.centre[1]);
    const p = track.pointAt(s);
    const d = Math.hypot(p.x - t.centre[0], p.z - t.centre[1]);
    if (d > 420) continue;
    landmarks.push({ name: t.name, x: t.centre[0], z: t.centre[1] });
    intro.push([+lerp(p.x, t.centre[0], 0.45).toFixed(1), +(p.y + 26).toFixed(1), +lerp(p.z, t.centre[1], 0.45).toFixed(1), +s.toFixed(1)]);
  }
  intro.sort((a, b) => a[3] - b[3]);

  // checkpoints: designer placed, or evenly spaced; then the par time from a simple speed profile
  let checkpoints: number[];
  if (def.checkpoints?.length) {
    checkpoints = def.checkpoints.map((at) => nearestS(track, at[0], at[1])).filter((cs) => cs > 20 && cs < L - 20).sort((a, b) => a - b)
      .filter((cs, i, all) => i === 0 || cs - all[i - 1] > 30).map((cs) => +cs.toFixed(1));
    if (checkpoints.length < 2) warnings.push('fewer than two checkpoints: laps can be cut');
  } else {
    const cpN = Math.max(6, Math.round(L / 260));
    checkpoints = Array.from({ length: cpN - 1 }, (_, i) => +((L * (i + 1)) / cpN).toFixed(1));
  }
  const par = parTime(track);
  let traffic = trafficSections(pts, L);
  for (const [a, b] of def.noTraffic ?? []) traffic = cutTraffic(traffic, nearestS(track, a[0], a[1]), nearestS(track, b[0], b[1]), L);

  // potholes and spills: across the road where the designer put them, kept off the kerbs
  const hazards = (def.hazards ?? []).map((h) => {
    const hs = nearestS(track, h.at[0], h.at[1]);
    const p = track.pointAt(hs);
    const d = clamp((h.at[0] - p.x) * p.rx + (h.at[1] - p.z) * p.rz, -(p.hw - 1.2), p.hw - 1.2);
    if (hs < 30 || hs > L - 30) warnings.push(`hazard at ${h.at} is on the start straight`);
    return { kind: h.kind ?? 'pothole', s: +hs.toFixed(1), d: +d.toFixed(2) };
  });

  const data: TrackData = {
    ...stubData(def, paths),
    length: +L.toFixed(1), checkpoints, pickups, ramps, boosts, grid, intro, landmarks, par, traffic,
  };
  if (hazards.length) data.hazards = hazards;
  if (def.reverse) { data.reverse = true; data.base = def.base ?? def.id.replace(/-rev$/, ''); }
  return { data, warnings };
}

function stubData(def: TrackDef, paths: TrackPath[]): TrackData {
  return {
    id: def.id, name: def.name, tagline: def.tagline, district: def.district, laps: def.laps, length: 0,
    paths, checkpoints: [], pickups: [], ramps: [], boosts: [], grid: [], intro: [], landmarks: [], surface: 'asphalt', par: 0, traffic: [],
  };
}

/** Runs of real traffic direction along the lap, from the OSM oneway tags of each road the route uses. The start
 *  straight is closed to traffic, and hand made links carry none. */
function trafficSections(pts: Pt[], L: number) {
  const n = pts.length;
  const runs: { s0: number; s1: number; flow: number }[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i * L) / n, f = pts[i].f;
    const last = runs[runs.length - 1];
    if (last && last.flow === f) last.s1 = s + L / n; else runs.push({ s0: s, s1: s + L / n, flow: f });
  }
  // absorb short slivers of real road into the run before them; hand made links (flow 2) always stay traffic free
  for (let i = runs.length - 1; i > 0; i--) if (runs[i].flow !== 2 && runs[i - 1].flow !== 2 && runs[i].s1 - runs[i].s0 < 60) { runs[i - 1].s1 = runs[i].s1; runs.splice(i, 1); }
  const merged: typeof runs = [];
  for (const r of runs) { const m = merged[merged.length - 1]; if (m && m.flow === r.flow) m.s1 = r.s1; else merged.push({ ...r }); }
  // keep vehicles clear of the links and of the start straight, and skip stretches too short to read as a road
  const out: { s0: number; s1: number; flow: -1 | 0 | 1 }[] = [];
  merged.forEach((r, i) => {
    if (r.flow === 2) return;
    const prev = merged[(i - 1 + merged.length) % merged.length], next = merged[(i + 1) % merged.length];
    const s0 = Math.max(r.s0 + (prev.flow === 2 ? 30 : 0), 70);
    const s1 = Math.min(r.s1 - (next.flow === 2 ? 30 : 0), L - 110);
    if (s1 - s0 >= 150) out.push({ s0: +s0.toFixed(1), s1: +s1.toFixed(1), flow: r.flow as -1 | 0 | 1 });
  });
  return out;
}

/** Remove the stretch from s0 to s1 (in driving order, may wrap past the line) from the traffic sections. */
function cutTraffic(secs: TrackData['traffic'], s0: number, s1: number, L: number): TrackData['traffic'] {
  const cuts = s1 >= s0 ? [[s0, s1]] : [[s0, L], [0, s1]];
  let out = secs;
  for (const [c0, c1] of cuts) {
    const next: TrackData['traffic'] = [];
    for (const t of out) {
      if (t.s1 <= c0 || t.s0 >= c1) { next.push(t); continue; }
      if (t.s0 < c0) next.push({ ...t, s1: +c0.toFixed(1) });
      if (t.s1 > c1) next.push({ ...t, s0: +c1.toFixed(1) });
    }
    out = next;
  }
  return out.filter((t) => t.s1 - t.s0 >= 150);
}

export function nearestS(track: Track, x: number, z: number) {
  const c = track.paths[0];
  let bi = 0, bd = Infinity;
  for (let i = 0; i < c.n; i++) { const d = (c.x[i] - x) ** 2 + (c.z[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } }
  return c.s[bi];
}

/** Where corridors from different parts of the lap run side by side, narrow them so a wall fits between. */
function resolveOverlaps(pts: Pt[], hw: number[], warnings: string[]) {
  const n = pts.length;
  const cap = new Array(n).fill(Infinity);
  const cell = 16, grid = new Map<string, number[]>();
  pts.forEach((p, i) => { const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  let worst = Infinity, conflicts = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const cx = Math.floor(p.x / cell), cz = Math.floor(p.z / cell);
    for (let gx = cx - 2; gx <= cx + 2; gx++) for (let gz = cz - 2; gz <= cz + 2; gz++) {
      for (const j of grid.get(`${gx},${gz}`) ?? []) {
        const along = Math.min(Math.abs(i - j), n - Math.abs(i - j)) * SAMPLE;
        if (along < 60) continue;
        if (Math.abs(p.y - pts[j].y) > 4.2) continue; // stacked: one passes over the other
        const d = Math.hypot(p.x - pts[j].x, p.z - pts[j].z);
        const need = hw[i] + hw[j] + 1.2;
        if (d < need) { cap[i] = Math.min(cap[i], (d - 1.2) / 2); worst = Math.min(worst, d); conflicts++; }
      }
    }
  }
  if (conflicts) {
    if (worst < 8) warnings.push(`corridors overlap: closest parallel pass is ${worst.toFixed(1)} m`);
    // spread each cap along the track so the width changes gently
    const out = hw.slice();
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(cap[i])) continue;
      for (let k = -40; k <= 40; k++) { const j = (i + k + n) % n; out[j] = Math.min(out[j], Math.max(3.6, cap[i]) + Math.abs(k) * 0.12); }
    }
    return out;
  }
  return hw;
}

function buildShortcut(g: G, main: Track, sc: TrackShortcutDef, mainEdges: Set<number>, reverse: boolean, warnings: string[]): TrackPath | null {
  const wps = reverse ? [...sc.route].reverse() : sc.route;
  const nodes = wps.map(([x, z]) => snapNode(g, x, z).node.id);
  const states: number[] = [];
  const used = new Set<number>([...mainEdges]);
  let inState = -1;
  for (let i = 0; i < nodes.length - 1; i++) {
    const leg = routeLeg(g, nodes[i], nodes[i + 1], inState, used, new Set(), (c) => c !== 'path');
    if (!leg) { warnings.push(`shortcut ${sc.name}: no route`); return null; }
    states.push(...leg);
    if (leg.length) inState = leg[leg.length - 1];
  }
  let pts: Pt[] = [];
  for (const s of states) orientedPts(g, s).forEach((p, k) => { if (k === 0 && pts.length) return; pts.push({ x: p[0], z: p[1], y: p[2] ?? 0, w: 8, f: 2 }); });
  pts = despike(pts, false);
  pts = rdp(pts, 0.5);
  pts = fillet(pts, false, () => 9);
  pts = resample(pts, false, SAMPLE);
  smoothXZ(pts, false, 2);
  shapeElevation(pts, false, 0.1);
  const L = main.length;
  let sA = nearestS(main, pts[0].x, pts[0].z), sB = nearestS(main, pts[pts.length - 1].x, pts[pts.length - 1].z);
  if ((((sB - sA) % L) + L) % L > L / 2) { pts.reverse(); [sA, sB] = [sB, sA]; }
  const span = (((sB - sA) % L) + L) % L;
  let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  if (len > span * 0.98) warnings.push(`shortcut ${sc.name} (${len.toFixed(0)} m) is not shorter than the road it skips (${span.toFixed(0)} m)`);
  const hw = sc.hw ?? 4.6;
  const path: TrackPath = { pts: [], hw: pts.map(() => hw), bank: pts.map(() => 0), closed: false, join: [+sA.toFixed(1), +sB.toFixed(1)] };
  for (const p of pts) path.pts.push(+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2));
  return path;
}

/** Gold lap time: a point mass at a brisk mid-tier pace through the corners. */
export function parTime(track: Track) {
  const c = track.paths[0];
  const n = c.n;
  const v = new Float64Array(n);
  // a mid range car on a clean lap (about 125 km/h flat out): starters earn bronze, gold takes a faster car
  const vmax = 34, aLat = 16, acc = 8, brk = 18;
  for (let i = 0; i < n; i++) v[i] = Math.min(vmax, Math.sqrt(aLat / Math.max(Math.abs(track.curvature[i]), 1e-4)));
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 1; k <= n; k++) { const i = k % n, h = k - 1; const ds = SAMPLE; v[i] = Math.min(v[i], Math.sqrt(v[h % n] ** 2 + 2 * acc * ds)); }
    for (let k = n - 1; k >= 0; k--) { const i = k, j = (k + 1) % n; v[i] = Math.min(v[i], Math.sqrt(v[j] ** 2 + 2 * brk * SAMPLE)); }
  }
  let t = 0;
  for (let i = 0; i < n; i++) t += (c.s[i + 1] - c.s[i]) / Math.max(4, v[i]);
  return Math.round(t * 1.02 * 10) / 10;
}
