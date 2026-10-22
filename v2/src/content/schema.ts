// Content types for v2/public/content/*.json. Each workstream appends its own section; keep ids stable strings.
export interface ContentFile<T> { version: number; items: T[] }

// ================================================================ missions workstream
// Files: places.json, missions.json, events.json, routes.json, skills.json. Everything is referenced by stable string ids
// so the admin panel can edit, add and remove items. The runtime is systems/missions*.ts, the checker is content/validate.ts.
import type { VehicleKind, WeaponId } from '../data/balance';

/** A named spot on the real map. Missions, events and routes refer to these by id (or inline lat/lon). */
export interface PlaceDef { id: string; name: string; lat: number; lon: number; /** arrival radius in metres (default 16) */ r?: number; area?: string; kind?: PlaceKind; note?: string }
export type PlaceKind = 'park' | 'market' | 'bank' | 'station' | 'junction' | 'church' | 'mosque' | 'school' | 'hospital' | 'police' | 'fuel' | 'mechanic' | 'shop' | 'food' | 'bar' | 'office' | 'estate' | 'bridge' | 'jetty' | 'landmark' | 'street' | 'compound' | 'stop';
export type PlaceRef = string | { lat: number; lon: number; r?: number; name?: string };

/** [speaker, line] */
export type Line = [who: string, text: string];
export type Faction = 'streets' | 'union' | 'police' | 'church' | 'market' | 'landlords' | 'students' | 'mechanics' | 'riders';
export const FACTIONS: Record<Faction, string> = { streets: 'Street cred', union: 'Park union', police: 'Police', church: 'Community', market: 'Traders', landlords: 'Landlords', students: 'Campus', mechanics: 'Mechanics', riders: 'Riders' };

/** All listed fields must hold. Used for requirements, choice options, branches and event triggers. */
export interface Cond {
  level?: number; skill?: Record<string, number>; rep?: Record<string, number>;
  cash?: number; flag?: string; noFlag?: string; item?: string; noItem?: string;
  /** game hour window; wraps past midnight when from > to */
  hours?: [from: number, to: number];
  wantedMin?: number; wantedMax?: number; vehicle?: VehicleKind[]; onFoot?: boolean;
  weather?: string[]; after?: string[]; notAfter?: string[];
  /** random chance 0..1 */
  chance?: number;
  /** skill roll: succeeds with probability 0.5 + 0.1 * (skill level + talk/haggle bonus - dc), clamped to 5..95 percent */
  roll?: { skill: string; dc: number };
}

/** Things that happen. Every field is optional and applied in a fixed order. */
export interface Fx {
  cash?: number; xp?: number; skillXp?: Record<string, number>; rep?: Record<string, number>;
  wanted?: number; clearWanted?: boolean; heat?: number;
  giveItem?: string[]; takeItem?: string[]; setFlag?: string[]; clearFlag?: string[]; unlock?: string[];
  toast?: [title: string, body: string]; say?: Line[];
  hurt?: number; heal?: boolean;
  /** damage the vehicle you are in */
  breakVehicle?: 'tire' | 'engine' | 'fuel' | 'body'; repairVehicle?: boolean; refuel?: boolean;
  /** move the clock forward by hours */
  hours?: number; weather?: 'clear' | 'hot' | 'harmattan' | 'fog' | 'rain' | 'storm';
  /** offer another mission (phone toast) or start it right away */
  offerMission?: string; startMission?: string;
}

export type StepType = 'goto' | 'talk' | 'pickup' | 'deliver' | 'vehicle' | 'route' | 'visit' | 'choice' | 'branch' | 'wait' | 'call' | 'fight' | 'chase' | 'tail' | 'evade' | 'race' | 'sneak' | 'hack' | 'tap' | 'trade' | 'escort' | 'stay' | 'end';

