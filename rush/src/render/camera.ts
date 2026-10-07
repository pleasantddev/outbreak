// Chase camera with speed FOV, drift swing, landing and impact shake, look-back, plus the pre-race fly-through
// and the victory orbit.
import * as THREE from 'three';
import type { CarState } from '../shared/car';
import { clamp, expDecay, wrapAngle } from '../shared/math';

export type CamMode = 'chase' | 'intro' | 'orbit' | 'hood' | 'free' | 'tv';

export class ChaseCam {
  mode: CamMode = 'chase';
  private yaw = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private shakeT = 0; private shakeAmp = 0;
  private fovKick = 0;
  private introT = 0; private introPts: THREE.Vector3[] = []; private introLook: THREE.Vector3[] = [];
  private orbitA = 0;
  distance = 6.4; height = 2.15; baseFov = 64; motion = true;
  far = false; // the alternative "far chase" view

  constructor(public cam: THREE.PerspectiveCamera) {}

  snapTo(c: CarState) {
    this.yaw = c.h;
    this.pos.set(c.x - Math.sin(c.h) * this.distance, c.y + this.height, c.z - Math.cos(c.h) * this.distance);
    this.look.set(c.x + Math.sin(c.h) * 4, c.y + 1, c.z + Math.cos(c.h) * 4);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
  }

  shake(amp: number, t = 0.35) { this.shakeAmp = Math.max(this.shakeAmp, amp); this.shakeT = Math.max(this.shakeT, t); }
  kick(f: number) { this.fovKick = Math.max(this.fovKick, f); }

  startIntro(points: number[][], lookAt: (s: number) => THREE.Vector3) {
    this.mode = 'intro'; this.introT = 0;
    this.introPts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.introLook = points.map((p) => lookAt(p[3] ?? 0));
  }
  get introDone() { return this.mode !== 'intro' || this.introT >= Math.max(1, this.introPts.length - 1); }

  update(dt: number, c: CarState, topSpeed: number, lookBack: boolean, boosting: boolean) {
    if (this.mode === 'intro' && this.introPts.length > 1) {
      this.introT += dt * 0.55;
      const n = this.introPts.length;
      const u = Math.min(this.introT, n - 1.001);
      const i = Math.floor(u), f = u - i;
      const P = (k: number) => this.introPts[clamp(k, 0, n - 1)], Lk = (k: number) => this.introLook[clamp(k, 0, n - 1)];
      const cr = (a: THREE.Vector3, b: THREE.Vector3, c2: THREE.Vector3, d: THREE.Vector3, t: number, out: THREE.Vector3) => {
        const t2 = t * t, t3 = t2 * t;
        out.set(0, 0, 0)
          .addScaledVector(a, -0.5 * t3 + t2 - 0.5 * t).addScaledVector(b, 1.5 * t3 - 2.5 * t2 + 1)
          .addScaledVector(c2, -1.5 * t3 + 2 * t2 + 0.5 * t).addScaledVector(d, 0.5 * t3 - 0.5 * t2);
        return out;
      };
      cr(P(i - 1), P(i), P(i + 1), P(i + 2), f, this.cam.position);
      cr(Lk(i - 1), Lk(i), Lk(i + 1), Lk(i + 2), f, this.look);
      this.cam.lookAt(this.look);
      this.cam.fov = 58; this.cam.updateProjectionMatrix();
      if (this.introT >= n - 1) { this.mode = 'chase'; this.snapTo(c); }
      return;
    }
    if (this.mode === 'orbit') {
      this.orbitA += dt * 0.35;
      const r = 7.5;
      this.cam.position.set(c.x + Math.sin(this.orbitA) * r, c.y + 2.2, c.z + Math.cos(this.orbitA) * r);
      this.cam.lookAt(c.x, c.y + 0.8, c.z);
      this.cam.fov = expDecay(this.cam.fov, 52, 2, dt); this.cam.updateProjectionMatrix();
      return;
    }
    const speed = Math.hypot(c.vx, c.vz);
    const sp = clamp(speed / topSpeed, 0, 1.3);
    // follow the direction of travel more than the nose, so drifts swing the camera out
    const travel = speed > 4 ? Math.atan2(c.vx, c.vz) : c.h;
    const target = c.drifting ? c.h + wrapAngle(travel - c.h) * 0.55 : c.h + wrapAngle(travel - c.h) * 0.3;
    this.yaw += wrapAngle(target - this.yaw) * Math.min(1, dt * (c.grounded ? 6.5 : 2.5));
    const dist = (this.far ? 9 : this.distance) + sp * 1.4;
    const height = (this.far ? 3.1 : this.height) + sp * 0.25;
    const dir = lookBack ? -1 : 1;
    const want = new THREE.Vector3(c.x - Math.sin(this.yaw) * dist * dir, c.y + height, c.z - Math.cos(this.yaw) * dist * dir);
    if (this.mode === 'hood') want.set(c.x + Math.sin(c.h) * 0.6, c.y + 1.25, c.z + Math.cos(c.h) * 0.6);
    // stiff spring laterally, softer vertically so jumps float a little
    const k = this.mode === 'hood' ? 60 : 14;
    this.pos.x = expDecay(this.pos.x, want.x, k, dt); this.pos.z = expDecay(this.pos.z, want.z, k, dt);
    this.pos.y = expDecay(this.pos.y, want.y, c.grounded ? 9 : 4, dt);
    if (this.mode === 'hood') this.pos.copy(want);
    const ahead = this.mode === 'hood' ? 20 : 3.5 + sp * 3;
    this.look.set(c.x + Math.sin(this.yaw) * ahead * dir, c.y + (this.mode === 'hood' ? 1.1 : 0.95), c.z + Math.cos(this.yaw) * ahead * dir);
    this.cam.position.copy(this.pos);
    // shake: impacts, landings, and a faint buzz at speed
    this.shakeT = Math.max(0, this.shakeT - dt);
    const amp = (this.shakeT > 0 ? this.shakeAmp * (this.shakeT / 0.35) : 0) + (this.motion ? sp * sp * 0.02 : 0);
    if (amp > 0.001) {
      const t = performance.now() / 1000;
      this.cam.position.x += Math.sin(t * 47) * amp; this.cam.position.y += Math.sin(t * 61 + 1) * amp * 0.7; this.cam.position.z += Math.sin(t * 53 + 2) * amp;
    }
    if (this.shakeT <= 0) this.shakeAmp = 0;
    this.cam.lookAt(this.look);
    if (this.mode !== 'hood') this.cam.rotateZ(clamp(-c.yawRate * 0.012, -0.05, 0.05));
    this.fovKick = Math.max(0, this.fovKick - dt * 2.5);
    const fov = this.baseFov + (this.motion ? sp * 16 : sp * 6) + (boosting ? 5 : 0) + this.fovKick * 8;
    this.cam.fov = expDecay(this.cam.fov, fov, 4, dt);
    this.cam.updateProjectionMatrix();
    this.vel.set(0, 0, 0);
  }

  orbit() { this.mode = 'orbit'; }
}
