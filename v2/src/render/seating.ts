// Turns a seat table entry into world space targets for one sitter, from the vehicle's physics transform
// (the actor loop runs before the car models are posed, so the model's own matrices are one frame old).
import * as THREE from 'three';
import { seatsFor, type Seat } from '../data/seats';
import type { CarModel } from './cars';
import type { SeatTarget } from './humans';

const q = new THREE.Quaternion(), f = new THREE.Vector3(), tmp = new THREE.Vector3();

export function seatDef(m: CarModel, seat: number): Seat | undefined { return seatsFor(m.key, m.kind)?.seats[seat]; }

function toWorld(out: THREE.Vector3, p: [number, number, number], m: CarModel, bp: { x: number; y: number; z: number }) {
  return out.set(p[0], m.groundY + p[1], p[2]).applyQuaternion(q).add(tmp.set(bp.x, bp.y, bp.z));
}

export function seatTarget(m: CarModel, seat: number, bp: { x: number; y: number; z: number }, br: { x: number; y: number; z: number; w: number }, out?: SeatTarget): SeatTarget | null {
  const d = seatDef(m, seat); if (!d) return null;
  q.set(br.x, br.y, br.z, br.w);
  const t: SeatTarget = out ?? { pose: d.pose, hip: new THREE.Vector3(), yaw: 0, roof: 0, lean: 0, hands: null, feet: null };
  t.pose = d.pose; t.lean = d.lean;
  toWorld(t.hip, d.hip, m, bp);
  f.set(0, 0, 1).applyQuaternion(q); t.yaw = Math.atan2(f.x, f.z);
  t.roof = bp.y + m.groundY + d.roof;
  if (d.hands) { if (!t.hands) t.hands = [new THREE.Vector3(), new THREE.Vector3()]; toWorld(t.hands[0], d.hands[0], m, bp); toWorld(t.hands[1], d.hands[1], m, bp); } else t.hands = null;
  if (d.feet) { if (!t.feet) t.feet = [new THREE.Vector3(), new THREE.Vector3()]; toWorld(t.feet[0], d.feet[0], m, bp); toWorld(t.feet[1], d.feet[1], m, bp); } else t.feet = null;
  return t;
}

/** Eye point for the cockpit camera: above the sitter's pelvis, clamped under the roof. */
export function seatEye(m: CarModel, seat: number, bp: { x: number; y: number; z: number }, br: { x: number; y: number; z: number; w: number }, out: THREE.Vector3) {
  const d = seatDef(m, seat); if (!d) return null;
  q.set(br.x, br.y, br.z, br.w);
  const y = Math.min(d.hip[1] + 0.66, d.roof - 0.1);
  return toWorld(out, [d.hip[0], y, d.hip[2] + 0.08], m, bp);
}
