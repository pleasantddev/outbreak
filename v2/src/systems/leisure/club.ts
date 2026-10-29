// Club Euphoria: a night club with an LED dance floor, a DJ, a bar, VIP booths and podium dancers (fully clothed, it
// is a 16+ game). Dance with the crowd (a rhythm game locked to the live groove) or buy a table and hold court.
import * as THREE from 'three';
import type { GameCtx } from '../registry';
import type { Actor } from '../../sim/types';
import type { Venue } from '../life/venue';
import type { Thing } from '../life/index';
import { addMoodlet } from '../life/needs';
import { Builder, canvasTex, M, box, cyl } from './build';
import { sfx, beat, audioTime } from './sfx';

export const CLUB_ORIGIN = new THREE.Vector3(34000, 0, 30000);
const css = `
#rg{position:fixed;inset:0;z-index:10;display:none;pointer-events:none;font-family:Inter,sans-serif;color:#fff}
#rg.on{display:block}
#rg .lanes{position:absolute;left:50%;bottom:90px;transform:translateX(-50%);width:min(380px,86vw);height:min(62vh,520px);display:grid;grid-template-columns:repeat(4,1fr);gap:8px;pointer-events:auto}
#rg .lane{position:relative;border-radius:16px;background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,.08));border:1px solid rgba(255,255,255,.08);overflow:hidden}
#rg .lane .hit{position:absolute;left:6px;right:6px;bottom:14px;height:54px;border-radius:14px;border:2px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;font:800 22px Rajdhani,Inter;color:rgba(255,255,255,.6)}
#rg .lane.press .hit{background:rgba(255,255,255,.18);border-color:#fff}
#rg .note{position:absolute;left:8px;right:8px;height:50px;border-radius:12px;display:flex;align-items:center;justify-content:center;font:800 22px Rajdhani,Inter;box-shadow:0 0 18px currentColor;will-change:transform}
#rg .hud{position:absolute;left:50%;top:max(16px,env(safe-area-inset-top));transform:translateX(-50%);text-align:center}
#rg .hud b{display:block;font:800 42px Rajdhani,Inter;letter-spacing:1px} #rg .hud span{font:700 14px Rajdhani,Inter;letter-spacing:2px;color:#ff7ad9}
#rg .judge{position:absolute;left:50%;bottom:calc(90px + min(62vh,520px) + 10px);transform:translateX(-50%);font:900 30px Rajdhani,Inter;letter-spacing:2px;text-shadow:0 0 20px currentColor}
#rg .meter{position:absolute;left:50%;bottom:52px;transform:translateX(-50%);width:min(380px,86vw);height:10px;border-radius:5px;background:rgba(255,255,255,.12);overflow:hidden} #rg .meter i{display:block;height:100%;background:linear-gradient(90deg,#ff3dbb,#ffc93c,#49e08a)}
#rg .quit{position:absolute;right:16px;top:16px;pointer-events:auto;width:38px;height:38px;border-radius:12px;border:none;background:rgba(0,0,0,.5);color:#fff;font:700 16px Inter;cursor:pointer}
`;
const LANE_COL = ['#ff3dbb', '#40c4ff', '#69f0ae', '#ffc93c']; const LANE_KEY = [['ArrowLeft', 'KeyA'], ['ArrowDown', 'KeyS'], ['ArrowUp', 'KeyW'], ['ArrowRight', 'KeyD']]; const LANE_ICON = ['◀', '▼', '▲', '▶'];

