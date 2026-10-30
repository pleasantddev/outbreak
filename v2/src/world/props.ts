// Street furniture and vegetation for a tile: sodium street lights on the big roads, PHCN poles with sagging
// wires along the streets, almond, mango and palm trees, rooftop water tanks, dishes and starter bars.
import * as THREE from 'three';
import { hash } from './geo';
import { powerShared, POWER_GLSL } from '../systems/power';
import { SOLAR_GLSL } from './lamps';
import { ROAD, RF, type Road } from './region';
import { halfWidth, verge, isMajor } from './roadspec';

function leafTexture(kind: 'broad' | 'palm') {
  const N = 512; const c = document.createElement('canvas'); c.width = N; c.height = N; const g = c.getContext('2d')!;
  g.clearRect(0, 0, N, N);
  if (kind === 'broad') {
    // a clump of real leaf shapes: darker and denser in the middle, lit tips at the rim
    for (let i = 0; i < 900; i++) {
      const rr = Math.random() ** 0.55 * 0.46 * N, a0 = Math.random() * 6.28;
      const x = N / 2 + Math.cos(a0) * rr, y = N / 2 + Math.sin(a0) * rr * 0.92;
      const len = 13 + Math.random() * 15, w = len * (0.34 + Math.random() * 0.12), a = a0 + (Math.random() - 0.5) * 1.6;
      const edge = rr / (0.46 * N);
      const l = 13 + edge * 16 + Math.random() * 9; const hue = 78 + Math.random() * 30; const sat = 28 + Math.random() * 22;
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = `hsl(${hue}, ${sat}%, ${l}%)`;
      g.beginPath(); g.moveTo(-len / 2, 0); g.quadraticCurveTo(0, -w, len / 2, 0); g.quadraticCurveTo(0, w, -len / 2, 0); g.fill();
      g.strokeStyle = `hsla(${hue}, ${sat}%, ${l + 10}%, .6)`; g.lineWidth = 1; g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke();
      g.restore();
    }
    // twigs
    g.strokeStyle = 'rgba(58,44,30,.85)'; g.lineWidth = 2.2;
    for (let i = 0; i < 9; i++) { const a = Math.random() * 6.28; g.beginPath(); g.moveTo(N / 2, N / 2); g.quadraticCurveTo(N / 2 + Math.cos(a + 0.4) * 60, N / 2 + Math.sin(a + 0.4) * 60, N / 2 + Math.cos(a) * N * 0.3, N / 2 + Math.sin(a) * N * 0.3); g.stroke(); }
  } else {
    g.strokeStyle = '#4a5e2a'; g.lineWidth = 5; g.beginPath(); g.moveTo(N / 2, N - 4); g.quadraticCurveTo(N / 2 + 24, N / 2, N / 2, 10); g.stroke();
    for (let i = 0; i < 70; i++) {
      const t = i / 70; const y = N - 6 - t * (N - 20); const len = 150 * Math.sin(t * Math.PI) ** 0.8 + 16; const cx = N / 2 + 24 * Math.sin(t * Math.PI) * (1 - t);
      for (const sd of [-1, 1]) { const l = 18 + Math.random() * 16; g.strokeStyle = `hsl(${74 + Math.random() * 18}, ${36 + Math.random() * 14}%, ${l}%)`; g.lineWidth = 4.5 - t * 2; g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + sd * len * 0.55, y - 14, cx + sd * len, y + 30); g.stroke(); }
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; return t;
}
/** Crowns light like a volume, not like a stack of cards: every leaf normal points out from the crown centre. */
function sphereNormals(g: THREE.BufferGeometry, cx: number, cy: number, cz: number, sy = 1) {
  const p = g.attributes.position, n = g.attributes.normal as THREE.BufferAttribute; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.set(p.getX(i) - cx, (p.getY(i) - cy) / sy, p.getZ(i) - cz).normalize(); v.y = v.y * 0.8 + 0.25; v.normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  n.needsUpdate = true; return g;
}
let mats: Record<string, THREE.Material> | null = null;
let geos: Record<string, THREE.BufferGeometry> | null = null;
export const propShared = { uNight: { value: 0 }, uEmit: { value: 0 } };

/** Part of a merged template: geometry plus the per-vertex surface data the shared prop materials read. */
interface Part { g: THREE.BufferGeometry; color?: [number, number, number]; /** roughness, metalness, emissive, foliage */ p?: [number, number, number, number]; /** remap the 0..1 uv into this rectangle of the atlas: u0, v0, u1, v1 */ uv?: [number, number, number, number]; /** collapse every uv to the centre of the rectangle (flat colour patch) */ flat?: boolean }
/** Merges template parts into one geometry with position, normal, uv, colour and a packed (rough, metal, emissive, foliage) attribute. */
function mergeTemplate(parts: Part[]) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], pp: number[] = [], idx: number[] = []; let o = 0;
  for (const part of parts) {
    const gi = part.g.index ? part.g.toNonIndexed() : part.g;
    const P = gi.attributes.position, N = gi.attributes.normal, U = gi.attributes.uv; const n = P.count;
    const c = part.color ?? [1, 1, 1], q = part.p ?? [0.8, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i));
      let u0 = U ? U.getX(i) : 0, v0 = U ? U.getY(i) : 0;
      if (part.uv) { const [a0, b0, a1, b1] = part.uv; if (part.flat) { u0 = (a0 + a1) / 2; v0 = (b0 + b1) / 2; } else { u0 = a0 + u0 * (a1 - a0); v0 = b0 + v0 * (b1 - b0); } }
      uv.push(u0, v0); col.push(c[0], c[1], c[2]); pp.push(q[0], q[1], q[2], q[3]); idx.push(o + i);
    }
    o += n;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); m.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  m.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); m.setAttribute('aP', new THREE.Float32BufferAttribute(pp, 4)); m.setIndex(idx);
  return m;
}
/** One 1024 atlas for everything leafy or woody: broad leaves, palm fronds, bark and palm bark patches. */
function propAtlas(broad: THREE.CanvasTexture, palm: THREE.CanvasTexture) {
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d')!;
  g.drawImage(broad.image as CanvasImageSource, 0, 0, 512, 512); g.drawImage(palm.image as CanvasImageSource, 512, 0, 512, 512);
  g.fillStyle = '#3e3226'; g.fillRect(0, 512, 256, 512); g.fillStyle = '#5e5142'; g.fillRect(256, 512, 256, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; return t;
}
const UV_BROAD: [number, number, number, number] = [0, 0.5, 0.5, 1], UV_PALM: [number, number, number, number] = [0.5, 0.5, 1, 1], UV_BARK: [number, number, number, number] = [0.02, 0.02, 0.23, 0.48], UV_PBARK: [number, number, number, number] = [0.27, 0.02, 0.48, 0.48];

/** Shared solid prop material: vertex colours, per-vertex roughness / metalness and a night emissive channel (lamp heads), one program for every pole, lamp and rooftop thing. */
function solidMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, emissive: new THREE.Color(0xffb060) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uEmit = propShared.uEmit; sh.uniforms.uGrid = powerShared.uGrid;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aP; varying vec4 vP; varying vec3 vPW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = aP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#ifdef USE_INSTANCING\nvPW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vP; varying vec3 vPW; uniform float uEmit;' + POWER_GLSL + SOLAR_GLSL)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vP.x;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vP.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = emissive * vP.z * uEmit * max(gridAt(vPW.xz), solarLamp(vPW.xz));');
  };
  m.customProgramCacheKey = () => 'hl-prop-solid';
  return m;
}
function init() {
  if (mats) return;
  const leafBroad = leafTexture('broad'), leafPalm = leafTexture('palm');
  const atlas = propAtlas(leafBroad, leafPalm);
  const solid = solidMaterial();
  mats = {
    solid,
    // trees and palms: trunk and foliage share the atlas, so a whole tree is one draw call
    foliage: new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.88, envMapIntensity: 0.45, emissive: new THREE.Color(0x0d1a06), alphaToCoverage: true }),
    wire: new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.85 }),
  };
  const lampPole = new THREE.CylinderGeometry(0.07, 0.11, 9, 8).translate(0, 4.5, 0);
  const arm = new THREE.BoxGeometry(0.08, 0.08, 2.0).translate(0, 8.9, 0.95);
  const head = new THREE.BoxGeometry(0.35, 0.14, 0.7).translate(0, 8.85, 1.95);
  // broad tree: trunk + several leaf card clusters
  const trunkParts = [new THREE.CylinderGeometry(0.15, 0.27, 4.4, 8).translate(0, 2.2, 0)];
  for (let i = 0; i < 4; i++) { const b = new THREE.CylinderGeometry(0.05, 0.1, 2.0, 5).translate(0, 1.0, 0); b.rotateZ(0.75); b.rotateY(i * 1.6 + 0.3); b.translate(0, 3.6 + (i % 2) * 0.5, 0); trunkParts.push(b); }
  const trunk = mergeAll(trunkParts);
  const crown: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const sz = 2.4 + (i % 4) * 0.45; const p = new THREE.PlaneGeometry(sz, sz); const a = (i / 18) * Math.PI * 2.0;
    p.rotateY(a); p.rotateX((((i * 7) % 5) / 4 - 0.5) * 1.1);
    const r = 0.6 + ((i * 5) % 7) / 7 * 1.3, h = 4.5 + ((i * 3) % 5) * 0.42;
    p.translate(Math.cos(i * 2.4) * r, h, Math.sin(i * 2.4) * r); crown.push(p);
  }
  const palmTrunk = new THREE.CylinderGeometry(0.15, 0.24, 8, 8, 6).translate(0, 4, 0);
  { const pp = palmTrunk.attributes.position; for (let i = 0; i < pp.count; i++) { const y = pp.getY(i); pp.setX(i, pp.getX(i) + Math.sin(y * 0.35) * 0.25 * (y / 8)); } palmTrunk.computeVertexNormals(); }
  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) { const p = new THREE.PlaneGeometry(1.5, 4.6, 1, 4).translate(0, 2.3, 0); const pa = p.attributes.position; for (let k = 0; k < pa.count; k++) { const y = pa.getY(k); pa.setZ(k, -((y / 4.6) ** 2) * 1.6); } p.rotateX(-1.0 - (i % 3) * 0.28); p.rotateY((i / 14) * Math.PI * 2 + (i % 2) * 0.2); p.translate(0.25, 7.95, 0); fronds.push(p); }
  // leaves dissolve when the camera pushes into a crown, so the view never fills with foliage
  { const m = mats.foliage as THREE.MeshStandardMaterial;
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n float camD = length(vViewPosition); if (camD < 4.5 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > (camD - 1.5) / 3.0) discard;'); };
    m.customProgramCacheKey = () => 'hl-leaf-atlas'; }
  const crownG = sphereNormals(mergeAll(crown), 0, 5.3, 0, 0.8), frondG = sphereNormals(mergeAll(fronds), 0.25, 7.6, 0, 0.6);
  geos = {
    // street light: pole, arm and head in one template; the head glows at night
    lamp: mergeTemplate([{ g: lampPole, color: [0.49, 0.5, 0.51], p: [0.45, 0.8, 0, 0] }, { g: arm, color: [0.49, 0.5, 0.51], p: [0.45, 0.8, 0, 0] }, { g: head, color: [0.16, 0.16, 0.16], p: [0.5, 0.6, 1, 0] }]),
    // PHCN pole: colour comes from the instance (wood or concrete)
    util: mergeTemplate([{ g: new THREE.CylinderGeometry(0.11, 0.15, 9, 6).translate(0, 4.5, 0), p: [0.9, 0, 0, 0] }, { g: new THREE.BoxGeometry(1.6, 0.1, 0.1).translate(0, 8.5, 0), p: [0.9, 0, 0, 0] }]),
    tree: mergeTemplate([{ g: trunk, uv: UV_BARK, flat: true, p: [0.95, 0, 0, 0] }, { g: crownG, uv: UV_BROAD, p: [0.88, 0, 0, 1] }]),
    palm: mergeTemplate([{ g: palmTrunk, uv: UV_PBARK, flat: true, p: [0.95, 0, 0, 0] }, { g: frondG, uv: UV_PALM, p: [0.8, 0, 0, 1] }]),
    tank: mergeTemplate([{ g: new THREE.BoxGeometry(1.3, 0.6, 1.3).translate(0, 0.3, 0), color: [0.08, 0.08, 0.08], p: [0.45, 0, 0, 0] }, { g: new THREE.CylinderGeometry(0.75, 0.75, 1.5, 14).translate(0, 0.75 + 0.6, 0), color: [0.08, 0.08, 0.08], p: [0.45, 0, 0, 0] }]),
    rebar: mergeTemplate([{ g: new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4).translate(0, 0.7, 0), color: [0.35, 0.23, 0.16], p: [0.7, 0.6, 0, 0] }]),
    dish: mergeTemplate([{ g: new THREE.SphereGeometry(0.45, 10, 6, 0, Math.PI * 2, 0, 0.9).rotateX(-1.2).translate(0, 0.8, 0), color: [0.87, 0.87, 0.87], p: [0.4, 0.3, 0, 0] }]),
  };
}
function mergeAll(list: THREE.BufferGeometry[]) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = []; let o = 0;
  for (const g of list) { const gi = g.toNonIndexed(); pos.push(...gi.attributes.position.array); nrm.push(...gi.attributes.normal.array); uv.push(...gi.attributes.uv.array); const c = gi.attributes.position.count; for (let i = 0; i < c; i++) idx.push(o + i); o += c; }
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); m.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); m.setIndex(idx); return m;
}

