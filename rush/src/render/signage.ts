// Every printed thing in the world, drawn on canvases: billboard creatives for fictional brands, the house
// "ADVERTISE WITH US" board fed by the ad slot config, campaign fliers, road signs and shop signboards.
import * as THREE from 'three';
import { canvas, tex } from './textures';
import { Rng } from '../shared/rng';

const F = (w: number, size: number, family = 'Barlow Condensed') => `${w} ${size}px "${family}", "Arial Narrow", sans-serif`;

export interface Creative { id: string; draw: (g: CanvasRenderingContext2D, W: number, H: number) => void }

function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(' '); let line = ''; let yy = y;
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { g.fillText(line, x, yy); line = w; yy += lh; } else line = t; }
  if (line) g.fillText(line, x, yy);
}

/** Fictional brands only. Shapes and type, no photos, no real logos. */
export const CREATIVES: Creative[] = [
  { id: 'jollof', draw: (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#ff5a1f'); gr.addColorStop(1, '#c41d0e'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffd34d'; g.beginPath(); g.ellipse(W * 0.78, H * 0.62, W * 0.17, H * 0.26, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8481c'; for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(W * 0.66 + Math.random() * W * 0.24, H * 0.5 + Math.random() * H * 0.22, 6, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#fff'; g.font = F(800, H * 0.3); g.fillText('JOLLOF ROYALE', W * 0.05, H * 0.42);
    g.font = F(600, H * 0.13); g.fillText('PARTY RICE. EVERY DAY.', W * 0.05, H * 0.66);
    g.fillStyle = '#ffd34d'; g.font = F(700, H * 0.09); g.fillText('NOW IN 5KG BAGS', W * 0.05, H * 0.86);
  } },
  { id: 'zobo', draw: (g, W, H) => {
    g.fillStyle = '#5a0f2e'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#b3154f'; g.beginPath(); g.arc(W * 0.85, H * 0.3, H * 0.55, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2e6ea'; g.beginPath(); g.roundRect(W * 0.74, H * 0.18, W * 0.09, H * 0.7, 18); g.fill();
    g.fillStyle = '#8a0f3a'; g.fillRect(W * 0.745, H * 0.4, W * 0.08, H * 0.28);
    g.fillStyle = '#fff'; g.font = F(800, H * 0.32); g.fillText('ZOBO FIZZ', W * 0.05, H * 0.45);
    g.font = F(600, H * 0.12); g.fillText('COLD ZOBO. REAL HIBISCUS.', W * 0.05, H * 0.66);
    g.fillStyle = '#ffb3cf'; g.font = F(500, H * 0.08); g.fillText('KEEP AM COLD', W * 0.05, H * 0.85);
  } },
  { id: 'ekolink', draw: (g, W, H) => {
    g.fillStyle = '#ffcc00'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111'; g.font = F(800, H * 0.34); g.fillText('EKOLINK 5G', W * 0.05, H * 0.45);
    g.font = F(700, H * 0.12); g.fillText('FASTER THAN THIRD MAINLAND AT 3AM', W * 0.05, H * 0.68);
    for (let i = 0; i < 4; i++) { g.fillRect(W * (0.8 + i * 0.04), H * (0.7 - i * 0.12), W * 0.025, H * (0.12 + i * 0.12)); }
    g.font = F(600, H * 0.08); g.fillText('DIAL *555# TO JOIN', W * 0.05, H * 0.88);
  } },
  { id: 'gidipay', draw: (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#003d3a'); gr.addColorStop(1, '#00a676'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#fff'; g.lineWidth = 8; g.beginPath(); g.roundRect(W * 0.8, H * 0.12, W * 0.11, H * 0.76, 16); g.stroke();
    g.fillStyle = '#7dffcc'; g.font = F(800, H * 0.16); g.fillText('N', W * 0.835, H * 0.56);
    g.fillStyle = '#fff'; g.font = F(800, H * 0.32); g.fillText('GIDIPAY', W * 0.05, H * 0.45);
    g.font = F(600, H * 0.115); wrapText(g, 'SEND MONEY BEFORE THE LIGHT TURNS GREEN', W * 0.05, H * 0.66, W * 0.7, H * 0.13);
  } },
  { id: 'suya', draw: (g, W, H) => {
    g.fillStyle = '#1a1210'; g.fillRect(0, 0, W, H);
    const gr = g.createRadialGradient(W * 0.82, H, 10, W * 0.82, H, H); gr.addColorStop(0, '#ff9a1f'); gr.addColorStop(1, 'rgba(255,80,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c8a070'; g.lineWidth = 6; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(W * 0.7, H * (0.3 + i * 0.15)); g.lineTo(W * 0.95, H * (0.25 + i * 0.15)); g.stroke(); }
    g.fillStyle = '#7a2a12'; for (let i = 0; i < 3; i++) for (let k = 0; k < 5; k++) g.fillRect(W * (0.72 + k * 0.045), H * (0.26 + i * 0.15), W * 0.03, H * 0.07);
    g.fillStyle = '#ffb347'; g.font = F(800, H * 0.32); g.fillText('SUYA KINGS', W * 0.05, H * 0.45);
    g.fillStyle = '#fff'; g.font = F(600, H * 0.13); g.fillText('PEPPER WEY SWEET', W * 0.05, H * 0.68);
    g.font = F(500, H * 0.08); g.fillText('OPEN TILL 2AM . OSHODI . IKEJA . YABA', W * 0.05, H * 0.87);
  } },
  { id: 'danfodash', draw: (g, W, H) => {
    g.fillStyle = '#f6c514'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111'; g.fillRect(0, H * 0.72, W, H * 0.06); g.fillRect(0, H * 0.82, W, H * 0.03);
    g.font = F(800, H * 0.3); g.fillText('DANFO DASH', W * 0.05, H * 0.42);
    g.font = F(700, H * 0.12); g.fillText('PARCELS ACROSS LAGOS IN 3 HOURS', W * 0.05, H * 0.62);
    g.beginPath(); g.roundRect(W * 0.78, H * 0.18, W * 0.17, H * 0.36, 10); g.fill(); g.fillStyle = '#f6c514'; g.fillRect(W * 0.8, H * 0.22, W * 0.13, H * 0.12);
  } },
  { id: 'afrogroove', draw: (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#3b0a6b'); gr.addColorStop(1, '#ff2d8a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 5; g.beginPath();
    for (let x = 0; x < W * 0.3; x += 6) { const y = H * 0.5 + Math.sin(x * 0.08) * Math.sin(x * 0.013) * H * 0.3; if (x === 0) g.moveTo(W * 0.68 + x, y); else g.lineTo(W * 0.68 + x, y); }
    g.stroke();
    g.fillStyle = '#fff'; g.font = F(800, H * 0.3); g.fillText('AFROGROOVE 99.1', W * 0.05, H * 0.42);
    g.font = F(600, H * 0.12); g.fillText('THE SOUND OF LAGOS TRAFFIC', W * 0.05, H * 0.64);
    g.fillStyle = '#ffd1e6'; g.font = F(500, H * 0.085); g.fillText('DRIVE TIME WITH DJ KAYODE . 4 TO 8PM', W * 0.05, H * 0.85);
  } },
  { id: 'shield', draw: (g, W, H) => {
    g.fillStyle = '#0e2350'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2f6bff'; g.beginPath(); g.moveTo(W * 0.85, H * 0.12); g.lineTo(W * 0.95, H * 0.22); g.lineTo(W * 0.93, H * 0.6); g.lineTo(W * 0.85, H * 0.86); g.lineTo(W * 0.77, H * 0.6); g.lineTo(W * 0.75, H * 0.22); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.font = F(800, H * 0.27); g.fillText('NAIJA SHIELD', W * 0.05, H * 0.4);
    g.font = F(600, H * 0.115); g.fillText('CAR INSURANCE THAT ACTUALLY PAYS', W * 0.05, H * 0.6);
    g.fillStyle = '#9ec0ff'; g.font = F(500, H * 0.085); g.fillText('BECAUSE OKADA NO DEY GIVE WARNING', W * 0.05, H * 0.82);
  } },
  { id: 'owambe', draw: (g, W, H) => {
    g.fillStyle = '#2a1a0a'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(230,190,90,0.5)'; g.lineWidth = 2; for (let x = 0; x < W; x += 28) for (let y = 0; y < H; y += 28) { g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#e6be5a'; g.font = F(800, H * 0.3); g.fillText('OWAMBE LACE', W * 0.05, H * 0.44);
    g.fillStyle = '#fff'; g.font = F(600, H * 0.12); g.fillText('FABRICS FOR EVERY PARTY', W * 0.05, H * 0.65);
    g.font = F(500, H * 0.085); g.fillText('ASO EBI ORDERS WELCOME', W * 0.05, H * 0.85);
  } },
  { id: 'noodles', draw: (g, W, H) => {
    g.fillStyle = '#d0141c'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffd200'; g.beginPath(); g.ellipse(W * 0.82, H * 0.62, W * 0.13, H * 0.22, 0, 0, Math.PI); g.fill();
    g.strokeStyle = '#ffe9a0'; g.lineWidth = 5; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(W * (0.72 + i * 0.03), H * 0.6); g.bezierCurveTo(W * (0.73 + i * 0.03), H * 0.3, W * (0.76 + i * 0.03), H * 0.45, W * (0.75 + i * 0.03), H * 0.2); g.stroke(); }
    g.fillStyle = '#ffd200'; g.font = F(800, H * 0.28); g.fillText('MAMA NKECHI', W * 0.05, H * 0.38);
    g.fillStyle = '#fff'; g.font = F(700, H * 0.15); g.fillText('NOODLES', W * 0.05, H * 0.58);
    g.font = F(600, H * 0.1); g.fillText('READY BEFORE THE DANFO MOVES', W * 0.05, H * 0.82);
  } },
  { id: 'coralbay', draw: (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#5ec8f2'); gr.addColorStop(1, '#e8f6ff'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.fillRect(W * 0.72, H * 0.35, W * 0.22, H * 0.5); g.fillStyle = '#0e5a8a'; g.beginPath(); g.moveTo(W * 0.7, H * 0.37); g.lineTo(W * 0.83, H * 0.15); g.lineTo(W * 0.96, H * 0.37); g.fill();
    g.fillStyle = '#0e5a8a'; for (let i = 0; i < 3; i++) g.fillRect(W * (0.745 + i * 0.065), H * 0.48, W * 0.04, H * 0.12);
    g.fillStyle = '#0a2a44'; g.font = F(800, H * 0.28); g.fillText('CORAL BAY HOMES', W * 0.05, H * 0.42);
    g.font = F(600, H * 0.12); g.fillText('OWN YOUR SPACE. PAY SMALL SMALL.', W * 0.05, H * 0.64);
    g.font = F(500, H * 0.085); g.fillText('2 AND 3 BEDROOM TERRACES', W * 0.05, H * 0.84);
  } },
  { id: 'sunrisemalt', draw: (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#3a1a06'); gr.addColorStop(1, '#a5520e'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffc94a'; g.beginPath(); g.arc(W * 0.84, H * 0.5, H * 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a1a06'; g.beginPath(); g.roundRect(W * 0.81, H * 0.2, W * 0.06, H * 0.62, 14); g.fill();
    g.fillStyle = '#ffc94a'; g.font = F(800, H * 0.3); g.fillText('SUNRISE MALT', W * 0.05, H * 0.43);
    g.fillStyle = '#fff'; g.font = F(600, H * 0.12); g.fillText('ENERGY FOR THE HUSTLE', W * 0.05, H * 0.65);
    g.font = F(500, H * 0.08); g.fillText('NON ALCOHOLIC . SERVE COLD', W * 0.05, H * 0.85);
  } },
  { id: 'lagosrush', draw: (g, W, H) => {
    g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f6c514'; for (let i = -4; i < 12; i++) { g.beginPath(); g.moveTo(W * 0.62 + i * 40, H); g.lineTo(W * 0.62 + i * 40 + 20, H); g.lineTo(W * 0.62 + i * 40 + 80, 0); g.lineTo(W * 0.62 + i * 40 + 60, 0); g.fill(); }
    g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, W * 0.62, H);
    g.fillStyle = '#f6c514'; g.font = F(800, H * 0.34); g.fillText('LAGOS RUSH', W * 0.05, H * 0.45);
    g.fillStyle = '#fff'; g.font = F(600, H * 0.12); g.fillText('ROOMS OPEN 24/7. BRING YOUR CREW.', W * 0.05, H * 0.67);
  } },
];

