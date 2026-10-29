// The garage system: paint bays at the mechanic villages, plates, trackers, papers, the car mart, the Garage phone app,
// and the glue that puts paint and plates on the cars in the street.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from './registry';
import type { Vehicle } from '../sim/types';
import type { PaintSpec, OwnedCar } from './garageFleet';
import { fleet, kindName, vehiclePlate, OWNABLE } from './garageFleet';
import { plateCodes, lgaCode, stdPlate, checkVanity, plateRegistry, plateCanvas, attachPlates, normalisePlate } from './garagePlates';
import { applyPaint, finishList } from './garagePaint';
import { initSites, tickSites, siteHooks, siteBlips, sites, type ResolvedSite } from './featureSites';
import { Overlay, h, fmt, spend, say, toast, fee, loadShops, shopItems, shopItem, uses, addCss, stateOf, bus, clamp, playerXZ } from './featureKit';
import { registerApp } from '../ui/lifeHud';

// ------------------------------------------------------------------------------------------------ painters
export interface PaintJob { siteId: string; carId: string; spec: PaintSpec; price: number; secs: number }
/** Anyone who can do a paint job at a bay. The built-in one is the NPC mechanic. A player-painter service (multiplayer) calls
 *  registerPainter with kind 'player'; work() resolves when the human has finished and handed the car back. */
export interface Painter {
  id: string; name: string; kind: 'npc' | 'player'; title: string; blurb: string; priceMult: number; secsMult: number;
  available?(site: ResolvedSite): boolean;
  work(job: PaintJob, progress: (p: number, msg?: string) => void): Promise<{ ok: boolean; note?: string; design?: string }>;
}
export const painters: Painter[] = [];
export function registerPainter(p: Painter) { const i = painters.findIndex((x) => x.id === p.id); if (i >= 0) painters[i] = p; else painters.push(p); }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
registerPainter({
  id: 'npc', name: 'Chinedu', kind: 'npc', title: 'Spray master', blurb: 'Twenty years on the compressor. He will not talk while he sprays.', priceMult: 1, secsMult: 1,
  async work(job, progress) {
    const real = clamp(job.secs * 0.22, 2.5, 14) * 1000; const t0 = performance.now(); const msgs = ['Masking the lights', 'Sanding the old coat', 'Primer going on', 'First coat', 'Second coat', 'Clear coat', 'Baking'];
    for (;;) { const k = clamp((performance.now() - t0) / real, 0, 1); progress(k, msgs[Math.min(msgs.length - 1, Math.floor(k * msgs.length))]); if (k >= 1) break; await wait(80); }
    return { ok: true };
  },
});
/** The 3D paint editor registers itself here (garageEditor.ts) */
export const editorHook: { open: null | ((ctx: GameCtx, v: Vehicle, car: OwnedCar, done: () => void) => void) } = { open: null };
/** The baked design texture for a car (garageDesign.ts) */
export const designHook: { bake: null | ((car: OwnedCar, model: any) => { tex: THREE.Texture | null; geo: ((m: THREE.Mesh) => THREE.BufferGeometry | null) | null }) } = { bake: null };

// ------------------------------------------------------------------------------------------------ camera orbit
const orbit = { on: false, v: null as Vehicle | null, a: 0.7, p: 0.22, d: 7.5, auto: true, drag: false, lx: 0, ly: 0, hold: 0, offX: 0 };
function orbitStart(v: Vehicle) {
  orbit.on = true; orbit.v = v; orbit.a = 0.8; orbit.p = 0.2; orbit.d = v.kind === 'danfo' ? 9.5 : v.kind === 'jeep' || v.kind === 'suv' ? 8 : 7; orbit.auto = true; orbit.hold = 0;
}
function orbitStop(ctx: GameCtx) { orbit.on = false; orbit.v = null; ctx.view.debugCam = null; }
function orbitFrame(ctx: GameCtx, dt: number) {
  if (!orbit.on || !orbit.v) return; const v = orbit.v; const t = v.body.translation(); if ((v as any).gone) return;
  if (orbit.auto && !orbit.drag) orbit.a += dt * 0.25;
  const rs = (ctx.view.camera as THREE.PerspectiveCamera); const aspect = rs.aspect || 1;
  const side = window.innerWidth > 760 ? orbit.d * 0.2 * Math.min(1.2, aspect / 1.6) : 0; // car sits left of the side panel
  const cp = Math.cos(orbit.p), sp = Math.sin(orbit.p);
  const cx = t.x + Math.sin(orbit.a) * cp * orbit.d, cz = t.z + Math.cos(orbit.a) * cp * orbit.d, cy = t.y + 0.9 + sp * orbit.d;
  // shift the target sideways in camera space so the car lands left of the panel on wide screens
  const rx = Math.cos(orbit.a), rz = -Math.sin(orbit.a);
  ctx.view.debugCam = { x: cx + rx * side, y: cy, z: cz + rz * side, tx: t.x + rx * side, ty: t.y + 0.55, tz: t.z + rz * side, fov: 42 };
}
let dragBound = false;
function bindDrag() {
  if (dragBound) return; dragBound = true;
  const down = (e: PointerEvent) => { if (!orbit.on || (e.target as HTMLElement).closest?.('.fk-card,.fk-use,button,input,select')) return; orbit.drag = true; orbit.lx = e.clientX; orbit.ly = e.clientY; orbit.auto = false; };
  const move = (e: PointerEvent) => { if (!orbit.drag) return; orbit.a -= (e.clientX - orbit.lx) * 0.008; orbit.p = clamp(orbit.p + (e.clientY - orbit.ly) * 0.006, -0.05, 1.1); orbit.lx = e.clientX; orbit.ly = e.clientY; };
  const up = () => { if (orbit.drag) { orbit.drag = false; setTimeout(() => { if (!orbit.drag) orbit.auto = true; }, 3500); } };
  window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
  window.addEventListener('wheel', (e) => { if (orbit.on && !(e.target as HTMLElement).closest?.('.fk-card')) orbit.d = clamp(orbit.d + e.deltaY * 0.006, 3.5, 16); }, { passive: true });
}

