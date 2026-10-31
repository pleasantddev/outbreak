import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, http, makePlayer, TestClient, type TestServer } from './helpers.ts';
import { imageSize } from '../src/ads.ts';
import { adPixels, adQuote, boardDayRate, AD_BASE, lagosDay } from '../../v2/src/net/rules.ts';

let s: TestServer;
beforeAll(async () => { delete process.env.PAYSTACK_SECRET_KEY; s = await boot({ paystackSecret: '', payTest: true }); });
const order = (tok: string, meta: Record<string, unknown>) => http(s, 'POST', '/api/pay/start', { sku: 'ad:new', meta }, tok);
const testPay = (tok: string, ref: string) => http(s, 'POST', `/api/pay/status/${ref}/test-complete`, {}, tok);
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
    const wrong = await order(owner.token, { kind: 'board', board: board.id, days: 3, upload: bad.json.id });
    expect(wrong.status).toBe(400); expect(wrong.json.error).toMatch(/needs a/);
    const up = await http(s, 'POST', '/api/uploads', { data: png(board.px.w, board.px.h) }, owner.token); expect(up.status).toBe(200);
    const notPublic = await http(s, 'GET', `/api/uploads/${up.json.id}`); expect(notPublic.status).toBe(404);
    const o = await order(owner.token, { kind: 'board', board: board.id, days: 3, upload: up.json.id });
    expect(o.status).toBe(200); expect(o.json.mode).toBe('test'); expect(o.json.amountKobo).toBe(adQuote('board', 3, { board }).total * 100); expect(o.json.label).toMatch(/^Billboard: /);
    const adId = (await http(s, 'GET', '/api/ads/mine', undefined, owner.token)).json.list[0].id;
    expect((await http(s, 'GET', '/api/ads/mine', undefined, owner.token)).json.list[0].status).toBe('unpaid');
    // the slot is held while the owner pays
    const up2 = await http(s, 'POST', '/api/uploads', { data: png(board.px.w, board.px.h) }, rival.token);
    const clash = await order(rival.token, { kind: 'board', board: board.id, days: 1, upload: up2.json.id }); expect(clash.status).toBe(409);
    // someone else cannot complete my payment
    expect((await testPay(rival.token, o.json.ref)).status).toBe(404);
    const paid = await testPay(owner.token, o.json.ref); expect(paid.json.status).toBe('paid'); expect(paid.json.granted.adId).toBe(adId);
    expect(s.api.ads.get(adId)!.status).toBe('review');
    const again = await testPay(owner.token, o.json.ref); expect(again.json.status).toBe('paid'); expect(s.api.ads.get(adId)!.status).toBe('review'); // fulfils once
    // review: approve, and every connected client gets the feed
    const vc = await new TestClient(s, viewer.token).connect(); const oc = await new TestClient(s, owner.token).connect();
    const row = await s.api.ads.review(adId, 'approve'); expect(row.status).toBe('approved');
    await vc.until(() => vc.msgs.some((m) => m.t === 'ads'));
    const feed = vc.msgs.filter((m) => m.t === 'ads').pop(); expect(feed.list.map((a: any) => a.id)).toContain(adId);
    expect((await http(s, 'GET', `/api/uploads/${up.json.id}`)).status).toBe(200);
    // reach: the owner looking at their own board does not count; a real player counts once a day
    expect((await oc.act('ads.seen', { ids: [adId] })).counted).toBe(0);
    expect((await vc.act('ads.seen', { ids: [adId, 999999] })).counted).toBe(1);
    expect((await vc.act('ads.seen', { ids: [adId] })).counted).toBe(0);
    const mine = await http(s, 'GET', '/api/ads/mine', undefined, owner.token);
    const me = mine.json.list.find((a: any) => a.id === adId);
    expect(me.status).toBe('live'); expect(me.reach).toBe(1); expect(me.days).toEqual([{ day: lagosDay(Date.now()), people: 1, sightings: 1 }]);
    const ledger = await http(s, 'GET', '/api/pay/mine', undefined, owner.token); expect(ledger.json.items[0].status).toBe('paid'); expect(ledger.json.items[0].sku).toBe('ad:new');
    vc.close(); oc.close();
  }, 20000);

  it('drone shows check the words, and a rejected ad is refunded', async () => {
    const p = await makePlayer(s, 'Drone Dayo');
    const bad = await order(p.token, { kind: 'drone', place: 'lagoon', days: 1, text: '<script>' }); expect(bad.status).toBe(400);
    const ok = await order(p.token, { kind: 'drone', place: 'lagoon', days: 1, text: 'Happy birthday Ada', color: '#ffd23f' });
    expect(ok.status).toBe(200); expect(ok.json.amountKobo).toBeGreaterThanOrEqual(350000 * 100);
    const paid = await testPay(p.token, ok.json.ref); const id = paid.json.granted.adId as number;
    expect(s.api.ads.get(id)!.text).toBe('HAPPY BIRTHDAY ADA');
    const r = await s.api.ads.review(id, 'reject', 'Use your own name'); expect(r.status).toBe('rejected');
    const pays = await http(s, 'GET', '/api/pay/mine', undefined, p.token); expect(pays.json.items[0].status).toBe('refunded');
    await sleep(10);
  }, 20000);
});
