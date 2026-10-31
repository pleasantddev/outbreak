// The player's first home: a room in a "face-me-I-face-you" bungalow. A corridor with rooms both sides, your room
// furnished, the cooker in the corridor like everybody's, a shared bathroom and toilet at the back.
// Built far from the city (its own lot) and entered through a door on the street, Sims style.
import * as THREE from 'three';
import { DEFS } from './objects';
import { plaster, tiles, lino, terrazzo } from './tex';

export const HOME_ORIGIN = new THREE.Vector3(30000, 0, 30000);
export interface Placed { def: string; x: number; z: number; yaw: number; obj: THREE.Object3D; label?: string }
export interface Wall { mesh: THREE.Mesh; nx: number; nz: number; cx: number; cz: number; full: number }
export interface Lot { group: THREE.Group; walls: Wall[]; boxes: { x: number; z: number; w: number; d: number; h: number; yaw: number; p?: Placed }[]; mats?: { room: THREE.MeshStandardMaterial; floor: THREE.MeshStandardMaterial }; placed: Placed[]; spawn: { x: number; z: number; yaw: number }; exit: { x: number; z: number }; lights: THREE.PointLight[]; ceil?: { x0: number; z0: number; x1: number; z1: number; y: number }; rooms: { name: string; x0: number; z0: number; x1: number; z1: number }[] }

const WALL_H = 2.85, T = 0.12;

