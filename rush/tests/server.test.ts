// Room server integration tests: real WebSockets against a real server on a random port, with the room clock
// shortened so a whole lifecycle (lobby, countdown, race, results, next race) runs in a few seconds.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import { TIMING, type Rooms } from '../server/rooms';
import { PROTOCOL_VERSION, packState, unpackCar, type ClientMsg, type ServerMsg, type RoomView, type RaceStart } from '../src/shared/protocol';
import { defaultLivery, carById } from '../src/shared/cars';

process.env.QUIET = '1';
let port = 0, close: () => Promise<void>, rooms: Rooms;

beforeAll(async () => {
  Object.assign(TIMING, { countdownMs: 400, resultsMs: 300, reconnectMs: 1500, afkRaceMs: 500, quickStartMs: 600 });
  const s = await createServer(0);
  port = s.port; close = s.close; rooms = s.rooms;
});
afterAll(async () => { await close(); });

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  you = ''; token = '';
  private listeners: (() => void)[] = [];
  constructor(public name: string, token?: string, version = PROTOCOL_VERSION) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (d) => { const m = JSON.parse(String(d)) as ServerMsg; this.msgs.push(m); if (m.t === 'welcome') { this.you = m.you; this.token = m.token; } for (const l of this.listeners) l(); });
    this.ws.on('open', () => this.raw({ t: 'hello', v: version, token, card: { id: '', name, crew: 'Test Crew', color: '#39d0ff', level: 4, carId: 'tokunbo', livery: defaultLivery(carById('tokunbo')) } }));
  }
  raw(m: unknown) { this.ws.send(JSON.stringify(m)); }
  send(m: ClientMsg) { this.raw(m); }
  mark() { return this.msgs.length; }
  /** First message at or after `from` that matches. */
  wait<T extends ServerMsg['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true, from = 0, ms = 4000): Promise<Msg<T>> {
    return new Promise((resolve, reject) => {
      const check = () => { for (let i = from; i < this.msgs.length; i++) { const m = this.msgs[i]; if (m.t === t && pred(m as Msg<T>)) { cleanup(); resolve(m as Msg<T>); return true; } } return false; };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`${this.name}: no ${t} within ${ms} ms`)); }, ms);
      const cleanup = () => { clearTimeout(timer); this.listeners = this.listeners.filter((l) => l !== check); };
      if (!check()) this.listeners.push(check);
    });
  }
  room(from = 0, pred: (r: RoomView) => boolean = () => true) { return this.wait('room', (m) => pred(m.room), from).then((m) => m.room); }
  async ready() { await this.wait('welcome'); return this; }
  close() { this.ws.close(); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function roomWithTwo(cfg: Record<string, unknown> = {}) {
  const a = await new Client('Adaeze').ready();
  a.send({ t: 'create', config: { laps: 1, aiFill: 1, maxPlayers: 4, ...cfg } });
  const r0 = await a.room();
  const b = await new Client('Kola').ready();
  const mb = b.mark();
  b.send({ t: 'join', code: r0.code.slice(-4) }); // the four digits are enough
  const rb = await b.room(mb);
  return { a, b, code: rb.code };
}

describe('room server', () => {
  it('rejects an old client version', async () => {
    const c = new Client('Oldie', undefined, 0);
    const e = await c.wait('error');
    expect(e.code).toBe('bad_version');
    c.close();
  });

  it('creates a private room with a LAGOS code and makes the creator host', async () => {
    const a = await new Client('Host').ready();
    expect(a.token).toMatch(/^[0-9a-f]{32}$/);
    a.send({ t: 'create', config: { track: 'oshodi', laps: 9, maxPlayers: 40, aiFill: -3, mode: 'trial' } as never });
    const r = await a.room();
    expect(r.code).toMatch(/^LAGOS-\d{4}$/);
    expect(r.host).toBe(a.you);
    // whatever the client asks for, the server clamps it
    expect(r.config.laps).toBe(6);
    expect(r.config.maxPlayers).toBe(12);
    expect(r.config.aiFill).toBe(0);
    expect(r.config.mode).toBe('street'); // time trial is solo only
    expect(r.config.isPublic).toBe(false);
    a.close();
  });

  it('joins by code, refuses unknown codes, and only lets the host change the race', async () => {
    const { a, b, code } = await roomWithTwo();
    const ra = await a.room(0, (r) => r.players.length === 2);
    expect(ra.players.map((p) => p.card.name).sort()).toEqual(['Adaeze', 'Kola']);
    const c = await new Client('Lost').ready();
    c.send({ t: 'join', code: 'LAGOS-0000' === code ? 'LAGOS-0001' : 'LAGOS-0000' });
    expect((await c.wait('error')).code).toBe('not_found');
    const mb = b.mark();
    b.send({ t: 'config', patch: { laps: 5 } });
    expect((await b.wait('error', () => true, mb)).code).toBe('not_host');
    const ma = a.mark();
    a.send({ t: 'config', patch: { laps: 2, weather: 'rain' } });
    const r2 = await a.room(ma, (r) => r.config.laps === 2);
    expect(r2.config.weather).toBe('rain');
    a.close(); b.close(); c.close();
  });

  it('turns away players when the room is full', async () => {
    const { a, b, code } = await roomWithTwo({ maxPlayers: 2 });
    const c = await new Client('Third').ready();
    c.send({ t: 'join', code });
    expect((await c.wait('error')).code).toBe('full');
    a.close(); b.close(); c.close();
  });

  it('runs a race: start, relay state, reject impossible moves, results, then the room reopens', async () => {
    const { a, b, code } = await roomWithTwo({ aiFill: 2, races: 1 });
    const room = rooms.rooms.get(code)!;
    b.send({ t: 'ready', on: true });
    await sleep(80);
    const ma = a.mark(), mb = b.mark();
    a.send({ t: 'start' });
    const ra = await a.wait('race', () => true, ma), rb = await b.wait('race', () => true, mb);
    const race: RaceStart = ra.race;
    expect(rb.race.seed).toBe(race.seed);
    expect(race.entrants).toHaveLength(4);
    expect(race.entrants.filter((e) => e.human).map((e) => e.id).sort()).toEqual([a.you, b.you].sort());
    // humans start at the back of the grid
    expect(race.entrants.slice(-2).every((e) => e.human)).toBe(true);
    const ia = race.entrants.findIndex((e) => e.id === a.you);
    // wait for GO and a snapshot that shows our car
    await a.room(ma, (r) => r.phase === 'racing');
    const snap = await a.wait('snap', (m) => m.rt > 0.1, ma);
    const mine = snap.c.map(unpackCar).find((c) => c.i === ia)!;
    expect(mine).toBeTruthy();
    // snapshots travel packed: well under 120 bytes of JSON per car before socket compression
    expect(JSON.stringify(snap).length / snap.c.length).toBeLessThan(120);
    // a legal nudge forward is accepted and shows up for the other player
    const fx = Math.sin(mine.s.h), fz = Math.cos(mine.s.h);
    const moved = { ...mine.s, x: mine.s.x + fx * 1.5, z: mine.s.z + fz * 1.5, vx: fx * 20, vz: fz * 20 };
    await sleep(60);
    a.send({ t: 'state', rt: snap.rt + 0.1, s: packState(moved) });
    const seen = await b.wait('snap', (m) => { const c = m.c.map(unpackCar).find((x) => x.i === ia); return !!c && Math.abs(c.s.x - moved.x) < 0.011 && Math.abs(c.s.z - moved.z) < 0.011; }, mb);
    expect(seen).toBeTruthy();
    // teleports, impossible speeds and garbage are ignored
    const before = { x: room.sim!.cars[ia].c.x, z: room.sim!.cars[ia].c.z };
    a.send({ t: 'state', rt: snap.rt + 0.2, s: packState({ ...moved, x: moved.x + 400 }) });
    a.send({ t: 'state', rt: snap.rt + 0.3, s: packState({ ...moved, vx: 900 }) });
    a.raw({ t: 'state', rt: 1, s: [...packState(moved).slice(0, 13), 'boom'] });
    a.raw({ t: 'state', rt: 1, s: packState(moved).slice(0, 9) });
    a.raw({ t: 'state', rt: 1, s: { x: 1 } });
    await sleep(150);
    expect(room.sim!.cars[ia].c.x).toBeCloseTo(before.x, 5);
    expect(room.sim!.cars[ia].c.z).toBeCloseTo(before.z, 5);
    // the host cannot touch the race once it runs
    const mc = a.mark();
    a.send({ t: 'config', patch: { laps: 4 } });
    expect((await a.wait('error', () => true, mc)).code).toBe('not_host');
    // end the race on the server: results reach both players, points go to the winner, the series ends
    room.sim!.end();
    const res = await b.wait('results', () => true, mb);
    expect(res.rows).toHaveLength(4);
    expect(res.rows.map((r) => r.place)).toEqual([1, 2, 3, 4]);
    const after = await a.room(ma, (r) => r.phase === 'results');
    expect(after.seriesOver).toBe(true);
    expect(after.lastResults?.length).toBe(4);
    // the room reopens for the next series with everyone back on zero
    const open = await a.room(ma, (r) => r.phase === 'waiting' && r.raceNo === 0);
    expect(open.players.every((p) => p.points === 0 && !p.ready)).toBe(true);
    a.close(); b.close();
  });

  it('hands a quiet driver to an AI stand-in, and back when they report again', async () => {
    const { a, b, code } = await roomWithTwo({ aiFill: 0 });
    const room = rooms.rooms.get(code)!;
    const ma = a.mark();
    b.send({ t: 'ready', on: true });
    a.send({ t: 'start' });
    const race = (await a.wait('race', () => true, ma)).race;
    const ib = race.entrants.findIndex((e) => e.id === b.you);
    await a.room(ma, (r) => r.phase === 'racing');
    await sleep(TIMING.afkRaceMs + 300);
    expect(room.sim!.cars[ib].control).toBe('ai');
    // b speaks up with its car where the room has it: control comes back
    const snap = await b.wait('snap', (m) => m.rt > 0, b.mark());
    const cb = snap.c.map(unpackCar).find((c) => c.i === ib)!;
    b.send({ t: 'state', rt: snap.rt, s: packState(cb.s) });
    await sleep(200);
    expect(room.sim!.cars[ib].control).toBe('remote');
    a.close(); b.close();
  });

  it('keeps a dropped seat, restores it with the reconnect token, and migrates host when the host leaves', async () => {
    const { a, b, code } = await roomWithTwo();
    const room = rooms.rooms.get(code)!;
    const token = b.token, id = b.you;
    b.close();
    await a.room(a.mark(), (r) => r.players.some((p) => p.id === id && !p.connected));
    // same token, same identity, same seat
    const b2 = new Client('Kola', token);
    await b2.ready();
    expect(b2.you).toBe(id);
    await b2.room(0, (r) => r.code === code);
    expect(room.players.get(id)?.connected).toBe(true);
    // host leaves on purpose: b becomes host
    const mb = b2.mark();
    a.send({ t: 'leave' });
    const r = await b2.room(mb, (x) => x.players.length === 1);
    expect(r.host).toBe(id);
    a.close(); b2.close();
  });

  it('strips markup from player names before anyone else sees them', async () => {
    const a = await new Client('<img src=x onerror=alert(1)>').ready();
    a.send({ t: 'create', config: {} });
    const r = await a.room();
    const name = r.players[0].card.name;
    expect(name).not.toMatch(/[<>=()]/);
    expect(name.length).toBeLessThanOrEqual(16);
    a.close();
  });

  it('lets the host kick, and kicked players are told', async () => {
    const { a, b } = await roomWithTwo();
    const mb = b.mark();
    a.send({ t: 'kick', id: b.you });
    const left = await b.wait('left', () => true, mb);
    expect(left.reason).toBe('kicked');
    a.close(); b.close();
  });

  it('rate limits chat and only relays the fixed phrases', async () => {
    const { a, b } = await roomWithTwo();
    const mb = b.mark();
    for (let i = 0; i < 12; i++) a.send({ t: 'chat', phrase: i % 5 });
    a.send({ t: 'chat', phrase: 999 });
    await sleep(300);
    const chats = b.msgs.slice(mb).filter((m) => m.t === 'chat');
    expect(chats.length).toBeGreaterThan(0);
    expect(chats.length).toBeLessThanOrEqual(3);
    expect(chats.every((m) => m.t === 'chat' && m.phrase < 20)).toBe(true);
    a.close(); b.close();
  });

  it('quick match puts players together and starts with AI fill after the wait', async () => {
    const a = await new Client('Quick1').ready();
    a.send({ t: 'quick' });
    const r1 = await a.room();
    expect(r1.quick).toBe(true);
    expect(r1.config.isPublic).toBe(true);
    const b = await new Client('Quick2').ready();
    b.send({ t: 'quick' });
    const r2 = await b.room();
    expect(r2.code).toBe(r1.code);
    const race = await a.wait('race', () => true, 0, 3000);
    expect(race.race.entrants.length).toBeGreaterThan(2);
    a.close(); b.close();
  });

  it('reports health', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.version).toBe(PROTOCOL_VERSION);
  });
});
