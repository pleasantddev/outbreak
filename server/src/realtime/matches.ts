// Football and basketball fixtures between real players. A fixture lives on a booked slot at a venue: the host books
// the slot, players join a side and their wager is escrowed here, kick-off is at the start of the slot (or earlier if
// the host calls it), and the host's client runs the ball (it relays snapshots through `mx`). When it ends every
// player's client reports the score; the server pays out only when the host's score is plausible for the time played
// and no other player disputes it. A dispute voids the match and refunds every stake.
import { HttpError } from '../auth.ts';
import { hourToMs, MATCH_MS, MATCH_WAGERS, potShare, scorePlausible, SPORT_SIZE, type Sport } from '../../../v2/src/net/sports.ts';

export interface FxMember { accountId: string; name: string; side: 0 | 1; report: [number, number] | null }
export interface Fixture {
  key: string; venue: string; slot: number; sport: Sport; wager: number; host: string; owner: string | null;
  members: Map<string, FxMember>; state: 'open' | 'live' | 'done'; kickAt: number; startedAt: number; hostReportAt: number;
}
export interface FxDeps {
  debit(id: string, n: number, kind: string): void; credit(id: string, n: number, kind: string): void;
  send(id: string, msg: object): void; flag(id: string, what: string, info: object): void; now(): number;
  /** the booking at venue/slot, if any, and the venue's owner */
  booking(venue: string, slot: number): { by_id: string } | null; venueOwner(venue: string): string | null;
  /** shortest match the server will settle, ms (tests shrink it) */
  minMs?: number;
}

export class Fixtures {
  list = new Map<string, Fixture>(); byAccount = new Map<string, string>();
  constructor(private d: FxDeps) {}
  view(f: Fixture) { return { t: 'fixture', key: f.key, venue: f.venue, slot: f.slot, sport: f.sport, wager: f.wager, host: f.host, state: f.state, kickAt: f.kickAt, startedAt: f.startedAt, members: [...f.members.values()].map((m) => ({ id: m.accountId, name: m.name, side: m.side })) }; }
  private tell(f: Fixture, msg: object = this.view(f)) { for (const id of f.members.keys()) this.d.send(id, msg); }
  open() { return [...this.list.values()].filter((f) => f.state === 'open').map((f) => this.view(f)); }

