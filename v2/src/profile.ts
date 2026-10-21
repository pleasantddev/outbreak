// One profile per account. There is no backend yet, so the single profile record lives in localStorage behind
// ProfileStore. A server implementation only has to satisfy the same interface (it is async on purpose) and the
// rest of the game does not change. There is deliberately no delete or "new profile" method anywhere.
import type { CharacterLook } from './data/cosmetics';
import { ROSTER, type RosterId } from './render/humans';

export interface Profile {
  v: 1;
  /** stable id of the account, generated once and never changed */
  accountId: string;
  /** display name, 3 to 16 characters, may be changed from settings */
  name: string;
  model: RosterId;
  skin: number;
  outfit: string;
  xp: number;
  createdAt: number;
  updatedAt: number;
}

export type ProfileDraft = Pick<Profile, 'name' | 'model' | 'skin' | 'outfit'>;

export class ProfileExistsError extends Error { constructor() { super('This account already has a profile.'); } }

export interface ProfileStore {
  /** the stable id of this account (created on first use) */
  accountId(): Promise<string>;
  exists(): Promise<boolean>;
  load(): Promise<Profile | null>;
  /** first save only: rejects with ProfileExistsError when the account already owns a profile */
  create(draft: ProfileDraft): Promise<Profile>;
  /** change fields of the one profile (name, look, xp). accountId and createdAt are never touched. */
  update(patch: Partial<Omit<Profile, 'v' | 'accountId' | 'createdAt'>>): Promise<Profile>;
}

const K_ACCOUNT = 'hustlelife.account';
const K_PROFILE = 'hustlelife.profile';

