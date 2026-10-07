// Small track maps for cards and the minimap style thumbnails.
import type { TrackData } from '../shared/track';

export function drawTrackThumb(c: HTMLCanvasElement, td: TrackData, opts: { color?: string; bg?: string; line?: number } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth || 240, h = c.clientHeight || 110;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  g.fillStyle = opts.bg ?? '#0e1012'; g.fillRect(0, 0, w, h);
  const P = td.paths[0].pts;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
  const s = Math.min((w - 20) / (x1 - x0), (h - 20) / (z1 - z0));
  const ox = (w - (x1 - x0) * s) / 2, oz = (h - (z1 - z0) * s) / 2;
  const T = (x: number, z: number) => [ox + (x - x0) * s, oz + (z - z0) * s];
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < P.length; i += 9) { const [a, b] = T(P[i], P[i + 2]); if (i) g.lineTo(a, b); else g.moveTo(a, b); }
  g.closePath();
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = (opts.line ?? 4) + 4; g.stroke();
  // elevated sections in a brighter tone, so the bridges show
  g.strokeStyle = opts.color ?? '#f6c514'; g.lineWidth = opts.line ?? 4; g.stroke();
  g.strokeStyle = '#39d0ff';
  g.beginPath();
  let on = false;
  for (let i = 0; i < P.length; i += 9) {
    const [a, b] = T(P[i], P[i + 2]);
    if (P[i + 1] > 4) { if (!on) { g.moveTo(a, b); on = true; } else g.lineTo(a, b); } else on = false;
  }
  g.stroke();
  const [sx, sz] = T(P[0], P[2]);
  g.fillStyle = '#fff'; g.fillRect(sx - 4, sz - 4, 8, 8);
}
