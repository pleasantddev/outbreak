// The off-screen society: citizens in 250 m cells around the player, ticked once per game minute (far ones every six),
// earning, spending, getting promoted, moving house, going broke, being robbed. No renderer or sim in here, so it can be
// tested headless and costs a fraction of a millisecond per frame: work is spread by a visit budget.
import { Rng } from '../sim/rng';
import { Content, hash01, hash32 } from './societyData';
import { ACT, CELL, ST, WorldIndex, actAt, cellKey, cellOf, cellX, cellZ, genCellGen, nameOf, popOfCell, rankLabel, type Citizen, type Faction, type Site } from './societyModel';
import { Economy } from './societyEconomy';

export interface CellRec { key: number; list: Citizen[]; gen: Generator<void, Citizen[]> | null; near: boolean; cx: number; cz: number }
export const ACTIVE_R = 900, DROP_R = 1250, NEAR_R = 480;

export interface SocietyStats { citizens: number; cells: number; keepers: number; factions: number; day: number; poor: number; employed: number; avgMoney: number; visits: number }

export class Society {
  W = new WorldIndex(); E: Economy;
  cells = new Map<number, CellRec>(); byId = new Map<number, Citizen>(); keepers = new Map<number, Citizen>();
  factions = new Map<string, Faction>(); facSaved: Record<string, any> = {};
  deaths = new Set<number>();
  minute = 0; px = 0; pz = 0; lastMin = -1; lastHour = -1;
  ringNear: Citizen[] = []; ringFar: Citizen[] = []; ringDirty = true; curN = 0; curF = 0; accN = 0; accF = 0;
  onNews?: (text: string, kind: string, x?: number, z?: number, hot?: boolean) => void;
  /** nemesis hooks: a citizen was generated, was promoted, died */
  onCitizen?: (c: Citizen) => void; onPromote?: (c: Citizen, from: number) => void; onDeath?: (c: Citizen, by: string) => void;
  landlords = new Map<number, number>(); rentInbox = new Map<number, number>();
  /** hourly accumulators for the economy */
  working!: Float64Array; expected!: Float64Array; agg = { n: 0, poor: 0, employed: 0, money: 0, crime: 0 }; hourVisits = 0;
  stats: SocietyStats = { citizens: 0, cells: 0, keepers: 0, factions: 0, day: 0, poor: 0, employed: 0, avgMoney: 0, visits: 0 };
  private idxGen: Generator<void> | null = null; private idxQueue: any[] = [];
  private actT = 0; private rng: Rng; visits = 0; genMs = 0;
  gossip: { id: number; text: string }[] = [];

  constructor(public C: Content, public seed: number) {
    this.E = new Economy(C); this.rng = new Rng(seed ^ 0x5bd1e995);
    this.working = new Float64Array(C.goods.length); this.expected = new Float64Array(C.goods.length);
  }
  get day() { return Math.floor(this.minute / 1440); }
  get hour() { return (this.minute % 1440) / 60; }
  get dow() { return this.day % 7; }
  get(id: number): Citizen | undefined { return this.byId.get(id) ?? this.keepers.get(id); }
  news(text: string, kind: string, x?: number, z?: number, hot = false) { this.E.addNews(this.minute, text, kind, x, z, hot); this.onNews?.(text, kind, x, z, hot); }

