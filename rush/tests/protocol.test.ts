import { describe, it, expect } from 'vitest';
import { packState, unpackState, validState, packCar, unpackCar, packHazard, unpackHazard, normaliseCode, STATE_LEN } from '../src/shared/protocol';
import { sanitiseConfig } from '../src/shared/roomConfig';
import type { RemoteSnap } from '../src/shared/race';

const s: RemoteSnap = { x: 123.456789, y: 7.0123, z: -45.67891, h: 2.3456789, vx: 31.23456, vy: -0.5, vz: 12.345, drifting: true, driftTier: 2, boostT: 0.876, nitro: false, grounded: true, spinT: 0, danfoT: 1.234, pitch: 0.01234, roll: -0.0456 };

describe('protocol', () => {
  it('packs a car state into rounded numbers and back within a centimetre', () => {
    const a = packState(s);
    expect(a).toHaveLength(STATE_LEN);
    expect(validState(a)).toBe(true);
    const b = unpackState(a);
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz'] as const) expect(Math.abs(b[k] - s[k])).toBeLessThanOrEqual(0.005);
    for (const k of ['h', 'pitch', 'roll'] as const) expect(Math.abs(b[k] - s[k])).toBeLessThanOrEqual(0.0005);
    expect([b.drifting, b.nitro, b.grounded, b.driftTier]).toEqual([true, false, true, 2]);
  });
  it('rejects state arrays of the wrong shape', () => {
    expect(validState(packState(s).slice(1))).toBe(false);
    expect(validState([...packState(s).slice(1), NaN])).toBe(false);
    expect(validState({ x: 1 })).toBe(false);
    expect(validState(null)).toBe(false);
  });
  it('round trips snapshot cars and hazards', () => {
    const c = unpackCar(packCar({ i: 7, s, lap: 2, place: 3, fin: true, rd: 1234.567 }));
    expect([c.i, c.lap, c.place, c.fin]).toEqual([7, 2, 3, true]);
    expect(c.rd).toBeCloseTo(1234.6, 5);
    const h = unpackHazard(packHazard({ id: 9, k: 'rocket', x: 1.234, y: 2, z: 3, h: 0.5, s: 100.25, d: -1.5 }));
    expect(h.k).toBe('rocket');
    expect(h.s).toBeCloseTo(100.25, 5);
  });
  it('reads room codes the way people type them', () => {
    expect(normaliseCode('lagos-4827')).toBe('LAGOS-4827');
    expect(normaliseCode('4827')).toBe('LAGOS-4827');
    expect(normaliseCode(' 48 27 ')).toBe('LAGOS-4827');
    expect(normaliseCode('48')).toBe('');
  });
  it('clamps room settings whatever the client sends', () => {
    const c = sanitiseConfig({ laps: 99, aiFill: -5, maxPlayers: 1, track: 'nowhere', mode: 'trial', traffic: 7, weather: 'snow' as never }, undefined, ['terminal', 'oshodi']);
    expect(c.laps).toBe(6); expect(c.aiFill).toBe(0); expect(c.maxPlayers).toBe(2);
    expect(c.track).toBe('terminal'); expect(c.mode).toBe('street'); expect(c.traffic).toBe(3); expect(c.weather).toBe('clear');
  });
});
