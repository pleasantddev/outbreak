// The lobby stage: the player's hustler on a lit plinth in the middle of a real Lagos street, wet road, cars with
// headlights behind, the bridge and street lights down the road. It lives inside LifeView's own scene and renderer
// (nothing else is loaded), so it costs a handful of draw calls on top of the world that is already streamed.
// The same stage renders the crew key art used by the loading screen (mode 'keyart').
import * as THREE from 'three';
import type { LifeView } from './lifeView';
import type { LifeSim } from '../sim/life';
import type { RegionStore } from '../world/region';
import { RF, ROAD } from '../world/region';
import { halfWidth } from '../world/roadspec';
import { HumanView, type HumanAssets, type RosterId } from './humans';
import { buildCar, poseCar, type CarModel } from './cars';
import type { VehicleKind } from '../data/balance';
import { WEATHER } from './sky';
import type { CharacterLook } from '../data/cosmetics';
import { RoadNet } from '../world/roadnet';
import { lookFor } from '../profile';

export type StageMode = 'lobby' | 'keyart';
export interface Site { x: number; z: number; /** world direction the camera looks along */ dx: number; dz: number; score: number; bridge: boolean; why: string }

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ease = (a: number, b: number, k: number) => a + (b - a) * k;
const IDLE_STATE = { anim: 'idle', speed: 0, moveYaw: 0, aimYaw: 0, pitch: 0, aiming: false, armed: false, weapon: null, firing: false, reloading: false, melee: false, dead: false, driving: false, shadow: 0, awaken: 0, hit: 0, cast: false, healing: false } as const;
export const EMOTES = ['Idle_FoldArms_Loop', 'Dance_Loop', 'Idle_TalkingPhone_Loop', 'Idle_No_Loop', 'Idle_Talking_Loop'];

/** Find streets near the spawn that make a good backdrop: long and straight, buildings and lamps down the road, a flyover in view. */
export function pickSites(store: RegionStore, lamps: ArrayLike<number>, spawn: { x: number; z: number }, want = 3): Site[] {
  const regs = [...store.regions.values()];
  const bridges: { x: number; z: number }[] = [];
  const blds: { x: number; z: number; w: number }[] = [];
  for (const r of regs) {
    for (const rd of r.roads) if (rd.flags & RF.bridge) for (let k = 0; k < rd.pts.length; k += 6) { const x = rd.pts[k], z = rd.pts[k + 1]; if (Math.hypot(x - spawn.x, z - spawn.z) < 520) bridges.push({ x, z }); }
    for (const b of r.buildings) if (Math.hypot(b.cx - spawn.x, b.cz - spawn.z) < 420) blds.push({ x: b.cx, z: b.cz, w: 0.5 + Math.min(b.levels, 7) * 0.12 + Math.min(1.2, b.area / 900) });
  }
  const cand: Site[] = [];
  for (const r of regs) for (const rd of r.roads) {
    if (rd.flags & (RF.bridge | RF.tunnel) || rd.cls > ROAD.unclassified) continue;
    const hw = halfWidth(rd); if (hw < 3.4) continue;
    const p = rd.pts; const n = p.length / 2; if (n < 2) continue;
    const pa = Array.from(p); let acc = 0;
    for (let k = 0; k < n - 1; k++) {
      const ax = p[k * 2], az = p[k * 2 + 1], bx = p[k * 2 + 2], bz = p[k * 2 + 3]; const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      for (let s = 6; s < L - 4; s += 14) {
        const x = ax + tx * s, z = az + tz * s; const sd = Math.hypot(x - spawn.x, z - spawn.z); if (sd > 170) continue;
        for (const sign of [1, -1]) {
          const dx = tx * sign, dz = tz * sign; const px = -dz, pz = dx;
          // straightness: the road must keep going the same way for 60 m
          let straight = 1; { const far = RoadNet.at(pa, Math.max(0, acc + s + 60 * sign)); const fx = far.x - x, fz = far.z - z; const fl = Math.hypot(fx, fz) || 1; straight = (fx * dx + fz * dz) / fl; }
          if (straight < 0.93) continue;
          let score = 0; let why = '';
          for (const b of blds) {
            const vx = b.x - x, vz = b.z - z; const along = vx * dx + vz * dz; const across = Math.abs(vx * px + vz * pz);
            if (along > 14 && along < 120 && across < along * 0.5 + 9) score += b.w;
            else if (along > -14 && along < 4 && across < 10) score -= 1.6; // a wall where the camera stands
          }
          let br = false;
          for (const q of bridges) { const vx = q.x - x, vz = q.z - z; const along = vx * dx + vz * dz; const across = Math.abs(vx * px + vz * pz); if (along > 28 && along < 230 && across < along * 0.45 + 6) { br = true; break; } }
          if (br) { score += 7; why += 'bridge '; }
          let ln = 0; for (let i = 0; i < lamps.length; i += 3) { const vx = lamps[i] - x, vz = lamps[i + 1] - z; const along = vx * dx + vz * dz; const across = Math.abs(vx * px + vz * pz); if (along > 6 && along < 100 && across < along * 0.5 + 12) ln++; }
          score += Math.min(ln, 10) * 0.55; if (ln) why += `lamps${ln} `;
          score += hw > 6 ? 2.5 : hw > 4.5 ? 1.4 : 0; score -= sd / 38;
          cand.push({ x, z, dx, dz, score, bridge: br, why });
        }
      }
      acc += L;
    }
  }
  cand.sort((a, b) => b.score - a.score);
  const out: Site[] = [];
  for (const c of cand) { if (out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 70)) out.push(c); if (out.length >= want) break; }
  if (!out.length) out.push({ x: spawn.x, z: spawn.z, dx: 0, dz: 1, score: 0, bridge: false, why: 'fallback' });
  return out;
}

