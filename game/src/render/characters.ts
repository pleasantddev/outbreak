// Characters: CC0 base bodies, a procedural clothing shader, bone-attached gear and layered animation.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterLook, Pattern, TopStyle } from '../data/cosmetics';
import { SKIN_TONES, PATTERNS, TOPS } from '../data/cosmetics';
import type { CreatureKind, WeaponId } from '../data/balance';
import type { WeaponLoadout } from '../data/cosmetics';
import { buildWeapon, type WeaponModel } from './weapons3d';

const LONG_GUNS = new Set<WeaponId>(['ar', 'smg', 'shotgun', 'sniper']);
const FOREGRIP: Partial<Record<WeaponId, number>> = { smg: 0.24, ar: 0.42, shotgun: 0.42, sniper: 0.46 };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function rotateBoneWorld(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  const q = new THREE.Quaternion().setFromUnitVectors(from, to);
  const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
  bone.updateMatrixWorld(true);
}
function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion) {
  const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(q));
  bone.updateMatrixWorld(true);
}
/** Analytic two-bone IK in world space with a pole hint for the elbow. */
export function twoBoneIK(a: THREE.Object3D, b: THREE.Object3D, c: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) {
  const pa = a.getWorldPosition(V()), pb = b.getWorldPosition(V()), pc = c.getWorldPosition(V());
  const la = pa.distanceTo(pb), lb = pb.distanceTo(pc);
  const toT = target.clone().sub(pa);
  const d = THREE.MathUtils.clamp(toT.length(), 0.02, la + lb - 0.002);
  const dirT = toT.normalize();
  const n = V().crossVectors(dirT, pole.clone().sub(pa)).normalize();
  if (n.lengthSq() < 1e-6) return;
  const bend = V().crossVectors(n, dirT).normalize();
  const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
  const mid = pa.clone().addScaledVector(dirT, cosA * la).addScaledVector(bend, Math.sqrt(1 - cosA * cosA) * la);
  rotateBoneWorld(a, pb.clone().sub(pa).normalize(), mid.clone().sub(pa).normalize());
  const pb2 = b.getWorldPosition(V()), pc2 = c.getWorldPosition(V());
  rotateBoneWorld(b, pc2.clone().sub(pb2).normalize(), target.clone().sub(pb2).normalize());
}

const UPPER = /^(spine_0[1-3]|neck_01|Head|clavicle_|upperarm_|lowerarm_|hand_|index_|middle_|pinky_|ring_|thumb_)/;

export class CharacterAssets {
  bodies!: Record<'male' | 'female', GLTF>;
  hair = new Map<string, GLTF>();
  clips = new Map<string, THREE.AnimationClip>();
  upper = new Map<string, THREE.AnimationClip>();
  lower = new Map<string, THREE.AnimationClip>();
  dims: Record<'male' | 'female', { shoulderX: number; handX: number; waistY: number; neckY: number; ankleY: number; kneeY: number; armY: number; headY: number; top: number }> = {} as any;
  skinTex: Record<string, THREE.Texture> = {};

  async load(onProgress?: (f: number) => void) {
    const L = new GLTFLoader();
    const files = ['chars/male.glb', 'chars/female.glb', 'anim/ual1.glb', 'anim/ual2.glb', 'chars/hair_buzzed.glb', 'chars/hair_simpleparted.glb', 'chars/hair_long.glb', 'chars/hair_buns.glb', 'chars/hair_buzzedfemale.glb', 'chars/hair_beard.glb'];
    let done = 0;
    const res = await Promise.all(files.map((f) => L.loadAsync(`/assets/${f}`).then((g) => { onProgress?.(++done / files.length); return g; })));
    this.bodies = { male: res[0], female: res[1] };
    for (const g of [res[2], res[3]]) for (const c of g.animations) this.clips.set(c.name, c);
    ['buzzed', 'simpleparted', 'long', 'buns', 'buzzedfemale', 'beard'].forEach((n, i) => this.hair.set(n, res[4 + i]));
    // per-layer copies of each clip so the upper body can aim while the legs run
    for (const [name, c] of this.clips) {
      this.upper.set(name, new THREE.AnimationClip(name + '_U', c.duration, c.tracks.filter((t) => UPPER.test(t.name.split('.')[0]))));
      this.lower.set(name, new THREE.AnimationClip(name + '_L', c.duration, c.tracks.filter((t) => !UPPER.test(t.name.split('.')[0]) && !t.name.startsWith('root.position'))));
      // strip root motion from the full clips too
      c.tracks = c.tracks.filter((t) => !(t.name.startsWith('root.') && t.name.endsWith('position')));
    }
    for (const k of ['male', 'female'] as const) {
      const sc = this.bodies[k].scene; sc.updateMatrixWorld(true);
      const pos = (n: string) => { const o = sc.getObjectByName(n); return o ? new THREE.Vector3().setFromMatrixPosition(o.matrixWorld) : new THREE.Vector3(); };
      const box = new THREE.Box3().setFromObject(sc);
      this.dims[k] = {
        shoulderX: pos('upperarm_l').x + 0.03, handX: pos('hand_l').x, waistY: pos('pelvis').y + 0.075, neckY: pos('neck_01').y - 0.03,
        ankleY: pos('foot_l').y + 0.035, kneeY: pos('calf_l').y - 0.04, armY: pos('upperarm_l').y, headY: pos('Head').y, top: box.max.y,
      };
    }
    const tl = new THREE.TextureLoader();
    for (const n of ['male_dark', 'male_light', 'female_dark', 'female_light']) { const t = await tl.loadAsync(`/assets/chars/${n}.webp`); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; this.skinTex[n] = t; }
  }
}

