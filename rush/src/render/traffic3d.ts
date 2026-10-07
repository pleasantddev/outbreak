// Civilian vehicles: yellow danfos with black stripes, tokunbo saloons, kekes, okadas with riders, red and blue BRT
// buses, old molues, fuel tankers and container trailers. Each kind is two instanced meshes (paint and details),
// so a street full of traffic costs sixteen draw calls.
import * as THREE from 'three';
import { GeoBuilder } from './geom';
import { TRAFFIC_KINDS, type TrafficKind, type TrafficPose } from '../shared/traffic';
import { hash01 } from '../shared/rng';

type C3 = [number, number, number];
const BLACK: C3 = [0.04, 0.04, 0.045], GLASS: C3 = [0.07, 0.09, 0.11], CHROME: C3 = [0.7, 0.72, 0.74], TYRE: C3 = [0.05, 0.05, 0.05], LAMP: C3 = [1.8, 1.7, 1.4], TAIL: C3 = [1.4, 0.08, 0.06], WHITE: C3 = [0.9, 0.9, 0.88];

function wheels(d: GeoBuilder, xs: number, zs: number[], r: number, w: number) {
  d.setColor(TYRE);
  for (const z of zs) for (const sx of [-1, 1]) {
    // a wheel as a short cylinder lying on its side
    const seg = 10, cx = sx * xs, cy = r;
    const base = d.count;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, y = cy + Math.sin(a) * r, zz = z + Math.cos(a) * r;
      d.vertex(cx - w / 2, y, zz, 0, Math.sin(a), Math.cos(a), 0, 0); d.vertex(cx + w / 2, y, zz, 0, Math.sin(a), Math.cos(a), 0, 0);
    }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; d.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    d.setColor(CHROME); d.box(cx + sx * w * 0.5, cy - r * 0.45, z, 0.02, r * 0.9, r * 0.9); d.setColor(TYRE);
  }
}

/** A cylinder lying along z, for tanker barrels. */
function tubeZ(d: GeoBuilder, x: number, y: number, z: number, r: number, len: number, seg: number) {
  const base = d.count;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
    d.vertex(x + cx * r, y + cy * r, z - len / 2, cx, cy, 0, 0, 0); d.vertex(x + cx * r, y + cy * r, z + len / 2, cx, cy, 0, 0, 0);
  }
  for (let i = 0; i < seg; i++) { const a = base + i * 2; d.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  for (const end of [-1, 1]) {
    const c = d.vertex(x, y, z + (end * len) / 2, 0, 0, end, 0, 0), ring = d.count;
    for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; d.vertex(x + Math.cos(a) * r, y + Math.sin(a) * r, z + (end * len) / 2, 0, 0, end, 0, 0); }
    for (let i = 0; i < seg; i++) { if (end > 0) d.idx.push(c, ring + i, ring + i + 1); else d.idx.push(c, ring + i + 1, ring + i); }
  }
}

