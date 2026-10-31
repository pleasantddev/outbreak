// MyAds in the world and on the phone.
// World: approved billboard ads are drawn on their boards (big LED boards rotate up to three ads), three blimps loop
// over the city with a banner on each flank, and paid drone shows write their words in the night sky.
// Reach: when an ad is really on your screen (in view, facing you, big enough to read) for a moment, the game tells
// the server once per day; the server counts each real player once per ad per day and the advertiser sees it.
// Phone: the MyAds app sells boards, drone shows and blimp banners for real money through Paystack (server/src/payments.ts).
import type * as THREE_NS from 'three';
import type { GameCtx, GameSystem, GoalPoint } from './registry';
import { net } from '../net/client';
import { registerApp } from '../ui/lifeHud';
import type { LiveAd } from '../net/protocol';
import { payApi } from './pay';
import BOARDS from '../data/billboards.json';
import { AD_DAYS, BLIMPS, DRONE_SPOTS, DRONE_TEXT_MAX, adPixels, adQuote, blimpPos, lagosDay, worldHours, type AdBoard } from '../net/rules';

type T = typeof THREE_NS;
const boards = BOARDS as AdBoard[];
const boardById = new Map(boards.map((b) => [b.id, b]));
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
const COLORS = ['#ffffff', '#ffd23f', '#3ddc84', '#4fc3f7', '#ff5d8f', '#b388ff', '#ff8a3d'];
const BLIMP_PX = { w: 1600, h: 400 };
const NIGHT = (h: number) => h >= 19.5 || h < 5;

interface Mine { id: number; kind: string; board: string | null; place: string | null; text: string | null; color: string | null; img: string | null; start: string; end: string; naira: number; status: string; note: string | null; payment: string | null; reach: number; days: { day: string; people: number; sightings: number }[] }
interface Inventory { test: boolean; mode: string; today: string; boards: (AdBoard & { px: { w: number; h: number }; day: number; nextFree: string | null })[]; drone: { spots: (typeof DRONE_SPOTS[number] & { day: number; nextFree: string | null })[]; textMax: number }; blimp: { day: number; fleet: number; nextFree: string | null; size: { w: number; h: number } } }
type Screen = { s: 'home' } | { s: 'boards' } | { s: 'board'; id: string } | { s: 'drone' } | { s: 'blimp' } | { s: 'mine'; id: number };

const css = `
#appview .ad-hero{border-radius:20px;padding:16px;color:#fff;background:linear-gradient(140deg,#ff7a18 0%,#e2336b 55%,#6d28d9 100%);position:relative;overflow:hidden}
#appview .ad-hero b{display:block;font:800 19px/1.15 Inter,sans-serif;color:#fff;letter-spacing:-.3px;max-width:80%} #appview .ad-hero span{display:block;margin-top:6px;font-size:12.5px;opacity:.9;max-width:85%}
#appview .ad-hero:after{content:"";position:absolute;right:-30px;top:-30px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.14)}
#appview .ad-tiles{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
#appview .ad-tile{background:#fff;border-radius:16px;padding:11px 9px;text-align:left;border:none;cursor:pointer;pointer-events:auto;box-shadow:0 1px 2px rgba(16,24,40,.06);font:inherit}
#appview .ad-tile i{display:flex;width:30px;height:30px;border-radius:9px;align-items:center;justify-content:center;margin-bottom:8px;font-style:normal;font-size:16px}
#appview .ad-tile b{display:block;font-size:13px;color:#11131a} #appview .ad-tile span{display:block;font-size:11px;color:#6b7280;margin-top:2px}
#appview .ad-sec{font:700 11px Inter,sans-serif;color:#8a8f9c;text-transform:uppercase;letter-spacing:.6px;margin:6px 4px -2px}
#appview .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
#appview .chips button{border:1px solid #d7dae3;background:#fff;border-radius:999px;padding:6px 11px;font:600 12px Inter,sans-serif;color:#11131a;cursor:pointer;pointer-events:auto}
#appview .chips button.on{background:#11131a;border-color:#11131a;color:#fff}
#appview .chips .sw{width:28px;height:28px;padding:0;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #d7dae3}
#appview .chips .sw.on{box-shadow:0 0 0 2px #11131a}
#appview .tag{display:inline-block;border-radius:999px;padding:2px 8px;font:700 10.5px Inter,sans-serif;background:#eef0f4;color:#4b5263;margin-right:4px}
#appview .tag.prime{background:#fff1d6;color:#9a5b00} #appview .tag.live{background:#dcfce7;color:#166534} #appview .tag.review{background:#e0e7ff;color:#3730a3} #appview .tag.rejected{background:#fee2e2;color:#991b1b} #appview .tag.scheduled{background:#f3e8ff;color:#6b21a8}
#appview .price{display:flex;justify-content:space-between;font-size:12.5px;color:#4b5263;margin-top:4px} #appview .price.tot{font:800 15px Inter,sans-serif;color:#11131a;margin-top:8px;padding-top:8px;border-top:1px solid #eef0f4}
#appview .ad-prev{width:100%;border-radius:12px;display:block;margin-top:8px;background:#11131a}
#appview .bars{display:flex;align-items:flex-end;gap:4px;height:70px;margin-top:10px}
#appview .bars div{flex:1;background:linear-gradient(#ff7a18,#e2336b);border-radius:5px 5px 2px 2px;min-height:3px;position:relative}
#appview .bars div span{position:absolute;bottom:-16px;left:0;right:0;text-align:center;font-size:9px;color:#8a8f9c}
#appview .big{font:800 26px Inter,sans-serif;color:#11131a;letter-spacing:-.5px}
#appview .testnote{background:#fff7ed;color:#9a3412;border-radius:12px;padding:8px 10px;font-size:11.5px;margin-top:8px}
#appview label.file{display:block;margin-top:8px;border:1.5px dashed #c7cbd6;border-radius:12px;padding:12px;text-align:center;color:#4b5263;cursor:pointer;pointer-events:auto;font-size:12.5px}
#appview label.file input{display:none}
`;

