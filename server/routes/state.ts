// Wallet, saved state and ledger of the signed in player. Money is read-only here: it only moves through economy actions.
import type { Api } from '../src/api.ts';
import { HttpError } from '../src/auth.ts';

export function register(api: Api) {
  const eco = api.economy;

  api.get('/api/me/wallet', (req) => eco.wallet(req.account!.id), { auth: 'user' });
  api.get('/api/me/history', (req) => ({ items: eco.history(req.account!.id, Number(req.query.limit) || 50, req.query.before ? Number(req.query.before) : undefined) }), { auth: 'user' });

  // saved progress (skills, missions, vehicles, any system's own key). Cash, bank and land are not accepted here.
  api.get('/api/me/state', (req) => {
    const s = eco.state(req.account!.id);
    return { ...s.blobs, vehicles: s.vehicles, skills: s.skills, missions: s.missions };
  }, { auth: 'user' });
  api.put('/api/me/state', (req) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send an object of { key: value }.');
    const keys = Object.keys(body);
    if (keys.length > 32) throw new HttpError(400, 'Too many keys in one call.');
    for (const k of keys) eco.putState(req.account!.id, k, body[k]);
    return { ok: true, keys };
  }, { auth: 'user', bodyLimit: 1024 * 1024, rate: { limit: 60, windowMs: 60_000 } });

  // bank over plain HTTP, for tools; the game itself uses the socket
  api.post('/api/me/bank', (req) => {
    const a = String(req.body.action); const n = Number(req.body.amount);
    if (a === 'deposit') return eco.deposit(req.account!.id, n);
    if (a === 'withdraw') return eco.withdraw(req.account!.id, n);
    throw new HttpError(400, 'action must be deposit or withdraw.');
  }, { auth: 'user' });
}
