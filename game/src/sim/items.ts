// Items and inventory. Fixed equipment slots plus a backpack whose size depends on archetype.
import { WEAPONS, ATTACHMENTS, type WeaponId, type AmmoType, type AbilityId, type AttachmentSlot } from '../data/balance';
import type { WeaponSkin } from '../data/cosmetics';
import { Rng } from './rng';

export interface WeaponItem { kind: 'weapon'; id: WeaponId; mag: number; att: Partial<Record<AttachmentSlot, string>>; skin: WeaponSkin }
export type StackKind = 'ammo_light' | 'ammo_heavy' | 'ammo_shells' | 'ammo_sniper' | 'bandage' | 'medkit' | 'contraband' | 'frag' | 'repair' | 'fuel' | 'artifact' | 'core';
export interface StackItem { kind: 'stack'; type: StackKind; count: number; value?: number }
export interface ArmorItem { kind: 'armor'; level: 1 | 2 | 3; hp: number }
export interface ShardItem { kind: 'shard'; ability: AbilityId }
export type Item = WeaponItem | StackItem | ArmorItem | ShardItem;

export const STACK_MAX: Record<StackKind, number> = {
  ammo_light: 120, ammo_heavy: 120, ammo_shells: 32, ammo_sniper: 25, bandage: 6, medkit: 3, contraband: 1, frag: 4, repair: 2, fuel: 1, artifact: 1, core: 1,
};
export const STACK_LABEL: Record<StackKind, string> = {
  ammo_light: 'Light Ammo', ammo_heavy: 'Heavy Ammo', ammo_shells: 'Shells', ammo_sniper: 'Sniper Rounds', bandage: 'Bandage', medkit: 'Med Kit',
  contraband: 'Contraband', frag: 'Frag Grenade', repair: 'Repair Kit', fuel: 'Jerrycan', artifact: 'Awakening Artifact', core: 'Awakening Core',
};
export const AMMO_STACK: Record<AmmoType, StackKind | null> = { light: 'ammo_light', heavy: 'ammo_heavy', shells: 'ammo_shells', sniper: 'ammo_sniper', none: null };
export const ARMOR_HP = { 1: 25, 2: 50, 3: 75 } as const;

export interface AbilitySlot { id: AbilityId; rank: number; cd: number }

export class Inventory {
  primary: WeaponItem | null = null;
  secondary: WeaponItem | null = null;
  melee: WeaponItem = { kind: 'weapon', id: 'machete', mag: 0, att: {}, skin: 'factory' };
  abilities: [AbilitySlot | null, AbilitySlot | null] = [null, null];
  armor: ArmorItem | null = null;
  backpack: (StackItem | null)[];
  contrabandPouch: boolean;
  constructor(slots: number, pouch = false) { this.backpack = new Array(slots).fill(null); this.contrabandPouch = pouch; }

  count(type: StackKind) { return this.backpack.reduce((a, s) => a + (s && s.type === type ? s.count : 0), 0); }
  contrabandValue() { return this.backpack.reduce((a, s) => a + (s && s.type === 'contraband' ? (s.value ?? 0) * s.count : 0), 0); }
  freeSlots() { return this.backpack.filter((s) => !s).length; }

  /** Adds as much as fits. Returns the amount left over. */
  addStack(type: StackKind, count: number, value?: number): number {
    const max = type === 'contraband' && this.contrabandPouch ? 3 : STACK_MAX[type];
    let left = count;
    for (const s of this.backpack) {
      if (left <= 0) break;
      if (s && s.type === type && s.count < max && (type !== 'contraband' || s.value === value)) { const n = Math.min(left, max - s.count); s.count += n; left -= n; }
    }
    for (let i = 0; i < this.backpack.length && left > 0; i++) {
      if (!this.backpack[i]) { const n = Math.min(left, max); this.backpack[i] = { kind: 'stack', type, count: n, value }; left -= n; }
    }
    return left;
  }
  take(type: StackKind, count: number): number {
    let got = 0;
    for (let i = this.backpack.length - 1; i >= 0 && got < count; i--) {
      const s = this.backpack[i];
      if (s && s.type === type) { const n = Math.min(s.count, count - got); s.count -= n; got += n; if (s.count <= 0) this.backpack[i] = null; }
    }
    return got;
  }
  drop(index: number): StackItem | null { const s = this.backpack[index]; this.backpack[index] = null; return s; }
}

export function weaponStats(w: WeaponItem) {
  const base = { ...WEAPONS[w.id] };
  for (const id of Object.values(w.att)) {
    const a = ATTACHMENTS.find((x) => x.id === id);
    if (!a) continue;
    for (const [k, v] of Object.entries(a.mods)) (base as any)[k] = (base as any)[k] * (v as number);
  }
  base.mag = Math.round(base.mag);
  return base;
}

export function randomWeapon(rng: Rng, tier: number, skin: WeaponSkin = 'factory'): WeaponItem {
  const pool: WeaponId[] = tier >= 3 ? ['ar', 'sniper', 'shotgun', 'smg'] : tier === 2 ? ['ar', 'smg', 'shotgun', 'pistol', 'sniper'] : ['pistol', 'smg', 'shotgun', 'pistol', 'ar'];
  const id = rng.pick(pool);
  const att: WeaponItem['att'] = {};
  const fits = ATTACHMENTS.filter((a) => a.fits.includes(id));
  const nAtt = tier >= 3 ? 2 : tier === 2 ? 1 : rng.chance(0.3) ? 1 : 0;
  for (let i = 0; i < nAtt; i++) { const a = rng.pick(fits); if (a) att[a.slot] = a.id; }
  const w: WeaponItem = { kind: 'weapon', id, mag: 0, att, skin };
  w.mag = weaponStats(w).mag;
  return w;
}

export function itemLabel(i: Item): string {
  if (i.kind === 'weapon') return WEAPONS[i.id].name;
  if (i.kind === 'armor') return `Vest Lv${i.level}`;
  if (i.kind === 'shard') return `${i.ability[0].toUpperCase()}${i.ability.slice(1)} Shard`;
  if (i.type === 'contraband') return `Contraband ₦${(i.value ?? 0).toLocaleString()}`;
  return `${STACK_LABEL[i.type]} x${i.count}`;
}
export function itemRarity(i: Item): 'common' | 'rare' | 'epic' | 'mythic' {
  if (i.kind === 'stack' && (i.type === 'artifact' || i.type === 'core')) return 'mythic';
  if (i.kind === 'shard') return 'epic';
  if (i.kind === 'armor') return i.level === 3 ? 'epic' : i.level === 2 ? 'rare' : 'common';
  if (i.kind === 'weapon') { const n = Object.keys(i.att).length; return n >= 2 ? 'epic' : n === 1 ? 'rare' : 'common'; }
  if (i.kind === 'stack' && i.type === 'contraband') return 'rare';
  return 'common';
}