// ------------------------------------------------------------------------------------------------ the bay
const SIZE_K: Record<string, number> = { hatch: 0.9, sedan: 1, jeep: 1.5, suv: 1.6, danfo: 1.8 };
const paintCost = (kind: string, finish: string) => Math.round((16000 * (SIZE_K[kind] ?? 1) * (shopItem('finish', finish)?.mult ?? 1)) / 500) * 500;
const paintSecs = (kind: string, finish: string) => Math.round((shopItem('finish', finish)?.secs ?? 20) * (SIZE_K[kind] ?? 1));

function nearbyCars(ctx: GameCtx, s: ResolvedSite): Vehicle[] {
  const sim = ctx.sim; const me = sim.local; const out: Vehicle[] = [];
  if (me.vehicle !== null) { const v = sim.vehicles[me.vehicle]; if (v && OWNABLE.includes(v.kind)) out.push(v); }
  for (const c of fleet.cars) { const v = fleet.vehicleOf(c); if (v && !out.includes(v) && Math.hypot(v.body.translation().x - s.x, v.body.translation().z - s.z) < 32) out.push(v); }
  return out;
}

let bayOpen: Overlay | null = null;
export function openBay(ctx: GameCtx, s: ResolvedSite, startTab = 'paint') {
  if (bayOpen?.isOpen) return;
  bindDrag();
  const ov = new Overlay(ctx, { title: s.def.name, sub: 'Paint · plates · trackers · papers', icon: 'brush', clear: true, width: 430, onClose: () => { restorePreview(); orbitStop(ctx); bayOpen = null; } });
  ov.card.classList.add('fk-side'); bayOpen = ov;
  let tab = startTab; let cars = nearbyCars(ctx, s); let vi = 0; let busy = false;
  let preview: PaintSpec | null = null;
  const cur = () => cars[vi] ?? null; const curCar = () => { const v = cur(); return v ? fleet.carOf(v) : null; };
  const restorePreview = () => { const v = cur(); if (v && preview) { const c = fleet.carOf(v); (v as any).paintSpec = c ? c.paint : (v as any)._paintSpec0; preview = null; } };
  const setPreview = (spec: Partial<PaintSpec>) => {
    const v = cur(); if (!v) return; const c = fleet.carOf(v);
    if (!preview) { (v as any)._paintSpec0 = (v as any).paintSpec; preview = { finish: c?.paint.finish ?? 'gloss', color: c?.paint.color ?? '#b8b9bb', rev: 0, doc: c?.paint.doc }; }
    preview = { ...preview, ...spec, rev: 100000 + Math.floor(performance.now()) }; (v as any).paintSpec = preview;
  };
  if (cars[0]) orbitStart(cars[0]);
  const draw = () => {
    ov.body.innerHTML = ''; ov.foot.style.display = 'none'; const site = s.def;
    const painter = pickedPainter(s);
    // the mechanic
    ov.body.append(h('div', { class: 'gx-npc' }, h('div', { class: 'gx-av', text: painter.name[0] }), h('div', {}, h('b', { text: `${painter.name} · ${painter.title}` }), h('span', { text: greeting(site.id, tab) }))));
    // which car
    if (cars.length > 1) ov.body.append(h('div', { class: 'fk-tabs', style: 'margin:8px 0' }, ...cars.map((v, i) => { const c = fleet.carOf(v); return h('button', { class: 'fk-tab' + (i === vi ? ' on' : ''), text: c ? `${c.name} ${c.plate}` : kindName(v.kind), onclick: () => { restorePreview(); vi = i; orbitStart(cars[i]); draw(); } }); })));
    const tabs: [string, string][] = [['paint', 'Paint'], ['studio', 'Studio'], ['plates', 'Plates'], ['tracker', 'Tracker'], ['papers', 'Papers']]; if (site.carMart) tabs.push(['mart', 'Car mart']);
    ov.body.append(h('div', { class: 'fk-tabs', style: 'margin:10px 0 12px' }, ...tabs.map(([id, t]) => h('button', { class: 'fk-tab' + (tab === id ? ' on' : ''), text: t, onclick: () => { restorePreview(); tab = id; draw(); } }))));
    const body = h('div', {}); ov.body.append(body);
    if (tab === 'mart') return martTab(ctx, s, body, ov, () => { cars = nearbyCars(ctx, s); draw(); });
    const v = cur();
    if (!v) { body.append(h('p', { class: 'gx-note', text: 'Drive your car into the bay first, or walk up with it parked close by. Only cars you drive or own can be worked on.' })); if (site.carMart) body.append(h('button', { class: 'fk-btn', text: 'See the car mart', onclick: () => { tab = 'mart'; draw(); } })); return; }
    if (tab === 'paint') paintTab(ctx, s, v, body, painter, setPreview, () => preview, () => { preview = null; }, () => { cars = nearbyCars(ctx, s); draw(); }, (b) => (busy = b), () => busy);
    else if (tab === 'studio') studioTab(ctx, s, v, body, ov, restorePreview);
    else if (tab === 'plates') platesTab(ctx, s, v, body, draw);
    else if (tab === 'tracker') trackerTab(ctx, s, v, body, draw);
    else if (tab === 'papers') papersTab(ctx, v, body, draw);
  };
  ov.open(); draw();
  return ov;
}
function greeting(site: string, tab: string) {
  const g: Record<string, string> = {
    paint: 'Oga, welcome. Which colour you wan wear? I go make am shine like new naira.',
    studio: 'You wan do your own design? Take the bay, no shaking. I go watch.',
    plates: 'Number plate? E get letters wey go make police stop and greet you. Choose well.',
    tracker: 'Thief dey Lagos like mosquito. Put tracker, sleep well.',
    papers: 'Papers? Those ones wey dey look correct? I know a man. We no talk about am.',
    mart: 'See these ones. No lie, fresh from Cotonou. Receipt dey.',
  };
  void site; return g[tab] ?? g.paint;
}
function pickedPainter(s: ResolvedSite): Painter { const a = painters.filter((p) => !p.available || p.available(s)); return a.find((p) => p.id === ((s as any)._painter ?? 'npc')) ?? a[0] ?? painters[0]; }

