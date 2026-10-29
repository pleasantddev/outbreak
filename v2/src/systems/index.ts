// Register systems here, one line each. Order = init/update order.
import type { GameSystem } from './registry';
import { netSystem } from './net';
import { societySystem } from './society';
import { nemesisSystem } from './nemesis';
import { garage } from './garage';
import { identity } from './identity';
import { skills } from './skills';
import { missions } from './missions';
// net goes first: it signs the player in during init, before the lobby and before other systems read their saved state
export const SYSTEMS: GameSystem[] = [
  netSystem,
  skills, // perks and skill levels: other systems read ctx.systems.get('skills').stat('...')
  societySystem, nemesisSystem,
  garage, identity,
  missions, // missions, events, routes: content/missions.json etc.
];
