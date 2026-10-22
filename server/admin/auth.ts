import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { SqlDb } from './db';
import { type AdminUser, type Role, ROLES } from './types';

export const SESSION_MS = 12 * 3600 * 1000;
export function hashPassword(pw: string) { const salt = randomBytes(16); const h = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }); return `s1$${salt.toString('base64')}$${h.toString('base64')}`; }
export function verifyPassword(pw: string, stored: string) {
  const [v, s, h] = stored.split('$'); if (v !== 's1' || !s || !h) return false;
  const want = Buffer.from(h, 'base64'); const got = scryptSync(pw, Buffer.from(s, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return want.length === got.length && timingSafeEqual(want, got);
}
export function checkPasswordStrength(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (!/[a-z]/i.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and at least one number';
  if (/^(password|12345|qwerty|admin)/i.test(pw)) return 'That password is too easy to guess';
  return null;
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const rowToUser = (r: any): AdminUser => ({ id: r.id, email: r.email, name: r.name, role: r.role as Role, disabled: !!r.disabled, createdAt: r.created_at, lastLogin: r.last_login ?? null });

export class Auth {
  private fails = new Map<string, { n: number; until: number }>();
  constructor(private db: SqlDb) {}
  count() { return (this.db.prepare('SELECT COUNT(*) c FROM admin_users').get() as any).c as number; }
  createUser(email: string, name: string, role: Role, password: string, mustChange = false): AdminUser {
    if (!ROLES.includes(role)) throw new Error('bad role');
    const now = Date.now(); const r = this.db.prepare('INSERT INTO admin_users(email,name,role,pw_hash,created_at,must_change) VALUES(?,?,?,?,?,?)').run(email.trim().toLowerCase(), name.trim(), role, hashPassword(password), now, mustChange ? 1 : 0);
    return this.getUser(Number(r.lastInsertRowid))!;
  }
  getUser(id: number) { const r = this.db.prepare('SELECT * FROM admin_users WHERE id=?').get(id); return r ? rowToUser(r) : null; }
  listUsers() { return this.db.prepare('SELECT * FROM admin_users ORDER BY id').all().map(rowToUser); }
  login(email: string, password: string, ip: string, ua: string): { token: string; user: AdminUser; mustChange: boolean } | { error: string; retryAfter?: number } {
    const key = email.trim().toLowerCase() + '|' + ip; const f = this.fails.get(key);
    if (f && f.n >= 5 && f.until > Date.now()) return { error: 'Too many attempts. Try again later.', retryAfter: Math.ceil((f.until - Date.now()) / 1000) };
    const r = this.db.prepare('SELECT * FROM admin_users WHERE email=?').get(email.trim().toLowerCase());
    const ok = r && !r.disabled && verifyPassword(password, r.pw_hash);
    if (!ok) { const n = (f && f.until > Date.now() ? f.n : 0) + 1; this.fails.set(key, { n, until: Date.now() + 15 * 60_000 }); return { error: r?.disabled ? 'This account is disabled' : 'Wrong email or password' }; }
    this.fails.delete(key);
    const token = randomBytes(32).toString('base64url'); const now = Date.now();
    this.db.prepare('INSERT INTO admin_sessions(token_hash,user_id,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?)').run(sha(token), r.id, now, now + SESSION_MS, ip, ua.slice(0, 200));
    this.db.prepare('UPDATE admin_users SET last_login=? WHERE id=?').run(now, r.id);
    return { token, user: rowToUser(r), mustChange: !!r.must_change };
  }
  verify(token: string): AdminUser | null {
    if (!token) return null; const h = sha(token); const s = this.db.prepare('SELECT * FROM admin_sessions WHERE token_hash=?').get(h);
    if (!s) return null; if (s.expires_at < Date.now()) { this.db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(h); return null; }
    const u = this.db.prepare('SELECT * FROM admin_users WHERE id=?').get(s.user_id); if (!u || u.disabled) return null;
    if (s.expires_at - Date.now() < SESSION_MS / 2) this.db.prepare('UPDATE admin_sessions SET expires_at=? WHERE token_hash=?').run(Date.now() + SESSION_MS, h);
    return rowToUser(u);
  }
  logout(token: string) { this.db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(sha(token)); }
  revokeAll(userId: number) { this.db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(userId); }
  setPassword(userId: number, pw: string, mustChange = false) { this.db.prepare('UPDATE admin_users SET pw_hash=?, must_change=? WHERE id=?').run(hashPassword(pw), mustChange ? 1 : 0, userId); this.revokeAll(userId); }
  checkPassword(userId: number, pw: string) { const r = this.db.prepare('SELECT pw_hash FROM admin_users WHERE id=?').get(userId); return !!r && verifyPassword(pw, r.pw_hash); }
  update(userId: number, p: { name?: string; role?: Role; disabled?: boolean }) {
    if (p.name !== undefined) this.db.prepare('UPDATE admin_users SET name=? WHERE id=?').run(p.name, userId);
    if (p.role !== undefined) { if (!ROLES.includes(p.role)) throw new Error('bad role'); this.db.prepare('UPDATE admin_users SET role=? WHERE id=?').run(p.role, userId); }
    if (p.disabled !== undefined) { this.db.prepare('UPDATE admin_users SET disabled=? WHERE id=?').run(p.disabled ? 1 : 0, userId); if (p.disabled) this.revokeAll(userId); }
  }
}
