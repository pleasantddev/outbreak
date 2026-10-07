// Ranked play: the rating maths, the tiers, and the store that keeps ratings and server timed laps.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rateRace, tierOf, START_RATING, PROVISIONAL } from '../src/shared/ranking';
import { Store } from '../server/store';

const e = (id: string, place: number, rating = START_RATING, races = 0) => ({ id, place, rating, races });

describe('ratings', () => {
  it('a winner gains and a loser loses, by the same amount between equals', () => {
    const d = rateRace([e('a', 1), e('b', 2)]);
    expect(d.get('a')).toBeGreaterThan(0);
    expect(d.get('a')).toBe(-d.get('b')!);
  });

  it('beating a stronger driver is worth more than beating a weaker one', () => {
    const upset = rateRace([e('low', 1, 900), e('high', 2, 1300)]).get('low')!;
    const expected = rateRace([e('high', 1, 1300), e('low', 2, 900)]).get('high')!;
    expect(upset).toBeGreaterThan(expected);
  });

  it('in a big field the middle barely moves and the ends move most', () => {
    const d = rateRace(Array.from({ length: 8 }, (_, i) => e(`p${i}`, i + 1)));
    expect(d.get('p0')).toBeGreaterThan(10);
    expect(Math.abs(d.get('p3')!)).toBeLessThanOrEqual(3);
    expect(d.get('p7')).toBeLessThan(-10);
  });

  it('new drivers move faster than settled ones', () => {
    const fresh = rateRace([e('a', 1, 1000, 0), e('b', 2, 1000, 0)]).get('a')!;
    const settled = rateRace([e('a', 1, 1000, PROVISIONAL + 5), e('b', 2, 1000, PROVISIONAL + 5)]).get('a')!;
    expect(fresh).toBeGreaterThan(settled);
  });

  it('drivers sharing a place share the result', () => {
    const d = rateRace([e('a', 1), e('b', 3), e('c', 3)]);
    expect(d.get('b')).toBe(d.get('c'));
    expect(d.get('a')).toBeGreaterThan(0);
  });

  it('tiers climb from Learner to Lagos Legend', () => {
    expect(tierOf(800).name).toBe('Learner');
    expect(tierOf(START_RATING).name).toBe('Street Runner');
    expect(tierOf(1220).name).toBe('Expressway Ace');
    expect(tierOf(1700).name).toBe('Lagos Legend');
  });
});

describe('store', () => {
  it('knows players by a hash of their key, never the key', () => {
    const key = 'ab'.repeat(32);
    expect(Store.validKey(key)).toBe(true);
    expect(Store.validKey('nope')).toBe(false);
    expect(Store.validKey(42)).toBe(false);
    const pid = Store.pid(key);
    expect(pid).toMatch(/^[0-9a-f]{20}$/);
    expect(pid).not.toContain(key.slice(0, 20));
    expect(Store.pid(key)).toBe(pid);
  });

  it('rates a race, counts wins, and ranks the ladder', () => {
    const s = new Store(null);
    const r = s.rate([{ pid: 'a', name: 'Ada', place: 1, finished: true }, { pid: 'b', name: 'Bayo', place: 2, finished: true }, { pid: 'c', name: 'Chi', place: 3, finished: false }]);
    expect(r.get('a')!.delta).toBeGreaterThan(0);
    expect(r.get('c')!.delta).toBeLessThan(0);
    expect(s.find('a')!.wins).toBe(1);
    expect(s.board().map((b) => b.pid)).toEqual(['a', 'b', 'c']);
    expect(s.rankOf('a')).toBe(1);
    expect(s.rankOf('nobody')).toBeNull();
  });

  it('keeps each driver\'s best lap per route and ignores nonsense', () => {
    const s = new Store(null);
    s.lap('terminal', 'a', 'Ada', 41.2, 'tokunbo');
    s.lap('terminal', 'a', 'Ada', 43.0, 'tokunbo');
    s.lap('terminal', 'b', 'Bayo', 40.1, 'keke');
    s.lap('terminal', 'c', 'Chi', 0.5, 'keke');
    s.lap('terminal', 'd', 'Dee', Number.NaN, 'keke');
    expect(s.laps('terminal').map((l) => [l.pid, l.time])).toEqual([['b', 40.1], ['a', 41.2]]);
  });

  it('survives a restart through its file, and sets aside a corrupt one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rush-store-'));
    const file = path.join(dir, 'ranked.json');
    const s1 = new Store(file);
    s1.rate([{ pid: 'a', name: 'Ada', place: 1, finished: true }, { pid: 'b', name: 'Bayo', place: 2, finished: true }]);
    s1.flush();
    const s2 = new Store(file);
    expect(s2.find('a')!.rating).toBe(s1.find('a')!.rating);
    fs.writeFileSync(file, '{ not json');
    const notes: string[] = [];
    const s3 = new Store(file, (m) => notes.push(m));
    expect(s3.board()).toHaveLength(0);
    expect(notes[0]).toMatch(/unreadable/);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('ranked.json.bad-'))).toBe(true);
  });
});
