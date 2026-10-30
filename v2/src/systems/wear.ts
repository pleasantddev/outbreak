// Wear and tear on the road. Every car you drive has an engine, oil, tyres, brakes and a body that wear with the
// kilometres and with how you drive (hard braking, kerbs, crashes). Worn parts change the drive (sim/life.ts reads
// vehicle.wear): less pull, late brakes, slides, an engine that cuts out, punctures. Your own cars keep their wear in
// the fleet record; danfos and kekes you borrow come as rickety as Lagos made them. Roadside workshops service you
// (oil, pads, tyres, panel beating, overhaul) and a vulcanizer patches punctures. Rates come from content/tuning.json
// so the admin panel can tune them live.
import type { GameCtx, GameSystem } from './registry';
import type { Vehicle } from '../sim/types';
import { VEHICLES } from '../data/balance';
import { fleet, type CarWear } from './garageFleet';
import { lifeSystem, type Thing } from './life';
import type { PieItem } from './life/pie';
import { mechanicShops } from './careers/mechanic';
import { spend } from './money';
import { loadContent } from '../content/load';
import { registerApp } from '../ui/lifeHud';
import { net } from '../net/client';

export interface WearTuning { id: string; engine: number; oil: number; tyres: number; brakes: number; hardBrake: number; puncture: number; stall: number; price: number }
const DEF: WearTuning = { id: 'wear.car', engine: 0.07, oil: 0.55, tyres: 0.14, brakes: 0.11, hardBrake: 0.4, puncture: 0.12, stall: 0.03, price: 1 };
const fmt = (n: number) => '₦' + Math.round(n).toLocaleString();
const PARTS: { id: keyof CarWear; label: string; fix: string; cost: number; to: number }[] = [
  { id: 'oil', label: 'Oil', fix: 'Oil change', cost: 8_000, to: 100 },
  { id: 'brakes', label: 'Brakes', fix: 'New brake pads', cost: 15_000, to: 100 },
  { id: 'tyres', label: 'Tyres', fix: 'Four Tokunbo tyres', cost: 36_000, to: 92 },
  { id: 'body', label: 'Body', fix: 'Panel beating and spray', cost: 25_000, to: 100 },
  { id: 'engine', label: 'Engine', fix: 'Engine overhaul', cost: 120_000, to: 100 },
];
const hash = (n: number) => { let h = Math.imul(n ^ 0x9e3779b9, 2654435761); h ^= h >>> 15; return (h >>> 0) / 4294967296; };