function claim(ctx: GameCtx, v: Vehicle): OwnedCar | null { void ctx; return fleet.carOf(v) ?? fleet.ensureOwned(v, 'claimed'); }

// ---- paint tab
function paintTab(ctx: GameCtx, s: ResolvedSite, v: Vehicle, body: HTMLElement, painter: Painter, setPreview: (p: Partial<PaintSpec>) => void, getPrev: () => PaintSpec | null, clearPrev: () => void, refresh: () => void, setBusy: (b: boolean) => void, isBusy: () => boolean) {
  const car = fleet.carOf(v); const base: PaintSpec = getPrev() ?? car?.paint ?? { finish: 'gloss', color: '', rev: 0 };
  let colour = base.color || '#b8b9bb'; let fin = base.finish || 'gloss';
  const total = () => Math.round(paintCost(v.kind, fin) * painter.priceMult / 500) * 500; const secs = () => Math.round(paintSecs(v.kind, fin) * painter.secsMult);
  const price = h('b', { class: 'gx-price' }); const info = h('span', { class: 'gx-note' });
  const upd = () => { price.textContent = fmt(total()); info.textContent = `${shopItem('finish', fin)?.name ?? fin} · about ${secs()} s in the bay`; };
  const sw = h('div', { class: 'gx-sws' });
  const mark = () => sw.querySelectorAll('.fk-sw').forEach((e) => e.classList.toggle('on', (e as HTMLElement).dataset.hex === colour.toLowerCase()));
  for (const c of shopItems('colour')) sw.append(h('button', { class: 'fk-sw', title: c.name, 'data-hex': c.hex.toLowerCase(), style: `background:${c.hex}`, onclick: () => { colour = c.hex; setPreview({ color: colour, finish: fin }); hexIn.value = colour; mark(); upd(); } }));
  const hexIn = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(colour) ? colour : '#b8b9bb', class: 'gx-color', 'aria-label': 'Custom colour' });
  hexIn.addEventListener('input', () => { colour = hexIn.value; setPreview({ color: colour, finish: fin }); mark(); upd(); });
  const fins = h('div', { class: 'fk-grid', style: 'grid-template-columns:repeat(2,1fr)' });
  const fmark = () => fins.querySelectorAll('.fk-tile').forEach((e) => e.classList.toggle('on', (e as HTMLElement).dataset.id === fin));
  for (const f of finishList()) fins.append(h('button', { class: 'fk-tile', 'data-id': f.id, onclick: () => { fin = f.id; setPreview({ color: colour, finish: fin }); fmark(); upd(); } }, h('b', { text: f.name }), h('span', { text: f.desc }), h('i', { class: 'pr', style: 'font-style:normal', text: `x${f.mult}` })));
  const go = h('button', { class: 'fk-btn green', style: 'width:100%;margin-top:12px', text: 'Spray it', onclick: async () => {
    if (isBusy()) return; const p = total(); if (!spend(ctx, p, 'the paint job')) return; setBusy(true);
    const c = claim(ctx, v); if (!c) { setBusy(false); return; }
    const spec: PaintSpec = { finish: fin, color: colour, rev: 0, doc: c.paint.doc, name: c.paint.name };
    body.innerHTML = ''; const bar = h('div', { class: 'fk-bar' }, h('i', { style: 'width:0%' })); const msg = h('b', { text: 'Starting' });
    body.append(h('div', { class: 'gx-prog' }, h('div', { class: 'fk-sec', text: 'In the bay' }), msg, bar, h('span', { class: 'gx-note', text: `${painter.name} is on it. The car stays here until the clear coat sets.` })));
    clearPrev(); (v as any).paintSpec = c.paint;
    const r = await painter.work({ siteId: s.def.id, carId: c.id, spec, price: p, secs: secs() }, (k, m) => { (bar.firstChild as HTMLElement).style.width = Math.round(k * 100) + '%'; if (m) msg.textContent = m; });
    setBusy(false);
    if (r.ok) { fleet.setPaint(c, { ...spec, doc: r.design ?? spec.doc }); say(`${c.plate} is done. Looks sharp.`, 3); toast(ctx, 'Paint job done', `${shopItem('finish', fin)?.name ?? fin} ${shopItem('colour', '')?.name ?? ''}`.trim(), 'ok', 4); }
    else { ctx.sim.cash += p; ctx.hud.money(p); say(r.note ?? 'The painter turned the job down. Money back.', 3); }
    refresh();
  } });
  body.append(h('div', { class: 'fk-sec', text: 'Colour' }), sw, h('div', { class: 'fk-row', style: 'margin-top:8px' }, h('label', { class: 'gx-note', text: 'Any colour' }), hexIn),
    h('div', { class: 'fk-sec', text: 'Finish' }), fins, h('div', { class: 'gx-total' }, h('div', {}, h('span', { class: 'gx-note', text: 'Total' }), price), info), go);
  mark(); fmark(); upd(); void car;
}

