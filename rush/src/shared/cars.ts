// Every car is an original design from a fictional Lagos marque. Stats drive physics; "shape" drives the
// procedural body builder on the client.

export type CarClass = 'street' | 'sport' | 'super' | 'heavy';
export type EngineSound = 'v8' | 'turbo4' | 'v6' | 'diesel' | 'twostroke' | 'v12' | 'electric';

export interface CarShape {
  length: number; width: number; height: number;   // metres
  wheelbase: number; track: number; wheelR: number; rideH: number;
  cabin: number;      // 0..1 how far back the cabin sits
  cabinLen: number;   // fraction of length covered by the greenhouse
  roofH: number;      // greenhouse height above the beltline
  nose: number;       // 0 blunt .. 1 long sloping nose
  tail: number;       // 0 fastback .. 1 square boot
  belt: number;       // beltline height as a fraction of body height
  fender: number;     // wheel arch flare
  spoiler: 'none' | 'lip' | 'duck' | 'wing' | 'roofrack';
  style: 'sedan' | 'coupe' | 'hatch' | 'suv' | 'super' | 'van' | 'keke' | 'muscle';
  lights: 'slim' | 'round' | 'quad' | 'bar';
}
export interface CarDef {
  id: string; name: string; maker: string; cls: CarClass; price: number; unlockLevel: number;
  blurb: string;
  // gameplay stats, roughly 1..10 for the garage bars
  stats: { speed: number; accel: number; handling: number; drift: number; weight: number };
  // physics
  topSpeed: number;     // m/s
  accel: number;        // m/s^2 at low speed
  steer: number;        // rad/s at reference speed
  grip: number;         // lateral grip rate
  driftGrip: number;
  mass: number;         // relative, 1 = medium sedan
  sound: EngineSound;
  shape: CarShape;
  defaultPaint: string;
}