export function buildHome(): Lot {
  const g = new THREE.Group(); g.position.copy(HOME_ORIGIN);
  const walls: Wall[] = []; const boxes: Lot['boxes'] = []; const placed: Placed[] = [];
  const mat = {
    corridor: new THREE.MeshStandardMaterial({ map: plaster('#d9cfb2', 2), roughness: 0.92 }),
    room: new THREE.MeshStandardMaterial({ map: plaster('#9cc3d5', 4), roughness: 0.9 }),
    outer: new THREE.MeshStandardMaterial({ map: plaster('#c9b38a', 6), roughness: 0.95 }),
    bath: new THREE.MeshStandardMaterial({ map: tiles('#e6eef0', '#b6c2c6', 10), roughness: 0.35 }),
  };
  const floorM = {
    room: new THREE.MeshStandardMaterial({ map: lino(9), roughness: 0.6 }),
    corridor: new THREE.MeshStandardMaterial({ map: terrazzo(31), roughness: 0.75 }),
    bath: new THREE.MeshStandardMaterial({ map: tiles('#8fa9b3', '#5e737b', 6), roughness: 0.4 }),
  };
  for (const m of Object.values(floorM)) { m.map!.repeat.set(2, 2); }
  const floor = (x0: number, z0: number, x1: number, z1: number, m: THREE.Material) => {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), m); f.rotation.x = -Math.PI / 2; f.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2); f.receiveShadow = true; g.add(f);
  };
  /** a straight wall from a to b, leaving gaps [s0, s1] measured along it */
  const wall = (ax: number, az: number, bx: number, bz: number, m: THREE.Material, gaps: [number, number][] = [], inner?: THREE.Material) => {
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const cuts: [number, number][] = []; let s = 0;
    for (const [g0, g1] of gaps.sort((a, b) => a[0] - b[0])) { if (g0 > s) cuts.push([s, g0]); s = g1; }
    if (s < L) cuts.push([s, L]);
    for (const [s0, s1] of cuts) {
      const len = s1 - s0; if (len < 0.05) continue;
      const cx = ax + ux * (s0 + s1) / 2, cz = az + uz * (s0 + s1) / 2;
      const geo = new THREE.BoxGeometry(len, WALL_H, T);
      const mm = inner ? [m, m, m, m, inner, m] : m;
      const w = new THREE.Mesh(geo, mm as any); w.position.set(cx, WALL_H / 2, cz); w.rotation.y = -Math.atan2(uz, ux); w.castShadow = true; w.receiveShadow = true; g.add(w);
      walls.push({ mesh: w, nx: -uz, nz: ux, cx, cz, full: WALL_H });
      boxes.push({ x: cx, z: cz, w: len, d: T, h: WALL_H, yaw: Math.atan2(uz, ux) });
    }
  };
  // ---- layout (metres, local): corridor x -1..1, z 0..14; rooms 3.6 x 3.5 both sides; bath/toilet z 14..16.4
  floor(-1, 0, 1, 14, floorM.corridor); floor(1, 3.5, 4.6, 7, floorM.room); floor(-2.2, 14, 2.2, 16.4, floorM.bath);
  floor(-4.6, -2.5, 4.6, 0, floorM.corridor); // front pavement
  const doorZ = [1.75, 5.25, 8.75, 12.25];
  const gapsAt = (zs: number[], w = 0.9) => zs.map((z) => [z - w / 2, z + w / 2] as [number, number]);
  wall(-1, 0, -1, 14, mat.corridor, gapsAt(doorZ));
  wall(1, 0, 1, 14, mat.corridor, gapsAt(doorZ));
  wall(-4.6, 0, 4.6, 0, mat.outer, [[4.6 - 0.6, 4.6 + 0.6]]); // front wall with the entrance
  wall(-4.6, 0, -4.6, 14, mat.outer); wall(4.6, 0, 4.6, 14, mat.outer, [[4.9, 6.1]]); // window in your room
  for (const z of [3.5, 7, 10.5]) { wall(-4.6, z, -1, z, mat.corridor); wall(1, z, 4.6, z, z === 3.5 || z === 7 ? mat.room : mat.corridor); }
  wall(-4.6, 14, 4.6, 14, mat.corridor, [[4.05 - 0.4, 4.05 + 0.4], [5.15 - 0.4, 5.15 + 0.4]]); // doors to bath (x=-0.55) and toilet (x=0.55)
  wall(-2.2, 14, -2.2, 16.4, mat.bath); wall(2.2, 14, 2.2, 16.4, mat.bath); wall(-2.2, 16.4, 2.2, 16.4, mat.bath); wall(0, 14, 0, 16.4, mat.bath);
  // window bars and frame in your room
  const bars = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.5, metalness: 0.7 });
  for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.2, 0.02), bars); b.position.set(4.6, 1.5, 4.95 + i * 0.22); g.add(b); }
  const sill = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 1.2), mat.outer); sill.position.set(4.6, 0.45, 5.5); g.add(sill); boxes.push({ x: 4.6, z: 5.5, w: 0.16, d: 1.2, h: 0.9, yaw: 0 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 1.2), mat.outer); top.position.set(4.6, WALL_H - 0.37, 5.5); g.add(top);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xbfe3ff, emissive: new THREE.Color(0x9cc8ff), emissiveIntensity: 0.6, transparent: true, opacity: 0.35 })); glass.position.set(4.62, 1.5, 5.5); glass.rotation.y = -Math.PI / 2; g.add(glass);
  // closed doors of the neighbours, your door open
  const place = (def: string, x: number, z: number, yaw: number, label?: string) => {
    const d = DEFS[def]; const o = d.build(); o.position.set(x, 0, z); o.rotation.y = yaw; g.add(o);
    o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    placed.push({ def, x, z, yaw, obj: o, label });
    const pl = placed[placed.length - 1]; if (d.solid) boxes.push({ x, z, w: d.size[0], d: d.size[2], h: d.size[1], yaw, p: pl });
    return o;
  };
  for (const z of doorZ) { place('door', -1, z, Math.PI / 2); if (z !== 5.25) place('door', 1, z, -Math.PI / 2); }
  { const d = place('door', 1.0, 5.25 - 0.45, 0); d.rotation.y = -Math.PI * 0.05; d.position.set(1.42, 0, 4.8); }
  // your room
  place('bed', 3.75, 5.95, Math.PI);
  place('wardrobe', 1.65, 6.62, Math.PI);
  place('tv', 2.55, 3.85, 0);
  place('chair', 2.55, 5.2, Math.PI);
  place('fan', 4.2, 3.95, -Math.PI * 0.75);
  place('table', 1.45, 4.15, Math.PI / 2);
  place('poster', 3.2, 3.58, 0);
  // the corridor kitchen, the shared bathroom and toilet
  place('stove', 0.66, 6.6, -Math.PI / 2);
  place('cooler', 0.7, 4.1, -Math.PI / 2);
  place('sink', -1.6, 16.12, Math.PI);
  place('bucket', -0.75, 15.3, Math.PI);
  place('toilet', 1.1, 16.0, Math.PI);
  // a few lived-in details: slippers, a kettle, the neighbours' things in the corridor
  const misc = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.8 });
  for (const [x, z, w, h, d, c] of [[-0.75, 2.6, 0.5, 0.35, 0.35, 0xff7043], [-0.7, 9.6, 0.4, 0.6, 0.4, 0x1e88e5], [0.72, 11.4, 0.45, 0.45, 0.35, 0x43a047], [-0.8, 12.9, 0.3, 0.9, 0.3, 0x6d4c41]] as number[][]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), c ? new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }) : misc); m.position.set(x, h / 2, z); m.castShadow = true; g.add(m); boxes.push({ x, z, w, d, h, yaw: 0 });
  }
  // the compound around the house: sand and concrete, a fence, a tank on stilts, a generator, a clothes line
  const sand = new THREE.MeshStandardMaterial({ map: plaster('#b49a74', 77), roughness: 1 }); sand.map!.repeat.set(8, 8);
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), sand); yard.rotation.x = -Math.PI / 2; yard.position.set(0, 0.004, 7); yard.receiveShadow = true; g.add(yard);
  const fenceM = new THREE.MeshStandardMaterial({ map: plaster('#a39277', 13), roughness: 0.95 });
  const fence = (ax: number, az: number, bx: number, bz: number) => { const L = Math.hypot(bx - ax, bz - az); const m = new THREE.Mesh(new THREE.BoxGeometry(L, 1.9, 0.2), fenceM); m.position.set((ax + bx) / 2, 0.95, (az + bz) / 2); m.rotation.y = -Math.atan2(bz - az, bx - ax); m.castShadow = true; m.receiveShadow = true; g.add(m); boxes.push({ x: m.position.x, z: m.position.z, w: L, d: 0.2, h: 1.9, yaw: Math.atan2(bz - az, bx - ax) }); };
  fence(-9, -7, -2.2, -7); fence(2.2, -7, 9, -7); fence(-9, -7, -9, 20); fence(9, -7, 9, 20); fence(-9, 20, 9, 20);
  const gate = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.9, 0.08), new THREE.MeshStandardMaterial({ color: 0x1f3b2d, metalness: 0.6, roughness: 0.45 })); gate.position.set(0, 0.95, -7); g.add(gate);
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a4f55, metalness: 0.6, roughness: 0.5 });
  for (const [x, z] of [[-6.6, 16.4], [-5.2, 16.4], [-6.6, 17.8], [-5.2, 17.8]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.12), metal); l.position.set(x, 1.6, z); g.add(l); }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.5, 20), new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 })); tank.position.set(-5.9, 3.95, 17.1); tank.castShadow = true; g.add(tank);
  const gen = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.6), new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.5, metalness: 0.3 })); gen.position.set(6.3, 0.35, 15.6); gen.castShadow = true; g.add(gen); boxes.push({ x: 6.3, z: 15.6, w: 0.9, d: 0.6, h: 0.7, yaw: 0 });
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 8, 4), metal); line.rotation.z = Math.PI / 2; line.position.set(-5, 1.9, -4.5); g.add(line);
  const cloths = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xffffff, 0x8e24aa];
  for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), new THREE.MeshStandardMaterial({ color: cloths[i], side: THREE.DoubleSide, roughness: 0.9 })); c.position.set(-8.2 + i * 1.2, 1.45, -4.5); c.rotation.y = 0.05 * i; g.add(c); }
  // the ceiling: painted board, seen from inside only
  { const cm = new THREE.MeshStandardMaterial({ map: plaster('#ece6d6', 91), roughness: 0.95, side: THREE.BackSide }); const cl = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 16.4), cm); cl.rotation.x = -Math.PI / 2; cl.position.set(0, 2.85, 8.2); g.add(cl); }
  // light: warm bulb in your room, a cold tube in the corridor, a dim one in the bathroom
  const lights: THREE.PointLight[] = [];
  const bulb = (x: number, y: number, z: number, col: number, I: number, r: number) => { const l = new THREE.PointLight(col, I, r, 1.6); l.position.set(x, y, z); g.add(l); lights.push(l); const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: col })); l.add(m); }; // the bulb glass is a child of its light, so it goes dark with it
  bulb(2.8, 2.6, 5.2, 0xffd6a0, 9, 7); bulb(0, 2.7, 7, 0xdff4ff, 7, 11); bulb(0, 2.6, 15.2, 0xfff0d0, 4, 4.5);
  // moonlight through the window of your room, only shown when the bulbs are off (systems/life/bills.ts)
  const moon = new THREE.PointLight(0x86a4e8, 2.4, 9, 1.5); moon.position.set(5.7, 2.0, 5.5); moon.name = 'moon'; moon.visible = false; g.add(moon);
  return {
    group: g, walls, boxes, placed, lights, mats: { room: mat.room, floor: floorM.room },
    spawn: { x: 0, z: 1.1, yaw: 0 }, exit: { x: 0, z: -0.9 }, ceil: { x0: -4.6, z0: 0, x1: 4.6, z1: 16.4, y: 2.85 },
    rooms: [{ name: 'Your room', x0: 1, z0: 3.5, x1: 4.6, z1: 7 }, { name: 'Corridor', x0: -1, z0: 0, x1: 1, z1: 14 }, { name: 'Bathroom', x0: -2.2, z0: 14, x1: 0, z1: 16.4 }, { name: 'Toilet', x0: 0, z0: 14, x1: 2.2, z1: 16.4 }],
  };
}
