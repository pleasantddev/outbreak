// Small helpers for building merged geometry.
import * as THREE from 'three';
export class Geo {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; idx: number[] = [];
  extra: Record<string, { size: number; data: number[] }> = {};
  constructor(extras: Record<string, number> = {}) { for (const [k, s] of Object.entries(extras)) this.extra[k] = { size: s, data: [] }; }
  get count() { return this.pos.length / 3; }
  v(p: [number, number, number], n: [number, number, number], uv: [number, number], ex: Record<string, number[]> = {}) {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]);
    for (const [k, e] of Object.entries(this.extra)) { const d = ex[k]; if (d) e.data.push(...d); else for (let i = 0; i < e.size; i++) e.data.push(0); }
    return this.count - 1;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const [k, e] of Object.entries(this.extra)) g.setAttribute(k, new THREE.Float32BufferAttribute(e.data, e.size));
    if (this.count > 65535) g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1)); else g.setIndex(this.idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
export function hash(n: number, s = 0) { let x = (Math.imul(n | 0, 2654435761) + Math.imul(s | 0, 97531)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967295; }
export function polyArea(p: Float32Array | number[]) { let a = 0; const n = p.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; } return a / 2; }
export function pointInPoly(x: number, z: number, p: Float32Array | number[]) {
  let c = false; const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
  return c;
}
/** Oriented bounding box via rotating calipers over edge directions. */
export function obb(p: Float32Array | number[]) {
  const n = p.length / 2; let best = { area: Infinity, ang: 0, cx: 0, cz: 0, hl: 0, hw: 0 };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; const ang = Math.atan2(p[j * 2 + 1] - p[i * 2 + 1], p[j * 2] - p[i * 2]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < n; k++) { const x = p[k * 2] * c + p[k * 2 + 1] * s, z = -p[k * 2] * s + p[k * 2 + 1] * c; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const a = (x1 - x0) * (z1 - z0);
    if (a < best.area) { const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2; best = { area: a, ang, cx: mx * c - mz * s, cz: mx * s + mz * c, hl: (x1 - x0) / 2, hw: (z1 - z0) / 2 }; }
  }
  if (best.hw > best.hl) { best = { ...best, ang: best.ang + Math.PI / 2, hl: best.hw, hw: best.hl }; }
  return best;
}
