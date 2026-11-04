// Smooth motion between physics steps. The sim steps at a fixed 60 Hz; screens run at 60, 90, 120 or 144 Hz and frames
// never land exactly on a step. Drawing the raw latest step makes cars, people and the camera move in jerks (two frames
// still, one frame jump) even at a high frame rate. So we keep the pose from before the last step and draw the blend
// `alpha` of the way from it to the current one (alpha = time banked towards the next step). One step (16 ms) of delay,
// no jerks. Big jumps (teleports, respawns) snap instead of sliding.
import * as THREE from 'three';

type Pose = { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number };
type Body = { translation(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number } };
const prevV = new WeakMap<object, Pose>();
const prevA = new WeakMap<object, { x: number; y: number; z: number }>();
const prevW = new WeakMap<object, { spin: number[]; len: number[] }>();
const base = new WeakMap<object, number[]>();
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();

export const interp = {
  /** 0..1 of the way from the previous step to the current one */
  alpha: 1,
  /** call right before each sim step: remembers where everything was */
  beforeStep(sim: { vehicles: { body: Body; wheelSpin?: number[]; ctrl?: any }[]; actors: { pos: { x: number; y: number; z: number } }[] }) {
    for (const v of sim.vehicles) {
      if (!v?.body) continue; const t = v.body.translation(), r = v.body.rotation();
      let p = prevV.get(v); if (!p) { p = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }; prevV.set(v, p); }
      p.x = t.x; p.y = t.y; p.z = t.z; p.qx = r.x; p.qy = r.y; p.qz = r.z; p.qw = r.w;
      if (v.wheelSpin && v.ctrl) { let w = prevW.get(v); if (!w) { w = { spin: [0, 0, 0, 0], len: [0, 0, 0, 0] }; prevW.set(v, w); } for (let i = 0; i < 4; i++) { w.spin[i] = v.wheelSpin[i] ?? 0; w.len[i] = v.ctrl.wheelSuspensionLength?.(i) ?? 0; } }
    }
    for (const a of sim.actors) { let p = prevA.get(a); if (!p) { p = { x: 0, y: 0, z: 0 }; prevA.set(a, p); } p.x = a.pos.x; p.y = a.pos.y; p.z = a.pos.z; }
  },
  /** where to draw a vehicle body this frame */
  vehicle(v: { body: Body }, outP: THREE.Vector3, outQ?: THREE.Quaternion) {
    const t = v.body.translation(); const p = prevV.get(v); const k = this.alpha;
    if (!p || k >= 1 || (t.x - p.x) ** 2 + (t.z - p.z) ** 2 > 36) { outP.set(t.x, t.y, t.z); if (outQ) { const r = v.body.rotation(); outQ.set(r.x, r.y, r.z, r.w); } return outP; }
    outP.set(p.x + (t.x - p.x) * k, p.y + (t.y - p.y) * k, p.z + (t.z - p.z) * k);
    if (outQ) { const r = v.body.rotation(); qa.set(p.qx, p.qy, p.qz, p.qw); qb.set(r.x, r.y, r.z, r.w); outQ.slerpQuaternions(qa, qb, k); }
    return outP;
  },
  /** wheel spin and how far each wheel moves up from where it rests on the model (suspension), smooth between steps */
  wheels(v: { wheelSpin: number[]; ctrl: any }, spin: number[], lift: number[]) {
    const w = prevW.get(v); const k = Math.min(1, this.alpha);
    let b = base.get(v); if (!b) { b = [-1, -1, -1, -1]; base.set(v, b); }
    for (let i = 0; i < 4; i++) {
      const s1 = v.wheelSpin[i] ?? 0, l1 = v.ctrl.wheelSuspensionLength?.(i) ?? 0;
      const s0 = w ? w.spin[i] : s1, l0 = w ? w.len[i] : l1;
      spin[i] = Math.abs(s1 - s0) > 3 ? s1 : s0 + (s1 - s0) * k; const len = l0 + (l1 - l0) * k;
      // the model's wheel sits where the suspension rests; learn that length, then move the wheel by the difference
      const touching = v.ctrl.wheelIsInContact?.(i) ?? true;
      if (b[i] < 0) { if (touching) b[i] = len; else { lift[i] = 0; continue; } } else if (touching) b[i] += (len - b[i]) * 0.004;
      lift[i] = Math.max(-0.22, Math.min(0.22, b[i] - len));
    }
  },
  /** where to draw a person this frame */
  actor(a: { pos: { x: number; y: number; z: number } }, out: THREE.Vector3) {
    const t = a.pos; const p = prevA.get(a); const k = this.alpha;
    if (!p || k >= 1 || (t.x - p.x) ** 2 + (t.z - p.z) ** 2 > 36) return out.set(t.x, t.y, t.z);
    return out.set(p.x + (t.x - p.x) * k, p.y + (t.y - p.y) * k, p.z + (t.z - p.z) * k);
  },
};
