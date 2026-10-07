// Headless race runner for tuning: 12 AI cars per track, reports lap times, finishes, respawns and wall hits.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RaceSim, defaultRaceConfig, type Entrant } from '../../src/shared/race';
import { CARS, defaultLivery } from '../../src/shared/cars';
import type { TrackData } from '../../src/shared/track';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tracks: TrackData[] = JSON.parse(fs.readFileSync(path.join(root, 'public/world/tracks.json'), 'utf8'));
const want = process.argv.slice(2);
const level = (process.env.LEVEL ?? 'normal') as any;
for (const td of tracks) {
  if (want.length && !want.includes(td.id)) continue;
  const cfg = { ...defaultRaceConfig(td.id, td.laps), seed: 7, aiLevel: level, traffic: +(process.env.TRAFFIC ?? 2) };
  const entrants: Entrant[] = Array.from({ length: 12 }, (_, i) => { const def = CARS[i % CARS.length]; return { id: `ai${i}`, name: `AI ${i}`, carId: def.id, livery: defaultLivery(def), human: false }; });
  const sim = new RaceSim(td, cfg, entrants, { authority: true, local: [] });
  const dt = 1 / 60;
  const kinds: Record<string, number> = {};
  let respawns = 0, walls = 0, spins = 0, items = 0, hits = 0, nearMiss = 0, traffic = 0, drifts = 0;
  const t0 = performance.now();
  let steps = 0;
  while (sim.phase !== 'done' && sim.time < 600) {
    sim.step(dt);
    steps++;
    for (const e of sim.drainEvents()) {
      if (e.t === 'respawn') respawns++;
      if (e.t === 'wall') walls++;
      if (e.t === 'spin') spins++;
      if (e.t === 'useItem') items++;
      if (e.t === 'hit') hits++;
      if (e.t === 'nearMiss') nearMiss++;
      if (e.t === 'trafficHit') { traffic++; kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; }
      if (e.t === 'driftBoost') drifts++;
    }
  }
  const ms = performance.now() - t0;
  const st = sim.standings();
  const best = Math.min(...st.filter((s) => s.bestLap).map((s) => s.bestLap!));
  console.log(`${td.id.padEnd(15)} L=${td.length.toFixed(0)} par=${td.par} laps=${td.laps} time=${sim.time.toFixed(1)}s finished=${st.filter((s) => s.finished).length}/12 bestLap=${best.toFixed(1)} respawns=${respawns} walls=${walls} spins=${spins} items=${items} hits=${hits} near=${nearMiss} trafficHits=${traffic} driftBoosts=${drifts} cpu=${(ms / steps * 1000).toFixed(0)}us/step ${JSON.stringify(kinds)}`);
  if (process.env.VERBOSE) for (const s of st) console.log(`   ${s.place}. ${s.carId.padEnd(14)} ${s.finished ? s.time!.toFixed(1) : 'DNF ' + s.dist.toFixed(0)} best ${s.bestLap?.toFixed(1)} top ${(s.stats.topSpeed * 3.6).toFixed(0)}kmh walls ${s.stats.walls} drift ${s.stats.drift.toFixed(1)}s`);
}
