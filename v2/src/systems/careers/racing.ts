// Street racing. After dark, cars gather at meet spots on the big roads. Roll up in a car, pick a race and put money
// down: Sprint (point to point across the city), Circuit (two laps of a loop) or Drag (400 m, all about the launch).
// Checkpoint rings on the route, three AI rivals with their own personalities, a launch-timing boost, and the risk
// that the police come to shut it down.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import type { Actor, Command, Vehicle } from '../../sim/types';
import { emptyCommand } from '../../sim/types';
import { VEHICLES, type VehicleKind } from '../../data/balance';
import type { RoadGraph } from '../../world/roadgraph';
import { RT } from '../societyRuntime';
import { sfx } from '../leisure/sfx';
import { earn, online } from '../money';
import { net } from '../../net/client';
import { career } from './ranks';

type RaceType = 'sprint' | 'circuit' | 'drag';
interface Meet { x: number; z: number; yaw: number; name: string; ax: number; az: number }
interface Rival { name: string; v: Vehicle; drv: Actor; skill: number; aggr: number; s: number; lap: number; done: number; idx: number; stuck?: number; rev?: number; lost?: number }
interface Race { mp?: boolean; goReal?: number; type: RaceType; pts: number[]; cum: number[]; len: number; laps: number; checks: number[]; next: number; lap: number; rivals: Rival[]; wager: number; t0: number; go: number; meet: Meet; finish: number; playerS: number; launch: number; done: boolean; rings: THREE.Mesh[]; arch: THREE.Group | null; police: boolean }

const RIVALS = [{ name: 'Tunde "Tokunbo King"', skill: 0.92, aggr: 0.7 }, { name: 'Ada Speed', skill: 0.97, aggr: 0.4 }, { name: 'Small Doctor Wheels', skill: 0.86, aggr: 0.9 }, { name: 'Baba Nitro', skill: 1.0, aggr: 0.6 }, { name: 'Kemi Drift', skill: 0.95, aggr: 0.5 }];
const KINDS: VehicleKind[] = ['sedan', 'hatch', 'jeep'];
const css = `
#race{position:fixed;left:50%;top:max(16px,env(safe-area-inset-top));transform:translateX(-50%);z-index:6;display:none;gap:18px;align-items:center;padding:8px 16px;border-radius:16px;background:rgba(12,14,22,.66);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(12px);font:700 13px Inter,sans-serif;color:#f3f5f8}
#race.on{display:flex} #race b{font:800 30px Rajdhani,Inter;line-height:1} #race span{display:block;font-size:10.5px;color:#9ba3b4;letter-spacing:1px}
#rsel{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translate(-50%,20px);opacity:0;pointer-events:none;transition:.2s;z-index:9;width:min(560px,94vw);border-radius:22px;padding:16px 18px;background:rgba(12,14,22,.9);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(16px);font-family:Inter,sans-serif;color:#f3f5f8}
#rsel.on{opacity:1;transform:translate(-50%,0);pointer-events:auto} #rsel h3{margin:0 0 4px;font:800 20px Rajdhani,Inter;letter-spacing:1px;color:#ff7043} #rsel p{margin:0 0 12px;font-size:12.5px;color:#9ba3b4}
#rsel .g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px} #rsel button{padding:12px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;font:700 13px Inter;cursor:pointer;text-align:left}
#rsel button.sel{background:rgba(255,112,67,.25);border-color:#ff7043} #rsel button i{display:block;font-style:normal;font-size:11px;color:#9ba3b4;font-weight:600;margin-top:3px} #rsel .go{display:flex;gap:8px;margin-top:12px} #rsel .go button{text-align:center;flex:1}
#rsel .go button.p{background:linear-gradient(180deg,#ff7043,#e64a19);border-color:#ffab91}
`;
const pick = <T>(l: T[]) => l[(Math.random() * l.length) | 0];
const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const fwOf = (v: Vehicle) => { const r = v.body.rotation(); return { x: 2 * (r.x * r.z + r.w * r.y), z: 1 - 2 * (r.x * r.x + r.y * r.y) }; };