export interface StepBase {
  id: string; type: StepType;
  /** the objective line on the HUD */
  text?: string;
  next?: string;
  /** applied when the step starts / when it completes */
  fx?: Fx; done?: Fx;
  /** barks played when the step starts */
  say?: Line[];
  /** seconds allowed for this step; when it runs out the mission goes to onTimeout (or fails) */
  timer?: number; onTimeout?: string;
  /** hide the GPS line for this step */
  noGps?: boolean;
}
export interface GotoStep extends StepBase { type: 'goto'; to: PlaceRef; r?: number; on?: 'foot' | 'vehicle' | 'any'; vehicle?: VehicleKind[] }
export interface TalkStep extends StepBase { type: 'talk'; npc: string; to?: PlaceRef; lines: Line[]; r?: number; look?: 'ped' | 'area' | 'police' | 'vendor' }
export interface PickupStep extends StepBase { type: 'pickup'; to: PlaceRef; item: string; r?: number; npc?: string }
export interface DeliverStep extends StepBase { type: 'deliver'; to: PlaceRef; item: string; r?: number; npc?: string }
export interface VehicleStep extends StepBase { type: 'vehicle'; kind: VehicleKind[]; /** spawn one here if none is near */ provide?: PlaceRef; /** let go of the old marker: you must stay in it */ }
export interface RouteStep extends StepBase { type: 'route'; route: string; reverse?: boolean; /** how many stops to serve (default all) */ stops?: number; /** fare multiplier */ fareMult?: number }
export interface VisitStep extends StepBase { type: 'visit'; places: PlaceRef[]; r?: number; each?: Fx; npcs?: string[] }
export interface ChoiceOption { text: string; next: string; fx?: Fx; if?: Cond; /** shown but locked when the Cond fails */ lockedHint?: string; /** skill gamble */ roll?: { skill: string; dc: number; ok: string; bad: string; okFx?: Fx; badFx?: Fx } }
export interface ChoiceStep extends StepBase { type: 'choice'; prompt: string; who?: string; options: ChoiceOption[]; /** auto-pick this option index when time runs out */ secs?: number; fallback?: number }
export interface BranchStep extends StepBase { type: 'branch'; cases: { if: Cond; next: string }[]; else: string }
export interface WaitStep extends StepBase { type: 'wait'; secs?: number; untilHour?: number; at?: PlaceRef; r?: number }
export interface CallStep extends StepBase { type: 'call'; who: string; line: string; lines?: Line[]; answer: string; decline: string; ringSecs?: number }
export interface FoeDef { n: number; role?: 'area' | 'ped' | 'police'; weapon?: WeaponId; hp?: number; name?: string }
export interface FightStep extends StepBase { type: 'fight'; at: PlaceRef; foes: FoeDef[]; /** reinforcement waves, one after the last is beaten */ waves?: FoeDef[][]; /** instead of winning by force, survive this many seconds */ hold?: number; r?: number }
export interface ChaseStep extends StepBase { type: 'chase'; from: PlaceRef; /** catch it before the timer */ caughtR?: number; speed?: number; npc?: string; /** it escapes if it gets this far away */ escapeD?: number }
export interface TailStep extends StepBase { type: 'tail'; from: PlaceRef; kind: VehicleKind; secs: number; minD?: number; maxD?: number }
export interface EvadeStep extends StepBase { type: 'evade'; level: number; secs?: number }
export interface RaceStep extends StepBase { type: 'race'; checkpoints: PlaceRef[]; secs: number; /** finish with at least this many seconds left to set flag "par" */ par?: number; vehicle?: VehicleKind[]; r?: number }
export interface GuardDef { at: PlaceRef; /** facing in degrees, 0 = north */ face?: number; range?: number; name?: string }
export interface SneakStep extends StepBase { type: 'sneak'; to: PlaceRef; guards: GuardDef[]; onSpot?: string; r?: number }
export interface HackStep extends StepBase { type: 'hack'; label: string; len?: number; secs?: number; onFail?: string; at?: PlaceRef }
export interface TapStep extends StepBase { type: 'tap'; label: string; taps: number; secs: number; perTap?: number; skill?: string; onFail?: string; at?: PlaceRef }
export interface TradeStep extends StepBase { type: 'trade'; at?: PlaceRef; npc?: string; buy?: { item: string; price: number; label?: string }; sell?: { item: string; price: number; label?: string }; haggle?: boolean; onWalk?: string; onBroke?: string; r?: number }
export interface EscortStep extends StepBase { type: 'escort'; npc: string; from: PlaceRef; to: PlaceRef; r?: number; ambush?: FoeDef[] }
export interface StayStep extends StepBase { type: 'stay'; at: PlaceRef; secs: number; r?: number; /** leaving the circle resets or fails */ strict?: boolean }
export interface EndStep extends StepBase { type: 'end'; outcome: 'win' | 'fail'; title?: string; /** replaces the mission rewards when set */ rewards?: Fx }
export type StepDef = GotoStep | TalkStep | PickupStep | DeliverStep | VehicleStep | RouteStep | VisitStep | ChoiceStep | BranchStep | WaitStep | CallStep | FightStep | ChaseStep | TailStep | EvadeStep | RaceStep | SneakStep | HackStep | TapStep | TradeStep | EscortStep | StayStep | EndStep;

