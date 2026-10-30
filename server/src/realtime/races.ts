// Street race lobbies between real players. The server holds the stakes, picks the start time and the course seed
// (every client builds the same course from the same map data and seed), takes finish times and pays the pot.
import { HttpError } from '../auth.ts';

export interface RaceMember { accountId: string; name: string; finishMs: number | null; dnf: boolean }
export interface Lobby {
  key: string; x: number; z: number; type: 'sprint' | 'circuit' | 'drag'; wager: number; host: string;
  members: Map<string, RaceMember>; state: 'open' | 'countdown' | 'racing' | 'done'; startAt: number; seed: number; minMs: number; firstFinish: number;
}
export interface RaceDeps {
  debit(accountId: string, n: number, kind: string): void; credit(accountId: string, n: number, kind: string): void;
  broadcast(l: Lobby, msg: object): void; flag(accountId: string, what: string, info: object): void; now(): number;
}
const TYPES = ['sprint', 'circuit', 'drag'] as const;
const WAGERS = [5000, 20000, 100000, 500000];
const MAX = 8;

export class RaceLobbies {
  lobbies = new Map<string, Lobby>(); byAccount = new Map<string, string>();
  constructor(private d: RaceDeps) {}
  view(l: Lobby) { return { t: 'lobby', key: l.key, x: l.x, z: l.z, type: l.type, wager: l.wager, host: l.host, state: l.state, startAt: l.startAt, seed: l.seed, members: [...l.members.values()].map((m) => ({ id: m.accountId, name: m.name, ms: m.finishMs, dnf: m.dnf })) }; }
  /** join (or open) the lobby at a meet spot; the wager is taken now and refunded if you leave before the start */
  join(accountId: string, name: string, at: { x: number; z: number }, a: Record<string, unknown>) {
    const key = String(a.key ?? '').slice(0, 40); const mx = Number(a.x), mz = Number(a.z);
    if (!key || !Number.isFinite(mx) || !Number.isFinite(mz)) throw new HttpError(400, 'Bad meet.');
    if (Math.hypot(at.x - mx, at.z - mz) > 40) throw new HttpError(400, 'Drive to the meet first.');
    if (this.byAccount.has(accountId)) throw new HttpError(400, 'You are already in a race.');
    let l = this.lobbies.get(key);
    if (l && l.state !== 'open') throw new HttpError(400, 'That race has started. Wait for the next one.');
    if (!l) {
      const type = TYPES.includes(a.type as never) ? (a.type as Lobby['type']) : 'sprint'; const wager = Math.floor(Number(a.wager));
      if (!WAGERS.includes(wager)) throw new HttpError(400, 'Bad wager.');
      l = { key, x: mx, z: mz, type, wager, host: accountId, members: new Map(), state: 'open', startAt: 0, seed: 0, minMs: 0, firstFinish: 0 }; this.lobbies.set(key, l);
    }
    if (l.members.size >= MAX) throw new HttpError(400, 'The race is full.');
    this.d.debit(accountId, l.wager, 'race.stake');
    l.members.set(accountId, { accountId, name, finishMs: null, dnf: false }); this.byAccount.set(accountId, key);
    this.d.broadcast(l, this.view(l)); return this.view(l);
  }
  leave(accountId: string) {
    const key = this.byAccount.get(accountId); if (!key) return; const l = this.lobbies.get(key); this.byAccount.delete(accountId); if (!l) return;
    const m = l.members.get(accountId);
    if (l.state === 'open') { l.members.delete(accountId); this.d.credit(accountId, l.wager, 'race.refund'); if (!l.members.size) { this.lobbies.delete(key); return; } if (l.host === accountId) l.host = [...l.members.keys()][0]; }
    else if (m && m.finishMs === null) m.dnf = true;
    this.d.broadcast(l, this.view(l)); this.maybeSettle(l);
  }
  /** the host starts it (two or more racers): five seconds of countdown, then everybody goes */
  start(accountId: string, minLen: unknown) {
    const l = this.lobbyOf(accountId); if (l.host !== accountId) throw new HttpError(403, 'Only the host can start.');
    if (l.state !== 'open') throw new HttpError(400, 'Already started.'); if (l.members.size < 2) throw new HttpError(400, 'You need at least one more racer.');
    l.state = 'countdown'; l.seed = Math.floor(Math.random() * 2 ** 31); l.startAt = this.d.now() + 6000;
    const len = Math.max(300, Math.min(20000, Number(minLen) || 1500)); l.minMs = (len / 55) * 1000; // nobody averages 200 km/h through Lagos
    this.d.broadcast(l, this.view(l)); return this.view(l);
  }
  finish(accountId: string, ms: unknown, len: unknown) {
    const l = this.lobbyOf(accountId); const m = l.members.get(accountId)!; if (m.finishMs !== null || m.dnf) return this.view(l);
    if (l.state === 'countdown' && this.d.now() >= l.startAt) l.state = 'racing';
    if (l.state !== 'racing') throw new HttpError(400, 'The race has not started.');
    const t = Math.floor(Number(ms)); const real = this.d.now() - l.startAt; const L = Math.max(300, Number(len) || 0); const minMs = Math.max(l.minMs, (L / 55) * 1000);
    if (!(t > 0) || t < minMs || t > real + 3000) { this.d.flag(accountId, 'race-time', { t, real, minMs }); m.dnf = true; }
    else m.finishMs = t;
    if (!l.firstFinish) l.firstFinish = this.d.now();
    this.d.broadcast(l, this.view(l)); this.maybeSettle(l); return this.view(l);
  }
  /** ticks: flip countdown to racing, close races two minutes after the first finisher */
  tick() { const now = this.d.now(); for (const l of this.lobbies.values()) { if (l.state === 'countdown' && now >= l.startAt) { l.state = 'racing'; this.d.broadcast(l, this.view(l)); } if (l.state === 'racing' && l.firstFinish && now - l.firstFinish > 120_000) { for (const m of l.members.values()) if (m.finishMs === null) m.dnf = true; this.maybeSettle(l); } if (l.state === 'racing' && now - l.startAt > 15 * 60_000) { for (const m of l.members.values()) if (m.finishMs === null) m.dnf = true; this.maybeSettle(l); } } }
  private maybeSettle(l: Lobby) {
    if (l.state === 'open' || l.state === 'done') return; const ms = [...l.members.values()]; if (ms.some((m) => m.finishMs === null && !m.dnf)) return;
    l.state = 'done'; const pot = l.wager * ms.length; const ranked = ms.filter((m) => m.finishMs !== null).sort((a, b) => a.finishMs! - b.finishMs!);
    if (ranked[0]) this.d.credit(ranked[0].accountId, Math.round(pot * 0.8), 'race.win');
    if (ranked[1] && ms.length >= 3) this.d.credit(ranked[1].accountId, l.wager, 'race.second');
    this.d.broadcast(l, { ...this.view(l), results: ranked.map((m, i) => ({ id: m.accountId, name: m.name, ms: m.finishMs, place: i + 1 })) });
    for (const m of ms) this.byAccount.delete(m.accountId); this.lobbies.delete(l.key);
  }
  private lobbyOf(accountId: string) { const key = this.byAccount.get(accountId); const l = key ? this.lobbies.get(key) : undefined; if (!l) throw new HttpError(400, 'You are not in a race.'); return l; }
}
