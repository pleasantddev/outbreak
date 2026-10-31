// The body, on the server. Everything here is hidden from other players and most of it from the player too:
//   karma: good and bad deeds add up; it pulls a hidden luck number (rules.ts luckOf) that the casino, illness and
//          other systems read.
//   illness: who is sick (symptoms on their screen), who only carries a spreading illness without knowing (luck decides),
//          spreading between players standing close, getting worse untreated, chemists, clinics and hospitals.
//   traits: one or two small weaknesses rolled when the character is made (slow walk, short sight...), some fixable.
//   death: you wake up in the nearest hospital with a bill. Short of money, they take everything you have, put you out in
//          your underwear and the rest becomes a debt that half of every naira you earn pays off.
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError } from './auth.ts';
import type { Economy } from './economy.ts';
import {
  DEBT_GARNISH, DRUGS, HOSPITAL_BILL, ILLNESSES, TRAITS, TRAIT_IDS, carrierChance, hospitalKind, luckOf,
  type DrugId, type IllnessId, type TraitId,
} from '../../v2/src/net/rules.ts';

export interface Ill { id: IllnessId; at: number; carrier: boolean; sev: number; eased?: number }
interface Row { account_id: string; karma: number; seed: number; traits: string; fixed: string; origin: string; ill: string; immune: string; known: string; debt: number; stripped: number; deaths: number; updated_at: number }
export interface Place { id: string; name: string; kind: string; x: number; z: number }
const GAME_HOUR = 120_000; // 30x clock: one game hour is two real minutes
const J = <T>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };
const rand = () => randomInt(0, 2 ** 32) / 2 ** 32;

/** the city's hospitals, clinics, chemists, opticians and markets from content/places.json, in world metres */
export function loadPlaces(dir = resolve(import.meta.dirname, '../../v2/public')): Place[] {
  try {
    const m = JSON.parse(readFileSync(resolve(dir, 'world/manifest.json'), 'utf8')); const o = m.origin;
    const kx = Math.cos((o.lat * Math.PI) / 180) * 111320, kz = 110574;
    const items = JSON.parse(readFileSync(resolve(dir, 'content/places.json'), 'utf8')).items as { id: string; name: string; kind: string; lat: number; lon: number }[];
    return items.filter((p) => ['hospital', 'clinic', 'pharmacy', 'optician', 'market', 'shop', 'phones'].includes(p.kind))
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind, x: (p.lon - o.lon) * kx, z: -(p.lat - o.lat) * kz }));
  } catch { return [{ id: 'lagos_gh', name: 'General Hospital Lagos', kind: 'hospital', x: 6000, z: 11000 }]; }
}

export class Body extends EventEmitter {
  places: Place[];
  private lastExpo = new Map<string, number>();
  constructor(private db: DB, private econ: Economy, places?: Place[]) {
    super();
    this.places = places ?? loadPlaces();
    // a debt comes out of what you earn
    econ.on('income', (accountId: string, amount: number) => this.garnish(accountId, amount));
  }