// ---- studio tab (the 3D editor)
function studioTab(ctx: GameCtx, s: ResolvedSite, v: Vehicle, body: HTMLElement, ov: Overlay, restorePreview: () => void) {
  const car = fleet.carOf(v); const f = fee('studio', 6000);
  body.append(h('div', { class: 'fk-sec', text: 'Paint studio' }),
    h('p', { class: 'gx-note', text: 'Rent the bay and paint your own design on the car: brushes, layers, stickers, text, mirror painting, your own library of designs. The base colour and finish come from the Paint tab.' }),
    h('div', { class: 'fk-row', style: 'flex-wrap:wrap;margin:8px 0' }, h('span', { class: 'fk-chip y', text: 'Bay rent ' + fmt(f) }), h('span', { class: 'fk-chip', text: car?.paint.doc ? 'Has a design already' : 'Plain car' })));
  const open = h('button', { class: 'fk-btn', style: 'width:100%', text: editorHook.open ? 'Open the paint editor' : 'Editor not installed', disabled: !editorHook.open, onclick: () => {
    if (!spend(ctx, f, 'the studio')) return; const c = claim(ctx, v); if (!c) return; restorePreview();
    const keep = ov; keep.root.style.display = 'none';
    editorHook.open!(ctx, v, c, () => { keep.root.style.display = ''; });
  } });
  body.append(open);
}

