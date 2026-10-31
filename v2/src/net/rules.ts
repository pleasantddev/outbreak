// Rules the client and the server must agree on. Pure, no imports. The server is the authority; the client uses these
// to give instant feedback. Keep validateName in step with profile.ts (the tests compare them on a list of inputs).

export const ROSTER_IDS = ['survivor', 'rogue', 'trooper', 'girl', 'farah'] as const;
export const SKIN_COUNT = 6;
export const NAME_MIN = 3, NAME_MAX = 16;

const RESERVED = ['admin', 'administrator', 'moderator', 'staff', 'support', 'hustlelife', 'hustle life', 'system', 'you'];
const BAD = ['fuck', 'shit', 'bitch', 'nigg', 'cunt', 'dick', 'pussy', 'rape', 'whore', 'asshole', 'fvck', 'sex'];

export function validateName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < NAME_MIN) return { ok: false, error: `At least ${NAME_MIN} characters, abeg.` };
  if (name.length > NAME_MAX) return { ok: false, error: `${NAME_MAX} characters is the max.` };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'\-]*$/u.test(name)) return { ok: false, error: 'Letters, numbers, space . _ - and \' only. Start with a letter or number.' };
  if ((name.match(/[\p{L}\p{N}]/gu) ?? []).length < 3) return { ok: false, error: 'Use at least 3 letters or numbers.' };
  if (/(.)\1{4,}/.test(name)) return { ok: false, error: 'Too many repeated characters.' };
  const flat = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (RESERVED.includes(name.toLowerCase()) || RESERVED.includes(flat)) return { ok: false, error: 'That name is reserved. Pick another.' };
  if (BAD.some((b) => flat.includes(b))) return { ok: false, error: 'Keep it clean. Pick another name.' };
  return { ok: true, name };
}
/** The key that must be unique across the game: case and spacing insensitive. */
export const nameKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export const clampSkin = (n: number) => Math.max(0, Math.min(SKIN_COUNT - 1, Math.round(Number.isFinite(n) ? n : 1)));

/** Chat text: trims, drops control characters, caps length, masks the worst words. Returns null when nothing is left. */
export function cleanChat(raw: unknown, max = 200): string | null {
  if (typeof raw !== 'string') return null;
  let t = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > max) t = t.slice(0, max);
  for (const b of BAD) t = t.replace(new RegExp(b.split('').join('[\\s._\\-*]*'), 'gi'), (m) => '*'.repeat(m.length));
  return t;
}

/** Plot economics shared by client and server (same formula as world/plots.ts plotPrice). */
export function plotPriceOf(area: number, zone: string, rich: number, cx: number, cz: number) {
  const distOshodi = Math.hypot(cx, cz) / 1000;
  const base = 26_000_000 * Math.exp(-distOshodi / 14) + 4_500_000;
  const size = area / 648;
  const built = zone === 'vacant' ? 1 : zone === 'unfinished' ? 1.35 : 2.2 + rich * 2.5;
  return Math.round((base * size * built) / 50_000) * 50_000;
}
export const BANK_WITHDRAW_FEE = 0.015;
export const withdrawNet = (a: number) => Math.round(a * (1 - BANK_WITHDRAW_FEE));

// ---------------------------------------------------------------- interiors
/** Interiors (your room, the casino, the club...) are built far outside the map, GTA Online style. A client may only be
 *  in this box after the server granted a `door` act, and leaves it only back near the door it came in by. */
export const INTERIOR_ZONE: [number, number, number, number] = [29000, 29000, 45000, 45000];
export const inInteriorZone = (x: number, z: number) => x >= INTERIOR_ZONE[0] && x <= INTERIOR_ZONE[2] && z >= INTERIOR_ZONE[1] && z <= INTERIOR_ZONE[3];

// ---------------------------------------------------------------- earning from client-simulated work
/** Money a client may report it earned, by source, and how much per rolling minute / hour the server accepts. Gambling
 *  never goes through here: the casino runs on the server (see casinoRules). */
