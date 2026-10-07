// The player's save: name, crew, garage, play money, progress, records and settings. Stored on this device; there
// is no real money and no account system in version 1.
import { CARS, defaultLivery, type Livery } from '../shared/cars';
import { settingsFor, type GraphicsSettings, type PresetId } from '../render/quality';
import { defaultAudioPrefs, type AudioPrefs } from '../audio/audio';
import { defaultInputPrefs, type InputPrefs } from '../game/input';
import { levelFromXp } from '../shared/economy';

export interface AccessPrefs { cbSafe: boolean; reduceMotion: boolean; highContrast: boolean; uiScale: number; bigCallouts: boolean }
export interface GameplayPrefs { units: 'kmh' | 'mph'; political: boolean; camera: 'near' | 'far' | 'hood'; showPerf: boolean; skipIntro: boolean }
export interface Profile {
  v: 1;
  id: string; name: string; crew: string; color: string;
  xp: number; naira: number;
  garage: { carId: string; livery: Livery }[];
  current: string;
  career: Record<string, { results: number[]; points: number; done: boolean }>;
  stats: { races: number; wins: number; podiums: number; drift: number; nearMiss: number; tricks: number; shunts: number; km: number; online: number };
  records: Record<string, number>;
  recent: { name: string; id: string; at: number; crew?: string }[];
  friends: { name: string; id: string; code: string }[];
  settings: { graphics: GraphicsSettings; audio: AudioPrefs; input: InputPrefs; access: AccessPrefs; gameplay: GameplayPrefs; deviceChecked: boolean };
  ghosts: Record<string, string>;
  onboarded: boolean;
}

const KEY = 'lagosrush.profile.v1';
const NAMES = ['Kola', 'Amaka', 'Seyi', 'Chinedu', 'Bimpe', 'Tobi', 'Ifeoma', 'Musa', 'Lola', 'Femi', 'Zainab', 'Dapo'];
const COLORS = ['#f6c514', '#ff2d8a', '#39d0ff', '#39ff14', '#ff6a00', '#a678ff'];

function rid() { const a = new Uint8Array(8); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }

export function newProfile(touch: boolean): Profile {
  const starter = CARS[0];
  const n = Math.floor(Math.random() * NAMES.length);
  return {
    v: 1, id: rid(), name: `${NAMES[n]}${Math.floor(10 + Math.random() * 89)}`, crew: 'Oshodi Kings', color: COLORS[n % COLORS.length],
    xp: 0, naira: 12000,
    // the first car leaves the lot in green and white: a Lagos plate, a fresh respray and twin stripes
    garage: [{ carId: starter.id, livery: { ...defaultLivery(starter, `LAG ${100 + Math.floor(Math.random() * 899)}`), paint: '#0b7a3e', wrap: 'stripes', wrapColor: '#f4f4f0' } }],
    current: starter.id,
    career: {}, stats: { races: 0, wins: 0, podiums: 0, drift: 0, nearMiss: 0, tricks: 0, shunts: 0, km: 0, online: 0 },
    records: {}, recent: [], friends: [],
    settings: { graphics: settingsFor('medium', true), audio: defaultAudioPrefs(), input: defaultInputPrefs(touch), access: { cbSafe: false, reduceMotion: false, highContrast: false, uiScale: 1, bigCallouts: false }, gameplay: { units: 'kmh', political: true, camera: 'near', showPerf: false, skipIntro: false }, deviceChecked: false },
    ghosts: {}, onboarded: false,
  };
}

export function loadProfile(touch: boolean): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Profile;
      if (p.v === 1 && p.garage?.length) {
        const fresh = newProfile(touch);
        // fill any fields added since this save was written
        p.settings = { ...fresh.settings, ...p.settings, graphics: { ...fresh.settings.graphics, ...p.settings?.graphics }, access: { ...fresh.settings.access, ...p.settings?.access }, gameplay: { ...fresh.settings.gameplay, ...p.settings?.gameplay }, input: { ...fresh.settings.input, ...p.settings?.input }, audio: { ...fresh.settings.audio, ...p.settings?.audio } };
        p.stats = { ...fresh.stats, ...p.stats };
        p.ghosts = p.ghosts ?? {}; p.records = p.records ?? {}; p.recent = p.recent ?? []; p.friends = p.friends ?? []; p.career = p.career ?? {};
        return p;
      }
    }
  } catch { /* corrupt or unavailable storage: start fresh */ }
  return newProfile(touch);
}

let saveTimer: number | null = null;
export function saveProfile(p: Profile, now = false) {
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage full or blocked: keep playing */ } };
  if (now) { write(); return; }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(write, 300);
}

export function level(p: Profile) { return levelFromXp(p.xp); }
export function owned(p: Profile, carId: string) { return p.garage.find((g) => g.carId === carId); }
export function currentCar(p: Profile) { return owned(p, p.current) ?? p.garage[0]; }
export function setPreset(p: Profile, preset: PresetId, auto: boolean) { const keepPerf = p.settings.graphics.showPerf; p.settings.graphics = { ...settingsFor(preset, auto), showPerf: keepPerf }; }
export function friendCode(p: Profile) { return `RUSH-${p.id.slice(0, 4).toUpperCase()}-${p.id.slice(4, 8).toUpperCase()}`; }