// ---- plates tab
function platesTab(ctx: GameCtx, s: ResolvedSite, v: Vehicle, body: HTMLElement, redraw: () => void) {
  const car = fleet.carOf(v); const pl = vehiclePlate(v);
  const prevBox = h('div', { style: 'text-align:center;margin:4px 0 10px' });
  const show = (t: string, custom: boolean) => { prevBox.innerHTML = ''; const cv = plateCanvas(t, custom, 360); cv.style.cssText = 'max-width:100%;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.45)'; prevBox.append(cv); };
  show(pl.text, pl.custom);
  body.append(h('div', { class: 'fk-sec', text: 'Your plate' }), prevBox);
  // standard re-plate
  const codes = plateCodes(); const lgaSel = h('select', { class: 'fk-in', style: 'flex:1' }, ...shopItems('plate-code').map((c) => h('option', { value: c.code, text: `${c.code} · ${c.lga}` })));
  const hint = lgaCode(s.def.lga ?? '') ?? (car?.reg ? lgaCode(car.reg.lga) : null); if (hint) lgaSel.value = hint;
  let std = '';
  const roll = () => { std = stdPlate(Math.floor(Math.random() * 1e9), lgaSel.value || codes[0]); show(std, false); };
  body.append(h('div', { class: 'fk-sec', text: 'Standard Lagos plate' }), h('div', { class: 'fk-row' }, lgaSel, h('button', { class: 'fk-btn sm ghost', text: 'Another number', onclick: roll })),
    h('button', { class: 'fk-btn', style: 'width:100%;margin-top:8px', text: 'Fit this plate  ' + fmt(fee('replate', 8000)), onclick: () => { if (!std) roll(); if (!spend(ctx, fee('replate', 8000), 'the plate')) return; const c = claim(ctx, v); if (!c) return; fleet.setPlate(c, std, false); say('New plate fitted.'); redraw(); } }));
  // vanity
  const err = h('div', { class: 'gx-note', style: 'min-height:18px;margin-top:6px' }); const inp = h('input', { class: 'fk-in', placeholder: 'Your text, 2 to 8 characters', maxlength: 9, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' }) as HTMLInputElement;
  const buy = h('button', { class: 'fk-btn', style: 'width:100%;margin-top:8px', text: 'Vanity plate', disabled: true }) as HTMLButtonElement;
  let timer = 0; let okText = '';
  inp.addEventListener('input', () => {
    clearTimeout(timer); buy.disabled = true; okText = ''; const r = checkVanity(inp.value);
    if (!inp.value.trim()) { err.textContent = ''; show(pl.text, pl.custom); buy.textContent = 'Vanity plate'; return; }
    if (!r.ok) { err.textContent = r.why ?? ''; err.style.color = '#ffb0b8'; show(r.text || '-', true); buy.textContent = 'Vanity plate'; return; }
    show(r.text, true); err.style.color = '#9ba3b4'; err.textContent = 'Checking the registry';
    timer = window.setTimeout(async () => { const taken = await plateRegistry.isTaken(r.text); if (inp.value && normalisePlate(inp.value) !== r.text) return; if (taken) { err.textContent = 'Somebody already owns that one.'; err.style.color = '#ffb0b8'; buy.textContent = 'Taken'; return; } err.textContent = `${shopItem('plate-tier', r.tier ?? '')?.name ?? 'Vanity'} · available`; err.style.color = '#9ff0c2'; buy.textContent = `Buy ${r.text}  ${fmt(r.price!)}`; buy.disabled = false; okText = r.text; (buy as any)._p = r.price; }, 250);
  });
  buy.addEventListener('click', async () => {
    if (!okText) return; const p = (buy as any)._p as number; if (ctx.sim.cash < p) { say(`You need ${fmt(p)}. Cash in hand: ${fmt(ctx.sim.cash)}.`, 3); return; }
    const c = claim(ctx, v); if (!c) return; if (!(await plateRegistry.reserve(okText, ctx.profile?.accountId ?? 'local'))) { err.textContent = 'Somebody got it first.'; return; }
    if (!spend(ctx, p, 'the plate')) { plateRegistry.release(okText); return; }
    fleet.setPlate(c, okText, true); say(`${okText} is yours.`, 3); redraw();
  });
  body.append(h('div', { class: 'fk-sec', text: 'Vanity plate' }), inp, err, buy,
    h('div', { class: 'fk-row', style: 'flex-wrap:wrap;margin-top:8px' }, ...shopItems('plate-tier').map((t) => h('span', { class: 'fk-chip', text: `${t.name.split(' (')[0]} ${fmt(t.price)}` }))));
}

// ---- tracker tab
function trackerTab(ctx: GameCtx, s: ResolvedSite, v: Vehicle, body: HTMLElement, redraw: () => void) {
  const car = fleet.carOf(v); const tr = car?.tracker;
  body.append(h('div', { class: 'fk-sec', text: 'Trackers' }), h('p', { class: 'gx-note', text: 'A tracked car shows on the minimap and on LANDMAP, and when someone drives it away you get an alert. Better trackers update faster and bring the police sooner.' }));
  if (tr) body.append(h('div', { class: 'fk-row', style: 'margin:8px 0' }, h('span', { class: 'fk-chip g', text: 'Fitted: ' + (shopItem('tracker', tr.tier)?.name ?? tr.tier) })));
  for (const t of shopItems('tracker')) {
    const fitted = tr?.tier === t.id;
    body.append(h('div', { class: 'fk-tile', style: 'cursor:default;margin-bottom:8px' }, h('div', { class: 'fk-row' }, h('b', { text: t.name }), h('div', { style: 'flex:1' }), h('span', { class: 'pr', text: fmt(t.price) })), h('span', { text: t.desc }),
      h('div', { class: 'fk-row', style: 'margin-top:4px' }, h('span', { class: 'fk-chip', text: `Ping every ${t.ping} s` }), h('div', { style: 'flex:1' }), h('button', { class: 'fk-btn sm', text: fitted ? 'Fitted' : tr ? 'Swap in' : 'Install', disabled: fitted, onclick: () => { if (!spend(ctx, t.price, 'the tracker')) return; const c = claim(ctx, v); if (!c) return; fleet.setTracker(c, t.id); say('Tracker fitted behind the dash.'); redraw(); } }))));
  }
  void s;
}

// ---- papers tab
function papersTab(ctx: GameCtx, v: Vehicle, body: HTMLElement, redraw: () => void) {
  const car = fleet.carOf(v); const f = fee('papers', 40000);
  body.append(h('div', { class: 'fk-sec', text: 'Papers' }));
  if (car?.receipt) body.append(h('p', { class: 'gx-note', text: 'You have the car mart receipt for this one. That is all the Local Government desk needs, plus your NIN.' }));
  else if (car?.papers) body.append(h('p', { class: 'gx-note', text: 'Papers are on file. Take them to a Local Government secretariat with your NIN. Police are slower to chase a car with these kind of papers.' }));
  else body.append(h('p', { class: 'gx-note', text: 'No receipt for this car. If it came to you the rough way, a mechanic can find papers. They look correct. They are not as strong as a real receipt when you report the car.' }),
    h('button', { class: 'fk-btn', style: 'width:100%', text: 'Get papers  ' + fmt(f), onclick: () => { if (!spend(ctx, f, 'the papers')) return; const c = claim(ctx, v); if (!c) return; c.papers = true; fleet.persist(); say('Baba Papers will see you outside.'); redraw(); } }));
  body.append(h('div', { class: 'fk-row', style: 'margin-top:10px;flex-wrap:wrap' }, h('span', { class: 'fk-chip ' + (car?.reg ? 'g' : 'y'), text: car?.reg ? 'Registered to you' : 'Not registered' }), h('span', { class: 'fk-chip', text: 'Register at a Local Government secretariat' })));
}

// ---- car mart
function martTab(ctx: GameCtx, s: ResolvedSite, body: HTMLElement, ov: Overlay, redraw: () => void) {
  body.append(h('div', { class: 'fk-sec', text: 'Car mart' }), h('p', { class: 'gx-note', text: 'Clean cars with a receipt. The receipt is your proof of purchase when you register.' }));
  for (const c of shopItems('car')) {
    body.append(h('div', { class: 'fk-tile', style: 'cursor:default;margin-bottom:8px' }, h('div', { class: 'fk-row' }, h('b', { text: c.name }), h('div', { style: 'flex:1' }), h('span', { class: 'pr', text: fmt(c.price) })), h('span', { text: c.blurb }),
      h('div', { class: 'fk-row', style: 'margin-top:4px' }, h('span', { class: 'fk-chip', text: kindName(c.vehicle) }), h('div', { style: 'flex:1' }), h('button', { class: 'fk-btn sm green', text: 'Buy', onclick: () => {
        if (!spend(ctx, c.price, c.name)) return;
        const yaw = s.yaw + Math.PI / 2; const fx = Math.sin(yaw), fz = Math.cos(yaw); const x = s.x + fx * 11, z = s.z + fz * 11;
        const car = fleet.addBought(c.vehicle, c.name, x, z, yaw + Math.PI / 2); say(`${c.name} bought. It is parked by the bay. Plate ${car.plate}.`, 3.5); redraw();
      } }))));
  }
  void ov;
}

// ------------------------------------------------------------------------------------------------ phone app
function garageHtml(): string {
  const row = (b: string, s: string, btns: [string, string][] = []) => `<div class="row"><b>${b}</b>${s}${btns.map(([id, t]) => `<br><button class="btn" data-app="Garage" data-id="${id}">${t}</button>`).join('')}</div>`;
  let html = ''; const ctx = fleet.ctx;
  const me = ctx.sim.local; const mv = me.vehicle !== null ? ctx.sim.vehicles[me.vehicle] : null;
  if (mv && OWNABLE.includes(mv.kind) && !fleet.carOf(mv)) html += row('You are in a car that is not yours yet', 'Claim it to track and register it.', [['claim', 'Make this my car']]);
  for (const c of fleet.cars) {
    const p = fleet.posOf(c); const area = fleet.areaName(p.x, p.z);
    const st = c.status === 'stolen' ? (c.stolen?.reported ? (c.stolen.police ? 'STOLEN. Police are on it.' : 'STOLEN. Police lost the trail.') : 'STOLEN. Report it.') : c.status === 'wrecked' ? 'Wrecked.' : c.status === 'chopped' ? 'Stripped for parts.' : 'Parked and fine.';
    const btns: [string, string][] = [];
    if (c.tracker && c.status !== 'chopped') btns.push(['track:' + c.id, 'Track on LANDMAP']);
    if (c.status === 'stolen' && !c.stolen?.reported) btns.push(['report:' + c.id, 'Report stolen']);
    if (c.status === 'wrecked') btns.push(['repair:' + c.id, 'Repair ' + fmt(fee('repair', 120000))]);
    html += row(`${c.name} · ${c.plate}`, `${st}<br>${c.reg ? 'Registered' : 'Not registered'} · ${c.tracker ? shopItem('tracker', c.tracker.tier)?.name ?? 'Tracker' : 'No tracker'}${c.tracker && area ? '<br>Near ' + area : ''}`, btns);
  }
  if (!fleet.cars.length && !html) html = row('No cars yet', 'Buy one at a car mart, or claim the one you are driving. Paint it, plate it, track it, register it.');
  if (fleet.st.fines) html += row('Fines', fmt(fleet.st.fines) + ' for false reports.');
  return html;
}

function flyTo(ctx: GameCtx, x: number, z: number) {
  ctx.hud.togglePhone(false);
  if (!ctx.hud.landmapOn) (window as any).__hl.landmap();
  ctx.view.landmap.x = x; ctx.view.landmap.z = z;
}

// ------------------------------------------------------------------------------------------------ beacons for tracked cars
let beacons: Map<string, { g: THREE.Group; sprite: THREE.Sprite; pillar: THREE.Mesh }> = new Map(); let spriteTex: THREE.CanvasTexture | null = null;
function beaconTex() {
  if (spriteTex) return spriteTex; const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 52, 0, 6.28); g.fill(); g.fillStyle = '#0b0d14'; g.beginPath(); g.arc(64, 64, 42, 0, 6.28); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.roundRect(34, 54, 60, 22, 8); g.fill(); g.beginPath(); g.roundRect(46, 42, 36, 18, 6); g.fill(); g.fillStyle = '#0b0d14'; g.beginPath(); g.arc(46, 78, 7, 0, 6.28); g.arc(82, 78, 7, 0, 6.28); g.fill();
  spriteTex = new THREE.CanvasTexture(c); spriteTex.colorSpace = THREE.SRGBColorSpace; return spriteTex;
}
function beaconTick(ctx: GameCtx) {
  const live = new Set<string>(); const lm = ctx.view.landmap;
  for (const c of fleet.cars) {
    if (!c.tracker || c.status === 'chopped') continue; live.add(c.id);
    let b = beacons.get(c.id);
    if (!b) {
      const g = new THREE.Group(); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: beaconTex(), depthTest: false, depthWrite: false, transparent: true, color: 0xffb020 })); sp.renderOrder = 999; g.add(sp);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 120, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff4d5e, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); pillar.position.y = 60; g.add(pillar);
      ctx.view.scene.add(g); b = { g, sprite: sp, pillar }; beacons.set(c.id, b);
    }
    const t = c.tracker!; const stolen = c.status === 'stolen';
    b.g.position.set(t.px, 0, t.pz); b.sprite.position.y = lm.on ? 6 : 0;
    const s = lm.on ? lm.h * 0.07 : 0; b.sprite.scale.set(s, s, 1); b.sprite.visible = lm.on;
    (b.sprite.material as THREE.SpriteMaterial).color.set(stolen ? 0xff4d5e : 0xffb020);
    b.pillar.visible = stolen && !lm.on; if (stolen) (b.pillar.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.2 * Math.sin(ctx.view.time * 4);
  }
  for (const [id, b] of beacons) if (!live.has(id)) { b.g.removeFromParent(); beacons.delete(id); }
}

