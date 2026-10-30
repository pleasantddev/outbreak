// Commercial transport, GTA taxi style with a Lagos twist. Sit in an okada, keke, danfo or a car and press J to go on
// duty. People wave you down by the road; stop beside them, agree the fare (they always start low), carry them to
// where they are going. Smooth driving earns tips, bad driving earns insults. Agberos at the park want their dues.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import type { Actor, Vehicle } from '../../sim/types';
import { RoadNet } from '../../world/roadnet';
import { RT } from '../societyRuntime';
import { sfx } from '../leisure/sfx';
import { earn } from '../money';
import { career } from './ranks';

interface Pax { a: Actor; dest: { x: number; z: number; name: string }; fare: number; start: number; dist: number; mood: number; boarded: boolean; complain: number }
interface Hailer { a: Actor; dest: { x: number; z: number; name: string }; t: number; mark: THREE.Mesh }
const CAP: Record<string, number> = { okada: 1, keke: 3, danfo: 6, sedan: 2, hatch: 2, jeep: 3 };
const LABEL: Record<string, string> = { okada: 'Okada', keke: 'Keke', danfo: 'Danfo', sedan: 'Ride-hailing', hatch: 'Ride-hailing', jeep: 'Ride-hailing' };
const RATE: Record<string, number> = { okada: 2.2, keke: 1.8, danfo: 0.9, sedan: 3.0, hatch: 2.8, jeep: 3.4 }; // naira per metre-ish (scaled by economy)

const css = `
#fare{position:fixed;left:50%;top:22%;transform:translate(-50%,-10px);opacity:0;pointer-events:none;transition:.2s;z-index:9;width:min(420px,92vw);border-radius:20px;padding:14px 16px;background:rgba(12,14,22,.9);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(16px);font-family:Inter,sans-serif;color:#f3f5f8}
#fare.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
#fare b{font-size:14.5px} #fare p{margin:6px 0 10px;font-size:13.5px;color:#dfe3ea;line-height:1.4} #fare .o{display:flex;gap:7px} #fare button{flex:1;padding:10px 6px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:#fff;font:700 12.5px Inter;cursor:pointer}
#fare button.p{background:linear-gradient(180deg,#22c55e,#16a34a)} #fare button kbd{display:block;font:700 10px Rajdhani;opacity:.6} #fare i{font-style:normal;font-size:11.5px;color:#9ba3b4}
#duty{position:fixed;right:max(14px,env(safe-area-inset-right));top:calc(max(14px,env(safe-area-inset-top)) + 140px);z-index:5;padding:9px 12px;border-radius:14px;background:rgba(12,14,22,.62);border:1px solid rgba(255,255,255,.09);backdrop-filter:blur(12px);font:600 12px Inter,sans-serif;color:#f3f5f8;display:none;min-width:150px}
#duty.on{display:block} #duty b{display:block;font:800 13px Rajdhani,Inter;letter-spacing:1px;color:#ffc93c} #duty span{display:block;margin-top:2px}
`;
const pick = <T>(l: T[]) => l[(Math.random() * l.length) | 0];
const r50 = (n: number) => Math.max(100, Math.round(n / 50) * 50);

