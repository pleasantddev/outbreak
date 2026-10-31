// Phones as things you own. Every player starts with a Gidi Neo; you can buy others at Computer Village or the Oshodi
// stalls and switch between them. Screens crack from falls and from time; a shop fixes them. A player who repairs
// phones and knows how to hack can quietly keep a copy of yours: from their clone they read your texts, text as you,
// see where you are and move a little money out of your bank, until you switch phones or pay a shop to clean yours.
// It is a game mechanic, nothing more: no real technique lives here.
import { EventEmitter } from 'node:events';
import { randomBytes, randomInt } from 'node:crypto';
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError } from './auth.ts';
import type { Economy } from './economy.ts';
import type { Body, Place } from './body.ts';
import { CLONE_DAY_LIMIT, PHONE_CLEAN_PRICE, PHONE_MODELS, REPAIR_SHARE, lagosDay, type PhoneModelId } from '../../v2/src/net/rules.ts';

export interface Device { id: string; owner_id: string; model: PhoneModelId; crack: number; active: number; cloned_by: string | null; cloned_at: number | null; bought_at: number }
export interface Offer { id: string; from: string; fromName: string; to: string; device: string; price: number; clone: boolean; at: number }
const rand = () => randomInt(0, 2 ** 32) / 2 ** 32;

export class Devices extends EventEmitter {
  offers = new Map<string, Offer>();
  private lastDrop = new Map<string, number>();
  constructor(private db: DB, private econ: Economy, private body: Body) { super(); }
  private get places(): Place[] { return this.body.places; }
  /** cash first, then a transfer from the bank (every phone shop takes transfer) */
  private pay(owner: string, n: number, why: string, note?: string) {
    const w = this.econ.wallet(owner); if (w.cash + w.bank < n) throw new HttpError(402, 'Not enough money.', { code: 'broke' });
    const c = Math.min(w.cash, n); this.econ.adjust(owner, -c, -(n - c), why, { note });
  }
  private shopNear(pos: { x: number; z: number }, r = 80) { return this.places.some((p) => p.kind === 'phones' && Math.hypot(p.x - pos.x, p.z - pos.z) < r); }

  /** everyone starts with a Gidi Neo in hand */
  ensure(owner: string) {
    if (!one(this.db, 'SELECT 1 FROM devices WHERE owner_id=?', owner)) this.add(owner, 'gidi', true);
    return this.list(owner);
  }
  private add(owner: string, model: PhoneModelId, active: boolean) {
    const id = 'dv_' + randomBytes(6).toString('hex');
    if (active) run(this.db, 'UPDATE devices SET active=0 WHERE owner_id=?', owner);
    run(this.db, 'INSERT INTO devices(id, owner_id, model, crack, active, bought_at) VALUES(?,?,?,?,?,?)', id, owner, model, 0, active ? 1 : 0, Date.now());
    return id;
  }
  list(owner: string) { return all<Device>(this.db, 'SELECT * FROM devices WHERE owner_id=? ORDER BY bought_at', owner); }
  active(owner: string) { this.ensure(owner); return one<Device>(this.db, 'SELECT * FROM devices WHERE owner_id=? AND active=1', owner) ?? this.list(owner)[0]; }
  /** what the owner's game sees: never who cloned what */
  view(owner: string) { const l = this.ensure(owner); return l.map((d) => ({ id: d.id, model: d.model, crack: d.crack, active: !!d.active })); }

