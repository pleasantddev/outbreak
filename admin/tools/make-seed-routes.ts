// Builds the demo routes.json by routing over the real road network between named places (Dijkstra over OSM roads).
// Run: npx tsx tools/make-seed-routes.ts   -> seed/content/routes.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { parseRegion } from '../../v2/src/world/region.ts';
const W = '../v2/public/world'; const man = JSON.parse(readFileSync(W + '/manifest.json', 'utf8'));
const packs = new Map<string, Buffer>();
const key = (x: number, z: number) => `${Math.round(x / 3)},${Math.round(z / 3)}`;
const nodes = new Map<string, { x: number; z: number; adj: { to: string; w: number; name: string | null }[] }>();
const node = (x: number, z: number) => { const k = key(x, z); let n = nodes.get(k); if (!n) { n = { x, z, adj: [] }; nodes.set(k, n); } return k; };
for (const k of Object.keys(man.regions)) {
  const [i, j] = k.split(',').map(Number); if (Math.abs(i) > 4 || j < -5 || j > 5 || i < -4) continue; const meta = man.regions[k];
  if (!packs.has(meta.pack)) packs.set(meta.pack, readFileSync(W + '/' + meta.pack)); const pk = packs.get(meta.pack)!; const dv = new DataView(pk.buffer, pk.byteOffset, pk.byteLength); const n = dv.getUint16(4, true); let sl: Uint8Array | undefined;
  for (let q = 0; q < n; q++) { const o = 6 + q * 12; if (dv.getInt16(o, true) === i && dv.getInt16(o + 2, true) === j) { const off = dv.getUint32(o + 4, true), len = dv.getUint32(o + 8, true); sl = pk.subarray(off, off + len); } }
  if (!sl) continue; const raw = gunzipSync(new Uint8Array(sl)); const r = parseRegion(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, man.regionSize);
  for (const rd of r.roads) {
    if (rd.cls > 5 || rd.cls === 11) continue; const oneway = !!(rd.flags & 1); const rev = !!(rd.flags & 32);
    for (let p = 0; p < rd.pts.length / 2 - 1; p++) {
      const a = node(rd.pts[p * 2], rd.pts[p * 2 + 1]), b = node(rd.pts[p * 2 + 2], rd.pts[p * 2 + 3]); if (a === b) continue;
      const w = Math.hypot(rd.pts[p * 2 + 2] - rd.pts[p * 2], rd.pts[p * 2 + 3] - rd.pts[p * 2 + 1]) * (rd.cls >= 5 ? 1.3 : 1);
      if (!oneway) { nodes.get(a)!.adj.push({ to: b, w, name: rd.name }); nodes.get(b)!.adj.push({ to: a, w, name: rd.name }); } else if (!rev) nodes.get(a)!.adj.push({ to: b, w, name: rd.name }); else nodes.get(b)!.adj.push({ to: a, w, name: rd.name });
    }
  }
}
console.log('graph nodes', nodes.size);
const near = (x: number, z: number) => { let best = '', d = 1e12; for (const [k, n] of nodes) { const dd = (n.x - x) ** 2 + (n.z - z) ** 2; if (dd < d) { d = dd; best = k; } } return best; };
function route(from: [number, number], to: [number, number]) {
  const s = near(...from), t = near(...to); const dist = new Map<string, number>([[s, 0]]); const prev = new Map<string, string>(); const done = new Set<string>();
  const heap: [number, string][] = [[0, s]];
  const push = (it: [number, string]) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) { const [d, u] = pop(); if (done.has(u)) continue; done.add(u); if (u === t) break; for (const e of nodes.get(u)!.adj) { const nd = d + e.w; if (nd < (dist.get(e.to) ?? 1e12)) { dist.set(e.to, nd); prev.set(e.to, u); push([nd, e.to]); } } }
  if (!done.has(t)) return null; const path: [number, number][] = []; for (let c: string | undefined = t; c; c = prev.get(c)) { const n = nodes.get(c)!; path.push([n.x, n.z]); } path.reverse();
  return { path, len: dist.get(t)! };
}
function simplify(p: [number, number][], eps: number): [number, number][] {
  if (p.length < 3) return p; const [a, b] = [p[0], p[p.length - 1]]; let md = 0, mi = 0; const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  for (let i = 1; i < p.length - 1; i++) { const d = Math.abs((p[i][0] - a[0]) * dz - (p[i][1] - a[1]) * dx) / L; if (d > md) { md = d; mi = i; } }
  if (md < eps) return [a, b]; return [...simplify(p.slice(0, mi + 1), eps).slice(0, -1), ...simplify(p.slice(mi), eps)];
}
const PLACES: Record<string, [number, number]> = {
  oshodi: [890, -206], ikeja: [-459, -4257], computerVillage: [-346, -4500], maryland: [2565, -2670], ojota: [3998, -3767], obalende: [7119, 11430], ojuelegba: [2134, 4670], yaba: [3431, 3773], ogba: [-139, -8791], berger: [2821, -9793], surulere: [1561, 5771], cappa: [223, 96], airport: [-3600, -3071], agege: [-2638, -9288], mushin: [-418, 4603], apapa: [-919, 3805],
};
const R = (id: string, name: string, kind: string, stops: [string, string][], pay: number, desc: string) => {
  const pts: [number, number][] = []; const legs = []; let total = 0;
  for (let i = 0; i < stops.length - 1; i++) { const r = route(PLACES[stops[i][0]], PLACES[stops[i + 1][0]]); if (!r) { console.log('no path', id, stops[i], stops[i + 1]); continue; } total += r.len; pts.push(...(pts.length ? r.path.slice(1) : r.path)); legs.push(r.len); }
  const s = simplify(pts, 14).map(([x, z]) => ({ x: Math.round(x), z: Math.round(z) }));
  const stopsOut = stops.map(([k, n]) => ({ name: n, x: PLACES[k][0], z: PLACES[k][1] }));
  return { id, name, kind, desc, pay, lengthM: Math.round(total), stops: stopsOut, points: s };
};
const items = [
  R('route.danfo.oshodi-ojuelegba', 'Oshodi to Ojuelegba (danfo)', 'danfo', [['oshodi', 'Oshodi'], ['mushin', 'Mushin'], ['ojuelegba', 'Ojuelegba']], 350, 'Yellow danfo line through the mainland. Conductor shouts the stops.'),
  R('route.danfo.ikeja-oshodi', 'Ikeja to Oshodi (danfo)', 'danfo', [['ikeja', 'Ikeja Bus Terminal'], ['oshodi', 'Oshodi']], 250, 'Short hop down Agege Motor Road corridor.'),
  R('route.danfo.maryland-yaba', 'Maryland to Yaba (danfo)', 'danfo', [['maryland', 'Maryland'], ['yaba', 'Yaba']], 400, 'Busy afternoon line, slow at the bridge.'),
  R('route.okada.ogba-ikeja', 'Ogba to Ikeja (okada)', 'okada', [['ogba', 'Ogba Bus Park'], ['ikeja', 'Ikeja']], 180, 'Okada shortcut that avoids the Ogba traffic.'),
  R('route.delivery.cappa-computer-village', 'Cappa to Computer Village (delivery)', 'delivery', [['cappa', 'Cappa Mechanic Village'], ['computerVillage', 'Computer Village']], 2200, 'Spare parts run. Fragile boxes, no hard braking.'),
  R('route.delivery.apapa-ojota', 'Apapa to Ojota (haulage)', 'haulage', [['apapa', 'Apapa Port Gate'], ['ojota', 'Ojota Interchange']], 9500, 'Container haulage. Long, slow, pays well.'),
  R('route.danfo.berger-ikeja', 'Berger to Ikeja (danfo)', 'danfo', [['berger', 'Ojodu Berger'], ['ogba', 'Ogba Bus Park'], ['ikeja', 'Ikeja']], 450, 'Long evening line from Berger.'),
];
mkdirSync('seed/content', { recursive: true });
writeFileSync('seed/content/routes.json', JSON.stringify({ version: 1, items }, null, 2) + '\n');
console.log(items.map((i) => `${i.id} ${i.lengthM} m, ${i.points.length} pts`).join('\n'));
