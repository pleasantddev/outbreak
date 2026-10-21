// Seat layout per car model. Everything is in car space: x is lateral (+x is the driver's side, left), y is height above the
// ground under the wheels, z runs from the middle of the wheelbase (+z is the bonnet). `hip` is where the sitter's pelvis
// joint goes, about 0.1 m above the cushion. The renderer anchors the character to it and bends arms and legs to the
// wheel and pedals (or handlebars and pegs), so nothing depends on a particular animation clip's pelvis height.
export type SeatPose = 'drive' | 'sit' | 'ride' | 'pillion';
export type V3 = [number, number, number];
export interface Seat {
  hip: V3; pose: SeatPose;
  /** ankle targets, left foot then right foot (null keeps the clip's legs) */
  feet: [V3, V3] | null;
  /** hand targets, left then right (null keeps the clip's arms) */
  hands: [V3, V3] | null;
  /** forward torso lean in radians (bikes) */
  lean: number;
  /** highest point the top of the head may reach */
  roof: number;
}
export interface CarSeats { seats: Seat[]; wheel?: { c: V3; tilt: number; r: number } }

interface CabinOpt {
  hipX: number; hipY: number; hipZ: number; rearGap: number; roof: number; floor: number;
  wheelY: number; wheelDz: number; tilt: number; pedalDz: number;
  rows?: number[]; rowHipY?: number; seatsPerRow?: number; rearRoof?: number;
}

/** Cars: a driver, a front passenger and a bench behind. */
function cabin(o: CabinOpt): CarSeats {
  const wheelC: V3 = [o.hipX, o.wheelY, o.hipZ + o.wheelDz];
  const t = o.tilt; const u: V3 = [0, Math.cos(t), Math.sin(t)]; // up inside the wheel plane
  const hand = (s: number): V3 => [wheelC[0] + s * 0.19, wheelC[1] + u[1] * 0.07, wheelC[2] + u[2] * 0.07];
  const seats: Seat[] = [];
  const rows = o.rows ?? [o.hipZ, o.hipZ - o.rearGap];
  const hy = o.hipY;
  for (let r = 0; r < rows.length; r++) for (const sx of [1, -1]) {
    const z = rows[r], x = sx * o.hipX, y = r === 0 ? hy : o.rowHipY ?? hy;
    const driver = r === 0 && sx === 1;
    const foot = (dx: number, fz: number, fy: number): V3 => [x + dx, o.floor + fy, z + fz];
    // thighs run forward about 0.42 m from the hip; ankles sit on the floor roughly 0.5 m ahead and below
    const feet: [V3, V3] = driver
      ? [foot(0.16, o.pedalDz - 0.05, 0.13), foot(-0.06, o.pedalDz, 0.2)]
      : [foot(0.1, 0.46, 0.1), foot(-0.1, 0.46, 0.1)];
    seats.push({ hip: [x, y, z], pose: driver ? 'drive' : 'sit', feet, hands: driver ? [hand(1), hand(-1)] : null, lean: 0, roof: r === 0 ? o.roof : o.rearRoof ?? o.roof });
  }
  return { seats, wheel: { c: wheelC, tilt: t, r: 0.19 } };
}

export const SEATS: Record<string, CarSeats> = {
  camry: cabin({ hipX: 0.37, hipY: 0.6, hipZ: 0.3, rearGap: 0.98, roof: 1.37, rearRoof: 1.3, floor: 0.2, wheelY: 0.96, wheelDz: 0.55, tilt: 0.44, pedalDz: 0.62, rowHipY: 0.58 }),
  civic: cabin({ hipX: 0.36, hipY: 0.54, hipZ: 0.22, rearGap: 0.95, roof: 1.23, rearRoof: 1.17, floor: 0.18, wheelY: 0.9, wheelDz: 0.54, tilt: 0.44, pedalDz: 0.62, rowHipY: 0.54 }),
  golf: cabin({ hipX: 0.37, hipY: 0.64, hipZ: 0.14, rearGap: 0.82, roof: 1.35, rearRoof: 1.32, floor: 0.2, wheelY: 0.98, wheelDz: 0.52, tilt: 0.5, pedalDz: 0.6, rowHipY: 0.62 }),
  rrsport: cabin({ hipX: 0.4, hipY: 0.9, hipZ: 0.24, rearGap: 1.0, roof: 1.72, rearRoof: 1.72, floor: 0.36, wheelY: 1.2, wheelDz: 0.5, tilt: 0.36, pedalDz: 0.62, rowHipY: 0.9 }),
  gclass: cabin({ hipX: 0.4, hipY: 0.92, hipZ: 0.3, rearGap: 1.0, roof: 1.82, rearRoof: 1.82, floor: 0.38, wheelY: 1.22, wheelDz: 0.5, tilt: 0.32, pedalDz: 0.62, rowHipY: 0.92 }),
  // Hiace: cab-over, driver almost on the front axle, wheel nearly flat. Two rear rows.
  hiace: cabin({ hipX: 0.42, hipY: 1.06, hipZ: 1.28, rearGap: 0, roof: 1.8, floor: 0.54, wheelY: 1.26, wheelDz: 0.56, tilt: 0.85, pedalDz: 0.5, rows: [1.28, 0.3, -0.62], rowHipY: 1.04 }),
};

// ---- two and three wheelers: procedural bodies, so the numbers come from the geometry in cars.ts and vehicles3d.ts
// Okada: seat top about 0.8 m above ground, handlebar 1.08 m, pegs 0.32 m.
SEATS.okada = {
  seats: [
    { hip: [0, 0.9, -0.12], pose: 'ride', feet: [[0.24, 0.34, -0.02], [-0.24, 0.34, -0.02]], hands: [[0.37, 1.08, 0.5], [-0.37, 1.08, 0.5]], lean: 0.32, roof: 9 },
    { hip: [0, 0.92, -0.62], pose: 'pillion', feet: [[0.26, 0.36, -0.5], [-0.26, 0.36, -0.5]], hands: [[0.2, 0.98, -0.34], [-0.2, 0.98, -0.34]], lean: 0.12, roof: 9 },
  ],
};
// Keke: driver on a single seat behind the cowl, three across the bench, canvas roof at 1.65.
SEATS.keke = {
  seats: [
    { hip: [0, 0.98, 0.5], pose: 'ride', feet: [[0.14, 0.52, 0.86], [-0.14, 0.52, 0.86]], hands: [[0.3, 1.2, 0.82], [-0.3, 1.2, 0.82]], lean: 0.1, roof: 1.62 },
    { hip: [0.4, 0.92, -0.4], pose: 'sit', feet: [[0.5, 0.5, 0.05], [0.3, 0.5, 0.05]], hands: null, lean: 0, roof: 1.62 },
    { hip: [0, 0.92, -0.4], pose: 'sit', feet: [[0.1, 0.5, 0.05], [-0.1, 0.5, 0.05]], hands: null, lean: 0, roof: 1.62 },
    { hip: [-0.4, 0.92, -0.4], pose: 'sit', feet: [[-0.3, 0.5, 0.05], [-0.5, 0.5, 0.05]], hands: null, lean: 0, roof: 1.62 },
  ],
};

const FALLBACK: Record<string, string> = { sedan: 'camry', hatch: 'golf', jeep: 'rrsport', suv: 'rrsport', police: 'gclass', danfo: 'hiace' };
export function seatsFor(key: string, kind: string): CarSeats | undefined { return SEATS[key] ?? SEATS[FALLBACK[kind] ?? kind]; }
