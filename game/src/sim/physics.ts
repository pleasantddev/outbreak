// Rapier wrapper. Runs identically in a browser or a Node server.
import RAPIER from '@dimforge/rapier3d-compat';
import type { City, Box } from '../world/cityGen';

export { RAPIER };
export type RWorld = InstanceType<typeof RAPIER.World>;
export type RCollider = InstanceType<typeof RAPIER.Collider>;
export type RBody = InstanceType<typeof RAPIER.RigidBody>;

// Collision groups: membership in the high 16 bits, filter in the low 16.
export const G = { WORLD: 1, ACTOR: 2, VEHICLE: 4, CREATURE: 8, SHIELD: 16, LOOT: 32 } as const;
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const MOVE_FILTER = groups(G.ACTOR, G.WORLD | G.VEHICLE | G.SHIELD);
export const BULLET_FILTER = groups(0xffff, G.WORLD | G.ACTOR | G.VEHICLE | G.CREATURE | G.SHIELD);
export const SIGHT_FILTER = groups(0xffff, G.WORLD | G.VEHICLE | G.SHIELD);

let ready: Promise<void> | null = null;
export function initPhysics() { return (ready ??= RAPIER.init()); }

export function quatYX(ry: number, rx = 0) {
  // Euler order YXZ, matching three.js Euler(rx, ry, 0, 'YXZ')
  const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2), cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
  return { w: cy * cx, x: cy * sx, y: sy * cx, z: -sy * sx };
}

export interface ColliderTag { kind: 'world' | 'actor' | 'creature' | 'vehicle' | 'shield'; id: number; mat?: string; /** per-triangle materials of a baked city chunk */ mats?: string[] }

