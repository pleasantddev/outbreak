// Dressing the streets: brand billboards on monopoles along every straight, the giant ADVERTISE WITH US board at the
// end of the longest straight, campaign fliers pasted on barriers and poles, green direction signs, chevrons at
// hairpins, street lights, electric poles with sagging wires, palms and almond trees, market umbrellas, crowds and
// danfos waiting at the terminals.
import * as THREE from 'three';
import type { Track } from '../shared/track';
import type { WorldData, WorldBuilding } from '../shared/world';
import { Rng } from '../shared/rng';
import { pointInPolygon } from '../shared/math';
import { GeoBuilder } from './geom';
import type { Materials } from './materials';
import { CREATIVES, creativeTexture, houseTexture, flierTexture, streetPosterTexture, roadSignTexture, chevronTexture, shopSignAtlas, makeLitMaterial, type HouseCreative } from './signage';
import { parkedVehicle } from './traffic3d';
import { canvas, tex } from './textures';
import { Clearance } from './clearance';

export interface PropOptions { density: number; shadows: boolean; political: boolean; crowd: boolean; detail: number }
export interface AdConfig { slots: { id: string; size: string; placement: string; creative: string }[]; creatives: Record<string, HouseCreative & { type: string }> }

class BuildingGrid {
  private cell = 25;
  private g = new Map<number, WorldBuilding[]>();
  constructor(bs: WorldBuilding[]) {
    for (const b of bs) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of b.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      for (let gx = Math.floor(x0 / this.cell); gx <= Math.floor(x1 / this.cell); gx++) for (let gz = Math.floor(z0 / this.cell); gz <= Math.floor(z1 / this.cell); gz++) {
        const k = (gx + 1000) * 2000 + gz + 1000; const a = this.g.get(k) ?? []; a.push(b); this.g.set(k, a);
      }
    }
  }
  /** Is this point inside (or within margin of) a building? */
  blocked(x: number, z: number, margin = 1.5) {
    for (const [dx, dz] of [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]]) {
      const k = (Math.floor((x + dx) / this.cell) + 1000) * 2000 + Math.floor((z + dz) / this.cell) + 1000;
      for (const b of this.g.get(k) ?? []) if (pointInPolygon(x + dx, z + dz, b.pts)) return true;
    }
    return false;
  }
}

export class Props {
  group = new THREE.Group();
  lampHeads: THREE.InstancedMesh | null = null;
  lightPools: THREE.InstancedMesh | null = null;
  billboardLights: THREE.MeshStandardMaterial[] = [];
  crowd: THREE.InstancedMesh | null = null;
  private crowdBase: { x: number; y: number; z: number; h: number; ph: number; s: number }[] = [];
  private crowdBody: THREE.InstancedMesh | null = null;
  private rng: Rng;
  private bgrid: BuildingGrid;
  private clear: Clearance;
  private dummy = new THREE.Object3D();

  constructor(private world: WorldData, private track: Track, buildings: WorldBuilding[], private mats: Materials, private opts: PropOptions, private ads: AdConfig | null) {
    this.rng = new Rng(track.data.id.length * 131 + 7);
    this.bgrid = new BuildingGrid(buildings);
    this.clear = new Clearance(track);
    this.group.name = 'props';
    // the giant boards claim their spots first so no ordinary billboard ends up in front of them
    this.giantBoards();
    this.billboards();
    this.roadSigns();
    this.posters();
    this.streetLights();
    this.poles();
    this.trees();
    this.market();
    if (opts.crowd) this.spectators();
    this.terminalBays();
  }

  /** Points beside the track: s, side, offset from the centreline, and the ground position there. */
  private beside(s: number, side: number, extra: number) {
    const p = this.track.pointAt(s, 0, 0, false);
    const off = p.hw + extra;
    return { x: p.x + p.rx * off * side, z: p.z + p.rz * off * side, y: p.y, h: p.h, rx: p.rx, rz: p.rz, hw: p.hw, tx: p.tx, tz: p.tz };
  }