export const EARN_RULES: Record<string, { perMin: number; perHour: number }> = {
  loot: { perMin: 25_000, perHour: 250_000 }, pickup: { perMin: 25_000, perHour: 250_000 }, sale: { perMin: 25_000, perHour: 250_000 },
  mission: { perMin: 60_000, perHour: 600_000 }, reward: { perMin: 25_000, perHour: 200_000 },
  fare: { perMin: 15_000, perHour: 180_000 }, // okada / keke / danfo / ride-hailing trips
  work: { perMin: 40_000, perHour: 300_000 }, // mechanic, teller, gigs, shifts
  street: { perMin: 30_000, perHour: 150_000 }, // pickpocketing and other petty hustle
  race: { perMin: 400_000, perHour: 2_000_000 }, // only after a race.enter escrow (server checks)
  bet: { perMin: 60_000, perHour: 300_000 }, // small side bets with NPCs (match day, Ayo)
  hustle: { perMin: 1_500_000, perHour: 2_000_000 }, // the yahoo crew's rare big hits (heavily flagged)
};

// ---------------------------------------------------------------- casino maths, shared by server (authoritative) and offline play
export const SLOT_SYMBOLS = ['🌶️', '🍚', '🥥', '🚌', '👑', '7️⃣']; export const SLOT_WEIGHTS = [30, 26, 20, 13, 7, 4]; export const SLOT_PAY = [5, 8, 12, 25, 80, 300];
export const SLOT_BETS = [500, 1000, 5000, 20000];
export function slotSpin(rand: () => number, bet: number) {
  const roll = () => { let r = rand() * SLOT_WEIGHTS.reduce((a, b) => a + b, 0); for (let i = 0; i < SLOT_WEIGHTS.length; i++) { if ((r -= SLOT_WEIGHTS[i]) < 0) return i; } return 0; };
  const reels = [roll(), roll(), roll()];
  const win = reels[0] === reels[1] && reels[1] === reels[2] ? bet * SLOT_PAY[reels[0]] : reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2] ? bet : 0;
  return { reels, win };
}
export const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const ROULETTE_KEYS = /^(n([0-9]|[1-2][0-9]|3[0-6])|red|black|odd|even|low|high|d1|d2|d3)$/;
export function roulettePays(k: string, n: number) {
  if (k === 'n' + n) return 36; if (n === 0) return 0; const red = ROULETTE_RED.has(n);
  if (k === 'red' && red) return 2; if (k === 'black' && !red) return 2; if (k === 'odd' && n % 2) return 2; if (k === 'even' && !(n % 2)) return 2;
  if (k === 'low' && n <= 18) return 2; if (k === 'high' && n > 18) return 2; if (k === 'd1' && n <= 12) return 3; if (k === 'd2' && n > 12 && n <= 24) return 3; if (k === 'd3' && n > 24) return 3; return 0;
}
export type BjCard = { r: number; s: number };
export const bjValue = (h: BjCard[]) => { let t = 0, a = 0; for (const c of h) { t += c.r === 0 ? 11 : c.r >= 9 ? 10 : c.r + 1; if (c.r === 0) a++; } while (t > 21 && a) { t -= 10; a--; } return t; };
export function bjShoe(rand: () => number) { const d: BjCard[] = []; for (let k = 0; k < 4; k++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) d.push({ r, s }); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; }
/** One blackjack table state machine. `act` returns what the player sees; money is settled by the caller from `net`. */
export class BjTable {
  shoe: BjCard[] = []; ph: BjCard[] = []; dh: BjCard[] = []; bet = 0; phase: 'idle' | 'play' | 'done' = 'idle'; net = 0; msg = '';
  constructor(private rand: () => number) {}
  private draw() { if (this.shoe.length < 30) this.shoe = bjShoe(this.rand); return this.shoe.pop()!; }
  deal(bet: number) { this.bet = bet; this.ph = [this.draw(), this.draw()]; this.dh = [this.draw(), this.draw()]; this.phase = 'play'; this.net = 0; this.msg = '';
    const p = bjValue(this.ph), d = bjValue(this.dh);
    if (p === 21 || d === 21) return this.finish(p === 21 && d === 21 ? 0 : p === 21 ? Math.floor(bet * 1.5) : -bet, p === 21 && d === 21 ? 'BOTH BLACKJACK · PUSH' : p === 21 ? 'BLACKJACK!' : 'DEALER BLACKJACK');
    return this; }
  hit() { if (this.phase !== 'play') return this; this.ph.push(this.draw()); const p = bjValue(this.ph); if (p > 21) return this.finish(-this.bet, 'BUST'); if (p === 21) return this.stand(); return this; }
  double() { if (this.phase !== 'play' || this.ph.length !== 2) return this; this.bet *= 2; this.ph.push(this.draw()); if (bjValue(this.ph) > 21) return this.finish(-this.bet, 'BUST'); return this.stand(); }
  stand() { if (this.phase !== 'play') return this; while (bjValue(this.dh) < 17) this.dh.push(this.draw()); const p = bjValue(this.ph), d = bjValue(this.dh);
    return d > 21 || p > d ? this.finish(this.bet, d > 21 ? 'DEALER BUSTS · YOU WIN' : 'YOU WIN') : p === d ? this.finish(0, 'PUSH') : this.finish(-this.bet, 'DEALER WINS'); }
  private finish(net: number, msg: string) { this.net = net; this.msg = msg; this.phase = 'done'; return this; }
  view() { return { ph: this.ph, dh: this.phase === 'play' ? [this.dh[0]] : this.dh, phase: this.phase, net: this.net, msg: this.msg, bet: this.bet }; }
}

