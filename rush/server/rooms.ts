// Rooms: lifecycle, players, the authoritative race, validation of what clients report, AI takeover for drivers
// who leave or go quiet, host migration, and quick matchmaking into public rooms.
import { RaceSim, defaultRaceConfig, type Entrant, type RaceEvent, type RemoteSnap } from '../src/shared/race';
import type { TrackData } from '../src/shared/track';
import { carById, CARS, defaultLivery } from '../src/shared/cars';
import { sanitiseConfig } from '../src/shared/roomConfig';
import { DEFAULT_ROOM, packCar, packHazard, type PlayerCard, type RoomConfig, type RoomPhase, type RoomView, type RoomPlayer, type ServerMsg, type ResultRow, type RaceStart, type SnapCar } from '../src/shared/protocol';
import { makePersonas } from '../src/shared/ai';
import { lookFor } from '../src/shared/drivers';
import type { Store } from './store';

export interface Conn { id: string; card: PlayerCard; send: (m: ServerMsg) => void; room: Room | null; token: string; alive: boolean; queued: boolean; lastState: number; violations: number; ping: number; pid?: string }

/** Room clock settings. Mutable only so tests can run a whole race lifecycle in a second or two. */
export const TIMING = {
  countdownMs: 5200,      // lights and a beat of quiet before GO
  resultsMs: 12000,       // results stay up before the next race opens
  reconnectMs: 60000,     // a dropped driver can come back for this long
  afkRaceMs: 8000,        // no state for this long in a race and an AI takes over
  quickStartMs: 20000,    // quick match rooms wait this long for more people
};
const POINTS = [15, 12, 10, 8, 6, 5, 4, 3, 2, 1, 0, 0];

export class Room {
  code: string;
  phase: RoomPhase = 'waiting';
  config: RoomConfig;
  players = new Map<string, RoomPlayer & { conn: Conn | null; leftAt: number }>();
  host = '';
  raceNo = 0;
  sim: RaceSim | null = null;
  startAt = 0;
  phaseUntil = 0;
  lastResults: ResultRow[] | null = null;
  seriesOver = false;
  private seed = 0;
  private snapAcc = 0;
  private entrantIdx = new Map<string, number>();
  private lastStateAt = new Map<string, number>();
  private handBackUntil = new Map<string, number>();
  private pendingEvents: RaceEvent[] = [];
  quick: boolean;
  createdAt = Date.now();
  /** humans in this race who have a ranked identity, by entrant id */
  private racePids = new Map<string, { pid: string; name: string }>();
  /** seconds each human's car spent under an AI stand-in this race */
  private aiTime = new Map<string, number>();

  constructor(code: string, config: Partial<RoomConfig>, private tracks: TrackData[], quick: boolean, private log: (m: string) => void, public ranked = false, private store: Store | null = null) {
    this.code = code;
    this.quick = quick;
    this.config = sanitiseConfig(config, { ...DEFAULT_ROOM, isPublic: quick }, tracks.map((t) => t.id));
    if (quick) this.phaseUntil = Date.now() + TIMING.quickStartMs;
  }

  get humans() { return [...this.players.values()]; }
  get connectedCount() { return this.humans.filter((p) => p.connected).length; }
  get full() { return this.players.size >= this.config.maxPlayers; }
  get joinable() { return !this.full && this.phase !== 'closed'; }

  view(): RoomView {
    return {
      code: this.code, phase: this.phase, config: this.config, host: this.host, raceNo: this.raceNo, quick: this.quick, seriesOver: this.seriesOver,
      ranked: this.ranked, waitingForRival: this.ranked && this.phase === 'waiting' && this.connectedCount < 2,
      startsIn: this.phase === 'countdown' ? Math.max(0, this.startAt - Date.now()) : this.quick && this.phase === 'waiting' && !(this.ranked && this.connectedCount < 2) ? Math.max(0, this.phaseUntil - Date.now()) : null,
      lastResults: this.lastResults,
      players: this.humans.map(({ conn, leftAt, ...p }) => { void conn; void leftAt; return p; }),
    };
  }
  broadcast(m: ServerMsg) { for (const p of this.players.values()) if (p.conn && p.connected) p.conn.send(m); }
  sync() { this.broadcast({ t: 'room', room: this.view() }); }

