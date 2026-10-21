// GTA-style third-person camera: free orbit, over-the-shoulder aim, collision pull-in, recoil and shake.
import * as THREE from 'three';
import type { Sim } from '../sim/sim';
import { groups, G } from '../sim/physics';
import { weaponStats } from '../sim/items';
import { VEHICLES } from '../data/balance';

export class ThirdPersonCamera {
  yaw = 0; pitch = -0.12;
  private dist = 3.6; private shoulder = 0.55; private fovCur = 70;
  private shake = 0; private kick = 0;
  pivot = new THREE.Vector3();
  aimPoint = new THREE.Vector3();
  sens = 1; invertY = false; baseFov = 70;
  constructor(public cam: THREE.PerspectiveCamera) {}

  addShake(a: number) { this.shake = Math.min(1.2, this.shake + a); }
  addRecoil(r: number) { this.kick += r; this.pitch += r * 0.65; this.yaw += (Math.random() - 0.5) * r * 0.4; }

  update(dt: number, sim: Sim, lookX: number, lookY: number, aiming: boolean) {
    const a = sim.local;
    const w = sim.currentWeapon(a);
    const st = w ? weaponStats(w) : null;
    const scoped = aiming && st && st.adsZoom < 0.5;
    const s = 0.0022 * this.sens * (aiming ? (st?.adsZoom ?? 1) * 0.9 + 0.1 : 1);
    this.yaw -= lookX * s;
    this.pitch -= lookY * s * (this.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.25, 1.1);
    this.kick *= Math.exp(-10 * dt);

    let targetDist = aiming ? (scoped ? 0.9 : 1.55) : a.sprinting ? 4.1 : 3.5;
    let targetShoulder = aiming ? 0.62 : 0.55;
    let pivotY = a.crouch ? 1.15 : 1.6;
    let base = new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z);
    if (a.vehicle !== null) {
      const v = sim.vehicles[a.vehicle];
      const p = v.body.translation();
      base = new THREE.Vector3(p.x, p.y, p.z);
      targetDist = v.kind === 'danfo' ? 8 : v.kind === 'okada' ? 4.6 : 6.8;
      targetShoulder = a.seat > 0 && aiming ? 0.6 : 0;
      pivotY = VEHICLES[v.kind].size[1] * 0.75 + 0.6;
      if (aiming) targetDist = 2.6;
    }
    if (!a.alive && a.vehicle === null) targetDist = 6;
    this.dist += (targetDist - this.dist) * Math.min(1, dt * 9);
    this.shoulder += (targetShoulder - this.shoulder) * Math.min(1, dt * 9);
    const pv = base.clone(); pv.y += pivotY;
    this.pivot.lerp(pv, this.pivot.lengthSq() === 0 ? 1 : Math.min(1, dt * 20));

    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const shoulderPt = this.pivot.clone().addScaledVector(right, -this.shoulder);
    const want = shoulderPt.clone().addScaledVector(dir, -this.dist);
    // keep the camera out of walls and ceilings
    const d = want.clone().sub(this.pivot); const len = d.length(); d.normalize();
    const hit = sim.phys.ray(this.pivot, d, len + 0.3, groups(0xffff, G.WORLD | G.VEHICLE), undefined, (c) => {
      const o = sim.ownerOf(c); return !(o?.kind === 'vehicle' && a.vehicle === o.id);
    });
    const camPos = hit ? this.pivot.clone().addScaledVector(d, Math.max(0.2, hit.t - 0.25)) : want;
    // shake
    this.shake *= Math.exp(-6 * dt);
    if (this.shake > 0.001) camPos.add(new THREE.Vector3((Math.random() - 0.5) * this.shake * 0.25, (Math.random() - 0.5) * this.shake * 0.25, (Math.random() - 0.5) * this.shake * 0.25));
    this.cam.position.copy(camPos);
    const look = camPos.clone().add(dir);
    this.cam.lookAt(look);

    const targetFov = this.baseFov * (aiming && st ? st.adsZoom : 1) + (a.sprinting ? 6 : 0);
    this.fovCur += (targetFov - this.fovCur) * Math.min(1, dt * 12);
    if (Math.abs(this.cam.fov - this.fovCur) > 0.01) { this.cam.fov = this.fovCur; this.cam.updateProjectionMatrix(); }

    // where the crosshair actually lands in the world
    const ahit = sim.phys.ray(camPos, dir, 600, undefined, a.vehicle !== null ? sim.vehicles[a.vehicle].collider : a.collider, (c) => c.handle !== a.collider.handle && !(a.vehicle !== null && sim.ownerOf(c)?.kind === 'vehicle' && sim.ownerOf(c)?.id === a.vehicle));
    this.aimPoint.copy(ahit ? new THREE.Vector3(ahit.point.x, ahit.point.y, ahit.point.z) : camPos.clone().addScaledVector(dir, 600));
    // never aim at something behind the shoulder
    const eye = sim.eye(a);
    if (this.aimPoint.distanceTo(camPos) < this.dist + 0.6) this.aimPoint.copy(camPos).addScaledVector(dir, 30);
    const ad = this.aimPoint.clone().sub(new THREE.Vector3(eye.x, eye.y, eye.z)).normalize();
    return { dir, right, aimDir: ad, scoped: !!scoped };
  }
}
