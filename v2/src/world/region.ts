// Region files: 2 km squares of the Sango Ota to Papa Ajao corridor, packed from OpenStreetMap by pipe/pack.py.
// Map data (c) OpenStreetMap contributors, ODbL 1.0.
import { gunzipSync } from 'fflate';

export const ROAD = {
  motorway: 1, trunk: 2, primary: 3, secondary: 4, tertiary: 5, unclassified: 6, residential: 7, service: 8,
  motorwayLink: 9, link: 10, busway: 11, track: 12, foot: 13, steps: 14, construction: 15,
} as const;
export const RF = { oneway: 1, bridge: 2, tunnel: 4, roundabout: 8, unpaved: 16, reverse: 32 } as const;
export const BK = { house: 1, shops: 2, flats: 3, hotel: 4, warehouse: 5, church: 6, mosque: 7, institution: 8, unfinished: 9, canopy: 10, shed: 11, stand: 12, bank: 13, terminal: 14, station: 15, market: 16 } as const;
export const AREA = { residential: 1, commercial: 2, industrial: 3, school: 4, hospital: 5, market: 6, religious: 7, park: 8, pitch: 9, fuel: 10, parking: 11, busStation: 12, farm: 13, bush: 14, cemetery: 15, landfill: 16, brownfield: 17, military: 18, pool: 19, platform: 20, wetland: 21, airport: 22, rail: 23, police: 24, mechanic: 25 } as const;
/** Pitch sub-kinds (Area.sub when kind is pitch). */
export const SPORT = { none: 0, basketball: 1, soccer: 2, tennis: 3, athletics: 4, volleyball: 5, cricket: 6, multi: 7, swimming: 8 } as const;
export const POI = { busStop: 1, fuel: 2, market: 3, school: 4, hospital: 5, pharmacy: 6, bank: 7, food: 8, bar: 9, worship: 10, police: 11, mechanic: 12, shop: 13, hotel: 14, signals: 15, station: 16, busStation: 17, lamp: 18, atm: 19, carWash: 20, ferry: 21 } as const;
/** Rail kinds: 1 standard gauge, 2 narrow gauge, 3 light rail or metro, 5 disused, 6 platform, 7 station area. */
export const RAIL = { standard: 1, narrow: 2, light: 3, disused: 5, platform: 6, station: 7 } as const;
export const RLF = { bridge: 1, service: 4, closed: 8, electric: 16 } as const;

export interface Road { cls: number; lanes: number; flags: number; layer: number; name: string | null; id: number; pts: Float32Array /* x,z pairs, world metres */; width: number /* full width in metres if tagged, else 0 */; elev: Float32Array | null /* deck height per point for bridges */ }
export interface Building { kind: number; levels: number; name: string | null; id: number; pts: Float32Array; cx: number; cz: number; area: number; height: number /* metres from OSM height tag, 0 when unknown */; roof: number; wallRGB: number | null; roofRGB: number | null; /** set by declutter.ts: the footprint was moved off the road corridor / is dropped */ fit?: boolean; dead?: boolean }
export interface ParcelRec { id: string; zone: number; rich: number; name: string | null; bids: number[]; pts: Float32Array }
export interface Block { pts: Float32Array }
export interface Area { kind: number; sub: number; name: string | null; pts: Float32Array }
export interface Water { kind: number; line: boolean; name: string | null; rings: Float32Array[] }
export interface Rail { kind: number; flags: number; gauge: number; name: string | null; pts: Float32Array; elev: Float32Array | null }
export interface Poi { kind: number; name: string | null; x: number; z: number }
export interface Pothole { x: number; z: number; r: number; depth: number; report: number }
export interface Region {
  i: number; j: number; ox: number; oz: number;
  roads: Road[]; buildings: Building[]; parcels: ParcelRec[]; areas: Area[]; water: Water[]; rail: Rail[]; pois: Poi[]; potholes: Pothole[];
}
export interface Manifest { origin: { lat: number; lon: number }; regionSize: number; bounds: [number, number, number, number]; regions: Record<string, { f: string; b: number; r: number; kb: number; pack?: string }>; attribution: string; osm_timestamp: string }

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof (window as any).DecompressionStream !== 'function') { const out = gunzipSync(new Uint8Array(buf)); return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer; }
  const ds = new (window as any).DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

