// Smart objects: furniture and street things that advertise actions (Sims style). Each def builds its own mesh
// (local space: +z is the object's front, y up, origin on the floor at its centre) and lists actions with the
// spot the player stands/sits/lies at, the clip to play, and how needs change per game hour while it runs.
import * as THREE from 'three';
import type { Need } from './needs';
import { wood, ankara, plaster } from './tex';

export type Pose = 'brush' | 'eat' | 'drink' | 'bucket' | 'phone' | 'cook' | 'wash' | 'read';
export interface LifeAction {
  id: string; label: string;
  /** legacy rate per game hour; used only when `give`/`secs` are not set (then total = gain * minutes / 60) */
  gain: Partial<Record<Need, number>>;
  /** legacy duration in game minutes; with `fill` the action ends early when that need is full */
  minutes: number; fill?: Need;
  clip: string; hold?: number; speed?: number;
  /** where the player goes, in object-local metres, and the facing relative to the object's front (radians) */
  spot: [number, number, number]; y?: number;
  cost?: number; moodlet?: [string, string, number, number];
  /** REAL seconds the action takes and the total it gives over that time (online: the world clock never skips) */
  secs?: number; give?: Partial<Record<Need, number>>;
  /** legacy: ignored, kept so old content parses */
  ff?: number; sleeping?: boolean; sitting?: boolean;
  pose?: Pose; prop?: 'brush' | 'plate' | 'cup' | 'bowl' | 'phone' | 'spoon' | 'book' | 'bottle';
  /** shown in the pie as the effect hint */
  hint?: string;
  /** id of a follow-up effect the life system knows (cook adds food to the cooler, etc.) */
  effect?: string;
  /** only offered when this returns true (checked by the life system: 'hasFood', 'night', ...) */
  when?: string;
}
export interface SmartDef { id: string; name: string; build(): THREE.Object3D; size: [number, number, number]; solid?: boolean; actions: LifeAction[] }

