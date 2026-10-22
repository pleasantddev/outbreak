// Where the features live on the map: paint shops at mechanic villages and LGA offices. Each site is a real latitude and
// longitude from shops.json; once the ground is built the game snaps it to open land beside a road, builds a booth or an
// enrolment kiosk there, stands some people around it and registers the "press G" interaction.
import * as THREE from 'three';
import type { GameCtx } from './registry';
import type { ShopItem } from '../content/schema';
import { AREA } from '../world/region';
import { halfWidth, verge } from '../world/roadspec';
import { h, hash32, rng32, shopItems, uses, playerXZ, injectCss } from './featureKit';

export type SiteDef = Extract<ShopItem, { kind: 'site' }>;
export interface ResolvedSite {
  def: SiteDef; wx: number; wz: number;
  /** centre of the paint bay or the front of the kiosk, and which way the bay points */
  x: number; z: number; yaw: number; ready: boolean; group: THREE.Group | null; npcs: number[]; tag: HTMLElement | null; tried: number;
}
export const sites: ResolvedSite[] = [];
export const siteHooks: { paint?: (ctx: GameCtx, s: ResolvedSite) => void; lga?: (ctx: GameCtx, s: ResolvedSite) => void } = {};

function pointIn(x: number, z: number, p: ArrayLike<number>) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
function distSeg(x: number, z: number, ax: number, az: number, bx: number, bz: number) { const dx = bx - ax, dz = bz - az; const L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); return Math.hypot(x - (ax + t * dx), z - (az + t * dz)); }

/** Nearest open ground to a point with `clear` metres of room around it, off the carriageway and close to a road. */
function findSpot(ctx: GameCtx, wx: number, wz: number, clear: number, poly: Float32Array | null) {
  const blds: { pts: Float32Array; cx: number; cz: number }[] = []; const roads: { pts: Float32Array; hw: number }[] = []; const waters: Float32Array[] = [];
  for (const r of ctx.store.regions.values()) {
    for (const b of r.buildings) if (Math.abs(b.cx - wx) < 260 && Math.abs(b.cz - wz) < 260) blds.push(b);
    for (const rd of r.roads) { if (rd.cls > 8 || rd.flags & 4) continue; let near = false; for (let i = 0; i < rd.pts.length; i += 2) if (Math.abs(rd.pts[i] - wx) < 200 && Math.abs(rd.pts[i + 1] - wz) < 200) { near = true; break; } if (near) roads.push({ pts: rd.pts, hw: halfWidth(rd) + verge(rd) }); }
    for (const w of r.water) if (!w.line) for (const ring of w.rings) waters.push(ring);
  }
  const roadInfo = (x: number, z: number) => { let best = 1e9, yaw = 0; for (const r of roads) for (let i = 0; i < r.pts.length - 2; i += 2) { const d = distSeg(x, z, r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]) - r.hw; if (d < best) { best = d; yaw = Math.atan2(r.pts[i + 2] - r.pts[i], r.pts[i + 3] - r.pts[i + 1]); } } return { d: best, yaw }; };
  const free = (x: number, z: number) => {
    for (const b of blds) {
      if (Math.abs(b.cx - x) > 90 || Math.abs(b.cz - z) > 90) continue;
      if (pointIn(x, z, b.pts)) return false;
      for (let i = 0; i < b.pts.length; i += 2) { const j = (i + 2) % b.pts.length; if (distSeg(x, z, b.pts[i], b.pts[i + 1], b.pts[j], b.pts[j + 1]) < clear) return false; }
    }
    for (const w of waters) if (pointIn(x, z, w)) return false;
    return true;
  };
  let best: { x: number; z: number; yaw: number; s: number } | null = null;
  for (let r = 0; r <= 140; r += 5) {
    const n = r === 0 ? 1 : Math.max(8, Math.round((r * 6.28) / 7));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.283 + r * 0.37; const x = wx + Math.cos(a) * r, z = wz + Math.sin(a) * r;
      if (poly && !pointIn(x, z, poly)) continue; if (!free(x, z)) continue;
      const ri = roadInfo(x, z); if (ri.d < clear * 0.6) continue;
      const s = r + Math.max(0, ri.d - 4) * 1.2 + (poly ? 0 : 0);
      if (!best || s < best.s) best = { x, z, yaw: ri.yaw, s };
    }
    if (best && r > best.s + 6) break;
  }
  return best;
}