  // ---------------------------------------------------------------- factions
  factionFor = (type: string, x: number, z: number, site: Site | null, area: string): Faction | null => {
    const def = this.C.factions.get(type); if (!def) return null;
    let key: string, ax = x, az = z;
    if (def.cell === 'site' && site) key = `${type}:${Math.round(site.x)}_${Math.round(site.z)}`;
    else {
      const cx2 = Math.floor(x / 500), cz2 = Math.floor(z / 500); key = `${type}:c${cx2}_${cz2}`;
      if (!this.factions.has(key)) { // the crew hangs where the people are: a bus stop, a stand, a row of shops
        const ccx = cellOf(x), ccz = cellOf(z);
        for (const k of ['busStop', 'stand', 'shops', 'bar', 'market'] as const) { const l = this.W.nearest(k, ccx, ccz, 3); if (l.length) { const s = l[hash32(cx2, cz2, 4) % l.length]; ax = s.x; az = s.z; break; } }
      }
    }
    let f = this.factions.get(key);
    if (!f) {
      const nm = def.names[hash32(key.length, Math.round(ax), Math.round(az)) % def.names.length].replace('{area}', area);
      f = { key, type, name: nm, x: ax, z: az, boss: -1, members: 0, power: 0, money: 0, rival: '', war: 0, raid: 0, area, heat: 0 };
      const sv = this.facSaved[key]; if (sv) { f.boss = sv.boss ?? -1; f.power = sv.power ?? 0; f.money = sv.money ?? 0; f.rival = sv.rival ?? ''; f.name = sv.name ?? f.name; f.heat = sv.heat ?? 0; }
      this.factions.set(key, f);
    }
    f.members++;
    return f;
  };
  facOf(c: Citizen) { return c.fac ? this.factions.get(c.fac) : undefined; }
  facLabel(c: Citizen) { const f = this.facOf(c); return f ? f.name : ''; }
  rankName(c: Citizen) { return rankLabel(this.C, c); }
  /** rank weights: a boss counts for more of the faction's strength than a foot soldier */
  static RW = [1, 2, 4, 8, 16];

  // ---------------------------------------------------------------- frame update
  /** Run a bounded amount of work. `now` is absolute game minutes. */
  update(now: number, px: number, pz: number, regions: Iterable<any>, budgetMs: number) {
    const t0 = performance.now(); const dtMin = this.lastMin < 0 ? 0 : Math.max(0, now - this.lastMin);
    this.minute = now; this.px = px; this.pz = pz;
    if (this.lastMin >= 0 && dtMin > 240) this.catchUp();
    this.lastMin = now;
    const left = () => budgetMs - (performance.now() - t0);
    // 1 index regions that have loaded (time sliced)
    if (!this.idxGen) { for (const r of regions) if (!this.W.has(r.i, r.j) && !this.idxQueue.includes(r)) this.idxQueue.push(r); if (this.idxQueue.length) this.idxGen = this.W.indexGen(this.idxQueue.shift()); }
    while (this.idxGen && left() > 0) { const s = this.idxGen.next(); if (s.done) { this.idxGen = null; this.actT = 0; break; } }
    // 2 which cells should exist
    this.actT -= dtMin > 0 ? dtMin : 0.02; if (this.actT <= 0) { this.actT = 0.5; this.manageCells(); }
    // 3 generate pending cells
    for (const c of this.cells.values()) {
      if (!c.gen) continue; if (left() <= 0) break;
      const g0 = performance.now();
      for (;;) { const s = c.gen.next(); if (s.done) { this.finishCell(c, s.value); break; } if (left() <= 0) break; }
      this.genMs += performance.now() - g0; if (left() <= 0) break;
    }
    // 4 visit citizens: every near citizen once per game minute, far ones every sixth
    if (dtMin > 0) {
      this.accN += this.ringNear.length * Math.min(dtMin, 3); this.accF += this.ringFar.length * Math.min(dtMin, 18) / 6;
      this.visitRing(this.ringNear, 'N', t0, budgetMs); this.visitRing(this.ringFar, 'F', t0, budgetMs);
    }
    // 5 hourly
    const h = Math.floor(now / 60); if (h !== this.lastHour) { if (this.lastHour >= 0) this.hourly(); this.lastHour = h; }
  }
  private visitRing(ring: Citizen[], which: 'N' | 'F', t0: number, budgetMs: number) {
    let acc = which === 'N' ? this.accN : this.accF; let cur = which === 'N' ? this.curN : this.curF;
    const dow = this.dow, day = this.day, hour = this.hour; const C = this.C;
    while (acc >= 1 && ring.length) {
      if (cur >= ring.length) cur = 0;
      const c = ring[cur++]; acc--; this.visits++;
      this.visit(c, hour, dow, day, C);
      if ((this.visits & 15) === 0 && performance.now() - t0 > budgetMs) break;
    }
    if (which === 'N') { this.accN = Math.min(acc, ring.length); this.curN = cur; } else { this.accF = Math.min(acc, ring.length); this.curF = cur; }
  }