export const CARS: CarDef[] = [
  {
    id: 'tokunbo', name: 'Tokunbo 1.8', maker: 'Oba Motors', cls: 'street', price: 0, unlockLevel: 1,
    blurb: 'Foreign used, freshly sprayed, will outlive its third owner. The car every Lagos racer starts in.',
    stats: { speed: 5, accel: 6, handling: 7, drift: 6, weight: 5 }, topSpeed: 52, accel: 15, steer: 2.35, grip: 9.5, driftGrip: 1.9, mass: 1.0, sound: 'turbo4',
    shape: { length: 4.5, width: 1.78, height: 1.44, wheelbase: 2.7, track: 1.52, wheelR: 0.33, rideH: 0.15, cabin: 0.47, cabinLen: 0.46, roofH: 0.5, nose: 0.55, tail: 0.75, belt: 0.58, fender: 0.02, spoiler: 'lip', style: 'sedan', lights: 'slim' },
    defaultPaint: '#c8ccd0',
  },
  {
    id: 'keke', name: 'Keke Turbo', maker: 'Ajala Works', cls: 'street', price: 15000, unlockLevel: 2,
    blurb: 'Three wheels, one cylinder, zero fear. Corners like it is on rails and laughs at your traffic.',
    stats: { speed: 3, accel: 9, handling: 10, drift: 9, weight: 2 }, topSpeed: 44, accel: 19, steer: 3.1, grip: 11, driftGrip: 2.6, mass: 0.55, sound: 'twostroke',
    shape: { length: 2.9, width: 1.35, height: 1.75, wheelbase: 1.95, track: 1.15, wheelR: 0.24, rideH: 0.2, cabin: 0.45, cabinLen: 0.7, roofH: 0.8, nose: 0.2, tail: 0.6, belt: 0.45, fender: 0, spoiler: 'none', style: 'keke', lights: 'round' },
    defaultPaint: '#e8c020',
  },
  {
    id: 'danfo', name: 'Danfo GT', maker: 'Eko Coachworks', cls: 'heavy', price: 25000, unlockLevel: 3,
    blurb: 'Fourteen seats, a widebody kit and a horn that clears the Third Mainland Bridge. Hit it and you bounce.',
    stats: { speed: 5, accel: 4, handling: 4, drift: 5, weight: 10 }, topSpeed: 50, accel: 12, steer: 1.95, grip: 8.5, driftGrip: 1.7, mass: 2.2, sound: 'diesel',
    shape: { length: 4.9, width: 2.0, height: 2.15, wheelbase: 2.95, track: 1.72, wheelR: 0.37, rideH: 0.2, cabin: 0.52, cabinLen: 0.82, roofH: 0.85, nose: 0.12, tail: 0.95, belt: 0.5, fender: 0.06, spoiler: 'roofrack', style: 'van', lights: 'round' },
    defaultPaint: '#e6b11e',
  },
  {
    id: 'spirit', name: 'Eko Spirit RS', maker: 'Oba Motors', cls: 'sport', price: 40000, unlockLevel: 4,
    blurb: 'A hot hatch built for Ikorodu Road at 2am. Light, eager and very happy sideways.',
    stats: { speed: 7, accel: 8, handling: 8, drift: 8, weight: 4 }, topSpeed: 60, accel: 18, steer: 2.5, grip: 10, driftGrip: 2.1, mass: 0.85, sound: 'turbo4',
    shape: { length: 4.15, width: 1.82, height: 1.42, wheelbase: 2.6, track: 1.58, wheelR: 0.34, rideH: 0.12, cabin: 0.5, cabinLen: 0.5, roofH: 0.48, nose: 0.5, tail: 0.15, belt: 0.56, fender: 0.05, spoiler: 'duck', style: 'hatch', lights: 'bar' },
    defaultPaint: '#d0141c',
  },
  {
    id: 'ajah', name: 'Ajah V8', maker: 'Lekki Iron', cls: 'sport', price: 60000, unlockLevel: 6,
    blurb: 'A long, low muscle saloon with a V8 you can hear from Ajah to Obalende. Straight lines are its love language.',
    stats: { speed: 8, accel: 7, handling: 5, drift: 9, weight: 7 }, topSpeed: 66, accel: 17, steer: 2.15, grip: 8.8, driftGrip: 1.5, mass: 1.35, sound: 'v8',
    shape: { length: 4.95, width: 1.95, height: 1.38, wheelbase: 2.95, track: 1.65, wheelR: 0.36, rideH: 0.12, cabin: 0.55, cabinLen: 0.42, roofH: 0.44, nose: 0.7, tail: 0.8, belt: 0.6, fender: 0.08, spoiler: 'duck', style: 'muscle', lights: 'quad' },
    defaultPaint: '#101418',
  },
  {
    id: 'wahala', name: 'Wahala Cruiser', maker: 'Lekki Iron', cls: 'heavy', price: 75000, unlockLevel: 7,
    blurb: 'The big man jeep. Seven seats, tinted glass, bull bar and a convoy attitude. Push it and others move.',
    stats: { speed: 7, accel: 6, handling: 5, drift: 5, weight: 9 }, topSpeed: 61, accel: 15, steer: 2.05, grip: 9, driftGrip: 1.7, mass: 1.8, sound: 'v6',
    shape: { length: 4.95, width: 1.98, height: 1.85, wheelbase: 2.9, track: 1.68, wheelR: 0.42, rideH: 0.26, cabin: 0.5, cabinLen: 0.6, roofH: 0.62, nose: 0.3, tail: 0.92, belt: 0.55, fender: 0.06, spoiler: 'roofrack', style: 'suv', lights: 'quad' },
    defaultPaint: '#0e0e10',
  },
  {
    id: 'thirdmainland', name: 'Third Mainland R', maker: 'Lagoon Automobili', cls: 'super', price: 140000, unlockLevel: 9,
    blurb: 'A wedge of carbon named after the longest bridge in town. Mid engine, all attitude, no patience.',
    stats: { speed: 10, accel: 9, handling: 8, drift: 7, weight: 4 }, topSpeed: 76, accel: 21, steer: 2.45, grip: 11.5, driftGrip: 2.2, mass: 0.95, sound: 'v12',
    shape: { length: 4.6, width: 2.02, height: 1.16, wheelbase: 2.7, track: 1.72, wheelR: 0.36, rideH: 0.09, cabin: 0.52, cabinLen: 0.4, roofH: 0.4, nose: 0.95, tail: 0.3, belt: 0.62, fender: 0.1, spoiler: 'wing', style: 'super', lights: 'slim' },
    defaultPaint: '#1b8a3a',
  },
  {
    id: 'phantom', name: 'Banana Island Phantom', maker: 'Lagoon Automobili', cls: 'super', price: 180000, unlockLevel: 11,
    blurb: 'A grand tourer for people with a driver they no longer need. Silent electric shove, absurd top speed.',
    stats: { speed: 10, accel: 10, handling: 7, drift: 6, weight: 6 }, topSpeed: 78, accel: 22, steer: 2.3, grip: 11, driftGrip: 2.0, mass: 1.15, sound: 'electric',
    shape: { length: 4.85, width: 2.0, height: 1.24, wheelbase: 2.9, track: 1.7, wheelR: 0.37, rideH: 0.1, cabin: 0.5, cabinLen: 0.46, roofH: 0.42, nose: 0.85, tail: 0.45, belt: 0.6, fender: 0.07, spoiler: 'lip', style: 'coupe', lights: 'bar' },
    defaultPaint: '#e8e2d6',
  },
];

