// Merged-geometry helpers for hand-built features: boxes, prisms, ribbons, quads with vertex colours.
import { Geo } from './geo';

export type V3 = [number, number, number];
export type RGB = [number, number, number];
export type VCGeo = Geo;
/** A Geo that carries a per-vertex colour attribute (three reads attribute `color` when vertexColors is on). */
export function vcGeo() { return new Geo({ color: 3 }); }

const rot = (x: number, z: number, c: number, s: number): [number, number] => [x * c - z * s, x * s + z * c];

/** Axis-aligned-in-local-frame box, centre-bottom at (cx, y0, cz), size w (x) h (y) d (z), rotated about Y by ry. */
export function addBox(G: Geo, cx: number, y0: number, cz: number, w: number, h: number, d: number, ry: number, col: RGB, opts: { top?: RGB; noBottom?: boolean; extra?: Record<string, number[]> } = {}) {
  const c = Math.cos(ry), s = Math.sin(ry); const hw = w / 2, hd = d / 2; const y1 = y0 + h;
  const P = (lx: number, y: number, lz: number): V3 => { const [x, z] = rot(lx, lz, c, s); return [cx + x, y, cz + z]; };
  const N = (lx: number, ly: number, lz: number): V3 => { const [x, z] = rot(lx, lz, c, s); return [x, ly, z]; };
  const ex = opts.extra ?? {};
  const face = (a: V3, b: V3, cc: V3, dd: V3, n: V3, colr: RGB, uvw: number, uvh: number) => {
    const i0 = G.v(a, n, [0, 0], { color: colr, ...ex }), i1 = G.v(b, n, [uvw, 0], { color: colr, ...ex }), i2 = G.v(cc, n, [uvw, uvh], { color: colr, ...ex }), i3 = G.v(dd, n, [0, uvh], { color: colr, ...ex });
    G.tri(i0, i1, i2); G.tri(i0, i2, i3);
  };
  face(P(-hw, y0, hd), P(hw, y0, hd), P(hw, y1, hd), P(-hw, y1, hd), N(0, 0, 1), col, w, h);
  face(P(hw, y0, -hd), P(-hw, y0, -hd), P(-hw, y1, -hd), P(hw, y1, -hd), N(0, 0, -1), col, w, h);
  face(P(hw, y0, hd), P(hw, y0, -hd), P(hw, y1, -hd), P(hw, y1, hd), N(1, 0, 0), col, d, h);
  face(P(-hw, y0, -hd), P(-hw, y0, hd), P(-hw, y1, hd), P(-hw, y1, -hd), N(-1, 0, 0), col, d, h);
  face(P(-hw, y1, hd), P(hw, y1, hd), P(hw, y1, -hd), P(-hw, y1, -hd), [0, 1, 0], opts.top ?? col, w, d);
  if (!opts.noBottom) face(P(-hw, y0, -hd), P(hw, y0, -hd), P(hw, y0, hd), P(-hw, y0, hd), [0, -1, 0], col, w, d);
}

/** Vertical cylinder as an n-gon prism. */
export function addCyl(G: Geo, cx: number, y0: number, cz: number, r: number, h: number, col: RGB, n = 8, r2 = r) {
  const ring0: number[] = [], ring1: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    ring0.push(G.v([cx + ca * r, y0, cz + sa * r], [ca, 0, sa], [k / n, 0], { color: col }));
    ring1.push(G.v([cx + ca * r2, y0 + h, cz + sa * r2], [ca, 0, sa], [k / n, 1], { color: col }));
  }
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; G.tri(ring0[k], ring0[j], ring1[j]); G.tri(ring0[k], ring1[j], ring1[k]); }
  const top = G.v([cx, y0 + h, cz], [0, 1, 0], [0.5, 0.5], { color: col });
  const tr = [] as number[]; for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; tr.push(G.v([cx + Math.cos(a) * r2, y0 + h, cz + Math.sin(a) * r2], [0, 1, 0], [0.5, 0.5], { color: col })); }
  for (let k = 0; k < n; k++) G.tri(top, tr[(k + 1) % n], tr[k]);
}

/** A double-sided vertical or sloped quad from four world points (counter-clockwise seen from the front). */
export function addQuad(G: Geo, a: V3, b: V3, c: V3, d: V3, col: RGB, uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]], extra: Record<string, number[]> = {}, doubleSided = false) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const mk = (sgn: number) => [a, b, c, d].map((p, k) => G.v(p, [nx * sgn, ny * sgn, nz * sgn], uv[k], { color: col, ...extra }));
  const f = mk(1); G.tri(f[0], f[1], f[2]); G.tri(f[0], f[2], f[3]);
  if (doubleSided) { const g = mk(-1); G.tri(g[0], g[2], g[1]); G.tri(g[0], g[3], g[2]); }
}

/** Ribbon of constant width along a polyline at a given height (y per point or a constant), facing up. */
export function addRibbon(G: Geo, pts: ArrayLike<number>, width: number, y: number | ((k: number) => number), col: RGB, ox: number, oz: number, opts: { uvScale?: number; extra?: Record<string, number[]> } = {}) {
  const n = pts.length / 2; if (n < 2) return;
  const yy = (k: number) => (typeof y === 'number' ? y : y(k));
  let s = 0; const hw = width / 2; const ex = opts.extra ?? {}; const us = opts.uvScale ?? 1;
  let prevL = -1, prevR = -1;
  for (let k = 0; k < n; k++) {
    const k0 = Math.max(0, k - 1), k1 = Math.min(n - 1, k + 1);
    let tx = pts[k1 * 2] - pts[k0 * 2], tz = pts[k1 * 2 + 1] - pts[k0 * 2 + 1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    if (k > 0) s += Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
    const nx = -tz, nz = tx;
    const L = G.v([pts[k * 2] - ox + nx * hw, yy(k), pts[k * 2 + 1] - oz + nz * hw], [0, 1, 0], [0, s * us], { color: col, ...ex });
    const R = G.v([pts[k * 2] - ox - nx * hw, yy(k), pts[k * 2 + 1] - oz - nz * hw], [0, 1, 0], [1, s * us], { color: col, ...ex });
    if (prevL >= 0) { G.tri(prevL, L, R); G.tri(prevL, R, prevR); }
    prevL = L; prevR = R;
  }
}

/** Wall or panel strip standing on a polyline between y0 and y1. */
export function addWallStrip(G: Geo, pts: ArrayLike<number>, y0: number, y1: number, col: RGB, ox: number, oz: number, both = true, extra: Record<string, number[]> = {}) {
  const n = pts.length / 2; let s = 0;
  for (let k = 0; k < n - 1; k++) {
    const ax = pts[k * 2] - ox, az = pts[k * 2 + 1] - oz, bx = pts[k * 2 + 2] - ox, bz = pts[k * 2 + 3] - oz; const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
    const nx = az - bz, nz = bx - ax; const nl = Math.hypot(nx, nz) || 1;
    addQuad(G, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], col, [[s, y0], [s + L, y0], [s + L, y1], [s, y1]], extra, both);
    void nl; s += L;
  }
}

export const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
export const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
