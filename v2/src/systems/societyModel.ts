// Society model: the citizen record, the world index (homes, workplaces and hubs by 250 m cell), procedural cell
// population, factions, and the daily schedule. Pure data and functions; no renderer, no sim, no DOM.
import type { SiteKind } from '../content/schema';
import { AREA, BK, POI, type Region } from '../world/region';
import { Rng } from '../sim/rng';
import { Content, backstoryOf, genPerson, hash01, hash32 } from './societyData';

export const CELL = 250;
export const cellOf = (v: number) => Math.floor(v / CELL);
export const cellKey = (cx: number, cz: number) => (cx + 512) * 1024 + (cz + 512);
export const cellX = (k: number) => Math.floor(k / 1024) - 512;
export const cellZ = (k: number) => (k % 1024) - 512;

/** What a citizen is doing at the moment. Position and visibility follow from this. */
export const ACT = { SLEEP: 0, HOME: 1, COMMUTE: 2, WORK: 3, LUNCH: 4, MARKET: 5, WORSHIP: 6, BAR: 7, SOCIAL: 8, DRIVE: 9, EVENT: 10, QUEUE: 11, AWAY: 12 } as const;
export const ACT_NAMES = ['asleep', 'at home', 'on the way', 'at work', 'lunch break', 'at the market', 'at worship', 'at the bar', 'hanging out', 'on the road', 'in the crowd', 'in the fuel queue', 'away'];
export const ST = { OK: 0, JAILED: 1, HOSPITAL: 2, DEAD: 3, BANNED: 4 } as const;

export interface Site { kind: SiteKind; x: number; z: number; name: string | null }
export interface Home { x: number; z: number; rich: number; area: number; zone: number }

export interface Citizen {
  id: number; cell: number; first: string; last: string; nick: string; female: boolean; eth: number; faith: 0 | 1 | 2; age: number;
  occ: number; fac: string; rank: number; rep: number;
  hx: number; hz: number; wx: number; wz: number; mx: number; mz: number; px: number; pz: number; bx: number; bz: number;
  hrich: number; rent: number; m: number; poor: number; income: number;
  food: number; rest: number; soc: number;
  tr: number[]; ag: number; co: number; gr: number; lo: number; fa: number;
  rel: number[];
  st: number; until: number;
  seed: number; vis: number; wj: number; sj: number;
  scars: number; face: number; gear: number; veh: number;
  act: number; body: number; day: number; area: string;
  /** a nemesis record exists for this citizen (see nemesis.ts) */
  nem?: boolean;
}
export const nameOf = (c: Citizen) => `${c.first} ${c.last}`;

export interface Faction {
  key: string; type: string; name: string; x: number; z: number;
  boss: number; members: number; power: number; money: number; rival: string; war: number; raid: number; area: string; heat: number;
}

