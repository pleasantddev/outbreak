// The city from the GIS database: laterite ground, every road with worn markings, kerbs and walkways, elevated
// roads on concrete columns, the railway, and thousands of Oshodi buildings with painted plaster, louvre windows,
// shop fronts, balconies, corrugated roofs and rooftop water tanks. Built in chunks so distant blocks cull cheaply.
import * as THREE from 'three';
import type { WorldData, WorldBuilding, WorldRoad, RoadClass } from '../shared/world';
import type { Track } from '../shared/track';
import { hash01, Rng } from '../shared/rng';
import { pointInPolygon, polygonArea, distSegment2 } from '../shared/math';
import { GeoBuilder, offsetPolyline } from './geom';
import { Materials } from './materials';
import { Clearance } from './clearance';
import { ATLAS_CELLS, FACADE_ROWS } from './textures';

export interface WorldOptions { detail: 0 | 1 | 2; drawDistance: number; shadows: boolean }

const CHUNK = 250;
const ROAD_LIFT: Record<RoadClass, number> = { motorway: 0.05, trunk: 0.045, primary: 0.04, link: 0.042, secondary: 0.035, tertiary: 0.03, residential: 0.02, service: 0.012, path: 0.01 };
const PAINTS = [0xeadfc4, 0xe0c27a, 0xebb994, 0xa9c6d6, 0xbcd6b2, 0xe2b0aa, 0xf2eee6, 0xc6c0b6, 0xe8da9a, 0xcc8a6a, 0xd8d0f0, 0x9fc0a8, 0xf0d0a8, 0xb8b0a0];
const ROOF_TINTS = [0xa0502c, 0x8a4228, 0xb7b9b8, 0x9aa0a4, 0x3e6aa0, 0x5a7a4a, 0x7a3a2a, 0xc0c4c4];

interface ChunkBuilders { facade: GeoBuilder; tin: GeoBuilder; flat: GeoBuilder; props: GeoBuilder; concrete: GeoBuilder }

export class WorldView {
  group = new THREE.Group();
  chunks: { obj: THREE.Group; cx: number; cz: number }[] = [];
  clearance: Clearance;
  roadIndex: RoadIndex;
  buildingsKept: WorldBuilding[] = [];
  stats = { buildings: 0, removed: 0, pushed: 0 };

  constructor(public world: WorldData, public track: Track | null, public mats: Materials, public opts: WorldOptions) {
    this.clearance = new Clearance(track);
    this.roadIndex = new RoadIndex(world.roads);
    this.group.name = 'world';
    this.buildGround();
    this.buildRoads();
    this.buildBuildings();
    this.buildRails();
  }

