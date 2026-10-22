// Bakes the whole-Lagos overview used by the admin 3D map: a top-down ground texture of all 272 regions,
// a skyline of tall buildings, the POI list and a searchable place index. Run: npx tsx tools/bake-map.ts
// Input: the game's own world packs (v2/public/world). Output: admin/public/map/*
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { gunzipSync, zlibSync } from 'fflate';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseRegion, ROAD, BK, AREA, POI, type Region } from '../../v2/src/world/region.ts';
import { plotPrice, type Plot } from '../../v2/src/world/plots.ts';

const here = dirname(fileURLToPath(import.meta.url));
const WORLD = process.env.WORLD_DIR || resolve(here, '../../v2/public/world');
const OUT = resolve(here, '../public/map');
mkdirSync(OUT, { recursive: true });
const man = JSON.parse(readFileSync(WORLD + '/manifest.json', 'utf8'));
const [bx0, bz0, bx1, bz1] = man.bounds as number[];
const W = 4096, S = (bx1 - bx0) / W, H = Math.ceil((bz1 - bz0) / S);
console.log('raster', W, H, 'm/px', S.toFixed(2));

const packs = new Map<string, Buffer>();
function loadRegion(i: number, j: number): Region | null {
  const meta = man.regions[`${i},${j}`]; if (!meta) return null;
  let buf: Buffer;
  if (meta.pack) {
    if (!packs.has(meta.pack)) packs.set(meta.pack, readFileSync(WORLD + '/' + meta.pack));
    const pk = packs.get(meta.pack)!; const dv = new DataView(pk.buffer, pk.byteOffset, pk.byteLength); const n = dv.getUint16(4, true);
    let slice: Uint8Array | null = null;
    for (let k = 0; k < n; k++) { const o = 6 + k * 12; if (dv.getInt16(o, true) === i && dv.getInt16(o + 2, true) === j) { const off = dv.getUint32(o + 4, true), len = dv.getUint32(o + 8, true); slice = pk.subarray(off, off + len); break; } }
    if (!slice) return null; buf = Buffer.from(slice);
  } else buf = readFileSync(WORLD + '/' + meta.f);
  const raw = gunzipSync(new Uint8Array(buf));
  return parseRegion(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, man.regionSize);
}

// ---------- raster ----------
const rgb = new Uint8Array(W * H * 3);
const cov = new Float32Array(W * H); const bcol = new Uint8Array(W * H * 3);
const hex = (h: number): [number, number, number] => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const BG = hex(0x0b0e15);
for (let i = 0; i < W * H; i++) { rgb[i * 3] = BG[0]; rgb[i * 3 + 1] = BG[1]; rgb[i * 3 + 2] = BG[2]; }
const px = (x: number) => (x - bx0) / S, pz = (z: number) => (z - bz0) / S;

