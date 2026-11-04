// The server can host the game itself (node lan.mjs): its page must tell the game to join this server.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, http, type TestServer } from './helpers.ts';

describe('hosting the game', () => {
  let s: TestServer; let game: string;
  beforeAll(async () => {
    game = mkdtempSync(join(tmpdir(), 'hl-game-')); mkdirSync(join(game, 'assets'));
    writeFileSync(join(game, 'index.html'), '<!doctype html><html><head><title>HustleLife</title></head><body></body></html>');
    writeFileSync(join(game, 'assets', 'a.js'), 'console.log(1)');
    s = await boot({ staticDir: game });
  });
  afterAll(async () => { await s.close(); });

  it('marks its own page so the game joins this server', async () => {
    for (const path of ['/', '/index.html', '/some/deep/link']) {
      const r = await http(s, 'GET', path);
      expect(r.status).toBe(200);
      expect(r.text).toContain('<head><script>window.__HL_SAME_ORIGIN__=1</script>');
      expect(Number(r.headers.get('content-length'))).toBe(Buffer.byteLength(r.text));
    }
  });
  it('serves other files untouched and keeps the API working', async () => {
    const js = await http(s, 'GET', '/assets/a.js'); expect(js.text).toBe('console.log(1)');
    const h = await http(s, 'GET', '/api/health'); expect(h.status).toBe(200);
  });
});
