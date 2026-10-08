// Arcade car physics on the track corridor. Forgiving, readable and deterministic for a fixed timestep.
import type { CarDef } from './cars';
import type { Track, TrackHint, TrackQuery } from './track';
import { clamp, expDecay, wrapAngle } from './math';

export interface CarInput { throttle: number; brake: number; steer: number; drift: boolean; nitro: boolean; item: boolean; look: boolean; airPitch: number }
export const idleInput = (): CarInput => ({ throttle: 0, brake: 0, steer: 0, drift: false, nitro: false, item: false, look: false, airPitch: 0 });

export const PHYS = {
  g: 24,
  driftMinSpeed: 11,
  driftTiers: [0.6, 1.3, 2.15],
  driftBoost: [0, 0.5, 0.95, 1.6],
  boostBonus: 0.3,
  nitroBonus: 0.22,
  danfoBonus: 0.38,
  nitroBurn: 0.34,
  wallRestitution: 0.28,
  respawnAfter: 1.4,
  maxReverse: 12,
};

/** Slowest speed a drift can start at: 11 m/s, or half the car's top speed for the slow starters. */
export const driftMin = (def: CarDef) => Math.min(PHYS.driftMinSpeed, def.topSpeed * 0.5);

export type CarEvent =
  | { t: 'driftStart'; car: number }
  | { t: 'driftTier'; car: number; tier: number }
  | { t: 'driftBoost'; car: number; tier: number }
  | { t: 'wall'; car: number; impact: number; x: number; y: number; z: number }
  | { t: 'air'; car: number }
  | { t: 'land'; car: number; grade: 'clean' | 'sloppy' | 'crash'; tricks: number; airT: number }
  | { t: 'respawn'; car: number }
  | { t: 'spin'; car: number; reason: string };

export interface CarState {
  id: number;
  x: number; y: number; z: number; h: number;
  vx: number; vz: number; vy: number;
  yawRate: number;
  vf: number; vr: number;          // forward and lateral speed (derived each step)
  grounded: boolean; airT: number; spinAcc: number; flipAcc: number; pitch: number; roll: number; tricks: number;
  drifting: boolean; driftDir: number; driftT: number; driftTier: number;
  boostT: number; nitroOn: boolean; fuel: number;
  spinT: number; spinDir: number;
  danfoT: number; blackoutT: number; ghostT: number;
  hint: TrackHint; q: TrackQuery | null;
  lastSafeS: number; lastSafeT: number; offT: number; respawnT: number; prevSlope: number;
  wrongWayT: number; slipT: number; hop: number; stuckT: number;
  // race progress
  raceDist: number; lap: number; cp: number; lapStart: number; lastLap: number; bestLap: number; finished: boolean; finishTime: number; place: number;
  item: string | null; itemRoll: number; itemCharges: number;
  lastPos: { x: number; z: number };
}

export function newCar(id: number, x: number, y: number, z: number, h: number, track: Track): CarState {
  const q = track.query(x, y, z);
  return {
    id, x, y, z, h, vx: 0, vz: 0, vy: 0, yawRate: 0, vf: 0, vr: 0,
    grounded: true, airT: 0, spinAcc: 0, flipAcc: 0, pitch: 0, roll: 0, tricks: 0,
    drifting: false, driftDir: 0, driftT: 0, driftTier: 0,
    boostT: 0, nitroOn: false, fuel: 0.25, spinT: 0, spinDir: 1, danfoT: 0, blackoutT: 0, ghostT: 0,
    hint: { path: q.path, i: q.i }, q, lastSafeS: q.sMain, lastSafeT: 0, offT: 0, respawnT: 0, prevSlope: 0,
    wrongWayT: 0, slipT: 0, hop: 0, stuckT: 0,
    raceDist: track.gap(0, q.sMain), lap: 0, cp: 0, lapStart: 0, lastLap: 0, bestLap: 0, finished: false, finishTime: 0, place: 0,
    item: null, itemRoll: 0, itemCharges: 0, lastPos: { x, z },
  };
}

