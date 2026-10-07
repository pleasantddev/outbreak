// Procedural textures drawn on canvases at load: asphalt, concrete, laterite, corrugated roofing, glass curtain wall,
// perforated cladding, and the facade atlas that gives every Oshodi building its windows, shutters, balconies,
// laundry, shop fronts and painted wall warnings. Nothing here is a photo, so there is nothing to license.
import * as THREE from 'three';
import { Rng } from '../shared/rng';

export type Canvas = HTMLCanvasElement;
export function canvas(w: number, h = w): Canvas { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const ctx2d = (c: Canvas) => c.getContext('2d', { willReadFrequently: false })!;

/** Small random grayscale tile; drawn up-scaled it reads as soft value noise. */
function noiseTile(size: number, rng: Rng, lo = 0, hi = 255): Canvas {
  const c = canvas(size), g = ctx2d(c), img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) { const v = lo + (hi - lo) * rng.next(); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}

/** Layer tiled value noise octaves over a canvas with a blend mode. */
function noiseLayers(c: Canvas, rng: Rng, octaves: [number, number][], mode: GlobalCompositeOperation = 'overlay') {
  const g = ctx2d(c);
  g.save();
  g.globalCompositeOperation = mode;
  g.imageSmoothingEnabled = true;
  for (const [cells, alpha] of octaves) {
    const tile = noiseTile(cells, rng);
    const pat = g.createPattern(tile, 'repeat')!;
    const s = c.width / cells;
    pat.setTransform(new DOMMatrix().scaleSelf(s, s));
    g.globalAlpha = alpha;
    g.fillStyle = pat;
    g.fillRect(0, 0, c.width, c.height);
  }
  g.restore();
}

function speckle(c: Canvas, rng: Rng, count: number, colors: string[], size: [number, number]) {
  const g = ctx2d(c);
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[(rng.next() * colors.length) | 0];
    const s = size[0] + rng.next() * (size[1] - size[0]);
    g.fillRect(rng.next() * c.width, rng.next() * c.height, s, s);
  }
}

function crack(g: CanvasRenderingContext2D, rng: Rng, x: number, y: number, len: number, w: number, color: string) {
  g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y);
  let a = rng.range(0, Math.PI * 2);
  for (let i = 0; i < len; i++) { a += rng.range(-0.6, 0.6); x += Math.cos(a) * 6; y += Math.sin(a) * 6; g.lineTo(x, y); if (rng.chance(0.06)) crack(g, rng, x, y, len / 3, w * 0.6, color); }
  g.stroke();
}

