// Nemesis system for every citizen: people remember what you did to them, and what they did to you.
// Grudges and loyalty, taunts that name the place and the thing, scars, promotions when they beat you, revenge ambushes,
// rivals who come back from the dead, betrayals. State is self contained per person and lives in the save under `nemesis`.
import type { GameSystem, GameCtx } from './registry';
import type { SimEvent, Actor } from '../sim/types';
import type { NemesisMemory } from '../content/schema';
import { RT } from './societyRuntime';
import { ACT, ST, nameOf, rankLabel, type Citizen } from './societyModel';
import { hash01, hash32 } from './societyData';

export interface NemRec { c: Citizen; mem: NemesisMemory[]; hate: number; love: number; fear: number; wins: number; returned: number; revive: number; ambushAt: number; lastMin: number; lastX: number; lastZ: number; lastPlace: string; talk: number; betrayed: number; sold: number }

/** weight into hate (+) or love (-) for each kind of memory */
const KIND: Record<string, { hate: number; love: number; fear: number; text: string }> = {
  hurt: { hate: 0.22, love: 0, fear: 0, text: 'You hit {him}.' },
  beaten: { hate: 0.4, love: 0, fear: 0.1, text: 'You knocked {him} down.' },
  robbed: { hate: 0.5, love: 0, fear: 0.1, text: 'You robbed {him}{item}.' },
  carjacked: { hate: 0.6, love: 0, fear: 0.1, text: 'You took {his} {item}.' },
  killed_kin: { hate: 0.9, love: 0, fear: 0, text: 'You killed {his} {item}.' },
  survived: { hate: 0.3, love: 0, fear: 0, text: '{He} survived you.' },
  witnessed: { hate: 0.05, love: 0, fear: 0.5, text: '{He} saw what you did.' },
  helped: { hate: -0.2, love: 0.45, fear: 0, text: 'You helped {him}.' },
  tipped: { hate: -0.1, love: 0.22, fear: 0, text: 'You gave {him} money.' },
  beat_you: { hate: 0.2, love: 0, fear: 0, text: '{He} put you down.' },
  betrayed: { hate: 0.7, love: -0.6, fear: 0, text: '{He} sold you out.' },
  returned: { hate: 0.25, love: 0, fear: 0, text: '{He} came back from the dead.' },
  arrested: { hate: 0.2, love: 0, fear: 0, text: '{He} arrested you.' },
  met: { hate: 0, love: 0.02, fear: 0, text: 'You crossed paths.' },
};
const EPITHET: Record<string, string[]> = {
  win: ['Hammer', 'Undertaker', 'Closer', 'Wolf', 'Butcher', 'Last Word'],
  survived: ['Nine Lives', 'Survivor', 'Stubborn', 'Last Man'],
  returned: ['Twice-Born', 'Dead Man', 'Comeback', 'Ashes'],
  betrayed: ['Two-Face', 'Judas'],
  robbed: ['No Forgive', 'Debt Collector'],
  carjacked: ['Bike Thief Hunter', 'Mileage'],
};
const pron = (f: boolean) => f ? { He: 'She', he: 'she', his: 'her', him: 'her' } : { He: 'He', he: 'he', his: 'his', him: 'him' };

export class Nemesis {
  recs = new Map<number, NemRec>();
  private recogT = 0; private lastHour = -1; private lastDay = -1; private hits = new Map<number, { t: number; hp: number; recorded: boolean; ko: boolean }>(); lastAmbush = -9999;
  private told = new Map<number, number>(); private ambushers: number[] = []; private soldQueue: { c: Citizen; at: number }[] = [];
  constructor(private ctx: GameCtx) {}
  get soc() { return RT.soc!; } get bridge() { return RT.bridge!; } get sim() { return this.ctx.sim; }

  // ---------------------------------------------------------------- records
  rec(c: Citizen, create = true): NemRec | undefined {
    let r = this.recs.get(c.id);
    if (!r && create) {
      r = { c, mem: [], hate: 0, love: 0, fear: 0, wins: 0, returned: 0, revive: 0, ambushAt: 0, lastMin: 0, lastX: c.hx, lastZ: c.hz, lastPlace: '', talk: -999, betrayed: 0, sold: 0 };
      this.recs.set(c.id, r); c.nem = true; if (this.recs.size > 320) this.prune();
    }
    return r;
  }
  private prune() {
    let worst: NemRec | undefined, ws = 1e9;
    for (const r of this.recs.values()) { const s = Math.max(r.hate, r.love) + r.c.rank * 0.2 + r.wins * 0.3; if (s < ws) { ws = s; worst = r; } }
    if (worst) { worst.c.nem = false; this.recs.delete(worst.c.id); }
  }
  isEnemy(r: NemRec) { return r.hate > 0.3 && r.hate >= r.love; }
  isAlly(r: NemRec) { return r.love > 0.3 && r.love > r.hate; }
  here(x: number, z: number) { return RT.placeName?.(x, z) ?? this.soc.W.areaName(x, z) ?? 'Lagos'; }

