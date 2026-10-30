// The house wears too. Pipes rust and burst, the wiring goes, the roof leaks in the rain, the tank runs dry, and the
// generator coughs. Your room has power when your feeder has light (systems/power.ts) and the wiring holds, or when
// the gen is running on fuel. Water comes from the tank (the pump needs power and whole pipes) or from the mai ruwa's
// jerrycans. Artisans come when you call them (plumber, electrician, roofer, gen repairer), take a game hour or two,
// and fix it; a full renovation does everything and puts fresh paint on the walls. Tuning: content/tuning.json.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import { lifeSystem, type Thing } from './index';
import type { LifeAction } from './objects';
import { addMoodlet } from './needs';
import { HOME_ORIGIN } from './home';
import { spend } from '../money';
import { power, powerShared } from '../power';
import { net } from '../../net/client';
import { worldHours } from '../../net/rules';
import { loadContent } from '../../content/load';
import { registerApp } from '../../ui/lifeHud';
import type { PieItem } from './pie';
import { RT } from '../societyRuntime';

interface Tuning { id: string; pipes: number; wiring: number; roof: number; gen: number; genFuel: number; tankUse: number; burst: number; price: number }
const DEF: Tuning = { id: 'wear.house', pipes: 0.9, wiring: 0.6, roof: 0.5, gen: 2.5, genFuel: 0.6, tankUse: 1, burst: 0.35, price: 1 };
type Artisan = 'plumber' | 'electrician' | 'roofer' | 'genman' | 'renovate';
interface HouseSave {
  pipes: number; wiring: number; roof: number; tank: number; drum: number; burst: boolean; fault: boolean;
  gen: { size: 0 | 1 | 2; fuel: number; cond: number; on: boolean; broken: boolean }; day: number; hour: number;
  jobs: { who: Artisan; at: number }[];
}
const GENS = [null, { name: 'Small gen ("I better pass my neighbour")', price: 180_000, tank: 5, burn: 0.6 }, { name: 'Big 5 kVA gen', price: 650_000, tank: 20, burn: 1.4 }] as const;
const ART: Record<Artisan, { name: string; who: string; cost: number; hrs: number; line: string }> = {
  plumber: { name: 'Plumber', who: 'Baba Plumber', cost: 12_000, hrs: 1, line: 'I don change the pipe. Na original this time.' },
  electrician: { name: 'Electrician', who: 'Oga Electrician', cost: 15_000, hrs: 1, line: 'Na your wiring dey spark. I don rewire am.' },
  roofer: { name: 'Roofer', who: 'Roofer', cost: 20_000, hrs: 2, line: 'Roof don seal. Rain fit fall now.' },
  genman: { name: 'Gen repairer', who: 'Gen repairer', cost: 10_000, hrs: 1, line: 'Plug and carburettor. E go start one time now.' },
  renovate: { name: 'Full renovation', who: 'Contractor', cost: 150_000, hrs: 4, line: 'Everything don new. Fresh paint, new pipes, new wire.' },
};
const WATER: Record<string, number> = { 'bucket.bath': 60, 'sink.brush': 4, 'sink.wash': 6, 'toilet.use': 10, 'stove.cook': 8, 'stove.noodles': 4 };
const NEEDS_POWER = new Set(['tv.watch', 'tv.football', 'fan.toggle']);
const fmt = (n: number) => '₦' + Math.round(n).toLocaleString();

