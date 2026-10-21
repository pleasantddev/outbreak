// Persistent player profile. Stored per browser; wrapped so a blocked storage never breaks the game.
import type { ArchetypeId } from './balance';
import { OPERATORS, defaultArmory, type Armory, type Operator } from './cosmetics';

export interface Settings {
  sensitivity: number; invertY: boolean; quality: 'low' | 'medium' | 'high'; volume: number; music: number;
  fov: number; touchControls: 'auto' | 'on' | 'off'; matchMinutes: number; showFps: boolean; gore: boolean;
}
export interface Profile {
  version: 3;
  callsign: string;
  operatorId: string;
  operators: Operator[];
  armory: Armory;
  archetype: ArchetypeId;
  xp: number;
  naira: number;
  wins: number;
  matches: number;
  kills: number;
  settings: Settings;
}

const KEY = 'nightfall.profile';

export function defaultProfile(): Profile {
  return {
    version: 3, callsign: 'Survivor', operatorId: OPERATORS[0].id, operators: structuredClone(OPERATORS), armory: defaultArmory(),
    archetype: 'runner', xp: 0, naira: 25000, wins: 0, matches: 0, kills: 0,
    settings: { sensitivity: 1, invertY: false, quality: 'medium', volume: 0.8, music: 0.5, fov: 70, touchControls: 'auto', matchMinutes: 20, showFps: false, gore: true },
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProfile();
    const p = JSON.parse(raw) as Profile;
    if (p.version !== 3) return defaultProfile();
    const d = defaultProfile();
    return { ...d, ...p, settings: { ...d.settings, ...p.settings }, armory: { ...d.armory, ...p.armory } };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable: profile lives for this session only */ }
}

export function currentOperator(p: Profile): Operator {
  return p.operators.find((o) => o.id === p.operatorId) ?? p.operators[0];
}

export function levelOf(xp: number) {
  const level = Math.floor(Math.sqrt(xp / 120)) + 1;
  const cur = 120 * (level - 1) ** 2, next = 120 * level ** 2;
  return { level, progress: (xp - cur) / (next - cur) };
}
