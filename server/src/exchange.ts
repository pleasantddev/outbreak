// The Eko Exchange on the server: buying and selling shares of the listed companies at the shared price (net/exchange.ts)
// times the pressure real players put on it, and buying stakes in other players' shops. Every naira moves here, in one
// transaction, with fees that leave the economy (a money sink). Shop investors are paid their share of the till when the
// owner empties it.
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError } from './auth.ts';
import type { Economy } from './economy.ts';
import { BIZ_OWNER_MIN, BIZ_UNITS, EX_MAX_HOLD, EX_MAX_ORDER, TICKER, TICKERS, feeOf, quoteOf } from '../../v2/src/net/exchange.ts';
import { bizType } from '../../v2/src/net/rules.ts';

const HALF_LIFE = 6 * 3600_000;
interface Holding { account_id: string; sym: string; qty: number; cost: number }

export class Exchange {
  constructor(private db: DB, private econ: Economy) {}
  /** how far real players have pushed a price (1 = not at all); fades back over hours */
  pressure(sym: string, now = Date.now()) {
    const r = one<{ p: number; at: number }>(this.db, 'SELECT p, at FROM ex_pressure WHERE sym=?', sym); if (!r) return 1;
    return 1 + (r.p - 1) * Math.pow(0.5, (now - r.at) / HALF_LIFE);
  }
  pressures(now = Date.now()) { const out: Record<string, number> = {}; for (const t of TICKERS) out[t.sym] = Math.round(this.pressure(t.sym, now) * 10000) / 10000; return out; }
  quote(sym: string, now = Date.now()) { const t = TICKER.get(sym); if (!t) throw new HttpError(404, 'No such company on the exchange.'); return quoteOf(t, now, this.pressure(sym, now)); }
  /** pay from the bank first, then cash (the app is a bank app) */
  private pay(acct: string, n: number, why: string, note: string) {
    const w = this.econ.wallet(acct); if (w.cash + w.bank < n) throw new HttpError(402, 'Not enough money in your bank and pocket.', { code: 'broke' });
    const b = Math.min(w.bank, n); this.econ.adjust(acct, -(n - b), -b, why, { note });
  }
  trade(acct: string, symRaw: unknown, sideRaw: unknown, qtyRaw: unknown, now = Date.now()) {
    const sym = String(symRaw ?? '').toUpperCase(); const t = TICKER.get(sym); if (!t) throw new HttpError(404, 'No such company on the exchange.');
    const side = sideRaw === 'sell' ? 'sell' : sideRaw === 'buy' ? 'buy' : null; if (!side) throw new HttpError(400, 'Buy or sell?');
    const qty = Math.floor(Number(qtyRaw)); if (!(qty >= 1)) throw new HttpError(400, 'How many shares?');
    const q = this.quote(sym, now); const price = side === 'buy' ? q.buy : q.sell; const value = Math.round(price * qty);
    if (value > EX_MAX_ORDER) throw new HttpError(400, `One order can move at most ₦${EX_MAX_ORDER.toLocaleString('en-NG')}.`);
    const fee = feeOf(value);
    return this.db.transaction(() => {
      const h = one<Holding>(this.db, 'SELECT * FROM holdings WHERE account_id=? AND sym=?', acct, sym);
      if (side === 'buy') {
        if ((h?.qty ?? 0) + qty > EX_MAX_HOLD) throw new HttpError(400, `You can hold at most ${EX_MAX_HOLD.toLocaleString()} shares of one company.`);
        this.pay(acct, value + fee, 'ex.buy', `${qty} ${sym}`);
        if (h) run(this.db, 'UPDATE holdings SET qty=qty+?, cost=cost+? WHERE account_id=? AND sym=?', qty, value + fee, acct, sym);
        else run(this.db, 'INSERT INTO holdings(account_id, sym, qty, cost) VALUES(?,?,?,?)', acct, sym, qty, value + fee);
      } else {
        if (!h || h.qty < qty) throw new HttpError(400, 'You do not have that many shares.');
        const left = h.qty - qty; const costOut = h.cost * (qty / h.qty);
        if (left === 0) run(this.db, 'DELETE FROM holdings WHERE account_id=? AND sym=?', acct, sym);
        else run(this.db, 'UPDATE holdings SET qty=?, cost=cost-? WHERE account_id=? AND sym=?', left, costOut, acct, sym);
        this.econ.adjust(acct, 0, Math.max(0, value - fee), 'ex.sell', { note: `${qty} ${sym}` });
      }
      run(this.db, 'INSERT INTO trades(account_id, sym, side, qty, price, fee, at) VALUES(?,?,?,?,?,?,?)', acct, sym, side, qty, price, fee, now);
      // real orders push the price: a big buy lifts it, a big sell drags it, then it fades back
      const p0 = this.pressure(sym, now); const liq = t.base * t.shares * 0.002;
      const p1 = Math.max(0.7, Math.min(1.4, p0 * Math.exp((side === 'buy' ? 1 : -1) * 0.1 * value / liq)));
      run(this.db, 'INSERT INTO ex_pressure(sym, p, at) VALUES(?,?,?) ON CONFLICT(sym) DO UPDATE SET p=excluded.p, at=excluded.at', sym, p1, now);
      return { sym, side, qty, price, value, fee, quote: this.quote(sym, now), wallet: this.econ.wallet(acct) };
    })();
  }
  portfolio(acct: string, now = Date.now()) {
    const hs = all<Holding>(this.db, 'SELECT * FROM holdings WHERE account_id=? ORDER BY sym', acct).map((h) => { const q = this.quote(h.sym, now); const value = Math.round(q.sell * h.qty); return { sym: h.sym, qty: h.qty, cost: Math.round(h.cost), value, pnl: value - Math.round(h.cost), price: q.price, change: q.change }; });
    const trades = all(this.db, 'SELECT sym, side, qty, price, fee, at FROM trades WHERE account_id=? ORDER BY at DESC LIMIT 30', acct);
    return { holdings: hs, value: hs.reduce((n, h) => n + h.value, 0), cost: hs.reduce((n, h) => n + h.cost, 0), trades, pressure: this.pressures(now) };
  }

