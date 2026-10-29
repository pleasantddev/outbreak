// Society content: npcs.json and economy.json indexed for fast lookup, plus the pure generators for names, traits and
// backstories. Everything here is deterministic from a seed and has no dependency on the renderer or the sim.
import type { EcoGood, EcoMacro, EcoRent, EcoShock, EcoSink, EcoWage, NpcCityEvent, NpcFaction, NpcNames, NpcOccupation, NpcTaunt, NpcTrait, NpcBackstory } from '../content/schema';
import { Rng } from '../sim/rng';

export const STATES: Record<string, string[]> = {
  yoruba: ['Ogun', 'Oyo', 'Osun', 'Ondo', 'Ekiti', 'Kwara'],
  igbo: ['Anambra', 'Imo', 'Enugu', 'Abia', 'Ebonyi'],
  hausa: ['Kano', 'Kaduna', 'Katsina', 'Sokoto', 'Bauchi'],
  other: ['Edo', 'Delta', 'Rivers', 'Cross River', 'Akwa Ibom', 'Bayelsa'],
};
export const ETH = ['yoruba', 'igbo', 'hausa', 'other'] as const;

export class Content {
  names: NpcNames[] = []; occ: NpcOccupation[] = []; occIdx = new Map<string, number>();
  factions = new Map<string, NpcFaction>(); traits: NpcTrait[] = []; backstory: NpcBackstory[] = []; taunts = new Map<string, NpcTaunt[]>();
  events: NpcCityEvent[] = [];
  goods: EcoGood[] = []; goodIdx = new Map<string, number>(); wages = new Map<string, EcoWage>(); rent!: EcoRent; shocks = new Map<string, EcoShock>(); sinks = new Map<string, EcoSink>(); macro!: EcoMacro;
  private nameCum: number[] = []; private traitCum: number[] = [];

  static from(npcs: any[], eco: any[]): Content {
    const c = new Content();
    for (const it of npcs) {
      switch (it.kind) {
        case 'names': c.names.push(it); break;
        case 'occupation': c.occIdx.set(it.id, c.occ.length); c.occ.push(it); break;
        case 'faction': c.factions.set(it.id.replace(/^fac\./, ''), it); break;
        case 'trait': c.traits.push(it); break;
        case 'backstory': c.backstory.push(it); break;
        case 'taunt': { const l = c.taunts.get(it.when) ?? []; l.push(it); c.taunts.set(it.when, l); break; }
        case 'cityEvent': c.events.push(it); break;
      }
    }
    for (const it of eco) {
      switch (it.kind) {
        case 'good': c.goodIdx.set(it.id, c.goods.length); c.goods.push(it); break;
        case 'wage': c.wages.set(it.id, it); break;
        case 'rent': c.rent = it; break;
        case 'shock': c.shocks.set(it.id, it); break;
        case 'sink': c.sinks.set(it.id, it); break;
        case 'macro': c.macro = it; break;
      }
    }
    c.macro ??= { id: 'macro.main', kind: 'macro', inflationPerYear: 0.2, dayPerYear: 90 };
    c.rent ??= { id: 'rent.room', kind: 'rent', label: 'Room', poor: 190000, rich: 1700000 };
    let a = 0; for (const n of c.names) { a += n.weight; c.nameCum.push(a); }
    a = 0; for (const t of c.traits) { a += t.weight; c.traitCum.push(a); }
    return c;
  }
  get ok() { return this.names.length > 0 && this.occ.length > 0 && this.goods.length > 0; }
  sink(id: string, dflt: number) { return this.sinks.get('sink.' + id)?.rate ?? dflt; }
  good(id: string) { return this.goodIdx.get('good.' + id) ?? -1; }

