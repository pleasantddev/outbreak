import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, http, makePlayer, TestClient, type TestServer } from './helpers.ts';
import { F, isVehicleId, VKINDS, type PlayerEnt, type VehEnt, cm } from '../../v2/src/net/protocol.ts';
import { judgeMove, newMoveState, strike } from '../src/realtime/antiCheat.ts';
import { Grid, cellCoord, keyOf, roomOf, type GridNode } from '../src/realtime/grid.ts';

let s: TestServer;
beforeAll(async () => { s = await boot({ adminEmail: 'boss@hustlelife.test', adminPassword: 'correct horse battery' }); });
afterAll(async () => { await s.close(); });

const mk = async (name: string) => { const p = await makePlayer(s, name); return { ...p, c: await new TestClient(s, p.token).connect() }; };
const car = (x: number, z: number, over: object = {}) => ({ veh: { kind: 3, seat: 0, seed: 4242, x, y: 0.4, z, qx: 0, qy: 0.7071, qz: 0, qw: 0.7071, steer: 0.2, spin: 1, doors: [0, 0, 0, 0] as [number, number, number, number], vflags: 1, vspeed: 8, ...over } });

describe('grid', () => {
  it('moves nodes between cells and finds neighbours', () => {
    const g = new Grid<GridNode & { name: string }>();
    const mkn = (id: number, name: string) => ({ id, name, x: 0, z: 0, cx: 0, cz: 0, key: -1 });
    const a = mkn(1, 'a'), b = mkn(2, 'b'), far = mkn(3, 'far');
    g.put(a, 10, 10); g.put(b, 300, 10); g.put(far, 5000, 5000);
    expect(g.size).toBe(3);
    const seen: string[] = []; g.around(cellCoord(10), cellCoord(10), 1, (n) => seen.push(n.name)); expect(seen.sort()).toEqual(['a', 'b']);
    const near: string[] = []; g.near(10, 10, 100, (n) => near.push(n.name)); expect(near).toEqual(['a']);
    expect(g.put(a, 20, 20)).toBe(false); expect(g.put(a, 600, 10)).toBe(true);
    const seen2: string[] = []; g.around(cellCoord(10), cellCoord(10), 1, (n) => seen2.push(n.name)); expect(seen2).toEqual(['b']);
    g.remove(far); expect(g.size).toBe(2); expect(g.cellCount()).toBe(2);
    expect(roomOf(0, 0)).toBe('0,0'); expect(roomOf(8, -1)).toBe('1,-1'); expect(keyOf(1, 2)).not.toBe(keyOf(2, 1));
  });
});

