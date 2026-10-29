// The city economy: prices that move because citizens buy, sell, work and fall out of work.
// Demand is measured from what the active citizens actually purchase; supply from how many sellers are actually
// working (a market fire or an okada ban takes sellers away). Shocks from city events multiply on top.
import { Content } from './societyData';
import { CELL } from './societyModel';

export interface PriceRow { id: string; label: string; unit: string; price: number; base: number; change: number; hist: number[] }
export interface NewsItem { t: number; text: string; kind: string; x?: number; z?: number; hot?: boolean }

const REG = 500; // rent and land indices are kept per 500 m block
const rk = (x: number, z: number) => Math.floor(x / REG) * 4096 + Math.floor(z / REG);

export class Economy {
  price: Float64Array; base: Float64Array; prev: Float64Array; hist: number[][];
  /** units bought since the last hourly update, and the units the sample would buy at baseline */
  demand: Float64Array; supplySeen: Float64Array; supplyExp: Float64Array; popSeen = 0;
  shocks = new Map<string, number>(); // shock id -> until minute
  infl = 1; lastHour = -1; lastDay = -1;
  rent = new Map<number, number>(); land = new Map<number, number>();
  /** sellers of each good, by occupation id (from the wage links) */
  sellers: number[][];
  macro = { employed: 0.8, poor: 0.2, wealth: 1, crime: 0.1, fuelScarce: 0 };
  news: NewsItem[] = [];
  volume = 0;
  constructor(public C: Content) {
    const n = C.goods.length;
    this.price = new Float64Array(n); this.base = new Float64Array(n); this.prev = new Float64Array(n);
    this.demand = new Float64Array(n); this.supplySeen = new Float64Array(n); this.supplyExp = new Float64Array(n);
    this.hist = C.goods.map(() => []);
    C.goods.forEach((g, i) => { this.price[i] = this.base[i] = this.prev[i] = g.base; this.hist[i] = [g.base]; });
    this.sellers = C.goods.map(() => []);
    C.occ.forEach((o, oi) => { const w = C.wages.get(o.wage); if (w?.link) { const gi = C.goodIdx.get(w.link); if (gi !== undefined) this.sellers[gi].push(oi); } });
    const fa = C.occIdx.get('occ.fuel_attendant'); const fu = C.good('fuel'); if (fa !== undefined && fu >= 0) this.sellers[fu].push(fa);
  }
  p(id: string) { const i = this.C.good(id); return i >= 0 ? this.price[i] : 0; }
  /** price relative to the baseline, 1 = normal */
  mult(id: string) { const i = this.C.good(id); return i >= 0 ? this.price[i] / this.base[i] : 1; }
  buy(gi: number, qty: number) { this.demand[gi] += qty; this.volume += qty * this.price[gi]; }
  addNews(t: number, text: string, kind: string, x?: number, z?: number, hot = false) { this.news.unshift({ t, text, kind, x, z, hot }); if (this.news.length > 60) this.news.length = 60; }

  shock(id: string, untilMin: number) { if (this.C.shocks.has(id)) this.shocks.set(id, Math.max(untilMin, this.shocks.get(id) ?? 0)); }
  hasShock(id: string) { return this.shocks.has(id); }
  private shockMult(gid: string) { let m = 1; for (const id of this.shocks.keys()) { const s = this.C.shocks.get(id); const v = s?.mult[gid]; if (v) m *= v; } return m; }