function fill(pts: ArrayLike<number>, col: [number, number, number], a: number, into: 'rgb' | 'b' = 'rgb', covAdd = 0) {
  const n = pts.length / 2; if (n < 3) return;
  let y0 = Infinity, y1 = -Infinity; const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let k = 0; k < n; k++) { xs[k] = px(pts[k * 2]); ys[k] = pz(pts[k * 2 + 1]); y0 = Math.min(y0, ys[k]); y1 = Math.max(y1, ys[k]); }
  const ya = Math.max(0, Math.ceil(y0 - 0.5)), yb = Math.min(H - 1, Math.floor(y1 - 0.5));
  const hit: number[] = [];
  for (let y = ya; y <= yb; y++) {
    const yc = y + 0.5; hit.length = 0;
    for (let k = 0, j = n - 1; k < n; j = k++) { const a0 = ys[j], b0 = ys[k]; if ((a0 <= yc) !== (b0 <= yc)) hit.push(xs[j] + ((yc - a0) / (b0 - a0)) * (xs[k] - xs[j])); }
    hit.sort((p, q) => p - q);
    for (let h = 0; h + 1 < hit.length; h += 2) {
      const xa = Math.max(0, Math.ceil(hit[h] - 0.5)), xb = Math.min(W - 1, Math.floor(hit[h + 1] - 0.5));
      for (let x = xa; x <= xb; x++) {
        const o = y * W + x;
        if (into === 'rgb') { rgb[o * 3] += (col[0] - rgb[o * 3]) * a; rgb[o * 3 + 1] += (col[1] - rgb[o * 3 + 1]) * a; rgb[o * 3 + 2] += (col[2] - rgb[o * 3 + 2]) * a; }
        else { cov[o] = Math.min(1, cov[o] + (covAdd || 1)); bcol[o * 3] = col[0]; bcol[o * 3 + 1] = col[1]; bcol[o * 3 + 2] = col[2]; }
      }
    }
  }
}
function line(pts: ArrayLike<number>, w: number, col: [number, number, number], a = 1) {
  const n = pts.length / 2;
  for (let k = 0; k < n - 1; k++) {
    const x0 = px(pts[k * 2]), y0 = pz(pts[k * 2 + 1]), x1 = px(pts[k * 2 + 2]), y1 = pz(pts[k * 2 + 3]);
    if ((x0 < -4 && x1 < -4) || (y0 < -4 && y1 < -4) || (x0 > W + 4 && x1 > W + 4) || (y0 > H + 4 && y1 > H + 4)) continue;
    const L = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, Math.ceil(L / 0.5)); const r = w / 2 + 0.5;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
      for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
        if (yy < 0 || yy >= H) continue;
        for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
          if (xx < 0 || xx >= W) continue;
          const d = Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy); const c = Math.max(0, Math.min(1, w / 2 + 0.5 - d)) * a; if (c <= 0) continue;
          const o = yy * W + xx;
          if (c > roadA[o]) { roadA[o] = c; roadC[o * 3] = col[0]; roadC[o * 3 + 1] = col[1]; roadC[o * 3 + 2] = col[2]; }
        }
      }
    }
  }
}
const roadA = new Float32Array(W * H), roadC = new Uint8Array(W * H * 3);

const ZONE_COL: [number, number, number][] = [hex(0x0b0e15), hex(0x121823), hex(0x1b1631), hex(0x211c14), hex(0x10242a), hex(0x1a1520)];
const AREA_COL: Record<number, [number, number, number]> = {
  [AREA.park]: hex(0x0f2a1f), [AREA.bush]: hex(0x0d1d17), [AREA.farm]: hex(0x13221a), [AREA.pitch]: hex(0x123a2b), [AREA.cemetery]: hex(0x16201c),
  [AREA.industrial]: hex(0x241f17), [AREA.market]: hex(0x2a1c3a), [AREA.school]: hex(0x16303a), [AREA.hospital]: hex(0x301a30), [AREA.wetland]: hex(0x0c2e30),
  [AREA.airport]: hex(0x1e222c), [AREA.military]: hex(0x1c1c14), [AREA.landfill]: hex(0x1d1a16), [AREA.fuel]: hex(0x2a2414), [AREA.parking]: hex(0x181c26), [AREA.busStation]: hex(0x1d2733), [AREA.religious]: hex(0x1d1b2c), [AREA.platform]: hex(0x1a2030), [AREA.mechanic]: hex(0x2b2418), [AREA.police]: hex(0x1a2438), [AREA.commercial]: hex(0x1b1631), [AREA.brownfield]: hex(0x1b1914), [AREA.pool]: hex(0x0e4a58),
};
const WATER = hex(0x0d4a5a);
const BK_COL: Record<number, [number, number, number]> = {
  [BK.house]: hex(0x4a5368), [BK.shops]: hex(0x7a62d8), [BK.flats]: hex(0x5d6a86), [BK.hotel]: hex(0x9b7be8), [BK.warehouse]: hex(0x6f6a5c), [BK.church]: hex(0xc9b27a), [BK.mosque]: hex(0x59d6bd),
  [BK.institution]: hex(0x39b8c8), [BK.unfinished]: hex(0x3a3f4a), [BK.bank]: hex(0xe8c44a), [BK.terminal]: hex(0x39b8c8), [BK.station]: hex(0x39b8c8), [BK.market]: hex(0xc47ad8), [BK.canopy]: hex(0x3c4252), [BK.shed]: hex(0x3a3f4a), [BK.stand]: hex(0x3a3f4a),
};
const ROAD_STYLE: Record<number, [number, [number, number, number], number]> = {
  [ROAD.motorway]: [3.4, hex(0xf2c76b), 1], [ROAD.trunk]: [3, hex(0xe9b25a), 1], [ROAD.primary]: [2.4, hex(0xb9a6f2), 1], [ROAD.secondary]: [1.9, hex(0x8f86d8), 1],
  [ROAD.tertiary]: [1.4, hex(0x7480a8), 0.95], [ROAD.unclassified]: [1.0, hex(0x56627f), 0.8], [ROAD.residential]: [0.8, hex(0x465270), 0.7], [ROAD.motorwayLink]: [1.8, hex(0xf2c76b), 1], [ROAD.link]: [1.6, hex(0xb9a6f2), 1],
};

