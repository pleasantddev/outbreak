// Turn a downloaded glTF car into a game-ready GLB: baked transforms, nose to +Z, scaled to its real length, wheels
// split into four spinning groups at their own centres, the body merged and simplified, paint and glass materials
// named, textures shrunk to webp, meshopt compressed. Writes <out>.glb and <out>.json (wheel centres, sizes).
//   node process.mjs <scene.gltf> <out base> <json config>
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, textureCompress, reorder, quantize, join, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [,, input, outBase, cfgJson] = process.argv;
const cfg = JSON.parse(cfgJson);
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const root = doc.getRoot();
const scene = root.listScenes()[0];

// ---- matrices (column major, like glTF)
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const apply = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const applyN = (m, x, y, z) => { const v = [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z]; const l = Math.hypot(...v) || 1; return v.map((a) => a / l); };

// ---- badges, maker lettering and foreign plates come off first
const dropMats = new Set(cfg.drop ?? []);
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) if (dropMats.has(prim.getMaterial()?.getName() ?? '')) { mesh.removePrimitive(prim); prim.dispose(); }

// ---- gather every triangle in world space, tagged with its material and source primitive
const tris = []; // { mat, prim, verts: [i0,i1,i2], world positions }
const srcPrims = [];
scene.traverse((node) => {
  const mesh = node.getMesh(); if (!mesh) return;
  const M = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue;
    const pos = prim.getAttribute('POSITION'); if (!pos) continue;
    const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const P = []; for (let i = 0; i < pos.getCount(); i++) P.push(apply(M, ...pos.getElement(i, [])));
    srcPrims.push({ prim, M, P, mat: prim.getMaterial() });
    const id = srcPrims.length - 1;
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getScalar(t) : t, b = idx ? idx.getScalar(t + 1) : t + 1, c = idx ? idx.getScalar(t + 2) : t + 2;
      tris.push({ src: id, v: [a, b, c] });
    }
  }
});
// ---- orientation and scale: long horizontal axis to Z, nose to +Z, real length, wheels on y = 0
let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (const s of srcPrims) for (const p of s.P) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
const ext = mx.map((v, k) => v - mn[k]);
const front = cfg.front ?? (ext[0] > ext[2] ? '+x' : '+z');
// rotation about Y taking the front axis onto +Z
const rot = { '+z': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], '-z': [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1], '+x': [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1], '-x': [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] }[front];
let R = rot;
if (cfg.upZ) R = mul(R, [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]); // Z-up sources: rotate -90 about X first
const len0 = front.endsWith('x') ? ext[0] : ext[2];
const S = cfg.length / (cfg.upZ ? ext[1] : len0);
for (const s of srcPrims) s.P = s.P.map((p) => apply(R, ...p).map((v) => v * S));
mn = [Infinity, Infinity, Infinity]; mx = [-Infinity, -Infinity, -Infinity];
for (const s of srcPrims) for (const p of s.P) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
const off = [-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2];
for (const s of srcPrims) s.P = s.P.map((p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]]);
const L = mx[2] - mn[2], W = mx[0] - mn[0], H = mx[1] - mn[1];
const NM = mul(R, srcPrims.length ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : []);

