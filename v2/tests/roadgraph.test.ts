import { describe, it, expect } from 'vitest';
import { RoadGraph } from '../src/world/roadgraph';
import { RF, ROAD, type Road } from '../src/world/region';

let id = 1;
const road = (pts: number[], cls: number = ROAD.residential, flags = 0): Road => ({ cls, lanes: 0, flags, layer: 0, name: null, id: id++, pts: new Float32Array(pts) });
const len = (p: number[]) => { let l = 0; for (let i = 0; i < p.length - 2; i += 2) l += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); return l; };

describe('RoadGraph', () => {
  it('routes around a block instead of through it', () => {
    const g = new RoadGraph();
    // square of roads 0..100, nothing inside
    g.addRoads([road([0, 0, 100, 0]), road([100, 0, 100, 100]), road([100, 100, 0, 100]), road([0, 100, 0, 0])]);
    const p = g.route(2, 1, 98, 99, 'walk')!;
    expect(p).not.toBeNull();
    expect(len(p.pts)).toBeGreaterThan(190); // around two sides, not the 138 m diagonal
    expect(len(p.pts)).toBeLessThan(215);
  });

  it('respects one-way streets when driving but not on foot', () => {
    const g = new RoadGraph();
    // a one-way street A->B, plus a long way back round
    g.addRoads([road([0, 0, 100, 0], ROAD.secondary, RF.oneway), road([100, 0, 100, 400], ROAD.secondary), road([100, 400, 0, 400], ROAD.secondary), road([0, 400, 0, 0], ROAD.secondary)]);
    const fwd = g.route(5, 0, 95, 0, 'drive')!; const back = g.route(95, 0, 5, 0, 'drive')!; const walk = g.route(95, 0, 5, 0, 'walk')!;
    expect(len(fwd.pts)).toBeLessThan(120);
    expect(len(back.pts)).toBeGreaterThan(800);
    expect(len(walk.pts)).toBeLessThan(120);
  });

  it('honours the reverse flag on a one-way way', () => {
    const g = new RoadGraph();
    g.addRoads([road([0, 0, 100, 0], ROAD.secondary, RF.oneway | RF.reverse), road([100, 0, 100, 300], ROAD.secondary), road([100, 300, 0, 300], ROAD.secondary), road([0, 300, 0, 0], ROAD.secondary)]);
    expect(len(g.route(95, 0, 5, 0, 'drive')!.pts)).toBeLessThan(120);
    expect(len(g.route(5, 0, 95, 0, 'drive')!.pts)).toBeGreaterThan(600);
  });

  it('joins a side road that stops just short of the main road (lost junction vertex)', () => {
    const g = new RoadGraph();
    g.addRoads([road([0, 0, 200, 0]), road([100, 3, 100, 120])]);
    const p = g.route(10, 0, 100, 110, 'drive');
    expect(p).not.toBeNull();
    expect(len(p!.pts)).toBeLessThan(220);
  });

  it('joins road pieces that meet at a region seam', () => {
    const g = new RoadGraph();
    g.addRoads([road([0, 0, 1000, 0], ROAD.primary), road([1000, 0.1, 2000, 0], ROAD.primary)]);
    const p = g.route(50, 0, 1950, 0, 'drive');
    expect(p).not.toBeNull();
    expect(len(p!.pts)).toBeLessThan(1960);
  });

  it('returns null rather than a straight line when the network does not connect', () => {
    const g = new RoadGraph();
    g.addRoads([road([0, 0, 100, 0]), road([0, 500, 100, 500])]);
    expect(g.route(10, 0, 90, 500, 'drive')).toBeNull();
  });

  it('keeps tunnels out and bridges in', () => {
    const g = new RoadGraph();
    g.addRoads([road([0, 0, 100, 0], ROAD.primary, RF.tunnel), road([100, 0, 200, 0], ROAD.primary, RF.bridge)]);
    expect(g.stats().segments).toBe(1); // only the bridge made it into the graph
  });

  it('simplifies output and stays fast on a large grid', () => {
    const g = new RoadGraph(); const rs: Road[] = [];
    for (let i = 0; i <= 60; i++) { rs.push(road([i * 20, 0, i * 20, 1200])); rs.push(road([0, i * 20, 1200, i * 20])); }
    g.addRoads(rs);
    const t = performance.now(); const p = g.route(3, 3, 1197, 1197, 'drive')!; const ms = performance.now() - t;
    expect(p).not.toBeNull(); expect(ms).toBeLessThan(250);
    expect(p.pts.length / 2).toBeLessThan(20);
  });
});
