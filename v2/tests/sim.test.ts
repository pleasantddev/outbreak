import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics } from '../src/sim/physics';
import { Sim } from '../src/sim/sim';
import { OPERATORS, defaultArmory } from '../src/data/cosmetics';
import { emptyCommand } from '../src/sim/types';

const opts = (minutes = 2, bots = 11) => ({ seed: 7, name: 'Tester', look: OPERATORS[0].look, archetype: 'runner' as const, armory: defaultArmory(), bots, minutes, drop: null });

describe('match simulation', () => {
  beforeAll(async () => { await initPhysics(); });

  it('spawns 12 players with archetype rules applied', () => {
    const sim = new Sim(opts());
    expect(sim.actors).toHaveLength(12);
    expect(sim.local.inv.backpack.length).toBe(10); // Runner courier rig
    const scout = sim.actors.find((a) => a.archetype === 'scout');
    if (scout) expect(scout.inv.backpack.length).toBe(6);
    expect(sim.local.contract).not.toBeNull();
    expect(sim.vehicles.length).toBeGreaterThan(8);
  });

  it('players stand on the ground and walk', () => {
    const sim = new Sim(opts(2, 0));
    const a = sim.local;
    for (let i = 0; i < 90; i++) sim.step(1 / 60);
    const y0 = a.pos.y;
    expect(a.grounded).toBe(true);
    const start = { ...a.pos };
    for (let i = 0; i < 120; i++) { const c = emptyCommand(); c.mx = 1; c.yaw = Math.PI / 2; sim.setCommand(0, c); sim.step(1 / 60); }
    expect(Math.hypot(a.pos.x - start.x, a.pos.z - start.z)).toBeGreaterThan(1.5);
    expect(Math.abs(a.pos.y - y0)).toBeLessThan(3);
  });

  it('can climb a stairwell to the roof of a building', () => {
    const sim = new Sim(opts(2, 0));
    const a = sim.local;
    const b = sim.city.buildings.find((b) => b.floors >= 3 && b.region !== 'Oshodi Terminal')!;
    const roof = sim.city.nav.nodes.find((n) => n.kind === 'roof' && n.b === b.id)!;
    const door = sim.city.nav.nodes.find((n) => n.kind === 'door' && n.b === b.id)!;
    a.pos = { x: door.p[0], y: door.p[1] + 0.2, z: door.p[2] };
    a.body.setNextKinematicTranslation({ x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z });
    const path = sim.nav.path(door.id, roof.id);
    expect(path.length).toBeGreaterThan(4);
    let i = 0;
    for (let f = 0; f < 60 * 60 && i < path.length; f++) {
      const n = sim.nav.pos(path[i]);
      const dx = n.x - a.pos.x, dz = n.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.5 && Math.abs(n.y - a.pos.y) < 1.2) { i++; continue; }
      const c = emptyCommand(); c.mx = dx / d; c.mz = dz / d; c.yaw = Math.atan2(dx, dz);
      sim.setCommand(0, c); sim.step(1 / 60);
    }
    expect(i).toBe(path.length);
    expect(a.pos.y).toBeGreaterThan(b.floors * b.H - 0.5);
  }, 60000);

  it('runs a full short match with bots, phases, the Heart and an end', () => {
    const sim = new Sim(opts(1.5));
    const seen = new Set<string>();
    let kills = 0, shots = 0, pickups = 0;
    for (let i = 0; i < 60 * 60 * 2.2 && !sim.ended; i++) {
      sim.step(1 / 60);
      seen.add(sim.phase);
      for (const e of sim.events) { if (e.t === 'kill') kills++; if (e.t === 'shot') shots++; if (e.t === 'pickup') pickups++; }
      sim.events.length = 0;
    }
    for (const a of sim.actors) for (const v of [a.pos.x, a.pos.y, a.pos.z]) expect(Number.isFinite(v)).toBe(true);
    expect(seen.has('heart')).toBe(true);
    expect(sim.heart.active).toBe(true);
    expect(pickups).toBeGreaterThan(10);
    expect(shots).toBeGreaterThan(5);
    console.log({ phase: sim.phase, kills, shots, pickups, alive: sim.actors.filter((a) => a.alive).length, creatures: sim.creatures.filter((c) => c.alive).length, carrier: sim.heart.carrier, ended: sim.ended, time: sim.time.toFixed(0) });
  }, 240000);

  it('vehicles drive forward when the driver accelerates', () => {
    const sim = new Sim(opts(2, 0));
    const v = sim.vehicles.find((v) => v.kind === 'danfo')!;
    for (let i = 0; i < 60; i++) sim.step(1 / 60);
    const a = sim.local;
    const p = v.body.translation();
    a.pos = { x: p.x + 2, y: p.y, z: p.z };
    a.body.setTranslation({ x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z }, true);
    const c0 = emptyCommand(); c0.interact = true; sim.setCommand(0, c0); sim.step(1 / 60);
    expect(a.vehicle).toBe(v.id);
    const start = { ...v.body.translation() };
    for (let i = 0; i < 180; i++) { const c = emptyCommand(); c.mz = 1; sim.setCommand(0, c); sim.step(1 / 60); }
    const end = v.body.translation();
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(5);
    const r = v.body.rotation();
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
    expect(upY).toBeGreaterThan(0.8);
  });
});