// ------------------------------------------------------------------------------------------------ meshes
const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(hex: number | string, rough = 0.7, metal = 0.1, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const k = `${hex}|${rough}|${metal}|${JSON.stringify(extra)}`; let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex as any), roughness: rough, metalness: metal, ...extra }); matCache.set(k, m); }
  return m;
}
function box(g: THREE.Group, w: number, hh: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow = true) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; g.add(o); return o; }
function cyl(g: THREE.Group, r: number, hh: number, m: THREE.Material, x: number, y: number, z: number, seg = 12) { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hh, seg), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; }
function signTex(lines: [string, string, number][], w = 1024, hgt = 256, bg = '#14181f', accent = '#ffb020') {
  const c = document.createElement('canvas'); c.width = w; c.height = hgt; const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, hgt); g.fillStyle = accent; g.fillRect(0, 0, w, 14); g.fillRect(0, hgt - 14, w, 14);
  g.textAlign = 'center'; g.textBaseline = 'middle'; let y = hgt * 0.34;
  for (const [t, col, size] of lines) { g.fillStyle = col; g.font = `700 ${size}px Oswald, Impact, "Arial Narrow", sans-serif`; let s = size; while (g.measureText(t).width > w * 0.94 && s > 12) { s -= 2; g.font = `700 ${s}px Oswald, Impact, "Arial Narrow", sans-serif`; } g.fillText(t, w / 2, y); y += size * 0.95; }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/** Paint booth: concrete pad, steel posts, tin roof, big sign, compressor and paint cans. Bay centre is the origin, nose along +z. */
function buildBooth(name: string) {
  const g = new THREE.Group(); const W = 8.4, D = 10.4;
  box(g, W, 0.06, D, mat(0x8d8f92, 0.9), 0, 0.03, 0, false);
  for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) box(g, 0.14, 0.012, D - 0.6, mat(0xf2c94c, 0.8), x, 0.07, 0, false);
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) box(g, 0.2, 3.6, 0.2, mat(0x2e3a52, 0.5, 0.6), x, 1.8, z);
  const roof = box(g, W + 0.8, 0.14, D + 0.8, mat(0x39577a, 0.55, 0.6), 0, 3.7, 0); roof.rotation.x = 0.03;
  box(g, W + 0.8, 0.5, 0.12, mat(0x14181f, 0.6), 0, 3.4, D / 2 + 0.38);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.96, 1.9), new THREE.MeshStandardMaterial({ map: signTex([[name.toUpperCase(), '#ffffff', 82], ['PAINT & SPRAY  ·  PLATES  ·  TRACKERS', '#ffb020', 48]]), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.0 }));
  board.position.set(0, 4.55, D / 2 + 0.42); board.castShadow = true; g.add(board);
  const back = board.clone(); back.position.z = -D / 2 - 0.42; back.rotation.y = Math.PI; g.add(back);
  box(g, W * 0.96, 0.1, 0.1, mat(0x14181f), 0, 5.55, D / 2 + 0.42); box(g, W * 0.96, 0.1, 0.1, mat(0x14181f), 0, 3.6, D / 2 + 0.42);
  for (const x of [-W * 0.48, W * 0.48]) box(g, 0.1, 1.95, 0.1, mat(0x14181f), x, 4.58, D / 2 + 0.42);
  // lights under the roof (emissive strips, the real light is the sky at day and the street at night)
  for (const x of [-2.4, 2.4]) box(g, 1.6, 0.06, 0.18, mat(0xfff3c4, 0.4, 0, { emissive: new THREE.Color(0xfff3c4), emissiveIntensity: 1.6 }), x, 3.58, 0, false);
  // compressor and cans on the side wall corner
  const cx = -W / 2 + 0.9, cz = -D / 2 + 1.0;
  { const tank = cyl(g, 0.3, 0.9, mat(0xc4161c, 0.5, 0.4), cx, 0.55, cz); tank.rotation.z = Math.PI / 2; }
  box(g, 0.9, 0.12, 0.5, mat(0x222428, 0.7, 0.3), cx, 0.2, cz); for (const dz of [-0.2, 0.2]) cyl(g, 0.04, 0.2, mat(0x777777, 0.3, 0.9), cx - 0.3, 0.12, cz + dz);
  const colours = [0xe8650f, 0x1b3f9f, 0x008751, 0xf2f2f0, 0xc4161c, 0xf0dc3c];
  for (let i = 0; i < 6; i++) { cyl(g, 0.12, 0.3, mat(colours[i], 0.5, 0.3), W / 2 - 0.7 + (i % 2) * 0.28, 0.21 + 0.3 * Math.floor(i / 4), cz + 0.3 * (i >> 1) - 0.2, 14); cyl(g, 0.125, 0.02, mat(0xcccccc, 0.4, 0.8), W / 2 - 0.7 + (i % 2) * 0.28, 0.37 + 0.3 * Math.floor(i / 4), cz + 0.3 * (i >> 1) - 0.2); }
  box(g, 1.8, 0.1, 0.6, mat(0x6a4a2a, 0.9), W / 2 - 1.0, 0.85, cz - 0.9); box(g, 0.08, 0.85, 0.08, mat(0x333333), W / 2 - 1.8, 0.43, cz - 0.9); box(g, 0.08, 0.85, 0.08, mat(0x333333), W / 2 - 0.2, 0.43, cz - 0.9);
  for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.12, 8, 16), mat(0x151515, 0.95)); t.rotation.x = Math.PI / 2; t.position.set(-W / 2 + 0.7 + i * 0.01, 0.12 + i * 0.22, D / 2 - 0.9); t.castShadow = true; g.add(t); }
  return g;
}