export function creativeTexture(c: Creative, W = 1024, H = 384) {
  const cv = canvas(W, H), g = cv.getContext('2d')!;
  g.textBaseline = 'alphabetic';
  c.draw(g, W, H);
  // weathering: sun fade and grime
  g.fillStyle = 'rgba(255,240,220,0.06)'; g.fillRect(0, 0, W, H);
  const gr = g.createLinearGradient(0, H * 0.7, 0, H); gr.addColorStop(0, 'rgba(40,30,20,0)'); gr.addColorStop(1, 'rgba(40,30,20,0.25)'); g.fillStyle = gr; g.fillRect(0, H * 0.7, W, H * 0.3);
  return tex(cv, { repeat: false });
}

export interface HouseCreative { headline: string; sub: string; cta: string; bg: string; fg: string; accent: string }
/** Set the font, shrinking it until the text fits the width: an advertiser's headline can be any length. */
function fitFont(g: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number) {
  g.font = F(weight, size);
  const w = g.measureText(text).width;
  if (w > maxW) g.font = F(weight, Math.floor(size * (maxW / w)));
}

export function houseTexture(h: HouseCreative, W = 2048, H = 768) {
  const cv = canvas(W, H), g = cv.getContext('2d')!;
  g.fillStyle = h.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = h.accent; g.fillRect(0, 0, W, H * 0.06); g.fillRect(0, H * 0.94, W, H * 0.06);
  g.fillStyle = h.fg; g.textAlign = 'center';
  fitFont(g, h.headline, 800, H * 0.3, W * 0.92);
  g.fillText(h.headline, W / 2, H * 0.42);
  g.font = F(600, H * 0.085); wrapText(g, h.sub, W / 2, H * 0.6, W * 0.85, H * 0.1);
  g.fillStyle = h.accent; fitFont(g, h.cta.toUpperCase(), 700, H * 0.07, W * 0.9); g.fillText(h.cta.toUpperCase(), W / 2, H * 0.84);
  return tex(cv, { repeat: false });
}

