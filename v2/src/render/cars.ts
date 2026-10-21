// Realistic vehicles: CC BY models (credits in public/cars/CREDITS.json) with doors split in Blender so they open,
// and interiors you can see through the windows and open doors. Okada and keke are built here.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VEHICLES, type VehicleKind } from '../data/balance';
import { buildVehicleModel } from './vehicles3d';

export interface Door { node: THREE.Object3D; side: 1 | -1; slide: boolean; base: THREE.Vector3 }
export interface CarModel { root: THREE.Group; body: THREE.Group; wheels: THREE.Object3D[]; wheelBase: THREE.Vector3[]; doors: Door[]; headlights: THREE.MeshStandardMaterial[]; brake: THREE.MeshStandardMaterial[]; smoke: THREE.Vector3; kind: VehicleKind; offsetY: number; /** body-space y of the ground under the wheels: seat data is ground-relative */ groundY: number; /** seat table key: model file name, or the kind for hand built vehicles */ key: string }

const FILES: Partial<Record<VehicleKind, string[]>> = { sedan: ['camry', 'camry', 'civic'], hatch: ['golf'], jeep: ['rrsport', 'gclass'], suv: ['rrsport'], police: ['gclass'], danfo: ['hiace'] };
const PAINTS = [0xf2f2f0, 0x0d0d0f, 0x8c9096, 0x6e0f12, 0x1b2f4f, 0xc9c1b0, 0x24402a, 0xa07a28, 0x3c3c40, 0xb8b9bb];
const cache = new Map<string, Promise<{ scene: THREE.Group; meta: any }>>();
const loader = new GLTFLoader();
function load(name: string) {
  if (!cache.has(name)) cache.set(name, Promise.all([loader.loadAsync(`cars/${name}.wasm`), fetch(`cars/${name}.json`).then((r) => r.json())]).then(([g, meta]) => ({ scene: g.scene as THREE.Group, meta })));
  return cache.get(name)!;
}
export async function preloadCars() { await Promise.all(['camry', 'civic', 'golf', 'rrsport', 'gclass', 'hiace'].map(load)); }

