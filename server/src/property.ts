// Property Manager on the server: listings (sell it yourself or through an agency), agency rentals, sports venues as
// ownable property, and pitch/court bookings. The founder's rule: property that is not listed shows no price and
// nobody else can buy it. Rules and numbers live in v2/src/net/sports.ts so the phone shows what the server will do.
import { randomInt } from 'node:crypto';
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError } from './auth.ts';
import type { Economy } from './economy.ts';
import { BIZ_MAX, bizType, worldHours } from '../../v2/src/net/rules.ts';
import {
  agencyFor, agentStep, askOk, ASK_RANGE, FEE_RANGE, OWNER_SHARE, PROP_KINDS, SLOT_AHEAD, slotNow, VENUE_MAX, VENUE_REACH, VENUES, venueParse, venuePrice,
  type ListingState, type ListMode, type PropKind,
} from '../../v2/src/net/sports.ts';

const rand = () => randomInt(0, 2 ** 32) / 2 ** 32;
interface ListingRow { kind: PropKind; id: string; owner_id: string; mode: ListMode; price: number; rent: number; hour: number; listed_at: number; log: string; owner_name?: string | null }
interface VenueRow { id: string; owner_id: string; fee: number; earned: number; bought_at: number; owner_name?: string | null }
interface BookingRow { venue: string; slot: number; by_id: string; fee: number; by_name?: string | null }
type At = { x: number; z: number; interior: string | null };
export interface ListingView { kind: PropKind; id: string; owner: string; ownerName: string; mode: ListMode; agency: string | null; price: number; rent: boolean; log: ListingState['log']; listedAt: number }

export class Properties {
  constructor(private db: DB, private econ: Economy, private now: () => number = Date.now) {}

  // ---------------------------------------------------------------- who owns what, and what it is worth
  ownerOf(kind: PropKind, id: string): string | null {
    if (kind === 'plot') return one<{ owner_id: string }>(this.db, 'SELECT owner_id FROM plots WHERE id=?', id)?.owner_id ?? null;
    if (kind === 'biz') return one<{ owner_id: string }>(this.db, 'SELECT owner_id FROM businesses WHERE site=?', id)?.owner_id ?? null;
    return one<{ owner_id: string }>(this.db, 'SELECT owner_id FROM venues WHERE id=?', id)?.owner_id ?? null;
  }
  valueOf(kind: PropKind, id: string): number {
    if (kind === 'plot') { const p = one<{ price: number }>(this.db, 'SELECT price FROM plots WHERE id=?', id); return Math.max(1_500_000, p?.price ?? 0); }
    if (kind === 'biz') { const b = one<{ type: string }>(this.db, 'SELECT type FROM businesses WHERE site=?', id); return bizType(b?.type ?? '')?.price ?? 0; }
    return venuePrice(id);
  }
  private name(acc: string) { return one<{ name: string }>(this.db, 'SELECT name FROM profiles WHERE account_id=?', acc)?.name ?? 'Somebody'; }
  private kindOf(k: unknown): PropKind { const s = String(k ?? ''); if (!PROP_KINDS.includes(s as PropKind)) throw new HttpError(400, 'Bad property type.'); return s as PropKind; }
  /** pay from cash first, then the bank */
  private pay(acc: string, n: number, kind: string, ref: string) {
    const w = this.econ.wallet(acc); if (w.cash + w.bank < n) throw new HttpError(402, 'Not enough money.', { code: 'broke' });
    const c = Math.min(w.cash, n); return this.econ.adjust(acc, -c, -(n - c), kind, { ref });
  }
  /** everything a player owns, across kinds */
  owned(acc: string) {
    const plots = all<{ id: string; price: number }>(this.db, 'SELECT id, price FROM plots WHERE owner_id=?', acc).map((p) => ({ kind: 'plot' as const, id: p.id, value: Math.max(1_500_000, p.price) }));
    const biz = all<{ site: string; type: string }>(this.db, 'SELECT site, type FROM businesses WHERE owner_id=?', acc).map((b) => ({ kind: 'biz' as const, id: b.site, value: bizType(b.type)?.price ?? 0, type: b.type }));
    const ven = all<VenueRow>(this.db, 'SELECT * FROM venues WHERE owner_id=?', acc).map((v) => ({ kind: 'venue' as const, id: v.id, value: venuePrice(v.id), fee: v.fee, earned: v.earned }));
    return [...plots, ...biz, ...ven].map((p) => ({ ...p, listing: this.listingView(this.advance(p.kind, p.id)) }));
  }

