// The garage: a closed workshop set built away from the city so the car always has a clean, lit stage for paint,
// wraps and rims. Polished floor, a turntable, neon tubes, a lit shop sign, tyre stacks and tool walls. The shop
// carries a Lagos place name, Cappa; the shop itself and every brand on these walls are invented for the game.
import * as THREE from 'three';
import { GeoBuilder } from './geom';
import { canvas, tex, corrugated } from './textures';

export const GARAGE_W = 30, GARAGE_D = 26, GARAGE_H = 8;

function floorTexture() {
  const S = 1024, c = canvas(S), g = c.getContext('2d')!;
  // dark epoxy with soft mottling
  g.fillStyle = '#1b1c20'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) { const r = 2 + Math.random() * 18; g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.012 + Math.random() * 0.02})`; g.beginPath(); g.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2); g.fill(); }
  // tile seams every 2 m (the texture covers 28 x 20 m stretched to 1024 square, so seams are drawn per axis)
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 2;
  for (let i = 1; i < 14; i++) { const x = (i / 14) * S; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  for (let i = 1; i < 10; i++) { const y = (i / 10) * S; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  // hazard border
  const band = 26;
  g.save();
  g.beginPath(); g.rect(0, 0, S, S); g.rect(band, band, S - band * 2, S - band * 2); g.clip('evenodd');
  g.fillStyle = '#f6c514'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#111';
  for (let k = -S; k < S * 2; k += 40) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 20, 0); g.lineTo(k + 20 - S, S); g.lineTo(k - S, S); g.closePath(); g.fill(); }
  g.restore();
  // painted bay ring around the turntable and a tyre-mark arc
  g.strokeStyle = 'rgba(246,197,20,0.85)'; g.lineWidth = 6; g.beginPath(); g.ellipse(S / 2, S / 2, S * 0.17, S * 0.24, 0, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 16;
  g.beginPath(); g.arc(S * 0.3, S * 0.78, S * 0.22, -1.2, 0.4); g.stroke();
  g.beginPath(); g.arc(S * 0.31, S * 0.79, S * 0.205, -1.1, 0.35); g.stroke();
  return tex(c, { repeat: false, aniso: 8 });
}

function signTexture() {
  const c = canvas(2048, 512), g = c.getContext('2d')!;
  g.clearRect(0, 0, 2048, 512);
  const name = 'CAPPA MECHANIC VILLAGE';
  const face = (px: number) => `800 italic ${px}px "Barlow Condensed", Impact, sans-serif`;
  g.font = face(250);
  // the name fills the board edge to edge, leaving room for the glow
  const px = Math.min(250, Math.floor((250 * 1880) / g.measureText(name).width));
  g.font = face(px);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // tube glow, then the bright core
  g.shadowColor = '#ff2d8a'; g.shadowBlur = 60; g.fillStyle = '#ff2d8a'; g.fillText(name, 1024, 230);
  g.shadowBlur = 18; g.fillStyle = '#ffd6ec'; g.fillText(name, 1024, 230);
  g.font = '600 64px "Barlow Condensed", sans-serif';
  g.shadowColor = '#f6c514'; g.shadowBlur = 24; g.fillStyle = '#ffe680';
  g.fillText('SPRAYING . WRAPS . RIMS . TUNING', 1024, 420);
  return tex(c, { repeat: false });
}

function posterTexture(i: number) {
  const c = canvas(512, 768), g = c.getContext('2d')!;
  const sets = [
    { bg: '#0d4fa8', fg: '#ffffff', ac: '#f6c514', a: 'OBA MOTORS', b: 'TOKUNBO 1.8', c: 'BUILT FOR LAGOS ROADS' },
    { bg: '#111111', fg: '#f6c514', ac: '#ff2d8a', a: 'AJALA WORKS', b: 'KEKE TURBO', c: 'THREE WHEELS. NO FEAR.' },
    { bg: '#d0141c', fg: '#ffffff', ac: '#111111', a: 'EKO COACHWORKS', b: 'DANFO GT', c: 'FOURTEEN SEATS OF SPEED' },
    { bg: '#1b8a3a', fg: '#ffffff', ac: '#f6c514', a: 'LEKKI IRON', b: 'AJAH V8', c: 'BIG ENGINE. BIGGER NOISE.' },
  ];
  const s = sets[i % sets.length];
  g.fillStyle = s.bg; g.fillRect(0, 0, 512, 768);
  g.fillStyle = s.ac; g.fillRect(0, 520, 512, 18); g.fillRect(0, 0, 18, 768);
  g.fillStyle = s.fg; g.textAlign = 'left';
  g.font = '700 46px "Barlow Condensed", sans-serif'; g.fillText(s.a, 48, 90);
  g.font = '800 italic 120px "Barlow Condensed", sans-serif'; g.fillText(s.b.split(' ')[0], 40, 300);
  g.font = '800 italic 92px "Barlow Condensed", sans-serif'; g.fillText(s.b.split(' ').slice(1).join(' '), 40, 400);
  g.font = '600 40px "Barlow Condensed", sans-serif'; g.fillText(s.c, 48, 620);
  g.globalAlpha = 0.12; g.fillStyle = '#000';
  for (let k = 0; k < 40; k++) g.fillRect(Math.random() * 512, Math.random() * 768, 2 + Math.random() * 60, 2);
  return tex(c, { repeat: false });
}

export class GarageSet {
  group = new THREE.Group();
  private tubes: THREE.MeshBasicMaterial[] = [];
  private ring: THREE.MeshBasicMaterial;
  turntable: THREE.Mesh;
  readonly lights: THREE.Light[] = [];

  constructor(shadows: boolean) {
    const W = GARAGE_W, D = GARAGE_D, H = GARAGE_H;
    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.22, metalness: 0.15, envMapIntensity: 1.4 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = shadows;
    this.group.add(floor);
    // walls: corrugated sheet, darkened, facing inward
    const corr = corrugated(512, 41);
    const wallTex = tex(corr.map), wallNorm = tex(corr.normal, { srgb: false });
    wallTex.repeat.set(6, 1.6); wallNorm.repeat.set(6, 1.6);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, normalMap: wallNorm, color: 0x3c4048, roughness: 0.7, metalness: 0.45 });
    const wall = (w: number, x: number, z: number, ry: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat); m.position.set(x, H / 2, z); m.rotation.y = ry; this.group.add(m); };
    wall(W, 0, -D / 2, 0); wall(W, 0, D / 2, Math.PI); wall(D, -W / 2, 0, Math.PI / 2); wall(D, W / 2, 0, -Math.PI / 2);
    // ceiling with light panels
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.9 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H; this.group.add(ceil);
    const panelMat = new THREE.MeshBasicMaterial({ color: 0xfff4e0 });
    for (const x of [-6, 0, 6]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 12), panelMat); p.rotation.x = Math.PI / 2; p.position.set(x, H - 0.02, 0); this.group.add(p); }
    // neon tubes on the walls
    const tube = (color: number, x: number, z: number, ry: number, len: number, vertical: boolean) => {
      const mat = new THREE.MeshBasicMaterial({ color }); this.tubes.push(mat);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 8), mat);
      if (!vertical) m.rotation.z = Math.PI / 2;
      const holder = new THREE.Group(); holder.add(m); holder.position.set(x, vertical ? 1 + len / 2 : 6.1, z); holder.rotation.y = ry;
      this.group.add(holder);
    };
    for (const x of [-12, -8, 8, 12]) tube(x < 0 ? 0xff2d8a : 0xf6c514, x, -D / 2 + 0.08, 0, 4.2, true);
    for (const z of [-8, -2.5, 3, 8.5]) { tube(0x39d0ff, -W / 2 + 0.08, z, Math.PI / 2, 4.2, true); tube(0x39d0ff, W / 2 - 0.08, z, -Math.PI / 2, 4.2, true); }
    tube(0xf6c514, 0, D / 2 - 0.08, Math.PI, 20, false);
    // the shop sign
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.75), new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, depthWrite: false }));
    sign.position.set(0, 4.5, -D / 2 + 0.12); this.group.add(sign);
    // roller shutter and posters
    const shutterTex = tex(corrugated(256, 43).map); shutterTex.repeat.set(1, 4); shutterTex.rotation = Math.PI / 2;
    const shutter = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.2), new THREE.MeshStandardMaterial({ map: shutterTex, color: 0x8a8f96, roughness: 0.55, metalness: 0.6 }));
    shutter.position.set(-W / 2 + 0.1, 2.1, 3.5); shutter.rotation.y = Math.PI / 2; this.group.add(shutter);
    [-5.4, -3.2, 3.2, 5.4].forEach((x, i) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.1), new THREE.MeshStandardMaterial({ map: posterTexture(i), roughness: 0.8 }));
      p.position.set(x, 2.4, -D / 2 + 0.1);
      this.group.add(p);
    });
    // props: tyre stacks, oil drums, tool chest, workbench, cones
    const g = new GeoBuilder();
    const tyre = (x: number, z: number, n: number) => { for (let k = 0; k < n; k++) { g.setColor([0.06, 0.06, 0.07]); g.cylinder(x, k * 0.27, z, 0.36, 0.25, 18, true); g.setColor([0.2, 0.2, 0.22]); g.cylinder(x, k * 0.27 + 0.252, z, 0.2, 0.004, 14, true); } };
    tyre(-13.4, -11.4, 5); tyre(-12.5, -11.6, 4); tyre(-13.2, -10.5, 3); tyre(13.3, 11.3, 5); tyre(12.4, 11.5, 3);
    const drum = (x: number, z: number, col: [number, number, number]) => { g.setColor(col); g.cylinder(x, 0, z, 0.3, 0.88, 16, true); g.setColor([0.1, 0.1, 0.1]); g.cylinder(x, 0.3, z, 0.305, 0.04, 16, false); g.cylinder(x, 0.6, z, 0.305, 0.04, 16, false); };
    drum(13.3, -11.4, [0.05, 0.3, 0.7]); drum(12.6, -11.6, [0.9, 0.7, 0.05]); drum(13.4, -10.7, [0.7, 0.08, 0.08]);
    g.setColor([0.75, 0.06, 0.08]); g.box(9.5, 0, -12.4, 1.6, 1.1, 0.7);              // tool chest
    g.setColor([0.12, 0.12, 0.13]); for (let k = 0; k < 4; k++) g.box(9.5, 0.18 + k * 0.24, -12.04, 1.5, 0.02, 0.02);
    g.setColor([0.32, 0.22, 0.14]); g.box(-9, 0.95, -12.4, 3.2, 0.1, 0.9);              // workbench top
    g.setColor([0.15, 0.15, 0.16]); for (const [bx, bz] of [[-10.5, -12.75], [-7.5, -12.75], [-10.5, -12.05], [-7.5, -12.05]]) g.box(bx, 0, bz, 0.08, 0.95, 0.08);
    g.setColor([0.25, 0.25, 0.27]); g.box(-9, 1.05, -12.85, 3.2, 1.6, 0.04);           // pegboard
    g.setColor([0.95, 0.4, 0.05]); for (const [cx, cz] of [[7.5, 10.8], [8.4, 11.3], [6.8, 11.4]]) g.cylinder(cx, 0, cz, 0.22, 0.7, 12, true, 0.03);
    const props = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.2 }));
    props.castShadow = shadows; props.receiveShadow = shadows;
    this.group.add(props);
    // turntable with an LED ring
    const tt = new GeoBuilder();
    tt.setColor([0.12, 0.12, 0.14]); tt.cylinder(0, 0, 0, 3.4, 0.1, 64, true);
    tt.setColor([0.3, 0.3, 0.33]); for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; tt.box(Math.sin(a) * 2.6, 0.1, Math.cos(a) * 2.6, 0.06, 0.004, 1.2, a); }
    this.turntable = new THREE.Mesh(tt.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6 }));
    this.turntable.receiveShadow = shadows;
    this.group.add(this.turntable);
    this.ring = new THREE.MeshBasicMaterial({ color: 0xf6c514 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.04, 6, 96), this.ring);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; this.group.add(ring);
    // lights: warm key, cool rim, a low pink kicker for the paint
    const key = new THREE.PointLight(0xffe2c0, 160, 30, 2); key.position.set(5, 6.2, 5.5);
    const rim = new THREE.PointLight(0x9fd8ff, 110, 30, 2); rim.position.set(-6, 4.5, -5);
    const kick = new THREE.PointLight(0xff4fa0, 14, 12, 2); kick.position.set(-6, 0.5, 6.5);
    this.lights.push(key, rim, kick);
    this.group.add(key, rim, kick);
  }

  update(t: number) {
    // the LED ring breathes; tubes flicker very slightly like cheap neon does
    this.ring.color.setHSL(0.13, 0.95, 0.5 + Math.sin(t * 2.2) * 0.08);
    this.tubes.forEach((m, i) => { if (i % 5 === 2) m.color.multiplyScalar(Math.sin(t * 37 + i) > 0.97 ? 0.6 : 1); });
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat) { const mm = mat as THREE.MeshStandardMaterial; mm.map?.dispose(); mat.dispose(); }
    });
  }
}
