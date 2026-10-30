// Small businesses on shop fronts, Lagos Life style. The server owns everything: who owns which site, stock, the till,
// wages and light at 6pm, street luck, and every naira that moves. Rules and numbers live in v2/src/net/rules.ts so the
// phone app shows exactly what the server will do.
import { randomInt } from 'node:crypto';
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError } from './auth.ts';
import type { Economy } from './economy.ts';
import { BIZ_MAX, BIZ_REACH, BIZ_TYPES, bizStep, bizType, sitePos, worldHours, type BizState } from '../../v2/src/net/rules.ts';

interface Row { site: string; owner_id: string; type: string; stock: number; till: number; debt: number; hour: number; bought_at: number; log: string; owner_name?: string | null }
export interface BizView { site: string; type: string; owner: string; ownerName: string; stock: number; till: number; debt: number; log: BizState['log']; open: boolean }
const rand = () => randomInt(0, 2 ** 32) / 2 ** 32;

export class Businesses {
  constructor(private db: DB, private econ: Economy, private now: () => number = Date.now) {}
  private row(site: string) { return one<Row>(this.db, 'SELECT b.*, f.name AS owner_name FROM businesses b LEFT JOIN profiles f ON f.account_id=b.owner_id WHERE b.site=?', site); }
  /** bring a business up to the present hour and save it */
  private advance(r: Row): Row {
    const t = bizType(r.type); if (!t) return r;
    const st: BizState = { stock: r.stock, till: r.till, debt: r.debt, hour: r.hour, log: JSON.parse(r.log || '[]') };
    const to = worldHours(this.now()); if (Math.floor(to) <= r.hour) return r;
    bizStep(st, t, r.site, to, rand);
    run(this.db, 'UPDATE businesses SET stock=?, till=?, debt=?, hour=?, log=? WHERE site=?', st.stock, st.till, st.debt, st.hour, JSON.stringify(st.log), r.site);
    return { ...r, stock: st.stock, till: st.till, debt: st.debt, hour: st.hour, log: JSON.stringify(st.log) };
  }
  private view(r: Row): BizView {
    const t = bizType(r.type)!; const hod = worldHours(this.now()) % 24;
    return { site: r.site, type: r.type, owner: r.owner_id, ownerName: r.owner_name ?? 'Somebody', stock: Math.round(r.stock), till: Math.round(r.till), debt: Math.round(r.debt), log: JSON.parse(r.log || '[]'), open: hod >= t.open[0] && hod < t.open[1] && r.debt < t.upkeep * 3 && r.stock > 0 };
  }
  private near(site: string, at: { x: number; z: number; interior: string | null }) {
    const p = sitePos(site); if (!p) throw new HttpError(400, 'Bad site.');
    if (at.interior || Math.hypot(p.x - at.x, p.z - at.z) > BIZ_REACH) throw new HttpError(400, 'You have to be at the shop.');
    return p;
  }
  private mineRow(accountId: string, site: unknown) {
    const r = this.row(String(site ?? '')); if (!r || r.owner_id !== accountId) throw new HttpError(404, 'That shop is not yours.');
    return this.advance(r);
  }
  /** every owned site with its owner and trade, for the signs on the street */
  all(): { site: string; type: string; ownerName: string }[] {
    return all<Row>(this.db, 'SELECT b.site, b.type, f.name AS owner_name FROM businesses b LEFT JOIN profiles f ON f.account_id=b.owner_id').map((r) => ({ site: r.site, type: r.type, ownerName: r.owner_name ?? 'Somebody' }));
  }
  mine(accountId: string): BizView[] { return all<Row>(this.db, 'SELECT b.*, f.name AS owner_name FROM businesses b LEFT JOIN profiles f ON f.account_id=b.owner_id WHERE b.owner_id=?', accountId).map((r) => this.view(this.advance(r))); }
  get(site: string): BizView | null { const r = this.row(site); return r ? this.view(this.advance(r)) : null; }

