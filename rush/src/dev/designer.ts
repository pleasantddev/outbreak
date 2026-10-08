// Race designer: turn real Oshodi roads into race routes. Click anchors onto the road graph, join roads the real
// network does not join, drop ramps, bag rows, boost strips, potholes and checkpoints, keep traffic off a stretch,
// close roads to steer the routing, and the route rebuilds live with the same code the game, the server and the
// tests use. Save a design to this browser and test drive it in a real race, or export it for trackDefs.ts.
// Open with ?dev=designer, optionally &design=<saved id> or &from=<official route id>.
import '../ui/styles.css';
import './designer.css';
import { buildTrack, type TrackDef, type XZ, type TrackLink, type TrackRampDef } from '../shared/trackBuild';
import { TRACK_DEFS } from '../shared/trackDefs';
import { Track, type TrackData } from '../shared/track';
import type { WorldData, GraphNode, GraphEdge, RoadClass } from '../shared/world';
import { lineFor, type RacingLine } from '../shared/ai';
import { loadDesigns, saveDesign, deleteDesign, loadGraph, validDesign } from '../app/designs';
import { goRoute } from '../app/route';

type Tool = 'select' | 'anchor' | 'start' | 'link' | 'ramp' | 'pickup' | 'boost' | 'hazard' | 'checkpoint' | 'traffic' | 'shortcut' | 'close';
const TOOLS: { id: Tool; key: string; icon: string; name: string; hint: string }[] = [
  { id: 'select', key: 'V', icon: '↖', name: 'Select', hint: 'Click anything to select it and drag to move it. Delete removes it. Drag the empty map to pan, scroll to zoom, F fits the route.' },
  { id: 'anchor', key: 'A', icon: '◆', name: 'Anchor', hint: 'Click a road to add a waypoint after the selected one. The race runs through the anchors in order over real roads and closes back to the first.' },
  { id: 'start', key: 'S', icon: '⚑', name: 'Start', hint: 'Click the route where the start line goes. The grid forms behind it, so leave a straight in front.' },
  { id: 'link', key: 'L', icon: '⤳', name: 'Link', hint: 'Click two roads to join them where the real network does not: a U-turn through a median, a cut through a motor park. Close points get a U-turn bulb.' },
  { id: 'ramp', key: 'R', icon: '◢', name: 'Ramp', hint: 'Click the route to place a kicker. Set its side, height and length in the panel.' },
  { id: 'pickup', key: 'P', icon: '●', name: 'Bags', hint: 'Click the route to place a row of Ghana Must Go bags. Placed rows replace the automatic ones.' },
  { id: 'boost', key: 'B', icon: '»', name: 'Boost', hint: 'Click near a kerb to lay a BRT boost strip on that side. Placed strips replace the automatic ones.' },
  { id: 'hazard', key: 'H', icon: '◎', name: 'Pothole', hint: 'Click the road to dig a pothole that stays all race. Switch it to a water spill in the panel.' },
  { id: 'checkpoint', key: 'C', icon: '┃', name: 'Check', hint: 'Click the route to add a checkpoint. Placed checkpoints replace the evenly spaced ones, so cover every corner a driver could cut.' },
  { id: 'traffic', key: 'T', icon: '⛔', name: 'Traffic', hint: 'Click where a traffic free stretch starts, then where it ends, in driving order.' },
  { id: 'shortcut', key: 'K', icon: '⑂', name: 'Short', hint: 'Click road points from where the shortcut leaves the route to where it rejoins it. Enter finishes, Escape abandons.' },
  { id: 'close', key: 'X', icon: '✕', name: 'Close', hint: 'Click a road to keep the route off it; click again to open it. Use it when the routing takes a road you do not want.' },
];

type SelKind = 'anchor' | 'link' | 'ramp' | 'pickup' | 'boost' | 'hazard' | 'checkpoint' | 'traffic' | 'shortcut' | 'start';
interface Sel { kind: SelKind; i: number; j?: number }

const CLS_COL: Record<RoadClass, string> = { motorway: '#66707f', trunk: '#5f6878', primary: '#56606e', secondary: '#4d5562', tertiary: '#454c57', residential: '#3c424b', service: '#33383f', path: '#2b2f35', link: '#56606e' };
const AREA_COL: Record<string, string> = { water: '#0f2c40', grass: '#142519', sand: '#2b2619', market: '#2d2414', parking: '#1b1e23', industrial: '#1b1b20', residential: '#16181c', commercial: '#1a1a20', rail: '#1c1b1b' };

