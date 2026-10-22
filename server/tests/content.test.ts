import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { boot, http, makePlayer, TestClient, type TestServer } from './helpers.ts';

let s: TestServer; let adminTok = '';
beforeAll(async () => {
  s = await boot({ adminEmail: 'boss@hustlelife.test', adminPassword: 'correct horse battery' }, { missions: { version: 1, items: [{ id: 'm1', title: 'First' }] } });
  adminTok = (await http(s, 'POST', '/api/auth/login', { identifier: 'boss@hustlelife.test', password: 'correct horse battery' })).json.token;
});
afterAll(async () => { await s.close(); });

describe('content endpoints', () => {
  it('seeds from the shipped files and serves them publicly with an ETag', async () => {
    const r = await http(s, 'GET', '/api/content/missions'); expect(r.status).toBe(200);
    expect(r.json.items[0].id).toBe('m1'); const etag = r.headers.get('etag')!; expect(etag).toBeTruthy();
    const again = await http(s, 'GET', '/api/content/missions', undefined, undefined, { 'if-none-match': etag }); expect(again.status).toBe(304);
    expect((await http(s, 'GET', '/api/content/events')).json).toEqual({ version: 1, items: [] }); // not shipped yet: empty document
    expect((await http(s, 'GET', '/api/content/bogus')).status).toBe(404);
    const idx = await http(s, 'GET', '/api/content'); expect(idx.json.kinds.map((k: any) => k.kind)).toEqual(expect.arrayContaining(['missions', 'events', 'skills', 'routes', 'npcs', 'economy', 'iap', 'shops']));
  });
  it('writes need an admin', async () => {
    const p = await makePlayer(s, 'Not Admin');
    const doc = { version: 1, items: [{ id: 'm1' }] };
    expect((await http(s, 'PUT', '/api/content/missions', doc)).status).toBe(401);
    expect((await http(s, 'PUT', '/api/content/missions', doc, p.token)).status).toBe(403);
    expect((await http(s, 'PUT', '/api/content/missions', doc, adminTok)).status).toBe(200);
  });
  it('validates the document shape', async () => {
    const put = (b: unknown) => http(s, 'PUT', '/api/content/skills', b, adminTok);
    expect((await put({ version: 1 })).status).toBe(400);
    expect((await put({ version: 'x', items: [] })).status).toBe(400);
    expect((await put({ version: 1, items: [{ title: 'no id' }] })).status).toBe(400);
    expect((await put({ version: 1, items: [{ id: 'a' }, { id: 'a' }] })).status).toBe(400);
    expect((await put([1, 2])).status).toBe(400);
    expect((await put({ version: 1, items: [{ id: 'a', x: 1 }, { id: 'b' }] })).status).toBe(200);
    expect((await http(s, 'GET', '/api/content/skills')).json.items.length).toBe(2);
  });
  it('keeps history, supports restore and optimistic locking', async () => {
    const g1 = await http(s, 'GET', '/api/content/routes'); expect(g1.json.items).toEqual([]);
    const w1 = await http(s, 'PUT', '/api/content/routes', { version: 1, items: [{ id: 'r1' }] }, adminTok);
    await new Promise((r) => setTimeout(r, 5));
    const w2 = await http(s, 'PUT', '/api/content/routes', { version: 2, items: [{ id: 'r1' }, { id: 'r2' }] }, adminTok, { 'if-match': w1.headers.get('etag')! });
    expect(w2.status).toBe(200);
    const stale = await http(s, 'PUT', '/api/content/routes', { version: 3, items: [] }, adminTok, { 'if-match': w1.headers.get('etag')! }); expect(stale.status).toBe(412);
    const hist = await http(s, 'GET', '/api/content/routes/history', undefined, adminTok); expect(hist.json.items.length).toBeGreaterThanOrEqual(1);
    const rest = await http(s, 'POST', '/api/content/routes/restore', { rev: hist.json.items.at(-1).rev }, adminTok); expect(rest.status).toBe(200);
    expect((await http(s, 'GET', '/api/content/routes')).json.items.length).toBe(1);
    expect(existsSync(join(s.dir, 'content', 'routes.json'))).toBe(true);
    expect(readdirSync(join(s.dir, 'content')).filter((f) => f.endsWith('.tmp'))).toEqual([]); // atomic writes leave nothing behind
  });
  it('tells live players when content changes', async () => {
    const p = await makePlayer(s, 'Listener'); const c = await new TestClient(s, p.token).connect();
    await http(s, 'PUT', '/api/content/npcs', { version: 1, items: [{ id: 'n1' }] }, adminTok);
    await c.until(() => c.of('content').some((m) => m.kind === 'npcs')); c.close();
  });
  it('keeps content files readable as JSON', () => { for (const f of readdirSync(join(s.dir, 'content')).filter((x) => x.endsWith('.json'))) JSON.parse(readFileSync(join(s.dir, 'content', f), 'utf8')); });
});
