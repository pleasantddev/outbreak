// Bakes the city map the game shows full screen (M): dark tiles of the whole world from the region packs, plus the
// place names and points of interest as JSON. Run from server/ (it has tsx):
//   CANVAS_FROM=/path/with/node_modules/@napi-rs/canvas npx tsx ../tools/bake_map.ts
// Output: v2/public/world/map/t{L}_{i}_{j}.webp (1024 px tiles; L3 is 4 m a pixel, L2 8, L1 16, L0 32),
//         v2/public/world/map/index.json (grid), labels.json (place names), pois.json (icons).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { parseRegion, ROAD, type Region } from '../v2/src/world/region.ts';

const req = createRequire((process.env.CANVAS_FROM ?? process.cwd()) + '/');
const { createCanvas } = req('@napi-rs/canvas');
const ROOT = resolve(import.meta.dirname, '../v2/public/world');
const OUT = resolve(ROOT, 'map'); mkdirSync(OUT, { recursive: true });
const man = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'));
const X0 = -22528, Z0 = -20480, PX = 1024;
const LEVELS = [{ L: 0, mpp: 32, nx: 2, nz: 1 }, { L: 1, mpp: 16, nx: 3, nz: 2 }, { L: 2, mpp: 8, nx: 5, nz: 4 }, { L: 3, mpp: 4, nx: 9, nz: 8 }];
const only = process.env.LEVELS ? process.env.LEVELS.split(',').map(Number) : null;

// ---------------------------------------------------------------- load every region
const packs = new Map<string, Buffer>();
const regions: Region[] = [];
for (const [k, meta] of Object.entries<any>(man.regions)) {
  const [i, j] = k.split(',').map(Number); let gz: Buffer;
  if (meta.pack) {
    let buf = packs.get(meta.pack); if (!buf) { buf = readFileSync(resolve(ROOT, meta.pack)); packs.set(meta.pack, buf); }
    const n = buf.readUInt16LE(4); let slice: Buffer | null = null;
    for (let q = 0; q < n; q++) { const o = 6 + q * 12; if (buf.readInt16LE(o) === i && buf.readInt16LE(o + 2) === j) { const off = buf.readUInt32LE(o + 4), len = buf.readUInt32LE(o + 8); slice = buf.subarray(off, off + len); } }
    if (!slice) continue; gz = slice;
  } else gz = readFileSync(resolve(ROOT, meta.f));
  const raw = gunzipSync(gz); regions.push(parseRegion(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), man.regionSize));
}
console.log('regions', regions.length);

// ---------------------------------------------------------------- style
const C = {
  land: '#171c24', green: '#1b3024', sport: '#1f3a29', wood: '#18291f', water: '#0f2a42', wet: '#13283a', industrial: '#1c2028', air: '#20252d', cemetery: '#1a2620',
  bld: '#232a35', motorway: '#e8b64a', primary: '#cfd5de', secondary: '#aab3c0', minor: '#6e7888', service: '#4a5260', rail: '#59606d', foot: '#3a414d',
};
const AREA_FILL: Record<number, string> = { 8: C.green, 9: C.sport, 13: C.green, 14: C.wood, 15: C.cemetery, 3: C.industrial, 22: C.air, 21: C.wet, 19: C.water, 16: C.industrial };
function roadStyle(cls: number): [string, number, number] | null { // colour, width in metres, minimum px
  if (cls === ROAD.motorway || cls === ROAD.trunk || cls === ROAD.motorwayLink) return [C.motorway, 16, 2.2];
  if (cls === ROAD.primary) return [C.primary, 13, 1.8];
  if (cls === ROAD.secondary || cls === ROAD.link) return [C.secondary, 11, 1.4];
  if (cls === ROAD.tertiary || cls === ROAD.unclassified || cls === ROAD.busway) return [C.minor, 8, 1];
  if (cls === ROAD.residential) return [C.minor, 6.5, 0.7];
  if (cls === ROAD.service) return [C.service, 4.5, 0.5];
  if (cls === ROAD.track || cls === ROAD.foot || cls === ROAD.steps) return [C.foot, 2.5, 0.4];
  return null;
}

