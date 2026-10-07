// All tunable numbers live here so balance passes never touch logic.
// Units: meters, seconds, hit points. See docs/04_SYSTEMS.md for rationale.

export type WeaponId = 'pistol' | 'smg' | 'ar' | 'shotgun' | 'sniper' | 'machete';
export type AmmoType = 'light' | 'heavy' | 'shells' | 'sniper' | 'none';
export type AbilityId = 'force' | 'shadow' | 'metal';
export type VehicleKind = 'okada' | 'danfo' | 'suv';
export type CreatureKind = 'crawler' | 'hollow' | 'stalker';
export type ArchetypeId = 'scout' | 'hunter' | 'enforcer' | 'runner';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: 'primary' | 'secondary' | 'melee';
  ammo: AmmoType;
  damage: number;
  pellets: number;
  rpm: number;
  mag: number;
  reload: number;
  hipSpread: number; // radians
  adsSpread: number;
  range: number; // full damage range
  maxRange: number;
  headMult: number;
  recoil: number; // camera kick in radians
  adsZoom: number; // fov multiplier
  auto: boolean;
  noise: number; // meters at which bots and creatures hear it
  moveMult: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: { id: 'pistol', name: 'Ogun 9', slot: 'secondary', ammo: 'light', damage: 24, pellets: 1, rpm: 380, mag: 12, reload: 1.4, hipSpread: 0.03, adsSpread: 0.008, range: 22, maxRange: 60, headMult: 2.0, recoil: 0.018, adsZoom: 0.85, auto: false, noise: 70, moveMult: 1.0 },
  smg: { id: 'smg', name: 'Okada SMG', slot: 'primary', ammo: 'light', damage: 18, pellets: 1, rpm: 820, mag: 30, reload: 1.9, hipSpread: 0.04, adsSpread: 0.016, range: 18, maxRange: 55, headMult: 1.6, recoil: 0.012, adsZoom: 0.85, auto: true, noise: 80, moveMult: 0.98 },
  ar: { id: 'ar', name: 'Marina AR', slot: 'primary', ammo: 'heavy', damage: 27, pellets: 1, rpm: 640, mag: 30, reload: 2.2, hipSpread: 0.05, adsSpread: 0.006, range: 45, maxRange: 140, headMult: 1.8, recoil: 0.016, adsZoom: 0.7, auto: true, noise: 110, moveMult: 0.94 },
  shotgun: { id: 'shotgun', name: 'Third Mainland 12', slot: 'primary', ammo: 'shells', damage: 13, pellets: 9, rpm: 75, mag: 6, reload: 3.0, hipSpread: 0.09, adsSpread: 0.065, range: 9, maxRange: 30, headMult: 1.4, recoil: 0.06, adsZoom: 0.9, auto: false, noise: 100, moveMult: 0.95 },
  sniper: { id: 'sniper', name: 'Lekki Longshot', slot: 'primary', ammo: 'sniper', damage: 96, pellets: 1, rpm: 42, mag: 5, reload: 3.1, hipSpread: 0.12, adsSpread: 0.0, range: 200, maxRange: 400, headMult: 2.2, recoil: 0.07, adsZoom: 0.25, auto: false, noise: 180, moveMult: 0.9 },
  machete: { id: 'machete', name: 'Cutlass', slot: 'melee', ammo: 'none', damage: 55, pellets: 1, rpm: 90, mag: 0, reload: 0, hipSpread: 0, adsSpread: 0, range: 2.2, maxRange: 2.2, headMult: 1.3, recoil: 0, adsZoom: 1, auto: false, noise: 6, moveMult: 1.05 },
};

