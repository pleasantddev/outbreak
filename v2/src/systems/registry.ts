// Plug-in point for game systems (NPC society, missions, multiplayer, registry, housing...).
// Each system lives in its own file and is added to SYSTEMS in ./index.ts. hustle.ts only calls these hooks.
import type * as THREE from 'three';
import type { LifeSim } from '../sim/life';
import type { LifeView } from '../render/lifeView';
import type { LifeHud } from '../ui/lifeHud';
import type { SimEvent } from '../sim/types';
import type { RegionStore } from '../world/region';

export interface GameCtx {
  sim: LifeSim; view: LifeView; hud: LifeHud; THREE: typeof THREE;
  /** persisted single-player save (localStorage 'hustlelife'); systems keep their own key inside it */
  save: Record<string, any>; persist: () => void;
  /** the player's profile (name, account id) */
  profile: { name: string; accountId: string } | null;
  /** start/abort the built-in job flow and query the active objective, if any */
  startJob?: (id: string) => void;
  /** other systems, by id, for cross-system calls */
  systems: Map<string, GameSystem>;
  /** the loaded map (project(lat, lon) gives world metres) */
  store?: RegionStore;
  /** ask the streamer for the regions between two points so the GPS can route across the city */
  loadRoute?: (x0: number, z0: number, x1: number, z1: number) => void;
  /** profile XP and level */
  grantXp?: (n: number) => void; playerLevel?: () => number;
}
export interface Blip { x: number; z: number; c: string; r?: number }
export interface GoalPoint { x: number; z: number; label?: string }

export interface GameSystem {
  id: string;
  /** once, after the world, sim, view and HUD exist (before the lobby) */
  init?(ctx: GameCtx): void | Promise<void>;
  /** once, when the player presses PLAY and spawns */
  start?(ctx: GameCtx): void;
  /** fixed 60 Hz, after sim.step */
  step?(ctx: GameCtx, dt: number): void;
  /** every rendered frame, after view.frame */
  frame?(ctx: GameCtx, dt: number): void;
  /** every sim event (shots, crimes, cash, vehicle events...) */
  onEvent?(ctx: GameCtx, e: SimEvent): void;
  /** phone app actions routed by app name */
  onAction?(ctx: GameCtx, app: string, id: string): boolean;
  /** the current GPS destination, if this system has one (first system that returns a point wins) */
  goal?(ctx: GameCtx): GoalPoint | null;
  /** extra blips on the minimap */
  blips?(ctx: GameCtx, out: Blip[]): void;
}