function drawTile(L: number, mpp: number, ti: number, tj: number) {
  const cv = createCanvas(PX, PX); const g = cv.getContext('2d');
  const wx = X0 + ti * PX * mpp, wz = Z0 + tj * PX * mpp; const span = PX * mpp; const k = 1 / mpp;
  g.fillStyle = C.land; g.fillRect(0, 0, PX, PX);
  const near = regions.filter((r) => r.ox < wx + span + 10 && r.ox + man.regionSize > wx - 10 && r.oz < wz + span + 10 && r.oz + man.regionSize > wz - 10);
  const poly = (p: Float32Array) => { g.beginPath(); for (let q = 0; q < p.length; q += 2) { const x = (p[q] - wx) * k, y = (p[q + 1] - wz) * k; if (q) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); };
  // land use
  for (const r of near) for (const a of r.areas) { const f = AREA_FILL[a.kind]; if (!f) continue; g.fillStyle = f; poly(a.pts); g.fill(); }
  // water
  for (const r of near) for (const w of r.water) {
    if (!w.line) { g.fillStyle = w.kind === 6 ? C.wet : C.water; g.beginPath(); for (const ring of w.rings) { for (let q = 0; q < ring.length; q += 2) { const x = (ring[q] - wx) * k, y = (ring[q + 1] - wz) * k; if (q) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); } g.fill('evenodd'); continue; }
    const wm = w.kind === 4 ? 16 : w.kind === 3 ? 7 : w.kind === 2 ? 3 : 1.4; g.strokeStyle = C.water; g.lineWidth = Math.max(wm * k, w.kind >= 3 ? 1 : 0.5); g.lineCap = 'round'; g.lineJoin = 'round';
    const p = w.rings[0]; g.beginPath(); for (let q = 0; q < p.length; q += 2) { const x = (p[q] - wx) * k, y = (p[q + 1] - wz) * k; if (q) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
  }
  // buildings, only at the closest level
  if (L >= 3) { g.fillStyle = C.bld; for (const r of near) for (const b of r.buildings) { if (b.dead) continue; poly(b.pts); g.fill(); } }
  // rail
  g.setLineDash([3, 3]); g.strokeStyle = C.rail; g.lineWidth = Math.max(1, 3 * k);
  for (const r of near) for (const rl of r.rail) { const p = rl.pts; g.beginPath(); for (let q = 0; q < p.length; q += 2) { const x = (p[q] - wx) * k, y = (p[q + 1] - wz) * k; if (q) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
  g.setLineDash([]);
  // roads: casing then fill, minor first so the big roads sit on top
  const order = [ROAD.foot, ROAD.track, ROAD.steps, ROAD.service, ROAD.residential, ROAD.unclassified, ROAD.tertiary, ROAD.busway, ROAD.link, ROAD.secondary, ROAD.primary, ROAD.motorwayLink, ROAD.trunk, ROAD.motorway];
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const pass of [0, 1]) for (const cls of order) {
    const st = roadStyle(cls); if (!st) continue; if (L < 3 && (cls === ROAD.service || cls === ROAD.foot || cls === ROAD.track || cls === ROAD.steps)) continue; if (L < 2 && cls === ROAD.residential) continue;
    const w = Math.max(st[2], st[1] * k); if (pass === 0 && w < 1.6) continue;
    g.strokeStyle = pass === 0 ? '#0b0e13' : st[0]; g.lineWidth = pass === 0 ? w + 1.6 : w; g.beginPath();
    for (const r of near) for (const rd of r.roads) { if (rd.cls !== cls) continue; const p = rd.pts; for (let q = 0; q < p.length; q += 2) { const x = (p[q] - wx) * k, y = (p[q + 1] - wz) * k; if (q) g.lineTo(x, y); else g.moveTo(x, y); } }
    g.stroke();
  }
  writeFileSync(resolve(OUT, `t${L}_${ti}_${tj}.webp`), cv.toBuffer('image/webp', 82));
}

for (const lv of LEVELS) { if (only && !only.includes(lv.L)) continue; for (let i = 0; i < lv.nx; i++) for (let j = 0; j < lv.nz; j++) drawTile(lv.L, lv.mpp, i, j); console.log('level', lv.L, lv.nx * lv.nz, 'tiles'); }

// ---------------------------------------------------------------- names and icons
const labels: [string, number, number, number][] = []; const pois: [number, number, number, string][] = [];
const seen = new Set<string>();
for (const r of regions) for (const p of r.pois) {
  if (p.kind >= 30 && p.kind <= 35 && p.name) { const key = p.name + Math.round(p.x / 800) + Math.round(p.z / 800); if (seen.has(key)) continue; seen.add(key); labels.push([p.name, Math.round(p.x), Math.round(p.z), p.kind - 30]); continue; }
  if ([2, 3, 5, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 19, 21].includes(p.kind)) pois.push([p.kind, Math.round(p.x), Math.round(p.z), p.name ?? '']);
}
writeFileSync(resolve(OUT, 'index.json'), JSON.stringify({ x0: X0, z0: Z0, px: PX, levels: LEVELS, bounds: man.bounds }));
writeFileSync(resolve(OUT, 'labels.json'), JSON.stringify(labels));
writeFileSync(resolve(OUT, 'pois.json'), JSON.stringify(pois));
console.log('labels', labels.length, 'pois', pois.length);