/** Advance one car by dt. Returns events for audio, VFX and the HUD. */
export function stepCar(c: CarState, inp: CarInput, def: CarDef, track: Track, dt: number, time: number, events: CarEvent[], controlEnabled = true) {
  // respawn fade: frozen until the tow truck puts us back
  if (c.respawnT > 0) {
    c.respawnT -= dt;
    if (c.respawnT <= 0.3 && c.respawnT + dt > 0.3) placeAtSafe(c, track, events);
    return;
  }
  const throttleIn = controlEnabled ? inp.throttle : 0;
  const steerIn = controlEnabled ? clamp(inp.steer, -1, 1) : 0;
  const brakeIn = controlEnabled ? inp.brake : 0;

  c.boostT = Math.max(0, c.boostT - dt);
  c.danfoT = Math.max(0, c.danfoT - dt);
  c.blackoutT = Math.max(0, c.blackoutT - dt);
  c.ghostT = Math.max(0, c.ghostT - dt);
  c.hop = Math.max(0, c.hop - dt * 6);

  const fx = Math.sin(c.h), fz = Math.cos(c.h);
  const rx = -Math.cos(c.h), rz = Math.sin(c.h);
  let vf = c.vx * fx + c.vz * fz;
  let vr = c.vx * rx + c.vz * rz;

  const boosting = c.boostT > 0 || c.danfoT > 0;
  c.nitroOn = controlEnabled && inp.nitro && c.fuel > 0.01 && c.grounded;
  if (c.nitroOn) c.fuel = Math.max(0, c.fuel - PHYS.nitroBurn * dt);
  const bonus = (c.boostT > 0 ? PHYS.boostBonus : 0) + (c.nitroOn ? PHYS.nitroBonus : 0) + (c.danfoT > 0 ? PHYS.danfoBonus : 0) + (c.slipT > 0.6 ? 0.06 : 0);
  const maxV = def.topSpeed * (1 + bonus);

  if (c.grounded) {
    if (c.spinT > 0) {
      c.spinT -= dt;
      c.yawRate = c.spinDir * 8.5 * Math.min(1, c.spinT * 2 + 0.3);
      vf *= Math.exp(-1.8 * dt);
      vr *= Math.exp(-3 * dt);
      c.drifting = false;
    } else {
      // engine and brakes
      const ratio = clamp(vf / maxV, -1, 1.5);
      if (throttleIn > 0 && vf >= -0.5) vf += def.accel * throttleIn * Math.max(0.06, 1 - Math.pow(Math.max(0, ratio), 1.7)) * dt;
      if (boosting || c.nitroOn) vf += (c.danfoT > 0 ? 16 : 13) * dt;
      if (vf > maxV) vf = expDecay(vf, maxV, 1.6, dt);
      if (brakeIn > 0) {
        if (vf > 1) vf -= 30 * brakeIn * dt;
        else vf = Math.max(-Math.min(PHYS.maxReverse, def.topSpeed * 0.35), vf - 10 * brakeIn * dt);
      } else if (throttleIn > 0 && vf < -0.5) vf += 25 * dt;
      // rolling and air drag
      const drag = (throttleIn > 0 ? 0 : 1.1) + 0.00055 * vf * vf;
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);

      // drifting
      const wantDrift = controlEnabled && inp.drift;
      if (!c.drifting && wantDrift && Math.abs(steerIn) > 0.25 && vf > driftMin(def)) {
        c.drifting = true; c.driftDir = Math.sign(steerIn); c.driftT = 0; c.driftTier = 0; c.hop = 1;
        events.push({ t: 'driftStart', car: c.id });
      }
      if (c.drifting) {
        if (!wantDrift || vf < driftMin(def) * 0.62) {
          if (c.driftTier > 0) { c.boostT = Math.max(c.boostT, PHYS.driftBoost[c.driftTier]); events.push({ t: 'driftBoost', car: c.id, tier: c.driftTier }); }
          c.drifting = false; c.driftTier = 0;
        } else {
          const into = clamp(steerIn * c.driftDir, -1, 1);
          c.driftT += dt * (0.5 + 0.65 * Math.max(0, into));
          const tier = c.driftT > PHYS.driftTiers[2] ? 3 : c.driftT > PHYS.driftTiers[1] ? 2 : c.driftT > PHYS.driftTiers[0] ? 1 : 0;
          if (tier > c.driftTier) { c.driftTier = tier; events.push({ t: 'driftTier', car: c.id, tier }); }
          c.fuel = Math.min(1, c.fuel + dt * 0.045);
        }
      }

      // steering: tight at low speed, calmer at the top end
      let sf = clamp(Math.abs(vf) / 8, 0, 1) * (1 - 0.3 * clamp(Math.abs(vf) / def.topSpeed, 0, 1));
      // almost stopped but on the pedals: enough lock to turn out of a wall or a jam instead of grinding into it
      if (Math.abs(vf) < 8 && (throttleIn > 0 || brakeIn > 0)) sf = Math.max(sf, 0.35);
      let target: number;
      if (c.drifting) target = c.driftDir * (0.78 + 0.5 * clamp(steerIn * c.driftDir, -1, 1)) * def.steer * 0.95;
      else target = steerIn * def.steer * sf * (vf >= 0 ? 1 : -1);
      if (c.danfoT > 0) target *= 0.8;
      c.yawRate = expDecay(c.yawRate, target, 14, dt);

      // lateral grip with a little momentum kept on exit
      const grip = c.drifting ? def.driftGrip : def.grip;
      const before = Math.abs(vr);
      vr *= Math.exp(-grip * dt);
      const recovered = (before - Math.abs(vr)) * (c.drifting ? 0.22 : 0.1);
      if (vf > 0) vf = Math.min(maxV * 1.02, vf + recovered);
    }
    c.h = wrapAngle(c.h - c.yawRate * dt);
  } else {
    // in the air: steer spins, pitch flips, momentum carries
    c.airT += dt;
    const spinRate = steerIn * 6.5;
    const flipRate = (controlEnabled ? inp.airPitch : 0) * 5.5;
    c.spinAcc += spinRate * dt;
    c.flipAcc += flipRate * dt;
    c.h = wrapAngle(c.h - spinRate * dt);
    c.pitch = c.flipAcc;
    c.vy -= PHYS.g * dt;
    if (c.nitroOn) vf += 6 * dt;
  }

  // rebuild world velocity in the frame we measured it in; the heading has already turned, so next step the
  // difference shows up as lateral slip that grip has to eat. That lag is what makes drifts slide.
  if (c.grounded) { c.vx = fx * vf + rx * vr; c.vz = fz * vf + rz * vr; }
  // integrate
  c.lastPos = { x: c.x, z: c.z };
  c.x += c.vx * dt; c.z += c.vz * dt;

  // where are we now?
  const q = track.query(c.x, c.y, c.z, c.hint);
  c.hint = { path: q.path, i: q.i };
  c.q = q;

  // walls: the corridor edge pushes back and bounces; railings stop low flying cars too
  const overWall = !c.grounded && c.y > q.groundY + 2.2;
  if (q.outside > 0 && !overWall) {
    const side = Math.sign(q.d) || 1;
    const nx = -q.rx * side, nz = -q.rz * side;
    c.x += nx * q.outside; c.z += nz * q.outside;
    const vn = c.vx * nx + c.vz * nz;
    if (vn < 0) {
      const impact = -vn;
      c.vx -= (1 + PHYS.wallRestitution) * vn * nx; c.vz -= (1 + PHYS.wallRestitution) * vn * nz;
      const keep = Math.max(0.55, 1 - impact * 0.025);
      c.vx *= keep; c.vz *= keep;
      // nose turns to follow the wall instead of sticking
      const tangentH = Math.atan2(q.tx, q.tz);
      const along = c.vx * q.tx + c.vz * q.tz >= 0 ? tangentH : wrapAngle(tangentH + Math.PI);
      c.h = wrapAngle(c.h + wrapAngle(along - c.h) * Math.min(1, impact * 0.04));
      if (impact > 3) events.push({ t: 'wall', car: c.id, impact, x: c.x, y: c.y, z: c.z });
      // pressing on against the wall at low speed: swing the nose along it so the car slides free
      // toward the way the race runs, and only if the car already points roughly that way
      const ahead = wrapAngle(tangentH - c.h);
      if (impact < 6 && throttleIn > 0 && Math.abs(ahead) < 1.6) c.h = wrapAngle(c.h + clamp(ahead, -1, 1) * 2.4 * dt);
      if (impact > 9 && c.drifting) { c.drifting = false; c.driftTier = 0; }
    }
  }

  // vertical: follow the road, launch off lips and crests, land tricks
  const gy = q.groundY;
  if (c.grounded) {
    const speedAlong = c.vx * q.tx + c.vz * q.tz;
    const rampInfo = q.path === 0 ? track.rampHeight(q.s, q.d) : null;
    const vCurv = (q.slope - c.prevSlope);
    const launchByRamp = rampInfo && rampInfo.lip > 0 && q.s >= rampInfo.lip - 1.5 && speedAlong > 10;
    const launchByCrest = vCurv < -0.04 && speedAlong * speedAlong * (-vCurv) / 2 > PHYS.g * 0.9 && speedAlong > 20;
    if (launchByRamp || launchByCrest) {
      c.grounded = false; c.airT = 0; c.spinAcc = 0; c.flipAcc = 0; c.tricks = 0;
      c.vy = Math.max(3, (launchByRamp ? (q.slope) : c.prevSlope) * speedAlong);
      c.y = gy + 0.05;
      c.drifting = false;
      events.push({ t: 'air', car: c.id });
    } else {
      c.y = gy;
      c.vy = q.slope * speedAlong;
    }
    c.prevSlope = q.slope;
  } else {
    c.y += c.vy * dt;
    if (c.y <= gy && c.y > gy - 3) {
      // landing grade from how far the tricks were from a clean upright angle
      const spins = Math.round(c.spinAcc / (Math.PI * 2));
      const flips = Math.round(c.flipAcc / (Math.PI * 2));
      const spinErr = Math.abs(c.spinAcc - spins * Math.PI * 2);
      const flipErr = Math.abs(c.flipAcc - flips * Math.PI * 2);
      const tricks = Math.abs(spins) + Math.abs(flips);
      let grade: 'clean' | 'sloppy' | 'crash' = 'clean';
      if (flipErr > 1.0 || spinErr > 1.4) grade = 'crash';
      else if (flipErr > 0.45 || spinErr > 0.7) grade = 'sloppy';
      // the car lands facing the way it spun to, so straighten the velocity onto the new heading
      const sp = Math.hypot(c.vx, c.vz);
      const keep = grade === 'clean' ? 1 : grade === 'sloppy' ? 0.75 : 0.35;
      const hx = Math.sin(c.h), hz = Math.cos(c.h);
      const dirDot = (c.vx * hx + c.vz * hz) / (sp || 1);
      const sgn = dirDot >= -0.2 ? 1 : -1;
      c.vx = hx * sp * keep * sgn; c.vz = hz * sp * keep * sgn;
      if (grade === 'clean' && (tricks > 0 || c.airT > 0.6)) { c.boostT = Math.max(c.boostT, 0.45 + 0.45 * tricks); c.fuel = Math.min(1, c.fuel + 0.06 + 0.06 * tricks); }
      if (grade === 'crash') { c.spinT = 0.9; c.spinDir = Math.sign(c.spinAcc) || 1; }
      events.push({ t: 'land', car: c.id, grade, tricks, airT: c.airT });
      c.grounded = true; c.y = gy; c.vy = 0; c.pitch = 0; c.spinAcc = 0; c.flipAcc = 0; c.tricks = tricks;
      c.prevSlope = q.slope;
    }
    if (c.airT > 0.35) c.fuel = Math.min(1, c.fuel + dt * 0.04);
  }

  // out of bounds: fell off a bridge, flew over a railing, or got stuck far from the road
  const lost = c.y < gy - 4 || (q.outside > 3 && !c.grounded && c.y < gy + 0.5) || q.outside > 6;
  if (lost) c.offT += dt; else c.offT = Math.max(0, c.offT - dt * 2);
  if (c.offT > PHYS.respawnAfter && c.respawnT <= 0) { c.respawnT = 0.9; c.offT = 0; }
  // wedged: gas down, going nowhere for three seconds. Nobody should have to find the tow button to keep racing.
  if (controlEnabled && throttleIn > 0.5 && c.grounded && c.spinT <= 0 && Math.hypot(c.vx, c.vz) < 1.2) c.stuckT += dt; else c.stuckT = 0;
  if (c.stuckT > 3 && c.respawnT <= 0) { c.respawnT = 0.9; c.stuckT = 0; }

  // remember the last safe place to be put back
  if (c.grounded && q.outside < -0.5 && q.path === 0 && time - c.lastSafeT > 0.4 && c.spinT <= 0) { c.lastSafeS = q.sMain; c.lastSafeT = time; }

  // wrong way warning
  const along = c.vx * q.tx + c.vz * q.tz;
  if (along < -6 && q.path === 0) c.wrongWayT += dt; else c.wrongWayT = Math.max(0, c.wrongWayT - dt * 2);

  // visual body roll and the drift hop
  const latNow = c.vx * Math.cos(c.h) * -1 + c.vz * Math.sin(c.h);
  c.roll = expDecay(c.roll, clamp(-latNow * 0.012 - c.yawRate * 0.02, -0.12, 0.12), 8, dt);
  c.vf = c.vx * Math.sin(c.h) + c.vz * Math.cos(c.h);
  c.vr = latNow;
}

