import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RaceSim, defaultRaceConfig, type Entrant, type RaceConfig } from '../src/shared/race';
import { CARS, carById, defaultLivery } from '../src/shared/cars';
import { Track, type TrackData } from '../src/shared/track';
import { Traffic } from '../src/shared/traffic';
import { rollItem, itemOdds } from '../src/shared/items';
import { idleInput } from '../src/shared/car';

const tracks: TrackData[] = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/world/tracks.json'), 'utf8'));
const byId = (id: string) => tracks.find((t) => t.id === id)!;
const field = (n: number, carId?: string): Entrant[] => Array.from({ length: n }, (_, i) => {
  const def = carId ? carById(carId) : CARS[i % CARS.length];
  return { id: `ai${i}`, name: `AI ${i}`, carId: def.id, livery: defaultLivery(def), human: false };
});
function run(td: TrackData, cfg: Partial<RaceConfig>, entrants: Entrant[], maxT = 400) {
  const sim = new RaceSim(td, { ...defaultRaceConfig(td.id, td.laps), ...cfg }, entrants, { authority: true, local: [] });
  const events: string[] = [];
  while (sim.phase !== 'done' && sim.time < maxT) { sim.step(1 / 60); for (const e of sim.drainEvents()) events.push(e.t); }
  return { sim, events };
}

describe('tracks', () => {
  it('every track is a closed loop with a grid, checkpoints and sane width', () => {
    expect(tracks.length).toBeGreaterThanOrEqual(7);
    for (const td of tracks) {
      const tr = new Track(td);
      expect(tr.length).toBeGreaterThan(1000);
      expect(td.grid).toHaveLength(12);
      expect(td.checkpoints.length).toBeGreaterThanOrEqual(5);
      expect(Math.min(...td.paths[0].hw)).toBeGreaterThan(3.5);
      // grid slots sit on the corridor
      for (const g of td.grid) expect(tr.query(g.x, g.y, g.z).outside).toBeLessThan(-0.5);
    }
  });
  it('the terminal circuit climbs onto the bridges and stacks over Agege Motor Road', () => {
    const td = byId('terminal');
    const ys = td.paths[0].pts.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeGreaterThan(6);
    expect(Math.min(...ys)).toBeLessThan(0.5);
  });
});

describe('race sim', () => {
  it('runs a full AI race to the flag on every forward track', () => {
    for (const id of ['terminal', 'oshodi', 'expressway']) {
      const { sim, events } = run(byId(id), { traffic: 0, mode: 'street', laps: 2, finishGrace: 60 }, field(8, 'spirit'));
      const st = sim.standings();
      expect(sim.phase).toBe('done');
      expect(st.filter((s) => s.finished).length).toBeGreaterThanOrEqual(6);
      expect(events.filter((e) => e === 'finish').length).toBeGreaterThanOrEqual(6);
      // laps are plausible: no faster than 70% of par
      for (const s of st) if (s.bestLap) expect(s.bestLap).toBeGreaterThan(byId(id).par * 0.7);
    }
  }, 60000);

  it('is deterministic for a given seed', () => {
    const td = byId('terminal');
    const a = run(td, { seed: 42, laps: 1 }, field(6), 120).sim.standings().map((s) => [s.id, s.place, s.dist.toFixed(3)]);
    const b = run(td, { seed: 42, laps: 1 }, field(6), 120).sim.standings().map((s) => [s.id, s.place, s.dist.toFixed(3)]);
    expect(a).toEqual(b);
  }, 30000);

  it('counts laps from the line and finishes after the configured laps', () => {
    const td = byId('expressway');
    const { sim } = run(td, { traffic: 0, mode: 'street', laps: 1 }, field(1, 'thirdmainland'));
    const c = sim.cars[0].c;
    expect(c.finished).toBe(true);
    expect(c.lap).toBe(2);
    expect(c.raceDist).toBeGreaterThanOrEqual(sim.track.length);
  }, 30000);

  it('a local car with no input sits still and does not finish', () => {
    const td = byId('oshodi');
    const e: Entrant[] = [{ id: 'me', name: 'Me', carId: 'tokunbo', livery: defaultLivery(CARS[0]), human: true }];
    const sim = new RaceSim(td, { ...defaultRaceConfig(td.id, 1), finishGrace: 5 }, e, { authority: true, local: ['me'] });
    for (let i = 0; i < 60 * 10; i++) sim.step(1 / 60, { me: idleInput() });
    expect(Math.abs(sim.cars[0].c.raceDist)).toBeLessThan(60);
    expect(sim.cars[0].c.finished).toBe(false);
  });

  it('a perfect launch gives a boost and an early throttle bogs down', () => {
    const td = byId('oshodi');
    const e: Entrant[] = ['a', 'b'].map((id) => ({ id, name: id, carId: 'tokunbo', livery: defaultLivery(CARS[0]), human: true }));
    const sim = new RaceSim(td, defaultRaceConfig(td.id, 1), e, { authority: true, local: ['a', 'b'] });
    const launches: Record<number, string> = {};
    while (sim.time < 0.1) {
      const t = sim.time;
      sim.step(1 / 60, { a: { ...idleInput(), throttle: t > -0.4 ? 1 : 0 }, b: { ...idleInput(), throttle: 1 } });
      for (const ev of sim.drainEvents()) if (ev.t === 'launch') launches[ev.car] = ev.quality;
    }
    expect(launches[0]).toBe('perfect');
    expect(launches[1]).toBe('bogged');
  });
});