/** Enrolment kiosk: a container office with a green and white roof edge, queue stanchions, flag pole, notice board. Origin at the front of the counter, facing +z. */
function buildKiosk(lga: string) {
  const g = new THREE.Group();
  box(g, 7.2, 0.08, 7.4, mat(0x9a9a96, 0.9), 0, 0.04, -0.4, false);
  box(g, 6.2, 2.6, 2.6, mat(0xf4f4ef, 0.7, 0.1), 0, 1.38, -2.4);
  box(g, 6.3, 0.18, 2.7, mat(0x0a7a45, 0.6), 0, 2.75, -2.4);
  box(g, 6.2, 0.1, 0.8, mat(0x0a7a45, 0.6), 0, 2.5, -0.85);
  box(g, 3.6, 1.1, 0.04, mat(0x0c1220, 0.15, 0.4, { transparent: true, opacity: 0.8 }), -0.8, 1.55, -1.08);
  box(g, 1.2, 0.07, 0.5, mat(0x5a4a3a, 0.8), -0.8, 1.02, -0.95);
  box(g, 0.9, 2.0, 0.05, mat(0x39577a, 0.6, 0.4), 2.3, 1.1, -1.08);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 1.15), new THREE.MeshStandardMaterial({ map: signTex([['NIN ENROLMENT', '#ffffff', 74], [(lga + ' Local Government').toUpperCase(), '#b6f2cf', 40]], 1024, 200, '#0a7a45', '#ffffff'), roughness: 0.6 }));
  sign.position.set(0, 3.55, -1.15); sign.castShadow = true; g.add(sign);
  for (const x of [-2.9, 2.9]) box(g, 0.1, 0.9, 0.1, mat(0x14181f), x, 3.1, -1.15);
  // queue posts and tape
  for (let i = 0; i < 5; i++) { cyl(g, 0.04, 1.0, mat(0xc9ccd0, 0.3, 0.9), -1.6 + i * 0.0, 0.5, 0.2 + i * 1.0, 8); cyl(g, 0.12, 0.04, mat(0x333333, 0.6, 0.6), -1.6, 0.02, 0.2 + i * 1.0, 10); cyl(g, 0.04, 1.0, mat(0xc9ccd0, 0.3, 0.9), 0.4, 0.5, 0.2 + i * 1.0, 8); cyl(g, 0.12, 0.04, mat(0x333333, 0.6, 0.6), 0.4, 0.02, 0.2 + i * 1.0, 10); if (i > 0) { box(g, 0.03, 0.03, 1.0, mat(0xe8c34a, 0.6), -1.6, 0.9, 0.2 + (i - 0.5) * 1.0, false); box(g, 0.03, 0.03, 1.0, mat(0xe8c34a, 0.6), 0.4, 0.9, 0.2 + (i - 0.5) * 1.0, false); } }
  // flag pole with the green, white, green
  cyl(g, 0.05, 6.2, mat(0xd8d8d8, 0.4, 0.8), 3.2, 3.1, 1.0, 8);
  for (const [i, c] of [0x008751, 0xffffff, 0x008751].entries()) box(g, 0.34, 0.7, 0.02, mat(c, 0.8), 3.2 + 0.2 + i * 0.34, 5.8, 1.0, false);
  // plastic chairs along the front
  for (let i = 0; i < 4; i++) { const cx = 2.0 + i * 0.5, cz = -0.2; box(g, 0.4, 0.04, 0.4, mat(0x1d3a8a, 0.6), cx, 0.45, cz); box(g, 0.4, 0.4, 0.04, mat(0x1d3a8a, 0.6), cx, 0.65, cz - 0.2); for (const [dx, dz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) box(g, 0.03, 0.43, 0.03, mat(0xaaaaaa, 0.4, 0.8), cx + dx, 0.22, cz + dz); }
  return g;
}

