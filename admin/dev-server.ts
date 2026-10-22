// Local stand-in for the game server's admin surface, so the admin app runs before the real server exists.
// Same code path as production: it loads server/routes/admin.ts through register(api) with a tiny api shim.
// Storage: node:sqlite (admin/.dev/dev.db). Net tables (accounts, bans, purchases...) are created and filled with
// DEMO DATA on first run; the live players are simulated. Run: npm run dev:server  (port 8787, or PORT)
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from '../server/routes/admin.ts';
import { NET_DDL, migrateAdmin, type SqlDb } from '../server/admin/db.ts';
import type { LiveHooks } from '../server/admin/store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DEV = resolve(here, '.dev'); mkdirSync(DEV, { recursive: true });
const raw = new DatabaseSync(process.env.DEV_DB || join(DEV, 'dev.db'));
raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=OFF;');
const db: SqlDb = { prepare: (s) => raw.prepare(s) as any, exec: (s) => raw.exec(s) };
migrateAdmin(db); db.exec(NET_DDL);

// ---------------- deterministic demo data
let seed = 20261022; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const FIRST = ['Tunde', 'Ngozi', 'Chidi', 'Amina', 'Emeka', 'Funke', 'Ibrahim', 'Yetunde', 'Kelechi', 'Bisi', 'Segun', 'Zainab', 'Obinna', 'Folake', 'Musa', 'Ifeoma', 'Dayo', 'Hadiza', 'Kunle', 'Chiamaka', 'Femi', 'Aisha', 'Uche', 'Titi', 'Bayo', 'Nneka', 'Sola', 'Halima', 'Ayo', 'Efe'];
const LAST = ['Adeyemi', 'Okafor', 'Bello', 'Eze', 'Balogun', 'Nwosu', 'Abubakar', 'Ogunleye', 'Ojo', 'Chukwu', 'Lawal', 'Ibe', 'Adebayo', 'Okonkwo', 'Yusuf', 'Olaniyan', 'Akande', 'Nnamdi', 'Salami', 'Obi'];
const TAGS = ['lagos', 'naija', 'odogwu', 'baddest', 'oga', 'shaku', 'danfo', 'agbero', 'sapa', 'ikeja', 'mushin', 'yaba', 'island', 'hustler'];
if ((db.prepare('SELECT COUNT(*) c FROM accounts').get() as any).c === 0) {
  const iap = JSON.parse(readFileSync(resolve(here, 'seed/content/iap.json'), 'utf8')).items.filter((i: any) => i.priceNGN);
  const parcels = JSON.parse(readFileSync(resolve(here, 'seed/parcels-sample.json'), 'utf8')) as any[];
  const now = Date.now(); const day = 86400_000; const ZN = ['vacant', 'residential', 'commercial', 'industrial', 'institution', 'unfinished'];
  const ids: string[] = []; const used = new Set<string>();
  raw.exec('BEGIN');
  for (let i = 0; i < 180; i++) {
    const nm = rnd() < 0.5 ? `${pick(FIRST)}${pick(['_', '', '.'])}${pick(TAGS)}${Math.floor(rnd() * 99)}` : `${pick(FIRST)} ${pick(LAST)}`; if (used.has(nm)) { i--; continue; } used.add(nm);
    const id = 'acc_' + (100000 + i * 37).toString(36); ids.push(id);
    const created = now - Math.floor(rnd() * 120) * day - Math.floor(rnd() * day); const seen = rnd() < 0.2 ? now - Math.floor(rnd() * 600) * 1000 : now - Math.floor(rnd() * 25 * day);
    const level = 1 + Math.floor(rnd() * rnd() * 22); const p = pick(parcels);
    const st = { cash: Math.floor(rnd() * rnd() * 4_000_000 / 500) * 500, bank: Math.floor(rnd() * rnd() * 20_000_000 / 1000) * 1000, level, xp: level * 380 + Math.floor(rnd() * 300), x: p[1], z: p[2],
      inventory: ['tool.spanner', 'food.jollof', 'phone.tecno', 'food.water', 'cloth.cap', 'tracker.basic'].filter(() => rnd() < 0.45).map((x) => ({ id: x, qty: 1 + Math.floor(rnd() * 5) })),
      vehicles: rnd() < 0.6 ? [{ id: 'veh_' + i, model: pick(['Okada', 'Danfo', 'Corolla', 'Camry', 'Keke', 'Hilux']), plate: `${pick(['LND', 'KJA', 'APP', 'EKY', 'LSR'])}-${100 + Math.floor(rnd() * 899)}${pick(['AA', 'BC', 'XY', 'KT'])}`, color: pick(['#facc15', '#2de0c8', '#8b5cf6', '#111827', '#ef4444']), value: Math.floor(rnd() * 8_000_000), registered: rnd() < 0.7, stolen: rnd() < 0.05 }] : [],
      skills: Object.fromEntries(['skill.drive.basics', 'skill.hustle.haggle', 'skill.street.run'].filter(() => rnd() < 0.8).map((s) => [s, 1 + Math.floor(rnd() * 3)])), missions: { 'm.cappa.first-job': 'done' } };
    raw.prepare('INSERT INTO accounts(id,email,name,created_at,last_seen,ip,device) VALUES(?,?,?,?,?,?,?)').run(id, nm.toLowerCase().replace(/[^a-z0-9]/g, '') + '@' + pick(['gmail.com', 'yahoo.com', 'icloud.com']), nm, created, seen, `102.89.${Math.floor(rnd() * 255)}.${Math.floor(rnd() * 255)}`, pick(['Chrome / Android', 'Chrome / Windows', 'Safari / iPhone', 'Firefox / Linux']));
    raw.prepare('INSERT INTO player_state(account_id,json) VALUES(?,?)').run(id, JSON.stringify(st));
  }
  // parcels: about a third owned, some for sale, a few flagged
  parcels.slice(0, 900).forEach((p, i) => {
    const r = rnd(); const owned = r < 0.36; const sale = !owned && r < 0.5; if (!owned && !sale && r > 0.52) return;
    raw.prepare('INSERT OR IGNORE INTO plots(id,owner_id,price,for_sale,x,z,flags,name,zone,area) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p[0], owned ? ids[i % ids.length] : null, p[7], sale ? 1 : 0, p[1], p[2], JSON.stringify(rnd() < 0.05 ? ['disputed'] : rnd() < 0.04 ? ['no-build'] : []), p[6], ZN[p[3]], p[5]);
  });
  // purchases: 60 days, Naira mostly, weekend peaks
  let n = 0;
  for (let d = 60; d >= 0; d--) {
    const dow = new Date(now - d * day).getUTCDay(); const base = 5 + (60 - d) * 0.22 + (dow === 5 || dow === 6 ? 7 : 0) + (d % 17 === 0 ? 14 : 0);
    for (let k = 0; k < Math.floor(base + rnd() * 6); k++) {
      const item = iap[Math.floor(rnd() * rnd() * iap.length)]; const usd = rnd() < 0.18; const acc = ids[Math.floor(rnd() * rnd() * ids.length)];
      const st = rnd() < 0.035 ? 'refunded' : rnd() < 0.02 ? 'failed' : 'paid'; const t = now - d * day + Math.floor(rnd() * day * 0.95);
      if (t > now) continue; n++;
      raw.prepare('INSERT INTO purchases(id,account_id,item_id,amount,currency,status,provider,ref,promo,created_at,refunded_at,refund_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('ord_' + (1000 + n).toString(36), acc, item.id, usd ? item.priceUSD : item.priceNGN, usd ? 'USD' : 'NGN', st, usd ? 'stripe' : pick(['paystack', 'flutterwave']), (usd ? 'pi_' : 'PSK_') + Math.floor(rnd() * 1e10).toString(36), rnd() < 0.08 ? 'WELCOME20' : null, t, st === 'refunded' ? t + day : null, st === 'refunded' ? 'Duplicate charge' : null);
    }
  }
  // sanctions and reports
  [[ids[3], 'ban', 'Duplicating cash with the market glitch', null, -30], [ids[9], 'suspend', 'Harassing players in global chat', 60 * 72, -1], [ids[14], 'mute', 'Spam in trade chat', 60 * 24, -0.3], [ids[21], 'ban', 'Chargeback fraud', null, -12], [ids[33], 'mute', 'Slurs in local chat', 60 * 6, -0.1]].forEach(([acc, kind, reason, mins, ago]: any) => {
    const t = now + ago * day; raw.prepare('INSERT INTO bans(account_id,kind,reason,created_at,expires_at,issued_by) VALUES(?,?,?,?,?,?)').run(acc, kind, reason, t, mins ? t + mins * 60000 : null, 'seed@demo.local');
  });
  const MSG = ['Oga sell me the car for 5k or I go find you', 'this boy dey cheat with the money glitch, check him wallet', 'free cash join my telegram t.me/xxxx', 'you be mumu, uninstall the game', 'selling plots cheap DM me outside the game', 'who wan buy fake plates?'];
  for (let i = 0; i < 14; i++) raw.prepare('INSERT INTO chat_reports(reporter_id,target_id,channel,message,context,created_at,status) VALUES(?,?,?,?,?,?,?)').run(pick(ids), ids[40 + i], pick(['global', 'local', 'trade', 'whisper']), pick(MSG), JSON.stringify(['[12:01] ' + pick(FIRST) + ': anybody around?', '[12:02] reported: ' + pick(MSG)]), now - Math.floor(rnd() * 6 * day), i < 9 ? 'open' : pick(['actioned', 'dismissed']));
  raw.exec('COMMIT');
  console.log(`[dev] seeded ${ids.length} demo accounts, ${n} purchases`);
}

// ---------------- simulated live players (positions as the real server would report them)
const sample = JSON.parse(readFileSync(resolve(here, 'seed/parcels-sample.json'), 'utf8')) as any[];
const accs = db.prepare('SELECT id,name FROM accounts ORDER BY last_seen DESC LIMIT 34').all() as { id: string; name: string }[];
const sim = new Map<string, { id: string; name: string; x: number; z: number; heading: number; activity: string; level: number; tx: number; tz: number; speed: number; since: number }>();
const ACT = ['walking', 'driving', 'danfo shift', 'in a shop', 'idle', 'okada ride', 'mission'];
for (const a of accs) { const p = pick(sample); const t = pick(sample); const st = JSON.parse((db.prepare('SELECT json FROM player_state WHERE account_id=?').get(a.id) as any).json); sim.set(a.id, { id: a.id, name: a.name, x: p[1], z: p[2], heading: 0, activity: pick(ACT), level: st.level, tx: t[1], tz: t[2], speed: 4 + rnd() * 18, since: Date.now() - rnd() * 7200_000 }); }
setInterval(() => { for (const p of sim.values()) { const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz); if (d < 30) { const t = pick(sample); p.tx = t[1]; p.tz = t[2]; p.activity = pick(ACT); continue; } p.heading = Math.atan2(dx, -dz); p.x += (dx / d) * p.speed; p.z += (dz / d) * p.speed; } }, 1000).unref();
const kicked: string[] = [];
const liveHooks: LiveHooks & { simulated: boolean } = {
  simulated: true,
  online: () => [...sim.values()].map((p) => ({ id: p.id, name: p.name, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, heading: p.heading, activity: p.activity, level: p.level })),
  kick: (id, reason) => { if (!sim.has(id)) return false; sim.delete(id); kicked.push(id + ':' + reason); return true; },
  broadcast: () => sim.size,
  stats: () => ({ connections: sim.size, tickMs: 14 + Math.round(rnd() * 5) }),
};

// ---------------- tiny router that implements the host api used by server/routes/admin.ts
type H = (req: any) => Promise<any> | any;
const table: { method: string; re: RegExp; keys: string[]; h: H }[] = [];
const api = {
  db, dataDir: join(DEV, 'data'), live: liveHooks, version: 'dev-stub', log: (m: string) => console.log(m),
  route(method: string, path: string, h: H) { const keys: string[] = []; const re = new RegExp('^' + path.replace(/:[A-Za-z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$'); table.push({ method, re, keys, h }); },
};
const admin = register(api) as any;
// the game's own content endpoint (net workstream owns the real one): GET public, PUT needs an admin token
table.push({ method: 'GET', re: /^\/api\/content\/([a-z0-9_-]+)\/?$/, keys: ['kind'], h: (rq: any) => { try { return { status: 200, body: admin.content.read(rq.params.kind).doc }; } catch { return { status: 404, body: { error: 'no such content' } }; } } });
// seed the live-ops demo flags once
if ((db.prepare('SELECT COUNT(*) c FROM ops_flags').get() as any).c === 0) for (const [k, e, r, d] of [['mp.enabled', 1, 100, 'Multiplayer lobby'], ['store.iap', 1, 100, 'In-app store'], ['society.nemesis', 1, 50, 'Nemesis NPC system (staged rollout)'], ['events.flood', 0, 0, 'Flood event on Ikorodu Road'], ['housing.decor', 1, 100, 'House decor placement']] as any[]) db.prepare('INSERT INTO ops_flags(key,enabled,rollout,description,audience,updated_at,updated_by) VALUES(?,?,?,?,?,?,?)').run(k, e, r, d, 'all', Date.now(), 'seed');

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
const serveFile = (rs: any, f: string) => { if (!existsSync(f) || !statSync(f).isFile()) return false; rs.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); createReadStream(f).pipe(rs); return true; };
const DIST = resolve(here, 'dist'); const WORLD = resolve(here, '../v2/public/world');
createServer(async (rq, rs) => {
  const url = new URL(rq.url ?? '/', 'http://x'); const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
  if (rq.method === 'OPTIONS') { rs.writeHead(204, cors); rs.end(); return; }
  if (!url.pathname.startsWith('/api/')) { // optional static hosting of the built admin and the world packs
    if (url.pathname.startsWith('/world/') && serveFile(rs, join(WORLD, url.pathname.slice(7)))) return;
    const f = join(DIST, url.pathname === '/' ? 'index.html' : url.pathname); if (existsSync(DIST) && (serveFile(rs, f) || serveFile(rs, join(DIST, 'index.html')))) return;
    rs.writeHead(404, cors); rs.end('not found'); return;
  }
  for (const r of table) {
    if (r.method !== rq.method) continue; const m = r.re.exec(url.pathname); if (!m) continue;
    const params: Record<string, string> = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    let body: any = undefined; if (rq.method !== 'GET' && rq.method !== 'DELETE') { const chunks: Buffer[] = []; for await (const c of rq) chunks.push(c as Buffer); const t = Buffer.concat(chunks).toString('utf8'); try { body = t ? JSON.parse(t) : {}; } catch { rs.writeHead(400, cors); rs.end('{"error":"bad json"}'); return; } }
    const out = await r.h({ method: rq.method, path: url.pathname, params, query: Object.fromEntries(url.searchParams), body, headers: rq.headers as any, ip: rq.socket.remoteAddress ?? '' });
    rs.writeHead(out.status ?? 200, { ...cors, 'content-type': 'application/json' }); rs.end(JSON.stringify(out.body ?? {})); return;
  }
  rs.writeHead(404, { ...cors, 'content-type': 'application/json' }); rs.end('{"error":"not found"}');
}).listen(PORT, '127.0.0.1', () => console.log(`[dev] admin API on http://127.0.0.1:${PORT}  (simulated game server, demo data)`));
