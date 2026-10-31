// Oshodi Transport Interchange: the three real OSM terminal footprints built as six-level bus terminals, plus covered footbridges
// and the sellable billboard faces listed in data/billboards.json (written by pipe/oshodi_gen.py).
//
// Levels (metres above ground): ground bays 0 (6.4 m clear for buses), 6.4 ticketing hall and shops (glazed, footbridges land here),
// 9.6 / 12.8 / 16.0 parking floors 3 to 5, 19.2 roof parking floor 6 (the layer-3 skywalks meet it). Keep T_FLOORS and T_ROOF in step with pipe/oshodi_gen.py.
// The ground level is open (columns, painted bays, kerbs) with a union chairman's office at one end of each terminal.
// Everything fictional: the union and its boards are made up, no real brand logos, adverts are blank "book this board" plates until MyAds fills them.
import * as THREE from 'three';
import { hash, obb, pointInPoly, polyArea } from './geo';
import { addBox, addQuad, hex, mul, type RGB } from './geom';
import { Geo } from './geo';
import { ROAD, RF, type Building, type Road } from './region';
import { deckProfile } from './bridges';
import { signUV, SIGN_ASPECT } from './signs';
import BILLBOARD_DATA from '../data/billboards.json';

export const T_FLOORS = [6.4, 9.6, 12.8, 16.0];
export const T_ROOF = 19.2;
const SLAB = 0.5, BARRIER = 1.1;

export interface Billboard { id: string; x: number; y: number; z: number; yaw: number; w: number; h: number; place: string; tier: string; slots?: number; mount?: string; base?: number }
export const BILLBOARDS = BILLBOARD_DATA as Billboard[];
/** Live face meshes by billboard id, for as long as their tile is loaded. The MyAds system swaps `mesh.material` (or calls setBillboardTexture). */
export const billboardMeshes = new Map<string, THREE.Mesh>();
const overrides = new Map<string, THREE.Texture>();
/** Show an advert on a face. Applies at once if the face is loaded and to the face whenever its tile is rebuilt. Pass null to go back to the blank plate. */
export function setBillboardTexture(id: string, tex: THREE.Texture | null) {
  if (tex) overrides.set(id, tex); else overrides.delete(id);
  const m = billboardMeshes.get(id); if (m && m.parent) m.material = tex ? adMaterial(tex) : blankMaterial(BILLBOARDS.find((b) => b.id === id)!);
}

// ------------------------------------------------------------------------------------------------ materials
const mats = new Map<string, THREE.Material>();
const TIER: Record<string, [string, string, string]> = { prime: ['#1b1740', '#f2c14e', '#ffffff'], standard: ['#0d5560', '#ffffff', '#f2c14e'], bridge: ['#b5541a', '#ffffff', '#1c1c1f'] };
function blankMaterial(b: Billboard) {
  const aspect = Math.round((b.w / b.h) * 4) / 4; const key = `${b.tier}${aspect}`; let m = mats.get(key); if (m) return m;
  const W = 768, H = Math.round(W / aspect); const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!;
  const [bg, fg, acc] = TIER[b.tier] ?? TIER.standard;
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.07)'; for (let i = -H; i < W; i += 46) { g.beginPath(); g.moveTo(i, H); g.lineTo(i + H, 0); g.lineTo(i + H + 22, 0); g.lineTo(i + 22, H); g.fill(); }
  g.strokeStyle = fg; g.globalAlpha = 0.6; g.lineWidth = Math.max(4, H * 0.025); g.strokeRect(H * 0.06, H * 0.06, W - H * 0.12, H - H * 0.12); g.globalAlpha = 1;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const fs = Math.min(H * 0.26, W * 0.11); g.fillStyle = fg; g.font = `700 ${fs}px Oswald, "Arial Narrow", Arial, sans-serif`; g.fillText('YOUR ADVERT HERE', W / 2, H * 0.42);
  g.fillStyle = acc; g.font = `600 ${fs * 0.5}px Oswald, "Arial Narrow", Arial, sans-serif`; g.fillText('BOOK THIS BOARD ON MYADS', W / 2, H * 0.68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  m = adMaterial(t); mats.set(key, m); return m;
}
function adMaterial(t: THREE.Texture) { return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0, emissive: new THREE.Color(0xffffff), emissiveMap: t, emissiveIntensity: 0.22 }); }
let steel: THREE.MeshStandardMaterial | null = null;
const steelMat = () => (steel ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide }));

