// The lobby backdrop: your operator under a dying sodium lamp, a danfo idling in the rain.
import * as THREE from 'three';
import { Engine, type Quality } from './engine';
import { CharacterAssets, CharacterView } from './characters';
import { buildVehicleModel } from './vehicles3d';
import { buildWeapon } from './weapons3d';
import { worldMaterials, shared } from './materials';
import { Fx } from './fx';
import type { CharacterLook, WeaponLoadout } from '../data/cosmetics';
import type { WeaponId } from '../data/balance';

export type MenuShot = 'lobby' | 'operator' | 'armory';

export class MenuScene {
  engine: Engine;
  assets: CharacterAssets;
  op: CharacterView | null = null;
  lookKey = '';
  shot: MenuShot = 'lobby';
  weaponShow: THREE.Group = new THREE.Group();
  private t = 0;
  private lamp: THREE.PointLight;
  private fx: Fx;
  private spin = 0;
  private camPos = new THREE.Vector3(1.6, 1.55, 5.2);
  private camLook = new THREE.Vector3(0.2, 1.2, 0);
  private heldWeapon: { id: WeaponId | null; l?: Partial<WeaponLoadout> } = { id: 'ar' };
  running = true;
  dragYaw = 0;

  constructor(canvas: HTMLCanvasElement, assets: CharacterAssets, quality: Quality) {
    this.assets = assets;
    this.engine = new Engine(canvas, quality);
    const s = this.engine.scene;
    const mats = worldMaterials(quality);
    s.background = new THREE.Color(0x040304);
    s.fog = new THREE.FogExp2(0x0b0607, 0.07);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 1, 1).rotateX(-Math.PI / 2), mats.road);
    const uv = ground.geometry.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 6);
    ground.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(uv.count * 3).fill(1), 3));
    ground.receiveShadow = true; s.add(ground);
    const wallG = new THREE.BoxGeometry(18, 7, 0.3);
    const wuv = wallG.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * 5, wuv.getY(i) * 2);
    wallG.setAttribute('color', new THREE.Float32BufferAttribute(new Array(wuv.count * 3).fill(0.8), 3));
    const wall = new THREE.Mesh(wallG, mats.plaster); wall.position.set(0, 3.5, -3.2); wall.receiveShadow = true; s.add(wall);
    const shutterG = new THREE.PlaneGeometry(3.2, 2.6);
    shutterG.setAttribute('color', new THREE.Float32BufferAttribute(new Array(12).fill(1), 3));
    const shutter = new THREE.Mesh(shutterG, mats.shutter); shutter.position.set(-2.4, 1.3, -3.04); s.add(shutter);
    // shop sign
    const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d')!;
    g.fillStyle = '#7a1414'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#efe4cf'; g.font = '700 46px Oswald, Impact'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NO WEAPON FORMED AUTO PARTS', 256, 50);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(30,10,0,${Math.random() * 0.5})`; g.fillRect(Math.random() * 512, Math.random() * 96, Math.random() * 40, Math.random() * 8); }
    const st = new THREE.CanvasTexture(c); st.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.95), new THREE.MeshStandardMaterial({ map: st, roughness: 0.7, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 0.08 }));
    sign.position.set(-1.6, 3.4, -3.03); s.add(sign);
    const danfo = buildVehicleModel('danfo', { seed: 3 }); danfo.root.position.set(-4.2, 0.62, -0.6); danfo.root.rotation.y = 0.35; s.add(danfo.root);
    for (const h of danfo.headlights) (h.material as THREE.MeshStandardMaterial).emissiveIntensity = 4;
    const head = new THREE.SpotLight(0xfff2d0, 60, 25, 0.5, 0.5, 1.4); head.position.set(-3.4, 1.2, 1.5); head.target.position.set(0, 0.2, 6); s.add(head, head.target);
    // lamp post
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 6.5, 8), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.7 }));
    pole.position.set(2.8, 3.25, -1.8); pole.castShadow = true; s.add(pole);
    this.lamp = new THREE.PointLight(0xff9a3c, 45, 16, 1.5); this.lamp.position.set(2.0, 6, -0.8); this.lamp.castShadow = true; this.lamp.shadow.mapSize.set(1024, 1024); s.add(this.lamp);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc070 })); bulb.position.copy(this.lamp.position); s.add(bulb);
    // fire barrel rim light
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), mats.rust); barrel.position.set(3.4, 0.45, 0.8); s.add(barrel);
    const fire = new THREE.PointLight(0xff5a10, 14, 9, 1.6); fire.position.set(3.4, 1.4, 0.8); s.add(fire);
    (this as any)._fire = fire;
    const red = new THREE.PointLight(0xd4161c, 9, 14, 1.6); red.position.set(-4, 4.5, 4); s.add(red);
    // key and rim on the operator so the outfit reads against the dark
    const key = new THREE.SpotLight(0xffe2c0, 38, 12, 0.45, 0.7, 1.2); key.position.set(2.2, 3.2, 4.2); key.target.position.set(0.3, 1.1, 0); key.castShadow = true; s.add(key, key.target);
    const rim = new THREE.SpotLight(0x7a90ff, 30, 10, 0.5, 0.6, 1.2); rim.position.set(-1.8, 2.8, -2.2); rim.target.position.set(0.3, 1.2, 0); s.add(rim, rim.target);
    s.add(new THREE.HemisphereLight(0x2a3048, 0x120806, 0.4));
    this.fx = new Fx(s, quality);
    this.weaponShow.position.set(0.2, 1.35, 1.6);
    s.add(this.weaponShow);
  }

  setLook(look: CharacterLook, weapon: WeaponId | null = 'ar', l?: Partial<WeaponLoadout>) {
    const key = JSON.stringify(look);
    if (key !== this.lookKey) {
      this.op?.dispose();
      this.op = new CharacterView(this.assets, look, null, 4);
      this.op.root.position.set(0.3, 0, 0);
      this.engine.scene.add(this.op.root);
      this.lookKey = key;
      this.op.weaponKey = '';
    }
    this.heldWeapon = { id: weapon, l };
    this.op!.setWeapon(weapon, l);
  }
  showWeapon(id: WeaponId | null, l?: Partial<WeaponLoadout>) {
    this.weaponShow.clear();
    if (!id) return;
    const w = buildWeapon(id, l);
    w.root.scale.setScalar(1.6);
    w.root.rotation.y = Math.PI / 2;
    const box = new THREE.Box3().setFromObject(w.root); const c = box.getCenter(new THREE.Vector3());
    w.root.position.sub(c);
    this.weaponShow.add(w.root);
  }
  setShot(s: MenuShot) {
    this.shot = s;
    if (s === 'lobby') { this.camPos.set(1.6, 1.55, 5.2); this.camLook.set(-0.6, 1.25, 0); this.weaponShow.visible = false; }
    if (s === 'operator') { this.camPos.set(0.3, 1.2, 3.6); this.camLook.set(0.3, 1.0, 0); this.weaponShow.visible = false; }
    if (s === 'armory') { this.camPos.set(0.2, 1.5, 3.1); this.camLook.set(0.2, 1.35, 1.6); this.weaponShow.visible = true; }
  }

  frame(dt: number) {
    if (!this.running) return;
    this.t += dt;
    shared.time.value = this.t;
    const cam = this.engine.camera;
    cam.position.lerp(this.camPos, Math.min(1, dt * 3));
    const look = new THREE.Vector3().copy(this.camLook);
    cam.position.x += Math.sin(this.t * 0.3) * 0.004; cam.position.y += Math.sin(this.t * 0.47) * 0.003;
    cam.lookAt(look);
    // sodium lamp stutter
    const flick = Math.sin(this.t * 23) > 0.95 || Math.sin(this.t * 2.7) > 0.985 ? 0.1 : 1;
    this.lamp.intensity = 45 * flick;
    (this as any)._fire.intensity = 12 + Math.sin(this.t * 13) * 3 + Math.sin(this.t * 7.1) * 2;
    if (this.op) {
      this.op.root.visible = this.shot !== 'armory';
      if (this.shot === 'operator') this.op.root.rotation.y = this.dragYaw;
      this.op.update(dt, { anim: 'idle', speed: 0, moveYaw: this.op.root.rotation.y, aimYaw: this.shot === 'operator' ? this.dragYaw : 0.25, pitch: 0, aiming: false, armed: !!this.heldWeapon.id && this.heldWeapon.id !== 'machete', weapon: this.heldWeapon.id, firing: false, reloading: false, melee: false, dead: false, driving: false, shadow: 0, awaken: 0, hit: 0, cast: false, healing: false }, this.t);
    }
    this.spin += dt * 0.5;
    this.weaponShow.rotation.y = this.spin + this.dragYaw;
    this.fx.update(dt, cam.position, { active: false, pos: { x: 0, y: 0, z: 0 }, carried: false }, { active: false, cx: 0, cz: 0, r: 0 }, [], this.t);
    this.engine.grade.set('uTime', this.t);
    this.engine.render(dt);
  }
  dispose() { this.running = false; this.op?.dispose(); this.engine.dispose(); }
}