// ------------------------------------------------------------------------------------------ the one world clock
/** Server and every client read the same clock: game hours since the epoch at 30x (a 48 minute day). Hour of day is
 *  this % 24 and the day number is floor(this / 24). */
export const WORLD_SPEED = 30, WORLD_START_HOUR = 7.2;
export const worldHours = (ms: number) => WORLD_START_HOUR + ((ms / 1000) * WORLD_SPEED) / 3600;

// ------------------------------------------------------------------------------------------ businesses
/** Lagos Life style small businesses on real shop fronts: you buy the shop, keep it stocked, staff and light are paid
 *  at 6pm every game day out of the till, and you walk over to collect the till (GTA nightclub safe style). Other
 *  players can buy from your shop and that money lands in your till. All of it runs on the server. */
export interface BizType {
  id: string; name: string; sign: string; price: number;
  /** money a full day of trade brings at full stock on an average site */
  gross: number; upkeep: number; restock: number; till: number; open: [number, number];
  /** what a customer can buy there (price goes into the owner's till) */
  sells: { label: string; price: number; gain: Record<string, number>; mins: number }; blurb: string;
}
export const BIZ_TYPES: BizType[] = [
  { id: 'kiosk', name: 'Provision kiosk', sign: 'PROVISION STORE', price: 250_000, gross: 12_000, upkeep: 2_000, restock: 5_000, till: 45_000, open: [7, 22], sells: { label: 'Biscuit and a cold Malta', price: 700, gain: { hunger: 18, fun: 6 }, mins: 2 }, blurb: 'Sweets, Indomie, Malta, recharge card. Small but steady.' },
  { id: 'pos', name: 'POS stand', sign: 'POS · CASH OUT', price: 400_000, gross: 18_000, upkeep: 3_000, restock: 7_000, till: 70_000, open: [8, 21], sells: { label: 'Cash out (bank to hand, ₦300 charge)', price: 300, gain: {}, mins: 1 }, blurb: 'Everybody needs cash in hand. Area boys know that too.' },
  { id: 'salon', name: 'Barbing salon', sign: 'BARBING SALON', price: 900_000, gross: 34_000, upkeep: 8_000, restock: 8_000, till: 130_000, open: [9, 21], sells: { label: 'Low cut with sharp line-up', price: 2_500, gain: { hygiene: 25, fun: 10, social: 15 }, mins: 6 }, blurb: 'Clippers, gist and generator noise. Busy on Saturdays.' },
  { id: 'buka', name: 'Buka', sign: 'BUKA · FOOD IS READY', price: 1_500_000, gross: 56_000, upkeep: 13_000, restock: 20_000, till: 210_000, open: [7, 20], sells: { label: 'Amala, ewedu and two meat', price: 2_200, gain: { hunger: 60, comfort: 10 }, mins: 6 }, blurb: 'Amala, rice, swallow. Feed the street and the street pays.' },
  { id: 'carwash', name: 'Car wash', sign: 'CAR WASH', price: 2_500_000, gross: 90_000, upkeep: 20_000, restock: 12_000, till: 340_000, open: [8, 19], sells: { label: 'Wash and vacuum', price: 3_000, gain: { comfort: 15, fun: 5 }, mins: 5 }, blurb: 'Hose, foam, boys with rags. Big money, big wages.' },
];
export const BIZ_MAX = 4, BIZ_STOCK_DAY = 40, BIZ_REACH = 25;
export const bizType = (id: string) => BIZ_TYPES.find((t) => t.id === id);
/** site ids carry their own street position (whole metres), so the server can check you are standing there */
export const siteId = (x: number, z: number) => `s:${Math.round(x)}:${Math.round(z)}`;
export function sitePos(id: string): { x: number; z: number } | null { const m = /^s:(-?\d{1,6}):(-?\d{1,6})$/.exec(id); return m ? { x: +m[1], z: +m[2] } : null; }
/** foot traffic of a site, 0.85 to 1.25, the same for everyone */
export function siteTraffic(id: string) { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return 0.85 + ((h >>> 0) % 41) / 100; }
export interface BizState { stock: number; till: number; debt: number; hour: number; log: { d: number; t: string; n: number }[] }
/** Run a business forward hour by hour from b.hour to `to` (game hours): trade while open and stocked, and at 18:00
 *  pay staff and light from the till (what the till cannot cover becomes debt), then the day's street luck. */
