// Pickpocketing. Crouch behind somebody in a crowd and a prompt appears. A needle sweeps across a dial; stop it in the
// green and the wallet is yours. Miss and they shout "Ole!" and the street turns on you. Stealth makes the window
// wider; markets and bus stops are rich hunting grounds. Satire of street crime, with consequences, not a manual.
import type { GameCtx, GameSystem } from '../registry';
import type { Actor, Command } from '../../sim/types';
import { RT } from '../societyRuntime';
import { sfx } from '../leisure/sfx';
import { earn } from '../money';
import { career } from './ranks';

const css = `
#pp{position:fixed;left:50%;top:58%;transform:translate(-50%,-50%);z-index:9;display:none;width:260px;text-align:center;font-family:Inter,sans-serif;color:#fff}
#pp.on{display:block} #pp .dial{position:relative;height:26px;border-radius:13px;background:rgba(12,14,22,.8);border:1px solid rgba(255,255,255,.18);overflow:hidden}
#pp .zone{position:absolute;top:0;bottom:0;background:linear-gradient(90deg,#16a34a,#49e08a)} #pp .nd{position:absolute;top:-3px;bottom:-3px;width:4px;border-radius:2px;background:#fff;box-shadow:0 0 10px #fff}
#pp b{display:block;margin-bottom:8px;font:800 15px Rajdhani,Inter;letter-spacing:2px;text-shadow:0 2px 6px rgba(0,0,0,.6)} #pp i{display:block;margin-top:6px;font-style:normal;font-size:11.5px;color:#cfd5e1;text-shadow:0 1px 4px rgba(0,0,0,.8)}
`;
class Thief {
  private el!: HTMLElement; private game: { a: Actor; t: number; z0: number; z1: number; speed: number } | null = null; private cool = new Map<number, number>(); private target: Actor | null = null;
  constructor(private ctx: GameCtx) {}
  init() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this.el = document.createElement('div'); this.el.id = 'pp'; document.body.appendChild(this.el);
    addEventListener('keydown', (e) => { if (this.game && (e.code === 'KeyE' || e.code === 'Space' || e.code === 'KeyF')) { this.strike(); e.preventDefault(); e.stopPropagation(); } }, true);
    this.el.addEventListener('pointerdown', () => this.game && this.strike());
  }
  private stealth() { return ((this.ctx.systems.get('skills') as any)?.level?.('stealth') ?? 1) as number; }
  /** someone you are behind, close, not looking at you */
  private victim(): Actor | null {
    const c = this.ctx; const me = c.sim.local; if (me.vehicle !== null || !me.crouch || (c.systems.get('life') as any)?.api?.inside) return null;
    let best: Actor | null = null, bd = 1.5;
    for (const a of c.sim.actors) {
      if (a === me || !a.alive || a.vehicle !== null || (a as any)._gone || (a as any)._vendor || a.role === 'police' || a.role === 'driver') continue;
      const dx = a.pos.x - me.pos.x, dz = a.pos.z - me.pos.z; const d = Math.hypot(dx, dz); if (d > bd) continue;
      const behind = (dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw)) / d; if (behind < 0.3) continue; // they face away from you
      if ((this.cool.get(a.id) ?? -1) > c.view.time) continue; best = a; bd = d;
    }
    return best;
  }
  filterCommand(cmd: Command) {
    if (this.game) { cmd.mx = cmd.mz = 0; cmd.interact = false; cmd.fire = false; return; }
    this.target = this.victim();
    if (this.target && cmd.interact) { cmd.interact = false; this.begin(this.target); }
  }
  private begin(a: Actor) {
    const lvl = this.stealth(); const crowd = this.ctx.sim.actors.filter((o) => o.alive && o.vehicle === null && Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z) < 8).length;
    const w = Math.min(0.32, 0.1 + lvl * 0.018 + Math.min(6, crowd) * 0.01); const z0 = 0.15 + Math.random() * (0.85 - w - 0.15);
    this.game = { a, t: 0, z0, z1: z0 + w, speed: 1.1 + Math.random() * 0.5 }; (a as any)._script = true; a.cmd = { ...a.cmd, mx: 0, mz: 0 } as any;
    this.el.innerHTML = `<b>EASY... EASY...</b><div class="dial"><div class="zone" style="left:${z0 * 100}%;width:${w * 100}%"></div><div class="nd" id="pp-n"></div></div><i>E or tap to lift it. Crowds hide you.</i>`; this.el.classList.add('on');
  }
  frame(dt: number) {
    const g = this.game; if (!g) return; g.t += dt * g.speed; const x = (Math.sin(g.t * 2.4 - Math.PI / 2) + 1) / 2; (this.el.querySelector('#pp-n') as HTMLElement).style.left = `calc(${x * 100}% - 2px)`;
    if (g.t > 4.2) this.fail(g.a, 'They felt something and turned around.');
  }
  private strike() {
    const g = this.game!; const x = (Math.sin(g.t * 2.4 - Math.PI / 2) + 1) / 2;
    if (x >= g.z0 && x <= g.z1) this.success(g.a); else this.fail(g.a, '');
  }
  private close(a: Actor) { this.el.classList.remove('on'); this.game = null; (a as any)._script = false; this.cool.set(a.id, this.ctx.view.time + 600); }
  private success(a: Actor) {
    const c = this.ctx; this.close(a); const cit = (a as any).cid !== undefined ? RT.soc?.get((a as any).cid) : undefined;
    const rich = cit ? 0.5 + Math.max(0, Math.min(1, cit.hrich)) * 2.5 : 1; const amt = Math.round((400 + Math.random() * 3500) * rich / 50) * 50;
    earn(c, amt, 'street'); career.add('street'); sfx('cash');
    (c.systems.get('skills') as any)?.addXp?.('stealth', 14); c.hud.toast('Lifted', `₦${amt.toLocaleString()} from ${a.name}. Walk, don't run.`, 'linear-gradient(160deg,#334155,#0f172a)', 'cash', 3.5);
    if (cit && RT.nem) setTimeout(() => RT.nem!.remember(cit, 'robbed', a.pos, 'wallet vanished', 0.2), 20000);
  }
  private fail(a: Actor, why: string) {
    const c = this.ctx; this.close(a); const me = c.sim.local;
    c.hud.say(a.name, ['Ole! Ole! Thief!', 'Hold am! Thief!', 'My wallet! Ole o!'][(Math.random() * 3) | 0], 3); if (why) c.hud.toast('Caught', why, 'var(--red)', 'msg', 3);
    c.sim.crime('theft', 1, me.pos); sfx('lose');
    // the crowd joins in: bystanders within 25 m give chase
    for (const o of c.sim.actors) if (o !== me && o.alive && o.vehicle === null && !(o as any)._vendor && o.role !== 'police' && Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z) < 25 && Math.random() < 0.55) { const b = c.sim.brainOf(o.id); if (b) { b.kind = 'fight'; b.target = me.id; (b as any).t = 25; } o.hostile = 1; }
    const cit = (a as any).cid !== undefined ? RT.soc?.get((a as any).cid) : undefined; if (cit && RT.nem) RT.nem.remember(cit, 'hurt', a.pos, 'tried to rob me', 0.5);
  }
  prompt() { if (this.game) return null; return this.target ? `<kbd>E</kbd>Pickpocket ${this.target.name}` : null; }
}
let T: Thief | null = null;
export const thiefSystem: GameSystem = {
  id: 'thief',
  init(ctx) { T = new Thief(ctx); T.init(); },
  filterCommand(_c, cmd) { T?.filterCommand(cmd); },
  frame(_c, dt) { T?.frame(dt); },
  prompt() { return T?.prompt() ?? null; },
};