export function parseRegion(buf: ArrayBuffer, size: number): Region {
  const dv = new DataView(buf); let o = 0;
  const u8 = () => dv.getUint8(o++), i8 = () => dv.getInt8(o++);
  const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
  const i16 = () => { const v = dv.getInt16(o, true); o += 2; return v; };
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  const magic = String.fromCharCode(u8(), u8(), u8(), u8());
  if (magic !== 'HLR2') throw new Error('bad region ' + magic);
  const i = i16(), j = i16(); const ns = u16();
  const td = new TextDecoder(); const strs: string[] = [];
  for (let k = 0; k < ns; k++) { const l = u16(); strs.push(td.decode(new Uint8Array(buf, o, l))); o += l; }
  const S = (v: number) => (v === 0xffff ? null : strs[v] ?? null);
  const ox = (i + 0.5) * size, oz = (j + 0.5) * size;
  const r: Region = { i, j, ox, oz, roads: [], buildings: [], parcels: [], areas: [], water: [], rail: [], pois: [], potholes: [] };
  let n = u32();
  for (let k = 0; k < n; k++) {
    const cls = u8(), lanes = u8(), flags = u8(), layer = i8(), name = S(u16()), np = u16(), id = u32(), wd = u8();
    const pts = new Float32Array(np * 2);
    for (let p = 0; p < np; p++) { pts[p * 2] = ox + i32() / 10; pts[p * 2 + 1] = oz + i32() / 10; }
    let elev: Float32Array | null = null;
    if (flags & 2) { elev = new Float32Array(np); for (let p = 0; p < np; p++) elev[p] = i16() / 10; }
    r.roads.push({ cls, lanes, flags, layer, name, id, pts, width: wd / 2, elev });
  }
  n = u32();
  for (let k = 0; k < n; k++) {
    const kind = u8(), levels = u8(), np = u8(), roof = u8(), hdm = u16(), cf = u8(), name = S(u16()), id = u32();
    const pts = new Float32Array(np * 2); let cx = 0, cz = 0, a = 0;
    for (let p = 0; p < np; p++) { pts[p * 2] = ox + i16() / 10; pts[p * 2 + 1] = oz + i16() / 10; cx += pts[p * 2]; cz += pts[p * 2 + 1]; }
    let wallRGB: number | null = null, roofRGB: number | null = null;
    if (cf & 1) { wallRGB = (u8() << 16) | (u8() << 8) | u8(); }
    if (cf & 2) { roofRGB = (u8() << 16) | (u8() << 8) | u8(); }
    if (np < 3) continue;
    for (let p = 0; p < np; p++) { const q = (p + 1) % np; a += pts[p * 2] * pts[q * 2 + 1] - pts[q * 2] * pts[p * 2 + 1]; }
    r.buildings.push({ kind, levels, name, id, pts, cx: cx / np, cz: cz / np, area: Math.abs(a / 2), height: hdm / 10, roof, wallRGB, roofRGB });
  }
  n = u32();
  for (let k = 0; k < n; k++) {
    const idt = u8(), a = i32(), b = i32(), zone = u8(), rich = u8() / 255, np = u8(), name = S(u16()), nb = u16();
    const bids: number[] = []; for (let q = 0; q < nb; q++) bids.push(u32());
    const pts = new Float32Array(np * 2);
    for (let p = 0; p < np; p++) { pts[p * 2] = ox + i16() / 10; pts[p * 2 + 1] = oz + i16() / 10; }
    const id = idt === 0 ? `B${a}` : idt === 1 ? `L${a}_${b}` : idt === 2 ? `V${a}_${b}` : (strs[a] ?? `X${a}`);
    r.parcels.push({ id, zone, rich, name, bids, pts });
  }
  n = u32();
  for (let k = 0; k < n; k++) {
    const kind = u8(), sub = u8(), name = S(u16()), np = u16(); const pts = new Float32Array(np * 2);
    for (let p = 0; p < np; p++) { pts[p * 2] = ox + i16() / 10; pts[p * 2 + 1] = oz + i16() / 10; }
    r.areas.push({ kind, sub, name, pts });
  }
  n = u32();
  for (let k = 0; k < n; k++) {
    const kind = u8(), line = u8() === 1, name = S(u16()), nr = u8(); const rings: Float32Array[] = [];
    for (let q = 0; q < nr; q++) { const np = u16(); const pts = new Float32Array(np * 2); for (let p = 0; p < np; p++) { pts[p * 2] = ox + i32() / 10; pts[p * 2 + 1] = oz + i32() / 10; } rings.push(pts); }
    r.water.push({ kind, line, name, rings });
  }
  n = u32();
  for (let k = 0; k < n; k++) {
    const kind = u8(), flags = u8(), gauge = u16(), name = S(u16()), np = u16(); const pts = new Float32Array(np * 2);
    for (let p = 0; p < np; p++) { pts[p * 2] = ox + i32() / 10; pts[p * 2 + 1] = oz + i32() / 10; }
    let elev: Float32Array | null = null;
    if (flags & 1) { elev = new Float32Array(np); for (let p = 0; p < np; p++) elev[p] = i16() / 10; }
    r.rail.push({ kind, flags, gauge, name, pts, elev });
  }
  n = u32();
  for (let k = 0; k < n; k++) { const kind = u8(), name = S(u16()); const x = ox + i16() / 10, z = oz + i16() / 10; r.pois.push({ kind, name, x, z }); }
  n = u32();
  for (let k = 0; k < n; k++) { const x = ox + i16() / 10, z = oz + i16() / 10, rr = u8() / 40, d = u8() / 400, rep = u8(); r.potholes.push({ x, z, r: rr, depth: d, report: rep }); }
  return r;
}

