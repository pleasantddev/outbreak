// The power grid on the client. Online, the server's state is the truth (one Lagos, one blackout); offline, the same
// plan runs locally from net/rules.ts. Everything that glows reads it: windows and shop fronts (buildings.ts through
// powerShared.uGrid), street lamps, your room's bulbs and fan (bills.ts), and the "UP NEPA!" moment when light returns.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from './registry';
import { net } from '../net/client';
import { GRID, BAND_HOURS, gridState, scheduledOn, worldHours, type FeederDef, type GridState } from '../net/rules';
import FEEDER_DATA from '../data/feeders.json';
import { registerApp } from '../ui/lifeHud';

export const FEEDERS = FEEDER_DATA as FeederDef[];
/** for shaders: one float per feeder, 1 when it has light. GLSL side: feeder index from world xz with the same GRID. */
/** uHome: your own house (x, z, radius, on): its windows glow when you have light even if the feeder is dark (your gen) */
export const powerShared = { uGrid: { value: new Float32Array(GRID.w * GRID.h).fill(1) }, uHome: { value: new THREE.Vector4(0, 0, 0, 0) } };
export const POWER_GLSL = /* glsl */ `
uniform float uGrid[${GRID.w * GRID.h}];
float gridAt(vec2 p) { float i = clamp(floor((p.x - (${GRID.x0}.0)) / ${GRID.cell}.0), 0.0, ${GRID.w - 1}.0); float j = clamp(floor((p.y - (${GRID.z0}.0)) / ${GRID.cell}.0), 0.0, ${GRID.h - 1}.0); return uGrid[int(i + j * ${GRID.w}.0)]; }
`;

class Power {
  st: GridState = { on: '1'.repeat(GRID.w * GRID.h), gen: 0, load: 0, collapse: false };
  /** testing and screenshots: pin the grid to this string (72 chars of 0/1) until cleared */
  force: string | null = null; private t = 0; private mine = -1; private mineOn: boolean | null = null; private el!: HTMLElement;
  constructor(private ctx: GameCtx) {}
  init() {
    registerApp('Light', 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z', 'linear-gradient(160deg,#facc15,#ca8a04)', () => this.html());
    (window as any).__power = this;
  }
  start() {
    net.on('grid', (m: any) => this.set(m)); net.on('welcome', (w: any) => { if (w.grid) this.set(w.grid); });
    if (net.welcome && (net.welcome as any).grid) this.set((net.welcome as any).grid);
    this.el = document.createElement('div'); this.el.id = 'pw'; this.el.className = 'pill gl';
    this.el.style.cssText = 'height:24px;padding:0 10px 0 6px;gap:6px;font-size:11.5px;font-weight:700;letter-spacing:.3px;display:flex;align-items:center';
    document.getElementById('tr')?.children[1]?.appendChild(this.el);
  }
  hours() { return net.active ? worldHours(net.epochNow) : this.ctx.view.atmo.day * 24 + this.ctx.view.atmo.hour; }
  on(x: number, z: number) { return this.st.on[GRID.of(x, z)] === '1'; }
  feeder(x: number, z: number) { const i = GRID.of(x, z); return FEEDERS.find((f) => f.i === i) ?? null; }
  private set(s: GridState) {
    this.st = { on: s.on, gen: s.gen, load: s.load, collapse: s.collapse, by: s.by };
    const u = powerShared.uGrid.value; for (let i = 0; i < u.length; i++) u[i] = s.on[i] === '1' ? 1 : 0;
    this.check(true);
  }
  /** your own feeder: shout when light comes, groan when it goes */
  private check(fromServer = false) {
    const me = this.ctx.sim.local; const L = (this.ctx.systems.get('life') as any)?.api; const at = L?.S?.inside && L?.S?.door ? L.S.door : me.pos;
    const f = GRID.of(at.x, at.z); const on = this.st.on[f] === '1';
    if (f === this.mine && this.mineOn !== null && on !== this.mineOn && fromServer) {
      const name = FEEDERS.find((x) => x.i === f)?.name ?? 'your area'; const by = this.st.by?.[f];
      this.ctx.hud.toast(on ? 'UP NEPA!' : 'NEPA!', on ? `Light don come for ${name}.${by ? ` ${by} switched it from the control room.` : ''} The whole street dey shout.` : this.st.collapse ? 'The national grid don collapse. Everywhere dark.' : `Light don go for ${name}.`, on ? 'linear-gradient(160deg,#facc15,#ca8a04)' : 'var(--red)', 'msg', 4.5);
    }
    this.mine = f; this.mineOn = on;
    if (this.el) { const name = FEEDERS.find((x) => x.i === f)?.name ?? ''; this.el.innerHTML = `<span style="color:${on ? '#facc15' : '#6b7280'};font-size:13px">${on ? '●' : '○'}</span>${on ? 'LIGHT' : this.st.collapse ? 'GRID DOWN' : 'NO LIGHT'}<span style="opacity:.6;font-weight:600">${name}</span>`; }
  }
  frame(dt: number) {
    this.t -= dt; if (this.t > 0) return; this.t = 2;
    if (this.force) this.set({ on: this.force, gen: 0, load: 0, collapse: !this.force.includes('1') }); else if (!net.active) this.set(gridState(FEEDERS, this.hours())); else this.check();
  }
  private html() {
    const me = this.ctx.sim.local; const f = this.feeder(me.pos.x, me.pos.z); const h = this.hours();
    if (!f) return `<div class="row"><b>No feeder here</b>This place is off the grid.</div>`;
    const strip = Array.from({ length: 24 }, (_, k) => { const hh = Math.floor(h) + k; const on = scheduledOn(f.i, f.band, hh); return `<i title="${hh % 24}:00" style="flex:1;height:14px;border-radius:2px;background:${on ? '#facc15' : 'rgba(255,255,255,.1)'}"></i>`; }).join('');
    const on = this.st.on[f.i] === '1'; const pct = this.st.load && this.st.gen ? Math.round((this.st.gen / FEEDERS.reduce((s, x) => s + x.load, 0)) * 100) : 0;
    return `<div class="row"><b>${f.name} feeder · Band ${f.band}</b>${on ? 'You have light now.' : this.st.collapse ? 'The national grid has collapsed. Nobody has light.' : 'No light now.'} Band ${f.band} is planned for ${BAND_HOURS[f.band]} hours a day.${this.st.by?.[f.i] ? ` Switched by ${this.st.by[f.i]} at the control room.` : ''}
      <div style="display:flex;gap:2px;margin-top:8px">${strip}</div><div style="display:flex;justify-content:space-between;font-size:10.5px;opacity:.6;margin-top:3px"><span>now</span><span>+12h</span><span>+24h</span></div></div>
      <div class="row"><b>Lagos today</b>Generation is carrying about ${pct}% of the city. ${FEEDERS.filter((x) => this.st.on[x.i] === '1').length} of ${FEEDERS.length} feeders have light. The control room can move light between areas.</div>`;
  }
}

let P: Power | null = null;
export const powerSystem: GameSystem & { get api(): Power | null } = {
  id: 'power', get api() { return P; },
  init(ctx) { P = new Power(ctx); P.init(); },
  start() { P?.start(); },
  frame(_c, dt) { P?.frame(dt); },
};
/** for other systems: does (x, z) have light right now (true when the power system is absent) */
export const power = { on: (x: number, z: number) => P?.on(x, z) ?? true, feeder: (x: number, z: number) => P?.feeder(x, z) ?? null };
