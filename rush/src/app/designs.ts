// Routes drawn in the race designer, kept in this browser. The game builds them on boot with the same code as the
// official routes and races them offline. Rooms only ever use the routes the server ships, so a design never
// reaches another player's race.
import { buildTrack, type TrackDef } from '../shared/trackBuild';
import type { WorldData } from '../shared/world';
import type { TrackData } from '../shared/track';

const KEY = 'rush.designs';
const MAX = 40;

/** Designs race under their own id space so they can never shadow an official route. */
export const designTrackId = (id: string) => `design-${id}`;
export const designIdOf = (trackId: string) => (trackId.startsWith('design-') ? trackId.slice(7) : null);

const xz = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 20000);
const list = (v: unknown, max: number, ok: (x: unknown) => boolean) => v === undefined || (Array.isArray(v) && v.length <= max && v.every(ok));
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Shape check for a design read from storage or pasted in: anything odd is refused rather than half used. */
export function validDesign(d: unknown): d is TrackDef {
  if (!obj(d)) return false;
  if (typeof d.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(d.id)) return false;
  if (typeof d.name !== 'string' || d.name.length > 60) return false;
  if (!xz(d.start) || !list(d.route, 64, xz) || (d.route as unknown[]).length < 2) return false;
  if (typeof d.laps !== 'number' || d.laps < 1 || d.laps > 9) return false;
  return list(d.links, 16, (l) => obj(l) && xz(l.a) && xz(l.b) && list(l.via, 12, xz))
    && list(d.ramps, 24, (r) => obj(r) && xz(r.at))
    && list(d.pickups, 16, xz)
    && list(d.boosts, 16, (b) => obj(b) && xz(b.at))
    && list(d.hazards, 32, (h) => obj(h) && xz(h.at) && (h.kind === undefined || h.kind === 'pothole' || h.kind === 'purewater'))
    && list(d.checkpoints, 32, xz)
    && list(d.noTraffic, 12, (p) => Array.isArray(p) && p.length === 2 && xz(p[0]) && xz(p[1]))
    && list(d.shortcuts, 6, (s) => obj(s) && typeof s.name === 'string' && list(s.route, 24, xz))
    && list(d.avoid, 64, (n) => typeof n === 'number');
}

export function loadDesigns(): TrackDef[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(validDesign) : [];
  } catch { return []; }
}
export function saveDesign(def: TrackDef) { write([def, ...loadDesigns().filter((d) => d.id !== def.id)]); }
export function deleteDesign(id: string) { write(loadDesigns().filter((d) => d.id !== id)); }
function write(all: TrackDef[]) {
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX))); } catch { /* storage full or blocked: the design stays in the open tab */ }
}

let graph: Promise<WorldData['graph']> | null = null;
/** The road graph routes are planned on. Only fetched when someone designs or races a design. */
export function loadGraph(base = '') {
  graph ??= fetch(`${base}world/graph.json`).then((r) => { if (!r.ok) throw new Error(`road graph: HTTP ${r.status}`); return r.json(); });
  return graph;
}

/** Build every saved design for racing. One that no longer builds (a bad import, say) is skipped and named. */
export async function buildDesigns(world: WorldData): Promise<TrackData[]> {
  const defs = loadDesigns();
  if (!defs.length) return [];
  const full: WorldData = { ...world, graph: await loadGraph() };
  const out: TrackData[] = [];
  for (const def of defs) {
    try {
      const { data } = buildTrack(full, { ...def, id: designTrackId(def.id), reverse: false });
      data.custom = true;
      out.push(data);
    } catch (e) { console.warn(`design ${def.id} does not build: ${(e as Error).message}`); }
  }
  return out;
}