export function bizStep(b: BizState, t: BizType, site: string, to: number, rand: () => number) {
  const from = Math.max(b.hour, to - 24 * 14); const hrs = t.open[1] - t.open[0]; const traffic = siteTraffic(site);
  for (let h = Math.floor(from) + 1; h <= Math.floor(to); h++) {
    const hod = ((h % 24) + 24) % 24, day = Math.floor(h / 24);
    const shut = b.debt >= t.upkeep * 3; // staff do not work three days unpaid
    if (!shut && hod >= t.open[0] && hod < t.open[1] && b.stock > 0) {
      const rush = hod >= 12 && hod < 14 ? 1.3 : hod >= 17 && hod < 19 ? 1.25 : 0.88;
      b.till = Math.min(t.till, b.till + (t.gross / hrs) * traffic * rush); b.stock = Math.max(0, b.stock - BIZ_STOCK_DAY / hrs);
    }
    if (hod === 18) {
      const pay = t.upkeep; const p = Math.min(pay, b.till); b.till -= p; b.debt += pay - p;
      if (b.debt > 0 && b.till > 0) { const q = Math.min(b.debt, b.till); b.debt -= q; b.till -= q; }
      const r = rand(); const strike = b.debt >= t.upkeep * 3;
      if (r < 0.12) { const n = Math.min(b.till, Math.round(t.gross * 0.08)); b.till -= n; b.log.push({ d: day, t: 'Area boys came for their settlement.', n: -n }); }
      else if (r < 0.18) { const n = Math.min(b.till, 2_000); b.till -= n; b.log.push({ d: day, t: 'Council men collected signboard levy.', n: -n }); }
      else if (r < 0.3 && !strike && b.stock > 0) { const n = Math.round(t.gross * 0.15); b.till = Math.min(t.till, b.till + n); b.log.push({ d: day, t: 'A big customer bought plenty.', n }); }
      else b.log.push({ d: day, t: strike ? 'Staff did not come. They want their money.' : b.stock <= 0 ? 'Nothing to sell today. Restock.' : 'Staff and light paid.', n: -p });
      if (b.log.length > 8) b.log.splice(0, b.log.length - 8);
    }
  }
  b.hour = Math.max(b.hour, Math.floor(to)); b.till = Math.round(b.till); b.debt = Math.round(b.debt);
  return b;
}

// ------------------------------------------------------------------------------------------ the power grid
/** Lagos on 4 km feeders. Server and clients agree on which feeder a point is in; src/data/feeders.json (built by
 *  tools/feeders.ts from the map) names them and gives each its load (buildings) and tariff band. */
