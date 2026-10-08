// The garage. Bodies are imported models of cars people know, renamed and stripped of their badges, each under a
// fictional maker with a name from one Nigerian language. Stats drive physics; "model" names the imported body and
// "shape" the procedural one the Keke uses and every car falls back to.

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
  // physics. Top speeds are capped low and climb with price: a starter does 60 km/h flat out on the gas, a
  // supercar about three times that, so better cars are a real advantage without making the cheap ones hopeless
  topSpeed: number;     // m/s
  accel: number;        // m/s^2 at low speed
  steer: number;        // rad/s at reference speed
  grip: number;         // lateral grip rate
  driftGrip: number;
  mass: number;         // relative, 1 = medium sedan
  sound: EngineSound;
  /** an imported body in public/cars/<model>.glb; without one (or before it loads) the car is built from shape */
  model?: string;
  shape: CarShape;
  defaultPaint: string;
}

export const CARS: CarDef[] = [
  {
    id: 'tokunbo', name: 'Tokunbo 1.8', maker: 'Oba Motors', cls: 'street', price: 0, unlockLevel: 1,
    blurb: 'Foreign used, freshly sprayed, will outlive its third owner. The saloon every Lagos racer starts in.',
    stats: { speed: 2, accel: 3, handling: 7, drift: 6, weight: 5 }, topSpeed: 16.7, accel: 6.0, steer: 2.35, grip: 9.5, driftGrip: 1.9, mass: 1.0, sound: 'turbo4', model: 'camry',
    shape: { length: 4.8, width: 1.82, height: 1.47, wheelbase: 2.78, track: 1.58, wheelR: 0.33, rideH: 0.15, cabin: 0.54, cabinLen: 0.46, roofH: 0.5, nose: 0.55, tail: 0.75, belt: 0.58, fender: 0.02, spoiler: 'lip', style: 'sedan', lights: 'slim' },
    defaultPaint: '#c8ccd0',
  },
  {
    id: 'keke', name: 'Keke Turbo', maker: 'Ajala Works', cls: 'street', price: 15000, unlockLevel: 2,
    blurb: 'Three wheels, one cylinder, zero fear. Corners like it is on rails and laughs at your traffic.',
    stats: { speed: 1, accel: 4, handling: 10, drift: 9, weight: 2 }, topSpeed: 15.3, accel: 7.0, steer: 3.1, grip: 11, driftGrip: 2.6, mass: 0.55, sound: 'twostroke',
    shape: { length: 2.9, width: 1.35, height: 1.75, wheelbase: 1.95, track: 1.15, wheelR: 0.24, rideH: 0.2, cabin: 0.45, cabinLen: 0.7, roofH: 0.8, nose: 0.2, tail: 0.6, belt: 0.45, fender: 0, spoiler: 'none', style: 'keke', lights: 'round' },
    defaultPaint: '#e8c020',
  },
  {
    id: 'gudu', name: 'Iska Gudu', maker: 'Iska Motors', cls: 'street', price: 22000, unlockLevel: 3,
    blurb: 'A small hatch with a big heart. Light on its feet and cheap to fix after a wahala.',
    stats: { speed: 3, accel: 4, handling: 8, drift: 7, weight: 3 }, topSpeed: 19.4, accel: 6.5, steer: 2.4, grip: 10, driftGrip: 2.0, mass: 0.85, sound: 'turbo4', model: 'civic',
    shape: { length: 4.07, width: 1.7, height: 1.32, wheelbase: 2.57, track: 1.47, wheelR: 0.31, rideH: 0.13, cabin: 0.56, cabinLen: 0.5, roofH: 0.48, nose: 0.5, tail: 0.15, belt: 0.56, fender: 0.03, spoiler: 'lip', style: 'hatch', lights: 'slim' },
    defaultPaint: '#e6b11e',
  },
  {
    id: 'danfo', name: 'Danfo GT', maker: 'Eko Coachworks', cls: 'heavy', price: 25000, unlockLevel: 3,
    blurb: 'Fourteen seats and a horn that clears the Third Mainland Bridge. Hit it and you bounce.',
    stats: { speed: 3, accel: 2, handling: 4, drift: 5, weight: 10 }, topSpeed: 20.8, accel: 5.0, steer: 1.95, grip: 8.5, driftGrip: 1.7, mass: 2.2, sound: 'diesel', model: 'hiace',
    shape: { length: 4.7, width: 1.88, height: 1.95, wheelbase: 2.95, track: 1.72, wheelR: 0.37, rideH: 0.2, cabin: 0.52, cabinLen: 0.82, roofH: 0.85, nose: 0.12, tail: 0.95, belt: 0.5, fender: 0.06, spoiler: 'roofrack', style: 'van', lights: 'round' },
    defaultPaint: '#e6b11e',
  },
  {
    id: 'spirit', name: 'Sharp Sharp GTI', maker: 'Japa Motors', cls: 'sport', price: 40000, unlockLevel: 4,
    blurb: 'A hot hatch built for Ikorodu Road at 2am. Light, eager and very happy sideways.',
    stats: { speed: 5, accel: 5, handling: 8, drift: 8, weight: 4 }, topSpeed: 27.8, accel: 7.5, steer: 2.5, grip: 10, driftGrip: 2.1, mass: 0.85, sound: 'turbo4', model: 'golf',
    shape: { length: 4.02, width: 1.73, height: 1.44, wheelbase: 2.47, track: 1.47, wheelR: 0.32, rideH: 0.12, cabin: 0.56, cabinLen: 0.5, roofH: 0.48, nose: 0.5, tail: 0.15, belt: 0.56, fender: 0.05, spoiler: 'duck', style: 'hatch', lights: 'bar' },
    defaultPaint: '#d0141c',
  },
  {
    id: 'agu', name: 'Ugo Agu RS', maker: 'Ugo Motors', cls: 'sport', price: 55000, unlockLevel: 5,
    blurb: 'Four wheel drive, a boxer engine and a rally past. Grips where the others slide.',
    stats: { speed: 6, accel: 6, handling: 8, drift: 7, weight: 5 }, topSpeed: 31.9, accel: 8.0, steer: 2.45, grip: 10.5, driftGrip: 2.0, mass: 1.0, sound: 'turbo4', model: 'impreza',
    shape: { length: 4.4, width: 1.74, height: 1.42, wheelbase: 2.53, track: 1.5, wheelR: 0.33, rideH: 0.15, cabin: 0.55, cabinLen: 0.48, roofH: 0.48, nose: 0.5, tail: 0.7, belt: 0.57, fender: 0.05, spoiler: 'wing', style: 'sedan', lights: 'slim' },
    defaultPaint: '#0d4fa8',
  },
  {
    id: 'ajah', name: 'Ajah V8', maker: 'Lekki Iron', cls: 'sport', price: 70000, unlockLevel: 6,
    blurb: 'A long, low muscle coupe with a V8 you can hear from Ajah to Obalende. Straight lines are its love language.',
    stats: { speed: 7, accel: 6, handling: 5, drift: 9, weight: 7 }, topSpeed: 34.7, accel: 8.5, steer: 2.15, grip: 8.8, driftGrip: 1.5, mass: 1.35, sound: 'v8', model: 'challenger',
    shape: { length: 5.0, width: 1.92, height: 1.41, wheelbase: 2.95, track: 1.6, wheelR: 0.36, rideH: 0.12, cabin: 0.62, cabinLen: 0.42, roofH: 0.44, nose: 0.7, tail: 0.8, belt: 0.6, fender: 0.08, spoiler: 'duck', style: 'muscle', lights: 'quad' },
    defaultPaint: '#8a0b0b',
  },
  {
    id: 'wahala', name: 'Wahala Cruiser', maker: 'Big Man Motors', cls: 'heavy', price: 80000, unlockLevel: 7,
    blurb: 'The big man jeep. Square, loud and armoured in attitude. Push it and others move.',
    stats: { speed: 6, accel: 4, handling: 5, drift: 5, weight: 9 }, topSpeed: 31.9, accel: 7.0, steer: 2.05, grip: 9, driftGrip: 1.7, mass: 1.8, sound: 'v6', model: 'gclass',
    shape: { length: 4.6, width: 1.93, height: 1.93, wheelbase: 2.85, track: 1.6, wheelR: 0.42, rideH: 0.26, cabin: 0.5, cabinLen: 0.6, roofH: 0.62, nose: 0.3, tail: 0.92, belt: 0.55, fender: 0.06, spoiler: 'roofrack', style: 'suv', lights: 'round' },
    defaultPaint: '#101418',
  },
  {
    id: 'sarki', name: 'Sarki Sport', maker: 'Sarki', cls: 'heavy', price: 95000, unlockLevel: 8,
    blurb: 'A luxury SUV that sits high and moves fast. Tinted, smooth and never in a hurry to let you pass.',
    stats: { speed: 6, accel: 5, handling: 6, drift: 5, weight: 8 }, topSpeed: 33.3, accel: 7.5, steer: 2.1, grip: 9.2, driftGrip: 1.7, mass: 1.7, sound: 'v6', model: 'rrsport',
    shape: { length: 4.85, width: 1.98, height: 1.84, wheelbase: 2.9, track: 1.65, wheelR: 0.4, rideH: 0.24, cabin: 0.5, cabinLen: 0.6, roofH: 0.62, nose: 0.3, tail: 0.9, belt: 0.55, fender: 0.05, spoiler: 'roofrack', style: 'suv', lights: 'bar' },
    defaultPaint: '#f2f2f2',
  },
  {
    id: 'ike', name: 'Ugo Ike GT', maker: 'Ugo Motors', cls: 'sport', price: 110000, unlockLevel: 9,
    blurb: 'A twin turbo straight six from the Japanese tuning golden age. Ike means strength, and it has plenty.',
    stats: { speed: 8, accel: 7, handling: 7, drift: 8, weight: 5 }, topSpeed: 37.5, accel: 9.0, steer: 2.4, grip: 10.5, driftGrip: 1.9, mass: 1.0, sound: 'turbo4', model: 'skyline',
    shape: { length: 4.6, width: 1.79, height: 1.36, wheelbase: 2.67, track: 1.5, wheelR: 0.34, rideH: 0.12, cabin: 0.56, cabinLen: 0.44, roofH: 0.45, nose: 0.6, tail: 0.7, belt: 0.58, fender: 0.06, spoiler: 'wing', style: 'coupe', lights: 'quad' },
    defaultPaint: '#1d4fb8',
  },
  {
    id: 'kibiya', name: 'Tauraro Kibiya Turbo', maker: 'Tauraro', cls: 'sport', price: 130000, unlockLevel: 10,
    blurb: 'Rear engined, wide hipped and wearing a whale tail. Brake early, turn in late, fly out.',
    stats: { speed: 8, accel: 8, handling: 7, drift: 7, weight: 5 }, topSpeed: 38.9, accel: 9.5, steer: 2.45, grip: 10.5, driftGrip: 1.8, mass: 0.95, sound: 'turbo4', model: 'porsche',
    shape: { length: 4.29, width: 1.77, height: 1.28, wheelbase: 2.27, track: 1.43, wheelR: 0.33, rideH: 0.12, cabin: 0.56, cabinLen: 0.44, roofH: 0.44, nose: 0.7, tail: 0.3, belt: 0.6, fender: 0.08, spoiler: 'wing', style: 'coupe', lights: 'round' },
    defaultPaint: '#2a2e33',
  },
  {
    id: 'zaki', name: 'Dawaki Zaki', maker: 'Dawaki', cls: 'super', price: 160000, unlockLevel: 11,
    blurb: 'A wedge of carbon with a V12 behind your head. Zaki means lion. It roars like one.',
    stats: { speed: 9, accel: 9, handling: 8, drift: 7, weight: 4 }, topSpeed: 45.8, accel: 10.5, steer: 2.45, grip: 11.5, driftGrip: 2.2, mass: 0.95, sound: 'v12', model: 'aventador',
    shape: { length: 4.8, width: 2.03, height: 1.15, wheelbase: 2.7, track: 1.72, wheelR: 0.36, rideH: 0.09, cabin: 0.5, cabinLen: 0.4, roofH: 0.4, nose: 0.95, tail: 0.3, belt: 0.62, fender: 0.1, spoiler: 'wing', style: 'super', lights: 'slim' },
    defaultPaint: '#e6b11e',
  },
  {
    id: 'odogwu', name: 'Ugo Odogwu GT', maker: 'Ugo Motors', cls: 'super', price: 190000, unlockLevel: 12,
    blurb: 'A grand tourer for the man who has arrived. Long bonnet, short tail, all presence. Odogwu: the strong one.',
    stats: { speed: 10, accel: 9, handling: 7, drift: 6, weight: 6 }, topSpeed: 48.6, accel: 11.0, steer: 2.3, grip: 11, driftGrip: 2.0, mass: 1.15, sound: 'v12', model: 'one77',
    shape: { length: 4.6, width: 2.0, height: 1.24, wheelbase: 2.9, track: 1.7, wheelR: 0.37, rideH: 0.1, cabin: 0.57, cabinLen: 0.46, roofH: 0.42, nose: 0.85, tail: 0.45, belt: 0.6, fender: 0.07, spoiler: 'lip', style: 'coupe', lights: 'bar' },
    defaultPaint: '#101418',
  },
  {
    id: 'ara', name: 'Ekun Ara', maker: 'Ekun', cls: 'super', price: 230000, unlockLevel: 13,
    blurb: 'Mid engined and light as a feather. Ara is thunder, and you hear it before you see it.',
    stats: { speed: 10, accel: 10, handling: 8, drift: 6, weight: 4 }, topSpeed: 51.4, accel: 11.5, steer: 2.45, grip: 11.5, driftGrip: 2.1, mass: 0.9, sound: 'v8', model: 'mclaren',
    shape: { length: 4.54, width: 1.93, height: 1.19, wheelbase: 2.67, track: 1.67, wheelR: 0.34, rideH: 0.09, cabin: 0.5, cabinLen: 0.4, roofH: 0.4, nose: 0.95, tail: 0.3, belt: 0.62, fender: 0.1, spoiler: 'lip', style: 'super', lights: 'slim' },
    defaultPaint: '#ff6a00',
  },
  {
    id: 'walkiya', name: 'Dawaki Walkiya', maker: 'Dawaki', cls: 'super', price: 300000, unlockLevel: 15,
    blurb: 'The fastest thing on four wheels in Oshodi. Walkiya is lightning. Blink and it is gone.',
    stats: { speed: 10, accel: 10, handling: 9, drift: 7, weight: 4 }, topSpeed: 55.6, accel: 12.5, steer: 2.5, grip: 12, driftGrip: 2.2, mass: 0.9, sound: 'electric', model: 'koenigsegg',
    shape: { length: 4.5, width: 2.0, height: 1.18, wheelbase: 2.66, track: 1.7, wheelR: 0.34, rideH: 0.09, cabin: 0.5, cabinLen: 0.4, roofH: 0.4, nose: 0.95, tail: 0.3, belt: 0.62, fender: 0.1, spoiler: 'wing', style: 'super', lights: 'slim' },
    defaultPaint: '#ff6a00',
  },
];

