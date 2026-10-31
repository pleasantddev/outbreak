import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, http, makePlayer, type TestServer } from './helpers.ts';
import { iapCatalog, findPromo, promoPrice } from '../../v2/src/net/rules.ts';

const IAP = {
  version: 1, items: [
    { id: 'pack.small', type: 'currency', name: 'Pocket Money', priceNGN: 500, priceUSD: 0.99, grants: { cash: 250000 }, enabled: true, sort: 1 },
    { id: 'pack.once', type: 'currency', name: 'Starter', priceNGN: 1000, priceUSD: 1.99, grants: { cash: 50000 }, limitPerAccount: 1, sort: 2 },
    { id: 'pack.off', type: 'currency', name: 'Hidden', priceNGN: 1000, priceUSD: 1.99, grants: { cash: 1 }, enabled: false },
    { id: 'cos.paint', type: 'cosmetic', name: 'Paint', priceNGN: 1500, priceUSD: 2.99, grants: { cosmetics: ['x'] } },
    { id: 'promo.half', type: 'promo', code: 'HALF', percentOff: 50, appliesTo: ['*'], perAccount: 1, enabled: true },
    { id: 'promo.old', type: 'promo', code: 'OLD', percentOff: 50, appliesTo: ['*'], from: '2020-01-01', to: '2020-01-31' },
    { id: 'sale.small', type: 'sale', percentOff: 20, itemIds: ['pack.small'], from: '2020-01-01', to: '2020-01-02' },
  ],
};

describe('store rules (shared with the client)', () => {
  it('sells only live packs the game can hand over, applies sales in their window', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    expect(iapCatalog(IAP.items, now).map((x) => x.id)).toEqual(['pack.small', 'pack.once']);
    const inSale = iapCatalog(IAP.items, Date.parse('2020-01-02T20:00:00Z')).find((x) => x.id === 'pack.small')!;
    expect(inSale).toMatchObject({ priceNGN: 400, wasNGN: 500 });
    expect(findPromo(IAP.items, 'half', 'pack.small', now)?.code).toBe('HALF');
    expect(findPromo(IAP.items, 'OLD', 'pack.small', now)).toBeNull();
    expect(promoPrice({ id: 'p', percentOff: 99 }, 500)).toBe(100); // never under ₦100
  });
});

