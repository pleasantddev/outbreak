// The room client: one WebSocket, automatic reconnect with the same identity, clock sync, and a snapshot buffer that
// lets other cars be drawn 100 ms in the past so they glide instead of jitter.
import type { App } from '../app/app';
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg, type RoomView, type RaceStart, type ResultRow, type RoomConfig, type PlayerCard, type SnapCar, type SnapHazard } from '../shared/protocol';
import type { NetLink } from '../game/session';
import type { RaceEvent, RemoteSnap } from '../shared/race';
import { currentCar, level } from '../app/profile';
import { wrapAngle } from '../shared/math';

export type NetStatus = 'offline' | 'connecting' | 'online' | 'error';
interface Snap { rt: number; cars: SnapCar[]; hz: SnapHazard[] }

export class NetClient {
  ws: WebSocket | null = null;
  status: NetStatus = 'offline';
  you = '';
  room: RoomView | null = null;
  chat: { name: string; phrase: number; at: number }[] = [];
  online = { rooms: 0, players: 0 };
  offset = 0; rtt = 0;
  race: RaceStart | null = null;
  results: ResultRow[] | null = null;
  private snaps: Snap[] = [];
  private events: RaceEvent[] = [];
  private pingT = 0; private retry = 0; private retryT = 0; private wanted = false;
  private pending: ClientMsg[] = [];
  lastError = '';
  private listeners = new Set<() => void>();

  constructor(private app: App) {}

  get url() {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
    const dev = location.port === '5174' || location.port === '5173';
    if (dev) return `ws://${location.hostname}:8787/ws`;
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }
  get serverNow() { return Date.now() + this.offset; }
  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private changed() { for (const l of this.listeners) l(); }

  card(): PlayerCard {
    const p = this.app.profile, car = currentCar(p);
    return { id: p.id, name: p.name, crew: p.crew, color: p.color, level: level(p).level, carId: car.carId, livery: car.livery };
  }

