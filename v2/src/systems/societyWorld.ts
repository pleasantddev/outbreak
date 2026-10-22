// Bridge between the off-screen society and the LifeSim: citizens near the player become actors standing or walking where
// their schedule says; when they walk away they go back to being records. Also owns how a citizen reacts when hurt.
import type { Actor, Command } from '../sim/types';
import { emptyCommand } from '../sim/types';
import type { LifeSim, PedBrain } from '../sim/life';
import { RoadNet } from '../world/roadnet';
import { PALETTE, PATTERNS, SKIN_TONES, type CharacterLook } from '../data/cosmetics';
import { weaponStats, AMMO_STACK, type WeaponItem } from '../sim/items';
import { WEAPONS } from '../data/balance';
import { Rng } from '../sim/rng';
import { Society } from './societyCore';
import { ACT, ST, actAt, nameOf, placeOf, outdoors, type Citizen } from './societyModel';
import { hash01, hash32, genPerson } from './societyData';

export const SPAWN_MIN = 36, SPAWN_MAX = 132;

interface Mind {
  mode: 'goto' | 'dwell' | 'home' | 'event' | 'hunt';
  gx: number; gz: number; ax: number; az: number; has: boolean;
  walk: number; s: number; dir: number; next: number; stuck: number; lx: number; lz: number; giveUp: number; flip: number;
  act: number; wander: number; bark: number; born: number;
  /** nemesis behaviour overrides */
  hostile: boolean; ally: boolean; hunt: number;
}

export class WorldBridge {
  minds = new Map<number, Mind>(); named = 0;
  private scanT = 0; private tmp = { x: 0, z: 0 }; private list: Citizen[] = [];
  barkCd = 0;
  /** set by events: citizens in this circle gather (crowd) or flee */
  crowds: { x: number; z: number; r: number; until: number; kind: 'gather' | 'flee' | 'fight'; tag: string }[] = [];
  onBark?: (name: string, line: string) => void;
  constructor(public soc: Society, public sim: LifeSim) {
    sim.hooks.populate = (P) => this.populate(P);
    sim.hooks.citizenThink = (a, b, c, dt) => this.think(a, b, c, dt);
    sim.hooks.onHurt = (t, by, dmg, b) => this.hurt(t, by, dmg, b);
    sim.hooks.onDespawn = (a) => this.despawned(a);
    sim.hooks.trafficDriver = (kind, x, z) => this.driverFor(kind, x, z);
    sim.hooks.bound = (a) => this.bindDriver(a);
  }

  private populate(P: { x: number; z: number }): boolean {
    // the society takes over the pavements once it has people near the player; a few anonymous walkers fill any gap
    let n = 0; for (const a of this.sim.actors) if (a.alive && a.role !== 'player' && a.cid === undefined && a.vehicle === null && !(a as any)._gone && a.role !== 'police') n++;
    const ready = this.soc.ringNear.length > 40;
    return ready && n >= 2;
  }