// ---------------------------------------------------------------- clothing shader
const PATTERN_ID: Record<Pattern, number> = { solid: 0, ankara_sun: 1, ankara_wave: 2, adire: 3, kente: 4, camo_urban: 5, camo_night: 6, stripe_danfo: 7 };
const TOP_ID: Record<TopStyle, number> = { tee: 0, hoodie: 1, jacket: 2, tactical: 3, agbada: 4 };

const GLSL_COMMON = /* glsl */ `
uniform vec4 uB0; uniform vec4 uB1; uniform vec4 uStyle; uniform vec3 uTop; uniform vec3 uAcc; uniform vec3 uPants; uniform vec3 uShoe; uniform vec3 uSkin;
uniform float uPaint; uniform float uZombie; uniform float uTime; uniform float uShadowFx; uniform float uAwaken; uniform float uHit; uniform float uPantsPat; uniform float uSeed;
varying vec3 vBind;
float chh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
float cnn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(chh(i),chh(i+vec3(1,0,0)),f.x),mix(chh(i+vec3(0,1,0)),chh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(chh(i+vec3(0,0,1)),chh(i+vec3(1,0,1)),f.x),mix(chh(i+vec3(0,1,1)),chh(i+vec3(1,1,1)),f.x),f.y),f.z); }
int regionOf(vec3 p) {
  float ax = abs(p.x);
  if (ax > uB0.x - 0.02 && p.y > uB1.z - 0.17) { float t = (ax - uB0.x) / (uB0.y - uB0.x); float sl = uStyle.x < 0.5 ? 0.42 : 0.97; return t < sl ? 2 : 5; }
  if (p.y < uB1.x) return 4;
  if (p.y < uB0.z) return (uStyle.x > 3.5 && p.y > uB1.y) ? 1 : 3;
  float neck = uB0.w - (p.z > 0.0 ? 0.04 : 0.0) + (uStyle.x > 0.5 && uStyle.x < 1.5 ? 0.05 : 0.0);
  if (p.y < neck) return 1;
  return 0;
}`;

const GLSL_FRAG = /* glsl */ `
vec3 patternCol(float id, vec3 p, vec3 c1, vec3 c2) {
  vec2 q = vec2(p.x + p.z * 0.6, p.y);
  if (id < 0.5) return c1;
  if (id < 1.5) { vec2 g = fract(q * 9.0) - 0.5; float r = length(g); vec3 col = mix(c1, c2, step(0.5, fract(r * 6.0)));
    col = mix(col, vec3(0.03), step(0.40, r) * step(r, 0.47)); return mix(col, vec3(0.06,0.12,0.3), step(0.47, r)); }
  if (id < 2.5) { float w = sin(q.x * 40.0 + sin(q.y * 25.0) * 2.0); vec3 col = mix(c1, c2, step(0.3, w));
    float dots = step(0.82, fract(q.y * 30.0)) * step(0.8, fract(q.x * 30.0)); return mix(col, vec3(0.9,0.86,0.78), dots); }
  if (id < 3.5) { float r = length(fract(q * 4.0) - 0.5); float n = cnn(p * 18.0); vec3 ind = vec3(0.03, 0.05, 0.16);
    vec3 col = mix(ind, c1 * 0.4 + ind, smoothstep(0.2, 0.6, n)); return mix(col, vec3(0.7,0.74,0.82), smoothstep(0.035, 0.0, abs(fract(r * 5.0 + n * 0.3) - 0.5) - 0.02)); }
  if (id < 4.5) { vec2 g = floor(q * vec2(14.0, 10.0)); float a = mod(g.x + g.y, 3.0); vec3 col = a < 1.0 ? c1 : a < 2.0 ? c2 : vec3(0.05, 0.2, 0.09);
    return mix(col, vec3(0.03), step(0.86, fract(q.y * 20.0))); }
  if (id < 5.5) { float n = cnn(p * 9.0) * 0.6 + cnn(p * 21.0) * 0.4; return n < 0.4 ? vec3(0.28,0.27,0.26) : n < 0.55 ? vec3(0.13) : n < 0.7 ? vec3(0.4,0.39,0.37) : vec3(0.05); }
  if (id < 6.5) { float n = cnn(p * 8.0) * 0.6 + cnn(p * 19.0) * 0.4; return n < 0.45 ? vec3(0.03,0.035,0.05) : n < 0.62 ? vec3(0.07,0.07,0.1) : vec3(0.12,0.07,0.15); }
  float y = fract(p.y * 4.0); vec3 col = vec3(0.75, 0.5, 0.05); return mix(col, vec3(0.02), step(0.55, y) * step(y, 0.68));
}
`;

