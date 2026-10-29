// People of HustleLife: the Fab roster baked onto one skeleton (charbake/bake.py), one shared animation library,
// per-person outfit tints and Lagos prints, and an upper body that aims without drifting.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterLook, Pattern } from '../data/cosmetics';
import { SKIN_TONES } from '../data/cosmetics';
import type { WeaponId } from '../data/balance';
import type { WeaponLoadout } from '../data/cosmetics';
import { buildWeapon, type WeaponModel } from './weapons3d';
import { twoBoneIK } from './characters';

export type RosterId = 'survivor' | 'rogue' | 'trooper' | 'girl' | 'farah';
type Slot = 'top' | 'pants' | 'shoes' | 'acc' | 'skin' | 'hair' | 'eyes' | 'keep';
interface RosterDef { name: string; sex: 'm' | 'f'; blurb: string; slots: [RegExp, Slot][]; zoned?: RegExp; clip?: RegExp; patterned?: boolean }

/** Material name -> what it is. Untextured sources get their colour from the look; textured ones keep their maps. */
export const ROSTER: Record<RosterId, RosterDef> = {
  survivor: { name: 'Tunde', sex: 'm', blurb: 'Street hustler. Jacket, jeans, no fear.', slots: [[/^(Head|Body2|Arms)/, 'skin'], [/^Jacket/, 'top'], [/^Jeans/, 'pants'], [/^Shoes/, 'shoes'], [/^Gloves/, 'acc'], [/^Body_Arkit/, 'eyes'], [/^Mouth/, 'keep']], patterned: true },
  rogue: { name: 'Shadow', sex: 'm', blurb: 'Hooded runner from the back streets.', slots: [[/^Head/, 'skin'], [/^LeatherA/, 'top'], [/^Cloth/, 'pants'], [/^LeatherB/, 'shoes'], [/^Metal/, 'keep']] },
  trooper: { name: 'Tactical', sex: 'm', blurb: 'Rapid response. Shows up at three stars.', slots: [[/.*/, 'keep']] },
  girl: { name: 'Amaka', sex: 'f', blurb: 'Fast mouth, faster feet.', slots: [[/^(body_skin|head\b|head\.)/, 'skin'], [/^head_eyes/, 'eyes'], [/^hair/, 'hair'], [/^body/, 'top']], zoned: /^body(\.|$)/ },
  farah: { name: 'Zainab', sex: 'f', blurb: 'Market trader by day, plug by night.', slots: [[/^Cloth_Top/, 'top'], [/^Cloth_Bottom/, 'pants'], [/^Shoes/, 'shoes'], [/.*/, 'keep']], clip: /^(aaa|Scalp|hair|strands|base)/, patterned: true },
};
export const ROSTER_IDS = Object.keys(ROSTER) as RosterId[];
export const CIVILIAN_M: RosterId[] = ['survivor', 'survivor', 'survivor', 'rogue'];
export const CIVILIAN_F: RosterId[] = ['farah', 'girl'];

const UPPER = /^(spine_0[1-3]|neck_01|Head|clavicle_|upperarm_|lowerarm_|hand_|index_|middle_|pinky_|ring_|thumb_)/;
const LONG_GUNS = new Set<WeaponId>(['ar', 'smg', 'shotgun', 'sniper']);
const FOREGRIP: Partial<Record<WeaponId, number>> = { smg: 0.24, ar: 0.42, shotgun: 0.42, sniper: 0.46 };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UAL_HIP = 0.949;

interface ModelSet { gltf: GLTF; clips: Map<string, THREE.AnimationClip>; upper: Map<string, THREE.AnimationClip>; lower: Map<string, THREE.AnimationClip>; dims: { waistY: number; ankleY: number; neckY: number; top: number }; /** decimated geometry per mesh, same order as the full model (null if the LOD file is missing) */ lod: THREE.BufferGeometry[] | null }

