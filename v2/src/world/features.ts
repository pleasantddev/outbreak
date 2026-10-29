// Tile features built from OSM tags: railways (ballast, sleepers, rails, viaducts, platforms with canopies),
// sports courts (markings, hoops, goals, chain-link fences) and Lagos mechanic villages (carcasses, tyre piles,
// engine stands, drums, rusty sheds). Everything is merged per tile or instanced, so a tile costs a handful of draw calls.
import * as THREE from 'three';
import { Geo, hash, obb, pointInPoly } from './geo';
import { addBox, addCyl, addQuad, vcGeo, hex, mul, type RGB, type V3 } from './geom';
import { RAIL, RLF, AREA, SPORT, BK, ROAD, RF, type Rail, type Area, type Poi, type Building, type Road } from './region';
import { buildingHeight } from './buildings';
import { signUV, signMaterial, SIGN_ASPECT } from './signs';

// ------------------------------------------------------------------------------------------------ shared assets
let vcMat: THREE.MeshStandardMaterial | null = null, fenceMat: THREE.MeshStandardMaterial | null = null, glassMat: THREE.MeshStandardMaterial | null = null;
const courtMats = new Map<string, THREE.MeshStandardMaterial>();
const shared: Record<string, THREE.BufferGeometry> = {};

function vertexMat() { return (vcMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.1, side: THREE.DoubleSide })); }

function chainTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128); g.strokeStyle = 'rgba(200,205,210,0.95)'; g.lineWidth = 3;
  for (let k = -128; k < 256; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 128, 128); g.stroke(); g.beginPath(); g.moveTo(k + 128, 0); g.lineTo(k, 128); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function fenceMaterial() {
  return (fenceMat ??= new THREE.MeshStandardMaterial({ map: chainTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, transparent: false }));
}

type CourtKind = 'bb_full' | 'bb_half' | 'soccer' | 'tennis' | 'volley';
function courtTexture(kind: CourtKind, variant: number) {
  const key = kind + variant; let m = courtMats.get(key); if (m) return m;
  const W = kind === 'soccer' ? 1024 : 1120, H = kind === 'soccer' ? 640 : kind === 'tennis' ? 580 : 600;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!;
  const SURF = [['#2f63ad', '#c9422f'], ['#b8532f', '#2f5d8f'], ['#2f7a52', '#c8a02e'], ['#6a6f78', '#2f63ad']][variant % 4];
  g.lineCap = 'butt'; g.lineJoin = 'miter';
  if (kind === 'bb_full' || kind === 'bb_half') {
    const full = kind === 'bb_full'; const s = 40; // px per metre
    g.fillStyle = SURF[0]; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.06)'; for (let i = 0; i < 400; i++) g.fillRect(Math.random() * W, Math.random() * H, 3 + Math.random() * 30, 2);
    const cx = W / 2, cy = H / 2;
    const L = (x0: number, y0: number, x1: number, y1: number) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
    g.strokeStyle = '#f2f2ee'; g.lineWidth = 6;
    const drawEnd = (dir: number) => { // dir -1 left end, +1 right end; baseline at x = cx + dir*14m (full) or the single end
      const bx = full ? cx + dir * 14 * s : (dir < 0 ? 0 : W);
      const sgn = -dir; // pointing into court
      g.fillStyle = SURF[1]; g.fillRect(Math.min(bx, bx + sgn * 5.8 * s), cy - 2.45 * s, 5.8 * s, 4.9 * s);
      g.strokeRect(Math.min(bx, bx + sgn * 5.8 * s), cy - 2.45 * s, 5.8 * s, 4.9 * s);
      g.beginPath(); g.arc(bx + sgn * 5.8 * s, cy, 1.8 * s, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(bx + sgn * 1.575 * s, cy, 6.75 * s, sgn > 0 ? -1.2 : Math.PI - 1.2 + 2.4 - 2.4 + 0, sgn > 0 ? 1.2 : Math.PI + 1.2 + 0); g.stroke();
      L(bx, cy - 6.6 * s, bx + sgn * 1.575 * s, cy - 6.6 * s); L(bx, cy + 6.6 * s, bx + sgn * 1.575 * s, cy + 6.6 * s);
      g.beginPath(); g.arc(bx + sgn * 1.575 * s, cy, 1.25 * s, sgn > 0 ? -Math.PI / 2 : Math.PI / 2, sgn > 0 ? Math.PI / 2 : -Math.PI / 2 + Math.PI * 2, false); g.stroke();
    };
    g.strokeRect(3, 3, W - 6, H - 6);
    if (full) { L(cx, 0, cx, H); g.beginPath(); g.arc(cx, cy, 1.8 * s, 0, Math.PI * 2); g.stroke(); drawEnd(-1); drawEnd(1); }
    else drawEnd(-1);
  } else if (kind === 'soccer') {
    g.fillStyle = '#3f7d3a'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; g.fillRect((i * W) / 12, 0, W / 12, H); }
    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 5; g.strokeRect(10, 10, W - 20, H - 20);
    g.beginPath(); g.moveTo(W / 2, 10); g.lineTo(W / 2, H - 10); g.stroke(); g.beginPath(); g.arc(W / 2, H / 2, H * 0.14, 0, Math.PI * 2); g.stroke();
    const pb = (side: number) => { const x = side < 0 ? 10 : W - 10; const dx = side < 0 ? 1 : -1; g.strokeRect(side < 0 ? 10 : W - 10 - W * 0.16, H / 2 - H * 0.3, W * 0.16, H * 0.6); g.strokeRect(side < 0 ? 10 : W - 10 - W * 0.055, H / 2 - H * 0.14, W * 0.055, H * 0.28); g.beginPath(); g.arc(x + dx * W * 0.11, H / 2, H * 0.12, side < 0 ? -0.9 : Math.PI - 0.9, side < 0 ? 0.9 : Math.PI + 0.9); g.stroke(); };
    pb(-1); pb(1);
  } else if (kind === 'tennis') {
    g.fillStyle = SURF[0]; g.fillRect(0, 0, W, H); g.fillStyle = SURF[1] === '#c9422f' ? '#2c5a9a' : SURF[1]; g.fillRect(W * 0.04, H * 0.06, W * 0.92, H * 0.88);
    g.strokeStyle = '#f4f4f0'; g.lineWidth = 5; const sx = W * 0.07, sy = H * 0.12, sw = W * 0.86, sh = H * 0.76; g.strokeRect(sx, sy, sw, sh);
    g.strokeRect(sx, sy + sh * 0.125, sw, sh * 0.75); g.beginPath(); g.moveTo(W / 2, sy); g.lineTo(W / 2, sy + sh); g.stroke();
    g.beginPath(); g.moveTo(sx + sw * 0.25, sy + sh * 0.125); g.lineTo(sx + sw * 0.25, sy + sh * 0.875); g.moveTo(sx + sw * 0.75, sy + sh * 0.125); g.lineTo(sx + sw * 0.75, sy + sh * 0.875); g.moveTo(sx + sw * 0.25, H / 2); g.lineTo(sx + sw * 0.75, H / 2); g.stroke();
  } else {
    g.fillStyle = SURF[0]; g.fillRect(0, 0, W, H); g.strokeStyle = '#f4f4f0'; g.lineWidth = 6; g.strokeRect(20, 20, W - 40, H - 40); g.beginPath(); g.moveTo(W / 2, 20); g.lineTo(W / 2, H - 20); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  courtMats.set(key, m); return m;
}

