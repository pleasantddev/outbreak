// Report a glTF car: world-space bounds, every mesh node with its bounds and materials, and the material list.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const b = getBounds(scene);
const size = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
console.log('BOUNDS', b.min.map((v) => +v.toFixed(3)), b.max.map((v) => +v.toFixed(3)), 'size', size);
let tris = 0;
const rows = [];
scene.traverse((n) => {
  const m = n.getMesh(); if (!m) return;
  const nb = getBounds(n);
  let t = 0; const mats = new Set();
  for (const p of m.listPrimitives()) { const idx = p.getIndices(); const pos = p.getAttribute('POSITION'); t += (idx ? idx.getCount() : pos.getCount()) / 3; mats.add(p.getMaterial()?.getName() ?? '-'); }
  tris += t;
  const c = nb.min.map((v, i) => +((v + nb.max[i]) / 2).toFixed(2)), s = nb.max.map((v, i) => +(v - nb.min[i]).toFixed(2));
  rows.push(`${n.getName().slice(0, 40).padEnd(40)} tris ${String(Math.round(t)).padStart(6)} c ${JSON.stringify(c)} s ${JSON.stringify(s)} mats ${[...mats].join(',').slice(0, 80)}`);
});
console.log('TRIS', Math.round(tris), 'meshNodes', rows.length);
for (const r of rows.slice(0, 60)) console.log(' ', r);
if (rows.length > 60) console.log('  ...', rows.length - 60, 'more');
console.log('MATERIALS');
for (const m of root.listMaterials()) console.log('  ', m.getName(), JSON.stringify(m.getBaseColorFactor().map((v) => +v.toFixed(2))), m.getBaseColorTexture() ? 'tex:' + m.getBaseColorTexture().getURI() : '', 'metal', m.getMetallicFactor(), 'rough', m.getRoughnessFactor(), m.getAlphaMode());
console.log('TEXTURES', root.listTextures().map((t) => `${t.getURI()} ${t.getImage()?.byteLength}`).join(' | '));
