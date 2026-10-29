// Register systems here, one line each. Order = init/update order.
import type { GameSystem } from './registry';
import { garage } from './garage';
import { identity } from './identity';
export const SYSTEMS: GameSystem[] = [
  garage, identity,
];
