import { describe, it, expect } from 'vitest';
import { generateCity } from '../src/world/cityGen';

describe('city generator', () => {
  const city = generateCity(1337);

  it('is deterministic for a seed', () => {
    const again = generateCity(1337);
    expect(again.boxes.length).toBe(city.boxes.length);
    expect(again.buildings.map((b) => b.name)).toEqual(city.buildings.map((b) => b.name));
  });

  it('produces a real district', () => {
    expect(city.buildings.length).toBeGreaterThan(60);
    expect(city.buildings.some((b) => b.floors >= 4)).toBe(true);
    expect(city.vehicles.filter((v) => v.kind === 'danfo').length).toBeGreaterThanOrEqual(3);
    expect(city.loot.length).toBeGreaterThan(150);
    expect(city.extractions).toHaveLength(3);
  });

  it('has no NaN geometry', () => {
    for (const b of city.boxes) for (const v of [...b.p, ...b.s, b.ry, b.rx ?? 0]) expect(Number.isFinite(v)).toBe(true);
    for (const b of city.boxes) for (const v of b.s) expect(v).toBeGreaterThan(0);
  });

  it('nav graph reaches every building and roof from the street', () => {
    const { nodes, edges } = city.nav;
    const start = nodes.find((n) => n.kind === 'street')!.id;
    const seen = new Set([start]);
    const q = [start];
    while (q.length) { const n = q.pop()!; for (const m of edges[n]) if (!seen.has(m)) { seen.add(m); q.push(m); } }
    const roofs = nodes.filter((n) => n.kind === 'roof');
    const reachedRoofs = roofs.filter((n) => seen.has(n.id)).length;
    expect(roofs.length).toBeGreaterThan(40);
    expect(reachedRoofs / roofs.length).toBeGreaterThan(0.95);
    const doors = nodes.filter((n) => n.kind === 'door');
    expect(doors.filter((n) => seen.has(n.id)).length / doors.length).toBeGreaterThan(0.95);
  });

  it('nav edges are not absurdly long', () => {
    const { nodes, edges } = city.nav;
    let worst = 0;
    edges.forEach((list, a) => list.forEach((b) => { const p = nodes[a].p, q = nodes[b].p; worst = Math.max(worst, Math.hypot(p[0] - q[0], p[2] - q[2])); }));
    expect(worst).toBeLessThan(45);
  });
});
