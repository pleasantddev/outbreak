// Paint finishes on the real car models. Every car GLB has one material called "paint"; this swaps it for a physical
// material built from a PaintSpec (colour + finish), and when the car carries a painted design, the baked texture on
// the car's atlas UV channel goes on top of that.
import * as THREE from 'three';
import type { CarModel } from '../render/cars';
import type { PaintSpec } from './garageFleet';
import { shopItem, shopItems } from './featureKit';

type Fin = { metalness: number; roughness: number; clearcoat: number; iridescence?: number; flake?: number; envBoost?: number };
const FALLBACK: Record<string, Fin> = {
  gloss: { metalness: 0.35, roughness: 0.18, clearcoat: 1 }, matte: { metalness: 0.1, roughness: 0.88, clearcoat: 0 },
  metallic: { metalness: 0.85, roughness: 0.3, clearcoat: 0.8, flake: 1 }, pearl: { metalness: 0.45, roughness: 0.2, clearcoat: 1, iridescence: 0.9 },
  chrome: { metalness: 1, roughness: 0.05, clearcoat: 0, envBoost: 1.6 },
};
export function finishDef(id: string): Fin { const f = shopItem('finish', id); return (f as Fin | undefined) ?? FALLBACK[id] ?? FALLBACK.gloss; }
export function finishList() { const l = shopItems('finish'); return l.length ? l : Object.keys(FALLBACK).map((id) => ({ kind: 'finish' as const, id, name: id, desc: '', mult: 1, secs: 20, ...FALLBACK[id] })); }

const cache = new Map<string, THREE.MeshPhysicalMaterial>();
let bakeSeq = 0; const bakeIds = new WeakMap<THREE.Texture, number>();

/** metallic flake: a cheap hash in view space nudges the normal so the paint glitters as the camera moves */
function addFlake(m: THREE.MeshPhysicalMaterial, amt: number) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec3 fp = floor(-vViewPosition * 90.0); float hh = fract(sin(dot(fp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        normal = normalize(normal + (vec3(hh, fract(hh * 7.31), fract(hh * 13.17)) - 0.5) * ${amt.toFixed(2)}); }`);
  };
  m.customProgramCacheKey = () => 'flake' + amt.toFixed(2);
}

export function paintMaterial(spec: PaintSpec, bake: THREE.Texture | null): THREE.MeshPhysicalMaterial {
  const bid = bake ? (bakeIds.get(bake) ?? (bakeIds.set(bake, ++bakeSeq), bakeSeq)) : 0;
  const key = `${spec.finish}|${spec.color}|${bid}`; let m = cache.get(key); if (m) return m;
  const f = finishDef(spec.finish);
  m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(spec.color || '#888888'), metalness: f.metalness, roughness: f.roughness, clearcoat: f.clearcoat, clearcoatRoughness: 0.05 });
  if (f.iridescence) { m.iridescence = f.iridescence; m.iridescenceIOR = 1.6; m.iridescenceThicknessRange = [180, 520]; }
  if (f.envBoost) m.envMapIntensity = f.envBoost;
  if (f.flake) addFlake(m, 0.34);
  if (bake) { m.map = bake; m.color.set('#ffffff'); (m.map as any).channel = 1; }
  cache.set(key, m); return m;
}

/** Applies (or removes) a spec on the paint meshes of a car model. Cheap to call repeatedly: it remembers what it applied. */
export function applyPaint(model: CarModel, spec: PaintSpec | undefined | null, bake: THREE.Texture | null = null, atlasGeo: ((mesh: THREE.Mesh) => THREE.BufferGeometry | null) | null = null) {
  const m = model as any; const bid = bake ? (bakeIds.get(bake) ?? (bakeIds.set(bake, ++bakeSeq), bakeSeq)) : 0;
  const tag = spec ? `${spec.finish}|${spec.color}|${spec.rev}|${bid}` : '';
  if (m._paintTag === tag) return; m._paintTag = tag;
  model.body.traverse((o) => {
    const me = o as THREE.Mesh; if (!me.isMesh) return; const ud = me.userData as any;
    const cur = me.material as THREE.Material; if (Array.isArray(cur)) return;
    if (ud.origPaint === undefined) { if ((cur.name || '').toLowerCase() !== 'paint') { ud.origPaint = null; return; } ud.origPaint = cur; ud.origGeo = me.geometry; }
    if (!ud.origPaint) return;
    if (!spec) { me.material = ud.origPaint; me.geometry = ud.origGeo; return; }
    const mat = paintMaterial(spec, bake);
    me.material = mat;
    if (bake && atlasGeo) { const g = atlasGeo(me); if (g) me.geometry = g; } else me.geometry = ud.origGeo;
  });
}

/** every mesh of a model that carries the paint material (original geometry), for the atlas builder */
export function paintMeshes(model: CarModel): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  model.body.traverse((o) => { const me = o as THREE.Mesh; if (!me.isMesh) return; const ud = me.userData as any; const mt = (ud.origPaint ?? me.material) as THREE.Material; if (!Array.isArray(mt) && (mt.name || '').toLowerCase() === 'paint') out.push(me); });
  return out;
}
