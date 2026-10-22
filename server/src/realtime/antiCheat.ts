// Sanity checks on what a client says about itself. Movement is simulated on the client (the physics needs the streamed
// Lagos collision), so the server's job is to bound what is believable: speed over time, teleports, map bounds, vehicle
// attached to the driver. A "credit" bucket in metres lets lag spikes through but caps the average speed.
import { F, VKINDS, VKIND_TOP, type StateMsg } from '../../../v2/src/net/protocol.ts';

export const FOOT_MAX = 10.5; // m/s: sprint is 6.8 with archetype and slope slack
export const FALL_MAX = 75; // m/s vertical
export const CREDIT_SECONDS = 6; // burst allowance: this many seconds of top speed can arrive at once
export const VEH_SLACK = 1.45;
export const MAX_TP = 9000; // metres: the longest hop a sanctioned teleport (respawn at a hospital, a mission) may make

export interface MoveState {
  x: number; y: number; z: number; at: number; // last accepted position and server time (ms)
  credit: number; strikes: number; strikeAt: number; tpUntil: number; fixUntil: number; lastTp: number;
}
export const newMoveState = (x: number, y: number, z: number, now: number): MoveState => ({ x, y, z, at: now, credit: FOOT_MAX * CREDIT_SECONDS, strikes: 0, strikeAt: now, tpUntil: 0, fixUntil: 0, lastTp: 0 });

export type Verdict = { ok: true } | { ok: false; reason: string; hard: boolean };

export function vmaxFor(m: StateMsg): number {
  if (m.veh) { const k = VKINDS[m.veh.kind]; return (VKIND_TOP[k] ?? 40) * VEH_SLACK + 3; }
  return FOOT_MAX;
}

/** Judge a report against the last accepted state. Mutates credit only when the report is believable. */
export function judgeMove(s: MoveState, m: StateMsg, now: number, bounds: [number, number, number, number]): Verdict {
  if (![m.x, m.y, m.z].every(Number.isFinite)) return { ok: false, reason: 'nan', hard: true };
  if (m.x < bounds[0] || m.x > bounds[2] || m.z < bounds[1] || m.z > bounds[3]) return { ok: false, reason: 'bounds', hard: true };
  if (m.y < -60 || m.y > 600) return { ok: false, reason: 'height', hard: true };
  if (m.veh) {
    const v = m.veh;
    if (![v.x, v.y, v.z, v.qx, v.qy, v.qz, v.qw].every(Number.isFinite)) return { ok: false, reason: 'nan', hard: true };
    if (Math.hypot(v.x - m.x, v.z - m.z) > 8) return { ok: false, reason: 'vehicle-detached', hard: false };
  }
  const dt = Math.max(0.01, Math.min(5, (now - s.at) / 1000));
  const dist = Math.hypot(m.x - s.x, m.z - s.z);
  const vmax = vmaxFor(m);
  s.credit = Math.min(vmax * CREDIT_SECONDS, s.credit + vmax * dt);
  if (now < s.tpUntil) { // a granted teleport or respawn: one jump, then the normal rules resume
    if (dist > s.credit + 1.5) { if (dist > MAX_TP) return { ok: false, reason: 'teleport', hard: true }; s.tpUntil = 0; s.credit = 0; return { ok: true }; }
  }
  if (dist > s.credit + 1.5) return { ok: false, reason: dist > 250 ? 'teleport' : 'speed', hard: dist > 250 };
  const dy = Math.abs(m.y - s.y) / dt;
  if (dy > FALL_MAX && Math.abs(m.y - s.y) > 12) return { ok: false, reason: 'vertical', hard: false };
  s.credit = Math.max(0, s.credit - dist);
  return { ok: true };
}

/** Strikes decay by one every 10 s; returns true when the account has earned a kick. */
export function strike(s: MoveState, now: number, weight = 1, limit = 10): boolean {
  s.strikes = Math.max(0, s.strikes - Math.floor((now - s.strikeAt) / 10000));
  s.strikeAt = now; s.strikes += weight;
  return s.strikes >= limit;
}

export function accept(s: MoveState, m: StateMsg, now: number) { s.x = m.x; s.y = m.y; s.z = m.z; s.at = now; }

export const alive = (flags: number) => (flags & F.ALIVE) !== 0;
