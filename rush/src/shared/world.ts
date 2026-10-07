// The game world database produced by tools/gis/build-world.ts from OpenStreetMap.
// public/world/oshodi.json is a Derivative Database of OSM: (c) OpenStreetMap contributors, ODbL 1.0.

export type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'service' | 'path' | 'link';

export interface WorldRoad {
  id: number; name: string; cls: RoadClass; w: number; lanes: number; oneway: boolean;
  bridge: boolean; layer: number; pts: number[][]; // [x, z, y] local metres
  nodes: number[]; // graph node ids, one per point
}
export type BuildingCat = 'commercial' | 'residential' | 'industrial' | 'religious' | 'school' | 'retail' | 'office' | 'civic' | 'terminal' | 'shed' | 'other';
export interface WorldBuilding { id: number; cat: BuildingCat; h: number; levels: number; name?: string; pts: number[][]; minH?: number }
export interface WorldArea { kind: 'grass' | 'sand' | 'water' | 'market' | 'parking' | 'industrial' | 'residential' | 'commercial' | 'rail'; pts: number[][] }
export interface WorldRail { id: number; bridge: boolean; layer: number; pts: number[][] }
export interface WorldFootbridge { id: number; name?: string; layer: number; pts: number[][] }
export interface WorldPoint { kind: 'signals' | 'bus_stop' | 'fuel' | 'market' | 'worship' | 'school' | 'bank' | 'other'; name?: string; x: number; z: number }
export interface WorldTerminal { osmId: number; name: string; pts: number[][]; centre: [number, number] }

export interface GraphNode { id: number; x: number; z: number; y: number; edges: number[] }
export interface GraphEdge { id: number; a: number; b: number; road: number; len: number; cls: RoadClass; oneway: boolean; bridge: boolean; pts: number[][] }

export interface WorldMeta {
  name: string; centre: { lat: number; lon: number }; bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  source: string; license: string; attribution: string; acquired: string; osmBase: string | null; generated: string;
}

export interface WorldData {
  meta: WorldMeta;
  roads: WorldRoad[];
  buildings: WorldBuilding[];
  areas: WorldArea[];
  rails: WorldRail[];
  footbridges: WorldFootbridge[];
  points: WorldPoint[];
  terminals: WorldTerminal[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

export const ROAD_WIDTH: Record<RoadClass, number> = { motorway: 22, trunk: 18, primary: 14, secondary: 11, tertiary: 9, residential: 7, service: 5, path: 3, link: 8 };
export const ROAD_COST: Record<RoadClass, number> = { motorway: 0.75, trunk: 0.8, primary: 0.85, secondary: 0.95, tertiary: 1.05, residential: 1.5, service: 3, path: 50, link: 1.0 };
