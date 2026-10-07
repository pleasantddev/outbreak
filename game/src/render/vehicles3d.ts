// Procedural vehicles. The danfo is the hero: yellow, striped, rusted, overloaded and blessed.
import * as THREE from 'three';
import { VEHICLES, type VehicleKind } from '../data/balance';

const SLOGANS = ['GOD DEY', 'NO TELL MY MAMA', 'NO FOOD FOR LAZY MAN', 'EKO FOR SHOW', 'SMALL SMALL', 'JESUS IS THE WAY', 'IF NOT GOD', 'SHINE YA EYE'];

function liveryTexture(seed: number, wrecked: boolean) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = wrecked ? '#6a5418' : '#d6a620'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#121212';
  g.fillRect(0, 150, 512, 16); g.fillRect(0, 176, 512, 10);
  // grime gradient and rust bloom
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,20,5,0.75)');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
  const rnd = mulberry(seed + 11);
  for (let i = 0; i < (wrecked ? 70 : 28); i++) {
    const x = rnd() * 512, y = 120 + rnd() * 136, r = 4 + rnd() * (wrecked ? 40 : 16);
    const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, 'rgba(90,40,15,0.9)'); rg.addColorStop(1, 'rgba(90,40,15,0)');
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.fillStyle = '#121212'; g.font = '700 30px Oswald, Impact, sans-serif'; g.textAlign = 'center';
  g.fillText(SLOGANS[seed % SLOGANS.length], 256, 120);
  if (wrecked) { g.fillStyle = 'rgba(0,0,0,0.55)'; for (let i = 0; i < 8; i++) g.fillRect(rnd() * 512, rnd() * 256, 80 + rnd() * 120, 30 + rnd() * 60); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function mulberry(a: number) { return () => { let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const glass = new THREE.MeshStandardMaterial({ color: 0x07090b, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.4 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.92 });
const chrome = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.35, metalness: 0.9 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.55, metalness: 0.7 });
const rustMat = new THREE.MeshStandardMaterial({ color: 0x4a2a1a, roughness: 0.95, metalness: 0.3 });

export interface VehicleModel { root: THREE.Group; wheels: THREE.Object3D[]; headlights: THREE.Mesh[]; brake: THREE.Mesh[]; body: THREE.Group; smoke: THREE.Vector3 }

function b(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, rx = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.rotation.x = rx; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function wheel(r: number, w: number, parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const spin = new THREE.Group(); g.add(spin);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2), rubber); t.castShadow = true; spin.add(t);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10).rotateZ(Math.PI / 2), darkMetal); spin.add(hub);
  for (let i = 0; i < 5; i++) { const n = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.04, r * 0.9), chrome); n.rotation.x = (i / 5) * Math.PI; spin.add(n); }
  parent.add(g);
  return g;
}

