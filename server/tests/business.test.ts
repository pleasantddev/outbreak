import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/db.ts';
import { boot, makePlayer, TestClient, type TestServer } from './helpers.ts';
import { BIZ_TYPES, bizStep, siteId, sitePos, siteTraffic, type BizState } from '../../v2/src/net/rules.ts';

let s: TestServer;
beforeAll(async () => { s = await boot(); });
afterAll(async () => { await s.close(); });
const mk = async (name: string) => { const p = await makePlayer(s, name); return { ...p, c: await new TestClient(s, p.token).connect() }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('business rules', () => {
  const kiosk = BIZ_TYPES.find((t) => t.id === 'kiosk')!;
  it('site ids carry their position and a stable foot traffic', () => {
    const id = siteId(1041.4, -118.6); expect(id).toBe('s:1041:-119'); expect(sitePos(id)).toEqual({ x: 1041, z: -119 });
    expect(sitePos('s:abc:1')).toBeNull(); expect(siteTraffic(id)).toBe(siteTraffic(id));
    expect(siteTraffic(id)).toBeGreaterThanOrEqual(0.85); expect(siteTraffic(id)).toBeLessThanOrEqual(1.25);
  });
  it('a stocked shop trades through the day and pays staff at 6pm', () => {
    const b: BizState = { stock: 100, till: 0, debt: 0, hour: 24 * 10 + 6, log: [] };
    bizStep(b, kiosk, 's:0:0', 24 * 11 + 6, () => 0.99); // a full day, no luck events
    expect(b.till).toBeGreaterThan(kiosk.gross * 0.6); expect(b.till).toBeLessThan(kiosk.gross * 1.3);
    expect(b.stock).toBeLessThan(100); expect(b.log.at(-1)!.t).toMatch(/paid/);
  });
  it('an empty shop earns nothing, wages become debt, and three days unpaid shuts it', () => {
    const b: BizState = { stock: 0, till: 0, debt: 0, hour: 24 * 10, log: [] };
    bizStep(b, kiosk, 's:0:0', 24 * 14, () => 0.99);
    expect(b.till).toBe(0); expect(b.debt).toBe(kiosk.upkeep * 4); expect(b.log.at(-1)!.t).toMatch(/Staff did not come/);
  });
  it('the till stops at its cap', () => {
    const b: BizState = { stock: 100, till: 0, debt: 0, hour: 0, log: [] };
    bizStep(b, kiosk, 's:0:0', 24 * 30, () => 0.99); expect(b.till).toBeLessThanOrEqual(kiosk.till);
  });
});

describe('businesses online', () => {
  it('buy at the shop, a customer pays into the till, the owner collects in person', async () => {
    const a = await mk('Iya Basira'); const b = await mk('Customer Dayo');
    const site = siteId(905, -330);
    a.c.state(905, -331); b.c.state(906, -331); await sleep(80);
    const poor = await a.c.act('biz.buy', { site, type: 'kiosk' }); expect(poor.ok).toBe(false); // starting cash is not enough
    run(s.db, 'UPDATE players SET cash=cash+300000 WHERE account_id=?', a.accountId);
    const far = siteId(2000, 2000); const away = await a.c.act('biz.buy', { site: far, type: 'kiosk' }); expect(away.ok).toBe(false);
    const buy = await a.c.act('biz.buy', { site, type: 'kiosk' }); expect(buy.ok).toBe(true); expect(buy.biz.type).toBe('kiosk');
    await sleep(60); expect(b.c.msgs.some((m) => m.t === 'biz' && m.site === site)).toBe(true);
    const again = await b.c.act('biz.buy', { site, type: 'pos' }); expect(again.ok).toBe(false);
    const list = await b.c.act('biz.all'); expect(list.list.some((x: any) => x.site === site && x.type === 'kiosk')).toBe(true);
    // the customer buys (it may be closed at this hour of the shared clock, so only check the money when it is open)
    const g = await b.c.act('biz.get', { site });
    const sv = await b.c.act('biz.serve', { site });
    if (g.biz.open) { expect(sv.ok).toBe(true); await sleep(60); expect(a.c.msgs.some((m) => m.t === 'toast' && m.title === 'Customer')).toBe(true); }
    else expect(sv.ok).toBe(false);
    const own = await a.c.act('biz.serve', { site }); expect(own.ok).toBe(false);
    const mine = await a.c.act('biz.mine'); expect(mine.list.length).toBe(1);
    const theirs = await b.c.act('biz.collect', { site }); expect(theirs.ok).toBe(false);
    if (mine.list[0].till > 0) { const col = await a.c.act('biz.collect', { site }); expect(col.ok).toBe(true); }
    a.c.close(); b.c.close();
  });
});