const towers: number[] = []; const towerKind: number[] = [];
const pois: { k: string; n: string | null; x: number; z: number }[] = [];
const places: [string, string, number, number][] = []; // name, kind, x, z
const POI_KEEP = new Set<number>([POI.fuel, POI.market, POI.school, POI.hospital, POI.pharmacy, POI.bank, POI.police, POI.mechanic, POI.hotel, POI.station, POI.busStation, POI.atm, POI.carWash, POI.ferry, POI.worship, 30, 31, 32, 33, 34, 35]);
const POI_NAME: Record<number, string> = { 30: 'place:city', 31: 'place:town', 32: 'place:suburb', 33: 'place:neighbourhood', 34: 'place:village', 35: 'place:hamlet', 99: 'named' }; for (const [k, v] of Object.entries(POI)) POI_NAME[v as number] = k;
const LGA_RAW = /local government|\blga\b|council secretariat|area council/i;
const LGA_RE = { test: (n: string) => LGA_RAW.test(n) && !/school|schl|college|hospital|health/i.test(n) };
const AREA_POI: Record<number, string> = { [AREA.market]: 'market', [AREA.mechanic]: 'mechanic', [AREA.busStation]: 'busStation', [AREA.airport]: 'airport', [AREA.police]: 'police' };
const roadSeen = new Set<string>();
const sampleParcels: unknown[] = []; let sampleN = 0;
const ZN = ['vacant', 'residential', 'commercial', 'industrial', 'institution', 'unfinished'];
let nB = 0, nR = 0;

