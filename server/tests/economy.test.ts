import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, http, makePlayer, TestClient, type TestServer } from './helpers.ts';

let s: TestServer;
beforeAll(async () => {
  s = await boot({ adminEmail: 'boss@hustlelife.test', adminPassword: 'correct horse battery' }, {
    shops: { version: 1, items: [{ id: 'paint-black', name: 'Matte black', price: 12000 }] },
    economy: { version: 1, items: [{ id: 'delivery', kind: 'wage', pay: 4200, minSeconds: 0 }] },
  });
});
afterAll(async () => { await s.close(); });

const PLOT = { cx: 868, cz: -262, area: 648, zone: 'vacant', rich: 0.3, pts: [0, 0, 18, 0, 18, 36, 0, 36] };

describe('server authoritative economy', () => {
  it('starts with the configured cash and keeps a ledger', async () => {
    const p = await makePlayer(s, 'Ledger One'); const c = await new TestClient(s, p.token).connect();
    expect(c.welcome.wallet).toEqual({ cash: 1850, bank: 0 });
    const h = await http(s, 'GET', '/api/me/history', undefined, p.token); expect(h.json.items[0].kind).toBe('start');
    c.close();
  });
  it('deposit and withdraw with the 1.5 percent fee, never overdrawing', async () => {
    const p = await makePlayer(s, 'Banker'); const c = await new TestClient(s, p.token).connect();
    let r = await c.act('bank.deposit', { amount: 1000 }); expect(r).toMatchObject({ ok: true, cash: 850, bank: 1000 });
    r = await c.act('bank.withdraw', { amount: 1000 }); expect(r).toMatchObject({ ok: true, cash: 850 + 985, bank: 0 });
    r = await c.act('bank.withdraw', { amount: 5 }); expect(r.ok).toBe(false);
    r = await c.act('bank.deposit', { amount: -5 }); expect(r.ok).toBe(false);
    r = await c.act('bank.deposit', { amount: 999999999 }); expect(r).toMatchObject({ ok: true, cash: 0 }); // takes only what you have
    c.close();
  });
  it('buying land: price check, ownership is global, a second buyer is refused, pays bank first', async () => {
    const a = await makePlayer(s, 'Landlord A'); const b = await makePlayer(s, 'Landlord B');
    const ca = await new TestClient(s, a.token).connect(); const cb = await new TestClient(s, b.token).connect();
    let r = await ca.act('plot.buy', { id: 'L1_1', ...PLOT }); expect(r.ok).toBe(false); expect(r.code).toBe('broke'); expect(r.price).toBeGreaterThan(1_000_000);
    s.api.economy.grant(a.accountId, 40_000_000, 'test'); s.api.economy.grant(b.accountId, 40_000_000, 'test');
    await ca.act('bank.deposit', { amount: 4_000_000 });
    r = await ca.act('plot.buy', { id: 'L1_1', ...PLOT }); expect(r.ok).toBe(true);
    expect(r.bank).toBe(0); expect(r.cash).toBe(1850 + 40_000_000 - 4_000_000 - (r.price - 4_000_000));
    await cb.until(() => cb.of('plot').some((m) => m.id === 'L1_1')); // everyone is told
    expect(cb.of('plot')[0]).toMatchObject({ id: 'L1_1', owner: a.accountId, ownerName: 'Landlord A' });
    r = await cb.act('plot.buy', { id: 'L1_1', ...PLOT }); expect(r.ok).toBe(false); expect(r.code).toBe('owned');
    const owner = await http(s, 'GET', '/api/world/plots/L1_1'); expect(owner.json.ownerName).toBe('Landlord A');
    const box = await http(s, 'GET', '/api/world/plots?minx=800&maxx=900&minz=-300&maxz=-200'); expect(box.json.items.map((x: any) => x.id)).toContain('L1_1');
    // reconnect: the welcome lists my plots
    ca.close(); await new Promise((r) => setTimeout(r, 50)); const ca2 = await new TestClient(s, a.token).connect();
    expect(ca2.welcome.plots).toEqual(['L1_1']); ca2.close(); cb.close();
  });
  it('two players racing for the same plot: exactly one wins', async () => {
    const ps = await Promise.all(['Racer One', 'Racer Two', 'Racer Three'].map((n) => makePlayer(s, n)));
    for (const p of ps) s.api.economy.grant(p.accountId, 30_000_000, 'test');
    const cs = await Promise.all(ps.map((p) => new TestClient(s, p.token).connect()));
    const rs = await Promise.all(cs.map((c) => c.act('plot.buy', { id: 'V9_9', ...PLOT })));
    expect(rs.filter((r) => r.ok).length).toBe(1);
    const rows = s.db.prepare('SELECT COUNT(*) n FROM plots WHERE id=?').get('V9_9') as { n: number }; expect(rows.n).toBe(1);
    cs.forEach((c) => c.close());
  });
  it('rejects absurd plot claims', async () => {
    const p = await makePlayer(s, 'Cheaty Plot'); s.api.economy.grant(p.accountId, 100_000_000, 'test');
    const c = await new TestClient(s, p.token).connect();
    expect((await c.act('plot.buy', { id: 'bad id!', ...PLOT })).ok).toBe(false);
    expect((await c.act('plot.buy', { id: 'X1', cx: 868, cz: -262, area: 1, zone: 'vacant' })).ok).toBe(false); // area too small to be real
    expect((await c.act('plot.buy', { id: 'X2', cx: 9e9, cz: 0, area: 600, zone: 'vacant' })).ok).toBe(false); // outside Lagos
    const cheap = await c.act('plot.buy', { id: 'X3', ...PLOT, area: 40 }); expect(cheap.ok).toBe(true); expect(cheap.price).toBeGreaterThanOrEqual(1_500_000); // floor price
    c.close();
  });
  it('transfers between players, with a message to the receiver', async () => {
    const a = await makePlayer(s, 'Sender Sam'); const b = await makePlayer(s, 'Receiver Rita');
    const ca = await new TestClient(s, a.token).connect(); const cb = await new TestClient(s, b.token).connect();
    const r = await ca.act('cash.transfer', { to: 'receiver rita', amount: 500 }); expect(r).toMatchObject({ ok: true, cash: 1350 });
    await cb.until(() => cb.of('wallet').length); expect(cb.of('wallet').at(-1).cash).toBe(2350);
    expect(cb.of('toast')[0].body).toMatch(/Sender Sam/);
    expect((await ca.act('cash.transfer', { to: 'receiver rita', amount: 999999 })).ok).toBe(false);
    expect((await ca.act('cash.transfer', { to: 'nobody here', amount: 5 })).ok).toBe(false);
    expect((await ca.act('cash.transfer', { to: 'sender sam', amount: 5 })).ok).toBe(false);
    ca.close(); cb.close();
  });
  it('client side cash changes: losses accepted, unexplained gains refused, capped gains allowed', async () => {
    const p = await makePlayer(s, 'Deltaman'); const c = await new TestClient(s, p.token).connect();
    expect(await c.act('cash.delta', { d: -300, why: 'fine' })).toMatchObject({ ok: true, cash: 1550 });
    expect(await c.act('cash.delta', { d: 1_000_000, why: 'hax' })).toMatchObject({ ok: true, cash: 1550 }); // refused, authoritative balance returned
    expect(await c.act('cash.delta', { d: 1000, why: 'loot' })).toMatchObject({ ok: true, cash: 2550 });
    expect(await c.act('cash.delta', { d: 500_000, why: 'loot' })).toMatchObject({ ok: true, cash: 2550 }); // over the per minute cap
    expect(await c.act('cash.delta', { d: -999999, why: 'fine' })).toMatchObject({ ok: true, cash: 0 }); // clamps at what you have
    expect(s.api.economy.flags(p.accountId).map((f) => f.kind)).toEqual(expect.arrayContaining(['unsanctioned-gain', 'gain-cap']));
    c.close();
  });
  it('jobs pay the server rate, only after they were started, and not twice', async () => {
    const p = await makePlayer(s, 'Hustler'); const c = await new TestClient(s, p.token).connect();
    expect((await c.act('job.done', { id: 'delivery' })).ok).toBe(false);
    await c.act('job.start', { id: 'delivery' });
    const r = await c.act('job.done', { id: 'delivery', pay: 99999999 }); expect(r).toMatchObject({ ok: true, cash: 1850 + 4200 }); // wage from content/economy.json, not from the client
    expect((await c.act('job.done', { id: 'delivery' })).ok).toBe(false);
    await c.act('job.start', { id: 'parcel' }); const fast = await c.act('job.done', { id: 'parcel' }); expect(fast.ok).toBe(false); expect(fast.code).toBe('too_fast');
    c.close();
  });
  it('shop purchases use the server price list', async () => {
    const p = await makePlayer(s, 'Shopper'); const c = await new TestClient(s, p.token).connect();
    expect(await c.act('shop.buy', { sku: 'paint-black' })).toMatchObject({ ok: false }); // 12000 > 1850
    s.api.economy.grant(p.accountId, 20000, 'test');
    expect(await c.act('shop.buy', { sku: 'paint-black', price: 1 })).toMatchObject({ ok: true, price: 12000, cash: 1850 + 20000 - 12000 });
    expect((await c.act('shop.buy', { sku: 'not-in-catalogue' })).ok).toBe(false);
    c.close();
  });
  it('saved state: systems keys sync, money and land keys are refused', async () => {
    const p = await makePlayer(s, 'Saver'); const c = await new TestClient(s, p.token).connect();
    expect((await c.act('state.put', { key: 'missions', value: { done: ['m1'] } })).ok).toBe(true);
    expect((await c.act('state.put', { key: 'garage', value: { cars: 2 } })).ok).toBe(true);
    expect((await c.act('state.put', { key: 'cash', value: 9e9 })).ok).toBe(false);
    expect((await c.act('state.put', { key: 'owned', value: ['all'] })).ok).toBe(false);
    expect((await c.act('state.put', { key: '__proto__', value: 1 })).ok).toBe(false);
    const st = await http(s, 'GET', '/api/me/state', undefined, p.token); expect(st.json.missions).toEqual({ done: ['m1'] }); expect(st.json.garage).toEqual({ cars: 2 });
    c.close(); const c2 = await new TestClient(s, p.token).connect(); expect(c2.welcome.state.garage).toEqual({ cars: 2 }); c2.close();
  });
  it('admin grants reach the live player and are logged', async () => {
    const p = await makePlayer(s, 'Gifted'); const c = await new TestClient(s, p.token).connect();
    s.api.economy.grant(p.accountId, 777, 'admin.grant', 'admin1', 'welcome gift');
    await c.until(() => c.of('wallet').length); expect(c.of('wallet')[0]).toMatchObject({ cash: 1850 + 777, why: 'admin.grant' });
    const h = s.api.economy.history(p.accountId, 5); expect(h[0]).toMatchObject({ kind: 'admin.grant', cash_delta: 777, note: 'welcome gift' });
    c.close();
  });
});