  private chunkMap = new Map<string, ChunkBuilders>();
  private builders(x: number, z: number): ChunkBuilders {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), k = `${cx},${cz}`;
    let b = this.chunkMap.get(k);
    if (!b) {
      b = { facade: new GeoBuilder({ cell: 2, seed: 1 }), tin: new GeoBuilder(), flat: new GeoBuilder(), props: new GeoBuilder(), concrete: new GeoBuilder() };
      this.chunkMap.set(k, b);
    }
    return b;
  }

  // ------------------------------------------------------------------------------------------- ground

  private buildGround() {
    const b = this.world.meta.bounds;
    const w = b.maxX - b.minX + 1200, d = b.maxZ - b.minZ + 1200;
    const geo = new THREE.PlaneGeometry(w, d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 14, uv.getY(i) * d / 14);
    const ground = new THREE.Mesh(geo, this.mats.ground);
    ground.position.set((b.minX + b.maxX) / 2, -0.02, (b.minZ + b.maxZ) / 2);
    ground.receiveShadow = this.opts.shadows;
    ground.name = 'ground';
    this.group.add(ground);
    // land use patches: grass, yards, markets
    const grass = new GeoBuilder(), pave = new GeoBuilder();
    for (const a of this.world.areas) {
      if (!['grass', 'parking', 'market', 'commercial'].includes(a.kind)) continue;
      const pts = a.pts;
      if (pts.length < 3 || Math.abs(polygonArea(pts)) > 400000) continue;
      const tgt = a.kind === 'grass' ? grass : pave;
      const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const y = a.kind === 'grass' ? 0.005 : 0.008;
      for (const t of tris) {
        const P = t.map((i) => [pts[i][0], y, pts[i][1]]);
        tgt.tri(P[0], P[2], P[1], P.map((p) => [p[0] / 10, p[2] / 10]), [0, 1, 0]);
      }
    }
    const gm = new THREE.Mesh(grass.build(), this.mats.grass); gm.receiveShadow = this.opts.shadows;
    const pm = new THREE.Mesh(pave.build(), this.mats.paving); pm.receiveShadow = this.opts.shadows;
    gm.material = this.mats.grass; pm.material = this.mats.paving;
    this.group.add(gm, pm);
  }

  // ------------------------------------------------------------------------------------------- roads

  private buildRoads() {
    const surface = new GeoBuilder({ lane: 4 });
    const kerbs = new GeoBuilder(), walks = new GeoBuilder(), structure = new GeoBuilder(), rails = new GeoBuilder();
    for (const r of this.world.roads) {
      if (r.cls === 'path' || r.pts.length < 2) continue;
      const hw = r.w / 2;
      const pts = r.pts;
      const xz = pts.map((p) => [p[0], p[1]]);
      const L = offsetPolyline(xz, -hw), R = offsetPolyline(xz, hw);
      const lift = ROAD_LIFT[r.cls];
      // distance along the road, for marking fade near both ends (junctions)
      const acc = [0]; for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = acc[acc.length - 1];
      const lanes = r.oneway ? Math.max(1, r.lanes) : Math.max(2, r.lanes);
      for (let i = 0; i < pts.length - 1; i++) {
        const y0 = pts[i][2] + lift, y1 = pts[i + 1][2] + lift;
        const f0 = Math.min(1, Math.min(acc[i], total - acc[i]) / 14), f1 = Math.min(1, Math.min(acc[i + 1], total - acc[i + 1]) / 14);
        const a = [L[i][0], y0, L[i][1]], b = [R[i][0], y0, R[i][1]], c = [R[i + 1][0], y1, R[i + 1][1]], d = [L[i + 1][0], y1, L[i + 1][1]];
        const base = surface.count;
        surface.set('lane', -hw, hw, lanes, f0).vertex(a[0], a[1], a[2], 0, 1, 0, 0, acc[i]);
        surface.set('lane', hw, hw, lanes, f0).vertex(b[0], b[1], b[2], 0, 1, 0, 1, acc[i]);
        surface.set('lane', hw, hw, lanes, f1).vertex(c[0], c[1], c[2], 0, 1, 0, 1, acc[i + 1]);
        surface.set('lane', -hw, hw, lanes, f1).vertex(d[0], d[1], d[2], 0, 1, 0, 0, acc[i + 1]);
        surface.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const elevated = pts.some((p) => p[2] > 0.4);
      if (elevated) this.buildElevated(r, L, R, structure, rails);
      if (!elevated && ['trunk', 'primary', 'secondary', 'tertiary'].includes(r.cls)) this.buildKerbs(r, L, R, kerbs, walks);
    }
    const sm = new THREE.Mesh(surface.build(), this.mats.road);
    sm.receiveShadow = this.opts.shadows; sm.name = 'roads';
    const km = new THREE.Mesh(kerbs.build(), this.mats.kerb); km.receiveShadow = this.opts.shadows;
    const wm = new THREE.Mesh(walks.build(), this.mats.paving); wm.receiveShadow = this.opts.shadows;
    const st = new THREE.Mesh(structure.build(), this.mats.concrete); st.castShadow = this.opts.shadows; st.receiveShadow = this.opts.shadows;
    const rm = new THREE.Mesh(rails.build(), this.mats.meshRail);
    this.group.add(sm, km, wm, st, rm);
  }

  /** Kerb stones and a paved walkway on both sides, cut back where another road crosses or the race corridor runs. */
  private buildKerbs(r: WorldRoad, L: number[][], R: number[][], kerbs: GeoBuilder, walks: GeoBuilder) {
    const striped = r.cls === 'trunk' || r.cls === 'primary';
    for (const [side, edge] of [[-1, L], [1, R]] as [number, number[][]][]) {
      const outer = offsetPolyline(r.pts.map((p) => [p[0], p[1]]), side * (r.w / 2 + 2.6));
      for (let i = 0; i < edge.length - 1; i++) {
        const mx = (edge[i][0] + edge[i + 1][0]) / 2, mz = (edge[i][1] + edge[i + 1][1]) / 2;
        const segLen = Math.hypot(edge[i + 1][0] - edge[i][0], edge[i + 1][1] - edge[i][1]);
        // walk in 6 m steps so junction cut-outs are tight
        const steps = Math.max(1, Math.ceil(segLen / 6));
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps, t1 = (k + 1) / steps;
          const ex0 = edge[i][0] + (edge[i + 1][0] - edge[i][0]) * t0, ez0 = edge[i][1] + (edge[i + 1][1] - edge[i][1]) * t0;
          const ex1 = edge[i][0] + (edge[i + 1][0] - edge[i][0]) * t1, ez1 = edge[i][1] + (edge[i + 1][1] - edge[i][1]) * t1;
          const ox0 = outer[i][0] + (outer[i + 1][0] - outer[i][0]) * t0, oz0 = outer[i][1] + (outer[i + 1][1] - outer[i][1]) * t0;
          const ox1 = outer[i][0] + (outer[i + 1][0] - outer[i][0]) * t1, oz1 = outer[i][1] + (outer[i + 1][1] - outer[i][1]) * t1;
          const cx = (ex0 + ex1) / 2, cz = (ez0 + ez1) / 2;
          if (this.roadIndex.insideOther(cx, cz, r.id, 1.2)) continue;
          if (this.clearance.gap(cx, cz, 30) < 1.5) continue;
          void mx; void mz;
          const h = 0.18;
          // kerb: top face and the face toward the road
          const kx0 = ex0 + (ox0 - ex0) * 0.1, kz0 = ez0 + (oz0 - ez0) * 0.1, kx1 = ex1 + (ox1 - ex1) * 0.1, kz1 = ez1 + (oz1 - ez1) * 0.1;
          const u0 = (i + t0) * segLen / 2, u1 = (i + t1) * segLen / 2;
          const sideUv = striped ? [[u0, 0], [u1, 0], [u1, 1], [u0, 1]] : [[0, 0], [0, 0], [0, 0.02], [0, 0.02]];
          if (side < 0) {
            kerbs.quad([ex1, 0.02, ez1], [ex0, 0.02, ez0], [ex0, h, ez0], [ex1, h, ez1], sideUv);
            kerbs.quad([ex1, h, ez1], [ex0, h, ez0], [kx0, h, kz0], [kx1, h, kz1], sideUv);
            walks.quad([kx1, h - 0.02, kz1], [kx0, h - 0.02, kz0], [ox0, h - 0.02, oz0], [ox1, h - 0.02, oz1], [[kx1 / 3, kz1 / 3], [kx0 / 3, kz0 / 3], [ox0 / 3, oz0 / 3], [ox1 / 3, oz1 / 3]], [0, 1, 0]);
          } else {
            kerbs.quad([ex0, 0.02, ez0], [ex1, 0.02, ez1], [ex1, h, ez1], [ex0, h, ez0], sideUv);
            kerbs.quad([ex0, h, ez0], [ex1, h, ez1], [kx1, h, kz1], [kx0, h, kz0], sideUv);
            walks.quad([kx0, h - 0.02, kz0], [kx1, h - 0.02, kz1], [ox1, h - 0.02, oz1], [ox0, h - 0.02, oz0], [[kx0 / 3, kz0 / 3], [kx1 / 3, kz1 / 3], [ox1 / 3, oz1 / 3], [ox0 / 3, oz0 / 3]], [0, 1, 0]);
          }
        }
      }
    }
  }

  /** Bridges stand on round columns with a deck slab; raised approaches get retaining walls. Both get parapets. */
  private buildElevated(r: WorldRoad, L: number[][], R: number[][], st: GeoBuilder, rails: GeoBuilder) {
    const pts = r.pts;
    let sinceCol = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const y0 = pts[i][2], y1 = pts[i + 1][2];
      if (y0 < 0.4 && y1 < 0.4) continue;
      const segLen = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      for (const [side, edge] of [[-1, L], [1, R]] as [number, number[][]][]) {
        const a = edge[i], b = edge[i + 1];
        // skip parapets the race corridor replaces with its own barriers
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        const near = this.clearance.nearest(mx, mz, 25);
        const raced = near && Math.abs(near.y - (y0 + y1) / 2) < 2.5 && near.d < near.hw + 3;
        const out = side;
        if (r.bridge) {
          // deck edge fascia
          const P = (p: number[], y: number) => [p[0], y, p[1]];
          if (out < 0) st.quad(P(b, y1 - 1.3), P(a, y0 - 1.3), P(a, y0 + 0.05), P(b, y1 + 0.05), [[0, 0], [segLen / 4, 0], [segLen / 4, 0.4], [0, 0.4]]);
          else st.quad(P(a, y0 - 1.3), P(b, y1 - 1.3), P(b, y1 + 0.05), P(a, y0 + 0.05), [[0, 0], [segLen / 4, 0], [segLen / 4, 0.4], [0, 0.4]]);
        } else {
          // retaining wall down to the ground
          const P = (p: number[], y: number) => [p[0], y, p[1]];
          if (out < 0) st.quad(P(b, 0), P(a, 0), P(a, y0 + 0.05), P(b, y1 + 0.05), [[0, 0], [segLen / 4, 0], [segLen / 4, y0 / 4], [0, y1 / 4]]);
          else st.quad(P(a, 0), P(b, 0), P(b, y1 + 0.05), P(a, y0 + 0.05), [[0, 0], [segLen / 4, 0], [segLen / 4, y0 / 4], [0, y1 / 4]]);
        }
        if (!raced) {
          // New Jersey parapet with a blue mesh railing on top, the Lagos flyover look
          const tx = (b[0] - a[0]) / (segLen || 1), tz = (b[1] - a[1]) / (segLen || 1);
          const ox = -tz * out * 0.3, oz = tx * out * 0.3; // outward by 30 cm
          const A0 = [a[0], y0, a[1]], B0 = [b[0], y1, b[1]];
          const A1 = [a[0] + ox, y0, a[1] + oz], B1 = [b[0] + ox, y1, b[1] + oz];
          const up = (p: number[], hh: number) => [p[0], p[1] + hh, p[2]];
          const U = [[0, 0], [segLen / 4, 0], [segLen / 4, 0.25], [0, 0.25]];
          st.quad(A0, B0, up(B0, 0.95), up(A0, 0.95), U);
          st.quad(A1, B1, up(B1, 0.95), up(A1, 0.95), U);
          st.quad(up(A0, 0.95), up(B0, 0.95), up(B1, 0.95), up(A1, 0.95), U, [0, 1, 0]);
          rails.quad(up(A1, 0.95), up(B1, 0.95), up(B1, 2.0), up(A1, 2.0), [[0, 0], [segLen / 2.5, 0], [segLen / 2.5, 1], [0, 1]]);
        }
      }
      // deck soffit, seen when you race underneath
      if (r.bridge) {
        const Ls = L[i], Le = L[i + 1], Rs = R[i], Re = R[i + 1];
        st.quad([Ls[0], y0 - 1.3, Ls[1]], [Rs[0], y0 - 1.3, Rs[1]], [Re[0], y1 - 1.3, Re[1]], [Le[0], y1 - 1.3, Le[1]], [[0, 0], [r.w / 4, 0], [r.w / 4, segLen / 4], [0, segLen / 4]], [0, -1, 0]);
      }
      // columns under bridge decks
      if (r.bridge) {
        sinceCol += segLen;
        const n = Math.floor(sinceCol / 24);
        for (let k = 0; k < n; k++) {
          const t = 1 - (sinceCol - 24 * (k + 1)) / segLen;
          const cx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, cz = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, cy = y0 + (y1 - y0) * t;
          if (cy < 2.5) continue;
          st.cylinder(cx, 0, cz, 0.75, cy - 1.3, 12, false);
          st.box(cx, cy - 2.1, cz, r.w * 0.7, 0.8, 1.6, Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) + Math.PI / 2);
        }
        sinceCol -= n * 24;
      }
    }
  }

  // ------------------------------------------------------------------------------------------- buildings

  private buildBuildings() {
    const detail = this.opts.detail;
    for (const b0 of this.world.buildings) {
      const b = this.clearFromTrack(b0);
      if (!b) continue;
      this.buildingsKept.push(b);
      this.building(b, detail);
      this.stats.buildings++;
    }
    for (const [k, cb] of this.chunkMap) {
      const [cx, cz] = k.split(',').map(Number);
      const grp = new THREE.Group();
      grp.name = `chunk ${k}`;
      const add = (g: GeoBuilder, m: THREE.Material, shadow = true) => {
        if (!g.count) return;
        const mesh = new THREE.Mesh(g.build(), m);
        mesh.castShadow = shadow && this.opts.shadows; mesh.receiveShadow = this.opts.shadows;
        grp.add(mesh);
      };
      add(cb.facade, this.mats.facade); add(cb.tin, this.mats.roofTin); add(cb.flat, this.mats.roofFlat); add(cb.props, this.mats.vertexLit); add(cb.concrete, this.mats.concrete);
      this.group.add(grp);
      this.chunks.push({ obj: grp, cx: (cx + 0.5) * CHUNK, cz: (cz + 0.5) * CHUNK });
    }
    this.chunkMap.clear();
  }

  /** Keep buildings out of the race corridor: nudge the ones that clip it, drop the ones that sit in it. */
  private clearFromTrack(b: WorldBuilding): WorldBuilding | null {
    if (!this.clearance.track) return b;
    const pts = b.pts;
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const nc = this.clearance.nearest(cx, cz, 90);
    if (!nc) return b;
    if (nc.d < nc.hw + 3.5) { this.stats.removed++; return null; }
    let worst = Infinity, wn = nc;
    const probe = (x: number, z: number) => { const n = this.clearance.nearest(x, z, 40); if (n && n.d - n.hw < worst) { worst = n.d - n.hw; wn = n; } };
    for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; probe(a[0], a[1]); probe((a[0] + c[0]) / 2, (a[1] + c[1]) / 2); }
    const need = 2.2;
    if (worst >= need) return b;
    const push = need - worst + 0.3;
    if (push > 9) { this.stats.removed++; return null; }
    const dx = wn.rx * wn.side, dz = wn.rz * wn.side;
    this.stats.pushed++;
    return { ...b, pts: pts.map((p) => [p[0] + dx * push, p[1] + dz * push]) };
  }

  private building(b: WorldBuilding, detail: number) {
    const pts = b.pts;
    const n = pts.length;
    const rnd = new Rng((b.id % 2147483647) || 1);
    const cx = pts.reduce((a, p) => a + p[0], 0) / n, cz = pts.reduce((a, p) => a + p[1], 0) / n;
    const B = this.builders(cx, cz);
    const area = Math.abs(polygonArea(pts));
    const levels = Math.max(1, b.levels);
    const h = Math.max(3.2, b.h);
    const groundH = Math.min(h, b.cat === 'shed' ? h : 3.6);
    const upperH = levels > 1 ? (h - groundH) / (levels - 1) : 0;
    const paint = new THREE.Color(PAINTS[Math.floor(hash01(b.id, 1) * PAINTS.length)]);
    if (b.cat === 'industrial' || b.cat === 'shed') paint.set(rnd.pick([0xc8c4bc, 0xb8b4ac, 0xa8b0b4, 0xd8d0c0]));
    const seed = hash01(b.id, 3) * 97;
    const upperRow = b.cat === 'office' || b.cat === 'commercial' ? (rnd.chance(0.5) ? FACADE_ROWS.office : FACADE_ROWS.balcony)
      : b.cat === 'industrial' || b.cat === 'shed' ? FACADE_ROWS.industrial
      : rnd.chance(0.45) ? FACADE_ROWS.louvre : rnd.chance(0.5) ? FACADE_ROWS.shutter : FACADE_ROWS.balcony;
    const upperCol = Math.floor(rnd.next() * ATLAS_CELLS);
    const flat = levels >= 3 || b.cat === 'office' || b.cat === 'commercial' || b.cat === 'religious' || (area > 450 && b.cat !== 'shed' && b.cat !== 'industrial') || rnd.chance(0.12);

    // outward normal per edge, robust to winding
    const fac = B.facade;
    fac.set('seed', seed);
    for (let i = 0; i < n; i++) {
      const a = pts[i], c = pts[(i + 1) % n];
      const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.4) continue;
      let nx = -dz / len, nz = dx / len;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      if (pointInPolygon(mx + nx * 0.2, mz + nz * 0.2, pts)) { nx = -nx; nz = -nz; }
      // order so the quad faces outward: normal of (p0, p1, p1 top) is (-dz, dx)
      const [p0, p1] = nx === -dz / len ? [a, c] : [c, a];
      const units = Math.max(1, Math.round(len / 4));
      const facesRoad = this.roadIndex.near(mx + nx * 5, mz + nz * 5, 4);
      let groundRow: number = FACADE_ROWS.ground, groundCol = Math.floor(rnd.next() * ATLAS_CELLS);
      if (b.cat === 'shed' || b.cat === 'industrial') { groundRow = FACADE_ROWS.industrial; }
      else if (facesRoad && (b.cat === 'commercial' || b.cat === 'retail' || b.cat === 'office' || rnd.chance(0.4))) groundRow = FACADE_ROWS.shop;
      else if (rnd.chance(0.35)) { groundRow = FACADE_ROWS.blank; }
      fac.setColor(paint);
      const wall = (y0: number, y1: number, row: number, col: number, vSpan: number) => {
        fac.set('cell', col, row);
        fac.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [[0, 0], [units, 0], [units, vSpan], [0, vSpan]], [nx, 0, nz]);
      };
      wall(0, groundH, groundRow, groundCol, 1);
      if (levels > 1 && upperH > 0.5) {
        // narrow side walls with no road get blank plaster so windows only face streets and yards
        const blankSide = len < 6 && !facesRoad && rnd.chance(0.5);
        wall(groundH, h, blankSide ? FACADE_ROWS.blank : upperRow, blankSide ? 7 : (upperCol + (i % 2)) % ATLAS_CELLS, levels - 1);
      }
      if (flat && detail >= 1) {
        // parapet: outer face in the wall style, inner face and cap in plain concrete
        fac.set('cell', 7, FACADE_ROWS.blank);
        fac.quad([p0[0], h, p0[1]], [p1[0], h, p1[1]], [p1[0], h + 0.9, p1[1]], [p0[0], h + 0.9, p0[1]], [[0, 0], [units, 0], [units, 0.28], [0, 0.28]], [nx, 0, nz]);
        const ix = -nx * 0.2, iz = -nz * 0.2;
        B.concrete.quad([p1[0] + ix, h, p1[1] + iz], [p0[0] + ix, h, p0[1] + iz], [p0[0] + ix, h + 0.9, p0[1] + iz], [p1[0] + ix, h + 0.9, p1[1] + iz], [[0, 0], [len / 4, 0], [len / 4, 0.25], [0, 0.25]], [-nx, 0, -nz]);
        B.concrete.quad([p0[0], h + 0.9, p0[1]], [p1[0], h + 0.9, p1[1]], [p1[0] + ix, h + 0.9, p1[1] + iz], [p0[0] + ix, h + 0.9, p0[1] + iz], [[0, 0], [len / 4, 0], [len / 4, 0.05], [0, 0.05]], [0, 1, 0]);
      }
      // awnings over shop fronts and the odd AC unit on upper walls
      if (detail >= 2 && groundRow === FACADE_ROWS.shop) {
        const tint = new THREE.Color(ROOF_TINTS[Math.floor(rnd.next() * ROOF_TINTS.length)]);
        B.tin.setColor(tint);
        const out = 1.6, y = groundH - 0.25;
        B.tin.quad([p0[0] + nx * out, y - 0.45, p0[1] + nz * out], [p1[0] + nx * out, y - 0.45, p1[1] + nz * out], [p1[0], y, p1[1]], [p0[0], y, p0[1]], [[0, 0], [len / 3, 0], [len / 3, 0.5], [0, 0.5]]);
        B.props.setColor([0.25, 0.25, 0.26]);
        for (let k = 0; k <= Math.floor(len / 4); k++) { const t = k / Math.max(1, Math.floor(len / 4)); const px = p0[0] + (p1[0] - p0[0]) * t + nx * out, pz = p0[1] + (p1[1] - p0[1]) * t + nz * out; B.props.box(px, 0, pz, 0.08, y - 0.45, 0.08); }
      }
      if (detail >= 2 && levels > 1 && rnd.chance(0.3) && len > 3) {
        const t = rnd.range(0.2, 0.8), y = groundH + rnd.range(0.6, Math.max(0.7, (levels - 1) * upperH - 1));
        B.props.setColor([0.82, 0.82, 0.8]);
        B.props.box(p0[0] + (p1[0] - p0[0]) * t + nx * 0.3, y, p0[1] + (p1[1] - p0[1]) * t + nz * 0.3, 0.8, 0.55, 0.32, Math.atan2(nx, nz));
      }
    }

    // roof
    const tint = new THREE.Color(ROOF_TINTS[Math.floor(hash01(b.id, 7) * ROOF_TINTS.length)]);
    if (flat || detail === 0) {
      const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      B.flat.setColor(new THREE.Color(0xb0aca4).multiplyScalar(0.8 + hash01(b.id, 5) * 0.3));
      for (const t of tris) {
        const P = t.map((i) => [pts[i][0], h, pts[i][1]]);
        // face up regardless of polygon winding
        const cr = (P[1][0] - P[0][0]) * (P[2][2] - P[0][2]) - (P[1][2] - P[0][2]) * (P[2][0] - P[0][0]);
        const ordered = cr < 0 ? P : [P[0], P[2], P[1]];
        B.flat.tri(ordered[0], ordered[1], ordered[2], ordered.map((p) => [p[0] / 6, p[2] / 6]), [0, 1, 0]);
      }
      if (detail >= 2) this.roofProps(B, pts, h, rnd, area);
    } else {
      this.hipRoof(B.tin, pts, h, tint, b.cat === 'shed' || b.cat === 'industrial' ? 0.12 : 0.32);
    }
  }

  /** Hip roof over the minimum-area rectangle of the footprint, with eaves. */
  private hipRoof(g: GeoBuilder, pts: number[][], h: number, tint: THREE.Color, pitch: number) {
    const obb = minRect(pts);
    const ov = 0.5;
    const L = obb.l / 2 + ov, W = obb.w / 2 + ov;
    const ux = Math.cos(obb.a), uz = Math.sin(obb.a), vx = -uz, vz = ux;
    const P = (a: number, b: number, y: number) => [obb.cx + ux * a + vx * b, y, obb.cz + uz * a + vz * b];
    const rh = Math.min(W, L) * pitch * 2;
    const ridge = Math.max(0, L - W);
    const c00 = P(-L, -W, h), c10 = P(L, -W, h), c11 = P(L, W, h), c01 = P(-L, W, h);
    const r0 = P(-ridge, 0, h + rh), r1 = P(ridge, 0, h + rh);
    g.setColor(tint);
    const s = 1 / 3;
    const up = (a: number[], b: number[], c: number[]) => { const cr = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]); return cr < 0; };
    const face4 = (a: number[], b: number[], c: number[], d: number[]) => {
      const uvs = [[0, 0], [Math.hypot(b[0] - a[0], b[2] - a[2]) * s, 0], [Math.hypot(b[0] - a[0], b[2] - a[2]) * s, W * s], [0, W * s]];
      if (up(a, b, c)) g.quad(a, b, c, d, uvs); else g.quad(d, c, b, a, uvs);
    };
    const face3 = (a: number[], b: number[], c: number[]) => { if (up(a, b, c)) g.tri(a, b, c, [[0, 0], [W * 2 * s, 0], [W * s, W * s]]); else g.tri(c, b, a, [[0, 0], [W * 2 * s, 0], [W * s, W * s]]); };
    face4(c00, c10, r1, r0);
    face4(c11, c01, r0, r1);
    face3(c10, c11, r1);
    face3(c01, c00, r0);
    // fascia board around the eaves
    g.setColor(new THREE.Color(tint).multiplyScalar(0.55));
    const fas = (a: number[], b: number[]) => { const a2 = [a[0], a[1] - 0.25, a[2]], b2 = [b[0], b[1] - 0.25, b[2]]; g.quad(a2, b2, b, a); g.quad(b2, a2, a, b); };
    fas(c00, c10); fas(c10, c11); fas(c11, c01); fas(c01, c00);
  }

  /** Black water tanks on steel stands, satellite dishes and solar panels: the Lagos skyline in miniature. */
  private roofProps(B: ChunkBuilders, pts: number[][], h: number, rnd: Rng, area: number) {
    const count = Math.min(4, Math.floor(area / 160) + (rnd.chance(0.6) ? 1 : 0));
    const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
    const minZ = Math.min(...pts.map((p) => p[1])), maxZ = Math.max(...pts.map((p) => p[1]));
    for (let k = 0; k < count; k++) {
      let x = 0, z = 0, ok = false;
      for (let tries = 0; tries < 8 && !ok; tries++) { x = rnd.range(minX, maxX); z = rnd.range(minZ, maxZ); ok = pointInPolygon(x, z, pts) && pointInPolygon(x + 1.2, z, pts) && pointInPolygon(x - 1.2, z, pts) && pointInPolygon(x, z + 1.2, pts) && pointInPolygon(x, z - 1.2, pts); }
      if (!ok) continue;
      const kind = rnd.next();
      if (kind < 0.55) {
        B.props.setColor([0.32, 0.33, 0.35]);
        for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]]) B.props.box(x + ox, h, z + oz, 0.08, 1.4, 0.08);
        B.props.box(x, h + 1.4, z, 1.5, 0.08, 1.5);
        B.props.setColor(rnd.chance(0.75) ? [0.08, 0.08, 0.09] : [0.15, 0.3, 0.6]);
        B.props.cylinder(x, h + 1.48, z, 0.62, 1.25, 12, true, 0.6);
      } else if (kind < 0.8) {
        B.props.setColor([0.85, 0.85, 0.84]);
        B.props.box(x, h, z, 0.1, 0.9, 0.1);
        B.props.cylinder(x, h + 0.9, z, 0.45, 0.12, 10, true, 0.05);
      } else {
        B.props.setColor([0.12, 0.16, 0.3]);
        B.props.box(x, h + 0.3, z, 1.8, 0.06, 1.1, rnd.range(0, Math.PI));
      }
    }
  }

  // ------------------------------------------------------------------------------------------- railway

  private buildRails() {
    const bal = new GeoBuilder(), rails = new GeoBuilder();
    for (const r of this.world.rails) {
      const pts = r.pts;
      for (const off of [-2.1, 2.1]) {
        const c = offsetPolyline(pts, off);
        const L = offsetPolyline(c, -1.6), R = offsetPolyline(c, 1.6);
        for (let i = 0; i < c.length - 1; i++) {
          const len = Math.hypot(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1]);
          bal.quad([L[i][0], 0.06, L[i][1]], [R[i][0], 0.06, R[i][1]], [R[i + 1][0], 0.06, R[i + 1][1]], [L[i + 1][0], 0.06, L[i + 1][1]], [[0, 0], [1, 0], [1, len / 3], [0, len / 3]], [0, 1, 0]);
          for (const g of [-0.72, 0.72]) {
            const a = offsetPolyline([c[i], c[i + 1]], g);
            rails.box((a[0][0] + a[1][0]) / 2, 0.14, (a[0][1] + a[1][1]) / 2, 0.08, 0.14, len, Math.atan2(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1]));
          }
          // concrete sleepers
          const steps = Math.floor(len / 0.65);
          for (let k = 0; k < steps; k += 1) {
            const t = k / steps; const sx = c[i][0] + (c[i + 1][0] - c[i][0]) * t, sz = c[i][1] + (c[i + 1][1] - c[i][1]) * t;
            if (this.opts.detail >= 1) bal.box(sx, 0.06, sz, 2.4, 0.09, 0.24, Math.atan2(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1]));
          }
        }
      }
    }
    const bm = new THREE.Mesh(bal.build(), this.mats.ballast); bm.receiveShadow = this.opts.shadows;
    const rm = new THREE.Mesh(rails.build(), this.mats.rail);
    this.group.add(bm, rm);
  }

  /** Hide chunks past the draw distance. */
  update(x: number, z: number) {
    const dd = this.opts.drawDistance + CHUNK * 0.75;
    for (const c of this.chunks) c.obj.visible = Math.hypot(c.cx - x, c.cz - z) < dd;
  }
}

