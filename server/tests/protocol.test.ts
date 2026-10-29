import { describe, expect, it } from 'vitest';
import {
  F, MSG_SNAP, Writer, beginSnapshot, decodeSnapshot, decodeState, encodeState, endSnapshot, newPlayerEnt, newVehEnt, packDoors, unpackDoors, packYaw, unpackYaw, writeEntity, cm, VEH_BIT,
  type Ent, type StateMsg, type PlayerEnt, type VehEnt,
} from '../../v2/src/net/protocol.ts';

const foot = (over: Partial<StateMsg> = {}): StateMsg => ({ seq: 7, flags: F.ALIVE | F.GROUND, x: 868.25, y: 0.05, z: -262.5, yaw: 1.2, pitch: -0.3, speed: 4.5, anim: 2, weapon: 3, veh: null, ...over });

describe('client state message', () => {
  it('round trips a character on foot', () => {
    const m = foot(); const out = decodeState(encodeState(m))!;
    expect(out.seq).toBe(7); expect(out.x).toBeCloseTo(868.25, 3); expect(out.z).toBeCloseTo(-262.5, 3);
    expect(out.yaw).toBeCloseTo(1.2, 3); expect(out.pitch).toBeCloseTo(-0.3, 1); expect(out.speed).toBeCloseTo(4.5, 1);
    expect(out.anim).toBe(2); expect(out.weapon).toBe(3); expect(out.veh).toBeNull();
    expect(out.flags & F.ALIVE).toBeTruthy();
  });
  it('round trips a driver with the car', () => {
    const m = foot({ veh: { kind: 3, seat: 0, seed: 123456, x: 870, y: 0.4, z: -260, qx: 0, qy: 0.7071, qz: 0, qw: 0.7071, steer: -0.3, spin: 4.2, doors: [1, 0, 0.33, 0], vflags: 5, vspeed: 12.34 } });
    const out = decodeState(encodeState(m))!;
    expect(out.flags & F.VEH).toBeTruthy();
    const v = out.veh!; expect(v.kind).toBe(3); expect(v.seed).toBe(123456); expect(v.qy).toBeCloseTo(0.7071, 3);
    expect(v.steer).toBeCloseTo(-0.3, 1); expect(v.spin).toBeCloseTo(4.2, 2); expect(v.doors[0]).toBe(1); expect(v.doors[1]).toBe(0); expect(v.doors[2]).toBeCloseTo(0.33, 1); expect(v.vspeed).toBeCloseTo(12.34, 2); expect(v.vflags).toBe(5);
  });
  it('is small', () => {
    expect(encodeState(foot()).length).toBeLessThanOrEqual(23);
    expect(encodeState(foot({ veh: { kind: 0, seat: 0, seed: 1, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0, spin: 0, doors: [0, 0, 0, 0], vflags: 0, vspeed: 0 } })).length).toBeLessThanOrEqual(57);
  });
  it('rejects garbage without throwing', () => {
    expect(decodeState(new Uint8Array([]))).toBeNull();
    expect(decodeState(new Uint8Array([9, 1, 2, 3]))).toBeNull();
    expect(decodeState(new Uint8Array(40).fill(255))).toBeNull(); // NaN floats
    const bad = encodeState(foot({ veh: { kind: 0, seat: 0, seed: 1, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0, spin: 0, doors: [0, 0, 0, 0], vflags: 0, vspeed: 0 } }));
    expect(decodeState(bad.subarray(0, 40))).toBeNull(); // truncated vehicle block
    const f = encodeState(foot()); f[0] = 1; const nan = new Uint8Array(f); new DataView(nan.buffer).setFloat32(5, NaN, true);
    expect(decodeState(nan)).toBeNull();
    // random fuzz never throws
    for (let i = 0; i < 500; i++) { const r = new Uint8Array(1 + Math.floor(Math.random() * 70)); for (let j = 0; j < r.length; j++) r[j] = Math.random() * 256; r[0] = 1; expect(() => decodeState(r)).not.toThrow(); }
  });
  it('angle and door packing', () => {
    expect(unpackYaw(packYaw(-0.5))).toBeCloseTo(2 * Math.PI - 0.5, 3);
    expect(unpackDoors(packDoors([1, 0.5, 0, 1]))).toEqual([1, 8 / 15, 0, 1]);
  });
});

const player = (id: number, over: Partial<PlayerEnt> = {}): PlayerEnt & { k: 0 } => ({ ...newPlayerEnt(id), X: cm(100), Y: 5, Z: cm(-40), yaw: 1000, anim: 1, speed: 20, flags: F.ALIVE, ...over });
const car = (id: number, over: Partial<VehEnt> = {}): VehEnt & { k: 1 } => ({ ...newVehEnt(id), kind: 3, seed: 99, driver: 1, X: cm(200), Y: 40, Z: cm(10), vspeed: 500, ...over });

