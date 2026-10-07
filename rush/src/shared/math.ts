// Small deterministic math helpers shared by client, server and tools.

export interface V2 { x: number; z: number }
export interface V3 { x: number; y: number; z: number }

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrapAngle = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const approach = (v: number, target: number, step: number) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
export const expDecay = (v: number, target: number, rate: number, dt: number) => target + (v - target) * Math.exp(-rate * dt);

/** Forward vector for a heading (radians). Heading 0 faces +z. */
export const fwd = (h: number): V2 => ({ x: Math.sin(h), z: Math.cos(h) });
/** Right-hand vector for a heading (y up). */
export const right = (h: number): V2 => ({ x: -Math.cos(h), z: Math.sin(h) });

// Equirectangular projection around a fixed centre. Good to a few centimetres over a couple of kilometres.
export interface Projection { lat0: number; lon0: number }
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON_EQ = 111320;
export function project(p: Projection, lat: number, lon: number): V2 {
  return { x: (lon - p.lon0) * M_PER_DEG_LON_EQ * Math.cos((p.lat0 * Math.PI) / 180), z: -(lat - p.lat0) * M_PER_DEG_LAT };
}
export function unproject(p: Projection, x: number, z: number): { lat: number; lon: number } {
  return { lat: p.lat0 - z / M_PER_DEG_LAT, lon: p.lon0 + x / (M_PER_DEG_LON_EQ * Math.cos((p.lat0 * Math.PI) / 180)) };
}

export function distSegment2(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  const qx = ax + dx * t, qz = az + dz * t;
  return { d2: (px - qx) ** 2 + (pz - qz) ** 2, t, qx, qz };
}

export function polylineLength(pts: number[][]) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }

export function polygonArea(pts: number[][]) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return a / 2; }

export function pointInPolygon(x: number, z: number, pts: number[][]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}
