// Rules the client and the server must agree on. Pure, no imports. The server is the authority; the client uses these
// to give instant feedback. Keep validateName in step with profile.ts (the tests compare them on a list of inputs).

export const ROSTER_IDS = ['survivor', 'rogue', 'trooper', 'girl', 'farah'] as const;
export const SKIN_COUNT = 6;
export const NAME_MIN = 3, NAME_MAX = 16;

const RESERVED = ['admin', 'administrator', 'moderator', 'staff', 'support', 'hustlelife', 'hustle life', 'system', 'you'];
const BAD = ['fuck', 'shit', 'bitch', 'nigg', 'cunt', 'dick', 'pussy', 'rape', 'whore', 'asshole', 'fvck', 'sex'];

export function validateName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < NAME_MIN) return { ok: false, error: `At least ${NAME_MIN} characters, abeg.` };
  if (name.length > NAME_MAX) return { ok: false, error: `${NAME_MAX} characters is the max.` };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'\-]*$/u.test(name)) return { ok: false, error: 'Letters, numbers, space . _ - and \' only. Start with a letter or number.' };
  if ((name.match(/[\p{L}\p{N}]/gu) ?? []).length < 3) return { ok: false, error: 'Use at least 3 letters or numbers.' };
  if (/(.)\1{4,}/.test(name)) return { ok: false, error: 'Too many repeated characters.' };
  const flat = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (RESERVED.includes(name.toLowerCase()) || RESERVED.includes(flat)) return { ok: false, error: 'That name is reserved. Pick another.' };
  if (BAD.some((b) => flat.includes(b))) return { ok: false, error: 'Keep it clean. Pick another name.' };
  return { ok: true, name };
}
/** The key that must be unique across the game: case and spacing insensitive. */
export const nameKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export const clampSkin = (n: number) => Math.max(0, Math.min(SKIN_COUNT - 1, Math.round(Number.isFinite(n) ? n : 1)));

/** Chat text: trims, drops control characters, caps length, masks the worst words. Returns null when nothing is left. */
export function cleanChat(raw: unknown, max = 200): string | null {
  if (typeof raw !== 'string') return null;
  let t = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > max) t = t.slice(0, max);
  for (const b of BAD) t = t.replace(new RegExp(b.split('').join('[\\s._\\-*]*'), 'gi'), (m) => '*'.repeat(m.length));
  return t;
}

/** Plot economics shared by client and server (same formula as world/plots.ts plotPrice). */
export function plotPriceOf(area: number, zone: string, rich: number, cx: number, cz: number) {
  const distOshodi = Math.hypot(cx, cz) / 1000;
  const base = 26_000_000 * Math.exp(-distOshodi / 14) + 4_500_000;
  const size = area / 648;
  const built = zone === 'vacant' ? 1 : zone === 'unfinished' ? 1.35 : 2.2 + rich * 2.5;
  return Math.round((base * size * built) / 50_000) * 50_000;
}
export const BANK_WITHDRAW_FEE = 0.015;
export const withdrawNet = (a: number) => Math.round(a * (1 - BANK_WITHDRAW_FEE));
