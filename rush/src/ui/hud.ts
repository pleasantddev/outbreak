// The race HUD: position, laps and timer top left, minimap top right, speed, Fuel and the Gbedu meter bottom right,
// the item slot bottom left, a standings ticker, and big callouts in the middle. DOM writes are throttled.
import { itemsOn, type RaceSim } from '../shared/race';
import type { Track } from '../shared/track';
import { ITEMS, type ItemId } from '../shared/items';
import { ITEM_ICON } from './icons';
import { esc } from './dom';

const ORD = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH');
export const fmtTime = (t: number) => { if (!Number.isFinite(t) || t <= 0) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; };

export class Hud {
  el: HTMLDivElement;
  private q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;
  private pos: HTMLElement; private posOf: HTMLElement; private posSuf: HTMLElement; private lap: HTMLElement; private timer: HTMLElement; private lapTimes: HTMLElement;
  private speed: HTMLElement; private gauge: SVGPathElement; private fuel: HTMLElement; private gbedu: HTMLElement[]; private item: HTMLElement; private itemName: HTMLElement;
  private callout: HTMLElement; private sub: HTMLElement; private count: HTMLElement; private wrong: HTMLElement; private board: HTMLElement; private map: HTMLCanvasElement;
  private mapPts: { x: number; z: number }[] = []; private mapBox = { x0: 0, z0: 0, s: 1 };
  private calloutT = 0; private lastWrite = 0; private rollT = 0;
  private styleFeed: HTMLElement;

