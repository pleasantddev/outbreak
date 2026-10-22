import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer, type Running } from '../src/main.ts';
import { F, PROTOCOL_VERSION, decodeSnapshot, encodeState, type Ent, type StateMsg } from '../../v2/src/net/protocol.ts';

export interface TestServer extends Running { url: string; ws: string; dir: string }
export async function boot(over: Record<string, unknown> = {}, seed: Record<string, unknown> = {}): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'hl-test-'));
  mkdirSync(join(dir, 'seed'), { recursive: true });
  for (const [k, v] of Object.entries(seed)) writeFileSync(join(dir, 'seed', `${k}.json`), JSON.stringify(v));
  process.env.DATA_DIR = dir; process.env.LOG_LEVEL = 'silent';
  const s = await startServer({ port: 0, host: '127.0.0.1', dbFile: ':memory:', seedContentDir: join(dir, 'seed'), contentDir: join(dir, 'content'), plotsFile: join(dir, 'none.bin'), tickHz: 30, rateScale: 1000, ...over } as never);
  return Object.assign(s, { url: `http://127.0.0.1:${s.port}`, ws: `ws://127.0.0.1:${s.port}/ws`, dir });
}

export async function http(s: TestServer, method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const r = await fetch(s.url + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, headers: r.headers, text };
}

/** sign up (or guest) and create a profile; returns the token */
export async function makePlayer(s: TestServer, name: string, opts: { email?: string; model?: string } = {}) {
  const email = opts.email ?? `${name.toLowerCase().replace(/\W/g, '')}@example.com`;
  const r = await http(s, 'POST', '/api/auth/signup', { identifier: email, password: 'hunter2hunter2' });
  if (r.status !== 200) throw new Error(`signup failed ${r.status} ${r.text}`);
  const p = await http(s, 'POST', '/api/profile', { name, model: opts.model ?? 'survivor', skin: 1, outfit: 'street' }, r.json.token);
  if (p.status !== 200) throw new Error(`profile failed ${p.status} ${p.text}`);
  return { token: r.json.token as string, accountId: r.json.account.id as string, email };
}

export class TestClient {
  ws!: WebSocket; msgs: any[] = []; known = new Map<number, Ent>(); who = new Map<number, any>(); id = 0; seq = 0; closed: { code: number; reason: string } | null = null;
  snaps = 0; lastAck = 0; welcome: any = null; bytes = 0;
  constructor(private s: TestServer, private token: string) {}
  async connect(): Promise<this> {
    this.ws = new WebSocket(this.s.ws);
    this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const b = new Uint8Array(data as ArrayBuffer); this.bytes += b.length;
        const r = decodeSnapshot(b, this.known); if (r) { this.snaps++; this.lastAck = r.ack; }
      } else {
        const m = JSON.parse(data.toString()); this.msgs.push(m); this.bytes += data.toString().length;
        if (m.t === 'welcome') { this.welcome = m; this.id = m.id; }
        if (m.t === 'who') for (const w of m.list) this.who.set(w.id, w);
      }
    });
    this.ws.on('close', (code, reason) => { this.closed = { code, reason: reason.toString() }; });
    await new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); });
    this.ws.send(JSON.stringify({ t: 'hello', token: this.token, v: PROTOCOL_VERSION }));
    await this.until(() => this.welcome || this.closed, 3000);
    return this;
  }
  state(x: number, z: number, over: Partial<StateMsg> = {}) {
    this.ws.send(encodeState({ seq: ++this.seq, flags: F.ALIVE | F.GROUND, x, y: 0.05, z, yaw: 0, pitch: 0, speed: 0, anim: 0, weapon: 0, veh: null, ...over }));
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  private actN = 0;
  async act(a: string, args: Record<string, unknown> = {}) {
    const n = ++this.actN; this.send({ t: 'act', n, a, ...args });
    await this.until(() => this.msgs.some((m) => m.t === 'ack' && m.n === n), 3000);
    return this.msgs.find((m) => m.t === 'ack' && m.n === n);
  }
  of(t: string) { return this.msgs.filter((m) => m.t === t); }
  async until(f: () => unknown, ms = 3000) { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting. msgs: ' + JSON.stringify(this.msgs.slice(-6))); await new Promise((r) => setTimeout(r, 10)); } }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}