export class HumanAssets {
  models = new Map<RosterId, ModelSet>();
  office: THREE.Mesh[] = [];
  async load(onProgress?: (f: number) => void) {
    const L = new GLTFLoader();
    const files = ['anim/ual1', 'anim/ual2', ...ROSTER_IDS.map((r) => `humans/${r}`), 'humans/office'];
    let done = 0;
    const res = await Promise.all(files.map((f) => L.loadAsync(`assets/${f}.wasm`).then((g) => { onProgress?.(++done / files.length); return g; })));
    // far-away LOD: geometry only, same skeleton and mesh order (tools/charlod.py); missing files just mean no LOD
    const lods = await Promise.all(ROSTER_IDS.map((id) => L.loadAsync(`assets/humans/${id}_lod.wasm`).then((g) => { const out: THREE.BufferGeometry[] = []; g.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push((o as THREE.Mesh).geometry); }); return out; }).catch(() => null)));
    const raw = new Map<string, THREE.AnimationClip>();
    for (const g of [res[0], res[1]]) for (const c of g.animations) raw.set(c.name, c);
    ROSTER_IDS.forEach((id, i) => {
      const g = res[2 + i];
      g.scene.updateMatrixWorld(true);
      const pos = (n: string) => { const o = g.scene.getObjectByName(n); return o ? V().setFromMatrixPosition(o.matrixWorld) : V(); };
      const hip = pos('pelvis').y, k = hip / UAL_HIP;
      const clips = new Map<string, THREE.AnimationClip>(), upper = new Map<string, THREE.AnimationClip>(), lower = new Map<string, THREE.AnimationClip>();
      for (const [name, c] of raw) {
        // rotations transfer as-is (same rest orientations); only the hips move, scaled to this body
        const tr = c.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position').map((t) => {
          if (t.name !== 'pelvis.position') return t;
          const n = t.clone(); for (let j = 0; j < n.values.length; j++) n.values[j] *= k; return n;
        });
        clips.set(name, new THREE.AnimationClip(name, c.duration, tr));
        upper.set(name, new THREE.AnimationClip(name + '_U', c.duration, tr.filter((t) => UPPER.test(t.name.split('.')[0]))));
        lower.set(name, new THREE.AnimationClip(name + '_L', c.duration, tr.filter((t) => !UPPER.test(t.name.split('.')[0]))));
      }
      const box = new THREE.Box3().setFromObject(g.scene);
      this.models.set(id, { gltf: g, clips, upper, lower, dims: { waistY: hip + 0.07, ankleY: pos('foot_l').y + 0.04, neckY: pos('neck_01').y, top: box.max.y }, lod: lods[i] });
    });
    res[res.length - 1].scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) { const m = o as THREE.Mesh; m.castShadow = true; m.receiveShadow = true; this.office.push(m); } });
  }
}

// ---------------------------------------------------------------- outfit shader: Lagos prints in bind space
const PATTERN_ID: Record<Pattern, number> = { solid: 0, ankara_sun: 1, ankara_wave: 2, adire: 3, kente: 4, camo_urban: 5, camo_night: 6, stripe_danfo: 7 };
const PAT_GLSL = /* glsl */ `
float chh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
float cnn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(chh(i),chh(i+vec3(1,0,0)),f.x),mix(chh(i+vec3(0,1,0)),chh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(chh(i+vec3(0,0,1)),chh(i+vec3(1,0,1)),f.x),mix(chh(i+vec3(0,1,1)),chh(i+vec3(1,1,1)),f.x),f.y),f.z); }
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
}`;

function lin(hex: string | number) { return new THREE.Color(hex as any); }

/** Fabric: weave and a print in bind space. `zones` splits a one-material outfit into top / pants / shoes by height. */
function clothMaterial(base: THREE.MeshStandardMaterial, u: Record<string, THREE.IUniform>, zoned: boolean) {
  const m = base.clone();
  m.map = null; m.color.set(0xffffff); m.roughness = 0.88; m.metalness = 0;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec3 uTop; uniform vec3 uAcc; uniform vec3 uPants; uniform vec3 uShoe; uniform float uPat; uniform float uPantsPat; uniform vec3 uZ; uniform float uHit; uniform float uDirt;
      varying vec3 vBind;\n${PAT_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 bp = vBind; vec3 c;
        ${zoned ? `if (bp.y < uZ.y) c = uShoe; else if (bp.y < uZ.x) c = patternCol(uPantsPat, bp, uPants, uPants * 0.6); else c = patternCol(uPat, bp, uTop, uAcc);`
                : `c = patternCol(uPat, bp, uTop, uAcc);`}
        float weave = cnn(bp * 420.0) * 0.5 + cnn(bp * 160.0) * 0.5;
        c *= 0.84 + 0.22 * weave;
        c = mix(c, vec3(0.09, 0.06, 0.035), clamp(smoothstep(0.45, 0.0, bp.y) * 0.5 * uDirt, 0.0, 0.6));
        diffuseColor.rgb = c;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.8, 0.0, 0.0) * uHit;');
  };
  m.customProgramCacheKey = () => `cloth${zoned ? 'Z' : ''}`;
  return m;
}

