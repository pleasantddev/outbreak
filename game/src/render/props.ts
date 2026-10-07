// Street furniture and clutter, instanced by type. Signs and billboards draw from a text atlas.
import * as THREE from 'three';
import type { City, Prop, PropType } from '../world/cityGen';
import { worldMaterials, shared } from './materials';
import { buildVehicleModel } from './vehicles3d';
import type { Quality } from './engine';

const std = (color: number, rough = 0.8, metal = 0, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const M = {
  pole: std(0x3a3a3c, 0.6, 0.7), darkMetal: std(0x1d1d1f, 0.5, 0.8), rusty: std(0x5a3626, 0.9, 0.4), black: std(0x0c0c0d, 0.7, 0.1),
  wood: std(0x5a4030, 0.9), cloth: std(0x6a2a22, 0.95), tankBlack: std(0x111214, 0.45, 0.05), concrete: std(0x7a756c, 0.95),
  lampOn: new THREE.MeshStandardMaterial({ color: 0x221508, emissive: 0xffa040, emissiveIntensity: 6, roughness: 0.4 }),
  lampOff: std(0x2a2a2a, 0.5, 0.3), mattress: std(0x6b6252, 1), leaf: std(0x0d1a0f, 0.9, 0, { side: THREE.DoubleSide }),
  genRed: std(0x7a1a14, 0.55, 0.3), genYellow: std(0xa07a18, 0.55, 0.3), genGreen: std(0x23452a, 0.55, 0.3),
  glow: new THREE.MeshBasicMaterial({ color: 0x40ff60 }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m;
}
function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); return m;
}

