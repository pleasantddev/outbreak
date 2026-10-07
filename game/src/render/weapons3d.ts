// Procedural firearms with skins and visible attachments. Origin is the grip; the barrel points down +z.
import * as THREE from 'three';
import type { WeaponId } from '../data/balance';
import { WEAPON_SKINS, type WeaponSkin, type WeaponLoadout } from '../data/cosmetics';

const skinCache = new Map<string, THREE.Material[]>();

function patternTexture(skin: WeaponSkin) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const s = WEAPON_SKINS.find((x) => x.id === skin)!;
  g.fillStyle = s.base; g.fillRect(0, 0, 256, 256);
  if (skin === 'ankara') {
    // concentric suns and diamonds, a wax-print feel
    for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) {
      const ox = x + ((y / 64) % 2) * 32;
      for (let r = 28; r > 4; r -= 8) { g.fillStyle = r % 16 === 12 ? s.accent : r % 16 === 4 ? '#141414' : s.base; g.beginPath(); g.arc(ox + 32, y + 32, r, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#1a3a6a'; g.beginPath(); g.moveTo(ox, y + 32); g.lineTo(ox + 8, y + 24); g.lineTo(ox + 16, y + 32); g.lineTo(ox + 8, y + 40); g.fill();
    }
  } else if (skin === 'night') {
    for (let i = 0; i < 220; i++) { g.fillStyle = ['#15121c', '#241634', '#07070a'][i % 3]; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 256, 6 + Math.random() * 22, 4 + Math.random() * 12, Math.random() * 3, 0, Math.PI * 2); g.fill(); }
  } else if (skin === 'rust') {
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${40 + Math.random() * 30},${10 + Math.random() * 20},${Math.random() * 0.6})`; g.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 18, Math.random() * 18); }
  } else if (skin === 'blood') {
    for (let i = 0; i < 40; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 4 + Math.random() * 30; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(140,0,0,0.9)'); gr.addColorStop(1, 'rgba(60,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.fillStyle = 'rgba(120,0,0,0.8)'; for (let i = 0; i < 14; i++) g.fillRect(Math.random() * 256, Math.random() * 120, 2 + Math.random() * 3, 40 + Math.random() * 120);
  } else if (skin === 'danfo') {
    g.fillStyle = '#141414'; g.fillRect(0, 150, 256, 18); g.fillRect(0, 180, 256, 8);
  } else if (skin === 'bone') {
    g.strokeStyle = '#5b1a16'; g.lineWidth = 3; for (let i = 0; i < 18; i++) { g.beginPath(); g.moveTo(Math.random() * 256, Math.random() * 256); g.bezierCurveTo(Math.random() * 256, Math.random() * 256, Math.random() * 256, Math.random() * 256, Math.random() * 256, Math.random() * 256); g.stroke(); }
  } else if (skin === 'gold') {
    const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, '#8a6a20'); gr.addColorStop(0.5, '#e8c860'); gr.addColorStop(1, '#8a6a20'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  } else {
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function skinMats(skin: WeaponSkin) {
  if (skinCache.has(skin)) return skinCache.get(skin)!;
  const s = WEAPON_SKINS.find((x) => x.id === skin)!;
  const tex = patternTexture(skin);
  const body = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: s.rough, metalness: s.metal, envMapIntensity: 1 });
  const accent = new THREE.MeshStandardMaterial({ color: s.accent, roughness: 0.6, metalness: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.35, metalness: 0.95 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.75, metalness: 0.05 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2a18, roughness: 0.7 });
  const out = [body, accent, steel, poly, wood];
  skinCache.set(skin, out);
  return out;
}

const lens = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0.18, roughness: 0.1 });
const laserBeam = new THREE.MeshBasicMaterial({ color: 0xff1a1a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });

function bx(g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.rotation.x = rx; mesh.castShadow = true; g.add(mesh); return mesh;
}
function cy(g: THREE.Object3D, r: number, len: number, m: THREE.Material, x: number, y: number, z: number, seg = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2), m); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh;
}

export interface WeaponModel { root: THREE.Group; muzzle: THREE.Object3D; flash: THREE.Object3D }

export function buildWeapon(id: WeaponId, l: Partial<WeaponLoadout> = {}): WeaponModel {
  const root = new THREE.Group();
  const [body, accent, steel, poly, wood] = skinMats(l.skin ?? 'factory');
  let barrelEnd = 0.3, top = 0.05, magZ = 0.05;
  switch (id) {
    case 'pistol':
      bx(root, 0.032, 0.035, 0.2, body, 0, 0.06, 0.06);
      bx(root, 0.03, 0.11, 0.045, poly, 0, -0.01, -0.005, 0.25);
      bx(root, 0.028, 0.025, 0.14, steel, 0, 0.03, 0.06);
      bx(root, 0.006, 0.012, 0.012, steel, 0, 0.085, 0.15);
      barrelEnd = 0.165; top = 0.078; magZ = -0.01;
      break;
    case 'smg':
      bx(root, 0.045, 0.07, 0.32, body, 0, 0.05, 0.1);
      bx(root, 0.035, 0.11, 0.05, poly, 0, -0.03, 0.0, 0.2);
      bx(root, 0.03, 0.04, 0.2, steel, 0, 0.02, -0.16);
      bx(root, 0.03, 0.08, 0.03, steel, 0, 0.0, -0.26);
      cy(root, 0.012, 0.12, steel, 0, 0.06, 0.32);
      bx(root, 0.03, 0.02, 0.24, accent, 0, 0.09, 0.1);
      barrelEnd = 0.38; top = 0.1; magZ = 0.08;
      break;
    case 'ar':
      bx(root, 0.05, 0.08, 0.36, body, 0, 0.05, 0.12);
      bx(root, 0.055, 0.065, 0.3, accent, 0, 0.055, 0.44);
      cy(root, 0.012, 0.22, steel, 0, 0.06, 0.68);
      bx(root, 0.035, 0.11, 0.05, poly, 0, -0.03, 0.0, 0.25);
      bx(root, 0.045, 0.07, 0.26, poly, 0, 0.04, -0.2);
      bx(root, 0.04, 0.11, 0.06, poly, 0, 0.01, -0.33);
      bx(root, 0.025, 0.02, 0.5, steel, 0, 0.1, 0.25);
      bx(root, 0.012, 0.05, 0.015, steel, 0, 0.11, 0.56);
      barrelEnd = 0.8; top = 0.11; magZ = 0.14;
      break;
    case 'shotgun':
      bx(root, 0.05, 0.075, 0.34, body, 0, 0.04, 0.1);
      cy(root, 0.02, 0.5, steel, 0, 0.07, 0.45);
      cy(root, 0.017, 0.42, steel, 0, 0.03, 0.42);
      bx(root, 0.05, 0.05, 0.16, wood, 0, 0.03, 0.42);
      bx(root, 0.04, 0.1, 0.05, wood, 0, -0.03, -0.02, 0.3);
      bx(root, 0.045, 0.08, 0.3, wood, 0, 0.02, -0.22, -0.08);
      barrelEnd = 0.7; top = 0.095; magZ = 1;
      break;
    case 'sniper':
      bx(root, 0.05, 0.075, 0.4, body, 0, 0.04, 0.12);
      cy(root, 0.014, 0.6, steel, 0, 0.06, 0.62);
      bx(root, 0.055, 0.06, 0.4, body, 0, 0.02, 0.45);
      bx(root, 0.04, 0.11, 0.05, poly, 0, -0.03, -0.02, 0.3);
      bx(root, 0.05, 0.09, 0.36, body, 0, 0.02, -0.26);
      bx(root, 0.05, 0.13, 0.04, accent, 0, 0.0, -0.45);
      const bolt = cy(root, 0.008, 0.06, steel, 0.04, 0.07, 0.05); bolt.rotation.y = Math.PI / 2;
      for (const s of [-1, 1]) { const leg = bx(root, 0.01, 0.16, 0.01, steel, s * 0.03, -0.04, 0.6); leg.rotation.z = s * 0.3; }
      barrelEnd = 0.92; top = 0.08; magZ = 0.12;
      break;
    case 'machete': {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a8680, roughness: 0.3, metalness: 0.9 }));
      blade.position.set(0, 0.0, 0.33); blade.castShadow = true; root.add(blade);
      bx(root, 0.03, 0.035, 0.14, wood, 0, 0, 0.0);
      bx(root, 0.009, 0.07, 0.12, l.skin && l.skin !== 'factory' ? body : steel, 0, -0.005, 0.5);
      barrelEnd = 0.58; magZ = 1;
      break;
    }
  }
  // magazine
  if (magZ < 1) {
    const ext = l.mag === 'extmag' ? 1.5 : l.mag === 'quickmag' ? 0.8 : 1;
    const magLen = (id === 'pistol' ? 0.0 : id === 'sniper' ? 0.08 : 0.15) * ext;
    if (magLen > 0) { const m = bx(root, 0.03, magLen, 0.06, l.mag === 'quickmag' ? accent : poly, 0, -magLen / 2 + 0.01, magZ, -0.18); if (l.mag === 'quickmag') bx(root, 0.032, 0.02, 0.07, accent, 0, -magLen, magZ + magLen * 0.18); void m; }
  }
  // optics
  if (l.optic === 'reddot') { bx(root, 0.03, 0.035, 0.06, steel, 0, top + 0.02, 0.1); const ln = bx(root, 0.022, 0.022, 0.004, lens, 0, top + 0.025, 0.07); ln.scale.set(1, 1, 1); }
  if (l.optic === 'scope4') { cy(root, 0.022, 0.26, steel, 0, top + 0.045, 0.12, 14); cy(root, 0.027, 0.05, steel, 0, top + 0.045, 0.25, 14); cy(root, 0.026, 0.04, steel, 0, top + 0.045, -0.01, 14); bx(root, 0.015, 0.03, 0.02, steel, 0, top + 0.015, 0.06); bx(root, 0.015, 0.03, 0.02, steel, 0, top + 0.015, 0.18); }
  // muzzle
  if (l.muzzle === 'suppressor' && id !== 'machete') { cy(root, 0.022, 0.18, poly, 0, id === 'shotgun' ? 0.07 : 0.06, barrelEnd + 0.09, 12); barrelEnd += 0.18; }
  if (l.muzzle === 'comp' && id !== 'machete') { cy(root, 0.02, 0.06, steel, 0, 0.06, barrelEnd + 0.03, 6); barrelEnd += 0.06; }
  // underbarrel
  if (l.grip === 'vgrip') bx(root, 0.025, 0.08, 0.03, poly, 0, -0.01, id === 'smg' ? 0.25 : 0.42);
  if (l.grip === 'laser') {
    bx(root, 0.025, 0.025, 0.06, steel, 0.03, 0.04, id === 'pistol' ? 0.1 : 0.35);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 30, 4).rotateX(Math.PI / 2).translate(0, 0, 15), laserBeam);
    beam.position.set(0.03, 0.04, id === 'pistol' ? 0.13 : 0.38); root.add(beam);
  }
  if (l.charm) { const ch = new THREE.Mesh(new THREE.OctahedronGeometry(0.018), new THREE.MeshStandardMaterial({ color: 0x8a0b0b, emissive: 0x5a0000, emissiveIntensity: 0.8 })); ch.position.set(0.035, 0.0, -0.05); root.add(ch); }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, id === 'shotgun' ? 0.07 : 0.06, barrelEnd); root.add(muzzle);
  const flash = new THREE.Object3D(); muzzle.add(flash);
  return { root, muzzle, flash };
}
