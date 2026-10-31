// Framework-agnostic admin API. `buildAdmin(deps)` returns route definitions; server/routes/admin.ts mounts them on the
// game server (register(api)) and admin/dev-server.ts mounts them on a stub server. Everything is under /api/admin.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Auth, checkPasswordStrength } from './auth';
import { ContentStore, KIND_RE } from './content';
import { kvGet, kvSet, migrateAdmin, type SqlDb } from './db';
import { AdminStore, type LiveHooks } from './store';
import { can, ROLE_PERMS, ROLES, type AdminUser, type Announcement, type AuditRow, type Flag, type Maintenance, type Perm, type PlotRec, type Role, type SanctionKind } from './types';
import { hasErrors, validateContent } from './validate';

export interface HostReq { method: string; path: string; params: Record<string, string>; query: Record<string, string>; body: any; headers: Record<string, string>; ip: string }
export interface HostRes { status?: number; body?: any }
/** game world controls the server hands the admin: the power grid and the businesses (see server/src/grid.ts, business.ts) */
export interface WorldHooks {
  grid: { board(): any; force(f: number | 'all', on: boolean | null, hours?: number): any; collapse(hours: number): any; genScale: number; tick(): any };
  /** MyAds moderation and the real-money ledger (server/src/ads.ts, payments.ts) */
  ads?: { queue(status?: string): any[]; review(id: number, decision: 'approve' | 'reject', note?: string): Promise<any>; upload(id: string): any; uploadFile(u: any): string | null; boards: any[] } | null;
}
export interface AdminDeps { db: SqlDb; dataDir: string; contentSeedDirs: string[]; live?: () => LiveHooks | null; world?: () => WorldHooks | null; version?: string; log?: (m: string) => void; setupCode?: string }
export interface RouteDef { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; auth: boolean; handler: (req: HostReq) => Promise<HostRes> | HostRes }

class HttpError extends Error { constructor(public status: number, msg: string, public extra?: any) { super(msg); } }
const bad = (msg: string, extra?: any) => new HttpError(400, msg, extra);
const str = (v: any, name: string, min = 1, max = 400) => { if (typeof v !== 'string' || v.trim().length < min) throw bad(`${name} is required`); if (v.length > max) throw bad(`${name} is too long`); return v.trim(); };
const num = (v: any, name: string) => { const n = Number(v); if (!Number.isFinite(n)) throw bad(`${name} must be a number`); return n; };

function diffItems(a: any[], b: any[]) {
  const ma = new Map(a.map((x) => [x.id, JSON.stringify(x)])); const mb = new Map(b.map((x) => [x.id, JSON.stringify(x)]));
  let add = 0, del = 0, chg = 0; for (const [k, v] of mb) { if (!ma.has(k)) add++; else if (ma.get(k) !== v) chg++; } for (const k of ma.keys()) if (!mb.has(k)) del++;
  return { add, del, chg };
}