function sharedGeos() {
  if (shared.sleeper) return shared;
  shared.sleeper = new THREE.BoxGeometry(1, 0.12, 0.26).translate(0, 0.06, 0);
  shared.pillar = new THREE.CylinderGeometry(0.7, 0.85, 1, 10).translate(0, 0.5, 0);
  shared.post = new THREE.CylinderGeometry(0.045, 0.05, 3.8, 6).translate(0, 1.9, 0);
  // basketball hoop on a post: base post, arm, white backboard with red frame and orange rim (local +z faces the court)
  const h = vcGeo();
  addCyl(h, 0, 0, -1.25, 0.09, 3.9, [0.15, 0.15, 0.17], 8);
  addBox(h, 0, 3.75, -0.62, 0.1, 0.1, 1.28, 0, [0.15, 0.15, 0.17]);
  addBox(h, 0, 2.95, 0, 1.8, 1.05, 0.06, 0, [0.95, 0.95, 0.97]);
  addBox(h, 0, 3.4, 0.03, 0.6, 0.45, 0.02, 0, [0.85, 0.12, 0.1]);
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; addBox(h, Math.cos(a) * 0.23, 3.02, 0.45 + Math.sin(a) * 0.23, 0.08, 0.04, 0.08, -a, [0.9, 0.35, 0.08]); }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; addBox(h, Math.cos(a) * 0.16, 2.55, 0.45 + Math.sin(a) * 0.16, 0.025, 0.47, 0.025, 0, [0.92, 0.92, 0.9]); }
  shared.hoop = h.build();
  // football goal facing +z: two posts, crossbar, net back
  const gl = vcGeo(); const w = 3.2, hh = 2.1; // five-a-side goal; scaled for full size
  addBox(gl, -w / 2, 0, 0, 0.1, hh, 0.1, 0, [0.96, 0.96, 0.96]); addBox(gl, w / 2, 0, 0, 0.1, hh, 0.1, 0, [0.96, 0.96, 0.96]); addBox(gl, 0, hh - 0.1, 0, w + 0.1, 0.1, 0.1, 0, [0.96, 0.96, 0.96]);
  addQuad(gl, [-w / 2, 0, -1.0], [w / 2, 0, -1.0], [w / 2, hh - 0.1, -0.7], [-w / 2, hh - 0.1, -0.7], [0.85, 0.85, 0.85], undefined, {}, true);
  shared.goal = gl.build();
  // tyre stack, engine block on a stand, oil drum, car carcass (no wheels, no glass, no doors)
  const ty = vcGeo(); for (let k = 0; k < 5; k++) addCyl(ty, (k % 2) * 0.05, k * 0.2, 0, 0.36, 0.2, [0.07, 0.07, 0.07], 10, 0.34);
  shared.tyres = ty.build();
  const en = vcGeo(); addBox(en, 0, 0, 0, 0.9, 0.5, 0.5, 0, [0.35, 0.18, 0.1]); addBox(en, 0, 0.5, 0, 0.8, 0.45, 0.45, 0, [0.22, 0.22, 0.24]); addBox(en, 0.55, 0.15, 0, 0.3, 0.3, 0.3, 0, [0.3, 0.3, 0.32]);
  for (const sx of [-0.4, 0.4]) for (const sz of [-0.22, 0.22]) addBox(en, sx, 0, sz, 0.05, 0.5, 0.05, 0, [0.6, 0.12, 0.08]);
  shared.engine = en.build();
  const dr = vcGeo(); addCyl(dr, 0, 0, 0, 0.29, 0.88, [1, 1, 1], 10); addCyl(dr, 0, 0.88, 0, 0.27, 0.02, [0.5, 0.5, 0.5], 10);
  shared.drum = dr.build();
  const car = vcGeo(); const body: RGB = [1, 1, 1];
  addBox(car, 0, 0.22, 0, 4.2, 0.62, 1.7, 0, body); addBox(car, -0.2, 0.84, 0, 2.2, 0.55, 1.5, 0, mul(body, 0.92)); addBox(car, 1.7, 0.84, 0, 0.7, 0.04, 1.6, 0, mul(body, 0.8));
  for (const sx of [-1.3, 1.3]) for (const sz of [-0.8, 0.8]) addBox(car, sx, 0, sz, 0.5, 0.3, 0.3, 0, [0.2, 0.2, 0.2]);
  shared.carcass = car.build();
  return shared;
}

/** Builds the lazily created shared geometry, materials and canvases up front (during the loading screen) so the first tile does not pay for them in one frame. */
export function warmFeatures() { sharedGeos(); vertexMat(); fenceMaterial(); signMaterial(); }

// ------------------------------------------------------------------------------------------------ builders
export interface FeatureInput {
  x0: number; z0: number; size: number;
  rails: Rail[]; areas: Area[]; pois: Poi[]; buildings: Building[]; roads: Road[];
  blocked: (x: number, z: number) => boolean;
  /** True for points on the road or its verge, so props stay off the carriageway. */
  onRoad: (x: number, z: number) => boolean;
}
export interface FeatureOut { poles?: number[]; group: THREE.Group; courts: { x: number; z: number; r: number }[]; fenceWalls: { ax: number; az: number; bx: number; bz: number; h: number }[]; mechSites: Area[] }

const RAILC: RGB = [0.27, 0.26, 0.27], RUST: RGB = [0.42, 0.24, 0.14], BALLAST: RGB = [0.46, 0.45, 0.43], BALLAST_D: RGB = [0.36, 0.34, 0.28], CONC: RGB = [0.66, 0.65, 0.62];

