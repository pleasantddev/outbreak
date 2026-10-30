// The realtime hub: WebSocket connections, the world of live entities, snapshots with interest management, chat, and the
// economy actions a connected player may ask for.
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import type { Accounts, AccountRow, ProfileRow } from '../accounts.ts';
import { banState, publicProfile } from '../accounts.ts';
import type { Economy } from '../economy.ts';
import type { ContentStore } from '../content.ts';
import type { OnlineApi } from '../api.ts';
import { Businesses } from '../business.ts';
import { Grid as PowerGrid, FEEDERS } from '../grid.ts';
import { HttpError } from '../auth.ts';
import { run } from '../db.ts';
import type { DB } from '../db.ts';
import {
  ANIMS, CELL, EMOTES, F, PROTOCOL_VERSION, VEH_BIT, VF, beginSnapshot, cm, decodeState, endSnapshot, newPlayerEnt, newVehEnt, packDoors, packPitch, packQ, packSpin, packSteer, packYaw, writeEntity,
  Writer, type ClientMsg, type Ent, type PlayerEnt, type ServerMsg, type StateMsg, type VehEnt, type WhoInfo,
} from '../../../v2/src/net/protocol.ts';
import { randomInt } from 'node:crypto';
import { RaceLobbies } from './races.ts';
import { BjTable, slotSpin, roulettePays, ROULETTE_KEYS, SLOT_BETS, inInteriorZone } from '../../../v2/src/net/rules.ts';
import { cleanChat } from '../../../v2/src/net/rules.ts';
import { Grid, cellCoord, keyOf, type GridNode } from './grid.ts';
import { accept, judgeMove, newMoveState, strike, type MoveState } from './antiCheat.ts';

type PEnt = PlayerEnt & { k: 0 };
type VEnt = VehEnt & { k: 1 };

interface Node extends GridNode { kind: 'p' | 'v'; ent: Ent }
export interface Conn extends Node {
  kind: 'p'; ent: PEnt;
  ws: WebSocket; account: AccountRow; sid: string; profile: ProfileRow;
  since: number; role: string;
  ms: MoveState; lastSeq: number; haveState: boolean; lastStateAt: number;
  msgBudget: number; msgAt: number; stateBudget: number; stateAt: number; chatTimes: number[]; lastChat: string;
  known: Map<number, Ent>; knownWho: Set<number>;
  veh: VNode | null; lastSnapAt: number; saveAt: number; dead: boolean; alive: boolean; joinedAt: number; pong: boolean;
  skippedSnaps: number; bytesOut: number; bytesIn: number;
}
interface VNode extends Node { kind: 'v'; ent: VEnt; owner: Conn | null; ownerId: string; parkedAt: number; spawnedAt: number }

export interface HubStats { ticks: number; snapshots: number; bytesOut: number; bytesIn: number; tickMsAvg: number; tickMsMax: number; stateMsgs: number; rejected: number; dropsBackpressure: number }

const NEAR_RINGS_FULL_RATE = 1; // rings 0..1 update every tick, farther rings less often
const PARKED_LIMIT = 2;
const PARKED_TTL = 10 * 60_000;
const MAX_WS_PAYLOAD = 16 * 1024;

