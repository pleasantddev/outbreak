// Sign up, log in, guests, upgrade, log out. All bearer token based; the game stores the token and the guest key locally.
import type { Api } from '../src/api.ts';
import { publicAccount } from '../src/accounts.ts';
import { HttpError } from '../src/auth.ts';

export function register(api: Api) {
  const { accounts } = api;
  const strict = { rate: { limit: 12, windowMs: 10 * 60_000 } };
  const session = (r: { account: Parameters<typeof publicAccount>[0]; token: string; expires: number; guestKey?: string }) => ({
    token: r.token, expires: r.expires, account: publicAccount(r.account), hasProfile: !!accounts.profile(r.account.id), ...(r.guestKey ? { guestKey: r.guestKey } : {}),
  });

  api.post('/api/auth/signup', async (req) => {
    const r = await accounts.signup(req.body.identifier ?? req.body.email ?? req.body.phone, req.body.password, req.ip, String(req.headers['user-agent'] ?? ''));
    return session(r);
  }, strict);

  api.post('/api/auth/login', async (req) => {
    // a second limiter keyed by the identifier, so one account cannot be ground down from many addresses
    const key = String(req.body.identifier ?? req.body.email ?? req.body.phone ?? '').toLowerCase().slice(0, 120);
    if (!api.limiters.loginById.take(key)) throw new HttpError(429, 'Too many tries on this account. Wait a few minutes.');
    const r = await accounts.login(key, req.body.password, req.ip, String(req.headers['user-agent'] ?? ''));
    api.limiters.loginById.reset(key);
    return session(r);
  }, strict);

  api.post('/api/auth/guest', async (req) => {
    if (!api.limiters.guestCreate.take(req.ip) && !req.body.guestKey) throw new HttpError(429, 'Too many guest accounts from this connection.');
    return session(await accounts.guest(req.body.guestKey, req.ip, String(req.headers['user-agent'] ?? '')));
  }, strict);

  api.post('/api/auth/upgrade', async (req) => {
    const acc = await accounts.upgrade(req.account!.id, req.body.identifier ?? req.body.email ?? req.body.phone, req.body.password);
    return { account: publicAccount(acc) };
  }, { auth: 'user', rate: { limit: 10, windowMs: 10 * 60_000 } });

  api.post('/api/auth/password', async (req) => {
    await accounts.changePassword(req.account!.id, req.body.oldPassword, req.body.newPassword, req.sid ?? undefined);
    return { ok: true };
  }, { auth: 'user', rate: { limit: 6, windowMs: 10 * 60_000 } });

  api.post('/api/auth/logout', (req) => { if (req.sid) accounts.revokeSession(req.sid); return { ok: true }; }, { auth: 'user' });

  api.get('/api/auth/me', (req) => {
    const a = req.account!;
    const p = accounts.profile(a.id);
    return { account: publicAccount(a), hasProfile: !!p, name: p?.name ?? null };
  }, { auth: 'user' });
}
