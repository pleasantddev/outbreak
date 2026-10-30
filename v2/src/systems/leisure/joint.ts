// Oluwole Spot: a beer parlour and football viewing centre. Plastic chairs, a generator TV showing the match, pepper
// soup, cold drinks, and old Baba Sola who will beat you at Ayo (the Yoruba seed-sowing game) for money.
import * as THREE from 'three';
import type { GameCtx } from '../registry';
import type { Actor } from '../../sim/types';
import type { Venue } from '../life/venue';
import type { Thing } from '../life/index';
import { addMoodlet } from '../life/needs';
import { Builder, canvasTex, M, box, cyl } from './build';
import { sfx } from './sfx';

export const JOINT_ORIGIN = new THREE.Vector3(38000, 0, 36000);
const css = `
#ayo{position:fixed;inset:0;z-index:10;display:none;align-items:center;justify-content:center;background:rgba(10,6,2,.6);font-family:Inter,sans-serif;color:#fff7ed}
#ayo.on{display:flex} #ayo .bd{width:min(680px,96vw);border-radius:26px;padding:18px;background:linear-gradient(180deg,#6b3f1d,#4a2a12);border:3px solid #2b1608;box-shadow:inset 0 2px 0 rgba(255,255,255,.15),0 30px 80px rgba(0,0,0,.6)}
#ayo .top{display:flex;align-items:center;gap:10px;margin-bottom:10px} #ayo .top b{font:800 20px Rajdhani,Inter;letter-spacing:1.5px} #ayo .top .x{margin-left:auto;width:34px;height:34px;border-radius:10px;border:none;background:rgba(0,0,0,.3);color:#fff;font:700 15px Inter;cursor:pointer}
#ayo .row{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:8px 0} #ayo .pit{aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 50% 40%,#2b1608,#3d2210 70%);box-shadow:inset 0 6px 14px rgba(0,0,0,.6);display:flex;flex-wrap:wrap;align-content:center;justify-content:center;gap:2px;padding:12%;position:relative;cursor:default}
#ayo .pit.me{cursor:pointer} #ayo .pit.me:hover{box-shadow:inset 0 6px 14px rgba(0,0,0,.6),0 0 0 3px #fbbf24} #ayo .pit.hl{box-shadow:inset 0 6px 14px rgba(0,0,0,.6),0 0 0 3px #4ade80}
#ayo .seed{width:11px;height:11px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#e7e5e4,#78716c)} #ayo .n{position:absolute;bottom:-18px;left:0;right:0;text-align:center;font:700 12px Rajdhani,Inter;color:#fde68a}
#ayo .sc{display:flex;justify-content:space-between;font:700 14px Rajdhani,Inter;color:#fde68a;margin:16px 4px 4px} #ayo .msg{text-align:center;font:700 15px Inter;min-height:22px;margin-top:6px}
#ayo .bar{display:flex;gap:8px;justify-content:center;margin-top:10px} #ayo button.b{padding:10px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.3);color:#fff;font:700 13px Inter;cursor:pointer}
`;
/** Ayo (abapa rules, simplified): sow anticlockwise from a pit you own, skipping the origin on laps; if the last seed
 *  lands on the opponent's side making 2 or 3, capture it and the run of 2s and 3s before it. */
function sow(b: number[], pit: number): { b: number[]; got: number; path: number[] } {
  const s = [...b]; let n = s[pit]; s[pit] = 0; let i = pit; const path: number[] = [];
  while (n > 0) { i = (i + 1) % 12; if (i === pit) continue; s[i]++; n--; path.push(i); }
  let got = 0; const mine = pit < 6; const opp = (k: number) => (mine ? k >= 6 : k < 6);
  while (opp(i) && (s[i] === 2 || s[i] === 3)) { got += s[i]; s[i] = 0; i = (i + 11) % 12; }
  return { b: s, got, path };
}
const legal = (b: number[], me: boolean) => [0, 1, 2, 3, 4, 5].map((k) => (me ? k : k + 6)).filter((k) => b[k] > 0);
function aiMove(b: number[], skill: number) {
  const ms = legal(b, false); if (!ms.length) return -1;
  const score = (m: number) => { const r = sow(b, m); let worst = 0; for (const o of legal(r.b, true)) worst = Math.max(worst, sow(r.b, o).got); return r.got * 1.2 - worst * skill + Math.random() * (1.4 - skill); };
  return ms.sort((a, c) => score(c) - score(a))[0];
}

