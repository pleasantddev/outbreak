// Room protocol, shared by the server and the client. JSON over one WebSocket. Version 1 has no real money anywhere:
// the room creator configures races but can never touch results, physics or rewards.
import type { Livery } from './cars';
import type { RaceMode, TimeOfDay, Weather, RaceEvent, RemoteSnap } from './race';
import { HAZARD_KINDS, type HazardKind } from './items';
import type { AiLevel } from './ai';
import type { CarClass } from './cars';

export const PROTOCOL_VERSION = 2;

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
  | { t: 'state'; rt: number; s: number[] }
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
  | { t: 'snap'; st: number; rt: number; c: number[][]; z: number[][] }
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

// ------------------------------------------------------------------------------------------- packing
// Snapshots go out twenty times a second to every player, so they travel as rounded number arrays, not objects:
// about 90 bytes a car instead of 450, before the socket's own compression. Centimetres and milliradians are far
// finer than anyone can see at 100 ms of interpolation.

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A car's state: x y z h vx vy vz pitch roll flags driftTier boostT spinT danfoT. */
export function packState(s: RemoteSnap): number[] {
  const flags = (s.drifting ? 1 : 0) | (s.nitro ? 2 : 0) | (s.grounded ? 4 : 0);
  return [r2(s.x), r2(s.y), r2(s.z), r3(s.h), r2(s.vx), r2(s.vy), r2(s.vz), r3(s.pitch), r3(s.roll), flags, s.driftTier | 0, r2(s.boostT), r2(s.spinT), r2(s.danfoT)];
}
export const STATE_LEN = 14;
export function unpackState(a: number[], o = 0): RemoteSnap {
  const f = a[o + 9] | 0;
  return { x: a[o], y: a[o + 1], z: a[o + 2], h: a[o + 3], vx: a[o + 4], vy: a[o + 5], vz: a[o + 6], pitch: a[o + 7], roll: a[o + 8], drifting: !!(f & 1), nitro: !!(f & 2), grounded: !!(f & 4), driftTier: a[o + 10], boostT: a[o + 11], spinT: a[o + 12], danfoT: a[o + 13] };
}
/** A state array from a client is only accepted if it is the right length and every entry is a finite number. */
export function validState(a: unknown): a is number[] {
  return Array.isArray(a) && a.length === STATE_LEN && a.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Snapshot car: i, the state, then lap place fin raceDist. */
export function packCar(c: SnapCar): number[] { return [c.i, ...packState(c.s), c.lap, c.place, c.fin ? 1 : 0, Math.round(c.rd * 10) / 10]; }
export function unpackCar(a: number[]): SnapCar { const o = 1 + STATE_LEN; return { i: a[0], s: unpackState(a, 1), lap: a[o], place: a[o + 1], fin: a[o + 2] === 1, rd: a[o + 3] }; }
export function packHazard(h: SnapHazard): number[] { return [h.id, HAZARD_KINDS.indexOf(h.k), r2(h.x), r2(h.y), r2(h.z), r3(h.h), r2(h.s), r2(h.d)]; }
export function unpackHazard(a: number[]): SnapHazard { return { id: a[0], k: HAZARD_KINDS[a[1]] ?? 'pothole', x: a[2], y: a[3], z: a[4], h: a[5], s: a[6], d: a[7] }; }
