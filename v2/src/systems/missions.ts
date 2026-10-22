// Missions, events and routes: loads content/*.json, offers work (phone Hustles app, calls, people on the map), runs the
// step graph with HUD objectives, GPS, markers, timers and outcomes, and keeps progress in ctx.save.missions.
// Step behaviour lives in missionsSteps.ts, DOM and 3D markers in missionsUi.ts, perks in skills.ts.
import type { Blip, GameCtx, GameSystem, GoalPoint } from './registry';
import type { SkillsSystem } from './skills';
import { loadGameContent, resolvePlace, type GameContent } from '../content/game';
import { FACTIONS, type Cond, type EventDef, type Fx, type MissionDef, type PlaceRef, type StepDef, type Line } from '../content/schema';
import type { Actor, SimEvent, Vehicle } from '../sim/types';
import { RoadNet } from '../world/roadnet';
import { VEHICLES, WEAPONS, type WeaponId } from '../data/balance';
import { AMMO_STACK, weaponStats, type WeaponItem } from '../sim/items';
import { MissionUi, type MarkerSpec } from './missionsUi';
import { STEPS } from './missionsSteps';
import type { Goal, Npc, Pt, Run, RunDef } from './missionsCore';

interface Saved { done: Record<string, { n: number; last: number; best?: number }>; flags: string[]; rep: Record<string, number>; active: null | { id: string; step: string; items: string[]; flags: string[]; timer: number | null }; evDone: Record<string, number>; seenIntro?: boolean }
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const fmt = (n: number) => '₦' + Math.round(n).toLocaleString();
const LEGACY_FALLBACK: Record<string, string> = {};

export class MissionsSystem implements GameSystem {
  id = 'missions';
  content!: GameContent; ctx!: GameCtx; ui!: MissionUi; sv: Saved = { done: {}, flags: [], rep: {}, active: null, evDone: {} };
  run: Run | null = null; evRun: Run | null = null;
  /** testing: ignore requirements, cooldowns and once-only rules */
  force = false;
  tracked: string | null = null; listAll = false;
  private ready = false;
  private snapCache = new Map<string, Pt>();
  private anchors = new Map<string, Pt | null>();
  private giverNpcs = new Map<string, Npc>();
  private timers = { give: 0, ev: 0, call: 100 + Math.random() * 60, eligible: 0, route: 0 };
  private evLast = new Map<string, number>(); private lastAnyEvent = -999;
  private eligCache = new Map<string, string | null>();
  private lastRouteGoal: { x: number; z: number } | null = null;
  private pendingStart: string | null = null;

  // ------------------------------------------------------------ lifecycle
  async init(ctx: GameCtx) {
    this.ctx = ctx;
    this.content = await loadGameContent();
    const s = ctx.save.missions as Saved | undefined; if (s) this.sv = { ...this.sv, ...s };
    ctx.save.missions = this.sv;
    this.ui = new MissionUi(ctx.hud, ctx.THREE, ctx.view.scene);
    ctx.hud.appRenderers.Hustles = () => this.renderBoard();
    for (const m of this.content.missions) if (m.legacy) LEGACY_FALLBACK[m.legacy] = m.id;
    this.ready = true;
  }
  start(ctx: GameCtx) {
    const w = window as any; if (w.__hl) w.__hl.missions = this;
    // pick up where the last session stopped
    const a = this.sv.active;
    if (a && this.content.mission.has(a.id)) {
      const m = this.content.mission.get(a.id)!;
      const run = this.makeRun('mission', m, m); this.run = run; run.items = new Set(a.items); run.flags = new Set(a.flags); run.timer = a.timer;
      this.enter(run, m.steps.some((s) => s.id === a.step) ? a.step : m.start);
      ctx.hud.toast('Welcome back', `Your hustle is still on: ${m.title}.`, 'linear-gradient(160deg,#f6c453,#d98a12)', 'pin', 5);
    }
  }
  get P() { const me = this.ctx.sim.local; if (me.vehicle !== null) { const t = this.ctx.sim.vehicles[me.vehicle].body.translation(); return { x: t.x, y: t.y, z: t.z }; } return { x: me.pos.x, y: me.pos.y, z: me.pos.z }; }
  get me() { return this.ctx.sim.local; }
  get sk() { return this.ctx.systems.get('skills') as unknown as SkillsSystem; }
  get hour() { return this.ctx.view.atmo.hour; }
  dist(p: { x: number; z: number }) { const P = this.P; return Math.hypot(p.x - P.x, p.z - P.z); }
  myVehicle(): Vehicle | null { const me = this.me; return me.vehicle !== null && me.seat === 0 ? this.ctx.sim.vehicles[me.vehicle] : null; }
  anyVehicle(): Vehicle | null { const me = this.me; return me.vehicle !== null ? this.ctx.sim.vehicles[me.vehicle] : null; }

