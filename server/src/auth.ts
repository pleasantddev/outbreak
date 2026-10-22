// Passwords (scrypt), signed tokens (HS256 JWT), identifier normalisation and a small rate limiter. Node built-ins only.
import { createHmac, randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

// ------------------------------------------------------------------------------------------ passwords
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
function scryptAsync(pw: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((res, rej) => scrypt(pw, salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 }, (e, k) => (e ? rej(e) : res(k))));
}
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const k = await scryptAsync(pw, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${k.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) { await scryptAsync(pw, Buffer.alloc(16), SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen); return false; } // equalise timing
  const [alg, N, r, p, s, h] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(h, 'base64');
  const got = await scryptAsync(pw, Buffer.from(s, 'base64'), +N, +r, +p, want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}
export function checkPasswordStrength(pw: unknown, identifier = ''): string | null {
  if (typeof pw !== 'string') return 'Password is required.';
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 128) return 'Password is too long.';
  if (identifier && pw.toLowerCase() === identifier.toLowerCase()) return 'Password cannot be your email or phone.';
  if (/^(.)\1+$/.test(pw) || /^(12345678|password|11111111|qwertyui)/i.test(pw)) return 'That password is too easy to guess.';
  return null;
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------------------------------ tokens
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export interface TokenClaims { sub: string; sid: string; iat: number; exp: number }
export function signToken(secret: string, c: Omit<TokenClaims, 'iat' | 'exp'>, days: number, now = Date.now()): string {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...c, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + Math.round(days * 86400) }));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
export function verifyToken(secret: string, token: string, now = Date.now()): TokenClaims | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.'); if (parts.length !== 3) return null;
  const want = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let got: Buffer; try { got = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (head.alg !== 'HS256') return null;
    const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as TokenClaims;
    if (!c.sub || !c.sid || typeof c.exp !== 'number' || c.exp * 1000 < now) return null;
    return c;
  } catch { return null; }
}

// ------------------------------------------------------------------------------------------ identifiers
export type Ident = { kind: 'email' | 'phone'; value: string };
const EMAIL = /^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)*\.[a-z]{2,}$/;
/** email (lower case) or phone in E.164. Nigerian local numbers (0803...) become +234803... */
export function parseIdentifier(raw: unknown): Ident | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length < 5 || s.length > 120) return null;
  if (s.includes('@')) { const e = s.toLowerCase(); return EMAIL.test(e) ? { kind: 'email', value: e } : null; }
  let d = s.replace(/[\s\-().]/g, '');
  if (/^00\d{8,15}$/.test(d)) d = '+' + d.slice(2);
  if (/^0\d{10}$/.test(d)) d = '+234' + d.slice(1);
  else if (/^234\d{10}$/.test(d)) d = '+' + d;
  else if (/^\d{10}$/.test(d) && /^[789]/.test(d)) d = '+234' + d;
  return /^\+\d{8,15}$/.test(d) ? { kind: 'phone', value: d } : null;
}

// ------------------------------------------------------------------------------------------ rate limit
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}
  /** true when the call is allowed */
  take(key: string, now = Date.now()): boolean {
    const a = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (a.length >= this.limit) { this.hits.set(key, a); return false; }
    a.push(now); this.hits.set(key, a);
    if (this.hits.size > 20000) this.sweep(now);
    return true;
  }
  private sweep(now: number) { for (const [k, a] of this.hits) if (!a.some((t) => now - t < this.windowMs)) this.hits.delete(k); }
  reset(key: string) { this.hits.delete(key); }
}

export const randomId = () => randomBytes(16).toString('hex');
export const randomKey = () => randomBytes(24).toString('base64url');