  // ------------------------------------------------------------------------------------------ the row
  ensure(accountId: string): Row {
    let r = one<Row>(this.db, 'SELECT * FROM player_body WHERE account_id=?', accountId);
    if (r) return r;
    // one or two small weaknesses for most people; about a third of people get none
    const roll = rand(); const n = roll < 0.3 ? 0 : roll < 0.82 ? 1 : 2; const pool = [...TRAIT_IDS]; const traits: TraitId[] = [];
    for (let i = 0; i < n; i++) traits.push(pool.splice(randomInt(0, pool.length), 1)[0]);
    run(this.db, 'INSERT OR IGNORE INTO player_body(account_id, seed, traits, updated_at) VALUES(?,?,?,?)', accountId, rand(), JSON.stringify(traits), Date.now());
    r = one<Row>(this.db, 'SELECT * FROM player_body WHERE account_id=?', accountId)!;
    return r;
  }
  private save(accountId: string, f: Partial<{ karma: number; traits: TraitId[]; fixed: TraitId[]; ill: Ill[]; immune: Record<string, number>; known: IllnessId[]; debt: number; stripped: boolean; deaths: number; origin: string }>) {
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(f)) { sets.push(`${k}=?`); vals.push(typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v); }
    run(this.db, `UPDATE player_body SET ${sets.join(', ')}, updated_at=? WHERE account_id=?`, ...vals, Date.now(), accountId);
  }
  ills(accountId: string) { return J<Ill[]>(this.ensure(accountId).ill, []); }
  /** what the player's own game is told: symptoms (names only once a clinic has named them), traits, debt. Never luck, karma or carrying. */
  view(accountId: string) {
    const r = this.ensure(accountId); const known = new Set(J<IllnessId[]>(r.known, [])); const now = Date.now();
    const ill = J<Ill[]>(r.ill, []).filter((i) => !i.carrier).map((i) => {
      const d = ILLNESSES[i.id]; const eased = (i.eased ?? 0) > now;
      return { key: `${i.id}:${i.at}`, name: known.has(i.id) ? d.name : null, symptoms: eased ? d.symptoms.filter((s) => !DRUGS.paracetamol.eases.includes(s)) : d.symptoms, sev: i.sev, walk: d.walk, eased, drug: known.has(i.id) ? d.drug : null };
    });
    return { traits: J<TraitId[]>(r.traits, []), fixed: J<TraitId[]>(r.fixed, []), ill, debt: r.debt, stripped: !!r.stripped, origin: r.origin, deaths: r.deaths };
  }
  /** the hidden luck number, -100 to 100 */
  luck(accountId: string, now = Date.now()) { const r = this.ensure(accountId); return luckOf(r.karma, r.seed, now); }
  karma(accountId: string, delta: number, why: string) {
    if (!Number.isFinite(delta) || !delta) return; const r = this.ensure(accountId);
    const k = Math.max(-1000, Math.min(1000, r.karma + delta)); this.save(accountId, { karma: k });
    run(this.db, 'INSERT INTO karma_log(account_id, at, delta, why) VALUES(?,?,?,?)', accountId, Date.now(), delta, why.slice(0, 40));
  }
  /** a lucky roll: true with chance p nudged by luck (luck 100 doubles a good chance, -100 halves it) */
  lucky(accountId: string, p: number) { const l = this.luck(accountId); return rand() < Math.max(0, Math.min(1, p * (1 + l / 100))); }

  // ------------------------------------------------------------------------------------------ illness
  /** catch something. Spreading illnesses: luck decides if you just carry it. Returns true if anything changed. */
  infect(accountId: string, id: IllnessId, now = Date.now(), forceCarrier?: boolean) {
    const r = this.ensure(accountId); const ills = J<Ill[]>(r.ill, []); if (ills.some((i) => i.id === id)) return false;
    const immune = J<Record<string, number>>(r.immune, {}); if ((immune[id] ?? 0) > now) return false;
    const d = ILLNESSES[id]; const carrier = forceCarrier ?? (d.spreads && rand() < carrierChance(this.luck(accountId, now)));
    ills.push({ id, at: now, carrier, sev: 1 }); this.save(accountId, { ill: ills });
    if (!carrier) this.emit('sick', accountId, id);
    return true;
  }
  /** things the player's game saw that can make them sick: a night outside, cheap food, dirty water, skipped meals, stress */
  exposure(accountId: string, kind: string, now = Date.now()) {
    const k = `${accountId}:${kind}`; if ((this.lastExpo.get(k) ?? 0) > now - 2 * 60_000) return null; this.lastExpo.set(k, now);
    const traits = J<TraitId[]>(this.ensure(accountId).traits, []); const weak = traits.includes('stomach') ? 1.8 : 1;
    const table: Record<string, [IllnessId, number][]> = {
      mosquito: [['malaria', 0.035]], street_food: [['food', 0.05 * weak], ['typhoid', 0.008 * weak]], dirty_water: [['typhoid', 0.03 * weak], ['cholera', 0.012 * weak]],
      hungry: [['ulcer', 0.03]], stress: [['bp', 0.012]], harmattan: [['cough', 0.03]],
    };
    const l = this.luck(accountId, now);
    for (const [id, p] of table[kind] ?? []) if (rand() < p * (1 - l / 200) && this.infect(accountId, id, now)) return id; // bad luck makes it likelier
    return null;
  }
  /**
   * Every few seconds: spreading illnesses jump between players standing close in the same space; illnesses run
   * their course or get worse. Returns the accounts whose view changed (and who collapsed).
   */
  tick(players: { accountId: string; x: number; z: number; space: string }[], now = Date.now(), dtSec = 10) {
    const changed = new Set<string>(); const collapsed = new Set<string>();
    const ill = new Map(players.map((p) => [p.accountId, this.ills(p.accountId)]));
    // spread
    for (const a of players) {
      const src = (ill.get(a.accountId) ?? []).filter((i) => ILLNESSES[i.id].spreads); if (!src.length) continue;
      for (const b of players) {
        if (b === a || b.space !== a.space || Math.hypot(a.x - b.x, a.z - b.z) > 3.5) continue;
        for (const i of src) {
          const p = (ILLNESSES[i.id].spread ?? 0) * (dtSec / 10) * (i.carrier ? 0.7 : 1);
          if (rand() < p && this.infect(b.accountId, i.id, now)) { changed.add(b.accountId); ill.set(b.accountId, this.ills(b.accountId)); }
        }
      }
    }
    // course of each illness
    for (const p of players) {
      const list = this.ills(p.accountId); if (!list.length) continue; let dirty = false; const keep: Ill[] = []; const r = this.ensure(p.accountId); const immune = J<Record<string, number>>(r.immune, {});
      for (const i of list) {
        const d = ILLNESSES[i.id]; const age = (now - i.at) / GAME_HOUR;
        if (age > d.hours * (i.carrier ? 1.5 : 1)) {
          if (!i.carrier && d.worsens && i.sev < 3) { i.sev++; i.at = now - (d.hours * 0.5) * GAME_HOUR; dirty = true; keep.push(i); if (i.sev >= 3) collapsed.add(p.accountId); continue; }
          immune[i.id] = now + 72 * GAME_HOUR; dirty = true; continue; // got over it
        }
        keep.push(i);
      }
      if (dirty) { this.save(p.accountId, { ill: keep, immune }); if (keep.some((i) => !i.carrier) || list.some((i) => !i.carrier)) changed.add(p.accountId); }
    }
    return { changed: [...changed], collapsed: [...collapsed] };
  }
  private nearest(kinds: string[], x: number, z: number, max = Infinity) {
    let best: Place | null = null, bd = max;
    for (const p of this.places) if (kinds.includes(p.kind)) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  where(x: number, z: number) {
    const h = this.nearest(['hospital'], x, z, 90), c = this.nearest(['clinic'], x, z, 60), ph = this.nearest(['pharmacy', 'clinic', 'hospital'], x, z, 60), o = this.nearest(['optician'], x, z, 60);
    return { hospital: h, clinic: c ?? h, pharmacy: ph, optician: o };
  }
  /**
   * Chemist: buy a drug. The right drug clears a mild illness; the wrong one only eases (paracetamol) or does nothing.
   * Clinic: see a doctor (names what you have), run the full test (also finds what you carry), or get treated.
   * Hospital: treats everything; fixes some traits. Optician: glasses.
   */
  treat(accountId: string, pos: { x: number; z: number }, b: { where?: unknown; drug?: unknown; op?: unknown }) {
    const at = this.where(pos.x, pos.z); const where = String(b.where ?? ''); const now = Date.now(); const r = this.ensure(accountId);
    const ills = J<Ill[]>(r.ill, []); const known = new Set(J<IllnessId[]>(r.known, [])); const immune = J<Record<string, number>>(r.immune, {});
    const pay = (n: number, why: string) => this.econ.adjust(accountId, -n, 0, why);
    const cure = (i: Ill) => { immune[i.id] = now + 72 * GAME_HOUR; };
    if (where === 'pharmacy') {
      if (!at.pharmacy) throw new HttpError(400, 'There is no chemist here.');
      const drug = String(b.drug ?? '') as DrugId; const dr = DRUGS[drug]; if (!dr) throw new HttpError(400, 'They do not sell that here.');
      pay(dr.price, 'health.drug');
      const hit = ills.find((i) => !i.carrier && ILLNESSES[i.id].drug === drug && i.sev <= 2);
      if (hit) { cure(hit); this.save(accountId, { ill: ills.filter((i) => i !== hit), immune }); return { ok: true, said: `${dr.name} worked. You feel like yourself again.` }; }
      const eases = ills.filter((i) => !i.carrier && ILLNESSES[i.id].symptoms.some((s) => dr.eases.includes(s)));
      if (eases.length) { for (const i of eases) i.eased = now + 3 * GAME_HOUR; this.save(accountId, { ill: ills }); return { ok: true, said: `${dr.name} takes the edge off for a few hours. It is not going away on its own.` }; }
      return { ok: true, said: `You took ${dr.name}. Nothing changed.` };
    }
    if (where === 'clinic' || where === 'hospital') {
      const place = where === 'clinic' ? at.clinic : at.hospital; if (!place) throw new HttpError(400, where === 'clinic' ? 'There is no clinic here.' : 'There is no hospital here.');
      const op = String(b.op ?? 'see'); const sick = ills.filter((i) => !i.carrier);
      const k = where === 'hospital' ? 1.5 : 1;
      if (op === 'see') { pay(Math.round(3000 * k), 'health.consult'); for (const i of sick) known.add(i.id); this.save(accountId, { known: [...known] });
        return { ok: true, said: sick.length ? `The doctor says: ${sick.map((i) => ILLNESSES[i.id].name).join(', ')}.` : 'The doctor says you are fine. Drink water.' }; }
      if (op === 'test') { pay(Math.round(8000 * k), 'health.test'); for (const i of ills) known.add(i.id); this.save(accountId, { known: [...known] });
        const car = ills.filter((i) => i.carrier); return { ok: true, said: ills.length ? `Lab results: ${ills.map((i) => ILLNESSES[i.id].name + (i.carrier ? ' (you carry it without feeling it)' : '')).join(', ')}.${car.length ? ' You can pass it on, so get it treated.' : ''}` : 'Lab results: clear.' }; }
      if (op === 'treat') {
        const list = ills.filter((i) => known.has(i.id)); if (!list.length) throw new HttpError(400, 'See the doctor first so they know what to treat.');
        const cost = Math.round(list.reduce((n, i) => n + ILLNESSES[i.id].clinic * i.sev, 0) * k); pay(cost, 'health.treat');
        for (const i of list) cure(i); this.save(accountId, { ill: ills.filter((i) => !list.includes(i)), immune });
        this.karma(accountId, 0.5, 'treated'); return { ok: true, said: `Treated: ${list.map((i) => ILLNESSES[i.id].name).join(', ')}. ₦${cost.toLocaleString('en-NG')}.` };
      }
      if (op === 'fix' && where === 'hospital') return this.fixTrait(accountId, 'hospital', String(b.drug ?? ''));
      throw new HttpError(400, 'Bad request.');
    }
    if (where === 'optician') { if (!at.optician) throw new HttpError(400, 'There is no optician here.'); return this.fixTrait(accountId, 'optician', 'myopia'); }
    throw new HttpError(400, 'Where?');
  }
  private fixTrait(accountId: string, where: 'optician' | 'hospital', id: string) {
    const r = this.ensure(accountId); const traits = J<TraitId[]>(r.traits, []); const fixed = J<TraitId[]>(r.fixed, []);
    const t = TRAITS[id as TraitId]; if (!t?.fix || t.fix.where !== where || !traits.includes(id as TraitId)) throw new HttpError(400, 'Nothing to fix there.');
    if (fixed.includes(id as TraitId)) throw new HttpError(409, `You already have ${t.fix.name.toLowerCase()}.`);
    this.econ.adjust(accountId, -t.fix.price, 0, 'health.fix'); fixed.push(id as TraitId); this.save(accountId, { fixed });
    return { ok: true, said: `${t.fix.name}: done. ₦${t.fix.price.toLocaleString('en-NG')}.` };
  }

  // ------------------------------------------------------------------------------------------ death, the bill, the debt
  died(accountId: string, pos: { x: number; z: number }) {
    const r = this.ensure(accountId); const h = this.nearest(['hospital'], pos.x, pos.z) ?? this.places[0];
    const ills = J<Ill[]>(r.ill, []); const sick = ills.filter((i) => !i.carrier);
    const bill = HOSPITAL_BILL[hospitalKind(h.name)] + sick.reduce((n, i) => n + ILLNESSES[i.id].clinic, 0);
    const w = this.econ.wallet(accountId); const have = w.cash + w.bank;
    let paid = 0, owe = 0, stripped = false;
    if (have >= bill) { const fromCash = Math.min(w.cash, bill); this.econ.adjust(accountId, -fromCash, -(bill - fromCash), 'hospital.bill', { note: h.name }); paid = bill; }
    else { if (have > 0) this.econ.adjust(accountId, -w.cash, -w.bank, 'hospital.bill', { note: `${h.name} (short)` }); paid = have; owe = bill - have; stripped = true; }
    // the hospital treats what you came in with; what you only carried stays with you
    const immune = J<Record<string, number>>(r.immune, {}); for (const i of sick) immune[i.id] = Date.now() + 72 * GAME_HOUR;
    this.save(accountId, { ill: ills.filter((i) => i.carrier), immune, debt: r.debt + owe, stripped: stripped || !!r.stripped, deaths: r.deaths + 1 });
    return { hospital: { id: h.id, name: h.name, x: h.x, z: h.z }, bill, paid, owe, debt: r.debt + owe, stripped };
  }
  /** half of what you earn goes to the hospital until the debt is gone */
  garnish(accountId: string, amount: number) {
    const r = one<Row>(this.db, 'SELECT debt FROM player_body WHERE account_id=?', accountId) as Row | undefined; if (!r?.debt || amount <= 0) return 0;
    const take = Math.min(r.debt, Math.floor(amount * DEBT_GARNISH)); if (take <= 0) return 0;
    const w = this.econ.adjust(accountId, -take, 0, 'debt.repay', { clamp: true }); void w;
    this.save(accountId, { debt: r.debt - take }); if (r.debt - take === 0) this.karma(accountId, 3, 'debt cleared');
    this.emit('changed', accountId); return take;
  }
  payDebt(accountId: string, amount: unknown) {
    const r = this.ensure(accountId); const n = Math.min(r.debt, Math.floor(Number(amount))); if (!(n > 0)) throw new HttpError(400, 'You do not owe anything.');
    this.econ.adjust(accountId, -n, 0, 'debt.repay'); this.save(accountId, { debt: r.debt - n }); this.karma(accountId, n / 20000, 'paid debt');
    return { debt: r.debt - n };
  }
  /** okrika clothes from a market stall after the hospital sent you out in your underwear */
  dress(accountId: string, pos: { x: number; z: number }) {
    const r = this.ensure(accountId); if (!r.stripped) return { stripped: false };
    if (!this.nearest(['market', 'shop'], pos.x, pos.z, 120)) throw new HttpError(400, 'Find a market stall that sells clothes.');
    this.econ.adjust(accountId, -3500, 0, 'clothes.okrika'); this.save(accountId, { stripped: false }); return { stripped: false };
  }
  /** what admins see */
  admin(accountId: string) {
    const r = this.ensure(accountId); return { ...this.view(accountId), karma: r.karma, luck: Math.round(this.luck(accountId)), ill: J<Ill[]>(r.ill, []), log: all(this.db, 'SELECT at, delta, why FROM karma_log WHERE account_id=? ORDER BY at DESC LIMIT 30', accountId) };
  }
}