/** Campaign fliers: name only, no likeness, no party logo. Three designs, slightly different each time. */
export function flierTexture(variant: number) {
  const W = 256, H = 360, cv = canvas(W, H), g = cv.getContext('2d')!;
  const rng = new Rng(variant * 77 + 3);
  const green = '#0a7a3c';
  if (variant === 0) { g.fillStyle = green; g.fillRect(0, 0, W, H); g.fillStyle = '#ffffff'; }
  else if (variant === 1) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); g.fillStyle = green; g.fillRect(0, 0, W, 40); g.fillRect(0, H - 40, W, 40); g.fillStyle = green; }
  else { g.fillStyle = '#0d3d22'; g.fillRect(0, 0, W, H); g.fillStyle = '#f2d24a'; }
  g.textAlign = 'center';
  g.font = F(700, 30); g.fillText('VOTE', W / 2, 92);
  g.font = F(800, 72); g.fillText('PETER', W / 2, 168); g.fillText('OBI', W / 2, 236);
  g.font = F(700, 28); g.fillText('FOR PRESIDENT', W / 2, 284);
  // a simple five pointed star as an emblem
  g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 9 : 22; g.lineTo(W / 2 + Math.cos(a) * r, 322 + Math.sin(a) * r); } g.closePath(); g.fill();
  // fly-posted: glue stains, a torn corner
  g.fillStyle = 'rgba(255,255,255,0.12)'; for (let i = 0; i < 6; i++) g.fillRect(rng.next() * W, rng.next() * H, rng.range(20, 60), 3);
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.moveTo(W, 0); g.lineTo(W - rng.range(30, 70), 0); g.lineTo(W, rng.range(30, 80)); g.fill();
  g.globalCompositeOperation = 'source-over';
  return tex(cv, { repeat: false });
}