describe('anti cheat judgement', () => {
  const T0 = 1_000_000; const bounds: [number, number, number, number] = [-22000, -20500, 12000, 12500];
  const msg = (x: number, z: number, o: object = {}) => ({ seq: 1, flags: F.ALIVE, x, y: 0, z, yaw: 0, pitch: 0, speed: 0, anim: 0, weapon: 0, veh: null, ...o });
  it('lets honest running through and catches speed hacks', () => {
    const st = newMoveState(0, 0, 0, T0); let t = T0, x = 0;
    for (let i = 0; i < 100; i++) { t += 66; x += 0.5; expect(judgeMove(st, msg(x, 0), t, bounds).ok).toBe(true); st.x = x; st.at = t; } // 7.5 m/s
    t += 66; const fast = judgeMove(st, msg(x + 120, 0), t, bounds); expect(fast.ok).toBe(false);
  });
  it('allows a burst after a lag spike, but not unlimited distance', () => {
    const st = newMoveState(0, 0, 0, T0);
    expect(judgeMove(st, msg(40, 0), T0 + 4000, bounds).ok).toBe(true); // 4 s of lag at 10 m/s
    const st2 = newMoveState(0, 0, 0, T0); const v = judgeMove(st2, msg(900, 0), T0 + 4000, bounds); expect(v.ok).toBe(false); expect((v as any).hard).toBe(true); expect((v as any).reason).toBe('teleport');
  });
  it('cars get their own top speed; a sedan at 33 m/s is fine, on foot it is not', () => {
    const st = newMoveState(0, 0, 0, T0); let t = T0, x = 0;
    for (let i = 0; i < 60; i++) { t += 66; x += 2.2; expect(judgeMove(st, msg(x, 0, car(x, 0)), t, bounds).ok).toBe(true); st.x = x; st.at = t; }
    const st2 = newMoveState(0, 0, 0, T0); t = T0; x = 0; let bad = 0;
    for (let i = 0; i < 150; i++) { t += 66; x += 2.2; const v = judgeMove(st2, msg(x, 0), t, bounds); if (v.ok) { st2.x = x; st2.at = t; } else bad++; }
    expect(bad).toBeGreaterThan(80);
  });
  it('rejects bounds, NaN and a car that is not where the driver is', () => {
    const st = newMoveState(0, 0, 0, T0);
    expect(judgeMove(st, msg(1e6, 0), T0 + 100, bounds)).toMatchObject({ ok: false, reason: 'bounds' });
    expect(judgeMove(st, msg(NaN, 0), T0 + 100, bounds)).toMatchObject({ ok: false, reason: 'nan' });
    expect(judgeMove(st, msg(0, 0, car(300, 0)), T0 + 100, bounds)).toMatchObject({ ok: false, reason: 'vehicle-detached' });
    expect(judgeMove(st, msg(0, 500), T0 + 100, bounds)).toMatchObject({ ok: false });
  });
  it('strikes decay and eventually earn a kick', () => {
    const st = newMoveState(0, 0, 0, T0);
    expect(strike(st, T0, 3)).toBe(false); expect(strike(st, T0 + 100, 3)).toBe(false); expect(strike(st, T0 + 200, 3)).toBe(false); expect(strike(st, T0 + 300, 3)).toBe(true);
    const st2 = newMoveState(0, 0, 0, T0); expect(strike(st2, T0, 3)).toBe(false); expect(strike(st2, T0 + 60_000, 3)).toBe(false); expect(st2.strikes).toBe(3);
  });
});

