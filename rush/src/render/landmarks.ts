// The Oshodi Transport Interchange, modelled procedurally from the OSM footprints and studied from public photos:
// Terminal 3's blue glass under a deep steel space frame, Terminal 2's white perforated wedge, Terminal 1's louvred
// decks under steel arches, the cable-stayed skywalks on lattice pylons, older footbridges and the rail station.
import * as THREE from 'three';
import type { WorldData, WorldTerminal, WorldFootbridge } from '../shared/world';
import { pointInPolygon } from '../shared/math';
import { GeoBuilder, offsetPolyline } from './geom';
import type { Materials } from './materials';
import { minRect } from './worldView';
import { canvas, tex } from './textures';

/** blocked: is a column of this radius, standing from the ground up to `top`, in the way of any race route? */
export interface LandmarkOptions { detail: 0 | 1 | 2; shadows: boolean; blocked?: (x: number, z: number, r: number, top: number) => boolean }

/** Grow or shrink a closed footprint by d metres, whatever its winding. */
function grow(pts: number[][], d: number) {
  const a = offsetPolyline(pts, d, true), b = offsetPolyline(pts, -d, true);
  const area = (p: number[][]) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(s); };
  return (area(a) > area(b)) === d > 0 ? a : b;
}

function signTexture(text: string, bg: string, fg: string, w = 1024, h = 192) {
  const c = canvas(w, h), g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `700 ${h * 0.68}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h * 0.54);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  return tex(c, { repeat: false });
}

function flagTexture() {
  const c = canvas(240, 120), g = c.getContext('2d')!;
  g.fillStyle = '#008751'; g.fillRect(0, 0, 80, 120); g.fillStyle = '#ffffff'; g.fillRect(80, 0, 80, 120); g.fillStyle = '#008751'; g.fillRect(160, 0, 80, 120);
  return tex(c, { repeat: false });
}

export class Landmarks {
  group = new THREE.Group();
  flags: THREE.Mesh[] = [];
  private steel = new GeoBuilder();
  private steelLight = new GeoBuilder();
  private glass = new GeoBuilder();
  private perf = new GeoBuilder();
  private louv = new GeoBuilder();
  private conc = new GeoBuilder();
  private roof = new GeoBuilder();
  private dark = new GeoBuilder();
  private cable = new GeoBuilder();
  private mats: Materials;

  constructor(world: WorldData, mats: Materials, private opts: LandmarkOptions) {
    this.mats = mats;
    this.group.name = 'landmarks';
    for (const t of world.terminals) {
      if (/3/.test(t.name)) this.terminal3(t);
      else if (/2/.test(t.name)) this.terminal2(t);
      else this.terminal1(t);
    }
    for (const f of world.footbridges) {
      if (f.layer >= 3) this.skywalk(f);
      else if (Math.hypot(f.pts[0][0], f.pts[0][1]) < 400) this.footbridge(f);
    }
    this.station(world);
    const add = (g: GeoBuilder, m: THREE.Material, cast = true) => {
      if (!g.count) return;
      const mesh = new THREE.Mesh(g.build(), m);
      mesh.castShadow = cast && opts.shadows; mesh.receiveShadow = opts.shadows;
      this.group.add(mesh);
    };
    add(this.steel, mats.steel); add(this.steelLight, mats.steelLight); add(this.glass, mats.glassT3); add(this.perf, mats.perforated);
    add(this.louv, mats.louvres); add(this.conc, mats.concrete); add(this.roof, mats.whiteRoof); add(this.dark, mats.vertexLit, false);
    add(this.cable, mats.steel, false);
  }

  // ------------------------------------------------------------------------------------------- shared parts

  /** Vertical walls around a footprint between two heights; height can vary along the building's main axis. */
  private walls(g: GeoBuilder, pts: number[][], y0: number | ((x: number, z: number) => number), y1: number | ((x: number, z: number) => number), uvScale = 0.1) {
    const Y0 = typeof y0 === 'number' ? () => y0 : y0, Y1 = typeof y1 === 'number' ? () => y1 : y1;
    let u = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.05) continue;
      let nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      if (pointInPolygon((a[0] + b[0]) / 2 + nx * 0.3, (a[1] + b[1]) / 2 + nz * 0.3, pts)) { nx = -nx; nz = -nz; }
      const ya0 = Y0(a[0], a[1]), yb0 = Y0(b[0], b[1]), ya1 = Y1(a[0], a[1]), yb1 = Y1(b[0], b[1]);
      g.quad([a[0], ya0, a[1]], [b[0], yb0, b[1]], [b[0], yb1, b[1]], [a[0], ya1, a[1]], [[u * uvScale, ya0 * uvScale], [(u + len) * uvScale, yb0 * uvScale], [(u + len) * uvScale, yb1 * uvScale], [u * uvScale, ya1 * uvScale]], [nx, 0, nz]);
      u += len;
    }
  }

  /** Flat (or sloped) cap over a footprint. */
  private cap(g: GeoBuilder, pts: number[][], y: number | ((x: number, z: number) => number), up = true, uvScale = 0.08) {
    const Y = typeof y === 'number' ? () => y : y;
    const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const t of tris) {
      const P = t.map((i) => [pts[i][0], Y(pts[i][0], pts[i][1]), pts[i][1]]);
      g.tri(P[0], P[1], P[2], P.map((p) => [p[0] * uvScale, p[2] * uvScale]), [0, up ? 1 : -1, 0]);
    }
  }

  /** Two-layer steel space frame filling a footprint, with a roof skin on top and a deep truss around the edge. */
  private spaceFrame(pts: number[][], axis: number, yTop: (x: number, z: number) => number, depth: number) {
    const spacing = this.opts.detail >= 2 ? 4.5 : this.opts.detail === 1 ? 6 : 9;
    const ux = Math.cos(axis), uz = Math.sin(axis), vx = -uz, vz = ux;
    let mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity;
    for (const p of pts) { const u = p[0] * ux + p[1] * uz, v = p[0] * vx + p[1] * vz; mnu = Math.min(mnu, u); mxu = Math.max(mxu, u); mnv = Math.min(mnv, v); mxv = Math.max(mxv, v); }
    const nu = Math.ceil((mxu - mnu) / spacing), nv = Math.ceil((mxv - mnv) / spacing);
    const P = (i: number, j: number) => { const u = mnu + i * spacing, v = mnv + j * spacing; return [u * ux + v * vx, u * uz + v * vz]; };
    const inner = grow(pts, -1.5);
    const top: (number[] | null)[][] = [], bot: (number[] | null)[][] = [];
    for (let i = 0; i <= nu; i++) { top.push([]); bot.push([]); for (let j = 0; j <= nv; j++) {
      const t = P(i, j); top[i].push(pointInPolygon(t[0], t[1], pts) ? [t[0], yTop(t[0], t[1]), t[1]] : null);
      const b = P(i + 0.5, j + 0.5); bot[i].push(pointInPolygon(b[0], b[1], inner) ? [b[0], yTop(b[0], b[1]) - depth, b[1]] : null);
    } }
    const th = 0.16;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const t = top[i][j];
      if (t && i < nu && top[i + 1][j]) this.steel.strut(t, top[i + 1][j]!, th);
      if (t && j < nv && top[i][j + 1]) this.steel.strut(t, top[i][j + 1]!, th);
      const b = bot[i][j];
      if (!b) continue;
      if (i < nu && bot[i + 1][j]) this.steel.strut(b, bot[i + 1][j]!, th);
      if (j < nv && bot[i][j + 1]) this.steel.strut(b, bot[i][j + 1]!, th);
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const tt = top[i + di]?.[j + dj]; if (tt) this.steel.strut(b, tt, th * 0.8); }
    }
    // roof skin
    this.cap(this.roof, pts, (x, z) => yTop(x, z) + 0.25, true, 0.05);
    // edge truss band: chords top and bottom with diagonals, the dark frame you see in every photo
    const edge = pts;
    for (let i = 0; i < edge.length; i++) {
      const a = edge[i], b = edge[(i + 1) % edge.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.round(len / 3));
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps, t1 = (k + 1) / steps;
        const x0 = a[0] + (b[0] - a[0]) * t0, z0 = a[1] + (b[1] - a[1]) * t0, x1 = a[0] + (b[0] - a[0]) * t1, z1 = a[1] + (b[1] - a[1]) * t1;
        const T0 = [x0, yTop(x0, z0) + 0.3, z0], T1 = [x1, yTop(x1, z1) + 0.3, z1];
        const B0 = [x0, yTop(x0, z0) - depth - 0.8, z0], B1 = [x1, yTop(x1, z1) - depth - 0.8, z1];
        this.steel.strut(T0, T1, 0.28); this.steel.strut(B0, B1, 0.28); this.steel.strut(B0, T0, 0.2);
        this.steel.strut(k % 2 ? B0 : T0, k % 2 ? T1 : B1, 0.16);
      }
    }
  }

  private blocked(x: number, z: number, r: number, top: number) { return this.opts.blocked?.(x, z, r + 0.6, top) ?? false; }

  /** Square lattice column from the ground to y, X-braced. Left out where it would stand in a race route. */
  private latticeColumn(x: number, z: number, y: number, w: number, rot = 0) {
    if (this.blocked(x, z, w * 0.72, y)) return;
    const c = Math.cos(rot), s = Math.sin(rot);
    const corner = (i: number, yy: number) => { const lx = (i === 0 || i === 3 ? -1 : 1) * w / 2, lz = (i < 2 ? -1 : 1) * w / 2; return [x + lx * c + lz * s, yy, z - lx * s + lz * c]; };
    for (let i = 0; i < 4; i++) this.steel.strut(corner(i, 0), corner(i, y), 0.22);
    const step = w * 1.4;
    for (let yy = 0; yy < y - 0.1; yy += step) {
      const y2 = Math.min(y, yy + step);
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.steel.strut(corner(i, yy), corner(j, y2), 0.1); this.steel.strut(corner(j, yy), corner(i, y2), 0.1); this.steel.strut(corner(i, y2), corner(j, y2), 0.12); }
    }
  }

  private sign(text: string, x: number, y: number, z: number, faceAngle: number, w: number, h: number) {
    const mat = new THREE.MeshStandardMaterial({ map: signTexture(text, '#f6c514', '#111111'), roughness: 0.5, emissive: new THREE.Color(0x2a2000), emissiveIntensity: 1 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.35), [this.mats.steel, this.mats.steel, this.mats.steel, this.mats.steel, mat, this.mats.steel]);
    m.position.set(x, y, z); m.rotation.y = faceAngle;
    m.castShadow = this.opts.shadows;
    this.group.add(m);
  }

  private flagpoles(x: number, z: number, dirAngle: number, count: number) {
    const mat = new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.8 });
    for (let i = 0; i < count; i++) {
      const px = x + Math.cos(dirAngle) * i * 3.2, pz = z + Math.sin(dirAngle) * i * 3.2;
      this.steelLight.cylinder(px, 0, pz, 0.08, 11, 8, true, 0.05);
      const geo = new THREE.PlaneGeometry(3, 1.5, 12, 4);
      geo.translate(1.5, 0, 0);
      const flag = new THREE.Mesh(geo, mat);
      flag.position.set(px, 10.1, pz);
      flag.rotation.y = dirAngle + 0.4;
      flag.userData.phase = i * 1.3;
      this.flags.push(flag);
      this.group.add(flag);
    }
  }

  /** Ripple the flags in the breeze. */
  update(t: number) {
    for (const f of this.flags) {
      const pos = (f.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, Math.sin(x * 1.6 - t * 5 + f.userData.phase) * 0.18 * (x / 3)); }
      pos.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------------------------------- the three terminals

  private terminal3(t: WorldTerminal) {
    const pts = t.pts;
    const r = minRect(pts);
    const body = grow(pts, -3);
    const ground = grow(pts, -7);
    // dark recessed ground floor with columns, then four decks of blue glass
    this.walls(this.dark.setColor([0.12, 0.13, 0.15]), ground, 0, 5);
    for (const p of body) if (!this.blocked(p[0], p[1], 0.45, 5)) this.conc.cylinder(p[0], 0, p[1], 0.45, 5, 10, false);
    this.walls(this.glass, body, 5, 18, 1 / 12);
    this.cap(this.conc, body, 5, false);
    this.cap(this.dark.setColor([0.2, 0.21, 0.22]), body, 18, true);
    // white slab edges between decks
    for (const y of [5, 9.3, 13.6]) this.walls(this.steelLight, grow(body, 0.15), y, y + 0.35);
    // the giant canopy: flat top, deep frame, overhanging the glass by several metres
    const canopy = grow(pts, 3.5);
    this.spaceFrame(canopy, r.a, () => 24.5, 3.2);
    const colPts = grow(pts, 1.5);
    for (let i = 0; i < colPts.length; i += Math.max(1, Math.floor(colPts.length / 6))) this.latticeColumn(colPts[i][0], colPts[i][1], 20.5, 1.6, r.a);
    // sign on the long face toward Agege Motor Road, flags out front
    const face = this.longFace(body, t.centre, -1);
    this.sign('Terminal3', face.x, 16, face.z, face.ang, 13, 2.4);
    this.flagpoles(face.x + Math.cos(face.ang) * 14 + Math.sin(face.ang) * 4, face.z - Math.sin(face.ang) * 14 + Math.cos(face.ang) * 4, -face.ang, 3);
  }

  private terminal2(t: WorldTerminal) {
    const pts = t.pts;
    const r = minRect(pts);
    const ux = Math.cos(r.a), uz = Math.sin(r.a);
    // a wedge: rises from the rounded west end to the square east end, then a swooping canopy above it
    const us = pts.map((p) => p[0] * ux + p[1] * uz);
    const u0 = Math.min(...us), u1 = Math.max(...us);
    const roundEndHigh = this.roundEndIsMax(pts, ux, uz, u0, u1);
    const H = (x: number, z: number) => { let f = ((x * ux + z * uz) - u0) / (u1 - u0); if (!roundEndHigh) f = 1 - f; const s = f * f * (3 - 2 * f); return 9 + (1 - s) * 9; };
    const body = grow(pts, -2.5);
    this.walls(this.dark.setColor([0.14, 0.15, 0.16]), grow(pts, -6), 0, 4.5);
    for (const p of body) if (!this.blocked(p[0], p[1], 0.4, 4.5)) this.conc.cylinder(p[0], 0, p[1], 0.4, 4.5, 10, false);
    this.walls(this.perf, body, 4.5, H, 1 / 8);
    this.cap(this.conc, body, 4.5, false);
    this.cap(this.perf, body, H, true);
    this.walls(this.steelLight, grow(body, 0.15), 4.5, 4.9);
    const canopy = grow(pts, 2.8);
    this.spaceFrame(canopy, r.a, (x, z) => H(x, z) + 5.5, 2.6);
    const colPts = grow(pts, 1.2);
    for (let i = 0; i < colPts.length; i += Math.max(1, Math.floor(colPts.length / 5))) this.latticeColumn(colPts[i][0], colPts[i][1], H(colPts[i][0], colPts[i][1]) + 2.6, 1.4, r.a);
    const face = this.longFace(body, t.centre, 1);
    this.sign('Terminal 2', face.x, 7.2, face.z, face.ang, 11, 2.2);
  }

  private terminal1(t: WorldTerminal) {
    const pts = t.pts;
    const r = minRect(pts);
    const body = grow(pts, -2.5);
    // open ground floor on columns, dark louvred decks with white slab edges, steel arches carrying a white roof
    this.walls(this.dark.setColor([0.1, 0.11, 0.12]), grow(pts, -7), 0, 4.8);
    for (const p of body) this.conc.cylinder(p[0], 0, p[1], 0.45, 4.8, 10, false);
    this.walls(this.louv, body, 4.8, 17, 1 / 4);
    this.cap(this.conc, body, 4.8, false);
    this.cap(this.dark.setColor([0.25, 0.25, 0.26]), body, 17, true);
    for (const y of [4.8, 8.8, 12.8, 16.8]) this.walls(this.steelLight, grow(body, 0.25), y, y + 0.45);
    // arches across the short axis
    const ux = Math.cos(r.a), uz = Math.sin(r.a), vx = -uz, vz = ux;
    const L = r.l / 2 - 2, W = r.w / 2 + 1.5, rise = 7;
    const spacing = this.opts.detail >= 1 ? 7 : 12;
    const archPt = (u: number, s: number, y0: number) => { const v = -W + 2 * W * s; const y = y0 + Math.sin(s * Math.PI) * rise; return [r.cx + ux * u + vx * v, y, r.cz + uz * u + vz * v]; };
    for (let u = -L; u <= L + 0.01; u += spacing) {
      const segs = 14;
      for (let k = 0; k < segs; k++) {
        const s0 = k / segs, s1 = (k + 1) / segs;
        const a0 = archPt(u, s0, 17), a1 = archPt(u, s1, 17), b0 = archPt(u, s0, 15.6), b1 = archPt(u, s1, 15.6);
        this.steel.strut(a0, a1, 0.3); this.steel.strut(b0, b1, 0.3); this.steel.strut(k % 2 ? a0 : b0, k % 2 ? b1 : a1, 0.14);
      }
      // feet down to the ground on both sides
      for (const s of [0, 1]) { const f = archPt(u, s, 15.6); this.steel.strut([f[0], 0, f[2]], f, 0.45); }
    }
    // curved roof sheet over the arches
    const segs = 18;
    for (let k = 0; k < segs; k++) {
      const s0 = k / segs, s1 = (k + 1) / segs;
      const a = archPt(-L - 3, s0, 17.2), b = archPt(L + 3, s0, 17.2), c = archPt(L + 3, s1, 17.2), d = archPt(-L - 3, s1, 17.2);
      this.roof.quad(a, b, c, d, [[0, s0], [1, s0], [1, s1], [0, s1]], [0, 1, 0]);
    }
    // white service block beside it
    const sx = r.cx + vx * (W + 9), sz = r.cz + vz * (W + 9);
    this.steelLight.box(sx, 0, sz, 14, 9, 9, Math.atan2(ux, uz));
    const face = this.longFace(body, t.centre, 1);
    this.sign('Terminal 1', face.x, 7.5, face.z, face.ang, 11, 2.2);
  }

  private roundEndIsMax(pts: number[][], ux: number, uz: number, u0: number, u1: number) {
    // the rounded end has more vertices; check which end of the axis they cluster at
    let lo = 0, hi = 0;
    for (const p of pts) { const u = p[0] * ux + p[1] * uz; if (u < u0 + (u1 - u0) * 0.25) lo++; if (u > u1 - (u1 - u0) * 0.25) hi++; }
    return hi > lo;
  }

  /** Midpoint and outward angle of the longest straight face, preferring the side toward `pref` x. */
  private longFace(pts: number[][], centre: [number, number], pref: number) {
    let best = { len: 0, x: 0, z: 0, ang: 0, score: -Infinity };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      let nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      if ((mx - centre[0]) * nx + (mz - centre[1]) * nz < 0) { nx = -nx; nz = -nz; }
      const score = len + pref * nx * 10;
      if (score > best.score) best = { len, x: mx + nx * 0.6, z: mz + nz * 0.6, ang: Math.atan2(nx, nz), score };
    }
    return best;
  }

  // ------------------------------------------------------------------------------------------- bridges for people

  /** Cable-stayed skywalk: a covered steel truss walkway hung from tall X-braced lattice pylons. */
  private skywalk(f: WorldFootbridge) {
    const deck = 14;
    const pts = f.pts;
    const W = 3.6, H = 2.8;
    let along = 0;
    const total = pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
    const pylonEvery = Math.max(45, total / Math.max(1, Math.round(total / 60)));
    let nextPylon = Math.min(total / 2, pylonEvery * 0.5);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len, nx = -tz, nz = tx;
      const steps = Math.max(1, Math.round(len / 3));
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps, t1 = (k + 1) / steps;
        const x0 = a[0] + (b[0] - a[0]) * t0, z0 = a[1] + (b[1] - a[1]) * t0, x1 = a[0] + (b[0] - a[0]) * t1, z1 = a[1] + (b[1] - a[1]) * t1;
        for (const sd of [-1, 1]) {
          const ox = nx * W / 2 * sd, oz = nz * W / 2 * sd;
          const B0 = [x0 + ox, deck, z0 + oz], B1 = [x1 + ox, deck, z1 + oz], T0 = [x0 + ox, deck + H, z0 + oz], T1 = [x1 + ox, deck + H, z1 + oz];
          this.steel.strut(B0, B1, 0.22); this.steel.strut(T0, T1, 0.2); this.steel.strut(B0, T0, 0.14); this.steel.strut(k % 2 ? B0 : T0, k % 2 ? T1 : B1, 0.1);
        }
        // floor and the white curved roof
        this.conc.quad([x0 - nx * W / 2, deck + 0.05, z0 - nz * W / 2], [x0 + nx * W / 2, deck + 0.05, z0 + nz * W / 2], [x1 + nx * W / 2, deck + 0.05, z1 + nz * W / 2], [x1 - nx * W / 2, deck + 0.05, z1 - nz * W / 2], undefined, [0, 1, 0]);
        this.conc.quad([x0 - nx * W / 2, deck - 0.3, z0 - nz * W / 2], [x0 + nx * W / 2, deck - 0.3, z0 + nz * W / 2], [x1 + nx * W / 2, deck - 0.3, z1 + nz * W / 2], [x1 - nx * W / 2, deck - 0.3, z1 - nz * W / 2], undefined, [0, -1, 0]);
        const arc = 6;
        for (let j = 0; j < arc; j++) {
          const s0 = j / arc, s1 = (j + 1) / arc;
          const off = (s: number) => [-W / 2 - 0.3 + (W + 0.6) * s, deck + H + 0.2 + Math.sin(s * Math.PI) * 0.7];
          const [o0, y0] = off(s0), [o1, y1] = off(s1);
          this.roof.quad([x0 + nx * o0, y0, z0 + nz * o0], [x0 + nx * o1, y1, z0 + nz * o1], [x1 + nx * o1, y1, z1 + nz * o1], [x1 + nx * o0, y0, z1 + nz * o0], undefined, [0, 1, 0]);
        }
        along += len / steps;
        if (along >= nextPylon) {
          // both legs must stand clear of every race route; slide along the walkway to find room
          const legsClear = (o: number) => [-1, 1].every((sd) => !this.blocked(x1 + tx * o + nx * 3.2 * sd, z1 + tz * o + nz * 3.2 * sd, 1.1, deck + 22));
          const o = [0, 6, -6, 12, -12, 18, -18, 24, -24].find(legsClear);
          if (o !== undefined) this.pylon(x1 + tx * o, z1 + tz * o, tx, tz, deck, H);
          nextPylon += pylonEvery;
        }
      }
    }
  }

  private pylon(x: number, z: number, tx: number, tz: number, deck: number, H: number) {
    const top = deck + 22;
    // tower legs straddle the walkway
    const nx = -tz, nz = tx;
    for (const sd of [-1, 1]) this.latticeColumn(x + nx * 3.2 * sd, z + nz * 3.2 * sd, top, 1.5, Math.atan2(tx, tz));
    this.steel.strut([x - nx * 3.2, top, z - nz * 3.2], [x + nx * 3.2, top, z + nz * 3.2], 0.5);
    this.steel.strut([x - nx * 3.2, deck + H + 2, z - nz * 3.2], [x + nx * 3.2, deck + H + 2, z + nz * 3.2], 0.4);
    // fan of stay cables to the deck edges, fore and aft
    for (const sd of [-1, 1]) for (const dir of [-1, 1]) for (const d of [10, 17, 24, 31]) {
      const ax = x + nx * 3.2 * sd, az = z + nz * 3.2 * sd;
      const bx = x + tx * d * dir + nx * 1.9 * sd, bz = z + tz * d * dir + nz * 1.9 * sd;
      this.cable.strut([ax, top - 1 - d * 0.05, az], [bx, deck + 0.2, bz], 0.07);
    }
  }

  /** Older overhead pedestrian bridges: a concrete deck on two piers with brown steel railings. */
  private footbridge(f: WorldFootbridge) {
    const deck = 7.2, W = 2.6;
    const pts = f.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len, nx = -tz, nz = tx;
      const ang = Math.atan2(tx, tz);
      this.conc.box((a[0] + b[0]) / 2, deck - 0.6, (a[1] + b[1]) / 2, W, 0.6, len, ang);
      for (const sd of [-1, 1]) {
        this.dark.setColor([0.35, 0.22, 0.14]);
        this.dark.box((a[0] + b[0]) / 2 + nx * (W / 2 - 0.05) * sd, deck, (a[1] + b[1]) / 2 + nz * (W / 2 - 0.05) * sd, 0.08, 1.1, len, ang);
      }
      if (!this.blocked(a[0], a[1], 0.4, deck)) this.conc.cylinder(a[0], 0, a[1], 0.4, deck - 0.6, 10, false);
    }
    const e = pts[pts.length - 1];
    if (!this.blocked(e[0], e[1], 0.4, deck)) this.conc.cylinder(e[0], 0, e[1], 0.4, deck - 0.6, 10, false);
  }

  /** Rail station beside the line, on the Terminal 3 side: platform, canopy, a glazed concourse and the sign. */
  private station(world: WorldData) {
    const rail = world.rails.find((r) => r.id === 919669869) ?? world.rails[0];
    if (!rail) return;
    let best = { i: 0, d: Infinity };
    rail.pts.forEach((p, i) => { const d = Math.hypot(p[0] - 112, p[1] + 70); if (d < best.d && i < rail.pts.length - 1) best = { i, d }; });
    const a = rail.pts[best.i], b = rail.pts[best.i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
    let nx = -tz, nz = tx;
    if (nx < 0) { nx = -nx; nz = -nz; } // east of the line, away from Agege Motor Road
    const t = Math.max(0, Math.min(len, (112 - a[0]) * tx + (-70 - a[1]) * tz));
    const rx = a[0] + tx * t, rz = a[1] + tz * t;
    const ang = Math.atan2(tx, tz);
    const px = rx + nx * 5.5, pz = rz + nz * 5.5;
    this.conc.box(px, 0, pz, 6, 1.1, 80, ang);                           // platform
    for (let k = -36; k <= 36; k += 8) this.steel.strut([px + tx * k + nx * 1.5, 1.1, pz + tz * k + nz * 1.5], [px + tx * k + nx * 1.5, 6.2, pz + tz * k + nz * 1.5], 0.24);
    this.roof.box(px + nx * 0.5, 6.2, pz + nz * 0.5, 7.5, 0.25, 82, ang);  // canopy
    const cx = px + nx * 9, cz = pz + nz * 9;
    // concourse: glazed band over a white base, under a deep white fascia
    const W = 8, D = 30;
    const corners = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]].map(([u, v]) => [cx + nx * u + tx * v, cz + nz * u + tz * v]);
    this.walls(this.steelLight, corners, 0, 2.8);
    this.walls(this.glass, corners, 2.8, 6.8, 1 / 12);
    this.walls(this.steelLight, grow(corners, 0.4), 6.8, 8.6);
    this.cap(this.roof, grow(corners, 0.4), 8.6, true);
    this.sign('OSHODI STATION', cx - nx * (W / 2 + 0.75), 7.7, cz - nz * (W / 2 + 0.75), Math.atan2(-nx, -nz), 14, 1.6);
  }
}