  // ---------------------------------------------------------------- listings
  private listingRow(kind: PropKind, id: string) { return one<ListingRow>(this.db, 'SELECT l.*, f.name AS owner_name FROM listings l LEFT JOIN profiles f ON f.account_id=l.owner_id WHERE l.kind=? AND l.id=?', kind, id); }
  private listingView(r: ListingRow | undefined | null): ListingView | null {
    if (!r) return null;
    return { kind: r.kind, id: r.id, owner: r.owner_id, ownerName: r.owner_name ?? 'Somebody', mode: r.mode, agency: r.mode === 'agent' ? agencyFor(r.id) : null, price: r.price, rent: !!r.rent, log: JSON.parse(r.log || '[]'), listedAt: r.listed_at };
  }
  /** run an agency listing to the present: rent paid in, maybe a sale to an NPC buyer */
  private advance(kind: PropKind, id: string): ListingRow | null {
    const r = this.listingRow(kind, id); if (!r) return null;
    if (r.owner_id !== this.ownerOf(kind, id)) { run(this.db, 'DELETE FROM listings WHERE kind=? AND id=?', kind, id); return null; } // owner changed some other way
    const to = worldHours(this.now()); if (r.mode !== 'agent' || Math.floor(to) <= r.hour) return r;
    const st: ListingState = { hour: r.hour, log: JSON.parse(r.log || '[]') };
    const res = agentStep(st, { mode: r.mode, price: r.price, value: this.valueOf(kind, id), rent: !!r.rent }, to, rand);
    return this.db.transaction(() => {
      if (res.paid > 0) this.econ.adjust(r.owner_id, 0, res.paid, res.sold ? 'prop.sold.agent' : 'prop.rent', { ref: propRef(kind, id) });
      if (res.sold) { this.release(kind, id); run(this.db, 'DELETE FROM listings WHERE kind=? AND id=?', kind, id); this.onChange?.(kind, id, null, null); return null; }
      run(this.db, 'UPDATE listings SET hour=?, log=? WHERE kind=? AND id=?', st.hour, JSON.stringify(st.log), kind, id);
      return { ...r, hour: st.hour, log: JSON.stringify(st.log) };
    })();
  }
  /** a sale to an NPC: the property goes back to the market */
  private release(kind: PropKind, id: string) {
    if (kind === 'plot') this.econ.setPlotOwner(id, null);
    else if (kind === 'biz') run(this.db, 'DELETE FROM businesses WHERE site=?', id);
    else { run(this.db, 'DELETE FROM venues WHERE id=?', id); run(this.db, 'DELETE FROM bookings WHERE venue=? AND slot>=?', id, slotNow(this.now())); }
  }
  private transfer(kind: PropKind, id: string, to: string) {
    if (kind === 'plot') this.econ.setPlotOwner(id, to);
    else if (kind === 'biz') run(this.db, 'UPDATE businesses SET owner_id=? WHERE site=?', to, id);
    else run(this.db, 'UPDATE venues SET owner_id=?, earned=0 WHERE id=?', to, id);
  }
  /** called when ownership changes (the hub tells everybody) */
  onChange?: (kind: PropKind, id: string, owner: string | null, ownerName: string | null) => void;