// ---------------------------------------------------------------- the person
export interface CharState {
  anim: string; speed: number; moveYaw: number; aimYaw: number; pitch: number; aiming: boolean; armed: boolean; weapon: WeaponId | null;
  firing: boolean; reloading: boolean; melee: boolean; dead: boolean; driving: boolean; shadow: number; awaken: number; hit: number; cast: boolean; healing: boolean;
  /** with anim 'emote': the animation library clip to loop (multiplayer emotes) */
  clip?: string;
  /** set while seated in a vehicle: world space anchor and limb targets */
  seat?: SeatTarget | null;
}
/** Where a seated body goes, in world space. The pelvis lands on `hip`; hands and ankles are bent to the targets. */
export interface SeatTarget {
  pose: 'drive' | 'sit' | 'ride' | 'pillion'; hip: THREE.Vector3; yaw: number; roof: number; lean: number;
  hands: [THREE.Vector3, THREE.Vector3] | null; feet: [THREE.Vector3, THREE.Vector3] | null;
}

function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion) {
  const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

export function rosterOf(look: CharacterLook): RosterId {
  const m = (look as any).model as RosterId | undefined;
  if (m && ROSTER[m]) return m;
  return look.body === 'female' ? 'farah' : 'survivor';
}

export class HumanView {
  root = new THREE.Group();
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  bones = new Map<string, THREE.Bone>();
  weapon: WeaponModel | null = null;
  weaponKey = '';
  id: RosterId;
  bodyMesh: THREE.SkinnedMesh | null = null;
  private set: ModelSet;
  private u: Record<string, THREE.IUniform>;
  private mats: THREE.MeshStandardMaterial[] = [];
  private base: { name: string; action: THREE.AnimationAction } | null = null;
  private upperA: { name: string; action: THREE.AnimationAction } | null = null;
  private oneShot: THREE.AnimationAction | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private yaw = 0;
  private handR: THREE.Bone | undefined;
  private gunInHand = new THREE.Matrix4();
  private kick = 0;
  /** bone rotations as the mixer left them: restored before each mixer update so procedural aim never accumulates */
  private snap: { b: THREE.Bone; q: THREE.Quaternion }[] = [];
  private skins: THREE.SkinnedMesh[] = []; private fullGeo: THREE.BufferGeometry[] = [];
  lodOn = false;

  constructor(assets: HumanAssets, look: CharacterLook, seed = Math.random() * 100) {
    this.id = rosterOf(look);
    const def = ROSTER[this.id];
    this.set = assets.models.get(this.id)!;
    this.model = skeletonClone(this.set.gltf.scene);
    this.root.add(this.model);
    const d = this.set.dims;
    const tone = lin(SKIN_TONES[look.skin] ?? SKIN_TONES[1]);
    this.u = {
      uTop: { value: lin(look.topColor) }, uAcc: { value: lin(look.topAccent) }, uPants: { value: lin(look.pantsColor) }, uShoe: { value: lin(look.shoes) },
      uPat: { value: def.patterned || def.zoned ? PATTERN_ID[look.topPattern] : 0 }, uPantsPat: { value: PATTERN_ID[look.pants] }, uZ: { value: V(d.waistY, d.ankleY, d.neckY) },
      uHit: { value: 0 }, uDirt: { value: look.scars + 0.25 },
    };
    const cache = new Map<THREE.Material, THREE.Material>();
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isMesh) return;
      sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
      this.skins.push(sm); this.fullGeo.push(sm.geometry);
      if (!this.bodyMesh || (sm.geometry.attributes.position.count > this.bodyMesh.geometry.attributes.position.count)) this.bodyMesh = sm;
      const src = sm.material as THREE.MeshStandardMaterial;
      let mat = cache.get(src) as THREE.MeshStandardMaterial | undefined;
      if (!mat) {
        const slot = def.slots.find(([rx]) => rx.test(src.name))?.[1] ?? 'keep';
        if (slot === 'top' || slot === 'pants' || slot === 'shoes') {
          if (slot === 'top' && (def.patterned || def.zoned)) mat = clothMaterial(src, this.u, !!def.zoned && def.zoned.test(src.name));
          else { mat = src.clone(); if (!mat.map) mat.color.copy(slot === 'pants' ? lin(look.pantsColor) : slot === 'shoes' ? lin(look.shoes) : lin(look.topColor)); else mat.color.copy(slot === 'pants' ? lin(look.pantsColor) : lin(look.shoes)).lerp(new THREE.Color(1, 1, 1), 0.4); }
        } else if (slot === 'acc') { mat = src.clone(); mat.color.copy(lin(look.topAccent)).multiplyScalar(0.5); }
        else if (slot === 'skin') { mat = src.clone(); mat.color.copy(tone); mat.roughness = 0.52; }
        else if (slot === 'hair') { mat = src.clone(); mat.color.set(0x0c0907); mat.roughness = 0.7; }
        else if (slot === 'eyes') { mat = src.clone(); mat.color.set(0x140a06); mat.roughness = 0.08; }
        else mat = src.clone();
        if (def.clip && def.clip.test(src.name)) { mat.transparent = false; mat.alphaTest = 0.5; mat.depthWrite = true; mat.alphaToCoverage = true; }
        else if (mat.transparent && !(mat as any).alphaMap) { mat.transparent = false; mat.depthWrite = true; }
        mat.envMapIntensity = 0.8;
        cache.set(src, mat); this.mats.push(mat);
      }
      sm.material = mat;
    });
    this.handR = this.bones.get('hand_r');
    for (const b of this.bones.values()) this.snap.push({ b, q: b.quaternion.clone() });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.yaw = seed % (Math.PI * 2);
    this.play('Idle_Loop', 0);
  }

  /** Swaps the decimated geometry in for characters far from the camera. */
  setLod(on: boolean) {
    if (on === this.lodOn) return;
    const lod = this.set.lod; if (!lod || lod.length !== this.skins.length) return;
    this.lodOn = on; for (let i = 0; i < this.skins.length; i++) this.skins[i].geometry = on ? lod[i] : this.fullGeo[i];
  }

  setWeapon(id: WeaponId | null, l?: Partial<WeaponLoadout>) {
    const key = id ? `${id}:${l?.skin}:${l?.optic}:${l?.muzzle}:${l?.mag}:${l?.grip}` : '';
    if (key === this.weaponKey) return;
    this.weaponKey = key;
    if (this.weapon) { this.weapon.root.parent?.remove(this.weapon.root); this.weapon = null; }
    if (!id || !this.handR) return;
    const w = buildWeapon(id, l);
    const prevQ = this.model.quaternion.clone(); this.model.quaternion.identity();
    const restore = this.saveBindPose();
    this.model.updateMatrixWorld(true);
    const hand = V().setFromMatrixPosition(this.handR.matrixWorld);
    const desired = new THREE.Matrix4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(-1, 0, 0));
    desired.setPosition(hand.x - 0.075, hand.y - 0.035, hand.z + 0.02);
    const local = new THREE.Matrix4().copy(this.handR.matrixWorld).invert().multiply(desired);
    local.decompose(w.root.position, w.root.quaternion, w.root.scale);
    this.gunInHand = local.clone();
    restore();
    this.model.quaternion.copy(prevQ);
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
    const a = this.act(layer === 'full' ? this.set.clips.get(name) : this.set.lower.get(name), key);
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
    const a = this.act(this.set.upper.get(name), `${name}:U`);
    if (!a) return;
    a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.fadeIn(fade).play();
    this.upperA = { name, action: a };
  }
  private shot(name: string, upper = true, scale = 1) {
    const a = this.act(upper ? this.set.upper.get(name) : this.set.clips.get(name), `${name}:${upper ? 'U1' : 'F1'}`);
    if (!a) return;
    if (this.oneShot && this.oneShot !== a) this.oneShot.fadeOut(0.08);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.timeScale = scale; a.setEffectiveWeight(1); a.fadeIn(0.05).play();
    this.oneShot = a;
  }

  update(dt: number, s: CharState, _time: number) {
    this.u.uHit.value = Math.max(0, this.u.uHit.value - dt * 4);
    if (s.hit > 0) this.u.uHit.value = 0.6;
    for (const m of this.mats) if (m.emissive && !(m as any).emissiveMap) m.emissive.setRGB(this.u.uHit.value * 0.5, 0, 0);

    // face movement unless aiming, driving: the root yaw follows the aim so the spine never has to twist far
    const targetYaw = s.aiming || s.firing || s.driving ? s.aimYaw : s.speed > 0.4 ? s.moveYaw : this.yaw;
    let dy = targetYaw - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * (s.aiming ? 18 : 10));
    if (s.seat) this.yaw = s.seat.yaw; else if (this.root.scale.x !== 1) this.root.scale.setScalar(1);
    this.root.rotation.y = this.yaw;

    // undo last frame's procedural pose; the mixer skips writing bones whose value did not change
    for (const x of this.snap) x.b.quaternion.copy(x.q);

    const armedUpper = s.armed && !s.dead && !s.driving && !['sprint', 'swim', 'swimIdle', 'mantle', 'climb', 'heal', 'emote'].includes(s.anim);
    const layer = armedUpper ? 'lower' : 'full';
    let back = 1;
    if ((s.aiming || s.firing) && s.speed > 0.4) { let rel = s.moveYaw - s.aimYaw; while (rel > Math.PI) rel -= Math.PI * 2; while (rel < -Math.PI) rel += Math.PI * 2; if (Math.abs(rel) > Math.PI * 0.6) back = -1; }
    const fem = ROSTER[this.id].sex === 'f';
    switch (s.anim) {
      case 'dead': this.play('Death01', 0.15, 'full', 1, true); this.playUpper(null); break;
      case 'drive': this.play(!s.seat || s.seat.pose === 'drive' || s.seat.pose === 'ride' ? 'Driving_Loop' : 'Sitting_Idle_Loop', 0.2, 'full'); break;
      case 'sprint': this.play('Sprint_Loop', 0.15, 'full', s.speed / 6.8); break;
      case 'jog': this.play('Jog_Fwd_Loop', 0.2, layer, back * s.speed / 4.6); break;
      case 'walk': this.play(fem && !armedUpper ? 'Walk_Formal_Loop' : 'Walk_Loop', 0.2, layer, back * Math.max(0.6, s.speed / 2.2)); break;
      case 'crouch': this.play('Crouch_Idle_Loop', 0.2, layer); break;
      case 'crouchWalk': this.play('Crouch_Fwd_Loop', 0.2, layer, back * s.speed / 1.8); break;
      case 'jump': case 'fall': this.play('Jump_Loop', 0.15, layer); break;
      case 'swim': this.play('Swim_Fwd_Loop', 0.3, 'full'); break;
      case 'swimIdle': this.play('Swim_Idle_Loop', 0.3, 'full'); break;
      case 'mantle': case 'climb': this.play('ClimbUp_1m', 0.1, 'full', 1.6); break;
      case 'heal': this.play('Consume', 0.2, 'full'); break;
      case 'talk': this.play('Idle_TalkingPhone_Loop', 0.3, 'full'); break;
      case 'emote': this.play(s.clip ?? 'Idle_Loop', 0.25, 'full'); break;
      default: this.play('Idle_Loop', 0.25, layer);
    }
    if (armedUpper) this.playUpper(s.aiming || s.firing ? 'Pistol_Aim_Neutral' : 'Pistol_Idle_Loop');
    else this.playUpper(null);
    if (s.firing && !s.dead) { if (s.melee) this.shot(s.weapon ? 'Sword_Attack' : (Math.random() < 0.5 ? 'Punch_Jab' : 'Punch_Cross'), true, 1.4); else if (armedUpper) this.shot('Pistol_Shoot', true, 1.6); }
    if (s.reloading) this.shot('Pistol_Reload', true, 1.2);
    this.mixer.update(dt);
    for (const x of this.snap) x.q.copy(x.b.quaternion);
    if (this.weapon) this.weapon.root.visible = s.armed && !s.driving;

    if (s.firing && !s.melee) this.kick = Math.min(1, this.kick + 0.6);
    this.kick = Math.max(0, this.kick - dt * 9);
    // aim pitch: an absolute, clamped bend shared over two spine bones
    if (armedUpper && (s.aiming || s.firing)) {
      this.model.updateMatrixWorld(true);
      const right = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const pitch = THREE.MathUtils.clamp(s.pitch, -1.1, 1.1);
      for (const n of ['spine_02', 'spine_03']) {
        const b = this.bones.get(n); if (!b || !b.parent) continue;
        const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
        const q = new THREE.Quaternion().setFromAxisAngle(right, -pitch * 0.5);
        b.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
        b.updateMatrixWorld(true);
      }
    }
    if (armedUpper && s.weapon && LONG_GUNS.has(s.weapon) && this.weapon) this.shoulderRifle(s);
    if (s.seat && s.driving) this.applySeat(s.seat);
  }

  /** Seats the body: pelvis onto the seat point, torso lean, headroom fit, then two-bone IK for hands and feet. Runs after the mixer. */
  private applySeat(t: SeatTarget) {
    const B = (n: string) => this.bones.get(n);
    const pel = B('pelvis'); if (!pel) return;
    const anchor = () => { this.root.updateMatrixWorld(true); this.root.position.add(V().copy(t.hip).sub(pel.getWorldPosition(V()))); this.root.updateMatrixWorld(true); };
    this.root.scale.setScalar(1); anchor();
    const ul = B('upperarm_l'), ur = B('upperarm_r');
    const lat = ul && ur ? ul.getWorldPosition(V()).sub(ur.getWorldPosition(V())).normalize() : V(Math.cos(t.yaw), 0, -Math.sin(t.yaw));
    const fwd = V(Math.sin(t.yaw), 0, Math.cos(t.yaw));
    // lean forward by bending the three spine bones about the lateral axis
    if (t.lean) for (const n of ['spine_01', 'spine_02', 'spine_03']) {
      const b = B(n); if (!b || !b.parent) continue;
      const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
      b.quaternion.premultiply(pq.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(lat, t.lean / 3)).multiply(pq)); b.updateMatrixWorld(true);
    }
    // headroom: shrink the body a little rather than push the head through the roof
    const head = B('Head');
    if (head) {
      const have = head.getWorldPosition(V()).y + 0.2 - t.hip.y, room = t.roof - t.hip.y;
      if (have > room && room > 0.35) { this.root.scale.setScalar(Math.max(0.8, room / have)); anchor(); }
    }
    const down = V(0, -1, 0);
    if (t.hands) for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 'l' : 'r', sg = i === 0 ? 1 : -1; const ua = B('upperarm_' + side), la = B('lowerarm_' + side), ha = B('hand_' + side); if (!ua || !la || !ha) continue;
      const sh = ua.getWorldPosition(V());
      twoBoneIK(ua, la, ha, t.hands[i], sh.clone().addScaledVector(lat, sg * 0.45).addScaledVector(down, 0.5).addScaledVector(fwd, -0.15));
    }
    if (t.feet) for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 'l' : 'r', sg = i === 0 ? 1 : -1; const th = B('thigh_' + side), ca = B('calf_' + side), fo = B('foot_' + side); if (!th || !ca || !fo) continue;
      const hp = th.getWorldPosition(V());
      twoBoneIK(th, ca, fo, t.feet[i], hp.clone().addScaledVector(fwd, 0.7).addScaledVector(lat, sg * (t.pose === 'ride' || t.pose === 'pillion' ? 0.5 : 0.12)).addScaledVector(down, -0.15));
    }
  }

  private shoulderRifle(s: CharState) {
    const B = (n: string) => this.bones.get(n)!;
    const chestB = B('spine_03'), ua = B('upperarm_r'), la = B('lowerarm_r'), ha = B('hand_r'), ub = B('upperarm_l'), lb = B('lowerarm_l'), hb = B('hand_l');
    if (!chestB || !ua || !la || !ha || !ub || !lb || !hb) return;
    this.model.updateMatrixWorld(true);
    const up = V(0, 1, 0);
    const aimed = s.aiming || s.firing;
    const pitch = aimed ? THREE.MathUtils.clamp(s.pitch, -1.1, 1.1) : -0.55;
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

  dispose() { this.mixer.stopAllAction(); this.root.removeFromParent(); for (const m of this.mats) m.dispose(); }
}

/** Standing crowds from the photo-scanned people: bus stops, shop fronts. Shared geometry, no skinning. */
export function officePerson(assets: HumanAssets, i: number) {
  const src = assets.office[i % assets.office.length];
  const m = new THREE.Mesh(src.geometry, src.material); m.castShadow = true; m.receiveShadow = true;
  m.quaternion.copy(src.quaternion); m.scale.copy(src.scale);
  const g = new THREE.Group(); g.add(m); return g;
}