  /** the host opens a fixture on a slot they booked */
  create(acc: string, name: string, a: Record<string, unknown>) {
    const venue = String(a.venue ?? ''), slot = Math.floor(Number(a.slot)); const sport: Sport = a.sport === 'basketball' ? 'basketball' : 'football';
    const wager = Math.floor(Number(a.wager) || 0); if (!MATCH_WAGERS.includes(wager)) throw new HttpError(400, 'Bad wager.');
    if (this.byAccount.has(acc)) throw new HttpError(400, 'You are already in a match.');
    const b = this.d.booking(venue, slot); if (!b || b.by_id !== acc) throw new HttpError(403, 'Book the slot first.');
    const key = `${venue}@${slot}`; if (this.list.has(key)) throw new HttpError(409, 'There is already a match on that slot.');
    const f: Fixture = { key, venue, slot, sport, wager, host: acc, owner: this.d.venueOwner(venue), members: new Map(), state: 'open', kickAt: hourToMs(slot), startedAt: 0, hostReportAt: 0 };
    this.list.set(key, f); this.join(acc, name, { key, side: 0 }); return this.view(f);
  }
  /** join a side; your wager is held until the match is settled (refunded if you leave before kick-off) */
  join(acc: string, name: string, a: Record<string, unknown>) {
    const f = this.list.get(String(a.key ?? '')); if (!f) throw new HttpError(404, 'No such match.');
    if (f.state !== 'open') throw new HttpError(400, 'That match don start.');
    if (this.byAccount.has(acc) && this.byAccount.get(acc) !== f.key) throw new HttpError(400, 'You are already in a match.');
    if (f.members.has(acc)) return this.view(f);
    const side = (a.side === 1 ? 1 : 0) as 0 | 1; const n = [...f.members.values()].filter((m) => m.side === side).length;
    if (n >= SPORT_SIZE[f.sport]) throw new HttpError(400, 'That side is full.');
    if (f.wager) this.d.debit(acc, f.wager, 'match.stake');
    f.members.set(acc, { accountId: acc, name, side, report: null }); this.byAccount.set(acc, f.key);
    this.tell(f); return this.view(f);
  }
  leave(acc: string) {
    const key = this.byAccount.get(acc); if (!key) return; const f = this.list.get(key); this.byAccount.delete(acc); if (!f) return;
    if (f.state === 'open') {
      f.members.delete(acc); if (f.wager) this.d.credit(acc, f.wager, 'match.refund');
      if (acc === f.host || !f.members.size) { this.cancel(f, 'The host cancelled the match.'); return; }
      this.tell(f);
    } // leaving a live match forfeits your stake; the match goes on with AI in your place
  }
  private cancel(f: Fixture, why: string) {
    for (const m of f.members.values()) { if (f.wager) this.d.credit(m.accountId, f.wager, 'match.refund'); this.byAccount.delete(m.accountId); }
    this.tell(f, { ...this.view(f), state: 'done', void: why }); this.list.delete(f.key);
  }
  /** host kicks off early once both sides have a player; otherwise it starts by itself at the slot */
  start(acc: string) {
    const f = this.mine(acc); if (f.host !== acc) throw new HttpError(403, 'Only the host can kick off.'); if (f.state !== 'open') throw new HttpError(400, 'Already started.');
    if (!this.bothSides(f)) throw new HttpError(400, 'You need somebody on the other side.');
    this.kick(f); return this.view(f);
  }
  private bothSides(f: Fixture) { const s = [...f.members.values()].map((m) => m.side); return s.includes(0) && s.includes(1); }
  private kick(f: Fixture) { f.state = 'live'; f.startedAt = this.d.now(); this.tell(f); }
  /** relay match traffic: the host's snapshots to everybody, the others' inputs to the host */
  relay(acc: string, d: unknown) {
    const key = this.byAccount.get(acc); const f = key ? this.list.get(key) : undefined; if (!f || f.state !== 'live') return;
    const msg = { t: 'mx', from: acc, d };
    if (acc === f.host) { for (const id of f.members.keys()) if (id !== acc) this.d.send(id, msg); } else this.d.send(f.host, msg);
  }
  report(acc: string, a0: unknown, b0: unknown) {
    const f = this.mine(acc); if (f.state !== 'live') throw new HttpError(400, 'No match on.');
    const m = f.members.get(acc)!; m.report = [Math.floor(Number(a0)), Math.floor(Number(b0))];
    if (acc === f.host) f.hostReportAt = this.d.now();
    this.maybeSettle(f); return true;
  }
  private maybeSettle(f: Fixture, force = false) {
    const host = f.members.get(f.host); if (!host?.report) return;
    const ms = [...f.members.values()];
    if (!force && ms.some((m) => !m.report)) return; // wait for everybody (the tick forces it 20 s after the host)
    const [a, b] = host.report; const played = this.d.now() - f.startedAt;
    const dispute = ms.some((m) => m.report && (m.report[0] !== a || m.report[1] !== b));
    const minMs = this.d.minMs ?? MATCH_MS[f.sport] * 0.9;
    if (played < minMs || !scorePlausible(f.sport, a, b, played)) { this.d.flag(f.host, 'match-score', { a, b, played }); this.cancel(f, 'The score did not add up. Stakes refunded.'); return; }
    if (dispute) { this.d.flag(f.host, 'match-dispute', { a, b, reports: ms.map((m) => m.report) }); this.cancel(f, 'Players did not agree on the score. Stakes refunded.'); return; }
    f.state = 'done'; const winSide = a > b ? 0 : b > a ? 1 : -1; let paid: { id: string; n: number }[] = [];
    if (f.wager) {
      if (winSide < 0) for (const m of ms) this.d.credit(m.accountId, f.wager, 'match.refund');
      else {
        const { cut, win } = potShare(f.wager, ms.length); const winners = ms.filter((m) => m.side === winSide); const each = Math.floor(win / winners.length);
        for (const m of winners) { this.d.credit(m.accountId, each, 'match.win'); paid.push({ id: m.accountId, n: each }); }
        if (f.owner) this.d.credit(f.owner, cut, 'match.house');
      }
    }
    this.tell(f, { ...this.view(f), score: [a, b], winSide, paid });
    for (const m of ms) this.byAccount.delete(m.accountId); this.list.delete(f.key);
  }
  private mine(acc: string) { const key = this.byAccount.get(acc); const f = key ? this.list.get(key) : undefined; if (!f) throw new HttpError(400, 'You are not in a match.'); return f; }
  tick() {
    const now = this.d.now(); const wall = Date.now();
    for (const f of [...this.list.values()]) {
      if (f.state === 'open' && wall >= f.kickAt) { if (this.bothSides(f)) this.kick(f); else if (wall >= f.kickAt + 120_000) this.cancel(f, 'Nobody came to play. Stakes refunded.'); }
      else if (f.state === 'live' && f.hostReportAt && now - f.hostReportAt > 20_000) this.maybeSettle(f, true);
      else if (f.state === 'live' && now - f.startedAt > MATCH_MS[f.sport] * 3) this.cancel(f, 'The match never finished. Stakes refunded.');
    }
  }
}
