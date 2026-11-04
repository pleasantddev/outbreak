// The city map, full screen (M, the Map app, or tap the radar): the whole of Lagos in baked tiles, live street detail
// near you, area names, and GTA-style icons for hospitals, chemists, police, banks, fuel, food, clubs, shops, parks and
// more. Tap or click anywhere to drop a waypoint: the GPS routes you there and the radar points at it. Tap an icon to
// see what it is and set a waypoint on it. Drag to move, scroll or pinch to zoom.
import { CATS, CAT_IDS, POI_CAT, PLACE_CAT, drawIcon, drawPin, type MapCat } from './mapIcons';
import type { RegionStore } from '../world/region';

export interface MapMarker { x: number; z: number; cat: MapCat; name: string; sub?: string; /** a named place from content/places.json (shown when zoomed out) */ major?: boolean }
export interface MapHooks {
  me(): { x: number; z: number; heading: number };
  route(): number[] | null;
  /** the current objective from a job or mission (yellow), if any */
  goal(): { x: number; z: number; label?: string } | null;
  waypoint(): { x: number; z: number; label?: string } | null;
  setWaypoint(w: { x: number; z: number; label?: string } | null): void;
  /** live markers from systems (your place, businesses, clubs, venues, jobs) */
  markers(): MapMarker[];
  owned(): number[][];
  store: RegionStore;
  onOpen?(on: boolean): void;
  openLand?(): void;
}
interface Index { x0: number; z0: number; px: number; levels: { L: number; mpp: number; nx: number; nz: number }[]; bounds: [number, number, number, number] }

const css = `
#cmap{position:fixed;inset:0;z-index:40;background:#10141b;display:none;touch-action:none;user-select:none;font-family:Inter,system-ui,sans-serif;color:#e8ecf2}
#cmap.on{display:block}
#cmap canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab}
#cmap canvas.drag{cursor:grabbing}
#cmap .top{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:10px;padding:max(12px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) 12px max(16px,env(safe-area-inset-left));background:linear-gradient(#10141bee,#10141b00);pointer-events:none}
#cmap .top h2{margin:0;font:800 20px Inter,sans-serif;letter-spacing:-.3px} #cmap .top span{color:#9aa4b2;font-size:12.5px}
#cmap .top .sp{flex:1}
#cmap button{pointer-events:auto;font:600 13px Inter,sans-serif;border:none;cursor:pointer;color:#e8ecf2;background:rgba(24,29,38,.92);border-radius:12px;padding:9px 13px;box-shadow:0 2px 8px rgba(0,0,0,.35);-webkit-tap-highlight-color:transparent}
#cmap button:active{transform:scale(.97)}
#cmap .x{width:40px;height:40px;padding:0;border-radius:50%;font-size:20px;line-height:40px}
#cmap .zoom{position:absolute;right:max(16px,env(safe-area-inset-right));bottom:calc(max(16px,env(safe-area-inset-bottom)) + 4px);display:flex;flex-direction:column;gap:8px}
#cmap .zoom button{width:44px;height:44px;padding:0;border-radius:14px;font-size:20px}
#cmap .legend{position:absolute;left:max(16px,env(safe-area-inset-left));top:72px;bottom:max(16px,env(safe-area-inset-bottom));width:230px;overflow:auto;background:rgba(16,20,27,.86);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:8px;backdrop-filter:blur(8px);scrollbar-width:thin}
#cmap .legend.closed{display:none}
#cmap .legend h4{margin:6px 8px 6px;font:700 11px Inter,sans-serif;text-transform:uppercase;letter-spacing:.7px;color:#7d8796}
#cmap .lg{display:flex;align-items:center;gap:10px;width:100%;background:none;box-shadow:none;border-radius:10px;padding:6px 8px;text-align:left;font-weight:500;color:#d6dce5}
#cmap .lg:hover{background:rgba(255,255,255,.05)} #cmap .lg.off{opacity:.38}
#cmap .lg i{flex:none;width:22px;height:22px;border-radius:50%;display:block}
#cmap .lg em{margin-left:auto;font-style:normal;color:#6b7482;font-size:11.5px}
#cmap .card{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(max(16px,env(safe-area-inset-bottom)) + 4px);width:min(380px,calc(100% - 140px));background:rgba(16,20,27,.95);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.45);display:none}
#cmap .card.on{display:block} #cmap .card b{display:block;font-size:16px;letter-spacing:-.2px} #cmap .card span{display:block;color:#9aa4b2;font-size:12.5px;margin-top:3px}
#cmap .card .row{display:flex;gap:8px;margin-top:12px} #cmap .card .go{background:#8f3dff;color:#fff} #cmap .card .go.clear{background:#2a303b}
#cmap .tips{position:absolute;left:50%;transform:translateX(-50%);top:calc(max(12px,env(safe-area-inset-top)) + 54px);background:rgba(16,20,27,.85);border-radius:999px;padding:7px 14px;font-size:12.5px;color:#c7ced8;pointer-events:none;white-space:nowrap}
#cmap .narrow{display:none}
@media (max-width:520px){#cmap .narrow{display:inline}#cmap .wide{display:none}#cmap #cm-sub{display:none}#cmap .top{gap:6px}#cmap .top button{padding:8px 10px}}
@media (max-width:760px),(max-height:520px){#cmap .legend{top:auto;bottom:calc(max(16px,env(safe-area-inset-bottom)) + 60px);left:max(12px,env(safe-area-inset-left));width:200px;max-height:46vh}#cmap .card{width:calc(100% - 96px);left:12px;transform:none}#cmap .tips{display:none}#cmap .top h2{font-size:17px}}
`;