  constructor(parent: HTMLElement, private track: Track, private player: number, private units: 'kmh' | 'mph' = 'kmh') {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-tl">
        <div class="hud-pos"><span class="p">1</span><span class="suf">ST</span><span class="of">/12</span></div>
        <div class="hud-lap"><b>LAP</b> <span class="l">1/3</span></div>
        <div class="hud-time"><span class="t">0:00.000</span></div>
        <div class="hud-laps"></div>
      </div>
      <div class="hud-board"></div>
      <div class="hud-tr"><canvas class="hud-map" width="220" height="220"></canvas></div>
      <div class="hud-center"><div class="hud-count"></div><div class="hud-callout"></div><div class="hud-sub"></div><div class="hud-wrong">WRONG WAY</div></div>
      <div class="hud-feed"></div>
      <div class="hud-bl"><div class="hud-item"><div class="ico"></div><div class="name">NO ITEM</div></div></div>
      <div class="hud-br">
        <svg class="hud-gauge" viewBox="0 0 200 120"><path class="bg" d="M20 110 A80 80 0 0 1 180 110" /><path class="fg" d="M20 110 A80 80 0 0 1 180 110" /></svg>
        <div class="hud-speed"><span class="v">0</span><small>${units === 'mph' ? 'MPH' : 'KM/H'}</small></div>
        <div class="hud-fuel"><span>FUEL</span><div class="bar"><i></i></div></div>
        <div class="hud-gbedu"><span>GBEDU</span><i></i><i></i><i></i></div>
      </div>`;
    parent.appendChild(this.el);
    this.pos = this.q('.hud-pos .p'); this.posSuf = this.q('.hud-pos .suf'); this.posOf = this.q('.hud-pos .of'); this.lap = this.q('.hud-lap .l'); this.timer = this.q('.hud-time .t'); this.lapTimes = this.q('.hud-laps');
    this.speed = this.q('.hud-speed .v'); this.gauge = this.el.querySelector('.hud-gauge .fg') as SVGPathElement; this.fuel = this.q('.hud-fuel i');
    this.gbedu = Array.from(this.el.querySelectorAll('.hud-gbedu i')) as HTMLElement[];
    this.item = this.q('.hud-item .ico'); this.itemName = this.q('.hud-item .name');
    this.callout = this.q('.hud-callout'); this.sub = this.q('.hud-sub'); this.count = this.q('.hud-count'); this.wrong = this.q('.hud-wrong'); this.board = this.q('.hud-board');
    this.styleFeed = this.q('.hud-feed');
    this.map = this.q('.hud-map');
    this.buildMap();
  }

  private buildMap() {
    const c = this.track.paths[0];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < c.n; i += 2) { x0 = Math.min(x0, c.x[i]); x1 = Math.max(x1, c.x[i]); z0 = Math.min(z0, c.z[i]); z1 = Math.max(z1, c.z[i]); this.mapPts.push({ x: c.x[i], z: c.z[i] }); }
    const s = 190 / Math.max(x1 - x0, z1 - z0);
    this.mapBox = { x0: (x0 + x1) / 2, z0: (z0 + z1) / 2, s };
  }

  private drawMap(sim: RaceSim) {
    const g = this.map.getContext('2d')!;
    const { x0, z0, s } = this.mapBox;
    const P = (x: number, z: number) => [110 + (x - x0) * s, 110 + (z - z0) * s];
    g.clearRect(0, 0, 220, 220);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); this.mapPts.forEach((p, i) => { const [a, b] = P(p.x, p.z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath();
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 11; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5; g.stroke();
    // start line
    const st = this.mapPts[0]; const [sx, sz] = P(st.x, st.z); g.fillStyle = '#f6c514'; g.fillRect(sx - 4, sz - 4, 8, 8);
    for (const rc of sim.cars) {
      const [a, b] = P(rc.c.x, rc.c.z);
      const me = rc.idx === this.player;
      g.beginPath(); g.arc(a, b, me ? 7 : 4.5, 0, Math.PI * 2);
      g.fillStyle = me ? '#f6c514' : rc.entrant.human ? '#39d0ff' : '#ff2d8a';
      g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
    }
    for (const h of sim.hazards) { const [a, b] = P(h.x, h.z); g.fillStyle = h.kind === 'rocket' ? '#ff3b30' : '#ffffff'; g.fillRect(a - 2, b - 2, 4, 4); }
  }

  /** Big centre text. kind tints it. */
  call(text: string, kind: 'good' | 'bad' | 'info' | 'gbedu' = 'info', sub = '') {
    this.callout.textContent = text; this.callout.className = `hud-callout show ${kind}`;
    this.sub.textContent = sub;
    this.calloutT = 1.6;
  }
  style(text: string, pts: number) {
    const d = document.createElement('div');
    d.className = 'feed-item'; d.innerHTML = `<b>${text}</b>${pts > 0 ? ` <span>+${pts}</span>` : ''}`;
    this.styleFeed.prepend(d);
    while (this.styleFeed.children.length > 4) this.styleFeed.lastElementChild!.remove();
    setTimeout(() => d.classList.add('out'), 1600); setTimeout(() => d.remove(), 2200);
  }
  countdown(n: number | 'GO') { this.count.textContent = String(n); this.count.className = 'hud-count show ' + (n === 'GO' ? 'go' : ''); setTimeout(() => this.count.classList.remove('show'), 700); }
  itemRoll() { this.rollT = 1.1; }

  update(sim: RaceSim, dt: number, kmh: number) {
    const rc = sim.cars[this.player];
    const c = rc.c;
    this.calloutT -= dt;
    if (this.calloutT <= 0 && this.callout.classList.contains('show')) { this.callout.classList.remove('show'); this.sub.textContent = ''; }
    this.rollT = Math.max(0, this.rollT - dt);
    const now = performance.now();
    if (now - this.lastWrite < 66) return;
    this.lastWrite = now;
    const n = sim.cars.length;
    this.pos.textContent = String(c.place); this.posSuf.textContent = ORD(c.place); this.posOf.textContent = `/${n}`;
    const lapShown = Math.max(1, Math.min(sim.cfg.laps, c.lap));
    this.lap.textContent = sim.cfg.mode === 'stunt' ? `${Math.max(0, Math.ceil(sim.cfg.stuntTime - sim.time))}s` : `${lapShown}/${sim.cfg.laps}`;
    this.timer.textContent = fmtTime(Math.max(0, c.finished ? c.finishTime : sim.time));
    this.lapTimes.innerHTML = c.bestLap ? `<span>BEST ${fmtTime(c.bestLap)}</span>${c.lastLap ? `<span>LAST ${fmtTime(c.lastLap)}</span>` : ''}` : '';
    this.speed.textContent = String(Math.round(this.units === 'mph' ? kmh * 0.621371 : kmh));
    const frac = Math.min(1, kmh / 300);
    this.gauge.style.strokeDasharray = `${frac * 252} 400`;
    this.fuel.style.width = `${Math.round(c.fuel * 100)}%`;
    this.fuel.parentElement!.parentElement!.classList.toggle('on', c.nitroOn);
    this.gbedu.forEach((g, i) => { g.className = c.drifting && c.driftTier > i ? `t${i + 1}` : ''; });
    // item slot with a roulette while rolling
    const it = c.item as ItemId | null;
    if (this.rollT > 0 && it) { const keys = Object.keys(ITEMS) as ItemId[]; const k = keys[Math.floor(now / 70) % keys.length]; this.item.innerHTML = ITEM_ICON[k]; this.itemName.textContent = '...'; this.item.parentElement!.className = 'hud-item rolling'; }
    else if (it) { this.item.innerHTML = ITEM_ICON[it]; this.itemName.textContent = ITEMS[it].short + (c.itemCharges > 1 ? ` x${c.itemCharges}` : ''); this.item.parentElement!.className = 'hud-item has'; }
    else { this.item.innerHTML = ''; this.itemName.textContent = itemsOn(sim.cfg) ? 'NO ITEM' : sim.cfg.mode.toUpperCase(); this.item.parentElement!.className = 'hud-item'; }
    this.wrong.classList.toggle('show', c.wrongWayT > 1.2 && sim.racing);
    this.el.classList.toggle('blackout', c.blackoutT > 0);
    // standings: around the player, plus the leader
    const order = [...sim.cars].sort((a, b) => a.c.place - b.c.place);
    const me = order.findIndex((r) => r.idx === this.player);
    const rows = new Set([0, me - 1, me, me + 1].filter((i) => i >= 0 && i < order.length));
    this.board.innerHTML = [...rows].sort((a, b) => a - b).map((i) => {
      const r = order[i];
      const gap = i === 0 ? '' : r.c.finished ? fmtTime(r.c.finishTime) : `-${Math.max(0, order[0].c.raceDist - r.c.raceDist).toFixed(0)}m`;
      return `<div class="row ${r.idx === this.player ? 'me' : ''} ${r.entrant.human ? 'human' : ''}"><b>${r.c.place}</b><span>${esc(r.entrant.name)}</span><em>${gap}</em></div>`;
    }).join('');
    this.drawMap(sim);
  }

  show(on: boolean) { this.el.style.display = on ? '' : 'none'; }
  dispose() { this.el.remove(); }
}
