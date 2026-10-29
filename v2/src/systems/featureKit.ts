// Shared plumbing for the ownership features (garage, identity, housing): styles, small DOM helper, modal overlay,
// the "press G / tap" interaction points, money, content loading and a tiny event bus.
import type { GameCtx } from './registry';
import type { ShopItem } from '../content/schema';
import { loadContent } from '../content/load';

export const fmt = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');

// ------------------------------------------------------------------------------------------------ DOM
type Kid = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v); else if (k === 'style') e.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) e.append(c as any);
  return e;
}

const CSS = `
.fk{--glass:rgba(12,14,22,.82);--glass2:rgba(22,25,38,.92);--line:rgba(255,255,255,.1);--txt:#f3f5f8;--mut:#9ba3b4;--teal:#2de0c8;--pur:#8b5cf6;--pur2:#6d3ef0;--grn:#49e08a;--red:#ff4d5e;--gold:#ffc53d;--blue:#4aa8ff;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--txt);-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}
.fk *{box-sizing:border-box}
.fk-ov{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(6,8,14,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);touch-action:manipulation}
.fk-ov.clear{background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;pointer-events:none}
.fk-ov.clear>*{pointer-events:auto}
.fk-card{background:var(--glass2);border:1px solid var(--line);border-radius:22px;box-shadow:0 24px 70px rgba(0,0,0,.55);display:flex;flex-direction:column;max-height:calc(100vh - 28px);max-width:calc(100vw - 20px);overflow:hidden}
.fk-hd{display:flex;align-items:center;gap:12px;padding:14px 16px 12px;border-bottom:1px solid var(--line)}
.fk-hd .ico{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:linear-gradient(160deg,var(--pur),var(--pur2))}
.fk-hd .ico svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.fk-hd h2{margin:0;font-size:18px;font-weight:800;letter-spacing:.2px;line-height:1.1} .fk-hd small{display:block;color:var(--mut);font-size:12px;font-weight:500;margin-top:2px}
.fk-hd .sp{flex:1}
.fk-x{width:36px;height:36px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.fk-body{padding:14px 16px;overflow:auto;-webkit-overflow-scrolling:touch;flex:1;min-height:0}
.fk-ft{padding:12px 16px;border-top:1px solid var(--line);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.fk-btn{font-family:inherit;font-weight:800;font-size:13.5px;border:none;border-radius:13px;padding:11px 16px;color:#fff;cursor:pointer;background:linear-gradient(180deg,var(--pur),var(--pur2));box-shadow:0 6px 16px rgba(109,62,240,.35),inset 0 1px 0 rgba(255,255,255,.25);min-height:42px;touch-action:manipulation}
.fk-btn.ghost{background:rgba(255,255,255,.08);box-shadow:none;border:1px solid var(--line)}
.fk-btn.green{background:linear-gradient(180deg,#34d27a,#1f9f58);box-shadow:0 6px 16px rgba(31,159,88,.35),inset 0 1px 0 rgba(255,255,255,.25)}
.fk-btn.red{background:linear-gradient(180deg,#ff5d6c,#d02a3c);box-shadow:0 6px 16px rgba(208,42,60,.35),inset 0 1px 0 rgba(255,255,255,.2)}
.fk-btn.sm{padding:7px 11px;font-size:12px;min-height:34px;border-radius:10px}
.fk-btn[disabled]{opacity:.4;cursor:not-allowed;filter:grayscale(.5)}
.fk-btn:active:not([disabled]){transform:translateY(1px) scale(.99)}
.fk-row{display:flex;gap:10px;align-items:center}
.fk-grid{display:grid;gap:10px}
.fk-tile{background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:16px;padding:12px;cursor:pointer;text-align:left;color:inherit;font-family:inherit;display:flex;flex-direction:column;gap:5px;touch-action:manipulation;min-width:0}
.fk-tile.on{border-color:var(--teal);box-shadow:0 0 0 1px var(--teal) inset,0 0 18px rgba(45,224,200,.18);background:rgba(45,224,200,.08)}
.fk-tile b{font-size:14px;font-weight:700} .fk-tile span{font-size:12px;color:var(--mut);line-height:1.35} .fk-tile .pr{font-family:Rajdhani,Inter,sans-serif;font-weight:700;font-size:17px;color:var(--gold)}
.fk-sec{font-size:11px;font-weight:800;letter-spacing:1.4px;color:var(--teal);text-transform:uppercase;margin:14px 0 8px}
.fk-sec:first-child{margin-top:0}
.fk-chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid var(--line)}
.fk-chip.g{color:#9ff0c2;border-color:rgba(73,224,138,.35)} .fk-chip.r{color:#ffb0b8;border-color:rgba(255,77,94,.35)} .fk-chip.y{color:#ffe08a;border-color:rgba(255,197,61,.4)} .fk-chip.p{color:#d4c2ff;border-color:rgba(139,92,246,.45)}
.fk-sw{width:36px;height:36px;border-radius:11px;border:2px solid rgba(255,255,255,.14);cursor:pointer;flex:0 0 auto;touch-action:manipulation;padding:0}
.fk-sw.on{border-color:#fff;box-shadow:0 0 0 2px var(--teal)}
.fk-field{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--mut);font-weight:600}
.fk-in{font-family:inherit;font-size:15px;font-weight:600;color:#fff;background:rgba(0,0,0,.35);border:1px solid var(--line);border-radius:11px;padding:10px 12px;outline:none;min-height:42px;width:100%;user-select:text;-webkit-user-select:text}
.fk-in:focus{border-color:var(--teal)}
.fk-bar{height:10px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden} .fk-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--teal),var(--pur));transition:width .2s}
.fk-range{display:flex;align-items:center;gap:10px;font-size:12px;font-weight:700;color:var(--mut)}
.fk-range input{flex:1;accent-color:var(--teal);min-width:0;height:28px}
.fk-range output{min-width:38px;text-align:right;color:#fff;font-variant-numeric:tabular-nums}
.fk-tabs{display:flex;gap:6px;flex-wrap:wrap}
.fk-tab{font-family:inherit;font-weight:700;font-size:12.5px;padding:8px 13px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--mut);cursor:pointer;touch-action:manipulation;min-height:36px}
.fk-tab.on{background:var(--teal);color:#06231f;border-color:var(--teal)}
.fk-use{position:fixed;left:50%;bottom:max(96px,18vh);transform:translateX(-50%);z-index:12;display:none;align-items:center;gap:10px;font-family:Inter,sans-serif;font-weight:700;font-size:15px;padding:11px 18px 11px 12px;border-radius:999px;color:#fff;background:rgba(12,14,22,.78);border:1px solid rgba(45,224,200,.5);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 8px 24px rgba(0,0,0,.4),0 0 22px rgba(45,224,200,.18);cursor:pointer;touch-action:manipulation;user-select:none}
.fk-use kbd{font-family:Rajdhani,sans-serif;font-weight:700;font-size:15px;background:#fff;color:#0b0d14;border-radius:8px;padding:2px 9px}
.fk-use.on{display:flex}
.fk-toastbar{position:fixed;left:50%;top:max(18px,env(safe-area-inset-top));transform:translateX(-50%);z-index:60;background:var(--glass2);border:1px solid var(--line);border-radius:14px;padding:10px 16px;font-size:13.5px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.4);pointer-events:none;opacity:0;transition:opacity .25s}
.fk-toastbar.on{opacity:1}
.fk-tag b{display:block;font-family:Oswald,Rajdhani,sans-serif;font-weight:600;font-size:15px;letter-spacing:.1em;padding:3px 10px 1px;border-radius:7px;background:rgba(8,10,16,.62);border:1px solid rgba(255,255,255,.18);color:#fff;text-shadow:0 1px 3px #000}
.fk-tag i{display:block;font-style:normal;font-size:11px;font-weight:700;color:#2de0c8;letter-spacing:.06em;text-shadow:0 1px 3px #000;margin-top:2px}
@media (max-width:760px){.fk-card{border-radius:18px}.fk-hd{padding:11px 12px 9px}.fk-body{padding:11px 12px}.fk-use{bottom:max(120px,26vh)}}
`;
let cssDone = false;
export function injectCss() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