describe('race end rules', () => {
  const human = (id: string): Entrant => ({ id, name: id, carId: 'tokunbo', livery: defaultLivery(carById('tokunbo')), human: true });
  const until = (sim: RaceSim, maxT: number) => { while (sim.phase !== 'done' && sim.time < maxT) { sim.step(1 / 30); sim.drainEvents(); } };

  it('online, an AI winner starts a clock so a stalled human cannot hold the room', () => {
    const td = byId('terminal');
    // a human whose state never arrives stays where it is on the authority's sim
    const sim = new RaceSim(td, { ...defaultRaceConfig(td.id, 1), aiFinishGrace: 10 }, [...field(3), human('stalled')], { authority: true, local: [] });
    until(sim, 300);
    expect(sim.phase).toBe('done');
    const first = sim.cars[sim.finishOrder[0]].c.finishTime;
    expect(sim.time).toBeLessThan(first + 10.5);
    expect(sim.standings().find((r) => r.id === 'stalled')!.finished).toBe(false);
  }, 30000);

  it('a hard cap ends a race nobody finishes', () => {
    const td = byId('terminal');
    const sim = new RaceSim(td, { ...defaultRaceConfig(td.id, 3), maxTime: 20 }, [human('a'), human('b')], { authority: true, local: [] });
    until(sim, 60);
    expect(sim.phase).toBe('done');
    expect(sim.time).toBeLessThan(20.1);
  });

  it('offline, the race still waits for the player after an AI wins', () => {
    const td = byId('terminal');
    const sim = new RaceSim(td, { ...defaultRaceConfig(td.id, 1) }, [...field(3), human('me')], { authority: true, local: ['me'] });
    until(sim, 240);
    expect(sim.finishOrder.length).toBeGreaterThan(0);
    expect(sim.phase).not.toBe('done');
  }, 30000);

  it('followers never end a race on their own view of it', () => {
    const td = byId('terminal');
    const sim = new RaceSim(td, { ...defaultRaceConfig(td.id, 1), maxTime: 5 }, [human('me'), human('them')], { authority: false, local: ['me'] });
    until(sim, 30);
    expect(sim.phase).not.toBe('done');
  });
});

describe('items and traffic', () => {
  it('item odds favour defence at the front and comebacks at the back', () => {
    const lead = itemOdds(1, 12), last = itemOdds(12, 12);
    expect(lead.purewater).toBeGreaterThan(0);
    expect(lead.danfo).toBeUndefined();
    expect(last.okada).toBeGreaterThan(0);
    expect(itemOdds(11, 12).okada).toBeUndefined();
  });
  it('item rolls are repeatable', () => {
    for (let i = 0; i < 50; i++) expect(rollItem(3, 12, 9, i, 2, 1)).toBe(rollItem(3, 12, 9, i, 2, 1));
  });
  it('traffic is a pure function of seed and time', () => {
    const tr = new Track(byId('oshodi'));
    const a = new Traffic(tr, 2, 5), b = new Traffic(tr, 2, 5);
    expect(a.cars.length).toBeGreaterThan(10);
    for (const t of [0, 3.3, 61.7]) expect(a.poses(t).map((p) => p.s.toFixed(4))).toEqual(b.poses(t).map((p) => p.s.toFixed(4)));
    // vehicles stay on the road
    for (const p of a.poses(12)) expect(Math.abs(p.d)).toBeLessThanOrEqual(tr.hwAt(p.s));
  });
  it('rush races hand out items and use them', () => {
    const { events } = run(byId('terminal'), { mode: 'rush', laps: 2, traffic: 1 }, field(10), 200);
    expect(events.filter((e) => e === 'item').length).toBeGreaterThan(10);
    expect(events.filter((e) => e === 'useItem').length).toBeGreaterThan(5);
  }, 30000);
});
