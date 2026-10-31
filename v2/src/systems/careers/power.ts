// Lagos Power Distribution: the control room. A dark room with a live wall map of every feeder, consoles, and the
// shift operator's board. On shift you really move light around Lagos (online the server holds your switches for a
// few game hours and every player sees the result): answer the hospital that is on diesel, shed load when the gas
// pressure drops, give the area that has been dark all day its turn, schedule tonight's light, and say no (or yes) to
// the estate that sends an envelope. Paid per task, through the shared earnings rules.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import type { Venue } from '../life/venue';
import type { Thing } from '../life/index';
import { lifeSystem } from '../life';
import { addMoodlet } from '../life/needs';
import { Builder, canvasTex, M, box } from '../leisure/build';
import { sfx } from '../leisure/sfx';
import { earn } from '../money';
import { career } from './ranks';
import { net } from '../../net/client';
import { GRID, gridState, worldHours } from '../../net/rules';
import { FEEDERS } from '../power';

export const POWER_ORIGIN = new THREE.Vector3(42000, 0, 36000);
const css = `
#pctl{position:fixed;inset:0;z-index:10;display:none;align-items:center;justify-content:center;background:rgba(2,6,14,.6);font-family:Inter,sans-serif;color:#d7e3f4}
#pctl.on{display:flex} #pctl .bd{width:min(1040px,98vw);max-height:96vh;overflow:auto;border-radius:18px;padding:14px 16px;background:linear-gradient(180deg,#0b1424,#070d18);box-shadow:0 30px 80px rgba(0,0,0,.6),inset 0 0 0 1px rgba(80,140,220,.25)}
#pctl .top{display:flex;align-items:center;gap:12px} #pctl .top b{font:800 17px Rajdhani,Inter;letter-spacing:1.6px;color:#7dd3fc} #pctl .top span{font-size:12px;color:#7c8aa5}
#pctl .top .x{margin-left:auto;width:34px;height:34px;border-radius:10px;border:0;background:rgba(255,255,255,.08);color:#fff;font-size:18px;cursor:pointer}
#pctl .gen{display:flex;align-items:center;gap:10px;margin:10px 0 8px;font:700 12px Rajdhani,Inter;letter-spacing:.8px;color:#9fb3d1}
#pctl .gen .bar{flex:1;height:12px;border-radius:6px;background:rgba(255,255,255,.07);position:relative;overflow:hidden}
#pctl .gen .bar i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#22c55e,#facc15);border-radius:6px} #pctl .gen .bar u{position:absolute;top:-2px;bottom:-2px;width:2px;background:#f43f5e}
#pctl .map{display:grid;grid-template-columns:repeat(9,1fr);gap:4px}
#pctl .f{min-height:34px;border-radius:6px;padding:3px 6px;font-size:9.5px;line-height:1.2;cursor:pointer;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);position:relative;user-select:none}
#pctl .f b{display:block;font-size:10.5px;color:#e2ecfa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #pctl .f.on{background:rgba(250,204,21,.16);border-color:rgba(250,204,21,.45)} #pctl .f.on b{color:#fde68a}
#pctl .f.t{outline:2px solid #38bdf8;outline-offset:1px;animation:pt 1s infinite} @keyframes pt{50%{outline-color:transparent}}
#pctl .f .bd2{position:absolute;right:4px;top:3px;font:800 9px Rajdhani;color:#64748b} #pctl .f.op:after{content:'';position:absolute;left:4px;bottom:4px;width:6px;height:6px;border-radius:50%;background:#38bdf8}
#pctl .f.x{visibility:hidden}
#pctl .task{margin-top:4px;padding:10px 12px;border-radius:12px;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.25);font-size:13.5px;display:flex;gap:10px;align-items:center}
#pctl .task .tm{margin-left:auto;font:800 18px Rajdhani;color:#38bdf8} #pctl button.b{padding:8px 12px;border-radius:9px;border:0;background:#1d4ed8;color:#fff;font:700 12px Inter;cursor:pointer} #pctl button.g{background:rgba(255,255,255,.1)}
#pctl .pick{margin-top:8px;padding:9px 12px;border-radius:12px;background:rgba(255,255,255,.05);font-size:12.5px;display:none;gap:8px;align-items:center;flex-wrap:wrap} #pctl .pick.on{display:flex}
#pctl .log{margin-top:8px;font-size:11.5px;color:#7c8aa5;min-height:16px}
`;
type Task = { kind: 'hospital' | 'shed' | 'dark' | 'envelope'; f: number; need?: number; t: number; text: string; done?: boolean };