const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 });
fireMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = shared.time;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying float vH;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vH = position.y;
      float sway = sin(uTime * 9.0 + position.y * 6.0 + instanceMatrix[3].x) * 0.08 * position.y;
      transformed.x += sway; transformed.z += cos(uTime * 7.0 + position.y * 5.0) * 0.06 * position.y;
      transformed.y *= 0.85 + 0.25 * sin(uTime * 13.0 + instanceMatrix[3].z);`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH;')
    .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4(mix(vec3(1.0,0.85,0.4), vec3(0.9,0.15,0.02), clamp(vH*1.4,0.0,1.0)) * 2.2, opacity * (1.0 - clamp(vH*1.1,0.0,1.0)));');
};

function template(type: PropType, v: number, mats: ReturnType<typeof worldMaterials>): THREE.Group {
  const g = new THREE.Group();
  switch (type) {
    case 'streetlight': {
      g.add(cyl(0.08, 0.12, 7.4, M.pole, 0, 3.7, 0, 8));
      g.add(box(0.08, 0.08, 2.4, M.pole, 0, 7.3, 1.1));
      const head = box(0.35, 0.14, 0.7, v === 1 ? M.lampOff : M.darkMetal, 0, 7.22, 2.25);
      if (v === 1) head.rotation.x = 0.5;
      g.add(head);
      if (v !== 1) g.add(box(0.26, 0.03, 0.55, M.lampOn, 0, 7.14, 2.25));
      g.add(box(0.3, 0.5, 0.2, M.darkMetal, 0, 1.3, 0.1)); // junction box with posters
      break;
    }
    case 'generator': {
      const body = [M.genRed, M.genYellow, M.genGreen][v % 3];
      g.add(box(1.15, 0.75, 0.7, body, 0, 0.55, 0));
      g.add(box(1.25, 0.08, 0.8, M.darkMetal, 0, 0.12, 0));
      for (const x of [-0.55, 0.55]) for (const z of [-0.35, 0.35]) g.add(box(0.05, 1.05, 0.05, M.darkMetal, x, 0.55, z));
      g.add(cyl(0.05, 0.05, 0.5, M.rusty, 0.4, 1.1, -0.2, 6));
      g.add(box(0.3, 0.2, 0.02, M.black, -0.25, 0.65, 0.36));
      g.add(box(0.04, 0.04, 0.01, M.glow, -0.1, 0.7, 0.37));
      break;
    }
    case 'firebarrel': {
      g.add(cyl(0.3, 0.3, 0.9, mats.rust, 0, 0.45, 0, 14));
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.0, 8, 4, true).translate(0, 0.5, 0), fireMat);
      flame.position.y = 0.85; g.add(flame);
      const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 6, 3, true).translate(0, 0.35, 0), fireMat);
      flame2.position.set(0.08, 0.85, 0.05); g.add(flame2);
      break;
    }
    case 'stall': {
      for (const x of [-1.35, 1.35]) for (const z of [-0.85, 0.85]) g.add(box(0.07, 2.3, 0.07, M.wood, x, 1.15, z));
      g.add(box(2.8, 0.08, 1.7, mats.planks, 0, 0.85, 0));
      g.add(box(2.7, 0.75, 0.04, mats.planks, 0, 0.45, 0.83));
      const roof = box(3.2, 0.04, 2.3, mats.corrugated, 0, 2.35, 0, 0, 0.12); g.add(roof);
      const goodsCols = [[0xc0402a, 0xe0b030, 0x3a7a3a], [0x2a5aa0, 0xd0d0c0, 0xa03020], [0x8a6a30, 0x5a3a20, 0xc0a060], [0xe06030, 0x40a040, 0xe0e040]][v % 4];
      for (let i = 0; i < 5; i++) {
        const c = goodsCols[i % 3];
        if (i % 2) g.add(cyl(0.22, 0.18, 0.14, std(c, 0.6), -1.0 + i * 0.5, 0.96, -0.2 + (i % 3) * 0.2, 10));
        else g.add(box(0.35, 0.25, 0.3, std(c, 0.85), -1.0 + i * 0.5, 1.02, 0.1));
      }
      const tarp = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.2), std([0x3a5a8a, 0x8a2a2a, 0x2a6a3a, 0x7a6a2a][v % 4], 0.95, 0, { side: THREE.DoubleSide }));
      tarp.position.set(0, 1.75, -0.86); g.add(tarp);
      break;
    }
    case 'wreck': {
      const paint = [std(0x1a1513, 0.95, 0.3), std(0x4a2a1c, 0.9, 0.4), std(0x2a3036, 0.7, 0.5)][v % 3];
      g.add(box(1.8, 0.7, 4.2, paint, 0, 0.62, 0));
      g.add(box(1.6, 0.55, 2.0, paint, 0, 1.22, -0.25));
      g.add(box(1.5, 0.4, 1.9, M.black, 0, 1.2, -0.25));
      for (const [x, z] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) { const w = cyl(0.32, 0.32, 0.22, M.black, x, 0.28, z, 10); w.rotation.z = Math.PI / 2; g.add(w); }
      g.add(box(1.7, 0.08, 1.2, mats.rust, 0, 1.0, 1.45, 0, -0.25));
      break;
    }
    case 'danfowreck': {
      const dm = buildVehicleModel('danfo', { wrecked: true, seed: v });
      g.add(dm.root);
      break;
    }
    case 'watertank': {
      const t = cyl(0.85, 0.85, 1.6, M.tankBlack, 0, 0.8, 0, 18); g.add(t);
      for (const y of [0.35, 0.8, 1.25]) g.add(cyl(0.87, 0.87, 0.05, M.tankBlack, 0, y, 0, 18));
      g.add(cyl(0.3, 0.3, 0.1, M.black, 0, 1.65, 0, 12));
      break;
    }
    case 'crane': {
      const yellow = std(0x9a6a10, 0.6, 0.5);
      for (const x of [-6, 6]) for (const z of [-4, 4]) g.add(box(0.8, 26, 0.8, yellow, x, 13, z));
      g.add(box(13, 1.5, 1.2, yellow, 0, 26, -4)); g.add(box(13, 1.5, 1.2, yellow, 0, 26, 4));
      g.add(box(1.4, 1.5, 40, yellow, 0, 27.5, -12));
      g.add(box(3, 2.5, 3, std(0x2a2a2a, 0.5, 0.5), 0, 24.5, 0));
      for (const z of [-4, 4]) for (let i = 0; i < 6; i++) g.add(box(0.15, 4.6, 0.15, yellow, -6, 3 + i * 4, z, 0, 0, i % 2 ? 0.8 : -0.8));
      break;
    }
    case 'palm': {
      let y = 0, x = 0;
      for (let i = 0; i < 6; i++) { const s = cyl(0.17 - i * 0.012, 0.2 - i * 0.012, 1.4, std(0x3a2e24, 1), x, y + 0.7, 0, 7); s.rotation.z = -0.05 * i; g.add(s); y += 1.38; x += 0.07 * i; }
      for (let i = 0; i < 8; i++) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 3.2).translate(0, 1.6, 0), M.leaf);
        f.position.set(x, y, 0); f.rotation.set(1.1 + (i % 2) * 0.3, (i / 8) * Math.PI * 2, 0); g.add(f);
      }
      break;
    }
    case 'kiosk': {
      g.add(box(2, 2.2, 2, mats.paint, 0, 1.1, 0));
      g.add(box(2.4, 0.05, 2.4, mats.corrugated, 0, 2.3, 0, 0, 0.1));
      g.add(box(1.4, 0.8, 0.05, M.black, 0, 1.4, 1.01));
      g.add(box(2.0, 0.3, 0.05, std([0x1b4d8a, 0x8a1b1b, 0xd0a020][v % 3], 0.6), 0, 2.0, 1.03));
      break;
    }
    case 'canoe': {
      const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std(0x3a2618, 0.9));
      hull.scale.set(0.5, 0.35, 3.0); g.add(hull);
      break;
    }
    case 'umbrella': {
      g.add(cyl(0.03, 0.03, 2.4, M.pole, 0, 1.2, 0, 6));
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.5, 8, 1, true), std(0xc03020, 0.9, 0, { side: THREE.DoubleSide }));
      top.position.y = 2.4; g.add(top);
      break;
    }
    case 'tyres': {
      for (let i = 0; i < 3 + (v % 2); i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.12, 6, 14), M.black); t.rotation.x = Math.PI / 2; t.position.y = 0.12 + i * 0.24; g.add(t); }
      break;
    }
    case 'dish': {
      g.add(cyl(0.03, 0.03, 0.9, M.pole, 0, 0.45, 0, 6));
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 6, 0, Math.PI * 2, 0, 0.9), std(0xb0b0a8, 0.6, 0.3, { side: THREE.DoubleSide }));
      d.rotation.x = -1.0; d.position.set(0, 0.95, 0.1); g.add(d);
      break;
    }
    case 'crate': {
      const s = 0.7 + v * 0.3;
      g.add(box(s, s, s, mats.planks, 0, s / 2, 0));
      g.add(box(s + 0.02, 0.06, s + 0.02, M.wood, 0, s * 0.85, 0));
      break;
    }
    case 'bed': {
      g.add(box(1.0, 0.25, 2.0, M.wood, 0, 0.2, 0));
      g.add(box(0.95, 0.18, 1.9, M.mattress, 0, 0.42, 0));
      g.add(box(1.0, 0.6, 0.06, M.wood, 0, 0.4, -1.0));
      break;
    }
    case 'table': {
      g.add(box(1.6, 0.06, 0.9, M.wood, 0, 0.78, 0));
      for (const x of [-0.72, 0.72]) for (const z of [-0.38, 0.38]) g.add(box(0.06, 0.78, 0.06, M.wood, x, 0.39, z));
      if (v === 1) { g.add(cyl(0.12, 0.1, 0.18, std(0x8a8a80, 0.4, 0.6), 0.3, 0.9, 0, 10)); }
      break;
    }
    case 'shelf': {
      for (const x of [-0.88, 0.88]) g.add(box(0.05, 2, 0.5, M.darkMetal, x, 1, 0));
      for (let i = 0; i < 4; i++) g.add(box(1.8, 0.04, 0.5, M.darkMetal, 0, 0.2 + i * 0.55, 0));
      for (let i = 0; i < 6; i++) g.add(box(0.25, 0.3, 0.3, std([0x8a5a30, 0x2a4a7a, 0xa03a2a][i % 3], 0.8), -0.6 + (i % 3) * 0.6, 0.38 + Math.floor(i / 3) * 1.1, 0));
      break;
    }
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = type !== 'firebarrel' && type !== 'palm'; o.receiveShadow = true; } });
  return g;
}

function instance(group: THREE.Group, tmpl: THREE.Group, list: Prop[]) {
  tmpl.updateMatrixWorld(true);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  tmpl.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    list.forEach((pr, i) => {
      p.set(pr.p[0], pr.p[1], pr.p[2]); q.setFromAxisAngle(up, pr.ry);
      m.compose(p, q, s).multiply(mesh.matrixWorld);
      im.setMatrixAt(i, m);
    });
    im.castShadow = mesh.castShadow; im.receiveShadow = mesh.receiveShadow;
    im.computeBoundingSphere();
    group.add(im);
  });
}

// ---------- text atlas for shop signs ----------
function signAtlas(signs: Prop[]) {
  const CW = 256, CH = 48, COLS = 8;
  const rows = Math.ceil(signs.length / COLS);
  const c = document.createElement('canvas'); c.width = CW * COLS; c.height = Math.max(64, CH * rows);
  const g = c.getContext('2d')!;
  signs.forEach((s, i) => {
    const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
    const col = new THREE.Color(s.color ?? 0x1b4d8a);
    g.fillStyle = `#${col.getHexString()}`; g.fillRect(x, y, CW, CH);
    const light = col.r + col.g + col.b > 1.8;
    g.fillStyle = light ? '#151515' : '#f2ead8';
    const text = s.text ?? '';
    let size = 26; g.font = `700 ${size}px Oswald, Impact, sans-serif`;
    while (g.measureText(text).width > CW - 14 && size > 10) { size--; g.font = `700 ${size}px Oswald, Impact, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x + CW / 2, y + CH / 2 + 1);
    // rust, soot and missing paint
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(${40 + Math.random() * 50},${20 + Math.random() * 20},10,${Math.random() * 0.35})`; g.fillRect(x + Math.random() * CW, y + Math.random() * CH, Math.random() * 30, Math.random() * 6); }
    const grd = g.createLinearGradient(0, y, 0, y + CH); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(20,8,0,0.55)');
    g.fillStyle = grd; g.fillRect(x, y, CW, CH);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { tex: t, uv: (i: number) => { const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH; return [x / c.width, 1 - (y + CH) / c.height, (x + CW) / c.width, 1 - y / c.height]; } };
}

