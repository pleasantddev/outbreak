// Property listings, sports venues, bookings and match rules shared by the client and the server. Pure, no imports
// beyond rules.ts. The server is the authority; the client runs the same numbers offline and for instant feedback.
import { worldHours, WORLD_SPEED, WORLD_START_HOUR } from './rules';

// ------------------------------------------------------------------------------------------ property listings
export type PropKind = 'plot' | 'biz' | 'venue';
export const PROP_KINDS: PropKind[] = ['plot', 'biz', 'venue'];
/** You sell it yourself (no fee) or hand it to an agency: they take a commission, find NPC buyers over time and can
 *  rent it out for you while it waits. Property that is not listed shows no price and nobody can buy it. */
export type ListMode = 'self' | 'agent';
export const AGENT_SALE_FEE = 0.05, AGENT_RENT_FEE = 0.15;
/** rent an agency collects per game day, as a share of what the property is worth */
export const RENT_RATE = 0.004;
/** asking price limits relative to market value: agents refuse silly prices, sellers can ask what they like within reason */
export const ASK_RANGE: Record<ListMode, [number, number]> = { self: [0.3, 5], agent: [0.5, 1.6] };
export const AGENCIES = ['Lekki Gold Realtors', 'Omo Onile Homes and Properties', 'Victoria Prime Agency', 'Mainland Keys Ltd'];
export const agencyFor = (id: string) => AGENCIES[hashStr(id) % AGENCIES.length];
export function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export const propKey = (kind: PropKind, id: string) => `${kind}|${id}`;
export function askOk(mode: ListMode, price: number, value: number) { const [a, b] = ASK_RANGE[mode]; return Number.isFinite(price) && price >= Math.max(1, value * a) && price <= value * b; }
/** chance a day that the agency closes a sale with an NPC buyer: fair price sells in a few days, greed sits */
export function agentSaleChance(price: number, value: number) { return Math.max(0.02, Math.min(0.6, 0.3 * Math.pow(value / Math.max(1, price), 3))); }
export interface ListingState { hour: number; log: { d: number; t: string; n: number }[] }
/** Run an agent listing forward day by day (at noon). Returns money owed to the owner and whether it sold. */
export function agentStep(st: ListingState, o: { mode: ListMode; price: number; value: number; rent: boolean }, to: number, rand: () => number) {
  let paid = 0, sold = false; const from = Math.max(st.hour, to - 24 * 30);
  for (let h = Math.floor(from) + 1; h <= Math.floor(to) && !sold; h++) {
    if (((h % 24) + 24) % 24 !== 12) continue; const d = Math.floor(h / 24);
    if (o.mode !== 'agent') continue;
    if (o.rent) { const n = Math.round(o.value * RENT_RATE * (1 - AGENT_RENT_FEE)); paid += n; st.log.push({ d, t: 'Tenant paid rent. Agency took their cut.', n }); }
    if (rand() < agentSaleChance(o.price, o.value)) { const n = Math.round(o.price * (1 - AGENT_SALE_FEE)); paid += n; sold = true; st.log.push({ d, t: 'The agency found a buyer. Sold!', n }); }
    if (st.log.length > 8) st.log.splice(0, st.log.length - 8);
  }
  st.hour = Math.max(st.hour, Math.floor(to)); return { paid, sold };
}

// ------------------------------------------------------------------------------------------ venues
export type VenueKind = 'pitch' | 'court' | 'stadium';
export interface VenueDef { kind: VenueKind; name: string; base: number; perM2: number; fee: number; sport: 'football' | 'basketball' }
export const VENUES: Record<VenueKind, VenueDef> = {
  pitch: { kind: 'pitch', name: 'Football pitch', base: 9_000_000, perM2: 4_000, fee: 15_000, sport: 'football' },
  court: { kind: 'court', name: 'Basketball court', base: 3_500_000, perM2: 6_000, fee: 8_000, sport: 'basketball' },
  stadium: { kind: 'stadium', name: 'Stadium', base: 250_000_000, perM2: 6_000, fee: 120_000, sport: 'football' },
};
/** ids carry kind, position and length so every client derives the same id from the map and the server can check
 *  where you stand and price it without trusting the client */
export const venueId = (kind: VenueKind, x: number, z: number, len: number) => `v:${kind}:${Math.round(x)}:${Math.round(z)}:${Math.round(len)}`;
export function venueParse(id: string): { kind: VenueKind; x: number; z: number; len: number } | null {
  const m = /^v:(pitch|court|stadium):(-?\d{1,6}):(-?\d{1,6}):(\d{1,4})$/.exec(id); return m ? { kind: m[1] as VenueKind, x: +m[2], z: +m[3], len: +m[4] } : null;
}
export function venuePrice(id: string) {
  const v = venueParse(id); if (!v) return 0; const d = VENUES[v.kind]; const L = Math.max(10, Math.min(v.kind === 'stadium' ? 200 : 110, v.len));
  const near = Math.exp(-Math.hypot(v.x, v.z) / 14_000) * 0.8 + 0.6; // closer to the middle of town costs more
  return Math.round((d.base + d.perM2 * L * L * 0.6) * near / 50_000) * 50_000;
}
export const VENUE_REACH = 60, VENUE_MAX = 3;
/** slot fee an owner can set, relative to the default */
export const FEE_RANGE: [number, number] = [0.25, 4];

// ------------------------------------------------------------------------------------------ bookings and matches
/** a slot is one game hour (two real minutes) starting on the hour, bookable up to two game days ahead */
export const SLOT_AHEAD = 48;
export const slotNow = (ms: number) => Math.floor(worldHours(ms));
/** real time (ms since epoch) at which game hour h begins */
export const hourToMs = (h: number) => ((h - WORLD_START_HOUR) * 3600 / WORLD_SPEED) * 1000;
export const OWNER_SHARE = 0.9; // the platform keeps 10% of a slot fee
export const MATCH_WAGERS = [0, 5_000, 20_000, 100_000, 500_000];
export const MATCH_CUT = 0.05; // the venue owner keeps 5% of the pot (the house at a public pitch)
export type Sport = 'football' | 'basketball';
export const SPORT_SIZE: Record<Sport, number> = { football: 5, basketball: 3 };
/** real milliseconds a match lasts (football: 4 min, basketball: first to 21 or 5 min) */
export const MATCH_MS: Record<Sport, number> = { football: 240_000, basketball: 300_000 };
export const BB_TARGET = 21;
/** no score beyond what is humanly possible in the time */
export function scorePlausible(sport: Sport, a: number, b: number, ms: number) {
  if (![a, b].every((n) => Number.isInteger(n) && n >= 0)) return false;
  if (sport === 'football') return a + b <= Math.ceil(ms / 8_000) && Math.max(a, b) <= 30;
  return Math.max(a, b) <= BB_TARGET + 2 && a + b <= Math.ceil(ms / 2_500);
}
export const potShare = (wager: number, players: number) => { const pot = wager * players; const cut = Math.round(pot * MATCH_CUT); return { pot, cut, win: pot - cut }; };
export const nowHour = () => worldHours(Date.now());
