import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, http, makePlayer, type TestServer } from './helpers.ts';
import { parseIdentifier, signToken, verifyToken, hashPassword, verifyPassword, checkPasswordStrength } from '../src/auth.ts';
import { validateName } from '../../v2/src/net/rules.ts';

let s: TestServer;
beforeAll(async () => { s = await boot({ adminEmail: 'boss@hustlelife.test', adminPassword: 'correct horse battery' }); });
afterAll(async () => { await s.close(); });

describe('identifiers and passwords', () => {
  it('normalises Nigerian numbers and emails', () => {
    expect(parseIdentifier('08031234567')).toEqual({ kind: 'phone', value: '+2348031234567' });
    expect(parseIdentifier('0803 123 4567')).toEqual({ kind: 'phone', value: '+2348031234567' });
    expect(parseIdentifier('2348031234567')).toEqual({ kind: 'phone', value: '+2348031234567' });
    expect(parseIdentifier('+2348031234567')).toEqual({ kind: 'phone', value: '+2348031234567' });
    expect(parseIdentifier(' Pleasant@Gmail.COM ')).toEqual({ kind: 'email', value: 'pleasant@gmail.com' });
    expect(parseIdentifier('nope')).toBeNull(); expect(parseIdentifier('a@b')).toBeNull(); expect(parseIdentifier(42)).toBeNull();
  });
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('s3cret-pass'); expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('s3cret-pass', h)).toBe(true); expect(await verifyPassword('wrong', h)).toBe(false); expect(await verifyPassword('x', null)).toBe(false);
  });
  it('password policy', () => {
    expect(checkPasswordStrength('short')).toMatch(/8/); expect(checkPasswordStrength('aaaaaaaaaa')).toBeTruthy(); expect(checkPasswordStrength('a-good-one-2026')).toBeNull();
  });
  it('tokens: signature, expiry, tampering', () => {
    const t = signToken('k'.repeat(32), { sub: 'a', sid: 'b' }, 1);
    expect(verifyToken('k'.repeat(32), t)?.sub).toBe('a');
    expect(verifyToken('x'.repeat(32), t)).toBeNull();
    expect(verifyToken('k'.repeat(32), t + 'x')).toBeNull();
    expect(verifyToken('k'.repeat(32), t, Date.now() + 2 * 86400_000)).toBeNull();
    const [h, , sig] = t.split('.'); const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'admin', sid: 'b', exp: 9999999999 })).toString('base64url')}.${sig}`;
    expect(verifyToken('k'.repeat(32), forged)).toBeNull();
  });
});

describe('accounts over HTTP', () => {
  it('signs up, logs in, rejects wrong passwords and duplicates', async () => {
    const a = await http(s, 'POST', '/api/auth/signup', { identifier: 'amaka@example.com', password: 'longenough1' });
    expect(a.status).toBe(200); expect(a.json.token).toBeTruthy(); expect(a.json.hasProfile).toBe(false); expect(a.json.account.pw_hash).toBeUndefined();
    expect((await http(s, 'POST', '/api/auth/signup', { identifier: 'AMAKA@example.com', password: 'longenough1' })).status).toBe(409);
    expect((await http(s, 'POST', '/api/auth/login', { identifier: 'amaka@example.com', password: 'nope-nope-1' })).status).toBe(401);
    const l = await http(s, 'POST', '/api/auth/login', { identifier: 'amaka@example.com', password: 'longenough1' });
    expect(l.status).toBe(200);
    const me = await http(s, 'GET', '/api/auth/me', undefined, l.json.token); expect(me.json.account.email).toBe('amaka@example.com');
    expect((await http(s, 'GET', '/api/auth/me')).status).toBe(401);
    expect((await http(s, 'POST', '/api/auth/signup', { identifier: 'bad', password: 'longenough1' })).status).toBe(400);
  });
  it('phone sign up works', async () => {
    const r = await http(s, 'POST', '/api/auth/signup', { identifier: '08051112222', password: 'longenough1' });
    expect(r.status).toBe(200); expect(r.json.account.phone).toBe('+2348051112222');
    expect((await http(s, 'POST', '/api/auth/login', { identifier: '+234 805 111 2222', password: 'longenough1' })).status).toBe(200);
  });
  it('logout revokes the session', async () => {
    const r = await http(s, 'POST', '/api/auth/signup', { identifier: 'tunde@example.com', password: 'longenough1' });
    await http(s, 'POST', '/api/auth/logout', {}, r.json.token);
    expect((await http(s, 'GET', '/api/auth/me', undefined, r.json.token)).status).toBe(401);
  });
  it('guest accounts persist by key and can be upgraded keeping the profile', async () => {
    const g = await http(s, 'POST', '/api/auth/guest', {}); expect(g.json.account.guest).toBe(true); expect(g.json.guestKey).toBeTruthy();
    await http(s, 'POST', '/api/profile', { name: 'Guest Gbenga', model: 'rogue', skin: 2, outfit: 'street' }, g.json.token);
    const g2 = await http(s, 'POST', '/api/auth/guest', { guestKey: g.json.guestKey });
    expect(g2.json.account.id).toBe(g.json.account.id); expect(g2.json.hasProfile).toBe(true);
    const up = await http(s, 'POST', '/api/auth/upgrade', { identifier: 'gbenga@example.com', password: 'longenough1' }, g2.json.token);
    expect(up.status).toBe(200); expect(up.json.account.guest).toBe(false);
    const l = await http(s, 'POST', '/api/auth/login', { identifier: 'gbenga@example.com', password: 'longenough1' });
    expect(l.json.account.id).toBe(g.json.account.id); expect(l.json.hasProfile).toBe(true);
    // the old guest key no longer works as a guest login
    const g3 = await http(s, 'POST', '/api/auth/guest', { guestKey: g.json.guestKey }); expect(g3.json.account.id).not.toBe(g.json.account.id);
  });
});

describe('one profile per account', () => {
  it('second create is refused with 409, update works, names are unique and validated', async () => {
    const p1 = await makePlayer(s, 'Chidi');
    const again = await http(s, 'POST', '/api/profile', { name: 'Another', model: 'rogue', skin: 1, outfit: 'street' }, p1.token);
    expect(again.status).toBe(409); expect(again.json.code).toBe('profile_exists');
    const got = await http(s, 'GET', '/api/profile', undefined, p1.token); expect(got.json.name).toBe('Chidi'); expect(got.json.accountId).toBe(p1.accountId);
    const up = await http(s, 'PATCH', '/api/profile', { outfit: 'naija', skin: 4 }, p1.token); expect(up.json.outfit).toBe('naija'); expect(up.json.skin).toBe(4);
    const other = await http(s, 'POST', '/api/auth/signup', { identifier: 'second@example.com', password: 'longenough1' });
    const dup = await http(s, 'POST', '/api/profile', { name: 'chidi', model: 'girl', skin: 1, outfit: 'street' }, other.json.token);
    expect(dup.status).toBe(409); expect(dup.json.code).toBe('name_taken');
    expect((await http(s, 'POST', '/api/profile', { name: 'x', model: 'girl', skin: 1, outfit: 'street' }, other.json.token)).status).toBe(400);
    expect((await http(s, 'POST', '/api/profile', { name: 'Fine Name', model: 'dragon', skin: 1, outfit: 'street' }, other.json.token)).status).toBe(400);
    expect((await http(s, 'GET', '/api/profile', undefined, (await http(s, 'POST', '/api/auth/signup', { identifier: 'third@example.com', password: 'longenough1' })).json.token)).status).toBe(404);
  });
  it('xp can only go up and only in sane steps', async () => {
    const p = await makePlayer(s, 'Xp Boy');
    expect((await http(s, 'PATCH', '/api/profile', { xp: 120 }, p.token)).json.xp).toBe(120);
    expect((await http(s, 'PATCH', '/api/profile', { xp: 50 }, p.token)).json.xp).toBe(120);
    expect((await http(s, 'PATCH', '/api/profile', { xp: 99999999 }, p.token)).json.xp).toBe(120);
  });
  it('server name rules match the client rules', () => {
    for (const n of ['ab', 'Good Name', 'a'.repeat(17), 'Admin', 'you', 'f u c k', 'x_y_z', '___', 'Ọlá Ade']) { const r = validateName(n); expect(typeof r.ok).toBe('boolean'); }
    expect(validateName('Admin').ok).toBe(false); expect(validateName('Ọlá Ade').ok).toBe(true);
  });
});

describe('bans', () => {
  it('a banned account cannot log in, loses its sessions, and a timed ban expires', async () => {
    const p = await makePlayer(s, 'Wahala Man');
    const admin = await http(s, 'POST', '/api/auth/login', { identifier: 'boss@hustlelife.test', password: 'correct horse battery' });
    expect(admin.status).toBe(200); expect(admin.json.account.role).toBe('admin');
    expect((await http(s, 'GET', '/api/stats', undefined, p.token)).status).toBe(403);
    expect((await http(s, 'GET', '/api/stats', undefined, admin.json.token)).status).toBe(200);
    s.api.accounts.ban(p.accountId, { reason: 'Cheating', by: admin.json.account.id });
    const l = await http(s, 'POST', '/api/auth/login', { identifier: p.email, password: 'hunter2hunter2' });
    expect(l.status).toBe(403); expect(l.json.code).toBe('banned'); expect(l.json.error).toBe('Cheating');
    expect((await http(s, 'GET', '/api/profile', undefined, p.token)).status).toBe(401); // sessions revoked
    s.api.accounts.unban(p.accountId);
    expect((await http(s, 'POST', '/api/auth/login', { identifier: p.email, password: 'hunter2hunter2' })).status).toBe(200);
    s.api.accounts.ban(p.accountId, { reason: 'Timeout', until: Date.now() - 1000 });
    expect((await http(s, 'POST', '/api/auth/login', { identifier: p.email, password: 'hunter2hunter2' })).status).toBe(200); // already expired
  });
});

describe('route plug-in loader', () => {
  it('loaded the core route modules and answers 404/405 properly', async () => {
    expect(s.routes).toEqual(expect.arrayContaining(['auth', 'content', 'health', 'profile', 'state', 'world']));
    expect((await http(s, 'GET', '/api/nothing')).status).toBe(404);
    const r = await http(s, 'DELETE', '/api/health'); expect(r.status).toBe(405);
  });
  it('a route added through the api object works with auth levels', async () => {
    s.api.get('/api/test/admin-only', () => ({ hi: true }), { auth: 'admin' });
    const p = await makePlayer(s, 'Plain Joe');
    expect((await http(s, 'GET', '/api/test/admin-only')).status).toBe(401);
    expect((await http(s, 'GET', '/api/test/admin-only', undefined, p.token)).status).toBe(403);
    const admin = await http(s, 'POST', '/api/auth/login', { identifier: 'boss@hustlelife.test', password: 'correct horse battery' });
    expect((await http(s, 'GET', '/api/test/admin-only', undefined, admin.json.token)).json.hi).toBe(true);
  });
});
