// Procedural cars. Each body is lofted from cross-sections along its length: a side profile (bumper, hood,
// windscreen, roof, rear glass, deck), a plan taper, wheel arches cut into the rocker line and flared fenders. Glass,
// pillars, lamps, grille, mirrors, plates, spoilers and wheels go on top. Every design is original.
import * as THREE from 'three';
import type { CarDef, CarShape, Livery, RimStyle } from '../shared/cars';
import { canvas, tex } from './textures';
import { fixNormals } from './geom';
import { skyReflection } from './atmosphere';
import { SKINS, lookFor, type DriverLook } from '../shared/drivers';
import { carAsset, type CarAsset, type CarAssetMeta } from './carAssets';

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Profile {
  L: number; W: number; zF: number; zR: number;
  zWs: number; zRf: number; zRr: number; zDk: number;   // windscreen base, roof front, roof rear, deck start
  noseY: number; beltY: number; roofY: number; tailY: number; rockY: number;
  arch: number; flare: number; tumble: number;
  wheelZ: [number, number]; wheelR: number;
}

function profileOf(s: CarShape): Profile {
  const L = s.length, W = s.width;
  const zF = L / 2, zR = -L / 2;
  const cabC = zF - L * s.cabin;               // cabin centre along z
  const half = (L * s.cabinLen) / 2;
  const box = s.style === 'van' || s.style === 'suv';
  const zRf = cabC + half * (box ? 0.92 : 0.55);
  const zWs = Math.min(zF - 0.35, cabC + half + (box ? 0.05 : 0.12 + s.nose * 0.22));
  let zRr = cabC - half * (box ? 0.95 : 0.45);
  const fast = 1 - s.tail;
  let zDk = s.style === 'hatch' ? zRr - 0.14 : Math.max(zR + 0.3, cabC - half - fast * 0.55 * L * 0.25);
  if (box) { zRr = zR + (s.style === 'van' ? 0.16 : 0.32); zDk = zR + 0.06; }
  const H = s.height;
  const beltY = Math.max(s.rideH + 0.45, H * s.belt);
  return {
    L, W, zF, zR, zWs, zRf, zRr, zDk,
    noseY: lerp(beltY - 0.06, s.rideH + 0.42, s.nose * 0.85),
    beltY, roofY: H, tailY: lerp(beltY - 0.12, beltY + 0.02, s.tail), rockY: s.rideH + 0.1,
    arch: s.wheelR + 0.075, flare: s.fender, tumble: box ? 0.05 : 0.11,
    wheelZ: [s.wheelbase / 2, -s.wheelbase / 2], wheelR: s.wheelR,
  };
}

/** Height of the top line (hood, glass, roof, deck) at z. */
function topAt(p: Profile, z: number, s: CarShape) {
  const { zF, zR, zWs, zRf, zRr, zDk, noseY, beltY, roofY, tailY } = p;
  if (z >= zWs) { // hood: rises from the nose tip, slight crown
    const t = (zF - z) / Math.max(0.01, zF - zWs);
    return lerp(noseY, beltY, Math.pow(Math.min(1, t * 1.25), 0.65 + s.nose * 0.5));
  }
  if (z >= zRf) { const t = (zWs - z) / Math.max(0.01, zWs - zRf); return lerp(beltY, roofY, Math.sin(t * Math.PI / 2) ** 0.9); }
  if (z >= zRr) { const t = (z - zRr) / Math.max(0.01, zRf - zRr); return roofY + Math.sin(t * Math.PI) * 0.012; }
  if (z >= zDk) { const t = (zRr - z) / Math.max(0.01, zRr - zDk); return lerp(roofY, tailY, 1 - Math.cos(t * Math.PI / 2)); }
  const t = (zDk - z) / Math.max(0.01, zDk - zR);
  return lerp(tailY, tailY - 0.06, t);
}

function bottomAt(p: Profile, z: number) {
  let y = p.rockY;
  for (const wz of p.wheelZ) { const d = z - wz; if (Math.abs(d) < p.arch) y = Math.max(y, p.wheelR + Math.sqrt(p.arch * p.arch - d * d) - 0.02); }
  // bumpers sit a little higher at the very ends
  const end = Math.max(smooth(p.zF - 0.25, p.zF, z), smooth(p.zR + 0.25, p.zR, z));
  return y + end * 0.08;
}

function halfWidthAt(p: Profile, z: number, s: CarShape) {
  const t = z >= 0 ? z / p.zF : z / p.zR;              // 0 centre .. 1 ends
  const pow = s.style === 'van' || s.style === 'suv' ? 6 : 3.2 - s.nose * 0.8;
  let hw = (p.W / 2) * (1 - 0.16 * Math.pow(t, pow) - (z > 0 ? 0.06 * s.nose : 0) * Math.pow(t, 2));
  for (const wz of p.wheelZ) hw += p.flare * Math.exp(-(((z - wz) / (p.arch * 1.1)) ** 2));
  return hw;
}

const glassOpacity = (tint: number) => 0.4 + 0.5 * tint;
/** A bus passenger: any look but a race helmet. */
const riderLook = (n: number): DriverLook => { const l = lookFor(n); return l.head === 'helmet' ? { ...l, head: 'none' } : l; };

export interface CarMaterials { paint: THREE.MeshPhysicalMaterial; glass: THREE.MeshPhysicalMaterial; trim: THREE.MeshStandardMaterial; chrome: THREE.MeshStandardMaterial; lampF: THREE.MeshStandardMaterial; lampR: THREE.MeshStandardMaterial; rubber: THREE.MeshStandardMaterial; rim: THREE.MeshStandardMaterial; caliper: THREE.MeshStandardMaterial; plate: THREE.MeshStandardMaterial; glow: THREE.MeshBasicMaterial; }

/** Paint texture: base coat, the wrap, then the panel work (shut lines, seams, character line, pillar blackout,
 *  fuel cap, sill shading) drawn into the same map so the detail costs no geometry. u runs nose to tail; v runs
 *  from the sill (0 and 1) to the roof centre line (0.5), mirrored left and right. */
export function liveryCanvas(l: Livery, def: CarDef, size = 1024) {
  const W = size, H = size;
  const c = canvas(W, H), g = c.getContext('2d')!;
  g.save(); g.scale(W / 512, H / 512);
  liveryWrap(g, l, 512, 512);
  g.restore();
  if (def.shape.style !== 'keke') panelWork(g, def, W, H);
  return c;
}

