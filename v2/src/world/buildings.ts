// Lagos buildings from OSM footprints: raised plinth, painted plaster or bare block, windows with frames,
// burglar bars and louvres, shopfronts with roller shutters, parapet roofs, long-span aluminium hip roofs,
// unfinished shells with starter bars. One merged mesh per tile, PBR from the wall texture array.
import * as THREE from 'three';
import { BK, type Building } from './region';
import { Geo, hash, polyArea, obb } from './geo';
import type { TexSet } from './texsets';

export const buildingShared = { uNight: { value: 0 }, uWet: { value: 0 }, uDust: { value: 0 } };
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

export function buildBuildings(list: Building[], ox: number, oz: number): { geo: THREE.BufferGeometry; tanks: number[]; bars: number[]; dishes: number[] } {
  const G = new Geo({ aMat: 1, aTint: 3, aInfo: 4, aEdge: 2 });
  const tanks: number[] = [], bars: number[] = [], dishes: number[] = [];
  for (const b of list) {
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
        const e1 = new THREE.Vector3(...pts[1]).sub(new THREE.Vector3(...pts[0])), e2 = new THREE.Vector3(...pts[2]).sub(new THREE.Vector3(...pts[0]));
        const nr = e1.clone().cross(e2).normalize(); if (nr.y < 0) nr.negate();
        const ax = e1.clone().normalize(); const up = nr.clone().cross(ax).normalize();
        const ids = pts.map((pt) => { const v = new THREE.Vector3(...pt).sub(new THREE.Vector3(...pts[0])); return G.v(pt, [nr.x, nr.y, nr.z], [v.dot(ax), v.dot(up)], { aMat: [rmat], aTint: rc, aInfo: [0, r3 * 100, 0, 3], aEdge: [0, 0] }); });
        // winding: make the face point up
        const tri = (a: number, b: number, c: number) => { const pa = new THREE.Vector3(...pts[a]), pb = new THREE.Vector3(...pts[b]), pc = new THREE.Vector3(...pts[c]); const nn = pb.sub(pa).cross(pc.sub(pa)); if (nn.y >= 0) G.tri(ids[a], ids[b], ids[c]); else G.tri(ids[a], ids[c], ids[b]); };
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
  const uniforms = { uWD: { value: tex.diff }, uWN: { value: tex.nor }, uWA: { value: tex.arm }, ...buildingShared };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMat; attribute vec3 aTint; attribute vec4 aInfo; attribute vec2 aEdge; varying float vMat; varying vec3 vTint; varying vec4 vInfo; varying vec2 vEdge; varying vec2 vUv2; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUv2 = uv; vMat = aMat; vTint = aTint; vInfo = aInfo; vEdge = aEdge; vWN = normalize(mat3(modelMatrix) * normal);')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform highp sampler2DArray uWD; uniform highp sampler2DArray uWN; uniform highp sampler2DArray uWA; uniform float uNight; uniform float uWet; uniform float uDust;
varying float vMat; varying vec3 vTint; varying vec4 vInfo; varying vec2 vEdge; varying vec2 vUv2; varying vec3 vWP; varying vec3 vWN;
float bh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(bh(i), bh(i+vec2(1,0)), f.x), mix(bh(i+vec2(0,1)), bh(i+vec2(1,1)), f.x), f.y); }
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
    float bar = step(0.75, fract(u * 6.0)); float plate = step(v, H * 0.55);
    float mid = 1.0 - step(0.04, abs(u - L * 0.5));
    BC = vTint * mix(0.85, 1.0, bar) * (plate > 0.5 ? 1.0 : 0.9); BC *= 1.0 - mid * 0.5;
    BM = 0.55; BR = 0.42 + 0.2 * bn(vUv2 * 3.0); BN = vec3(0.0, 0.0, 1.0);
    if (plate < 0.5 && bar < 0.5) { BC = vec3(0.0); }
  }
  if (vInfo.w > 4.5 && vInfo.w < 5.5) { // compound wall: coping band and dirt splash
    float v = vUv2.y, H = vEdge.y;
    BC *= mix(0.68, 1.0, smoothstep(0.0, 0.9, v));
    BC *= 1.0 - step(H - 0.12, v) * 0.15;
  }
  BN = nt;
  if (isWall > 0.5) {
    float levels = vInfo.x, seed = vInfo.y, kind = vInfo.z;
    float u = vUv2.x, v = vUv2.y, L = vEdge.x, H = vEdge.y;
    // plinth and splash grime
    if (v < 0.45) { BC = mix(BC, vec3(0.42, 0.4, 0.38), 0.55); }
    BC *= mix(0.72, 1.0, smoothstep(0.0, 1.3, v));
    // rain streaks below sills and the parapet line
    float colW = 3.0; float nC = floor(L / colW); float off = (L - nC * colW) * 0.5;
    float cu = (u - off) / colW; float ci = floor(cu); float cf = fract(cu);
    float inCols = step(0.0, cu) * step(cu, nC) * step(1.0, nC);
    float fy = (v - 0.45) / 3.1; float fi = floor(fy); float ff = fract(fy) * 3.1;
    float streak = bh(vec2(ci, seed)) * smoothstep(1.0, 0.0, ff - 0.9) * step(0.9, ff) * inCols;
    BC *= 1.0 - streak * 0.18 * smoothstep(0.42, 0.58, abs(cf - 0.5) < 0.2 ? 1.0 : 0.0);
    bool glassBk = (kind > 12.5 && kind < 13.5) || (kind > 14.5 && kind < 15.5);
    if (glassBk && v > 0.6 && v < H - 0.35) {
      // curtain wall: tinted glass in 1.5 m bays, dark mullions, spandrel at each slab
      float bay = fract(u / 1.5); float mul1 = step(bay, 0.04) + step(0.96, bay);
      float sp = fract((v - 0.45) / 3.1) * 3.1; float spand = step(sp, 0.35) + step(2.95, sp);
      float fx2 = u * 0.7 + v * 0.35;
      vec3 gl = mix(vec3(0.07, 0.17, 0.22), vec3(0.34, 0.52, 0.6), 0.5 + 0.5 * sin(fx2 + bn(vec2(u * 0.4, v * 0.3)) * 3.0));
      float fr = min(1.0, mul1 + spand);
      BC = mix(gl, vec3(0.2, 0.21, 0.23), fr); BR = mix(0.12, 0.5, fr); BM = mix(0.35, 0.5, fr); BGL = 1.0 - fr;
      BN = vec3(0.0, 0.0, 1.0);
      BE += (1.0 - fr) * uNight * 0.55; BEC = vec3(0.85, 0.95, 1.0);
    }
    bool shop = kind > 1.5 && kind < 2.5 && fi < 1.0 && fi >= 0.0;
    float rnd = bh(vec2(ci, fi + seed));
    if (shop && inCols > 0.5) {
      // roller shutters and a painted signboard band
      float sh = step(0.08, cf) * step(cf, 0.92) * step(0.1, ff) * step(ff, 2.55);
      vec3 shutC = mix(vec3(0.55, 0.56, 0.58), vec3(0.62, 0.18, 0.12), step(0.7, rnd)); shutC = mix(shutC, vec3(0.12, 0.3, 0.55), step(0.86, rnd));
      float open = step(0.45, bh(vec2(ci, seed + 4.0)));
      vec3 inside = vec3(0.08, 0.07, 0.06) + vec3(0.35, 0.3, 0.22) * bn(vec2(u * 3.0, v * 4.0)) * 0.5;
      float rib = 0.85 + 0.15 * sin(v * 60.0);
      BC = mix(BC, open > 0.5 && ff < 2.2 ? inside : shutC * rib, sh); BR = mix(BR, 0.55, sh); BM = mix(BM, open > 0.5 ? 0.0 : 0.5, sh);
      BE += sh * open * uNight * 0.8; BEC = vec3(1.0, 0.85, 0.6);
      float sign = step(2.6, ff) * step(ff, 3.05);
      vec3 sc = vec3(bh(vec2(ci, 7.0 + seed)), bh(vec2(ci, 8.0 + seed)), bh(vec2(ci, 9.0 + seed)));
      BC = mix(BC, mix(sc, vec3(0.95), step(0.6, bn(vec2(u * 6.0, v * 9.0)))), sign * 0.9);
    } else if (fi >= 0.0 && fi < levels && inCols > 0.5 && kind != 6.0 && kind != 7.0 && kind != 5.0 && kind != 11.0 && kind != 10.0 && kind != 14.0 && kind != 16.0 && kind != 13.0 && kind != 15.0) {
      bool unfinished = kind > 8.5 && kind < 9.5;
      bool door = fi < 0.5 && ci == floor(bh(vec2(seed, 3.0)) * nC);
      float ww = door ? 0.18 : 0.21, wb = door ? 0.0 : 0.95, wt = door ? 2.25 : 2.3;
      float win = step(0.5 - ww, cf) * step(cf, 0.5 + ww) * step(wb, ff) * step(ff, wt);
      if (win > 0.5) {
        float fx = (cf - (0.5 - ww)) / (2.0 * ww), fyy = (ff - wb) / (wt - wb);
        float frame = 1.0 - step(0.05, fx) * step(fx, 0.95) * step(0.05, fyy) * step(fyy, 0.95);
        if (unfinished) { BC = vec3(0.03); BR = 0.95; BN = vec3(0.0, 0.0, 1.0); }
        else if (door) { BC = mix(vec3(0.12, 0.08, 0.05), vec3(0.25, 0.25, 0.27), step(0.5, rnd)); BR = 0.5; BM = step(0.5, rnd) * 0.6; BN = vec3(0.0, 0.0, 1.0); BC *= 1.0 - frame * 0.3; }
        else {
          float louvre = step(0.6, rnd);
          vec3 glass = mix(vec3(0.05, 0.06, 0.07), vec3(0.14, 0.17, 0.19), bh(vec2(ci * 3.0, fi)));
          if (louvre > 0.5) glass *= 0.75 + 0.25 * step(0.5, fract(fyy * 9.0));
          float mid = 1.0 - step(0.03, abs(fx - 0.5));
          vec3 frc = mix(vec3(0.85, 0.85, 0.83), vec3(0.24, 0.16, 0.1), step(0.55, bh(vec2(seed, 11.0))));
          BC = mix(glass, frc, max(frame, mid)); BR = mix(0.06, 0.5, max(frame, mid)); BM = mix(0.6, 0.2, max(frame, mid)); BGL = 1.0 - max(frame, mid);
          // burglar-proof bars
          float bars = step(0.9, fract(fx * 7.0)) * step(bh(vec2(seed, 2.0)), 0.75);
          BC = mix(BC, vec3(0.04), bars); BR = mix(BR, 0.4, bars); BGL *= 1.0 - bars;
          BN = vec3(0.0, 0.0, 1.0);
          float lit = step(0.55, bh(vec2(ci + seed, fi * 7.0))) * uNight;
          BE += lit * BGL * 1.4; BEC = mix(vec3(1.0, 0.75, 0.45), vec3(0.7, 0.85, 1.0), step(0.75, rnd));
        }
      } else {
        // sill and lintel shadows
        float sill = step(0.5 - ww - 0.04, cf) * step(cf, 0.5 + ww + 0.04) * step(wb - 0.08, ff) * step(ff, wb);
        BC *= 1.0 - sill * 0.35;
      }
      // floor slab band
      BC *= 1.0 - (1.0 - step(0.08, ff)) * step(1.0, fi) * 0.12;
    }
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
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += BEC * BE;');
  };
  m.customProgramCacheKey = () => 'hl-building';
  return m;
}
