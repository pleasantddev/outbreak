// Mirrors the authoritative sim into the scene every frame. Reads sim state; never writes it.
import * as THREE from 'three';
import { Engine, type Quality } from './engine';
import { WorldView } from './worldView';
import { Fx } from './fx';
import { CharacterAssets, CharacterView, bakeCorpse, type CharState } from './characters';
import { buildVehicleModel, type VehicleModel } from './vehicles3d';
import { buildWeapon } from './weapons3d';
import { ThirdPersonCamera } from './camera';
import type { Sim } from '../sim/sim';
import type { Actor, Loot, SimEvent } from '../sim/types';
import { WEAPONS, VEHICLES, ABILITIES, type WeaponId } from '../data/balance';
import { OPERATORS, type Armory } from '../data/cosmetics';
import { audio } from '../audio/audio';

interface ActorVis { view: CharacterView; last: THREE.Vector3; moveYaw: number; fireT: number; fireEdge: boolean; reloadEdge: boolean; castEdge: boolean; meleeEdge: boolean; hit: number; cone: THREE.Mesh; heat: THREE.Mesh }
interface CreatureVis { view: CharacterView }

const lootMats = {
  ammo: new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.7 }), stripe: new THREE.MeshStandardMaterial({ color: 0xc9a030, roughness: 0.5 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe0dcd0, roughness: 0.8 }), red: new THREE.MeshStandardMaterial({ color: 0xa01a14, roughness: 0.6 }),
  cash: new THREE.MeshStandardMaterial({ color: 0x5a6a3a, roughness: 0.85 }), tape: new THREE.MeshStandardMaterial({ color: 0xc8b890, roughness: 0.6 }),
  vest: new THREE.MeshStandardMaterial({ color: 0x23281e, roughness: 0.85 }), metal: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.4, metalness: 0.8 }),
};
const rarityColor = { common: 0x9a9a9a, rare: 0x3a8aff, epic: 0xb04aff, mythic: 0xff1a1a } as const;

export class GameView {
  engine: Engine; world: WorldView; fx: Fx; cam: ThirdPersonCamera; assets: CharacterAssets; sim: Sim;
  actors = new Map<number, ActorVis>();
  creatures = new Map<number, CreatureVis>();
  vehicles = new Map<number, VehicleModel>();
  loot = new Map<number, THREE.Object3D>();
  flashlight: THREE.SpotLight;
  bounce: THREE.PointLight;
  headlight: THREE.SpotLight;
  private time = 0;
  private heartFlash = 0;
  hurt = 0;
  private lastHeartPulse = -99;
  private footprints: { m: THREE.Mesh; life: number }[] = [];
  private coneGeo = new THREE.ConeGeometry(2.6, 14, 20, 1, true).translate(0, -7, 0).rotateX(-Math.PI / 2);
  private coneMat = new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private heatMat = new THREE.MeshBasicMaterial({ color: 0xff2010, transparent: true, opacity: 0.55, depthTest: false, blending: THREE.AdditiveBlending });
  armory: Armory;
  gore = true;
  onHit?: (head: boolean, kill: boolean) => void;

  constructor(canvas: HTMLCanvasElement, sim: Sim, assets: CharacterAssets, quality: Quality, armory: Armory) {
    this.sim = sim; this.assets = assets; this.armory = armory;
    this.engine = new Engine(canvas, quality);
    this.world = new WorldView(sim.city, this.engine.scene, this.engine.renderer, quality);
    this.fx = new Fx(this.engine.scene, quality);
    this.cam = new ThirdPersonCamera(this.engine.camera);
    this.flashlight = new THREE.SpotLight(0xfff0dc, 55, 48, 0.44, 0.6, 1.7);
    this.flashlight.castShadow = quality !== 'low';
    this.flashlight.shadow.mapSize.set(quality === 'high' ? 1024 : 512, quality === 'high' ? 1024 : 512);
    this.flashlight.shadow.bias = -0.0005; this.flashlight.shadow.camera.near = 0.3;
    this.engine.scene.add(this.flashlight, this.flashlight.target);
    // a soft bounce around the player: what a flashlight spill does in a real room
    this.bounce = new THREE.PointLight(0xffd8b0, 2.2, 9, 1.6);
    this.engine.scene.add(this.bounce);
    this.headlight = new THREE.SpotLight(0xfff4d0, 0, 60, 0.6, 0.5, 1.2);
    this.engine.scene.add(this.headlight, this.headlight.target);
    this.buildCorpses();
  }