// ------------------------------------------------------------------------------------------------ cars in the street
let skip = 0;
function dressCars(ctx: GameCtx) {
  const sim = ctx.sim; const P = playerXZ(ctx);
  for (const v of sim.vehicles) {
    if (!v || (v as any).gone) continue; const e = ctx.view.cars.get(v.id); const m = e?.m as any; if (!m) continue;
    const p = v.body.translation(); const d = Math.hypot(p.x - P.x, p.z - P.z); if (d > 90) continue;
    const spec = (v as any).paintSpec as PaintSpec | undefined; const car = fleet.carOf(v);
    if (m._paintFor !== (spec ? spec.rev : -1) || m._carRev !== (car ? car.paint.rev : -1)) {
      m._paintFor = spec ? spec.rev : -1; m._carRev = car ? car.paint.rev : -1;
      let bake: THREE.Texture | null = null, geo: any = null;
      if (spec?.doc && designHook.bake && car) { const r = designHook.bake(car, m); bake = r.tex; geo = r.geo; }
      applyPaint(m, spec && spec.color ? spec : null, bake, geo);
    }
    if (v.kind !== 'keke' && v.kind !== 'okada' || v.kind === 'okada') { const pl = vehiclePlate(v); if (m._plateText !== pl.text || m._plateCustom !== pl.custom) { attachPlates(m, pl.text, pl.custom); m._plateCustom = pl.custom; } }
  }
}

