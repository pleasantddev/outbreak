// Garage: pick a car, buy new ones, and customise paint, finish, wraps, rims, underglow, tint and plates. The menu
// backdrop turns into a close turntable shot of the car.
import type { App, Screen } from '../../app/app';
import { el, acts, esc, naira } from '../dom';
import { topbar } from './main';
import { CARS, carById, defaultLivery, PAINTS, WRAPS, RIMS, GLOWS, type Livery, type Finish } from '../../shared/cars';
import { owned, saveProfile, level } from '../../app/profile';
import { PAINT_PRICE, WRAP_PRICE, RIM_PRICE, GLOW_PRICE, PLATE_PRICE, FINISH_PRICE } from '../../shared/economy';

let tab: 'cars' | 'paint' | 'wrap' | 'rims' | 'extras' = 'cars';
let viewing = '';

const FINISHES: Finish[] = ['gloss', 'metallic', 'matte', 'pearl', 'chrome'];
const STAT_LABEL: [keyof typeof CARS[0]['stats'], string][] = [['speed', 'Speed'], ['accel', 'Accel'], ['handling', 'Handling'], ['drift', 'Drift'], ['weight', 'Weight']];

export function garageScreen(app: App): Screen {
  const p = app.profile;
  if (!viewing) viewing = p.current;
  const def = carById(viewing);
  const own = owned(p, viewing);
  const lvl = level(p).level;
  const cur = carById(p.current);
  const liv: Livery = own ? own.livery : defaultLivery(def);
  app.menu?.setCar(viewing, liv);
  const statBars = STAT_LABEL.map(([k, l]) => {
    const v = def.stats[k], c = cur.stats[k];
    return `<div class="stat"><span>${l}</span><div class="b"><i class="${v > c ? 'up' : v < c ? 'down' : ''}" style="width:${v * 10}%"></i></div><span>${v}</span></div>`;
  }).join('');

  const carList = CARS.map((c) => {
    const o = owned(p, c.id), locked = lvl < c.unlockLevel && !o;
    return `<button class="card ${c.id === viewing ? 'sel' : ''} ${locked ? 'locked' : ''}" data-act="view" data-id="${c.id}">
      <div class="row"><div class="k">${esc(c.name)}</div><span class="spacer"></span>${o ? (c.id === p.current ? '<span class="tag">IN USE</span>' : '<span class="tag dark">OWNED</span>') : locked ? `<span class="tag dark">LVL ${c.unlockLevel}</span>` : `<span class="price">${naira(c.price)}</span>`}</div>
      <div class="d">${esc(c.maker)} . ${c.cls.toUpperCase()}</div>
    </button>`;
  }).join('');

  const swatch = (col: string, sel: boolean, act: string) => `<button class="swatch ${sel ? 'sel' : ''}" style="background:${col}" data-act="${act}" data-v="${col}" aria-label="${col}"></button>`;
  let custom = '';
  if (!own) custom = `<div class="mute">Buy this car to customise it.</div>`;
  else if (tab === 'paint') custom = `
    <div class="field"><span class="lab">Colour <span class="price">${naira(PAINT_PRICE)}</span></span><div class="swatches">${PAINTS.map((c) => swatch(c, c === liv.paint, 'paint')).join('')}</div></div>
    <div class="field"><span class="lab">Finish</span><div class="seg">${FINISHES.map((f) => `<button class="${liv.finish === f ? 'on' : ''}" data-act="finish" data-v="${f}">${f}${FINISH_PRICE[f] ? ` ${'₦'}${(FINISH_PRICE[f] / 1000).toFixed(1)}k` : ''}</button>`).join('')}</div></div>`;
  else if (tab === 'wrap') custom = `
    <div class="field"><span class="lab">Wrap <span class="price">${naira(WRAP_PRICE)}</span></span><div class="seg">${WRAPS.map((w) => `<button class="${liv.wrap === w.id ? 'on' : ''}" data-act="wrap" data-v="${w.id}">${w.name}</button>`).join('')}</div></div>
    <div class="field"><span class="lab">Wrap colour</span><div class="swatches">${['#111111', '#ffffff', '#f6c514', '#d0141c', '#0a7a3c', '#1d4fb8', '#ff2d8a', '#ff6a00'].map((c) => swatch(c, c === liv.wrapColor, 'wrapColor')).join('')}</div></div>`;
  else if (tab === 'rims') custom = `
    <div class="field"><span class="lab">Rims <span class="price">${naira(RIM_PRICE)}</span></span><div class="seg">${RIMS.map((r) => `<button class="${liv.rims === r.id ? 'on' : ''}" data-act="rims" data-v="${r.id}">${r.name}</button>`).join('')}</div></div>
    <div class="field"><span class="lab">Rim colour</span><div class="swatches">${['#c0c4c8', '#1a1a1a', '#d4af37', '#f2f2f2', '#d0141c', '#1d4fb8', '#7a7f85', '#f6c514'].map((c) => swatch(c, c === liv.rimColor, 'rimColor')).join('')}</div></div>`;
  else if (tab === 'extras') custom = `
    <div class="field"><span class="lab">Underglow <span class="price">${naira(GLOW_PRICE)}</span></span><div class="swatches">${GLOWS.map((c) => c ? swatch(c, c === liv.glow, 'glow') : `<button class="swatch ${!liv.glow ? 'sel' : ''}" style="background:repeating-linear-gradient(45deg,#333 0 6px,#111 6px 12px)" data-act="glow" data-v="" aria-label="none"></button>`).join('')}</div></div>
    <div class="field"><span class="lab">Window tint</span><input class="slider" type="range" min="0" max="1" step="0.05" value="${liv.tint}" data-input="tint"></div>
    <div class="field"><span class="lab">Plate <span class="price">${naira(PLATE_PRICE)}</span></span><div class="row"><input class="input" maxlength="9" value="${esc(liv.plate)}" data-input="plate" style="flex:1; text-transform:uppercase"><button class="btn small" data-act="plate"><span>Set</span></button></div></div>`;

  const node = el(`<div class="screen garage">
    ${topbar('Garage', `${p.garage.length} of ${CARS.length} cars`, app)}
    <div class="split" style="grid-template-columns:minmax(260px,340px) 1fr minmax(280px,400px)">
      <div class="left scroll"><div class="cards" style="grid-template-columns:1fr">${carList}</div></div>
      <div class="hide-sm" style="display:flex; flex-direction:column; justify-content:flex-end; padding-bottom:12px" data-drag="1">
        <div class="carname"><div class="maker">${esc(def.maker)}</div><div class="model">${esc(def.name)}</div><div class="blurb">${esc(def.blurb)}</div></div>
      </div>
      <div class="right scroll panel" style="padding:14px">
        <div class="tabs">${(['cars', 'paint', 'wrap', 'rims', 'extras'] as const).map((t) => `<button class="${tab === t ? 'on' : ''}" data-act="tab" data-v="${t}">${t === 'cars' ? 'Stats' : t}</button>`).join('')}</div>
        ${tab === 'cars' ? `<div style="display:flex; flex-direction:column; gap:10px">${statBars}
          <div class="small mute">Top speed ${(def.topSpeed * 3.6).toFixed(0)} km/h . ${def.cls.toUpperCase()} class</div>
          ${own ? (viewing === p.current ? '<div class="tag">THIS IS YOUR RIDE</div>' : '<button class="btn" data-act="use"><span>Use this car</span></button>') : lvl < def.unlockLevel ? `<div class="tag dark">UNLOCKS AT LEVEL ${def.unlockLevel}</div>` : `<button class="btn" data-act="buy" ${p.naira < def.price ? 'disabled' : ''}><span>Buy for ${'₦'}${def.price.toLocaleString()}</span></button>${p.naira < def.price ? '<div class="small mute">Win a few races to save up.</div>' : ''}`}
        </div>` : `<div style="display:flex; flex-direction:column; gap:14px">${custom}</div>`}
      </div>
    </div>
  </div>`);

  const spend = (cost: number, apply: () => void) => {
    if (p.naira < cost) { app.toast('Not enough Naira yet'); return; }
    p.naira -= cost; apply(); saveProfile(p); app.audio.play('uiOk'); app.refresh();
  };
  const edit = (cost: number, fn: (l: Livery) => void) => { if (!own) return; spend(cost, () => fn(own.livery)); };
  acts(node, {
    back: () => app.back(),
    view: (t) => { viewing = t.dataset.id!; app.audio.play('ui'); app.refresh(); },
    tab: (t) => { tab = t.dataset.v as typeof tab; app.refresh(); },
    use: () => { p.current = viewing; saveProfile(p); app.toast(`${def.name} is ready`); app.refresh(); },
    buy: () => spend(def.price, () => { p.garage.push({ carId: def.id, livery: defaultLivery(def, p.garage[0].livery.plate) }); p.current = def.id; app.toast(`You bought the ${def.name}`); }),
    paint: (t) => edit(PAINT_PRICE, (l) => { l.paint = t.dataset.v!; }),
    finish: (t) => edit(FINISH_PRICE[t.dataset.v!] ?? 0, (l) => { l.finish = t.dataset.v as Finish; }),
    wrap: (t) => edit(WRAP_PRICE, (l) => { l.wrap = t.dataset.v as Livery['wrap']; }),
    wrapColor: (t) => edit(0, (l) => { l.wrapColor = t.dataset.v!; }),
    rims: (t) => edit(RIM_PRICE, (l) => { l.rims = t.dataset.v as Livery['rims']; }),
    rimColor: (t) => edit(0, (l) => { l.rimColor = t.dataset.v!; }),
    glow: (t) => edit(t.dataset.v ? GLOW_PRICE : 0, (l) => { l.glow = t.dataset.v || null; }),
    plate: () => { const v = (node.querySelector('[data-input=plate]') as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 9) || 'RUSH 001'; edit(PLATE_PRICE, (l) => { l.plate = v; }); },
  });
  node.querySelector<HTMLInputElement>('[data-input=tint]')?.addEventListener('input', (e) => { if (!own) return; own.livery.tint = +(e.target as HTMLInputElement).value; app.menu?.setCar(viewing, own.livery); saveProfile(p); });
  // drag to spin the car on the turntable
  let dragX: number | null = null;
  const area = node.querySelector<HTMLElement>('[data-drag]');
  area?.addEventListener('pointerdown', (e) => { dragX = e.clientX; area.setPointerCapture(e.pointerId); if (app.menu) app.menu.spin = false; });
  area?.addEventListener('pointermove', (e) => { if (dragX !== null) { app.menu?.rotate((e.clientX - dragX) * 0.01); dragX = e.clientX; } });
  const up = () => { if (dragX !== null) { dragX = null; if (app.menu) app.menu.spin = true; } };
  area?.addEventListener('pointerup', up); area?.addEventListener('pointercancel', up);
  return { el: node, view: 'garage', onLeave: () => { viewing = ''; const c = owned(p, p.current)!; app.menu?.setCar(c.carId, c.livery); } };
}