export class Hub implements OnlineApi {
  wss: WebSocketServer;
  conns = new Map<number, Conn>();
  byAccount = new Map<string, Conn>();
  vehicles = new Map<number, VNode>();
  grid = new Grid<Node>();
  private nextPid = 1; private nextVid = 1;
  private freePids: number[] = [];
  private tickN = 0; private timer: NodeJS.Timeout | null = null; private t0 = performance.now();
  private writer = new Writer(2048);
  readonly stats0: HubStats = { ticks: 0, snapshots: 0, bytesOut: 0, bytesIn: 0, tickMsAvg: 0, tickMsMax: 0, stateMsgs: 0, rejected: 0, dropsBackpressure: 0 };
  private pingTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  races: RaceLobbies;
  biz: Businesses; power = new PowerGrid(); private lastSwitch = new Map<string, number>();
  /** what the admin panel can steer in the game world */
  get world() { return { grid: this.power, biz: this.biz }; }
  constructor(private cfg: Config, private db: DB, private accounts: Accounts, private econ: Economy, private content: ContentStore, private log: Logger) {
    this.biz = new Businesses(db, econ);
    // light changes reach everybody at once; the shout goes to the feeders that just got light
    this.power.on('change', (st: ReturnType<PowerGrid['state']>, prev: string) => {
      this.broadcastJson({ t: 'grid', ...st });
      if (prev) for (const f of FEEDERS) if (st.on[f.i] === '1' && prev[f.i] === '0') this.log.info(`grid: ${f.name} on`);
    });
    this.races = new RaceLobbies({
      debit: (id, n, kind) => { this.econ.adjust(id, -n, 0, kind); }, credit: (id, n, kind) => { this.econ.adjust(id, n, 0, kind); },
      broadcast: (l, msg) => { for (const id of l.members.keys()) { const c = this.byAccount.get(id); if (c) this.send(c, { ...msg, startIn: l.startAt ? l.startAt - performance.now() : 0 } as any); } },
      flag: (id, what, info) => this.econ.flag(id, what, info), now: () => performance.now(),
    });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD, perMessageDeflate: false });
    econ.on('wallet', (w: { accountId: string; cash: number; bank: number; why: string }) => { const c = this.byAccount.get(w.accountId); if (c) this.send(c, { t: 'wallet', cash: w.cash, bank: w.bank, why: w.why }); });
    econ.on('plot', (p: { id: string; ownerId: string | null; ownerName: string | null }) => this.broadcastJson({ t: 'plot', id: p.id, owner: p.ownerId, ownerName: p.ownerName }));
    accounts.on('ban', (a: AccountRow, b: { reason: string }) => this.kick(a.id, `Banned: ${b.reason}`));
    accounts.on('profile', (p: ProfileRow) => { const c = this.byAccount.get(p.account_id); if (c) { c.profile = p; this.announceWho(c); } });
    content.on('changed', (c: { kind: string; etag: string }) => this.broadcastJson({ t: 'content', kind: c.kind, etag: c.etag }));
  }

  now() { return Math.floor(performance.now() - this.t0); }
  start() {
    const period = 1000 / this.cfg.tickHz; let next = performance.now() + period;
    const loop = () => {
      const t = performance.now(); try { this.tick(); } catch (e) { this.log.error('tick failed', e); }
      const dur = performance.now() - t; const s = this.stats0; s.tickMsAvg = s.tickMsAvg * 0.95 + dur * 0.05; s.tickMsMax = Math.max(s.tickMsMax * 0.999, dur);
      next += period; const wait = next - performance.now();
      if (wait < -period * 4) next = performance.now() + period; // fell far behind: do not spiral
      this.timer = setTimeout(loop, Math.max(0, wait));
    };
    this.timer = setTimeout(loop, period);
    this.pingTimer = setInterval(() => this.heartbeat(), 15_000);
    this.saveTimer = setInterval(() => this.saveAll(), 20_000);
  }
  async stop() {
    if (this.timer) clearTimeout(this.timer); if (this.pingTimer) clearInterval(this.pingTimer); if (this.saveTimer) clearInterval(this.saveTimer);
    this.saveAll();
    for (const c of this.conns.values()) { try { c.ws.close(1001, 'Server restarting'); } catch { /* gone */ } }
    await new Promise<void>((r) => this.wss.close(() => r()));
  }

  attach(server: Server) {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = (req.url ?? '').split('?')[0];
      if (path !== '/ws' && path !== '/ws/') { socket.destroy(); return; }
      if (this.conns.size >= this.cfg.maxPlayers) { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnect(ws, req));
    });
  }

  // ------------------------------------------------------------------------------------------ connect
  private onConnect(ws: WebSocket, req: IncomingMessage) {
    let conn: Conn | null = null;
    const ip = (this.cfg.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';
    const timeout = setTimeout(() => { if (!conn) ws.close(4000, 'Hello timeout'); }, 10_000);
    let busy = false;
    ws.on('message', (data, isBinary) => {
      try {
        if (!conn) {
          if (isBinary || busy) return; busy = true;
          let msg: ClientMsg; try { msg = JSON.parse(data.toString()); } catch { ws.close(4400, 'Bad hello'); return; }
          if (msg.t !== 'hello') { ws.close(4400, 'Expected hello'); return; }
          clearTimeout(timeout);
          const c = this.admit(ws, msg, ip); if (!c) return; conn = c;
          return;
        }
        if (isBinary) this.onBinary(conn, data as Buffer); else this.onJson(conn, data.toString());
      } catch (e) { this.log.warn('message failed', e); }
    });
    ws.on('pong', () => { if (conn) conn.pong = true; });
    ws.on('close', () => { clearTimeout(timeout); if (conn) this.drop(conn); });
    ws.on('error', () => { /* close follows */ });
  }

  private admit(ws: WebSocket, hello: Extract<ClientMsg, { t: 'hello' }>, _ip: string): Conn | null {
    const reject = (code: number, why: string) => { try { ws.send(JSON.stringify({ t: 'kick', reason: why })); } catch { /* ignore */ } ws.close(code, why.slice(0, 120)); return null; };
    if (hello.v !== PROTOCOL_VERSION) return reject(4426, 'Your game is out of date. Refresh the page.');
    const auth = this.accounts.authenticate(String(hello.token ?? ''));
    if (!auth) return reject(4401, 'Sign in again.');
    const b = banState(auth.account); if (b.banned) return reject(4403, `Banned: ${b.reason}`);
    const profile = this.accounts.profile(auth.account.id);
    if (!profile) return reject(4404, 'Create your hustler first.');
    // one connection per account: the newer one wins
    const old = this.byAccount.get(auth.account.id); if (old) { this.send(old, { t: 'kick', reason: 'You signed in somewhere else.' }); old.ws.close(4409, 'Signed in elsewhere'); this.drop(old); }
    const id = this.freePids.pop() ?? this.nextPid++; if (id >= VEH_BIT) return reject(4503, 'Server full');
    const last = this.econ.lastPosition(auth.account.id);
    const now = performance.now();
    const ent = newPlayerEnt(id);
    const c = {
      kind: 'p', id, x: 0, z: 0, cx: 0, cz: 0, key: -1, ent, ws, account: auth.account, sid: auth.sid, profile, since: Date.now(), role: auth.account.role,
      ms: newMoveState(last?.x ?? 0, last?.y ?? 0, last?.z ?? 0, now), lastSeq: 0, haveState: false, lastStateAt: now, msgBudget: 30, msgAt: now, stateBudget: 40, stateAt: now, chatTimes: [], lastChat: '',
      known: new Map(), knownWho: new Set(), veh: null, lastSnapAt: 0, saveAt: now, dead: false, alive: true, joinedAt: now, pong: true, skippedSnaps: 0, bytesOut: 0, bytesIn: 0,
    } as unknown as Conn;
    this.conns.set(id, c); this.byAccount.set(auth.account.id, c);
    if (last) { ent.X = cm(last.x); ent.Y = cm(last.y); ent.Z = cm(last.z); this.grid.put(c, last.x, last.z); }
    const w = this.econ.wallet(auth.account.id);
    const st = this.econ.state(auth.account.id);
    this.send(c, {
      t: 'welcome', id, v: PROTOCOL_VERSION, tickHz: this.cfg.tickHz, serverTime: this.now(), epoch: Date.now(), cell: CELL, wallet: w, plots: this.econ.plotsOf(auth.account.id).map((p) => p.id),
      online: this.conns.size, profile: publicProfile(profile), role: auth.account.role, motd: this.cfg.motd, grid: this.power.state(),
      state: { ...st.blobs, vehicles: st.vehicles, skills: st.skills, missions: st.missions, pos: last },
    });
    this.log.info(`join ${profile.name} (#${id}) online=${this.conns.size}`);
    this.systemChat(`${profile.name} is on the streets.`, c);
    return c;
  }

  private drop(c: Conn) {
    if (c.dead) return; c.dead = true;
    try { this.races.leave(c.account.id); } catch { /* not racing */ }
    this.conns.delete(c.id); if (this.byAccount.get(c.account.id) === c) this.byAccount.delete(c.account.id);
    this.grid.remove(c);
    if (c.veh) this.removeVehicle(c.veh);
    for (const v of [...this.vehicles.values()]) if (v.owner === c) this.removeVehicle(v);
    this.freePids.push(c.id);
    try { if (c.haveState) { const p = this.outdoorPos(c); this.econ.savePosition(c.account.id, p.x, c.ms.y, p.z, (performance.now() - c.joinedAt) / 1000); } } catch (e) { this.log.warn('save failed', e); }
    this.log.info(`leave ${c.profile.name} (#${c.id}) online=${this.conns.size}`);
  }

  // ------------------------------------------------------------------------------------------ inbound
  private onBinary(c: Conn, data: Buffer) {
    c.bytesIn += data.length; this.stats0.bytesIn += data.length;
    const now = performance.now();
    c.stateBudget = Math.min(40, c.stateBudget + (now - c.stateAt) / 1000 * 30); c.stateAt = now;
    if (c.stateBudget < 1) { this.stats0.rejected++; return; } c.stateBudget -= 1;
    const m = decodeState(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (!m) { this.stats0.rejected++; return; }
    this.stats0.stateMsgs++;
    // sequence: ignore anything that arrived out of order
    if (c.haveState && ((m.seq - c.lastSeq) & 0xffff) > 0x8000) return;
    if (now < c.ms.fixUntil) return; // client has not applied our correction yet
    const mode = this.cfg.antiCheat;
    if (c.haveState && mode !== 'off') {
      const v = judgeMove(c.ms, m, now, this.cfg.mapBounds);
      if (!v.ok) {
        this.stats0.rejected++;
        const kick = strike(c.ms, now, v.hard ? 3 : 1, 10);
        this.econ.flag(c.account.id, `move-${v.reason}`, { x: Math.round(m.x), z: Math.round(m.z), from: [Math.round(c.ms.x), Math.round(c.ms.z)] });
        if (mode === 'enforce') {
          c.ms.fixUntil = now + 300;
          this.send(c, { t: 'fix', x: c.ms.x, y: c.ms.y, z: c.ms.z, seq: c.lastSeq, why: v.reason });
          if (kick) { this.send(c, { t: 'kick', reason: 'Movement not allowed.' }); c.ws.close(4410, 'cheat'); this.drop(c); }
          return;
        }
      }
    }
    this.applyState(c, m, now);
  }

  private applyState(c: Conn, m: StateMsg, now: number) {
    c.lastSeq = m.seq; c.lastStateAt = now;
    if (!c.haveState) { c.haveState = true; c.ms.x = m.x; c.ms.y = m.y; c.ms.z = m.z; c.ms.at = now; } else accept(c.ms, m, now);
    const e = c.ent;
    e.X = cm(m.x); e.Y = cm(m.y); e.Z = cm(m.z); e.yaw = packYaw(m.yaw); e.pitch = packPitch(m.pitch);
    e.anim = Math.min(m.anim, ANIMS.length - 1); e.speed = Math.max(0, Math.min(255, Math.round(m.speed * 4))); e.flags = m.flags & 0x7ff; e.weapon = m.weapon;
    c.alive = (m.flags & F.ALIVE) !== 0;
    if (m.veh) {
      let v = c.veh;
      const kindChanged = v && (v.ent.kind !== m.veh.kind || v.ent.seed !== (m.veh.seed >>> 0));
      if (v && kindChanged) { this.removeVehicle(v); v = null; }
      if (!v) v = c.veh = this.addVehicle(c, m.veh.kind, m.veh.seed >>> 0);
      const ve = v.ent;
      ve.X = cm(m.veh.x); ve.Y = cm(m.veh.y); ve.Z = cm(m.veh.z);
      ve.qx = packQ(m.veh.qx); ve.qy = packQ(m.veh.qy); ve.qz = packQ(m.veh.qz); ve.qw = packQ(m.veh.qw);
      ve.steer = packSteer(m.veh.steer); ve.spin = packSpin(m.veh.spin); ve.doors = packDoors(m.veh.doors); ve.vflags = m.veh.vflags & 0x3f; ve.vspeed = Math.round(m.veh.vspeed * 100);
      ve.driver = m.veh.seat === 0 ? c.id : 0; v.parkedAt = 0;
      e.veh = ve.id; e.seat = m.veh.seat;
      this.grid.put(v, m.veh.x, m.veh.z);
    } else if (c.veh) {
      // got out: the car stays where it is for a while, as a parked vehicle others can see
      const v = c.veh; c.veh = null; v.parkedAt = Date.now(); v.ent.driver = 0; v.ent.vflags &= ~(VF.LIGHTS | VF.HORN | VF.DRIVEN | VF.BRAKE); v.ent.vspeed = 0;
      e.veh = 0; e.seat = 0;
      const parked = [...this.vehicles.values()].filter((x) => x.owner === c && x.parkedAt).sort((a, b) => a.parkedAt - b.parkedAt);
      while (parked.length > PARKED_LIMIT) this.removeVehicle(parked.shift()!);
    }
    this.grid.put(c, m.x, m.z);
  }

  private addVehicle(c: Conn, kind: number, seed: number): VNode {
    const id = VEH_BIT | (this.nextVid++ & 0x7fff);
    if (this.nextVid > 0x7ffe) this.nextVid = 1;
    while (this.vehicles.has(id)) { /* extremely unlikely wrap collision */ return this.addVehicle(c, kind, seed); }
    const ent = newVehEnt(id) as VEnt; ent.kind = kind; ent.seed = seed;
    const v = { kind: 'v', id, x: 0, z: 0, cx: 0, cz: 0, key: -1, ent, owner: c, ownerId: c.account.id, parkedAt: 0, spawnedAt: Date.now() } as VNode;
    this.vehicles.set(id, v); return v;
  }
  private removeVehicle(v: VNode) { this.vehicles.delete(v.id); this.grid.remove(v); const o = v.owner; if (o && o.veh === v) { o.veh = null; o.ent.veh = 0; } }

  private onJson(c: Conn, text: string) {
    c.bytesIn += text.length; this.stats0.bytesIn += text.length;
    const now = performance.now();
    c.msgBudget = Math.min(30, c.msgBudget + (now - c.msgAt) / 1000 * 15); c.msgAt = now;
    if (c.msgBudget < 1) { this.stats0.rejected++; return; } c.msgBudget -= 1;
    if (text.length > 4000) return;
    let m: ClientMsg; try { m = JSON.parse(text); } catch { return; }
    switch (m.t) {
      case 'ping': this.send(c, { t: 'pong', c: Number(m.c) || 0, s: this.now() }); break;
      case 'chat': this.onChat(c, m.ch === 'global' ? 'global' : 'near', m.text); break;
      case 'whisper': this.onWhisper(c, String(m.to ?? ''), m.text); break;
      case 'emote': if ((EMOTES as readonly string[]).includes(m.id)) this.toNear(c, { t: 'emote', id: c.id, e: m.id }, 80, true); break;
      case 'act': void this.onAct(c, m); break;
    }
  }

  // ------------------------------------------------------------------------------------------ chat
  private chatOk(c: Conn, raw: unknown): string | null {
    const acc = this.accounts.byId(c.account.id) ?? c.account;
    if (this.accounts.isMuted(acc)) { this.send(c, { t: 'chat', ch: 'system', from: 'Server', fromId: 0, text: 'You are muted.', ts: Date.now() }); return null; }
    const text = cleanChat(raw); if (!text) return null;
    const now = Date.now(); c.chatTimes = c.chatTimes.filter((t) => now - t < 12_000);
    if (c.chatTimes.length >= 6) { this.send(c, { t: 'chat', ch: 'system', from: 'Server', fromId: 0, text: 'Slow down, you are typing too fast.', ts: now }); return null; }
    if (text === c.lastChat && c.chatTimes.length) return null;
    c.chatTimes.push(now); c.lastChat = text; return text;
  }
  private logChat(c: Conn, ch: string, text: string, to?: string) { try { run(this.db, 'INSERT INTO chat_log(at,account_id,name,ch,to_name,text) VALUES(?,?,?,?,?,?)', Date.now(), c.account.id, c.profile.name, ch, to ?? null, text); } catch { /* never block play on a log write */ } }
  private onChat(c: Conn, ch: 'near' | 'global', raw: unknown) {
    const text = this.chatOk(c, raw); if (!text) return;
    this.logChat(c, ch, text);
    const msg: ServerMsg = { t: 'chat', ch, from: c.profile.name, fromId: c.id, text, ts: Date.now() };
    if (ch === 'global') this.broadcastJson(msg); else this.toNear(c, msg, this.cfg.nearChatRadius, true);
  }
  private onWhisper(c: Conn, to: string, raw: unknown) {
    const text = this.chatOk(c, raw); if (!text) return;
    const target = this.findByName(to);
    if (!target) { this.send(c, { t: 'chat', ch: 'system', from: 'Server', fromId: 0, text: `${to || 'That person'} is not online.`, ts: Date.now() }); return; }
    this.logChat(c, 'whisper', text, target.profile.name);
    const msg: ServerMsg = { t: 'chat', ch: 'whisper', from: c.profile.name, fromId: c.id, text, ts: Date.now() };
    this.send(target, msg); if (target !== c) this.send(c, { ...msg, from: `to ${target.profile.name}` });
  }
  findByName(name: string): Conn | undefined {
    const k = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); if (!k) return undefined;
    for (const c of this.conns.values()) if (c.profile.name_key === k) return c;
    return undefined;
  }
  private systemChat(text: string, except?: Conn) { for (const c of this.conns.values()) if (c !== except) this.send(c, { t: 'chat', ch: 'system', from: 'Lagos', fromId: 0, text, ts: Date.now() }); }
  private toNear(c: Conn, msg: ServerMsg, radius: number, includeSelf: boolean) {
    const sent = new Set<Conn>();
    const space = this.spaceOf(c);
    this.grid.near(c.x, c.z, radius, (n) => { if (n.kind === 'p') { const o = n as unknown as Conn; if ((o === c && !includeSelf) || this.spaceOf(o) !== space) return; sent.add(o); } });
    if (includeSelf) sent.add(c);
    for (const o of sent) this.send(o, msg);
  }

  // ------------------------------------------------------------------------------------------ economy actions
  private async onAct(c: Conn, m: Extract<ClientMsg, { t: 'act' }>) {
    const n = Number(m.n) || 0;
    const ok = (extra: Record<string, unknown> = {}) => this.send(c, { t: 'ack', n, ok: true, ...extra });
    const fail = (e: unknown) => {
      if (e instanceof HttpError) this.send(c, { t: 'ack', n, ok: false, err: e.message, ...e.extra, ...this.walletOf(c) });
      else { this.log.error('act failed', m.a, e); this.send(c, { t: 'ack', n, ok: false, err: 'Server error.', ...this.walletOf(c) }); }
    };
    const id = c.account.id;
    try {
      switch (m.a) {
        case 'plot.buy': { const r = this.econ.buyPlot(id, m.id, { cx: num(m.cx), cz: num(m.cz), area: num(m.area), zone: str(m.zone), rich: num(m.rich), pts: Array.isArray(m.pts) ? (m.pts as number[]) : undefined }); ok({ ...r.wallet, id: r.id, price: r.price }); break; }
        case 'bank.deposit': ok({ ...this.econ.deposit(id, Number(m.amount)) }); break;
        case 'bank.withdraw': ok({ ...this.econ.withdraw(id, Number(m.amount)) }); break;
        case 'cash.transfer': {
          const to = this.findByName(String(m.to ?? '')); const toRow = to ? to.account : null;
          const target = toRow ?? (this.accounts.profileByName(String(m.to ?? '')) ? this.accounts.byId(this.accounts.profileByName(String(m.to))!.account_id) : null);
          if (!target) throw new HttpError(404, 'No player with that name.');
          const amount = Math.floor(Number(m.amount));
          if (amount > 5_000_000) throw new HttpError(400, 'Limit is ₦5,000,000 per transfer.');
          const r = this.econ.transfer(id, target.id, amount, 'player transfer');
          const tc = this.byAccount.get(target.id);
          if (tc) this.send(tc, { t: 'toast', title: 'Money received', body: `${c.profile.name} sent you ₦${amount.toLocaleString('en-NG')}.` });
          ok({ ...r.from, to: target.id }); break;
        }
        case 'cash.delta': ok({ ...this.econ.clientDelta(id, Number(m.d), String(m.why ?? '')) }); break;
        case 'job.start': this.econ.startJob(id, String(m.id)); ok(); break;
        case 'job.done': ok({ ...this.econ.finishJob(id, String(m.id), Number(m.factor) || 1) }); break;
        case 'shop.buy': { const r = this.econ.shopBuy(id, m.sku, Number(m.qty) || 1); ok({ ...r.wallet, sku: r.sku, price: r.price, qty: r.qty }); break; }
        case 'state.put': this.econ.putState(id, m.key, m.value); ok(); break;
        case 'door': { // walking into or out of an interior (GTA Online style loaded interiors)
          const now = performance.now(); if (now - c.ms.lastDoor < 1000) throw new HttpError(429, 'Slow down.'); c.ms.lastDoor = now;
          let into = typeof m.into === 'string' && m.into ? String(m.into).slice(0, 64) : null;
          // every account has its own room: "home" is yours, "home:<account>" is somebody else's and needs their invite
          if (into === 'home') into = `home:${id}`;
          else if (into?.startsWith('home:') && into !== `home:${id}`) { this.checkVisit(c, into.slice(5)); if (this.invites.get(id)?.designer) this.designing.set(id, into.slice(5)); }
          if (!into) this.designing.delete(id);
          if (into) { c.ms.doorFrom = { x: c.ms.x, z: c.ms.z }; c.ms.interior = into; c.ms.exitTo = null; }
          else {
            if (!c.ms.interior) throw new HttpError(400, 'You are not inside anywhere.');
            const was = c.ms.interior; c.ms.exitTo = c.ms.doorFrom; c.ms.exitFrom = was; c.ms.interior = null;
            if (was === `home:${id}`) this.evictGuests(c); // the owner left: guests go out with them, GTA Online style
          }
          c.ms.tpUntil = now + 3000; ok({ into }); break;
        }
        case 'race.enter': ok({ ...this.econ.raceEnter(id, m.wager, m.rivals) }); break;
        case 'race.join': ok({ lobby: this.races.join(id, c.profile.name, { x: c.ms.x, z: c.ms.z }, m), ...this.walletOf(c) }); break;
        case 'race.leave': this.races.leave(id); ok({ ...this.walletOf(c) }); break;
        case 'race.start': ok({ lobby: this.races.start(id, m.len) }); break;
        case 'race.finish': ok({ lobby: this.races.finish(id, m.ms, m.len) }); break;
        case 'casino': ok(this.casino(c, m)); break;
        case 'social.greet': { const o = this.nearConn(c, m.to, 12); this.send(o, { t: 'social', kind: 'greet', from: c.profile.name, fromId: c.id }); ok(); break; }
        case 'social.invite': ok(this.invite(c, m)); break;
        case 'room.edit': { // a room layout changed: the owner's own edits, or their designer's; everybody in the room sees it
          const room = this.cleanRoom(m.room); if (!room) throw new HttpError(400, 'Bad layout.');
          const space = c.ms.interior ?? ''; if (!space.startsWith('home:')) throw new HttpError(400, 'You are not in a room.');
          const owner = space.slice(5); if (owner !== id && this.designing.get(id) !== owner) throw new HttpError(403, 'Only the owner or their designer can arrange this room.');
          for (const o of this.conns.values()) if (o !== c && o.ms.interior === space) this.send(o, { t: 'room', room, by: c.profile.name, mine: o.account.id === owner });
          if (owner !== id) { const oc = this.byAccount.get(owner); if (oc && oc.ms.interior !== space) this.send(oc, { t: 'room', room, by: c.profile.name, mine: true }); }
          ok(); break;
        }
        case 'social.ticket': { // an agbero asks a driver for the park ticket; the driver decides on their phone
          const o = this.nearConn(c, m.to, 12); if (!o.veh) throw new HttpError(400, 'They are not driving.');
          const k = `${id}>${o.account.id}`; const last = this.lastSwitch.get(k) ?? 0; if (Date.now() - last < 60_000) throw new HttpError(429, 'You just asked them.'); this.lastSwitch.set(k, Date.now());
          this.send(o, { t: 'social', kind: 'ticket', from: c.profile.name, fromId: c.id, amount: 300 }); ok(); break;
        }
        case 'grid.get': ok({ board: this.power.board() }); break;
        case 'grid.switch': { // only from the control room, and not faster than a real hand on a real switch
          if (c.ms.interior !== 'power') throw new HttpError(400, 'You are not in the control room.');
          const last = this.lastSwitch.get(id) ?? 0; if (Date.now() - last < 1500) throw new HttpError(429, 'Easy on the switches.'); this.lastSwitch.set(id, Date.now());
          const f = Math.floor(Number(m.f)); if (!FEEDERS.some((x) => x.i === f)) throw new HttpError(400, 'No such feeder.');
          ok({ state: this.power.switch(f, !!m.on, c.profile.name, Number(m.inHours) || 0, Number(m.hours) || undefined) }); break;
        }
        case 'biz.all': ok({ list: this.biz.all() }); break;
        case 'biz.mine': ok({ list: this.biz.mine(id) }); break;
        case 'biz.get': ok({ biz: this.biz.get(String(m.site ?? '')) }); break;
        case 'biz.buy': {
          const r = this.biz.buy(id, m.site, m.type, this.at(c)); ok({ ...r.wallet, biz: r.biz });
          this.broadcastJson({ t: 'biz', site: r.biz.site, type: r.biz.type, ownerName: c.profile.name }); break;
        }
        case 'biz.collect': { const r = this.biz.collect(id, m.site, this.at(c)); ok({ ...r.wallet, amount: r.amount, biz: r.biz }); break; }
        case 'biz.restock': { const r = this.biz.restock(id, m.site, this.at(c)); ok({ ...r.wallet, cost: r.cost, biz: r.biz }); break; }
        case 'biz.serve': {
          const r = this.biz.serve(id, m.site, this.at(c)); ok({ ...r.wallet, item: r.item });
          const oc = this.byAccount.get(r.owner); if (oc) this.send(oc, { t: 'toast', title: 'Customer', body: `${c.profile.name} bought from your shop. ₦${r.item.price.toLocaleString('en-NG')} in the till.` }); break;
        }
        case 'tp': case 'respawn': {
          const now = performance.now();
          if (now - c.ms.lastTp < 10_000) { this.econ.flag(id, 'tp-spam', { a: m.a }); throw new HttpError(429, 'Too many teleports.'); }
          c.ms.lastTp = now; c.ms.tpUntil = now + 2500; ok(); break;
        }
        default: throw new HttpError(400, 'Unknown action.');
      }
    } catch (e) { fail(e); }
  }
  // ------------------------------------------------------------------------------------------ people: greetings and room invites
  /** account -> who invited them into their room, until when, and the room door (so the guest can find it) */
  private invites = new Map<string, { owner: string; name: string; until: number; designer: boolean }>();
  /** who is currently designing whose room (set when a designer walks in) */
  private designing = new Map<string, string>();
  /** players see each other only in the same space: the street, one venue, or one person's room */
  private spaceOf(c: Conn) { return c.ms.interior ?? ''; }
  private at(c: Conn) { return { x: c.ms.x, z: c.ms.z, interior: c.ms.interior }; }
  private nearConn(c: Conn, to: unknown, r: number): Conn {
    const o = this.conns.get(Number(to)); if (!o || o === c || o.dead || !o.haveState) throw new HttpError(404, 'They are not around.');
    if (this.spaceOf(o) !== this.spaceOf(c) || Math.hypot(o.ms.x - c.ms.x, o.ms.z - c.ms.z) > r) throw new HttpError(400, 'Get closer to them first.');
    return o;
  }
  private invite(c: Conn, m: Record<string, unknown>) {
    const o = this.nearConn(c, m.to, 15); const id = c.account.id;
    if (c.ms.interior && c.ms.interior !== `home:${id}`) throw new HttpError(400, 'Invite them from the street or your room.');
    const d = m.door as { x?: unknown; z?: unknown; yaw?: unknown } | undefined;
    const door = d && [d.x, d.z, d.yaw].every((v) => typeof v === 'number' && Number.isFinite(v)) ? { x: d.x as number, z: d.z as number, yaw: d.yaw as number } : null;
    if (!door) throw new HttpError(400, 'You have no room to invite them to.');
    const designer = !!m.designer; const room = this.cleanRoom(m.room);
    this.invites.set(o.account.id, { owner: id, name: c.profile.name, until: Date.now() + 15 * 60_000, designer });
    this.send(o, { t: 'social', kind: 'invite', from: c.profile.name, fromId: c.id, owner: id, door, room, designer });
    return { to: o.profile.name };
  }
  /** a guest may walk into someone's room only with a live invite, while the owner is home, from near the owner's door */
  private checkVisit(c: Conn, owner: string) {
    const inv = this.invites.get(c.account.id);
    if (!inv || inv.owner !== owner || inv.until < Date.now()) throw new HttpError(403, 'You were not invited.');
    const oc = this.byAccount.get(owner);
    if (!oc || oc.ms.interior !== `home:${owner}`) throw new HttpError(400, `${inv.name} is not home right now.`);
    const at = oc.ms.doorFrom; if (!at || Math.hypot(c.ms.x - at.x, c.ms.z - at.z) > 30) throw new HttpError(400, 'Go to their door first.');
  }
  /** a room layout from a client: small, plain JSON, or nothing */
  private cleanRoom(r: unknown) { if (!r || typeof r !== 'object') return null; let j = ''; try { j = JSON.stringify(r); } catch { return null; } if (j.length > 12_000) return null; const o = JSON.parse(j); return o && o.v === 1 && Array.isArray(o.extra) && o.extra.length <= 40 && typeof o.pos === 'object' ? o : null; }
  private evictGuests(owner: Conn) {
    const room = `home:${owner.account.id}`;
    for (const o of this.conns.values()) if (o !== owner && o.ms.interior === room) this.send(o, { t: 'social', kind: 'evict', from: owner.profile.name, fromId: owner.id });
  }

  // ------------------------------------------------------------------------------------------ casino: all randomness and money on the server
  private bj = new Map<string, BjTable>();
  private casino(c: Conn, m: Record<string, unknown>) {
    const id = c.account.id; if (c.ms.interior !== 'casino') throw new HttpError(400, 'You are not in the casino.');
    const rand = () => randomInt(0, 2 ** 32) / 2 ** 32; const cash = () => this.econ.wallet(id).cash;
    const game = String(m.game ?? '');
    if (game === 'slots') {
      const bet = Math.floor(Number(m.bet)); if (!SLOT_BETS.includes(bet)) throw new HttpError(400, 'Bad bet.'); if (cash() < bet) throw new HttpError(400, 'Not enough cash.');
      this.econ.casino(id, -bet, 'slots'); const r = slotSpin(rand, bet); const w = r.win ? this.econ.casino(id, r.win, 'slots') : this.econ.wallet(id);
      return { reels: r.reels, win: r.win, cash: w.cash, bank: w.bank };
    }
    if (game === 'roulette') {
      const bets = (m.bets ?? {}) as Record<string, number>; let staked = 0;
      for (const [k, v] of Object.entries(bets)) { if (!ROULETTE_KEYS.test(k) || !Number.isInteger(v) || v < 500 || v > 500_000) throw new HttpError(400, 'Bad bet.'); staked += v; }
      if (!staked || staked > 1_000_000) throw new HttpError(400, 'Bad stake.'); if (cash() < staked) throw new HttpError(400, 'Not enough cash.');
      this.econ.casino(id, -staked, 'roulette'); const n = randomInt(0, 37); let back = 0; for (const [k, v] of Object.entries(bets)) back += v * roulettePays(k, n);
      const w = back ? this.econ.casino(id, back, 'roulette') : this.econ.wallet(id); return { num: n, back, staked, cash: w.cash, bank: w.bank };
    }
    if (game === 'bj') {
      let t = this.bj.get(id); if (!t) { t = new BjTable(rand); this.bj.set(id, t); }
      const op = String(m.op ?? '');
      if (op === 'deal') { if (t.phase === 'play') throw new HttpError(400, 'Finish this hand.'); const bet = Math.floor(Number(m.bet)); if (bet < 500 || bet > 500_000) throw new HttpError(400, 'Bad bet.'); if (cash() < bet) throw new HttpError(400, 'Not enough cash.'); this.econ.casino(id, -bet, 'blackjack'); (t as any)._paid = false; t.deal(bet); }
      else if (op === 'hit') t.hit(); else if (op === 'stand') t.stand();
      else if (op === 'double') { if (t.phase !== 'play' || t.ph.length !== 2) throw new HttpError(400, 'Cannot double now.'); if (cash() < t.bet) throw new HttpError(400, 'Not enough cash.'); this.econ.casino(id, -t.bet, 'blackjack'); t.double(); }
      else throw new HttpError(400, 'Bad move.');
      if (t.phase === 'done' && t.bet + t.net > 0 && !(t as any)._paid) { this.econ.casino(id, t.bet + t.net, 'blackjack'); (t as any)._paid = true; }
      const w = this.econ.wallet(id); return { ...t.view(), cash: w.cash, bank: w.bank };
    }
    throw new HttpError(400, 'Unknown game.');
  }
  /** never store a position inside the interior zone: a player who logs out indoors comes back at the door */
  private outdoorPos(c: Conn) { return c.ms.interior && c.ms.doorFrom ? c.ms.doorFrom : inInteriorZone(c.ms.x, c.ms.z) ? { x: 900, z: -330 } : { x: c.ms.x, z: c.ms.z }; }
  private walletOf(c: Conn) { const w = this.econ.wallet(c.account.id); return { cash: w.cash, bank: w.bank }; }

  // ------------------------------------------------------------------------------------------ snapshots
  private tick() {
    this.tickN++; this.stats0.ticks++;
    if (this.tickN % this.cfg.tickHz === 0) { this.races.tick(); this.power.tick(); }
    const R = this.cfg.interestRings; const now = performance.now();
    // parked cars time out
    if (this.tickN % (this.cfg.tickHz * 10) === 0) { const t = Date.now(); for (const v of [...this.vehicles.values()]) if (v.parkedAt && t - v.parkedAt > PARKED_TTL) this.removeVehicle(v); }
    const nowMs = this.now();
    for (const c of this.conns.values()) {
      if (c.dead || c.ws.readyState !== 1) continue;
      if (!c.haveState) continue; // still in the lobby: not part of the world yet
      if (c.ws.bufferedAmount > 512 * 1024) { c.skippedSnaps++; this.stats0.dropsBackpressure++; continue; } // slow link: skip, the next delta still applies
      const w = this.writer; const countAt = beginSnapshot(w, { time: nowMs, ack: c.lastSeq });
      const visible = new Set<number>(); let count = 0; const newcomers: Conn[] = [];
      const tier = (this.tickN + c.id) | 0; const space = this.spaceOf(c);
      this.grid.around(c.cx, c.cz, R, (n, ring) => {
        if (n === c || n === (c.veh as Node | null) || (n.kind === 'v' && (n as VNode).owner === c)) return;
        if (n.kind === 'p') { const o = n as unknown as Conn; if (!o.haveState || this.spaceOf(o) !== space) return; }
        else if (space) return; // cars live on the street
        visible.add(n.id);
        const base = c.known.get(n.id) ?? null;
        if (base && ring > NEAR_RINGS_FULL_RATE) { const every = ring === 2 ? 3 : 6; if (tier % every !== 0) return; }
        const e = n.ent;
        if (writeEntity(w, e, base ? base : null)) {
          count++;
          if (!base) { const copy = { ...e } as Ent; c.known.set(n.id, copy); if (n.kind === 'p') newcomers.push(n as unknown as Conn); }
        }
      });
      // anything we hold that has left the area (with one ring of hysteresis) or no longer exists
      const removed: number[] = [];
      for (const id of c.known.keys()) {
        if (visible.has(id)) continue;
        const node = id & VEH_BIT ? this.vehicles.get(id) : this.conns.get(id);
        const same = node && (node.kind === 'p' ? (node as unknown as Conn).haveState && this.spaceOf(node as unknown as Conn) === space : !space);
        if (node && same && Math.max(Math.abs(node.cx - c.cx), Math.abs(node.cz - c.cz)) <= R + 1) continue;
        removed.push(id);
      }
      for (const id of removed) { c.known.delete(id); c.knownWho.delete(id); }
      if (!count && !removed.length && this.tickN % this.cfg.tickHz !== 0) { w.o = 0; continue; } // quiet: send nothing (a keepalive goes out once a second)
      // names and looks for players this client sees for the first time travel before the snapshot that mentions them
      const who: WhoInfo[] = [];
      for (const o of newcomers) if (!c.knownWho.has(o.id)) { c.knownWho.add(o.id); who.push(whoOf(o)); }
      if (who.length) this.send(c, { t: 'who', list: who });
      const buf = endSnapshot(w, countAt, count, removed);
      c.ws.send(Buffer.from(buf), { binary: true }); /* copy: the writer is shared and ws may queue the frame */ c.bytesOut += buf.length; this.stats0.bytesOut += buf.length; this.stats0.snapshots++; c.lastSnapAt = now;
    }
  }

  private announceWho(c: Conn) {
    const info = whoOf(c);
    for (const o of this.conns.values()) if (o.knownWho.has(c.id)) this.send(o, { t: 'who', list: [info] });
  }

  // ------------------------------------------------------------------------------------------ housekeeping
  private heartbeat() {
    for (const c of [...this.conns.values()]) {
      if (!c.pong) { try { c.ws.terminate(); } catch { /* gone */ } this.drop(c); continue; }
      c.pong = false; try { c.ws.ping(); } catch { /* closing */ }
      const acc = this.accounts.byId(c.account.id); // a ban or role change takes effect on live players too
      if (acc) { c.role = acc.role; const b = banState(acc); if (b.banned) this.kick(c.account.id, `Banned: ${b.reason}`); }
    }
  }
  private saveAll() {
    for (const c of this.conns.values()) if (c.haveState) { try { const p = this.outdoorPos(c); this.econ.savePosition(c.account.id, p.x, c.ms.y, p.z, 20); } catch (e) { this.log.warn('save failed', e); } }
  }

  send(c: Conn, m: ServerMsg) { if (c.ws.readyState === 1) { const s = JSON.stringify(m); c.bytesOut += s.length; this.stats0.bytesOut += s.length; c.ws.send(s); } }
  private broadcastJson(m: ServerMsg) { const s = JSON.stringify(m); for (const c of this.conns.values()) if (c.ws.readyState === 1) { c.ws.send(s); c.bytesOut += s.length; } }

  // ------------------------------------------------------------------------------------------ OnlineApi (for routes)
  count() { return this.conns.size; }
  list() { return [...this.conns.values()].map((c) => ({ id: c.id, accountId: c.account.id, name: c.profile.name, x: c.ms.x, z: c.ms.z, role: c.role, since: c.since, vehicle: !!c.veh })); }
  isOnline(accountId: string) { return this.byAccount.has(accountId); }
  kick(accountId: string, reason: string) {
    const c = this.byAccount.get(accountId); if (!c) return false;
    this.send(c, { t: 'kick', reason }); try { c.ws.close(4403, reason.slice(0, 100)); } catch { /* ignore */ } this.drop(c); return true;
  }
  broadcast(text: string, from = 'Server') { this.broadcastJson({ t: 'chat', ch: 'system', from, fromId: 0, text, ts: Date.now() }); }
  toast(accountId: string, title: string, body: string) { const c = this.byAccount.get(accountId); if (!c) return false; this.send(c, { t: 'toast', title, body }); return true; }
  teleport(accountId: string, x: number, z: number) {
    const c = this.byAccount.get(accountId); if (!c) return false;
    const now = performance.now(); c.ms.x = x; c.ms.z = z; c.ms.tpUntil = now + 2500; c.ms.fixUntil = now + 300;
    this.send(c, { t: 'fix', x, y: c.ms.y, z, seq: c.lastSeq, why: 'admin' }); return true;
  }
  rooms() {
    const players = this.grid.rooms((n) => (n.kind === 'p' ? 1 : 0)); const veh = this.grid.rooms((n) => (n.kind === 'v' ? 1 : 0));
    return [...new Set([...players.keys(), ...veh.keys()])].map((key) => ({ key, players: players.get(key) ?? 0, vehicles: veh.get(key) ?? 0 }));
  }
  stats() {
    const s = this.stats0; return { online: this.conns.size, vehicles: this.vehicles.size, cells: this.grid.cellCount(), rooms: this.rooms().length, ...s, tickHz: this.cfg.tickHz, uptime: Math.round(this.now() / 1000) };
  }
}

const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
function whoOf(o: Conn): WhoInfo { return { id: o.id, name: o.profile.name, model: o.profile.model, skin: o.profile.skin, outfit: o.profile.outfit, level: 1 + Math.floor(Math.sqrt(Math.max(0, o.profile.xp) / 60)), role: o.role === 'player' ? undefined : o.role }; }
void keyOf; void cellCoord;
