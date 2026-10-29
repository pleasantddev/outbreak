// @ts-nocheck
// Headless harness for the society model: loads real Lagos regions from public/world, builds the Society and runs it.
import { readFileSync } from 'node:fs';
import { Content } from '../src/systems/societyData';
import { Society } from '../src/systems/societyCore';
import { RegionStore } from '../src/world/region';

export function loadContentSync(root = new URL('../public/content/', import.meta.url).pathname) {
  const a = JSON.parse(readFileSync(root + 'npcs.json', 'utf8')), b = JSON.parse(readFileSync(root + 'economy.json', 'utf8'));
  return Content.from(a.items, b.items);
}
export async function loadStore(at: [number, number], r = 900) {
  const base = new URL('../public/world/', import.meta.url).pathname;
  (globalThis as any).window = (globalThis as any).window ?? {};
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: any) => { const buf = readFileSync(String(u)); return { ok: true, json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) } as any; }) as any;
  const store = new RegionStore(base); await store.init(); await store.around(at[0], at[1], r);
  globalThis.fetch = real;
  return store;
}
export function makeSociety(seed = 1234) { return new Society(loadContentSync(), seed); }
