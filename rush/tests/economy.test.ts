// Race rewards: play money and XP only, paid by place and by what the driver did.
import { describe, it, expect } from 'vitest';
import { raceReward, type RewardInput } from '../src/shared/economy';

const base: RewardInput = { place: 1, count: 8, mode: 'rush', finished: true, drift: 0, air: 0, tricks: 0, nearMiss: 0, shunts: 0, hits: 0, laps: 3, trackLen: 2000, online: false, bestLapRecord: false };

describe('race rewards', () => {
  it('pays more for a better place', () => {
    expect(raceReward({ ...base, place: 1 }).naira).toBeGreaterThan(raceReward({ ...base, place: 2 }).naira);
    expect(raceReward({ ...base, place: 2 }).naira).toBeGreaterThan(raceReward({ ...base, place: 8 }).naira);
    expect(raceReward({ ...base, finished: false }).lines[0].label).toBe('Did not finish');
  });

  it('says one of a thing in the singular', () => {
    const labels = raceReward({ ...base, nearMiss: 1, shunts: 2, tricks: 1, hits: 3 }).lines.map((l) => l.label);
    expect(labels).toContain('1 near miss');
    expect(labels).toContain('2 shunts');
    expect(labels).toContain('1 clean trick');
    expect(labels).toContain('3 item hits');
  });

  it('totals are the sum of the lines', () => {
    const r = raceReward({ ...base, place: 3, drift: 12, tricks: 2, nearMiss: 4, bestLapRecord: true, online: true });
    expect(r.naira).toBe(r.lines.reduce((a, l) => a + l.naira, 0));
    expect(r.xp).toBe(r.lines.reduce((a, l) => a + l.xp, 0));
  });
});