export type AttachmentSlot = 'optic' | 'muzzle' | 'mag' | 'grip';
export interface AttachmentDef {
  id: string; slot: AttachmentSlot; name: string; desc: string;
  mods: Partial<{ adsSpread: number; hipSpread: number; recoil: number; mag: number; reload: number; adsZoom: number; noise: number; maxRange: number; moveMult: number }>;
  fits: WeaponId[];
}
// Every attachment trades something; nothing is a pure upgrade.
export const ATTACHMENTS: AttachmentDef[] = [
  { id: 'reddot', slot: 'optic', name: 'Red Dot', desc: 'Cleaner sight picture. Slight zoom.', mods: { adsSpread: 0.85, adsZoom: 0.92 }, fits: ['pistol', 'smg', 'ar', 'shotgun'] },
  { id: 'scope4', slot: 'optic', name: '4x Scope', desc: 'Long reach. Tunnel vision up close.', mods: { adsSpread: 0.6, adsZoom: 0.55, hipSpread: 1.15 }, fits: ['ar', 'sniper'] },
  { id: 'suppressor', slot: 'muzzle', name: 'Suppressor', desc: 'Quiet. Shorter range.', mods: { noise: 0.35, maxRange: 0.85 }, fits: ['pistol', 'smg', 'ar', 'sniper'] },
  { id: 'comp', slot: 'muzzle', name: 'Compensator', desc: 'Less kick. Much louder.', mods: { recoil: 0.7, noise: 1.3 }, fits: ['smg', 'ar', 'shotgun'] },
  { id: 'extmag', slot: 'mag', name: 'Extended Mag', desc: 'More rounds. Slower reload.', mods: { mag: 1.5, reload: 1.2 }, fits: ['pistol', 'smg', 'ar', 'sniper', 'shotgun'] },
  { id: 'quickmag', slot: 'mag', name: 'Quick Mag', desc: 'Fast reload. Fewer rounds.', mods: { mag: 0.8, reload: 0.7 }, fits: ['pistol', 'smg', 'ar', 'sniper'] },
  { id: 'vgrip', slot: 'grip', name: 'Vertical Grip', desc: 'Steady. Slower to move.', mods: { recoil: 0.75, moveMult: 0.97 }, fits: ['smg', 'ar', 'shotgun'] },
  { id: 'laser', slot: 'grip', name: 'Laser', desc: 'Tight hip fire. Visible to enemies.', mods: { hipSpread: 0.6 }, fits: ['pistol', 'smg', 'ar', 'shotgun'] },
];

export interface AbilityDef { id: AbilityId; name: string; cooldown: number; desc: string; color: number }
export const ABILITIES: Record<AbilityId, AbilityDef> = {
  force: { id: 'force', name: 'Force', cooldown: 14, desc: 'Blast a cone of raw pressure. Throws bodies, flips okadas. Hold to pull instead.', color: 0x9fb8ff },
  shadow: { id: 'shadow', name: 'Shadow', cooldown: 18, desc: 'Fold into the dark for 4s and dash. Firing breaks the fold.', color: 0x6a3cff },
  metal: { id: 'metal', name: 'Metal', cooldown: 20, desc: 'Rip roofing and rebar out of the ground into a 3m wall.', color: 0xc8c2b8 },
};
export const ABILITY_RANK_MULT = [1, 1.25, 1.5]; // shards raise rank

export interface ArchetypeDef {
  id: ArchetypeId; name: string; tagline: string; primary: WeaponId; ability: AbilityId;
  backpackSlots: number; perk: string; sprintMult: number; startArmor: number; vehicleEntry: number;
}
// Runner carries the extra space: couriers, smugglers, the people who move things through Lagos.
export const ARCHETYPES: Record<ArchetypeId, ArchetypeDef> = {
  scout: { id: 'scout', name: 'Scout', tagline: 'First in. First out.', primary: 'smg', ability: 'shadow', backpackSlots: 6, perk: 'Sprint 8% faster. Quieter footsteps.', sprintMult: 1.08, startArmor: 0, vehicleEntry: 0.6 },
  hunter: { id: 'hunter', name: 'Hunter', tagline: 'Patience is a weapon.', primary: 'ar', ability: 'force', backpackSlots: 6, perk: 'Fresh footprints glow for you. Pings last twice as long.', sprintMult: 1.0, startArmor: 0, vehicleEntry: 0.6 },
  enforcer: { id: 'enforcer', name: 'Enforcer', tagline: 'Hold the door.', primary: 'shotgun', ability: 'metal', backpackSlots: 6, perk: 'Starts with a light vest (25 armor).', sprintMult: 0.97, startArmor: 25, vehicleEntry: 0.6 },
  runner: { id: 'runner', name: 'Runner', tagline: 'If it moves through Lagos, it moves through me.', primary: 'pistol', ability: 'force', backpackSlots: 10, perk: 'Courier rig: 10 backpack slots instead of 6. Contraband pouch. Mounts vehicles in half the time.', sprintMult: 1.03, startArmor: 0, vehicleEntry: 0.3 },
};

