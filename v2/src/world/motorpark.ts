// Motor park dressing: a Lagos garage where danfos and keke load. A corrugated canopy or two on steel posts, painted
// kerb stones, a union shed with a hand-painted board (a made-up union, no real names), wooden benches, plastic chairs
// and a price board. Built as one small group per park, only while the player is near, and torn down when they leave.
import * as THREE from 'three';
import { obb } from './geo';

export interface ParkSite { id: string; x: number; z: number; name: string; ang: number; hl: number; hw: number }

const mats: Record<string, THREE.Material> = {};
const geos: Record<string, THREE.BufferGeometry> = {};
const rnd = (a: number) => { const s = Math.sin(a * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

function canvasMap(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, rep?: [number, number]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  return t;
}
function M(c: number, r = 0.8, metal = 0) { return new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: metal }); }

function init() {
  if (mats.roofBlue) return;
  // corrugated sheet: ribs across the width, a faded paint coat and rust round the edges
  const sheet = (base: string, rib: string, rust: number) => canvasMap(128, 128, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? rib : 'rgba(0,0,0,0.18)'; g.fillRect(i * 8, 0, 4, 128); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${120 + rnd(i) * 40}, ${52 + rnd(i + 9) * 20}, 24, ${rust * (0.15 + rnd(i + 3) * 0.3)})`; const x = rnd(i + 5) * 128, y = rnd(i + 7) * 128; g.fillRect(x, y, 3 + rnd(i + 11) * 10, 6 + rnd(i + 13) * 26); }
  }, [3, 2]);
  mats.roofBlue = new THREE.MeshStandardMaterial({ map: sheet('#2f6f86', '#4f93aa', 0.7), roughness: 0.55, metalness: 0.35 });
  mats.roofZinc = new THREE.MeshStandardMaterial({ map: sheet('#8c9298', '#b1b7bc', 0.5), roughness: 0.5, metalness: 0.4 });
  mats.roofGreen = new THREE.MeshStandardMaterial({ map: sheet('#35704a', '#4f8d63', 0.6), roughness: 0.55, metalness: 0.35 });
  mats.steel = M(0x5b6068, 0.55, 0.5); mats.wood = M(0x7a5a3a, 0.85); mats.woodDark = M(0x4b3626, 0.85);
  mats.kerbBlack = M(0x1d1d1f, 0.9); mats.kerbYellow = M(0xe5b81c, 0.8); mats.kerbWhite = M(0xd9d6cc, 0.85);
  mats.shedWall = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, map: canvasMap(128, 128, (g) => {
    g.fillStyle = '#c9a24a'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${90 + rnd(i) * 60}, ${70 + rnd(i + 1) * 40}, 40, ${0.05 + rnd(i + 2) * 0.12})`; g.fillRect(rnd(i + 3) * 128, rnd(i + 4) * 128, 8 + rnd(i + 5) * 30, 4 + rnd(i + 6) * 18); }
    g.fillStyle = 'rgba(30,24,16,0.35)'; g.fillRect(0, 100, 128, 28);
  }) });
  mats.door = M(0x2b2f36, 0.5, 0.5); mats.dark = M(0x101114, 0.9);
  mats.chairRed = M(0xc62828, 0.6); mats.chairBlue = M(0x1565c0, 0.6); mats.chairYellow = M(0xf9a825, 0.6);
  mats.tyre = M(0x151515, 0.95);
  geos.box = new THREE.BoxGeometry(1, 1, 1); geos.cyl = new THREE.CylinderGeometry(1, 1, 1, 10); geos.tyre = new THREE.TorusGeometry(0.3, 0.12, 8, 16);
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, shadow = true) {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = shadow; o.receiveShadow = true; return o;
}
const box = (m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, shadow = true) => mesh(geos.box, m, x, y, z, w, h, d, shadow);
const post = (x: number, z: number, h: number, r = 0.06) => mesh(geos.cyl, mats.steel, x, h / 2, z, r, h, r);

