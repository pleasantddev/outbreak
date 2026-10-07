// Customization catalog. Cosmetic only: nothing here changes combat numbers.
import type { ArchetypeId, WeaponId } from './balance';

export type BodyType = 'male' | 'female';
export type Pattern = 'solid' | 'ankara_sun' | 'ankara_wave' | 'adire' | 'camo_urban' | 'camo_night' | 'stripe_danfo' | 'kente';
export type TopStyle = 'tee' | 'hoodie' | 'jacket' | 'tactical' | 'agbada';
export type HeadGear = 'none' | 'cap' | 'helmet' | 'bandana' | 'gasmask' | 'hood' | 'fila';
export type Hair = 'none' | 'buzzed' | 'simpleparted' | 'long' | 'buns' | 'buzzedfemale';

export interface CharacterLook {
  name: string;
  body: BodyType;
  skin: number; // index into SKIN_TONES
  hair: Hair;
  beard: boolean;
  top: TopStyle;
  topPattern: Pattern;
  topColor: string;
  topAccent: string;
  pants: Pattern;
  pantsColor: string;
  shoes: string;
  head: HeadGear;
  vest: boolean;
  backpack: boolean;
  scars: number; // 0..1 wear and blood on clothing
  facePaint: 'none' | 'tribal' | 'skull' | 'ash';
}

export const SKIN_TONES = ['#3b2219', '#4d2c1e', '#61391f', '#7a4a2b', '#9b6a45', '#c08a62'];

export const PALETTE = ['#141414', '#2a2622', '#3e3a33', '#5b1a16', '#8a0b0b', '#b0332a', '#d9a441', '#e8c34a', '#2f4a2c', '#45603b', '#1e2b3a', '#355070', '#6b6b6b', '#c9c1b2', '#e8e0d0', '#5a3d2b'];

export const PATTERNS: { id: Pattern; name: string }[] = [
  { id: 'solid', name: 'Plain' },
  { id: 'ankara_sun', name: 'Ankara: Sunburst' },
  { id: 'ankara_wave', name: 'Ankara: Lagoon Wave' },
  { id: 'adire', name: 'Adire Indigo' },
  { id: 'kente', name: 'Strip Weave' },
  { id: 'camo_urban', name: 'Urban Camo' },
  { id: 'camo_night', name: 'Night Camo' },
  { id: 'stripe_danfo', name: 'Danfo Stripe' },
];
export const TOPS: { id: TopStyle; name: string }[] = [
  { id: 'tee', name: 'Street Tee' }, { id: 'hoodie', name: 'Hoodie' }, { id: 'jacket', name: 'Bomber Jacket' },
  { id: 'tactical', name: 'Tactical Shirt' }, { id: 'agbada', name: 'Short Agbada' },
];
export const HEADGEAR: { id: HeadGear; name: string }[] = [
  { id: 'none', name: 'Bare' }, { id: 'cap', name: 'Cap' }, { id: 'fila', name: 'Fila' }, { id: 'bandana', name: 'Bandana Mask' },
  { id: 'gasmask', name: 'Gas Mask' }, { id: 'helmet', name: 'Helmet' }, { id: 'hood', name: 'Hood' },
];
export const HAIRS: { id: Hair; name: string }[] = [
  { id: 'none', name: 'Clean' }, { id: 'buzzed', name: 'Low Cut' }, { id: 'simpleparted', name: 'Side Part' },
  { id: 'buzzedfemale', name: 'Short Crop' }, { id: 'buns', name: 'Buns' }, { id: 'long', name: 'Long' },
];

export interface Operator { id: string; name: string; archetype: ArchetypeId; bio: string; look: CharacterLook }

