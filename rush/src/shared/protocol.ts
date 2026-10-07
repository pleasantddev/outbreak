// Room protocol, shared by the server and the client. JSON over one WebSocket. Version 1 has no real money anywhere:
// the room creator configures races but can never touch results, physics or rewards.
import type { Livery } from './cars';
import type { RaceMode, TimeOfDay, Weather, RaceEvent, RemoteSnap } from './race';
import type { HazardKind } from './items';
import type { AiLevel } from './ai';
import type { CarClass } from './cars';

export const PROTOCOL_VERSION = 1;

export interface PlayerCard { id: string; name: string; crew: string; color: string; level: number; carId: string; livery: Livery }

export interface RoomConfig {
  track: string; mode: RaceMode; laps: number; aiFill: number; aiLevel: AiLevel; traffic: number;
  time: TimeOfDay; weather: Weather; carClass: CarClass | 'any'; maxPlayers: number; isPublic: boolean; races: number;
}
export const DEFAULT_ROOM: RoomConfig = { track: 'terminal', mode: 'rush', laps: 3, aiFill: 7, aiLevel: 'normal', traffic: 1, time: 'dusk', weather: 'clear', carClass: 'any', maxPlayers: 8, isPublic: false, races: 3 };

export type RoomPhase = 'waiting' | 'countdown' | 'racing' | 'finishing' | 'results' | 'closed';
export interface RoomPlayer { id: string; card: PlayerCard; ready: boolean; host: boolean; connected: boolean; spectating: boolean; ping: number; points: number }
export interface RoomView {
  code: string; phase: RoomPhase; config: RoomConfig; players: RoomPlayer[]; host: string;
  raceNo: number; startsIn: number | null; lastResults: ResultRow[] | null; quick: boolean;
  /** true while the results of the last race in a series are up; points reset when the room opens again */
  seriesOver: boolean;
}
export interface ResultRow { id: string; name: string; human: boolean; place: number; time: number | null; bestLap: number | null; carId: string; points: number }

export const CHAT_PHRASES = ['Oya, let us go!', 'No wahala', 'Good race!', 'Wetin dey happen?', 'One more!', 'Who get am?', 'Shine your eye', 'I dey come', 'Na you biko', 'Rematch?'];

export type ClientMsg =
  | { t: 'hello'; v: number; card: PlayerCard; token?: string }
  | { t: 'quick' }
  | { t: 'cancelQueue' }
  | { t: 'create'; config: Partial<RoomConfig> }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'ready'; on: boolean }
  | { t: 'setCar'; carId: string; livery: Livery }
  | { t: 'config'; patch: Partial<RoomConfig> }
  | { t: 'kick'; id: string }
  | { t: 'chat'; phrase: number }
  | { t: 'start' }
  | { t: 'state'; rt: number; s: RemoteSnap }
  | { t: 'useItem' }
  | { t: 'ping'; ct: number };

export interface RaceStart { startAt: number; seed: number; cfg: { track: string; laps: number; mode: RaceMode; traffic: number; aiLevel: AiLevel; time: TimeOfDay; weather: Weather }; entrants: { id: string; name: string; carId: string; livery: Livery; human: boolean; crew?: string }[]; raceNo: number }
export interface SnapCar { i: number; s: RemoteSnap; lap: number; place: number; fin: boolean; rd: number }
export interface SnapHazard { id: number; k: HazardKind; x: number; y: number; z: number; h: number; s: number; d: number }

export type ServerMsg =
  | { t: 'welcome'; you: string; token: string; version: number; now: number; online: { rooms: number; players: number } }
  | { t: 'queued'; position: number; players: number; eta: number }
  | { t: 'room'; room: RoomView }
  | { t: 'left'; reason: 'left' | 'kicked' | 'closed' }
  | { t: 'race'; race: RaceStart }
  | { t: 'snap'; st: number; rt: number; cars: SnapCar[]; hz: SnapHazard[] }
  | { t: 'ev'; events: RaceEvent[] }
  | { t: 'results'; rows: ResultRow[] }
  | { t: 'chat'; from: string; name: string; phrase: number }
  | { t: 'error'; code: ErrorCode; msg: string }
  | { t: 'pong'; ct: number; st: number };

export type ErrorCode = 'bad_version' | 'not_found' | 'full' | 'in_race' | 'not_host' | 'rate' | 'invalid' | 'not_in_room' | 'server';

export const ROOM_CODE = /^LAGOS-\d{4}$/;
export function normaliseCode(raw: string) {
  const digits = raw.toUpperCase().replace(/[^0-9]/g, '').slice(-4);
  return digits.length === 4 ? `LAGOS-${digits}` : '';
}
