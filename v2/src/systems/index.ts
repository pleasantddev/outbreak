// Register systems here, one line each. Order = init/update order.
import type { GameSystem } from './registry';
import { societySystem } from './society';
import { nemesisSystem } from './nemesis';
export const SYSTEMS: GameSystem[] = [
  societySystem, nemesisSystem,
];
