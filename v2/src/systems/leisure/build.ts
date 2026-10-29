// Shared interior builder for venues: floors, walls with cutaway records, colliders, neon, lights. Every venue is
// built far from the city at its own origin and entered through a door on the street (see systems/life/index.ts).
import * as THREE from 'three';
import type { Lot, Wall } from '../life/home';

export const WALL_H = 3.4;
export class Builder {
  g = new THREE.Group(); walls: Wall[] = []; boxes: Lot['boxes'] = []; lights: THREE.PointLight[] = [];
  constructor(origin: THREE.Vector3) { this.g.position.copy(origin); }
  floor(x0: number, z0: number, x1: number, z1: number, m: THREE.Material, y = 0.012) { const f = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), m); f.rotation.x = -Math.PI / 2; f.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); f.receiveShadow = true; this.g.add(f); return f; }
  wall(ax: number, az: number, bx: number, bz: number, m: THREE.Material | THREE.Material[], gaps: [number, number][] = [], h = WALL_H) {
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L; const cuts: [number, number][] = []; let s = 0;
    for (const [g0, g1] of gaps.sort((a, b) => a[0] - b[0])) { if (g0 > s) cuts.push([s, g0]); s = g1; } if (s < L) cuts.push([s, L]);
    for (const [s0, s1] of cuts) {
      const len = s1 - s0; if (len < 0.05) continue; const cx = ax + (ux * (s0 + s1)) / 2, cz = az + (uz * (s0 + s1)) / 2;
      const w = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.14), m as any); w.position.set(cx, h / 2, cz); w.rotation.y = -Math.atan2(uz, ux); w.castShadow = true; w.receiveShadow = true; this.g.add(w);
      this.walls.push({ mesh: w, nx: -uz, nz: ux, cx, cz, full: h }); this.boxes.push({ x: cx, z: cz, w: len, d: 0.14, h, yaw: Math.atan2(uz, ux) });
    }
  }
  room(x0: number, z0: number, x1: number, z1: number, m: THREE.Material, door?: { side: 'n' | 's' | 'e' | 'w'; at: number; w: number }) {
    const gap = (side: string): [number, number][] => (door && door.side === side ? [[door.at - door.w / 2, door.at + door.w / 2]] : []);
    this.wall(x0, z0, x1, z0, m, gap('s')); this.wall(x0, z1, x1, z1, m, gap('n')); this.wall(x0, z0, x0, z1, m, gap('w')); this.wall(x1, z0, x1, z1, m, gap('e'));
  }
  solid(o: THREE.Object3D, w: number, d: number, h: number) { this.g.add(o); this.boxes.push({ x: o.position.x, z: o.position.z, w, d, h, yaw: o.rotation.y }); o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; }
  add(o: THREE.Object3D) { this.g.add(o); o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; }
  light(x: number, y: number, z: number, col: number, I: number, r: number) { const l = new THREE.PointLight(col, I, r, 1.6); l.position.set(x, y, z); this.g.add(l); this.lights.push(l); return l; }
  neon(x: number, y: number, z: number, w: number, h: number, col: number, yaw = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), new THREE.MeshBasicMaterial({ color: col, toneMapped: false })); m.position.set(x, y, z); m.rotation.y = yaw; this.g.add(m); return m; }
  sign(text: string, x: number, y: number, z: number, yaw: number, w: number, fg = '#ffe082', bg = 'rgba(0,0,0,0)', font = '900 54px Rajdhani, Inter, sans-serif') {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const k = c.getContext('2d')!; k.fillStyle = bg; k.fillRect(0, 0, 512, 128);
    k.font = font; k.textAlign = 'center'; k.textBaseline = 'middle'; k.shadowColor = fg; k.shadowBlur = 18; k.fillStyle = fg; k.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = yaw; this.g.add(m); return m;
  }
  lot(spawn: Lot['spawn'], rooms: Lot['rooms'] = []): Lot { const v = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x030305 })); v.rotation.x = -Math.PI / 2; v.position.y = 0.004; v.renderOrder = -1; this.g.add(v); return { group: this.g, walls: this.walls, boxes: this.boxes, placed: [], spawn, exit: { x: spawn.x, z: spawn.z }, lights: this.lights, rooms }; }
}
export function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, rep = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8; return t;
}
export const M = (c: number, r = 0.7, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra });
export const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
export const cyl = (rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y, z); return o; };
