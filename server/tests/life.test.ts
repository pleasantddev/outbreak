import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, makePlayer, TestClient, type TestServer } from './helpers.ts';
import { judgeMove, newMoveState } from '../src/realtime/antiCheat.ts';
import { F } from '../../v2/src/net/protocol.ts';

let s: TestServer;
beforeAll(async () => { s = await boot(); });
afterAll(async () => { await s.close(); });
const mk = async (name: string) => { const p = await makePlayer(s, name); return { ...p, c: await new TestClient(s, p.token).connect() }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('interiors (GTA Online style loaded rooms)', () => {
  const B: [number, number, number, number] = [-22000, -20500, 12000, 12500];
  const msg = (x: number, z: number) => ({ seq: 1, flags: F.ALIVE, x, y: 0, z, yaw: 0, pitch: 0, speed: 0, anim: 0, weapon: 0, veh: null });
  it('refuses the interior zone without a door, allows one hop in with it, and the way out only near the door', () => {
    const st = newMoveState(900, 0, -330, 1000);
    expect(judgeMove(st, msg(32000, 36001), 1100, B).ok).toBe(false);
    st.interior = 'casino'; st.doorFrom = { x: 900, z: -330 }; st.tpUntil = 4000;
    expect(judgeMove(st, msg(32000, 36001), 1200, B).ok).toBe(true); st.x = 32000; st.z = 36001; st.at = 1200;
    st.interior = null; st.exitTo = { x: 900, z: -330 }; st.tpUntil = 6000;
    expect(judgeMove(st, msg(5000, 5000), 1300, B).ok).toBe(false);
    expect(judgeMove(st, msg(901, -328), 1400, B).ok).toBe(true);
  });
  it('door act grants entry, casino only works inside the casino, and pays from the server', async () => {
    const a = await mk('Gambler'); a.c.state(900, -330); await sleep(80);
    const out = await a.c.act('casino', { game: 'slots', bet: 500 }); expect(out.ok).toBe(false);
    const d = await a.c.act('door', { into: 'casino' }); expect(d.ok).toBe(true);
    a.c.state(32000, 36001); await sleep(80);
    const w0 = (await a.c.act('casino', { game: 'roulette', bets: { red: 500 } })); expect(w0.ok).toBe(true); expect(typeof w0.num).toBe('number');
    const bj = await a.c.act('casino', { game: 'bj', op: 'deal', bet: 500 }); expect(bj.ok).toBe(true); expect(bj.ph.length).toBe(2);
    if (bj.phase === 'play') { const st = await a.c.act('casino', { game: 'bj', op: 'stand' }); expect(st.phase).toBe('done'); }
    const bad = await a.c.act('casino', { game: 'roulette', bets: { red: 10 } }); expect(bad.ok).toBe(false);
    await sleep(1100); const x = await a.c.act('door', { into: null }); expect(x.ok).toBe(true);
    a.c.close();
  });
  it('earnings need a known source and stay under its limits', async () => {
    const b = await mk('Okada Rider'); b.c.state(900, -330); await sleep(50);
    const w = b.c.welcome.wallet.cash;
    const fare = await b.c.act('cash.delta', { d: 2500, why: 'fare' }); expect(fare.cash).toBe(w + 2500);
    const made = await b.c.act('cash.delta', { d: 900000, why: 'printer' }); expect(made.cash).toBe(w + 2500);
    const greedy = await b.c.act('cash.delta', { d: 20000, why: 'fare' }); expect(greedy.cash).toBe(w + 2500);
    const race = await b.c.act('cash.delta', { d: 16000, why: 'race' }); expect(race.cash).toBe(w + 2500); // no escrow, no prize
    b.c.close();
  });
});