  add(conn: Conn): string | null {
    const existing = this.players.get(conn.id);
    if (existing) { existing.conn = conn; existing.connected = true; existing.card = conn.card; conn.room = this; this.onReconnect(conn.id); this.sync(); return null; }
    if (this.full) return 'full';
    const spectating = this.phase === 'countdown' || this.phase === 'racing' || this.phase === 'finishing';
    this.players.set(conn.id, { id: conn.id, card: conn.card, ready: false, host: false, connected: true, spectating, ping: 0, points: 0, conn, leftAt: 0 });
    conn.room = this;
    if (!this.host || !this.players.get(this.host)?.connected) this.setHost(conn.id);
    this.log(`room ${this.code}: ${conn.card.name} joined (${this.players.size})`);
    this.sync();
    return null;
  }

  private setHost(id: string) {
    for (const p of this.players.values()) p.host = p.id === id;
    this.host = id;
  }

  /** Leaving on purpose. In a race their car keeps going under AI control until the flag. */
  remove(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (p.conn) p.conn.room = null;
    const idx = this.entrantIdx.get(id);
    if (this.sim && idx !== undefined) this.sim.takeOver(idx);
    if (this.host === id) { const next = this.humans.find((h) => h.connected) ?? this.humans[0]; if (next) this.setHost(next.id); else this.host = ''; }
    this.log(`room ${this.code}: ${p.card.name} left (${this.players.size})`);
    if (!this.players.size) this.phase = 'closed';
    this.sync();
  }

  /** A dropped socket. Keep the seat for a while; the AI drives meanwhile. */
  disconnect(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false; p.conn = null; p.leftAt = Date.now(); p.ready = false;
    const idx = this.entrantIdx.get(id);
    if (this.sim && idx !== undefined) this.sim.takeOver(idx);
    if (this.host === id) { const next = this.humans.find((h) => h.connected); if (next) this.setHost(next.id); }
    this.sync();
  }

  private onReconnect(id: string) {
    const p = this.players.get(id)!;
    p.leftAt = 0;
    const idx = this.entrantIdx.get(id);
    if (this.sim && idx !== undefined && (this.phase === 'racing' || this.phase === 'countdown' || this.phase === 'finishing')) {
      // hand the car back and resend the race so their client can rejoin it mid-lap
      this.sim.release(idx);
      this.lastStateAt.set(id, Date.now());
      this.handBackUntil.set(id, Date.now() + 3000);
      p.conn?.send({ t: 'race', race: this.raceStart() });
    }
  }

  setReady(id: string, on: boolean) { const p = this.players.get(id); if (!p || this.phase !== 'waiting') return; p.ready = on; this.sync(); this.maybeAutoStart(); }
  setCar(id: string, card: PlayerCard) {
    const p = this.players.get(id); if (!p) return;
    if (this.config.carClass !== 'any' && carById(card.carId).cls !== this.config.carClass) return;
    p.card = card; this.sync();
  }
  configure(id: string, patch: Partial<RoomConfig>) {
    if (id !== this.host || this.phase !== 'waiting' || this.ranked) return 'not_host';
    this.config = sanitiseConfig(patch, this.config, this.tracks.map((t) => t.id));
    for (const p of this.players.values()) p.ready = false;
    this.sync();
    return null;
  }
  kick(id: string, target: string) {
    if (id !== this.host || target === id || this.ranked) return 'not_host';
    const p = this.players.get(target); if (!p) return null;
    p.conn?.send({ t: 'left', reason: 'kicked' });
    this.remove(target);
    return null;
  }

  private maybeAutoStart() {
    const present = this.humans.filter((p) => p.connected);
    if (this.phase === 'waiting' && present.length && present.every((p) => p.ready) && (present.length >= 2 || !this.quick)) this.beginCountdown();
  }
  requestStart(id: string) {
    if (id !== this.host || (this.ranked && this.connectedCount < 2)) return 'not_host';
    if (this.phase !== 'waiting') return 'in_race';
    this.beginCountdown();
    return null;
  }

