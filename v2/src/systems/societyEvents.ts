// City events that happen without the player: robberies, police raids, union clashes, market fires, rush hour jams,
// okada bans, fuel queues, strikes, blackouts. Each one moves the economy and the records; when the player is near, the
// scene plays out with real bodies, and every event reaches the phone as news.
import type { GameCtx } from './registry';
import type { NpcCityEvent } from '../content/schema';
import type { Actor } from '../sim/types';
import { Society } from './societyCore';
import { WorldBridge } from './societyWorld';
import { ACT, CELL, ST, cellOf, nameOf, type Citizen } from './societyModel';
import { hash01, hash32 } from './societyData';

interface Active { id: string; def: NpcCityEvent; start: number; end: number; x: number; z: number; area: string; scene: any; vfx: number }
const NEAR = 220;

export class CityEvents {
  active: Active[] = []; lastHour = -1; rushOn = false; lastRushDay = -1; t = 0; count: Record<string, number> = {};
  constructor(private ctx: GameCtx, private soc: Society, private bridge: WorldBridge) {}
  get sim() { return this.ctx.sim; }
  def(id: string) { return this.soc.C.events.find((e) => e.id === 'evt.' + id); }
  pick<T>(a: T[], k: number) { return a[hash32(k, Math.floor(this.soc.minute)) % a.length]; }
  private fillNews(def: NpcCityEvent, a: { area: string; n?: number; victim?: string; amount?: string; site?: string }, k: number) {
    const price = '₦' + Math.round(this.soc.E.p('fuel')).toLocaleString();
    return def.news[hash32(k, 5) % def.news.length].replace('{area}', a.area).replace('{n}', String(a.n ?? 3)).replace('{victim}', a.victim ?? 'a trader').replace('{amount}', a.amount ?? '₦20,000').replace('{site}', a.site ?? 'area').replace('{price}', price);
  }
  /** is the player close enough to see it, or does it concern everybody */
  private near(x: number, z: number, r = 900) { const me = this.sim.local.pos; return Math.hypot(x - me.x, z - me.z) < r; }

