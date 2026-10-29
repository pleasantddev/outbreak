// "The Boys": a crew that hangs at a cyber café corner near your street after dark, in designer everything, playing
// loud music from a parked Benz. A satire of the yahoo lifestyle, not a guide to it: the "work" is never shown, only
// the swagger, the paranoia, the money that comes in fits and starts, your mother's calls, and the EFCC knock that
// always comes. Joining is a choice with a cost.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import type { Actor } from '../../sim/types';
import { lifeSystem, type Thing } from '../life';
import { addMoodlet } from '../life/needs';
import { sfx } from '../leisure/sfx';

const css = `
#yb{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translate(-50%,20px);opacity:0;pointer-events:none;transition:.2s;z-index:9;width:min(520px,94vw);border-radius:22px;padding:16px 18px;background:rgba(10,10,14,.92);border:1px solid rgba(212,175,55,.35);backdrop-filter:blur(16px);font-family:Inter,sans-serif;color:#f3f5f8}
#yb.on{opacity:1;transform:translate(-50%,0);pointer-events:auto} #yb h4{margin:0 0 4px;font:800 18px Rajdhani,Inter;letter-spacing:1.5px;color:#d4af37} #yb p{margin:0 0 12px;font-size:13.5px;line-height:1.45;color:#e5e5e5}
#yb .o{display:grid;gap:7px} #yb button{padding:11px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;font:700 13px Inter;cursor:pointer;text-align:left} #yb button:hover{border-color:#d4af37} #yb button i{display:block;font-style:normal;font-size:11px;color:#a3a3a3;font-weight:600;margin-top:2px}
#yb .heat{height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden;margin:-4px 0 12px} #yb .heat i{display:block;height:100%;background:linear-gradient(90deg,#facc15,#ef4444)}
`;
interface St { joined: boolean; heat: number; days: number; total: number; quit: boolean; lastPing: number; mumCalls: number }
const pick = <T>(l: T[]) => l[(Math.random() * l.length) | 0];

