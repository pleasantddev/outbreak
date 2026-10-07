// Shared simulation types. The renderer only ever reads these.
import type { AbilityId, ArchetypeId, CreatureKind, VehicleKind, WeaponId } from '../data/balance';
import type { CharacterLook } from '../data/cosmetics';
import type { Inventory, Item } from './items';
import type { RBody, RCollider } from './physics';

export interface Vec3 { x: number; y: number; z: number }
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** What a client (or a bot brain) asks for each tick. The server decides what actually happens. */
export interface Command {
  mx: number; mz: number; // desired move direction in world space (len <= 1)
  yaw: number; pitch: number; // aim direction
  aimDir?: Vec3; // exact aim ray from the eye (third-person crosshair correction)
  sprint: boolean; crouch: boolean; jump: boolean; aim: boolean; fire: boolean;
  reload: boolean; interact: boolean; ability1: boolean; ability2: boolean;
  slot: number; // -1 no change, 0 primary, 1 secondary, 2 melee
  heal: boolean; awaken: boolean; throwFrag: boolean; flashlight: boolean;
  dropIndex: number;
}
export const emptyCommand = (): Command => ({ mx: 0, mz: 0, yaw: 0, pitch: 0, sprint: false, crouch: false, jump: false, aim: false, fire: false, reload: false, interact: false, ability1: false, ability2: false, slot: -1, heal: false, awaken: false, throwFrag: false, flashlight: false, dropIndex: -1 });

export type Anim = 'idle' | 'walk' | 'jog' | 'sprint' | 'crouch' | 'crouchWalk' | 'jump' | 'fall' | 'drive' | 'swim' | 'swimIdle' | 'dead' | 'heal' | 'claw' | 'cast' | 'climb' | 'mantle';

export interface Actor {
  id: number; name: string; bot: boolean; alive: boolean;
  look: CharacterLook; archetype: ArchetypeId;
  pos: Vec3; vy: number; yaw: number; pitch: number; ext: Vec3; // external push (Force etc)
  body: RBody; collider: RCollider;
  hp: number; maxHp: number; inv: Inventory; slot: 0 | 1 | 2;
  fireCd: number; reloadT: number; reloadTotal: number; healT: number; healKind: 'bandage' | 'medkit' | null;
  crouch: boolean; sprinting: boolean; aiming: boolean; grounded: boolean; swimming: boolean; mantleT: number;
  vehicle: number | null; seat: number;
  shadowT: number; awakenT: number; heart: boolean; flashlight: boolean;
  lastHurt: number; lastShot: number; lastStep: number; lastPing: number;
  anim: Anim; speed: number; recoil: number;
  contract: Contract | null; kills: number; creatureKills: number; damageDealt: number; placement: number;
  killedBy: string | null; won: 'heart' | 'survivor' | 'contract' | null; extracting: number; usedAwakening: boolean;
  cmd: Command; prevCmd: Command;
}

export interface Creature {
  id: number; kind: CreatureKind; alive: boolean; pos: Vec3; vy: number; yaw: number; hp: number; maxHp: number;
  body: RBody; collider: RCollider; state: 'idle' | 'wander' | 'chase' | 'attack' | 'frozen' | 'dead';
  target: number | null; targetCreature: boolean; atkCd: number; seen: number; path: number[]; pathT: number; wanderTo: Vec3 | null;
  deadT: number; anim: 'idle' | 'walk' | 'run' | 'attack' | 'dead' | 'frozen'; speed: number; lit: number; stuck: number; lastPos: Vec3;
}

export interface Vehicle {
  id: number; kind: VehicleKind; body: RBody; ctrl: any; collider: RCollider;
  seats: (number | null)[]; bodyHp: number; engine: number; tires: number[]; fuel: number;
  fireT: number; destroyed: boolean; throttle: number; steer: number; horn: number; lastDriver: number | null;
  wheelSpin: number[]; wheelSteer: number;
}

export interface Loot { id: number; item: Item; pos: Vec3; taken: boolean; bob: number }
export interface Shield { id: number; pos: Vec3; yaw: number; hp: number; t: number; collider: RCollider; owner: number }
export interface Grenade { id: number; pos: Vec3; vel: Vec3; t: number; owner: number }

export interface Contract {
  id: 'hunter' | 'butcher' | 'smuggler' | 'thief' | 'survivor' | 'informant';
  title: string; brief: string; progress: number; goal: number; done: boolean; failed: boolean; target?: number;
}

export type Phase = 'drop' | 'survival' | 'corruption' | 'heart' | 'extraction' | 'collapse' | 'ended';

export type SimEvent =
  | { t: 'shot'; actor: number; weapon: WeaponId; from: Vec3; to: Vec3; suppressed: boolean; hit: 'world' | 'flesh' | 'metal' | 'none'; normal?: Vec3 }
  | { t: 'hit'; target: number; targetKind: 'actor' | 'creature' | 'vehicle' | 'shield'; by: number; dmg: number; head: boolean; at: Vec3; armor: boolean }
  | { t: 'kill'; victim: number; victimName: string; killer: number | null; killerName: string; weapon: string; head: boolean; creature?: boolean }
  | { t: 'creatureDeath'; id: number; by: number | null }
  | { t: 'announce'; title: string; sub?: string; tone: 'info' | 'danger' | 'heart' | 'awaken' | 'victory' }
  | { t: 'pickup'; actor: number; label: string; rarity: string }
  | { t: 'explosion'; at: Vec3; radius: number }
  | { t: 'ability'; actor: number; ability: AbilityId; at: Vec3; dir: Vec3 }
  | { t: 'ping'; kind: 'heart' | 'awakened'; at: Vec3; actor: number }
  | { t: 'heartPulse' }
  | { t: 'step'; actor: number; at: Vec3; loud: boolean; surface: string }
  | { t: 'creatureSound'; id: number; kind: 'growl' | 'scream' | 'attack'; at: Vec3 }
  | { t: 'vehicleHit'; vehicle: number; part: 'tire' | 'engine' | 'fuel' | 'body'; at: Vec3 }
  | { t: 'reload'; actor: number }
  | { t: 'awaken'; actor: number }
  | { t: 'blackout'; region: string }
  | { t: 'hurt'; actor: number; dmg: number; from: Vec3 | null }
  | { t: 'melee'; actor: number }
  | { t: 'enterVehicle'; actor: number; vehicle: number }
  | { t: 'matchEnd'; winner: number | null; how: 'heart' | 'survivor' | 'none' };