export function buildAdmin(deps: AdminDeps) {
  const { db } = deps; migrateAdmin(db);
  const live = () => deps.live?.() ?? null;
  const auth = new Auth(db); const store = new AdminStore(db, live);
  const content = new ContentStore(db, deps.dataDir + '/content', deps.contentSeedDirs);
  const startedAt = Date.now();
  let setupCode = deps.setupCode ?? (process.env.ADMIN_SETUP_CODE || '');
  if (auth.count() === 0) {
    const e = process.env.ADMIN_SEED_EMAIL, p = process.env.ADMIN_SEED_PASSWORD;
    if (e && p) { const w = checkPasswordStrength(p); if (w) deps.log?.(`[admin] ADMIN_SEED_PASSWORD rejected: ${w}`); else { auth.createUser(e, process.env.ADMIN_SEED_NAME || 'Owner', 'owner', p); deps.log?.(`[admin] seeded owner ${e} from environment`); } }
    else { if (!setupCode) setupCode = randomBytes(5).toString('hex'); deps.log?.(`[admin] No admin accounts yet. Open the admin app and create the owner with setup code: ${setupCode}`); }
  }

  const routes: RouteDef[] = [];
  type Ctx = { req: HostReq; user: AdminUser };
  const audit = (c: Ctx | { req: HostReq; user: null }, action: string, type: string, id: string, summary: string, before?: unknown, after?: unknown) => {
    const u = c.user; db.prepare('INSERT INTO admin_audit(ts,actor_id,actor_email,actor_role,action,target_type,target_id,summary,before_json,after_json,ip) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(Date.now(), u?.id ?? null, u?.email ?? 'anonymous', u?.role ?? '-', action, type, id, summary.slice(0, 500), before === undefined ? null : JSON.stringify(before).slice(0, 60000), after === undefined ? null : JSON.stringify(after).slice(0, 60000), c.req.ip);
  };
  const who = (u: AdminUser) => `${u.name} <${u.email}>`;

  function route(method: RouteDef['method'], path: string, perm: Perm | null | 'public', h: (c: Ctx) => any) {
    routes.push({
      method, path: '/api/admin' + path, auth: perm !== 'public',
      handler: async (req) => {
        try {
          let user: AdminUser | null = null;
          if (perm !== 'public') {
            const tok = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
            user = auth.verify(tok); if (!user) throw new HttpError(401, 'Sign in again');
            if (perm && !can(user.role, perm)) throw new HttpError(403, `Your role (${user.role}) cannot do that`);
          }
          const out = await h({ req, user: user as AdminUser });
          return { status: 200, body: out === undefined ? { ok: true } : out };
        } catch (e: any) {
          if (e instanceof HttpError) return { status: e.status, body: { error: e.message, ...(e.extra ?? {}) } };
          deps.log?.(`[admin] ${method} ${path} failed: ${e?.stack ?? e}`); return { status: 500, body: { error: 'Server error: ' + (e?.message ?? e) } };
        }
      },
    });
  }

  // ---------- public
  route('GET', '/health', 'public', () => ({ ok: true, needsSeed: auth.count() === 0, version: deps.version ?? 'dev', time: Date.now() }));
  route('POST', '/auth/seed', 'public', (c) => {
    if (auth.count() > 0) throw new HttpError(409, 'An admin already exists');
    const b = c.req.body ?? {}; if (!setupCode || b.setupCode !== setupCode) throw new HttpError(403, 'Wrong setup code (it is printed in the server log)');
    const email = str(b.email, 'email'); if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Enter a valid email'); const w = checkPasswordStrength(String(b.password ?? '')); if (w) throw bad(w);
    const u = auth.createUser(email, str(b.name, 'name'), 'owner', b.password); audit({ req: c.req, user: u }, 'auth.seed', 'admin', String(u.id), `First owner ${who(u)} created`);
    const r = auth.login(email, b.password, c.req.ip, c.req.headers['user-agent'] ?? ''); if ('error' in r) throw bad(r.error);
    return { token: r.token, user: r.user, perms: ROLE_PERMS[r.user.role] };
  });
  route('POST', '/auth/login', 'public', (c) => {
    const b = c.req.body ?? {}; const r = auth.login(String(b.email ?? ''), String(b.password ?? ''), c.req.ip, c.req.headers['user-agent'] ?? '');
    if ('error' in r) { audit({ req: c.req, user: null }, 'auth.login_failed', 'admin', String(b.email ?? '').slice(0, 80), 'Failed sign in'); throw new HttpError(r.retryAfter ? 429 : 401, r.error); }
    audit({ req: c.req, user: r.user }, 'auth.login', 'admin', String(r.user.id), `${who(r.user)} signed in`);
    return { token: r.token, user: r.user, perms: ROLE_PERMS[r.user.role], mustChange: r.mustChange };
  });
  route('GET', '/public/ops', 'public', () => publicOps());
  function publicOps() {
    const m = kvGet<Maintenance>(db, 'maintenance', { enabled: false, message: '', eta: null, allowStaff: true });
    const flags = db.prepare('SELECT * FROM ops_flags').all() as any[]; const fl: Record<string, { enabled: boolean; rollout: number; audience: string }> = {};
    for (const f of flags) fl[f.key] = { enabled: !!f.enabled, rollout: f.rollout, audience: f.audience };
    const now = Date.now(); const an = (db.prepare('SELECT * FROM ops_announcements WHERE (expires_at IS NULL OR expires_at>?) AND target=? ORDER BY ts DESC LIMIT 5').all(now, 'all') as any[]).map((a) => ({ id: a.id, kind: a.kind, message: a.message, ts: a.ts, expiresAt: a.expires_at }));
    return { maintenance: { enabled: m.enabled, message: m.message, eta: m.eta }, flags: fl, announcements: an, serverTime: now };
  }

  // ---------- session
  route('GET', '/auth/me', null, (c) => ({ user: c.user, perms: ROLE_PERMS[c.user.role] }));
  route('POST', '/auth/logout', null, (c) => { auth.logout((c.req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '')); audit(c, 'auth.logout', 'admin', String(c.user.id), `${who(c.user)} signed out`); });
  route('POST', '/auth/password', null, (c) => {
    const b = c.req.body ?? {}; if (!auth.checkPassword(c.user.id, String(b.current ?? ''))) throw new HttpError(403, 'Current password is wrong');
    const w = checkPasswordStrength(String(b.next ?? '')); if (w) throw bad(w); auth.setPassword(c.user.id, b.next); audit(c, 'auth.password', 'admin', String(c.user.id), `${who(c.user)} changed their password`);
    const r = auth.login(c.user.email, b.next, c.req.ip, c.req.headers['user-agent'] ?? ''); if ('error' in r) throw bad(r.error); return { token: r.token };
  });

  // ---------- staff
  route('GET', '/staff', 'staff.manage', () => ({ users: auth.listUsers(), roles: ROLES }));
  route('POST', '/staff', 'staff.manage', (c) => {
    const b = c.req.body ?? {}; const role = b.role as Role; if (!ROLES.includes(role)) throw bad('Pick a role'); if (role === 'owner' && c.user.role !== 'owner') throw new HttpError(403, 'Only an owner can add an owner');
    const email = str(b.email, 'email'); if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Enter a valid email'); const w = checkPasswordStrength(String(b.password ?? '')); if (w) throw bad(w);
    try { const u = auth.createUser(email, str(b.name, 'name'), role, b.password, true); audit(c, 'staff.create', 'admin', String(u.id), `Added ${who(u)} as ${role}`); return { user: u }; }
    catch (e: any) { if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, 'That email already has an account'); throw e; }
  });
  route('PATCH', '/staff/:id', 'staff.manage', (c) => {
    const id = num(c.req.params.id, 'id'); const t = auth.getUser(id); if (!t) throw new HttpError(404, 'No such staff member'); const b = c.req.body ?? {};
    if (t.role === 'owner' && c.user.role !== 'owner') throw new HttpError(403, 'Only an owner can change an owner');
    if (b.role === 'owner' && c.user.role !== 'owner') throw new HttpError(403, 'Only an owner can make an owner');
    if (id === c.user.id && (b.disabled || (b.role && b.role !== t.role))) throw bad('You cannot disable or demote yourself');
    if (t.role === 'owner' && (b.disabled || (b.role && b.role !== 'owner')) && auth.listUsers().filter((u) => u.role === 'owner' && !u.disabled).length < 2) throw bad('There must be at least one active owner');
    auth.update(id, { name: b.name, role: b.role, disabled: b.disabled }); const n = auth.getUser(id)!; audit(c, 'staff.update', 'admin', String(id), `Updated ${who(n)}: ${JSON.stringify({ name: b.name, role: b.role, disabled: b.disabled })}`, t, n); return { user: n };
  });
  route('POST', '/staff/:id/password', 'staff.manage', (c) => {
    const id = num(c.req.params.id, 'id'); const t = auth.getUser(id); if (!t) throw new HttpError(404, 'No such staff member'); if (t.role === 'owner' && c.user.role !== 'owner') throw new HttpError(403, 'Only an owner can reset an owner');
    const w = checkPasswordStrength(String(c.req.body?.password ?? '')); if (w) throw bad(w); auth.setPassword(id, c.req.body.password, true); audit(c, 'staff.password_reset', 'admin', String(id), `Reset password for ${who(t)}`);
  });

  // ---------- audit
  route('GET', '/audit', 'audit.view', (c) => {
    const q = c.req.query; const w: string[] = []; const a: any[] = [];
    if (q.actor) { w.push('actor_email LIKE ?'); a.push(`%${q.actor}%`); } if (q.action) { w.push('action LIKE ?'); a.push(`${q.action}%`); } if (q.target) { w.push('(target_id LIKE ? OR summary LIKE ?)'); a.push(`%${q.target}%`, `%${q.target}%`); }
    if (q.before) { w.push('id<?'); a.push(Number(q.before)); }
    const rows = db.prepare(`SELECT * FROM admin_audit ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...a, Math.min(300, Number(q.limit) || 100)).map((r: any): AuditRow => ({ id: r.id, ts: r.ts, actorId: r.actor_id, actorEmail: r.actor_email, actorRole: r.actor_role, action: r.action, targetType: r.target_type, targetId: r.target_id, summary: r.summary, before: r.before_json ? JSON.parse(r.before_json) : null, after: r.after_json ? JSON.parse(r.after_json) : null, ip: r.ip }));
    return { rows };
  });

  // ---------- players
  route('GET', '/players', 'players.view', (c) => { const q = c.req.query; return store.listPlayers({ q: q.q, status: q.status, sort: q.sort, dir: q.dir === 'asc' ? 'asc' : 'desc', limit: Number(q.limit) || 50, offset: Number(q.offset) || 0 }); });
  route('GET', '/players/:id', 'players.view', (c) => { const p = store.getPlayer(c.req.params.id); if (!p) throw new HttpError(404, 'No such player'); return p; });
  route('POST', '/players/:id/sanction', 'players.moderate', (c) => {
    const p = store.getPlayer(c.req.params.id); if (!p) throw new HttpError(404, 'No such player'); const b = c.req.body ?? {};
    const kind = b.kind as SanctionKind; if (!['ban', 'suspend', 'mute'].includes(kind)) throw bad('kind must be ban, suspend or mute');
    const reason = str(b.reason, 'A reason', 5, 500); let minutes: number | null = b.minutes === null || b.minutes === undefined || b.minutes === '' ? null : num(b.minutes, 'duration');
    if (kind !== 'ban' && minutes === null) throw bad('Suspensions and mutes need a duration'); if (minutes !== null && (minutes < 1 || minutes > 60 * 24 * 365 * 5)) throw bad('Duration must be between 1 minute and 5 years');
    if (kind === 'ban' && minutes !== null && minutes <= 0) minutes = null;
    if (c.user.role === 'support') throw new HttpError(403, 'Support cannot sanction');
    const s = store.addSanction(p.id, kind, reason, minutes, c.user.email);
    let kicked = false; if (kind !== 'mute') kicked = live()?.kick(p.id, kind === 'ban' ? `Banned: ${reason}` : `Suspended: ${reason}`) ?? false;
    audit(c, 'player.' + kind, 'player', p.id, `${kind} ${p.name} ${minutes ? 'for ' + minutes + ' min' : 'permanently'}: ${reason}`, undefined, s);
    return { sanction: s, kicked };
  });
  route('POST', '/players/:id/unban', 'players.moderate', (c) => {
    const p = store.getPlayer(c.req.params.id); if (!p) throw new HttpError(404, 'No such player'); const reason = str(c.req.body?.reason, 'A reason', 3, 500);
    const n = store.revokeSanctions(p.id, c.user.email, reason, c.req.body?.kind); if (!n) throw bad('Nothing active to lift');
    audit(c, 'player.unban', 'player', p.id, `Lifted ${n} sanction(s) on ${p.name}: ${reason}`); return { lifted: n };
  });
  route('POST', '/players/:id/kick', 'players.moderate', (c) => {
    const p = store.getPlayer(c.req.params.id); if (!p) throw new HttpError(404, 'No such player'); const reason = str(c.req.body?.reason, 'A reason', 3, 300);
    const ok = live()?.kick(p.id, reason) ?? false; audit(c, 'player.kick', 'player', p.id, `Kicked ${p.name}${ok ? '' : ' (not online)'}: ${reason}`); if (!ok) throw bad('Player is not online'); return { kicked: true };
  });
  route('POST', '/players/:id/economy', 'players.economy', (c) => {
    const p = store.getPlayer(c.req.params.id); if (!p) throw new HttpError(404, 'No such player'); const b = c.req.body ?? {};
    const reason = str(b.reason, 'A reason', 5, 300); const op = b.op === 'remove' ? 'remove' : 'grant'; const kind = String(b.kind);
    const sign = op === 'remove' ? -1 : 1; let summary = ''; const before = { cash: p.cash, bank: p.bank, xp: p.xp, inventory: p.inventory.length };
    if (kind === 'cash' || kind === 'bank' || kind === 'xp') {
      const amt = Math.floor(num(b.amount, 'amount')); if (amt <= 0) throw bad('Amount must be above 0'); if (amt > 1_000_000_000) throw bad('That amount is not allowed');
      if (op === 'grant' && amt > 50_000_000 && c.user.role !== 'owner') throw new HttpError(403, 'Grants above 50,000,000 need an owner');
      store.patchState(p.id, (st) => { st[kind] = Math.max(0, (st[kind] ?? 0) + sign * amt); }); summary = `${op === 'grant' ? 'Granted' : 'Removed'} ${amt.toLocaleString('en-NG')} ${kind} ${op === 'grant' ? 'to' : 'from'} ${p.name}: ${reason}`;
    } else if (kind === 'item') {
      const id = str(b.itemId, 'itemId', 1, 80); const qty = Math.floor(num(b.qty ?? 1, 'qty')); if (qty <= 0 || qty > 10000) throw bad('Quantity must be 1 to 10000');
      store.patchState(p.id, (st) => { st.inventory = st.inventory ?? []; const it = st.inventory.find((x: any) => x.id === id); if (it) it.qty = Math.max(0, it.qty + sign * qty); else if (op === 'grant') st.inventory.push({ id, qty }); st.inventory = st.inventory.filter((x: any) => x.qty > 0); });
      summary = `${op === 'grant' ? 'Granted' : 'Removed'} ${qty} x ${id} ${op === 'grant' ? 'to' : 'from'} ${p.name}: ${reason}`;
    } else throw bad('kind must be cash, bank, xp or item');
    const after = store.getPlayer(p.id)!; audit(c, 'player.' + op, 'player', p.id, summary, before, { cash: after.cash, bank: after.bank, xp: after.xp, inventory: after.inventory.length });
    return { player: after };
  });
  route('POST', '/players/:id/reset', 'players.reset', (c) => {
    const p = store.getPlayer(c.req.params.id); if (!p) throw new HttpError(404, 'No such player'); const b = c.req.body ?? {}; const reason = str(b.reason, 'A reason', 5, 300);
    if (b.confirm !== p.name) throw bad('Type the player name to confirm'); const scope = String(b.scope);
    if (scope === 'full' && c.user.role !== 'owner') throw new HttpError(403, 'Only an owner can do a full wipe');
    if (!['progress', 'cash', 'inventory', 'vehicles', 'position', 'full'].includes(scope)) throw bad('Unknown reset scope');
    store.patchState(p.id, (st) => {
      if (scope === 'progress' || scope === 'full') { st.level = 1; st.xp = 0; st.skills = {}; st.missions = {}; }
      if (scope === 'cash' || scope === 'full') { st.cash = 0; st.bank = 0; }
      if (scope === 'inventory' || scope === 'full') st.inventory = [];
      if (scope === 'vehicles' || scope === 'full') st.vehicles = [];
      if (scope === 'position' || scope === 'full') { st.x = 0; st.z = 0; }
    });
    if (scope === 'full') for (const pl of p.plots) store.upsertPlot({ id: pl.id, ownerId: null, forSale: false });
    audit(c, 'player.reset', 'player', p.id, `Reset ${scope} for ${p.name}: ${reason}`); return { player: store.getPlayer(p.id) };
  });
  route('POST', '/players/:id/note', 'players.view', (c) => { const p = store.getPlayer(c.req.params.id); if (!p) throw new HttpError(404, 'No such player'); store.addNote(p.id, c.user.email, str(c.req.body?.text, 'A note', 2, 1000)); audit(c, 'player.note', 'player', p.id, `Note on ${p.name}`); return { player: store.getPlayer(p.id) }; });
  route('POST', '/players/:id/rename', 'players.moderate', (c) => { const p = store.getPlayer(c.req.params.id); if (!p) throw new HttpError(404, 'No such player'); const name = str(c.req.body?.name, 'name', 2, 24); store.rename(p.id, name); audit(c, 'player.rename', 'player', p.id, `Renamed ${p.name} to ${name}: ${c.req.body?.reason ?? ''}`); return { player: store.getPlayer(p.id) }; });

  // ---------- reports
  route('GET', '/reports', 'reports.view', (c) => store.reports({ status: c.req.query.status, limit: Number(c.req.query.limit) || 100 }));
  route('POST', '/reports/:id/resolve', 'reports.resolve', (c) => {
    const id = num(c.req.params.id, 'id'); const r = store.getReport(id); if (!r) throw new HttpError(404, 'No such report'); const b = c.req.body ?? {};
    const status = b.status === 'dismissed' ? 'dismissed' : 'actioned'; const n = store.resolveReport(id, status, str(b.note, 'A note', 2, 400), c.user.email);
    audit(c, 'report.' + status, 'report', String(id), `${status} report #${id} against ${r.targetName ?? r.targetId}`); return { report: n };
  });

  // ---------- map
  route('GET', '/map/live', 'map.view', () => ({ players: live()?.online() ?? [], ts: Date.now() }));
  route('GET', '/map/plots', 'map.view', () => ({ plots: store.plots() }));
  route('PUT', '/map/plots/:id', 'map.edit', (c) => {
    if (!can(c.user.role, 'players.economy')) throw new HttpError(403, 'Editing parcels needs an admin');
    const id = c.req.params.id; const b = c.req.body ?? {}; const cur = store.getPlot(id); const patch: Partial<PlotRec> & { id: string } = { id };
    if (b.price !== undefined) { const v = Math.round(num(b.price, 'price')); if (v < 0 || v > 5e10) throw bad('Price out of range'); patch.price = v; }
    if (b.ownerId !== undefined) { if (b.ownerId && !store.getPlayer(b.ownerId)) throw bad('No such owner account'); patch.ownerId = b.ownerId || null; }
    if (b.forSale !== undefined) patch.forSale = !!b.forSale; if (b.flags !== undefined) { if (!Array.isArray(b.flags) || b.flags.some((f: any) => typeof f !== 'string')) throw bad('flags must be a list of text'); patch.flags = b.flags.slice(0, 12); } if (b.name !== undefined) patch.name = b.name || null;
    if (!cur) { patch.x = num(b.x, 'x'); patch.z = num(b.z, 'z'); patch.zone = b.zone ?? null; patch.area = b.area ?? null; if (patch.price === undefined) patch.price = 0; }
    if (patch.ownerId && patch.forSale) throw bad('A parcel that has an owner is listed by the owner; clear the owner or untick for sale');
    const n = store.upsertPlot(patch); audit(c, 'plot.update', 'plot', id, `Parcel ${id}: ${JSON.stringify({ ...b, x: undefined, z: undefined })}`, cur, n); return { plot: n };
  });
  route('GET', '/map/pois', 'map.view', () => ({ overrides: (db.prepare('SELECT * FROM poi_overrides').all() as any[]).map((r) => ({ id: r.id, ...JSON.parse(r.json) })) }));
  route('PUT', '/map/pois/:id', 'map.edit', (c) => {
    const id = c.req.params.id; const b = c.req.body ?? {}; const cur = db.prepare('SELECT json FROM poi_overrides WHERE id=?').get(id); const before = cur ? JSON.parse(cur.json) : null;
    const next = { ...(before ?? {}), ...(b.name !== undefined ? { name: str(b.name, 'name', 1, 80) } : {}), ...(b.type !== undefined ? { type: str(b.type, 'type', 1, 30) } : {}), ...(b.hidden !== undefined ? { hidden: !!b.hidden } : {}), ...(b.note !== undefined ? { note: String(b.note).slice(0, 300) } : {}), ...(b.x !== undefined ? { x: num(b.x, 'x'), z: num(b.z, 'z'), custom: true } : {}) };
    db.prepare('INSERT INTO poi_overrides(id,json,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at, updated_by=excluded.updated_by').run(id, JSON.stringify(next), Date.now(), c.user.email);
    audit(c, 'poi.update', 'poi', id, `POI ${id}: ${JSON.stringify(b)}`, before, next); return { poi: { id, ...next } };
  });
  route('DELETE', '/map/pois/:id', 'map.edit', (c) => { const id = c.req.params.id; const cur = db.prepare('SELECT json FROM poi_overrides WHERE id=?').get(id); db.prepare('DELETE FROM poi_overrides WHERE id=?').run(id); audit(c, 'poi.reset', 'poi', id, `Removed POI override ${id}`, cur ? JSON.parse(cur.json) : null); });

  // ---------- content
  route('GET', '/content', 'content.view', () => ({ kinds: content.kinds().map((k) => { try { const r = content.read(k); return { kind: k, items: r.doc.items.length, version: r.version }; } catch { return { kind: k, items: 0, version: 0 }; } }) }));
  route('GET', '/content/:kind', 'content.view', (c) => { if (!KIND_RE.test(c.req.params.kind)) throw bad('bad kind'); const r = content.read(c.req.params.kind, c.user.email); return { doc: r.doc, version: r.version, issues: validateContent(c.req.params.kind, r.doc) }; });
  route('POST', '/content/:kind/validate', 'content.view', (c) => ({ issues: validateContent(c.req.params.kind, c.req.body?.doc) }));
  route('PUT', '/content/:kind', 'content.edit', (c) => {
    const kind = c.req.params.kind; if (!KIND_RE.test(kind)) throw bad('bad kind'); const need: Perm = kind === 'economy' || kind === 'iap' ? (kind === 'iap' ? 'store.edit' : 'economy.edit') : 'content.edit';
    if (!can(c.user.role, need)) throw new HttpError(403, `Editing ${kind} needs the ${need} permission`);
    const b = c.req.body ?? {}; const before = content.read(kind, c.user.email);
    const r = content.save(kind, b.doc, c.user.email, String(b.note ?? '').slice(0, 200), b.baseVersion);
    if (!r.ok) throw new HttpError(r.status, r.error, { issues: r.issues, current: r.current });
    if (r.changed) { const d = diffItems(before.doc.items, b.doc.items); audit(c, 'content.save', 'content', kind, `Saved ${kind} v${r.version}: +${d.add} new, ${d.chg} changed, ${d.del} removed${b.note ? ' (' + b.note + ')' : ''}`, { version: before.version }, { version: r.version, ...d }); }
    return { version: r.version, changed: r.changed, issues: r.issues };
  });
  route('GET', '/content/:kind/versions', 'content.view', (c) => ({ versions: content.versions(c.req.params.kind) }));
  route('GET', '/content/:kind/versions/:v', 'content.view', (c) => { const d = content.versionBody(c.req.params.kind, num(c.req.params.v, 'version')); if (!d) throw new HttpError(404, 'No such version'); return { doc: d }; });
  route('POST', '/content/:kind/rollback', 'content.rollback', (c) => {
    const kind = c.req.params.kind; const v = num(c.req.body?.version, 'version'); const before = content.read(kind, c.user.email); const r = content.rollback(kind, v, c.user.email);
    if (!r.ok) throw new HttpError(r.status, r.error, { issues: (r as any).issues }); audit(c, 'content.rollback', 'content', kind, `Rolled ${kind} back to v${v} (now v${r.version})`, { version: before.version }, { version: r.version }); return { version: r.version };
  });
  route('GET', '/layouts/:kind/:id', 'content.view', (c) => { const r = db.prepare('SELECT json FROM graph_layouts WHERE kind=? AND item_id=?').get(c.req.params.kind, c.req.params.id); return { layout: r ? JSON.parse(r.json) : null }; });
  route('PUT', '/layouts/:kind/:id', 'content.edit', (c) => { db.prepare('INSERT INTO graph_layouts(kind,item_id,json) VALUES(?,?,?) ON CONFLICT(kind,item_id) DO UPDATE SET json=excluded.json').run(c.req.params.kind, c.req.params.id, JSON.stringify(c.req.body?.layout ?? {})); });

  // ---------- store
  route('GET', '/store/purchases', 'store.view', (c) => { const q = c.req.query; return store.purchases({ status: q.status, q: q.q, from: q.from ? Number(q.from) : undefined, to: q.to ? Number(q.to) : undefined, limit: Number(q.limit) || 50, offset: Number(q.offset) || 0 }); });
  route('POST', '/store/purchases/:id/refund', 'store.refund', (c) => {
    const p = store.getPurchase(c.req.params.id); if (!p) throw new HttpError(404, 'No such purchase'); if (p.status !== 'paid') throw bad(`Purchase is ${p.status}, not paid`); const reason = str(c.req.body?.reason, 'A reason', 5, 300);
    const n = store.refund(p.id, reason); audit(c, 'purchase.refund', 'purchase', p.id, `Refunded ${p.amount} ${p.currency} (${p.itemId}) to ${p.accountName ?? p.accountId}: ${reason}`, p, n);
    return { purchase: n, note: p.provider === 'manual' ? null : `Marked refunded here. Send the refund to ${p.provider} separately (ref ${p.ref ?? 'none'}) until the payment webhook is wired.` };
  });
  route('GET', '/store/revenue', 'store.view', (c) => store.revenue(Math.min(180, Math.max(7, Number(c.req.query.days) || 30))));

  // ---------- the world: power grid and businesses
  const world = () => { const w = deps.world?.() ?? null; if (!w) throw bad('The game world is not attached to this server.'); return w; };
  route('GET', '/world/grid', 'liveops.view', () => world().grid.board());
  route('POST', '/world/grid', 'liveops.edit', (c) => {
    const b = c.req.body ?? {}; const g = world().grid;
    if (typeof b.collapse === 'number') { g.collapse(Math.max(0, Math.min(24, b.collapse))); audit(c, 'grid.collapse', 'grid', 'all', b.collapse > 0 ? `Collapsed the national grid for ${b.collapse} game hours` : 'Restored the national grid'); }
    if (typeof b.genScale === 'number') { g.genScale = Math.max(0, Math.min(2, b.genScale)); g.tick(); audit(c, 'grid.gen', 'grid', 'all', `Generation set to ${Math.round(g.genScale * 100)}%`); }
    if (b.feeder !== undefined) {
      const f = b.feeder === 'all' ? 'all' : Math.floor(Number(b.feeder)); if (f !== 'all' && !Number.isFinite(f)) throw bad('Bad feeder');
      const on = b.on === null || b.on === 'auto' ? null : !!b.on; g.force(f, on, Math.max(1, Math.min(240, Number(b.hours) || 24)));
      audit(c, 'grid.force', 'grid', String(f), on === null ? `Feeder ${f} back on the plan` : `Feeder ${f} forced ${on ? 'ON' : 'OFF'}`);
    }
    return g.board();
  });
  route('GET', '/world/businesses', 'economy.view', () => ({ list: db.prepare('SELECT b.*, f.name AS owner_name FROM businesses b LEFT JOIN profiles f ON f.account_id=b.owner_id ORDER BY b.bought_at DESC LIMIT 500').all() }));
  route('POST', '/world/businesses/:site', 'economy.edit', (c) => {
    const site = c.req.params.site; const b = c.req.body ?? {}; const row = db.prepare('SELECT * FROM businesses WHERE site=?').get(site) as any; if (!row) throw bad('No such business');
    if (b.repossess) { db.prepare('DELETE FROM businesses WHERE site=?').run(site); audit(c, 'biz.repossess', 'business', site, `Repossessed ${row.type} at ${site}`); return { ok: true }; }
    const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
    const till = num(b.till, 0, 1e9), stock = num(b.stock, 0, 100), debt = num(b.debt, 0, 1e9);
    db.prepare('UPDATE businesses SET till=COALESCE(?,till), stock=COALESCE(?,stock), debt=COALESCE(?,debt) WHERE site=?').run(till ?? null, stock ?? null, debt ?? null, site);
    audit(c, 'biz.edit', 'business', site, `Edited ${row.type} at ${site}: ${JSON.stringify({ till, stock, debt })}`);
    return db.prepare('SELECT * FROM businesses WHERE site=?').get(site);
  });

  // ---------- MyAds moderation and payments
  const adsOf = () => { const a = world().ads; if (!a) throw bad('Ads are not attached to this server.'); return a; };
  route('GET', '/world/ads', 'reports.view', (c) => {
    const st = ['review', 'approved', 'rejected', 'unpaid'].includes(String(c.req.query.status)) ? String(c.req.query.status) : 'review';
    return { status: st, list: adsOf().queue(st), boards: adsOf().boards.length };
  });
  route('GET', '/world/uploads/:id', 'reports.view', (c) => {
    const a = adsOf(); const u = a.upload(c.req.params.id); const f = u && a.uploadFile(u); if (!f) throw bad('No such picture');
    return { id: u.id, size: u.name, dataUrl: `data:${u.mime};base64,${readFileSync(f).toString('base64')}` };
  });
  route('POST', '/world/ads/:id', 'reports.resolve', async (c) => {
    const b = c.req.body ?? {}; const d = b.decision === 'approve' ? 'approve' : b.decision === 'reject' ? 'reject' : null; if (!d) throw bad('Approve or reject');
    const note = typeof b.note === 'string' ? b.note.slice(0, 200) : '';
    if (d === 'reject' && !note) throw bad('Say why, the advertiser sees it');
    const id = Number(c.req.params.id); let row; try { row = await adsOf().review(id, d, note); } catch (e: any) { throw new HttpError(e?.status ?? 400, e?.message ?? 'Review failed'); }
    audit(c, d === 'approve' ? 'ads.approve' : 'ads.reject', 'ad', String(id), `${d === 'approve' ? 'Approved' : 'Rejected'} ad ${id}${note ? `: ${note}` : ''}`);
    return row;
  });


  // ---------- live ops
  route('GET', '/ops/status', 'liveops.view', () => {
    const l = live(); const on = l?.online().length ?? 0; const st = l?.stats?.() ?? { connections: on, tickMs: 0 }; const cn = store.counts();
    const peak = (db.prepare('SELECT MAX(online) m FROM ops_series WHERE ts>?').get(Date.now() - 86400_000)?.m as number | null) ?? on;
    let dbMb = 0; try { dbMb = (db.prepare('PRAGMA page_count').get() as any)?.page_count * (db.prepare('PRAGMA page_size').get() as any)?.page_size / 1048576 || 0; } catch { /* ignore */ }
    return { version: deps.version ?? 'dev', uptimeSec: Math.floor((Date.now() - startedAt) / 1000), online: on, peak24h: Math.max(peak, on), connections: st.connections, tickMs: st.tickMs, memoryMb: Math.round(process.memoryUsage().rss / 1048576), dbMb: Math.round(dbMb * 10) / 10, maintenance: kvGet<Maintenance>(db, 'maintenance', { enabled: false, message: '', eta: null, allowStaff: true }), ...cn, simulated: !!(l as any)?.simulated };
  });
  route('GET', '/ops/series', 'liveops.view', () => ({ series: db.prepare('SELECT ts,online FROM ops_series WHERE ts>? ORDER BY ts').all(Date.now() - 24 * 3600_000) }));
  route('GET', '/ops/flags', 'liveops.view', () => ({ flags: (db.prepare('SELECT * FROM ops_flags ORDER BY key').all() as any[]).map((r): Flag => ({ key: r.key, enabled: !!r.enabled, rollout: r.rollout, description: r.description, audience: r.audience, updatedAt: r.updated_at, updatedBy: r.updated_by })) }));
  route('PUT', '/ops/flags/:key', 'liveops.edit', (c) => {
    const key = c.req.params.key; if (!/^[a-z][a-z0-9_.-]{1,40}$/.test(key)) throw bad('Flag keys use lowercase letters, digits, . _ -'); const b = c.req.body ?? {};
    const cur = db.prepare('SELECT * FROM ops_flags WHERE key=?').get(key); const n = { enabled: b.enabled ?? !!cur?.enabled, rollout: Math.max(0, Math.min(100, Math.round(Number(b.rollout ?? cur?.rollout ?? 100)))), description: String(b.description ?? cur?.description ?? '').slice(0, 200), audience: ['all', 'staff', 'beta'].includes(b.audience) ? b.audience : cur?.audience ?? 'all' };
    db.prepare('INSERT INTO ops_flags(key,enabled,rollout,description,audience,updated_at,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET enabled=excluded.enabled, rollout=excluded.rollout, description=excluded.description, audience=excluded.audience, updated_at=excluded.updated_at, updated_by=excluded.updated_by').run(key, n.enabled ? 1 : 0, n.rollout, n.description, n.audience, Date.now(), c.user.email);
    audit(c, cur ? 'flag.update' : 'flag.create', 'flag', key, `Flag ${key}: ${n.enabled ? 'on' : 'off'} at ${n.rollout}% for ${n.audience}`, cur ? { enabled: !!cur.enabled, rollout: cur.rollout, audience: cur.audience } : null, n); return { ok: true };
  });
  route('DELETE', '/ops/flags/:key', 'liveops.edit', (c) => { db.prepare('DELETE FROM ops_flags WHERE key=?').run(c.req.params.key); audit(c, 'flag.delete', 'flag', c.req.params.key, `Deleted flag ${c.req.params.key}`); });
  route('GET', '/ops/announcements', 'liveops.view', () => ({ rows: (db.prepare('SELECT * FROM ops_announcements ORDER BY id DESC LIMIT 50').all() as any[]).map((r): Announcement => ({ id: r.id, ts: r.ts, by: r.by, kind: r.kind, message: r.message, target: r.target, targetIds: r.target_ids ? JSON.parse(r.target_ids) : undefined, expiresAt: r.expires_at ?? null, delivered: r.delivered })) }));
  route('POST', '/ops/announce', 'liveops.edit', (c) => {
    const b = c.req.body ?? {}; const message = str(b.message, 'A message', 3, 280); const kind = ['info', 'warn', 'event'].includes(b.kind) ? b.kind : 'info';
    const ids: string[] | undefined = Array.isArray(b.targetIds) && b.targetIds.length ? b.targetIds.map(String).slice(0, 200) : undefined; const mins = b.minutes ? Math.min(1440, Math.max(1, Number(b.minutes))) : null;
    const delivered = live()?.broadcast({ kind, message, targetIds: ids }) ?? 0;
    const r = db.prepare('INSERT INTO ops_announcements(ts,by,kind,message,target,target_ids,expires_at,delivered) VALUES(?,?,?,?,?,?,?,?)').run(Date.now(), c.user.email, kind, message, ids ? 'ids' : 'all', ids ? JSON.stringify(ids) : null, mins ? Date.now() + mins * 60_000 : null, delivered);
    audit(c, 'announce', 'announcement', String(r.lastInsertRowid), `${kind} to ${ids ? ids.length + ' players' : 'everyone'} (${delivered} online): ${message}`); return { delivered };
  });
  route('PUT', '/ops/maintenance', 'maintenance.toggle', (c) => {
    const b = c.req.body ?? {}; const cur = kvGet<Maintenance>(db, 'maintenance', { enabled: false, message: '', eta: null, allowStaff: true });
    const n: Maintenance = { enabled: !!b.enabled, message: String(b.message ?? cur.message ?? '').slice(0, 280), eta: b.eta ? Number(b.eta) : null, allowStaff: b.allowStaff !== false };
    if (n.enabled && n.message.trim().length < 3) throw bad('Write the message players will see');
    kvSet(db, 'maintenance', n); if (n.enabled && !cur.enabled) live()?.broadcast({ kind: 'warn', message: n.message || 'The server is going down for maintenance.' });
    audit(c, 'maintenance', 'ops', 'maintenance', `Maintenance ${n.enabled ? 'ON' : 'off'}${n.enabled ? ': ' + n.message : ''}`, cur, n); return { maintenance: n };
  });

  const tick = () => { try { db.prepare('INSERT OR REPLACE INTO ops_series(ts,online) VALUES(?,?)').run(Math.floor(Date.now() / 60000) * 60000, live()?.online().length ?? 0); db.prepare('DELETE FROM ops_series WHERE ts<?').run(Date.now() - 3 * 86400_000); } catch { /* ignore */ } };
  return { routes, auth, store, content, tick, publicOps, setupCode: () => setupCode };
}