  private buildCorpses() {
    const list = this.sim.city.props.filter((p) => p.type === 'corpse');
    if (!list.length) return;
    const looks = [OPERATORS[0].look, OPERATORS[1].look, { ...OPERATORS[2].look, head: 'none' as const }];
    looks.forEach((look, k) => {
      const mesh = bakeCorpse(this.assets, { ...look, vest: false, backpack: false });
      if (!mesh) return;
      const mine = list.filter((_, i) => i % looks.length === k);
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, mine.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      mine.forEach((p, i) => { q.setFromAxisAngle(up, p.ry); m.compose(new THREE.Vector3(p.p[0], p.p[1], p.p[2]), q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, m); });
      im.castShadow = true; im.receiveShadow = true;
      this.engine.scene.add(im);
    });
  }

  private actorVis(a: Actor): ActorVis {
    let v = this.actors.get(a.id);
    if (v) return v;
    const view = new CharacterView(this.assets, a.look, null, a.id * 7.3);
    this.engine.scene.add(view.root);
    const cone = new THREE.Mesh(this.coneGeo, this.coneMat); cone.frustumCulled = false;
    this.engine.scene.add(cone);
    const heat = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 8), this.heatMat); heat.renderOrder = 99; heat.visible = false;
    this.engine.scene.add(heat);
    v = { view, last: new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z), moveYaw: a.yaw, fireT: 0, fireEdge: false, reloadEdge: false, castEdge: false, meleeEdge: false, hit: 0, cone, heat };
    this.actors.set(a.id, v);
    return v;
  }

  muzzleOf(id: number): THREE.Vector3 | null {
    const v = this.actors.get(id);
    if (!v?.view.weapon || !v.view.weapon.root.visible) return null;
    return v.view.weapon.muzzle.getWorldPosition(new THREE.Vector3());
  }

  handleEvents(events: SimEvent[], hud: { event: (e: SimEvent) => void }) {
    const me = this.sim.local;
    const camP = this.engine.camera.position;
    for (const e of events) {
      switch (e.t) {
        case 'shot': {
          const v = this.actors.get(e.actor);
          if (v) { v.fireEdge = true; v.fireT = 0.7; }
          const near = Math.hypot(e.from.x - camP.x, e.from.z - camP.z) < 220;
          if (near) this.fx.shot(e.from, e.to, this.muzzleOf(e.actor), e.suppressed, e.hit, e.normal);
          audio.gunshot(e.weapon, e.from, e.suppressed, e.actor === me.id);
          if (e.hit !== 'none' && near && e.hit !== 'flesh') audio.impact(e.hit, e.to);
          if (e.actor === me.id) { const w = WEAPONS[e.weapon]; this.cam.addRecoil(w.recoil * (me.aiming ? 0.6 : 1)); }
          break;
        }
        case 'hit':
          if (e.by === me.id) { audio.hitmarker(e.head); this.onHit?.(e.head, false); }
          this.fx.bloodBurst(new THREE.Vector3(e.at.x, e.at.y, e.at.z), new THREE.Vector3(0, 0.3, 0), e.dmg > 40 ? 2 : 1, this.gore);
          if (e.targetKind === 'actor') { const v = this.actors.get(e.target); if (v) v.hit = 0.2; }
          if (e.targetKind === 'creature') audio.impact('flesh', e.at);
          break;
        case 'explosion': {
          this.fx.explosion(e.at, e.radius); audio.explosion(e.at);
          const d = Math.hypot(e.at.x - camP.x, e.at.z - camP.z);
          this.cam.addShake(Math.max(0, 1.2 - d / 40));
          break;
        }
        case 'ability': {
          this.fx.abilityFx(e.ability, e.at, e.dir);
          const v = this.actors.get(e.actor); if (v) v.castEdge = true;
          if (e.actor === me.id || Math.hypot(e.at.x - camP.x, e.at.z - camP.z) < 40) audio.ui('ability');
          void ABILITIES;
          break;
        }
        case 'ping': this.fx.ping(e.at, e.kind === 'heart' ? 0xff1a1a : 0xb030ff); break;
        case 'heartPulse': audio.heartPulse(); this.heartFlash = 1; this.lastHeartPulse = this.time; break;
        case 'step': {
          const near = Math.hypot(e.at.x - camP.x, e.at.z - camP.z);
          if (near < 45) audio.step(e.surface, e.at, e.loud, e.actor === me.id);
          if (me.archetype === 'hunter' && e.actor !== me.id && near < 60) this.footprint(e.at);
          break;
        }
        case 'creatureSound': {
          const c = this.sim.creatures.find((x) => x.id === e.id);
          if (c && Math.hypot(e.at.x - camP.x, e.at.z - camP.z) < 90) audio.creature(c.kind, e.kind, e.at);
          break;
        }
        case 'vehicleHit': audio.impact('metal', e.at); break;
        case 'reload': { const v = this.actors.get(e.actor); if (v) v.reloadEdge = true; if (e.actor === me.id) audio.ui('reload'); break; }
        case 'melee': { const v = this.actors.get(e.actor); if (v) { v.meleeEdge = true; v.fireT = 0.5; } break; }
        case 'awaken': {
          const a = this.sim.actors[e.actor];
          this.fx.abilityFx('shadow', this.sim.eye(a), { x: 0, y: 1, z: 0 });
          audio.ui('awaken');
          break;
        }
        case 'hurt': if (e.actor === me.id) { this.hurt = Math.min(1, this.hurt + e.dmg / 40); this.cam.addShake(Math.min(0.5, e.dmg / 50)); } break;
        case 'announce': audio.announce(e.tone); break;
      }
      hud.event(e);
    }
  }

  private footprint(at: { x: number; y: number; z: number }) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(at.x, at.y + 0.04, at.z);
    this.engine.scene.add(m); this.footprints.push({ m, life: 10 });
  }

  frame(dt: number) {
    this.time += dt;
    const sim = this.sim, me = sim.local;
    const cam = this.engine.camera;
    const focus = new THREE.Vector3(me.pos.x, me.pos.y, me.pos.z);
    const corrupt = sim.corruption.reduce((m, c) => Math.max(m, 1 - Math.min(1, Math.max(0, Math.hypot(me.pos.x - c.x, me.pos.z - c.z) - c.r * 0.6) / (c.r * 0.6))), 0);
    this.heartFlash = Math.max(0, this.heartFlash - dt * 0.7);
    this.world.update(dt, cam.position, focus, sim.night, sim.blackout, this.heartFlash * 0.6 + (sim.heart.active ? 0.15 : 0), corrupt, this.time);
    this.fx.update(dt, cam.position, { active: sim.heart.active, pos: sim.heart.pos, carried: sim.heart.carrier !== null }, sim.zone, sim.corruption, this.time);
    this.fx.setExtractions(sim.city.extractions, sim.extractionOpen);
    this.fx.syncShields(sim.shields as any);
    this.fx.syncGrenades(sim.grenades);

    // actors
    for (const a of sim.actors) {
      const v = this.actorVis(a);
      const d = Math.hypot(a.pos.x - cam.position.x, a.pos.z - cam.position.z);
      const visible = d < 160 && !(a.won === 'contract');
      v.view.root.visible = visible;
      v.cone.visible = visible && a.alive && a.flashlight && a.vehicle === null && a.shadowT <= 0 && a.id !== me.id;
      v.heat.visible = me.awakenT > 0 && a.id !== me.id && a.alive && d < 70;
      if (v.heat.visible) v.heat.position.set(a.pos.x, a.pos.y + 0.9, a.pos.z);
      if (!visible) { v.last.set(a.pos.x, a.pos.y, a.pos.z); continue; }
      const p = new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z);
      const dp = p.clone().sub(v.last);
      const sp = Math.hypot(dp.x, dp.z) / Math.max(dt, 1e-3);
      if (Math.hypot(dp.x, dp.z) > 0.002) v.moveYaw = Math.atan2(dp.x, dp.z);
      v.last.copy(p);
      // smooth the render position a little so the 60Hz sim never judders on high refresh screens
      v.view.root.position.lerp(p, v.view.root.position.lengthSq() === 0 ? 1 : Math.min(1, dt * 30));
      if (a.vehicle !== null) v.view.root.position.copy(p);
      const w = sim.currentWeapon(a);
      const wid: WeaponId | null = a.awakenT > 0 ? null : w?.id ?? null;
      v.view.setWeapon(wid, w ? { skin: w.skin, optic: w.att.optic ?? null, muzzle: w.att.muzzle ?? null, mag: w.att.mag ?? null, grip: w.att.grip ?? null } : undefined);
      v.fireT = Math.max(0, v.fireT - dt);
      const st: CharState = {
        anim: a.alive ? a.anim : 'dead', speed: a.vehicle !== null ? 0 : sp, moveYaw: v.moveYaw, aimYaw: a.yaw, pitch: a.pitch,
        aiming: a.aiming || v.fireT > 0, armed: !!wid && wid !== 'machete', weapon: wid, firing: v.fireEdge || v.meleeEdge, reloading: v.reloadEdge,
        melee: wid === 'machete' || a.awakenT > 0 || v.meleeEdge, dead: !a.alive, driving: a.vehicle !== null, shadow: a.shadowT > 0 ? 1 : 0,
        awaken: a.awakenT > 0 ? 1 : 0, hit: v.hit, cast: v.castEdge, healing: a.healT > 0,
      };
      v.fireEdge = v.reloadEdge = v.castEdge = v.meleeEdge = false;
      v.hit = Math.max(0, v.hit - dt);
      if (a.vehicle !== null) {
        const veh = sim.vehicles[a.vehicle];
        const r = veh.body.rotation();
        const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
        st.aimYaw = a.seat > 0 && a.aiming ? a.yaw : Math.atan2(fw.x, fw.z);
      }
      v.view.update(d < 60 ? dt : dt, st, this.time);
      if (v.cone.visible) { v.cone.position.set(a.pos.x, a.pos.y + 1.35, a.pos.z); v.cone.rotation.set(-a.pitch, a.yaw, 0, 'YXZ'); }
    }

    // creatures
    const alive = new Set<number>();
    for (const c of sim.creatures) {
      alive.add(c.id);
      const d = Math.hypot(c.pos.x - cam.position.x, c.pos.z - cam.position.z);
      let cv = this.creatures.get(c.id);
      if (!cv && d < 130 && (c.alive || c.deadT < 20)) {
        const look = { ...OPERATORS[c.id % OPERATORS.length].look, topColor: ['#3e3a33', '#5b1a16', '#2a2622', '#45603b', '#355070'][c.id % 5], scars: 1, body: c.id % 3 === 0 ? 'female' as const : 'male' as const, hair: c.id % 2 ? 'buzzed' as const : 'none' as const, head: 'none' as const };
        cv = { view: new CharacterView(this.assets, look, c.kind, c.id) };
        this.engine.scene.add(cv.view.root);
        this.creatures.set(c.id, cv);
      }
      if (!cv) continue;
      cv.view.root.visible = d < 130;
      if (!cv.view.root.visible) continue;
      cv.view.root.position.set(c.pos.x, c.pos.y, c.pos.z);
      cv.view.update(dt, { anim: c.alive ? c.anim : 'dead', speed: c.speed, moveYaw: c.yaw, aimYaw: c.yaw, pitch: 0, aiming: false, armed: false, weapon: null, firing: false, reloading: false, melee: false, dead: !c.alive, driving: false, shadow: 0, awaken: 0, hit: 0, cast: false, healing: false }, this.time);
    }
    for (const [id, cv] of this.creatures) if (!alive.has(id)) { cv.view.dispose(); this.creatures.delete(id); }

    // vehicles
    let headlightSet = false;
    for (const veh of sim.vehicles) {
      let m = this.vehicles.get(veh.id);
      if (!m) { m = buildVehicleModel(veh.kind, { seed: veh.id * 13 }); this.engine.scene.add(m.root); this.vehicles.set(veh.id, m); }
      const p = veh.body.translation(), r = veh.body.rotation();
      m.root.position.set(p.x, p.y, p.z);
      m.root.quaternion.set(r.x, r.y, r.z, r.w);
      m.wheels.forEach((w, i) => { const spin = w.children[0]; if (spin) spin.rotation.x = veh.wheelSpin[i]; if (i < 2) w.rotation.y = veh.wheelSteer; });
      const driven = veh.seats[0] !== null;
      for (const h of m.headlights) (h.material as THREE.MeshStandardMaterial).emissiveIntensity = driven && !veh.destroyed ? 6 : 0.2;
      for (const b of m.brake) (b.material as THREE.MeshStandardMaterial).emissiveIntensity = driven ? (veh.throttle < 0 ? 5 : 1.2) : 0.1;
      if (veh.destroyed && !(m as any)._burnt) {
        (m as any)._burnt = true;
        m.body.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { const mat = (mesh.material as THREE.MeshStandardMaterial).clone(); mat.color?.multiplyScalar(0.15); mat.map = null; mesh.material = mat; } });
      }
      const dist = Math.hypot(p.x - cam.position.x, p.z - cam.position.z);
      if ((veh.engine <= 0 || veh.bodyHp <= 0 || veh.destroyed) && dist < 120) {
        const sp = m.smoke.clone().applyQuaternion(m.root.quaternion).add(m.root.position);
        if (Math.random() < dt * 20) this.fx.smoke.emit({ pos: sp, vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.5 + Math.random(), (Math.random() - 0.5) * 0.6), life: 3, max: 3, size: 1.4, color: new THREE.Color(0.05, 0.05, 0.05), drag: 0.6 });
        if ((veh.fireT > 0 || veh.destroyed) && Math.random() < dt * 30) this.fx.sparks.emit({ pos: sp, vel: new THREE.Vector3((Math.random() - 0.5), 2 + Math.random() * 2, (Math.random() - 0.5)), life: 0.6, max: 0.6, size: 0.4, color: new THREE.Color(1, 0.4, 0.1), drag: 1 });
      }
      // engine audio for driven vehicles nearby
      if (driven && dist < 90 && !veh.destroyed) audio.engine(veh.id, { x: p.x, y: p.y, z: p.z }, Math.min(1, Math.abs(veh.ctrl.currentVehicleSpeed()) / VEHICLES[veh.kind].topSpeed + Math.abs(veh.throttle) * 0.2), veh.kind);
      else audio.engine(veh.id, null, 0, veh.kind);
      if (veh.horn && Math.random() < dt * 2) audio.horn({ x: p.x, y: p.y, z: p.z });
      if (me.vehicle === veh.id && driven && !veh.destroyed) {
        headlightSet = true;
        const fw = new THREE.Vector3(0, -0.12, 1).applyQuaternion(m.root.quaternion);
        this.headlight.position.set(p.x, p.y + 0.8, p.z).addScaledVector(fw, VEHICLES[veh.kind].size[2] / 2);
        this.headlight.target.position.copy(this.headlight.position).addScaledVector(fw, 20);
        this.headlight.intensity = 140;
      }
    }
    if (!headlightSet) this.headlight.intensity = 0;

    // loot within reach of the camera
    const seen = new Set<number>();
    for (const l of sim.loot) {
      if (l.taken) continue;
      const d = Math.hypot(l.pos.x - cam.position.x, l.pos.z - cam.position.z);
      if (d > 70) continue;
      seen.add(l.id);
      let o = this.loot.get(l.id);
      if (!o) { o = this.lootMesh(l); this.engine.scene.add(o); this.loot.set(l.id, o); }
      o.position.set(l.pos.x, l.pos.y + 0.12 + Math.sin(this.time * 2 + l.bob) * 0.04, l.pos.z);
      o.rotation.y += dt * 0.8;
    }
    for (const [id, o] of this.loot) if (!seen.has(id)) { o.removeFromParent(); this.loot.delete(id); }

    for (const f of this.footprints) { f.life -= dt; (f.m.material as THREE.MeshBasicMaterial).opacity = f.life / 10; if (f.life <= 0) f.m.removeFromParent(); }
    this.footprints = this.footprints.filter((f) => f.life > 0);

    // the local flashlight follows the crosshair
    const fl = this.flashlight;
    fl.visible = me.alive && me.flashlight && me.vehicle === null && me.awakenT <= 0;
    if (fl.visible) {
      const right = new THREE.Vector3(-Math.cos(me.yaw), 0, Math.sin(me.yaw));
      fl.position.set(me.pos.x, me.pos.y + (me.crouch ? 1.0 : 1.4), me.pos.z).addScaledVector(right, 0.25);
      fl.target.position.copy(this.cam.aimPoint);
      fl.intensity = 55 + Math.sin(this.time * 31) * (Math.random() < 0.01 ? 30 : 0);
    }
    this.bounce.visible = fl.visible;
    if (fl.visible) this.bounce.position.copy(fl.position).lerp(this.cam.aimPoint, Math.min(0.5, 2.5 / Math.max(0.1, fl.position.distanceTo(this.cam.aimPoint))));

    // post-process grade
    this.hurt = Math.max(0, this.hurt - dt * 0.8);
    const g = this.engine.grade;
    g.set('uTime', this.time);
    g.set('uHurt', this.hurt);
    g.set('uLow', me.alive ? Math.max(0, 1 - me.hp / 35) : 0);
    g.set('uCorrupt', corrupt);
    g.set('uHeart', this.time - this.lastHeartPulse < 1.2 ? (this.time - this.lastHeartPulse) / 1.2 : 1);
    g.set('uAwake', me.awakenT > 0 ? 1 : 0);
    this.engine.chroma.offset.set(0.0006 + this.hurt * 0.004 + corrupt * 0.002, 0.0004 + this.hurt * 0.003);
    this.engine.render(dt);
  }

  private lootMesh(l: Loot): THREE.Object3D {
    const g = new THREE.Group();
    const it = l.item;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0, x = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    let rarity: keyof typeof rarityColor = 'common';
    if (it.kind === 'weapon') {
      const w = buildWeapon(it.id, { skin: it.skin, optic: it.att.optic ?? null, muzzle: it.att.muzzle ?? null, mag: it.att.mag ?? null, grip: it.att.grip ?? null });
      w.root.rotation.z = Math.PI / 2; w.root.position.y = 0.08; g.add(w.root);
      rarity = Object.keys(it.att).length >= 2 ? 'epic' : Object.keys(it.att).length ? 'rare' : 'common';
    } else if (it.kind === 'armor') {
      add(new THREE.BoxGeometry(0.4, 0.45, 0.14), lootMats.vest, 0.22);
      rarity = it.level === 3 ? 'epic' : it.level === 2 ? 'rare' : 'common';
    } else if (it.kind === 'shard') {
      const col = ABILITIES[it.ability].color;
      add(new THREE.OctahedronGeometry(0.16), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 3, roughness: 0.2 }), 0.3);
      rarity = 'epic';
    } else {
      switch (it.type) {
        case 'ammo_light': case 'ammo_heavy': case 'ammo_shells': case 'ammo_sniper':
          add(new THREE.BoxGeometry(0.28, 0.16, 0.18), lootMats.ammo, 0.08); add(new THREE.BoxGeometry(0.29, 0.03, 0.19), lootMats.stripe, 0.12); break;
        case 'bandage': add(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12), lootMats.white, 0.06); break;
        case 'medkit': add(new THREE.BoxGeometry(0.32, 0.18, 0.22), lootMats.white, 0.09); add(new THREE.BoxGeometry(0.1, 0.19, 0.03), lootMats.red, 0.09, 0, 0.11); rarity = 'rare'; break;
        case 'contraband': for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.24, 0.07, 0.12), lootMats.cash, 0.04 + i * 0.07); add(new THREE.BoxGeometry(0.06, 0.22, 0.13), lootMats.tape, 0.11); rarity = 'rare'; break;
        case 'frag': add(new THREE.SphereGeometry(0.07, 10, 8), lootMats.vest, 0.07); break;
        case 'repair': add(new THREE.BoxGeometry(0.36, 0.16, 0.16), lootMats.red, 0.08); break;
        case 'fuel': add(new THREE.BoxGeometry(0.28, 0.36, 0.14), lootMats.red, 0.18); break;
        case 'artifact': {
          add(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff1010, emissiveIntensity: 5 }), 0.35);
          const pl = new THREE.PointLight(0xff1010, 6, 6, 2); pl.position.y = 0.4; g.add(pl); rarity = 'mythic'; break;
        }
        case 'core': add(new THREE.SphereGeometry(0.18, 16, 12), new THREE.MeshStandardMaterial({ color: 0x050000, emissive: 0x8a0000, emissiveIntensity: 3, roughness: 0.1, metalness: 0.5 }), 0.3); rarity = 'mythic'; break;
      }
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: rarityColor[rarity], transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.y = 0.02; g.add(ring);
    return g;
  }

  dispose() {
    for (const [, v] of this.actors) v.view.dispose();
    for (const [, c] of this.creatures) c.view.dispose();
    this.engine.dispose();
  }
}