// ---------------------------------------------------------------- world index
export class WorldIndex {
  homes = new Map<number, Home[]>(); sites = new Map<number, Site[]>(); area = new Map<number, number>();
  names: { x: number; z: number; name: string }[] = [];
  private done = new Set<string>(); private near = new Map<string, Site[]>();
  has(i: number, j: number) { return this.done.has(`${i},${j}`); }
  regionReady(cx: number, cz: number) { const s = 2000 / CELL; return this.done.has(`${Math.floor(cx / s)},${Math.floor(cz / s)}`); }
  private addSite(kind: SiteKind, x: number, z: number, name: string | null) {
    const k = cellKey(cellOf(x), cellOf(z)); let l = this.sites.get(k); if (!l) { l = []; this.sites.set(k, l); }
    // one site of a kind per 12 m: a market is many buildings and one place
    for (const o of l) if (o.kind === kind && Math.abs(o.x - x) < 12 && Math.abs(o.z - z) < 12) return;
    l.push({ kind, x, z, name });
  }
  /** Indexes one loaded region (cost is linear in its buildings and parcels). */
  index(r: Region) { for (const _ of this.indexGen(r)) void _; }
  *indexGen(r: Region): Generator<void> {
    const key = `${r.i},${r.j}`; if (this.done.has(key)) return; this.done.add(key);
    let n0 = 0;
    for (const b of r.buildings) {
      if (++n0 % 500 === 0) yield;
      const k = cellKey(cellOf(b.cx), cellOf(b.cz)); this.area.set(k, (this.area.get(k) ?? 0) + 1);
      switch (b.kind) {
        case BK.church: this.addSite('church', b.cx, b.cz, b.name); break;
        case BK.mosque: this.addSite('mosque', b.cx, b.cz, b.name); break;
        case BK.market: this.addSite('market', b.cx, b.cz, b.name); break;
        case BK.bank: this.addSite('bank', b.cx, b.cz, b.name); break;
        case BK.terminal: case BK.station: this.addSite('busStop', b.cx, b.cz, b.name); break;
        case BK.stand: this.addSite('stand', b.cx, b.cz, b.name); break;
        case BK.shops: this.addSite('shops', b.cx, b.cz, b.name); break;
        case BK.institution: this.addSite('institution', b.cx, b.cz, b.name); break;
        case BK.hotel: this.addSite('bar', b.cx, b.cz, b.name); break;
      }
    }
    for (const p of r.pois) {
      if (++n0 % 500 === 0) yield;
      if (p.kind >= 30 && p.kind <= 35 && p.name) { this.names.push({ x: p.x, z: p.z, name: p.name }); continue; }
      switch (p.kind) {
        case POI.busStop: case POI.busStation: this.addSite('busStop', p.x, p.z, p.name); break;
        case POI.fuel: this.addSite('fuel', p.x, p.z, p.name); break;
        case POI.market: this.addSite('market', p.x, p.z, p.name); break;
        case POI.school: this.addSite('school', p.x, p.z, p.name); break;
        case POI.hospital: this.addSite('hospital', p.x, p.z, p.name); break;
        case POI.bank: this.addSite('bank', p.x, p.z, p.name); break;
        case POI.food: this.addSite('food', p.x, p.z, p.name); break;
        case POI.bar: this.addSite('bar', p.x, p.z, p.name); break;
        case POI.police: this.addSite('police', p.x, p.z, p.name); break;
        case POI.mechanic: this.addSite('mechanic', p.x, p.z, p.name); break;
        case POI.shop: this.addSite('shops', p.x, p.z, p.name); break;
        case POI.worship: break; // church or mosque is known from the building
      }
    }
    for (const a of r.areas) {
      const n = a.pts.length / 2; if (n < 3) continue; let cx = 0, cz = 0; for (let q = 0; q < n; q++) { cx += a.pts[q * 2]; cz += a.pts[q * 2 + 1]; } cx /= n; cz /= n;
      switch (a.kind) {
        case AREA.market: this.addSite('market', cx, cz, a.name); break;
        case AREA.school: this.addSite('school', cx, cz, a.name); break;
        case AREA.hospital: this.addSite('hospital', cx, cz, a.name); break;
        case AREA.fuel: this.addSite('fuel', cx, cz, a.name); break;
        case AREA.police: this.addSite('police', cx, cz, a.name); break;
        case AREA.mechanic: this.addSite('mechanic', cx, cz, a.name); break;
        case AREA.busStation: this.addSite('busStop', cx, cz, a.name); break;
      }
    }
    for (const pc of r.parcels) {
      if (++n0 % 500 === 0) yield;
      if (pc.zone !== 1 && pc.zone !== 5 && pc.zone !== 2) continue; // residential, unfinished (people live in them), shop houses
      const n = pc.pts.length / 2; if (n < 3) continue; let cx = 0, cz = 0; for (let q = 0; q < n; q++) { cx += pc.pts[q * 2]; cz += pc.pts[q * 2 + 1]; } cx /= n; cz /= n;
      const k = cellKey(cellOf(cx), cellOf(cz)); let l = this.homes.get(k); if (!l) { l = []; this.homes.set(k, l); }
      l.push({ x: cx, z: cz, rich: pc.rich, area: 0, zone: pc.zone });
    }
  }
  /** Up to `max` sites of a kind nearest to a cell, within 900 m. Cached per cell and kind. */
  nearest(kind: SiteKind, cx: number, cz: number, max = 8): Site[] {
    const ck = `${kind}:${cx}:${cz}`; const hit = this.near.get(ck); if (hit) return hit;
    const px = (cx + 0.5) * CELL, pz = (cz + 0.5) * CELL; const out: { s: Site; d: number }[] = [];
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) for (const s of this.sites.get(cellKey(cx + i, cz + j)) ?? []) if (s.kind === kind) out.push({ s, d: Math.hypot(s.x - px, s.z - pz) });
    out.sort((a, b) => a.d - b.d); const res = out.slice(0, max).filter((o) => o.d < 900).map((o) => o.s);
    if (this.near.size > 4000) this.near.clear();
    this.near.set(ck, res); return res;
  }
  /** Neighbourhood name nearest to a point (from the OSM place nodes), or '' */
  areaName(x: number, z: number) {
    let best = '', bd = 3200;
    for (const n of this.names) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n.name; } }
    return best;
  }
  /** Ward label for a cell with some character: its neighbourhood name */
  density(cx: number, cz: number) { return this.area.get(cellKey(cx, cz)) ?? 0; }
}

