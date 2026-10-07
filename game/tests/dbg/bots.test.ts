import { it } from 'vitest';
import { initPhysics } from '../../src/sim/physics';
import { Sim } from '../../src/sim/sim';
import { OPERATORS, defaultArmory } from '../../src/data/cosmetics';
it('dbg bots', async () => {
  await initPhysics();
  const sim = new Sim({ seed: 7, name: 'T', look: OPERATORS[0].look, archetype: 'runner', armory: defaultArmory(), bots: 11, minutes: 1.5, drop: null });
  const start = sim.actors.map(a => ({ ...a.pos }));
  const travelled = sim.actors.map(() => 0);
  let last = sim.actors.map(a => ({ ...a.pos }));
  const ev: Record<string, number> = {};
  for (let i = 0; i < 60 * 45; i++) {
    sim.step(1 / 60);
    for (const e of sim.events) ev[e.t] = (ev[e.t] ?? 0) + 1;
    sim.events.length = 0;
    if (i % 30 === 0) sim.actors.forEach((a, k) => { travelled[k] += Math.hypot(a.pos.x - last[k].x, a.pos.z - last[k].z); last[k] = { ...a.pos }; });
  }
  console.log(ev);
  for (const a of sim.actors.slice(1)) { const b = sim.brains.get(a.id)!; const nx = b.path[b.pathI] !== undefined ? sim.nav.pos(b.path[b.pathI]) : null; console.log('POS', a.pos.x.toFixed(1), a.pos.y.toFixed(1), a.pos.z.toFixed(1), 'next', nx && [nx.x.toFixed(1), nx.y.toFixed(1), nx.z.toFixed(1)].join(','), sim.city.regions.find(r => a.pos.x >= r.x0 && a.pos.x < r.x1 && a.pos.z >= r.z0 && a.pos.z < r.z1)?.name); console.log(a.name, a.alive, 'goal', b.goal, 'trav', travelled[a.id].toFixed(0), 'path', b.path.length, b.pathI, 'loot', b.lootTarget ? 'y' : 'n', 'prim', a.inv.primary?.id, 'hp', a.hp.toFixed(0), 'y', a.pos.y.toFixed(1), 'stuck', b.stuckT.toFixed(1), 'tgt', b.target?.kind); }
}, 200000);
it('dbg boxes', async () => {
  const { generateCity } = await import('../../src/world/cityGen');
  const c = generateCity(7);
  for (const [x, z] of [[-318.5, -109.4], [-119.4, 292.3], [-318.5, -106.1]]) {
    const near = c.boxes.filter(b => b.col && Math.abs(b.p[0] - x) < (Math.abs(Math.sin(b.ry)) > 0.5 ? b.s[2] : b.s[0]) + 0.6 && Math.abs(b.p[2] - z) < (Math.abs(Math.sin(b.ry)) > 0.5 ? b.s[0] : b.s[2]) + 0.6 && b.p[1] - b.s[1] < 2.5);
    console.log('AT', x, z, near.map(b => `${b.mat} p=${b.p.map(v => v.toFixed(1))} s=${b.s.map(v => v.toFixed(2))} ry=${b.ry.toFixed(2)} rx=${(b.rx ?? 0).toFixed(2)}`).join('\n   '));
  }
  const props = c.props.filter(p => Math.hypot(p.p[0] + 318.5, p.p[2] + 109.4) < 3);
  console.log(props);
});