/** a soft round dot for drones */
function dotTexture(THREE: T) {
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d')!;
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.75)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32); const t = new THREE.CanvasTexture(c); return t;
}
/** sample the words into drone positions (metres, centred, y up) */
function textPoints(text: string): number[] {
  const words = text.split(' '); const lines: string[] = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > 14 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  const c = document.createElement('canvas'); const fs = 56, lh = 66; c.width = 900; c.height = lines.length * lh + 20; const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.font = `900 ${fs}px Inter, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, c.width / 2, 10 + lh * (i + 0.5)));
  const d = g.getImageData(0, 0, c.width, c.height).data; const out: number[] = []; const step = 6, k = 0.5;
  for (let y = 0; y < c.height; y += step) for (let x = 0; x < c.width; x += step) if (d[(y * c.width + x) * 4 + 3] > 140) out.push((x - c.width / 2) * k, (c.height / 2 - y) * k, 0);
  return out;
}
/** an unsold board or blimp invites you to buy it */
function houseAd(THREE: T, w: number, h: number, title: string, sub: string) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#ff7a18'); gr.addColorStop(0.55, '#e2336b'); gr.addColorStop(1, '#6d28d9'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${Math.round(h * 0.3)}px Inter, Arial, sans-serif`; g.fillText(title, w / 2, h * 0.42, w * 0.9);
  g.font = `600 ${Math.round(h * 0.13)}px Inter, Arial, sans-serif`; g.globalAlpha = 0.92; g.fillText(sub, w / 2, h * 0.74, w * 0.9);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

interface BoardView { mesh: THREE_NS.Mesh; mat: THREE_NS.MeshBasicMaterial; ads: number[]; shown: number }
interface Show { ad: LiveAd; pts: THREE_NS.Points; text: Float32Array; swarm: Float32Array; pos: THREE_NS.BufferAttribute; x: number; z: number; t0: number }
interface Blimp { g: THREE_NS.Group; mats: THREE_NS.MeshBasicMaterial[]; ad: number | null }

class AdsApp {
  live: LiveAd[] = [];
  private THREE!: T;
  private tex = new Map<string, THREE_NS.Texture>();
  private views = new Map<string, BoardView>(); // board id -> view
  private shows = new Map<number, Show>();
  private blimps: Blimp[] = [];
  private dot: THREE_NS.Texture | null = null;
  private seenT = new Map<number, number>(); // seconds on screen today
  private reported = new Set<number>(); private reportDay = ''; private pending = new Set<number>();
  private v3!: THREE_NS.Vector3; private acc = 0; private flushT = 0; private frustum: THREE_NS.Frustum | null = null; private mtx: THREE_NS.Matrix4 | null = null;
  private screen: Screen = { s: 'home' }; private inv: Inventory | null = null; private mine: Mine[] = [];
  private form = { days: 3, start: '', upload: null as null | { id: string; preview: string }, text: '', color: COLORS[1], place: 'lagoon', busy: false };
  target: GoalPoint | null = null;
  constructor(private ctx: GameCtx) {}
  get hud() { return this.ctx.hud; }
  private get http() { return net.server?.http ?? ''; }

  init() {
    this.THREE = this.ctx.THREE; this.v3 = new this.THREE.Vector3();
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    registerApp('MyAds', '', '', () => this.html());
    this.hud.appBack['MyAds'] = () => this.back();
    new MutationObserver(() => this.wire()).observe(document.getElementById('av-l') ?? document.body, { childList: true });
    (window as any).__ads = this;
  }
  start() {
    const w = net.welcome as any; if (w?.ads) this.setLive(w.ads);
    net.on('welcome', (w2: any) => { if (w2?.ads) this.setLive(w2.ads); });
    net.on('ads', (m: any) => this.setLive(m.list ?? []));
    this.buildBlimps();
  }

  // ------------------------------------------------------------------------------------------ the world
  setLive(list: LiveAd[]) {
    this.live = list.filter((a) => a.until > Date.now());
    const want = new Map<string, number[]>();
    for (const a of this.live) if (a.kind === 'board' && a.board && boardById.has(a.board)) { const l = want.get(a.board) ?? []; l.push(a.id); want.set(a.board, l); }
    for (const [id, v] of this.views) if (!want.has(id)) { this.ctx.view.scene.remove(v.mesh); v.mesh.geometry.dispose(); v.mat.dispose(); this.views.delete(id); }
    for (const [id, ads] of want) { const v = this.views.get(id); if (v) v.ads = ads; else this.addBoard(boardById.get(id)!, ads); }
    const shows = new Set(this.live.filter((a) => a.kind === 'drone').map((a) => a.id));
    for (const [id, sh] of this.shows) if (!shows.has(id)) this.dropShow(id, sh);
    const sky = this.live.filter((a) => a.kind === 'blimp').sort((a, b) => a.id - b.id);
    this.blimps.forEach((b, i) => { const ad = sky[i] ?? null; if ((ad?.id ?? null) !== b.ad) { b.ad = ad?.id ?? null; const t = ad?.img ? this.texture(ad.img) : this.houseBlimp(); for (const m of b.mats) { m.map = t; m.needsUpdate = true; } } });
  }
  private texture(url: string) {
    let t = this.tex.get(url); if (t) return t;
    const THREE = this.THREE; const L = new THREE.TextureLoader(); L.setCrossOrigin('anonymous');
    t = L.load(this.http + url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; this.tex.set(url, t); return t;
  }
  private houseBlimpT: THREE_NS.Texture | null = null;
  private houseBlimp() { return (this.houseBlimpT ??= houseAd(this.THREE, 1024, 256, 'YOUR BRAND, ACROSS LAGOS', 'Book this blimp on MyAds')); }
  private addBoard(b: AdBoard, ads: number[]) {
    const THREE = this.THREE; const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), mat);
    mesh.position.set(b.x + Math.sin(b.yaw) * 0.15, b.y, b.z + Math.cos(b.yaw) * 0.15); mesh.rotation.y = b.yaw; mesh.name = 'ad:' + b.id;
    this.ctx.view.scene.add(mesh); this.views.set(b.id, { mesh, mat, ads, shown: -1 });
  }
  private buildBlimps() {
    if (this.blimps.length) return;
    const THREE = this.THREE; const hullM = new THREE.MeshStandardMaterial({ color: 0xe9edf2, metalness: 0.15, roughness: 0.45 });
    const finM = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.6 });
    for (let i = 0; i < BLIMPS; i++) {
      const g = new THREE.Group(); g.name = 'blimp' + i;
      const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 18), hullM); hull.scale.set(9, 9, 32); g.add(hull);
      for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 9), finM); const a = (k * Math.PI) / 2; f.position.set(Math.sin(a) * 5.5, Math.cos(a) * 5.5, -27); f.rotation.z = -a; g.add(f); }
      const gon = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 9), finM); gon.position.set(0, -9.6, 2); g.add(gon);
      const mats: THREE_NS.MeshBasicMaterial[] = [];
      for (const side of [1, -1]) {
        // a banner bent to the hull: each vertex sits just outside the ellipsoid
        const geo = new THREE.PlaneGeometry(36, 9, 24, 6); const p = geo.attributes.position as THREE_NS.BufferAttribute; const uv = geo.attributes.uv as THREE_NS.BufferAttribute;
        for (let v = 0; v < p.count; v++) { const zl = p.getX(v), yl = p.getY(v) * 0.85; const r = 9 * Math.sqrt(Math.max(0.02, 1 - (zl / 32) ** 2 - (yl / 9) ** 2)); p.setXYZ(v, side * (r + 0.12), yl, -side * zl); } // -side*z keeps the words reading left to right from both sides
        void uv;
        geo.computeVertexNormals();
        const m = new THREE.MeshBasicMaterial({ map: this.houseBlimp(), toneMapped: false, side: THREE.DoubleSide }); mats.push(m);
        g.add(new THREE.Mesh(geo, m));
      }
      this.ctx.view.scene.add(g); this.blimps.push({ g, mats, ad: null });
    }
  }
  private showFor(ad: LiveAd) {
    let sh = this.shows.get(ad.id); if (sh) return sh;
    const THREE = this.THREE; const spot = DRONE_SPOTS.find((s) => s.id === ad.place) ?? DRONE_SPOTS[0];
    const text = new Float32Array(textPoints(ad.text ?? 'LAGOS')); const n = text.length / 3; const swarm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 90; swarm[i * 3] = Math.cos(a) * r; swarm[i * 3 + 1] = -60 + Math.random() * 30; swarm[i * 3 + 2] = Math.sin(a) * r * 0.4; }
    const geo = new THREE.BufferGeometry(); const pos = new THREE.BufferAttribute(new Float32Array(swarm), 3); geo.setAttribute('position', pos);
    const col = new THREE.Color(ad.color ?? '#ffffff'); const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const k = 0.82 + Math.random() * 0.18; cols[i * 3] = col.r * k; cols[i * 3 + 1] = col.g * k; cols[i * 3 + 2] = col.b * k; }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.PointsMaterial({ size: 3.2, map: (this.dot ??= dotTexture(THREE)), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    const pts = new THREE.Points(geo, mat); pts.position.set(spot.x, 140, spot.z); pts.frustumCulled = false; pts.name = 'drones:' + ad.id;
    this.ctx.view.scene.add(pts);
    sh = { ad, pts, text, swarm, pos, x: spot.x, z: spot.z, t0: performance.now() / 1000 }; this.shows.set(ad.id, sh); return sh;
  }
  private dropShow(id: number, sh: Show) { this.ctx.view.scene.remove(sh.pts); sh.pts.geometry.dispose(); (sh.pts.material as THREE_NS.Material).dispose(); this.shows.delete(id); }
  private hour() { return net.active ? worldHours(net.epochNow) % 24 : this.ctx.view.atmo.hour; }

  frame(dt: number) {
    const now = net.active ? net.epochNow : Date.now(); const cam = this.ctx.view.camera;
    // boards: rotate shared LED faces every 8 seconds
    const slot = Math.floor(now / 8000);
    for (const [, v] of this.views) {
      const ad = this.live.find((a) => a.id === v.ads[slot % v.ads.length]);
      if (ad && ad.id !== v.shown && ad.img) { v.mat.map = this.texture(ad.img); v.mat.needsUpdate = true; v.shown = ad.id; }
    }
    // blimps follow the shared clock
    this.blimps.forEach((b, i) => { const p = blimpPos(i, now); b.g.position.set(p.x, p.y, p.z); b.g.rotation.y = p.yaw; });
    // drone shows: only at night; a 90 second loop of take off, words, a ring, and back
    const night = NIGHT(this.hour()); const t = performance.now() / 1000;
    for (const ad of this.live) if (ad.kind === 'drone') {
      const sh = night || this.previewing ? this.showFor(ad) : this.shows.get(ad.id);
      if (!sh) continue; sh.pts.visible = night || this.previewing;
      if (!sh.pts.visible) continue;
      const c = (t - sh.t0) % 90; const n = sh.text.length / 3;
      const k = c < 8 ? 0 : c < 14 ? (c - 8) / 6 : c < 70 ? 1 : c < 76 ? 1 - (c - 70) / 6 : 0;
      const e = k * k * (3 - 2 * k); const a = sh.pos.array as Float32Array;
      const ring = c >= 70 && c < 86; const lift = c < 8 ? c / 8 : 1;
      for (let i = 0; i < n; i++) {
        let sx = sh.swarm[i * 3], sy = sh.swarm[i * 3 + 1] * lift + (1 - lift) * -138, sz = sh.swarm[i * 3 + 2];
        if (ring) { const q = (i / n) * Math.PI * 2 + t * 0.4; sx = Math.cos(q) * 70; sy = Math.sin(q) * 70; sz = 0; }
        const w = Math.sin(t * 1.7 + i * 0.37) * 0.6;
        a[i * 3] = sx + (sh.text[i * 3] - sx) * e; a[i * 3 + 1] = sy + (sh.text[i * 3 + 1] - sy) * e + w; a[i * 3 + 2] = sz + (sh.text[i * 3 + 2] - sz) * e;
      }
      sh.pos.needsUpdate = true;
      sh.pts.rotation.y = Math.atan2(cam.position.x - sh.x, cam.position.z - sh.z); // the words face whoever is looking
    }
    // GPS to a board: done once you are there
    if (this.target) { const me = this.ctx.sim.local.pos; if (Math.hypot(me.x - this.target.x, me.z - this.target.z) < 45) this.target = null; }
    this.track(dt);
  }
  previewing = false;

  /** is this ad really on the player's screen? */
  private track(dt: number) {
    this.acc += dt; this.flushT += dt; if (this.acc < 0.25) return; const step = this.acc; this.acc = 0;
    const day = lagosDay(Date.now()); if (day !== this.reportDay) { this.reportDay = day; this.reported.clear(); this.seenT.clear(); }
    const THREE = this.THREE; const cam = this.ctx.view.camera as THREE_NS.PerspectiveCamera;
    this.frustum ??= new THREE.Frustum(); this.mtx ??= new THREE.Matrix4();
    this.mtx.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.mtx);
    const cp = cam.position; const H = this.ctx.view.renderer?.domElement?.clientHeight || 720; const fov = (cam.fov * Math.PI) / 180;
    const onScreen = (x: number, y: number, z: number, size: number, nx?: number, nz?: number) => {
      const dx = cp.x - x, dy = cp.y - y, dz = cp.z - z; const d = Math.hypot(dx, dy, dz); if (d > 2400) return false;
      if (nx !== undefined && nz !== undefined && (dx * nx + dz * nz) / (d || 1) < 0.25) return false; // seen from behind or edge on
      if ((size / d) * (H / (2 * Math.tan(fov / 2))) < H * 0.06) return false; // too small to read
      return this.frustum!.containsPoint(this.v3.set(x, y, z));
    };
    const hit = (id: number) => { const s = (this.seenT.get(id) ?? 0) + step; this.seenT.set(id, s); if (s >= 1.5 && !this.reported.has(id)) { this.reported.add(id); this.pending.add(id); } };
    const slot = Math.floor((net.active ? net.epochNow : Date.now()) / 8000);
    for (const [id, v] of this.views) { const b = boardById.get(id)!; const ad = v.ads[slot % v.ads.length]; if (ad !== undefined && onScreen(b.x, b.y, b.z, b.h, Math.sin(b.yaw), Math.cos(b.yaw))) hit(ad); }
    for (const [, sh] of this.shows) if (sh.pts.visible && onScreen(sh.x, 140, sh.z, 40)) hit(sh.ad.id);
    for (const b of this.blimps) if (b.ad !== null && onScreen(b.g.position.x, b.g.position.y, b.g.position.z, 18)) hit(b.ad);
    if (this.pending.size && this.flushT > 6 && net.active) { this.flushT = 0; const ids = [...this.pending]; this.pending.clear(); void net.act('ads.seen', { ids }); }
  }
  goal(): GoalPoint | null { return this.target; }

  // ------------------------------------------------------------------------------------------ the app
  private back() {
    const s = this.screen.s; if (s === 'home') return false;
    this.screen = s === 'board' ? { s: 'boards' } : { s: 'home' }; return true;
  }
  private redraw() { if (this.hud.appOpen === 'MyAds') this.hud.refreshApp(); }
  private async loadInv() { try { this.inv = await net.api<Inventory>('GET', '/api/ads/boards', undefined, false); this.redraw(); } catch (e: any) { this.hud.toast('MyAds', e?.message ?? 'Could not load the boards.', 'var(--red)', 'msg', 3); } }
  private async loadMine() { if (!net.token) return; try { const r = await net.api<{ list: Mine[] }>('GET', '/api/ads/mine'); this.mine = r.list; this.redraw(); } catch { /* offline */ } }
  private html(): string {
    if (!net.serverMode || !net.active) return `<div class="row"><b>MyAds needs the network</b>Billboards, drone shows and blimps are bought with real money, so MyAds only works when you play online.</div>`;
    if (!this.inv) { void this.loadInv(); void this.loadMine(); return `<div class="row">Loading the boards…</div>`; }
    const sc = this.screen;
    if (sc.s === 'boards') return this.boardsHtml();
    if (sc.s === 'board') return this.boardHtml(sc.id);
    if (sc.s === 'drone') return this.droneHtml();
    if (sc.s === 'blimp') return this.blimpHtml();
    if (sc.s === 'mine') return this.mineHtml(sc.id);
    return this.homeHtml();
  }
  private testNote() { return this.inv?.mode === 'test' ? `<div class="testnote">Test server: no real money moves. Payments go live when the Paystack keys are added.</div>` : this.inv?.mode === 'off' ? `<div class="testnote">Payments are switched off on this server.</div>` : ''; }
  private homeHtml() {
    const inv = this.inv!; const cheapest = Math.min(...inv.boards.map((b) => b.day));
    const camp = this.mine.length ? this.mine.map((m) => this.mineCell(m)).join('') : `<div class="row">Nothing running yet. Your first board can be up today.</div>`;
    return `<div class="ad-hero"><b>Put your name where Lagos looks.</b><span>Billboards at Oshodi and beyond, words in the night sky, a blimp over the city. You see how many real players saw it, every day.</span></div>
      <div class="ad-tiles">
        <button class="ad-tile" data-ad="go:boards"><i style="background:#fff1d6">▭</i><b>Billboards</b><span>from ${naira(cheapest)}/day</span></button>
        <button class="ad-tile" data-ad="go:drone"><i style="background:#ede9fe">✦</i><b>Drone show</b><span>from ${naira(Math.min(...inv.drone.spots.map((s) => s.day)))}</span></button>
        <button class="ad-tile" data-ad="go:blimp"><i style="background:#dcfce7">⬭</i><b>Blimp</b><span>${naira(inv.blimp.day)}/day</span></button>
      </div>
      <div class="ad-sec">Your campaigns</div>${camp}${this.testNote()}`;
  }
  private mineCell(m: Mine) {
    const where = m.kind === 'board' ? (boardById.get(m.board ?? '')?.place ?? m.board) : m.kind === 'drone' ? `“${m.text}” over ${DRONE_SPOTS.find((s) => s.id === m.place)?.name ?? m.place}` : 'Blimp banner';
    const today = m.days.find((d) => d.day === lagosDay(Date.now()))?.people ?? 0;
    return `<div class="cell" data-ad="mine:${m.id}"><div class="tx"><b>${esc(where ?? '')}</b><span>${m.start} to ${m.end} · ${m.reach.toLocaleString()} people so far</span></div><div class="rt"><span class="tag ${m.status}">${m.status}</span>${m.status === 'live' ? `<br>${today} today` : ''}</div></div>`;
  }
  private boardsHtml() {
    const me = this.ctx.sim.local.pos; const inv = this.inv!;
    const list = [...inv.boards].sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    const km = (b: AdBoard) => { const d = Math.hypot(b.x - me.x, b.z - me.z); return d < 1000 ? `${Math.round(d / 10) * 10} m away` : `${(d / 1000).toFixed(1)} km away`; };
    return `<div class="ad-sec">Nearest first</div>` + list.map((b) => `<div class="cell" data-ad="board:${b.id}"><div class="tx"><b>${esc(b.place)}</b><span><span class="tag ${b.tier}">${b.tier}</span>${b.w} × ${b.h} m${(b.slots ?? 1) > 1 ? ' · LED, shared with 2 others' : ''} · ${km(b)}</span></div><div class="rt"><b style="color:#11131a;font-size:13px">${naira(b.day)}</b><br>${b.nextFree === inv.today ? 'free today' : b.nextFree ? `free ${b.nextFree.slice(5)}` : 'booked'}</div></div>`).join('');
  }
  private dateChips() {
    const inv = this.inv!; const t0 = Date.parse(inv.today + 'T12:00:00Z'); const ds = [0, 1, 2, 7].map((k) => new Date(t0 + k * 86400_000).toISOString().slice(0, 10));
    if (!this.form.start) this.form.start = ds[0];
    const lab = (d: string, k: number) => (k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));
    return `<div class="chips">${ds.map((d, k) => `<button class="${this.form.start === d ? 'on' : ''}" data-ad="start:${d}">${lab(d, k)}</button>`).join('')}</div>`;
  }
  private dayChips() { return `<div class="chips">${AD_DAYS.map((d) => `<button class="${this.form.days === d ? 'on' : ''}" data-ad="days:${d}">${d === 1 ? '1 day' : `${d} days`}</button>`).join('')}</div>`; }
  private priceHtml(q: ReturnType<typeof adQuote>, unit = 'day') {
    return `<div class="price"><span>${naira(q.day)} × ${q.days} ${unit}${q.days > 1 ? 's' : ''}</span><span>${naira(q.gross)}</span></div>${q.discount ? `<div class="price"><span>${Math.round(q.discount * 100)}% off for ${q.days} ${unit}s</span><span>−${naira(q.gross - q.total)}</span></div>` : ''}<div class="price tot"><span>Total</span><span>${naira(q.total)}</span></div>`;
  }
  private payBlock(label: string) {
    return `<div class="row"><b>Pay</b>Card, bank transfer or USSD through Paystack. A person on our team checks every ad before it goes up; if we turn it down, you get your money back.<button class="btn" data-ad="order" ${this.form.busy ? 'disabled' : ''}>${this.form.busy ? 'Opening checkout…' : label}</button>${this.testNote()}</div>`;
  }
  private uploadBlock(px: { w: number; h: number }) {
    const u = this.form.upload;
    return `<label class="file">${u ? 'Change picture' : 'Choose a picture'}<input type="file" id="ad-file" accept="image/png,image/jpeg,image/webp"></label><span style="display:block;margin-top:6px;font-size:11.5px;color:#8a8f9c">Best at ${px.w} × ${px.h} px. Any picture works: we crop it to fit the board. No nudity, no hate, nothing that pretends to be another brand.</span>${u ? `<img class="ad-prev" src="${u.preview}" alt="Your ad">` : ''}`;
  }
  private boardHtml(id: string) {
    const b = this.inv!.boards.find((x) => x.id === id); if (!b) return `<div class="row">That board is gone.</div>`;
    const q = adQuote('board', this.form.days, { board: b });
    return `<div class="row"><b>${esc(b.place)}</b><span class="tag ${b.tier}">${b.tier}</span>${b.w} × ${b.h} m face${(b.slots ?? 1) > 1 ? '. A big LED screen: your ad shares it with up to two others, eight seconds each, all day.' : '. Yours alone for the days you book.'}<br><button class="btn" data-ad="show:${b.id}">Show me where</button></div>
      <div class="row"><b>Your picture</b>${this.uploadBlock(b.px)}</div>
      <div class="row"><b>When</b>Start${this.dateChips()}<div style="margin-top:8px">For</div>${this.dayChips()}</div>
      <div class="row"><b>Price</b>${this.priceHtml(q)}</div>${this.payBlock(`Pay ${naira(q.total)}`)}`;
  }
  private droneHtml() {
    const inv = this.inv!; const q = adQuote('drone', this.form.days, { spot: this.form.place });
    return `<div class="row"><b>Words in the night sky</b>Hundreds of drones spell your message over the city every night of your booking, from 7:30 pm to 5 am game time. Birthdays, proposals, launches, a shout out to your area.</div>
      <div class="row"><b>Your message</b><input id="ad-text" maxlength="${DRONE_TEXT_MAX}" value="${esc(this.form.text)}" placeholder="HAPPY BIRTHDAY TOLU" autocomplete="off"><span style="display:block;margin-top:6px;font-size:11.5px;color:#8a8f9c">Up to ${DRONE_TEXT_MAX} letters and numbers. Shown in capitals.</span>
        <div class="chips">${COLORS.map((c) => `<button class="sw ${this.form.color === c ? 'on' : ''}" style="background:${c}" data-ad="color:${c}" aria-label="Colour"></button>`).join('')}</div></div>
      <div class="row"><b>Where</b><div class="chips">${inv.drone.spots.map((s) => `<button class="${this.form.place === s.id ? 'on' : ''}" data-ad="place:${s.id}">${esc(s.name)} · ${naira(s.day)}</button>`).join('')}</div></div>
      <div class="row"><b>When</b>Start${this.dateChips()}<div style="margin-top:8px">For</div>${this.dayChips()}</div>
      <div class="row"><b>Price</b>${this.priceHtml(q, 'night')}<button class="btn" data-ad="preview" style="background:#11131a">Preview it in the sky</button></div>${this.payBlock(`Pay ${naira(q.total)}`)}`;
  }
  private blimpHtml() {
    const inv = this.inv!; const q = adQuote('blimp', this.form.days);
    return `<div class="row"><b>A blimp over Lagos</b>Three airships loop the city all day: Oshodi to Ikeja, the mainland to Yaba and Surulere, and the lagoon to Ikoyi. Your banner goes on both sides of one of them. ${inv.blimp.nextFree === inv.today ? 'One is free today.' : inv.blimp.nextFree ? `Next free from ${inv.blimp.nextFree}.` : 'All booked for now.'}</div>
      <div class="row"><b>Your banner</b>${this.uploadBlock(BLIMP_PX)}</div>
      <div class="row"><b>When</b>Start${this.dateChips()}<div style="margin-top:8px">For</div>${this.dayChips()}</div>
      <div class="row"><b>Price</b>${this.priceHtml(q)}</div>${this.payBlock(`Pay ${naira(q.total)}`)}`;
  }
  private mineHtml(id: number) {
    const m = this.mine.find((x) => x.id === id); if (!m) return `<div class="row">Not found.</div>`;
    const days = m.days.slice(-14); const top = Math.max(1, ...days.map((d) => d.people));
    const bars = days.length ? `<div class="bars">${days.map((d) => `<div style="height:${Math.max(4, (d.people / top) * 100)}%" title="${d.people} people"><span>${d.day.slice(8)}</span></div>`).join('')}</div><div style="height:14px"></div>` : '<div style="margin-top:6px">No one has seen it yet. Numbers show up here as soon as players drive past.</div>';
    const where = m.kind === 'board' ? boardById.get(m.board ?? '')?.place : m.kind === 'drone' ? `Drone show, ${DRONE_SPOTS.find((s) => s.id === m.place)?.name}` : 'Blimp banner';
    const note = m.status === 'review' ? 'Paid. A person on our team checks every ad before it goes up, usually within a few hours.' : m.status === 'rejected' ? `Not approved${m.note ? `: ${esc(m.note)}` : '.'} Your money is refunded to the card you paid with.` : m.status === 'unpaid' ? 'Not paid yet. The slot is held for 20 minutes.' : '';
    return `<div class="row"><b>${esc(where ?? '')}</b><span class="tag ${m.status}">${m.status}</span>${m.start} to ${m.end} · ${naira(m.naira)}${note ? `<div style="margin-top:6px">${note}</div>` : ''}${m.img ? `<img class="ad-prev" src="${this.http + m.img}" alt="">` : ''}${m.board ? `<button class="btn" data-ad="show:${m.board}">Show me where</button>` : ''}</div>
      <div class="row"><b>Real players who saw it</b><div class="big">${m.reach.toLocaleString()}</div>Each player counts once a day, and only when the ad was on their screen long enough to read. Your own views do not count.${bars}</div>
      <div class="row"><b>Sightings</b>${m.days.reduce((n, d) => n + d.sightings, 0).toLocaleString()} times on screen in total. A player who passes again after five minutes counts as a new sighting.</div>`;
  }
  private wire() {
    const L = document.getElementById('av-l'); if (!L || this.hud.appOpen !== 'MyAds') return;
    L.querySelectorAll<HTMLElement>('[data-ad]').forEach((el) => { if ((el as any)._ad) return; (el as any)._ad = 1; el.addEventListener('click', (e) => { e.stopPropagation(); void this.act(el.dataset.ad!); }); });
    const f = document.getElementById('ad-file') as HTMLInputElement | null; if (f && !(f as any)._ad) { (f as any)._ad = 1; f.addEventListener('change', () => { const file = f.files?.[0]; if (file) void this.pick(file); }); }
    const tx = document.getElementById('ad-text') as HTMLInputElement | null; if (tx && !(tx as any)._ad) { (tx as any)._ad = 1; tx.addEventListener('input', () => { this.form.text = tx.value; }); }
  }
  async act(op: string) {
    const i = op.indexOf(':'); const k = i < 0 ? op : op.slice(0, i); const v = i < 0 ? '' : op.slice(i + 1);
    if (k === 'go') { this.screen = { s: v as 'boards' }; this.form.upload = null; this.form.days = v === 'drone' ? 1 : 3; }
    else if (k === 'board') { this.screen = { s: 'board', id: v }; this.form.upload = null; }
    else if (k === 'mine') { this.screen = { s: 'mine', id: Number(v) }; void this.loadMine(); }
    else if (k === 'days') this.form.days = Number(v);
    else if (k === 'start') this.form.start = v;
    else if (k === 'color') this.form.color = v;
    else if (k === 'place') this.form.place = v;
    else if (k === 'show') { const b = boardById.get(v); if (b) { this.target = { x: b.x, z: b.z, label: b.place }; this.hud.toast('MyAds', `GPS set: ${b.place}.`, 'linear-gradient(140deg,#ff7a18,#e2336b)', 'msg', 3); } return; }
    else if (k === 'preview') { this.previewSky(); return; }
    else if (k === 'order') { await this.order(); return; }
    this.redraw();
  }
  /** crop the picture to the board's shape and size, then upload it */
  async pick(file: File) {
    const px = this.screen.s === 'board' ? this.inv!.boards.find((b) => b.id === (this.screen as any).id)!.px : BLIMP_PX;
    if (file.size > 20_000_000) { this.hud.toast('MyAds', 'That file is too big. Pick one under 20 MB.', 'var(--red)', 'msg', 3); return; }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('bad')); im.src = url; });
      const c = document.createElement('canvas'); c.width = px.w; c.height = px.h; const g = c.getContext('2d')!;
      const s = Math.max(px.w / img.naturalWidth, px.h / img.naturalHeight); const w = img.naturalWidth * s, h = img.naturalHeight * s;
      g.fillStyle = '#000'; g.fillRect(0, 0, px.w, px.h); g.drawImage(img, (px.w - w) / 2, (px.h - h) / 2, w, h);
      const data = c.toDataURL('image/jpeg', 0.88);
      const r = await net.api<{ id: string }>('POST', '/api/uploads', { data });
      this.form.upload = { id: r.id, preview: data }; this.redraw();
    } catch (e: any) { this.hud.toast('MyAds', e?.message === 'bad' ? 'We could not open that picture.' : (e?.message ?? 'Upload failed.'), 'var(--red)', 'msg', 3.5); }
    finally { URL.revokeObjectURL(url); }
  }
  /** the one checkout (systems/pay.ts): the server prices the order, holds the slot and opens Paystack */
  private async order() {
    const sc = this.screen; const f = this.form; if (f.busy) return;
    const meta: Record<string, unknown> = { days: f.days, start: f.start };
    if (sc.s === 'board') Object.assign(meta, { kind: 'board', board: sc.id, upload: f.upload?.id });
    else if (sc.s === 'blimp') Object.assign(meta, { kind: 'blimp', upload: f.upload?.id });
    else if (sc.s === 'drone') { const t = (document.getElementById('ad-text') as HTMLInputElement | null)?.value ?? f.text; f.text = t; Object.assign(meta, { kind: 'drone', place: f.place, text: t, color: f.color }); }
    else return;
    if (meta.kind !== 'drone' && !f.upload) { this.hud.toast('MyAds', 'Choose your picture first.', 'var(--red)', 'msg', 3); return; }
    f.busy = true;
    const r = await payApi.checkout('ad:new', meta); f.busy = false;
    if (!r) { this.redraw(); return; }
    f.upload = null; const id = Number((r.granted as any)?.adId) || 0;
    this.hud.toast('MyAds', 'Paid. Your ad is with the review team now.', 'linear-gradient(140deg,#22c55e,#15803d)', 'msg', 4.5);
    await this.loadMine(); void this.loadInv();
    if (id) this.screen = { s: 'mine', id }; else this.screen = { s: 'home' };
    this.hud.openAppByName('MyAds');
  }
  /** show a drone message in the sky for twenty seconds, only for you */
  previewSky() {
    const f = this.form; const t = ((document.getElementById('ad-text') as HTMLInputElement | null)?.value ?? f.text).toUpperCase().trim() || 'YOUR WORDS HERE';
    const ad: LiveAd = { id: -1, kind: 'drone', board: null, img: null, text: t.slice(0, DRONE_TEXT_MAX), color: f.color, place: f.place, until: Date.now() + 20_000 };
    const old = this.shows.get(-1); if (old) this.dropShow(-1, old);
    this.live = [...this.live.filter((a) => a.id !== -1), ad]; this.previewing = true; const sh = this.showFor(ad); sh.t0 = performance.now() / 1000 - 12;
    const spot = DRONE_SPOTS.find((s) => s.id === f.place)!; this.target = { x: spot.x, z: spot.z, label: 'Drone show preview' };
    this.hud.toast('MyAds', `Look up over ${spot.name}. Preview for 20 seconds, only you can see it.`, 'linear-gradient(140deg,#6d28d9,#e2336b)', 'msg', 4);
    setTimeout(() => { this.previewing = false; this.live = this.live.filter((a) => a.id !== -1); const s2 = this.shows.get(-1); if (s2) this.dropShow(-1, s2); }, 20_000);
  }
}

let A: AdsApp | null = null;
export const adsSystem: GameSystem & { get api(): AdsApp | null } = {
  id: 'ads', get api() { return A; },
  init(ctx) { A = new AdsApp(ctx); A.init(); },
  start() { A?.start(); },
  frame(_ctx, dt) { A?.frame(dt); },
  goal() { return A?.target ?? null; },
};