function liveryWrap(g: CanvasRenderingContext2D, l: Livery, W: number, H: number) {
  g.fillStyle = l.paint; g.fillRect(0, 0, W, H);
  const band = (v0: number, v1: number, col: string) => { g.fillStyle = col; g.fillRect(0, v0 * H, W, (v1 - v0) * H); g.fillRect(0, (1 - v1) * H, W, (v1 - v0) * H); };
  const wc = l.wrapColor;
  switch (l.wrap) {
    case 'stripes': g.fillStyle = wc; g.fillRect(0, H * 0.455, W, H * 0.035); g.fillRect(0, H * 0.51, W, H * 0.035); break;
    case 'naija': g.fillStyle = '#008751'; g.fillRect(0, 0, W * 0.33, H); g.fillRect(W * 0.67, 0, W * 0.33, H); g.fillStyle = '#ffffff'; g.fillRect(W * 0.33, 0, W * 0.34, H); break;
    case 'danfo': band(0.115, 0.15, '#111111'); band(0.17, 0.185, '#111111'); break;
    case 'fire': {
      for (const side of [0, 1]) {
        g.save(); if (side) { g.translate(0, H); g.scale(1, -1); }
        const grd = g.createLinearGradient(0, 0, W * 0.6, 0); grd.addColorStop(0, '#ffe066'); grd.addColorStop(0.4, '#ff6a00'); grd.addColorStop(1, 'rgba(200,0,0,0)');
        g.fillStyle = grd; g.beginPath(); g.moveTo(0, H * 0.14);
        for (let k = 0; k <= 8; k++) { const x = (k / 8) * W * 0.62; g.quadraticCurveTo(x + 18, H * (0.2 + (k % 2) * 0.05), x + 30, H * (0.17 + 0.03 * Math.sin(k))); }
        g.lineTo(0, H * 0.32); g.closePath(); g.fill(); g.restore();
      }
      break;
    }
    case 'checker': { const s = 32; for (let y = 0; y < 3; y++) for (let x = 0; x < W / s; x++) if ((x + y) % 2) { g.fillStyle = wc; g.fillRect(x * s, H * 0.18 + y * s * 0.5, s, s * 0.5); g.fillRect(x * s, H * 0.82 - (y + 1) * s * 0.5, s, s * 0.5); } break; }
    case 'ankara': {
      // bold geometric wax print: concentric circles and diamonds in three colours
      const cols = [wc, '#f2a900', '#0a7d5a', '#c0392b'];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const cx = (x + 0.5) * W / 8, cy = (y + 0.5) * H / 8;
        if (cy > H * 0.35 && cy < H * 0.65) continue;
        g.fillStyle = cols[(x + y) % 4]; g.beginPath(); g.arc(cx, cy, 26, 0, Math.PI * 2); g.fill();
        g.fillStyle = cols[(x + y + 2) % 4]; g.beginPath(); g.moveTo(cx, cy - 16); g.lineTo(cx + 16, cy); g.lineTo(cx, cy + 16); g.lineTo(cx - 16, cy); g.fill();
      }
      break;
    }
    case 'adire': {
      // indigo resist dye: deep blue with pale spirals and ripples
      g.fillStyle = '#1d2f6f'; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(200,215,255,0.65)'; g.lineWidth = 4;
      for (let k = 0; k < 18; k++) { const cx = (k * 97) % W, cy = (k * 151) % H; for (let r = 6; r < 40; r += 9) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); } }
      break;
    }
  }
}

/** Shut lines and trim drawn in texture space. The loft spaces its stations unevenly, so z is mapped to u by
 *  inverting the same easing the loft uses. */
function panelWork(g: CanvasRenderingContext2D, def: CarDef, W: number, H: number) {
  const s = def.shape, p = profileOf(s);
  const ease = (t: number) => lerp(t, 0.5 - 0.5 * Math.cos(t * Math.PI), 0.55);
  const X = (z: number) => {
    const f = (z - p.zR) / (p.zF - p.zR);
    let lo = 0, hi = 1;
    for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (ease(m) < f) lo = m; else hi = m; }
    return (1 - (lo + hi) / 2) * W;
  };
  // ring point index (0 sill centre .. 12 roof centre) to canvas y on each side
  const Y = (h: number, right: boolean) => (right ? h / 24 : 1 - h / 24) * H;
  const both = (fn: (right: boolean) => void) => { fn(false); fn(true); };
  const px = W / 1024;
  const line = (x0: number, y0: number, x1: number, y1: number, w = 2.2, col = 'rgba(0,0,0,0.6)') => { g.strokeStyle = col; g.lineWidth = w * px; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  const box = s.style === 'van' || s.style === 'suv';
  const twoDoor = s.style === 'hatch' || s.style === 'coupe' || s.style === 'super';
  const zA = p.zWs - 0.04, zB = (p.zRf + p.zRr) / 2, zC = box ? p.zRr + 0.55 : p.zRr + 0.05;
  const doors: [number, number][] = s.style === 'van' ? [[zA, zA - 0.95], [zB + 0.2, zB - 0.75]] : twoDoor ? [[zA, zB - 0.25]] : [[zA, zB + 0.02], [zB - 0.02, zC]];
  // sill and wheel arch shading, then a little road dust on the cars that have done a few Lagos years
  both((r) => {
    const gr = g.createLinearGradient(0, Y(0, r), 0, Y(2.2, r));
    gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, Math.min(Y(0, r), Y(2.2, r)), W, Math.abs(Y(2.2, r) - Y(0, r)));
  });
  if (def.id === 'tokunbo' || def.id === 'danfo') {
    for (let i = 0; i < 1400; i++) {
      const r = i % 2 === 0, h = Math.pow(Math.random(), 1.8) * 2.6;
      g.fillStyle = `rgba(${120 + Math.random() * 40},${96 + Math.random() * 30},${70},${0.05 + Math.random() * 0.08})`;
      g.fillRect(Math.random() * W, Y(h, r), (1 + Math.random() * 3) * px, (1 + Math.random() * 2) * px);
    }
  }
  // sculpted character line along the flank: a highlight over a shadow
  both((r) => {
    const yl = Y(4.15, r), dir = r ? 1 : -1;
    line(X(p.zF - 0.35), yl, X(p.zR + 0.3), yl, 2.6, 'rgba(255,255,255,0.22)');
    line(X(p.zF - 0.35), yl - dir * 3 * px, X(p.zR + 0.3), yl - dir * 3 * px, 2.6, 'rgba(0,0,0,0.2)');
  });
  // door shut lines: front and rear edges up to the belt, and the sill line along the bottom
  both((r) => {
    for (const [zf, zr] of doors) {
      line(X(zf), Y(1.3, r), X(zf), Y(5.9, r));
      line(X(zr), Y(1.3, r), X(zr), Y(5.9, r));
      line(X(zf), Y(1.3, r), X(zr), Y(1.3, r), 1.8);
    }
  });
  // bonnet shut line and the boot or tailgate line, straight across the top surfaces of both halves
  const hood = p.zWs + Math.min(0.12, (p.zF - p.zWs) * 0.15);
  line(X(hood), Y(9.3, true), X(hood), Y(9.3, false), 2.4);
  if (!box) { const boot = p.zDk - 0.02; line(X(boot), Y(9, true), X(boot), Y(9, false), 2.4); }
  else line(X(p.zR + 0.06), Y(2.4, true), X(p.zR + 0.06), Y(2.4, false), 2.4);
  // bonnet edges run forward to the nose on each side
  both((r) => { line(X(hood), Y(9.3, r), X(p.zF - 0.08), Y(8.6, r), 2); });
  // blacked-out pillar between the side windows
  if (s.style !== 'van') both((r) => {
    g.fillStyle = '#0b0c0e';
    const x0 = X(zB + 0.06), x1 = X(zB - 0.06);
    g.fillRect(Math.min(x0, x1), Math.min(Y(5.9, r), Y(8.4, r)), Math.abs(x1 - x0), Math.abs(Y(8.4, r) - Y(5.9, r)));
  });
  // window surround: a thin dark seal just under the glass line
  both((r) => { line(X(p.zWs - 0.02), Y(5.95, r), X(box ? p.zR + 0.25 : p.zDk + 0.05), Y(5.95, r), 2.8, 'rgba(10,10,12,0.75)'); });
  // fuel filler on the right rear quarter
  const fz = (box ? p.zR + 0.9 : p.zRr - 0.1), fy = Y(5.1, true), fx = X(fz);
  g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = 2 * px;
  g.beginPath(); g.roundRect(fx - 11 * px, fy - 10 * px, 22 * px, 20 * px, 5 * px); g.stroke();
  // black lower bumper lips at both ends
  g.fillStyle = 'rgba(16,17,19,0.9)';
  for (const [z0, z1] of [[p.zF - 0.02, p.zF - 0.2], [p.zR + 0.2, p.zR + 0.02]]) both((r) => {
    const x0 = X(z0), x1 = X(z1);
    g.fillRect(Math.min(x0, x1), Math.min(Y(0, r), Y(1.1, r)), Math.abs(x1 - x0), Math.abs(Y(1.1, r) - Y(0, r)));
  });
}

