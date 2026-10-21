// Flyovers and bridges: decks with kerb walls on pillars. Height ramps up from the ends of each OSM bridge way.
import * as THREE from 'three';
import { Geo } from './geo';
import { RF, type Road } from './region';
import { halfWidth, lanesOf } from './roadspec';

export interface Deck { pts: Float32Array; ys: Float32Array; hw: number }
export function deckProfile(r: Road): Deck {
  const p = r.pts; const n = p.length / 2; const s = new Float32Array(n);
  for (let k = 1; k < n; k++) s[k] = s[k - 1] + Math.hypot(p[k * 2] - p[k * 2 - 2], p[k * 2 + 1] - p[k * 2 - 1]);
  if (r.elev && r.elev.length === n) { const ye = new Float32Array(n); for (let k = 0; k < n; k++) ye[k] = r.elev[k] + 0.15; return { pts: p, ys: ye, hw: halfWidth(r) + 0.45 }; }
  const L = s[n - 1] || 1; const peak = Math.max(1, r.layer || 1) * 6.4; const ramp = Math.min(L * 0.35, 90);
  const ys = new Float32Array(n);
  for (let k = 0; k < n; k++) { const t = Math.min(s[k], L - s[k]); ys[k] = peak * Math.min(1, t / ramp) ** 0.85 + 0.15; }
  return { pts: p, ys, hw: halfWidth(r) + 0.45 };
}
let deckMat: THREE.Material | null = null, sideMat: THREE.Material | null = null;
const deckMats = new Map<string, THREE.Material>();
/** Asphalt with edge lines, lane dashes and (two-way) a double yellow centre, one 8 m period along the deck. */
function deckMaterial(lanes: number, one: boolean) {
  const key = `${lanes}${one ? 'o' : 't'}`; let m = deckMats.get(key); if (m) return m;
  const W = 256, H = 256; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!;
  g.fillStyle = '#3a3a3d'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) { const v = 40 + Math.random() * 40; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  const lineW = W * 0.012; const line = (x: number, col: string, dash: boolean) => { g.fillStyle = col; if (dash) g.fillRect(x - lineW / 2, 0, lineW, H / 2); else g.fillRect(x - lineW / 2, 0, lineW, H); };
  const inner = 0.0; void inner;
  line(W * 0.035, '#d9d8d0', false); line(W * 0.965, '#d9d8d0', false);
  if (one) { for (let i = 1; i < lanes; i++) line((W * (0.07 + (0.86 * i) / lanes)), '#d9d8d0', true); }
  else { const half = Math.max(1, Math.floor(lanes / 2)); line(W * 0.5 - lineW, '#e0b92a', false); line(W * 0.5 + lineW, '#e0b92a', false); for (let i = 1; i < half; i++) { line(W * (0.07 + (0.43 * i) / half), '#d9d8d0', true); line(W * (0.5 + (0.43 * i) / half), '#d9d8d0', true); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.88, metalness: 0 }); deckMats.set(key, m); return m;
}
export function buildBridges(roads: Road[], ox: number, oz: number, asphalt: THREE.Texture, asphaltN: THREE.Texture) {
  if (!deckMat) {
    deckMat = new THREE.MeshStandardMaterial({ map: asphalt, normalMap: asphaltN, roughness: 0.85 });
    sideMat = new THREE.MeshStandardMaterial({ color: 0xb4b0a8, roughness: 0.85 });
  }
  const tops = new Map<string, Geo>(), side = new Geo();
  const pillars: number[] = [];
  const decks: Deck[] = [];
  for (const r of roads) {
    if (!(r.flags & RF.bridge)) continue;
    const d = deckProfile(r); decks.push(d);
    const one = (r.flags & RF.oneway) !== 0; const lanes = Math.max(1, Math.min(6, lanesOf(r))); const tk = `${lanes}${one ? 'o' : 't'}`; let top = tops.get(tk); if (!top) { top = new Geo(); tops.set(tk, top); }
    const p = d.pts, n = p.length / 2; let s = 0;
    for (let k = 0; k < n - 1; k++) {
      const ax = p[k * 2] - ox, az = p[k * 2 + 1] - oz, bx = p[k * 2 + 2] - ox, bz = p[k * 2 + 3] - oz;
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L; const ya = d.ys[k], yb = d.ys[k + 1]; const w = d.hw;
      const wd = w - 0.45; // painted width excludes the kerb strip
      const a = top.v([ax + nx * w, ya, az + nz * w], [0, 1, 0], [0, s / 8]);
      const b = top.v([ax - nx * w, ya, az - nz * w], [0, 1, 0], [1, s / 8]);
      const c = top.v([bx - nx * w, yb, bz - nz * w], [0, 1, 0], [1, (s + L) / 8]);
      const e = top.v([bx + nx * w, yb, bz + nz * w], [0, 1, 0], [0, (s + L) / 8]);
      void wd;
      top.tri(a, c, b); top.tri(a, e, c); top.tri(a, b, c); top.tri(a, c, e);
      for (const sd of [1, -1]) {
        const ex = nx * w * sd, ez = nz * w * sd;
        const q0 = side.v([ax + ex, ya - 1.1, az + ez], [nx * sd, 0, nz * sd], [s, 0]), q1 = side.v([bx + ex, yb - 1.1, bz + ez], [nx * sd, 0, nz * sd], [s + L, 0]);
        const q2 = side.v([bx + ex, yb + 0.9, bz + ez], [nx * sd, 0, nz * sd], [s + L, 1]), q3 = side.v([ax + ex, ya + 0.9, az + ez], [nx * sd, 0, nz * sd], [s, 1]);
        side.tri(q0, q1, q2); side.tri(q0, q2, q3); side.tri(q0, q2, q1); side.tri(q0, q3, q2);
      }
      const u0 = side.v([ax + nx * w, ya - 1.1, az + nz * w], [0, -1, 0], [0, 0]), u1 = side.v([ax - nx * w, ya - 1.1, az - nz * w], [0, -1, 0], [0, 0]), u2 = side.v([bx - nx * w, yb - 1.1, bz - nz * w], [0, -1, 0], [0, 0]), u3 = side.v([bx + nx * w, yb - 1.1, bz + nz * w], [0, -1, 0], [0, 0]);
      side.tri(u0, u1, u2); side.tri(u0, u2, u3);
      for (let t = (28 - (s % 28)) % 28; t < L; t += 28) { const y = ya + (yb - ya) * (t / L); if (y > 3) pillars.push(ax + (bx - ax) * (t / L) + ox, y - 1.1, az + (bz - az) * (t / L) + oz); }
      s += L;
    }
  }
  const g = new THREE.Group();
  for (const [k, top] of tops) if (top.count) { const m = new THREE.Mesh(top.build(), deckMaterial(+k.slice(0, -1), k.endsWith('o'))); m.receiveShadow = true; m.castShadow = true; g.add(m); }
  if (side.count) { const m = new THREE.Mesh(side.build(), sideMat!); m.receiveShadow = true; m.castShadow = true; g.add(m); }
  if (pillars.length) {
    const pg = new THREE.CylinderGeometry(0.8, 0.9, 1, 12).translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(pg, sideMat!, pillars.length / 3); const m4 = new THREE.Matrix4();
    for (let i = 0; i < pillars.length / 3; i++) { m4.makeScale(1, pillars[i * 3 + 1], 1); m4.setPosition(pillars[i * 3] - ox, 0, pillars[i * 3 + 2] - oz); im.setMatrixAt(i, m4); }
    im.castShadow = true; im.receiveShadow = true; g.add(im);
  }
  return { group: g, decks };
}

/** Collision triangles for decks, world coordinates. */
export function deckCollision(decks: Deck[]) {
  const pos: number[] = [], idx: number[] = [];
  for (const d of decks) {
    const p = d.pts, n = p.length / 2;
    for (let k = 0; k < n - 1; k++) {
      const ax = p[k * 2], az = p[k * 2 + 1], bx = p[k * 2 + 2], bz = p[k * 2 + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const nx = -(bz - az) / L * d.hw, nz = (bx - ax) / L * d.hw;
      const o = pos.length / 3;
      pos.push(ax + nx, d.ys[k], az + nz, ax - nx, d.ys[k], az - nz, bx - nx, d.ys[k + 1], bz - nz, bx + nx, d.ys[k + 1], bz + nz);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
  }
  return { pos, idx };
}
