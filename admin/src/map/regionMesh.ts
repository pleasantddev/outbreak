// Lighter-LOD meshes for one 2 km region, built from the game's own region data (v2/src/world/region.ts):
// ground tint and water, roads as flat ribbons, parcels (fillable by status), and buildings as merged extrusions.
import * as THREE from 'three';
import { AREA, BK, ROAD, type Region } from '@world/region';
import { halfWidth } from '@world/roadspec';

export const ZONES = ['vacant', 'residential', 'commercial', 'industrial', 'institution', 'unfinished'];
export const ZONE_RGB: number[] = [0x14202a, 0x1a2230, 0x2a2048, 0x2e2718, 0x143a40, 0x2a1d2a];
const AREA_RGB: Record<number, number> = { [AREA.park]: 0x12402c, [AREA.bush]: 0x0f2a20, [AREA.farm]: 0x17352a, [AREA.pitch]: 0x17604a, [AREA.cemetery]: 0x1f302a, [AREA.wetland]: 0x0d3f44, [AREA.pool]: 0x14788c, [AREA.airport]: 0x232a38, [AREA.parking]: 0x1b2130, [AREA.landfill]: 0x2a241c, [AREA.military]: 0x2a2a1c };
const BK_RGB: Record<number, number> = { [BK.house]: 0x5a6479, [BK.shops]: 0x8f78ea, [BK.flats]: 0x6e7c9a, [BK.hotel]: 0xad90f2, [BK.warehouse]: 0x827b69, [BK.church]: 0xd7bf86, [BK.mosque]: 0x62e0c8, [BK.institution]: 0x47c4d4, [BK.unfinished]: 0x4a505c, [BK.bank]: 0xeed25a, [BK.terminal]: 0x47c4d4, [BK.station]: 0x47c4d4, [BK.market]: 0xd08ae0, [BK.canopy]: 0x4a5164, [BK.shed]: 0x4a505c, [BK.stand]: 0x4a505c };
const ROAD_RGB = (cls: number) => (cls <= ROAD.trunk ? 0x7a6a44 : cls <= ROAD.secondary ? 0x4f4a78 : cls <= ROAD.tertiary ? 0x3a4260 : 0x2b3248);
const WATER_RGB = 0x0e5668;

export interface BuildingRef { id: number; name: string | null; kind: number; levels: number; height: number; cx: number; cz: number; area: number }
export interface ParcelRef { id: string; zone: number; rich: number; name: string | null; area: number; cx: number; cz: number; pts: Float32Array; bids: number[]; vStart: number; vCount: number; lineStart: number; lineCount: number }
export interface RegionMeshes { key: string; group: THREE.Group; parcels: ParcelRef[]; parcelMesh: THREE.Mesh | null; parcelLines: THREE.LineSegments | null; buildings: BuildingRef[]; buildingMesh: THREE.Mesh | null; bTri: Uint32Array; pTri: Uint32Array; dispose(): void }

function signedArea(p: ArrayLike<number>) { let a = 0; const n = p.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; } return a / 2; }
const tmp: THREE.Vector2[] = [];
/** Triangulates a simple polygon (with optional holes). Fast paths for triangles, quads and convex shapes. */
export function triangulate(pts: ArrayLike<number>, holes: ArrayLike<number>[] = []): number[] | null {
  let n = pts.length / 2; if (n > 1 && pts[0] === pts[(n - 1) * 2] && pts[1] === pts[(n - 1) * 2 + 1]) n--; if (n < 3) return null;
  if (!holes.length) {
    if (n === 3) return [0, 1, 2]; if (n === 4) return [0, 1, 2, 0, 2, 3];
    let sgn = 0, convex = true; for (let i = 0; i < n && convex; i++) { const a = i, b = (i + 1) % n, c = (i + 2) % n; const cr = (pts[b * 2] - pts[a * 2]) * (pts[c * 2 + 1] - pts[b * 2 + 1]) - (pts[b * 2 + 1] - pts[a * 2 + 1]) * (pts[c * 2] - pts[b * 2]); if (Math.abs(cr) < 1e-6) continue; const s = Math.sign(cr); if (sgn && s !== sgn) convex = false; sgn = s; }
    if (convex) { const o: number[] = []; for (let i = 1; i < n - 1; i++) o.push(0, i, i + 1); return o; }
  }
  tmp.length = 0; for (let i = 0; i < n; i++) tmp.push(new THREE.Vector2(pts[i * 2], pts[i * 2 + 1]));
  const hv = holes.map((h) => { const m = h.length / 2; const a: THREE.Vector2[] = []; for (let i = 0; i < m; i++) a.push(new THREE.Vector2(h[i * 2], h[i * 2 + 1])); return a; });
  try { const t = THREE.ShapeUtils.triangulateShape(tmp.slice(), hv); const flat: number[] = []; for (const f of t) flat.push(f[0], f[1], f[2]); return flat; } catch { return null; }
}