export interface OutfitUniforms { [k: string]: THREE.IUniform }

function lin(hex: string | number) { return new THREE.Color(hex as any).convertSRGBToLinear(); }

export function makeBodyMaterial(base: THREE.MeshStandardMaterial, uniforms: OutfitUniforms, staticBind = false) {
  const m = base.clone();
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${staticBind ? 'attribute vec3 bindPos;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 bp = ${staticBind ? 'bindPos' : 'position'};
        vBind = bp;
        int rg = regionOf(bp);
        float th = rg == 1 ? (uStyle.x > 0.5 ? 0.012 : 0.006) : rg == 2 ? 0.006 : rg == 3 ? 0.007 : rg == 4 ? 0.016 : 0.0;
        if (uStyle.x > 3.5 && rg == 1 && bp.y < uB0.z) th += 0.03 * smoothstep(uB0.z, uB1.y, bp.y);
        if (uZombie > 2.5 && rg == 5) transformed += normal * 0.0;
        transformed += normal * th;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${GLSL_FRAG}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 bp = vBind;
        int rg = regionOf(bp);
        float wear = uStyle.w;
        bool cloth = rg >= 1 && rg <= 4;
        // zombies wear rags: clothing tears open to show the skin beneath
        if (uZombie > 0.5 && cloth && cnn(bp * 14.0 + uSeed) > 0.68) cloth = false;
        if (uShadowFx > 0.01 && chh(vec3(gl_FragCoord.xy, floor(uTime * 30.0))) < uShadowFx * 0.93) discard;
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        if (cloth) {
          vec3 c;
          if (rg == 4) { c = uShoe * (bp.y < 0.025 ? 0.3 : 1.0); }
          else if (rg == 3) { c = patternCol(uPantsPat, bp, uPants, uPants * 0.6); }
          else {
            c = patternCol(uStyle.y, bp, uTop, uAcc);
            float st = uStyle.x;
            float fwd = step(0.04, bp.z);
            if (st > 0.5 && st < 1.5) { // hoodie: kangaroo pocket and strings
              if (fwd > 0.5 && abs(bp.x) < 0.13 && bp.y > uB0.z + 0.03 && bp.y < uB0.z + 0.19) c = mix(c, uAcc, 0.8);
              if (fwd > 0.5 && abs(abs(bp.x) - 0.04) < 0.006 && bp.y > uB0.w - 0.17) c = vec3(0.85);
            } else if (st > 1.5 && st < 2.5) { // jacket: zip, cuffs, waistband
              if (fwd > 0.5 && abs(bp.x) < 0.008) c = vec3(0.6);
              if (bp.y < uB0.z + 0.05) c = uAcc;
            } else if (st > 2.5 && st < 3.5) { // tactical: chest pockets and straps
              if (fwd > 0.5 && abs(abs(bp.x) - 0.085) < 0.045 && abs(bp.y - (uB0.w - 0.14)) < 0.05) c = uAcc;
              if (abs(abs(bp.x) - 0.11) < 0.02) c = c * 0.6;
            } else if (st > 3.5) { // agbada: embroidered neckline
              float d = length(vec2(bp.x, (bp.y - (uB0.w - 0.12)) * 1.3));
              if (fwd > 0.5 && d < 0.13) c = mix(c, uAcc, step(0.5, fract(d * 50.0)) * 0.85 + 0.1);
            }
            if (rg == 2 && uStyle.x > 0.5) { float t = (abs(bp.x) - uB0.x) / (uB0.y - uB0.x); if (t > 0.9) c = uAcc * 0.8; }
          }
          // weave, grime at the hems, mud on the legs, blood where it has been bad
          float weave = cnn(bp * 420.0) * 0.5 + cnn(bp * 160.0) * 0.5;
          c *= 0.82 + 0.25 * weave;
          float dirt = smoothstep(uB0.z * 0.6, 0.0, bp.y) * 0.65 + cnn(bp * 11.0) * 0.25 * wear;
          c = mix(c, vec3(0.09, 0.055, 0.03), clamp(dirt, 0.0, 0.85));
          float bl = smoothstep(1.0 - wear * 0.4, 1.02 - wear * 0.4 + 0.03, cnn(bp * 7.0 + uSeed) * 0.7 + cnn(bp * 23.0) * 0.3);
          c = mix(c, vec3(0.16, 0.0, 0.0), bl * 0.9);
          diffuseColor.rgb = c;
        } else {
          diffuseColor.rgb *= uSkin;
          // face paint
          if (rg == 0 && bp.z > 0.03 && bp.y > uB1.w + 0.02) {
            float fy = bp.y - uB1.w;
            if (uPaint > 0.5 && uPaint < 1.5) { float m = step(0.035, abs(bp.x)) * step(abs(bp.x), 0.06) * step(0.03, fract(fy * 40.0)) * step(fract(fy * 40.0), 0.35) * step(0.05, fy) * step(fy, 0.09); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45, m); }
            if (uPaint > 1.5 && uPaint < 2.5) { float eye = smoothstep(0.03, 0.02, length(vec2(abs(bp.x) - 0.033, fy - 0.1))); diffuseColor.rgb = mix(vec3(0.85, 0.82, 0.76), vec3(0.01), eye) * (step(0.06, fy)); }
            if (uPaint > 2.5) { diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.31, 0.3), smoothstep(0.45, 0.7, cnn(bp * 60.0)) * 0.8); }
          }
          if (uZombie > 0.5) {
            float l2 = lum;
            vec3 rot = uZombie < 1.5 ? vec3(0.42, 0.45, 0.36) : uZombie < 2.5 ? vec3(0.78, 0.76, 0.72) : vec3(0.06, 0.05, 0.06);
            diffuseColor.rgb = rot * (0.5 + l2 * 1.4);
            float veins = smoothstep(0.03, 0.0, abs(cnn(bp * 30.0) - 0.5)) * 0.8;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.02, 0.05), veins);
            float wound = smoothstep(0.72, 0.78, cnn(bp * 9.0 + uSeed * 3.0));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.02, 0.02) * (0.6 + 0.6 * cnn(bp * 80.0)), wound);
            if (rg == 0 && bp.z > 0.03 && bp.y < uB1.w + 0.06) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.0, 0.0), 0.7);
          }
        }
        if (uAwaken > 0.01) { float v = smoothstep(0.05, 0.0, abs(cnn(bp * 26.0) - 0.5)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02), uAwaken * 0.7) + vec3(0.0); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), v * uAwaken); }
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        { int rgr = regionOf(vBind); if (rgr >= 1 && rgr <= 4 && !(uZombie > 0.5 && cnn(vBind * 14.0 + uSeed) > 0.68)) roughnessFactor = 0.9; else roughnessFactor = min(roughnessFactor, 0.6); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float cr = smoothstep(0.035, 0.0, abs(cnn(vBind * 26.0) - 0.5));
          totalEmissiveRadiance += vec3(1.0, 0.05, 0.02) * cr * (uAwaken * 2.5 + (uZombie > 2.5 ? 1.6 : 0.0));
          totalEmissiveRadiance += vec3(0.8, 0.0, 0.0) * uHit; }`);
  };
  m.customProgramCacheKey = () => `body${staticBind ? 'S' : 'K'}`;
  return m;
}

export function outfitUniforms(look: CharacterLook, assets: CharacterAssets, zombie = 0, seed = Math.random() * 10): OutfitUniforms {
  const d = assets.dims[look.body];
  // skin tone: the source albedo is a mid brown, scale it toward the chosen tone
  const ref = lin('#8a5a40'), tone = lin(SKIN_TONES[look.skin] ?? SKIN_TONES[1]);
  return {
    uB0: { value: new THREE.Vector4(d.shoulderX, d.handX, d.waistY, d.neckY) },
    uB1: { value: new THREE.Vector4(d.ankleY, d.kneeY, d.armY, d.headY) },
    uStyle: { value: new THREE.Vector4(TOP_ID[look.top], PATTERN_ID[look.topPattern], 0, look.scars) },
    uTop: { value: lin(look.topColor) }, uAcc: { value: lin(look.topAccent) }, uPants: { value: lin(look.pantsColor) }, uShoe: { value: lin(look.shoes) },
    uSkin: { value: new THREE.Vector3(tone.r / ref.r, tone.g / ref.g, tone.b / ref.b) },
    uPaint: { value: ({ none: 0, tribal: 1, skull: 2, ash: 3 } as const)[look.facePaint] },
    uZombie: { value: zombie }, uTime: { value: 0 }, uShadowFx: { value: 0 }, uAwaken: { value: 0 }, uHit: { value: 0 },
    uPantsPat: { value: PATTERN_ID[look.pants] }, uSeed: { value: seed },
  };
}

// ---------------------------------------------------------------- gear
const gearMat = (c: number, r = 0.85, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
function gearMesh(kind: string, look: CharacterLook): THREE.Object3D | null {
  const acc = new THREE.Color(look.topAccent).getHex(), top = new THREE.Color(look.topColor).getHex();
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s?: [number, number, number]) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); if (s) m.scale.set(...s); m.castShadow = true; g.add(m); return m; };
  switch (kind) {
    case 'cap': add(new THREE.SphereGeometry(0.108, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), gearMat(acc), 0, -0.01, 0); add(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 16, 1, false, -Math.PI / 2, Math.PI), gearMat(acc), 0, -0.01, 0.07, 0, 0, 0, [1, 1, 0.9]); break;
    case 'fila': add(new THREE.CylinderGeometry(0.1, 0.11, 0.11, 16), gearMat(top), 0, 0.02, -0.01, -0.25); add(new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), gearMat(top), -0.02, 0.07, -0.04, -0.6, 0, 0.3); break;
    case 'helmet': add(new THREE.SphereGeometry(0.125, 18, 10, 0, Math.PI * 2, 0, Math.PI / 1.9), gearMat(0x2a3020, 0.6, 0.3), 0, -0.03, 0); add(new THREE.BoxGeometry(0.04, 0.03, 0.04), gearMat(0x111111), 0, 0.05, 0.11); break;
    case 'bandana': add(new THREE.ConeGeometry(0.11, 0.16, 12, 1, true, -Math.PI * 0.6, Math.PI * 1.2), gearMat(acc, 0.95), 0, -0.13, 0.03, Math.PI, 0, 0, [1, 1, 0.9]); break;
    case 'gasmask': add(new THREE.SphereGeometry(0.075, 14, 10), gearMat(0x151515, 0.6), 0, -0.1, 0.07, 0, 0, 0, [1, 0.9, 0.8]); add(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 12).rotateX(Math.PI / 2), gearMat(0x2a2a2a, 0.5, 0.5), 0, -0.13, 0.14); add(new THREE.BoxGeometry(0.11, 0.035, 0.02), gearMat(0x0a0a0a, 0.1, 0.5), 0, -0.04, 0.11); break;
    case 'hood': add(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), gearMat(top, 0.95, 0), 0, -0.04, -0.025, -0.15, 0, 0, [1, 1.05, 1.1]); break;
    case 'vest': {
      const m = gearMat(0x1d211a, 0.8);
      add(new THREE.BoxGeometry(0.36, 0.4, 0.07), m, 0, 0, 0.11); add(new THREE.BoxGeometry(0.36, 0.4, 0.06), m, 0, 0, -0.12);
      for (const x of [-0.11, 0, 0.11]) add(new THREE.BoxGeometry(0.08, 0.1, 0.04), gearMat(0x2a2e24, 0.9), x, -0.1, 0.16);
      add(new THREE.BoxGeometry(0.06, 0.02, 0.25), m, 0.14, 0.2, 0); add(new THREE.BoxGeometry(0.06, 0.02, 0.25), m, -0.14, 0.2, 0);
      break;
    }
    case 'backpack': { const m = gearMat(0x3a2e22, 0.9); add(new THREE.BoxGeometry(0.32, 0.42, 0.17), m, 0, -0.02, -0.21); add(new THREE.BoxGeometry(0.26, 0.16, 0.06), gearMat(acc, 0.9), 0, -0.14, -0.31); add(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 10).rotateZ(Math.PI / 2), gearMat(0x3a4a2a, 0.95), 0, 0.22, -0.2); break; }
    default: return null;
  }
  return g;
}

// ---------------------------------------------------------------- the character view
export interface CharState {
  anim: string; speed: number; moveYaw: number; aimYaw: number; pitch: number; aiming: boolean; armed: boolean; weapon: WeaponId | null;
  firing: boolean; reloading: boolean; melee: boolean; dead: boolean; driving: boolean; shadow: number; awaken: number; hit: number; cast: boolean; healing: boolean;
}

export class CharacterView {
  root = new THREE.Group();
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  assets: CharacterAssets;
  uniforms: OutfitUniforms;
  bones = new Map<string, THREE.Bone>();
  weapon: WeaponModel | null = null;
  weaponKey = '';
  creature: CreatureKind | null;
  private base: { name: string; action: THREE.AnimationAction } | null = null;
  private upperA: { name: string; action: THREE.AnimationAction } | null = null;
  private oneShot: THREE.AnimationAction | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private yaw = 0;
  private handR: THREE.Bone | undefined;
  private eyeMat: THREE.MeshStandardMaterial | null = null;
  bodyMesh: THREE.SkinnedMesh | null = null;
  baseMat: THREE.MeshStandardMaterial | null = null;
  private gunInHand = new THREE.Matrix4();
  private kick = 0;

  constructor(assets: CharacterAssets, look: CharacterLook, creature: CreatureKind | null = null, seed = Math.random() * 100) {
    this.assets = assets;
    this.creature = creature;
    const src = assets.bodies[look.body];
    this.model = skeletonClone(src.scene);
    this.root.add(this.model);
    const zombie = creature === 'crawler' ? 1 : creature === 'hollow' ? 2 : creature === 'stalker' ? 3 : 0;
    this.uniforms = outfitUniforms(look, assets, zombie, seed);
    this.model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      if (!sm.isMesh) return;
      sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
      const mat = sm.material as THREE.MeshStandardMaterial;
      if (/Superhero|Sphere|SuperHero/.test(sm.name) || mat.name.includes('Superhero')) { this.baseMat = mat; sm.material = makeBodyMaterial(mat, this.uniforms); this.bodyMesh = sm; }
      else if (mat.name.includes('Eye')) { this.eyeMat = mat.clone(); sm.material = this.eyeMat; if (zombie) { this.eyeMat.emissive.set(zombie === 2 ? 0xeeeeff : 0xff1a0a); this.eyeMat.emissiveIntensity = zombie === 3 ? 6 : 2.5; this.eyeMat.color.set(0x000000); } }
      else if (mat.name.includes('Hair')) { const hm = mat.clone(); hm.color.set(0x151010); sm.material = hm; }
    });
    // hair and beard bound to our skeleton
    const hairs: string[] = [];
    if (look.hair !== 'none' && !(look.head === 'helmet' || look.head === 'hood' || look.head === 'gasmask') && zombie !== 3) hairs.push(look.hair);
    if (look.beard && look.body === 'male' && look.head !== 'gasmask') hairs.push('beard');
    for (const h of hairs) this.attachHair(h);
    // gear in bind pose space, then parented to bones so it follows every animation
    this.model.updateMatrixWorld(true);
    const d = assets.dims[look.body];
    if (look.head !== 'none' && !creature) this.attachRigid(gearMesh(look.head, look), 'Head', new THREE.Vector3(0, d.top - 0.075, 0.0));
    if (look.vest && !creature) this.attachRigid(gearMesh('vest', look), 'spine_03', new THREE.Vector3(0, d.neckY - 0.22, 0.0));
    if (look.backpack && !creature) this.attachRigid(gearMesh('backpack', look), 'spine_03', new THREE.Vector3(0, d.neckY - 0.2, 0.0));
    this.handR = this.bones.get('hand_r');

    if (creature) { const s = ({ crawler: [0.95, 0.85, 0.95], hollow: [1, 1.04, 1], stalker: [0.82, 1.28, 0.82] } as const)[creature]; this.model.scale.set(s[0], s[1], s[2]); }
    this.mixer = new THREE.AnimationMixer(this.model);
    this.play('Idle_Loop', 0);
  }

  private attachHair(name: string) {
    const g = this.assets.hair.get(name);
    if (!g) return;
    g.scene.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      const bones = sm.skeleton.bones.map((b) => this.bones.get(b.name) ?? b);
      const mesh = new THREE.SkinnedMesh(sm.geometry, (sm.material as THREE.MeshStandardMaterial).clone());
      (mesh.material as THREE.MeshStandardMaterial).color.set(name === 'beard' ? 0x120c0a : 0x0e0a08);
      mesh.castShadow = true; mesh.frustumCulled = false;
      this.model.add(mesh);
      mesh.bind(new THREE.Skeleton(bones, sm.skeleton.boneInverses.map((m) => m.clone())), sm.bindMatrix.clone());
    });
  }
  private attachRigid(obj: THREE.Object3D | null, boneName: string, worldPos: THREE.Vector3) {
    if (!obj) return;
    const bone = this.bones.get(boneName);
    if (!bone) return;
    const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert();
    const m = new THREE.Matrix4().makeTranslation(worldPos.x, worldPos.y, worldPos.z).premultiply(inv);
    m.decompose(obj.position, obj.quaternion, obj.scale);
    bone.add(obj);
  }

  setWeapon(id: WeaponId | null, l?: Partial<WeaponLoadout>) {
    const key = id ? `${id}:${l?.skin}:${l?.optic}:${l?.muzzle}:${l?.mag}:${l?.grip}` : '';
    if (key === this.weaponKey) return;
    this.weaponKey = key;
    if (this.weapon) { this.weapon.root.parent?.remove(this.weapon.root); this.weapon = null; }
    if (!id || !this.handR) return;
    const w = buildWeapon(id, l);
    // place the grip in the T-posed right hand: barrel along the forearm, grip down
    const sc = this.model.scale.clone(); this.model.scale.set(1, 1, 1);
    const prevQ = this.model.quaternion.clone(); this.model.quaternion.identity();
    const restore = this.saveBindPose();
    this.model.updateMatrixWorld(true);
    const hand = new THREE.Vector3().setFromMatrixPosition(this.handR.matrixWorld);
    const desired = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0));
    desired.setPosition(hand.x - 0.075, hand.y - 0.035, hand.z + 0.02);
    const local = new THREE.Matrix4().copy(this.handR.matrixWorld).invert().multiply(desired);
    local.decompose(w.root.position, w.root.quaternion, w.root.scale);
    this.gunInHand = local.clone();
    restore();
    this.model.scale.copy(sc); this.model.quaternion.copy(prevQ);
    this.handR.add(w.root);
    this.weapon = w;
  }
  private saveBindPose() {
    const saved: [THREE.Bone, THREE.Vector3, THREE.Quaternion][] = [];
    if (this.bodyMesh) for (const b of this.bodyMesh.skeleton.bones) saved.push([b, b.position.clone(), b.quaternion.clone()]);
    this.bodyMesh?.skeleton.pose();
    return () => { for (const [b, p, q] of saved) { b.position.copy(p); b.quaternion.copy(q); } };
  }

  private act(clip: THREE.AnimationClip | undefined, key: string) {
    if (!clip) return null;
    let a = this.actions.get(key);
    if (!a) { a = this.mixer.clipAction(clip); this.actions.set(key, a); }
    return a;
  }
  private play(name: string, fade = 0.2, layer: 'full' | 'lower' = 'full', timeScale = 1, once = false) {
    const key = `${name}:${layer}`;
    if (this.base?.name === key) { this.base.action.timeScale = timeScale; return; }
    const clip = layer === 'full' ? this.assets.clips.get(name) : this.assets.lower.get(name);
    const a = this.act(clip, key);
    if (!a) return;
    a.reset(); a.timeScale = timeScale; a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once;
    a.fadeIn(fade).play();
    if (this.base) this.base.action.fadeOut(fade);
    this.base = { name: key, action: a };
  }
  private playUpper(name: string | null, fade = 0.15) {
    if ((this.upperA?.name ?? null) === name) return;
    if (this.upperA) this.upperA.action.fadeOut(fade);
    this.upperA = null;
    if (!name) return;
    const a = this.act(this.assets.upper.get(name), `${name}:U`);
    if (!a) return;
    a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.fadeIn(fade).play();
    this.upperA = { name, action: a };
  }
  private shot(name: string, upper = true, scale = 1) {
    const a = this.act(upper ? this.assets.upper.get(name) : this.assets.clips.get(name), `${name}:${upper ? 'U1' : 'F1'}`);
    if (!a) return;
    if (this.oneShot && this.oneShot !== a) this.oneShot.fadeOut(0.08);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.timeScale = scale; a.setEffectiveWeight(1); a.fadeIn(0.05).play();
    this.oneShot = a;
  }

  update(dt: number, s: CharState, time: number) {
    this.uniforms.uTime.value = time;
    this.uniforms.uShadowFx.value += ((s.shadow > 0 ? 1 : 0) - this.uniforms.uShadowFx.value) * Math.min(1, dt * 6);
    this.uniforms.uAwaken.value += (s.awaken - this.uniforms.uAwaken.value) * Math.min(1, dt * 2);
    this.uniforms.uHit.value = Math.max(0, this.uniforms.uHit.value - dt * 4);
    if (s.hit > 0) this.uniforms.uHit.value = 0.6;
    if (this.eyeMat && !this.creature) { this.eyeMat.emissive.set(0xff1a0a); this.eyeMat.emissiveIntensity = s.awaken * 5; }

    // facing: GTA style, face movement unless aiming
    const targetYaw = s.aiming || s.firing || s.driving || this.creature ? s.aimYaw : s.speed > 0.4 ? s.moveYaw : this.yaw;
    let dy = targetYaw - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * (s.aiming ? 18 : 10));
    this.root.rotation.y = this.yaw;

    if (this.creature) { this.updateCreature(s); this.mixer.update(dt); return; }

    // base layer
    const armedUpper = s.armed && !s.dead && !s.driving && !['sprint', 'swim', 'swimIdle', 'mantle', 'climb', 'heal'].includes(s.anim) && s.awaken <= 0;
    const layer = armedUpper ? 'lower' : 'full';
    let back = 1;
    if ((s.aiming || s.firing) && s.speed > 0.4) { let rel = s.moveYaw - s.aimYaw; while (rel > Math.PI) rel -= Math.PI * 2; while (rel < -Math.PI) rel += Math.PI * 2; if (Math.abs(rel) > Math.PI * 0.6) back = -1; }
    switch (s.anim) {
      case 'dead': this.play('Death01', 0.15, 'full', 1, true); this.playUpper(null); break;
      case 'drive': this.play('Driving_Loop', 0.2, 'full'); break;
      case 'sprint': this.play('Sprint_Loop', 0.15, 'full', s.speed / 6.8); break;
      case 'jog': this.play('Jog_Fwd_Loop', 0.2, layer, back * s.speed / 4.6); break;
      case 'walk': this.play('Walk_Loop', 0.2, layer, back * Math.max(0.6, s.speed / 2.2)); break;
      case 'crouch': this.play('Crouch_Idle_Loop', 0.2, layer); break;
      case 'crouchWalk': this.play('Crouch_Fwd_Loop', 0.2, layer, back * s.speed / 1.8); break;
      case 'jump': this.play('Jump_Loop', 0.12, layer); break;
      case 'fall': this.play('Jump_Loop', 0.2, layer); break;
      case 'swim': this.play('Swim_Fwd_Loop', 0.3, 'full'); break;
      case 'swimIdle': this.play('Swim_Idle_Loop', 0.3, 'full'); break;
      case 'mantle': case 'climb': this.play('ClimbUp_1m', 0.1, 'full', 1.6); break;
      case 'heal': this.play('Consume', 0.2, 'full'); break;
      default: this.play(s.armed && s.awaken <= 0 ? 'Idle_Loop' : 'Idle_Loop', 0.25, layer);
    }
    if (armedUpper) this.playUpper(s.aiming || s.firing ? 'Pistol_Aim_Neutral' : 'Pistol_Idle_Loop');
    else this.playUpper(null);
    if (s.firing && !s.dead) { if (s.melee) this.shot(s.awaken > 0 ? 'Melee_Hook' : 'Sword_Attack', s.awaken <= 0, 1.4); else if (armedUpper) this.shot('Pistol_Shoot', true, 1.6); }
    if (s.reloading) this.shot('Pistol_Reload', true, 1.2);
    if (s.cast) this.shot('Spell_Simple_Shoot', true, 1.3);
    this.mixer.update(dt);
    if (this.weapon) this.weapon.root.visible = s.armed && s.awaken <= 0 && !s.driving;
    if (s.driving && this.weapon) this.weapon.root.visible = false;

    if (s.firing && !s.melee) this.kick = Math.min(1, this.kick + 0.6);
    this.kick = Math.max(0, this.kick - dt * 9);
    // aim pitch: bend the spine toward the crosshair
    if (armedUpper && (s.aiming || s.firing)) {
      this.model.updateMatrixWorld(true);
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      for (const n of ['spine_02', 'spine_03']) {
        const b = this.bones.get(n); if (!b || !b.parent) continue;
        const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
        const q = new THREE.Quaternion().setFromAxisAngle(right, -s.pitch * 0.5);
        b.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
        b.updateMatrixWorld(true);
      }
    }
    if (armedUpper && s.weapon && LONG_GUNS.has(s.weapon) && this.weapon) this.shoulderRifle(s);
  }

  /** Long guns: place the gun at the shoulder along the aim and pull both hands onto it with two-bone IK. */
  private shoulderRifle(s: CharState) {
    const B = (n: string) => this.bones.get(n)!;
    const chestB = B('spine_03'), ua = B('upperarm_r'), la = B('lowerarm_r'), ha = B('hand_r'), ub = B('upperarm_l'), lb = B('lowerarm_l'), hb = B('hand_l');
    if (!chestB || !ua || !la || !ha || !ub || !lb || !hb) return;
    this.model.updateMatrixWorld(true);
    const up = V(0, 1, 0);
    const aimed = s.aiming || s.firing;
    const pitch = aimed ? s.pitch : -0.55;
    const yaw = this.yaw + (aimed ? 0 : 0.35);
    const dir = V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const right = V(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const chest = chestB.getWorldPosition(V());
    const pos = chest.clone().addScaledVector(up, aimed ? 0.15 : -0.02).addScaledVector(right, aimed ? 0.15 : 0.12).addScaledVector(dir, (aimed ? 0.2 : 0.28) - this.kick * 0.05);
    const x = V().crossVectors(up, dir).normalize(), y = V().crossVectors(dir, x);
    const G = new THREE.Matrix4().makeBasis(x, y, dir).setPosition(pos);
    const H = G.clone().multiply(new THREE.Matrix4().copy(this.gunInHand).invert());
    const handPos = V().setFromMatrixPosition(H), handQ = new THREE.Quaternion().setFromRotationMatrix(H);
    twoBoneIK(ua, la, ha, handPos, chest.clone().addScaledVector(right, 0.5).addScaledVector(up, -0.6).addScaledVector(dir, -0.1));
    setWorldQuat(ha, handQ);
    const fore = FOREGRIP[s.weapon!] ?? 0.35;
    const leftT = V(0, -0.02, fore).applyMatrix4(G).addScaledVector(right, 0.02);
    twoBoneIK(ub, lb, hb, leftT, chest.clone().addScaledVector(right, -0.45).addScaledVector(up, -0.7).addScaledVector(dir, 0.15));
  }

  private updateCreature(s: CharState) {
    const k = this.creature!;
    switch (s.anim) {
      case 'dead': this.play('Death01', 0.15, 'full', 1, true); break;
      case 'attack': this.play('Zombie_Scratch', 0.1, 'full', k === 'stalker' ? 1.6 : 1.2); break;
      case 'run': k === 'crawler' ? this.play('Crouch_Fwd_Loop', 0.15, 'full', 2.2) : k === 'stalker' ? this.play('Sprint_Loop', 0.15, 'full', 1.15) : this.play('Zombie_Walk_Fwd_Loop', 0.2, 'full', 1.8); break;
      case 'walk': k === 'crawler' ? this.play('Crouch_Fwd_Loop', 0.2, 'full', 1.2) : this.play('Zombie_Walk_Fwd_Loop', 0.25, 'full', Math.max(0.6, s.speed / 1.4)); break;
      case 'frozen': this.play('Zombie_Idle_Loop', 0.05, 'full', 0); break;
      default: this.play(k === 'crawler' ? 'Crouch_Idle_Loop' : 'Zombie_Idle_Loop', 0.3, 'full');
    }
  }

  dispose() { this.mixer.stopAllAction(); this.root.removeFromParent(); }
}

/** Bakes a dead pose into a static mesh for corpse props. */
export function bakeCorpse(assets: CharacterAssets, look: CharacterLook): THREE.Mesh | null {
  const view = new CharacterView(assets, look, null, 3);
  const clip = assets.clips.get('Death01');
  if (!clip || !view.bodyMesh) return null;
  const a = view.mixer.clipAction(clip); a.play(); view.mixer.setTime(clip.duration - 0.01);
  view.model.updateMatrixWorld(true);
  const sm = view.bodyMesh;
  const src = sm.geometry;
  const pos = src.getAttribute('position');
  const out = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); sm.applyBoneTransform(i, v); v.applyMatrix4(sm.matrixWorld); out.set([v.x, v.y, v.z], i * 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setAttribute('bindPos', pos.clone());
  g.setAttribute('uv', src.getAttribute('uv'));
  if (src.index) g.setIndex(src.index);
  g.computeVertexNormals();
  const mat = makeBodyMaterial(view.baseMat!, outfitUniforms({ ...look, scars: 1 }, assets, 0, 2), true);
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  view.dispose();
  return mesh;
}

export const RANDOM_TOPS = TOPS; export const RANDOM_PATTERNS = PATTERNS;