/** Soft additive headlight shaft (cheap volumetric look in rain). */
function beamMesh(len: number, rad: number, col: number) {
  const g = new THREE.ConeGeometry(rad, len, 20, 1, true); g.translate(0, -len / 2, 0); g.rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uCol: { value: new THREE.Color(col) }, uInt: { value: 0.3 } },
    vertexShader: 'varying float vT; varying float vF; void main(){ vT = uv.y; vec3 n = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vF = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uCol; uniform float uInt; varying float vT; varying float vF; void main(){ float a = pow(vF, 1.6) * pow(vT, 1.8) * uInt; gl_FragColor = vec4(uCol * a, a); }',
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 5; return mesh;
}
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

interface Saved { hour: number; target: any; locked: boolean; cur: any; wet: number; water: number; bloom: number; fov: number; pos: { x: number; z: number }; layers: number }

export class LobbyStage {
  group = new THREE.Group();
  sites: Site[] = []; site!: Site; siteIndex = 0;
  hero: HumanView | null = null; heroId: RosterId = 'survivor';
  mode: StageMode = 'lobby'; active = false;
  cars: { m: CarModel; beams: THREE.Object3D[]; glow: THREE.Object3D[] }[] = [];
  extras: HumanView[] = [];
  /** screen layout requested by the UI: shift of the hero in fractions of the visible width / height, and the bust framing blend */
  layout = { shiftX: 0, shiftY: 0, bust: 0, fyMax: 0.66 };
  private cur = { shiftX: 0, shiftY: 0, bust: 0 };
  private t = 0; spin = 0; private spinVel = 0; dragging = false;
  private plinth = new THREE.Group(); private ringMat!: THREE.MeshBasicMaterial; private ring2!: THREE.Mesh; private pulse = 0; private pop = 0;
  private lights: THREE.Light[] = []; private key!: THREE.SpotLight; private rimA!: THREE.SpotLight; private rimB!: THREE.SpotLight;
  private saved: Saved | null = null;
  private emoteT = 0; private emote: string | null = null;
  private actionsOf = new WeakMap<HumanView, THREE.AnimationAction>();
  private builtFor = -1;
  /** a free camera for debugging and key art: world-independent local coordinates */
  freeCam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;
  ready = false;

