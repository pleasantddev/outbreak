import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/db.ts';
import { boot, makePlayer, TestClient, type TestServer } from './helpers.ts';
import { agentSaleChance, agentStep, askOk, scorePlausible, slotNow, venueId, venueParse, venuePrice, hourToMs, potShare } from '../../v2/src/net/sports.ts';
import { worldHours } from '../../v2/src/net/rules.ts';

let s: TestServer;
beforeAll(async () => { s = await boot({ matchMinMs: 0 }); });
afterAll(async () => { await s.close(); });
const mk = async (name: string) => { const p = await makePlayer(s, name); return { ...p, c: await new TestClient(s, p.token).connect() }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rich = (acc: string, n = 50_000_000) => run(s.db, 'UPDATE players SET cash=cash+? WHERE account_id=?', n, acc);
const wallet = (acc: string) => s.db.prepare('SELECT cash, bank FROM players WHERE account_id=?').get(acc) as { cash: number; bank: number };

describe('sports and property rules', () => {
  it('venue ids carry kind, position and size; price is stable and positive', () => {
    const id = venueId('pitch', 120.4, -55.6, 38.2); expect(id).toBe('v:pitch:120:-56:38');
    expect(venueParse(id)).toEqual({ kind: 'pitch', x: 120, z: -56, len: 38 }); expect(venueParse('v:pool:1:1:1')).toBeNull();
    expect(venuePrice(id)).toBeGreaterThan(5_000_000); expect(venuePrice(venueId('stadium', 0, 0, 150))).toBeGreaterThan(venuePrice(id));
  });
  it('agents only list near market value; fair prices sell faster than greedy ones', () => {
    expect(askOk('agent', 1_000_000, 1_000_000)).toBe(true); expect(askOk('agent', 2_000_000, 1_000_000)).toBe(false); expect(askOk('self', 4_000_000, 1_000_000)).toBe(true);
    expect(agentSaleChance(800_000, 1_000_000)).toBeGreaterThan(agentSaleChance(1_500_000, 1_000_000));
  });
  it('an agency pays rent every noon less its fee and stops when it sells', () => {
    const st = { hour: 24 * 5, log: [] as any[] };
    const r = agentStep(st, { mode: 'agent', price: 1_000_000, value: 1_000_000, rent: true }, 24 * 8 + 13, () => 0.99);
    expect(r.sold).toBe(false); expect(r.paid).toBe(4 * Math.round(1_000_000 * 0.004 * 0.85));
    const sold = agentStep({ hour: 0, log: [] }, { mode: 'agent', price: 1_000_000, value: 1_000_000, rent: false }, 24 * 3 + 13, () => 0); expect(sold.sold).toBe(true); expect(sold.paid).toBe(950_000);
  });
  it('scores must be possible in the time played; the slot clock agrees with the world clock', () => {
    expect(scorePlausible('football', 3, 2, 240_000)).toBe(true); expect(scorePlausible('football', 40, 0, 240_000)).toBe(false); expect(scorePlausible('basketball', 21, 30, 300_000)).toBe(false);
    const h = slotNow(Date.now()); expect(Math.floor(worldHours(hourToMs(h) + 1))).toBe(h);
    expect(potShare(20_000, 4)).toEqual({ pot: 80_000, cut: 4_000, win: 76_000 });
  });
});

describe('property manager online', () => {
  it('unlisted property shows no price and cannot be bought; listed property can', async () => {
    const a = await mk('Tunde Land'); const b = await mk('Buyer Ngozi');
    run(s.db, 'INSERT INTO plots(id,owner_id,pts,price,bought_at,cx,cz) VALUES(?,?,?,?,?,?,?)', 'p:test:1', a.accountId, '[]', 4_000_000, Date.now(), 10, 10);
    const info = await b.c.act('prop.info', { kind: 'plot', id: 'p:test:1' }); expect(info.ok).toBe(true); expect(info.info.listed).toBe(false); expect(info.info.price).toBeUndefined();
    rich(b.accountId);
    const nope = await b.c.act('prop.buy', { kind: 'plot', id: 'p:test:1' }); expect(nope.ok).toBe(false);
    const steal = await b.c.act('prop.list', { kind: 'plot', id: 'p:test:1', mode: 'self', price: 4_000_000 }); expect(steal.ok).toBe(false);
    const silly = await a.c.act('prop.list', { kind: 'plot', id: 'p:test:1', mode: 'agent', price: 40_000_000 }); expect(silly.ok).toBe(false);
    const l = await a.c.act('prop.list', { kind: 'plot', id: 'p:test:1', mode: 'self', price: 5_000_000 }); expect(l.ok).toBe(true);
    const mkt = await b.c.act('prop.market'); expect(mkt.list.some((x: any) => x.id === 'p:test:1' && x.price === 5_000_000)).toBe(true);
    const info2 = await b.c.act('prop.info', { kind: 'plot', id: 'p:test:1' }); expect(info2.info.price).toBe(5_000_000);
    const before = wallet(a.accountId);
    const buy = await b.c.act('prop.buy', { kind: 'plot', id: 'p:test:1', price: 5_000_000 }); expect(buy.ok).toBe(true);
    expect(wallet(a.accountId).bank - before.bank).toBe(5_000_000);
    const owner = s.db.prepare('SELECT owner_id FROM plots WHERE id=?').get('p:test:1') as any; expect(owner.owner_id).toBe(b.accountId);
    const relist = await b.c.act('prop.info', { kind: 'plot', id: 'p:test:1' }); expect(relist.info.listed).toBe(false); // sale clears the listing
    a.c.close(); b.c.close();
  });
  it('agency listings take a commission when a player buys', async () => {
    const a = await mk('Bisi Agent'); const b = await mk('Buyer Femi'); rich(b.accountId);
    run(s.db, 'INSERT INTO plots(id,owner_id,pts,price,bought_at,cx,cz) VALUES(?,?,?,?,?,?,?)', 'p:test:2', a.accountId, '[]', 2_000_000, Date.now(), 10, 10);
    const l = await a.c.act('prop.list', { kind: 'plot', id: 'p:test:2', mode: 'agent', price: 2_000_000, rent: true }); expect(l.ok).toBe(true); expect(l.listing.agency).toBeTruthy();
    const before = wallet(a.accountId); const buy = await b.c.act('prop.buy', { kind: 'plot', id: 'p:test:2' }); expect(buy.ok).toBe(true);
    const got = wallet(a.accountId).bank - before.bank; expect(got).toBeGreaterThanOrEqual(1_900_000 - 1); expect(got).toBeLessThanOrEqual(1_900_000 + 20_000); // plus any rent the agency banked
    a.c.close(); b.c.close();
  });
});

describe('venues, bookings and fixtures online', () => {
  it('buy a pitch from the state, others pay to book it, fixtures escrow wagers and pay the winners', async () => {
    const o = await mk('Kunle Pitch'); const h = await mk('Capt Seyi'); const g = await mk('Capt Amaka'); rich(o.accountId); rich(h.accountId, 1_000_000); rich(g.accountId, 1_000_000);
    const id = venueId('pitch', 300, 300, 40);
    o.c.state(305, 300); await sleep(80); const far = await o.c.act('venue.buy', { id: venueId('pitch', 900, 900, 40) }); expect(far.ok).toBe(false);
    const buy = await o.c.act('venue.buy', { id }); expect(buy.err ?? 'ok').toBe('ok');
    h.c.state(306, 300); await sleep(60); const again = await h.c.act('venue.buy', { id }); expect(again.ok).toBe(false); // owned and not listed: not for sale
    const inf = await h.c.act('prop.info', { kind: 'venue', id }); expect(inf.info.price).toBeUndefined();
    const fee = await o.c.act('venue.fee', { id, fee: 20_000 }); expect(fee.ok).toBe(true);
    const slot = slotNow(Date.now()); const ob = wallet(o.accountId).bank;
    const bk = await h.c.act('venue.book', { id, slot }); expect(bk.ok).toBe(true); expect(bk.fee).toBe(20_000);
    expect(wallet(o.accountId).bank - ob).toBe(18_000);
    const taken = await g.c.act('venue.book', { id, slot }); expect(taken.ok).toBe(false);
    const noBook = await g.c.act('fx.create', { venue: id, slot, sport: 'football', wager: 20_000 }); expect(noBook.ok).toBe(false);
    const fx = await h.c.act('fx.create', { venue: id, slot, sport: 'football', wager: 20_000 }); expect(fx.ok).toBe(true);
    const early = await h.c.act('fx.start'); expect(early.ok).toBe(false); // nobody on the other side yet
    const gb = wallet(g.accountId).cash; const j = await g.c.act('fx.join', { key: fx.fixture.key, side: 1 }); expect(j.ok).toBe(true); expect(wallet(g.accountId).cash).toBe(gb - 20_000);
    const st = await h.c.act('fx.start'); expect(st.ok).toBe(true); expect(st.fixture.state).toBe('live');
    // the host relays a snapshot, the guest gets it
    h.c.ws.send(JSON.stringify({ t: 'mx', d: { s: [1, 0] } })); await sleep(80); expect(g.c.msgs.some((m) => m.t === 'mx' && m.d.s)).toBe(true);
    const hb = wallet(h.accountId).cash; const ob2 = wallet(o.accountId).cash;
    await h.c.act('fx.report', { sa: 1, sb: 0 }); await g.c.act('fx.report', { sa: 1, sb: 0 }); await sleep(80);
    expect(wallet(h.accountId).cash - hb).toBe(38_000); expect(wallet(o.accountId).cash - ob2).toBe(2_000);
    expect(g.c.msgs.some((m) => m.t === 'fixture' && m.state === 'done' && m.winSide === 0)).toBe(true);
    o.c.close(); h.c.close(); g.c.close();
  });
  it('a disputed score voids the match and refunds stakes; the owner can list a venue through an agent', async () => {
    const h = await mk('Baller Chidi'); const g = await mk('Baller Ifeoma'); rich(h.accountId, 1_000_000); rich(g.accountId, 1_000_000);
    const id = venueId('court', -400, 200, 26); const slot = slotNow(Date.now()) + 1;
    await h.c.act('venue.book', { id, slot }); // public court: free
    const fx = await h.c.act('fx.create', { venue: id, slot, sport: 'basketball', wager: 5_000 }); expect(fx.ok).toBe(true);
    expect((await g.c.act('fx.join', { key: fx.fixture.key, side: 1 })).err ?? 'ok').toBe('ok'); expect((await h.c.act('fx.start')).err ?? 'ok').toBe('ok');
    const hb = wallet(h.accountId).cash, gb = wallet(g.accountId).cash;
    await h.c.act('fx.report', { sa: 1, sb: 0 }); await g.c.act('fx.report', { sa: 0, sb: 1 }); await sleep(80);
    expect(wallet(h.accountId).cash - hb).toBe(5_000); expect(wallet(g.accountId).cash - gb).toBe(5_000);
    const flags = s.db.prepare("SELECT COUNT(*) AS n FROM cheat_flags WHERE account_id=?").get(h.accountId) as any; expect(flags.n).toBeGreaterThan(0);
    // venue as property through an agent
    rich(h.accountId); h.c.state(-398, 200); await sleep(80); const vb = await h.c.act('venue.buy', { id }); expect(vb.ok).toBe(true);
    const l = await h.c.act('prop.list', { kind: 'venue', id, mode: 'agent', price: venuePrice(id), rent: true }); expect(l.ok).toBe(true);
    const mine = await h.c.act('prop.mine'); expect(mine.list.find((p: any) => p.id === id).listing.mode).toBe('agent');
    h.c.close(); g.c.close();
  });
});