  buy(owner: string, model: unknown, pos: { x: number; z: number }) {
    const m = PHONE_MODELS[String(model) as PhoneModelId]; if (!m) throw new HttpError(400, 'They do not sell that model.');
    if (!this.shopNear(pos)) throw new HttpError(400, 'Go to Computer Village or a phone stall to buy a phone.');
    if (this.list(owner).length >= 6) throw new HttpError(409, 'You have enough phones. Sell or give one away first.');
    this.pay(owner, m.price, 'phone.buy', m.name);
    this.add(owner, m.id, true); return this.view(owner);
  }
  use(owner: string, id: unknown) {
    const d = one<Device>(this.db, 'SELECT * FROM devices WHERE id=? AND owner_id=?', String(id), owner); if (!d) throw new HttpError(404, 'Not your phone.');
    run(this.db, 'UPDATE devices SET active=CASE WHEN id=? THEN 1 ELSE 0 END WHERE owner_id=?', d.id, owner); return this.view(owner);
  }
  /** a hard fall, a crash, a fight: the screen may crack (tough phones and good luck help; butterfingers does not) */
  drop(owner: string, hard: number, now = Date.now()) {
    if ((this.lastDrop.get(owner) ?? 0) > now - 20_000) return null; this.lastDrop.set(owner, now);
    const d = this.active(owner); if (d.crack >= 3) return null;
    const m = PHONE_MODELS[d.model]; const clumsy = this.body.view(owner).traits.includes('clumsy') ? 1.8 : 1;
    const p = Math.min(0.8, 0.22 * Math.max(0.2, Math.min(3, hard)) * clumsy / m.tough) * (1 - this.body.luck(owner, now) / 250);
    if (rand() >= p) return null;
    run(this.db, 'UPDATE devices SET crack=crack+1 WHERE id=?', d.id); return d.crack + 1;
  }
  /** time does it too: about one crack every few days of play for an ordinary phone */
  age(owner: string, minutes: number) {
    const d = this.active(owner); if (d.crack >= 3) return null; const m = PHONE_MODELS[d.model];
    if (rand() < (0.0012 * minutes) / m.tough) { run(this.db, 'UPDATE devices SET crack=crack+1 WHERE id=?', d.id); return d.crack + 1; }
    return null;
  }
  /** a shop fixes the screen for a share of the phone's price (shops do not clone) */
  shopRepair(owner: string, id: unknown, pos: { x: number; z: number }) {
    const d = one<Device>(this.db, 'SELECT * FROM devices WHERE id=? AND owner_id=?', String(id), owner); if (!d) throw new HttpError(404, 'Not your phone.');
    if (!d.crack) throw new HttpError(400, 'Nothing to fix.'); if (!this.shopNear(pos)) throw new HttpError(400, 'Take it to Computer Village or a phone stall.');
    const price = Math.round(PHONE_MODELS[d.model].price * REPAIR_SHARE[d.crack] / 100) * 100;
    this.pay(owner, price, 'phone.repair'); run(this.db, 'UPDATE devices SET crack=0 WHERE id=?', d.id);
    return { price, phones: this.view(owner) };
  }
  /** a trusted shop wipes the phone; whoever kept a copy loses it */
  clean(owner: string, id: unknown, pos: { x: number; z: number }) {
    const d = one<Device>(this.db, 'SELECT * FROM devices WHERE id=? AND owner_id=?', String(id), owner); if (!d) throw new HttpError(404, 'Not your phone.');
    if (!this.shopNear(pos)) throw new HttpError(400, 'Take it to Computer Village or a phone stall.');
    this.pay(owner, PHONE_CLEAN_PRICE, 'phone.clean'); const had = !!d.cloned_by;
    run(this.db, 'UPDATE devices SET cloned_by=NULL, cloned_at=NULL WHERE id=?', d.id);
    return { found: had, phones: this.view(owner) };
  }