class Racing {
  meets: Meet[] = []; race: Race | null = null; private el!: HTMLElement; private sel!: HTMLElement; private crowd: Actor[] = []; private parked: Vehicle[] = []; private meetMesh: THREE.Group[] = [];
  private choice: { type: RaceType; wager: number } = { type: 'sprint', wager: 20000 }; private placeT = 2; cred = 0; private wantGo = false;
  constructor(private ctx: GameCtx) {}
  get graph() { return (this.ctx as any).graph as RoadGraph | undefined; }
  init() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this.el = document.createElement('div'); this.el.id = 'race'; document.body.appendChild(this.el);
    this.sel = document.createElement('div'); this.sel.id = 'rsel'; document.body.appendChild(this.sel);
    const sv = this.ctx.save.racing as { cred?: number } | undefined; this.cred = sv?.cred ?? 0;
    net.on('lobby', (m: any) => this.onLobby(m));
    addEventListener('keydown', (e) => { if (!this.sel.classList.contains('on')) return; if (e.code === 'Escape') this.closeSel(); if (e.code === 'Enter') this.start(); }, true);
    (window as any).__racing = this;
  }
  private night() { const h = this.ctx.view.atmo.hour; return h >= 19 || h < 4.5; }
  private persist() { this.ctx.save.racing = { cred: this.cred }; this.ctx.persist(); }
  // ---------------------------------------------------------------- meet spots on long straight stretches of big road
  /** Meet spots come from the map, not from the player: long straight stretches of big road picked by a hash of their
   *  position, so every player in the session sees the same meets (and can race each other there). */
  private placeMeets() {
    const c = this.ctx; const me = c.sim.local; const out: Meet[] = [];
    for (const r of c.store.regions.values()) for (const rd of r.roads) {
      if (rd.cls > 4 || rd.flags & 4) continue;
      for (let i = 0; i < rd.pts.length - 2; i += 2) {
        const ax = rd.pts[i], az = rd.pts[i + 1], bx = rd.pts[i + 2], bz = rd.pts[i + 3]; const L = Math.hypot(bx - ax, bz - az); if (L < 90) continue;
        const mx = Math.round((ax + bx) / 2), mz = Math.round((az + bz) / 2); let h = 2166136261; for (const ch of `${mx}:${mz}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
        if ((h >>> 0) % 4 !== 0) continue; if (out.some((m) => Math.hypot(m.ax - mx, m.az - mz) < 600)) continue;
        const yaw = Math.atan2(bx - ax, bz - az); const nx = Math.cos(yaw), nz = -Math.sin(yaw);
        out.push({ x: mx + nx * 14, z: mz + nz * 14, yaw, name: RT.placeName?.(mx, mz) ?? 'the expressway', ax: mx, az: mz });
      }
    }
    out.sort((a, b) => Math.hypot(a.ax - me.pos.x, a.az - me.pos.z) - Math.hypot(b.ax - me.pos.x, b.az - me.pos.z));
    const next = out.slice(0, 8); if (next.map((m) => m.ax + ':' + m.az).join() !== this.meets.map((m) => m.ax + ':' + m.az).join()) { for (const g of this.meetMesh) g?.removeFromParent(); this.meetMesh = []; this.meets = next; }
  }
  private dressMeets() {
    const c = this.ctx; const me = c.sim.local; const night = this.night();
    for (const [i, m] of this.meets.entries()) {
      let g = this.meetMesh[i]; const d = Math.hypot(m.x - me.pos.x, m.z - me.pos.z);
      if (!g) { g = new THREE.Group(); const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.12, 8, 48), new THREE.MeshBasicMaterial({ color: 0xff7043, toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; g.add(ring); const l = new THREE.PointLight(0xff7043, 10, 18, 1.6); l.position.y = 3; g.add(l); g.position.set(m.ax, 0, m.az); c.view.scene.add(g); this.meetMesh[i] = g; }
      g.visible = night && d < 400 && !this.race;
      if (night && d < 120 && !this.race && !this.crowd.length) this.spawnCrowd(m);
    }
    if ((!night || this.race) && this.crowd.length) this.clearCrowd();
    if (this.crowd.length && this.meets.every((m) => Math.hypot(m.x - me.pos.x, m.z - me.pos.z) > 160)) this.clearCrowd();
  }
  private spawnCrowd(m: Meet) {
    const c = this.ctx; const nx = Math.cos(m.yaw), nz = -Math.sin(m.yaw), fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
    for (let i = 0; i < 3; i++) { const v = c.sim.addVehicle(pick(KINDS), { x: m.x + fx * (i * 6 - 6) + nx * 2, y: 0.1, z: m.z + fz * (i * 6 - 6) + nz * 2 }, m.yaw, true); (v as any)._keep = true; this.parked.push(v); }
    for (let i = 0; i < 8; i++) { const a = c.sim.spawnActor('ped', { x: m.x + fx * (Math.random() * 16 - 8) + nx * (4.5 + Math.random() * 2), y: 0.05, z: m.z + fz * (Math.random() * 16 - 8) + nz * (4.5 + Math.random() * 2) }); Object.assign(a as any, { _script: true, _keep: true, act: { clip: pick(['Idle_Loop', 'Idle_Talking_Loop', 'Dance_Loop', 'Idle_FoldArms_Loop']), yaw: m.yaw + Math.PI / 2 + (Math.random() - 0.5) } }); this.crowd.push(a); }
  }
  private clearCrowd() { const s = this.ctx.sim; for (const a of this.crowd) if (!(a as any)._gone) s.removeActor(a); for (const v of this.parked) (v as any)._keep = false; this.crowd = []; this.parked = []; }
  private nearMeet() { const me = this.ctx.sim.local; if (me.vehicle === null || !this.night() || this.race) return null; const t = this.ctx.sim.vehicles[me.vehicle].body.translation(); return this.meets.find((m) => Math.hypot(m.ax - t.x, m.az - t.z) < 9) ?? null; }

  // ---------------------------------------------------------------- picking a race
  openSel(m: Meet) {
    const c = this.ctx; c.setModal(true); this.sel.classList.add('on');
    const types: [RaceType, string, string][] = [['sprint', 'Sprint', 'Point to point, about 2 km'], ['circuit', 'Circuit', 'Two laps of a loop'], ['drag', 'Drag', '400 m. Launch on GO.']];
    const wagers = [5000, 20000, 100000, 500000].filter((w) => w <= 20000 || this.cred >= (w >= 500000 ? 8 : 3));
    const draw = () => {
      this.sel.innerHTML = `<h3>STREET RACE · ${m.name.toUpperCase()}</h3><p>Street cred ${this.cred}. Winner takes the pot (house keeps 20%). Second gets their money back. Police sometimes show up.</p>
      <div class="g">${types.map(([k, l, i]) => `<button data-t="${k}" class="${this.choice.type === k ? 'sel' : ''}">${l}<i>${i}</i></button>`).join('')}</div>
      <div class="g" style="grid-template-columns:repeat(4,1fr);margin-top:8px">${wagers.map((w) => `<button data-w="${w}" class="${this.choice.wager === w ? 'sel' : ''}">₦${w >= 1000 ? (w / 1000).toLocaleString() + 'k' : w}<i>Pot ₦${Math.round(w * 4 * 0.8 / 1000)}k</i></button>`).join('')}</div>
      <div class="go"><button data-a="x">Not now</button>${online() ? `<button data-a="mp" ${c.sim.cash < this.choice.wager ? 'disabled' : ''}>Race real players<i>Open or join the lobby here</i></button>` : ''}<button class="p" data-a="go" ${c.sim.cash < this.choice.wager ? 'disabled' : ''}>Race the locals · ₦${this.choice.wager.toLocaleString()}<i>Enter</i></button></div>`;
      this.sel.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { this.choice.type = (b as HTMLElement).dataset.t as RaceType; draw(); }));
      this.sel.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => { this.choice.wager = +(b as HTMLElement).dataset.w!; draw(); }));
      this.sel.querySelector('[data-a=x]')!.addEventListener('click', () => this.closeSel()); this.sel.querySelector('[data-a=go]')!.addEventListener('click', () => this.start()); this.sel.querySelector('[data-a=mp]')?.addEventListener('click', () => this.joinLobby(m));
    };
    (this as any)._m = m; draw();
  }
  closeSel() { this.sel.classList.remove('on'); this.ctx.setModal(false); }

  // ---------------------------------------------------------------- building the course
  private course(m: Meet, type: RaceType, rand: () => number = Math.random): { pts: number[]; laps: number } | null {
    const g = this.graph; const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
    if (type === 'drag') { const pts: number[] = []; for (let s = 0; s <= 420; s += 20) pts.push(m.ax + fx * s, m.az + fz * s); return { pts, laps: 1 }; }
    if (!g) return null;
    for (let i = 0; i < 80 && g.sync(this.ctx.store.regions.values()); i++) { /* build the graph for the loaded regions */ }
    const leg = (x0: number, z0: number, x1: number, z1: number) => g.route(x0, z0, x1, z1, 'drive')?.pts ?? null;
    if (type === 'sprint') { for (let k = 0; k < 8; k++) { const a = m.yaw + (rand() - 0.5) * 1.4; const d = 1600 + rand() * 900; const p = leg(m.ax, m.az, m.ax + Math.sin(a) * d, m.az + Math.cos(a) * d); if (p && p.length > 20) return { pts: p, laps: 1 }; } return null; }
    for (let k = 0; k < 8; k++) {
      const r = 260 + rand() * 200; const a0 = m.yaw; const P = [[m.ax, m.az], [m.ax + Math.sin(a0) * r * 1.6, m.az + Math.cos(a0) * r * 1.6], [m.ax + Math.sin(a0 + 1.2) * r * 1.3, m.az + Math.cos(a0 + 1.2) * r * 1.3]];
      const out: number[] = []; let ok = true; for (let i = 0; i < 3; i++) { const p = leg(P[i][0], P[i][1], P[(i + 1) % 3][0], P[(i + 1) % 3][1]); if (!p) { ok = false; break; } out.push(...(out.length ? p.slice(2) : p)); }
      if (ok && out.length > 30) return { pts: out, laps: 2 };
    }
    return null;
  }
  start() {
    const c = this.ctx; const m = (this as any)._m as Meet; const me = c.sim.local; if (me.vehicle === null) return this.closeSel();
    if (c.sim.cash < this.choice.wager) { c.hud.toast('Race', `You need ₦${this.choice.wager.toLocaleString()} to enter.`, 'var(--red)', 'cash', 3); return; } const course = this.course(m, this.choice.type);
    if (!course) { c.hud.toast('Race', 'The boys no fit agree on a route. Try another race.', 'var(--red)', 'msg', 3); return; }
    this.closeSel();
    if (online()) { this.pending = true; void net.act('race.enter', { wager: this.choice.wager, rivals: this.choice.type === 'drag' ? 1 : 3 }).then((r) => { this.pending = false; if (!r.ok) { c.hud.toast('Race', r.err ?? 'The organiser refused your money.', 'var(--red)', 'msg', 3); return; } this.go(m, course); }); return; }
    c.sim.cash -= this.choice.wager; c.sim.events.push({ t: 'cash', actor: me.id, amount: -this.choice.wager } as any);
    this.go(m, course);
  }
  private pending = false;
  // ---------------------------------------------------------------- races between real players (server runs the lobby and the pot)
  lobby: any = null; private lobbyMeet: Meet | null = null; private lobEl: HTMLElement | null = null;
  private keyOf(m: Meet) { return `meet:${m.ax}:${m.az}`; }
  private async joinLobby(m: Meet) {
    const c = this.ctx; this.closeSel(); const r = await net.act('race.join', { key: this.keyOf(m), x: m.ax, z: m.az, type: this.choice.type, wager: this.choice.wager });
    if (!r.ok) { c.hud.toast('Race', r.err ?? 'Could not join.', 'var(--red)', 'msg', 3); return; }
    this.lobbyMeet = m; this.onLobby(r.lobby);
  }
  private drawLobby() {
    const l = this.lobby; if (!this.lobEl) { this.lobEl = document.createElement('div'); this.lobEl.id = 'rlob'; this.lobEl.style.cssText = 'position:fixed;left:max(22px,env(safe-area-inset-left));top:24%;z-index:8;width:min(320px,80vw);border-radius:14px;overflow:hidden;font-family:Inter,sans-serif;color:#f3f5f8;background:rgba(8,10,16,.86);backdrop-filter:blur(10px)'; document.body.appendChild(this.lobEl); }
    if (!l) { this.lobEl.remove(); this.lobEl = null; return; }
    const meId = (net as any).account?.id; const host = l.host === meId;
    this.lobEl.innerHTML = `<div style="padding:12px 14px;background:linear-gradient(135deg,#ff7043,#bf360c)"><b style="font:800 17px Rajdhani,Inter;letter-spacing:.6px">${l.type.toUpperCase()} · ₦${l.wager.toLocaleString()} EACH</b><div style="font-size:11.5px;opacity:.85">${l.state === 'open' ? 'Waiting for racers. Host starts it.' : l.state === 'countdown' ? 'Get ready...' : l.state === 'racing' ? 'Racing' : 'Finished'}</div></div>`
      + `<div style="padding:6px 0">${l.members.map((m: any, i: number) => `<div style="display:flex;gap:10px;padding:7px 14px;font-size:13px"><span style="color:#9ba3b4;width:14px">${i + 1}</span><b style="flex:1;font-weight:600">${m.name}${m.id === l.host ? ' <span style="color:#ffab91;font-size:11px">HOST</span>' : ''}</b><span style="color:#9ba3b4">${m.ms ? (m.ms / 1000).toFixed(2) + 's' : m.dnf ? 'DNF' : ''}</span></div>`).join('')}</div>`
      + (l.state === 'open' ? `<div style="display:flex;gap:8px;padding:8px 12px 12px">${host ? `<button data-a="start" style="flex:1;padding:10px;border-radius:10px;border:none;background:#ff7043;color:#fff;font:700 13px Inter;cursor:pointer" ${l.members.length < 2 ? 'disabled' : ''}>Start (${l.members.length})</button>` : ''}<button data-a="leave" style="flex:1;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#fff;font:700 13px Inter;cursor:pointer">Leave (refund)</button></div>` : '');
    this.lobEl.querySelector('[data-a=start]')?.addEventListener('click', () => { const m = this.lobbyMeet!; const crs = this.course(m, l.type, Math.random); void net.act('race.start', { len: crs ? this.lenOf(crs.pts) * crs.laps : 1500 }).then((r) => { if (!r.ok) this.ctx.hud.toast('Race', r.err ?? 'Could not start.', 'var(--red)', 'msg', 3); }); });
    this.lobEl.querySelector('[data-a=leave]')?.addEventListener('click', () => { void net.act('race.leave'); this.lobby = null; this.drawLobby(); });
  }
  private lenOf(pts: number[]) { let L = 0; for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]); return L; }
  onLobby(l: any) {
    const c = this.ctx; const prev = this.lobby; this.lobby = l; this.drawLobby();
    if (l.results) { const meId = (net as any).account?.id; const mine = l.results.find((x: any) => x.id === meId); const n = l.members.length;
      if (mine?.place === 1) { this.cred++; career.add('racer'); c.hud.title('YOU WIN', `₦${Math.round(l.wager * n * 0.8).toLocaleString()} from the pot · street cred ${this.cred}`, 4); sfx('win'); }
      else c.hud.title(mine ? `${mine.place}${mine.place === 2 ? 'ND' : mine.place === 3 ? 'RD' : 'TH'} PLACE` : 'DID NOT FINISH', l.results[0] ? `${l.results[0].name} took the pot` : '', 3.5);
      this.lobby = null; setTimeout(() => this.drawLobby(), 6000); this.persist(); return; }
    if (l.state === 'countdown' && prev?.state !== 'countdown' && this.lobbyMeet) {
      let seed = l.seed >>> 0; const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const crs = this.course(this.lobbyMeet, l.type, rand); if (!crs) { void net.act('race.leave'); c.hud.toast('Race', 'Could not build the course here.', 'var(--red)', 'msg', 3); return; }
      const meId = (net as any).account?.id; const slot = Math.max(0, l.members.findIndex((m: any) => m.id === meId));
      this.choice.type = l.type; this.choice.wager = l.wager; this.go(this.lobbyMeet, crs, { slot, startIn: (l.startIn ?? 5000) / 1000 });
    }
  }
  private go(m: Meet, course: { pts: number[]; laps: number }, mp?: { slot: number; startIn: number }) {
    const c = this.ctx; const me = c.sim.local; if (me.vehicle === null) return; this.clearCrowd();
    const pts = course.pts; const cum = [0]; for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
    const len = cum[cum.length - 1]; const checks: number[] = []; const step = this.choice.type === 'drag' ? 1e9 : 160; let lastS = 0; for (let i = 1; i < cum.length; i++) if (cum[i] - lastS > step) { checks.push(i); lastS = cum[i]; } checks.push(cum.length - 1);
    // grid: two rows behind the line
    const fx = pts[2] - pts[0], fz = pts[3] - pts[1]; const fl = Math.hypot(fx, fz) || 1; const ux = fx / fl, uz = fz / fl, rx = uz, rz = -ux; const yaw = Math.atan2(ux, uz);
    const slot = (i: number) => ({ x: pts[0] - ux * (4 + Math.floor(i / 2) * 8) + rx * (i % 2 ? 2.4 : -2.4), z: pts[1] - uz * (4 + Math.floor(i / 2) * 8) + rz * (i % 2 ? 2.4 : -2.4) });
    const pv = c.sim.vehicles[me.vehicle]; const p0 = slot(mp ? mp.slot : 0); const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    pv.body.setTranslation({ x: p0.x, y: 0.8, z: p0.z }, true); pv.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true); pv.body.setLinvel({ x: 0, y: 0, z: 0 }, true); pv.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const rivals: Rival[] = []; const pool = mp ? [] : [...RIVALS].sort(() => Math.random() - 0.5).slice(0, this.choice.type === 'drag' ? 1 : 3);
    pool.forEach((r, i) => { const p = slot(i + 1); const v = c.sim.addVehicle(pick(KINDS), { x: p.x, y: 0.1, z: p.z }, yaw, false); (v as any)._keep = true; const drv = c.sim.spawnActor('driver', { x: p.x, y: 0.1, z: p.z }, undefined, r.name); (drv as any)._keep = true; c.sim.enterVehicle(drv, v, true);
      const rv: Rival = { name: r.name, v, drv, skill: r.skill * (0.97 + this.cred * 0.004), aggr: r.aggr, s: 0, lap: 0, done: 0, idx: 0 }; (drv as any)._ai = (veh: Vehicle, dt: number) => this.aiDrive(rv, veh, dt); rivals.push(rv); });
    const rings: THREE.Mesh[] = []; for (const ci of checks) { const ring = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.22, 8, 40), new THREE.MeshBasicMaterial({ color: 0xff7043, toneMapped: false, transparent: true, opacity: 0.85 })); const j = ci * 2; const a = Math.atan2(pts[j] - pts[j - 2 >= 0 ? j - 2 : 0], pts[j + 1] - pts[j - 1 >= 0 ? j - 1 : 1]); ring.position.set(pts[j], 4.2, pts[j + 1]); ring.rotation.y = a; ring.visible = false; c.view.scene.add(ring); rings.push(ring); }
    const arch = new THREE.Group(); const fin = (course.laps > 1 ? 0 : pts.length - 2); const archM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }); for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), archM); p.position.set(s * 7, 3, 0); arch.add(p); } const top = new THREE.Mesh(new THREE.BoxGeometry(14.4, 1.0, 0.4), new THREE.MeshBasicMaterial({ map: (() => { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 40; const k = cv.getContext('2d')!; for (let i = 0; i < 26; i++) for (let j = 0; j < 2; j++) { k.fillStyle = (i + j) % 2 ? '#000' : '#fff'; k.fillRect(i * 20, j * 20, 20, 20); } const t = new THREE.CanvasTexture(cv); return t; })(), toneMapped: false })); top.position.y = 6; arch.add(top);
    arch.position.set(pts[fin], 0, pts[fin + 1]); arch.rotation.y = Math.atan2(pts[fin + 2 < pts.length ? fin + 2 : fin] - pts[fin - 2 >= 0 ? fin - 2 : fin], pts[fin + 3 < pts.length ? fin + 3 : fin + 1] - pts[fin - 1 >= 0 ? fin - 1 : fin + 1]) + Math.PI / 2; c.view.scene.add(arch);
    this.race = { type: this.choice.type, pts, cum, len, laps: course.laps, checks, next: 0, lap: 0, rivals, wager: this.choice.wager, t0: 0, go: c.sim.time + (mp ? mp.startIn : 4), meet: m, finish: 0, playerS: 0, launch: 0, done: false, rings, arch, police: !mp && Math.random() < 0.18, mp: !!mp, goReal: mp ? performance.now() + mp.startIn * 1000 : undefined } as Race;
    this.el.classList.add('on'); this.countdown(mp ? mp.startIn : 4);
  }
  /** 3, 2, 1, GO on the sim clock, so it lines up with the start time the server gave every racer */
  private countdown(secs: number) { const c = this.ctx; const r = this.race!; const at = (t: number, f: () => void) => setTimeout(() => { if (this.race === r) f(); }, Math.max(0, t * 1000)); [3, 2, 1].forEach((n) => at(secs - n, () => { c.hud.title(String(n), '', 0.8); sfx('tick'); })); at(secs, () => { c.hud.title('GO!', '', 1.2); sfx('win'); r.t0 = c.sim.time; }); }

  // ---------------------------------------------------------------- AI drivers: pure pursuit along the course, braking for the bends ahead
  private aiDrive(R: Rival, v: Vehicle, _dt: number): Command {
    const c = emptyCommand(); const r = this.race; if (!r) return c; const now = this.ctx.sim.time;
    if (now < r.go || R.done) { c.jump = true; return c; }
    const p = v.body.translation(); const pts = r.pts; const n = pts.length / 2;
    // progress: search forward from last index
    let best = R.idx, bd = 1e9; for (let i = R.idx; i < Math.min(n, R.idx + 30); i++) { const d = Math.hypot(pts[i * 2] - p.x, pts[i * 2 + 1] - p.z); if (d < bd) { bd = d; best = i; } } R.idx = best;
    if (r.laps > 1 && R.idx >= n - 2) { R.lap++; R.idx = 0; } R.s = R.lap * r.len + r.cum[R.idx];
    if (R.lap >= r.laps || (r.laps === 1 && R.idx >= n - 1)) { R.done = now; c.jump = true; return c; }
    const sp = Math.abs(v.ctrl.currentVehicleSpeed()); const look = 8 + sp * 0.9; let ti = R.idx; while (ti < n - 1 && r.cum[ti] - r.cum[R.idx] < look) ti++;
    const fw = fwOf(v); const have = Math.atan2(fw.x, fw.z); const err = wrap(Math.atan2(pts[ti * 2] - p.x, pts[ti * 2 + 1] - p.z) - have);
    // how sharp is the road ahead: biggest heading change within 60 m
    let sharp = 0; for (let i = R.idx + 1, k = 0; i < n - 1 && r.cum[i] - r.cum[R.idx] < 30 + sp * 1.6 && k < 40; i++, k++) { const a0 = Math.atan2(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]), a1 = Math.atan2(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]); sharp = Math.max(sharp, Math.abs(wrap(a1 - a0))); }
    const rubber = Math.max(-0.08, Math.min(0.12, (r.playerS - R.s) / 600)); const vmax = 34 * R.skill * (1 + rubber);
    const target = Math.min(vmax, sharp > 1.0 ? 9 : sharp > 0.6 ? 13 : sharp > 0.3 ? 19 + R.aggr * 3 : vmax);
    c.mx = -Math.max(-1, Math.min(1, err * 2.0));
    // dodge cars in front (the player, other racers, traffic)
    for (const o of this.ctx.sim.liveVehicles()) { if (o === v) continue; const q = o.body.translation(); const dx = q.x - p.x, dz = q.z - p.z; const along = dx * fw.x + dz * fw.z, side = dx * fw.z - dz * fw.x; if (along > 0 && along < 9 + sp * 0.5 && Math.abs(side) < 2.6) { c.mx = Math.max(-1, Math.min(1, c.mx + (side > 0 ? 0.9 : -0.9))); if (along < 5 && sp > 8) c.jump = true; break; } }
    // wedged against a kerb or another car: back out, then try again
    if ((R.rev ?? 0) > 0) { R.rev! -= _dt; c.mz = -1; c.mx = -c.mx; return c; }
    if (sp < 1) { R.stuck = (R.stuck ?? 0) + _dt; if (R.stuck > 2) { R.stuck = 0; R.rev = 1.3; } } else R.stuck = 0;
    // still nowhere after a while and nobody watching: put them back on the road, GTA style
    if (sp < 2) R.lost = (R.lost ?? 0) + _dt; else R.lost = 0;
    if ((R.lost ?? 0) > 7) { const me = this.ctx.sim.local.pos; const j = Math.min(n - 2, R.idx + 3); const x = pts[j * 2], z = pts[j * 2 + 1]; if (Math.hypot(x - me.x, z - me.z) > 35) { const yaw = Math.atan2(pts[j * 2 + 2] - x, pts[j * 2 + 3] - z); const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw); v.body.setTranslation({ x, y: 0.8, z }, true); v.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true); } R.lost = 0; }
    if (sp < target) c.mz = 1; else if (sp > target + 2.5) c.jump = true;
    if (bd > 18) c.mz = Math.min(c.mz, 0.6);
    return c;
  }

  // ---------------------------------------------------------------- the player and the race flow
  filterCommand(cmd: Command) { const r = this.race; if (!r) return; const now = this.ctx.sim.time; const waiting = r.goReal ? performance.now() < r.goReal : now < r.go; if (waiting) { if (cmd.mz > 0.5 && (r.goReal ? performance.now() > r.goReal - 250 : now > r.go - 0.25)) this.wantGo = true; else if (cmd.mz > 0.5) r.launch = -1; cmd.mz = 0; cmd.jump = true; } }
  frame(dt: number) {
    const c = this.ctx; this.placeT -= dt; if (this.placeT <= 0) { this.placeT = 6; this.placeMeets(); this.dressMeets(); }
    const r = this.race; if (!r) return; const me = c.sim.local; const now = c.sim.time;
    if (me.vehicle === null || !me.alive) { this.end('dnf'); return; }
    const v = c.sim.vehicles[me.vehicle]; const p = v.body.translation();
    // the launch: hold throttle in the last quarter second before GO for a boost, early means a stall
    if (r.t0 && !r.launch) { r.launch = this.wantGo ? 1 : 0.01; if (this.wantGo) { const fw = fwOf(v); const m = VEHICLES[v.kind].mass ?? 1200; v.body.applyImpulse({ x: fw.x * m * 6, y: 0, z: fw.z * m * 6 }, true); c.hud.title('PERFECT LAUNCH', '', 1.2); } this.wantGo = false; }
    if (r.launch === -1 && r.t0) { r.launch = 0.01; c.hud.toast('Jumped the start', 'You were on the gas too early. Engine bog.', 'var(--red)', 'msg', 2.5); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
    // checkpoints
    const n = r.pts.length / 2; const ci = r.checks[r.next]; for (const [i, ring] of r.rings.entries()) { ring.visible = i === r.next || i === r.next + 1; (ring.material as THREE.MeshBasicMaterial).opacity = i === r.next ? 0.9 : 0.35; ring.rotation.z += dt * (i === r.next ? 1.5 : 0); }
    if (ci !== undefined && Math.hypot(r.pts[ci * 2] - p.x, r.pts[ci * 2 + 1] - p.z) < 14) { r.next++; sfx('hit'); if (r.next >= r.checks.length) { if (r.lap + 1 < r.laps) { r.lap++; r.next = 0; c.hud.title(`LAP ${r.lap + 1}/${r.laps}`, '', 1.2); } else { r.finish = now; this.end('finish'); return; } } }
    r.playerS = r.lap * r.len + r.cum[Math.max(0, r.checks[Math.max(0, r.next - 1)] ?? 0)] + 0;
    // live position by distance to the next checkpoint
    const prog = (s: number) => s; const mine = prog(r.lap * r.len + (r.next ? r.cum[r.checks[r.next - 1]] : 0) + Math.max(0, (r.cum[ci ?? n - 1] - (r.next ? r.cum[r.checks[r.next - 1]] : 0)) - Math.hypot(r.pts[(ci ?? n - 1) * 2] - p.x, r.pts[(ci ?? n - 1) * 2 + 1] - p.z)));
    r.playerS = mine; const pos = 1 + r.rivals.filter((R) => R.s > mine || R.done).length;
    const t = r.t0 ? now - r.t0 : 0; this.el.innerHTML = `<div><span>POS</span><b>${pos}/${r.rivals.length + 1}</b></div>${r.laps > 1 ? `<div><span>LAP</span><b>${r.lap + 1}/${r.laps}</b></div>` : ''}<div><span>TIME</span><b>${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}</b></div><div><span>CHECKPOINT</span><b>${Math.min(r.next + 1, r.checks.length)}/${r.checks.length}</b></div>`;
    // the police crash the party
    if (r.police && r.t0 && now - r.t0 > 25 && c.sim.wanted === 0) { r.police = false; c.sim.crime('racing', 2, me.pos); c.hud.toast('Police!', 'Somebody don call police for una. Finish the race and lose them.', 'var(--red)', 'msg', 4); }
    if (r.t0 && now - r.t0 > 600) this.end('dnf');
  }
  goal() { const r = this.race; if (!r) { const m = this.night() && this.ctx.sim.local.vehicle !== null ? null : null; return m; } const ci = r.checks[r.next] ?? r.checks[r.checks.length - 1]; return { x: r.pts[ci * 2], z: r.pts[ci * 2 + 1], label: 'Checkpoint' }; }
  private end(how: 'finish' | 'dnf') {
    const c = this.ctx; const r = this.race!; r.done = true; const now = c.sim.time;
    if (r.mp) { const ms = Math.round(performance.now() - (r.goReal ?? performance.now())); if (how === 'finish') void net.act('race.finish', { ms, len: r.len * r.laps }); else void net.act('race.leave'); c.hud.title(how === 'finish' ? 'FINISHED' : 'DID NOT FINISH', how === 'finish' ? `${(ms / 1000).toFixed(2)}s · waiting for the others` : '', 3); setTimeout(() => { for (const g of r.rings) g.removeFromParent(); r.arch?.removeFromParent(); }, 4000); this.race = null; this.el.classList.remove('on'); return; }
    const ahead = r.rivals.filter((R) => R.done && R.done < (r.finish || now)).length; const place = how === 'dnf' ? r.rivals.length + 1 : ahead + 1;
    const pot = r.wager * (r.rivals.length + 1); const win = place === 1 ? Math.round(pot * 0.8) : place === 2 && r.rivals.length > 1 ? r.wager : 0;
    if (win) earn(c, win, 'race');
    if (place === 1) { this.cred++; career.add('racer'); c.hud.title('YOU WIN', `₦${win.toLocaleString()} · street cred ${this.cred}`, 3.5); sfx('win'); (c.systems.get('skills') as any)?.addXp?.('drive', 60 + Math.round(r.len / 40)); (lifeNeeds(c))?.(); }
    else c.hud.title(how === 'dnf' ? 'DID NOT FINISH' : `${place}${place === 2 ? 'ND' : place === 3 ? 'RD' : 'TH'} PLACE`, win ? `Money back: ₦${win.toLocaleString()}` : 'Better luck next time', 3);
    // tidy up: rivals become ordinary traffic and drive off into the night
    setTimeout(() => { for (const R of r.rivals) { (R.drv as any)._ai = undefined; (R.drv as any)._keep = false; (R.v as any)._keep = false; } for (const g of r.rings) g.removeFromParent(); r.arch?.removeFromParent(); }, 4000);
    this.race = null; this.el.classList.remove('on'); this.persist();
  }
  prompt() { const m = this.nearMeet(); if (m) return `<kbd>E</kbd>Street race at ${m.name}`; return null; }
  interact() { const m = this.nearMeet(); if (m) { this.openSel(m); return true; } return false; }
  blips(out: { x: number; z: number; c: string; r?: number }[]) { if (this.night() && !this.race) for (const m of this.meets) out.push({ x: m.ax, z: m.az, c: '#ff7043', r: 9 }); }
}
function lifeNeeds(c: GameCtx) { const L = (c.systems.get('life') as any)?.api; return L ? () => { L.needs.v.fun = Math.min(100, L.needs.v.fun + 30); } : null; }

let R: Racing | null = null;
export const racingSystem: GameSystem & { get api(): Racing | null } = {
  id: 'racing',
  get api() { return R; },
  init(ctx) { R = new Racing(ctx); R.init(); },
  filterCommand(_c, cmd) { if (!R) return; if (cmd.interact && R.interact()) cmd.interact = false; R.filterCommand(cmd); },
  frame(_c, dt) { R?.frame(dt); },
  goal() { return R?.goal() ?? null; },
  prompt() { return R?.prompt() ?? null; },
  blips(_c, out) { R?.blips(out); },
};