/** Build paint and detail geometry for one traffic kind, facing +z, origin at ground centre. */
export function vehicleGeometry(kind: TrafficKind): { paint: THREE.BufferGeometry; detail: THREE.BufferGeometry } {
  const p = new GeoBuilder(), d = new GeoBuilder();
  const k = TRAFFIC_KINDS[kind];
  const L = k.len, W = k.w;
  switch (kind) {
    case 'danfo': {
      p.box(0, 0.42, 0, W, 1.0, L);                         // lower body
      p.box(0, 1.42, -0.15, W * 0.98, 0.18, L - 0.5);       // above the windows
      d.setColor(GLASS); d.box(0, 1.42, 0.05, W * 1.0, 0.0, L - 0.9); d.box(0, 1.0, -0.1, W * 1.01, 0.48, L - 1.0);
      d.box(0, 1.05, L / 2 - 0.42, W * 0.92, 0.55, 0.08);  // windscreen
      d.setColor(BLACK); d.box(0, 0.78, 0, W * 1.015, 0.08, L * 0.96); d.box(0, 0.62, 0, W * 1.015, 0.04, L * 0.96);
      d.setColor(CHROME); d.box(0, 1.62, -0.2, W * 0.8, 0.06, L * 0.7);    // roof rack
      for (let z = -1.6; z <= 1.2; z += 0.7) d.box(0, 1.62, z, W * 0.82, 0.12, 0.05);
      d.setColor(LAMP); for (const s of [-1, 1]) d.box(s * W * 0.36, 0.72, L / 2, 0.22, 0.14, 0.04);
      d.setColor(TAIL); for (const s of [-1, 1]) d.box(s * W * 0.4, 0.7, -L / 2, 0.16, 0.2, 0.04);
      wheels(d, W / 2 - 0.12, [L / 2 - 0.85, -L / 2 + 0.85], 0.36, 0.22);
      break;
    }
    case 'sedan': {
      p.box(0, 0.32, 0, W, 0.62, L);
      p.box(0, 0.94, -0.25, W * 0.86, 0.42, L * 0.48);
      d.setColor(GLASS); d.box(0, 0.98, -0.25, W * 0.88, 0.32, L * 0.44);
      d.setColor(LAMP); for (const s of [-1, 1]) d.box(s * W * 0.34, 0.7, L / 2, 0.3, 0.1, 0.03);
      d.setColor(TAIL); for (const s of [-1, 1]) d.box(s * W * 0.36, 0.72, -L / 2, 0.3, 0.1, 0.03);
      d.setColor(BLACK); d.box(0, 0.32, L / 2, W * 0.9, 0.16, 0.05); d.box(0, 0.32, -L / 2, W * 0.9, 0.16, 0.05);
      wheels(d, W / 2 - 0.1, [L / 2 - 0.8, -L / 2 + 0.8], 0.32, 0.2);
      break;
    }
    case 'keke': {
      p.box(0, 0.35, -0.25, W, 0.55, L * 0.62);
      p.box(0, 0.4, L * 0.28, W * 0.6, 0.5, L * 0.32);
      p.box(0, 1.62, -0.05, W * 1.02, 0.06, L * 0.95);
      d.setColor(BLACK); for (const [x, z] of [[-1, 0.3], [1, 0.3], [-1, -0.62], [1, -0.62]]) d.box(x * W * 0.46, 0.9, z * L * 0.7, 0.04, 0.72, 0.04);
      d.setColor(GLASS); d.box(0, 1.2, L * 0.38, W * 0.6, 0.55, 0.04);
      d.setColor([0.1, 0.45, 0.2]); d.box(0, 0.62, -0.25, W * 1.01, 0.08, L * 0.62);
      d.setColor(LAMP); d.box(0, 0.75, L / 2 - 0.02, 0.2, 0.16, 0.04);
      wheels(d, W / 2 - 0.08, [-L * 0.3], 0.24, 0.14);
      wheels(d, 0.0001, [L * 0.38], 0.24, 0.14);
      break;
    }
    case 'okada': {
      d.setColor([0.12, 0.12, 0.13]); d.box(0, 0.42, 0, 0.3, 0.32, 1.5);
      d.setColor(CHROME); d.box(0, 0.75, 0.55, 0.62, 0.04, 0.04);
      wheels(d, 0.0001, [0.62, -0.62], 0.3, 0.1);
      // the rider: shirt in the paint colour, helmet, a passenger half the time
      p.box(0, 0.7, -0.05, 0.42, 0.62, 0.3);
      d.setColor([0.16, 0.11, 0.08]); d.box(0, 1.34, -0.05, 0.22, 0.22, 0.22);
      d.setColor([0.9, 0.75, 0.1]); d.box(0, 1.46, -0.05, 0.27, 0.16, 0.28);
      d.setColor([0.15, 0.15, 0.3]); d.box(0, 0.46, 0.05, 0.38, 0.24, 0.5);
      break;
    }
    case 'brt': {
      p.box(0, 0.45, 0, W, 1.15, L);
      p.box(0, 2.3, 0, W, 0.75, L);
      d.setColor(GLASS); d.box(0, 1.6, 0, W * 1.01, 0.72, L * 0.94); d.box(0, 1.4, L / 2, W * 0.94, 1.5, 0.05);
      d.setColor(WHITE); d.box(0, 3.05, 0, W * 0.96, 0.12, L * 0.98);
      d.setColor([1.6, 1.0, 0.2]); d.box(0, 2.55, L / 2 + 0.01, W * 0.7, 0.28, 0.02);   // destination board
      d.setColor(LAMP); for (const s of [-1, 1]) d.box(s * W * 0.38, 0.7, L / 2, 0.3, 0.14, 0.04);
      d.setColor(TAIL); for (const s of [-1, 1]) d.box(s * W * 0.4, 0.8, -L / 2, 0.2, 0.3, 0.04);
      wheels(d, W / 2 - 0.15, [L / 2 - 2.2, -L / 2 + 2.6], 0.48, 0.3);
      break;
    }
    case 'molue': {
      p.box(0, 0.5, 0, W, 2.3, L);
      d.setColor(GLASS); d.box(0, 1.85, 0, W * 1.01, 0.62, L * 0.9); d.box(0, 1.7, L / 2, W * 0.9, 0.9, 0.05);
      d.setColor(BLACK); d.box(0, 1.25, 0, W * 1.015, 0.1, L * 0.98); d.box(0, 1.05, 0, W * 1.015, 0.06, L * 0.98);
      d.setColor([0.55, 0.42, 0.25]); d.box(0, 2.85, 0, W * 0.9, 0.12, L * 0.85);   // roof load
      d.setColor(LAMP); for (const s of [-1, 1]) d.box(s * W * 0.36, 0.85, L / 2, 0.24, 0.24, 0.04);
      wheels(d, W / 2 - 0.15, [L / 2 - 1.8, -L / 2 + 2.2], 0.5, 0.3);
      break;
    }
    case 'tanker': {
      p.box(0, 0.6, L / 2 - 1.3, W, 2.3, 2.4);
      d.setColor(GLASS); d.box(0, 2.05, L / 2 - 0.12, W * 0.9, 0.7, 0.05);
      d.setColor(CHROME);
      tubeZ(d, 0, 1.95, -1.2, 1.1, L - 2.9, 14);
      d.setColor([0.85, 0.1, 0.1]); d.box(0, 1.6, -1.2, W * 0.97, 0.18, L - 3.0);
      d.setColor(LAMP); for (const s of [-1, 1]) d.box(s * W * 0.38, 0.9, L / 2, 0.24, 0.18, 0.04);
      wheels(d, W / 2 - 0.15, [L / 2 - 1.0, -L / 2 + 1.0, -L / 2 + 2.3], 0.5, 0.32);
      break;
    }
    case 'trailer': {
      p.box(0, 0.6, L / 2 - 1.2, W, 2.5, 2.3);
      d.setColor(GLASS); d.box(0, 2.2, L / 2 - 0.05, W * 0.9, 0.75, 0.05);
      d.setColor([0.12, 0.3, 0.6]); d.box(0, 1.25, -1.2, W * 1.0, 2.55, L - 2.8);
      d.setColor([0.2, 0.2, 0.22]); for (let z = -L / 2 + 1; z < L / 2 - 3; z += 0.5) d.box(0, 1.25, z, W * 1.012, 2.5, 0.04);
      d.setColor(LAMP); for (const s of [-1, 1]) d.box(s * W * 0.38, 0.95, L / 2, 0.24, 0.18, 0.04);
      wheels(d, W / 2 - 0.15, [L / 2 - 1.0, -L / 2 + 1.0, -L / 2 + 2.3], 0.5, 0.32);
      break;
    }
  }
  return { paint: p.build(), detail: d.build() };
}

