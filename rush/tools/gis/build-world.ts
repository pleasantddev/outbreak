// Turns the raw OSM extract into the game world database (public/world/oshodi.json) and builds the race tracks
// (public/world/tracks.json) by routing over the real road graph.
// The output world file is a Derivative Database of OpenStreetMap: (c) OpenStreetMap contributors, ODbL 1.0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { project, polygonArea, distSegment2, type Projection } from '../../src/shared/math';
import type { WorldData, WorldRoad, WorldBuilding, WorldArea, WorldRail, WorldFootbridge, WorldPoint, WorldTerminal, RoadClass, BuildingCat, GraphNode, GraphEdge } from '../../src/shared/world';
import { ROAD_WIDTH } from '../../src/shared/world';
import { buildTrack } from '../../src/shared/trackBuild';
import { TRACK_DEFS } from '../../src/shared/trackDefs';
import { hash01 } from '../../src/shared/rng';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/osm/oshodi.raw.json'), 'utf8'));
const prov = JSON.parse(fs.readFileSync(path.join(root, 'data/osm/provenance.json'), 'utf8'));

// The Oshodi Interchange motorway junction (OSM node 1475182754) is the world origin.
export const PROJ: Projection = { lat0: 6.5560, lon0: 3.3510 };
const r1 = (v: number) => Math.round(v * 10) / 10;

interface OsmWay { type: 'way'; id: number; nodes: number[]; geometry: { lat: number; lon: number }[]; tags: Record<string, string> }
interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
const ways: OsmWay[] = raw.elements.filter((e: any) => e.type === 'way' && e.geometry && e.nodes);
const nodesTagged: OsmNode[] = raw.elements.filter((e: any) => e.type === 'node');

const CLASS: Record<string, RoadClass> = {
  motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', unclassified: 'tertiary',
  residential: 'residential', living_street: 'residential', service: 'service', motorway_link: 'link', trunk_link: 'link', primary_link: 'link', secondary_link: 'link', tertiary_link: 'link',
};

// ---------------------------------------------------------------- roads and graph
const roads: WorldRoad[] = [];
const footbridges: WorldFootbridge[] = [];
const nodeUse = new Map<number, number>();
const nodePos = new Map<number, { x: number; z: number }>();
for (const w of ways) {
  const hw = w.tags.highway;
  if (!hw) continue;
  if (['footway', 'steps', 'path', 'pedestrian', 'platform', 'cycleway'].includes(hw)) {
    if (w.tags.bridge) footbridges.push({ id: w.id, name: w.tags.name, layer: +(w.tags.layer ?? 1), pts: w.geometry.map((g) => { const p = project(PROJ, g.lat, g.lon); return [r1(p.x), r1(p.z)]; }) });
    continue;
  }
  const cls = CLASS[hw];
  if (!cls) continue;
  w.nodes.forEach((id, i) => { nodeUse.set(id, (nodeUse.get(id) ?? 0) + 1); const p = project(PROJ, w.geometry[i].lat, w.geometry[i].lon); nodePos.set(id, p); });
}
for (const w of ways) {
  const cls = CLASS[w.tags.highway ?? ''];
  if (!cls) continue;
  const lanes = +(w.tags.lanes ?? 0) || (cls === 'motorway' ? 3 : cls === 'trunk' ? 2 : cls === 'link' ? 1 : 2);
  const oneway = w.tags.oneway === 'yes' || cls === 'motorway' || (cls === 'link' && w.tags.oneway !== 'no');
  const width = Math.max(ROAD_WIDTH[cls] * (cls === 'motorway' ? 0.75 : 1), lanes * 3.4 + (oneway ? 1 : 1.5));
  roads.push({
    id: w.id, name: w.tags.name ?? w.tags.ref ?? '', cls, w: r1(width), lanes, oneway,
    bridge: !!w.tags.bridge && w.tags.bridge !== 'no', layer: +(w.tags.layer ?? 0),
    pts: w.nodes.map((id) => { const p = nodePos.get(id)!; return [r1(p.x), r1(p.z), 0]; }),
    nodes: w.nodes,
  });
}

