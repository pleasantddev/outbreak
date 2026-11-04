import { createRequire as __hlRequire } from 'node:module'; const require = __hlRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target, all2) => {
  for (var name in all2)
    __defProp(target, name, { get: all2[name], enumerable: true });
};

// server/src/log.ts
var lvl = (process.env.LOG_LEVEL ?? "info").toLowerCase();
var rank = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
var on = (l) => rank[l] >= (rank[lvl] ?? 1);
var stamp = () => (/* @__PURE__ */ new Date()).toISOString();
var log = {
  debug: (...a) => on("debug") && console.debug(stamp(), "DEBUG", ...a),
  info: (...a) => on("info") && console.info(stamp(), "INFO ", ...a),
  warn: (...a) => on("warn") && console.warn(stamp(), "WARN ", ...a),
  error: (...a) => on("error") && console.error(stamp(), "ERROR", ...a)
};

// server/src/main.ts
import { EventEmitter as EventEmitter10 } from "node:events";
import { resolve as resolve7 } from "node:path";

// server/src/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var here = dirname(fileURLToPath(import.meta.url));
var SERVER_DIR = resolve(here, existsSync(resolve(here, "../routes")) ? ".." : "../../../../server");
var REPO_DIR = resolve(SERVER_DIR, "..");
var PATHS = {
  publicDir: process.env.HL_PUBLIC_DIR ?? resolve(REPO_DIR, "v2/public"),
  sharedData: process.env.HL_SHARED_DATA ?? resolve(REPO_DIR, "v2/src/data")
};
var env = process.env;
var num = (k, d) => {
  const v = Number(env[k]);
  return Number.isFinite(v) && env[k] !== void 0 && env[k] !== "" ? v : d;
};
var bool = (k, d) => env[k] === void 0 ? d : /^(1|true|yes|on)$/i.test(env[k]);
function secret(dataDir) {
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 16) return env.JWT_SECRET;
  const f = resolve(dataDir, "secret.key");
  try {
    if (existsSync(f)) return readFileSync(f, "utf8").trim();
  } catch {
  }
  const s = randomBytes(32).toString("hex");
  try {
    writeFileSync(f, s, { mode: 384 });
    try {
      chmodSync(f, 384);
    } catch {
    }
  } catch {
  }
  return s;
}
function loadConfig(over = {}) {
  const dataDir = resolve(env.DATA_DIR ?? resolve(SERVER_DIR, "data"));
  mkdirSync(dataDir, { recursive: true });
  const c = {
    port: num("PORT", 8787),
    host: env.HOST ?? "0.0.0.0",
    dataDir,
    dbFile: env.DB_FILE ?? resolve(dataDir, "hustlelife.db"),
    contentDir: env.CONTENT_DIR ?? resolve(dataDir, "content"),
    seedContentDir: env.SEED_CONTENT_DIR ?? resolve(PATHS.publicDir, "content"),
    plotsFile: env.PLOTS_FILE ?? resolve(dataDir, "plots.bin"),
    jwtSecret: "",
    tokenDays: num("TOKEN_DAYS", 30),
    tickHz: Math.max(5, Math.min(30, num("TICK_HZ", 15))),
    maxPlayers: num("MAX_PLAYERS", 500),
    interestRings: num("INTEREST_RINGS", 3),
    nearChatRadius: num("NEAR_CHAT_RADIUS", 60),
    startCash: num("START_CASH", 1850),
    adminEmail: (env.ADMIN_EMAIL ?? "").toLowerCase(),
    adminPassword: env.ADMIN_PASSWORD ?? "",
    allowOrigins: env.ALLOW_ORIGINS ?? "*",
    staticDir: env.STATIC_DIR ?? "",
    adminDir: env.ADMIN_DIR ?? "",
    guestAccounts: bool("GUEST_ACCOUNTS", true),
    trustClientPlotPrice: bool("TRUST_CLIENT_PLOT_PRICE", true),
    mapBounds: [-22e3, -20500, 12e3, 12500],
    motd: env.MOTD ?? "Welcome to Lagos. Shine your eye.",
    trustProxy: bool("TRUST_PROXY", false),
    antiCheat: env.ANTI_CHEAT ?? "enforce",
    rateScale: num("RATE_SCALE", 1),
    paystackSecret: env.PAYSTACK_SECRET_KEY ?? "",
    paystackPublic: env.PAYSTACK_PUBLIC_KEY ?? "",
    payTest: bool("PAY_TEST", !env.PAYSTACK_SECRET_KEY && env.NODE_ENV !== "production"),
    payCallbackUrl: env.PAY_CALLBACK_URL ?? "",
    ...over
  };
  c.jwtSecret = over.jwtSecret ?? secret(dataDir);
  return c;
}

// server/src/db.ts
import Database from "better-sqlite3";
import { dirname as dirname2 } from "node:path";
import { mkdirSync as mkdirSync2 } from "node:fs";
var MIGRATIONS = [
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
  // v9: phones as things you own (src/devices.ts): model, cracks, which one is in your hand, and who secretly cloned it
  `
  CREATE TABLE devices (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, model TEXT NOT NULL, crack INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 0,
    cloned_by TEXT, cloned_at INTEGER, bought_at INTEGER NOT NULL);
  CREATE INDEX dev_owner ON devices(owner_id); CREATE INDEX dev_clone ON devices(cloned_by);
  CREATE TABLE clone_moves (id INTEGER PRIMARY KEY AUTOINCREMENT, device TEXT NOT NULL, hacker TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL);
  `,
  // v10: clubs (src/clubs.ts): songs players upload and attest they own, and paid promotions into club rotation
  `
  CREATE TABLE songs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, secs INTEGER NOT NULL,
    status TEXT NOT NULL, note TEXT, plays INTEGER NOT NULL DEFAULT 0, attest_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX songs_owner ON songs(account_id); CREATE INDEX songs_status ON songs(status);
  CREATE TABLE song_promos (id INTEGER PRIMARY KEY AUTOINCREMENT, song_id TEXT NOT NULL, account_id TEXT NOT NULL, club TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL,
    price_kobo INTEGER NOT NULL, status TEXT NOT NULL, payment_ref TEXT, created_at INTEGER NOT NULL);
  CREATE INDEX promo_live ON song_promos(status, end_at); CREATE INDEX promo_song ON song_promos(song_id);
  `,
  // v11: the Eko Exchange (src/exchange.ts): stock holdings and trades, price pressure from real players, and shares in
  // player-owned businesses (units, offers, dividends paid when the owner empties the till)
  `
  CREATE TABLE holdings (account_id TEXT NOT NULL, sym TEXT NOT NULL, qty INTEGER NOT NULL, cost REAL NOT NULL, PRIMARY KEY (account_id, sym));
  CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, sym TEXT NOT NULL, side TEXT NOT NULL, qty INTEGER NOT NULL, price REAL NOT NULL, fee INTEGER NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX trades_acct ON trades(account_id, at);
  CREATE TABLE ex_pressure (sym TEXT PRIMARY KEY, p REAL NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE biz_shares (site TEXT NOT NULL, holder_id TEXT NOT NULL, units INTEGER NOT NULL, cost REAL NOT NULL DEFAULT 0, PRIMARY KEY (site, holder_id));
  CREATE TABLE biz_offers (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, seller_id TEXT NOT NULL, units INTEGER NOT NULL, price INTEGER NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX bo_site ON biz_offers(site);
  CREATE TABLE biz_payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, holder_id TEXT NOT NULL, amount INTEGER NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX bp_holder ON biz_payouts(holder_id, at);
  `
];
function openDb(file) {
  if (file !== ":memory:") mkdirSync2(dirname2(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}
function migrate(db) {
  const cur = db.pragma("user_version", { simple: true });
  for (let v = cur; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
var one = (db, sql, ...p) => db.prepare(sql).get(...p);
var all = (db, sql, ...p) => db.prepare(sql).all(...p);
var run = (db, sql, ...p) => db.prepare(sql).run(...p);

// server/src/accounts.ts
import { EventEmitter } from "node:events";

// server/src/auth.ts
import { createHmac, randomBytes as randomBytes2, scrypt, timingSafeEqual, createHash } from "node:crypto";
var HttpError = class extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
};
var SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
function scryptAsync(pw, salt, N, r, p, keylen) {
  return new Promise((res, rej) => scrypt(pw, salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 }, (e, k) => e ? rej(e) : res(k)));
}
async function hashPassword(pw) {
  const salt = randomBytes2(16);
  const k = await scryptAsync(pw, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${k.toString("base64")}`;
}
async function verifyPassword(pw, stored) {
  if (!stored) {
    await scryptAsync(pw, Buffer.alloc(16), SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
    return false;
  }
  const [alg, N, r, p, s, h] = stored.split("$");
  if (alg !== "scrypt") return false;
  const want = Buffer.from(h, "base64");
  const got = await scryptAsync(pw, Buffer.from(s, "base64"), +N, +r, +p, want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}
function checkPasswordStrength(pw, identifier = "") {
  if (typeof pw !== "string") return "Password is required.";
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 128) return "Password is too long.";
  if (identifier && pw.toLowerCase() === identifier.toLowerCase()) return "Password cannot be your email or phone.";
  if (/^(.)\1+$/.test(pw) || /^(12345678|password|11111111|qwertyui)/i.test(pw)) return "That password is too easy to guess.";
  return null;
}
var sha256 = (s) => createHash("sha256").update(s).digest("hex");
var b64u = (b) => Buffer.from(b).toString("base64url");
function signToken(secret2, c, days, now = Date.now()) {
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ ...c, iat: Math.floor(now / 1e3), exp: Math.floor(now / 1e3) + Math.round(days * 86400) }));
  const sig = createHmac("sha256", secret2).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verifyToken(secret2, token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const want = createHmac("sha256", secret2).update(`${parts[0]}.${parts[1]}`).digest();
  let got;
  try {
    got = Buffer.from(parts[2], "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (head.alg !== "HS256") return null;
    const c = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (!c.sub || !c.sid || typeof c.exp !== "number" || c.exp * 1e3 < now) return null;
    return c;
  } catch {
    return null;
  }
}
var EMAIL = /^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)*\.[a-z]{2,}$/;
function parseIdentifier(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length < 5 || s.length > 120) return null;
  if (s.includes("@")) {
    const e = s.toLowerCase();
    return EMAIL.test(e) ? { kind: "email", value: e } : null;
  }
  let d = s.replace(/[\s\-().]/g, "");
  if (/^00\d{8,15}$/.test(d)) d = "+" + d.slice(2);
  if (/^0\d{10}$/.test(d)) d = "+234" + d.slice(1);
  else if (/^234\d{10}$/.test(d)) d = "+" + d;
  else if (/^\d{10}$/.test(d) && /^[789]/.test(d)) d = "+234" + d;
  return /^\+\d{8,15}$/.test(d) ? { kind: "phone", value: d } : null;
}
var RateLimiter = class {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
  }
  hits = /* @__PURE__ */ new Map();
  /** true when the call is allowed */
  take(key, now = Date.now()) {
    const a = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (a.length >= this.limit) {
      this.hits.set(key, a);
      return false;
    }
    a.push(now);
    this.hits.set(key, a);
    if (this.hits.size > 2e4) this.sweep(now);
    return true;
  }
  sweep(now) {
    for (const [k, a] of this.hits) if (!a.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
  reset(key) {
    this.hits.delete(key);
  }
};
var randomId = () => randomBytes2(16).toString("hex");
var randomKey = () => randomBytes2(24).toString("base64url");

// v2/src/net/rules.ts
var ROSTER_IDS = ["survivor", "rogue", "trooper", "girl", "farah"];
var SKIN_COUNT = 6;
var NAME_MIN = 3;
var NAME_MAX = 16;
var RESERVED = ["admin", "administrator", "moderator", "staff", "support", "hustlelife", "hustle life", "system", "you"];
var BAD = ["fuck", "shit", "bitch", "nigg", "cunt", "dick", "pussy", "rape", "whore", "asshole", "fvck", "sex"];
function validateName(raw) {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (name.length < NAME_MIN) return { ok: false, error: `At least ${NAME_MIN} characters, abeg.` };
  if (name.length > NAME_MAX) return { ok: false, error: `${NAME_MAX} characters is the max.` };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'\-]*$/u.test(name)) return { ok: false, error: "Letters, numbers, space . _ - and ' only. Start with a letter or number." };
  if ((name.match(/[\p{L}\p{N}]/gu) ?? []).length < 3) return { ok: false, error: "Use at least 3 letters or numbers." };
  if (/(.)\1{4,}/.test(name)) return { ok: false, error: "Too many repeated characters." };
  const flat = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (RESERVED.includes(name.toLowerCase()) || RESERVED.includes(flat)) return { ok: false, error: "That name is reserved. Pick another." };
  if (BAD.some((b) => flat.includes(b))) return { ok: false, error: "Keep it clean. Pick another name." };
  return { ok: true, name };
}
var nameKey = (name) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
var clampSkin = (n) => Math.max(0, Math.min(SKIN_COUNT - 1, Math.round(Number.isFinite(n) ? n : 1)));
function cleanChat(raw, max = 200) {
  if (typeof raw !== "string") return null;
  let t = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length > max) t = t.slice(0, max);
  for (const b of BAD) t = t.replace(new RegExp(b.split("").join("[\\s._\\-*]*"), "gi"), (m) => "*".repeat(m.length));
  return t;
}
function plotPriceOf(area, zone, rich, cx, cz) {
  const distOshodi = Math.hypot(cx, cz) / 1e3;
  const base = 26e6 * Math.exp(-distOshodi / 14) + 45e5;
  const size = area / 648;
  const built = zone === "vacant" ? 1 : zone === "unfinished" ? 1.35 : 2.2 + rich * 2.5;
  return Math.round(base * size * built / 5e4) * 5e4;
}
var BANK_WITHDRAW_FEE = 0.015;
var withdrawNet = (a) => Math.round(a * (1 - BANK_WITHDRAW_FEE));
var INTERIOR_ZONE = [29e3, 29e3, 45e3, 45e3];
var inInteriorZone = (x, z) => x >= INTERIOR_ZONE[0] && x <= INTERIOR_ZONE[2] && z >= INTERIOR_ZONE[1] && z <= INTERIOR_ZONE[3];
var EARN_RULES = {
  loot: { perMin: 25e3, perHour: 25e4 },
  pickup: { perMin: 25e3, perHour: 25e4 },
  sale: { perMin: 25e3, perHour: 25e4 },
  mission: { perMin: 6e4, perHour: 6e5 },
  reward: { perMin: 25e3, perHour: 2e5 },
  fare: { perMin: 15e3, perHour: 18e4 },
  // okada / keke / danfo / ride-hailing trips
  work: { perMin: 4e4, perHour: 3e5 },
  // mechanic, teller, gigs, shifts
  street: { perMin: 3e4, perHour: 15e4 },
  // pickpocketing and other petty hustle
  race: { perMin: 4e5, perHour: 2e6 },
  // only after a race.enter escrow (server checks)
  bet: { perMin: 6e4, perHour: 3e5 },
  // small side bets with NPCs (match day, Ayo)
  hustle: { perMin: 15e5, perHour: 2e6 }
  // the yahoo crew's rare big hits (heavily flagged)
};
var SLOT_WEIGHTS = [30, 26, 20, 13, 7, 4];
var SLOT_PAY = [5, 8, 12, 25, 80, 300];
var SLOT_BETS = [500, 1e3, 5e3, 2e4];
function slotSpin(rand5, bet) {
  const roll = () => {
    let r = rand5() * SLOT_WEIGHTS.reduce((a, b) => a + b, 0);
    for (let i = 0; i < SLOT_WEIGHTS.length; i++) {
      if ((r -= SLOT_WEIGHTS[i]) < 0) return i;
    }
    return 0;
  };
  const reels = [roll(), roll(), roll()];
  const win = reels[0] === reels[1] && reels[1] === reels[2] ? bet * SLOT_PAY[reels[0]] : reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2] ? bet : 0;
  return { reels, win };
}
var ROULETTE_RED = /* @__PURE__ */ new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
var ROULETTE_KEYS = /^(n([0-9]|[1-2][0-9]|3[0-6])|red|black|odd|even|low|high|d1|d2|d3)$/;
function roulettePays(k, n) {
  if (k === "n" + n) return 36;
  if (n === 0) return 0;
  const red = ROULETTE_RED.has(n);
  if (k === "red" && red) return 2;
  if (k === "black" && !red) return 2;
  if (k === "odd" && n % 2) return 2;
  if (k === "even" && !(n % 2)) return 2;
  if (k === "low" && n <= 18) return 2;
  if (k === "high" && n > 18) return 2;
  if (k === "d1" && n <= 12) return 3;
  if (k === "d2" && n > 12 && n <= 24) return 3;
  if (k === "d3" && n > 24) return 3;
  return 0;
}
var bjValue = (h) => {
  let t = 0, a = 0;
  for (const c of h) {
    t += c.r === 0 ? 11 : c.r >= 9 ? 10 : c.r + 1;
    if (c.r === 0) a++;
  }
  while (t > 21 && a) {
    t -= 10;
    a--;
  }
  return t;
};
function bjShoe(rand5) {
  const d = [];
  for (let k = 0; k < 4; k++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j2 = Math.floor(rand5() * (i + 1));
    [d[i], d[j2]] = [d[j2], d[i]];
  }
  return d;
}
var BjTable = class {
  constructor(rand5) {
    this.rand = rand5;
  }
  shoe = [];
  ph = [];
  dh = [];
  bet = 0;
  phase = "idle";
  net = 0;
  msg = "";
  draw() {
    if (this.shoe.length < 30) this.shoe = bjShoe(this.rand);
    return this.shoe.pop();
  }
  deal(bet) {
    this.bet = bet;
    this.ph = [this.draw(), this.draw()];
    this.dh = [this.draw(), this.draw()];
    this.phase = "play";
    this.net = 0;
    this.msg = "";
    const p = bjValue(this.ph), d = bjValue(this.dh);
    if (p === 21 || d === 21) return this.finish(p === 21 && d === 21 ? 0 : p === 21 ? Math.floor(bet * 1.5) : -bet, p === 21 && d === 21 ? "BOTH BLACKJACK \xB7 PUSH" : p === 21 ? "BLACKJACK!" : "DEALER BLACKJACK");
    return this;
  }
  hit() {
    if (this.phase !== "play") return this;
    this.ph.push(this.draw());
    const p = bjValue(this.ph);
    if (p > 21) return this.finish(-this.bet, "BUST");
    if (p === 21) return this.stand();
    return this;
  }
  double() {
    if (this.phase !== "play" || this.ph.length !== 2) return this;
    this.bet *= 2;
    this.ph.push(this.draw());
    if (bjValue(this.ph) > 21) return this.finish(-this.bet, "BUST");
    return this.stand();
  }
  stand() {
    if (this.phase !== "play") return this;
    while (bjValue(this.dh) < 17) this.dh.push(this.draw());
    const p = bjValue(this.ph), d = bjValue(this.dh);
    return d > 21 || p > d ? this.finish(this.bet, d > 21 ? "DEALER BUSTS \xB7 YOU WIN" : "YOU WIN") : p === d ? this.finish(0, "PUSH") : this.finish(-this.bet, "DEALER WINS");
  }
  finish(net, msg) {
    this.net = net;
    this.msg = msg;
    this.phase = "done";
    return this;
  }
  view() {
    return { ph: this.ph, dh: this.phase === "play" ? [this.dh[0]] : this.dh, phase: this.phase, net: this.net, msg: this.msg, bet: this.bet };
  }
};
var WORLD_SPEED = 30;
var WORLD_START_HOUR = 7.2;
var worldHours = (ms) => WORLD_START_HOUR + ms / 1e3 * WORLD_SPEED / 3600;
var BIZ_TYPES = [
  { id: "kiosk", name: "Provision kiosk", sign: "PROVISION STORE", price: 25e4, gross: 12e3, upkeep: 2e3, restock: 5e3, till: 45e3, open: [7, 22], sells: { label: "Biscuit and a cold Malta", price: 700, gain: { hunger: 18, fun: 6 }, mins: 2 }, blurb: "Sweets, Indomie, Malta, recharge card. Small but steady." },
  { id: "pos", name: "POS stand", sign: "POS \xB7 CASH OUT", price: 4e5, gross: 18e3, upkeep: 3e3, restock: 7e3, till: 7e4, open: [8, 21], sells: { label: "Cash out (bank to hand, \u20A6300 charge)", price: 300, gain: {}, mins: 1 }, blurb: "Everybody needs cash in hand. Area boys know that too." },
  { id: "salon", name: "Barbing salon", sign: "BARBING SALON", price: 9e5, gross: 34e3, upkeep: 8e3, restock: 8e3, till: 13e4, open: [9, 21], sells: { label: "Low cut with sharp line-up", price: 2500, gain: { hygiene: 25, fun: 10, social: 15 }, mins: 6 }, blurb: "Clippers, gist and generator noise. Busy on Saturdays." },
  { id: "buka", name: "Buka", sign: "BUKA \xB7 FOOD IS READY", price: 15e5, gross: 56e3, upkeep: 13e3, restock: 2e4, till: 21e4, open: [7, 20], sells: { label: "Amala, ewedu and two meat", price: 2200, gain: { hunger: 60, comfort: 10 }, mins: 6 }, blurb: "Amala, rice, swallow. Feed the street and the street pays." },
  { id: "carwash", name: "Car wash", sign: "CAR WASH", price: 25e5, gross: 9e4, upkeep: 2e4, restock: 12e3, till: 34e4, open: [8, 19], sells: { label: "Wash and vacuum", price: 3e3, gain: { comfort: 15, fun: 5 }, mins: 5 }, blurb: "Hose, foam, boys with rags. Big money, big wages." }
];
var BIZ_MAX = 4;
var BIZ_STOCK_DAY = 40;
var BIZ_REACH = 25;
var bizType = (id) => BIZ_TYPES.find((t) => t.id === id);
function sitePos(id) {
  const m = /^s:(-?\d{1,6}):(-?\d{1,6})$/.exec(id);
  return m ? { x: +m[1], z: +m[2] } : null;
}
function siteTraffic(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 0.85 + (h >>> 0) % 41 / 100;
}
function bizStep(b, t, site, to, rand5) {
  const from = Math.max(b.hour, to - 24 * 14);
  const hrs = t.open[1] - t.open[0];
  const traffic = siteTraffic(site);
  for (let h = Math.floor(from) + 1; h <= Math.floor(to); h++) {
    const hod = (h % 24 + 24) % 24, day = Math.floor(h / 24);
    const shut = b.debt >= t.upkeep * 3;
    if (!shut && hod >= t.open[0] && hod < t.open[1] && b.stock > 0) {
      const rush = hod >= 12 && hod < 14 ? 1.3 : hod >= 17 && hod < 19 ? 1.25 : 0.88;
      b.till = Math.min(t.till, b.till + t.gross / hrs * traffic * rush);
      b.stock = Math.max(0, b.stock - BIZ_STOCK_DAY / hrs);
    }
    if (hod === 18) {
      const pay = t.upkeep;
      const p = Math.min(pay, b.till);
      b.till -= p;
      b.debt += pay - p;
      if (b.debt > 0 && b.till > 0) {
        const q = Math.min(b.debt, b.till);
        b.debt -= q;
        b.till -= q;
      }
      const r = rand5();
      const strike2 = b.debt >= t.upkeep * 3;
      if (r < 0.12) {
        const n = Math.min(b.till, Math.round(t.gross * 0.08));
        b.till -= n;
        b.log.push({ d: day, t: "Area boys came for their settlement.", n: -n });
      } else if (r < 0.18) {
        const n = Math.min(b.till, 2e3);
        b.till -= n;
        b.log.push({ d: day, t: "Council men collected signboard levy.", n: -n });
      } else if (r < 0.3 && !strike2 && b.stock > 0) {
        const n = Math.round(t.gross * 0.15);
        b.till = Math.min(t.till, b.till + n);
        b.log.push({ d: day, t: "A big customer bought plenty.", n });
      } else b.log.push({ d: day, t: strike2 ? "Staff did not come. They want their money." : b.stock <= 0 ? "Nothing to sell today. Restock." : "Staff and light paid.", n: -p });
      if (b.log.length > 8) b.log.splice(0, b.log.length - 8);
    }
  }
  b.hour = Math.max(b.hour, Math.floor(to));
  b.till = Math.round(b.till);
  b.debt = Math.round(b.debt);
  return b;
}
var GRID = {
  x0: -22e3,
  z0: -2e4,
  cell: 4e3,
  w: 9,
  h: 8,
  of(x, z) {
    const i = Math.max(0, Math.min(8, Math.floor((x + 22e3) / 4e3))), j2 = Math.max(0, Math.min(7, Math.floor((z + 2e4) / 4e3)));
    return i + j2 * 9;
  },
  center(f) {
    return { x: -22e3 + f % 9 * 4e3 + 2e3, z: -2e4 + Math.floor(f / 9) * 4e3 + 2e3 };
  }
};
var BAND_HOURS = { A: 20, B: 15, C: 10 };
var gh = (a, b) => {
  let h = Math.imul(a + 40503, 2654435761) ^ Math.imul(b + 34283, 2246822519);
  h ^= h >>> 15;
  h = Math.imul(h, 2654435761);
  return (h ^ h >>> 13) >>> 0;
};
function scheduledOn(f, band, hours) {
  const day = Math.floor(hours / 24), hod = (hours % 24 + 24) % 24;
  const off = 24 - BAND_HOURS[band];
  const h = gh(f, day);
  const a = Math.ceil(off / 2), b = off - a;
  const s1 = h % 24, s2 = (s1 + 10 + (h >>> 8) % 5) % 24;
  const inB = (s, len) => len > 0 && (hod - s + 24) % 24 < len;
  return !(inB(s1, a) || inB(s2, b));
}
function generation(hours, totalLoad) {
  const day = Math.floor(hours / 24);
  const h = gh(day, 77);
  const gas = 0.55 + h % 1e3 / 1e3 * 0.35;
  return Math.round(totalLoad * gas);
}
var GRID_OVERRIDE_HOURS = 3;
var h32 = (a, b) => {
  let h = Math.imul(a ^ 1540483477, 2654435761) ^ Math.imul(b + 17, 2246822519);
  h ^= h >>> 15;
  return h >>> 0;
};
function gridCollapsed(h) {
  const day = Math.floor(h / 24);
  const r = h32(day, 99);
  if (r % 12 !== 0) return false;
  const start = (r >>> 8) % 24, len = 1 + (r >>> 16) % 3;
  const hod = h % 24;
  return hod >= start && hod < start + len;
}
function gridState(feeders, h, o = {}) {
  const on2 = new Array(GRID.w * GRID.h).fill("0");
  const by = {};
  if (h < (o.collapseUntil ?? 0) || gridCollapsed(h)) return { on: on2.join(""), gen: 0, load: 0, collapse: true };
  const total = feeders.reduce((s, f) => s + f.load, 0);
  const gen = Math.round(generation(h, total) * (o.genScale ?? 1));
  const want = feeders.map((f) => {
    const fo = o.forced?.get(f.i), op0 = o.override?.get(f.i);
    const op = op0 && h >= (op0.from ?? -Infinity) ? op0 : void 0;
    if (op && !fo) by[f.i] = op.by;
    return { f, v: fo ? fo.on : op ? op.on : scheduledOn(f.i, f.band, h), pri: fo ? 0 : op ? 1 : f.band === "A" ? 2 : f.band === "B" ? 3 : 4, r: h32(f.i, Math.floor(h / 24)) };
  });
  let load = want.filter((w) => w.v).reduce((s, w) => s + w.f.load, 0);
  for (const w of want.filter((x) => x.v && x.pri > 0).sort((a, b) => b.pri - a.pri || a.r - b.r)) {
    if (load <= gen) break;
    w.v = false;
    load -= w.f.load;
  }
  for (const w of want) if (w.v) on2[w.f.i] = "1";
  return { on: on2.join(""), gen, load, collapse: false, by };
}
var PAY_CURRENCY = "NGN";
var PAY_MIN_KOBO = 1e4;
var PAY_MAX_KOBO = 5e8;
var koboOf = (naira) => Math.round(naira * 100);
var nairaOf = (kobo) => Math.round(kobo) / 100;
var payRefOk = (r) => typeof r === "string" && /^hl_[a-z0-9]{20}$/.test(r);
function parseSku(sku) {
  if (typeof sku !== "string" || sku.length > 100) return null;
  const m = /^([a-z]{2,12}):([A-Za-z0-9._-]{1,80})$/.exec(sku);
  return m ? { kind: m[1], id: m[2] } : null;
}
var dayMs = (d, end) => {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(d)) return NaN;
  const t = Date.parse(d.length === 10 ? d + "T00:00:00+01:00" : d);
  return end && d.length === 10 ? t + 864e5 : t;
};
function iapLive(it, now) {
  if (it.enabled === false) return false;
  const f = dayMs(it.from ?? it.availableFrom, false), t = dayMs(it.to ?? it.availableTo, true);
  return !(f > now) && !(t <= now);
}
var deliverable = (g) => !!g && Object.keys(g).length > 0 && Object.keys(g).every((k) => k === "cash" || k === "bank") && (Number(g.cash) > 0 || Number(g.bank) > 0);
function iapCatalog(items, now) {
  const sales = items.filter((s) => s.type === "sale" && iapLive(s, now));
  return items.filter((it) => it.type !== "promo" && it.type !== "sale" && iapLive(it, now) && Number.isInteger(it.priceNGN) && (it.priceNGN ?? 0) > 0 && deliverable(it.grants)).map((it) => {
    const off = Math.max(0, ...sales.filter((s) => (s.itemIds ?? []).includes(it.id)).map((s) => Math.min(90, s.percentOff ?? 0)));
    const price = Math.max(100, Math.round(it.priceNGN * (100 - off) / 100));
    return { id: it.id, name: it.name ?? it.id, desc: it.desc ?? "", tag: it.tag ?? "", priceNGN: price, wasNGN: off ? it.priceNGN : 0, grants: { cash: Math.max(0, Math.floor(Number(it.grants?.cash) || 0)), bank: Math.max(0, Math.floor(Number(it.grants?.bank) || 0)) }, limit: it.limitPerAccount ?? 0, sort: it.sort ?? 99 };
  }).sort((a, b) => a.sort - b.sort);
}
function findPromo(items, code, itemId, now) {
  if (typeof code !== "string" || !code.trim()) return null;
  const c = code.trim().toUpperCase();
  return items.find((x) => x.type === "promo" && x.code === c && iapLive(x, now) && (!x.appliesTo || x.appliesTo.includes("*") || x.appliesTo.includes(itemId))) ?? null;
}
function promoPrice(p, priceNGN) {
  let n = priceNGN;
  if (p.percentOff) n = Math.round(n * (100 - Math.min(100, p.percentOff)) / 100);
  if (p.amountOffNGN) n -= p.amountOffNGN;
  return Math.max(100, Math.round(n));
}
var AD_BASE = 4500;
var AD_TIER = { street: 1, standard: 1.8, prime: 3.2 };
function adPixels(b) {
  const k = Math.min(64, 2048 / Math.max(b.w, b.h));
  return { w: Math.round(b.w * k), h: Math.round(b.h * k) };
}
var AD_DAYS = [1, 3, 7, 14, 30];
function adDiscount(days) {
  return days >= 30 ? 0.25 : days >= 14 ? 0.15 : days >= 7 ? 0.1 : 0;
}
var round100 = (n) => Math.max(100, Math.round(n / 100) * 100);
function boardDayRate(b) {
  const size = Math.min(2.5, Math.max(0.8, Math.sqrt(b.w * b.h / 40)));
  return round100(AD_BASE * (AD_TIER[b.tier] ?? 1) * size * ((b.slots ?? 1) > 1 ? 0.5 : 1));
}
var DRONE_SPOTS = [
  { id: "oshodi", name: "Oshodi Interchange", x: 900, z: -280, k: 1 },
  { id: "ikeja", name: "Ikeja, by the mall", x: 1640, z: -6800, k: 1.1 },
  { id: "surulere", name: "Surulere", x: 1560, z: 5770, k: 1 },
  { id: "yaba", name: "Yaba", x: 3060, z: 4660, k: 1.1 },
  { id: "lagoon", name: "Over the lagoon, Third Mainland Bridge", x: 5770, z: 7380, k: 1.5 },
  { id: "ikoyi", name: "Ikoyi, by Falomo", x: 9200, z: 11300, k: 1.4 }
];
var DRONE_DAY = 35e4;
var BLIMP_DAY = 18e4;
var BLIMPS = 3;
var DRONE_TEXT_MAX = 28;
function adQuote(kind, days, opt = {}) {
  const d = Math.max(1, Math.min(60, Math.round(days)));
  const day = kind === "board" ? opt.board ? boardDayRate(opt.board) : 0 : kind === "drone" ? round100(DRONE_DAY * (DRONE_SPOTS.find((s) => s.id === opt.spot)?.k ?? 1)) : BLIMP_DAY;
  const gross = day * d;
  const off = adDiscount(d);
  return { day, days: d, gross, discount: off, total: round100(gross * (1 - off)) };
}
function lagosDay(ms) {
  return new Date(ms + 36e5).toISOString().slice(0, 10);
}
function lagosDayStart(day) {
  return Date.parse(day + "T00:00:00Z") - 36e5;
}
var DRUGS = {
  paracetamol: { name: "Paracetamol", price: 400, eases: ["fever", "headache", "pain"] },
  antimalarial: { name: "Antimalarial (ACT)", price: 3500, eases: ["fever", "chills"] },
  antibiotics: { name: "Antibiotics", price: 4800, eases: ["fever"] },
  ors: { name: "ORS sachets", price: 600, eases: ["runs", "weak"] },
  antacid: { name: "Antacid", price: 900, eases: ["pain"] },
  bp_pills: { name: "BP tablets", price: 2600, eases: ["headache"] },
  eyedrops: { name: "Eye drops", price: 1500, eases: ["redeyes"] },
  cough_syrup: { name: "Cough syrup", price: 1800, eases: ["cough", "sneeze"] }
};
var ILLNESSES = {
  malaria: { id: "malaria", name: "Malaria", spreads: false, symptoms: ["fever", "chills", "headache", "weak"], hours: 72, worsens: true, drug: "antimalarial", clinic: 9e3, walk: 0.88, how: "Mosquito bites. Nights outside, rain and standing water." },
  typhoid: { id: "typhoid", name: "Typhoid", spreads: false, symptoms: ["fever", "pain", "weak"], hours: 96, worsens: true, drug: "antibiotics", clinic: 14e3, walk: 0.9, how: "Dirty water and food that was not cooked well." },
  food: { id: "food", name: "Food poisoning", spreads: false, symptoms: ["cramps", "runs", "weak"], hours: 18, drug: "ors", clinic: 5e3, walk: 0.85, how: "Food that has been sitting in the sun." },
  ulcer: { id: "ulcer", name: "Ulcer", spreads: false, symptoms: ["pain"], hours: 240, drug: "antacid", clinic: 12e3, walk: 0.96, how: "Skipping meals and stress, again and again." },
  bp: { id: "bp", name: "High blood pressure", spreads: false, symptoms: ["headache"], hours: 480, drug: "bp_pills", clinic: 15e3, walk: 0.97, how: "Stress, salt, no sleep. Lagos things." },
  flu: { id: "flu", name: "Flu", spreads: true, spread: 0.035, symptoms: ["fever", "sneeze", "weak"], hours: 36, drug: "paracetamol", clinic: 5e3, walk: 0.94, how: "Catching it from someone close to you." },
  cough: { id: "cough", name: "Harmattan cough", spreads: true, spread: 0.03, symptoms: ["cough"], hours: 48, drug: "cough_syrup", clinic: 4500, walk: 0.98, how: "Dust, cold mornings, and the person coughing beside you." },
  apollo: { id: "apollo", name: "Apollo (red eye)", spreads: true, spread: 0.05, symptoms: ["redeyes"], hours: 30, drug: "eyedrops", clinic: 4e3, walk: 1, how: "Anyone with Apollo who stands close. Do not touch your eyes." },
  cholera: { id: "cholera", name: "Cholera", spreads: true, spread: 0.012, symptoms: ["runs", "cramps", "weak"], hours: 30, worsens: true, drug: "ors", clinic: 18e3, walk: 0.8, how: "Dirty water, and the hands of people who have it." }
};
var TRAITS = {
  slow: { name: "Slow walker", says: "You walk a little slower than most people." },
  myopia: { name: "Short sight", says: "Things far away and at the edge of your eyes are blurry.", fix: { name: "Glasses", price: 45e3, where: "optician" } },
  stomach: { name: "Weak stomach", says: "Street food catches you more often." },
  sleeper: { name: "Light sleeper", says: "You get less from a night of sleep." },
  breath: { name: "Short breath", says: "Running tires you out faster.", fix: { name: "Inhaler", price: 12e3, where: "hospital" } },
  clumsy: { name: "Butterfingers", says: "Your phone falls from your hand more than it should." },
  sweaty: { name: "Sweats a lot", says: "You need a bath more often." }
};
var TRAIT_IDS = Object.keys(TRAITS);
var HOSPITAL_BILL = { general: 25e3, teaching: 35e3, private: 15e4 };
function hospitalKind(name) {
  return /teaching|luth|lasuth/i.test(name) ? "teaching" : /specialist|private|clinic/i.test(name) ? "private" : "general";
}
var DEBT_GARNISH = 0.5;
function luckOf(karma, seed, ms) {
  const day = ms / 864e5;
  const tide = Math.sin((day / 3.3 + seed) * Math.PI * 2) * 22 + Math.sin((day / 0.71 + seed * 7) * Math.PI * 2) * 8;
  return Math.max(-100, Math.min(100, 60 * Math.tanh(karma / 150) + tide));
}
function carrierChance(luck) {
  return Math.max(0.05, Math.min(0.75, 0.25 + luck / 160));
}
var PHONE_MODELS = {
  kpakam: { id: "kpakam", name: "Kpakam K2", kind: "Small phone", price: 18e3, tough: 1.5, scale: 0.84, basic: true, blurb: "Calls, texts, bank, map. Falls from a storey building and keeps working." },
  gidi: { id: "gidi", name: "Gidi Neo 8", kind: "Phone", price: 95e3, tough: 1, scale: 1, blurb: "Every app. What most of Lagos carries." },
  eko: { id: "eko", name: "Eko Pro Max", kind: "Flagship", price: 65e4, tough: 0.75, scale: 1.05, blurb: "Big, bright and expensive. The glass knows it." },
  tab: { id: "tab", name: "Tab Lagos 10", kind: "Tablet", price: 24e4, tough: 0.65, scale: 1.32, blurb: "A big screen for business, MyAds and matches." }
};
var REPAIR_SHARE = [0, 0.12, 0.25, 0.4];
var PHONE_CLEAN_PRICE = 7500;
var CLONE_DAY_LIMIT = 5e4;

// server/src/accounts.ts
function publicAccount(a) {
  return { id: a.id, email: a.email, phone: a.phone, guest: !!a.is_guest, role: a.role, createdAt: a.created_at, lastLogin: a.last_login, banned: banState(a).banned, muted: !!(a.mute_until && (a.mute_until < 0 || a.mute_until > Date.now())) };
}
function banState(a, now = Date.now()) {
  const u = a.ban_until;
  if (u === null || u === void 0) return { banned: false };
  if (u === -1) return { banned: true, until: null, reason: a.ban_reason ?? "Banned" };
  if (u > now) return { banned: true, until: u, reason: a.ban_reason ?? "Suspended" };
  return { banned: false };
}
function publicProfile(p, accountId = p.account_id) {
  return { v: 1, accountId, name: p.name, model: p.model, skin: p.skin, outfit: p.outfit, xp: p.xp, createdAt: p.created_at, updatedAt: p.updated_at };
}
var Accounts = class extends EventEmitter {
  constructor(db, cfg) {
    super();
    this.db = db;
    this.cfg = cfg;
  }
  byId(id) {
    return one(this.db, "SELECT * FROM accounts WHERE id=?", id);
  }
  byIdent(kind, value) {
    return one(this.db, `SELECT * FROM accounts WHERE ${kind}=?`, value);
  }
  profile(id) {
    return one(this.db, "SELECT * FROM profiles WHERE account_id=?", id);
  }
  profileByName(name) {
    return one(this.db, "SELECT * FROM profiles WHERE name_key=?", nameKey(name));
  }
  list(opts = {}) {
    const q = opts.q ? `%${opts.q.toLowerCase()}%` : null;
    const rows = all(
      this.db,
      `SELECT a.*, p.name AS name FROM accounts a LEFT JOIN profiles p ON p.account_id=a.id
       WHERE (@q IS NULL OR lower(a.email) LIKE @q OR a.phone LIKE @q OR lower(p.name) LIKE @q OR a.id LIKE @q) AND (@role IS NULL OR a.role=@role)
       ORDER BY a.created_at DESC LIMIT @limit OFFSET @offset`,
      { q, role: opts.role ?? null, limit: Math.min(500, opts.limit ?? 50), offset: opts.offset ?? 0 }
    );
    return rows.map((r) => ({ ...publicAccount(r), name: r.name, banReason: r.ban_reason, banUntil: r.ban_until }));
  }
  // -------------------------------------------------------------------------------- sessions
  createSession(accountId, ip, ua = "") {
    const now = Date.now();
    const sid = randomId();
    const expires = now + this.cfg.tokenDays * 864e5;
    run(this.db, "INSERT INTO sessions(id,account_id,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?)", sid, accountId, now, expires, ip, ua.slice(0, 200));
    return { token: signToken(this.cfg.jwtSecret, { sub: accountId, sid }, this.cfg.tokenDays, now), sid, expires };
  }
  /** Resolves a bearer token to a live account, or null. Does not check bans (callers decide how to react). */
  authenticate(token) {
    const c = verifyToken(this.cfg.jwtSecret, token);
    if (!c) return null;
    const s = one(this.db, "SELECT id,account_id,expires_at,revoked FROM sessions WHERE id=?", c.sid);
    if (!s || s.revoked || s.expires_at < Date.now() || s.account_id !== c.sub) return null;
    const account = this.byId(c.sub);
    if (!account) return null;
    return { account, sid: s.id };
  }
  revokeSession(sid) {
    run(this.db, "UPDATE sessions SET revoked=1 WHERE id=?", sid);
  }
  revokeAll(accountId, exceptSid) {
    run(this.db, "UPDATE sessions SET revoked=1 WHERE account_id=? AND id<>?", accountId, exceptSid ?? "");
  }
  purgeSessions() {
    run(this.db, "DELETE FROM sessions WHERE expires_at<? OR revoked=1 AND created_at<?", Date.now(), Date.now() - 7 * 864e5);
  }
  // -------------------------------------------------------------------------------- sign up and in
  async signup(identRaw, password, ip, ua = "") {
    const ident = parseIdentifier(identRaw);
    if (!ident) throw new HttpError(400, "Enter a valid email or phone number.");
    const weak = checkPasswordStrength(password, ident.value);
    if (weak) throw new HttpError(400, weak);
    if (this.byIdent(ident.kind, ident.value)) throw new HttpError(409, ident.kind === "email" ? "That email already has an account. Log in instead." : "That phone number already has an account. Log in instead.");
    const id = randomId();
    const now = Date.now();
    const hash2 = await hashPassword(password);
    try {
      run(this.db, `INSERT INTO accounts(id,${ident.kind},pw_hash,is_guest,role,created_at,last_login,last_ip) VALUES(?,?,?,0,'player',?,?,?)`, id, ident.value, hash2, now, now, ip);
    } catch (e) {
      if (/UNIQUE/.test(String(e))) throw new HttpError(409, "That account already exists.");
      throw e;
    }
    const acc = this.byId(id);
    this.emit("signup", acc);
    return { account: acc, ...this.createSession(id, ip, ua) };
  }
  async login(identRaw, password, ip, ua = "") {
    const ident = parseIdentifier(identRaw);
    const acc = ident ? this.byIdent(ident.kind, ident.value) : void 0;
    const ok = await verifyPassword(typeof password === "string" ? password : "", acc?.pw_hash);
    if (!acc || !ok) throw new HttpError(401, "Wrong email, phone or password.");
    const b = banState(acc);
    if (b.banned) throw new HttpError(403, b.reason, { code: "banned", until: b.until });
    run(this.db, "UPDATE accounts SET last_login=?, last_ip=? WHERE id=?", Date.now(), ip, acc.id);
    this.emit("login", acc, { ip });
    return { account: this.byId(acc.id), ...this.createSession(acc.id, ip, ua) };
  }
  /** Guest: no password. The client keeps the returned guestKey to come back to the same account. */
  async guest(guestKey, ip, ua = "") {
    if (!this.cfg.guestAccounts) throw new HttpError(403, "Guest play is switched off. Sign up with email or phone.");
    if (typeof guestKey === "string" && guestKey.length >= 16 && guestKey.length < 100) {
      const acc2 = one(this.db, "SELECT * FROM accounts WHERE guest_key_hash=? AND is_guest=1", sha256(guestKey));
      if (acc2) {
        const b = banState(acc2);
        if (b.banned) throw new HttpError(403, b.reason, { code: "banned", until: b.until });
        run(this.db, "UPDATE accounts SET last_login=?, last_ip=? WHERE id=?", Date.now(), ip, acc2.id);
        this.emit("login", acc2, { ip });
        return { account: acc2, guestKey, ...this.createSession(acc2.id, ip, ua) };
      }
    }
    const id = randomId();
    const key = randomKey();
    const now = Date.now();
    run(this.db, `INSERT INTO accounts(id,is_guest,guest_key_hash,role,created_at,last_login,last_ip) VALUES(?,1,?,'player',?,?,?)`, id, sha256(key), now, now, ip);
    const acc = this.byId(id);
    this.emit("signup", acc);
    return { account: acc, guestKey: key, ...this.createSession(id, ip, ua) };
  }
  /** Turn a guest into a full account, keeping the profile, cash and land. */
  async upgrade(accountId, identRaw, password) {
    const acc = this.byId(accountId);
    if (!acc) throw new HttpError(404, "No such account.");
    if (!acc.is_guest) throw new HttpError(400, "This account is already registered.");
    const ident = parseIdentifier(identRaw);
    if (!ident) throw new HttpError(400, "Enter a valid email or phone number.");
    const weak = checkPasswordStrength(password, ident.value);
    if (weak) throw new HttpError(400, weak);
    if (this.byIdent(ident.kind, ident.value)) throw new HttpError(409, "That email or phone already has an account. Log in to it instead.");
    const hash2 = await hashPassword(password);
    try {
      run(this.db, `UPDATE accounts SET ${ident.kind}=?, pw_hash=?, is_guest=0, guest_key_hash=NULL WHERE id=?`, ident.value, hash2, accountId);
    } catch (e) {
      if (/UNIQUE/.test(String(e))) throw new HttpError(409, "That email or phone already has an account.");
      throw e;
    }
    return this.byId(accountId);
  }
  async changePassword(accountId, oldPw, newPw, keepSid) {
    const acc = this.byId(accountId);
    if (!acc) throw new HttpError(404, "No such account.");
    if (!await verifyPassword(typeof oldPw === "string" ? oldPw : "", acc.pw_hash)) throw new HttpError(401, "Current password is wrong.");
    const weak = checkPasswordStrength(newPw, acc.email ?? acc.phone ?? "");
    if (weak) throw new HttpError(400, weak);
    run(this.db, "UPDATE accounts SET pw_hash=? WHERE id=?", await hashPassword(newPw), accountId);
    this.revokeAll(accountId, keepSid);
  }
  /** Admin tool: set a new password without the old one (the player gets a temporary one out of band). */
  async adminSetPassword(accountId, newPw) {
    const weak = checkPasswordStrength(newPw);
    if (weak) throw new HttpError(400, weak);
    run(this.db, "UPDATE accounts SET pw_hash=? WHERE id=?", await hashPassword(newPw), accountId);
    this.revokeAll(accountId);
  }
  setRole(accountId, role) {
    run(this.db, "UPDATE accounts SET role=? WHERE id=?", role, accountId);
  }
  /** Make sure the configured administrator exists (called at boot). */
  async ensureAdmin(email, password) {
    if (!email || !password) return null;
    const ident = parseIdentifier(email);
    if (!ident || ident.kind !== "email") return null;
    let acc = this.byIdent("email", ident.value);
    if (!acc) {
      const id = randomId();
      const now = Date.now();
      run(this.db, `INSERT INTO accounts(id,email,pw_hash,is_guest,role,created_at) VALUES(?,?,?,0,'admin',?)`, id, ident.value, await hashPassword(password), now);
      acc = this.byId(id);
    } else if (acc.role !== "admin") this.setRole(acc.id, "admin");
    return acc;
  }
  // -------------------------------------------------------------------------------- bans and mutes
  ban(accountId, o) {
    const acc = this.byId(accountId);
    if (!acc) throw new HttpError(404, "No such account.");
    const until = o.until === null || o.until === void 0 ? -1 : o.until;
    const now = Date.now();
    run(this.db, "UPDATE accounts SET ban_until=?, ban_reason=? WHERE id=?", until, o.reason, accountId);
    run(this.db, "INSERT INTO bans(account_id,by_id,reason,created_at,until) VALUES(?,?,?,?,?)", accountId, o.by ?? null, o.reason, now, until);
    this.revokeAll(accountId);
    this.emit("ban", this.byId(accountId), { reason: o.reason, until: until === -1 ? null : until, by: o.by ?? null });
  }
  unban(accountId, by) {
    run(this.db, "UPDATE accounts SET ban_until=NULL, ban_reason=NULL WHERE id=?", accountId);
    run(this.db, "UPDATE bans SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL", Date.now(), accountId);
    void by;
    this.emit("unban", this.byId(accountId));
  }
  banHistory(accountId) {
    return all(this.db, "SELECT * FROM bans WHERE account_id=? ORDER BY id DESC", accountId);
  }
  mute(accountId, until) {
    run(this.db, "UPDATE accounts SET mute_until=? WHERE id=?", until === null ? -1 : until, accountId);
    this.emit("mute", this.byId(accountId));
  }
  unmute(accountId) {
    run(this.db, "UPDATE accounts SET mute_until=NULL WHERE id=?", accountId);
  }
  isMuted(a) {
    return !!a.mute_until && (a.mute_until < 0 || a.mute_until > Date.now());
  }
  // -------------------------------------------------------------------------------- profile: exactly one per account
  createProfile(accountId, d) {
    if (this.profile(accountId)) throw new HttpError(409, "This account already has a profile.", { code: "profile_exists" });
    const n = validateName(String(d.name ?? ""));
    if (!n.ok) throw new HttpError(400, n.error);
    const model = String(d.model);
    if (!ROSTER_IDS.includes(model)) throw new HttpError(400, "Unknown hustler.");
    const outfit = String(d.outfit ?? "street").slice(0, 32).replace(/[^\w\-]/g, "");
    const skin = clampSkin(Number(d.skin));
    const now = Date.now();
    try {
      run(this.db, "INSERT INTO profiles(account_id,name,name_key,model,skin,outfit,xp,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?)", accountId, n.name, nameKey(n.name), model, skin, outfit || "street", now, now);
    } catch (e) {
      if (/name_key/.test(String(e))) throw new HttpError(409, "That name is taken. Pick another.", { code: "name_taken" });
      if (/UNIQUE|PRIMARY/.test(String(e))) throw new HttpError(409, "This account already has a profile.", { code: "profile_exists" });
      throw e;
    }
    const p = this.profile(accountId);
    this.emit("profile", p);
    return p;
  }
  updateProfile(accountId, patch) {
    const cur = this.profile(accountId);
    if (!cur) throw new HttpError(404, "No profile to update.");
    let name = cur.name, key = cur.name_key, model = cur.model, skin = cur.skin, outfit = cur.outfit, xp = cur.xp;
    if (patch.name !== void 0) {
      const n = validateName(String(patch.name));
      if (!n.ok) throw new HttpError(400, n.error);
      name = n.name;
      key = nameKey(n.name);
    }
    if (patch.model !== void 0) {
      if (!ROSTER_IDS.includes(String(patch.model))) throw new HttpError(400, "Unknown hustler.");
      model = String(patch.model);
    }
    if (patch.skin !== void 0) skin = clampSkin(Number(patch.skin));
    if (patch.outfit !== void 0) outfit = String(patch.outfit).slice(0, 32).replace(/[^\w\-]/g, "") || "street";
    if (patch.xp !== void 0) {
      const nx = Math.floor(Number(patch.xp));
      if (Number.isFinite(nx) && nx >= cur.xp && nx - cur.xp <= 5e3) xp = nx;
    }
    try {
      run(this.db, "UPDATE profiles SET name=?, name_key=?, model=?, skin=?, outfit=?, xp=?, updated_at=? WHERE account_id=?", name, key, model, skin, outfit, xp, Date.now(), accountId);
    } catch (e) {
      if (/name_key/.test(String(e))) throw new HttpError(409, "That name is taken. Pick another.", { code: "name_taken" });
      throw e;
    }
    const p = this.profile(accountId);
    this.emit("profile", p);
    return p;
  }
  addXp(accountId, n) {
    run(this.db, "UPDATE profiles SET xp=xp+?, updated_at=? WHERE account_id=?", Math.max(0, Math.floor(n)), Date.now(), accountId);
  }
};

// server/src/economy.ts
import { EventEmitter as EventEmitter2 } from "node:events";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
var ZONES = ["vacant", "residential", "commercial", "industrial", "institution", "unfinished"];
var MAX_MONEY = 9e12;
var PlotIndex = class {
  map = /* @__PURE__ */ new Map();
  loaded = false;
  load(file) {
    if (!existsSync2(file)) return 0;
    const b = readFileSync2(file);
    if (b.length < 8 || b.toString("latin1", 0, 4) !== "HLPX") return 0;
    const n = b.readUInt32LE(4);
    let o = 8;
    for (let i = 0; i < n; i++) {
      const l = b[o++];
      const id = b.toString("utf8", o, o + l);
      o += l;
      const cx = b.readFloatLE(o), cz = b.readFloatLE(o + 4), area = b.readFloatLE(o + 8), zone = ZONES[b[o + 12]] ?? "residential", rich = b[o + 13] / 255, price = b.readUInt32LE(o + 14);
      o += 18;
      this.map.set(id, { id, cx, cz, area, zone, rich, price });
    }
    this.loaded = this.map.size > 0;
    return this.map.size;
  }
  static encode(recs) {
    const parts = [];
    const head = Buffer.alloc(8);
    head.write("HLPX", 0, "latin1");
    head.writeUInt32LE(recs.length, 4);
    parts.push(head);
    for (const r of recs) {
      const id = Buffer.from(r.id, "utf8");
      const rec2 = Buffer.alloc(1 + id.length + 18);
      rec2[0] = id.length;
      id.copy(rec2, 1);
      const o = 1 + id.length;
      rec2.writeFloatLE(r.cx, o);
      rec2.writeFloatLE(r.cz, o + 4);
      rec2.writeFloatLE(r.area, o + 8);
      rec2[o + 12] = Math.max(0, ZONES.indexOf(r.zone));
      rec2[o + 13] = Math.round(r.rich * 255);
      rec2.writeUInt32LE(Math.min(4294967295, r.price), o + 14);
      parts.push(rec2);
    }
    return Buffer.concat(parts);
  }
};
var DEFAULT_WAGES = {
  delivery: { pay: 3500, minSeconds: 20 },
  danfo: { pay: 6e3, minSeconds: 25 },
  parcel: { pay: 3e4, minSeconds: 30 }
};
var Economy = class _Economy extends EventEmitter2 {
  constructor(db, cfg, content, log2) {
    super();
    this.db = db;
    this.cfg = cfg;
    this.content = content;
    this.log = log2;
    const n = this.plots.load(cfg.plotsFile);
    if (n) log2.info(`plot index loaded: ${n} plots`);
    else log2.warn("no plots.bin: plot prices are checked against the formula, not the map (run npm run build-plots)");
  }
  plots = new PlotIndex();
  jobs = /* @__PURE__ */ new Map();
  earned = /* @__PURE__ */ new Map();
  // -------------------------------------------------------------------------------- player rows
  ensurePlayer(accountId) {
    let p = one(this.db, "SELECT * FROM players WHERE account_id=?", accountId);
    if (!p) {
      run(this.db, "INSERT OR IGNORE INTO players(account_id,cash,bank,updated_at) VALUES(?,?,0,?)", accountId, this.cfg.startCash, Date.now());
      p = one(this.db, "SELECT * FROM players WHERE account_id=?", accountId);
      this.logTx(accountId, "start", this.cfg.startCash, 0, p.cash, p.bank, null, "starting cash");
    }
    return p;
  }
  wallet(accountId) {
    const p = this.ensurePlayer(accountId);
    return { cash: p.cash, bank: p.bank };
  }
  logTx(accountId, kind, dCash, dBank, cash, bank, ref, note) {
    run(this.db, "INSERT INTO tx_log(account_id,at,kind,cash_delta,bank_delta,cash_after,bank_after,ref,note) VALUES(?,?,?,?,?,?,?,?,?)", accountId, Date.now(), kind, dCash, dBank, cash, bank, ref, note);
  }
  history(accountId, limit = 100, before) {
    return all(
      this.db,
      "SELECT id,at,kind,cash_delta,bank_delta,cash_after,bank_after,ref,note FROM tx_log WHERE account_id=@a AND (@b IS NULL OR id<@b) ORDER BY id DESC LIMIT @l",
      { a: accountId, b: before ?? null, l: Math.min(500, limit) }
    );
  }
  /**
   * The one place money moves. Fails (HttpError 402) instead of going negative unless `clamp` is set, which takes what is there.
   * `why` is pushed to the player's client with the new balance.
   */
  adjust(accountId, dCash, dBank, kind, o = {}) {
    if (!Number.isFinite(dCash) || !Number.isFinite(dBank)) throw new HttpError(400, "Bad amount.");
    dCash = Math.trunc(dCash);
    dBank = Math.trunc(dBank);
    const out = this.db.transaction(() => {
      const p = this.ensurePlayer(accountId);
      if (o.clamp) {
        dCash = Math.max(dCash, -p.cash);
        dBank = Math.max(dBank, -p.bank);
      }
      const cash = p.cash + dCash, bank = p.bank + dBank;
      if (cash < 0 || bank < 0) throw new HttpError(402, "Not enough money.", { code: "broke" });
      if (cash > MAX_MONEY || bank > MAX_MONEY) throw new HttpError(400, "Amount too large.");
      run(this.db, "UPDATE players SET cash=?, bank=?, updated_at=? WHERE account_id=?", cash, bank, Date.now(), accountId);
      this.logTx(accountId, kind, dCash, dBank, cash, bank, o.ref ?? null, o.note ?? null);
      return { cash, bank };
    })();
    if (!o.silent) this.emit("wallet", { accountId, cash: out.cash, bank: out.bank, why: kind });
    return out;
  }
  /** Gifts from the game itself (admin grants, IAP fulfilment, rewards). */
  grant(accountId, cash, kind, ref, note) {
    return this.adjust(accountId, cash, 0, kind, { ref, note });
  }
  // -------------------------------------------------------------------------------- bank
  deposit(accountId, amount) {
    amount = this.amount(amount);
    const w = this.wallet(accountId);
    if (amount > w.cash) amount = w.cash;
    if (amount <= 0) throw new HttpError(402, "Nothing to deposit.");
    return this.adjust(accountId, -amount, amount, "bank.deposit");
  }
  /** Withdrawals cost 1.5 percent, same as the single player bank. */
  withdraw(accountId, amount) {
    amount = this.amount(amount);
    const w = this.wallet(accountId);
    if (amount > w.bank) amount = w.bank;
    if (amount <= 0) throw new HttpError(402, "Nothing in the bank.");
    return this.adjust(accountId, withdrawNet(amount), -amount, "bank.withdraw", { note: `fee ${amount - withdrawNet(amount)}` });
  }
  transfer(fromId, toId, amount, note = "") {
    amount = this.amount(amount);
    if (fromId === toId) throw new HttpError(400, "You cannot pay yourself.");
    if (amount < 1) throw new HttpError(400, "Amount must be at least 1.");
    return this.db.transaction(() => {
      const from = this.adjust(fromId, -amount, 0, "transfer.out", { ref: toId, note, silent: true });
      const to = this.adjust(toId, amount, 0, "transfer.in", { ref: fromId, note, silent: true });
      this.emit("wallet", { accountId: fromId, ...from, why: "transfer.out" });
      this.emit("wallet", { accountId: toId, ...to, why: "transfer.in" });
      return { from, to };
    })();
  }
  amount(a) {
    const n = Math.floor(Number(a));
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, "Bad amount.");
    return n;
  }
  // -------------------------------------------------------------------------------- land (global ownership)
  plotRow(id) {
    return one(this.db, "SELECT p.*, f.name AS owner_name FROM plots p LEFT JOIN profiles f ON f.account_id=p.owner_id WHERE p.id=?", id);
  }
  plotsOf(accountId) {
    return all(this.db, "SELECT * FROM plots WHERE owner_id=?", accountId);
  }
  plotsIn(minx, minz, maxx, maxz, limit = 5e3) {
    return all(
      this.db,
      "SELECT p.id,p.owner_id,f.name AS owner_name,p.cx,p.cz,p.pts FROM plots p LEFT JOIN profiles f ON f.account_id=p.owner_id WHERE p.cx BETWEEN ? AND ? AND p.cz BETWEEN ? AND ? LIMIT ?",
      minx,
      maxx,
      minz,
      maxz,
      limit
    );
  }
  allPlots(limit = 1e5) {
    return all(this.db, "SELECT p.id,p.owner_id,f.name AS owner_name,p.cx,p.cz FROM plots p LEFT JOIN profiles f ON f.account_id=p.owner_id LIMIT ?", limit);
  }
  /**
   * Buy a plot: price comes from the map index when we have one, otherwise from the formula using the client's reported
   * geometry (bounded). Bank money is spent first, like the single player build. Fails if anyone already owns it.
   */
  buyPlot(accountId, id, claim = {}) {
    if (typeof id !== "string" || id.length < 2 || id.length > 64 || !/^[\w.\-:]+$/.test(id)) throw new HttpError(400, "Bad plot id.");
    let rec2 = this.plots.map.get(id);
    let price;
    if (rec2) price = rec2.price;
    else {
      if (this.plots.loaded && !this.cfg.trustClientPlotPrice) throw new HttpError(404, "No such plot on the map.");
      const cx = Number(claim.cx), cz = Number(claim.cz), area = Number(claim.area), rich = Math.max(0, Math.min(1, Number(claim.rich ?? 0.3)));
      if (![cx, cz, area].every(Number.isFinite) || area < 30 || area > 4e5) throw new HttpError(400, "Plot details are missing.");
      const b = this.cfg.mapBounds;
      if (cx < b[0] || cx > b[2] || cz < b[1] || cz > b[3]) throw new HttpError(400, "That plot is outside Lagos.");
      const zone = ZONES.includes(String(claim.zone)) ? String(claim.zone) : "residential";
      price = Math.max(15e5, plotPriceOf(area, zone, rich, cx, cz));
      rec2 = { id, cx, cz, area, zone, rich, price };
    }
    const result = this.db.transaction(() => {
      if (this.plotRow(id)) throw new HttpError(409, "Somebody already owns that land.", { code: "owned" });
      const p = this.ensurePlayer(accountId);
      if (p.cash + p.bank < price) throw new HttpError(402, `You need \u20A6${price.toLocaleString("en-NG")}.`, { code: "broke", price });
      const fromBank = Math.min(p.bank, price);
      const fromCash = price - fromBank;
      const w = this.adjust(accountId, -fromCash, -fromBank, "plot.buy", { ref: id, note: `${Math.round(rec2.area)} m2 ${rec2.zone}`, silent: true });
      const pts = Array.isArray(claim.pts) && claim.pts.length >= 6 && claim.pts.length <= 400 && claim.pts.every((v) => Number.isFinite(v)) ? JSON.stringify(claim.pts.map((v) => Math.round(v * 10) / 10)) : null;
      run(this.db, "INSERT INTO plots(id,owner_id,pts,price,bought_at,cx,cz) VALUES(?,?,?,?,?,?,?)", id, accountId, pts, price, Date.now(), rec2.cx, rec2.cz);
      return w;
    })();
    const name = one(this.db, "SELECT name FROM profiles WHERE account_id=?", accountId)?.name ?? null;
    this.emit("wallet", { accountId, ...result, why: "plot.buy" });
    this.emit("plot", { id, ownerId: accountId, ownerName: name });
    return { wallet: result, price, id };
  }
  /** Admin: take land back or hand it over. */
  setPlotOwner(id, ownerId) {
    if (ownerId === null) run(this.db, "DELETE FROM plots WHERE id=?", id);
    else {
      const rec2 = this.plots.map.get(id);
      run(this.db, "INSERT INTO plots(id,owner_id,price,bought_at,cx,cz) VALUES(?,?,0,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id", id, ownerId, Date.now(), rec2?.cx ?? null, rec2?.cz ?? null);
    }
    const name = ownerId ? one(this.db, "SELECT name FROM profiles WHERE account_id=?", ownerId)?.name ?? null : null;
    this.emit("plot", { id, ownerId, ownerName: name });
  }
  // -------------------------------------------------------------------------------- earning
  wages() {
    const doc = this.content.read("economy");
    const w = { ...DEFAULT_WAGES };
    for (const it of doc?.items ?? []) {
      const pay = it.pay ?? it.wage;
      if ((it.kind === "wage" || it.kind === "job") && typeof pay === "number" && pay > 0) w[it.id] = { pay, minSeconds: it.minSeconds ?? 20 };
    }
    return w;
  }
  startJob(accountId, id) {
    if (typeof id !== "string" || id.length > 40) throw new HttpError(400, "Bad job.");
    this.jobs.set(accountId, { id, at: Date.now() });
  }
  /** Pays the table rate once, if the job was started and enough time passed to have actually done it. */
  finishJob(accountId, id, bonusFactor = 1) {
    const j2 = this.jobs.get(accountId);
    const w = this.wages()[id];
    if (!j2 || j2.id !== id) throw new HttpError(400, "No such hustle in progress.", { code: "no_job" });
    if (!w) throw new HttpError(400, "Unknown hustle.");
    const secs = (Date.now() - j2.at) / 1e3;
    if (secs < w.minSeconds) {
      this.flag(accountId, "job-too-fast", { id, secs });
      throw new HttpError(400, "That was too quick. Hustle properly.", { code: "too_fast" });
    }
    this.jobs.delete(accountId);
    const pay = Math.round(w.pay * Math.max(0.5, Math.min(1.5, bonusFactor)));
    this.noteIncome(accountId, pay);
    this.adjust(accountId, pay, 0, "job.pay", { ref: id, note: `${Math.round(secs)}s` });
    this.emit("income", accountId, pay, "job");
    return this.wallet(accountId);
  }
  /**
   * Cash the local simulation changed by itself (fines, wasted cash, loot picked up). Losses are accepted; gains are
   * accepted only for the reasons in `GAIN_REASONS` and only up to a per minute cap, so a hacked client cannot print money.
   */
  clientDelta(accountId, d, why) {
    d = Math.trunc(d);
    if (!Number.isFinite(d) || d === 0) return this.wallet(accountId);
    if (d < 0) return this.adjust(accountId, d, 0, "client.spend", { note: why.slice(0, 40), clamp: true });
    const rule = EARN_RULES[why];
    if (!rule) {
      this.flag(accountId, "unsanctioned-gain", { d, why });
      return this.wallet(accountId);
    }
    if (why === "race") {
      const e = this.raceEscrow.get(accountId);
      if (!e || d > e.max || Date.now() - e.t < 2e4) {
        this.flag(accountId, "race-unbacked", { d, e });
        return this.wallet(accountId);
      }
      this.raceEscrow.delete(accountId);
    }
    const now = Date.now();
    const k = accountId + ":" + why;
    const w = this.earnWin.get(k) ?? { m: now, msum: 0, h: now, hsum: 0 };
    if (now - w.m > 6e4) {
      w.m = now;
      w.msum = 0;
    }
    if (now - w.h > 36e5) {
      w.h = now;
      w.hsum = 0;
    }
    if (w.msum + d > rule.perMin || w.hsum + d > rule.perHour) {
      this.flag(accountId, "gain-cap", { d, why, min: w.msum, hour: w.hsum });
      this.earnWin.set(k, w);
      return this.wallet(accountId);
    }
    w.msum += d;
    w.hsum += d;
    this.earnWin.set(k, w);
    this.noteIncome(accountId, d);
    this.adjust(accountId, d, 0, "client.gain", { note: why.slice(0, 40) });
    this.emit("income", accountId, d, why);
    return this.wallet(accountId);
  }
  earnWin = /* @__PURE__ */ new Map();
  /** a street race wager: taken now, and the most the race can pay back is remembered for `clientDelta('race')` */
  raceEscrow = /* @__PURE__ */ new Map();
  raceEnter(accountId, wager, rivals) {
    const w = Math.floor(Number(wager));
    const r = Math.max(1, Math.min(7, Math.floor(Number(rivals) || 1)));
    if (![5e3, 2e4, 1e5, 5e5].includes(w)) throw new HttpError(400, "Bad wager.");
    const out = this.adjust(accountId, -w, 0, "race.enter");
    this.raceEscrow.set(accountId, { t: Date.now(), max: Math.round(w * (r + 1) * 0.8) });
    return out;
  }
  /** casino money moves: the stake leaves first, winnings come back from the house */
  casino(accountId, dCash, game) {
    return this.adjust(accountId, dCash, 0, dCash < 0 ? "casino.bet" : "casino.win", { note: game });
  }
  noteIncome(accountId, n) {
    const e = this.earned.get(accountId);
    const now = Date.now();
    const cur = !e || now - e.t > 36e5 ? { t: now, sum: 0 } : e;
    cur.sum += n;
    this.earned.set(accountId, cur);
    if (cur.sum > 9e5) this.flag(accountId, "income-high", { perHour: cur.sum });
  }
  /** Buy a catalogue item at the server's price (content/shops.json or economy.json items with a price). */
  shopBuy(accountId, sku, qty = 1) {
    if (typeof sku !== "string" || sku.length > 60) throw new HttpError(400, "Bad item.");
    qty = Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));
    let price = null;
    let name = sku;
    for (const kind of ["shops", "economy"]) {
      const doc = this.content.read(kind);
      const it = doc?.items?.find((x) => x.id === sku);
      if (it && typeof it.price === "number" && it.price >= 0) {
        price = it.price;
        name = it.name ?? it.title ?? sku;
        break;
      }
    }
    if (price === null) throw new HttpError(404, "That item is not for sale.");
    const total = price * qty;
    const w = this.adjust(accountId, -total, 0, "shop.buy", { ref: sku, note: `${qty} x ${name}` });
    return { wallet: w, price, qty, total, sku };
  }
  flag(accountId, kind, detail) {
    run(this.db, "INSERT INTO cheat_flags(at,account_id,kind,detail) VALUES(?,?,?,?)", Date.now(), accountId, kind, JSON.stringify(detail ?? null).slice(0, 500));
    this.emit("flag", { accountId, kind, detail });
  }
  flags(accountId, limit = 100) {
    return all(this.db, "SELECT * FROM cheat_flags WHERE (@a IS NULL OR account_id=@a) ORDER BY id DESC LIMIT @l", { a: accountId ?? null, l: Math.min(500, limit) });
  }
  // -------------------------------------------------------------------------------- player blobs
  state(accountId) {
    const p = this.ensurePlayer(accountId);
    const parse = (s) => {
      try {
        return JSON.parse(s);
      } catch {
        return {};
      }
    };
    return { vehicles: parse(p.vehicles), skills: parse(p.skills), missions: parse(p.missions), blobs: parse(p.blobs) };
  }
  /** Keys the server owns and a client may never write: money and land live in their own tables. */
  static RESERVED_KEYS = /* @__PURE__ */ new Set(["cash", "bank", "owned", "ownedPts", "model", "__proto__", "constructor", "prototype"]);
  putState(accountId, key, value) {
    if (typeof key !== "string" || !/^[\w.\-]{1,40}$/.test(key) || _Economy.RESERVED_KEYS.has(key)) throw new HttpError(400, "Bad state key.");
    const json = JSON.stringify(value ?? null);
    if (json.length > 256 * 1024) throw new HttpError(413, "State too large.");
    this.ensurePlayer(accountId);
    const col = key === "vehicles" || key === "skills" || key === "missions" ? key : null;
    if (col) run(this.db, `UPDATE players SET ${col}=?, updated_at=? WHERE account_id=?`, json, Date.now(), accountId);
    else {
      const row = one(this.db, "SELECT blobs FROM players WHERE account_id=?", accountId);
      let b = {};
      try {
        b = JSON.parse(row.blobs);
      } catch {
      }
      if (Object.keys(b).length >= 64 && !(key in b)) throw new HttpError(413, "Too many state keys.");
      if (value === null || value === void 0) delete b[key];
      else b[key] = value;
      const out = JSON.stringify(b);
      if (out.length > 1024 * 1024) throw new HttpError(413, "State too large.");
      run(this.db, "UPDATE players SET blobs=?, updated_at=? WHERE account_id=?", out, Date.now(), accountId);
    }
  }
  savePosition(accountId, x, y, z, addSeconds = 0) {
    run(this.db, "UPDATE players SET x=?, y=?, z=?, play_seconds=play_seconds+?, updated_at=? WHERE account_id=?", x, y, z, Math.round(addSeconds), Date.now(), accountId);
  }
  lastPosition(accountId) {
    const p = this.ensurePlayer(accountId);
    return p.x === null || p.z === null ? null : { x: p.x, y: p.y ?? 0, z: p.z };
  }
};
var GAIN_REASONS = Object.keys(EARN_RULES);

// server/src/content.ts
import { EventEmitter as EventEmitter3 } from "node:events";
import { copyFileSync, existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync3, readdirSync, renameSync, statSync, writeFileSync as writeFileSync2, unlinkSync } from "node:fs";
import { createHash as createHash2 } from "node:crypto";
import { join } from "node:path";
var CONTENT_KINDS = ["missions", "events", "skills", "routes", "npcs", "economy", "iap", "shops"];
var MAX_BYTES = 8 * 1024 * 1024;
var HISTORY_KEEP = 30;
var ContentStore = class _ContentStore extends EventEmitter3 {
  constructor(cfg, log2) {
    super();
    this.cfg = cfg;
    this.log = log2;
    mkdirSync3(cfg.contentDir, { recursive: true });
    this.seed();
  }
  cache = /* @__PURE__ */ new Map();
  extraKinds = /* @__PURE__ */ new Set();
  kinds() {
    return [...CONTENT_KINDS, ...this.extraKinds];
  }
  isKind(k) {
    return CONTENT_KINDS.includes(k) || this.extraKinds.has(k);
  }
  /** let another workstream register a new content file without editing this module */
  registerKind(k) {
    if (/^[a-z][a-z0-9_-]{1,30}$/.test(k)) this.extraKinds.add(k);
  }
  file(kind) {
    return join(this.cfg.contentDir, `${kind}.json`);
  }
  /** Copy shipped defaults into the data directory for any file that does not exist yet. */
  seed() {
    let n = 0;
    for (const kind of CONTENT_KINDS) {
      const dst = this.file(kind);
      if (existsSync3(dst)) continue;
      const src = join(this.cfg.seedContentDir, `${kind}.json`);
      if (existsSync3(src)) {
        try {
          copyFileSync(src, dst);
          n++;
        } catch (e) {
          this.log.warn(`could not seed ${kind}: ${e}`);
        }
      }
    }
    if (n) this.log.info(`content seeded: ${n} file(s) from ${this.cfg.seedContentDir}`);
  }
  /** Pull in new shipped files / reset one kind to the shipped version (admin "revert to default"). */
  resetToSeed(kind, by = "admin") {
    const src = join(this.cfg.seedContentDir, `${kind}.json`);
    const doc = existsSync3(src) ? JSON.parse(readFileSync3(src, "utf8")) : { version: 1, items: [] };
    return this.write(kind, doc, { by });
  }
  has(kind) {
    return existsSync3(this.file(kind));
  }
  /** The document, or an empty one when the file has not been created. Cached by modification time. */
  read(kind) {
    if (!this.isKind(kind)) return null;
    return this.load(kind).doc;
  }
  load(kind) {
    const f = this.file(kind);
    if (!existsSync3(f)) {
      const doc2 = { version: 1, items: [] };
      const raw2 = JSON.stringify(doc2);
      return { doc: doc2, raw: raw2, etag: etagOf(raw2), mtime: 0 };
    }
    const m = statSync(f).mtimeMs;
    const c = this.cache.get(kind);
    if (c && c.mtime === m) return c;
    const raw = readFileSync3(f, "utf8");
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch {
      throw new HttpError(500, `content/${kind}.json is not valid JSON`);
    }
    const e = { doc, raw, etag: etagOf(raw), mtime: m };
    this.cache.set(kind, e);
    return e;
  }
  etag(kind) {
    return this.load(kind).etag;
  }
  rawText(kind) {
    return this.load(kind).raw;
  }
  summary() {
    return this.kinds().map((k) => {
      const l = this.load(k);
      return { kind: k, items: l.doc.items?.length ?? 0, etag: l.etag, version: l.doc.version, updated: l.mtime || null };
    });
  }
  static validate(kind, doc) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new HttpError(400, "Content must be an object { version, items }.");
    const d = doc;
    if (typeof d.version !== "number" || !Number.isInteger(d.version) || d.version < 1) throw new HttpError(400, '"version" must be a positive integer.');
    if (!Array.isArray(d.items)) throw new HttpError(400, '"items" must be an array.');
    const seen = /* @__PURE__ */ new Set();
    d.items.forEach((it, i) => {
      if (!it || typeof it !== "object" || Array.isArray(it)) throw new HttpError(400, `items[${i}] must be an object.`);
      const id = it.id;
      if (typeof id !== "string" || !id || id.length > 80) throw new HttpError(400, `items[${i}] needs a string "id" (max 80 chars).`);
      if (seen.has(id)) throw new HttpError(400, `Duplicate id "${id}" at items[${i}].`);
      seen.add(id);
    });
    void kind;
    return d;
  }
  /** Atomic write (temp file + rename) with a rolling backup of what it replaced. `ifMatch` gives optimistic locking. */
  write(kind, doc, o = {}) {
    if (!this.isKind(kind)) throw new HttpError(404, `Unknown content kind "${kind}".`);
    const d = _ContentStore.validate(kind, doc);
    const raw = JSON.stringify(d, null, 2) + "\n";
    if (raw.length > MAX_BYTES) throw new HttpError(413, "Content file is too large.");
    const cur = this.load(kind);
    if (o.ifMatch && o.ifMatch.replace(/"/g, "") !== cur.etag) throw new HttpError(412, "Someone else changed this file. Reload and merge.", { etag: cur.etag });
    const f = this.file(kind);
    if (existsSync3(f)) this.backup(kind, f);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync2(tmp, raw);
    renameSync(tmp, f);
    this.cache.delete(kind);
    const now = this.load(kind);
    this.emit("changed", { kind, etag: now.etag, by: o.by ?? null });
    return now.doc;
  }
  histDir(kind) {
    return join(this.cfg.contentDir, ".history", kind);
  }
  backup(kind, f) {
    const dir = this.histDir(kind);
    mkdirSync3(dir, { recursive: true });
    copyFileSync(f, join(dir, `${Date.now()}.json`));
    const files = readdirSync(dir).filter((x) => x.endsWith(".json")).sort();
    for (const old of files.slice(0, Math.max(0, files.length - HISTORY_KEEP))) {
      try {
        unlinkSync(join(dir, old));
      } catch {
      }
    }
  }
  history(kind) {
    const dir = this.histDir(kind);
    if (!existsSync3(dir)) return [];
    return readdirSync(dir).filter((x) => x.endsWith(".json")).sort().reverse().map((x) => ({ rev: x.slice(0, -5), at: Number(x.slice(0, -5)), bytes: statSync(join(dir, x)).size }));
  }
  restore(kind, rev, by) {
    if (!/^\d+$/.test(rev)) throw new HttpError(400, "Bad revision.");
    const f = join(this.histDir(kind), `${rev}.json`);
    if (!existsSync3(f)) throw new HttpError(404, "No such revision.");
    return this.write(kind, JSON.parse(readFileSync3(f, "utf8")), { by });
  }
};
var etagOf = (raw) => createHash2("sha1").update(raw).digest("hex").slice(0, 16);

// server/src/api.ts
var HANDLED = Symbol("handled");
var Reply = class {
  constructor(status, body = void 0, headers = {}) {
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
};
var reply = (status, body, headers = {}) => new Reply(status, body, headers);
var Router = class {
  routes = [];
  add(method, path, handler, opts = {}) {
    if (!path.startsWith("/")) throw new Error(`route path must start with /: ${path}`);
    const dup = this.routes.find((r) => r.method === method.toUpperCase() && r.path === path);
    if (dup) throw new Error(`duplicate route ${method} ${path}`);
    this.routes.push({ method: method.toUpperCase(), path, segs: path.split("/").filter(Boolean), handler, opts: { auth: "none", ...opts } });
    this.routes.sort((a, b) => score(b) - score(a));
  }
  match(method, pathname) {
    const segs = pathname.split("/").filter(Boolean);
    const allowed = [];
    for (const r of this.routes) {
      const p = matchSegs(r.segs, segs);
      if (!p) continue;
      if (r.method === method) return { route: r, params: p };
      allowed.push(r.method);
    }
    return allowed.length ? { allowed } : null;
  }
};
var score = (r) => r.segs.reduce((s, x) => s + (x.startsWith(":") ? 1 : x === "*" ? 0 : 3), 0) * 10 + r.segs.length;
function matchSegs(pat, segs) {
  const params = {};
  for (let i = 0; i < pat.length; i++) {
    const p = pat[i];
    if (p === "*") {
      params["*"] = segs.slice(i).map(safeDecode).join("/");
      return params;
    }
    if (i >= segs.length) return null;
    if (p.startsWith(":")) params[p.slice(1)] = safeDecode(segs[i]);
    else if (p !== segs[i]) return null;
  }
  return pat.length === segs.length ? params : null;
}
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// server/src/http.ts
import { createServer } from "node:http";
import { existsSync as existsSync4, readdirSync as readdirSync2, readFileSync as readFileSync4, statSync as statSync2, createReadStream } from "node:fs";
import { extname, join as join2, normalize, resolve as resolve2, sep } from "node:path";
import { pathToFileURL } from "node:url";
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json"
};
var LEVEL = { none: 0, user: 1, mod: 2, admin: 3 };
var roleLevel = (r) => r === "admin" ? 3 : r === "mod" ? 2 : 1;
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xf = req.headers["x-forwarded-for"];
    if (typeof xf === "string" && xf) return xf.split(",")[0].trim();
  }
  return req.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "0.0.0.0";
}
function cors(api, req, res) {
  const origin = req.headers.origin;
  const allow = api.cfg.allowOrigins;
  if (allow === "*") res.setHeader("Access-Control-Allow-Origin", "*");
  else if (origin && allow.split(",").map((s) => s.trim()).includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,If-Match,If-None-Match");
  res.setHeader("Access-Control-Expose-Headers", "ETag");
  res.setHeader("Access-Control-Max-Age", "600");
}
async function readBody(req, limit, keepRaw = false) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") {
    if (!req.headers["content-length"] || req.headers["content-length"] === "0") return {};
  }
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new HttpError(413, "Request body is too large.");
    chunks.push(c);
  }
  if (!n) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (keepRaw) req.rawBody = text;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be valid JSON.");
  }
}
function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (body === void 0) {
    res.statusCode = status === 200 ? 204 : status;
    res.end();
    return;
  }
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  if (!res.hasHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = status;
  res.end(data);
}
function createHttp(api, router) {
  return createServer(async (req, res) => {
    const ip = clientIp(req, api.cfg.trustProxy);
    try {
      cors(api, req, res);
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }
      const url = new URL(req.url ?? "/", "http://x");
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const m = router.match(req.method ?? "GET", pathname);
      if (m && "route" in m) {
        const { route, params } = m;
        const lim = route.opts.rate ?? { limit: 240, windowMs: 6e4 };
        if (!limiterFor(api, `${route.method} ${route.path}`, lim.limit * api.cfg.rateScale, lim.windowMs).take(ip)) throw new HttpError(429, "Too many requests. Slow down.");
        const query = {};
        for (const [k, v] of url.searchParams) query[k] = v;
        const r = { method: req.method, path: pathname, params, query, body: {}, headers: req.headers, ip, account: null, sid: null, raw: req, res };
        const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? query.token;
        if (bearer) {
          const a = api.accounts.authenticate(bearer);
          if (a) {
            r.account = a.account;
            r.sid = a.sid;
          }
        }
        const need = LEVEL[route.opts.auth];
        if (need > 0) {
          if (!r.account) throw new HttpError(401, "Sign in first.", { code: "auth" });
          const b = banState(r.account);
          if (b.banned) throw new HttpError(403, b.reason, { code: "banned", until: b.until });
          if (roleLevel(r.account.role) < need) throw new HttpError(403, "Not allowed.", { code: "forbidden" });
        }
        r.body = await readBody(req, route.opts.bodyLimit ?? 256 * 1024, !!route.opts.rawBody);
        if (route.opts.rawBody) r.rawBody = req.rawBody ?? "";
        const out = await route.handler(r);
        if (out === HANDLED || res.writableEnded) return;
        if (out instanceof Reply) send(res, out.status, out.body, out.headers);
        else send(res, out === void 0 ? 204 : 200, out);
        return;
      }
      if (m && "allowed" in m) {
        res.setHeader("Allow", [...new Set(m.allowed)].join(", "));
        throw new HttpError(405, "Method not allowed.");
      }
      if (pathname.startsWith("/api/") || pathname === "/api") throw new HttpError(404, "No such endpoint.");
      if (req.method === "GET" || req.method === "HEAD") {
        if (serveStatic(api, pathname, req, res)) return;
      }
      throw new HttpError(404, "Not found.");
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, { error: e.message, ...e.extra });
      else {
        api.log.error("request failed", req.method, req.url, e);
        send(res, 500, { error: "Server error." });
      }
    }
  });
}
function limiterFor(api, key, limit, windowMs) {
  return api.limiters[key] ??= new RateLimiter(limit, windowMs);
}
function serveStatic(api, pathname, req, res) {
  const cfg = api.cfg;
  let root = cfg.staticDir;
  let rel = pathname;
  if (cfg.adminDir && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    root = cfg.adminDir;
    rel = pathname.slice("/admin".length) || "/";
  }
  if (!root) return false;
  root = resolve2(root);
  let file = normalize(join2(root, decodeURIComponent(rel)));
  if (file !== root && !file.startsWith(root + sep)) return false;
  if (existsSync4(file) && statSync2(file).isDirectory()) file = join2(file, "index.html");
  if (!existsSync4(file)) {
    if (!extname(rel)) file = join2(root, "index.html");
    if (!existsSync4(file)) return false;
  }
  const st = statSync2(file);
  const ext = extname(file).toLowerCase();
  if (ext === ".html" && root === resolve2(cfg.staticDir || "/nonexistent")) {
    const html = Buffer.from(readFileSync4(file, "utf8").replace("<head>", "<head><script>window.__HL_SAME_ORIGIN__=1</script>"));
    res.setHeader("Content-Type", MIME[ext]);
    res.setHeader("Content-Length", html.length);
    res.setHeader("Cache-Control", "no-cache");
    res.statusCode = 200;
    res.end(req.method === "HEAD" ? void 0 : html);
    return true;
  }
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("Content-Length", st.size);
  res.setHeader("Cache-Control", /\.(html)$/.test(ext) ? "no-cache" : "public, max-age=3600");
  res.statusCode = 200;
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}
async function loadRoutes(api, dir) {
  if (!existsSync4(dir)) return [];
  const loaded = [];
  const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const files = readdirSync2(dir).filter((f) => f.endsWith(ext) && !f.endsWith(".d.ts") && !/\.(test|spec)\./.test(f)).sort();
  for (const f of files) {
    const base = f.slice(0, -ext.length);
    try {
      const mod = await import(pathToFileURL(join2(dir, f)).href);
      if (typeof mod.register !== "function") {
        api.log.warn(`routes/${f} has no register(api); skipped`);
        continue;
      }
      await mod.register(api);
      loaded.push(base);
    } catch (e) {
      api.log.error(`routes/${f} failed to load:`, e);
      throw e;
    }
  }
  return loaded.sort();
}

// server/src/realtime/hub.ts
import { WebSocketServer } from "ws";

// server/src/business.ts
import { randomInt } from "node:crypto";
var rand = () => randomInt(0, 2 ** 32) / 2 ** 32;
var Businesses = class {
  constructor(db, econ, now = Date.now) {
    this.db = db;
    this.econ = econ;
    this.now = now;
  }
  /** shares the till with outside investors; returns what the owner keeps */
  splitter = null;
  row(site) {
    return one(this.db, "SELECT b.*, f.name AS owner_name FROM businesses b LEFT JOIN profiles f ON f.account_id=b.owner_id WHERE b.site=?", site);
  }
  /** bring a business up to the present hour and save it */
  advance(r) {
    const t = bizType(r.type);
    if (!t) return r;
    const st = { stock: r.stock, till: r.till, debt: r.debt, hour: r.hour, log: JSON.parse(r.log || "[]") };
    const to = worldHours(this.now());
    if (Math.floor(to) <= r.hour) return r;
    bizStep(st, t, r.site, to, rand);
    run(this.db, "UPDATE businesses SET stock=?, till=?, debt=?, hour=?, log=? WHERE site=?", st.stock, st.till, st.debt, st.hour, JSON.stringify(st.log), r.site);
    return { ...r, stock: st.stock, till: st.till, debt: st.debt, hour: st.hour, log: JSON.stringify(st.log) };
  }
  view(r) {
    const t = bizType(r.type);
    const hod = worldHours(this.now()) % 24;
    return { site: r.site, type: r.type, owner: r.owner_id, ownerName: r.owner_name ?? "Somebody", stock: Math.round(r.stock), till: Math.round(r.till), debt: Math.round(r.debt), log: JSON.parse(r.log || "[]"), open: hod >= t.open[0] && hod < t.open[1] && r.debt < t.upkeep * 3 && r.stock > 0 };
  }
  near(site, at) {
    const p = sitePos(site);
    if (!p) throw new HttpError(400, "Bad site.");
    if (at.interior || Math.hypot(p.x - at.x, p.z - at.z) > BIZ_REACH) throw new HttpError(400, "You have to be at the shop.");
    return p;
  }
  mineRow(accountId, site) {
    const r = this.row(String(site ?? ""));
    if (!r || r.owner_id !== accountId) throw new HttpError(404, "That shop is not yours.");
    return this.advance(r);
  }
  /** every owned site with its owner and trade, for the signs on the street */
  all() {
    return all(this.db, "SELECT b.site, b.type, f.name AS owner_name FROM businesses b LEFT JOIN profiles f ON f.account_id=b.owner_id").map((r) => ({ site: r.site, type: r.type, ownerName: r.owner_name ?? "Somebody" }));
  }
  mine(accountId) {
    return all(this.db, "SELECT b.*, f.name AS owner_name FROM businesses b LEFT JOIN profiles f ON f.account_id=b.owner_id WHERE b.owner_id=?", accountId).map((r) => this.view(this.advance(r)));
  }
  get(site) {
    const r = this.row(site);
    return r ? this.view(this.advance(r)) : null;
  }
  buy(accountId, site, type, at) {
    const id = String(site ?? "");
    this.near(id, at);
    const t = bizType(String(type ?? ""));
    if (!t) throw new HttpError(400, "No such business.");
    if (this.row(id)) throw new HttpError(409, "Somebody already owns this shop.");
    const n = one(this.db, "SELECT COUNT(*) AS n FROM businesses WHERE owner_id=?", accountId).n;
    if (n >= BIZ_MAX) throw new HttpError(400, `You can run ${BIZ_MAX} businesses at most.`);
    return this.db.transaction(() => {
      const w = this.econ.adjust(accountId, -t.price, 0, "biz.buy", { ref: id, note: t.id });
      run(this.db, "INSERT INTO businesses(site,owner_id,type,stock,till,debt,hour,bought_at,log) VALUES(?,?,?,?,?,?,?,?,?)", id, accountId, t.id, 100, 0, 0, Math.floor(worldHours(this.now())), this.now(), "[]");
      return { wallet: w, biz: this.view(this.row(id)) };
    })();
  }
  /** empty the till into your pocket: only standing at the shop */
  collect(accountId, site, at) {
    const r = this.mineRow(accountId, site);
    this.near(r.site, at);
    const n = Math.floor(r.till);
    if (n <= 0) throw new HttpError(400, "The till is empty.");
    return this.db.transaction(() => {
      run(this.db, "UPDATE businesses SET till=till-? WHERE site=?", n, r.site);
      const keep = this.splitter ? this.splitter(r.site, accountId, n) : n;
      const w = this.econ.adjust(accountId, keep, 0, "biz.collect", { ref: r.site });
      return { wallet: w, amount: n, biz: this.view(this.row(r.site)) };
    })();
  }
  /** fill the shelves; from the phone it costs 15% more for delivery. Unpaid staff are paid first. */
  restock(accountId, site, at) {
    const r = this.mineRow(accountId, site);
    const t = bizType(r.type);
    const p = sitePos(r.site);
    const there = !at.interior && Math.hypot(p.x - at.x, p.z - at.z) <= BIZ_REACH;
    const goods = Math.round(t.restock * (100 - r.stock) / 100 * (there ? 1 : 1.15));
    const cost = goods + Math.round(r.debt);
    if (cost <= 0) throw new HttpError(400, "Shelves are full and staff are paid.");
    return this.db.transaction(() => {
      const w = this.econ.adjust(accountId, -cost, 0, "biz.restock", { ref: r.site, note: r.debt > 0 ? `wages ${Math.round(r.debt)}` : void 0 });
      run(this.db, "UPDATE businesses SET stock=100, debt=0 WHERE site=?", r.site);
      return { wallet: w, cost, biz: this.view(this.row(r.site)) };
    })();
  }
  /** a customer buys at somebody's shop; the money goes into the owner's till */
  serve(customerId, site, at) {
    const r0 = this.row(String(site ?? ""));
    if (!r0) throw new HttpError(404, "This shop is to let.");
    this.near(r0.site, at);
    const r = this.advance(r0);
    const v = this.view(r);
    const t = bizType(r.type);
    if (r.owner_id === customerId) throw new HttpError(400, "Na your own shop.");
    if (!v.open) throw new HttpError(400, r.debt >= t.upkeep * 3 ? "Closed. The staff are on strike." : r.stock <= 0 ? "Nothing on the shelves." : `Closed. Opens ${t.open[0]}:00 to ${t.open[1]}:00.`);
    const price = t.sells.price;
    return this.db.transaction(() => {
      let w;
      if (t.id === "pos") w = this.econ.adjust(customerId, 5e3, -(5e3 + price), "biz.pos", { ref: r.site });
      else w = this.econ.adjust(customerId, -price, 0, "biz.buy.item", { ref: r.site, note: t.id });
      run(this.db, "UPDATE businesses SET till=MIN(till+?, ?), stock=MAX(0, stock-1) WHERE site=?", price, t.till * 1.5, r.site);
      return { wallet: w, owner: r.owner_id, ownerName: v.ownerName, item: t.sells };
    })();
  }
};

// server/src/phone.ts
import { randomInt as randomInt2 } from "node:crypto";
var B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var PhoneNet = class {
  constructor(db) {
    this.db = db;
  }
  /** the account's number and public id, made on first use */
  ensure(accountId) {
    const r = one(this.db, "SELECT account_id, number, public_id FROM phones WHERE account_id=?", accountId);
    if (r) return r;
    for (let k = 0; k < 40; k++) {
      const number = `0${[803, 806, 809, 813, 816, 703, 706, 810, 814, 903][randomInt2(10)]}${String(randomInt2(0, 1e7)).padStart(7, "0")}`;
      const pid = "HL-" + Array.from({ length: 6 }, () => B32[randomInt2(B32.length)]).join("");
      try {
        run(this.db, "INSERT INTO phones(account_id, number, public_id, created_at) VALUES(?,?,?,?)", accountId, number, pid, Date.now());
        return { account_id: accountId, number, public_id: pid };
      } catch {
      }
    }
    throw new HttpError(500, "Could not give you a number.");
  }
  /** find a player by phone number, public id, or exact name */
  lookup(q) {
    const t = String(q ?? "").trim();
    if (!t || t.length > 40) return null;
    const digits = t.replace(/[^0-9]/g, "");
    const pid = t.toUpperCase().replace(/^HL-?/, "HL-");
    const r = one(
      this.db,
      "SELECT p.account_id, p.number, p.public_id, f.name FROM phones p LEFT JOIN profiles f ON f.account_id=p.account_id WHERE p.number=? OR p.public_id=? OR lower(f.name)=lower(?) LIMIT 1",
      digits,
      pid,
      t
    );
    return r ? { id: r.account_id, name: r.name ?? "Player", number: r.number, publicId: r.public_id } : null;
  }
  addContact(owner, q, name) {
    const p = this.lookup(q);
    if (!p) throw new HttpError(404, "No player with that number or ID.");
    if (p.id === owner) throw new HttpError(400, "That na your own number.");
    const n = cleanChat(name ?? p.name, 24) ?? p.name;
    run(this.db, "INSERT INTO contacts(owner_id, contact_id, name, added_at) VALUES(?,?,?,?) ON CONFLICT(owner_id, contact_id) DO UPDATE SET name=excluded.name", owner, p.id, n, Date.now());
    return { ...p, saved: n };
  }
  removeContact(owner, id) {
    run(this.db, "DELETE FROM contacts WHERE owner_id=? AND contact_id=?", owner, String(id ?? ""));
  }
  contacts(owner) {
    return all(
      this.db,
      "SELECT c.contact_id AS id, c.name, p.number, p.public_id AS publicId, f.name AS player FROM contacts c JOIN phones p ON p.account_id=c.contact_id LEFT JOIN profiles f ON f.account_id=c.contact_id WHERE c.owner_id=? ORDER BY c.name COLLATE NOCASE",
      owner
    );
  }
  send(from, to, body) {
    const t = String(to ?? "");
    const text = cleanChat(body, 500);
    if (!text) throw new HttpError(400, "Say something.");
    if (t === from) throw new HttpError(400, "You cannot text yourself.");
    if (!one(this.db, "SELECT 1 FROM phones WHERE account_id=?", t)) throw new HttpError(404, "That number is not on the network.");
    const recent = one(this.db, "SELECT COUNT(*) AS n FROM messages WHERE from_id=? AND at>?", from, Date.now() - 1e4).n;
    if (recent >= 6) throw new HttpError(429, "Slow down small.");
    const at = Date.now();
    const r = run(this.db, "INSERT INTO messages(from_id, to_id, body, at) VALUES(?,?,?,?)", from, t, text, at);
    return { id: Number(r.lastInsertRowid), from, to: t, body: text, at };
  }
  /** one row per person you have texted with: the last message and how many you have not read */
  threads(owner) {
    return all(this.db, `
      WITH t AS (SELECT CASE WHEN from_id=@me THEN to_id ELSE from_id END AS other, body, at, from_id=@me AS mine FROM messages WHERE from_id=@me OR to_id=@me),
      last AS (SELECT other, MAX(at) AS at FROM t GROUP BY other)
      SELECT t.other, t.body, t.at, t.mine, (SELECT COUNT(*) FROM messages m WHERE m.from_id=t.other AND m.to_id=@me AND m.read=0) AS unread,
        f.name, c.name AS saved, p.number
      FROM t JOIN last ON last.other=t.other AND last.at=t.at LEFT JOIN profiles f ON f.account_id=t.other LEFT JOIN contacts c ON c.owner_id=@me AND c.contact_id=t.other
      LEFT JOIN phones p ON p.account_id=t.other GROUP BY t.other ORDER BY t.at DESC LIMIT 50`, { me: owner });
  }
  thread(owner, other, peek = false) {
    const o = String(other ?? "");
    if (!peek) run(this.db, "UPDATE messages SET read=1 WHERE from_id=? AND to_id=? AND read=0", o, owner);
    return all(this.db, "SELECT id, from_id, body, at FROM messages WHERE (from_id=@a AND to_id=@b) OR (from_id=@b AND to_id=@a) ORDER BY id DESC LIMIT 60", { a: owner, b: o }).reverse();
  }
  unread(owner) {
    return one(this.db, "SELECT COUNT(*) AS n FROM messages WHERE to_id=? AND read=0", owner).n;
  }
};

// server/src/body.ts
import { EventEmitter as EventEmitter4 } from "node:events";
import { readFileSync as readFileSync5 } from "node:fs";
import { resolve as resolve3 } from "node:path";
import { randomInt as randomInt3 } from "node:crypto";
var GAME_HOUR = 12e4;
var J = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
var rand2 = () => randomInt3(0, 2 ** 32) / 2 ** 32;
function loadPlaces(dir = PATHS.publicDir) {
  try {
    const m = JSON.parse(readFileSync5(resolve3(dir, "world/manifest.json"), "utf8"));
    const o = m.origin;
    const kx = Math.cos(o.lat * Math.PI / 180) * 111320, kz = 110574;
    const items = JSON.parse(readFileSync5(resolve3(dir, "content/places.json"), "utf8")).items;
    return items.filter((p) => ["hospital", "clinic", "pharmacy", "optician", "market", "shop", "phones"].includes(p.kind)).map((p) => ({ id: p.id, name: p.name, kind: p.kind, x: (p.lon - o.lon) * kx, z: -(p.lat - o.lat) * kz }));
  } catch {
    return [{ id: "lagos_gh", name: "General Hospital Lagos", kind: "hospital", x: 6e3, z: 11e3 }];
  }
}
var Body = class extends EventEmitter4 {
  constructor(db, econ, places) {
    super();
    this.db = db;
    this.econ = econ;
    this.places = places ?? loadPlaces();
    econ.on("income", (accountId, amount) => this.garnish(accountId, amount));
  }
  places;
  lastExpo = /* @__PURE__ */ new Map();
  // ------------------------------------------------------------------------------------------ the row
  ensure(accountId) {
    let r = one(this.db, "SELECT * FROM player_body WHERE account_id=?", accountId);
    if (r) return r;
    const roll = rand2();
    const n = roll < 0.3 ? 0 : roll < 0.82 ? 1 : 2;
    const pool = [...TRAIT_IDS];
    const traits = [];
    for (let i = 0; i < n; i++) traits.push(pool.splice(randomInt3(0, pool.length), 1)[0]);
    run(this.db, "INSERT OR IGNORE INTO player_body(account_id, seed, traits, updated_at) VALUES(?,?,?,?)", accountId, rand2(), JSON.stringify(traits), Date.now());
    r = one(this.db, "SELECT * FROM player_body WHERE account_id=?", accountId);
    return r;
  }
  save(accountId, f) {
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(f)) {
      sets.push(`${k}=?`);
      vals.push(typeof v === "object" ? JSON.stringify(v) : typeof v === "boolean" ? v ? 1 : 0 : v);
    }
    run(this.db, `UPDATE player_body SET ${sets.join(", ")}, updated_at=? WHERE account_id=?`, ...vals, Date.now(), accountId);
  }
  ills(accountId) {
    return J(this.ensure(accountId).ill, []);
  }
  /** what the player's own game is told: symptoms (names only once a clinic has named them), traits, debt. Never luck, karma or carrying. */
  view(accountId) {
    const r = this.ensure(accountId);
    const known = new Set(J(r.known, []));
    const now = Date.now();
    const ill = J(r.ill, []).filter((i) => !i.carrier).map((i) => {
      const d = ILLNESSES[i.id];
      const eased = (i.eased ?? 0) > now;
      return { key: `${i.id}:${i.at}`, name: known.has(i.id) ? d.name : null, symptoms: eased ? d.symptoms.filter((s) => !DRUGS.paracetamol.eases.includes(s)) : d.symptoms, sev: i.sev, walk: d.walk, eased, drug: known.has(i.id) ? d.drug : null };
    });
    return { traits: J(r.traits, []), fixed: J(r.fixed, []), ill, debt: r.debt, stripped: !!r.stripped, origin: r.origin, deaths: r.deaths };
  }
  /** the hidden luck number, -100 to 100 */
  luck(accountId, now = Date.now()) {
    const r = this.ensure(accountId);
    return luckOf(r.karma, r.seed, now);
  }
  karma(accountId, delta, why) {
    if (!Number.isFinite(delta) || !delta) return;
    const r = this.ensure(accountId);
    const k = Math.max(-1e3, Math.min(1e3, r.karma + delta));
    this.save(accountId, { karma: k });
    run(this.db, "INSERT INTO karma_log(account_id, at, delta, why) VALUES(?,?,?,?)", accountId, Date.now(), delta, why.slice(0, 40));
  }
  /** a lucky roll: true with chance p nudged by luck (luck 100 doubles a good chance, -100 halves it) */
  lucky(accountId, p) {
    const l = this.luck(accountId);
    return rand2() < Math.max(0, Math.min(1, p * (1 + l / 100)));
  }
  // ------------------------------------------------------------------------------------------ illness
  /** catch something. Spreading illnesses: luck decides if you just carry it. Returns true if anything changed. */
  infect(accountId, id, now = Date.now(), forceCarrier) {
    const r = this.ensure(accountId);
    const ills = J(r.ill, []);
    if (ills.some((i) => i.id === id)) return false;
    const immune = J(r.immune, {});
    if ((immune[id] ?? 0) > now) return false;
    const d = ILLNESSES[id];
    const carrier = forceCarrier ?? (d.spreads && rand2() < carrierChance(this.luck(accountId, now)));
    ills.push({ id, at: now, carrier, sev: 1 });
    this.save(accountId, { ill: ills });
    if (!carrier) this.emit("sick", accountId, id);
    return true;
  }
  /** things the player's game saw that can make them sick: a night outside, cheap food, dirty water, skipped meals, stress */
  exposure(accountId, kind, now = Date.now()) {
    const k = `${accountId}:${kind}`;
    if ((this.lastExpo.get(k) ?? 0) > now - 2 * 6e4) return null;
    this.lastExpo.set(k, now);
    const traits = J(this.ensure(accountId).traits, []);
    const weak = traits.includes("stomach") ? 1.8 : 1;
    const table = {
      mosquito: [["malaria", 0.035]],
      street_food: [["food", 0.05 * weak], ["typhoid", 8e-3 * weak]],
      dirty_water: [["typhoid", 0.03 * weak], ["cholera", 0.012 * weak]],
      hungry: [["ulcer", 0.03]],
      stress: [["bp", 0.012]],
      harmattan: [["cough", 0.03]]
    };
    const l = this.luck(accountId, now);
    for (const [id, p] of table[kind] ?? []) if (rand2() < p * (1 - l / 200) && this.infect(accountId, id, now)) return id;
    return null;
  }
  /**
   * Every few seconds: spreading illnesses jump between players standing close in the same space; illnesses run
   * their course or get worse. Returns the accounts whose view changed (and who collapsed).
   */
  tick(players, now = Date.now(), dtSec = 10) {
    const changed = /* @__PURE__ */ new Set();
    const collapsed = /* @__PURE__ */ new Set();
    const ill = new Map(players.map((p) => [p.accountId, this.ills(p.accountId)]));
    for (const a of players) {
      const src = (ill.get(a.accountId) ?? []).filter((i) => ILLNESSES[i.id].spreads);
      if (!src.length) continue;
      for (const b of players) {
        if (b === a || b.space !== a.space || Math.hypot(a.x - b.x, a.z - b.z) > 3.5) continue;
        for (const i of src) {
          const p = (ILLNESSES[i.id].spread ?? 0) * (dtSec / 10) * (i.carrier ? 0.7 : 1);
          if (rand2() < p && this.infect(b.accountId, i.id, now)) {
            changed.add(b.accountId);
            ill.set(b.accountId, this.ills(b.accountId));
          }
        }
      }
    }
    for (const p of players) {
      const list = this.ills(p.accountId);
      if (!list.length) continue;
      let dirty = false;
      const keep = [];
      const r = this.ensure(p.accountId);
      const immune = J(r.immune, {});
      for (const i of list) {
        const d = ILLNESSES[i.id];
        const age = (now - i.at) / GAME_HOUR;
        if (age > d.hours * (i.carrier ? 1.5 : 1)) {
          if (!i.carrier && d.worsens && i.sev < 3) {
            i.sev++;
            i.at = now - d.hours * 0.5 * GAME_HOUR;
            dirty = true;
            keep.push(i);
            if (i.sev >= 3) collapsed.add(p.accountId);
            continue;
          }
          immune[i.id] = now + 72 * GAME_HOUR;
          dirty = true;
          continue;
        }
        keep.push(i);
      }
      if (dirty) {
        this.save(p.accountId, { ill: keep, immune });
        if (keep.some((i) => !i.carrier) || list.some((i) => !i.carrier)) changed.add(p.accountId);
      }
    }
    return { changed: [...changed], collapsed: [...collapsed] };
  }
  nearest(kinds, x, z, max = Infinity) {
    let best = null, bd = max;
    for (const p of this.places) if (kinds.includes(p.kind)) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }
  where(x, z) {
    const h = this.nearest(["hospital"], x, z, 90), c = this.nearest(["clinic"], x, z, 60), ph = this.nearest(["pharmacy", "clinic", "hospital"], x, z, 60), o = this.nearest(["optician"], x, z, 60);
    return { hospital: h, clinic: c ?? h, pharmacy: ph, optician: o };
  }
  /**
   * Chemist: buy a drug. The right drug clears a mild illness; the wrong one only eases (paracetamol) or does nothing.
   * Clinic: see a doctor (names what you have), run the full test (also finds what you carry), or get treated.
   * Hospital: treats everything; fixes some traits. Optician: glasses.
   */
  treat(accountId, pos, b) {
    const at = this.where(pos.x, pos.z);
    const where = String(b.where ?? "");
    const now = Date.now();
    const r = this.ensure(accountId);
    const ills = J(r.ill, []);
    const known = new Set(J(r.known, []));
    const immune = J(r.immune, {});
    const pay = (n, why) => this.econ.adjust(accountId, -n, 0, why);
    const cure = (i) => {
      immune[i.id] = now + 72 * GAME_HOUR;
    };
    if (where === "pharmacy") {
      if (!at.pharmacy) throw new HttpError(400, "There is no chemist here.");
      const drug = String(b.drug ?? "");
      const dr = DRUGS[drug];
      if (!dr) throw new HttpError(400, "They do not sell that here.");
      pay(dr.price, "health.drug");
      const hit = ills.find((i) => !i.carrier && ILLNESSES[i.id].drug === drug && i.sev <= 2);
      if (hit) {
        cure(hit);
        this.save(accountId, { ill: ills.filter((i) => i !== hit), immune });
        return { ok: true, said: `${dr.name} worked. You feel like yourself again.` };
      }
      const eases = ills.filter((i) => !i.carrier && ILLNESSES[i.id].symptoms.some((s) => dr.eases.includes(s)));
      if (eases.length) {
        for (const i of eases) i.eased = now + 3 * GAME_HOUR;
        this.save(accountId, { ill: ills });
        return { ok: true, said: `${dr.name} takes the edge off for a few hours. It is not going away on its own.` };
      }
      return { ok: true, said: `You took ${dr.name}. Nothing changed.` };
    }
    if (where === "clinic" || where === "hospital") {
      const place = where === "clinic" ? at.clinic : at.hospital;
      if (!place) throw new HttpError(400, where === "clinic" ? "There is no clinic here." : "There is no hospital here.");
      const op = String(b.op ?? "see");
      const sick = ills.filter((i) => !i.carrier);
      const k = where === "hospital" ? 1.5 : 1;
      if (op === "see") {
        pay(Math.round(3e3 * k), "health.consult");
        for (const i of sick) known.add(i.id);
        this.save(accountId, { known: [...known] });
        return { ok: true, said: sick.length ? `The doctor says: ${sick.map((i) => ILLNESSES[i.id].name).join(", ")}.` : "The doctor says you are fine. Drink water." };
      }
      if (op === "test") {
        pay(Math.round(8e3 * k), "health.test");
        for (const i of ills) known.add(i.id);
        this.save(accountId, { known: [...known] });
        const car = ills.filter((i) => i.carrier);
        return { ok: true, said: ills.length ? `Lab results: ${ills.map((i) => ILLNESSES[i.id].name + (i.carrier ? " (you carry it without feeling it)" : "")).join(", ")}.${car.length ? " You can pass it on, so get it treated." : ""}` : "Lab results: clear." };
      }
      if (op === "treat") {
        const list = ills.filter((i) => known.has(i.id));
        if (!list.length) throw new HttpError(400, "See the doctor first so they know what to treat.");
        const cost = Math.round(list.reduce((n, i) => n + ILLNESSES[i.id].clinic * i.sev, 0) * k);
        pay(cost, "health.treat");
        for (const i of list) cure(i);
        this.save(accountId, { ill: ills.filter((i) => !list.includes(i)), immune });
        this.karma(accountId, 0.5, "treated");
        return { ok: true, said: `Treated: ${list.map((i) => ILLNESSES[i.id].name).join(", ")}. \u20A6${cost.toLocaleString("en-NG")}.` };
      }
      if (op === "fix" && where === "hospital") return this.fixTrait(accountId, "hospital", String(b.drug ?? ""));
      throw new HttpError(400, "Bad request.");
    }
    if (where === "optician") {
      if (!at.optician) throw new HttpError(400, "There is no optician here.");
      return this.fixTrait(accountId, "optician", "myopia");
    }
    throw new HttpError(400, "Where?");
  }
  fixTrait(accountId, where, id) {
    const r = this.ensure(accountId);
    const traits = J(r.traits, []);
    const fixed = J(r.fixed, []);
    const t = TRAITS[id];
    if (!t?.fix || t.fix.where !== where || !traits.includes(id)) throw new HttpError(400, "Nothing to fix there.");
    if (fixed.includes(id)) throw new HttpError(409, `You already have ${t.fix.name.toLowerCase()}.`);
    this.econ.adjust(accountId, -t.fix.price, 0, "health.fix");
    fixed.push(id);
    this.save(accountId, { fixed });
    return { ok: true, said: `${t.fix.name}: done. \u20A6${t.fix.price.toLocaleString("en-NG")}.` };
  }
  // ------------------------------------------------------------------------------------------ death, the bill, the debt
  died(accountId, pos) {
    const r = this.ensure(accountId);
    const h = this.nearest(["hospital"], pos.x, pos.z) ?? this.places[0];
    const ills = J(r.ill, []);
    const sick = ills.filter((i) => !i.carrier);
    const bill = HOSPITAL_BILL[hospitalKind(h.name)] + sick.reduce((n, i) => n + ILLNESSES[i.id].clinic, 0);
    const w = this.econ.wallet(accountId);
    const have = w.cash + w.bank;
    let paid = 0, owe = 0, stripped = false;
    if (have >= bill) {
      const fromCash = Math.min(w.cash, bill);
      this.econ.adjust(accountId, -fromCash, -(bill - fromCash), "hospital.bill", { note: h.name });
      paid = bill;
    } else {
      if (have > 0) this.econ.adjust(accountId, -w.cash, -w.bank, "hospital.bill", { note: `${h.name} (short)` });
      paid = have;
      owe = bill - have;
      stripped = true;
    }
    const immune = J(r.immune, {});
    for (const i of sick) immune[i.id] = Date.now() + 72 * GAME_HOUR;
    this.save(accountId, { ill: ills.filter((i) => i.carrier), immune, debt: r.debt + owe, stripped: stripped || !!r.stripped, deaths: r.deaths + 1 });
    return { hospital: { id: h.id, name: h.name, x: h.x, z: h.z }, bill, paid, owe, debt: r.debt + owe, stripped };
  }
  /** half of what you earn goes to the hospital until the debt is gone */
  garnish(accountId, amount) {
    const r = one(this.db, "SELECT debt FROM player_body WHERE account_id=?", accountId);
    if (!r?.debt || amount <= 0) return 0;
    const take = Math.min(r.debt, Math.floor(amount * DEBT_GARNISH));
    if (take <= 0) return 0;
    const w = this.econ.adjust(accountId, -take, 0, "debt.repay", { clamp: true });
    void w;
    this.save(accountId, { debt: r.debt - take });
    if (r.debt - take === 0) this.karma(accountId, 3, "debt cleared");
    this.emit("changed", accountId);
    return take;
  }
  payDebt(accountId, amount) {
    const r = this.ensure(accountId);
    const n = Math.min(r.debt, Math.floor(Number(amount)));
    if (!(n > 0)) throw new HttpError(400, "You do not owe anything.");
    this.econ.adjust(accountId, -n, 0, "debt.repay");
    this.save(accountId, { debt: r.debt - n });
    this.karma(accountId, n / 2e4, "paid debt");
    return { debt: r.debt - n };
  }
  /** okrika clothes from a market stall after the hospital sent you out in your underwear */
  dress(accountId, pos) {
    const r = this.ensure(accountId);
    if (!r.stripped) return { stripped: false };
    if (!this.nearest(["market", "shop"], pos.x, pos.z, 120)) throw new HttpError(400, "Find a market stall that sells clothes.");
    this.econ.adjust(accountId, -3500, 0, "clothes.okrika");
    this.save(accountId, { stripped: false });
    return { stripped: false };
  }
  /** what admins see */
  admin(accountId) {
    const r = this.ensure(accountId);
    return { ...this.view(accountId), karma: r.karma, luck: Math.round(this.luck(accountId)), ill: J(r.ill, []), log: all(this.db, "SELECT at, delta, why FROM karma_log WHERE account_id=? ORDER BY at DESC LIMIT 30", accountId) };
  }
};

// server/src/devices.ts
import { EventEmitter as EventEmitter5 } from "node:events";
import { randomBytes as randomBytes3, randomInt as randomInt4 } from "node:crypto";
var rand3 = () => randomInt4(0, 2 ** 32) / 2 ** 32;
var Devices = class extends EventEmitter5 {
  constructor(db, econ, body) {
    super();
    this.db = db;
    this.econ = econ;
    this.body = body;
  }
  offers = /* @__PURE__ */ new Map();
  lastDrop = /* @__PURE__ */ new Map();
  get places() {
    return this.body.places;
  }
  /** cash first, then a transfer from the bank (every phone shop takes transfer) */
  pay(owner, n, why, note) {
    const w = this.econ.wallet(owner);
    if (w.cash + w.bank < n) throw new HttpError(402, "Not enough money.", { code: "broke" });
    const c = Math.min(w.cash, n);
    this.econ.adjust(owner, -c, -(n - c), why, { note });
  }
  shopNear(pos, r = 80) {
    return this.places.some((p) => p.kind === "phones" && Math.hypot(p.x - pos.x, p.z - pos.z) < r);
  }
  /** everyone starts with a Gidi Neo in hand */
  ensure(owner) {
    if (!one(this.db, "SELECT 1 FROM devices WHERE owner_id=?", owner)) this.add(owner, "gidi", true);
    return this.list(owner);
  }
  add(owner, model, active) {
    const id = "dv_" + randomBytes3(6).toString("hex");
    if (active) run(this.db, "UPDATE devices SET active=0 WHERE owner_id=?", owner);
    run(this.db, "INSERT INTO devices(id, owner_id, model, crack, active, bought_at) VALUES(?,?,?,?,?,?)", id, owner, model, 0, active ? 1 : 0, Date.now());
    return id;
  }
  list(owner) {
    return all(this.db, "SELECT * FROM devices WHERE owner_id=? ORDER BY bought_at", owner);
  }
  active(owner) {
    this.ensure(owner);
    return one(this.db, "SELECT * FROM devices WHERE owner_id=? AND active=1", owner) ?? this.list(owner)[0];
  }
  /** what the owner's game sees: never who cloned what */
  view(owner) {
    const l = this.ensure(owner);
    return l.map((d) => ({ id: d.id, model: d.model, crack: d.crack, active: !!d.active }));
  }
  buy(owner, model, pos) {
    const m = PHONE_MODELS[String(model)];
    if (!m) throw new HttpError(400, "They do not sell that model.");
    if (!this.shopNear(pos)) throw new HttpError(400, "Go to Computer Village or a phone stall to buy a phone.");
    if (this.list(owner).length >= 6) throw new HttpError(409, "You have enough phones. Sell or give one away first.");
    this.pay(owner, m.price, "phone.buy", m.name);
    this.add(owner, m.id, true);
    return this.view(owner);
  }
  use(owner, id) {
    const d = one(this.db, "SELECT * FROM devices WHERE id=? AND owner_id=?", String(id), owner);
    if (!d) throw new HttpError(404, "Not your phone.");
    run(this.db, "UPDATE devices SET active=CASE WHEN id=? THEN 1 ELSE 0 END WHERE owner_id=?", d.id, owner);
    return this.view(owner);
  }
  /** a hard fall, a crash, a fight: the screen may crack (tough phones and good luck help; butterfingers does not) */
  drop(owner, hard, now = Date.now()) {
    if ((this.lastDrop.get(owner) ?? 0) > now - 2e4) return null;
    this.lastDrop.set(owner, now);
    const d = this.active(owner);
    if (d.crack >= 3) return null;
    const m = PHONE_MODELS[d.model];
    const clumsy = this.body.view(owner).traits.includes("clumsy") ? 1.8 : 1;
    const p = Math.min(0.8, 0.22 * Math.max(0.2, Math.min(3, hard)) * clumsy / m.tough) * (1 - this.body.luck(owner, now) / 250);
    if (rand3() >= p) return null;
    run(this.db, "UPDATE devices SET crack=crack+1 WHERE id=?", d.id);
    return d.crack + 1;
  }
  /** time does it too: about one crack every few days of play for an ordinary phone */
  age(owner, minutes) {
    const d = this.active(owner);
    if (d.crack >= 3) return null;
    const m = PHONE_MODELS[d.model];
    if (rand3() < 12e-4 * minutes / m.tough) {
      run(this.db, "UPDATE devices SET crack=crack+1 WHERE id=?", d.id);
      return d.crack + 1;
    }
    return null;
  }
  /** a shop fixes the screen for a share of the phone's price (shops do not clone) */
  shopRepair(owner, id, pos) {
    const d = one(this.db, "SELECT * FROM devices WHERE id=? AND owner_id=?", String(id), owner);
    if (!d) throw new HttpError(404, "Not your phone.");
    if (!d.crack) throw new HttpError(400, "Nothing to fix.");
    if (!this.shopNear(pos)) throw new HttpError(400, "Take it to Computer Village or a phone stall.");
    const price = Math.round(PHONE_MODELS[d.model].price * REPAIR_SHARE[d.crack] / 100) * 100;
    this.pay(owner, price, "phone.repair");
    run(this.db, "UPDATE devices SET crack=0 WHERE id=?", d.id);
    return { price, phones: this.view(owner) };
  }
  /** a trusted shop wipes the phone; whoever kept a copy loses it */
  clean(owner, id, pos) {
    const d = one(this.db, "SELECT * FROM devices WHERE id=? AND owner_id=?", String(id), owner);
    if (!d) throw new HttpError(404, "Not your phone.");
    if (!this.shopNear(pos)) throw new HttpError(400, "Take it to Computer Village or a phone stall.");
    this.pay(owner, PHONE_CLEAN_PRICE, "phone.clean");
    const had = !!d.cloned_by;
    run(this.db, "UPDATE devices SET cloned_by=NULL, cloned_at=NULL WHERE id=?", d.id);
    return { found: had, phones: this.view(owner) };
  }
  // ------------------------------------------------------------------------------------------ player repairers
  /** a repairer offers to fix a nearby player's screen. `clone` is the repairer's private choice; the customer never sees it. */
  offer(from, fromName, to, price, clone) {
    if (from === to) throw new HttpError(400, "You cannot fix your own phone like that.");
    const d = this.active(to);
    if (!d.crack) throw new HttpError(400, "Their screen is fine.");
    const p = Math.floor(Number(price));
    if (!(p >= 500 && p <= 5e5)) throw new HttpError(400, "Set a price between \u20A6500 and \u20A6500,000.");
    for (const [k, o2] of this.offers) if (o2.from === from || Date.now() - o2.at > 12e4) this.offers.delete(k);
    const o = { id: "of_" + randomBytes3(5).toString("hex"), from, fromName, to, device: d.id, price: p, clone: !!clone, at: Date.now() };
    this.offers.set(o.id, o);
    return o;
  }
  /** the customer says yes: they pay, the screen is fixed, and maybe the repairer keeps a copy */
  accept(to, offerId, hackLevel) {
    const o = this.offers.get(String(offerId));
    if (!o || o.to !== to || Date.now() - o.at > 12e4) throw new HttpError(404, "That offer is gone.");
    this.offers.delete(o.id);
    const d = one(this.db, "SELECT * FROM devices WHERE id=?", o.device);
    if (!d || d.owner_id !== to || !d.crack) throw new HttpError(409, "Nothing to fix any more.");
    this.econ.transfer(to, o.from, o.price, "phone repair");
    run(this.db, "UPDATE devices SET crack=0 WHERE id=?", d.id);
    let cloned = false;
    if (o.clone) {
      const chance = Math.max(0.1, Math.min(0.95, 0.35 + hackLevel * 0.08 - this.body.luck(to) / 300));
      if (rand3() < chance) {
        run(this.db, "UPDATE devices SET cloned_by=?, cloned_at=? WHERE id=?", o.from, Date.now(), d.id);
        cloned = true;
      }
      this.body.karma(o.from, -6, "cloned a phone");
    } else this.body.karma(o.from, 1, "honest repair");
    return { offer: o, cloned };
  }
  // ------------------------------------------------------------------------------------------ the clone
  /** phones I hold a copy of; a copy only works while the owner still uses that phone */
  clones(hacker) {
    return all(this.db, "SELECT d.*, p.name FROM devices d LEFT JOIN profiles p ON p.account_id=d.owner_id WHERE d.cloned_by=? ORDER BY d.cloned_at DESC", hacker).map((d) => ({ device: d.id, owner: d.owner_id, name: d.name ?? "Someone", model: d.model, live: !!d.active, since: d.cloned_at }));
  }
  /** a live clone or an error */
  clone(hacker, device) {
    const d = one(this.db, "SELECT * FROM devices WHERE id=? AND cloned_by=?", String(device), hacker);
    if (!d) throw new HttpError(404, "You have no copy of that phone.");
    if (!d.active) throw new HttpError(409, "They are using another phone now. Your copy shows nothing new.");
    return d;
  }
  /** move money out of a cloned phone's bank app, a little per day; the owner may get an alert */
  steal(hacker, device, amount) {
    const d = this.clone(hacker, device);
    const n = Math.floor(Number(amount));
    if (!(n >= 100)) throw new HttpError(400, "Bad amount.");
    const day = lagosDay(Date.now());
    const since = Date.parse(day + "T00:00:00Z") - 36e5;
    const used = one(this.db, "SELECT COALESCE(SUM(amount),0) s FROM clone_moves WHERE device=? AND kind='bank' AND at>?", d.id, since).s;
    const take = Math.min(n, CLONE_DAY_LIMIT - used, this.econ.wallet(d.owner_id).bank);
    if (take <= 0) throw new HttpError(409, "Nothing more to move today.");
    this.econ.adjust(d.owner_id, 0, -take, "bank.transfer.out", { note: "phone" });
    this.econ.adjust(hacker, take, 0, "clone.cash");
    run(this.db, "INSERT INTO clone_moves(device, hacker, kind, amount, at) VALUES(?,?,?,?,?)", d.id, hacker, "bank", take, Date.now());
    this.body.karma(hacker, -take / 4e3, "stole through a clone");
    const alert = rand3() < Math.max(0.2, Math.min(0.9, 0.5 + this.body.luck(d.owner_id) / 200));
    if (alert) this.emit("alert", d.owner_id, `Your bank: \u20A6${take.toLocaleString("en-NG")} went out from your phone. Not you? Clean your phone at a phone shop.`);
    return { took: take, alerted: alert };
  }
  noteMove(device, hacker, kind) {
    run(this.db, "INSERT INTO clone_moves(device, hacker, kind, at) VALUES(?,?,?,?)", device, hacker, kind, Date.now());
  }
};

// v2/src/net/exchange.ts
var TICKERS = [
  { sym: "DANFO", name: "Oshodi Danfo Transport", sector: "Transport", base: 420, vol: 0.9, drift: 0.02, seed: 11, blurb: "Yellow buses on every route from Oshodi to Ikeja.", shares: 4e7 },
  { sym: "LPOWR", name: "Lagos Power Plc", sector: "Utilities", base: 1280, vol: 1.2, drift: -0.01, seed: 23, blurb: "Runs the grid. When the light holds, so does the price.", shares: 9e7 },
  { sym: "FHB", name: "First Hustle Bank", sector: "Banking", base: 2150, vol: 0.6, drift: 0.03, seed: 37, blurb: "Accounts, POS, loans with interest that bites.", shares: 12e7 },
  { sym: "CHOPN", name: "ChopNow Foods", sector: "Consumer", base: 760, vol: 1.1, drift: 0.04, seed: 41, blurb: "Jollof to your door in thirty minutes or less.", shares: 25e6 },
  { sym: "CVTEK", name: "Computer Village Tech", sector: "Technology", base: 3450, vol: 1.5, drift: 0.05, seed: 53, blurb: "Phones, repairs, and the odd phone that was not yours.", shares: 18e6 },
  { sym: "EKOPT", name: "Eko Petroleum", sector: "Energy", base: 5200, vol: 1.3, drift: 0, seed: 67, blurb: "Filling stations across the mainland. Scarcity is good business.", shares: 6e7 },
  { sym: "EKCEM", name: "Eko Cement and Blocks", sector: "Construction", base: 1890, vol: 0.8, drift: 0.03, seed: 71, blurb: "Every new storey in Lagos starts with their bags.", shares: 75e6 },
  { sym: "OKRKA", name: "Okrika Kings Textiles", sector: "Retail", base: 180, vol: 1.4, drift: 0.01, seed: 83, blurb: "Bales from abroad, sorted and sold by the piece.", shares: 3e7 },
  { sym: "PURE", name: "Pure Water Nigeria", sector: "Consumer", base: 95, vol: 1, drift: 0.02, seed: 97, blurb: "Sachet water for every hawker and every hot afternoon.", shares: 5e7 },
  { sym: "SUYA", name: "Mallam Suya Holdings", sector: "Consumer", base: 640, vol: 0.9, drift: 0.02, seed: 103, blurb: "Spice, smoke and a stand on every corner after dark.", shares: 12e6 },
  { sym: "ZILOX", name: "ZILOX Entertainment", sector: "Leisure", base: 2900, vol: 1.7, drift: 0.02, seed: 113, blurb: "Clubs, shutdowns and the loudest nights in Ikoyi.", shares: 1e7 },
  { sym: "NAIJA", name: "Naija Waves Media", sector: "Media", base: 540, vol: 1.2, drift: 0.03, seed: 127, blurb: "Radio, streaming and the songs the clubs play.", shares: 22e6 }
];
var TICKER = new Map(TICKERS.map((t) => [t.sym, t]));
var EX_FEE = 0.01;
var EX_FEE_MIN = 50;
var EX_SPREAD = 4e-3;
var EX_MAX_ORDER = 5e6;
var EX_MAX_HOLD = 2e5;
var EPOCH = Date.UTC(2026, 9, 1);
function hash(n) {
  let x = Math.imul(n ^ 2654435769, 2246822507);
  x ^= x >>> 13;
  x = Math.imul(x, 3266489909);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function vnoise(t, seed) {
  const i = Math.floor(t), f = t - i;
  const a = hash(i * 7919 + seed * 104729) * 2 - 1, b = hash((i + 1) * 7919 + seed * 104729) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}
function midPrice(t, ms) {
  const h = (ms - EPOCH) / 36e5;
  const v = t.vol;
  const f = 0.15 * v * vnoise(h / 120, t.seed) + 0.035 * v * vnoise(h / 20, t.seed + 1) + 0.012 * v * vnoise(h / 3, t.seed + 2) + 5e-3 * v * vnoise(h / 0.4, t.seed + 3) + 18e-4 * v * vnoise(h / 0.08, t.seed + 4);
  const drift = t.drift * (h / (24 * 30));
  return Math.max(1, t.base * Math.exp(f + drift));
}
function priceAt(t, ms, pressure = 1) {
  return Math.round(midPrice(t, ms) * pressure * 100) / 100;
}
function history(t, ms, spanMs, n = 48, pressure = 1) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(priceAt(t, ms - spanMs + spanMs * i / (n - 1), pressure));
  return out;
}
function dayOpen(ms) {
  const d = new Date(ms);
  const open = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9);
  return ms >= open ? open : open - 864e5;
}
function quoteOf(t, ms, pressure = 1) {
  const p = priceAt(t, ms, pressure), o = priceAt(t, dayOpen(ms), pressure);
  const day = history(t, ms, ms - dayOpen(ms) || 6e4, 24, pressure);
  return { sym: t.sym, price: p, open: o, change: o ? (p - o) / o : 0, high: Math.max(...day), low: Math.min(...day), cap: p * t.shares, buy: Math.round(p * (1 + EX_SPREAD / 2) * 100) / 100, sell: Math.round(p * (1 - EX_SPREAD / 2) * 100) / 100 };
}
function feeOf(value) {
  return Math.max(EX_FEE_MIN, Math.round(value * EX_FEE));
}
var BIZ_UNITS = 100;
var BIZ_OWNER_MIN = 51;

// server/src/exchange.ts
var HALF_LIFE = 6 * 36e5;
var Exchange = class {
  constructor(db, econ) {
    this.db = db;
    this.econ = econ;
  }
  /** how far real players have pushed a price (1 = not at all); fades back over hours */
  pressure(sym, now = Date.now()) {
    const r = one(this.db, "SELECT p, at FROM ex_pressure WHERE sym=?", sym);
    if (!r) return 1;
    return 1 + (r.p - 1) * Math.pow(0.5, (now - r.at) / HALF_LIFE);
  }
  pressures(now = Date.now()) {
    const out = {};
    for (const t of TICKERS) out[t.sym] = Math.round(this.pressure(t.sym, now) * 1e4) / 1e4;
    return out;
  }
  quote(sym, now = Date.now()) {
    const t = TICKER.get(sym);
    if (!t) throw new HttpError(404, "No such company on the exchange.");
    return quoteOf(t, now, this.pressure(sym, now));
  }
  /** pay from the bank first, then cash (the app is a bank app) */
  pay(acct, n, why, note) {
    const w = this.econ.wallet(acct);
    if (w.cash + w.bank < n) throw new HttpError(402, "Not enough money in your bank and pocket.", { code: "broke" });
    const b = Math.min(w.bank, n);
    this.econ.adjust(acct, -(n - b), -b, why, { note });
  }
  trade(acct, symRaw, sideRaw, qtyRaw, now = Date.now()) {
    const sym = String(symRaw ?? "").toUpperCase();
    const t = TICKER.get(sym);
    if (!t) throw new HttpError(404, "No such company on the exchange.");
    const side = sideRaw === "sell" ? "sell" : sideRaw === "buy" ? "buy" : null;
    if (!side) throw new HttpError(400, "Buy or sell?");
    const qty = Math.floor(Number(qtyRaw));
    if (!(qty >= 1)) throw new HttpError(400, "How many shares?");
    const q = this.quote(sym, now);
    const price = side === "buy" ? q.buy : q.sell;
    const value = Math.round(price * qty);
    if (value > EX_MAX_ORDER) throw new HttpError(400, `One order can move at most \u20A6${EX_MAX_ORDER.toLocaleString("en-NG")}.`);
    const fee = feeOf(value);
    return this.db.transaction(() => {
      const h = one(this.db, "SELECT * FROM holdings WHERE account_id=? AND sym=?", acct, sym);
      if (side === "buy") {
        if ((h?.qty ?? 0) + qty > EX_MAX_HOLD) throw new HttpError(400, `You can hold at most ${EX_MAX_HOLD.toLocaleString()} shares of one company.`);
        this.pay(acct, value + fee, "ex.buy", `${qty} ${sym}`);
        if (h) run(this.db, "UPDATE holdings SET qty=qty+?, cost=cost+? WHERE account_id=? AND sym=?", qty, value + fee, acct, sym);
        else run(this.db, "INSERT INTO holdings(account_id, sym, qty, cost) VALUES(?,?,?,?)", acct, sym, qty, value + fee);
      } else {
        if (!h || h.qty < qty) throw new HttpError(400, "You do not have that many shares.");
        const left = h.qty - qty;
        const costOut = h.cost * (qty / h.qty);
        if (left === 0) run(this.db, "DELETE FROM holdings WHERE account_id=? AND sym=?", acct, sym);
        else run(this.db, "UPDATE holdings SET qty=?, cost=cost-? WHERE account_id=? AND sym=?", left, costOut, acct, sym);
        this.econ.adjust(acct, 0, Math.max(0, value - fee), "ex.sell", { note: `${qty} ${sym}` });
      }
      run(this.db, "INSERT INTO trades(account_id, sym, side, qty, price, fee, at) VALUES(?,?,?,?,?,?,?)", acct, sym, side, qty, price, fee, now);
      const p0 = this.pressure(sym, now);
      const liq = t.base * t.shares * 2e-3;
      const p1 = Math.max(0.7, Math.min(1.4, p0 * Math.exp((side === "buy" ? 1 : -1) * 0.1 * value / liq)));
      run(this.db, "INSERT INTO ex_pressure(sym, p, at) VALUES(?,?,?) ON CONFLICT(sym) DO UPDATE SET p=excluded.p, at=excluded.at", sym, p1, now);
      return { sym, side, qty, price, value, fee, quote: this.quote(sym, now), wallet: this.econ.wallet(acct) };
    })();
  }
  portfolio(acct, now = Date.now()) {
    const hs = all(this.db, "SELECT * FROM holdings WHERE account_id=? ORDER BY sym", acct).map((h) => {
      const q = this.quote(h.sym, now);
      const value = Math.round(q.sell * h.qty);
      return { sym: h.sym, qty: h.qty, cost: Math.round(h.cost), value, pnl: value - Math.round(h.cost), price: q.price, change: q.change };
    });
    const trades = all(this.db, "SELECT sym, side, qty, price, fee, at FROM trades WHERE account_id=? ORDER BY at DESC LIMIT 30", acct);
    return { holdings: hs, value: hs.reduce((n, h) => n + h.value, 0), cost: hs.reduce((n, h) => n + h.cost, 0), trades, pressure: this.pressures(now) };
  }
  // ------------------------------------------------------------------------------------------ stakes in players' shops
  owner(site) {
    return one(this.db, "SELECT owner_id, type, till FROM businesses WHERE site=?", site);
  }
  /** units each holder has; the owner holds whatever nobody else does */
  stakes(site) {
    const o = this.owner(site);
    if (!o) return null;
    const inv = all(this.db, "SELECT holder_id, units, cost FROM biz_shares WHERE site=? AND holder_id != ? AND units > 0", site, o.owner_id);
    return { owner: o.owner_id, ownerUnits: BIZ_UNITS - inv.reduce((n, r) => n + r.units, 0), investors: inv };
  }
  unitsOf(site, who) {
    const s = this.stakes(site);
    if (!s) return 0;
    return who === s.owner ? s.ownerUnits : s.investors.find((r) => r.holder_id === who)?.units ?? 0;
  }
  offered(site, who) {
    return one(this.db, "SELECT COALESCE(SUM(units),0) n FROM biz_offers WHERE site=? AND seller_id=?", site, who).n;
  }
  /** put units of a shop up for sale at a price per unit */
  offer(acct, siteRaw, unitsRaw, priceRaw) {
    const site = String(siteRaw ?? "");
    const s = this.stakes(site);
    if (!s) throw new HttpError(404, "No such business.");
    const units = Math.floor(Number(unitsRaw)), price = Math.floor(Number(priceRaw));
    if (!(units >= 1 && units <= 49)) throw new HttpError(400, "Offer between 1 and 49 units.");
    if (!(price >= 1e3 && price <= 5e7)) throw new HttpError(400, "Price each unit between \u20A61,000 and \u20A650,000,000.");
    const have = this.unitsOf(site, acct) - this.offered(site, acct);
    if (acct === s.owner ? have - units < BIZ_OWNER_MIN : have < units) throw new HttpError(400, acct === s.owner ? `You must keep at least ${BIZ_OWNER_MIN} units of your own business.` : "You do not have that many units.");
    const r = run(this.db, "INSERT INTO biz_offers(site, seller_id, units, price, at) VALUES(?,?,?,?,?)", site, acct, units, price, Date.now());
    return { id: Number(r.lastInsertRowid) };
  }
  cancel(acct, idRaw) {
    const n = run(this.db, "DELETE FROM biz_offers WHERE id=? AND seller_id=?", Number(idRaw), acct).changes;
    if (!n) throw new HttpError(404, "No such offer.");
  }
  /** buy units from an offer; the seller is paid at once, 1% goes in fees */
  take(acct, idRaw, unitsRaw) {
    return this.db.transaction(() => {
      const o = one(this.db, "SELECT * FROM biz_offers WHERE id=?", Number(idRaw));
      if (!o) throw new HttpError(404, "That offer is gone.");
      if (o.seller_id === acct) throw new HttpError(400, "That is your own offer.");
      const units = Math.min(o.units, Math.max(1, Math.floor(Number(unitsRaw) || o.units)));
      if (this.unitsOf(o.site, o.seller_id) < units) {
        run(this.db, "DELETE FROM biz_offers WHERE id=?", o.id);
        throw new HttpError(409, "The seller no longer has those units.");
      }
      const value = units * o.price;
      const fee = feeOf(value);
      this.pay(acct, value + fee, "bx.buy", `${units} units of ${o.site}`);
      this.econ.adjust(o.seller_id, 0, value, "bx.sell", { note: `${units} units of ${o.site}` });
      const s = this.stakes(o.site);
      if (o.seller_id !== s.owner) run(this.db, "UPDATE biz_shares SET units=units-?, cost=cost*(1.0 - ?*1.0/units) WHERE site=? AND holder_id=?", units, units, o.site, o.seller_id);
      if (acct !== s.owner) run(this.db, "INSERT INTO biz_shares(site, holder_id, units, cost) VALUES(?,?,?,?) ON CONFLICT(site, holder_id) DO UPDATE SET units=units+excluded.units, cost=cost+excluded.cost", o.site, acct, units, value + fee);
      run(this.db, "DELETE FROM biz_shares WHERE units <= 0");
      if (units >= o.units) run(this.db, "DELETE FROM biz_offers WHERE id=?", o.id);
      else run(this.db, "UPDATE biz_offers SET units=units-? WHERE id=?", units, o.id);
      return { units, value, fee, seller: o.seller_id, site: o.site, wallet: this.econ.wallet(acct) };
    })();
  }
  /** when the owner empties the till: investors get their share straight into the bank; returns the owner's part */
  split(site, owner, n) {
    const s = this.stakes(site);
    if (!s || !s.investors.length) return n;
    let paid = 0;
    const now = Date.now();
    for (const r of s.investors) {
      const amt = Math.floor(n * r.units / BIZ_UNITS);
      if (amt <= 0) continue;
      this.econ.adjust(r.holder_id, 0, amt, "bx.dividend", { ref: site });
      paid += amt;
      run(this.db, "INSERT INTO biz_payouts(site, holder_id, amount, at) VALUES(?,?,?,?)", site, r.holder_id, amt, now);
    }
    void owner;
    return n - paid;
  }
  /** every shop with units on offer or outside investors, for the Businesses tab */
  market() {
    const sites = all(this.db, "SELECT DISTINCT site FROM biz_offers UNION SELECT DISTINCT site FROM biz_shares WHERE units > 0");
    return sites.map(({ site }) => {
      const b = one(this.db, "SELECT b.owner_id, b.type, b.till, p.name owner_name FROM businesses b LEFT JOIN profiles p ON p.account_id=b.owner_id WHERE b.site=?", site);
      if (!b) return null;
      const offers = all(this.db, "SELECT o.id, o.seller_id, o.units, o.price, p.name FROM biz_offers o LEFT JOIN profiles p ON p.account_id=o.seller_id WHERE o.site=? ORDER BY o.price", site);
      const paid = one(this.db, "SELECT COALESCE(SUM(amount),0) n FROM biz_payouts WHERE site=? AND at > ?", site, Date.now() - 7 * 864e5).n;
      const s = this.stakes(site);
      return { site, type: b.type, label: bizType(b.type)?.name ?? b.type, owner: b.owner_name ?? "Somebody", ownerId: b.owner_id, ownerUnits: s.ownerUnits, investors: s.investors.length, paidWeek: paid, offers };
    }).filter(Boolean);
  }
  /** my stakes in other people's shops, and what they paid me */
  mine(acct) {
    const st = all(this.db, "SELECT site, units, cost FROM biz_shares WHERE holder_id=? AND units > 0", acct).map((r) => ({ ...r, paid: one(this.db, "SELECT COALESCE(SUM(amount),0) n FROM biz_payouts WHERE site=? AND holder_id=?", r.site, acct).n, type: this.owner(r.site)?.type ?? "" }));
    const offers = all(this.db, "SELECT id, site, units, price FROM biz_offers WHERE seller_id=?", acct);
    return { stakes: st, offers };
  }
};

// server/src/grid.ts
import { EventEmitter as EventEmitter6 } from "node:events";
import { readFileSync as readFileSync6 } from "node:fs";
import { resolve as resolve4 } from "node:path";
var FEEDERS = JSON.parse(readFileSync6(resolve4(PATHS.sharedData, "feeders.json"), "utf8"));
var Grid = class extends EventEmitter6 {
  constructor(now = Date.now) {
    super();
    this.now = now;
  }
  /** operator switches: hold until `until` (game hours) */
  override = /* @__PURE__ */ new Map();
  /** admin forcing: holds until cleared (or until `until` if set) */
  forced = /* @__PURE__ */ new Map();
  collapseUntil = 0;
  genScale = 1;
  last = "";
  total = FEEDERS.reduce((s, f) => s + f.load, 0);
  hours() {
    return worldHours(this.now());
  }
  gen(h = this.hours()) {
    return Math.round(generation(h, this.total) * this.genScale);
  }
  state() {
    const h = this.hours();
    for (const [f, o] of this.override) if (o.until <= h) this.override.delete(f);
    for (const [f, o] of this.forced) if (o.until <= h) this.forced.delete(f);
    return gridState(FEEDERS, h, { forced: this.forced, override: this.override, collapseUntil: this.collapseUntil, genScale: this.genScale });
  }
  /** called every second by the hub: tells listeners when any feeder changes */
  tick() {
    const s = this.state();
    const k = s.on + (s.collapse ? "x" : "");
    if (k !== this.last) {
      const prev = this.last;
      this.last = k;
      this.emit("change", s, prev);
    }
    return s;
  }
  /** an operator in the control room flips a feeder now, or schedules it: `inHours` from now (up to 12), for `hours`
   *  (up to 6). Returns the new state. */
  switch(f, on2, by, inHours = 0, hours = GRID_OVERRIDE_HOURS) {
    if (!FEEDERS.some((x) => x.i === f)) throw new Error("no such feeder");
    const now = this.hours();
    const from = now + Math.max(0, Math.min(12, inHours || 0));
    const len = Math.max(0.5, Math.min(6, hours || GRID_OVERRIDE_HOURS));
    this.override.set(f, { on: on2, until: from + len, by, from: inHours > 0 ? from : void 0 });
    return this.tick();
  }
  force(f, on2, hours = 24) {
    const ids = f === "all" ? FEEDERS.map((x) => x.i) : [f];
    for (const i of ids) {
      if (on2 === null) this.forced.delete(i);
      else this.forced.set(i, { on: on2, until: this.hours() + hours });
    }
    return this.tick();
  }
  collapse(hours) {
    this.collapseUntil = hours > 0 ? this.hours() + hours : 0;
    return this.tick();
  }
  /** for the admin panel and the control room console */
  board() {
    const s = this.state();
    const h = this.hours();
    return { ...s, hour: h % 24, feeders: FEEDERS.map((f) => ({ ...f, on: s.on[f.i] === "1", planned: scheduledOn(f.i, f.band, h), op: this.override.get(f.i) ?? null, forced: this.forced.get(f.i) ?? null })), bands: BAND_HOURS, genScale: this.genScale };
  }
};

// v2/src/net/protocol.ts
var PROTOCOL_VERSION = 1;
var CELL = 250;
var ROOM_CELLS = 8;
var MSG_STATE = 1;
var MSG_SNAP = 2;
var VEH_BIT = 32768;
var ANIMS = ["idle", "walk", "jog", "sprint", "crouch", "crouchWalk", "jump", "fall", "drive", "swim", "swimIdle", "dead", "heal", "claw", "cast", "climb", "mantle"];
var VKINDS = ["okada", "danfo", "suv", "sedan", "hatch", "jeep", "police", "keke"];
var VKIND_TOP = { okada: 30, danfo: 22, suv: 28, sedan: 33, hatch: 30, jeep: 36, police: 34, keke: 15 };
var EMOTES = ["wave", "dance", "phone", "no", "talk", "arms"];
var F = { ALIVE: 1, SPRINT: 2, CROUCH: 4, AIM: 8, VEH: 16, FIRE: 32, GROUND: 64, SWIM: 128, PHONE: 256, HORN: 512, FLASH: 1024 };
var VF = { LIGHTS: 1, HORN: 2, SIREN: 4, WRECK: 8, BRAKE: 16, DRIVEN: 32 };
var Writer = class {
  buf;
  dv;
  o = 0;
  constructor(size = 256) {
    this.buf = new Uint8Array(size);
    this.dv = new DataView(this.buf.buffer);
  }
  need(n) {
    if (this.o + n <= this.buf.length) return;
    let s = this.buf.length * 2;
    while (s < this.o + n) s *= 2;
    const nb = new Uint8Array(s);
    nb.set(this.buf);
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v) {
    this.need(1);
    this.dv.setUint8(this.o++, v);
  }
  i8(v) {
    this.need(1);
    this.dv.setInt8(this.o++, v);
  }
  u16(v) {
    this.need(2);
    this.dv.setUint16(this.o, v, true);
    this.o += 2;
  }
  i16(v) {
    this.need(2);
    this.dv.setInt16(this.o, v, true);
    this.o += 2;
  }
  u32(v) {
    this.need(4);
    this.dv.setUint32(this.o, v >>> 0, true);
    this.o += 4;
  }
  i32(v) {
    this.need(4);
    this.dv.setInt32(this.o, v | 0, true);
    this.o += 4;
  }
  f32(v) {
    this.need(4);
    this.dv.setFloat32(this.o, v, true);
    this.o += 4;
  }
  bytes() {
    return this.buf.subarray(0, this.o);
  }
};
var Reader = class {
  constructor(buf) {
    this.buf = buf;
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  dv;
  o = 0;
  get left() {
    return this.buf.length - this.o;
  }
  u8() {
    return this.dv.getUint8(this.o++);
  }
  i8() {
    return this.dv.getInt8(this.o++);
  }
  u16() {
    const v = this.dv.getUint16(this.o, true);
    this.o += 2;
    return v;
  }
  i16() {
    const v = this.dv.getInt16(this.o, true);
    this.o += 2;
    return v;
  }
  u32() {
    const v = this.dv.getUint32(this.o, true);
    this.o += 4;
    return v;
  }
  i32() {
    const v = this.dv.getInt32(this.o, true);
    this.o += 4;
    return v;
  }
  f32() {
    const v = this.dv.getFloat32(this.o, true);
    this.o += 4;
    return v;
  }
};
var TAU = Math.PI * 2;
var cm = (m) => Math.round(m * 100);
function packYaw(r) {
  const t = (r % TAU + TAU) % TAU;
  return Math.round(t / TAU * 65536) & 65535;
}
function unpackYaw(u) {
  return u / 65536 * TAU;
}
var packPitch = (r) => Math.max(-127, Math.min(127, Math.round(r / 1.5708 * 127)));
var unpackPitch = (i) => i / 127 * 1.5708;
var packQ = (v) => Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
var unpackQ = (i) => i / 32767;
var packSteer = (r) => Math.max(-127, Math.min(127, Math.round(r / 0.8 * 127)));
var unpackSteer = (i) => i / 127 * 0.8;
var packSpin = (r) => packYaw(r);
var unpackSpin = (u) => unpackYaw(u);
function packDoors(d) {
  let b = 0;
  for (let i = 0; i < 4; i++) b |= Math.max(0, Math.min(15, Math.round((d[i] ?? 0) * 15))) << i * 4;
  return b;
}
function unpackDoors(b) {
  return [(b & 15) / 15, (b >> 4 & 15) / 15, (b >> 8 & 15) / 15, (b >> 12 & 15) / 15];
}
function decodeState(buf) {
  try {
    if (buf.length < 23 || buf[0] !== MSG_STATE) return null;
    const r = new Reader(buf);
    r.u8();
    const seq = r.u16(), flags = r.u16();
    const x = r.f32(), y = r.f32(), z = r.f32();
    const yaw = unpackYaw(r.u16()), pitch = unpackPitch(r.i8()), speed = r.u8() / 4, anim = r.u8(), weapon = r.u8();
    if (!Number.isFinite(x + y + z)) return null;
    let veh = null;
    if (flags & F.VEH) {
      if (r.left < 34) return null;
      const kind = r.u8(), seat = r.u8(), seed = r.u32();
      const vx = r.f32(), vy = r.f32(), vz = r.f32();
      const qx = unpackQ(r.i16()), qy = unpackQ(r.i16()), qz = unpackQ(r.i16()), qw = unpackQ(r.i16());
      const steer = unpackSteer(r.i8()), spin = unpackSpin(r.u16()), doors = unpackDoors(r.u16()), vflags = r.u8(), vspeed = r.i16() / 100;
      if (!Number.isFinite(vx + vy + vz) || kind >= VKINDS.length) return null;
      veh = { kind, seat, seed, x: vx, y: vy, z: vz, qx, qy, qz, qw, steer, spin, doors, vflags, vspeed };
    }
    return { seq, flags, x, y, z, yaw, pitch, speed, anim, weapon, veh };
  } catch {
    return null;
  }
}
var newPlayerEnt = (id) => ({ k: 0, id, X: 0, Y: 0, Z: 0, yaw: 0, pitch: 0, anim: 0, speed: 0, flags: 0, weapon: 0, veh: 0, seat: 0 });
var newVehEnt = (id) => ({ k: 1, id, kind: 0, seed: 0, driver: 0, X: 0, Y: 0, Z: 0, qx: 0, qy: 0, qz: 0, qw: 32767, steer: 0, spin: 0, doors: 0, vflags: 0, vspeed: 0 });
var M_FULL = 1;
var M_ROT = 2;
var M_ANIM = 4;
var M_VEH = 8;
var V_FULL = 1;
var V_QUAT = 2;
var V_WHEEL = 4;
var V_SPEED = 8;
var D16 = 32767;
function writeEntity(w, e, base) {
  if (e.k === 0) {
    const b2 = base;
    let mask2 = 0;
    const dx2 = b2 ? e.X - b2.X : 0, dy2 = b2 ? e.Y - b2.Y : 0, dz2 = b2 ? e.Z - b2.Z : 0;
    const full2 = !b2 || Math.abs(dx2) > D16 || Math.abs(dy2) > D16 || Math.abs(dz2) > D16;
    if (full2 || dx2 || dy2 || dz2) mask2 |= M_FULL;
    if (!b2 || e.yaw !== b2.yaw || e.pitch !== b2.pitch) mask2 |= M_ROT;
    if (!b2 || e.anim !== b2.anim || e.speed !== b2.speed || e.flags !== b2.flags || e.weapon !== b2.weapon) mask2 |= M_ANIM;
    if (!b2 || e.veh !== b2.veh || e.seat !== b2.seat) mask2 |= M_VEH;
    if (!mask2) return false;
    w.u16(e.id);
    w.u8(mask2 | (full2 ? 128 : 0));
    if (mask2 & M_FULL) {
      if (full2) {
        w.i32(e.X);
        w.i32(e.Y);
        w.i32(e.Z);
      } else {
        w.i16(dx2);
        w.i16(dy2);
        w.i16(dz2);
      }
    }
    if (mask2 & M_ROT) {
      w.u16(e.yaw);
      w.i8(e.pitch);
    }
    if (mask2 & M_ANIM) {
      w.u8(e.anim);
      w.u8(e.speed);
      w.u16(e.flags);
      w.u8(e.weapon);
    }
    if (mask2 & M_VEH) {
      w.u16(e.veh);
      w.u8(e.seat);
    }
    if (b2) Object.assign(b2, e);
    return true;
  }
  const b = base;
  let mask = 0;
  const dx = b ? e.X - b.X : 0, dy = b ? e.Y - b.Y : 0, dz = b ? e.Z - b.Z : 0;
  const full = !b || Math.abs(dx) > D16 || Math.abs(dy) > D16 || Math.abs(dz) > D16;
  if (full || dx || dy || dz) mask |= V_FULL;
  if (!b || e.qx !== b.qx || e.qy !== b.qy || e.qz !== b.qz || e.qw !== b.qw) mask |= V_QUAT;
  if (!b || e.steer !== b.steer || e.spin !== b.spin || e.doors !== b.doors || e.vflags !== b.vflags) mask |= V_WHEEL;
  if (!b || e.vspeed !== b.vspeed || e.driver !== b.driver) mask |= V_SPEED;
  if (!mask) return false;
  w.u16(e.id);
  w.u8(mask | (full ? 128 : 0));
  if (!b) {
    w.u8(e.kind);
    w.u32(e.seed);
  }
  if (mask & V_FULL) {
    if (full) {
      w.i32(e.X);
      w.i32(e.Y);
      w.i32(e.Z);
    } else {
      w.i16(dx);
      w.i16(dy);
      w.i16(dz);
    }
  }
  if (mask & V_QUAT) {
    w.i16(e.qx);
    w.i16(e.qy);
    w.i16(e.qz);
    w.i16(e.qw);
  }
  if (mask & V_WHEEL) {
    w.i8(e.steer);
    w.u16(e.spin);
    w.u16(e.doors);
    w.u8(e.vflags);
  }
  if (mask & V_SPEED) {
    w.i16(e.vspeed);
    w.u16(e.driver);
  }
  if (b) Object.assign(b, e);
  return true;
}
function beginSnapshot(w, h) {
  w.o = 0;
  w.u8(MSG_SNAP);
  w.u32(h.time >>> 0);
  w.u16(h.ack & 65535);
  const countAt = w.o;
  w.u16(0);
  return countAt;
}
function endSnapshot(w, countAt, count, removed) {
  w.dv.setUint16(countAt, count, true);
  w.u16(removed.length);
  for (const id of removed) w.u16(id);
  return w.bytes();
}

// server/src/realtime/hub.ts
import { randomInt as randomInt6 } from "node:crypto";

// server/src/realtime/races.ts
var TYPES = ["sprint", "circuit", "drag"];
var WAGERS = [5e3, 2e4, 1e5, 5e5];
var MAX = 8;
var RaceLobbies = class {
  constructor(d) {
    this.d = d;
  }
  lobbies = /* @__PURE__ */ new Map();
  byAccount = /* @__PURE__ */ new Map();
  view(l) {
    return { t: "lobby", key: l.key, x: l.x, z: l.z, type: l.type, wager: l.wager, host: l.host, state: l.state, startAt: l.startAt, seed: l.seed, members: [...l.members.values()].map((m) => ({ id: m.accountId, name: m.name, ms: m.finishMs, dnf: m.dnf })) };
  }
  /** join (or open) the lobby at a meet spot; the wager is taken now and refunded if you leave before the start */
  join(accountId, name, at, a) {
    const key = String(a.key ?? "").slice(0, 40);
    const mx = Number(a.x), mz = Number(a.z);
    if (!key || !Number.isFinite(mx) || !Number.isFinite(mz)) throw new HttpError(400, "Bad meet.");
    if (Math.hypot(at.x - mx, at.z - mz) > 40) throw new HttpError(400, "Drive to the meet first.");
    if (this.byAccount.has(accountId)) throw new HttpError(400, "You are already in a race.");
    let l = this.lobbies.get(key);
    if (l && l.state !== "open") throw new HttpError(400, "That race has started. Wait for the next one.");
    if (!l) {
      const type = TYPES.includes(a.type) ? a.type : "sprint";
      const wager = Math.floor(Number(a.wager));
      if (!WAGERS.includes(wager)) throw new HttpError(400, "Bad wager.");
      l = { key, x: mx, z: mz, type, wager, host: accountId, members: /* @__PURE__ */ new Map(), state: "open", startAt: 0, seed: 0, minMs: 0, firstFinish: 0 };
      this.lobbies.set(key, l);
    }
    if (l.members.size >= MAX) throw new HttpError(400, "The race is full.");
    this.d.debit(accountId, l.wager, "race.stake");
    l.members.set(accountId, { accountId, name, finishMs: null, dnf: false });
    this.byAccount.set(accountId, key);
    this.d.broadcast(l, this.view(l));
    return this.view(l);
  }
  leave(accountId) {
    const key = this.byAccount.get(accountId);
    if (!key) return;
    const l = this.lobbies.get(key);
    this.byAccount.delete(accountId);
    if (!l) return;
    const m = l.members.get(accountId);
    if (l.state === "open") {
      l.members.delete(accountId);
      this.d.credit(accountId, l.wager, "race.refund");
      if (!l.members.size) {
        this.lobbies.delete(key);
        return;
      }
      if (l.host === accountId) l.host = [...l.members.keys()][0];
    } else if (m && m.finishMs === null) m.dnf = true;
    this.d.broadcast(l, this.view(l));
    this.maybeSettle(l);
  }
  /** the host starts it (two or more racers): five seconds of countdown, then everybody goes */
  start(accountId, minLen) {
    const l = this.lobbyOf(accountId);
    if (l.host !== accountId) throw new HttpError(403, "Only the host can start.");
    if (l.state !== "open") throw new HttpError(400, "Already started.");
    if (l.members.size < 2) throw new HttpError(400, "You need at least one more racer.");
    l.state = "countdown";
    l.seed = Math.floor(Math.random() * 2 ** 31);
    l.startAt = this.d.now() + 6e3;
    const len = Math.max(300, Math.min(2e4, Number(minLen) || 1500));
    l.minMs = len / 55 * 1e3;
    this.d.broadcast(l, this.view(l));
    return this.view(l);
  }
  finish(accountId, ms, len) {
    const l = this.lobbyOf(accountId);
    const m = l.members.get(accountId);
    if (m.finishMs !== null || m.dnf) return this.view(l);
    if (l.state === "countdown" && this.d.now() >= l.startAt) l.state = "racing";
    if (l.state !== "racing") throw new HttpError(400, "The race has not started.");
    const t = Math.floor(Number(ms));
    const real = this.d.now() - l.startAt;
    const L = Math.max(300, Number(len) || 0);
    const minMs = Math.max(l.minMs, L / 55 * 1e3);
    if (!(t > 0) || t < minMs || t > real + 3e3) {
      this.d.flag(accountId, "race-time", { t, real, minMs });
      m.dnf = true;
    } else m.finishMs = t;
    if (!l.firstFinish) l.firstFinish = this.d.now();
    this.d.broadcast(l, this.view(l));
    this.maybeSettle(l);
    return this.view(l);
  }
  /** ticks: flip countdown to racing, close races two minutes after the first finisher */
  tick() {
    const now = this.d.now();
    for (const l of this.lobbies.values()) {
      if (l.state === "countdown" && now >= l.startAt) {
        l.state = "racing";
        this.d.broadcast(l, this.view(l));
      }
      if (l.state === "racing" && l.firstFinish && now - l.firstFinish > 12e4) {
        for (const m of l.members.values()) if (m.finishMs === null) m.dnf = true;
        this.maybeSettle(l);
      }
      if (l.state === "racing" && now - l.startAt > 15 * 6e4) {
        for (const m of l.members.values()) if (m.finishMs === null) m.dnf = true;
        this.maybeSettle(l);
      }
    }
  }
  maybeSettle(l) {
    if (l.state === "open" || l.state === "done") return;
    const ms = [...l.members.values()];
    if (ms.some((m) => m.finishMs === null && !m.dnf)) return;
    l.state = "done";
    const pot = l.wager * ms.length;
    const ranked = ms.filter((m) => m.finishMs !== null).sort((a, b) => a.finishMs - b.finishMs);
    if (ranked[0]) this.d.credit(ranked[0].accountId, Math.round(pot * 0.8), "race.win");
    if (ranked[1] && ms.length >= 3) this.d.credit(ranked[1].accountId, l.wager, "race.second");
    this.d.broadcast(l, { ...this.view(l), results: ranked.map((m, i) => ({ id: m.accountId, name: m.name, ms: m.finishMs, place: i + 1 })) });
    for (const m of ms) this.byAccount.delete(m.accountId);
    this.lobbies.delete(l.key);
  }
  lobbyOf(accountId) {
    const key = this.byAccount.get(accountId);
    const l = key ? this.lobbies.get(key) : void 0;
    if (!l) throw new HttpError(400, "You are not in a race.");
    return l;
  }
};

// v2/src/net/sports.ts
var PROP_KINDS = ["plot", "biz", "venue"];
var AGENT_SALE_FEE = 0.05;
var AGENT_RENT_FEE = 0.15;
var RENT_RATE = 4e-3;
var ASK_RANGE = { self: [0.3, 5], agent: [0.5, 1.6] };
var AGENCIES = ["Lekki Gold Realtors", "Omo Onile Homes and Properties", "Victoria Prime Agency", "Mainland Keys Ltd"];
var agencyFor = (id) => AGENCIES[hashStr(id) % AGENCIES.length];
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function askOk(mode, price, value) {
  const [a, b] = ASK_RANGE[mode];
  return Number.isFinite(price) && price >= Math.max(1, value * a) && price <= value * b;
}
function agentSaleChance(price, value) {
  return Math.max(0.02, Math.min(0.6, 0.3 * Math.pow(value / Math.max(1, price), 3)));
}
function agentStep(st, o, to, rand5) {
  let paid = 0, sold = false;
  const from = Math.max(st.hour, to - 24 * 30);
  for (let h = Math.floor(from) + 1; h <= Math.floor(to) && !sold; h++) {
    if ((h % 24 + 24) % 24 !== 12) continue;
    const d = Math.floor(h / 24);
    if (o.mode !== "agent") continue;
    if (o.rent) {
      const n = Math.round(o.value * RENT_RATE * (1 - AGENT_RENT_FEE));
      paid += n;
      st.log.push({ d, t: "Tenant paid rent. Agency took their cut.", n });
    }
    if (rand5() < agentSaleChance(o.price, o.value)) {
      const n = Math.round(o.price * (1 - AGENT_SALE_FEE));
      paid += n;
      sold = true;
      st.log.push({ d, t: "The agency found a buyer. Sold!", n });
    }
    if (st.log.length > 8) st.log.splice(0, st.log.length - 8);
  }
  st.hour = Math.max(st.hour, Math.floor(to));
  return { paid, sold };
}
var VENUES = {
  pitch: { kind: "pitch", name: "Football pitch", base: 9e6, perM2: 4e3, fee: 15e3, sport: "football" },
  court: { kind: "court", name: "Basketball court", base: 35e5, perM2: 6e3, fee: 8e3, sport: "basketball" },
  stadium: { kind: "stadium", name: "Stadium", base: 25e7, perM2: 6e3, fee: 12e4, sport: "football" }
};
function venueParse(id) {
  const m = /^v:(pitch|court|stadium):(-?\d{1,6}):(-?\d{1,6}):(\d{1,4})$/.exec(id);
  return m ? { kind: m[1], x: +m[2], z: +m[3], len: +m[4] } : null;
}
function venuePrice(id) {
  const v = venueParse(id);
  if (!v) return 0;
  const d = VENUES[v.kind];
  const L = Math.max(10, Math.min(v.kind === "stadium" ? 200 : 110, v.len));
  const near = Math.exp(-Math.hypot(v.x, v.z) / 14e3) * 0.8 + 0.6;
  return Math.round((d.base + d.perM2 * L * L * 0.6) * near / 5e4) * 5e4;
}
var VENUE_REACH = 60;
var VENUE_MAX = 3;
var FEE_RANGE = [0.25, 4];
var SLOT_AHEAD = 48;
var slotNow = (ms) => Math.floor(worldHours(ms));
var hourToMs = (h) => (h - WORLD_START_HOUR) * 3600 / WORLD_SPEED * 1e3;
var OWNER_SHARE = 0.9;
var MATCH_WAGERS = [0, 5e3, 2e4, 1e5, 5e5];
var MATCH_CUT = 0.05;
var SPORT_SIZE = { football: 5, basketball: 3 };
var MATCH_MS = { football: 24e4, basketball: 3e5 };
var BB_TARGET = 21;
function scorePlausible(sport, a, b, ms) {
  if (![a, b].every((n) => Number.isInteger(n) && n >= 0)) return false;
  if (sport === "football") return a + b <= Math.ceil(ms / 8e3) && Math.max(a, b) <= 30;
  return Math.max(a, b) <= BB_TARGET + 2 && a + b <= Math.ceil(ms / 2500);
}
var potShare = (wager, players) => {
  const pot = wager * players;
  const cut = Math.round(pot * MATCH_CUT);
  return { pot, cut, win: pot - cut };
};

// server/src/realtime/matches.ts
var Fixtures = class {
  constructor(d) {
    this.d = d;
  }
  list = /* @__PURE__ */ new Map();
  byAccount = /* @__PURE__ */ new Map();
  view(f) {
    return { t: "fixture", key: f.key, venue: f.venue, slot: f.slot, sport: f.sport, wager: f.wager, host: f.host, state: f.state, kickAt: f.kickAt, startedAt: f.startedAt, members: [...f.members.values()].map((m) => ({ id: m.accountId, name: m.name, side: m.side })) };
  }
  tell(f, msg = this.view(f)) {
    for (const id of f.members.keys()) this.d.send(id, msg);
  }
  open() {
    return [...this.list.values()].filter((f) => f.state === "open").map((f) => this.view(f));
  }
  /** the host opens a fixture on a slot they booked */
  create(acc, name, a) {
    const venue = String(a.venue ?? ""), slot = Math.floor(Number(a.slot));
    const sport = a.sport === "basketball" ? "basketball" : "football";
    const wager = Math.floor(Number(a.wager) || 0);
    if (!MATCH_WAGERS.includes(wager)) throw new HttpError(400, "Bad wager.");
    if (this.byAccount.has(acc)) throw new HttpError(400, "You are already in a match.");
    const b = this.d.booking(venue, slot);
    if (!b || b.by_id !== acc) throw new HttpError(403, "Book the slot first.");
    const key = `${venue}@${slot}`;
    if (this.list.has(key)) throw new HttpError(409, "There is already a match on that slot.");
    const f = { key, venue, slot, sport, wager, host: acc, owner: this.d.venueOwner(venue), members: /* @__PURE__ */ new Map(), state: "open", kickAt: hourToMs(slot), startedAt: 0, hostReportAt: 0 };
    this.list.set(key, f);
    this.join(acc, name, { key, side: 0 });
    return this.view(f);
  }
  /** join a side; your wager is held until the match is settled (refunded if you leave before kick-off) */
  join(acc, name, a) {
    const f = this.list.get(String(a.key ?? ""));
    if (!f) throw new HttpError(404, "No such match.");
    if (f.state !== "open") throw new HttpError(400, "That match don start.");
    if (this.byAccount.has(acc) && this.byAccount.get(acc) !== f.key) throw new HttpError(400, "You are already in a match.");
    if (f.members.has(acc)) return this.view(f);
    const side = a.side === 1 ? 1 : 0;
    const n = [...f.members.values()].filter((m) => m.side === side).length;
    if (n >= SPORT_SIZE[f.sport]) throw new HttpError(400, "That side is full.");
    if (f.wager) this.d.debit(acc, f.wager, "match.stake");
    f.members.set(acc, { accountId: acc, name, side, report: null });
    this.byAccount.set(acc, f.key);
    this.tell(f);
    return this.view(f);
  }
  leave(acc) {
    const key = this.byAccount.get(acc);
    if (!key) return;
    const f = this.list.get(key);
    this.byAccount.delete(acc);
    if (!f) return;
    if (f.state === "open") {
      f.members.delete(acc);
      if (f.wager) this.d.credit(acc, f.wager, "match.refund");
      if (acc === f.host || !f.members.size) {
        this.cancel(f, "The host cancelled the match.");
        return;
      }
      this.tell(f);
    }
  }
  cancel(f, why) {
    for (const m of f.members.values()) {
      if (f.wager) this.d.credit(m.accountId, f.wager, "match.refund");
      this.byAccount.delete(m.accountId);
    }
    this.tell(f, { ...this.view(f), state: "done", void: why });
    this.list.delete(f.key);
  }
  /** host kicks off early once both sides have a player; otherwise it starts by itself at the slot */
  start(acc) {
    const f = this.mine(acc);
    if (f.host !== acc) throw new HttpError(403, "Only the host can kick off.");
    if (f.state !== "open") throw new HttpError(400, "Already started.");
    if (!this.bothSides(f)) throw new HttpError(400, "You need somebody on the other side.");
    this.kick(f);
    return this.view(f);
  }
  bothSides(f) {
    const s = [...f.members.values()].map((m) => m.side);
    return s.includes(0) && s.includes(1);
  }
  kick(f) {
    f.state = "live";
    f.startedAt = this.d.now();
    this.tell(f);
  }
  /** relay match traffic: the host's snapshots to everybody, the others' inputs to the host */
  relay(acc, d) {
    const key = this.byAccount.get(acc);
    const f = key ? this.list.get(key) : void 0;
    if (!f || f.state !== "live") return;
    const msg = { t: "mx", from: acc, d };
    if (acc === f.host) {
      for (const id of f.members.keys()) if (id !== acc) this.d.send(id, msg);
    } else this.d.send(f.host, msg);
  }
  report(acc, a0, b0) {
    const f = this.mine(acc);
    if (f.state !== "live") throw new HttpError(400, "No match on.");
    const m = f.members.get(acc);
    m.report = [Math.floor(Number(a0)), Math.floor(Number(b0))];
    if (acc === f.host) f.hostReportAt = this.d.now();
    this.maybeSettle(f);
    return true;
  }
  maybeSettle(f, force = false) {
    const host = f.members.get(f.host);
    if (!host?.report) return;
    const ms = [...f.members.values()];
    if (!force && ms.some((m) => !m.report)) return;
    const [a, b] = host.report;
    const played = this.d.now() - f.startedAt;
    const dispute = ms.some((m) => m.report && (m.report[0] !== a || m.report[1] !== b));
    const minMs = this.d.minMs ?? MATCH_MS[f.sport] * 0.9;
    if (played < minMs || !scorePlausible(f.sport, a, b, played)) {
      this.d.flag(f.host, "match-score", { a, b, played });
      this.cancel(f, "The score did not add up. Stakes refunded.");
      return;
    }
    if (dispute) {
      this.d.flag(f.host, "match-dispute", { a, b, reports: ms.map((m) => m.report) });
      this.cancel(f, "Players did not agree on the score. Stakes refunded.");
      return;
    }
    f.state = "done";
    const winSide = a > b ? 0 : b > a ? 1 : -1;
    let paid = [];
    if (f.wager) {
      if (winSide < 0) for (const m of ms) this.d.credit(m.accountId, f.wager, "match.refund");
      else {
        const { cut, win } = potShare(f.wager, ms.length);
        const winners = ms.filter((m) => m.side === winSide);
        const each = Math.floor(win / winners.length);
        for (const m of winners) {
          this.d.credit(m.accountId, each, "match.win");
          paid.push({ id: m.accountId, n: each });
        }
        if (f.owner) this.d.credit(f.owner, cut, "match.house");
      }
    }
    this.tell(f, { ...this.view(f), score: [a, b], winSide, paid });
    for (const m of ms) this.byAccount.delete(m.accountId);
    this.list.delete(f.key);
  }
  mine(acc) {
    const key = this.byAccount.get(acc);
    const f = key ? this.list.get(key) : void 0;
    if (!f) throw new HttpError(400, "You are not in a match.");
    return f;
  }
  tick() {
    const now = this.d.now();
    const wall = Date.now();
    for (const f of [...this.list.values()]) {
      if (f.state === "open" && wall >= f.kickAt) {
        if (this.bothSides(f)) this.kick(f);
        else if (wall >= f.kickAt + 12e4) this.cancel(f, "Nobody came to play. Stakes refunded.");
      } else if (f.state === "live" && f.hostReportAt && now - f.hostReportAt > 2e4) this.maybeSettle(f, true);
      else if (f.state === "live" && now - f.startedAt > MATCH_MS[f.sport] * 3) this.cancel(f, "The match never finished. Stakes refunded.");
    }
  }
};

// server/src/property.ts
import { randomInt as randomInt5 } from "node:crypto";
var rand4 = () => randomInt5(0, 2 ** 32) / 2 ** 32;
var Properties = class {
  constructor(db, econ, now = Date.now) {
    this.db = db;
    this.econ = econ;
    this.now = now;
  }
  // ---------------------------------------------------------------- who owns what, and what it is worth
  ownerOf(kind, id) {
    if (kind === "plot") return one(this.db, "SELECT owner_id FROM plots WHERE id=?", id)?.owner_id ?? null;
    if (kind === "biz") return one(this.db, "SELECT owner_id FROM businesses WHERE site=?", id)?.owner_id ?? null;
    return one(this.db, "SELECT owner_id FROM venues WHERE id=?", id)?.owner_id ?? null;
  }
  valueOf(kind, id) {
    if (kind === "plot") {
      const p = one(this.db, "SELECT price FROM plots WHERE id=?", id);
      return Math.max(15e5, p?.price ?? 0);
    }
    if (kind === "biz") {
      const b = one(this.db, "SELECT type FROM businesses WHERE site=?", id);
      return bizType(b?.type ?? "")?.price ?? 0;
    }
    return venuePrice(id);
  }
  name(acc) {
    return one(this.db, "SELECT name FROM profiles WHERE account_id=?", acc)?.name ?? "Somebody";
  }
  kindOf(k) {
    const s = String(k ?? "");
    if (!PROP_KINDS.includes(s)) throw new HttpError(400, "Bad property type.");
    return s;
  }
  /** pay from cash first, then the bank */
  pay(acc, n, kind, ref) {
    const w = this.econ.wallet(acc);
    if (w.cash + w.bank < n) throw new HttpError(402, "Not enough money.", { code: "broke" });
    const c = Math.min(w.cash, n);
    return this.econ.adjust(acc, -c, -(n - c), kind, { ref });
  }
  /** everything a player owns, across kinds */
  owned(acc) {
    const plots = all(this.db, "SELECT id, price FROM plots WHERE owner_id=?", acc).map((p) => ({ kind: "plot", id: p.id, value: Math.max(15e5, p.price) }));
    const biz = all(this.db, "SELECT site, type FROM businesses WHERE owner_id=?", acc).map((b) => ({ kind: "biz", id: b.site, value: bizType(b.type)?.price ?? 0, type: b.type }));
    const ven = all(this.db, "SELECT * FROM venues WHERE owner_id=?", acc).map((v) => ({ kind: "venue", id: v.id, value: venuePrice(v.id), fee: v.fee, earned: v.earned }));
    return [...plots, ...biz, ...ven].map((p) => ({ ...p, listing: this.listingView(this.advance(p.kind, p.id)) }));
  }
  // ---------------------------------------------------------------- listings
  listingRow(kind, id) {
    return one(this.db, "SELECT l.*, f.name AS owner_name FROM listings l LEFT JOIN profiles f ON f.account_id=l.owner_id WHERE l.kind=? AND l.id=?", kind, id);
  }
  listingView(r) {
    if (!r) return null;
    return { kind: r.kind, id: r.id, owner: r.owner_id, ownerName: r.owner_name ?? "Somebody", mode: r.mode, agency: r.mode === "agent" ? agencyFor(r.id) : null, price: r.price, rent: !!r.rent, log: JSON.parse(r.log || "[]"), listedAt: r.listed_at };
  }
  /** run an agency listing to the present: rent paid in, maybe a sale to an NPC buyer */
  advance(kind, id) {
    const r = this.listingRow(kind, id);
    if (!r) return null;
    if (r.owner_id !== this.ownerOf(kind, id)) {
      run(this.db, "DELETE FROM listings WHERE kind=? AND id=?", kind, id);
      return null;
    }
    const to = worldHours(this.now());
    if (r.mode !== "agent" || Math.floor(to) <= r.hour) return r;
    const st = { hour: r.hour, log: JSON.parse(r.log || "[]") };
    const res = agentStep(st, { mode: r.mode, price: r.price, value: this.valueOf(kind, id), rent: !!r.rent }, to, rand4);
    return this.db.transaction(() => {
      if (res.paid > 0) this.econ.adjust(r.owner_id, 0, res.paid, res.sold ? "prop.sold.agent" : "prop.rent", { ref: propRef(kind, id) });
      if (res.sold) {
        this.release(kind, id);
        run(this.db, "DELETE FROM listings WHERE kind=? AND id=?", kind, id);
        this.onChange?.(kind, id, null, null);
        return null;
      }
      run(this.db, "UPDATE listings SET hour=?, log=? WHERE kind=? AND id=?", st.hour, JSON.stringify(st.log), kind, id);
      return { ...r, hour: st.hour, log: JSON.stringify(st.log) };
    })();
  }
  /** a sale to an NPC: the property goes back to the market */
  release(kind, id) {
    if (kind === "plot") this.econ.setPlotOwner(id, null);
    else if (kind === "biz") run(this.db, "DELETE FROM businesses WHERE site=?", id);
    else {
      run(this.db, "DELETE FROM venues WHERE id=?", id);
      run(this.db, "DELETE FROM bookings WHERE venue=? AND slot>=?", id, slotNow(this.now()));
    }
  }
  transfer(kind, id, to) {
    if (kind === "plot") this.econ.setPlotOwner(id, to);
    else if (kind === "biz") run(this.db, "UPDATE businesses SET owner_id=? WHERE site=?", to, id);
    else run(this.db, "UPDATE venues SET owner_id=?, earned=0 WHERE id=?", to, id);
  }
  /** called when ownership changes (the hub tells everybody) */
  onChange;
  list(acc, a) {
    const kind = this.kindOf(a.kind), id = String(a.id ?? "");
    const mode = a.mode === "agent" ? "agent" : "self";
    if (this.ownerOf(kind, id) !== acc) throw new HttpError(404, "That property is not yours.");
    const value = this.valueOf(kind, id);
    const price = Math.round(Number(a.price));
    if (!askOk(mode, price, value)) {
      const [lo, hi] = ASK_RANGE[mode];
      throw new HttpError(400, mode === "agent" ? `The agency will only list between \u20A6${Math.round(value * lo).toLocaleString("en-NG")} and \u20A6${Math.round(value * hi).toLocaleString("en-NG")}.` : `Price must be between \u20A6${Math.round(value * lo).toLocaleString("en-NG")} and \u20A6${Math.round(value * hi).toLocaleString("en-NG")}.`);
    }
    const rent = mode === "agent" && !!a.rent ? 1 : 0;
    run(
      this.db,
      "INSERT INTO listings(kind,id,owner_id,mode,price,rent,hour,listed_at,log) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET mode=excluded.mode, price=excluded.price, rent=excluded.rent",
      kind,
      id,
      acc,
      mode,
      price,
      rent,
      Math.floor(worldHours(this.now())),
      this.now(),
      "[]"
    );
    return this.listingView(this.listingRow(kind, id));
  }
  unlist(acc, a) {
    const kind = this.kindOf(a.kind), id = String(a.id ?? "");
    const r = this.advance(kind, id);
    if (!r || r.owner_id !== acc) throw new HttpError(404, "Not listed.");
    run(this.db, "DELETE FROM listings WHERE kind=? AND id=?", kind, id);
    return true;
  }
  /** everything for sale right now (prices only exist for listed property) */
  market(kind) {
    const k = kind ? this.kindOf(kind) : null;
    const rows = all(this.db, k ? "SELECT kind, id FROM listings WHERE kind=? ORDER BY listed_at DESC LIMIT 200" : "SELECT kind, id FROM listings ORDER BY listed_at DESC LIMIT 200", ...k ? [k] : []);
    return rows.map((r) => this.listingView(this.advance(r.kind, r.id))).filter((x) => !!x).map(({ log: _l, ...v }) => v);
  }
  /** what a stranger sees: who owns it and, only if it is listed, the price */
  info(kind0, id0) {
    const kind = this.kindOf(kind0), id = String(id0 ?? "");
    const owner = this.ownerOf(kind, id);
    if (!owner) return kind === "venue" && venueParse(id) ? { kind, id, owned: false, listed: true, price: venuePrice(id), seller: "Lagos State Sports Commission" } : { kind, id, owned: false, listed: false };
    const l = this.listingView(this.advance(kind, id));
    if (!l) return { kind, id, owned: true, ownerName: this.name(owner), listed: false };
    return { kind, id, owned: true, ownerName: l.ownerName, listed: true, price: l.price, mode: l.mode, agency: l.agency, seller: l.mode === "agent" ? l.agency : l.ownerName };
  }
  /** buy listed property from another player at the asking price */
  buy(acc, a) {
    const kind = this.kindOf(a.kind), id = String(a.id ?? "");
    const r = this.advance(kind, id);
    if (!r) throw new HttpError(403, "That property is not for sale.");
    if (r.owner_id === acc) throw new HttpError(400, "Na your own property.");
    if (Number(a.price) && Math.round(Number(a.price)) !== r.price) throw new HttpError(409, "The price changed. Check again.");
    if (kind === "biz" && one(this.db, "SELECT COUNT(*) AS n FROM businesses WHERE owner_id=?", acc).n >= BIZ_MAX) throw new HttpError(400, `You can run ${BIZ_MAX} businesses at most.`);
    if (kind === "venue" && one(this.db, "SELECT COUNT(*) AS n FROM venues WHERE owner_id=?", acc).n >= VENUE_MAX) throw new HttpError(400, `${VENUE_MAX} venues is the max.`);
    const fee = r.mode === "agent" ? Math.round(r.price * 0.05) : 0;
    return this.db.transaction(() => {
      const w = this.pay(acc, r.price, "prop.buy", propRef(kind, id));
      this.econ.adjust(r.owner_id, 0, r.price - fee, "prop.sold", { ref: propRef(kind, id), note: fee ? `agency fee ${fee}` : void 0 });
      run(this.db, "DELETE FROM listings WHERE kind=? AND id=?", kind, id);
      this.transfer(kind, id, acc);
      this.onChange?.(kind, id, acc, this.name(acc));
      return { wallet: w, seller: r.owner_id, price: r.price };
    })();
  }
  // ---------------------------------------------------------------- venues
  venueRow(id) {
    return one(this.db, "SELECT v.*, f.name AS owner_name FROM venues v LEFT JOIN profiles f ON f.account_id=v.owner_id WHERE v.id=?", id);
  }
  allVenues() {
    return all(this.db, "SELECT v.id, v.owner_id, v.fee, f.name AS owner_name FROM venues v LEFT JOIN profiles f ON f.account_id=v.owner_id").map((v) => ({ id: v.id, ownerName: v.owner_name ?? "Somebody", fee: v.fee, listed: !!this.listingRow("venue", v.id) }));
  }
  near(id, at) {
    const p = venueParse(id);
    if (!p) throw new HttpError(400, "Bad venue.");
    if (at.interior || Math.hypot(p.x - at.x, p.z - at.z) > VENUE_REACH) throw new HttpError(400, "You have to be at the venue.");
    return p;
  }
  /** buy an unowned venue from the state (owned ones only through a listing) */
  buyVenue(acc, id0, at) {
    const id = String(id0 ?? "");
    this.near(id, at);
    if (this.venueRow(id)) throw new HttpError(403, "Somebody owns this place. It is only for sale if they list it.");
    if (one(this.db, "SELECT COUNT(*) AS n FROM venues WHERE owner_id=?", acc).n >= VENUE_MAX) throw new HttpError(400, `${VENUE_MAX} venues is the max.`);
    const price = venuePrice(id);
    const def = VENUES[venueParse(id).kind];
    return this.db.transaction(() => {
      const w = this.pay(acc, price, "venue.buy", id);
      run(this.db, "INSERT INTO venues(id,owner_id,fee,earned,bought_at) VALUES(?,?,?,?,?)", id, acc, def.fee, 0, this.now());
      this.onChange?.("venue", id, acc, this.name(acc));
      return { wallet: w, price };
    })();
  }
  setFee(acc, id0, fee0) {
    const id = String(id0 ?? "");
    const v = this.venueRow(id);
    if (!v || v.owner_id !== acc) throw new HttpError(404, "Not your venue.");
    const def = VENUES[venueParse(id).kind];
    const fee = Math.round(Number(fee0));
    if (!(fee >= def.fee * FEE_RANGE[0] && fee <= def.fee * FEE_RANGE[1])) throw new HttpError(400, `Slot fee must be \u20A6${Math.round(def.fee * FEE_RANGE[0]).toLocaleString("en-NG")} to \u20A6${Math.round(def.fee * FEE_RANGE[1]).toLocaleString("en-NG")}.`);
    run(this.db, "UPDATE venues SET fee=? WHERE id=?", fee, id);
    return fee;
  }
  venue(id0) {
    const id = String(id0 ?? "");
    if (!venueParse(id)) throw new HttpError(400, "Bad venue.");
    const v = this.venueRow(id);
    const from = slotNow(this.now());
    const bookings = all(this.db, "SELECT b.*, f.name AS by_name FROM bookings b LEFT JOIN profiles f ON f.account_id=b.by_id WHERE b.venue=? AND b.slot>=? ORDER BY b.slot LIMIT 60", id, from).map((b) => ({ slot: b.slot, by: b.by_id, byName: b.by_name ?? "Somebody" }));
    return { id, owner: v?.owner_id ?? null, ownerName: v ? v.owner_name ?? "Somebody" : null, fee: v ? v.fee : 0, earned: v?.earned ?? 0, bookings, info: this.info("venue", id) };
  }
  /** book a one game hour slot. At an owned venue the fee goes to the owner (less 10%); public pitches are free. */
  book(acc, id0, slot0) {
    const id = String(id0 ?? "");
    if (!venueParse(id)) throw new HttpError(400, "Bad venue.");
    const slot = Math.floor(Number(slot0));
    const cur = slotNow(this.now());
    if (!Number.isFinite(slot) || slot < cur || slot > cur + SLOT_AHEAD) throw new HttpError(400, "Pick a slot in the next two days.");
    if (one(this.db, "SELECT 1 FROM bookings WHERE venue=? AND slot=?", id, slot)) throw new HttpError(409, "That slot is taken.");
    const v = this.venueRow(id);
    const fee = v && v.owner_id !== acc ? v.fee : 0;
    return this.db.transaction(() => {
      const w = fee ? this.pay(acc, fee, "venue.book", id) : this.econ.wallet(acc);
      if (fee) {
        const n = Math.round(fee * OWNER_SHARE);
        this.econ.adjust(v.owner_id, 0, n, "venue.booking", { ref: id });
        run(this.db, "UPDATE venues SET earned=earned+? WHERE id=?", n, id);
      }
      run(this.db, "INSERT INTO bookings(venue,slot,by_id,fee,at) VALUES(?,?,?,?,?)", id, slot, acc, fee, this.now());
      return { wallet: w, fee, slot, owner: v?.owner_id ?? null };
    })();
  }
  booking(id, slot) {
    return one(this.db, "SELECT * FROM bookings WHERE venue=? AND slot=?", id, slot) ?? null;
  }
  myBookings(acc) {
    return all(this.db, "SELECT * FROM bookings WHERE by_id=? AND slot>=? ORDER BY slot", acc, slotNow(this.now())).map((b) => ({ venue: b.venue, slot: b.slot, fee: b.fee }));
  }
  venueOwner(id) {
    return this.venueRow(id)?.owner_id ?? null;
  }
  /** run every agency listing forward (rent, NPC buyers) */
  tick() {
    for (const r of all(this.db, "SELECT kind, id FROM listings WHERE mode='agent'")) this.advance(r.kind, r.id);
  }
};
var propRef = (k, id) => `${k}:${id}`.slice(0, 80);

// server/src/realtime/grid.ts
var keyOf = (cx, cz) => (cx + 8192) * 16384 + (cz + 8192);
var cellCoord = (v) => Math.floor(v / CELL);
var roomOf = (cx, cz) => `${Math.floor(cx / ROOM_CELLS)},${Math.floor(cz / ROOM_CELLS)}`;
var Grid2 = class {
  cells = /* @__PURE__ */ new Map();
  size = 0;
  /** place or move a node; cheap when it stays in its cell */
  put(n, x, z) {
    const cx = cellCoord(x), cz = cellCoord(z), key = keyOf(cx, cz);
    n.x = x;
    n.z = z;
    if (n.key === key && this.cells.get(key)?.has(n)) {
      return false;
    }
    if (this.cells.get(n.key)?.delete(n)) {
      if (!this.cells.get(n.key).size) this.cells.delete(n.key);
    } else this.size++;
    n.cx = cx;
    n.cz = cz;
    n.key = key;
    let s = this.cells.get(key);
    if (!s) this.cells.set(key, s = /* @__PURE__ */ new Set());
    s.add(n);
    return true;
  }
  remove(n) {
    const s = this.cells.get(n.key);
    if (s?.delete(n)) {
      this.size--;
      if (!s.size) this.cells.delete(n.key);
    }
  }
  /** visit every node within `rings` cells (square) of (cx, cz) */
  around(cx, cz, rings, f) {
    for (let i = cx - rings; i <= cx + rings; i++) for (let j2 = cz - rings; j2 <= cz + rings; j2++) {
      const s = this.cells.get(keyOf(i, j2));
      if (!s) continue;
      const ring = Math.max(Math.abs(i - cx), Math.abs(j2 - cz));
      for (const n of s) f(n, ring);
    }
  }
  /** nodes within a circle */
  near(x, z, r, f) {
    const rings = Math.ceil(r / CELL);
    const r2 = r * r;
    this.around(cellCoord(x), cellCoord(z), rings, (n) => {
      const dx = n.x - x, dz = n.z - z;
      if (dx * dx + dz * dz <= r2) f(n);
    });
  }
  cellCount() {
    return this.cells.size;
  }
  /** population per room, for stats and admin */
  rooms(count = () => 1) {
    const out = /* @__PURE__ */ new Map();
    for (const s of this.cells.values()) for (const n of s) {
      const k = roomOf(n.cx, n.cz);
      out.set(k, (out.get(k) ?? 0) + count(n));
    }
    return out;
  }
};

// server/src/realtime/antiCheat.ts
var FOOT_MAX = 10.5;
var FALL_MAX = 75;
var CREDIT_SECONDS = 6;
var VEH_SLACK = 1.45;
var MAX_TP = 9e3;
var newMoveState = (x, y, z, now) => ({ x, y, z, at: now, credit: FOOT_MAX * CREDIT_SECONDS, strikes: 0, strikeAt: now, tpUntil: 0, fixUntil: 0, lastTp: -1e9, interior: null, doorFrom: null, exitTo: null, lastDoor: -1e9 });
function vmaxFor(m) {
  if (m.veh) {
    const k = VKINDS[m.veh.kind];
    return (VKIND_TOP[k] ?? 40) * VEH_SLACK + 3;
  }
  return FOOT_MAX;
}
function judgeMove(s, m, now, bounds) {
  if (![m.x, m.y, m.z].every(Number.isFinite)) return { ok: false, reason: "nan", hard: true };
  const inside = inInteriorZone(m.x, m.z);
  if (inside && !s.interior) return { ok: false, reason: "interior", hard: true };
  if (!inside && (m.x < bounds[0] || m.x > bounds[2] || m.z < bounds[1] || m.z > bounds[3])) return { ok: false, reason: "bounds", hard: true };
  if (m.y < -60 || m.y > 600) return { ok: false, reason: "height", hard: true };
  if (m.veh) {
    const v = m.veh;
    if (![v.x, v.y, v.z, v.qx, v.qy, v.qz, v.qw].every(Number.isFinite)) return { ok: false, reason: "nan", hard: true };
    if (Math.hypot(v.x - m.x, v.z - m.z) > 8) return { ok: false, reason: "vehicle-detached", hard: false };
  }
  const dt = Math.max(0.01, Math.min(5, (now - s.at) / 1e3));
  const dist = Math.hypot(m.x - s.x, m.z - s.z);
  const vmax = vmaxFor(m);
  s.credit = Math.min(vmax * CREDIT_SECONDS, s.credit + vmax * dt);
  if (now < s.tpUntil && dist > s.credit + 1.5 && inside !== inInteriorZone(s.x, s.z)) {
    if (!inside && (!s.exitTo || Math.hypot(m.x - s.exitTo.x, m.z - s.exitTo.z) > 120)) {
      s.interior = s.exitFrom ?? "unknown";
      s.exitTo = null;
      s.tpUntil = 0;
      return { ok: false, reason: "door-exit", hard: true };
    }
    s.exitTo = null;
    s.tpUntil = 0;
    s.credit = 0;
    return { ok: true };
  }
  if (now < s.tpUntil) {
    if (dist > s.credit + 1.5) {
      if (dist > MAX_TP) return { ok: false, reason: "teleport", hard: true };
      s.tpUntil = 0;
      s.credit = 0;
      return { ok: true };
    }
  }
  if (dist > s.credit + 1.5) return { ok: false, reason: dist > 250 ? "teleport" : "speed", hard: dist > 250 };
  const dy = Math.abs(m.y - s.y) / dt;
  if (dy > FALL_MAX && Math.abs(m.y - s.y) > 12) return { ok: false, reason: "vertical", hard: false };
  s.credit = Math.max(0, s.credit - dist);
  return { ok: true };
}
function strike(s, now, weight = 1, limit = 10) {
  s.strikes = Math.max(0, s.strikes - Math.floor((now - s.strikeAt) / 1e4));
  s.strikeAt = now;
  s.strikes += weight;
  return s.strikes >= limit;
}
function accept(s, m, now) {
  s.x = m.x;
  s.y = m.y;
  s.z = m.z;
  s.at = now;
}

// server/src/realtime/hub.ts
var NEAR_RINGS_FULL_RATE = 1;
var PARKED_LIMIT = 2;
var PARKED_TTL = 10 * 6e4;
var MAX_WS_PAYLOAD = 16 * 1024;
var Hub = class {
  constructor(cfg, db, accounts, econ, content, log2) {
    this.cfg = cfg;
    this.db = db;
    this.accounts = accounts;
    this.econ = econ;
    this.content = content;
    this.log = log2;
    this.biz = new Businesses(db, econ);
    this.phone = new PhoneNet(db);
    this.body = new Body(db, econ);
    const bodyOut = (accountId) => {
      const c = this.byAccount.get(accountId);
      if (c) {
        const v = this.body.view(accountId);
        this.send(c, { t: "body", ...v });
        this.syncStrip(c, v.stripped);
      }
    };
    this.body.on("sick", bodyOut);
    this.body.on("changed", bodyOut);
    this.devices = new Devices(db, econ, this.body);
    this.exchange = new Exchange(db, econ);
    this.biz.splitter = (site, owner, n) => this.exchange.split(site, owner, n);
    this.devices.on("alert", (accountId, text) => this.toast(accountId, "Bank alert", text));
    this.props = new Properties(db, econ);
    this.props.onChange = (kind, id, owner, ownerName) => this.broadcastJson({ t: "prop", kind, id, owner, ownerName });
    this.fixtures = new Fixtures({
      debit: (id, n, kind) => {
        this.econ.adjust(id, -n, 0, kind);
      },
      credit: (id, n, kind) => {
        this.econ.adjust(id, n, 0, kind);
      },
      send: (id, msg) => {
        const c = this.byAccount.get(id);
        if (c) this.send(c, msg);
      },
      flag: (id, what, info) => this.econ.flag(id, what, info),
      now: () => performance.now(),
      booking: (v, s) => this.props.booking(v, s),
      venueOwner: (v) => this.props.venueOwner(v),
      minMs: cfg.matchMinMs
    });
    this.power.on("change", (st, prev) => {
      this.broadcastJson({ t: "grid", ...st });
      if (prev) {
        for (const f of FEEDERS) if (st.on[f.i] === "1" && prev[f.i] === "0") this.log.info(`grid: ${f.name} on`);
      }
    });
    this.races = new RaceLobbies({
      debit: (id, n, kind) => {
        this.econ.adjust(id, -n, 0, kind);
      },
      credit: (id, n, kind) => {
        this.econ.adjust(id, n, 0, kind);
      },
      broadcast: (l, msg) => {
        for (const id of l.members.keys()) {
          const c = this.byAccount.get(id);
          if (c) this.send(c, { ...msg, startIn: l.startAt ? l.startAt - performance.now() : 0 });
        }
      },
      flag: (id, what, info) => this.econ.flag(id, what, info),
      now: () => performance.now()
    });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD, perMessageDeflate: false });
    econ.on("wallet", (w) => {
      const c = this.byAccount.get(w.accountId);
      if (c) this.send(c, { t: "wallet", cash: w.cash, bank: w.bank, why: w.why });
    });
    econ.on("plot", (p) => this.broadcastJson({ t: "plot", id: p.id, owner: p.ownerId, ownerName: p.ownerName }));
    accounts.on("ban", (a, b) => this.kick(a.id, `Banned: ${b.reason}`));
    accounts.on("profile", (p) => {
      const c = this.byAccount.get(p.account_id);
      if (c) {
        c.profile = p;
        this.announceWho(c);
      }
    });
    content.on("changed", (c) => this.broadcastJson({ t: "content", kind: c.kind, etag: c.etag }));
  }
  wss;
  conns = /* @__PURE__ */ new Map();
  byAccount = /* @__PURE__ */ new Map();
  vehicles = /* @__PURE__ */ new Map();
  grid = new Grid2();
  nextPid = 1;
  nextVid = 1;
  freePids = [];
  tickN = 0;
  timer = null;
  t0 = performance.now();
  writer = new Writer(2048);
  stats0 = { ticks: 0, snapshots: 0, bytesOut: 0, bytesIn: 0, tickMsAvg: 0, tickMsMax: 0, stateMsgs: 0, rejected: 0, dropsBackpressure: 0 };
  pingTimer = null;
  saveTimer = null;
  races;
  fixtures;
  props;
  biz;
  phone;
  body;
  devices;
  exchange;
  power = new Grid();
  adsRef = null;
  adTimer = null;
  clubsRef = null;
  clubTimer = null;
  /** live voice calls between two connections */
  calls = /* @__PURE__ */ new Map();
  lastSwitch = /* @__PURE__ */ new Map();
  /** what the admin panel can steer in the game world */
  get world() {
    return { grid: this.power, biz: this.biz, ads: this.adsRef, body: this.body, devices: this.devices, clubs: this.clubsRef };
  }
  now() {
    return Math.floor(performance.now() - this.t0);
  }
  /** MyAds: the live feed goes to everyone when it changes; notes reach the advertiser */
  set ads(a) {
    this.adsRef = a;
    if (!a) return;
    a.on("feed", (list) => {
      for (const c of this.conns.values()) this.send(c, { t: "ads", list });
    });
    a.on("note", (accountId, title, body) => {
      this.toast(accountId, title, body);
    });
  }
  get ads() {
    return this.adsRef;
  }
  /** the clubs: what plays, who works, sprays and shutdowns reach the people in the room; the whole city hears about a shutdown */
  set clubs(k) {
    this.clubsRef = k;
    if (!k) return;
    k.on("club", (v) => this.broadcastJson({ t: "club", club: v }));
    k.on("spray", (ev) => {
      for (const c of this.conns.values()) if (k.inClub(ev.club, this.clubPos(c))) this.send(c, { t: "spray", ...ev });
      if (ev.toId) this.toast(ev.toId, "Money dey rain", `${ev.from} sprayed you \u20A6${ev.amount.toLocaleString("en-NG")}.`);
    });
    k.on("shutdown", (ev) => {
      const r = k.place(ev.club);
      void r;
      this.broadcast(`${ev.name} don shut down ${ev.club.toUpperCase()}! Drinks are free for everybody inside for the next hour or so.`, "Lagos Nightlife");
    });
    const roomFx = (kind) => (ev) => {
      for (const c of this.conns.values()) if (k.inClub(ev.club, this.clubPos(c))) this.send(c, { t: "clubfx", kind, ...ev });
    };
    k.on("vip", roomFx("vip"));
    k.on("bottle", roomFx("bottle"));
    k.on("ended", (acct, club, job, earned) => this.toast(acct, job === "dj" ? "Off the decks" : "Off the stage", `You left your post at ${club.toUpperCase()}. This shift paid \u20A6${Math.round(earned).toLocaleString("en-NG")}.`));
    k.on("note", (acct, title, body) => {
      this.toast(acct, title, body);
    });
  }
  get clubs() {
    return this.clubsRef;
  }
  /** where a connection stands for the clubs: nowhere while inside a loaded interior */
  clubPos(c) {
    return c.ms.interior ? { x: 1e9, y: 0, z: 1e9 } : { x: c.ms.x, y: c.ms.y, z: c.ms.z };
  }
  clubTick(now = Date.now()) {
    const k = this.clubsRef;
    if (!k) return;
    const on2 = /* @__PURE__ */ new Map();
    for (const c of this.conns.values()) if (c.haveState) on2.set(c.account.id, this.clubPos(c));
    k.tick(on2, now);
  }
  start() {
    this.adTimer = setInterval(() => {
      try {
        this.adsRef?.pushFeed();
      } catch (e) {
        this.log.warn("ad feed", e);
      }
    }, 6e4);
    this.clubTimer = setInterval(() => {
      try {
        this.clubTick();
      } catch (e) {
        this.log.warn("clubs", e);
      }
    }, 5e3);
    const period = 1e3 / this.cfg.tickHz;
    let next = performance.now() + period;
    const loop = () => {
      const t = performance.now();
      try {
        this.tick();
      } catch (e) {
        this.log.error("tick failed", e);
      }
      const dur = performance.now() - t;
      const s = this.stats0;
      s.tickMsAvg = s.tickMsAvg * 0.95 + dur * 0.05;
      s.tickMsMax = Math.max(s.tickMsMax * 0.999, dur);
      next += period;
      const wait = next - performance.now();
      if (wait < -period * 4) next = performance.now() + period;
      this.timer = setTimeout(loop, Math.max(0, wait));
    };
    this.timer = setTimeout(loop, period);
    this.pingTimer = setInterval(() => this.heartbeat(), 15e3);
    this.saveTimer = setInterval(() => this.saveAll(), 2e4);
  }
  async stop() {
    if (this.adTimer) clearInterval(this.adTimer);
    if (this.clubTimer) clearInterval(this.clubTimer);
    if (this.timer) clearTimeout(this.timer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.saveAll();
    for (const c of this.conns.values()) {
      try {
        c.ws.close(1001, "Server restarting");
      } catch {
      }
    }
    await new Promise((r) => this.wss.close(() => r()));
  }
  attach(server) {
    server.on("upgrade", (req, socket, head) => {
      const path = (req.url ?? "").split("?")[0];
      if (path !== "/ws" && path !== "/ws/") {
        socket.destroy();
        return;
      }
      if (this.conns.size >= this.cfg.maxPlayers) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnect(ws, req));
    });
  }
  // ------------------------------------------------------------------------------------------ connect
  onConnect(ws, req) {
    let conn = null;
    const ip = (this.cfg.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "") || req.socket.remoteAddress || "";
    const timeout = setTimeout(() => {
      if (!conn) ws.close(4e3, "Hello timeout");
    }, 1e4);
    let busy = false;
    ws.on("message", (data, isBinary) => {
      try {
        if (!conn) {
          if (isBinary || busy) return;
          busy = true;
          let msg;
          try {
            msg = JSON.parse(data.toString());
          } catch {
            ws.close(4400, "Bad hello");
            return;
          }
          if (msg.t !== "hello") {
            ws.close(4400, "Expected hello");
            return;
          }
          clearTimeout(timeout);
          const c = this.admit(ws, msg, ip);
          if (!c) return;
          conn = c;
          return;
        }
        if (isBinary) this.onBinary(conn, data);
        else this.onJson(conn, data.toString());
      } catch (e) {
        this.log.warn("message failed", e);
      }
    });
    ws.on("pong", () => {
      if (conn) conn.pong = true;
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      if (conn) this.drop(conn);
    });
    ws.on("error", () => {
    });
  }
  admit(ws, hello, _ip) {
    const reject = (code, why) => {
      try {
        ws.send(JSON.stringify({ t: "kick", reason: why }));
      } catch {
      }
      ws.close(code, why.slice(0, 120));
      return null;
    };
    if (hello.v !== PROTOCOL_VERSION) return reject(4426, "Your game is out of date. Refresh the page.");
    const auth = this.accounts.authenticate(String(hello.token ?? ""));
    if (!auth) return reject(4401, "Sign in again.");
    const b = banState(auth.account);
    if (b.banned) return reject(4403, `Banned: ${b.reason}`);
    const profile = this.accounts.profile(auth.account.id);
    if (!profile) return reject(4404, "Create your hustler first.");
    const old = this.byAccount.get(auth.account.id);
    if (old) {
      this.send(old, { t: "kick", reason: "You signed in somewhere else." });
      old.ws.close(4409, "Signed in elsewhere");
      this.drop(old);
    }
    const id = this.freePids.pop() ?? this.nextPid++;
    if (id >= VEH_BIT) return reject(4503, "Server full");
    const last = this.econ.lastPosition(auth.account.id);
    const now = performance.now();
    const ent = newPlayerEnt(id);
    const c = {
      kind: "p",
      id,
      x: 0,
      z: 0,
      cx: 0,
      cz: 0,
      key: -1,
      ent,
      ws,
      account: auth.account,
      sid: auth.sid,
      profile,
      since: Date.now(),
      role: auth.account.role,
      ms: newMoveState(last?.x ?? 0, last?.y ?? 0, last?.z ?? 0, now),
      lastSeq: 0,
      haveState: false,
      lastStateAt: now,
      msgBudget: 30,
      msgAt: now,
      stateBudget: 40,
      stateAt: now,
      chatTimes: [],
      lastChat: "",
      known: /* @__PURE__ */ new Map(),
      knownWho: /* @__PURE__ */ new Set(),
      veh: null,
      lastSnapAt: 0,
      saveAt: now,
      dead: false,
      alive: true,
      joinedAt: now,
      pong: true,
      skippedSnaps: 0,
      bytesOut: 0,
      bytesIn: 0
    };
    this.conns.set(id, c);
    this.byAccount.set(auth.account.id, c);
    if (last) {
      ent.X = cm(last.x);
      ent.Y = cm(last.y);
      ent.Z = cm(last.z);
      this.grid.put(c, last.x, last.z);
    }
    const w = this.econ.wallet(auth.account.id);
    const st = this.econ.state(auth.account.id);
    this.send(c, {
      t: "welcome",
      id,
      v: PROTOCOL_VERSION,
      tickHz: this.cfg.tickHz,
      serverTime: this.now(),
      epoch: Date.now(),
      cell: CELL,
      wallet: w,
      plots: this.econ.plotsOf(auth.account.id).map((p) => p.id),
      online: this.conns.size,
      profile: publicProfile(profile),
      role: auth.account.role,
      motd: this.cfg.motd,
      grid: this.power.state(),
      phone: (() => {
        const p = this.phone.ensure(auth.account.id);
        return { number: p.number, publicId: p.public_id, unread: this.phone.unread(auth.account.id) };
      })(),
      ice: this.iceServers(),
      ads: this.adsRef?.live() ?? [],
      clubs: this.clubsRef?.views() ?? [],
      phones: this.devices.view(auth.account.id),
      body: (() => {
        const v = this.body.view(auth.account.id);
        c.stripped = v.stripped;
        return v;
      })(),
      state: { ...st.blobs, vehicles: st.vehicles, skills: st.skills, missions: st.missions, pos: last }
    });
    this.log.info(`join ${profile.name} (#${id}) online=${this.conns.size}`);
    this.systemChat(`${profile.name} is on the streets.`, c);
    return c;
  }
  drop(c) {
    if (c.dead) return;
    c.dead = true;
    try {
      this.races.leave(c.account.id);
    } catch {
    }
    try {
      const fk = this.fixtures.byAccount.get(c.account.id);
      if (fk && this.fixtures.list.get(fk)?.state === "open") this.fixtures.leave(c.account.id);
    } catch {
    }
    for (const [cid, k] of this.calls) if (k.a === c || k.b === c) {
      this.calls.delete(cid);
      const o = k.a === c ? k.b : k.a;
      this.send(o, { t: "call", kind: "ended", callId: cid, from: c.profile.name, fromAccount: c.account.id, peer: c.id });
    }
    this.conns.delete(c.id);
    if (this.byAccount.get(c.account.id) === c) this.byAccount.delete(c.account.id);
    this.grid.remove(c);
    if (c.veh) this.removeVehicle(c.veh);
    for (const v of [...this.vehicles.values()]) if (v.owner === c) this.removeVehicle(v);
    this.freePids.push(c.id);
    try {
      if (c.haveState) {
        const p = this.outdoorPos(c);
        this.econ.savePosition(c.account.id, p.x, c.ms.y, p.z, (performance.now() - c.joinedAt) / 1e3);
      }
    } catch (e) {
      this.log.warn("save failed", e);
    }
    this.log.info(`leave ${c.profile.name} (#${c.id}) online=${this.conns.size}`);
  }
  // ------------------------------------------------------------------------------------------ inbound
  onBinary(c, data) {
    c.bytesIn += data.length;
    this.stats0.bytesIn += data.length;
    const now = performance.now();
    c.stateBudget = Math.min(40, c.stateBudget + (now - c.stateAt) / 1e3 * 30);
    c.stateAt = now;
    if (c.stateBudget < 1) {
      this.stats0.rejected++;
      return;
    }
    c.stateBudget -= 1;
    const m = decodeState(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (!m) {
      this.stats0.rejected++;
      return;
    }
    this.stats0.stateMsgs++;
    if (c.haveState && (m.seq - c.lastSeq & 65535) > 32768) return;
    if (now < c.ms.fixUntil) return;
    const mode = this.cfg.antiCheat;
    if (c.haveState && mode !== "off") {
      const v = judgeMove(c.ms, m, now, this.cfg.mapBounds);
      if (!v.ok) {
        this.stats0.rejected++;
        const kick = strike(c.ms, now, v.hard ? 3 : 1, 10);
        this.econ.flag(c.account.id, `move-${v.reason}`, { x: Math.round(m.x), z: Math.round(m.z), from: [Math.round(c.ms.x), Math.round(c.ms.z)] });
        if (mode === "enforce") {
          c.ms.fixUntil = now + 300;
          this.send(c, { t: "fix", x: c.ms.x, y: c.ms.y, z: c.ms.z, seq: c.lastSeq, why: v.reason });
          if (kick) {
            this.send(c, { t: "kick", reason: "Movement not allowed." });
            c.ws.close(4410, "cheat");
            this.drop(c);
          }
          return;
        }
      }
    }
    this.applyState(c, m, now);
  }
  applyState(c, m, now) {
    c.lastSeq = m.seq;
    c.lastStateAt = now;
    if (!c.haveState) {
      c.haveState = true;
      c.ms.x = m.x;
      c.ms.y = m.y;
      c.ms.z = m.z;
      c.ms.at = now;
    } else accept(c.ms, m, now);
    const e = c.ent;
    e.X = cm(m.x);
    e.Y = cm(m.y);
    e.Z = cm(m.z);
    e.yaw = packYaw(m.yaw);
    e.pitch = packPitch(m.pitch);
    e.anim = Math.min(m.anim, ANIMS.length - 1);
    e.speed = Math.max(0, Math.min(255, Math.round(m.speed * 4)));
    e.flags = m.flags & 2047;
    e.weapon = m.weapon;
    c.alive = (m.flags & F.ALIVE) !== 0;
    if (m.veh) {
      let v = c.veh;
      const kindChanged = v && (v.ent.kind !== m.veh.kind || v.ent.seed !== m.veh.seed >>> 0);
      if (v && kindChanged) {
        this.removeVehicle(v);
        v = null;
      }
      if (!v) v = c.veh = this.addVehicle(c, m.veh.kind, m.veh.seed >>> 0);
      const ve = v.ent;
      ve.X = cm(m.veh.x);
      ve.Y = cm(m.veh.y);
      ve.Z = cm(m.veh.z);
      ve.qx = packQ(m.veh.qx);
      ve.qy = packQ(m.veh.qy);
      ve.qz = packQ(m.veh.qz);
      ve.qw = packQ(m.veh.qw);
      ve.steer = packSteer(m.veh.steer);
      ve.spin = packSpin(m.veh.spin);
      ve.doors = packDoors(m.veh.doors);
      ve.vflags = m.veh.vflags & 63;
      ve.vspeed = Math.round(m.veh.vspeed * 100);
      ve.driver = m.veh.seat === 0 ? c.id : 0;
      v.parkedAt = 0;
      e.veh = ve.id;
      e.seat = m.veh.seat;
      this.grid.put(v, m.veh.x, m.veh.z);
    } else if (c.veh) {
      const v = c.veh;
      c.veh = null;
      v.parkedAt = Date.now();
      v.ent.driver = 0;
      v.ent.vflags &= ~(VF.LIGHTS | VF.HORN | VF.DRIVEN | VF.BRAKE);
      v.ent.vspeed = 0;
      e.veh = 0;
      e.seat = 0;
      const parked = [...this.vehicles.values()].filter((x) => x.owner === c && x.parkedAt).sort((a, b) => a.parkedAt - b.parkedAt);
      while (parked.length > PARKED_LIMIT) this.removeVehicle(parked.shift());
    }
    this.grid.put(c, m.x, m.z);
  }
  addVehicle(c, kind, seed) {
    const id = VEH_BIT | this.nextVid++ & 32767;
    if (this.nextVid > 32766) this.nextVid = 1;
    while (this.vehicles.has(id)) {
      return this.addVehicle(c, kind, seed);
    }
    const ent = newVehEnt(id);
    ent.kind = kind;
    ent.seed = seed;
    const v = { kind: "v", id, x: 0, z: 0, cx: 0, cz: 0, key: -1, ent, owner: c, ownerId: c.account.id, parkedAt: 0, spawnedAt: Date.now() };
    this.vehicles.set(id, v);
    return v;
  }
  removeVehicle(v) {
    this.vehicles.delete(v.id);
    this.grid.remove(v);
    const o = v.owner;
    if (o && o.veh === v) {
      o.veh = null;
      o.ent.veh = 0;
    }
  }
  onJson(c, text) {
    c.bytesIn += text.length;
    this.stats0.bytesIn += text.length;
    const now = performance.now();
    c.msgBudget = Math.min(30, c.msgBudget + (now - c.msgAt) / 1e3 * 15);
    c.msgAt = now;
    if (c.msgBudget < 1) {
      this.stats0.rejected++;
      return;
    }
    c.msgBudget -= 1;
    if (text.length > 4e3) return;
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    switch (m.t) {
      case "ping":
        this.send(c, { t: "pong", c: Number(m.c) || 0, s: this.now() });
        break;
      case "chat":
        this.onChat(c, m.ch === "global" ? "global" : "near", m.text);
        break;
      case "whisper":
        this.onWhisper(c, String(m.to ?? ""), m.text);
        break;
      case "emote":
        if (EMOTES.includes(m.id)) this.toNear(c, { t: "emote", id: c.id, e: m.id }, 80, true);
        break;
      case "act":
        void this.onAct(c, m);
        break;
      case "mx":
        this.fixtures.relay(c.account.id, m.d);
        break;
    }
  }
  // ------------------------------------------------------------------------------------------ chat
  chatOk(c, raw) {
    const acc = this.accounts.byId(c.account.id) ?? c.account;
    if (this.accounts.isMuted(acc)) {
      this.send(c, { t: "chat", ch: "system", from: "Server", fromId: 0, text: "You are muted.", ts: Date.now() });
      return null;
    }
    const text = cleanChat(raw);
    if (!text) return null;
    const now = Date.now();
    c.chatTimes = c.chatTimes.filter((t) => now - t < 12e3);
    if (c.chatTimes.length >= 6) {
      this.send(c, { t: "chat", ch: "system", from: "Server", fromId: 0, text: "Slow down, you are typing too fast.", ts: now });
      return null;
    }
    if (text === c.lastChat && c.chatTimes.length) return null;
    c.chatTimes.push(now);
    c.lastChat = text;
    return text;
  }
  logChat(c, ch, text, to) {
    try {
      run(this.db, "INSERT INTO chat_log(at,account_id,name,ch,to_name,text) VALUES(?,?,?,?,?,?)", Date.now(), c.account.id, c.profile.name, ch, to ?? null, text);
    } catch {
    }
  }
  onChat(c, ch, raw) {
    const text = this.chatOk(c, raw);
    if (!text) return;
    this.logChat(c, ch, text);
    const msg = { t: "chat", ch, from: c.profile.name, fromId: c.id, text, ts: Date.now() };
    if (ch === "global") this.broadcastJson(msg);
    else this.toNear(c, msg, this.cfg.nearChatRadius, true);
  }
  onWhisper(c, to, raw) {
    const text = this.chatOk(c, raw);
    if (!text) return;
    const target = this.findByName(to);
    if (!target) {
      this.send(c, { t: "chat", ch: "system", from: "Server", fromId: 0, text: `${to || "That person"} is not online.`, ts: Date.now() });
      return;
    }
    this.logChat(c, "whisper", text, target.profile.name);
    const msg = { t: "chat", ch: "whisper", from: c.profile.name, fromId: c.id, text, ts: Date.now() };
    this.send(target, msg);
    if (target !== c) this.send(c, { ...msg, from: `to ${target.profile.name}` });
  }
  findByName(name) {
    const k = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (!k) return void 0;
    for (const c of this.conns.values()) if (c.profile.name_key === k) return c;
    return void 0;
  }
  systemChat(text, except) {
    for (const c of this.conns.values()) if (c !== except) this.send(c, { t: "chat", ch: "system", from: "Lagos", fromId: 0, text, ts: Date.now() });
  }
  toNear(c, msg, radius, includeSelf) {
    const sent = /* @__PURE__ */ new Set();
    const space = this.spaceOf(c);
    this.grid.near(c.x, c.z, radius, (n) => {
      if (n.kind === "p") {
        const o = n;
        if (o === c && !includeSelf || this.spaceOf(o) !== space) return;
        sent.add(o);
      }
    });
    if (includeSelf) sent.add(c);
    for (const o of sent) this.send(o, msg);
  }
  // ------------------------------------------------------------------------------------------ economy actions
  async onAct(c, m) {
    const n = Number(m.n) || 0;
    const ok = (extra = {}) => this.send(c, { t: "ack", n, ok: true, ...extra });
    const fail = (e) => {
      if (e instanceof HttpError) this.send(c, { t: "ack", n, ok: false, err: e.message, ...e.extra, ...this.walletOf(c) });
      else {
        this.log.error("act failed", m.a, e);
        this.send(c, { t: "ack", n, ok: false, err: "Server error.", ...this.walletOf(c) });
      }
    };
    const id = c.account.id;
    try {
      switch (m.a) {
        case "plot.buy": {
          const r = this.econ.buyPlot(id, m.id, { cx: num2(m.cx), cz: num2(m.cz), area: num2(m.area), zone: str(m.zone), rich: num2(m.rich), pts: Array.isArray(m.pts) ? m.pts : void 0 });
          ok({ ...r.wallet, id: r.id, price: r.price });
          break;
        }
        case "bank.deposit":
          ok({ ...this.econ.deposit(id, Number(m.amount)) });
          break;
        case "bank.withdraw":
          ok({ ...this.econ.withdraw(id, Number(m.amount)) });
          break;
        case "cash.transfer": {
          const to = this.findByName(String(m.to ?? ""));
          const toRow = to ? to.account : null;
          const target = toRow ?? (this.accounts.profileByName(String(m.to ?? "")) ? this.accounts.byId(this.accounts.profileByName(String(m.to)).account_id) : null);
          if (!target) throw new HttpError(404, "No player with that name.");
          const amount = Math.floor(Number(m.amount));
          if (amount > 5e6) throw new HttpError(400, "Limit is \u20A65,000,000 per transfer.");
          const r = this.econ.transfer(id, target.id, amount, "player transfer");
          const tc = this.byAccount.get(target.id);
          if (tc) this.send(tc, { t: "toast", title: "Money received", body: `${c.profile.name} sent you \u20A6${amount.toLocaleString("en-NG")}.` });
          ok({ ...r.from, to: target.id });
          break;
        }
        case "cash.delta":
          ok({ ...this.econ.clientDelta(id, Number(m.d), String(m.why ?? "")) });
          break;
        case "job.start":
          this.econ.startJob(id, String(m.id));
          ok();
          break;
        case "job.done":
          ok({ ...this.econ.finishJob(id, String(m.id), Number(m.factor) || 1) });
          break;
        case "shop.buy": {
          const r = this.econ.shopBuy(id, m.sku, Number(m.qty) || 1);
          ok({ ...r.wallet, sku: r.sku, price: r.price, qty: r.qty });
          break;
        }
        case "state.put":
          this.econ.putState(id, m.key, m.value);
          ok();
          break;
        case "door": {
          const now = performance.now();
          if (now - c.ms.lastDoor < 1e3) throw new HttpError(429, "Slow down.");
          c.ms.lastDoor = now;
          let into = typeof m.into === "string" && m.into ? String(m.into).slice(0, 64) : null;
          if (into === "home") into = `home:${id}`;
          else if (into?.startsWith("home:") && into !== `home:${id}`) {
            this.checkVisit(c, into.slice(5));
            if (this.invites.get(id)?.designer) this.designing.set(id, into.slice(5));
          }
          if (!into) this.designing.delete(id);
          if (into) {
            c.ms.doorFrom = { x: c.ms.x, z: c.ms.z };
            c.ms.interior = into;
            c.ms.exitTo = null;
          } else {
            if (!c.ms.interior) throw new HttpError(400, "You are not inside anywhere.");
            const was = c.ms.interior;
            c.ms.exitTo = c.ms.doorFrom;
            c.ms.exitFrom = was;
            c.ms.interior = null;
            if (was === `home:${id}`) this.evictGuests(c);
          }
          c.ms.tpUntil = now + 3e3;
          ok({ into });
          break;
        }
        case "race.enter":
          ok({ ...this.econ.raceEnter(id, m.wager, m.rivals) });
          break;
        case "race.join":
          ok({ lobby: this.races.join(id, c.profile.name, { x: c.ms.x, z: c.ms.z }, m), ...this.walletOf(c) });
          break;
        case "race.leave":
          this.races.leave(id);
          ok({ ...this.walletOf(c) });
          break;
        case "race.start":
          ok({ lobby: this.races.start(id, m.len) });
          break;
        case "race.finish":
          ok({ lobby: this.races.finish(id, m.ms, m.len) });
          break;
        case "casino":
          ok(this.casino(c, m));
          break;
        case "social.greet": {
          const o = this.nearConn(c, m.to, 12);
          this.send(o, { t: "social", kind: "greet", from: c.profile.name, fromId: c.id });
          ok();
          break;
        }
        case "social.invite":
          ok(this.invite(c, m));
          break;
        case "room.edit": {
          const room = this.cleanRoom(m.room);
          if (!room) throw new HttpError(400, "Bad layout.");
          const space = c.ms.interior ?? "";
          if (!space.startsWith("home:")) throw new HttpError(400, "You are not in a room.");
          const owner = space.slice(5);
          if (owner !== id && this.designing.get(id) !== owner) throw new HttpError(403, "Only the owner or their designer can arrange this room.");
          for (const o of this.conns.values()) if (o !== c && o.ms.interior === space) this.send(o, { t: "room", room, by: c.profile.name, mine: o.account.id === owner });
          if (owner !== id) {
            const oc = this.byAccount.get(owner);
            if (oc && oc.ms.interior !== space) this.send(oc, { t: "room", room, by: c.profile.name, mine: true });
          }
          ok();
          break;
        }
        case "social.ticket": {
          const o = this.nearConn(c, m.to, 12);
          if (!o.veh) throw new HttpError(400, "They are not driving.");
          const k = `${id}>${o.account.id}`;
          const last = this.lastSwitch.get(k) ?? 0;
          if (Date.now() - last < 6e4) throw new HttpError(429, "You just asked them.");
          this.lastSwitch.set(k, Date.now());
          this.send(o, { t: "social", kind: "ticket", from: c.profile.name, fromId: c.id, amount: 300 });
          ok();
          break;
        }
        case "grid.get":
          ok({ board: this.power.board() });
          break;
        // ---- the phone network
        case "phone.me": {
          const p = this.phone.ensure(id);
          ok({ number: p.number, publicId: p.public_id });
          break;
        }
        case "phone.lookup": {
          const r = this.phone.lookup(m.q);
          if (!r) throw new HttpError(404, "No player with that number or ID.");
          ok({ who: { ...r, online: this.byAccount.has(r.id) } });
          break;
        }
        case "contacts.list":
          ok({ list: this.phone.contacts(id).map((x) => ({ ...x, online: this.byAccount.has(x.id) })) });
          break;
        case "contacts.add":
          ok({ who: this.phone.addContact(id, m.q, m.name) });
          break;
        case "contacts.remove":
          this.phone.removeContact(id, m.id);
          ok();
          break;
        case "msg.send": {
          const r = this.phone.send(id, m.to, m.body);
          const to = this.byAccount.get(r.to);
          if (to) this.send(to, { t: "msg", id: r.id, from: id, fromName: c.profile.name, body: r.body, at: r.at });
          ok({ msg: r });
          break;
        }
        case "msg.threads":
          ok({ list: this.phone.threads(id) });
          break;
        case "msg.thread":
          ok({ list: this.phone.thread(id, m.with) });
          break;
        case "call.start": {
          const to = this.byAccount.get(String(m.to ?? ""));
          if (!to || to === c) throw new HttpError(404, "The number you are calling is not reachable at the moment.");
          for (const k of this.calls.values()) if (k.a === to || k.b === to) throw new HttpError(409, "The line is busy.");
          const callId = `c${Date.now().toString(36)}${randomInt6(0, 1e6).toString(36)}`;
          this.calls.set(callId, { a: c, b: to, live: false, at: Date.now() });
          this.send(to, { t: "call", kind: "ring", callId, from: c.profile.name, fromAccount: id, peer: c.id });
          ok({ callId, peer: to.id });
          break;
        }
        case "call.answer": {
          const k = this.calls.get(String(m.callId ?? ""));
          if (!k || k.b !== c) throw new HttpError(404, "That call is gone.");
          if (m.accept) {
            k.live = true;
            this.send(k.a, { t: "call", kind: "accepted", callId: String(m.callId), from: c.profile.name, fromAccount: id, peer: c.id });
          } else {
            this.calls.delete(String(m.callId));
            this.send(k.a, { t: "call", kind: "declined", callId: String(m.callId), from: c.profile.name, fromAccount: id, peer: c.id });
          }
          ok();
          break;
        }
        case "call.end": {
          const cid = String(m.callId ?? "");
          const k = this.calls.get(cid);
          if (k && (k.a === c || k.b === c)) {
            this.calls.delete(cid);
            const o = k.a === c ? k.b : k.a;
            this.send(o, { t: "call", kind: "ended", callId: cid, from: c.profile.name, fromAccount: id, peer: c.id });
          }
          ok();
          break;
        }
        // ---- voice: WebRTC offers, answers and candidates between two players who may talk (near each other, on a call, same radio channel)
        case "rtc": {
          const o = this.conns.get(Number(m.to));
          if (!o || o === c || o.dead) throw new HttpError(404, "Gone.");
          let j2 = "";
          try {
            j2 = JSON.stringify(m.data ?? null);
          } catch {
          }
          if (!j2 || j2.length > 24e3) throw new HttpError(400, "Bad signal.");
          if (!this.mayTalk(c, o)) throw new HttpError(403, "Too far to talk.");
          this.send(o, { t: "rtc", from: c.id, data: JSON.parse(j2), radio: !!(c.radio && c.radio === o.radio), call: this.onCall(c, o) });
          ok();
          break;
        }
        case "radio.join": {
          const ch = typeof m.channel === "string" && /^[a-z0-9:_-]{1,40}$/.test(m.channel) ? m.channel : null;
          c.radio = ch;
          ok({ channel: ch, members: ch ? [...this.conns.values()].filter((o) => o !== c && o.radio === ch).map((o) => ({ id: o.id, name: o.profile.name })) : [] });
          break;
        }
        case "grid.switch": {
          if (c.ms.interior !== "power") throw new HttpError(400, "You are not in the control room.");
          const last = this.lastSwitch.get(id) ?? 0;
          if (Date.now() - last < 1500) throw new HttpError(429, "Easy on the switches.");
          this.lastSwitch.set(id, Date.now());
          const f = Math.floor(Number(m.f));
          if (!FEEDERS.some((x) => x.i === f)) throw new HttpError(400, "No such feeder.");
          ok({ state: this.power.switch(f, !!m.on, c.profile.name, Number(m.inHours) || 0, Number(m.hours) || void 0) });
          break;
        }
        case "biz.all":
          ok({ list: this.biz.all() });
          break;
        case "biz.mine":
          ok({ list: this.biz.mine(id) });
          break;
        case "biz.get":
          ok({ biz: this.biz.get(String(m.site ?? "")) });
          break;
        case "biz.buy": {
          const r = this.biz.buy(id, m.site, m.type, this.at(c));
          ok({ ...r.wallet, biz: r.biz });
          this.broadcastJson({ t: "biz", site: r.biz.site, type: r.biz.type, ownerName: c.profile.name });
          break;
        }
        case "biz.collect": {
          const r = this.biz.collect(id, m.site, this.at(c));
          ok({ ...r.wallet, amount: r.amount, biz: r.biz });
          break;
        }
        case "biz.restock": {
          const r = this.biz.restock(id, m.site, this.at(c));
          ok({ ...r.wallet, cost: r.cost, biz: r.biz });
          break;
        }
        case "biz.serve": {
          const r = this.biz.serve(id, m.site, this.at(c));
          ok({ ...r.wallet, item: r.item });
          const oc = this.byAccount.get(r.owner);
          if (oc) this.send(oc, { t: "toast", title: "Customer", body: `${c.profile.name} bought from your shop. \u20A6${r.item.price.toLocaleString("en-NG")} in the till.` });
          break;
        }
        case "ads.seen":
          ok({ counted: this.adsRef?.seen(id, m.ids) ?? 0 });
          break;
        // the body: death and the hospital bill, chemists and clinics, debts, getting dressed again
        case "body.me":
          ok({ body: this.body.view(id) });
          break;
        case "body.died": {
          const now = performance.now();
          if (now - c.ms.lastDeath < 15e3) throw new HttpError(429, "Too soon.");
          c.ms.lastDeath = now;
          const pos = this.outdoorPos(c);
          const r = this.body.died(id, pos);
          c.ms.lastTp = 0;
          c.ms.tpUntil = now + 6e3;
          if (typeof m.by === "number") {
            const k = this.conns.get(m.by);
            if (k && k !== c) this.body.karma(k.account.id, -8, "killed a player");
          }
          this.syncStrip(c, r.stripped || this.body.view(id).stripped);
          ok({ ...r, body: this.body.view(id), ...this.walletOf(c) });
          break;
        }
        case "body.exposure": {
          const got = this.body.exposure(id, String(m.kind ?? ""));
          ok({ body: got ? this.body.view(id) : void 0 });
          break;
        }
        case "body.treat": {
          const r = this.body.treat(id, this.outdoorPos(c), { where: m.where, drug: m.drug, op: m.op });
          ok({ ...r, body: this.body.view(id), ...this.walletOf(c) });
          break;
        }
        case "body.paydebt":
          ok({ ...this.body.payDebt(id, m.amount), body: this.body.view(id), ...this.walletOf(c) });
          break;
        case "body.dress": {
          const r = this.body.dress(id, this.outdoorPos(c));
          this.syncStrip(c, false);
          ok({ ...r, body: this.body.view(id), ...this.walletOf(c) });
          break;
        }
        // ---- phones as things: buy, switch, cracks, repairs, and the clone a crooked repairer keeps (src/devices.ts)
        case "dev.list":
          ok({ phones: this.devices.view(id), clones: this.devices.clones(id) });
          break;
        case "dev.buy":
          ok({ phones: this.devices.buy(id, m.model, this.outdoorPos(c)), ...this.walletOf(c) });
          break;
        case "dev.use":
          ok({ phones: this.devices.use(id, m.id) });
          break;
        case "dev.drop": {
          const cr = this.devices.drop(id, Number(m.hard) || 1);
          ok({ crack: cr, phones: cr !== null ? this.devices.view(id) : void 0 });
          break;
        }
        case "dev.repair":
          ok({ ...this.devices.shopRepair(id, m.id, this.outdoorPos(c)), ...this.walletOf(c) });
          break;
        case "dev.clean":
          ok({ ...this.devices.clean(id, m.id, this.outdoorPos(c)), ...this.walletOf(c) });
          break;
        case "dev.offer": {
          const t = this.conns.get(Number(m.to));
          if (!t || t === c || this.spaceOf(t) !== this.spaceOf(c) || Math.hypot(t.ms.x - c.ms.x, t.ms.z - c.ms.z) > 6) throw new HttpError(400, "Stand next to them.");
          const o = this.devices.offer(id, c.profile.name, t.account.id, m.price, m.clone);
          this.send(t, { t: "devoffer", id: o.id, fromName: o.fromName, price: o.price });
          ok({ offer: o.id });
          break;
        }
        case "dev.accept": {
          const o = this.devices.offers.get(String(m.offer));
          const hx = o ? this.econ.state(o.from).skills?.xp?.hack ?? 0 : 0;
          const r = this.devices.accept(id, m.offer, Math.min(10, 1 + Math.floor(Math.sqrt(Math.max(0, Number(hx)) / 50))));
          const rc = this.byAccount.get(r.offer.from);
          if (rc) this.send(rc, { t: "toast", title: "Phone repair", body: `${c.profile.name} paid \u20A6${r.offer.price.toLocaleString("en-NG")}.${r.offer.clone ? r.cloned ? " You kept a copy of their phone." : " The copy did not take." : ""}` });
          ok({ phones: this.devices.view(id), ...this.walletOf(c) });
          break;
        }
        case "clone.list":
          ok({ clones: this.devices.clones(id) });
          break;
        case "clone.read": {
          const d = this.devices.clone(id, m.device);
          this.devices.noteMove(d.id, id, "read");
          ok(m.with ? { thread: this.phone.thread(d.owner_id, m.with, true) } : { threads: this.phone.threads(d.owner_id), contacts: this.phone.contacts(d.owner_id) });
          break;
        }
        case "clone.send": {
          const d = this.devices.clone(id, m.device);
          const r = this.phone.send(d.owner_id, m.to, m.body);
          this.devices.noteMove(d.id, id, "text");
          const to = this.byAccount.get(r.to);
          const owner = this.byAccount.get(d.owner_id);
          if (to) this.send(to, { t: "msg", id: r.id, from: d.owner_id, fromName: owner?.profile.name ?? "Contact", body: r.body, at: r.at });
          this.body.karma(id, -1, "texted as someone else");
          ok({ msg: r });
          break;
        }
        case "clone.locate": {
          const d = this.devices.clone(id, m.device);
          const o = this.byAccount.get(d.owner_id);
          this.devices.noteMove(d.id, id, "locate");
          ok(o ? { at: this.outdoorPos(o), inside: !!o.ms.interior } : { at: null });
          break;
        }
        case "clone.steal":
          ok({ ...this.devices.steal(id, m.device, m.amount), ...this.walletOf(c) });
          break;
        // ---- the Eko Exchange: shares of listed companies and units of players' shops (src/exchange.ts)
        case "ex.quotes":
          ok({ pressure: this.exchange.pressures() });
          break;
        case "ex.trade":
          ok({ trade: this.exchange.trade(id, m.sym, m.side, m.qty), ...this.walletOf(c) });
          break;
        case "ex.portfolio":
          ok({ portfolio: this.exchange.portfolio(id) });
          break;
        case "bx.market":
          ok({ list: this.exchange.market(), mine: this.exchange.mine(id) });
          break;
        case "bx.offer":
          ok({ ...this.exchange.offer(id, m.site, m.units, m.price) });
          break;
        case "bx.cancel":
          this.exchange.cancel(id, m.id);
          ok();
          break;
        case "bx.take": {
          const r = this.exchange.take(id, m.id, m.units);
          const sc = this.byAccount.get(r.seller);
          if (sc) this.send(sc, { t: "toast", title: "Eko Exchange", body: `${c.profile.name} bought ${r.units} units of your stake. \u20A6${r.value.toLocaleString("en-NG")} is in your bank.` });
          ok({ units: r.units, value: r.value, fee: r.fee, ...this.walletOf(c) });
          break;
        }
        // only bad deeds come from the game itself; good deeds are counted where the server can see them
        case "karma.deed": {
          const BAD2 = { assault: -1, theft: -2, robbery: -4, murder: -10, police: -6, scam: -5, littering: -0.2 };
          const d = BAD2[String(m.kind)];
          if (d) this.body.karma(id, d, String(m.kind));
          ok();
          break;
        }
        // ---- Property Manager, venues, bookings, fixtures (src/property.ts, realtime/matches.ts)
        // ---- clubs: decks, pole stages, the bar, spraying, shutdowns and the song crate (src/clubs.ts)
        case "club.state":
          ok({ clubs: this.clubsOrThrow().views() });
          break;
        case "club.decks":
          ok({ club: this.clubsOrThrow().takeDecks(id, c.profile.name, m.club, this.clubPos(c)) });
          break;
        case "club.pole":
          ok({ club: this.clubsOrThrow().takePole(id, c.profile.name, m.club, m.pole, this.clubPos(c), !!c.stripped) });
          break;
        case "club.leave":
          ok({ ended: this.clubsOrThrow().endShift(id), ...this.walletOf(c) });
          break;
        case "club.play":
          ok({ club: this.clubsOrThrow().play(id, m.club, m.track) });
          break;
        case "club.spray":
          ok({ spray: this.clubsOrThrow().spray(id, c.profile.name, m.club, m.to, m.amount, this.clubPos(c)), ...this.walletOf(c) });
          break;
        case "club.shutdown":
          ok({ club: this.clubsOrThrow().shutdown(id, c.profile.name, m.club, this.clubPos(c)), ...this.walletOf(c) });
          break;
        case "club.bar": {
          const r = this.clubsOrThrow().buyDrink(id, this.clubPos(c));
          ok({ price: r.price, ...this.walletOf(c) });
          break;
        }
        case "club.enter":
          ok({ ...this.clubsOrThrow().enter(id, m.club, m.kind, this.clubPos(c), !!c.stripped), ...this.walletOf(c) });
          break;
        case "club.vip":
          ok({ club: this.clubsOrThrow().bookVip(id, c.profile.name, m.club, m.table, this.clubPos(c)), ...this.walletOf(c) });
          break;
        case "club.bottle":
          ok({ ...this.clubsOrThrow().bottle(id, m.club, this.clubPos(c)), ...this.walletOf(c) });
          break;
        case "club.crate": {
          const k = this.clubsOrThrow();
          const cl = typeof m.club === "string" && ["zilox", "gele", "orun"].includes(m.club) ? m.club : "zilox";
          ok({ list: k.crate(cl), mine: k.mine(id) });
          break;
        }
        case "songs.mine":
          ok({ list: this.clubsOrThrow().mine(id) });
          break;
        case "songs.remove":
          ok({ list: this.clubsOrThrow().remove(id, m.id) });
          break;
        case "prop.mine":
          ok({ list: this.props.owned(id), bookings: this.props.myBookings(id) });
          break;
        case "prop.market":
          ok({ list: this.props.market(m.kind) });
          break;
        case "prop.info":
          ok({ info: this.props.info(m.kind, m.id) });
          break;
        case "prop.list":
          ok({ listing: this.props.list(id, m) });
          break;
        case "prop.unlist":
          this.props.unlist(id, m);
          ok();
          break;
        case "prop.buy": {
          const r = this.props.buy(id, m);
          ok({ ...r.wallet, price: r.price });
          const sc = this.byAccount.get(r.seller);
          if (sc) this.send(sc, { t: "toast", title: "Property sold", body: `${c.profile.name} bought your property for \u20A6${r.price.toLocaleString("en-NG")}. Money is in your bank.` });
          break;
        }
        case "venue.all":
          ok({ list: this.props.allVenues() });
          break;
        case "venue.get":
          ok({ venue: this.props.venue(m.id), fixtures: this.fixtures.open().filter((f) => f.venue === m.id) });
          break;
        case "venue.buy": {
          const r = this.props.buyVenue(id, m.id, this.at(c));
          ok({ ...r.wallet, price: r.price });
          break;
        }
        case "venue.fee":
          ok({ fee: this.props.setFee(id, m.id, m.fee) });
          break;
        case "venue.book": {
          const r = this.props.book(id, m.id, m.slot);
          ok({ ...r.wallet, fee: r.fee, slot: r.slot });
          const oc = r.owner && r.fee ? this.byAccount.get(r.owner) : void 0;
          if (oc) this.send(oc, { t: "toast", title: "Booking", body: `${c.profile.name} booked your venue. \u20A6${Math.round(r.fee * 0.9).toLocaleString("en-NG")} paid in.` });
          break;
        }
        case "fx.open":
          ok({ list: this.fixtures.open() });
          break;
        case "fx.create":
          ok({ fixture: this.fixtures.create(id, c.profile.name, m), ...this.walletOf(c) });
          break;
        case "fx.join":
          ok({ fixture: this.fixtures.join(id, c.profile.name, m), ...this.walletOf(c) });
          break;
        case "fx.leave":
          this.fixtures.leave(id);
          ok({ ...this.walletOf(c) });
          break;
        case "fx.start":
          ok({ fixture: this.fixtures.start(id) });
          break;
        case "fx.report":
          this.fixtures.report(id, m.sa, m.sb);
          ok();
          break;
        case "tp":
        case "respawn": {
          const now = performance.now();
          if (now - c.ms.lastTp < 1e4) {
            this.econ.flag(id, "tp-spam", { a: m.a });
            throw new HttpError(429, "Too many teleports.");
          }
          c.ms.lastTp = now;
          c.ms.tpUntil = now + 2500;
          ok();
          break;
        }
        default:
          throw new HttpError(400, "Unknown action.");
      }
    } catch (e) {
      fail(e);
    }
  }
  // ------------------------------------------------------------------------------------------ people: greetings and room invites
  /** account -> who invited them into their room, until when, and the room door (so the guest can find it) */
  invites = /* @__PURE__ */ new Map();
  /** who is currently designing whose room (set when a designer walks in) */
  designing = /* @__PURE__ */ new Map();
  /** players see each other only in the same space: the street, one venue, or one person's room */
  spaceOf(c) {
    return c.ms.interior ?? "";
  }
  onCall(a, b) {
    for (const k of this.calls.values()) if (k.live && (k.a === a && k.b === b || k.a === b && k.b === a)) return true;
    return false;
  }
  /** two players may open a voice link: near each other in the same space, on a call, or on the same radio channel */
  mayTalk(a, b) {
    if (this.onCall(a, b)) return true;
    if (a.radio && a.radio === b.radio) return true;
    for (const k of this.calls.values()) if (!k.live && (k.a === a && k.b === b || k.a === b && k.b === a)) return true;
    return this.spaceOf(a) === this.spaceOf(b) && Math.hypot(a.ms.x - b.ms.x, a.ms.z - b.ms.z) < 45;
  }
  /** STUN for everyone, TURN when the operator configured one (voice through strict NATs) */
  iceServers() {
    const l = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
    const t = process.env.TURN_URL;
    if (t) l.push({ urls: t, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
    return l;
  }
  clubsOrThrow() {
    if (!this.clubsRef) throw new HttpError(503, "The clubs are closed right now.");
    return this.clubsRef;
  }
  at(c) {
    return { x: c.ms.x, z: c.ms.z, interior: c.ms.interior };
  }
  nearConn(c, to, r) {
    const o = this.conns.get(Number(to));
    if (!o || o === c || o.dead || !o.haveState) throw new HttpError(404, "They are not around.");
    if (this.spaceOf(o) !== this.spaceOf(c) || Math.hypot(o.ms.x - c.ms.x, o.ms.z - c.ms.z) > r) throw new HttpError(400, "Get closer to them first.");
    return o;
  }
  invite(c, m) {
    const o = this.nearConn(c, m.to, 15);
    const id = c.account.id;
    if (c.ms.interior && c.ms.interior !== `home:${id}`) throw new HttpError(400, "Invite them from the street or your room.");
    const d = m.door;
    const door = d && [d.x, d.z, d.yaw].every((v) => typeof v === "number" && Number.isFinite(v)) ? { x: d.x, z: d.z, yaw: d.yaw } : null;
    if (!door) throw new HttpError(400, "You have no room to invite them to.");
    const designer = !!m.designer;
    const room = this.cleanRoom(m.room);
    this.invites.set(o.account.id, { owner: id, name: c.profile.name, until: Date.now() + 15 * 6e4, designer });
    this.send(o, { t: "social", kind: "invite", from: c.profile.name, fromId: c.id, owner: id, door, room, designer });
    return { to: o.profile.name };
  }
  /** a guest may walk into someone's room only with a live invite, while the owner is home, from near the owner's door */
  checkVisit(c, owner) {
    const inv = this.invites.get(c.account.id);
    if (!inv || inv.owner !== owner || inv.until < Date.now()) throw new HttpError(403, "You were not invited.");
    const oc = this.byAccount.get(owner);
    if (!oc || oc.ms.interior !== `home:${owner}`) throw new HttpError(400, `${inv.name} is not home right now.`);
    const at = oc.ms.doorFrom;
    if (!at || Math.hypot(c.ms.x - at.x, c.ms.z - at.z) > 30) throw new HttpError(400, "Go to their door first.");
  }
  /** a room layout from a client: small, plain JSON, or nothing */
  cleanRoom(r) {
    if (!r || typeof r !== "object") return null;
    let j2 = "";
    try {
      j2 = JSON.stringify(r);
    } catch {
      return null;
    }
    if (j2.length > 12e3) return null;
    const o = JSON.parse(j2);
    return o && o.v === 1 && Array.isArray(o.extra) && o.extra.length <= 40 && typeof o.pos === "object" ? o : null;
  }
  evictGuests(owner) {
    const room = `home:${owner.account.id}`;
    for (const o of this.conns.values()) if (o !== owner && o.ms.interior === room) this.send(o, { t: "social", kind: "evict", from: owner.profile.name, fromId: owner.id });
  }
  // ------------------------------------------------------------------------------------------ casino: all randomness and money on the server
  bj = /* @__PURE__ */ new Map();
  casino(c, m) {
    const id = c.account.id;
    if (c.ms.interior !== "casino") throw new HttpError(400, "You are not in the casino.");
    const rand5 = () => randomInt6(0, 2 ** 32) / 2 ** 32;
    const cash = () => this.econ.wallet(id).cash;
    const game = String(m.game ?? "");
    if (game === "slots") {
      const bet = Math.floor(Number(m.bet));
      if (!SLOT_BETS.includes(bet)) throw new HttpError(400, "Bad bet.");
      if (cash() < bet) throw new HttpError(400, "Not enough cash.");
      this.econ.casino(id, -bet, "slots");
      let r = slotSpin(rand5, bet);
      const luck = this.body.luck(id);
      if (!r.win && luck > 0 && rand5() < luck / 100 * 0.12 || r.win && luck < 0 && rand5() < -luck / 100 * 0.12) r = slotSpin(rand5, bet);
      const w = r.win ? this.econ.casino(id, r.win, "slots") : this.econ.wallet(id);
      return { reels: r.reels, win: r.win, cash: w.cash, bank: w.bank };
    }
    if (game === "roulette") {
      const bets = m.bets ?? {};
      let staked = 0;
      for (const [k, v] of Object.entries(bets)) {
        if (!ROULETTE_KEYS.test(k) || !Number.isInteger(v) || v < 500 || v > 5e5) throw new HttpError(400, "Bad bet.");
        staked += v;
      }
      if (!staked || staked > 1e6) throw new HttpError(400, "Bad stake.");
      if (cash() < staked) throw new HttpError(400, "Not enough cash.");
      this.econ.casino(id, -staked, "roulette");
      let n = randomInt6(0, 37);
      const pays = (x) => Object.entries(bets).reduce((t, [k, v]) => t + v * roulettePays(k, x), 0);
      const luck = this.body.luck(id);
      if (pays(n) < staked && luck > 0 && rand5() < luck / 100 * 0.1 || pays(n) > staked && luck < 0 && rand5() < -luck / 100 * 0.1) n = randomInt6(0, 37);
      const back = pays(n);
      const w = back ? this.econ.casino(id, back, "roulette") : this.econ.wallet(id);
      return { num: n, back, staked, cash: w.cash, bank: w.bank };
    }
    if (game === "bj") {
      let t = this.bj.get(id);
      if (!t) {
        t = new BjTable(rand5);
        this.bj.set(id, t);
      }
      const op = String(m.op ?? "");
      if (op === "deal") {
        if (t.phase === "play") throw new HttpError(400, "Finish this hand.");
        const bet = Math.floor(Number(m.bet));
        if (bet < 500 || bet > 5e5) throw new HttpError(400, "Bad bet.");
        if (cash() < bet) throw new HttpError(400, "Not enough cash.");
        this.econ.casino(id, -bet, "blackjack");
        t._paid = false;
        t.deal(bet);
      } else if (op === "hit") t.hit();
      else if (op === "stand") t.stand();
      else if (op === "double") {
        if (t.phase !== "play" || t.ph.length !== 2) throw new HttpError(400, "Cannot double now.");
        if (cash() < t.bet) throw new HttpError(400, "Not enough cash.");
        this.econ.casino(id, -t.bet, "blackjack");
        t.double();
      } else throw new HttpError(400, "Bad move.");
      if (t.phase === "done" && t.bet + t.net > 0 && !t._paid) {
        this.econ.casino(id, t.bet + t.net, "blackjack");
        t._paid = true;
      }
      const w = this.econ.wallet(id);
      return { ...t.view(), cash: w.cash, bank: w.bank };
    }
    throw new HttpError(400, "Unknown game.");
  }
  /** everyone near sees you in your underwear (or dressed again) */
  syncStrip(c, on2) {
    if (!!c.stripped === on2) return;
    c.stripped = on2;
    this.announceWho(c);
  }
  /** illnesses spread between players standing close and run their course; the sick see it, carriers do not */
  bodyTick() {
    try {
      const list = [...this.conns.values()].map((c) => ({ accountId: c.account.id, x: c.ms.x, z: c.ms.z, space: this.spaceOf(c) }));
      const r = this.body.tick(list);
      for (const a of r.changed) {
        const c = this.byAccount.get(a);
        if (c) this.send(c, { t: "body", ...this.body.view(a) });
      }
      for (const a of r.collapsed) {
        const c = this.byAccount.get(a);
        if (c) this.send(c, { t: "body", ...this.body.view(a), collapse: true });
      }
    } catch (e) {
      this.log.warn("body tick", e);
    }
  }
  /** never store a position inside the interior zone: a player who logs out indoors comes back at the door */
  outdoorPos(c) {
    return c.ms.interior && c.ms.doorFrom ? c.ms.doorFrom : inInteriorZone(c.ms.x, c.ms.z) ? { x: 900, z: -330 } : { x: c.ms.x, z: c.ms.z };
  }
  walletOf(c) {
    const w = this.econ.wallet(c.account.id);
    return { cash: w.cash, bank: w.bank };
  }
  // ------------------------------------------------------------------------------------------ snapshots
  tick() {
    this.tickN++;
    this.stats0.ticks++;
    if (this.tickN % (this.cfg.tickHz * 10) === 0) this.bodyTick();
    if (this.tickN % (this.cfg.tickHz * 60) === 0) for (const c of this.conns.values()) {
      try {
        if (this.devices.age(c.account.id, 1) !== null) this.send(c, { t: "phones", list: this.devices.view(c.account.id) });
      } catch {
      }
    }
    if (this.tickN % this.cfg.tickHz === 0) {
      this.races.tick();
      this.power.tick();
      this.fixtures.tick();
    }
    if (this.tickN % (this.cfg.tickHz * 30) === 0) {
      try {
        this.props.tick();
      } catch (e) {
        this.log.warn("props tick", e);
      }
    }
    const R = this.cfg.interestRings;
    const now = performance.now();
    if (this.tickN % (this.cfg.tickHz * 10) === 0) {
      const t = Date.now();
      for (const v of [...this.vehicles.values()]) if (v.parkedAt && t - v.parkedAt > PARKED_TTL) this.removeVehicle(v);
    }
    const nowMs = this.now();
    for (const c of this.conns.values()) {
      if (c.dead || c.ws.readyState !== 1) continue;
      if (!c.haveState) continue;
      if (c.ws.bufferedAmount > 512 * 1024) {
        c.skippedSnaps++;
        this.stats0.dropsBackpressure++;
        continue;
      }
      const w = this.writer;
      const countAt = beginSnapshot(w, { time: nowMs, ack: c.lastSeq });
      const visible = /* @__PURE__ */ new Set();
      let count = 0;
      const newcomers = [];
      const tier = this.tickN + c.id | 0;
      const space = this.spaceOf(c);
      this.grid.around(c.cx, c.cz, R, (n, ring) => {
        if (n === c || n === c.veh || n.kind === "v" && n.owner === c) return;
        if (n.kind === "p") {
          const o = n;
          if (!o.haveState || this.spaceOf(o) !== space) return;
        } else if (space) return;
        visible.add(n.id);
        const base = c.known.get(n.id) ?? null;
        if (base && ring > NEAR_RINGS_FULL_RATE) {
          const every = ring === 2 ? 3 : 6;
          if (tier % every !== 0) return;
        }
        const e = n.ent;
        if (writeEntity(w, e, base ? base : null)) {
          count++;
          if (!base) {
            const copy = { ...e };
            c.known.set(n.id, copy);
            if (n.kind === "p") newcomers.push(n);
          }
        }
      });
      const removed = [];
      for (const id of c.known.keys()) {
        if (visible.has(id)) continue;
        const node = id & VEH_BIT ? this.vehicles.get(id) : this.conns.get(id);
        const same = node && (node.kind === "p" ? node.haveState && this.spaceOf(node) === space : !space);
        if (node && same && Math.max(Math.abs(node.cx - c.cx), Math.abs(node.cz - c.cz)) <= R + 1) continue;
        removed.push(id);
      }
      for (const id of removed) {
        c.known.delete(id);
        c.knownWho.delete(id);
      }
      if (!count && !removed.length && this.tickN % this.cfg.tickHz !== 0) {
        w.o = 0;
        continue;
      }
      const who = [];
      for (const o of newcomers) if (!c.knownWho.has(o.id)) {
        c.knownWho.add(o.id);
        who.push(whoOf(o));
      }
      if (who.length) this.send(c, { t: "who", list: who });
      const buf = endSnapshot(w, countAt, count, removed);
      c.ws.send(Buffer.from(buf), { binary: true });
      c.bytesOut += buf.length;
      this.stats0.bytesOut += buf.length;
      this.stats0.snapshots++;
      c.lastSnapAt = now;
    }
  }
  announceWho(c) {
    const info = whoOf(c);
    for (const o of this.conns.values()) if (o.knownWho.has(c.id)) this.send(o, { t: "who", list: [info] });
  }
  // ------------------------------------------------------------------------------------------ housekeeping
  heartbeat() {
    for (const c of [...this.conns.values()]) {
      if (!c.pong) {
        try {
          c.ws.terminate();
        } catch {
        }
        this.drop(c);
        continue;
      }
      c.pong = false;
      try {
        c.ws.ping();
      } catch {
      }
      const acc = this.accounts.byId(c.account.id);
      if (acc) {
        c.role = acc.role;
        const b = banState(acc);
        if (b.banned) this.kick(c.account.id, `Banned: ${b.reason}`);
      }
    }
  }
  saveAll() {
    for (const c of this.conns.values()) if (c.haveState) {
      try {
        const p = this.outdoorPos(c);
        this.econ.savePosition(c.account.id, p.x, c.ms.y, p.z, 20);
      } catch (e) {
        this.log.warn("save failed", e);
      }
    }
  }
  send(c, m) {
    if (c.ws.readyState === 1) {
      const s = JSON.stringify(m);
      c.bytesOut += s.length;
      this.stats0.bytesOut += s.length;
      c.ws.send(s);
    }
  }
  broadcastJson(m) {
    const s = JSON.stringify(m);
    for (const c of this.conns.values()) if (c.ws.readyState === 1) {
      c.ws.send(s);
      c.bytesOut += s.length;
    }
  }
  // ------------------------------------------------------------------------------------------ OnlineApi (for routes)
  count() {
    return this.conns.size;
  }
  list() {
    return [...this.conns.values()].map((c) => ({ id: c.id, accountId: c.account.id, name: c.profile.name, x: c.ms.x, z: c.ms.z, role: c.role, since: c.since, vehicle: !!c.veh }));
  }
  isOnline(accountId) {
    return this.byAccount.has(accountId);
  }
  kick(accountId, reason) {
    const c = this.byAccount.get(accountId);
    if (!c) return false;
    this.send(c, { t: "kick", reason });
    try {
      c.ws.close(4403, reason.slice(0, 100));
    } catch {
    }
    this.drop(c);
    return true;
  }
  broadcast(text, from = "Server") {
    this.broadcastJson({ t: "chat", ch: "system", from, fromId: 0, text, ts: Date.now() });
  }
  toast(accountId, title, body) {
    const c = this.byAccount.get(accountId);
    if (!c) return false;
    this.send(c, { t: "toast", title, body });
    return true;
  }
  teleport(accountId, x, z) {
    const c = this.byAccount.get(accountId);
    if (!c) return false;
    const now = performance.now();
    c.ms.x = x;
    c.ms.z = z;
    c.ms.tpUntil = now + 2500;
    c.ms.fixUntil = now + 300;
    this.send(c, { t: "fix", x, y: c.ms.y, z, seq: c.lastSeq, why: "admin" });
    return true;
  }
  rooms() {
    const players = this.grid.rooms((n) => n.kind === "p" ? 1 : 0);
    const veh = this.grid.rooms((n) => n.kind === "v" ? 1 : 0);
    return [.../* @__PURE__ */ new Set([...players.keys(), ...veh.keys()])].map((key) => ({ key, players: players.get(key) ?? 0, vehicles: veh.get(key) ?? 0 }));
  }
  stats() {
    const s = this.stats0;
    return { online: this.conns.size, vehicles: this.vehicles.size, cells: this.grid.cellCount(), rooms: this.rooms().length, ...s, tickHz: this.cfg.tickHz, uptime: Math.round(this.now() / 1e3) };
  }
};
var num2 = (v) => typeof v === "number" ? v : void 0;
var str = (v) => typeof v === "string" ? v : void 0;
function whoOf(o) {
  return { id: o.id, name: o.profile.name, model: o.profile.model, skin: o.profile.skin, outfit: o.profile.outfit, level: 1 + Math.floor(Math.sqrt(Math.max(0, o.profile.xp) / 60)), role: o.role === "player" ? void 0 : o.role, ...o.stripped ? { strip: 1 } : {} };
}

// server/src/payments.ts
import { EventEmitter as EventEmitter7 } from "node:events";
import { createHmac as createHmac2, randomBytes as randomBytes4, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
var PAYSTACK = "https://api.paystack.co";
var PENDING_TTL = 24 * 36e5;
var rec = (r) => ({ id: r.id, accountId: r.account_id, sku: r.sku, kind: r.kind, amountKobo: r.amount_minor, currency: r.currency, status: r.status, ref: r.ref ?? r.id, label: r.label ?? r.sku, meta: safeJson(r.meta), promo: r.promo, providerRef: r.provider_ref, granted: safeJson(r.granted), createdAt: r.created_at, paidAt: r.paid_at });
function safeJson(s) {
  try {
    const v = JSON.parse(s ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
var Payments = class extends EventEmitter7 {
  constructor(db, cfg, economy, content, log2) {
    super();
    this.db = db;
    this.cfg = cfg;
    this.economy = economy;
    this.content = content;
    this.log = log2;
    if (this.mode === "test") log2.warn("payments: TEST MODE. Checkouts are fake and grant goods without money. Set PAYSTACK_SECRET_KEY for real payments.");
    else if (this.mode === "off") log2.warn("payments: off (no PAYSTACK_SECRET_KEY and PAY_TEST is off).");
    this.register("iap", {
      quote: (a, id, meta) => {
        const items = this.iapItems();
        const now = Date.now();
        const it = iapCatalog(items, now).find((x) => x.id === id);
        if (!it) throw new HttpError(404, "That pack is not on sale.");
        const bought = (where, ...p) => one(this.db, `SELECT COUNT(*) n FROM purchases WHERE status='paid' AND ${where}`, ...p).n;
        if (it.limit && bought("account_id=? AND sku=?", a.id, `iap:${id}`) >= it.limit) throw new HttpError(409, "You don buy this one already. Na one per person.", { code: "limit" });
        let price = it.priceNGN;
        let promo = null;
        if (meta.promo) {
          const p = findPromo(items, meta.promo, id, now);
          if (!p) throw new HttpError(400, "That code no work for this pack.", { code: "promo" });
          if (p.perAccount && bought("account_id=? AND promo=?", a.id, p.code) >= p.perAccount) throw new HttpError(409, "You don use that code already.", { code: "promo" });
          if (p.maxUses && bought("promo=?", p.code) >= p.maxUses) throw new HttpError(409, "That code don finish.", { code: "promo" });
          price = promoPrice(p, price);
          promo = p.code;
        }
        return { amountKobo: koboOf(price), label: it.name, promo, meta: { grants: it.grants } };
      },
      fulfil: (p) => {
        const g = p.meta.grants ?? {};
        const cash = Math.max(0, Math.floor(g.cash ?? 0)), bank = Math.max(0, Math.floor(g.bank ?? 0));
        if (cash || bank) this.economy.adjust(p.accountId, cash, bank, "iap", { ref: p.ref, note: p.label });
        return { cash, bank };
      }
    });
  }
  products = /* @__PURE__ */ new Map();
  /** swapped in tests */
  fetch = (u, i) => fetch(u, i);
  get mode() {
    return this.cfg.paystackSecret ? "live" : this.cfg.payTest ? "test" : "off";
  }
  register(kind, p) {
    if (!/^[a-z]{2,12}$/.test(kind)) throw new Error(`bad product kind ${kind}`);
    this.products.set(kind, p);
  }
  iapItems() {
    return this.content.read("iap")?.items ?? [];
  }
  catalog() {
    return iapCatalog(this.iapItems(), Date.now());
  }
  publicConfig() {
    return { mode: this.mode, publicKey: this.cfg.paystackPublic || null, currency: PAY_CURRENCY, packs: this.mode === "off" ? [] : this.catalog() };
  }
  // ------------------------------------------------------------------------------------------ checkout
  async start(account, skuRaw, metaRaw) {
    if (this.mode === "off") throw new HttpError(503, "Payments are not switched on yet.", { code: "pay_off" });
    const sku = parseSku(skuRaw);
    if (!sku) throw new HttpError(400, "Bad product.");
    const prod = this.products.get(sku.kind);
    if (!prod) throw new HttpError(404, "We no sell that one.");
    const meta = metaRaw && typeof metaRaw === "object" && !Array.isArray(metaRaw) ? metaRaw : {};
    if (JSON.stringify(meta).length > 4e3) throw new HttpError(400, "Too much detail on the order.");
    const open = one(this.db, "SELECT COUNT(*) n FROM purchases WHERE account_id=? AND status='pending' AND created_at>?", account.id, Date.now() - 36e5).n;
    if (open >= 8) throw new HttpError(429, "You have too many unfinished payments. Finish one or wait small.");
    const q = await prod.quote(account, sku.id, meta);
    const amountKobo = Math.round(q.amountKobo);
    if (!Number.isFinite(amountKobo) || amountKobo < PAY_MIN_KOBO || amountKobo > PAY_MAX_KOBO) throw new HttpError(400, "That price is outside what we take in one payment.");
    const ref = "hl_" + randomBytes4(15).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(20, "0").slice(0, 20);
    const now = Date.now();
    const label = String(q.label).slice(0, 120);
    const keep = { ...meta, ...q.meta ?? {} };
    run(this.db, `INSERT INTO purchases(id,account_id,sku,kind,amount_minor,currency,provider,status,granted,created_at,updated_at,item_id,amount,ref,promo,label,meta)
      VALUES(?,?,?,?,?,?,?,'pending','{}',?,?,?,?,?,?,?,?)`, ref, account.id, `${sku.kind}:${sku.id}`, sku.kind, amountKobo, PAY_CURRENCY, this.mode === "live" ? "paystack" : "test", now, now, `${sku.kind}:${sku.id}`, nairaOf(amountKobo), ref, q.promo ?? null, label, JSON.stringify(keep));
    if (this.mode === "test") return { ref, amountKobo, label, mode: "test", authorizationUrl: null, accessCode: null, publicKey: null };
    try {
      const r = await this.paystack("POST", "/transaction/initialize", {
        email: account.email ?? `${account.id}@players.hustlelife.ng`,
        amount: String(amountKobo),
        currency: PAY_CURRENCY,
        reference: ref,
        ...this.cfg.payCallbackUrl ? { callback_url: this.cfg.payCallbackUrl } : {},
        metadata: { accountId: account.id, sku: `${sku.kind}:${sku.id}`, cancel_action: this.cfg.payCallbackUrl || void 0 }
      });
      if (!r?.status || !r.data?.authorization_url) throw new Error(r?.message ?? "no checkout url");
      run(this.db, "UPDATE purchases SET meta=json_set(meta,'$.accessCode',?), updated_at=? WHERE id=?", String(r.data.access_code ?? ""), Date.now(), ref);
      return { ref, amountKobo, label, mode: "live", authorizationUrl: r.data.authorization_url, accessCode: r.data.access_code ?? null, publicKey: this.cfg.paystackPublic || null };
    } catch (e) {
      run(this.db, "UPDATE purchases SET status='failed', updated_at=? WHERE id=?", Date.now(), ref);
      this.log.warn("paystack initialize failed", ref, e);
      throw new HttpError(502, "Paystack no answer. Try again in a minute.", { code: "pay_gateway" });
    }
  }
  get(ref) {
    const r = one(this.db, "SELECT * FROM purchases WHERE ref=?", ref);
    return r ? rec(r) : null;
  }
  /** the player's view of one checkout; asks Paystack when it is still pending (the player came back from the card page) */
  async status(accountId, ref) {
    if (!payRefOk(ref)) throw new HttpError(400, "Bad reference.");
    let p = this.get(ref);
    if (!p || p.accountId !== accountId) throw new HttpError(404, "No such payment.");
    if (p.status === "pending" && this.mode === "live") {
      try {
        const r = await this.paystack("GET", `/transaction/verify/${encodeURIComponent(ref)}`);
        const d = r?.data;
        if (d?.status === "success") p = this.settle(ref, Number(d.amount), String(d.currency), String(d.id ?? ""));
        else if (d && ["failed", "abandoned", "reversed"].includes(d.status) && Date.now() - p.createdAt > 30 * 6e4) p = this.fail(ref, d.status);
      } catch (e) {
        this.log.warn("paystack verify failed", ref, e);
      }
    }
    if (p.status === "pending" && Date.now() - p.createdAt > PENDING_TTL) p = this.fail(ref, "expired");
    return p;
  }
  /** test mode only: pretend the card went through */
  testComplete(accountId, ref) {
    if (this.mode !== "test") throw new HttpError(403, "Test payments are off on this server.");
    if (!payRefOk(ref)) throw new HttpError(400, "Bad reference.");
    const p = this.get(ref);
    if (!p || p.accountId !== accountId) throw new HttpError(404, "No such payment.");
    return this.settle(ref, p.amountKobo, p.currency, `test_${ref}`);
  }
  cancel(accountId, ref) {
    if (!payRefOk(ref)) throw new HttpError(400, "Bad reference.");
    const p = this.get(ref);
    if (!p || p.accountId !== accountId) throw new HttpError(404, "No such payment.");
    if (p.status === "pending" && (this.mode !== "live" || Date.now() - p.createdAt > PENDING_TTL)) return this.fail(ref, "cancelled");
    return p;
  }
  /** Paystack's webhook: the signature is an HMAC-SHA512 of the raw body with the secret key */
  webhook(raw, signature) {
    if (!this.cfg.paystackSecret) return { ok: false, why: "no key" };
    const want = createHmac2("sha512", this.cfg.paystackSecret).update(raw).digest();
    let got;
    try {
      got = Buffer.from(String(signature ?? ""), "hex");
    } catch {
      return { ok: false, why: "bad signature" };
    }
    if (got.length !== want.length || !timingSafeEqual2(got, want)) return { ok: false, why: "bad signature" };
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      return { ok: false, why: "bad body" };
    }
    if (ev?.event !== "charge.success") return { ok: true, why: "ignored" };
    const d = ev.data ?? {};
    const ref = String(d.reference ?? "");
    if (!payRefOk(ref) || !this.get(ref)) return { ok: true, why: "unknown reference" };
    if (d.status && d.status !== "success") return { ok: true, why: "not success" };
    this.settle(ref, Number(d.amount), String(d.currency), String(d.id ?? ""));
    return { ok: true };
  }
  /** money arrived: check it matches, mark it paid and hand over the goods, once */
  settle(ref, paidKobo, currency, providerRef) {
    let granted = null;
    const out = this.db.transaction(() => {
      const r = one(this.db, "SELECT * FROM purchases WHERE ref=?", ref);
      if (!r) throw new HttpError(404, "No such payment.");
      if (r.status !== "pending" && r.status !== "failed") return rec(r);
      const now = Date.now();
      if (currency !== r.currency || !Number.isFinite(paidKobo) || paidKobo < r.amount_minor) {
        run(this.db, "UPDATE purchases SET status='mismatch', provider_ref=?, updated_at=? WHERE id=?", providerRef, now, r.id);
        this.emit("flag", { accountId: r.account_id, kind: "pay.mismatch", detail: { ref, paidKobo, currency, want: r.amount_minor } });
        return rec(one(this.db, "SELECT * FROM purchases WHERE id=?", r.id));
      }
      run(this.db, "UPDATE purchases SET status='paid', provider_ref=?, paid_at=?, updated_at=? WHERE id=? AND status IN ('pending','failed')", providerRef, now, now, r.id);
      const p = rec(one(this.db, "SELECT * FROM purchases WHERE id=?", r.id));
      const prod = this.products.get(p.kind);
      const g = prod ? prod.fulfil(p) : { note: "no product handler; grant by hand" };
      run(this.db, "UPDATE purchases SET granted=?, updated_at=? WHERE id=?", JSON.stringify(g), Date.now(), r.id);
      granted = rec(one(this.db, "SELECT * FROM purchases WHERE id=?", r.id));
      return granted;
    })();
    if (granted) {
      this.log.info(`payment ${ref} settled: ${granted.sku} \u20A6${nairaOf(granted.amountKobo)}`);
      this.emit("purchase", granted);
    }
    return out;
  }
  fail(ref, why) {
    run(this.db, "UPDATE purchases SET status='failed', meta=json_set(meta,'$.failed',?), updated_at=? WHERE ref=? AND status='pending'", why, Date.now(), ref);
    return this.get(ref);
  }
  /** give the money back (an ad the review team turned down). Live: Paystack's refund API; test: just marked. */
  async refund(ref, why) {
    const p = this.get(ref);
    if (!p || p.status !== "paid") return { ok: false, status: p?.status ?? "missing" };
    if (this.mode === "live") {
      try {
        const r = await this.paystack("POST", "/refund", { transaction: ref, merchant_note: why.slice(0, 200) });
        if (!r?.status) throw new Error(r?.message ?? "refused");
      } catch (e) {
        this.log.warn("paystack refund failed", ref, e);
        return { ok: false, status: "refund_failed" };
      }
    }
    run(this.db, "UPDATE purchases SET status='refunded', refunded_at=?, refund_reason=?, updated_at=? WHERE ref=? AND status='paid'", Date.now(), why.slice(0, 200), Date.now(), ref);
    return { ok: true, status: "refunded" };
  }
  // ------------------------------------------------------------------------------------------ ledger
  mine(accountId, limit = 30) {
    return all(this.db, "SELECT * FROM purchases WHERE account_id=? AND ref IS NOT NULL ORDER BY created_at DESC LIMIT ?", accountId, Math.min(100, limit)).map(rec).map(pub);
  }
  ledger(o = {}) {
    const rows = all(this.db, `SELECT u.*, p.name FROM purchases u LEFT JOIN profiles p ON p.account_id=u.account_id
      WHERE u.ref IS NOT NULL AND (@s IS NULL OR u.status=@s) AND (@b IS NULL OR u.created_at<@b) ORDER BY u.created_at DESC LIMIT @l`, { s: o.status ?? null, b: o.before ?? null, l: Math.min(500, o.limit ?? 100) });
    const tot = all(this.db, "SELECT status, COUNT(*) n, COALESCE(SUM(amount_minor),0) kobo FROM purchases WHERE ref IS NOT NULL GROUP BY status");
    return { mode: this.mode, items: rows.map((r) => ({ ...rec(r), player: r.name })), totals: Object.fromEntries(tot.map((t) => [t.status, { count: t.n, naira: nairaOf(t.kobo) }])) };
  }
  async paystack(method, path, body) {
    const r = await this.fetch(PAYSTACK + path, { method, headers: { Authorization: `Bearer ${this.cfg.paystackSecret}`, "Content-Type": "application/json" }, body: body === void 0 ? void 0 : JSON.stringify(body) });
    const j2 = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`paystack ${r.status}: ${j2?.message ?? ""}`);
    return j2;
  }
};
var pub = (p) => ({ ref: p.ref, sku: p.sku, label: p.label, naira: nairaOf(p.amountKobo), status: p.status, granted: p.status === "paid" ? p.granted : {}, at: p.createdAt, paidAt: p.paidAt, promo: p.promo });

// server/src/ads.ts
import { EventEmitter as EventEmitter8 } from "node:events";
import { existsSync as existsSync5, mkdirSync as mkdirSync4, readFileSync as readFileSync7, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join3, resolve as resolve5 } from "node:path";
import { randomBytes as randomBytes5 } from "node:crypto";
var HOLD_MS = 45 * 6e4;
var DAY = 864e5;
var COLORS = ["#ffffff", "#ffd23f", "#3ddc84", "#4fc3f7", "#ff5d8f", "#b388ff", "#ff8a3d"];
function imageSize(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 2303741511) return { mime: "image/png", w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 255) {
        i++;
        continue;
      }
      const m = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (m >= 192 && m <= 207 && m !== 196 && m !== 200 && m !== 204) return { mime: "image/jpeg", h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const f = b.toString("ascii", 12, 16);
    if (f === "VP8 ") return { mime: "image/webp", w: b.readUInt16LE(26) & 16383, h: b.readUInt16LE(28) & 16383 };
    if (f === "VP8L") {
      const v = b.readUInt32LE(21);
      return { mime: "image/webp", w: (v & 16383) + 1, h: (v >> 14 & 16383) + 1 };
    }
    if (f === "VP8X") return { mime: "image/webp", w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  return null;
}
var Ads = class extends EventEmitter8 {
  constructor(db, pay, dataDir, boardsFile = resolve5(PATHS.sharedData, "billboards.json")) {
    super();
    this.db = db;
    this.pay = pay;
    this.dir = join3(dataDir, "uploads");
    mkdirSync4(this.dir, { recursive: true });
    try {
      this.setBoards(JSON.parse(readFileSync7(boardsFile, "utf8")));
    } catch {
      this.setBoards([]);
    }
    pay.register("ad", { quote: (a, id, meta) => this.quoteOrder(a, id, meta), fulfil: (p) => this.paid(p) });
  }
  boards = [];
  byId = /* @__PURE__ */ new Map();
  sightings = /* @__PURE__ */ new Map();
  // `${ad}:${account}` -> last counted
  lastFeed = "";
  dir;
  setBoards(list) {
    this.boards = list.filter((b) => b && b.id && b.w > 0 && b.h > 0);
    this.byId = new Map(this.boards.map((b) => [b.id, b]));
  }
  board(id) {
    return this.byId.get(id);
  }
  slots(kind, board) {
    return kind === "board" ? this.byId.get(board ?? "")?.slots ?? 1 : kind === "blimp" ? BLIMPS : 1;
  }
  /** ads that hold a slot in [from, to) */
  holding(kind, key, from, to) {
    const col = kind === "board" ? "board_id" : "place";
    return all(
      this.db,
      `SELECT * FROM ads WHERE kind=? AND ${kind === "blimp" ? "1=1" : `${col}=?`} AND start_at < ? AND end_at > ? AND (status IN ('review','approved') OR (status='unpaid' AND created_at > ?))`,
      ...kind === "blimp" ? [kind, to, from, Date.now() - HOLD_MS] : [kind, key, to, from, Date.now() - HOLD_MS]
    );
  }
  free(kind, key, from, to) {
    return this.holding(kind, key, from, to).length < this.slots(kind, key);
  }
  /** first day from `day` on which a run of `days` fits */
  nextFree(kind, key, days = 1, day = lagosDay(Date.now())) {
    let s = lagosDayStart(day);
    for (let k = 0; k < 120; k++, s += DAY) if (this.free(kind, key, s, s + days * DAY)) return lagosDay(s);
    return null;
  }
  inventory() {
    const today = lagosDay(Date.now());
    return this.boards.map((b) => ({ ...b, slots: b.slots ?? 1, px: adPixels(b), day: adQuote("board", 1, { board: b }).day, nextFree: this.nextFree("board", b.id, 1, today) }));
  }
  quote(kind, days, key) {
    if (kind === "board") {
      const b = this.byId.get(key ?? "");
      if (!b) throw new HttpError(404, "That billboard is not on the list.");
      return adQuote("board", days, { board: b });
    }
    if (kind === "drone") {
      if (!DRONE_SPOTS.some((s) => s.id === key)) throw new HttpError(400, "Pick a place for the show.");
      return adQuote("drone", days, { spot: key });
    }
    if (kind === "blimp") return adQuote("blimp", days);
    throw new HttpError(400, "Unknown ad type.");
  }
  /** save an uploaded picture; boards check the shape against the board */
  saveUpload(accountId, dataUrl, kind = "ad") {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
    if (!m) throw new HttpError(400, "Send a PNG, JPEG or WebP picture.");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 3e6) throw new HttpError(413, "That picture is over 3 MB. Export it smaller.");
    const sz = imageSize(buf);
    if (!sz || sz.mime !== m[1]) throw new HttpError(400, "That file is not a picture we can read.");
    if (sz.w < 64 || sz.h < 32 || sz.w > 4096 || sz.h > 4096) throw new HttpError(400, "The picture size is out of range.");
    const n = one(this.db, "SELECT COUNT(*) n FROM uploads WHERE account_id=? AND created_at > ?", accountId, Date.now() - DAY).n;
    if (n >= 40) throw new HttpError(429, "That is enough uploads for today.");
    const id = randomBytes5(12).toString("hex");
    const ext = sz.mime.split("/")[1];
    writeFileSync3(join3(this.dir, `${id}.${ext}`), buf);
    run(this.db, "INSERT INTO uploads(id, account_id, kind, mime, bytes, name, created_at) VALUES(?,?,?,?,?,?,?)", id, accountId, kind, sz.mime, buf.length, `${sz.w}x${sz.h}`, Date.now());
    return { id, mime: sz.mime, w: sz.w, h: sz.h, bytes: buf.length };
  }
  upload(id) {
    return one(this.db, "SELECT * FROM uploads WHERE id=?", id);
  }
  uploadFile(u) {
    const f = join3(this.dir, `${u.id}.${u.mime.split("/")[1]}`);
    return existsSync5(f) ? f : null;
  }
  /** may this picture be shown to anyone? only once an ad using it was approved */
  isPublic(uploadId) {
    return !!one(this.db, "SELECT 1 FROM ads WHERE upload_id=? AND status='approved'", uploadId);
  }
  /** price an order and hold its slot (called by payments.start for sku 'ad:new'); the ad row waits as 'unpaid' */
  quoteOrder(acct, id, b) {
    if (id !== "new") throw new HttpError(404, "Unknown ad order.");
    const kind = String(b?.kind ?? "");
    const days = Math.round(Number(b?.days));
    const start = String(b?.start ?? lagosDay(Date.now()));
    if (!AD_DAYS.includes(days)) throw new HttpError(400, `Pick ${AD_DAYS.join(", ")} days.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || lagosDayStart(start) < lagosDayStart(lagosDay(Date.now())) || lagosDayStart(start) > Date.now() + 90 * DAY) throw new HttpError(400, "Pick a start date from today up to three months ahead.");
    const from = lagosDayStart(start), to = from + days * DAY;
    let key = null, upload = null, text = null, color = null, label = "";
    if (kind === "board" || kind === "blimp") {
      const u = this.upload(String(b?.upload ?? ""));
      if (!u || u.account_id !== acct.id) throw new HttpError(400, "Upload your picture first.");
      upload = u.id;
      const [w, h] = u.name.split("x").map(Number);
      if (kind === "board") {
        const bd = this.byId.get(String(b?.board ?? ""));
        if (!bd) throw new HttpError(404, "That billboard is not on the list.");
        const want = bd.w / bd.h;
        if (Math.abs(w / h - want) / want > 0.04) throw new HttpError(400, `This board needs a ${adPixels(bd).w} x ${adPixels(bd).h} picture. Yours is ${w} x ${h}.`);
        key = bd.id;
        label = `Billboard: ${bd.place}`;
      } else {
        if (Math.abs(w / h - 4) / 4 > 0.05) throw new HttpError(400, "Blimp banners are 4 to 1, for example 1600 x 400.");
        label = "Blimp banner";
      }
    } else if (kind === "drone") {
      key = String(b?.place ?? "");
      const spot = DRONE_SPOTS.find((s) => s.id === key);
      if (!spot) throw new HttpError(400, "Pick a place for the show.");
      text = String(b?.text ?? "").replace(/\s+/g, " ").trim().toUpperCase();
      if (!text || text.length > DRONE_TEXT_MAX) throw new HttpError(400, `Write 1 to ${DRONE_TEXT_MAX} letters for the sky.`);
      if (!/^[A-Z0-9 !?.,'&@#:+\-₦]+$/.test(text)) throw new HttpError(400, "Drones can draw letters, numbers and simple marks only.");
      color = COLORS.includes(String(b?.color)) ? String(b.color) : COLORS[0];
      label = `Drone show over ${spot.name}`;
    } else throw new HttpError(400, "Unknown ad type.");
    if (!this.free(kind, kind === "blimp" ? null : key, from, to)) throw new HttpError(409, kind === "board" ? "Someone has that board for some of those days. Try another start date." : kind === "drone" ? "That sky is booked for some of those days." : "All the blimps are booked for some of those days.");
    const q = this.quote(kind, days, key ?? void 0);
    const ad = run(
      this.db,
      "INSERT INTO ads(account_id, kind, board_id, upload_id, text, color, place, start_at, end_at, price_kobo, status, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      acct.id,
      kind,
      kind === "board" ? key : null,
      upload,
      text,
      color,
      kind === "drone" ? key : null,
      from,
      to,
      q.total * 100,
      "unpaid",
      Date.now()
    );
    return { amountKobo: q.total * 100, label: `${label}, ${days} ${kind === "drone" ? "night" : "day"}${days > 1 ? "s" : ""} from ${start}`, meta: { adId: Number(ad.lastInsertRowid) } };
  }
  /** the money landed (inside the payments transaction): the ad goes to review */
  paid(p) {
    const ad = this.get(Number(p.meta.adId));
    if (!ad) return { note: "ad row missing; refund by hand" };
    if (ad.status !== "unpaid") return { adId: ad.id, status: ad.status };
    const others = this.holding(ad.kind, ad.kind === "board" ? ad.board_id : ad.kind === "drone" ? ad.place : null, ad.start_at, ad.end_at).filter((x) => x.id !== ad.id && x.status !== "unpaid");
    const clash = others.length >= this.slots(ad.kind, ad.board_id);
    run(this.db, "UPDATE ads SET status='review', payment_ref=?, note=? WHERE id=?", p.ref, clash ? "Paid after the hold ran out and the slot is now taken: move the dates or refund" : null, ad.id);
    this.emit("note", ad.account_id, "MyAds", "Payment received. Your ad is with the review team and goes up once it is approved.");
    return { adId: ad.id };
  }
  get(id) {
    return one(this.db, "SELECT * FROM ads WHERE id=?", id) ?? null;
  }
  /** moderation: approve puts it up on its dates; reject refunds the money */
  async review(id, decision, note = "") {
    const ad = this.get(id);
    if (!ad) throw new HttpError(404, "No such ad.");
    if (ad.status !== "review") throw new HttpError(409, `This ad is ${ad.status}, not waiting for review.`);
    if (decision === "approve") {
      run(this.db, "UPDATE ads SET status='approved', note=? WHERE id=?", note || null, id);
      this.emit("note", ad.account_id, "MyAds", ad.start_at <= Date.now() ? "Your ad is approved and live now." : `Your ad is approved. It goes up on ${lagosDay(ad.start_at)}.`);
    } else {
      const r = ad.payment_ref ? await this.pay.refund(ad.payment_ref, note || "Ad not approved") : { ok: true, status: "none" };
      run(this.db, "UPDATE ads SET status='rejected', note=? WHERE id=?", (note || "Not approved") + (r.ok ? "" : " (refund needs a manual check)"), id);
      this.emit("note", ad.account_id, "MyAds", `Your ad was not approved${note ? `: ${note}` : "."} ${r.ok ? "Your money is on its way back." : "We will refund you by hand."}`);
    }
    this.pushFeed(true);
    return this.get(id);
  }
  queue(status = "review") {
    return all(this.db, "SELECT a.*, f.name owner FROM ads a LEFT JOIN profiles f ON f.account_id=a.account_id WHERE a.status=? ORDER BY a.created_at LIMIT 200", status);
  }
  /** what every client draws right now */
  live(now = Date.now()) {
    return all(this.db, "SELECT * FROM ads WHERE status='approved' AND start_at <= ? AND end_at > ? ORDER BY id", now, now).map((a) => ({ id: a.id, kind: a.kind, board: a.board_id, img: a.upload_id ? `/api/uploads/${a.upload_id}` : null, text: a.text, color: a.color, place: a.place, until: a.end_at }));
  }
  /** emit 'feed' when the live set changed (called every minute and after a review) */
  pushFeed(force = false) {
    const l = this.live();
    const k = JSON.stringify(l.map((a) => a.id));
    if (force || k !== this.lastFeed) {
      this.lastFeed = k;
      this.emit("feed", l);
    }
    return l;
  }
  /** a player saw these ads on screen */
  seen(accountId, ids) {
    if (!Array.isArray(ids)) return 0;
    const now = Date.now();
    const day = lagosDay(now);
    let n = 0;
    const live = new Map(all(this.db, "SELECT id, account_id FROM ads WHERE status='approved' AND start_at <= ? AND end_at > ?", now, now).map((a) => [a.id, a.account_id]));
    for (const raw of ids.slice(0, 60)) {
      const id = Number(raw);
      const owner = live.get(id);
      if (!owner || owner === accountId) continue;
      run(this.db, "INSERT OR IGNORE INTO ad_views(ad_id, account_id, day) VALUES(?,?,?)", id, accountId, day);
      const k = `${id}:${accountId}`;
      if ((this.sightings.get(k) ?? 0) > now - 5 * 6e4) continue;
      this.sightings.set(k, now);
      n++;
      run(this.db, "INSERT INTO ad_daily(ad_id, day, sightings) VALUES(?,?,1) ON CONFLICT(ad_id, day) DO UPDATE SET sightings = sightings + 1", id, day);
    }
    if (this.sightings.size > 5e4) {
      for (const [k, t] of this.sightings) if (t < now - 5 * 6e4) this.sightings.delete(k);
    }
    return n;
  }
  /** an owner's campaigns with reach per day */
  mine(accountId) {
    const list = all(this.db, "SELECT * FROM ads WHERE account_id=? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 50", accountId);
    return list.map((a) => {
      const days = all(this.db, "SELECT day, COUNT(*) people FROM ad_views WHERE ad_id=? GROUP BY day ORDER BY day", a.id);
      const sight = new Map(all(this.db, "SELECT day, sightings FROM ad_daily WHERE ad_id=?", a.id).map((d) => [d.day, d.sightings]));
      const total = one(this.db, "SELECT COUNT(DISTINCT account_id) n FROM ad_views WHERE ad_id=?", a.id).n;
      const now = Date.now();
      const state = a.status === "approved" ? now < a.start_at ? "scheduled" : now >= a.end_at ? "ended" : "live" : a.status;
      return {
        id: a.id,
        kind: a.kind,
        board: a.board_id,
        place: a.place,
        text: a.text,
        color: a.color,
        img: a.upload_id ? `/api/uploads/${a.upload_id}` : null,
        start: lagosDay(a.start_at),
        end: lagosDay(a.end_at - 1),
        naira: a.price_kobo / 100,
        status: state,
        note: a.note,
        payment: a.payment_ref,
        reach: total,
        days: days.map((d) => ({ day: d.day, people: d.people, sightings: sight.get(d.day) ?? 0 }))
      };
    });
  }
};

// server/src/clubs.ts
import { EventEmitter as EventEmitter9 } from "node:events";
import { existsSync as existsSync6, mkdirSync as mkdirSync5, readFileSync as readFileSync8, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join4, resolve as resolve6 } from "node:path";
import { randomBytes as randomBytes6 } from "node:crypto";

// v2/src/net/clubs.ts
var CLUB_RULES = {
  zilox: { id: "zilox", name: "ZILOX Superclub", short: "ZILOX", shutdown: 25e6, promoDay: 2500, bar: 5e3 },
  gele: { id: "gele", name: "GELE Lounge", short: "GELE", shutdown: 8e6, promoDay: 1500, bar: 3500 },
  orun: { id: "orun", name: "ORUN Rooftop", short: "ORUN", shutdown: 15e6, promoDay: 2e3, bar: 4500 }
};
var CLUB_IDS = Object.keys(CLUB_RULES);
var isClub = (s) => typeof s === "string" && s in CLUB_RULES;
var DECK_REACH = 5;
var POLE_REACH = 3.5;
var CLUB_REACH = 26;
var DJ_PAY = { base: 600, perHead: 150, heads: 20, dayCap: 6e4 };
var POLE_PAY = { base: 500, perHead: 100, heads: 20, dayCap: 45e3 };
var isClubNight = (hours) => {
  const h = (hours % 24 + 24) % 24;
  return h >= 21 || h < 5;
};
function shiftPay(job, crowd, hours) {
  const r = job === "dj" ? DJ_PAY : POLE_PAY;
  const k = isClubNight(hours) ? 1 : 0.35;
  return Math.round((r.base + r.perHead * Math.min(r.heads, Math.max(0, crowd))) * k);
}
var dayCap = (job) => (job === "dj" ? DJ_PAY : POLE_PAY).dayCap;
var clubHours = (ms) => worldHours(ms);
var SPRAY_NOTES = [1e3, 5e3, 2e4, 1e5];
var SPRAY_HOUSE = 0.1;
var SPRAY_GAP_MS = 700;
var sprayNet = (n) => Math.round(n * (1 - SPRAY_HOUSE));
var SHUTDOWN_MIN = 45;
var SONG_MAX_BYTES = 8e6;
var SONG_MIN_SECS = 30;
var SONG_MAX_SECS = 600;
var SONG_DAY_UPLOADS = 10;
var SONG_KEEP = 50;
var SONG_TITLE_MAX = 60;
var SONG_ARTIST_MAX = 40;
var PROMO_DAYS = [1, 3, 7, 14, 30];
function promoQuote(club, days) {
  if (!PROMO_DAYS.includes(days)) return null;
  const day = club === "all" ? Math.round(CLUB_IDS.reduce((s, c) => s + CLUB_RULES[c].promoDay, 0) * 0.8) : CLUB_RULES[club]?.promoDay;
  if (!day) return null;
  const off = days >= 14 ? 0.8 : days >= 7 ? 0.9 : 1;
  return { day, days, total: Math.round(day * days * off / 100) * 100 };
}
function audioKind(b) {
  if (b.length < 12) return null;
  if (b[0] === 73 && b[1] === 68 && b[2] === 51) return "audio/mpeg";
  if (b[0] === 255 && (b[1] & 224) === 224) return "audio/mpeg";
  if (b[0] === 79 && b[1] === 103 && b[2] === 103 && b[3] === 83) return "audio/ogg";
  if (b[4] === 102 && b[5] === 116 && b[6] === 121 && b[7] === 112) return "audio/mp4";
  return null;
}
function cleanSongText(s, max) {
  const t = String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim();
  return t.length ? t.slice(0, max) : null;
}
function cleanTrack(t, now) {
  if (!t || typeof t !== "object") return null;
  const src = t.src;
  if (src !== "audius" && src !== "song" && src !== "house") return null;
  const id = String(t.id ?? "");
  if (src === "audius" && !/^[A-Za-z0-9]{1,16}$/.test(id)) return null;
  if (src === "song" && !/^sg_[a-f0-9]{12}$/.test(id)) return null;
  if (src === "house" && !/^[a-z0-9-]{1,24}$/.test(id)) return null;
  const secs = Math.max(SONG_MIN_SECS, Math.min(SONG_MAX_SECS, Math.round(Number(t.secs) || 180)));
  return { src, id, title: cleanSongText(t.title, SONG_TITLE_MAX) ?? "Untitled", artist: cleanSongText(t.artist, SONG_ARTIST_MAX) ?? "Unknown", secs, at: now };
}
var HOUSE_SET = [
  { id: "eko-groove", title: "Eko Groove", artist: "HustleLife House", secs: 240 },
  { id: "log-drum-sunday", title: "Log Drum Sunday", artist: "HustleLife House", secs: 210 },
  { id: "third-mainland", title: "Third Mainland at 2am", artist: "HustleLife House", secs: 260 }
];
var COVER = { zilox: 1e4, gele: 5e3, orun: 8e3 };
var VIP_MIN = 30;
var VIP_PRICE = { zilox: 5e5, gele: 15e4, orun: 3e5 };
var BOTTLE_PRICE = { zilox: 12e4, gele: 45e3, orun: 8e4 };
var BOTTLE_GAP_MS = 2e4;
var DOOR_REACH = 10;
var nightOf = (hours) => Math.floor((hours - 12) / 24);
var coverFor = (club, hours, shutdown) => !isClubNight(hours) || shutdown ? 0 : COVER[club];
var DRESS_CODE = 'Bouncer: "Ah ah, where your clothes? Go and dress, then come back."';
var NO_BAND = 'Bouncer: "Wristband first, my guy. Cover is at the door."';

// server/src/clubs.ts
var DAY2 = 864e5;
var EXT = { "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/mp4": "m4a" };
var Clubs = class extends EventEmitter9 {
  constructor(db, econ, pay, dataDir, file = resolve6(PATHS.sharedData, "clubs.json")) {
    super();
    this.db = db;
    this.econ = econ;
    this.pay = pay;
    this.dir = join4(dataDir, "songs");
    mkdirSync5(this.dir, { recursive: true });
    let raw = [];
    try {
      raw = JSON.parse(readFileSync8(file, "utf8"));
    } catch {
      raw = [];
    }
    for (const c of raw) if (isClub(c.id)) this.places.push({ id: c.id, floor: c.floor, dj: c.dj, poles: c.poles ?? [], roof: c.kind === "rooftop" ? Number(c.roofY) : null, door: c.door, vip: c.vip ?? [] });
    for (const id of CLUB_IDS) this.live.set(id, { id, dj: null, poles: {}, track: null, shutdown: null, crowd: 0, lastTrack: 0, house: 0, vip: {} });
    pay?.register("song", { quote: (a, id, meta) => this.quotePromo(a, id, meta), fulfil: (p) => this.promoPaid(p) });
  }
  places = [];
  live = /* @__PURE__ */ new Map();
  paid = /* @__PURE__ */ new Map();
  // `${acct}:${job}:${day}` -> naira paid by the house today
  lastSpray = /* @__PURE__ */ new Map();
  /** wristbands: `${acct}:${club}:${night}` -> guest (paid cover or came in free) or staff (here to work) */
  passes = /* @__PURE__ */ new Map();
  dir;
  place(id) {
    return this.places.find((p) => p.id === id);
  }
  club(id) {
    if (!isClub(id)) throw new HttpError(404, "No club by that name.");
    return this.live.get(id);
  }
  /** the rooftop is 65 m up: being under it on the street is not being in it */
  near(p, at, r, roof) {
    if (roof !== null && p.y !== void 0 && Math.abs(p.y - roof) > 8) return false;
    return Math.hypot(p.x - at.x, p.z - at.z) <= r;
  }
  inClub(id, p) {
    const pl = this.place(id);
    return !!pl && this.near(p, pl.floor, CLUB_REACH, pl.roof);
  }
  /** which club, if any, a position is in */
  whereIs(p) {
    for (const pl of this.places) if (this.near(p, pl.floor, CLUB_REACH, pl.roof)) return pl.id;
    return null;
  }
  posts(L) {
    const o = [];
    if (L.dj) o.push({ job: "dj", key: "dj", post: L.dj });
    for (const [k, p] of Object.entries(L.poles)) o.push({ job: "pole", key: k, post: p });
    return o;
  }
  /** the account's current shift anywhere */
  shiftOf(acct) {
    for (const L of this.live.values()) for (const s of this.posts(L)) if (s.post.accountId === acct) return { club: L.id, ...s };
    return null;
  }
  view(id, now = Date.now()) {
    const L = this.live.get(id);
    const sh = L.shutdown && L.shutdown.until > now ? L.shutdown : null;
    return {
      id,
      dj: L.dj ? { id: L.dj.accountId, name: L.dj.name, since: L.dj.since } : null,
      poles: Object.fromEntries(Object.entries(L.poles).map(([k, p]) => [k, { id: p.accountId, name: p.name }])),
      track: L.track,
      shutdown: sh,
      crowd: L.crowd,
      cover: coverFor(id, clubHours(now), !!sh),
      vip: Object.fromEntries(Object.entries(L.vip).filter(([, t]) => t.until > now).map(([k, t]) => [k, { id: t.by, name: t.name, until: t.until }]))
    };
  }
  views(now = Date.now()) {
    return CLUB_IDS.map((id) => this.view(id, now));
  }
  changed(id) {
    this.emit("club", this.view(id));
  }
  // ------------------------------------------------------------------------------------------ the door
  shut(L, now) {
    return !!L.shutdown && L.shutdown.until > now;
  }
  key(acct, id, now) {
    return `${acct}:${id}:${nightOf(clubHours(now))}`;
  }
  pass(acct, id, now = Date.now()) {
    return this.passes.get(this.key(acct, id, now)) ?? null;
  }
  /** hand a wristband out (tests, admin, a VIP booking) */
  admit(acct, id, kind, now = Date.now()) {
    const k = this.key(acct, id, now);
    if (this.passes.get(k) !== "guest") this.passes.set(k, kind);
  }
  /** can this person buy, spray and book in here right now? By day and during a shutdown nobody pays at the door */
  guestOk(acct, id, now = Date.now()) {
    const L = this.live.get(id);
    return coverFor(id, clubHours(now), this.shut(L, now)) === 0 || this.pass(acct, id, now) === "guest";
  }
  needGuest(acct, id, now) {
    if (!this.guestOk(acct, id, now)) throw new HttpError(403, NO_BAND, { code: "band" });
  }
  /** the bouncer: pay cover (cash only, the man at the door does not do transfer), or walk in as staff to work the decks or a stage */
  enter(acct, id, kind, p, stripped, now = Date.now()) {
    const L = this.club(id);
    const pl = this.place(L.id);
    const want = kind === "staff" ? "staff" : "guest";
    const atDoor = Math.hypot(p.x - pl.door.x, p.z - pl.door.z) <= DOOR_REACH || this.inClub(L.id, p);
    if (!atDoor) throw new HttpError(400, "Talk to the bouncer at the door.");
    if (stripped) throw new HttpError(403, DRESS_CODE, { code: "dress" });
    const have = this.pass(acct, L.id, now);
    if (have === "guest" || have === want) return { club: L.id, pass: have, paid: 0 };
    const fee = want === "staff" ? 0 : coverFor(L.id, clubHours(now), this.shut(L, now));
    if (fee) {
      if (this.econ.wallet(acct).cash < fee) throw new HttpError(402, `Cover is \u20A6${fee.toLocaleString("en-NG")}, cash.`, { code: "broke" });
      this.econ.adjust(acct, -fee, 0, "club.cover", { note: CLUB_RULES[L.id].short });
    }
    this.admit(acct, L.id, want, now);
    return { club: L.id, pass: want, paid: fee };
  }
  // ------------------------------------------------------------------------------------------ VIP tables
  /** book a table for VIP_MIN minutes: the first bottle is on the house, your name is on the table, and the wristband comes with it */
  bookVip(acct, name, id, table, p, now = Date.now()) {
    const L = this.club(id);
    const pl = this.place(L.id);
    const t = pl.vip.find((v) => v.id === table);
    const R = CLUB_RULES[L.id];
    if (!t) throw new HttpError(404, "No VIP table there.");
    if (!this.inClub(L.id, p)) throw new HttpError(400, "Come inside to book a table.");
    this.needGuest(acct, L.id, now);
    const held = L.vip[t.id];
    if (held && held.until > now) {
      if (held.by === acct) throw new HttpError(409, "This table is already yours.");
      throw new HttpError(409, `Reserved for ${held.name}.`);
    }
    if (Object.values(L.vip).some((v) => v.by === acct && v.until > now)) throw new HttpError(409, `You already have a table at ${R.short}.`);
    const price = VIP_PRICE[L.id];
    const w = this.econ.wallet(acct);
    if (w.cash + w.bank < price) throw new HttpError(402, `A VIP table at ${R.short} is \u20A6${price.toLocaleString("en-NG")}.`, { code: "broke" });
    const c = Math.min(w.cash, price);
    this.econ.adjust(acct, -c, -(price - c), "club.vip", { note: R.short });
    L.vip[t.id] = { by: acct, name, until: now + VIP_MIN * 6e4, lastBottle: now, bottles: 1 };
    this.admit(acct, L.id, "guest", now);
    this.changed(L.id);
    this.emit("vip", { club: L.id, table: t.id, name });
    return this.view(L.id, now);
  }
  /** bottle service at your own table: pricey, and the money leaves the economy (the house keeps it) */
  bottle(acct, id, p, now = Date.now()) {
    const L = this.club(id);
    const R = CLUB_RULES[L.id];
    const e = Object.entries(L.vip).find(([, v]) => v.by === acct && v.until > now);
    if (!e) throw new HttpError(403, "Bottle service is for your own VIP table.");
    if (!this.inClub(L.id, p)) throw new HttpError(400, "Go back to your table first.");
    const [table, t] = e;
    if (now - t.lastBottle < BOTTLE_GAP_MS) throw new HttpError(429, 'Waiter: "Your last bottle never finish, oga."');
    const price = BOTTLE_PRICE[L.id];
    const w = this.econ.wallet(acct);
    if (w.cash + w.bank < price) throw new HttpError(402, `A bottle here is \u20A6${price.toLocaleString("en-NG")}.`, { code: "broke" });
    const c = Math.min(w.cash, price);
    this.econ.adjust(acct, -c, -(price - c), "club.bottle", { note: R.short });
    t.lastBottle = now;
    t.bottles++;
    this.emit("bottle", { club: L.id, table, name: t.name });
    return { club: L.id, table, bottles: t.bottles, price };
  }
  // ------------------------------------------------------------------------------------------ shifts
  takeDecks(acct, name, id, p, now = Date.now()) {
    const L = this.club(id);
    const pl = this.place(L.id);
    if (!this.near(p, pl.dj, DECK_REACH, pl.roof)) throw new HttpError(400, "Go up to the DJ booth first.");
    if (L.dj && L.dj.accountId !== acct) throw new HttpError(409, `${L.dj.name} is on the decks. Wait your turn.`);
    const cur = this.shiftOf(acct);
    if (cur && !(cur.club === L.id && cur.job === "dj")) this.endShift(acct);
    if (!L.dj) {
      L.dj = { accountId: acct, name, since: now, paidTo: now, earned: 0 };
      L.lastTrack = 0;
      this.changed(L.id);
    }
    return this.view(L.id);
  }
  takePole(acct, name, id, pole, p, stripped, now = Date.now()) {
    const L = this.club(id);
    const pl = this.place(L.id);
    const st = pl.poles.find((q) => q.id === pole);
    if (!st) throw new HttpError(404, "No pole stage there.");
    if (stripped) throw new HttpError(403, 'Manager: "Go and dress first. This is a stage, not a bathroom."');
    if (!this.near(p, st, POLE_REACH + 1, pl.roof)) throw new HttpError(400, "Stand by the stage first.");
    const held = L.poles[st.id];
    if (held && held.accountId !== acct) throw new HttpError(409, `${held.name} is on that stage.`);
    const cur = this.shiftOf(acct);
    if (cur && !(cur.club === L.id && cur.key === st.id)) this.endShift(acct);
    if (!held) {
      L.poles[st.id] = { accountId: acct, name, since: now, paidTo: now, earned: 0 };
      this.changed(L.id);
    }
    return this.view(L.id);
  }
  /** end whatever shift the account is on; returns what the house paid for it */
  endShift(acct, now = Date.now()) {
    const s = this.shiftOf(acct);
    if (!s) return null;
    const L = this.live.get(s.club);
    this.payPost(L, s.job, s.post, now);
    if (s.job === "dj") L.dj = null;
    else delete L.poles[s.key];
    this.changed(L.id);
    return { club: L.id, job: s.job, earned: s.post.earned };
  }
  payPost(L, job, post, now) {
    const mins = Math.min(1.5, (now - post.paidTo) / 6e4);
    post.paidTo = now;
    if (mins <= 0) return 0;
    const day = lagosDay(now);
    const k = `${post.accountId}:${job}:${day}`;
    const sofar = this.paid.get(k) ?? 0;
    const n = Math.min(Math.round(shiftPay(job, L.crowd, clubHours(now)) * mins), dayCap(job) - sofar);
    if (n <= 0) return 0;
    this.paid.set(k, sofar + n);
    post.earned += n;
    this.econ.adjust(post.accountId, n, 0, job === "dj" ? "club.dj" : "club.pole", { note: CLUB_RULES[L.id].short, silent: true });
    return n;
  }
  /** every few seconds from the hub: count the room, pay the shifts, drop workers who walked off or logged out, run the house set */
  tick(online, now = Date.now()) {
    for (const L of this.live.values()) {
      const pl = this.place(L.id);
      if (!pl) continue;
      let crowd = 0;
      for (const p of online.values()) if (this.near(p, pl.floor, CLUB_REACH, pl.roof)) crowd++;
      const was = L.crowd;
      L.crowd = crowd;
      let dirty = Math.abs(was - crowd) > 0;
      for (const s of this.posts(L)) {
        const p = online.get(s.post.accountId);
        const at = s.job === "dj" ? pl.dj : pl.poles.find((q) => q.id === s.key);
        if (!p || !this.near(p, at, (s.job === "dj" ? DECK_REACH : POLE_REACH) + 2, pl.roof)) {
          this.payPost(L, s.job, s.post, now);
          if (s.job === "dj") L.dj = null;
          else delete L.poles[s.key];
          this.emit("ended", s.post.accountId, L.id, s.job, s.post.earned);
          dirty = true;
          continue;
        }
        this.payPost(L, s.job, s.post, now);
      }
      if (L.shutdown && L.shutdown.until <= now) {
        L.shutdown = null;
        dirty = true;
      }
      for (const [k, t] of Object.entries(L.vip)) if (t.until <= now) {
        delete L.vip[k];
        dirty = true;
      }
      if (!L.dj && (!L.track || now > L.track.at + L.track.secs * 1e3)) {
        L.track = this.nextHouse(L, now);
        dirty = true;
      }
      if (dirty) this.changed(L.id);
    }
    if (this.passes.size > 2e4) {
      const n = nightOf(clubHours(now));
      for (const k of this.passes.keys()) if (!k.endsWith(`:${n}`)) this.passes.delete(k);
    }
    if (this.paid.size > 2e4) {
      const d = lagosDay(now);
      for (const k of this.paid.keys()) if (!k.endsWith(d)) this.paid.delete(k);
    }
  }
  nextHouse(L, now) {
    const promo = this.promoted(L.id, now);
    if (promo.length && L.house % 2 === 0) {
      const s = promo[Math.floor(Math.random() * promo.length)];
      L.house++;
      run(this.db, "UPDATE songs SET plays = plays + 1 WHERE id=?", s.id);
      return { src: "song", id: s.id, title: s.title, artist: s.artist, secs: s.secs, at: now, promo: true };
    }
    const h = HOUSE_SET[L.house++ % HOUSE_SET.length];
    return { src: "house", id: h.id, title: h.title, artist: h.artist, secs: h.secs, at: now };
  }
  play(acct, id, raw, now = Date.now()) {
    const L = this.club(id);
    if (L.dj?.accountId !== acct) throw new HttpError(403, "Only the DJ on the decks can change the song.");
    if (now - L.lastTrack < 6e3) throw new HttpError(429, "Let the song breathe small.");
    const t = cleanTrack(raw, now);
    if (!t) throw new HttpError(400, "That track cannot play here.");
    if (t.src === "song") {
      const s = this.song(t.id);
      if (!s || s.status !== "approved") throw new HttpError(403, "That song has not been cleared for clubs yet.");
      t.title = s.title;
      t.artist = s.artist;
      t.secs = s.secs;
      t.promo = this.promoted(L.id, now).some((x) => x.id === s.id);
      run(this.db, "UPDATE songs SET plays = plays + 1 WHERE id=?", s.id);
    }
    if (t.src === "house") {
      const h = HOUSE_SET.find((x) => x.id === t.id);
      if (!h) throw new HttpError(400, "No house track by that name.");
      Object.assign(t, { title: h.title, artist: h.artist, secs: h.secs });
    }
    t.by = L.dj.name;
    L.track = t;
    L.lastTrack = now;
    this.changed(L.id);
    return this.view(L.id);
  }
  // ------------------------------------------------------------------------------------------ money in the room
  spray(acct, name, id, to, amount, p, now = Date.now()) {
    const L = this.club(id);
    if (!this.inClub(L.id, p)) throw new HttpError(400, "You have to be in the club to spray.");
    this.needGuest(acct, L.id, now);
    const n = Number(amount);
    if (!SPRAY_NOTES.includes(n)) throw new HttpError(400, "Pick a bundle.");
    if ((this.lastSpray.get(acct) ?? 0) > now - SPRAY_GAP_MS) throw new HttpError(429, "Easy. One bundle at a time.");
    const target = String(to ?? "floor");
    let tgt = null;
    if (target !== "floor") {
      tgt = L.dj?.accountId === target ? L.dj : Object.values(L.poles).find((q) => q.accountId === target) ?? null;
      if (!tgt) throw new HttpError(404, "They are not working here right now.");
      if (tgt.accountId === acct) throw new HttpError(400, "You cannot spray yourself.");
    }
    if (this.econ.wallet(acct).cash < n) throw new HttpError(402, "Not enough cash on you. Nobody sprays transfer.", { code: "broke" });
    this.lastSpray.set(acct, now);
    this.db.transaction(() => {
      this.econ.adjust(acct, -n, 0, "club.spray", { note: `${CLUB_RULES[L.id].short} ${tgt ? tgt.name : "floor"}` });
      if (tgt) this.econ.adjust(tgt.accountId, sprayNet(n), 0, "club.sprayed", { note: name });
    })();
    if (tgt) tgt.earned += sprayNet(n);
    const ev = { club: L.id, from: name, fromId: acct, to: tgt ? tgt.name : null, toId: tgt?.accountId ?? null, amount: n };
    this.emit("spray", ev);
    return ev;
  }
  shutdown(acct, name, id, p, now = Date.now()) {
    const L = this.club(id);
    const r = CLUB_RULES[L.id];
    if (!this.inClub(L.id, p)) throw new HttpError(400, "You have to be inside to shut it down.");
    this.needGuest(acct, L.id, now);
    if (L.shutdown && L.shutdown.until > now) throw new HttpError(409, `${L.shutdown.name} already shut ${r.short} down tonight.`);
    const w = this.econ.wallet(acct);
    if (w.cash + w.bank < r.shutdown) throw new HttpError(402, `Shutting down ${r.short} costs \u20A6${r.shutdown.toLocaleString("en-NG")}.`, { code: "broke" });
    const c = Math.min(w.cash, r.shutdown);
    this.econ.adjust(acct, -c, -(r.shutdown - c), "club.shutdown", { note: r.short });
    L.shutdown = { by: acct, name, until: now + SHUTDOWN_MIN * 6e4 };
    this.changed(L.id);
    this.emit("shutdown", { club: L.id, name, until: L.shutdown.until });
    return this.view(L.id);
  }
  /** the bar: a guest's wristband at night, free while a shutdown holds */
  buyDrink(acct, p, now = Date.now()) {
    const where = this.whereIs(p);
    if (!where) throw new HttpError(400, "Find the bar inside a club.");
    this.needGuest(acct, where, now);
    const price = this.barPrice(where, now);
    if (price) {
      if (this.econ.wallet(acct).cash < price) throw new HttpError(402, "Not enough cash for a drink.", { code: "broke" });
      this.econ.adjust(acct, -price, 0, "club.bar", { note: where });
    }
    return { club: where, price };
  }
  /** free drinks while a shutdown holds */
  barPrice(id, now = Date.now()) {
    const L = this.live.get(id);
    return L.shutdown && L.shutdown.until > now ? 0 : CLUB_RULES[id].bar;
  }
  // ------------------------------------------------------------------------------------------ songs
  saveSong(acct, b, now = Date.now()) {
    if (b.attest !== true) throw new HttpError(400, "Tick the box to say you own this song or have the right to share it.");
    const title = cleanSongText(b.title, SONG_TITLE_MAX), artist = cleanSongText(b.artist, SONG_ARTIST_MAX);
    if (!title || !artist) throw new HttpError(400, "Give the song a title and an artist name.");
    const m = /^data:audio\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data ?? ""));
    if (!m) throw new HttpError(400, "Send an MP3, OGG or M4A file.");
    const buf = Buffer.from(m[1], "base64");
    if (buf.length > SONG_MAX_BYTES) throw new HttpError(413, "That song is over 8 MB. Export it at 192 kbps or lower.");
    const mime = audioKind(buf);
    if (!mime) throw new HttpError(400, "That file is not audio we can play. Use MP3, OGG or M4A.");
    const secs = Math.round(Number(b.secs));
    if (!(secs >= SONG_MIN_SECS && secs <= SONG_MAX_SECS)) throw new HttpError(400, "Songs run from 30 seconds to 10 minutes.");
    const today = one(this.db, "SELECT COUNT(*) n FROM songs WHERE account_id=? AND created_at > ?", acct, now - DAY2).n;
    if (today >= SONG_DAY_UPLOADS) throw new HttpError(429, "That is enough uploads for today.");
    const kept = one(this.db, "SELECT COUNT(*) n FROM songs WHERE account_id=? AND status != 'deleted'", acct).n;
    if (kept >= SONG_KEEP) throw new HttpError(409, "Your library is full. Delete a song first.");
    const id = "sg_" + randomBytes6(6).toString("hex");
    writeFileSync4(join4(this.dir, `${id}.${EXT[mime]}`), buf);
    run(this.db, "INSERT INTO songs(id, account_id, title, artist, mime, bytes, secs, status, attest_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", id, acct, title, artist, mime, buf.length, secs, "review", now, now);
    return this.songView(this.song(id));
  }
  song(id) {
    return one(this.db, "SELECT * FROM songs WHERE id=?", String(id)) ?? null;
  }
  songFile(s) {
    const f = join4(this.dir, `${s.id}.${EXT[s.mime] ?? "mp3"}`);
    return existsSync6(f) ? f : null;
  }
  /** who may hear the file: the owner and staff always, everyone once it is cleared */
  canHear(s, acct) {
    return s.status === "approved" || !!acct && (acct.id === s.account_id || acct.role !== "player");
  }
  songView(s, now = Date.now()) {
    const promos = all(this.db, "SELECT * FROM song_promos WHERE song_id=? AND status='paid' AND end_at > ? ORDER BY end_at", s.id, now);
    return { id: s.id, title: s.title, artist: s.artist, secs: s.secs, status: s.status, note: s.note, plays: s.plays, url: `/api/songs/${s.id}/audio`, promos: promos.map((p) => ({ club: p.club, until: p.end_at })) };
  }
  mine(acct) {
    return all(this.db, "SELECT * FROM songs WHERE account_id=? AND status != 'deleted' ORDER BY created_at DESC", acct).map((s) => this.songView(s));
  }
  remove(acct, id) {
    const s = this.song(String(id));
    if (!s || s.account_id !== acct) throw new HttpError(404, "Not your song.");
    run(this.db, "UPDATE songs SET status='deleted' WHERE id=?", s.id);
    return this.mine(acct);
  }
  /** songs with a paid promotion running in this club now */
  promoted(club, now = Date.now()) {
    return all(this.db, "SELECT DISTINCT s.* FROM song_promos p JOIN songs s ON s.id=p.song_id WHERE p.status='paid' AND p.start_at <= ? AND p.end_at > ? AND (p.club=? OR p.club='all') AND s.status='approved'", now, now, club);
  }
  /** the DJ crate: every cleared song, promoted ones for this club first */
  crate(club, now = Date.now()) {
    const pro = new Set(this.promoted(club, now).map((s) => s.id));
    return all(this.db, "SELECT s.*, f.name owner FROM songs s LEFT JOIN profiles f ON f.account_id=s.account_id WHERE s.status='approved' ORDER BY s.plays DESC LIMIT 200").map((s) => ({ id: s.id, title: s.title, artist: s.artist, secs: s.secs, owner: s.owner, promo: pro.has(s.id), url: `/api/songs/${s.id}/audio` })).sort((a, b) => Number(b.promo) - Number(a.promo));
  }
  queue(status = "review") {
    return all(this.db, "SELECT s.*, f.name owner FROM songs s LEFT JOIN profiles f ON f.account_id=s.account_id WHERE s.status=? ORDER BY s.created_at LIMIT 200", status);
  }
  /** moderation: a rejected song's paid promotions are refunded */
  async review(id, decision, note = "") {
    const s = this.song(id);
    if (!s) throw new HttpError(404, "No such song.");
    if (decision === "approve") {
      run(this.db, "UPDATE songs SET status='approved', note=? WHERE id=?", note || null, id);
      this.emit("note", s.account_id, "My Music", `"${s.title}" is cleared. DJs can play it in every club now.`);
    } else {
      run(this.db, "UPDATE songs SET status='rejected', note=? WHERE id=?", note || "Not cleared", id);
      for (const p of all(this.db, "SELECT * FROM song_promos WHERE song_id=? AND status='paid'", id)) {
        const r = p.payment_ref && this.pay ? await this.pay.refund(p.payment_ref, note || "Song not cleared") : { ok: false };
        run(this.db, "UPDATE song_promos SET status=? WHERE id=?", r.ok ? "refunded" : "refund_due", p.id);
      }
      this.emit("note", s.account_id, "My Music", `"${s.title}" was not cleared${note ? `: ${note}` : "."}`);
    }
    return this.song(id);
  }
  quotePromo(a, id, meta) {
    const s = this.song(id);
    if (!s || s.account_id !== a.id || s.status === "deleted") throw new HttpError(404, "That song is not in your library.");
    if (s.status !== "approved") throw new HttpError(409, "Wait until the song is cleared, then promote it.");
    const club = meta?.club === "all" ? "all" : isClub(meta?.club) ? meta.club : null;
    if (!club) throw new HttpError(400, "Pick a club, or all of them.");
    const q = promoQuote(club, Math.round(Number(meta?.days)));
    if (!q) throw new HttpError(400, "Pick 1, 3, 7, 14 or 30 days.");
    const r = run(this.db, "INSERT INTO song_promos(song_id, account_id, club, start_at, end_at, price_kobo, status, created_at) VALUES(?,?,?,?,?,?,?,?)", s.id, a.id, club, 0, 0, q.total * 100, "unpaid", Date.now());
    return { amountKobo: q.total * 100, label: `Club rotation: "${s.title}" in ${club === "all" ? "every club" : CLUB_RULES[club].short}, ${q.days} day${q.days > 1 ? "s" : ""}`, meta: { promoId: Number(r.lastInsertRowid), days: q.days } };
  }
  /** the money landed: the run starts now (stacking after any run already going for that song and club) */
  promoPaid(p) {
    const pr = one(this.db, "SELECT * FROM song_promos WHERE id=?", Number(p.meta.promoId));
    if (!pr) return { note: "promo row missing; refund by hand" };
    if (pr.status !== "unpaid") return { promoId: pr.id, status: pr.status };
    const now = Date.now();
    const days = Math.round(Number(p.meta.days)) || 1;
    const last = one(this.db, "SELECT MAX(end_at) e FROM song_promos WHERE song_id=? AND club=? AND status='paid'", pr.song_id, pr.club)?.e ?? 0;
    const start = Math.max(now, last ?? 0);
    run(this.db, "UPDATE song_promos SET status='paid', start_at=?, end_at=?, payment_ref=? WHERE id=?", start, start + days * DAY2, p.ref, pr.id);
    return { promoId: pr.id, until: start + days * DAY2 };
  }
};

// server/src/main.ts
async function startServer(over = {}, modules) {
  const cfg = loadConfig(over);
  const db = openDb(cfg.dbFile);
  const content = new ContentStore(cfg, log);
  const accounts = new Accounts(db, cfg);
  const economy = new Economy(db, cfg, content, log);
  const hub = new Hub(cfg, db, accounts, economy, content, log);
  const router = new Router();
  const events = new EventEmitter10();
  const payments = new Payments(db, cfg, economy, content, log);
  payments.on("purchase", (p) => {
    events.emit("purchase", p);
    hub.toast(p.accountId, "Payment received", `${p.label} is yours. Thank you!`);
  });
  payments.on("flag", (f) => economy.emit("flag", f));
  const ads = new Ads(db, payments, cfg.dataDir);
  hub.ads = ads;
  const clubs = new Clubs(db, economy, payments, cfg.dataDir);
  hub.clubs = clubs;
  for (const [from, to] of [[accounts, ["signup", "login", "ban", "unban", "profile", "mute"]], [economy, ["wallet", "plot", "flag"]]]) for (const ev of to) from.on(ev, (...a) => events.emit(ev, ...a));
  const add = (m) => (path, h, o) => router.add(m, path, h, o);
  const api = {
    cfg,
    db,
    log,
    accounts,
    economy,
    content,
    online: hub,
    events,
    payments,
    ads,
    clubs,
    limiters: { loginById: new RateLimiter(8 * cfg.rateScale, 10 * 6e4), guestCreate: new RateLimiter(8 * cfg.rateScale, 60 * 6e4) },
    route: (m, p, h, o) => router.add(m, p, h, o),
    get: add("GET"),
    post: add("POST"),
    put: add("PUT"),
    patch: add("PATCH"),
    del: add("DELETE")
  };
  if (cfg.adminEmail && cfg.adminPassword) {
    await accounts.ensureAdmin(cfg.adminEmail, cfg.adminPassword);
    log.info(`admin account ready: ${cfg.adminEmail}`);
  }
  let routes;
  if (modules) {
    routes = [];
    for (const [name, m] of Object.entries(modules)) {
      await m.register(api);
      routes.push(name);
    }
  } else routes = await loadRoutes(api, resolve7(SERVER_DIR, "routes"));
  log.info(`routes loaded: ${routes.join(", ")}`);
  const http = createHttp(api, router);
  hub.attach(http);
  await new Promise((res, rej) => {
    http.once("error", rej);
    http.listen(cfg.port, cfg.host, () => res());
  });
  const addr = http.address();
  const port = typeof addr === "object" && addr ? addr.port : cfg.port;
  hub.start();
  const purge = setInterval(() => {
    try {
      accounts.purgeSessions();
    } catch {
    }
  }, 6 * 36e5);
  purge.unref();
  log.info(`HustleLife server listening on ${cfg.host}:${port} (tick ${cfg.tickHz} Hz, db ${cfg.dbFile})`);
  return {
    api,
    http,
    hub,
    cfg,
    db,
    port,
    routes,
    async close() {
      clearInterval(purge);
      await hub.stop();
      await new Promise((r) => {
        http.close(() => r());
        http.closeAllConnections?.();
      });
      db.close();
    }
  };
}
var isMain = process.argv[1] && /(^|[\\/])main\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  startServer().then((s) => {
    const stop = async () => {
      log.info("shutting down");
      await s.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }).catch((e) => {
    log.error("failed to start", e);
    process.exit(1);
  });
}

// server/routes/admin.ts
var admin_exports = {};
__export(admin_exports, {
  register: () => register
});
import { existsSync as existsSync8 } from "node:fs";
import { dirname as dirname3, join as join6, resolve as resolve8 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// server/admin/handlers.ts
import { readFileSync as readFileSync10 } from "node:fs";
import { randomBytes as randomBytes8 } from "node:crypto";

// server/admin/auth.ts
import { randomBytes as randomBytes7, scryptSync, timingSafeEqual as timingSafeEqual3, createHash as createHash3 } from "node:crypto";

// server/admin/types.ts
var ROLES = ["owner", "admin", "moderator", "content_editor", "support"];
var PERMS = [
  "map.view",
  "map.edit",
  "players.view",
  "players.moderate",
  "players.economy",
  "players.reset",
  "reports.view",
  "reports.resolve",
  "store.view",
  "store.edit",
  "store.refund",
  "economy.view",
  "economy.edit",
  "content.view",
  "content.edit",
  "content.rollback",
  "liveops.view",
  "liveops.edit",
  "maintenance.toggle",
  "audit.view",
  "staff.manage"
];
var ALL = [...PERMS];
var ROLE_PERMS = {
  owner: ALL,
  admin: ALL.filter((p) => p !== "staff.manage"),
  moderator: ["map.view", "players.view", "players.moderate", "reports.view", "reports.resolve", "liveops.view", "audit.view"],
  content_editor: ["map.view", "map.edit", "content.view", "content.edit", "content.rollback", "economy.view", "store.view", "liveops.view"],
  support: ["map.view", "players.view", "reports.view", "store.view", "economy.view"]
};
function can(role, perm) {
  return !!role && ROLE_PERMS[role]?.includes(perm);
}

// server/admin/auth.ts
var SESSION_MS = 12 * 3600 * 1e3;
function hashPassword2(pw) {
  const salt = randomBytes7(16);
  const h = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString("base64")}$${h.toString("base64")}`;
}
function verifyPassword2(pw, stored) {
  const [v, s, h] = stored.split("$");
  if (v !== "s1" || !s || !h) return false;
  const want = Buffer.from(h, "base64");
  const got = scryptSync(pw, Buffer.from(s, "base64"), want.length, { N: 16384, r: 8, p: 1 });
  return want.length === got.length && timingSafeEqual3(want, got);
}
function checkPasswordStrength2(pw) {
  if (pw.length < 10) return "Password must be at least 10 characters";
  if (!/[a-z]/i.test(pw) || !/[0-9]/.test(pw)) return "Use letters and at least one number";
  if (/^(password|12345|qwerty|admin)/i.test(pw)) return "That password is too easy to guess";
  return null;
}
var sha = (s) => createHash3("sha256").update(s).digest("hex");
var rowToUser = (r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, disabled: !!r.disabled, createdAt: r.created_at, lastLogin: r.last_login ?? null });
var Auth = class {
  constructor(db) {
    this.db = db;
  }
  fails = /* @__PURE__ */ new Map();
  count() {
    return this.db.prepare("SELECT COUNT(*) c FROM admin_users").get().c;
  }
  createUser(email, name, role, password, mustChange = false) {
    if (!ROLES.includes(role)) throw new Error("bad role");
    const now = Date.now();
    const r = this.db.prepare("INSERT INTO admin_users(email,name,role,pw_hash,created_at,must_change) VALUES(?,?,?,?,?,?)").run(email.trim().toLowerCase(), name.trim(), role, hashPassword2(password), now, mustChange ? 1 : 0);
    return this.getUser(Number(r.lastInsertRowid));
  }
  getUser(id) {
    const r = this.db.prepare("SELECT * FROM admin_users WHERE id=?").get(id);
    return r ? rowToUser(r) : null;
  }
  listUsers() {
    return this.db.prepare("SELECT * FROM admin_users ORDER BY id").all().map(rowToUser);
  }
  login(email, password, ip, ua) {
    const key = email.trim().toLowerCase() + "|" + ip;
    const f = this.fails.get(key);
    if (f && f.n >= 5 && f.until > Date.now()) return { error: "Too many attempts. Try again later.", retryAfter: Math.ceil((f.until - Date.now()) / 1e3) };
    const r = this.db.prepare("SELECT * FROM admin_users WHERE email=?").get(email.trim().toLowerCase());
    const ok = r && !r.disabled && verifyPassword2(password, r.pw_hash);
    if (!ok) {
      const n = (f && f.until > Date.now() ? f.n : 0) + 1;
      this.fails.set(key, { n, until: Date.now() + 15 * 6e4 });
      return { error: r?.disabled ? "This account is disabled" : "Wrong email or password" };
    }
    this.fails.delete(key);
    const token = randomBytes7(32).toString("base64url");
    const now = Date.now();
    this.db.prepare("INSERT INTO admin_sessions(token_hash,user_id,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?)").run(sha(token), r.id, now, now + SESSION_MS, ip, ua.slice(0, 200));
    this.db.prepare("UPDATE admin_users SET last_login=? WHERE id=?").run(now, r.id);
    return { token, user: rowToUser(r), mustChange: !!r.must_change };
  }
  verify(token) {
    if (!token) return null;
    const h = sha(token);
    const s = this.db.prepare("SELECT * FROM admin_sessions WHERE token_hash=?").get(h);
    if (!s) return null;
    if (s.expires_at < Date.now()) {
      this.db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").run(h);
      return null;
    }
    const u = this.db.prepare("SELECT * FROM admin_users WHERE id=?").get(s.user_id);
    if (!u || u.disabled) return null;
    if (s.expires_at - Date.now() < SESSION_MS / 2) this.db.prepare("UPDATE admin_sessions SET expires_at=? WHERE token_hash=?").run(Date.now() + SESSION_MS, h);
    return rowToUser(u);
  }
  logout(token) {
    this.db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").run(sha(token));
  }
  revokeAll(userId) {
    this.db.prepare("DELETE FROM admin_sessions WHERE user_id=?").run(userId);
  }
  setPassword(userId, pw, mustChange = false) {
    this.db.prepare("UPDATE admin_users SET pw_hash=?, must_change=? WHERE id=?").run(hashPassword2(pw), mustChange ? 1 : 0, userId);
    this.revokeAll(userId);
  }
  checkPassword(userId, pw) {
    const r = this.db.prepare("SELECT pw_hash FROM admin_users WHERE id=?").get(userId);
    return !!r && verifyPassword2(pw, r.pw_hash);
  }
  update(userId, p) {
    if (p.name !== void 0) this.db.prepare("UPDATE admin_users SET name=? WHERE id=?").run(p.name, userId);
    if (p.role !== void 0) {
      if (!ROLES.includes(p.role)) throw new Error("bad role");
      this.db.prepare("UPDATE admin_users SET role=? WHERE id=?").run(p.role, userId);
    }
    if (p.disabled !== void 0) {
      this.db.prepare("UPDATE admin_users SET disabled=? WHERE id=?").run(p.disabled ? 1 : 0, userId);
      if (p.disabled) this.revokeAll(userId);
    }
  }
};

// server/admin/content.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync6, readFileSync as readFileSync9, readdirSync as readdirSync3, renameSync as renameSync2, writeFileSync as writeFileSync5 } from "node:fs";
import { createHash as createHash4 } from "node:crypto";
import { join as join5 } from "node:path";

// server/admin/validate.ts
var CONTENT_KINDS2 = ["missions", "events", "routes", "skills", "npcs", "shops", "economy", "iap"];
var ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,79}$/;
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
var isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var WORLD = { x0: -22e3, x1: 12e3, z0: -20500, z1: 12500 };
function validateContent(kind, doc) {
  const out = [];
  const err = (path, msg) => out.push({ level: "error", path, msg });
  const warn = (path, msg) => out.push({ level: "warn", path, msg });
  if (!isObj(doc)) {
    err("", "File must be an object with version and items");
    return out;
  }
  if (!isNum(doc.version)) err("version", "version must be a number");
  if (!Array.isArray(doc.items)) {
    err("items", "items must be an array");
    return out;
  }
  const seen = /* @__PURE__ */ new Map();
  doc.items.forEach((it, i) => {
    const p = `items[${i}]`;
    if (!isObj(it)) {
      err(p, "item must be an object");
      return;
    }
    if (typeof it.id !== "string" || !it.id) {
      err(p + ".id", "id is required (stable string)");
      return;
    }
    if (!ID_RE.test(it.id)) err(p + ".id", `id "${it.id}" may only use letters, digits and . _ : -`);
    if (seen.has(it.id)) err(p + ".id", `duplicate id "${it.id}" (also item ${seen.get(it.id)})`);
    else seen.set(it.id, i);
  });
  const ids = new Set(seen.keys());
  const V = VALIDATORS[kind];
  if (V) V(doc.items, ids, err, warn);
  return out;
}
var nonNeg = (v, path, err, what = "value") => {
  if (v !== void 0 && (!isNum(v) || v < 0)) err(path, `${what} must be a number of 0 or more`);
};
function checkPos(o, path, err, warn) {
  if (!isObj(o)) return;
  const x = o.x ?? o.pos?.x, z = o.z ?? o.pos?.z;
  if (x === void 0 && z === void 0) return;
  if (!isNum(x) || !isNum(z)) {
    err(path, "position needs numeric x and z");
    return;
  }
  if (x < WORLD.x0 || x > WORLD.x1 || z < WORLD.z0 || z > WORLD.z1) warn(path, `position (${Math.round(x)}, ${Math.round(z)}) is outside the Lagos map`);
}
function cycle(nodes) {
  const state = /* @__PURE__ */ new Map();
  let hit = null;
  const dfs = (n, stack) => {
    state.set(n, 1);
    for (const m of nodes.get(n) ?? []) {
      if (!nodes.has(m)) continue;
      if (state.get(m) === 1) {
        hit = [...stack, n, m].join(" > ");
        return;
      }
      if (!state.get(m)) dfs(m, [...stack, n]);
      if (hit) return;
    }
    state.set(n, 2);
  };
  for (const n of nodes.keys()) {
    if (!state.get(n)) dfs(n, []);
    if (hit) break;
  }
  return hit;
}
function stepRefs(s) {
  const r = [];
  for (const k of ["next", "onSuccess", "onFail", "onTimeout", "goto", "else", "then"]) {
    const v = s?.[k];
    if (typeof v === "string" && v) r.push(v);
    else if (Array.isArray(v)) {
      for (const q of v) if (typeof q === "string") r.push(q);
      else if (isObj(q) && typeof q.to === "string") r.push(q.to);
    }
  }
  if (Array.isArray(s?.choices)) {
    for (const c of s.choices) if (typeof c?.next === "string") r.push(c.next);
  }
  if (Array.isArray(s?.branches)) {
    for (const c of s.branches) if (typeof c?.next === "string") r.push(c.next);
  }
  return r;
}
var VALIDATORS = {
  missions(items, ids, err, warn) {
    items.forEach((m, i) => {
      const p = `items[${i}]`;
      if (!isObj(m)) return;
      if (m.title !== void 0 && typeof m.title !== "string") err(p + ".title", "title must be text");
      checkPos(m.giver, p + ".giver", err, warn);
      checkPos(m.start, p + ".start", err, warn);
      if (isObj(m.reward)) {
        for (const k of ["cash", "xp"]) if (typeof m.reward[k] !== "object") nonNeg(m.reward[k], `${p}.reward.${k}`, err, k);
      }
      for (const q of m.requires ?? m.prereq ?? []) if (typeof q === "string" && !ids.has(q) && /^m[._-]/.test(q)) warn(p + ".requires", `requires unknown mission "${q}"`);
      if (Array.isArray(m.steps)) {
        const sid = /* @__PURE__ */ new Map();
        m.steps.forEach((s, k) => {
          if (!isObj(s) || typeof s.id !== "string") {
            err(`${p}.steps[${k}]`, "step needs a string id");
            return;
          }
          if (sid.has(s.id)) err(`${p}.steps[${k}].id`, `duplicate step id "${s.id}"`);
          sid.set(s.id, k);
        });
        const edges = /* @__PURE__ */ new Map();
        m.steps.forEach((s, k) => {
          if (!isObj(s) || !s.id) return;
          const refs = stepRefs(s);
          edges.set(s.id, refs);
          for (const r of refs) if (!sid.has(r) && r !== "end" && r !== "complete" && r !== "fail") err(`${p}.steps[${k}]`, `step "${s.id}" points at missing step "${r}"`);
          checkPos(s.at ?? s.target ?? s, `${p}.steps[${k}]`, err, warn);
        });
        const first = m.entry ?? m.startStep ?? m.steps[0]?.id;
        if (first && !sid.has(first)) err(p + ".entry", `entry step "${first}" does not exist`);
        if (first && sid.has(first)) {
          const reach = /* @__PURE__ */ new Set();
          const go = (n) => {
            if (reach.has(n)) return;
            reach.add(n);
            for (const r of edges.get(n) ?? []) go(r);
          };
          go(first);
          for (const s of sid.keys()) if (!reach.has(s)) warn(p + ".steps", `step "${s}" can never be reached`);
        }
        if (m.steps.length === 0) warn(p + ".steps", "mission has no steps");
      }
    });
  },
  skills(items, ids, err, warn) {
    const edges = /* @__PURE__ */ new Map();
    items.forEach((s, i) => {
      const p = `items[${i}]`;
      if (!isObj(s)) return;
      const req = Array.isArray(s.requires) ? s.requires.filter((q) => typeof q === "string") : typeof s.requires === "string" ? [s.requires] : typeof s.parent === "string" ? [s.parent] : [];
      edges.set(s.id, req);
      for (const r of req) if (!ids.has(r)) err(p + ".requires", `requires unknown skill "${r}"`);
      nonNeg(s.cost, p + ".cost", err, "cost");
      nonNeg(s.maxRank ?? s.ranks, p + ".maxRank", err, "ranks");
      nonNeg(s.level, p + ".level", err, "level");
      if (Array.isArray(s.modes)) {
        const mid = /* @__PURE__ */ new Set();
        s.modes.forEach((q, k) => {
          if (!isObj(q) || typeof q.id !== "string") err(`${p}.modes[${k}]`, "mode needs an id");
          else if (mid.has(q.id)) err(`${p}.modes[${k}].id`, `duplicate mode "${q.id}"`);
          else mid.add(q.id);
        });
      }
    });
    const c = cycle(edges);
    if (c) err("items", `skill requirements loop: ${c}`);
  },
  routes(items, _ids, err, warn) {
    items.forEach((r, i) => {
      const p = `items[${i}]`;
      if (!isObj(r)) return;
      const pts = r.points ?? r.waypoints ?? r.path;
      if (pts === void 0) {
        warn(p, "route has no points");
        return;
      }
      if (!Array.isArray(pts) || pts.length < 2) {
        err(p + ".points", "a route needs at least 2 points");
        return;
      }
      pts.forEach((q, k) => {
        const x = Array.isArray(q) ? q[0] : q?.x, z = Array.isArray(q) ? q[1] : q?.z;
        if (!isNum(x) || !isNum(z)) err(`${p}.points[${k}]`, "point needs numeric x and z");
        else if (x < WORLD.x0 || x > WORLD.x1 || z < WORLD.z0 || z > WORLD.z1) warn(`${p}.points[${k}]`, "point is outside the Lagos map");
      });
      nonNeg(r.fare, p + ".fare", err, "fare");
      nonNeg(r.pay, p + ".pay", err, "pay");
    });
  },
  events(items, _ids, err, warn) {
    items.forEach((e, i) => {
      const p = `items[${i}]`;
      if (!isObj(e)) return;
      nonNeg(e.weight, p + ".weight", err, "weight");
      nonNeg(e.cooldown, p + ".cooldown", err, "cooldown");
      nonNeg(e.duration, p + ".duration", err, "duration");
      if (e.chance !== void 0 && (!isNum(e.chance) || e.chance < 0 || e.chance > 1)) err(p + ".chance", "chance must be between 0 and 1");
      checkPos(e.at ?? e, p, err, warn);
    });
  },
  npcs(items, _ids, err) {
    items.forEach((n, i) => {
      const p = `items[${i}]`;
      if (!isObj(n)) return;
      if (n.weight !== void 0) nonNeg(n.weight, p + ".weight", err, "weight");
      if (n.wage !== void 0) nonNeg(n.wage, p + ".wage", err, "wage");
    });
  },
  shops(items, _ids, err, warn) {
    items.forEach((s, i) => {
      const p = `items[${i}]`;
      if (!isObj(s)) return;
      nonNeg(s.price, p + ".price", err, "price");
      nonNeg(s.priceNGN, p + ".priceNGN", err, "price");
      if (Array.isArray(s.stock)) s.stock.forEach((q, k) => {
        if (isObj(q)) nonNeg(q.price, `${p}.stock[${k}].price`, err, "price");
      });
      checkPos(s, p, err, warn);
    });
  },
  economy(items, _ids, err, warn) {
    items.forEach((e, i) => {
      const p = `items[${i}]`;
      if (!isObj(e)) return;
      if (!("value" in e)) {
        warn(p, "no value field");
        return;
      }
      if (typeof e.value === "number") {
        if (!Number.isFinite(e.value)) err(p + ".value", "value must be a finite number");
        if (isNum(e.min) && e.value < e.min) err(p + ".value", `${e.value} is below the minimum ${e.min}`);
        if (isNum(e.max) && e.value > e.max) err(p + ".value", `${e.value} is above the maximum ${e.max}`);
        if (isNum(e.min) && isNum(e.max) && e.min > e.max) err(p + ".min", "min is above max");
        if (e.integer === true && !Number.isInteger(e.value)) err(p + ".value", "must be a whole number");
        if (/(price|wage|fee|cost|tax|fine|rent|salary)/i.test(e.id) && e.value < 0) err(p + ".value", "money values cannot be negative");
      }
    });
  },
  iap(items, ids, err, warn) {
    const codes = /* @__PURE__ */ new Map();
    items.forEach((it, i) => {
      const p = `items[${i}]`;
      if (!isObj(it)) return;
      const t = it.type ?? "item";
      if (!["currency", "bundle", "cosmetic", "boost", "pass", "promo", "sale", "item"].includes(t)) warn(p + ".type", `unknown type "${t}"`);
      if (t === "promo") {
        if (typeof it.code !== "string" || !/^[A-Z0-9_-]{3,24}$/.test(it.code)) err(p + ".code", "code must be 3 to 24 characters: A-Z, 0-9, _ or -");
        else if (codes.has(it.code)) err(p + ".code", `code ${it.code} already used by ${codes.get(it.code)}`);
        else codes.set(it.code, it.id);
        if (!isNum(it.percentOff) && !isNum(it.amountOffNGN)) err(p, "promo needs percentOff or amountOffNGN");
        if (isNum(it.percentOff) && (it.percentOff <= 0 || it.percentOff > 100)) err(p + ".percentOff", "percent must be 1 to 100");
      } else if (t === "sale") {
        if (!isNum(it.percentOff) || it.percentOff <= 0 || it.percentOff > 90) err(p + ".percentOff", "sale percent must be 1 to 90");
        for (const q of it.itemIds ?? []) if (!ids.has(q)) err(p + ".itemIds", `unknown store item "${q}"`);
      } else {
        if (!isNum(it.priceNGN) || it.priceNGN <= 0) err(p + ".priceNGN", "price in NGN must be above 0");
        else if (!Number.isInteger(it.priceNGN)) err(p + ".priceNGN", "NGN price must be a whole number");
        if (!isNum(it.priceUSD) || it.priceUSD <= 0) err(p + ".priceUSD", "price in USD must be above 0");
        else if (Math.round(it.priceUSD * 100) !== it.priceUSD * 100 && Math.abs(Math.round(it.priceUSD * 100) - it.priceUSD * 100) > 1e-6) err(p + ".priceUSD", "USD price can have at most 2 decimals");
        if (isNum(it.priceNGN) && isNum(it.priceUSD) && it.priceUSD > 0) {
          const rate = it.priceNGN / it.priceUSD;
          if (rate < 300 || rate > 4e3) warn(p, `NGN and USD prices imply ${Math.round(rate)} NGN per USD, which looks off`);
        }
        if (!it.name) warn(p + ".name", "no display name");
        if (it.grants !== void 0 && !isObj(it.grants)) err(p + ".grants", "grants must be an object");
        for (const k of ["cash", "gems", "bank"]) if (isObj(it.grants)) nonNeg(it.grants[k], `${p}.grants.${k}`, err, k);
      }
      if (it.from && it.to && Date.parse(it.from) >= Date.parse(it.to)) err(p, "window start must be before its end");
      if (it.availableFrom && it.availableTo && Date.parse(it.availableFrom) >= Date.parse(it.availableTo)) err(p, "availability window start must be before its end");
      for (const k of ["from", "to", "availableFrom", "availableTo"]) if (it[k] && Number.isNaN(Date.parse(it[k]))) err(`${p}.${k}`, "not a valid date");
    });
  }
};
var hasErrors = (i) => i.some((x) => x.level === "error");

// server/admin/content.ts
var KIND_RE = /^[a-z][a-z0-9_-]{1,40}$/;
var sha2 = (s) => createHash4("sha1").update(s).digest("hex").slice(0, 12);
var ContentStore2 = class {
  constructor(db, dir, seedDirs) {
    this.db = db;
    this.dir = dir;
    this.seedDirs = seedDirs;
    mkdirSync6(dir, { recursive: true });
  }
  file(kind) {
    return join5(this.dir, kind + ".json");
  }
  kinds() {
    const s = new Set(CONTENT_KINDS2);
    for (const d of [this.dir, ...this.seedDirs]) if (existsSync7(d)) {
      for (const f of readdirSync3(d)) if (f.endsWith(".json") && KIND_RE.test(f.slice(0, -5))) s.add(f.slice(0, -5));
    }
    return [...s];
  }
  seedFor(kind) {
    for (const d of this.seedDirs) {
      const f = join5(d, kind + ".json");
      if (existsSync7(f)) return readFileSync9(f, "utf8");
    }
    return null;
  }
  /** Returns the live document plus its history number. Seeds from the repo content on first use. */
  read(kind, actor = "system") {
    if (!KIND_RE.test(kind)) throw new Error("bad kind");
    let text = existsSync7(this.file(kind)) ? readFileSync9(this.file(kind), "utf8") : null;
    if (text === null) {
      text = this.seedFor(kind) ?? JSON.stringify({ version: 1, items: [] }, null, 2);
      writeFileSync5(this.file(kind), text);
    }
    const doc = JSON.parse(text);
    let cur = this.db.prepare("SELECT MAX(version) v FROM content_versions WHERE kind=?").get(kind)?.v;
    if (!cur) {
      this.record(kind, 1, actor, "Initial import", doc, text);
      cur = 1;
    }
    return { doc, version: cur, hash: sha2(text) };
  }
  record(kind, version, by, note, doc, text) {
    this.db.prepare("INSERT INTO content_versions(kind,version,saved_at,by,note,items,hash,body) VALUES(?,?,?,?,?,?,?,?)").run(kind, version, Date.now(), by, note, doc.items?.length ?? 0, sha2(text), text);
  }
  validate(kind, doc) {
    return validateContent(kind, doc);
  }
  save(kind, doc, by, note, baseVersion) {
    const cur = this.read(kind, by);
    if (baseVersion !== void 0 && baseVersion !== cur.version) return { ok: false, status: 409, error: `Someone saved version ${cur.version} while you were editing version ${baseVersion}. Reload to merge.`, current: cur.version };
    const issues = this.validate(kind, doc);
    if (hasErrors(issues)) return { ok: false, status: 422, error: "Validation failed", issues };
    const text = JSON.stringify(doc, null, 2) + "\n";
    if (sha2(text) === cur.hash || sha2(JSON.stringify(cur.doc, null, 2) + "\n") === sha2(text)) return { ok: true, version: cur.version, changed: false, issues };
    const v = cur.version + 1;
    const tmp = this.file(kind) + ".tmp";
    writeFileSync5(tmp, text);
    renameSync2(tmp, this.file(kind));
    this.record(kind, v, by, note, doc, text);
    return { ok: true, version: v, changed: true, issues };
  }
  versions(kind) {
    this.read(kind);
    return this.db.prepare("SELECT kind,version,saved_at,by,note,items,hash FROM content_versions WHERE kind=? ORDER BY version DESC LIMIT 200").all(kind).map((r) => ({ kind: r.kind, version: r.version, savedAt: r.saved_at, by: r.by, note: r.note, items: r.items, hash: r.hash }));
  }
  versionBody(kind, version) {
    const r = this.db.prepare("SELECT body FROM content_versions WHERE kind=? AND version=?").get(kind, version);
    return r ? JSON.parse(r.body) : null;
  }
  rollback(kind, version, by) {
    const old = this.versionBody(kind, version);
    if (!old) return { ok: false, status: 404, error: "No such version" };
    return this.save(kind, old, by, `Rollback to v${version}`);
  }
};

// server/admin/db.ts
function migrateAdmin(db) {
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
var kvGet = (db, key, def) => {
  const r = db.prepare("SELECT value FROM ops_kv WHERE key=?").get(key);
  if (!r) return def;
  try {
    return JSON.parse(r.value);
  } catch {
    return def;
  }
};
var kvSet = (db, key, v) => {
  db.prepare("INSERT INTO ops_kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(v));
};

// server/admin/store.ts
var j = (s, d) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};
var AdminStore = class {
  constructor(db, live) {
    this.db = db;
    this.live = live;
  }
  now() {
    return Date.now();
  }
  // ---- sanctions
  activeSanctions(accountId) {
    const n = this.now();
    return this.sanctions(accountId).filter((s) => !s.revokedAt && (s.expiresAt === null || s.expiresAt > n));
  }
  sanctions(accountId) {
    return this.db.prepare("SELECT * FROM bans WHERE account_id=? ORDER BY created_at DESC").all(accountId).map((r) => ({ id: r.id, accountId: r.account_id, kind: r.kind, reason: r.reason, createdAt: r.created_at, expiresAt: r.expires_at ?? null, issuedBy: r.issued_by, revokedAt: r.revoked_at ?? null, revokedBy: r.revoked_by ?? null, revokeReason: r.revoke_reason ?? null }));
  }
  addSanction(accountId, kind, reason, minutes, by) {
    const now = this.now();
    const exp = minutes ? now + minutes * 6e4 : null;
    const r = this.db.prepare("INSERT INTO bans(account_id,kind,reason,created_at,expires_at,issued_by) VALUES(?,?,?,?,?,?)").run(accountId, kind, reason, now, exp, by);
    this.live()?.onSanction?.(accountId, { kind, reason, expiresAt: exp });
    return this.sanctions(accountId).find((s) => s.id === Number(r.lastInsertRowid));
  }
  revokeSanctions(accountId, by, reason, kind) {
    const act = this.activeSanctions(accountId).filter((s) => !kind || s.kind === kind);
    for (const s of act) this.db.prepare("UPDATE bans SET revoked_at=?, revoked_by=?, revoke_reason=? WHERE id=?").run(this.now(), by, reason, s.id);
    return act.length;
  }
  statusOf(accountId) {
    const a = this.activeSanctions(accountId);
    return a.some((s) => s.kind === "ban") ? "banned" : a.some((s) => s.kind === "suspend") ? "suspended" : a.some((s) => s.kind === "mute") ? "muted" : "ok";
  }
  // ---- players
  listPlayers(o) {
    const online = new Map((this.live()?.online() ?? []).map((p) => [p.id, p]));
    const where = [];
    const args = [];
    if (o.q) {
      where.push("(a.name LIKE ? OR a.email LIKE ? OR a.id LIKE ?)");
      const q = `%${o.q.replace(/[%_]/g, "")}%`;
      args.push(q, q, q);
    }
    const all2 = this.db.prepare(`SELECT a.id,a.email,a.name,a.created_at,a.last_seen, s.json AS st,
      (SELECT COUNT(*) FROM plots p WHERE p.owner_id=a.id) AS plots,
      (SELECT COALESCE(SUM(amount),0) FROM purchases u WHERE u.account_id=a.id AND u.status='paid' AND u.currency='NGN') AS spent,
      (SELECT COUNT(*) FROM chat_reports r WHERE r.target_id=a.id) AS reports
      FROM accounts a LEFT JOIN player_state s ON s.account_id=a.id ${where.length ? "WHERE " + where.join(" AND ") : ""}`).all(...args);
    let rows = all2.map((r) => {
      const st = j(r.st, {});
      return { id: r.id, email: r.email ?? null, name: r.name, createdAt: r.created_at, lastSeen: r.last_seen ?? null, online: online.has(r.id), cash: st.cash ?? 0, bank: st.bank ?? 0, level: st.level ?? 1, plots: r.plots, status: this.statusOf(r.id), spent: r.spent, reports: r.reports };
    });
    if (o.status && o.status !== "all") rows = rows.filter((r) => o.status === "online" ? r.online : r.status === o.status);
    if (o.onlineOnly) rows = rows.filter((r) => r.online);
    const key = o.sort ?? "lastSeen";
    const dir = o.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const x = a[key] ?? 0, y = b[key] ?? 0;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
    });
    const total = rows.length;
    const off = o.offset ?? 0;
    rows = rows.slice(off, off + Math.min(200, o.limit ?? 50));
    return { rows, total };
  }
  getPlayer(id) {
    const a = this.db.prepare("SELECT * FROM accounts WHERE id=?").get(id);
    if (!a) return null;
    const st = j(this.db.prepare("SELECT json FROM player_state WHERE account_id=?").get(id)?.json, {});
    const live = this.live()?.online().find((p) => p.id === id);
    return {
      id: a.id,
      email: a.email ?? null,
      name: a.name,
      createdAt: a.created_at,
      lastSeen: a.last_seen ?? null,
      online: !!live,
      ip: a.ip ?? null,
      device: a.device ?? null,
      state: st,
      cash: st.cash ?? 0,
      bank: st.bank ?? 0,
      level: st.level ?? 1,
      xp: st.xp ?? 0,
      x: live?.x ?? st.x ?? null,
      z: live?.z ?? st.z ?? null,
      inventory: st.inventory ?? [],
      vehicles: st.vehicles ?? [],
      skills: st.skills ?? {},
      plots: this.plotsOf(id),
      sanctions: this.sanctions(id),
      purchases: this.purchases({ accountId: id, limit: 100 }).rows,
      reports: this.reports({ target: id }).rows,
      notes: this.db.prepare("SELECT id,ts,by,text FROM admin_notes WHERE account_id=? ORDER BY ts DESC").all(id)
    };
  }
  /** Read-modify-write the player's saved state. Online players are patched through the live hook so their next save does not undo it. */
  patchState(id, fn) {
    const row = this.db.prepare("SELECT json FROM player_state WHERE account_id=?").get(id);
    const st = j(row?.json, {});
    const before = JSON.stringify(st);
    fn(st);
    this.db.prepare("INSERT INTO player_state(account_id,json) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET json=excluded.json").run(id, JSON.stringify(st));
    const viaLive = this.live()?.patchOnline?.(id, st) ?? false;
    void before;
    return { st, viaLive };
  }
  addNote(id, by, text) {
    this.db.prepare("INSERT INTO admin_notes(account_id,ts,by,text) VALUES(?,?,?,?)").run(id, this.now(), by, text);
  }
  rename(id, name) {
    this.db.prepare("UPDATE accounts SET name=? WHERE id=?").run(name, id);
  }
  // ---- plots
  plotRow(r) {
    return { id: r.id, ownerId: r.owner_id ?? null, ownerName: r.owner_name ?? null, x: r.x, z: r.z, price: r.price, forSale: !!r.for_sale, flags: j(r.flags, []), name: r.name ?? null, zone: r.zone ?? null, area: r.area ?? null };
  }
  plotsOf(owner) {
    return this.db.prepare("SELECT p.*, a.name AS owner_name FROM plots p LEFT JOIN accounts a ON a.id=p.owner_id WHERE p.owner_id=? ORDER BY p.price DESC").all(owner).map((r) => this.plotRow(r));
  }
  /** Every parcel that is not plain vacant stock: owned, for sale, or flagged. The map draws these over the base parcels. */
  plots() {
    return this.db.prepare("SELECT p.*, a.name AS owner_name FROM plots p LEFT JOIN accounts a ON a.id=p.owner_id").all().map((r) => this.plotRow(r));
  }
  getPlot(id) {
    const r = this.db.prepare("SELECT p.*, a.name AS owner_name FROM plots p LEFT JOIN accounts a ON a.id=p.owner_id WHERE p.id=?").get(id);
    return r ? this.plotRow(r) : null;
  }
  upsertPlot(p) {
    const cur = this.getPlot(p.id);
    if (!cur) {
      if (typeof p.x !== "number" || typeof p.z !== "number") throw new Error("x and z needed to create a parcel record");
      this.db.prepare("INSERT INTO plots(id,owner_id,price,for_sale,x,z,flags,name,zone,area) VALUES(?,?,?,?,?,?,?,?,?,?)").run(p.id, p.ownerId ?? null, p.price ?? 0, p.forSale ? 1 : 0, p.x, p.z, JSON.stringify(p.flags ?? []), p.name ?? null, p.zone ?? null, p.area ?? null);
      return this.getPlot(p.id);
    }
    const n = { ...cur, ...p };
    this.db.prepare("UPDATE plots SET owner_id=?, price=?, for_sale=?, flags=?, name=? WHERE id=?").run(n.ownerId ?? null, n.price, n.forSale ? 1 : 0, JSON.stringify(n.flags ?? []), n.name ?? null, p.id);
    return this.getPlot(p.id);
  }
  // ---- purchases
  pRow(r) {
    return { id: r.id, accountId: r.account_id, accountName: r.account_name ?? void 0, itemId: r.item_id, amount: r.amount, currency: r.currency, status: r.status, provider: r.provider, ref: r.ref ?? null, promo: r.promo ?? null, createdAt: r.created_at, refundedAt: r.refunded_at ?? null, refundReason: r.refund_reason ?? null };
  }
  purchases(o) {
    const w = [];
    const a = [];
    if (o.accountId) {
      w.push("u.account_id=?");
      a.push(o.accountId);
    }
    if (o.status && o.status !== "all") {
      w.push("u.status=?");
      a.push(o.status);
    }
    if (o.q) {
      w.push("(u.id LIKE ? OR u.item_id LIKE ? OR u.ref LIKE ? OR c.name LIKE ?)");
      const q = `%${o.q}%`;
      a.push(q, q, q, q);
    }
    if (o.from) {
      w.push("u.created_at>=?");
      a.push(o.from);
    }
    if (o.to) {
      w.push("u.created_at<?");
      a.push(o.to);
    }
    const W = w.length ? "WHERE " + w.join(" AND ") : "";
    const total = this.db.prepare(`SELECT COUNT(*) c FROM purchases u LEFT JOIN accounts c ON c.id=u.account_id ${W}`).get(...a).c;
    const rows = this.db.prepare(`SELECT u.*, c.name AS account_name FROM purchases u LEFT JOIN accounts c ON c.id=u.account_id ${W} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`).all(...a, Math.min(500, o.limit ?? 50), o.offset ?? 0).map((r) => this.pRow(r));
    return { rows, total };
  }
  getPurchase(id) {
    const r = this.db.prepare("SELECT u.*, c.name AS account_name FROM purchases u LEFT JOIN accounts c ON c.id=u.account_id WHERE u.id=?").get(id);
    return r ? this.pRow(r) : null;
  }
  refund(id, reason) {
    const p = this.getPurchase(id);
    if (!p || p.status !== "paid") return null;
    this.db.prepare("UPDATE purchases SET status='refunded', refunded_at=?, refund_reason=? WHERE id=?").run(this.now(), reason, id);
    const n = this.getPurchase(id);
    this.live()?.onRefund?.(n);
    return n;
  }
  revenue(days) {
    const since = this.now() - days * 864e5;
    const rows = this.db.prepare("SELECT created_at,amount,currency,status,item_id FROM purchases WHERE created_at>=? AND status IN ('paid','refunded','chargeback')").all(since);
    const day = (t) => new Date(t).toISOString().slice(0, 10);
    const series = /* @__PURE__ */ new Map();
    for (let i = days - 1; i >= 0; i--) {
      const d = day(this.now() - i * 864e5);
      series.set(d, { date: d, NGN: 0, USD: 0, refundedNGN: 0, refundedUSD: 0, orders: 0 });
    }
    const byItem = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const s = series.get(day(r.created_at));
      if (!s) continue;
      const cur = r.currency;
      if (r.status === "paid") {
        s[cur] += r.amount;
        s.orders++;
        const b = byItem.get(r.item_id) ?? { itemId: r.item_id, NGN: 0, USD: 0, orders: 0 };
        b[cur] += r.amount;
        b.orders++;
        byItem.set(r.item_id, b);
      } else if (cur === "NGN") s.refundedNGN += r.amount;
      else s.refundedUSD += r.amount;
    }
    const tot = { NGN: 0, USD: 0, refundedNGN: 0, refundedUSD: 0, orders: 0 };
    for (const s of series.values()) {
      tot.NGN += s.NGN;
      tot.USD += s.USD;
      tot.refundedNGN += s.refundedNGN;
      tot.refundedUSD += s.refundedUSD;
      tot.orders += s.orders;
    }
    const payers = this.db.prepare("SELECT COUNT(DISTINCT account_id) c FROM purchases WHERE created_at>=? AND status='paid'").get(since).c;
    return { days, series: [...series.values()], byItem: [...byItem.values()].sort((a, b) => b.NGN + b.USD * 1500 - (a.NGN + a.USD * 1500)).slice(0, 12), totals: { ...tot, payers } };
  }
  // ---- reports
  rRow(r) {
    return { id: r.id, reporterId: r.reporter_id, reporterName: r.reporter_name ?? void 0, targetId: r.target_id, targetName: r.target_name ?? void 0, channel: r.channel, message: r.message, context: j(r.context, []), createdAt: r.created_at, status: r.status, resolution: r.resolution ?? null, resolvedBy: r.resolved_by ?? null };
  }
  reports(o) {
    const w = [];
    const a = [];
    if (o.status && o.status !== "all") {
      w.push("r.status=?");
      a.push(o.status);
    }
    if (o.target) {
      w.push("r.target_id=?");
      a.push(o.target);
    }
    const W = w.length ? "WHERE " + w.join(" AND ") : "";
    const rows = this.db.prepare(`SELECT r.*, a.name AS reporter_name, t.name AS target_name FROM chat_reports r LEFT JOIN accounts a ON a.id=r.reporter_id LEFT JOIN accounts t ON t.id=r.target_id ${W} ORDER BY r.created_at DESC LIMIT ?`).all(...a, o.limit ?? 100).map((r) => this.rRow(r));
    return { rows, total: this.db.prepare(`SELECT COUNT(*) c FROM chat_reports r ${W}`).get(...a).c };
  }
  getReport(id) {
    const r = this.db.prepare("SELECT r.*, a.name AS reporter_name, t.name AS target_name FROM chat_reports r LEFT JOIN accounts a ON a.id=r.reporter_id LEFT JOIN accounts t ON t.id=r.target_id WHERE r.id=?").get(id);
    return r ? this.rRow(r) : null;
  }
  resolveReport(id, status, note, by) {
    this.db.prepare("UPDATE chat_reports SET status=?, resolution=?, resolved_by=? WHERE id=?").run(status, note, by, id);
    return this.getReport(id);
  }
  // ---- counters for the ops page
  counts() {
    const q = (s, ...a) => this.db.prepare(s).get(...a).c;
    const n = this.now();
    const since = n - 30 * 864e5;
    const rev = this.db.prepare("SELECT currency, SUM(amount) s FROM purchases WHERE status='paid' AND created_at>=? GROUP BY currency").all(since);
    return {
      accounts: q("SELECT COUNT(*) c FROM accounts"),
      bannedNow: q("SELECT COUNT(DISTINCT account_id) c FROM bans WHERE kind IN ('ban','suspend') AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)", n),
      openReports: q("SELECT COUNT(*) c FROM chat_reports WHERE status='open'"),
      revenue30d: { NGN: rev.find((r) => r.currency === "NGN")?.s ?? 0, USD: rev.find((r) => r.currency === "USD")?.s ?? 0 }
    };
  }
};

// server/admin/handlers.ts
var HttpError2 = class extends Error {
  constructor(status, msg, extra) {
    super(msg);
    this.status = status;
    this.extra = extra;
  }
};
var bad = (msg, extra) => new HttpError2(400, msg, extra);
var str2 = (v, name, min = 1, max = 400) => {
  if (typeof v !== "string" || v.trim().length < min) throw bad(`${name} is required`);
  if (v.length > max) throw bad(`${name} is too long`);
  return v.trim();
};
var num3 = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${name} must be a number`);
  return n;
};
function diffItems(a, b) {
  const ma = new Map(a.map((x) => [x.id, JSON.stringify(x)]));
  const mb = new Map(b.map((x) => [x.id, JSON.stringify(x)]));
  let add = 0, del = 0, chg = 0;
  for (const [k, v] of mb) {
    if (!ma.has(k)) add++;
    else if (ma.get(k) !== v) chg++;
  }
  for (const k of ma.keys()) if (!mb.has(k)) del++;
  return { add, del, chg };
}
function buildAdmin(deps) {
  const { db } = deps;
  migrateAdmin(db);
  const live = () => deps.live?.() ?? null;
  const auth = new Auth(db);
  const store = new AdminStore(db, live);
  const content = new ContentStore2(db, deps.dataDir + "/content", deps.contentSeedDirs);
  const startedAt = Date.now();
  let setupCode = deps.setupCode ?? (process.env.ADMIN_SETUP_CODE || "");
  if (auth.count() === 0) {
    const e = process.env.ADMIN_SEED_EMAIL, p = process.env.ADMIN_SEED_PASSWORD;
    if (e && p) {
      const w = checkPasswordStrength2(p);
      if (w) deps.log?.(`[admin] ADMIN_SEED_PASSWORD rejected: ${w}`);
      else {
        auth.createUser(e, process.env.ADMIN_SEED_NAME || "Owner", "owner", p);
        deps.log?.(`[admin] seeded owner ${e} from environment`);
      }
    } else {
      if (!setupCode) setupCode = randomBytes8(5).toString("hex");
      deps.log?.(`[admin] No admin accounts yet. Open the admin app and create the owner with setup code: ${setupCode}`);
    }
  }
  const routes = [];
  const audit = (c, action, type, id, summary, before, after) => {
    const u = c.user;
    db.prepare("INSERT INTO admin_audit(ts,actor_id,actor_email,actor_role,action,target_type,target_id,summary,before_json,after_json,ip) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(Date.now(), u?.id ?? null, u?.email ?? "anonymous", u?.role ?? "-", action, type, id, summary.slice(0, 500), before === void 0 ? null : JSON.stringify(before).slice(0, 6e4), after === void 0 ? null : JSON.stringify(after).slice(0, 6e4), c.req.ip);
  };
  const who = (u) => `${u.name} <${u.email}>`;
  function route(method, path, perm, h) {
    routes.push({
      method,
      path: "/api/admin" + path,
      auth: perm !== "public",
      handler: async (req) => {
        try {
          let user = null;
          if (perm !== "public") {
            const tok = (req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");
            user = auth.verify(tok);
            if (!user) throw new HttpError2(401, "Sign in again");
            if (perm && !can(user.role, perm)) throw new HttpError2(403, `Your role (${user.role}) cannot do that`);
          }
          const out = await h({ req, user });
          return { status: 200, body: out === void 0 ? { ok: true } : out };
        } catch (e) {
          if (e instanceof HttpError2) return { status: e.status, body: { error: e.message, ...e.extra ?? {} } };
          deps.log?.(`[admin] ${method} ${path} failed: ${e?.stack ?? e}`);
          return { status: 500, body: { error: "Server error: " + (e?.message ?? e) } };
        }
      }
    });
  }
  route("GET", "/health", "public", () => ({ ok: true, needsSeed: auth.count() === 0, version: deps.version ?? "dev", time: Date.now() }));
  route("POST", "/auth/seed", "public", (c) => {
    if (auth.count() > 0) throw new HttpError2(409, "An admin already exists");
    const b = c.req.body ?? {};
    if (!setupCode || b.setupCode !== setupCode) throw new HttpError2(403, "Wrong setup code (it is printed in the server log)");
    const email = str2(b.email, "email");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw bad("Enter a valid email");
    const w = checkPasswordStrength2(String(b.password ?? ""));
    if (w) throw bad(w);
    const u = auth.createUser(email, str2(b.name, "name"), "owner", b.password);
    audit({ req: c.req, user: u }, "auth.seed", "admin", String(u.id), `First owner ${who(u)} created`);
    const r = auth.login(email, b.password, c.req.ip, c.req.headers["user-agent"] ?? "");
    if ("error" in r) throw bad(r.error);
    return { token: r.token, user: r.user, perms: ROLE_PERMS[r.user.role] };
  });
  route("POST", "/auth/login", "public", (c) => {
    const b = c.req.body ?? {};
    const r = auth.login(String(b.email ?? ""), String(b.password ?? ""), c.req.ip, c.req.headers["user-agent"] ?? "");
    if ("error" in r) {
      audit({ req: c.req, user: null }, "auth.login_failed", "admin", String(b.email ?? "").slice(0, 80), "Failed sign in");
      throw new HttpError2(r.retryAfter ? 429 : 401, r.error);
    }
    audit({ req: c.req, user: r.user }, "auth.login", "admin", String(r.user.id), `${who(r.user)} signed in`);
    return { token: r.token, user: r.user, perms: ROLE_PERMS[r.user.role], mustChange: r.mustChange };
  });
  route("GET", "/public/ops", "public", () => publicOps());
  function publicOps() {
    const m = kvGet(db, "maintenance", { enabled: false, message: "", eta: null, allowStaff: true });
    const flags = db.prepare("SELECT * FROM ops_flags").all();
    const fl = {};
    for (const f of flags) fl[f.key] = { enabled: !!f.enabled, rollout: f.rollout, audience: f.audience };
    const now = Date.now();
    const an = db.prepare("SELECT * FROM ops_announcements WHERE (expires_at IS NULL OR expires_at>?) AND target=? ORDER BY ts DESC LIMIT 5").all(now, "all").map((a) => ({ id: a.id, kind: a.kind, message: a.message, ts: a.ts, expiresAt: a.expires_at }));
    return { maintenance: { enabled: m.enabled, message: m.message, eta: m.eta }, flags: fl, announcements: an, serverTime: now };
  }
  route("GET", "/auth/me", null, (c) => ({ user: c.user, perms: ROLE_PERMS[c.user.role] }));
  route("POST", "/auth/logout", null, (c) => {
    auth.logout((c.req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, ""));
    audit(c, "auth.logout", "admin", String(c.user.id), `${who(c.user)} signed out`);
  });
  route("POST", "/auth/password", null, (c) => {
    const b = c.req.body ?? {};
    if (!auth.checkPassword(c.user.id, String(b.current ?? ""))) throw new HttpError2(403, "Current password is wrong");
    const w = checkPasswordStrength2(String(b.next ?? ""));
    if (w) throw bad(w);
    auth.setPassword(c.user.id, b.next);
    audit(c, "auth.password", "admin", String(c.user.id), `${who(c.user)} changed their password`);
    const r = auth.login(c.user.email, b.next, c.req.ip, c.req.headers["user-agent"] ?? "");
    if ("error" in r) throw bad(r.error);
    return { token: r.token };
  });
  route("GET", "/staff", "staff.manage", () => ({ users: auth.listUsers(), roles: ROLES }));
  route("POST", "/staff", "staff.manage", (c) => {
    const b = c.req.body ?? {};
    const role = b.role;
    if (!ROLES.includes(role)) throw bad("Pick a role");
    if (role === "owner" && c.user.role !== "owner") throw new HttpError2(403, "Only an owner can add an owner");
    const email = str2(b.email, "email");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw bad("Enter a valid email");
    const w = checkPasswordStrength2(String(b.password ?? ""));
    if (w) throw bad(w);
    try {
      const u = auth.createUser(email, str2(b.name, "name"), role, b.password, true);
      audit(c, "staff.create", "admin", String(u.id), `Added ${who(u)} as ${role}`);
      return { user: u };
    } catch (e) {
      if (/UNIQUE/i.test(String(e?.message))) throw new HttpError2(409, "That email already has an account");
      throw e;
    }
  });
  route("PATCH", "/staff/:id", "staff.manage", (c) => {
    const id = num3(c.req.params.id, "id");
    const t = auth.getUser(id);
    if (!t) throw new HttpError2(404, "No such staff member");
    const b = c.req.body ?? {};
    if (t.role === "owner" && c.user.role !== "owner") throw new HttpError2(403, "Only an owner can change an owner");
    if (b.role === "owner" && c.user.role !== "owner") throw new HttpError2(403, "Only an owner can make an owner");
    if (id === c.user.id && (b.disabled || b.role && b.role !== t.role)) throw bad("You cannot disable or demote yourself");
    if (t.role === "owner" && (b.disabled || b.role && b.role !== "owner") && auth.listUsers().filter((u) => u.role === "owner" && !u.disabled).length < 2) throw bad("There must be at least one active owner");
    auth.update(id, { name: b.name, role: b.role, disabled: b.disabled });
    const n = auth.getUser(id);
    audit(c, "staff.update", "admin", String(id), `Updated ${who(n)}: ${JSON.stringify({ name: b.name, role: b.role, disabled: b.disabled })}`, t, n);
    return { user: n };
  });
  route("POST", "/staff/:id/password", "staff.manage", (c) => {
    const id = num3(c.req.params.id, "id");
    const t = auth.getUser(id);
    if (!t) throw new HttpError2(404, "No such staff member");
    if (t.role === "owner" && c.user.role !== "owner") throw new HttpError2(403, "Only an owner can reset an owner");
    const w = checkPasswordStrength2(String(c.req.body?.password ?? ""));
    if (w) throw bad(w);
    auth.setPassword(id, c.req.body.password, true);
    audit(c, "staff.password_reset", "admin", String(id), `Reset password for ${who(t)}`);
  });
  route("GET", "/audit", "audit.view", (c) => {
    const q = c.req.query;
    const w = [];
    const a = [];
    if (q.actor) {
      w.push("actor_email LIKE ?");
      a.push(`%${q.actor}%`);
    }
    if (q.action) {
      w.push("action LIKE ?");
      a.push(`${q.action}%`);
    }
    if (q.target) {
      w.push("(target_id LIKE ? OR summary LIKE ?)");
      a.push(`%${q.target}%`, `%${q.target}%`);
    }
    if (q.before) {
      w.push("id<?");
      a.push(Number(q.before));
    }
    const rows = db.prepare(`SELECT * FROM admin_audit ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`).all(...a, Math.min(300, Number(q.limit) || 100)).map((r) => ({ id: r.id, ts: r.ts, actorId: r.actor_id, actorEmail: r.actor_email, actorRole: r.actor_role, action: r.action, targetType: r.target_type, targetId: r.target_id, summary: r.summary, before: r.before_json ? JSON.parse(r.before_json) : null, after: r.after_json ? JSON.parse(r.after_json) : null, ip: r.ip }));
    return { rows };
  });
  route("GET", "/players", "players.view", (c) => {
    const q = c.req.query;
    return store.listPlayers({ q: q.q, status: q.status, sort: q.sort, dir: q.dir === "asc" ? "asc" : "desc", limit: Number(q.limit) || 50, offset: Number(q.offset) || 0 });
  });
  route("GET", "/players/:id", "players.view", (c) => {
    const p = store.getPlayer(c.req.params.id);
    if (!p) throw new HttpError2(404, "No such player");
    return p;
  });
  route("POST", "/players/:id/sanction", "players.moderate", (c) => {
    const p = store.getPlayer(c.req.params.id);
    if (!p) throw new HttpError2(404, "No such player");
    const b = c.req.body ?? {};
    const kind = b.kind;
    if (!["ban", "suspend", "mute"].includes(kind)) throw bad("kind must be ban, suspend or mute");
    const reason = str2(b.reason, "A reason", 5, 500);
    let minutes = b.minutes === null || b.minutes === void 0 || b.minutes === "" ? null : num3(b.minutes, "duration");
    if (kind !== "ban" && minutes === null) throw bad("Suspensions and mutes need a duration");
    if (minutes !== null && (minutes < 1 || minutes > 60 * 24 * 365 * 5)) throw bad("Duration must be between 1 minute and 5 years");
    if (kind === "ban" && minutes !== null && minutes <= 0) minutes = null;
    if (c.user.role === "support") throw new HttpError2(403, "Support cannot sanction");
    const s = store.addSanction(p.id, kind, reason, minutes, c.user.email);
    let kicked = false;
    if (kind !== "mute") kicked = live()?.kick(p.id, kind === "ban" ? `Banned: ${reason}` : `Suspended: ${reason}`) ?? false;
    audit(c, "player." + kind, "player", p.id, `${kind} ${p.name} ${minutes ? "for " + minutes + " min" : "permanently"}: ${reason}`, void 0, s);
    return { sanction: s, kicked };
  });
  route("POST", "/players/:id/unban", "players.moderate", (c) => {
    const p = store.getPlayer(c.req.params.id);
    if (!p) throw new HttpError2(404, "No such player");
    const reason = str2(c.req.body?.reason, "A reason", 3, 500);
    const n = store.revokeSanctions(p.id, c.user.email, reason, c.req.body?.kind);
    if (!n) throw bad("Nothing active to lift");
    audit(c, "player.unban", "player", p.id, `Lifted ${n} sanction(s) on ${p.name}: ${reason}`);
    return { lifted: n };
  });
  route("POST", "/players/:id/kick", "players.moderate", (c) => {
    const p = store.getPlayer(c.req.params.id);
    if (!p) throw new HttpError2(404, "No such player");
    const reason = str2(c.req.body?.reason, "A reason", 3, 300);
    const ok = live()?.kick(p.id, reason) ?? false;
    audit(c, "player.kick", "player", p.id, `Kicked ${p.name}${ok ? "" : " (not online)"}: ${reason}`);
    if (!ok) throw bad("Player is not online");
    return { kicked: true };
  });
  route("POST", "/players/:id/economy", "players.economy", (c) => {
    const p = store.getPlayer(c.req.params.id);
    if (!p) throw new HttpError2(404, "No such player");
    const b = c.req.body ?? {};
    const reason = str2(b.reason, "A reason", 5, 300);
    const op = b.op === "remove" ? "remove" : "grant";
    const kind = String(b.kind);
    const sign = op === "remove" ? -1 : 1;
    let summary = "";
    const before = { cash: p.cash, bank: p.bank, xp: p.xp, inventory: p.inventory.length };
    if (kind === "cash" || kind === "bank" || kind === "xp") {
      const amt = Math.floor(num3(b.amount, "amount"));
      if (amt <= 0) throw bad("Amount must be above 0");
      if (amt > 1e9) throw bad("That amount is not allowed");
      if (op === "grant" && amt > 5e7 && c.user.role !== "owner") throw new HttpError2(403, "Grants above 50,000,000 need an owner");
      store.patchState(p.id, (st) => {
        st[kind] = Math.max(0, (st[kind] ?? 0) + sign * amt);
      });
      summary = `${op === "grant" ? "Granted" : "Removed"} ${amt.toLocaleString("en-NG")} ${kind} ${op === "grant" ? "to" : "from"} ${p.name}: ${reason}`;
    } else if (kind === "item") {
      const id = str2(b.itemId, "itemId", 1, 80);
      const qty = Math.floor(num3(b.qty ?? 1, "qty"));
      if (qty <= 0 || qty > 1e4) throw bad("Quantity must be 1 to 10000");
      store.patchState(p.id, (st) => {
        st.inventory = st.inventory ?? [];
        const it = st.inventory.find((x) => x.id === id);
        if (it) it.qty = Math.max(0, it.qty + sign * qty);
        else if (op === "grant") st.inventory.push({ id, qty });
        st.inventory = st.inventory.filter((x) => x.qty > 0);
      });
      summary = `${op === "grant" ? "Granted" : "Removed"} ${qty} x ${id} ${op === "grant" ? "to" : "from"} ${p.name}: ${reason}`;
    } else throw bad("kind must be cash, bank, xp or item");
    const after = store.getPlayer(p.id);
    audit(c, "player." + op, "player", p.id, summary, before, { cash: after.cash, bank: after.bank, xp: after.xp, inventory: after.inventory.length });
    return { player: after };
  });
  route("POST", "/players/:id/reset", "players.reset", (c) => {
    const p = store.getPlayer(c.req.params.id);
    if (!p) throw new HttpError2(404, "No such player");
    const b = c.req.body ?? {};
    const reason = str2(b.reason, "A reason", 5, 300);
    if (b.confirm !== p.name) throw bad("Type the player name to confirm");
    const scope = String(b.scope);
    if (scope === "full" && c.user.role !== "owner") throw new HttpError2(403, "Only an owner can do a full wipe");
    if (!["progress", "cash", "inventory", "vehicles", "position", "full"].includes(scope)) throw bad("Unknown reset scope");
    store.patchState(p.id, (st) => {
      if (scope === "progress" || scope === "full") {
        st.level = 1;
        st.xp = 0;
        st.skills = {};
        st.missions = {};
      }
      if (scope === "cash" || scope === "full") {
        st.cash = 0;
        st.bank = 0;
      }
      if (scope === "inventory" || scope === "full") st.inventory = [];
      if (scope === "vehicles" || scope === "full") st.vehicles = [];
      if (scope === "position" || scope === "full") {
        st.x = 0;
        st.z = 0;
      }
    });
    if (scope === "full") for (const pl of p.plots) store.upsertPlot({ id: pl.id, ownerId: null, forSale: false });
    audit(c, "player.reset", "player", p.id, `Reset ${scope} for ${p.name}: ${reason}`);
    return { player: store.getPlayer(p.id) };
  });
  route("POST", "/players/:id/note", "players.view", (c) => {
    const p = store.getPlayer(c.req.params.id);
    if (!p) throw new HttpError2(404, "No such player");
    store.addNote(p.id, c.user.email, str2(c.req.body?.text, "A note", 2, 1e3));
    audit(c, "player.note", "player", p.id, `Note on ${p.name}`);
    return { player: store.getPlayer(p.id) };
  });
  route("POST", "/players/:id/rename", "players.moderate", (c) => {
    const p = store.getPlayer(c.req.params.id);
    if (!p) throw new HttpError2(404, "No such player");
    const name = str2(c.req.body?.name, "name", 2, 24);
    store.rename(p.id, name);
    audit(c, "player.rename", "player", p.id, `Renamed ${p.name} to ${name}: ${c.req.body?.reason ?? ""}`);
    return { player: store.getPlayer(p.id) };
  });
  route("GET", "/reports", "reports.view", (c) => store.reports({ status: c.req.query.status, limit: Number(c.req.query.limit) || 100 }));
  route("POST", "/reports/:id/resolve", "reports.resolve", (c) => {
    const id = num3(c.req.params.id, "id");
    const r = store.getReport(id);
    if (!r) throw new HttpError2(404, "No such report");
    const b = c.req.body ?? {};
    const status = b.status === "dismissed" ? "dismissed" : "actioned";
    const n = store.resolveReport(id, status, str2(b.note, "A note", 2, 400), c.user.email);
    audit(c, "report." + status, "report", String(id), `${status} report #${id} against ${r.targetName ?? r.targetId}`);
    return { report: n };
  });
  route("GET", "/map/live", "map.view", () => ({ players: live()?.online() ?? [], ts: Date.now() }));
  route("GET", "/map/plots", "map.view", () => ({ plots: store.plots() }));
  route("PUT", "/map/plots/:id", "map.edit", (c) => {
    if (!can(c.user.role, "players.economy")) throw new HttpError2(403, "Editing parcels needs an admin");
    const id = c.req.params.id;
    const b = c.req.body ?? {};
    const cur = store.getPlot(id);
    const patch = { id };
    if (b.price !== void 0) {
      const v = Math.round(num3(b.price, "price"));
      if (v < 0 || v > 5e10) throw bad("Price out of range");
      patch.price = v;
    }
    if (b.ownerId !== void 0) {
      if (b.ownerId && !store.getPlayer(b.ownerId)) throw bad("No such owner account");
      patch.ownerId = b.ownerId || null;
    }
    if (b.forSale !== void 0) patch.forSale = !!b.forSale;
    if (b.flags !== void 0) {
      if (!Array.isArray(b.flags) || b.flags.some((f) => typeof f !== "string")) throw bad("flags must be a list of text");
      patch.flags = b.flags.slice(0, 12);
    }
    if (b.name !== void 0) patch.name = b.name || null;
    if (!cur) {
      patch.x = num3(b.x, "x");
      patch.z = num3(b.z, "z");
      patch.zone = b.zone ?? null;
      patch.area = b.area ?? null;
      if (patch.price === void 0) patch.price = 0;
    }
    if (patch.ownerId && patch.forSale) throw bad("A parcel that has an owner is listed by the owner; clear the owner or untick for sale");
    const n = store.upsertPlot(patch);
    audit(c, "plot.update", "plot", id, `Parcel ${id}: ${JSON.stringify({ ...b, x: void 0, z: void 0 })}`, cur, n);
    return { plot: n };
  });
  route("GET", "/map/pois", "map.view", () => ({ overrides: db.prepare("SELECT * FROM poi_overrides").all().map((r) => ({ id: r.id, ...JSON.parse(r.json) })) }));
  route("PUT", "/map/pois/:id", "map.edit", (c) => {
    const id = c.req.params.id;
    const b = c.req.body ?? {};
    const cur = db.prepare("SELECT json FROM poi_overrides WHERE id=?").get(id);
    const before = cur ? JSON.parse(cur.json) : null;
    const next = { ...before ?? {}, ...b.name !== void 0 ? { name: str2(b.name, "name", 1, 80) } : {}, ...b.type !== void 0 ? { type: str2(b.type, "type", 1, 30) } : {}, ...b.hidden !== void 0 ? { hidden: !!b.hidden } : {}, ...b.note !== void 0 ? { note: String(b.note).slice(0, 300) } : {}, ...b.x !== void 0 ? { x: num3(b.x, "x"), z: num3(b.z, "z"), custom: true } : {} };
    db.prepare("INSERT INTO poi_overrides(id,json,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at, updated_by=excluded.updated_by").run(id, JSON.stringify(next), Date.now(), c.user.email);
    audit(c, "poi.update", "poi", id, `POI ${id}: ${JSON.stringify(b)}`, before, next);
    return { poi: { id, ...next } };
  });
  route("DELETE", "/map/pois/:id", "map.edit", (c) => {
    const id = c.req.params.id;
    const cur = db.prepare("SELECT json FROM poi_overrides WHERE id=?").get(id);
    db.prepare("DELETE FROM poi_overrides WHERE id=?").run(id);
    audit(c, "poi.reset", "poi", id, `Removed POI override ${id}`, cur ? JSON.parse(cur.json) : null);
  });
  route("GET", "/content", "content.view", () => ({ kinds: content.kinds().map((k) => {
    try {
      const r = content.read(k);
      return { kind: k, items: r.doc.items.length, version: r.version };
    } catch {
      return { kind: k, items: 0, version: 0 };
    }
  }) }));
  route("GET", "/content/:kind", "content.view", (c) => {
    if (!KIND_RE.test(c.req.params.kind)) throw bad("bad kind");
    const r = content.read(c.req.params.kind, c.user.email);
    return { doc: r.doc, version: r.version, issues: validateContent(c.req.params.kind, r.doc) };
  });
  route("POST", "/content/:kind/validate", "content.view", (c) => ({ issues: validateContent(c.req.params.kind, c.req.body?.doc) }));
  route("PUT", "/content/:kind", "content.edit", (c) => {
    const kind = c.req.params.kind;
    if (!KIND_RE.test(kind)) throw bad("bad kind");
    const need = kind === "economy" || kind === "iap" ? kind === "iap" ? "store.edit" : "economy.edit" : "content.edit";
    if (!can(c.user.role, need)) throw new HttpError2(403, `Editing ${kind} needs the ${need} permission`);
    const b = c.req.body ?? {};
    const before = content.read(kind, c.user.email);
    const r = content.save(kind, b.doc, c.user.email, String(b.note ?? "").slice(0, 200), b.baseVersion);
    if (!r.ok) throw new HttpError2(r.status, r.error, { issues: r.issues, current: r.current });
    if (r.changed) {
      const d = diffItems(before.doc.items, b.doc.items);
      audit(c, "content.save", "content", kind, `Saved ${kind} v${r.version}: +${d.add} new, ${d.chg} changed, ${d.del} removed${b.note ? " (" + b.note + ")" : ""}`, { version: before.version }, { version: r.version, ...d });
    }
    return { version: r.version, changed: r.changed, issues: r.issues };
  });
  route("GET", "/content/:kind/versions", "content.view", (c) => ({ versions: content.versions(c.req.params.kind) }));
  route("GET", "/content/:kind/versions/:v", "content.view", (c) => {
    const d = content.versionBody(c.req.params.kind, num3(c.req.params.v, "version"));
    if (!d) throw new HttpError2(404, "No such version");
    return { doc: d };
  });
  route("POST", "/content/:kind/rollback", "content.rollback", (c) => {
    const kind = c.req.params.kind;
    const v = num3(c.req.body?.version, "version");
    const before = content.read(kind, c.user.email);
    const r = content.rollback(kind, v, c.user.email);
    if (!r.ok) throw new HttpError2(r.status, r.error, { issues: r.issues });
    audit(c, "content.rollback", "content", kind, `Rolled ${kind} back to v${v} (now v${r.version})`, { version: before.version }, { version: r.version });
    return { version: r.version };
  });
  route("GET", "/layouts/:kind/:id", "content.view", (c) => {
    const r = db.prepare("SELECT json FROM graph_layouts WHERE kind=? AND item_id=?").get(c.req.params.kind, c.req.params.id);
    return { layout: r ? JSON.parse(r.json) : null };
  });
  route("PUT", "/layouts/:kind/:id", "content.edit", (c) => {
    db.prepare("INSERT INTO graph_layouts(kind,item_id,json) VALUES(?,?,?) ON CONFLICT(kind,item_id) DO UPDATE SET json=excluded.json").run(c.req.params.kind, c.req.params.id, JSON.stringify(c.req.body?.layout ?? {}));
  });
  route("GET", "/store/purchases", "store.view", (c) => {
    const q = c.req.query;
    return store.purchases({ status: q.status, q: q.q, from: q.from ? Number(q.from) : void 0, to: q.to ? Number(q.to) : void 0, limit: Number(q.limit) || 50, offset: Number(q.offset) || 0 });
  });
  route("POST", "/store/purchases/:id/refund", "store.refund", (c) => {
    const p = store.getPurchase(c.req.params.id);
    if (!p) throw new HttpError2(404, "No such purchase");
    if (p.status !== "paid") throw bad(`Purchase is ${p.status}, not paid`);
    const reason = str2(c.req.body?.reason, "A reason", 5, 300);
    const n = store.refund(p.id, reason);
    audit(c, "purchase.refund", "purchase", p.id, `Refunded ${p.amount} ${p.currency} (${p.itemId}) to ${p.accountName ?? p.accountId}: ${reason}`, p, n);
    return { purchase: n, note: p.provider === "manual" ? null : `Marked refunded here. Send the refund to ${p.provider} separately (ref ${p.ref ?? "none"}) until the payment webhook is wired.` };
  });
  route("GET", "/store/revenue", "store.view", (c) => store.revenue(Math.min(180, Math.max(7, Number(c.req.query.days) || 30))));
  const world = () => {
    const w = deps.world?.() ?? null;
    if (!w) throw bad("The game world is not attached to this server.");
    return w;
  };
  route("GET", "/world/grid", "liveops.view", () => world().grid.board());
  route("POST", "/world/grid", "liveops.edit", (c) => {
    const b = c.req.body ?? {};
    const g = world().grid;
    if (typeof b.collapse === "number") {
      g.collapse(Math.max(0, Math.min(24, b.collapse)));
      audit(c, "grid.collapse", "grid", "all", b.collapse > 0 ? `Collapsed the national grid for ${b.collapse} game hours` : "Restored the national grid");
    }
    if (typeof b.genScale === "number") {
      g.genScale = Math.max(0, Math.min(2, b.genScale));
      g.tick();
      audit(c, "grid.gen", "grid", "all", `Generation set to ${Math.round(g.genScale * 100)}%`);
    }
    if (b.feeder !== void 0) {
      const f = b.feeder === "all" ? "all" : Math.floor(Number(b.feeder));
      if (f !== "all" && !Number.isFinite(f)) throw bad("Bad feeder");
      const on2 = b.on === null || b.on === "auto" ? null : !!b.on;
      g.force(f, on2, Math.max(1, Math.min(240, Number(b.hours) || 24)));
      audit(c, "grid.force", "grid", String(f), on2 === null ? `Feeder ${f} back on the plan` : `Feeder ${f} forced ${on2 ? "ON" : "OFF"}`);
    }
    return g.board();
  });
  route("GET", "/world/businesses", "economy.view", () => ({ list: db.prepare("SELECT b.*, f.name AS owner_name FROM businesses b LEFT JOIN profiles f ON f.account_id=b.owner_id ORDER BY b.bought_at DESC LIMIT 500").all() }));
  route("POST", "/world/businesses/:site", "economy.edit", (c) => {
    const site = c.req.params.site;
    const b = c.req.body ?? {};
    const row = db.prepare("SELECT * FROM businesses WHERE site=?").get(site);
    if (!row) throw bad("No such business");
    if (b.repossess) {
      db.prepare("DELETE FROM businesses WHERE site=?").run(site);
      audit(c, "biz.repossess", "business", site, `Repossessed ${row.type} at ${site}`);
      return { ok: true };
    }
    const num4 = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : void 0;
    const till = num4(b.till, 0, 1e9), stock = num4(b.stock, 0, 100), debt = num4(b.debt, 0, 1e9);
    db.prepare("UPDATE businesses SET till=COALESCE(?,till), stock=COALESCE(?,stock), debt=COALESCE(?,debt) WHERE site=?").run(till ?? null, stock ?? null, debt ?? null, site);
    audit(c, "biz.edit", "business", site, `Edited ${row.type} at ${site}: ${JSON.stringify({ till, stock, debt })}`);
    return db.prepare("SELECT * FROM businesses WHERE site=?").get(site);
  });
  const bodyOf = () => {
    const b = world().body;
    if (!b) throw bad("The body system is not attached.");
    return b;
  };
  route("GET", "/world/body/:id", "players.view", (c) => bodyOf().admin(c.req.params.id));
  route("POST", "/world/body/:id", "players.economy", (c) => {
    const b = c.req.body ?? {};
    const id = c.req.params.id;
    const B = bodyOf();
    const was = B.admin(id);
    if (typeof b.karma === "number" && Number.isFinite(b.karma)) {
      B.karma(id, Math.max(-2e3, Math.min(2e3, b.karma)) - was.karma, "admin");
      audit(c, "body.karma", "player", id, `Karma ${Math.round(was.karma)} -> ${b.karma}`);
    }
    if (typeof b.infect === "string") {
      B.infect(id, b.infect, Date.now(), !!b.carrier);
      audit(c, "body.infect", "player", id, `Gave ${b.infect}${b.carrier ? " (carrier)" : ""}`);
    }
    if (b.cure) {
      db.prepare("UPDATE player_body SET ill='[]' WHERE account_id=?").run(id);
      audit(c, "body.cure", "player", id, "Cured everything");
    }
    if (typeof b.debt === "number" && b.debt >= 0) {
      db.prepare("UPDATE player_body SET debt=? WHERE account_id=?").run(Math.floor(b.debt), id);
      audit(c, "body.debt", "player", id, `Debt ${was.debt} -> ${b.debt}`);
    }
    if (b.dress) {
      db.prepare("UPDATE player_body SET stripped=0 WHERE account_id=?").run(id);
      audit(c, "body.dress", "player", id, "Gave clothes back");
    }
    return B.admin(id);
  });
  const adsOf = () => {
    const a = world().ads;
    if (!a) throw bad("Ads are not attached to this server.");
    return a;
  };
  route("GET", "/world/ads", "reports.view", (c) => {
    const st = ["review", "approved", "rejected", "unpaid"].includes(String(c.req.query.status)) ? String(c.req.query.status) : "review";
    return { status: st, list: adsOf().queue(st), boards: adsOf().boards.length };
  });
  route("GET", "/world/uploads/:id", "reports.view", (c) => {
    const a = adsOf();
    const u = a.upload(c.req.params.id);
    const f = u && a.uploadFile(u);
    if (!f) throw bad("No such picture");
    return { id: u.id, size: u.name, dataUrl: `data:${u.mime};base64,${readFileSync10(f).toString("base64")}` };
  });
  route("POST", "/world/ads/:id", "reports.resolve", async (c) => {
    const b = c.req.body ?? {};
    const d = b.decision === "approve" ? "approve" : b.decision === "reject" ? "reject" : null;
    if (!d) throw bad("Approve or reject");
    const note = typeof b.note === "string" ? b.note.slice(0, 200) : "";
    if (d === "reject" && !note) throw bad("Say why, the advertiser sees it");
    const id = Number(c.req.params.id);
    let row;
    try {
      row = await adsOf().review(id, d, note);
    } catch (e) {
      throw new HttpError2(e?.status ?? 400, e?.message ?? "Review failed");
    }
    audit(c, d === "approve" ? "ads.approve" : "ads.reject", "ad", String(id), `${d === "approve" ? "Approved" : "Rejected"} ad ${id}${note ? `: ${note}` : ""}`);
    return row;
  });
  const clubsOf = () => {
    const k = world().clubs;
    if (!k) throw bad("Clubs are not attached to this server.");
    return k;
  };
  route("GET", "/world/songs", "reports.view", (c) => {
    const st = ["review", "approved", "rejected"].includes(String(c.req.query.status)) ? String(c.req.query.status) : "review";
    return { status: st, list: clubsOf().queue(st), clubs: clubsOf().views() };
  });
  route("GET", "/world/songs/:id/audio", "reports.view", (c) => {
    const k = clubsOf();
    const sg = k.song(c.req.params.id);
    const f = sg && k.songFile(sg);
    if (!f) throw bad("No such song");
    return { id: sg.id, title: sg.title, dataUrl: `data:${sg.mime};base64,${readFileSync10(f).toString("base64")}` };
  });
  route("POST", "/world/songs/:id", "reports.resolve", async (c) => {
    const b = c.req.body ?? {};
    const d = b.decision === "approve" ? "approve" : b.decision === "reject" ? "reject" : null;
    if (!d) throw bad("Approve or reject");
    const note = typeof b.note === "string" ? b.note.slice(0, 200) : "";
    if (d === "reject" && !note) throw bad("Say why, the artist sees it");
    let row;
    try {
      row = await clubsOf().review(c.req.params.id, d, note);
    } catch (e) {
      throw new HttpError2(e?.status ?? 400, e?.message ?? "Review failed");
    }
    audit(c, d === "approve" ? "songs.approve" : "songs.reject", "song", c.req.params.id, `${d === "approve" ? "Cleared" : "Turned down"} "${row.title}"${note ? `: ${note}` : ""}`);
    return row;
  });
  route("GET", "/ops/status", "liveops.view", () => {
    const l = live();
    const on2 = l?.online().length ?? 0;
    const st = l?.stats?.() ?? { connections: on2, tickMs: 0 };
    const cn = store.counts();
    const peak = db.prepare("SELECT MAX(online) m FROM ops_series WHERE ts>?").get(Date.now() - 864e5)?.m ?? on2;
    let dbMb = 0;
    try {
      dbMb = db.prepare("PRAGMA page_count").get()?.page_count * db.prepare("PRAGMA page_size").get()?.page_size / 1048576 || 0;
    } catch {
    }
    return { version: deps.version ?? "dev", uptimeSec: Math.floor((Date.now() - startedAt) / 1e3), online: on2, peak24h: Math.max(peak, on2), connections: st.connections, tickMs: st.tickMs, memoryMb: Math.round(process.memoryUsage().rss / 1048576), dbMb: Math.round(dbMb * 10) / 10, maintenance: kvGet(db, "maintenance", { enabled: false, message: "", eta: null, allowStaff: true }), ...cn, simulated: !!l?.simulated };
  });
  route("GET", "/ops/series", "liveops.view", () => ({ series: db.prepare("SELECT ts,online FROM ops_series WHERE ts>? ORDER BY ts").all(Date.now() - 24 * 36e5) }));
  route("GET", "/ops/flags", "liveops.view", () => ({ flags: db.prepare("SELECT * FROM ops_flags ORDER BY key").all().map((r) => ({ key: r.key, enabled: !!r.enabled, rollout: r.rollout, description: r.description, audience: r.audience, updatedAt: r.updated_at, updatedBy: r.updated_by })) }));
  route("PUT", "/ops/flags/:key", "liveops.edit", (c) => {
    const key = c.req.params.key;
    if (!/^[a-z][a-z0-9_.-]{1,40}$/.test(key)) throw bad("Flag keys use lowercase letters, digits, . _ -");
    const b = c.req.body ?? {};
    const cur = db.prepare("SELECT * FROM ops_flags WHERE key=?").get(key);
    const n = { enabled: b.enabled ?? !!cur?.enabled, rollout: Math.max(0, Math.min(100, Math.round(Number(b.rollout ?? cur?.rollout ?? 100)))), description: String(b.description ?? cur?.description ?? "").slice(0, 200), audience: ["all", "staff", "beta"].includes(b.audience) ? b.audience : cur?.audience ?? "all" };
    db.prepare("INSERT INTO ops_flags(key,enabled,rollout,description,audience,updated_at,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET enabled=excluded.enabled, rollout=excluded.rollout, description=excluded.description, audience=excluded.audience, updated_at=excluded.updated_at, updated_by=excluded.updated_by").run(key, n.enabled ? 1 : 0, n.rollout, n.description, n.audience, Date.now(), c.user.email);
    audit(c, cur ? "flag.update" : "flag.create", "flag", key, `Flag ${key}: ${n.enabled ? "on" : "off"} at ${n.rollout}% for ${n.audience}`, cur ? { enabled: !!cur.enabled, rollout: cur.rollout, audience: cur.audience } : null, n);
    return { ok: true };
  });
  route("DELETE", "/ops/flags/:key", "liveops.edit", (c) => {
    db.prepare("DELETE FROM ops_flags WHERE key=?").run(c.req.params.key);
    audit(c, "flag.delete", "flag", c.req.params.key, `Deleted flag ${c.req.params.key}`);
  });
  route("GET", "/ops/announcements", "liveops.view", () => ({ rows: db.prepare("SELECT * FROM ops_announcements ORDER BY id DESC LIMIT 50").all().map((r) => ({ id: r.id, ts: r.ts, by: r.by, kind: r.kind, message: r.message, target: r.target, targetIds: r.target_ids ? JSON.parse(r.target_ids) : void 0, expiresAt: r.expires_at ?? null, delivered: r.delivered })) }));
  route("POST", "/ops/announce", "liveops.edit", (c) => {
    const b = c.req.body ?? {};
    const message = str2(b.message, "A message", 3, 280);
    const kind = ["info", "warn", "event"].includes(b.kind) ? b.kind : "info";
    const ids = Array.isArray(b.targetIds) && b.targetIds.length ? b.targetIds.map(String).slice(0, 200) : void 0;
    const mins = b.minutes ? Math.min(1440, Math.max(1, Number(b.minutes))) : null;
    const delivered = live()?.broadcast({ kind, message, targetIds: ids }) ?? 0;
    const r = db.prepare("INSERT INTO ops_announcements(ts,by,kind,message,target,target_ids,expires_at,delivered) VALUES(?,?,?,?,?,?,?,?)").run(Date.now(), c.user.email, kind, message, ids ? "ids" : "all", ids ? JSON.stringify(ids) : null, mins ? Date.now() + mins * 6e4 : null, delivered);
    audit(c, "announce", "announcement", String(r.lastInsertRowid), `${kind} to ${ids ? ids.length + " players" : "everyone"} (${delivered} online): ${message}`);
    return { delivered };
  });
  route("PUT", "/ops/maintenance", "maintenance.toggle", (c) => {
    const b = c.req.body ?? {};
    const cur = kvGet(db, "maintenance", { enabled: false, message: "", eta: null, allowStaff: true });
    const n = { enabled: !!b.enabled, message: String(b.message ?? cur.message ?? "").slice(0, 280), eta: b.eta ? Number(b.eta) : null, allowStaff: b.allowStaff !== false };
    if (n.enabled && n.message.trim().length < 3) throw bad("Write the message players will see");
    kvSet(db, "maintenance", n);
    if (n.enabled && !cur.enabled) live()?.broadcast({ kind: "warn", message: n.message || "The server is going down for maintenance." });
    audit(c, "maintenance", "ops", "maintenance", `Maintenance ${n.enabled ? "ON" : "off"}${n.enabled ? ": " + n.message : ""}`, cur, n);
    return { maintenance: n };
  });
  const tick = () => {
    try {
      db.prepare("INSERT OR REPLACE INTO ops_series(ts,online) VALUES(?,?)").run(Math.floor(Date.now() / 6e4) * 6e4, live()?.online().length ?? 0);
      db.prepare("DELETE FROM ops_series WHERE ts<?").run(Date.now() - 3 * 864e5);
    } catch {
    }
  };
  return { routes, auth, store, content, tick, publicOps, setupCode: () => setupCode };
}

// server/routes/admin.ts
var here2 = dirname3(fileURLToPath2(import.meta.url));
function register(api) {
  const dataDir = api.dataDir ?? api.config?.dataDir ?? api.cfg?.dataDir ?? resolve8(here2, "../data");
  const seeds = [resolve8(PATHS.publicDir, "content"), resolve8(here2, "../../admin/seed/content")].filter((d) => existsSync8(d));
  const admin = buildAdmin({ db: api.db, dataDir, contentSeedDirs: seeds, live: () => api.live ?? null, world: () => api.world ?? api.online?.world ?? null, log: (m) => typeof api.log === "function" ? api.log(m) : typeof api.log?.info === "function" ? api.log.info(m) : console.log(m), version: api.version });
  for (const r of admin.routes) mount(api, r.method, r.path, r.handler);
  mount(api, "GET", "/api/admin-public/content/:kind", (req) => {
    try {
      return { status: 200, body: admin.content.read(req.params.kind).doc };
    } catch {
      return { status: 404, body: { error: "unknown content" } };
    }
  });
  mount(api, "GET", "/api/public/ops", () => ({ status: 200, body: admin.publicOps() }));
  const t = setInterval(admin.tick, 6e4);
  t.unref?.();
  admin.tick();
  return admin;
}
function mount(api, method, path, handler) {
  if (typeof api.route === "function") {
    api.route(method, path, handler);
    return;
  }
  const fn = api[method.toLowerCase()];
  if (typeof fn !== "function") throw new Error("admin routes: the server api exposes neither route() nor get/post/put/patch/delete()");
  fn.call(api, path, async (rq, rs) => {
    const req = { method, path: rq.path ?? rq.url, params: rq.params ?? {}, query: rq.query ?? {}, body: rq.body, headers: rq.headers ?? {}, ip: rq.ip ?? rq.socket?.remoteAddress ?? "" };
    const out = await handler(req);
    rs.status(out.status ?? 200).json(out.body);
  });
}

// server/routes/ads.ts
var ads_exports = {};
__export(ads_exports, {
  register: () => register2
});
import { readFileSync as readFileSync11 } from "node:fs";
function register2(api) {
  const { ads, payments } = api;
  api.get("/api/ads/boards", () => ({
    mode: payments.mode,
    test: payments.mode !== "live",
    today: lagosDay(Date.now()),
    days: AD_DAYS,
    boards: ads.inventory(),
    drone: { spots: DRONE_SPOTS.map((s) => ({ ...s, day: ads.quote("drone", 1, s.id).day, nextFree: ads.nextFree("drone", s.id) })), textMax: DRONE_TEXT_MAX },
    blimp: { day: BLIMP_DAY, fleet: BLIMPS, nextFree: ads.nextFree("blimp", null), size: { w: 1600, h: 400 } }
  }));
  api.get("/api/ads/quote", (req) => ads.quote(req.query.kind, Number(req.query.days) || 1, req.query.key));
  api.get("/api/ads/mine", (req) => ({ mode: payments.mode, list: ads.mine(req.account.id) }), { auth: "user" });
  api.get("/api/ads/live", () => ({ list: ads.live() }));
  api.post("/api/uploads", (req) => ads.saveUpload(req.account.id, req.body?.data, "ad"), { auth: "user", bodyLimit: 42e5, rate: { limit: 30, windowMs: 60 * 6e4 } });
  api.get("/api/uploads/:id", (req) => {
    const u = ads.upload(req.params.id);
    const f = u && ads.uploadFile(u);
    if (!u || !f) throw new HttpError(404, "No such picture.");
    const mine = req.account && (req.account.id === u.account_id || req.account.role !== "player");
    if (!mine && !ads.isPublic(u.id)) throw new HttpError(404, "No such picture.");
    const res = req.res;
    res.statusCode = 200;
    res.setHeader("Content-Type", u.mime);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(readFileSync11(f));
    return HANDLED;
  });
}

// server/routes/auth.ts
var auth_exports = {};
__export(auth_exports, {
  register: () => register3
});
function register3(api) {
  const { accounts } = api;
  const strict = { rate: { limit: 12, windowMs: 10 * 6e4 } };
  const session = (r) => ({
    token: r.token,
    expires: r.expires,
    account: publicAccount(r.account),
    hasProfile: !!accounts.profile(r.account.id),
    ...r.guestKey ? { guestKey: r.guestKey } : {}
  });
  api.post("/api/auth/signup", async (req) => {
    const r = await accounts.signup(req.body.identifier ?? req.body.email ?? req.body.phone, req.body.password, req.ip, String(req.headers["user-agent"] ?? ""));
    return session(r);
  }, strict);
  api.post("/api/auth/login", async (req) => {
    const key = String(req.body.identifier ?? req.body.email ?? req.body.phone ?? "").toLowerCase().slice(0, 120);
    if (!api.limiters.loginById.take(key)) throw new HttpError(429, "Too many tries on this account. Wait a few minutes.");
    const r = await accounts.login(key, req.body.password, req.ip, String(req.headers["user-agent"] ?? ""));
    api.limiters.loginById.reset(key);
    return session(r);
  }, strict);
  api.post("/api/auth/guest", async (req) => {
    if (!api.limiters.guestCreate.take(req.ip) && !req.body.guestKey) throw new HttpError(429, "Too many guest accounts from this connection.");
    return session(await accounts.guest(req.body.guestKey, req.ip, String(req.headers["user-agent"] ?? "")));
  }, strict);
  api.post("/api/auth/upgrade", async (req) => {
    const acc = await accounts.upgrade(req.account.id, req.body.identifier ?? req.body.email ?? req.body.phone, req.body.password);
    return { account: publicAccount(acc) };
  }, { auth: "user", rate: { limit: 10, windowMs: 10 * 6e4 } });
  api.post("/api/auth/password", async (req) => {
    await accounts.changePassword(req.account.id, req.body.oldPassword, req.body.newPassword, req.sid ?? void 0);
    return { ok: true };
  }, { auth: "user", rate: { limit: 6, windowMs: 10 * 6e4 } });
  api.post("/api/auth/logout", (req) => {
    if (req.sid) accounts.revokeSession(req.sid);
    return { ok: true };
  }, { auth: "user" });
  api.get("/api/auth/me", (req) => {
    const a = req.account;
    const p = accounts.profile(a.id);
    return { account: publicAccount(a), hasProfile: !!p, name: p?.name ?? null };
  }, { auth: "user" });
}

// server/routes/content.ts
var content_exports = {};
__export(content_exports, {
  register: () => register4
});
function register4(api) {
  const { content } = api;
  api.get("/api/content", () => ({ kinds: content.summary() }));
  api.get("/api/content/:kind", (req) => {
    const kind = req.params.kind;
    if (!content.isKind(kind)) throw new HttpError(404, `Unknown content kind "${kind}".`);
    const etag = content.etag(kind);
    if ((req.headers["if-none-match"] ?? "").replace(/"/g, "") === etag) return reply(304, void 0, { ETag: `"${etag}"` });
    return reply(200, content.rawText(kind), { ETag: `"${etag}"`, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
  });
  api.put("/api/content/:kind", (req) => {
    const kind = req.params.kind;
    const doc = content.write(kind, req.body, { ifMatch: String(req.headers["if-match"] ?? "") || void 0, by: req.account.id });
    const etag = content.etag(kind);
    api.events.emit("content", { kind, etag, by: req.account.id });
    return reply(200, { ok: true, kind, etag, items: doc.items.length }, { ETag: `"${etag}"` });
  }, { auth: "admin", bodyLimit: 8 * 1024 * 1024, rate: { limit: 60, windowMs: 6e4 } });
  api.get("/api/content/:kind/history", (req) => {
    if (!content.isKind(req.params.kind)) throw new HttpError(404, "Unknown content kind.");
    return { items: content.history(req.params.kind) };
  }, { auth: "admin" });
  api.post("/api/content/:kind/restore", (req) => {
    const doc = content.restore(req.params.kind, String(req.body.rev ?? ""), req.account.id);
    return { ok: true, etag: content.etag(req.params.kind), items: doc.items.length };
  }, { auth: "admin" });
  api.post("/api/content/:kind/reset", (req) => {
    if (!content.isKind(req.params.kind)) throw new HttpError(404, "Unknown content kind.");
    const doc = content.resetToSeed(req.params.kind, req.account.id);
    return { ok: true, etag: content.etag(req.params.kind), items: doc.items.length };
  }, { auth: "admin" });
}

// server/routes/health.ts
var health_exports = {};
__export(health_exports, {
  register: () => register5
});
var started = Date.now();
function register5(api) {
  api.get("/api/health", () => ({ ok: true, name: "hustlelife", version: 1, protocol: 1, uptime: Math.round((Date.now() - started) / 1e3), online: api.online.count(), guests: api.cfg.guestAccounts, motd: api.cfg.motd }));
  api.get("/api/stats", () => ({ ...api.online.stats(), mem: process.memoryUsage().rss, cpu: process.cpuUsage() }), { auth: "mod" });
  api.get("/api/rooms", () => ({ rooms: api.online.rooms() }), { auth: "mod" });
  api.get("/api/online", () => ({ players: api.online.list() }), { auth: "mod" });
}

// server/routes/pay.ts
var pay_exports = {};
__export(pay_exports, {
  register: () => register6
});
function register6(api) {
  const pay = api.payments;
  api.get("/api/pay/config", () => pay.publicConfig());
  api.post("/api/pay/start", async (req) => pay.start(req.account, req.body.sku, req.body.meta), { auth: "user", rate: { limit: 20, windowMs: 6e4 } });
  api.get("/api/pay/mine", (req) => ({ items: pay.mine(req.account.id) }), { auth: "user" });
  api.get("/api/pay/ledger", (req) => pay.ledger({ status: req.query.status || void 0, limit: Number(req.query.limit) || 100, before: req.query.before ? Number(req.query.before) : void 0 }), { auth: "admin" });
  api.get("/api/pay/status/:ref", async (req) => pub(await pay.status(req.account.id, req.params.ref)), { auth: "user", rate: { limit: 120, windowMs: 6e4 } });
  api.post("/api/pay/status/:ref/test-complete", (req) => pub(pay.testComplete(req.account.id, req.params.ref)), { auth: "user", rate: { limit: 20, windowMs: 6e4 } });
  api.post("/api/pay/status/:ref/cancel", (req) => pub(pay.cancel(req.account.id, req.params.ref)), { auth: "user" });
  api.post("/api/pay/paystack/webhook", (req) => {
    const r = pay.webhook(req.rawBody ?? "", req.headers["x-paystack-signature"]);
    return r.ok ? { ok: true } : reply(401, { error: r.why });
  }, { rawBody: true, bodyLimit: 64 * 1024, rate: { limit: 600, windowMs: 6e4 } });
}

// server/routes/profile.ts
var profile_exports = {};
__export(profile_exports, {
  register: () => register7
});
function register7(api) {
  const { accounts } = api;
  const mine = api.get("/api/profile", (req) => {
    const p = accounts.profile(req.account.id);
    if (!p) throw new HttpError(404, "No profile yet.", { code: "no_profile" });
    return publicProfile(p);
  }, { auth: "user" });
  void mine;
  api.post("/api/profile", (req) => {
    const p = accounts.createProfile(req.account.id, req.body);
    api.economy.ensurePlayer(req.account.id);
    return publicProfile(p);
  }, { auth: "user", rate: { limit: 20, windowMs: 6e4 } });
  api.patch("/api/profile", (req) => publicProfile(accounts.updateProfile(req.account.id, req.body)), { auth: "user", rate: { limit: 60, windowMs: 6e4 } });
  api.get("/api/players/:name", (req) => {
    const p = accounts.profileByName(req.params.name);
    if (!p) throw new HttpError(404, "No such player.");
    return { name: p.name, model: p.model, skin: p.skin, outfit: p.outfit, xp: p.xp, online: api.online.isOnline(p.account_id), plots: api.economy.plotsOf(p.account_id).length };
  });
}

// server/routes/songs.ts
var songs_exports = {};
__export(songs_exports, {
  register: () => register8
});
import { readFileSync as readFileSync12 } from "node:fs";
function register8(api) {
  const { clubs } = api;
  api.post("/api/songs", (req) => clubs.saveSong(req.account.id, req.body ?? {}), { auth: "user", bodyLimit: 11e6, rate: { limit: 12, windowMs: 60 * 6e4 } });
  api.get("/api/songs/mine", (req) => ({ list: clubs.mine(req.account.id) }), { auth: "user" });
  api.get("/api/songs/prices", () => ({ days: PROMO_DAYS, clubs: [...CLUB_IDS, "all"].map((c) => ({ club: c, quotes: PROMO_DAYS.map((d) => promoQuote(c, d)) })) }));
  api.get("/api/songs/:id/audio", (req) => {
    const s = clubs.song(req.params.id);
    const f = s && clubs.songFile(s);
    if (!s || !f || s.status === "deleted" || !clubs.canHear(s, req.account)) throw new HttpError(404, "No such song.");
    const buf = readFileSync12(f);
    const res = req.res;
    const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
    res.setHeader("Content-Type", s.mime);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", s.status === "approved" ? "public, max-age=86400" : "private, no-store");
    if (range) {
      const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
      if (a >= buf.length || a > b) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${buf.length}`);
        res.end();
        return HANDLED;
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${a}-${b}/${buf.length}`);
      res.end(buf.subarray(a, b + 1));
      return HANDLED;
    }
    res.statusCode = 200;
    res.end(buf);
    return HANDLED;
  }, { auth: "none" });
}

// server/routes/state.ts
var state_exports = {};
__export(state_exports, {
  register: () => register9
});
function register9(api) {
  const eco = api.economy;
  api.get("/api/me/wallet", (req) => eco.wallet(req.account.id), { auth: "user" });
  api.get("/api/me/history", (req) => ({ items: eco.history(req.account.id, Number(req.query.limit) || 50, req.query.before ? Number(req.query.before) : void 0) }), { auth: "user" });
  api.get("/api/me/state", (req) => {
    const s = eco.state(req.account.id);
    return { ...s.blobs, vehicles: s.vehicles, skills: s.skills, missions: s.missions };
  }, { auth: "user" });
  api.put("/api/me/state", (req) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Send an object of { key: value }.");
    const keys = Object.keys(body);
    if (keys.length > 32) throw new HttpError(400, "Too many keys in one call.");
    for (const k of keys) eco.putState(req.account.id, k, body[k]);
    return { ok: true, keys };
  }, { auth: "user", bodyLimit: 1024 * 1024, rate: { limit: 60, windowMs: 6e4 } });
  api.post("/api/me/bank", (req) => {
    const a = String(req.body.action);
    const n = Number(req.body.amount);
    if (a === "deposit") return eco.deposit(req.account.id, n);
    if (a === "withdraw") return eco.withdraw(req.account.id, n);
    throw new HttpError(400, "action must be deposit or withdraw.");
  }, { auth: "user" });
}

// server/routes/world.ts
var world_exports = {};
__export(world_exports, {
  register: () => register10
});
import { randomBytes as randomBytes9, randomUUID } from "node:crypto";
var LGAS = ["Ikeja", "Oshodi-Isolo", "Mushin", "Agege", "Alimosho", "Ifako-Ijaiye", "Kosofe", "Surulere", "Lagos Island", "Eti-Osa", "Ikorodu", "Ajeromi-Ifelodun", "Apapa", "Somolu", "Amuwo-Odofin", "Badagry", "Epe", "Ibeju-Lekki", "Lagos Mainland", "Ojo"];
function register10(api) {
  const eco = api.economy;
  const db = api.db;
  api.get("/api/world/plots", (req) => {
    const n = (k, d) => {
      const v = Number(req.query[k]);
      return Number.isFinite(v) ? v : d;
    };
    const rows = req.query.all ? eco.allPlots() : eco.plotsIn(n("minx", -1e9), n("minz", -1e9), n("maxx", 1e9), n("maxz", 1e9));
    return { items: rows.map((r) => ({ id: r.id, owner: r.owner_id, ownerName: r.owner_name })) };
  }, { rate: { limit: 120, windowMs: 6e4 } });
  api.get("/api/world/plots/:id", (req) => {
    const p = eco.plotRow(req.params.id);
    if (!p) return { id: req.params.id, owner: null, ownerName: null, price: eco.plots.map.get(req.params.id)?.price ?? null };
    return { id: p.id, owner: p.owner_id, ownerName: p.owner_name, price: p.price, boughtAt: p.bought_at };
  });
  api.get("/api/me/plots", (req) => ({ items: eco.plotsOf(req.account.id).map((p) => ({ id: p.id, pts: p.pts ? JSON.parse(p.pts) : null, price: p.price, boughtAt: p.bought_at })) }), { auth: "user" });
  api.get("/api/nin/me", (req) => {
    const r = one(db, "SELECT * FROM nin_registry WHERE account_id=?", req.account.id);
    return r ? { nin: r.nin, fullName: r.full_name, lga: r.lga, issuedAt: r.issued_at } : { nin: null };
  }, { auth: "user" });
  api.post("/api/nin", (req) => {
    const id = req.account.id;
    const prof = api.accounts.profile(id);
    if (!prof) throw new HttpError(400, "Create your hustler first.");
    if (one(db, "SELECT 1 FROM nin_registry WHERE account_id=?", id)) throw new HttpError(409, "You already have a NIN.", { code: "nin_exists" });
    const lga = LGAS.includes(String(req.body.lga)) ? String(req.body.lga) : "Ikeja";
    const fee = Math.max(0, Math.min(1e5, Math.floor(Number(req.body.fee) || 0)));
    let nin = "";
    for (let i = 0; i < 20; i++) {
      nin = String(BigInt("0x" + randomBytes9(6).toString("hex")) % 100000000000n).padStart(11, "0");
      if (!one(db, "SELECT 1 FROM nin_registry WHERE nin=?", nin)) break;
    }
    db.transaction(() => {
      if (fee) eco.adjust(id, -fee, 0, "nin.fee", { ref: lga, silent: false });
      run(db, "INSERT INTO nin_registry(nin,account_id,full_name,lga,issued_at) VALUES(?,?,?,?,?)", nin, id, prof.name, lga, Date.now());
    })();
    return { nin, fullName: prof.name, lga };
  }, { auth: "user", rate: { limit: 10, windowMs: 6e4 } });
  const vrow = (r) => ({ id: r.id, vkey: r.vkey, kind: r.kind, plate: r.plate, paint: safeJson2(r.paint), registeredAt: r.registered_at, stolen: !!r.stolen, stolenAt: r.stolen_at, tracker: !!r.tracker, nin: r.nin });
  api.get("/api/vehicles/mine", (req) => ({ items: all(db, "SELECT * FROM vehicle_registry WHERE owner_id=? ORDER BY registered_at", req.account.id).map(vrow) }), { auth: "user" });
  api.post("/api/vehicles/register", (req) => {
    const id = req.account.id;
    const b = req.body;
    const vkey = String(b.vkey ?? "").slice(0, 64);
    const kind = String(b.kind ?? "").slice(0, 20);
    if (!vkey || !kind) throw new HttpError(400, "vkey and kind are required.");
    const nin = one(db, "SELECT nin FROM nin_registry WHERE account_id=?", id);
    if (!nin) throw new HttpError(400, "You need a NIN to register a vehicle.", { code: "no_nin" });
    if (one(db, "SELECT 1 FROM vehicle_registry WHERE vkey=?", vkey)) throw new HttpError(409, "That vehicle is already registered.", { code: "registered" });
    const count = one(db, "SELECT COUNT(*) n FROM vehicle_registry WHERE owner_id=?", id).n;
    if (count >= 25) throw new HttpError(400, "Vehicle limit reached.");
    let plate = typeof b.plate === "string" ? b.plate.toUpperCase().replace(/[^A-Z0-9\- ]/g, "").trim().slice(0, 10) : "";
    if (plate && one(db, "SELECT 1 FROM vehicle_registry WHERE plate=?", plate)) throw new HttpError(409, "That plate number is taken.", { code: "plate_taken" });
    if (!plate) plate = genPlate(db);
    const fee = Math.max(0, Math.min(5e6, Math.floor(Number(b.fee) || 0)));
    const rid = randomUUID();
    db.transaction(() => {
      if (fee) eco.adjust(id, -fee, 0, "vehicle.register", { ref: vkey });
      run(db, "INSERT INTO vehicle_registry(id,vkey,owner_id,nin,kind,plate,paint,registered_at) VALUES(?,?,?,?,?,?,?,?)", rid, vkey, id, nin.nin, kind, plate, JSON.stringify(b.paint ?? {}).slice(0, 2e3), Date.now());
    })();
    return vrow(one(db, "SELECT * FROM vehicle_registry WHERE id=?", rid));
  }, { auth: "user", rate: { limit: 20, windowMs: 6e4 } });
  api.post("/api/vehicles/:vkey/stolen", (req) => {
    const r = one(db, "SELECT * FROM vehicle_registry WHERE vkey=? AND owner_id=?", req.params.vkey, req.account.id);
    if (!r) throw new HttpError(404, "You do not own that vehicle.");
    run(db, "UPDATE vehicle_registry SET stolen=?, stolen_at=? WHERE id=?", req.body.stolen === false ? 0 : 1, req.body.stolen === false ? null : Date.now(), r.id);
    return vrow(one(db, "SELECT * FROM vehicle_registry WHERE id=?", r.id));
  }, { auth: "user" });
  api.post("/api/vehicles/:vkey/tracker", (req) => {
    const r = one(db, "SELECT * FROM vehicle_registry WHERE vkey=? AND owner_id=?", req.params.vkey, req.account.id);
    if (!r) throw new HttpError(404, "You do not own that vehicle.");
    const fee = Math.max(0, Math.min(1e6, Math.floor(Number(req.body.fee) || 0)));
    if (!r.tracker && fee) eco.adjust(req.account.id, -fee, 0, "vehicle.tracker", { ref: req.params.vkey });
    run(db, "UPDATE vehicle_registry SET tracker=1 WHERE id=?", r.id);
    return vrow(one(db, "SELECT * FROM vehicle_registry WHERE id=?", r.id));
  }, { auth: "user" });
  api.get("/api/vehicles/lookup", (req) => {
    const plate = String(req.query.plate ?? "").toUpperCase().trim();
    const r = one(db, "SELECT v.*, p.name AS owner_name FROM vehicle_registry v LEFT JOIN profiles p ON p.account_id=v.owner_id WHERE v.plate=?", plate);
    if (!r) return { found: false };
    return { found: true, plate: r.plate, kind: r.kind, stolen: !!r.stolen, owner: r.owner_name };
  });
}
function safeJson2(s) {
  try {
    return JSON.parse(String(s));
  } catch {
    return {};
  }
}
function genPlate(db) {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (let i = 0; i < 50; i++) {
    const b = randomBytes9(6);
    const p = `${L[b[0] % 24]}${L[b[1] % 24]}${L[b[2] % 24]}-${String((b[3] << 8 | b[4]) % 1e3).padStart(3, "0")}${L[b[5] % 24]}${L[(b[5] >> 3) % 24]}`;
    if (!one(db, "SELECT 1 FROM vehicle_registry WHERE plate=?", p)) return p;
  }
  return randomUUID().slice(0, 8).toUpperCase();
}

// server/src/play.ts
startServer({}, { admin: admin_exports, ads: ads_exports, auth: auth_exports, content: content_exports, health: health_exports, pay: pay_exports, profile: profile_exports, songs: songs_exports, state: state_exports, world: world_exports }).then((s) => {
  const stop = async () => {
    log.info("shutting down");
    await s.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}).catch((e) => {
  log.error("failed to start", e);
  process.exit(1);
});
