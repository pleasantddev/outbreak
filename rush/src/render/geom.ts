// A small geometry accumulator: push quads and triangles with whatever attributes a material needs, then emit one
// merged BufferGeometry. Every world chunk is built this way so a whole neighbourhood costs a handful of draw calls.
import * as THREE from 'three';

export class GeoBuilder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = [];
  extra: Record<string, { size: number; data: number[] }> = {};
  idx: number[] = [];
  private cur: Record<string, number[]> = {};
  color: [number, number, number] = [1, 1, 1];

  constructor(extras: Record<string, number> = {}) {
    for (const [k, size] of Object.entries(extras)) { this.extra[k] = { size, data: [] }; this.cur[k] = new Array(size).fill(0); }
  }
  get count() { return this.pos.length / 3; }
  set(name: string, ...v: number[]) { this.cur[name] = v; return this; }
  setColor(c: THREE.Color | [number, number, number]) { this.color = Array.isArray(c) ? c : [c.r, c.g, c.b]; return this; }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); this.col.push(this.color[0], this.color[1], this.color[2]);
    for (const k in this.extra) this.extra[k].data.push(...this.cur[k]);
    return this.count - 1;
  }

  /** Quad a-b-c-d counter-clockwise when seen from the front. Normal is computed from the corners. */
  /** Quad a-b-c-d. Without a normal the winding decides which way it faces; with one, the winding is corrected to
   *  face that way, so callers never have to think about vertex order. */
  quad(a: number[], b: number[], c: number[], d: number[], uvs: number[][] = [[0, 0], [1, 0], [1, 1], [0, 1]], normal?: number[]) {
    // the cross product of the diagonals is the quad's normal even when three of its corners are in a line
    const fn = diagonalNormal(a, b, c, d);
    if (!normal && fn[0] === 0 && fn[1] === 0 && fn[2] === 0) return; // no area: emitting it would light as NaN
    const n = normal ?? fn;
    const flip = normal ? fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2] < 0 : false;
    const i0 = this.vertex(a[0], a[1], a[2], n[0], n[1], n[2], uvs[0][0], uvs[0][1]);
    this.vertex(b[0], b[1], b[2], n[0], n[1], n[2], uvs[1][0], uvs[1][1]);
    this.vertex(c[0], c[1], c[2], n[0], n[1], n[2], uvs[2][0], uvs[2][1]);
    this.vertex(d[0], d[1], d[2], n[0], n[1], n[2], uvs[3][0], uvs[3][1]);
    if (flip) this.idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
    else this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  tri(a: number[], b: number[], c: number[], uvs: number[][] = [[0, 0], [1, 0], [0.5, 1]], normal?: number[]) {
    const fn = faceNormal(a, b, c);
    if (!normal && fn[0] === 0 && fn[1] === 0 && fn[2] === 0) return;
    const n = normal ?? fn;
    const flip = normal ? fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2] < 0 : false;
    const i0 = this.vertex(a[0], a[1], a[2], n[0], n[1], n[2], uvs[0][0], uvs[0][1]);
    this.vertex(b[0], b[1], b[2], n[0], n[1], n[2], uvs[1][0], uvs[1][1]);
    this.vertex(c[0], c[1], c[2], n[0], n[1], n[2], uvs[2][0], uvs[2][1]);
    if (flip) this.idx.push(i0, i0 + 2, i0 + 1); else this.idx.push(i0, i0 + 1, i0 + 2);
  }

  /** Axis-aligned or rotated box. Centre (x, y, z) is the middle of the bottom face. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0, uvScale = 1) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const P = (lx: number, ly: number, lz: number) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const hw = w / 2, hd = d / 2;
    const v = [P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, 0, hd), P(-hw, 0, hd), P(-hw, h, -hd), P(hw, h, -hd), P(hw, h, hd), P(-hw, h, hd)];
    const U = (a: number, b: number) => [[0, 0], [a * uvScale, 0], [a * uvScale, b * uvScale], [0, b * uvScale]];
    this.quad(v[3], v[2], v[6], v[7], U(w, h)); // +z
    this.quad(v[1], v[0], v[4], v[5], U(w, h)); // -z
    this.quad(v[2], v[1], v[5], v[6], U(d, h)); // +x
    this.quad(v[0], v[3], v[7], v[4], U(d, h)); // -x
    this.quad(v[7], v[6], v[5], v[4], U(w, d)); // top
    this.quad(v[0], v[1], v[2], v[3], U(w, d)); // bottom
  }

  /** Cylinder along y. */
  cylinder(x: number, y: number, z: number, r: number, h: number, seg = 10, caps = true, r2 = r) {
    const base = this.count;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, cx = Math.cos(a), sz = Math.sin(a);
      this.vertex(x + cx * r, y, z + sz * r, cx, 0, sz, i / seg, 0);
      this.vertex(x + cx * r2, y + h, z + sz * r2, cx, 0, sz, i / seg, 1);
    }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    if (caps) {
      const top = this.vertex(x, y + h, z, 0, 1, 0, 0.5, 0.5);
      const ring = this.count;
      for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; this.vertex(x + Math.cos(a) * r2, y + h, z + Math.sin(a) * r2, 0, 1, 0, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5); }
      for (let i = 0; i < seg; i++) this.idx.push(top, ring + i + 1, ring + i);
    }
  }

  /** Low poly UV sphere centred at (x, y, z). */
  sphere(x: number, y: number, z: number, r: number, wSeg = 8, hSeg = 6) {
    const base = this.count;
    for (let j = 0; j <= hSeg; j++) {
      const v = j / hSeg, ph = v * Math.PI;
      for (let i = 0; i <= wSeg; i++) {
        const u = i / wSeg, th = u * Math.PI * 2;
        const nx = Math.sin(ph) * Math.cos(th), ny = Math.cos(ph), nz = Math.sin(ph) * Math.sin(th);
        this.vertex(x + nx * r, y + ny * r, z + nz * r, nx, ny, nz, u, v);
      }
    }
    for (let j = 0; j < hSeg; j++) for (let i = 0; i < wSeg; i++) {
      const a = base + j * (wSeg + 1) + i, b = a + wSeg + 1;
      if (j > 0) this.idx.push(a, a + 1, b);
      if (j < hSeg - 1) this.idx.push(a + 1, b + 1, b);
    }
  }

  /** A thin strut between two points (square section), for trusses, space frames and pylons. */
  strut(a: number[], b: number[], t: number) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / L, uy = dy / L, uz = dz / L;
    // two perpendiculars
    let px = -uz, py = 0, pz = ux;
    if (Math.abs(uy) > 0.9) { px = 1; py = 0; pz = 0; }
    let pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
    let qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
    pl = Math.hypot(qx, qy, qz); qx /= pl; qy /= pl; qz /= pl;
    const h = t / 2;
    const corner = (p: number[], s1: number, s2: number) => [p[0] + (px * s1 + qx * s2) * h, p[1] + (py * s1 + qy * s2) * h, p[2] + (pz * s1 + qz * s2) * h];
    const sides: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [s1, s2] = sides[i], [t1, t2] = sides[(i + 1) % 4];
      this.quad(corner(a, s1, s2), corner(a, t1, t2), corner(b, t1, t2), corner(b, s1, s2), [[0, 0], [1, 0], [1, L], [0, L]]);
    }
  }

  build(): THREE.BufferGeometry {
    // last line of defence: a zero length normal becomes NaN in the lighting and bloom smears it over the frame
    for (let i = 0; i < this.nor.length; i += 3) {
      const x = this.nor[i], y = this.nor[i + 1], z = this.nor[i + 2];
      if (!(x * x + y * y + z * z > 1e-12)) { this.nor[i] = 0; this.nor[i + 1] = 1; this.nor[i + 2] = 0; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    for (const [k, e] of Object.entries(this.extra)) g.setAttribute(k, new THREE.Float32BufferAttribute(e.data, e.size));
    const n = this.count;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** Unit normal of triangle a b c, or [0, 0, 0] when it has no area. */
export function faceNormal(a: number[], b: number[], c: number[]) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return unit(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/** Unit normal of quad a b c d from its diagonals, or [0, 0, 0] when it has no area. */
export function diagonalNormal(a: number[], b: number[], c: number[], d: number[]) {
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
  const vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
  return unit(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

function unit(nx: number, ny: number, nz: number) {
  const l = Math.hypot(nx, ny, nz);
  return l > 1e-10 ? [nx / l, ny / l, nz / l] : [0, 0, 0];
}

/** Offset a polyline sideways (x, z pairs) with mitred joins capped at a sensible length. */
export function offsetPolyline(pts: number[][], d: number, closed = false): number[][] {
  const n = pts.length, out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[i], c = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let t1x = b[0] - a[0], t1z = b[1] - a[1], t2x = c[0] - b[0], t2z = c[1] - b[1];
    const l1 = Math.hypot(t1x, t1z) || 1, l2 = Math.hypot(t2x, t2z) || 1;
    t1x /= l1; t1z /= l1; t2x /= l2; t2z /= l2;
    if (i === 0 && !closed) { t1x = t2x; t1z = t2z; }
    if (i === n - 1 && !closed) { t2x = t1x; t2z = t1z; }
    let mx = t1x + t2x, mz = t1z + t2z; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const nx = -mz, nz = mx;
    const cosHalf = nx * -t1z + nz * t1x;
    const s = d / Math.max(0.35, cosHalf);
    out.push([b[0] + nx * s, b[1] + nz * s]);
  }
  return out;
}

/** Replace zero length or broken vertex normals with straight up, so lighting can never produce NaN. */
export function fixNormals(g: THREE.BufferGeometry) {
  const n = g.attributes.normal as THREE.BufferAttribute | undefined;
  if (!n) return g;
  let fixed = 0;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
    if (!(x * x + y * y + z * z > 1e-12)) { n.setXYZ(i, 0, 1, 0); fixed++; }
  }
  if (fixed) n.needsUpdate = true;
  return g;
}
