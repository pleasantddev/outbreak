// Multiplayer client core: where the server is, who you are, REST, the socket, the wallet and land. No rendering in here.
// Offline single player never touches this: `net.serverMode` is false unless ?server= (or a saved server) is present.
import { ProfileExistsError, type Profile, type ProfileDraft, type ProfileStore } from '../profile';
import { PROTOCOL_VERSION, decodeSnapshot, encodeState, type Ent, type ServerMsg, type SnapResult, type StateMsg, type WhoInfo } from './protocol';

const K_SERVER = 'hustlelife.server', K_TOKEN = 'hustlelife.token', K_GUEST = 'hustlelife.guest';

export interface ServerAddr { http: string; ws: string; label: string }
/** Accepts ws://host:port, wss://host, http(s)://host or bare host:port. */
export function parseServerParam(raw: string | null | undefined): ServerAddr | null {
  if (!raw) return null; let s = raw.trim(); if (!s || s === 'off' || s === 'none' || s === '0') return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = (/^(localhost|127\.|192\.168\.|10\.)/.test(s) ? 'ws://' : 'wss://') + s;
  try {
    const u = new URL(s); const secure = u.protocol === 'wss:' || u.protocol === 'https:';
    if (!/^(ws|wss|http|https):$/.test(u.protocol)) return null;
    const host = u.host; const base = u.pathname.replace(/\/(ws)?\/?$/, '');
    return { http: `${secure ? 'https' : 'http'}://${host}${base}`, ws: `${secure ? 'wss' : 'ws'}://${host}${base}/ws`, label: host };
  } catch { return null; }
}
function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* blocked */ } }

export class ApiError extends Error { constructor(public status: number, message: string, public data: Record<string, any> = {}) { super(message); } }
export interface AccountInfo { id: string; email: string | null; phone: string | null; guest: boolean; role: string }
export interface Welcome { id: number; tickHz: number; serverTime: number; epoch: number; wallet: { cash: number; bank: number }; plots: string[]; online: number; profile: any; role: string; state: Record<string, any>; motd?: string }
export type Ack = { n: number; ok: boolean; err?: string; cash?: number; bank?: number; [k: string]: any };

type Fn = (...a: any[]) => void;
/** the bits of the game's local state that the server now owns */
export interface LocalState { bank: number; owned: string[]; ownedPts: Record<string, number[]>; [k: string]: any }

function readServer(): ServerAddr | null {
  let q: string | null = null; try { q = new URLSearchParams(location.search).get('server'); } catch { /* no location */ }
  if (q !== null) { const a = parseServerParam(q); lsSet(K_SERVER, a ? q : null); return a; }
  return parseServerParam(lsGet(K_SERVER));
}

export class NetClient {
  readonly server: ServerAddr | null = readServer();
  readonly serverMode = this.server !== null;
  state: 'idle' | 'connecting' | 'online' | 'reconnecting' | 'closed' = 'idle';
  token = lsGet(K_TOKEN); account: AccountInfo | null = null;
  welcome: Welcome | null = null; myId = 0; name = '';
  wallet = { cash: 0, bank: 0 }; local: LocalState | null = null;
  plotOwners = new Map<string, { owner: string; name: string | null }>();
  online = 0; rtt = 0; offset = 0; offsetSet = false; epochOffset = 0;
  known = new Map<number, Ent>(); who = new Map<number, WhoInfo>();
  lastAck = 0; kickReason = ''; motd = '';
  private ws: WebSocket | null = null; private listeners = new Map<string, Set<Fn>>();
  private actN = 0; private acts = new Map<number, { res: (a: Ack) => void; t: number }>();
  private pending: { n: number; d: number }[] = []; lastCash = 0; private cashSync = false;
  private backoff = 1000; private reconnectT: number | null = null; private pingT: number | null = null; private pingSent = new Map<number, number>(); private pingN = 0;
  bytesIn = 0; bytesOut = 0; private bytesWindow = { t: performance.now(), in: 0, out: 0 }; kbpsIn = 0; kbpsOut = 0;

  get active() { return this.state === 'online'; }
  get serverNow() { return performance.now() + this.offset; }
  /** unix milliseconds on the server's clock: the shared clock for time of day and weather */
  get epochNow() { return performance.now() + this.epochOffset; }
  on(ev: string, f: Fn) { let s = this.listeners.get(ev); if (!s) this.listeners.set(ev, (s = new Set())); s.add(f); return () => s!.delete(f); }
  private emit(ev: string, ...a: unknown[]) { for (const f of this.listeners.get(ev) ?? []) { try { f(...a); } catch (e) { console.error('[net]', ev, e); } } }
  attachState(s: LocalState) { this.local = s; }

