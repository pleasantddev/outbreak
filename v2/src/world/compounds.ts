// Compound walls and gates. Most Lagos houses sit behind a block wall with a metal gate onto the street.
import * as THREE from 'three';
import { Geo, hash, pointInPoly, slice } from './geo';
import type { Plot } from './plots';
import type { Building } from './region';
import { BK } from './region';
import { RoadClear, wallable } from './declutter';

const GATE_COLORS: [number, number, number][] = [[0.06, 0.06, 0.07], [0.1, 0.22, 0.45], [0.45, 0.08, 0.06], [0.08, 0.3, 0.15], [0.55, 0.55, 0.57], [0.3, 0.2, 0.1]];
const WALL_PAINT: [number, number, number][] = [[0.95, 0.92, 0.84], [0.93, 0.85, 0.7], [0.82, 0.86, 0.9], [0.9, 0.88, 0.86], [0.78, 0.85, 0.74]];

/** Which parcels a real Lagos compound wall surrounds: residential houses and flats with some money, estates and institutions. Never shops, markets, stations, terminals or sheds. */
export function walledPlot(pl: Plot) {
  const bs = pl.buildings.filter((b) => !b.dead);
  if (!bs.length) return false;
  if (pl.zone === 'vacant' || pl.zone === 'industrial' || pl.zone === 'commercial') return false;
  if (bs.some((b) => b.kind === BK.shops || b.kind === BK.market || b.kind === BK.station || b.kind === BK.terminal || b.kind === BK.canopy || b.kind === BK.stand || b.kind === BK.shed || b.kind === BK.warehouse || b.kind === BK.bank)) return false;
  const r = hash(bs[0].id, 21);
  if (pl.zone === 'institution') return pl.area < 40000 && r < 0.75;
  if (pl.area > 60000) return false;
  if (pl.zone === 'unfinished') return pl.rich >= 0.3 && r < 0.6;
  // residential: houses and flats of people with some money; poorer compounds are open yards
  return pl.rich >= 0.4 && bs.some((b) => wallable(b.kind) || b.kind === BK.church || b.kind === BK.mosque || b.kind === BK.institution);
}

export interface WallSeg { ax: number; az: number; bx: number; bz: number; h: number }