/** Normal map from a canvas treated as a height field. */
export function normalFrom(c: Canvas, strength: number): Canvas {
  const w = c.width, h = c.height;
  const src = ctx2d(c).getImageData(0, 0, w, h).data;
  const out = canvas(w, h), og = ctx2d(out), img = og.createImageData(w, h);
  const H = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    img.data[i] = (dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  return out;
}

export function tex(c: Canvas, opts: { repeat?: boolean; srgb?: boolean; aniso?: number; mips?: boolean } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.repeat !== false) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 4;
  t.generateMipmaps = opts.mips !== false;
  t.minFilter = opts.mips === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------------------------------- surfaces

export function asphalt(size = 1024, seed = 1) {
  const rng = new Rng(seed);
  const c = canvas(size), g = ctx2d(c);
  g.fillStyle = '#3a3a3c'; g.fillRect(0, 0, size, size);
  noiseLayers(c, rng, [[8, 0.35], [32, 0.3], [128, 0.25], [512, 0.35]]);
  speckle(c, rng, size * 40, ['#55534f', '#2a2a2b', '#6a665e', '#4a4844'], [1, 2.2]);
  // patched repairs, oil stains, tyre polish
  for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(${rng.chance(0.5) ? '30,30,32' : '72,70,66'},${rng.range(0.2, 0.45)})`; const w = rng.range(40, 220), h = rng.range(30, 160); g.fillRect(rng.next() * size, rng.next() * size, w, h); }
  for (let i = 0; i < 18; i++) { const x = rng.next() * size, y = rng.next() * size, r = rng.range(8, 50); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(10,10,12,0.45)'); gr.addColorStop(1, 'rgba(10,10,12,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  for (let i = 0; i < 14; i++) crack(g, rng, rng.next() * size, rng.next() * size, rng.int(6, 22), rng.range(0.8, 2), 'rgba(18,18,18,0.75)');
  const rough = canvas(size / 2); const rg = ctx2d(rough);
  rg.fillStyle = '#d0d0d0'; rg.fillRect(0, 0, size / 2, size / 2);
  noiseLayers(rough, rng, [[16, 0.4], [64, 0.3]]);
  const height = canvas(size / 2); const hg = ctx2d(height);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, size / 2, size / 2);
  noiseLayers(height, rng, [[64, 0.5], [256, 0.6]]);
  return { map: c, rough, normal: normalFrom(height, 2.2) };
}

export function concrete(size = 512, seed = 2, base = '#a7a39b') {
  const rng = new Rng(seed);
  const c = canvas(size), g = ctx2d(c);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  noiseLayers(c, rng, [[4, 0.3], [16, 0.25], [64, 0.2], [256, 0.18]]);
  for (let i = 0; i < 26; i++) { const x = rng.next() * size; const gr = g.createLinearGradient(x, 0, x, size); gr.addColorStop(0, 'rgba(40,36,30,0.18)'); gr.addColorStop(1, 'rgba(40,36,30,0)'); g.fillStyle = gr; g.fillRect(x, 0, rng.range(3, 14), rng.range(40, size)); }
  for (let i = 0; i < 6; i++) crack(g, rng, rng.next() * size, rng.next() * size, rng.int(4, 12), 1, 'rgba(50,46,40,0.5)');
  return c;
}

export function laterite(size = 512, seed = 3) {
  const rng = new Rng(seed);
  const c = canvas(size), g = ctx2d(c);
  g.fillStyle = '#8a5434'; g.fillRect(0, 0, size, size);
  noiseLayers(c, rng, [[4, 0.4], [16, 0.35], [64, 0.25], [256, 0.3]]);
  speckle(c, rng, size * 22, ['#6e3e24', '#a36a44', '#5a3220', '#b98a62'], [1, 3]);
  // sparse dry grass tufts
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${rng.int(80, 120)},${rng.int(100, 130)},${rng.int(40, 60)},${rng.range(0.25, 0.6)})`; const x = rng.next() * size, y = rng.next() * size; for (let k = 0; k < 8; k++) g.fillRect(x + rng.range(-6, 6), y + rng.range(-6, 6), 1.5, rng.range(3, 7)); }
  return c;
}

export function grass(size = 512, seed = 4) {
  const rng = new Rng(seed);
  const c = canvas(size), g = ctx2d(c);
  g.fillStyle = '#5b6b2e'; g.fillRect(0, 0, size, size);
  noiseLayers(c, rng, [[4, 0.4], [16, 0.35], [64, 0.3], [256, 0.35]]);
  for (let i = 0; i < size * 6; i++) { g.fillStyle = `rgba(${rng.int(60, 130)},${rng.int(90, 140)},${rng.int(30, 60)},0.5)`; g.fillRect(rng.next() * size, rng.next() * size, 1, rng.range(2, 5)); }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(130,90,55,0.35)'; g.beginPath(); g.ellipse(rng.next() * size, rng.next() * size, rng.range(8, 30), rng.range(6, 20), rng.next() * 3, 0, Math.PI * 2); g.fill(); }
  return c;
}