function stripeTexture(kind: 'danfo' | 'police') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 128);
  if (kind === 'danfo') { g.fillStyle = '#0c0c0c'; g.fillRect(0, 40, 512, 14); g.fillRect(0, 64, 512, 8); }
  else { g.fillStyle = '#f2f2f2'; g.font = '700 54px Arial'; g.textAlign = 'center'; g.fillText('POLICE', 256, 80); g.fillStyle = '#1b3fa0'; g.fillRect(0, 96, 512, 12); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export async function buildCar(kind: VehicleKind, seed: number): Promise<CarModel> {
  const files = FILES[kind];
  if (!files) return procedural(kind, seed);
  const name = files[seed % files.length];
  const { scene, meta } = await load(name);
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
  const m = scene.clone(true);
  // centre the wheelbase on the physics body and sit the wheels on the suspension
  const def = VEHICLES[kind];
  const wf = meta.wheels.find((w: any) => w.q === 0), wr = meta.wheels.find((w: any) => w.q === 2);
  const zc = (wf.z + wr.z) / 2;
  const hy = def.size[1] / 2 - 0.25;
  const offsetY = -hy + 0.05 - 0.22 - wf.r;
  m.position.set(0, offsetY + 0.0, -zc);
  body.add(m);
  const paint = kind === 'danfo' ? 0xe3a21a : kind === 'police' ? 0x16181c : PAINTS[seed % PAINTS.length];
  const wheels: THREE.Object3D[] = [], wheelBase: THREE.Vector3[] = [], doors: Door[] = [];
  const headlights: THREE.MeshStandardMaterial[] = [], brake: THREE.MeshStandardMaterial[] = [];
  m.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true; mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = mats.map((mt) => {
        const s = mt as THREE.MeshStandardMaterial; const n = (s.name || '').toLowerCase();
        if (n === 'paint') { const c = s.clone(); c.color.setHex(paint); (c as any).metalness = 0.5; c.roughness = 0.28; return c; }
        if (/luz|lamp|light|fl_bulb|lampu/.test(n) && !/brake|3stop|red/.test(n)) { const c = s.clone(); c.emissive = new THREE.Color(0xfff2d0); c.emissiveIntensity = 0; headlights.push(c); return c; }
        if (/brake|3stop|stop|red/.test(n)) { const c = s.clone(); c.emissive = new THREE.Color(0xff1a10); c.emissiveIntensity = 0; brake.push(c); return c; }
        if (/glass/.test(n)) { const c = s.clone(); (c as any).transmission = 0; c.transparent = true; c.opacity = 0.42; c.roughness = 0.04; c.metalness = 0.2; c.color.setHex(0x1a2026); c.depthWrite = false; return c; }
        return s;
      });
      mesh.material = Array.isArray(mesh.material) ? out : out[0];
      // trim, glass, lamps, interior and underside do not need to be in the shadow pass: about half of a car's shadow draw calls
      const nm = ((mats[0] as THREE.Material).name || '').toLowerCase();
      if (/glass|lamp|light|luz|brake|stop|chrome|cromo|hub|int|bajo|bottom|plast|wood|shield|carbon|ttr|tepian/.test(nm)) mesh.castShadow = false;
    }
  });
  m.traverse((o) => {
    const wm = /^wheel([0-3])$/.exec(o.name);
    if (wm) { wheels[+wm[1]] = o; wheelBase[+wm[1]] = o.position.clone(); }
    const dm = /^door_(fl|fr|rl|rr|slide)$/.exec(o.name);
    if (dm) doors.push({ node: o, side: dm[1].endsWith('l') ? 1 : -1, slide: dm[1] === 'slide', base: o.position.clone() });
  });
  if (kind === 'danfo' || kind === 'police') {
    const tex = stripeTexture(kind);
    for (const side of [1, -1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(meta.length * 0.86, meta.length * 0.86 / 4), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }));
      p.position.set(side * (meta.width / 2 - 0.115), kind === 'danfo' ? 0.95 : 0.92, 0); p.rotation.y = side * Math.PI / 2;
      m.add(p);
    }
    if (kind === 'police') {
      const bar = new THREE.Group(); bar.position.set(0, meta.height + 0.04, -0.2);
      const red = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0 }), blue = new THREE.MeshStandardMaterial({ color: 0x000040, emissive: 0x1040ff, emissiveIntensity: 0 });
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.22), red); a.position.x = 0.27; bar.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.22), blue); b.position.x = -0.27; bar.add(b);
      m.add(bar); (root as any).siren = [red, blue];
    }
  }
  return { root, body, wheels, wheelBase, doors, headlights, brake, smoke: new THREE.Vector3(0, 0.3, def.size[2] / 2 - 0.4), kind, offsetY, groundY: offsetY, key: name };
}

function procedural(kind: VehicleKind, seed: number): CarModel {
  if (kind === 'keke') return keke(seed);
  const vm = buildVehicleModel(kind, { seed });
  return { root: vm.root, body: vm.body, wheels: vm.wheels, wheelBase: vm.wheels.map((w) => w.position.clone()), doors: [], headlights: vm.headlights.map((h) => h.material as THREE.MeshStandardMaterial), brake: vm.brake.map((h) => h.material as THREE.MeshStandardMaterial), smoke: vm.smoke, kind, offsetY: 0, groundY: -(VEHICLES[kind].size[1] / 2 - 0.25) + 0.05 - 0.24 - VEHICLES[kind].wheelRadius, key: kind };
}