class Wear {
  T: WearTuning = { ...DEF }; private borrowed = new Map<number, CarWear>(); private last: { id: number; x: number; z: number; sp: number } | null = null;
  private warned = new Set<string>(); private stallT = 0; private saveT = 20; private lastCar: CarWear | null = null; private lastName = '';
  constructor(private ctx: GameCtx) {}
  init() {
    registerApp('Car', 'M5 16h14M5 16v3h3v-3m8 0v3h3v-3M3 16v-4l2-5h14l2 5v4', 'linear-gradient(160deg,#94a3b8,#334155)', () => this.html());
    void this.tune(); net.on('content', (m: any) => { if (m.kind === 'tuning') void this.tune(); });
    (window as any).__wear = this;
  }
  private async tune() { const t = (await loadContent<WearTuning>('tuning')).find((x) => x.id === 'wear.car'); if (t) this.T = { ...DEF, ...t }; }
  start() { lifeSystem.api?.providers.push(() => this.things()); }
  /** the wear record of a vehicle: your own car's, or a borrowed one's (danfos come tired) */
  of(v: Vehicle): CarWear {
    const car = fleet.carOf(v); if (car) return (car.wear ??= { engine: 100, oil: 100, tyres: 100, brakes: 100, body: 100, km: 0 });
    let w = this.borrowed.get(v.id); if (!w) { const r = hash(v.id); const tired = v.kind === 'danfo' || v.kind === 'keke' || v.kind === 'okada' ? 0.45 : 0.75;
      w = { engine: Math.round((tired + r * 0.3) * 100), oil: Math.round(30 + r * 60), tyres: Math.round((tired + hash(v.id + 7) * 0.3) * 100), brakes: Math.round((tired + hash(v.id + 3) * 0.35) * 100), body: Math.round(50 + r * 45), km: Math.round(40000 + r * 160000) }; this.borrowed.set(v.id, w); }
    return w;
  }
  private apply(v: Vehicle, w: CarWear) {
    const W = ((v as any).wear ??= { power: 1, brake: 1, grip: 1, cut: 0 });
    W.power = 0.5 + 0.5 * Math.min(1, (w.engine / 100) * (w.oil < 10 ? 0.8 : 1)); W.brake = 0.35 + 0.65 * (w.brakes / 100); W.grip = 0.68 + 0.32 * (w.tyres / 100);
  }
  frame(dt: number) {
    const me = this.ctx.sim.local; const v = me.vehicle !== null && me.seat === 0 ? this.ctx.sim.vehicles[me.vehicle] : null;
    if (!v) { this.last = null; return; }
    const w = this.of(v); this.apply(v, w); this.lastCar = w; this.lastName = fleet.carOf(v)?.name ?? (VEHICLES as any)[v.kind]?.name ?? v.kind;
    const p = v.body.translation(); const sp = Math.abs(v.ctrl.currentVehicleSpeed());
    if (!this.last || this.last.id !== v.id) { this.last = { id: v.id, x: p.x, z: p.z, sp }; return; }
    const d = Math.hypot(p.x - this.last.x, p.z - this.last.z); if (d > 50) { this.last = { id: v.id, x: p.x, z: p.z, sp }; return; } // a teleport, not a drive
    const km = d / 1000; const T = this.T;
    // hard braking: speed falling fast while moving
    const decel = (this.last.sp - sp) / Math.max(dt, 1e-3); const hard = decel > 9 && this.last.sp > 8 ? dt : 0;
    w.km += km; w.oil = Math.max(0, w.oil - km * T.oil); w.engine = Math.max(0, w.engine - km * T.engine * (w.oil < 15 ? 3 : 1));
    w.tyres = Math.max(0, w.tyres - km * T.tyres - hard * T.hardBrake); w.brakes = Math.max(0, w.brakes - km * T.brakes - hard * T.hardBrake * 1.2);
    const def = (VEHICLES as any)[v.kind]; if (def?.body) w.body = Math.min(w.body, Math.max(0, (v.bodyHp / def.body) * 100));
    this.last = { id: v.id, x: p.x, z: p.z, sp }; this.saveT -= dt; if (this.saveT <= 0 && fleet.carOf(v)) { this.saveT = 20; this.ctx.persist(); }
    // events: punctures on bald tyres, a dying engine coughs out
    if (w.tyres < 25 && Math.random() < km * T.puncture * (1 - w.tyres / 25) * 10) { const i = Math.floor(Math.random() * 4); if (v.tires[i] > 0) { v.tires[i] = 0; this.ctx.hud.toast('Puncture!', 'Tyre don burst. Find a vulcanizer (any roadside workshop).', 'var(--red)', 'msg', 4.5); } }
    this.stallT -= dt; if (w.engine < 20 && sp > 3 && this.stallT <= 0 && Math.random() < dt * T.stall * (1 - w.engine / 20) * 4) { (v as any).wear.cut = 1.4; this.stallT = 25; this.ctx.hud.say('Engine', 'Kpa kpa kpa... (the engine cuts out)', 2); }
    this.warn('oil', w.oil < 15, 'Oil light on', 'Change your oil before the engine knocks.');
    this.warn('brakes', w.brakes < 25, 'Brakes dey cry', 'The pads are almost gone. You will stop late.');
    this.warn('tyres', w.tyres < 25, 'Tyres don bald', 'Expect a puncture. Grip is going.');
    this.warn('engine', w.engine < 30, 'Engine light on', 'The engine is tired. A workshop can overhaul it.');
  }
  private warn(k: string, on: boolean, title: string, body: string) { if (on && !this.warned.has(k)) { this.warned.add(k); this.ctx.hud.toast(title, body, 'linear-gradient(160deg,#f97316,#c2410c)', 'msg', 4.5); } else if (!on) this.warned.delete(k); }