// ---------------------------------------------------------------- generation
export interface GenEnv { content: Content; world: WorldIndex; seed: number; factionFor(type: string, x: number, z: number, site: Site | null, area: string): Faction | null; wealth: (cx: number, cz: number) => number }

export function popOfCell(w: WorldIndex, cx: number, cz: number) {
  const homes = w.homes.get(cellKey(cx, cz))?.length ?? 0;
  return Math.min(200, Math.round(homes * 1.35));
}

/** Procedurally populates one cell. Same seed and same map give the same people. */
export function genCell(env: GenEnv, cx: number, cz: number): Citizen[] { const g = genCellGen(env, cx, cz); for (;;) { const r = g.next(); if (r.done) return r.value; } }
export function* genCellGen(env: GenEnv, cx: number, cz: number): Generator<void, Citizen[]> {
  const { content: C, world: W } = env; const key = cellKey(cx, cz);
  const homes = W.homes.get(key); if (!homes || !homes.length) return [];
  const n = popOfCell(W, cx, cz); const r = new Rng(hash32(env.seed, key, 7));
  const out: Citizen[] = [];
  const area = W.areaName((cx + 0.5) * CELL, (cz + 0.5) * CELL) || 'Lagos';
  const wealth = env.wealth(cx, cz);
  const nameOfSite = (s: Site | null) => s?.name ?? '';
  void nameOfSite;
  // choose a workplace site: one of the nearest few, weighted toward nearer ones
  const pickSite = (kinds: SiteKind[], hx: number, hz: number): Site | null => {
    for (const k of kinds) {
      if (k === 'street') return null;
      const l = W.nearest(k, cx, cz, 6); if (!l.length) continue;
      const w = l.map((s) => 1 / (1 + Math.hypot(s.x - hx, s.z - hz) / 150)); let t = r.next() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < l.length; i++) { t -= w[i]; if (t <= 0) return l[i]; } return l[0];
    }
    return null;
  };
  let hi = 0; let k = 0;
  const homeOrder = r.shuffle(homes.slice());
  while (k < n && k < 255) {
    const home = homeOrder[hi++ % homeOrder.length]; yield;
    // a household: head, maybe a spouse, up to three grown children
    const size = Math.min(n - k, 1 + (r.chance(0.55) ? 1 : 0) + (r.chance(0.5) ? r.int(1, 3) : 0));
    const headFemale = r.chance(0.4); const headAge = r.int(26, 68);
    const person0 = genPerson(C, r, headFemale, headAge); const last = person0.last;
    const hh: Citizen[] = [];
    for (let m = 0; m < size; m++) {
      const spouse = m === 1 && size >= 2 && r.chance(0.7);
      const female = m === 0 ? headFemale : spouse ? !headFemale : r.chance(0.5);
      const age = m === 0 ? headAge : spouse ? Math.max(20, Math.min(75, headAge + r.int(-6, 6))) : r.int(14, Math.max(15, Math.min(34, headAge - 18)));
      const p = m === 0 ? person0 : genPerson(C, r, female, age);
      if (m > 0) { p.last = last; p.eth = person0.eth; p.faith = person0.faith; const nm = C.names[p.eth]; p.first = r.pick(female ? nm.female : nm.male); }
      const occ = C.pickOcc(r, female, age, home.rich * 0.8 + wealth * 0.2);
      const o = C.occ[occ];
      const id = key * 256 + k; k++;
      const site = pickSite(o.sites, home.x, home.z);
      const wage = C.wages.get(o.wage);
      let wx: number, wz: number;
      if (site) { wx = site.x; wz = site.z; }
      else { const a = r.range(0, 6.283), d = r.range(15, 110); wx = home.x + Math.cos(a) * d; wz = home.z + Math.sin(a) * d; }
      const facDef = o.faction ? C.factions.get(o.faction) : undefined;
      let facKey = '';
      if (facDef) {
        let anchor = site;
        if (facDef.cell === 'site' && facDef.siteKind && (!anchor || anchor.kind !== facDef.siteKind)) anchor = pickSite([facDef.siteKind], home.x, home.z);
        const f = facDef.cell === 'site' ? (anchor ? env.factionFor(o.faction!, anchor.x, anchor.z, anchor, area) : null) : env.factionFor(o.faction!, (cx + 0.5) * CELL, (cz + 0.5) * CELL, null, area);
        if (f) { facKey = f.key; if (facDef.cell === 'cell' || !site) { wx = f.x + (hash01(id, 1) - 0.5) * 26; wz = f.z + (hash01(id, 2) - 0.5) * 26; } }
      }
      const hub = (kind: SiteKind) => { const l = W.nearest(kind, cx, cz, 4); const s = l.length ? l[hash32(id, 5) % l.length] : null; return s; };
      const mk = female || r.chance(0.3) ? hub('market') : hub('food') ?? hub('market');
      const wk = hub(p.faith === 2 ? 'mosque' : 'church');
      const bar = hub('bar') ?? hub('shops');
      // traits and temperament
      const tr: number[] = []; tr.push(C.pickTrait(r)); tr.push(C.pickTrait(r, tr));
      let ag = 0.4 + r.range(-0.15, 0.15), co = 0.45 + r.range(-0.15, 0.15), gr = 0.45 + r.range(-0.2, 0.2), lo = 0.5 + r.range(-0.15, 0.15), fa = p.faith ? 0.5 + r.range(-0.3, 0.4) : 0.1;
      for (const t of tr) { const T = C.traits[t]; ag += T.aggression; co += T.courage; gr += T.greed; lo += T.loyalty; fa += T.faith ?? 0; }
      if (o.role === 'area') { ag += 0.2; co += 0.1; } if (o.role === 'police') { co += 0.15; ag += 0.1; }
      const cl = (v: number) => Math.max(0.02, Math.min(0.98, v));
      const base = wage ? wage.daily : 3000;
      const c: Citizen = {
        id, cell: key, first: p.first, last: p.last, nick: '', female, eth: p.eth, faith: p.faith, age,
        occ, fac: facKey, rank: 0, rep: 0,
        hx: home.x, hz: home.z, wx, wz, mx: mk?.x ?? home.x, mz: mk?.z ?? home.z, px: wk?.x ?? home.x, pz: wk?.z ?? home.z, bx: bar?.x ?? home.x, bz: bar?.z ?? home.z,
        hrich: home.rich, rent: Math.round((C.rent.poor + (C.rent.rich - C.rent.poor) * home.rich * home.rich) * r.range(0.7, 1.3) / 5000) * 5000, m: Math.round(base * (1 + home.rich * 3) * r.range(0.5, 6)), poor: 0, income: base,
        food: r.range(0, 0.5), rest: r.range(0, 0.4), soc: r.range(0, 0.6),
        tr, ag: cl(ag), co: cl(co), gr: cl(gr), lo: cl(lo), fa: cl(fa), rel: [],
        st: ST.OK, until: 0, seed: hash32(id, env.seed), vis: r.next(), wj: r.range(-1, 1), sj: r.range(0, 120),
        scars: o.role === 'area' && r.chance(0.3) ? r.range(0.1, 0.45) : 0, face: 0, gear: o.role === 'area' && r.chance(0.5) ? 1 : 0, veh: o.vehicle ? 1 : 0,
        act: ACT.SLEEP, body: -1, day: 0, area,
      };
      // rank within a faction: most are plain members
      if (facKey && facDef) { const x = r.next(); c.rank = x < 0.62 ? 0 : x < 0.86 ? 1 : x < 0.96 ? 2 : x < 0.992 ? 3 : 4; c.rank = Math.min(c.rank, facDef.ranks.length - 1); c.rep = c.rank * 25 + r.int(0, 20); }
      hh.push(c); out.push(c);
    }
    // relations: the household, a friend and a rival in the cell
    for (let a = 0; a < hh.length; a++) for (let b = 0; b < hh.length; b++) if (a !== b && hh[a].rel.length < 8) hh[a].rel.push(hh[b].id, a === 0 && b === 1 || a === 1 && b === 0 ? 1 : 0);
  }
  if (out.length > 4) for (const c of out) {
    if (c.rel.length < 10 && r.chance(0.7)) { const f = out[r.int(0, out.length - 1)]; if (f.id !== c.id && !c.rel.includes(f.id)) c.rel.push(f.id, 2); }
    if (c.rel.length < 10 && r.chance(0.2)) { const f = out[r.int(0, out.length - 1)]; if (f.id !== c.id && !c.rel.includes(f.id) && f.fac !== c.fac) c.rel.push(f.id, 3); }
  }
  return out;
}

