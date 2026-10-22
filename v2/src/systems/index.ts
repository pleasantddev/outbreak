// Register systems here, one line each. Order = init/update order.
import type { GameSystem } from './registry';
import { skills } from './skills';
import { missions } from './missions';
export const SYSTEMS: GameSystem[] = [
  skills, // perks and skill levels: other systems read ctx.systems.get('skills').stat('...')
  missions, // missions, events, routes: content/missions.json etc.
];
