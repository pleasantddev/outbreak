import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, makePlayer, TestClient, http, type TestServer } from './helpers.ts';
import { Grid, FEEDERS } from '../src/grid.ts';
import { GRID, scheduledOn, BAND_HOURS } from '../../v2/src/net/rules.ts';

let s: TestServer;
beforeAll(async () => { s = await boot(); });
afterAll(async () => { await s.close(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('power grid rules', () => {
  it('feeders cover the map and each band gets its hours on the plan', () => {
    expect(GRID.of(868, -262)).toBe(41); expect(FEEDERS.find((f) => f.i === 41)!.name).toBe('Oshodi');
    for (const band of ['A', 'B', 'C'] as const) { let on = 0; for (let h = 0; h < 24; h++) on += scheduledOn(7, band, 24 * 50 + h + 0.5) ? 1 : 0; expect(on).toBe(BAND_HOURS[band]); }
  });
  it('load never exceeds generation, operators and admins steer it, a collapse is total', () => {
    let t = Date.UTC(2026, 9, 30, 12); const g = new Grid(() => t);
    for (let k = 0; k < 48; k++) { t += 3600_000 / 30; const st = g.state(); if (!st.collapse) expect(st.load).toBeLessThanOrEqual(st.gen); }
    const before = g.state(); const f = FEEDERS.find((x) => before.on[x.i] === '0' && x.load < before.gen - before.load);
    if (f) { const st = g.switch(f.i, true, 'Tester'); expect(st.on[f.i]).toBe('1'); }
    const off = FEEDERS[0]; g.force(off.i, false); expect(g.state().on[off.i]).toBe('0'); g.force(off.i, null);
    g.collapse(2); const c = g.state(); expect(c.collapse).toBe(true); expect(c.on.includes('1')).toBe(false); g.collapse(0);
  });
});

describe('power grid online', () => {
  it('the welcome carries the grid, switches need the control room, admins can force feeders', async () => {
    const p = await makePlayer(s, 'Engineer Bola'); const c = await new TestClient(s, p.token).connect();
    expect(c.welcome.grid.on.length).toBe(72);
    c.state(900, -330); await sleep(80);
    const no = await c.act('grid.switch', { f: 41, on: true }); expect(no.ok).toBe(false);
    await c.act('door', { into: 'power' }); c.state(36000, 36000); await sleep(60);
    const yes = await c.act('grid.switch', { f: 41, on: true }); expect(yes.ok).toBe(true);
    const spam = await c.act('grid.switch', { f: 41, on: false }); expect(spam.ok).toBe(false);
    const b = await c.act('grid.get'); expect(b.board.feeders.length).toBe(FEEDERS.length);
    c.close();
  });
});