export function paving(size = 512, seed = 5) {
  const rng = new Rng(seed);
  const c = canvas(size), g = ctx2d(c);
  g.fillStyle = '#9c968c'; g.fillRect(0, 0, size, size);
  // interlocking pavers, the standard Lagos walkway
  const s = size / 8;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = rng.range(-18, 18);
    g.fillStyle = `rgb(${150 + v},${144 + v},${134 + v})`;
    g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
  }
  noiseLayers(c, rng, [[16, 0.3], [128, 0.25]]);
  for (let i = 0; i < 30; i++) { const x = rng.next() * size, y = rng.next() * size, r = rng.range(10, 40); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(60,40,26,0.35)'); gr.addColorStop(1, 'rgba(60,40,26,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  return c;
}

/** Corrugated roofing: ridges in the height map, rust blooms in colour. Grey base, tinted per building. */
export function corrugated(size = 512, seed = 6) {
  const rng = new Rng(seed);
  const c = canvas(size), g = ctx2d(c);
  const ridges = 16;
  for (let x = 0; x < size; x++) { const v = 150 + Math.sin((x / size) * ridges * Math.PI * 2) * 55; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, size); }
  noiseLayers(c, rng, [[8, 0.3], [32, 0.2]]);
  // rust and dirt runs
  for (let i = 0; i < 40; i++) { const x = rng.next() * size, y = rng.next() * size, r = rng.range(10, 70); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${rng.int(110, 150)},${rng.int(50, 70)},${rng.int(20, 35)},${rng.range(0.35, 0.7)})`); gr.addColorStop(1, 'rgba(120,60,30,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(20,20,20,0.35)'; g.fillRect(0, rng.next() * size, size, 2); }
  const height = canvas(size / 2), hg = ctx2d(height);
  for (let x = 0; x < size / 2; x++) { const v = 128 + Math.sin((x / (size / 2)) * ridges * Math.PI * 2) * 120; hg.fillStyle = `rgb(${v},${v},${v})`; hg.fillRect(x, 0, 1, size / 2); }
  return { map: c, normal: normalFrom(height, 3) };
}

/** Terminal 3: a grid of blue reflective glass with silver mullions and the odd white spandrel panel. */
export function curtainGlass(size = 512, seed = 7) {
  const rng = new Rng(seed);
  const c = canvas(size), g = ctx2d(c);
  const n = 8, s = size / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const white = rng.chance(0.06);
    const gr = g.createLinearGradient(x * s, y * s, x * s + s, y * s + s);
    if (white) { gr.addColorStop(0, '#e8eef2'); gr.addColorStop(1, '#c9d2d8'); }
    else { const v = rng.range(-12, 12); gr.addColorStop(0, `rgb(${120 + v},${178 + v},${220 + v})`); gr.addColorStop(1, `rgb(${70 + v},${120 + v},${170 + v})`); }
    g.fillStyle = gr; g.fillRect(x * s, y * s, s, s);
  }
  g.fillStyle = '#d6dde2';
  for (let i = 0; i <= n; i++) { g.fillRect(i * s - 3, 0, 6, size); g.fillRect(0, i * s - 3, size, 6); }
  const rough = canvas(64), rg = ctx2d(rough);
  rg.fillStyle = '#202020'; rg.fillRect(0, 0, 64, 64);
  return { map: c, rough };
}

/** Terminal 2 and 1: grey-white perforated aluminium panels. */
export function perforated(size = 512, seed = 8, base = '#d9dcdd') {
  const rng = new Rng(seed);
  const c = canvas(size), g = ctx2d(c);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const n = 4, s = size / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = rng.range(-10, 10); g.fillStyle = `rgba(${128 + v},${128 + v},${128 + v},0.12)`; g.fillRect(x * s, y * s, s, s); }
  g.fillStyle = 'rgba(60,64,66,0.55)';
  for (let y = 4; y < size; y += 8) for (let x = (y / 8) % 2 ? 8 : 4; x < size; x += 8) { g.beginPath(); g.arc(x, y, 1.7, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = 'rgba(40,44,46,0.6)';
  for (let i = 0; i <= n; i++) { g.fillRect(i * s - 1.5, 0, 3, size); g.fillRect(0, i * s - 1.5, size, 3); }
  noiseLayers(c, rng, [[8, 0.12], [32, 0.08]]);
  return c;
}

/** Dark vertical louvre fins, for the round terminal's skin. */
export function louvres(size = 256, seed = 9) {
  const rng = new Rng(seed);
  const c = canvas(size), g = ctx2d(c);
  g.fillStyle = '#1c1f22'; g.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 16) { const gr = g.createLinearGradient(x, 0, x + 12, 0); gr.addColorStop(0, '#5a6066'); gr.addColorStop(0.5, '#3a3f44'); gr.addColorStop(1, '#22262a'); g.fillStyle = gr; g.fillRect(x, 0, 12, size); }
  g.fillStyle = 'rgba(0,0,0,0.5)'; for (let y = 0; y < size; y += 64) g.fillRect(0, y, size, 4);
  noiseLayers(c, rng, [[8, 0.1]]);
  return c;
}

/** Black and white striped kerb, plus yellow and black for hazard edges. */
export function stripes(a: string, b: string, n = 4, size = 256) {
  const c = canvas(size, 64), g = ctx2d(c);
  for (let i = 0; i < n * 2; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * size) / (n * 2), 0, size / (n * 2) + 1, 64); }
  const rng = new Rng(n * 13);
  noiseLayers(c, rng, [[8, 0.15], [32, 0.12]], 'multiply');
  return c;
}

/** A wire fence or railing panel with alpha. */
export function meshPanel(color: string, size = 256) {
  const c = canvas(size), g = ctx2d(c);
  g.clearRect(0, 0, size, size);
  g.strokeStyle = color; g.lineWidth = 2;
  for (let i = -size; i < size * 2; i += 14) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + size, size); g.stroke(); g.beginPath(); g.moveTo(i, size); g.lineTo(i + size, 0); g.stroke(); }
  g.lineWidth = 8; g.strokeRect(4, 4, size - 8, size - 8);
  return c;
}

// ------------------------------------------------------------------------------------------- facade atlas

export const ATLAS_CELLS = 8;   // 8 x 8 styles
export const FACADE_ROWS = { louvre: 0, shutter: 1, balcony: 2, shop: 3, office: 4, industrial: 5, blank: 6, ground: 7 } as const;
export type FacadeRow = keyof typeof FACADE_ROWS;

const WALL_WORDS = ['THIS HOUSE IS NOT FOR SALE', 'POST NO BILL', 'BEWARE OF 419', 'NO PARKING', 'DO NOT URINATE HERE', 'PURE WATER SOLD HERE', 'GOD DEY', 'NO WAHALA', 'TAILOR INSIDE', 'VULCANISER'];

/**
 * Two canvases with the same layout. Colour carries the look. The mask's red channel marks plaster that takes the
 * building's paint colour, green marks glass that can light up at night.
 */
export function facadeAtlas(size = 2048, seed = 11) {
  const rng = new Rng(seed);
  const col = canvas(size), mask = canvas(size);
  const g = ctx2d(col), m = ctx2d(mask);
  const cs = size / ATLAS_CELLS;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
  m.fillStyle = '#ff0000'; m.fillRect(0, 0, size, size);
  // plaster texture over everything that will be tinted
  noiseLayers(col, rng, [[16, 0.18], [64, 0.14], [256, 0.12]], 'multiply');
  const rect = (x: number, y: number, w: number, h: number, c: string, mc: string) => { g.fillStyle = c; g.fillRect(x, y, w, h); m.fillStyle = mc; m.fillRect(x, y, w, h); };
  const shade = (x: number, y: number, w: number, h: number, a: number) => { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(x, y, w, h); };
  const glass = (x: number, y: number, w: number, h: number, tint: string) => {
    const gr = g.createLinearGradient(x, y, x + w * 0.3, y + h);
    gr.addColorStop(0, tint); gr.addColorStop(0.55, '#1a2026'); gr.addColorStop(1, '#2c343c');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    m.fillStyle = '#00ff00'; m.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.moveTo(x, y + h * 0.2); g.lineTo(x + w * 0.4, y); g.lineTo(x + w * 0.55, y); g.lineTo(x, y + h * 0.45); g.fill();
  };
  const bars = (x: number, y: number, w: number, h: number) => { g.fillStyle = '#2a2a2a'; for (let i = 1; i < 6; i++) g.fillRect(x + (w * i) / 6 - 1.5, y, 3, h); for (let i = 1; i < 4; i++) g.fillRect(x, y + (h * i) / 4 - 1.5, w, 3); };
  const stains = (x: number, y: number, w: number, h: number) => {
    for (let i = 0; i < 5; i++) { const sx = x + rng.next() * w; const gr = g.createLinearGradient(sx, y, sx, y + h); gr.addColorStop(0, 'rgba(60,50,40,0.25)'); gr.addColorStop(1, 'rgba(60,50,40,0)'); g.fillStyle = gr; g.fillRect(sx, y, rng.range(4, 16), h * rng.range(0.3, 1)); }
    const gr = g.createLinearGradient(0, y + h * 0.75, 0, y + h); gr.addColorStop(0, 'rgba(90,60,40,0)'); gr.addColorStop(1, 'rgba(110,70,40,0.35)'); g.fillStyle = gr; g.fillRect(x, y + h * 0.75, w, h * 0.25);
  };
  const frameColors = ['#f2f0ea', '#3c6e8f', '#2f6b3a', '#7a2a22', '#e3e0d6', '#5a4a3a', '#c9a227', '#ffffff'];

  for (let row = 0; row < ATLAS_CELLS; row++) for (let k = 0; k < ATLAS_CELLS; k++) {
    const x0 = k * cs, y0 = row * cs;
    const fc = frameColors[(row * 3 + k) % frameColors.length];
    if (row === FACADE_ROWS.louvre || row === FACADE_ROWS.shutter) {
      // window centred, sill and lintel band
      const ww = cs * rng.range(0.38, 0.5), wh = cs * rng.range(0.42, 0.52), wx = x0 + (cs - ww) / 2, wy = y0 + cs * 0.22;
      rect(wx - 6, wy - 6, ww + 12, wh + 12, fc, '#000000');
      if (row === FACADE_ROWS.louvre) {
        glass(wx, wy, ww, wh, '#4a5866');
        g.fillStyle = 'rgba(210,220,225,0.55)';
        for (let yy = wy + 6; yy < wy + wh; yy += 9) g.fillRect(wx + 2, yy, ww - 4, 4); // glass louvre blades
        if (k % 3 === 0) { g.fillStyle = ['#b33a3a', '#e0b030', '#3a6ab3'][k % 3]; g.globalAlpha = 0.7; g.fillRect(wx + ww * 0.55, wy, ww * 0.45, wh); g.globalAlpha = 1; } // curtain
        if (k % 2 === 0) bars(wx, wy, ww, wh);
      } else {
        const paint = ['#6b8c9e', '#5f7d4a', '#8a7a62', '#a0a0a0', '#3d5a7a', '#7a4a3a', '#9a8a5a', '#556b6b'][k];
        const open = k % 3 === 1;
        if (open) { glass(wx, wy, ww, wh, '#2a3036'); }
        for (let side = 0; side < 2; side++) {
          const sx = open ? (side ? wx + ww : wx - ww * 0.5) : wx + side * ww / 2;
          const sw = open ? ww * 0.5 : ww / 2;
          rect(sx, wy, sw, wh, paint, '#000000');
          g.fillStyle = 'rgba(0,0,0,0.28)'; for (let yy = wy + 4; yy < wy + wh; yy += 7) g.fillRect(sx + 3, yy, sw - 6, 2);
          shade(sx, wy, 2, wh, 0.4);
        }
      }
      rect(wx - 10, wy + wh + 6, ww + 20, 8, '#cfc9bd', '#000000');
      stains(x0, y0, cs, cs);
    } else if (row === FACADE_ROWS.balcony) {
      const ww = cs * 0.62, wh = cs * 0.5, wx = x0 + (cs - ww) / 2, wy = y0 + cs * 0.12;
      glass(wx, wy, ww * 0.45, wh, '#3a4652');
      rect(wx + ww * 0.5, wy, ww * 0.5, wh + cs * 0.16, '#5a4632', '#000000'); // door
      shade(x0, y0 + cs * 0.62, cs, cs * 0.06, 0.45);
      rect(x0 + 4, y0 + cs * 0.68, cs - 8, 6, '#2d2d2d', '#000000');
      g.fillStyle = '#2d2d2d'; m.fillStyle = '#000000';
      for (let xx = x0 + 10; xx < x0 + cs - 6; xx += 12) { g.fillRect(xx, y0 + cs * 0.68, 3, cs * 0.24); m.fillRect(xx, y0 + cs * 0.68, 3, cs * 0.24); }
      rect(x0 + 4, y0 + cs * 0.92, cs - 8, 6, '#2d2d2d', '#000000');
      if (k % 2 === 0) { // laundry on a line
        g.strokeStyle = '#555'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0 + 10, y0 + cs * 0.58); g.lineTo(x0 + cs - 10, y0 + cs * 0.6); g.stroke();
        for (let i = 0; i < 5; i++) { const lc = ['#d23a3a', '#2a6ad2', '#f2c230', '#ffffff', '#2aa84a', '#d25aa8'][(i + k) % 6]; rect(x0 + 18 + i * 42, y0 + cs * 0.585, rng.range(18, 32), rng.range(22, 44), lc, '#000000'); }
      }
      if (k % 3 === 1) { rect(x0 + cs * 0.12, y0 + cs * 0.6, 20, 18, '#3a7a2a', '#000000'); rect(x0 + cs * 0.12 + 6, y0 + cs * 0.66, 9, 10, '#8a4a2a', '#000000'); } // potted plant
      stains(x0, y0, cs, cs);
    } else if (row === FACADE_ROWS.shop) {
      // roller shutter or open front with goods, sign band left plaster (signs are separate quads)
      const sx = x0 + cs * 0.08, sw = cs * 0.84, sy = y0 + cs * 0.3, sh = cs * 0.7;
      const open = k % 2 === 1;
      if (open) {
        rect(sx, sy, sw, sh, '#14161a', '#000000');
        const goods = [['#e63946', '#f1c40f', '#2a9d8f'], ['#3a86ff', '#ffbe0b', '#fb5607'], ['#8338ec', '#ff006e', '#06d6a0']][k % 3];
        for (let i = 0; i < 26; i++) rect(sx + rng.next() * (sw - 20), sy + sh * rng.range(0.15, 0.85), rng.range(8, 22), rng.range(8, 30), goods[i % 3], '#000000');
        m.fillStyle = '#00ff00'; m.fillRect(sx, sy, sw, sh * 0.4);
        rect(sx, sy + sh * 0.82, sw, sh * 0.18, '#6a5a48', '#000000');
      } else {
        rect(sx, sy, sw, sh, '#9aa0a6', '#000000');
        g.fillStyle = 'rgba(0,0,0,0.25)'; for (let yy = sy + 3; yy < sy + sh; yy += 6) g.fillRect(sx, yy, sw, 2);
        if (k % 4 === 0) { g.fillStyle = 'rgba(30,30,30,0.85)'; g.font = `bold ${cs * 0.07}px sans-serif`; g.fillText(['CLOSED', 'NO CREDIT TODAY', 'GOD DEY', 'SHOP TO LET'][(k / 4) % 4 | 0], sx + 12, sy + sh * 0.5); }
        g.fillStyle = 'rgba(120,70,40,0.4)'; g.fillRect(sx, sy + sh * 0.85, sw, sh * 0.15);
      }
      rect(x0, sy - 6, cs, 6, '#3a3a3a', '#000000');
      stains(x0, y0, cs, cs);
    } else if (row === FACADE_ROWS.office) {
      const band = cs * rng.range(0.42, 0.6);
      glass(x0, y0 + cs * 0.2, cs, band, ['#5b7b98', '#46607a', '#6a8aa0', '#3e5a6e'][k % 4]);
      g.fillStyle = '#c8ccd0'; m.fillStyle = '#000000';
      for (let xx = 0; xx <= cs; xx += cs / (k % 2 ? 4 : 3)) { g.fillRect(x0 + xx - 2, y0 + cs * 0.2, 4, band); m.fillRect(x0 + xx - 2, y0 + cs * 0.2, 4, band); }
      if (k > 4) rect(x0, y0 + cs * 0.2 + band, cs, cs * 0.12, '#b8bcc0', '#000000');
      stains(x0, y0, cs, cs * 0.6);
    } else if (row === FACADE_ROWS.industrial) {
      const clad = k % 2 === 0;
      if (clad) { const base = ['#9aa3a8', '#b8b0a0', '#7a8a94', '#a89878'][k % 4]; for (let xx = 0; xx < cs; xx += 10) rect(x0 + xx, y0, 10, cs, xx % 20 ? base : '#000000', '#000000'); g.fillStyle = 'rgba(255,255,255,0.12)'; for (let xx = 0; xx < cs; xx += 20) g.fillRect(x0 + xx, y0, 4, cs); }
      glass(x0 + cs * 0.15, y0 + cs * 0.08, cs * 0.7, cs * 0.16, '#5a6670');
      if (k % 3 === 0) { rect(x0 + cs * 0.1, y0 + cs * 0.4, cs * 0.8, cs * 0.6, '#6a7076', '#000000'); g.fillStyle = 'rgba(0,0,0,0.3)'; for (let yy = y0 + cs * 0.4; yy < y0 + cs; yy += 8) g.fillRect(x0 + cs * 0.1, yy, cs * 0.8, 2); }
      stains(x0, y0, cs, cs);
    } else if (row === FACADE_ROWS.blank) {
      stains(x0, y0, cs, cs);
      if (k < 3) { // breeze block screen
        const bx = x0 + cs * 0.1, by = y0 + cs * 0.25, bw = cs * 0.8, bh = cs * 0.5;
        g.fillStyle = 'rgba(0,0,0,0.55)'; m.fillStyle = '#000000';
        for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 6; xx++) { const cx = bx + (xx + 0.5) * bw / 6, cy = by + (yy + 0.5) * bh / 4; g.beginPath(); g.arc(cx, cy, bw / 18, 0, Math.PI * 2); g.fill(); }
      } else if (k < 7) {
        g.fillStyle = ['#b81d1d', '#1d3fb8', '#111111', '#1d7a2a'][k % 4];
        g.font = `bold ${cs * 0.085}px sans-serif`;
        const words = WALL_WORDS[(k + row) % WALL_WORDS.length].split(' ');
        const lines: string[] = []; let cur = '';
        for (const w of words) { if ((cur + ' ' + w).length > 12 && cur) { lines.push(cur); cur = w; } else cur = (cur ? cur + ' ' : '') + w; }
        lines.push(cur);
        lines.forEach((ln, i) => { g.save(); g.translate(x0 + 14, y0 + cs * 0.38 + i * cs * 0.11); g.rotate(rng.range(-0.04, 0.04)); g.fillText(ln, 0, 0); g.restore(); });
      }
    } else if (row === FACADE_ROWS.ground) {
      const door = k % 2 === 0;
      if (door) { rect(x0 + cs * 0.3, y0 + cs * 0.3, cs * 0.4, cs * 0.7, ['#5a3a22', '#2a4a6a', '#3a5a3a', '#6a2a2a'][k % 4], '#000000'); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x0 + cs * 0.34, y0 + cs * 0.36, cs * 0.14, cs * 0.26); g.fillRect(x0 + cs * 0.52, y0 + cs * 0.36, cs * 0.14, cs * 0.26); }
      else { // gate in a fence wall
        rect(x0 + cs * 0.05, y0 + cs * 0.25, cs * 0.9, cs * 0.75, '#1e2a36', '#000000');
        g.fillStyle = '#3a4a5a'; for (let xx = x0 + cs * 0.07; xx < x0 + cs * 0.93; xx += 10) g.fillRect(xx, y0 + cs * 0.27, 4, cs * 0.7);
        rect(x0 + cs * 0.05, y0 + cs * 0.22, cs * 0.9, 8, '#1e2a36', '#000000');
      }
      stains(x0, y0, cs, cs);
    }
  }
  return { col, mask };
}