export class Physics {
  world: RWorld;
  tags = new Map<number, ColliderTag>();
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.world.timestep = 1 / 60;
  }
  tag(c: RCollider, t: ColliderTag) { this.tags.set(c.handle, t); }
  tagOf(c: RCollider | null | undefined) { return c ? this.tags.get(c.handle) : undefined; }

  /**
   * The city's static boxes become one triangle mesh per 64 m chunk instead of one collider per box. Rapier walks every
   * collider on every step, so 31,000 box colliders cost about 9 ms a step on a laptop (about 30 ms on a phone); ~120
   * chunk meshes cost almost nothing, and each mesh's own tree keeps rays and contacts fast. Every triangle remembers
   * its box's material so bullet impacts still know plaster from metal.
   */
  buildCity(city: City) {
    const CHUNK = 64;
    const chunks = new Map<string, { v: number[]; i: number[]; mats: string[] }>();
    const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    // two triangles per face, wound outward
    const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]];
    for (const b of city.boxes) {
      if (!b.col) continue;
      const key = `${Math.floor(b.p[0] / CHUNK)},${Math.floor(b.p[2] / CHUNK)}`;
      let ch = chunks.get(key);
      if (!ch) chunks.set(key, (ch = { v: [], i: [], mats: [] }));
      // Euler YXZ (three.js order): v' = Ry * Rx * v
      const cy = Math.cos(b.ry), sy = Math.sin(b.ry), rx = b.rx ?? 0, cx = Math.cos(rx), sx = Math.sin(rx);
      const base = ch.v.length / 3;
      for (const c of corners) {
        const x = c[0] * b.s[0], y = c[1] * b.s[1], z = c[2] * b.s[2];
        const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
        ch.v.push(b.p[0] + x * cy + z1 * sy, b.p[1] + y1, b.p[2] - x * sy + z1 * cy);
      }
      for (const f of faces) { ch.i.push(base + f[0], base + f[1], base + f[2]); ch.mats.push(b.mat); }
      this.indexBox(b);
    }
    for (const ch of chunks.values()) {
      const desc = RAPIER.ColliderDesc.trimesh(new Float32Array(ch.v), new Uint32Array(ch.i), RAPIER.TriMeshFlags?.FIX_INTERNAL_EDGES)
        .setCollisionGroups(groups(G.WORLD, 0xffff))
        .setFriction(0.8);
      const c = this.world.createCollider(desc);
      this.tag(c, { kind: 'world', id: -1, mat: ch.mats[0], mats: ch.mats });
    }
    this.staticColliders = chunks.size;
  }
  /** number of chunk meshes the city was baked into (tests and the debug overlay read it) */
  staticColliders = 0;

  // ---- material lookup: which box contains a point (rays report the chunk mesh, not the box)
  private boxGrid = new Map<number, Box[]>();
  private static readonly CELL = 8;
  private cellKey(ix: number, iz: number) { return (ix + 4096) * 8192 + (iz + 4096); }
  private indexBox(b: Box) {
    const r = Math.hypot(b.s[0], b.s[2]);
    const C = Physics.CELL;
    for (let ix = Math.floor((b.p[0] - r) / C); ix <= Math.floor((b.p[0] + r) / C); ix++)
      for (let iz = Math.floor((b.p[2] - r) / C); iz <= Math.floor((b.p[2] + r) / C); iz++) {
        const k = this.cellKey(ix, iz);
        let list = this.boxGrid.get(k);
        if (!list) this.boxGrid.set(k, (list = []));
        list.push(b);
      }
  }
  /** material of the box surface at `p` (a ray hit point), looking slightly inside along `-normal` */
  materialAt(p: { x: number; y: number; z: number }, n: { x: number; y: number; z: number }): string | undefined {
    const q = { x: p.x - n.x * 0.02, y: p.y - n.y * 0.02, z: p.z - n.z * 0.02 };
    const list = this.boxGrid.get(this.cellKey(Math.floor(q.x / Physics.CELL), Math.floor(q.z / Physics.CELL)));
    if (!list) return undefined;
    let best: Box | undefined, bestDepth = Infinity;
    for (const b of list) {
      // into the box's frame: undo Ry then Rx
      const dx = q.x - b.p[0], dy = q.y - b.p[1], dz = q.z - b.p[2];
      const cy = Math.cos(b.ry), sy = Math.sin(b.ry);
      const x = dx * cy - dz * sy, z1 = dx * sy + dz * cy;
      const rx = b.rx ?? 0, cx = Math.cos(rx), sx = Math.sin(rx);
      const y = dy * cx + z1 * sx, z = -dy * sx + z1 * cx;
      const ex = b.s[0] - Math.abs(x), ey = b.s[1] - Math.abs(y), ez = b.s[2] - Math.abs(z);
      if (ex < -0.01 || ey < -0.01 || ez < -0.01) continue;
      // the box whose surface is nearest the hit point is the one that was struck
      const depth = Math.min(ex, ey, ez);
      if (depth < bestDepth) { bestDepth = depth; best = b; }
    }
    return best?.mat;
  }
  addBox(b: Box, body?: RBody) {
    const d = RAPIER.ColliderDesc.cuboid(b.s[0], b.s[1], b.s[2])
      .setTranslation(b.p[0], b.p[1], b.p[2])
      .setRotation(quatYX(b.ry, b.rx ?? 0))
      .setCollisionGroups(groups(G.WORLD, 0xffff))
      .setFriction(0.8);
    const c = this.world.createCollider(d, body);
    this.tag(c, { kind: 'world', id: -1, mat: b.mat });
    return c;
  }

  ray(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number, filter = BULLET_FILTER, exclude?: RCollider, pred?: (c: RCollider) => boolean) {
    const r = new RAPIER.Ray(o, d);
    const hit = this.world.castRayAndGetNormal(r, max, true, undefined, filter, exclude, undefined, pred);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    let tag = this.tagOf(hit.collider);
    // a baked chunk: find the box that owns the struck surface
    if (tag?.mats) tag = { ...tag, mat: this.materialAt({ x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }, hit.normal) ?? tag.mat };
    return { t, point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }, normal: hit.normal, collider: hit.collider, tag };
  }
  lineOfSight(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return true;
    const hit = this.world.castRay(new RAPIER.Ray(a, { x: dx / len, y: dy / len, z: dz / len }), len - 0.3, true, undefined, SIGHT_FILTER);
    return !hit;
  }
  step() { this.world.step(); }
}
