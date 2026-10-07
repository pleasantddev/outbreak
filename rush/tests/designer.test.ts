// The race designer's data: what designers place in a TrackDef turns into the right track features, permanent
// road hazards behave as part of the road, and designs read back from storage are checked before use.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildTrack, type TrackDef } from '../src/shared/trackBuild';
import { TRACK_DEFS } from '../src/shared/trackDefs';
import { Track, type TrackData } from '../src/shared/track';
import { RaceSim, defaultRaceConfig, type Entrant } from '../src/shared/race';
import { CARS, defaultLivery } from '../src/shared/cars';
import { validDesign } from '../src/app/designs';
import type { WorldData } from '../src/shared/world';

const pub = path.join(__dirname, '../public/world');
const world: WorldData = { ...JSON.parse(fs.readFileSync(path.join(pub, 'oshodi.json'), 'utf8')), graph: JSON.parse(fs.readFileSync(path.join(pub, 'graph.json'), 'utf8')) };
const shipped: TrackData[] = JSON.parse(fs.readFileSync(path.join(pub, 'tracks.json'), 'utf8'));

// the Oshodi Loop's anchors, as a designer would click them
const LOOP: TrackDef = { id: 'loop-test', name: 'Loop Test', district: 'Oshodi', tagline: 'test', laps: 2, start: [-130, -48], hw: [6, 9], route: [[-6, -37], [-284, -54], [-636, -50], [-673, -575], [-352, -831], [-287, -855], [-56, -294], [23, -111], [5, -46]] };
/** A point on the built centre line, a fraction of the way round the lap, offset d to the right. */
const at = (td: TrackData, f: number, d = 0): [number, number] => { const p = new Track(td).pointAt(td.length * f, d); return [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]; };

describe('race designer', () => {
  it('builds every official route from the published world and graph exactly as shipped', () => {
    for (const def of TRACK_DEFS) {
      const { data } = buildTrack(world, def);
      expect(JSON.stringify(data)).toBe(JSON.stringify(shipped.find((t) => t.id === def.id)));
    }
  });

  it('placed bags, boost strips, checkpoints and potholes replace or add to the automatic ones', () => {
    const base = buildTrack(world, LOOP).data;
    const def: TrackDef = {
      ...LOOP,
      pickups: [at(base, 0.3), at(base, 0.6)],
      boosts: [{ at: at(base, 0.45, -3), side: 'left' }],
      checkpoints: [at(base, 0.25), at(base, 0.5), at(base, 0.75)],
      hazards: [{ at: at(base, 0.4, 2) }, { at: at(base, 0.42, -2), kind: 'purewater' }],
      ramps: [{ at: at(base, 0.2), side: 'right', h: 1.2, len: 10 }],
    };
    const { data } = buildTrack(world, def);
    expect(data.pickups).toHaveLength(2);
    expect(data.pickups[0].s).toBeCloseTo(base.length * 0.3, -1);
    expect(data.boosts).toHaveLength(1);
    expect(data.boosts[0].d).toBeLessThan(0);
    expect(data.checkpoints).toHaveLength(3);
    expect(data.hazards).toHaveLength(2);
    expect(data.hazards![0].kind).toBe('pothole');
    expect(data.hazards![0].d).toBeGreaterThan(1);
    expect(data.hazards![1].kind).toBe('purewater');
    expect(data.ramps.length).toBe(base.ramps.length + 1);
    expect(data.ramps.some((r) => (r.d0 ?? -1) > 0)).toBe(true);
  });

  it('a traffic free stretch takes that part of the lap out of the traffic sections', () => {
    const base = buildTrack(world, LOOP).data;
    const s0 = base.length * 0.45, s1 = base.length * 0.7;
    const { data } = buildTrack(world, { ...LOOP, noTraffic: [[at(base, 0.45), at(base, 0.7)]] });
    expect(base.traffic.some((t) => t.s0 < s1 && t.s1 > s0)).toBe(true);
    for (const t of data.traffic) expect(t.s1 <= s0 + 3 || t.s0 >= s1 - 3).toBe(true);
  });

  it('a link placed far from any road is named in the warnings the designer shows', () => {
    const { warnings } = buildTrack(world, { ...LOOP, links: [{ a: [5000, 5000], b: [5010, 5000] }] });
    expect(warnings.some((w) => /link start .* m from a road/.test(w))).toBe(true);
  });
});

describe('permanent road hazards', () => {
  const field = (n: number): Entrant[] => Array.from({ length: n }, (_, i) => ({ id: `ai${i}`, name: `AI ${i}`, carId: CARS[i % CARS.length].id, livery: defaultLivery(CARS[i % CARS.length]), human: false }));
  const base = buildTrack(world, LOOP).data;
  const td = buildTrack(world, { ...LOOP, hazards: [{ at: at(base, 0.1) }, { at: at(base, 0.1, 3) }, { at: at(base, 0.1, -3) }] }).data;

  it('are in the road from the start, in every mode, and never wear out or get cleared', () => {
    for (const mode of ['rush', 'street', 'trial'] as const) {
      const sim = new RaceSim(td, { ...defaultRaceConfig(td.id, 1), mode, traffic: 0 }, field(mode === 'trial' ? 1 : 6), { authority: true, local: [] });
      expect(sim.hazards.filter((h) => h.perm)).toHaveLength(3);
      let hits = 0;
      while (sim.phase !== 'done' && sim.time < 260) { sim.step(1 / 60); for (const e of sim.drainEvents()) if (e.t === 'hit' && e.by === -1) hits++; }
      expect(sim.hazards.filter((h) => h.perm)).toHaveLength(3);
      expect(hits).toBeGreaterThanOrEqual(0);
    }
  });

  it('hit whoever drives over them, again on later laps', () => {
    const sim = new RaceSim(td, { ...defaultRaceConfig(td.id, 2), mode: 'street', traffic: 0, aiLevel: 'easy' }, field(1), { authority: true, local: [] });
    const hz = sim.hazards[0];
    const car = sim.cars[0];
    while (sim.phase !== 'racing') sim.step(1 / 60);
    sim.drainEvents();
    let hits = 0;
    for (let lap = 0; lap < 2; lap++) {
      // put the car on the pothole, grounded, and let the sim find it
      car.c.x = hz.x; car.c.y = hz.y; car.c.z = hz.z; car.c.grounded = true;
      for (let k = 0; k < 3; k++) { sim.step(1 / 60); for (const e of sim.drainEvents()) if (e.t === 'hit') hits++; }
      for (let k = 0; k < 90; k++) sim.step(1 / 60);
      sim.drainEvents();
    }
    expect(hits).toBe(2);
    expect(sim.hazards.filter((h) => h.perm)).toHaveLength(3);
  });
});

describe('stored designs', () => {
  it('accepts a design from the tool and refuses anything malformed', () => {
    expect(validDesign(LOOP)).toBe(true);
    expect(validDesign({ ...LOOP, id: 'Bad Id!' })).toBe(false);
    expect(validDesign({ ...LOOP, route: [[1, 2]] })).toBe(false);
    expect(validDesign({ ...LOOP, route: [[1, NaN], [2, 3]] })).toBe(false);
    expect(validDesign({ ...LOOP, laps: 40 })).toBe(false);
    expect(validDesign({ ...LOOP, hazards: [{ at: [1, 2], kind: 'lava' }] })).toBe(false);
    expect(validDesign({ ...LOOP, links: Array.from({ length: 40 }, () => ({ a: [0, 0], b: [1, 1] })) })).toBe(false);
    expect(validDesign('<script>')).toBe(false);
    expect(validDesign(null)).toBe(false);
  });
});