class House {
  H!: HouseSave; T: Tuning = { ...DEF }; private puddle: THREE.Mesh | null = null; private t = 0; private wasPowered: boolean | null = null;
  constructor(private ctx: GameCtx) {}
  get L() { return lifeSystem.api; }
  init() {
    const s = this.ctx.save.house as HouseSave | undefined;
    this.H = s && typeof s.pipes === 'number' ? s : { pipes: 82, wiring: 78, roof: 74, tank: 400, drum: 0, burst: false, fault: false, gen: { size: 0, fuel: 0, cond: 100, on: false, broken: false }, day: -1, hour: -1, jobs: [] };
    registerApp('House', 'M3 11 12 4l9 7M6 10v10h12V10M10 20v-5h4v5', 'linear-gradient(160deg,#38bdf8,#0369a1)', () => this.html());
    void this.tune(); net.on('content', (m: any) => { if (m.kind === 'tuning') void this.tune(); });
    (window as any).__house = this;
  }
  private async tune() { const t = (await loadContent<Tuning>('tuning')).find((x) => x.id === 'wear.house'); if (t) this.T = { ...DEF, ...t }; }
  start() {
    const L = this.L; if (!L) return;
    L.gates.push((a, t) => this.gate(a, t)); L.onBegin.push((a, t) => this.use(a, t));
    L.providers.push(() => this.things());
    L.selfItems.push(() => (L.S.inside && !L.venue && !L.guest ? this.selfItems() : [])); L.selfPick.push((id) => this.onSelf(id));
  }
  private persist() { this.ctx.save.house = this.H; this.ctx.persist(); }
  private hours() { return net.active ? worldHours(net.epochNow) : this.ctx.view.atmo.day * 24 + this.ctx.view.atmo.hour; }
  /** your room has power: the feeder has light and the wiring holds, or the gen is running */
  powered() { const d = this.L?.S.door; const grid = d ? power.on(d.x, d.z) : true; return (grid && !this.H.fault) || this.genRunning(); }
  genRunning() { const g = this.H.gen; return g.size > 0 && g.on && !g.broken && g.fuel > 0; }
  water() { return this.H.drum + (this.H.burst ? 0 : this.H.tank); }
  private atHome(t?: Thing) { const L = this.L; return !!L && L.S.inside && !L.venue && !L.guest && (!t || t.kind === 'object'); }
  private gate(a: LifeAction, t: Thing): string | null {
    if (!this.atHome(t)) return null; const k = `${t.id}.${a.id}`;
    const w = WATER[k] ?? WATER[a.id]; if (w && this.water() < w * this.T.tankUse) return this.H.burst ? 'No water: pipe don burst' : 'No water in the tank';
    if ((NEEDS_POWER.has(k) || NEEDS_POWER.has(a.id)) && !this.powered()) return 'No light';
    return null;
  }
  private use(a: LifeAction, t: Thing) {
    if (!this.atHome(t)) return; const w = (WATER[`${t.id}.${a.id}`] ?? WATER[a.id] ?? 0) * this.T.tankUse; if (!w) return;
    const fromDrum = Math.min(this.H.drum, w); this.H.drum -= fromDrum; this.H.tank = Math.max(0, this.H.tank - (w - fromDrum)); this.persist();
  }

