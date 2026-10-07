// PBR materials (CC0 Poly Haven scans) plus procedural wetness and grime.
import * as THREE from 'three';
import type { Mat } from '../world/cityGen';

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
function tex(name: string, srgb: boolean, aniso: number) {
  const key = name;
  if (cache.has(key)) return cache.get(key)!;
  const t = loader.load(`/assets/tex/${name}.webp`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  cache.set(key, t);
  return t;
}

/** Meters covered by one texture repeat. */
export const TEX_SCALE: Record<Mat, number> = {
  road: 7, sidewalk: 3, curb: 2, plaster: 3.2, paint: 3, block: 2.6, concrete: 3.5, tiles: 2, woodfloor: 2.6,
  corrugated: 2.4, rust: 2.2, shutter: 2.6, mud: 6, planks: 2.2, metal: 2, container: 2.6, stair: 2,
};
const SOURCE: Record<Mat, string> = {
  road: 'road', sidewalk: 'sidewalk', curb: 'sidewalk', plaster: 'plaster', paint: 'paint', block: 'block', concrete: 'concrete', tiles: 'tiles',
  woodfloor: 'woodfloor', corrugated: 'corrugated', rust: 'rust', shutter: 'shutter', mud: 'mud', planks: 'planks', metal: 'rust', container: 'corrugated', stair: 'concrete',
};
const WET: Partial<Record<Mat, number>> = { road: 1, sidewalk: 0.7, mud: 0.8, concrete: 0.4, curb: 0.6 };

export const shared = { time: { value: 0 }, rain: { value: 0.7 } };

/** Adds puddles, rain darkening and grime to a standard material. */
function weather(m: THREE.MeshStandardMaterial, wet: number) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.uniforms.uRain = shared.rain;
    sh.uniforms.uWet = { value: wet };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos; uniform float uTime; uniform float uRain; uniform float uWet;
float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float n21(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float puddle = 0.0;
if (uWet > 0.0) {
  float pn = n21(vWPos.xz * 0.22) * 0.65 + n21(vWPos.xz * 0.9) * 0.35;
  puddle = smoothstep(0.58, 0.66, pn) * uWet * uRain;
  roughnessFactor = mix(roughnessFactor * mix(1.0, 0.55, uRain * uWet), 0.04, puddle);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float pn2 = n21(vWPos.xz * 0.22) * 0.65 + n21(vWPos.xz * 0.9) * 0.35;
  float pd = smoothstep(0.58, 0.66, pn2) * uWet * uRain;
  diffuseColor.rgb *= mix(1.0, 0.62, uWet * uRain) * (1.0 - pd * 0.35);
  // soot and grime streaking down vertical faces
  float streak = n21(vec2(vWPos.x * 3.0 + vWPos.z * 3.0, vWPos.y * 0.35)) * n21(vWPos.xz * 0.4 + vWPos.y * 0.1);
  diffuseColor.rgb *= 1.0 - streak * 0.35;
}`);
  };
  m.customProgramCacheKey = () => `weather${wet}`;
}

let mats: Record<Mat, THREE.MeshStandardMaterial> | null = null;
export function worldMaterials(quality: 'low' | 'medium' | 'high') {
  if (mats) return mats;
  const aniso = quality === 'high' ? 8 : quality === 'medium' ? 4 : 1;
  const out = {} as Record<Mat, THREE.MeshStandardMaterial>;
  for (const m of Object.keys(TEX_SCALE) as Mat[]) {
    const src = SOURCE[m];
    const mat = new THREE.MeshStandardMaterial({
      map: tex(`${src}_diff`, true, aniso),
      normalMap: quality === 'low' ? null : tex(`${src}_nor`, false, aniso),
      roughnessMap: tex(`${src}_arm`, false, aniso),
      metalnessMap: ['corrugated', 'rust', 'metal', 'container', 'shutter'].includes(m) ? tex(`${src}_arm`, false, aniso) : null,
      aoMap: null,
      vertexColors: true,
      roughness: 1,
      metalness: ['corrugated', 'rust', 'metal', 'container', 'shutter'].includes(m) ? 0.85 : 0,
      envMapIntensity: 0.35,
    });
    if (m === 'container') mat.color.set(0xffffff);
    if (m === 'stair') mat.color.set(0x9a9488);
    if (m === 'curb') mat.color.set(0xb0a898);
    if (m === 'road') mat.color.set(0x8a8580);
    if (m === 'mud') mat.color.set(0xb07850);
    if (mat.normalMap) mat.normalScale.set(1.2, 1.2);
    weather(mat, WET[m] ?? 0);
    out[m] = mat;
  }
  mats = out;
  return out;
}
export function disposeMaterials() { mats = null; }
