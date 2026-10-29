// Register systems here, one line each. Order = init/update order.
import type { GameSystem } from './registry';
import { netSystem } from './net';
// net goes first: it signs the player in during init, before the lobby and before other systems read their saved state
export const SYSTEMS: GameSystem[] = [
  netSystem,
];