function plateCanvas(text: string) {
  const c = canvas(256, 64), g = c.getContext('2d')!;
  g.fillStyle = '#f4f4ee'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#1d6b3a'; g.fillRect(0, 0, 256, 13);
  g.fillStyle = '#ffffff'; g.font = '700 10px sans-serif'; g.textAlign = 'center'; g.fillText('EKO  .  CITY OF HUSTLE', 128, 10);
  g.fillStyle = '#c0392b'; g.font = '800 40px "Barlow Condensed", sans-serif'; g.fillText(text.slice(0, 9), 128, 54);
  g.strokeStyle = '#333'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 253, 61);
  return tex(c, { repeat: false });
}

const glowTex = (() => { let t: THREE.Texture | null = null; return () => {
  if (t) return t;
  const c = canvas(128), g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  t = tex(c, { repeat: false }); return t; }; })();

export function makeCarMaterials(l: Livery, def: CarDef, mapSize = 1024, imported = false): CarMaterials {
  // an imported body carries its own panels: its paint is a plain colour (or the model's texture, recoloured)
  const map = imported ? null : tex(liveryCanvas(l, def, mapSize), { repeat: false, aniso: 8 });
  const finish = l.finish;
  const paint = new THREE.MeshPhysicalMaterial({
    map, color: imported ? new THREE.Color(l.paint) : new THREE.Color(0xffffff), roughness: finish === 'matte' ? 0.62 : finish === 'chrome' ? 0.06 : 0.32,
    metalness: finish === 'chrome' ? 1 : finish === 'metallic' ? 0.62 : finish === 'pearl' ? 0.35 : 0.08,
    clearcoat: finish === 'matte' ? 0 : 1, clearcoatRoughness: 0.06,
    iridescence: finish === 'pearl' ? 0.6 : 0, iridescenceIOR: 1.6,
    sheen: finish === 'pearl' ? 0.4 : 0, envMapIntensity: 1.15,
  });
  return {
    paint,
    // tinted, not blacked out: the driver shows through, darker as the tint goes up
    glass: new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0x0c1218).lerp(new THREE.Color(0x3a4a58), 1 - l.tint), roughness: 0.04, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.6, transparent: true, opacity: glassOpacity(l.tint) }),
    trim: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.55, metalness: 0.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.08, metalness: 1 }),
    lampF: new THREE.MeshStandardMaterial({ color: 0xf8f8ff, emissive: new THREE.Color(0xfff6e6), emissiveIntensity: 1.2, roughness: 0.1, metalness: 0.3 }),
    lampR: new THREE.MeshStandardMaterial({ color: 0x5a0808, emissive: new THREE.Color(0xff1a1a), emissiveIntensity: 0.9, roughness: 0.2 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: new THREE.Color(l.rimColor), roughness: 0.22, metalness: 0.95 }),
    caliper: new THREE.MeshStandardMaterial({ color: def.cls === 'super' ? 0xffc400 : 0xd0141c, roughness: 0.4, metalness: 0.3 }),
    plate: new THREE.MeshStandardMaterial({ map: plateCanvas(l.plate), roughness: 0.5 }),
    glow: new THREE.MeshBasicMaterial({ map: glowTex(), color: new THREE.Color(l.glow ?? '#000000'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  };
}

// ------------------------------------------------------------------------------------------- body loft

function loftBody(s: CarShape, p: Profile) {
  const N = 64; // stations
  const pos: number[] = [], uv: number[] = [];
  const idxPaint: number[] = [], idxGlass: number[] = [];
  // half ring parameter points: bottom centre .. roof centre (13 points)
  const ringN = 13;
  const rings: number[][][] = [];
  const zs: number[] = [];
  for (let k = 0; k <= N; k++) {
    // denser near the ends so the nose and tail round off well
    const u = k / N, e = 0.5 - 0.5 * Math.cos(u * Math.PI);
    const z = lerp(p.zR + 0.005, p.zF - 0.005, lerp(u, e, 0.55));
    zs.push(z);
    const yb = bottomAt(p, z), yt = topAt(p, z, s);
    const hw = halfWidthAt(p, z, s);
    const endF = smooth(p.zF - 0.32, p.zF, z), endR = smooth(p.zR + 0.28, p.zR, z);
    const roundEnd = Math.max(endF, endR);
    const cabin = z < p.zWs && z > p.zDk;
    const shoulderY = cabin ? p.beltY : Math.min(yt - 0.02, lerp(p.beltY, yt, 0.6));
    const tw = cabin ? hw * (1 - p.tumble) : hw * 0.93;
    const ring: number[][] = [];
    const sideBulge = hw * (1 - roundEnd * 0.16);
    // flat flanks with a crisp shoulder crease, the way modern bodies are drawn
    const pts2: [number, number][] = [
      [0, yb + 0.03],
      [sideBulge * 0.9, yb],
      [sideBulge * 0.985, lerp(yb, shoulderY, 0.22)],
      [sideBulge, lerp(yb, shoulderY, 0.6)],
      [sideBulge * 0.996, lerp(yb, shoulderY, 0.9)],
      [sideBulge * 0.965, shoulderY],
      [lerp(sideBulge * 0.95, tw, 0.35), lerp(shoulderY, yt, cabin ? 0.08 : 0.4)],
      [lerp(sideBulge * 0.95, tw, 0.75), lerp(shoulderY, yt, cabin ? 0.55 : 0.75)],
      [tw * (1 - roundEnd * 0.2), lerp(shoulderY, yt, cabin ? 0.92 : 0.93)],
      [tw * 0.88 * (1 - roundEnd * 0.25), yt - 0.005],
      [tw * 0.62 * (1 - roundEnd * 0.25), yt + 0.012],
      [tw * 0.3 * (1 - roundEnd * 0.25), yt + 0.02],
      [0, yt + 0.022],
    ];
    for (const [x, y] of pts2) ring.push([x * (1 - roundEnd * 0.1), y, z]);
    rings.push(ring);
  }
  // emit both halves: left (negative x) uses mirrored rings
  const stride = ringN * 2 - 1;
  for (let k = 0; k <= N; k++) {
    const r = rings[k];
    for (let j = 0; j < stride; j++) {
      const half = j < ringN ? ringN - 1 - j : j - ringN + 1;
      const sgn = j < ringN ? -1 : 1;
      const pnt = r[half];
      pos.push(pnt[0] * sgn, pnt[1], pnt[2]);
      // v is 0.5 along the roof centre and falls toward the sills on both sides, so wraps can mirror left and right
      uv.push(1 - k / N, j <= ringN - 1 ? 0.5 - j / (2 * (ringN - 1)) : 0.5 + (stride - 1 - j) / (2 * (ringN - 1)));
    }
  }
  // decide glass or paint per face: side windows in the roof zone, windscreen and rear glass on top
  for (let k = 0; k < N; k++) {
    const zm = (zs[k] + zs[k + 1]) / 2;
    const roofZone = zm < p.zRf - 0.04 && zm > p.zRr + 0.04;
    const screen = zm >= p.zRf + 0.02 && zm < p.zWs - 0.03;
    const rear = zm <= p.zRr - 0.02 && zm > p.zDk + 0.02;
    const bpillar = Math.abs(zm - (p.zRf + p.zRr) / 2) < 0.045 && s.style !== 'van';
    const vanPillars = s.style === 'van' && Math.abs(((zm - p.zRr) % 0.62)) < 0.05;
    for (let j = 0; j < stride - 1; j++) {
      const half = j < ringN - 1 ? ringN - 2 - j : j - ringN + 1; // segment index from the bottom centre outward on each side
      const a = k * stride + j, b = a + 1, c = a + stride, d = c + 1;
      let glass = false;
      if (half >= 6 && half <= 8 && roofZone && !bpillar && !vanPillars) glass = true;       // side windows
      if (half >= 9 && (screen || rear)) glass = true;                                       // windscreen and rear window
      if (half === 8 && (screen || rear)) glass = true;
      const list = glass ? idxGlass : idxPaint;
      list.push(a, b, c, b, d, c);
    }
  }
  // close the nose and tail with fans
  const capEnd = (k: number, front: boolean) => {
    const base = pos.length / 3;
    const r = rings[k];
    const cy = (r[0][1] + r[ringN - 1][1]) / 2;
    pos.push(0, cy, r[0][2] + (front ? 0.004 : -0.004)); uv.push(front ? 0 : 1, 0.5);
    for (let j = 0; j < stride - 1; j++) {
      const a = k * stride + j, b = a + 1;
      if (front) idxPaint.push(base, a, b); else idxPaint.push(base, b, a);
    }
  };
  capEnd(N, true); capEnd(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...idxPaint, ...idxGlass]);
  g.addGroup(0, idxPaint.length, 0);
  g.addGroup(idxPaint.length, idxGlass.length, 1);
  g.computeVertexNormals();
  // the roof centre line is stored twice (one copy per side); share one normal so there is no crease
  const nor = g.attributes.normal as THREE.BufferAttribute;
  for (let k = 0; k <= N; k++) {
    const a = k * stride, b = k * stride + stride - 1;
    const nx = (nor.getX(a) + nor.getX(b)) / 2, ny = (nor.getY(a) + nor.getY(b)) / 2, nz = (nor.getZ(a) + nor.getZ(b)) / 2;
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.setXYZ(a, nx / l, ny / l, nz / l); nor.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return fixNormals(g);
}

// ------------------------------------------------------------------------------------------- wheels

function rimGeometry(style: RimStyle, r: number, w: number): THREE.BufferGeometry {
  if (style === 'stock') style = 'five';
  const parts: THREE.BufferGeometry[] = [];
  const barrel = new THREE.CylinderGeometry(r, r, w * 0.92, 28, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);
  const face = (g: THREE.BufferGeometry) => { g.rotateZ(Math.PI / 2); g.translate(w * 0.38, 0, 0); parts.push(g); };
  const hub = new THREE.CylinderGeometry(r * 0.22, r * 0.26, w * 0.2, 16); face(hub);
  const lip = new THREE.TorusGeometry(r * 0.97, r * 0.05, 6, 32); lip.rotateY(Math.PI / 2); lip.translate(w * 0.44, 0, 0); parts.push(lip);
  const spoke = (count: number, width: number, depth: number, twist = 0, inner = 0.22, outer = 0.94) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const b = new THREE.BoxGeometry(depth, r * (outer - inner), width);
      b.translate(0, r * (inner + outer) / 2, 0);
      b.rotateX(a + twist);
      b.translate(w * 0.36, 0, 0);
      parts.push(b);
    }
  };
  switch (style) {
    case 'five': spoke(5, r * 0.22, w * 0.16); break;
    case 'split': spoke(7, r * 0.09, w * 0.14); spoke(7, r * 0.09, w * 0.14, 0.12); break;
    case 'multi': spoke(20, r * 0.045, w * 0.1); break;
    case 'mesh': spoke(12, r * 0.05, w * 0.1, 0.3); spoke(12, r * 0.05, w * 0.1, -0.3); break;
    case 'turbine': spoke(14, r * 0.12, w * 0.08, 0.5, 0.3, 0.92); break;
    case 'dish': { const d = new THREE.CylinderGeometry(r * 0.9, r * 0.9, w * 0.06, 28); face(d); spoke(8, r * 0.05, w * 0.12, 0, 0.6, 0.9); break; }
  }
  const merged = mergeGeos(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

function tyreGeometry(r: number, w: number) {
  const pts: THREE.Vector2[] = [];
  const ri = r * 0.72;
  const prof: [number, number][] = [[ri, -w / 2], [r * 0.93, -w / 2], [r * 0.985, -w * 0.42], [r, -w * 0.25], [r, w * 0.25], [r * 0.985, w * 0.42], [r * 0.93, w / 2], [ri, w / 2]];
  for (const [x, y] of prof) pts.push(new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 32);
  g.rotateZ(Math.PI / 2);
  return g;
}

export function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0 : g0;
    const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute, u = g.attributes.uv as THREE.BufferAttribute | undefined;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off); else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return fixNormals(out);
}

