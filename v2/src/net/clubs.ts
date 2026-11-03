// Club rules shared by the client and the server: who can work the decks and the pole stages, what the house pays,
// spraying money, shutting a club down, and songs players upload and pay to promote into club rotation. Pure, no
// imports beyond rules.ts. The server is the authority; offline the client runs the same numbers on the save.
// Pole stage work is an athletic, clothed job. Nothing here is sexual: the game is 16+.
import { worldHours } from './rules';

export type ClubId = 'zilox' | 'gele' | 'orun';
export interface ClubRule { id: ClubId; name: string; short: string; shutdown: number; promoDay: number; bar: number }
export const CLUB_RULES: Record<ClubId, ClubRule> = {
  zilox: { id: 'zilox', name: 'ZILOX Superclub', short: 'ZILOX', shutdown: 25_000_000, promoDay: 2500, bar: 5000 },
  gele: { id: 'gele', name: 'GELE Lounge', short: 'GELE', shutdown: 8_000_000, promoDay: 1500, bar: 3500 },
  orun: { id: 'orun', name: 'ORUN Rooftop', short: 'ORUN', shutdown: 15_000_000, promoDay: 2000, bar: 4500 },
};
export const CLUB_IDS = Object.keys(CLUB_RULES) as ClubId[];
export const isClub = (s: unknown): s is ClubId => typeof s === 'string' && s in CLUB_RULES;

// ------------------------------------------------------------------------------------------ jobs: decks and poles
/** how close you must stay to your post (metres); walk away and the shift ends */
export const DECK_REACH = 5, POLE_REACH = 3.5, CLUB_REACH = 26;
/** the house pays per real minute on shift, plus a little for every real player in the room, capped per Lagos day.
 *  Day shifts pay less: the room is empty till night. */
export const DJ_PAY = { base: 600, perHead: 150, heads: 20, dayCap: 60_000 };
export const POLE_PAY = { base: 500, perHead: 100, heads: 20, dayCap: 45_000 };
export const isClubNight = (hours: number) => { const h = ((hours % 24) + 24) % 24; return h >= 21 || h < 5; };
export function shiftPay(job: 'dj' | 'pole', crowd: number, hours: number) {
  const r = job === 'dj' ? DJ_PAY : POLE_PAY; const k = isClubNight(hours) ? 1 : 0.35;
  return Math.round((r.base + r.perHead * Math.min(r.heads, Math.max(0, crowd))) * k);
}
export const dayCap = (job: 'dj' | 'pole') => (job === 'dj' ? DJ_PAY : POLE_PAY).dayCap;
export const clubHours = (ms: number) => worldHours(ms);

// ------------------------------------------------------------------------------------------ spraying and shutdowns
export const SPRAY_NOTES = [1000, 5000, 20000, 100000] as const;
/** the house keeps a cut of every spray (the bouncer, the hype man, the sweeper): money leaves the economy */
export const SPRAY_HOUSE = 0.1;
export const SPRAY_GAP_MS = 700;
export const sprayNet = (n: number) => Math.round(n * (1 - SPRAY_HOUSE));
/** how long a shutdown holds the club, in real minutes. Drinks are free and everybody in the room hears your name. */
export const SHUTDOWN_MIN = 45;

// ------------------------------------------------------------------------------------------ songs
export const SONG_MAX_BYTES = 8_000_000, SONG_MIN_SECS = 30, SONG_MAX_SECS = 600, SONG_DAY_UPLOADS = 10, SONG_KEEP = 50;
export const SONG_TITLE_MAX = 60, SONG_ARTIST_MAX = 40;
export const SONG_MIMES = ['audio/mpeg', 'audio/ogg', 'audio/mp4'] as const;
export type SongMime = typeof SONG_MIMES[number];
export const PROMO_DAYS = [1, 3, 7, 14, 30] as const;
/** real-money promotion into club rotation: per club per day, or every club at a discount */
export function promoQuote(club: ClubId | 'all', days: number) {
  if (!(PROMO_DAYS as readonly number[]).includes(days)) return null;
  const day = club === 'all' ? Math.round(CLUB_IDS.reduce((s, c) => s + CLUB_RULES[c].promoDay, 0) * 0.8) : CLUB_RULES[club]?.promoDay;
  if (!day) return null;
  const off = days >= 14 ? 0.8 : days >= 7 ? 0.9 : 1;
  return { day, days, total: Math.round(day * days * off / 100) * 100 };
}
/** what kind of audio file the first bytes say it is */
export function audioKind(b: Uint8Array): SongMime | null {
  if (b.length < 12) return null;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg'; // ID3 tag
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg'; // MPEG frame sync
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg'; // OggS
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'audio/mp4'; // ....ftyp
  return null;
}
export function cleanSongText(s: unknown, max: number) { const t = String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim(); return t.length ? t.slice(0, max) : null; }

// ------------------------------------------------------------------------------------------ what plays
/** a track the decks can play: an Audius stream, a player's approved song, or the house groove we synthesise */
export interface ClubTrack { src: 'audius' | 'song' | 'house'; id: string; title: string; artist: string; secs: number; at: number; by?: string; promo?: boolean }
export function cleanTrack(t: any, now: number): ClubTrack | null {
  if (!t || typeof t !== 'object') return null;
  const src = t.src; if (src !== 'audius' && src !== 'song' && src !== 'house') return null;
  const id = String(t.id ?? '');
  if (src === 'audius' && !/^[A-Za-z0-9]{1,16}$/.test(id)) return null;
  if (src === 'song' && !/^sg_[a-f0-9]{12}$/.test(id)) return null;
  if (src === 'house' && !/^[a-z0-9-]{1,24}$/.test(id)) return null;
  const secs = Math.max(SONG_MIN_SECS, Math.min(SONG_MAX_SECS, Math.round(Number(t.secs) || 180)));
  return { src, id, title: cleanSongText(t.title, SONG_TITLE_MAX) ?? 'Untitled', artist: cleanSongText(t.artist, SONG_ARTIST_MAX) ?? 'Unknown', secs, at: now };
}
/** the house set when nobody is on the decks: our own synthesised grooves (nothing to license) */
export const HOUSE_SET = [
  { id: 'eko-groove', title: 'Eko Groove', artist: 'HustleLife House', secs: 240 },
  { id: 'log-drum-sunday', title: 'Log Drum Sunday', artist: 'HustleLife House', secs: 210 },
  { id: 'third-mainland', title: 'Third Mainland at 2am', artist: 'HustleLife House', secs: 260 },
];
/** where the Audius crate comes from: searches the DJ panel runs (the stream is Audius's, the artists chose to share it) */
export const AUDIUS_QUERIES = ['afrobeats', 'amapiano', 'naija', 'afropop', 'afro house', 'lagos', 'highlife', 'alte', 'afro fusion', 'street pop'];
export const AUDIUS_APP = 'HustleLife';