const M = (c: number | string, r = 0.8, m = 0, map?: THREE.Texture) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, map: map ?? null });
function box(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
function cyl(g: THREE.Group, r0: number, r1: number, h: number, x: number, y: number, z: number, mat: THREE.Material, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}

const H = 60; // per hour helpers: +H*k = gains k points per game minute
export const DEFS: Record<string, SmartDef> = {
  bed: {
    id: 'bed', name: 'Spring bed', size: [1.45, 0.55, 2.0], solid: true,
    build() {
      const g = new THREE.Group(); const w = M(0x4a3020, 0.7, 0, wood('#5b3a22'));
      box(g, 1.45, 0.28, 2.0, 0, 0.2, 0, w); box(g, 1.45, 0.75, 0.08, 0, 0.55, -0.98, w);
      box(g, 1.36, 0.2, 1.9, 0, 0.44, 0.02, M(0xece5d6, 0.95));
      const wrap = box(g, 1.38, 0.05, 1.3, 0, 0.56, 0.32, M(0xffffff, 0.9, 0, ankara('#d98e1f', '#21436b'))); wrap.rotation.x = 0;
      box(g, 0.55, 0.12, 0.32, -0.33, 0.6, -0.72, M(0xf3efe6, 0.9)); box(g, 0.55, 0.12, 0.32, 0.33, 0.6, -0.72, M(0xf3efe6, 0.9));
      return g;
    },
    actions: [
      { id: 'sleep', label: 'Sleep (rest a while)', hint: '+Energy', gain: { energy: 12.5 }, minutes: 8 * 60, fill: 'energy', clip: 'LayToIdle', hold: 0.0, spot: [0, -0.1, Math.PI], y: 0.58, ff: 48, sleeping: true, moodlet: ['rested', 'Well rested', 12, 6] },
      { id: 'nap', label: 'Take a nap', hint: '+Energy', gain: { energy: 14 }, minutes: 90, clip: 'LayToIdle', hold: 0.0, spot: [0, -0.1, Math.PI], y: 0.58, ff: 24, sleeping: true },
      { id: 'relax', label: 'Lie down, scroll phone', hint: '+Fun +Comfort', gain: { fun: 8, comfort: 20 }, minutes: 45, clip: 'LayToIdle', hold: 0.0, spot: [0, -0.1, Math.PI], y: 0.58, ff: 6, prop: 'phone', pose: 'phone' },
    ],
  },
  sink: {
    id: 'sink', name: 'Wash hand basin', size: [0.55, 0.9, 0.45], solid: true,
    build() {
      const g = new THREE.Group(); const cer = M(0xf2f2ee, 0.25);
      cyl(g, 0.08, 0.1, 0.78, 0, 0.39, -0.1, cer); box(g, 0.55, 0.14, 0.42, 0, 0.84, 0, cer); box(g, 0.45, 0.06, 0.3, 0, 0.9, 0.02, M(0xb9c3c8, 0.15, 0.2));
      cyl(g, 0.015, 0.015, 0.18, 0, 0.98, -0.16, M(0xc9cdd0, 0.2, 1)); box(g, 0.4, 0.55, 0.02, 0, 1.45, -0.21, M(0x9fb4c0, 0.05, 0.9));
      box(g, 0.08, 0.1, 0.05, 0.22, 0.98, -0.16, M(0x1e88e5, 0.4)); // toothpaste cup
      return g;
    },
    actions: [
      { id: 'brush', label: 'Brush teeth', hint: '+Hygiene', gain: { hygiene: 30 }, minutes: 5, clip: 'Idle_Loop', spot: [0, 0.55, Math.PI], pose: 'brush', prop: 'brush', moodlet: ['fresh', 'Fresh breath', 6, 5] },
      { id: 'wash', label: 'Wash face', hint: '+Hygiene', gain: { hygiene: 40 }, minutes: 3, clip: 'Idle_Loop', spot: [0, 0.55, Math.PI], pose: 'wash' },
      { id: 'mirror', label: 'Check yourself out', hint: '+Fun', gain: { fun: 30 }, minutes: 3, clip: 'Yes', spot: [0, 0.6, Math.PI], moodlet: ['confident', 'Looking sharp', 5, 3] },
    ],
  },
  toilet: {
    id: 'toilet', name: 'Toilet', size: [0.45, 0.8, 0.7], solid: false,
    build() {
      const g = new THREE.Group(); const cer = M(0xf4f4f0, 0.25);
      cyl(g, 0.17, 0.2, 0.4, 0, 0.2, 0.05, cer); box(g, 0.42, 0.06, 0.48, 0, 0.42, 0.07, M(0xf0ece4, 0.35)); box(g, 0.42, 0.38, 0.18, 0, 0.62, -0.26, cer);
      return g;
    },
    actions: [{ id: 'use', label: 'Use the toilet', hint: '+Bladder', gain: { bladder: 900, hygiene: -6 }, minutes: 5, fill: 'bladder', clip: 'Sitting_Idle_Loop', spot: [0, 0.12, 0], sitting: true }],
  },
  bucket: {
    id: 'bucket', name: 'Bucket and bowl', size: [0.4, 0.4, 0.4],
    build() {
      const g = new THREE.Group(); const p = M(0x1565c0, 0.5);
      const b = cyl(g, 0.2, 0.16, 0.38, 0, 0.19, 0, p); void b; cyl(g, 0.19, 0.19, 0.02, 0, 0.36, 0, M(0x6fa8c8, 0.05, 0.1));
      cyl(g, 0.09, 0.06, 0.08, 0.28, 0.04, 0.1, M(0xd84315, 0.5)); return g;
    },
    actions: [{ id: 'bath', label: 'Bucket bath', hint: '+Hygiene', gain: { hygiene: 140, comfort: 20 }, minutes: 12, fill: 'hygiene', clip: 'Farm_Watering', spot: [0, 0.55, Math.PI], moodlet: ['clean', 'Fresh and clean', 10, 6] },
      { id: 'clothes', label: 'Wash your clothes', hint: 'Clean clothes', gain: {}, minutes: 0, secs: 35, give: { fun: -4 }, clip: 'Farm_Watering', spot: [0, 0.55, Math.PI], effect: 'laundry' }],
  },
  stove: {
    id: 'stove', name: 'Gas cooker', size: [0.6, 0.85, 0.5], solid: true,
    build() {
      const g = new THREE.Group(); box(g, 0.6, 0.8, 0.5, 0, 0.4, 0, M(0xe8e6e0, 0.4, 0.3)); box(g, 0.56, 0.02, 0.46, 0, 0.81, 0, M(0x202020, 0.4, 0.5));
      cyl(g, 0.15, 0.13, 0.16, -0.13, 0.9, 0, M(0x9e9e9e, 0.3, 0.9)); cyl(g, 0.12, 0.12, 0.12, 0.15, 0.88, 0.05, M(0xc62828, 0.4, 0.3));
      cyl(g, 0.17, 0.17, 0.9, 0.45, 0.45, -0.1, M(0x2e7d32, 0.5, 0.4)); // gas cylinder
      return g;
    },
    actions: [
      { id: 'cook', label: 'Cook stew and rice', hint: '+Food x3', gain: { fun: 5 }, minutes: 50, clip: 'Interact', speed: 0.6, spot: [0, 0.6, Math.PI], cost: 2500, effect: 'cook3', ff: 4, moodlet: ['cooked', 'Cooked a proper meal', 8, 8] },
      { id: 'noodles', label: 'Make noodles and egg', hint: '+Food', gain: {}, minutes: 12, clip: 'Interact', speed: 0.6, spot: [0, 0.6, Math.PI], cost: 600, effect: 'cook1', ff: 2 },
    ],
  },
  cooler: {
    id: 'cooler', name: 'Food cooler', size: [0.5, 0.5, 0.4], solid: true,
    build() { const g = new THREE.Group(); box(g, 0.52, 0.42, 0.38, 0, 0.21, 0, M(0x1976d2, 0.45)); box(g, 0.54, 0.08, 0.4, 0, 0.46, 0, M(0xeceff1, 0.4)); return g; },
    actions: [
      { id: 'eat', label: 'Eat leftovers', hint: '+Hunger', gain: { hunger: 160 }, minutes: 15, fill: 'hunger', clip: 'Consume', speed: 0.5, spot: [0, 0.55, Math.PI], prop: 'plate', when: 'hasFood', effect: 'eat1' },
      { id: 'water', label: 'Drink water', hint: '+Hunger', gain: { hunger: 20, bladder: -60 }, minutes: 2, clip: 'Consume', spot: [0, 0.55, Math.PI], prop: 'cup' },
    ],
  },
  chair: {
    id: 'chair', name: 'Plastic chair', size: [0.5, 0.85, 0.5],
    build() {
      const g = new THREE.Group(); const p = M(0xf5f5f5, 0.45);
      box(g, 0.48, 0.04, 0.45, 0, 0.44, 0, p); box(g, 0.48, 0.42, 0.04, 0, 0.66, -0.22, p);
      for (const [x, z] of [[-0.21, -0.19], [0.21, -0.19], [-0.21, 0.19], [0.21, 0.19]]) cyl(g, 0.02, 0.025, 0.44, x, 0.22, z, p, 6);
      return g;
    },
    actions: [
      { id: 'sit', label: 'Sit down', hint: '+Comfort', gain: { comfort: 30 }, minutes: 30, fill: 'comfort', clip: 'Sitting_Idle_Loop', spot: [0, 0.05, 0], sitting: true },
      { id: 'phone', label: 'Sit and press phone', hint: '+Fun +Social', gain: { fun: 14, social: 6, comfort: 24 }, minutes: 40, clip: 'Sitting_Idle_Loop', spot: [0, 0.05, 0], sitting: true, prop: 'phone', pose: 'phone' },
    ],
  },
  tv: {
    id: 'tv', name: 'Small TV', size: [0.75, 0.9, 0.4], solid: true,
    build() {
      const g = new THREE.Group(); box(g, 0.7, 0.55, 0.4, 0, 0.28, 0, M(0x4e342e, 0.7, 0, wood('#4e342e', 7)));
      box(g, 0.66, 0.4, 0.05, 0, 0.78, 0, M(0x111111, 0.3, 0.3));
      const scr = box(g, 0.6, 0.34, 0.01, 0, 0.78, 0.028, new THREE.MeshStandardMaterial({ color: 0x0a0f18, emissive: new THREE.Color(0x3a6ea8), emissiveIntensity: 1.2, roughness: 0.2 })); scr.name = 'screen';
      return g;
    },
    actions: [
      { id: 'watch', label: 'Watch Nollywood', hint: '+Fun', gain: { fun: 18, comfort: 10 }, minutes: 60, clip: 'Sitting_Idle_Loop', spot: [0, 1.6, Math.PI], sitting: true, moodlet: ['entertained', 'That film sweet', 6, 3] },
      { id: 'football', label: 'Watch football', hint: '+Fun', gain: { fun: 22 }, minutes: 90, clip: 'Sitting_Idle_Loop', spot: [0, 1.6, Math.PI], sitting: true, when: 'evening' },
    ],
  },
  fan: {
    id: 'fan', name: 'Standing fan', size: [0.4, 1.3, 0.4],
    build() {
      const g = new THREE.Group(); const m = M(0xeceff1, 0.4);
      cyl(g, 0.2, 0.22, 0.04, 0, 0.02, 0, m); cyl(g, 0.02, 0.02, 1.0, 0, 0.52, 0, M(0xb0bec5, 0.3, 0.8));
      const head = new THREE.Group(); head.position.set(0, 1.1, 0.02); g.add(head);
      const cage = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.008, 6, 32), M(0xb0bec5, 0.3, 0.8)); head.add(cage);
      const rot = new THREE.Group(); rot.name = 'blades'; head.add(rot);
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.005), M(0x42a5f5, 0.5)); b.position.y = 0.09; const p = new THREE.Group(); p.rotation.z = (i / 3) * Math.PI * 2; p.add(b); rot.add(p); }
      return g;
    },
    actions: [{ id: 'toggle', label: 'Switch fan on / off', hint: '+Comfort', gain: {}, minutes: 1, clip: 'Interact', spot: [0, 0.55, Math.PI], effect: 'fan' }],
  },
  wardrobe: {
    id: 'wardrobe', name: 'Wardrobe', size: [1.0, 1.9, 0.55], solid: true,
    build() { const g = new THREE.Group(); const w = M(0x6d4c41, 0.6, 0, wood('#6d4c41', 17)); box(g, 1.0, 1.9, 0.55, 0, 0.95, 0, w); box(g, 0.02, 1.7, 0.02, 0, 1.0, 0.28, M(0x3e2723, 0.5)); box(g, 0.04, 0.12, 0.03, -0.06, 1.0, 0.29, M(0xc0a060, 0.3, 0.9)); box(g, 0.04, 0.12, 0.03, 0.06, 1.0, 0.29, M(0xc0a060, 0.3, 0.9)); return g; },
    actions: [{ id: 'change', label: 'Change clothes', hint: 'New fit', gain: { fun: 10 }, minutes: 4, clip: 'Chest_Open', spot: [0, 0.6, Math.PI], effect: 'outfit' }],
  },
  table: {
    id: 'table', name: 'Small table', size: [0.8, 0.75, 0.6], solid: true,
    build() { const g = new THREE.Group(); const w = M(0x5d4037, 0.6, 0, wood('#5d4037', 23)); box(g, 0.8, 0.04, 0.6, 0, 0.73, 0, w); for (const [x, z] of [[-0.36, -0.26], [0.36, -0.26], [-0.36, 0.26], [0.36, 0.26]]) box(g, 0.04, 0.72, 0.04, x, 0.36, z, w); return g; },
    actions: [{ id: 'read', label: 'Read a book', hint: '+Fun, skill', gain: { fun: 8, comfort: 6 }, minutes: 45, clip: 'Sitting_Idle_Loop', spot: [0, 0.65, Math.PI], sitting: true, prop: 'book', pose: 'read', effect: 'study' }],
  },
  door: {
    id: 'door', name: 'Door', size: [0.9, 2.1, 0.08],
    build() { const g = new THREE.Group(); box(g, 0.9, 2.05, 0.05, 0, 1.03, 0, M(0x5d4037, 0.6, 0, wood('#4e342e', 29))); box(g, 0.05, 0.05, 0.08, 0.36, 1.0, 0.04, M(0xc0a060, 0.3, 1)); return g; },
    actions: [],
  },
  poster: {
    id: 'poster', name: 'Wall calendar', size: [0.5, 0.7, 0.02],
    build() { const g = new THREE.Group(); box(g, 0.5, 0.7, 0.01, 0, 1.6, 0, M(0xffffff, 0.8, 0, plaster('#f4e3c1', 41))); box(g, 0.44, 0.26, 0.012, 0, 1.78, 0.002, M(0x2e7d32, 0.7)); return g; },
    actions: [],
  },
};

