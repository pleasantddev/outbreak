// Street trade. Market women, mama put, suya at night, roasted corn, pure water, recharge card, okrika clothes and the
// pay toilet. Stalls appear by the roadside near markets, food spots, bus stops and your house, each with a trader who
// has a name, a temper and a memory of how you treated her. Everything is bought by haggling (see haggle.ts).
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import type { Actor } from '../../sim/types';
import type { SkillsSystem } from '../skills';
import { RT } from '../societyRuntime';
import { halfWidth, verge } from '../../world/roadspec';
import { lifeSystem, type Thing } from './index';
import { addMoodlet } from './needs';
import { openDeal, play, type Good, type Persona, type Memory, type DealState, type Move } from './haggle';
import { career } from '../careers/ranks';

type Kind = 'market' | 'mamaput' | 'suya' | 'corn' | 'water' | 'toilet' | 'recharge' | 'okrika';
interface Stall { key: string; kind: Kind; x: number; z: number; yaw: number; who: Persona; group: THREE.Group | null; actor: Actor | null; seed: number }

const GOODS: Record<Kind, Good[]> = {
  market: [
    { id: 'tomato', label: 'Tomatoes and pepper', unit: 'basin', fair: 1500, fx: { k: 'pantry', n: 1 }, qty2: true },
    { id: 'rice', label: 'Paint bucket of rice', fair: 3200, fx: { k: 'pantry', n: 2 }, qty2: true },
    { id: 'yam', label: 'Tuber of yam', fair: 2400, fx: { k: 'pantry', n: 1 }, qty2: true },
    { id: 'oil', label: 'Bottle of palm oil', fair: 1800, fx: { k: 'pantry', n: 1 } },
    { id: 'bundle', label: 'Full foodstuff bundle', fair: 7800, fx: { k: 'pantry', n: 5 } },
  ],
  mamaput: [
    { id: 'amala', label: 'Amala and ewedu', fair: 1800, fx: { k: 'eat', hunger: 55, mins: 20, social: 6 } },
    { id: 'jollof', label: 'Jollof rice and chicken', fair: 2500, fx: { k: 'eat', hunger: 70, mins: 25, fun: 6 } },
    { id: 'eba', label: 'Eba and egusi', fair: 2000, fx: { k: 'eat', hunger: 65, mins: 25 } },
    { id: 'pack', label: 'Takeaway pack', fair: 2600, fx: { k: 'takeaway', n: 1 } },
  ],
  suya: [
    { id: 'suya', label: 'Suya wrap', fair: 1500, fx: { k: 'eat', hunger: 30, mins: 10, fun: 10 }, qty2: true },
    { id: 'kilishi', label: 'Kilishi pack', fair: 2200, fx: { k: 'takeaway', n: 1 } },
  ],
  corn: [
    { id: 'corn', label: 'Roasted corn and ube', fair: 700, fx: { k: 'eat', hunger: 22, mins: 10, fun: 4 }, qty2: true },
    { id: 'boli', label: 'Boli and groundnut', fair: 800, fx: { k: 'eat', hunger: 28, mins: 10 } },
  ],
  water: [
    { id: 'pure', label: 'Pure water', fair: 50, fx: { k: 'drink', hunger: 2, comfort: 6, bladder: -6 }, fixed: true },
    { id: 'malt', label: 'Cold malt', fair: 600, fx: { k: 'drink', hunger: 6, fun: 8, bladder: -8 } },
    { id: 'zobo', label: 'Zobo', fair: 300, fx: { k: 'drink', fun: 5, bladder: -6 } },
  ],
  toilet: [
    { id: 'toilet', label: 'Use the toilet', fair: 100, fx: { k: 'toilet' }, fixed: true },
    { id: 'bath', label: 'Bath (bucket)', fair: 300, fx: { k: 'bath' }, fixed: true },
  ],
  recharge: [{ id: 'data', label: '1GB data', fair: 1000, fx: { k: 'data', fun: 18 } }, { id: 'card', label: 'Recharge card', fair: 500, fx: { k: 'data', fun: 6 } }],
  okrika: [{ id: 'shirt', label: 'Okrika shirt', fair: 2500, fx: { k: 'outfit' } }, { id: 'jean', label: 'Okrika jean', fair: 3500, fx: { k: 'outfit' } }],
};
const TITLE: Record<Kind, string> = { market: 'Foodstuff', mamaput: 'Mama Put', suya: 'Suya spot', corn: 'Corn and boli', water: 'Cold drinks', toilet: 'Pay toilet', recharge: 'Recharge card', okrika: 'Okrika' };
const NAMES_F = ['Mama Titi', 'Iya Basira', 'Mama Nkechi', 'Iya Bose', 'Mama Ronke', 'Iya Kudi', 'Mama Ifeoma', 'Iya Sade', 'Mama Grace', 'Iya Rasheedat', 'Mama Blessing', 'Iya Funmi'];
const NAMES_M = ['Mallam Sule', 'Baba Ibeji', 'Brother Chidi', 'Alhaji Musa', 'Uncle Tunde', 'Mallam Garba', 'Bros Kelvin', 'Baba Segun'];
const FEMALE: Record<Kind, number> = { market: 1, mamaput: 1, suya: 0, corn: 0.8, water: 0.7, toilet: 0.3, recharge: 0.4, okrika: 0.5 };

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function pointIn(x: number, z: number, p: ArrayLike<number>) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }

