// Accounts, sessions, bans. Email or phone plus password, or a guest account that can be upgraded later.
import { EventEmitter } from 'node:events';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError, checkPasswordStrength, hashPassword, parseIdentifier, randomId, randomKey, sha256, signToken, verifyPassword, verifyToken } from './auth.ts';
import { validateName, nameKey, clampSkin, ROSTER_IDS } from '../../v2/src/net/rules.ts';

export type Role = 'player' | 'mod' | 'admin';
export interface AccountRow {
  id: string; email: string | null; phone: string | null; pw_hash: string | null; is_guest: number; guest_key_hash: string | null; role: Role;
  created_at: number; last_login: number | null; last_ip: string | null; ban_until: number | null; ban_reason: string | null; mute_until: number | null; note: string | null;
}
export interface ProfileRow { account_id: string; name: string; name_key: string; model: string; skin: number; outfit: string; xp: number; created_at: number; updated_at: number }
export interface Session { id: string; account_id: string; expires_at: number; revoked: number }

/** What the world sees of an account. Never includes the hash. */
export function publicAccount(a: AccountRow) {
  return { id: a.id, email: a.email, phone: a.phone, guest: !!a.is_guest, role: a.role, createdAt: a.created_at, lastLogin: a.last_login, banned: banState(a).banned, muted: !!(a.mute_until && (a.mute_until < 0 || a.mute_until > Date.now())) };
}
export function banState(a: Pick<AccountRow, 'ban_until' | 'ban_reason'>, now = Date.now()) {
  const u = a.ban_until;
  if (u === null || u === undefined) return { banned: false as const };
  if (u === -1) return { banned: true as const, until: null as number | null, reason: a.ban_reason ?? 'Banned' };
  if (u > now) return { banned: true as const, until: u, reason: a.ban_reason ?? 'Suspended' };
  return { banned: false as const };
}
export function publicProfile(p: ProfileRow, accountId = p.account_id) {
  return { v: 1 as const, accountId, name: p.name, model: p.model, skin: p.skin, outfit: p.outfit, xp: p.xp, createdAt: p.created_at, updatedAt: p.updated_at };
}

export interface AccountEvents {
  signup: [AccountRow]; login: [AccountRow, { ip: string }]; ban: [AccountRow, { reason: string; until: number | null; by: string | null }]; unban: [AccountRow];
  profile: [ProfileRow]; mute: [AccountRow];
}

export class Accounts extends EventEmitter {
  constructor(private db: DB, private cfg: Config) { super(); }

  byId(id: string) { return one<AccountRow>(this.db, 'SELECT * FROM accounts WHERE id=?', id); }
  byIdent(kind: 'email' | 'phone', value: string) { return one<AccountRow>(this.db, `SELECT * FROM accounts WHERE ${kind}=?`, value); }
  profile(id: string) { return one<ProfileRow>(this.db, 'SELECT * FROM profiles WHERE account_id=?', id); }
  profileByName(name: string) { return one<ProfileRow>(this.db, 'SELECT * FROM profiles WHERE name_key=?', nameKey(name)); }
  list(opts: { q?: string; limit?: number; offset?: number; role?: string } = {}) {
    const q = opts.q ? `%${opts.q.toLowerCase()}%` : null;
    const rows = all<AccountRow & { name: string | null }>(this.db,
      `SELECT a.*, p.name AS name FROM accounts a LEFT JOIN profiles p ON p.account_id=a.id
       WHERE (@q IS NULL OR lower(a.email) LIKE @q OR a.phone LIKE @q OR lower(p.name) LIKE @q OR a.id LIKE @q) AND (@role IS NULL OR a.role=@role)
       ORDER BY a.created_at DESC LIMIT @limit OFFSET @offset`, { q, role: opts.role ?? null, limit: Math.min(500, opts.limit ?? 50), offset: opts.offset ?? 0 });
    return rows.map((r) => ({ ...publicAccount(r), name: r.name, banReason: r.ban_reason, banUntil: r.ban_until }));
  }