describe('realtime world', () => {
  it('two players near each other see one another, with names and looks, and a far one stays out of view', async () => {
    const a = await mk('Alpha Ade'); const b = await mk('Bravo Bisi'); const far = await mk('Far Femi');
    a.c.state(1000, 1000); b.c.state(1030, 1010, { weapon: 2, anim: 3 }); far.c.state(4000, 4000);
    await a.c.until(() => a.c.known.size >= 1); await b.c.until(() => b.c.known.size >= 1);
    const seenByA = a.c.known.get(b.c.id) as PlayerEnt; expect(seenByA).toBeTruthy();
    expect(seenByA.X).toBe(cm(1030)); expect(seenByA.Z).toBe(cm(1010)); expect(seenByA.weapon).toBe(2); expect(seenByA.anim).toBe(3);
    expect(a.c.who.get(b.c.id)).toMatchObject({ name: 'Bravo Bisi', model: 'survivor' });
    expect(a.c.known.has(far.c.id)).toBe(false); expect(a.c.known.has(a.c.id)).toBe(false);
    // movement arrives as updates
    b.c.state(1040, 1010); await a.c.until(() => (a.c.known.get(b.c.id) as PlayerEnt).X === cm(1040));
    // the far player walks into range and appears; the one who left disappears
    await far.c.act('tp'); far.c.state(1020, 1000); await a.c.until(() => a.c.known.has(far.c.id));
    s.hub.conns.get(far.c.id)!.ms.lastTp = -1e9; // skip the teleport cool down for the test
    await far.c.act('tp'); far.c.state(4000, 4000); await a.c.until(() => !a.c.known.has(far.c.id), 4000);
    [a, b, far].forEach((x) => x.c.close());
  });
  it('shows a driver\'s car with its doors and lights, and leaves it parked when they get out', async () => {
    const a = await mk('Viewer Vic'); const d = await mk('Driver Dayo');
    a.c.state(2000, 2000); d.c.state(2050, 2000, car(2050, 2000));
    await a.c.until(() => [...a.c.known.keys()].some(isVehicleId));
    const v = [...a.c.known.values()].find((e) => isVehicleId(e.id)) as VehEnt;
    expect(VKINDS[v.kind]).toBe('sedan'); expect(v.seed).toBe(4242); expect(v.driver).toBe(d.c.id); expect(v.vflags & 1).toBe(1); expect(v.X).toBe(cm(2050));
    const dent = a.c.known.get(d.c.id) as PlayerEnt; expect(dent.veh).toBe(v.id); expect(dent.flags & F.VEH).toBeTruthy();
    d.c.state(2051, 2000); // out of the car
    await a.c.until(() => (a.c.known.get(v.id) as VehEnt | undefined)?.driver === 0 && (a.c.known.get(d.c.id) as PlayerEnt).veh === 0);
    expect(s.hub.vehicles.size).toBe(1);
    d.c.close(); await a.c.until(() => !a.c.known.has(v.id)); expect(s.hub.vehicles.size).toBe(0);
    a.c.close();
  });
  it('proximity chat stays near, global chat reaches everyone, whispers go to one, spam is limited', async () => {
    const a = await mk('Chatty Chi'); const n = await mk('Near Nkem'); const f = await mk('Far Fola');
    a.c.state(500, 500); n.c.state(520, 500); f.c.state(8000, 8000);
    await a.c.until(() => a.c.known.size >= 1);
    a.c.send({ t: 'chat', ch: 'near', text: 'hello neighbour' });
    await n.c.until(() => n.c.of('chat').some((m) => m.text === 'hello neighbour'));
    await new Promise((r) => setTimeout(r, 120)); expect(f.c.of('chat').some((m) => m.text === 'hello neighbour')).toBe(false);
    a.c.send({ t: 'chat', ch: 'global', text: 'whole of Lagos' }); await f.c.until(() => f.c.of('chat').some((m) => m.text === 'whole of Lagos'));
    a.c.send({ t: 'whisper', to: 'far fola', text: 'psst' }); await f.c.until(() => f.c.of('chat').some((m) => m.ch === 'whisper' && m.text === 'psst'));
    expect(n.c.of('chat').some((m) => m.text === 'psst')).toBe(false);
    a.c.send({ t: 'chat', ch: 'global', text: 'sh*t fuck this' }); await n.c.until(() => n.c.of('chat').some((m) => /this$/.test(m.text)));
    expect(n.c.of('chat').at(-1).text).not.toMatch(/fuck/i);
    for (let i = 0; i < 12; i++) a.c.send({ t: 'chat', ch: 'global', text: 'spam ' + i });
    await new Promise((r) => setTimeout(r, 200)); expect(f.c.of('chat').filter((m) => /^spam/.test(m.text)).length).toBeLessThanOrEqual(6);
    const log = s.db.prepare("SELECT COUNT(*) n FROM chat_log WHERE name='Chatty Chi'").get() as { n: number }; expect(log.n).toBeGreaterThan(2);
    [a, n, f].forEach((x) => x.c.close());
  });
  it('emotes reach people nearby', async () => {
    const a = await mk('Emote Em'); const b = await mk('Watcher Wale'); a.c.state(100, 100); b.c.state(110, 100);
    await b.c.until(() => b.c.known.has(a.c.id)); a.c.send({ t: 'emote', id: 'dance' });
    await b.c.until(() => b.c.of('emote').some((m) => m.id === a.c.id && m.e === 'dance')); [a, b].forEach((x) => x.c.close());
  });
  it('a teleport hack gets rubber banded back with a fix, and a speed hacker is eventually kicked', async () => {
    const a = await mk('Hacker Hank'); a.c.state(3000, 3000); await new Promise((r) => setTimeout(r, 60));
    a.c.state(3900, 3000); await a.c.until(() => a.c.of('fix').length);
    const fix = a.c.of('fix')[0]; expect(fix.x).toBeCloseTo(3000, 0); expect(['teleport', 'speed']).toContain(fix.why);
    for (let i = 0; i < 12 && !a.c.closed; i++) { await new Promise((r) => setTimeout(r, 330)); a.c.state(3000 + 800 * (i + 1), 3000); }
    await a.c.until(() => a.c.closed, 4000); expect(a.c.closed!.code).toBe(4410);
    expect(s.api.economy.flags(a.accountId).length).toBeGreaterThan(0);
  });
  it('a granted respawn teleport is allowed once', async () => {
    const a = await mk('Respawn Rae'); a.c.state(100, 100); await new Promise((r) => setTimeout(r, 60));
    expect((await a.c.act('respawn')).ok).toBe(true); a.c.state(2600, 700);
    await new Promise((r) => setTimeout(r, 150)); expect(a.c.of('fix').length).toBe(0);
    a.c.state(5600, 700); await a.c.until(() => a.c.of('fix').length); a.c.close();
  });
  it('one connection per account, and bans kick live players and block reconnecting', async () => {
    const p = await makePlayer(s, 'Double Dee'); const c1 = await new TestClient(s, p.token).connect(); const c2 = await new TestClient(s, p.token).connect();
    await c1.until(() => c1.closed); expect(c1.closed!.code).toBe(4409); expect(c2.closed).toBeNull();
    s.api.accounts.ban(p.accountId, { reason: 'Test ban' });
    await c2.until(() => c2.closed); expect(c2.of('kick')[0].reason).toMatch(/Test ban/);
    const c3 = await new TestClient(s, p.token).connect(); expect(c3.closed!.code).toBe(4401); // sessions revoked by the ban
    const login = await http(s, 'POST', '/api/auth/login', { identifier: p.email, password: 'hunter2hunter2' }); expect(login.status).toBe(403);
  });
  it('rejects bad tokens, old protocol versions and players without a profile', async () => {
    const bad = await new TestClient(s, 'nonsense.token.here').connect(); expect(bad.closed!.code).toBe(4401);
    const r = await http(s, 'POST', '/api/auth/signup', { identifier: 'noprofile@example.com', password: 'longenough1' });
    const np = await new TestClient(s, r.json.token).connect(); expect(np.closed!.code).toBe(4404);
  });
  it('survives garbage frames and keeps serving others', async () => {
    const a = await mk('Fuzz Fred'); const b = await mk('Calm Kemi'); a.c.state(10, 10); b.c.state(20, 10);
    for (let i = 0; i < 200; i++) { const buf = Buffer.alloc(1 + Math.floor(Math.random() * 60)); for (let j = 0; j < buf.length; j++) buf[j] = Math.random() * 256; a.c.ws.send(buf); a.c.ws.send(buf.toString('latin1')); }
    await new Promise((r) => setTimeout(r, 200));
    b.c.state(21, 10); await b.c.until(() => b.c.known.has(a.c.id)); [a, b].forEach((x) => x.c.close());
  });
  it('reports rooms and stats for the admin tools', async () => {
    const a = await mk('Roomy Rim'); a.c.state(100, 100); await new Promise((r) => setTimeout(r, 100));
    expect(s.hub.rooms().find((r) => r.key === '0,0')!.players).toBeGreaterThanOrEqual(1);
    expect(s.api.online.list().some((p) => p.name === 'Roomy Rim')).toBe(true);
    expect(s.api.online.stats()).toMatchObject({ online: expect.any(Number), ticks: expect.any(Number) });
    expect(s.api.online.teleport(a.accountId, 50, 50)).toBe(true); await a.c.until(() => a.c.of('fix').some((m) => m.why === 'admin')); a.c.close();
  });
});