export function buildFeatures(inp: FeatureInput): FeatureOut {
  const S = sharedGeos();
  const g = new THREE.Group(); const { x0, z0, size } = inp;
  const inTile = (x: number, z: number) => x >= x0 && x < x0 + size && z >= z0 && z < z0 + size;
  const G = vcGeo();
  const out: FeatureOut = { group: g, courts: [], fenceWalls: [], mechSites: [] };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, f: (i: number, put: (x: number, y: number, z: number, ry: number, sx?: number, sy?: number, sz?: number) => void) => void, colors?: (i: number) => RGB) => {
    if (!n) return null;
    const im = new THREE.InstancedMesh(geo, mat, n);
    const put = (i: number) => (x: number, y: number, z: number, ry: number, sx = 1, sy = sx, sz = sx) => { q.setFromAxisAngle(up, ry); sc.set(sx, sy, sz); m4.compose(pv.set(x, y, z), q, sc); im.setMatrixAt(i, m4); };
    for (let i = 0; i < n; i++) { f(i, put(i)); if (colors) { const c = colors(i); im.setColorAt(i, new THREE.Color(c[0], c[1], c[2])); } }
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = true; im.computeBoundingSphere(); g.add(im); return im;
  };

  // ---------------------------------------------------------------- railways
  const sleepers: { x: number; y: number; z: number; ry: number; len: number; col: RGB }[] = [];
  const pillars: { x: number; y: number; z: number }[] = [];
  const steel = hex(0x8a8c92);
  for (const r of inp.rails) {
    if (r.kind !== RAIL.standard && r.kind !== RAIL.narrow && r.kind !== RAIL.light && r.kind !== RAIL.disused) continue;
    const p = r.pts, n = p.length / 2; if (n < 2) continue;
    const gauge = r.gauge / 1000; const sl = gauge + 1.1; const bw = sl + 0.9; const disused = r.kind === RAIL.disused; const service = (r.flags & RLF.service) !== 0;
    const bcol = disused ? mul(BALLAST_D, 0.85) : service ? BALLAST_D : BALLAST;
    const rc = disused ? RUST : RAILC;
    let s = 0; const spacing = disused ? 1.3 : 0.62;
    const yAt = (k: number, t: number) => { if (!r.elev) return 0; const a = r.elev[k], b = r.elev[Math.min(n - 1, k + 1)]; return a + (b - a) * t; };
    let sleepAcc = 0; let lastElevated = false;
    for (let k = 0; k < n - 1; k++) {
      const ax = p[k * 2], az = p[k * 2 + 1], bx = p[k * 2 + 2], bz = p[k * 2 + 3]; const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx; const ry = -Math.atan2(tz, tx);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const own = inTile(mx, mz);
      if (own) {
        const ya = yAt(k, 0) , yb = yAt(k, 1); const ext = 0.25;
        const A: V3 = [ax - tx * ext - x0, ya, az - tz * ext - z0], B: V3 = [bx + tx * ext - x0, yb, bz + tz * ext - z0];
        const elevated = Math.min(ya, yb) > 0.9; lastElevated = elevated;
        if (elevated) { // viaduct: concrete box girder with parapets
          const dw = bw + 0.6; const y0 = ya - 0.15, y1 = yb - 0.15; const gc = hex(0xb9b6ae);
          const P = (px: number, sd: number, y: number, ex: number): V3 => [px + nx * sd * ex, y, 0] as V3; void P;
          const q4 = (sd: number): [V3, V3, V3, V3] => [[A[0] + nx * sd * dw / 2, y0 - 1.5, A[2] + nz * sd * dw / 2], [B[0] + nx * sd * dw / 2, y1 - 1.5, B[2] + nz * sd * dw / 2], [B[0] + nx * sd * dw / 2, y1 + 0.55, B[2] + nz * sd * dw / 2], [A[0] + nx * sd * dw / 2, y0 + 0.55, A[2] + nz * sd * dw / 2]];
          for (const sd of [1, -1]) { const [a, b, c, d] = q4(sd); if (sd > 0) addQuad(G, a, b, c, d, gc, undefined, {}, true); else addQuad(G, a, b, c, d, gc, undefined, {}, true); }
          addQuad(G, [A[0] - nx * dw / 2, y0 - 1.5, A[2] - nz * dw / 2], [B[0] - nx * dw / 2, y1 - 1.5, B[2] - nz * dw / 2], [B[0] + nx * dw / 2, y1 - 1.5, B[2] + nz * dw / 2], [A[0] + nx * dw / 2, y0 - 1.5, A[2] + nz * dw / 2], mul(gc, 0.7), undefined, {}, true);
          addQuad(G, [A[0] - nx * dw / 2, y0, A[2] - nz * dw / 2], [B[0] - nx * dw / 2, y1, B[2] - nz * dw / 2], [B[0] + nx * dw / 2, y1, B[2] + nz * dw / 2], [A[0] + nx * dw / 2, y0, A[2] + nz * dw / 2], mul(gc, 0.8), undefined, {}, true);
        }
        // ballast trapezoid: flat top at +0.1, sloped shoulders
        const by0 = ya, by1 = yb; const top = bw / 2, bot = elevated ? bw / 2 : bw / 2 + 0.55;
        const T = (sd: number, w: number, y: number, E: V3): V3 => [E[0] + nx * sd * w, E[1] + y, E[2] + nz * sd * w];
        addQuad(G, T(1, top, 0.1, A), T(1, top, 0.1, B), T(-1, top, 0.1, B), T(-1, top, 0.1, A), bcol, undefined, {}, true);
        if (!elevated) for (const sd of [1, -1]) addQuad(G, T(sd, bot, 0.0, A), T(sd, bot, 0.0, B), T(sd, top, 0.1, B), T(sd, top, 0.1, A), mul(bcol, 0.9), undefined, {}, true);
        void by0; void by1;
        // two rails
        for (const sd of [1, -1]) {
          const w0 = gauge / 2 * sd, rw = 0.06;
          const Ra: V3 = [A[0] + nx * w0, A[1] + 0.22, A[2] + nz * w0], Rb: V3 = [B[0] + nx * w0, B[1] + 0.22, B[2] + nz * w0];
          addQuad(G, [Ra[0] + nx * rw, Ra[1] + 0.12, Ra[2] + nz * rw], [Rb[0] + nx * rw, Rb[1] + 0.12, Rb[2] + nz * rw], [Rb[0] - nx * rw, Rb[1] + 0.12, Rb[2] - nz * rw], [Ra[0] - nx * rw, Ra[1] + 0.12, Ra[2] - nz * rw], disused ? RUST : [0.66, 0.66, 0.68], undefined, {}, true);
          for (const o of [1, -1]) addQuad(G, [Ra[0] + nx * rw * o, Ra[1], Ra[2] + nz * rw * o], [Rb[0] + nx * rw * o, Rb[1], Rb[2] + nz * rw * o], [Rb[0] + nx * rw * o, Rb[1] + 0.12, Rb[2] + nz * rw * o], [Ra[0] + nx * rw * o, Ra[1] + 0.12, Ra[2] + nz * rw * o], mul(rc, 0.8), undefined, {}, true);
        }
        // sleepers
        let t = (spacing - (sleepAcc % spacing)) % spacing;
        for (; t < L; t += spacing) { const f = t / L; sleepers.push({ x: ax + (bx - ax) * f, y: ya + (yb - ya) * f + 0.1, z: az + (bz - az) * f, ry, len: sl, col: disused ? [0.35, 0.3, 0.25] : [0.55, 0.54, 0.52] }); }
        if (elevated) { const pit = 26; for (let tt = (pit - (s % pit)) % pit; tt < L; tt += pit) { const f = tt / L; const y = ya + (yb - ya) * f; if (y > 2) pillars.push({ x: ax + (bx - ax) * f, y: y - 1.6, z: az + (bz - az) * f }); } }
      }
      sleepAcc += L; s += L;
    }
    void lastElevated;
  }
  void steel;
  if (G.count) { const m = new THREE.Mesh(G.build(), vertexMat()); m.receiveShadow = true; m.castShadow = false; g.add(m); }
  if (sleepers.length) inst(S.sleeper, new THREE.MeshStandardMaterial({ roughness: 0.9 }), sleepers.length, (i, put) => { const s = sleepers[i]; put(s.x - x0, s.y, s.z - z0, s.ry, 1, 1, 1); }, undefined);
  if (sleepers.length) { // sleepers differ in length: stretch via a second pass on scale.x
    const im = g.children[g.children.length - 1] as THREE.InstancedMesh;
    for (let i = 0; i < sleepers.length; i++) { const s = sleepers[i]; im.getMatrixAt(i, m4); m4.decompose(pv, q, sc); sc.set(s.len, 1, 1); m4.compose(pv, q, sc); im.setMatrixAt(i, m4); im.setColorAt(i, new THREE.Color(s.col[0], s.col[1], s.col[2])); }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = false;
  }
  if (pillars.length) inst(S.pillar, new THREE.MeshStandardMaterial({ color: 0xb4b0a8, roughness: 0.85 }), pillars.length, (i, put) => { const p = pillars[i]; put(p.x - x0, 0, p.z - z0, 0, 1, p.y, 1); });

  // ---------------------------------------------------------------- station platforms with canopies
  const PG = vcGeo();
  for (const r of inp.rails) {
    if (r.kind !== RAIL.platform) continue;
    const p = r.pts; let n = p.length / 2; if (n < 2) continue;
    const closed = (r.flags & RLF.closed) !== 0; if (closed && n > 3 && p[0] === p[(n - 1) * 2] && p[1] === p[(n - 1) * 2 + 1]) n--;
    let cx = 0, cz = 0; for (let k = 0; k < n; k++) { cx += p[k * 2]; cz += p[k * 2 + 1]; } cx /= n; cz /= n;
    if (!inTile(cx, cz)) continue;
    let poly: number[];
    if (closed && n >= 3) poly = Array.from(p).slice(0, n * 2);
    else { // a platform edge drawn as a line: give it 3 m of width
      poly = []; const w = 1.6; const k0 = 0, k1 = n - 1; const tx = p[k1 * 2] - p[k0 * 2], tz = p[k1 * 2 + 1] - p[k0 * 2 + 1]; const tl = Math.hypot(tx, tz) || 1; const nx = -tz / tl * w, nz = tx / tl * w;
      for (let k = 0; k < n; k++) poly.push(p[k * 2] + nx, p[k * 2 + 1] + nz); for (let k = n - 1; k >= 0; k--) poly.push(p[k * 2] - nx, p[k * 2 + 1] - nz);
    }
    const nn = poly.length / 2;
    const contour = Array.from({ length: nn }, (_, k) => new THREE.Vector2(poly[k * 2] - x0, poly[k * 2 + 1] - z0));
    let tris: number[][] = []; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { tris = []; }
    const H = 0.32; const cc = hex(0xb8b6b0);
    const base = PG.count; for (let k = 0; k < nn; k++) PG.v([poly[k * 2] - x0, H, poly[k * 2 + 1] - z0], [0, 1, 0], [0, 0], { color: cc });
    for (const t of tris) PG.tri(base + t[0], base + t[2], base + t[1]);
    for (let k = 0; k < nn; k++) { const j = (k + 1) % nn; const a: V3 = [poly[k * 2] - x0, 0, poly[k * 2 + 1] - z0], b: V3 = [poly[j * 2] - x0, 0, poly[j * 2 + 1] - z0]; addQuad(PG, a, b, [b[0], H, b[2]], [a[0], H, a[2]], mul(cc, 0.8), undefined, {}, true); }
    // yellow safety line along the edge
    for (let k = 0; k < nn; k++) { const j = (k + 1) % nn; const L = Math.hypot(poly[j * 2] - poly[k * 2], poly[j * 2 + 1] - poly[k * 2 + 1]); if (L < 6) continue; const tx = (poly[j * 2] - poly[k * 2]) / L, tz = (poly[j * 2 + 1] - poly[k * 2 + 1]) / L; const ix = cx - (poly[k * 2] + poly[j * 2]) / 2, iz = cz - (poly[k * 2 + 1] + poly[j * 2 + 1]) / 2; const sg = (-tz * ix + tx * iz) > 0 ? 1 : -1; const nx = -tz * sg, nz = tx * sg; const a: V3 = [poly[k * 2] - x0 + nx * 0.45, H + 0.01, poly[k * 2 + 1] - z0 + nz * 0.45], b: V3 = [poly[j * 2] - x0 + nx * 0.45, H + 0.01, poly[j * 2 + 1] - z0 + nz * 0.45]; addQuad(PG, [a[0] - nx * 0.18, a[1], a[2] - nz * 0.18], [b[0] - nx * 0.18, b[1], b[2] - nz * 0.18], [b[0] + nx * 0.18, b[1], b[2] + nz * 0.18], [a[0] + nx * 0.18, a[1], a[2] + nz * 0.18], [0.95, 0.8, 0.1], undefined, {}, true); }
    // canopy on posts for the bigger platforms
    const o = obb(poly);
    if (o.hl * o.hw * 4 > 120 && o.hw > 1.2) {
      const roofY = 3.7; const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
      const rl = o.hl * 2 * 0.9, rw = o.hw * 2 + 1.6;
      addBox(PG, o.cx - x0, roofY, o.cz - z0, rl, 0.14, rw, o.ang, [0.78, 0.8, 0.84]);
      const nposts = Math.max(2, Math.round(rl / 7));
      for (let k = 0; k <= nposts; k++) { const lx = -rl / 2 + (k / nposts) * rl; for (const sd of [-1, 1]) { const lz = sd * (o.hw - 0.25); addCyl(PG, o.cx - x0 + lx * ca - lz * sa * -1 * -1, 0, o.cz - z0 + lx * sa + lz * ca, 0.08, roofY, [0.3, 0.32, 0.36], 6); } }
      // name board on a post at one end
      const nm = nearestStation(inp.pois, o.cx, o.cz);
      if (nm) {
        const uv = signUV(nm, 3); const bw2 = 4.4, bh = bw2 / SIGN_ASPECT; const ex = o.cx - x0 + ca * (rl / 2 - 3) , ez = o.cz - z0 + sa * (rl / 2 - 3);
        signs.push({ cx: ex, cy: roofY - 0.5, cz: ez, ang: o.ang, w: bw2, h: bh, uv });
        signs.push({ cx: o.cx - x0 - ca * (rl / 2 - 3), cy: roofY - 0.5, cz: o.cz - z0 - sa * (rl / 2 - 3), ang: o.ang, w: bw2, h: bh, uv });
      }
    }
  }
  if (PG.count) { const m = new THREE.Mesh(PG.build(), vertexMat()); m.receiveShadow = true; m.castShadow = true; g.add(m); }

  // ---------------------------------------------------------------- courts and pitches
  const CG = new Map<string, Geo>(); const FG = new Geo(); const hoops: { x: number; z: number; ry: number }[] = []; const goals: { x: number; z: number; ry: number; s: number }[] = []; const fposts: { x: number; z: number }[] = [];
  const mechs: Area[] = [];
  const seenCourt = new Set<string>();
  for (const a of inp.areas) {
    if (a.kind === AREA.mechanic) { mechs.push(a); continue; }
    if (a.kind !== AREA.pitch || !a.sub) continue;
    if (a.sub === SPORT.athletics || a.sub === SPORT.swimming || a.sub === SPORT.cricket || a.sub === SPORT.multi) continue;
    const o = obb(a.pts);
    if (!inTile(o.cx, o.cz)) continue;
    const key = `${Math.round(o.cx)}:${Math.round(o.cz)}`; if (seenCourt.has(key)) continue; seenCourt.add(key);
    if (inp.buildings.some((b) => Math.abs(b.cx - o.cx) < 25 && Math.abs(b.cz - o.cz) < 25 && b.area > 0.5 * o.hl * o.hw * 4 && pointInPoly(o.cx, o.cz, b.pts))) continue; // a sports hall, not an open court
    let L = o.hl * 2, W = o.hw * 2;
    const hsh = hash(Math.round(o.cx * 3.1 + o.cz * 1.7), 11);
    let kind: CourtKind;
    if (a.sub === SPORT.basketball) { if (L > 34) { L = 28; W = 15; } else if (L < 15) { L = Math.max(L, 12); } kind = L >= 20 ? 'bb_full' : 'bb_half'; }
    else if (a.sub === SPORT.tennis) kind = 'tennis'; else if (a.sub === SPORT.volleyball) kind = 'volley'; else kind = 'soccer';
    if (kind === 'bb_full' && W > L * 0.75) W = L * 0.54; if (kind === 'bb_full' && L > 30) L = 28;
    const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
    const cx = o.cx - x0, cz = o.cz - z0;
    const geo = (() => { const k2 = kind + (hsh < 0.25 ? 0 : hsh < 0.5 ? 1 : hsh < 0.75 ? 2 : 3); let gg = CG.get(k2); if (!gg) { gg = new Geo(); CG.set(k2, gg); } return gg; })();
    // surface quad with texture coords
    const P = (lx: number, lz: number): V3 => [cx + lx * ca - lz * sa, 0.035, cz + lx * sa + lz * ca];
    const hl = L / 2, hw = W / 2;
    const vi = [P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)].map((p, k) => geo.v(p, [0, 1, 0], ([[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][])[k]));
    geo.tri(vi[0], vi[2], vi[1]); geo.tri(vi[0], vi[3], vi[2]);
    out.courts.push({ x: o.cx, z: o.cz, r: Math.hypot(hl, hw) });
    const fenced = kind !== 'soccer' || L < 48;
    if (kind === 'bb_full' || kind === 'bb_half') {
      const ry = -o.ang;
      hoops.push({ x: cx - ca * (hl - 1.2), z: cz - sa * (hl - 1.2), ry: Math.PI / 2 - o.ang });
      if (kind === 'bb_full') hoops.push({ x: cx + ca * (hl - 1.2), z: cz + sa * (hl - 1.2), ry: -Math.PI / 2 - o.ang });
    }
    if (kind === 'soccer') { const s = L < 48 ? 1 : 2.3; for (const sd of [-1, 1]) goals.push({ x: cx + ca * hl * sd, z: cz + sa * hl * sd, ry: sd < 0 ? Math.PI / 2 - o.ang : -Math.PI / 2 - o.ang, s }); }
    if (fenced) { // chain-link fence 1.4 m outside the lines, one gate gap on a long side
      const m = 1.4; const hl2 = hl + m, hw2 = hw + m; const H = kind === 'tennis' ? 3.6 : kind === 'soccer' ? 3.2 : 3.6;
      const corners = [[-hl2, -hw2], [hl2, -hw2], [hl2, hw2], [-hl2, hw2]];
      for (let e = 0; e < 4; e++) {
        const [ax2, az2] = corners[e], [bx2, bz2] = corners[(e + 1) % 4]; const Le = Math.hypot(bx2 - ax2, bz2 - az2);
        const np = Math.max(1, Math.round(Le / 3.2));
        for (let k = 0; k < np; k++) {
          const t0 = k / np, t1 = (k + 1) / np; if (e === 2 && k === Math.floor(np / 2)) continue; // gate gap
          const lx0 = ax2 + (bx2 - ax2) * t0, lz0 = az2 + (bz2 - az2) * t0, lx1 = ax2 + (bx2 - ax2) * t1, lz1 = az2 + (bz2 - az2) * t1;
          const A: V3 = [cx + lx0 * ca - lz0 * sa, 0, cz + lx0 * sa + lz0 * ca], B: V3 = [cx + lx1 * ca - lz1 * sa, 0, cz + lx1 * sa + lz1 * ca];
          const l = Math.hypot(B[0] - A[0], B[2] - A[2]);
          const f0 = FG.v([A[0], 0, A[2]], [0, 0, 1], [0, 0]), f1 = FG.v([B[0], 0, B[2]], [0, 0, 1], [l / 1.1, 0]), f2 = FG.v([B[0], H, B[2]], [0, 0, 1], [l / 1.1, H / 1.1]), f3 = FG.v([A[0], H, A[2]], [0, 0, 1], [0, H / 1.1]);
          FG.tri(f0, f1, f2); FG.tri(f0, f2, f3);
          fposts.push({ x: A[0] + x0, z: A[2] + z0 });
          out.fenceWalls.push({ ax: A[0] + x0, az: A[2] + z0, bx: B[0] + x0, bz: B[2] + z0, h: 2.2 });
        }
      }
    }
  }
  for (const [k, gg] of CG) { if (!gg.count) continue; const kind = k.slice(0, -1) as CourtKind; const m = new THREE.Mesh(gg.build(), courtTexture(kind, +k.slice(-1))); m.receiveShadow = true; g.add(m); }
  if (FG.count) { const m = new THREE.Mesh(FG.build(), fenceMaterial()); m.castShadow = false; g.add(m); }
  if (hoops.length) inst(S.hoop, vertexMat(), hoops.length, (i, put) => { const h = hoops[i]; put(h.x, 0, h.z, h.ry); });
  if (goals.length) inst(S.goal, vertexMat(), goals.length, (i, put) => { const h = goals[i]; put(h.x, 0, h.z, h.ry, h.s); });
  if (fposts.length) inst(S.post, new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.5, metalness: 0.7 }), fposts.length, (i, put) => { put(fposts[i].x - x0, 0, fposts[i].z - z0, 0); });


  // ---------------------------------------------------------------- bank branches: signboard with the bank name, ATM gallery, security post
  const BG = vcGeo();
  for (const b of inp.buildings) {
    if (b.kind !== BK.bank || !inTile(b.cx, b.cz)) continue;
    const n = b.pts.length / 2; if (n < 3) continue;
    // the facade is the polygon edge closest to a drivable road
    let bestE = -1, bestD = 1e9;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n; const L = Math.hypot(b.pts[j * 2] - b.pts[i * 2], b.pts[j * 2 + 1] - b.pts[i * 2 + 1]); if (L < 4) continue;
      const mx = (b.pts[i * 2] + b.pts[j * 2]) / 2, mz = (b.pts[i * 2 + 1] + b.pts[j * 2 + 1]) / 2;
      let d = 1e9;
      for (const r of inp.roads) { if (r.cls > ROAD.service || (r.flags & RF.bridge)) continue; for (let k = 0; k < r.pts.length / 2 - 1; k++) { const ax = r.pts[k * 2], az = r.pts[k * 2 + 1], bx = r.pts[k * 2 + 2], bz = r.pts[k * 2 + 3]; if (Math.abs(ax - mx) > 80 && Math.abs(bx - mx) > 80) continue; const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((mx - ax) * dx + (mz - az) * dz) / L2)); const dd = Math.hypot(ax + dx * t - mx, az + dz * t - mz); if (dd < d) d = dd; } }
      d -= L * 0.02; if (d < bestD) { bestD = d; bestE = i; }
    }
    if (bestE < 0) continue;
    const i = bestE, j = (i + 1) % n; const ax = b.pts[i * 2], az = b.pts[i * 2 + 1], bx = b.pts[j * 2], bz = b.pts[j * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L; let nx = tz, nz = -tx;
    // outward = away from the centroid
    if ((ax - b.cx) * nx + (az - b.cz) * nz < 0) { nx = -nx; nz = -nz; }
    const mx = (ax + bx) / 2, mz = (az + bz) / 2; const H = buildingHeight(b); const ang = Math.atan2(nz, nx);
    // signboard above the entrance, readable from the road
    const label = b.name || 'BANK'; const sw = Math.min(L * 0.85, 7.5);
    const sy = Math.max(3.3, Math.min(H - 0.6, 5.2));
    signs.push({ cx: mx + nx * 0.2 - x0, cy: sy, cz: mz + nz * 0.2 - z0, ang: Math.atan2(tz, tx), w: sw, h: sw / SIGN_ASPECT, uv: signUV(label) });
    // ATM gallery: a glazed box with a lit screen face, tucked against the facade at one end
    const gx = mx + tx * Math.min(L * 0.32, 5) + nx * 1.15 - x0, gz = mz + tz * Math.min(L * 0.32, 5) + nz * 1.15 - z0; const ra = Math.atan2(tz, tx);
    addBox(BG, gx, 0, gz, 3.4, 2.7, 2.2, ra, [0.22, 0.27, 0.31], { top: [0.55, 0.57, 0.6] });
    addBox(BG, gx + nx * 1.12, 0.35, gz + nz * 1.12, 2.7, 1.9, 0.06, ra, [0.55, 0.78, 0.88]);
    addBox(BG, gx + nx * 1.14 - tx * 0.7, 1.0, gz + nz * 1.14 - tz * 0.7, 0.5, 0.45, 0.04, ra, [0.2, 0.95, 0.55]);
    addBox(BG, gx + nx * 1.14 + tx * 0.7, 1.0, gz + nz * 1.14 + tz * 0.7, 0.5, 0.45, 0.04, ra, [0.2, 0.95, 0.55]);
    addBox(BG, gx, 2.7, gz, 3.6, 0.12, 2.4, ra, [0.85, 0.85, 0.86]);
    // security post at the gate: white booth with a blue band and a flat roof
    const px = mx - tx * Math.min(L * 0.42, 7) + nx * 3.4 - x0, pz = mz - tz * Math.min(L * 0.42, 7) + nz * 3.4 - z0;
    addBox(BG, px, 0, pz, 1.5, 2.3, 1.5, ra, [0.92, 0.92, 0.9]);
    addBox(BG, px, 1.0, pz, 1.52, 0.35, 1.52, ra, [0.1, 0.25, 0.55]);
    addBox(BG, px, 2.3, pz, 1.9, 0.1, 1.9, ra, [0.3, 0.32, 0.36]);
    out.fenceWalls.push({ ax: px + x0 - 0.75, az: pz + z0, bx: px + x0 + 0.75, bz: pz + z0, h: 2.3 });
    void ang;
  }
  if (BG.count) { const m = new THREE.Mesh(BG.build(), vertexMat()); m.castShadow = true; m.receiveShadow = true; g.add(m); }

  // stand-alone ATM kiosks (amenity=atm nodes): a small lobby with a lit screen face and the bank name on a plate
  {
    const AG = vcGeo();
    for (const p of inp.pois) {
      if (p.kind !== 19 || !inTile(p.x, p.z) || inp.blocked(p.x, p.z) || inp.onRoad(p.x, p.z)) continue;
      const lx = p.x - x0, lz = p.z - z0; const ry = hash(Math.round(p.x * 3 + p.z), 5) * Math.PI * 2;
      addBox(AG, lx, 0, lz, 1.7, 2.5, 1.7, ry, [0.28, 0.32, 0.36], { top: [0.8, 0.8, 0.82] });
      const fx = Math.cos(ry), fz = Math.sin(ry);
      addBox(AG, lx - fz * 0.86, 0.5, lz + fx * 0.86, 1.1, 1.5, 0.05, ry, [0.55, 0.78, 0.88]);
      addBox(AG, lx - fz * 0.88, 1.1, lz + fx * 0.88, 0.45, 0.4, 0.04, ry, [0.2, 0.95, 0.55]);
      if (p.name) signs.push({ cx: lx - fz * 0.9, cy: 2.2, cz: lz + fx * 0.9, ang: ry, w: 1.5, h: 1.5 / SIGN_ASPECT, uv: signUV(p.name) });
    }
    if (AG.count) { const m = new THREE.Mesh(AG.build(), vertexMat()); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  }

  // ---------------------------------------------------------------- bus terminals (Oshodi Transport Interchange): columns, painted bays, terminal name boards
  const TG = vcGeo(); const termPoles: number[] = [];
  for (const b of inp.buildings) {
    if (b.kind !== BK.terminal || !inTile(b.cx, b.cz)) continue;
    const o = obb(b.pts); const ca = Math.cos(o.ang), sa = Math.sin(o.ang); const H = buildingHeight(b);
    const W = (lx: number, lz: number): [number, number] => [b.cx * 0 + o.cx + lx * ca - lz * sa - x0, o.cz + lx * sa + lz * ca - z0];
    const inside = (lx: number, lz: number) => { const [x, z] = W(lx, lz); return pointInPoly(x + x0, z + z0, b.pts); };
    // columns on a 10 x 9 m grid, steel box section on a concrete foot
    for (let lx = -o.hl + 2; lx <= o.hl - 1.5; lx += 10) for (let lz = -o.hw + 2; lz <= o.hw - 1.5; lz += 9) {
      if (!inside(lx, lz)) continue; const [x, z] = W(lx, lz);
      addBox(TG, x, 0, z, 0.9, 0.5, 0.9, o.ang, [0.62, 0.61, 0.58]); addBox(TG, x, 0.5, z, 0.45, H - 0.5, 0.45, o.ang, [0.34, 0.36, 0.4]);
      termPoles.push(x + x0, z + z0, 0.45);
    }
    // painted bays: yellow dividers across the long axis, 3.8 m apart, 12 m deep, along both long sides and a median
    for (const lane of [-1, 0, 1]) {
      const lz0 = lane * o.hw * 0.62; for (let lx = -o.hl + 4; lx <= o.hl - 4; lx += 3.8) {
        if (!inside(lx, lz0) || !inside(lx, lz0 + (lane === 0 ? 0 : 5))) continue;
        const dz = 5.5; const a = W(lx, lz0 - dz), c = W(lx, lz0 + dz);
        addQuad(TG, [a[0] - sa * 0.07, 0.04, a[1] + ca * 0.07 * 0 - ca * 0.0], [c[0] - sa * 0.07, 0.04, c[1]], [c[0] + sa * 0.07, 0.04, c[1]], [a[0] + sa * 0.07, 0.04, a[1]], [0.93, 0.78, 0.12], undefined, {}, true);
      }
    }
    // name boards on the roof edge facing both long sides
    if (b.name) { const uv = signUV(b.name.replace('Oshodi Transport Interchange - ', 'OSHODI ').replace('Oshodi Transport Interchange', 'OSHODI INTERCHANGE'), 1); const w = Math.min(14, o.hl * 1.2);
      for (const sd of [-1, 1]) { const [x, z] = W(0, sd * (o.hw - 0.1)); signs.push({ cx: x, cy: H - 0.9, cz: z, ang: o.ang, w, h: w / SIGN_ASPECT, uv }); } }
    // fascia: dark steel band round the roof edge
    const n = b.pts.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; addQuad(TG, [b.pts[i * 2] - x0, H - 0.5, b.pts[i * 2 + 1] - z0], [b.pts[j * 2] - x0, H - 0.5, b.pts[j * 2 + 1] - z0], [b.pts[j * 2] - x0, H + 0.3, b.pts[j * 2 + 1] - z0], [b.pts[i * 2] - x0, H + 0.3, b.pts[i * 2 + 1] - z0], [0.3, 0.33, 0.38], undefined, {}, true); }
  }
  if (TG.count) { const m = new THREE.Mesh(TG.build(), vertexMat()); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  out.poles = termPoles;

  // ---------------------------------------------------------------- mechanic villages
  for (const a of mechs) {
    const o = obb(a.pts); if (!inTile(o.cx, o.cz) && !a.pts.some((_, i) => i % 2 === 0 && inTile(a.pts[i], a.pts[i + 1]))) continue;
    out.mechSites.push(a);
  }
  if (out.mechSites.length) mechanicProps(out.mechSites, inp, inst, S, g);
  if (signs.length) signsMesh(g, signs.splice(0)); else signs.length = 0;
  return out;
}