/** Keke Marwa: the Bajaj tricycle, green and yellow, canvas roof, one wheel in front. */
function keke(seed: number): CarModel {
  const def = VEHICLES.keke; const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
  const hy = def.size[1] / 2 - 0.25; const base = -hy + 0.05 - 0.22 - 0.24;
  const green = new THREE.MeshStandardMaterial({ color: seed % 3 === 0 ? 0x1f7a3a : 0x1d6b33, roughness: 0.4, metalness: 0.3 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe8b51a, roughness: 0.45, metalness: 0.3 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });
  const canvas = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2026, transparent: true, opacity: 0.4, roughness: 0.05 });
  const seat = new THREE.MeshStandardMaterial({ color: 0x3a1a12, roughness: 0.7 });
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, base + y, z); o.rotation.x = rx; o.castShadow = true; o.receiveShadow = true; body.add(o); return o; };
  add(new THREE.BoxGeometry(1.25, 0.12, 2.3), green, 0, 0.42, -0.1);
  add(new THREE.BoxGeometry(1.25, 0.5, 0.9), yellow, 0, 0.72, -0.85);
  add(new THREE.BoxGeometry(0.75, 0.55, 0.5), green, 0, 0.72, 0.95);
  add(new THREE.BoxGeometry(0.9, 0.7, 0.05), glass, 0, 1.3, 0.92, -0.2);
  add(new THREE.BoxGeometry(1.3, 0.04, 2.0), canvas, 0, 1.75, -0.15);
  for (const [x, z] of [[-0.62, -1.1], [0.62, -1.1], [-0.4, 0.9], [0.4, 0.9]]) add(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 6), black, x, 1.15, z);
  add(new THREE.BoxGeometry(1.15, 0.12, 0.5), seat, 0, 0.82, -0.45); add(new THREE.BoxGeometry(1.15, 0.5, 0.08), seat, 0, 1.08, -0.72);
  add(new THREE.BoxGeometry(0.45, 0.1, 0.35), seat, 0, 0.82, 0.52);
  // handlebar and column in front of the driver
  add(new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8).rotateZ(Math.PI / 2), black, 0, 1.12, 0.78); add(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), black, 0, 0.87, 0.8, -0.5);
  const wheels: THREE.Object3D[] = [];
  const wheel = (x: number, z: number) => { const g = new THREE.Group(); g.position.set(x, base + 0.24, z); const sp = new THREE.Group(); g.add(sp); const t = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 16).rotateZ(Math.PI / 2), black); t.castShadow = true; sp.add(t); body.add(g); return g; };
  const f = wheel(0, 0.98); wheels.push(f, f, wheel(-0.6, -0.97), wheel(0.6, -0.97));
  const hl = new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0xfff2d0, emissiveIntensity: 0 });
  add(new THREE.SphereGeometry(0.08, 10, 8), hl, 0, 0.95, 1.22);
  const br = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0 });
  add(new THREE.BoxGeometry(0.12, 0.06, 0.03), br, -0.45, 0.7, -1.31); add(new THREE.BoxGeometry(0.12, 0.06, 0.03), br, 0.45, 0.7, -1.31);
  return { root, body, wheels, wheelBase: wheels.map((w) => w.position.clone()), doors: [], headlights: [hl], brake: [br], smoke: new THREE.Vector3(0, 0.2, -1.2), kind: 'keke', offsetY: 0, groundY: base, key: 'keke' };
}

/** Pose wheels and doors from the sim. open[i] is 0..1 for fl, fr, rl, rr (slide uses the passenger value). */
export function poseCar(m: CarModel, spin: number[], steer: number, open: number[]) {
  m.wheels.forEach((w, i) => {
    if (!w) return;
    const sp = FILES[m.kind] ? w : (w.children[0] ?? w);
    sp.rotation.x = spin[i] ?? 0;
    if (i < 2) { if (sp === w) { w.rotation.set(spin[i] ?? 0, steer, 0, 'YXZ'); } else w.rotation.y = steer; }
  });
  for (const d of m.doors) {
    const ease = (t: number) => (t <= 0 ? 0 : 1 - Math.pow(1 - Math.min(1, t * 1.6), 3));
    if (d.slide) { const t = ease(Math.max(open[1] ?? 0, open[3] ?? 0)); d.node.position.set(d.base.x - 0.12 * t * (t > 0 ? 1 : 0), d.base.y, d.base.z - 0.95 * t); }
    else {
      const name = d.node.name.slice(5); const idx = ['fl', 'fr', 'rl', 'rr'].indexOf(name);
      // door value is high right after entering or exiting; ease it into a swing
      const v = open[idx] ?? 0; const t = v > 0.5 ? (1 - v) * 2 : v * 2; // 0 -> 1 -> 0 over the event
      d.node.rotation.y = -d.side * 1.05 * ease(Math.min(1, t * 1.4));
    }
  }
}
