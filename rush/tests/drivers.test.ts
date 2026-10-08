// Driver looks: every generated look is one a client could have picked, and the server only lets well formed
// looks through.
import { describe, it, expect } from 'vitest';
import { lookFor, validLook, SKINS } from '../src/shared/drivers';

describe('driver looks', () => {
  it('generates a valid look for any number, the same one every time', () => {
    for (let n = -50; n < 5000; n++) expect(validLook(lookFor(n))).toEqual(lookFor(n));
    expect(lookFor(42)).toEqual(lookFor(42));
  });

  it('gives a field of AI drivers a spread of looks', () => {
    const looks = Array.from({ length: 12 }, (_, i) => lookFor(1000 + i));
    expect(new Set(looks.map((l) => l.head)).size).toBeGreaterThan(2);
    expect(new Set(looks.map((l) => l.skin)).size).toBeGreaterThan(2);
    for (const l of looks) expect(l.accent).not.toBe(l.top);
  });

  it('turns away anything malformed', () => {
    const ok = { skin: 2, head: 'gele', top: '#0b7a3e', accent: '#f6c514' };
    expect(validLook(ok)).toEqual(ok);
    expect(validLook(null)).toBeNull();
    expect(validLook('gele')).toBeNull();
    expect(validLook({ ...ok, skin: SKINS.length })).toBeNull();
    expect(validLook({ ...ok, skin: 1.5 })).toBeNull();
    expect(validLook({ ...ok, head: 'crown' })).toBeNull();
    expect(validLook({ ...ok, top: 'red' })).toBeNull();
    expect(validLook({ ...ok, accent: '#12345' })).toBeNull();
    expect(validLook({ ...ok, extra: '<script>' })).toEqual(ok);
  });
});