export const PLAYER = {
  hp: 100, maxArmor: 100, radius: 0.35, height: 1.8,
  walk: 2.2, jog: 4.6, sprint: 6.8, crouch: 1.8, aimMove: 2.6, jump: 5.2, gravity: 18,
  carrierSpeedMult: 0.92, regenDelay: 8, carrierRegen: 3,
};

export interface VehicleDef {
  kind: VehicleKind; name: string; seats: number; mass: number; engineForce: number; brake: number;
  maxSteer: number; topSpeed: number; body: number; engine: number; tire: number; fuel: number; fuelBurn: number;
  size: [number, number, number]; wheelRadius: number; wheelBase: number; track: number;
}
export const VEHICLES: Record<VehicleKind, VehicleDef> = {
  okada: { kind: 'okada', name: 'Okada', seats: 2, mass: 180, engineForce: 520, brake: 9, maxSteer: 0.55, topSpeed: 30, body: 220, engine: 120, tire: 60, fuel: 100, fuelBurn: 0.35, size: [0.7, 1.1, 2.0], wheelRadius: 0.32, wheelBase: 1.35, track: 0.5 },
  danfo: { kind: 'danfo', name: 'Danfo', seats: 6, mass: 1900, engineForce: 4300, brake: 60, maxSteer: 0.5, topSpeed: 22, body: 1200, engine: 380, tire: 140, fuel: 100, fuelBurn: 0.5, size: [2.0, 2.2, 4.8], wheelRadius: 0.38, wheelBase: 3.0, track: 1.75 },
  suv: { kind: 'suv', name: 'Wahala SUV', seats: 4, mass: 1700, engineForce: 4600, brake: 70, maxSteer: 0.52, topSpeed: 28, body: 900, engine: 300, tire: 120, fuel: 100, fuelBurn: 0.45, size: [1.95, 1.8, 4.6], wheelRadius: 0.42, wheelBase: 2.8, track: 1.7 },
};

export interface CreatureDef {
  kind: CreatureKind; name: string; hp: number; speed: number; damage: number; attackRange: number; attackCd: number;
  sight: number; hearing: number; scale: [number, number, number]; nightOnly: boolean; nightMult: number;
}
export const CREATURES: Record<CreatureKind, CreatureDef> = {
  crawler: { kind: 'crawler', name: 'Crawler', hp: 60, speed: 6.2, damage: 9, attackRange: 1.5, attackCd: 0.8, sight: 28, hearing: 40, scale: [0.95, 0.85, 0.95], nightOnly: false, nightMult: 1.3 },
  hollow: { kind: 'hollow', name: 'Hollow', hp: 150, speed: 2.4, damage: 22, attackRange: 1.8, attackCd: 1.4, sight: 22, hearing: 55, scale: [1.0, 1.04, 1.0], nightOnly: false, nightMult: 1.4 },
  stalker: { kind: 'stalker', name: 'Stalker', hp: 320, speed: 8.0, damage: 45, attackRange: 2.2, attackCd: 1.6, sight: 45, hearing: 80, scale: [0.82, 1.28, 0.82], nightOnly: true, nightMult: 1.0 },
};

export const AWAKENING = { duration: 45, speedMult: 1.55, jumpMult: 1.9, clawDamage: 70, clawRange: 2.6, regen: 8, hpBonus: 150, pingEvery: 8, climbSpeed: 4.5 };
export const HEART = { pingEvery: 10, hpBonus: 50, holdTime: 30, contractHold: 20, decay: 0.5, creatureAggroRadius: 60 };

// Match timeline in seconds. MATCH_SCALE lets playtests run short matches.
export const TIMELINE = {
  drop: 0,
  survival: 60,
  corruption: 300,
  heart: 600,
  extraction: 720,
  collapse: 960,
  end: 1200,
};

export const ZONE = { startRadius: 520, finalRadius: 30, dps: [1, 3, 6, 12] };

export const CONTRABAND_TARGET = 500000;
