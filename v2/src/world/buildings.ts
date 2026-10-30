// Lagos buildings from OSM footprints: raised plinth, painted plaster or bare block, windows with frames,
// burglar bars and louvres, shopfronts with roller shutters, parapet roofs, long-span aluminium hip roofs,
// unfinished shells with starter bars. One merged mesh per tile, PBR from the wall texture array.
import { lampShared, LAMP_GLSL } from './lamps';
import { powerShared, POWER_GLSL } from '../systems/power';
import * as THREE from 'three';
import { BK, type Building } from './region';
import { Geo, hash, polyArea, obb, slice } from './geo';
import type { TexSet } from './texsets';

export const buildingShared = { uNight: { value: 0 }, uWet: { value: 0 }, uDust: { value: 0 }, uBT: { value: 0 } };
export const FLOOR = 3.1, PLINTH = 0.45;

const PAINT: [number, number, number][] = [
  [0.95, 0.9, 0.78], [0.96, 0.83, 0.64], [0.9, 0.7, 0.45], [0.7, 0.84, 0.66], [0.66, 0.8, 0.9], [0.94, 0.74, 0.72], [0.97, 0.96, 0.93],
  [0.82, 0.55, 0.38], [0.98, 0.9, 0.55], [0.8, 0.86, 0.78], [0.88, 0.88, 0.84], [0.6, 0.72, 0.62], [0.93, 0.8, 0.86],
];
const ROOFC: [number, number, number][] = [[0.55, 0.58, 0.62], [0.2, 0.35, 0.6], [0.6, 0.18, 0.15], [0.22, 0.42, 0.26], [0.42, 0.28, 0.18], [0.72, 0.72, 0.7], [0.15, 0.15, 0.17]];

export interface BuildingTile { mesh: THREE.Mesh; roofProps: { tanks: number[]; bars: number[] }; heights: Map<number, number> }

export function buildingHeight(b: Building) {
  if (b.height > 0) return Math.max(2.4, b.height);
  if (b.kind === BK.terminal) return 6.8;
  if (b.kind === BK.market) return 5.5 + hash(b.id, 6) * 1.5;
  if (b.kind === BK.station) return 5.2;
  if (b.kind === BK.shed) return 2.6;
  if (b.kind === BK.warehouse) return 6.5 + hash(b.id, 4) * 3;
  if (b.kind === BK.church || b.kind === BK.mosque) return 7 + hash(b.id, 5) * 4;
  if (b.kind === BK.canopy) return 4.5;
  return PLINTH + b.levels * FLOOR + (b.kind === BK.shops ? 0.5 : 0);
}

