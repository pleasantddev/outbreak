// The plug-in contract. Every file in server/routes/*.ts exports `register(api: Api)` and adds its routes with api.get/post/...
// The admin workstream builds on this object; keep it backwards compatible.
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import type { Logger } from './log.ts';
import type { Accounts, AccountRow } from './accounts.ts';
import type { Economy } from './economy.ts';
import type { ContentStore } from './content.ts';
import type { RateLimiter } from './auth.ts';
import type { Payments } from './payments.ts';
import type { Ads } from './ads.ts';

export type AuthLevel = 'none' | 'user' | 'mod' | 'admin';

export interface ApiRequest {
  method: string;
  /** the matched path, no query string */
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  /** parsed JSON body ({} when there is none) */
  body: any;
  headers: IncomingMessage['headers'];
  ip: string;
  /** the signed in account for routes with auth 'user' | 'mod' | 'admin'; may also be set on 'none' routes when a valid token was sent */
  account: AccountRow | null;
  sid: string | null;
  raw: IncomingMessage;
  res: ServerResponse;
}

/** Return a value to send it as JSON (200), undefined for 204, a Reply for another status, or HANDLED after writing to req.res yourself. */
export type Handler = (req: ApiRequest) => unknown | Promise<unknown>;
export const HANDLED = Symbol('handled');
export class Reply { constructor(public status: number, public body: unknown = undefined, public headers: Record<string, string> = {}) {} }
export const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) => new Reply(status, body, headers);

export interface RouteOpts {
  auth?: AuthLevel;
  /** per client IP, per window. Default: 240 per minute for everything */
  rate?: { limit: number; windowMs: number };
  /** bytes, default 256 KiB */
  bodyLimit?: number;
}

/** What the realtime hub exposes to routes (admin tools need to see and act on live players). */
export interface OnlineApi {
  count(): number;
  list(): { id: number; accountId: string; name: string; x: number; z: number; role: string; since: number; vehicle: boolean }[];
  isOnline(accountId: string): boolean;
  /** disconnect a player with a message */
  kick(accountId: string, reason: string): boolean;
  /** server message to everyone, to one account, or to players near a point */
  broadcast(text: string, from?: string): void;
  toast(accountId: string, title: string, body: string): boolean;
  /** move a player (admin teleport); the client is told with a "fix" */
  teleport(accountId: string, x: number, z: number): boolean;
  rooms(): { key: string; players: number; vehicles: number }[];
  stats(): Record<string, unknown>;
}

export interface Api {
  cfg: Config;
  db: DB;
  log: Logger;
  accounts: Accounts;
  economy: Economy;
  content: ContentStore;
  online: OnlineApi;
  /** domain events: 'login' | 'signup' | 'ban' | 'unban' | 'wallet' | 'plot' | 'content' | 'flag' | 'purchase' | 'chat' */
  events: EventEmitter;
  limiters: Record<string, RateLimiter>;
  /** real money (Paystack) and MyAds */
  payments: Payments;
  ads: Ads;
  route(method: string, path: string, handler: Handler, opts?: RouteOpts): void;
  get(path: string, handler: Handler, opts?: RouteOpts): void;
  post(path: string, handler: Handler, opts?: RouteOpts): void;
  put(path: string, handler: Handler, opts?: RouteOpts): void;
  patch(path: string, handler: Handler, opts?: RouteOpts): void;
  del(path: string, handler: Handler, opts?: RouteOpts): void;
}

export interface RouteDef { method: string; path: string; segs: string[]; handler: Handler; opts: Required<Pick<RouteOpts, 'auth'>> & RouteOpts }

export class Router {
  routes: RouteDef[] = [];
  add(method: string, path: string, handler: Handler, opts: RouteOpts = {}) {
    if (!path.startsWith('/')) throw new Error(`route path must start with /: ${path}`);
    const dup = this.routes.find((r) => r.method === method.toUpperCase() && r.path === path);
    if (dup) throw new Error(`duplicate route ${method} ${path}`);
    this.routes.push({ method: method.toUpperCase(), path, segs: path.split('/').filter(Boolean), handler, opts: { auth: 'none', ...opts } });
    // static segments before parameters so /api/content/history beats /api/content/:kind
    this.routes.sort((a, b) => score(b) - score(a));
  }
  match(method: string, pathname: string): { route: RouteDef; params: Record<string, string> } | { allowed: string[] } | null {
    const segs = pathname.split('/').filter(Boolean); const allowed: string[] = [];
    for (const r of this.routes) {
      const p = matchSegs(r.segs, segs); if (!p) continue;
      if (r.method === method) return { route: r, params: p };
      allowed.push(r.method);
    }
    return allowed.length ? { allowed } : null;
  }
}
const score = (r: RouteDef) => r.segs.reduce((s, x) => s + (x.startsWith(':') ? 1 : x === '*' ? 0 : 3), 0) * 10 + r.segs.length;
function matchSegs(pat: string[], segs: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pat.length; i++) {
    const p = pat[i];
    if (p === '*') { params['*'] = segs.slice(i).map(safeDecode).join('/'); return params; }
    if (i >= segs.length) return null;
    if (p.startsWith(':')) params[p.slice(1)] = safeDecode(segs[i]);
    else if (p !== segs[i]) return null;
  }
  return pat.length === segs.length ? params : null;
}
function safeDecode(s: string) { try { return decodeURIComponent(s); } catch { return s; } }
