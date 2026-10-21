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

export interface ColliderTag { kind: 'world' | 'actor' | 'creature' | 'vehicle' | 'shield'; id: number; mat?: string }

export class Physics {
  world: RWorld;
  tags = new Map<number, ColliderTag>();
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.world.timestep = 1 / 60;
  }
  tag(c: RCollider, t: ColliderTag) { this.tags.set(c.handle, t); }
  tagOf(c: RCollider | null | undefined) { return c ? this.tags.get(c.handle) : undefined; }

  buildCity(city: City) {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed();
    const body = this.world.createRigidBody(bodyDesc);
    for (const b of city.boxes) if (b.col) this.addBox(b, body);
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
    return { t, point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }, normal: hit.normal, collider: hit.collider, tag: this.tagOf(hit.collider) };
  }
  lineOfSight(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return true;
    const hit = this.world.castRay(new RAPIER.Ray(a, { x: dx / len, y: dy / len, z: dz / len }), len - 0.3, true, undefined, SIGHT_FILTER);
    return !hit;
  }
  step() { this.world.step(); }
}