/** A hand-painted board: off-white capitals a little off true on a green ground, a thin border and a brushed shadow. */
function paintedBoard(title: string, sub: string, ground = '#1f6b3a') {
  return canvasMap(512, 160, (g) => {
    g.fillStyle = ground; g.fillRect(0, 0, 512, 160);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + rnd(i) * 0.06})`; g.fillRect(rnd(i + 1) * 512, rnd(i + 2) * 160, 30 + rnd(i + 3) * 80, 2 + rnd(i + 4) * 5); }
    g.strokeStyle = '#f1e8c8'; g.lineWidth = 5; g.strokeRect(10, 10, 492, 140);
    const line = (txt: string, y: number, size: number, seed: number) => {
      g.textBaseline = 'middle'; g.textAlign = 'left';
      let sz = size, widths: number[] = [], tot = 1e9; while (tot > 450 && sz > 12) { g.font = `900 ${sz}px Rajdhani, Impact, sans-serif`; widths = [...txt].map((ch) => g.measureText(ch).width); tot = widths.reduce((a, b) => a + b, 0) + txt.length * 2; sz -= 2; }
      let x = 256 - tot / 2;
      for (let i = 0; i < txt.length; i++) { const jy = (rnd(seed + i) - 0.5) * 5, jr = (rnd(seed + i + 40) - 0.5) * 0.09; g.save(); g.translate(x, y + jy); g.rotate(jr); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillText(txt[i], 2, 2); g.fillStyle = '#f4ecd0'; g.fillText(txt[i], 0, 0); g.restore(); x += widths[i] + 2; }
    };
    line(title, 56, 46, 3); line(sub, 112, 28, 17);
  });
}
function priceBoard() {
  return canvasMap(256, 128, (g) => {
    g.fillStyle = '#e8e0c4'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#7b1e1e'; g.lineWidth = 6; g.strokeRect(5, 5, 246, 118);
    g.fillStyle = '#7b1e1e'; g.font = '900 24px Rajdhani, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('PARK TICKET', 128, 28); g.fillText('DANFO  N500', 128, 64); g.fillText('KEKE  N300', 128, 98);
  });
}

function canopy(w: number, d: number, h: number, roof: THREE.Material, tilt = 0.05) {
  const g = new THREE.Group();
  const sheet = box(roof, 0, h, 0, w, 0.07, d); sheet.rotation.z = tilt; g.add(sheet);
  g.add(box(mats.steel, 0, h - 0.12, -d / 2 + 0.05, w, 0.1, 0.08), box(mats.steel, 0, h - 0.12 + (tilt * w) / 2 - 0.05, d / 2 - 0.05, w, 0.1, 0.08));
  const nx = Math.max(2, Math.round(w / 3.2) + 1);
  for (let i = 0; i < nx; i++) { const x = -w / 2 + 0.3 + (i / (nx - 1)) * (w - 0.6); for (const z of [-d / 2 + 0.25, d / 2 - 0.25]) g.add(post(x, z, h - 0.1)); }
  return g;
}
function bench(len = 1.9) {
  const g = new THREE.Group();
  g.add(box(mats.wood, 0, 0.46, 0, len, 0.06, 0.38), box(mats.wood, 0, 0.78, -0.17, len, 0.3, 0.04));
  for (const x of [-len / 2 + 0.15, len / 2 - 0.15]) g.add(box(mats.woodDark, x, 0.23, 0, 0.07, 0.46, 0.32), box(mats.woodDark, x, 0.62, -0.17, 0.07, 0.4, 0.05));
  return g;
}
function chair(m: THREE.Material) {
  const g = new THREE.Group();
  g.add(box(m, 0, 0.44, 0, 0.42, 0.05, 0.42), box(m, 0, 0.72, -0.2, 0.42, 0.5, 0.04));
  for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) g.add(mesh(geos.cyl, mats.steel, x, 0.22, z, 0.02, 0.44, 0.02));
  return g;
}

/** Where things stand, in the park's own frame (x along the long side, z across). Shared by the props and by the people who stand there. */
export function parkLayout(s: ParkSite) {
  const L = THREE.MathUtils.clamp(s.hl, 7, 24), W = THREE.MathUtils.clamp(s.hw, 4.5, 14);
  return { L, W, canopy: { x: -L * 0.45, z: -W * 0.35 }, shed: { x: L * 0.62, z: -W * 0.62 }, canopy2: { x: L * 0.2, z: W * 0.5 } };
}
export function parkToWorld(s: ParkSite, lx: number, lz: number) {
  const c = Math.cos(s.ang), si = Math.sin(s.ang); return { x: s.x + lx * c - lz * si, z: s.z + lx * si + lz * c };
}
/** Spots for the touts and passengers (local frame) with a yaw facing the road side of the park. */
export function standSpots(s: ParkSite) {
  const P = parkLayout(s); const a = P.canopy;
  return [
    { lx: a.x - 1.4, lz: a.z + 0.4, role: 'Passenger' }, { lx: a.x + 0.2, lz: a.z + 1.4, role: 'Passenger' }, { lx: a.x + 1.9, lz: a.z + 0.9, role: 'Tout' },
    { lx: P.shed.x - 2.6, lz: P.shed.z + 2.8, role: 'Tout' }, { lx: P.canopy2.x - 0.8, lz: P.canopy2.z - 0.6, role: 'Passenger' },
  ];
}

export function buildPark(s: ParkSite): THREE.Group {
  init();
  const P = parkLayout(s); const g = new THREE.Group(); g.position.set(s.x, 0, s.z); g.rotation.y = -s.ang;
  const seed = Math.abs(Math.round(s.x * 7 + s.z * 3));
  const roofs = [mats.roofBlue, mats.roofZinc, mats.roofGreen];
  // main canopy with benches under it
  const c1 = canopy(Math.min(11, P.L * 0.9), 4.2, 3.1, roofs[seed % 3]); c1.position.set(P.canopy.x, 0, P.canopy.z); g.add(c1);
  for (let i = 0; i < 3; i++) { const b = bench(); b.position.set(P.canopy.x - 3 + i * 2.7, 0, P.canopy.z - 1.3); g.add(b); }
  for (let i = 0; i < 4; i++) { const ch = chair([mats.chairRed, mats.chairBlue, mats.chairYellow][(seed + i) % 3]); ch.position.set(P.canopy.x - 3.2 + i * 1.3, 0, P.canopy.z + 1.2 + (i % 2) * 0.3); ch.rotation.y = Math.PI + (rnd(seed + i) - 0.5) * 0.7; g.add(ch); }
  // a smaller second canopy
  const c2 = canopy(5.4, 3.2, 2.7, roofs[(seed + 1) % 3], -0.04); c2.position.set(P.canopy2.x, 0, P.canopy2.z); g.add(c2);
  const b2 = bench(2.2); b2.position.set(P.canopy2.x, 0, P.canopy2.z + 1.1); b2.rotation.y = Math.PI; g.add(b2);
  // the union shed: block walls, flat zinc roof, a dark door, a window with bars, the painted board and the price board
  const sd = new THREE.Group(); sd.position.set(P.shed.x, 0, P.shed.z);
  sd.add(box(mats.shedWall, 0, 1.3, 0, 4.2, 2.6, 3.0), box(roofs[(seed + 2) % 3], 0, 2.68, 0, 4.6, 0.1, 3.4), box(mats.steel, 0, 2.58, 1.62, 4.7, 0.08, 0.08));
  sd.add(box(mats.door, -0.9, 1.05, 1.51, 1.0, 2.1, 0.06), box(mats.dark, 1.2, 1.5, 1.51, 1.2, 0.9, 0.05));
  for (let i = 0; i < 5; i++) sd.add(box(mats.steel, 0.75 + i * 0.225, 1.5, 1.55, 0.03, 0.9, 0.03, false));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.12), new THREE.MeshStandardMaterial({ map: paintedBoard('ROAD WELFARE UNION', `${(s.name || 'MOTOR PARK').toUpperCase().slice(0, 22)} BRANCH`), roughness: 0.8 }));
  board.position.set(0, 2.1 + 0.0, 1.55); board.scale.set(1, 1, 1); sd.add(board);
  const price = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshStandardMaterial({ map: priceBoard(), roughness: 0.8 })); price.position.set(1.7, 1.0, 1.56); sd.add(price);
  sd.add(box(mats.woodDark, -1.9, 0.25, 1.9, 0.5, 0.5, 0.5), mesh(geos.tyre, mats.tyre, 1.9, 0.14, 2.1, 1, 1, 1));
  g.add(sd);
  // painted kerb stones along the two long sides of the park: black and yellow, a stone every 1.2 m
  for (const side of [-1, 1]) {
    const n = Math.floor((P.L * 2 - 2) / 1.2);
    for (let i = 0; i < n; i++) { const x = -P.L + 1 + i * 1.2; g.add(box(i % 2 ? mats.kerbYellow : mats.kerbBlack, x, 0.11, side * (P.W - 1.0), 1.12, 0.22, 0.34, false)); }
  }
  g.traverse((o) => { o.matrixAutoUpdate = true; });
  return g;
}

/** Owns the groups: builds the ones near the player and removes the ones that are far. Call sync a couple of times a second. */
export class MotorParkProps {
  private groups = new Map<string, THREE.Group>();
  constructor(private scene: THREE.Scene) {}
  sync(sites: ParkSite[], fx: number, fz: number, near = 120, far = 170) {
    const want = new Set<string>();
    for (const s of sites) { const d = Math.hypot(s.x - fx, s.z - fz); if (d < near) want.add(s.id); }
    for (const s of sites) if (want.has(s.id) && !this.groups.has(s.id)) { const g = buildPark(s); this.scene.add(g); this.groups.set(s.id, g); }
    for (const [id, g] of this.groups) { const s = sites.find((q) => q.id === id); if (!s || Math.hypot(s.x - fx, s.z - fz) > far) { this.scene.remove(g); this.groups.delete(id); } }
  }
  dispose() { for (const g of this.groups.values()) this.scene.remove(g); this.groups.clear(); }
}

/** Oriented footprint of an area polygon as a ParkSite. */
export function siteFromArea(id: string, name: string, pts: ArrayLike<number>): ParkSite | null {
  if (pts.length < 6) return null; const o = obb(pts as any); return { id, name, x: o.cx, z: o.cz, ang: o.ang, hl: o.hl, hw: o.hw };
}
