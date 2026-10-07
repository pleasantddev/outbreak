// Lagos Rush room server: static files for the built client, a health check, and the room WebSocket at /ws.
// Run in development with `npm run server` (the Vite client connects to port 8787), or `npm start` for production.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import zlib from 'node:zlib';
import { WebSocketServer, type WebSocket } from 'ws';
import { Rooms, type Conn } from './rooms';
import { Store } from './store';
import { PROTOCOL_VERSION, normaliseCode, validState, unpackState, type ClientMsg, type ServerMsg, type PlayerCard, type RankInfo } from '../src/shared/protocol';
import { CARS, carById } from '../src/shared/cars';
import type { TrackData } from '../src/shared/track';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = Number(process.env.PORT ?? 8787);
const DIST = path.join(root, 'dist');
const started = Date.now();
const log = (m: string) => { if (process.env.QUIET !== '1') console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`); };

function loadTracks(): TrackData[] {
  for (const p of [path.join(DIST, 'world/tracks.json'), path.join(root, 'public/world/tracks.json')]) if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  throw new Error('tracks.json not found; run npm run gis:build');
}

/** dataFile: where ratings and lap records live. Undefined means the default under DATA_DIR; null keeps them in
 *  memory only, which is what the tests use. */
export function createServer(port = PORT, opts: { dataFile?: string | null } = {}) {
  const dataFile = opts.dataFile === undefined ? path.join(process.env.DATA_DIR ?? path.join(root, 'data/server'), 'ranked.json') : opts.dataFile;
  const store = new Store(dataFile, log);
  const tracks = loadTracks();
  const rooms = new Rooms(tracks, log, store);
  const rankInfo = (pid: string): RankInfo => { const p = store.find(pid)!; return { pid, rating: p.rating, races: p.races, wins: p.wins, rank: store.rankOf(pid) }; };
  const tokens = new Map<string, string>(); // reconnect token -> player id
  const GZIP = new Set(['.html', '.js', '.css', '.json', '.svg']);
  const gzCache = new Map<string, { mtime: number; buf: Buffer }>();
  const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    // the global boards: the ranked ladder and, for one route, the fastest laps the server timed itself
    if (url.pathname === '/api/leaderboard') {
      const track = url.searchParams.get('track');
      const body = { ratings: store.board(50), laps: track && tracks.some((t) => t.id === track) ? store.laps(track) : [] };
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(body));
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, version: PROTOCOL_VERSION, uptime: Math.round((Date.now() - started) / 1000), ...rooms.stats() }));
      return;
    }
    // static client, with SPA fallback
    let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Build the client first: npm run build'); return; }
    const ext = path.extname(file);
    const headers: Record<string, string> = { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400', vary: 'accept-encoding' };
    // text compresses four to one (the city file goes from 1.1 MB to 250 KB), which matters on Nigerian mobile data
    if (GZIP.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      const st = fs.statSync(file);
      let hit = gzCache.get(file);
      if (!hit || hit.mtime !== st.mtimeMs) { hit = { mtime: st.mtimeMs, buf: zlib.gzipSync(fs.readFileSync(file), { level: 9 }) }; gzCache.set(file, hit); }
      res.writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': String(hit.buf.length) });
      res.end(hit.buf);
      return;
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });

  // permessage-deflate: snapshots repeat most of their bytes, so the socket's own compression cuts them again
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024, perMessageDeflate: { threshold: 128, zlibDeflateOptions: { level: 3 } } });
  wss.on('connection', (ws: WebSocket) => {
    let conn: Conn | null = null;
    // rate limiting: a token bucket per socket, plus slower buckets for room management and chat
    let bucket = 40, mgmt = 6, chat = 2;
    const refill = setInterval(() => { bucket = Math.min(40, bucket + 30); mgmt = Math.min(6, mgmt + 0.6); chat = Math.min(2, chat + 0.5); }, 1000);
    const send = (m: ServerMsg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
    const err = (code: Extract<ServerMsg, { t: 'error' }>['code'], msg: string) => send({ t: 'error', code, msg });
    ws.on('message', (data) => {
      if (--bucket < 0) { if (bucket < -60) ws.close(1008, 'rate'); return; }
      let m: ClientMsg;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
      if (!conn && m.t !== 'hello') return;
      try {
        switch (m.t) {
          case 'hello': {
            if (m.v !== PROTOCOL_VERSION) { err('bad_version', 'Please update the game'); ws.close(); return; }
            const card = cleanCard(m.card);
            if (!card) { err('invalid', 'Bad player card'); return; }
            // a valid reconnect token restores the same identity and seat
            const known = m.token ? tokens.get(m.token) : undefined;
            const id = known ?? randomBytes(8).toString('hex');
            const token = m.token && known ? m.token : randomBytes(16).toString('hex');
            tokens.set(token, id);
            conn = { id, card, send, room: null, token, alive: true, queued: false, lastState: 0, violations: 0, ping: 0 };
            // a device key makes this player known to the ranked ladder; the server keeps only its hash
            if (Store.validKey(m.key)) { conn.pid = Store.pid(m.key); store.player(conn.pid, card.name); }
            send({ t: 'welcome', you: id, token, version: PROTOCOL_VERSION, now: Date.now(), online: rooms.stats(), me: conn.pid ? rankInfo(conn.pid) : undefined });
            for (const r of rooms.rooms.values()) if (r.players.has(id)) { r.add(conn); break; }
            return;
          }
          case 'ping': send({ t: 'pong', ct: m.ct, st: Date.now() }); return;
          case 'quick': {
            if (--mgmt < 0) return err('rate', 'Slow down');
            if (m.ranked && !conn!.pid) return err('invalid', 'Ranked needs this device to have a player key. Update the game.');
            if (conn!.room) conn!.room.remove(conn!.id);
            rooms.match(conn!, !!m.ranked);
            return;
          }
          case 'create': {
            if (--mgmt < 0) return err('rate', 'Slow down');
            if (conn!.room) conn!.room.remove(conn!.id);
            rooms.create(conn!, m.config ?? {});
            return;
          }
          case 'join': {
            if (--mgmt < 0) return err('rate', 'Slow down');
            const code = normaliseCode(String(m.code ?? ''));
            const room = code ? rooms.rooms.get(code) : undefined;
            if (!room || room.phase === 'closed') return err('not_found', 'No room with that code');
            if (room.full && !room.players.has(conn!.id)) return err('full', 'That room is full');
            if (conn!.room && conn!.room !== room) conn!.room.remove(conn!.id);
            const why = room.add(conn!);
            if (why) err('full', 'That room is full');
            return;
          }
          case 'leave': { const r = conn!.room; if (r) { r.remove(conn!.id); send({ t: 'left', reason: 'left' }); } return; }
          case 'cancelQueue': return;
          case 'ready': conn!.room?.setReady(conn!.id, !!m.on); return;
          case 'setCar': { const card = cleanCard({ ...conn!.card, carId: m.carId, livery: m.livery }); if (card) { conn!.card = card; conn!.room?.setCar(conn!.id, card); } return; }
          case 'config': { const r = conn!.room; if (!r) return err('not_in_room', 'Not in a room'); const why = r.configure(conn!.id, m.patch ?? {}); if (why) err('not_host', 'Only the host can change the race'); return; }
          case 'kick': { const why = conn!.room?.kick(conn!.id, String(m.id)); if (why) err('not_host', 'Only the host can do that'); return; }
          case 'start': { const why = conn!.room?.requestStart(conn!.id); if (why === 'not_host') err('not_host', 'Only the host can start'); return; }
          case 'chat': {
            if (--chat < 0) return;
            const n = Number(m.phrase);
            if (!Number.isInteger(n) || n < 0 || n > 20) return;
            conn!.room?.broadcast({ t: 'chat', from: conn!.id, name: conn!.card.name, phrase: n });
            return;
          }
          case 'state': {
            const r = conn!.room; if (!r) return;
            const ok = validState(m.s) && r.state(conn!.id, Number(m.rt), unpackState(m.s));
            if (!ok && ++conn!.violations > 40) { err('invalid', 'Too many invalid updates'); r.remove(conn!.id); }
            if (ok && conn!.violations > 0) conn!.violations -= 0.05;
            return;
          }
          case 'useItem': conn!.room?.useItem(conn!.id); return;
        }
      } catch (e) {
        log(`error handling ${m.t}: ${(e as Error).message}`);
        err('server', 'Something went wrong');
      }
    });
    ws.on('close', () => {
      clearInterval(refill);
      if (conn?.room) conn.room.disconnect(conn.id);
    });
  });

  let lastTick = Date.now();
  const timer = setInterval(() => { const now = Date.now(); rooms.tick(Math.min(0.2, (now - lastTick) / 1000)); lastTick = now; }, 1000 / 30);

  function cleanCard(c: Partial<PlayerCard> | undefined): PlayerCard | null {
    if (!c || typeof c !== 'object') return null;
    const name = String(c.name ?? '').replace(/[^\w .-]/g, '').trim().slice(0, 16);
    if (name.length < 2) return null;
    const car = CARS.find((x) => x.id === c.carId) ? carById(String(c.carId)) : CARS[0];
    const lv = c.livery && typeof c.livery === 'object' ? c.livery : null;
    const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
    const livery = {
      paint: hex(lv?.paint, car.defaultPaint), finish: (['gloss', 'metallic', 'matte', 'pearl', 'chrome'].includes(lv?.finish as string) ? lv!.finish : 'metallic') as PlayerCard['livery']['finish'],
      wrap: (['none', 'stripes', 'naija', 'ankara', 'danfo', 'fire', 'checker', 'adire'].includes(lv?.wrap as string) ? lv!.wrap : 'none') as PlayerCard['livery']['wrap'],
      wrapColor: hex(lv?.wrapColor, '#111111'), rims: (['five', 'mesh', 'multi', 'turbine', 'dish', 'split'].includes(lv?.rims as string) ? lv!.rims : 'five') as PlayerCard['livery']['rims'],
      rimColor: hex(lv?.rimColor, '#c0c4c8'), glow: lv?.glow ? hex(lv.glow, '#00e5ff') : null, plate: String(lv?.plate ?? 'RUSH 001').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 9) || 'RUSH 001',
      tint: Math.min(1, Math.max(0, Number(lv?.tint ?? 0.6))),
    };
    return { id: '', name, crew: String(c.crew ?? '').slice(0, 24), color: hex(c.color, '#f6c514'), level: Math.min(99, Math.max(1, Math.round(Number(c.level ?? 1)))), carId: car.id, livery };
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { store.flush(); process.exit(0); });

  return new Promise<{ port: number; close: () => Promise<void>; rooms: Rooms; store: Store }>((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      log(`Lagos Rush server on http://localhost:${p}  (ws /ws, health /health)`);
      resolve({ port: p, rooms, store, close: () => new Promise((r) => { clearInterval(timer); store.flush(); wss.close(); server.close(() => r()); }) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void createServer();