// graph: OSM nodes used by more than one road (or road ends) become graph nodes
const gNodes = new Map<number, GraphNode>();
const gEdges: GraphEdge[] = [];
const ensureNode = (osm: number) => { let n = gNodes.get(osm); if (!n) { const p = nodePos.get(osm)!; n = { id: osm, x: r1(p.x), z: r1(p.z), y: 0, edges: [] }; gNodes.set(osm, n); } return n; };
for (const r of roads) {
  let start = 0;
  for (let i = 1; i < r.nodes.length; i++) {
    const isJoint = i === r.nodes.length - 1 || (nodeUse.get(r.nodes[i]) ?? 0) > 1;
    if (!isJoint) continue;
    const a = ensureNode(r.nodes[start]), b = ensureNode(r.nodes[i]);
    const pts = r.pts.slice(start, i + 1).map((p) => [p[0], p[1]]);
    let len = 0; for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    const e: GraphEdge = { id: gEdges.length, a: a.id, b: b.id, road: r.id, len: r1(len), cls: r.cls, oneway: r.oneway, bridge: r.bridge, pts };
    gEdges.push(e); a.edges.push(e.id); b.edges.push(e.id);
    start = i;
  }
}

// elevation: bridges sit at 6.5 m per layer, and the height eases down along connected roads at a 6% grade
const BRIDGE_H = 6.5, GRADE = 0.065;
const elev = new Map<number, number>();
for (const r of roads) if (r.bridge) for (const id of r.nodes) elev.set(id, Math.max(elev.get(id) ?? 0, BRIDGE_H * Math.max(1, r.layer)));
// propagate along OSM node chains (not just graph joints) so approach ramps are smooth
const adj = new Map<number, { to: number; d: number }[]>();
for (const r of roads) for (let i = 1; i < r.nodes.length; i++) {
  const a = r.nodes[i - 1], b = r.nodes[i];
  const pa = nodePos.get(a)!, pb = nodePos.get(b)!;
  const d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
  (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, d });
  (adj.get(b) ?? adj.set(b, []).get(b)!).push({ to: a, d });
}
const queue = [...elev.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
while (queue.length) {
  const id = queue.shift()!;
  const h = elev.get(id)!;
  for (const { to, d } of adj.get(id) ?? []) {
    const nh = h - d * GRADE;
    if (nh > (elev.get(to) ?? 0) + 0.01 && nh > 0) { elev.set(to, nh); queue.push(to); }
  }
}
// Heights along a polyline. OSM nodes are sparse on straight roads, so a ramp that starts at an elevated node is
// drawn at the real grade (densified every few metres) rather than as one long gentle slope to the next node.
// Bridge decks, and short spans between two elevated nodes, stay level.
function heightsAlong(pts: number[][], ids: number[], bridge: boolean): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const hb = elev.get(ids[i]) ?? 0;
    if (i > 0) {
      const a = pts[i - 1], b = pts[i], ha = elev.get(ids[i - 1]) ?? 0;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const level = bridge || (ha > 1 && hb > 1 && L < 120);
      if (!level && (ha > 0.05 || hb > 0.05) && L > 8) {
        const m = Math.ceil(L / 6);
        for (let k = 1; k < m; k++) {
          const t = (k / m) * L;
          out.push([r1(a[0] + ((b[0] - a[0]) * k) / m), r1(a[1] + ((b[1] - a[1]) * k) / m), r1(Math.max(0, ha - t * GRADE, hb - (L - t) * GRADE))]);
        }
      }
    }
    out.push([pts[i][0], pts[i][1], r1(hb)]);
  }
  return out;
}
for (const n of gNodes.values()) n.y = r1(elev.get(n.id) ?? 0);
for (const e of gEdges) {
  const road = roads.find((r) => r.id === e.road)!;
  const ia = road.nodes.indexOf(e.a);
  const ids = road.nodes.slice(ia, ia + e.pts.length);
  e.pts = heightsAlong(e.pts, ids, e.bridge);
}
for (const r of roads) r.pts = heightsAlong(r.pts, r.nodes, r.bridge);

