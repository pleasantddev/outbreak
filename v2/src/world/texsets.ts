// PBR texture arrays (Poly Haven CC0): one sampler2DArray each for colour, normal and AO/roughness/metal.
import * as THREE from 'three';

export const GROUND_LAYERS = { asphalt: 0, oldAsphalt: 1, pavement: 2, laterite: 3, grass: 4, mud: 5, pavers: 6, concrete: 7 } as const;
export const WALL_LAYERS = { paint: 0, worn: 1, plaster: 2, block: 3, brick: 4, concrete: 5, zinc: 6, tiles: 7 } as const;

export interface TexSet { diff: THREE.DataArrayTexture; nor: THREE.DataArrayTexture; arm: THREE.DataArrayTexture; size: number }

async function loadImage(url: string): Promise<ImageBitmap> {
  const r = await fetch(url); const b = await r.blob();
  return await createImageBitmap(b);
}

async function buildArray(urls: string[], size: number, srgb: boolean) {
  const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  const data = new Uint8Array(size * size * 4 * urls.length);
  const imgs = await Promise.all(urls.map(loadImage));
  imgs.forEach((im, i) => { g.clearRect(0, 0, size, size); g.drawImage(im, 0, 0, size, size); data.set(g.getImageData(0, 0, size, size).data, i * size * size * 4); im.close(); });
  const t = new THREE.DataArrayTexture(data, size, size, urls.length);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Texture sets ship as one pack per map: HLT1, count, (offset, length) pairs, then the WebP files. */
async function packBlobs(url: string) {
  const buf = await (await fetch(url)).arrayBuffer(); const dv = new DataView(buf); const n = dv.getUint16(4, true); const out: Blob[] = [];
  for (let k = 0; k < n; k++) { const o = dv.getUint32(6 + k * 8, true), l = dv.getUint32(10 + k * 8, true); out.push(new Blob([buf.slice(o, o + l)], { type: 'image/webp' })); }
  return out;
}
async function buildArrayFromBlobs(blobs: Blob[], size: number, srgb: boolean) {
  const urls = blobs.map((b) => URL.createObjectURL(b));
  try { return await buildArray(urls, size, srgb); } finally { urls.forEach((u) => URL.revokeObjectURL(u)); }
}
export async function loadTexSet(prefix: 'g' | 'w', count: number, size: 512 | 1024, base = 'tex/'): Promise<TexSet> {
  void count;
  const [d, n, a] = await Promise.all(['diff', 'nor', 'arm'].map((m) => packBlobs(`${base}${prefix}_${m}_${size}.wasm`)));
  const [diff, nor, arm] = await Promise.all([buildArrayFromBlobs(d, size, true), buildArrayFromBlobs(n, size, false), buildArrayFromBlobs(a, size, false)]);
  return { diff, nor, arm, size };
}