// ---------------------------------------------------------------- schedule
export const SUNDAY = 0, FRIDAY = 5;
export interface Slot { act: number; /** progress along the commute, 0..1 from home to work (reversed when walking home) */ p: number; back: boolean }
const slot: Slot = { act: 0, p: 0, back: false };

/** What a citizen is doing at an hour of the day. Allocation free: returns a shared scratch slot. */
export function actAt(C: Content, c: Citizen, hour: number, dow: number, day: number, ignoreStatus = false): Slot {
  const o = C.occ[c.occ]; const s = o.sched;
  slot.p = 0; slot.back = false;
  if (!ignoreStatus && (c.st === ST.JAILED || c.st === ST.HOSPITAL || c.st === ST.DEAD)) { slot.act = ACT.AWAY; return slot; }
  let wake = s.wake + c.wj * s.jitter * 0.6, start = s.start + c.wj * s.jitter * 0.5, end = s.end + c.wj * s.jitter * 0.5;
  const dist = Math.hypot(c.hx - c.wx, c.hz - c.wz); const cd = Math.max(0.06, Math.min(0.6, dist / 1.35 / 3600));
  const night = end > 24 || start > 18;
  const off = s.weekend === 'off' && (dow === SUNDAY || dow === 6);
  // a day-keyed roll decides who skips a day: sickness, a funeral, a long weekend
  const skip = hash01(c.id, day, 3) < 0.045;
  const working = !off && !skip && (ignoreStatus || c.st !== ST.BANNED);
  let h = hour;
  if (night) { // a shift that crosses midnight: shift the clock so the shift sits in one piece
    if (h < 12) h += 24;
    if (start < 12) start += 24;
    wake = wake < 12 ? wake + 24 : wake;
    if (wake > start) wake -= 24;
  }
  // Sunday and Friday worship
  if (dow === SUNDAY && c.faith === 1 && c.fa > 0.35 && hour >= 8.2 + c.wj * 0.3 && hour < 11.4) { slot.act = ACT.WORSHIP; return slot; }
  if (dow === FRIDAY && c.faith === 2 && c.fa > 0.3 && hour >= 13.0 && hour < 14.3) { slot.act = ACT.WORSHIP; return slot; }
  if (working) {
    if (h >= start - cd && h < start) { slot.act = ACT.COMMUTE; slot.p = (h - (start - cd)) / cd; return slot; }
    if (h >= start && h < end) {
      if (s.lunch && !night && hour >= 12.6 + c.wj * 0.4 && hour < 13.3 + c.wj * 0.4) { slot.act = ACT.LUNCH; return slot; }
      slot.act = o.vehicle && hash01(c.id, day) < 0.8 ? ACT.DRIVE : ACT.WORK; return slot;
    }
    if (h >= end && h < end + cd) { slot.act = ACT.COMMUTE; slot.p = (h - end) / cd; slot.back = true; return slot; }
  }
  // asleep until wake, and from bedtime
  const bed = night ? 8 : 22.3 + c.wj * 0.8;
  if (night ? (hour >= 8 && hour < 15.5 + c.wj) : (hour >= bed || hour < wake)) { slot.act = ACT.SLEEP; return slot; }
  if (hour < wake + 0.6) { slot.act = ACT.HOME; return slot; }
  // spare time: a stable pick for the evening
  const roll = hash01(c.id, day, 11);
  if (dow === 3 && c.faith && c.fa > 0.6 && hour >= 17.3 && hour < 19.2) { slot.act = ACT.WORSHIP; return slot; }
  if (hour >= 16 && hour < 18.2 && c.female && roll < 0.35) { slot.act = ACT.MARKET; return slot; }
  if (hour >= 18.5 && hour < 22 && !c.female && c.faith !== 2 && roll < 0.12 + c.gr * 0.3 && c.m > 2500) { slot.act = ACT.BAR; return slot; }
  if (hour >= 17 && hour < 21.5 && roll > 0.55) { slot.act = ACT.SOCIAL; return slot; }
  if (!off && !working && hour >= 9 && hour < 18 && roll < 0.5) { slot.act = ACT.MARKET; return slot; }
  slot.act = ACT.HOME; return slot;
}