/** Creates the shared prop geometry, leaf textures and materials now instead of inside the first tile build. */
export function warmProps() { init(); }

export interface PropInput { x0: number; z0: number; size: number; roads: Road[]; trees: { x: number; z: number; palm: boolean; s: number }[]; tanks: number[]; bars: number[]; dishes: number[]; blocked: (x: number, z: number) => boolean; poleBad?: (x: number, z: number) => boolean }

export function buildProps(inp: PropInput) {
  init();
  const M = mats!, Gs = geos!;
  const g = new THREE.Group();
  const lamps: number[] = [], poles: number[] = [], wires: number[] = [];
  const inTile = (x: number, z: number) => x >= inp.x0 && x < inp.x0 + inp.size && z >= inp.z0 && z < inp.z0 + inp.size;
  for (const r of inp.roads) {
    if (r.flags & (RF.bridge | RF.tunnel)) continue;
    const major = isMajor(r.cls) || r.cls === ROAD.tertiary;
    const street = r.cls === ROAD.residential || r.cls === ROAD.unclassified || r.cls === ROAD.tertiary;
    if (!major && !street) continue;
    const hw = halfWidth(r), vg = verge(r);
    const p = r.pts; let acc = hash(r.id, 1) * 30;
    let lastPole: [number, number] | null = null;
    for (let k = 0; k < p.length / 2 - 1; k++) {
      const ax = p[k * 2], az = p[k * 2 + 1], bx = p[k * 2 + 2], bz = p[k * 2 + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      const step = major ? 34 : 38;
      for (let s = (step - (acc % step)) % step; s < L; s += step) {
        const side = major ? ((Math.floor((acc + s) / step) % 2) * 2 - 1) : 1;
        // lamps sit just behind the kerb; where the verge is narrow the walking line (roadnet.ts) would touch them, so they step back behind it
        const walkLine = hw + Math.min(vg * 0.45, 2.2) + 0.3;
        let off = hw + (major ? 0.55 : vg + 0.6); if (Math.abs(off - walkLine) < 0.8) off = walkLine + 0.85;
        const x = ax + tx * s - tz * off * side, z = az + tz * s + tx * off * side;
        if (!inTile(x, z) || inp.blocked(x, z) || (inp.poleBad && inp.poleBad(x, z))) { lastPole = null; continue; }
        if (major) lamps.push(x, z, Math.atan2(tz * side, -tx * side) + Math.PI);
        else { poles.push(x, z, Math.atan2(tx, tz)); if (lastPole && Math.hypot(lastPole[0] - x, lastPole[1] - z) < 60) { for (const dl of [-0.6, 0, 0.6]) { const cx2 = Math.cos(Math.atan2(tx, tz)) * dl, cz2 = -Math.sin(Math.atan2(tx, tz)) * dl; for (let q = 0; q < 6; q++) { const t0 = q / 6, t1 = (q + 1) / 6; const sag = (t: number) => 8.45 - 0.9 * 4 * t * (1 - t); wires.push(lastPole[0] + (x - lastPole[0]) * t0 + cx2, sag(t0), lastPole[1] + (z - lastPole[1]) * t0 + cz2, lastPole[0] + (x - lastPole[0]) * t1 + cx2, sag(t1), lastPole[1] + (z - lastPole[1]) * t1 + cz2); } } } lastPole = [x, z]; }
      }
      acc += L;
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
  /** One instanced draw per kind. `k` tags the mesh so the streamer can hide each kind at its own distance. */
  const inst = (k: string, geo: THREE.BufferGeometry, mat: THREE.Material, list: number[], stride: number, f: (i: number) => [number, number, number, number, number], shadow: boolean, color?: THREE.Color) => {
    const n = list.length / stride; if (!n) return null;
    const im = new THREE.InstancedMesh(geo, mat, n); im.castShadow = shadow; im.receiveShadow = true; im.userData.k = k;
    for (let i = 0; i < n; i++) { const [x, y, z, ry, s] = f(i); q.setFromAxisAngle(up, ry); sc.set(s, s, s); m4.compose(pv.set(x, y, z), q, sc); im.setMatrixAt(i, m4); if (color) im.setColorAt(i, color); }
    im.computeBoundingSphere(); g.add(im); return im;
  };
  const lampF = (i: number): [number, number, number, number, number] => [lamps[i * 3], 0, lamps[i * 3 + 1], lamps[i * 3 + 2], 1];
  inst('lamp', Gs.lamp, M.solid, lamps, 3, lampF, true);
  const poleF = (i: number): [number, number, number, number, number] => [poles[i * 3], 0, poles[i * 3 + 1], poles[i * 3 + 2], 1];
  inst('util', Gs.util, M.solid, poles, 3, poleF, false, new THREE.Color(hash(Math.floor(inp.x0), 3) > 0.5 ? 0x4a3828 : 0x9a9890));
  if (wires.length) { const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3)); const w = new THREE.LineSegments(wg, M.wire); w.userData.k = 'util'; g.add(w); }
  const broad = inp.trees.filter((t) => !t.palm && inTile(t.x, t.z)), palms = inp.trees.filter((t) => t.palm && inTile(t.x, t.z));
  const tf = (list: typeof broad) => (i: number): [number, number, number, number, number] => [list[i].x, 0, list[i].z, list[i].s * 6.28, 0.75 + list[i].s * 0.6];
  inst('tree', Gs.tree, M.foliage, broad.flatMap((t) => [t.x, t.z]), 2, tf(broad), true);
  inst('tree', Gs.palm, M.foliage, palms.flatMap((t) => [t.x, t.z]), 2, tf(palms), true);
  // rooftop clutter (tanks, starter bars, dishes) is baked into one static mesh: a few hundred small things, one draw call, no shadows
  { const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], pp: number[] = [], idx: number[] = []; let base = 0;
    const nm = new THREE.Matrix3(); const v = new THREE.Vector3();
    const bake = (geo: THREE.BufferGeometry, x: number, y: number, z: number, ry: number) => {
      q.setFromAxisAngle(up, ry); m4.compose(pv.set(x, y, z), q, sc.set(1, 1, 1)); nm.getNormalMatrix(m4);
      const P = geo.attributes.position, N = geo.attributes.normal, C = geo.attributes.color, A = geo.attributes.aP, I = geo.index!;
      for (let i = 0; i < P.count; i++) {
        v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(m4); pos.push(v.x, v.y, v.z); v.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(nm).normalize(); nrm.push(v.x, v.y, v.z);
        uv.push(0, 0); col.push(C.getX(i), C.getY(i), C.getZ(i)); pp.push(A.getX(i), A.getY(i), A.getZ(i), A.getW(i));
      }
      for (let i = 0; i < I.count; i++) idx.push(base + I.getX(i)); base += P.count;
    };
    for (let i = 0; i < inp.tanks.length / 4; i++) bake(Gs.tank, inp.tanks[i * 4], inp.tanks[i * 4 + 1], inp.tanks[i * 4 + 2], inp.tanks[i * 4 + 3] * 6);
    for (let i = 0; i < inp.bars.length / 3; i++) bake(Gs.rebar, inp.bars[i * 3], inp.bars[i * 3 + 1], inp.bars[i * 3 + 2], i);
    for (let i = 0; i < inp.dishes.length / 4; i++) bake(Gs.dish, inp.dishes[i * 4], inp.dishes[i * 4 + 1], inp.dishes[i * 4 + 2], inp.dishes[i * 4 + 3]);
    if (idx.length) {
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      cg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); cg.setAttribute('aP', new THREE.Float32BufferAttribute(pp, 4)); cg.setIndex(idx); cg.computeBoundingSphere();
      const cm = new THREE.Mesh(cg, M.solid); cm.userData.k = 'clutter'; cm.receiveShadow = true; cm.castShadow = false; g.add(cm);
    }
  }
  return { group: g, lamps };
}
export function setPropNight(n: number) { propShared.uEmit.value = n * 6; }