export type MissionCategory = 'story' | 'transport' | 'delivery' | 'trade' | 'crime' | 'community' | 'racing' | 'mechanic' | 'land' | 'student' | 'police' | 'rescue';
export interface Offer {
  /** listed in the Hustles app when the requirements are met (default true) */
  board?: boolean;
  /** a contact rings the phone now and then */
  call?: { who: string; line: string; hours?: [number, number]; weight?: number };
  /** a named person stands at a spot on the map with a marker */
  giver?: { name: string; at: PlaceRef; line: string; look?: 'ped' | 'area' | 'police' | 'vendor' };
}
export interface MissionDef {
  id: string; title: string; arc: string; category: MissionCategory; area: string;
  giver: string; blurb: string;
  /** rough play time in minutes */
  minutes: number; difficulty: 1 | 2 | 3 | 4 | 5;
  req?: Cond; offer?: Offer;
  start: string; steps: StepDef[];
  rewards: Fx; penalty?: Fx;
  fail?: { timer?: number; onDeath?: boolean; wantedAbove?: number; leaveVehicle?: boolean };
  /** omitted = can be done once; { cooldownMin } = repeatable (real minutes) */
  repeat?: { cooldownMin: number };
  /** old hard-coded job id this mission replaces (startJob('delivery') keeps working) */
  legacy?: string;
  tags?: string[];
}

/** Random and world events. They run the same step graph as missions. */
export interface EventDef {
  id: string; title: string; blurb: string; weight: number; cooldown: number; once?: boolean;
  when: {
    hours?: [number, number]; weather?: string[];
    /** inside r metres of any of these places */
    near?: PlaceRef[]; r?: number;
    inVehicle?: boolean; vehicle?: VehicleKind[]; onFoot?: boolean; speedMin?: number;
    wantedMin?: number; wantedMax?: number; minLevel?: number; flag?: string; noFlag?: string;
    /** day of week, 0 = Sunday */
    weekday?: number[];
    /** minimum number of potholes within 60 m (flood spots) */
    potholes?: number;
  };
  /** runs while a mission is active too (only quiet, instant ones should) */
  ambient?: boolean;
  start: string; steps: StepDef[]; rewards?: Fx; tags?: string[];
}

/** Named routes: danfo lines, okada runs, keke loops, delivery corridors. */
export interface RouteStopDef { place: PlaceRef; /** fare per passenger at this stop (default route fare) */ fare?: number; dwell?: number; label?: string }
export interface RouteDef {
  id: string; name: string; mode: 'danfo' | 'okada' | 'keke' | 'delivery' | 'bus'; vehicle: VehicleKind;
  blurb: string; fare: number; stops: RouteStopDef[]; loop?: boolean;
  /** busiest hours */
  rush?: [number, number]; via?: string[]; tags?: string[];
}

