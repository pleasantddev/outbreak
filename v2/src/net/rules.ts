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
