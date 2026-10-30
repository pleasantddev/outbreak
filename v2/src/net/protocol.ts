// HustleLife wire protocol. Pure TypeScript with no imports so the browser client and the Node server share it.
//
// Control traffic (hello, chat, economy actions, acks) is JSON text over the WebSocket.
// The hot path is binary, little endian:
//   client -> server   MSG_STATE   own character (and car) at ~15 Hz, only when something changed (2 Hz heartbeat)
//   server -> client   MSG_SNAP    delta compressed snapshot of the entities inside the player's area of interest
//
// Positions are integers in centimetres on the wire. A snapshot record carries absolute coordinates the first time an
// entity is sent, then int16 centimetre deltas against what that client was last sent (TCP keeps order, so the server
// never needs per-packet acks). Angles are 16 bit, quaternions are four int16.

export const PROTOCOL_VERSION = 1;
export const CELL = 250; // metres, interest grid tile
export const ROOM_CELLS = 8; // a room (shard) is 8 x 8 cells = 2 km, the same size as a map region
export const MSG_STATE = 1;
export const MSG_SNAP = 2;

/** Entity ids: players are 1..0x7fff, vehicles are 0x8000 | n. */
export const VEH_BIT = 0x8000;
export const isVehicleId = (id: number) => (id & VEH_BIT) !== 0;

export const ANIMS = ['idle', 'walk', 'jog', 'sprint', 'crouch', 'crouchWalk', 'jump', 'fall', 'drive', 'swim', 'swimIdle', 'dead', 'heal', 'claw', 'cast', 'climb', 'mantle'] as const;
export const VKINDS = ['okada', 'danfo', 'suv', 'sedan', 'hatch', 'jeep', 'police', 'keke'] as const;
/** Top speed in m/s per VKINDS entry (mirrors VEHICLES.topSpeed in data/balance.ts, checked by a client test). */
export const VKIND_TOP: Record<(typeof VKINDS)[number], number> = { okada: 30, danfo: 22, suv: 28, sedan: 33, hatch: 30, jeep: 36, police: 34, keke: 15 };

/** Weapon byte on the wire, index into this list (mirrors WeaponId in data/balance.ts, checked by a client test). */
export const WEAPON_WIRE = ['fists', 'pistol', 'smg', 'ar', 'shotgun', 'sniper', 'machete'] as const;

export const EMOTES = ['wave', 'dance', 'phone', 'no', 'talk', 'arms'] as const;

// player flag bits (u16)
export const F = { ALIVE: 1, SPRINT: 2, CROUCH: 4, AIM: 8, VEH: 16, FIRE: 32, GROUND: 64, SWIM: 128, PHONE: 256, HORN: 512, FLASH: 1024 } as const;
// vehicle flag bits (u8)
export const VF = { LIGHTS: 1, HORN: 2, SIREN: 4, WRECK: 8, BRAKE: 16, DRIVEN: 32 } as const;

export interface VehState {
  kind: number; seat: number; seed: number;
  x: number; y: number; z: number; // metres
  qx: number; qy: number; qz: number; qw: number;
  steer: number; // radians
  spin: number; // wheel angle, radians
  doors: [number, number, number, number]; // 0..1 each
  vflags: number; vspeed: number; // m/s forward, signed
}
/** What a client reports about itself. */
export interface StateMsg {
  seq: number; flags: number;
  x: number; y: number; z: number; // metres
  yaw: number; pitch: number; speed: number; anim: number; weapon: number;
  veh: VehState | null;
}