  constructor(public view: LifeView, public sim: LifeSim, public assets: HumanAssets, public store: RegionStore, public spawn: { x: number; z: number }) {
    this.group.name = 'lobbyStage'; this.group.visible = false;
    this.buildPlinth();
  }

  private buildPlinth() {
    const top = 0.1; const g = this.plinth;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.4, top, 56), new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.22, metalness: 0.75 }));
    base.position.y = top / 2; base.receiveShadow = true; g.add(base);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.18, 0.012, 56), new THREE.MeshStandardMaterial({ color: 0x151826, roughness: 0.35, metalness: 0.6 }));
    deck.position.y = top + 0.004; g.add(deck);
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.18, 1.5, 1.3), toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.29, 72).rotateX(-Math.PI / 2), this.ringMat); ring.position.y = top + 0.012; g.add(ring);
    this.ring2 = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.53, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.3, 1.6), toneMapped: false, transparent: true, opacity: 0.8 }));
    this.ring2.position.y = 0.02; g.add(this.ring2);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 5.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(0.1, 0.8, 0.75), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.position.y = 0.025; g.add(glow);
    // a few tick marks around the rim, like a gacha podium
    const tickM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.4, 1.5), toneMapped: false });
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; const t = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, i % 6 === 0 ? 0.16 : 0.07), tickM); t.position.set(Math.sin(a) * 1.34, top + 0.012, Math.cos(a) * 1.34); t.rotation.y = a; g.add(t); }
    this.group.add(g);
  }

  /** Pick the street and build cars, lights and the crew. Cheap enough to call once after boot. */
  async build() {
    const lamps = this.view.world.lamps;
    this.sites = pickSites(this.store, lamps, this.spawn, 3);
    this.siteIndex = 0; this.site = this.sites[0];
    this.place(this.site);
    // lights: key, teal rim, purple rim. Cars get their own headlight look from emissives and beams.
    const q = this.view.quality;
    this.key = new THREE.SpotLight(0xffe2c4, 34, 16, 0.42, 0.85, 1.4); this.key.position.set(2.6, 3.6, 4.2); this.key.target.position.set(0, 1.0, 0);
    this.rimA = new THREE.SpotLight(0x2de0c8, 70, 14, 0.55, 0.8, 1.3); this.rimA.position.set(-2.8, 2.6, -2.8); this.rimA.target.position.set(0, 1.1, 0);
    this.rimB = new THREE.SpotLight(0x8b5cf6, 80, 14, 0.55, 0.8, 1.3); this.rimB.position.set(3.0, 2.4, -2.6); this.rimB.target.position.set(0, 1.1, 0);
    this.lights = q === 'low' ? [this.key, this.rimA] : [this.key, this.rimA, this.rimB];
    for (const l of this.lights) { this.group.add(l, (l as THREE.SpotLight).target); }
    this.ready = true;
  }

  /** Rebuild the dressing for the current site (cars behind, crew for key art). */
  async dress(mode: StageMode, shot = 0) {
    for (const c of this.cars) { c.m.root.removeFromParent(); for (const b of c.beams) b.removeFromParent(); for (const g of c.glow) g.removeFromParent(); }
    this.cars = []; for (const e of this.extras) e.dispose(); this.extras = [];
    const add = async (kind: VehicleKind, seed: number, x: number, z: number, yaw: number, paint?: number) => {
      const m = await buildCar(kind, seed);
      m.root.updateMatrixWorld(true);
      // sit on the road: lowest point of the model on y = 0
      m.root.position.set(0, 0, 0); m.root.rotation.set(0, 0, 0); poseCar(m, [0, 0, 0, 0], 0, [0, 0, 0, 0]); m.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m.root); m.root.position.set(x, -box.min.y, z); m.root.rotation.y = yaw;
      if (paint !== undefined) m.body.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh && !Array.isArray(me.material) && (me.material as THREE.MeshStandardMaterial).name === 'paint') (me.material as THREE.MeshStandardMaterial).color.setHex(paint); });
      for (const h of m.headlights) h.emissiveIntensity = 9;
      for (const b of m.brake) b.emissiveIntensity = 0.4;
      this.group.add(m.root);
      const size = box.getSize(V3()); const fw = V3(Math.sin(yaw), 0, Math.cos(yaw)); const rt = V3(Math.cos(yaw), 0, -Math.sin(yaw));
      const beams: THREE.Object3D[] = [], glow: THREE.Object3D[] = [];
      const hy = Math.min(0.78, size.y * 0.36);
      for (const s of [-1, 1]) {
        const p = V3(x, hy, z).addScaledVector(fw, size.z / 2 - 0.1).addScaledVector(rt, s * size.x * 0.3);
        const bm = beamMesh(11, 1.7, 0xfff0d0); bm.position.copy(p); bm.rotation.y = yaw; bm.rotateX(0.045); this.group.add(bm); beams.push(bm);
        const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1.6, 1.45, 1.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); gl.scale.setScalar(1.5); gl.position.copy(p).addScaledVector(fw, 0.12); this.group.add(gl); glow.push(gl);
      }
      this.cars.push({ m, beams, glow }); return m;
    };
    this.mode = mode;
    if (mode === 'keyart') {
      const D = Math.PI;
      if (shot === 0) { await add('jeep', 0, -4.6, -5.2, D - 0.55, 0x101216); await add('sedan', 1, 4.8, -4.2, D + 0.5, 0x1b2f4f); await add('danfo', 0, 0.3, -12.5, D + 0.12); await add('hatch', 0, -7.5, -11, D - 0.2, 0x6e0f12); }
      else if (shot === 1) { await add('danfo', 0, -3.3, -3.8, D - 0.62); await add('sedan', 0, 5.2, -7.5, D + 0.32, 0xb8b9bb); await add('jeep', 1, -1.0, -14, D + 0.05, 0x0d0d0f); }
      else { await add('sedan', 2, -3.8, -4.2, D - 0.7, 0x24402a); await add('jeep', 0, 4.1, -5.6, D + 0.5, 0x0d0d0f); await add('danfo', 0, 1.2, -16, D, undefined); }
    } else {
      await add('danfo', 0, -4.4, -5.6, Math.PI - 0.5);
      await add('sedan', 0, 4.6, -7.4, Math.PI + 0.38, 0x1b2f4f);
      if (this.view.quality !== 'low') await add('jeep', 0, -0.6, -14.5, Math.PI + 0.06, 0x0d0d0f);
    }
  }

  /** Move the stage to another of the candidate streets. */
  useSite(i: number) {
    const s = this.sites[Math.max(0, Math.min(this.sites.length - 1, i))]; this.siteIndex = this.sites.indexOf(s); this.place(s);
    if (this.active) { const me = this.sim.local; me.pos = { x: s.x, y: 0.05, z: s.z }; me.body.setTranslation({ x: s.x, y: 1, z: s.z }, true); }
  }
  /** Put the stage on a street: origin on the road centre, local -z along the camera's look direction. */
  place(s: Site) {
    this.site = s; this.group.position.set(s.x, 0, s.z); this.group.rotation.y = Math.atan2(-s.dx, -s.dz);
    this.group.updateMatrixWorld(true);
  }
  localToWorld(v: THREE.Vector3) { return this.group.localToWorld(v.clone()); }

  // ---------------------------------------------------------------- hero
  setHero(look: CharacterLook, opts: { pop?: boolean } = {}) {
    const old = this.hero; const id = (look.model as RosterId) ?? 'survivor';
    if (old) old.dispose();
    const v = new HumanView(this.assets, look, 0); v.root.position.set(0, 0.1, 0); v.root.rotation.y = this.spin;
    this.group.add(v.root); this.hero = v; this.heroId = id; this.emote = null; this.emoteT = 4 + Math.random() * 3;
    v.mixer.update(0.016);
    if (opts.pop) { this.pop = 1; this.pulse = 1; }
  }
  /** Fade into another loop (dance, fold arms ...). Idle_Loop is the home pose. */
  playClip(name: string | null) {
    const v = this.hero; if (!v) return;
    const set = this.assets.models.get(this.heroId); const clip = set?.clips.get(name ?? 'Idle_Loop'); if (!clip) return;
    const next = v.mixer.clipAction(clip); const prev = this.actionsOf.get(v);
    if (prev === next) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.35).play();
    if (prev) prev.fadeOut(0.35); else v.mixer.clipAction(set!.clips.get('Idle_Loop')!).fadeOut(0.35);
    this.actionsOf.set(v, next); this.emote = name;
  }
  nextEmote() { const i = this.emote ? EMOTES.indexOf(this.emote) : -1; this.playClip(EMOTES[(i + 1) % EMOTES.length]); this.emoteT = 8; }
  /** the crew for key art, each person with their own pose */
  async crew(list: { look: CharacterLook; x: number; z: number; yaw: number; clip: string; scale?: number }[]) {
    for (const e of this.extras) e.dispose(); this.extras = [];
    for (const c of list) {
      const v = new HumanView(this.assets, c.look, 0); v.root.position.set(c.x, 0, c.z); v.root.rotation.y = c.yaw; if (c.scale) v.root.scale.setScalar(c.scale);
      const set = this.assets.models.get((c.look.model as RosterId) ?? 'survivor'); const clip = set?.clips.get(c.clip);
      if (clip) { v.mixer.clipAction(set!.clips.get('Idle_Loop')!).fadeOut(0); const a = v.mixer.clipAction(clip); a.reset().play(); a.time = Math.random() * clip.duration; }
      v.mixer.update(0.016); this.group.add(v.root); this.extras.push(v);
    }
  }

  /** Crew key art for the loading screen: the roster posed in front of the cars, camera fixed. */
  async keyart(i: number, base: CharacterLook) {
    const me = this.sim.local; const site = this.sites[Math.min(i, this.sites.length - 1)]; this.place(site);
    me.pos = { x: site.x, y: 0.05, z: site.z }; me.body.setTranslation({ x: site.x, y: 1, z: site.z }, true);
    await this.dress('keyart', i);
    this.hero?.dispose(); this.hero = null; this.plinth.visible = false;
    const L = (model: RosterId, outfit: string, skin = 1) => lookFor({ name: '', model, skin, outfit }, base);
    const tunde = L('survivor', 'oshodi-night', 1), amaka = L('girl', 'ankara-sun', 2), zainab = L('farah', 'lagoon', 1), shadow = L('rogue', 'street', 3), tac = L('trooper', 'street');
    const FA = 'Idle_FoldArms_Loop', ID = 'Idle_Loop', PH = 'Idle_TalkingPhone_Loop', TK = 'Idle_Talking_Loop';
    if (i === 0) {
      await this.crew([{ look: zainab, x: -2.7, z: -0.3, yaw: 0.4, clip: FA }, { look: tunde, x: -0.9, z: 0.7, yaw: 0.12, clip: FA }, { look: amaka, x: 0.95, z: 0.5, yaw: -0.15, clip: PH }, { look: shadow, x: 2.7, z: -0.2, yaw: -0.45, clip: ID }, { look: tac, x: 0.1, z: -1.9, yaw: 0, clip: ID }]);
      this.freeCam = { pos: V3(-0.2, 0.85, 7.2), look: V3(0.1, 1.25, -3), fov: 31 };
    } else if (i === 1) {
      await this.crew([{ look: tunde, x: 0, z: 0.5, yaw: -0.1, clip: FA }, { look: amaka, x: -1.55, z: -0.3, yaw: 0.35, clip: TK }, { look: shadow, x: 1.65, z: -0.6, yaw: -0.4, clip: ID }]);
      this.freeCam = { pos: V3(1.3, 0.8, 5.2), look: V3(-0.2, 1.2, -1.5), fov: 29 };
    } else {
      await this.crew([{ look: amaka, x: 1.0, z: 0.4, yaw: -0.3, clip: PH }, { look: zainab, x: 2.2, z: -0.4, yaw: -0.5, clip: FA }, { look: tac, x: -2.4, z: -3.2, yaw: 0.5, clip: ID }]);
      this.freeCam = { pos: V3(-1.0, 0.6, 4.2), look: V3(0.7, 1.25, -3), fov: 36 };
    }
    this.lockHour = 21.2;
  }

  // ---------------------------------------------------------------- enter / leave
  /** Take over the scene: dusk or night over the street, wet roads, the player parked on the stage (hidden). */
  async enter(mode: StageMode, opts: { hour?: number; weather?: 'rain' | 'clear'; shot?: number } = {}) {
    if (this.active) return;
    const v = this.view, a = v.atmo; const me = this.sim.local;
    this.saved = { hour: a.hour, target: a.target, locked: a.lockedWeather, cur: { ...a.cur, tint: [...a.cur.tint] }, wet: a.wet, water: a.water, bloom: v.bloom.intensity, fov: v.camera.fov, pos: { x: me.pos.x, z: me.pos.z }, layers: 0 };
    this.active = true; this.mode = mode;
    if (mode === 'keyart') this.place(this.sites[Math.min(opts.shot ?? 0, this.sites.length - 1)]);
    this.plinth.visible = mode !== 'keyart';
    await this.dress(mode, opts.shot ?? 0);
    v.scene.add(this.group); this.group.visible = true;
    // the sim player stands on the stage so streaming, lamps and shadows follow the stage; hidden from the camera
    me.pos = { x: this.site.x, y: 0.05, z: this.site.z }; me.body.setTranslation({ x: this.site.x, y: 1, z: this.site.z }, true);
    this.sky(opts.hour ?? 20.6, opts.weather ?? 'rain');
    v.bloom.intensity = mode === 'keyart' ? 1.15 : 0.95;
  }
  private sky(hour: number, weather: 'rain' | 'clear') {
    const a = this.view.atmo; a.hour = hour; this.lockHour = hour;
    a.setWeather(weather === 'rain' ? 'rain' : 'clear', true);
    const W = WEATHER[weather === 'rain' ? 'rain' : 'clear'];
    Object.assign(a.cur, W, { tint: [...W.tint] as [number, number, number], name: weather === 'rain' ? 'rain' : 'clear' });
    if (weather === 'rain') { a.wet = 1; a.water = 0.7; } else { a.wet = 0.6; a.water = 0.35; }
    a.envT = 99;
  }
  lockHour = 20.6;

  leave() {
    if (!this.active) return; this.active = false;
    const v = this.view, a = v.atmo, s = this.saved!, me = this.sim.local;
    this.group.removeFromParent(); this.group.visible = false;
    for (const c of this.cars) { c.m.root.removeFromParent(); }
    a.hour = s.hour; a.target = s.target; a.lockedWeather = s.locked; Object.assign(a.cur, s.cur); a.wet = s.wet; a.water = s.water; a.envT = 99;
    v.bloom.intensity = s.bloom; v.camera.fov = s.fov; v.camera.updateProjectionMatrix();
    me.pos = { x: s.pos.x, y: 0.05, z: s.pos.z }; me.body.setTranslation({ x: s.pos.x, y: 1, z: s.pos.z }, true);
    this.showPlayer(true);
    for (const e of this.extras) e.dispose(); this.extras = [];
    this.hero?.dispose(); this.hero = null;
  }

  /** the sim's own copy of the player would stand inside the stage: put it on a hidden layer */
  showPlayer(on: boolean) {
    const av = this.view.actors.get(this.sim.local.id); if (!av) return;
    av.view.root.traverse((o) => { if (on) o.layers.set(0); else o.layers.set(6); });
  }

  // ---------------------------------------------------------------- per frame
  private shiftHist = 0;
  update(dt: number) {
    if (!this.active) return;
    this.t += dt; const cam = this.view.camera;
    this.view.atmo.hour = this.lockHour; // the lobby holds its hour
    this.showPlayer(false);
    // hero spin: drag adds, release eases home
    if (!this.dragging) { this.spinVel *= Math.exp(-3 * dt); this.spin += this.spinVel * dt; this.spin -= this.spin * Math.min(1, dt * 1.4); }
    if (this.hero) {
      this.pop = Math.max(0, this.pop - dt * 2.6); const sc = 1 - 0.05 * this.pop * this.pop;
      this.hero.root.scale.setScalar(sc); this.hero.root.rotation.y = this.spin;
      this.hero.mixer.update(dt);
    }
    for (const e of this.extras) e.mixer.update(dt);
    // auto emote every so often
    if (this.mode === 'lobby' && this.hero) { this.emoteT -= dt; if (this.emoteT < 0 && !this.dragging) { this.emote ? this.playClip(null) : this.playClip(['Idle_FoldArms_Loop', 'Idle_TalkingPhone_Loop'][(Math.random() * 2) | 0]); this.emoteT = this.emote ? 7 + Math.random() * 4 : 10 + Math.random() * 6; } }
    // plinth life
    this.pulse = Math.max(0, this.pulse - dt * 1.8);
    const k = 0.5 + 0.5 * Math.sin(this.t * 1.6);
    this.ringMat.color.setRGB(0.18 + this.pulse * 1.4, 1.2 + k * 0.5 + this.pulse * 1.5, 1.1 + k * 0.5 + this.pulse * 1.0);
    this.ring2.rotation.y = this.t * 0.25; this.ring2.scale.setScalar(1 + this.pulse * 0.25);
    for (const c of this.cars) for (const b of c.beams) (b as THREE.Mesh).material && (((b as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uInt.value = 0.3 + 0.04 * Math.sin(this.t * 3 + c.m.root.position.x));
    this.key.intensity = 34 + this.pulse * 90;
    // camera
    const e = Math.min(1, dt * 4.5);
    this.cur.shiftX = ease(this.cur.shiftX, this.layout.shiftX, e); this.cur.shiftY = ease(this.cur.shiftY, this.layout.shiftY, e); this.cur.bust = ease(this.cur.bust, this.layout.bust, e);
    if (this.freeCam) {
      cam.position.copy(this.localToWorld(this.freeCam.pos)); cam.lookAt(this.localToWorld(this.freeCam.look)); if (Math.abs(cam.fov - this.freeCam.fov) > 0.01) { cam.fov = this.freeCam.fov; cam.updateProjectionMatrix(); }
      return;
    }
    const aspect = Math.max(0.3, window.innerWidth / window.innerHeight);
    const b = this.cur.bust;
    const H = ease(1.95, 1.05, b), cy = ease(0.98, 1.3, b), d = ease(5.4, 3.3, b), Wreq = ease(1.9, 1.15, b);
    const fy = Math.min(this.layout.fyMax, (H * aspect) / Wreq);
    let fov = THREE.MathUtils.radToDeg(2 * Math.atan(H / (2 * d * fy)));
    const visH = 2 * d * Math.tan(THREE.MathUtils.degToRad(fov) / 2), visW = visH * aspect;
    const az = 0.2 + Math.sin(this.t * 0.4) * 0.11, dd = d + Math.sin(this.t * 0.21) * 0.16;
    const pivot = V3(0, cy, 0); const right = V3(Math.cos(az), 0, -Math.sin(az));
    const posL = pivot.clone().add(V3(Math.sin(az) * dd, -0.28 * (1 - b) - 0.05 + Math.sin(this.t * 0.33) * 0.05, Math.cos(az) * dd));
    const look = pivot.clone().addScaledVector(right, -this.cur.shiftX * visW).add(V3(0, -this.cur.shiftY * visH + 0.1, 0));
    cam.position.copy(this.localToWorld(posL)); cam.lookAt(this.localToWorld(look));
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  dragBy(dx: number) { this.spin += dx * 0.011; this.spinVel = dx * 0.011 * 60; }
  /** keep the real player visible again and drop everything */
  dispose() { this.leave(); }
}
