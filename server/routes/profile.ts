// The one profile per account. These three endpoints are what the client's server-backed ProfileStore calls.
import type { Api } from '../src/api.ts';
import { publicProfile } from '../src/accounts.ts';
import { HttpError } from '../src/auth.ts';

export function register(api: Api) {
  const { accounts } = api;
  const mine = api.get('/api/profile', (req) => {
    const p = accounts.profile(req.account!.id);
    if (!p) throw new HttpError(404, 'No profile yet.', { code: 'no_profile' });
    return publicProfile(p);
  }, { auth: 'user' });
  void mine;

  // create: only possible once per account; the primary key on profiles.account_id enforces it as well
  api.post('/api/profile', (req) => {
    const p = accounts.createProfile(req.account!.id, req.body);
    api.economy.ensurePlayer(req.account!.id);
    return publicProfile(p);
  }, { auth: 'user', rate: { limit: 20, windowMs: 60_000 } });

  api.patch('/api/profile', (req) => publicProfile(accounts.updateProfile(req.account!.id, req.body)), { auth: 'user', rate: { limit: 60, windowMs: 60_000 } });

  // public card of another player (name, look, level) for the phone / scoreboards
  api.get('/api/players/:name', (req) => {
    const p = accounts.profileByName(req.params.name);
    if (!p) throw new HttpError(404, 'No such player.');
    return { name: p.name, model: p.model, skin: p.skin, outfit: p.outfit, xp: p.xp, online: api.online.isOnline(p.account_id), plots: api.economy.plotsOf(p.account_id).length };
  });
}
