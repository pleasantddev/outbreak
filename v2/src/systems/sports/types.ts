// Shared shapes for the match sims (football.ts, basketball.ts) and the match screen (match.ts).
export type Btn = 'pass' | 'thru' | 'shoot' | 'tackle' | 'switch';
/** one controller's input for a sim step: move direction in pitch space (x along the pitch, z across), held and pressed buttons */
export interface PadIn { mx: number; mz: number; sprint: boolean; hold: Partial<Record<Btn, boolean>>; press: Partial<Record<Btn, boolean>>; release: Partial<Record<Btn, boolean>> }
export const emptyPad = (): PadIn => ({ mx: 0, mz: 0, sprint: false, hold: {}, press: {}, release: {} });
export interface SimPlayer {
  x: number; z: number; vx: number; vz: number; face: number; team: 0 | 1;
  /** animation for the renderer: idle/jog/sprint/jump, or a clip name with `clip` */
  anim: string; clip?: string; y?: number;
  /** account id of the human in control, 'me' offline, or null for AI */
  human: string | null; name: string; num: number;
}
export interface SportSim {
  sport: 'football' | 'basketball';
  players: SimPlayer[]; ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
  score: [number, number]; clock: number; over: boolean; banner: string; bannerT: number;
  /** pitch size, for the renderer */ L: number; W: number;
  /** the player index each controller drives */ control: Map<string, number>;
  step(dt: number, pads: Map<string, PadIn>): void;
  /** shot meter (0..1) and its sweet spot for a controller, while charging */
  meter(who: string): { v: number; good: [number, number] } | null;
  snap(): unknown; apply(s: unknown): void;
  /** short text events for the commentary line */
  events: string[];
}
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
export const r1 = (n: number) => Math.round(n * 100) / 100;
