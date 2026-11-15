// Simulation cost per step for a full 12-player match with creatures and vehicles, by part. Run: npx vitest run bench
import { it } from 'vitest';
import { initPhysics } from '../src/sim/physics';
import { Sim } from '../src/sim/sim';
import { OPERATORS, defaultArmory } from '../src/data/cosmetics';

it('sim step cost', async () => {
  await initPhysics();
  const sim = new Sim({ seed: 7, name: 'Bench', look: OPERATORS[0].look, archetype: 'runner', armory: defaultArmory(), bots: 11, minutes: 12, drop: null });
  // let bots spread out and creatures wake
  for (let i = 0; i < 60 * 40; i++) sim.step(1 / 60);
  const acc: Record<string, number> = {};
  const s = sim as any;
  const wrap = (obj: any, key: string, label = key) => { const f = obj[key]; obj[key] = function (...a: unknown[]) { const t = performance.now(); const r = f.apply(this, a); acc[label] = (acc[label] ?? 0) + performance.now() - t; return r; }; };
  for (const k of ['updateMatch', 'updateActor', 'updateVehicle', 'updateCreatures', 'updateGrenades', 'updateShields', 'syncSeats']) wrap(s, k);
  wrap(s.phys, 'step', 'physics');
  for (const k of ['moveCreature', 'moveActor', 'combat', 'autoPickup', 'trackContract']) wrap(s, k);
  wrap(s.phys, 'ray', 'ray'); wrap(s.phys, 'lineOfSight', 'los');
  wrap(s.nav, 'nearest', 'nav.nearest'); if (s.nav.path) wrap(s.nav, 'path', 'nav.path');
  const cb = [...s.cbrains.values()][0]; if (cb) wrap(Object.getPrototypeOf(cb), 'update', 'creatureBrains');
  const calls: Record<string, number> = {};
  const count = (obj: any, key: string) => { const f = obj[key]; obj[key] = function (...a: unknown[]) { calls[key] = (calls[key] ?? 0) + 1; return f.apply(this, a); }; };
  count(s.phys, 'ray'); count(s.phys, 'lineOfSight'); count(s.nav, 'nearest');
  const brain = [...s.brains.values()][0];
  wrap(Object.getPrototypeOf(brain), 'think', 'brains');
  const N = 60 * 20;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) sim.step(1 / 60);
  const total = (performance.now() - t0) / N;
  const parts = Object.entries(acc).map(([k, v]) => `${k} ${(v / N).toFixed(3)}`).join(', ');
  (globalThis as any).process.stderr.write(`step ${total.toFixed(3)} ms | ${parts} | calls/step ${Object.entries(calls).map(([k, v]) => k + ' ' + (v / N).toFixed(1)).join(', ')} | alive ${sim.actors.filter((a) => a.alive).length} creatures ${sim.creatures.length}\n`);
}, 600000);