class Transport {
  on = false; kind = ''; pax: Pax[] = []; hail: Hailer | null = null; private t = 0; private el!: HTMLElement; private duty!: HTMLElement; private ask: { h: Hailer; offers: number[]; base: number; tries: number } | null = null;
  earned = 0; trips = 0; private lastSpeed = 0; private agbero: { a: Actor; t: number } | null = null;
  constructor(private ctx: GameCtx) {}
  init() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this.el = document.createElement('div'); this.el.id = 'fare'; document.body.appendChild(this.el);
    this.duty = document.createElement('div'); this.duty.id = 'duty'; document.body.appendChild(this.duty);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyJ' && !e.repeat) this.toggle();
      if (this.ask && /^Digit[1-3]$/.test(e.code)) { this.answer(+e.code.slice(5) - 1); e.preventDefault(); e.stopPropagation(); }
    }, true);
    (window as any).__transport = this;
  }
  private veh(): Vehicle | null { const me = this.ctx.sim.local; return me.vehicle !== null && me.seat === 0 ? this.ctx.sim.vehicles[me.vehicle] : null; }
  private scale() { const p = RT.soc?.E.p('fare_okada'); return p ? Math.max(0.6, Math.min(2.5, p / 1000)) : 1; }
  toggle() {
    const v = this.veh(); const c = this.ctx;
    if (this.on) { this.offDuty(); return; }
    if (!v || !CAP[v.kind]) { c.hud.toast('Transport', 'Sit in the driver seat of an okada, keke, danfo or car, then press J.', 'var(--pur)', 'msg', 4); return; }
    this.on = true; this.kind = v.kind; this.t = 2; this.earned = 0; this.trips = 0;
    c.hud.title(LABEL[v.kind].toUpperCase(), 'On duty. Look for people waving by the road.', 2.5); this.render();
  }
  private offDuty(msg = 'Off duty') {
    const c = this.ctx; this.on = false; this.dropHailer(); for (const p of this.pax) this.release(p.a); this.pax = []; this.closeAsk();
    if (this.trips) c.hud.toast('Shift over', `${this.trips} trip${this.trips > 1 ? 's' : ''}, ₦${this.earned.toLocaleString()} made.`, 'linear-gradient(160deg,#22c55e,#16a34a)', 'cash', 5); else c.hud.toast('Transport', msg, 'var(--pur)', 'msg', 2.5);
    this.duty.classList.remove('on');
  }
  private release(a: Actor) { const s = this.ctx.sim; if (a.vehicle !== null) s.exitVehicle(a, true); (a as any)._script = false; (a as any)._keep = false; (a as any).act = undefined; }
  private render() {
    if (!this.on) { this.duty.classList.remove('on'); return; }
    this.duty.classList.add('on');
    this.duty.innerHTML = `<b>${LABEL[this.kind].toUpperCase()} · ON DUTY</b><span>${this.pax.length}/${CAP[this.kind]} passengers</span><span>Today: ₦${this.earned.toLocaleString()} · ${this.trips} trips</span>${this.pax[0] ? `<span>Next drop: ${this.pax[0].dest.name}</span>` : ''}<span style="color:#9ba3b4">J to stop</span>`;
  }
  // ---------------------------------------------------------------- someone waves you down
  private spawnHailer() {
    const c = this.ctx; const v = this.veh()!; const t = v.body.translation(); const r = v.body.rotation(); const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    const ax = t.x + fw.x * 70, az = t.z + fw.z * 70; const ws = c.sim.net.nearWalks(ax, az, 45); if (!ws.length) return;
    const w = c.sim.net.walks[pick(ws)]; const pr = RoadNet.project(w.pts, ax, az); const at = RoadNet.at(w.pts, pr.s);
    if (Math.hypot(at.x - t.x, at.z - t.z) < 30) return;
    const dest = this.destination(at.x, at.z); if (!dest) return;
    const a = c.sim.spawnActor('ped', { x: at.x, y: 0.05, z: at.z }); Object.assign(a as any, { _script: true, _keep: true, act: { clip: 'Idle_Rail_Call', yaw: Math.atan2(t.x - at.x, t.z - at.z) } });
    const mark = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), new THREE.MeshBasicMaterial({ color: 0xffc93c, toneMapped: false })); mark.rotation.x = Math.PI; c.view.scene.add(mark);
    this.hail = { a, dest, t: 70, mark };
  }
  private destination(x: number, z: number) {
    const c = this.ctx; const want = this.kind === 'okada' ? [300, 1300] : this.kind === 'danfo' ? [500, 2500] : [500, 2000];
    for (let k = 0; k < 14; k++) {
      const ang = Math.random() * Math.PI * 2, d = want[0] + Math.random() * (want[1] - want[0]); const px = x + Math.sin(ang) * d, pz = z + Math.cos(ang) * d;
      const ws = c.sim.net.nearWalks(px, pz, 60); if (!ws.length) continue; const w = c.sim.net.walks[ws[0]]; const at = RoadNet.at(w.pts, RoadNet.project(w.pts, px, pz).s);
      return { x: at.x, z: at.z, name: RT.placeName?.(at.x, at.z) ?? 'down the road' };
    }
    return null;
  }
  private dropHailer() { if (!this.hail) return; this.hail.mark.removeFromParent(); this.release(this.hail.a); this.hail = null; }
  // ---------------------------------------------------------------- the fare talk
  private openAsk(h: Hailer) {
    const c = this.ctx; const me = c.sim.local; const d = Math.hypot(h.dest.x - me.pos.x, h.dest.z - me.pos.z) * 1.3;
    const base = r50(d * RATE[this.kind] * this.scale() * (this.ctx.view.atmo.hour > 21 || this.ctx.view.atmo.hour < 5 ? 1.4 : 1) * (RT.soc && (this.ctx.view.atmo as any).rain ? 1.2 : 1));
    const theirs = r50(base * (0.55 + Math.random() * 0.2));
    this.ask = { h, offers: [theirs, r50(base), r50(base * 1.45)], base, tries: 0 };
    const opener = this.kind === 'danfo' ? `${h.dest.name}? How much?` : pick([`Oga, ${h.dest.name}. ₦${theirs.toLocaleString()}.`, `${h.dest.name}, I go pay ₦${theirs.toLocaleString()}.`, `Abeg ${h.dest.name}, na ₦${theirs.toLocaleString()} I get.`]);
    c.hud.say(h.a.name, opener, 3); this.renderAsk(opener);
  }
  private renderAsk(line: string) {
    const k = this.ask!; const [a, b, cc] = k.offers;
    this.el.innerHTML = `<b>${k.h.a.name} · to ${k.h.dest.name}</b><p>"${line}"</p><div class="o"><button class="p" data-i="0">Oya enter<br>₦${a.toLocaleString()}<kbd>1</kbd></button><button data-i="1">Add small<br>₦${b.toLocaleString()}<kbd>2</kbd></button><button data-i="2">Na ₦${cc.toLocaleString()}<kbd>3</kbd></button></div><i>${Math.round(Math.hypot(k.h.dest.x - k.h.a.pos.x, k.h.dest.z - k.h.a.pos.z) / 100) / 10} km. Night and rain push prices up. Ask too much and they walk.</i>`;
    this.el.classList.add('on'); this.el.querySelectorAll('[data-i]').forEach((x) => x.addEventListener('click', () => this.answer(+(x as HTMLElement).dataset.i!)));
  }
  private closeAsk() { this.ask = null; this.el.classList.remove('on'); }
  private answer(i: number) {
    const k = this.ask; if (!k) return; const c = this.ctx; const price = k.offers[i]; k.tries++;
    const charm = ((c.systems.get('skills') as any)?.level?.('charm') ?? 1) as number;
    const p = i === 0 ? 1 : i === 1 ? 0.7 + charm * 0.02 : 0.28 + charm * 0.02;
    if (Math.random() < p) { this.closeAsk(); this.board(k.h, price); c.hud.say(k.h.a.name, i === 0 ? 'Thank you o.' : i === 1 ? pick(['Okay, no wahala.', 'Ehn, make we go.']) : pick(['Hmm, okay. But drive well o.', 'Ah! Okay, I dey hurry.']), 2.5); return; }
    if (k.tries >= 2 || i === 2) { c.hud.say(k.h.a.name, pick(['Ehn? I no fit pay that one. Make I find another.', 'Na robbery be this. Go well.', 'God forbid! I go trek.']), 3); this.closeAsk(); const h = this.hail; this.hail = null; if (h) { h.mark.removeFromParent(); this.release(h.a); } this.t = 6; return; }
    k.offers = [r50((k.offers[0] + k.offers[1]) / 2), k.offers[1], k.offers[2]]; this.renderAsk(pick([`Make e be ₦${k.offers[0].toLocaleString()} now.`, `Last last, ₦${k.offers[0].toLocaleString()}.`]));
  }
  private board(h: Hailer, fare: number) {
    const c = this.ctx; const v = this.veh(); if (!v) return; h.mark.removeFromParent(); (h.a as any).act = undefined;
    const ok = c.sim.enterVehicle(h.a, v, false); if (!ok) { this.release(h.a); this.hail = null; return; }
    const me = c.sim.local; const dist = Math.hypot(h.dest.x - me.pos.x, h.dest.z - me.pos.z);
    this.pax.push({ a: h.a, dest: h.dest, fare, start: c.view.time, dist, mood: 1, boarded: true, complain: 0 }); this.hail = null; this.t = this.pax.length < CAP[this.kind] ? 8 : 1e9; this.render();
  }
  // ---------------------------------------------------------------- per frame
  frame(dt: number) {
    { const v0 = this.veh(); this.ctx.hud.tcFlag?.('duty', !!(v0 && CAP[v0.kind])); this.ctx.hud.tcFlag?.('onduty', this.on); }
    if (!this.on) return; const c = this.ctx; const v = this.veh();
    if (!v || v.kind !== this.kind) { this.offDuty('You left the vehicle. Off duty.'); return; }
    const sp = Math.abs(v.ctrl.currentVehicleSpeed()); const t = v.body.translation();
    // rough driving: a sudden stop (a crash) upsets everybody on board
    if (this.lastSpeed - sp > 7 * Math.max(dt * 10, 1) && this.pax.length) { for (const p of this.pax) { p.mood -= 0.25; p.complain++; } const p = this.pax[0]; c.hud.say(p.a.name, pick(['Ehn! You wan kill me?', 'Driver, you dey craze?', 'Jesus! Slow down!', 'Na so you dey drive? I go report you.']), 3); }
    if (sp > 22 && this.pax.length && Math.random() < dt * 0.15) { const p = pick(this.pax); p.mood -= 0.05; c.hud.say(p.a.name, pick(['Take am easy o!', 'No be race we dey!', 'My life get value o.']), 2.5); }
    this.lastSpeed = sp;
    // new fares
    this.t -= dt; if (!this.hail && !this.ask && this.pax.length < CAP[this.kind] && this.t <= 0) { this.spawnHailer(); this.t = 10; }
    const h = this.hail;
    if (h) {
      h.t -= dt; h.mark.position.set(h.a.pos.x, h.a.pos.y + 2.4 + Math.sin(c.view.time * 4) * 0.12, h.a.pos.z); h.mark.rotation.y += dt * 2;
      const d = Math.hypot(h.a.pos.x - t.x, h.a.pos.z - t.z);
      if (d < 7 && sp < 2 && !this.ask) this.openAsk(h);
      if (this.ask && d > 12) this.closeAsk();
      if (h.t <= 0 || d > 220) { this.dropHailer(); this.t = 4; }
    }
    // drop offs
    for (const p of [...this.pax]) {
      if (p.a.vehicle === null || !p.a.alive) { this.pax.splice(this.pax.indexOf(p), 1); this.render(); continue; }
      if (Math.hypot(p.dest.x - t.x, p.dest.z - t.z) < 16 && sp < 1.5) this.dropOff(p);
    }
    this.agberoTick(dt, sp, t);
    if (Math.random() < dt * 2) this.render();
  }
  private dropOff(p: Pax) {
    const c = this.ctx; const mins = (c.view.time - p.start) / 60; const fair = p.dist / 9 / 60; // about 9 m/s is a decent Lagos average
    const speedy = mins < fair * 1.1 ? 0.15 : mins > fair * 2 ? -0.15 : 0; const mood = Math.max(0, Math.min(1.3, p.mood + speedy));
    const tip = mood > 1 ? r50(p.fare * 0.15) : 0; const pay = mood < 0.4 ? r50(p.fare * 0.7) : p.fare;
    c.sim.exitVehicle(p.a); this.release(p.a); this.pax.splice(this.pax.indexOf(p), 1);
    earn(c, Math.round((pay + tip) * career.mult('transport')), 'fare'); career.add('transport'); sfx('cash');
    this.earned += pay + tip; this.trips++;
    c.hud.say(p.a.name, mood < 0.4 ? pick(['See as you drive! Take this one, na all I go pay.', 'I no go pay full. You nearly kill me.']) : tip ? pick(['You try well, take extra.', 'Correct driver! Keep the change.']) : pick(['Thank you o.', 'Na here. God bless.', 'Okay, see you.']), 3);
    (c.systems.get('skills') as any)?.addXp?.(this.kind === 'okada' ? 'ride' : 'drive', Math.round(8 + p.dist / 120));
    this.t = 4; this.render();
  }
  /** at a park or bus stop, an agbero steps out for "union dues" */
  private agberoTick(dt: number, sp: number, t: { x: number; z: number }) {
    const c = this.ctx; const g = this.agbero;
    if (!g) { if (this.kind !== 'sedan' && this.kind !== 'jeep' && this.kind !== 'hatch' && sp < 3 && Math.random() < dt * 0.006) { const a = c.sim.spawnActor('area', { x: t.x + 3, y: 0.05, z: t.z + 2 }, undefined, 'Agbero'); Object.assign(a as any, { _script: true, _keep: true, act: { clip: 'Idle_Rail_Call', yaw: 0 } }); this.agbero = { a, t: 25 }; c.hud.say('Agbero', 'Driver! Union money! ₦500, sharp sharp!', 4); c.hud.toast('Agbero', 'Stop and press 1 to pay ₦500. Drive off and he may follow you with wahala.', 'linear-gradient(160deg,#fb923c,#c2410c)', 'msg', 5); } return; }
    g.t -= dt; const d = Math.hypot(g.a.pos.x - t.x, g.a.pos.z - t.z);
    const done = () => { (g.a as any)._script = false; (g.a as any)._keep = false; (g.a as any).act = undefined; this.agbero = null; };
    if (g.t <= 0 || d > 40) { if (d > 40) { c.hud.say('Agbero', 'You go see me! I know your face!', 3); if (RT.nem && (g.a as any).cid !== undefined) { const cit = RT.soc?.get((g.a as any).cid); if (cit) RT.nem.remember(cit, 'hurt', g.a.pos, 'refused union dues', 0.3); } } done(); return; }
    if (d < 7 && sp < 1.5 && !this.ask) {
      if (!this.el.classList.contains('on')) { this.el.innerHTML = `<b>Agbero</b><p>"Union money! ₦500. You no wan pay? Okay o."</p><div class="o"><button class="p" data-a="pay">Pay ₦500<kbd>1</kbd></button><button data-a="beg">Beg him<kbd>2</kbd></button><button data-a="no">Refuse<kbd>3</kbd></button></div>`; this.el.classList.add('on');
        const act = (k: string) => { this.el.classList.remove('on'); if (k === 'pay' && c.sim.cash >= 500) { c.sim.cash -= 500; c.hud.say('Agbero', 'Ehen! Correct driver. Go!', 2.5); } else if (k === 'beg' && Math.random() < 0.4) c.hud.say('Agbero', 'Hmm. Today na free. Next time, pay.', 3); else { c.hud.say('Agbero', 'You dey whine me? Come down!', 3); const b = c.sim.brainOf(g.a.id); (g.a as any)._script = false; (g.a as any).act = undefined; if (b) { b.kind = 'fight'; b.target = c.sim.local.id; } } done(); removeEventListener('keydown', kd, true); };
        const kd = (e: KeyboardEvent) => { const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code); if (i >= 0) { e.preventDefault(); e.stopPropagation(); act(['pay', 'beg', 'no'][i]); } }; addEventListener('keydown', kd, true);
        this.el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => act((b as HTMLElement).dataset.a!)));
      }
    }
  }
  goal() { if (!this.on) return null; if (this.pax.length) { const t = this.ctx.sim.local.pos; const p = [...this.pax].sort((a, b) => Math.hypot(a.dest.x - t.x, a.dest.z - t.z) - Math.hypot(b.dest.x - t.x, b.dest.z - t.z))[0]; return { x: p.dest.x, z: p.dest.z, label: p.dest.name } as any; } if (this.hail) return { x: this.hail.a.pos.x, z: this.hail.a.pos.z, label: 'Passenger' } as any; return null; }
  prompt() { const v = this.veh(); if (!this.on && v && CAP[v.kind] && Math.abs(v.ctrl.currentVehicleSpeed()) < 4) return `<kbd>J</kbd>Go on duty (${LABEL[v.kind]})`; return null; }
  blips(out: { x: number; z: number; c: string; r?: number }[]) { if (this.hail) out.push({ x: this.hail.a.pos.x, z: this.hail.a.pos.z, c: '#ffc93c', r: 6 }); for (const p of this.pax) out.push({ x: p.dest.x, z: p.dest.z, c: '#22c55e', r: 7 }); }
}

let T: Transport | null = null;
export const transportSystem: GameSystem & { get api(): Transport | null } = {
  id: 'transport',
  get api() { return T; },
  init(ctx) { T = new Transport(ctx); T.init(); },
  frame(_c, dt) { T?.frame(dt); },
  goal() { return T?.goal() ?? null; },
  prompt() { return T?.prompt() ?? null; },
  blips(_c, out) { T?.blips(out); },
};