export function buildVehicleModel(kind: VehicleKind, opts: { wrecked?: boolean; seed?: number; color?: number } = {}): VehicleModel {
  const def = VEHICLES[kind];
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const [sx, sy, sz] = def.size;
  const hy = sy / 2 - 0.25;
  const wy = -hy + 0.05 - 0.24;
  const wheels: THREE.Object3D[] = [], headlights: THREE.Mesh[] = [], brake: THREE.Mesh[] = [];
  const seed = opts.seed ?? Math.floor(Math.random() * 1000);
  const wrecked = !!opts.wrecked;
  const lightOn = new THREE.MeshStandardMaterial({ color: 0x302810, emissive: 0xfff0c0, emissiveIntensity: wrecked ? 0 : 0.3 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x300808, emissive: 0xff1010, emissiveIntensity: wrecked ? 0 : 0.4 });

  if (kind === 'danfo') {
    const paint = new THREE.MeshStandardMaterial({ map: liveryTexture(seed, wrecked), roughness: wrecked ? 0.9 : 0.55, metalness: 0.25 });
    const base = wy + 0.3;
    b(sx, 0.95, sz, paint, 0, base + 0.48, 0, body);
    b(sx - 0.06, 0.9, sz - 0.5, paint, 0, base + 1.4, -0.22, body);
    b(sx - 0.04, 0.7, 0.5, paint, 0, base + 1.25, sz / 2 - 0.4, body, -0.35);
    // window band
    b(sx + 0.01, 0.55, sz - 1.2, glass, 0, base + 1.45, -0.4, body);
    b(sx - 0.2, 0.55, 0.05, glass, 0, base + 1.3, sz / 2 - 0.2, body, -0.35);
    b(sx - 0.2, 0.5, 0.05, glass, 0, base + 1.45, -sz / 2 + 0.03, body);
    b(sx + 0.02, 0.08, sz + 0.06, rustMat, 0, base + 0.02, 0, body);
    // bumpers, lights, roof rack piled with someone's life
    b(sx + 0.1, 0.18, 0.15, chrome, 0, base + 0.15, sz / 2 + 0.05, body);
    b(sx + 0.1, 0.18, 0.15, chrome, 0, base + 0.15, -sz / 2 - 0.05, body);
    for (const x of [-0.7, 0.7]) { headlights.push(b(0.25, 0.18, 0.05, lightOn, x, base + 0.55, sz / 2 + 0.01, body)); brake.push(b(0.18, 0.25, 0.05, tail, x, base + 0.6, -sz / 2 - 0.01, body)); }
    for (const x of [-0.85, 0.85]) b(0.05, 0.12, sz - 1.4, darkMetal, x, base + 1.92, -0.3, body);
    for (let i = 0; i < 4; i++) b(sx - 0.2, 0.05, 0.05, darkMetal, 0, base + 1.92, -1.6 + i * 0.9, body);
    if (!wrecked) {
      const loads = [0x3a5a8a, 0x7a3a2a, 0x2a2a2a, 0xa08040];
      for (let i = 0; i < 3; i++) b(0.5 + (i % 2) * 0.4, 0.4, 0.6, new THREE.MeshStandardMaterial({ color: loads[(seed + i) % 4], roughness: 0.95 }), -0.4 + i * 0.4, base + 2.15, -1.2 + i * 0.8, body);
    }
    b(0.06, 0.2, 0.25, darkMetal, sx / 2 + 0.1, base + 1.2, sz / 2 - 0.6, body);
    b(0.06, 0.2, 0.25, darkMetal, -sx / 2 - 0.1, base + 1.2, sz / 2 - 0.6, body);
  } else if (kind === 'suv') {
    const cols = [0x0e0e10, 0x2a2c30, 0xd8d8d0, 0x3a1010, 0x1a2a20];
    const paint = new THREE.MeshStandardMaterial({ color: opts.color ?? cols[seed % cols.length], roughness: 0.35, metalness: 0.6, envMapIntensity: 1.1 });
    const base = wy + 0.32;
    b(sx, 0.85, sz, paint, 0, base + 0.43, 0, body);
    b(sx - 0.1, 0.75, sz - 1.3, paint, 0, base + 1.22, -0.35, body);
    b(sx - 0.08, 0.6, sz - 1.4, glass, 0, base + 1.25, -0.35, body);
    b(sx - 0.15, 0.06, sz - 1.3, darkMetal, 0, base + 1.62, -0.35, body);
    b(sx + 0.05, 0.4, 0.2, darkMetal, 0, base + 0.35, sz / 2 + 0.12, body); // bull bar
    for (const x of [-0.7, 0.7]) { headlights.push(b(0.3, 0.15, 0.05, lightOn, x, base + 0.62, sz / 2 + 0.01, body)); brake.push(b(0.25, 0.2, 0.05, tail, x, base + 0.62, -sz / 2 - 0.01, body)); }
    b(0.5, 0.5, 0.15, rubber, 0, base + 0.75, -sz / 2 - 0.08, body); // spare tyre
    for (const x of [-sx / 2 - 0.05, sx / 2 + 0.05]) b(0.08, 0.06, sz * 0.5, chrome, x, base + 0.05, 0, body);
  } else {
    // okada: a 125cc workhorse with a long seat and a passenger
    const cols = [0x8a1010, 0x101010, 0x1a3a8a, 0xb07010];
    const paint = new THREE.MeshStandardMaterial({ color: cols[seed % cols.length], roughness: 0.4, metalness: 0.5 });
    const base = wy + 0.32;
    b(0.12, 0.12, 1.25, darkMetal, 0, base + 0.25, 0, body);
    b(0.3, 0.25, 0.5, paint, 0, base + 0.62, 0.3, body);
    b(0.28, 0.12, 0.85, new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 }), 0, base + 0.62, -0.35, body);
    b(0.22, 0.32, 0.35, darkMetal, 0, base + 0.35, 0.0, body);
    b(0.06, 0.06, 0.6, chrome, 0.12, base + 0.3, -0.45, body);
    const fork = b(0.05, 0.75, 0.05, chrome, 0, base + 0.55, 0.75, body); fork.rotation.x = -0.35;
    b(0.75, 0.04, 0.04, chrome, 0, base + 0.95, 0.62, body);
    headlights.push(b(0.18, 0.16, 0.1, lightOn, 0, base + 0.82, 0.78, body));
    brake.push(b(0.12, 0.08, 0.05, tail, 0, base + 0.6, -0.8, body));
    b(0.3, 0.05, 0.4, darkMetal, 0, base + 0.68, -0.85, body);
  }
  const wr = def.wheelRadius, ww = kind === 'okada' ? 0.12 : 0.26;
  const pos: [number, number][] = kind === 'okada'
    ? [[0, def.wheelBase / 2], [0, def.wheelBase / 2], [0, -def.wheelBase / 2], [0, -def.wheelBase / 2]]
    : [[-def.track / 2, def.wheelBase / 2], [def.track / 2, def.wheelBase / 2], [-def.track / 2, -def.wheelBase / 2], [def.track / 2, -def.wheelBase / 2]];
  pos.forEach(([x, z], i) => {
    if (kind === 'okada' && i % 2 === 1) { const dummy = new THREE.Group(); dummy.add(new THREE.Group()); wheels.push(dummy); return; }
    if (wrecked && (i === 1 || i === 3) && seed % 2) { const dummy = new THREE.Group(); dummy.add(new THREE.Group()); wheels.push(dummy); return; }
    wheels.push(wheel(wr, ww, root, x, wy, z));
  });
  if (wrecked) {
    root.rotation.z = seed % 2 ? 0.12 : 0;
    body.traverse((o) => {
      const mesh = o as THREE.Mesh; const m = mesh.material as THREE.MeshStandardMaterial;
      if (m && m.color && !m.map) { const c = m.clone(); c.color.multiplyScalar(0.4); mesh.material = c; }
    });
    root.position.y = -wy + wr - 0.35;
  }
  return { root, wheels, headlights, brake, body, smoke: new THREE.Vector3(0, wy + 0.9, sz / 2 - 0.5) };
}