// ------------------------------------------------------------------ the stalls
const M = (c: number, r = 0.8, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra });
const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; };
const cyl = (rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 14) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y, z); o.castShadow = true; return o; };
function umbrella(r: () => number) {
  const g = new THREE.Group(); const cols = [[0xe53935, 0xffffff], [0x1e88e5, 0xfdd835], [0x43a047, 0xffffff], [0xfb8c00, 0x1e88e5], [0x8e24aa, 0xfdd835]][(r() * 5) | 0];
  const geo = new THREE.ConeGeometry(1.45, 0.55, 12, 1, true); const col = new Float32Array(geo.attributes.position.count * 3); const c0 = new THREE.Color(cols[0]), c1 = new THREE.Color(cols[1]);
  const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++) { const a = Math.atan2(pos.getZ(i), pos.getX(i)); const c = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12) % 2 ? c0 : c1; col.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const top = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })); top.position.y = 2.35; top.castShadow = true; g.add(top);
  g.add(cyl(0.025, 0.025, 2.3, M(0x9e9e9e, 0.4, { metalness: 0.6 }), 0, 1.15, 0, 6)); return g;
}
function sign(text: string, bg: string, fg = '#fff', w = 1.3) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d')!;
  x.fillStyle = bg; x.fillRect(0, 0, 256, 64); x.fillStyle = fg; x.font = '800 30px Inter, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }));
}
function buildStall(kind: Kind, seed: number) {
  const g = new THREE.Group(); const r = rng(seed); const wood = M(0x7a5434, 0.9);
  const table = (w = 1.4, d = 0.8, cloth?: number) => { const t = new THREE.Group(); t.add(box(w, 0.06, d, cloth ? M(cloth, 0.9) : wood, 0, 0.78, 0)); for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) t.add(box(0.06, 0.78, 0.06, wood, x * (w / 2 - 0.05), 0.39, z * (d / 2 - 0.05))); return t; };
  const stool = () => { const s = new THREE.Group(); s.add(cyl(0.2, 0.2, 0.05, M(0x1e88e5, 0.6), 0, 0.42, 0)); for (let i = 0; i < 4; i++) s.add(box(0.03, 0.42, 0.03, M(0x1e88e5, 0.6), Math.cos(i * 1.57) * 0.14, 0.21, Math.sin(i * 1.57) * 0.14)); return s; };
  const basin = (x: number, z: number, fill: number, col: number, y = 0.81) => { const b = cyl(0.26, 0.2, 0.12, M(0xc0c6cc, 0.35, { metalness: 0.7 }), x, y + 0.06, z, 16); g.add(b); const n = 9; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const s = new THREE.Mesh(new THREE.SphereGeometry(0.05 + r() * 0.015, 8, 6), M(col, 0.45)); s.position.set(x + Math.cos(a) * 0.13 * (i ? 1 : 0), y + 0.13 + (i ? 0 : 0.05) + fill * 0.02, z + Math.sin(a) * 0.13 * (i ? 1 : 0)); g.add(s); } };
  if (kind === 'toilet') {
    const blue = M(0x1565c0, 0.6); const cab = box(1.3, 2.3, 1.3, blue, 0, 1.15, -0.4); g.add(cab); const door = box(0.75, 1.9, 0.04, M(0x0d47a1, 0.5), 0, 0.97, 0.27); g.add(door);
    const s = sign('PAY TOILET ₦100', '#fdd835', '#111', 1.3); s.position.set(0, 2.05, 0.3); g.add(s);
    g.add(table(0.7, 0.45)); g.children[g.children.length - 1].position.set(1.0, 0, 0.6); const st = stool(); st.position.set(1.0, 0, 1.0); g.add(st);
    return g;
  }
  const um = umbrella(r); um.position.set(0.15, 0, -0.1); g.add(um);
  const st = stool(); st.position.set(0, 0, -0.75); g.add(st);
  if (kind === 'market') { g.add(table(1.5, 0.85, [0x6a1b9a, 0x00695c, 0xb71c1c][(r() * 3) | 0])); basin(-0.45, 0.1, 1, 0xd32f2f); basin(0.1, 0.12, 1, 0xff6f00); const sack = cyl(0.25, 0.3, 0.6, M(0xe8dcc0, 1), 0.95, 0.3, 0.45, 10); g.add(sack); const yam = cyl(0.07, 0.09, 0.45, M(0x6d4c41, 1), 0.5, 0.86, -0.15, 8); yam.rotation.z = Math.PI / 2; g.add(yam); const oil = cyl(0.06, 0.06, 0.28, M(0xff5722, 0.2, { transparent: true, opacity: 0.85 }), -0.6, 0.95, -0.2, 10); g.add(oil); }
  if (kind === 'mamaput') { g.add(table(1.6, 0.85, 0xfafafa)); for (let i = 0; i < 3; i++) { const p = cyl(0.2, 0.18, 0.3, M([0x37474f, 0x8d6e63, 0xb0bec5][i], 0.4, { metalness: 0.5 }), -0.5 + i * 0.5, 0.96, -0.05, 16); g.add(p); } const bench = box(1.8, 0.06, 0.3, wood, 0, 0.45, 1.3); g.add(bench); g.add(box(0.06, 0.45, 0.25, wood, -0.8, 0.22, 1.3), box(0.06, 0.45, 0.25, wood, 0.8, 0.22, 1.3)); const s = sign('MAMA PUT', '#c62828'); s.position.set(0, 1.7, 0.42); g.add(s); }
  if (kind === 'suya' || kind === 'corn') {
    const grill = new THREE.Group(); grill.add(box(1.1, 0.5, 0.55, M(0x263238, 0.5, { metalness: 0.6 }), 0, 0.55, 0)); for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) grill.add(box(0.04, 0.3, 0.04, M(0x263238, 0.5), x * 0.5, 0.15, z * 0.24));
    const coal = box(1.0, 0.04, 0.45, M(0x220000, 1, { emissive: new THREE.Color(0xff5a1f), emissiveIntensity: 1.6 }), 0, 0.82, 0); grill.add(coal); g.add(grill);
    if (kind === 'corn') for (let i = 0; i < 6; i++) { const c = cyl(0.035, 0.035, 0.22, M(0xf9a825, 0.6), -0.4 + i * 0.16, 0.87, 0.05, 8); c.rotation.x = Math.PI / 2; g.add(c); }
    else for (let i = 0; i < 7; i++) { const s = box(0.03, 0.03, 0.4, M(0x5d2a14, 0.7), -0.42 + i * 0.14, 0.87, 0); g.add(s); }
    const l = new THREE.PointLight(0xff7a2a, 3, 4, 2); l.position.set(0, 1.1, 0); g.add(l);
    const s = sign(kind === 'suya' ? 'SUYA' : 'CORN & UBE', '#111', '#ffb300', 1); s.position.set(0, 1.75, 0.42); g.add(s);
  }
  if (kind === 'water') { const cooler = box(0.9, 0.6, 0.55, M(0x1e88e5, 0.4), 0, 0.3, 0.05); g.add(cooler); g.add(box(0.92, 0.06, 0.57, M(0xffffff, 0.4), 0, 0.63, 0.05)); for (let i = 0; i < 5; i++) g.add(box(0.14, 0.04, 0.2, M(0xe3f2fd, 0.2, { transparent: true, opacity: 0.8 }), -0.3 + i * 0.15, 0.68, 0.05)); }
  if (kind === 'recharge') { g.add(table(0.8, 0.5, 0xfdd835)); const s = sign('RECHARGE CARD', '#fdd835', '#111', 1); s.position.set(0, 1.2, 0.27); g.add(s); }
  if (kind === 'okrika') { const rail = cyl(0.02, 0.02, 1.8, M(0x9e9e9e, 0.4, { metalness: 0.7 }), 0, 1.65, 0.1, 6); rail.rotation.z = Math.PI / 2; g.add(rail); g.add(cyl(0.02, 0.02, 1.65, M(0x9e9e9e, 0.4), -0.9, 0.82, 0.1, 6), cyl(0.02, 0.02, 1.65, M(0x9e9e9e, 0.4), 0.9, 0.82, 0.1, 6)); for (let i = 0; i < 7; i++) { const c = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.62), M(new THREE.Color().setHSL(r(), 0.6, 0.45).getHex(), 0.9, { side: THREE.DoubleSide })); c.position.set(-0.75 + i * 0.25, 1.32, 0.1); c.rotation.y = Math.PI / 2 + (r() - 0.5) * 0.4; g.add(c); } g.add(box(1.4, 0.3, 0.7, M(0x5d4037, 1), 0, 0.15, 0.7)); }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ------------------------------------------------------------------ the haggling sheet
