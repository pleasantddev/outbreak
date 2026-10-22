// Talks to the game server's admin API. The server URL is configurable at runtime so the built admin can be hosted as static files.
export const cfg = { serverUrl: '', worldUrl: 'world/' };
const LS = { token: 'hl-admin-token', server: 'hl-admin-server', world: 'hl-admin-world' };
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } }, del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } } };

export async function loadConfig() {
  try { const r = await fetch('config.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (typeof j.serverUrl === 'string') cfg.serverUrl = j.serverUrl; if (typeof j.worldUrl === 'string') cfg.worldUrl = j.worldUrl; } } catch { /* optional file */ }
  const s = ls.get(LS.server); if (s !== null) cfg.serverUrl = s; const w = ls.get(LS.world); if (w) cfg.worldUrl = w;
  const q = new URLSearchParams(location.search); if (q.get('server')) cfg.serverUrl = q.get('server')!; if (q.get('world')) cfg.worldUrl = q.get('world')!;
  cfg.serverUrl = cfg.serverUrl.replace(/\/+$/, ''); if (cfg.worldUrl && !cfg.worldUrl.endsWith('/')) cfg.worldUrl += '/';
}
export function saveConfig(serverUrl: string, worldUrl: string) { cfg.serverUrl = serverUrl.replace(/\/+$/, ''); cfg.worldUrl = worldUrl ? (worldUrl.endsWith('/') ? worldUrl : worldUrl + '/') : 'world/'; ls.set(LS.server, cfg.serverUrl); ls.set(LS.world, cfg.worldUrl); }
export const token = { get: () => ls.get(LS.token) ?? '', set: (t: string) => ls.set(LS.token, t), clear: () => ls.del(LS.token) };

export class ApiError extends Error { constructor(public status: number, msg: string, public body?: any) { super(msg); } }
const listeners = new Set<(s: number) => void>(); export const onAuthLost = (f: (s: number) => void) => { listeners.add(f); return () => listeners.delete(f); };

export async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try { res = await fetch(cfg.serverUrl + '/api/admin' + path, { method, headers: { 'content-type': 'application/json', ...(token.get() ? { authorization: 'Bearer ' + token.get() } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError(0, `Cannot reach the server at ${cfg.serverUrl || location.origin}. Check the server URL.`); }
  let j: any = null; try { j = await res.json(); } catch { /* empty body */ }
  if (!res.ok) { if (res.status === 401 && token.get()) { token.clear(); listeners.forEach((f) => f(401)); } throw new ApiError(res.status, j?.error ?? `Request failed (${res.status})`, j); }
  return j as T;
}
export const api = {
  get: <T = any>(p: string) => request<T>('GET', p), post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}), patch: <T = any>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}), del: <T = any>(p: string) => request<T>('DELETE', p),
};
export const qs = (o: Record<string, unknown>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? '?' + s : ''; };