// ------------------------------------------------------------------------------------------------ terminals
const CAR_COLS: RGB[] = [[0.82, 0.82, 0.8], [0.12, 0.12, 0.14], [0.6, 0.12, 0.1], [0.14, 0.26, 0.5], [0.55, 0.57, 0.6], [0.9, 0.78, 0.2], [0.2, 0.38, 0.28], [0.35, 0.26, 0.2]];
const CONC: RGB = [0.66, 0.65, 0.62], CONC_D: RGB = [0.38, 0.38, 0.38], DECK: RGB = [0.3, 0.3, 0.31], GLASS: RGB = [0.27, 0.45, 0.5];

interface SignQ { cx: number; cy: number; cz: number; ang: number; w: number; h: number; uv: ReturnType<typeof signUV> }
export interface TermCtx { G: Geo; N: Geo; x0: number; z0: number; sign: (s: SignQ) => void; poles: number[]; walls: { ax: number; az: number; bx: number; bz: number; h: number }[] }

/** Fills triangle fan slab (a floor or roof deck) at height y, facing up or down. Points are tile-local. */
function slab(G: Geo, p: number[], y: number, col: RGB, up: boolean) {
  const n = p.length / 2; let cx = 0, cz = 0; for (let i = 0; i < n; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; } cx /= n; cz /= n;
  const nrm: [number, number, number] = [0, up ? 1 : -1, 0];
  const c = G.v([cx, y, cz], nrm, [cx, cz], { color: col });
  const ids: number[] = []; for (let i = 0; i < n; i++) ids.push(G.v([p[i * 2], y, p[i * 2 + 1]], nrm, [p[i * 2], p[i * 2 + 1]], { color: col }));
  for (let i = 0; i < n; i++) {
    const a = ids[i], b = ids[(i + 1) % n]; const ax = p[i * 2] - cx, az = p[i * 2 + 1] - cz, bx = p[((i + 1) % n) * 2] - cx, bz = p[((i + 1) % n) * 2 + 1] - cz;
    const ny = az * bx - ax * bz; // sign of (B-A)x(C-A).y for the triangle (c, a, b) is that of this cross
    if ((ny > 0) === up) G.tri(c, a, b); else G.tri(c, b, a);
  }
}

