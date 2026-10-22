// The player's cars: ownership record, plate, paint, tracker, registration, theft and recovery.
// A car lives in the sim only while you are near it; away from you it is a record with a last known position, and a stolen
// car is a thief driving it somewhere in the dark (a simple virtual drive) until the police find it or it gets stripped.
import type { GameCtx } from './registry';
import type { Vehicle } from '../sim/types';
import type { VehicleKind } from '../data/balance';
import { VEHICLES } from '../data/balance';
import { RoadNet } from '../world/roadnet';
import { hash32, stateOf, toast, bus, shopItem, playerXZ, fee } from './featureKit';
import { stdPlate, plateRegistry } from './garagePlates';

export interface PaintSpec { finish: string; color: string; /** compact design JSON (see garagePaint.ts) */ doc?: string; rev: number; name?: string }
export interface TrackerRec { tier: string; since: number; lastPing: number; px: number; pz: number; alertAt: number }
export interface StolenRec { at: number; x0: number; z0: number; yaw0: number; x: number; z: number; reported: boolean; hide: { x: number; z: number; name: string }; chopAt: number; solveAt: number; will: boolean; police: { x: number; z: number; x0: number; z0: number; t0: number } | null; arrivedAt: number }
export type CarStatus = 'ok' | 'stolen' | 'wrecked' | 'chopped';
export interface OwnedCar {
  id: string; vehicle: VehicleKind; seed: number; name: string; plate: string; custom: boolean;
  paint: PaintSpec; tracker: TrackerRec | null;
  reg: null | { nin: string; at: number; lga: string; docs: 'receipt' | 'papers' };
  receipt: boolean; papers: boolean; status: CarStatus;
  x: number; z: number; yaw: number; usedAt: number; boughtAt: number; stolen?: StolenRec;
}
export interface FleetState { cars: OwnedCar[]; seq: number; plates: string[]; designs: { id: string; name: string; model: string; doc: string; at: number }[]; fines: number }

export const OWNABLE: VehicleKind[] = ['sedan', 'hatch', 'jeep', 'suv', 'danfo'];
const KIND_NAME: Record<string, string> = { sedan: 'Saloon', hatch: 'Hatchback', jeep: 'Jeep', suv: 'SUV', danfo: 'Danfo bus', police: 'Patrol car', keke: 'Keke', okada: 'Okada' };
export const kindName = (k: string) => KIND_NAME[k] ?? k;

export interface PoiSpot { x: number; z: number; name: string }

class Fleet {
  ctx!: GameCtx; st!: FleetState;
  /** places a thief would run to (set by garage.ts from the paint sites) */
  hideouts: PoiSpot[] = [];
  private liveOf = new Map<string, number>(); // car id -> vehicle id
  private t = 0; private slow = 0; private theftT = 0; private seen = new Set<string>();
  init(ctx: GameCtx) {
    this.ctx = ctx;
    this.st = stateOf<FleetState>(ctx, 'fleet', { cars: [], seq: 1, plates: [], designs: [], fines: 0 });
    plateRegistry.bind(this.st.plates);
    for (const c of this.st.cars) if (c.stolen && c.status === 'ok') c.status = 'stolen';
  }
  get cars() { return this.st.cars; }
  car(id: string) { return this.st.cars.find((c) => c.id === id) ?? null; }
  carOf(v: Vehicle | null | undefined): OwnedCar | null { const id = v && (v as any).carId; return id ? this.car(id) : null; }
  vehicleOf(c: OwnedCar): Vehicle | null { const id = this.liveOf.get(c.id); if (id === undefined) return null; const v = this.ctx.sim.vehicles[id]; return v && !(v as any).gone && (v as any).carId === c.id ? v : null; }
  posOf(c: OwnedCar): { x: number; z: number } { const v = this.vehicleOf(c); if (v) { const p = v.body.translation(); return { x: p.x, z: p.z }; } if (c.stolen) return { x: c.stolen.x, z: c.stolen.z }; return { x: c.x, z: c.z }; }
  persist() { this.ctx.persist(); }