const ICON: Record<string, string> = {
  brush: 'M18 3l3 3-9.5 9.5-3-3zM8.5 12.5C6 12.5 5 14 5 16c0 1.3-.7 2.5-2 3 3 .6 7 .3 7-3.5',
  id: 'M3 6h18v12H3zM7 11a2 2 0 1 0 0-.01M5 16c.6-1.5 1.8-2 3-2s2.4.5 3 2M14 10h5M14 14h4',
  car: 'M5 16h14M5 16v3h3v-3m8 0v3h3v-3M3 16v-4l2-5h14l2 5v4M7 12h.01M17 12h.01',
  house: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z',
  pin: 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-.01',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  plate: 'M3 8h18v8H3zM6 12h.01M9 12h6M18 12h.01',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
};
export function icon(name: keyof typeof ICON | string, size = 20) { return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[name] ?? name}"/></svg>`; }
export { ICON };

// ------------------------------------------------------------------------------------------------ overlays
let overlays = 0;
export const modalOpen = () => overlays > 0;
export interface OverlayOpts { title?: string; sub?: string; icon?: string; width?: number | string; full?: boolean; clear?: boolean; onClose?: () => void; closable?: boolean }
export class Overlay {
  root: HTMLElement; card: HTMLElement; body: HTMLElement; foot: HTMLElement; head: HTMLElement; private open_ = false;
  private key = (e: KeyboardEvent) => { if (e.code === 'Escape' && this.opts.closable !== false) { e.stopPropagation(); this.close(); } };
  constructor(public ctx: GameCtx, public opts: OverlayOpts = {}) {
    injectCss();
    this.body = h('div', { class: 'fk-body' }); this.foot = h('div', { class: 'fk-ft', style: 'display:none' });
    this.head = h('div', { class: 'fk-hd' },
      opts.icon ? h('div', { class: 'ico', html: icon(opts.icon) }) : null,
      h('div', {}, h('h2', { text: opts.title ?? '' }), opts.sub ? h('small', { text: opts.sub }) : null), h('div', { class: 'sp' }),
      opts.closable === false ? null : h('button', { class: 'fk-x', 'aria-label': 'Close', text: '✕', onclick: () => this.close() }));
    this.card = h('div', { class: 'fk-card', style: { width: typeof opts.width === 'number' ? opts.width + 'px' : opts.width ?? '620px' } }, this.head, this.body, this.foot);
    this.root = h('div', { class: 'fk fk-ov' + (opts.clear ? ' clear' : '') }, this.card);
    // the game's touch controls listen on the body: keep gestures inside the overlay (scrolling lists, sliders) to ourselves
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) this.root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  get isOpen() { return this.open_; }
  open() { if (this.open_) return this; this.open_ = true; overlays++; this.ctx.setModal(true, !!this.opts.full); document.body.appendChild(this.root); window.addEventListener('keydown', this.key, true); return this; }
  close() { if (!this.open_) return; this.open_ = false; overlays--; this.ctx.setModal(false, !!this.opts.full); this.root.remove(); window.removeEventListener('keydown', this.key, true); this.opts.onClose?.(); }
  setTitle(t: string, sub?: string) { (this.head.querySelector('h2') as HTMLElement).textContent = t; const s = this.head.querySelector('small'); if (s && sub !== undefined) s.textContent = sub; }
}

