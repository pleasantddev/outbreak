// Game content: GET is public (the game loads missions, prices and so on from here when a server is set), PUT needs an admin.
// Files live in server/data/content, seeded from v2/public/content. Every write keeps a backup (history) and tells live players.
import type { Api } from '../src/api.ts';
import { reply } from '../src/api.ts';
import { HttpError } from '../src/auth.ts';

export function register(api: Api) {
  const { content } = api;

  api.get('/api/content', () => ({ kinds: content.summary() }));

  api.get('/api/content/:kind', (req) => {
    const kind = req.params.kind;
    if (!content.isKind(kind)) throw new HttpError(404, `Unknown content kind "${kind}".`);
    const etag = content.etag(kind);
    if ((req.headers['if-none-match'] ?? '').replace(/"/g, '') === etag) return reply(304, undefined, { ETag: `"${etag}"` });
    return reply(200, content.rawText(kind), { ETag: `"${etag}"`, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  });

  api.put('/api/content/:kind', (req) => {
    const kind = req.params.kind;
    const doc = content.write(kind, req.body, { ifMatch: String(req.headers['if-match'] ?? '') || undefined, by: req.account!.id });
    const etag = content.etag(kind);
    api.events.emit('content', { kind, etag, by: req.account!.id });
    return reply(200, { ok: true, kind, etag, items: doc.items.length }, { ETag: `"${etag}"` });
  }, { auth: 'admin', bodyLimit: 8 * 1024 * 1024, rate: { limit: 60, windowMs: 60_000 } });

  // rolling backups (last 30 writes per file)
  api.get('/api/content/:kind/history', (req) => {
    if (!content.isKind(req.params.kind)) throw new HttpError(404, 'Unknown content kind.');
    return { items: content.history(req.params.kind) };
  }, { auth: 'admin' });
  api.post('/api/content/:kind/restore', (req) => {
    const doc = content.restore(req.params.kind, String(req.body.rev ?? ''), req.account!.id);
    return { ok: true, etag: content.etag(req.params.kind), items: doc.items.length };
  }, { auth: 'admin' });
  // throw away edits and go back to what ships in the repo
  api.post('/api/content/:kind/reset', (req) => {
    if (!content.isKind(req.params.kind)) throw new HttpError(404, 'Unknown content kind.');
    const doc = content.resetToSeed(req.params.kind, req.account!.id);
    return { ok: true, etag: content.etag(req.params.kind), items: doc.items.length };
  }, { auth: 'admin' });
}
