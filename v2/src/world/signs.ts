// Text signboards: a shared canvas atlas of plain-text name plates (bank names, station names, terminal names).
// No logos or trademark artwork, only the name in a neutral typeface on a coloured plate.
import * as THREE from 'three';
import { hash } from './geo';

const CW = 512, CH = 96, COLS = 4, ROWS = 21;
export interface SignUV { u0: number; v0: number; u1: number; v1: number }
let canvas: HTMLCanvasElement | null = null, ctx: CanvasRenderingContext2D | null = null, tex: THREE.CanvasTexture | null = null;
const slots = new Map<string, SignUV>(); let next = 0;
export const signShared = { uNight: { value: 0 } };
let mat: THREE.MeshStandardMaterial | null = null;

const PLATES: [string, string][] = [['#0b4f2b', '#ffffff'], ['#0a3d7a', '#ffffff'], ['#a3171d', '#ffffff'], ['#1c1c1f', '#f4c542'], ['#5b2a86', '#ffffff'], ['#d9731a', '#ffffff'], ['#0e6e78', '#ffffff'], ['#f2f2ee', '#14315c'], ['#7a1230', '#ffffff'], ['#233f8f', '#ffd23f']];

function init() {
  if (canvas) return;
  canvas = document.createElement('canvas'); canvas.width = CW * COLS; canvas.height = CH * ROWS;
  ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#222'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.flipY = false;
}

/** Atlas cell for this text. `plate` picks the colour scheme (hashed from the text when omitted). */
export function signUV(text: string, plate?: number): SignUV {
  init();
  const key = text + '|' + (plate ?? '');
  const hit = slots.get(key); if (hit) return hit;
  const idx = next++ % (COLS * ROWS); const cx = (idx % COLS) * CW, cy = Math.floor(idx / COLS) * CH;
  const sc = PLATES[Math.floor((plate ?? hash(text.length * 131 + text.charCodeAt(0) * 17 + text.charCodeAt(text.length - 1), 7)) * PLATES.length) % PLATES.length] ?? PLATES[0];
  const g = ctx!;
  g.fillStyle = sc[0]; g.fillRect(cx, cy, CW, CH);
  g.strokeStyle = sc[1]; g.globalAlpha = 0.5; g.lineWidth = 3; g.strokeRect(cx + 6, cy + 6, CW - 12, CH - 12); g.globalAlpha = 1;
  const t = text.toUpperCase();
  let fs = 58; g.font = `700 ${fs}px Oswald, "Arial Narrow", Arial, sans-serif`;
  while (g.measureText(t).width > CW - 40 && fs > 18) { fs -= 2; g.font = `700 ${fs}px Oswald, "Arial Narrow", Arial, sans-serif`; }
  g.fillStyle = sc[1]; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, cx + CW / 2, cy + CH / 2 + 3);
  tex!.needsUpdate = true;
  const uv = { u0: cx / canvas!.width, v0: cy / canvas!.height, u1: (cx + CW) / canvas!.width, v1: (cy + CH) / canvas!.height };
  slots.set(key, uv); return uv;
}
export const SIGN_ASPECT = CW / CH;

export function signMaterial() {
  init();
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ map: tex!, roughness: 0.55, metalness: 0.1, emissive: new THREE.Color(0xffffff), emissiveMap: tex!, emissiveIntensity: 0, side: THREE.DoubleSide });
  }
  return mat;
}
export function setSignNight(n: number) { if (mat) mat.emissiveIntensity = n * 0.9; }
