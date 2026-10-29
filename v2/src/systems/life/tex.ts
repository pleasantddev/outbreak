// Small procedural textures for interiors and street furniture: painted plaster, floor tiles, vinyl lino,
// wood, ankara fabric, terrazzo. Canvas-made so they cost nothing to download.
import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();
function canvas(n: number) { const c = document.createElement('canvas'); c.width = c.height = n; return [c, c.getContext('2d')!] as const; }
function finish(key: string, c: HTMLCanvasElement, rep = 1) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4;
  cache.set(key, t); return t;
}
const rnd = (s: number) => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

/** Painted plaster with roller marks, a dirty skirting band and the odd water stain. */
export function plaster(hex: string, seed = 3) {
  const key = 'pl' + hex + seed; if (cache.has(key)) return cache.get(key)!;
  const [c, g] = canvas(512); const r = rnd(seed * 7919 + 11);
  g.fillStyle = hex; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) { const v = r(); g.fillStyle = v > 0.5 ? `rgba(255,255,255,${r() * 0.05})` : `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * 512, r() * 512, 2 + r() * 14, 1 + r() * 3); }
  for (let i = 0; i < 5; i++) { const x = r() * 512, y = r() * 300; const grd = g.createRadialGradient(x, y, 4, x, y, 30 + r() * 60); grd.addColorStop(0, 'rgba(90,70,40,0.10)'); grd.addColorStop(1, 'rgba(90,70,40,0)'); g.fillStyle = grd; g.fillRect(0, 0, 512, 512); }
  const sk = g.createLinearGradient(0, 430, 0, 512); sk.addColorStop(0, 'rgba(40,30,20,0)'); sk.addColorStop(1, 'rgba(40,30,20,0.22)'); g.fillStyle = sk; g.fillRect(0, 400, 512, 112);
  return finish(key, c);
}

/** Square ceramic tiles with grout. */
export function tiles(hex: string, grout = '#cfc8bb', n = 8, seed = 5) {
  const key = 'ti' + hex + grout + n; if (cache.has(key)) return cache.get(key)!;
  const [c, g] = canvas(512); const r = rnd(seed); const s = 512 / n;
  g.fillStyle = grout; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const col = new THREE.Color(hex).offsetHSL(0, 0, (r() - 0.5) * 0.05); g.fillStyle = '#' + col.getHexString();
    g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(i * s + 3, j * s + 3, s - 8, 3);
  }
  return finish(key, c);
}

/** Patterned vinyl lino, the floor of half the rooms in Lagos. */
export function lino(seed = 9) {
  const key = 'li' + seed; if (cache.has(key)) return cache.get(key)!;
  const [c, g] = canvas(512); const r = rnd(seed);
  g.fillStyle = '#7a3b2c'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const x = i * 128 + 64, y = j * 128 + 64;
    g.strokeStyle = '#d9b26a'; g.lineWidth = 5; g.beginPath(); g.moveTo(x, y - 56); g.lineTo(x + 56, y); g.lineTo(x, y + 56); g.lineTo(x - 56, y); g.closePath(); g.stroke();
    g.fillStyle = '#2d5a6b'; g.beginPath(); g.arc(x, y, 18, 0, 6.28); g.fill();
    g.strokeStyle = '#e8dcc0'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 30, 0, 6.28); g.stroke();
  }
  for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.07})`; g.fillRect(r() * 512, r() * 512, 3 + r() * 20, 1 + r() * 2); }
  return finish(key, c, 1);
}

/** Wood planks. */
export function wood(hex = '#6b4a2f', seed = 13) {
  const key = 'wo' + hex + seed; if (cache.has(key)) return cache.get(key)!;
  const [c, g] = canvas(256); const r = rnd(seed);
  g.fillStyle = hex; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(30,15,5,${0.05 + r() * 0.12})`; g.lineWidth = 1 + r() * 2; const y = r() * 256; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(80, y + (r() - 0.5) * 12, 170, y + (r() - 0.5) * 12, 256, y + (r() - 0.5) * 8); g.stroke(); }
  for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(20,10,4,0.35)'; g.fillRect(0, k * 64, 256, 2); }
  return finish(key, c);
}

/** Ankara wax print: concentric rings and leaves in two colourways. */
export function ankara(a = '#e0a526', b = '#1f4e79', seed = 21) {
  const key = 'an' + a + b + seed; if (cache.has(key)) return cache.get(key)!;
  const [c, g] = canvas(256); const r = rnd(seed);
  g.fillStyle = b; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const x = i * 86 + 43 + (j % 2) * 20, y = j * 86 + 43;
    for (let k = 4; k > 0; k--) { g.fillStyle = k % 2 ? a : '#f3ead8'; g.beginPath(); g.arc(x, y, k * 9, 0, 6.28); g.fill(); }
    g.fillStyle = '#b23a2a'; g.beginPath(); g.ellipse(x + 34, y - 30, 12, 5, r() * 3, 0, 6.28); g.fill();
  }
  return finish(key, c);
}

/** Terrazzo for shops and compounds. */
export function terrazzo(seed = 31) {
  const key = 'te' + seed; if (cache.has(key)) return cache.get(key)!;
  const [c, g] = canvas(512); const r = rnd(seed);
  g.fillStyle = '#d7d1c4'; g.fillRect(0, 0, 512, 512);
  const cols = ['#8a7f6d', '#3d3a35', '#b9a27a', '#f2efe8', '#6e5b47'];
  for (let i = 0; i < 2600; i++) { g.fillStyle = cols[(r() * cols.length) | 0]; const s = 1 + r() * 5; g.beginPath(); g.ellipse(r() * 512, r() * 512, s, s * (0.5 + r() * 0.6), r() * 3, 0, 6.28); g.fill(); }
  return finish(key, c);
}