  private beginCountdown() {
    const td = this.tracks.find((t) => t.id === this.config.track) ?? this.tracks[0];
    this.raceNo++;
    this.seed = (Math.random() * 1e9) | 0;
    const humans = this.humans.filter((p) => p.connected);
    for (const h of this.humans) h.spectating = !h.connected;
    const entrants: Entrant[] = humans.map((h) => ({ id: h.id, name: h.card.name, carId: h.card.carId, livery: h.card.livery, human: true, crew: h.card.crew, level: h.card.level, look: h.card.look }));
    const aiCount = Math.max(0, Math.min(this.config.aiFill, 12 - entrants.length));
    const personas = makePersonas(aiCount, this.seed);
    const pool = CARS.filter((c) => this.config.carClass === 'any' || c.cls === this.config.carClass);
    for (let i = 0; i < aiCount; i++) {
      const def = pool[(i * 5 + this.seed) % pool.length];
      const lv = defaultLivery(def, `LAG ${100 + ((i * 37 + this.seed) % 900)}`);
      lv.paint = ['#d0141c', '#0d4fa8', '#e6b11e', '#1b8a3a', '#101418', '#e8e2d6', '#ff6a00', '#7a2bd9'][(i + this.seed) % 8];
      entrants.push({ id: `ai${i}`, name: personas[i].name, carId: def.id, livery: lv, human: false, crew: personas[i].crew, look: lookFor(this.seed + i) });
    }
    // humans start at the back half of the grid, AI fill the front: the fun is in the overtaking
    entrants.sort((a, b) => Number(a.human) - Number(b.human));
    this.entrantIdx = new Map(entrants.map((e, i) => [e.id, i]));
    // humans get 25 s after the first of them finishes, 90 s after an AI wins, and no race outlives three times par
    const cfg = { ...defaultRaceConfig(td.id, this.config.laps), mode: this.config.mode, traffic: this.config.traffic, aiLevel: this.config.aiLevel, time: this.config.time, weather: this.config.weather, seed: this.seed, finishGrace: 25, aiFinishGrace: 90, maxTime: Math.round(td.par * this.config.laps * 3 + 90), items: this.config.items };
    this.racePids = new Map(humans.filter((h) => h.conn?.pid).map((h) => [h.id, { pid: h.conn!.pid!, name: h.card.name }]));
    this.aiTime.clear();
    this.sim = new RaceSim(td, cfg, entrants, { authority: true, local: [], countdown: TIMING.countdownMs / 1000 });
    this.startAt = Date.now() + TIMING.countdownMs;
    this.phase = 'countdown';
    this.lastStateAt.clear();
    for (const h of humans) this.lastStateAt.set(h.id, Date.now() + TIMING.countdownMs);
    this.broadcast({ t: 'race', race: this.raceStart() });
    this.sync();
    this.log(`room ${this.code}: race ${this.raceNo} on ${td.id} with ${humans.length} humans, ${aiCount} AI`);
  }

  private raceStart(): RaceStart {
    const sim = this.sim!;
    return { startAt: this.startAt, seed: this.seed, raceNo: this.raceNo, cfg: { track: sim.cfg.track, laps: sim.cfg.laps, mode: sim.cfg.mode, traffic: sim.cfg.traffic, aiLevel: sim.cfg.aiLevel, time: sim.cfg.time, weather: sim.cfg.weather, items: sim.cfg.items }, entrants: sim.cars.map((c) => ({ id: c.entrant.id, name: c.entrant.name, carId: c.entrant.carId, livery: c.entrant.livery, human: c.entrant.human, crew: c.entrant.crew, look: c.entrant.look })) };
  }

  /** A client's report of its own car. Checked against the track and the laws of this game's physics. */
  state(id: string, rt: number, s: RemoteSnap): boolean {
    const sim = this.sim;
    const idx = this.entrantIdx.get(id);
    if (!sim || idx === undefined || (this.phase !== 'racing' && this.phase !== 'countdown' && this.phase !== 'finishing')) return true;
    const rc = sim.cars[idx];
    const now = Date.now();
    const last = this.lastStateAt.get(id) ?? now;
    // hearing from a driver is what hands their car back from an AI stand-in (see tick), so note it first
    this.lastStateAt.set(id, now);
    if (rc.control !== 'remote') return true;
    const vals = [s.x, s.y, s.z, s.h, s.vx, s.vy, s.vz];
    if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return false;
    const c = rc.c;
    const dt = Math.max(0.03, Math.min(1.5, (now - last) / 1000));
    const speed = Math.hypot(s.vx, s.vz);
    const top = rc.def.topSpeed * 1.75 + 6;
    const moved = Math.hypot(s.x - c.x, s.z - c.z);
    const q = sim.track.query(s.x, s.y, s.z, c.hint);
    const respawning = moved > 15 && q.outside < 1; // a tow truck drop lands back on the road
    // just after an AI hand-back the client resyncs from a slightly old snapshot, so allow a short catch-up
    const handBack = (this.handBackUntil.get(id) ?? 0) > now ? 40 : 0;
    const legal = speed <= top && (moved <= top * dt * 1.6 + 6 + handBack || respawning) && q.outside < 9 && Math.abs(s.y - q.groundY) < 30;
    if (!legal) return false;
    if (this.phase === 'countdown' && moved > 3) return false; // no creeping off the grid
    sim.setRemote(idx, s);
    void rt;
    return true;
  }