export function buildTerminal(b: Building, T: TermCtx) {
  const { G, N, x0, z0 } = T;
  const o = obb(b.pts); const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
  let p = Array.from(b.pts).map((v, i) => v - (i % 2 === 0 ? x0 : z0)); if (polyArea(p) < 0) { const q: number[] = []; for (let i = p.length / 2 - 1; i >= 0; i--) q.push(p[i * 2], p[i * 2 + 1]); p = q; }
  const n = p.length / 2;
  const W = (u: number, v: number): [number, number] => [o.cx + u * ca - v * sa - x0, o.cz + u * sa + v * ca - z0];
  const inside = (u: number, v: number, m = 0) => { const [x, z] = W(u, v); return pointInPoly(x + x0, z + z0, b.pts) && (m === 0 || (pointInPoly(W(u + m, v)[0] + x0, W(u + m, v)[1] + z0, b.pts) && pointInPoly(W(u - m, v)[0] + x0, W(u - m, v)[1] + z0, b.pts) && pointInPoly(W(u, v + m)[0] + x0, W(u, v + m)[1] + z0, b.pts) && pointInPoly(W(u, v - m)[0] + x0, W(u, v - m)[1] + z0, b.pts))); };
  const seed = b.id;

  // structural columns on a 10 x 9 m grid, full height
  for (let u = -o.hl + 2; u <= o.hl - 1.5; u += 10) for (let v = -o.hw + 2; v <= o.hw - 1.5; v += 9) {
    if (!inside(u, v)) continue; const [x, z] = W(u, v);
    addBox(G, x, 0, z, 1.0, 0.5, 1.0, o.ang, [0.62, 0.61, 0.58]); addBox(G, x, 0.5, z, 0.6, T_ROOF - 0.5, 0.6, o.ang, CONC_D);
    T.poles.push(x + x0, z + z0, 0.5);
    if ((Math.round(u / 10) + Math.round(v / 9)) % 2 === 0) addBox(N, x, T_FLOORS[0] - SLAB - 0.12, z, 1.8, 0.1, 0.35, o.ang, [1.0, 0.92, 0.7]); // warm strip light under the hall slab
  }
  // painted bays on the ground: yellow dividers across the long axis, along both sides and a median
  for (const lane of [-1, 0, 1]) {
    const lz0 = lane * o.hw * 0.62; for (let u = -o.hl + 4; u <= o.hl - 4; u += 3.8) {
      if (!inside(u, lz0) || !inside(u, lz0 + (lane === 0 ? 0 : 5))) continue;
      const a = W(u, lz0 - 5.5), c = W(u, lz0 + 5.5);
      addQuad(G, [a[0] - sa * 0.07, 0.04, a[1]], [c[0] - sa * 0.07, 0.04, c[1]], [c[0] + sa * 0.07, 0.04, c[1]], [a[0] + sa * 0.07, 0.04, a[1]], [0.93, 0.78, 0.12], undefined, {}, true);
    }
  }
  // floors: slab plus a facade band along the footprint edge
  const levels: { y: number; kind: 'hall' | 'park'; name: string }[] = [
    { y: T_FLOORS[0], kind: 'hall', name: '' }, { y: T_FLOORS[1], kind: 'park', name: 'P3' }, { y: T_FLOORS[2], kind: 'park', name: 'P4' }, { y: T_FLOORS[3], kind: 'park', name: 'P5' },
  ];
  const all = [...levels, { y: T_ROOF, kind: 'park' as const, name: 'P6' }];
  for (const L of all) {
    if (L.y < T_ROOF) { slab(G, p, L.y, L.kind === 'hall' ? [0.55, 0.54, 0.52] : DECK, true); slab(G, p, L.y - SLAB, CONC_D, false); }
    else { /* the roof slab itself is built by buildings.ts at T_ROOF; paint the deck over it */ slab(G, p, T_ROOF + 0.03, DECK, true); }
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1]; const len = Math.hypot(bx - ax, bz - az); if (len < 0.3) continue;
    for (const L of all) {
      if (L.y < T_ROOF) addQuad(G, [ax, L.y - SLAB, az], [bx, L.y - SLAB, bz], [bx, L.y, bz], [ax, L.y, az], CONC, undefined, {}, true); // slab edge
      if (L.kind === 'park') {
        // crash barrier / parapet along the deck edge, with a darker top rail
        addQuad(G, [ax, L.y, az], [bx, L.y, bz], [bx, L.y + BARRIER, bz], [ax, L.y + BARRIER, az], CONC, undefined, {}, true);
        addQuad(G, [ax, L.y + BARRIER, az], [bx, L.y + BARRIER, bz], [bx - (bz - az) / len * -0.2, L.y + BARRIER + 0.01, bz + (bx - ax) / len * -0.2], [ax - (bz - az) / len * -0.2, L.y + BARRIER + 0.01, az + (bx - ax) / len * -0.2], CONC_D, undefined, {}, true);
      } else {
        // ticketing hall: glazed band, with a concrete pilaster every ~5 m
        const h = T_FLOORS[1] - SLAB - L.y;
        const k = Math.max(1, Math.round(len / 5));
        for (let s = 0; s < k; s++) {
          const t0 = s / k, t1 = (s + 1) / k; const px0 = ax + (bx - ax) * t0, pz0 = az + (bz - az) * t0, px1 = ax + (bx - ax) * t1, pz1 = az + (bz - az) * t1;
          addQuad(N, [px0, L.y + 0.9, pz0], [px1, L.y + 0.9, pz1], [px1, L.y + h - 0.2, pz1], [px0, L.y + h - 0.2, pz0], [0.62, 0.62, 0.5], undefined, {}, true); // lit hall window
          addQuad(G, [px0, L.y, pz0], [px1, L.y, pz1], [px1, L.y + 0.9, pz1], [px0, L.y + 0.9, pz0], CONC, undefined, {}, true);
          addBox(G, px0, L.y, pz0, 0.35, h, 0.35, o.ang, CONC);
        }
      }
    }
  }
  // parked cars: two rows round the inside edge of every parking floor, plus a row along the middle of the roof
  for (const L of all) {
    if (L.kind !== 'park') continue;
    for (const rowv of [o.hw - 3.2, o.hw - 6.6, -(o.hw - 3.2), -(o.hw - 6.6)]) {
      for (let u = -o.hl + 5; u < o.hl - 4; u += 2.6) {
        const r = hash(Math.round(u * 7 + rowv * 13) + seed + Math.round(L.y * 10), 9); if (r > 0.62) continue;
        if (!inside(u, rowv, 2.4)) continue;
        const [x, z] = W(u, rowv); const col = CAR_COLS[Math.floor(hash(seed + Math.round(u * 3), Math.round(rowv * 3) + Math.round(L.y)) * CAR_COLS.length)];
        addBox(G, x, L.y + 0.04, z, 1.8, 1.0, 4.4, o.ang, col, { top: mul(col, 0.9) });
        addBox(G, x, L.y + 1.0, z, 1.6, 0.5, 2.3, o.ang, [0.12, 0.16, 0.2], { top: mul(col, 0.85) });
      }
    }
    // painted level number on the barrier, two per long side
    for (const sd of [-1, 1]) for (const f of [-0.32, 0.32]) {
      const [x, z] = W(f * o.hl * 2, sd * (o.hw + 0.05)); const q = L.y >= T_ROOF ? 0.6 : 0.6;
      T.sign({ cx: x, cy: L.y + q, cz: z, ang: o.ang, w: 3.6, h: 3.6 / SIGN_ASPECT, uv: signUV(`PARKING ${L.name}`, 0.35) });
    }
  }
  // stair and lift cores on the roof, at both ends of the long axis
  for (const sg of [-1, 1]) {
    const [x, z] = W(sg * (o.hl - 7), 0); if (!inside(sg * (o.hl - 7), 0, 4)) continue;
    addBox(G, x, T_ROOF, z, 7, 3.4, 7, o.ang, [0.74, 0.72, 0.66], { top: [0.4, 0.4, 0.42] });
    const [dx, dz] = W(sg * (o.hl - 7) - sg * 3.55, 0);
    addBox(G, dx, T_ROOF, dz, 0.2, 2.3, 1.8, o.ang, [0.22, 0.3, 0.26]);
  }

  // union chairman's office on the ground floor at the west end: two storeys, cream render, ACs, hand-painted boards (fictional union)
  {
    const ou = -o.hl + 11, ov = o.hw - 9.5; const ow = 13, od = 8, oh = 6.0;
    if (inside(ou, ov, 7)) {
      const [x, z] = W(ou, ov);
      addBox(G, x, 0, z, ow, oh, od, o.ang, [0.9, 0.86, 0.72], { top: [0.45, 0.45, 0.47] });
      // front faces local -v (toward the bays)
      const F = (uu: number, vv: number): [number, number] => W(ou + uu, ov - od / 2 - 0.04 + vv);
      for (const lvl of [0, 1]) for (const wx of [-4.6, -1.2, 3.2, 5.3]) { const [wx_, wz_] = F(wx, 0); addBox(G, wx_, 0.9 + lvl * 3, wz_, 2.0, 1.3, 0.1, o.ang, [0.2, 0.34, 0.4]); addBox(G, wx_, 0.8 + lvl * 3, wz_, 2.2, 0.1, 0.18, o.ang, [0.4, 0.4, 0.42]); }
      { const [dx_, dz_] = F(1.0, 0); addBox(G, dx_, 0, dz_, 1.3, 2.3, 0.14, o.ang, [0.2, 0.32, 0.22]); }
      for (const ax_ of [-3.2, 4.4]) { const [ax2, az2] = F(ax_, -0.25); addBox(G, ax2, 4.1, az2, 0.9, 0.55, 0.4, o.ang, [0.88, 0.88, 0.86]); }
      const [sx, sz] = F(0, 0.06);
      T.sign({ cx: sx, cy: 5.35, cz: sz, ang: o.ang + Math.PI, w: 6.5, h: 6.5 / SIGN_ASPECT, uv: signUV(`T${b.name?.slice(-1) ?? ''} UNION CHAIRMAN`, 0.35) });
      const [s2x, s2z] = F(-4.7, 0.06);
      T.sign({ cx: s2x, cy: 3.3, cz: s2z, ang: o.ang + Math.PI, w: 3.4, h: 3.4 / SIGN_ASPECT, uv: signUV('DRIVERS WELFARE UNION', 0.75) });
      // collision: four walls, world coordinates
      const cs: [number, number][] = [[-ow / 2, -od / 2], [ow / 2, -od / 2], [ow / 2, od / 2], [-ow / 2, od / 2]];
      for (let i = 0; i < 4; i++) { const a = W(ou + cs[i][0], ov + cs[i][1]), c = W(ou + cs[(i + 1) % 4][0], ov + cs[(i + 1) % 4][1]); T.walls.push({ ax: a[0] + x0, az: a[1] + z0, bx: c[0] + x0, bz: c[1] + z0, h: oh }); }
    }
  }
  // terminal name board over the bay mouths on both long sides
  if (b.name) {
    const label = b.name.replace('Oshodi Transport Interchange - ', 'OSHODI ').replace('Oshodi Transport Interchange', 'OSHODI INTERCHANGE'); const uv = signUV(label, 0.15); const w = Math.min(16, o.hl * 1.2);
    for (const sd of [-1, 1]) { const [x, z] = W(0, sd * (o.hw - 0.1)); T.sign({ cx: x, cy: 4.7, cz: z, ang: o.ang, w, h: w / SIGN_ASPECT, uv }); }
  }
  // fascia: dark steel band round the roof edge
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; addQuad(G, [p[i * 2], T_ROOF - 0.5, p[i * 2 + 1]], [p[j * 2], T_ROOF - 0.5, p[j * 2 + 1]], [p[j * 2], T_ROOF + 0.05, p[j * 2 + 1]], [p[i * 2], T_ROOF + 0.05, p[i * 2 + 1]], [0.3, 0.33, 0.38], undefined, {}, true); }
}