// ------------------------------------------------------------------------------------------- helpers

/** Minimum-area bounding rectangle by testing each edge direction. */
export function minRect(pts: number[][]) {
  let best = { area: Infinity, a: 0, cx: 0, cz: 0, l: 1, w: 1 };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const ux = Math.cos(a), uz = Math.sin(a);
    let mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity;
    for (const r of pts) { const u = r[0] * ux + r[1] * uz, v = -r[0] * uz + r[1] * ux; mnu = Math.min(mnu, u); mxu = Math.max(mxu, u); mnv = Math.min(mnv, v); mxv = Math.max(mxv, v); }
    const area = (mxu - mnu) * (mxv - mnv);
    if (area < best.area) {
      const cu = (mnu + mxu) / 2, cv = (mnv + mxv) / 2;
      let l = mxu - mnu, w = mxv - mnv, ang = a;
      if (w > l) { [l, w] = [w, l]; ang = a + Math.PI / 2; }
      best = { area, a: ang, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, l, w };
    }
  }
  return best;
}

/** Spatial index of road centrelines for "is there a road here" questions. */
export class RoadIndex {
  private cell = 30;
  private grid = new Map<number, { r: WorldRoad; i: number }[]>();
  constructor(roads: WorldRoad[]) {
    for (const r of roads) {
      if (r.cls === 'path') continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const x0 = Math.min(a[0], b[0]) - r.w, x1 = Math.max(a[0], b[0]) + r.w, z0 = Math.min(a[1], b[1]) - r.w, z1 = Math.max(a[1], b[1]) + r.w;
        for (let gx = Math.floor(x0 / this.cell); gx <= Math.floor(x1 / this.cell); gx++) for (let gz = Math.floor(z0 / this.cell); gz <= Math.floor(z1 / this.cell); gz++) {
          const k = (gx + 1000) * 2000 + gz + 1000;
          let arr = this.grid.get(k); if (!arr) { arr = []; this.grid.set(k, arr); } arr.push({ r, i });
        }
      }
    }
  }
  private around(x: number, z: number) { return this.grid.get((Math.floor(x / this.cell) + 1000) * 2000 + Math.floor(z / this.cell) + 1000) ?? []; }
  /** True when the point is on another road's surface (plus margin). */
  insideOther(x: number, z: number, self: number, margin: number) {
    for (const { r, i } of this.around(x, z)) {
      if (r.id === self || r.cls === 'service') continue;
      const a = r.pts[i], b = r.pts[i + 1];
      if (Math.abs(a[2] - 0) > 1.5 && Math.abs(b[2]) > 1.5) continue; // elevated roads pass over
      if (distSegment2(x, z, a[0], a[1], b[0], b[1]).d2 < (r.w / 2 + margin) ** 2) return true;
    }
    return false;
  }
  near(x: number, z: number, margin: number) {
    for (const { r, i } of this.around(x, z)) {
      const a = r.pts[i], b = r.pts[i + 1];
      if (distSegment2(x, z, a[0], a[1], b[0], b[1]).d2 < (r.w / 2 + margin) ** 2) return r;
    }
    return null;
  }
}