export const GRID = {
  x0: -22000, z0: -20000, cell: 4000, w: 9, h: 8,
  of(x: number, z: number) { const i = Math.max(0, Math.min(8, Math.floor((x + 22000) / 4000))), j = Math.max(0, Math.min(7, Math.floor((z + 20000) / 4000))); return i + j * 9; },
  center(f: number) { return { x: -22000 + (f % 9) * 4000 + 2000, z: -20000 + Math.floor(f / 9) * 4000 + 2000 }; },
};
export type Band = 'A' | 'B' | 'C';
/** hours of light per day each band gets on the default load-shedding plan */
export const BAND_HOURS: Record<Band, number> = { A: 20, B: 15, C: 10 };
const gh = (a: number, b: number) => { let h = Math.imul(a + 0x9e37, 2654435761) ^ Math.imul(b + 0x85eb, 2246822519); h ^= h >>> 15; h = Math.imul(h, 2654435761); return (h ^ (h >>> 13)) >>> 0; };
/** the default plan: two blackout blocks a day per feeder, placed by a hash of the feeder and the day */
export function scheduledOn(f: number, band: Band, hours: number) {
  const day = Math.floor(hours / 24), hod = ((hours % 24) + 24) % 24; const off = 24 - BAND_HOURS[band];
  const h = gh(f, day); const a = Math.ceil(off / 2), b = off - a; const s1 = h % 24, s2 = (s1 + 10 + ((h >>> 8) % 5)) % 24;
  const inB = (s: number, len: number) => len > 0 && ((hod - s + 24) % 24) < len;
  return !(inB(s1, a) || inB(s2, b));
}
/** how much the grid can carry right now (in the same units as feeder load), before operators and events */
export function generation(hours: number, totalLoad: number) {
  const day = Math.floor(hours / 24); const h = gh(day, 77);
  const gas = 0.55 + ((h % 1000) / 1000) * 0.35; // gas supply varies by day: 55% to 90% of demand
  return Math.round(totalLoad * gas);
}
/** the grid as the server sends it: one character per feeder ("1" light, "0" none), generation, and a collapse flag */
export interface GridState { on: string; gen: number; load: number; collapse: boolean; by?: Record<number, string> }
export const GRID_OVERRIDE_HOURS = 3;
export interface FeederDef { i: number; name: string; load: number; band: Band }
const h32 = (a: number, b: number) => { let h = Math.imul(a ^ 0x5bd1e995, 2654435761) ^ Math.imul(b + 17, 2246822519); h ^= h >>> 15; return h >>> 0; };
/** the national grid falls over now and then (about one game day in twelve), for one to three game hours */
export function gridCollapsed(h: number) {
  const day = Math.floor(h / 24); const r = h32(day, 99); if (r % 12 !== 0) return false;
  const start = (r >>> 8) % 24, len = 1 + ((r >>> 16) % 3); const hod = h % 24; return hod >= start && hod < start + len;
}
/** Which feeders have light at game hour h: forced (admin) beats operator switches beats the plan, then feeders are
 *  shed (plan before operators, band C before B before A) until the load fits what the grid can carry. */
export function gridState(feeders: FeederDef[], h: number, o: { forced?: Map<number, { on: boolean }>; override?: Map<number, { on: boolean; by: string; from?: number }>; collapseUntil?: number; genScale?: number } = {}): GridState {
  const on = new Array(GRID.w * GRID.h).fill('0'); const by: Record<number, string> = {};
  if (h < (o.collapseUntil ?? 0) || gridCollapsed(h)) return { on: on.join(''), gen: 0, load: 0, collapse: true };
  const total = feeders.reduce((s, f) => s + f.load, 0); const gen = Math.round(generation(h, total) * (o.genScale ?? 1));
  const want = feeders.map((f) => {
    const fo = o.forced?.get(f.i), op0 = o.override?.get(f.i); const op = op0 && h >= (op0.from ?? -Infinity) ? op0 : undefined;
    if (op && !fo) by[f.i] = op.by;
    return { f, v: fo ? fo.on : op ? op.on : scheduledOn(f.i, f.band, h), pri: fo ? 0 : op ? 1 : f.band === 'A' ? 2 : f.band === 'B' ? 3 : 4, r: h32(f.i, Math.floor(h / 24)) };
  });
  let load = want.filter((w) => w.v).reduce((s, w) => s + w.f.load, 0);
  for (const w of want.filter((x) => x.v && x.pri > 0).sort((a, b) => b.pri - a.pri || a.r - b.r)) { if (load <= gen) break; w.v = false; load -= w.f.load; }
  for (const w of want) if (w.v) on[w.f.i] = '1';
  return { on: on.join(''), gen, load, collapse: false, by };
}