  // ---------------------------------------------------------------- look and gear
  look(c: Citizen): CharacterLook {
    const C = this.soc.C; const o = C.occ[c.occ]; const r = new Rng(c.seed);
    const body = c.female ? 'female' : 'male';
    const skin = Math.min(SKIN_TONES.length - 1, c.eth === 2 ? r.int(2, 4) : r.int(0, 3) + (c.eth === 3 ? 1 : 0));
    const ov = o.look ?? {};
    const top = (ov.top as any) ?? r.pick(['tee', 'tee', 'hoodie', 'jacket'] as const);
    const pattern = (ov.pattern as any) ?? (r.chance(c.female ? 0.5 : 0.25) ? r.pick(PATTERNS).id : 'solid');
    const cols = ov.colors ?? PALETTE;
    const l: CharacterLook = {
      name: nameOf(c), body, skin, hair: c.female ? r.pick(['buns', 'long', 'buzzedfemale'] as const) : r.pick(['none', 'buzzed', 'simpleparted', 'buzzed'] as const),
      beard: !c.female && c.age > 28 && r.chance(c.eth === 2 ? 0.7 : 0.3), top, topPattern: pattern, topColor: r.pick(cols), topAccent: r.pick(PALETTE),
      pants: 'solid', pantsColor: r.pick(['#1e2b3a', '#2a2622', '#141414', '#3e3a33', '#c9c1b2', '#5a3d2b']), shoes: r.pick(['#141414', '#e8e0d0', '#5a3d2b']),
      head: ((ov.head as any) ?? (r.chance(0.1) ? 'cap' : 'none')), vest: !!ov.vest, backpack: !!ov.backpack || r.chance(0.08), scars: c.scars,
      facePaint: (['none', 'tribal', 'skull', 'ash'] as const)[Math.min(3, c.face)],
      model: c.female ? r.pick(['farah', 'farah', 'girl'] as const) : r.pick(['survivor', 'survivor', 'survivor', 'rogue'] as const),
    } as CharacterLook;
    if (c.age > 55 && !c.female) l.hair = 'none';
    return l;
  }
  gearUp(a: Actor, c: Citizen) {
    const give = (id: 'pistol' | 'smg' | 'ar', slot: 'primary' | 'secondary') => { const w: WeaponItem = { kind: 'weapon', id, mag: 0, att: {}, skin: 'factory' }; w.mag = weaponStats(w).mag; if (slot === 'primary') a.inv.primary = w; else a.inv.secondary = w; a.inv.addStack(AMMO_STACK[WEAPONS[id].ammo]!, 60); };
    if (c.gear >= 1 && a.role !== 'police') a.inv.melee = { kind: 'weapon', id: 'machete', mag: 0, att: {}, skin: 'factory' };
    if (c.gear >= 2 && a.role !== 'police') give('pistol', 'secondary');
    if (c.gear >= 3) give('smg', 'primary');
    a.maxHp = a.hp = 100 + c.rank * 12 + Math.round(c.scars * 30) + (c.gear >= 2 ? 20 : 0);
    if (a.role === 'police') a.maxHp = a.hp = 120 + c.rank * 10;
    a.cash = Math.max(0, Math.min(Math.round(c.m * 0.15), 9000));
  }

  // ---------------------------------------------------------------- scan: records become bodies
  frame(dt: number, P: { x: number; z: number }) {
    this.barkCd -= dt; this.scanT -= dt; if (this.scanT > 0) return; this.scanT = 0.45;
    const soc = this.soc; const sim = this.sim; const C = soc.C;
    this.named = 0; for (const a of sim.actors) if (a.cid !== undefined && a.alive && !(a as any)._gone && a.vehicle === null) this.named++;
    let free = Math.max(0, Math.floor(sim.maxPeds * 0.9) - this.named - this.anon());
    if (free <= 0) return;
    const cs = soc.nearby(P.x, P.z, SPAWN_MAX + 5, this.list); const hour = soc.hour, dow = soc.dow, day = soc.day;
    // spread the work: look at a rotating slice of the list
    const start = (hash32(Math.floor(soc.minute * 3)) % Math.max(1, cs.length));
    let spawned = 0;
    for (let q = 0; q < cs.length && free > 0 && spawned < 3; q++) {
      const c = cs[(start + q) % cs.length];
      if (c.body >= 0 || c.st !== ST.OK) continue;
      const sl = actAt(C, c, hour, dow, day);
      if (sl.act === ACT.DRIVE || sl.act === ACT.SLEEP || sl.act === ACT.AWAY) continue;
      if (!outdoors(C, c, sl) || !placeOf(c, sl, this.tmp)) continue;
      const d = Math.hypot(this.tmp.x - P.x, this.tmp.z - P.z);
      if (d > SPAWN_MAX || d < SPAWN_MIN) continue;
      if (this.spawnAt(c, this.tmp.x, this.tmp.z, sl.act)) { free--; spawned++; }
    }
    // keepers (rivals, bosses) who are far from their cell but near the player also count: handled through nearby() since cells hold them
  }
  private anon() { let n = 0; for (const a of this.sim.actors) if (a.alive && a.role !== 'player' && a.cid === undefined && a.vehicle === null && !(a as any)._gone) n++; return n; }

