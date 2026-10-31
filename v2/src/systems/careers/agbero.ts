// Agbero: the park union. Every motor park on the map has a chairman under the canopy. Join, take the ticket book,
// and collect from every danfo and keke that loads (₦500 a danfo, ₦300 a keke). Most drivers pay, some argue, some
// pretend not to hear; you can let them go, beg, or raise your voice (and a crowd can turn on you). At the end of the
// shift the chairman takes the union's cut, less as you rise: area boy, ticket boy, agbero, park marshal, chairman.
// Online, a real player driving through on duty gets your demand on their phone, and pays you or drives off.
// Satire of an informal levy: no real union names, nothing a reader could use.
import type { GameCtx, GameSystem } from '../registry';
import type { Actor, Vehicle } from '../../sim/types';
import { AREA } from '../../world/region';
import { lifeSystem, type Thing } from '../life';
import type { PieItem } from '../life/pie';
import { addMoodlet } from '../life/needs';
import { earn, spend } from '../money';
import { career } from './ranks';
import { net } from '../../net/client';
import { sfx } from '../leisure/sfx';
import { people } from '../net';
import { MotorParkProps, siteFromArea, standSpots, parkToWorld, type ParkSite } from '../../world/motorpark';

interface Park { id: string; x: number; z: number; name: string; site?: ParkSite }
interface Bus { v: Vehicle; driver: Actor; fare: number; until: number; paid: boolean; mood: number }
const CUT = [0.6, 0.5, 0.4, 0.3, 0.15]; // the chairman's share by your rank
const CHAIRMEN = ['Chairman Kokoro', 'Baba Ijebu-Ode', 'Chairman Sule', 'Alhaji Garage', 'Oga Ticket'];
const PAY = ['Take. No vex.', 'Abeg take am, I dey rush.', 'See your money.', 'Na today I go pay last o.'];
const ARGUE = ['I don pay for the other park!', 'Which ticket again? Every day ticket!', 'Agbero, I no get change.', 'Make I load first, I go pay.'];
const pick = <T,>(l: T[]) => l[Math.floor(Math.random() * l.length)];

class Agbero {
  parks = new Map<string, Park>(); private seen = new Set<string>(); private scanT = 0; private boss = new Map<string, Actor>();
  private shift: { park: Park; gross: number; tickets: number; buses: Bus[]; next: number } | null = null; private joined = false;
  constructor(private ctx: GameCtx) {}
  get life() { return lifeSystem.api; }
  init() { this.joined = !!(this.ctx.save as any).agbero?.joined; (window as any).__agbero = this; }
  start() {
    this.life?.providers.push(() => this.things());
    net.on('social', (m: any) => { if (m.kind === 'ticket') this.demanded(m); });
  }
  private scan() {
    for (const [k, r] of this.ctx.store.regions) {
      if (this.seen.has(k)) continue; this.seen.add(k);
      for (const a of r.areas) { if (a.kind !== AREA.busStation) continue; const n = a.pts.length / 2; if (n < 3) continue; let x = 0, z = 0; for (let q = 0; q < n; q++) { x += a.pts[q * 2]; z += a.pts[q * 2 + 1]; } x /= n; z /= n;
        const id = `p:${Math.round(x)}:${Math.round(z)}`; this.parks.set(id, { id, x, z, name: a.name || 'Motor park', site: siteFromArea(id, a.name || 'Motor park', a.pts) ?? undefined }); }
    }
  }
  private dress: MotorParkProps | null = null; private crowd = new Map<string, Actor[]>();
  /** canopies, benches, the union shed and a few people standing about, only for parks near you */
  private dressParks() {
    const me = this.ctx.sim.local; const s = this.ctx.sim;
    this.dress ??= new MotorParkProps(this.ctx.view.scene);
    this.dress.sync([...this.parks.values()].map((p) => p.site).filter((x): x is ParkSite => !!x), me.pos.x, me.pos.z);
    for (const p of this.near(80)) if (p.site && !this.crowd.has(p.id)) {
      const list: Actor[] = [];
      for (const sp of standSpots(p.site)) { const w = parkToWorld(p.site, sp.lx, sp.lz); const a = s.spawnActor('ped', { x: w.x, y: 0.05, z: w.z }, undefined, sp.role); Object.assign(a as any, { _keep: true, _script: true, act: { clip: 'Idle_Loop', yaw: Math.random() * Math.PI * 2 } }); list.push(a); }
      this.crowd.set(p.id, list);
    }
    for (const [id, list] of this.crowd) { const p = this.parks.get(id); if (!p || Math.hypot(p.x - me.pos.x, p.z - me.pos.z) > 130) { for (const a of list) if (!(a as any)._gone) s.removeActor(a); this.crowd.delete(id); } }
  }
  private near(r: number) { const me = this.ctx.sim.local; return [...this.parks.values()].filter((p) => Math.hypot(p.x - me.pos.x, p.z - me.pos.z) < r); }
  /** the chairman stands at every park near you */
  private chairmen() {
    const me = this.ctx.sim.local; const s = this.ctx.sim;
    for (const p of this.near(90)) if (!this.boss.has(p.id)) { const a = s.spawnActor('ped', { x: p.x + 2, y: 0.05, z: p.z + 2 }, undefined, CHAIRMEN[Math.abs(Math.round(p.x + p.z)) % CHAIRMEN.length]); Object.assign(a as any, { _keep: true, _script: true, act: { clip: 'Idle_Loop', yaw: 0 } }); this.boss.set(p.id, a); }
    for (const [id, a] of this.boss) { const p = this.parks.get(id)!; if (Math.hypot(p.x - me.pos.x, p.z - me.pos.z) > 140 && this.shift?.park.id !== id) { if (!(a as any)._gone) s.removeActor(a); this.boss.delete(id); } }
  }