export async function runDesigner(params: URLSearchParams) {
  document.getElementById('gl')?.remove();
  const ui = document.getElementById('ui')!;
  ui.style.cssText = 'position:fixed;inset:0;pointer-events:auto';
  const [published, graph] = await Promise.all([fetch('world/oshodi.json').then((r) => r.json()) as Promise<WorldData>, loadGraph('')]);
  const world: WorldData = { ...published, graph };
  const nodes = world.graph.nodes.filter((n) => n.edges.some((ei) => world.graph.edges[ei]?.cls !== 'path'));
  const edges = world.graph.edges.filter((e) => e.cls !== 'path');
  const roadName = new Map(world.roads.map((r) => [r.id, r.name]));
  const forwardDefs = TRACK_DEFS.filter((d) => !d.reverse);

  // ------------------------------------------------------------------------------------------- state
  let def: TrackDef = initialDef();
  let built: TrackData | null = null, track: Track | null = null, line: RacingLine | null = null;
  let warnings: string[] = [], error: string | null = null, buildMs = 0;
  let tool: Tool = 'select';
  let sel: Sel | null = null;
  let pending: XZ[] = [];                   // link, traffic and shortcut tools collect points here
  const undo: string[] = [], redo: string[] = [];
  let saved = JSON.stringify(def);
  const layers = { buildings: true, line: true, traffic: true, height: false };
  const view = { cx: 0, cz: -100, s: 0.6 };
  let hover: { x: number; z: number; road: string } = { x: 0, z: 0, road: '' };

  function initialDef(): TrackDef {
    const d = params.get('design'), f = params.get('from');
    const mine = loadDesigns();
    if (d) { const found = mine.find((x) => x.id === d); if (found) return structuredClone(found); }
    if (f) { const off = forwardDefs.find((x) => x.id === f); if (off) return copyOfficial(off); }
    return mine[0] ? structuredClone(mine[0]) : blank();
  }
  function blank(): TrackDef {
    return { id: freeId('my-route'), name: 'My Route', district: 'Oshodi', tagline: 'A route of my own through Oshodi.', laps: 3, route: [], start: [0, 0], hw: [6, 9], autoRamps: 2 };
  }
  function copyOfficial(o: TrackDef): TrackDef {
    const c = structuredClone(o) as TrackDef;
    delete c.reverse; delete c.base;
    c.id = freeId(`${o.id}-mine`); c.name = `${o.name} (mine)`;
    return c;
  }
  function freeId(base: string) {
    const taken = new Set([...loadDesigns().map((x) => x.id), ...TRACK_DEFS.map((x) => x.id)]);
    let id = slug(base), k = 2;
    while (taken.has(id)) id = `${slug(base)}-${k++}`;
    return id;
  }

  // ------------------------------------------------------------------------------------------- layout
  ui.innerHTML = `<div class="dz">
    <div class="dz-top">
      <div class="dz-brand"><b>Lagos</b> Rush<span>Race designer</span></div>
      <button class="b" data-a="game" title="Back to the game">Game</button>
      <button class="b" data-a="new" title="Start an empty route">New</button>
      <select data-a="open" title="Open a saved design or copy an official route"></select>
      <button class="b" data-a="undo" title="Undo (Ctrl+Z)">Undo</button>
      <button class="b" data-a="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
      <button class="b" data-a="fit" title="Fit the route (F)">Fit</button>
      <button class="b" data-a="reverse" title="Run the route the other way round">Reverse</button>
      <span class="dz-sp"></span>
      <button class="b" data-a="import">Import</button>
      <button class="b" data-a="export">Export</button>
      <button class="b" data-a="save" title="Save to this browser (Ctrl+S)">Save</button>
      <button class="b go" data-a="drive" title="Save and race it">Test drive</button>
    </div>
    <div class="dz-tools">${TOOLS.map((t) => `<button class="dz-tool" data-tool="${t.id}" title="${t.name} (${t.key})"><kbd>${t.key}</kbd>${t.icon}<small>${t.name}</small></button>`).join('')}</div>
    <div class="dz-map"><canvas></canvas><div class="dz-hint"></div>
      <div class="dz-legend"><span><i style="background:#f6c514"></i>route</span><span><i style="background:#ff2d8a"></i>AI line</span><span><i style="background:#3ddc84"></i>traffic with you</span><span><i style="background:#ff5a4f"></i>oncoming</span><span><i style="background:#f6a623"></i>two way</span><span><i style="background:#39d0ff"></i>bridge or boost</span></div>
    </div>
    <div class="dz-side"></div>
    <div class="dz-foot"></div>
  </div>`;
  const root = ui.querySelector('.dz') as HTMLElement;
  const mapEl = root.querySelector('.dz-map') as HTMLElement;
  const canvas = mapEl.querySelector('canvas') as HTMLCanvasElement;
  const g = canvas.getContext('2d')!;
  const side = root.querySelector('.dz-side') as HTMLElement;
  const foot = root.querySelector('.dz-foot') as HTMLElement;
  const hintEl = root.querySelector('.dz-hint') as HTMLElement;
  const openSel = root.querySelector('select[data-a=open]') as HTMLSelectElement;

  // ------------------------------------------------------------------------------------------- editing
  function edit(fn: () => void) {
    undo.push(JSON.stringify(def)); if (undo.length > 120) undo.shift(); redo.length = 0;
    fn();
    rebuild(); panel();
  }
  function restore(json: string) { def = JSON.parse(json); sel = null; pending = []; rebuild(); panel(); }
  function load(d: TrackDef) { undo.length = 0; redo.length = 0; def = structuredClone(d); saved = JSON.stringify(def); sel = null; pending = []; rebuild(); fit(); panel(); }

  function rebuild() {
    if (def.route.length < 2) { built = null; track = null; line = null; warnings = []; error = def.route.length ? 'Add a second anchor: a route needs at least two.' : null; draw(); return; }
    try {
      const t0 = performance.now();
      const r = buildTrack(world, def);
      buildMs = performance.now() - t0;
      built = r.data; track = new Track(built); line = lineFor(track);
      warnings = [...r.warnings, ...checks(built, track)];
      error = null;
    } catch (e) {
      error = (e as Error).message.replace(/^[^:]+: /, ''); // keep the last good build on screen, faded
    }
    draw();
  }

  /** Checks the builder does not make: things a designer should know before anyone races the route. */
  function checks(td: TrackData, tr: Track) {
    const out: string[] = [];
    const b = world.meta.bounds, m = 60;
    const c = tr.paths[0];
    for (let i = 0; i < c.n; i += 10) {
      if (c.x[i] < b.minX - m || c.x[i] > b.maxX + m || c.z[i] < b.minZ - m || c.z[i] > b.maxZ + m) { out.push(`the route leaves the map near ${c.x[i].toFixed(0)}, ${c.z[i].toFixed(0)}: nothing is built out there`); break; }
    }
    if (td.length < 700) out.push(`a ${td.length.toFixed(0)} m lap is very short: the pack will pile into the first corner`);
    if (td.length > 6000) out.push(`a ${(td.length / 1000).toFixed(1)} km lap is very long for a phone session; consider one lap`);
    // the grid takes the 50 m behind the line; every official route keeps that stretch gentler than a 40 m radius
    let bend = 0; for (let s = td.length - 52; s <= td.length + 12; s += 2) bend = Math.max(bend, Math.abs(tr.curvatureAt(s)));
    if (bend > 0.025) out.push(`the start line sits on a ${Math.round(1 / bend)} m radius bend: the grid will form round it`);
    return out;
  }

  // ------------------------------------------------------------------------------------------- geometry helpers
  const T = (x: number, z: number): [number, number] => [canvas.clientWidth / 2 + (x - view.cx) * view.s, canvas.clientHeight / 2 + (z - view.cz) * view.s];
  const W = (px: number, py: number): XZ => [view.cx + (px - canvas.clientWidth / 2) / view.s, view.cz + (py - canvas.clientHeight / 2) / view.s];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const round = (p: XZ): XZ => [r1(p[0]), r1(p[1])];

  function nearestNode(x: number, z: number): { n: GraphNode; d: number } {
    let best = nodes[0], bd = Infinity;
    for (const n of nodes) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } }
    return { n: best, d: bd };
  }
  function nearestRoad(x: number, z: number): { x: number; z: number; e: GraphEdge; d: number } | null {
    let best: { x: number; z: number; e: GraphEdge; d: number } | null = null;
    for (const e of edges) {
      for (let k = 0; k < e.pts.length - 1; k++) {
        const a = e.pts[k], b = e.pts[k + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
        const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(px - x, pz - z);
        if (!best || d < best.d) best = { x: px, z: pz, e, d };
      }
    }
    return best;
  }
  /** Nearest point on the built main loop, with the lateral offset of (x, z) from the centre line. */
  function onTrack(x: number, z: number) {
    if (!track) return null;
    const c = track.paths[0];
    let bi = 0, bd = Infinity;
    for (let i = 0; i < c.n; i++) { const d = (c.x[i] - x) ** 2 + (c.z[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const p = track.pointAt(c.s[bi]);
    const d = (x - p.x) * p.rx + (z - p.z) * p.rz;
    return { s: c.s[bi], p, d, dist: Math.sqrt(bd) };
  }

  // ------------------------------------------------------------------------------------------- drawing
  let raf = 0;
  function draw() { if (!raf) raf = requestAnimationFrame(paint); }
  function paint() {
    raf = 0;
    const dpr = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0d1013'; g.fillRect(0, 0, w, h);
    const vis = (pts: number[][]) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of pts) { const [a, b] = T(p[0], p[1]); if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b; } return x1 > -20 && x0 < w + 20 && y1 > -20 && y0 < h + 20; };
    const poly = (pts: number[][]) => { g.beginPath(); pts.forEach((p, i) => { const [a, b] = T(p[0], p[1]); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); };
    // ground
    for (const a of world.areas) { if (!vis(a.pts)) continue; g.fillStyle = AREA_COL[a.kind] ?? '#16181c'; poly(a.pts); g.fill(); }
    if (layers.buildings) { g.fillStyle = '#232830'; for (const b of world.buildings) { if (!vis(b.pts)) continue; poly(b.pts); g.fill(); } }
    g.strokeStyle = '#4a3f3a'; g.lineWidth = 1.5; g.setLineDash([4, 4]);
    for (const r of world.rails) { if (!vis(r.pts)) continue; poly(r.pts); g.stroke(); }
    g.setLineDash([]);
    for (const t of world.terminals) { poly(t.pts); g.fillStyle = 'rgba(208,64,208,0.28)'; g.fill(); g.strokeStyle = '#d040d0'; g.lineWidth = 1.5; g.stroke(); }
    // roads, ground level first, bridges on top with a casing
    g.lineCap = 'round'; g.lineJoin = 'round';
    const avoid = new Set(def.avoid ?? []);
    const roads = [...world.roads].sort((a, b) => a.layer - b.layer);
    for (const r of roads) {
      if (!vis(r.pts)) continue;
      const wpx = Math.max(r.cls === 'path' ? 0.8 : 1.4, r.w * view.s);
      if (r.bridge) { poly(r.pts); g.strokeStyle = '#0b0d10'; g.lineWidth = wpx + 3; g.stroke(); }
      poly(r.pts); g.strokeStyle = r.bridge ? '#6c7a8e' : CLS_COL[r.cls]; g.lineWidth = wpx; g.stroke();
      if (r.bridge && view.s > 0.5) { poly(r.pts); g.strokeStyle = 'rgba(57,208,255,0.55)'; g.lineWidth = 1; g.stroke(); }
      if (avoid.has(r.id)) { poly(r.pts); g.strokeStyle = '#ff3b30'; g.lineWidth = Math.max(2, wpx * 0.5); g.setLineDash([6, 5]); g.stroke(); g.setLineDash([]); }
    }
    // the edge of the built world
    const bb = world.meta.bounds, [bx0, bz0] = T(bb.minX, bb.minZ), [bx1, bz1] = T(bb.maxX, bb.maxZ);
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.setLineDash([10, 8]); g.lineWidth = 1; g.strokeRect(bx0, bz0, bx1 - bx0, bz1 - bz0); g.setLineDash([]);
    if (view.s > 0.35) { g.font = '600 11px Inter, sans-serif'; g.fillStyle = 'rgba(244,242,236,0.75)'; for (const t of world.terminals) { const [a, b] = T(t.centre[0], t.centre[1]); g.fillText(t.name.toUpperCase(), a - 26, b + 4); } }

    if (track && built) drawTrack(w, h);
    drawHandles();
  }

  function drawTrack(w: number, h: number) {
    const tr = track!, td = built!, L = td.length;
    g.globalAlpha = error ? 0.35 : 1;
    const step = Math.max(2, 3 / view.s);
    // corridor
    g.beginPath();
    for (let s = 0; s <= L; s += step) { const p = tr.pointAt(s, -tr.pointAt(s).hw, 0, false); const [a, b] = T(p.x, p.z); if (s) g.lineTo(a, b); else g.moveTo(a, b); }
    for (let s = L; s >= 0; s -= step) { const p = tr.pointAt(s, tr.pointAt(s).hw, 0, false); const [a, b] = T(p.x, p.z); g.lineTo(a, b); }
    g.closePath(); g.fillStyle = 'rgba(246,197,20,0.16)'; g.fill(); g.strokeStyle = 'rgba(246,197,20,0.55)'; g.lineWidth = 1; g.stroke();
    // shortcuts
    for (let pi = 1; pi < tr.paths.length; pi++) {
      const c = tr.paths[pi]; g.beginPath();
      for (let i = 0; i < c.n; i++) { const [a, b] = T(c.x[i], c.z[i]); if (i) g.lineTo(a, b); else g.moveTo(a, b); }
      g.strokeStyle = '#3ddc84'; g.lineWidth = Math.max(2, c.hw[0] * 2 * view.s * 0.6); g.globalAlpha = (error ? 0.35 : 1) * 0.55; g.stroke(); g.globalAlpha = error ? 0.35 : 1;
    }
    // centre line, tinted by height when asked
    const c = tr.paths[0];
    let ymin = Infinity, ymax = -Infinity; for (let i = 0; i < c.n; i++) { ymin = Math.min(ymin, c.y[i]); ymax = Math.max(ymax, c.y[i]); }
    g.lineWidth = 2;
    for (let i = 0; i < c.n; i++) {
      const j = (i + 1) % c.n; const [a, b] = T(c.x[i], c.z[i]), [a2, b2] = T(c.x[j], c.z[j]);
      if (a < -40 && a2 < -40 || a > w + 40 && a2 > w + 40 || b < -40 && b2 < -40 || b > h + 40 && b2 > h + 40) continue;
      g.strokeStyle = layers.height ? heightCol((c.y[i] - ymin) / Math.max(1, ymax - ymin)) : '#f6c514';
      g.beginPath(); g.moveTo(a, b); g.lineTo(a2, b2); g.stroke();
    }
    // traffic along the right side of the corridor
    if (layers.traffic) {
      for (const t of td.traffic) {
        g.strokeStyle = t.flow === 1 ? '#3ddc84' : t.flow === -1 ? '#ff5a4f' : '#f6a623'; g.lineWidth = 3; g.beginPath();
        for (let s = t.s0; s <= t.s1; s += step) { const p = tr.pointAt(s, tr.pointAt(s).hw * 0.6, 0, false); const [a, b] = T(p.x, p.z); if (s === t.s0) g.moveTo(a, b); else g.lineTo(a, b); }
        g.stroke();
      }
    }
    // AI racing line
    if (layers.line && line) {
      g.strokeStyle = 'rgba(255,45,138,0.85)'; g.lineWidth = 1.2; g.beginPath();
      for (let i = 0; i <= line.n; i++) { const k = i % line.n; const p = tr.pointAt(line.s[k], line.d[k], 0, false); const [a, b] = T(p.x, p.z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }
      g.stroke();
    }
    // checkpoints
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    for (const s of td.checkpoints) { const p = tr.pointAt(s, 0, 0, false); seg(p, -p.hw, p.hw); }
    // ramps
    g.fillStyle = '#ff8a1a';
    for (const r of td.ramps) {
      const d0 = r.d0 ?? -tr.pointAt(r.s1).hw, d1 = r.d1 ?? tr.pointAt(r.s1).hw;
      const q = [tr.pointAt(r.s0, d0, 0, false), tr.pointAt(r.s1, d0, 0, false), tr.pointAt(r.s1, d1, 0, false), tr.pointAt(r.s0, d1, 0, false)];
      g.beginPath(); q.forEach((p, i) => { const [a, b] = T(p.x, p.z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath(); g.fill();
    }
    // boost strips
    g.strokeStyle = '#39d0ff'; g.lineWidth = Math.max(2, 3.2 * view.s);
    for (const b of td.boosts) { g.beginPath(); for (let s = b.s; s <= b.s + b.len; s += 4) { const p = tr.pointAt(s, b.d, 0, false); const [x, y] = T(p.x, p.z); if (s === b.s) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); }
    // bags
    g.fillStyle = '#3ddc84';
    for (const row of td.pickups) for (const d of row.d) { const p = tr.pointAt(row.s, d, 0, false); const [a, b] = T(p.x, p.z); g.beginPath(); g.arc(a, b, Math.max(2, 0.9 * view.s), 0, Math.PI * 2); g.fill(); }
    // permanent hazards
    for (const hz of td.hazards ?? []) { const p = tr.pointAt(hz.s, hz.d, 0, false); const [a, b] = T(p.x, p.z); g.beginPath(); g.arc(a, b, Math.max(3, 1.9 * view.s), 0, Math.PI * 2); g.fillStyle = hz.kind === 'pothole' ? '#7a5636' : '#7fd4ff'; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke(); }
    // grid and start line
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (const sl of td.grid.slice(0, 12)) { const [a, b] = T(sl.x, sl.z); g.save(); g.translate(a, b); g.rotate(-sl.h + Math.PI); g.fillRect(-0.9 * view.s, -2.1 * view.s, 1.8 * view.s, 4.2 * view.s); g.restore(); }
    const sp = tr.pointAt(0, 0, 0, false);
    for (let k = -4; k < 4; k++) { const p0 = tr.pointAt(0, (k / 4) * sp.hw, 0, false), p1 = tr.pointAt(0, ((k + 1) / 4) * sp.hw, 0, false); g.strokeStyle = k % 2 ? '#000' : '#fff'; g.lineWidth = 4; const [a, b] = T(p0.x, p0.z), [a2, b2] = T(p1.x, p1.z); g.beginPath(); g.moveTo(a, b); g.lineTo(a2, b2); g.stroke(); }
    // direction arrows
    g.fillStyle = 'rgba(246,197,20,0.9)';
    for (let s = 60; s < L; s += Math.max(80, 140 / view.s * 0.6)) { const p = tr.pointAt(s, 0, 0, false); const [a, b] = T(p.x, p.z); g.save(); g.translate(a, b); g.rotate(Math.atan2(p.tz, p.tx)); g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -4); g.lineTo(-4, 4); g.closePath(); g.fill(); g.restore(); }
    g.globalAlpha = 1;
    function seg(p: { x: number; z: number; rx: number; rz: number }, d0: number, d1: number) { const [a, b] = T(p.x + p.rx * d0, p.z + p.rz * d0), [a2, b2] = T(p.x + p.rx * d1, p.z + p.rz * d1); g.beginPath(); g.moveTo(a, b); g.lineTo(a2, b2); g.stroke(); }
  }
  function heightCol(f: number) { const r = Math.round(60 + 195 * f), gg = Math.round(200 - 120 * f), b = Math.round(255 - 200 * f); return `rgb(${r},${gg},${b})`; }

  function drawHandles() {
    // the anchor order as a thin line, and where each anchor snaps on the road graph
    if (def.route.length) {
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.setLineDash([3, 4]); g.beginPath();
      def.route.forEach((p, i) => { const [a, b] = T(p[0], p[1]); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
      if (def.route.length > 2) { const [a, b] = T(def.route[0][0], def.route[0][1]); g.lineTo(a, b); }
      g.stroke(); g.setLineDash([]);
    }
    def.route.forEach((p, i) => {
      const sn = nearestNode(p[0], p[1]);
      const [a, b] = T(p[0], p[1]), [na, nb] = T(sn.n.x, sn.n.z);
      if (sn.d > 3) { g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(a, b); g.lineTo(na, nb); g.stroke(); g.beginPath(); g.arc(na, nb, 4, 0, Math.PI * 2); g.stroke(); }
      const on = sel?.kind === 'anchor' && sel.i === i;
      g.beginPath(); g.arc(a, b, on ? 11 : 9, 0, Math.PI * 2); g.fillStyle = on ? '#f6c514' : '#141418'; g.fill(); g.strokeStyle = '#f6c514'; g.lineWidth = 2; g.stroke();
      g.fillStyle = on ? '#0b0b0d' : '#f6c514'; g.font = '700 11px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), a, b + 0.5);
    });
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    (def.links ?? []).forEach((l, i) => {
      const pts = [l.a, ...(l.via ?? []), l.b];
      g.strokeStyle = sel?.kind === 'link' && sel.i === i ? '#f6c514' : '#39d0ff'; g.lineWidth = 2; g.setLineDash([6, 4]); g.beginPath();
      pts.forEach((p, k) => { const [a, b] = T(p[0], p[1]); if (k) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke(); g.setLineDash([]);
      for (const p of [l.a, l.b]) box(p, '#39d0ff', sel?.kind === 'link' && sel.i === i);
    });
    (def.shortcuts ?? []).forEach((sc, i) => { g.strokeStyle = '#3ddc84'; g.lineWidth = 1.5; g.setLineDash([2, 3]); g.beginPath(); sc.route.forEach((p, k) => { const [a, b] = T(p[0], p[1]); if (k) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke(); g.setLineDash([]); sc.route.forEach((p, j) => box(p, '#3ddc84', sel?.kind === 'shortcut' && sel.i === i && sel.j === j)); });
    (def.ramps ?? []).forEach((r, i) => box(r.at, '#ff8a1a', sel?.kind === 'ramp' && sel.i === i));
    (def.pickups ?? []).forEach((p, i) => box(p, '#3ddc84', sel?.kind === 'pickup' && sel.i === i));
    (def.boosts ?? []).forEach((b, i) => box(b.at, '#39d0ff', sel?.kind === 'boost' && sel.i === i));
    (def.hazards ?? []).forEach((hz, i) => box(hz.at, hz.kind === 'purewater' ? '#7fd4ff' : '#c08a5a', sel?.kind === 'hazard' && sel.i === i));
    (def.checkpoints ?? []).forEach((p, i) => box(p, '#ffffff', sel?.kind === 'checkpoint' && sel.i === i));
    (def.noTraffic ?? []).forEach((pair, i) => {
      pair.forEach((p, j) => box(p, '#ff3b30', sel?.kind === 'traffic' && sel.i === i && sel.j === j));
      const [a, b] = T(pair[0][0], pair[0][1]), [a2, b2] = T(pair[1][0], pair[1][1]);
      g.strokeStyle = 'rgba(255,59,48,0.6)'; g.setLineDash([2, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(a, b); g.lineTo(a2, b2); g.stroke(); g.setLineDash([]);
    });
    if (def.route.length) { const [a, b] = T(def.start[0], def.start[1]); g.font = '16px sans-serif'; g.fillStyle = sel?.kind === 'start' ? '#f6c514' : '#ffffff'; g.fillText('⚑', a - 4, b - 6); }
    // points collected by the link, traffic and shortcut tools
    if (pending.length) {
      g.strokeStyle = '#f6c514'; g.lineWidth = 2; g.setLineDash([4, 3]); g.beginPath();
      [...pending, [hover.x, hover.z] as XZ].forEach((p, k) => { const [a, b] = T(p[0], p[1]); if (k) g.lineTo(a, b); else g.moveTo(a, b); });
      g.stroke(); g.setLineDash([]);
      for (const p of pending) box(p, '#f6c514', true);
    }
  }
  function box(p: XZ, col: string, on: boolean) {
    const [a, b] = T(p[0], p[1]), r = on ? 7 : 5;
    g.fillStyle = on ? '#f6c514' : col; g.fillRect(a - r, b - r, r * 2, r * 2);
    g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(a - r, b - r, r * 2, r * 2);
  }

  // ------------------------------------------------------------------------------------------- hit testing
  function handles(): { sel: Sel; p: XZ }[] {
    const out: { sel: Sel; p: XZ }[] = [];
    def.route.forEach((p, i) => out.push({ sel: { kind: 'anchor', i }, p }));
    (def.links ?? []).forEach((l, i) => { out.push({ sel: { kind: 'link', i, j: 0 }, p: l.a }); out.push({ sel: { kind: 'link', i, j: 1 }, p: l.b }); });
    (def.shortcuts ?? []).forEach((sc, i) => sc.route.forEach((p, j) => out.push({ sel: { kind: 'shortcut', i, j }, p })));
    (def.ramps ?? []).forEach((r, i) => out.push({ sel: { kind: 'ramp', i }, p: r.at }));
    (def.pickups ?? []).forEach((p, i) => out.push({ sel: { kind: 'pickup', i }, p }));
    (def.boosts ?? []).forEach((b, i) => out.push({ sel: { kind: 'boost', i }, p: b.at }));
    (def.hazards ?? []).forEach((hz, i) => out.push({ sel: { kind: 'hazard', i }, p: hz.at }));
    (def.checkpoints ?? []).forEach((p, i) => out.push({ sel: { kind: 'checkpoint', i }, p }));
    (def.noTraffic ?? []).forEach((pair, i) => pair.forEach((p, j) => out.push({ sel: { kind: 'traffic', i, j }, p })));
    if (def.route.length) out.push({ sel: { kind: 'start', i: 0 }, p: def.start });
    return out;
  }
  function hit(px: number, py: number): { sel: Sel; p: XZ } | null {
    let best: { sel: Sel; p: XZ } | null = null, bd = 12;
    for (const h of handles()) { const [a, b] = T(h.p[0], h.p[1]); const d = Math.hypot(a - px, b - py); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  /** The point a selection handle stands for, so a drag can move it. */
  function setPoint(s: Sel, p: XZ) {
    switch (s.kind) {
      case 'anchor': def.route[s.i] = p; break;
      case 'link': { const l = def.links![s.i]; const old = s.j ? l.b : l.a; if (s.j) l.b = p; else l.a = p; if (l.via) l.via = l.via.map((v) => [r1(v[0] + p[0] - old[0]), r1(v[1] + p[1] - old[1])] as XZ); break; }
      case 'shortcut': def.shortcuts![s.i].route[s.j!] = p; break;
      case 'ramp': def.ramps![s.i].at = p; break;
      case 'pickup': def.pickups![s.i] = p; break;
      case 'boost': def.boosts![s.i].at = p; break;
      case 'hazard': def.hazards![s.i].at = p; break;
      case 'checkpoint': def.checkpoints![s.i] = p; break;
      case 'traffic': def.noTraffic![s.i][s.j!] = p; break;
      case 'start': def.start = p; break;
    }
  }
  function removeSel() {
    if (!sel) return;
    const s = sel;
    edit(() => {
      switch (s.kind) {
        case 'anchor': def.route.splice(s.i, 1); break;
        case 'link': def.links!.splice(s.i, 1); break;
        case 'shortcut': def.shortcuts!.splice(s.i, 1); break;
        case 'ramp': def.ramps!.splice(s.i, 1); break;
        case 'pickup': def.pickups!.splice(s.i, 1); break;
        case 'boost': def.boosts!.splice(s.i, 1); break;
        case 'hazard': def.hazards!.splice(s.i, 1); break;
        case 'checkpoint': def.checkpoints!.splice(s.i, 1); break;
        case 'traffic': def.noTraffic!.splice(s.i, 1); break;
        case 'start': break;
      }
      tidy();
      sel = s.kind === 'anchor' && def.route.length ? { kind: 'anchor', i: Math.max(0, s.i - 1) } : null;
    });
  }
  /** Drop empty lists so exported designs only carry what the designer actually placed. */
  function tidy() {
    for (const k of ['links', 'shortcuts', 'ramps', 'pickups', 'boosts', 'hazards', 'checkpoints', 'noTraffic', 'avoid'] as const) if (Array.isArray(def[k]) && !(def[k] as unknown[]).length) delete def[k];
  }

  // ------------------------------------------------------------------------------------------- tools
  function place(x: number, z: number) {
    const ot = onTrack(x, z);
    const needTrack = (what: string) => { if (!ot || ot.dist > 40) { toast(track ? `Click on the route to place ${what}` : 'Build a route first: add anchors'); return false; } return true; };
    switch (tool) {
      case 'anchor': {
        const sn = nearestNode(x, z);
        if (sn.d > 40) { toast('Click closer to a road'); return; }
        edit(() => {
          const p = round([sn.n.x, sn.n.z]);
          const at = sel?.kind === 'anchor' ? sel.i + 1 : def.route.length;
          def.route.splice(at, 0, p);
          if (def.route.length === 1) def.start = p;
          sel = { kind: 'anchor', i: at };
        });
        return;
      }
      case 'start': if (!needTrack('the start line')) return; edit(() => { def.start = round([ot!.p.x, ot!.p.z]); sel = { kind: 'start', i: 0 }; }); return;
      case 'ramp': if (!needTrack('a ramp')) return; edit(() => { (def.ramps ??= []).push({ at: round([ot!.p.x, ot!.p.z]), side: 'full', h: 1.5, len: 12 }); sel = { kind: 'ramp', i: def.ramps!.length - 1 }; }); return;
      case 'pickup': if (!needTrack('bags')) return; edit(() => { (def.pickups ??= []).push(round([ot!.p.x, ot!.p.z])); sel = { kind: 'pickup', i: def.pickups!.length - 1 }; }); return;
      case 'checkpoint': if (!needTrack('a checkpoint')) return; edit(() => { (def.checkpoints ??= []).push(round([ot!.p.x, ot!.p.z])); sel = { kind: 'checkpoint', i: def.checkpoints!.length - 1 }; }); return;
      case 'boost': if (!needTrack('a boost strip')) return; edit(() => { (def.boosts ??= []).push({ at: round([x, z]), side: ot!.d < 0 ? 'left' : 'right' }); sel = { kind: 'boost', i: def.boosts!.length - 1 }; }); return;
      case 'hazard': {
        if (!needTrack('a pothole')) return;
        const d = Math.max(-(ot!.p.hw - 1.2), Math.min(ot!.p.hw - 1.2, ot!.d));
        edit(() => { (def.hazards ??= []).push({ at: round([ot!.p.x + ot!.p.rx * d, ot!.p.z + ot!.p.rz * d]), kind: 'pothole' }); sel = { kind: 'hazard', i: def.hazards!.length - 1 }; });
        return;
      }
      case 'traffic': {
        if (!needTrack('a traffic free stretch')) return;
        const p = round([ot!.p.x, ot!.p.z]);
        if (!pending.length) { pending = [p]; draw(); return; }
        const a = pending[0]; pending = [];
        edit(() => { (def.noTraffic ??= []).push([a, p]); sel = { kind: 'traffic', i: def.noTraffic!.length - 1, j: 1 }; });
        return;
      }
      case 'link': {
        const nr = nearestRoad(x, z);
        if (!nr || nr.d > 30) { toast('Click closer to a road'); return; }
        const p = round([nr.x, nr.z]);
        if (!pending.length) { pending = [p]; linkRoadA = nr.e.road; draw(); return; }
        const a = pending[0]; pending = [];
        const link: TrackLink = { a, b: p, w: 13, roadA: linkRoadA, roadB: nr.e.road };
        const gap = Math.hypot(p[0] - a[0], p[1] - a[1]);
        if (gap < 30) link.via = bulb(a, p);
        edit(() => { (def.links ??= []).push(link); sel = { kind: 'link', i: def.links!.length - 1 }; });
        return;
      }
      case 'shortcut': {
        const nr = nearestRoad(x, z);
        if (!nr || nr.d > 30) { toast('Click closer to a road'); return; }
        pending.push(round([nr.x, nr.z])); draw(); return;
      }
      case 'close': {
        const nr = nearestRoad(x, z);
        if (!nr || nr.d > 25) { toast('Click closer to a road'); return; }
        const id = nr.e.road;
        edit(() => { const av = new Set(def.avoid ?? []); if (av.has(id)) av.delete(id); else av.add(id); def.avoid = [...av]; tidy(); });
        toast(`${roadName.get(id) || 'Unnamed road'} ${(def.avoid ?? []).includes(id) ? 'closed to the route' : 'open again'}`);
        return;
      }
      default: return;
    }
  }
  let linkRoadA = 0;
  /** A U-turn bulb: a half circle bulging out past the two points, like the ones cut through Oshodi's medians. */
  function bulb(a: XZ, b: XZ): XZ[] {
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L;
    // bulge away from the nearest road direction: the side with no road beyond the median
    const ahead = nearestRoad(mx - uz * 12, mz + ux * 12), behind = nearestRoad(mx + uz * 12, mz - ux * 12);
    const sgn = (ahead?.d ?? 0) > (behind?.d ?? 0) ? 1 : -1;
    const nx = -uz * sgn, nz = ux * sgn, r = Math.max(7, L / 2 + 2);
    return [0.2, 0.4, 0.6, 0.8].map((f) => { const ang = Math.PI * f; const along = -Math.cos(ang) * L / 2, out = Math.sin(ang) * r; return [r1(mx + ux * along + nx * out), r1(mz + uz * along + nz * out)] as XZ; });
  }
  function finishShortcut() {
    if (tool !== 'shortcut' || pending.length < 2) return;
    const route = pending; pending = [];
    edit(() => { (def.shortcuts ??= []).push({ name: `Shortcut ${(def.shortcuts?.length ?? 0) + 1}`, route, hw: 4.6 }); sel = { kind: 'shortcut', i: def.shortcuts!.length - 1, j: 0 }; });
  }

  // ------------------------------------------------------------------------------------------- input
  let drag: { mode: 'pan' | 'move'; x: number; y: number; cx: number; cz: number; before?: string; moved: boolean; lastBuild: number } | null = null;
  let space = false;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const panning = e.button === 1 || e.button === 2 || space;
    if (!panning && (tool === 'select' || e.altKey)) {
      const h = hit(px, py);
      if (h) { sel = h.sel; drag = { mode: 'move', x: px, y: py, cx: 0, cz: 0, before: JSON.stringify(def), moved: false, lastBuild: 0 }; panel(); draw(); return; }
      if (tool === 'select') { sel = null; panel(); }
    }
    if (panning || tool === 'select') { drag = { mode: 'pan', x: px, y: py, cx: view.cx, cz: view.cz, moved: false, lastBuild: 0 }; mapEl.classList.add('pan'); return; }
    const [x, z] = W(px, py);
    place(x, z);
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const [x, z] = W(px, py);
    if (drag?.mode === 'pan') { view.cx = drag.cx - (px - drag.x) / view.s; view.cz = drag.cz - (py - drag.y) / view.s; drag.moved = true; draw(); }
    else if (drag?.mode === 'move' && sel) {
      drag.moved = true;
      setPoint(sel, round([x, z]));
      const now = performance.now();
      if (now - drag.lastBuild > 140) { drag.lastBuild = now; rebuild(); } else draw();
    } else {
      const nr = nearestRoad(x, z);
      hover = { x, z, road: nr && nr.d < 20 ? (roadName.get(nr.e.road) || `unnamed ${nr.e.cls}`) + (nr.e.bridge ? ', bridge' : '') : '' };
      if (pending.length) draw();
    }
    status();
  });
  canvas.addEventListener('pointerup', () => {
    if (drag?.mode === 'move' && drag.moved && drag.before) {
      undo.push(drag.before); redo.length = 0;
      if (sel?.kind === 'link') { const l = def.links![sel.i]; const nr = nearestRoad(...(sel.j ? l.b : l.a)); if (nr) { if (sel.j) l.roadB = nr.e.road; else l.roadA = nr.e.road; } }
      if (sel?.kind === 'anchor') { const p = def.route[sel.i]; const sn = nearestNode(p[0], p[1]); def.route[sel.i] = round([sn.n.x, sn.n.z]); }
      rebuild(); panel();
    }
    drag = null; mapEl.classList.remove('pan');
  });
  canvas.addEventListener('dblclick', () => finishShortcut());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const [x, z] = W(px, py);
    view.s = Math.max(0.08, Math.min(8, view.s * Math.exp(-e.deltaY * 0.0015)));
    view.cx = x - (px - canvas.clientWidth / 2) / view.s; view.cz = z - (py - canvas.clientHeight / 2) / view.s;
    draw(); status();
  }, { passive: false });
  window.addEventListener('resize', () => draw());
  window.addEventListener('keydown', (e) => {
    const typing = (e.target as HTMLElement).closest('input, textarea, select');
    if (typing) { if (e.key === 'Escape') (e.target as HTMLElement).blur(); return; }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); doSave(); return; }
    if (e.key === ' ') { space = true; e.preventDefault(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { removeSel(); return; }
    if (e.key === 'Escape') { if (pending.length) pending = []; else sel = null; draw(); panel(); return; }
    if (e.key === 'Enter') { finishShortcut(); return; }
    if (k === 'f') { fit(); return; }
    if (e.key === '?') { showHint(); return; }
    const t = TOOLS.find((x) => x.key.toLowerCase() === k);
    if (t && !e.ctrlKey && !e.metaKey) setTool(t.id);
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') space = false; });
  window.addEventListener('beforeunload', (e) => { if (JSON.stringify(def) !== saved) e.preventDefault(); });

  function setTool(t: Tool) {
    tool = t; pending = [];
    root.querySelectorAll('.dz-tool').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tool === t));
    mapEl.classList.toggle('sel', t === 'select');
    const d = TOOLS.find((x) => x.id === t)!;
    hintEl.innerHTML = `<b>${d.name}</b>${d.hint}`;
    showHint();
    draw();
  }
  let hintT = 0;
  /** The tool hint reads for a few seconds, then gets out of the way of the map; ? brings it back. */
  function showHint() { hintEl.classList.remove('hide'); clearTimeout(hintT); hintT = window.setTimeout(() => hintEl.classList.add('hide'), 7000); }
  root.querySelector('.dz-tools')!.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-tool]') as HTMLElement | null; if (b) setTool(b.dataset.tool as Tool); });

  function doUndo() { const s = undo.pop(); if (!s) return; redo.push(JSON.stringify(def)); restore(s); }
  function doRedo() { const s = redo.pop(); if (!s) return; undo.push(JSON.stringify(def)); restore(s); }
  function fit() {
    const pts: number[][] = track ? Array.from({ length: track.paths[0].n }, (_, i) => [track!.paths[0].x[i], track!.paths[0].z[i]]) : def.route.length ? def.route : [[world.meta.bounds.minX, world.meta.bounds.minZ], [world.meta.bounds.maxX, world.meta.bounds.maxZ]];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    view.cx = (x0 + x1) / 2; view.cz = (z0 + z1) / 2;
    view.s = Math.max(0.08, Math.min(4, Math.min((canvas.clientWidth - 80) / Math.max(60, x1 - x0), (canvas.clientHeight - 80) / Math.max(60, z1 - z0))));
    draw(); status();
  }

  // ------------------------------------------------------------------------------------------- side panel
  function panel() {
    const td = built;
    const placed = (n?: unknown[]) => n?.length ?? 0;
    const msgs = error ? `<div class="dz-msg err">${esc(error)}</div>` : '';
    const warn = warnings.map((w) => `<div class="dz-msg warn">${esc(w)}</div>`).join('');
    const ok = !error && td && !warnings.length ? '<div class="dz-msg ok">Ready to race: the route closes, the grid fits and nothing overlaps.</div>' : '';
    const trafficPct = td ? Math.round((td.traffic.reduce((a, t) => a + t.s1 - t.s0, 0) / td.length) * 100) : 0;
    let climb = 0; if (track) { const c = track.paths[0]; let lo = Infinity, hi = -Infinity; for (let i = 0; i < c.n; i++) { lo = Math.min(lo, c.y[i]); hi = Math.max(hi, c.y[i]); } climb = hi - lo; }
    side.innerHTML = `
      <div class="dz-sec"><h3>Route</h3>
        <div class="dz-row"><label>Name</label><input data-f="name" maxlength="40" value="${esc(def.name)}"></div>
        <div class="dz-row"><label>Id</label><input data-f="id" maxlength="40" value="${esc(def.id)}"></div>
        <div class="dz-row"><label>District</label><input data-f="district" maxlength="40" value="${esc(def.district)}"></div>
        <div class="dz-row"><label>Tagline</label><textarea data-f="tagline" maxlength="160">${esc(def.tagline)}</textarea></div>
        <div class="dz-row"><label>Laps</label><input data-f="laps" type="number" min="1" max="9" value="${def.laps}"></div>
        <div class="dz-row"><label>Width (half)</label><div class="dz-pair"><input data-f="hw0" type="number" min="4" max="12" step="0.5" value="${def.hw?.[0] ?? 6}" title="narrowest"><input data-f="hw1" type="number" min="4" max="14" step="0.5" value="${def.hw?.[1] ?? 9.5}" title="widest"></div></div>
        <div class="dz-row"><label>Corner radius</label><input data-f="cornerR" type="number" min="6" max="60" placeholder="auto" value="${def.cornerR ?? ''}"></div>
        <div class="dz-row"><label>Auto ramps</label><input data-f="autoRamps" type="number" min="0" max="4" value="${def.autoRamps ?? 2}"></div>
        <div class="dz-row"><label>Auto bag rows</label><input data-f="pickupRows" type="number" min="0" max="8" placeholder="auto" value="${def.pickupRows ?? ''}" ${placed(def.pickups) ? 'disabled title="placed rows replace these"' : ''}></div>
        <div class="dz-row"><label>Auto BRT strips</label><input data-f="brtLanes" type="number" min="0" max="5" placeholder="2" value="${def.brtLanes ?? ''}" ${placed(def.boosts) ? 'disabled title="placed strips replace these"' : ''}></div>
      </div>
      ${selPanel()}
      <div class="dz-sec"><h3>Checks</h3>${msgs}${warn}${ok}${!td && !error ? '<div class="dz-msg warn">Pick the Anchor tool (A) and click roads in driving order. Two anchors make a route.</div>' : ''}</div>
      <div class="dz-sec"><h3>Numbers</h3><div class="dz-stats">
        ${stat('Lap', td ? `${(td.length / 1000).toFixed(2)} km` : '-')}${stat('Race', td ? `${((td.length * def.laps) / 1000).toFixed(1)} km` : '-')}
        ${stat('Gold lap', td ? `${td.par.toFixed(1)} s` : '-')}${stat('Race time', td ? `${Math.round(td.par * def.laps * 1.12)} s` : '-')}
        ${stat('Ramps', td ? `${td.ramps.length} (${placed(def.ramps)} placed)` : '-')}${stat('Bag rows', td ? `${td.pickups.length}` : '-')}
        ${stat('Boost strips', td ? `${td.boosts.length}` : '-')}${stat('Checkpoints', td ? `${td.checkpoints.length}` : '-')}
        ${stat('Traffic', td ? `${trafficPct}% of lap` : '-')}${stat('Climb', td ? `${climb.toFixed(1)} m` : '-')}
        ${stat('Potholes', `${placed(def.hazards)}`)}${stat('Build', td ? `${buildMs.toFixed(0)} ms` : '-')}
      </div></div>
      <div class="dz-sec"><h3>Anchors</h3><div class="dz-list">${def.route.map((p, i) => `<div class="dz-item ${sel?.kind === 'anchor' && sel.i === i ? 'on' : ''}" data-pick="anchor:${i}"><b>${i + 1}</b><span>${esc(nearRoadName(p))}</span><button class="dz-x" data-up="${i}" title="Earlier">▲</button><button class="dz-x" data-down="${i}" title="Later">▼</button><button class="dz-x" data-del="anchor:${i}" title="Remove">✕</button></div>`).join('') || '<div class="small mute">No anchors yet.</div>'}</div></div>
      <div class="dz-sec dz-checks"><h3>Show</h3>
        <label><input type="checkbox" data-layer="buildings" ${layers.buildings ? 'checked' : ''}> Buildings</label>
        <label><input type="checkbox" data-layer="line" ${layers.line ? 'checked' : ''}> AI racing line</label>
        <label><input type="checkbox" data-layer="traffic" ${layers.traffic ? 'checked' : ''}> Traffic direction</label>
        <label><input type="checkbox" data-layer="height" ${layers.height ? 'checked' : ''}> Height (blue low, red high)</label>
      </div>
      <div class="dz-sec"><h3>This design</h3><div class="dz-pair"><button class="b" data-a="dup">Duplicate</button><button class="b warn" data-a="delete">Delete</button></div>
        <div class="small mute" style="margin-top:8px; line-height:1.45">Designs live in this browser and race offline, against AI. To make one an official route that rooms can use, export it, add it to <code>src/shared/trackDefs.ts</code> and run <code>npm run gis:build</code>.</div></div>`;
    openSel.innerHTML = `<option value="">Open...</option><optgroup label="Your designs">${loadDesigns().map((d) => `<option value="mine:${esc(d.id)}">${esc(d.name)}</option>`).join('')}</optgroup><optgroup label="Copy an official route">${forwardDefs.map((d) => `<option value="official:${d.id}">${esc(d.name)}</option>`).join('')}</optgroup>`;
    (root.querySelector('[data-a=undo]') as HTMLButtonElement).disabled = !undo.length;
    (root.querySelector('[data-a=redo]') as HTMLButtonElement).disabled = !redo.length;
    (root.querySelector('[data-a=drive]') as HTMLButtonElement).disabled = !built || !!error;
  }
  function stat(k: string, v: string) { return `<div class="dz-stat"><div>${k}</div><b>${v}</b></div>`; }
  function nearRoadName(p: XZ) { const nr = nearestRoad(p[0], p[1]); return nr ? roadName.get(nr.e.road) || `unnamed ${nr.e.cls}` : ''; }
  function segBtns(field: string, options: [string, string][], value: string) { return `<div class="dz-seg">${options.map(([v, l]) => `<button data-sf="${field}" data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`; }

  function selPanel() {
    if (!sel) return '';
    const s = sel;
    let body = '';
    if (s.kind === 'anchor') { const p = def.route[s.i]; body = `<div class="small mute">Anchor ${s.i + 1} of ${def.route.length} at ${p[0]}, ${p[1]}, on ${esc(nearRoadName(p))}. New anchors go in after this one.</div>`; }
    if (s.kind === 'ramp') { const r = def.ramps![s.i]; body = `<div class="dz-row"><label>Side</label>${segBtns('side', [['full', 'Full'], ['left', 'Left'], ['right', 'Right']], r.side ?? 'full')}</div><div class="dz-row"><label>Height (m)</label><input data-rf="h" type="number" min="0.6" max="3" step="0.1" value="${r.h ?? 1.5}"></div><div class="dz-row"><label>Length (m)</label><input data-rf="len" type="number" min="6" max="24" step="1" value="${r.len ?? 12}"></div>`; }
    if (s.kind === 'boost') { const b = def.boosts![s.i]; body = `<div class="dz-row"><label>Kerb</label>${segBtns('bside', [['left', 'Left'], ['right', 'Right']], b.side ?? 'right')}</div>`; }
    if (s.kind === 'hazard') { const h = def.hazards![s.i]; body = `<div class="dz-row"><label>Kind</label>${segBtns('kind', [['pothole', 'Pothole'], ['purewater', 'Water spill']], h.kind ?? 'pothole')}</div><div class="small mute">Stays all race. A horn cannot clear it.</div>`; }
    if (s.kind === 'link') { const l = def.links![s.i]; body = `<div class="dz-row"><label>Width (m)</label><input data-lf="w" type="number" min="8" max="24" value="${l.w ?? 13}"></div><div class="dz-row"><label>Shape</label>${segBtns('lshape', [['straight', 'Straight'], ['bulb', 'U-turn bulb']], l.via?.length ? 'bulb' : 'straight')}</div>`; }
    if (s.kind === 'shortcut') { const sc = def.shortcuts![s.i]; body = `<div class="dz-row"><label>Name</label><input data-cf="name" maxlength="30" value="${esc(sc.name)}"></div><div class="dz-row"><label>Half width</label><input data-cf="hw" type="number" min="3" max="8" step="0.2" value="${sc.hw ?? 4.6}"></div>`; }
    if (s.kind === 'traffic') body = '<div class="small mute">No civilian traffic between these two points.</div>';
    if (s.kind === 'start') body = '<div class="small mute">The grid forms behind the line in two staggered columns.</div>';
    const title: Record<SelKind, string> = { anchor: 'Anchor', link: 'Link', ramp: 'Ramp', pickup: 'Bag row', boost: 'Boost strip', hazard: 'Hazard', checkpoint: 'Checkpoint', traffic: 'No traffic', shortcut: 'Shortcut', start: 'Start line' };
    return `<div class="dz-sec"><h3>${title[s.kind]}</h3>${body}${s.kind !== 'start' ? '<button class="b warn" data-a="remove" style="margin-top:6px">Remove</button>' : ''}</div>`;
  }

  side.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.layer) { (layers as Record<string, boolean>)[t.dataset.layer] = t.checked; draw(); return; }
    const f = t.dataset.f, rf = t.dataset.rf, lf = t.dataset.lf, cf = t.dataset.cf;
    const num = (lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(t.value)));
    if (f) edit(() => {
      if (f === 'name') def.name = t.value.trim().slice(0, 40) || 'Untitled';
      if (f === 'id') { const id = slug(t.value); if (id && id !== def.id) def.id = id; }
      if (f === 'district') def.district = t.value.trim().slice(0, 40);
      if (f === 'tagline') def.tagline = t.value.trim().slice(0, 160);
      if (f === 'laps') def.laps = Math.round(num(1, 9));
      if (f === 'hw0' || f === 'hw1') { const hw: [number, number] = def.hw ?? [6, 9.5]; hw[f === 'hw0' ? 0 : 1] = num(4, 14); if (hw[0] > hw[1]) hw.reverse(); def.hw = hw; }
      if (f === 'cornerR') { if (t.value === '') delete def.cornerR; else def.cornerR = num(6, 60); }
      if (f === 'autoRamps') def.autoRamps = Math.round(num(0, 4));
      if (f === 'pickupRows') { if (t.value === '') delete def.pickupRows; else def.pickupRows = Math.round(num(0, 8)); }
      if (f === 'brtLanes') { if (t.value === '') delete def.brtLanes; else def.brtLanes = Math.round(num(0, 5)); }
    });
    if (rf && sel?.kind === 'ramp') edit(() => { const r = def.ramps![sel!.i] as TrackRampDef; if (rf === 'h') r.h = num(0.6, 3); else r.len = num(6, 24); });
    if (lf && sel?.kind === 'link') edit(() => { def.links![sel!.i].w = num(8, 24); });
    if (cf && sel?.kind === 'shortcut') edit(() => { const sc = def.shortcuts![sel!.i]; if (cf === 'name') sc.name = t.value.trim().slice(0, 30) || 'Shortcut'; else sc.hw = num(3, 8); });
  });
  side.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button, [data-pick]') as HTMLElement | null;
    if (!t) return;
    const d = t.dataset;
    if (d.sf && sel) {
      const v = d.v!; const s = sel;
      edit(() => {
        if (d.sf === 'side' && s.kind === 'ramp') def.ramps![s.i].side = v as TrackRampDef['side'];
        if (d.sf === 'bside' && s.kind === 'boost') def.boosts![s.i].side = v as 'left' | 'right';
        if (d.sf === 'kind' && s.kind === 'hazard') def.hazards![s.i].kind = v as 'pothole' | 'purewater';
        if (d.sf === 'lshape' && s.kind === 'link') { const l = def.links![s.i]; if (v === 'bulb') l.via = bulb(l.a, l.b); else delete l.via; }
      });
      return;
    }
    if (d.up !== undefined || d.down !== undefined) {
      const i = Number(d.up ?? d.down), j = d.up !== undefined ? i - 1 : i + 1;
      if (j < 0 || j >= def.route.length) return;
      edit(() => { [def.route[i], def.route[j]] = [def.route[j], def.route[i]]; sel = { kind: 'anchor', i: j }; });
      return;
    }
    if (d.del) { const [kind, i] = d.del.split(':'); sel = { kind: kind as SelKind, i: Number(i) }; removeSel(); return; }
    if (d.pick) { const [kind, i] = d.pick.split(':'); sel = { kind: kind as SelKind, i: Number(i) }; const p = def.route[Number(i)]; view.cx = p[0]; view.cz = p[1]; panel(); draw(); return; }
    if (d.a) action(d.a);
  });
  root.querySelector('.dz-top')!.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button[data-a]') as HTMLElement | null; if (b) action(b.dataset.a!); });
  openSel.addEventListener('change', () => {
    const v = openSel.value; openSel.value = '';
    if (!v) return;
    void confirmLeave().then((ok) => {
      if (!ok) return;
      const [kind, id] = v.split(':');
      if (kind === 'mine') { const d = loadDesigns().find((x) => x.id === id); if (d) load(d); }
      else { const o = forwardDefs.find((x) => x.id === id); if (o) { load(copyOfficial(o)); saved = ''; toast(`Copied ${o.name}. Save to keep it.`); } }
    });
  });

  function confirmLeave() { return JSON.stringify(def) === saved ? Promise.resolve(true) : ask('Leave this design without saving?', 'Leave'); }
  function action(a: string) {
    switch (a) {
      case 'game': void confirmLeave().then((ok) => { if (ok) goRoute('game'); }); break;
      case 'new': void confirmLeave().then((ok) => { if (ok) { load(blank()); saved = ''; setTool('anchor'); } }); break;
      case 'undo': doUndo(); break;
      case 'redo': doRedo(); break;
      case 'fit': fit(); break;
      case 'reverse': edit(() => {
        def.route.reverse();
        if (def.shortcuts) for (const sc of def.shortcuts) sc.route.reverse();
        if (def.noTraffic) def.noTraffic = def.noTraffic.map(([a2, b]) => [b, a2]);
      }); break;
      case 'save': doSave(); break;
      case 'drive': if (doSave()) goRoute('test', def.id); break;
      case 'export': exportModal(); break;
      case 'import': importModal(); break;
      case 'dup': { const c = structuredClone(def); c.id = freeId(`${def.id}-copy`); c.name = `${def.name} copy`; load(c); saved = ''; toast('Duplicated. Save to keep it.'); break; }
      case 'delete': void ask(`Delete "${def.name}" from this browser?`, 'Delete').then((ok) => { if (ok) { deleteDesign(def.id); load(loadDesigns()[0] ?? blank()); toast('Deleted'); } }); break;
      case 'remove': removeSel(); break;
    }
  }
  function doSave() {
    if (!def.route.length) { toast('Nothing to save yet'); return false; }
    if (TRACK_DEFS.some((o) => o.id === def.id)) { def.id = freeId(`${def.id}-mine`); }
    if (!validDesign(def)) { toast('This design has something out of range; check the panel'); return false; }
    saveDesign(def); saved = JSON.stringify(def); panel(); toast(`Saved "${def.name}"`);
    return true;
  }
  function exportModal() {
    const json = JSON.stringify(def, null, 2);
    const m = modal(`<div class="h3">Export</div><div class="small mute">A TrackDef for <code>src/shared/trackDefs.ts</code>, or a file to share with another designer.</div><textarea readonly>${esc(json)}</textarea><div class="dz-pair"><button class="b" data-m="copy">Copy</button><button class="b go" data-m="file">Download ${esc(def.id)}.json</button></div><button class="b" data-m="close">Close</button>`);
    m.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest('[data-m]') as HTMLElement | null; if (!b) return;
      if (b.dataset.m === 'copy') { try { await navigator.clipboard.writeText(json); toast('Copied'); } catch { (m.querySelector('textarea') as HTMLTextAreaElement).select(); toast('Select all and copy'); } }
      if (b.dataset.m === 'file') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = `${def.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
      if (b.dataset.m === 'close') m.remove();
    });
  }
  function importModal() {
    const m = modal(`<div class="h3">Import</div><div class="small mute">Paste a design exported from this tool.</div><textarea placeholder='{ "id": "my-route", ... }'></textarea><div class="dz-pair"><button class="b" data-m="close">Cancel</button><button class="b go" data-m="load">Load</button></div>`);
    m.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-m]') as HTMLElement | null; if (!b) return;
      if (b.dataset.m === 'close') { m.remove(); return; }
      try {
        const d = JSON.parse((m.querySelector('textarea') as HTMLTextAreaElement).value);
        if (!validDesign(d)) { toast('That is not a design this tool can read'); return; }
        delete (d as TrackDef).reverse; delete (d as TrackDef).base;
        if (loadDesigns().some((x) => x.id === d.id) || TRACK_DEFS.some((x) => x.id === d.id)) d.id = freeId(d.id);
        m.remove(); load(d); saved = ''; toast('Imported. Save to keep it.');
      } catch { toast('That is not valid JSON'); }
    });
  }
  function modal(html: string) { const m = document.createElement('div'); m.className = 'dz-modal'; m.innerHTML = `<div>${html}</div>`; root.appendChild(m); return m; }
  /** An in page yes or no: browser confirm boxes are blocked inside hosted preview pages. */
  function ask(question: string, yes: string) {
    return new Promise<boolean>((done) => {
      const m = modal(`<div class="h3">${esc(question)}</div><div class="dz-pair"><button class="b" data-m="no">Cancel</button><button class="b go" data-m="yes">${esc(yes)}</button></div>`);
      m.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-m]') as HTMLElement | null; if (!b) return;
        m.remove(); done(b.dataset.m === 'yes');
      });
      (m.querySelector('[data-m="yes"]') as HTMLButtonElement).focus();
    });
  }
  let toastT = 0;
  function toast(text: string) {
    root.querySelector('.dz-toast')?.remove();
    const t = document.createElement('div'); t.className = 'dz-toast'; t.textContent = text; root.appendChild(t);
    clearTimeout(toastT); toastT = window.setTimeout(() => t.remove(), 2200);
  }
  function status() {
    foot.innerHTML = `<span>x <b>${hover.x.toFixed(1)}</b> z <b>${hover.z.toFixed(1)}</b></span><span>${esc(hover.road)}</span><span class="dz-sp"></span><span>zoom <b>${view.s.toFixed(2)}</b> px/m</span><span>${esc(def.id)}${JSON.stringify(def) !== saved ? ' <b>(unsaved)</b>' : ''}</span>`;
  }

  // ------------------------------------------------------------------------------------------- go
  (window as unknown as { __designer: unknown }).__designer = { get def() { return def; }, get built() { return built; }, get warnings() { return warnings; }, get error() { return error; }, place: (x: number, z: number) => place(x, z), setTool, toast, action, view, finishShortcut };
  setTool(def.route.length ? 'select' : 'anchor');
  rebuild(); panel();
  requestAnimationFrame(() => { fit(); status(); });
  (window as unknown as { __ready: boolean }).__ready = true;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