  remember(c: Citizen, kind: string, at?: { x: number; z: number }, note = '', mult = 1) {
    const K = KIND[kind]; if (!K) return;
    const r = this.rec(c)!; const soc = this.soc;
    const x = at?.x ?? c.hx, z = at?.z ?? c.hz; const place = this.here(x, z);
    const vengeful = c.tr.some((t) => soc.C.traits[t]?.vengeful); const forgive = c.tr.some((t) => soc.C.traits[t]?.id === 'trait.forgiving');
    const gain = K.hate * mult * (K.hate > 0 ? (vengeful ? 1.3 : forgive ? 0.65 : 1) * (0.7 + c.ag * 0.6) : 1);
    r.hate = Math.max(0, Math.min(1, r.hate + gain)); r.love = Math.max(0, Math.min(1, r.love + K.love * mult * (0.8 + c.lo * 0.4)));
    if (K.hate > 0.15 && K.love === 0) r.love = Math.max(0, r.love - 0.2);
    if (K.love > 0.15) r.hate = Math.max(0, r.hate - 0.25);
    r.fear = Math.max(0, Math.min(1, r.fear + K.fear * mult * (1.2 - c.co)));
    const last = r.mem[r.mem.length - 1];
    if (last && last.k === kind && soc.minute - (last.day * 1440 + 0) < 0) { /* never */ }
    if (last && last.k === kind && (soc.day - last.day) === 0 && kind === 'hurt') { last.w = Math.min(1, last.w + 0.1); }
    else { r.mem.push({ k: kind, day: soc.day, at: place, w: K.hate + K.love, note }); if (r.mem.length > 14) r.mem.splice(0, r.mem.length - 14 + 1); }
    r.lastMin = soc.minute; r.lastX = x; r.lastZ = z; r.lastPlace = place;
    // a nickname once they matter
    if (!c.nick && (r.hate > 0.55 || r.love > 0.6)) this.nickname(c, kind);
  }
  nickname(c: Citizen, kind: string) {
    const pool = EPITHET[kind === 'beat_you' ? 'win' : kind] ?? EPITHET.robbed; c.nick = pool[hash32(c.id, kind.length) % pool.length];
  }
  memText(m: NemesisMemory, c: Citizen) {
    const K = KIND[m.k]; const p = pron(c.female); let t = (K?.text ?? m.k);
    t = t.replace('{item}', m.note ? (m.k === 'robbed' ? ` (${m.note})` : m.k === 'killed_kin' ? m.note : m.note) : m.k === 'carjacked' ? 'ride' : '').replace(/\{(He|he|his|him)\}/g, (_, k) => (p as any)[k]);
    return `${t} ${m.at ? m.at + ', day ' + m.day : 'Day ' + m.day}.`;
  }

  // ---------------------------------------------------------------- lines
  private fill(t: string, c: Citizen, r: NemRec, mem?: NemesisMemory) {
    const soc = this.soc; const main = mem ?? this.main(r);
    return t.replace(/\{place\}/g, main?.at || c.area).replace(/\{Name\}/g, c.first).replace(/\{rank\}/g, rankLabel(soc.C, c)).replace(/\{area\}/g, c.area)
      .replace(/\{item\}/g, main?.note || 'ride').replace(/\{rel\}/g, main?.note || 'brother');
  }
  main(r: NemRec): NemesisMemory | undefined { let b: NemesisMemory | undefined; for (const m of r.mem) if ((KIND[m.k]?.hate ?? 0) > 0 && (!b || m.w >= b.w)) b = m; return b ?? r.mem[r.mem.length - 1]; }
  line(c: Citizen, r: NemRec, when: string, mem?: NemesisMemory) {
    const soc = this.soc; const list = (soc.C.taunts.get(when) ?? []);
    const fac = c.fac ? c.fac.split(':')[0] : ''; const spec = list.filter((t) => t.faction && (t.faction === fac || (t.faction === 'okada' && soc.C.occ[c.occ].vehicle === 'okada')));
    const pool = spec.length && hash01(c.id, 3) < 0.6 ? spec : list.filter((t) => !t.faction);
    if (!pool.length) return '';
    const set = pool[hash32(c.id, soc.day, when.length) % pool.length]; const l = set.lines[hash32(c.id, Math.floor(soc.minute / 60)) % set.lines.length];
    return this.fill(l, c, r, mem);
  }
  say(c: Citizen, text: string) { if (text) this.ctx.hud.say(c.nick ? `${c.first} "${c.nick}"` : nameOf(c), text, 4.2); }