let inited = false;
export function initSites(ctx: GameCtx) {
  if (inited) return; inited = true; injectCss();
  for (const d of shopItems('site')) sites.push({ def: d, wx: 0, wz: 0, x: 0, z: 0, yaw: 0, ready: false, group: null, npcs: [], tag: null, tried: -99 });
  for (const s of sites) {
    const p = ctx.store.project(s.def.lat, s.def.lon); s.wx = p.x; s.wz = p.z;
    uses.add({ id: 'site:' + s.def.id, x: 0, z: 0, r: s.def.site === 'paint' ? 7 : 4.5, label: s.def.site === 'paint' ? 'Talk to the mechanic' : 'NIN and vehicle registry', who: s.def.site === 'paint' ? 'any' : 'out',
      ok: () => s.ready, use: (c) => (s.def.site === 'paint' ? siteHooks.paint : siteHooks.lga)?.(c, s) });
  }
  window.addEventListener('resize', () => {});
  (window as any).__hlSites = sites;
}

const NPC_LOOKS = ['Chinedu', 'Baba Spray', 'Mama Nkechi', 'Sule', 'Kolade', 'Ngozi', 'Tunde'];
function npcLook(ctx: GameCtx, seed: number, mechanic: boolean) {
  const look = ctx.sim.randomLook(); const r = rng32(seed);
  if (mechanic) Object.assign(look, { body: 'male', top: 'tee', topPattern: 'solid', topColor: ['#1e2b3a', '#355070', '#5b1a16', '#2f4a2c'][Math.floor(r() * 4)], topAccent: '#141414', pants: 'solid', pantsColor: '#1e2b3a', shoes: '#2a2622', head: r() < 0.5 ? 'cap' : 'none', model: 'survivor', beard: r() < 0.4 });
  return look;
}

