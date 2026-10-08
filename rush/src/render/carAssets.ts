// Car bodies from imported models. Each one was prepared offline (tools/cars): nose to +Z, real length, wheels
// split into four meshes at their own centres, paint and glass materials named, meshopt compressed. They load
// once and every car on the grid clones them, sharing geometry and textures. The offline build ships them as
// self-contained glTF JSON instead, because the artifact host does not serve .glb files.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
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

export function loadCarAsset(id: string): Promise<CarAsset | null> {
  let p = pending.get(id);
  if (p) return p;
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  p = Promise.all([loader.loadAsync(OFFLINE ? `cars/${id}.model.json` : `cars/${id}.glb`), fetch(`cars/${id}.json`).then((r) => r.json() as Promise<CarAssetMeta>)])
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
