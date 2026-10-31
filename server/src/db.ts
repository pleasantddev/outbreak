// SQLite persistence (better-sqlite3, synchronous). One file, WAL mode, versioned migrations.
import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  // 1: accounts, sessions, profiles, player state, global world
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    pw_hash TEXT,
    is_guest INTEGER NOT NULL DEFAULT 0,
    guest_key_hash TEXT,
    role TEXT NOT NULL DEFAULT 'player',
    created_at INTEGER NOT NULL,
    last_login INTEGER,
    last_ip TEXT,
    ban_until INTEGER,          -- NULL not banned, -1 permanent, else epoch ms
    ban_reason TEXT,
    mute_until INTEGER,
    note TEXT
  );
  CREATE INDEX accounts_guestkey ON accounts(guest_key_hash);
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    ip TEXT, ua TEXT
  );
  CREATE INDEX sessions_account ON sessions(account_id);
  CREATE TABLE profiles (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,   -- one profile per account, enforced by the key
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    model TEXT NOT NULL,
    skin INTEGER NOT NULL,
    outfit TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE players (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    cash INTEGER NOT NULL,
    bank INTEGER NOT NULL DEFAULT 0,
    x REAL, y REAL, z REAL,
    vehicles TEXT NOT NULL DEFAULT '{}',
    skills TEXT NOT NULL DEFAULT '{}',
    missions TEXT NOT NULL DEFAULT '{}',
    blobs TEXT NOT NULL DEFAULT '{}',
    play_seconds INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE plots (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES accounts(id),
    pts TEXT,
    price INTEGER NOT NULL,
    bought_at INTEGER NOT NULL,
    cx REAL, cz REAL
  );
  CREATE INDEX plots_owner ON plots(owner_id);
  CREATE INDEX plots_pos ON plots(cx, cz);
  CREATE TABLE tx_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    cash_delta INTEGER NOT NULL DEFAULT 0,
    bank_delta INTEGER NOT NULL DEFAULT 0,
    cash_after INTEGER NOT NULL,
    bank_after INTEGER NOT NULL,
    ref TEXT,
    note TEXT
  );
  CREATE INDEX tx_account ON tx_log(account_id, id);
  CREATE TABLE purchases (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'iap',          -- iap | ingame | grant
    amount_minor INTEGER NOT NULL DEFAULT 0,   -- price in minor units (kobo, cents)
    currency TEXT NOT NULL DEFAULT 'NGN',
    provider TEXT,                             -- paystack | flutterwave | apple | google | admin
    provider_ref TEXT,
    status TEXT NOT NULL DEFAULT 'pending',    -- pending | paid | granted | failed | refunded
    granted TEXT NOT NULL DEFAULT '{}',        -- JSON of what the player received
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX purchases_ref ON purchases(provider, provider_ref) WHERE provider_ref IS NOT NULL;
  CREATE INDEX purchases_account ON purchases(account_id, created_at);
  CREATE TABLE bans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    by_id TEXT,
    reason TEXT,
    created_at INTEGER NOT NULL,
    until INTEGER,                             -- NULL or -1 permanent
    revoked_at INTEGER
  );
  CREATE INDEX bans_account ON bans(account_id);
  CREATE TABLE chat_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    name TEXT,
    ch TEXT NOT NULL,
    to_name TEXT,
    text TEXT NOT NULL
  );
  CREATE TABLE cheat_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX cheat_account ON cheat_flags(account_id);
  CREATE TABLE nin_registry (
    nin TEXT PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
    full_name TEXT NOT NULL,
    lga TEXT,
    issued_at INTEGER NOT NULL
  );
  CREATE TABLE vehicle_registry (
    id TEXT PRIMARY KEY,
    vkey TEXT NOT NULL UNIQUE,                 -- stable car identity chosen by the client (kind:seed or a garage id)
    owner_id TEXT NOT NULL REFERENCES accounts(id),
    nin TEXT,
    kind TEXT NOT NULL,
    plate TEXT UNIQUE,
    paint TEXT NOT NULL DEFAULT '{}',
    registered_at INTEGER NOT NULL,
    stolen INTEGER NOT NULL DEFAULT 0,
    stolen_at INTEGER,
    tracker INTEGER NOT NULL DEFAULT 0,
    last_x REAL, last_z REAL, last_seen INTEGER
  );
  CREATE INDEX vreg_owner ON vehicle_registry(owner_id);
  CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `,
  // v3: small businesses on shop fronts (rules in v2/src/net/rules.ts, run by src/business.ts)
  `
  CREATE TABLE businesses (
    site TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES accounts(id),
    type TEXT NOT NULL,
    stock REAL NOT NULL, till REAL NOT NULL, debt REAL NOT NULL DEFAULT 0,
    hour INTEGER NOT NULL, bought_at INTEGER NOT NULL,
    log TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX biz_owner ON businesses(owner_id);
  `,
  // v4: phone numbers, public ids, contacts and text messages between players
  `
  CREATE TABLE phones (account_id TEXT PRIMARY KEY REFERENCES accounts(id), number TEXT NOT NULL UNIQUE, public_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
  CREATE TABLE contacts (owner_id TEXT NOT NULL REFERENCES accounts(id), contact_id TEXT NOT NULL REFERENCES accounts(id), name TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY (owner_id, contact_id));
  CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT NOT NULL, to_id TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX msg_to ON messages(to_id, at); CREATE INDEX msg_from ON messages(from_id, at);
  `,
  // v5: real-money checkouts (src/payments.ts). The admin store page reads item_id, amount (naira), ref, promo and
  // refunded_at from this same table, so the payments code fills both column sets.
  `
  ALTER TABLE purchases ADD COLUMN item_id TEXT;
  ALTER TABLE purchases ADD COLUMN amount REAL NOT NULL DEFAULT 0;
  ALTER TABLE purchases ADD COLUMN ref TEXT;
  ALTER TABLE purchases ADD COLUMN promo TEXT;
  ALTER TABLE purchases ADD COLUMN label TEXT;
  ALTER TABLE purchases ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE purchases ADD COLUMN paid_at INTEGER;
  ALTER TABLE purchases ADD COLUMN refunded_at INTEGER;
  ALTER TABLE purchases ADD COLUMN refund_reason TEXT;
  CREATE UNIQUE INDEX purchases_ourref ON purchases(ref) WHERE ref IS NOT NULL;
  `,
  // v6: MyAds. Player uploads, ads (billboards, drone shows, blimps; paid through purchases) and who saw them
  `
  CREATE TABLE uploads (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, name TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE ads (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, kind TEXT NOT NULL, board_id TEXT, upload_id TEXT, text TEXT, color TEXT, place TEXT,
    start_at INTEGER NOT NULL, end_at INTEGER NOT NULL, price_kobo INTEGER NOT NULL, status TEXT NOT NULL, payment_ref TEXT, note TEXT, created_at INTEGER NOT NULL);
  CREATE INDEX ads_live ON ads(status, end_at); CREATE INDEX ads_board ON ads(board_id, start_at);
  CREATE TABLE ad_views (ad_id INTEGER NOT NULL, account_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (ad_id, account_id, day));
  CREATE TABLE ad_daily (ad_id INTEGER NOT NULL, day TEXT NOT NULL, sightings INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ad_id, day));
  `,
  // v7: the body (src/body.ts): hidden karma and luck seed, negative traits, illnesses (who is sick, who just carries
  // it), immunity, the hospital debt, and whether a player was sent out of hospital in their underwear
  `
  CREATE TABLE player_body (account_id TEXT PRIMARY KEY, karma REAL NOT NULL DEFAULT 0, seed REAL NOT NULL, traits TEXT NOT NULL DEFAULT '[]', fixed TEXT NOT NULL DEFAULT '[]',
    origin TEXT NOT NULL DEFAULT 'regular', ill TEXT NOT NULL DEFAULT '[]', immune TEXT NOT NULL DEFAULT '{}', known TEXT NOT NULL DEFAULT '[]', debt INTEGER NOT NULL DEFAULT 0,
    stripped INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
  CREATE TABLE karma_log (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, at INTEGER NOT NULL, delta REAL NOT NULL, why TEXT NOT NULL);
  CREATE INDEX karma_acct ON karma_log(account_id, at);
  `,
  // v8: property listings (Property Manager app), sports venues and bookings (rules in v2/src/net/sports.ts, run by src/property.ts)
  `
  CREATE TABLE listings (
    kind TEXT NOT NULL, id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES accounts(id),
    mode TEXT NOT NULL, price INTEGER NOT NULL, rent INTEGER NOT NULL DEFAULT 0,
    hour INTEGER NOT NULL, listed_at INTEGER NOT NULL, log TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (kind, id)
  );
  CREATE TABLE venues (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id),
    fee INTEGER NOT NULL, earned INTEGER NOT NULL DEFAULT 0, bought_at INTEGER NOT NULL
  );
  CREATE INDEX venue_owner ON venues(owner_id);
  CREATE TABLE bookings (
    venue TEXT NOT NULL, slot INTEGER NOT NULL, by_id TEXT NOT NULL REFERENCES accounts(id), fee INTEGER NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (venue, slot)
  );
  CREATE INDEX booking_by ON bookings(by_id);
  `,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  const cur = db.pragma('user_version', { simple: true }) as number;
  for (let v = cur; v < MIGRATIONS.length; v++) {
    db.transaction(() => { db.exec(MIGRATIONS[v]); db.pragma(`user_version = ${v + 1}`); })();
  }
}

/** tiny typed helpers over better-sqlite3 */
export const one = <T>(db: DB, sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T | undefined;
export const all = <T>(db: DB, sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
export const run = (db: DB, sql: string, ...p: unknown[]) => db.prepare(sql).run(...p);

export function kvGet(db: DB, k: string): string | undefined { return one<{ v: string }>(db, 'SELECT v FROM kv WHERE k=?', k)?.v; }
export function kvSet(db: DB, k: string, v: string) { run(db, 'INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, v); }
