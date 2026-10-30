// Rent, light and food delivery: the weekly squeeze of Lagos life, on the shared world clock (a game day is 48 real
// minutes, so a week of rent comes round about every five and a half hours of play).
//   Rent    due every Saturday morning. Miss it and the landlord texts; miss two and he changes the padlock until you
//           pay the arrears and a fine at the door.
//   Light   prepaid units. Your bulb, fan and TV use them while you are home at night or the fan is on. At zero,
//           NEPA has taken light: the room goes dark, the fan stops. Buy units on the phone. Some evenings the whole
//           area loses power for a while (the same hours for everybody: it comes from the world clock).
//   Food    the ChopNow app: order a meal, a rider on an okada brings it to wherever you are.
import type { GameCtx, GameSystem } from '../registry';
import type { Actor } from '../../sim/types';
import { registerApp } from '../../ui/lifeHud';
import { lifeSystem } from './index';
import { addMoodlet } from './needs';
import { spend } from '../money';
import { net } from '../../net/client';

interface Bills { rentPaidWeek: number; owed: number; locked: boolean; units: number; lastHour: number; textedWeek: number }
const RENT = 4500, FINE = 2000, UNIT_PRICE = 100;
const MEALS = [{ id: 'jollof', label: 'Jollof rice, chicken, plantain', price: 3200, hunger: 60 }, { id: 'amala', label: 'Amala, ewedu, gbegiri', price: 2400, hunger: 55 }, { id: 'shawarma', label: 'Chicken shawarma', price: 3500, hunger: 45 }, { id: 'suya', label: 'Suya and cold Coke', price: 2800, hunger: 35 }];

