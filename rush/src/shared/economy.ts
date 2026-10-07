// Naira and XP. Play money only: there is no real money anywhere in version 1. Earned in races, spent in the garage.

export interface RewardInput { place: number; count: number; mode: string; finished: boolean; drift: number; air: number; tricks: number; nearMiss: number; shunts: number; hits: number; laps: number; trackLen: number; online: boolean; bestLapRecord: boolean }
export interface Reward { naira: number; xp: number; lines: { label: string; naira: number; xp: number }[] }

const PLACE_NAIRA = [5000, 3500, 2600, 2000, 1600, 1300, 1100, 950, 800, 700, 600, 500];

export function raceReward(r: RewardInput): Reward {
  const lines: Reward['lines'] = [];
  const scale = Math.max(0.6, Math.min(1.6, (r.laps * r.trackLen) / 5000));
  const pl = Math.min(PLACE_NAIRA.length, Math.max(1, r.place));
  const field = Math.max(0.5, r.count / 12);
  const base = r.finished ? Math.round(PLACE_NAIRA[pl - 1] * scale * field) : 300;
  lines.push({ label: r.finished ? `Finished ${pl}${pl === 1 ? 'st' : pl === 2 ? 'nd' : pl === 3 ? 'rd' : 'th'}` : 'Did not finish', naira: base, xp: Math.round((r.count - pl + 1) * 40 * scale) + 60 });
  if (r.drift > 4) lines.push({ label: `Gbedu drift ${r.drift.toFixed(0)}s`, naira: Math.round(r.drift * 25), xp: Math.round(r.drift * 6) });
  if (r.tricks > 0) lines.push({ label: `${r.tricks} clean tricks`, naira: r.tricks * 150, xp: r.tricks * 30 });
  if (r.nearMiss > 0) lines.push({ label: `${r.nearMiss} near misses`, naira: r.nearMiss * 60, xp: r.nearMiss * 12 });
  if (r.shunts > 0) lines.push({ label: `${r.shunts} shunts`, naira: r.shunts * 200, xp: r.shunts * 40 });
  if (r.hits > 0) lines.push({ label: `${r.hits} item hits`, naira: r.hits * 80, xp: r.hits * 15 });
  if (r.bestLapRecord) lines.push({ label: 'New lap record', naira: 750, xp: 120 });
  if (r.online) lines.push({ label: 'Online race bonus', naira: Math.round(base * 0.25), xp: 80 });
  return { naira: lines.reduce((a, l) => a + l.naira, 0), xp: lines.reduce((a, l) => a + l.xp, 0), lines };
}

export const xpForLevel = (lvl: number) => Math.round(600 * Math.pow(lvl, 1.35));
export function levelFromXp(xp: number) {
  let lvl = 1;
  while (xp >= xpForLevel(lvl)) { xp -= xpForLevel(lvl); lvl++; if (lvl > 99) break; }
  return { level: lvl, into: xp, need: xpForLevel(lvl) };
}

export const PAINT_PRICE = 800, WRAP_PRICE = 2500, RIM_PRICE = 1800, GLOW_PRICE = 3000, PLATE_PRICE = 500, FINISH_PRICE: Record<string, number> = { gloss: 0, metallic: 600, matte: 1200, pearl: 2500, chrome: 6000 };
