// In-match HUD: minimal like TLOU2, informative like Warzone, and readable in half a second.
import * as THREE from 'three';
import type { Sim } from '../sim/sim';
import type { SimEvent } from '../sim/types';
import { weaponStats, AMMO_STACK, itemLabel, itemRarity, STACK_LABEL } from '../sim/items';
import { WEAPONS, ABILITIES, ARCHETYPES, VEHICLES, HEART } from '../data/balance';
import { DEATH_LINES, VICTORY } from '../data/copy';
import type { City } from '../world/cityGen';
import { esc } from './menu';

export function renderCityMap(city: City, px = 2): HTMLCanvasElement {
  const size = city.half * 2;
  const c = document.createElement('canvas'); c.width = c.height = size * px;
  const g = c.getContext('2d')!;
  const X = (x: number) => (x + city.half) * px, Z = (z: number) => (z + city.half) * px;
  g.fillStyle = '#17110f'; g.fillRect(0, 0, c.width, c.height);
  // ground texture
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${40 + Math.random() * 30},${25 + Math.random() * 15},15,0.25)`; g.fillRect(Math.random() * c.width, Math.random() * c.height, 3, 3); }
  g.fillStyle = '#0a1418'; g.fillRect(X(city.water.x0), 0, c.width - X(city.water.x0), c.height);
  g.fillStyle = '#0d0d0d'; g.fillRect(X(city.canal.x0), 0, (city.canal.x1 - city.canal.x0) * px, c.height);
  for (const b of city.boxes) {
    if (b.mat === 'road' && b.vis) { g.fillStyle = '#2c2826'; const sw = Math.abs(Math.sin(b.ry)) > 0.5; const hx = sw ? b.s[2] : b.s[0], hz = sw ? b.s[0] : b.s[2]; g.fillRect(X(b.p[0] - hx), Z(b.p[2] - hz), hx * 2 * px, hz * 2 * px); }
  }
  g.fillStyle = '#3a3634'; g.fillRect(X(city.flyover.x0 - 60), Z(city.flyover.z - 7), (city.flyover.x1 - city.flyover.x0 + 105) * px, 14 * px);
  for (const b of city.buildings) {
    g.save(); g.translate(X(b.cx), Z(b.cz)); g.rotate(-b.ry);
    g.fillStyle = b.floors >= 4 ? '#4a2622' : '#3a2420'; g.fillRect((-b.w / 2) * px, (-b.d / 2) * px, b.w * px, b.d * px);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.strokeRect((-b.w / 2) * px, (-b.d / 2) * px, b.w * px, b.d * px);
    g.restore();
  }
  for (const b of city.boxes) if (b.mat === 'container') { g.fillStyle = '#4a3a32'; g.fillRect(X(b.p[0] - 1.2), Z(b.p[2] - 6), 2.4 * px, 12 * px); }
  g.font = `600 ${12 * px / 2 + 8}px Oswald, sans-serif`; g.textAlign = 'center'; g.fillStyle = 'rgba(232,224,208,0.55)';
  const labels: [string, number, number][] = [['AIRPORT ROAD', 40, -315], ['OSHODI TERMINAL', -80, 50], ['ILE-EPO MARKET', 40, -70], ['THE FLYOVER', -75, -24], ['APAPA PORT', 200, 300], ['LAGOON', 320, -100], ['MAINLAND ESTATES', -260, 120], ['CENTRAL OSHODI', 140, 60]];
  for (const [t, x, z] of labels) g.fillText(t, X(x), Z(z));
  return c;
}

interface Ping { x: number; z: number; t: number; color: string }

export class Hud {
  root: HTMLElement;
  sim: Sim;
  map: HTMLCanvasElement;
  mm: HTMLCanvasElement; mmg: CanvasRenderingContext2D;
  private els: Record<string, HTMLElement> = {};
  private pings: Ping[] = [];
  private lastHp = 100;
  private lagHp = 100;
  overlay: 'none' | 'map' | 'inventory' | 'pause' | 'end' = 'none';
  onLeave?: () => void;
  onDrop?: (i: number) => void;
  onResume?: () => void;
  private fps = 0; private fpsT = 0; private frames = 0;
  showFps = false;
  touch: boolean;
  private endShown = false;
  camYaw = 0;
  private camera: THREE.PerspectiveCamera | null = null;

  constructor(root: HTMLElement, sim: Sim, touch: boolean) {
    this.root = root; this.sim = sim; this.touch = touch;
    this.map = renderCityMap(sim.city);
    root.innerHTML = `
      <div class="minimap"><canvas width="380" height="380"></canvas><div class="mm-n">N</div></div>
      <div class="phase"><div class="p" data-e="phase"></div><div class="tm" data-e="time"></div><div class="meta"><span>ALIVE <b data-e="alive"></b></span><span class="k">KILLS <b data-e="kills"></b></span></div></div>
      <div class="compass"><div class="strip" data-e="strip"></div><div data-e="cmarks"></div></div>
      <div class="killfeed" data-e="feed"></div>
      <div class="scope" data-e="scope"></div>
      <div class="crosshair" data-e="cross"><i class="t" data-e="ct"></i><i class="t" data-e="cb"></i><i class="l" data-e="cl"></i><i class="l" data-e="cr"></i><i class="dot"></i></div>
      <div class="hitmark" data-e="hit"></div>
      <div class="dmgdir" data-e="dmg"></div>
      <div data-e="markers"></div>
      <div class="prompt hidden" data-e="prompt"></div>
      <div class="announce" data-e="announce"></div>
      <div data-e="banner"></div>
      <div class="contract panel cut ticks" data-e="contract"></div>
      <div class="toasts" data-e="toasts"></div>
      <div class="extract hidden" data-e="extract"><div class="xl" data-e="xl"></div><div class="bar2"><i data-e="xbar"></i></div></div>
      <div class="vitals"><div class="nm"><span data-e="opname"></span><span data-e="hpnum"></span></div>
        <div class="bar2" data-e="hpwrap"><i class="lag" data-e="lag"></i><i class="hp" data-e="hp"></i></div>
        <div class="bar2 armor"><i data-e="armor"></i></div><div class="status" data-e="status"></div></div>
      <div class="weapon"><div class="wname" data-e="wname"></div><div class="ammo" data-e="ammo"></div><div class="atts" data-e="atts"></div>
        <div class="slots" data-e="slots"></div><div class="abilities" data-e="abs"></div><div class="items" data-e="items"></div></div>
      <div class="fps hidden" data-e="fps"></div>
      <div class="lockhint hidden" data-e="lock">Click to take control</div>
      <div class="ctrlhint" data-e="ctrl">${touch ? 'Left stick to move / drag right side to look / Use to loot and drive' : 'WASD move / Shift sprint / Space jump and vault / C crouch / E loot, drive, take the Heart / Q X abilities / G frag / H heal / L light / M map / Tab bag'}</div>
      <div data-e="overlay"></div>
      ${touch ? this.touchHtml() : ''}`;
    root.querySelectorAll('[data-e]').forEach((e) => (this.els[(e as HTMLElement).dataset.e!] = e as HTMLElement));
    this.mm = root.querySelector('.minimap canvas') as HTMLCanvasElement;
    this.mmg = this.mm.getContext('2d')!;
    root.addEventListener('click', (e) => this.click(e));
    // compass strip
    const dirs = ['N', '15', '30', 'NE', '60', '75', 'E', '105', '120', 'SE', '150', '165', 'S', '195', '210', 'SW', '240', '255', 'W', '285', '300', 'NW', '330', '345'];
    this.els.strip.innerHTML = [...dirs, ...dirs, ...dirs].map((d) => `<span style="display:inline-block;width:40px;text-align:center;${d.length <= 2 && isNaN(+d) ? 'color:var(--bone);font-weight:600' : 'opacity:0.5;font-size:10px'}">${d}</span>`).join('');
  }
  setCamera(c: THREE.PerspectiveCamera) { this.camera = c; }

  private touchHtml() {
    const b = (id: string, label: string) => `<div data-tbtn="${id}">${label}</div>`;
    return `<div class="touch"><div id="joy-base"></div><div id="joy-knob"></div>
      ${b('fire', 'Fire')}${b('fireL', 'Fire')}${b('aim', 'Aim')}${b('jump', 'Jump')}${b('crouch', 'Crouch')}${b('reload', 'Reload')}${b('interact', 'Use')}
      ${b('ab1', 'Q')}${b('ab2', 'X')}${b('heal', 'Heal')}${b('frag', 'Frag')}${b('swap', 'Swap')}${b('awaken', 'Awaken')}${b('map', 'Map')}${b('inventory', 'Bag')}${b('pause', 'II')}</div>`;
  }

  event(e: SimEvent) {
    const me = this.sim.local;
    switch (e.t) {
      case 'announce': {
        this.els.announce.innerHTML = `<div class="a ${e.tone}">${esc(e.title)}</div>${e.sub ? `<div class="s">${esc(e.sub)}</div>` : ''}`;
        break;
      }
      case 'kill': {
        const div = document.createElement('div');
        div.className = 'k' + (e.killer === me.id || e.victim === me.id ? ' me' : '');
        div.innerHTML = `${esc(e.killerName)}<span class="w">${esc(e.weapon)}${e.head ? ' / head' : ''}</span>${esc(e.victimName)}`;
        this.els.feed.prepend(div);
        setTimeout(() => div.remove(), 6000);
        while (this.els.feed.children.length > 5) this.els.feed.lastChild?.remove();
        if (e.killer === me.id && e.victim !== me.id) { this.els.banner.innerHTML = `<div class="killbanner">${e.head ? 'Headshot / ' : ''}Eliminated ${esc(e.victimName)}</div>`; this.hitmark(true, e.head); }
        break;
      }
      case 'creatureDeath': if (e.by === me.id) this.hitmark(true, false); break;
      case 'pickup': if (e.actor === me.id) this.toast(e.label, e.rarity); break;
      case 'ping': this.pings.push({ x: e.at.x, z: e.at.z, t: performance.now(), color: e.kind === 'heart' ? '#ff2020' : '#c050ff' }); break;
      case 'hurt': if (e.actor === me.id && e.from) {
        const ang = Math.atan2(e.from.x - me.pos.x, e.from.z - me.pos.z) - this.camYaw;
        const i = document.createElement('i'); i.style.transform = `rotate(${-ang}rad)`;
        this.els.dmg.appendChild(i); setTimeout(() => i.remove(), 1200);
      } break;
      case 'blackout': this.event({ t: 'announce', title: 'BLACKOUT', sub: `The last grid in ${e.region} just died.`, tone: 'danger' }); break;
      case 'matchEnd': setTimeout(() => this.showEnd(), 1500); break;
    }
  }
  hitmark(kill: boolean, head: boolean) {
    const el = this.els.hit;
    el.className = 'hitmark' + (head || kill ? ' head' : '');
    void el.offsetWidth; el.classList.add('show');
  }
  private toast(text: string, rarity: string) {
    const d = document.createElement('div'); d.className = `toast ${rarity}`; d.textContent = text;
    this.els.toasts.appendChild(d); setTimeout(() => d.remove(), 2500);
    while (this.els.toasts.children.length > 5) this.els.toasts.firstChild?.remove();
  }

  update(dt: number, camYaw: number, scoped: boolean, locked = true) {
    const s = this.sim, me = s.local;
    this.els.lock.classList.toggle('hidden', locked || this.touch || this.overlay !== 'none' || !me.alive);
    if (s.time > 14 && !this.els.ctrl.classList.contains('gone')) this.els.ctrl.classList.add('gone');
    this.camYaw = camYaw;
    this.frames++; this.fpsT += dt; if (this.fpsT > 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }
    this.els.fps.classList.toggle('hidden', !this.showFps);
    if (this.showFps) this.els.fps.textContent = `${this.fps.toFixed(0)} FPS`;
    const phaseName: Record<string, string> = { drop: 'Drop', survival: 'Survive', corruption: 'The city is changing', heart: 'The Heart is awake', extraction: 'Extraction open', collapse: 'Collapse', ended: 'Match over' };
    const next = s.phase === 'drop' ? s.t('survival') : s.phase === 'survival' ? s.t('corruption') : s.phase === 'corruption' ? s.t('heart') : s.phase === 'heart' ? s.t('extraction') : s.phase === 'extraction' ? s.t('collapse') : s.t('end');
    const left = Math.max(0, next - s.time);
    this.els.phase.textContent = phaseName[s.phase];
    this.els.time.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    this.els.alive.textContent = String(s.actors.filter((a) => a.alive).length);
    this.els.kills.textContent = String(me.kills);
    // compass
    const deg = ((-camYaw * 180) / Math.PI + 360 * 4) % 360;
    this.els.strip.style.left = `${190 - 20 - (deg / 15) * 40 - 24 * 40}px`;
    const marks: string[] = [];
    const addMark = (x: number, z: number, col: string) => {
      let a = Math.atan2(x - me.pos.x, z - me.pos.z) - camYaw; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2;
      const px = 190 - (a / (Math.PI / 4)) * 120; if (px > 0 && px < 380) marks.push(`<div class="mark" style="left:${px}px;background:${col}"></div>`);
    };
    if (s.heart.active) addMark(s.heart.pos.x, s.heart.pos.z, '#ff2020');
    if (s.extractionOpen) for (const e of s.city.extractions) addMark(e.p[0], e.p[2], '#39ffb0');
    this.els.cmarks.innerHTML = marks.join('');

    // vitals
    const hpPct = Math.max(0, me.hp / me.maxHp) * 100;
    if (me.hp < this.lastHp) this.lagHp = Math.max(this.lagHp, this.lastHp); else this.lagHp = me.hp;
    this.lagHp += (me.hp - this.lagHp) * Math.min(1, dt * 1.5);
    this.lastHp = me.hp;
    this.els.hp.style.width = `${hpPct}%`;
    this.els.lag.style.width = `${Math.max(0, this.lagHp / me.maxHp) * 100}%`;
    this.els.hpwrap.classList.toggle('heart', me.heart);
    this.els.armor.style.width = `${me.inv.armor ? (me.inv.armor.hp / 75) * 100 : 0}%`;
    this.els.hpnum.textContent = `${Math.ceil(me.hp)}${me.inv.armor ? ` + ${Math.ceil(me.inv.armor.hp)}` : ''}`;
    this.els.opname.textContent = `${me.name} / ${ARCHETYPES[me.archetype].name}`;
    const st: string[] = [];
    if (me.heart) st.push('<span class="tag">Heart carrier</span>');
    if (me.awakenT > 0) st.push(`<span class="tag" style="background:#5a1a8a">Awakened ${Math.ceil(me.awakenT)}s</span>`);
    if (me.shadowT > 0) st.push('<span class="tag dim">In shadow</span>');
    if (me.healT > 0) st.push(`<span class="tag sodium">Healing ${me.healT.toFixed(1)}s</span>`);
    if (me.reloadT > 0) st.push('<span class="tag dim">Reloading</span>');
    if (me.inv.count('artifact')) st.push('<span class="tag" style="background:#8a0b0b">Artifact: press V</span>');
    if (s.corruption.some((c) => Math.hypot(me.pos.x - c.x, me.pos.z - c.z) < c.r)) st.push('<span class="tag">Corrupted ground</span>');
    if (s.zone.active && Math.hypot(me.pos.x - s.zone.cx, me.pos.z - s.zone.cz) > s.zone.r) st.push('<span class="tag">Outside the circle</span>');
    this.els.status.innerHTML = st.join('');

    // weapon
    const w = s.currentWeapon(me);
    if (me.awakenT > 0) { this.els.wname.textContent = 'Claws'; this.els.ammo.innerHTML = '&#8734;'; this.els.atts.textContent = ''; }
    else if (me.vehicle !== null) { const v = s.vehicles[me.vehicle]; this.els.wname.textContent = `${VEHICLES[v.kind].name} / seat ${me.seat + 1}`; this.els.ammo.innerHTML = `${Math.round(Math.abs(v.ctrl.currentVehicleSpeed()) * 3.6)}<small> km/h</small>`; this.els.atts.textContent = `Fuel ${Math.round(v.fuel)}%  Engine ${Math.round((v.engine / VEHICLES[v.kind].engine) * 100)}%  Tyres ${v.tires.filter((t) => t > 0).length}/4`; }
    else if (w) {
      const stt = weaponStats(w);
      this.els.wname.textContent = stt.name;
      if (w.id === 'machete') { this.els.ammo.innerHTML = '&#8212;'.replace('&#8212;', '/'); this.els.ammo.className = 'ammo'; }
      else {
        const res = me.inv.count(AMMO_STACK[stt.ammo]!);
        this.els.ammo.innerHTML = `${w.mag}<small> / ${res}</small>`;
        this.els.ammo.className = 'ammo' + (w.mag <= stt.mag * 0.25 ? ' low' : '');
      }
      this.els.atts.textContent = Object.values(w.att).join('  ');
    }
    const sl = (i: number, label: string | null) => `<div class="${me.slot === i ? 'on' : ''}">${i + 1} ${label ?? '/'}</div>`;
    this.els.slots.innerHTML = sl(0, me.inv.primary ? WEAPONS[me.inv.primary.id].name : null) + sl(1, me.inv.secondary ? WEAPONS[me.inv.secondary.id].name : null) + sl(2, 'Cutlass');
    this.els.abs.innerHTML = me.inv.abilities.map((ab, i) => {
      if (!ab) return `<div class="ab"><span class="ic" style="color:var(--ash)">Empty</span><span class="key">${i ? 'X' : 'Q'}</span></div>`;
      const def = ABILITIES[ab.id]; const p = ab.cd > 0 ? (ab.cd / def.cooldown) * 100 : 0;
      return `<div class="ab ${ab.cd <= 0 ? 'ready' : ''}" style="--p:${p}%"><div class="cd"></div><span class="rk">${'I'.repeat(ab.rank + 1)}</span><span class="ic" style="color:#${def.color.toString(16).padStart(6, '0')}">${def.name}</span><span class="key">${i ? 'X' : 'Q'}</span></div>`;
    }).join('');
    this.els.items.innerHTML = `<span>HEAL <b>${me.inv.count('bandage')}+${me.inv.count('medkit')}</b></span><span>FRAG <b>${me.inv.count('frag')}</b></span><span>BAG <b>${me.inv.backpack.length - me.inv.freeSlots()}/${me.inv.backpack.length}</b></span>`;

    // crosshair: spread grows with movement and hip fire
    const spreadBase = w && w.id !== 'machete' ? (me.aiming ? weaponStats(w).adsSpread : weaponStats(w).hipSpread) : 0.02;
    const spreadPx = 6 + spreadBase * 500 * (me.speed > 1 ? 1.6 : 1) + me.recoil * 300;
    this.els.ct.style.top = `${-spreadPx - 8}px`; this.els.cb.style.top = `${spreadPx}px`; this.els.cl.style.left = `${-spreadPx - 8}px`; this.els.cr.style.left = `${spreadPx}px`;
    this.els.cross.style.display = scoped || me.vehicle !== null && me.seat === 0 || !me.alive ? 'none' : '';
    this.els.scope.style.display = scoped ? 'block' : 'none';

    // interaction prompt
    let prompt = '', rarity = '';
    if (me.alive) {
      if (me.vehicle !== null) prompt = '<kbd>E</kbd> Get out' + (me.seat === 0 ? '  <kbd>Space</kbd> Handbrake' : '');
      else if (s.heart.active && s.heart.carrier === null && Math.hypot(s.heart.pos.x - me.pos.x, s.heart.pos.z - me.pos.z) < 2.6) { prompt = '<kbd>E</kbd> Take the Heart'; rarity = 'mythic'; }
      else {
        const l = s.nearestLoot(me, 2.4);
        if (l) { prompt = `<kbd>E</kbd> ${esc(itemLabel(l.item))}`; rarity = itemRarity(l.item); }
        else {
          const v = s.vehicles.find((v) => !v.destroyed && Math.hypot(v.body.translation().x - me.pos.x, v.body.translation().z - me.pos.z) < 4);
          if (v) prompt = `<kbd>E</kbd> ${v.seats[0] === null ? 'Drive' : 'Ride'} ${VEHICLES[v.kind].name}`;
        }
      }
    }
    this.els.prompt.classList.toggle('hidden', !prompt);
    if (prompt) { this.els.prompt.innerHTML = prompt; this.els.prompt.className = `prompt ${rarity}`; }

    // contract
    const c = me.contract;
    if (c) {
      const pct = Math.min(100, (c.progress / c.goal) * 100);
      const val = c.id === 'smuggler' ? `₦${Math.round(c.progress).toLocaleString()} / ₦${c.goal.toLocaleString()}` : c.id === 'thief' || c.id === 'informant' ? `${Math.floor(c.progress)}s / ${c.goal}s` : c.id === 'survivor' ? (c.done ? 'Survived' : 'Stay alive') : `${Math.floor(c.progress)} / ${c.goal}`;
      this.els.contract.className = `contract panel cut ticks${c.done ? ' done' : ''}${c.failed ? ' failed' : ''}`;
      this.els.contract.innerHTML = `<div class="label">Secret contract</div><div class="ct">${c.title}</div><div class="cb">${esc(c.brief)}</div><div class="cp"><i style="width:${pct}%"></i></div><div class="label" style="margin-top:6px">${val}${c.done ? (s.extractionOpen ? ' / extract now' : ' / wait for extraction') : ''}</div>`;
    }
    // extraction progress
    const extracting = (s.heart.carrier === me.id && s.heart.hold > 0) || me.extracting > 0;
    this.els.extract.classList.toggle('hidden', !extracting);
    if (extracting) {
      const k = s.heart.carrier === me.id ? s.heart.hold / HEART.holdTime : me.extracting / HEART.contractHold;
      this.els.xl.textContent = s.heart.carrier === me.id ? 'Extracting with the Heart: hold the zone' : 'Contract extraction: hold the zone';
      this.els.xbar.style.width = `${Math.min(100, k * 100)}%`;
    }
    this.worldMarkers();
    this.drawMinimap(camYaw);
    if (this.overlay === 'map') this.drawBigMap();
  }

  private worldMarkers() {
    if (!this.camera) return;
    const s = this.sim, me = s.local, out: string[] = [];
    const proj = (x: number, y: number, z: number, cls: string, label: string) => {
      const v = new THREE.Vector3(x, y, z).project(this.camera!);
      if (v.z > 1) return;
      const sx = (v.x * 0.5 + 0.5) * window.innerWidth, sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      out.push(`<div class="heartdist ${cls}" style="left:${Math.max(30, Math.min(window.innerWidth - 30, sx))}px;top:${Math.max(40, Math.min(window.innerHeight - 40, sy))}px">${label}</div>`);
    };
    if (s.heart.active && s.heart.carrier !== me.id) { const d = Math.hypot(s.heart.pos.x - me.pos.x, s.heart.pos.z - me.pos.z); proj(s.heart.pos.x, s.heart.pos.y + 2.5, s.heart.pos.z, '', `${Math.round(d)}m`); }
    if (s.extractionOpen && (me.heart || me.contract?.done)) for (const e of s.city.extractions) { const d = Math.hypot(e.p[0] - me.pos.x, e.p[2] - me.pos.z); proj(e.p[0], e.p[1] + 3, e.p[2], 'ex', `${Math.round(d)}m`); }
    this.els.markers.innerHTML = out.join('');
  }

  private drawMinimap(camYaw: number) {
    const g = this.mmg, me = this.sim.local, s = this.sim;
    const W = 380, scale = 2.4; // canvas px per meter
    g.save();
    g.fillStyle = '#0a0708'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2);
    g.rotate(camYaw + Math.PI);
    g.scale(-1, 1);
    const half = s.city.half;
    const mpx = this.map.width / (half * 2);
    g.drawImage(this.map, (-(me.pos.x + half) * mpx) * (scale / mpx), (-(me.pos.z + half) * mpx) * (scale / mpx), this.map.width * (scale / mpx), this.map.height * (scale / mpx));
    const P = (x: number, z: number) => [(x - me.pos.x) * scale, (z - me.pos.z) * scale];
    if (s.zone.active) { g.strokeStyle = '#d4161c'; g.lineWidth = 4; const [x, z] = P(s.zone.cx, s.zone.cz); g.beginPath(); g.arc(x, z, s.zone.r * scale, 0, Math.PI * 2); g.stroke(); }
    for (const c of s.corruption) { const [x, z] = P(c.x, c.z); g.fillStyle = 'rgba(180,10,10,0.3)'; g.beginPath(); g.arc(x, z, c.r * scale, 0, Math.PI * 2); g.fill(); }
    if (s.extractionOpen) for (const e of s.city.extractions) { const [x, z] = P(e.p[0], e.p[2]); g.fillStyle = '#39ffb0'; g.beginPath(); g.arc(x, z, 7, 0, Math.PI * 2); g.fill(); }
    if (s.heart.active) { const [x, z] = P(s.heart.pos.x, s.heart.pos.z); g.fillStyle = '#ff1a1a'; g.save(); g.translate(x, z); g.rotate(Math.PI / 4); g.fillRect(-7, -7, 14, 14); g.restore(); }
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.t < 8000);
    for (const p of this.pings) { const [x, z] = P(p.x, p.z); const k = (now - p.t) / 8000; g.strokeStyle = p.color; g.globalAlpha = 1 - k; g.lineWidth = 3; g.beginPath(); g.arc(x, z, 8 + k * 30, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
    // gunfire you can hear shows as red ticks
    for (const n of s.noises) { if (n.by === me.id || n.r < 60) continue; const [x, z] = P(n.pos.x, n.pos.z); if (Math.hypot(x, z) > W / 2) continue; g.fillStyle = 'rgba(255,60,40,0.8)'; g.fillRect(x - 3, z - 3, 6, 6); }
    for (const v of s.vehicles) { if (v.destroyed) continue; const p = v.body.translation(); const [x, z] = P(p.x, p.z); if (Math.hypot(x, z) > W / 2) continue; g.fillStyle = '#e8c34a'; g.fillRect(x - 3, z - 3, 6, 6); }
    g.restore();
    // player arrow (always points up: the map turns with the camera)
    g.save(); g.translate(W / 2, W / 2);
    g.rotate(-(me.yaw - camYaw));
    g.fillStyle = '#e8e0d0'; g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill();
    g.restore();
  }

  private drawBigMap() {
    const cv = this.root.querySelector('.bigmap canvas') as HTMLCanvasElement | null;
    if (!cv) return;
    const g = cv.getContext('2d')!, s = this.sim, me = s.local;
    const k = cv.width / (s.city.half * 2);
    const P = (x: number, z: number) => [(x + s.city.half) * k, (z + s.city.half) * k];
    g.drawImage(this.map, 0, 0, cv.width, cv.height);
    if (s.zone.active) { const [x, z] = P(s.zone.cx, s.zone.cz); g.strokeStyle = '#d4161c'; g.lineWidth = 3; g.beginPath(); g.arc(x, z, s.zone.r * k, 0, Math.PI * 2); g.stroke(); }
    for (const c of s.corruption) { const [x, z] = P(c.x, c.z); g.fillStyle = 'rgba(180,10,10,0.35)'; g.beginPath(); g.arc(x, z, c.r * k, 0, Math.PI * 2); g.fill(); }
    for (const e of s.city.extractions) { const [x, z] = P(e.p[0], e.p[2]); g.fillStyle = s.extractionOpen ? '#39ffb0' : 'rgba(57,255,176,0.3)'; g.beginPath(); g.arc(x, z, 9, 0, Math.PI * 2); g.fill(); g.font = '600 13px Oswald'; g.fillText(e.name.toUpperCase(), x + 12, z + 4); }
    for (const hs of s.city.heartSites) { const [x, z] = P(hs.p[0], hs.p[2]); g.strokeStyle = 'rgba(255,30,30,0.5)'; g.strokeRect(x - 6, z - 6, 12, 12); }
    if (s.heart.active) { const [x, z] = P(s.heart.pos.x, s.heart.pos.z); g.fillStyle = '#ff1a1a'; g.beginPath(); g.arc(x, z, 9, 0, Math.PI * 2); g.fill(); }
    const [px, pz] = P(me.pos.x, me.pos.z);
    g.fillStyle = '#e8e0d0'; g.beginPath(); g.arc(px, pz, 7, 0, Math.PI * 2); g.fill();
  }

  toggle(which: 'map' | 'inventory' | 'pause') {
    if (this.overlay === 'end') return;
    this.overlay = this.overlay === which ? 'none' : which;
    this.renderOverlay();
  }
  renderOverlay() {
    const o = this.els.overlay, me = this.sim.local;
    if (this.overlay === 'none') { o.innerHTML = ''; return; }
    if (this.overlay === 'map') { o.innerHTML = `<div class="overlay bigmap interactive" data-close><canvas width="1000" height="1000"></canvas></div>`; this.drawBigMap(); }
    if (this.overlay === 'pause') o.innerHTML = `<div class="overlay interactive"><div class="pause panel cut ticks"><div class="label">Paused / the city does not wait</div><button class="btn" data-resume>Resume</button><button class="btn" data-leave>Leave match</button></div></div>`;
    if (this.overlay === 'inventory') {
      const eq = (l: string, v: string) => `<div class="eq"><div class="label">${l}</div><div class="v">${v}</div></div>`;
      const ab = me.inv.abilities.map((a) => (a ? `${ABILITIES[a.id].name} ${'I'.repeat(a.rank + 1)}` : 'Empty'));
      o.innerHTML = `<div class="overlay interactive"><div class="inv panel cut ticks">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><div class="h1" style="font-size:28px">Inventory</div><div class="label">${ARCHETYPES[me.archetype].name}: ${me.inv.backpack.length} backpack slots${me.archetype === 'runner' ? ' / courier rig' : ''}</div></div>
        <div class="equip" style="margin-top:14px">${eq('Primary', me.inv.primary ? WEAPONS[me.inv.primary.id].name : 'Empty')}${eq('Secondary', me.inv.secondary ? WEAPONS[me.inv.secondary.id].name : 'Empty')}${eq('Ability 1', ab[0])}${eq('Ability 2', ab[1])}${eq('Armor', me.inv.armor ? `Lv${me.inv.armor.level} / ${Math.ceil(me.inv.armor.hp)}` : 'None')}${eq('Contraband', '₦' + me.inv.contrabandValue().toLocaleString())}${eq('Melee', 'Cutlass')}${eq('Throwable', `${me.inv.count('frag')} Frag`)}</div>
        <div class="label" style="margin-top:18px">Backpack</div>
        <div class="grid">${me.inv.backpack.map((s, i) => s ? `<div class="cell ${itemRarity(s)}"><div>${s.type === 'contraband' ? `Contraband ₦${(s.value ?? 0).toLocaleString()}` : STACK_LABEL[s.type]}</div><div class="c">${s.count}</div><button data-dropi="${i}">Drop</button></div>` : `<div class="cell empty"><div class="label">Empty</div></div>`).join('')}</div>
        <div style="margin-top:16px;text-align:right"><button class="btn" data-close>Close</button></div></div></div>`;
    }
  }
  pendingDrop = -1;
  private click(e: Event) {
    const t = e.target as HTMLElement;
    if (t.closest('[data-resume]')) { this.overlay = 'none'; this.renderOverlay(); this.onResume?.(); }
    if (t.closest('[data-leave]')) this.onLeave?.();
    if (t.closest('[data-close]') && (t.closest('button') || t.hasAttribute('data-close'))) { this.overlay = 'none'; this.renderOverlay(); }
    const d = t.closest('[data-dropi]') as HTMLElement | null;
    if (d) { this.pendingDrop = +d.dataset.dropi!; setTimeout(() => this.renderOverlay(), 50); }
  }

  showEnd() {
    if (this.endShown) return;
    this.endShown = true;
    const me = this.sim.local, s = this.sim;
    this.overlay = 'end';
    const won = me.won;
    const v = won ? VICTORY[won] : null;
    const alive = s.actors.filter((a) => a.alive).length;
    const place = me.placement || (me.alive ? 1 : alive + 1);
    this.els.overlay.innerHTML = `<div class="overlay interactive"><div class="endcard panel cut ticks">
      <div class="label">${won ? 'Victory' : me.alive ? 'Match over' : `Killed by ${esc(me.killedBy ?? 'the city')}`}</div>
      <div class="place">#${place}<small>/${s.actors.length}</small></div>
      <div class="ttl ${won ? 'win' : 'dead'}">${v ? v.title : me.alive ? 'THE CITY DECIDED' : 'YOU DIED'}</div>
      <div class="line">${v ? v.sub : DEATH_LINES[Math.floor(Math.random() * DEATH_LINES.length)]}</div>
      <div class="stats"><div><b>${me.kills}</b><span class="label">Kills</span></div><div><b>${me.creatureKills}</b><span class="label">Creatures</span></div><div><b>${Math.round(me.damageDealt)}</b><span class="label">Damage</span></div><div><b>${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}</b><span class="label">Survived</span></div></div>
      <div class="actions">${!s.ended && !me.alive ? '<button class="btn" data-spectate>Keep watching</button>' : ''}<button class="btn primary" data-leave>Back to lobby</button></div>
    </div></div>`;
    this.els.overlay.querySelector('[data-spectate]')?.addEventListener('click', () => { this.overlay = 'none'; this.renderOverlay(); this.endShown = false; });
  }
  maybeShowDeath() { const me = this.sim.local; if ((!me.alive || me.won) && !this.endShown && this.overlay !== 'end') setTimeout(() => this.showEnd(), 1800); }
}
