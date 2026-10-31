// MyAds for players. Prices and checks live in src/ads.ts; money goes through the one checkout in src/payments.ts (Paystack).
import type { Api } from '../src/api.ts';
import { HANDLED } from '../src/api.ts';
import { HttpError } from '../src/auth.ts';
import { readFileSync } from 'node:fs';
import { AD_DAYS, BLIMP_DAY, BLIMPS, DRONE_SPOTS, DRONE_TEXT_MAX, lagosDay } from '../../v2/src/net/rules.ts';

export function register(api: Api) {
  const { ads, payments } = api;
  // the shop window: every board with its day rate and when it is next free, plus the sky options
  api.get('/api/ads/boards', () => ({
    mode: payments.mode, test: payments.mode !== 'live', today: lagosDay(Date.now()), days: AD_DAYS,
    boards: ads.inventory(),
    drone: { spots: DRONE_SPOTS.map((s) => ({ ...s, day: ads.quote('drone', 1, s.id).day, nextFree: ads.nextFree('drone', s.id) })), textMax: DRONE_TEXT_MAX },
    blimp: { day: BLIMP_DAY, fleet: BLIMPS, nextFree: ads.nextFree('blimp', null), size: { w: 1600, h: 400 } },
  }));
  api.get('/api/ads/quote', (req) => ads.quote(req.query.kind as never, Number(req.query.days) || 1, req.query.key));
  // orders go through the one checkout: POST /api/pay/start { sku: 'ad:new', meta: { kind, board|place, days, start, upload|text,color } }
  api.get('/api/ads/mine', (req) => ({ mode: payments.mode, list: ads.mine(req.account!.id) }), { auth: 'user' });
  api.get('/api/ads/live', () => ({ list: ads.live() }));

  // pictures: a player uploads a cropped image; it is public only once an ad using it is approved
  api.post('/api/uploads', (req) => ads.saveUpload(req.account!.id, req.body?.data, 'ad'), { auth: 'user', bodyLimit: 4_200_000, rate: { limit: 30, windowMs: 60 * 60_000 } });
  api.get('/api/uploads/:id', (req) => {
    const u = ads.upload(req.params.id); const f = u && ads.uploadFile(u);
    if (!u || !f) throw new HttpError(404, 'No such picture.');
    const mine = req.account && (req.account.id === u.account_id || req.account.role !== 'player');
    if (!mine && !ads.isPublic(u.id)) throw new HttpError(404, 'No such picture.');
    const res = req.res; res.statusCode = 200; res.setHeader('Content-Type', u.mime); res.setHeader('Cache-Control', 'public, max-age=86400, immutable'); res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(readFileSync(f)); return HANDLED;
  });

}
