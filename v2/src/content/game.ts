// The mission-side content bundle: places, missions, events, routes, skills. Loaded once, resolved against the map.
import { loadContent } from './load';
import type { EventDef, MissionDef, PlaceDef, PlaceRef, RouteDef, SkillDef } from './schema';

export interface GameContent {
  places: Map<string, PlaceDef>; missions: MissionDef[]; events: EventDef[]; routes: RouteDef[]; skills: SkillDef[];
  mission: Map<string, MissionDef>; event: Map<string, EventDef>; route: Map<string, RouteDef>; skill: Map<string, SkillDef>;
}
export interface Resolved { x: number; z: number; r: number; name: string }
export type Projector = (lat: number, lon: number) => { x: number; z: number };

export function indexContent(places: PlaceDef[], missions: MissionDef[], events: EventDef[], routes: RouteDef[], skills: SkillDef[]): GameContent {
  return {
    places: new Map(places.map((p) => [p.id, p])), missions, events, routes, skills,
    mission: new Map(missions.map((m) => [m.id, m])), event: new Map(events.map((m) => [m.id, m])),
    route: new Map(routes.map((m) => [m.id, m])), skill: new Map(skills.map((m) => [m.id, m])),
  };
}
let cached: Promise<GameContent> | null = null;
/** Loaded once per page; both the skills and the missions system call it. */
export function loadGameContent(): Promise<GameContent> { return (cached ??= loadAll()); }
export function reloadGameContent(): Promise<GameContent> { cached = null; return loadGameContent(); }
async function loadAll(): Promise<GameContent> {
  const [p, m, e, r, s] = await Promise.all([loadContent<PlaceDef>('places'), loadContent<MissionDef>('missions'), loadContent<EventDef>('events'), loadContent<RouteDef>('routes'), loadContent<SkillDef>('skills')]);
  return indexContent(p, m, e, r, s);
}
/** Resolve a place id or inline coordinates to world metres. */
export function resolvePlace(c: GameContent, ref: PlaceRef | undefined, project: Projector, fallbackR = 16): Resolved | null {
  if (ref === undefined) return null;
  if (typeof ref === 'string') { const p = c.places.get(ref); if (!p) return null; const w = project(p.lat, p.lon); return { x: w.x, z: w.z, r: p.r ?? fallbackR, name: p.name }; }
  const w = project(ref.lat, ref.lon); return { x: w.x, z: w.z, r: ref.r ?? fallbackR, name: ref.name ?? 'Pin' };
}
/** The same projection RegionStore.project uses, for code that has the manifest origin but no store (tests, admin). */
export function projector(origin: { lat: number; lon: number }): Projector {
  const kx = Math.cos((origin.lat * Math.PI) / 180) * 111320, kz = 110574;
  return (lat, lon) => ({ x: (lon - origin.lon) * kx, z: -(lat - origin.lat) * kz });
}