const css = `
#hg{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translate(-50%,20px);opacity:0;pointer-events:none;transition:.22s;z-index:9;width:min(560px,94vw);border-radius:22px;padding:16px 18px 14px;
  background:rgba(12,14,22,.9);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);box-shadow:0 18px 50px rgba(0,0,0,.45);font-family:Inter,sans-serif;color:#f3f5f8}
#hg.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
#hg .hd{display:flex;align-items:center;gap:12px;margin-bottom:10px} #hg .av{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 16px Rajdhani,Inter;color:#0b0d14}
#hg .hd b{display:block;font-size:15.5px} #hg .hd i{font-style:normal;font-size:12px;color:#9ba3b4} #hg .hd .x{margin-left:auto;width:32px;height:32px;border-radius:10px;border:none;background:rgba(255,255,255,.08);color:#fff;font:700 15px Inter;cursor:pointer}
#hg .rel{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.07);margin-left:6px}
#hg .goods{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
#hg .g{padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);cursor:pointer;text-align:left;color:#f3f5f8;font-family:Inter}
#hg .g:hover,#hg .g.sel{background:rgba(139,92,246,.25);border-color:rgba(139,92,246,.6)} #hg .g b{display:block;font-size:13px} #hg .g span{font-size:11.5px;color:#2de0c8;font-weight:600} #hg .g em{font-style:normal;font-size:11px;color:#9ba3b4;display:block}
#hg .log{display:flex;flex-direction:column;gap:6px;max-height:150px;overflow:hidden;margin:4px 0 10px;justify-content:flex-end}
#hg .ln{max-width:82%;padding:7px 11px;border-radius:14px;font-size:13px;line-height:1.35;animation:hgin .2s ease-out} @keyframes hgin{from{opacity:0;transform:translateY(6px)}}
#hg .ln.her{background:rgba(255,255,255,.08);align-self:flex-start;border-bottom-left-radius:4px} #hg .ln.you{background:linear-gradient(180deg,#7c4dff,#6236f0);align-self:flex-end;border-bottom-right-radius:4px}
#hg .ask{display:flex;align-items:baseline;gap:10px;margin-bottom:8px} #hg .ask b{font:700 28px Rajdhani,Inter;letter-spacing:.5px} #hg .ask span{font-size:12px;color:#9ba3b4}
#hg .pat{display:flex;gap:3px;margin-left:auto} #hg .pat i{width:9px;height:9px;border-radius:50%;background:#49e08a} #hg .pat i.off{background:rgba(255,255,255,.12)}
#hg .off{display:flex;align-items:center;gap:10px;margin-bottom:10px} #hg input[type=range]{flex:1;accent-color:#8b5cf6} #hg .off b{font:700 20px Rajdhani,Inter;min-width:96px;text-align:right}
#hg .acts{display:flex;flex-wrap:wrap;gap:7px} #hg .acts button{flex:1 1 auto;min-width:96px;padding:10px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.07);color:#fff;font:700 12.5px Inter;cursor:pointer}
#hg .acts button.pri{background:linear-gradient(180deg,#8b5cf6,#6d3ef0);border-color:rgba(255,255,255,.3)} #hg .acts button.ok{background:linear-gradient(180deg,#22c55e,#16a34a)} #hg .acts button:disabled{opacity:.4;cursor:default}
#hg .acts button kbd{font:700 10px Rajdhani,Inter;opacity:.7;margin-left:4px} #hg .hint{font-size:11.5px;color:#9ba3b4;margin-top:8px}
`;