  anchor(x: number, z: number, r = 70): { x: number; z: number; walk: number; s: number } | null {
    const net = this.sim.net; let best = 1e9, out: { x: number; z: number; walk: number; s: number } | null = null;
    for (const id of net.nearWalks(x, z, r)) { const w = net.walks[id]; const pr = RoadNet.project(w.pts, x, z); if (pr.d < best) { best = pr.d; const at = RoadNet.at(w.pts, pr.s); out = { x: at.x, z: at.z, walk: id, s: pr.s }; } }
    return best < 48 ? out : null;
  }
  spawnAt(c: Citizen, x: number, z: number, act: number): Actor | null {
    const an = this.anchor(x, z); if (!an) return null;
    // keep clear of anybody already standing there
    for (const a of this.sim.actors) if (a.alive && a.vehicle === null && !(a as any)._gone && Math.abs(a.pos.x - an.x) < 0.9 && Math.abs(a.pos.z - an.z) < 0.9) { an.x += 1.1; an.z += 0.8; break; }
    const o = this.soc.C.occ[c.occ]; const role = o.role === 'ped' ? 'ped' : o.role;
    const a = this.sim.spawnBound(role, { x: an.x, y: 0.05, z: an.z }, this.look(c), nameOf(c), c.id);
    // spawnActor repaints police and area boys; keep their identity features
    if (c.scars) a.look.scars = Math.max(a.look.scars, c.scars);
    if (c.face) a.look.facePaint = (['none', 'tribal', 'skull', 'ash'] as const)[Math.min(3, c.face)];
    this.gearUp(a, c); c.body = a.id; this.named++;
    const m: Mind = { mode: 'goto', gx: an.x, gz: an.z, ax: an.x, az: an.z, has: false, walk: an.walk, s: an.s, dir: 1, next: 0, stuck: 0, lx: an.x, lz: an.z, giveUp: 0, flip: 0, act, wander: 0, bark: hash01(c.id, 7) * 12, born: this.sim.time, hostile: false, ally: false, hunt: 0 };
    this.minds.set(a.id, m);
    return a;
  }
  /** put an anonymous or freshly created citizen in the world right here (events, ambushes) */
  spawnNear(c: Citizen, x: number, z: number): Actor | null { if (c.body >= 0) return this.sim.actors[c.body] ?? null; return this.spawnAt(c, x, z, ACT.SOCIAL); }

  // ---------------------------------------------------------------- hooks
  private despawned(a: Actor) {
    if (a.cid === undefined) return; const c = this.soc.get(a.cid); if (c && c.body === a.id) c.body = -1;
    this.minds.delete(a.id);
  }
  private driverFor(kind: string, x: number, z: number): number | null {
    if (kind !== 'danfo' && kind !== 'okada' && kind !== 'keke') return null;
    const C = this.soc.C; const hour = this.soc.hour, dow = this.soc.dow, day = this.soc.day;
    const cs = this.soc.nearby(x, z, 600, this.list);
    for (const c of cs) {
      if (c.body >= 0 || c.st !== ST.OK || C.occ[c.occ].vehicle !== kind) continue;
      if (actAt(C, c, hour, dow, day).act !== ACT.DRIVE) continue;
      c.body = -2; return c.id;
    }
    return null;
  }
  private bindDriver(a: Actor) {
    const c = this.soc.get(a.cid!); if (!c) return;
    c.body = a.id; a.name = nameOf(c); a.look = Object.assign(a.look, this.look(c)); a.look.top = 'tee';
    if (c.scars) a.look.scars = c.scars;
  }
  hurt(t: Actor, by: Actor, dmg: number, b: PedBrain): boolean {
    if (t.cid === undefined) return false;
    const c = this.soc.get(t.cid); if (!c) return false;
    const m = this.minds.get(t.id);
    const o = this.soc.C.occ[c.occ];
    // courage and temper decide fight or flight; people with a grudge fight harder
    const brave = o.role === 'police' || o.role === 'area' || Math.random() < Math.max(0.05, Math.min(0.92, c.co * 0.75 + c.ag * 0.45 - 0.28));
    if (brave) {
      b.kind = o.role === 'police' ? 'police' : 'fight'; b.target = by.id;
      if (m) { m.hostile = true; m.mode = 'hunt'; }
      // their crew comes running
      if (c.fac && by.role === 'player') this.callCrew(c, by);
    } else { b.kind = 'flee'; b.from = { ...by.pos }; b.t = 10; t.fear = 1; }
    c.soc = 0;
    return true;
  }
  /** faction mates within earshot join the fight, in proportion to how loyal they are */
  callCrew(c: Citizen, target: Actor) {
    for (const a of this.sim.actors) {
      if (a.cid === undefined || !a.alive || a.id === target.id || a.cid === c.id || (a as any)._gone) continue;
      const z = this.soc.get(a.cid); if (!z || z.fac !== c.fac) continue;
      if (Math.hypot(a.pos.x - target.pos.x, a.pos.z - target.pos.z) > 55) continue;
      const b = this.sim.brainOf(a.id); if (!b || b.kind === 'fight') continue;
      if (Math.random() < 0.35 + z.lo * 0.6) { b.kind = this.soc.C.occ[z.occ].role === 'police' ? 'police' : 'fight'; b.target = target.id; const m = this.minds.get(a.id); if (m) { m.hostile = true; m.mode = 'hunt'; } }
    }
  }

