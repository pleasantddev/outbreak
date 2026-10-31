import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { boot, http, makePlayer, TestClient, type TestServer } from './helpers.ts';
import { Payments } from '../src/payments.ts';
import { imageSize } from '../src/ads.ts';
import { adPixels, adQuote, boardDayRate, AD_BASE, lagosDay } from '../../v2/src/net/rules.ts';
import { openDb } from '../src/db.ts';

let s: TestServer;
beforeAll(async () => { delete process.env.PAYSTACK_SECRET_KEY; s = await boot(); });
afterAll(async () => { await s.close(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** a PNG header is all the server reads for the size */
const png = (w: number, h: number) => {
  const b = Buffer.alloc(64); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return 'data:image/png;base64,' + b.toString('base64');
};

describe('MyAds pricing', () => {
  it('starts at ₦4,500 a day and scales with tier, size, shared LED slots and long runs', () => {
    const street = { id: 'x', x: 0, y: 0, z: 0, yaw: 0, w: 8, h: 5, place: '', tier: 'street' };
    expect(boardDayRate(street)).toBe(AD_BASE);
    const prime = { ...street, w: 24, h: 7, tier: 'prime' };
    expect(boardDayRate(prime)).toBeGreaterThan(AD_BASE * 5);
    expect(boardDayRate({ ...prime, slots: 3 })).toBe(Math.round(boardDayRate(prime) / 2 / 100) * 100);
    const q7 = adQuote('board', 7, { board: street }); expect(q7.total).toBe(Math.round(AD_BASE * 7 * 0.9 / 100) * 100);
    expect(adQuote('drone', 1, { spot: 'lagoon' }).day).toBeGreaterThan(adQuote('drone', 1, { spot: 'oshodi' }).day);
    expect(adPixels({ w: 24, h: 7 })).toEqual({ w: 1536, h: 448 });
    expect(imageSize(Buffer.from(png(1536, 448).split(',')[1], 'base64'))).toEqual({ mime: 'image/png', w: 1536, h: 448 });
  });
});

describe('MyAds orders, payment, review, live feed and real-player reach', () => {
  it('books a board in test mode, pays, gets approved, shows to everyone and counts each other player once a day', async () => {
    const owner = await makePlayer(s, 'Adeola Ads'); const rival = await makePlayer(s, 'Rival Ralph'); const viewer = await makePlayer(s, 'Viewer Vic');
    const inv = await http(s, 'GET', '/api/ads/boards'); expect(inv.status).toBe(200); expect(inv.json.test).toBe(true);
    const board = inv.json.boards.find((b: any) => (b.slots ?? 1) === 1); expect(board).toBeTruthy(); expect(board.day).toBeGreaterThanOrEqual(4500);
    const bad = await http(s, 'POST', '/api/uploads', { data: png(800, 800) }, owner.token); expect(bad.status).toBe(200);
    const wrong = await http(s, 'POST', '/api/ads/order', { kind: 'board', board: board.id, days: 3, upload: bad.json.id }, owner.token);
    expect(wrong.status).toBe(400); expect(wrong.json.error).toMatch(/needs a/);
    const up = await http(s, 'POST', '/api/uploads', { data: png(board.px.w, board.px.h) }, owner.token); expect(up.status).toBe(200);
    const notPublic = await http(s, 'GET', `/api/uploads/${up.json.id}`); expect(notPublic.status).toBe(404);
    const order = await http(s, 'POST', '/api/ads/order', { kind: 'board', board: board.id, days: 3, upload: up.json.id, email: 'adeola@example.com' }, owner.token);
    expect(order.status).toBe(200); expect(order.json.pay.test).toBe(true); expect(order.json.ad.status).toBe('unpaid'); expect(order.json.pay.amount).toBe(adQuote('board', 3, { board }).total);
    // the slot is held while the owner pays
    const up2 = await http(s, 'POST', '/api/uploads', { data: png(board.px.w, board.px.h) }, rival.token);
    const clash = await http(s, 'POST', '/api/ads/order', { kind: 'board', board: board.id, days: 1, upload: up2.json.id, email: 'r@example.com' }, rival.token); expect(clash.status).toBe(409);
    // someone else cannot complete my payment
    expect((await http(s, 'POST', '/api/pay/verify', { reference: order.json.pay.reference, test: true }, rival.token)).status).toBe(403);
    const paid = await http(s, 'POST', '/api/pay/verify', { reference: order.json.pay.reference, test: true }, owner.token);
    expect(paid.json.status).toBe('paid'); expect(paid.json.ad.status).toBe('review');
    const again = await http(s, 'POST', '/api/pay/verify', { reference: order.json.pay.reference, test: true }, owner.token); expect(again.json.ad.status).toBe('review'); // fulfils once
    // review: approve, and every connected client gets the feed
    const vc = await new TestClient(s, viewer.token).connect(); const oc = await new TestClient(s, owner.token).connect();
    const row = await s.api.ads.review(order.json.ad.id, 'approve'); expect(row.status).toBe('approved');
    await vc.until(() => vc.msgs.some((m) => m.t === 'ads'));
    const feed = vc.msgs.filter((m) => m.t === 'ads').pop(); expect(feed.list.map((a: any) => a.id)).toContain(order.json.ad.id);
    expect((await http(s, 'GET', `/api/uploads/${up.json.id}`)).status).toBe(200);
    // reach: the owner looking at their own board does not count; a real player counts once a day
    expect((await oc.act('ads.seen', { ids: [order.json.ad.id] })).counted).toBe(0);
    expect((await vc.act('ads.seen', { ids: [order.json.ad.id, 999999] })).counted).toBe(1);
    expect((await vc.act('ads.seen', { ids: [order.json.ad.id] })).counted).toBe(0);
    const mine = await http(s, 'GET', '/api/ads/mine', undefined, owner.token);
    const me = mine.json.list.find((a: any) => a.id === order.json.ad.id);
    expect(me.status).toBe('live'); expect(me.reach).toBe(1); expect(me.days).toEqual([{ day: lagosDay(Date.now()), people: 1, sightings: 1 }]);
    const ledger = await http(s, 'GET', '/api/pay/mine', undefined, owner.token); expect(ledger.json.list[0].status).toBe('paid');
    vc.close(); oc.close();
  }, 20000);

  it('drone shows check the words, rejected ads are refunded, the webhook needs Paystack\'s signature', async () => {
    const p = await makePlayer(s, 'Drone Dayo');
    const bad = await http(s, 'POST', '/api/ads/order', { kind: 'drone', place: 'lagoon', days: 1, text: '<script>' }, p.token); expect(bad.status).toBe(400);
    const ok = await http(s, 'POST', '/api/ads/order', { kind: 'drone', place: 'lagoon', days: 1, text: 'Happy birthday Ada', color: '#ffd23f', email: 'dayo@example.com' }, p.token);
    expect(ok.status).toBe(200); expect(ok.json.ad.text).toBe('HAPPY BIRTHDAY ADA'); expect(ok.json.pay.amount).toBeGreaterThanOrEqual(350000);
    await http(s, 'POST', '/api/pay/verify', { reference: ok.json.pay.reference, test: true }, p.token);
    const r = await s.api.ads.review(ok.json.ad.id, 'reject', 'Use your own name'); expect(r.status).toBe('rejected');
    const pays = await http(s, 'GET', '/api/pay/mine', undefined, p.token); expect(pays.json.list[0].status).toBe('refunded');
    // webhook in test mode is refused; with a key it checks the signature
    expect((await http(s, 'POST', '/api/pay/webhook', { event: 'charge.success' })).status).toBe(400);
    const db = openDb(':memory:'); const live = new Payments(db, { info() {}, warn() {} }, { PAYSTACK_SECRET_KEY: 'sk_test_abc' } as any);
    const raw = JSON.stringify({ event: 'transfer.success', data: {} });
    await expect(live.webhook(raw, 'nope')).rejects.toThrow(/signature/);
    await expect(live.webhook(raw, createHmac('sha512', 'sk_test_abc').update(raw).digest('hex'))).resolves.toEqual({ ok: true });
    await sleep(10);
  }, 20000);
});
