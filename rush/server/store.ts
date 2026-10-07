// Ranked ratings and the global boards: one JSON file, written atomically a moment after each change, or memory
// only when no file is given (tests). A player is known by an id derived from a key their device made; the key
// itself is never stored or sent to anyone else, so knowing someone's id does not let you race as them.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { START_RATING, rateRace, tierOf } from '../src/shared/ranking';

export interface PlayerRec { pid: string; name: string; rating: number; races: number; wins: number; podiums: number; created: number; seen: number }
export interface LapRec { pid: string; name: string; time: number; car: string; at: number }
interface Data { v: 1; players: Record<string, PlayerRec>; laps: Record<string, LapRec[]> }
export interface RankedEntry { pid: string; name: string; place: number; finished: boolean }
export interface BoardRow { rank: number; pid: string; name: string; rating: number; tier: string; races: number; wins: number }

const LAPS_KEPT = 50;

export class Store {
  private d: Data = { v: 1, players: {}, laps: {} };
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string | null, private log: (m: string) => void = () => {}) {
    if (!file || !fs.existsSync(file)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Data;
      if (raw && raw.v === 1 && raw.players && raw.laps) this.d = raw;
    } catch (e) {
      // keep the unreadable file for a person to look at; start a fresh store beside it
      const aside = `${file}.bad-${Date.now()}`;
      fs.renameSync(file, aside);
      log(`store: ${file} was unreadable (${(e as Error).message}); moved to ${aside}`);
    }
  }

  /** The public id for a device key: a salted hash, so the key never has to be kept. */
  static pid(key: string) { return createHash('sha256').update(`lagos-rush/player/${key}`).digest('hex').slice(0, 20); }
  static validKey(key: unknown): key is string { return typeof key === 'string' && /^[0-9a-f]{32,64}$/.test(key); }

  player(pid: string, name: string): PlayerRec {
    const now = Date.now();
    let p = this.d.players[pid];
    if (!p) p = this.d.players[pid] = { pid, name, rating: START_RATING, races: 0, wins: 0, podiums: 0, created: now, seen: now };
    p.name = name; p.seen = now;
    this.dirty();
    return p;
  }
  find(pid: string): PlayerRec | undefined { return this.d.players[pid]; }

  /** Rate one ranked race. Returns each driver's new rating and the change. */
  rate(entries: RankedEntry[]): Map<string, { rating: number; delta: number }> {
    const last = entries.length;
    const deltas = rateRace(entries.map((e) => { const p = this.player(e.pid, e.name); return { id: e.pid, rating: p.rating, races: p.races, place: e.finished ? e.place : last }; }));
    const out = new Map<string, { rating: number; delta: number }>();
    for (const e of entries) {
      const p = this.d.players[e.pid];
      const delta = deltas.get(e.pid) ?? 0;
      p.rating += delta; p.races++;
      if (e.finished && e.place === 1) p.wins++;
      if (e.finished && e.place <= 3) p.podiums++;
      out.set(e.pid, { rating: p.rating, delta });
    }
    this.dirty();
    return out;
  }

  /** A lap the server timed itself. Keeps each driver's best on each route. */
  lap(track: string, pid: string, name: string, time: number, car: string) {
    if (!(time > 5 && time < 3600)) return;
    const list = (this.d.laps[track] ??= []);
    const mine = list.find((l) => l.pid === pid);
    if (mine && mine.time <= time) return;
    if (mine) { mine.time = time; mine.name = name; mine.car = car; mine.at = Date.now(); }
    else list.push({ pid, name, time, car, at: Date.now() });
    list.sort((a, b) => a.time - b.time);
    list.length = Math.min(list.length, LAPS_KEPT);
    this.dirty();
  }

  board(limit = 50): BoardRow[] {
    return Object.values(this.d.players).filter((p) => p.races > 0)
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.created - b.created)
      .slice(0, limit)
      .map((p, i) => ({ rank: i + 1, pid: p.pid, name: p.name, rating: p.rating, tier: tierOf(p.rating).name, races: p.races, wins: p.wins }));
  }
  rankOf(pid: string): number | null {
    const me = this.d.players[pid];
    if (!me || !me.races) return null;
    let above = 0;
    for (const p of Object.values(this.d.players)) if (p.races > 0 && p.rating > me.rating) above++;
    return above + 1;
  }
  laps(track: string, limit = 20) { return (this.d.laps[track] ?? []).slice(0, limit).map((l, i) => ({ rank: i + 1, ...l })); }

  private dirty() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), 1500);
  }
  /** Write now: temp file then rename, so a crash mid write never leaves half a file. */
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.d));
    fs.renameSync(tmp, this.file);
  }
}
