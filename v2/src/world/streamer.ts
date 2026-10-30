// Streams the corridor around the camera in 250 m tiles: road field, ground, buildings, compounds, props, bridges.
import * as THREE from 'three';
import { RegionStore, type Region, type Road, type Building, type Pothole, type Area, type Rail, type Poi, type Water, RF, RAIL, BK } from './region';
import { buildTileField, areaSurfaces, waterSurfaces, mechanicSurfaces, SURF, type TileField } from './roadField';
import { buildFeatures, warmFeatures } from './features';
import { makeGroundMaterial } from './ground';
import { buildBuildingsG, makeBuildingMaterial } from './buildings';
import { plotsForRegion, type Plot } from './plots';
import { buildCompoundsG } from './compounds';
import { RoadClear, fitBuilding, dropNested, shoreWallOk } from './declutter';
import { buildProps, warmProps } from './props';
import { buildBridges, deckCollision, deckProfile } from './bridges';
import type { TileCol } from '../sim/life';
import { buildingHeight } from './buildings';
import { hash, pointInPoly, slice } from './geo';
import { halfWidth, verge } from './roadspec';
import type { TexSet } from './texsets';

export const TILE = 250;
export interface Tile { key: string; x0: number; z0: number; res: number; field: TileField; group: THREE.Group; ground: THREE.Mesh; lamps: number[]; dist: number; col: TileCol; roads: Road[]; props: THREE.Group }

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
    warmProps(); warmFeatures();
    this.buildMat = makeBuildingMaterial(tw);
    (this.buildMat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    const tl = new THREE.TextureLoader();
    this.asphalt = tl.load(`tex/g0_diff_${tg.size}.webp`); this.asphalt.wrapS = this.asphalt.wrapT = THREE.RepeatWrapping; this.asphalt.colorSpace = THREE.SRGBColorSpace;
    this.asphaltN = tl.load(`tex/g0_nor_${tg.size}.webp`); this.asphaltN.wrapS = this.asphaltN.wrapT = THREE.RepeatWrapping;
  }
  private plotsPending = new Map<string, Region>();
  regionPlots(r: Region) {
    const k = `${r.i},${r.j}`; let p = this.plots.get(k); if (p) return p;
    const miss = { n: 0 }; p = plotsForRegion(r, this.store.bldById, miss);
    this.plots.set(k, p);
    // parcels waiting on a building in a neighbouring region that is still loading are rebuilt once it arrives
    if (miss.n > 0) this.plotsPending.set(k, r);
    return p;
  }
  private refreshPlots() {
    for (const [k, r] of this.plotsPending) {
      let ready = true; for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (this.store.has(r.i + di, r.j + dj) && !this.store.get(r.i + di, r.j + dj)) ready = false;
      if (!ready) continue;
      this.plotsPending.delete(k);
      if (this.store.get(r.i, r.j) !== r) { this.plots.delete(k); continue; }
      this.plots.delete(k); this.regionPlots(r);
      if (this.plotsPending.get(k)) this.plotsPending.delete(k); // still missing after every neighbour loaded: those buildings are not in the map
    }
  }

  private gather(x0: number, z0: number, size: number, margin: number) {
    const roads: Road[] = [], blds: Building[] = [], ph: Pothole[] = [], areas: Area[] = [], plots: Plot[] = [], rails: Rail[] = [], pois: Poi[] = [], waters: (Water & { bx0: number; bx1: number; bz0: number; bz1: number })[] = [];
    const seenR = new Set<string>(), seenA = new Set<string>(), seenW = new Set<string>();
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
      for (const ar of r.areas) { const k = `${ar.kind}:${ar.sub}:${ar.pts[0]}:${ar.pts[1]}:${ar.pts.length}`; if (seenA.has(k)) continue; seenA.add(k); areas.push(ar); }
      for (const rl of r.rail) { const k = `${rl.kind}:${rl.pts[0]}:${rl.pts[1]}:${rl.pts.length}`; if (seenR.has(k)) continue; seenR.add(k); rails.push(rl); }
      for (const po of r.pois) if (po.x >= x0 - margin && po.x < x0 + size + margin && po.z >= z0 - margin && po.z < z0 + size + margin) pois.push(po);
      const rs = this.store.manifest.regionSize;
      for (const w of r.water) { const k = `${w.kind}:${w.rings[0][0]}:${w.rings[0][1]}:${w.rings[0].length}:${r.i}:${r.j}`; if (seenW.has(k)) continue; seenW.add(k); waters.push(Object.assign({}, w, { bx0: r.i * rs - 40, bx1: (r.i + 1) * rs + 40, bz0: r.j * rs - 40, bz1: (r.j + 1) * rs + 40 })); }
      for (const pl of this.regionPlots(r)) if (pl.cx >= x0 - margin && pl.cx < x0 + size + margin && pl.cz >= z0 - margin && pl.cz < z0 + size + margin) plots.push(pl);
    }
    return { roads, blds, ph, areas, plots, rails, pois, waters };
  }

  /** Builds a tile in slices (one per frame, each a few ms) so streaming never stalls a frame. */
  private *buildTile(ix: number, iz: number, res: number): Generator<void, Tile, void> {
    const x0 = ix * TILE, z0 = iz * TILE; const key = `${ix},${iz}`;
    this.stage = 'gather';
    const { roads, blds, ph, areas, plots, rails, pois, waters } = this.gather(x0, z0, TILE, 40);
    const inTile = (x: number, z: number) => x >= x0 && x < x0 + TILE && z >= z0 && z < z0 + TILE;
    // one road corridor model for the whole tile: buildings are pushed off pavements and roads, nested duplicates dropped
    const rc = new RoadClear(roads);
    for (const b of blds) { if (b.fit) continue; if (slice.due()) yield; fitBuilding(b, rc); }
    dropNested(blds);
    for (let i = blds.length - 1; i >= 0; i--) if (blds[i].dead) blds.splice(i, 1);
    this.stage = 'field'; yield;
    // ground surfaces: landuse plus compounds (paved for the rich, swept sand for the rest) and bush on vacant plots
    const surfaces = areaSurfaces(areas);
    for (const pl of plots) surfaces.push({ code: pl.zone === 'vacant' ? SURF.bush : pl.zone === 'industrial' ? SURF.concrete : pl.rich > 0.6 ? SURF.interlock : SURF.compound, pts: new Float32Array(pl.pts) });
    for (const b of blds) if (b.kind === 14) surfaces.push({ code: SURF.concrete, pts: b.pts });
    surfaces.push(...waterSurfaces(waters, x0, z0, TILE), ...mechanicSurfaces(areas));
    const field = buildTileField(this.renderer, { x0, z0, size: TILE, roads, potholes: ph, surfaces }, res);
    this.stage = 'buildings'; yield;
    const group = new THREE.Group(); group.position.set(x0, 0, z0);
    const gm = makeGroundMaterial(this.tg);
    const u = (gm as any).hlUniforms; u.uField.value = field.field.texture; u.uDetail.value = field.detail.texture; u.uTile.value.set(x0, z0, TILE);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2).translate(TILE / 2, 0, TILE / 2), gm);
    ground.receiveShadow = true; group.add(ground);
    const own = blds.filter((b) => inTile(b.cx, b.cz));
    const bb = yield* buildBuildingsG(own, x0, z0);
    const bm = new THREE.Mesh(bb.geo, this.buildMat); bm.castShadow = true; bm.receiveShadow = true; group.add(bm);
    this.stage = 'compounds'; yield;
    // compounds for the plots whose centre is in this tile
    const near = (x: number, z: number) => blds.filter((b) => Math.abs(b.cx - x) < 60 && Math.abs(b.cz - z) < 60);
    /** true for points on the carriageway or its verge */
    const onRoad = (x: number, z: number) => rc.room(x, z, 'wall') < 0;
    const ownPlots = plots.filter((p) => inTile(p.cx, p.cz));
    const cp = yield* buildCompoundsG(ownPlots, near, rc, x0, z0);
    if (cp.geo) { const cm = new THREE.Mesh(cp.geo, this.buildMat); cm.castShadow = true; cm.receiveShadow = true; group.add(cm); }
    this.stage = 'props'; yield;
    // trees: a few per plot, more on vacant land, never inside a building
    const trees: { x: number; z: number; palm: boolean; s: number }[] = [];
    for (const pl of ownPlots) {
      const seed = Math.floor(pl.cx * 3.1 + pl.cz * 7.7);
      const count = pl.zone === 'vacant' ? 1 + Math.floor(hash(seed, 1) * 4) : hash(seed, 2) < 0.35 ? 1 : 0;
      for (let t = 0; t < count; t++) {
        for (let tries = 0; tries < 6; tries++) {
          const i = Math.floor(hash(seed + tries, t + 3) * (pl.pts.length / 2)); const fx = hash(seed + tries, t + 9);
          const x = pl.cx + (pl.pts[i * 2] - pl.cx) * fx * 0.85, z = pl.cz + (pl.pts[i * 2 + 1] - pl.cz) * fx * 0.85;
          if (pl.buildings.some((b) => !b.dead && pointInPoly(x, z, b.pts))) continue;
          if (rc.room(x, z, 'tree') < 0) continue;
          trees.push({ x, z, palm: hash(seed, t + 40) < 0.3, s: hash(seed, t + 50) }); break;
        }
      }
    }
    const blocked = (x: number, z: number) => own.some((b) => Math.abs(b.cx - x) < 30 && Math.abs(b.cz - z) < 30 && pointInPoly(x, z, b.pts));
    const props = buildProps({ x0, z0, size: TILE, roads: roads.filter((r) => r.pts.length), trees, tanks: bb.tanks, bars: bb.bars, dishes: bb.dishes, blocked, poleBad: (x, z) => rc.poleBad(x, z) });
    props.group.position.set(-x0, 0, -z0); group.add(props.group);
    this.stage = 'finish'; yield;
    // bridges whose first point is in this tile own their deck
    // every bridge segment whose midpoint lies in this tile belongs to this tile (long viaducts span many tiles)
    const br: Road[] = [];
    for (const r of roads) {
      if (!(r.flags & RF.bridge)) continue;
      const n = r.pts.length / 2; let s = -1;
      for (let k = 0; k <= n - 1; k++) {
        const own = k < n - 1 && inTile((r.pts[k * 2] + r.pts[k * 2 + 2]) / 2, (r.pts[k * 2 + 1] + r.pts[k * 2 + 3]) / 2);
        if (own && s < 0) s = k;
        else if (!own && s >= 0) { br.push({ ...r, pts: r.pts.slice(s * 2, (k + 1) * 2), elev: r.elev ? r.elev.slice(s, k + 1) : null }); s = -1; }
      }
    }
    if (br.length) { const b = buildBridges(br, x0, z0, this.asphalt, this.asphaltN); group.add(b.group); }
    if (slice.due()) yield;
    // rails, platforms, courts, banks, mechanic villages
    const ft = buildFeatures({ x0, z0, size: TILE, rails, areas, pois, buildings: blds, roads, blocked, onRoad });
    group.add(ft.group);
    if (slice.due()) yield;
    this.group.add(group);
    // collision for the sim: building prisms, compound walls, poles and trunks, bridge decks
    const convex = (p: Float32Array) => { const n = p.length / 2; let sgn = 0; for (let i = 0; i < n; i++) { const a = i, b = (i + 1) % n, c = (i + 2) % n; const cr = (p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[b * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[b * 2]); if (Math.abs(cr) < 1e-6) continue; const s2 = Math.sign(cr); if (sgn && s2 !== sgn) return false; sgn = s2; } return true; };
    const col: TileCol = { hulls: own.filter((b) => b.kind !== 14 && b.kind !== BK.canopy).map((b) => ({ pts: Array.from(b.pts), h: buildingHeight(b) + 0.9, convex: convex(b.pts) })), walls: cp.segs, poles: [], decks: [] };
    for (let i = 0; i < props.lamps.length; i += 3) col.poles.push(props.lamps[i], props.lamps[i + 1], 0.12);
    for (const t of trees) if (inTile(t.x, t.z)) col.poles.push(t.x, t.z, t.palm ? 0.2 : 0.25);
    const railDecks: { pts: Float32Array; ys: Float32Array; hw: number }[] = [];
    for (const r of rails) {
      if (!r.elev || !(r.flags & 1) || !(r.kind === RAIL.standard || r.kind === RAIL.narrow || r.kind === RAIL.light || r.kind === RAIL.disused)) continue;
      const n = r.pts.length / 2; let s = -1;
      for (let k = 0; k <= n - 1; k++) {
        const own = k < n - 1 && inTile((r.pts[k * 2] + r.pts[k * 2 + 2]) / 2, (r.pts[k * 2 + 1] + r.pts[k * 2 + 3]) / 2);
        if (own && s < 0) s = k;
        else if (!own && s >= 0) { railDecks.push({ pts: r.pts.slice(s * 2, (k + 1) * 2), ys: Float32Array.from(r.elev.slice(s, k + 1), (e) => e + 0.1), hw: r.gauge / 2000 + 1.3 }); s = -1; }
      }
    }
    if (br.length || railDecks.length) { const dc = deckCollision([...br.map((r) => deckProfile(r)), ...railDecks]); col.decks.push(dc); }
    if (ft.poles) col.poles.push(...ft.poles);
    for (const f of ft.fenceWalls) col.walls.push({ ax: f.ax, az: f.az, bx: f.bx, bz: f.bz, h: f.h });
    // the shore is a wall: nobody drives or walks into the lagoon
    for (const w of waters) {
      if (w.line) continue;
      for (const ring of w.rings) {
        const n = ring.length / 2; let skip = 0;
        for (let k = 0; k < n; k++) {
          const j = (k + 1) % n; const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
          const mx = (ax + bx) / 2, mz = (az + bz) / 2; if (!inTile(mx, mz)) continue;
          const onClip = (Math.abs(ax - w.bx0) < 0.3 && Math.abs(bx - w.bx0) < 0.3) || (Math.abs(ax - w.bx1) < 0.3 && Math.abs(bx - w.bx1) < 0.3) || (Math.abs(az - w.bz0) < 0.3 && Math.abs(bz - w.bz0) < 0.3) || (Math.abs(az - w.bz1) < 0.3 && Math.abs(bz - w.bz1) < 0.3);
          if (onClip || !shoreWallOk(mx, mz, rc)) { skip++; continue; }
          col.walls.push({ ax, az, bx, bz, h: 1.2 });
        }
      }
    }
    const nt: Tile = { key, x0, z0, res, field, group, ground, lamps: props.lamps, dist: 0, col, roads, props: props.group };
    this.onTile?.(nt, true);
    return nt;
  }

  onTile?: (t: Tile, built: boolean) => void;
  /** name of the build step the next slice belongs to (the work of each gen.next() is booked under it) */
  stage = 'gather';
  /** timing of the last slices, for the perf overlay */
  slices: [string, number][] = [];
  private job: { key: string; res: number; old?: Tile; gen: Generator<void, Tile, void> } | null = null;
  private disposeTile(t: Tile) {
    this.onTile?.(t, false);
    this.group.remove(t.group);
    t.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if ((o as any).isMesh && (m.material as THREE.Material) !== this.buildMat && !(o as any).isInstancedMesh) { const mt = m.material as THREE.Material; if (mt && (mt as any).hlUniforms) mt.dispose(); } });
    t.field.dispose();
  }

  /** Call every frame. Loads regions, then advances the tile build by one slice, nearest tile first. `burst` finishes a tile at once (boot, tests). */
  update(cx: number, cz: number, burst = false) {
    const R = this.radius; this.refreshPlots();
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
    // small props are not worth drawing far away: each kind has its own range (set from the quality rung), and a whole tile's props go at the longest
    const rg = this.ranges;
    for (const t of this.tiles.values()) {
      const mx = Math.max(t.x0, Math.min(cx, t.x0 + TILE)), mz = Math.max(t.z0, Math.min(cz, t.z0 + TILE)); const d = Math.hypot(mx - cx, mz - cz);
      t.dist = d; const any = d < rg.tree; if (t.props.visible !== any) t.props.visible = any;
      if (any) for (const c of t.props.children) { const v = d < (rg[c.userData.k as keyof typeof rg] ?? rg.tree); if (c.visible !== v) c.visible = v; }
    }
    if (!this.job) {
      for (const w of want) {
        const k = `${w.ix},${w.iz}`; const t = this.tiles.get(k);
        if (t && t.res >= w.res) continue;
        // every region the tile touches must be in memory first
        const [a, b] = this.store.regionOf(w.ix * TILE - 100, w.iz * TILE - 100), [c, d] = this.store.regionOf(w.ix * TILE + TILE + 100, w.iz * TILE + TILE + 100);
        let ready = true; for (let i = a; i <= c; i++) for (let j = b; j <= d; j++) if (this.store.has(i, j) && !this.store.get(i, j)) ready = false;
        if (!ready) continue;
        this.slices.length = 0;
        this.job = { key: k, res: w.res, old: t, gen: this.buildTile(w.ix, w.iz, w.res) };
        break;
      }
    }
    const frameT0 = performance.now();
    while (this.job) {
      const w0 = performance.now(); slice.t0 = w0; const stage = this.stage;
      const r = this.job.gen.next();
      this.slices.push([stage, performance.now() - w0]);
      if (r.done) {
        const { key, old } = this.job; this.job = null;
        if (old) this.disposeTile(old);
        this.tiles.set(key, r.value);
        this.lamps = [...this.tiles.values()].flatMap((x) => x.lamps);
        break;
      }
      if (!burst && performance.now() - frameT0 >= this.budgetMs) break;
    }
  }
  /** main-thread milliseconds streaming may use per frame (every step is also cut into pieces of about slice.ms) */
  budgetMs = 4;
  /** draw distance (m) per kind of small prop; LifeView sets these from the quality rung */
  ranges = { lamp: 260, util: 160, tree: 480, clutter: 140 };
  get pending() { let n = 0; return n; }
}