/** Props held in the hand during actions. */
export function propMesh(kind: NonNullable<LifeAction['prop']>) {
  const g = new THREE.Group();
  if (kind === 'brush') { box(g, 0.012, 0.012, 0.17, 0, 0, 0.06, M(0x29b6f6, 0.4)); box(g, 0.016, 0.02, 0.025, 0, 0.012, 0.14, M(0xffffff, 0.8)); }
  if (kind === 'phone') { box(g, 0.07, 0.008, 0.15, 0, 0, 0.05, new THREE.MeshStandardMaterial({ color: 0x0b0b0d, emissive: new THREE.Color(0x7aa0ff), emissiveIntensity: 0.8, roughness: 0.3 })); }
  if (kind === 'plate') { cyl(g, 0.12, 0.1, 0.02, 0, 0, 0.08, M(0xfafafa, 0.3)); cyl(g, 0.08, 0.06, 0.04, 0, 0.02, 0.08, M(0xd35400, 0.8)); }
  if (kind === 'cup') cyl(g, 0.035, 0.03, 0.09, 0, 0, 0.05, M(0xe53935, 0.4));
  if (kind === 'bowl') cyl(g, 0.09, 0.06, 0.06, 0, 0, 0.06, M(0xff7043, 0.5));
  if (kind === 'spoon') box(g, 0.01, 0.005, 0.15, 0, 0, 0.06, M(0xc0c0c0, 0.2, 1));
  if (kind === 'book') box(g, 0.15, 0.03, 0.21, 0, 0, 0.08, M(0x6a1b9a, 0.6));
  if (kind === 'bottle') cyl(g, 0.03, 0.03, 0.22, 0, 0, 0.08, M(0x2e7d32, 0.2, 0.1));
  return g;
}