class BillsSys {
  B!: Bills; private rider: { a: Actor; meal: (typeof MEALS)[number]; t: number } | null = null; private lightsOn = true; private outageT = 0;
  constructor(private ctx: GameCtx) {}
  get life() { return lifeSystem.api!; }
  /** the world calendar: day number and hour, from the server's clock online, the local sky offline */
  cal() { const A = this.ctx.view.atmo; if (net.active) { const e = net.epochNow / 1000; const h = 7.2 + (e * 30) / 3600; return { day: Math.floor(h / 24), hour: h % 24 }; } return { day: A.day, hour: A.hour }; }
  week() { return Math.floor((this.cal().day + 2) / 7); } // week turns over on Saturday
  init() {
    this.B = Object.assign({ rentPaidWeek: -1, owed: 0, locked: false, units: 30, lastHour: -1, textedWeek: -1 }, this.ctx.save.bills ?? {});
    if (this.B.rentPaidWeek < 0) this.B.rentPaidWeek = this.week(); // first week is on the house (the landlord took two months up front)
    registerApp('ChopNow', 'M4 11h16M5 11a7 7 0 0 1 14 0M3 15h18M8 19h8', 'linear-gradient(160deg,#ff7a45,#e8430e)', () => this.chopHtml());
    registerApp('Home', 'M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6', 'linear-gradient(160deg,#2de0c8,#139a8a)', () => this.homeHtml());
    (window as any).__bills = this;
  }
  private persist() { this.ctx.save.bills = this.B; this.ctx.persist(); }
  private row(b: string, s: string, btns: [string, string][] = []) { return `<div class="row"><b>${b}</b>${s}${btns.map(([id, t]) => `<br><button class="btn" data-app="${id.split(':')[0]}" data-id="${id.split(':').slice(1).join(':')}">${t}</button>`).join('')}</div>`; }
  private homeHtml() {
    const due = this.week() > this.B.rentPaidWeek; const weeks = Math.max(0, this.week() - this.B.rentPaidWeek);
    return this.row('Room 4, Bello Compound', this.B.locked ? '<span style="color:#ff8a94">Padlocked by the landlord. Pay what you owe to get in.</span>' : due ? `Rent due: ${weeks} week${weeks > 1 ? 's' : ''}, ₦${(weeks * RENT + (this.B.locked ? FINE : 0)).toLocaleString()}` : 'Rent paid for this week. Next due Saturday.', due ? [['Home:rent', `Pay ₦${(weeks * RENT + (this.B.locked ? FINE : 0)).toLocaleString()}`]] : [])
      + this.row('Prepaid light', `${Math.round(this.B.units)} units left${this.outage() ? ' · <span style="color:#ff8a94">NEPA don take light for this area</span>' : ''}`, [['Home:units:20', 'Buy 20 units (₦2,000)'], ['Home:units:50', 'Buy 50 units (₦5,000)']]);
  }
  private chopHtml() {
    if (this.rider) return this.row('Your order is on the way', `${this.rider.meal.label}. The rider dey come on okada.`);
    return MEALS.map((m) => this.row(m.label, `₦${m.price.toLocaleString()} · delivered to wherever you are`, [[`ChopNow:${m.id}`, 'Order']])).join('');
  }
  onAction(app: string, id: string) {
    const c = this.ctx;
    if (app === 'Home' && id === 'rent') return this.payRent();
    if (app === 'Home' && id.startsWith('units:')) { const n = +id.slice(6); if (!spend(c, n * UNIT_PRICE)) { c.hud.toast('Light', 'No money for units.', 'var(--red)', 'cash', 3); return true; } this.B.units += n; this.persist(); c.hud.toast('Prepaid meter', `${n} units loaded. Light don come.`, 'linear-gradient(160deg,#facc15,#ca8a04)', 'msg', 3); return true; }
    if (app === 'ChopNow') { const m = MEALS.find((x) => x.id === id); if (!m || this.rider) return true; if (!spend(c, m.price)) { c.hud.toast('ChopNow', 'Payment declined. Your account no get money.', 'var(--red)', 'cash', 3); return true; } this.rider = { a: null as any, meal: m, t: 45 + Math.random() * 30 }; c.hud.toast('ChopNow', `Order placed. Rider go reach you in about ${Math.round(this.rider.t / 10) * 10} seconds.`, 'linear-gradient(160deg,#ff7a45,#e8430e)', 'msg', 4); return true; }
    return false;
  }
  payRent() {
    const c = this.ctx; const weeks = Math.max(0, this.week() - this.B.rentPaidWeek); if (!weeks) return true;
    const total = weeks * RENT + (this.B.locked ? FINE : 0);
    if (!spend(c, total)) { c.hud.toast('Landlord', `You need ₦${total.toLocaleString()}. Go hustle.`, 'var(--red)', 'cash', 3.5); return true; }
    this.B.rentPaidWeek = this.week(); this.B.locked = false; this.persist(); addMoodlet(this.life.needs, 'rentpaid', 'Rent paid, head clear', 6, 6);
    c.hud.toast('Landlord', 'Thank you. See you next Saturday.', 'linear-gradient(160deg,#2de0c8,#139a8a)', 'msg', 3.5); return true;
  }
  /** area blackouts: an hour or two most evenings, the same for everyone because it is a function of the world clock */
  outage() { const { day, hour } = this.cal(); const h = (Math.imul(day + 13, 2654435761) >>> 0) % 100; const start = 18 + (h % 4); const len = 1 + ((h >> 3) % 3); return h < 70 && hour >= start && hour < start + len; }
  frame(dt: number) {
    const c = this.ctx; const L = this.life; if (!L?.started) return; const { hour } = this.cal();
    // rent: text on Saturday morning, padlock after two missed weeks
    const owed = this.week() - this.B.rentPaidWeek;
    if (owed >= 1 && this.B.textedWeek !== this.week()) { this.B.textedWeek = this.week(); c.hud.toast('Landlord', owed >= 2 ? 'Two weeks now. If I no see my money, padlock go enter your door.' : `Rent don due. ₦${RENT.toLocaleString()}. Pay on your phone (Home app).`, 'linear-gradient(160deg,#fb923c,#c2410c)', 'msg', 6); this.persist(); }
    if (owed >= 3 && !this.B.locked) { this.B.locked = true; c.hud.toast('Landlord', 'I don lock your room. Pay everything plus ₦2,000 fine.', 'var(--red)', 'msg', 6); this.persist(); }
    // light: units drain while you are home in the evening or the fan is on
    const home = L.S.inside && !L.venue; const night = hour >= 18.5 || hour < 6.5; const out = this.outage();
    if (home && (night || L.S.fan)) this.B.units = Math.max(0, this.B.units - dt * (0.02 + (L.S.fan ? 0.03 : 0)));
    const on = !(out || this.B.units <= 0);
    if (on !== this.lightsOn) { this.lightsOn = on; for (const l of L.lot.lights) l.visible = on; if (!on && L.S.fan) { L.S.fan = false; } if (home) c.hud.toast(on ? 'Light don come!' : 'NEPA!', on ? 'UP NEPA! The whole compound shout.' : out ? 'NEPA don take light for the whole area.' : 'Your prepaid units don finish. Buy more on the Home app.', on ? 'linear-gradient(160deg,#facc15,#ca8a04)' : 'var(--red)', 'msg', 4); }
    this.outageT += dt; if (this.outageT > 20) { this.outageT = 0; this.persist(); }
    // the ChopNow rider
    const r = this.rider; if (r) {
      r.t -= dt; const me = c.sim.local;
      if (r.t <= 12 && !r.a && !L.inside && me.vehicle === null) { const a = c.sim.spawnActor('ped', { x: me.pos.x + 14, y: 0.05, z: me.pos.z + 6 }, undefined, 'ChopNow rider'); Object.assign(a as any, { _keep: true }); r.a = a; }
      if (r.a && !(r.a as any)._gone) { const b = c.sim.brainOf(r.a.id); const dx = me.pos.x - r.a.pos.x, dz = me.pos.z - r.a.pos.z, d = Math.hypot(dx, dz); (r.a as any)._script = true; r.a.cmd = { ...r.a.cmd, mx: d > 1.6 ? dx / d : 0, mz: d > 1.6 ? dz / d : 0, yaw: Math.atan2(dx, dz), sprint: false } as any; void b; if (d < 2) r.t = Math.min(r.t, 0); }
      if (r.t <= 0 && (r.a || L.inside)) {
        c.hud.say('ChopNow rider', L.inside ? 'Oga, I dey your gate. Come collect.' : 'Your food. Enjoy!', 3); const m = r.meal;
        if (r.a) { (r.a as any)._script = false; (r.a as any)._keep = false; }
        this.rider = null; L.doAction({ id: 'eat', label: `Eating ${m.label.toLowerCase()}`, gain: {}, minutes: 0, secs: 16, give: { hunger: m.hunger, fun: 5 }, clip: 'Consume', spot: [0, 0, 0], fill: 'hunger', moodlet: ['delivered', 'Food came hot', 4, 3] } as any);
      }
    }
  }
  /** called by the life system: may you walk into your room? */
  canEnterHome() { if (!this.B.locked) return true; this.ctx.hud.toast('Padlock', 'The landlord don lock your door. Pay rent and the fine (Home app).', 'var(--red)', 'msg', 4); return false; }
}

let S: BillsSys | null = null;
export const billsSystem: GameSystem & { get api(): BillsSys | null } = {
  id: 'bills',
  get api() { return S; },
  init(ctx) { S = new BillsSys(ctx); S.init(); },
  frame(_c, dt) { S?.frame(dt); },
  onAction(_c, app, id) { return S?.onAction(app, id) ?? false; },
};
