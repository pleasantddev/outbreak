// Needs, mood and moodlets. Values run 0 (desperate) to 100 (full).
// This is an online game with one world clock for everybody, so nothing here skips time: needs drain per REAL minute
// and actions refill them over a few real seconds. A full stomach lasts about an hour and a half of play, a good rest
// about three hours, roughly where GTA RP servers and Lagos Life sit. Moodlet durations are in "beats" of 10 real
// minutes (s.hours counts beats).

export const NEEDS = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'comfort'] as const;
export type Need = (typeof NEEDS)[number];
export type NeedMap = Record<Need, number>;

export const NEED_INFO: Record<Need, { label: string; low: string; icon: string; decay: number }> = {
  hunger: { label: 'Hunger', low: 'Belle dey shout', icon: 'M7 3v8a3 3 0 0 0 6 0V3M10 3v18M17 3c-2 2-2 6 0 8v10', decay: 1.1 },
  energy: { label: 'Energy', low: 'Eye dey close', icon: 'M13 2 4 14h7l-1 8 9-12h-7z', decay: 0.55 },
  hygiene: { label: 'Hygiene', low: 'You don dey smell', icon: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z', decay: 0.6 },
  bladder: { label: 'Bladder', low: 'Find toilet sharp sharp', icon: 'M9 3h6v4l3 3v11H6V10l3-3z', decay: 1.4 },
  fun: { label: 'Fun', low: 'Boredom don catch you', icon: 'M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', decay: 0.8 },
  social: { label: 'Social', low: 'You need person to gist with', icon: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c.8-3 3.2-5 6-5s5.2 2 6 5M14 15c2.6 0 5 1.8 6 5', decay: 0.6 },
  comfort: { label: 'Comfort', low: 'Your leg don tire', icon: 'M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M3 11h18v5H3zM5 16v3M19 16v3', decay: 0.9 },
};

export interface Moodlet { id: string; label: string; mood: number; until: number /* absolute game hours */ }

export interface NeedsState { v: NeedMap; moodlets: Moodlet[]; hours: number /* absolute game hours lived */ }

export function freshNeeds(): NeedsState {
  return { v: { hunger: 62, energy: 78, hygiene: 55, bladder: 50, fun: 60, social: 58, comfort: 70 }, moodlets: [], hours: 0 };
}

/** How much a need drags mood: a curve that barely cares above 60 and screams below 20. */
function pull(x: number) { return x >= 60 ? (x - 60) * 0.12 : x >= 30 ? (x - 60) * 0.5 : -15 + (x - 30) * 1.4; }

export function moodOf(s: NeedsState) {
  let m = 0; for (const n of NEEDS) m += pull(s.v[n]) * (n === 'bladder' || n === 'hunger' || n === 'energy' ? 1.2 : 1);
  m = m / NEEDS.length * 2.2;
  for (const d of s.moodlets) m += d.mood;
  return Math.max(-100, Math.min(100, m));
}
export function moodLabel(m: number) {
  return m > 55 ? 'Feeling fly' : m > 25 ? 'Happy' : m > 0 ? 'Fine' : m > -25 ? 'Uneasy' : m > -55 ? 'Stressed' : 'Miserable';
}
export function moodColor(m: number) { return m > 25 ? '#49e08a' : m > 0 ? '#a3e635' : m > -25 ? '#facc15' : m > -55 ? '#fb923c' : '#ff4d5e'; }

export function addMoodlet(s: NeedsState, id: string, label: string, mood: number, hours: number) {
  const until = s.hours + hours; const ex = s.moodlets.find((m) => m.id === id);
  if (ex) { ex.until = Math.max(ex.until, until); ex.mood = mood; ex.label = label; } else s.moodlets.push({ id, label, mood, until });
}

/** Advance by REAL minutes. `active` = per-minute refill rates from the action in progress (they replace the drain). */
export function decay(s: NeedsState, dh: number, active: Partial<Record<Need, number>>, ctx: { sleeping: boolean; sitting: boolean; moving: number }) {
  s.hours += dh / 10;
  for (const n of NEEDS) {
    let d = -NEED_INFO[n].decay;
    if (n === 'energy' && ctx.moving > 4) d *= 1.8; // running tires you
    if (n === 'comfort' && ctx.sitting) d = 1.5;
    if (n === 'comfort' && ctx.moving > 0.3) d *= 1.3;
    if (n === 'hygiene' && ctx.moving > 4) d *= 1.6; // sweat, Lagos sun
    if (ctx.sleeping) d = n === 'energy' ? 0 : n === 'bladder' ? d * 0.5 : n === 'hunger' ? d * 0.5 : n === 'comfort' ? 2 : d * 0.3;
    if (active[n] !== undefined) d = active[n]!;
    s.v[n] = Math.max(0, Math.min(100, s.v[n] + d * dh));
  }
  s.moodlets = s.moodlets.filter((m) => m.until > s.hours);
}
