// Ranked play: a rating per player, moved by multiplayer Elo after each ranked race, and the tiers it climbs
// through. Shared so the server rates and the client shows the same numbers.

export const START_RATING = 1000;
/** Fewer rated races than this and a rating moves faster, so new players find their level quickly. */
export const PROVISIONAL = 15;

export const TIERS: { min: number; name: string; colour: string }[] = [
  { min: -Infinity, name: 'Learner', colour: '#9a9aa6' },
  { min: 900, name: 'Street Runner', colour: '#c9a56b' },
  { min: 1050, name: 'Danfo Boss', colour: '#f6c514' },
  { min: 1200, name: 'Expressway Ace', colour: '#39d0ff' },
  { min: 1350, name: 'Third Mainland', colour: '#ff2d8a' },
  { min: 1500, name: 'Lagos Legend', colour: '#39ff14' },
];
export function tierOf(rating: number) {
  let t = TIERS[0];
  for (const x of TIERS) if (rating >= x.min) t = x;
  return t;
}

export interface RatedEntry { id: string; rating: number; races: number; place: number }

/**
 * Every pair of drivers in a ranked race is one game: the better place wins it. A driver's score is the share
 * of those games won, compared with what the ratings expected, times K. Drivers who did not finish all share
 * last place, so leaving a race never protects a rating.
 */
export function rateRace(entries: RatedEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = entries.length;
  if (n < 2) { for (const e of entries) out.set(e.id, 0); return out; }
  for (const a of entries) {
    let expected = 0, actual = 0;
    for (const b of entries) {
      if (a === b) continue;
      expected += 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
      actual += a.place < b.place ? 1 : a.place === b.place ? 0.5 : 0;
    }
    const k = a.races < PROVISIONAL ? 40 : 24;
    out.set(a.id, Math.round((k * (actual - expected)) / (n - 1)));
  }
  return out;
}
