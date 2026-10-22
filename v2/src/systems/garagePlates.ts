// Lagos style number plates: three letter LGA code, three digits, two letters ("IKJ 123 AB"). Vanity plates are text the player
// buys; the registry keeps them unique. The registry has a backend hook so the server can own it once multiplayer is on.
import * as THREE from 'three';
import { hash32, rng32, shopItems } from './featureKit';

const FALLBACK_CODES = ['IKJ', 'OSD', 'MUS', 'AGG', 'IFK', 'ALM', 'SRL', 'LGI', 'KSF', 'APP', 'IKR', 'ETO'];
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
export const STD_RE = /^[A-Z]{3} \d{3} [A-Z]{2}$/;
export const plateCodes = () => { const c = shopItems('plate-code').map((p) => p.code); return c.length ? c : FALLBACK_CODES; };
export const lgaCode = (lga: string) => shopItems('plate-code').find((p) => p.lga.toLowerCase() === lga.toLowerCase())?.code ?? null;

/** Standard plate from a number: the same seed always gives the same plate, so every car in the street keeps its own. */
export function stdPlate(seed: number, code?: string): string {
  const r = rng32(seed * 2654435761 + 97); const codes = plateCodes();
  const c = code ?? codes[Math.floor(r() * codes.length)];
  const l = () => LETTERS[Math.floor(r() * LETTERS.length)];
  return `${c} ${String(Math.floor(r() * 900) + 100)} ${l()}${l()}`;
}

const BANNED = ['POLICE', 'ARMY', 'NAVY', 'EFCC', 'FRSC', 'SARS', 'DSS', 'GOVT', 'GOVERNOR', 'PRESIDENT', 'SENATOR', 'FEDERAL', 'NIGERIA', 'MINISTER', 'CUSTOMS', 'IMMIGRATION', 'RAB', 'VIO', 'LASTMA', 'KAI', 'NDLEA', 'FBI', 'CIA', 'SEX', 'RAPE', 'FUCK', 'SHIT', 'DICK', 'PUSSY', 'BITCH', 'ASS', 'ASSH', 'NIGGA', 'NAZI', 'ISIS', 'BOKO', 'ARSE', 'CUNT', 'COCK', 'HOE', 'WHORE', 'YAHOO'];
/** Plates a stranger already holds. Real Lagos drivers will recognise a few of these. */
const TAKEN = ['BOSS', 'KING', 'QUEEN', 'NAIJA', 'LAGOS', 'GOD', 'JESUS', 'OGA', 'OGA 1', 'MONEY', 'HUSTLE', 'BIG MAN', 'CHIEF', 'LUCKY', 'BLESSED', 'GRACE', 'MAMA', 'BABA', 'AREA', 'ONE', 'ALHAJI', 'HAJIYA', 'LEKKI', 'IKEJA', 'GBOLA', 'EMEKA', 'DADDY', 'JAGA', 'AMEN', 'SWAG', 'WIZ', 'VIP', 'CEO', 'BABA IJEBU', 'ELITE', 'ROYAL', 'OBA', 'OLU', 'GOLD', 'DANFO', 'KEKE', 'OKADA', 'KING 1', 'BOSS 1', 'NO 1', 'LAGOS 1', 'ABUJA', 'PH CITY', 'BIGGIE', 'DON', 'DON 1', 'WIZKID', 'FAST', 'SPEED', 'GRACE 1', 'FAITH', 'FAVOUR'];

export interface PlateCheck { ok: boolean; text: string; why?: string; tier?: string; price?: number }
export function normalisePlate(raw: string) { return raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }
/** Vanity text rules: 2 to 8 letters or digits, at most one space, nothing that passes for an official plate, nothing rude. */
export function checkVanity(raw: string): PlateCheck {
  const text = normalisePlate(raw); const bare = text.replace(/ /g, '');
  if (bare.length < 2) return { ok: false, text, why: 'Too short. At least 2 characters.' };
  if (bare.length > 8) return { ok: false, text, why: 'Too long. Plates hold 8 characters at most.' };
  if ((text.match(/ /g) ?? []).length > 1) return { ok: false, text, why: 'One space at most.' };
  if (STD_RE.test(text) || /^[A-Z]{3} ?\d{3} ?[A-Z]{2}$/.test(text)) return { ok: false, text, why: 'That looks like a state issue plate. Pick something that is yours.' };
  for (const b of BANNED) if (bare.includes(b.replace(/ /g, ''))) return { ok: false, text, why: 'The registry will not print that one.' };
  if (/(.)\1{4,}/.test(bare)) return { ok: false, text, why: 'Too many repeats.' };
  const tier = shopItems('plate-tier').find((t) => bare.length >= t.minLen && bare.length <= t.maxLen);
  return { ok: true, text, tier: tier?.id, price: tier?.price ?? 150000 };
}

