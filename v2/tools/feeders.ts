// Build src/data/feeders.json: the power grid's feeders (4 km squares), each named after the busiest place in it,
// with its building count (demand) and a band (A gets the most hours, like the real DisCo tariff bands).
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseRegion } from '../src/world/region';
import { GRID } from '../src/net/rules';
const M = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const feeders = Array.from({ length: GRID.w * GRID.h }, (_, i) => ({ i, name: '', b: 0, rich: 0, names: new Map<string, number>() }));
const packs = new Map<string, Buffer>(); const places: { name: string; x: number; z: number; w: number }[] = [];
for (const [k, meta] of Object.entries<any>(M.regions)) {
  const [i, j] = k.split(',').map(Number);
  let buf: Buffer;
  if (meta.pack) { if (!packs.has(meta.pack)) packs.set(meta.pack, readFileSync('public/world/' + meta.pack)); const p = packs.get(meta.pack)!; const n = p.readUInt16LE(4); let s: Buffer | null = null; for (let q = 0; q < n; q++) { const o = 6 + q * 12; if (p.readInt16LE(o) === i && p.readInt16LE(o + 2) === j) s = p.subarray(p.readUInt32LE(o + 4), p.readUInt32LE(o + 4) + p.readUInt32LE(o + 8)); } if (!s) continue; buf = s; }
  else buf = readFileSync('public/world/' + meta.f);
  const raw = gunzipSync(buf); const r = parseRegion(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, M.regionSize);
  for (const b of r.buildings) { const f = feeders[GRID.of(b.cx, b.cz)]; f.b++; if (b.kind === 3 || b.kind === 4 || b.kind === 13) f.rich++; }
  for (const p of r.pois) if (p.kind >= 30 && p.kind <= 35 && p.name) { const f = feeders[GRID.of(p.x, p.z)]; f.names.set(p.name, (f.names.get(p.name) ?? 0) + (p.kind <= 31 ? 5 : 1)); places.push({ name: p.name, x: p.x, z: p.z, w: p.kind <= 31 ? 1 : 1.6 }); }
}
const live = feeders.filter((f) => f.b > 0);
const shares = live.map((f) => f.rich / f.b).sort((a, b) => b - a); const qA = shares[Math.floor(shares.length * 0.25)], qB = shares[Math.floor(shares.length * 0.6)];
const used = new Set<string>();
const out = live.map((f) => {
  let name = [...f.names.entries()].sort((a, b) => b[1] - a[1]).find(([n]) => !used.has(n))?.[0] ?? '';
  if (!name) { const c = GRID.center(f.i); name = places.filter((p) => !used.has(p.name)).map((p) => ({ n: p.name, d: Math.hypot(p.x - c.x, p.z - c.z) * p.w })).sort((a, b) => a.d - b.d)[0]?.n ?? `Feeder ${f.i}`; }
  used.add(name); const share = f.rich / f.b;
  return { i: f.i, name, load: Math.max(1, Math.round(f.b / 100)), band: share > 0 && share >= qA ? 'A' : share > 0 && share >= qB ? 'B' : 'C' };
});
writeFileSync('src/data/feeders.json', JSON.stringify(out));
console.log(out.length, 'feeders', out.slice(0, 12).map((f) => `${f.name}:${f.load}:${f.band}`).join(' | '));
