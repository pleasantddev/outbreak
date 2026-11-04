// Map and radar icons, GTA style: a coloured round badge with a white glyph. One set for the full map (M), the radar
// in the corner, and anything else that points at a place. Glyphs are 24x24 SVG paths drawn with Path2D.
export type MapCat = 'hospital' | 'pharmacy' | 'police' | 'bank' | 'fuel' | 'food' | 'club' | 'shop' | 'market' | 'phones' | 'mechanic' | 'transport' | 'hotel' | 'sports' | 'landmark' | 'jobs' | 'home' | 'business';
export const CATS: Record<MapCat, { label: string; color: string; glyph: string; text?: string; radar: number }> = {
  hospital: { label: 'Hospitals and clinics', color: '#e5484d', glyph: 'M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z', radar: 380 },
  pharmacy: { label: 'Chemists', color: '#30a46c', glyph: 'M7.8 16.2a4 4 0 0 1 0-5.6l4.6-4.6a4 4 0 0 1 5.6 5.6l-4.6 4.6a4 4 0 0 1-5.6 0zm2.1-4.2l3.5 3.5', radar: 350 },
  police: { label: 'Police', color: '#3e63dd', glyph: 'M12 3l7.5 2.8v5.6c0 4.6-3.2 8.4-7.5 9.9-4.3-1.5-7.5-5.3-7.5-9.9V5.8z', radar: 600 },
  bank: { label: 'Banks and ATMs', color: '#12a594', glyph: '', text: '₦', radar: 350 },
  fuel: { label: 'Fuel', color: '#f76b15', glyph: 'M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20zM7 6.5v4h5v-4zM14 9h1.6l2.4 2.4V17a1.5 1.5 0 0 0 3 0v-7l-3-3', radar: 500 },
  food: { label: 'Food', color: '#f5a524', glyph: 'M7 3v7a2 2 0 0 0 1.5 1.9V21h2V11.9A2 2 0 0 0 12 10V3h-1.3v5.5h-.9V3H8.6v5.5h-.9V3zM16 3c-1.7 0-2.8 2.2-2.8 5.2 0 2.2.8 3.6 1.8 4.1V21h2V3z', radar: 300 },
  club: { label: 'Clubs and bars', color: '#d6409f', glyph: 'M9 17.5a2.5 2.5 0 1 1-2.5-2.5c.3 0 .6 0 1 .1V5l11-2v12.5a2.5 2.5 0 1 1-2.5-2.5c.3 0 .6 0 1 .1V7.4L9.5 8.7z', radar: 700 },
  shop: { label: 'Shops and malls', color: '#8e4ec6', glyph: 'M5 8h14l-1.2 12.5H6.2zM9 8V7a3 3 0 0 1 6 0v1', radar: 300 },
  market: { label: 'Markets', color: '#e2a336', glyph: 'M3.5 9h17l-2 10.5h-13zM8 9l3-5M16 9l-3-5', radar: 500 },
  phones: { label: 'Phone shops', color: '#687076', glyph: 'M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3zm1.5 2.5v11h5v-11z', radar: 500 },
  mechanic: { label: 'Mechanics', color: '#6e6e7a', glyph: 'M14.6 3.6a5 5 0 0 0-6 6.4L3.5 15a2.1 2.1 0 1 0 3 3l5-5.1a5 5 0 0 0 6.4-6l-3 3-2.6-.7-.7-2.6z', radar: 400 },
  transport: { label: 'Parks and stations', color: '#0090ff', glyph: 'M6 4h12a2 2 0 0 1 2 2v10a2 2 0 0 1-1.5 1.9V20h-2.5v-2h-8v2H5.5v-2.1A2 2 0 0 1 4 16V6a2 2 0 0 1 2-2zm0 2.5V11h12V6.5zM7.5 13.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm9 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z', radar: 500 },
  hotel: { label: 'Hotels', color: '#e93d82', glyph: 'M3 7v13h2v-3h14v3h2v-6a3 3 0 0 0-3-3h-7v5H5V7zm5 3.5a2 2 0 1 0 0 .1z', radar: 300 },
  sports: { label: 'Pitches and courts', color: '#29a383', glyph: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4l3.3 2.4-1.3 3.9H10l-1.3-3.9z', radar: 400 },
  landmark: { label: 'Landmarks', color: '#978365', glyph: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z', radar: 500 },
  jobs: { label: 'Hustles', color: '#ffc53d', glyph: 'M4 8h16v11H4zM9 8V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2', radar: 900 },
  home: { label: 'Your place', color: '#2de0c8', glyph: 'M12 3.5l8.5 7.5H18v9h-4.5v-5.5h-3V20H6v-9H3.5z', radar: 2000 },
  business: { label: 'Businesses', color: '#ff8a3d', glyph: 'M4 9l1.6-5h12.8L20 9v1a2.5 2.5 0 0 1-4 2 2.5 2.5 0 0 1-4 0 2.5 2.5 0 0 1-4 0A2.5 2.5 0 0 1 4 10zm1 4.5V20h14v-6.5', radar: 400 },
};
export const CAT_IDS = Object.keys(CATS) as MapCat[];
/** OSM point kinds (pipe/pack.py PK) and places.json kinds to a category */
export const POI_CAT: Record<number, MapCat> = { 2: 'fuel', 3: 'market', 5: 'hospital', 6: 'pharmacy', 7: 'bank', 8: 'food', 9: 'club', 11: 'police', 12: 'mechanic', 13: 'shop', 14: 'hotel', 16: 'transport', 17: 'transport', 19: 'bank', 21: 'transport' };
export const PLACE_CAT: Record<string, MapCat> = { hospital: 'hospital', clinic: 'hospital', pharmacy: 'pharmacy', police: 'police', bank: 'bank', fuel: 'fuel', food: 'food', market: 'market', shop: 'shop', phones: 'phones', mechanic: 'mechanic', optician: 'shop', park: 'transport', station: 'transport', jetty: 'transport', landmark: 'landmark', bar: 'club' };

const paths = new Map<string, Path2D>();
function path(d: string) { let p = paths.get(d); if (!p) { p = new Path2D(d); paths.set(d, p); } return p; }
/** a round badge with the glyph; r is the radius in canvas pixels */
export function drawIcon(g: CanvasRenderingContext2D, cat: MapCat, x: number, y: number, r: number, opts: { ring?: string; dim?: boolean } = {}) {
  const c = CATS[cat];
  g.save(); g.translate(x, y);
  if (opts.dim) g.globalAlpha = 0.55;
  g.beginPath(); g.arc(0, 0, r + 1.6, 0, Math.PI * 2); g.fillStyle = opts.ring ?? 'rgba(8,10,16,.85)'; g.fill();
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = c.color; g.fill();
  const s = (r * 1.25) / 12; g.scale(s, s); g.translate(-12, -12);
  if (c.text) { g.fillStyle = '#fff'; g.font = '800 17px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c.text, 12, 13); }
  else { const p = path(c.glyph); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.lineJoin = 'round'; g.lineCap = 'round'; g.fill(p, 'evenodd'); if (/[a-z]\d.*[ML]/.test(c.glyph) && cat === 'pharmacy') { g.strokeStyle = c.color; g.stroke(p); } }
  g.restore();
}
/** the waypoint pin (purple, like GTA) and the objective marker (yellow) */
export function drawPin(g: CanvasRenderingContext2D, x: number, y: number, s: number, color = '#b45cff') {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-3, -6, -9, -9, -9, -15); g.arc(0, -15, 9, Math.PI, 0); g.bezierCurveTo(9, -9, 3, -6, 0, 0); g.closePath();
  g.fillStyle = color; g.strokeStyle = 'rgba(8,10,16,.9)'; g.lineWidth = 2.4; g.fill(); g.stroke();
  g.beginPath(); g.arc(0, -15, 3.6, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  g.restore();
}