export function streetPosterTexture(variant: number) {
  const posters = [
    { bg: '#f2e600', fg: '#111', a: 'MIRACLE', b: 'CRUSADE', c: 'COME AND RECEIVE YOUR BLESSING . FRIDAY 6PM' },
    { bg: '#d0141c', fg: '#fff', a: 'OWAMBE', b: 'THIS SATURDAY', c: 'LIVE BAND . SMALL CHOPS . ASO EBI' },
    { bg: '#1d3fb8', fg: '#fff', a: 'LEARN', b: 'TAILORING', c: 'SIX MONTHS . CERTIFICATE . CALL INSIDE' },
    { bg: '#ffffff', fg: '#0a7a3c', a: 'ROOM', b: 'TO LET', c: 'SELF CONTAIN . WATER AND LIGHT' },
  ];
  const p = posters[variant % posters.length];
  const W = 256, H = 360, cv = canvas(W, H), g = cv.getContext('2d')!;
  g.fillStyle = p.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = p.fg; g.textAlign = 'center';
  g.font = F(800, 64); g.fillText(p.a, W / 2, 110);
  g.font = F(800, 46); g.fillText(p.b, W / 2, 170);
  g.font = F(600, 22); wrapText(g, p.c, W / 2, 230, W - 30, 28);
  return tex(cv, { repeat: false });
}

