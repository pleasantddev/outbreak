// The race laid over the city: a fresh asphalt corridor with painted lines, black and white concrete barriers (blue
// mesh railings up on the flyovers), the start gantry with its lights, BRT lane boost strips, plank kickers and the
// floating Ghana Must Go bags.
import * as THREE from 'three';
import type { Track } from '../shared/track';
import { GeoBuilder } from './geom';
import type { Materials } from './materials';
import { canvas, tex } from './textures';
import { Rng } from '../shared/rng';

export interface TrackViewOptions { shadows: boolean; detail: 0 | 1 | 2 }

function checker(n = 16) {
  const c = canvas(256, 64), g = c.getContext('2d')!;
  for (let y = 0; y < 4; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? '#101010' : '#f4f4f0'; g.fillRect((x * 256) / n, y * 16, 256 / n + 1, 16); }
  return tex(c, { repeat: false });
}

function plaidTexture() {
  // the woven red, blue and white check of a Ghana Must Go bag
  const c = canvas(256), g = c.getContext('2d')!;
  g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 256, 256);
  const bands: [string, number, number][] = [['#c21e2a', 0, 34], ['#1e3fa8', 60, 22], ['#c21e2a', 118, 34], ['#1e3fa8', 178, 22], ['#c21e2a', 226, 18]];
  g.globalAlpha = 0.85;
  for (const [col, at, w] of bands) { g.fillStyle = col; g.fillRect(at, 0, w, 256); g.fillRect(0, at, 256, w); }
  g.globalAlpha = 0.25; g.fillStyle = '#000';
  for (let i = 0; i < 256; i += 4) { g.fillRect(i, 0, 1, 256); g.fillRect(0, i + 2, 256, 1); }
  g.globalAlpha = 1;
  return tex(c, { repeat: true });
}

function bannerTexture(text: string, bg: string, fg: string, sub = '') {
  const c = canvas(1024, 160), g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 160);
  g.fillStyle = fg; g.font = '800 104px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, sub ? 66 : 86);
  if (sub) { g.font = '600 34px "Barlow Condensed", sans-serif'; g.fillText(sub, 512, 132); }
  return tex(c, { repeat: false });
}

function brtTexture() {
  const c = canvas(128, 512), g = c.getContext('2d')!;
  g.fillStyle = '#b3242c'; g.fillRect(0, 0, 128, 512);
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.font = '800 54px "Barlow Condensed", sans-serif'; g.textAlign = 'center';
  g.save(); g.translate(64, 150); g.fillText('BRT', 0, 0); g.restore();
  g.beginPath(); g.moveTo(64, 260); g.lineTo(104, 330); g.lineTo(78, 330); g.lineTo(78, 420); g.lineTo(50, 420); g.lineTo(50, 330); g.lineTo(24, 330); g.closePath(); g.fill();
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 8, 512); g.fillRect(120, 0, 8, 512);
  return tex(c, { repeat: true });
}