  /** Makes the car you are in part of your garage (no papers yet). */
  ensureOwned(v: Vehicle, how: 'claimed' | 'bought' = 'claimed'): OwnedCar | null {
    const ex = this.carOf(v); if (ex) return ex;
    if (!OWNABLE.includes(v.kind)) return null;
    const seed = (v as any).seed as number; const id = 'c' + this.st.seq++;
    const p = v.body.translation(); const paint = (v as any).paintSpec as PaintSpec | undefined;
    const car: OwnedCar = { id, vehicle: v.kind, seed, name: kindName(v.kind), plate: (v as any).plate ?? stdPlate(seed * 31 + hash32(id)), custom: false, paint: paint ?? { finish: 'gloss', color: '', rev: 0 }, tracker: null, reg: null, receipt: how === 'bought', papers: false, status: 'ok', x: p.x, z: p.z, yaw: 0, usedAt: this.ctx.sim.time, boughtAt: Date.now() };
    this.st.cars.push(car); this.link(car, v); this.persist(); bus.emit('fleet:change'); return car;
  }
  private link(car: OwnedCar, v: Vehicle) { (v as any).carId = car.id; (v as any).keep = true; (v as any).plate = car.plate; (v as any).plateCustom = car.custom; this.liveOf.set(car.id, v.id); if (car.paint.color || car.paint.doc) (v as any).paintSpec = car.paint; }
  /** Adds a bought car and puts it on the ground at x, z. */
  addBought(kind: VehicleKind, name: string, x: number, z: number, yaw: number): OwnedCar {
    const sim = this.ctx.sim; const v = sim.addVehicle(kind, { x, y: 0.15, z }, yaw, true);
    (v as any).seed = Math.floor(Math.random() * 1e6); (v as any).locked = false;
    const car = this.ensureOwned(v, 'bought')!; car.name = name; car.receipt = true; car.x = x; car.z = z; car.yaw = yaw; this.persist(); return car;
  }
  setPaint(car: OwnedCar, spec: Partial<PaintSpec>) {
    car.paint = { ...car.paint, ...spec, rev: car.paint.rev + 1 }; const v = this.vehicleOf(car); if (v) (v as any).paintSpec = car.paint; this.persist(); bus.emit('fleet:paint', car);
  }
  setPlate(car: OwnedCar, text: string, custom: boolean) {
    if (car.plate !== text) plateRegistry.release(car.plate);
    car.plate = text; car.custom = custom; const v = this.vehicleOf(car); if (v) { (v as any).plate = text; (v as any).plateCustom = custom; } this.persist(); bus.emit('fleet:change');
  }
  setTracker(car: OwnedCar, tier: string) {
    const p = this.posOf(car); car.tracker = { tier, since: Date.now(), lastPing: -99, px: p.x, pz: p.z, alertAt: -99 }; this.persist(); bus.emit('fleet:change');
  }
  register(car: OwnedCar, nin: string, lga: string, docs: 'receipt' | 'papers') { car.reg = { nin, at: Date.now(), lga, docs }; this.persist(); bus.emit('fleet:change'); }