  // ---------------------------------------------------------------- cells
  private manageCells() {
    const pcx = cellOf(this.px), pcz = cellOf(this.pz); const R = Math.ceil(ACTIVE_R / CELL);
    const want: { k: number; cx: number; cz: number; d: number }[] = [];
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      const cx = pcx + i, cz = pcz + j; const d = Math.hypot((cx + 0.5) * CELL - this.px, (cz + 0.5) * CELL - this.pz); if (d > ACTIVE_R) continue;
      const k = cellKey(cx, cz); if (this.cells.has(k) || !this.W.regionReady(cx, cz)) continue;
      if (popOfCell(this.W, cx, cz) <= 0) { this.cells.set(k, { key: k, list: [], gen: null, near: d < NEAR_R, cx, cz }); continue; }
      want.push({ k, cx, cz, d });
    }
    want.sort((a, b) => a.d - b.d);
    for (const w of want.slice(0, 6)) this.cells.set(w.k, { key: w.k, list: [], gen: genCellGen(this.genEnv(), w.cx, w.cz), near: w.d < NEAR_R, cx: w.cx, cz: w.cz });
    // drop the far ones, keeping the people who matter
    let changed = want.length > 0;
    for (const [k, c] of this.cells) {
      const d = Math.hypot((c.cx + 0.5) * CELL - this.px, (c.cz + 0.5) * CELL - this.pz);
      const near = d < NEAR_R; if (near !== c.near) { c.near = near; changed = true; }
      if (d > DROP_R) {
        for (const z of c.list) { if (this.notable(z)) this.keepers.set(z.id, z); else if (z.body < 0) { this.byId.delete(z.id); this.unfac(z); } }
        this.cells.delete(k); changed = true;
      }
    }
    if (changed) this.ringDirty = true;
    if (this.ringDirty) this.rebuildRings();
  }
  notable(c: Citizen) { return !!c.nem || c.nick !== '' || c.rank >= 3 || c.st === ST.DEAD && !!c.nem; }
  private unfac(c: Citizen) { if (!c.fac) return; const f = this.factions.get(c.fac); if (f) f.members = Math.max(0, f.members - 1); }
  private genEnv() { return { content: this.C, world: this.W, seed: this.seed, factionFor: this.factionFor, wealth: (cx: number, cz: number) => 0.5 + (this.E.macro.wealth - 1) * 0.3 + (this.E.rentMult((cx + 0.5) * CELL, (cz + 0.5) * CELL) - 1) * 0.2 }; }
  private finishCell(c: CellRec, list: Citizen[]) {
    c.gen = null; c.list = list.filter((z) => !this.deaths.has(z.id));
    for (const z of c.list) {
      const keep = this.keepers.get(z.id);
      if (keep) { // a notable person came home: use the live record
        const i = c.list.indexOf(z); c.list[i] = keep; this.keepers.delete(z.id); this.byId.set(keep.id, keep); continue;
      }
      this.byId.set(z.id, z); this.onCitizen?.(z);
      const f = z.fac ? this.factions.get(z.fac) : undefined;
      if (f) {
        const top = (this.C.factions.get(f.type)?.ranks.length ?? 1) - 1;
        if (z.rank >= top) { if (f.boss < 0 || (f.boss !== z.id && !this.get(f.boss))) f.boss = z.id; else if (f.boss !== z.id) { z.rank = top - 1; } }
        f.power += Society.RW[Math.min(4, z.rank)];
      }
    }
    for (const z of c.list) if (z.occ === this.C.occIdx.get('occ.landlord') && !this.landlords.has(c.key)) this.landlords.set(c.key, z.id);
    this.ringDirty = true;
  }
  private rebuildRings() {
    this.ringNear.length = 0; this.ringFar.length = 0;
    for (const c of this.cells.values()) { const r = c.near ? this.ringNear : this.ringFar; for (const z of c.list) r.push(z); }
    for (const z of this.keepers.values()) this.ringFar.push(z);
    this.ringDirty = false; this.curN = this.curF = 0;
    this.stats.citizens = this.ringNear.length + this.ringFar.length; this.stats.cells = this.cells.size; this.stats.keepers = this.keepers.size; this.stats.factions = this.factions.size;
  }
  /** Citizens within r metres of a point, from the near cells only. */
  nearby(x: number, z: number, r: number, out: Citizen[] = []) {
    out.length = 0; const c0 = cellOf(x - r), c1 = cellOf(x + r), d0 = cellOf(z - r), d1 = cellOf(z + r);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) { const cell = this.cells.get(cellKey(i, j)); if (cell) for (const z2 of cell.list) out.push(z2); }
    return out;
  }
  private catchUp() { /* a long jump of the clock: citizens settle on their next visit, prices re-center */ for (let g = 0; g < this.E.price.length; g++) this.E.price[g] += (this.E.base[g] * this.E.infl - this.E.price[g]) * 0.5; }

  // ---------------------------------------------------------------- one citizen, one game minute
  private visit(c: Citizen, hour: number, dow: number, day: number, C: Content) {
    if (c.st === ST.DEAD) return;
    if (c.st !== ST.OK && c.st !== ST.BANNED && this.minute >= c.until) { c.st = ST.OK; }
    if (c.st === ST.BANNED && this.minute >= c.until) c.st = ST.OK;
    const o = C.occ[c.occ];
    const sl = actAt(C, c, hour, dow, day);
    // needs drift: hunger and tiredness rise, rest and company reset them
    const prev = c.act;
    if (sl.act !== prev) { this.transition(c, prev, sl.act, o); c.act = sl.act; }
    c.food = Math.min(1, c.food + 0.0007); c.soc = Math.min(1, c.soc + 0.0004);
    c.rest = sl.act === ACT.SLEEP ? Math.max(0, c.rest - 0.002) : Math.min(1, c.rest + 0.0005);
    // economy sampling for the hourly update
    const act = sl.act; const sched = actAt(C, c, hour, dow, day, true).act;
    const oi = c.occ;
    if (sched === ACT.WORK || sched === ACT.DRIVE) { this.expectedBy(oi, 1); if (act === ACT.WORK || act === ACT.DRIVE) this.workingBy(oi, 1); }
    this.agg.n++; if (c.m < 3500) this.agg.poor++; if (o.id !== 'occ.unemployed' && c.st !== ST.DEAD) this.agg.employed++; this.agg.money += c.m;
    // settle the day, once, on this citizen's own schedule (between 21:00 and 23:00)
    if (c.day < day && hour >= 21 + c.sj / 60 && hour < 23.9) { c.day = day; this.settle(c, day, o); }
  }
  private sellerCache = new Map<number, number[]>();
  private goodsOf(oi: number) { let l = this.sellerCache.get(oi); if (!l) { l = []; this.E.sellers.forEach((s, g) => { if (s.includes(oi)) l!.push(g); }); this.sellerCache.set(oi, l); } return l; }
  private expectedBy(oi: number, n: number) { for (const g of this.goodsOf(oi)) this.expected[g] += n; }
  private workingBy(oi: number, n: number) { for (const g of this.goodsOf(oi)) this.working[g] += n; }

  private transition(c: Citizen, from: number, to: number, o: any) {
    const E = this.E;
    if (to === ACT.LUNCH) { const pr = E.p('plate'); if (c.m > pr * 1.5) { c.m -= pr; E.buy(E.C.good('plate'), 1); c.food = 0; } }
    if (to === ACT.COMMUTE && !o.vehicle && c.m > 4000 && Math.hypot(c.hx - c.wx, c.hz - c.wz) > 650) {
      const g = c.hrich > 0.5 ? 'fare_keke' : c.hrich > 0.25 ? 'fare_danfo' : 'fare_danfo'; const f = E.p(g); c.m -= f; E.buy(E.C.good(g), 1);
    }
    if (to === ACT.MARKET && c.m > 3000) { const pr = E.p('bread'); c.m -= pr * 0.6; E.buy(E.C.good('bread'), 0.6); c.food = Math.max(0, c.food - 0.2); }
    if (to === ACT.BAR && c.m > 3000) { const pr = E.p('plate'); c.m -= pr * 0.7; E.buy(E.C.good('plate'), 0.7); c.soc = 0; }
    if (to === ACT.SOCIAL || to === ACT.WORSHIP) c.soc = Math.max(0, c.soc - 0.5);
  }

  // ---------------------------------------------------------------- the end of a citizen's day
  private settle(c: Citizen, day: number, o: any) {
    const C = this.C, E = this.E; const w = C.wages.get(o.wage); const R = hash01(c.id, day, 5);
    let inc = 0;
    if (c.st === ST.OK || c.st === ST.HOSPITAL) {
      inc = w ? w.daily * (1 + (R - 0.5) * 2 * w.spread) : 2000;
      if (w?.link) { const m = E.mult(w.link.replace('good.', '')); inc *= Math.pow(m, 0.85); }
      if (c.occ === C.occIdx.get('occ.landlord')) inc += (this.rentInbox.get(c.id) ?? 0); this.rentInbox.delete(c.id);
      if (hash01(c.id, day, 3) < 0.045) inc *= 0.1;
      if (c.st === ST.HOSPITAL) inc = 0;
      if (c.fac) { const f = this.factions.get(c.fac); if (f && (o.role === 'area' || o.role === 'police' || o.id === 'occ.pastor' || o.id === 'occ.imam' || f.type === 'union' || f.type === 'traders')) { const share = (Society.RW[Math.min(4, c.rank)] / Math.max(1, f.power)) * f.money * 0.5; const take = Math.min(f.money, share); f.money -= take; inc += take; } }
    }
    c.income = inc;
    // spending
    const plate = E.p('plate'), bread = E.p('bread'), rice = E.p('rice');
    const dep = c.age < 22 ? 0.5 : 1;
    let out = (plate * 1 + bread * 0.35 + rice * 0.03) * dep * (c.m < 1500 ? 0.6 : 1);
    const rentDay = (c.rent / 365) * E.rentMult(c.hx, c.hz) * (c.age < 24 ? 0.2 : 1);
    out += rentDay; const landlord = this.landlords.get(c.cell); if (landlord !== undefined && landlord !== c.id) this.rentInbox.set(landlord, (this.rentInbox.get(landlord) ?? 0) + rentDay * 0.9);
    if (o.vehicle) { const lit = o.vehicle === 'danfo' ? 18 : o.vehicle === 'keke' ? 6 : 4; out += lit * E.p('fuel') * (c.st === ST.OK ? 1 : 0); E.buy(C.good('fuel'), c.st === ST.OK ? lit : 0); }
    else { const km = Math.hypot(c.hx - c.wx, c.hz - c.wz) > 650 && c.m > 4000 ? 1 : 0; void km; }
    out += E.p('data') * 0.4 * (c.hrich > 0.3 ? 1 : 0.3); E.buy(C.good('data'), 0.4);
    E.buy(C.good('plate'), dep); E.buy(C.good('bread'), 0.35 * dep); E.buy(C.good('rice'), 0.03 * dep);
    if (c.faith && c.fa > 0.4 && inc > 0) { const t = inc * C.sink('tithe', 0.09) * c.fa; out += t; const f = this.factions.get(`${c.faith === 2 ? 'mosque' : 'church'}:${Math.round(c.px)}_${Math.round(c.pz)}`); if (f) f.money += t; }
    if (inc > 0 && (o.vehicle || o.id === 'occ.trader' || o.id === 'occ.market_woman' || o.id === 'occ.food_vendor' || o.id === 'occ.hawker' || o.id === 'occ.shop_owner')) {
      const t = inc * C.sink('levy', 0.04); out += t;
      const af = this.factions.get(`areaboys:c${Math.floor(c.wx / 500)}_${Math.floor(c.wz / 500)}`); if (af) { af.money += t * 0.8; af.heat += 0.002; }
      const pt = inc * C.sink('bribe', 0.015); out += pt; const pf = this.nearestFaction('police', c.wx, c.wz); if (pf) pf.money += pt;
    }
    c.m += inc - out;
    c.poor = c.m < Math.max(1500, rentDay * 3) ? c.poor + 1 : 0;
    // life: promotion, broke, business, moving, being robbed
    this.life(c, day, o, inc, out);
    c.food = Math.max(0, c.food - 0.6);
  }
  private nearestFaction(type: string, x: number, z: number) {
    let best: Faction | undefined, bd = 1500;
    for (const f of this.factions.values()) if (f.type === type) { const d = Math.hypot(f.x - x, f.z - z); if (d < bd) { bd = d; best = f; } }
    return best;
  }

  private life(c: Citizen, day: number, o: any, inc: number, out: number) {
    const C = this.C, E = this.E; const r = hash01(c.id, day, 17), r2 = hash01(c.id, day, 19);
    // standing in the faction grows with each good day, faster for the aggressive and the greedy
    if (c.fac && c.st === ST.OK) {
      c.rep += 0.9 + (o.role === 'area' ? c.ag * 1.4 : 0.4) + (r < 0.1 ? 3 : 0);
      this.maybePromote(c);
    }
    // broke: four poor days in a row and the trade goes
    if (c.poor >= 4 && o.id !== 'occ.unemployed' && o.id !== 'occ.hustler' && o.id !== 'occ.area_boy' && c.st === ST.OK) {
      const to = !c.female && c.age < 36 && c.ag > 0.52 && r2 < 0.5 ? 'occ.area_boy' : r2 < 0.8 ? 'occ.hustler' : 'occ.unemployed';
      const oi = C.occIdx.get(to); if (oi !== undefined) {
        const was = o.label; c.occ = oi; c.veh = 0; c.poor = 0;
        if (to === 'occ.area_boy') { const f = this.factionFor('areaboys', c.hx, c.hz, null, c.area); if (f) { this.unfac(c); c.fac = f.key; c.rank = 0; c.rep = 0; c.wx = f.x + (hash01(c.id, 1) - 0.5) * 26; c.wz = f.z + (hash01(c.id, 2) - 0.5) * 26; } }
        else { this.unfac(c); c.fac = ''; }
        if (c.rank >= 2 || this.near(c, 900)) this.news(`${nameOf(c)}, a ${was.toLowerCase()} from ${c.area}, ${to === 'occ.area_boy' ? 'has joined the area boys' : 'is out of work'} after months of going under.`, 'life', c.hx, c.hz);
      }
    }
    // a little money and a head for it: open a shop
    if (c.m > inc * 30 + 60000 && (o.id === 'occ.hustler' || o.id === 'occ.trader' || o.id === 'occ.market_woman' || o.id === 'occ.unemployed') && r < 0.035) {
      const oi = C.occIdx.get('occ.shop_owner'); const sites = this.W.nearest('shops', cellOf(c.hx), cellOf(c.hz), 5);
      if (oi !== undefined && sites.length) {
        const s = sites[hash32(c.id, day) % sites.length]; c.m -= 40000; c.occ = oi; c.wx = s.x; c.wz = s.z; this.unfac(c); c.fac = '';
        if (this.near(c, 900)) this.news(`${c.first} ${c.last} opens a new shop at ${c.area}. ${c.female ? 'She' : 'He'} says business is hard but the neighbourhood is growing.`, 'life', s.x, s.z);
        E.bumpLand(c.wx, c.wz, 0.004);
      }
    }
    // move: up when the money is good, down when the rent bites
    if (r2 < 0.012 || (c.poor >= 3 && r2 < 0.15)) this.moveHouse(c, c.poor >= 3);
    // robbed on the way home: hazard rises with how poor the neighbourhood is
    const crime = this.E.macro.crime; const haz = C.sink('crime', 0.035) * (0.3 + crime * 2.2) * (c.m > 6000 ? 1 : 0.3);
    if (hash01(c.id, day, 23) < haz) {
      const loss = Math.min(Math.max(0, c.m), Math.round((2000 + hash01(c.id, day, 29) * 14000) / 500) * 500);
      if (loss > 0) { c.m -= loss; this.agg.crime++; const cr = this.cellRec(c.cell); const thieves = cr?.list.filter((z) => z.st === ST.OK && (C.occ[z.occ].role === 'area' || z.occ === C.occIdx.get('occ.hustler') || (z.m < 1500 && z.ag > 0.6))) ?? []; if (thieves.length) { const t = thieves[(hash32(c.id, day) % thieves.length)]; t.m += loss; t.rep += 2; } if (loss >= 9000 && this.near(c, 700)) this.news(`Robbery at ${c.area}: ${c.first} ${c.last} lost ₦${loss.toLocaleString()} to two men on a bike.`, 'crime', c.hx, c.hz); }
    }
    // the poor are hungrier and angrier: desperation feeds the crime index
    c.soc = Math.max(0, c.soc - 0.2);
  }
  cellRec(k: number) { return this.cells.get(k); }
  near(c: Citizen, r: number) { return Math.hypot(c.hx - this.px, c.hz - this.pz) < r; }
  private moveHouse(c: Citizen, down: boolean) {
    const homes = this.W.homes.get(c.cell); if (!homes || homes.length < 2) return;
    const want = down ? 'min' : 'max'; let best = homes[0];
    for (let k = 0; k < 6; k++) { const h = homes[(hash32(c.id, this.day, k) % homes.length)]; if (want === 'min' ? h.rich < best.rich : h.rich > best.rich) best = h; }
    if (Math.abs(best.rich - c.hrich) < 0.03) return;
    c.hx = best.x; c.hz = best.z; c.hrich = best.rich; c.rent = Math.round((this.C.rent.poor + (this.C.rent.rich - this.C.rent.poor) * best.rich * best.rich) / 5000) * 5000;
    if (c.rank >= 2 || this.near(c, 700)) this.news(`${nameOf(c)} has moved ${down ? 'to a cheaper room' : 'to a better house'} at ${c.area}.`, 'life', c.hx, c.hz);
  }
  private maybePromote(c: Citizen) {
    const f = this.factions.get(c.fac); if (!f) return; const def = this.C.factions.get(f.type); if (!def) return;
    const top = def.ranks.length - 1; const need = (c.rank + 1) * 25 + 20; if (c.rank >= top || c.rep < need) return;
    if (c.rank + 1 === top) { // the top chair has one seat: challenge the holder
      const boss = f.boss >= 0 ? this.get(f.boss) : undefined;
      if (boss && boss.id !== c.id && boss.st === ST.OK) { if (c.rep < boss.rep + 12 || hash01(c.id, this.day, 31) > 0.35) return; boss.rank = top - 1; this.news(`${nameOf(c)} takes over as ${def.ranks[top]} of ${f.name} after a power struggle with ${nameOf(boss)}.`, 'faction', f.x, f.z, true); }
    }
    const from = c.rank; c.rank++; if (c.rank === top) f.boss = c.id;
    this.onPromote?.(c, from);
    if (c.rank >= 3 && this.near(c, 1500)) this.news(`${nameOf(c)} is the new ${def.ranks[c.rank]} at ${f.name}.`, 'faction', f.x, f.z);
  }

  // ---------------------------------------------------------------- hourly: prices
  private hourly() {
    const a = this.agg; const n = Math.max(1, a.n);
    const poor = a.poor / n, employed = a.employed / n; const avg = a.money / n;
    const wealth = Math.max(0.4, Math.min(2.2, avg / 40000));
    const crimeNow = Math.min(1, poor * 0.9 + (1 - employed) * 0.8 + a.crime / Math.max(1, n * 0.01));
    const k = 1 / Math.max(1, this.ringNear.length + this.ringFar.length) * Math.max(1, n); // visits per hour is n; normalise to citizens
    void k;
    // visits per citizen per hour: near ones 60, far ones 10. Normalise the counters back to "citizens working now".
    const perHour = n > 0 ? this.hourVisitsScale() : 1;
    for (let g = 0; g < this.working.length; g++) { this.working[g] /= perHour; this.expected[g] /= perHour; }
    this.E.hourly(this.minute, this.ringNear.length + this.ringFar.length, this.working, this.expected, { poor, employed, wealth, crime: this.E.macro.crime + (crimeNow - this.E.macro.crime) * 0.2 });
    this.stats.poor = poor; this.stats.employed = employed; this.stats.avgMoney = avg; this.stats.day = this.day; this.stats.visits = this.visits;
    this.working.fill(0); this.expected.fill(0); a.n = a.poor = a.employed = a.money = a.crime = 0;
  }
  private hourVisitsScale() { const near = this.ringNear.length, far = this.ringFar.length; return near > 0 ? (near * 60 + far * 10) / Math.max(1, near + far) : 60; }

  // ---------------------------------------------------------------- events from outside
  jail(c: Citizen, days: number, why?: string) { c.st = ST.JAILED; c.until = this.minute + days * 1440; void why; }
  hospitalise(c: Citizen, days: number) { c.st = ST.HOSPITAL; c.until = this.minute + days * 1440; }
  kill(c: Citizen, by: string) {
    if (c.st === ST.DEAD) return; c.st = ST.DEAD; this.deaths.add(c.id); this.unfac(c);
    const f = c.fac ? this.factions.get(c.fac) : undefined; if (f && f.boss === c.id) { f.boss = -1; this.succeed(f); }
    this.onDeath?.(c, by);
  }
  /** a boss is gone: the next in line takes the chair */
  succeed(f: Faction) {
    const def = this.C.factions.get(f.type); if (!def) return; let best: Citizen | undefined;
    for (const c of this.byId.values()) if (c.fac === f.key && c.st !== ST.DEAD && c.st !== ST.JAILED && (!best || c.rep > best.rep)) best = c;
    if (best) { best.rank = def.ranks.length - 1; f.boss = best.id; this.news(`${nameOf(best)} is the new ${def.ranks[def.ranks.length - 1]} of ${f.name}.`, 'faction', f.x, f.z, true); }
  }
  facMembers(f: Faction) { const out: Citizen[] = []; for (const c of this.byId.values()) if (c.fac === f.key && c.st !== ST.DEAD) out.push(c); return out; }

  // ---------------------------------------------------------------- save
  save() {
    const fac: Record<string, any> = { ...this.facSaved };
    for (const f of this.factions.values()) fac[f.key] = { boss: f.boss, power: Math.round(f.power), money: Math.round(f.money), rival: f.rival, name: f.name, heat: +f.heat.toFixed(3) };
    const keys = Object.keys(fac); if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete fac[k];
    return { v: 1, seed: this.seed, minute: Math.round(this.minute), econ: this.E.save(), fac, deaths: [...this.deaths].slice(-3000) };
  }
  load(s: any) {
    if (!s || s.v !== 1) return;
    try { this.E.load(s.econ); this.facSaved = s.fac ?? {}; this.deaths = new Set(s.deaths ?? []); } catch { /* ignore a bad save */ }
  }
}
