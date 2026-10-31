// node:http glue: CORS, JSON bodies, bearer auth, bans, rate limits, errors, static files, and the route plug-in loader.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Api, ApiRequest, AuthLevel, Router } from './api.ts';
import { HANDLED, Reply } from './api.ts';
import { HttpError, RateLimiter } from './auth.ts';
import { banState } from './accounts.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.wasm': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};
const LEVEL: Record<AuthLevel, number> = { none: 0, user: 1, mod: 2, admin: 3 };
const roleLevel = (r: string) => (r === 'admin' ? 3 : r === 'mod' ? 2 : 1);

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) { const xf = req.headers['x-forwarded-for']; if (typeof xf === 'string' && xf) return xf.split(',')[0].trim(); }
  return req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '0.0.0.0';
}

function cors(api: Api, req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin; const allow = api.cfg.allowOrigins;
  if (allow === '*') res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && allow.split(',').map((s) => s.trim()).includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,If-Match,If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag');
  res.setHeader('Access-Control-Max-Age', '600');
}

async function readBody(req: IncomingMessage, limit: number): Promise<any> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
    // DELETE may carry a body, but most clients do not send one
    if (!req.headers['content-length'] || req.headers['content-length'] === '0') return {};
  }
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > limit) throw new HttpError(413, 'Request body is too large.'); chunks.push(c as Buffer); }
  if (!n) return {};
  const text = Buffer.concat(chunks).toString('utf8'); (req as any).rawBody = text; // webhooks sign the raw bytes
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Body must be valid JSON.'); }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (res.headersSent) return;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (body === undefined) { res.statusCode = status === 200 ? 204 : status; res.end(); return; }
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status; res.end(data);
}

export function createHttp(api: Api, router: Router): Server {
  return createServer(async (req, res) => {
    const ip = clientIp(req, api.cfg.trustProxy);
    try {
      cors(api, req, res);
      if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
      const url = new URL(req.url ?? '/', 'http://x');
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      const m = router.match(req.method ?? 'GET', pathname);
      if (m && 'route' in m) {
        const { route, params } = m;
        const lim = route.opts.rate ?? { limit: 240, windowMs: 60_000 };
        if (!limiterFor(api, `${route.method} ${route.path}`, lim.limit * api.cfg.rateScale, lim.windowMs).take(ip)) throw new HttpError(429, 'Too many requests. Slow down.');
        const query: Record<string, string> = {}; for (const [k, v] of url.searchParams) query[k] = v;
        const r: ApiRequest = { method: req.method!, path: pathname, params, query, body: {}, headers: req.headers, ip, account: null, sid: null, raw: req, res };
        const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? query.token;
        if (bearer) {
          const a = api.accounts.authenticate(bearer);
          if (a) { r.account = a.account; r.sid = a.sid; }
        }
        const need = LEVEL[route.opts.auth];
        if (need > 0) {
          if (!r.account) throw new HttpError(401, 'Sign in first.', { code: 'auth' });
          const b = banState(r.account); if (b.banned) throw new HttpError(403, b.reason, { code: 'banned', until: b.until });
          if (roleLevel(r.account.role) < need) throw new HttpError(403, 'Not allowed.', { code: 'forbidden' });
        }
        r.body = await readBody(req, route.opts.bodyLimit ?? 256 * 1024);
        const out = await route.handler(r);
        if (out === HANDLED || res.writableEnded) return;
        if (out instanceof Reply) send(res, out.status, out.body, out.headers); else send(res, out === undefined ? 204 : 200, out);
        return;
      }
      if (m && 'allowed' in m) { res.setHeader('Allow', [...new Set(m.allowed)].join(', ')); throw new HttpError(405, 'Method not allowed.'); }
      if (pathname.startsWith('/api/') || pathname === '/api') throw new HttpError(404, 'No such endpoint.');
      if (req.method === 'GET' || req.method === 'HEAD') { if (serveStatic(api, pathname, req, res)) return; }
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, { error: e.message, ...e.extra });
      else { api.log.error('request failed', req.method, req.url, e); send(res, 500, { error: 'Server error.' }); }
    }
  });
}

function limiterFor(api: Api, key: string, limit: number, windowMs: number) {
  return (api.limiters[key] ??= new RateLimiter(limit, windowMs));
}

// ------------------------------------------------------------------------------------------ static files (optional)
function serveStatic(api: Api, pathname: string, req: IncomingMessage, res: ServerResponse): boolean {
  const cfg = api.cfg;
  let root = cfg.staticDir; let rel = pathname;
  if (cfg.adminDir && (pathname === '/admin' || pathname.startsWith('/admin/'))) { root = cfg.adminDir; rel = pathname.slice('/admin'.length) || '/'; }
  if (!root) return false;
  root = resolve(root);
  let file = normalize(join(root, decodeURIComponent(rel)));
  if (file !== root && !file.startsWith(root + sep)) return false;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { if (!extname(rel)) file = join(root, 'index.html'); if (!existsSync(file)) return false; }
  const st = statSync(file); const ext = extname(file).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', st.size);
  res.setHeader('Cache-Control', /\.(html)$/.test(ext) ? 'no-cache' : 'public, max-age=3600');
  res.statusCode = 200;
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(file).pipe(res); return true;
}

// ------------------------------------------------------------------------------------------ plug-in loader
/** Imports every server/routes/*.ts (or *.js when compiled) and calls its `register(api)`. Returns the module names loaded. */
export async function loadRoutes(api: Api, dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const loaded: string[] = [];
  // run from sources (tsx) -> load .ts; run from a build -> load .js. Never both, or routes register twice.
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const files = readdirSync(dir).filter((f) => f.endsWith(ext) && !f.endsWith('.d.ts') && !/\.(test|spec)\./.test(f)).sort();
  for (const f of files) {
    const base = f.slice(0, -ext.length);
    try {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      if (typeof mod.register !== 'function') { api.log.warn(`routes/${f} has no register(api); skipped`); continue; }
      await mod.register(api); loaded.push(base);
    } catch (e) { api.log.error(`routes/${f} failed to load:`, e); throw e; }
  }
  return loaded.sort();
}
