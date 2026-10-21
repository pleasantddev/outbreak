// Road cross sections for Lagos: carriageway width, kerb, walkway and the open drain.
import { ROAD, RF, type Road } from './region';

export const LANE = 3.3;
export function lanesOf(r: Road) {
  if (r.lanes > 0) return Math.min(8, r.lanes);
  const one = r.flags & RF.oneway;
  switch (r.cls) {
    case ROAD.motorway: return one ? 3 : 6;
    case ROAD.trunk: return one ? 3 : 4;
    case ROAD.primary: return one ? 2 : 4;
    case ROAD.secondary: return one ? 2 : 2;
    case ROAD.tertiary: return 2;
    case ROAD.motorwayLink: case ROAD.link: return 1;
    case ROAD.busway: return 1;
    case ROAD.unclassified: return 2;
    default: return 1;
  }
}
export function halfWidth(r: Road) {
  if (r.width > 0) return Math.max(1.2, Math.min(30, r.width / 2));
  switch (r.cls) {
    case ROAD.residential: return r.flags & RF.unpaved ? 2.6 : 2.9;
    case ROAD.service: return 1.9;
    case ROAD.track: return 1.7;
    case ROAD.foot: return 0.9;
    case ROAD.steps: return 0.9;
    case ROAD.construction: return 3.2;
    case ROAD.busway: return 2.0;
  }
  return Math.max(2.8, (lanesOf(r) * LANE) / 2 + (r.cls <= ROAD.trunk ? 0.6 : 0.2));
}
/** Width of everything beside the carriageway that the road owns: kerb, walkway, drain. */
export function verge(r: Road) {
  if (r.cls <= ROAD.secondary || r.cls === ROAD.link || r.cls === ROAD.motorwayLink) return 4.6;
  if (r.cls === ROAD.tertiary || r.cls === ROAD.unclassified) return 2.4;
  if (r.cls === ROAD.residential) return 1.2;
  return 0.6;
}
export const isMajor = (c: number) => c <= ROAD.secondary || c === ROAD.link || c === ROAD.motorwayLink;
export const drivable = (c: number) => c <= ROAD.track && c !== ROAD.busway || c === ROAD.construction;
