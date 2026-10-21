// Plots: every city block (the faces of the road graph) is cut into Lagos standard plots, 18 m frontage by
// 36 m depth, aligned to the block. Buildings belong to the plot under their centroid. Empty plots are land
// you can buy; built plots get compound walls and a gate where the plot meets the street.
import { hash, obb, pointInPoly, polyArea } from './geo';
import { BK, type Block, type Building, type Region } from './region';

export interface Plot {
  id: string; pts: number[]; cx: number; cz: number; area: number;
  buildings: Building[]; zone: 'residential' | 'commercial' | 'industrial' | 'vacant' | 'institution' | 'unfinished';
  rich: number; // 0 poor .. 1 rich (drives walls, gates, compound paving and price)
}

function clipConvex(subject: number[][], clip: number[][]): number[][] {
  let out = subject;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const inside = (p: number[]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const inter = (p: number[], q: number[]) => {
      const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1], x3 = a[0], y3 = a[1], x4 = b[0], y4 = b[1];
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4); if (Math.abs(den) < 1e-9) return p;
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den; return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };
    const inp = out; out = [];
    if (!inp.length) break;
    let s = inp[inp.length - 1];
    for (const e of inp) {
      if (inside(e)) { if (!inside(s)) out.push(inter(s, e)); out.push(e); }
      else if (inside(s)) out.push(inter(s, e));
      s = e;
    }
  }
  return out;
}

export function plotsForBlock(bl: Block, key: string): Plot[] {
  const p = bl.pts; const n = p.length / 2; if (n < 3) return [];
  const A = Math.abs(polyArea(p)); if (A < 120) return [];
  const o = obb(p); const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
  // block in its own frame
  let poly: number[][] = [];
  for (let k = 0; k < n; k++) { const x = p[k * 2] - o.cx, z = p[k * 2 + 1] - o.cz; poly.push([x * ca + z * sa, -x * sa + z * ca]); }
  if (polyArea(poly.flat()) < 0) poly = poly.reverse();
  // plots run 18 m along the long axis, two rows of 36 m deep back to back (or one row if the block is thin)
  const FW = 18, FD = 36;
  const rows = Math.max(1, Math.round((o.hw * 2) / FD));
  const depth = (o.hw * 2) / rows;
  const cols = Math.max(1, Math.round((o.hl * 2) / FW));
  const width = (o.hl * 2) / cols;
  const out: Plot[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x0 = -o.hl + i * width, z0 = -o.hw + j * depth;
    const cell = [[x0, z0], [x0 + width, z0], [x0 + width, z0 + depth], [x0, z0 + depth]];
    // Sutherland-Hodgman needs a convex clipper: the cell. Clip the (maybe concave) block against it.
    const part = clipConvex(poly, cell);
    if (part.length < 3) continue;
    const a = Math.abs(polyArea(part.flat()));
    if (a < 90) continue;
    const world: number[] = [];
    for (const [x, z] of part) world.push(o.cx + x * ca - z * sa, o.cz + x * sa + z * ca);
    let cx = 0, cz = 0; for (let k = 0; k < world.length / 2; k++) { cx += world[k * 2]; cz += world[k * 2 + 1]; } cx /= world.length / 2; cz /= world.length / 2;
    out.push({ id: `${key}:${i}:${j}`, pts: world, cx, cz, area: a, buildings: [], zone: 'vacant', rich: 0 });
  }
  return out;
}

export function plotsForRegion(r: Region): Plot[] {
  const all: Plot[] = [];
  r.blocks.forEach((b, k) => { for (const pl of plotsForBlock(b, `${r.i}.${r.j}.${k}`)) all.push(pl); });
  // assign buildings with a coarse grid
  const C = 60; const grid = new Map<string, Plot[]>();
  for (const pl of all) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < pl.pts.length / 2; k++) { x0 = Math.min(x0, pl.pts[k * 2]); x1 = Math.max(x1, pl.pts[k * 2]); z0 = Math.min(z0, pl.pts[k * 2 + 1]); z1 = Math.max(z1, pl.pts[k * 2 + 1]); }
    for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) { const k = `${i},${j}`; if (!grid.has(k)) grid.set(k, []); grid.get(k)!.push(pl); }
  }
  for (const b of r.buildings) {
    const list = grid.get(`${Math.floor(b.cx / C)},${Math.floor(b.cz / C)}`); if (!list) continue;
    for (const pl of list) if (pointInPoly(b.cx, b.cz, pl.pts)) { pl.buildings.push(b); break; }
  }
  for (const pl of all) {
    if (!pl.buildings.length) { pl.zone = 'vacant'; continue; }
    const k = pl.buildings.map((b) => b.kind);
    if (k.includes(BK.warehouse)) pl.zone = 'industrial';
    else if (k.includes(BK.shops) || k.includes(BK.hotel)) pl.zone = 'commercial';
    else if (k.includes(BK.institution) || k.includes(BK.church) || k.includes(BK.mosque)) pl.zone = 'institution';
    else if (k.every((x) => x === BK.unfinished)) pl.zone = 'unfinished';
    else pl.zone = 'residential';
    const built = pl.buildings.reduce((s, b) => s + b.area, 0);
    const big = Math.max(...pl.buildings.map((b) => b.area));
    pl.rich = Math.min(1, (big > 220 ? 0.45 : 0.1) + (pl.buildings.length <= 2 ? 0.25 : 0) + (built / pl.area < 0.45 ? 0.15 : 0) + hash(pl.buildings[0].id, 9) * 0.25);
  }
  return all;
}

/** Asking price in naira. Ikeja side and the expressway frontage cost more; Sango side less. */
export function plotPrice(pl: Plot, worldX: number, worldZ: number) {
  const distOshodi = Math.hypot(worldX, worldZ) / 1000; // km from the origin at Oshodi
  const base = 26_000_000 * Math.exp(-distOshodi / 14) + 4_500_000;
  const size = pl.area / 648;
  const built = pl.zone === 'vacant' ? 1 : pl.zone === 'unfinished' ? 1.35 : 2.2 + pl.rich * 2.5;
  return Math.round((base * size * built) / 50_000) * 50_000;
}
