// Careers have ranks, Lagos Life style: every shift, trip, job and gig adds to that career's record. Each rank pays
// more and is announced with a little ceremony. The Career app on the phone shows where you stand in each line.
import type { GameCtx, GameSystem } from '../registry';
import { registerApp } from '../../ui/lifeHud';
import { lifeSystem } from '../life';
import { addMoodlet } from '../life/needs';

export type CareerId = 'transport' | 'mechanic' | 'tech' | 'bank' | 'trader' | 'racer' | 'street' | 'power' | 'agbero' | 'designer';
interface CareerDef { id: CareerId; name: string; ranks: string[]; xp: number[]; unit: string }
export const CAREERS: CareerDef[] = [
  { id: 'transport', name: 'Transport', unit: 'trips', ranks: ['Rookie rider', 'Area rider', 'Union member', 'Park regular', 'Transport oga'], xp: [0, 8, 25, 60, 140] },
  { id: 'mechanic', name: 'Mechanic', unit: 'jobs', ranks: ['Apprentice', 'Spanner boy', 'Journeyman', 'Workshop head', 'Oga mechanic'], xp: [0, 6, 18, 45, 100] },
  { id: 'tech', name: 'Tech', unit: 'gigs', ranks: ['Intern', 'Junior dev', 'Mid-level', 'Senior engineer', 'Founder'], xp: [0, 5, 15, 40, 90] },
  { id: 'bank', name: 'Banking', unit: 'customers', ranks: ['Teller trainee', 'Teller', 'Senior teller', 'Supervisor', 'Branch manager'], xp: [0, 20, 60, 150, 320] },
  { id: 'trader', name: 'Trading', unit: 'deals', ranks: ['Customer', 'Regular', 'Price sabi', 'Market name', 'Iya/Baba Oloja'], xp: [0, 10, 30, 70, 150] },
  { id: 'racer', name: 'Street racing', unit: 'wins', ranks: ['Unknown', 'Local name', 'Hot hands', 'Street legend', 'King of the expressway'], xp: [0, 2, 6, 15, 35] },
  { id: 'power', name: 'Power', unit: 'tasks', ranks: ['Meter reader', 'Lineman', 'Shift operator', 'Control engineer', 'Chief engineer'], xp: [0, 10, 30, 75, 160] },
  { id: 'agbero', name: 'Park union', unit: 'tickets', ranks: ['Area boy', 'Ticket boy', 'Agbero', 'Park marshal', 'Park chairman'], xp: [0, 25, 80, 200, 450] },
  { id: 'designer', name: 'Interior design', unit: 'rooms', ranks: ['Helper', 'Decorator', 'Designer', 'Senior designer', 'Studio owner'], xp: [0, 3, 10, 25, 60] },
  { id: 'street', name: 'Street', unit: 'lifts', ranks: ['Nobody', 'Small boy', 'Known face', 'Feared', 'Area father'], xp: [0, 5, 15, 40, 90] },
];

class Ranks {
  S: Record<string, number> = {};
  constructor(private ctx: GameCtx) {}
  init() {
    this.S = { ...(this.ctx.save.careers ?? {}) };
    registerApp('Career', 'M4 20h16M6 20V10l6-5 6 5v10M10 20v-5h4v5', 'linear-gradient(160deg,#8b5cf6,#4c1d95)', () => this.html());
    (window as any).__ranks = this;
  }
  rankOf(id: CareerId) { const d = CAREERS.find((c) => c.id === id)!; const n = this.S[id] ?? 0; let r = 0; for (let i = 0; i < d.xp.length; i++) if (n >= d.xp[i]) r = i; return r; }
  /** pay multiplier: +12% a rank */
  mult(id: CareerId) { return 1 + this.rankOf(id) * 0.12; }
  add(id: CareerId, n = 1) {
    const before = this.rankOf(id); this.S[id] = (this.S[id] ?? 0) + n; const after = this.rankOf(id);
    this.ctx.save.careers = this.S; this.ctx.persist();
    if (after > before) {
      const d = CAREERS.find((c) => c.id === id)!; this.ctx.hud.title('PROMOTED', `${d.name}: ${d.ranks[after]} · pay +${after * 12}%`, 4);
      const L = lifeSystem.api; if (L) addMoodlet(L.needs, 'promoted', `Promoted to ${d.ranks[after]}`, 12, 12);
    }
  }
  private html() {
    return CAREERS.map((d) => { const n = this.S[d.id] ?? 0; const r = this.rankOf(d.id); const next = d.xp[r + 1]; const p = next ? Math.min(1, (n - d.xp[r]) / (next - d.xp[r])) : 1;
      return `<div class="row"><b>${d.name} · ${d.ranks[r]}</b>${next ? `${n} ${d.unit}, next rank at ${next}` : `${n} ${d.unit}, top of the game`}<div style="height:5px;border-radius:3px;background:rgba(255,255,255,.1);margin-top:6px;overflow:hidden"><i style="display:block;height:100%;width:${Math.round(p * 100)}%;background:linear-gradient(90deg,#8b5cf6,#2de0c8)"></i></div></div>`; }).join('');
  }
}
let R: Ranks | null = null;
export const ranksSystem: GameSystem & { get api(): Ranks | null } = { id: 'ranks', get api() { return R; }, init(ctx) { R = new Ranks(ctx); R.init(); } };
/** for the career systems: record progress and get the pay multiplier (1 when the ranks system is absent) */
export const career = { add: (id: CareerId, n = 1) => R?.add(id, n), mult: (id: CareerId) => R?.mult(id) ?? 1, rank: (id: CareerId) => R?.rankOf(id) ?? 0 };