export class CityMap {
  private el: HTMLDivElement; private cv: HTMLCanvasElement; private g: CanvasRenderingContext2D;
  private legend: HTMLDivElement; private card: HTMLDivElement; private tips: HTMLDivElement;
  on = false; private cx = 0; private cz = 0; private mpp = 6; private dirty = true;
  private idx: Index | null = null; private tiles = new Map<string, HTMLImageElement | null>();
  private labels: [string, number, number, number][] = []; private pois: MapMarker[] = [];
  private hidden = new Set<MapCat>(['hotel', 'mechanic']);
  private sel: MapMarker | { x: number; z: number; cat: 'wp'; name: string } | null = null;
  private ptrs = new Map<number, { x: number; y: number }>(); private moved = 0; private pinch = 0; private downAt = 0;
  constructor(private h: MapHooks, private base = 'world/') {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    const el = this.el = document.createElement('div'); el.id = 'cmap';
    el.innerHTML = `<canvas></canvas><div class="top"><div><h2>Lagos</h2><span id="cm-sub">Tap anywhere to set a waypoint</span></div><div class="sp"></div>
      <button id="cm-lg">Legend</button><button id="cm-land"><span class="wide">Land for sale</span><span class="narrow">Land</span></button><button id="cm-me">Me</button><button class="x" id="cm-x" aria-label="Close">×</button></div>
      <div class="legend" id="cm-legend"></div><div class="tips">Drag to move · Scroll to zoom · Click to set a waypoint · M to close</div>
      <div class="zoom"><button id="cm-zi" aria-label="Zoom in">+</button><button id="cm-zo" aria-label="Zoom out">−</button></div><div class="card" id="cm-card"></div>`;
    document.body.appendChild(el);
    this.cv = el.querySelector('canvas')!; this.g = this.cv.getContext('2d')!;
    this.legend = el.querySelector('#cm-legend')!; this.card = el.querySelector('#cm-card')!; this.tips = el.querySelector('.tips')!;
    if (matchMedia('(max-width:760px),(max-height:520px)').matches) this.legend.classList.add('closed');
    el.querySelector<HTMLButtonElement>('#cm-x')!.onclick = () => this.toggle(false);
    el.querySelector<HTMLButtonElement>('#cm-me')!.onclick = () => { const m = this.h.me(); this.cx = m.x; this.cz = m.z; this.mpp = Math.min(this.mpp, 3); this.dirty = true; };
    el.querySelector<HTMLButtonElement>('#cm-zi')!.onclick = () => this.zoom(1 / 1.6);
    el.querySelector<HTMLButtonElement>('#cm-zo')!.onclick = () => this.zoom(1.6);
    el.querySelector<HTMLButtonElement>('#cm-lg')!.onclick = () => this.legend.classList.toggle('closed');
    const land = el.querySelector<HTMLButtonElement>('#cm-land')!; if (this.h.openLand) land.onclick = () => { this.toggle(false); this.h.openLand!(); }; else land.style.display = 'none';
    this.wire(); this.drawLegend();
    addEventListener('resize', () => { if (this.on) this.size(); });
    (window as any).__citymap = this;
  }
  get isOpen() { return this.on; }
  toggle(on = !this.on) {
    this.on = on; this.el.classList.toggle('on', on); this.h.onOpen?.(on);
    if (on) { const m = this.h.me(); this.cx = m.x; this.cz = m.z; this.mpp = 3.2; this.sel = null; this.cardShow(); this.size(); void this.load(); this.dirty = true; this.loop(); setTimeout(() => (this.tips.style.opacity = '0'), 5000); this.tips.style.opacity = '1'; }
  }
  private size() { const d = Math.min(2, devicePixelRatio || 1); this.cv.width = Math.round(innerWidth * d); this.cv.height = Math.round(innerHeight * d); this.dirty = true; }
  private async load() {
    if (this.idx) return;
    try {
      const [idx, labels, pois, places] = await Promise.all([
        fetch(this.base + 'map/index.json').then((r) => r.json()), fetch(this.base + 'map/labels.json').then((r) => r.json()), fetch(this.base + 'map/pois.json').then((r) => r.json()),
        fetch('content/places.json').then((r) => r.json()).catch(() => ({ items: [] })),
      ]);
      this.idx = idx; this.labels = labels;
      const out: MapMarker[] = [];
      for (const [k, x, z, name] of pois as [number, number, number, string][]) { const cat = POI_CAT[k]; if (cat) out.push({ x, z, cat, name: name || CATS[cat].label.split(' ')[0] }); }
      for (const p of places.items as { name: string; kind: string; lat: number; lon: number }[]) { const cat = PLACE_CAT[p.kind]; if (!cat) continue; const w = this.h.store.project(p.lat, p.lon); out.push({ x: w.x, z: w.z, cat, name: p.name, major: true } as MapMarker); }
      this.pois = out; this.drawLegend(); this.dirty = true;
    } catch (e) { console.warn('[map] could not load', e); }
  }
  /** all markers, static and live */
  private all(): MapMarker[] { return this.pois.concat(this.h.markers()); }
  /** the nearest icons around a point, for the radar */
  near(x: number, z: number, r: number, max = 14) {
    const out: (MapMarker & { d: number })[] = [];
    for (const m of this.all()) { if (this.hidden.has(m.cat)) continue; const d = Math.hypot(m.x - x, m.z - z); if (d < Math.min(r, CATS[m.cat].radar)) out.push({ ...m, d }); }
    out.sort((a, b) => a.d - b.d);
    const per = new Map<MapCat, number>(); const res: MapMarker[] = [];
    for (const m of out) { const n = per.get(m.cat) ?? 0; if (n >= 2) continue; per.set(m.cat, n + 1); res.push(m); if (res.length >= max) break; }
    return res;
  }
  /** used by the Health app and others: the nearest marker of a kind */
  nearest(cat: MapCat, x: number, z: number) { let best: MapMarker | null = null, bd = Infinity; for (const m of this.all()) if (m.cat === cat) { const d = Math.hypot(m.x - x, m.z - z); if (d < bd) { bd = d; best = m; } } return best; }