// ------------------------------------------------------------------------------------------------ system
export const garage: GameSystem = {
  id: 'garage',
  async init(ctx) {
    await loadShops(); fleet.init(ctx); initSites(ctx); injectGarageCss();
    fleet.hideouts = sites.filter((s) => s.def.site === 'paint').map((s) => ({ x: s.wx, z: s.wz, name: s.def.name }));
    siteHooks.paint = (c, s) => openBay(c, s);
    ctx.blips.push(() => fleet.blips(), siteBlips);
    registerApp('Garage', 'M5 16h14M5 16v3h3v-3m8 0v3h3v-3M3 16v-4l2-5h14l2 5v4', 'linear-gradient(160deg,#ff9f43,#ee5a24)', () => garageHtml());
    const T = (window as any); T.__hlGarage = { fleet, painters, openBay: (id = 'cappa', tab = 'paint') => { const s = sites.find((x) => x.def.id === id); if (s) return openBay(ctx, s, tab); }, orbit, claim: () => { const me = ctx.sim.local; const v = me.vehicle !== null ? ctx.sim.vehicles[me.vehicle] : null; return v ? fleet.ensureOwned(v) : null; } };
  },
  step(ctx, dt) { fleet.step(ctx, dt); },
  frame(ctx, dt) {
    uses.tick(ctx); tickSites(ctx, dt); orbitFrame(ctx, dt);
    if ((skip = (skip + 1) % 3) === 0 || bayOpen) dressCars(ctx);
    beaconTick(ctx);
  },
  onAction(ctx, app, id) {
    if (app !== 'Garage') return false;
    const [cmd, cid] = id.split(':'); const car = cid ? fleet.car(cid) : null;
    if (cmd === 'claim') { const me = ctx.sim.local; const v = me.vehicle !== null ? ctx.sim.vehicles[me.vehicle] : null; if (v) fleet.ensureOwned(v); }
    else if (cmd === 'track' && car?.tracker) flyTo(ctx, car.tracker.px, car.tracker.pz);
    else if (cmd === 'report' && car) {
      const r = fleet.report(car); if (r === 'ok') toast(ctx, 'Report filed', `Police are looking for ${car.plate}. Watch the blue dot.`, 'ok', 6); else if (r === 'noreg') toast(ctx, 'Cannot report', 'Police will not open a case for a car with no registration. Register it at a Local Government secretariat.', 'warn', 7); else toast(ctx, 'Not stolen', 'That car is not missing. False report fine ₦5,000.', 'bad', 6);
    } else if (cmd === 'repair' && car) { if (spend(ctx, fee('repair', 120000), 'the repair')) { fleet.repair(car); say('Panel beaters at work. The car is back at its last spot.'); } }
    ctx.hud.refreshApp(); return true;
  },
};