class Vendors {
  stalls = new Map<string, Stall>(); el!: HTMLElement; private scanT = 0; cur: { s: Stall; deal: DealState | null; offer: number } | null = null;
  mem: Record<string, Memory> = {}; started = false;
  constructor(public ctx: GameCtx) {}
  get life() { return lifeSystem.api!; }
  get skills() { return this.ctx.systems.get('skills') as unknown as SkillsSystem; }
  init() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this.el = document.createElement('div'); this.el.id = 'hg'; document.body.appendChild(this.el);
    this.mem = (this.ctx.save.vendors as Record<string, Memory>) ?? {};
    this.life.providers.push(() => this.things());
    addEventListener('keydown', (e) => this.key(e), true);
    (window as any).__vendors = this;
  }
  private scale() { const p = RT.soc?.E.p('plate'); return p ? Math.max(0.6, Math.min(2.5, p / 2500)) : 1; }
  private hour() { return this.ctx.view.atmo.hour; }
  private open(k: Kind) { const h = this.hour(); if (k === 'suya') return h >= 17 || h < 2; if (k === 'toilet' || k === 'water') return h >= 5.5 && h < 23.5; return h >= 6 && h < 21; }

  // ---------------- where traders sit
  private scan() {
    const c = this.ctx; const me = c.sim.local; const px = me.pos.x, pz = me.pos.z; if (this.life.inside) return;
    const want: { key: string; kind: Kind; x: number; z: number }[] = [];
    for (const r of c.store.regions.values()) for (const p of r.pois) {
      if (Math.abs(p.x - px) > 170 || Math.abs(p.z - pz) > 170) continue;
      const key = `${Math.round(p.x)}:${Math.round(p.z)}`; const h = hash(key);
      if (p.kind === 3) for (const [i, k] of (['market', 'market', 'market', 'okrika', 'water', 'toilet'] as Kind[]).entries()) want.push({ key: key + ':' + i, kind: k, x: p.x, z: p.z });
      else if (p.kind === 8) { want.push({ key: key + ':0', kind: 'mamaput', x: p.x, z: p.z }); if (h % 3 === 0) want.push({ key: key + ':1', kind: 'water', x: p.x, z: p.z }); }
      else if (p.kind === 9) want.push({ key: key + ':0', kind: 'suya', x: p.x, z: p.z });
      else if (p.kind === 1 && h % 3 === 0) want.push({ key: key + ':0', kind: h % 2 ? 'corn' : 'water', x: p.x, z: p.z });
      else if (p.kind === 17) for (const [i, k] of (['water', 'recharge', 'toilet', 'corn'] as Kind[]).entries()) want.push({ key: key + ':' + i, kind: k, x: p.x, z: p.z });
      else if (p.kind === 2 && h % 2 === 0) want.push({ key: key + ':0', kind: 'toilet', x: p.x, z: p.z });
    }
    // your street always has a mama put, a market woman and a pure water seller
    const d = this.life.S.door; if (d) (['mamaput', 'market', 'water', 'suya'] as Kind[]).forEach((k, i) => want.push({ key: `home:${i}`, kind: k, x: d.x + Math.sin(d.yaw) * 9, z: d.z + Math.cos(d.yaw) * 9 }));
    const keep = new Set<string>();
    for (const w of want) {
      if (Math.hypot(w.x - px, w.z - pz) > 160) continue; keep.add(w.key);
      if (!this.stalls.has(w.key)) { const s = this.place(w.key, w.kind, w.x, w.z); if (s) this.stalls.set(w.key, s); else this.stalls.set(w.key, { key: w.key, kind: w.kind, x: 1e9, z: 1e9, yaw: 0, who: null as any, group: null, actor: null, seed: 0 }); }
    }
    for (const [k, s] of this.stalls) if (!keep.has(k) && Math.hypot(s.x - px, s.z - pz) > 190) { this.drop(s); this.stalls.delete(k); }
  }
  /** a free spot on the verge of the nearest road, a few metres along from the others at the same place */
  private place(key: string, kind: Kind, x: number, z: number): Stall | null {
    const c = this.ctx; const h = hash(key); const idx = +key.split(':').pop()!;
    let best: { d: number; ax: number; az: number; ux: number; uz: number; t: number; off: number } | null = null;
    const blds: Float32Array[] = [];
    for (const r of c.store.regions.values()) {
      for (const b of r.buildings) if (Math.abs(b.cx - x) < 120 && Math.abs(b.cz - z) < 120) blds.push(b.pts);
      for (const rd of r.roads) {
        if (rd.cls > 9 || rd.flags & 4) continue; const off = halfWidth(rd) + Math.min(2.2, verge(rd)) * 0.55 + 0.9;
        for (let i = 0; i < rd.pts.length - 2; i += 2) {
          const ax = rd.pts[i], az = rd.pts[i + 1], bx = rd.pts[i + 2], bz = rd.pts[i + 3]; const L = Math.hypot(bx - ax, bz - az); if (L < 6) continue;
          const t = Math.max(0, Math.min(L, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L)); const qx = ax + ((bx - ax) / L) * t, qz = az + ((bz - az) / L) * t; const d = Math.hypot(x - qx, z - qz);
          if (d < 70 && (!best || d < best.d)) best = { d, ax, az, ux: (bx - ax) / L, uz: (bz - az) / L, t, off };
        }
      }
    }
    if (!best) return null;
    const side = (h & 1) ? 1 : -1; const nx = -best.uz * side, nz = best.ux * side;
    for (let k = 0; k < 8; k++) {
      const along = best.t + (idx * 4.2 + k * 3.1) * (k % 2 ? -1 : 1);
      const sx = best.ax + best.ux * along + nx * best.off, sz = best.az + best.uz * along + nz * best.off;
      if (blds.some((p) => pointIn(sx, sz, p) || pointIn(sx + nx * 1.2, sz + nz * 1.2, p))) continue;
      if ([...this.stalls.values()].some((o) => Math.hypot(o.x - sx, o.z - sz) < 3.4)) continue;
      const r = rng(h); const female = r() < FEMALE[kind];
      const pool = female ? NAMES_F : NAMES_M; const name = pool[h % pool.length];
      const who: Persona = { name, female, stubborn: 0.2 + r() * 0.7, warmth: r() * 0.8, patience: 3 + Math.floor(r() * 3) };
      return { key, kind, x: sx, z: sz, yaw: Math.atan2(-nx, -nz), who, group: null, actor: null, seed: h };
    }
    return null;
  }
  private drop(s: Stall) { s.group?.removeFromParent(); s.group = null; if (s.actor && !(s.actor as any)._gone) this.ctx.sim.removeActor(s.actor); s.actor = null; }

  frame(dt: number) {
    const c = this.ctx; const me = c.sim.local;
    this.scanT -= dt; if (this.scanT <= 0) { this.scanT = 3; this.scan(); }
    for (const s of this.stalls.values()) {
      if (!s.who) continue; const d = Math.hypot(s.x - me.pos.x, s.z - me.pos.z);
      if (!s.group && d < 150) { s.group = buildStall(s.kind, s.seed); s.group.position.set(s.x, 0, s.z); s.group.rotation.y = s.yaw; c.view.scene.add(s.group); }
      if (s.group) s.group.visible = d < 150 && !this.life.inside;
      const open = this.open(s.kind);
      if (open && d < 70 && !this.life.inside && (!s.actor || (s.actor as any)._gone || !s.actor.alive)) this.spawn(s);
      if ((!open || d > 110) && s.actor && !(s.actor as any)._gone && this.cur?.s !== s) { c.sim.removeActor(s.actor); s.actor = null; }
      const a = s.actor; if (a && a.alive && !(a as any)._gone) {
        // she stays at her stall; if somebody pushed her she walks back
        const bx = s.x - Math.sin(s.yaw) * 0.75, bz = s.z - Math.cos(s.yaw) * 0.75; const off = Math.hypot(a.pos.x - bx, a.pos.z - bz);
        if (off > 0.3 && off < 6) { a.pos = { x: bx, y: a.pos.y, z: bz }; a.body.setTranslation({ x: bx, y: a.pos.y + 0.9, z: bz }, true); }
        const talking = this.cur?.s === s; const faceMe = Math.atan2(me.pos.x - a.pos.x, me.pos.z - a.pos.z);
        (a as any).act = talking ? { clip: 'Idle_Talking_Loop', yaw: faceMe } : s.kind === 'toilet' || s.kind === 'okrika' || s.kind === 'recharge' ? { clip: 'Idle_Loop', yaw: s.yaw } : { clip: 'Sitting_Idle_Loop', yaw: s.yaw };
      }
    }
    if (this.cur) { const s = this.cur.s; if (Math.hypot(s.x - me.pos.x, s.z - me.pos.z) > 5) this.close(); }
  }
  private spawn(s: Stall) {
    const c = this.ctx; const look = c.sim.randomLook(); const r = rng(s.seed + 7);
    if (s.who.female) Object.assign(look, { body: 'female', topPattern: r() < 0.7 ? 'ankara_wave' : 'adire', pants: r() < 0.6 ? 'ankara_wave' : 'solid', head: 'none', hair: r() < 0.5 ? 'buns' : 'buzzedfemale', model: r() < 0.5 ? 'girl' : 'survivor' });
    else Object.assign(look, { body: 'male', head: s.kind === 'suya' ? 'fila' : r() < 0.3 ? 'cap' : 'none', model: 'survivor' });
    const bx = s.x - Math.sin(s.yaw) * 0.75, bz = s.z - Math.cos(s.yaw) * 0.75;
    const a = c.sim.spawnActor('vendor', { x: bx, y: 0.05, z: bz }, look, s.who.name); a.yaw = s.yaw;
    (a as any)._vendor = true; (a as any)._script = true; (a as any)._keep = true; a.cmd = { ...a.cmd, mx: 0, mz: 0 } as any;
    s.actor = a;
  }

  // ---------------- interaction
  private things(): Thing[] {
    const out: Thing[] = [];
    for (const s of this.stalls.values()) {
      if (!s.who || !s.group) continue; const open = this.open(s.kind) && !!s.actor;
      out.push({ id: 'vendor', name: `${s.who.name}, ${TITLE[s.kind]}`, x: s.x, z: s.z, yaw: s.yaw, actions: [], kind: 'object', reach: 2.6, verb: open ? `Buy from ${s.who.name}` : `${TITLE[s.kind]} (closed)`, open: () => this.openStall(s) });
    }
    return out;
  }
  private memOf(s: Stall) { return (this.mem[s.key] ??= { regard: 0, deals: 0, banUntil: -1 }); }
  openStall(s: Stall) {
    const c = this.ctx; if (!this.open(s.kind) || !s.actor) { c.hud.toast(TITLE[s.kind], s.kind === 'suya' ? 'Suya na for evening. Come back after 5.' : 'Dem don close for today.', 'var(--pur)', 'msg', 3); return; }
    const m = this.memOf(s); if (m.banUntil > this.life.needs.hours) { c.hud.say(s.who.name, 'I talk say make you no come my front again today!', 3); return; }
    this.cur = { s, deal: null, offer: 0 }; c.setModal(true); this.render(); this.el.classList.add('on');
  }
  close() { if (!this.cur) return; this.cur = null; this.el.classList.remove('on'); this.ctx.setModal(false); }
  private fair(g: Good) { return Math.max(50, Math.round((g.fixed ? g.fair : g.fair * this.scale()) / 50) * 50); }
  private pickGood(g: Good) {
    const cur = this.cur!; const lvl = this.skills?.level?.('trade') ?? 1;
    cur.deal = openDeal(g, this.fair(g), cur.s.who, this.memOf(cur.s), lvl); cur.offer = Math.max(50, Math.round(cur.deal.ask * 0.6 / 50) * 50); this.render();
  }
  private move(m: Move) {
    const cur = this.cur; if (!cur?.deal || cur.deal.done) return; const d = cur.deal; const c = this.ctx; const mem = this.memOf(cur.s);
    if ((m.k === 'pay' && c.sim.cash < d.ask) || (m.k === 'offer' && c.sim.cash < m.n)) { c.hud.toast('No money', 'Your pocket no reach that one.', 'var(--red)', 'cash', 3); return; }
    const res = play(d, m, cur.s.who);
    if (cur.offer > d.ask) cur.offer = d.ask;
    if (res === 'deal') this.done(cur.s, d);
    if (res === 'angry') { mem.regard -= 0.15; mem.banUntil = this.life.needs.hours + 3; addMoodlet(this.life.needs, 'scolded', 'Got shouted at', -4, 2); this.persist(); setTimeout(() => this.close(), 2200); }
    if (res === 'gone') { setTimeout(() => this.close(), 1600); }
    this.render();
  }
  private done(s: Stall, d: DealState) {
    const c = this.ctx; const L = this.life; const mem = this.memOf(s); const g = d.good; const n = d.qty;
    c.sim.cash -= d.price; c.sim.events.push({ t: 'cash', actor: c.sim.local.id, amount: -d.price } as any);
    const fair = d.fair * n; const saved = fair - d.price;
    mem.deals++; if (!g.fixed) career.add('trader'); mem.regard = Math.min(1, mem.regard + (d.price >= fair ? 0.1 : saved > fair * 0.15 ? 0.01 : 0.05));
    if (!g.fixed) this.skills?.addXp?.('trade', Math.round(5 + Math.max(0, saved / Math.max(1, fair)) * 40));
    if (saved > fair * 0.12) addMoodlet(L.needs, 'bargain', 'Got a bargain', 5, 3);
    L.needs.v.social = Math.min(100, L.needs.v.social + 4 + d.rounds);
    const fx = g.fx; const nv = L.needs.v;
    setTimeout(() => {
      this.close();
      if (fx.k === 'pantry') { L.S.pantry += fx.n * n; c.hud.toast('Foodstuff', `${n > 1 ? n + ' x ' : ''}${g.label}. You fit cook am for house now.`, 'linear-gradient(160deg,#ff8a5c,#d1452c)', 'msg', 4); }
      if (fx.k === 'takeaway') { L.S.food += fx.n * n; c.hud.toast('Takeaway', 'E dey your cooler for house.', 'linear-gradient(160deg,#ff8a5c,#d1452c)', 'msg', 3.5); }
      if (fx.k === 'eat') L.doAction({ id: 'eat', label: `Eating ${g.label.toLowerCase()}`, gain: { hunger: (fx.hunger * n * 60) / fx.mins, fun: ((fx.fun ?? 0) * 60) / fx.mins, social: ((fx.social ?? 0) * 60) / fx.mins }, minutes: fx.mins, clip: 'Consume', spot: [0, 0, 0], moodlet: ['ate_out', 'Enjoyed street food', 4, 3] });
      if (fx.k === 'drink') { nv.hunger = Math.min(100, nv.hunger + (fx.hunger ?? 0) * n); nv.fun = Math.min(100, nv.fun + (fx.fun ?? 0) * n); nv.comfort = Math.min(100, nv.comfort + (fx.comfort ?? 0)); nv.bladder = Math.max(0, nv.bladder + (fx.bladder ?? 0) * n); L.doAction({ id: 'drink', label: `Drinking ${g.label.toLowerCase()}`, gain: {}, minutes: 4, clip: 'Consume', spot: [0, 0, 0] }); }
      if (fx.k === 'toilet') L.ui.black(() => { nv.bladder = 100; nv.hygiene = Math.max(0, nv.hygiene - 3); c.hud.toast('Pay toilet', 'E no clean, but e do the work.', 'var(--pur)', 'msg', 3); });
      if (fx.k === 'bath') L.ui.black(() => { nv.hygiene = 100; nv.comfort = Math.min(100, nv.comfort + 8); addMoodlet(L.needs, 'fresh', 'Fresh from bath', 5, 4); });
      if (fx.k === 'data') { nv.fun = Math.min(100, nv.fun + fx.fun); addMoodlet(L.needs, 'online', 'Back online', 3, 3); c.hud.toast('Data loaded', 'Your phone don wake up.', 'var(--pur)', 'msg', 3); }
      if (fx.k === 'outfit') L.changeOutfit();
    }, 1300);
    this.persist();
  }
  persist() { this.ctx.save.vendors = this.mem; this.ctx.persist(); }

  // ---------------- the sheet
  private render() {
    const cur = this.cur; if (!cur) return; const s = cur.s; const mem = this.memOf(s); const lvl = this.skills?.level?.('trade') ?? 1;
    const rel = mem.regard > 0.5 ? ['Loyal customer', '#49e08a'] : mem.regard > 0.15 ? ['Knows you', '#a3e635'] : mem.regard < -0.1 ? ['Vexed with you', '#ff8a94'] : ['Stranger', '#9ba3b4'];
    const av = `<div class="av" style="background:${s.who.female ? 'linear-gradient(160deg,#ffb36b,#ff7a59)' : 'linear-gradient(160deg,#7dd3fc,#3b82f6)'}">${s.who.name.split(' ').map((w) => w[0]).join('')}</div>`;
    const head = `<div class="hd">${av}<div><b>${s.who.name}<span class="rel" style="color:${rel[1]}">${rel[0]}</span></b><i>${TITLE[s.kind]} · ${s.who.stubborn > 0.65 ? 'drives a hard bargain' : s.who.warmth > 0.55 ? 'soft heart' : 'no-nonsense'}</i></div><button class="x" data-a="close">✕</button></div>`;
    const d = cur.deal;
    if (!d) {
      this.el.innerHTML = head + `<div class="goods">${GOODS[s.kind].filter((g) => !g.night || this.hour() > 17).map((g, i) => `<button class="g" data-g="${i}"><b>${g.label}</b><span>${g.fixed ? '₦' + this.fair(g).toLocaleString() : 'Price it'}</span><em>${this.fxText(g)}</em></button>`).join('')}</div><div class="hint">Pick something. Everything here is negotiable except what is not. Keys 1-${GOODS[s.kind].length}, Esc to leave.</div>`;
    } else {
      const sense = lvl >= 3 ? `Market sense: fair price about ₦${(d.fair * d.qty).toLocaleString()}` : 'Level up Trade to sense the fair price';
      const min = Math.max(50, Math.round(d.fair * d.qty * 0.35 / 50) * 50);
      this.el.innerHTML = head + `<div class="log">${d.log.slice(-4).map((l) => `<div class="ln ${l.who}">${l.text}</div>`).join('')}</div>` +
        (d.done ? `<div class="acts"><button class="pri" data-a="close">${d.price ? 'Done' : 'Leave'}</button>${d.price ? '' : '<button data-a="back">Look at something else</button>'}</div>` :
          `<div class="ask"><span>She wants</span><b>₦${d.ask.toLocaleString()}</b><span>${d.qty > 1 ? 'for two' : d.good.unit ? 'per ' + d.good.unit : ''}</span><div class="pat">${Array.from({ length: 6 }, (_, i) => `<i class="${i < d.patience ? '' : 'off'}"></i>`).join('')}</div></div>` +
          (d.good.fixed ? '' : `<div class="off"><input type="range" min="${min}" max="${d.ask}" step="50" value="${Math.min(cur.offer, d.ask)}" id="hg-r"><b id="hg-o">₦${Math.min(cur.offer, d.ask).toLocaleString()}</b></div>`) +
          `<div class="acts">${d.good.fixed ? '' : `<button class="pri" data-a="offer">Offer<kbd>ENTER</kbd></button><button data-a="beg">Beg small<kbd>B</kbd></button>${d.good.qty2 && d.qty < 2 ? '<button data-a="two">Buy two<kbd>T</kbd></button>' : ''}<button data-a="walk">Walk away<kbd>W</kbd></button>`}<button class="ok" data-a="pay">Pay ₦${d.ask.toLocaleString()}<kbd>P</kbd></button></div>` +
          `<div class="hint">${d.good.fixed ? 'Fixed price.' : sense + '. Patience dots: run out and she will send you away.'}</div>`);
    }
    this.el.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => this.pickGood(GOODS[s.kind][+(b as HTMLElement).dataset.g!])));
    this.el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => this.act((b as HTMLElement).dataset.a!)));
    const rg = this.el.querySelector('#hg-r') as HTMLInputElement | null; if (rg) rg.addEventListener('input', () => { cur.offer = +rg.value; (this.el.querySelector('#hg-o') as HTMLElement).textContent = '₦' + cur.offer.toLocaleString(); });
  }
  private fxText(g: Good) { const f = g.fx; return f.k === 'eat' ? `Eat here · +Hunger` : f.k === 'pantry' ? `Cook at home x${f.n}` : f.k === 'takeaway' ? 'Takeaway to your cooler' : f.k === 'drink' ? 'Drink · quick boost' : f.k === 'toilet' ? 'Empties bladder' : f.k === 'bath' ? 'Full hygiene' : f.k === 'data' ? '+Fun on your phone' : 'New look'; }
  private act(a: string) {
    const cur = this.cur; if (!cur) return; const charm = this.skills?.level?.('charm') ?? 1;
    if (a === 'close') return this.close(); if (a === 'back') { cur.deal = null; return this.render(); }
    if (a === 'offer') this.move({ k: 'offer', n: cur.offer }); if (a === 'beg') this.move({ k: 'beg', charm }); if (a === 'two') this.move({ k: 'two' }); if (a === 'walk') this.move({ k: 'walk' }); if (a === 'pay') this.move({ k: 'pay' });
  }
  private key(e: KeyboardEvent) {
    const cur = this.cur; if (!cur) return; const d = cur.deal; let used = true;
    if (e.code === 'Escape') { if (d && !d.done) this.act('walk'); else this.close(); }
    else if (!d && /^Digit[1-9]$/.test(e.code)) { const g = GOODS[cur.s.kind][+e.code.slice(5) - 1]; if (g) this.pickGood(g); }
    else if (d && !d.done && (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD')) { cur.offer = Math.max(50, Math.min(d.ask, cur.offer + (e.code === 'ArrowRight' || e.code === 'KeyD' ? 50 : -50) * (e.shiftKey ? 10 : 1))); this.render(); }
    else if (d && !d.done && e.code === 'Enter') this.act('offer'); else if (d && !d.done && e.code === 'KeyB') this.act('beg'); else if (d && !d.done && e.code === 'KeyT') this.act('two'); else if (d && !d.done && e.code === 'KeyW') this.act('walk'); else if (d && !d.done && e.code === 'KeyP') this.act('pay');
    else if (d?.done && (e.code === 'Enter' || e.code === 'Space')) this.close();
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
  blips(out: { x: number; z: number; c: string; r?: number }[]) { for (const s of this.stalls.values()) if (s.group && s.who && this.open(s.kind)) out.push({ x: s.x, z: s.z, c: s.kind === 'toilet' ? '#42a5f5' : s.kind === 'market' ? '#ffb300' : '#ff7043', r: 3 }); }
}

let V: Vendors | null = null;
export const vendorSystem: GameSystem & { get api(): Vendors | null } = {
  id: 'vendors',
  get api() { return V; },
  init(ctx) { V = new Vendors(ctx); V.init(); },
  start() { V && (V.started = true); },
  frame(_ctx, dt) { if (V?.started) V.frame(dt); },
  blips(_ctx, out) { V?.blips(out); },
};
