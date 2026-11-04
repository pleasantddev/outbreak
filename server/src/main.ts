// HustleLife server entry: config, database, services, route plug-ins, HTTP + WebSocket.
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { loadConfig, SERVER_DIR, type Config } from './config.ts';
import { log } from './log.ts';
import { openDb, type DB } from './db.ts';
import { Accounts } from './accounts.ts';
import { Economy } from './economy.ts';
import { ContentStore } from './content.ts';
import { RateLimiter } from './auth.ts';
import { Router, type Api } from './api.ts';
import { createHttp, loadRoutes } from './http.ts';
import { Hub } from './realtime/hub.ts';
import { Payments } from './payments.ts';
import { Ads } from './ads.ts';
import { Clubs } from './clubs.ts';

export interface Running { api: Api; http: Server; hub: Hub; cfg: Config; db: DB; port: number; routes: string[]; close(): Promise<void> }

/** route plug-ins handed in directly (the single-file play build); otherwise every server/routes/*.ts is loaded from disk */
export type RouteModules = Record<string, { register: (api: Api) => unknown }>;

export async function startServer(over: Partial<Config> = {}, modules?: RouteModules): Promise<Running> {
  const cfg = loadConfig(over);
  const db = openDb(cfg.dbFile);
  const content = new ContentStore(cfg, log);
  const accounts = new Accounts(db, cfg);
  const economy = new Economy(db, cfg, content, log);
  const hub = new Hub(cfg, db, accounts, economy, content, log);
  const router = new Router();
  const events = new EventEmitter();
  const payments = new Payments(db, cfg, economy, content, log);
  payments.on('purchase', (p: { accountId: string; label: string }) => { events.emit('purchase', p); hub.toast(p.accountId, 'Payment received', `${p.label} is yours. Thank you!`); });
  payments.on('flag', (f: unknown) => economy.emit('flag', f));
  const ads = new Ads(db, payments, cfg.dataDir); hub.ads = ads;
  const clubs = new Clubs(db, economy, payments, cfg.dataDir); hub.clubs = clubs;
  for (const [from, to] of [[accounts, ['signup', 'login', 'ban', 'unban', 'profile', 'mute']], [economy, ['wallet', 'plot', 'flag']]] as const) for (const ev of to) from.on(ev, (...a: unknown[]) => events.emit(ev, ...a));
  const add = (m: string) => (path: string, h: Parameters<Router['add']>[2], o?: Parameters<Router['add']>[3]) => router.add(m, path, h, o);
  const api: Api = {
    cfg, db, log, accounts, economy, content, online: hub, events, payments, ads, clubs,
    limiters: { loginById: new RateLimiter(8 * cfg.rateScale, 10 * 60_000), guestCreate: new RateLimiter(8 * cfg.rateScale, 60 * 60_000) },
    route: (m, p, h, o) => router.add(m, p, h, o), get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), del: add('DELETE'),
  };
  if (cfg.adminEmail && cfg.adminPassword) { await accounts.ensureAdmin(cfg.adminEmail, cfg.adminPassword); log.info(`admin account ready: ${cfg.adminEmail}`); }
  let routes: string[];
  if (modules) { routes = []; for (const [name, m] of Object.entries(modules)) { await m.register(api); routes.push(name); } }
  else routes = await loadRoutes(api, resolve(SERVER_DIR, 'routes'));
  log.info(`routes loaded: ${routes.join(', ')}`);
  const http = createHttp(api, router);
  hub.attach(http);
  await new Promise<void>((res, rej) => { http.once('error', rej); http.listen(cfg.port, cfg.host, () => res()); });
  const addr = http.address(); const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
  hub.start();
  const purge = setInterval(() => { try { accounts.purgeSessions(); } catch { /* ignore */ } }, 6 * 3600_000); purge.unref();
  log.info(`HustleLife server listening on ${cfg.host}:${port} (tick ${cfg.tickHz} Hz, db ${cfg.dbFile})`);
  return {
    api, http, hub, cfg, db, port, routes,
    async close() { clearInterval(purge); await hub.stop(); await new Promise<void>((r) => { http.close(() => r()); http.closeAllConnections?.(); }); db.close(); },
  };
}

const isMain = process.argv[1] && /(^|[\\/])main\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  startServer().then((s) => {
    const stop = async () => { log.info('shutting down'); await s.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }).catch((e) => { log.error('failed to start', e); process.exit(1); });
}
