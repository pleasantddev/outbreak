// A 9-to-5: teller at First Hustle Bank. Customers queue; each one wants a deposit or a withdrawal. Count the bundle
// of naira notes correctly (they come mixed: ₦1000, ₦500, ₦200, ₦100), and spot the fake note when there is one.
// Mistakes come out of your salary. Office hours only, smart clothes, steady money.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import type { Actor } from '../../sim/types';
import type { Venue } from '../life/venue';
import type { Thing } from '../life/index';
import { lifeSystem } from '../life';
import { addMoodlet } from '../life/needs';
import { Builder, canvasTex, M, box } from '../leisure/build';
import { sfx } from '../leisure/sfx';
import { earn } from '../money';
import { career } from './ranks';

export const BANK_ORIGIN = new THREE.Vector3(40000, 0, 36000);
const DEN = [{ v: 1000, c: '#7e57c2', t: '#ede7f6' }, { v: 500, c: '#26a69a', t: '#e0f2f1' }, { v: 200, c: '#8d6e63', t: '#efebe9' }, { v: 100, c: '#ef5350', t: '#ffebee' }];
const css = `
#bank{position:fixed;inset:0;z-index:10;display:none;align-items:center;justify-content:center;background:rgba(4,10,20,.55);font-family:Inter,sans-serif;color:#0f172a}
#bank.on{display:flex} #bank .bd{width:min(640px,96vw);border-radius:22px;padding:18px;background:#f8fafc;box-shadow:0 30px 80px rgba(0,0,0,.5)}
#bank .top{display:flex;align-items:center;gap:10px;margin-bottom:6px} #bank .top b{font:800 18px Rajdhani,Inter;letter-spacing:1px;color:#1e3a8a} #bank .top span{font-size:12px;color:#64748b} #bank .top .x{margin-left:auto;width:32px;height:32px;border-radius:10px;border:none;background:#e2e8f0;font:700 14px Inter;cursor:pointer}
#bank p{margin:4px 0 10px;font-size:14px} #bank .notes{display:flex;flex-wrap:wrap;gap:6px;min-height:120px;padding:10px;border-radius:14px;background:#e2e8f0}
#bank .note{width:84px;height:42px;border-radius:5px;display:flex;align-items:center;justify-content:space-between;padding:0 7px;font:800 14px Rajdhani,Inter;box-shadow:0 2px 4px rgba(0,0,0,.2);cursor:pointer;position:relative;transition:transform .1s}
#bank .note:hover{transform:translateY(-2px)} #bank .note i{width:14px;height:14px;border-radius:50%;background:rgba(255,255,255,.55);box-shadow:inset 0 0 0 2px rgba(0,0,0,.08)} #bank .note.fake i{background:none;box-shadow:none} #bank .note.flag{outline:3px solid #ef4444}
#bank .row{display:flex;gap:8px;margin-top:12px;align-items:center} #bank input{flex:1;padding:11px 12px;border-radius:10px;border:1px solid #cbd5e1;font:700 16px Rajdhani,Inter;outline:none} #bank input:focus{border-color:#2563eb}
#bank button.b{padding:11px 16px;border-radius:10px;border:none;background:#2563eb;color:#fff;font:700 13px Inter;cursor:pointer} #bank button.g{background:#e2e8f0;color:#0f172a}
#bank .hint{font-size:11.5px;color:#64748b;margin-top:8px}
`;
class Bank {
  venue: Venue; private el!: HTMLElement; private people: Actor[] = []; private shift: { served: number; errors: number; pay: number; cust: { name: string; notes: { v: number; fake: boolean }[]; dep: boolean } | null } | null = null;
  constructor(private ctx: GameCtx) {
    const B = new Builder(BANK_ORIGIN); const W = 9, D = 12;
    B.floor(-W, 0, W, D, M(0xffffff, 0.35, { map: canvasTex(128, 128, (x) => { x.fillStyle = '#e8e6e1'; x.fillRect(0, 0, 128, 128); x.strokeStyle = '#cfcac0'; x.lineWidth = 2; x.strokeRect(0, 0, 64, 64); x.strokeRect(64, 64, 64, 64); }, 8) }));
    B.room(-W, 0, W, D, M(0xf1f5f9, 0.8), { side: 's', at: W, w: 2.2 }); B.sign('FIRST HUSTLE BANK', 0, 2.75, D - 0.1, Math.PI, 6, '#1e3a8a', 'rgba(0,0,0,0)');
    // teller counter with glass, four windows
    B.solid(box(12, 1.1, 0.8, M(0x1e3a8a, 0.5), 0, 0.55, 7.5), 12, 0.8, 1.1); B.add(box(12, 0.06, 0.9, M(0xf8fafc, 0.3), 0, 1.13, 7.5));
    for (let i = 0; i < 5; i++) B.add(box(0.06, 1.3, 0.06, M(0x94a3b8, 0.3, { metalness: 0.8 }), -6 + i * 3, 1.8, 7.3));
    B.add(box(12, 1.3, 0.02, new THREE.MeshStandardMaterial({ color: 0xdbeafe, transparent: true, opacity: 0.25, roughness: 0.05 }), 0, 1.8, 7.3));
    for (let i = 0; i < 4; i++) { B.add(box(0.5, 0.35, 0.05, new THREE.MeshBasicMaterial({ color: 0x22c55e, toneMapped: false }), -4.5 + i * 3, 2.6, 7.25)); }
    // queue rope, waiting chairs, ATM
    for (let i = 0; i < 6; i++) B.add(box(0.08, 0.95, 0.08, M(0xc9a227, 0.3, { metalness: 0.8 }), -2 + i * 1.2, 0.47, 4.5));
    B.add(box(6, 0.04, 0.04, M(0x7f1d1d, 0.6), 1, 0.85, 4.5));
    B.solid(box(0.9, 1.8, 0.6, M(0x334155, 0.4, { metalness: 0.5 }), -7.8, 0.9, 2), 0.9, 0.6, 1.8);
    for (const [x, z] of [[-4, 3], [4, 3], [0, 9.5], [-5, 9.5], [5, 9.5]]) { B.light(x, 2.8, z, 0xf8fafc, 6, 9); B.add(box(1.4, 0.04, 0.3, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), x, 3.0, z)); }
    const lot = B.lot({ x: 0, z: 1.6, yaw: 0 }, [{ name: 'Bank', x0: -W, z0: 0, x1: W, z1: D }], 0xf1f5f9);
    this.venue = { id: 'bank', title: 'FIRST HUSTLE BANK', sub: 'Teller jobs available · 8am to 4pm', lot, door: null, blip: '#3b82f6', label: 'Enter First Hustle Bank', cam: { d: 10, pitch: 0.95 }, things: () => this.things(), enter: () => this.enter(), exit: () => this.exit(), refuse: () => { const h = ctx.view.atmo.hour; return h < 8 || h >= 16 ? 'Banking hall opens 8am to 4pm.' : null; } };
  }
  get life() { return lifeSystem.api!; }
  init() { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); this.el = document.createElement('div'); this.el.id = 'bank'; document.body.appendChild(this.el); (window as any).__bank = this; }
  private things(): Thing[] { const O = BANK_ORIGIN; return [{ id: 'teller', name: 'Teller window', x: O.x - 4.5, z: O.z + 8.4, yaw: Math.PI, actions: [], kind: 'object', reach: 2.2, verb: 'Work a teller shift', open: () => this.start() }]; }
  private enter() { const c = this.ctx; const O = BANK_ORIGIN; this.people = []; for (let i = 0; i < 6; i++) { const a = c.sim.spawnActor('ped', { x: O.x - 1.5 + i * 1.15, y: 0.05, z: O.z + 5.2 }); a.yaw = 0; Object.assign(a as any, { _script: true, _keep: true, act: { clip: i % 3 ? 'Idle_Loop' : 'Idle_TalkingPhone_Loop', yaw: 0 } }); this.people.push(a); } for (const x of [-1.5, 1.5, 4.5]) { const lk = c.sim.randomLook(); Object.assign(lk, { topPattern: 'solid', topColor: '#1e3a8a' }); const a = c.sim.spawnActor('vendor', { x: O.x + x, y: 0.05, z: O.z + 8.6 }, lk, 'Teller'); Object.assign(a as any, { _script: true, _keep: true, _vendor: true, act: { clip: 'Idle_Loop', yaw: Math.PI } }); this.people.push(a); } }
  private exit() { for (const a of this.people) if (!(a as any)._gone) this.ctx.sim.removeActor(a); this.people = []; this.end(); }
  private start() { const c = this.ctx; c.setModal(true); c.input.releasePointer(); this.shift = { served: 0, errors: 0, pay: 0, cust: null }; (c.sim.local as any).act = { clip: 'Idle_Loop', yaw: 0 }; this.next(); }
  private next() {
    const s = this.shift!; const names = ['Mr Balogun', 'Mrs Okonkwo', 'Alhaja Sikirat', 'Pastor Uche', 'Mallam Idris', 'Tolu', 'Chinedu', 'Aunty Yemisi', 'Mr Ojo'];
    const n = 5 + Math.floor(Math.random() * (6 + s.served)); const notes = Array.from({ length: n }, () => ({ v: DEN[Math.floor(Math.random() ** 1.4 * 4)].v, fake: false })); if (Math.random() < 0.35) notes[Math.floor(Math.random() * n)].fake = true;
    s.cust = { name: names[Math.floor(Math.random() * names.length)], notes, dep: Math.random() < 0.6 }; this.draw();
  }
  private draw(note = '') {
    const s = this.shift!; const cu = s.cust!; const lvl = ((this.ctx.systems.get('skills') as any)?.level?.('trade') ?? 1) as number;
    this.el.innerHTML = `<div class="bd"><div class="top"><b>TELLER · WINDOW 2</b><span>Served ${s.served} · errors ${s.errors} · earned ₦${s.pay.toLocaleString()}</span><button class="x">✕</button></div>
      <p><b>${cu.name}</b>: "${cu.dep ? 'I want to deposit this money.' : 'Abeg count my withdrawal well.'}" ${note}</p>
      <div class="notes">${cu.notes.map((x, i) => { const d = DEN.find((k) => k.v === x.v)!; return `<div class="note ${x.fake ? 'fake' : ''}" data-i="${i}" style="background:linear-gradient(135deg,${d.c},${d.c}cc);color:${d.t}">₦${x.v}<i></i></div>`; }).join('')}</div>
      <div class="row"><input id="bk" inputmode="numeric" placeholder="Total in naira (genuine notes only)"><button class="b" id="bk-ok">Confirm</button><button class="b g" id="bk-end">End shift</button></div>
      <div class="hint">Genuine notes have the round watermark. Click a note to flag it as fake. ${lvl >= 4 ? 'Your trade sense says: count the 1000s first.' : ''}</div></div>`;
    this.el.classList.add('on');
    this.el.querySelector('.x')!.addEventListener('click', () => this.end()); this.el.querySelector('#bk-end')!.addEventListener('click', () => this.end());
    this.el.querySelectorAll('.note').forEach((d) => d.addEventListener('click', () => d.classList.toggle('flag')));
    const inp = this.el.querySelector('#bk') as HTMLInputElement; inp.focus(); inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.check(); }); this.el.querySelector('#bk-ok')!.addEventListener('click', () => this.check());
  }
  private check() {
    const s = this.shift!; const cu = s.cust!; const val = +((this.el.querySelector('#bk') as HTMLInputElement).value.replace(/[^0-9]/g, ''));
    const flagged = [...this.el.querySelectorAll('.note')].map((d, i) => d.classList.contains('flag') ? i : -1).filter((i) => i >= 0);
    const truth = cu.notes.reduce((a, x) => a + (x.fake ? 0 : x.v), 0); const fakes = cu.notes.map((x, i) => (x.fake ? i : -1)).filter((i) => i >= 0);
    const fakeOk = fakes.length === flagged.length && fakes.every((i) => flagged.includes(i)); const ok = val === truth && fakeOk;
    s.served++; if (ok) { s.pay += 1500; sfx('cash'); } else { s.errors++; s.pay = Math.max(0, s.pay - 1000); sfx('lose'); }
    (this.ctx.systems.get('skills') as any)?.addXp?.('trade', ok ? 8 : 2);
    const note = ok ? '<span style="color:#16a34a;font-weight:700">Correct.</span>' : `<span style="color:#dc2626;font-weight:700">Wrong: it was ₦${truth.toLocaleString()}${fakes.length ? ' with a fake note' : ''}. ₦1,000 off your pay.</span>`;
    this.next(); this.draw(note);
  }
  end() {
    const s = this.shift; if (!s) return; const c = this.ctx; this.shift = null; this.el.classList.remove('on'); c.setModal(false); (c.sim.local as any).act = undefined;
    if (s.pay) earn(c, Math.round(s.pay * career.mult('bank')), 'work'); career.add('bank', Math.max(0, s.served - s.errors));
    const L = this.life; L.needs.v.energy = Math.max(0, L.needs.v.energy - s.served * 1.5); L.needs.v.fun = Math.max(0, L.needs.v.fun - s.served);
    if (s.served >= 8 && s.errors === 0) addMoodlet(L.needs, 'employee', 'Employee of the day', 8, 8); else if (s.errors > 3) addMoodlet(L.needs, 'query', 'Got a query from the manager', -8, 8);
    c.hud.toast('Shift over', `${s.served} customers, ${s.errors} errors. ₦${s.pay.toLocaleString()} paid.`, 'linear-gradient(160deg,#3b82f6,#1e3a8a)', 'cash', 4.5);
  }
}
let K: Bank | null = null;
export const bankSystem: GameSystem = { id: 'bank', init(ctx) { K = new Bank(ctx); K.init(); lifeSystem.api?.addVenue(K.venue); } };