  private straights(minLen: number) {
    const tr = this.track, L = tr.length;
    const out: { s0: number; s1: number }[] = [];
    let start = -1;
    for (let s = 0; s <= L; s += 5) {
      const ok = Math.abs(tr.curvatureAt(s)) < 0.006;
      if (ok && start < 0) start = s;
      if ((!ok || s + 5 > L) && start >= 0) { if (s - start >= minLen) out.push({ s0: start, s1: s }); start = -1; }
    }
    return out.sort((a, b) => (b.s1 - b.s0) - (a.s1 - a.s0));
  }

  // ------------------------------------------------------------------------------------------- billboards

  private billboardAt(x: number, y: number, z: number, face: number, w: number, h: number, poleH: number, mat: THREE.Material, steel: GeoBuilder, twin = false) {
    // monopole (or twin poles for the giants), catwalk, lamps, and the panel facing the racers
    if (twin) { for (const sd of [-1, 1]) steel.cylinder(x + Math.cos(face) * sd * w * 0.3, y, z - Math.sin(face) * sd * w * 0.3, 0.55, poleH, 12, false); }
    else steel.cylinder(x, y, z, 0.5, poleH, 12, false);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    panel.position.set(x, y + poleH + h / 2, z);
    panel.rotation.y = face;
    this.group.add(panel);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mats.steel);
    back.position.copy(panel.position); back.rotation.y = face + Math.PI; back.translateZ(0.25);
    this.group.add(back);
    const fx = Math.sin(face), fz = Math.cos(face), rx = Math.cos(face), rz = -Math.sin(face);
    steel.box(x + fx * 0.6, y + poleH - 0.1, z + fz * 0.6, w, 0.12, 1.1, face);   // catwalk
    for (let k = -2; k <= 2; k++) { const lx = x + rx * k * (w / 5) + fx * 1.3, lz = z + rz * k * (w / 5) + fz * 1.3; steel.box(lx, y + poleH, lz, 0.25, 0.22, 0.35, face); }
    steel.box(x, y + poleH - 0.4, z, w * 0.98, 0.3, 0.3, face);
  }

  private billboards() {
    const tr = this.track, L = tr.length;
    const steel = new GeoBuilder();
    const spacing = 150 / Math.max(0.4, this.opts.density);
    let side = 1, ci = Math.floor(this.rng.next() * CREATIVES.length);
    const mats = CREATIVES.map((c) => { const m = makeLitMaterial(creativeTexture(c), 0); this.billboardLights.push(m); return m; });
    for (let s = 60; s < L - 40; s += spacing * this.rng.range(0.8, 1.2)) {
      // place facing back down the road toward approaching racers, angled toward the track
      for (let attempt = 0; attempt < 4; attempt++) {
        const b = this.beside(s, side, this.rng.range(6, 11));
        const nearGiant = this.giantSpots.some((g) => Math.hypot(g.x - b.x, g.z - b.z) < 45);
        if (nearGiant || this.bgrid.blocked(b.x, b.z, 2.5) || this.trackNear(b.x, b.z, 3)) { side = -side; continue; }
        const face = b.h + Math.PI + side * 0.42;
        this.billboardAt(b.x, b.y, b.z, face, 12, 4.5, 8 + this.rng.range(0, 3), mats[ci % mats.length], steel);
        ci++;
        break;
      }
      side = -side;
    }
    const m = new THREE.Mesh(steel.build(), this.mats.steel); m.castShadow = this.opts.shadows;
    this.group.add(m);
  }

  /** Within `margin` metres of the race corridor, on any level. Seen from above, so a palm under a flyover or a lamp
   *  post at a junction counts: either would stand in some stretch of the lap. */
  private trackNear(x: number, z: number, margin: number) {
    return this.clear.blocks(x, z, margin);
  }

  /** The giant house board at the end of the longest straight, plus a second one on the next longest. */
  private giantBoards() {
    const st = this.straights(90);
    const slots = this.ads?.slots.filter((s) => s.size === 'giant') ?? [{ id: 'giant-1', size: 'giant', placement: 'longest-straight-end', creative: 'house-advertise' }];
    const steel = new GeoBuilder();
    slots.forEach((slot, i) => {
      const straight = st[i];
      if (!straight) return;
      const cr = this.ads?.creatives[slot.creative] ?? { type: 'house', headline: 'ADVERTISE WITH US', sub: 'Your brand on the biggest board in Oshodi. Seen by every racer, every lap.', cta: 'Book this space in the Lagos Rush app', bg: '#f6c514', fg: '#111111', accent: '#d0141c' };
      const mat = makeLitMaterial(houseTexture(cr), 0);
      this.billboardLights.push(mat);
      // at the far end of the straight, to the outside of the next bend, facing back up the straight
      const s = straight.s1 + 25;
      const k = this.track.curvatureAt(s + 20);
      let side = k >= 0 ? -1 : 1;
      for (let attempt = 0; attempt < 2; attempt++) {
        const b = this.beside(s, side, 16);
        if (!this.bgrid.blocked(b.x, b.z, 4) && !this.trackNear(b.x, b.z, 6)) {
          const p0 = this.track.pointAt(straight.s0 + (straight.s1 - straight.s0) * 0.3);
          const face = Math.atan2(p0.x - b.x, p0.z - b.z);
          this.billboardAt(b.x, b.y, b.z, face, 24, 9, 14, mat, steel, true);
          this.giantSpots.push({ x: b.x, z: b.z, face });
          return;
        }
        side = -side;
      }
    });
    const m = new THREE.Mesh(steel.build(), this.mats.steel); m.castShadow = this.opts.shadows;
    this.group.add(m);
  }
  giantSpots: { x: number; z: number; face: number }[] = [];
  /** where campaign fliers went up, with the outward direction of the barrier they sit on (for the dev viewer) */
  flierSpots: { x: number; y: number; z: number; rx: number; rz: number }[] = [];

  // ------------------------------------------------------------------------------------------- signs

  private roadSigns() {
    const tr = this.track, L = tr.length;
    const steel = new GeoBuilder();
    const sets = [
      [{ text: 'OSHODI INTERCHANGE', arrow: 'up' as const }, { text: 'IKEJA', arrow: 'right' as const }],
      [{ text: 'AGEGE', arrow: 'up' as const }, { text: 'APAPA', arrow: 'left' as const }, { text: 'OWORONSHOKI', arrow: 'right' as const }],
      [{ text: 'MUSHIN', arrow: 'upleft' as const }, { text: 'ISOLO', arrow: 'upright' as const }],
      [{ text: 'AIRPORT ROAD', arrow: 'up' as const }, { text: 'OSHODI MARKET', arrow: 'left' as const }],
    ];
    const st = this.straights(70);
    st.slice(0, 3).forEach((straight, i) => {
      const s = straight.s0 + 20;
      const p = tr.pointAt(s, 0, 0, false);
      const span = p.hw + 1.6;
      if ([-1, 1].some((sd) => this.trackNear(p.x + p.rx * span * sd, p.z + p.rz * span * sd, 0.6))) return;
      // gantry over the road
      for (const sd of [-1, 1]) steel.cylinder(p.x + p.rx * span * sd, p.y, p.z + p.rz * span * sd, 0.22, 6.6, 10, false);
      const A = [p.x - p.rx * span, p.y + 6.4, p.z - p.rz * span], B = [p.x + p.rx * span, p.y + 6.4, p.z + p.rz * span];
      steel.strut(A, B, 0.3); steel.strut([A[0], A[1] + 1.2, A[2]], [B[0], B[1] + 1.2, B[2]], 0.2);
      const mat = makeLitMaterial(roadSignTexture(sets[(i + L | 0) % sets.length]), 0.15);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(9, p.hw * 1.3), 3.4), mat);
      sign.position.set(p.x - p.tx * 0.2, p.y + 7.3, p.z - p.tz * 0.2);
      sign.rotation.y = p.h + Math.PI;
      this.group.add(sign);
    });
    // chevrons on the outside of tight bends
    const chev = makeLitMaterial(chevronTexture(), 0.4);
    const geo = new THREE.PlaneGeometry(2.2, 1.1);
    for (let s = 0; s < L; s += 6) {
      const k = tr.curvatureAt(s);
      if (Math.abs(k) < 0.05) continue;
      const side = k > 0 ? -1 : 1;
      const b = this.beside(s, side, 0.9);
      if (this.trackNear(b.x, b.z, 0.4)) continue;
      const m = new THREE.Mesh(geo, chev);
      m.position.set(b.x, b.y + 1.6, b.z);
      m.rotation.y = Math.atan2(-b.rx * side, -b.rz * side);
      if (side > 0) m.scale.x = -1;
      this.group.add(m);
      steel.box(b.x, b.y, b.z, 0.1, 1.1, 0.1);
      s += 6;
    }
    const m = new THREE.Mesh(steel.build(), this.mats.steel); m.castShadow = this.opts.shadows;
    this.group.add(m);
  }

  /** Fly-posted fliers on the barriers and lamp posts, in ragged clusters. */
  private posters() {
    const tr = this.track, L = tr.length;
    const designs = this.opts.political ? [0, 1, 2].map((v) => flierTexture(v)) : [];
    const street = [0, 1, 2, 3].map((v) => streetPosterTexture(v));
    const all = [...designs, ...street];
    const per = all.map(() => [] as THREE.Matrix4[]);
    const geo = new THREE.PlaneGeometry(0.62, 0.86);
    const step = 22 / Math.max(0.35, this.opts.density);
    for (let s = 20; s < L; s += step * this.rng.range(0.6, 1.4)) {
      const p = tr.pointAt(s, 0, 0, false);
      if (p.y > 2.2) continue; // flyover parapets stay clean
      const side = this.rng.chance(0.5) ? 1 : -1;
      const n = this.rng.int(2, 7);
      for (let k = 0; k < n; k++) {
        const ss = s + (k - n / 2) * this.rng.range(0.55, 0.75);
        const q = tr.pointAt(ss, 0, 0, false);
        const d = (q.hw + 0.35 - 0.06) * side;
        // the barrier follows the road's banking, so take the height at the barrier, not at the centreline
        const atBarrier = tr.pointAt(ss, d, 0, false);
        const x = atBarrier.x, z = atBarrier.z;
        this.dummy.position.set(x, atBarrier.y + 0.42 + this.rng.range(-0.04, 0.05), z);
        this.dummy.rotation.set(0, Math.atan2(-q.rx * side, -q.rz * side), this.rng.range(-0.08, 0.08));
        this.dummy.rotateX(-0.28); // the jersey face leans back
        this.dummy.scale.setScalar(0.62);
        this.dummy.updateMatrix();
        // most fliers on the street are the campaign ones, as requested; the rest are local notices
        const pick = designs.length && this.rng.chance(0.72) ? this.rng.int(0, designs.length - 1) : designs.length + this.rng.int(0, street.length - 1);
        per[pick].push(this.dummy.matrix.clone());
        if (pick < designs.length && this.flierSpots.length < 40) this.flierSpots.push({ x, y: this.dummy.position.y, z, rx: q.rx * side, rz: q.rz * side });
      }
    }
    // posters on building walls that face the track
    all.forEach((t, i) => {
      if (!per[i].length) return;
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, transparent: true, alphaTest: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), per[i].length);
      per[i].forEach((m, k) => im.setMatrixAt(k, m));
      this.group.add(im);
    });
  }

  // ------------------------------------------------------------------------------------------- furniture

  private streetLights() {
    const tr = this.track, L = tr.length;
    const steel = new GeoBuilder();
    const heads: THREE.Matrix4[] = [], pools: THREE.Matrix4[] = [];
    const step = 34;
    let side = 1;
    for (let s = 10; s < L; s += step) {
      const b = this.beside(s, side, 2.2);
      const sideHere = side;
      side = -side;
      if (this.bgrid.blocked(b.x, b.z, 0.5) || this.trackNear(b.x, b.z, 0.8)) continue;
      const y0 = b.y > 2 ? b.y + 1.0 : 0;
      const h = 9;
      steel.cylinder(b.x, y0, b.z, 0.13, h, 8, true, 0.08);
      // the arm reaches out over the road, back toward the centreline
      const arm = 2.6, hx = b.x - b.rx * sideHere * arm, hz = b.z - b.rz * sideHere * arm;
      steel.strut([b.x, y0 + h - 0.1, b.z], [hx, y0 + h + 0.25, hz], 0.12);
      this.dummy.position.set(hx, y0 + h + 0.12, hz); this.dummy.rotation.set(0, b.h, 0); this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix();
      heads.push(this.dummy.matrix.clone());
      this.dummy.position.set(hx, (b.y > 2 ? b.y : 0) + 0.12, hz); this.dummy.rotation.set(-Math.PI / 2, 0, 0); this.dummy.updateMatrix();
      pools.push(this.dummy.matrix.clone());
    }
    const m = new THREE.Mesh(steel.build(), this.mats.steelLight); m.castShadow = this.opts.shadows;
    this.group.add(m);
    this.lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.14, 0.32), new THREE.MeshBasicMaterial({ color: 0xffe6b0, toneMapped: false }), heads.length);
    heads.forEach((h, i) => this.lampHeads!.setMatrixAt(i, h));
    this.group.add(this.lampHeads);
    const poolTex = (() => { const c = canvas(128), g = c.getContext('2d')!; const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,220,160,0.9)'); gr.addColorStop(1, 'rgba(255,200,140,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return tex(c, { repeat: false }); })();
    this.lightPools = new THREE.InstancedMesh(new THREE.PlaneGeometry(13, 13), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8 }), pools.length);
    pools.forEach((h, i) => this.lightPools!.setMatrixAt(i, h));
    this.group.add(this.lightPools);
  }

  /** Concrete electric poles with sagging wires along the neighbourhood streets near the track. */
  private poles() {
    const pole = new GeoBuilder();
    const wire: number[] = [];
    const tr = this.track;
    for (const r of this.world.roads) {
      if (!['tertiary', 'residential', 'secondary'].includes(r.cls) || r.pts.some((p) => p[2] > 0.3)) continue;
      const mid = r.pts[Math.floor(r.pts.length / 2)];
      const q = tr.query(mid[0], 0, mid[1]);
      if (Math.abs(q.outside) > 260) continue;
      let acc = 0, prev: number[] | null = null;
      const side = (r.id % 2) ? 1 : -1;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nx = -(b[1] - a[1]) / (len || 1), nz = (b[0] - a[0]) / (len || 1);
        for (let t = (30 - acc) / (len || 1); t <= 1; t += 30 / (len || 1)) {
          const x = a[0] + (b[0] - a[0]) * t + nx * (r.w / 2 + 1.2) * side, z = a[1] + (b[1] - a[1]) * t + nz * (r.w / 2 + 1.2) * side;
          if (this.trackNear(x, z, 0.8) || this.bgrid.blocked(x, z, 0.3)) { prev = null; continue; }
          pole.cylinder(x, 0, z, 0.16, 8.5, 6, true, 0.11);
          pole.box(x, 7.9, z, 1.6, 0.12, 0.12, Math.atan2(nx, nz));
          const top = [x, 7.95, z];
          if (prev) for (const off of [-0.7, 0, 0.7]) {
            // three wires per span, each sagging in a shallow curve
            const ox = nx * off, oz = nz * off;
            let px = prev[0] + ox, py = prev[1], pz = prev[2] + oz;
            for (let k = 1; k <= 6; k++) {
              const f = k / 6, x2 = prev[0] + (top[0] - prev[0]) * f + ox, z2 = prev[2] + (top[2] - prev[2]) * f + oz;
              const y2 = prev[1] + (top[1] - prev[1]) * f - Math.sin(f * Math.PI) * 0.9;
              wire.push(px, py, pz, x2, y2, z2);
              px = x2; py = y2; pz = z2;
            }
          }
          prev = top;
        }
        acc = (acc + len) % 30;
      }
    }
    const pm = new THREE.Mesh(pole.build(), this.mats.concreteDark); pm.castShadow = this.opts.shadows;
    this.group.add(pm);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    this.group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x141414 })));
  }

  /** Coconut and oil palms, almond trees and neem, kept out of buildings and the corridor. */
  private trees() {
    const tr = this.track, L = tr.length;
    const palms: THREE.Matrix4[] = [], broad: THREE.Matrix4[] = [];
    const n = Math.floor((L / 18) * this.opts.density);
    for (let i = 0; i < n; i++) {
      const s = this.rng.next() * L;
      const side = this.rng.chance(0.5) ? 1 : -1;
      const b = this.beside(s, side, this.rng.range(4, 26));
      if (b.y > 1 || this.bgrid.blocked(b.x, b.z, 2) || this.trackNear(b.x, b.z, 2.5)) continue;
      this.dummy.position.set(b.x, 0, b.z);
      this.dummy.rotation.set(this.rng.range(-0.06, 0.06), this.rng.next() * 6.28, this.rng.range(-0.06, 0.06));
      this.dummy.scale.setScalar(this.rng.range(0.8, 1.25));
      this.dummy.updateMatrix();
      (this.rng.chance(0.55) ? palms : broad).push(this.dummy.matrix.clone());
    }
    // palm: a slightly bent trunk with a crown of drooping fronds
    const palmG = new GeoBuilder();
    palmG.setColor([0.42, 0.34, 0.26]);
    for (let k = 0; k < 6; k++) palmG.cylinder(Math.sin(k * 0.3) * 0.25, k * 1.5, 0, 0.24 - k * 0.015, 1.55, 7, false, 0.23 - k * 0.015);
    palmG.setColor([0.22, 0.42, 0.14]);
    for (let f = 0; f < 9; f++) {
      const a = (f / 9) * Math.PI * 2;
      const base = [Math.sin(5 * 0.3) * 0.25, 9, 0];
      let prevL = base, prevR = base;
      for (let k = 1; k <= 4; k++) {
        const r = k * 1.1, droop = 9 + 0.6 * k - 0.32 * k * k;
        const cx = base[0] + Math.cos(a) * r, cz = Math.sin(a) * r;
        const w = 0.55 * Math.sin((k / 4) * Math.PI) + 0.1;
        const L2 = [cx - Math.sin(a) * w, droop, cz + Math.cos(a) * w], R2 = [cx + Math.sin(a) * w, droop, cz - Math.cos(a) * w];
        palmG.quad(prevL, prevR, R2, L2);
        prevL = L2; prevR = R2;
      }
    }
    const broadG = new GeoBuilder();
    broadG.setColor([0.36, 0.28, 0.2]);
    broadG.cylinder(0, 0, 0, 0.3, 3.2, 7, false, 0.22);
    const greens: [number, number, number][] = [[0.2, 0.36, 0.14], [0.26, 0.42, 0.16], [0.18, 0.32, 0.12]];
    for (let k = 0; k < 6; k++) {
      broadG.setColor(greens[k % 3]);
      const a = k * 1.1, r = k ? 1.5 : 0;
      const ico = new THREE.IcosahedronGeometry(1.8 - k * 0.08, 0);
      const pos = ico.attributes.position as THREE.BufferAttribute;
      const cx = Math.cos(a) * r, cy = 4.2 + (k % 2) * 0.8, cz = Math.sin(a) * r;
      for (let i = 0; i < pos.count; i += 3) {
        const tri = [0, 1, 2].map((j) => [pos.getX(i + j) + cx, pos.getY(i + j) * 0.75 + cy, pos.getZ(i + j) + cz]);
        broadG.tri(tri[0], tri[1], tri[2]);
      }
      ico.dispose();
    }
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, flatShading: true });
    for (const [geoB, list] of [[palmG, palms], [broadG, broad]] as [GeoBuilder, THREE.Matrix4[]][]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geoB.build(), leafMat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = this.opts.shadows;
      this.group.add(im);
    }
  }

  /** Market umbrellas and stalls where the track passes the busy streets around the terminals. */
  private market() {
    const tr = this.track, L = tr.length;
    const cols = [0xd0141c, 0xf2c200, 0x1d4fb8, 0x2a9d4a, 0xff6a00, 0xe8e8e8, 0x8a2ad6];
    const per = cols.map(() => [] as THREE.Matrix4[]);
    const tables: THREE.Matrix4[] = [];
    const goods = new GeoBuilder();
    for (let s = 0; s < L; s += 7) {
      const p = tr.pointAt(s, 0, 0, false);
      if (p.y > 1) continue;
      // busier near the interchange and on the neighbourhood streets
      const nearHub = Math.hypot(p.x, p.z) < 420;
      if (!this.rng.chance((nearHub ? 0.45 : 0.18) * this.opts.density)) continue;
      const side = this.rng.chance(0.5) ? 1 : -1;
      const b = this.beside(s, side, this.rng.range(1.8, 4.2));
      if (this.bgrid.blocked(b.x, b.z, 1.4) || this.trackNear(b.x, b.z, 1.0)) continue;
      const c = this.rng.int(0, cols.length - 1);
      this.dummy.position.set(b.x, 0, b.z); this.dummy.rotation.set(0, this.rng.next() * 6.28, 0); this.dummy.scale.setScalar(this.rng.range(0.9, 1.15)); this.dummy.updateMatrix();
      per[c].push(this.dummy.matrix.clone());
      tables.push(this.dummy.matrix.clone());
      // a heap of goods on the table: tomatoes, pepper, yams, bowls
      for (let k = 0; k < 6; k++) { goods.setColor([[0.85, 0.12, 0.1], [0.9, 0.55, 0.1], [0.55, 0.38, 0.22], [0.2, 0.5, 0.85], [0.95, 0.85, 0.2]][this.rng.int(0, 4)] as [number, number, number]); goods.box(b.x + this.rng.range(-0.6, 0.6), 0.85, b.z + this.rng.range(-0.4, 0.4), 0.22, 0.18, 0.22, this.rng.next()); }
    }
    const umb = new THREE.ConeGeometry(1.7, 0.6, 8, 1, true);
    umb.translate(0, 2.3, 0);
    cols.forEach((col, i) => {
      if (!per[i].length) return;
      const im = new THREE.InstancedMesh(umb, new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, side: THREE.DoubleSide }), per[i].length);
      per[i].forEach((m, k) => im.setMatrixAt(k, m));
      im.castShadow = this.opts.shadows;
      this.group.add(im);
    });
    if (tables.length) {
      const tg = new GeoBuilder(); tg.setColor([0.5, 0.36, 0.22]); tg.box(0, 0.72, 0, 1.6, 0.06, 1.0); tg.setColor([0.3, 0.3, 0.3]); tg.cylinder(0, 0, 0, 0.03, 2.3, 5, false);
      for (const [x, z] of [[-0.7, -0.4], [0.7, -0.4], [0.7, 0.4], [-0.7, 0.4]]) tg.box(x, 0, z, 0.06, 0.72, 0.06);
      const im = new THREE.InstancedMesh(tg.build(), this.mats.vertexLit, tables.length);
      tables.forEach((m, k) => im.setMatrixAt(k, m));
      this.group.add(im);
    }
    if (goods.count) this.group.add(new THREE.Mesh(goods.build(), this.mats.vertexLit));
  }

  /** Spectators behind the barriers near the start line and at the hairpins. */
  private spectators() {
    const tr = this.track, L = tr.length;
    const spots: number[] = [];
    for (let s = L - 70; s < L + 50; s += 1.6) spots.push(s % L);
    for (let s = 0; s < L; s += 4) if (Math.abs(tr.curvatureAt(s)) > 0.06) for (let k = 0; k < 4; k++) spots.push(s + k);
    // one person in two meshes sharing the same instances: clothes take a colour per instance, while skin, trousers
    // and shoes keep their own, so a red shirt never tints a face
    const clothesG = new GeoBuilder(), bodyG = new GeoBuilder();
    clothesG.setColor([1, 1, 1]);
    clothesG.cylinder(0, 0.86, 0, 0.19, 0.6, 8, true, 0.23);                       // torso, wider at the shoulders
    for (const sd of [-1, 1]) clothesG.strut([sd * 0.25, 1.4, 0], [sd * 0.4, 1.78, 0.06], 0.1);  // sleeves, arms up
    bodyG.setColor([0.12, 0.12, 0.16]);
    for (const sd of [-1, 1]) bodyG.box(sd * 0.09, 0.06, 0, 0.13, 0.82, 0.15);     // trousers
    bodyG.setColor([0.05, 0.05, 0.05]);
    for (const sd of [-1, 1]) bodyG.box(sd * 0.09, 0, 0.03, 0.14, 0.07, 0.24);     // shoes
    bodyG.setColor([0.36, 0.22, 0.14]);
    bodyG.sphere(0, 1.6, 0, 0.12, 8, 6);                                           // head
    for (const sd of [-1, 1]) bodyG.sphere(sd * 0.41, 1.81, 0.06, 0.05, 6, 4);     // hands
    bodyG.cylinder(0, 1.44, 0, 0.05, 0.06, 6, false);                               // neck
    const clothesMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    const max = Math.min(900, Math.round(spots.length * 2 * this.opts.density));
    const im = new THREE.InstancedMesh(clothesG.build(), clothesMat, max);
    this.crowdBody = new THREE.InstancedMesh(bodyG.build(), bodyMat, max);
    const clothes = [0xd0141c, 0xf2c200, 0x1d4fb8, 0x2a9d4a, 0xff6a00, 0xffffff, 0x8a2ad6, 0x0a7a3c, 0xff2d8a, 0x111111];
    let n = 0;
    for (const s of spots) {
      if (n >= max) break;
      const side = this.rng.chance(0.5) ? 1 : -1;
      const b = this.beside(s, side, this.rng.range(1.1, 3.2));
      if (b.y > 1.5 || this.bgrid.blocked(b.x, b.z, 0.3) || this.trackNear(b.x, b.z, 0.6)) continue;
      const h = Math.atan2(-b.rx * side, -b.rz * side) + this.rng.range(-0.5, 0.5);
      this.crowdBase.push({ x: b.x, y: 0, z: b.z, h, ph: this.rng.next() * 6.28, s: this.rng.range(0.92, 1.08) });
      im.setColorAt(n, new THREE.Color(clothes[this.rng.int(0, clothes.length - 1)]));
      n++;
    }
    im.count = n; this.crowdBody.count = n;
    this.crowd = im;
    this.updateCrowd(0);
    this.group.add(im, this.crowdBody);
  }

  updateCrowd(t: number) {
    if (!this.crowd || !this.crowdBody) return;
    this.crowdBase.forEach((p, i) => {
      const jump = Math.max(0, Math.sin(t * 6 + p.ph)) * 0.18;
      this.dummy.position.set(p.x, p.y + jump, p.z); this.dummy.rotation.set(0, p.h, 0); this.dummy.scale.setScalar(p.s); this.dummy.updateMatrix();
      this.crowd!.setMatrixAt(i, this.dummy.matrix);
      this.crowdBody!.setMatrixAt(i, this.dummy.matrix);
    });
    this.crowd.instanceMatrix.needsUpdate = true;
    this.crowdBody.instanceMatrix.needsUpdate = true;
  }

  /** Danfos and BRT buses waiting at the terminals. */
  private terminalBays() {
    for (const t of this.world.terminals) {
      const pts = t.pts;
      for (let i = 0; i < pts.length; i += 3) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 12) continue;
        const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
        const sgn = pointInPolygon((a[0] + b[0]) / 2 + nx, (a[1] + b[1]) / 2 + nz, pts) ? -1 : 1;
        for (let k = 0.2; k < 0.85; k += 0.22) {
          const x = a[0] + (b[0] - a[0]) * k - nx * sgn * 9, z = a[1] + (b[1] - a[1]) * k - nz * sgn * 9;
          if (this.trackNear(x, z, 2)) continue;
          const kind = this.rng.chance(0.7) ? 'danfo' : 'brt';
          const v = parkedVehicle(kind, kind === 'danfo' ? 0xf2b705 : this.rng.chance(0.5) ? 0xc81e1e : 0x1d4fb8);
          v.position.set(x, 0, z);
          v.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
          this.group.add(v);
        }
      }
    }
  }

  /** Night: lamps and billboard lights on. */
  setNight(night: number) {
    if (this.lightPools) (this.lightPools.material as THREE.MeshBasicMaterial).opacity = night * 0.55;
    if (this.lampHeads) (this.lampHeads.material as THREE.MeshBasicMaterial).color.setScalar(0.3 + night * 1.6).multiply(new THREE.Color(1, 0.9, 0.7));
    for (const m of this.billboardLights) m.emissiveIntensity = night * 0.55;
  }
}

export function shopSigns() { return shopSignAtlas(); }