let labelT = 0;
export function tickSites(ctx: GameCtx, dt: number) {
  if (!inited) return;
  const P = playerXZ(ctx); const sim = ctx.sim; const view = ctx.view; const now = view.time;
  for (const s of sites) {
    const d = Math.hypot((s.ready ? s.x : s.wx) - P.x, (s.ready ? s.z : s.wz) - P.z);
    if (!s.ready) {
      if (d > 600 || now - s.tried < 1.5) continue; s.tried = now;
      const tile = view.world.tiles.has(`${Math.floor(s.wx / 250)},${Math.floor(s.wz / 250)}`); if (!tile) continue;
      // Cappa has a mapped yard: the booth goes inside it
      let poly: Float32Array | null = null;
      if (s.def.id === 'cappa') for (const r of ctx.store.regions.values()) for (const a of r.areas) if (a.kind === AREA.mechanic) { let cx = 0, cz = 0; const n = a.pts.length / 2; for (let i = 0; i < n; i++) { cx += a.pts[i * 2]; cz += a.pts[i * 2 + 1]; } cx /= n; cz /= n; if (Math.hypot(cx - s.wx, cz - s.wz) < 400) { poly = a.pts; s.wx = cx; s.wz = cz; } }
      const clear = s.def.site === 'paint' ? 6.2 : 4.2;
      const spot = findSpot(ctx, s.wx, s.wz, clear, poly) ?? (poly ? findSpot(ctx, s.wx, s.wz, clear, null) : null);
      if (!spot) { s.tried = now + 20; continue; }
      s.x = spot.x; s.z = spot.z; s.yaw = spot.yaw; s.ready = true;
      const g = s.def.site === 'paint' ? buildBooth(s.def.name) : buildKiosk(s.def.lga ?? s.def.name);
      g.position.set(s.x, 0, s.z); g.rotation.y = s.def.site === 'paint' ? s.yaw : s.yaw + (Math.PI / 2);
      view.scene.add(g); s.group = g;
      const p = uses.points.get('site:' + s.def.id)!; p.x = s.x; p.z = s.z;
      if (s.def.site === 'lga') { // the use point is in front of the counter
        const fx = Math.sin(g.rotation.y), fz = Math.cos(g.rotation.y); p.x = s.x + fx * 1.6; p.z = s.z + fz * 1.6;
        sim.addTile('site:' + s.def.id, { hulls: [], walls: [{ ax: s.x - Math.cos(g.rotation.y) * 3.1 - fx * 2.4, az: s.z + Math.sin(g.rotation.y) * 3.1 - fz * 2.4, bx: s.x + Math.cos(g.rotation.y) * 3.1 - fx * 2.4, bz: s.z - Math.sin(g.rotation.y) * 3.1 - fz * 2.4, h: 2.6 }], poles: [], decks: [] });
      } else {
        const c = Math.cos(s.yaw), sn = Math.sin(s.yaw); const poles: number[] = [];
        for (const [lx, lz] of [[-4.2, -5.2], [4.2, -5.2], [-4.2, 5.2], [4.2, 5.2]]) poles.push(s.x + lx * c + lz * sn, s.z - lx * sn + lz * c, 0.14);
        sim.addTile('site:' + s.def.id, { hulls: [], walls: [], poles, decks: [] });
      }
      const tag = h('div', { class: 'fk fk-tag', html: `<b>${s.def.site === 'paint' ? 'PAINT & SPRAY' : 'NIN · REGISTRY'}</b><i>${s.def.site === 'paint' ? s.def.name : (s.def.lga ?? '') + ' LGA'}</i>` });
      tag.style.cssText = 'position:fixed;left:0;top:0;z-index:3;pointer-events:none;display:none;text-align:center;transform:translate(-50%,-100%);white-space:nowrap;will-change:transform';
      document.body.appendChild(tag); s.tag = tag;
    }
    if (!s.ready) continue;
    if (s.group) s.group.visible = d < 520;
    // people at the site
    if (d < 120) {
      const alive = s.npcs.filter((id) => { const a = sim.actors[id]; return a && a.alive && !(a as any)._gone; });
      if (alive.length < (s.def.site === 'paint' ? 3 : 4) && now - (s as any)._npcT > 2) {
        (s as any)._npcT = now; const seed = hash32(s.def.id);
        const slots: { x: number; z: number; face: number; name: string; mech: boolean }[] = [];
        const c = Math.cos(s.group!.rotation.y), sn = Math.sin(s.group!.rotation.y); const L = (lx: number, lz: number) => ({ x: s.x + lx * c + lz * sn, z: s.z - lx * sn + lz * c });
        if (s.def.site === 'paint') { const a = L(-5.0, 1.5), b = L(5.0, -1.2), cc = L(-3.2, -4.2); slots.push({ ...a, face: s.group!.rotation.y + Math.PI / 2, name: NPC_LOOKS[0], mech: true }, { ...b, face: s.group!.rotation.y - Math.PI / 2, name: NPC_LOOKS[1], mech: true }, { ...cc, face: s.group!.rotation.y + 2.4, name: NPC_LOOKS[3], mech: true }); }
        else for (let i = 0; i < 4; i++) { const q = L(0.0 - 0.6, 0.6 + i * 1.0 + 0.2); slots.push({ x: q.x, z: q.z, face: s.group!.rotation.y + Math.PI, name: NPC_LOOKS[(i + 2) % NPC_LOOKS.length], mech: false }); }
        for (let i = alive.length; i < slots.length; i++) {
          if (s.npcs.length > 30) s.npcs.length = 0;
          const sl = slots[i]; const a = sim.spawnActor('vendor', { x: sl.x, y: 0.05, z: sl.z }, npcLook(ctx, seed + i, sl.mech), sl.mech ? 'Mechanic ' + sl.name : sl.name);
          a.yaw = sl.face; (sim as any).brains.set(a.id, { kind: 'idle', walk: 0, s: 0, dir: 1, t: 1e9, target: null, from: null });
          alive.push(a.id); s.npcs = alive;
        }
        s.npcs = alive;
      }
    }
  }
  // labels float over the sites
  labelT -= dt; const cam = view.camera;
  for (const s of sites) {
    const tag = s.tag; if (!tag) continue;
    const d = Math.hypot(s.x - P.x, s.z - P.z);
    if (d > 150 || ctx.hud.landmapOn || view.debugCam || document.querySelector('.fk-ov')) { tag.style.display = 'none'; continue; }
    const v = new THREE.Vector3(s.x, s.def.site === 'paint' ? 6.4 : 4.8, s.z).project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { tag.style.display = 'none'; continue; }
    tag.style.display = 'block'; tag.style.transform = `translate(${Math.round((v.x * 0.5 + 0.5) * innerWidth)}px,${Math.round((-v.y * 0.5 + 0.5) * innerHeight)}px) translate(-50%,-100%)`;
    tag.style.opacity = String(Math.max(0.0, Math.min(1, (150 - d) / 60)));
  }
}
export function siteBlips(): { x: number; z: number; c: string; r?: number }[] { return sites.filter((s) => s.ready).map((s) => ({ x: s.x, z: s.z, c: s.def.site === 'paint' ? '#ff8a3d' : '#3ddc84', r: 7 })); }