  // ---------------------------------------------------------------- theft
  report(car: OwnedCar): 'ok' | 'notstolen' | 'noreg' {
    if (!car.reg) return 'noreg';
    if (car.status !== 'stolen' || !car.stolen) {
      this.st.fines += 5000; return 'notstolen';
    }
    const s = car.stolen; if (s.reported) return 'ok';
    s.reported = true; const now = this.ctx.sim.time;
    // police response: how fast they can find it, and whether they will at all
    const tier = car.tracker?.tier; const papers = car.reg.docs === 'papers';
    const base = tier === 'pro' ? 40 : tier === 'gps' ? 70 : tier === 'tag' ? 130 : 330;
    const will = Math.random() < (tier === 'pro' ? 0.97 : tier === 'gps' ? 0.92 : tier === 'tag' ? 0.8 : 0.5) * (papers ? 0.7 : 1);
    s.solveAt = now + base * (papers ? 1.5 : 1); s.will = will;
    const st = this.nearestPolice(s.x, s.z); s.police = { x: st.x, z: st.z, x0: st.x, z0: st.z, t0: now };
    this.persist(); bus.emit('fleet:change'); return 'ok';
  }
  private nearestPolice(x: number, z: number) {
    let best = { x: x + 600, z: z + 400 }, bd = 1e9;
    for (const reg of this.ctx.store.regions.values()) for (const p of reg.pois) if (p.kind === 11) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = { x: p.x, z: p.z }; } }
    return best;
  }
  /** Test hook and the random thief: takes the car now. */
  steal(car: OwnedCar) {
    if (car.status !== 'ok') return false; const sim = this.ctx.sim; const v = this.vehicleOf(car);
    if (v && v.seats.some((s) => s !== null)) return false;
    const pos = this.posOf(car);
    // the nearest hideout that is not right here
    const far = this.hideouts.filter((h) => Math.hypot(h.x - pos.x, h.z - pos.z) > 500);
    const hide = far.length ? far[Math.floor(Math.random() * far.length)] : { x: pos.x + 1500, z: pos.z - 900, name: 'a chop shop' };
    const now = sim.time;
    car.status = 'stolen';
    car.stolen = { at: now, x0: pos.x, z0: pos.z, yaw0: car.yaw, x: pos.x, z: pos.z, reported: false, hide, chopAt: now + (car.tracker ? 360 : 240), solveAt: 0, will: false, police: null, arrivedAt: 0 };
    car.usedAt = now;
    if (v) {
      const thief = sim.spawnActor('driver', { x: pos.x + 1.2, y: 0.1, z: pos.z }, undefined, 'Car thief');
      sim.enterVehicle(thief, v, true); (v as any).locked = false; (v as any).thief = thief.id;
      const lanes = sim.net.near(pos.x, pos.z, 40); let bl = -1, bd = 1e9;
      for (const id of lanes) { const l = sim.net.lanes[id]; const pr = RoadNet.project(l.pts, pos.x, pos.z); if (pr.d < bd) { bd = pr.d; bl = id; } }
      if (bl >= 0) (sim as any).drivers.set(v.id, { lane: bl, s: 0, speed: sim.net.lanes[bl].speed * 1.25, lateral: 0, stuck: 0, honk: 0, wait: 0 });
    }
    if (car.tracker) { const d = this.areaName(pos.x, pos.z); toast(this.ctx, 'Tracker alert', `${car.plate} is moving and you are not in it${d ? ' (' + d + ')' : ''}. Open Garage on your phone and report it.`, 'bad', 8); }
    else this.watchMissing = car.id;
    this.persist(); bus.emit('fleet:change'); return true;
  }
  private watchMissing: string | null = null;
  areaName(x: number, z: number) {
    let best = '', bd = 1e9; for (const r of this.ctx.store.regions.values()) for (const p of r.pois) if (p.kind >= 30 && p.kind <= 35 && p.name) { const d = Math.hypot(p.x - x, p.z - z) * (p.kind === 30 || p.kind === 31 ? 1.6 : 1); if (d < bd) { bd = d; best = p.name; } }
    return best;
  }
  private recover(car: OwnedCar, how: string) {
    const s = car.stolen; if (!s) return; const sim = this.ctx.sim;
    const v = this.vehicleOf(car); const thiefId = v ? (v as any).thief as number | undefined : undefined;
    if (v && thiefId !== undefined) { const th = sim.actors[thiefId]; if (th && th.vehicle === v.id) { sim.exitVehicle(th); th.ko = 8; } (sim as any).drivers.delete(v.id); (v as any).thief = undefined; const b = (sim as any).brains?.get?.(thiefId); if (b) b.kind = 'flee'; }
    car.status = 'ok';
    if (v) { const p = v.body.translation(); car.x = p.x; car.z = p.z; } else { car.x = s.x0; car.z = s.z0; car.yaw = s.yaw0; }
    car.stolen = undefined;
    // thieves rip out the cheap trackers
    if (car.tracker && Math.random() < (car.tracker.tier === 'tag' ? 0.8 : car.tracker.tier === 'gps' ? 0.4 : 0)) { car.tracker = null; setTimeout(() => toast(this.ctx, 'Tracker gone', 'The thief pulled your tracker out. Buy another at any mechanic village.', 'warn', 6), 1500); }
    toast(this.ctx, 'Car recovered', `${car.plate}: ${how}`, 'ok', 8);
    this.persist(); bus.emit('fleet:change');
  }
  private lose(car: OwnedCar, why: string) {
    car.status = 'chopped'; const v = this.vehicleOf(car);
    if (v) { const sim = this.ctx.sim; const th = (v as any).thief; if (th !== undefined && sim.actors[th]) { sim.actors[th].ko = 0; } sim.removeVehicle(v); }
    this.liveOf.delete(car.id); car.stolen = undefined; toast(this.ctx, 'Car gone', `${car.plate}: ${why}`, 'bad', 9); this.persist(); bus.emit('fleet:change');
  }
  sell(car: OwnedCar) {
    const v = this.vehicleOf(car); if (v) this.ctx.sim.removeVehicle(v); this.liveOf.delete(car.id); plateRegistry.release(car.plate);
    this.st.cars = this.st.cars.filter((c) => c !== car); this.persist(); bus.emit('fleet:change');
  }
  repair(car: OwnedCar) { if (car.status !== 'wrecked') return; car.status = 'ok'; const v = this.vehicleOf(car); if (v) { this.ctx.sim.removeVehicle(v); this.liveOf.delete(car.id); } this.persist(); bus.emit('fleet:change'); }

  // ---------------------------------------------------------------- per tick
  step(ctx: GameCtx, dt: number) {
    this.t += dt; if (this.t - this.slow < 0.5) return; const el = this.t - this.slow; this.slow = this.t;
    const sim = ctx.sim; const me = sim.local; const P = playerXZ(ctx); const now = sim.time;
    this.theftT += el;
    for (const car of this.st.cars) {
      let v = this.vehicleOf(car);
      if (!v && this.liveOf.has(car.id)) this.liveOf.delete(car.id);
      if (v) {
        const p = v.body.translation(); const occupied = v.seats.some((s) => s !== null); const driverIsMe = v.seats[0] === 0;
        if (v.destroyed && car.status !== 'wrecked' && car.status !== 'chopped') {
          car.status = 'wrecked'; car.stolen = undefined; toast(ctx, 'Car wrecked', `${car.plate} burnt out. Cappa has panel beaters who can bring it back.`, 'bad', 7);
          this.persist(); bus.emit('fleet:change');
        }
        if (driverIsMe) { car.usedAt = now; car.x = p.x; car.z = p.z; if (car.status === 'stolen') this.recover(car, 'you took it back from the thief.'); }
        if (!occupied && car.status === 'ok') { car.x = p.x; car.z = p.z; const r = v.body.rotation(); car.yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)); }
        const far = Math.hypot(p.x - P.x, p.z - P.z);
        if (car.status === 'stolen' && car.stolen) {
          const s = car.stolen; s.x = p.x; s.z = p.z;
          const thief = (v as any).thief as number | undefined; const th = thief !== undefined ? sim.actors[thief] : null;
          // the thief keeps to the lanes; when the car leaves your world it carries on as a drive in the dark
          if (far > 240 || (v as any)._remove) { sim.removeVehicle(v); this.liveOf.delete(car.id); }
          else if (Math.hypot(p.x - s.hide.x, p.z - s.hide.z) < 35 && th && th.vehicle === v.id) { (sim as any).drivers.delete(v.id); v.throttle = 0; s.arrivedAt ||= now; }
        } else if (far > 230 && !occupied && car.status !== 'stolen') { sim.removeVehicle(v); this.liveOf.delete(car.id); }
      } else if (car.status === 'ok' || car.status === 'wrecked') {
        // near a parked car that is not in the world yet: put it down
        if (Math.hypot(car.x - P.x, car.z - P.z) < 190 && (car.x !== 0 || car.z !== 0)) this.materialise(car, car.x, car.z, car.yaw, car.status === 'wrecked');
      }
      if (car.status === 'stolen' && car.stolen) this.stolenTick(car, el, now, P);
      this.trackerTick(car, now, v);
    }
    // random theft of cars left alone, a missed-car hint for owners with no tracker
    if (this.theftT > 30) {
      this.theftT = 0;
      for (const car of this.st.cars) {
        if (car.status !== 'ok') continue; const v = this.vehicleOf(car); if (v && v.seats.some((s) => s !== null)) continue;
        const pos = this.posOf(car); const d = Math.hypot(pos.x - P.x, pos.z - P.z); if (d < 45 || now - car.usedAt < 100) continue;
        if (this.protectedSpot(pos.x, pos.z)) { if (Math.random() > 0.15) continue; }
        if (car.tracker?.tier === 'pro') continue;
        if (Math.random() < 0.008 * (car.reg ? 1 : 1.6)) this.steal(car);
      }
    }
    if (this.watchMissing) {
      const car = this.car(this.watchMissing); if (!car || car.status !== 'stolen') this.watchMissing = null;
      else if (car.stolen && Math.hypot(car.stolen.x0 - P.x, car.stolen.z0 - P.z) < 55) { this.watchMissing = null; toast(ctx, 'Where is my car?', `${car.plate} is not where you parked it. Open Garage on your phone.`, 'bad', 8); }
    }
    void me;
  }
  /** a gate or a car port on the spot: thieves think twice */
  protectedSpot(x: number, z: number) {
    for (const id of this.ctx.land.owned()) { const p = this.ctx.land.plot(id); if (p && Math.hypot(p.cx - x, p.cz - z) < 60 && pointIn(x, z, p.pts)) return true; }
    return false;
  }
  private materialise(car: OwnedCar, x: number, z: number, yaw: number, wreck: boolean) {
    const sim = this.ctx.sim; const v = sim.addVehicle(car.vehicle, { x, y: 0.15, z }, yaw, true);
    (v as any).seed = car.seed; (v as any).locked = false; this.link(car, v);
    if (wreck) { v.bodyHp = 0; v.engine = 0; }
  }
  private stolenTick(car: OwnedCar, el: number, now: number, P: { x: number; z: number }) {
    const s = car.stolen!; const v = this.vehicleOf(car);
    if (!v) {
      // virtual drive toward the hideout
      const dx = s.hide.x - s.x, dz = s.hide.z - s.z, L = Math.hypot(dx, dz);
      if (L > 30) { const step = Math.min(L, 11 * el); s.x += (dx / L) * step; s.z += (dz / L) * step; } else s.arrivedAt ||= now;
      // it comes back into your world when you are near it
      if (Math.hypot(s.x - P.x, s.z - P.z) < 170) {
        const sim = this.ctx.sim; const lanes = sim.net.near(s.x, s.z, 60);
        if (lanes.length || L < 40) {
          let bl = -1, bd = 1e9, at = { x: s.x, z: s.z, yaw: 0 };
          for (const id of lanes) { const l = sim.net.lanes[id]; const pr = RoadNet.project(l.pts, s.x, s.z); if (pr.d < bd) { bd = pr.d; bl = id; at = RoadNet.at(l.pts, pr.s); } }
          this.materialise(car, at.x, at.z, at.yaw, false);
          const nv = this.vehicleOf(car)!; (nv as any).parked = false;
          const thief = sim.spawnActor('driver', { x: at.x + 1, y: 0.1, z: at.z }, undefined, 'Car thief'); sim.enterVehicle(thief, nv, true); (nv as any).thief = thief.id;
          if (bl >= 0 && L > 40) (sim as any).drivers.set(nv.id, { lane: bl, s: 0, speed: sim.net.lanes[bl].speed * 1.25, lateral: 0, stuck: 0, honk: 0, wait: 0 });
        }
      }
    }
    // the police
    if (s.reported && s.police) {
      const k = Math.min(1, (now - s.police.t0) / Math.max(20, s.solveAt - s.police.t0)); const tx = s.x, tz = s.z;
      s.police.x = s.police.x0 + (tx - s.police.x0) * k; s.police.z = s.police.z0 + (tz - s.police.z0) * k;
      if (now >= s.solveAt) { if (s.will) this.recover(car, `police caught the thief near ${this.areaName(s.x, s.z) || 'the road'}. Car brought back to where you left it.`); else { s.police = null; s.solveAt = 1e15; s.will = false; toast(this.ctx, 'Police lost the trail', 'Keep an eye on your tracker. Chop shop clock is still running.', 'warn', 7); } return; }
    }
    if (now >= s.chopAt && car.status === 'stolen') this.lose(car, `stripped for parts at ${s.hide.name}.${car.tracker ? ' You were too slow.' : ' No tracker, no trail.'}`);
  }
  private trackerTick(car: OwnedCar, now: number, v: Vehicle | null) {
    const tr = car.tracker; if (!tr) return; const tier = shopItem('tracker', tr.tier); const ping = tier?.ping ?? 10;
    if (now - tr.lastPing < ping) return; tr.lastPing = now;
    const p = this.posOf(car); const jit = tr.tier === 'tag' ? 18 : 0; tr.px = p.x + (Math.random() - 0.5) * jit; tr.pz = p.z + (Math.random() - 0.5) * jit; void v;
  }

  // ---------------------------------------------------------------- queries for the map
  blips(): { x: number; z: number; c: string; r?: number }[] {
    const out: { x: number; z: number; c: string; r?: number }[] = [];
    for (const car of this.st.cars) {
      if (!car.tracker || car.status === 'chopped') continue;
      out.push({ x: car.tracker.px, z: car.tracker.pz, c: car.status === 'stolen' ? '#ff4d5e' : '#ffb020', r: car.status === 'stolen' ? 9 : 7 });
      if (car.status === 'stolen' && car.stolen?.police) out.push({ x: car.stolen.police.x, z: car.stolen.police.z, c: '#3b6cff', r: 7 });
    }
    return out;
  }
  /** cost sheet exposed for the shop UI */
  priceReg() { return fee('reg', 12000); }
}
function pointIn(x: number, z: number, p: ArrayLike<number>) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
export const fleet = new Fleet();
export const vehicleSize = (k: VehicleKind) => VEHICLES[k].size;

/** Plate text for any vehicle in the street: owned cars use theirs, the rest get a stable one from their seed. */
export function vehiclePlate(v: Vehicle): { text: string; custom: boolean } {
  const a = v as any; if (a.plate) return { text: a.plate, custom: !!a.plateCustom };
  a.plate = stdPlate(((a.seed as number) ?? v.id) + v.id * 7919); a.plateCustom = false; return { text: a.plate, custom: false };
}