export interface PlateBackend { reserve(text: string, owner: string): Promise<boolean>; release(text: string): void; isTaken(text: string): Promise<boolean> }
/** Unique plate registry. Local by default (the save holds what you own); the net engineer replaces `backend` with a server call. */
export class PlateRegistry {
  backend: PlateBackend | null = null; mine: string[] = [];
  private npc = new Set(TAKEN);
  bind(mine: string[]) { this.mine = mine; }
  async isTaken(text: string) { text = normalisePlate(text); if (this.mine.includes(text) || this.npc.has(text)) return true; if (this.backend) return this.backend.isTaken(text); return false; }
  async reserve(text: string, owner: string) {
    text = normalisePlate(text); if (await this.isTaken(text)) return false;
    if (this.backend && !(await this.backend.reserve(text, owner))) return false;
    this.mine.push(text); return true;
  }
  release(text: string) { text = normalisePlate(text); const i = this.mine.indexOf(text); if (i >= 0) this.mine.splice(i, 1); this.backend?.release(text); }
}
export const plateRegistry = new PlateRegistry();

// ------------------------------------------------------------------------------------------------ drawing
const cache = new Map<string, THREE.CanvasTexture>();
let fontsAsked = false;
export function drawPlate(c: HTMLCanvasElement, text: string, custom: boolean) {
  const W = c.width, H = c.height; const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  const r = H * 0.14; g.fillStyle = '#d4d6d8'; g.beginPath(); g.roundRect(0, 0, W, H, r); g.fill();
  g.fillStyle = custom ? '#fff7d6' : '#fafaf8'; g.beginPath(); g.roundRect(W * 0.012, H * 0.03, W * 0.976, H * 0.94, r * 0.8); g.fill();
  g.strokeStyle = '#13335f'; g.lineWidth = H * 0.035; g.beginPath(); g.roundRect(W * 0.03, H * 0.08, W * 0.94, H * 0.84, r * 0.6); g.stroke();
  // top legend and slogan, the way a Lagos plate carries them
  g.textAlign = 'center'; g.fillStyle = '#0a6b3a'; g.font = `700 ${H * 0.15}px Oswald, "Arial Narrow", Impact, sans-serif`; g.textBaseline = 'alphabetic';
  g.fillText('LAGOS', W / 2, H * 0.25);
  g.fillStyle = '#13335f'; g.font = `600 ${H * 0.095}px Oswald, "Arial Narrow", sans-serif`; g.fillText('CENTRE OF EXCELLENCE', W / 2, H * 0.9);
  g.fillStyle = '#0c0c0e'; let size = H * 0.46; g.font = `700 ${size}px Oswald, "Arial Narrow", Impact, sans-serif`;
  while (g.measureText(text).width > W * 0.84 && size > 10) { size -= 2; g.font = `700 ${size}px Oswald, "Arial Narrow", Impact, sans-serif`; }
  g.fillText(text, W / 2, H * 0.7);
  // the green band on the left edge
  g.fillStyle = '#0a6b3a'; g.beginPath(); g.roundRect(W * 0.012, H * 0.03, W * 0.03, H * 0.94, [r * 0.8, 0, 0, r * 0.8]); g.fill();
}
export function plateTexture(text: string, custom = false): THREE.CanvasTexture {
  const k = text + (custom ? '*' : '');
  let t = cache.get(k); if (t) return t;
  const c = document.createElement('canvas'); c.width = 512; c.height = 192; drawPlate(c, text, custom);
  t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; cache.set(k, t);
  if (!fontsAsked) { fontsAsked = true; try { void document.fonts?.load('700 60px Oswald').then(() => { for (const [kk, tx] of cache) { const cv = tx.image as HTMLCanvasElement; drawPlate(cv, kk.replace(/\*$/, ''), kk.endsWith('*')); tx.needsUpdate = true; } }); } catch { /* no font API */ } }
  return t;
}
export function plateCanvas(text: string, custom: boolean, w = 512) { const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * 0.375); drawPlate(c, text, custom); return c; }

/** Puts a plate on the nose and tail of a car model. Replaces the plate already there. */
export function attachPlates(model: { root: THREE.Group; body: THREE.Group; groundY: number; kind: string }, text: string, custom: boolean) {
  const m = model as any; const tex = plateTexture(text, custom);
  if (m._plates) { for (const p of m._plates as THREE.Mesh[]) { (p.material as THREE.MeshStandardMaterial).map = tex; (p.material as THREE.MeshStandardMaterial).needsUpdate = true; } m._plateText = text; return; }
  m.root.updateMatrixWorld(true);
  const box = new THREE.Box3(); const inv = new THREE.Matrix4().copy(m.body.matrixWorld).invert();
  m.body.traverse((o: THREE.Object3D) => { const me = o as THREE.Mesh; if (!me.isMesh || (me.userData as any).plate) return; const g = me.geometry; if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, me.matrixWorld)); box.union(b); });
  const k = m.kind as string; const wide = k === 'danfo' ? 0.52 : k === 'okada' ? 0.3 : 0.54; const hgt = wide * 0.375;
  const y = (m.groundY as number) + (k === 'okada' ? 0.5 : k === 'danfo' ? 0.55 : 0.5);
  const mk = (z: number, ry: number) => {
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(wide, hgt), mat); p.position.set(0, y, z); p.rotation.y = ry; p.castShadow = false; (p.userData as any).plate = true; m.body.add(p); return p;
  };
  const front = k === 'okada' ? null : mk(box.max.z + 0.012, 0), rear = mk(box.min.z - 0.012, Math.PI);
  m._plates = [front, rear].filter(Boolean); m._plateText = text;
}