// ------------------------------------------------------------------------------------------- assembly

// ------------------------------------------------------------------------------------------- the driver

interface Seat { x: number; z: number; hipY: number; headY: number; wheelY: number; bar: boolean }
/** The inside of a closed car, seen through tinted glass: a dark tub up to the belt line and two seat backs. */
interface Cabin { w: number; y0: number; y1: number; z0: number; z1: number }

/** The driver as one mesh with vertex colours: head, torso, arms, the wheel and their headwear. Left hand drive,
 *  as in Nigeria; a keke rider sits in the middle of the cab with handlebars. Passengers, when there are any, sit
 *  upright behind on bench seats. */
function driverGeometry(look: DriverLook, seat: Seat, cabin: Cabin | null, riders: { x: number; z: number; look: DriverLook }[] = []): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const col = new THREE.Color();
  const put = (g: THREE.BufferGeometry, colour: string, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    const geo = (g.index ? g.toNonIndexed() : g).applyMatrix4(m);
    col.set(colour);
    const n = geo.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geo.deleteAttribute('uv');
    parts.push(geo);
  };
  const skin = SKINS[look.skin] ?? SKINS[2], dark = '#16100e';
  const { x, z, hipY, headY, wheelY } = seat;
  const shoulderY = headY - 0.19, torsoH = Math.max(0.2, shoulderY - hipY + 0.04);
  if (cabin) {
    const { w, y0, y1, z0, z1 } = cabin;
    put(new THREE.BoxGeometry(w, y1 - y0, z1 - z0), '#17181c', 0, (y0 + y1) / 2, (z0 + z1) / 2);
    const backH = Math.max(0.3, headY - 0.06 - y1);
    for (const sx of [x, -x]) put(new THREE.BoxGeometry(0.44, backH, 0.09), '#22232a', sx, y1 + backH / 2, z - 0.22, -0.12);
  }
  // torso and shoulders, with the accent at the collar
  put(new THREE.BoxGeometry(0.36, torsoH, 0.22), look.top, x, hipY + torsoH / 2, z - 0.04);
  put(new THREE.BoxGeometry(0.2, 0.04, 0.2), look.accent, x, shoulderY + 0.04, z - 0.02);
  put(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8), skin, x, headY - 0.13, z);
  put(new THREE.SphereGeometry(0.105, 12, 9), skin, x, headY, z, 0, 0, 0, 1, 1.12, 1);
  // arms out to the wheel or the bars
  const reach = 0.34;
  for (const side of [-1, 1]) {
    const sx = x + side * 0.17, sy = shoulderY - 0.02, hx = x + side * (seat.bar ? 0.26 : 0.13), hy = wheelY + 0.04, hz = z + reach;
    const dx = hx - sx, dy = hy - sy, dz = hz - (z - 0.02), len = Math.hypot(dx, dy, dz);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const e = new THREE.Euler().setFromQuaternion(q);
    put(new THREE.CylinderGeometry(0.04, 0.045, len, 6), look.top, (sx + hx) / 2, (sy + hy) / 2, (z - 0.02 + hz) / 2, e.x, e.y, e.z);
    put(new THREE.SphereGeometry(0.035, 6, 5), skin, hx, hy, hz);
  }
  if (seat.bar) put(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 6), '#1b1b1d', x, wheelY + 0.04, z + reach + 0.02, 0, 0, Math.PI / 2);
  else put(new THREE.TorusGeometry(0.16, 0.022, 6, 18), '#141416', x, wheelY + 0.04, z + reach + 0.03, -0.45);
  // headwear
  const hat = (look: DriverLook, x: number, hy: number, z: number) => {
    const acc = look.accent;
    switch (look.head) {
      case 'none': put(new THREE.SphereGeometry(0.108, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), dark, x, hy + 0.012, z - 0.004); break;
      case 'cap':
        put(new THREE.SphereGeometry(0.114, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.45), acc, x, hy + 0.015, z);
        put(new THREE.BoxGeometry(0.17, 0.014, 0.11), acc, x, hy + 0.04, z + 0.12, -0.12);
        break;
      case 'fila':
        put(new THREE.CylinderGeometry(0.085, 0.113, 0.12, 12), acc, x, hy + 0.09, z, 0, 0, 0.28);
        put(new THREE.BoxGeometry(0.08, 0.05, 0.15), acc, x - 0.07, hy + 0.15, z, 0, 0, 0.55);
        break;
      case 'gele':
        put(new THREE.CylinderGeometry(0.2, 0.11, 0.16, 14, 1, true), acc, x, hy + 0.12, z - 0.01);
        put(new THREE.TorusGeometry(0.115, 0.03, 6, 16), acc, x, hy + 0.05, z, Math.PI / 2);
        put(new THREE.CircleGeometry(0.2, 14), acc, x, hy + 0.2, z - 0.01, -Math.PI / 2);
        break;
      case 'durag':
        put(new THREE.SphereGeometry(0.112, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), acc, x, hy + 0.01, z);
        put(new THREE.BoxGeometry(0.05, 0.16, 0.02), acc, x + 0.02, hy - 0.09, z - 0.11, 0.25);
        break;
      case 'helmet':
        put(new THREE.SphereGeometry(0.135, 14, 10), acc, x, hy + 0.005, z);
        put(new THREE.BoxGeometry(0.18, 0.065, 0.06), '#0c1016', x, hy + 0.0, z + 0.105);
        put(new THREE.BoxGeometry(0.035, 0.012, 0.25), look.top, x, hy + 0.136, z, 0, 0, 0);
        break;
    }
  };
  hat(look, x, headY, z);
  // passengers: upright, hands in laps, a bench back behind each row
  const rows = new Set<number>();
  for (const r of riders) {
    const top = r.look.top, sk = SKINS[r.look.skin] ?? SKINS[2];
    put(new THREE.BoxGeometry(0.34, torsoH, 0.2), top, r.x, hipY + torsoH / 2, r.z - 0.02);
    put(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8), sk, r.x, headY - 0.13, r.z);
    put(new THREE.SphereGeometry(0.1, 10, 8), sk, r.x, headY, r.z, 0, 0, 0, 1, 1.12, 1);
    hat(r.look, r.x, headY, r.z);
    rows.add(Math.round(r.z * 100));
  }
  if (cabin) for (const rz of rows) { const backH = Math.max(0.3, headY - 0.1 - cabin.y1); put(new THREE.BoxGeometry(cabin.w * 0.96, backH, 0.08), '#22232a', 0, cabin.y1 + backH / 2, rz / 100 - 0.2, -0.1); }
  // one geometry: positions, normals and colours, no index
  let count = 0; for (const g of parts) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), cc = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array as Float32Array, o); nor.set(g.attributes.normal.array as Float32Array, o); cc.set(g.attributes.color.array as Float32Array, o);
    o += g.attributes.position.count * 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  return fixNormals(out);
}