export class TrackView {
  group = new THREE.Group();
  bags: THREE.InstancedMesh | null = null;
  bagPos: THREE.Vector3[] = [];
  startLights: THREE.Mesh[] = [];
  private lightOn = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false });
  private lightGo = new THREE.MeshBasicMaterial({ color: 0x20ff60, toneMapped: false });
  private lightOff = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 });
  private dummy = new THREE.Object3D();
  private brtMat: THREE.MeshStandardMaterial;

  constructor(public track: Track, private mats: Materials, private opts: TrackViewOptions) {
    this.group.name = 'track';
    this.brtMat = new THREE.MeshStandardMaterial({ map: brtTexture(), roughness: 0.6, emissive: new THREE.Color(0x400808), emissiveIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -10 });
    this.surface();
    this.barriers();
    this.gantry();
    this.ramps();
    this.brtStrips();
    this.pickups();
  }

  private surface() {
    const g = new GeoBuilder({ lane: 4 });
    const pads = new GeoBuilder({ lane: 4 });
    this.track.paths.forEach((c, pi) => {
      const segs = c.closed ? c.n : c.n - 1;
      const k = pi === 0 ? this.track.curvature : null;
      const edge = (i: number) => {
        const rx = -c.tz[i], rz = c.tx[i];
        let inL = c.hw[i], inR = c.hw[i];
        if (k) { const kk = k[i]; if (Math.abs(kk) > 1e-3) { const lim = 0.92 / Math.abs(kk); if (kk > 0) inR = Math.min(inR, lim); else inL = Math.min(inL, lim); } }
        const tb = Math.tan(c.bank[i]);
        const y = c.y[i] + 0.07;
        return { L: [c.x[i] - rx * inL, y - tb * inL, c.z[i] - rz * inL], R: [c.x[i] + rx * inR, y + tb * inR, c.z[i] + rz * inR], inL, inR };
      };
      let prev = edge(0);
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % c.n;
        const cur = edge(j);
        const s0 = c.s[i], s1 = c.s[i + 1];
        const base = g.count;
        g.set('lane', -prev.inL, c.hw[i], s0, 1).vertex(prev.L[0], prev.L[1], prev.L[2], 0, 1, 0, 0, s0);
        g.set('lane', prev.inR, c.hw[i], s0, 1).vertex(prev.R[0], prev.R[1], prev.R[2], 0, 1, 0, 1, s0);
        g.set('lane', cur.inR, c.hw[j], s1, 1).vertex(cur.R[0], cur.R[1], cur.R[2], 0, 1, 0, 1, s1);
        g.set('lane', -cur.inL, c.hw[j], s1, 1).vertex(cur.L[0], cur.L[1], cur.L[2], 0, 1, 0, 0, s1);
        g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        prev = cur;
      }
      // hairpins: the inner edge was pulled in to stop the strip folding over itself, so fill the apex with a pad
      if (k) {
        let i = 0;
        while (i < c.n) {
          if (Math.abs(k[i]) * c.hw[i] <= 0.92) { i++; continue; }
          let j = i, peak = i;
          while (j < c.n && Math.abs(k[j]) * c.hw[j] > 0.92) { if (Math.abs(k[j]) > Math.abs(k[peak])) peak = j; j++; }
          const kk = k[peak], R = 1 / Math.abs(kk), sgn = Math.sign(kk);
          const cx = c.x[peak] + -c.tz[peak] * R * sgn, cz = c.z[peak] + c.tx[peak] * R * sgn;
          const rad = c.hw[peak] - R + 2.5;
          const y = c.y[peak] + 0.065;
          const n = 28;
          const center = pads.set('lane', 0, 99, 0, 0).vertex(cx, y, cz, 0, 1, 0, 0.5, 0.5);
          for (let a = 0; a <= n; a++) { const ang = (a / n) * Math.PI * 2; pads.set('lane', 0, 99, 0, 0).vertex(cx + Math.cos(ang) * rad, y, cz + Math.sin(ang) * rad, 0, 1, 0, 0, 0); }
          for (let a = 0; a < n; a++) pads.idx.push(center, center + a + 2, center + a + 1);
          i = j;
        }
      }
    });
    const m = new THREE.Mesh(g.build(), this.mats.track);
    m.receiveShadow = this.opts.shadows; m.name = 'trackSurface';
    this.group.add(m);
    if (pads.count) { const pm = new THREE.Mesh(pads.build(), this.mats.track); pm.receiveShadow = this.opts.shadows; this.group.add(pm); }
  }

  /** Barrier along both edges. Flyovers get the parapet and blue railing, the ground gets striped jersey blocks. */
  private barriers() {
    const jersey = new GeoBuilder(), parapet = new GeoBuilder(), rail = new GeoBuilder(), posts = new GeoBuilder();
    const tr = this.track;
    tr.paths.forEach((c, pi) => {
      const segs = c.closed ? c.n : c.n - 1;
      for (const side of [-1, 1]) {
        let u = 0;
        for (let i = 0; i < segs; i++) {
          const j = (i + 1) % c.n;
          const off = (k: number) => c.hw[k] + 0.35;
          const P = (k: number, d: number, up: number) => {
            const rx = -c.tz[k], rz = c.tx[k];
            return [c.x[k] + rx * d * side, c.y[k] + Math.tan(c.bank[k]) * d * side + up, c.z[k] + rz * d * side];
          };
          const a = P(i, off(i), 0), b = P(j, off(j), 0);
          const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
          u += len;
          // leave a gap where this edge runs into another corridor (shortcut mouths, the hairpin apex)
          const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2;
          const q = tr.query(mx, (a[1] + b[1]) / 2, mz, { path: pi, i });
          if (q.outside < -0.2 && (q.path !== pi || Math.abs(q.i - i) > 6)) continue;
          if (pi === 0 && Math.abs(tr.curvature[i]) * c.hw[i] > 0.92 && Math.sign(tr.curvature[i]) === side) continue;
          const elevated = c.y[i] > 2.2 || c.y[j] > 2.2;
          const T = (p: number[], d: number, h: number, k: number) => { const rx = -c.tz[k], rz = c.tx[k]; return [p[0] + rx * d * side, p[1] + h, p[2] + rz * d * side]; };
          if (elevated) {
            const A2 = T(a, 0.32, 0, i), B2 = T(b, 0.32, 0, j);
            parapet.quad(a, b, [b[0], b[1] + 1.0, b[2]], [a[0], a[1] + 1.0, a[2]], [[u / 4, 0], [(u + len) / 4, 0], [(u + len) / 4, 0.25], [u / 4, 0.25]]);
            parapet.quad([a[0], a[1] + 1.0, a[2]], [b[0], b[1] + 1.0, b[2]], [B2[0], B2[1] + 1.0, B2[2]], [A2[0], A2[1] + 1.0, A2[2]], undefined, [0, 1, 0]);
            parapet.quad(A2, B2, [B2[0], B2[1] + 1.0, B2[2]], [A2[0], A2[1] + 1.0, A2[2]]);
            parapet.quad([A2[0], A2[1] - 1.2, A2[2]], [B2[0], B2[1] - 1.2, B2[2]], B2, A2);
            rail.quad([A2[0], A2[1] + 1.0, A2[2]], [B2[0], B2[1] + 1.0, B2[2]], [B2[0], B2[1] + 2.05, B2[2]], [A2[0], A2[1] + 2.05, A2[2]], [[u / 2.5, 0], [(u + len) / 2.5, 0], [(u + len) / 2.5, 1], [u / 2.5, 1]]);
          } else {
            // jersey profile: wide foot, sloped face, narrow top, painted in two metre black and white blocks
            const prof: [number, number][] = [[0, 0], [0.05, 0.28], [0.18, 0.82], [0.32, 0.82], [0.45, 0.28], [0.5, 0]];
            const uv0 = u / 4, uv1 = (u + len) / 4;
            for (let k = 0; k < prof.length - 1; k++) {
              const [d0, h0] = prof[k], [d1, h1] = prof[k + 1];
              jersey.quad(T(a, d0 - 0.15, h0, i), T(b, d0 - 0.15, h0, j), T(b, d1 - 0.15, h1, j), T(a, d1 - 0.15, h1, i), [[uv0, 0], [uv1, 0], [uv1, 1], [uv0, 1]]);
            }
          }
        }
      }
    });
    // occasional lamp posts along the barrier line on the ground sections
    const rng = new Rng(7);
    const c = tr.paths[0];
    for (let i = 0; i < c.n; i += 18) {
      if (c.y[i] > 2) continue;
      const side = rng.chance(0.5) ? 1 : -1;
      const rx = -c.tz[i], rz = c.tx[i];
      const x = c.x[i] + rx * (c.hw[i] + 1.4) * side, z = c.z[i] + rz * (c.hw[i] + 1.4) * side;
      posts.setColor([0.22, 0.24, 0.26]);
      posts.cylinder(x, 0, z, 0.12, 9, 8, true, 0.08);
      posts.box(x - rx * side * 1.2, 8.9, z - rz * side * 1.2, 0.18, 0.12, 2.6, Math.atan2(rx, rz) + Math.PI / 2);
      posts.setColor([1.6, 1.4, 1.0]);
      posts.box(x - rx * side * 2.3, 8.75, z - rz * side * 2.3, 0.5, 0.12, 0.28, Math.atan2(rx, rz) + Math.PI / 2);
    }
    const add = (g: GeoBuilder, m: THREE.Material) => { if (!g.count) return; const mesh = new THREE.Mesh(g.build(), m); mesh.castShadow = this.opts.shadows; mesh.receiveShadow = this.opts.shadows; this.group.add(mesh); };
    add(jersey, this.mats.kerb); add(parapet, this.mats.concrete); add(rail, this.mats.meshRail); add(posts, this.mats.vertexLit);
  }

  private gantry() {
    const tr = this.track;
    const p = tr.pointAt(0, 0);
    const hw = p.hw;
    const steel = new GeoBuilder();
    const ang = Math.atan2(p.tx, p.tz);
    const rx = p.rx, rz = p.rz;
    const H = 7.5;
    for (const sd of [-1, 1]) {
      const x = p.x + rx * (hw + 1.4) * sd, z = p.z + rz * (hw + 1.4) * sd;
      for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) steel.strut([x + ox, p.y, z + oz], [x + ox, p.y + H + 1.6, z + oz], 0.16);
      for (let y = 0; y < H; y += 1.2) steel.strut([x - 0.5, p.y + y, z - 0.5], [x + 0.5, p.y + y + 1.2, z + 0.5], 0.08);
    }
    // truss beam
    const A = [p.x - rx * (hw + 1.4), p.y + H, p.z - rz * (hw + 1.4)], B = [p.x + rx * (hw + 1.4), p.y + H, p.z + rz * (hw + 1.4)];
    for (const dy of [0, 1.4]) for (const dz of [-0.5, 0.5]) steel.strut([A[0] + p.tx * dz, A[1] + dy, A[2] + p.tz * dz], [B[0] + p.tx * dz, B[1] + dy, B[2] + p.tz * dz], 0.14);
    const gm = new THREE.Mesh(steel.build(), this.mats.steel); gm.castShadow = this.opts.shadows;
    this.group.add(gm);
    // banner on both faces: two single sided planes back to back, so the text reads correctly from either side
    const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTexture('LAGOS RUSH', '#f6c514', '#111111', 'OSHODI STREET RACING'), roughness: 0.6, emissive: new THREE.Color(0x221a00) });
    for (const flip of [0, Math.PI]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 1.6, 1.3), bannerMat);
      banner.position.set(p.x, p.y + H + 0.7, p.z);
      banner.rotation.y = ang + Math.PI + flip;
      this.group.add(banner);
    }
    // start lights: five pods on the beam, facing the grid
    for (let k = 0; k < 5; k++) {
      const d = (k - 2) * 1.1;
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.25, 16), this.lightOff);
      pod.rotation.x = Math.PI / 2; pod.rotation.z = 0;
      pod.position.set(p.x + rx * d - p.tx * 0.7, p.y + H - 0.5, p.z + rz * d - p.tz * 0.7);
      pod.lookAt(pod.position.x - p.tx, pod.position.y, pod.position.z - p.tz);
      pod.rotateX(Math.PI / 2);
      this.startLights.push(pod);
      this.group.add(pod);
    }
    // checkered line and grid boxes
    const chk = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 1.8), new THREE.MeshStandardMaterial({ map: checker(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12 }));
    chk.rotation.x = -Math.PI / 2; chk.rotation.z = ang + Math.PI / 2;
    chk.position.set(p.x, p.y + 0.09, p.z);
    chk.receiveShadow = this.opts.shadows;
    this.group.add(chk);
    const marks = new GeoBuilder();
    marks.setColor([0.95, 0.95, 0.9]);
    for (const slot of tr.data.grid) {
      const fx = Math.sin(slot.h), fz = Math.cos(slot.h), sx = -Math.cos(slot.h), sz = Math.sin(slot.h);
      const front = [slot.x + fx * 2.6, slot.y + 0.1, slot.z + fz * 2.6];
      const l = (a: number[], dx: number, dz: number, w: number, len: number) => marks.quad([a[0] - dx * w, a[1], a[2] - dz * w], [a[0] + dx * w, a[1], a[2] + dz * w], [a[0] + dx * w + fx * -len, a[1], a[2] + dz * w + fz * -len], [a[0] - dx * w + fx * -len, a[1], a[2] - dz * w + fz * -len], undefined, [0, 1, 0]);
      l([front[0] + sx * 1.2, front[1], front[2] + sz * 1.2], sx, sz, 0.08, 1.4);
      l([front[0] - sx * 1.2, front[1], front[2] - sz * 1.2], sx, sz, 0.08, 1.4);
      marks.quad([front[0] - sx * 1.25, front[1], front[2] - sz * 1.25], [front[0] + sx * 1.25, front[1], front[2] + sz * 1.25], [front[0] + sx * 1.25 - fx * 0.16, front[1], front[2] + sz * 1.25 - fz * 0.16], [front[0] - sx * 1.25 - fx * 0.16, front[1], front[2] - sz * 1.25 - fz * 0.16], undefined, [0, 1, 0]);
    }
    const mm = new THREE.Mesh(marks.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12 }));
    this.group.add(mm);
  }

  /** Start lights: n red pods lit, then all green. */
  setLights(n: number, go: boolean) {
    this.startLights.forEach((l, i) => { l.material = go ? this.lightGo : i < n ? this.lightOn : this.lightOff; });
  }

  private ramps() {
    const tr = this.track;
    const planks = new GeoBuilder(), sides = new GeoBuilder();
    for (const r of tr.data.ramps) {
      const steps = 10;
      const d0 = r.d0, d1 = r.d1;
      for (let k = 0; k < steps; k++) {
        const s0 = r.s0 + ((r.s1 - r.s0) * k) / steps, s1 = r.s0 + ((r.s1 - r.s0) * (k + 1)) / steps;
        const hw0 = tr.hwAt(s0), hw1 = tr.hwAt(s1);
        const a0 = d0 ?? -hw0, a1 = d1 ?? hw0, b0 = d0 ?? -hw1, b1 = d1 ?? hw1;
        const pL0 = tr.pointAt(s0, a0 + 0.05), pR0 = tr.pointAt(s0, a1 - 0.05), pL1 = tr.pointAt(s1, b0 + 0.05), pR1 = tr.pointAt(s1, b1 - 0.05);
        const h0 = tr.rampHeight(s0, (a0 + a1) / 2).h, h1 = tr.rampHeight(s1, (b0 + b1) / 2).h;
        const base0 = pL0.y - tr.rampHeight(s0, a0 + 0.05).h, base1 = pL1.y - tr.rampHeight(s1, b0 + 0.05).h;
        planks.quad([pL0.x, base0 + h0 + 0.08, pL0.z], [pR0.x, base0 + h0 + 0.08, pR0.z], [pR1.x, base1 + h1 + 0.08, pR1.z], [pL1.x, base1 + h1 + 0.08, pL1.z], [[0, k], [1, k], [1, k + 1], [0, k + 1]], [0, 1, 0]);
        for (const [p0, p1] of [[pL0, pL1], [pR0, pR1]]) sides.quad([p0.x, base0, p0.z], [p1.x, base1, p1.z], [p1.x, base1 + h1 + 0.08, p1.z], [p0.x, base0 + h0 + 0.08, p0.z], [[s0 / 2, 0], [s1 / 2, 0], [s1 / 2, h1], [s0 / 2, h0]]);
      }
      // the lip face
      const sL = tr.pointAt(r.s1, (d0 ?? -tr.hwAt(r.s1)) + 0.05), sR = tr.pointAt(r.s1, (d1 ?? tr.hwAt(r.s1)) - 0.05);
      const hb = tr.rampHeight(r.s1 - 0.01, ((d0 ?? 0) + (d1 ?? 0)) / 2).h;
      const yb = sL.y - tr.rampHeight(r.s1, (d0 ?? -tr.hwAt(r.s1)) + 0.05).h;
      sides.quad([sL.x, yb, sL.z], [sR.x, yb, sR.z], [sR.x, yb + hb + 0.08, sR.z], [sL.x, yb + hb + 0.08, sL.z]);
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.8 });
    if (planks.count) this.group.add(Object.assign(new THREE.Mesh(planks.build(), wood), { castShadow: this.opts.shadows, receiveShadow: this.opts.shadows }));
    if (sides.count) this.group.add(Object.assign(new THREE.Mesh(sides.build(), this.mats.hazardStripe), { castShadow: this.opts.shadows }));
  }

  private brtStrips() {
    const tr = this.track;
    const g = new GeoBuilder();
    for (const b of tr.data.boosts) {
      const steps = Math.ceil(b.len / 4);
      for (let k = 0; k < steps; k++) {
        const s0 = b.s + (b.len * k) / steps, s1 = b.s + (b.len * (k + 1)) / steps;
        const a = tr.pointAt(s0, b.d - b.w / 2), c = tr.pointAt(s0, b.d + b.w / 2), d = tr.pointAt(s1, b.d + b.w / 2), e = tr.pointAt(s1, b.d - b.w / 2);
        g.quad([a.x, a.y + 0.1, a.z], [c.x, c.y + 0.1, c.z], [d.x, d.y + 0.1, d.z], [e.x, e.y + 0.1, e.z], [[0, s0 / 12], [1, s0 / 12], [1, s1 / 12], [0, s1 / 12]], [0, 1, 0]);
      }
    }
    if (g.count) { const m = new THREE.Mesh(g.build(), this.brtMat); m.receiveShadow = this.opts.shadows; this.group.add(m); }
  }

  private pickups() {
    const tr = this.track;
    const total = tr.data.pickups.reduce((a, r) => a + r.d.length, 0);
    if (!total) return;
    // a stuffed woven bag: a slightly rounded box with two strap handles
    const geo = new THREE.BoxGeometry(1.25, 0.85, 0.75, 4, 3, 3);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const bulge = 1 + 0.12 * (1 - (x * x) / 0.4) * (1 - (y * y) / 0.18); pos.setXYZ(i, x, y, z * bulge); }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: plaidTexture(), roughness: 0.55, emissive: new THREE.Color(0x221010), emissiveIntensity: 0.5 });
    this.bags = new THREE.InstancedMesh(geo, mat, total);
    this.bags.castShadow = this.opts.shadows;
    for (const row of tr.data.pickups) for (const d of row.d) { const p = tr.pointAt(row.s, d); this.bagPos.push(new THREE.Vector3(p.x, p.y + 1.1, p.z)); }
    this.group.add(this.bags);
    this.updateBags(0, () => true);
  }

  /** Bob and spin the bags; hide the ones picked up. */
  updateBags(t: number, visible: (i: number) => boolean) {
    if (!this.bags) return;
    for (let i = 0; i < this.bagPos.length; i++) {
      const p = this.bagPos[i];
      const on = visible(i);
      this.dummy.position.set(p.x, p.y + Math.sin(t * 2.4 + i) * 0.18, p.z);
      this.dummy.rotation.set(0.15 * Math.sin(t + i), t * 1.6 + i, 0);
      this.dummy.scale.setScalar(on ? 1 : 0.001);
      this.dummy.updateMatrix();
      this.bags.setMatrixAt(i, this.dummy.matrix);
    }
    this.bags.instanceMatrix.needsUpdate = true;
  }
}