  buy(accountId: string, site: unknown, type: unknown, at: { x: number; z: number; interior: string | null }) {
    const id = String(site ?? ''); this.near(id, at); const t = bizType(String(type ?? '')); if (!t) throw new HttpError(400, 'No such business.');
    if (this.row(id)) throw new HttpError(409, 'Somebody already owns this shop.');
    const n = one<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM businesses WHERE owner_id=?', accountId)!.n;
    if (n >= BIZ_MAX) throw new HttpError(400, `You can run ${BIZ_MAX} businesses at most.`);
    return this.db.transaction(() => {
      const w = this.econ.adjust(accountId, -t.price, 0, 'biz.buy', { ref: id, note: t.id });
      run(this.db, 'INSERT INTO businesses(site,owner_id,type,stock,till,debt,hour,bought_at,log) VALUES(?,?,?,?,?,?,?,?,?)', id, accountId, t.id, 100, 0, 0, Math.floor(worldHours(this.now())), this.now(), '[]');
      return { wallet: w, biz: this.view(this.row(id)!) };
    })();
  }
  /** empty the till into your pocket: only standing at the shop */
  collect(accountId: string, site: unknown, at: { x: number; z: number; interior: string | null }) {
    const r = this.mineRow(accountId, site); this.near(r.site, at); const n = Math.floor(r.till); if (n <= 0) throw new HttpError(400, 'The till is empty.');
    return this.db.transaction(() => {
      run(this.db, 'UPDATE businesses SET till=till-? WHERE site=?', n, r.site);
      const w = this.econ.adjust(accountId, n, 0, 'biz.collect', { ref: r.site });
      return { wallet: w, amount: n, biz: this.view(this.row(r.site)!) };
    })();
  }
  /** fill the shelves; from the phone it costs 15% more for delivery. Unpaid staff are paid first. */
  restock(accountId: string, site: unknown, at: { x: number; z: number; interior: string | null }) {
    const r = this.mineRow(accountId, site); const t = bizType(r.type)!; const p = sitePos(r.site)!;
    const there = !at.interior && Math.hypot(p.x - at.x, p.z - at.z) <= BIZ_REACH;
    const goods = Math.round(t.restock * (100 - r.stock) / 100 * (there ? 1 : 1.15)); const cost = goods + Math.round(r.debt);
    if (cost <= 0) throw new HttpError(400, 'Shelves are full and staff are paid.');
    return this.db.transaction(() => {
      const w = this.econ.adjust(accountId, -cost, 0, 'biz.restock', { ref: r.site, note: r.debt > 0 ? `wages ${Math.round(r.debt)}` : undefined });
      run(this.db, 'UPDATE businesses SET stock=100, debt=0 WHERE site=?', r.site);
      return { wallet: w, cost, biz: this.view(this.row(r.site)!) };
    })();
  }
  /** a customer buys at somebody's shop; the money goes into the owner's till */
  serve(customerId: string, site: unknown, at: { x: number; z: number; interior: string | null }) {
    const r0 = this.row(String(site ?? '')); if (!r0) throw new HttpError(404, 'This shop is to let.'); this.near(r0.site, at);
    const r = this.advance(r0); const v = this.view(r); const t = bizType(r.type)!;
    if (r.owner_id === customerId) throw new HttpError(400, 'Na your own shop.');
    if (!v.open) throw new HttpError(400, r.debt >= t.upkeep * 3 ? 'Closed. The staff are on strike.' : r.stock <= 0 ? 'Nothing on the shelves.' : `Closed. Opens ${t.open[0]}:00 to ${t.open[1]}:00.`);
    const price = t.sells.price;
    return this.db.transaction(() => {
      let w;
      if (t.id === 'pos') w = this.econ.adjust(customerId, 5_000, -(5_000 + price), 'biz.pos', { ref: r.site }); // cash out ₦5,000 from your bank
      else w = this.econ.adjust(customerId, -price, 0, 'biz.buy.item', { ref: r.site, note: t.id });
      run(this.db, 'UPDATE businesses SET till=MIN(till+?, ?), stock=MAX(0, stock-1) WHERE site=?', price, t.till * 1.5, r.site);
      return { wallet: w, owner: r.owner_id, ownerName: v.ownerName, item: t.sells };
    })();
  }
}