/** Green road sign with up to three destinations and arrows. */
export function roadSignTexture(lines: { text: string; arrow: 'up' | 'left' | 'right' | 'upright' | 'upleft' }[], W = 1024, H = 512) {
  const cv = canvas(W, H), g = cv.getContext('2d')!;
  g.fillStyle = '#0b6b35'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.strokeRect(14, 14, W - 28, H - 28);
  g.fillStyle = '#fff'; g.font = F(700, H / (lines.length + 1.2) * 0.6);
  lines.forEach((l, i) => {
    const y = (H / (lines.length + 0.5)) * (i + 0.95);
    g.textAlign = 'left'; g.fillText(l.text, 150, y + 20);
    g.save(); g.translate(80, y);
    const rot = { up: 0, right: Math.PI / 2, left: -Math.PI / 2, upright: Math.PI / 4, upleft: -Math.PI / 4 }[l.arrow];
    g.rotate(rot);
    g.beginPath(); g.moveTo(0, -42); g.lineTo(30, -6); g.lineTo(10, -6); g.lineTo(10, 40); g.lineTo(-10, 40); g.lineTo(-10, -6); g.lineTo(-30, -6); g.closePath(); g.fill();
    g.restore();
  });
  return tex(cv, { repeat: false });
}

export function chevronTexture() {
  const cv = canvas(256, 128), g = cv.getContext('2d')!;
  g.fillStyle = '#111'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#f6c514';
  for (let i = 0; i < 3; i++) { const x = 30 + i * 75; g.beginPath(); g.moveTo(x, 14); g.lineTo(x + 40, 64); g.lineTo(x, 114); g.lineTo(x + 22, 114); g.lineTo(x + 62, 64); g.lineTo(x + 22, 14); g.fill(); }
  return tex(cv, { repeat: false });
}

export const SHOP_NAMES = [
  'MAMA T PROVISIONS', 'BLESSED HANDS BARBING SALON', "GOD'S TIME ELECTRONICS", 'DIVINE FAVOUR PHARMACY', 'OSHODI PHONES & ACCESSORIES',
  'IYA BASIRA BUKKA', 'PRAISE MOTORS', 'NO WAHALA CHEMIST', 'CHIEF B VULCANISER', 'GRACE FASHION HOUSE', 'EKO SUYA SPOT', 'JEHOVAH JIREH TAILORING',
  'OLUWASEUN PRINTING PRESS', 'EXCELLENT POS SERVICES', 'TOP UP AIRTIME HERE', 'CHARGE YOUR PHONE HERE', 'MERCY OF GOD SPARE PARTS', 'ALHAJI SULE FOODSTUFF',
  'FAITH BUILDING MATERIALS', 'KING OF KINGS GENERATOR REPAIRS', 'SWEET MOTHER RESTAURANT', 'NEW DAWN LAUNDRY', 'OSHODI CYBER CAFE', 'BEST CUT UNISEX SALON',
];
const SIGN_COLORS = [['#ffffff', '#c8102e'], ['#0b3d91', '#ffffff'], ['#ffcc00', '#111111'], ['#0a7a3c', '#ffffff'], ['#c8102e', '#ffffff'], ['#111111', '#ffcc00'], ['#ff6a00', '#ffffff'], ['#6a1b9a', '#ffffff']];

/** One atlas of shop signboards, 4 x 8 boards. */
export function shopSignAtlas() {
  const W = 2048, H = 2048, cols = 4, rows = 8;
  const cv = canvas(W, H), g = cv.getContext('2d')!;
  const bw = W / cols, bh = H / rows;
  SHOP_NAMES.slice(0, cols * rows).forEach((name, i) => {
    const x = (i % cols) * bw, y = Math.floor(i / cols) * bh;
    const [bg, fg] = SIGN_COLORS[i % SIGN_COLORS.length];
    g.fillStyle = bg; g.fillRect(x + 4, y + 4, bw - 8, bh - 8);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = bh * 0.42; g.font = F(800, size);
    while (g.measureText(name).width > bw - 40 && size > 20) { size -= 2; g.font = F(800, size); }
    g.fillText(name, x + bw / 2, y + bh * 0.45);
    g.font = F(500, bh * 0.14); g.fillText('OSHODI . LAGOS', x + bw / 2, y + bh * 0.8);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 4, y + bh * 0.88, bw - 8, bh * 0.08);
  });
  return { texture: tex(cv, { repeat: false }), cols, rows, count: Math.min(SHOP_NAMES.length, cols * rows) };
}

export function makeLitMaterial(map: THREE.Texture, emissive = 0.25) {
  return new THREE.MeshStandardMaterial({ map, roughness: 0.6, emissive: new THREE.Color(0xffffff), emissiveMap: map, emissiveIntensity: emissive });
}