export interface CompoundOut { geo: THREE.BufferGeometry | null; segs: WallSeg[]; gates: { x: number; z: number; ang: number; inn: number; w: number; c: [number, number, number]; h: number }[] }
export function buildCompounds(plots: Plot[], near: (x: number, z: number) => Building[], rc: RoadClear, ox: number, oz: number): CompoundOut { const g = buildCompoundsG(plots, near, rc, ox, oz); for (;;) { const r = g.next(); if (r.done) return r.value; } }
export function* buildCompoundsG(plots: Plot[], near: (x: number, z: number) => Building[], rc: RoadClear, ox: number, oz: number): Generator<void, CompoundOut, void> {
  const G = new Geo({ aMat: 1, aTint: 3, aInfo: 4, aEdge: 2 });
  const segs: WallSeg[] = [];
  const gates: { x: number; z: number; ang: number; inn: number; w: number; c: [number, number, number]; h: number }[] = [];
  for (const pl of plots) {
    if (slice.due()) yield;
    if (!walledPlot(pl)) continue;
    const r = hash(pl.buildings[0]?.id ?? 1, 21);
    const h = 1.9 + pl.rich * 0.7;
    const bare = pl.rich < 0.5 && hash(pl.buildings[0]?.id ?? 2, 22) < 0.4;
    const mat = bare ? 3 : 2;
    const tint = bare ? [1, 1, 1] : WALL_PAINT[Math.floor(hash(pl.buildings[0]?.id ?? 3, 23) * WALL_PAINT.length)];
    const n = pl.pts.length / 2;
    // inset the wall line 0.15 m into the plot
    let cx = pl.cx, cz = pl.cz;
    const P = (k: number) => { const x = pl.pts[(k % n) * 2], z = pl.pts[(k % n) * 2 + 1]; const dx = cx - x, dz = cz - z, l = Math.hypot(dx, dz) || 1; return [x + (dx / l) * 0.15, z + (dz / l) * 0.15]; };
    // only buildings whose box touches the plot's box can block one of its walls (the old list was everything within 60 m)
    let px0 = Infinity, px1 = -Infinity, pz0 = Infinity, pz1 = -Infinity;
    for (let k = 0; k < n; k++) { const x = pl.pts[k * 2], z = pl.pts[k * 2 + 1]; if (x < px0) px0 = x; if (x > px1) px1 = x; if (z < pz0) pz0 = z; if (z > pz1) pz1 = z; }
    const blds: Building[] = [];
    for (const b of near(pl.cx, pl.cz)) {
      let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
      for (let k = 0; k < b.pts.length; k += 2) { const x = b.pts[k], z = b.pts[k + 1]; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z; }
      if (bx1 >= px0 - 1 && bx0 <= px1 + 1 && bz1 >= pz0 - 1 && bz0 <= pz1 + 1) blds.push(b);
    }
    // the gate faces the nearest road: the edge whose closest point to a road is nearest, and on that edge the spot closest to the road
    let gateEdge = -1, gd = 1e9, gatePos = 0;
    for (let k = 0; k < n; k++) {
      const [ax, az] = P(k), [bx, bz] = P(k + 1); const L = Math.hypot(bx - ax, bz - az); if (L < 4.5) continue;
      for (let s = L * 0.15; s <= L * 0.85; s += Math.max(0.8, L / 24)) { const d = rc.dist(ax + ((bx - ax) * s) / L, az + ((bz - az) * s) / L); if (d < gd) { gd = d; gateEdge = k; gatePos = s; } }
    }
    if (gd > 16) gateEdge = -1;
    for (let k = 0; k < n; k++) {
      if (slice.due()) yield;
      const [ax, az] = P(k), [bx, bz] = P(k + 1);
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      const gateAt = k === gateEdge ? gatePos : -99;
      const gw = 3.4 + pl.rich * 1.4;
      // walk the edge in 0.6 m steps, cut where a building or the gate is
      let s0 = -1;
      const emit = (sa: number, sb: number) => {
        if (sb - sa < 0.4) return;
        const x0 = ax + tx * sa, z0 = az + tz * sa, x1 = ax + tx * sb, z1 = az + tz * sb;
        segs.push({ ax: x0, az: z0, bx: x1, bz: z1, h });
        const nx = -tz * 0.1, nz = tx * 0.1;
        // both faces + cap
        for (const side of [1, -1]) {
          const ox2 = nx * side, oz2 = nz * side; const nn: [number, number, number] = [-tz * side, 0, tx * side];
          const a = G.v([x0 + ox2 - ox, 0, z0 + oz2 - oz], nn, [sa, 0], { aMat: [mat], aTint: tint, aInfo: [0, 0, 0, 5], aEdge: [L, h] });
          const b = G.v([x1 + ox2 - ox, 0, z1 + oz2 - oz], nn, [sb, 0], { aMat: [mat], aTint: tint, aInfo: [0, 0, 0, 5], aEdge: [L, h] });
          const c = G.v([x1 + ox2 - ox, h, z1 + oz2 - oz], nn, [sb, h], { aMat: [mat], aTint: tint, aInfo: [0, 0, 0, 5], aEdge: [L, h] });
          const d = G.v([x0 + ox2 - ox, h, z0 + oz2 - oz], nn, [sa, h], { aMat: [mat], aTint: tint, aInfo: [0, 0, 0, 5], aEdge: [L, h] });
          if (side > 0) { G.tri(a, c, b); G.tri(a, d, c); } else { G.tri(a, b, c); G.tri(a, c, d); }
        }
        const t1 = G.v([x0 + nx - ox, h, z0 + nz - oz], [0, 1, 0], [sa, 0], { aMat: [5], aTint: [0.8, 0.8, 0.78], aInfo: [0, 0, 0, 2], aEdge: [L, h] });
        const t2 = G.v([x1 + nx - ox, h, z1 + nz - oz], [0, 1, 0], [sb, 0], { aMat: [5], aTint: [0.8, 0.8, 0.78], aInfo: [0, 0, 0, 2], aEdge: [L, h] });
        const t3 = G.v([x1 - nx - ox, h, z1 - nz - oz], [0, 1, 0], [sb, 0.2], { aMat: [5], aTint: [0.8, 0.8, 0.78], aInfo: [0, 0, 0, 2], aEdge: [L, h] });
        const t4 = G.v([x0 - nx - ox, h, z0 - nz - oz], [0, 1, 0], [sa, 0.2], { aMat: [5], aTint: [0.8, 0.8, 0.78], aInfo: [0, 0, 0, 2], aEdge: [L, h] });
        G.tri(t1, t3, t2); G.tri(t1, t4, t3);
      };
      for (let s = 0; s <= L + 0.001; s += 0.6) {
        const x = ax + tx * s, z = az + tz * s;
        let blocked = Math.abs(s - gateAt) < gw / 2 || rc.room(x, z, 'wall') < 0;
        if (!blocked) for (const b of blds) { if (pointInPoly(x, z, b.pts)) { blocked = true; break; } }
        if (!blocked && s0 < 0) s0 = s;
        if (blocked && s0 >= 0) { emit(s0, s - 0.3); s0 = -1; }
      }
      if (s0 >= 0) emit(s0, L);
      if (gateAt > 0 && gateAt - gw / 2 > 0 && gateAt + gw / 2 < L && rc.room(ax + tx * gateAt, az + tz * gateAt, 'wall') > -0.5) {
        gates.push({ x: ax + tx * gateAt, z: az + tz * gateAt, ang: Math.atan2(tz, tx), inn: ((cx - (ax + tx * gateAt)) * -tz + (cz - (az + tz * gateAt)) * tx) >= 0 ? 1 : -1, w: gw, c: GATE_COLORS[Math.floor(hash(pl.cx * 7 + pl.cz * 3, 8) * GATE_COLORS.length)], h: h + 0.2 });
      }
    }
  }
  // gates stand open: two leaves swung back against the inside of the wall, painted with vertical bars by the facade shader (aInfo.w = 4)
  for (const g of gates) {
    const c = Math.cos(g.ang), s = Math.sin(g.ang); const half = g.w / 2; const nx = -s * g.inn, nz = c * g.inn; // inward normal
    for (const side of [-1, 1]) {
      const hx = g.x + c * half * side - ox, hz = g.z + s * half * side - oz; // hinge at the end of the opening
      const ex = hx - c * side * (g.w * 0.46) + nx * 0.28, ez = hz - s * side * (g.w * 0.46) + nz * 0.28; // leaf folded back along the wall, 0.28 m inside
      for (const face of [1, -1]) {
        const nn: [number, number, number] = [nx * face, 0, nz * face];
        const a = G.v([hx + nx * 0.28, 0.05, hz + nz * 0.28], nn, [0, 0], { aMat: [5], aTint: g.c, aInfo: [0, 0, 0, 4], aEdge: [g.w / 2, g.h] });
        const b = G.v([ex, 0.05, ez], nn, [g.w / 2, 0], { aMat: [5], aTint: g.c, aInfo: [0, 0, 0, 4], aEdge: [g.w / 2, g.h] });
        const cc = G.v([ex, g.h, ez], nn, [g.w / 2, g.h], { aMat: [5], aTint: g.c, aInfo: [0, 0, 0, 4], aEdge: [g.w / 2, g.h] });
        const d = G.v([hx + nx * 0.28, g.h, hz + nz * 0.28], nn, [0, g.h], { aMat: [5], aTint: g.c, aInfo: [0, 0, 0, 4], aEdge: [g.w / 2, g.h] });
        if (face > 0) { G.tri(a, cc, b); G.tri(a, d, cc); } else { G.tri(a, b, cc); G.tri(a, cc, d); }
      }
    }
  }
  return { geo: G.count ? G.build() : null, segs, gates };
}
export const _three = THREE;