let barEl: HTMLElement | null = null, barT = 0;
/** One-line message in the middle top of the screen (works above overlays and the editor). */
export function say(text: string, secs = 2.6) {
  injectCss(); if (!barEl) { barEl = h('div', { class: 'fk fk-toastbar' }); document.body.appendChild(barEl); }
  barEl.textContent = text; barEl.classList.add('on'); clearTimeout(barT); barT = window.setTimeout(() => barEl!.classList.remove('on'), secs * 1000);
}
export function toast(ctx: GameCtx, title: string, body: string, tone: 'ok' | 'warn' | 'bad' | 'info' = 'info', secs = 5) {
  const col = tone === 'ok' ? '#22c55e' : tone === 'bad' ? 'var(--red)' : tone === 'warn' ? 'linear-gradient(160deg,#f6c453,#d98a12)' : 'linear-gradient(160deg,#59a8ff,#1f62d6)';
  ctx.hud.toast(title, body, col, tone === 'bad' ? 'siren' as any : tone === 'ok' ? 'cash' as any : 'msg', secs);
}

// ------------------------------------------------------------------------------------------------ money and content
/** Pays from cash in hand. Returns false (and says so) when you cannot cover it. */
export function spend(ctx: GameCtx, n: number, what = ''): boolean {
  n = Math.round(n);
  if (ctx.sim.cash < n) { say(`You need ${fmt(n)}${what ? ' for ' + what : ''}. Cash in hand: ${fmt(ctx.sim.cash)}.`, 3.2); return false; }
  ctx.sim.cash -= n; if (n > 0) ctx.hud.money(-n); ctx.persist(); return true;
}
export function earn(ctx: GameCtx, n: number) { ctx.sim.cash += Math.round(n); if (n > 0) ctx.hud.money(n); ctx.persist(); }