const fwdV = new THREE.Vector3();
/** A car right under a chase camera fills the bottom third of the screen, which happens off the grid behind every
 *  player: see through it until it pulls clear. Cars off to the side stay solid, and with `on` false every car does. */
export function seeThroughNear(cam: THREE.Camera, cars: CarModel[], skip: number, on: boolean) {
  cam.getWorldDirection(fwdV);
  const f = fwdV, fl = Math.hypot(f.x, f.z) || 1;
  const rx = f.z / fl, rz = -f.x / fl;
  for (let i = 0; i < cars.length; i++) {
    if (i === skip) continue;
    const m = cars[i];
    let k = 1;
    if (on) {
      const p = m.root.position, c = cam.position;
      const dx = p.x - c.x, dy = p.y + 0.7 - c.y, dz = p.z - c.z;
      const fwd = dx * f.x + dy * f.y + dz * f.z;
      const side = Math.abs(dx * rx + dz * rz);
      // gone right under the lens (a ghost of a car there reads as a grey slab), solid again 5.5 m out or 3.2 m aside
      if (fwd > -2.6 && fwd < 5.5 && side < 3.2) k = Math.max(Math.min(1, Math.max(0, (fwd - 1.5) / 4)), Math.min(1, Math.max(0, side - 2.2)));
    }
    m.fade(k);
  }
}

export class CarModel {
  root = new THREE.Group();      // moved by the sim (position, heading)
  body = new THREE.Group();      // pitch, roll, bounce
  wheels: { spin: THREE.Group; steer: THREE.Group; front: boolean; r: number }[] = [];
  mats: CarMaterials;
  headGlow: THREE.Mesh;
  underGlow: THREE.Mesh | null = null;
  brakeLights: THREE.Mesh[] = [];
  nitroFlames: THREE.Mesh[] = [];
  shape: CarShape;

  private detail: number;

