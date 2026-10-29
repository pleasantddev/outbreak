// Mirrors the LifeSim into the scene: streamed Lagos, sky and weather, people, cars with opening doors, effects.
import * as THREE from 'three';
import { N8AOPostPass } from 'n8ao';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, Effect } from 'postprocessing';
import { Atmosphere, type WeatherName } from './sky';
import { LEVELS, type Level } from './quality';
import { Fx } from './fx';
import { HumanAssets, HumanView, officePerson, type CharState } from './humans';
import { buildCar, poseCar, type CarModel } from './cars';
import { seatTarget } from './seating';
import { buildWeapon } from './weapons3d';
import { ThirdPersonCamera } from './camera';
import { WorldStreamer, type Tile } from '../world/streamer';
import { RegionStore } from '../world/region';
import type { TexSet } from '../world/texsets';
import type { LifeSim } from '../sim/life';
import type { Actor, Loot, SimEvent } from '../sim/types';
import { WEAPONS, VEHICLES, type WeaponId } from '../data/balance';
import { audio } from '../audio/audio';
import { RoadNet } from '../world/roadnet';
const RoadNetAt = RoadNet.at;
function pointInPolyArr(x: number, z: number, p: ArrayLike<number>) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }

const gradeFrag = /* glsl */ `
uniform float uExposure; uniform float uWarm; uniform float uSat; uniform float uHurt; uniform float uTime;
float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * uExposure;
  c = 0.18 * pow(max(c, vec3(0.0)) / 0.18, vec3(1.12)); // filmic contrast around mid grey
  c *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), uWarm);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  vec2 q = uv - 0.5; float edge = length(q * vec2(1.2, 1.0));
  c = mix(c, vec3(0.35, 0.0, 0.0) * (0.6 + 0.4 * l), smoothstep(0.8 - uHurt * 0.45, 1.1, edge) * uHurt);
  outputColor = vec4(c, inputColor.a);
}`;
class Grade extends Effect {
  constructor() { super('Grade', gradeFrag, { uniforms: new Map<string, THREE.Uniform>([['uExposure', new THREE.Uniform(1)], ['uWarm', new THREE.Uniform(0.4)], ['uSat', new THREE.Uniform(1.08)], ['uHurt', new THREE.Uniform(0)], ['uTime', new THREE.Uniform(0)]]) }); }
  set(n: string, v: number) { (this.uniforms.get(n) as THREE.Uniform).value = v; }
}

interface ActorVis { ref: Actor; view: HumanView; last: THREE.Vector3; moveYaw: number; fireT: number; fireEdge: boolean; reloadEdge: boolean; meleeEdge: boolean; hit: number; acc: number; skip: number; phone: THREE.Mesh | null; seat?: import('./humans').SeatTarget }

