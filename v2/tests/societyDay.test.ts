// @ts-nocheck
import { describe, it } from 'vitest';
import { makeSociety, loadStore } from './societyHarness';
import { ACT_NAMES, actAt, fullStory, nameOf, rankLabel } from '../src/systems/societyModel';

describe('a simulated day', () => {
  it('runs and prints', async () => {
    const store = await loadStore([868, -262], 900);
    const s = makeSociety(7); const C = s.C;
    const t0 = 3 * 1440 + 5 * 60; let worst = 0, tot = 0, n = 0;
    const regs = store.regions;
    for (let f = 0; f < 20000; f++) {
      const now = t0 + f * (0.5 / 60);
      const a = performance.now(); s.update(now, 868, -262, regs.values(), 1.0); const d = performance.now() - a;
      if (d > 3 && f > 100) console.log('spike', f, d.toFixed(1), 'cells', s.cells.size, 'gen', s.genMs.toFixed(0));
      if (f > 600) { tot += d; n++; if (d > worst) worst = d; }
      if (f % 20000 === 0) console.log(`t=${(s.hour).toFixed(1)}h day ${s.day} citizens ${s.ringNear.length}+${s.ringFar.length} cells ${s.cells.size} avg ${(tot / Math.max(1, n)).toFixed(3)}ms worst ${worst.toFixed(2)}ms`, s.E.rows().map((r) => `${r.id} ${Math.round(r.price)}`).join(' | '));
    }
    console.log('visits', s.visits, 'gen ms', s.genMs.toFixed(1), 'factions', s.factions.size, 'stats', JSON.stringify(s.stats));
    const c = [...s.byId.values()][5];
    console.log(nameOf(c), rankLabel(C, c), C.occ[c.occ].label, fullStory(C, c));
    // sample schedule
    for (const cc of [...s.byId.values()].filter((x) => C.occ[x.occ].id === 'occ.area_boy').slice(0, 1).concat([...s.byId.values()].filter((x) => C.occ[x.occ].id === 'occ.trader').slice(0, 1), [...s.byId.values()].filter((x) => C.occ[x.occ].id === 'occ.okada').slice(0, 1))) {
      console.log(nameOf(cc), C.occ[cc.occ].label, 'wake', C.occ[cc.occ].sched.wake, 'start', C.occ[cc.occ].sched.start);
      let line = ''; for (let h = 0; h < 24; h += 1) line += `${h}:${ACT_NAMES[actAt(C, cc, h, 2, 5).act]}; `; console.log(line);
    }
    const occ: Record<string, number> = {}; for (const x of s.byId.values()) occ[C.occ[x.occ].label] = (occ[C.occ[x.occ].label] ?? 0) + 1; console.log(JSON.stringify(occ));
    console.log('news', s.E.news.map((x) => x.text).slice(0, 8));
  }, 300000);
});