  frame(dt: number) {
    const soc = this.soc; this.t += dt;
    const now = soc.minute; const h = Math.floor(now / 60);
    // scheduled: rush hour on weekdays
    const hr = soc.hour; const wk = soc.dow !== 0 && soc.dow !== 6;
    const rush = wk && ((hr >= 7 && hr < 9.6) || (hr >= 16.6 && hr < 19.6)) && !this.has('strike');
    if (rush !== this.rushOn) {
      this.rushOn = rush; const sim = this.sim;
      sim.trafficScale = rush ? 1.55 : 1; sim.trafficSlow = rush ? 0.62 : 1;
      if (rush && this.lastRushDay !== soc.day * 2 + (hr < 12 ? 0 : 1)) { this.lastRushDay = soc.day * 2 + (hr < 12 ? 0 : 1); const d = this.def('rush'); if (d) { soc.news(d.news[0], 'traffic', undefined, undefined, false); if (this.sim.local.vehicle !== null) this.ctx.hud.toast('Go slow', 'Rush hour. Every road is a car park.', 'linear-gradient(160deg,#ff8a5c,#d1452c)', 'car', 4); } }
    }
    if (h !== this.lastHour) { if (this.lastHour >= 0) this.hourly(); this.lastHour = h; }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      this.run(a, dt);
      if (now >= a.end) { this.finish(a); this.active.splice(i, 1); }
    }
  }
  has(id: string) { return this.active.some((a) => a.id === id); }

  // ---------------------------------------------------------------- when things happen
  private hourly() {
    const soc = this.soc; const me = this.sim.local.pos; const pcx = cellOf(me.x), pcz = cellOf(me.z);
    for (const def of soc.C.events) {
      if (def.rate <= 0) continue; const id = def.id.replace('evt.', '');
      let p = def.rate / 24;
      if (id === 'fuel_queue') p *= 1 + Math.max(0, soc.E.macro.fuelScarce) * 12;
      if (id === 'robbery') p *= 0.6 + soc.E.macro.crime * 3;
      if (id === 'union_fight') p *= 1 + soc.stats.poor * 3;
      if (Math.random() > p) continue;
      if (this.has(id) && ['okada_ban', 'fuel_queue', 'strike', 'blackout', 'market_fire'].includes(id)) continue;
      this.start(id, pcx, pcz);
    }
  }
  /** make one happen now (also used by tests and the admin tools) */
  start(id: string, pcx = cellOf(this.sim.local.pos.x), pcz = cellOf(this.sim.local.pos.z), at?: { x: number; z: number; area?: string }): Active | null {
    const soc = this.soc; const def = this.def(id); if (!def) return null;
    const k = hash32(Math.floor(soc.minute), id.length, Math.floor(Math.random() * 1e6));
    let x = at?.x ?? 0, z = at?.z ?? 0, area = at?.area ?? '';
    if (!at) {
      if (def.site) { const l = soc.W.nearest(def.site, pcx + Math.floor(Math.random() * 5 - 2), pcz + Math.floor(Math.random() * 5 - 2), 8); const s = l.length ? l[Math.floor(Math.random() * l.length)] : null; if (!s) return null; x = s.x; z = s.z; }
      else { const a = Math.random() * 6.283, d = 60 + Math.random() * 600; x = this.sim.local.pos.x + Math.cos(a) * d; z = this.sim.local.pos.z + Math.sin(a) * d; }
      area = soc.W.areaName(x, z) || 'Lagos';
    }
    const days = def.days[1] > 0 ? def.days[0] + Math.random() * (def.days[1] - def.days[0]) : 0;
    const dur = days > 0 ? days * 1440 : id === 'robbery' ? 12 : id === 'union_fight' ? 40 : id === 'raid' ? 25 : 60;
    const a: Active = { id, def, start: soc.minute, end: soc.minute + dur, x, z, area, scene: null, vfx: 0 };
    this.active.push(a); this.count[id] = (this.count[id] ?? 0) + 1;
    this.begin(a, k); return a;
  }
  private begin(a: Active, k: number) {
    const soc = this.soc; const E = soc.E; const def = a.def; const sim = this.sim; const near = this.near(a.x, a.z, 700);
    const toast = (title: string, body: string, ic: any = 'siren') => { if (near || ['okada_ban', 'fuel_queue', 'strike', 'blackout'].includes(a.id)) this.ctx.hud.toast(title, body, 'linear-gradient(160deg,#ff8a5c,#d1452c)', ic, 5); };
    switch (a.id) {
      case 'market_fire': {
        if (def.shock) E.shock(def.shock, a.end);
        soc.ban(a.end, (c) => Math.hypot(c.wx - a.x, c.wz - a.z) < 130 && soc.C.occ[c.occ].sites.includes('market'));
        const loss = 2 + Math.floor(Math.random() * 8);
        soc.news(this.fillNews(def, a, k), 'fire', a.x, a.z, true); E.bumpLand(a.x, a.z, -0.01 * loss);
        this.bridge.crowds.push({ x: a.x, z: a.z, r: 28, until: soc.minute + 90, kind: 'gather', tag: 'fire' });
        if (near) toast(def.toast ?? 'Fire', `${a.area} market is burning.`, 'siren');
        if (this.near(a.x, a.z, 320)) sim.events.push({ t: 'explosion', at: { x: a.x, y: 2, z: a.z }, radius: 10 });
        break;
      }
      case 'fuel_queue': {
        if (def.shock) E.shock(def.shock, a.end);
        soc.news(this.fillNews(def, a, k), 'fuel', undefined, undefined, true); toast(def.toast ?? 'Fuel', 'Queues at every station. Prices are up.', 'cash');
        for (const l of soc.W.nearest('fuel', cellOf(this.sim.local.pos.x), cellOf(this.sim.local.pos.z), 6)) this.bridge.crowds.push({ x: l.x, z: l.z, r: 14, until: a.end, kind: 'gather', tag: 'fuel' });
        break;
      }
      case 'okada_ban': {
        if (def.shock) E.shock(def.shock, a.end); sim.banned.add('okada');
        soc.ban(a.end, (c) => soc.C.occ[c.occ].vehicle === 'okada');
        soc.news(this.fillNews(def, a, k), 'law', undefined, undefined, true); toast(def.toast ?? 'Okada ban', 'Riders are off the roads. Fares are climbing.', 'siren');
        break;
      }
      case 'strike': {
        if (def.shock) E.shock(def.shock, a.end);
        soc.ban(a.end, (c) => { const o = soc.C.occ[c.occ]; return o.vehicle === 'danfo' || o.id === 'occ.conductor'; });
        sim.trafficScale = 0.45; soc.news(this.fillNews(def, a, k), 'law', undefined, undefined, true); toast(def.toast ?? 'Strike', 'The danfo are parked. Walk or pay.', 'car');
        break;
      }
      case 'blackout': { if (def.shock) E.shock(def.shock, a.end); soc.news(this.fillNews(def, a, k), 'power', undefined, undefined, false); toast(def.toast ?? 'Power cut', 'NEPA has done it again.', 'siren'); break; }
      case 'robbery': this.beginRobbery(a, k); break;
      case 'raid': this.beginRaid(a, k); break;
      case 'union_fight': this.beginFight(a, k); break;
      default: soc.news(this.fillNews(def, a, k), a.id, a.x, a.z);
    }
  }

  // ---------------------------------------------------------------- scenes
  private cit(a: Actor) { return a.cid !== undefined ? this.soc.get(a.cid) : undefined; }
  /** a free citizen of the right sort near a point, preferring the ones already standing in the world */
  private recruit(x: number, z: number, test: (c: Citizen) => boolean, n: number, spawnAt?: { x: number; z: number }): { c: Citizen; a: Actor }[] {
    const out: { c: Citizen; a: Actor }[] = []; const soc = this.soc;
    const list = soc.nearby(x, z, 260, []).filter((c) => c.st === ST.OK && test(c));
    list.sort((p, q) => (q.body >= 0 ? 1 : 0) - (p.body >= 0 ? 1 : 0) || Math.hypot(p.hx - x, p.hz - z) - Math.hypot(q.hx - x, q.hz - z));
    for (const c of list) {
      if (out.length >= n) break;
      let a = c.body >= 0 ? this.sim.actors[c.body] : null;
      if (!a && spawnAt) a = this.bridge.spawnNear(c, spawnAt.x + out.length * 1.4, spawnAt.z + (out.length % 2) * 1.2);
      if (a && a.alive) out.push({ c, a });
    }
    return out;
  }
  private beginRobbery(a: Active, k: number) {
    const soc = this.soc; const sim = this.sim; const me = sim.local.pos;
    // find a stretch of pavement 50 to 120 m from the player when they are around, else the abstract version
    const near = this.near(a.x, a.z, 160);
    const victimPick = soc.nearby(a.x, a.z, 300, []).filter((c) => c.st === ST.OK && c.m > 4000 && c.age > 20);
    const victim = victimPick.length ? victimPick[k % victimPick.length] : null;
    if (!victim) return;
    const loss = Math.min(victim.m, Math.round((3000 + (k % 17) * 1200) / 500) * 500);
    const thieves = soc.nearby(a.x, a.z, 400, []).filter((c) => c.st === ST.OK && (soc.C.occ[c.occ].role === 'area' || c.occ === soc.C.occIdx.get('occ.hustler')) && c.id !== victim.id);
    const robber = thieves.length ? thieves[k % thieves.length] : null;
    const amount = '₦' + loss.toLocaleString();
    if (near && this.bridge.anchor(a.x, a.z, 90)) {
      const spot = this.bridge.anchor(a.x, a.z, 90)!;
      if (Math.hypot(spot.x - me.x, spot.z - me.z) > 25) {
        const vic = this.bridge.spawnNear(victim, spot.x, spot.z); const r1 = robber ? this.bridge.spawnNear(robber, spot.x + 2, spot.z + 1.2) : null;
        if (vic && r1) {
          const b = sim.brainOf(r1.id); const vb = sim.brainOf(vic.id);
          if (b) { b.kind = 'fight'; b.target = vic.id; } if (vb) { vb.kind = 'flee'; vb.from = { ...r1.pos }; vb.t = 8; }
          const m = this.bridge.minds.get(r1.id); if (m) { m.mode = 'hunt'; m.hunt = 12; m.hostile = true; }
          a.scene = { vic, rob: r1, victim, robber, loss, t: 0, spot };
          if (this.near(a.x, a.z, 220)) this.ctx.hud.toast(a.def.toast ?? 'Robbery', `${nameOf(victim)} is being robbed nearby.`, 'var(--red)', 'siren', 4);
        }
      }
    }
    // the books are settled either way
    victim.m -= loss; if (robber) { robber.m += loss; robber.rep += 2; }
    soc.agg.crime++; soc.news(this.fillNews(a.def, { area: a.area, victim: nameOf(victim), amount }, k), 'crime', a.x, a.z);
  }
  private beginRaid(a: Active, k: number) {
    const soc = this.soc; const sim = this.sim;
    // the crew with the most heat nearby gets raided
    let f: ReturnType<typeof soc.factions.get>; let best = -1;
    for (const x of soc.factions.values()) if (x.type === 'areaboys' && Math.hypot(x.x - a.x, x.z - a.z) < 1400 && x.heat + Math.random() * 0.02 > best) { best = x.heat; f = x; }
    const mem = f ? soc.facMembers(f).filter((c) => c.st === ST.OK) : [];
    const n = Math.min(mem.length, 2 + (k % 3)); const jailed: Citizen[] = [];
    for (let i = 0; i < n; i++) { const c = mem[(hash32(k, i) % mem.length)]; if (c.st === ST.OK) { soc.jail(c, 2 + (i % 3)); c.m = Math.max(0, c.m - 8000); jailed.push(c); } }
    if (f) { f.money *= 0.4; f.heat = 0; a.x = f.x; a.z = f.z; a.area = f.area; }
    const text = this.fillNews(a.def, { area: a.area, n: jailed.length || n, site: 'corner' }, k); soc.news(text, 'police', a.x, a.z);
    if (this.near(a.x, a.z, 260) && jailed.length) {
      // three officers walk in, the crew scatters
      const cops = this.recruit(a.x, a.z, (c) => soc.C.occ[c.occ].role === 'police', 3, { x: a.x, z: a.z });
      for (const o of cops) { this.bridge.crowds.push({ x: a.x, z: a.z, r: 8, until: soc.minute + 20, kind: 'gather', tag: 'raid' }); void o; }
      for (const c of mem) { if (c.body >= 0) { const b = sim.brainOf(c.body); const m = this.bridge.minds.get(c.body); if (b && b.kind === 'citizen') { b.kind = 'flee'; b.from = { x: a.x, y: 0, z: a.z }; b.t = 12; if (m) m.next = sim.time + 14; } } }
      if (this.near(a.x, a.z, 320)) this.ctx.hud.toast(a.def.toast ?? 'Raid', `Police are sweeping ${a.area}.`, 'linear-gradient(160deg,#3b6cff,#1e3fa8)', 'siren', 4);
    }
  }
  private beginFight(a: Active, k: number) {
    const soc = this.soc; const sim = this.sim;
    // two crews that share a stretch: unions first, else area boys
    let fa: ReturnType<typeof soc.factions.get>, fb: ReturnType<typeof soc.factions.get>;
    for (const type of ['union', 'areaboys']) {
      const list = [...soc.factions.values()].filter((f) => f.type === type && Math.hypot(f.x - a.x, f.z - a.z) < 1600).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z));
      if (list.length >= 2) { fa = list[0]; fb = list[1]; break; }
    }
    if (!fa || !fb) { soc.news(this.fillNews(a.def, { area: a.area, n: 4 }, k), 'fight', a.x, a.z); return; }
    a.x = (fa.x + fb.x) / 2; a.z = (fa.z + fb.z) / 2; a.area = fa.area;
    fa.war = fb.war = 1; fa.rival = fb.key; fb.rival = fa.key;
    const A = soc.facMembers(fa).filter((c) => c.st === ST.OK), B = soc.facMembers(fb).filter((c) => c.st === ST.OK);
    const hurt = Math.min(6, 1 + Math.floor(Math.random() * 4));
    soc.news(this.fillNews(a.def, { area: a.area, n: hurt }, k), 'fight', a.x, a.z, true);
    a.scene = { fa, fb, A, B, hurt, brawl: [] as { a: Actor; side: number }[], t: 0 };
    if (this.near(a.x, a.z, 230) && this.bridge.anchor(a.x, a.z, 120)) {
      const sp = this.bridge.anchor(a.x, a.z, 120)!;
      const sa = this.recruit(sp.x, sp.z, (c) => c.fac === fa!.key, 3, { x: sp.x - 3, z: sp.z }); const sb = this.recruit(sp.x, sp.z, (c) => c.fac === fb!.key, 3, { x: sp.x + 3, z: sp.z });
      for (const o of sa) a.scene.brawl.push({ a: o.a, side: 0 }); for (const o of sb) a.scene.brawl.push({ a: o.a, side: 1 });
      this.bridge.crowds.push({ x: sp.x, z: sp.z, r: 14, until: a.end, kind: 'fight', tag: 'fight' });
      if (a.scene.brawl.length) this.ctx.hud.toast(a.def.toast ?? 'Fight', `${fa.name} and ${fb.name} are at it.`, 'linear-gradient(160deg,#ff8a5c,#d1452c)', 'fist', 5);
    }
  }

  private run(a: Active, dt: number) {
    const soc = this.soc; const sim = this.sim; const s = a.scene;
    if (a.id === 'market_fire' && this.near(a.x, a.z, 300)) {
      a.vfx -= dt; if (a.vfx <= 0) { a.vfx = 0.22; this.smoke(a.x + (Math.random() - 0.5) * 14, a.z + (Math.random() - 0.5) * 14); }
    }
    if (!s) return;
    if (a.id === 'robbery') {
      s.t += dt; const vic = s.vic as Actor, rob = s.rob as Actor;
      if (!vic.alive || !rob.alive || (vic as any)._gone || (rob as any)._gone) { a.end = Math.min(a.end, soc.minute); return; }
      if (s.t > 7 && !s.done) { s.done = true; vic.ko = 4; vic.hp = Math.min(vic.hp, vic.maxHp * 0.55); const b = sim.brainOf(rob.id); if (b && b.kind === 'fight' && b.target === vic.id) { b.kind = 'flee'; b.from = { ...vic.pos }; b.t = 14; } }
    }
    if (a.id === 'union_fight') {
      s.t += dt; const B = s.brawl as { a: Actor; side: number }[];
      for (const m of B) { if (!m.a.alive || (m.a as any)._gone) continue; const br = sim.brainOf(m.a.id); if (!br || br.kind === 'fight' && br.target !== null && sim.actors[br.target]?.alive) continue;
        let tgt: Actor | null = null, bd = 1e9; for (const o of B) { if (o.side === m.side || !o.a.alive || (o.a as any)._gone) continue; const d = Math.hypot(o.a.pos.x - m.a.pos.x, o.a.pos.z - m.a.pos.z); if (d < bd) { bd = d; tgt = o.a; } }
        if (tgt && s.t < 32) { br.kind = 'fight'; br.target = tgt.id; const mm = this.bridge.minds.get(m.a.id); if (mm) { mm.mode = 'hunt'; mm.hunt = 20; } }
      }
      if (s.t > 38 && !s.over) { s.over = true; for (const m of B) { const br = sim.brainOf(m.a.id); if (br && br.kind === 'fight') { br.kind = 'flee'; br.from = { x: a.x, y: 0, z: a.z }; br.t = 10; } } this.ctx.hud.toast('Police', 'Sirens. The crowd breaks up.', 'linear-gradient(160deg,#3b6cff,#1e3fa8)', 'siren', 3); }
    }
  }
  private smoke(x: number, z: number) {
    const fx = (this.ctx.view as any).fx; if (!fx?.smoke) return; const T = this.ctx.THREE;
    fx.smoke.emit({ pos: new T.Vector3(x, 1.5, z), vel: new T.Vector3((Math.random() - 0.5) * 1.5, 3 + Math.random() * 3, (Math.random() - 0.5) * 1.5), life: 4, max: 4, size: 3 + Math.random() * 3, color: new T.Color(0.12, 0.1, 0.1), drag: 0.5 });
    if (fx.sparks && Math.random() < 0.5) fx.sparks.emit({ pos: new T.Vector3(x, 1, z), vel: new T.Vector3((Math.random() - 0.5) * 3, 5 + Math.random() * 4, (Math.random() - 0.5) * 3), life: 1.2, max: 1.2, size: 0.18, color: new T.Color(1, 0.45, 0.1), drag: 0.4 });
  }
  private finish(a: Active) {
    const soc = this.soc; const sim = this.sim;
    if (a.id === 'okada_ban') { sim.banned.delete('okada'); soc.news('The okada ban is lifted. Riders are back on the road, cautiously.', 'law', undefined, undefined, true); }
    if (a.id === 'strike') { sim.trafficScale = 1; soc.news('The strike is called off. Danfo are rolling again.', 'law'); }
    if (a.id === 'fuel_queue') soc.news('Fuel queues thin out as supply returns.', 'fuel');
    if (a.id === 'market_fire') soc.news(`Traders return to ${a.area} market, what is left of it.`, 'fire', a.x, a.z);
    if (a.id === 'union_fight' && a.scene) {
      const { fa, fb, A, B, hurt } = a.scene; fa.war = fb.war = 0;
      // casualties: the ones who were on the street lose a few days; the stronger side gains standing
      const all = [...A, ...B]; for (let i = 0; i < hurt && all.length; i++) { const c = all[hash32(i, Math.floor(soc.minute)) % all.length]; if (c.st === ST.OK) soc.hospitalise(c, 1 + (i % 3)); }
      const aw = fa.power + Math.random() * 6 >= fb.power + Math.random() * 6; const win = aw ? fa : fb, lose = aw ? fb : fa; win.power += 2; lose.power = Math.max(0, lose.power - 2); win.money += lose.money * 0.2; lose.money *= 0.8;
      for (const c of (aw ? A : B).slice(0, 4)) c.rep += 4;
    }
  }
  /** rows for the phone: what is going on in the city right now */
  now() { return this.active.map((a) => ({ id: a.id, label: a.def.label, area: a.area, minsLeft: Math.max(0, Math.round(a.end - this.soc.minute)) })); }
}
export { ACT, CELL };
