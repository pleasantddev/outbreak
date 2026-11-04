import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, makePlayer, TestClient, type TestServer } from './helpers.ts';
import { TICKER, TICKERS, midPrice, priceAt, quoteOf, feeOf, EX_SPREAD } from '../../v2/src/net/exchange.ts';
import { siteId } from '../../v2/src/net/rules.ts';
import { run } from '../src/db.ts';

let s: TestServer;
beforeAll(async () => { s = await boot(); });
afterAll(async () => { await s.close(); });
const mk = async (name: string) => { const p = await makePlayer(s, name); return { ...p, c: await new TestClient(s, p.token).connect() }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Eko Exchange prices', () => {
  it('are the same everywhere for a moment, move smoothly, and stay positive', () => {
    const t = TICKER.get('DANFO')!; const now = Date.UTC(2026, 10, 4, 12);
    expect(priceAt(t, now)).toBe(priceAt(t, now));
    const a = midPrice(t, now), b = midPrice(t, now + 60_000); expect(Math.abs(b - a) / a).toBeLessThan(0.01);
    for (const tk of TICKERS) for (let h = 0; h < 24 * 60; h += 7) expect(midPrice(tk, now + h * 3_600_000)).toBeGreaterThan(0);
    const q = quoteOf(t, now); expect(q.buy).toBeGreaterThan(q.price); expect(q.sell).toBeLessThan(q.price); expect((q.buy - q.sell) / q.price).toBeCloseTo(EX_SPREAD, 3);
  });
});

describe('trading online', () => {
  it('buys from the bank with fees, real orders push the price, selling pays the bank; you cannot sell what you do not have', async () => {
    const a = await mk('Trader Tobi');
    run(s.db, 'UPDATE players SET bank=bank+2000000 WHERE account_id=?', a.accountId);
    const p0 = s.hub.exchange.quote('CHOPN').price;
    const b = await a.c.act('ex.trade', { sym: 'CHOPN', side: 'buy', qty: 1000 }); expect(b.ok).toBe(true);
    expect(b.trade.fee).toBe(feeOf(b.trade.value)); expect(b.bank).toBe(2000000 - b.trade.value - b.trade.fee);
    expect(s.hub.exchange.quote('CHOPN').price).toBeGreaterThan(p0); // the buy lifted it
    const pf = await a.c.act('ex.portfolio'); expect(pf.portfolio.holdings[0]).toMatchObject({ sym: 'CHOPN', qty: 1000 });
    expect((await a.c.act('ex.trade', { sym: 'CHOPN', side: 'sell', qty: 5000 })).ok).toBe(false);
    const sl = await a.c.act('ex.trade', { sym: 'CHOPN', side: 'sell', qty: 1000 }); expect(sl.ok).toBe(true);
    expect((await a.c.act('ex.portfolio')).portfolio.holdings).toEqual([]);
    // a round trip costs money: fees and the spread leave the economy
    expect(sl.bank).toBeLessThan(2000000);
    expect((await a.c.act('ex.trade', { sym: 'NOPE', side: 'buy', qty: 1 })).ok).toBe(false);
    a.c.close();
  }, 20000);

  it('players sell units of their shop; investors are paid their share when the owner empties the till', async () => {
    const own = await mk('Shop Owner Sade'); const inv = await mk('Investor Ini');
    const site = siteId(905, -330);
    run(s.db, "INSERT INTO businesses(site,owner_id,type,stock,till,debt,hour,bought_at,log) VALUES(?,?,?,?,?,?,?,?,?)", site, own.accountId, 'kiosk', 100, 0, 0, 0, Date.now(), '[]');
    run(s.db, 'UPDATE players SET bank=bank+1000000 WHERE account_id=?', inv.accountId);
    expect((await own.c.act('bx.offer', { site, units: 60, price: 5000 })).ok).toBe(false); // must keep 51
    const of = await own.c.act('bx.offer', { site, units: 20, price: 5000 }); expect(of.ok).toBe(true);
    expect((await inv.c.act('bx.offer', { site, units: 5, price: 5000 })).ok).toBe(false); // holds nothing yet
    const mk1 = await inv.c.act('bx.market'); const off = mk1.list.find((x: any) => x.site === site).offers[0]; expect(off.units).toBe(20);
    const tk = await inv.c.act('bx.take', { id: off.id, units: 10 }); expect(tk.ok).toBe(true); expect(tk.value).toBe(50000);
    await own.c.until(() => own.c.msgs.some((m) => m.t === 'toast' && /units of your stake/.test(m.body)));
    expect(s.hub.exchange.stakes(site)!.ownerUnits).toBe(90);
    // the till fills and the owner collects at the shop: 10% goes to the investor's bank
    run(s.db, 'UPDATE businesses SET till=20000 WHERE site=?', site);
    s.hub.teleport(own.accountId, 905, -331); await sleep(60); own.c.state(905, -331); await sleep(80);
    const bankBefore = s.api.economy.wallet(inv.accountId).bank;
    const col = await own.c.act('biz.collect', { site }); expect(col.ok).toBe(true);
    const share = Math.floor(col.amount * 10 / 100); expect(share).toBeGreaterThan(1500); expect(s.api.economy.wallet(inv.accountId).bank - bankBefore).toBe(share);
    expect((await inv.c.act('bx.market')).mine.stakes[0]).toMatchObject({ site, units: 10, paid: share });
    // the investor can sell some units on to someone else
    expect((await inv.c.act('bx.offer', { site, units: 4, price: 7000 })).ok).toBe(true);
    own.c.close(); inv.c.close();
  }, 20000);
});