const t0 = Date.now();
const regs: Region[] = [];
// pass 1 collects (one region at a time to keep memory flat) and rasterises ground layers per region
for (const key of Object.keys(man.regions)) {
  const [i, j] = key.split(',').map(Number);
  const r = loadRegion(i, j); if (!r) continue;
  for (const pc of r.parcels) fill(pc.pts, ZONE_COL[pc.zone] ?? ZONE_COL[1], 0.55 + pc.rich * 0.3);
  if (Math.abs(i) <= 2 && j >= -4 && j <= 2) for (const pc of r.parcels) {
    if (pc.pts.length < 6 || (sampleN++ % 37) !== 0) continue;
    const c = centroid(pc.pts); let a = 0; const n = pc.pts.length / 2; for (let k = 0; k < n; k++) { const q = (k + 1) % n; a += pc.pts[k * 2] * pc.pts[q * 2 + 1] - pc.pts[q * 2] * pc.pts[k * 2 + 1]; } a = Math.abs(a / 2);
    const price = plotPrice({ area: a, zone: ZN[pc.zone] as Plot['zone'], rich: pc.rich } as Plot, c[0], c[1]);
    sampleParcels.push([pc.id, Math.round(c[0] * 10) / 10, Math.round(c[1] * 10) / 10, pc.zone, Math.round(pc.rich * 100) / 100, Math.round(a), pc.name, price]);
  }
  for (const a of r.areas) { const c = AREA_COL[a.kind]; if (c) fill(a.pts, c, 0.9); if (a.name) { const [cx, cz] = centroid(a.pts); places.push([a.name, 'area', cx, cz]); const cat = LGA_RE.test(a.name) ? 'lga' : AREA_POI[a.kind]; if (cat) pois.push({ k: cat, n: a.name, x: cx, z: cz }); } }
  for (const w of r.water) { if (w.line) { for (const ring of w.rings) line(ring, 1.5, WATER, 1); } else for (const ring of w.rings) fill(ring, WATER, 1); if (w.name) places.push([w.name, 'water', w.rings[0][0], w.rings[0][1]]); }
  for (const b of r.buildings) {
    nB++;
    const col = BK_COL[b.kind] ?? BK_COL[BK.house];
    const bbw = bboxSize(b.pts);
    if (bbw / S > 2) fill(b.pts, col, 1, 'b'); else { const o = Math.floor(pz(b.cz)) * W + Math.floor(px(b.cx)); if (o >= 0 && o < W * H) { cov[o] = Math.min(1, cov[o] + b.area / (S * S) * 1.3); bcol[o * 3] = col[0]; bcol[o * 3 + 1] = col[1]; bcol[o * 3 + 2] = col[2]; } }
    const hgt = b.height > 0 ? b.height : b.levels * 3.2;
    if ((hgt >= 22 || b.levels >= 7) && b.pts.length >= 6) { const o = obbLite(b.pts); towers.push(o.cx, o.cz, o.w, o.d, o.ang, hgt); towerKind.push(b.kind); }
    if (b.name) { places.push([b.name, 'bld', b.cx, b.cz]); if (LGA_RE.test(b.name)) pois.push({ k: 'lga', n: b.name, x: b.cx, z: b.cz }); }
  }
  for (const rd of r.roads) {
    nR++;
    const st = ROAD_STYLE[rd.cls]; if (st) line(rd.pts, st[0], st[1], st[2]);
    if (rd.name) { const k = `${rd.name}|${i},${j}`; if (!roadSeen.has(k)) { roadSeen.add(k); const m = rd.pts.length / 4 | 0; places.push([rd.name, 'road', rd.pts[m * 2], rd.pts[m * 2 + 1]]); } }
  }
  for (const p of r.pois) { if (p.name && LGA_RE.test(p.name)) pois.push({ k: 'lga', n: p.name, x: p.x, z: p.z }); else if (POI_KEEP.has(p.kind)) pois.push({ k: POI_NAME[p.kind], n: p.name, x: p.x, z: p.z }); if (p.name) places.push([p.name, 'poi:' + (POI_NAME[p.kind] ?? p.kind), p.x, p.z]); }
  for (const rl of r.rail) { if (rl.kind <= 3) line(rl.pts, 0.9, hex(0xd9d4c2), 0.8); }
  void regs;
}
function centroid(p: ArrayLike<number>): [number, number] { let x = 0, z = 0; const n = p.length / 2; for (let k = 0; k < n; k++) { x += p[k * 2]; z += p[k * 2 + 1]; } return [x / n, z / n]; }
function bboxSize(p: ArrayLike<number>) { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (let k = 0; k < p.length; k += 2) { a = Math.min(a, p[k]); b = Math.max(b, p[k]); c = Math.min(c, p[k + 1]); d = Math.max(d, p[k + 1]); } return Math.max(b - a, d - c); }
function obbLite(p: ArrayLike<number>) {
  const n = p.length / 2; let best = { a: Infinity, ang: 0, cx: 0, cz: 0, w: 0, d: 0 };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; const ang = Math.atan2(p[j * 2 + 1] - p[i * 2 + 1], p[j * 2] - p[i * 2]); const c = Math.cos(ang), s = Math.sin(ang);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < n; k++) { const x = p[k * 2] * c + p[k * 2 + 1] * s, z = -p[k * 2] * s + p[k * 2 + 1] * c; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const a = (x1 - x0) * (z1 - z0);
    if (a < best.a) { const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2; best = { a, ang, cx: mx * c - mz * s, cz: mx * s + mz * c, w: x1 - x0, d: z1 - z0 }; }
  }
  return best;
}
console.log('parsed', nB, 'buildings', nR, 'roads in', ((Date.now() - t0) / 1000).toFixed(1), 's; towers', towers.length / 6, 'pois', pois.length, 'places', places.length);

