// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { makeSociety, loadStore, loadContentSync } from './societyHarness';
import { nameOf } from '../src/systems/societyModel';

describe('society model', () => {
  it('loads content', () => {
    const C = loadContentSync();
    expect(C.ok).toBe(true); expect(C.occ.length).toBeGreaterThan(20); expect(C.goods.length).toBeGreaterThan(5);
  });
  it('populates a real Lagos cell deterministically and runs', async () => {
    const store = await loadStore([868, -262], 400);
    const s1 = makeSociety(7), s2 = makeSociety(7);
    for (const s of [s1, s2]) { const t0 = 7.2 * 60 + 3 * 1440; for (let i = 0; i < 400; i++) s.update(t0 + i * 0.05, 868, -262, store.regions.values(), 4); }
    expect(s1.byId.size).toBeGreaterThan(200);
    const a = [...s1.byId.values()].slice(0, 20).map((c) => c.id + nameOf(c)).join(), b = [...s2.byId.values()].slice(0, 20).map((c) => c.id + nameOf(c)).join();
    expect(a).toBe(b);
  }, 120000);
});