// ---------------------------------------------------------------- buildings
const majorRoadSegs: number[][][] = roads.filter((r) => ['motorway', 'trunk', 'primary', 'secondary'].includes(r.cls)).map((r) => r.pts);
function nearMajor(x: number, z: number, maxD: number) {
  for (const pts of majorRoadSegs) for (let i = 1; i < pts.length; i++) { const d = distSegment2(x, z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); if (d.d2 < maxD * maxD) return true; }
  return false;
}
const buildings: WorldBuilding[] = [];
const terminals: WorldTerminal[] = [];
for (const w of ways) {
  if (!w.tags.building && !w.tags['building:part']) continue;
  let pts = w.geometry.map((g) => { const p = project(PROJ, g.lat, g.lon); return [r1(p.x), r1(p.z)]; });
  if (pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
  if (pts.length < 3) continue;
  // drop collinear points
  pts = pts.filter((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
    return Math.abs(cross) > 0.2;
  });
  if (pts.length < 3) continue;
  const area = Math.abs(polygonArea(pts));
  if (area < 14) continue;
  if (polygonArea(pts) < 0) pts.reverse(); // counter-clockwise in x,z for consistent walls
  const name = w.tags.name;
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  if (name && /Terminal/.test(name)) {
    terminals.push({ osmId: w.id, name: name.replace('Oshodi Transport Interchange - ', ''), pts, centre: [r1(cx), r1(cz)] });
    continue;
  }
  const t = w.tags.building;
  let cat: BuildingCat = 'residential';
  if (t === 'industrial' || t === 'warehouse' || area > 1800) cat = area > 1800 ? 'shed' : 'industrial';
  else if (t === 'church' || t === 'mosque') cat = 'religious';
  else if (t === 'school') cat = 'school';
  else if (t === 'construction') cat = 'other';
  else if (nearMajor(cx, cz, 30)) cat = area > 500 ? 'commercial' : 'retail';
  else if (area > 700) cat = 'office';
  const rnd = hash01(w.id);
  const levels = w.tags['building:levels'] ? +w.tags['building:levels'] : cat === 'shed' ? 1 : cat === 'industrial' ? 2 : cat === 'commercial' ? 2 + Math.floor(rnd * 4) : cat === 'office' ? 3 + Math.floor(rnd * 4) : cat === 'retail' ? 1 + Math.floor(rnd * 3) : 1 + Math.floor(rnd * 3.2);
  const h = w.tags.height ? +w.tags.height : cat === 'shed' ? 7 + rnd * 5 : levels * 3.2 + 0.6;
  buildings.push({ id: w.id, cat, h: r1(h), levels, name, pts });
}

// ---------------------------------------------------------------- areas, rails, points
const AREA_KIND: Record<string, WorldArea['kind']> = { residential: 'residential', industrial: 'industrial', retail: 'commercial', commercial: 'commercial', military: 'grass', farmyard: 'grass', cemetery: 'grass', farmland: 'grass', construction: 'sand', grass: 'grass' };
const areas: WorldArea[] = [];
for (const w of ways) {
  const k = w.tags.landuse ? AREA_KIND[w.tags.landuse] : w.tags.leisure ? 'grass' : w.tags.amenity === 'marketplace' ? 'market' : w.tags.amenity === 'parking' ? 'parking' : w.tags.natural === 'water' ? 'water' : null;
  if (!k) continue;
  const pts = w.geometry.map((g) => { const p = project(PROJ, g.lat, g.lon); return [r1(p.x), r1(p.z)]; });
  if (pts.length >= 3) areas.push({ kind: k, pts });
}
const rails: WorldRail[] = ways.filter((w) => w.tags.railway === 'rail').map((w) => ({ id: w.id, bridge: !!w.tags.bridge, layer: +(w.tags.layer ?? 0), pts: w.geometry.map((g) => { const p = project(PROJ, g.lat, g.lon); return [r1(p.x), r1(p.z)]; }) }));
const points: WorldPoint[] = [];
for (const n of nodesTagged) {
  const t = n.tags ?? {};
  const p = project(PROJ, n.lat, n.lon);
  const kind: WorldPoint['kind'] | null = t.highway === 'traffic_signals' ? 'signals' : t.highway === 'bus_stop' ? 'bus_stop' : t.amenity === 'fuel' ? 'fuel' : t.amenity === 'marketplace' ? 'market' : t.amenity === 'place_of_worship' ? 'worship' : t.amenity === 'school' ? 'school' : t.amenity === 'bank' ? 'bank' : t.amenity ? 'other' : null;
  if (kind) points.push({ kind, name: t.name, x: r1(p.x), z: r1(p.z) });
}
for (const w of ways) if (w.tags.amenity && ['fuel', 'bank', 'school', 'place_of_worship', 'marketplace'].includes(w.tags.amenity)) {
  const g = w.geometry; const lat = g.reduce((a, q) => a + q.lat, 0) / g.length, lon = g.reduce((a, q) => a + q.lon, 0) / g.length; const p = project(PROJ, lat, lon);
  points.push({ kind: w.tags.amenity === 'place_of_worship' ? 'worship' : w.tags.amenity === 'marketplace' ? 'market' : (w.tags.amenity as any), name: w.tags.name, x: r1(p.x), z: r1(p.z) });
}

// the published world covers the extract box plus a margin; long ways like Agege Motor Road run on for kilometres
const box = (() => { const a = project(PROJ, prov.area.north, prov.area.west), b = project(PROJ, prov.area.south, prov.area.east); return { minX: r1(a.x), maxX: r1(b.x), minZ: r1(a.z), maxZ: r1(b.z) }; })();
const M = 150;
const inBox = (p: number[]) => p[0] > box.minX - M && p[0] < box.maxX + M && p[1] > box.minZ - M && p[1] < box.maxZ + M;
const clippedRoads: WorldRoad[] = [];
for (const r of roads) {
  let run: number[][] = [];
  const flush = () => { if (run.length > 1) clippedRoads.push({ ...r, pts: run, nodes: [] }); run = []; };
  r.pts.forEach((p, i) => {
    const keep = inBox(p) || (i > 0 && inBox(r.pts[i - 1])) || (i < r.pts.length - 1 && inBox(r.pts[i + 1]));
    if (keep) run.push(p); else flush();
  });
  flush();
}
const { minX, maxX, minZ, maxZ } = box;

const world: WorldData = {
  meta: {
    name: 'Oshodi, Lagos', centre: { lat: PROJ.lat0, lon: PROJ.lon0 }, bounds: { minX, maxX, minZ, maxZ },
    source: 'OpenStreetMap (Overpass API extract)', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors',
    acquired: prov.acquired, osmBase: prov.osmBaseTimestamp, generated: new Date().toISOString(),
  },
  roads, buildings, areas, rails, footbridges, points, terminals,
  graph: { nodes: [...gNodes.values()], edges: gEdges },
};
// tracks are routed on the full graph; the client only needs what it draws
const published: WorldData = { ...world, roads: clippedRoads.map(({ nodes, ...r }) => ({ ...r, nodes: [] })), graph: { nodes: [], edges: [] } };

fs.mkdirSync(path.join(root, 'public/world'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/world/oshodi.json'), JSON.stringify(published));
console.log(`world: ${clippedRoads.length} road pieces, ${buildings.length} buildings, ${terminals.length} terminals, ${footbridges.length} footbridges, ${rails.length} rails, ${areas.length} areas, ${points.length} points, graph ${gNodes.size} nodes / ${gEdges.length} edges`);

// ---------------------------------------------------------------- tracks
const tracks = [];
for (const def of TRACK_DEFS) {
  const t = buildTrack(world, def);
  tracks.push(t.data);
  console.log(`track ${def.id}: ${Math.round(t.data.length)} m, ${t.data.paths.length} paths, ${t.data.ramps.length} ramps, ${t.data.pickups.length} pickup rows, warnings: ${t.warnings.join('; ') || 'none'}`);
}
fs.writeFileSync(path.join(root, 'public/world/tracks.json'), JSON.stringify(tracks));

// provenance for the derivative database
const provOut = {
  ...prov,
  derivedFiles: ['public/world/oshodi.json', 'public/world/tracks.json'],
  processing: [
    'Projected WGS84 to local metres (equirectangular, origin at the Oshodi Interchange, OSM node 1475182754).',
    'Classified highways into game road classes; widths from lanes where tagged.',
    'Built a road graph from shared OSM nodes; assigned bridge heights of 6.5 m per layer and eased approaches at a 6.5% grade.',
    'Simplified building footprints, dropped footprints under 14 m², assigned categories and heights from tags, size and proximity to major roads.',
    'Extracted the three Oshodi Transport Interchange terminal footprints for hand-authored landmark treatment.',
    'Routed race tracks over the road graph between designer anchors, then smoothed, widened and decorated them for gameplay.',
  ],
  generated: new Date().toISOString(),
};
fs.writeFileSync(path.join(root, 'public/world/PROVENANCE.json'), JSON.stringify(provOut, null, 2));