  // ---------------------------------------------------------------- the brain of a bound citizen
  private think(a: Actor, b: PedBrain, cmd: Command, dt: number) {
    const m = this.minds.get(a.id); const c = a.cid !== undefined ? this.soc.get(a.cid) : undefined;
    if (!m || !c || c.st === ST.DEAD) { cmd.mx = cmd.mz = 0; return; }
    const sim = this.sim; const t = sim.time;
    // re-read the schedule every couple of seconds
    if (t >= m.next) {
      m.next = t + 2 + hash01(a.id, Math.floor(t)) * 2;
      this.decide(a, c, m);
    }
    if (m.mode === 'hunt') { // handled by the fight brain; if it is over, resume the day
      m.hunt -= dt; if (m.hunt <= 0 && b.kind === 'citizen') m.mode = 'goto';
      return;
    }
    const dx = m.gx - a.pos.x, dz = m.gz - a.pos.z; const dist = Math.hypot(dx, dz);
    const set = (x: number, z: number, speed: number) => { const l = Math.hypot(x - a.pos.x, z - a.pos.z) || 1; cmd.mx = ((x - a.pos.x) / l) * speed; cmd.mz = ((z - a.pos.z) / l) * speed; cmd.yaw = Math.atan2(x - a.pos.x, z - a.pos.z); };
    cmd.yaw = a.yaw;
    if (m.mode === 'dwell' || dist < 3.2) {
      m.mode = m.mode === 'home' ? 'home' : 'dwell';
      if (m.mode === 'home' && dist < 6) { // gone indoors
        if (Math.hypot(a.pos.x - sim.local.pos.x, a.pos.z - sim.local.pos.z) > 8) { sim.removeActor(a); return; }
      }
      // stand about: a small shuffle now and then, face the shop or the road
      m.wander -= dt;
      if (m.wander <= 0) { m.wander = 5 + hash01(a.id, Math.floor(t)) * 10; m.stuck = hash01(a.id, Math.floor(t), 2) < 0.3 ? 1 : 0; const ang = hash01(a.id, Math.floor(t), 3) * 6.28; m.lx = m.gx + Math.cos(ang) * 2.2; m.lz = m.gz + Math.sin(ang) * 2.2; }
      if (m.stuck && Math.hypot(m.lx - a.pos.x, m.lz - a.pos.z) > 0.5) set(m.lx, m.lz, 0.22);
      else { cmd.mx = cmd.mz = 0; m.stuck = 0; if (m.has) cmd.yaw = Math.atan2(m.ax - a.pos.x, m.az - a.pos.z) || a.yaw; }
      this.bark(a, c, m, dt);
      return;
    }
    // on the move: along the pavement toward the goal, straight in for the last stretch
    const rush = c.act === ACT.COMMUTE ? 0.42 : 0.3;
    if (dist < 24 || m.giveUp > 2) { set(m.gx, m.gz, rush); this.noProgress(a, m, dt); return; }
    this.followWalk(a, m, dt, set, rush);
  }
  private noProgress(a: Actor, m: Mind, dt: number) {
    m.stuck += dt; if (m.stuck > 1.5) { const moved = Math.hypot(a.pos.x - m.lx, a.pos.z - m.lz); if (moved < 0.5) m.flip++; m.stuck = 0; m.lx = a.pos.x; m.lz = a.pos.z; }
    if (m.flip > 3) { m.mode = 'dwell'; m.gx = a.pos.x; m.gz = a.pos.z; m.flip = 0; }
  }
  private followWalk(a: Actor, m: Mind, dt: number, set: (x: number, z: number, s: number) => void, speed: number) {
    const net = this.sim.net; let w = net.walks[m.walk];
    if (!w || RoadNet.project(w.pts, a.pos.x, a.pos.z).d > 7) { const an = this.anchor(a.pos.x, a.pos.z, 30); if (!an) { m.giveUp = 3; return; } m.walk = an.walk; m.s = an.s; w = net.walks[m.walk]; m.dir = this.bestDir(w, m.s, m.gx, m.gz); }
    m.s = RoadNet.project(w.pts, a.pos.x, a.pos.z).s;
    if (m.s > w.len - 3 && m.dir > 0 || m.s < 3 && m.dir < 0) { // end of this pavement: pick the neighbour that gets closer to the goal
      const end = RoadNet.at(w.pts, m.dir > 0 ? w.len : 0); let bestScore = Math.hypot(end.x - m.gx, end.z - m.gz) - 1, pick = -1, pd = 1;
      for (const id of net.nearWalks(end.x, end.z, 14)) {
        if (id === m.walk) continue; const nw = net.walks[id]; const pr = RoadNet.project(nw.pts, end.x, end.z); if (pr.d > 10) continue;
        for (const d of [1, -1]) { const p = RoadNet.at(nw.pts, Math.max(0, Math.min(nw.len, pr.s + d * 30))); const sc = Math.hypot(p.x - m.gx, p.z - m.gz); if (sc < bestScore) { bestScore = sc; pick = id; pd = d; } }
      }
      if (pick >= 0) { m.walk = pick; w = net.walks[pick]; m.s = RoadNet.project(w.pts, end.x, end.z).s; m.dir = pd; m.giveUp = 0; }
      else { m.dir *= -1; m.giveUp += 0.5; }
    }
    const tp = RoadNet.at(w.pts, Math.max(0, Math.min(w.len, m.s + m.dir * 3)));
    set(tp.x, tp.z, speed); this.noProgress(a, m, dt);
  }
  private bestDir(w: { pts: number[]; len: number }, s: number, gx: number, gz: number) {
    const f = RoadNet.at(w.pts, Math.min(w.len, s + 25)), b = RoadNet.at(w.pts, Math.max(0, s - 25));
    return Math.hypot(f.x - gx, f.z - gz) <= Math.hypot(b.x - gx, b.z - gz) ? 1 : -1;
  }
  /** what should this person be doing and where */
  private decide(a: Actor, c: Citizen, m: Mind) {
    const C = this.soc.C; const sl = actAt(C, c, this.soc.hour, this.soc.dow, this.soc.day);
    c.act = sl.act;
    // crowds from city events pull people in or push them away
    for (const cr of this.crowds) if (cr.until > this.soc.minute && Math.hypot(a.pos.x - cr.x, a.pos.z - cr.z) < cr.r * 1.6 && m.mode !== 'hunt') {
      if (cr.kind === 'gather' || cr.kind === 'fight') { this.goal(m, cr.x + (hash01(a.id, 1) - 0.5) * cr.r, cr.z + (hash01(a.id, 2) - 0.5) * cr.r, 'goto'); return; }
    }
    if (sl.act === ACT.SLEEP || sl.act === ACT.AWAY || !outdoors(C, c, sl)) { this.goal(m, c.hx, c.hz, 'home'); return; }
    if (sl.act === ACT.DRIVE) { this.goal(m, c.wx, c.wz, 'goto'); return; } // an off-duty driver waits at the stand
    if (!placeOf(c, sl, this.tmp)) { this.goal(m, c.hx, c.hz, 'home'); return; }
    // commuters head for the far end of their trip, everybody else for the place itself
    if (sl.act === ACT.COMMUTE) { const x = sl.back ? c.hx : c.wx, z = sl.back ? c.hz : c.wz; this.goal(m, x, z, 'goto'); return; }
    this.goal(m, this.tmp.x, this.tmp.z, 'goto');
  }
  private goal(m: Mind, x: number, z: number, mode: 'goto' | 'home') {
    if (Math.abs(m.gx - x) < 1 && Math.abs(m.gz - z) < 1 && m.mode === mode) return;
    if (m.mode === 'dwell' && Math.hypot(m.gx - x, m.gz - z) < 30 && mode === 'goto') return;
    const an = this.anchor(x, z, 80); const tx = an?.x ?? x, tz = an?.z ?? z;
    if (Math.hypot(m.gx - tx, m.gz - tz) < 4 && m.mode === 'dwell' && mode === 'goto') return;
    m.gx = tx; m.gz = tz; m.mode = mode; m.giveUp = 0; m.flip = 0; m.has = true; m.ax = x; m.az = z;
  }
  private bark(a: Actor, c: Citizen, m: Mind, dt: number) {
    m.bark -= dt; if (m.bark > 0 || this.barkCd > 0) return;
    const me = this.sim.local; const d = Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z); if (d > 13) return;
    const o = this.soc.C.occ[c.occ]; if (!o.barks?.length || c.act !== ACT.WORK) return;
    m.bark = 25 + hash01(a.id, Math.floor(this.sim.time)) * 30; this.barkCd = 7;
    this.onBark?.(a.name, o.barks[hash32(c.id, Math.floor(this.sim.time / 20)) % o.barks.length]);
  }

  /** An anonymous body that becomes part of your story gets a citizen record on the spot. */
  private adoptN = 0;
  adoptActor(a: Actor): Citizen | undefined {
    if (a.cid !== undefined) return this.soc.get(a.cid);
    const C = this.soc.C; const id = 900_000_000 + (this.adoptN++) + Math.floor(Math.random() * 1000) * 1000;
    const r = new Rng(hash32(id, a.id)); const female = a.look.body === 'female'; const age = r.int(19, 55);
    const p = genPerson(C, r, female, age);
    const occId = a.role === 'police' ? 'occ.police' : a.role === 'area' ? 'occ.area_boy' : a.role === 'driver' ? 'occ.danfo_driver' : 'occ.hustler';
    const occ = C.occIdx.get(occId) ?? 0; const home = a.pos;
    const c: Citizen = {
      id, cell: 0, first: p.first, last: p.last, nick: '', female, eth: p.eth, faith: p.faith, age, occ, fac: '', rank: 0, rep: 0,
      hx: home.x, hz: home.z, wx: home.x, wz: home.z, mx: home.x, mz: home.z, px: home.x, pz: home.z, bx: home.x, bz: home.z, hrich: 0.2, rent: 250000, m: r.int(2000, 20000), poor: 0, income: 3000,
      food: 0.2, rest: 0.2, soc: 0.2, tr: [C.pickTrait(r), C.pickTrait(r)], ag: r.range(0.3, 0.7), co: r.range(0.3, 0.7), gr: r.range(0.3, 0.7), lo: r.range(0.3, 0.7), fa: 0.3, rel: [],
      st: ST.OK, until: 0, seed: id, vis: 0.1, wj: 0, sj: 0, scars: 0, face: 0, gear: a.inv.melee.id === 'machete' ? 1 : 0, veh: 0, act: ACT.WORK, body: a.id, day: this.soc.day, area: this.soc.W.areaName(home.x, home.z) || 'Lagos',
    };
    a.cid = c.id; a.name = nameOf(c); this.soc.keepers.set(id, c); this.soc.byId.set(id, c); c.nem = false;
    this.minds.set(a.id, { mode: 'goto', gx: a.pos.x, gz: a.pos.z, ax: a.pos.x, az: a.pos.z, has: false, walk: 0, s: 0, dir: 1, next: 0, stuck: 0, lx: a.pos.x, lz: a.pos.z, giveUp: 3, flip: 0, act: ACT.WORK, wander: 0, bark: 99, born: this.sim.time, hostile: false, ally: false, hunt: 0 });
    return c;
  }

  /** Called when the player's clock jumps or the system restarts: everyone goes back to being a record. */
  recallAll() { for (const a of this.sim.actors) if (a.cid !== undefined && !(a as any)._gone && a.role !== 'player') this.sim.removeActor(a); this.minds.clear(); }
}
export { emptyCommand };