export const carById = (id: string) => CARS.find((c) => c.id === id) ?? CARS[0];

export type Finish = 'gloss' | 'metallic' | 'matte' | 'pearl' | 'chrome';
export type Wrap = 'none' | 'stripes' | 'naija' | 'ankara' | 'danfo' | 'fire' | 'checker' | 'adire';
export type RimStyle = 'five' | 'mesh' | 'multi' | 'turbine' | 'dish' | 'split';
export interface Livery { paint: string; finish: Finish; wrap: Wrap; wrapColor: string; rims: RimStyle; rimColor: string; glow: string | null; plate: string; tint: number }

export const PAINTS = ['#c8ccd0', '#101418', '#e8e2d6', '#d0141c', '#e6b11e', '#1b8a3a', '#0d4fa8', '#ff6a00', '#7a2bd9', '#ff2d8a', '#00a6a6', '#6b4a2a', '#2a2e33', '#a8ff00', '#8a0b0b', '#f2f2f2'];
export const WRAPS: { id: Wrap; name: string }[] = [
  { id: 'none', name: 'Clean' }, { id: 'stripes', name: 'Twin Stripes' }, { id: 'naija', name: 'Green White Green' }, { id: 'ankara', name: 'Ankara Wrap' },
  { id: 'danfo', name: 'Danfo Lines' }, { id: 'fire', name: 'Heat Lines' }, { id: 'checker', name: 'Checker Run' }, { id: 'adire', name: 'Adire Blue' },
];
export const RIMS: { id: RimStyle; name: string }[] = [
  { id: 'five', name: 'Five Star' }, { id: 'mesh', name: 'Lattice' }, { id: 'multi', name: 'Twenty Spoke' }, { id: 'turbine', name: 'Turbine' }, { id: 'dish', name: 'Deep Dish' }, { id: 'split', name: 'Split Seven' },
];
export const GLOWS = [null, '#00e5ff', '#ff2d8a', '#39ff14', '#ffb300', '#8a5cff', '#ff3030'];

export function defaultLivery(def: CarDef, plate = 'RUSH 001'): Livery {
  return { paint: def.defaultPaint, finish: def.cls === 'super' ? 'pearl' : 'metallic', wrap: def.id === 'danfo' ? 'danfo' : 'none', wrapColor: '#111111', rims: 'five', rimColor: '#c0c4c8', glow: null, plate, tint: 0.6 };
}