// Starting operators. Players can edit any of them in the Operators screen.
export const OPERATORS: Operator[] = [
  { id: 'tunde', name: 'Tunde "Agbero" Bakare', archetype: 'runner', bio: 'Ran the Oshodi under-bridge park for nine years. Knows every danfo by its horn. Still collects fares from people who are already dead.',
    look: { name: 'Tunde', body: 'male', skin: 1, hair: 'buzzed', beard: true, top: 'tee', topPattern: 'stripe_danfo', topColor: '#e8c34a', topAccent: '#141414', pants: 'solid', pantsColor: '#2a2622', shoes: '#3e3a33', head: 'cap', vest: false, backpack: true, scars: 0.5, facePaint: 'none' } },
  { id: 'amaka', name: 'Amaka Obi', archetype: 'hunter', bio: 'Former lagoon surveyor. Mapped the water for a dredging company that vanished the night the Heart first beat. She counts footsteps without meaning to.',
    look: { name: 'Amaka', body: 'female', skin: 2, hair: 'buns', beard: false, top: 'jacket', topPattern: 'ankara_wave', topColor: '#355070', topAccent: '#d9a441', pants: 'camo_urban', pantsColor: '#3e3a33', shoes: '#141414', head: 'none', vest: true, backpack: false, scars: 0.3, facePaint: 'none' } },
  { id: 'ibrahim', name: 'Ibrahim "Wall" Musa', archetype: 'enforcer', bio: 'Market security at Alaba for a decade. When the stalls started screaming he held the gate for four hours. Nobody he let through has thanked him.',
    look: { name: 'Ibrahim', body: 'male', skin: 0, hair: 'none', beard: true, top: 'tactical', topPattern: 'camo_night', topColor: '#2f4a2c', topAccent: '#141414', pants: 'solid', pantsColor: '#1e2b3a', shoes: '#141414', head: 'helmet', vest: true, backpack: true, scars: 0.7, facePaint: 'ash' } },
  { id: 'zainab', name: 'Zainab "Ghost" Lawal', archetype: 'scout', bio: 'Night courier on an okada with no headlight. Learned the city by sound. She says the dark has started listening back.',
    look: { name: 'Zainab', body: 'female', skin: 3, hair: 'buzzedfemale', beard: false, top: 'hoodie', topPattern: 'adire', topColor: '#1e2b3a', topAccent: '#c9c1b2', pants: 'solid', pantsColor: '#141414', shoes: '#5b1a16', head: 'bandana', vest: false, backpack: false, scars: 0.2, facePaint: 'tribal' } },
];

export type WeaponSkin = 'factory' | 'rust' | 'blood' | 'ankara' | 'gold' | 'night' | 'danfo' | 'bone';
export const WEAPON_SKINS: { id: WeaponSkin; name: string; base: string; accent: string; metal: number; rough: number }[] = [
  { id: 'factory', name: 'Factory', base: '#1b1c1e', accent: '#2b2d30', metal: 0.6, rough: 0.5 },
  { id: 'rust', name: 'Oshodi Rust', base: '#5a3220', accent: '#2a1a12', metal: 0.5, rough: 0.85 },
  { id: 'blood', name: 'Bloodwork', base: '#3a0606', accent: '#8a0b0b', metal: 0.4, rough: 0.45 },
  { id: 'ankara', name: 'Ankara', base: '#b0332a', accent: '#e8c34a', metal: 0.1, rough: 0.6 },
  { id: 'gold', name: 'Big Man Gold', base: '#b08a2e', accent: '#e8c34a', metal: 1.0, rough: 0.25 },
  { id: 'night', name: 'Nightfall', base: '#0c0d12', accent: '#3a1f5c', metal: 0.3, rough: 0.7 },
  { id: 'danfo', name: 'Danfo Yellow', base: '#e0b030', accent: '#141414', metal: 0.2, rough: 0.5 },
  { id: 'bone', name: 'Bone Charm', base: '#d8d0bf', accent: '#5b1a16', metal: 0.0, rough: 0.75 },
];

export interface WeaponLoadout { skin: WeaponSkin; optic: string | null; muzzle: string | null; mag: string | null; grip: string | null; charm: boolean }
export type Armory = Record<WeaponId, WeaponLoadout>;

export function defaultArmory(): Armory {
  const base = (): WeaponLoadout => ({ skin: 'factory', optic: null, muzzle: null, mag: null, grip: null, charm: false });
  return { pistol: base(), smg: base(), ar: { ...base(), optic: 'reddot' }, shotgun: base(), sniper: { ...base(), optic: 'scope4' }, machete: base() };
}

export type VehicleSkin = 'stock' | 'rusted' | 'blessed' | 'night';
