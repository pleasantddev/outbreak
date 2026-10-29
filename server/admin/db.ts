// Admin-owned tables. Works with better-sqlite3 (the real server) and node:sqlite (the dev stub): positional params only.
export interface SqlStmt { run(...a: any[]): any; get(...a: any[]): any; all(...a: any[]): any[] }
export interface SqlDb { prepare(sql: string): SqlStmt; exec(sql: string): void }

export function migrateAdmin(db: SqlDb) {
  db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
  pw_hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login INTEGER, must_change INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT, ua TEXT);
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor_id INTEGER, actor_email TEXT NOT NULL, actor_role TEXT NOT NULL,
  action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, summary TEXT NOT NULL, before_json TEXT, after_json TEXT, ip TEXT);
CREATE INDEX IF NOT EXISTS admin_audit_ts ON admin_audit(ts DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target ON admin_audit(target_type, target_id);
CREATE TABLE IF NOT EXISTS content_versions (
  kind TEXT NOT NULL, version INTEGER NOT NULL, saved_at INTEGER NOT NULL, by TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  items INTEGER NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (kind, version));
CREATE TABLE IF NOT EXISTS ops_flags (
  key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, rollout INTEGER NOT NULL DEFAULT 100, description TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'all', updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS ops_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, by TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT 'all', target_ids TEXT, expires_at INTEGER, delivered INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ops_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, ts INTEGER NOT NULL, by TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS poi_overrides (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS graph_layouts (kind TEXT NOT NULL, item_id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (kind, item_id));
CREATE TABLE IF NOT EXISTS ops_series (ts INTEGER PRIMARY KEY, online INTEGER NOT NULL);
`);
}

export const kvGet = <T>(db: SqlDb, key: string, def: T): T => { const r = db.prepare('SELECT value FROM ops_kv WHERE key=?').get(key); if (!r) return def; try { return JSON.parse(r.value) as T; } catch { return def; } };
export const kvSet = (db: SqlDb, key: string, v: unknown) => { db.prepare('INSERT INTO ops_kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(v)); };

/** What the admin routes expect from the game server's own tables. The real schema is owned by the net workstream:
 *  adjust server/admin/store.ts (the only file that reads these) when it differs. The dev stub creates them with this DDL. */
export const NET_DDL = `
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER, ip TEXT, device TEXT);
CREATE TABLE IF NOT EXISTS player_state (account_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plots (id TEXT PRIMARY KEY, owner_id TEXT, price INTEGER NOT NULL, for_sale INTEGER NOT NULL DEFAULT 0, x REAL NOT NULL, z REAL NOT NULL, flags TEXT NOT NULL DEFAULT '[]', name TEXT, zone TEXT, area REAL);
CREATE TABLE IF NOT EXISTS bans (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER, issued_by TEXT NOT NULL, revoked_at INTEGER, revoked_by TEXT, revoke_reason TEXT);
CREATE INDEX IF NOT EXISTS bans_acc ON bans(account_id);
CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, item_id TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL, ref TEXT, promo TEXT, created_at INTEGER NOT NULL, refunded_at INTEGER, refund_reason TEXT);
CREATE INDEX IF NOT EXISTS purchases_acc ON purchases(account_id);
CREATE INDEX IF NOT EXISTS purchases_ts ON purchases(created_at);
CREATE TABLE IF NOT EXISTS chat_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id TEXT NOT NULL, target_id TEXT NOT NULL, channel TEXT NOT NULL, message TEXT NOT NULL, context TEXT, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolution TEXT, resolved_by TEXT);
`;
