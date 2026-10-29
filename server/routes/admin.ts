// Admin API plug-in. The game server's loader calls register(api) for every file in server/routes/.
//
// What this file expects from `api` (adjust the three small adapters below if the loader differs):
//   api.db        better-sqlite3 handle (prepare().run/get/all, exec)
//   api.dataDir   folder for server data; content lives in <dataDir>/content/<kind>.json
//   api.route(method, path, handler)   handler(req) => { status, body } | body, req = { method, path, params, query, body, headers, ip }
//                 (api.get/post/put/patch/delete(path, handler) is accepted too, with an express-style (req, res) handler)
//   api.live      optional realtime hooks: online(), kick(id, reason), broadcast(msg), patchOnline(id, patch), onSanction(), onRefund()
//   api.log       optional logger
// Tables read from the game side are listed in server/admin/db.ts (NET_DDL); only server/admin/store.ts touches them.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAdmin, type HostReq, type HostRes } from '../admin/handlers.ts';

const here = dirname(fileURLToPath(import.meta.url));

export function register(api: any) {
  const dataDir: string = api.dataDir ?? api.config?.dataDir ?? resolve(here, '../data');
  const seeds = [resolve(here, '../../v2/public/content'), resolve(here, '../../admin/seed/content')].filter((d) => existsSync(d));
  const admin = buildAdmin({ db: api.db, dataDir, contentSeedDirs: seeds, live: () => api.live ?? null, log: (m) => (api.log ? api.log(m) : console.log(m)), version: api.version });
  for (const r of admin.routes) mount(api, r.method, r.path, r.handler);
  // The game reads the same content files. The net workstream's GET /api/content/:kind wins if it also registers one.
  mount(api, 'GET', '/api/admin-public/content/:kind', (req) => { try { return { status: 200, body: admin.content.read(req.params.kind).doc }; } catch { return { status: 404, body: { error: 'unknown content' } }; } });
  mount(api, 'GET', '/api/public/ops', () => ({ status: 200, body: admin.publicOps() }));
  const t = setInterval(admin.tick, 60_000); (t as any).unref?.(); admin.tick();
  return admin;
}

function mount(api: any, method: string, path: string, handler: (req: HostReq) => Promise<HostRes> | HostRes) {
  if (typeof api.route === 'function') { api.route(method, path, handler); return; }
  const fn = api[method.toLowerCase()];
  if (typeof fn !== 'function') throw new Error('admin routes: the server api exposes neither route() nor get/post/put/patch/delete()');
  fn.call(api, path, async (rq: any, rs: any) => {
    const req: HostReq = { method, path: rq.path ?? rq.url, params: rq.params ?? {}, query: rq.query ?? {}, body: rq.body, headers: rq.headers ?? {}, ip: rq.ip ?? rq.socket?.remoteAddress ?? '' };
    const out = await handler(req); rs.status(out.status ?? 200).json(out.body);
  });
}
void join;