  driver: THREE.Mesh | null = null;
  /** the imported body this car wears, if any; null means the procedural body built from shape */
  imported: CarAsset | null = null;
  private tailMats: THREE.MeshStandardMaterial[] = [];
  private headMats: THREE.MeshStandardMaterial[] = [];
  private extraMats: THREE.MeshStandardMaterial[] = [];
  private stockWheels: THREE.Object3D[] = [];
  private paintUniform: { value: THREE.Color } | null = null;
  constructor(public def: CarDef, livery: Livery, opts: { shadows: boolean; detail: number; driver?: DriverLook | null }) {
    const s = this.shape = def.shape;
    this.detail = opts.detail;
    const asset = carAsset(def.model);
    this.mats = makeCarMaterials(livery, def, opts.detail >= 2 ? 1024 : 512, !!asset);
    const m = this.mats;
    this.root.add(this.body);
    if (asset) this.buildImported(asset, livery);
    else {
      if (s.style === 'keke') this.buildKeke(s);
      else this.buildCar(s, opts.detail);
      this.mergeBody();
    }
    if (opts.driver !== null) this.setDriver(opts.driver ?? lookFor(livery.plate.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0));
    // headlight pool on the road for night driving
    this.headGlow = new THREE.Mesh(new THREE.PlaneGeometry(6, 13), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xfff0d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.headGlow.rotation.x = -Math.PI / 2;
    const dims = asset ? asset.meta : s;
    this.headGlow.position.set(0, 0.05, dims.length / 2 + 6);
    this.root.add(this.headGlow);
    if (livery.glow) {
      this.underGlow = new THREE.Mesh(new THREE.PlaneGeometry(dims.width + 1.2, dims.length + 1.2), m.glow);
      this.underGlow.rotation.x = -Math.PI / 2; this.underGlow.position.y = 0.04;
      this.root.add(this.underGlow);
    }
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== this.headGlow && o !== this.underGlow) { o.castShadow = opts.shadows; o.receiveShadow = false; } });
  }

  // ------------------------------------------------------------------------------------------- imported bodies

  /** Clone an imported body: geometry and textures stay shared, every material is this car's own (paint follows
   *  the livery, glass the tint, and a faded car fades alone). Wheels go on the same spin and steer pivots as the
   *  procedural ones. */
  private buildImported(a: CarAsset, l: Livery) {
    this.imported = a;
    const meta = a.meta, cache = new Map<THREE.Material, THREE.Material>();
    const remat = (o: THREE.Object3D) => o.traverse((x) => {
      const mesh = x as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((mm) => this.importMat(mm, cache, meta)) : this.importMat(mesh.material, cache, meta);
    });
    const body = a.body.clone(true);
    remat(body);
    this.body.add(body);
    meta.wheels.forEach((w, i) => {
      const steer = new THREE.Group(); steer.position.set(w.x, w.y, w.z);
      const spin = new THREE.Group(); steer.add(spin);
      const wheel = a.wheels[i].clone(true); wheel.position.set(0, 0, 0);
      remat(wheel);
      spin.add(wheel);
      this.stockWheels.push(wheel);
      this.root.add(steer);
      this.wheels.push({ spin, steer, front: w.z > 0, r: w.r });
    });
    if (l.rims !== 'stock') this.setRims(l.rims);
  }

  private importMat(src: THREE.Material, cache: Map<THREE.Material, THREE.Material>, meta: CarAssetMeta): THREE.Material {
    const hit = cache.get(src);
    if (hit) return hit;
    const sm = src as THREE.MeshStandardMaterial;
    let out: THREE.Material;
    if (src.name === 'paint') {
      const p = this.mats.paint;
      p.normalMap = sm.normalMap ?? null; p.aoMap = sm.aoMap ?? null;
      if (meta.paintMode === 'hue' && sm.map) { const colour = p.color.clone(); p.map = sm.map; p.color.set(0xffffff); this.hueShift(p, meta, colour); }
      out = p;
    } else if (src.name === 'glass') out = this.mats.glass;
    else {
      const c = sm.clone();
      const n = src.name.toLowerCase(), col = c.color;
      // red lamps brake, bright lamps glow at night; everything else just reflects the sky
      if (/brake|tail|stop|luz2|reverse/.test(n) || (col && col.r > 0.25 && col.g < 0.12 && col.b < 0.12)) { c.emissive = new THREE.Color(0xff1a1a); c.emissiveIntensity = 0.5; this.tailMats.push(c); }
      else if (/head|lamp|light|luz|bulb|indicator/.test(n)) { c.emissive = new THREE.Color(0xfff2dd); c.emissiveIntensity = 0.3; this.headMats.push(c); }
      this.extraMats.push(c);
      out = c;
    }
    cache.set(src, out);
    return out;
  }

  /** Paint baked into a texture: texels near the model's own paint hue take the player's colour, keeping the
   *  texture's shading; lamps, trim and carbon keep theirs. */
  private hueShift(p: THREE.MeshPhysicalMaterial, meta: CarAssetMeta, colour: THREE.Color) {
    const uPaint = { value: colour };
    this.paintUniform = uPaint;
    p.customProgramCacheKey = () => 'paint-hue';
    p.onBeforeCompile = (sh) => {
      sh.uniforms.uPaint = uPaint; sh.uniforms.uHue = { value: meta.paintHue }; sh.uniforms.uVal = { value: Math.max(0.05, meta.paintVal) };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uPaint; uniform float uHue; uniform float uVal;')
        .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 c = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
          float h = 0.0;
          if (d > 1e-4) { if (mx == c.r) h = mod((c.g - c.b) / d, 6.0); else if (mx == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0; h /= 6.0; }
          float sat = mx > 0.0 ? d / mx : 0.0;
          float dh = abs(fract(h - uHue + 0.5) - 0.5);
          float m = smoothstep(0.075, 0.035, dh) * smoothstep(0.2, 0.42, sat);
          diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * clamp(mx / uVal, 0.0, 1.4), m);
        }`);
    };
    p.needsUpdate = true;
  }

  private buildCar(s: CarShape, detail: number) {
    const m = this.mats, p = profileOf(s);
    const body = new THREE.Mesh(loftBody(s, p), [m.paint, m.glass]);
    this.body.add(body);
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); this.body.add(o); return o; };
    const hwF = halfWidthAt(p, p.zF - 0.06, s), hwR = halfWidthAt(p, p.zR + 0.06, s);
    const frontTop = topAt(p, p.zF - 0.04, s), rearTop = topAt(p, p.zR + 0.04, s);
    const lampY = Math.min(frontTop - 0.08, p.beltY - 0.05);
    // headlamps
    if (s.lights === 'bar') add(new THREE.BoxGeometry(hwF * 1.7, 0.05, 0.06), m.lampF, 0, lampY, p.zF - 0.01);
    for (const sd of [-1, 1]) {
      const lx = sd * hwF * 0.66;
      if (s.lights === 'round') { const g = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 18); g.rotateX(Math.PI / 2); add(g, m.lampF, lx, lampY - 0.02, p.zF - 0.02); add(new THREE.TorusGeometry(0.105, 0.016, 6, 18), m.chrome, lx, lampY - 0.02, p.zF + 0.005); }
      else if (s.lights === 'quad') { for (const ox of [-0.09, 0.09]) { const g = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16); g.rotateX(Math.PI / 2); add(g, m.lampF, lx + ox, lampY - 0.03, p.zF - 0.02); } }
      else if (s.lights === 'slim') { const l = add(new THREE.BoxGeometry(hwF * 0.5, 0.045, 0.08), m.lampF, sd * hwF * 0.6, lampY, p.zF - 0.03); l.rotation.z = sd * -0.12; }
      else add(new THREE.BoxGeometry(hwF * 0.42, 0.09, 0.07), m.lampF, sd * hwF * 0.62, lampY - 0.03, p.zF - 0.02);
      // tail lamps
      const tl = add(new THREE.BoxGeometry(s.lights === 'bar' ? hwR * 0.9 : hwR * 0.5, 0.08, 0.06), m.lampR, sd * hwR * (s.lights === 'bar' ? 0.46 : 0.62), Math.min(rearTop - 0.08, p.beltY - 0.04), p.zR + 0.01);
      this.brakeLights.push(tl);
      // mirrors at the base of the windscreen
      if (s.style !== 'super' || detail > 0) {
        const my = p.beltY + 0.08, mz = p.zWs - 0.12, mx = sd * (halfWidthAt(p, mz, s) * (1 - p.tumble) + 0.1);
        add(new THREE.BoxGeometry(0.2, 0.11, 0.07), m.paint, mx, my, mz);
        add(new THREE.BoxGeometry(0.06, 0.03, 0.03), m.trim, mx - sd * 0.08, my - 0.04, mz);
      }
      // door handle
      const hz = (p.zRf + p.zRr) / 2 + 0.25;
      add(new THREE.BoxGeometry(0.02, 0.025, 0.14), m.chrome, sd * (halfWidthAt(p, hz, s) + 0.005), p.beltY - 0.08, hz);
      // exhaust
      if (s.style !== 'van') { const eg = new THREE.CylinderGeometry(0.045, 0.05, 0.18, 12); eg.rotateX(Math.PI / 2); add(eg, m.chrome, sd * hwR * (s.style === 'super' ? 0.18 : 0.55), p.rockY + 0.04, p.zR - 0.02); }
    }
    if (s.lights === 'bar') this.brakeLights.push(add(new THREE.BoxGeometry(hwR * 1.6, 0.035, 0.05), m.lampR, 0, Math.min(rearTop - 0.06, p.beltY - 0.02), p.zR + 0.005));
    // grille and intake
    const gw = s.style === 'super' ? hwF * 1.2 : hwF * 0.95, gy = (p.rockY + lampY) / 2;
    add(new THREE.BoxGeometry(gw, Math.max(0.08, lampY - p.rockY - 0.14), 0.04), m.trim, 0, gy, p.zF + 0.002);
    if (s.style === 'suv' || s.style === 'muscle' || s.style === 'sedan') add(new THREE.BoxGeometry(gw + 0.04, 0.02, 0.05), m.chrome, 0, gy + (lampY - p.rockY) * 0.3, p.zF + 0.008);
    if (s.style === 'super' || s.style === 'hatch' || s.style === 'coupe') add(new THREE.BoxGeometry(hwF * 1.9, 0.025, 0.22), m.trim, 0, p.rockY - 0.02, p.zF - 0.06); // splitter
    // plates
    const plate = new THREE.BoxGeometry(0.52, 0.13, 0.02);
    add(plate, m.plate, 0, p.rockY + 0.18, p.zR - 0.005).rotation.y = Math.PI;
    if (s.style !== 'super') add(plate.clone(), m.plate, 0, p.rockY + 0.12, p.zF + 0.012);
    // spoilers and racks
    if (s.spoiler === 'wing') {
      const wy = p.tailY + 0.32, wz = p.zR + 0.22;
      add(new THREE.BoxGeometry(p.W * 0.92, 0.035, 0.32), m.trim, 0, wy, wz);
      for (const sd of [-1, 1]) { add(new THREE.BoxGeometry(0.03, 0.32, 0.12), m.trim, sd * p.W * 0.28, wy - 0.16, wz); add(new THREE.BoxGeometry(0.02, 0.12, 0.38), m.paint, sd * p.W * 0.46, wy + 0.03, wz); }
    } else if (s.spoiler === 'duck') add(new THREE.BoxGeometry(hwR * 1.7, 0.05, 0.18), m.paint, 0, rearTop + 0.04, p.zR + 0.1).rotation.x = -0.25;
    else if (s.spoiler === 'lip') add(new THREE.BoxGeometry(hwR * 1.6, 0.025, 0.08), m.trim, 0, rearTop + 0.015, p.zR + 0.06);
    else if (s.spoiler === 'roofrack') {
      const rw = halfWidthAt(p, (p.zRf + p.zRr) / 2, s) * (1 - p.tumble) * 0.85;
      for (const sd of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.04, p.zRf - p.zRr), m.chrome, sd * rw, p.roofY + 0.08, (p.zRf + p.zRr) / 2);
      for (let z = p.zRr + 0.15; z < p.zRf; z += 0.4) add(new THREE.BoxGeometry(rw * 2, 0.025, 0.03), m.trim, 0, p.roofY + 0.1, z);
    }
    if (s.style === 'van') {
      // the danfo: sliding door seam and a roof-mounted luggage frame in battered chrome
      add(new THREE.BoxGeometry(0.01, p.beltY - p.rockY + 0.3, 0.012), m.trim, halfWidthAt(p, 0, s) + 0.002, (p.beltY + p.rockY) / 2 + 0.1, 0.3);
    }
    if (s.style === 'super') { for (const sd of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.22, 0.6), m.trim, sd * (halfWidthAt(p, -0.2, s) - 0.01), p.beltY - 0.12, -0.2); }
    // wheels
    const wW = s.wheelR * 0.72;
    for (const wz of p.wheelZ) for (const sd of [-1, 1]) this.addWheel(sd * (s.track / 2), wz, s.wheelR, wW, wz > 0, sd);
    // wheel well liners
    for (const wz of p.wheelZ) for (const sd of [-1, 1]) {
      const g = new THREE.CylinderGeometry(p.arch, p.arch, 0.34, 18, 1, true, 0, Math.PI);
      g.rotateZ(Math.PI / 2);
      const o = add(g, m.trim, sd * (halfWidthAt(p, wz, s) - 0.2), s.wheelR, wz);
      o.rotation.y = 0;
      (o.material as THREE.Material).side = THREE.DoubleSide;
    }
  }

  /** Fold every static body part that shares a material into one mesh: a car drops from ~50 draw calls to ~10. */
  private mergeBody() {
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const o of [...this.body.children]) {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) continue; // the lofted shell keeps its paint and glass groups
      mesh.updateMatrix();
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
      const mat = mesh.material as THREE.Material;
      const list = byMat.get(mat) ?? [];
      list.push(g); byMat.set(mat, list);
      this.body.remove(mesh); mesh.geometry.dispose();
    }
    this.brakeLights = [];
    for (const [mat, list] of byMat) {
      const merged = new THREE.Mesh(mergeGeos(list), mat);
      for (const g of list) g.dispose();
      this.body.add(merged);
      if (mat === this.mats.lampR) this.brakeLights.push(merged);
    }
  }

  private addWheel(x: number, z: number, r: number, w: number, front: boolean, side: number) {
    const m = this.mats;
    const steer = new THREE.Group(); steer.position.set(x, r, z);
    const spin = new THREE.Group();
    steer.add(spin);
    const tyre = new THREE.Mesh(tyreGeometry(r, w), m.rubber);
    spin.add(tyre);
    const rim = new THREE.Mesh(rimGeometry(this.rimStyle, r * 0.7, w), m.rim);
    rim.scale.x = side; // face outward on both sides
    spin.add(rim);
    // brake disc and caliper behind the spokes: only on close-up cars, where you can see through the rim
    if (this.detail >= 2) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.03, 20), m.chrome);
      disc.rotation.z = Math.PI / 2; disc.position.x = side * w * 0.05;
      spin.add(disc);
      const cal = new THREE.Mesh(new THREE.BoxGeometry(0.08, r * 0.38, r * 0.3), m.caliper);
      cal.position.set(side * w * 0.12, r * 0.38, 0);
      steer.add(cal);
    }
    this.body.parent!.add(steer);
    this.wheels.push({ spin, steer, front, r });
  }
  rimStyle: RimStyle = 'five';

  private buildKeke(s: CarShape) {
    // tricycle taxi: a tub with a single front wheel, a canopy on pillars, and open sides
    const m = this.mats;
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); this.body.add(o); return o; };
    const L = s.length, W = s.width;
    add(new THREE.BoxGeometry(W, 0.5, L * 0.62), m.paint, 0, 0.55, -0.2);                         // rear tub
    add(new THREE.BoxGeometry(W * 0.62, 0.45, L * 0.3), m.paint, 0, 0.6, L * 0.3);                // cab nose
    add(new THREE.BoxGeometry(W * 1.02, 0.06, L * 0.95), m.paint, 0, 1.72, -0.05);                // canopy roof
    add(new THREE.BoxGeometry(W * 0.98, 0.04, L * 0.9), m.trim, 0, 1.68, -0.05);
    add(new THREE.BoxGeometry(W * 0.6, 0.6, 0.04), m.glass, 0, 1.25, L * 0.36).rotation.x = -0.25; // windscreen
    for (const [x, z] of [[-1, 0.33], [1, 0.33], [-1, -0.6], [1, -0.6]]) add(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 8), m.trim, x * W * 0.47, 1.22, z * L * 0.72 + 0.1);
    add(new THREE.BoxGeometry(W * 0.9, 0.3, 0.5), m.trim, 0, 0.98, -0.55);                         // back seat
    const hl = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 16); hl.rotateX(Math.PI / 2); add(hl, m.lampF, 0, 0.85, L * 0.47);
    for (const sd of [-1, 1]) this.brakeLights.push(add(new THREE.BoxGeometry(0.12, 0.08, 0.04), m.lampR, sd * W * 0.4, 0.7, -L * 0.52));
    add(new THREE.BoxGeometry(0.42, 0.11, 0.02), m.plate, 0, 0.5, -L * 0.52).rotation.y = Math.PI;
    // a stripe band in the second colour
    add(new THREE.BoxGeometry(W * 1.01, 0.08, L * 0.62), new THREE.MeshStandardMaterial({ color: 0x1a7a3a, roughness: 0.5 }), 0, 0.72, -0.2);
    const r = s.wheelR, w = 0.16;
    this.addWheel(0, s.wheelbase * 0.62, r, w, true, 1);
    this.addWheel(-s.track / 2, -s.wheelbase * 0.38, r, w, false, -1);
    this.addWheel(s.track / 2, -s.wheelbase * 0.38, r, w, false, 1);
  }

  setRims(style: RimStyle) {
    this.rimStyle = style;
    if (this.imported) {
      // factory wheels from the model, or our rims and tyres sized to fit its arches
      this.wheels.forEach((wh, i) => {
        const stock = this.stockWheels[i], w = this.imported!.meta.wheels[i];
        for (const c of [...wh.spin.children]) if (c !== stock) { wh.spin.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
        stock.visible = style === 'stock';
        if (style === 'stock') return;
        const width = Math.max(0.18, w.w * 0.92), side = w.x > 0 ? 1 : -1;
        const tyre = new THREE.Mesh(tyreGeometry(w.r, width), this.mats.rubber);
        const rim = new THREE.Mesh(rimGeometry(style, w.r * 0.7, width), this.mats.rim);
        rim.scale.x = side;
        wh.spin.add(tyre, rim);
      });
      this.fadeList = null;
      return;
    }
    for (const wh of this.wheels) {
      const rim = wh.spin.children[1] as THREE.Mesh;
      rim.geometry.dispose();
      rim.geometry = rimGeometry(style, wh.r * 0.7, wh.r * 0.72);
    }
  }

  /** Seat the driver: where the cabin is, under the roof, behind the windscreen; in a keke, front and centre. */
  setDriver(look: DriverLook) {
    if (this.driver) { this.body.remove(this.driver); this.driver.geometry.dispose(); (this.driver.material as THREE.Material).dispose(); this.driver = null; }
    const s = this.shape;
    let seat: Seat;
    let cabin: Cabin | null = null;
    const riders: { x: number; z: number; look: DriverLook }[] = [];
    let rearLimit = 0;
    const im = this.imported?.meta;
    if (im && im.wheels.length === 4) {
      // seated from the model's own measurements: behind the front axle, under the roof, on the left
      const zF = Math.max(...im.wheels.map((w) => w.z)), zR = Math.min(...im.wheels.map((w) => w.z));
      const low = im.height < 1.3;
      const headY = Math.min(im.height - 0.24, im.height * (low ? 0.72 : 0.8));
      seat = { x: im.width * 0.2, z: zF - (low ? 1.4 : 1.5), hipY: headY - 0.56, headY, wheelY: headY - 0.36, bar: false };
      rearLimit = zR - 0.1;
    } else if (s.style === 'keke') seat = { x: 0, z: s.length * 0.12, hipY: 0.88, headY: 1.42, wheelY: 1.06, bar: true };
    else {
      const p = profileOf(s);
      const headY = Math.min(p.roofY - 0.17, p.beltY + 0.3);
      seat = { x: s.width * 0.21, z: p.zRf - 0.3, hipY: Math.max(s.rideH + 0.22, headY - 0.62), headY, wheelY: p.beltY - 0.07, bar: false };
      // the tub stops just under the belt line, so it never shows outside the body
      cabin = { w: s.width * 0.84, y0: s.rideH + 0.2, y1: p.beltY - 0.04, z0: p.zRr - 0.05, z1: p.zWs - 0.08 };
      rearLimit = p.zRr + 0.3;
    }
    // a danfo is never empty: a passenger up front and most of the benches behind taken
    if (this.def.id === 'danfo') {
      const width = im ? im.width * 0.9 : s.width;
      const seed = look.skin * 97 + parseInt(look.top.slice(1), 16) % 1009 + parseInt(look.accent.slice(1), 16) % 613;
      const across = [-width * 0.27, 0, width * 0.27];
      let k = 0;
      riders.push({ x: -seat.x, z: seat.z, look: riderLook(seed + k++) });
      for (let rz = seat.z - 0.95; rz > rearLimit; rz -= 0.82) for (const rx of across) { const lk = riderLook(seed + k++); if ((seed + k * 7) % 10 < 7) riders.push({ x: rx, z: rz, look: lk }); }
    }
    // its own material, so a car seen through can fade its driver with it
    this.driver = new THREE.Mesh(driverGeometry(look, seat, cabin, riders), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }));
    this.body.add(this.driver);
    this.fadeList = null;
  }

  private fadeK = 1; private fadeList: THREE.Material[] | null = null;
  /** See through the whole car (1 is solid). Used for a rival right under the chase camera. */
  fade(k: number) {
    k = k > 0.98 ? 1 : Math.max(0, k);
    this.body.visible = k > 0.06;
    if (k === this.fadeK) return;
    if (!this.fadeList) {
      const all = new Set<THREE.Material>();
      this.root.traverse((o) => { const m = (o as THREE.Mesh).material; if (m && o !== this.headGlow) (Array.isArray(m) ? m : [m]).forEach((x) => all.add(x)); });
      this.fadeList = [...all];
      for (const m of this.fadeList) { m.userData.solidT = m.transparent; m.userData.solidO = m.opacity; }
    }
    const was = this.fadeK < 1, now = k < 1;
    for (const m of this.fadeList) {
      if (was !== now && !m.userData.solidT) { m.transparent = now; m.needsUpdate = true; }
      m.opacity = m.userData.solidO * k;
    }
    this.fadeK = k;
  }

  private envTex: THREE.Texture | null = null; private envK = -1;
  /** Follow the atmosphere's sky reflection; cheap to check every frame, rare to change. */
  private reflect() {
    const t = skyReflection.tex, k = skyReflection.intensity;
    if (t === this.envTex && k === this.envK) return;
    for (const m of [...Object.values(this.mats), ...this.extraMats] as THREE.Material[]) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      if ((m.envMap === null) !== (t === null)) m.needsUpdate = true;
      m.envMap = t;
      m.envMapIntensity = (m.userData.envBase ??= m.envMapIntensity) * k;
    }
    this.envTex = t; this.envK = k;
  }

  /** Per-frame pose: wheel spin and steer, body roll/pitch, lamps. */
  pose(dt: number, speed: number, steer: number, roll: number, pitch: number, braking: boolean, night: number, nitro: boolean) {
    this.reflect();
    for (const w of this.wheels) {
      w.spin.rotation.x += (speed / w.r) * dt;
      if (w.front) w.steer.rotation.y = -steer * 0.42;
    }
    this.body.rotation.z = roll;
    this.body.rotation.x = pitch;
    for (const b of this.brakeLights) (b.material as THREE.MeshStandardMaterial).emissiveIntensity = braking ? 3.2 : 0.6 + night * 0.8;
    for (const t of this.tailMats) t.emissiveIntensity = braking ? 3.2 : 0.4 + night * 0.9;
    for (const h of this.headMats) h.emissiveIntensity = 0.25 + night * 2.6;
    (this.mats.lampF as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + night * 3;
    (this.headGlow.material as THREE.MeshBasicMaterial).opacity = night * 0.5;
    this.headGlow.visible = night > 0.05;
    void nitro;
  }

  applyLivery(l: Livery) {
    if (this.imported) {
      if (this.paintUniform) this.paintUniform.value.set(l.paint); else this.mats.paint.color.set(l.paint);
    } else {
      const map = tex(liveryCanvas(l, this.def, this.detail >= 2 ? 1024 : 512), { repeat: false, aniso: 8 });
      this.mats.paint.map?.dispose();
      this.mats.paint.map = map;
    }
    const f = l.finish;
    this.mats.paint.roughness = f === 'matte' ? 0.62 : f === 'chrome' ? 0.06 : 0.32;
    this.mats.paint.metalness = f === 'chrome' ? 1 : f === 'metallic' ? 0.62 : f === 'pearl' ? 0.35 : 0.08;
    this.mats.paint.clearcoat = f === 'matte' ? 0 : 1;
    this.mats.paint.iridescence = f === 'pearl' ? 0.6 : 0;
    this.mats.paint.needsUpdate = true;
    this.mats.rim.color.set(l.rimColor);
    this.mats.glass.color.set(new THREE.Color(0x0c1218).lerp(new THREE.Color(0x3a4a58), 1 - l.tint));
    this.mats.glass.opacity = glassOpacity(l.tint) * this.fadeK;
    this.mats.glass.userData.solidO = glassOpacity(l.tint);
    if (this.underGlow) (this.underGlow.material as THREE.MeshBasicMaterial).color.set(l.glow ?? '#000');
    this.mats.plate.map?.dispose();
    this.mats.plate.map = plateCanvas(l.plate);
    if (l.rims !== this.rimStyle) this.setRims(l.rims);
  }

  dispose() {
    // an imported body's geometry and textures are shared by every car that wears it: only free our own
    const shared = new Set<THREE.BufferGeometry>();
    if (this.imported) { this.imported.body.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) shared.add(mm.geometry); }); for (const w of this.imported.wheels) w.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) shared.add(mm.geometry); }); }
    this.root.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh && !shared.has(mm.geometry)) mm.geometry.dispose(); });
    for (const mat of Object.values(this.mats)) {
      const tm = (mat as THREE.Material & { map?: THREE.Texture | null }).map;
      if (tm && !(this.imported && mat === this.mats.paint)) tm.dispose();
      (mat as THREE.Material).dispose();
    }
    for (const mat of this.extraMats) mat.dispose();
  }
}