  // ------------------------------------------------------------------------------------------ player repairers
  /** a repairer offers to fix a nearby player's screen. `clone` is the repairer's private choice; the customer never sees it. */
  offer(from: string, fromName: string, to: string, price: unknown, clone: unknown) {
    if (from === to) throw new HttpError(400, 'You cannot fix your own phone like that.');
    const d = this.active(to); if (!d.crack) throw new HttpError(400, 'Their screen is fine.');
    const p = Math.floor(Number(price)); if (!(p >= 500 && p <= 500_000)) throw new HttpError(400, 'Set a price between ₦500 and ₦500,000.');
    for (const [k, o] of this.offers) if (o.from === from || Date.now() - o.at > 120_000) this.offers.delete(k);
    const o: Offer = { id: 'of_' + randomBytes(5).toString('hex'), from, fromName, to, device: d.id, price: p, clone: !!clone, at: Date.now() };
    this.offers.set(o.id, o); return o;
  }
  /** the customer says yes: they pay, the screen is fixed, and maybe the repairer keeps a copy */
  accept(to: string, offerId: unknown, hackLevel: number) {
    const o = this.offers.get(String(offerId)); if (!o || o.to !== to || Date.now() - o.at > 120_000) throw new HttpError(404, 'That offer is gone.');
    this.offers.delete(o.id);
    const d = one<Device>(this.db, 'SELECT * FROM devices WHERE id=?', o.device); if (!d || d.owner_id !== to || !d.crack) throw new HttpError(409, 'Nothing to fix any more.');
    this.econ.transfer(to, o.from, o.price, 'phone repair');
    run(this.db, 'UPDATE devices SET crack=0 WHERE id=?', d.id);
    let cloned = false;
    if (o.clone) {
      // skill makes it work; the customer's luck sometimes makes it quietly fail
      const chance = Math.max(0.1, Math.min(0.95, 0.35 + hackLevel * 0.08 - this.body.luck(to) / 300));
      if (rand() < chance) { run(this.db, 'UPDATE devices SET cloned_by=?, cloned_at=? WHERE id=?', o.from, Date.now(), d.id); cloned = true; }
      this.body.karma(o.from, -6, 'cloned a phone');
    } else this.body.karma(o.from, 1, 'honest repair');
    return { offer: o, cloned };
  }

  // ------------------------------------------------------------------------------------------ the clone
  /** phones I hold a copy of; a copy only works while the owner still uses that phone */
  clones(hacker: string) {
    return all<Device & { name: string | null }>(this.db, 'SELECT d.*, p.name FROM devices d LEFT JOIN profiles p ON p.account_id=d.owner_id WHERE d.cloned_by=? ORDER BY d.cloned_at DESC', hacker)
      .map((d) => ({ device: d.id, owner: d.owner_id, name: d.name ?? 'Someone', model: d.model, live: !!d.active, since: d.cloned_at }));
  }
  /** a live clone or an error */
  clone(hacker: string, device: unknown) {
    const d = one<Device>(this.db, 'SELECT * FROM devices WHERE id=? AND cloned_by=?', String(device), hacker); if (!d) throw new HttpError(404, 'You have no copy of that phone.');
    if (!d.active) throw new HttpError(409, 'They are using another phone now. Your copy shows nothing new.');
    return d;
  }
  /** move money out of a cloned phone's bank app, a little per day; the owner may get an alert */
  steal(hacker: string, device: unknown, amount: unknown) {
    const d = this.clone(hacker, device); const n = Math.floor(Number(amount)); if (!(n >= 100)) throw new HttpError(400, 'Bad amount.');
    const day = lagosDay(Date.now()); const since = Date.parse(day + 'T00:00:00Z') - 3600_000;
    const used = one<{ s: number }>(this.db, "SELECT COALESCE(SUM(amount),0) s FROM clone_moves WHERE device=? AND kind='bank' AND at>?", d.id, since)!.s;
    const take = Math.min(n, CLONE_DAY_LIMIT - used, this.econ.wallet(d.owner_id).bank); if (take <= 0) throw new HttpError(409, 'Nothing more to move today.');
    this.econ.adjust(d.owner_id, 0, -take, 'bank.transfer.out', { note: 'phone' }); this.econ.adjust(hacker, take, 0, 'clone.cash');
    run(this.db, 'INSERT INTO clone_moves(device, hacker, kind, amount, at) VALUES(?,?,?,?,?)', d.id, hacker, 'bank', take, Date.now());
    this.body.karma(hacker, -take / 4000, 'stole through a clone');
    // the owner's luck decides whether the bank warns them
    const alert = rand() < Math.max(0.2, Math.min(0.9, 0.5 + this.body.luck(d.owner_id) / 200));
    if (alert) this.emit('alert', d.owner_id, `Your bank: ₦${take.toLocaleString('en-NG')} went out from your phone. Not you? Clean your phone at a phone shop.`);
    return { took: take, alerted: alert };
  }
  noteMove(device: string, hacker: string, kind: string) { run(this.db, 'INSERT INTO clone_moves(device, hacker, kind, at) VALUES(?,?,?,?)', device, hacker, kind, Date.now()); }
}