describe('registry hooks', () => {
  it('NIN then vehicle registration, stolen flag, plate lookup', async () => {
    const p = await makePlayer(s, 'Registered Ray');
    expect((await http(s, 'POST', '/api/vehicles/register', { vkey: 'sedan:1', kind: 'sedan' }, p.token)).json.code).toBe('no_nin');
    const nin = await http(s, 'POST', '/api/nin', { lga: 'Ikeja' }, p.token); expect(nin.json.nin).toMatch(/^\d{11}$/);
    expect((await http(s, 'POST', '/api/nin', {}, p.token)).status).toBe(409);
    const v = await http(s, 'POST', '/api/vehicles/register', { vkey: 'sedan:1', kind: 'sedan', plate: 'ray 123' }, p.token); expect(v.json.plate).toBe('RAY 123');
    expect((await http(s, 'POST', '/api/vehicles/register', { vkey: 'sedan:1', kind: 'sedan' }, p.token)).status).toBe(409);
    await http(s, 'POST', '/api/vehicles/sedan:1/stolen', {}, p.token);
    const lk = await http(s, 'GET', '/api/vehicles/lookup?plate=ray%20123'); expect(lk.json).toMatchObject({ found: true, stolen: true, owner: 'Registered Ray' });
    const other = await makePlayer(s, 'Other Ola'); expect((await http(s, 'POST', '/api/vehicles/sedan:1/stolen', {}, other.token)).status).toBe(404);
  });
});