// ----------------------------------------------------------------------------------------------- byte helpers
export class Writer {
  buf: Uint8Array; dv: DataView; o = 0;
  constructor(size = 256) { this.buf = new Uint8Array(size); this.dv = new DataView(this.buf.buffer); }
  private need(n: number) {
    if (this.o + n <= this.buf.length) return;
    let s = this.buf.length * 2; while (s < this.o + n) s *= 2;
    const nb = new Uint8Array(s); nb.set(this.buf); this.buf = nb; this.dv = new DataView(nb.buffer);
  }
  u8(v: number) { this.need(1); this.dv.setUint8(this.o++, v); }
  i8(v: number) { this.need(1); this.dv.setInt8(this.o++, v); }
  u16(v: number) { this.need(2); this.dv.setUint16(this.o, v, true); this.o += 2; }
  i16(v: number) { this.need(2); this.dv.setInt16(this.o, v, true); this.o += 2; }
  u32(v: number) { this.need(4); this.dv.setUint32(this.o, v >>> 0, true); this.o += 4; }
  i32(v: number) { this.need(4); this.dv.setInt32(this.o, v | 0, true); this.o += 4; }
  f32(v: number) { this.need(4); this.dv.setFloat32(this.o, v, true); this.o += 4; }
  bytes() { return this.buf.subarray(0, this.o); }
}
export class Reader {
  dv: DataView; o = 0;
  constructor(public buf: Uint8Array) { this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  get left() { return this.buf.length - this.o; }
  u8() { return this.dv.getUint8(this.o++); }
  i8() { return this.dv.getInt8(this.o++); }
  u16() { const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  i16() { const v = this.dv.getInt16(this.o, true); this.o += 2; return v; }
  u32() { const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  i32() { const v = this.dv.getInt32(this.o, true); this.o += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
}

// ----------------------------------------------------------------------------------------------- quantisation
const TAU = Math.PI * 2;
export const cm = (m: number) => Math.round(m * 100);
export const fromCm = (c: number) => c / 100;
export function packYaw(r: number) { const t = ((r % TAU) + TAU) % TAU; return Math.round((t / TAU) * 65536) & 0xffff; }
export function unpackYaw(u: number) { return (u / 65536) * TAU; }
export const packPitch = (r: number) => Math.max(-127, Math.min(127, Math.round((r / 1.5708) * 127)));
export const unpackPitch = (i: number) => (i / 127) * 1.5708;
export const packQ = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
export const unpackQ = (i: number) => i / 32767;
export const packSteer = (r: number) => Math.max(-127, Math.min(127, Math.round((r / 0.8) * 127)));
export const unpackSteer = (i: number) => (i / 127) * 0.8;
export const packSpin = (r: number) => packYaw(r);
export const unpackSpin = (u: number) => unpackYaw(u);
/** four door openings 0..1 into one u16, 4 bits each */
export function packDoors(d: ArrayLike<number>) { let b = 0; for (let i = 0; i < 4; i++) b |= Math.max(0, Math.min(15, Math.round((d[i] ?? 0) * 15))) << (i * 4); return b; }
export function unpackDoors(b: number): [number, number, number, number] { return [(b & 15) / 15, ((b >> 4) & 15) / 15, ((b >> 8) & 15) / 15, ((b >> 12) & 15) / 15]; }

// ----------------------------------------------------------------------------------------------- client -> server
export function encodeState(m: StateMsg, w = new Writer(80)): Uint8Array {
  w.o = 0;
  w.u8(MSG_STATE); w.u16(m.seq & 0xffff); w.u16(m.flags | (m.veh ? F.VEH : 0));
  w.f32(m.x); w.f32(m.y); w.f32(m.z);
  w.u16(packYaw(m.yaw)); w.i8(packPitch(m.pitch)); w.u8(Math.max(0, Math.min(255, Math.round(m.speed * 4)))); w.u8(m.anim); w.u8(m.weapon);
  const v = m.veh;
  if (v) {
    w.u8(v.kind); w.u8(v.seat); w.u32(v.seed);
    w.f32(v.x); w.f32(v.y); w.f32(v.z);
    w.i16(packQ(v.qx)); w.i16(packQ(v.qy)); w.i16(packQ(v.qz)); w.i16(packQ(v.qw));
    w.i8(packSteer(v.steer)); w.u16(packSpin(v.spin)); w.u16(packDoors(v.doors)); w.u8(v.vflags);
    w.i16(Math.max(-32767, Math.min(32767, Math.round(v.vspeed * 100))));
  }
  return w.bytes();
}
/** Returns null for anything malformed. Never throws on hostile input. */
export function decodeState(buf: Uint8Array): StateMsg | null {
  try {
    if (buf.length < 23 || buf[0] !== MSG_STATE) return null;
    const r = new Reader(buf); r.u8();
    const seq = r.u16(), flags = r.u16();
    const x = r.f32(), y = r.f32(), z = r.f32();
    const yaw = unpackYaw(r.u16()), pitch = unpackPitch(r.i8()), speed = r.u8() / 4, anim = r.u8(), weapon = r.u8();
    if (!Number.isFinite(x + y + z)) return null;
    let veh: VehState | null = null;
    if (flags & F.VEH) {
      if (r.left < 34) return null;
      const kind = r.u8(), seat = r.u8(), seed = r.u32();
      const vx = r.f32(), vy = r.f32(), vz = r.f32();
      const qx = unpackQ(r.i16()), qy = unpackQ(r.i16()), qz = unpackQ(r.i16()), qw = unpackQ(r.i16());
      const steer = unpackSteer(r.i8()), spin = unpackSpin(r.u16()), doors = unpackDoors(r.u16()), vflags = r.u8(), vspeed = r.i16() / 100;
      if (!Number.isFinite(vx + vy + vz) || kind >= VKINDS.length) return null;
      veh = { kind, seat, seed, x: vx, y: vy, z: vz, qx, qy, qz, qw, steer, spin, doors, vflags, vspeed };
    }
    return { seq, flags, x, y, z, yaw, pitch, speed, anim, weapon, veh };
  } catch { return null; }
}

// ----------------------------------------------------------------------------------------------- server -> client
/** Quantised state of a player as it travels. Position in whole centimetres. */
export interface PlayerEnt {
  id: number; X: number; Y: number; Z: number; yaw: number /* u16 */; pitch: number /* i8 */;
  anim: number; speed: number /* u8, m/s x4 */; flags: number; weapon: number; veh: number /* vehicle entity id, 0 none */; seat: number;
}
export interface VehEnt {
  id: number; kind: number; seed: number; driver: number; X: number; Y: number; Z: number;
  qx: number; qy: number; qz: number; qw: number /* int16 */; steer: number /* i8 */; spin: number /* u16 */; doors: number /* packed u16 */; vflags: number; vspeed: number /* i16, cm/s */;
}
export type Ent = (PlayerEnt & { k: 0 }) | (VehEnt & { k: 1 });

export const newPlayerEnt = (id: number): PlayerEnt & { k: 0 } => ({ k: 0, id, X: 0, Y: 0, Z: 0, yaw: 0, pitch: 0, anim: 0, speed: 0, flags: 0, weapon: 0, veh: 0, seat: 0 });
export const newVehEnt = (id: number): VehEnt & { k: 1 } => ({ k: 1, id, kind: 0, seed: 0, driver: 0, X: 0, Y: 0, Z: 0, qx: 0, qy: 0, qz: 0, qw: 32767, steer: 0, spin: 0, doors: 0, vflags: 0, vspeed: 0 });

// record masks
const M_FULL = 1, M_ROT = 2, M_ANIM = 4, M_VEH = 8; // players
const V_FULL = 1, V_QUAT = 2, V_WHEEL = 4, V_SPEED = 8; // vehicles
const D16 = 32767;

export interface SnapHeader { time: number; ack: number }

/**
 * Appends one entity record to a snapshot when it differs from `base` (what this client already has).
 * `base` is null for an entity the client has never seen. Returns false when nothing needed sending.
 * `base` is updated in place to what the client will hold after decoding.
 */
export function writeEntity(w: Writer, e: Ent, base: Ent | null): boolean {
  if (e.k === 0) {
    const b = base as PlayerEnt | null;
    let mask = 0;
    const dx = b ? e.X - b.X : 0, dy = b ? e.Y - b.Y : 0, dz = b ? e.Z - b.Z : 0;
    const full = !b || Math.abs(dx) > D16 || Math.abs(dy) > D16 || Math.abs(dz) > D16;
    if (full || dx || dy || dz) mask |= M_FULL;
    if (!b || e.yaw !== b.yaw || e.pitch !== b.pitch) mask |= M_ROT;
    if (!b || e.anim !== b.anim || e.speed !== b.speed || e.flags !== b.flags || e.weapon !== b.weapon) mask |= M_ANIM;
    if (!b || e.veh !== b.veh || e.seat !== b.seat) mask |= M_VEH;
    if (!mask) return false;
    w.u16(e.id); w.u8(mask | (full ? 0x80 : 0));
    if (mask & M_FULL) { if (full) { w.i32(e.X); w.i32(e.Y); w.i32(e.Z); } else { w.i16(dx); w.i16(dy); w.i16(dz); } }
    if (mask & M_ROT) { w.u16(e.yaw); w.i8(e.pitch); }
    if (mask & M_ANIM) { w.u8(e.anim); w.u8(e.speed); w.u16(e.flags); w.u8(e.weapon); }
    if (mask & M_VEH) { w.u16(e.veh); w.u8(e.seat); }
    if (b) Object.assign(b, e); return true;
  }
  const b = base as VehEnt | null;
  let mask = 0;
  const dx = b ? e.X - b.X : 0, dy = b ? e.Y - b.Y : 0, dz = b ? e.Z - b.Z : 0;
  const full = !b || Math.abs(dx) > D16 || Math.abs(dy) > D16 || Math.abs(dz) > D16;
  if (full || dx || dy || dz) mask |= V_FULL;
  if (!b || e.qx !== b.qx || e.qy !== b.qy || e.qz !== b.qz || e.qw !== b.qw) mask |= V_QUAT;
  if (!b || e.steer !== b.steer || e.spin !== b.spin || e.doors !== b.doors || e.vflags !== b.vflags) mask |= V_WHEEL;
  if (!b || e.vspeed !== b.vspeed || e.driver !== b.driver) mask |= V_SPEED;
  if (!mask) return false;
  w.u16(e.id); w.u8(mask | (full ? 0x80 : 0));
  if (!b) { w.u8(e.kind); w.u32(e.seed); }
  if (mask & V_FULL) { if (full) { w.i32(e.X); w.i32(e.Y); w.i32(e.Z); } else { w.i16(dx); w.i16(dy); w.i16(dz); } }
  if (mask & V_QUAT) { w.i16(e.qx); w.i16(e.qy); w.i16(e.qz); w.i16(e.qw); }
  if (mask & V_WHEEL) { w.i8(e.steer); w.u16(e.spin); w.u16(e.doors); w.u8(e.vflags); }
  if (mask & V_SPEED) { w.i16(e.vspeed); w.u16(e.driver); }
  if (b) Object.assign(b, e); return true;
}

/** Builds a whole snapshot. `changed` already holds only the records that wrote; use buildSnapshot for the common case. */
export function beginSnapshot(w: Writer, h: SnapHeader) {
  w.o = 0; w.u8(MSG_SNAP); w.u32(h.time >>> 0); w.u16(h.ack & 0xffff);
  const countAt = w.o; w.u16(0); return countAt;
}
export function endSnapshot(w: Writer, countAt: number, count: number, removed: number[]) {
  w.dv.setUint16(countAt, count, true);
  w.u16(removed.length); for (const id of removed) w.u16(id);
  return w.bytes();
}

export interface SnapResult { time: number; ack: number; changed: Ent[]; removed: number[] }
/** Applies a snapshot onto `known` (the client's copy of every entity it can see) and reports what changed. Returns null for malformed input. */
export function decodeSnapshot(buf: Uint8Array, known: Map<number, Ent>): SnapResult | null {
  try {
    if (buf.length < 11 || buf[0] !== MSG_SNAP) return null;
    const r = new Reader(buf); r.u8();
    const time = r.u32(), ack = r.u16(), n = r.u16();
    const changed: Ent[] = [];
    for (let i = 0; i < n; i++) {
      const id = r.u16(), mbyte = r.u8(); const mask = mbyte & 0x7f, full = (mbyte & 0x80) !== 0;
      if (isVehicleId(id)) {
        let e = known.get(id) as (VehEnt & { k: 1 }) | undefined;
        if (!e) { e = newVehEnt(id); known.set(id, e); e.kind = r.u8(); e.seed = r.u32(); }
        if (mask & V_FULL) { if (full) { e.X = r.i32(); e.Y = r.i32(); e.Z = r.i32(); } else { e.X += r.i16(); e.Y += r.i16(); e.Z += r.i16(); } }
        if (mask & V_QUAT) { e.qx = r.i16(); e.qy = r.i16(); e.qz = r.i16(); e.qw = r.i16(); }
        if (mask & V_WHEEL) { e.steer = r.i8(); e.spin = r.u16(); e.doors = r.u16(); e.vflags = r.u8(); }
        if (mask & V_SPEED) { e.vspeed = r.i16(); e.driver = r.u16(); }
        changed.push(e);
      } else {
        let e = known.get(id) as (PlayerEnt & { k: 0 }) | undefined;
        if (!e) { e = newPlayerEnt(id); known.set(id, e); }
        if (mask & M_FULL) { if (full) { e.X = r.i32(); e.Y = r.i32(); e.Z = r.i32(); } else { e.X += r.i16(); e.Y += r.i16(); e.Z += r.i16(); } }
        if (mask & M_ROT) { e.yaw = r.u16(); e.pitch = r.i8(); }
        if (mask & M_ANIM) { e.anim = r.u8(); e.speed = r.u8(); e.flags = r.u16(); e.weapon = r.u8(); }
        if (mask & M_VEH) { e.veh = r.u16(); e.seat = r.u8(); }
        changed.push(e);
      }
    }
    const nr = r.u16(); const removed: number[] = [];
    for (let i = 0; i < nr; i++) { const id = r.u16(); removed.push(id); known.delete(id); }
    return { time, ack, changed, removed };
  } catch { return null; }
}

// ----------------------------------------------------------------------------------------------- JSON messages
export type ClientMsg =
  | { t: 'hello'; token: string; v: number; build?: string }
  | { t: 'ping'; c: number }
  | { t: 'chat'; ch: 'near' | 'global'; text: string }
  | { t: 'whisper'; to: string; text: string }
  | { t: 'emote'; id: (typeof EMOTES)[number] }
  | { t: 'act'; n: number; a: string; [k: string]: unknown };

export interface WhoInfo { id: number; name: string; model: string; skin: number; outfit: string; level: number; role?: string }

export type ServerMsg =
  | { t: 'welcome'; id: number; v: number; tickHz: number; serverTime: number; epoch: number; cell: number; wallet: { cash: number; bank: number }; plots: string[]; online: number; profile: unknown; role: string; state: Record<string, unknown>; motd?: string; grid?: import('./rules').GridState }
  | { t: 'pong'; c: number; s: number }
  | { t: 'who'; list: WhoInfo[] }
  | { t: 'chat'; ch: 'near' | 'global' | 'whisper' | 'system'; from: string; fromId: number; text: string; ts: number }
  | { t: 'emote'; id: number; e: string }
  | { t: 'ack'; n: number; ok: boolean; err?: string; [k: string]: unknown }
  | { t: 'wallet'; cash: number; bank: number; n?: number; why?: string }
  | { t: 'plot'; id: string; owner: string | null; ownerName: string | null }
  | { t: 'fix'; x: number; y: number; z: number; seq: number; why: string }
  | { t: 'content'; kind: string; etag: string }
  | { t: 'kick'; reason: string }
  | { t: 'toast'; title: string; body: string }
  | { t: 'lobby'; key: string; state: string; [k: string]: unknown }
  /** another player did something to you: greeted you, invited you to their room, or (as the owner) left it with you inside */
  | { t: 'social'; kind: 'greet' | 'invite' | 'evict' | 'ticket'; from: string; fromId: number; owner?: string; door?: { x: number; z: number; yaw: number }; amount?: number }
  /** somebody bought a shop: the signboard on that site changes for everyone */
  | { t: 'biz'; site: string; type: string; ownerName: string }
  /** the power grid changed: one character per feeder, generation, load, collapse (rules.ts GridState) */
  | ({ t: 'grid' } & import('./rules').GridState);

/** Actions a client may send in `act`. The server owns the rules for each. */
export const ACTS = ['plot.buy', 'bank.deposit', 'bank.withdraw', 'cash.transfer', 'cash.delta', 'job.start', 'job.done', 'shop.buy', 'state.put', 'tp', 'respawn'] as const;

export function cellOf(x: number, z: number): [number, number] { return [Math.floor(x / CELL), Math.floor(z / CELL)]; }
export const cellKey = (cx: number, cz: number) => ((cx + 4096) << 13) | (cz + 4096); // cells span +-1000 km, 13 bits each
