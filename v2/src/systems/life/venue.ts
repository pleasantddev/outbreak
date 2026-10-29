// A venue is an interior you walk into from a door on the street: your room, the casino, the club, a bank hall.
import type * as THREE from 'three';
import type { Lot } from './home';
import type { Thing } from './index';

export interface Door { x: number; z: number; yaw: number }
export interface Venue {
  id: string; title: string; sub: string; lot: Lot;
  /** where the street door is; null until placed */
  door: Door | null;
  /** pin colour on the map */
  blip: string;
  /** what you can use inside (seats, tables, the bar) */
  things?(): Thing[];
  /** door prompt label */
  label?: string;
  /** closed hours etc; return a reason string to refuse entry */
  refuse?(): string | null;
  /** fee at the door */
  fee?: number;
  enter?(): void; exit?(): void; frame?(dt: number): void;
  /** low walls everywhere (true) or only near the camera (false) */
  cutAll?: boolean;
  /** camera distance and pitch inside */
  cam?: { d: number; pitch: number };
  doorMesh?: THREE.Object3D | null;
}