export const carById = (id: string) => CARS.find((c) => c.id === id) ?? CARS[0];

export type Finish = 'gloss' | 'metallic' | 'matte' | 'pearl' | 'chrome';
export type Wrap = 'none' | 'stripes' | 'naija' | 'ankara' | 'danfo' | 'fire' | 'checker' | 'adire';
export type RimStyle = 'stock' | 'five' | 'mesh' | 'multi' | 'turbine' | 'dish' | 'split';
export interface Livery { paint: string; finish: Finish; wrap: Wrap; wrapColor: string; rims: RimStyle; rimColor: string; glow: string | null; plate: string; tint: number }

export const PAINTS = ['#c8ccd0', '#101418', '#e8e2d6', '#d0141c', '#e6b11e', '#1b8a3a', '#0d4fa8', '#ff6a00', '#7a2bd9', '#ff2d8a', '#00a6a6', '#6b4a2a', '#2a2e33', '#a8ff00', '#8a0b0b', '#f2f2f2'];
export const WRAPS: { id: Wrap; name: string }[] = [
  { id: 'none', name: 'Clean' }, { id: 'stripes', name: 'Twin Stripes' }, { id: 'naija', name: 'Green White Green' }, { id: 'ankara', name: 'Ankara Wrap' },
  { id: 'danfo', name: 'Danfo Lines' }, { id: 'fire', name: 'Heat Lines' }, { id: 'checker', name: 'Checker Run' }, { id: 'adire', name: 'Adire Blue' },
];
export const RIMS: { id: RimStyle; name: string }[] = [
  { id: 'stock', name: 'Factory' }, { id: 'five', name: 'Five Star' }, { id: 'mesh', name: 'Lattice' }, { id: 'multi', name: 'Twenty Spoke' }, { id: 'turbine', name: 'Turbine' }, { id: 'dish', name: 'Deep Dish' }, { id: 'split', name: 'Split Seven' },
];
export const GLOWS = [null, '#00e5ff', '#ff2d8a', '#39ff14', '#ffb300', '#8a5cff', '#ff3030'];

export function defaultLivery(def: CarDef, plate = 'RUSH 001'): Livery {
  return { paint: def.defaultPaint, finish: def.cls === 'super' ? 'pearl' : 'metallic', wrap: def.id === 'danfo' ? 'danfo' : 'none', wrapColor: '#111111', rims: def.model ? 'stock' : 'five', rimColor: '#c0c4c8', glow: null, plate, tint: 0.6 };
}