export class Joint {
  venue: Venue; private el!: HTMLElement; private people: Actor[] = []; private tv: THREE.Mesh | null = null; private tvT = 0; private match: { home: string; away: string; h: number; a: number; min: number } | null = null; private bet: { side: 'h' | 'a' | 'd'; amt: number } | null = null;
  private spots: { id: string; x: number; z: number; yaw: number; verb: string; use: () => void; sit?: boolean }[] = [];
  constructor(private ctx: GameCtx, private life: { needs: any; doAction: (a: any, at?: any) => void }) {
    const B = new Builder(JOINT_ORIGIN); const W = 8, D = 11;
    B.floor(-W, 0, W, D, M(0xffffff, 0.95, { map: canvasTex(128, 128, (x) => { x.fillStyle = '#8a8a86'; x.fillRect(0, 0, 128, 128); for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; x.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); } }, 6) }));
    const wallM = M(0xffffff, 0.95, { map: canvasTex(128, 128, (x) => { x.fillStyle = '#2e7d5b'; x.fillRect(0, 0, 128, 70); x.fillStyle = '#e8e2cf'; x.fillRect(0, 70, 128, 58); }) });
    B.room(-W, 0, W, D, wallM, { side: 's', at: W, w: 2.2 });
    // the TV on a bracket, generator outside the back
    const tvTex = document.createElement('canvas'); tvTex.width = 256; tvTex.height = 144; const tt = new THREE.CanvasTexture(tvTex); tt.colorSpace = THREE.SRGBColorSpace; (this as any)._tvc = tvTex;
    this.tv = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.35), new THREE.MeshBasicMaterial({ map: tt, toneMapped: false })); this.tv.position.set(0, 2.1, D - 0.15); this.tv.rotation.y = Math.PI; B.add(this.tv); B.add(box(2.6, 1.5, 0.12, M(0x111111, 0.3), 0, 2.1, D - 0.08));
    B.light(0, 2.0, D - 1.2, 0x9cc8ff, 3, 6);
    // plastic chairs facing the TV, tables with bottles
    const chair = (x: number, z: number, yaw: number, col = 0xe53935) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw; g.add(box(0.48, 0.05, 0.46, M(col, 0.5), 0, 0.44, 0)); g.add(box(0.48, 0.5, 0.05, M(col, 0.5), 0, 0.72, 0.22)); for (const [a, b] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) g.add(box(0.04, 0.44, 0.04, M(col, 0.5), a, 0.22, b)); B.add(g); };
    const seats: { x: number; z: number }[] = [];
    for (let r = 0; r < 3; r++) for (let i = 0; i < 5; i++) { const x = -3.2 + i * 1.6, z = 4 + r * 1.6; chair(x, z, Math.PI, [0xe53935, 0x1e88e5, 0xfdd835][r]); seats.push({ x, z }); }
    for (const [x, z] of [[-5.8, 3], [5.8, 3], [-5.8, 6.5]]) { B.solid(cyl(0.45, 0.45, 0.04, M(0xfafafa, 0.5), x, 0.72, z), 0.9, 0.9, 0.75); B.add(cyl(0.04, 0.04, 0.7, M(0xfafafa, 0.5), x, 0.36, z, 6)); for (let k = 0; k < 3; k++) B.add(cyl(0.035, 0.04, 0.25, M([0x2e7d32, 0x5d4037, 0x2e7d32][k], 0.15, { transparent: true, opacity: 0.85 }), x - 0.15 + k * 0.15, 0.87, z, 8)); }
    // counter with a cooler and pepper soup pot
    B.solid(box(3.2, 1.05, 0.7, M(0x5d4037, 0.6), 5.4, 0.52, 9.6), 3.2, 0.7, 1.05); B.add(box(0.9, 0.55, 0.55, M(0x1e88e5, 0.5), 4.5, 1.33, 9.6)); B.add(cyl(0.25, 0.22, 0.32, M(0x37474f, 0.4, { metalness: 0.5 }), 6.2, 1.21, 9.6));
    // the Ayo table
    { const t = new THREE.Group(); t.position.set(-5.6, 0, 9.4); t.add(box(1.6, 0.06, 0.8, M(0x6d4c41, 0.6), 0, 0.72, 0)); t.add(box(1.4, 0.12, 0.45, M(0x8d5524, 0.5), 0, 0.81, 0)); for (let i = 0; i < 12; i++) t.add(cyl(0.07, 0.07, 0.02, M(0x2b1608, 0.8), -0.55 + (i % 6) * 0.22, 0.875, i < 6 ? 0.1 : -0.1, 12)); for (const sx of [-0.7, 0.7]) t.add(box(0.06, 0.72, 0.7, M(0x6d4c41, 0.6), sx, 0.36, 0)); B.solid(t, 1.6, 0.8, 0.85); chair(-5.6, 8.65, 0, 0x1e88e5); chair(-5.6, 10.15, Math.PI, 0xe53935); }
    for (const [x, z] of [[-4, 3], [4, 3], [0, 7]]) { B.light(x, 2.7, z, 0xfff1d6, 5, 8); B.add(box(1.2, 0.04, 0.1, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), x, 2.95, z)); }
    B.sign('OLUWOLE SPOT', 0, 2.95, 0.12, 0, 4, '#fde68a');
    const lot = B.lot({ x: 0, z: 1.6, yaw: 0 }, [{ name: 'Joint', x0: -W, z0: 0, x1: W, z1: D }], 0xd8d2c0);
    this.venue = { id: 'joint', title: 'OLUWOLE SPOT', sub: 'Beer parlour · Live football · Ayo', lot, door: null, blip: '#fde68a', label: 'Enter Oluwole Spot', cam: { d: 9.5, pitch: 0.95 }, things: () => this.things(), enter: () => this.enter(), exit: () => this.exit(), frame: (dt) => this.frame(dt), refuse: () => { const h = ctx.view.atmo.hour; return h >= 2 && h < 10 ? 'Oluwole Spot opens 10am. Even beer parlour need sleep.' : null; } };
    const O = JOINT_ORIGIN; void O; (this as any)._seats = seats;
    this.spots = [
      { id: 'watch', x: -1.6, z: 5.6, yaw: Math.PI, verb: 'Watch the match', use: () => this.watch(), sit: true },
      { id: 'bar', x: 5.4, z: 8.8, yaw: 0, verb: 'Buy a cold one (₦1,200)', use: () => this.drink() },
      { id: 'soup', x: 6.4, z: 8.8, yaw: 0, verb: 'Pepper soup (₦2,500)', use: () => this.soup() },
      { id: 'ayo', x: -5.6, z: 8.65, yaw: 0, verb: 'Play Ayo with Baba Sola', use: () => this.ayo() },
    ];
  }
  init() { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); this.el = document.createElement('div'); this.el.id = 'ayo'; document.body.appendChild(this.el); }
  private things(): Thing[] { const O = JOINT_ORIGIN; return this.spots.map((s) => ({ id: 'joint:' + s.id, name: s.verb, x: O.x + s.x, z: O.z + s.z, yaw: s.yaw, actions: [], kind: 'object' as const, reach: s.id === 'watch' ? 3.5 : 1.8, verb: s.verb, open: s.use })); }
  private pay(n: number) { const c = this.ctx; if (c.sim.cash < n) { c.hud.toast('No money', `You need ₦${n.toLocaleString()}.`, 'var(--red)', 'cash', 3); return false; } c.sim.cash -= n; c.sim.events.push({ t: 'cash', actor: c.sim.local.id, amount: -n } as any); return true; }
  private drink() { if (!this.pay(1200)) return; const n = this.life.needs; n.v.bladder = Math.max(0, n.v.bladder - 12); this.life.doAction({ id: 'drink', label: 'Cold one at the spot', gain: { fun: 40, social: 30 }, minutes: 20, clip: 'Consume', spot: [0, 0, 0], moodlet: ['coldone', 'Cold one after work', 5, 3] }); }
  private soup() { if (!this.pay(2500)) return; this.life.doAction({ id: 'eat', label: 'Goat meat pepper soup', gain: { hunger: 140, comfort: 40 }, minutes: 25, clip: 'Consume', spot: [0, 0, 0], moodlet: ['soup', 'Pepper soup clear my eye', 6, 4] }); }
  private teams = ['Lagos Lions', 'Kano Pillars FC', 'Enugu Rangers', 'Ibadan Shooting Stars', 'Port Harcourt Sharks', 'Abuja Bees', 'Akwa Stars', 'Kwara Falcons'];
  private watch() {
    const c = this.ctx; const h = c.view.atmo.hour; if (h < 15) { c.hud.toast('Match', 'No match yet. Evening kickoff by 4pm.', 'var(--pur)', 'msg', 3); return; }
    if (!this.match) { const [a, b] = [...this.teams].sort(() => Math.random() - 0.5); this.match = { home: a, away: b, h: 0, a: 0, min: 0 }; }
    const m = this.match;
    const opt = (side: 'h' | 'a' | 'd', label: string) => `<button class="b" data-s="${side}">${label}</button>`;
    this.el.innerHTML = `<div class="bd"><div class="top"><b>${m.home} vs ${m.away}</b><button class="x">✕</button></div><p style="margin:0 0 10px;font-size:13.5px">The boys dey argue. Put ₦5,000 on it?</p><div class="bar">${opt('h', m.home)}${opt('d', 'Draw')}${opt('a', m.away)}<button class="b" data-s="n">Just watch</button></div></div>`; this.el.classList.add('on'); c.setModal(true);
    const go = (s: string) => { this.el.classList.remove('on'); c.setModal(false); if (s !== 'n' && this.pay(5000)) this.bet = { side: s as any, amt: 5000 }; const seat = (this as any)._seats[7]; this.life.doAction({ id: 'watch', label: `Watching ${m.home} vs ${m.away}`, gain: { fun: 60, social: 40, comfort: 20 }, minutes: 90, clip: 'Sitting_Idle_Loop', spot: [0, 0, 0], sitting: true, secs: 60, give: { fun: 45, social: 30, comfort: 15 }, y: 0.02 }, { name: 'match', x: JOINT_ORIGIN.x + seat.x, z: JOINT_ORIGIN.z + seat.z - 0.1, yaw: Math.PI }); };
    this.el.querySelector('.x')!.addEventListener('click', () => { this.el.classList.remove('on'); c.setModal(false); }); this.el.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => go((b as HTMLElement).dataset.s!)));
  }
  private ayo() {
    const c = this.ctx; c.setModal(true); let b = Array(12).fill(4); let me = 0, him = 0; let stake = 2000; let busy = false; let msg = 'Baba Sola: "Small boy, you sabi Ayo? ₦2,000 a game."';
    const draw = (hl: number[] = []) => {
      const pit = (k: number) => `<div class="pit ${k < 6 ? 'me' : ''} ${hl.includes(k) ? 'hl' : ''}" data-k="${k}">${Array.from({ length: Math.min(b[k], 14) }, () => '<i class="seed"></i>').join('')}<span class="n">${b[k]}</span></div>`;
      this.el.innerHTML = `<div class="bd"><div class="top"><b>AYO · vs BABA SOLA</b><span style="font-size:12px;color:#fde68a">Stake ₦${stake.toLocaleString()} · first to 25 seeds</span><button class="x">✕</button></div>
        <div class="row">${[11, 10, 9, 8, 7, 6].map(pit).join('')}</div><div style="height:14px"></div><div class="row">${[0, 1, 2, 3, 4, 5].map(pit).join('')}</div>
        <div class="sc"><span>You: ${me}</span><span>Baba Sola: ${him}</span></div><div class="msg">${msg}</div></div>`;
      this.el.classList.add('on'); this.el.querySelector('.x')!.addEventListener('click', () => { this.el.classList.remove('on'); c.setModal(false); });
      this.el.querySelectorAll('.pit.me').forEach((p) => p.addEventListener('click', () => play(+(p as HTMLElement).dataset.k!)));
    };
    const over = () => { const done = me >= 25 || him >= 25 || !legal(b, true).length || !legal(b, false).length; if (!done) return false;
      if (!legal(b, true).length) him += b.reduce((a, x) => a + x, 0); else if (!legal(b, false).length) me += b.reduce((a, x) => a + x, 0);
      const won = me > him; if (won) { c.sim.cash += stake * 2; sfx('win'); addMoodlet(this.life.needs, 'ayo', 'Beat Baba Sola at Ayo', 10, 6); (c.systems.get('skills') as any)?.addXp?.('street', 30); } else sfx('lose');
      this.life.needs.v.fun = Math.min(100, this.life.needs.v.fun + 25); this.life.needs.v.social = Math.min(100, this.life.needs.v.social + 20);
      msg = won ? 'Baba Sola: "Ehn! Who teach you? Take your money, come back tomorrow."' : 'Baba Sola: "Na so Ayo be. Come learn more, my son."'; draw(); return true; };
    const play = async (k: number) => {
      if (busy || b[k] === 0) return; busy = true; const r = sow(b, k); b = r.b; me += r.got; sfx(r.got ? 'cash' : 'chip'); msg = r.got ? `You captured ${r.got}!` : 'Your move is done.'; draw(r.path.slice(-1)); if (over()) return;
      await new Promise((res) => setTimeout(res, 700)); const m = aiMove(b, 0.75); if (m >= 0) { const q = sow(b, m); b = q.b; him += q.got; msg = q.got ? `Baba Sola captured ${q.got}. "Hehehe."` : 'Baba Sola moves. Your turn.'; draw(q.path.slice(-1)); sfx('chip'); }
      busy = false; over();
    };
    if (!this.pay(stake)) { c.setModal(false); return; } draw();
  }
  private enter() {
    const c = this.ctx; const O = JOINT_ORIGIN; this.people = []; const seats = [...(this as any)._seats].sort(() => Math.random() - 0.5).slice(0, 9);
    for (const s of seats) { const a = c.sim.spawnActor('ped', { x: O.x + s.x, y: 0.05, z: O.z + s.z - 0.05 }); a.yaw = Math.PI; Object.assign(a as any, { _script: true, _keep: true, act: { clip: Math.random() < 0.5 ? 'Sitting_Idle_Loop' : 'Sitting_Talking_Loop', yaw: Math.PI } }); this.people.push(a); }
    const baba = c.sim.randomLook(); Object.assign(baba, { body: 'male', head: 'fila', beard: true, topPattern: 'adire' }); const a = c.sim.spawnActor('vendor', { x: O.x - 5.6, y: 0.05, z: O.z + 10.15 }, baba, 'Baba Sola'); Object.assign(a as any, { _script: true, _keep: true, _vendor: true, act: { clip: 'Sitting_Idle_Loop', yaw: 0 } }); this.people.push(a);
    const mama = c.sim.randomLook(); Object.assign(mama, { body: 'female', topPattern: 'ankara_wave' }); const m = c.sim.spawnActor('vendor', { x: O.x + 5.4, y: 0.05, z: O.z + 10.3 }, mama, 'Mama Cass'); Object.assign(m as any, { _script: true, _keep: true, _vendor: true, act: { clip: 'Idle_Loop', yaw: Math.PI } }); this.people.push(m);
  }
  private exit() { for (const a of this.people) if (!(a as any)._gone) this.ctx.sim.removeActor(a); this.people = []; this.el.classList.remove('on'); }
  private frame(dt: number) {
    this.tvT -= dt; if (this.tvT > 0) return; this.tvT = 0.25; const cv = (this as any)._tvc as HTMLCanvasElement; const k = cv.getContext('2d')!; const t = performance.now() / 1000;
    k.fillStyle = '#2e7d32'; k.fillRect(0, 0, 256, 144); k.strokeStyle = 'rgba(255,255,255,.7)'; k.lineWidth = 2; k.strokeRect(8, 8, 240, 128); k.beginPath(); k.moveTo(128, 8); k.lineTo(128, 136); k.stroke(); k.beginPath(); k.arc(128, 72, 18, 0, 6.28); k.stroke();
    for (let i = 0; i < 10; i++) { k.fillStyle = i < 5 ? '#e53935' : '#1e88e5'; k.fillRect(30 + ((i * 47 + t * 20 * (i % 3 + 1)) % 200), 20 + ((i * 31 + Math.sin(t + i) * 30) % 100 + 100) % 100, 5, 7); }
    k.fillStyle = '#fff'; k.beginPath(); k.arc(128 + Math.sin(t * 0.7) * 90, 72 + Math.cos(t * 1.1) * 45, 3, 0, 6.28); k.fill();
    const m = this.match; if (m) { if ((this.life as any).run && Math.random() < 0.02) { if (Math.random() < 0.5) m.h++; else m.a++; this.ctx.hud.say('Viewers', 'GOAAAAL!', 2); sfx('win'); } k.fillStyle = 'rgba(0,0,0,.6)'; k.fillRect(6, 6, 140, 16); k.fillStyle = '#fff'; k.font = '700 11px Inter'; k.fillText(`${m.home.split(' ')[0]} ${m.h} - ${m.a} ${m.away.split(' ')[0]}`, 10, 18); }
    ((this.tv!.material as THREE.MeshBasicMaterial).map as THREE.Texture).needsUpdate = true;
    // settle the bet when the watch finishes
    const L: any = this.life; if (this.bet && m && !L.run) { const res = m.h > m.a ? 'h' : m.a > m.h ? 'a' : 'd'; if (res === this.bet.side) { const win = this.bet.amt * (res === 'd' ? 3 : 2); this.ctx.sim.cash += win; this.ctx.hud.toast('Full time', `${m.home} ${m.h} - ${m.a} ${m.away}. You won ₦${win.toLocaleString()}!`, 'linear-gradient(160deg,#22c55e,#16a34a)', 'cash', 5); sfx('win'); } else this.ctx.hud.toast('Full time', `${m.home} ${m.h} - ${m.a} ${m.away}. Your money don go.`, 'var(--red)', 'msg', 5); this.bet = null; this.match = null; }
  }
}
