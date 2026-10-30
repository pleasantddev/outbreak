import { describe, it, expect } from 'vitest';
import { BjTable, slotSpin, roulettePays, bjValue, SLOT_WEIGHTS, SLOT_PAY } from '../../v2/src/net/rules.ts';

describe('casino rules (shared by server and offline play)', () => {
  it('slots pay back a little under the stake on average', () => {
    let seed = 1; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let paid = 0; const n = 200_000; for (let i = 0; i < n; i++) paid += slotSpin(rand, 1000).win;
    const rtp = paid / (n * 1000); expect(rtp).toBeGreaterThan(0.85); expect(rtp).toBeLessThan(1.0);
    expect(SLOT_WEIGHTS.length).toBe(SLOT_PAY.length);
  });
  it('roulette single number pays 36x the stake back, zero loses outside bets', () => {
    expect(roulettePays('n17', 17)).toBe(36); expect(roulettePays('red', 0)).toBe(0); expect(roulettePays('red', 1)).toBe(2); expect(roulettePays('d3', 36)).toBe(3);
  });
  it('blackjack table never pays twice and settles every hand', () => {
    let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const t = new BjTable(rand);
    for (let i = 0; i < 500; i++) { t.deal(1000); while (t.phase === 'play') { if (bjValue(t.ph) < 15) t.hit(); else t.stand(); } expect(t.phase).toBe('done'); expect([-2000, -1000, 0, 1000, 1500, 2000]).toContain(t.net); }
  });
});