// ---- wheels: a primitive whose triangles all sit in wheel-sized clusters at the four corners
const quad = (p) => (p[0] >= 0 ? 0 : 1) + (p[2] >= 0 ? 0 : 2); // 0 front-left(+x), 1 front-right, 2 rear-left, 3 rear-right
const triCentre = (t) => { const P = srcPrims[t.src].P; return [0, 1, 2].map((k) => (P[t.v[0]][k] + P[t.v[1]][k] + P[t.v[2]][k]) / 3); };
const bySrc = new Map();
for (const t of tris) { if (!bySrc.has(t.src)) bySrc.set(t.src, []); bySrc.get(t.src).push(t); }
const wheelSrc = new Set();
const forced = new Set(cfg.wheelMats ?? []), banned = new Set(cfg.notWheel ?? []);
for (const [src, ts] of bySrc) {
  const name = srcPrims[src].mat?.getName() ?? '';
  if (banned.has(name)) continue;
  const boxes = [0, 1, 2, 3].map(() => ({ mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity], n: 0 }));
  for (const t of ts) for (const v of t.v) { const p = srcPrims[src].P[v], b = boxes[quad(p)]; b.n++; for (let k = 0; k < 3; k++) { b.mn[k] = Math.min(b.mn[k], p[k]); b.mx[k] = Math.max(b.mx[k], p[k]); } }
  const ok = boxes.every((b) => b.n === 0 || (b.mx[1] < Math.min(1.05, H * 0.62) && (b.mx[2] - b.mn[2]) < 1.0 && (b.mx[0] - b.mn[0]) < 0.6 && Math.abs((b.mx[0] + b.mn[0]) / 2) > W * 0.22 && Math.abs((b.mx[2] + b.mn[2]) / 2) > L * 0.18));
  if ((ok && !cfg.noAutoWheels) || forced.has(name)) wheelSrc.add(src);
}
// emblems: small separate pieces on the centre line at the nose or the tail (maker badges) come off
if (!cfg.keepBadges) {
  const key = (p) => p.map((v) => Math.round(v * 2000)).join(',');
  let removed = 0;
  for (const [src, ts] of bySrc) {
    if (wheelSrc.has(src)) continue;
    const P = srcPrims[src].P;
    // union find over triangles sharing a vertex position
    const parent = ts.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const owner = new Map();
    ts.forEach((t, i) => { for (const v of t.v) { const k = key(P[v]); const o = owner.get(k); if (o === undefined) owner.set(k, i); else parent[find(i)] = find(o); } });
    const groups = new Map();
    ts.forEach((t, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
    if (groups.size < 2) continue;
    const drop = new Set();
    for (const idxs of groups.values()) {
      const gmn = [Infinity, Infinity, Infinity], gmx = [-Infinity, -Infinity, -Infinity];
      for (const i of idxs) for (const v of ts[i].v) for (let k = 0; k < 3; k++) { gmn[k] = Math.min(gmn[k], P[v][k]); gmx[k] = Math.max(gmx[k], P[v][k]); }
      const size = Math.max(gmx[0] - gmn[0], gmx[1] - gmn[1]), cx = (gmn[0] + gmx[0]) / 2, cz = (gmn[2] + gmx[2]) / 2;
      if (size < 0.24 && Math.abs(cx) < 0.12 && Math.abs(cz) > L * 0.36 && (gmx[2] - gmn[2]) < 0.2) for (const i of idxs) drop.add(i);
    }
    if (drop.size) { removed += drop.size; bySrc.set(src, ts.filter((_, i) => !drop.has(i))); }
  }
  if (removed) console.error(`badges: removed ${removed} triangles`);
}
for (const [src, ts] of bySrc) if (!ts.length) bySrc.delete(src);
// wheel centres: union of wheel triangles per corner
const wq = [0, 1, 2, 3].map(() => ({ mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity], tris: [] }));
for (const t of tris) if (wheelSrc.has(t.src)) { const c = triCentre(t), q = wq[quad(c)]; q.tris.push(t); for (const v of t.v) { const p = srcPrims[t.src].P[v]; for (let k = 0; k < 3; k++) { q.mn[k] = Math.min(q.mn[k], p[k]); q.mx[k] = Math.max(q.mx[k], p[k]); } } }
const haveWheels = wq.every((q) => q.tris.length > 0);
const wheels = haveWheels ? wq.map((q, i) => ({ q: i, x: (q.mn[0] + q.mx[0]) / 2, y: (q.mn[1] + q.mx[1]) / 2, z: (q.mn[2] + q.mx[2]) / 2, r: (q.mx[1] - q.mn[1]) / 2, w: q.mx[0] - q.mn[0] })) : [];

// ---- rebuild the document: one body mesh, four wheel meshes, all in the new frame
const buffer = root.listBuffers()[0];
function primFromTris(src, ts, centre) {
  const sp = srcPrims[src], prim = sp.prim;
  const remap = new Map(); const order = [];
  for (const t of ts) for (const v of t.v) if (!remap.has(v)) { remap.set(v, order.length); order.push(v); }
  const np = doc.createPrimitive().setMaterial(prim.getMaterial());
  const NMs = mul(R, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem);
    if (!['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0'].includes(sem)) continue;
    const el = acc.getElementSize();
    const arr = new Float32Array(order.length * el);
    order.forEach((v, i) => {
      let e = acc.getElement(v, []);
      if (sem === 'POSITION') { const p = sp.P[v]; e = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]; }
      else if (sem === 'NORMAL') { const wn = applyN(sp.M, ...e); e = applyN(NMs, ...wn); }
      for (let k = 0; k < el; k++) arr[i * el + k] = e[k];
    });
    np.setAttribute(sem, doc.createAccessor().setType(acc.getType()).setArray(arr).setBuffer(buffer));
  }
  const ind = new Uint32Array(ts.length * 3); ts.forEach((t, i) => { for (let k = 0; k < 3; k++) ind[i * 3 + k] = remap.get(t.v[k]); });
  np.setIndices(doc.createAccessor().setType('SCALAR').setArray(ind).setBuffer(buffer));
  return np;
}
const bodyMesh = doc.createMesh('body'), bodyNode = doc.createNode('body').setMesh(bodyMesh);
for (const [src, ts] of bySrc) { if (wheelSrc.has(src) && haveWheels) continue; bodyMesh.addPrimitive(primFromTris(src, ts, [0, 0, 0])); }
const newScene = doc.createScene('car').addChild(bodyNode);
wheels.forEach((w, i) => {
  const m = doc.createMesh(`wheel${i}`);
  const bySrcQ = new Map(); for (const t of wq[i].tris) { if (!bySrcQ.has(t.src)) bySrcQ.set(t.src, []); bySrcQ.get(t.src).push(t); }
  for (const [src, ts] of bySrcQ) m.addPrimitive(primFromTris(src, ts, [w.x, w.y, w.z]));
  newScene.addChild(doc.createNode(`wheel${i}`).setMesh(m).setTranslation([w.x, w.y, w.z]));
});
for (const s of root.listScenes()) if (s !== newScene) s.dispose();
root.setDefaultScene(newScene);
for (const n of root.listNodes()) if (!newScene.listChildren().includes(n)) n.dispose();
for (const m of root.listMeshes()) if (m !== bodyMesh && !m.getName().startsWith('wheel')) m.dispose();

