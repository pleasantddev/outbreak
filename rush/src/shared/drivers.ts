// The driver behind the wheel: a look every player picks for themselves, drawn as a portrait in menus and sat in
// the car in 3D. Original and generic: skin tones, everyday Lagos headwear, outfit colours. No real people.

export type Headwear = 'helmet' | 'cap' | 'fila' | 'gele' | 'durag' | 'none';
export interface DriverLook { skin: number; head: Headwear; top: string; accent: string }

export const SKINS = ['#3a2119', '#4d2c1e', '#673c26', '#7d4a2e', '#96603f', '#b47852'];
export const HEADWEAR: { id: Headwear; name: string }[] = [
  { id: 'helmet', name: 'Race helmet' }, { id: 'cap', name: 'Cap' }, { id: 'fila', name: 'Fila' },
  { id: 'gele', name: 'Gele' }, { id: 'durag', name: 'Durag' }, { id: 'none', name: 'Low cut' },
];
export const OUTFITS = ['#0b7a3e', '#f6c514', '#d0141c', '#1d4fb8', '#141418', '#f4f2ec', '#ff2d8a', '#7a2bd9', '#ff6a00', '#39d0ff', '#6b4a2a', '#9aa3ad'];

const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/** Whatever a client sends, only a well formed look gets through. */
export function validLook(v: unknown): DriverLook | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const skin = Number(o.skin);
  if (!Number.isInteger(skin) || skin < 0 || skin >= SKINS.length) return null;
  if (!HEADWEAR.some((h) => h.id === o.head)) return null;
  if (!hex(o.top) || !hex(o.accent)) return null;
  return { skin, head: o.head as Headwear, top: o.top as string, accent: o.accent as string };
}

/** A look for an AI racer or a fresh profile, the same every time for the same number. */
export function lookFor(n: number): DriverLook {
  // the final >>> 0 matters: ^ hands back a signed int, and a negative index would pick nothing
  const h = (k: number) => { let x = Math.imul((n + 1) * 2654435761 + k * 40503, 1) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return x >>> 0; };
  return {
    skin: h(1) % SKINS.length,
    head: HEADWEAR[h(2) % HEADWEAR.length].id,
    top: OUTFITS[h(3) % OUTFITS.length],
    accent: OUTFITS[(h(3) + 1 + (h(4) % (OUTFITS.length - 1))) % OUTFITS.length],
  };
}