describe('payments in test mode (no Paystack key)', () => {
  let s: TestServer;
  beforeAll(async () => { s = await boot({ payTest: true, paystackSecret: '' }, { iap: IAP }); });
  afterAll(async () => { await s.close(); });

  it('lists the catalogue and refuses guests without a sign in', async () => {
    const c = await http(s, 'GET', '/api/pay/config'); expect(c.json.mode).toBe('test'); expect(c.json.packs.map((p: any) => p.id)).toEqual(['pack.small', 'pack.once']);
    expect((await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.small' })).status).toBe(401);
  });
  it('prices on the server, settles once, credits cash, shows in the ledger', async () => {
    const p = await makePlayer(s, 'Payer One');
    const st = await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.small', meta: { amountKobo: 1 } }, p.token);
    expect(st.status).toBe(200); expect(st.json).toMatchObject({ mode: 'test', amountKobo: 50000, label: 'Pocket Money', authorizationUrl: null });
    const ref = st.json.ref as string; expect(ref).toMatch(/^hl_[a-z0-9]{20}$/);
    expect((await http(s, 'GET', `/api/pay/status/${ref}`, undefined, p.token)).json.status).toBe('pending');
    expect(s.api.economy.wallet(p.accountId).cash).toBe(1850);
    const done = await http(s, 'POST', `/api/pay/status/${ref}/test-complete`, {}, p.token);
    expect(done.json).toMatchObject({ status: 'paid', naira: 500, granted: { cash: 250000 } });
    await http(s, 'POST', `/api/pay/status/${ref}/test-complete`, {}, p.token); // twice: still one grant
    expect(s.api.economy.wallet(p.accountId).cash).toBe(1850 + 250000);
    const mine = await http(s, 'GET', '/api/pay/mine', undefined, p.token); expect(mine.json.items[0]).toMatchObject({ ref, status: 'paid' });
    const hist = await http(s, 'GET', '/api/me/history', undefined, p.token); expect(hist.json.items[0]).toMatchObject({ kind: 'iap', cash_delta: 250000, ref });
    // the admin Store page reads these columns
    const row = s.db.prepare('SELECT item_id, amount, ref, status FROM purchases WHERE ref=?').get(ref) as any;
    expect(row).toEqual({ item_id: 'iap:pack.small', amount: 500, ref, status: 'paid' });
  });
  it('another player cannot see or complete my checkout', async () => {
    const a = await makePlayer(s, 'Owner Pay'); const b = await makePlayer(s, 'Nosy Pay');
    const ref = (await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.small' }, a.token)).json.ref;
    expect((await http(s, 'GET', `/api/pay/status/${ref}`, undefined, b.token)).status).toBe(404);
    expect((await http(s, 'POST', `/api/pay/status/${ref}/test-complete`, {}, b.token)).status).toBe(404);
    expect(s.api.economy.wallet(b.accountId).cash).toBe(1850);
  });
  it('one-per-account packs, promo codes and their per-account limit, unknown and hidden products', async () => {
    const p = await makePlayer(s, 'Promo Pay');
    const r1 = await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.once', meta: { promo: 'half' } }, p.token);
    expect(r1.json.amountKobo).toBe(50000);
    await http(s, 'POST', `/api/pay/status/${r1.json.ref}/test-complete`, {}, p.token);
    expect((await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.once' }, p.token)).json.code).toBe('limit');
    expect((await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.small', meta: { promo: 'HALF' } }, p.token)).json.code).toBe('promo');
    expect((await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.small', meta: { promo: 'NOPE' } }, p.token)).status).toBe(400);
    expect((await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.off' }, p.token)).status).toBe(404);
    expect((await http(s, 'POST', '/api/pay/start', { sku: 'iap:cos.paint' }, p.token)).status).toBe(404);
    expect((await http(s, 'POST', '/api/pay/start', { sku: 'gold:anything' }, p.token)).status).toBe(404);
    expect((await http(s, 'POST', '/api/pay/start', { sku: 'not a sku' }, p.token)).status).toBe(400);
  });
  it('products registered by other systems get the same flow', async () => {
    let fulfilled = 0;
    s.api.payments.register('ad', { quote: (_a, id, meta) => ({ amountKobo: 450000 * Number(meta.days ?? 1), label: `Billboard ${id}` }), fulfil: (p) => { fulfilled++; return { board: p.sku, days: p.meta.days }; } });
    const p = await makePlayer(s, 'Advertiser');
    const st = await http(s, 'POST', '/api/pay/start', { sku: 'ad:oshodi-1', meta: { days: 3 } }, p.token);
    expect(st.json.amountKobo).toBe(1_350_000);
    const done = await http(s, 'POST', `/api/pay/status/${st.json.ref}/test-complete`, {}, p.token);
    expect(done.json.granted).toEqual({ board: 'ad:oshodi-1', days: 3 }); expect(fulfilled).toBe(1);
  });
  it('the admin ledger is admin only', async () => {
    const p = await makePlayer(s, 'Not Admin');
    expect((await http(s, 'GET', '/api/pay/ledger', undefined, p.token)).status).toBe(403);
    const l = s.api.payments.ledger(); expect(l.totals.paid.count).toBeGreaterThanOrEqual(3); expect(l.items[0].player).toBeTruthy();
  });
});

describe('payments live (Paystack mocked)', () => {
  let s: TestServer; const SECRET = 'sk_test_hustlelife_unit';
  const calls: { url: string; body: any }[] = []; let verifyStatus = 'success'; let verifyAmount: number | null = null;
  beforeAll(async () => {
    s = await boot({ payTest: false, paystackSecret: SECRET, paystackPublic: 'pk_test_x', payCallbackUrl: 'https://game.example/?paid=1' }, { iap: IAP });
    s.api.payments.fetch = async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : null; calls.push({ url, body });
      if (url.endsWith('/transaction/initialize')) return { ok: true, status: 200, json: async () => ({ status: true, data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, access_code: 'ac_1', reference: body.reference } }) };
      const ref = url.split('/').pop()!; const row = s.api.payments.get(ref)!;
      return { ok: true, status: 200, json: async () => ({ status: true, data: { status: verifyStatus, amount: verifyAmount ?? row.amountKobo, currency: 'NGN', reference: ref, id: 'tx_' + ref } }) };
    };
  });
  afterAll(async () => { await s.close(); });
  const sign = (raw: string) => createHmac('sha512', SECRET).update(raw).digest('hex');

  it('initialize sends the server price, email and callback; test-complete is refused', async () => {
    const p = await makePlayer(s, 'Live Payer');
    const st = await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.small' }, p.token);
    expect(st.json).toMatchObject({ mode: 'live', authorizationUrl: expect.stringContaining('checkout.paystack.com'), publicKey: 'pk_test_x' });
    const init = calls.find((c) => c.url.endsWith('/initialize'))!;
    expect(init.body).toMatchObject({ email: p.email, amount: '50000', currency: 'NGN', reference: st.json.ref, callback_url: 'https://game.example/?paid=1' });
    expect((await http(s, 'POST', `/api/pay/status/${st.json.ref}/test-complete`, {}, p.token)).status).toBe(403);
  });
  it('a signed webhook settles once; a bad signature is refused', async () => {
    const p = await makePlayer(s, 'Hook Payer');
    const ref = (await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.small' }, p.token)).json.ref;
    const raw = JSON.stringify({ event: 'charge.success', data: { reference: ref, amount: 50000, currency: 'NGN', status: 'success', id: 77 } });
    const bad = await fetch(s.url + '/api/pay/paystack/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': 'ab'.repeat(64) }, body: raw });
    expect(bad.status).toBe(401); expect(s.api.economy.wallet(p.accountId).cash).toBe(1850);
    for (let i = 0; i < 2; i++) {
      const ok = await fetch(s.url + '/api/pay/paystack/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': sign(raw) }, body: raw });
      expect(ok.status).toBe(200);
    }
    expect(s.api.economy.wallet(p.accountId).cash).toBe(1850 + 250000);
    expect(s.api.payments.get(ref)).toMatchObject({ status: 'paid', providerRef: '77' });
  });
  it('coming back from the card page verifies with Paystack; a short payment is flagged, not granted', async () => {
    const p = await makePlayer(s, 'Verify Payer');
    const ref = (await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.small' }, p.token)).json.ref;
    verifyAmount = 100; // someone tampered with the amount
    expect((await http(s, 'GET', `/api/pay/status/${ref}`, undefined, p.token)).json.status).toBe('mismatch');
    expect(s.api.economy.wallet(p.accountId).cash).toBe(1850);
    verifyAmount = null;
    const ref2 = (await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.small' }, p.token)).json.ref;
    expect((await http(s, 'GET', `/api/pay/status/${ref2}`, undefined, p.token)).json).toMatchObject({ status: 'paid', granted: { cash: 250000 } });
    expect(s.api.economy.wallet(p.accountId).cash).toBe(1850 + 250000);
  });
  it('a pending live checkout cannot be cancelled from the game (it may still be paid)', async () => {
    const p = await makePlayer(s, 'Cancel Payer'); verifyStatus = 'abandoned';
    const ref = (await http(s, 'POST', '/api/pay/start', { sku: 'iap:pack.small' }, p.token)).json.ref;
    expect((await http(s, 'POST', `/api/pay/status/${ref}/cancel`, {}, p.token)).json.status).toBe('pending');
  });
});