function uuid(): string {
  try { const c = (globalThis as any).crypto; if (c?.randomUUID) return c.randomUUID(); } catch { /* old browser */ }
  const b = new Uint8Array(16); try { crypto.getRandomValues(b); } catch { for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0; }
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class LocalProfileStore implements ProfileStore {
  // storage can be blocked (private mode): keep a copy in memory so the session still works
  private mem: { account?: string; profile?: Profile | null } = {};
  private read(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
  private write(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* blocked */ } }
  async accountId() {
    if (this.mem.account) return this.mem.account;
    let id = this.read(K_ACCOUNT);
    if (!id || id.length < 16) { id = uuid(); this.write(K_ACCOUNT, id); }
    return (this.mem.account = id);
  }
  private parse(): Profile | null {
    if (this.mem.profile !== undefined) return this.mem.profile;
    const raw = this.read(K_PROFILE); if (!raw) return null;
    try {
      const p = JSON.parse(raw) as Profile;
      if (p && p.v === 1 && typeof p.name === 'string' && p.model in ROSTER) return (this.mem.profile = p);
    } catch { /* corrupt record is treated as no profile */ }
    return null;
  }
  async exists() { return this.parse() !== null; }
  async load() { return this.parse(); }
  async create(d: ProfileDraft) {
    if (this.parse()) throw new ProfileExistsError();
    const name = validateName(d.name); if (!name.ok) throw new Error(name.error);
    const now = Date.now();
    const p: Profile = { v: 1, accountId: await this.accountId(), name: name.name, model: d.model, skin: clampSkin(d.skin), outfit: d.outfit, xp: 0, createdAt: now, updatedAt: now };
    this.mem.profile = p; this.write(K_PROFILE, JSON.stringify(p));
    return p;
  }
  async update(patch: Partial<Omit<Profile, 'v' | 'accountId' | 'createdAt'>>) {
    const cur = this.parse(); if (!cur) throw new Error('No profile to update.');
    const next: Profile = { ...cur, ...patch, v: 1, accountId: cur.accountId, createdAt: cur.createdAt, updatedAt: Date.now() };
    if (patch.name !== undefined) { const n = validateName(patch.name); if (!n.ok) throw new Error(n.error); next.name = n.name; }
    next.skin = clampSkin(next.skin);
    this.mem.profile = next; this.write(K_PROFILE, JSON.stringify(next));
    return next;
  }
}

/** In-memory profile for `?auto=1` runs: nothing is written, so automated tests never touch a real account. */
export function ephemeralProfile(model: RosterId): Profile {
  const now = Date.now();
  return { v: 1, accountId: 'auto-' + uuid().slice(0, 8), name: 'You', model, skin: 1, outfit: 'street', xp: 0, createdAt: now, updatedAt: now };
}

// ---------------------------------------------------------------- name rules
const RESERVED = ['admin', 'administrator', 'moderator', 'staff', 'support', 'hustlelife', 'hustle life', 'system', 'you'];
const BAD = ['fuck', 'shit', 'bitch', 'nigg', 'cunt', 'dick', 'pussy', 'rape', 'whore', 'asshole', 'fvck', 'sex'];
export const NAME_MIN = 3, NAME_MAX = 16;
export function validateName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.replace(/\s+/g, ' ').trim();
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

// ---------------------------------------------------------------- looks
export const BASE_LOOKS: Record<RosterId, Partial<CharacterLook>> = {
  survivor: { body: 'male', topColor: '#2c3a2a', topAccent: '#141414', pantsColor: '#1e2b3a', shoes: '#141414', topPattern: 'solid' },
  rogue: { body: 'male', topColor: '#1d1f24', pantsColor: '#2a2622', shoes: '#2a1d14' },
  trooper: { body: 'male' },
  girl: { body: 'female', topColor: '#b0332a', topAccent: '#e8c34a', pantsColor: '#141414', shoes: '#e8e0d0', topPattern: 'ankara_sun' },
  farah: { body: 'female', topColor: '#d9a441', topAccent: '#355070', pantsColor: '#1e2b3a', shoes: '#5a3d2b', topPattern: 'ankara_wave' },
};

export interface Outfit { id: string; name: string; tag: string; swatch: [string, string]; look: Partial<CharacterLook> | null }
export const OUTFITS: Outfit[] = [
  { id: 'street', name: 'Street Clean', tag: 'Your usual', swatch: ['#2c3a2a', '#1e2b3a'], look: null },
  { id: 'oshodi-night', name: 'Oshodi Night', tag: 'Black and teal', swatch: ['#14161c', '#2de0c8'], look: { topColor: '#14161c', topAccent: '#2de0c8', pantsColor: '#1b1d24', shoes: '#e8e0d0', topPattern: 'solid' } },
  { id: 'ankara-sun', name: 'Ankara Sunburst', tag: 'Print on print', swatch: ['#b0332a', '#e8c34a'], look: { topPattern: 'ankara_sun', topColor: '#b0332a', topAccent: '#e8c34a', pantsColor: '#141414', shoes: '#e8e0d0' } },
  { id: 'lagoon', name: 'Lagoon Wave', tag: 'Gold and navy', swatch: ['#d9a441', '#355070'], look: { topPattern: 'ankara_wave', topColor: '#d9a441', topAccent: '#355070', pantsColor: '#1e2b3a', shoes: '#5a3d2b' } },
  { id: 'adire', name: 'Adire Indigo', tag: 'Hand dyed', swatch: ['#355070', '#c9c1b2'], look: { topPattern: 'adire', topColor: '#355070', topAccent: '#c9c1b2', pantsColor: '#c9c1b2', shoes: '#141414' } },
  { id: 'naija', name: 'Naija Green', tag: 'Green white green', swatch: ['#1f6b3a', '#e8e0d0'], look: { topColor: '#1f6b3a', topAccent: '#e8e0d0', pantsColor: '#e8e0d0', shoes: '#141414', topPattern: 'solid' } },
  { id: 'danfo', name: 'Danfo Yellow', tag: 'Stripe and black', swatch: ['#e3a21a', '#141414'], look: { topPattern: 'stripe_danfo', topColor: '#e3a21a', topAccent: '#141414', pantsColor: '#1d1f24', shoes: '#141414' } },
  { id: 'purple', name: 'Purple Company', tag: 'Owner energy', swatch: ['#6d3ef0', '#2de0c8'], look: { topColor: '#6d3ef0', topAccent: '#2de0c8', pantsColor: '#141414', shoes: '#e8e0d0', topPattern: 'solid' } },
];
export const SKIN_NAMES = ['Midnight', 'Cocoa', 'Chestnut', 'Bronze', 'Caramel', 'Honey'];
export const clampSkin = (n: number) => Math.max(0, Math.min(SKIN_NAMES.length - 1, Math.round(Number.isFinite(n) ? n : 1)));

/** What a roster body lets you change. Trooper wears an issued kit, Zainab and Trooper keep their skin as modelled. */
export function customisable(id: RosterId) {
  const s = ROSTER[id].slots.map((x) => x[1]);
  return { skin: s.includes('skin'), outfit: s.some((x) => x === 'top' || x === 'pants' || x === 'shoes') };
}

export function lookFor(p: Pick<Profile, 'name' | 'model' | 'skin' | 'outfit'>, base: CharacterLook): CharacterLook {
  const preset = OUTFITS.find((o) => o.id === p.outfit)?.look ?? null;
  return { ...base, ...BASE_LOOKS[p.model], ...(preset ?? {}), skin: clampSkin(p.skin), model: p.model, name: p.name } as CharacterLook;
}

// ---------------------------------------------------------------- level
export const levelOf = (xp: number) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 60));
export function levelProgress(xp: number) { const L = levelOf(xp); const a = 60 * (L - 1) ** 2, b = 60 * L * L; return { level: L, frac: (xp - a) / (b - a), next: b - xp }; }
export const shortId = (id: string) => 'HL-' + id.replace(/-/g, '').slice(0, 6).toUpperCase();