  // -------------------------------------------------------------------------------- sessions
  createSession(accountId: string, ip: string, ua = ''): { token: string; sid: string; expires: number } {
    const now = Date.now(); const sid = randomId(); const expires = now + this.cfg.tokenDays * 86400_000;
    run(this.db, 'INSERT INTO sessions(id,account_id,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?)', sid, accountId, now, expires, ip, ua.slice(0, 200));
    return { token: signToken(this.cfg.jwtSecret, { sub: accountId, sid }, this.cfg.tokenDays, now), sid, expires };
  }
  /** Resolves a bearer token to a live account, or null. Does not check bans (callers decide how to react). */
  authenticate(token: string): { account: AccountRow; sid: string } | null {
    const c = verifyToken(this.cfg.jwtSecret, token); if (!c) return null;
    const s = one<Session>(this.db, 'SELECT id,account_id,expires_at,revoked FROM sessions WHERE id=?', c.sid);
    if (!s || s.revoked || s.expires_at < Date.now() || s.account_id !== c.sub) return null;
    const account = this.byId(c.sub); if (!account) return null;
    return { account, sid: s.id };
  }
  revokeSession(sid: string) { run(this.db, 'UPDATE sessions SET revoked=1 WHERE id=?', sid); }
  revokeAll(accountId: string, exceptSid?: string) { run(this.db, 'UPDATE sessions SET revoked=1 WHERE account_id=? AND id<>?', accountId, exceptSid ?? ''); }
  purgeSessions() { run(this.db, 'DELETE FROM sessions WHERE expires_at<? OR revoked=1 AND created_at<?', Date.now(), Date.now() - 7 * 86400_000); }