/** Skills, their branches (modes) and perks. */
export interface StatMod { stat: string; add?: number; mul?: number }
export interface PerkDef { id: string; name: string; desc: string; tier: 1 | 2 | 3 | 4 | 5; /** skill level needed */ level: number; cost?: number; requires?: string[]; mods: StatMod[]; flag?: string }
export interface BranchDef { id: string; name: string; desc: string; perks: PerkDef[] }
export interface SkillDef {
  id: string; name: string; blurb: string; color: string; icon: string; maxLevel: number;
  /** xp to go from level L to L+1 is xpBase * L ^ xpPow */
  xpBase: number; xpPow: number;
  /** granted for every level reached */
  perLevel: StatMod[];
  branches: BranchDef[];
  /** what trains it, shown in the app */
  trains: string[];
}
export interface StatKeyDef { label: string; kind: 'mul' | 'add'; base: number; where: string }
/** Every number a perk may change, and where the game reads it. */
export const STAT_KEYS: Record<string, StatKeyDef> = {
  'move.sprint': { label: 'Sprint speed', kind: 'mul', base: 1, where: 'sim moveActor' },
  'move.jog': { label: 'Jog speed', kind: 'mul', base: 1, where: 'sim moveActor' },
  'stamina.max': { label: 'Sprint stamina', kind: 'mul', base: 1, where: 'skills stamina bar' },
  'stamina.regen': { label: 'Stamina recovery', kind: 'mul', base: 1, where: 'skills stamina bar' },
  'melee.damage': { label: 'Melee damage', kind: 'mul', base: 1, where: 'sim melee' },
  'melee.cooldown': { label: 'Melee cooldown (lower is faster)', kind: 'mul', base: 1, where: 'sim melee' },
  'melee.ko': { label: 'Knock-down chance', kind: 'mul', base: 1, where: 'sim melee' },
  'gun.spread': { label: 'Gun spread (lower is better)', kind: 'mul', base: 1, where: 'sim combat' },
  'gun.reload': { label: 'Reload time (lower is faster)', kind: 'mul', base: 1, where: 'sim combat' },
  'gun.damage': { label: 'Gun damage', kind: 'mul', base: 1, where: 'sim hitscan' },
  'body.hp': { label: 'Max health', kind: 'mul', base: 1, where: 'skills applies to player' },
  'body.regen': { label: 'Health regeneration', kind: 'mul', base: 1, where: 'sim updateActor' },
  'drive.top': { label: 'Car top speed', kind: 'mul', base: 1, where: 'sim updateVehicle' },
  'drive.grip': { label: 'Car grip', kind: 'mul', base: 1, where: 'sim updateVehicle' },
  'drive.tire': { label: 'Pothole tyre damage (lower is better)', kind: 'mul', base: 1, where: 'sim updateVehicle' },
  'drive.fuel': { label: 'Fuel use (lower is better)', kind: 'mul', base: 1, where: 'sim updateVehicle' },
  'ride.top': { label: 'Okada and keke top speed', kind: 'mul', base: 1, where: 'sim updateVehicle' },
  'ride.grip': { label: 'Okada and keke grip', kind: 'mul', base: 1, where: 'sim updateVehicle' },
  'heat.witness': { label: 'Witness distance (lower is better)', kind: 'mul', base: 1, where: 'sim crime' },
  'heat.cool': { label: 'Wanted cool-down time (lower is faster)', kind: 'mul', base: 1, where: 'sim updateWanted' },
  'heat.fine': { label: 'Arrest fine (lower is better)', kind: 'mul', base: 1, where: 'sim arrest' },
  'stealth.detect': { label: 'Guard detection range (lower is better)', kind: 'mul', base: 1, where: 'missions sneak' },
  'trade.buy': { label: 'Buying prices (lower is better)', kind: 'mul', base: 1, where: 'missions trade' },
  'trade.sell': { label: 'Selling prices', kind: 'mul', base: 1, where: 'missions trade' },
  'trade.haggle': { label: 'Haggle roll bonus (levels)', kind: 'add', base: 0, where: 'missions roll' },
  'talk.roll': { label: 'Talking roll bonus (levels)', kind: 'add', base: 0, where: 'missions roll' },
  'pay.cash': { label: 'Mission cash rewards', kind: 'mul', base: 1, where: 'missions rewards' },
  'pay.rep': { label: 'Reputation gains', kind: 'mul', base: 1, where: 'missions rewards' },
  'pay.xp': { label: 'Skill XP gains', kind: 'mul', base: 1, where: 'skills xp' },
  'mech.repair': { label: 'Repair effort (lower is faster)', kind: 'mul', base: 1, where: 'missions tap' },
  'mech.hp': { label: 'Repair quality', kind: 'mul', base: 1, where: 'missions repair' },
  'hack.secs': { label: 'Hack time (seconds)', kind: 'add', base: 0, where: 'missions hack' },
  'hack.len': { label: 'Hack code length', kind: 'add', base: 0, where: 'missions hack' },
  'fare.mult': { label: 'Fare income', kind: 'mul', base: 1, where: 'missions route' },
};
