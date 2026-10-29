// Skills, branches ("modes") and perks. Data comes from content/skills.json. Perks change real numbers: this system writes
// the multipliers into sim.mods (read in sim/life.ts) and answers stat('drive.top') style queries for any other system:
//   const sk = ctx.systems.get('skills') as SkillsSystem;  sk.stat('trade.buy')  // 0.9 means 10 percent cheaper
import type { GameCtx, GameSystem } from './registry';
import { STAT_KEYS, type PerkDef, type SkillDef, type StatMod } from '../content/schema';
import { loadGameContent, type GameContent } from '../content/game';
import type { SimEvent } from '../sim/types';

interface SaveSkills { xp: Record<string, number>; perks: string[] }
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

export class SkillsSystem implements GameSystem {
  id = 'skills';
  content!: GameContent;
  st: SaveSkills = { xp: {}, perks: [] };
  private ctx!: GameCtx;
  private mods = new Map<string, { add: number; mul: number }>();
  private perkById = new Map<string, { perk: PerkDef; skill: SkillDef; branch: string }>();
  private view: string | null = null; // skill id whose tree is open in the phone
  stamina = 100; private staWait = 0; private staBar: HTMLElement | null = null; private distAcc = 0;
  /** last toast per skill so level-ups do not stack */
  private lvlSeen: Record<string, number> = {};

  async init(ctx: GameCtx) {
    this.ctx = ctx;
    this.content = await loadGameContent();
    const sv = ctx.save.skills as SaveSkills | undefined; if (sv) this.st = { xp: sv.xp ?? {}, perks: sv.perks ?? [] };
    ctx.save.skills = this.st;
    for (const s of this.content.skills) for (const b of s.branches) for (const p of b.perks) this.perkById.set(p.id, { perk: p, skill: s, branch: b.id });
    for (const s of this.content.skills) this.lvlSeen[s.id] = this.level(s.id);
    this.recompute();
    ctx.hud.appRenderers.Skills = () => this.renderApp();
    const v = document.getElementById('vitals'); if (v) { const d = document.createElement('div'); d.className = 'v'; d.innerHTML = '<i style="display:block;height:100%;border-radius:999px;width:100%;background:linear-gradient(90deg,#e8a21a,#ffd36b);transition:width .15s"></i>'; v.appendChild(d); this.staBar = d.firstElementChild as HTMLElement; d.style.opacity = '0'; d.style.transition = 'opacity .3s'; }
  }

  // ------------------------------------------------------------ levels
  def(id: string) { return this.content.skill.get(id); }
  private needFor(s: SkillDef, L: number) { return Math.round(s.xpBase * Math.pow(L, s.xpPow)); }
  xpOf(id: string) { return this.st.xp[id] ?? 0; }
  level(id: string) {
    const s = this.def(id); if (!s) return 1; let xp = this.xpOf(id), L = 1;
    while (L < s.maxLevel) { const n = this.needFor(s, L); if (xp < n) break; xp -= n; L++; }
    return L;
  }
  progress(id: string) {
    const s = this.def(id); if (!s) return { level: 1, into: 0, need: 1, frac: 0 };
    let xp = this.xpOf(id), L = 1;
    while (L < s.maxLevel) { const n = this.needFor(s, L); if (xp < n) return { level: L, into: xp, need: n, frac: xp / n }; xp -= n; L++; }
    return { level: L, into: 0, need: 1, frac: 1 };
  }
  /** Perk points left in a skill: one per level above 1, minus perks bought. */
  points(id: string) {
    let spent = 0; for (const pid of this.st.perks) { const e = this.perkById.get(pid); if (e && e.skill.id === id) spent += e.perk.cost ?? 1; }
    return Math.max(0, this.level(id) - 1 - spent);
  }
  addXp(id: string, n: number, quiet = false) {
    const s = this.def(id); if (!s || n <= 0) return;
    const before = this.level(id);
    this.st.xp[id] = this.xpOf(id) + n * this.stat('pay.xp');
    const after = this.level(id);
    if (after > before) {
      this.recompute();
      if (!quiet) { this.ctx.hud.toast(`${s.name} level ${after}`, this.points(id) > 0 ? 'You have a perk point to spend. Open Skills on your phone.' : 'You are getting better at this.', 'linear-gradient(160deg,#ff7a9a,#d1306a)', 'star' as any, 5); }
      this.ctx.persist();
    }
  }
  has(perkId: string) { return this.st.perks.includes(perkId); }
  canLearn(perkId: string): string | null {
    const e = this.perkById.get(perkId); if (!e) return 'Unknown perk';
    if (this.has(perkId)) return 'Already learned';
    if (this.level(e.skill.id) < e.perk.level) return `Needs ${e.skill.name} level ${e.perk.level}`;
    for (const r of e.perk.requires ?? []) if (!this.has(r)) return `Needs ${this.perkById.get(r)?.perk.name ?? r} first`;
    if (this.points(e.skill.id) < (e.perk.cost ?? 1)) return 'No perk points left';
    return null;
  }
  learn(perkId: string) { if (this.canLearn(perkId)) return false; this.st.perks.push(perkId); this.recompute(); this.ctx.persist(); return true; }
  /** Wipe perks (keeps xp). Free for now; used by tests. */
  respec() { this.st.perks = []; this.recompute(); this.ctx.persist(); }