export interface BuildingOut { geo: THREE.BufferGeometry; tanks: number[]; bars: number[]; dishes: number[] }
export function buildBuildings(list: Building[], ox: number, oz: number): BuildingOut { const g = buildBuildingsG(list, ox, oz); for (;;) { const r = g.next(); if (r.done) return r.value; } }
/** Same as buildBuildings, but a generator that yields whenever the current time slice is used up. */
export function* buildBuildingsG(list: Building[], ox: number, oz: number): Generator<void, BuildingOut, void> {
  const G = new Geo({ aMat: 1, aTint: 3, aInfo: 4, aEdge: 2 });
  const tanks: number[] = [], bars: number[] = [], dishes: number[] = [];
  for (const b of list) {
    if (slice.due()) yield;
    let p = Array.from(b.pts).map((v, i) => v - (i % 2 === 0 ? ox : oz));
    if (p.length < 6) continue;
    if (polyArea(p) < 0) { const q: number[] = []; for (let i = p.length / 2 - 1; i >= 0; i--) q.push(p[i * 2], p[i * 2 + 1]); p = q; }
    const n = p.length / 2;
    const r1 = hash(b.id, 1), r2 = hash(b.id, 2), r3 = hash(b.id, 3);
    const H = buildingHeight(b);
    const unfinished = b.kind === BK.unfinished;
    const shed = b.kind === BK.shed || b.kind === BK.canopy || b.kind === BK.terminal || b.kind === BK.market;
    const lv = b.height > 0 ? Math.max(1, Math.round((H - PLINTH) / FLOOR)) : b.levels;
    // wall material layer: 0 paint, 1 worn paint, 2 plaster, 3 block, 4 brick, 5 concrete, 6 zinc
    let mat = r1 < 0.7 ? 0 : r1 < 0.8 ? 1 : 2;
    if (unfinished) mat = 3; else if (shed) mat = r2 < 0.6 ? 6 : 3; else if (b.kind === BK.warehouse) mat = r2 < 0.5 ? 5 : 6; else if (b.kind === BK.church && r2 < 0.4) mat = 4;
    const rgb = (c: number) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    const tint = b.wallRGB != null ? rgb(b.wallRGB) : unfinished || mat >= 3 ? [1, 1, 1] : PAINT[Math.floor(r2 * PAINT.length)];
    const kind = b.kind;
    const ob = obb(p);
    const rect = Math.abs(polyArea(p)) / (4 * ob.hl * ob.hw) > 0.86 && n <= 8;
    const tagged = b.roof >= 1 && b.roof <= 3 && rect && !shed && b.area < 1500;
    const hipRoof = tagged || (!unfinished && b.roof === 0 && rect && lv <= 2 && (kind === BK.house) && b.area < 420 && r3 < 0.72);
    const gable = tagged && b.roof === 1, pyramid = tagged && b.roof === 3;
    const parapet = !hipRoof && !shed && !unfinished && kind !== BK.warehouse ? 0.95 : 0;
    const info = [lv, r3 * 100, kind, 1];
    // walls
    for (let i = 0; i < n; i++) {
      if (kind === BK.terminal) break; // open-sided bus terminal: roof on columns, built in features.ts
      const j = (i + 1) % n; const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.05) continue;
      const nn: [number, number, number] = [dz / L, 0, -dx / L];
      const top = H + parapet;
      const a = G.v([ax, 0, az], nn, [0, 0], { aMat: [mat], aTint: tint, aInfo: info, aEdge: [L, H] });
      const c = G.v([bx, 0, bz], nn, [L, 0], { aMat: [mat], aTint: tint, aInfo: info, aEdge: [L, H] });
      const d = G.v([bx, top, bz], nn, [L, top], { aMat: [mat], aTint: tint, aInfo: info, aEdge: [L, H] });
      const e = G.v([ax, top, az], nn, [0, top], { aMat: [mat], aTint: tint, aInfo: info, aEdge: [L, H] });
      G.tri(a, d, c); G.tri(a, e, d);
      if (parapet) { // inner face of the parapet
        const ni: [number, number, number] = [-nn[0], 0, -nn[2]]; const ix = -nn[0] * 0.2, iz = -nn[2] * 0.2;
        const a2 = G.v([ax + ix, H, az + iz], ni, [0, H], { aMat: [5], aTint: [0.85, 0.85, 0.82], aInfo: [0, 0, 0, 2], aEdge: [L, H] });
        const c2 = G.v([bx + ix, H, bz + iz], ni, [L, H], { aMat: [5], aTint: [0.85, 0.85, 0.82], aInfo: [0, 0, 0, 2], aEdge: [L, H] });
        const d2 = G.v([bx + ix, top, bz + iz], ni, [L, top], { aMat: [5], aTint: [0.85, 0.85, 0.82], aInfo: [0, 0, 0, 2], aEdge: [L, H] });
        const e2 = G.v([ax + ix, top, az + iz], ni, [0, top], { aMat: [5], aTint: [0.85, 0.85, 0.82], aInfo: [0, 0, 0, 2], aEdge: [L, H] });
        G.tri(a2, c2, d2); G.tri(a2, d2, e2);
        const t1 = G.v([ax, top, az], [0, 1, 0], [ax, az], { aMat: [5], aTint: tint, aInfo: [0, 0, 0, 2], aEdge: [L, H] });
        const t2 = G.v([bx, top, bz], [0, 1, 0], [bx, bz], { aMat: [5], aTint: tint, aInfo: [0, 0, 0, 2], aEdge: [L, H] });
        const t3 = G.v([bx + ix, top, bz + iz], [0, 1, 0], [bx + ix, bz + iz], { aMat: [5], aTint: tint, aInfo: [0, 0, 0, 2], aEdge: [L, H] });
        const t4 = G.v([ax + ix, top, az + iz], [0, 1, 0], [ax + ix, az + iz], { aMat: [5], aTint: tint, aInfo: [0, 0, 0, 2], aEdge: [L, H] });
        G.tri(t1, t2, t3); G.tri(t1, t3, t4);
      }
    }
    if (hipRoof) {
      // long-span aluminium (or tiles), 22 degree hip with eaves
      const ca = Math.cos(ob.ang), sa = Math.sin(ob.ang);
      const ov = 0.5, hl = ob.hl + ov, hw = ob.hw + ov, rise = Math.tan((20 + r1 * 8) * Math.PI / 180) * hw;
      const W = (lx: number, lz: number, y: number): [number, number, number] => [ob.cx + lx * ca - lz * sa, y, ob.cz + lx * sa + lz * ca];
      const y0 = H - 0.15, rl = gable ? hl : pyramid ? 0 : Math.max(0, hl - hw);
      const tiles = r2 > 0.8;
      const rc = b.roofRGB != null ? rgb(b.roofRGB) : tiles ? [0.75, 0.42, 0.3] : ROOFC[Math.floor(r3 * ROOFC.length)];
      const rmat = tiles ? 7 : 6;
      const c0 = W(-hl, -hw, y0), c1 = W(hl, -hw, y0), c2 = W(hl, hw, y0), c3 = W(-hl, hw, y0), q0 = W(-rl, 0, y0 + rise), q1 = W(rl, 0, y0 + rise);
      const face = (pts: [number, number, number][]) => {
        // plain arithmetic: this runs for every roof face of every house, so no Vector3 allocations
        const [p0, p1, p2] = pts;
        const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2], e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; let nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const al = Math.hypot(e1x, e1y, e1z) || 1; const axx = e1x / al, axy = e1y / al, axz = e1z / al;
        let ux = ny * axz - nz * axy, uy = nz * axx - nx * axz, uz = nx * axy - ny * axx; nl = Math.hypot(ux, uy, uz) || 1; ux /= nl; uy /= nl; uz /= nl;
        const ids = pts.map((pt) => { const vx = pt[0] - p0[0], vy = pt[1] - p0[1], vz = pt[2] - p0[2]; return G.v(pt, [nx, ny, nz], [vx * axx + vy * axy + vz * axz, vx * ux + vy * uy + vz * uz], { aMat: [rmat], aTint: rc, aInfo: [0, r3 * 100, 0, 3], aEdge: [0, 0] }); });
        // winding: make the face point up
        const tri = (a: number, b: number, c: number) => { const pa = pts[a], pb = pts[b], pc = pts[c]; const ny2 = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]); if (ny2 >= 0) G.tri(ids[a], ids[b], ids[c]); else G.tri(ids[a], ids[c], ids[b]); };
        if (pts.length === 3) tri(0, 1, 2); else { tri(0, 1, 2); tri(0, 2, 3); }
      };
      face([c0, c1, q1, q0]); face([c2, c3, q0, q1]); face([c1, c2, q1]); face([c3, c0, q0]);
      // soffit underneath the eaves
      const s0 = G.v(c0, [0, -1, 0], [0, 0], { aMat: [2], aTint: [0.8, 0.8, 0.78], aInfo: [0, 0, 0, 2], aEdge: [0, 0] }), s1 = G.v(c1, [0, -1, 0], [1, 0], { aMat: [2], aTint: [0.8, 0.8, 0.78], aInfo: [0, 0, 0, 2], aEdge: [0, 0] }), s2 = G.v(c2, [0, -1, 0], [1, 1], { aMat: [2], aTint: [0.8, 0.8, 0.78], aInfo: [0, 0, 0, 2], aEdge: [0, 0] }), s3 = G.v(c3, [0, -1, 0], [0, 1], { aMat: [2], aTint: [0.8, 0.8, 0.78], aInfo: [0, 0, 0, 2], aEdge: [0, 0] });
      G.tri(s0, s2, s1); G.tri(s0, s3, s2);
    } else {
      // flat slab (or mono-pitch zinc for sheds)
      const contour = Array.from({ length: n }, (_, k) => new THREE.Vector2(p[k * 2], p[k * 2 + 1]));
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { tris = []; }
      const rmat = shed ? 6 : 5;
      const rt = b.roofRGB != null ? rgb(b.roofRGB) : shed ? ROOFC[Math.floor(r3 * ROOFC.length)] : [0.78, 0.77, 0.74];
      const base = G.count;
      for (let k = 0; k < n; k++) G.v([p[k * 2], H + (shed ? 0.25 : 0), p[k * 2 + 1]], [0, 1, 0], [p[k * 2], p[k * 2 + 1]], { aMat: [rmat], aTint: rt, aInfo: [0, r3 * 100, 0, 3], aEdge: [0, 0] });
      for (const t of tris) G.tri(base + t[0], base + t[2], base + t[1]);
      // rooftop life: black water tanks, satellite dishes, starter bars on unfinished storeys
      if (!shed && b.area > 60 && lv >= 2 && !unfinished && r1 > 0.3) tanks.push(ob.cx + ox + Math.cos(ob.ang) * ob.hl * 0.5, H, ob.cz + oz + Math.sin(ob.ang) * ob.hl * 0.5, r2);
      if (!shed && !unfinished && r2 > 0.55) dishes.push(ob.cx + ox - Math.cos(ob.ang) * ob.hl * 0.6, H + parapet, ob.cz + oz - Math.sin(ob.ang) * ob.hl * 0.6, r3 * 6.28);
      if (unfinished || (lv >= 1 && r3 > 0.86 && kind === BK.house)) {
        const ca = Math.cos(ob.ang), sa = Math.sin(ob.ang);
        const nx = Math.max(1, Math.round(ob.hl / 2.2)), nz = Math.max(1, Math.round(ob.hw / 2.2));
        for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
          if (ix > 0 && ix < nx && iz > 0 && iz < nz) continue;
          const lx = -ob.hl + 0.2 + (ix / nx) * (ob.hl * 2 - 0.4), lz = -ob.hw + 0.2 + (iz / nz) * (ob.hw * 2 - 0.4);
          bars.push(ob.cx + ox + lx * ca - lz * sa, H, ob.cz + oz + lx * sa + lz * ca);
        }
      }
    }
  }
  return { geo: G.build(), tanks, bars, dishes };
}

