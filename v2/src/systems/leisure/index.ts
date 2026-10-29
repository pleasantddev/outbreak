// Leisure venues: the casino and the club. They register with the life system as interiors with street doors.
import type { GameSystem } from '../registry';
import { lifeSystem } from '../life';
import { Casino } from './casino';
import { Club } from './club';
import { Joint } from './joint';

let casino: Casino | null = null; let club: Club | null = null; let joint: Joint | null = null;
export const leisureSystem: GameSystem = {
  id: 'leisure',
  init(ctx) {
    const life = lifeSystem.api; if (!life) return;
    casino = new Casino(ctx, life as any); club = new Club(ctx, life as any);
    joint = new Joint(ctx, life as any); joint.init();
    life.addVenue(casino.venue); life.addVenue(club.venue); life.addVenue(joint.venue);
    (window as any).__leisure = { casino, club, joint };
  },
};