  // ------------------------------------------------------------ stats
  private recompute() {
    this.mods.clear();
    const put = (m: StatMod, times = 1) => { const e = this.mods.get(m.stat) ?? { add: 0, mul: 1 }; if (m.add) e.add += m.add * times; if (m.mul) e.mul *= Math.pow(m.mul, times); this.mods.set(m.stat, e); };
    for (const s of this.content.skills) { const L = this.level(s.id); for (const m of s.perLevel) put(m, L - 1); }
    for (const pid of this.st.perks) { const e = this.perkById.get(pid); if (e) for (const m of e.perk.mods) put(m); }
    if (this.ctx?.sim) {
      for (const k of Object.keys(STAT_KEYS)) this.ctx.sim.mods[k] = this.stat(k);
      const me = this.ctx.sim.local; const want = Math.round(100 * this.stat('body.hp'));
      if (me.maxHp !== want) { const f = me.hp / me.maxHp; me.maxHp = want; me.hp = Math.min(want, Math.max(1, f * want)); }
    }
  }
  /** Combined value of a stat: (base + adds) * product of multipliers. */
  stat(key: string): number { const d = STAT_KEYS[key]; const m = this.mods.get(key); return ((d?.base ?? 1) + (m?.add ?? 0)) * (m?.mul ?? 1); }
  /** Total skill level used by dice rolls: skill level plus the talk/haggle bonus for those skills. */
  rollLevel(skill: string) { return this.level(skill) + (skill === 'trade' ? this.stat('trade.haggle') : 0) + (skill === 'charm' ? this.stat('talk.roll') : 0); }
  rollChance(skill: string, dc: number) { return Math.max(0.05, Math.min(0.95, 0.5 + 0.1 * (this.rollLevel(skill) - dc))); }

  // ------------------------------------------------------------ per tick
  step(ctx: GameCtx, dt: number) {
    const me = ctx.sim.local; if (!me.alive) return;
    // stamina
    const cap = 100;
    if (me.sprinting && me.vehicle === null) { this.stamina = Math.max(0, this.stamina - (cap / (11 * this.stat('stamina.max'))) * dt); this.staWait = 1.1; this.addXp('stamina', dt * 0.14, true); }
    else { this.staWait = Math.max(0, this.staWait - dt); if (this.staWait <= 0) this.stamina = Math.min(cap, this.stamina + 18 * this.stat('stamina.regen') * dt); }
    if (this.stamina <= 0.5) ctx.sim.noSprint = true; else if (this.stamina > 22) ctx.sim.noSprint = false;
    // driving and riding practice
    if (me.vehicle !== null && me.seat === 0) {
      const v = ctx.sim.vehicles[me.vehicle]; const sp = Math.abs(v.ctrl.currentVehicleSpeed());
      if (sp > 7) { const id = v.kind === 'okada' || v.kind === 'keke' ? 'ride' : 'drive'; this.distAcc += sp * dt; if (this.distAcc > 120) { this.distAcc = 0; this.addXp(id, 1.8, true); } }
    } else if (me.crouch && me.speed > 0.4) this.addXp('stealth', dt * 0.2, true);
    // announce level-ups that happened quietly
    for (const s of this.content.skills) { const L = this.level(s.id); if (L > (this.lvlSeen[s.id] ?? 1)) { this.lvlSeen[s.id] = L; ctx.hud.toast(`${s.name} level ${L}`, this.points(s.id) > 0 ? 'You have a perk point to spend. Open Skills on your phone.' : 'Keep going.', 'linear-gradient(160deg,#ff7a9a,#d1306a)', 'star' as any, 5); this.recompute(); ctx.persist(); } }
  }
  frame() {
    if (!this.staBar) return; const p = this.staBar.parentElement as HTMLElement;
    this.staBar.style.width = `${Math.max(0, this.stamina)}%`; p.style.opacity = this.stamina < 99 ? '1' : '0';
  }
  onEvent(ctx: GameCtx, e: SimEvent) {
    const me = ctx.sim.local;
    if (e.t === 'hit' && e.by === 0 && e.targetKind === 'actor') { const w = ctx.sim.currentWeapon(me); const melee = !w || (w.id as string) === 'fists' || w.id === 'machete'; this.addXp(melee ? 'fight' : 'shoot', 0.9, true); }
    else if (e.t === 'kill' && e.killer === 0) { const w = ctx.sim.currentWeapon(me); const melee = !w || (w.id as string) === 'fists' || w.id === 'machete'; this.addXp(melee ? 'fight' : 'shoot', 5, true); }
    else if (e.t === 'crime') { if (e.kind === 'cooled') this.addXp('street', 12, true); else this.addXp('street', 1.5, true); }
  }