/** Where a slot puts the citizen (written into out), or false when they are indoors or away. */
export function placeOf(c: Citizen, sl: Slot, out: { x: number; z: number }): boolean {
  switch (sl.act) {
    case ACT.SLEEP: case ACT.AWAY: return false;
    case ACT.HOME: out.x = c.hx; out.z = c.hz; return c.vis < 0.4;
    case ACT.SOCIAL: out.x = c.hx + (c.vis - 0.5) * 60; out.z = c.hz + (hash01(c.id, 9) - 0.5) * 60; return true;
    case ACT.COMMUTE: { const t = sl.back ? 1 - sl.p : sl.p; out.x = c.hx + (c.wx - c.hx) * t; out.z = c.hz + (c.wz - c.hz) * t; return true; }
    case ACT.WORK: case ACT.DRIVE: out.x = c.wx; out.z = c.wz; return true;
    case ACT.LUNCH: case ACT.MARKET: out.x = c.mx; out.z = c.mz; return true;
    case ACT.WORSHIP: out.x = c.px; out.z = c.pz; return true;
    case ACT.BAR: out.x = c.bx; out.z = c.bz; return true;
  }
  return false;
}
/** A bank clerk is mostly inside: at work only some citizens are seen outdoors. */
export function outdoors(C: Content, c: Citizen, sl: Slot) {
  if (sl.act === ACT.WORK || sl.act === ACT.DRIVE) return c.vis < C.occ[c.occ].outdoor;
  return true;
}

export function rankLabel(C: Content, c: Citizen): string {
  if (!c.fac) return C.occ[c.occ].label;
  const type = c.fac.split(':')[0]; const f = C.factions.get(type); return f ? f.ranks[Math.min(c.rank, f.ranks.length - 1)] : C.occ[c.occ].label;
}
export const fullStory = (C: Content, c: Citizen) => backstoryOf(C, { seed: c.seed, first: c.first, last: c.last, female: c.female, age: c.age, eth: c.eth, occ: c.occ, area: c.area });
