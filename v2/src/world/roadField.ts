// Renders the road network of one tile into two textures the ground shader reads:
//   field (RGBA16F): signed distance to the carriageway edge, signed lateral offset from the centreline,
//                    distance along the road (mod 48 m), and a packed class/lanes/flags code.
//   detail (RGBA8):  junction coverage (additive), pothole depth and id (max), ground surface code (A).
// The nearest road wins through the depth buffer, so junctions merge cleanly with no overlapping geometry.
import * as THREE from 'three';
import { RF, ROAD, type Region, type Road, type Pothole, type Area } from './region';
import { halfWidth, lanesOf, verge } from './roadspec';

const segVS = /* glsl */ `
attribute vec4 aSeg;   // x0 z0 x1 z1 (tile-local metres)
attribute vec4 aInfo;  // halfWidth, s0, code, margin
uniform vec2 uSize;    // tile size metres
uniform float uCaps;
varying vec2 vP; varying vec4 vSeg; varying vec4 vInfo;
void main(){
  vec2 a = aSeg.xy, b = aSeg.zw; vec2 d = b - a; float L = max(length(d), 0.001); vec2 t = d / L; vec2 n = vec2(-t.y, t.x);
  float R = aInfo.x + aInfo.w;
  float capR = uCaps > 0.5 ? R : 0.0;
  vec2 p = mix(a - t * capR, b + t * capR, position.x) + n * R * position.y;
  vP = p; vSeg = aSeg; vInfo = aInfo;
  gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0);
}`;
const segFS = /* glsl */ `
precision highp float;
varying vec2 vP; varying vec4 vSeg; varying vec4 vInfo;
uniform float uMode; // 0 field, 1 coverage
void main(){
  vec2 a = vSeg.xy, b = vSeg.zw; vec2 d = b - a; float L = max(length(d), 0.001); vec2 t = d / L;
  float u = dot(vP - a, t); float uc = clamp(u, 0.0, L);
  vec2 c = a + t * uc; float dist = length(vP - c);
  float side = sign(t.x * (vP.y - a.y) - t.y * (vP.x - a.x)); 
  float lat = (u > 0.0 && u < L) ? side * dist : side * abs(t.x * (vP.y - a.y) - t.y * (vP.x - a.x));
  float edge = dist - vInfo.x;
  if (edge > vInfo.w) discard;
  if (uMode > 0.5) {
    if (edge > 1.0 || u < 0.0 || u > L) discard;
    gl_FragColor = vec4(0.25, 0.0, 0.0, 0.0);
    return;
  }
  gl_FragColor = vec4(edge, lat, mod(vInfo.y + uc, 48.0), vInfo.z);
  gl_FragDepth = clamp((edge + 40.0) / 120.0, 0.0, 1.0);
}`;

const phVS = /* glsl */ `
attribute vec4 aPh; // x z radius depth
attribute float aId;
uniform vec2 uSize;
varying vec2 vL; varying float vDepth; varying float vId;
void main(){ vec2 p = aPh.xy + position.xy * aPh.z * 1.25; vL = position.xy * 1.25; vDepth = aPh.w; vId = aId; gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0); }`;
const phFS = /* glsl */ `
precision highp float;
varying vec2 vL; varying float vDepth; varying float vId;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  float ang = atan(vL.y, vL.x);
  float wob = 0.78 + 0.22 * n(vec2(ang * 1.6 + vId * 13.0, vId)) + 0.1 * n(vec2(ang * 5.0, vId * 3.0));
  float r = length(vL) / wob;
  if (r > 1.0) discard;
  float bowl = smoothstep(1.0, 0.55, r);
  gl_FragColor = vec4(0.0, bowl * clamp(vDepth / 0.3, 0.05, 1.0), fract(vId * 0.6180339), 0.0);
}`;