  useItem(id: string) {
    const idx = this.entrantIdx.get(id);
    if (!this.sim || idx === undefined || this.phase !== 'racing') return;
    const rc = this.sim.cars[idx];
    if (rc.control !== 'remote' || !rc.c.item || rc.c.itemRoll > 0) return;
    // the authority uses the item exactly as it would for a local car
    this.sim.useItem(rc);
  }

  /** Server tick: step the race, broadcast snapshots and events, run the lifecycle clock. */
  tick(dt: number) {
    const now = Date.now();
    if (this.phase === 'waiting' && this.quick && now >= this.phaseUntil) {
      // a ranked room needs two drivers; on its own it keeps waiting with a fresh clock
      if (this.ranked && this.connectedCount < 2) this.phaseUntil = now + TIMING.quickStartMs;
      else if (this.connectedCount > 0) this.beginCountdown();
    }
    if (this.sim && (this.phase === 'countdown' || this.phase === 'racing' || this.phase === 'finishing')) {
      // keep the sim clock locked to the room clock
      const target = (now - this.startAt) / 1000;
      let guard = 0;
      while (this.sim.time < target && guard++ < 12) {
        this.sim.step(Math.min(1 / 30, target - this.sim.time + 1e-6));
        this.collect(this.sim.drainEvents());
      }
      if (this.phase === 'countdown' && this.sim.phase === 'racing') { this.phase = 'racing'; this.sync(); }
      // quiet drivers get an AI stand-in until they report again
      for (const [pid, at] of this.lastStateAt) {
        const idx = this.entrantIdx.get(pid);
        if (idx === undefined) continue;
        const rc = this.sim.cars[idx];
        if (rc.control === 'ai' && this.phase !== 'countdown') this.aiTime.set(pid, (this.aiTime.get(pid) ?? 0) + dt);
        if (rc.control === 'remote' && now - at > TIMING.afkRaceMs && this.phase === 'racing') this.sim.takeOver(idx);
        else if (rc.control === 'ai' && now - at < 400 && this.players.get(pid)?.connected) { this.sim.release(idx); this.handBackUntil.set(pid, now + 2000); }
      }
      this.snapAcc += dt;
      if (this.snapAcc >= 0.05) { this.snapAcc = 0; this.snapshot(); }
      if (this.pendingEvents.length) { this.broadcast({ t: 'ev', events: this.pendingEvents }); this.pendingEvents = []; }
      if (this.phase === 'racing' && this.sim.finishOrder.length) { this.phase = 'finishing'; this.sync(); }
      if (this.sim.phase === 'done') this.finishRace();
    }
    if (this.phase === 'results' && now >= this.phaseUntil) {
      this.phase = 'waiting';
      for (const p of this.humans) { p.ready = false; p.spectating = false; }
      // a finished series starts over: race 1, everyone on zero points
      if (this.seriesOver) { this.seriesOver = false; this.raceNo = 0; for (const p of this.humans) p.points = 0; }
      if (this.quick) this.phaseUntil = now + TIMING.quickStartMs;
      this.sync();
    }
    // seats of drivers who never came back
    for (const p of this.humans) if (!p.connected && p.leftAt && now - p.leftAt > TIMING.reconnectMs) this.remove(p.id);
  }

  private collect(evs: RaceEvent[]) {
    // only what other machines need: item grants, hits, hazards, laps, finishes, places
    for (const e of evs) if (['item', 'hit', 'hazard', 'hazardGone', 'blackout', 'pickup', 'lap', 'finish', 'useItem', 'horn', 'dodge', 'shunt', 'go', 'countdown'].includes(e.t)) this.pendingEvents.push(e);
  }

  private snapshot() {
    const sim = this.sim!;
    const cars: SnapCar[] = sim.cars.map((rc, i) => ({ i, s: sim.snapOf(i), lap: rc.c.lap, place: rc.c.place, fin: rc.c.finished, rd: Math.round(rc.c.raceDist * 100) / 100 }));
    const hz = sim.hazards.map((h) => packHazard({ id: h.id, k: h.kind, x: h.x, y: h.y, z: h.z, h: h.h, s: h.s, d: h.d }));
    this.broadcast({ t: 'snap', st: Date.now(), rt: Math.round(sim.time * 1000) / 1000, c: cars.map(packCar), z: hz });
  }

