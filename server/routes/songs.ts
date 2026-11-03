// My Music: players upload songs they own (and say so), hear them back, and DJs stream cleared ones in the clubs.
// Promotion into club rotation is bought through the one checkout: POST /api/pay/start { sku: 'song:<id>', meta: { club, days } }.
import type { Api } from '../src/api.ts';
import { HANDLED } from '../src/api.ts';
import { HttpError } from '../src/auth.ts';
import { readFileSync } from 'node:fs';
import { PROMO_DAYS, promoQuote, CLUB_IDS } from '../../v2/src/net/clubs.ts';

export function register(api: Api) {
  const { clubs } = api;
  api.post('/api/songs', (req) => clubs.saveSong(req.account!.id, req.body ?? {}), { auth: 'user', bodyLimit: 11_000_000, rate: { limit: 12, windowMs: 60 * 60_000 } });
  api.get('/api/songs/mine', (req) => ({ list: clubs.mine(req.account!.id) }), { auth: 'user' });
  api.get('/api/songs/prices', () => ({ days: PROMO_DAYS, clubs: [...CLUB_IDS, 'all'].map((c) => ({ club: c, quotes: PROMO_DAYS.map((d) => promoQuote(c as never, d)) })) }));
  api.get('/api/songs/:id/audio', (req) => {
    const s = clubs.song(req.params.id); const f = s && clubs.songFile(s);
    if (!s || !f || s.status === 'deleted' || !clubs.canHear(s, req.account)) throw new HttpError(404, 'No such song.');
    const buf = readFileSync(f); const res = req.res; const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
    res.setHeader('Content-Type', s.mime); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', s.status === 'approved' ? 'public, max-age=86400' : 'private, no-store');
    if (range) {
      const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
      if (a >= buf.length || a > b) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${buf.length}`); res.end(); return HANDLED; }
      res.statusCode = 206; res.setHeader('Content-Range', `bytes ${a}-${b}/${buf.length}`); res.end(buf.subarray(a, b + 1)); return HANDLED;
    }
    res.statusCode = 200; res.end(buf); return HANDLED;
  }, { auth: 'none' });
}