  // ------------------------------------------------------------------------------------------ input
  private toWorld(px: number, py: number) { return { x: this.cx + (px - innerWidth / 2) * this.mpp, z: this.cz + (py - innerHeight / 2) * this.mpp }; }
  private toScreen(x: number, z: number) { return { x: (x - this.cx) / this.mpp + innerWidth / 2, y: (z - this.cz) / this.mpp + innerHeight / 2 }; }
  private zoom(f: number, px = innerWidth / 2, py = innerHeight / 2) {
    const before = this.toWorld(px, py); this.mpp = Math.max(0.45, Math.min(48, this.mpp * f)); const after = this.toWorld(px, py);
    this.cx += before.x - after.x; this.cz += before.z - after.z; this.dirty = true;
  }
  private wire() {
    const c = this.cv;
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.moved = 0; this.downAt = performance.now(); if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; this.pinch = Math.hypot(a.x - b.x, a.y - b.y); } c.classList.add('drag'); });
    c.addEventListener('pointermove', (e) => {
      const p = this.ptrs.get(e.pointerId); if (!p) return;
      if (this.ptrs.size === 1) { const dx = e.clientX - p.x, dy = e.clientY - p.y; this.moved += Math.abs(dx) + Math.abs(dy); this.cx -= dx * this.mpp; this.cz -= dy * this.mpp; this.dirty = true; }
      p.x = e.clientX; p.y = e.clientY;
      if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (this.pinch > 0) this.zoom(this.pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2); this.pinch = d; this.moved += 99; }
    });
    const up = (e: PointerEvent) => {
      const was = this.ptrs.size; this.ptrs.delete(e.pointerId); if (!this.ptrs.size) c.classList.remove('drag'); this.pinch = 0;
      if (was === 1 && this.moved < 8 && performance.now() - this.downAt < 600) this.tap(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', (e) => { this.ptrs.delete(e.pointerId); this.pinch = 0; });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY); }, { passive: false });
    addEventListener('keydown', (e) => {
      if (!this.on) return;
      const k = e.code; const step = 60 * this.mpp;
      if (k === 'Escape' || k === 'KeyM') { e.preventDefault(); e.stopImmediatePropagation(); this.toggle(false); }
      else if (k === 'ArrowLeft' || k === 'KeyA') this.cx -= step; else if (k === 'ArrowRight' || k === 'KeyD') this.cx += step;
      else if (k === 'ArrowUp' || k === 'KeyW') this.cz -= step; else if (k === 'ArrowDown' || k === 'KeyS') this.cz += step;
      else if (k === 'Equal' || k === 'NumpadAdd' || k === 'KeyE') this.zoom(1 / 1.4); else if (k === 'Minus' || k === 'NumpadSubtract' || k === 'KeyQ') this.zoom(1.4);
      else if (k === 'Enter' || k === 'Space') { const w = { x: this.cx, z: this.cz }; this.h.setWaypoint(w); this.sel = { ...w, cat: 'wp', name: 'Waypoint' }; this.cardShow(); }
      else return;
      e.preventDefault(); e.stopImmediatePropagation(); this.dirty = true;
    }, true);
  }
  private tap(px: number, py: number) {
    // an icon under the finger?
    let hit: MapMarker | null = null, hd = 22;
    for (const m of this.visibleMarkers()) { const s = this.toScreen(m.x, m.z); const d = Math.hypot(s.x - px, s.y - py); if (d < hd) { hd = d; hit = m; } }
    const wp = this.h.waypoint(); if (wp) { const s = this.toScreen(wp.x, wp.z); if (Math.hypot(s.x - px, s.y - (py + 14)) < 20) { this.h.setWaypoint(null); this.sel = null; this.cardShow(); this.dirty = true; return; } }
    if (hit) { this.sel = hit; this.cardShow(); this.dirty = true; return; }
    const w = this.toWorld(px, py); this.h.setWaypoint({ x: w.x, z: w.z }); this.sel = { x: w.x, z: w.z, cat: 'wp', name: 'Waypoint' }; this.cardShow(); this.dirty = true;
  }
  private dist(x: number, z: number) { const m = this.h.me(); const d = Math.hypot(x - m.x, z - m.z); return d >= 1000 ? `${(d / 1000).toFixed(1)} km away` : `${Math.round(d / 10) * 10} m away`; }
  private cardShow() {
    const s = this.sel; const c = this.card;
    if (!s) { c.classList.remove('on'); return; }
    const isWp = s.cat === 'wp'; const area = this.areaName(s.x, s.z);
    c.innerHTML = `<b>${esc(isWp ? 'Waypoint set' : s.name)}</b><span>${isWp ? `${area ? esc(area) + ' · ' : ''}${this.dist(s.x, s.z)}. Follow the line on your radar.` : `${CATS[s.cat as MapCat].label.replace(/s$/, '').replace(/ and .*/, '')}${area ? ' · ' + esc(area) : ''} · ${this.dist(s.x, s.z)}`}</span>
      <div class="row">${isWp ? '<button class="go clear" data-c="clear">Clear waypoint</button><button data-c="close">Back to the game</button>' : '<button class="go" data-c="wp">Set waypoint</button><button data-c="x">Close</button>'}</div>`;
    c.classList.add('on');
    c.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.c;
      if (k === 'wp' && s && s.cat !== 'wp') { this.h.setWaypoint({ x: s.x, z: s.z, label: s.name }); this.sel = { x: s.x, z: s.z, cat: 'wp', name: s.name }; this.cardShow(); }
      else if (k === 'clear') { this.h.setWaypoint(null); this.sel = null; this.cardShow(); }
      else if (k === 'close') this.toggle(false);
      else { this.sel = null; this.cardShow(); }
      this.dirty = true;
    }));
  }
  private areaName(x: number, z: number) { let best = '', bd = 2500; for (const [n, lx, lz, k] of this.labels) { if (k > 3) continue; const d = Math.hypot(lx - x, lz - z) * (k <= 1 ? 1.6 : 1); if (d < bd) { bd = d; best = n; } } return best; }
  private drawLegend() {
    const counts = new Map<MapCat, number>(); for (const m of this.pois) counts.set(m.cat, (counts.get(m.cat) ?? 0) + 1);
    const ids = CAT_IDS.filter((k) => counts.has(k) || ['home', 'jobs', 'business', 'club', 'sports'].includes(k));
    this.legend.innerHTML = `<h4>Show on map</h4>` + ids.map((k) => `<button class="lg${this.hidden.has(k) ? ' off' : ''}" data-k="${k}"><i style="background:${CATS[k].color}"></i>${CATS[k].label}<em>${counts.get(k) ?? ''}</em></button>`).join('');
    this.legend.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => (b.onclick = () => { const k = b.dataset.k as MapCat; if (this.hidden.has(k)) this.hidden.delete(k); else this.hidden.add(k); b.classList.toggle('off'); this.dirty = true; }));
  }

  // ------------------------------------------------------------------------------------------ drawing
  private visibleMarkers() {
    const pad = 30; const far = this.mpp > 14, mid = this.mpp > 5;
    const PRI: MapCat[] = ['home', 'jobs', 'club', 'police', 'hospital', 'fuel', 'transport', 'market', 'bank', 'pharmacy', 'phones', 'shop', 'food', 'sports', 'business', 'landmark', 'hotel', 'mechanic'];
    const cand: MapMarker[] = [];
    for (const m of this.all()) {
      if (this.hidden.has(m.cat)) continue;
      // zoomed out: only named places and your own things; mid zoom: no small shops and food stalls
      if (far && !m.major && !['home', 'jobs', 'club'].includes(m.cat)) continue;
      if (mid && !m.major && ['food', 'bank', 'shop', 'pharmacy', 'mechanic', 'hotel', 'hospital'].includes(m.cat)) continue;
      const s = this.toScreen(m.x, m.z); if (s.x < -pad || s.y < -pad || s.x > innerWidth + pad || s.y > innerHeight + pad) continue;
      cand.push(m);
    }
    // declutter on screen: higher priority first, drop anything that would overlap an icon already placed
    cand.sort((a, b) => PRI.indexOf(a.cat) - PRI.indexOf(b.cat) || Number(!!b.major) - Number(!!a.major));
    const out: MapMarker[] = []; const placed: { x: number; y: number }[] = []; const gap = this.mpp > 4 ? 20 : 24;
    for (const m of cand) { const s = this.toScreen(m.x, m.z); if (placed.some((p) => Math.abs(p.x - s.x) < gap && Math.abs(p.y - s.y) < gap)) continue; placed.push(s); out.push(m); if (out.length > 260) break; }
    return out;
  }
  private tile(L: number, i: number, j: number) {
    const k = `${L}_${i}_${j}`; if (this.tiles.has(k)) return this.tiles.get(k)!;
    this.tiles.set(k, null); const im = new Image(); im.decoding = 'async'; im.onload = () => { this.tiles.set(k, im); this.dirty = true; }; im.onerror = () => {}; im.src = `${this.base}map/t${k}.webp`; return null;
  }
  private loop = () => { if (!this.on) return; if (this.dirty) { this.dirty = false; this.draw(); } requestAnimationFrame(this.loop); };
  /** call when the player moves or the route changes */
  poke() { if (this.on) this.dirty = true; }
  private draw() {
    const g = this.g, d = this.cv.width / innerWidth, W = innerWidth, H = innerHeight;
    g.setTransform(d, 0, 0, d, 0, 0); g.fillStyle = '#10141b'; g.fillRect(0, 0, W, H);
    const I = this.idx;
    if (I) {
      // the sharpest baked level that is not finer than needed, plus the next coarser one underneath while it loads
      const want = I.levels.filter((l) => l.mpp <= this.mpp * 2 * d).pop() ?? I.levels[I.levels.length - 1];
      const lvls = I.levels.filter((l) => l.L <= want.L).slice(-2);
      for (const lv of lvls) {
        const span = I.px * lv.mpp;
        const a = this.toWorld(0, 0), b = this.toWorld(W, H);
        const i0 = Math.max(0, Math.floor((a.x - I.x0) / span)), i1 = Math.min(lv.nx - 1, Math.floor((b.x - I.x0) / span));
        const j0 = Math.max(0, Math.floor((a.z - I.z0) / span)), j1 = Math.min(lv.nz - 1, Math.floor((b.z - I.z0) / span));
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const im = lv.L === want.L ? this.tile(lv.L, i, j) : this.tiles.get(`${lv.L}_${i}_${j}`) ?? this.tile(lv.L, i, j); if (!im) continue;
          const s = this.toScreen(I.x0 + i * span, I.z0 + j * span); const sz = span / this.mpp;
          g.imageSmoothingEnabled = true; g.drawImage(im, s.x, s.y, sz + 0.5, sz + 0.5);
        }
      }
    }
    // close up: live streets from the regions you have loaded, sharper than the tiles
    if (this.mpp < 2.2) this.liveRoads(g);
    // your land
    for (const o of this.h.owned()) { g.beginPath(); for (let k = 0; k < o.length; k += 2) { const s = this.toScreen(o[k], o[k + 1]); if (k) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); } g.closePath(); g.fillStyle = 'rgba(139,92,246,.45)'; g.fill(); g.strokeStyle = '#a78bfa'; g.lineWidth = 2; g.stroke(); }
    // the GPS route
    const r = this.h.route();
    if (r && r.length >= 4) {
      g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); for (let k = 0; k < r.length; k += 2) { const s = this.toScreen(r[k], r[k + 1]); if (k) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); }
      g.strokeStyle = 'rgba(10,8,20,.75)'; g.lineWidth = 9; g.stroke(); g.strokeStyle = this.h.waypoint() ? '#b45cff' : '#ffc53d'; g.lineWidth = 5; g.stroke();
    }
    // area names
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [n, x, z, k] of this.labels) {
      if ((k === 3 && this.mpp > 5) || (k === 2 && this.mpp > 16) || (k >= 4 && this.mpp > 3)) continue;
      const s = this.toScreen(x, z); if (s.x < -80 || s.y < -20 || s.x > W + 80 || s.y > H + 20) continue;
      const big = k <= 1; g.font = `${big ? 800 : 700} ${big ? 15 : k === 2 ? 12.5 : 11}px Inter, system-ui, sans-serif`;
      const t = big ? n.toUpperCase() : n; g.lineWidth = 3.5; g.strokeStyle = 'rgba(10,13,18,.85)'; g.strokeText(t, s.x, s.y); g.fillStyle = big ? '#f1f4f8' : '#c4ccd7'; g.fillText(t, s.x, s.y);
    }
    // icons
    const r0 = this.mpp > 14 ? 8 : this.mpp > 4 ? 9.5 : 11;
    for (const m of this.visibleMarkers()) { const s = this.toScreen(m.x, m.z); const sel = this.sel && this.sel.cat !== 'wp' && this.sel.x === m.x && this.sel.z === m.z; drawIcon(g, m.cat, s.x, s.y, sel ? r0 * 1.35 : r0, sel ? { ring: '#fff' } : {}); }
    // objective and waypoint
    const goal = this.h.goal(); if (goal) { const s = this.toScreen(goal.x, goal.z); drawPin(g, s.x, s.y, 1.1, '#ffc53d'); }
    const wp = this.h.waypoint(); if (wp) { const s = this.toScreen(wp.x, wp.z); drawPin(g, s.x, s.y, 1.25, '#b45cff'); }
    // you
    const me = this.h.me(); const p = this.toScreen(me.x, me.z);
    g.save(); g.translate(p.x, p.y); g.rotate(me.heading); g.beginPath(); g.arc(0, 0, 18, 0, Math.PI * 2); g.fillStyle = 'rgba(45,224,200,.18)'; g.fill();
    g.beginPath(); g.moveTo(0, -12); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fillStyle = '#fff'; g.strokeStyle = '#0b0d14'; g.lineWidth = 2.5; g.fill(); g.stroke(); g.restore();
    // scale bar
    const m100 = this.mpp > 10 ? 2000 : this.mpp > 3 ? 500 : 100; const px = m100 / this.mpp;
    g.fillStyle = 'rgba(16,20,27,.8)'; g.fillRect(W / 2 - px / 2 - 10, H - 30 - (matchMedia('(max-width:760px),(max-height:520px)').matches ? 0 : 0), px + 20, 22);
    g.strokeStyle = '#c4ccd7'; g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2 - px / 2, H - 14); g.lineTo(W / 2 + px / 2, H - 14); g.stroke();
    g.fillStyle = '#c4ccd7'; g.font = '600 10.5px Inter, sans-serif'; g.fillText(m100 >= 1000 ? `${m100 / 1000} km` : `${m100} m`, W / 2, H - 22);
  }
  private liveRoads(g: CanvasRenderingContext2D) {
    const a = this.toWorld(0, 0), b = this.toWorld(innerWidth, innerHeight);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const reg of this.h.store.regions.values()) {
      if (reg.ox > b.x || reg.ox + 2000 < a.x || reg.oz > b.z || reg.oz + 2000 < a.z) continue;
      for (const bd of reg.buildings) { if (bd.dead || bd.cx < a.x - 50 || bd.cx > b.x + 50 || bd.cz < a.z - 50 || bd.cz > b.z + 50) continue; const p = bd.pts; g.beginPath(); for (let k = 0; k < p.length; k += 2) { const s = this.toScreen(p[k], p[k + 1]); if (k) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); } g.closePath(); g.fillStyle = '#273040'; g.fill(); }
    }
  }
}
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