export class RegionStore {
  manifest!: Manifest;
  regions = new Map<string, Region>();
  /** Every loaded building by OSM id, so parcels can find buildings that sit in a neighbouring region. */
  bldById = new Map<number, Building>();
  private pending = new Map<string, Promise<Region | null>>();
  constructor(public base = 'world/') {}
  async init() { this.manifest = await (await fetch(this.base + 'manifest.json')).json(); }
  key(i: number, j: number) { return `${i},${j}`; }
  regionOf(x: number, z: number) { const s = this.manifest.regionSize; return [Math.floor(x / s), Math.floor(z / s)] as const; }
  has(i: number, j: number) { return !!this.manifest.regions[this.key(i, j)]; }
  get(i: number, j: number) { return this.regions.get(this.key(i, j)) ?? null; }
  load(i: number, j: number): Promise<Region | null> {
    const k = this.key(i, j);
    if (this.regions.has(k)) return Promise.resolve(this.regions.get(k)!);
    if (this.pending.has(k)) return this.pending.get(k)!;
    const meta = this.manifest.regions[k];
    if (!meta) return Promise.resolve(null);
    const src = meta.pack ? this.packSlice(meta.pack, i, j) : fetch(this.base + meta.f).then((r) => r.arrayBuffer());
    const p = src.then(gunzip).then((b) => { const reg = parseRegion(b, this.manifest.regionSize); this.regions.set(k, reg); for (const bd of reg.buildings) this.bldById.set(bd.id, bd); this.pending.delete(k); return reg; });
    this.pending.set(k, p);
    return p;
  }
  private packs = new Map<string, Promise<ArrayBuffer>>();
  /** Regions ship in 2x2 packs: HLP1, count, then (i, j, offset, length) entries and the gzip blobs. */
  private async packSlice(pack: string, i: number, j: number) {
    if (!this.packs.has(pack)) this.packs.set(pack, fetch(this.base + pack).then((r) => r.arrayBuffer()));
    const buf = await this.packs.get(pack)!; const dv = new DataView(buf); const n = dv.getUint16(4, true);
    for (let k = 0; k < n; k++) { const o = 6 + k * 12; if (dv.getInt16(o, true) === i && dv.getInt16(o + 2, true) === j) return buf.slice(dv.getUint32(o + 4, true), dv.getUint32(o + 4, true) + dv.getUint32(o + 8, true)); }
    throw new Error('region missing from pack ' + pack);
  }
  /** Loads every region touching the square around (x, z). */
  async around(x: number, z: number, r: number) {
    const [a, b] = this.regionOf(x - r, z - r), [c, d] = this.regionOf(x + r, z + r);
    const ps: Promise<Region | null>[] = [];
    for (let i = a; i <= c; i++) for (let j = b; j <= d; j++) ps.push(this.load(i, j));
    return (await Promise.all(ps)).filter((r): r is Region => !!r);
  }
  unloadFar(x: number, z: number, keep: number) {
    const s = this.manifest.regionSize;
    for (const [k, r] of this.regions) if (Math.abs(r.ox - x) > keep + s || Math.abs(r.oz - z) > keep + s) { for (const bd of r.buildings) this.bldById.delete(bd.id); this.regions.delete(k); }
  }
  /** World metres from lat/lon, same projection as the packer. */
  project(lat: number, lon: number) {
    const o = this.manifest.origin; const kx = Math.cos((o.lat * Math.PI) / 180) * 111320, kz = 110574;
    return { x: (lon - o.lon) * kx, z: -(lat - o.lat) * kz };
  }
}