  /**
   * Lap records from every online race, and ratings from ranked ones. Only what a driver did themselves counts:
   * a car an AI stand-in drove for a third of the race, or one whose driver left or never came back, is a DNF
   * for the rating, and a lap only counts if its driver was never replaced.
   */
  private record(rows: ResultRow[], raceTime: number) {
    const store = this.store!;
    const own = (id: string, share: number) => (this.aiTime.get(id) ?? 0) <= Math.max(0, raceTime) * share;
    for (const r of rows) {
      const who = this.racePids.get(r.id);
      if (who && r.bestLap && own(r.id, 0.02)) store.lap(this.sim!.cfg.track, who.pid, who.name, r.bestLap, r.carId);
    }
    if (!this.ranked) return;
    const rated = rows.filter((r) => r.human && this.racePids.has(r.id));
    if (rated.length < 2) return;
    const result = store.rate(rated.map((r) => {
      const p = this.players.get(r.id);
      const finished = r.time !== null && !!p?.connected && own(r.id, 0.3);
      return { pid: this.racePids.get(r.id)!.pid, name: this.racePids.get(r.id)!.name, place: r.place, finished };
    }));
    for (const r of rated) {
      const pid = this.racePids.get(r.id)!.pid;
      const x = result.get(pid);
      if (!x) continue;
      r.rating = x.rating; r.delta = x.delta;
      const rec = store.find(pid)!;
      this.players.get(r.id)?.conn?.send({ t: 'rank', me: { pid, rating: rec.rating, races: rec.races, wins: rec.wins, rank: store.rankOf(pid) } });
    }
  }

  private finishRace() {
    const sim = this.sim!;
    const rows: ResultRow[] = sim.standings().map((s) => ({ id: s.id, name: s.name, human: s.human, place: s.place, time: s.time, bestLap: s.bestLap, carId: s.carId, points: POINTS[s.place - 1] ?? 0 }));
    for (const r of rows) { const p = this.players.get(r.id); if (p) p.points += r.points; }
    if (this.store) this.record(rows, sim.time);
    this.lastResults = rows;
    this.seriesOver = this.raceNo >= this.config.races;
    this.broadcast({ t: 'results', rows });
    this.phase = 'results';
    this.phaseUntil = Date.now() + TIMING.resultsMs;
    this.sim = null;
    this.sync();
    this.log(`room ${this.code}: race ${this.raceNo} done, winner ${rows[0]?.name}`);
  }
}

export class Rooms {
  rooms = new Map<string, Room>();
  queue: Conn[] = [];
  constructor(public tracks: TrackData[], private log: (m: string) => void, private store: Store | null = null) {}

  newCode() {
    for (let i = 0; i < 2000; i++) { const c = `LAGOS-${String(Math.floor(1000 + Math.random() * 9000))}`; if (!this.rooms.has(c)) return c; }
    throw new Error('no free room codes');
  }
  create(conn: Conn, config: Partial<RoomConfig>, quick = false, ranked = false) {
    const room = new Room(this.newCode(), config, this.tracks, quick, this.log, ranked, this.store);
    this.rooms.set(room.code, room);
    room.add(conn);
    return room;
  }
  /** Quick match: the fullest public room still waiting, or a fresh one with AI fill. Ranked rooms are humans
   *  only, on fixed rules nobody can change: two laps of Rush with power-ups, any car. */
  match(conn: Conn, ranked = false) {
    const open = [...this.rooms.values()].filter((r) => r.quick && r.ranked === ranked && r.config.isPublic && r.phase === 'waiting' && r.joinable).sort((a, b) => b.players.size - a.players.size);
    if (open[0]) { open[0].add(conn); return open[0]; }
    const tracks = this.tracks.filter((t) => !t.reverse || Math.random() < 0.3);
    const td = tracks[Math.floor(Math.random() * tracks.length)];
    if (ranked) return this.create(conn, { track: td.id, laps: 2, isPublic: true, maxPlayers: 8, aiFill: 0, mode: 'rush', traffic: 1, aiLevel: 'normal', carClass: 'any', items: true, races: 1, time: 'dusk', weather: 'clear' }, true, true);
    return this.create(conn, { track: td.id, laps: Math.min(3, td.laps), isPublic: true, maxPlayers: 8, aiFill: 7, mode: 'rush' }, true);
  }
  tick(dt: number) {
    for (const [code, r] of this.rooms) {
      r.tick(dt);
      if (r.phase === 'closed' || (r.players.size === 0 && Date.now() - r.createdAt > 5000)) { this.rooms.delete(code); this.log(`room ${code} closed`); }
    }
  }
  stats() { let players = 0; for (const r of this.rooms.values()) players += r.connectedCount; return { rooms: this.rooms.size, players }; }
}