// compose: ground, then buildings by coverage, then roads
for (let o = 0; o < W * H; o++) {
  const c = Math.min(1, cov[o] * 1.15);
  if (c > 0) for (let q = 0; q < 3; q++) rgb[o * 3 + q] += (bcol[o * 3 + q] - rgb[o * 3 + q]) * c * 0.95;
  const a = roadA[o];
  if (a > 0) for (let q = 0; q < 3; q++) rgb[o * 3 + q] += (roadC[o * 3 + q] - rgb[o * 3 + q]) * a;
}

// PNG encode (RGB, filter 1 Sub per row)
function png(w: number, h: number, data: Uint8Array) {
  const row = w * 3; const raw = new Uint8Array((row + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (row + 1)] = 1; for (let x = 0; x < row; x++) raw[y * (row + 1) + 1 + x] = (data[y * row + x] - (x >= 3 ? data[y * row + x - 3] : 0)) & 255; }
  const z = zlibSync(raw, { level: 9 });
  const crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Uint8Array) => { const o = new Uint8Array(12 + d.length); const dv = new DataView(o.buffer); dv.setUint32(0, d.length); for (let i = 0; i < 4; i++) o[4 + i] = t.charCodeAt(i); o.set(d, 8); dv.setUint32(8 + d.length, crc(o.subarray(4, 8 + d.length))); return o; };
  const ih = new Uint8Array(13); const dv = new DataView(ih.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 8; ih[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
writeFileSync(OUT + '/base.png', png(W, H, rgb));
// the PNG is only an intermediate: convert to WebP (about 4 MB instead of 14 MB) when Pillow is available
try { execSync(`python3 -c "from PIL import Image; Image.open('${OUT}/base.png').save('${OUT}/base.webp', quality=84, method=6)"`); unlinkSync(OUT + '/base.png'); } catch { console.log('Pillow missing: left base.png in place (change the loader to base.png)'); }
// towers: f32 x6 per tower, kind u8 array appended
const tw = new Float32Array(towers); const tk = new Uint8Array(towerKind);
const tb = new Uint8Array(4 + tw.byteLength + tk.length); new DataView(tb.buffer).setUint32(0, tk.length, true); tb.set(new Uint8Array(tw.buffer), 4); tb.set(tk, 4 + tw.byteLength);
writeFileSync(OUT + '/towers.bin', tb);
const r1 = (v: number) => Math.round(v * 10) / 10;
writeFileSync(OUT + '/pois.json', JSON.stringify(pois.map((p) => [p.k, p.n, r1(p.x), r1(p.z)])));
// places: dedupe identical name+kind within 150 m
const seen = new Set<string>(); const pl = places.filter((p) => { const k = p[0] + '|' + p[1] + '|' + Math.round(p[2] / 150) + '|' + Math.round(p[3] / 150); if (seen.has(k)) return false; seen.add(k); return true; }).map((p) => [p[0], p[1], r1(p[2]), r1(p[3])]);
writeFileSync(OUT + '/places.json', JSON.stringify(pl));
mkdirSync(resolve(here, '../seed'), { recursive: true });
writeFileSync(resolve(here, '../seed/parcels-sample.json'), JSON.stringify(sampleParcels));
writeFileSync(OUT + '/meta.json', JSON.stringify({ w: W, h: H, bounds: man.bounds, mpp: S, origin: man.origin, regionSize: man.regionSize, baked: new Date().toISOString().slice(0, 10), poiKinds: POI_NAME }));
console.log('done', ((Date.now() - t0) / 1000).toFixed(1), 's');