// sign quads collected while building and flushed at the end of buildFeatures
interface SignQuad { cx: number; cy: number; cz: number; ang: number; w: number; h: number; uv: { u0: number; v0: number; u1: number; v1: number } }
const signs: SignQuad[] = [];
export function signsMesh(g: THREE.Group, list: SignQuad[], flat?: boolean) {
  const G = new Geo();
  for (const s of list) {
    const c = Math.cos(s.ang), si = Math.sin(s.ang); const hw = s.w / 2; const x = (lx: number) => [s.cx + lx * c, s.cz + lx * si] as const;
    const [ax, az] = x(-hw), [bx, bz] = x(hw);
    const nx = -si, nz = c;
    for (const sd of [1, -1]) {
      const A = G.v([ax + nx * 0.03 * sd, s.cy - s.h / 2, az + nz * 0.03 * sd], [nx * sd, 0, nz * sd], [sd > 0 ? s.uv.u0 : s.uv.u1, s.uv.v1]);
      const B = G.v([bx + nx * 0.03 * sd, s.cy - s.h / 2, bz + nz * 0.03 * sd], [nx * sd, 0, nz * sd], [sd > 0 ? s.uv.u1 : s.uv.u0, s.uv.v1]);
      const C = G.v([bx + nx * 0.03 * sd, s.cy + s.h / 2, bz + nz * 0.03 * sd], [nx * sd, 0, nz * sd], [sd > 0 ? s.uv.u1 : s.uv.u0, s.uv.v0]);
      const D = G.v([ax + nx * 0.03 * sd, s.cy + s.h / 2, az + nz * 0.03 * sd], [nx * sd, 0, nz * sd], [sd > 0 ? s.uv.u0 : s.uv.u1, s.uv.v0]);
      if (sd > 0) { G.tri(A, B, C); G.tri(A, C, D); } else { G.tri(A, C, B); G.tri(A, D, C); }
    }
  }
  void flat;
  const m = new THREE.Mesh(G.build(), signMaterial()); m.castShadow = false; g.add(m); return m;
}
export function pushSign(s: SignQuad) { signs.push(s); }

