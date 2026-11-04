// The Eko Exchange (EKX): a parody stock market for HustleLife. Shared by the game and the server.
// Prices are a pure function of time, so every player, the server and the offline game see the same chart without
// storing ticks: several layers of smooth noise (days, hours, minutes) on top of a slow sector drift. The server adds
// the pressure of real players' buying and selling on top (src/exchange.ts). Fees and the spread go nowhere: they are a
// money sink, so trading cannot print naira on average.
export interface Ticker { sym: string; name: string; sector: string; base: number; vol: number; drift: number; seed: number; blurb: string; shares: number }
export const TICKERS: Ticker[] = [
  { sym: 'DANFO', name: 'Oshodi Danfo Transport', sector: 'Transport', base: 420, vol: 0.9, drift: 0.02, seed: 11, blurb: 'Yellow buses on every route from Oshodi to Ikeja.', shares: 40_000_000 },
  { sym: 'LPOWR', name: 'Lagos Power Plc', sector: 'Utilities', base: 1280, vol: 1.2, drift: -0.01, seed: 23, blurb: 'Runs the grid. When the light holds, so does the price.', shares: 90_000_000 },
  { sym: 'FHB', name: 'First Hustle Bank', sector: 'Banking', base: 2150, vol: 0.6, drift: 0.03, seed: 37, blurb: 'Accounts, POS, loans with interest that bites.', shares: 120_000_000 },
  { sym: 'CHOPN', name: 'ChopNow Foods', sector: 'Consumer', base: 760, vol: 1.1, drift: 0.04, seed: 41, blurb: 'Jollof to your door in thirty minutes or less.', shares: 25_000_000 },
  { sym: 'CVTEK', name: 'Computer Village Tech', sector: 'Technology', base: 3450, vol: 1.5, drift: 0.05, seed: 53, blurb: 'Phones, repairs, and the odd phone that was not yours.', shares: 18_000_000 },
  { sym: 'EKOPT', name: 'Eko Petroleum', sector: 'Energy', base: 5200, vol: 1.3, drift: 0.0, seed: 67, blurb: 'Filling stations across the mainland. Scarcity is good business.', shares: 60_000_000 },
  { sym: 'EKCEM', name: 'Eko Cement and Blocks', sector: 'Construction', base: 1890, vol: 0.8, drift: 0.03, seed: 71, blurb: 'Every new storey in Lagos starts with their bags.', shares: 75_000_000 },
  { sym: 'OKRKA', name: 'Okrika Kings Textiles', sector: 'Retail', base: 180, vol: 1.4, drift: 0.01, seed: 83, blurb: 'Bales from abroad, sorted and sold by the piece.', shares: 30_000_000 },
  { sym: 'PURE', name: 'Pure Water Nigeria', sector: 'Consumer', base: 95, vol: 1.0, drift: 0.02, seed: 97, blurb: 'Sachet water for every hawker and every hot afternoon.', shares: 50_000_000 },
  { sym: 'SUYA', name: 'Mallam Suya Holdings', sector: 'Consumer', base: 640, vol: 0.9, drift: 0.02, seed: 103, blurb: 'Spice, smoke and a stand on every corner after dark.', shares: 12_000_000 },
  { sym: 'ZILOX', name: 'ZILOX Entertainment', sector: 'Leisure', base: 2900, vol: 1.7, drift: 0.02, seed: 113, blurb: 'Clubs, shutdowns and the loudest nights in Ikoyi.', shares: 10_000_000 },
  { sym: 'NAIJA', name: 'Naija Waves Media', sector: 'Media', base: 540, vol: 1.2, drift: 0.03, seed: 127, blurb: 'Radio, streaming and the songs the clubs play.', shares: 22_000_000 },
];
export const TICKER = new Map(TICKERS.map((t) => [t.sym, t]));
/** 1% brokerage with a ₦50 minimum, and a 0.4% spread around the mid price */
export const EX_FEE = 0.01, EX_FEE_MIN = 50, EX_SPREAD = 0.004;
/** most naira one order may move, and most shares of one company one player may hold */
export const EX_MAX_ORDER = 5_000_000, EX_MAX_HOLD = 200_000;
const EPOCH = Date.UTC(2026, 9, 1);

function hash(n: number) { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
/** smooth value noise in [-1, 1] */
function vnoise(t: number, seed: number) { const i = Math.floor(t), f = t - i; const a = hash(i * 7919 + seed * 104729) * 2 - 1, b = hash((i + 1) * 7919 + seed * 104729) * 2 - 1; const u = f * f * (3 - 2 * f); return a + (b - a) * u; }
/** the mid price of a ticker at a moment (no player pressure) */
export function midPrice(t: Ticker, ms: number) {
  const h = (ms - EPOCH) / 3_600_000; const v = t.vol;
  // tuned so a normal day moves 1 to 2 percent, a wild one 6 to 8, and a month 10 to 25
  const f = 0.15 * v * vnoise(h / 120, t.seed) + 0.035 * v * vnoise(h / 20, t.seed + 1) + 0.012 * v * vnoise(h / 3, t.seed + 2) + 0.005 * v * vnoise(h / 0.4, t.seed + 3) + 0.0018 * v * vnoise(h / 0.08, t.seed + 4);
  const drift = t.drift * (h / (24 * 30)); // per month
  return Math.max(1, t.base * Math.exp(f + drift));
}
/** price with the server's pressure multiplier (1 offline) */
export function priceAt(t: Ticker, ms: number, pressure = 1) { return Math.round(midPrice(t, ms) * pressure * 100) / 100; }
/** points for a chart: n samples over the span ending now */
export function history(t: Ticker, ms: number, spanMs: number, n = 48, pressure = 1) { const out: number[] = []; for (let i = 0; i < n; i++) out.push(priceAt(t, ms - spanMs + (spanMs * i) / (n - 1), pressure)); return out; }
/** the Lagos trading day opens at 10:00 WAT (09:00 UTC); change is measured from the last open */
export function dayOpen(ms: number) { const d = new Date(ms); const open = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9); return ms >= open ? open : open - 86_400_000; }
export function quoteOf(t: Ticker, ms: number, pressure = 1) {
  const p = priceAt(t, ms, pressure), o = priceAt(t, dayOpen(ms), pressure);
  const day = history(t, ms, ms - dayOpen(ms) || 60_000, 24, pressure);
  return { sym: t.sym, price: p, open: o, change: o ? (p - o) / o : 0, high: Math.max(...day), low: Math.min(...day), cap: p * t.shares, buy: Math.round(p * (1 + EX_SPREAD / 2) * 100) / 100, sell: Math.round(p * (1 - EX_SPREAD / 2) * 100) / 100 };
}
export function feeOf(value: number) { return Math.max(EX_FEE_MIN, Math.round(value * EX_FEE)); }
/** player businesses on the exchange: 100 units each, the owner keeps at least 51 */
export const BIZ_UNITS = 100, BIZ_OWNER_MIN = 51;