class Rhythm {
  el: HTMLElement; on = false; private notes: { lane: number; t: number; el: HTMLElement; done: boolean }[] = []; private t0 = 0; private raf = 0;
  score = 0; combo = 0; best = 0; hype = 0.5; hits = 0; misses = 0; private end = 0; private cb: ((r: { score: number; best: number; hits: number; misses: number }) => void) | null = null;
  constructor() { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); this.el = document.createElement('div'); this.el.id = 'rg'; document.body.appendChild(this.el);
    addEventListener('keydown', (e) => { if (!this.on) return; const l = LANE_KEY.findIndex((k) => k.includes(e.code)); if (l >= 0) { this.press(l); e.preventDefault(); e.stopPropagation(); } if (e.code === 'Escape') this.stop(); }, true); }
  start(secs: number, cb: Rhythm['cb']) {
    this.cb = cb; this.on = true; this.score = this.combo = this.best = this.hits = this.misses = 0; this.hype = 0.5;
    this.el.innerHTML = `<div class="hud"><span>DANCE OFF</span><b id="rg-s">0</b><span id="rg-c"></span></div><div class="judge" id="rg-j"></div><div class="lanes">${[0, 1, 2, 3].map((i) => `<div class="lane" data-l="${i}"><div class="hit" style="color:${LANE_COL[i]}">${LANE_ICON[i]}</div></div>`).join('')}</div><div class="meter"><i id="rg-m" style="width:50%"></i></div><button class="quit">✕</button>`;
    this.el.classList.add('on'); this.el.querySelector('.quit')!.addEventListener('click', () => this.stop());
    this.el.querySelectorAll('.lane').forEach((d) => d.addEventListener('pointerdown', () => this.press(+(d as HTMLElement).dataset.l!)));
    // a chart: notes on 8ths following the groove, denser as the song goes on, with chords on the bar line
    const spb = 60 / beat.bpm; this.t0 = audioTime() + 2.2; this.end = this.t0 + secs; this.notes = []; let last = -1;
    for (let t = 0, i = 0; t < secs; t += spb / 2, i++) {
      const dens = 0.35 + 0.45 * (t / secs); const strong = i % 8 === 0; if (!strong && Math.random() > dens) continue;
      let lane = (Math.random() * 4) | 0; if (lane === last && Math.random() < 0.6) lane = (lane + 1 + ((Math.random() * 3) | 0)) % 4; last = lane;
      this.addNote(lane, this.t0 + t); if (strong && t / secs > 0.4 && Math.random() < 0.5) this.addNote((lane + 2) % 4, this.t0 + t);
    }
    const loop = () => { this.tick(); if (this.on) this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop);
  }
  private addNote(lane: number, t: number) { const el = document.createElement('div'); el.className = 'note'; el.style.color = LANE_COL[lane]; el.style.background = LANE_COL[lane]; el.innerHTML = `<span style="color:#111">${LANE_ICON[lane]}</span>`; (this.el.querySelectorAll('.lane')[lane] as HTMLElement).appendChild(el); this.notes.push({ lane, t, el, done: false }); }
  private tick() {
    const now = audioTime(); const H = (this.el.querySelector('.lane') as HTMLElement).clientHeight; const travel = 1.6;
    for (const n of this.notes) { if (n.done) continue; const k = 1 - (n.t - now) / travel; const y = -60 + k * (H - 14 - 54 + 60); n.el.style.transform = `translateY(${y}px)`; n.el.style.opacity = k < 0 ? '0' : '1'; if (now - n.t > 0.18) { n.done = true; n.el.remove(); this.judge('MISS', '#ff4d5e'); this.combo = 0; this.misses++; this.hype = Math.max(0, this.hype - 0.06); sfx('miss'); } }
    (this.el.querySelector('#rg-m') as HTMLElement).style.width = `${Math.round(this.hype * 100)}%`;
    if (now > this.end + 0.5) this.stop();
  }
  private press(l: number) {
    const lane = this.el.querySelectorAll('.lane')[l] as HTMLElement; lane.classList.add('press'); setTimeout(() => lane.classList.remove('press'), 90);
    const now = audioTime(); let best: (typeof this.notes)[number] | null = null; for (const n of this.notes) if (!n.done && n.lane === l && Math.abs(n.t - now) < 0.16 && (!best || Math.abs(n.t - now) < Math.abs(best.t - now))) best = n;
    if (!best) { this.combo = 0; this.hype = Math.max(0, this.hype - 0.02); return; }
    best.done = true; best.el.remove(); const e = Math.abs(best.t - now); const [txt, col, pts] = e < 0.045 ? ['PERFECT', '#ffc93c', 300] : e < 0.09 ? ['GREAT', '#69f0ae', 200] : ['GOOD', '#40c4ff', 100];
    this.combo++; this.best = Math.max(this.best, this.combo); this.hits++; this.score += (pts as number) * (1 + Math.floor(this.combo / 10) * 0.5); this.hype = Math.min(1, this.hype + 0.03);
    this.judge(txt as string, col as string); (this.el.querySelector('#rg-s') as HTMLElement).textContent = Math.round(this.score).toLocaleString(); (this.el.querySelector('#rg-c') as HTMLElement).textContent = this.combo > 4 ? `${this.combo} COMBO` : ''; sfx('hit');
  }
  private judge(t: string, c: string) { const j = this.el.querySelector('#rg-j') as HTMLElement; j.textContent = t; j.style.color = c; j.animate([{ transform: 'translateX(-50%) scale(1.3)', opacity: 1 }, { transform: 'translateX(-50%) scale(1)', opacity: 0.85 }], { duration: 180 }); }
  stop() { if (!this.on) return; this.on = false; cancelAnimationFrame(this.raf); this.el.classList.remove('on'); this.el.innerHTML = ''; const cb = this.cb; this.cb = null; cb?.({ score: this.score, best: this.best, hits: this.hits, misses: this.misses }); }
}