export function makeBuildingMaterial(tex: TexSet) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = { uWD: { value: tex.diff }, uWN: { value: tex.nor }, uWA: { value: tex.arm }, ...buildingShared, ...lampShared, ...powerShared };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMat; attribute vec3 aTint; attribute vec4 aInfo; attribute vec2 aEdge; varying float vMat; varying vec3 vTint; varying vec4 vInfo; varying vec2 vEdge; varying vec2 vUv2; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUv2 = uv; vMat = aMat; vTint = aTint; vInfo = aInfo; vEdge = aEdge; vWN = normalize(mat3(modelMatrix) * normal);')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform highp sampler2DArray uWD; uniform highp sampler2DArray uWN; uniform highp sampler2DArray uWA; uniform float uNight; uniform float uWet; uniform float uDust; uniform float uBT;
varying float vMat; varying vec3 vTint; varying vec4 vInfo; varying vec2 vEdge; varying vec2 vUv2; varying vec3 vWP; varying vec3 vWN;
float bh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(bh(i), bh(i+vec2(1,0)), f.x), mix(bh(i+vec2(0,1)), bh(i+vec2(1,1)), f.x), f.y); }
vec3 signCol(float r){ vec3 c = vec3(0.78, 0.12, 0.1); c = mix(c, vec3(0.1, 0.34, 0.62), step(0.17, r)); c = mix(c, vec3(0.95, 0.78, 0.15), step(0.34, r)); c = mix(c, vec3(0.1, 0.5, 0.28), step(0.5, r)); c = mix(c, vec3(0.93, 0.93, 0.9), step(0.64, r)); c = mix(c, vec3(0.9, 0.42, 0.12), step(0.78, r)); c = mix(c, vec3(0.45, 0.12, 0.38), step(0.9, r)); return c; }
float pat(float x, float duty){ float f = fract(x); float w = max(fwidth(x), 1e-4); float m = smoothstep(duty - w, duty + w, f); return mix(m, 1.0 - duty, smoothstep(0.3, 0.8, w)); }
float wav(float x){ return sin(x) * (1.0 - smoothstep(0.8, 2.4, fwidth(x))); }
${LAMP_GLSL}
${POWER_GLSL}
vec3 BC; vec3 BN; float BR; float BAO; float BM; float BE; vec3 BEC; float BGL;`)
      .replace('#include <map_fragment>', `
{
  float layer = floor(vMat + 0.5);
  vec2 uv = vUv2 / (layer >= 6.0 ? 2.2 : 3.0);
  if (vInfo.w > 2.5) uv = vUv2 / 2.2; // roof faces use their own planar coords
  BC = texture(uWD, vec3(uv, layer)).rgb; vec3 a = texture(uWA, vec3(uv, layer)).rgb; vec3 nt = texture(uWN, vec3(uv, layer)).rgb * 2.0 - 1.0;
  BAO = a.r; BR = a.g; BM = a.b; BE = 0.0; BEC = vec3(0.0); BGL = 0.0;
  if (layer > 0.5 && layer < 1.5) BC = mix(vec3(dot(BC, vec3(0.33))), BC, 0.4) * 1.15; // tame the peeling-paint texture
  BC *= vTint;
  if (layer < 2.5) BC = mix(BC, BC * vec3(0.95, 0.9, 0.85), bn(vWP.xz * 0.3) * 0.3);
  float isWall = step(0.5, vInfo.w) * step(vInfo.w, 1.5);
  if (vInfo.w > 3.5 && vInfo.w < 4.5) { // metal gate: vertical bars over a plate, pointed tops
    float u = vUv2.x, v = vUv2.y, H = vEdge.y, L = vEdge.x;
    float bar = pat(u * 6.0, 0.75); float plate = step(v, H * 0.55);
    float mid = 1.0 - step(0.04, abs(u - L * 0.5));
    BC = vTint * mix(0.85, 1.0, bar) * (plate > 0.5 ? 1.0 : 0.9); BC *= 1.0 - mid * 0.5;
    BM = 0.3; BR = 0.5 + 0.2 * bn(vUv2 * 3.0); BN = vec3(0.0, 0.0, 1.0);
    if (plate < 0.5 && bar < 0.5) { BC = vec3(0.0); }
  }
  if (vInfo.w > 4.5 && vInfo.w < 5.5) { // compound wall: coping band and dirt splash
    float v = vUv2.y, H = vEdge.y;
    BC *= mix(0.68, 1.0, smoothstep(0.0, 0.9, v));
    BC *= 1.0 - step(H - 0.12, v) * 0.15;
  }
  BN = nt;
  if (isWall > 0.5) {
    // varyings of a constant attribute can come out a few ULP off, which a sin-hash turns into per-pixel noise, so snap them
    float levels = floor(vInfo.x + 0.5), seed = floor(vInfo.y * 16.0 + 0.5) / 16.0, kind = floor(vInfo.z + 0.5);
    float u = vUv2.x, v = vUv2.y, L = vEdge.x, H = vEdge.y;
    float rs = bh(vec2(seed, 1.0)), rs2 = bh(vec2(seed, 2.0));
    // power: a window only glows when its feeder has light, or when the building runs a generator (about 1 in 5, nearly half of the flats, hotels and banks): dimmer, warmer, a little unsteady
    float gridOn = gridAt(vWP.xz);
    float genThr = (kind > 2.5 && kind < 4.5) || (kind > 12.5 && kind < 13.5) ? 0.45 : 0.2;
    float genOn = step(1.0 - genThr, bh(vec2(seed, 31.0)));
    float flick = 0.75 + 0.25 * bn(vec2(uBT * 2.5, seed));
    float pw = max(gridOn, genOn * 0.5 * flick);
    float genOnly = (1.0 - gridOn) * genOn;
    // plinth, ground splash, parapet cap
    BC = mix(BC, BC * vec3(0.62, 0.58, 0.55), 1.0 - smoothstep(0.34, 0.46, v));
    BC *= mix(0.82, 1.0, smoothstep(0.45, 1.8, v));
    BC *= 1.0 - smoothstep(H - 0.16, H - 0.1, v) * 0.16;
    // bay grid: 3 m columns, 3.1 m storeys above a 0.45 m plinth
    float colW = 3.0; float nC = floor(L / colW); float off = (L - nC * colW) * 0.5;
    float cu = (u - off) / colW; float ci = floor(cu); float cf = fract(cu);
    float inCols = step(0.0, cu) * step(cu, nC) * step(1.0, nC);
    float fy = (v - 0.45) / 3.1; float fi = floor(fy); float ff = fract(fy) * 3.1;
    // slab edge at every upper floor and a faint rain streak under it
    float slab = step(1.0, fi) * (1.0 - smoothstep(0.0, 0.1, ff));
    BC *= 1.0 - slab * 0.2;
    BC *= 1.0 + step(1.0, fi) * smoothstep(0.1, 0.14, ff) * (1.0 - smoothstep(0.14, 0.24, ff)) * 0.05;
    float streak = bh(vec2(ci, seed)) * smoothstep(1.0, 0.0, ff - 0.9) * step(0.9, ff) * inCols;
    BC *= 1.0 - streak * 0.1 * step(abs(cf - 0.5), 0.2);
    bool glassBk = (kind > 12.5 && kind < 13.5) || (kind > 14.5 && kind < 15.5);
    if (glassBk && v > 0.6 && v < H - 0.35) {
      // curtain wall: tinted glass in 1.5 m bays, dark mullions, spandrel at each slab
      float bay = fract(u / 1.5); float mul1 = step(bay, 0.04) + step(0.96, bay);
      float sp = fract((v - 0.45) / 3.1) * 3.1; float spand = step(sp, 0.35) + step(2.95, sp);
      float fx2 = u * 0.7 + v * 0.35;
      vec3 gl = mix(vec3(0.1, 0.24, 0.3), vec3(0.42, 0.62, 0.7), 0.5 + 0.5 * sin(fx2 + bn(vec2(u * 0.4, v * 0.3)) * 3.0));
      float fr = min(1.0, mul1 + spand);
      BC = mix(gl, vec3(0.3, 0.31, 0.33), fr); BR = mix(0.25, 0.55, fr); BM = mix(0.1, 0.2, fr); BGL = 1.0 - fr;
      BN = vec3(0.0, 0.0, 1.0);
      BE += (1.0 - fr) * uNight * 0.55 * pw; BEC = vec3(0.85, 0.95, 1.0);
    }
    bool shop = kind > 1.5 && kind < 2.5 && fi < 1.0 && fi >= 0.0;
    float rnd = bh(vec2(ci, fi + seed));
    if (shop && inCols > 0.5) {
      float pil = step(cf, 0.06) + step(0.94, cf);
      float bayX = (cf - 0.06) / 0.88;
      float zone = (1.0 - pil) * step(0.1, ff) * step(ff, 2.55);
      float awn = step(0.6, bh(vec2(ci, seed + 9.0)));
      vec3 shutC = mix(vec3(0.5, 0.52, 0.54), vec3(0.56, 0.2, 0.14), step(0.62, rnd)); shutC = mix(shutC, vec3(0.17, 0.35, 0.52), step(0.82, rnd)); shutC = mix(shutC, vec3(0.2, 0.42, 0.28), step(0.92, rnd));
      float open = step(0.5, bh(vec2(ci, seed + 4.0)));
      float row = floor(ff * 2.2); float shelf = pat(ff * 2.2, 0.45);
      vec3 goods = mix(vec3(0.45), vec3(bh(vec2(floor(bayX * 7.0), row + seed)), bh(vec2(floor(bayX * 7.0) + 3.0, row + seed)), bh(vec2(floor(bayX * 7.0) + 7.0, row + seed))), 0.45);
      vec3 inside = vec3(0.07, 0.06, 0.05) + goods * 0.16 * shelf + vec3(0.32, 0.24, 0.14) * (1.0 - ff / 2.6) * 0.12;
      float rib = 0.88 + 0.12 * wav(v * 55.0);
      vec3 shopC = open > 0.5 ? inside : shutC * rib * (0.92 + 0.08 * bn(vec2(u * 2.0, v * 3.0)));
      BC = mix(BC, shopC, zone);
      BR = mix(BR, open > 0.5 ? 0.7 : 0.6, zone); BM = mix(BM, open > 0.5 ? 0.0 : 0.15, zone);
      BE += zone * open * uNight * 0.3 * pw; BEC = vec3(1.0, 0.72, 0.4);
      // frame lines round the bay opening
      float fl = (1.0 - pil) * (step(ff, 0.16) * step(0.1, ff) + step(2.49, ff) * step(ff, 2.55) + step(bayX, 0.03) + step(0.97, bayX) * step(0.1, ff) * step(ff, 2.55));
      BC = mix(BC, BC * 0.55, min(fl, 1.0) * zone);
      // fabric awning over some bays
      float aw = awn * (1.0 - pil) * step(2.1, ff) * step(ff, 2.6);
      vec3 ac1 = mix(vec3(0.78, 0.14, 0.1), vec3(0.14, 0.4, 0.62), step(0.5, bh(vec2(ci, seed + 12.0)))); ac1 = mix(ac1, vec3(0.16, 0.5, 0.3), step(0.8, bh(vec2(ci, seed + 13.0))));
      BC = mix(BC, mix(ac1, vec3(0.93, 0.92, 0.88), pat(u * 2.6, 0.5)) * (0.78 + 0.22 * (ff - 2.1) * 2.0), aw);
      BE += (aw * open * uNight * 0.2 + (1.0 - pil) * step(1.7, ff) * step(ff, 2.1) * awn * open * uNight * 0.5) * pw;
      // painted signboard: flat colour, border line, blocky letters
      float sr = bh(vec2(ci, seed + 7.0));
      vec3 sc = signCol(sr);
      float sz = step(2.62, ff) * step(ff, 3.08);
      float sedge = step(ff, 2.68) + step(3.02, ff) + step(cf, 0.04) + step(0.96, cf);
      float lu = cf * 16.0; float lc = floor(lu); float lf = fract(lu);
      float ltr = step(0.42, bh(vec2(lc + ci * 31.0, seed))) * step(0.18, lf) * step(lf, 0.78) * step(2.74, ff) * step(ff, 2.96) * step(0.14, cf) * step(cf, 0.86);
      ltr *= 1.0 - step(0.5, bh(vec2(lc, seed + 2.0))) * step(0.42, fract(ff * 4.8)) * step(fract(ff * 4.8), 0.58);
      vec3 ink = mix(vec3(0.97, 0.95, 0.9), vec3(0.08), step(0.34, sr) * step(sr, 0.5) + step(0.64, sr) * step(sr, 0.78));
      vec3 sBC = mix(sc, ink, ltr); sBC = mix(sBC, ink, min(sedge, 1.0) * 0.8);
      BC = mix(BC, sBC, sz); BR = mix(BR, 0.5, sz); BM = mix(BM, 0.0, sz);
      BE += sz * uNight * 0.18 * (1.0 - ltr) * pw;
    } else if (fi >= 0.0 && fi < levels && inCols * step(0.1, bh(vec2(ci * 3.1, seed + 17.0 + step(fi, 0.5) * 9.0))) > 0.5 && kind != 6.0 && kind != 7.0 && kind != 5.0 && kind != 11.0 && kind != 10.0 && kind != 14.0 && kind != 16.0 && kind != 13.0 && kind != 15.0) {
      bool unfinished = kind > 8.5 && kind < 9.5;
      bool door = fi < 0.5 && ci == floor(bh(vec2(seed, 3.0)) * nC);
      float bal = (!door && fi >= 1.0 && rs > 0.5 && bh(vec2(ci + 5.0, fi + seed)) > 0.55 && !unfinished) ? 1.0 : 0.0;
      float ww = door ? 0.18 : (bal > 0.5 ? 0.28 : 0.21), wb = door ? 0.0 : (bal > 0.5 ? 0.1 : 0.95), wt = door ? 2.25 : 2.3;
      float win = step(0.5 - ww, cf) * step(cf, 0.5 + ww) * step(wb, ff) * step(ff, wt);
      float acOn = step(0.74, bh(vec2(ci * 1.7 + seed, fi + 3.0))) * (1.0 - bal) * (door ? 0.0 : 1.0) * (unfinished ? 0.0 : 1.0) * step(0.5, rs2 + 0.2);
      if (win > 0.5) {
        float fx = (cf - (0.5 - ww)) / (2.0 * ww), fyy = (ff - wb) / (wt - wb);
        float frame = 1.0 - step(0.055, fx) * step(fx, 0.945) * step(0.05, fyy) * step(fyy, 0.95);
        float mid = (1.0 - step(0.03, abs(fx - 0.5))) * (1.0 - step(0.5, bal));
        float transom = step(abs(fyy - 0.72), 0.018) * (1.0 - step(0.5, bal)) * step(0.5, rs);
        float fm = max(max(frame, mid), transom);
        if (unfinished) { BC = vec3(0.05); BR = 0.95; BN = vec3(0.0, 0.0, 1.0); }
        else if (door) { BC = mix(vec3(0.16, 0.1, 0.06), vec3(0.3, 0.3, 0.32), step(0.5, rnd)); BC = mix(BC, BC * 1.4, step(0.5, fract(fx * 5.0)) * 0.3); BR = 0.55; BM = step(0.5, rnd) * 0.2; BN = vec3(0.0, 0.0, 1.0); BC *= 1.0 - frame * 0.3; }
        else {
          vec3 glass = mix(vec3(0.5, 0.62, 0.72), vec3(0.1, 0.14, 0.2), fyy) * (0.72 + 0.28 * bh(vec2(ci * 3.0, fi)));
          float ty = rnd;
          float louv = step(0.4, ty) * step(ty, 0.62);
          float curt = step(0.62, ty) * step(ty, 0.85);
          float dark = step(0.85, ty);
          glass = mix(glass, glass * (0.55 + 0.45 * pat(fyy * 10.0, 0.5)) + 0.05, louv);
          vec3 cc = mix(vec3(0.86, 0.8, 0.68), vec3(0.62, 0.3, 0.26), step(0.5, bh(vec2(ci + 2.0, fi + seed)))); cc = mix(cc, vec3(0.45, 0.58, 0.5), step(0.8, bh(vec2(ci + 4.0, fi + seed))));
          cc *= 0.7 + 0.3 * wav(fx * 26.0) * (1.0 - fyy * 0.4);
          glass = mix(glass, cc, curt);
          glass = mix(glass, vec3(0.03, 0.03, 0.035), dark);
          // recessed look: shadow along the top and left reveal
          glass *= 1.0 - (1.0 - smoothstep(0.0, 0.16, 1.0 - fyy)) * 0.35 * (1.0 - curt) - (1.0 - smoothstep(0.0, 0.1, fx)) * 0.2;
          vec3 frc = mix(vec3(0.9, 0.9, 0.88), vec3(0.3, 0.2, 0.12), step(0.55, bh(vec2(seed, 11.0))));
          BC = mix(glass, frc, fm); BR = mix(0.3, 0.55, fm); BM = 0.0; BGL = 1.0 - fm;
          BN = vec3(0.0, 0.0, 1.0);
          float lit = step(0.55, bh(vec2(ci + seed, fi * 7.0))) * uNight;
          BE += pw * lit * (1.0 - fm) * (1.0 - dark * 0.9) * (curt > 0.5 ? 1.5 : 1.15); BEC = mix(vec3(1.0, 0.72, 0.4), vec3(0.7, 0.85, 1.0), step(0.78, rnd * 0.0 + bh(vec2(ci, fi + seed + 9.0))));
          // burglar bars on the low floors: upright bars, two rails, white or black paint
          float barOn = step(rs2, 0.65) * (1.0 - step(1.5, fi)) * (1.0 - step(0.5, bal));
          float bars = max(pat(fx * 8.0, 0.8), max(step(abs(fyy - 0.5), 0.022), step(abs(fyy - 0.18), 0.018))) * barOn;
          vec3 barC = mix(vec3(0.05), vec3(0.9, 0.9, 0.87), step(0.55, bh(vec2(seed, 5.0))));
          BC = mix(BC, barC, bars * 0.95); BR = mix(BR, 0.55, bars); BM = mix(BM, 0.1, bars); BE *= 1.0 - bars;
        }
      } else {
        // sill below, lintel shadow above, only round windows
        float wx = step(0.5 - ww - 0.04, cf) * step(cf, 0.5 + ww + 0.04);
        BC = mix(BC, vec3(0.8, 0.78, 0.74), wx * step(wb - 0.09, ff) * step(ff, wb) * (1.0 - bal));
        BC *= 1.0 - wx * step(wb - 0.4, ff) * step(ff, wb - 0.09) * 0.1 * (1.0 - bal);
        BC *= 1.0 - wx * step(wt, ff) * step(ff, wt + 0.09) * 0.2;
      }
      // balcony: concrete slab edge and railing in front of the door
      if (bal > 0.5) {
        float rx = step(0.5 - 0.35, cf) * step(cf, 0.5 + 0.35);
        float slabE = rx * step(ff, 0.12);
        float rail = rx * step(0.12, ff) * step(ff, 1.06);
        float bar = pat(u * 9.0, 0.62) * step(ff, 1.0) + step(1.0, ff) * step(ff, 1.06);
        BC = mix(BC, vec3(0.74, 0.72, 0.68), slabE);
        BC = mix(BC, vec3(0.12, 0.12, 0.13), rail * min(bar, 1.0) * 0.95);
        BC *= 1.0 - rx * step(1.06, ff) * 0.0;
      }
      // split AC unit in the gap beside the window, with a stain under it
      if (acOn > 0.5) {
        float au = (cf - 0.74) / 0.2, av = (ff - 1.45) / 0.5;
        float inU = step(0.0, au) * step(au, 1.0) * step(0.0, av) * step(av, 1.0);
        vec3 acc = vec3(0.86, 0.87, 0.88) * (0.9 + 0.1 * av);
        acc = mix(acc, vec3(0.3), step(av, 0.16) * 0.5);
        float fan = 1.0 - smoothstep(0.26, 0.3, length(vec2(au - 0.5, (av - 0.52) * 0.8)));
        acc = mix(acc, vec3(0.1, 0.1, 0.12), fan * 0.7);
        BC = mix(BC, acc, inU); BR = mix(BR, 0.45, inU);
        float st = step(0.82, cf) * step(cf, 0.86) * step(1.0, ff) * step(ff, 1.45);
        BC *= 1.0 - st * 0.12;
      }
      // floor slab band
      BC *= 1.0 - (1.0 - step(0.08, ff)) * step(1.0, fi) * 0.0;
    }
    BEC = mix(BEC, vec3(1.0, 0.55, 0.22), genOnly);
    // weathering patches
    BC *= mix(0.86, 1.04, bn(vec2(u * 0.35, v * 0.5) + seed));
  }
  BC = mix(BC, vec3(0.62, 0.5, 0.38), uDust * 0.15);
  BC *= mix(1.0, 0.72, uWet * step(layer, 5.5)); BR = mix(BR, BR * 0.6, uWet);
  diffuseColor.rgb = BC;
}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(BR, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = clamp(BM, 0.0, 1.0);')
      .replace('#include <normal_fragment_maps>', `{
        vec3 Nw = normalize(vWN); vec3 T = abs(Nw.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : normalize(vec3(-Nw.z, 0.0, Nw.x)); vec3 B = cross(Nw, T);
        vec3 nw = normalize(T * BN.x * 0.8 + B * BN.y * 0.8 + Nw * max(BN.z, 0.2));
        normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
      }`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= BAO;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += BEC * BE + lampLight(vWP, normalize(vWN)) * BC;');
  };
  m.customProgramCacheKey = () => 'hl-building';
  return m;
}
