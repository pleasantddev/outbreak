// Shared types for the mission runtime.
import type { Actor, Vehicle } from '../sim/types';
import type { MarkerKind } from './missionsUi';
import type { Fx, MissionDef, StepDef, EventDef } from '../content/schema';
import type { MissionsSystem } from './missions';

export interface Pt { x: number; z: number; r: number; name: string }
export interface Goal extends Pt { kind: MarkerKind; /** drawn as a small marker and radar dot only */ minor?: boolean }
export interface Npc { key: string; name: string; x: number; z: number; look: 'ped' | 'area' | 'police' | 'vendor'; actor: Actor | null; faceMe: boolean }
export type RunDef = Pick<MissionDef, 'id' | 'title' | 'steps' | 'start' | 'rewards'> & { penalty?: Fx; fail?: MissionDef['fail']; minutes?: number };

export interface Run {
  kind: 'mission' | 'event';
  def: RunDef; src: MissionDef | EventDef;
  idx: number; step: StepDef; t: number; st: number;
  items: Set<string>; flags: Set<string>;
  /** scratch space for the current step; wiped on every step change */
  s: any;
  text: string;
  goal: Goal | null; extra: Goal[];
  npcs: Map<string, Npc>; actors: Actor[]; vehicles: Vehicle[];
  /** seconds left on the mission wide timer, if it has one */
  timer: number | null;
  earned: number;
  ended: boolean;
}

/** What a step executor returns from tick: nothing to carry on, 'next' for the default next step, a step id, or 'fail' / 'win'. */
export type StepResult = void | 'next' | 'fail' | 'win' | string;
export interface Exec<T extends StepDef = StepDef> {
  enter?(M: MissionsSystem, r: Run, st: T): void;
  tick(M: MissionsSystem, r: Run, st: T, dt: number): StepResult;
  leave?(M: MissionsSystem, r: Run, st: T): void;
}