const PAINT: Record<TrafficKind, number[]> = {
  danfo: [0xf2b705, 0xe8ac00, 0xf6c514], sedan: [0xc8ccd0, 0x101418, 0x7a1414, 0x1b4a8a, 0xe8e2d6, 0x3a3a3a, 0x2f5a2f, 0x9a8a6a], keke: [0xf2c200, 0x2a8a3a, 0xe8b400],
  okada: [0x1a6ad6, 0xd62a2a, 0x2ab04a, 0xf2a900, 0xffffff, 0x8a2ad6], brt: [0xc81e1e, 0x1d4fb8], molue: [0xf2b705], tanker: [0xe8e8e8, 0xd03020, 0x2a4ab0], trailer: [0xd03020, 0x2a6ad0, 0xf2f2f2, 0x2a2a2a],
};

export class TrafficView {
  group = new THREE.Group();
  private meshes = new Map<TrafficKind, { paint: THREE.InstancedMesh; detail: THREE.InstancedMesh; ids: number[] }>();
  private dummy = new THREE.Object3D();
  private slot = new Map<number, { kind: TrafficKind; i: number }>();

  constructor(cars: { id: number; kind: TrafficKind; colour: number }[], shadows: boolean) {
    const byKind = new Map<TrafficKind, { id: number; colour: number }[]>();
    for (const c of cars) { const a = byKind.get(c.kind) ?? []; a.push(c); byKind.set(c.kind, a); }
    const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
    for (const [kind, list] of byKind) {
      const g = vehicleGeometry(kind);
      const paintMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.3, clearcoat: 0.6 });
      const paint = new THREE.InstancedMesh(g.paint, paintMat, list.length);
      const detail = new THREE.InstancedMesh(g.detail, detailMat, list.length);
      paint.castShadow = shadows; detail.castShadow = false;
      list.forEach((c, i) => {
        const cols = PAINT[kind];
        paint.setColorAt(i, new THREE.Color(cols[Math.floor(hash01(c.id, 17) * cols.length)]));
        this.slot.set(c.id, { kind, i });
      });
      paint.frustumCulled = false; detail.frustumCulled = false;
      this.meshes.set(kind, { paint, detail, ids: list.map((c) => c.id) });
      this.group.add(paint, detail);
    }
  }

  update(poses: TrafficPose[]) {
    for (const p of poses) {
      const s = this.slot.get(p.id);
      if (!s) continue;
      const m = this.meshes.get(s.kind)!;
      const v = p.vis;
      this.dummy.position.set(p.x, p.y + (v < 1 ? (v - 1) * 1.5 : 0), p.z);
      this.dummy.rotation.set(0, p.h, 0);
      this.dummy.scale.setScalar(v < 0.02 ? 0.0001 : 1);
      this.dummy.updateMatrix();
      m.paint.setMatrixAt(s.i, this.dummy.matrix);
      m.detail.setMatrixAt(s.i, this.dummy.matrix);
    }
    for (const m of this.meshes.values()) { m.paint.instanceMatrix.needsUpdate = true; m.detail.instanceMatrix.needsUpdate = true; }
  }
}

/** A single static vehicle for scenery (parked danfos at the terminals, buses at the bays). */
export function parkedVehicle(kind: TrafficKind, colour: number): THREE.Group {
  const g = vehicleGeometry(kind);
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g.paint, new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.4, metalness: 0.3, clearcoat: 0.5 })));
  grp.add(new THREE.Mesh(g.detail, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 })));
  return grp;
}