const polyVS = /* glsl */ `
attribute float aCode; uniform vec2 uSize; varying float vCode;
void main(){ vCode = aCode; gl_Position = vec4(position.xy / uSize * 2.0 - 1.0, 0.0, 1.0); }`;
const polyFS = /* glsl */ `precision highp float; varying float vCode; void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, vCode / 255.0); }`;

/** Surface codes written to detail.a (x/255). */
export const SURF = { soil: 0, grass: 20, pitch: 30, bush: 40, concrete: 60, market: 70, compound: 90, interlock: 100, parking: 120, wet: 140, sand: 160 } as const;

export function roadCode(r: Road) {
  const unp = r.flags & RF.unpaved ? 1 : 0, one = r.flags & RF.oneway ? 1 : 0;
  return r.cls + 16 * unp + 32 * one + 64 * Math.min(8, lanesOf(r));
}

const quad = new THREE.BufferGeometry();
quad.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, -1, 0, 1, 1, 0, 0, 1, 0], 3));
const disc = new THREE.BufferGeometry();
disc.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));

const segMat = new THREE.ShaderMaterial({ vertexShader: segVS, fragmentShader: segFS, uniforms: { uSize: { value: new THREE.Vector2() }, uMode: { value: 0 }, uCaps: { value: 1 } }, depthTest: true, depthWrite: true, side: THREE.DoubleSide });
const covMat = new THREE.ShaderMaterial({ vertexShader: segVS, fragmentShader: segFS, uniforms: { uSize: { value: new THREE.Vector2() }, uMode: { value: 1 }, uCaps: { value: 0 } }, depthTest: false, depthWrite: false, side: THREE.DoubleSide, transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
const phMat = new THREE.ShaderMaterial({ vertexShader: phVS, fragmentShader: phFS, uniforms: { uSize: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false, side: THREE.DoubleSide, transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
const polyMat = new THREE.ShaderMaterial({ vertexShader: polyVS, fragmentShader: polyFS, uniforms: { uSize: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
const cam = new THREE.Camera();

export interface TileField { field: THREE.WebGLRenderTarget; detail: THREE.WebGLRenderTarget; res: number; dispose(): void }

export interface FieldInput { x0: number; z0: number; size: number; roads: Road[]; potholes: Pothole[]; surfaces: { code: number; pts: Float32Array }[] }

export function buildTileField(renderer: THREE.WebGLRenderer, inp: FieldInput, res: number): TileField {
  const field = new THREE.WebGLRenderTarget(res, res, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  const detail = new THREE.WebGLRenderTarget(res, res, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  const S = inp.size, M = 30;
  // segments
  const seg: number[] = [], info: number[] = [];
  for (const r of inp.roads) {
    if (r.flags & (RF.bridge | RF.tunnel)) continue;
    const hw = halfWidth(r), mg = verge(r) + 1.5, code = roadCode(r);
    const p = r.pts; let s = 0;
    for (let k = 0; k < p.length / 2 - 1; k++) {
      const ax = p[k * 2] - inp.x0, az = p[k * 2 + 1] - inp.z0, bx = p[k * 2 + 2] - inp.x0, bz = p[k * 2 + 3] - inp.z0;
      const L = Math.hypot(bx - ax, bz - az);
      const R = hw + mg;
      if (Math.max(ax, bx) < -R - M || Math.min(ax, bx) > S + R + M || Math.max(az, bz) < -R - M || Math.min(az, bz) > S + R + M) { s += L; continue; }
      seg.push(ax, az, bx, bz); info.push(hw, s % 48, code, mg);
      s += L;
    }
  }
  const prev = renderer.getRenderTarget(); const prevClear = renderer.getClearColor(new THREE.Color()); const prevAlpha = renderer.getClearAlpha();
  const scene = new THREE.Scene();
  segMat.uniforms.uSize.value.set(S, S); covMat.uniforms.uSize.value.set(S, S); phMat.uniforms.uSize.value.set(S, S); polyMat.uniforms.uSize.value.set(S, S);
  let segGeo: THREE.InstancedBufferGeometry | null = null;
  if (seg.length) {
    segGeo = new THREE.InstancedBufferGeometry();
    segGeo.setAttribute('position', quad.getAttribute('position'));
    segGeo.setAttribute('aSeg', new THREE.InstancedBufferAttribute(new Float32Array(seg), 4));
    segGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(new Float32Array(info), 4));
    segGeo.instanceCount = seg.length / 4;
  }
  // field pass
  renderer.setRenderTarget(field);
  renderer.setClearColor(new THREE.Color(99, 99, 0), 1);
  renderer.clear(true, true, false);
  if (segGeo) { const m = new THREE.Mesh(segGeo, segMat); m.frustumCulled = false; scene.add(m); renderer.render(scene, cam); scene.clear(); }
  // detail: surfaces (overwrite), coverage (add), potholes (max)
  renderer.setRenderTarget(detail);
  renderer.setClearColor(new THREE.Color(0, 0, 0), 0);
  renderer.clear(true, false, false);
  if (inp.surfaces.length) {
    const pos: number[] = [], code: number[] = [];
    for (const s of inp.surfaces) {
      const n = s.pts.length / 2; if (n < 3) continue;
      const v = Array.from({ length: n }, (_, k) => new THREE.Vector2(s.pts[k * 2] - inp.x0, s.pts[k * 2 + 1] - inp.z0));
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(v, []); } catch { continue; }
      for (const t of tris) for (const k of t) { pos.push(v[k].x, v[k].y, 0); code.push(s.code); }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aCode', new THREE.Float32BufferAttribute(code, 1));
      const m = new THREE.Mesh(g, polyMat); m.frustumCulled = false; scene.add(m); renderer.render(scene, cam); scene.clear(); g.dispose();
    }
  }
  if (segGeo) { const m = new THREE.Mesh(segGeo, covMat); m.frustumCulled = false; scene.add(m); renderer.render(scene, cam); scene.clear(); }
  const ph = inp.potholes.filter((p) => p.x > inp.x0 - 4 && p.x < inp.x0 + S + 4 && p.z > inp.z0 - 4 && p.z < inp.z0 + S + 4);
  if (ph.length) {
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', disc.getAttribute('position'));
    g.setAttribute('aPh', new THREE.InstancedBufferAttribute(new Float32Array(ph.flatMap((p) => [p.x - inp.x0, p.z - inp.z0, Math.max(0.25, p.r), p.depth])), 4));
    g.setAttribute('aId', new THREE.InstancedBufferAttribute(new Float32Array(ph.map((p) => ((p.x * 7.13 + p.z * 3.71) % 97) + 1)), 1));
    g.instanceCount = ph.length;
    const m = new THREE.Mesh(g, phMat); m.frustumCulled = false; scene.add(m); renderer.render(scene, cam); scene.clear(); g.dispose();
  }
  segGeo?.dispose();
  renderer.setRenderTarget(prev); renderer.setClearColor(prevClear, prevAlpha);
  return { field, detail, res, dispose() { field.dispose(); detail.dispose(); } };
}

/** Surface polygons for a tile from landuse areas. Plots add their own later. */
export function areaSurfaces(areas: Area[]): { code: number; pts: Float32Array }[] {
  const map: Record<number, number> = { 8: SURF.grass, 9: SURF.pitch, 14: SURF.bush, 13: SURF.bush, 3: SURF.concrete, 2: SURF.concrete, 6: SURF.market, 11: SURF.parking, 10: SURF.parking, 12: SURF.parking, 21: SURF.wet, 15: SURF.grass, 4: SURF.sand, 16: SURF.sand, 17: SURF.bush, 22: SURF.grass, 23: SURF.sand };
  return areas.filter((a) => map[a.kind] !== undefined).map((a) => ({ code: map[a.kind], pts: a.pts }));
}
export { ROAD };