function ledTex() { return canvasTex(64, 64, (x) => { x.fillStyle = '#111'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#fff'; x.fillRect(3, 3, 58, 58); }); }

export class Club {
  venue: Venue; private rhythm = new Rhythm(); private people: Actor[] = []; private tiles: THREE.Mesh[] = []; private beams: THREE.Mesh[] = []; private t = 0; private dancing = false; private table = false;
  private spots: { id: string; x: number; z: number; yaw: number; label: string; verb: string; use: () => void }[] = [];
  constructor(private ctx: GameCtx, private life: { needs: any; doAction: (a: any, at?: any) => void; stop: (c: boolean) => void; ui: any }) {
    const B = new Builder(CLUB_ORIGIN); const W = 10, D = 15;
    B.floor(-W, 0, W, D, M(0x141018, 0.4, { metalness: 0.3 }));
    B.room(-W, 0, W, D, M(0x0b0910, 0.9), { side: 's', at: W, w: 2.2 });
    // LED floor 6x6 tiles in the middle
    const led = ledTex(); for (let i = 0; i < 7; i++) for (let j = 0; j < 6; j++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), new THREE.MeshBasicMaterial({ color: 0xffffff, map: led, toneMapped: false })); m.rotation.x = -Math.PI / 2; m.position.set(-3 + i, 0.02, 5 + j); B.g.add(m); this.tiles.push(m); }
    // DJ booth on a stage at the back
    B.solid(box(8, 0.5, 3, M(0x1a1a22, 0.5), 0, 0.25, D - 1.5), 8, 3, 0.5);
    const booth = new THREE.Group(); booth.position.set(0, 0.5, D - 2.1); booth.add(box(2.6, 1.0, 0.8, M(0x222, 0.4, { metalness: 0.5 }), 0, 0.5, 0)); booth.add(box(2.4, 0.06, 0.06, new THREE.MeshBasicMaterial({ color: 0xff3dbb, toneMapped: false }), 0, 0.9, 0.41)); for (const x of [-0.7, 0.7]) booth.add(cyl(0.22, 0.22, 0.04, M(0x111, 0.3), x, 1.02, 0)); B.add(booth);
    for (const x of [-3.4, 3.4]) { B.solid(box(0.9, 2.2, 0.8, M(0x101010, 0.6), x, 1.6, D - 1.2), 0.9, 0.8, 2.7); B.add(cyl(0.3, 0.3, 0.03, M(0x333, 0.3), x, 2.1, D - 0.79)); B.add(cyl(0.18, 0.18, 0.03, M(0x333, 0.3), x, 1.3, D - 0.79)); }
    B.sign('EUPHORIA', 0, 2.95, D - 0.1, Math.PI, 7, '#ff7ad9');
    // podiums for the dancers
    for (const x of [-6.5, 6.5]) { B.solid(cyl(0.7, 0.75, 0.6, M(0x222, 0.3, { metalness: 0.7 }), x, 0.3, 9.5), 1.4, 1.4, 0.6); B.add(cyl(0.72, 0.72, 0.03, new THREE.MeshBasicMaterial({ color: 0x40c4ff, toneMapped: false }), x, 0.61, 9.5)); }
    // bar along the west wall
    const bar = new THREE.Group(); bar.position.set(-W + 1.2, 0, 4.5); bar.rotation.y = Math.PI / 2; bar.add(box(5, 1.1, 0.7, M(0x111, 0.3, { metalness: 0.4 }), 0, 0.55, 0)); bar.add(box(5, 0.04, 0.72, new THREE.MeshBasicMaterial({ color: 0x40c4ff, toneMapped: false }), 0, 0.2, 0.36)); B.solid(bar, 0.7, 5, 1.1);
    // VIP booths east
    for (const z of [3, 7, 11]) { const v = new THREE.Group(); v.position.set(W - 1.6, 0, z); v.add(box(0.6, 0.9, 2.6, M(0x5e1a3a, 0.7), 0.7, 0.45, 0)); v.add(box(1.2, 0.45, 2.6, M(0x5e1a3a, 0.7), 0.3, 0.22, 0)); v.add(cyl(0.45, 0.45, 0.06, M(0x111, 0.2), -0.8, 0.72, 0)); v.add(cyl(0.06, 0.06, 0.7, M(0x111, 0.2), -0.8, 0.35, 0, 8)); v.add(cyl(0.045, 0.045, 0.3, M(0xffd54f, 0.2, { metalness: 0.8 }), -0.8, 0.9, 0, 8)); B.solid(v, 1.4, 2.6, 0.9); }
    B.add(box(0.05, 2.4, D - 2, new THREE.MeshBasicMaterial({ color: 0x8b5cf6, toneMapped: false, transparent: true, opacity: 0.25 }), W - 2.5, 1.2, D / 2 - 0.5));
    // light beams from the ceiling rig
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.9, 6, 16, 1, true), new THREE.MeshBasicMaterial({ color: [0xff3dbb, 0x40c4ff, 0x69f0ae, 0xffc93c, 0x8b5cf6, 0xff7043][i], transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); b.position.set(-4 + i * 1.6, 3.4, 8); b.geometry.translate(0, -3, 0); B.g.add(b); this.beams.push(b); }
    B.light(0, 3, 7.5, 0xff3dbb, 8, 12); B.light(-6, 3, 4, 0x40c4ff, 6, 10); B.light(6, 3, 10, 0x8b5cf6, 6, 10); B.light(0, 2.5, D - 2, 0xffffff, 4, 6);
    const lot = B.lot({ x: W - 1.2, z: 1.2, yaw: 0 }, [{ name: 'Club', x0: -W, z0: 0, x1: W, z1: D }]); lot.exit = { x: W, z: -1 };
    this.venue = { id: 'club', title: 'EUPHORIA', sub: 'Night club · Thu to Sun, 9pm till late', lot, door: null, blip: '#ff3dbb', label: 'Enter Euphoria (₦5,000)', fee: 5000, cam: { d: 11, pitch: 0.95 }, things: () => this.things(), enter: () => this.enter(), exit: () => this.exit(), frame: (dt) => this.frame(dt), refuse: () => this.refuse() };
    const O = CLUB_ORIGIN;
    this.spots = [
      { id: 'floor', x: 0, z: 7.5, yaw: Math.PI, label: 'Dance floor', verb: 'Dance off', use: () => this.dance() },
      { id: 'bar', x: -W + 2.3, z: 4.5, yaw: -Math.PI / 2, label: 'Bar', verb: 'Buy a round (₦4,000)', use: () => this.round() },
      ...[3, 7, 11].map((z, i) => ({ id: 'vip' + i, x: W - 2.9, z, yaw: Math.PI / 2, label: 'VIP table', verb: 'Book VIP table (₦60,000)', use: () => this.vip(W - 2.0, z) })),
      { id: 'dj', x: 0, z: D - 4, yaw: 0, label: 'DJ', verb: 'Request a song (₦2,000)', use: () => this.request() },
    ].map((s) => ({ ...s, x: s.x, z: s.z })); void O;
  }
  private refuse() { const h = this.ctx.view.atmo.hour; if (h >= 5 && h < 21) return 'Euphoria opens 9pm. Come back tonight.'; if (this.life.needs.v.hygiene < 25) return 'Bouncer: "You dey smell. Go baff come."'; return null; }
  private things(): Thing[] { const O = CLUB_ORIGIN; return this.spots.map((s) => ({ id: 'club:' + s.id, name: s.label, x: O.x + s.x, z: O.z + s.z, yaw: s.yaw, actions: [], kind: 'object' as const, reach: s.id === 'floor' ? 3.5 : 2.0, verb: s.verb, open: s.use })); }
  private pay(n: number) { const c = this.ctx; if (c.sim.cash < n) { c.hud.toast('No money', `You need ₦${n.toLocaleString()}.`, 'var(--red)', 'cash', 3); return false; } c.sim.cash -= n; c.sim.events.push({ t: 'cash', actor: c.sim.local.id, amount: -n } as any); return true; }
  private dance() {
    const c = this.ctx; if (this.dancing) return; this.dancing = true; c.setModal(true); const me = c.sim.local; (me as any).act = { clip: 'Dance_Loop', speed: 1.05, yaw: Math.PI };
    this.rhythm.start(42, (r) => {
      this.dancing = false; c.setModal(false); (me as any).act = undefined; const n = this.life.needs; const acc = r.hits / Math.max(1, r.hits + r.misses);
      n.v.fun = Math.min(100, n.v.fun + 10 + acc * 25); n.v.social = Math.min(100, n.v.social + 8 + acc * 15); n.v.energy = Math.max(0, n.v.energy - 8);
      (c.systems.get('skills') as any)?.addXp?.('charm', Math.round(10 + acc * 30));
      if (acc > 0.85) { addMoodlet(n, 'dancefloor', 'Owned the dance floor', 14, 5); c.hud.title('THE FLOOR IS YOURS', `${Math.round(acc * 100)}% · best combo ${r.best}`, 3); }
      else if (acc < 0.4) { addMoodlet(n, 'twoleft', 'Two left feet', -4, 3); c.hud.toast('Hmm', 'The crowd don see your dance. E no sweet them.', 'var(--pur)', 'msg', 4); }
      else c.hud.toast('Nice moves', `${Math.round(acc * 100)}% on beat. The crowd dey feel you.`, 'linear-gradient(160deg,#ff3dbb,#8b5cf6)', 'msg', 4);
    });
  }
  private round() { if (!this.pay(4000)) return; const n = this.life.needs; n.v.fun = Math.min(100, n.v.fun + 10); n.v.bladder = Math.max(0, n.v.bladder - 14); this.life.doAction({ id: 'drink', label: 'Drinks with the crowd', gain: { social: 60, fun: 30 }, minutes: 25, clip: 'Idle_Talking_Loop', spot: [0, 0, 0], moodlet: ['round', 'Bought the round', 6, 4] }); }
  private vip(x: number, z: number) { if (this.table) return; if (!this.pay(60000)) return; this.table = true; const O = CLUB_ORIGIN; this.ctx.hud.title('VIP', 'Bottles on the way. Everybody wan be your friend now.', 3); addMoodlet(this.life.needs, 'baller', 'Living large', 18, 6); this.life.doAction({ id: 'vip', label: 'Holding court at VIP', gain: { social: 90, fun: 60, comfort: 40 }, minutes: 60, clip: 'Sitting_Talking_Loop', spot: [0, 0, 0], y: 0.02, sitting: true }, { name: 'VIP', x: O.x + x, z: O.z + z, yaw: Math.PI / 2 } as any); }
  private request() { if (!this.pay(2000)) return; this.ctx.hud.say('DJ', 'Big shout out to my person for the request! Make some noise!', 4); addMoodlet(this.life.needs, 'shoutout', 'Got a shout out', 6, 3); beat.bpm = beat.bpm === 112 ? 118 : 112; sfx('ambClub'); }
  private enter() {
    const c = this.ctx; const O = CLUB_ORIGIN; this.people = []; sfx('ambClub');
    const spawn = (x: number, z: number, yaw: number, act: any, look?: any, role = 'ped', name?: string) => { const a = c.sim.spawnActor(role as any, { x: O.x + x, y: 0.05 + (act.y ?? 0), z: O.z + z }, look, name); a.yaw = yaw; Object.assign(a as any, { _script: true, _keep: true, act }); this.people.push(a); return a; };
    for (let i = 0; i < 16; i++) spawn(-2.6 + Math.random() * 5.2, 5.2 + Math.random() * 5.2, Math.random() * 6.28, { clip: 'Dance_Loop', speed: 0.8 + Math.random() * 0.45, yaw: Math.random() * 6.28 });
    const dj = c.sim.randomLook(); Object.assign(dj, { head: 'cap', topColor: '#111111', topPattern: 'solid' }); spawn(0, 15 - 2.6, Math.PI, { clip: 'Idle_Rail_Loop', yaw: Math.PI, y: 0.5 }, dj, 'vendor', 'DJ');
    for (const x of [-6.5, 6.5]) { const lk = c.sim.randomLook(); Object.assign(lk, { body: 'female', top: 'tee', topPattern: 'solid', topColor: x < 0 ? '#ff3dbb' : '#40c4ff', pants: 'solid', pantsColor: '#141414' }); spawn(x, 9.5, x < 0 ? Math.PI / 2 : -Math.PI / 2, { clip: 'Dance_Loop', speed: 1.15, yaw: x < 0 ? Math.PI / 2 : -Math.PI / 2, y: 0.6 }, lk, 'vendor', 'Dancer'); }
    const bm = c.sim.randomLook(); spawn(-10 + 0.6, 4.5, Math.PI / 2, { clip: 'Idle_Loop', yaw: Math.PI / 2 }, bm, 'vendor', 'Bartender');
    for (let i = 0; i < 5; i++) spawn(-6.8 + Math.random() * 1.2, 2.5 + i * 1.0, -Math.PI / 2, { clip: Math.random() < 0.5 ? 'Idle_Talking_Loop' : 'Idle_Loop', yaw: -Math.PI / 2 });
    for (const p of this.people) if ((p as any).act?.y) { p.body.setTranslation({ x: p.pos.x, y: p.pos.y + 0.9, z: p.pos.z }, true); }
    this.table = false;
  }
  private exit() { for (const a of this.people) if (!(a as any)._gone) this.ctx.sim.removeActor(a); this.people = []; sfx('ambStop'); if (this.rhythm.on) this.rhythm.stop(); }
  private frame(dt: number) {
    this.t += dt; const b = beat.step / 4; const pulse = Math.exp(-((b % 1) * 6));
    this.tiles.forEach((m, i) => { const ph = Math.floor(b) + ((i * 7) % 5); (m.material as THREE.MeshBasicMaterial).color.setHSL(((ph * 0.13 + i * 0.031) % 1), 0.85, 0.18 + 0.32 * pulse * ((i + Math.floor(b)) % 3 === 0 ? 1 : 0.4)); });
    this.beams.forEach((m, i) => { m.rotation.z = Math.sin(this.t * 0.8 + i) * 0.5; m.rotation.x = Math.cos(this.t * 0.6 + i * 1.3) * 0.4; (m.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.1 * pulse; });
  }
}