function billboardTexture(text: string) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const bg = ['#1b1b1b', '#5a0e0e', '#0e2a4a', '#d0b020', '#e8e0d0'][Math.floor(Math.random() * 5)];
  g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
  const dark = bg === '#d0b020' || bg === '#e8e0d0';
  g.fillStyle = dark ? '#141414' : '#f0e6d2';
  g.font = '700 54px Oswald, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const words = text.split(' '); const lines: string[] = []; let line = '';
  for (const w of words) { if (g.measureText(line + ' ' + w).width > 470) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w; }
  lines.push(line);
  lines.forEach((l, i) => g.fillText(l, 256, 128 + (i - (lines.length - 1) / 2) * 60));
  // torn paper and blood
  for (let k = 0; k < 12; k++) { g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); const x = Math.random() * 512, y = Math.random() * 256; g.moveTo(x, y); for (let j = 0; j < 5; j++) g.lineTo(x + Math.random() * 60 - 30, y + Math.random() * 60 - 30); g.fill(); }
  if (Math.random() < 0.5) { g.fillStyle = 'rgba(110,0,0,0.75)'; for (let k = 0; k < 6; k++) { const x = 100 + Math.random() * 300; g.fillRect(x, 0, 4 + Math.random() * 6, 60 + Math.random() * 150); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function bloodTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 26; i++) {
    const r = 10 + Math.random() * 50, x = 128 + (Math.random() - 0.5) * 120 * (r < 25 ? 1.6 : 0.6), y = 128 + (Math.random() - 0.5) * 120 * (r < 25 ? 1.6 : 0.6);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(70,0,2,0.95)'); gr.addColorStop(0.7, 'rgba(50,0,0,0.8)'); gr.addColorStop(1, 'rgba(30,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface PropHandles { corpses: Prop[] }

export function buildProps(city: City, group: THREE.Group, quality: Quality): PropHandles {
  const mats = worldMaterials(quality);
  const byKey = new Map<string, Prop[]>();
  const signs: Prop[] = [], billboards: Prop[] = [], lit: Prop[] = [], shutters: Prop[] = [], blood: Prop[] = [], corpses: Prop[] = [];
  for (const p of city.props) {
    if (p.type === 'sign') { signs.push(p); continue; }
    if (p.type === 'billboard') { billboards.push(p); continue; }
    if (p.type === 'litwindow') { lit.push(p); continue; }
    if (p.type === 'shutter') { shutters.push(p); continue; }
    if (p.type === 'blood') { blood.push(p); continue; }
    if (p.type === 'corpse') { corpses.push(p); blood.push({ ...p, type: 'blood', w: 1.6 }); continue; }
    const v = ['streetlight', 'generator', 'stall', 'wreck', 'kiosk', 'crate', 'table', 'tyres', 'danfowreck'].includes(p.type) ? (p.v ?? 0) : 0;
    const key = `${p.type}:${v}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(p);
  }
  for (const [key, list] of byKey) {
    const [type, v] = key.split(':');
    instance(group, template(type as PropType, +v, mats), list);
  }

  // shop signs: one merged mesh sampling the atlas
  if (signs.length) {
    const atlas = signAtlas(signs);
    const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
    const m = new THREE.Matrix4(), v = new THREE.Vector3(), n = new THREE.Vector3();
    signs.forEach((s, i) => {
      m.makeRotationY(s.ry).setPosition(s.p[0], s.p[1], s.p[2]);
      const [u0, v0, u1, v1] = atlas.uv(i);
      const hw = (s.w ?? 4) / 2, hh = (s.h ?? 0.9) / 2;
      const base = pos.length / 3;
      for (const [x, y, uu, vv] of [[-hw, -hh, u0, v0], [hw, -hh, u1, v0], [hw, hh, u1, v1], [-hw, hh, u0, v1]]) {
        v.set(x, y, 0).applyMatrix4(m); pos.push(v.x, v.y, v.z); uv.push(uu, vv);
        n.set(0, 0, 1).transformDirection(m); nor.push(n.x, n.y, n.z);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: atlas.tex, roughness: 0.75, emissive: 0xffffff, emissiveMap: atlas.tex, emissiveIntensity: 0.05, side: THREE.DoubleSide }));
    group.add(mesh);
  }
  for (const b of billboards) {
    const g = new THREE.Group();
    for (const x of [-2.6, 2.6]) g.add(cyl(0.18, 0.22, 7, M.pole, x, 3.5, 0, 8));
    g.add(box(6.4, 3.4, 0.25, M.darkMetal, 0, 6.6, 0));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 3.0), new THREE.MeshStandardMaterial({ map: billboardTexture(b.text ?? ''), roughness: 0.8, emissive: 0xffffff, emissiveIntensity: 0.0 }));
    face.position.set(0, 6.6, 0.14); g.add(face);
    const back = face.clone(); back.rotation.y = Math.PI; back.position.z = -0.14; g.add(back);
    g.add(box(0.1, 0.1, 1.2, M.pole, 0, 8.4, 0.5));
    g.position.set(b.p[0], b.p[1], b.p[2]); g.rotation.y = b.ry;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(g);
  }
  // lit windows: generator and candle light behind broken frames
  if (lit.length) {
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true }), lit.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    lit.forEach((l, i) => {
      q.setFromAxisAngle(up, l.ry);
      m.compose(new THREE.Vector3(l.p[0], l.p[1], l.p[2]), q, new THREE.Vector3(l.w ?? 1.4, l.h ?? 1.3, 1));
      im.setMatrixAt(i, m);
      im.setColorAt(i, new THREE.Color(l.color ?? 0xffa040).multiplyScalar(0.9 + Math.random() * 1.6));
    });
    group.add(im);
  }
  if (shutters.length) {
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0), mats.shutter, shutters.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    shutters.forEach((s, i) => { q.setFromAxisAngle(up, s.ry); m.compose(new THREE.Vector3(s.p[0], s.p[1], s.p[2]), q, new THREE.Vector3(s.w ?? 1.4, s.h ?? 1, 1)); im.setMatrixAt(i, m); });
    group.add(im);
  }
  if (blood.length) {
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: bloodTexture(), transparent: true, depthWrite: false, roughness: 0.15, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 }), blood.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    blood.forEach((b, i) => { q.setFromAxisAngle(up, b.ry); const s = b.w ?? 1.5; m.compose(new THREE.Vector3(b.p[0], b.p[1] + 0.025, b.p[2]), q, new THREE.Vector3(s, 1, s)); im.setMatrixAt(i, m); });
    im.receiveShadow = true;
    group.add(im);
  }
  return { corpses };
}