class Buf {
  pos: number[] = []; col: number[] = []; nrm: number[] = [];
  get n() { return this.pos.length / 3; }
  v(x: number, y: number, z: number, c: number, nx = 0, ny = 1, nz = 0, shade = 1) { this.pos.push(x, y, z); const r = ((c >> 16) & 255) / 255 * shade, g = ((c >> 8) & 255) / 255 * shade, b = (c & 255) / 255 * shade; this.col.push(r, g, b); this.nrm.push(nx, ny, nz); }
  geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3)); return g; }
}
function flat(buf: Buf, pts: ArrayLike<number>, y: number, color: number, holes: ArrayLike<number>[] = []) {
  const tri = triangulate(pts, holes); if (!tri) return null; const base = buf.n; const all: number[] = [];
  for (let i = 0; i < pts.length; i++) all.push(pts[i]); for (const h of holes) for (let i = 0; i < h.length; i++) all.push(h[i]);
  for (let i = 0; i < all.length / 2; i++) buf.v(all[i * 2], y, all[i * 2 + 1], color);
  return { tri, base };
}
type FlatRes = ReturnType<typeof flat>;

export function buildRegion(r: Region, mats: { ground: THREE.Material; flat: THREE.Material; bld: THREE.Material; line: THREE.Material }): RegionMeshes {
  const group = new THREE.Group(); const key = `${r.i},${r.j}`;
  // ---- ground and water and landuse (indexed, one buffer)
  const g = new Buf(); const idx: number[] = [];
  const addFlat = (buf: Buf, ix: number[], res: FlatRes) => { if (!res) return; for (const t of res.tri) ix.push(res.base + t); };
  for (const a of r.areas) { const c = AREA_RGB[a.kind]; if (c === undefined || a.pts.length < 6) continue; addFlat(g, idx, flat(g, a.pts, 0.04, c)); }
  for (const w of r.water) { if (w.line) continue; const ring0 = w.rings[0]; if (!ring0 || ring0.length < 6) continue; addFlat(g, idx, flat(g, ring0, 0.08, WATER_RGB, w.rings.slice(1))); }
  if (g.n) { const geo = g.geo(); geo.setIndex(idx); const m = new THREE.Mesh(geo, mats.flat); m.renderOrder = 1; group.add(m); }
  // ---- roads as ribbons (one quad per segment, widened a little so the whole map reads at admin zoom)
  const rb = new Buf(); const ri: number[] = [];
  for (const rd of r.roads) {
    if (rd.cls === ROAD.foot || rd.cls === ROAD.steps || rd.cls === ROAD.track) continue; const hw = Math.max(halfWidth(rd), rd.cls <= ROAD.secondary ? 4 : 2.6) * 1.15; const col = ROAD_RGB(rd.cls); const y = 0.14 + (rd.cls <= ROAD.secondary ? 0.04 : 0) + (rd.flags & 2 ? 0.3 : 0);
    const n = rd.pts.length / 2;
    for (let k = 0; k < n - 1; k++) { const ax = rd.pts[k * 2], az = rd.pts[k * 2 + 1], bx = rd.pts[k * 2 + 2], bz = rd.pts[k * 2 + 3]; const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.2) continue; const nx = (-dz / L) * hw, nz = (dx / L) * hw; const b = rb.n; const ea = rd.elev ? rd.elev[k] : 0, eb = rd.elev ? rd.elev[k + 1] : 0;
      rb.v(ax + nx, y + ea, az + nz, col); rb.v(ax - nx, y + ea, az - nz, col); rb.v(bx - nx, y + eb, bz - nz, col); rb.v(bx + nx, y + eb, bz + nz, col); ri.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  }
  if (rb.n) { const geo = rb.geo(); geo.setIndex(ri); const m = new THREE.Mesh(geo, mats.flat); m.renderOrder = 2; group.add(m); }
  // ---- parcels: fill (recolourable) plus outline
  const pb = new Buf(); const pi: number[] = []; const lines: number[] = []; const lcol: number[] = []; const parcels: ParcelRef[] = []; const pTriList: number[] = [];
  for (const pc of r.parcels) {
    const n = pc.pts.length / 2; if (n < 3) continue; const tri = triangulate(pc.pts); if (!tri) continue; const c = ZONE_RGB[pc.zone] ?? ZONE_RGB[1]; const vStart = pb.n;
    let cx = 0, cz = 0; for (let i = 0; i < n; i++) { cx += pc.pts[i * 2]; cz += pc.pts[i * 2 + 1]; pb.v(pc.pts[i * 2], 0.2, pc.pts[i * 2 + 1], c); } cx /= n; cz /= n;
    const t0 = pi.length / 3; for (const t of tri) pi.push(vStart + t); for (let q = 0; q < tri.length / 3; q++) pTriList.push(parcels.length);
    const lineStart = lines.length / 6; void t0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; lines.push(pc.pts[i * 2], 0.26, pc.pts[i * 2 + 1], pc.pts[j * 2], 0.26, pc.pts[j * 2 + 1]); const lc = new THREE.Color(0x3c4a63); lcol.push(lc.r, lc.g, lc.b, lc.r, lc.g, lc.b); }
    parcels.push({ id: pc.id, zone: pc.zone, rich: pc.rich, name: pc.name, area: Math.abs(signedArea(pc.pts)), cx, cz, pts: pc.pts, bids: pc.bids, vStart, vCount: n, lineStart, lineCount: n });
  }
  let parcelMesh: THREE.Mesh | null = null, parcelLines: THREE.LineSegments | null = null;
  if (pb.n) { const geo = pb.geo(); geo.setIndex(pi); parcelMesh = new THREE.Mesh(geo, mats.ground); parcelMesh.renderOrder = 3; group.add(parcelMesh); const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(lcol, 3)); parcelLines = new THREE.LineSegments(lg, mats.line); parcelLines.renderOrder = 4; group.add(parcelLines); }
  // ---- buildings: extruded, merged
  const bb = new Buf(); const bi: number[] = []; const bTri: number[] = []; const buildings: BuildingRef[] = [];
  for (const b of r.buildings) {
    const n = b.pts.length / 2; if (n < 3) continue; const tri = triangulate(b.pts); if (!tri) continue;
    const h = b.height > 0 ? Math.max(2.6, b.height) : b.kind === BK.warehouse ? 7.5 : b.kind === BK.church || b.kind === BK.mosque ? 9 : b.kind === BK.shed || b.kind === BK.canopy ? 3.2 : b.kind === BK.terminal || b.kind === BK.market ? 6.5 : 0.8 + Math.max(1, b.levels) * 3.1;
    const col = BK_RGB[b.kind] ?? BK_RGB[BK.house]; const bi0 = buildings.length; const sa = signedArea(b.pts); const base = bb.n;
    for (let i = 0; i < n; i++) bb.v(b.pts[i * 2], h, b.pts[i * 2 + 1], col, 0, 1, 0, 1.12);
    for (const t of tri) { bi.push(base + t); } for (let q = 0; q < tri.length / 3; q++) bTri.push(bi0);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; const ax = b.pts[i * 2], az = b.pts[i * 2 + 1], bx = b.pts[j * 2], bz = b.pts[j * 2 + 1]; const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1; const nx = (sa > 0 ? dz : -dz) / L, nz = (sa > 0 ? -dx : dx) / L; const w0 = bb.n;
      bb.v(ax, 0, az, col, nx, 0, nz, 0.72); bb.v(bx, 0, bz, col, nx, 0, nz, 0.72); bb.v(bx, h, bz, col, nx, 0, nz, 0.92); bb.v(ax, h, az, col, nx, 0, nz, 0.92); bi.push(w0, w0 + 1, w0 + 2, w0, w0 + 2, w0 + 3); bTri.push(bi0, bi0); }
    buildings.push({ id: b.id, name: b.name, kind: b.kind, levels: b.levels, height: h, cx: b.cx, cz: b.cz, area: b.area });
  }
  let buildingMesh: THREE.Mesh | null = null;
  if (bb.n) { const geo = bb.geo(); geo.setIndex(bi); buildingMesh = new THREE.Mesh(geo, mats.bld); buildingMesh.renderOrder = 5; group.add(buildingMesh); }
  return { key, group, parcels, parcelMesh, parcelLines, buildings, buildingMesh, bTri: Uint32Array.from(bTri), pTri: Uint32Array.from(pTriList), dispose() { group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }); } };
}