// ---------------------------------------------------------------------------------------------------------------
// MyAds: real-money advertising. Prices are in naira and are the same on the client (quotes) and the server (orders).
export interface AdBoard { id: string; x: number; y: number; z: number; yaw: number; w: number; h: number; place: string; tier: string; slots?: number }
/** the cheapest board, one day: the founder's base price */
export const AD_BASE = 4500;
export const AD_TIER: Record<string, number> = { street: 1, standard: 1.8, prime: 3.2 };
/** image size we ask for: 64 px per metre of board, long side capped at 2048 */
export function adPixels(b: { w: number; h: number }) { const k = Math.min(64, 2048 / Math.max(b.w, b.h)); return { w: Math.round(b.w * k), h: Math.round(b.h * k) }; }
export const AD_DAYS = [1, 3, 7, 14, 30] as const;
export function adDiscount(days: number) { return days >= 30 ? 0.25 : days >= 14 ? 0.15 : days >= 7 ? 0.1 : 0; }
const round100 = (n: number) => Math.max(100, Math.round(n / 100) * 100);
/** naira per day for one slot on a board: base x tier x size, and a shared LED slot costs half */
export function boardDayRate(b: AdBoard) {
  const size = Math.min(2.5, Math.max(0.8, Math.sqrt((b.w * b.h) / 40)));
  return round100(AD_BASE * (AD_TIER[b.tier] ?? 1) * size * ((b.slots ?? 1) > 1 ? 0.5 : 1));
}
/** the night sky: drone shows are booked per day at a show spot; blimps per day per airship */
export const DRONE_SPOTS: { id: string; name: string; x: number; z: number; k: number }[] = [
  { id: 'oshodi', name: 'Oshodi Interchange', x: 900, z: -280, k: 1 },
  { id: 'ikeja', name: 'Ikeja, by the mall', x: 1640, z: -6800, k: 1.1 },
  { id: 'surulere', name: 'Surulere', x: 1560, z: 5770, k: 1 },
  { id: 'yaba', name: 'Yaba', x: 3060, z: 4660, k: 1.1 },
  { id: 'lagoon', name: 'Over the lagoon, Third Mainland Bridge', x: 5770, z: 7380, k: 1.5 },
  { id: 'ikoyi', name: 'Ikoyi, by Falomo', x: 9200, z: 11300, k: 1.4 },
];
export const DRONE_DAY = 350_000;
export const BLIMP_DAY = 180_000;
export const BLIMPS = 3;
export const DRONE_TEXT_MAX = 28;
export type AdKind = 'board' | 'drone' | 'blimp';
export function adQuote(kind: AdKind, days: number, opt: { board?: AdBoard; spot?: string } = {}) {
  const d = Math.max(1, Math.min(60, Math.round(days)));
  const day = kind === 'board' ? (opt.board ? boardDayRate(opt.board) : 0) : kind === 'drone' ? round100(DRONE_DAY * (DRONE_SPOTS.find((s) => s.id === opt.spot)?.k ?? 1)) : BLIMP_DAY;
  const gross = day * d; const off = adDiscount(d);
  return { day, days: d, gross, discount: off, total: round100(gross * (1 - off)) };
}
/** Lagos calendar day (WAT, UTC+1) for impressions and bookings */
export function lagosDay(ms: number) { return new Date(ms + 3600_000).toISOString().slice(0, 10); }
/** start of a Lagos day as epoch ms */
export function lagosDayStart(day: string) { return Date.parse(day + 'T00:00:00Z') - 3600_000; }
/** the three airships each loop one part of the city: Oshodi to Ikeja, the mainland to Yaba and Surulere, and the lagoon to Ikoyi */
export const BLIMP_LOOPS = [
  { cx: 1200, cz: -3400, rx: 1500, rz: 3600, lap: 30, y: 150, name: 'Oshodi to Ikeja' },
  { cx: 2300, cz: 3000, rx: 1700, rz: 3300, lap: 32, y: 165, name: 'Mainland, Yaba and Surulere' },
  { cx: 6800, cz: 9200, rx: 3000, rz: 2600, lap: 36, y: 180, name: 'The lagoon to Ikoyi' },
];
/** where blimp i is right now; the same for every player because it runs off the shared clock */
export function blimpPos(i: number, ms: number) {
  const L = BLIMP_LOOPS[i % BLIMP_LOOPS.length]; const t = (ms / (L.lap * 60_000) + i * 0.37) % 1; const a = t * Math.PI * 2;
  const x = L.cx + Math.cos(a) * L.rx, z = L.cz + Math.sin(a) * L.rz;
  const yaw = Math.atan2(-Math.sin(a) * L.rx, Math.cos(a) * L.rz); // heading along the loop
  return { x, y: L.y + Math.sin(a * 3) * 6, z, yaw };
}