  // ---------------------------------------------------------------- sim events
  onEvent(e: SimEvent) {
    const sim = this.sim; const soc = this.soc; const me = sim.local;
    if (e.t === 'hit' && e.by === me.id && e.targetKind === 'actor') {
      const a = sim.actors[e.target]; if (!a || a.role === 'player') return;
      let c = a.cid !== undefined ? soc.get(a.cid) : undefined; if (!c) c = this.bridge.adoptActor(a); if (!c) return;
      let h = this.hits.get(c.id); if (!h) { h = { t: sim.time, hp: a.hp, recorded: false, ko: false }; this.hits.set(c.id, h); }
      h.t = sim.time; h.hp = a.hp;
      if (!h.recorded || sim.time - (this.told.get(-c.id) ?? -99) > 45) { this.told.set(-c.id, sim.time); h.recorded = true; this.remember(c, 'hurt', a.pos); }
    }
    if (e.t === 'hit' && e.by !== me.id && e.target === me.id) { /* somebody hurt you; their win is recorded when you go down */ }
    if (e.t === 'kill') {
      const v = sim.actors[e.victim]; const killer = e.killer !== null ? sim.actors[e.killer] : null;
      if (v?.role === 'player') { // the player went down: whoever was fighting you counts it
        const kc = killer?.cid !== undefined ? soc.get(killer.cid) : undefined; if (kc) this.beatPlayer(kc, killer!);
      } else if (v && v.cid !== undefined) {
        const c = soc.get(v.cid); if (c) this.died(c, v, killer);
      } else if (v && killer?.role === 'player') { const c = this.bridge.adoptActor(v); if (c) this.died(c, v, killer); }
    }
    if (e.t === 'enterVehicle' && e.jack && e.victim !== undefined) {
      const v = sim.actors[e.victim]; const c = v?.cid !== undefined ? soc.get(v.cid) : undefined; const veh = sim.vehicles[e.vehicle];
      if (c && veh) {
        const own = soc.C.occ[c.occ].vehicle === veh.kind; const item = veh.kind === 'okada' ? 'okada' : veh.kind === 'danfo' ? 'danfo' : veh.kind === 'keke' ? 'keke' : 'car';
        this.remember(c, 'carjacked', veh.body.translation(), item, own ? 1.4 : 1);
        if (own) { c.veh = 0; c.m = Math.max(0, c.m - 20000); soc.news(`${c.first} ${c.last} lost ${pron(c.female).his} ${item} to a carjacker at ${this.here(v.pos.x, v.pos.z)}.`, 'crime', v.pos.x, v.pos.z); }
        this.witnesses(v.pos, c);
      }
    }
  }
  private witnesses(at: { x: number; z: number }, except: Citizen) {
    const near = this.soc.nearby(at.x, at.z, 28, []).filter((c) => c.id !== except.id && c.body >= 0 && c.st === ST.OK).slice(0, 4);
    for (const c of near) this.remember(c, 'witnessed', at);
  }
  private died(c: Citizen, a: Actor, killer: Actor | null) {
    const soc = this.soc; const byPlayer = killer?.role === 'player';
    soc.kill(c, killer?.name ?? 'someone');
    if (!byPlayer) return;
    const r = this.rec(c)!; this.remember(c, 'hurt', a.pos, '', 0.2);
    this.witnesses(a.pos, c);
    // family takes it personally
    for (let i = 0; i < c.rel.length; i += 2) {
      if (c.rel[i + 1] > 1) continue; const k = soc.get(c.rel[i]); if (!k || k.st === ST.DEAD) continue;
      const rel = this.relName(c, k);
      this.remember(k, 'killed_kin', a.pos, rel);
    }
    // somebody who matters may not stay dead
    const legend = r.hate > 0.35 || c.rank >= 2 || c.tr.some((t) => soc.C.traits[t]?.vengeful);
    if (legend && hash01(c.id, soc.day, 41) < 0.6 && c.rank >= 1 || r.hate > 0.5) { r.revive = soc.minute + 1440 * (1 + Math.floor(hash01(c.id, 42) * 3)); }
    soc.news(`${nameOf(c)} was killed at ${this.here(a.pos.x, a.pos.z)}. ${r.revive ? 'Some say it is not over.' : ''}`.trim(), 'crime', a.pos.x, a.pos.z, true);
    this.hits.delete(c.id);
  }
  relName(dead: Citizen, kin: Citizen) {
    const dif = kin.age - dead.age; const rel = dead.rel.indexOf(kin.id);
    if (rel >= 0 && dead.rel[rel + 1] === 1) return kin.female ? 'wife' : 'husband';
    if (dif > 14) return kin.female ? 'mother' : 'father';
    if (dif < -14) return kin.female ? 'daughter' : 'son';
    return kin.female ? 'sister' : 'brother';
  }
  private beatPlayer(c: Citizen, a: Actor) {
    const soc = this.soc; const r = this.rec(c)!; r.wins++;
    this.remember(c, 'beat_you', a.pos);
    const before = soc.rankName(c); const up = soc.forcePromote(c); c.gear = Math.min(3, Math.max(c.gear, c.rank >= 2 ? 2 : 1) + (r.wins > 1 ? 1 : 0)); c.scars = Math.max(0, c.scars - 0.05);
    this.nickname(c, 'beat_you');
    if (up) { this.ctx.hud.toast('Somebody moved up', `${nameOf(c)} is now ${soc.rankName(c)} (was ${before}). You made them.`, 'var(--red)', 'siren', 6); this.say(c, this.line(c, r, 'promoted')); }
    soc.news(`${nameOf(c)} ${up ? 'rises to ' + soc.rankName(c) : 'is feared'} at ${c.area} after putting a stranger down.`, 'faction', a.pos.x, a.pos.z);
  }

