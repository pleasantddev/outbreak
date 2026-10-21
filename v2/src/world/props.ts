// Street furniture and vegetation for a tile: sodium street lights on the big roads, PHCN poles with sagging
// wires along the streets, almond, mango and palm trees, rooftop water tanks, dishes and starter bars.
import * as THREE from 'three';
import { hash } from './geo';
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
export const propShared = { uNight: { value: 0 } };
function init() {
  if (mats) return;
  const leafBroad = leafTexture('broad'), leafPalm = leafTexture('palm');
  const lampHead = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6, emissive: new THREE.Color(0xffb060), emissiveIntensity: 0 });
  mats = {
    pole: new THREE.MeshStandardMaterial({ color: 0x7c7f82, roughness: 0.45, metalness: 0.8 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 0.9 }),
    concretePole: new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.85 }),
    lampHead,
    wire: new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.85 }),
    bark: new THREE.MeshStandardMaterial({ color: 0x3e3226, roughness: 0.95 }),
    palmBark: new THREE.MeshStandardMaterial({ color: 0x5e5142, roughness: 0.95 }),
    leaf: new THREE.MeshStandardMaterial({ map: leafBroad, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, envMapIntensity: 0.45, emissive: new THREE.Color(0x0d1a06), alphaToCoverage: true }),
    frond: new THREE.MeshStandardMaterial({ map: leafPalm, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.8, envMapIntensity: 0.45, emissive: new THREE.Color(0x0d1a06), alphaToCoverage: true }),
    tank: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.45 }),
    tankBlue: new THREE.MeshStandardMaterial({ color: 0x1d4f8c, roughness: 0.4 }),
    rebar: new THREE.MeshStandardMaterial({ color: 0x5a3a28, roughness: 0.7, metalness: 0.6 }),
    dish: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }),
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
  for (const k of ['leaf', 'frond']) {
    const m = mats[k] as THREE.MeshStandardMaterial;
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n float camD = length(vViewPosition); if (camD < 4.5 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > (camD - 1.5) / 3.0) discard;'); };
    m.customProgramCacheKey = () => 'hl-leaf-' + k;
  }
  geos = {
    lampPole, arm, head, trunk, crown: sphereNormals(mergeAll(crown), 0, 5.3, 0, 0.8), palmTrunk, fronds: sphereNormals(mergeAll(fronds), 0.25, 7.6, 0, 0.6),
    woodPole: new THREE.CylinderGeometry(0.11, 0.15, 9, 6).translate(0, 4.5, 0),
    crossArm: new THREE.BoxGeometry(1.6, 0.1, 0.1).translate(0, 8.5, 0),
    tank: new THREE.CylinderGeometry(0.75, 0.75, 1.5, 14).translate(0, 0.75 + 0.6, 0),
    stand: new THREE.BoxGeometry(1.3, 0.6, 1.3).translate(0, 0.3, 0),
    rebar: new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4).translate(0, 0.7, 0),
    dish: new THREE.SphereGeometry(0.45, 10, 6, 0, Math.PI * 2, 0, 0.9).rotateX(-1.2).translate(0, 0.8, 0),
  };
}
function mergeAll(list: THREE.BufferGeometry[]) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = []; let o = 0;
  for (const g of list) { const gi = g.toNonIndexed(); pos.push(...gi.attributes.position.array); nrm.push(...gi.attributes.normal.array); uv.push(...gi.attributes.uv.array); const c = gi.attributes.position.count; for (let i = 0; i < c; i++) idx.push(o + i); o += c; }
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); m.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); m.setIndex(idx); return m;
}