  // -------------------------------------------------------------------------------- sign up and in
  async signup(identRaw: unknown, password: unknown, ip: string, ua = '') {
    const ident = parseIdentifier(identRaw); if (!ident) throw new HttpError(400, 'Enter a valid email or phone number.');
    const weak = checkPasswordStrength(password, ident.value); if (weak) throw new HttpError(400, weak);
    if (this.byIdent(ident.kind, ident.value)) throw new HttpError(409, ident.kind === 'email' ? 'That email already has an account. Log in instead.' : 'That phone number already has an account. Log in instead.');
    const id = randomId(); const now = Date.now(); const hash = await hashPassword(password as string);
    try {
      run(this.db, `INSERT INTO accounts(id,${ident.kind},pw_hash,is_guest,role,created_at,last_login,last_ip) VALUES(?,?,?,0,'player',?,?,?)`, id, ident.value, hash, now, now, ip);
    } catch (e) { if (/UNIQUE/.test(String(e))) throw new HttpError(409, 'That account already exists.'); throw e; }
    const acc = this.byId(id)!; this.emit('signup', acc);
    return { account: acc, ...this.createSession(id, ip, ua) };
  }
  async login(identRaw: unknown, password: unknown, ip: string, ua = '') {
    const ident = parseIdentifier(identRaw);
    const acc = ident ? this.byIdent(ident.kind, ident.value) : undefined;
    const ok = await verifyPassword(typeof password === 'string' ? password : '', acc?.pw_hash);
    if (!acc || !ok) throw new HttpError(401, 'Wrong email, phone or password.');
    const b = banState(acc); if (b.banned) throw new HttpError(403, b.reason, { code: 'banned', until: b.until });
    run(this.db, 'UPDATE accounts SET last_login=?, last_ip=? WHERE id=?', Date.now(), ip, acc.id);
    this.emit('login', acc, { ip });
    return { account: this.byId(acc.id)!, ...this.createSession(acc.id, ip, ua) };
  }
  /** Guest: no password. The client keeps the returned guestKey to come back to the same account. */
  async guest(guestKey: unknown, ip: string, ua = '') {
    if (!this.cfg.guestAccounts) throw new HttpError(403, 'Guest play is switched off. Sign up with email or phone.');
    if (typeof guestKey === 'string' && guestKey.length >= 16 && guestKey.length < 100) {
      const acc = one<AccountRow>(this.db, 'SELECT * FROM accounts WHERE guest_key_hash=? AND is_guest=1', sha256(guestKey));
      if (acc) {
        const b = banState(acc); if (b.banned) throw new HttpError(403, b.reason, { code: 'banned', until: b.until });
        run(this.db, 'UPDATE accounts SET last_login=?, last_ip=? WHERE id=?', Date.now(), ip, acc.id);
        this.emit('login', acc, { ip });
        return { account: acc, guestKey: guestKey, ...this.createSession(acc.id, ip, ua) };
      }
    }
    const id = randomId(); const key = randomKey(); const now = Date.now();
    run(this.db, `INSERT INTO accounts(id,is_guest,guest_key_hash,role,created_at,last_login,last_ip) VALUES(?,1,?,'player',?,?,?)`, id, sha256(key), now, now, ip);
    const acc = this.byId(id)!; this.emit('signup', acc);
    return { account: acc, guestKey: key, ...this.createSession(id, ip, ua) };
  }
  /** Turn a guest into a full account, keeping the profile, cash and land. */
  async upgrade(accountId: string, identRaw: unknown, password: unknown) {
    const acc = this.byId(accountId); if (!acc) throw new HttpError(404, 'No such account.');
    if (!acc.is_guest) throw new HttpError(400, 'This account is already registered.');
    const ident = parseIdentifier(identRaw); if (!ident) throw new HttpError(400, 'Enter a valid email or phone number.');
    const weak = checkPasswordStrength(password, ident.value); if (weak) throw new HttpError(400, weak);
    if (this.byIdent(ident.kind, ident.value)) throw new HttpError(409, 'That email or phone already has an account. Log in to it instead.');
    const hash = await hashPassword(password as string);
    try { run(this.db, `UPDATE accounts SET ${ident.kind}=?, pw_hash=?, is_guest=0, guest_key_hash=NULL WHERE id=?`, ident.value, hash, accountId); }
    catch (e) { if (/UNIQUE/.test(String(e))) throw new HttpError(409, 'That email or phone already has an account.'); throw e; }
    return this.byId(accountId)!;
  }
  async changePassword(accountId: string, oldPw: unknown, newPw: unknown, keepSid?: string) {
    const acc = this.byId(accountId); if (!acc) throw new HttpError(404, 'No such account.');
    if (!(await verifyPassword(typeof oldPw === 'string' ? oldPw : '', acc.pw_hash))) throw new HttpError(401, 'Current password is wrong.');
    const weak = checkPasswordStrength(newPw, acc.email ?? acc.phone ?? ''); if (weak) throw new HttpError(400, weak);
    run(this.db, 'UPDATE accounts SET pw_hash=? WHERE id=?', await hashPassword(newPw as string), accountId);
    this.revokeAll(accountId, keepSid);
  }
  /** Admin tool: set a new password without the old one (the player gets a temporary one out of band). */
  async adminSetPassword(accountId: string, newPw: string) {
    const weak = checkPasswordStrength(newPw); if (weak) throw new HttpError(400, weak);
    run(this.db, 'UPDATE accounts SET pw_hash=? WHERE id=?', await hashPassword(newPw), accountId); this.revokeAll(accountId);
  }
  setRole(accountId: string, role: Role) { run(this.db, 'UPDATE accounts SET role=? WHERE id=?', role, accountId); }
  /** Make sure the configured administrator exists (called at boot). */
  async ensureAdmin(email: string, password: string) {
    if (!email || !password) return null;
    const ident = parseIdentifier(email); if (!ident || ident.kind !== 'email') return null;
    let acc = this.byIdent('email', ident.value);
    if (!acc) {
      const id = randomId(); const now = Date.now();
      run(this.db, `INSERT INTO accounts(id,email,pw_hash,is_guest,role,created_at) VALUES(?,?,?,0,'admin',?)`, id, ident.value, await hashPassword(password), now);
      acc = this.byId(id)!;
    } else if (acc.role !== 'admin') this.setRole(acc.id, 'admin');
    return acc;
  }