class Power {
  venue: Venue; private el!: HTMLElement; private wall!: THREE.CanvasTexture; private wallCv!: HTMLCanvasElement; private wallT = 0;
  private shift: { tasks: number; pay: number; task: Task | null; next: number; sel: number | null; bribes: number; log: string } | null = null; private tick = 0;
  constructor(private ctx: GameCtx) {
    const B = new Builder(POWER_ORIGIN); const W = 10, D = 14;
    B.floor(-W, 0, W, D, M(0xffffff, 0.6, { map: canvasTex(128, 128, (x) => { x.fillStyle = '#20252c'; x.fillRect(0, 0, 128, 128); x.strokeStyle = '#2c333c'; x.lineWidth = 3; x.strokeRect(0, 0, 128, 128); }, 10) }));
    B.room(-W, 0, W, D, M(0x1b222b, 0.9), { side: 's', at: W, w: 2.2 });
    B.sign('LAGOS POWER DISTRIBUTION · CONTROL ROOM', 0, 3.05, 0.12, 0, 9, '#7dd3fc', 'rgba(0,0,0,0)', '800 40px Rajdhani, Inter, sans-serif');
    // the wall map: every feeder, live
    this.wallCv = document.createElement('canvas'); this.wallCv.width = 900; this.wallCv.height = 800; this.wall = new THREE.CanvasTexture(this.wallCv); this.wall.colorSpace = THREE.SRGBColorSpace;
    const map = new THREE.Mesh(new THREE.PlaneGeometry(9, 8 * 9 / 9), new THREE.MeshBasicMaterial({ map: this.wall, toneMapped: false, color: new THREE.Color(1.8, 1.8, 1.8) })); map.position.set(0, 2.2, D - 0.08); map.rotation.y = Math.PI; map.scale.set(1, 0.36, 1); map.position.y = 2.0; B.add(map);
    B.add(box(9.4, 3.2, 0.1, M(0x0b0f14, 0.4), 0, 2.0, D - 0.04));
    // consoles: two rows of desks with screens
    for (const z of [6.5, 9.5]) for (let i = 0; i < 4; i++) {
      const x = -6 + i * 4; B.solid(box(3.2, 0.8, 1.0, M(0x2b3440, 0.5), x, 0.4, z), 3.2, 1.0, 0.8);
      for (const dx of [-0.9, 0, 0.9]) { const s = box(0.8, 0.5, 0.04, new THREE.MeshBasicMaterial({ color: [0x2394e0, 0x2fc48a, 0xd9a03a][(i + Math.round(dx)) % 3 + (dx < 0 ? 0 : 0)] ?? 0x0e3a5c, toneMapped: false }), x + dx, 1.15, z + 0.35); s.rotation.y = Math.PI; B.add(s); }
    }
    // the shift operator's desk at the front
    B.solid(box(4, 0.8, 1.2, M(0x334155, 0.45), 0, 0.4, 3.2), 4, 1.2, 0.8);
    for (const [x, z] of [[-6, 4], [6, 4], [-6, 11], [6, 11], [0, 8]]) { B.light(x, 3.0, z, 0x6f9fe8, 1.1, 9); B.add(box(1.6, 0.04, 0.25, new THREE.MeshBasicMaterial({ color: 0x8fb0d8, toneMapped: false }), x, 3.3, z)); }
    // the wall map is the brightest thing in the room and lights it from the far end; screens throw a cool glow on the desks and the operators' faces
    B.light(0, 2.4, D - 2.4, 0x7cc8ff, 7, 16);
    for (const [x, z] of [[-6, 5.6], [6, 5.6], [-6, 8.6], [6, 8.6]]) B.light(x, 1.5, z, 0x3aa0ff, 0.9, 4.5);
    const lot = B.lot({ x: 0, z: 1.6, yaw: 0 }, [{ name: 'Control room', x0: -W, z0: 0, x1: W, z1: D }], 0x11161d);
    this.venue = { id: 'power', title: 'LAGOS POWER', sub: 'Control room · shift operators wanted', lot, door: null, blip: '#facc15', label: 'Enter the control room', cam: { d: 10, pitch: 0.95 }, things: () => this.things(), enter: () => this.drawWall(), exit: () => this.end() };
  }
  get life() { return lifeSystem.api!; }
  init() { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); this.el = document.createElement('div'); this.el.id = 'pctl'; document.body.appendChild(this.el); (window as any).__pctl = this; }
  private things(): Thing[] { const O = POWER_ORIGIN; return [{ id: 'desk', name: 'Operator desk', x: O.x, z: O.z + 2.3, yaw: 0, actions: [], kind: 'object', reach: 2.4, verb: 'Take the operator shift', open: () => this.start() }]; }
  private hours() { return net.active ? worldHours(net.epochNow) : this.ctx.view.atmo.day * 24 + this.ctx.view.atmo.hour; }
  private st() { const P = (this.ctx.systems.get('power') as any)?.api; return P?.st ?? gridState(FEEDERS, this.hours()); }
  private drawWall() {
    const k = this.wallCv.getContext('2d')!; const s = this.st(); k.fillStyle = '#05080d'; k.fillRect(0, 0, 900, 800);
    for (const f of FEEDERS) { const i = f.i % GRID.w, j = Math.floor(f.i / GRID.w); const x = i * 100, y = j * 100; const on = s.on[f.i] === '1';
      k.fillStyle = on ? 'rgba(250,204,21,.85)' : 'rgba(40,52,70,.9)'; k.fillRect(x + 4, y + 4, 92, 92);
      k.fillStyle = on ? '#1a1300' : '#8aa0bf'; k.font = '700 15px Inter, sans-serif'; k.textAlign = 'center'; k.fillText(f.name.slice(0, 11), x + 50, y + 52); k.font = '800 12px Rajdhani, sans-serif'; k.fillText(`${f.load} MW · ${f.band}`, x + 50, y + 72); }
    if (s.collapse) { k.fillStyle = 'rgba(220,38,38,.85)'; k.fillRect(0, 360, 900, 80); k.fillStyle = '#fff'; k.font = '900 48px Rajdhani, sans-serif'; k.textAlign = 'center'; k.fillText('SYSTEM COLLAPSE', 450, 418); }
    this.wall.needsUpdate = true;
  }

  // ---------------------------------------------------------------- the shift
  private start() {
    const c = this.ctx; c.setModal(true); c.input.releasePointer();
    this.shift = { tasks: 0, pay: 0, task: null, next: 2, sel: null, bribes: 0, log: 'Shift started. Watch the generation bar: the red line is what the grid can carry.' };
    (c.sim.local as any).act = { clip: 'Idle_Loop', yaw: 0 }; this.draw();
  }
  private newTask(): Task {
    const s = this.st(); const on = (f: number) => s.on[f] === '1'; const pick = <T,>(l: T[]) => l[Math.floor(Math.random() * l.length)];
    const dark = FEEDERS.filter((f) => !on(f.i)), lit = FEEDERS.filter((f) => on(f.i)); const r = Math.random();
    if (r < 0.3 && dark.length) { const f = pick(dark); return { kind: 'hospital', f: f.i, t: 40, text: `General hospital in ${f.name} is running on diesel. Give ${f.name} light.` }; }
    if (r < 0.55 && lit.length > 3) { const need = 8 + Math.floor(Math.random() * 18); return { kind: 'shed', f: -1, need, t: 35, text: `Gas pressure drop at the plant. Shed ${need} MW now or the grid trips.` }; }
    if (r < 0.85 && dark.length) { const f = pick(dark.filter((x) => x.band === 'C').length ? dark.filter((x) => x.band === 'C') : dark); return { kind: 'dark', f: f.i, t: 45, text: `${f.name} has been dark since morning and people are gathering at the office. Give them light.` }; }
    const rich = FEEDERS.filter((f) => f.band === 'A'); const f = pick(rich.length ? rich : FEEDERS);
    return { kind: 'envelope', f: f.i, t: 30, text: `A man from an estate in ${f.name} is at the gate with an envelope. "Abeg, make our light no blink tonight."` };
  }
  private async flip(f: number, on: boolean, inHours = 0) {
    const s = this.shift!; const name = FEEDERS.find((x) => x.i === f)?.name ?? '';
    if (net.active) { const r = await net.act('grid.switch', { f, on, inHours, hours: inHours ? 4 : 3 }); if (!r.ok) { s.log = r.err ?? 'Switch failed.'; this.draw(); return false; } }
    else { const P = (this.ctx.systems.get('power') as any)?.api; if (P && !inHours) { const st = P.st; P.set({ ...st, on: st.on.slice(0, f) + (on ? '1' : '0') + st.on.slice(f + 1) }); } }
    sfx('tick'); s.log = inHours ? `${name} scheduled ${on ? 'ON' : 'OFF'} in ${inHours} hours for 4 hours.` : `${name} switched ${on ? 'ON' : 'OFF'}.`; this.check(); this.draw(); return true;
  }
  /** has the current task been met by the board as it stands */
  private check() {
    const s = this.shift; const t = s?.task; if (!s || !t || t.done) return; const st = this.st();
    let ok = false;
    if ((t.kind === 'hospital' || t.kind === 'dark') && st.on[t.f] === '1') ok = true;
    if (t.kind === 'shed') { const was = (t as any).base ?? ((t as any).base = st.load); ok = was - st.load >= (t.need ?? 0) || st.gen - st.load >= (t.need ?? 0); }
    if (ok) { t.done = true; s.tasks++; const p = t.kind === 'shed' ? 4000 : 3000; s.pay += p; s.log = `Done. +₦${p.toLocaleString()}`; sfx('cash'); s.task = null; s.next = 5; career.add('power', 1); }
  }
  private draw() {
    const s = this.shift; if (!s) return; const st = this.st(); const total = FEEDERS.reduce((a, f) => a + f.load, 0);
    const lpc = Math.min(100, (st.load / total) * 100), gpc = Math.min(100, (st.gen / total) * 100); const t = s.task;
    const tiles: string[] = [];
    for (let j = 0; j < GRID.h; j++) for (let i = 0; i < GRID.w; i++) { const id = i + j * GRID.w; const f = FEEDERS.find((x) => x.i === id);
      tiles.push(f ? `<div class="f${st.on[id] === '1' ? ' on' : ''}${t && t.f === id ? ' t' : ''}${st.by?.[id] ? ' op' : ''}" data-f="${id}"><b>${f.name}</b>${f.load} MW<span class="bd2">${f.band}</span></div>` : `<div class="f x"></div>`); }
    const hh = Math.floor(this.hours() % 24); const sel = s.sel !== null ? FEEDERS.find((x) => x.i === s.sel) : null;
    this.el.innerHTML = `<div class="bd"><div class="top"><b>LAGOS POWER · SHIFT OPERATOR</b><span>${String(hh).padStart(2, '0')}:00 · tasks ${s.tasks} · earned ₦${s.pay.toLocaleString()}${st.collapse ? ' · <b style="color:#f43f5e">SYSTEM COLLAPSE</b>' : ''}</span><button class="x">✕</button></div>
      <div class="gen">LOAD ${st.load} MW<div class="bar"><i style="width:${lpc}%"></i><u style="left:${gpc}%"></u></div>GENERATION ${st.gen} MW</div>
      ${t ? `<div class="task"><span>${t.text}</span>${t.kind === 'envelope' ? '<button class="b" data-a="take">Collect it</button><button class="b g" data-a="refuse">Send him away</button>' : ''}<span class="tm">${Math.ceil(t.t)}s</span></div>` : '<div class="task"><span>Board is quiet. Watch the load.</span></div>'}
      <div class="map" style="margin-top:8px">${tiles.join('')}</div>
      <div class="pick${sel ? ' on' : ''}">${sel ? `<b>${sel.name}</b> · Band ${sel.band} · ${sel.load} MW · ${st.on[sel.i] === '1' ? 'has light' : 'dark'}
        <button class="b" data-a="on">Switch ON</button><button class="b g" data-a="off">Switch OFF</button><button class="b g" data-a="eve">Light from 6pm</button><button class="b g" data-a="night">Off at midnight</button>` : ''}</div>
      <div class="log">${s.log}</div><div style="margin-top:8px;text-align:right"><button class="b g" data-a="end">End shift</button></div></div>`;
    this.el.classList.add('on');
    this.el.querySelector('.x')!.addEventListener('click', () => this.end());
    this.el.querySelectorAll('[data-f]').forEach((d) => d.addEventListener('click', () => { const id = +(d as HTMLElement).dataset.f!; s.sel = s.sel === id ? null : id; this.draw(); }));
    this.el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => void this.btn((b as HTMLElement).dataset.a!)));
  }
  private async btn(a: string) {
    const s = this.shift; if (!s) return;
    if (a === 'end') return this.end();
    if (s.sel !== null && (a === 'on' || a === 'off')) return void this.flip(s.sel, a === 'on');
    if (s.sel !== null && (a === 'eve' || a === 'night')) { const h = this.hours() % 24; const at = a === 'eve' ? 18 : 24; return void this.flip(s.sel, a === 'eve', Math.max(0.5, ((at - h) + 24) % 24)); }
    const t = s.task; if (!t || t.kind !== 'envelope') return;
    if (a === 'take') { s.bribes++; await this.flip(t.f, true); earn(this.ctx, 15_000, 'hustle'); s.log = 'You collected ₦15,000. Nobody saw. Probably.'; addMoodlet(this.life.needs, 'envelope', 'Took the envelope', 4, 10); }
    else { s.log = 'You sent him away. Your oga will never know, but you know.'; addMoodlet(this.life.needs, 'clean', 'Clean hands', 6, 12); s.tasks++; s.pay += 2000; }
    s.task = null; s.next = 4; this.draw();
  }
  frame(dt: number) {
    if (this.ctx.view && lifeSystem.api?.venue === this.venue) { this.wallT -= dt; if (this.wallT <= 0) { this.wallT = 2; this.drawWall(); } }
    const s = this.shift; if (!s) return;
    this.tick -= dt; const second = this.tick <= 0; if (second) this.tick = 1;
    if (!s.task) { s.next -= dt; if (s.next <= 0) { s.task = this.newTask(); sfx('chip'); this.draw(); } return; }
    s.task.t -= dt; if (second) this.check();
    if (s.task && s.task.t <= 0) { s.log = s.task.kind === 'shed' ? 'Too slow. The grid tripped a feeder by itself. ₦1,500 off.' : 'Too slow. The request went to the next shift.'; if (s.task.kind === 'shed') s.pay = Math.max(0, s.pay - 1500); s.task = null; s.next = 4; sfx('lose'); this.draw(); return; }
    if (second) { const el = this.el.querySelector('.task .tm'); if (el && s.task) el.textContent = `${Math.ceil(s.task.t)}s`; }
  }
  end() {
    const s = this.shift; if (!s) return; const c = this.ctx; this.shift = null; this.el.classList.remove('on'); c.setModal(false); (c.sim.local as any).act = undefined;
    if (s.pay) earn(c, Math.round(s.pay * career.mult('power')), 'work');
    const L = this.life; L.needs.v.energy = Math.max(0, L.needs.v.energy - s.tasks * 2);
    if (s.bribes >= 2 && Math.random() < 0.5) { addMoodlet(L.needs, 'query', 'Queried by the panel of inquiry', -10, 16); c.hud.toast('Panel of inquiry', 'Somebody talked. You have been queried about the envelopes.', 'var(--red)', 'msg', 5); }
    c.hud.toast('Shift over', `${s.tasks} tasks. ₦${s.pay.toLocaleString()} paid.`, 'linear-gradient(160deg,#facc15,#ca8a04)', 'cash', 4.5);
  }
}
let P: Power | null = null;
export const powerJobSystem: GameSystem = { id: 'powerjob', init(ctx) { P = new Power(ctx); P.init(); lifeSystem.api?.addVenue(P.venue); }, frame(_c, dt) { P?.frame(dt); } };