  // ---------------------------------------------------------------- per frame
  frame(dt: number) {
    const sim = this.sim; const soc = this.soc; const me = sim.local;
    this.recogT -= dt;
    if (this.recogT <= 0) { this.recogT = 1.1; this.recognise(); this.survivors(); }
    const h = Math.floor(soc.minute / 60);
    if (h !== this.lastHour) { if (this.lastHour >= 0) this.hourly(); this.lastHour = h; }
    const d = soc.day; if (d !== this.lastDay) { if (this.lastDay >= 0) this.daily(); this.lastDay = d; }
    // a sold-out player is found by police a while later
    for (let i = this.soldQueue.length - 1; i >= 0; i--) { const s = this.soldQueue[i]; if (soc.minute >= s.at && me.alive) { sim.wanted = Math.max(sim.wanted, 2); sim.lastSeen = sim.time; this.ctx.hud.toast('Police are looking for you', `${nameOf(s.c)} gave them your description.`, 'var(--red)', 'siren', 6); this.soldQueue.splice(i, 1); } }
  }
  private survivors() {
    const sim = this.sim; const me = sim.local;
    for (const [id, h] of this.hits) {
      const c = this.soc.get(id); if (!c) { this.hits.delete(id); continue; }
      const a = c.body >= 0 ? sim.actors[c.body] : null;
      if (a && a.alive && a.ko! > 0 && !h.ko) { h.ko = true; this.remember(c, 'beaten', a.pos); }
      if (sim.time - h.t > 25) {
        if (c.st !== ST.DEAD) { const far = !a || Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) > 35; if (far && h.hp < 70 && h.recorded) this.survived(c, h); }
        this.hits.delete(id);
      }
    }
  }
  private survived(c: Citizen, h: { hp: number }) {
    const r = this.rec(c)!; this.remember(c, 'survived', { x: c.hx, z: c.hz }); c.scars = Math.min(1, c.scars + 0.22 + (100 - h.hp) / 400);
    if (c.rank >= 3 || c.scars > 0.7) c.face = Math.max(c.face, 1);
    if (r.hate > 0.5 && !c.nick) this.nickname(c, 'survived');
    this.refreshLook(c);
  }
  /** a changed face: rebuild the model if they are standing in front of you */
  refreshLook(c: Citizen) {
    if (c.body < 0) return; const a = this.sim.actors[c.body]; if (!a) return;
    a.look.scars = c.scars; a.look.facePaint = (['none', 'tribal', 'skull', 'ash'] as const)[Math.min(3, c.face)];
    const v = this.ctx.view.actors.get(a.id); if (v) { v.view.dispose(); this.ctx.view.actors.delete(a.id); }
  }

  // ---------------------------------------------------------------- recognition: taunts, greetings, backup
  private recognise() {
    const sim = this.sim; const soc = this.soc; const me = sim.local; if (!me.alive) return;
    const P = me.vehicle !== null ? sim.vehicles[me.vehicle].body.translation() : me.pos;
    for (const a of sim.actors) {
      if (a.cid === undefined || !a.alive || (a as any)._gone || a.role === 'player') continue;
      const r = this.recs.get(a.cid); if (!r) continue;
      const c = r.c; const d = Math.hypot(a.pos.x - P.x, a.pos.z - P.z); if (d > 30) continue;
      const m = this.bridge.minds.get(a.id); const b = sim.brainOf(a.id); if (!m || !b) continue;
      r.lastMin = soc.minute; r.lastX = a.pos.x; r.lastZ = a.pos.z;
      if (soc.minute - r.talk < 90) { this.backup(a, c, r, b, P); continue; }
      if (this.isEnemy(r) && b.kind !== 'fight' && b.kind !== 'flee') {
        if (!sim.phys.lineOfSight({ x: a.pos.x, y: a.pos.y + 1.5, z: a.pos.z }, { x: P.x, y: P.y + 1.3, z: P.z })) continue;
        r.talk = soc.minute; const line = this.line(c, r, this.whenOf(r)); this.say(c, line);
        const nerve = c.co * 0.55 + c.ag * 0.4 + r.hate * 0.6 + c.rank * 0.06 + (c.gear >= 2 ? 0.2 : 0) - r.fear * 0.35;
        if (nerve > 0.85 || soc.C.occ[c.occ].role === 'area') { b.kind = soc.C.occ[c.occ].role === 'police' ? 'police' : 'fight'; b.target = me.id; m.mode = 'hunt'; m.hostile = true; m.hunt = 40; this.bridge.callCrew(c, me); }
        else { b.kind = 'flee'; b.from = { ...me.pos }; b.t = 8; r.ambushAt = Math.min(r.ambushAt || soc.minute + 120, soc.minute + 120); }
      } else if (this.isAlly(r) && d < 14) {
        r.talk = soc.minute; this.say(c, this.line(c, r, 'ally_greet', r.mem.find((x) => x.k === 'helped' || x.k === 'tipped')));
      } else if (r.fear > 0.35 && r.hate < 0.3 && d < 18 && b.kind === 'citizen') {
        r.talk = soc.minute; this.say(c, this.line(c, r, 'fear')); b.kind = 'flee'; b.from = { ...me.pos }; b.t = 7;
      }
    }
  }
  private whenOf(r: NemRec) {
    const m = this.main(r); if (!m) return 'met';
    if (m.k === 'killed_kin' || m.k === 'carjacked' || m.k === 'robbed' || m.k === 'beaten' || m.k === 'survived' || m.k === 'returned' || m.k === 'betrayed' || m.k === 'beat_you') return m.k === 'beaten' ? 'hurt' : m.k;
    return 'hurt';
  }
  /** allies join your fights */
  private backup(a: Actor, c: Citizen, r: NemRec, b: any, P: { x: number; z: number }) {
    if (!this.isAlly(r) || b.kind === 'fight') return; const sim = this.sim; const me = sim.local;
    if (sim.time - me.lastHurt > 4) return;
    let tgt: Actor | null = null, bd = 25;
    for (const o of sim.actors) { if (!o.alive || o.id === a.id || o.role === 'player' || (o as any)._gone) continue; const ob = sim.brainOf(o.id); if (ob?.kind === 'fight' && ob.target === me.id) { const d = Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z); if (d < bd) { bd = d; tgt = o; } } }
    if (!tgt) return; b.kind = 'fight'; b.target = tgt.id; const m = this.bridge.minds.get(a.id); if (m) { m.hunt = 25; m.mode = 'hunt'; }
    if (this.soc.minute - r.talk > 5) { r.talk = this.soc.minute; this.say(c, this.line(c, r, 'ally_join')); }
    void P;
  }

  // ---------------------------------------------------------------- hourly and daily
  private hourly() {
    const soc = this.soc; const sim = this.sim; const me = sim.local; const now = soc.minute;
    // revivals
    for (const r of this.recs.values()) {
      if (r.revive && now >= r.revive && r.c.st === ST.DEAD) this.revive(r);
    }
    // revenge: one ambush at most every few hours, never while you are already in trouble
    if (!me.alive || sim.wanted > 0 || now - this.lastAmbush < 360) return;
    const cands = [...this.recs.values()].filter((r) => this.isEnemy(r) && r.c.st === ST.OK && r.c.body < 0 && now >= r.ambushAt && r.hate > 0.42);
    if (!cands.length) return;
    let pick: NemRec | undefined, ps = 0;
    for (const r of cands) { const s = r.hate * (r.c.tr.some((t) => soc.C.traits[t]?.vengeful) ? 1.6 : 1) * (0.5 + r.c.ag) * (0.6 + r.c.co * 0.6); if (hash01(r.c.id, Math.floor(now / 60)) < 0.18 * s && s > ps) { ps = s; pick = r; } }
    if (pick) this.ambush(pick);
  }
  ambush(r: NemRec): boolean {
    const sim = this.sim; const soc = this.soc; const me = sim.local; const c = r.c; const o = soc.C.occ[c.occ];
    r.ambushAt = soc.minute + 600;
    if (o.role === 'police') { // a cop with a grudge does not ambush: he writes your name on a list
      sim.wanted = Math.max(sim.wanted, 1); sim.lastSeen = sim.time; this.ctx.hud.toast('Wanted', `${rankLabel(soc.C, c)} ${c.last} has a file on you.`, 'var(--red)', 'siren', 6); this.lastAmbush = soc.minute; return true;
    }
    const P = me.vehicle !== null ? sim.vehicles[me.vehicle].body.translation() : me.pos;
    const spot = this.spotAround(P, 42, 78); if (!spot) { r.ambushAt = soc.minute + 90; return false; }
    c.gear = Math.max(c.gear, c.rank >= 2 ? 2 : 1);
    const lead = this.bridge.spawnNear(c, spot.x, spot.z); if (!lead) { r.ambushAt = soc.minute + 90; return false; }
    this.makeHunt(lead, c);
    // the crew: faction mates and relatives who are not busy
    let crew = 0;
    const pool = soc.nearby(c.hx, c.hz, 700, []).filter((z) => z.id !== c.id && z.body < 0 && z.st === ST.OK && z.age < 55 && (z.fac === c.fac && c.fac !== '' || c.rel.includes(z.id)));
    for (const z of pool) {
      if (crew >= 3) break; if (hash01(z.id, soc.day, 51) > 0.35 + z.lo * 0.6) continue;
      const s2 = this.spotAround(spot, 3, 9) ?? spot; const a2 = this.bridge.spawnNear(z, s2.x, s2.z); if (a2) { this.makeHunt(a2, z); crew++; }
    }
    this.lastAmbush = soc.minute; this.ambushers = [c.id];
    this.say(c, this.line(c, r, 'ambush'));
    this.ctx.hud.toast('Somebody found you', `${nameOf(c)}${c.nick ? ' "' + c.nick + '"' : ''} is not here to talk.${crew ? ' He came with friends.' : ''}`, 'var(--red)', 'siren', 5);
    return true;
  }
  private makeHunt(a: Actor, c: Citizen) {
    const b = this.sim.brainOf(a.id); const m = this.bridge.minds.get(a.id); if (!b) return;
    b.kind = 'fight'; b.target = this.sim.local.id; if (m) { m.mode = 'hunt'; m.hostile = true; m.hunt = 60; }
    void c;
  }
  private spotAround(P: { x: number; z: number }, r0: number, r1: number) {
    for (let i = 0; i < 14; i++) { const ang = Math.random() * 6.283, d = r0 + Math.random() * (r1 - r0); const an = this.bridge.anchor(P.x + Math.cos(ang) * d, P.z + Math.sin(ang) * d, 40); if (an) { const dd = Math.hypot(an.x - P.x, an.z - P.z); if (dd > r0 * 0.8) return { x: an.x, z: an.z }; } }
    return null;
  }
  revive(r: NemRec) {
    const soc = this.soc; const c = r.c; r.revive = 0; r.returned++;
    c.st = ST.OK; soc.deaths.delete(c.id); c.body = -1; c.scars = Math.min(1, c.scars + 0.35); c.face = Math.max(c.face, 3); c.gear = Math.min(3, c.gear + 1); c.rep += 20;
    this.nickname(c, 'returned'); c.rank = Math.min(c.rank + (c.fac ? 1 : 0), c.fac ? (soc.C.factions.get(c.fac.split(':')[0])?.ranks.length ?? 1) - 1 : 0);
    this.remember(c, 'returned', { x: c.hx, z: c.hz });
    r.hate = Math.min(1, r.hate + 0.15); r.ambushAt = soc.minute + 120;
    soc.news(`${nameOf(c)} "${c.nick}" has been seen in ${c.area}. People who buried ${pron(c.female).him} are nervous.`, 'crime', c.hx, c.hz, true);
    if (Math.hypot(c.hx - this.sim.local.pos.x, c.hz - this.sim.local.pos.z) < 1200) this.ctx.hud.toast('He is back', `${nameOf(c)} "${c.nick}" was supposed to be dead.`, 'var(--red)', 'siren', 6);
  }
  private daily() {
    const soc = this.soc; const sim = this.sim;
    for (const r of this.recs.values()) {
      const vengeful = r.c.tr.some((t) => soc.C.traits[t]?.vengeful);
      r.hate = Math.max(0, r.hate - (vengeful ? 0.003 : 0.012)); r.love = Math.max(0, r.love - 0.006); r.fear = Math.max(0, r.fear - 0.01);
      // allies who are slippery and greedy sell you out when it pays
      if (this.isAlly(r) && r.c.st === ST.OK && !r.betrayed && r.c.lo < 0.38 && r.c.gr > 0.5 && hash01(r.c.id, soc.day, 61) < 0.08 + (sim.wanted > 0 ? 0.1 : 0)) this.betray(r);
    }
  }
  private betray(r: NemRec) {
    const c = r.c; const soc = this.soc; r.betrayed++;
    this.remember(c, 'betrayed', { x: c.hx, z: c.hz }); r.love = 0; r.hate = Math.max(r.hate, 0.65);
    this.soldQueue.push({ c, at: soc.minute + 20 }); this.nickname(c, 'betrayed');
    this.ctx.hud.toast('Betrayed', `${nameOf(c)} has gone to the police about you.`, 'var(--red)', 'msg', 6);
  }

  // ---------------------------------------------------------------- player interactions (F)
  /** the closest citizen within reach, preferring whoever you are facing */
  target(maxD = 3.2): { a: Actor; c: Citizen } | null {
    const me = this.sim.local; let best: { a: Actor; c: Citizen } | null = null, bs = 1e9;
    if (me.vehicle !== null) return null;
    for (const a of this.sim.actors) {
      if (a.cid === undefined || !a.alive || a.vehicle !== null || (a as any)._gone) continue;
      const dx = a.pos.x - me.pos.x, dz = a.pos.z - me.pos.z, d = Math.hypot(dx, dz); if (d > maxD) continue;
      const facing = (dx * Math.sin(me.yaw) + dz * Math.cos(me.yaw)) / (d || 1); if (facing < 0.25) continue;
      const s = d - facing; if (s < bs) { const c = this.soc.get(a.cid); if (c) { bs = s; best = { a, c }; } }
    }
    return best;
  }
  /** what pressing F would do right now, for the prompt */
  options(t: { a: Actor; c: Citizen }) {
    const me = this.sim.local; const w = this.sim.currentWeapon(me); const gun = !!w && w.id !== 'fists' && w.id !== 'machete' && me.aiming;
    if (gun) return 'rob'; if (t.a.ko! > 0 || t.a.hp < t.a.maxHp * 0.3) return 'help';
    const r = this.recs.get(t.c.id); if (r && this.isEnemy(r)) return 'none';
    if (t.c.m < 3000 || ['occ.hustler', 'occ.unemployed', 'occ.hawker'].includes(this.soc.C.occ[t.c.occ].id)) return this.sim.cash >= 500 ? 'tip' : 'greet';
    return 'greet';
  }
  interact(): boolean {
    const t = this.target(); if (!t) return false; const sim = this.sim; const me = sim.local; const soc = this.soc; const { a, c } = t;
    const opt = this.options(t);
    if (opt === 'rob') {
      const take = Math.round(Math.min(c.m, (a.cash ?? 0) + c.m * 0.08) / 100) * 100;
      if (take > 0) { c.m -= take; sim.cash += take; sim.events.push({ t: 'cash', actor: me.id, amount: take }); }
      sim.crime('robbery', 1, me.pos);
      this.remember(c, 'robbed', a.pos, take ? `₦${take.toLocaleString()}` : 'nothing on ' + pron(c.female).him, 1);
      const b = sim.brainOf(a.id); if (b) { b.kind = 'flee'; b.from = { ...me.pos }; b.t = 12; a.fear = 1; }
      this.say(c, this.line(c, this.rec(c)!, 'fear')); this.witnesses(a.pos, c); return true;
    }
    if (opt === 'help') { a.hp = Math.min(a.maxHp, a.hp + 40); a.ko = 0; this.remember(c, 'helped', a.pos); this.say(c, this.line(c, this.rec(c)!, 'helped')); return true; }
    if (opt === 'tip') { sim.cash -= 500; sim.events.push({ t: 'cash', actor: me.id, amount: -500 }); c.m += 500; c.food = Math.max(0, c.food - 0.3); this.remember(c, 'tipped', a.pos); this.say(c, this.line(c, this.rec(c)!, 'tipped')); return true; }
    if (opt === 'greet') {
      const r = this.recs.get(c.id); const o = soc.C.occ[c.occ];
      if (r && this.isAlly(r)) this.say(c, this.line(c, r, 'ally_greet', r.mem.find((x) => x.k === 'helped' || x.k === 'tipped')));
      else this.ctx.hud.say(nameOf(c), o.barks?.length ? o.barks[hash32(c.id, Math.floor(soc.minute / 30)) % o.barks.length] : this.greeting(c), 3.2);
      if (!r) { c.soc = 0; } else this.remember(c, 'met', a.pos); return true;
    }
    return false;
  }
  private greeting(c: Citizen) { const g = [`Good ${this.soc.hour < 12 ? 'morning' : this.soc.hour < 17 ? 'afternoon' : 'evening'}.`, 'How far?', 'Oga, how body?', 'Welcome.']; return g[hash32(c.id, this.soc.day) % g.length]; }

  // ---------------------------------------------------------------- phone data
  list() {
    const soc = this.soc; const out: { r: NemRec; kind: 'enemy' | 'ally' | 'known' }[] = [];
    for (const r of this.recs.values()) { const kind = this.isEnemy(r) ? 'enemy' : this.isAlly(r) ? 'ally' : null; if (kind) out.push({ r, kind }); }
    out.sort((a, b) => (b.r.hate + b.r.love + b.r.c.rank * 0.1) - (a.r.hate + a.r.love + a.r.c.rank * 0.1));
    void soc; return out;
  }

  // ---------------------------------------------------------------- save
  save() {
    const recs: any[] = [];
    for (const r of this.recs.values()) recs.push({ c: r.c, mem: r.mem, hate: +r.hate.toFixed(3), love: +r.love.toFixed(3), fear: +r.fear.toFixed(3), wins: r.wins, ret: r.returned, rev: r.revive, amb: r.ambushAt, lm: Math.round(r.lastMin), lx: Math.round(r.lastX), lz: Math.round(r.lastZ), lp: r.lastPlace, bt: r.betrayed });
    return { v: 1, recs };
  }
  load(s: any) {
    if (!s || s.v !== 1) return;
    for (const x of s.recs ?? []) {
      const c: Citizen = x.c; if (!c || c.id === undefined) continue; c.body = -1; c.nem = true; c.act = ACT.SLEEP;
      const r: NemRec = { c, mem: x.mem ?? [], hate: x.hate ?? 0, love: x.love ?? 0, fear: x.fear ?? 0, wins: x.wins ?? 0, returned: x.ret ?? 0, revive: x.rev ?? 0, ambushAt: x.amb ?? 0, lastMin: x.lm ?? 0, lastX: x.lx ?? c.hx, lastZ: x.lz ?? c.hz, lastPlace: x.lp ?? '', talk: -999, betrayed: x.bt ?? 0, sold: 0 };
      this.recs.set(c.id, r); this.soc.keepers.set(c.id, c); if (c.st === ST.DEAD) this.soc.deaths.add(c.id);
    }
    this.soc.ringDirtyNow();
  }
}

export const nemesisSystem: GameSystem = {
  id: 'nemesis',
  init(ctx) { const n = new Nemesis(ctx); RT.nem = n; },
  start(ctx) { const n = RT.nem; if (n && RT.soc) n.load(ctx.save.nemesis); },
  frame(ctx, dt) { RT.nem?.frame(dt); },
  onEvent(_ctx, e) { RT.nem?.onEvent(e); },
};
export { ACT };
