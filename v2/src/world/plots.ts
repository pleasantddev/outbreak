// Plots: one purchasable parcel per real property (see pipe/parcels.py). A built parcel carries its compound walls and
// gate where it meets the street; vacant parcels are Lagos standard plots, 18 m frontage by 36 m depth.
import { polyArea } from './geo';
import { type Building, type Region } from './region';

export interface Plot {
  id: string; pts: number[]; cx: number; cz: number; area: number;
  buildings: Building[]; zone: 'residential' | 'commercial' | 'industrial' | 'vacant' | 'institution' | 'unfinished';
  rich: number; // 0 poor .. 1 rich (drives walls, gates, compound paving and price)
  name?: string | null; // e.g. a market, school or terminal that owns the whole parcel
}

const ZONES: Plot['zone'][] = ['vacant', 'residential', 'commercial', 'industrial', 'institution', 'unfinished'];

/** Parcels are built offline from the OSM footprints (pipe/parcels.py): one parcel per real property, a built
 *  parcel holds its whole compound, and only land with no building is cut into vacant 18 x 36 m plots. */
export function plotsForRegion(r: Region, bldById?: Map<number, Building>, miss?: { n: number }): Plot[] {
  const local = new Map<number, Building>(); for (const b of r.buildings) local.set(b.id, b);
  const out: Plot[] = [];
  for (const pc of r.parcels) {
    const n = pc.pts.length / 2; if (n < 3) continue;
    const pts = Array.from(pc.pts);
    let cx = 0, cz = 0; for (let k = 0; k < n; k++) { cx += pts[k * 2]; cz += pts[k * 2 + 1]; } cx /= n; cz /= n;
    const area = Math.abs(polyArea(pts));
    const buildings: Building[] = [];
    for (const id of pc.bids) { const b = local.get(id) ?? bldById?.get(id); if (b) buildings.push(b); else if (miss) miss.n++; }
    out.push({ id: pc.id, pts, cx, cz, area, buildings, zone: ZONES[pc.zone] ?? 'residential', rich: pc.rich, name: pc.name });
  }
  return out;
}

/** Asking price in naira. Ikeja side and the expressway frontage cost more; Sango side less. */
export function plotPrice(pl: Plot, worldX: number, worldZ: number) {
  const distOshodi = Math.hypot(worldX, worldZ) / 1000; // km from the origin at Oshodi
  const base = 26_000_000 * Math.exp(-distOshodi / 14) + 4_500_000;
  const size = pl.area / 648;
  const built = pl.zone === 'vacant' ? 1 : pl.zone === 'unfinished' ? 1.35 : 2.2 + pl.rich * 2.5;
  return Math.round((base * size * built) / 50_000) * 50_000;
}