/** Real-time tuning for every home action: [seconds, what it gives in total]. Sleep is a rest, not a time skip: lie down,
 *  energy climbs about a point a second, get up whenever you like. */
const TUNE: Record<string, [number, Partial<Record<Need, number>>]> = {
  'bed.sleep': [75, { energy: 70, comfort: 15 }], 'bed.nap': [25, { energy: 22 }], 'bed.relax': [20, { fun: 12, comfort: 15 }],
  'sink.brush': [10, { hygiene: 12 }], 'sink.wash': [6, { hygiene: 8 }], 'sink.mirror': [5, { fun: 5 }],
  'toilet.use': [9, { bladder: 100, hygiene: -2 }], 'bucket.bath': [22, { hygiene: 100, comfort: 10 }],
  'stove.cook': [30, { fun: 4 }], 'stove.noodles': [12, {}], 'cooler.eat': [14, { hunger: 45 }], 'cooler.water': [4, { hunger: 5, bladder: -10 }],
  'chair.sit': [15, { comfort: 40 }], 'chair.phone': [20, { fun: 12, social: 8, comfort: 10 }],
  'tv.watch': [30, { fun: 20, comfort: 10 }], 'tv.football': [45, { fun: 28, social: 4 }],
  'fan.toggle': [2, {}], 'wardrobe.change': [6, { fun: 5 }], 'table.read': [25, { fun: 6, comfort: 5 }],
};
for (const d of Object.values(DEFS)) for (const a of d.actions) { const t = TUNE[`${d.id}.${a.id}`]; if (t) { a.secs = t[0]; a.give = t[1]; a.ff = undefined; } }
/** seconds and totals for any action, including ones other systems build the legacy way */
export function planOf(a: LifeAction): { secs: number; give: Partial<Record<Need, number>> } {
  if (a.secs !== undefined) return { secs: a.secs, give: a.give ?? {} };
  const give: Partial<Record<Need, number>> = {}; for (const [k, v] of Object.entries(a.gain)) give[k as Need] = (v ?? 0) * a.minutes / 60;
  return { secs: Math.max(3, Math.min(45, a.minutes * 0.35)), give };
}