function snapshot(w: Writer, time: number, ack: number, ents: Ent[], base: Map<number, Ent>, removed: number[] = []) {
  const at = beginSnapshot(w, { time, ack }); let n = 0;
  for (const e of ents) { const b = base.get(e.id) ?? null; if (writeEntity(w, e, b)) { n++; if (!b) base.set(e.id, { ...e }); } }
  for (const id of removed) base.delete(id);
  return endSnapshot(w, at, n, removed).slice();
}

describe('snapshots', () => {
  it('first sight carries everything, later ones only what moved', () => {
    const w = new Writer(512); const serverBase = new Map<number, Ent>(); const client = new Map<number, Ent>();
    const p = player(5), c = car(VEH_BIT | 1);
    const s1 = snapshot(w, 1000, 3, [p, c], serverBase);
    const r1 = decodeSnapshot(s1, client)!;
    expect(r1.time).toBe(1000); expect(r1.ack).toBe(3); expect(r1.changed.length).toBe(2);
    expect(client.get(5)).toMatchObject({ X: p.X, Z: p.Z, anim: 1, flags: F.ALIVE });
    expect(client.get(VEH_BIT | 1)).toMatchObject({ kind: 3, seed: 99, X: cm(200), vspeed: 500 });
    // nothing changed: nothing written
    const s2 = snapshot(w, 1066, 4, [p, c], serverBase);
    expect(decodeSnapshot(s2, client)!.changed.length).toBe(0);
    expect(s2.length).toBeLessThan(12);
    // the player walks 40 cm: a position delta, 7 bytes of body
    p.X += 40; p.Z -= 20;
    const s3 = snapshot(w, 1133, 5, [p, c], serverBase);
    expect(decodeSnapshot(s3, client)!.changed.length).toBe(1);
    expect(client.get(5)).toMatchObject({ X: p.X, Z: p.Z });
    expect(s3.length).toBeLessThan(25);
    // a teleport beyond int16 centimetres falls back to absolute coordinates
    p.X += 90000;
    const s4 = snapshot(w, 1200, 6, [p, c], serverBase);
    decodeSnapshot(s4, client);
    expect(client.get(5)).toMatchObject({ X: p.X, Z: p.Z });
  });
  it('removals and re-entry', () => {
    const w = new Writer(512); const sb = new Map<number, Ent>(); const cl = new Map<number, Ent>();
    decodeSnapshot(snapshot(w, 1, 0, [player(5), player(6)], sb), cl);
    const r = decodeSnapshot(snapshot(w, 2, 0, [player(6)], sb, [5]), cl)!;
    expect(r.removed).toEqual([5]); expect(cl.has(5)).toBe(false); expect(cl.has(6)).toBe(true);
    decodeSnapshot(snapshot(w, 3, 0, [player(5, { X: 777 })], sb), cl);
    expect(cl.get(5)).toMatchObject({ X: 777 });
  });
  it('client copy equals the server copy after a long random walk (no drift)', () => {
    const w = new Writer(2048); const sb = new Map<number, Ent>(); const cl = new Map<number, Ent>();
    const ents: Ent[] = [player(1), player(2), car(VEH_BIT | 1), car(VEH_BIT | 2, { kind: 5 })];
    let seed = 1; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let t = 0; t < 2000; t++) {
      for (const e of ents) {
        if (rnd() < 0.7) { e.X += Math.round((rnd() - 0.5) * 300); e.Y = Math.max(0, e.Y + Math.round((rnd() - 0.5) * 20)); e.Z += Math.round((rnd() - 0.5) * 300); }
        if (rnd() < 0.05) { e.X += Math.round((rnd() - 0.5) * 200000); } // occasional jump
        if (e.k === 0) { if (rnd() < 0.2) e.yaw = (rnd() * 65536) | 0; if (rnd() < 0.1) e.anim = (rnd() * 17) | 0; }
        else { if (rnd() < 0.3) { e.steer = ((rnd() - 0.5) * 254) | 0; e.spin = (rnd() * 65536) | 0; } if (rnd() < 0.1) e.qx = ((rnd() - 0.5) * 60000) | 0; }
      }
      decodeSnapshot(snapshot(w, t * 66, t, ents, sb), cl);
      if (t % 97 === 0) for (const e of ents) expect(cl.get(e.id)).toMatchObject(e as unknown as Record<string, number>);
    }
    for (const e of ents) expect(cl.get(e.id)).toMatchObject(e as unknown as Record<string, number>);
  });
  it('malformed snapshots return null and never throw', () => {
    const cl = new Map<number, Ent>();
    expect(decodeSnapshot(new Uint8Array([]), cl)).toBeNull();
    expect(decodeSnapshot(new Uint8Array([MSG_SNAP, 0, 0]), cl)).toBeNull();
    for (let i = 0; i < 500; i++) { const r = new Uint8Array(12 + Math.floor(Math.random() * 80)); for (let j = 0; j < r.length; j++) r[j] = Math.random() * 256; r[0] = MSG_SNAP; expect(() => decodeSnapshot(r, new Map())).not.toThrow(); }
  });
});