  connect() {
    this.wanted = true;
    if (this.ws && (this.status === 'online' || this.status === 'connecting')) return;
    this.status = 'connecting'; this.changed();
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { this.status = 'error'; this.lastError = 'Could not reach the race server'; this.changed(); return; }
    this.ws = ws;
    ws.onopen = () => {
      const token = (() => { try { return localStorage.getItem('lagosrush.token') ?? undefined; } catch { return undefined; } })();
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, card: this.card(), token } satisfies ClientMsg));
    };
    ws.onmessage = (e) => { let m: ServerMsg; try { m = JSON.parse(e.data); } catch { return; } this.onMsg(m); };
    ws.onclose = () => {
      const was = this.status;
      this.ws = null;
      this.status = this.wanted ? 'connecting' : 'offline';
      if (was === 'online' && this.app.session && this.race) this.app.toast('Connection lost. Reconnecting...');
      if (this.wanted) { this.retry++; this.retryT = Math.min(8, 0.5 * 2 ** this.retry); }
      this.changed();
    };
    ws.onerror = () => { this.lastError = 'Could not reach the race server'; };
  }
  disconnect() { this.wanted = false; this.ws?.close(); this.ws = null; this.status = 'offline'; this.room = null; this.changed(); }

  send(m: ClientMsg) {
    if (this.ws && this.status === 'online' && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (m.t !== 'state' && m.t !== 'ping') { this.pending.push(m); this.connect(); }
  }

  private onMsg(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.you = m.you; this.status = 'online'; this.retry = 0; this.online = m.online;
        try { localStorage.setItem('lagosrush.token', m.token); } catch { /* private mode */ }
        this.offset = m.now - Date.now();
        for (const p of this.pending.splice(0)) this.send(p);
        break;
      case 'pong': { const now = Date.now(); this.rtt = now - m.ct; const est = m.st + this.rtt / 2 - now; this.offset = this.offset * 0.8 + est * 0.2; break; }
      case 'room': {
        const prev = this.room?.phase;
        this.room = m.room;
        if (prev && prev !== 'waiting' && m.room.phase === 'waiting' && this.app.session && this.race) { /* next race opens after results */ }
        break;
      }
      case 'left': this.room = null; this.race = null; if (m.reason === 'kicked') this.app.toast('The host removed you from the room'); break;
      case 'race':
        this.race = m.race; this.snaps = []; this.events = []; this.results = null;
        this.app.startOnline(m.race);
        break;
      case 'snap':
        this.snaps.push({ rt: m.rt, cars: m.cars, hz: m.hz });
        if (this.snaps.length > 40) this.snaps.shift();
        break;
      case 'ev': this.events.push(...m.events); break;
      case 'results': this.results = m.rows; this.app.onlineResults(m.rows); break;
      case 'chat': this.chat.push({ name: m.name, phrase: m.phrase, at: Date.now() }); if (this.chat.length > 30) this.chat.shift(); break;
      case 'error': this.lastError = m.msg; this.app.toast(m.msg); break;
      case 'queued': break;
    }
    this.changed();
  }

  tick(dt: number) {
    if (this.wanted && !this.ws && this.status !== 'online') { this.retryT -= dt; if (this.retryT <= 0) this.connect(); }
    if (this.status !== 'online') return;
    this.pingT -= dt;
    if (this.pingT <= 0) { this.pingT = this.race ? 1 : 3; this.send({ t: 'ping', ct: Date.now() }); }
  }

  // ------------------------------------------------------------------------------------------- race glue

  /** Other cars at race time `rt`, interpolated between snapshots (or briefly extrapolated after a gap). */
  remoteAt(rt: number, skip: number): Map<number, RemoteSnap> {
    const out = new Map<number, RemoteSnap>();
    const s = this.snaps;
    if (!s.length) return out;
    let a = s[0], b = s[s.length - 1];
    for (let i = 0; i < s.length - 1; i++) if (s[i].rt <= rt && s[i + 1].rt >= rt) { a = s[i]; b = s[i + 1]; break; }
    const span = b.rt - a.rt;
    const f = span > 1e-4 ? Math.min(1.25, Math.max(0, (rt - a.rt) / span)) : 0;
    const ext = rt > b.rt ? Math.min(0.25, rt - b.rt) : 0;
    for (const cb of b.cars) {
      if (cb.i === skip) continue;
      const ca = a.cars.find((c) => c.i === cb.i) ?? cb;
      const A = ca.s, B = cb.s;
      const r: RemoteSnap = ext > 0
        ? { ...B, x: B.x + B.vx * ext, z: B.z + B.vz * ext, y: B.y + B.vy * ext }
        : { ...B, x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, z: A.z + (B.z - A.z) * f, h: A.h + wrapAngle(B.h - A.h) * f, vx: A.vx + (B.vx - A.vx) * f, vy: A.vy + (B.vy - A.vy) * f, vz: A.vz + (B.vz - A.vz) * f };
      out.set(cb.i, r);
    }
    return out;
  }
  latestHazards() { return this.snaps.length ? this.snaps[this.snaps.length - 1].hz : []; }
  drainEvents() { const e = this.events; this.events = []; return e; }
  /** Our own car as the room last saw it: used to rejoin a race after a reload, a dropped line or a hidden tab. */
  selfSnap(idx: number) { const s = this.snaps[this.snaps.length - 1]; return s ? s.cars.find((c) => c.i === idx) ?? null : null; }

  /** The narrow interface a race session needs, so the session never depends on the socket itself. */
  link(race: RaceStart): NetLink {
    return {
      raceNo: race.raceNo, startAt: race.startAt,
      serverNow: () => this.serverNow,
      remoteAt: (rt, skip) => this.remoteAt(rt, skip),
      hazards: () => this.latestHazards(),
      drain: () => this.drainEvents(),
      self: (idx) => this.selfSnap(idx),
      sendState: (rt, s) => this.send({ t: 'state', rt: Math.round(rt * 1000) / 1000, s }),
      useItem: () => this.send({ t: 'useItem' }),
      online: () => this.status === 'online',
    };
  }

  // ------------------------------------------------------------------------------------------- room actions
  quickMatch() { this.send({ t: 'quick' }); }
  createRoom(config: Partial<RoomConfig>) { this.send({ t: 'create', config }); }
  joinRoom(code: string) { this.send({ t: 'join', code }); }
  leave() { this.send({ t: 'leave' }); this.room = null; this.race = null; this.changed(); }
  ready(on: boolean) { this.send({ t: 'ready', on }); }
  pushCar() { const c = this.card(); this.send({ t: 'setCar', carId: c.carId, livery: c.livery }); }
  config(patch: Partial<RoomConfig>) { this.send({ t: 'config', patch }); }
  kick(id: string) { this.send({ t: 'kick', id }); }
  say(phrase: number) { this.send({ t: 'chat', phrase }); }
  start() { this.send({ t: 'start' }); }
  inviteLink(code: string) { return `${location.origin}${location.pathname}?room=${code}`; }
}