// ---- materials: paint, glass, emissive lights keep their own names; drop what is never seen
// paint is the material with the most outward facing skin: side panels near the flanks, roof, bonnet and boot
// lids facing up. Interiors and dark trim lose on that count even when they are bigger.
const area = new Map();
for (const prim of bodyMesh.listPrimitives()) {
  const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(); let a = 0;
  for (let t = 0; t < idx.getCount(); t += 3) {
    const A = pos.getElement(idx.getScalar(t), []), B = pos.getElement(idx.getScalar(t + 1), []), C = pos.getElement(idx.getScalar(t + 2), []);
    const u = B.map((v, k) => v - A[k]), v = C.map((x, k) => x - A[k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], ar = Math.hypot(...n) / 2;
    const c = [0, 1, 2].map((k) => (A[k] + B[k] + C[k]) / 3), nl = Math.hypot(...n) || 1;
    const side = Math.abs(c[0]) > W * 0.36 && Math.sign(n[0]) === Math.sign(c[0]) && Math.abs(n[0] / nl) > 0.5 && c[1] > H * 0.25 && c[1] < H * 0.75;
    const top = n[1] / nl > 0.6 && c[1] > H * 0.55 && Math.abs(c[0]) < W * 0.4;
    if (side || top) a += ar;
  }
  const m = prim.getMaterial(); area.set(m, (area.get(m) ?? 0) + a);
}
let paint = null;
if (cfg.paint) paint = root.listMaterials().find((m) => cfg.paint.includes(m.getName())) ?? null;
else paint = [...area.entries()].filter(([m]) => m && m.getAlphaMode() !== 'BLEND' && !/glass|vidrio|window|light|luz|lamp|chrome|cromo|tyre|tire|rim/i.test(m.getName())).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
// paint baked into a texture (a whole-car atlas or a palette): find the paint's own hue from the texels under the
// outer skin, so the game can recolour just those texels and leave lights, trim and badges alone
let paintMode = 'color', paintHue = 0, paintSat = 0, paintVal = 0;
if (paint && paint.getBaseColorTexture()) {
  const img = paint.getBaseColorTexture().getImage();
  const { data, info } = await sharp(Buffer.from(img)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Float64Array(36); let total = 0, satW = 0; const acc = new Float64Array(36 * 3);
  for (const prim of bodyMesh.listPrimitives()) {
    if (prim.getMaterial() !== paint) continue;
    const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
    if (!uv) continue;
    for (let t = 0; t < idx.getCount(); t += 3) {
      const ii = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
      const A = pos.getElement(ii[0], []), B = pos.getElement(ii[1], []), C = pos.getElement(ii[2], []);
      const u = B.map((v, k) => v - A[k]), v = C.map((x, k) => x - A[k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], ar = Math.hypot(...n) / 2, nl = Math.hypot(...n) || 1;
      const c = [0, 1, 2].map((k) => (A[k] + B[k] + C[k]) / 3);
      const side = Math.abs(c[0]) > W * 0.36 && Math.abs(n[0] / nl) > 0.5 && c[1] > H * 0.25 && c[1] < H * 0.75;
      const top = n[1] / nl > 0.6 && c[1] > H * 0.55;
      if (!side && !top) continue;
      const uvs = ii.map((i) => uv.getElement(i, []));
      const tu = (uvs[0][0] + uvs[1][0] + uvs[2][0]) / 3, tv = (uvs[0][1] + uvs[1][1] + uvs[2][1]) / 3;
      const px = Math.min(info.width - 1, Math.floor(((tu % 1) + 1) % 1 * info.width)), py = Math.min(info.height - 1, Math.floor(((tv % 1) + 1) % 1 * info.height));
      const o = (py * info.width + px) * 4, r = data[o] / 255, g = data[o + 1] / 255, bl = data[o + 2] / 255;
      const mxc = Math.max(r, g, bl), mnc = Math.min(r, g, bl), d = mxc - mnc;
      total += ar;
      if (mxc < 0.15 || d / (mxc || 1) < 0.25) continue;
      let h = d === 0 ? 0 : mxc === r ? ((g - bl) / d) % 6 : mxc === g ? (bl - r) / d + 2 : (r - g) / d + 4; h = ((h / 6) % 1 + 1) % 1;
      const bi = Math.floor(h * 36) % 36; bins[bi] += ar; satW += ar; acc[bi * 3] += (d / mxc) * ar; acc[bi * 3 + 1] += mxc * ar; acc[bi * 3 + 2] += h * ar;
    }
  }
  if (total > 0 && satW / total > 0.4) {
    let best = 0; for (let i = 1; i < 36; i++) if (bins[i] > bins[best]) best = i;
    paintMode = 'hue'; paintHue = acc[best * 3 + 2] / bins[best]; paintSat = acc[best * 3] / bins[best]; paintVal = acc[best * 3 + 1] / bins[best];
  } else paintMode = 'replace';
}
const glassNames = new Set(cfg.glass ?? []);
for (const m of root.listMaterials()) {
  if (m === paint) { m.setName('paint'); continue; }
  const n = m.getName().toLowerCase();
  if (glassNames.has(m.getName()) || (m.getAlphaMode() === 'BLEND' && m.getBaseColorFactor()[3] < 0.9 && !/light|lamp|luz/.test(n)) || /glass|vidrio|window|windshield|cristal/.test(n)) m.setName('glass');
}
await doc.transform(
  dedup(), prune(),
  join({ keepNamed: true }),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, (cfg.bodyTris ?? 22000) / Math.max(1, tris.length)), error: 0.002, lockBorder: true }),
  dedup(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex ?? 1024, cfg.tex ?? 1024], quality: 82 }),
  reorder({ encoder: MeshoptEncoder }),
  quantize(),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(outBase + '.glb', doc);
let outTris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) outTris += p.getIndices().getCount() / 3;
const meta = { paintMode, paintHue: +paintHue.toFixed(4), paintSat: +paintSat.toFixed(3), paintVal: +paintVal.toFixed(3), length: +L.toFixed(3), width: +W.toFixed(3), height: +H.toFixed(3), front, wheels: wheels.map((w) => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +(+v).toFixed(3)]))), paint: !!paint, paintTextured: !!paint?.getBaseColorTexture(), tris: outTris, srcTris: tris.length, materials: root.listMaterials().map((m) => m.getName()) };
fs.writeFileSync(outBase + '.json', JSON.stringify(meta, null, 1));
console.log(JSON.stringify({ out: outBase, size: fs.statSync(outBase + '.glb').size, ...meta, materials: meta.materials.length }));
