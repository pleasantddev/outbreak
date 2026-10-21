// Streams the corridor around the camera in 250 m tiles: road field, ground, buildings, compounds, props, bridges.
import * as THREE from 'three';
import { RegionStore, type Region, type Road, type Building, type Pothole, type Area, RF } from './region';
import { buildTileField, areaSurfaces, SURF, type TileField } from './roadField';
import { makeGroundMaterial } from './ground';
import { buildBuildings, makeBuildingMaterial } from './buildings';
import { plotsForRegion, type Plot } from './plots';
import { buildCompounds } from './compounds';
import { buildProps } from './props';
import { buildBridges, deckCollision, deckProfile } from './bridges';
import type { TileCol } from '../sim/life';
import { buildingHeight } from './buildings';
import { hash, pointInPoly } from './geo';
import type { TexSet } from './texsets';

export const TILE = 250;
export interface Tile { key: string; x0: number; z0: number; res: number; field: TileField; group: THREE.Group; ground: THREE.Mesh; lamps: number[]; dist: number; col: TileCol; roads: Road[] }

export class WorldStreamer {
  tiles = new Map<string, Tile>();
  plots = new Map<string, Plot[]>();
  group = new THREE.Group();
  radius: number; nearRes: number; farRes: number;
  private buildMat: THREE.Material; private building = false;
  private asphalt: THREE.Texture; private asphaltN: THREE.Texture;
  lamps: number[] = [];
  constructor(public renderer: THREE.WebGLRenderer, public store: RegionStore, public tg: TexSet, tw: TexSet, quality: 'low' | 'medium' | 'high') {
    this.radius = quality === 'high' ? 900 : quality === 'medium' ? 700 : 480;
    this.nearRes = quality === 'low' ? 256 : 512; this.farRes = quality === 'low' ? 64 : 128;
    this.buildMat = makeBuildingMaterial(tw);
    (this.buildMat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    const tl = new THREE.TextureLoader();
    this.asphalt = tl.load(`tex/g0_diff_${tg.size}.webp`); this.asphalt.wrapS = this.asphalt.wrapT = THREE.RepeatWrapping; this.asphalt.colorSpace = THREE.SRGBColorSpace;
    this.asphaltN = tl.load(`tex/g0_nor_${tg.size}.webp`); this.asphaltN.wrapS = this.asphaltN.wrapT = THREE.RepeatWrapping;
  }
  regionPlots(r: Region) { const k = `${r.i},${r.j}`; let p = this.plots.get(k); if (!p) { p = plotsForRegion(r); this.plots.set(k, p); } return p; }

  private gather(x0: number, z0: number, size: number, margin: number) {
    const roads: Road[] = [], blds: Building[] = [], ph: Pothole[] = [], areas: Area[] = [], plots: Plot[] = [];
    const seen = new Set<string>();
    const [a, b] = this.store.regionOf(x0 - margin, z0 - margin), [c, d] = this.store.regionOf(x0 + size + margin, z0 + size + margin);
    for (let i = a; i <= c; i++) for (let j = b; j <= d; j++) {
      const r = this.store.get(i, j); if (!r) continue;
      for (const rd of r.roads) {
        const k = `${rd.id}:${rd.pts[0]}:${rd.pts[1]}`; if (seen.has(k)) continue; seen.add(k);
        let hit = false; for (let q = 0; q < rd.pts.length; q += 2) { const x = rd.pts[q], z = rd.pts[q + 1]; if (x > x0 - margin - 60 && x < x0 + size + margin + 60 && z > z0 - margin - 60 && z < z0 + size + margin + 60) { hit = true; break; } }
        if (hit) roads.push(rd);
      }
      for (const bd of r.buildings) if (bd.cx >= x0 - margin && bd.cx < x0 + size + margin && bd.cz >= z0 - margin && bd.cz < z0 + size + margin) blds.push(bd);
      for (const p of r.potholes) ph.push(p);
      for (const ar of r.areas) areas.push(ar);
      for (const pl of this.regionPlots(r)) if (pl.cx >= x0 - margin && pl.cx < x0 + size + margin && pl.cz >= z0 - margin && pl.cz < z0 + size + margin) plots.push(pl);
    }
    return { roads, blds, ph, areas, plots };
  }

  private buildTile(ix: number, iz: number, res: number): Tile {
    const x0 = ix * TILE, z0 = iz * TILE; const key = `${ix},${iz}`;
    const { roads, blds, ph, areas, plots } = this.gather(x0, z0, TILE, 40);
    const inTile = (x: number, z: number) => x >= x0 && x < x0 + TILE && z >= z0 && z < z0 + TILE;
    // ground surfaces: landuse plus compounds (paved for the rich, swept sand for the rest) and bush on vacant plots
    const surfaces = areaSurfaces(areas);
    for (const pl of plots) surfaces.push({ code: pl.zone === 'vacant' ? SURF.bush : pl.zone === 'industrial' ? SURF.concrete : pl.rich > 0.6 ? SURF.interlock : SURF.compound, pts: new Float32Array(pl.pts) });
    const field = buildTileField(this.renderer, { x0, z0, size: TILE, roads, potholes: ph, surfaces }, res);
    const group = new THREE.Group(); group.position.set(x0, 0, z0);
    const gm = makeGroundMaterial(this.tg);
    const u = (gm as any).hlUniforms; u.uField.value = field.field.texture; u.uDetail.value = field.detail.texture; u.uTile.value.set(x0, z0, TILE);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2).translate(TILE / 2, 0, TILE / 2), gm);
    ground.receiveShadow = true; group.add(ground);
    const own = blds.filter((b) => inTile(b.cx, b.cz));
    const bb = buildBuildings(own, x0, z0);
    const bm = new THREE.Mesh(bb.geo, this.buildMat); bm.castShadow = true; bm.receiveShadow = true; group.add(bm);
    // compounds for the plots whose centre is in this tile
    const near = (x: number, z: number) => blds.filter((b) => Math.abs(b.cx - x) < 60 && Math.abs(b.cz - z) < 60);
    const segs: number[] = [];
    for (const r of roads) { if (r.flags & RF.bridge) continue; for (let k = 0; k < r.pts.length / 2 - 1; k++) segs.push(r.pts[k * 2], r.pts[k * 2 + 1], r.pts[k * 2 + 2], r.pts[k * 2 + 3]); }
    const roadDist = (x: number, z: number) => { let best = 1e9; for (let k = 0; k < segs.length; k += 4) { const ax = segs[k], az = segs[k + 1], bx = segs[k + 2], bz = segs[k + 3]; const dx = bx - ax, dz = bz - az; const L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); const d = Math.hypot(ax + dx * t - x, az + dz * t - z); if (d < best) best = d; } return best; };
    const ownPlots = plots.filter((p) => inTile(p.cx, p.cz));
    const cp = buildCompounds(ownPlots, near, roadDist, x0, z0);
    if (cp.geo) { const cm = new THREE.Mesh(cp.geo, this.buildMat); cm.castShadow = true; cm.receiveShadow = true; group.add(cm); }
    // trees: a few per plot, more on vacant land, never inside a building
    const trees: { x: number; z: number; palm: boolean; s: number }[] = [];
    for (const pl of ownPlots) {
      const seed = Math.floor(pl.cx * 3.1 + pl.cz * 7.7);
      const count = pl.zone === 'vacant' ? 1 + Math.floor(hash(seed, 1) * 4) : hash(seed, 2) < 0.35 ? 1 : 0;
      for (let t = 0; t < count; t++) {
        for (let tries = 0; tries < 6; tries++) {
          const i = Math.floor(hash(seed + tries, t + 3) * (pl.pts.length / 2)); const fx = hash(seed + tries, t + 9);
          const x = pl.cx + (pl.pts[i * 2] - pl.cx) * fx * 0.85, z = pl.cz + (pl.pts[i * 2 + 1] - pl.cz) * fx * 0.85;
          if (pl.buildings.some((b) => pointInPoly(x, z, b.pts))) continue;
          trees.push({ x, z, palm: hash(seed, t + 40) < 0.3, s: hash(seed, t + 50) }); break;
        }
      }
    }
    const blocked = (x: number, z: number) => own.some((b) => Math.abs(b.cx - x) < 30 && Math.abs(b.cz - z) < 30 && pointInPoly(x, z, b.pts));
    const props = buildProps({ x0, z0, size: TILE, roads: roads.filter((r) => r.pts.length), trees, tanks: bb.tanks, bars: bb.bars, dishes: bb.dishes, blocked });
    props.group.position.set(-x0, 0, -z0); group.add(props.group);
    // bridges whose first point is in this tile own their deck
    const br = roads.filter((r) => (r.flags & RF.bridge) && inTile(r.pts[0], r.pts[1]));
    if (br.length) { const b = buildBridges(br, x0, z0, this.asphalt, this.asphaltN); group.add(b.group); }
    this.group.add(group);
    // collision for the sim: building prisms, compound walls, poles and trunks, bridge decks
    const convex = (p: Float32Array) => { const n = p.length / 2; let sgn = 0; for (let i = 0; i < n; i++) { const a = i, b = (i + 1) % n, c = (i + 2) % n; const cr = (p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[b * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[b * 2]); if (Math.abs(cr) < 1e-6) continue; const s2 = Math.sign(cr); if (sgn && s2 !== sgn) return false; sgn = s2; } return true; };
    const col: TileCol = { hulls: own.map((b) => ({ pts: Array.from(b.pts), h: buildingHeight(b) + 0.9, convex: convex(b.pts) })), walls: cp.segs, poles: [], decks: [] };
    for (let i = 0; i < props.lamps.length; i += 3) col.poles.push(props.lamps[i], props.lamps[i + 1], 0.12);
    for (const t of trees) if (inTile(t.x, t.z)) col.poles.push(t.x, t.z, t.palm ? 0.2 : 0.25);
    if (br.length) { const dc = deckCollision(br.map((r) => deckProfile(r))); col.decks.push(dc); }
    const nt: Tile = { key, x0, z0, res, field, group, ground, lamps: props.lamps, dist: 0, col, roads };
    this.onTile?.(nt, true);
    return nt;
  }

  onTile?: (t: Tile, built: boolean) => void;
  private disposeTile(t: Tile) {
    this.onTile?.(t, false);
    this.group.remove(t.group);
    t.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if ((o as any).isMesh && (m.material as THREE.Material) !== this.buildMat && !(o as any).isInstancedMesh) { const mt = m.material as THREE.Material; if (mt && (mt as any).hlUniforms) mt.dispose(); } });
    t.field.dispose();
  }

  /** Call every frame. Loads regions, then builds at most one tile per call, nearest first. */
  update(cx: number, cz: number) {
    const R = this.radius;
    void this.store.around(cx, cz, R + 300);
    const want: { ix: number; iz: number; d: number; res: number }[] = [];
    for (let ix = Math.floor((cx - R) / TILE); ix <= Math.floor((cx + R) / TILE); ix++) for (let iz = Math.floor((cz - R) / TILE); iz <= Math.floor((cz + R) / TILE); iz++) {
      const mx = Math.max(ix * TILE, Math.min(cx, ix * TILE + TILE)), mz = Math.max(iz * TILE, Math.min(cz, iz * TILE + TILE));
      const d = Math.hypot(mx - cx, mz - cz); if (d > R) continue;
      want.push({ ix, iz, d, res: d < 260 ? this.nearRes : this.farRes });
    }
    want.sort((a, b) => a.d - b.d);
    const keep = new Set(want.map((w) => `${w.ix},${w.iz}`));
    for (const [k, t] of this.tiles) if (!keep.has(k)) { this.disposeTile(t); this.tiles.delete(k); }
    if (this.building) return;
    for (const w of want) {
      const k = `${w.ix},${w.iz}`; const t = this.tiles.get(k);
      if (t && t.res >= w.res) continue;
      // every region the tile touches must be in memory first
      const [a, b] = this.store.regionOf(w.ix * TILE - 100, w.iz * TILE - 100), [c, d] = this.store.regionOf(w.ix * TILE + TILE + 100, w.iz * TILE + TILE + 100);
      let ready = true; for (let i = a; i <= c; i++) for (let j = b; j <= d; j++) if (this.store.has(i, j) && !this.store.get(i, j)) ready = false;
      if (!ready) continue;
      const nt = this.buildTile(w.ix, w.iz, w.res);
      if (t) this.disposeTile(t);
      this.tiles.set(k, nt);
      this.lamps = [...this.tiles.values()].flatMap((x) => x.lamps);
      return;
    }
  }
  get pending() { let n = 0; return n; }
}