  /** Once per game hour: move prices toward what the sample says the market wants. */
  hourly(minute: number, nPop: number, working: Float64Array, expected: Float64Array, now: { poor: number; employed: number; wealth: number; crime: number }) {
    for (const [id, until] of this.shocks) if (until <= minute) this.shocks.delete(id);
    const C = this.C; this.macro.poor = now.poor; this.macro.employed = now.employed; this.macro.wealth = now.wealth; this.macro.crime = now.crime;
    const day = Math.floor(minute / 1440);
    if (this.lastDay !== day) {
      const dly = Math.pow(1 + C.macro.inflationPerYear, 1 / C.macro.dayPerYear);
      if (this.lastDay >= 0) this.infl *= dly * Math.pow(dly, Math.min(5, day - this.lastDay - 1));
      for (let g = 0; g < C.goods.length; g++) { this.hist[g].push(this.price[g]); if (this.hist[g].length > 16) this.hist[g].shift(); this.prev[g] = this.hist[g][Math.max(0, this.hist[g].length - 2)]; }
      this.lastDay = day;
      // rent and land follow how well the people of each block are doing
      for (const [k, v] of this.rent) { const target = Math.max(0.7, Math.min(1.8, 0.85 + (now.wealth - 1) * 0.6 + (1 - now.poor) * 0.2)); this.rent.set(k, v + (target - v) * 0.04 + (Math.random() - 0.5) * 0.01); }
      for (const [k, v] of this.land) { const r = this.rent.get(k) ?? 1; this.land.set(k, v + (Math.pow(r, 1.25) - v) * 0.05 + (Math.random() - 0.5) * 0.012); }
    }
    const hours = Math.max(1, nPop > 0 ? 1 : 1);
    for (let g = 0; g < C.goods.length; g++) {
      const G = C.goods[g];
      const expD = Math.max(1e-6, nPop * G.perDay / 24 * hours * 0.8);
      const D = this.demand[g] > 0 ? this.demand[g] / expD : 1;
      const S = expected[g] > 0 ? Math.max(0.05, working[g] / expected[g]) : 1;
      let ratio = Math.max(0.55, Math.min(2.2, D / S));
      // scarcity of a thing everybody burns (fuel) comes from the supply side more than from demand
      const pressure = Math.pow(ratio, G.elasticity);
      const target = G.base * this.infl * pressure * this.shockMult(G.id) * (1 + (Math.random() - 0.5) * 0.012);
      this.price[g] += (target - this.price[g]) * 0.28;
      this.demand[g] *= 0.35; // decay: keep a little memory so a quiet hour does not crash the price
    }
    const f = C.good('fuel'); this.macro.fuelScarce = f >= 0 ? Math.max(0, this.price[f] / (C.goods[f].base * this.infl) - 1) : 0;
  }
  rentMult(x: number, z: number) { const k = rk(x, z); let v = this.rent.get(k); if (v === undefined) { v = 1; this.rent.set(k, v); } return v; }
  landMult(x: number, z: number) { const k = rk(x, z); let v = this.land.get(k); if (v === undefined) { v = 1; this.land.set(k, v); } return v; }
  bumpLand(x: number, z: number, d: number) { const k = rk(x, z); this.land.set(k, (this.land.get(k) ?? 1) + d); this.rent.set(k, (this.rent.get(k) ?? 1) + d * 0.5); }

  rows(): PriceRow[] {
    return this.C.goods.map((g, i) => ({ id: g.id.replace(/^good\./, ''), label: g.label, unit: g.unit, price: this.price[i], base: g.base * this.infl, change: this.prev[i] > 0 ? this.price[i] / this.prev[i] - 1 : 0, hist: this.hist[i].concat([this.price[i]]) }));
  }
  /** top and bottom blocks by land index, for the market app */
  landRows(name: (x: number, z: number) => string, n = 4) {
    const rows = [...this.land.entries()].map(([k, v]) => { const x = (Math.floor(k / 4096) + 0.5) * REG, z = ((k % 4096) + 0.5) * REG; return { x, z, v, name: name(x, z) }; }).filter((r) => r.name);
    rows.sort((a, b) => b.v - a.v);
    const seen = new Set<string>(); const out: typeof rows = [];
    for (const r of rows) { if (seen.has(r.name)) continue; seen.add(r.name); out.push(r); if (out.length >= n) break; }
    return out;
  }
  save() { return { infl: this.infl, price: Array.from(this.price), hist: this.hist, shocks: [...this.shocks], rent: [...this.rent], land: [...this.land], news: this.news.slice(0, 30), lastDay: this.lastDay }; }
  load(s: any) {
    if (!s) return; try {
      this.infl = s.infl ?? 1; (s.price ?? []).forEach((v: number, i: number) => { if (i < this.price.length && v > 0) this.price[i] = v; });
      (s.hist ?? []).forEach((h: number[], i: number) => { if (i < this.hist.length && Array.isArray(h)) this.hist[i] = h.slice(-16); });
      this.shocks = new Map(s.shocks ?? []); this.rent = new Map(s.rent ?? []); this.land = new Map(s.land ?? []); this.news = s.news ?? []; this.lastDay = s.lastDay ?? -1;
    } catch { /* a bad save must not stop the game */ }
  }
}
export { CELL };