  // ------------------------------------------------------------ places
  project(lat: number, lon: number) { return this.ctx.store!.project(lat, lon); }
  /** Resolve a place and, once the streets around it are loaded, move it onto the nearest walkway or lane. */
  place(ref: PlaceRef | undefined, prefer: 'foot' | 'road' = 'foot'): Pt | null {
    const res = resolvePlace(this.content, ref, (a, b) => this.project(a, b)); if (!res) return null;
    const key = `${typeof ref === 'string' ? ref : Math.round(res.x) + ',' + Math.round(res.z)}|${prefer}`;
    const hit = this.snapCache.get(key); if (hit) return hit;
    if (this.dist(res) > 150) return res;
    const sn = this.snapPoint(res.x, res.z, prefer, res.r);
    const out: Pt = { x: sn.x, z: sn.z, r: res.r, name: res.name }; this.snapCache.set(key, out); return out;
  }
  snapPoint(x: number, z: number, prefer: 'foot' | 'road', r = 16) {
    const net = this.ctx.sim.net; const lim = Math.max(45, r * 2.2);
    const walk = () => { let bd = 1e9, b: { x: number; z: number } | null = null; for (const id of net.nearWalks(x, z, lim)) { const w = net.walks[id]; const pr = RoadNet.project(w.pts, x, z); if (pr.d < bd) { bd = pr.d; b = RoadNet.at(w.pts, pr.s); } } return b && bd < lim ? b : null; };
    const road = () => { let bd = 1e9, b: { x: number; z: number } | null = null; for (const id of net.near(x, z, lim)) { const l = net.lanes[id]; const pr = RoadNet.project(l.pts, x, z); if (pr.d < bd) { bd = pr.d; b = RoadNet.at(l.pts, pr.s); } } return b && bd < lim ? b : null; };
    const a = prefer === 'foot' ? walk() ?? road() : road() ?? walk();
    return a ?? { x, z };
  }
  /** A random walkway point within rmax of (x, z), at least rmin away. Falls back to a ring. */
  walkPoint(x: number, z: number, rmin: number, rmax: number) {
    const net = this.ctx.sim.net; const ids = net.nearWalks(x, z, rmax);
    for (let i = 0; i < 24 && ids.length; i++) { const w = net.walks[ids[(Math.random() * ids.length) | 0]]; const p = RoadNet.at(w.pts, Math.random() * w.len); const d = Math.hypot(p.x - x, p.z - z); if (d >= rmin && d <= rmax) return { x: p.x, z: p.z }; }
    const a = Math.random() * 6.283, d = (rmin + rmax) / 2; return { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
  }

  // ------------------------------------------------------------ conditions and effects
  cond(r: Run | null, c: Cond | undefined, quiet = false): boolean { return this.why(r, c) === null || (quiet && false); }
  /** null when the condition holds, otherwise the first reason it fails (player-readable) */
  why(r: Run | null, c: Cond | undefined): string | null {
    if (!c) return null; const sk = this.sk; const sim = this.ctx.sim;
    const lvl = this.ctx.playerLevel?.() ?? 1;
    if (c.level && lvl < c.level) return `Level ${c.level}`;
    if (c.skill) for (const [k, n] of Object.entries(c.skill)) if (sk.level(k) < n) return `${sk.def(k)?.name ?? k} ${n}`;
    if (c.rep) for (const [k, n] of Object.entries(c.rep)) { const v = this.sv.rep[k] ?? 0; if (n >= 0 ? v < n : v > n) return `${FACTIONS[k as keyof typeof FACTIONS] ?? k} ${n > 0 ? '+' : ''}${n}`; }
    if (c.cash !== undefined && sim.cash < c.cash) return `${fmt(c.cash)} in hand`;
    if (c.flag && !this.hasFlag(r, c.flag)) return 'Not yet';
    if (c.noFlag && this.hasFlag(r, c.noFlag)) return 'Already settled';
    if (c.item && !r?.items.has(c.item)) return `Need ${c.item}`;
    if (c.noItem && r?.items.has(c.noItem)) return 'Already have it';
    if (c.hours) { const h = this.hour, [a, b] = c.hours; const ok = a <= b ? h >= a && h < b : h >= a || h < b; if (!ok) return `${String(a).padStart(2, '0')}:00 to ${String(b).padStart(2, '0')}:00 only`; }
    if (c.wantedMin !== undefined && sim.wanted < c.wantedMin) return 'Need heat';
    if (c.wantedMax !== undefined && sim.wanted > c.wantedMax) return 'Too hot';
    if (c.vehicle) { const v = this.anyVehicle(); if (!v || !c.vehicle.includes(v.kind)) return `In a ${VEHICLES[c.vehicle[0]].name}`; }
    if (c.onFoot && this.me.vehicle !== null) return 'On foot';
    if (c.weather && !c.weather.includes(this.ctx.view.atmo.target)) return `Weather: ${c.weather.join('/')}`;
    if (c.after) for (const id of c.after) if (!this.sv.done[id]) return `After: ${this.content.mission.get(id)?.title ?? id}`;
    if (c.notAfter) for (const id of c.notAfter) if (this.sv.done[id]) return 'Done already';
    if (c.chance !== undefined && Math.random() > c.chance) return 'Not now';
    if (c.roll && Math.random() > sk.rollChance(c.roll.skill, c.roll.dc)) return 'Failed the roll';
    return null;
  }
  hasFlag(r: Run | null, f: string) { return f.startsWith('~') ? !!r?.flags.has(f) : this.sv.flags.includes(f) || !!r?.flags.has(f); }
  setFlag(r: Run | null, f: string) { if (f.startsWith('~')) r?.flags.add(f); else if (!this.sv.flags.includes(f)) this.sv.flags.push(f); }
  addRep(f: string, n: number) { this.sv.rep[f] = Math.max(-100, Math.min(100, (this.sv.rep[f] ?? 0) + n)); }

  fx(r: Run | null, f: Fx | undefined, reward = false) {
    if (!f) return; const { sim, hud } = this.ctx; const sk = this.sk;
    if (f.cash) { const c = reward && f.cash > 0 ? Math.round(f.cash * sk.stat('pay.cash')) : f.cash; sim.cash = Math.max(0, sim.cash + c); hud.money(c); if (r) r.earned += c; }
    if (f.xp) this.ctx.grantXp?.(f.xp);
    if (f.skillXp) for (const [k, n] of Object.entries(f.skillXp)) sk.addXp(k, n);
    if (f.rep) for (const [k, n] of Object.entries(f.rep)) this.addRep(k, n > 0 && reward ? Math.round(n * sk.stat('pay.rep')) : n);
    if (f.wanted && f.wanted > sim.wanted) { sim.wanted = Math.min(5, f.wanted); sim.lastSeen = sim.time; sim.events.push({ t: 'crime', kind: 'mission', wanted: sim.wanted }); }
    if (f.heat) { sim.wanted = Math.min(5, sim.wanted + f.heat); sim.lastSeen = sim.time; sim.events.push({ t: 'crime', kind: 'mission', wanted: sim.wanted }); }
    if (f.clearWanted) sim.wanted = 0;
    if (f.giveItem && r) for (const i of f.giveItem) { r.items.add(i); hud.toast('Got it', i, 'linear-gradient(160deg,#f6c453,#d98a12)', 'cash', 3); }
    if (f.takeItem && r) for (const i of f.takeItem) r.items.delete(i);
    if (f.setFlag) for (const x of f.setFlag) this.setFlag(r, x);
    if (f.clearFlag) for (const x of f.clearFlag) { r?.flags.delete(x); this.sv.flags = this.sv.flags.filter((y) => y !== x); }
    if (f.unlock) for (const x of f.unlock) this.setFlag(null, 'u_' + x);
    if (f.toast) hud.toast(f.toast[0], f.toast[1], 'linear-gradient(160deg,#f6c453,#d98a12)', 'pin', 4.5);
    if (f.say) this.say(f.say);
    if (f.hurt) sim.damageActor(this.me, f.hurt, null, false, 'wahala');
    if (f.heal) this.me.hp = this.me.maxHp;
    const v = this.anyVehicle();
    if (v && f.breakVehicle) { if (f.breakVehicle === 'tire') v.tires = v.tires.map(() => 0); else if (f.breakVehicle === 'engine') v.engine = 0; else if (f.breakVehicle === 'fuel') v.fuel = 0; else v.bodyHp = Math.max(60, v.bodyHp - 400); }
    if (v && f.repairVehicle) { const d = VEHICLES[v.kind]; const q = Math.min(1, 0.7 * sk.stat('mech.hp')); v.tires = v.tires.map(() => d.tire); v.engine = Math.max(v.engine, d.engine * q); v.bodyHp = Math.max(v.bodyHp, d.body * q); v.destroyed = false; v.fireT = 0; }
    if (v && f.refuel) v.fuel = VEHICLES[v.kind].fuel;
    if (f.hours) { const a = this.ctx.view.atmo; a.hour += f.hours; while (a.hour >= 24) { a.hour -= 24; a.day++; } }
    if (f.weather) this.ctx.view.atmo.setWeather(f.weather, false);
    if (f.offerMission) this.offer(f.offerMission);
    if (f.startMission) this.pendingStart = f.startMission;
  }
  say(lines: Line[]) { let tot = 0; for (const [who, text] of lines) { const secs = Math.min(6.5, Math.max(2.2, 1.7 + text.length * 0.045)); this.ctx.hud.say(who, text, secs); tot += secs; } return tot; }

  // ------------------------------------------------------------ eligibility and the board
  /** null when the mission can be taken now, else why not */
  locked(m: MissionDef): string | null {
    if (this.force) return null;
    const d = this.sv.done[m.id];
    if (d) { if (!m.repeat) return 'Done'; if ((Date.now() - d.last) / 60000 < m.repeat.cooldownMin) return `Back in ${Math.ceil(m.repeat.cooldownMin - (Date.now() - d.last) / 60000)} min`; }
    return this.why(null, m.req);
  }
  anchor(m: MissionDef): Pt | null {
    if (this.anchors.has(m.id)) return this.anchors.get(m.id)!;
    const R = (ref: PlaceRef | undefined) => (ref === undefined ? null : resolvePlace(this.content, ref, (a, b) => this.project(a, b)));
    let p: Pt | null = R(m.offer?.giver?.at);
    for (const s of m.steps) {
      if (p) break; const a = s as any;
      if (s.type === 'route') p = R(this.content.route.get(a.route)?.stops[0]?.place);
      else p = R(a.to) ?? R(a.at) ?? R(a.from) ?? R(a.provide) ?? R(a.places?.[0]) ?? R(a.checkpoints?.[0]);
    }
    this.anchors.set(m.id, p); return p;
  }

  // ------------------------------------------------------------ starting and finishing
  makeRun(kind: 'mission' | 'event', src: MissionDef | EventDef, def: RunDef): Run {
    return { kind, def, src, idx: 0, step: def.steps[0], t: 0, st: 0, items: new Set(), flags: new Set(), s: {}, text: '', goal: null, extra: [], npcs: new Map(), actors: [], vehicles: [], timer: def.fail?.timer ?? null, earned: 0, ended: false };
  }
  /** Start a mission by id (or by the old job names delivery, danfo, parcel). */
  startMission(id: string, opts: { force?: boolean } = {}): boolean {
    if (!this.ready) return false;
    id = LEGACY_FALLBACK[id] ?? id;
    const m = this.content.mission.get(id); if (!m) { console.warn('[missions] unknown mission', id); return false; }
    if (this.run) { this.ctx.hud.toast('Hustle already on', `Finish or drop "${this.run.def.title}" first.`, 'var(--red)', 'pin', 3.5); return false; }
    const why = opts.force ? null : this.locked(m); if (why) { this.ctx.hud.toast('Not yet', `${m.title}: ${why}.`, 'var(--red)', 'pin', 3.5); return false; }
    const run = this.makeRun('mission', m, m); this.run = run; this.tracked = null;
    this.ctx.hud.title(m.title.toUpperCase(), m.blurb.length > 70 ? m.giver : m.blurb, 4);
    this.enter(run, m.start);
    if (this.ctx.hud.phoneUp) { this.ctx.hud.refreshApp(); }
    return true;
  }
  startEvent(e: EventDef): boolean {
    if (this.evRun) return false; if (this.run && !e.ambient) return false;
    const run = this.makeRun('event', e, { id: e.id, title: e.title, steps: e.steps, start: e.start, rewards: e.rewards ?? {} });
    this.evRun = run; this.evLast.set(e.id, this.ctx.sim.time); this.lastAnyEvent = this.ctx.sim.time;
    if (e.once) this.sv.evDone[e.id] = Date.now();
    this.enter(run, e.start); return true;
  }
  /** Phone-call or toast offer of a mission (the player decides). */
  offer(id: string) {
    id = LEGACY_FALLBACK[id] ?? id;
    const m = this.content.mission.get(id); if (!m || this.run || this.ctx.hud.ringing) return;
    this.ctx.hud.call(m.giver, `Incoming call · Y answer · N decline`, () => { this.say([[m.giver, m.offer?.call?.line ?? m.blurb]]); setTimeout(() => this.startMission(id, { force: true }), 1400); }, () => this.ctx.hud.toast('Missed call', `${m.giver}. It is on your Hustles list.`, 'linear-gradient(160deg,#3a3f52,#151824)', 'phone'));
  }
  abandon() { const r = this.run; if (!r) return; this.cleanup(r); this.run = null; this.sv.active = null; this.ctx.hud.toast('Hustle dropped', r.def.title, 'linear-gradient(160deg,#3a3f52,#151824)', 'pin', 3); this.ui.setObjective(null); this.ui.miniClose(); this.ui.closeChoice(); this.persist(); }
  /** Jump to another step of the running mission (used by tests and the admin preview). */
  goStep(id: string) { const r = this.run ?? this.evRun; if (r) this.enter(r, id); }

  enter(run: Run, id: string) {
    const idx = run.def.steps.findIndex((s) => s.id === id);
    if (idx < 0) { console.warn('[missions] missing step', run.def.id, id); this.finish(run, 'fail', 'Broken step'); return; }
    this.leave(run);
    run.idx = idx; run.step = run.def.steps[idx]; run.st = 0; run.s = {}; run.goal = null; run.extra = []; run.text = '';
    const st = run.step;
    if (st.timer) run.s.timeLeft = st.timer;
    if (st.fx) this.fx(run, st.fx);
    if (st.say) this.say(st.say);
    const ex = STEPS[st.type] as any;
    if (!ex) { console.warn('[missions] unknown step type', st.type); this.finish(run, 'fail', 'Broken step'); return; }
    ex.enter?.(this, run, st);
    if (!run.text) run.text = st.text ?? '';
    if (run.kind === 'mission') this.persist();
  }
  private leave(run: Run) { const st = run.step; const ex = st ? (STEPS[st.type] as any) : null; ex?.leave?.(this, run, st); this.ui.closeChoice(); this.ui.miniClose(); }
  advance(run: Run, res: string) {
    const st = run.step;
    if (res === 'fail') return this.finish(run, 'fail');
    if (res === 'win') return this.finish(run, 'win');
    if (st.done) this.fx(run, st.done);
    const nextId = res === 'next' ? st.next ?? run.def.steps[run.idx + 1]?.id : res;
    if (!nextId) return this.finish(run, 'win');
    this.enter(run, nextId);
  }

  finish(run: Run, outcome: 'win' | 'fail', why?: string) {
    if (run.ended) return; run.ended = true;
    const { hud } = this.ctx; const st = run.step as any;
    this.leave(run); this.cleanup(run);
    const endStep = st?.type === 'end' ? st : null;
    if (run.kind === 'mission') {
      const m = run.src as MissionDef; this.run = null; this.sv.active = null;
      if (outcome === 'win') {
        const d = this.sv.done[m.id] ?? { n: 0, last: 0 }; d.n++; d.last = Date.now(); const secs = run.t; if (!d.best || secs < d.best) d.best = Math.round(secs); this.sv.done[m.id] = d;
        const rw = endStep?.rewards ?? m.rewards; this.fx(run, rw, true);
        const cash = rw.cash ? Math.round(rw.cash * this.sk.stat('pay.cash')) : 0;
        hud.title(endStep?.title ?? 'HUSTLE DONE', cash ? `+${fmt(cash)}  ·  ${m.title}` : m.title, 4.5);
        if (!this.ctx.sim.local.alive) { /* died on the last step: the respawn handles it */ }
        this.eligCache.clear();
      } else {
        this.fx(run, m.penalty);
        hud.title(endStep?.title ?? 'HUSTLE FAILED', why ?? 'It did not work out.', 4.5, true);
      }
      this.ui.setObjective(null); this.persist();
    } else {
      this.evRun = null;
      if (outcome === 'win') this.fx(run, run.def.rewards, true);
      this.ui.setObjective(null);
    }
    if (this.pendingStart) { const id = this.pendingStart; this.pendingStart = null; setTimeout(() => this.startMission(id, { force: true }), 1800); }
  }
  /** Remove everything a run spawned; people and cars go back to the normal despawn rules. */
  cleanup(run: Run) {
    for (const a of run.actors) { (a as any)._keep = false; (a as any)._script = false; run.npcs.forEach((n) => { if (n.actor === a) n.actor = null; }); if (a.alive && !(a as any)._gone && a.role !== 'player') this.ctx.sim.script(a, 'idle'); (a as any)._keep = false; }
    for (const v of run.vehicles) (v as any)._keep = false;
    for (const n of run.npcs.values()) if (n.actor) { (n.actor as any)._keep = false; }
    run.actors.length = 0; run.vehicles.length = 0; run.npcs.clear(); run.goal = null; run.extra = [];
  }
  persist() {
    const r = this.run; this.sv.active = r && !r.ended ? { id: r.def.id, step: r.step.id, items: [...r.items], flags: [...r.flags], timer: r.timer } : null;
    this.ctx.persist();
  }

  // ------------------------------------------------------------ spawning helpers used by steps
  npc(r: Run, key: string, name: string, ref: PlaceRef | undefined, look: Npc['look'] = 'ped', faceMe = true): Npc {
    let n = r.npcs.get(key);
    if (!n) { const p = ref ? this.place(ref) : null; const q = p ?? { x: this.P.x + 3, z: this.P.z }; n = { key, name, x: q.x, z: q.z, look, actor: null, faceMe }; r.npcs.set(key, n); }
    return n;
  }
  /** Spawn (or respawn) the NPC bodies of a run when the player is near enough for the streets to exist. */
  keepNpcs(r: Run) {
    for (const n of r.npcs.values()) {
      if (n.actor && (!n.actor.alive || (n.actor as any)._gone)) { if (!n.actor.alive) continue; n.actor = null; }
      if (n.actor) continue; if (this.dist(n) > 115) continue;
      const sn = this.snapPoint(n.x, n.z, 'foot'); n.x = sn.x; n.z = sn.z;
      const role = n.look === 'area' ? 'area' : n.look === 'police' ? 'police' : n.look === 'vendor' ? 'vendor' : 'ped';
      const a = this.ctx.sim.spawnActor(role, { x: n.x, y: 0.05, z: n.z }, undefined, n.name);
      this.ctx.sim.script(a, 'free'); a.cmd.yaw = a.yaw; n.actor = a; r.actors.push(a);
    }
  }
  /** Turn NPCs toward the player when he is close. */
  faceNpcs(r: Run) { const P = this.P; for (const n of r.npcs.values()) { const a = n.actor; if (!a || !a.alive || !n.faceMe) continue; if (Math.hypot(a.pos.x - P.x, a.pos.z - P.z) < 14) { a.cmd.yaw = Math.atan2(P.x - a.pos.x, P.z - a.pos.z); a.yaw = a.cmd.yaw; } } }
  giveWeapon(a: Actor, id: WeaponId) {
    if (id === 'machete' || (id as string) === 'fists') { a.inv.melee = { kind: 'weapon', id, mag: 0, att: {}, skin: 'factory' } as WeaponItem; return; }
    const w: WeaponItem = { kind: 'weapon', id, mag: 0, att: {}, skin: 'factory' }; w.mag = weaponStats(w).mag;
    if (WEAPONS[id].slot === 'primary') a.inv.primary = w; else a.inv.secondary = w;
    a.inv.addStack(AMMO_STACK[WEAPONS[id].ammo]!, 60);
  }
  spawnFoe(r: Run, x: number, z: number, d: { role?: 'area' | 'ped' | 'police'; weapon?: WeaponId; hp?: number; name?: string }): Actor {
    const a = this.ctx.sim.spawnActor(d.role ?? 'area', { x, y: 0.05, z }, undefined, d.name);
    if (d.weapon) this.giveWeapon(a, d.weapon);
    if (d.hp) { a.hp = a.maxHp = d.hp; }
    this.ctx.sim.script(a, 'fight', 0); r.actors.push(a); return a;
  }
  /** Park a vehicle of the given kind on the road nearest a place, unlocked and ready. */
  provideVehicle(r: Run, kind: Vehicle['kind'], ref: PlaceRef | { x: number; z: number }): Vehicle | null {
    const p = typeof ref === 'object' && 'x' in ref ? ref : this.place(ref as PlaceRef, 'road'); if (!p) return null;
    const net = this.ctx.sim.net; let best: { x: number; z: number; yaw: number } | null = null, bd = 1e9;
    for (const id of net.near(p.x, p.z, 70)) { const l = net.lanes[id]; if (l.cls > 8) continue; const pr = RoadNet.project(l.pts, p.x, p.z); if (pr.d < bd) { bd = pr.d; best = RoadNet.at(l.pts, pr.s); } }
    if (!best) return null;
    const rx = -Math.cos(best.yaw), rz = Math.sin(best.yaw);
    const v = this.ctx.sim.addVehicle(kind, { x: best.x + rx * 1.4, y: 0.1, z: best.z + rz * 1.4 }, best.yaw, true);
    (v as any).locked = false; (v as any)._keep = true; r.vehicles.push(v); return v;
  }

  // ------------------------------------------------------------ per tick
  step(ctx: GameCtx, dt: number) {
    if (!this.ready) return; const sim = ctx.sim;
    for (const r of [this.run, this.evRun]) if (r && !r.ended) this.stepRun(r, dt);
    this.timers.give -= dt; if (this.timers.give <= 0) { this.timers.give = 0.8; this.maintainGivers(); }
    this.timers.ev -= dt; if (this.timers.ev <= 0) { this.timers.ev = 2; this.maybeEvent(); }
    this.timers.call -= dt; if (this.timers.call <= 0) { this.timers.call = 140 + Math.random() * 120; this.maybeCall(); }
    this.timers.route -= dt; if (this.timers.route <= 0) {
      this.timers.route = 1; const g = this.currentGoal();
      if (g && (!this.lastRouteGoal || Math.hypot(g.x - this.lastRouteGoal.x, g.z - this.lastRouteGoal.z) > 60)) { this.lastRouteGoal = { x: g.x, z: g.z }; const P = this.P; ctx.loadRoute?.(P.x, P.z, g.x, g.z); }
      if (!g) this.lastRouteGoal = null;
    }
    void sim;
  }
  private stepRun(r: Run, dt: number) {
    const sim = this.ctx.sim; r.t += dt; r.st += dt;
    if (!this.me.alive && r.kind === 'mission') { this.finish(r, 'fail', 'You died. Lagos is not for the faint.'); return; }
    const f = r.def.fail;
    if (r.kind === 'mission' && f) {
      if (f.wantedAbove !== undefined && sim.wanted > f.wantedAbove) return this.finish(r, 'fail', 'Too much heat. The job is blown.');
      if (f.leaveVehicle && r.s.mustStay && this.me.vehicle === null) return this.finish(r, 'fail', 'You left the vehicle.');
    }
    if (r.timer !== null) { r.timer -= dt; if (r.timer <= 0) return this.finish(r, 'fail', 'Time up. Lagos waits for nobody.'); }
    const st = r.step; const ex = STEPS[st.type] as any;
    const res = ex.tick(this, r, st, dt) as string | void;
    if (r.ended) return;
    if (res) { this.advance(r, res); return; }
    if (st.timer && r.s.timeLeft !== undefined) { r.s.timeLeft -= dt; if (r.s.timeLeft <= 0) this.advance(r, st.onTimeout ?? 'fail'); }
    if (r.npcs.size) { this.keepNpcs(r); this.faceNpcs(r); }
  }

  // ------------------------------------------------------------ givers, calls and events
  private maintainGivers() {
    const P = this.P; const want = new Set<string>();
    if (!this.run) for (const m of this.content.missions) {
      const g = m.offer?.giver; if (!g || this.locked(m)) continue;
      const p = this.place(g.at); if (!p) continue; if (Math.hypot(p.x - P.x, p.z - P.z) > 130) continue; want.add(m.id);
      if (this.giverNpcs.size >= 5 && !this.giverNpcs.has(m.id)) continue;
      let n = this.giverNpcs.get(m.id);
      if (!n) { n = { key: m.id, name: g.name, x: p.x, z: p.z, look: g.look ?? 'ped', actor: null, faceMe: true }; this.giverNpcs.set(m.id, n); }
      const a = n.actor;
      if (!a || !a.alive || (a as any)._gone) {
        if (a && !a.alive) continue; n.actor = null;
        const sn = this.snapPoint(n.x, n.z, 'foot'); n.x = sn.x; n.z = sn.z;
        const role = n.look === 'area' ? 'area' : n.look === 'police' ? 'police' : n.look === 'vendor' ? 'vendor' : 'ped';
        const act = this.ctx.sim.spawnActor(role, { x: n.x, y: 0.05, z: n.z }, undefined, n.name); this.ctx.sim.script(act, 'free'); act.cmd.yaw = act.yaw; n.actor = act;
      }
    }
    for (const [id, n] of this.giverNpcs) if (!want.has(id)) { if (n.actor) (n.actor as any)._keep = false; this.giverNpcs.delete(id); }
  }
  private maybeCall() {
    if (this.run || this.ctx.hud.ringing || this.ctx.hud.landmapOn || this.ctx.hud.phoneUp) return;
    const pool = this.content.missions.filter((m) => m.offer?.call && !this.locked(m) && this.why(null, m.offer.call.hours ? { hours: m.offer.call.hours } : undefined) === null);
    if (!pool.length) return; const tot = pool.reduce((a, m) => a + (m.offer!.call!.weight ?? 1), 0); let x = Math.random() * tot, pick = pool[0];
    for (const m of pool) { x -= m.offer!.call!.weight ?? 1; if (x <= 0) { pick = m; break; } }
    const c = pick.offer!.call!;
    this.ctx.hud.call(c.who, `Incoming call · Y answer · N decline`, () => { this.say([[c.who, c.line]]); setTimeout(() => this.startMission(pick.id, { force: true }), 1500); }, () => this.ctx.hud.toast('Missed call', `${c.who}. Check Hustles on your phone.`, 'linear-gradient(160deg,#3a3f52,#151824)', 'phone'));
  }
  /** The first mission of the game: Conductor Sule rings. */
  introCall() { if (!this.run && !this.sv.seenIntro) { this.sv.seenIntro = true; const id = LEGACY_FALLBACK['delivery'] ?? 'food_run_oshodi'; const m = this.content.mission.get(id); if (m) this.offer(id); } }

  eventOk(e: EventDef): boolean {
    const w = e.when; const sim = this.ctx.sim; const P = this.P;
    if (e.once && this.sv.evDone[e.id]) return false;
    if (sim.time - (this.evLast.get(e.id) ?? -1e9) < e.cooldown) return false;
    if (w.hours) { const h = this.hour, [a, b] = w.hours; if (!(a <= b ? h >= a && h < b : h >= a || h < b)) return false; }
    if (w.weather && !w.weather.includes(this.ctx.view.atmo.target)) return false;
    if (w.weekday && !w.weekday.includes(this.ctx.view.atmo.day % 7)) return false;
    const inCar = this.me.vehicle !== null;
    if (w.inVehicle !== undefined && w.inVehicle !== inCar) return false;
    if (w.onFoot && inCar) return false;
    if (w.vehicle) { const v = this.anyVehicle(); if (!v || !w.vehicle.includes(v.kind)) return false; }
    if (w.speedMin) { const v = this.anyVehicle(); if (!v || Math.abs(v.ctrl.currentVehicleSpeed()) * 3.6 < w.speedMin) return false; }
    if (w.wantedMin !== undefined && sim.wanted < w.wantedMin) return false;
    if (w.wantedMax !== undefined && sim.wanted > w.wantedMax) return false;
    if (w.minLevel && (this.ctx.playerLevel?.() ?? 1) < w.minLevel) return false;
    if (w.flag && !this.hasFlag(null, w.flag)) return false;
    if (w.noFlag && this.hasFlag(null, w.noFlag)) return false;
    if (w.near) { const r = w.r ?? 140; if (!w.near.some((p) => { const q = resolvePlace(this.content, p, (a, b) => this.project(a, b)); return q && Math.hypot(q.x - P.x, q.z - P.z) < r; })) return false; }
    if (w.potholes) { if (this.ctx.sim.opts.potholes(P.x, P.z, 60).length < w.potholes) return false; }
    return true;
  }
  private maybeEvent() {
    const sim = this.ctx.sim; if (this.evRun || this.ctx.hud.ringing || this.ctx.hud.landmapOn || this.ui.choosing || this.ui.minigame) return;
    if (sim.time - this.lastAnyEvent < 70 + Math.random() * 40) return;
    if (!this.me.alive) return;
    const pool = this.content.events.filter((e) => (this.run ? e.ambient : true) && this.eventOk(e));
    if (!pool.length) return; if (Math.random() > 0.55) return;
    const tot = pool.reduce((a, e) => a + e.weight, 0); let x = Math.random() * tot, pick = pool[0];
    for (const e of pool) { x -= e.weight; if (x <= 0) { pick = e; break; } }
    this.startEvent(pick);
  }

  // ------------------------------------------------------------ per frame: HUD, markers, prompts
  frame(ctx: GameCtx, dt: number) {
    if (!this.ready) return; const hud = ctx.hud;
    this.ui.setVisible(!hud.landmapOn); this.ui.update(dt);
    const r = this.run ?? this.evRun;
    if (r && !r.ended) {
      const m = r.src; const g = r.goal; const dist = g ? this.dist(g) : -1;
      const tl = r.s.timeLeft !== undefined ? r.s.timeLeft : r.timer ?? undefined;
      const parts: string[] = []; if (dist >= 0 && !r.step.noGps) parts.push(dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist / 5) * 5} m`); if (g?.name && !r.s.hideName) parts.push(g.name);
      const total = r.def.steps.filter((s) => s.type !== 'branch' && s.type !== 'end').length;
      this.ui.setObjective({ title: r.def.title, text: r.text, sub: parts.join(' · ') || r.def.title, timer: tl, timerWarn: tl !== undefined && tl < 20, step: r.kind === 'mission' && total <= 14 ? [Math.min(total, r.def.steps.slice(0, r.idx + 1).filter((s) => s.type !== 'branch' && s.type !== 'end').length - 1), total] : undefined, reward: r.kind === 'mission' && (m as MissionDef).rewards.cash ? fmt((m as MissionDef).rewards.cash!) : undefined, tone: r.kind });
    } else this.ui.setObjective(null);
    // markers
    const P = this.P; const marks: MarkerSpec[] = [];
    const y = this.me.pos.y;
    for (const rr of [this.run, this.evRun]) if (rr && !rr.ended) {
      if (rr.goal && !rr.goal.minor) marks.push({ x: rr.goal.x, y, z: rr.goal.z, kind: rr.goal.kind });
      for (const e of rr.extra) marks.push({ x: e.x, y, z: e.z, kind: e.kind });
    }
    if (!this.run) {
      for (const m of this.content.missions) { const g = m.offer?.giver; if (!g) continue; const n = this.giverNpcs.get(m.id); if (n) marks.push({ x: n.x, y, z: n.z, kind: 'giver' }); }
      const tr = this.tracked ? this.content.mission.get(this.tracked) : null; const tp = tr ? this.anchor(tr) : null; if (tp && !marks.some((k) => Math.hypot(k.x - tp.x, k.z - tp.z) < 8)) marks.push({ x: tp.x, y, z: tp.z, kind: 'giver' });
    }
    this.ui.setMarkers(marks, P.x, P.z);
    // talk to a giver
    let near: { m: MissionDef; n: Npc } | null = null;
    if (!this.run && !this.ui.choosing && !hud.phoneUp && this.me.vehicle === null) for (const [id, n] of this.giverNpcs) { if (!n.actor || !n.actor.alive) continue; if (Math.hypot(n.actor.pos.x - P.x, n.actor.pos.z - P.z) < 3.4) { near = { m: this.content.mission.get(id)!, n }; break; } }
    if (near && !(this.run) && !this.evRun) { const nn = near; this.ui.prompt(`<kbd>E</kbd>Talk to ${esc(nn.n.name)}`, () => this.openOffer(nn.m)); } else if (!this.pendingPrompt) this.ui.prompt(null);
    // NPCs of the giver set face the player
    for (const n of this.giverNpcs.values()) { const a = n.actor; if (a && a.alive && Math.hypot(a.pos.x - P.x, a.pos.z - P.z) < 12) { a.cmd.yaw = Math.atan2(P.x - a.pos.x, P.z - a.pos.z); a.yaw = a.cmd.yaw; } }
  }
  pendingPrompt = false;

  openOffer(m: MissionDef) {
    if (this.ui.choosing) return; const g = m.offer?.giver;
    this.ui.choice({ head: `${g?.name ?? m.giver}`, prompt: g?.line ?? m.blurb, options: [{ text: `Take the job: ${m.title}`, tag: m.rewards.cash ? fmt(m.rewards.cash) : undefined, hint: `${m.blurb}  (about ${m.minutes} min)` }, { text: 'Not now' }], onPick: (i) => { if (i === 0) this.startMission(m.id, { force: true }); } });
  }

  // ------------------------------------------------------------ sim events
  onEvent(_ctx: GameCtx, e: SimEvent) { void e; }

  // ------------------------------------------------------------ GPS and radar
  currentGoal(): Goal | null {
    const r = this.run ?? this.evRun;
    if (r && !r.ended && r.goal && !r.step.noGps) return r.goal;
    if (!this.run && this.tracked) { const m = this.content.mission.get(this.tracked); const p = m ? this.anchor(m) : null; if (p) return { ...p, kind: 'giver' }; }
    return null;
  }
  goal(): GoalPoint | null { const g = this.currentGoal(); return g ? { x: g.x, z: g.z, label: g.name } : null; }
  blips(_ctx: GameCtx, out: Blip[]) {
    for (const r of [this.run, this.evRun]) if (r && !r.ended) {
      if (r.goal) out.push({ x: r.goal.x, z: r.goal.z, c: r.goal.kind === 'foe' ? '#ff4d5e' : r.goal.kind === 'vehicle' ? '#59a8ff' : '#3ddc84', r: r.goal.minor ? 6 : 11 });
      for (const e of r.extra) out.push({ x: e.x, z: e.z, c: e.kind === 'foe' ? '#ff4d5e' : '#3ddc84', r: e.minor ? 6 : 9 });
    }
    if (!this.run) {
      for (const n of this.giverNpcs.values()) out.push({ x: n.x, z: n.z, c: '#ffc53d', r: 10 });
      const g = this.currentGoal(); if (g && this.tracked) out.push({ x: g.x, z: g.z, c: '#ffc53d', r: 11 });
    }
  }

  // ------------------------------------------------------------ phone: the Hustles board
  onAction(ctx: GameCtx, app: string, id: string): boolean {
    if (app !== 'Hustles') return false;
    if (id.startsWith('cancel:') || id === 'drop') this.abandon();
    else if (id.startsWith('start:')) { const mid = id.slice(6); if (this.startMission(mid)) { ctx.hud.togglePhone(false); ctx.view.phoneUp = false; } }
    else if (id.startsWith('track:')) { this.tracked = this.tracked === id.slice(6) ? null : id.slice(6); this.lastRouteGoal = null; }
    else if (id === 'all') this.listAll = !this.listAll;
    else if (this.content.mission.has(id) || LEGACY_FALLBACK[id]) this.startMission(id);
    ctx.hud.refreshApp(); return true;
  }
  private renderBoard(): string {
    const row = (b: string, s: string, btns: [string, string, string?][] = []) => `<div class="row"><b>${b}</b>${s}${btns.length ? '<br>' : ''}${btns.map(([id, label, cls]) => `<button class="btn ${cls ?? ''}" data-app="Hustles" data-id="${id}" style="margin-right:6px">${label}</button>`).join('')}</div>`;
    let html = '';
    const r = this.run;
    if (r) html += row(`On now: ${esc(r.def.title)}`, `${esc(r.text)}`, [['drop', 'Drop it', 'ghost']]);
    const reps = Object.entries(this.sv.rep).filter(([, v]) => v !== 0).map(([k, v]) => `${FACTIONS[k as keyof typeof FACTIONS] ?? k} ${v > 0 ? '+' : ''}${v}`);
    const doneN = Object.keys(this.sv.done).length;
    html += row('Your name in Lagos', `${doneN} of ${this.content.missions.length} hustles done${reps.length ? '<br>' + esc(reps.join(' · ')) : ''}`);
    if (r) return html;
    const avail: { m: MissionDef; d: number; p: Pt | null }[] = []; const lockedList: { m: MissionDef; why: string }[] = [];
    for (const m of this.content.missions) {
      const why = this.locked(m);
      if (!why) { if (m.offer?.board === false && !m.offer?.giver) continue; const p = this.anchor(m); avail.push({ m, d: p ? this.dist(p) : 1e9, p }); }
      else if (why !== 'Done' && !why.startsWith('Back in')) lockedList.push({ m, why });
    }
    avail.sort((a, b) => a.d - b.d);
    const shown = this.listAll ? avail : avail.slice(0, 9);
    for (const { m, d, p } of shown) {
      const board = m.offer?.board !== false; const km = d >= 1e8 ? '' : d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`;
      const meta = `${esc(m.giver)} · ${esc(m.area)}${km ? ' · ' + km : ''} · ~${m.minutes} min`;
      const pay = m.rewards.cash ? ` · ${fmt(m.rewards.cash)}` : '';
      const btns: [string, string, string?][] = [];
      if (board) btns.push(['start:' + m.id, 'Take it']);
      else btns.push(['track:' + m.id, this.tracked === m.id ? 'Stop GPS' : 'Find on GPS', 'ghost']);
      if (board && p) btns.push(['track:' + m.id, this.tracked === m.id ? 'Stop GPS' : 'GPS', 'ghost']);
      html += row(`${esc(m.title)}${pay}`, `${esc(m.blurb)}<br><span style="opacity:.7">${meta}${board ? '' : ' · meet in person'}</span>`, btns);
    }
    if (avail.length > 9) html += row(this.listAll ? 'Showing all' : `${avail.length - 9} more`, 'Closest first.', [['all', this.listAll ? 'Show fewer' : 'Show all', 'ghost']]);
    if (!avail.length) html += row('Nothing now', 'Check back when the city wakes up, or raise your skills and standing.');
    const tease = lockedList.sort((a, b) => (a.m.req?.level ?? 0) - (b.m.req?.level ?? 0)).slice(0, this.listAll ? 12 : 4);
    for (const { m, why } of tease) html += row(`<span style="opacity:.6">${esc(m.title)}</span>`, `<span style="opacity:.55">Locked: ${esc(why)}</span>`);
    return html;
  }

  // ------------------------------------------------------------ debug / test hooks
  state() { const r = this.run; return { run: r ? { id: r.def.id, step: r.step.id, type: r.step.type, text: r.text, t: Math.round(r.t), items: [...r.items], flags: [...r.flags] } : null, ev: this.evRun ? { id: this.evRun.def.id, step: this.evRun.step.id } : null, done: Object.keys(this.sv.done).length, rep: this.sv.rep }; }
  /** Teleport the player (and vehicle) to a place id. */
  tp(ref: PlaceRef) {
    const p = resolvePlace(this.content, ref, (a, b) => this.project(a, b)); if (!p) return false; const me = this.me;
    const sn = { x: p.x, z: p.z };
    if (me.vehicle !== null) { const v = this.ctx.sim.vehicles[me.vehicle]; v.body.setTranslation({ x: sn.x, y: 1.2, z: sn.z }, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    else { me.pos = { x: sn.x, y: 0.5, z: sn.z }; me.body.setTranslation({ x: sn.x, y: 1.5, z: sn.z }, true); }
    return true;
  }
}
export const missions = new MissionsSystem();