function injectGarageCss() {
  addCss('garage', `
.fk-ov.clear .fk-side{position:absolute;right:max(12px,env(safe-area-inset-right));top:12px;bottom:12px;max-height:none;width:min(430px,calc(100vw - 24px))!important}
.gx-npc{display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:16px;background:rgba(255,255,255,.05);border:1px solid var(--line)}
.gx-npc b{display:block;font-size:13.5px} .gx-npc span{display:block;font-size:12.5px;color:var(--mut);line-height:1.4;margin-top:2px}
.gx-av{width:42px;height:42px;border-radius:14px;background:linear-gradient(160deg,#ff9f43,#ee5a24);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;flex:0 0 auto}
.gx-note{font-size:12.5px;color:var(--mut);line-height:1.5;margin:0}
.gx-sws{display:grid;grid-template-columns:repeat(8,1fr);gap:7px} .gx-sws .fk-sw{width:100%;height:auto;aspect-ratio:1}
.gx-color{width:46px;height:34px;border:none;border-radius:8px;background:none;padding:0}
.gx-total{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding:10px 12px;border-radius:14px;background:rgba(255,197,61,.07);border:1px solid rgba(255,197,61,.3)}
.gx-total div{display:flex;flex-direction:column} .gx-price{font-family:Rajdhani,Inter,sans-serif;font-size:24px;color:var(--gold)}
.gx-prog{padding:12px 0;display:flex;flex-direction:column;gap:10px}
@media (max-width:760px){.fk-ov.clear .fk-side{left:8px;right:8px;top:auto;bottom:8px;width:auto!important;height:52vh}}
`);
}
void stateOf; void bus; void uses;