class Boys {
  private el!: HTMLElement; S!: St; private crew: Actor[] = []; private car: any = null; private spot: { x: number; z: number; yaw: number } | null = null; private pingT = 120; private raidPending = false;
  constructor(private ctx: GameCtx) {}
  get life() { return lifeSystem.api!; }
  init() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); this.el = document.createElement('div'); this.el.id = 'yb'; document.body.appendChild(this.el);
    this.S = Object.assign({ joined: false, heat: 0, days: 0, total: 0, quit: false, lastPing: 0, mumCalls: 0 }, this.ctx.save.boys ?? {}); this.life.providers.push(() => this.things());
    addEventListener('keydown', (e) => { if (!this.el.classList.contains('on')) return; const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code); if (n >= 0) { (this.el.querySelectorAll('[data-i]')[n] as HTMLElement | undefined)?.click(); e.preventDefault(); e.stopPropagation(); } if (e.code === 'Escape') this.close(); }, true);
    (window as any).__boys = this;
  }
  private persist() { this.ctx.save.boys = this.S; this.ctx.persist(); }
  private night() { const h = this.ctx.view.atmo.hour; return h >= 19 || h < 3; }
  frame(dt: number) {
    const c = this.ctx; const me = c.sim.local; const L = this.life; const d = L.S.door;
    if (!this.spot && d) this.spot = { x: d.x + Math.sin(d.yaw) * 16 + Math.cos(d.yaw) * 22, z: d.z + Math.cos(d.yaw) * 16 - Math.sin(d.yaw) * 22, yaw: d.yaw + Math.PI / 2 };
    const sp = this.spot; if (sp) {
      const near = Math.hypot(sp.x - me.pos.x, sp.z - me.pos.z) < 90 && !L.inside;
      if (near && this.night() && !this.crew.length && !this.S.quit) this.spawn(sp);
      if ((!near || !this.night()) && this.crew.length) this.despawn();
    }
    if (this.S.joined && !this.S.quit) {
      this.pingT -= dt * L.ctx.view.timeScale; if (this.pingT <= 0) { this.pingT = 240 + Math.random() * 240; this.ping(); }
      if (this.S.heat >= 1 && !this.raidPending) { this.raidPending = true; setTimeout(() => this.raid(), 15000); c.hud.toast('Unknown number', '"Guy, EFCC don carry Lexus and Shege. Dem dey find the rest. Hide your phone."', 'var(--red)', 'msg', 6); }
    }
  }
  private spawn(sp: { x: number; z: number; yaw: number }) {
    const c = this.ctx; const fx = Math.sin(sp.yaw), fz = Math.cos(sp.yaw);
    this.car = c.sim.addVehicle('jeep', { x: sp.x, y: 0.1, z: sp.z }, sp.yaw, true); (this.car as any)._keep = true;
    const names = ['Lexus', 'Shege', 'Daddy Wire', 'Big Boy Stunna']; const clips = ['Idle_FoldArms_Loop', 'Dance_Loop', 'Idle_TalkingPhone_Loop', 'Idle_Talking_Loop'];
    names.forEach((n, i) => { const lk = c.sim.randomLook(); Object.assign(lk, { body: 'male', topPattern: i % 2 ? 'solid' : 'ankara_wave', topColor: ['#d4af37', '#ffffff', '#111111', '#7b1fa2'][i], head: i === 0 ? 'cap' : 'none', model: i === 2 ? 'rogue' : 'survivor' });
      const a = c.sim.spawnActor('vendor', { x: sp.x + Math.cos(sp.yaw) * 3 + fx * (i * 1.4 - 2), y: 0.05, z: sp.z - Math.sin(sp.yaw) * 3 + fz * (i * 1.4 - 2) }, lk, n); Object.assign(a as any, { _script: true, _keep: true, _vendor: true, act: { clip: clips[i], yaw: sp.yaw - Math.PI / 2 } }); this.crew.push(a); });
  }
  private despawn() { for (const a of this.crew) if (!(a as any)._gone) this.ctx.sim.removeActor(a); this.crew = []; if (this.car) { (this.car as any)._keep = false; this.car = null; } }
  private things(): Thing[] { const a = this.crew[0]; if (!a || !this.spot) return []; return [{ id: 'boys', name: 'The Boys', x: a.pos.x, z: a.pos.z, yaw: a.yaw, actions: [], kind: 'object', reach: 4.5, verb: this.S.joined ? 'Link up with the boys' : 'Talk to the boys', open: () => this.talk() }]; }
  private card(title: string, text: string, opts: [string, string, () => void][]) {
    this.ctx.setModal(true); this.el.innerHTML = `<h4>${title}</h4><p>${text}</p>${this.S.joined ? `<div class="heat"><i style="width:${Math.min(100, this.S.heat * 100)}%"></i></div>` : ''}<div class="o">${opts.map(([t, s], i) => `<button data-i="${i}">${t}<i>${s}</i></button>`).join('')}</div>`; this.el.classList.add('on');
    this.el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => opts[+(b as HTMLElement).dataset.i!][2]()));
  }
  close() { this.el.classList.remove('on'); this.ctx.setModal(false); }
  private talk() {
    const S = this.S; const c = this.ctx;
    if (!S.joined) return this.card('THE BOYS', '"My guy! See your shoe. You never tire to dey suffer? Na laptop and sense we dey use. Join us, by December you go dey drive this kind motor."', [
      ['"Wetin una dey do exactly?"', 'Ask', () => this.card('THE BOYS', '"Ah, na \'business\'. Foreign clients. No ask too much question. EFCC no fit catch who sabi."', [['"I dey in."', 'Join the boys. Money, paranoia, consequences.', () => this.join()], ['"No be my lane."', 'Walk away', () => { this.close(); c.hud.say('Lexus', 'Oya suffer dey go. When you ready, you know where we dey.', 3); }]])],
      ['"I dey in."', 'Join the boys', () => this.join()],
      ['"No thanks, I go hustle my own."', 'They respect it. Sort of.', () => { this.close(); addMoodlet(this.life.needs, 'principled', 'Stayed on my lane', 4, 6); c.hud.say('Shege', 'Na your choice. Hustle no be crime o!', 3); }],
    ]);
    this.card('THE BOYS', pick(['"Guy, today na today. Client don dey reply."', '"See am! The man wey dey shine. Small small you go reach us."', '"Network bad, client dey owe. Wahala."']) + `<br><br><i style="color:#a3a3a3;font-style:normal">Heat: ${Math.round(S.heat * 100)}%. ${S.total ? `So far: ₦${S.total.toLocaleString()}.` : ''}</i>`, [
      ['Spray money with them', '₦20,000 · big fun, big heat', () => { if (c.sim.cash < 20000) return; c.sim.cash -= 20000; this.life.needs.v.fun = Math.min(100, this.life.needs.v.fun + 30); this.life.needs.v.social = Math.min(100, this.life.needs.v.social + 25); S.heat += 0.08; addMoodlet(this.life.needs, 'spray', 'Sprayed money like a big boy', 10, 4); sfx('cash'); this.close(); this.persist(); }],
      ['Lie low for a while', 'Heat cools slowly', () => { S.heat = Math.max(0, S.heat - 0.15); this.close(); this.persist(); c.hud.toast('Laying low', 'You switch off the phone for the week. Heat cools a little.', 'var(--pur)', 'msg', 3.5); }],
      ['Quit the life', 'For good. They will not like it.', () => { S.quit = true; S.joined = false; this.close(); this.persist(); addMoodlet(this.life.needs, 'free', 'Walked away from it', 12, 24); c.hud.say('Daddy Wire', 'You don turn pastor? Okay o. No ever mention our name anywhere.', 4); }],
      ['Leave', '', () => this.close()],
    ]);
  }
  private join() { this.S.joined = true; this.S.days = 0; this.pingT = 60; this.close(); this.persist(); this.ctx.hud.title('THE BOYS', 'You are in. Your phone will ring. So will your conscience.', 3.5); }
  /** what happens to a member: money comes or it does not, mum calls, heat rises */
  private ping() {
    const c = this.ctx; const S = this.S; const L = this.life; S.days++; const roll = Math.random(); S.heat = Math.min(1.05, S.heat + 0.06 + Math.random() * 0.06);
    if (roll < 0.45) { c.hud.toast('The boys', pick(['"Client don block us. Today no show."', '"Network no gree. Tomorrow."', '"Na scam the scammer scam us this time. Lol."']), 'linear-gradient(160deg,#3f3f46,#18181b)', 'msg', 4.5); addMoodlet(L.needs, 'paranoid', 'Paranoid about every knock', -6, 6); }
    else if (roll < 0.9) { const n = Math.round((60000 + Math.random() * 240000) / 1000) * 1000; c.sim.cash += n; S.total += n; c.sim.events.push({ t: 'cash', actor: c.sim.local.id, amount: n } as any); sfx('cash'); c.hud.toast('Alert!', `₦${n.toLocaleString()} landed. Your share.`, 'linear-gradient(160deg,#d4af37,#8a6d1c)', 'cash', 4.5); addMoodlet(L.needs, 'flashy', 'Feeling like a big boy', 8, 4); }
    else { const n = 1500000; c.sim.cash += n; S.total += n; S.heat += 0.25; sfx('win'); c.hud.title('BIG HIT', `₦${n.toLocaleString()}. Everybody will notice.`, 3); }
    if (S.days % 2 === 0) { S.mumCalls++; setTimeout(() => { c.hud.toast('Mummy', pick(['"My son, I heard you bought a new phone. Where is this money coming from?"', '"Pastor said I should ask you what work you are doing now."', '"I am not sleeping well. Please, whatever it is, stop."']), 'linear-gradient(160deg,#f472b6,#9d174d)', 'msg', 6); addMoodlet(L.needs, 'mum', 'Mum is worried', -10, 12); }, 5000); }
    this.persist();
  }
  /** the knock: EFCC at your door, wanted level, and the boys pretend not to know you */
  private raid() {
    const c = this.ctx; this.raidPending = false; this.S.heat = 0.3; this.S.joined = false; this.S.quit = true; this.persist();
    c.hud.title('EFCC!', 'Run, or hand yourself in. The boys are not picking your calls.', 4); c.sim.crime('efcc', 3, c.sim.local.pos);
    const lost = Math.round(c.sim.cash * 0.6); c.sim.cash -= lost; c.hud.toast('Accounts frozen', `₦${lost.toLocaleString()} seized.`, 'var(--red)', 'cash', 5); addMoodlet(this.life.needs, 'raided', 'Raided by EFCC', -30, 24);
  }
}
let B: Boys | null = null;
export const boysSystem: GameSystem = { id: 'boys', init(ctx) { B = new Boys(ctx); B.init(); }, frame(_c, dt) { B?.frame(dt); } };
void THREE;
