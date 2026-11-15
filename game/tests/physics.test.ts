// The baked city (one triangle mesh per chunk) must behave like the original box colliders it replaced.
import { test, expect } from 'vitest';
import { initPhysics, Physics, RAPIER, quatYX, groups, G } from '../src/sim/physics';
import { generateCity } from '../src/world/cityGen';

test('baked city steps cheaply and rays match the box colliders', async () => {
  await initPhysics();
  const city = generateCity(12345);
  const baked = new Physics();
  baked.buildCity(city);
  // reference: the old layout, one cuboid collider per box, each tagged with its material
  const ref = new RAPIER.World({ x: 0, y: -18, z: 0 });
  const refMat = new Map<number, string>();
  for (const b of city.boxes) if (b.col) {
    const c = ref.createCollider(RAPIER.ColliderDesc.cuboid(b.s[0], b.s[1], b.s[2]).setTranslation(b.p[0], b.p[1], b.p[2]).setRotation(quatYX(b.ry, b.rx ?? 0)).setCollisionGroups(groups(G.WORLD, 0xffff)));
    refMat.set(c.handle, b.mat);
  }
  ref.step(); baked.step();

  for (let i = 0; i < 20; i++) baked.step();
  const t0 = performance.now(); for (let i = 0; i < 60; i++) baked.step();
  const ms = (performance.now() - t0) / 60;
  expect(baked.staticColliders).toBeLessThan(400);
  expect(ms).toBeLessThan(1.5);

  // 500 deterministic rays from street height and from above, in every direction
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let compared = 0, sameDist = 0, sameMat = 0;
  for (let i = 0; i < 500; i++) {
    const o = { x: rnd() * 600 - 300, y: i % 2 ? 1.6 : 40, z: rnd() * 600 - 300 };
    const a = rnd() * Math.PI * 2, e = i % 2 ? (rnd() - 0.5) * 0.4 : -0.3 - rnd() * 1.2;
    const d = { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: Math.cos(e) * Math.cos(a) };
    const rh = ref.castRay(new RAPIER.Ray(o, d), 150, true, undefined, groups(0xffff, G.WORLD));
    const bh = baked.ray(o, d, 150, groups(0xffff, G.WORLD));
    if (!rh && !bh) continue;
    compared++;
    if (rh && bh && Math.abs(rh.timeOfImpact - bh.t) < 0.02) {
      sameDist++;
      if (refMat.get(rh.collider.handle) === bh.tag?.mat) sameMat++;
    }
  }
  (globalThis as any).process.stderr.write(`chunks ${baked.staticColliders}, step ${ms.toFixed(3)} ms, rays ${compared}: same distance ${sameDist}, same material ${sameMat}\n`);
  expect(sameDist / compared).toBeGreaterThan(0.98);
  expect(sameMat / sameDist).toBeGreaterThan(0.95);
}, 120000);