  // ------------------------------------------------------------------------------------------ stakes in players' shops
  private owner(site: string) { return one<{ owner_id: string; type: string; till: number }>(this.db, 'SELECT owner_id, type, till FROM businesses WHERE site=?', site); }
  /** units each holder has; the owner holds whatever nobody else does */
  stakes(site: string) {
    const o = this.owner(site); if (!o) return null;
    const inv = all<{ holder_id: string; units: number; cost: number }>(this.db, 'SELECT holder_id, units, cost FROM biz_shares WHERE site=? AND holder_id != ? AND units > 0', site, o.owner_id);
    return { owner: o.owner_id, ownerUnits: BIZ_UNITS - inv.reduce((n, r) => n + r.units, 0), investors: inv };
  }
  private unitsOf(site: string, who: string) { const s = this.stakes(site); if (!s) return 0; return who === s.owner ? s.ownerUnits : s.investors.find((r) => r.holder_id === who)?.units ?? 0; }
  private offered(site: string, who: string) { return one<{ n: number }>(this.db, 'SELECT COALESCE(SUM(units),0) n FROM biz_offers WHERE site=? AND seller_id=?', site, who)!.n; }
  /** put units of a shop up for sale at a price per unit */
  offer(acct: string, siteRaw: unknown, unitsRaw: unknown, priceRaw: unknown) {
    const site = String(siteRaw ?? ''); const s = this.stakes(site); if (!s) throw new HttpError(404, 'No such business.');
    const units = Math.floor(Number(unitsRaw)), price = Math.floor(Number(priceRaw));
    if (!(units >= 1 && units <= 49)) throw new HttpError(400, 'Offer between 1 and 49 units.');
    if (!(price >= 1000 && price <= 50_000_000)) throw new HttpError(400, 'Price each unit between ₦1,000 and ₦50,000,000.');
    const have = this.unitsOf(site, acct) - this.offered(site, acct);
    if (acct === s.owner ? have - units < BIZ_OWNER_MIN : have < units) throw new HttpError(400, acct === s.owner ? `You must keep at least ${BIZ_OWNER_MIN} units of your own business.` : 'You do not have that many units.');
    const r = run(this.db, 'INSERT INTO biz_offers(site, seller_id, units, price, at) VALUES(?,?,?,?,?)', site, acct, units, price, Date.now());
    return { id: Number(r.lastInsertRowid) };
  }
  cancel(acct: string, idRaw: unknown) { const n = run(this.db, 'DELETE FROM biz_offers WHERE id=? AND seller_id=?', Number(idRaw), acct).changes; if (!n) throw new HttpError(404, 'No such offer.'); }
  /** buy units from an offer; the seller is paid at once, 1% goes in fees */
  take(acct: string, idRaw: unknown, unitsRaw: unknown) {
    return this.db.transaction(() => {
      const o = one<{ id: number; site: string; seller_id: string; units: number; price: number }>(this.db, 'SELECT * FROM biz_offers WHERE id=?', Number(idRaw)); if (!o) throw new HttpError(404, 'That offer is gone.');
      if (o.seller_id === acct) throw new HttpError(400, 'That is your own offer.');
      const units = Math.min(o.units, Math.max(1, Math.floor(Number(unitsRaw) || o.units)));
      if (this.unitsOf(o.site, o.seller_id) < units) { run(this.db, 'DELETE FROM biz_offers WHERE id=?', o.id); throw new HttpError(409, 'The seller no longer has those units.'); }
      const value = units * o.price; const fee = feeOf(value);
      this.pay(acct, value + fee, 'bx.buy', `${units} units of ${o.site}`);
      this.econ.adjust(o.seller_id, 0, value, 'bx.sell', { note: `${units} units of ${o.site}` });
      const s = this.stakes(o.site)!;
      if (o.seller_id !== s.owner) run(this.db, 'UPDATE biz_shares SET units=units-?, cost=cost*(1.0 - ?*1.0/units) WHERE site=? AND holder_id=?', units, units, o.site, o.seller_id);
      if (acct !== s.owner) run(this.db, 'INSERT INTO biz_shares(site, holder_id, units, cost) VALUES(?,?,?,?) ON CONFLICT(site, holder_id) DO UPDATE SET units=units+excluded.units, cost=cost+excluded.cost', o.site, acct, units, value + fee);
      run(this.db, 'DELETE FROM biz_shares WHERE units <= 0');
      if (units >= o.units) run(this.db, 'DELETE FROM biz_offers WHERE id=?', o.id); else run(this.db, 'UPDATE biz_offers SET units=units-? WHERE id=?', units, o.id);
      return { units, value, fee, seller: o.seller_id, site: o.site, wallet: this.econ.wallet(acct) };
    })();
  }
  /** when the owner empties the till: investors get their share straight into the bank; returns the owner's part */
  split(site: string, owner: string, n: number) {
    const s = this.stakes(site); if (!s || !s.investors.length) return n;
    let paid = 0; const now = Date.now();
    for (const r of s.investors) {
      const amt = Math.floor((n * r.units) / BIZ_UNITS); if (amt <= 0) continue;
      this.econ.adjust(r.holder_id, 0, amt, 'bx.dividend', { ref: site }); paid += amt;
      run(this.db, 'INSERT INTO biz_payouts(site, holder_id, amount, at) VALUES(?,?,?,?)', site, r.holder_id, amt, now);
    }
    void owner; return n - paid;
  }
  /** every shop with units on offer or outside investors, for the Businesses tab */
  market() {
    const sites = all<{ site: string }>(this.db, 'SELECT DISTINCT site FROM biz_offers UNION SELECT DISTINCT site FROM biz_shares WHERE units > 0');
    return sites.map(({ site }) => {
      const b = one<{ owner_id: string; type: string; till: number; owner_name: string | null }>(this.db, 'SELECT b.owner_id, b.type, b.till, p.name owner_name FROM businesses b LEFT JOIN profiles p ON p.account_id=b.owner_id WHERE b.site=?', site); if (!b) return null;
      const offers = all<{ id: number; seller_id: string; units: number; price: number; name: string | null }>(this.db, 'SELECT o.id, o.seller_id, o.units, o.price, p.name FROM biz_offers o LEFT JOIN profiles p ON p.account_id=o.seller_id WHERE o.site=? ORDER BY o.price', site);
      const paid = one<{ n: number }>(this.db, 'SELECT COALESCE(SUM(amount),0) n FROM biz_payouts WHERE site=? AND at > ?', site, Date.now() - 7 * 86_400_000)!.n;
      const s = this.stakes(site)!;
      return { site, type: b.type, label: bizType(b.type)?.name ?? b.type, owner: b.owner_name ?? 'Somebody', ownerId: b.owner_id, ownerUnits: s.ownerUnits, investors: s.investors.length, paidWeek: paid, offers };
    }).filter(Boolean);
  }
  /** my stakes in other people's shops, and what they paid me */
  mine(acct: string) {
    const st = all<{ site: string; units: number; cost: number }>(this.db, 'SELECT site, units, cost FROM biz_shares WHERE holder_id=? AND units > 0', acct)
      .map((r) => ({ ...r, paid: one<{ n: number }>(this.db, 'SELECT COALESCE(SUM(amount),0) n FROM biz_payouts WHERE site=? AND holder_id=?', r.site, acct)!.n, type: this.owner(r.site)?.type ?? '' }));
    const offers = all(this.db, 'SELECT id, site, units, price FROM biz_offers WHERE seller_id=?', acct);
    return { stakes: st, offers };
  }
}
