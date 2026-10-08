// LAGOS: the map of Oshodi drawn from the world data, with every race route and the landmarks. Pan and
// zoom with a finger, a mouse or the keyboard.
import type { App, Screen } from '../../app/app';
import { el, acts, esc } from '../dom';
import { topbar } from './main';
import type { TrackData } from '../../shared/track';
import { goRoute } from '../../app/route';

let selTrack = 'terminal';
const LANDMARKS: { name: string; x: number; z: number; d: string }[] = [
  { name: 'Terminal 1', x: 6, z: 126, d: 'The louvred terminal under the steel arches, south of the expressway.' },
  { name: 'Terminal 2', x: -25, z: 28, d: 'The white perforated wedge beside the Oshodi Road junction.' },
  { name: 'Terminal 3', x: 204, z: -77, d: 'Blue glass under the giant space frame canopy, east of the railway.' },
  { name: 'The skywalks', x: 80, z: 0, d: 'Cable stayed footbridges on lattice pylons linking the three terminals.' },
  { name: 'Expressway bridges', x: 110, z: 20, d: 'The Apapa Oworonshoki Expressway flies over Agege Motor Road and the railway.' },
  { name: 'Oshodi Road', x: -300, z: -54, d: 'Market street running west from the interchange.' },
  { name: 'Church Street', x: -650, z: -300, d: 'The long straight north toward Oyetayo Street.' },
  { name: 'Agege Motor Road', x: -120, z: -450, d: 'Dual carriageway with the BRT lane, running north to south through the interchange.' },
];

export function lagosMap(app: App): Screen {
  const tracks = app.stage!.tracks.filter((t) => !t.reverse && !t.custom);
  const td = app.stage!.tracks.find((t) => t.id === selTrack) ?? tracks[0];
  const node = el(`<div class="screen">
    ${topbar('Lagos', 'Oshodi, built from real map data')}
    <div class="split" style="grid-template-columns:1fr minmax(260px,340px)">
      <div class="mapwrap panel">
        <canvas></canvas>
        <div class="legend panel"><div><span style="color:#f6c514">■</span> Selected route</div><div><span style="color:#39d0ff">■</span> Bridges</div><div><span style="color:#d040d0">■</span> Terminals</div></div>
      </div>
      <div class="scroll" style="display:flex; flex-direction:column; gap:10px">
        <div class="h3">Routes</div>
        ${tracks.map((t) => `<button class="card ${t.id === td.id ? 'sel' : ''}" data-act="track" data-id="${t.id}"><div class="k">${esc(t.name)}</div><div class="d">${esc(t.district)} . ${(t.length / 1000).toFixed(2)} km</div></button>`).join('')}
        <button class="card" data-act="design"><div class="k">Design a route</div><div class="d">Draw your own race over these roads, then test drive it. Best with a mouse.</div></button>
        <div class="h3" style="margin-top:6px">Landmarks</div>
        ${LANDMARKS.map((l, i) => `<button class="card" data-act="mark" data-i="${i}" style="min-height:0"><div class="k" style="font-size:1.05em">${esc(l.name)}</div><div class="d">${esc(l.d)}</div></button>`).join('')}
      </div>
    </div>
  </div>`);
  const canvas = node.querySelector('canvas') as HTMLCanvasElement;
  const view = { cx: 0, cz: -150, s: 0.55 };
  let raf = 0;
  const draw = () => {
    raf = 0;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0f1215'; g.fillRect(0, 0, w, h);
    const T = (x: number, z: number) => [w / 2 + (x - view.cx) * view.s, h / 2 + (z - view.cz) * view.s];
    const world = app.stage!.world;
    g.fillStyle = '#272c33';
    for (const b of world.buildings) {
      const [x0, z0] = T(b.pts[0][0], b.pts[0][1]);
      if (x0 < -50 || x0 > w + 50 || z0 < -50 || z0 > h + 50) continue;
      g.beginPath(); b.pts.forEach((p, i) => { const [a, c] = T(p[0], p[1]); if (i) g.lineTo(a, c); else g.moveTo(a, c); }); g.fill();
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of world.roads) {
      if (r.cls === 'path') continue;
      g.strokeStyle = r.bridge ? '#39d0ff' : r.cls === 'motorway' ? '#9aa3ad' : r.cls === 'trunk' ? '#80878f' : '#4b525a';
      g.lineWidth = Math.max(1, r.w * view.s * 0.8);
      g.beginPath(); r.pts.forEach((p, i) => { const [a, c] = T(p[0], p[1]); if (i) g.lineTo(a, c); else g.moveTo(a, c); }); g.stroke();
    }
    g.setLineDash([6, 5]); g.strokeStyle = '#8a6aa8'; g.lineWidth = 2;
    for (const r of world.rails) { g.beginPath(); r.pts.forEach((p, i) => { const [a, c] = T(p[0], p[1]); if (i) g.lineTo(a, c); else g.moveTo(a, c); }); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = '#c040c0';
    for (const t of world.terminals) { g.beginPath(); t.pts.forEach((p, i) => { const [a, c] = T(p[0], p[1]); if (i) g.lineTo(a, c); else g.moveTo(a, c); }); g.fill(); }
    // the selected route
    const P = (td as TrackData).paths[0].pts;
    g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 9;
    g.beginPath(); for (let i = 0; i < P.length; i += 6) { const [a, c] = T(P[i], P[i + 2]); if (i) g.lineTo(a, c); else g.moveTo(a, c); } g.closePath(); g.stroke();
    g.strokeStyle = '#f6c514'; g.lineWidth = 5; g.stroke();
    const [sx, sz] = T(P[0], P[2]); g.fillStyle = '#fff'; g.fillRect(sx - 5, sz - 5, 10, 10);
    g.font = '700 13px "Barlow Condensed", sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center';
    for (const t of world.terminals) { const [a, c] = T(t.centre[0], t.centre[1]); g.fillText(t.name.toUpperCase(), a, c + 4); }
  };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const ro = new ResizeObserver(redraw); ro.observe(canvas);
  // pan and zoom
  const pts = new Map<number, { x: number; y: number }>();
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  canvas.addEventListener('pointermove', (e) => {
    const p0 = pts.get(e.pointerId); if (!p0) return;
    if (pts.size === 1) { view.cx -= (e.clientX - p0.x) / view.s; view.cz -= (e.clientY - p0.y) / view.s; }
    else if (pts.size === 2) {
      const other = [...pts.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(p0.x - other.x, p0.y - other.y), d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      view.s = Math.min(4, Math.max(0.12, view.s * (d1 / (d0 || 1))));
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); redraw();
  });
  const up = (e: PointerEvent) => pts.delete(e.pointerId);
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.s = Math.min(4, Math.max(0.12, view.s * (e.deltaY < 0 ? 1.15 : 0.87))); redraw(); }, { passive: false });
  acts(node, {
    back: () => app.back(),
    track: (t) => { selTrack = t.dataset.id!; app.refresh(); },
    mark: (t) => { const l = LANDMARKS[+t.dataset.i!]; view.cx = l.x; view.cz = l.z; view.s = 1.6; redraw(); },
    design: () => goRoute('designer'),
  });
  return { el: node, view: 'map', onLeave: () => ro.disconnect() };
}