  // ---------------------------------------------------------------- the E list
  private things(): Thing[] {
    const me = this.ctx.sim.local; const out: Thing[] = [];
    for (const [id, a] of this.boss) { if ((a as any)._gone || Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) > 3) continue; const p = this.parks.get(id)!;
      out.push({ id: 'chairman', name: a.name, x: a.pos.x, z: a.pos.z, yaw: a.yaw, actions: [], kind: 'object', reach: 2.6, verb: `Talk to ${a.name}`, open: () => this.chairMenu(p, a) }); }
    const sh = this.shift; if (sh) for (const p of people.driving(me.pos.x, me.pos.z, 9)) out.push({ id: 'pdriver', name: p.name, x: p.x, z: p.z, yaw: 0, actions: [], kind: 'object', reach: 9, verb: `Demand ticket from ${p.name}`, open: () => void this.demand(p.id, p.name) });
    if (sh) for (const b of sh.buses) { if (b.paid || Math.hypot(b.driver.pos.x - me.pos.x, b.driver.pos.z - me.pos.z) > 3) continue;
      out.push({ id: 'driver', name: 'Driver', x: b.driver.pos.x, z: b.driver.pos.z, yaw: 0, actions: [], kind: 'object', reach: 2.6, verb: `Collect ticket (₦${b.fare})`, open: () => this.collect(b) }); }
    return out;
  }
  private chairMenu(p: Park, a: Actor) {
    const L = this.life; if (!L) return; const rank = career.rank('agbero'); const c = this.ctx;
    const items: PieItem[] = this.shift ? [{ id: 'end', label: 'Remit and close the book', hint: `₦${this.shift.gross.toLocaleString()} collected, union takes ${Math.round(CUT[rank] * 100)}%` }]
      : !this.joined ? [{ id: 'join', label: 'Join the union', hint: 'Free. Loyalty is the fee.' }]
      : [{ id: 'start', label: 'Take the ticket book', hint: `Collect at ${p.name}` }, { id: 'gist', label: 'Ask about the union', hint: '+Social' }];
    L.pie.show(a.name, p.name, items, { x: innerWidth / 2, y: innerHeight / 2 }, (id) => {
      if (id === 'join') { this.joined = true; (c.save as any).agbero = { joined: true }; c.persist(); c.hud.say(a.name, 'Welcome to the family. Respect the park, respect the chairman, and remit complete.', 4); }
      if (id === 'start') { this.shift = { park: p, gross: 0, tickets: 0, buses: [], next: 2 }; c.hud.title('ON THE PARK', `${p.name} · danfo ₦500, keke ₦300`, 3); c.hud.say(a.name, 'Collect from everybody. No dulling.', 3); }
      if (id === 'gist') { c.hud.say(a.name, pick(['Na this park feed my children, and their children.', 'The road is ours, the government is just visiting.', 'If you sabi collect, the park go know your name.']), 4); L.needs.v.social = Math.min(100, L.needs.v.social + 6); }
      if (id === 'end') this.end(a);
    });
  }
  private collect(b: Bus) {
    const c = this.ctx; const L = this.life; if (!L || !this.shift) return; const rank = career.rank('agbero'); const r = Math.random() + rank * 0.05 + b.mood * 0.2;
    if (r > 0.42) { this.pay(b); c.hud.say('Driver', pick(PAY), 2.5); return; }
    c.hud.say('Driver', pick(ARGUE), 3);
    L.pie.show('Driver', 'He is not paying', [{ id: 'press', label: 'Raise your voice', hint: 'He might pay. He might fight.' }, { id: 'beg', label: 'Beg small', hint: 'Half the ticket' }, { id: 'let', label: 'Let him go', hint: 'Nothing' }], { x: innerWidth / 2, y: innerHeight / 2 }, (id) => {
      if (id === 'let') { b.paid = true; c.hud.say('You', 'Oya go. Next time.', 2); return; }
      if (id === 'beg') { b.fare = Math.round(b.fare / 2); this.pay(b); c.hud.say('Driver', 'Hmm. Take this one.', 2.5); return; }
      if (Math.random() < 0.6 + rank * 0.08) { this.pay(b); c.hud.say('Driver', 'Okay o! No shout for me.', 2.5); addMoodlet(L.needs, 'boss', 'Ran the park', 3, 3); }
      else { b.paid = true; c.hud.say('Driver', 'You wan fight? Come!', 2.5); L.needs.v.fun = Math.max(0, L.needs.v.fun - 6); addMoodlet(L.needs, 'disgraced', 'Disgraced at the park', -5, 4); }
    });
  }
  private pay(b: Bus) { const s = this.shift!; b.paid = true; s.gross += b.fare; s.tickets++; sfx('cash'); career.add('agbero', 1); }
  private end(a?: Actor) {
    const s = this.shift; if (!s) return; this.shift = null; const c = this.ctx; const rank = career.rank('agbero');
    for (const b of s.buses) this.dropBus(b);
    const take = Math.round(s.gross * (1 - CUT[rank])); if (take > 0) earn(c, take, 'hustle');
    c.hud.toast('Union', `${s.tickets} tickets, ₦${s.gross.toLocaleString()} collected. ${a?.name ?? 'The chairman'} took the union's ${Math.round(CUT[rank] * 100)}%. You keep ₦${take.toLocaleString()}.`, 'linear-gradient(160deg,#16a34a,#14532d)', 'cash', 5.5);
  }
  private dropBus(b: Bus) { const s = this.ctx.sim; if (!(b.driver as any)._gone) s.removeActor(b.driver); if (!(b.v as any).gone) s.removeVehicle(b.v); }
  /** a danfo or keke pulls in to load every so often; it leaves after a while, paid or not */
  private traffic(dt: number) {
    const sh = this.shift; if (!sh) return; const s = this.ctx.sim; const me = s.local; const now = performance.now();
    if (Math.hypot(sh.park.x - me.pos.x, sh.park.z - me.pos.z) > 160) { this.ctx.hud.toast('Union', 'You left the park. The book goes back to the chairman.', 'var(--red)', 'msg', 4); this.end(); return; }
    for (const b of [...sh.buses]) if (now > b.until) { this.dropBus(b); sh.buses.splice(sh.buses.indexOf(b), 1); }
    sh.next -= dt; if (sh.next > 0 || sh.buses.length >= 3) return; sh.next = 9 + Math.random() * 10;
    const ang = Math.random() * Math.PI * 2, d = 8 + Math.random() * 10; const x = sh.park.x + Math.cos(ang) * d, z = sh.park.z + Math.sin(ang) * d;
    const kind = Math.random() < 0.65 ? 'danfo' : 'keke'; const v = s.addVehicle(kind as any, { x, y: 0.4, z }, ang + Math.PI / 2, true);
    const dr = s.spawnActor('ped', { x: x + Math.cos(ang + Math.PI / 2) * 2.2, y: 0.05, z: z + Math.sin(ang + Math.PI / 2) * 2.2 }, undefined, kind === 'danfo' ? 'Danfo driver' : 'Keke rider');
    Object.assign(dr as any, { _keep: true, _script: true, act: { clip: 'Idle_Loop', yaw: ang } });
    sh.buses.push({ v, driver: dr, fare: kind === 'danfo' ? 500 : 300, until: now + 45_000, paid: false, mood: Math.random() });
    this.ctx.hud.say('Conductor', pick(['Oshodi! Oshodi! Enter with your change!', 'CMS, Obalende! One chance!', 'Ojuelegba, straight!', 'Yaba, Yaba!']), 2.5);
  }
  /** online: a real player driving on duty near your shift; your demand reaches their phone */
  async demand(to: number, name: string) {
    const r = await net.act('social.ticket', { to }); this.ctx.hud.toast('Union', r.ok ? `You asked ${name} for the ticket.` : (r.err ?? 'No.'), r.ok ? 'linear-gradient(160deg,#16a34a,#14532d)' : 'var(--red)', 'msg', 3);
  }
  private demanded(m: { from: string; fromId: number; amount?: number }) {
    const c = this.ctx; const amt = m.amount ?? 300;
    c.hud.call(`${m.from} (agbero)`, `Driver! Ticket, ₦${amt}`, async () => { const r = await net.act('cash.transfer', { to: m.from, amount: amt }); c.hud.toast('Ticket', r.ok ? `You paid ₦${amt}. He waved you through.` : (r.err ?? 'It did not go.'), r.ok ? 'var(--pur)' : 'var(--red)', 'cash', 3); },
      () => c.hud.toast('Ticket', 'You drove off. He is shouting your plate number.', 'var(--pur)', 'msg', 3), 10);
  }
  /** the other side of the levy: you drive on duty into a park, the agbero there wants his ticket */
  private paidAt = new Map<string, number>();
  private asDriver() {
    const T = (window as any).__transport; if (!T?.on || this.shift) return; const me = this.ctx.sim.local; if (me.vehicle === null) return; const v = this.ctx.sim.vehicles[me.vehicle];
    if (Math.abs(v.ctrl.currentVehicleSpeed()) > 6) return; const c = this.ctx;
    for (const p of this.near(35)) { if ((this.paidAt.get(p.id) ?? -1e9) > performance.now() - 300_000) continue; this.paidAt.set(p.id, performance.now());
      const fee = T.kind === 'danfo' ? 500 : T.kind === 'keke' ? 300 : 200;
      c.hud.call('Agbero', `Driver! ${p.name} ticket, ₦${fee}. Drop am!`, () => { if (spend(c, fee)) c.hud.say('Agbero', 'Correct driver. Go well.', 2.5); else c.hud.say('Agbero', 'You no get ₦' + fee + '? Next time o.', 2.5); },
        () => { c.hud.say('Agbero', pick(['You dey form? Oya park there!', 'See this one! I go collect double next time.']), 3); if (Math.random() < 0.5) { const W = (this.ctx.systems.get('wear') as any)?.api; const w = W?.of(v); if (w) { w.body = Math.max(0, w.body - 8); c.hud.toast('Agbero', 'He slapped your side mirror off. Body damage.', 'var(--red)', 'msg', 3.5); } } }, 9);
      return; }
  }
  frame(dt: number) { this.scanT -= dt; if (this.scanT <= 0) { this.scanT = 2; this.scan(); this.chairmen(); this.dressParks(); this.asDriver(); } this.traffic(dt); }
  get onShift() { return !!this.shift; }
}
let A: Agbero | null = null;
export const agberoSystem: GameSystem & { get api(): Agbero | null } = { id: 'agbero', get api() { return A; }, init(ctx) { A = new Agbero(ctx); A.init(); }, start() { A?.start(); }, frame(_c, dt) { A?.frame(dt); }, blips(c, out) { if (!A) return; const me = c.sim.local; for (const p of A.parks.values()) if (Math.abs(p.x - me.pos.x) < 700 && Math.abs(p.z - me.pos.z) < 700) out.push({ x: p.x, z: p.z, c: '#16a34a', r: 6 }); } };
