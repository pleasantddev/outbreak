// Asset pipeline: converts the CC0 source packs into game-ready GLBs.
// Usage: node tools/build-assets.mjs <srcRoot> <outDir>
// Requires @gltf-transform/{core,extensions,functions} and sharp (dev only).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, resample, quantize } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(path.join(out, 'chars'), { recursive: true });
fs.mkdirSync(path.join(out, 'anim'), { recursive: true });

const UBC = path.join(src, 'ubc/Universal Base Characters[Standard]');
const BASE = path.join(UBC, 'Base Characters/Godot - UE');

async function tex(doc, size) {
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82 }));
}

for (const who of ['Male', 'Female']) {
  const doc = await io.read(path.join(BASE, `Superhero_${who}_FullBody.gltf`));
  await doc.transform(dedup(), prune());
  await tex(doc, 1024);
  await io.write(path.join(out, `chars/${who.toLowerCase()}.glb`), doc);
  console.log('char', who);
}
// Light skin albedo variants are shipped as separate textures, swapped at runtime.
for (const [f, o] of [['T_Superhero_Male_Ligh.png', 'male_light.webp'], ['T_Superhero_Female_Light_BaseColor.png', 'female_light.webp'], ['T_Superhero_Male_Dark.png', 'male_dark.webp'], ['T_Superhero_Female_Dark_BaseColor.png', 'female_dark.webp']]) {
  await sharp(path.join(UBC, 'Base Characters/Textures', f)).resize(1024, 1024).webp({ quality: 82 }).toFile(path.join(out, 'chars', o));
}

const HAIR = path.join(UBC, 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)');
for (const f of fs.readdirSync(HAIR).filter((f) => f.endsWith('.gltf'))) {
  for (const t of fs.readdirSync(path.join(UBC, 'Hairstyles/Textures'))) {
    const dst = path.join(HAIR, t); if (!fs.existsSync(dst) && t.endsWith('.png')) fs.copyFileSync(path.join(UBC, 'Hairstyles/Textures', t), dst);
  }
  // some uris carry a stray _png suffix
  for (const m of fs.readFileSync(path.join(HAIR, f), 'utf8').matchAll(/"uri"\s*:\s*"([^"]+\.png)"/g)) {
    const dst = path.join(HAIR, m[1]);
    if (!fs.existsSync(dst)) fs.copyFileSync(path.join(UBC, 'Hairstyles/Textures', m[1].replace('_png.png', '.png')), dst);
  }
  const doc = await io.read(path.join(HAIR, f));
  await doc.transform(dedup(), prune());
  await tex(doc, 512);
  await io.write(path.join(out, `chars/${f.replace('.gltf', '.glb').toLowerCase()}`), doc);
  console.log('hair', f);
}

const KEEP = new Set(process.env.KEEP ? process.env.KEEP.split(',') : []);
for (const [lib, file] of [['universal-animation-library/Universal Animation Library[Standard]', 'UAL1_Standard.glb'], ['universal-animation-library-2/Universal Animation Library 2[Standard]', 'UAL2_Standard.glb']]) {
  const doc = await io.read(path.join(src, lib, 'Unreal-Godot', file));
  const root = doc.getRoot();
  for (const n of root.listNodes()) if (n.getMesh()) n.setMesh(null);
  for (const a of root.listAnimations()) if (KEEP.size && !KEEP.has(a.getName())) a.dispose();
  await doc.transform(resample(), prune({ keepLeaves: true }), quantize());
  await io.write(path.join(out, 'anim', file.replace('_Standard', '').toLowerCase()), doc);
  console.log('anim', file, root.listAnimations().length);
}