export interface PropInput { x0: number; z0: number; size: number; roads: Road[]; trees: { x: number; z: number; palm: boolean; s: number }[]; tanks: number[]; bars: number[]; dishes: number[]; blocked: (x: number, z: number) => boolean }

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
        const off = hw + (major ? 0.55 : vg + 0.6);
        const x = ax + tx * s - tz * off * side, z = az + tz * s + tx * off * side;
        if (!inTile(x, z) || inp.blocked(x, z)) { lastPole = null; continue; }
        if (major) lamps.push(x, z, Math.atan2(tz * side, -tx * side) + Math.PI);
        else { poles.push(x, z, Math.atan2(tx, tz)); if (lastPole && Math.hypot(lastPole[0] - x, lastPole[1] - z) < 60) { for (const dl of [-0.6, 0, 0.6]) { const cx2 = Math.cos(Math.atan2(tx, tz)) * dl, cz2 = -Math.sin(Math.atan2(tx, tz)) * dl; for (let q = 0; q < 6; q++) { const t0 = q / 6, t1 = (q + 1) / 6; const sag = (t: number) => 8.45 - 0.9 * 4 * t * (1 - t); wires.push(lastPole[0] + (x - lastPole[0]) * t0 + cx2, sag(t0), lastPole[1] + (z - lastPole[1]) * t0 + cz2, lastPole[0] + (x - lastPole[0]) * t1 + cx2, sag(t1), lastPole[1] + (z - lastPole[1]) * t1 + cz2); } } } lastPole = [x, z]; }
      }
      acc += L;
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: number[], stride: number, f: (i: number) => [number, number, number, number, number]) => {
    const n = list.length / stride; if (!n) return null;
    const im = new THREE.InstancedMesh(geo, mat, n); im.castShadow = true; im.receiveShadow = true;
    for (let i = 0; i < n; i++) { const [x, y, z, ry, s] = f(i); q.setFromAxisAngle(up, ry); sc.set(s, s, s); m4.compose(new THREE.Vector3(x, y, z), q, sc); im.setMatrixAt(i, m4); }
    im.computeBoundingSphere(); g.add(im); return im;
  };
  const lampF = (i: number): [number, number, number, number, number] => [lamps[i * 3], 0, lamps[i * 3 + 1], lamps[i * 3 + 2], 1];
  inst(Gs.lampPole, M.pole, lamps, 3, lampF); inst(Gs.arm, M.pole, lamps, 3, lampF); inst(Gs.head, M.lampHead, lamps, 3, lampF);
  const poleF = (i: number): [number, number, number, number, number] => [poles[i * 3], 0, poles[i * 3 + 1], poles[i * 3 + 2], 1];
  inst(Gs.woodPole, hash(Math.floor(inp.x0), 3) > 0.5 ? M.wood : M.concretePole, poles, 3, poleF); inst(Gs.crossArm, M.wood, poles, 3, poleF);
  if (wires.length) { const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3)); g.add(new THREE.LineSegments(wg, M.wire)); }
  const broad = inp.trees.filter((t) => !t.palm && inTile(t.x, t.z)), palms = inp.trees.filter((t) => t.palm && inTile(t.x, t.z));
  const tf = (list: typeof broad) => (i: number): [number, number, number, number, number] => [list[i].x, 0, list[i].z, list[i].s * 6.28, 0.75 + list[i].s * 0.6];
  inst(Gs.trunk, M.bark, broad.flatMap((t) => [t.x, t.z]), 2, tf(broad)); const cr = inst(Gs.crown, M.leaf, broad.flatMap((t) => [t.x, t.z]), 2, tf(broad)); if (cr) cr.castShadow = true;
  inst(Gs.palmTrunk, M.palmBark, palms.flatMap((t) => [t.x, t.z]), 2, tf(palms)); inst(Gs.fronds, M.frond, palms.flatMap((t) => [t.x, t.z]), 2, tf(palms));
  const tk = inp.tanks; const tankF = (i: number): [number, number, number, number, number] => [tk[i * 4], tk[i * 4 + 1], tk[i * 4 + 2], tk[i * 4 + 3] * 6, 1];
  inst(Gs.stand, M.tank, tk, 4, tankF); inst(Gs.tank, M.tank, tk, 4, tankF);
  const bf = (i: number): [number, number, number, number, number] => [inp.bars[i * 3], inp.bars[i * 3 + 1], inp.bars[i * 3 + 2], i, 1];
  inst(Gs.rebar, M.rebar, inp.bars, 3, bf);
  const df = (i: number): [number, number, number, number, number] => [inp.dishes[i * 4], inp.dishes[i * 4 + 1], inp.dishes[i * 4 + 2], inp.dishes[i * 4 + 3], 1];
  inst(Gs.dish, M.dish, inp.dishes, 4, df);
  return { group: g, lamps };
}
export function setPropNight(n: number) { init(); (mats!.lampHead as THREE.MeshStandardMaterial).emissiveIntensity = n * 6; }