// ------------------------------------------------------------------------------------------------ footbridge covers
/** Roof and posts on the flat part of the footbridges that carry billboard faces. Side faces themselves come from billboards.json. */
export function footbridgeCovers(G: Geo, roads: Road[], x0: number, z0: number, size: number) {
  const faces = BILLBOARDS.filter((b) => b.tier === 'bridge');
  for (const r of roads) {
    if (!(r.flags & RF.bridge) || r.cls !== ROAD.foot && r.cls !== ROAD.steps) continue;
    const d = deckProfile(r); const np = d.pts.length / 2; let top = 0; for (let k = 0; k < np; k++) top = Math.max(top, d.ys[k]);
    if (top < 5) continue;
    const near = faces.some((f) => { for (let k = 0; k < np; k++) if (Math.hypot(d.pts[k * 2] - f.x, d.pts[k * 2 + 1] - f.z) < 12) return true; return false; }); if (!near) continue;
    for (let k = 0; k < np - 1; k++) {
      const ax = d.pts[k * 2], az = d.pts[k * 2 + 1], bx = d.pts[k * 2 + 2], bz = d.pts[k * 2 + 3]; const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (mx < x0 || mx >= x0 + size || mz < z0 || mz >= z0 + size) continue;
      if (Math.min(d.ys[k], d.ys[k + 1]) < top * 0.85) continue;
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue; const nx = -(bz - az) / L, nz = (bx - ax) / L; const hw = d.hw + 0.1;
      const ya = d.ys[k] + 4.1, yb = d.ys[k + 1] + 4.1;
      const A: [number, number, number] = [ax + nx * hw - x0, ya, az + nz * hw - z0], B: [number, number, number] = [ax - nx * hw - x0, ya, az - nz * hw - z0], C: [number, number, number] = [bx - nx * hw - x0, yb, bz - nz * hw - z0], D: [number, number, number] = [bx + nx * hw - x0, yb, bz + nz * hw - z0];
      addQuad(G, A, B, C, D, [0.2, 0.36, 0.55], undefined, {}, true);
      for (let t = 0; t < L; t += 5) { const f = t / L; for (const sd of [-1, 1]) { const px = ax + (bx - ax) * f + nx * hw * sd - x0, pz = az + (bz - az) * f + nz * hw * sd - z0, py = d.ys[k] + (d.ys[k + 1] - d.ys[k]) * f; addBox(G, px, py, pz, 0.14, 4.1, 0.14, 0, [0.3, 0.32, 0.36]); } }
    }
  }
}

