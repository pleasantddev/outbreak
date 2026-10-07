// Room settings validation. Whatever a client sends, the server clamps it to these limits before it touches a room.
import type { RoomConfig } from './protocol';
import { DEFAULT_ROOM } from './protocol';
import type { RaceMode, TimeOfDay, Weather } from './race';
import type { AiLevel } from './ai';
import type { CarClass } from './cars';

const MODES: RaceMode[] = ['rush', 'street', 'stunt', 'trial'];
const TIMES: TimeOfDay[] = ['morning', 'noon', 'dusk', 'night'];
const WEATHERS: Weather[] = ['clear', 'harmattan', 'rain'];
const LEVELS: AiLevel[] = ['easy', 'normal', 'hard', 'lagos'];
const CLASSES: (CarClass | 'any')[] = ['any', 'street', 'sport', 'super', 'heavy'];

const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pick = <T>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

export function sanitiseConfig(patch: Partial<RoomConfig>, base: RoomConfig = DEFAULT_ROOM, tracks: string[] = []): RoomConfig {
  const c: RoomConfig = { ...base };
  if ('track' in patch) c.track = tracks.length ? pick(patch.track, tracks, base.track) : String(patch.track ?? base.track).slice(0, 32);
  if ('mode' in patch) c.mode = pick(patch.mode, MODES, base.mode);
  if (c.mode === 'trial') c.mode = 'street'; // time trial is a solo mode; rooms race
  if ('laps' in patch) c.laps = int(patch.laps, 1, 6, base.laps);
  if ('aiFill' in patch) c.aiFill = int(patch.aiFill, 0, 11, base.aiFill);
  if ('aiLevel' in patch) c.aiLevel = pick(patch.aiLevel, LEVELS, base.aiLevel);
  if ('traffic' in patch) c.traffic = int(patch.traffic, 0, 3, base.traffic);
  if ('time' in patch) c.time = pick(patch.time, TIMES, base.time);
  if ('weather' in patch) c.weather = pick(patch.weather, WEATHERS, base.weather);
  if ('carClass' in patch) c.carClass = pick(patch.carClass, CLASSES, base.carClass);
  if ('maxPlayers' in patch) c.maxPlayers = int(patch.maxPlayers, 2, 12, base.maxPlayers);
  if ('isPublic' in patch) c.isPublic = !!patch.isPublic;
  if ('races' in patch) c.races = int(patch.races, 1, 10, base.races);
  if ('items' in patch) c.items = patch.items !== false;
  // the grid caps at twelve; how many AI actually start is decided at race time from the humans present
  return c;
}
