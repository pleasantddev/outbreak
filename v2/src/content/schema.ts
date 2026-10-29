// Content types for v2/public/content/*.json. Each workstream appends its own section; keep ids stable strings.
export interface ContentFile<T> { version: number; items: T[] }

// ---------------------------------------------------------------- society: npcs.json and economy.json (society agent)
// npcs.json items are tagged by `kind`; economy.json items likewise. Ids are stable strings.

/** Sites an occupation can work at. 'street' means a corner or stretch of pavement near home. */
export type SiteKind = 'market' | 'shops' | 'stand' | 'bank' | 'church' | 'mosque' | 'school' | 'hospital' | 'police' | 'mechanic' | 'busStop' | 'fuel' | 'food' | 'bar' | 'institution' | 'street';

export interface NpcNames { id: string; kind: 'names'; eth: 'yoruba' | 'igbo' | 'hausa' | 'other'; weight: number; faith: { christian: number; muslim: number }; male: string[]; female: string[]; surnames: string[] }
export interface NpcOccupation {
  id: string; kind: 'occupation'; label: string; weight: number;
  /** LifeSim role the body gets (police get uniforms, area boys get cutlasses) */
  role: 'ped' | 'area' | 'police';
  /** id of a wage item in economy.json */
  wage: string;
  sites: SiteKind[];
  /** wake hour, shift start/end hour (end may be past midnight, e.g. 27 = 03:00), jitter hours */
  sched: { wake: number; start: number; end: number; jitter: number; lunch?: boolean; night?: boolean; /** Sunday: off for office and school jobs */ weekend?: 'off' | 'work' };
  /** chance they are visible outdoors while working (a bank clerk is mostly inside) */
  outdoor: number;
  /** factions: type id this occupation belongs to, if any */
  faction?: string;
  vehicle?: 'danfo' | 'okada' | 'keke';
  age: [number, number]; female: number;
  /** wealth band of the home they rent or own: 0 poor .. 1 rich */
  rich: [number, number];
  look?: { top?: string; pattern?: string; colors?: string[]; head?: string; vest?: boolean; backpack?: boolean };
  /** short lines they say on the job when you are near */
  barks?: string[];
  /** sentence about the job for the backstory ({He} / {his} / {name} / {area} are filled in) */
  tales: string[];
}
export interface NpcFaction { id: string; kind: 'faction'; label: string; /** the ladder from lowest to highest */ ranks: string[]; /** pattern for instance names, {area} is the neighbourhood */ names: string[]; cell: 'cell' | 'site'; siteKind?: SiteKind; levy?: number }
export interface NpcTrait { id: string; kind: 'trait'; label: string; aggression: number; courage: number; greed: number; loyalty: number; faith?: number; vengeful?: boolean; weight: number }
export interface NpcBackstory { id: string; kind: 'backstory'; slot: 'origin' | 'turn' | 'ambition'; text: string; occ?: string[]; minAge?: number; maxAge?: number; eth?: string[] }
export interface NpcTaunt { id: string; kind: 'taunt'; when: string; lines: string[]; /** limit to a faction type */ faction?: string }
export interface NpcCityEvent { id: string; kind: 'cityEvent'; label: string; /** expected occurrences per game day per active region; 0 for scheduled ones */ rate: number; days: [number, number]; shock?: string; news: string[]; site?: SiteKind; hours?: [number, number]; toast?: string }
export type SocietyItem = NpcNames | NpcOccupation | NpcFaction | NpcTrait | NpcBackstory | NpcTaunt | NpcCityEvent;

export interface EcoGood { id: string; kind: 'good'; label: string; unit: string; base: number; /** how hard price reacts to shortage, 0..1 */ elasticity: number; /** share of daily spending per adult */ perDay: number; icon?: string; ticker?: boolean }
export interface EcoWage { id: string; kind: 'wage'; label: string; /** naira per game day */ daily: number; /** margin wages move with the goods the job sells */ link?: string; /** random spread */ spread: number }
export interface EcoRent { id: string; kind: 'rent'; label: string; /** naira per year for a one room at rich=0 and rich=1 */ poor: number; rich: number }
export interface EcoShock { id: string; kind: 'shock'; label: string; mult: Record<string, number> }
export interface EcoSink { id: string; kind: 'sink'; label: string; rate: number }
export interface EcoMacro { id: string; kind: 'macro'; inflationPerYear: number; dayPerYear: number }
export type EconomyItem = EcoGood | EcoWage | EcoRent | EcoShock | EcoSink | EcoMacro;

/** Saved under save.society (population deltas, factions, market) and save.nemesis (memories of the player). */
export interface NemesisMemory { k: string; day: number; at: string; w: number; note?: string }
// ---------------------------------------------------------------- features agent: shops.json (paint, plates, trackers, identity, decor)
export type ShopItem =
  | { kind: 'site'; id: string; site: 'paint' | 'lga'; name: string; lat: number; lon: number; lga?: string; blurb?: string; carMart?: boolean }
  | { kind: 'colour'; id: string; name: string; hex: string }
  | { kind: 'finish'; id: string; name: string; desc: string; mult: number; secs: number; metalness: number; roughness: number; clearcoat: number; flake?: number; iridescence?: number; envBoost?: number }
  | { kind: 'plate-code'; id: string; lga: string; code: string }
  | { kind: 'plate-tier'; id: string; name: string; minLen: number; maxLen: number; price: number }
  | { kind: 'tracker'; id: string; name: string; desc: string; price: number; ping: number; range: number; battery: string }
  | { kind: 'fee'; id: string; name: string; price: number; desc?: string }
  | { kind: 'car'; id: string; name: string; vehicle: 'sedan' | 'hatch' | 'jeep' | 'suv' | 'danfo'; price: number; blurb: string }
  | { kind: 'wallpaint'; id: string; name: string; hex: string }
  | { kind: 'walltex'; id: string; name: string; pattern: string; price: number }
  | { kind: 'floor'; id: string; name: string; pattern: string; hex: string; price: number }
  | { kind: 'decor'; id: string; name: string; cat: string; where: 'out' | 'in' | 'both'; mount: 'floor' | 'wall' | 'roof'; price: number; size: [number, number, number]; scale: [number, number]; solid?: boolean; tint?: boolean; text?: boolean; blurb?: string };
export type ShopsFile = ContentFile<ShopItem>;
