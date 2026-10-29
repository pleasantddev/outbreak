import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateContent, summarize, type Bundle } from '../src/content/validate';

const read = (n: string) => JSON.parse(readFileSync(new URL(`../public/content/${n}.json`, import.meta.url), 'utf8')).items;
const bundle: Bundle = { places: read('places'), missions: read('missions'), events: read('events'), routes: read('routes'), skills: read('skills') };
const manifest = JSON.parse(readFileSync(new URL('../public/world/manifest.json', import.meta.url), 'utf8'));

describe('game content', () => {
  const issues = validateContent(bundle, manifest);
  it('has no errors (ids, references, reachable steps, map bounds)', () => {
    const errors = issues.filter((i) => i.level === 'error').map((i) => `${i.where}: ${i.msg}`);
    expect(errors).toEqual([]);
  });
  it('has the promised amount of content', () => {
    const s = summarize(bundle);
    expect(s.missions).toBeGreaterThanOrEqual(100);
    expect(s.events).toBeGreaterThanOrEqual(30);
    expect(s.routes).toBeGreaterThanOrEqual(20);
    expect(s.skills).toBeGreaterThanOrEqual(11);
    expect(s.places).toBeGreaterThanOrEqual(150);
  });
  it('uses every step type somewhere', () => {
    const s = summarize(bundle);
    const all = ['goto', 'talk', 'pickup', 'deliver', 'vehicle', 'route', 'visit', 'choice', 'branch', 'wait', 'call', 'fight', 'chase', 'tail', 'evade', 'race', 'sneak', 'hack', 'tap', 'trade', 'escort', 'stay', 'end'];
    expect(all.filter((t) => !(s.stepTypes[t] > 0))).toEqual([]);
  });
  it('keeps the old job names alive', () => {
    for (const k of ['delivery', 'danfo', 'parcel']) expect(bundle.missions.some((m) => m.legacy === k)).toBe(true);
  });
  it('logs warnings for review', () => {
    const w = issues.filter((i) => i.level === 'warn').map((i) => `${i.where}: ${i.msg}`);
    if (w.length) console.log(`content warnings (${w.length}):\n` + w.slice(0, 40).join('\n'));
    expect(true).toBe(true);
  });
});