  // ---------------------------------------------------------------- servicing at the roadside workshops
  private nearCar(x: number, z: number) {
    const me = this.ctx.sim.local; if (me.vehicle !== null) return this.ctx.sim.vehicles[me.vehicle];
    let best: Vehicle | null = null, bd = 14; for (const v of this.ctx.sim.liveVehicles()) { if (!fleet.carOf(v)) continue; const p = v.body.translation(); const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  private things(): Thing[] {
    const me = this.ctx.sim.local; const out: Thing[] = [];
    for (const s of mechanicShops()) { if (Math.abs(s.x - me.pos.x) > 7 || Math.abs(s.z - me.pos.z) > 7) continue; const v = this.nearCar(s.x, s.z); if (!v) continue;
      out.push({ id: 'service', name: 'Service your car', x: s.x + Math.sin(s.yaw) * 2, z: s.z + Math.cos(s.yaw) * 2, yaw: s.yaw, actions: [], kind: 'object', reach: 5, verb: 'Service your car', open: () => this.menu(v) }); }
    return out;
  }
  private menu(v: Vehicle) {
    const L = lifeSystem.api; if (!L) return; const w = this.of(v); const k = this.T.price * (v.kind === 'suv' || v.kind === 'jeep' ? 1.4 : v.kind === 'danfo' ? 1.2 : 1);
    const flats = v.tires.filter((t) => t <= 0).length; const cash = this.ctx.sim.cash;
    const items: PieItem[] = [];
    if (flats) items.push({ id: 'vulc', label: `Vulcanizer: patch ${flats} tyre${flats > 1 ? 's' : ''}`, hint: 'Ten minutes', cost: 1500 * flats, disabled: cash < 1500 * flats ? 'No money' : undefined });
    for (const p of PARTS) { const cur = Math.round(w[p.id] as number); const cost = Math.round(p.cost * k * (p.id === 'body' ? (100 - cur) / 60 : 1)); items.push({ id: p.id, label: p.fix, hint: `${p.label} ${cur}%`, cost, disabled: cur >= 95 ? 'Fine' : cash < cost ? 'No money' : undefined }); }
    L.pie.show('Oga Mechanic', `${Math.round(w.km).toLocaleString()} km on the clock`, items, { x: innerWidth / 2, y: innerHeight / 2 }, (id) => {
      if (id === 'vulc') { if (!spend(this.ctx, 1500 * flats)) return; const def = (VEHICLES as any)[v.kind]; for (let i = 0; i < 4; i++) if (v.tires[i] <= 0) v.tires[i] = def?.tire ?? 100; this.ctx.hud.say('Vulcanizer', 'E don hold. Drive well.', 2.5); return; }
      const p = PARTS.find((x) => x.id === id)!; const cur = w[p.id] as number; const cost = Math.round(p.cost * k * (p.id === 'body' ? (100 - cur) / 60 : 1));
      if (!spend(this.ctx, cost)) { this.ctx.hud.toast('Oga Mechanic', 'Money first, my brother.', 'var(--red)', 'cash', 3); return; }
      (w as any)[p.id] = p.to; if (p.id === 'body') { const def = (VEHICLES as any)[v.kind]; if (def?.body) v.bodyHp = def.body; } if (p.id === 'engine') { const def = (VEHICLES as any)[v.kind]; if (def?.engine) v.engine = def.engine; }
      this.apply(v, w); this.ctx.persist(); this.ctx.hud.toast('Done', `${p.fix}. ${fmt(cost)} paid.`, 'linear-gradient(160deg,#94a3b8,#334155)', 'cash', 3.5);
    });
  }
  private html() {
    const w = this.lastCar; if (!w) return `<div class="row"><b>No car yet</b>Drive something and its condition shows here.</div>`;
    const bar = (label: string, n: number) => `<div style="display:flex;align-items:center;gap:8px;margin-top:5px;font-size:12px"><span style="width:58px">${label}</span><div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden"><i style="display:block;height:100%;width:${Math.round(n)}%;background:${n < 25 ? '#ff4d5e' : n < 50 ? '#f59e0b' : '#2de0c8'}"></i></div><b style="width:34px;text-align:right">${Math.round(n)}%</b></div>`;
    return `<div class="row"><b>${this.lastName}</b>${Math.round(w.km).toLocaleString()} km${PARTS.map((p) => bar(p.label, w[p.id] as number)).join('')}</div><div class="row"><b>Servicing</b>Any roadside workshop: oil, pads, tyres, panel beating, overhaul. Vulcanizers patch punctures.</div>`;
  }
}

let W: Wear | null = null;
export const wearSystem: GameSystem & { get api(): Wear | null } = { id: 'wear', get api() { return W; }, init(ctx) { W = new Wear(ctx); W.init(); }, start() { W?.start(); }, step(_c, dt) { W?.frame(dt); } };