  // -------------------------------------------------------------------------------- bans and mutes
  ban(accountId: string, o: { reason: string; until?: number | null; by?: string | null }) {
    const acc = this.byId(accountId); if (!acc) throw new HttpError(404, 'No such account.');
    const until = o.until === null || o.until === undefined ? -1 : o.until;
    const now = Date.now();
    run(this.db, 'UPDATE accounts SET ban_until=?, ban_reason=? WHERE id=?', until, o.reason, accountId);
    run(this.db, 'INSERT INTO bans(account_id,by_id,reason,created_at,until) VALUES(?,?,?,?,?)', accountId, o.by ?? null, o.reason, now, until);
    this.revokeAll(accountId);
    this.emit('ban', this.byId(accountId)!, { reason: o.reason, until: until === -1 ? null : until, by: o.by ?? null });
  }
  unban(accountId: string, by?: string | null) {
    run(this.db, 'UPDATE accounts SET ban_until=NULL, ban_reason=NULL WHERE id=?', accountId);
    run(this.db, 'UPDATE bans SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL', Date.now(), accountId);
    void by; this.emit('unban', this.byId(accountId)!);
  }
  banHistory(accountId: string) { return all<{ id: number; by_id: string | null; reason: string; created_at: number; until: number | null; revoked_at: number | null }>(this.db, 'SELECT * FROM bans WHERE account_id=? ORDER BY id DESC', accountId); }
  mute(accountId: string, until: number | null) { run(this.db, 'UPDATE accounts SET mute_until=? WHERE id=?', until === null ? -1 : until, accountId); this.emit('mute', this.byId(accountId)!); }
  unmute(accountId: string) { run(this.db, 'UPDATE accounts SET mute_until=NULL WHERE id=?', accountId); }
  isMuted(a: Pick<AccountRow, 'mute_until'>) { return !!a.mute_until && (a.mute_until < 0 || a.mute_until > Date.now()); }

  // -------------------------------------------------------------------------------- profile: exactly one per account
  createProfile(accountId: string, d: { name: unknown; model: unknown; skin: unknown; outfit: unknown }): ProfileRow {
    if (this.profile(accountId)) throw new HttpError(409, 'This account already has a profile.', { code: 'profile_exists' });
    const n = validateName(String(d.name ?? '')); if (!n.ok) throw new HttpError(400, n.error);
    const model = String(d.model); if (!(ROSTER_IDS as readonly string[]).includes(model)) throw new HttpError(400, 'Unknown hustler.');
    const outfit = String(d.outfit ?? 'street').slice(0, 32).replace(/[^\w\-]/g, ''); const skin = clampSkin(Number(d.skin));
    const now = Date.now();
    try { run(this.db, 'INSERT INTO profiles(account_id,name,name_key,model,skin,outfit,xp,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?)', accountId, n.name, nameKey(n.name), model, skin, outfit || 'street', now, now); }
    catch (e) { if (/name_key/.test(String(e))) throw new HttpError(409, 'That name is taken. Pick another.', { code: 'name_taken' }); if (/UNIQUE|PRIMARY/.test(String(e))) throw new HttpError(409, 'This account already has a profile.', { code: 'profile_exists' }); throw e; }
    const p = this.profile(accountId)!; this.emit('profile', p); return p;
  }
  updateProfile(accountId: string, patch: Record<string, unknown>): ProfileRow {
    const cur = this.profile(accountId); if (!cur) throw new HttpError(404, 'No profile to update.');
    let name = cur.name, key = cur.name_key, model = cur.model, skin = cur.skin, outfit = cur.outfit, xp = cur.xp;
    if (patch.name !== undefined) { const n = validateName(String(patch.name)); if (!n.ok) throw new HttpError(400, n.error); name = n.name; key = nameKey(n.name); }
    if (patch.model !== undefined) { if (!(ROSTER_IDS as readonly string[]).includes(String(patch.model))) throw new HttpError(400, 'Unknown hustler.'); model = String(patch.model); }
    if (patch.skin !== undefined) skin = clampSkin(Number(patch.skin));
    if (patch.outfit !== undefined) outfit = String(patch.outfit).slice(0, 32).replace(/[^\w\-]/g, '') || 'street';
    // xp only ever goes up by a sane step per call; real XP awards belong to server side events
    if (patch.xp !== undefined) { const nx = Math.floor(Number(patch.xp)); if (Number.isFinite(nx) && nx >= cur.xp && nx - cur.xp <= 5000) xp = nx; }
    try { run(this.db, 'UPDATE profiles SET name=?, name_key=?, model=?, skin=?, outfit=?, xp=?, updated_at=? WHERE account_id=?', name, key, model, skin, outfit, xp, Date.now(), accountId); }
    catch (e) { if (/name_key/.test(String(e))) throw new HttpError(409, 'That name is taken. Pick another.', { code: 'name_taken' }); throw e; }
    const p = this.profile(accountId)!; this.emit('profile', p); return p;
  }
  addXp(accountId: string, n: number) { run(this.db, 'UPDATE profiles SET xp=xp+?, updated_at=? WHERE account_id=?', Math.max(0, Math.floor(n)), Date.now(), accountId); }
}