  pickEth(r: Rng) { const t = r.next() * this.nameCum[this.nameCum.length - 1]; for (let i = 0; i < this.nameCum.length; i++) if (t <= this.nameCum[i]) return i; return 0; }
  pickTrait(r: Rng, not: number[] = []) { for (let k = 0; k < 8; k++) { const t = r.next() * this.traitCum[this.traitCum.length - 1]; for (let i = 0; i < this.traitCum.length; i++) if (t <= this.traitCum[i]) { if (!not.includes(i)) return i; break; } } return 0; }
  /** weighted occupation, filtered so a market woman is never a man and a student is never forty */
  pickOcc(r: Rng, female: boolean, age: number, rich: number) {
    let tot = 0; const w: number[] = [];
    for (let i = 0; i < this.occ.length; i++) {
      const o = this.occ[i]; let x = o.weight;
      if (age < o.age[0] - 2 || age > o.age[1] + 4) x = 0;
      else x *= female ? Math.max(0.02, o.female) : Math.max(0.02, 1 - o.female);
      if (rich < o.rich[0] - 0.2 || rich > o.rich[1] + 0.25) x *= 0.12;
      w.push(x); tot += x;
    }
    if (tot <= 0) return this.occIdx.get('occ.unemployed') ?? 0;
    let t = r.next() * tot; for (let i = 0; i < w.length; i++) { t -= w[i]; if (t <= 0) return i; }
    return 0;
  }
}

export async function loadContent(base = 'content/'): Promise<Content | null> {
  try {
    const [a, b] = await Promise.all([fetch(base + 'npcs.json').then((r) => r.json()), fetch(base + 'economy.json').then((r) => r.json())]);
    const c = Content.from(a.items ?? [], b.items ?? []);
    return c.ok ? c : null;
  } catch { return null; }
}

export function hash32(...n: number[]) { let h = 2166136261; for (const v of n) { h ^= v | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; } return h >>> 0; }
export const hash01 = (...n: number[]) => (hash32(...n) % 100000) / 100000;

export interface PersonSeed { eth: number; female: boolean; first: string; last: string; age: number; faith: 0 | 1 | 2 }
export function genPerson(c: Content, r: Rng, female: boolean, age: number): PersonSeed {
  const eth = c.pickEth(r); const nm = c.names[eth];
  const first = r.pick(female ? nm.female : nm.male), last = r.pick(nm.surnames);
  const x = r.next(); const faith: 0 | 1 | 2 = x < nm.faith.christian ? 1 : x < nm.faith.christian + nm.faith.muslim ? 2 : 0;
  return { eth, female, first, last, age, faith };
}

const pron = (female: boolean) => female ? { He: 'She', he: 'she', his: 'her', him: 'her', His: 'Her' } : { He: 'He', he: 'he', his: 'his', him: 'him', His: 'His' };

export interface StoryIn { seed: number; first: string; last: string; female: boolean; age: number; eth: number; occ: number; area: string }
/** Three sentences, built from template parts. Deterministic from the citizen's seed. */
export function backstoryOf(c: Content, s: StoryIn): string {
  const r = new Rng(s.seed ^ 0x9e3779b9); const p = pron(s.female); const occ = c.occ[s.occ];
  const ethName = ETH[s.eth];
  const ok = (b: NpcBackstory) => (b.minAge === undefined || s.age >= b.minAge) && (b.maxAge === undefined || s.age <= b.maxAge) && (!b.occ || b.occ.includes(occ.id)) && (!b.eth || b.eth.includes(ethName));
  const pickSlot = (slot: NpcBackstory['slot']) => { const l = c.backstory.filter((b) => b.slot === slot && ok(b)); const pri = l.filter((b) => b.occ); const pool = pri.length && r.chance(0.5) ? pri : l; return pool.length ? r.pick(pool).text : ''; };
  const state = r.pick(STATES[ethName]); const yrs = Math.max(2, Math.min(s.age - 18, r.int(3, 20)));
  const fill = (t: string) => t.replace(/\{Name\}/g, s.first).replace(/\{name\}/g, `${s.first} ${s.last}`).replace(/\{area\}/g, s.area).replace(/\{state\}/g, state).replace(/\{yrs\}/g, String(yrs)).replace(/\{(He|he|his|him|His)\}/g, (_, k) => (p as any)[k]);
  const job = occ.tales.length ? r.pick(occ.tales) : '';
  const parts = [pickSlot('origin'), job, pickSlot('turn'), pickSlot('ambition')].filter(Boolean).map(fill);
  return parts.join(' ');
}
export const TITLE_CASE = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