function nearestStation(pois: Poi[], x: number, z: number) {
  let best: string | null = null, bd = 220;
  for (const p of pois) { if (p.kind !== 16 || !p.name) continue; const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p.name; } }
  return best;
}

// ------------------------------------------------------------------------------------------------ mechanic village
function mechanicProps(sites: Area[], inp: FeatureInput, inst: (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, f: (i: number, put: (x: number, y: number, z: number, ry: number, sx?: number, sy?: number, sz?: number) => void) => void, colors?: (i: number) => RGB) => THREE.InstancedMesh | null, S: Record<string, THREE.BufferGeometry>, grp: THREE.Group) {
  const { x0, z0, size } = inp;
  const carcass: { x: number; z: number; ry: number; col: RGB }[] = [], tyres: { x: number; z: number; ry: number }[] = [], engines: { x: number; z: number; ry: number }[] = [], drums: { x: number; z: number; col: RGB }[] = [];
  const CAR: RGB[] = [[0.3, 0.15, 0.1], [0.36, 0.34, 0.31], [0.2, 0.24, 0.3], [0.38, 0.32, 0.18], [0.26, 0.1, 0.08], [0.42, 0.41, 0.4], [0.16, 0.22, 0.17], [0.33, 0.2, 0.12]];
  for (const a of sites) {
    const o = obb(a.pts); const area = o.hl * o.hw * 4;
    const n = Math.min(260, Math.floor(area / 38));
    const seed = Math.floor(o.cx * 7 + o.cz * 13);
    for (let k = 0; k < n * 3 && carcass.length + tyres.length + engines.length + drums.length < n * 1.4 + 40; k++) {
      const hx = hash(seed + k, 1), hz = hash(seed + k, 2);
      const lx = (hx * 2 - 1) * o.hl, lz = (hz * 2 - 1) * o.hw; const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
      const x = o.cx + lx * ca - lz * sa, z = o.cz + lx * sa + lz * ca;
      if (x < x0 || x >= x0 + size || z < z0 || z >= z0 + size) continue;
      if (!pointInPoly(x, z, a.pts) || inp.blocked(x, z) || inp.onRoad(x, z)) continue;
      const r = hash(seed + k, 3);
      if (r < 0.3) carcass.push({ x, z, ry: hash(seed + k, 4) * 6.28, col: CAR[Math.floor(hash(seed + k, 5) * CAR.length)] });
      else if (r < 0.58) tyres.push({ x, z, ry: hash(seed + k, 4) * 6.28 });
      else if (r < 0.74) engines.push({ x, z, ry: hash(seed + k, 4) * 6.28 });
      else drums.push({ x, z, col: [[0.1, 0.25, 0.55], [0.55, 0.12, 0.1], [0.12, 0.12, 0.13], [0.2, 0.4, 0.2]][Math.floor(hash(seed + k, 6) * 4)] as RGB });
    }
  }
  // rusty zinc workshop sheds: open front, three corrugated walls, mono-pitch roof, a tilted oil-black pad inside
  const SG = vcGeo(); const RUSTS: RGB[] = [[0.45, 0.24, 0.14], [0.52, 0.3, 0.18], [0.38, 0.22, 0.15], [0.55, 0.52, 0.48], [0.34, 0.3, 0.27]];
  for (const a of sites) {
    const o = obb(a.pts); const area = o.hl * o.hw * 4; const ns = Math.min(40, Math.floor(area / 650)); const seed = Math.floor(o.cx * 5 + o.cz * 11);
    for (let k = 0, made = 0; k < ns * 6 && made < ns; k++) {
      const lx = (hash(seed + k, 21) * 2 - 1) * (o.hl - 5), lz = (hash(seed + k, 22) * 2 - 1) * (o.hw - 4); const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
      const x = o.cx + lx * ca - lz * sa, z = o.cz + lx * sa + lz * ca; if (x < x0 + 4 || x >= x0 + size - 4 || z < z0 + 4 || z >= z0 + size - 4) continue;
      const w = 7 + hash(seed + k, 23) * 5, d = 4.5 + hash(seed + k, 24) * 2.5, h = 2.5 + hash(seed + k, 25) * 0.6;
      let ok = true; for (const [cx2, cz2] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]]) { const px = x + cx2 * ca - cz2 * sa, pz = z + cx2 * sa + cz2 * ca; if (!pointInPoly(px, pz, a.pts) || inp.blocked(px, pz) || inp.onRoad(px, pz)) { ok = false; break; } }
      if (!ok) continue; made++;
      const c1 = RUSTS[Math.floor(hash(seed + k, 26) * RUSTS.length)], c2 = RUSTS[Math.floor(hash(seed + k, 27) * RUSTS.length)];
      const ry = o.ang; const cx = x - x0, cz = z - z0; const R = (px: number, pz: number): [number, number] => [cx + px * ca - pz * sa, cz + px * sa + pz * ca];
      const bx = (px: number, pz: number, y0: number, bw: number, bh: number, bd: number, col: RGB) => { const [qx, qz] = R(px, pz); addBox(SG, qx, y0, qz, bw, bh, bd, ry, col); };
      bx(0, -d / 2 + 0.05, 0, w, h, 0.1, c1 as RGB);
      bx(-w / 2 + 0.05, 0, 0, 0.1, h * 0.92, d, c2 as RGB);
      bx(w / 2 - 0.05, 0, 0, 0.1, h * 0.92, d, c1 as RGB);
      const P = (px: number, pz: number, y: number): V3 => { const [qx, qz] = R(px, pz); return [qx, y, qz]; };
      addQuad(SG, P(-w / 2 - 0.3, -d / 2 - 0.3, h + 0.5), P(w / 2 + 0.3, -d / 2 - 0.3, h + 0.5), P(w / 2 + 0.3, d / 2 + 0.4, h - 0.2), P(-w / 2 - 0.3, d / 2 + 0.4, h - 0.2), c2 as RGB, undefined, {}, true);
      for (let r = 0; r < 3; r++) bx(-w / 2 + 0.5 + r * (w - 1) / 2, d / 2 - 0.1, 0, 0.14, h - 0.2, 0.14, [0.22, 0.2, 0.19]);
      for (let r = 0; r < 3; r++) bx(-w / 2 + 1 + r * 0.9, 0.6, 0.02, 0.5 + hash(seed + k, 30 + r) * 1.2, 0.015, 0.6, [0.04, 0.035, 0.03]);
    }
  }
  if (SG.count) { const m = new THREE.Mesh(SG.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.5, side: THREE.DoubleSide })); m.castShadow = true; m.receiveShadow = true; grp.add(m); }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.2 });
  inst(S.carcass, mat, carcass.length, (i, put) => { const c = carcass[i]; put(c.x - x0, 0, c.z - z0, c.ry, 1); }, (i) => carcass[i].col);
  inst(S.tyres, mat, tyres.length, (i, put) => { const c = tyres[i]; put(c.x - x0, 0, c.z - z0, c.ry, 0.9 + hash(i, 9) * 0.3); });
  inst(S.engine, mat, engines.length, (i, put) => { const c = engines[i]; put(c.x - x0, 0, c.z - z0, c.ry, 1); });
  inst(S.drum, mat, drums.length, (i, put) => { const c = drums[i]; put(c.x - x0, 0, c.z - z0, 0, 1); }, (i) => drums[i].col);
}
export { glassMat };