  list(acc: string, a: Record<string, unknown>) {
    const kind = this.kindOf(a.kind), id = String(a.id ?? ''); const mode: ListMode = a.mode === 'agent' ? 'agent' : 'self';
    if (this.ownerOf(kind, id) !== acc) throw new HttpError(404, 'That property is not yours.');
    const value = this.valueOf(kind, id); const price = Math.round(Number(a.price));
    if (!askOk(mode, price, value)) { const [lo, hi] = ASK_RANGE[mode]; throw new HttpError(400, mode === 'agent' ? `The agency will only list between ₦${Math.round(value * lo).toLocaleString('en-NG')} and ₦${Math.round(value * hi).toLocaleString('en-NG')}.` : `Price must be between ₦${Math.round(value * lo).toLocaleString('en-NG')} and ₦${Math.round(value * hi).toLocaleString('en-NG')}.`); }
    const rent = mode === 'agent' && !!a.rent ? 1 : 0;
    run(this.db, 'INSERT INTO listings(kind,id,owner_id,mode,price,rent,hour,listed_at,log) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET mode=excluded.mode, price=excluded.price, rent=excluded.rent',
      kind, id, acc, mode, price, rent, Math.floor(worldHours(this.now())), this.now(), '[]');
    return this.listingView(this.listingRow(kind, id))!;
  }
  unlist(acc: string, a: Record<string, unknown>) {
    const kind = this.kindOf(a.kind), id = String(a.id ?? ''); const r = this.advance(kind, id);
    if (!r || r.owner_id !== acc) throw new HttpError(404, 'Not listed.');
    run(this.db, 'DELETE FROM listings WHERE kind=? AND id=?', kind, id); return true;
  }
  /** everything for sale right now (prices only exist for listed property) */
  market(kind?: unknown) {
    const k = kind ? this.kindOf(kind) : null;
    const rows = all<{ kind: PropKind; id: string }>(this.db, k ? 'SELECT kind, id FROM listings WHERE kind=? ORDER BY listed_at DESC LIMIT 200' : 'SELECT kind, id FROM listings ORDER BY listed_at DESC LIMIT 200', ...(k ? [k] : []));
    return rows.map((r) => this.listingView(this.advance(r.kind, r.id))).filter((x): x is ListingView => !!x).map(({ log: _l, ...v }) => v);
  }
  /** what a stranger sees: who owns it and, only if it is listed, the price */
  info(kind0: unknown, id0: unknown) {
    const kind = this.kindOf(kind0), id = String(id0 ?? ''); const owner = this.ownerOf(kind, id);
    if (!owner) return kind === 'venue' && venueParse(id) ? { kind, id, owned: false, listed: true, price: venuePrice(id), seller: 'Lagos State Sports Commission' } : { kind, id, owned: false, listed: false };
    const l = this.listingView(this.advance(kind, id));
    if (!l) return { kind, id, owned: true, ownerName: this.name(owner), listed: false }; // no price, by design
    return { kind, id, owned: true, ownerName: l.ownerName, listed: true, price: l.price, mode: l.mode, agency: l.agency, seller: l.mode === 'agent' ? l.agency : l.ownerName };
  }
  /** buy listed property from another player at the asking price */
  buy(acc: string, a: Record<string, unknown>) {
    const kind = this.kindOf(a.kind), id = String(a.id ?? '');
    const r = this.advance(kind, id); if (!r) throw new HttpError(403, 'That property is not for sale.');
    if (r.owner_id === acc) throw new HttpError(400, 'Na your own property.');
    if (Number(a.price) && Math.round(Number(a.price)) !== r.price) throw new HttpError(409, 'The price changed. Check again.');
    if (kind === 'biz' && one<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM businesses WHERE owner_id=?', acc)!.n >= BIZ_MAX) throw new HttpError(400, `You can run ${BIZ_MAX} businesses at most.`);
    if (kind === 'venue' && one<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM venues WHERE owner_id=?', acc)!.n >= VENUE_MAX) throw new HttpError(400, `${VENUE_MAX} venues is the max.`);
    const fee = r.mode === 'agent' ? Math.round(r.price * 0.05) : 0;
    return this.db.transaction(() => {
      const w = this.pay(acc, r.price, 'prop.buy', propRef(kind, id));
      this.econ.adjust(r.owner_id, 0, r.price - fee, 'prop.sold', { ref: propRef(kind, id), note: fee ? `agency fee ${fee}` : undefined });
      run(this.db, 'DELETE FROM listings WHERE kind=? AND id=?', kind, id); this.transfer(kind, id, acc);
      this.onChange?.(kind, id, acc, this.name(acc));
      return { wallet: w, seller: r.owner_id, price: r.price };
    })();
  }

  // ---------------------------------------------------------------- venues
  private venueRow(id: string) { return one<VenueRow>(this.db, 'SELECT v.*, f.name AS owner_name FROM venues v LEFT JOIN profiles f ON f.account_id=v.owner_id WHERE v.id=?', id); }
  allVenues() { return all<VenueRow>(this.db, 'SELECT v.id, v.owner_id, v.fee, f.name AS owner_name FROM venues v LEFT JOIN profiles f ON f.account_id=v.owner_id').map((v) => ({ id: v.id, ownerName: v.owner_name ?? 'Somebody', fee: v.fee, listed: !!this.listingRow('venue', v.id) })); }
  near(id: string, at: At) { const p = venueParse(id); if (!p) throw new HttpError(400, 'Bad venue.'); if (at.interior || Math.hypot(p.x - at.x, p.z - at.z) > VENUE_REACH) throw new HttpError(400, 'You have to be at the venue.'); return p; }
  /** buy an unowned venue from the state (owned ones only through a listing) */
  buyVenue(acc: string, id0: unknown, at: At) {
    const id = String(id0 ?? ''); this.near(id, at);
    if (this.venueRow(id)) throw new HttpError(403, 'Somebody owns this place. It is only for sale if they list it.');
    if (one<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM venues WHERE owner_id=?', acc)!.n >= VENUE_MAX) throw new HttpError(400, `${VENUE_MAX} venues is the max.`);
    const price = venuePrice(id); const def = VENUES[venueParse(id)!.kind];
    return this.db.transaction(() => {
      const w = this.pay(acc, price, 'venue.buy', id);
      run(this.db, 'INSERT INTO venues(id,owner_id,fee,earned,bought_at) VALUES(?,?,?,?,?)', id, acc, def.fee, 0, this.now());
      this.onChange?.('venue', id, acc, this.name(acc));
      return { wallet: w, price };
    })();
  }
  setFee(acc: string, id0: unknown, fee0: unknown) {
    const id = String(id0 ?? ''); const v = this.venueRow(id); if (!v || v.owner_id !== acc) throw new HttpError(404, 'Not your venue.');
    const def = VENUES[venueParse(id)!.kind]; const fee = Math.round(Number(fee0));
    if (!(fee >= def.fee * FEE_RANGE[0] && fee <= def.fee * FEE_RANGE[1])) throw new HttpError(400, `Slot fee must be ₦${Math.round(def.fee * FEE_RANGE[0]).toLocaleString('en-NG')} to ₦${Math.round(def.fee * FEE_RANGE[1]).toLocaleString('en-NG')}.`);
    run(this.db, 'UPDATE venues SET fee=? WHERE id=?', fee, id); return fee;
  }
  venue(id0: unknown) {
    const id = String(id0 ?? ''); if (!venueParse(id)) throw new HttpError(400, 'Bad venue.');
    const v = this.venueRow(id); const from = slotNow(this.now());
    const bookings = all<BookingRow>(this.db, 'SELECT b.*, f.name AS by_name FROM bookings b LEFT JOIN profiles f ON f.account_id=b.by_id WHERE b.venue=? AND b.slot>=? ORDER BY b.slot LIMIT 60', id, from).map((b) => ({ slot: b.slot, by: b.by_id, byName: b.by_name ?? 'Somebody' }));
    return { id, owner: v?.owner_id ?? null, ownerName: v ? v.owner_name ?? 'Somebody' : null, fee: v ? v.fee : 0, earned: v?.earned ?? 0, bookings, info: this.info('venue', id) };
  }
  /** book a one game hour slot. At an owned venue the fee goes to the owner (less 10%); public pitches are free. */
  book(acc: string, id0: unknown, slot0: unknown) {
    const id = String(id0 ?? ''); if (!venueParse(id)) throw new HttpError(400, 'Bad venue.');
    const slot = Math.floor(Number(slot0)); const cur = slotNow(this.now());
    if (!Number.isFinite(slot) || slot < cur || slot > cur + SLOT_AHEAD) throw new HttpError(400, 'Pick a slot in the next two days.');
    if (one(this.db, 'SELECT 1 FROM bookings WHERE venue=? AND slot=?', id, slot)) throw new HttpError(409, 'That slot is taken.');
    const v = this.venueRow(id); const fee = v && v.owner_id !== acc ? v.fee : 0;
    return this.db.transaction(() => {
      const w = fee ? this.pay(acc, fee, 'venue.book', id) : this.econ.wallet(acc);
      if (fee) { const n = Math.round(fee * OWNER_SHARE); this.econ.adjust(v!.owner_id, 0, n, 'venue.booking', { ref: id }); run(this.db, 'UPDATE venues SET earned=earned+? WHERE id=?', n, id); }
      run(this.db, 'INSERT INTO bookings(venue,slot,by_id,fee,at) VALUES(?,?,?,?,?)', id, slot, acc, fee, this.now());
      return { wallet: w, fee, slot, owner: v?.owner_id ?? null };
    })();
  }
  booking(id: string, slot: number) { return one<BookingRow>(this.db, 'SELECT * FROM bookings WHERE venue=? AND slot=?', id, slot) ?? null; }
  myBookings(acc: string) { return all<BookingRow>(this.db, 'SELECT * FROM bookings WHERE by_id=? AND slot>=? ORDER BY slot', acc, slotNow(this.now())).map((b) => ({ venue: b.venue, slot: b.slot, fee: b.fee })); }
  venueOwner(id: string) { return this.venueRow(id)?.owner_id ?? null; }
  /** run every agency listing forward (rent, NPC buyers) */
  tick() { for (const r of all<{ kind: PropKind; id: string }>(this.db, "SELECT kind, id FROM listings WHERE mode='agent'")) this.advance(r.kind, r.id); }
}
const propRef = (k: PropKind, id: string) => `${k}:${id}`.slice(0, 80);