export function placeAtSafe(c: CarState, track: Track, events: CarEvent[]) {
  const s = c.lastSafeS - 6;
  const p = track.pointAt(s, 0);
  c.x = p.x; c.y = p.y + 0.3; c.z = p.z; c.h = p.h;
  const speed = 14;
  c.vx = Math.sin(p.h) * speed; c.vz = Math.cos(p.h) * speed; c.vy = 0;
  c.grounded = true; c.drifting = false; c.spinT = 0; c.yawRate = 0; c.airT = 0; c.spinAcc = 0; c.flipAcc = 0; c.pitch = 0;
  c.hint = { path: 0, i: p.i }; c.ghostT = 1.6; c.offT = 0; c.prevSlope = 0;
  events.push({ t: 'respawn', car: c.id });
}

/** Car versus car: two circles per car, mass weighted, with a bonk. A car flagged not to apply belongs to another
 *  machine (a remote player), so only our side of the contact is resolved here. */
export function collideCars(a: CarState, b: CarState, ma: number, mb: number, out: { impact: number }[], applyA = true, applyB = true) {
  if (a.respawnT > 0 || b.respawnT > 0 || a.ghostT > 0 || b.ghostT > 0) return 0;
  if (Math.abs(a.y - b.y) > 2.5) return 0;
  if (Math.abs(a.x - b.x) > 6 || Math.abs(a.z - b.z) > 6) return 0;
  const R = 1.0, off = 1.05;
  let hit = 0;
  for (const sa of [-off, off]) for (const sb of [-off, off]) {
    const ax = a.x + Math.sin(a.h) * sa, az = a.z + Math.cos(a.h) * sa;
    const bx = b.x + Math.sin(b.h) * sb, bz = b.z + Math.cos(b.h) * sb;
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d >= R * 2 || d < 1e-4) continue;
    const nx = dx / d, nz = dz / d, pen = R * 2 - d;
    // a car in Danfo Mode is effectively immovable; with one side remote, ours takes the whole correction
    let wa = a.danfoT > 0 ? 0.02 : mb / (ma + mb), wb = b.danfoT > 0 ? 0.02 : ma / (ma + mb);
    if (!applyB) wa = Math.min(1, wa + wb), wb = 0;
    if (!applyA) wb = Math.min(1, wa + wb), wa = 0;
    if (applyA) { a.x -= nx * pen * wa; a.z -= nz * pen * wa; }
    if (applyB) { b.x += nx * pen * wb; b.z += nz * pen * wb; }
    const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (rv < 0) {
      const j = -(1 + 0.35) * rv / (1 / ma + 1 / mb);
      if (applyA) { a.vx -= (j / ma) * nx; a.vz -= (j / ma) * nz; }
      if (applyB) { b.vx += (j / mb) * nx; b.vz += (j / mb) * nz; }
      hit = Math.max(hit, -rv);
    }
  }
  if (hit > 0) out.push({ impact: hit });
  return hit;
}