  // ------------------------------------------------------------ phone app
  private bar(frac: number, color: string) { return `<div style="height:5px;border-radius:3px;background:rgba(255,255,255,.1);margin:5px 0 3px;overflow:hidden"><i style="display:block;height:100%;width:${Math.round(frac * 100)}%;background:${color}"></i></div>`; }
  private renderApp(): string {
    const row = (b: string, s: string, btn?: string) => `<div class="row"><b>${b}</b>${s}${btn ?? ''}</div>`;
    const button = (id: string, label: string, ghost = false) => `<br><button class="btn${ghost ? ' ghost' : ''}" data-app="Skills" data-id="${id}">${label}</button>`;
    if (!this.view) {
      const total = this.content.skills.reduce((a, s) => a + this.points(s.id), 0);
      let html = row('Skills', `Everything you do trains something. ${total > 0 ? `<br><span style="color:#2de0c8">${total} perk point${total > 1 ? 's' : ''} to spend</span>` : 'Level up a skill to earn perk points.'}`);
      for (const s of this.content.skills) {
        const pr = this.progress(s.id); const pts = this.points(s.id);
        html += row(`${esc(s.name)} · Lv ${pr.level}${pts ? ` · ${pts} pt` : ''}`, `${this.bar(pr.frac, s.color)}${esc(s.blurb)}`, button('open:' + s.id, pts ? 'Spend points' : 'Open tree', !pts));
      }
      return html;
    }
    const s = this.def(this.view)!; const pr = this.progress(s.id);
    let html = row(`${esc(s.name)} · Lv ${pr.level}`, `${this.bar(pr.frac, s.color)}${Math.floor(pr.into)} / ${pr.level >= s.maxLevel ? 'max' : pr.need} xp · ${this.points(s.id)} perk point${this.points(s.id) === 1 ? '' : 's'}<br><i style="opacity:.7">Trains: ${esc(s.trains.join(', '))}</i>`, button('close', 'Back to skills', true));
    // the live numbers this skill touches
    const keys = new Set<string>(); for (const m of s.perLevel) keys.add(m.stat); for (const b of s.branches) for (const p of b.perks) for (const m of p.mods) keys.add(m.stat);
    const nums = [...keys].map((k) => { const v = this.stat(k); const d = STAT_KEYS[k]; return `${esc(d?.label ?? k)}: <b style="display:inline">${d?.kind === 'add' ? (v >= 0 ? '+' : '') + v.toFixed(1) : '×' + v.toFixed(2)}</b>`; });
    html += row('Your numbers', nums.join('<br>'));
    for (const b of s.branches) {
      html += row(`${esc(b.name)}`, `<i style="opacity:.75">${esc(b.desc)}</i>`);
      for (const p of b.perks) {
        const own = this.has(p.id); const why = own ? null : this.canLearn(p.id);
        const state = own ? '<span style="color:#49e08a">Learned</span>' : why ? `<span style="opacity:.6">${esc(why)}</span>` : `<span style="color:#2de0c8">Ready</span>`;
        html += row(`${own ? '✓ ' : ''}${esc(p.name)} · tier ${p.tier}`, `${esc(p.desc)}<br>${state}`, !own && !why ? button('learn:' + p.id, `Learn (${p.cost ?? 1} pt)`) : '');
      }
    }
    return html;
  }
  onAction(ctx: GameCtx, app: string, id: string): boolean {
    if (app !== 'Skills') return false;
    if (id.startsWith('open:')) { this.view = id.slice(5); ctx.hud.rowSel = 0; }
    else if (id === 'close') { this.view = null; ctx.hud.rowSel = 0; }
    else if (id.startsWith('learn:')) { if (this.learn(id.slice(6))) ctx.hud.toast('Perk learned', this.perkById.get(id.slice(6))?.perk.name ?? '', 'linear-gradient(160deg,#ff7a9a,#d1306a)', 'star' as any, 3.5); }
    ctx.hud.refreshApp(); const l = document.getElementById('av-l'); if (l && !id.startsWith('learn:')) l.scrollTop = 0;
    return true;
  }
}
export const skills = new SkillsSystem();