// ------------------------------------------------------------------------------------------------ billboards
/** Billboard faces whose centre lies in this tile: a steel back box and legs (merged into G) plus a flat face mesh per board in `g`. */
export function buildBillboards(G: Geo, g: THREE.Group, x0: number, z0: number, size: number) {
  for (const b of BILLBOARDS) {
    if (b.x < x0 || b.x >= x0 + size || b.z < z0 || b.z >= z0 + size) continue;
    const nx = Math.sin(b.yaw), nz = Math.cos(b.yaw), tx = nz, tz = -nx; // tangent: along the face, to the right when looking at it
    const lx = b.x - x0, lz = b.z - z0;
    // back box and frame, 0.15 m behind the face plane; unipoles and roof gantries carry it down to the base
    addBox(G, lx - nx * 0.15, b.y - b.h / 2 - 0.25, lz - nz * 0.15, b.w + 0.5, b.h + 0.5, 0.2, -b.yaw, [0.28, 0.3, 0.34]);
    const base = b.base ?? 0; const foot = base - 0.1;
    if (b.mount === 'pole') addBox(G, lx - nx * 0.45, foot, lz - nz * 0.45, 0.7, b.y - b.h / 2 - 0.25 - foot, 0.7, -b.yaw, [0.34, 0.35, 0.38]);
    else if (b.mount === 'roof') for (const s of [-0.32, 0.32]) addBox(G, lx - nx * 0.45 + tx * b.w * s, foot, lz - nz * 0.45 + tz * b.w * s, 0.35, b.y - b.h / 2 - 0.25 - foot, 0.35, -b.yaw, [0.3, 0.32, 0.36]);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), overrides.has(b.id) ? adMaterial(overrides.get(b.id)!) : blankMaterial(b));
    m.position.set(lx, b.y, lz); m.rotation.y = b.yaw; m.name = b.id; m.castShadow = false; m.userData.billboard = b;
    g.add(m); billboardMeshes.set(b.id, m);
  }
}
export function billboardMaterial() { return steelMat(); }
void hex;