  // ------------------------------------------------------------------------------------------ REST
  async api<T = any>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    if (!this.server) throw new ApiError(0, 'No server configured.');
    let r: Response;
    try {
      r = await fetch(this.server.http + path, { method, headers: { 'Content-Type': 'application/json', ...(auth && this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new ApiError(0, 'Cannot reach the server. Check your connection.'); }
    const text = await r.text(); let data: any = {}; try { data = text ? JSON.parse(text) : {}; } catch { /* not json */ }
    if (!r.ok) throw new ApiError(r.status, data.error ?? `Server said ${r.status}`, data);
    return data as T;
  }
  private setSession(r: { token: string; account: AccountInfo; guestKey?: string }) {
    this.token = r.token; this.account = r.account; lsSet(K_TOKEN, r.token); if (r.guestKey) lsSet(K_GUEST, r.guestKey);
  }
  async health() { return this.api('GET', '/api/health', undefined, false); }
  /** true when the stored token is still good */
  async resume(): Promise<boolean> {
    if (!this.token) return false;
    try { const r = await this.api<{ account: AccountInfo }>('GET', '/api/auth/me'); this.account = r.account; return true; }
    catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { this.token = null; lsSet(K_TOKEN, null); if (e.status === 403) throw e; return false; } throw e; }
  }
  async signup(identifier: string, password: string) { this.setSession(await this.api('POST', '/api/auth/signup', { identifier, password }, false)); }
  async login(identifier: string, password: string) { this.setSession(await this.api('POST', '/api/auth/login', { identifier, password }, false)); }
  async guest() { this.setSession(await this.api('POST', '/api/auth/guest', { guestKey: lsGet(K_GUEST) ?? undefined }, false)); }
  async upgrade(identifier: string, password: string) { const r = await this.api<{ account: AccountInfo }>('POST', '/api/auth/upgrade', { identifier, password }); this.account = r.account; lsSet(K_GUEST, null); }
  async logout() { try { await this.api('POST', '/api/auth/logout', {}); } catch { /* already gone */ } this.token = null; this.account = null; lsSet(K_TOKEN, null); this.close(true); }

  profileStore(): ProfileStore { return new ServerProfileStore(this); }

  // ------------------------------------------------------------------------------------------ socket
  connect(): Promise<Welcome> {
    if (!this.server || !this.token) return Promise.reject(new Error('not signed in'));
    if (this.state === 'online' && this.welcome) return Promise.resolve(this.welcome);
    return new Promise((resolve, reject) => {
      this.state = this.state === 'reconnecting' ? 'reconnecting' : 'connecting';
      let done = false;
      const ws = new WebSocket(this.server!.ws); ws.binaryType = 'arraybuffer'; this.ws = ws;
      const t = window.setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch { /* */ } reject(new Error('timeout')); } }, 9000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: this.token, v: PROTOCOL_VERSION }));
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') { this.onBinary(new Uint8Array(ev.data as ArrayBuffer)); return; }
        this.bytesIn += ev.data.length; this.bytesWindow.in += ev.data.length;
        let m: ServerMsg; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome' && !done) { done = true; clearTimeout(t); resolve(this.onWelcome(m as any)); return; }
        this.onJson(m);
      };
      ws.onclose = (ev) => {
        clearTimeout(t); if (this.ws === ws) this.ws = null;
        if (!done) { done = true; reject(new Error(ev.reason || 'closed')); return; }
        this.onClosed(ev.code, ev.reason);
      };
      ws.onerror = () => { /* close follows */ };
    });
  }
  private onWelcome(w: Welcome & { t: 'welcome' }): Welcome {
    this.welcome = w; this.myId = w.id; this.state = 'online'; this.backoff = 1000; this.online = w.online; this.motd = w.motd ?? '';
    this.offset = w.serverTime - performance.now(); this.offsetSet = true; this.epochOffset = (w.epoch ?? Date.now()) - performance.now();
    this.known.clear(); this.who.clear(); this.name = w.profile?.name ?? '';
    this.setWallet(w.wallet.cash, w.wallet.bank);
    if (this.local) { this.local.owned = [...w.plots]; }
    if (this.pingT === null) this.pingT = window.setInterval(() => this.ping(), 2500);
    this.ping();
    this.emit('welcome', w);
    return w;
  }
  private ping() { const n = ++this.pingN; this.pingSent.set(n, performance.now()); this.send({ t: 'ping', c: n }); if (this.pingSent.size > 20) this.pingSent.delete(this.pingSent.keys().next().value!); }
  private onBinary(b: Uint8Array) {
    this.bytesIn += b.length; this.bytesWindow.in += b.length;
    const r: SnapResult | null = decodeSnapshot(b, this.known); if (!r) return;
    this.lastAck = r.ack; this.emit('snapshot', r);
  }
  private onJson(m: ServerMsg) {
    switch (m.t) {
      case 'pong': {
        const sent = this.pingSent.get(m.c); if (sent === undefined) break; this.pingSent.delete(m.c);
        const now = performance.now(); const rtt = now - sent; this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
        const off = m.s + rtt / 2 - now; // keep the sample from the quickest round trips: they are the least skewed
        this.offset = !this.offsetSet || rtt <= this.rtt * 1.2 ? this.offset * 0.8 + off * 0.2 : this.offset; this.offsetSet = true; break;
      }
      case 'who': for (const w of m.list) this.who.set(w.id, w); this.emit('who', m.list); break;
      case 'ack': {
        const a = this.acts.get(m.n); if (a) { this.acts.delete(m.n); a.res(m as Ack); }
        this.pending = this.pending.filter((p) => p.n > m.n);
        if (typeof m.cash === 'number' && typeof m.bank === 'number') this.setWallet(m.cash, m.bank, true);
        break;
      }
      case 'wallet': this.setWallet(m.cash, m.bank, true); this.emit('wallet', m); break;
      case 'plot': if (m.owner) this.plotOwners.set(m.id, { owner: m.owner, name: m.ownerName }); else this.plotOwners.delete(m.id); this.emit('plot', m); break;
      case 'kick': this.kickReason = m.reason; this.emit('kick', m.reason); break;
      case 'fix': case 'chat': case 'emote': case 'toast': case 'content': case 'lobby': this.emit(m.t, m); break;
    }
  }
  private onClosed(code: number, reason: string) {
    if (this.pingT !== null) { clearInterval(this.pingT); this.pingT = null; }
    for (const [, a] of this.acts) a.res({ n: 0, ok: false, err: 'Connection lost.' }); this.acts.clear();
    this.known.clear();
    const fatal = [4401, 4403, 4404, 4409, 4410, 4426].includes(code) || !!this.kickReason;
    this.state = fatal ? 'closed' : 'reconnecting';
    this.emit('closed', code, reason || this.kickReason);
    if (!fatal) this.scheduleReconnect();
  }
  private scheduleReconnect() {
    if (this.reconnectT !== null) return;
    this.reconnectT = window.setTimeout(async () => {
      this.reconnectT = null;
      try { await this.connect(); } catch { this.backoff = Math.min(15000, this.backoff * 2); this.state = 'reconnecting'; this.scheduleReconnect(); }
    }, this.backoff);
  }
  close(final = false) { if (final) this.state = 'closed'; if (this.pingT !== null) { clearInterval(this.pingT); this.pingT = null; } try { this.ws?.close(); } catch { /* */ } this.ws = null; }
  send(m: object) { if (this.ws?.readyState === 1) { const s = JSON.stringify(m); this.bytesOut += s.length; this.bytesWindow.out += s.length; this.ws.send(s); return true; } return false; }
  sendState(m: StateMsg) { if (this.ws?.readyState !== 1) return; const b = encodeState(m); this.bytesOut += b.length; this.bytesWindow.out += b.length; this.ws.send(b); }
  /** bandwidth meter, call a few times a second */
  tickMeter() { const t = performance.now(), w = this.bytesWindow; if (t - w.t >= 2000) { this.kbpsIn = (w.in / 1024) / ((t - w.t) / 1000); this.kbpsOut = (w.out / 1024) / ((t - w.t) / 1000); w.t = t; w.in = 0; w.out = 0; } }

  /** Ask the server to do something with money, land or state. Resolves with its answer (never rejects). */
  act(a: string, args: Record<string, unknown> = {}): Promise<Ack> {
    const n = ++this.actN;
    return new Promise((res) => {
      if (!this.send({ t: 'act', n, a, ...args })) { res({ n, ok: false, err: 'Not connected.' }); return; }
      this.acts.set(n, { res, t: performance.now() });
      window.setTimeout(() => { if (this.acts.delete(n)) res({ n, ok: false, err: 'The server took too long.' }); }, 8000);
    });
  }

  // ------------------------------------------------------------------------------------------ wallet and cash sync
  /** the sim owns `sim.cash`; this keeps it equal to the server's number plus whatever the player has done since it last heard */
  onCash: ((cash: number) => void) | null = null; getCash: (() => number) | null = null;
  setWallet(cash: number, bank: number, _fromServer = false) {
    this.wallet = { cash, bank };
    const unacked = this.pending.reduce((s, p) => s + p.d, 0);
    this.lastCash = cash + unacked; this.cashSync = true;
    this.onCash?.(this.lastCash);
    if (this.local) this.local.bank = bank;
  }
  /** call every sim step: ships changes the local simulation made to sim.cash (fines, loot) as deltas the server judges */
  watchCash() {
    if (!this.cashSync || !this.getCash || !this.active) return;
    const c = this.getCash(); if (c === this.lastCash) return;
    const d = c - this.lastCash; this.lastCash = c;
    const n = this.actN + 1; this.pending.push({ n, d });
    void this.act('cash.delta', { d, why: d > 0 ? 'loot' : 'spend' });
  }
  async buyPlot(plot: { id: string; cx: number; cz: number; area: number; zone: string; rich: number; pts: ArrayLike<number> }) {
    const r = await this.act('plot.buy', { id: plot.id, cx: plot.cx, cz: plot.cz, area: plot.area, zone: plot.zone, rich: plot.rich, pts: Array.from(plot.pts).map((v) => Math.round(v * 10) / 10) });
    if (r.ok && this.local) { if (!this.local.owned.includes(plot.id)) this.local.owned.push(plot.id); this.local.ownedPts[plot.id] = Array.from(plot.pts).map((v) => Math.round(v * 10) / 10); }
    return r;
  }
  bank(kind: 'deposit' | 'withdraw', amount: number) { return this.act(`bank.${kind}`, { amount }); }
  jobStart(id: string) { if (this.active) void this.act('job.start', { id }); }
  jobDone(id: string) { return this.act('job.done', { id }); }
  shopBuy(sku: string, qty = 1) { return this.act('shop.buy', { sku, qty }); }
  transfer(to: string, amount: number) { return this.act('cash.transfer', { to, amount }); }
  /** the player was moved by the game (respawn, fast travel): the next position report may jump */
  teleported() { if (this.active) void this.act('tp'); }

  plotOwnerName(id: string): string | null { return this.plotOwners.get(id)?.name ?? null; }
  isMyPlot(id: string) { const o = this.plotOwners.get(id); return !!o && o.owner === this.account?.id; }
  async refreshOwners(x: number, z: number, r = 1800) {
    if (!this.server) return;
    try {
      const j = await this.api<{ items: { id: string; owner: string; ownerName: string | null }[] }>('GET', `/api/world/plots?minx=${Math.round(x - r)}&maxx=${Math.round(x + r)}&minz=${Math.round(z - r)}&maxz=${Math.round(z + r)}`, undefined, false);
      for (const p of j.items) this.plotOwners.set(p.id, { owner: p.owner, name: p.ownerName });
    } catch { /* best effort */ }
  }
  /** save a system's own state key to the account */
  putState(key: string, value: unknown) { return this.act('state.put', { key, value }); }
}

/** The account's profile, over REST. Same contract as LocalProfileStore. */
export class ServerProfileStore implements ProfileStore {
  constructor(private net: NetClient) {}
  async accountId() { return this.net.account?.id ?? ''; }
  async exists() { return (await this.load()) !== null; }
  async load(): Promise<Profile | null> {
    try { return await this.net.api<Profile>('GET', '/api/profile'); } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
  }
  async create(d: ProfileDraft): Promise<Profile> {
    try { return await this.net.api<Profile>('POST', '/api/profile', d); } catch (e) { if (e instanceof ApiError && e.data.code === 'profile_exists') throw new ProfileExistsError(); throw e; }
  }
  async update(patch: Partial<Omit<Profile, 'v' | 'accountId' | 'createdAt'>>): Promise<Profile> { return this.net.api<Profile>('PATCH', '/api/profile', patch); }
}

export const net = new NetClient();