  // ---------------------------------------------------------------- time: the pump, the gen, the slow rot, the artisans
  frame(dt: number) {
    const L = this.L; if (!L?.started) return; this.t -= dt; if (this.t > 0) return; this.t = 1;
    const h = this.hours(); const H = this.H; if (H.hour < 0) { H.hour = h; H.day = Math.floor(h / 24); }
    const dh = Math.max(0, Math.min(6, h - H.hour)); H.hour = h; if (dh <= 0) return;
    const pw = this.powered();
    // the pump fills the tank when there is power and the pipes are whole
    if (pw && !H.burst && H.tank < 1000) H.tank = Math.min(1000, H.tank + dh * 220);
    // the gen burns fuel and wears while it runs
    const g = H.gen; if (this.genRunning()) {
      const spec = GENS[g.size]!; g.fuel = Math.max(0, g.fuel - dh * spec.burn * this.T.genFuel / 0.6); g.cond = Math.max(0, g.cond - dh * this.T.gen);
      if (g.fuel <= 0) { g.on = false; this.say('Gen', 'The gen don off. Fuel don finish.'); }
      else if (g.cond < 30 && Math.random() < dh * 0.08 * (1 - g.cond / 30)) { g.broken = true; g.on = false; this.say('Gen', 'Kpo! The gen don knock. Call the gen repairer.'); }
    }
    // a new day: things rot, sometimes they break
    const day = Math.floor(h / 24);
    if (day !== H.day) {
      H.day = day; const T = this.T; const r = () => 0.6 + Math.random() * 0.8;
      H.pipes = Math.max(0, H.pipes - T.pipes * 4 * r()); H.wiring = Math.max(0, H.wiring - T.wiring * 4 * r()); H.roof = Math.max(0, H.roof - T.roof * 4 * r());
      if (!H.burst && H.pipes < 60 && Math.random() < T.burst * (1 - H.pipes / 100)) { H.burst = true; H.tank = 0; this.say('Compound', 'Pipe don burst! Water dey waste for everywhere. Call plumber.'); }
      if (!H.fault && H.wiring < 45 && Math.random() < 0.3 * (1 - H.wiring / 100)) { H.fault = true; this.say('Compound', 'Your wire don spark. No light for your room even when NEPA bring. Call electrician.'); }
    }
    // artisans finish their jobs
    for (const j of [...H.jobs]) if (h >= j.at) { H.jobs.splice(H.jobs.indexOf(j), 1); this.finish(j.who); }
    // rain through a bad roof
    const rain = (this.ctx.view.atmo as any).rain ?? 0; if (this.atHome() && rain > 0.3 && H.roof < 50) { L.S.needs.v.comfort = Math.max(0, L.S.needs.v.comfort - dh * 6); if (Math.random() < 0.05) this.say('Roof', 'Rain dey enter through the roof. Bucket dey catch am.'); }
    // the room goes dark (or lights up) when the power at home changes
    if (this.wasPowered !== null && pw !== this.wasPowered && this.atHome() && !this.genRunning() && H.fault) this.say('Room', 'Na your wiring. NEPA get light but your room no get.');
    this.wasPowered = pw;
    this.drawPuddle(); this.persist();
    // your building's windows glow when your room has light (your gen, or NEPA with good wiring)
    const d = L.S.door; if (d) powerShared.uHome.value.set(d.x, d.z, 9, pw ? 1 : 0);
  }
  private say(who: string, line: string) { this.ctx.hud.toast(who, line, 'linear-gradient(160deg,#38bdf8,#0369a1)', 'msg', 5); }
  private finish(who: Artisan) {
    const H = this.H; const a = ART[who];
    if (who === 'plumber' || who === 'renovate') { H.pipes = 100; H.burst = false; }
    if (who === 'electrician' || who === 'renovate') { H.wiring = 100; H.fault = false; }
    if (who === 'roofer' || who === 'renovate') H.roof = 100;
    if (who === 'genman') { H.gen.cond = 85; H.gen.broken = false; }
    if (who === 'renovate' && this.L) addMoodlet(this.L.needs, 'renovated', 'Fresh paint, new everything', 12, 30);
    this.say(a.who, a.line); this.persist();
  }
  private drawPuddle() {
    const L = this.L; if (!L) return; const want = this.H.burst;
    if (want && !this.puddle) { const m = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), new THREE.MeshStandardMaterial({ color: 0x5b7fa0, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55 })); m.rotation.x = -Math.PI / 2; m.position.set(-2.6, 0.02, 9.5); m.scale.set(1.5, 0.8, 1); L.lot.group.add(m); this.puddle = m; }
    if (!want && this.puddle) { this.puddle.removeFromParent(); this.puddle.geometry.dispose(); this.puddle = null; }
  }

  // ---------------------------------------------------------------- what you can do: gen, water, call people
  private things(): Thing[] {
    const L = this.L; if (!L || !L.S.door || L.S.inside) return [];
    const d = L.S.door; const me = this.ctx.sim.local; if (Math.hypot(d.x - me.pos.x, d.z - me.pos.z) > 4.5) return [];
    // the gen sits by your door outside, like everybody's
    if (!this.H.gen.size) return [];
    return [{ id: 'gen', name: 'Your generator', x: d.x + Math.cos(d.yaw) * 1.6, z: d.z - Math.sin(d.yaw) * 1.6, yaw: d.yaw, actions: [], kind: 'object', reach: 2.6, verb: this.genRunning() ? 'Generator (running)' : 'Generator', open: () => this.genMenu() }];
  }
  /** the self menu (Z) at home adds these */
  selfItems(): PieItem[] {
    const out: PieItem[] = []; const g = this.H.gen;
    if (g.size) out.push({ id: 'house:gen', label: this.genRunning() ? 'Off the gen' : 'On the gen', hint: g.broken ? 'Broken' : `${g.fuel.toFixed(1)} L fuel`, disabled: g.broken ? 'Broken' : !g.on && g.fuel <= 0 ? 'No fuel' : undefined });
    out.push({ id: 'house:check', label: 'Check the house', hint: this.H.burst ? 'Pipe burst!' : this.H.fault ? 'Wiring fault' : `Water ${Math.round(this.water())} L` });
    return out;
  }
  onSelf(id: string) { if (id === 'house:gen') this.toggleGen(); if (id === 'house:check') { this.ctx.input.releasePointer(); this.ctx.hud.openAppByName('House'); } }
  private genMenu() {
    const L = this.L; if (!L) return; const g = this.H.gen; const fuel = GENS[g.size]!;
    const items: PieItem[] = [
      { id: 'on', label: this.genRunning() ? 'Off the gen' : 'Pull the cord', hint: `Condition ${Math.round(g.cond)}%`, disabled: g.broken ? 'Broken' : !g.on && g.fuel <= 0 ? 'No fuel' : undefined },
      { id: 'fuel', label: `Fill the tank (${fuel.tank} L)`, hint: 'Send a boy to the filling station', cost: this.fuelCost(fuel.tank - g.fuel), disabled: g.fuel >= fuel.tank - 0.1 ? 'Full' : undefined },
    ];
    L.pie.show('Generator', g.broken ? 'It has knocked. Call the gen repairer.' : `${g.fuel.toFixed(1)} of ${fuel.tank} L`, items, { x: innerWidth / 2, y: innerHeight / 2 }, (id) => { if (id === 'on') this.toggleGen(); if (id === 'fuel') this.buyFuel(); });
  }
  private fuelCost(l: number) { const p = RT.soc?.E.p('fuel') ?? 1050; return Math.round(Math.max(0, l) * p + 500); }
  private toggleGen() {
    const g = this.H.gen; if (!g.size || g.broken) return;
    if (this.genRunning()) { g.on = false; this.say('Gen', 'Gen off. Quiet at last.'); this.persist(); return; }
    if (g.fuel <= 0) { this.say('Gen', 'No fuel. Fill the tank first.'); return; }
    // the cord: a worn gen needs a few pulls
    if (Math.random() > 0.35 + 0.65 * (g.cond / 100)) { this.ctx.hud.say('Gen', 'Vrrr... vrr... (it did not catch. Pull again.)', 2); return; }
    g.on = true; this.say('Gen', 'It don start! Light for your room.'); this.persist();
  }
  private buyFuel() { const g = this.H.gen; const spec = GENS[g.size]!; const l = spec.tank - g.fuel; const cost = this.fuelCost(l); if (!spend(this.ctx, cost)) { this.say('Fuel', `You need ${fmt(cost)}.`); return; } g.fuel = spec.tank; this.say('Fuel', `${l.toFixed(1)} L in the tank. ${fmt(cost)} paid.`); this.persist(); }
  private html() {
    const H = this.H; const bar = (label: string, n: number) => `<div style="display:flex;align-items:center;gap:8px;margin-top:5px;font-size:12px"><span style="width:62px">${label}</span><div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden"><i style="display:block;height:100%;width:${Math.round(n)}%;background:${n < 30 ? '#ff4d5e' : n < 55 ? '#f59e0b' : '#2de0c8'}"></i></div><b style="width:34px;text-align:right">${Math.round(n)}%</b></div>`;
    const pending = new Set(H.jobs.map((j) => j.who)); const g = H.gen;
    const btn = (id: string, t: string) => `<button class="btn" data-app="House" data-id="${id}">${t}</button>`;
    const call = (a: Artisan) => pending.has(a) ? `<button class="btn" disabled>${ART[a].name} on the way</button>` : btn(`call:${a}`, `${ART[a].name} (${fmt(ART[a].cost * this.T.price)})`);
    return `<div class="row"><b>Power: ${this.powered() ? (this.genRunning() ? 'gen' : 'NEPA') : 'none'}</b>${H.fault ? '<span style="color:#ff8a94">Wiring fault: no light in the room even when NEPA brings it.</span> ' : ''}${bar('Wiring', H.wiring)}<br>${call('electrician')}</div>
      <div class="row"><b>Water: ${Math.round(this.water())} L</b>${H.burst ? '<span style="color:#ff8a94">Pipe burst: the tank cannot hold water.</span> ' : ''}Tank ${Math.round(H.burst ? 0 : H.tank)} L, jerrycans ${Math.round(H.drum)} L. The pump needs power.${bar('Pipes', H.pipes)}<br>${call('plumber')} ${btn('water', `Mai ruwa: 6 jerrycans (${fmt(1500 * this.T.price)})`)}</div>
      <div class="row"><b>Roof</b>${bar('Roof', H.roof)}<br>${call('roofer')}</div>
      <div class="row"><b>Generator</b>${g.size ? `${GENS[g.size]!.name}. ${g.broken ? 'Broken.' : this.genRunning() ? 'Running.' : 'Off.'} Fuel ${g.fuel.toFixed(1)} L.${bar('Condition', g.cond)}<br>${call('genman')} ${btn('fuel', `Fill fuel (${fmt(this.fuelCost(GENS[g.size]!.tank - g.fuel))})`)}` : `No gen yet.<br>${btn('gen:1', `Buy small gen (${fmt(GENS[1]!.price)})`)} ${btn('gen:2', `Buy 5 kVA (${fmt(GENS[2]!.price)})`)}`}</div>
      <div class="row"><b>Renovation</b>Everything new: pipes, wiring, roof, fresh paint.<br>${call('renovate')}</div>`;
  }
  onAction(app: string, id: string) {
    if (app !== 'House') return false; const c = this.ctx; const H = this.H;
    if (id.startsWith('call:')) { const a = id.slice(5) as Artisan; const cost = ART[a].cost * this.T.price; if (H.jobs.some((j) => j.who === a)) return true; if (!spend(c, cost)) { this.say(ART[a].who, `Na ${fmt(cost)} o. Call me when you get am.`); return true; } H.jobs.push({ who: a, at: this.hours() + ART[a].hrs }); this.say(ART[a].who, `I dey come. Give me ${ART[a].hrs} hour${ART[a].hrs > 1 ? 's' : ''}.`); this.persist(); c.hud.refreshApp(); return true; }
    if (id === 'water') { if (!spend(c, 1500 * this.T.price)) return true; H.drum = Math.min(300, H.drum + 150); this.say('Mai ruwa', 'Six jerrycans, ₦1,500. Allah ya kiyaye.'); this.persist(); c.hud.refreshApp(); return true; }
    if (id === 'fuel') { this.buyFuel(); c.hud.refreshApp(); return true; }
    if (id.startsWith('gen:')) { const n = +id.slice(4) as 1 | 2; const spec = GENS[n]!; if (!spend(c, spec.price)) { this.say('Gen seller', 'Bring complete money.'); return true; } H.gen = { size: n, fuel: 2, cond: 100, on: false, broken: false }; this.say('Gen seller', `${spec.name}. It sits by your door. Two litres to start you off.`); this.persist(); c.hud.refreshApp(); return true; }
    return false;
  }
}
let HS: House | null = null;
export const houseSystem: GameSystem & { get api(): House | null } = {
  id: 'house', get api() { return HS; },
  init(ctx) { HS = new House(ctx); HS.init(); }, start() { HS?.start(); }, frame(_c, dt) { HS?.frame(dt); },
  onAction(_c, app, id) { return HS?.onAction(app, id) ?? false; },
};
