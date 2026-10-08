// Car bodies from imported models. Each one was prepared offline (tools/cars): nose to +Z, real length, wheels
// split into four meshes at their own centres, paint and glass materials named, meshopt compressed. They load
// once and every car on the grid clones them, sharing geometry and textures. The offline build ships each one as
// a GLB in base64 inside a JSON file, without meshopt, because the artifact host serves no .glb files and its page
// may refuse WebAssembly and data: or blob: URL loads. Only a plain relative fetch is needed there.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OFFLINE } from '../app/route';

/** How the model carries its paint: a plain material colour, a texture whose paint hue the game swaps for the
 *  player's colour, or a texture with no usable colour that the game replaces outright. */
export type PaintMode = 'color' | 'hue' | 'replace';
export interface CarAssetMeta {
  paintMode: PaintMode; paintHue: number; paintSat: number; paintVal: number;
  length: number; width: number; height: number;
  wheels: { q: number; x: number; y: number; z: number; r: number; w: number }[];
}
export interface CarAsset { body: THREE.Object3D; wheels: THREE.Object3D[]; meta: CarAssetMeta }

const ready = new Map<string, CarAsset>();
const pending = new Map<string, Promise<CarAsset | null>>();
let loader: GLTFLoader | null = null;

/** A model that has finished loading, or null (the car then falls back to its procedural body). */
export function carAsset(id: string | undefined) { return id ? ready.get(id) ?? null : null; }

/** Textures straight from their bytes with createImageBitmap, so no object URL is ever fetched. */
function bitmapImages(parser: any) {
  if (typeof createImageBitmap !== 'function') return { name: 'rush_bitmap_images' };
  const base = parser.loadImageSource.bind(parser);
  parser.loadImageSource = (i: number, l: unknown) => {
    const def = parser.json.images[i];
    if (def.bufferView === undefined) return base(i, l);
    if (parser.sourceCache[i]) return parser.sourceCache[i].then((t: THREE.Texture) => t.clone());
    const p = parser.getDependency('bufferView', def.bufferView)
      .then((buf: ArrayBuffer) => createImageBitmap(new Blob([buf], { type: def.mimeType }), { premultiplyAlpha: 'none' }))
      .then((bmp: ImageBitmap) => { const t = new THREE.Texture(bmp); t.needsUpdate = true; t.userData.mimeType = def.mimeType; return t; });
    parser.sourceCache[i] = p;
    return p;
  };
  return { name: 'rush_bitmap_images' };
}

async function getLoader() {
  if (loader) return loader;
  const l = new GLTFLoader();
  if (OFFLINE) l.register(bitmapImages);
  else l.setMeshoptDecoder((await import('three/examples/jsm/libs/meshopt_decoder.module.js')).MeshoptDecoder);
  return (loader = l);
}

async function loadModel(id: string) {
  const l = await getLoader();
  if (!OFFLINE) return l.loadAsync(`cars/${id}.glb`);
  const r = await fetch(`cars/${id}.model.json`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const b64 = ((await r.json()) as { glb: string }).glb;
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return l.parseAsync(bytes.buffer, 'cars/');
}

export function loadCarAsset(id: string): Promise<CarAsset | null> {
  let p = pending.get(id);
  if (p) return p;
  p = Promise.all([loadModel(id), fetch(`cars/${id}.json`).then((r) => r.json() as Promise<CarAssetMeta>)])
    .then(([gltf, meta]) => {
      const scene = gltf.scene;
      const body = scene.getObjectByName('body');
      const wheels = [0, 1, 2, 3].map((i) => scene.getObjectByName(`wheel${i}`)).filter((w): w is THREE.Object3D => !!w);
      if (!body) throw new Error(`${id}: no body`);
      const a: CarAsset = { body, wheels: wheels.length === 4 ? wheels : [], meta: { ...meta, wheels: wheels.length === 4 ? meta.wheels : [] } };
      ready.set(id, a);
      return a;
    })
    .catch((e) => { console.warn(`car model ${id} did not load`, e); return null; });
  pending.set(id, p);
  return p;
}

export function preloadCarAssets(ids: string[], progress?: (done: number, total: number) => void) {
  let done = 0;
  return Promise.all(ids.map((id) => loadCarAsset(id).then((a) => { progress?.(++done, ids.length); return a; })));
}