let shopsP: Promise<ShopItem[]> | null = null; let shopsV: ShopItem[] = [];
export function loadShops() { return (shopsP ??= loadContent<ShopItem>('shops').then((r) => (shopsV = r))); }
export function shopItems<K extends ShopItem['kind']>(kind: K): Extract<ShopItem, { kind: K }>[] { return shopsV.filter((s) => s.kind === kind) as any; }
export function shopItem<K extends ShopItem['kind']>(kind: K, id: string): Extract<ShopItem, { kind: K }> | undefined { return shopsV.find((s) => s.kind === kind && s.id === id) as any; }
export const fee = (id: string, fallback = 0) => shopItem('fee', id)?.price ?? fallback;

/** Persistent per-system state inside the save, with defaults filled in. */
export function stateOf<T extends object>(ctx: GameCtx, key: string, def: T): T {
  const cur = (ctx.save[key] ??= {}); for (const [k, v] of Object.entries(def)) if (cur[k] === undefined) cur[k] = JSON.parse(JSON.stringify(v));
  return cur as T;
}

// ------------------------------------------------------------------------------------------------ events between the feature systems
type Fn = (...a: any[]) => void;
const listeners = new Map<string, Set<Fn>>();
export const bus = {
  on(ev: string, f: Fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev)!.add(f); return () => listeners.get(ev)!.delete(f); },
  emit(ev: string, ...a: any[]) { for (const f of listeners.get(ev) ?? []) { try { f(...a); } catch (e) { console.error('[hl] bus', ev, e); } } },
};