export class LifeView {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera;
  composer: EffectComposer; grade = new Grade(); bloom: BloomEffect | null = null; ao: any = null;
  private smaaPass: EffectPass | null = null; private bloomPass: EffectPass | null = null; private finalPass!: EffectPass; private renderPass!: RenderPass;
  atmo: Atmosphere; world: WorldStreamer; fx: Fx; cam: ThirdPersonCamera;
  actors = new Map<number, ActorVis>();
  cars = new Map<number, { m: CarModel | null; loading: boolean; key: string }>();
  loot = new Map<number, THREE.Object3D>();
  headlight: THREE.SpotLight; lightPool: THREE.PointLight[] = [];
  time = 0; hurt = 0; phoneBlend = 0; phoneUp = false; firstPerson = false;
  crowd: { g: THREE.Object3D; x: number; z: number }[] = []; private crowdT = 0;
  /** LANDMAP: an aerial camera over the city with every plot outlined by status */
  landmap = { on: false, x: 0, z: 0, h: 320, sel: '', builtAt: { x: 1e9, z: 1e9 }, owned: [] as string[], lines: null as THREE.LineSegments | null, fill: null as THREE.Mesh | null };
  onTile?: (t: Tile, built: boolean) => void;
  /** quality ladder state */
  level: number; L: Level; renderScale = 1; baseDpr: number;
  constructor(canvas: HTMLCanvasElement, public sim: LifeSim, public assets: HumanAssets, store: RegionStore, tg: TexSet, tw: TexSet, public quality: 'low' | 'medium' | 'high', opts: { hour?: number; weather?: WeatherName; level?: number }) {
    this.level = opts.level ?? (quality === 'high' ? 0 : quality === 'medium' ? 2 : 5); this.L = LEVELS[this.level];
    const L = this.L;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.baseDpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(this.baseDpr, L.dprCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.NoToneMapping;
    // shadow shaders are compiled in only when the starting rung has shadows; later rungs just switch the map off
    this.renderer.shadowMap.enabled = L.shadowSize > 0; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; this.renderer.shadowMap.autoUpdate = false;
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 2600);
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.renderPass = new RenderPass(this.scene, this.camera); this.composer.addPass(this.renderPass);
    this.finalPass = new EffectPass(this.camera, this.grade, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), new VignetteEffect({ offset: 0.35, darkness: 0.45 }));
    this.composer.addPass(this.finalPass);
    this.atmo = new Atmosphere(this.scene, this.renderer, this.level, opts);
    this.world = new WorldStreamer(this.renderer, store, tg, tw, quality);
    this.world.radius = L.radius;
    this.world.onTile = (t, b) => this.onTile?.(t, b);
    this.scene.add(this.world.group);
    this.fx = new Fx(this.scene, quality); this.fx.rainOn = false;
    this.cam = new ThirdPersonCamera(this.camera);
    this.headlight = new THREE.SpotLight(0xfff4d0, 0, 70, 0.55, 0.5, 1.2); this.scene.add(this.headlight, this.headlight.target);
    for (let i = 0; i < (this.level >= 4 ? 3 : this.level >= 2 ? 4 : 6); i++) { const l = new THREE.PointLight(0xffb060, 0, 34, 1.5); this.scene.add(l); this.lightPool.push(l); }
    this.applyLevel(this.level, 1);
    window.addEventListener('resize', () => this.resize()); this.resize();
  }
  /** Passes are built the first time a rung needs them, then only toggled. */
  private ensurePasses(L: Level) {
    const C = this.composer;
    if (L.ao > 0 && !this.ao) {
      const ao = new N8AOPostPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
      Object.assign(ao.configuration, { aoRadius: 2.6, distanceFalloff: 1.2, intensity: 3.2, halfRes: true, color: new THREE.Color(0x06070b), autoDetectTransparency: false, transparencyAware: false });
      (ao as any).autoDetectTransparency = false; ao.configuration.transparencyAware = false;
      C.addPass(ao, 1); this.ao = ao;
    }
    if (L.smaa && !this.smaaPass) { this.smaaPass = new EffectPass(this.camera, new SMAAEffect()); C.addPass(this.smaaPass, C.passes.indexOf(this.bloomPass ?? this.finalPass)); }
    if (L.bloom && !this.bloomPass) { this.bloom = new BloomEffect({ intensity: 0.75, luminanceThreshold: 0.85, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 }); this.bloomPass = new EffectPass(this.camera, this.bloom); C.addPass(this.bloomPass, C.passes.indexOf(this.finalPass)); }
  }
  /** Moves the whole renderer and its population caps to a rung of the ladder (live, no reload). */
  applyLevel(level: number, scale = this.renderScale) {
    this.level = level; const L = this.L = LEVELS[level];
    this.ensurePasses(L);
    if (this.ao) {
      this.ao.enabled = L.ao > 0;
      if (L.ao > 0) { this.ao.setQualityMode(L.ao === 3 ? 'Medium' : L.ao === 2 ? 'Low' : 'Performance'); this.ao.configuration.halfRes = L.ao < 3; }
    }
    if (this.smaaPass) this.smaaPass.enabled = L.smaa;
    if (this.bloomPass) this.bloomPass.enabled = L.bloom;
    this.atmo.applyLevel(level);
    this.world.radius = L.radius;
    const sim = this.sim as any; sim.maxPeds = L.peds; sim.maxTraffic = L.traffic; sim.maxParked = L.parked;
    this.setRenderScale(scale);
  }
  /** Dynamic resolution: pixel ratio = min(device ratio, rung cap) x scale. Rate limited by the governor. */
  setRenderScale(scale: number) {
    this.renderScale = scale;
    const pr = Math.max(0.35, Math.min(this.baseDpr, this.L.dprCap) * scale);
    if (Math.abs(pr - this.renderer.getPixelRatio()) > 0.004) { this.renderer.setPixelRatio(pr); this.resize(); }
  }
  resize() { const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h, false); this.composer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  private actorVis(a: Actor): ActorVis {
    let v = this.actors.get(a.id);
    if (v && v.ref !== a) { v.view.dispose(); this.actors.delete(a.id); v = undefined; }
    if (v) return v;
    const view = new HumanView(this.assets, a.look, a.id * 7.3);
    this.scene.add(view.root);
    v = { ref: a, view, last: new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z), moveYaw: a.yaw, fireT: 0, fireEdge: false, reloadEdge: false, meleeEdge: false, hit: 0, acc: 0, skip: 0, phone: null };
    view.root.position.set(a.pos.x, a.pos.y, a.pos.z);
    this.actors.set(a.id, v);
    return v;
  }

  handleEvents(events: SimEvent[], hud: { event: (e: SimEvent) => void }) {
    const me = this.sim.local; const camP = this.camera.position;
    for (const e of events) {
      switch (e.t) {
        case 'shot': {
          const v = this.actors.get(e.actor); if (v) { v.fireEdge = true; v.fireT = 0.7; }
          const near = Math.hypot(e.from.x - camP.x, e.from.z - camP.z) < 220;
          let muzzle: THREE.Vector3 | null = null; if (v?.view.weapon?.root.visible) muzzle = v.view.weapon.muzzle.getWorldPosition(new THREE.Vector3());
          if (near) this.fx.shot(e.from, e.to, muzzle, e.suppressed, e.hit, e.normal);
          audio.gunshot(e.weapon, e.from, e.suppressed, e.actor === me.id);
          if (e.hit !== 'none' && near && e.hit !== 'flesh') audio.impact(e.hit, e.to);
          if (e.actor === me.id) this.cam.addRecoil(WEAPONS[e.weapon].recoil * (me.aiming ? 0.6 : 1));
          break;
        }
        case 'hit': this.fx.bloodBurst(new THREE.Vector3(e.at.x, e.at.y, e.at.z), new THREE.Vector3(0, 0.3, 0), e.dmg > 40 ? 2 : 1, true); { const v = this.actors.get(e.target); if (v) v.hit = 0.2; } if (e.by === me.id) audio.hitmarker(e.head); break;
        case 'explosion': this.fx.explosion(e.at, e.radius); audio.explosion(e.at); this.cam.addShake(Math.max(0, 1.2 - Math.hypot(e.at.x - camP.x, e.at.z - camP.z) / 40)); break;
        case 'step': if (Math.hypot(e.at.x - camP.x, e.at.z - camP.z) < 30) audio.step(e.surface, e.at, e.loud, e.actor === me.id); break;
        case 'vehicleHit': audio.impact('metal', e.at); break;
        case 'reload': { const v = this.actors.get(e.actor); if (v) v.reloadEdge = true; if (e.actor === me.id) audio.ui('reload'); break; }
        case 'melee': { const v = this.actors.get(e.actor); if (v) { v.meleeEdge = true; v.fireT = 0.5; } break; }
        case 'hurt': if (e.actor === me.id) { this.hurt = Math.min(1, this.hurt + e.dmg / 40); this.cam.addShake(Math.min(0.5, e.dmg / 50)); } break;
        case 'pothole': if (Math.hypot(e.at.x - camP.x, e.at.z - camP.z) < 60) { audio.impact('metal', e.at); if (this.sim.vehicles[e.vehicle]?.seats[0] === me.id) this.cam.addShake(0.35 * e.strength); if (e.wet > 0.3) for (let i = 0; i < 8; i++) this.fx.smoke.emit({ pos: new THREE.Vector3(e.at.x, 0.2, e.at.z), vel: new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3), life: 0.7, max: 0.7, size: 0.4, color: new THREE.Color(0.35, 0.3, 0.24), drag: 1.5 }); } break;
        case 'announce': audio.announce(e.tone as any); break;
      }
      hud.event(e);
    }
  }

  /** Test hook: pins the camera (and an optional clip plane for cutaway shots) regardless of the game camera. */
  debugCam: { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov?: number } | null = null;
  /** Compiles every shader the first minutes of play need, off the main thread where the browser allows it, so cars and crowds do not stall the first frames they appear in. */
  async precompile() {
    const added: THREE.Object3D[] = [];
    for (const k of ['sedan', 'hatch', 'jeep', 'police', 'danfo', 'keke', 'okada'] as const) {
      try { const m = await buildCar(k, 0); m.root.position.set(0, -400, 0); this.scene.add(m.root); added.push(m.root); } catch { /* a missing model only costs a later compile */ }
    }
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch { /* older drivers: shaders compile on first use */ }
    for (const o of added) this.scene.remove(o);
  }
  private tmpP = new THREE.Vector3(); private tmpD = new THREE.Vector3();
  private fr = new THREE.Frustum(); private frM = new THREE.Matrix4(); private frS = new THREE.Sphere(); private frInv = new THREE.Matrix4();
  private sphereInView(x: number, y: number, z: number, r: number) { this.frS.center.set(x, y, z); this.frS.radius = r; return this.fr.intersectsSphere(this.frS); }
  frame(dt: number) {
    this.time += dt;
    const sim = this.sim, me = sim.local; const cam = this.camera;
    if (this.debugCam) { const d = this.debugCam; cam.position.set(d.x, d.y, d.z); cam.lookAt(d.tx, d.ty, d.tz); if (d.fov && cam.fov !== d.fov) { cam.fov = d.fov; cam.updateProjectionMatrix(); } cam.updateMatrixWorld(); }
    cam.updateMatrixWorld(); this.frM.multiplyMatrices(cam.projectionMatrix, this.frInv.copy(cam.matrixWorld).invert()); this.fr.setFromProjectionMatrix(this.frM);
    const L = this.landmap;
    const focus0 = me.vehicle !== null ? (() => { const t = sim.vehicles[me.vehicle!].body.translation(); return new THREE.Vector3(t.x, t.y, t.z); })() : new THREE.Vector3(me.pos.x, me.pos.y, me.pos.z);
    const focus = L.on ? new THREE.Vector3(L.x, 0, L.z) : focus0;
    this.world.update(focus.x, focus.z);
    if (L.on) this.landmapFrame();
    const env = this.atmo.update(dt, focus, cam);
    if (L.on) { const fg = this.scene.fog as THREE.FogExp2 | null; if (fg && 'density' in fg) fg.density = Math.min(fg.density, 0.00035); this.atmo.rain.visible = false; }
    (sim as any).wet = this.atmo.wet; (sim as any).water = this.atmo.water;
    this.fx.update(dt, cam.position, { active: false, pos: { x: 0, y: -999, z: 0 }, carried: false } as any, { cx: 0, cz: 0, r: 99999, active: false } as any, [], this.time);

    this.updateCrowd(dt, focus);
    // people
    const seen = new Set<number>();
    for (const a of sim.actors) {
      if ((a as any)._gone) continue;
      seen.add(a.id);
      const d = Math.hypot(a.pos.x - cam.position.x, a.pos.z - cam.position.z);
      if (d > 150) { const v = this.actors.get(a.id); if (v) v.view.root.visible = false; continue; }
      const v = this.actorVis(a);
      const self = a.id === me.id;
      // off-screen people are not drawn or animated (skinned meshes are never frustum culled by three), unless close enough to cast a visible shadow
      const inView = self || d < 14 || this.sphereInView(a.pos.x, a.pos.y + 0.9, a.pos.z, 1.6);
      v.view.root.visible = inView && !(self && this.firstPerson && a.vehicle !== null);
      if (!self) v.view.setLod(d > (v.view.lodOn ? 18 : 24));
      const p = this.tmpP.set(a.pos.x, a.pos.y, a.pos.z); const dp = this.tmpD.copy(p).sub(v.last);
      const sp = Math.hypot(dp.x, dp.z) / Math.max(dt, 1e-3);
      if (Math.hypot(dp.x, dp.z) > 0.002) v.moveYaw = Math.atan2(dp.x, dp.z);
      v.last.copy(p);
      v.view.root.position.lerp(p, Math.min(1, dt * 30)); if (a.vehicle !== null) v.view.root.position.copy(p);
      if (!inView) { v.fireEdge = v.reloadEdge = v.meleeEdge = false; v.hit = Math.max(0, v.hit - dt); v.acc += dt; continue; }
      const w = sim.currentWeapon(a);
      const wid: WeaponId | null = w && w.id !== 'fists' ? w.id : null;
      v.view.setWeapon(wid, w ? { skin: w.skin } : undefined);
      v.fireT = Math.max(0, v.fireT - dt);
      const st: CharState = {
        anim: a.alive ? (a.ko! > 0 ? 'dead' : a.anim) : 'dead', speed: a.vehicle !== null ? 0 : sp, moveYaw: v.moveYaw, aimYaw: a.yaw, pitch: a.pitch,
        aiming: a.aiming || v.fireT > 0, armed: !!wid && wid !== 'machete', weapon: wid, firing: v.fireEdge || v.meleeEdge, reloading: v.reloadEdge,
        melee: !wid || wid === 'machete', dead: !a.alive || a.ko! > 0, driving: a.vehicle !== null, shadow: 0, awaken: 0, hit: v.hit, cast: false, healing: a.healT > 0,
      };
      v.fireEdge = v.reloadEdge = v.meleeEdge = false; v.hit = Math.max(0, v.hit - dt);
      const em = (a as any).emote as { clip: string; until: number } | undefined; // multiplayer emotes (systems/net.ts)
      if (em) { if (performance.now() < em.until && sp < 0.3 && a.vehicle === null && a.alive) { st.anim = 'emote'; st.clip = em.clip; st.armed = false; } else (a as any).emote = undefined; }
      if (a.vehicle !== null) {
        const veh = sim.vehicles[a.vehicle]; const r = veh.body.rotation(); const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)); st.aimYaw = Math.atan2(fw.x, fw.z);
        const cm = this.cars.get(veh.id)?.m; if (cm) { const t = seatTarget(cm, a.seat, veh.body.translation(), r, v.seat); if (t) { v.seat = t; st.seat = t; } }
      } else v.seat = undefined;
      // far people animate at a reduced rate (time is accumulated, so speed is unchanged); seated ones stay in step with their car
      v.acc += dt; const every = self || a.vehicle !== null ? 1 : d < 28 ? 1 : d < 55 ? 2 : d < 95 ? 4 : 8;
      if (++v.skip >= every || st.firing || st.reloading || v.acc > 0.25) { v.view.update(v.acc, st, this.time); v.acc = 0; v.skip = 0; }
      if (a.id === me.id) this.posePhone(v, dt);
    }
    for (const [id, v] of this.actors) if (!seen.has(id) || (sim.actors[id] as any)?._gone) { v.view.dispose(); this.actors.delete(id); }

    // vehicles
    let hl = false; const night = env.night;
    const live = new Set<number>();
    for (const veh of sim.vehicles) {
      if (!veh || (veh as any).gone) continue;
      live.add(veh.id);
      const key = `${veh.kind}:${(veh as any).seed}`;
      let c = this.cars.get(veh.id);
      if (c && c.key !== key) { c.m?.root.removeFromParent(); this.cars.delete(veh.id); c = undefined; }
      if (!c) { c = { m: null, loading: true, key }; this.cars.set(veh.id, c); const cc = c; buildCar(veh.kind, (veh as any).seed).then((m) => { if (this.cars.get(veh.id) !== cc) return; cc.m = m; cc.loading = false; this.scene.add(m.root); }); }
      if (!c.m) continue;
      const m = c.m; const p = veh.body.translation(), r = veh.body.rotation();
      m.root.position.set(p.x, p.y, p.z); m.root.quaternion.set(r.x, r.y, r.z, r.w);
      poseCar(m, veh.wheelSpin, veh.wheelSteer, (veh as any).doors);
      const driven = veh.seats[0] !== null && !veh.destroyed;
      for (const h of m.headlights) h.emissiveIntensity = driven ? (night > 0.3 ? 8 : 0.6) : 0;
      for (const b of m.brake) b.emissiveIntensity = driven ? (veh.throttle < 0 || (sim.actors[veh.seats[0]!]?.cmd.jump) ? 6 : night > 0.3 ? 2 : 0.2) : 0;
      const siren = (m.root as any).siren; if (siren && sim.wanted > 0) { const f = Math.sin(this.time * 14) > 0; siren[0].emissiveIntensity = f ? 8 : 0; siren[1].emissiveIntensity = f ? 0 : 8; }
      if (veh.destroyed && !(m as any)._burnt) { (m as any)._burnt = true; m.body.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { const mt = (mesh.material as THREE.MeshStandardMaterial).clone(); mt.color?.multiplyScalar(0.12); mt.map = null; mesh.material = mt; } }); }
      const dist = Math.hypot(p.x - cam.position.x, p.z - cam.position.z);
      if ((veh.engine <= 0 || veh.bodyHp <= 0 || veh.destroyed) && dist < 120 && Math.random() < dt * 20) { const sp = m.smoke.clone().applyQuaternion(m.root.quaternion).add(m.root.position); this.fx.smoke.emit({ pos: sp, vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.5 + Math.random(), (Math.random() - 0.5) * 0.6), life: 3, max: 3, size: 1.4, color: new THREE.Color(0.05, 0.05, 0.05), drag: 0.6 }); }
      const ek = veh.kind === 'keke' || veh.kind === 'okada' ? 'okada' : veh.kind === 'danfo' ? 'danfo' : 'suv';
      if (driven && dist < 70) audio.engine(veh.id, { x: p.x, y: p.y, z: p.z }, Math.min(1, Math.abs(veh.ctrl.currentVehicleSpeed()) / VEHICLES[veh.kind].topSpeed + Math.abs(veh.throttle) * 0.2), ek as any);
      else audio.engine(veh.id, null, 0, ek as any);
      if (veh.horn && Math.random() < dt * 2.5 && dist < 80) audio.horn({ x: p.x, y: p.y, z: p.z });
      if (me.vehicle === veh.id && driven && night > 0.25) {
        hl = true; const fw = new THREE.Vector3(0, -0.12, 1).applyQuaternion(m.root.quaternion);
        this.headlight.position.set(p.x, p.y + 0.6, p.z).addScaledVector(fw, VEHICLES[veh.kind].size[2] / 2);
        this.headlight.target.position.copy(this.headlight.position).addScaledVector(fw, 20); this.headlight.intensity = 160;
      }
    }
    if (!hl) this.headlight.intensity = 0;
    for (const [id, c] of this.cars) if (!live.has(id)) { c.m?.root.removeFromParent(); audio.engine(id, null, 0, 'suv'); this.cars.delete(id); }

    // street lights near the player at night
    if (night > 0.2) {
      const L = this.world.lamps; const spots: { x: number; z: number; r: number; d: number }[] = [];
      for (let i = 0; i < L.length; i += 3) { const d = (L[i] - focus.x) ** 2 + (L[i + 1] - focus.z) ** 2; if (d < 120 * 120) spots.push({ x: L[i], z: L[i + 1], r: L[i + 2], d }); }
      spots.sort((a, b) => a.d - b.d);
      this.lightPool.forEach((l, i) => { const s = spots[i]; if (!s) { l.intensity = 0; return; } l.position.set(s.x + Math.sin(s.r) * 1.9, 8.6, s.z + Math.cos(s.r) * 1.9); l.intensity = 220 * night; });
    } else this.lightPool.forEach((l) => (l.intensity = 0));

    // cash and guns on the ground
    const seenL = new Set<number>();
    for (const l of sim.loot) {
      if (l.taken) continue; const d = Math.hypot(l.pos.x - cam.position.x, l.pos.z - cam.position.z); if (d > 60) continue;
      seenL.add(l.id); let o = this.loot.get(l.id);
      if (!o) { o = this.lootMesh(l); this.scene.add(o); this.loot.set(l.id, o); }
      o.position.set(l.pos.x, l.pos.y + 0.08 + Math.sin(this.time * 2 + l.bob) * 0.03, l.pos.z); o.rotation.y += dt * 0.8;
    }
    for (const [id, o] of this.loot) if (!seenL.has(id)) { o.removeFromParent(); this.loot.delete(id); }

    this.hurt = Math.max(0, this.hurt - dt * 0.8);
    this.grade.set('uHurt', this.hurt); this.grade.set('uExposure', 1.0 + env.night * 0.9); this.grade.set('uWarm', env.golden * 0.6 + 0.15); this.grade.set('uSat', 1.14 - this.atmo.cur.haze * 0.15);
    this.composer.render(dt);
  }

  openLandmap(x: number, z: number, owned: string[]) { const L = this.landmap; L.on = true; L.x = x; L.z = z; L.h = 320; L.owned = owned; L.builtAt = { x: 1e9, z: 1e9 }; }
  closeLandmap() { const L = this.landmap; L.on = false; L.lines?.removeFromParent(); L.fill?.removeFromParent(); L.lines = null; L.fill = null; L.sel = ''; }
  private landmapFrame() {
    const L = this.landmap, cam = this.camera;
    cam.position.set(L.x, L.h, L.z + L.h * 0.62); cam.lookAt(L.x, 0, L.z); cam.updateMatrixWorld();
    if (Math.hypot(L.x - L.builtAt.x, L.z - L.builtAt.z) < 120 && L.lines) return;
    L.builtAt = { x: L.x, z: L.z }; L.lines?.removeFromParent();
    const pos: number[] = [], col: number[] = []; const owned = new Set(L.owned);
    const C = { own: new THREE.Color('#8b5cf6'), vac: new THREE.Color('#49e08a'), unf: new THREE.Color('#f59e0b'), built: new THREE.Color('#9ba3b4'), sold: new THREE.Color('#ef4444') };
    const taken = (L as any).taken as ((id: string) => boolean) | undefined; // plots other players bought (multiplayer)
    for (const list of this.world.plots.values()) for (const p of list) {
      if (Math.hypot(p.cx - L.x, p.cz - L.z) > 900) continue;
      const c = owned.has(p.id) ? C.own : taken?.(p.id) ? C.sold : p.zone === 'vacant' ? C.vac : p.zone === 'unfinished' ? C.unf : C.built;
      const n = p.pts.length / 2;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; pos.push(p.pts[i * 2], 1.2, p.pts[i * 2 + 1], p.pts[j * 2], 1.2, p.pts[j * 2 + 1]); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    L.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }));
    L.lines.renderOrder = 10; this.scene.add(L.lines);
  }
  /** Plot under a screen point while the LANDMAP is open. */
  landmapPick(nx: number, ny: number) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const t = -ray.ray.origin.y / ray.ray.direction.y; if (!(t > 0)) return null;
    const P = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    for (const list of this.world.plots.values()) for (const p of list) {
      if (Math.abs(p.cx - P.x) > 60 || Math.abs(p.cz - P.z) > 60) continue;
      if (pointInPolyArr(P.x, P.z, p.pts)) return p;
    }
    return null;
  }
  landmapSelect(pts: number[] | null) {
    const L = this.landmap; L.fill?.removeFromParent(); L.fill = null; if (!pts) return;
    const n = pts.length / 2; const pos: number[] = [];
    for (let i = 1; i < n - 1; i++) pos.push(pts[0], 1.3, pts[1], pts[i * 2], 1.3, pts[i * 2 + 1], pts[i * 2 + 2], 1.3, pts[i * 2 + 3]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    L.fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2de0c8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthTest: false, toneMapped: false }));
    L.fill.renderOrder = 11; this.scene.add(L.fill);
  }

  /** Standing crowds on the kerbs: photo-scanned people waiting at bus stops and shop fronts. */
  private updateCrowd(dt: number, focus: THREE.Vector3) {
    if (!this.assets.office.length) return;
    this.crowdT -= dt; if (this.crowdT > 0) return; this.crowdT = 0.8;
    const max = this.quality === 'high' ? 16 : this.quality === 'medium' ? 10 : 5;
    this.crowd = this.crowd.filter((c) => { const keep = Math.hypot(c.x - focus.x, c.z - focus.z) < 150; if (!keep) c.g.removeFromParent(); return keep; });
    const net = this.sim.net; let tries = 0;
    while (this.crowd.length < max && tries++ < 6) {
      const ws = net.nearWalks(focus.x + (Math.random() - 0.5) * 200, focus.z + (Math.random() - 0.5) * 200, 30);
      if (!ws.length) continue;
      const w = net.walks[ws[(Math.random() * ws.length) | 0]];
      const at = RoadNetAt(w.pts, Math.random() * w.len);
      const d = Math.hypot(at.x - focus.x, at.z - focus.z);
      if (d < 35 || d > 130 || this.crowd.some((c) => Math.hypot(c.x - at.x, c.z - at.z) < 6)) continue;
      const g = officePerson(this.assets, (Math.random() * 99) | 0);
      g.position.set(at.x, 0.02, at.z); g.rotation.y = at.yaw + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (Math.random() - 0.5) * 0.6;
      this.scene.add(g); this.crowd.push({ g, x: at.x, z: at.z });
    }
  }

  /** GTA style: the phone is in the hand, raised in front of the face, and you keep walking. */
  private posePhone(v: ActorVis, dt: number) {
    this.phoneBlend += ((this.phoneUp && v.ref.vehicle === null ? 1 : 0) - this.phoneBlend) * Math.min(1, dt * 8);
    const b = v.view.bones;
    if (!v.phone) {
      const ph = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.155, 0.009), new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.3, metalness: 0.5, emissive: new THREE.Color(0x7aa0ff), emissiveIntensity: 0 }));
      const hand = b.get('hand_r'); if (hand) { hand.add(ph); ph.position.set(-0.06, 0.04, 0.02); ph.rotation.set(0, Math.PI / 2, 0); }
      v.phone = ph;
    }
    v.phone.visible = this.phoneBlend > 0.05;
    (v.phone.material as THREE.MeshStandardMaterial).emissiveIntensity = this.phoneBlend * 1.2;
    if (this.phoneBlend < 0.01) return;
    const root = v.view.root; const q = root.getWorldQuaternion(new THREE.Quaternion());
    const aim = (name: string, dir: THREE.Vector3, k: number) => {
      const bone = b.get(name); if (!bone) return;
      bone.updateWorldMatrix(true, false);
      const qw = bone.getWorldQuaternion(new THREE.Quaternion());
      const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(qw).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().applyQuaternion(q).normalize());
      const target = delta.multiply(qw); const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      bone.quaternion.slerp(pq.multiply(target), k); bone.updateWorldMatrix(false, true);
    };
    const k = this.phoneBlend;
    aim('upperarm_r', new THREE.Vector3(-0.15, -1, 0.3), k);
    aim('lowerarm_r', new THREE.Vector3(0.45, 0.6, 1), k);
    aim('hand_r', new THREE.Vector3(0.3, 0.8, 0.7), k);
    aim('Head', new THREE.Vector3(0.05, 1, 0.45), k * 0.6);
  }

  private lootMesh(l: Loot): THREE.Object3D {
    const g = new THREE.Group(); const it = l.item;
    if (it.kind === 'weapon' && it.id !== 'fists') { const w = buildWeapon(it.id, { skin: it.skin }); w.root.rotation.z = Math.PI / 2; w.root.position.y = 0.06; g.add(w.root); }
    else {
      const cash = new THREE.MeshStandardMaterial({ color: 0x6b8f5a, roughness: 0.85 }), band = new THREE.MeshStandardMaterial({ color: 0xc9b37a, roughness: 0.6 });
      for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.07), cash); m.position.set(0, 0.01 + i * 0.022, 0); m.rotation.y = i * 0.3; g.add(m); }
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.075), band); b.position.y = 0.035; g.add(b);
    }
    return g;
  }
}
