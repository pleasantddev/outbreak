// Pickups ("Ghana Must Go" bags) and the items inside them. Odds depend on race position: the leader gets
// defence, the back of the pack gets comeback tools. Rolls are seeded so the authority and replays agree.
import { hash01 } from './rng';

export type ItemId = 'purewater' | 'pothole' | 'horn' | 'rocket' | 'genboost' | 'blackout' | 'danfo' | 'okada';

export interface ItemDef { id: ItemId; name: string; short: string; charges: number; colour: string; hint: string }
export const ITEMS: Record<ItemId, ItemDef> = {
  purewater: { id: 'purewater', name: 'Pure Water', short: 'WATER', charges: 1, colour: '#7fd4ff', hint: 'Drop a burst sachet behind you. Whoever drives over it slides.' },
  pothole: { id: 'pothole', name: 'Pothole', short: 'POTHOLE', charges: 1, colour: '#8a6a4a', hint: 'Leave a crater in the road. Hit it and you bounce and lose speed.' },
  horn: { id: 'horn', name: 'Agbero Horn', short: 'HORN', charges: 1, colour: '#ffb300', hint: 'A blast that shoves every car near you sideways and clears hazards.' },
  rocket: { id: 'rocket', name: 'Gala Rocket', short: 'ROCKET', charges: 1, colour: '#ff3b30', hint: 'A homing snack rocket for the car ahead. A drift at the right moment dodges it.' },
  genboost: { id: 'genboost', name: 'Gen Boost', short: 'GEN x3', charges: 3, colour: '#39ff14', hint: 'Three short boosts, like a generator kicking in.' },
  blackout: { id: 'blackout', name: 'NEPA Blackout', short: 'NEPA', charges: 1, colour: '#8a5cff', hint: 'Lights out for everyone ahead of you. Only their headlights stay on.' },
  danfo: { id: 'danfo', name: 'Danfo Mode', short: 'DANFO', charges: 1, colour: '#ffd000', hint: 'Become an unstoppable yellow bus on autopilot. Flatten anyone you touch.' },
  okada: { id: 'okada', name: 'Okada Swarm', short: 'OKADA', charges: 1, colour: '#ff6a00', hint: 'A swarm of okadas cuts across the race leader. Last place only.' },
};

// weights per position band; p = 0 for the leader, 1 for last place
const TABLE: { upTo: number; w: Partial<Record<ItemId, number>> }[] = [
  { upTo: 0.12, w: { purewater: 40, pothole: 34, genboost: 14, horn: 12 } },
  { upTo: 0.4, w: { purewater: 20, pothole: 15, horn: 24, rocket: 26, genboost: 15 } },
  { upTo: 0.7, w: { horn: 14, rocket: 30, genboost: 30, blackout: 14, pothole: 12 } },
  { upTo: 0.92, w: { rocket: 26, genboost: 30, blackout: 20, danfo: 24 } },
  { upTo: 1.01, w: { genboost: 22, blackout: 20, danfo: 34, rocket: 24 } },
];

export function itemOdds(place: number, count: number): Partial<Record<ItemId, number>> {
  const p = count <= 1 ? 0 : (place - 1) / (count - 1);
  const w = { ...(TABLE.find((t) => p <= t.upTo) ?? TABLE[TABLE.length - 1]).w };
  if (count > 2 && place === count) w.okada = 26; // the swarm only ever goes to whoever is last
  return w;
}

/** Deterministic roll: the same race seed, car, bag and lap always give the same item. */
export function rollItem(place: number, count: number, seed: number, car: number, bag: number, lap: number): ItemId {
  const w = itemOdds(place, count);
  const entries = Object.entries(w) as [ItemId, number][];
  const total = entries.reduce((a, [, v]) => a + v, 0);
  let r = hash01(seed, car * 977 + bag, lap * 131 + 7) * total;
  for (const [id, v] of entries) { r -= v; if (r <= 0) return id; }
  return entries[entries.length - 1][0];
}

export type HazardKind = 'purewater' | 'pothole' | 'rocket' | 'okada';
export const HAZARD_KINDS: HazardKind[] = ['purewater', 'pothole', 'rocket', 'okada'];
export interface Hazard {
  id: number; kind: HazardKind; owner: number;
  x: number; y: number; z: number; h: number;
  s: number; d: number;           // track position (main loop)
  vs: number;                     // rocket: speed along the track
  target: number;                 // rocket and okada: target car index, -1 none
  life: number;                   // seconds left
  armed: number;                  // seconds until it can hit its own owner
}

export const HAZARD_R: Record<HazardKind, number> = { purewater: 1.5, pothole: 1.9, rocket: 1.6, okada: 3.2 };