// ------------------------------------------------------------------------------------------------ interaction points
export interface UsePoint {
  id: string; x: number; z: number; r: number; label: string;
  /** 'in' needs you in a car (slow), 'out' on foot, 'any' either */
  who: 'in' | 'out' | 'any'; use: (ctx: GameCtx) => void; ok?: (ctx: GameCtx) => boolean; icon?: string;
}
export class Uses {
  points = new Map<string, UsePoint>(); providers: ((ctx: GameCtx, me: { x: number; z: number; inCar: boolean; speed: number }) => UsePoint | null)[] = [];
  private btn: HTMLElement | null = null; private cur: UsePoint | null = null; private stamp = -1; private ctxRef: GameCtx | null = null;
  add(p: UsePoint) { this.points.set(p.id, p); } remove(id: string) { this.points.delete(id); }
  private ensure(ctx: GameCtx) {
    if (this.btn) return; injectCss(); this.ctxRef = ctx;
    this.btn = h('button', { class: 'fk fk-use', 'aria-label': 'Use' }, h('kbd', { text: 'G' }), h('span', { text: '' }));
    const go = (e: Event) => { e.preventDefault(); e.stopPropagation(); this.trigger(); };
    this.btn.addEventListener('pointerdown', go);
    for (const ev of ['touchstart', 'touchend']) this.btn.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    document.body.appendChild(this.btn);
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyG' && !e.repeat && !(e.target as HTMLElement)?.matches?.('input,textarea')) this.trigger(); });
  }
  trigger() { const c = this.cur, ctx = this.ctxRef; if (!c || !ctx || modalOpen() || ctx.hud.landmapOn || ctx.hud.phoneUp) return; c.use(ctx); }
  /** call from any system's frame(); runs once per rendered frame */
  tick(ctx: GameCtx) {
    const st = ctx.view.time; if (st === this.stamp) return; this.stamp = st; this.ensure(ctx);
    const sim = ctx.sim, me = sim.local;
    const v = me.vehicle !== null ? sim.vehicles[me.vehicle] : null; const p = v ? v.body.translation() : me.pos;
    const here = { x: p.x, z: p.z, inCar: !!v, speed: v ? Math.abs(v.ctrl.currentVehicleSpeed()) : 0 };
    let best = null as UsePoint | null, bd = 1e9;
    const consider = (pt: UsePoint | null) => {
      if (!pt) return; if (pt.who === 'in' && (!here.inCar || here.speed > 4)) return; if (pt.who === 'out' && here.inCar) return;
      if (pt.ok && !pt.ok(ctx)) return; const d = Math.hypot(pt.x - here.x, pt.z - here.z); if (d < pt.r && d < bd) { bd = d; best = pt; }
    };
    for (const pt of this.points.values()) consider(pt); for (const f of this.providers) consider(f(ctx, here));
    const off = modalOpen() || ctx.hud.landmapOn || ctx.hud.phoneUp || !me.alive;
    this.cur = off ? null : (best as UsePoint | null);
    const b = this.btn!; if (this.cur) { (b.lastChild as HTMLElement).textContent = this.cur.label; if (!b.classList.contains('on')) b.classList.add('on'); } else b.classList.remove('on');
  }
  get active() { return this.cur; }
}
export const uses = new Uses();

// ------------------------------------------------------------------------------------------------ small helpers
export function hash32(s: string) { let hh = 2166136261; for (let i = 0; i < s.length; i++) { hh ^= s.charCodeAt(i); hh = Math.imul(hh, 16777619); } return hh >>> 0; }
export function rng32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function playerXZ(ctx: GameCtx) { const me = ctx.sim.local; if (me.vehicle !== null) { const t = ctx.sim.vehicles[me.vehicle].body.translation(); return { x: t.x, z: t.z }; } return { x: me.pos.x, z: me.pos.z }; }

export function range(label: string, min: number, max: number, step: number, value: number, on: (v: number) => void, fmtv: (v: number) => string = (v) => String(v)) {
  const out = h('output', { text: fmtv(value) });
  const inp = h('input', { type: 'range', min, max, step, value }); inp.addEventListener('input', () => { const v = +inp.value; out.textContent = fmtv(v); on(v); });
  return Object.assign(h('label', { class: 'fk-range' }, h('span', { text: label, style: 'min-width:64px' }), inp, out), { set(v: number) { inp.value = String(v); out.textContent = fmtv(v); } });
}

/** extra stylesheet for one system, added once */
const cssAdded = new Set<string>();
export function addCss(id: string, css: string) { if (cssAdded.has(id)) return; cssAdded.add(id); injectCss(); const s = document.createElement('style'); s.dataset.fk = id; s.textContent = css; document.head.appendChild(s); }
