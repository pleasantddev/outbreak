// HustleLife simulation: the open city. Player, pedestrians, area boys, police, traffic, parked cars, hijacking,
// fists and guns, the wahala (wanted) level, cash, potholes that bite tyres. No rendering in here.
import { RAPIER, Physics, G, groups, MOVE_FILTER, quatYX, type RCollider, type RBody } from './physics';
import { Rng } from './rng';
import { WEAPONS, VEHICLES, PLAYER, type VehicleKind, type WeaponId } from '../data/balance';
import { Inventory, weaponStats, AMMO_STACK, type WeaponItem, type Item } from './items';
import { emptyCommand, v3, type Actor, type Command, type Loot, type SimEvent, type Vec3, type Vehicle } from './types';
import { rotate, sub, dist3, seatOffset } from './sim';
import { RoadNet, type Lane } from '../world/roadnet';
import type { CharacterLook } from '../data/cosmetics';
import { PALETTE, PATTERNS, SKIN_TONES, TOPS } from '../data/cosmetics';
import type { Pothole } from '../world/region';

const EYE = 1.55, EYE_CROUCH = 1.05, CAP_HALF = 0.55, CAP_R = 0.35;
const NAMES = ['Kunle', 'Ngozi', 'Emeka', 'Bisi', 'Segun', 'Halima', 'Dayo', 'Chidi', 'Funke', 'Yusuf', 'Tobi', 'Ada', 'Femi', 'Kemi', 'Obinna', 'Sade', 'Musa', 'Ifeoma', 'Gbenga', 'Nneka', 'Tunde', 'Bayo', 'Chioma', 'Aisha'];

export interface TileCol { hulls: { pts: number[]; h: number; convex: boolean }[]; walls: { ax: number; az: number; bx: number; bz: number; h: number }[]; poles: number[]; decks: { pos: number[]; idx: number[] }[] }
export interface LifeOptions { seed: number; name: string; look: CharacterLook; spawn: { x: number; z: number }; quality: 'low' | 'medium' | 'high'; potholes: (x: number, z: number, r: number) => Pothole[] }

export interface PedBrain { kind: 'walk' | 'flee' | 'fight' | 'idle' | 'police' | 'ko' | 'citizen'; walk: number; s: number; dir: number; t: number; target: number | null; from: Vec3 | null }
/** Plug points for the society system (named citizens that live off-screen and appear here when near). */
export interface LifeHooks {
  /** replaces the random pedestrian spawn when it returns true */
  populate?(P: Vec3, dt: number): boolean;
  /** drives a citizen-bound actor whose brain kind is 'citizen' (fill in c) */
  citizenThink?(a: Actor, b: PedBrain, c: Command, dt: number): void;
  /** called when a citizen-bound actor is hurt; return true if it handled the reaction itself */
  onHurt?(t: Actor, by: Actor, dmg: number, b: PedBrain): boolean;
  /** an actor is being removed (walked far away, dead for a while, car removed) */
  onDespawn?(a: Actor): void;
  /** a traffic car is about to spawn: return a citizen id to put behind the wheel */
  trafficDriver?(kind: VehicleKind, x: number, z: number): number | null;
  /** the driver body for that citizen now exists */
  bound?(a: Actor): void;
}
interface Driver { lane: number; s: number; speed: number; lateral: number; stuck: number; honk: number; wait: number }

export class LifeSim {
  phys = new Physics();
  rng: Rng;
  actors: Actor[] = [];
  vehicles: Vehicle[] = [];
  loot: Loot[] = [];
  events: SimEvent[] = [];
  noises: { pos: Vec3; r: number; t: number; by: number }[] = [];
  net = new RoadNet();
  ctrl: any;
  time = 0;
  wanted = 0; wantedCool = 0; lastSeen = 0; busted = 0;
  cash = 1850;
  private brains = new Map<number, PedBrain>();
  hooks: LifeHooks = {};
  /** society levers: 1 = normal. Rush hour raises traffic, an okada ban removes bikes. */
  trafficScale = 1; trafficSlow = 1; banned = new Set<VehicleKind>();
  private drivers = new Map<number, Driver>();
  private tileBodies = new Map<string, RBody>();
  private colliderOwner = new Map<number, { kind: 'actor' | 'vehicle'; id: number }>();
  private nextId = 1;
  private spawnT = 0;
  private dead: Actor[] = [];
  private freeVehicleIds: number[] = [];
  private potholeCd = new Map<number, number>();
  maxPeds: number; maxTraffic: number; maxParked: number;
  ready = false;

  constructor(public opts: LifeOptions) {
    this.rng = new Rng(opts.seed);
    this.maxPeds = opts.quality === 'high' ? 34 : opts.quality === 'medium' ? 24 : 14;
    this.maxTraffic = opts.quality === 'high' ? 16 : opts.quality === 'medium' ? 12 : 7;
    this.maxParked = opts.quality === 'high' ? 12 : 8;
    const ground = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const gc = this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(40000, 0.5, 40000).setTranslation(0, -0.5, 0).setCollisionGroups(groups(G.WORLD, 0xffff)).setFriction(0.9), ground);
    this.phys.tag(gc, { kind: 'world', id: -1, mat: 'asphalt' });
    this.ctrl = this.phys.world.createCharacterController(0.03);
    this.ctrl.enableAutostep(0.42, 0.15, false);
    this.ctrl.enableSnapToGround(0.45);
    this.ctrl.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.ctrl.setSlideEnabled(true);
    this.spawnActor('player', { x: opts.spawn.x, y: 0.05, z: opts.spawn.z }, opts.look, opts.name);
  }
  get local() { return this.actors[0]; }
  brainOf(id: number) { return this.brains.get(id); }
  /** Spawns an actor bound to a citizen record: brain kind 'citizen', the society hook steers it. */
  spawnBound(role: NonNullable<Actor['role']>, pos: Vec3, look: CharacterLook, name: string, cid: number): Actor {
    const a = this.spawnActor(role, pos, look, name); a.cid = cid;
    this.brains.set(a.id, { kind: 'citizen', walk: 0, s: 0, dir: 1, t: 0, target: null, from: null });
    return a;
  }
  removeActor(a: Actor) { this.despawnActor(a); }
  /** back to the default behaviour after a flight or a fight */
  private calm(a: Actor, b: PedBrain) { b.kind = a.cid !== undefined ? 'citizen' : 'walk'; b.target = null; }
  ownerOf(c: RCollider | null | undefined) { return c ? this.colliderOwner.get(c.handle) : undefined; }

  // ---------------------------------------------------------------- world collision streaming
  addTile(key: string, col: TileCol) {
    if (this.tileBodies.has(key)) return;
    const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const W = this.phys.world;
    for (const h of col.hulls) {
      const n = h.pts.length / 2; if (n < 3) continue;
      if (h.convex) {
        const v = new Float32Array(n * 6);
        for (let k = 0; k < n; k++) { v.set([h.pts[k * 2], 0, h.pts[k * 2 + 1]], k * 3); v.set([h.pts[k * 2], h.h, h.pts[k * 2 + 1]], (n + k) * 3); }
        const d = RAPIER.ColliderDesc.convexHull(v); if (!d) continue;
        const c = W.createCollider(d.setCollisionGroups(groups(G.WORLD, 0xffff)), body); this.phys.tag(c, { kind: 'world', id: -1, mat: 'concrete' });
      } else {
        const v = new Float32Array(n * 6); const idx: number[] = [];
        for (let k = 0; k < n; k++) { v.set([h.pts[k * 2], 0, h.pts[k * 2 + 1]], k * 3); v.set([h.pts[k * 2], h.h, h.pts[k * 2 + 1]], (n + k) * 3); }
        for (let k = 0; k < n; k++) { const j = (k + 1) % n; idx.push(k, j, n + j, k, n + j, n + k); }
        const c = W.createCollider(RAPIER.ColliderDesc.trimesh(v, new Uint32Array(idx)).setCollisionGroups(groups(G.WORLD, 0xffff)), body); this.phys.tag(c, { kind: 'world', id: -1, mat: 'concrete' });
      }
    }
    for (const w of col.walls) {
      const L = Math.hypot(w.bx - w.ax, w.bz - w.az); if (L < 0.3) continue;
      const ang = Math.atan2(w.bz - w.az, w.bx - w.ax);
      const d = RAPIER.ColliderDesc.cuboid(L / 2, w.h / 2, 0.12).setTranslation((w.ax + w.bx) / 2, w.h / 2, (w.az + w.bz) / 2).setRotation(quatYX(-ang)).setCollisionGroups(groups(G.WORLD, 0xffff));
      const c = W.createCollider(d, body); this.phys.tag(c, { kind: 'world', id: -1, mat: 'concrete' });
    }
    for (let i = 0; i < col.poles.length; i += 3) {
      const c = W.createCollider(RAPIER.ColliderDesc.cylinder(4, col.poles[i + 2]).setTranslation(col.poles[i], 4, col.poles[i + 1]).setCollisionGroups(groups(G.WORLD, 0xffff)), body);
      this.phys.tag(c, { kind: 'world', id: -1, mat: 'metal' });
    }
    for (const dk of col.decks) {
      if (dk.idx.length < 3) continue;
      const c = W.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(dk.pos), new Uint32Array(dk.idx)).setCollisionGroups(groups(G.WORLD, 0xffff)), body);
      this.phys.tag(c, { kind: 'world', id: -1, mat: 'asphalt' });
    }
    this.tileBodies.set(key, body);
  }
  removeTile(key: string) { const b = this.tileBodies.get(key); if (b) { this.phys.world.removeRigidBody(b); this.tileBodies.delete(key); } }
  hasTile(key: string) { return this.tileBodies.has(key); }

  // ---------------------------------------------------------------- actors
  private makeCapsule(pos: Vec3, member: number) {
    const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + CAP_HALF + CAP_R, pos.z));
    const collider = this.phys.world.createCollider(RAPIER.ColliderDesc.capsule(CAP_HALF, CAP_R).setCollisionGroups(groups(member, G.WORLD | G.SHIELD)), body);
    return { body, collider };
  }
  randomLook(): CharacterLook {
    const r = this.rng; const body = r.chance(0.48) ? 'female' : 'male';
    return {
      name: 'NPC', body, skin: r.int(0, Math.min(4, SKIN_TONES.length - 1)),
      hair: body === 'female' ? r.pick(['buns', 'long', 'buzzedfemale'] as const) : r.pick(['none', 'buzzed', 'simpleparted', 'buzzed'] as const), beard: body === 'male' && r.chance(0.35),
      top: r.pick(TOPS.filter((t) => t.id !== 'tactical')).id, topPattern: r.chance(0.35) ? r.pick(PATTERNS).id : 'solid', topColor: r.pick(PALETTE), topAccent: r.pick(PALETTE),
      pants: r.chance(0.15) ? r.pick(['ankara_wave', 'adire'] as const) : 'solid', pantsColor: r.pick(['#1e2b3a', '#2a2622', '#141414', '#3e3a33', '#c9c1b2', '#5a3d2b']), shoes: r.pick(['#141414', '#e8e0d0', '#5a3d2b']),
      head: r.chance(0.12) ? 'cap' : r.chance(0.06) ? 'fila' : 'none', vest: false, backpack: r.chance(0.12), scars: 0, facePaint: 'none',
      model: body === 'female' ? r.pick(['farah', 'farah', 'girl'] as const) : r.pick(['survivor', 'survivor', 'survivor', 'rogue'] as const),
    } as CharacterLook;
  }
  spawnActor(role: NonNullable<Actor['role']>, pos: Vec3, look?: CharacterLook, name?: string): Actor {
    const id = this.actors.length;
    const { body, collider } = this.makeCapsule(pos, G.ACTOR);
    const inv = new Inventory(6, false);
    inv.melee = { kind: 'weapon', id: 'fists' as WeaponId, mag: 0, att: {}, skin: 'factory' } as WeaponItem;
    if (role === 'police') {
      const w: WeaponItem = { kind: 'weapon', id: this.wanted >= 3 && this.rng.chance(0.6) ? 'ar' : 'pistol', mag: 0, att: {}, skin: 'factory' };
      w.mag = weaponStats(w).mag; if (w.id === 'ar') inv.primary = w; else inv.secondary = w;
      inv.addStack(AMMO_STACK[WEAPONS[w.id].ammo]!, 90); inv.armor = { kind: 'armor', level: 1, hp: 25 };
    }
    if (role === 'area' && this.rng.chance(0.55)) inv.melee = { kind: 'weapon', id: 'machete', mag: 0, att: {}, skin: 'factory' };
    const lk = look ?? this.randomLook();
    if (role === 'police') Object.assign(lk, { body: 'male', model: this.wanted >= 3 ? 'trooper' : 'survivor', top: 'tactical', topPattern: 'solid', topColor: '#121417', topAccent: '#2a2e33', pants: 'solid', pantsColor: '#0d0e10', shoes: '#0a0a0a', head: 'cap', vest: true });
    if (role === 'area') Object.assign(lk, { body: 'male', model: this.rng.chance(0.55) ? 'rogue' : 'survivor' });
    const a: Actor = {
      id, name: name ?? this.rng.pick(NAMES), bot: role !== 'player', alive: true, look: lk, archetype: 'runner',
      pos: { ...pos }, vy: 0, yaw: this.rng.range(0, Math.PI * 2), pitch: 0, ext: v3(), body, collider,
      hp: role === 'police' ? 120 : 100, maxHp: role === 'police' ? 120 : 100, inv, slot: 2, fireCd: 0, reloadT: 0, reloadTotal: 0, healT: 0, healKind: null,
      crouch: false, sprinting: false, aiming: false, grounded: true, swimming: false, mantleT: 0,
      vehicle: null, seat: -1, shadowT: 0, awakenT: 0, heart: false, flashlight: false,
      lastHurt: -99, lastShot: -99, lastStep: 0, lastPing: 0, anim: 'idle', speed: 0, recoil: 0,
      contract: null, kills: 0, creatureKills: 0, damageDealt: 0, placement: 0, killedBy: null, won: null, extracting: 0, usedAwakening: false,
      cmd: emptyCommand(), prevCmd: emptyCommand(), role, cash: role === 'player' ? 0 : this.rng.int(200, role === 'area' ? 4000 : 2500), hostile: 0, fear: 0, ko: 0,
    };
    if (role === 'police') a.slot = a.inv.primary ? 0 : 1;
    // reuse a dead slot to keep the array short
    const reuse = role !== 'player' ? this.actors.findIndex((x, i) => i > 0 && !x.alive && (x as any)._gone) : -1;
    if (reuse > 0) { a.id = reuse; this.actors[reuse] = a; } else this.actors.push(a);
    this.colliderOwner.set(collider.handle, { kind: 'actor', id: a.id });
    return a;
  }
  private despawnActor(a: Actor) {
    this.hooks.onDespawn?.(a);
    if (a.vehicle !== null) this.exitVehicle(a, true);
    a.alive = false; (a as any)._gone = true;
    this.colliderOwner.delete(a.collider.handle);
    this.phys.world.removeRigidBody(a.body);
    this.brains.delete(a.id);
  }

  // ---------------------------------------------------------------- vehicles
  addVehicle(kind: VehicleKind, p: Vec3, ry: number, parked = false) {
    const def = VEHICLES[kind];
    const [sx, sy, sz] = def.size;
    const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y + 0.7, p.z).setRotation(quatYX(ry)).setLinearDamping(0.12).setAngularDamping(kind === 'okada' ? 2.5 : 0.8).setCcdEnabled(true));
    const hy = sy / 2 - 0.25;
    const collider = this.phys.world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, hy, sz / 2).setTranslation(0, hy * 0.2, 0)
        .setMassProperties(def.mass, { x: 0, y: -0.45, z: 0 }, { x: def.mass * 0.6, y: def.mass * 0.8, z: def.mass * 0.4 }, { w: 1, x: 0, y: 0, z: 0 })
        .setCollisionGroups(groups(G.VEHICLE, G.WORLD | G.VEHICLE | G.SHIELD)).setFriction(0.4), body);
    const ctrl = this.phys.world.createVehicleController(body);
    ctrl.indexUpAxis = 1; (ctrl as any).setIndexForwardAxis = 2;
    const wy = -hy + 0.05;
    const wheels: [number, number][] = [[-def.track / 2, def.wheelBase / 2], [def.track / 2, def.wheelBase / 2], [-def.track / 2, -def.wheelBase / 2], [def.track / 2, -def.wheelBase / 2]];
    wheels.forEach(([wx, wz], i) => {
      ctrl.addWheel({ x: wx, y: wy, z: wz }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.32, def.wheelRadius);
      ctrl.setWheelSuspensionStiffness(i, kind === 'okada' ? 38 : 26); ctrl.setWheelSuspensionCompression(i, 2.4); ctrl.setWheelSuspensionRelaxation(i, 2.9);
      ctrl.setWheelMaxSuspensionForce(i, def.mass * 60); ctrl.setWheelMaxSuspensionTravel(i, 0.3);
      ctrl.setWheelFrictionSlip(i, kind === 'okada' ? 3.2 : 2.2); ctrl.setWheelSideFrictionStiffness(i, 1.0);
    });
    const id = this.freeVehicleIds.pop() ?? this.vehicles.length;
    const v: Vehicle = {
      id, kind, body, ctrl, collider, seats: new Array(def.seats).fill(null), bodyHp: def.body, engine: def.engine,
      tires: [def.tire, def.tire, def.tire, def.tire], fuel: def.fuel * this.rng.range(0.4, 1), fireT: 0, destroyed: false, throttle: 0, steer: 0, horn: 0, lastDriver: null,
      wheelSpin: [0, 0, 0, 0], wheelSteer: 0,
    };
    (v as any).parked = parked; (v as any).locked = parked && this.rng.chance(0.85); (v as any).seed = this.rng.int(0, 1e6); (v as any).paint = this.rng.int(0, 99);
    (v as any).doors = [0, 0, 0, 0]; (v as any).gone = false;
    this.vehicles[id] = v;
    this.colliderOwner.set(collider.handle, { kind: 'vehicle', id });
    return v;
  }
  removeVehicle(v: Vehicle) {
    for (const id of [...v.seats]) if (id !== null) { const a = this.actors[id]; if (a.role === 'player') this.exitVehicle(a); else this.despawnActor(a); }
    this.colliderOwner.delete(v.collider.handle);
    this.phys.world.removeVehicleController(v.ctrl);
    this.phys.world.removeRigidBody(v.body);
    (v as any).gone = true; v.destroyed = true;
    this.drivers.delete(v.id);
    this.freeVehicleIds.push(v.id);
  }
  liveVehicles() { return this.vehicles.filter((v) => v && !(v as any).gone); }

  enterVehicle(a: Actor, v: Vehicle, preferDriver = true) {
    let seat = preferDriver && v.seats[0] === null ? 0 : v.seats.indexOf(null);
    let jack = false, victim: number | undefined;
    if (preferDriver && v.seats[0] !== null && a.role === 'player') {
      const sp = Math.abs(v.ctrl.currentVehicleSpeed());
      if (sp > 4.5) return false;
      const d = this.actors[v.seats[0]!];
      this.exitVehicle(d);
      d.ext.x += Math.sin(a.yaw) * 3; d.ext.z += Math.cos(a.yaw) * 3; d.ko = 1.4; d.fear = 1;
      const b = this.brains.get(d.id); if (b) { b.kind = this.rng.chance(d.role === 'area' ? 0.7 : 0.25) ? 'fight' : 'flee'; b.target = a.id; b.from = { ...a.pos }; }
      seat = 0; jack = true; victim = d.id;
      this.crime('carjack', 1, a.pos);
    }
    if (seat < 0) return false;
    if (a.role === 'player' && (v as any).locked && !jack) { (v as any).locked = false; this.crime('break-in', this.rng.chance(0.5) ? 1 : 0, a.pos); this.events.push({ t: 'announce', title: 'CAR ALARM', sub: 'Shine your eye, people are looking.', tone: 'danger' }); }
    v.seats[seat] = a.id;
    a.vehicle = v.id; a.seat = seat; a.healT = 0; a.reloadT = 0; a.crouch = false;
    a.collider.setEnabled(false);
    if (seat === 0) v.lastDriver = a.id;
    (v as any).parked = false;
    (v as any).doors[Math.min(3, seat)] = 1;
    if (a.role === 'player') this.drivers.delete(v.id);
    this.events.push({ t: 'enterVehicle', actor: a.id, vehicle: v.id, seat, jack, victim });
    return true;
  }
  exitVehicle(a: Actor, silent = false) {
    if (a.vehicle === null) return;
    const v = this.vehicles[a.vehicle];
    v.seats[a.seat] = null;
    const p = v.body.translation(), r = v.body.rotation();
    const side = a.seat % 2 === 0 ? 1 : -1; // left seats (driver) exit to the left: +x in vehicle space
    const off = rotate({ x: side * (VEHICLES[v.kind].size[0] / 2 + 0.75), y: 0, z: a.seat < 2 ? 0.2 : -0.7 }, r);
    a.pos = { x: p.x + off.x, y: Math.max(0.05, p.y - 0.6), z: p.z + off.z };
    (v as any).doors[Math.min(3, a.seat)] = 1;
    const seat = a.seat;
    a.vehicle = null; a.seat = -1; a.vy = 0;
    a.collider.setEnabled(a.alive);
    a.body.setTranslation({ x: a.pos.x, y: a.pos.y + CAP_HALF + CAP_R, z: a.pos.z }, true);
    if (!silent) this.events.push({ t: 'exitVehicle', actor: a.id, vehicle: v.id, seat });
  }

  // ---------------------------------------------------------------- wahala
  crime(kind: string, add: number, at: Vec3) {
    // only counts if someone saw it: a pedestrian or police within 45 m with a clear line
    const witness = this.actors.some((x) => x.alive && x.role !== 'player' && x.ko! <= 0 && dist3(x.pos, at) < 45 && this.phys.lineOfSight({ x: x.pos.x, y: x.pos.y + 1.5, z: x.pos.z }, { x: at.x, y: at.y + 1.2, z: at.z }));
    if (!witness && kind !== 'police') return;
    if (add > 0) { this.wanted = Math.min(5, this.wanted + add); this.wantedCool = 0; this.lastSeen = this.time; this.events.push({ t: 'crime', kind, wanted: this.wanted }); }
  }

  // ---------------------------------------------------------------- step
  setCommand(id: number, cmd: Command) { const a = this.actors[id]; if (a) { a.prevCmd = a.cmd; a.cmd = cmd; } }
  step(dt: number) {
    this.time += dt;
    this.population(dt);
    for (const a of this.actors) if (a.alive && a.role !== 'player' && !(a as any)._gone) this.think(a, dt);
    for (const v of this.vehicles) if (v && !(v as any).gone && v.seats[0] !== null && this.actors[v.seats[0]!].role !== 'player') this.drive(v, dt);
    for (const a of this.actors) if (a.alive && !(a as any)._gone) this.updateActor(a, dt);
    for (const v of this.vehicles) if (v && !(v as any).gone) this.updateVehicle(v, dt);
    this.phys.step();
    this.syncSeats();
    this.updateWanted(dt);
    this.noises = this.noises.filter((n) => this.time - n.t < 2.5);
  }

  private updateWanted(dt: number) {
    if (this.wanted <= 0) return;
    const me = this.local;
    const seen = this.actors.some((p) => p.alive && p.role === 'police' && dist3(p.pos, me.pos) < 60 && this.phys.lineOfSight({ x: p.pos.x, y: p.pos.y + 1.5, z: p.pos.z }, { x: me.pos.x, y: me.pos.y + 1.2, z: me.pos.z }));
    if (seen) this.lastSeen = this.time;
    const cool = 18 + this.wanted * 8;
    if (this.time - this.lastSeen > cool) { this.wanted = Math.max(0, this.wanted - 1); this.lastSeen = this.time; this.events.push({ t: 'crime', kind: 'cooled', wanted: this.wanted }); }
  }

  // ---------------------------------------------------------------- population
  private population(dt: number) {
    this.spawnT -= dt; if (this.spawnT > 0) return; this.spawnT = 0.4;
    const me = this.local; const P = me.vehicle !== null ? (() => { const t = this.vehicles[me.vehicle!].body.translation(); return { x: t.x, y: t.y, z: t.z }; })() : me.pos;
    // despawn far
    for (const a of this.actors) if (a.alive && a.role !== 'player' && !(a as any)._gone && a.vehicle === null && Math.hypot(a.pos.x - P.x, a.pos.z - P.z) > 175) this.despawnActor(a);
    for (const a of this.actors) if (!a.alive && !(a as any)._gone && this.time - (a as any)._diedAt > 40) this.despawnActor(a);
    for (const v of this.liveVehicles()) { const t = v.body.translation(); const d = Math.hypot(t.x - P.x, t.z - P.z); if (d > 280 && !v.seats.some((s) => s !== null && this.actors[s].role === 'player') && v.id !== (this as any).playerCar && !(v as any).keep) this.removeVehicle(v); }
    const peds = this.actors.filter((a) => a.alive && !(a as any)._gone && a.role !== 'player' && a.vehicle === null).length;
    if (this.hooks.populate?.(P, dt)) { /* named citizens fill the pavements */ }
    else if (peds < this.maxPeds) {
      const walks = this.net.nearWalks(P.x, P.z, 130);
      if (walks.length) {
        const wi = this.rng.pick(walks); const w = this.net.walks[wi]; const s = this.rng.next() * w.len; const at = RoadNet.at(w.pts, s);
        const d = Math.hypot(at.x - P.x, at.z - P.z);
        if (d > 35 && d < 135) {
          const role = this.rng.chance(0.08) ? 'area' : 'ped';
          const a = this.spawnActor(role, { x: at.x, y: 0.05, z: at.z });
          this.brains.set(a.id, { kind: this.rng.chance(0.15) ? 'idle' : 'walk', walk: wi, s, dir: this.rng.chance(0.5) ? 1 : -1, t: this.rng.range(3, 12), target: null, from: null });
        }
      }
    }
    // police come when there is wahala
    const cops = this.actors.filter((a) => a.alive && !(a as any)._gone && a.role === 'police').length;
    if (this.wanted > 0 && cops < Math.min(8, this.wanted * 2)) {
      const walks = this.net.nearWalks(P.x, P.z, 120);
      if (walks.length) {
        const w = this.net.walks[this.rng.pick(walks)]; const at = RoadNet.at(w.pts, this.rng.next() * w.len);
        const d = Math.hypot(at.x - P.x, at.z - P.z);
        if (d > 40 && d < 120) { const a = this.spawnActor('police', { x: at.x, y: 0.05, z: at.z }, undefined, 'Police'); this.brains.set(a.id, { kind: 'police', walk: 0, s: 0, dir: 1, t: 0, target: 0, from: null }); }
      }
    }
    // traffic
    const live = this.liveVehicles();
    const moving = live.filter((v) => this.drivers.has(v.id)).length;
    if (moving < Math.round(this.maxTraffic * this.trafficScale)) {
      const lanes = this.net.near(P.x, P.z, 220);
      if (lanes.length) {
        const ln = this.net.lanes[this.rng.pick(lanes)];
        const s = this.rng.next() * ln.len; const at = RoadNet.at(ln.pts, s);
        const d = Math.hypot(at.x - P.x, at.z - P.z);
        const clear = live.every((v) => { const t = v.body.translation(); return Math.hypot(t.x - at.x, t.z - at.z) > 14; });
        if (d > 70 && d < 220 && clear) {
          const kinds = (['danfo', 'danfo', 'sedan', 'sedan', 'sedan', 'hatch', 'jeep', 'keke', 'keke', 'okada', 'okada'] as VehicleKind[]).filter((k) => !this.banned.has(k));
          const kind: VehicleKind = this.rng.pick(kinds);
          const v = this.addVehicle(kind, { x: at.x, y: 0.1, z: at.z }, at.yaw);
          const cid = this.hooks.trafficDriver?.(kind, at.x, at.z) ?? null;
          const drv = this.spawnActor('driver', { x: at.x, y: 0.1, z: at.z });
          if (cid !== null) { drv.cid = cid; this.hooks.bound?.(drv); }
          this.enterVehicle(drv, v);
          if (kind === 'danfo') for (let k = 1; k < 4; k++) if (this.rng.chance(0.6)) { const p = this.spawnActor('ped', { x: at.x, y: 0.1, z: at.z }); this.enterVehicle(p, v, false); }
          this.drivers.set(v.id, { lane: ln.id, s, speed: ln.speed * this.rng.range(0.75, 1.05) * this.trafficSlow, lateral: 0, stuck: 0, honk: 0, wait: 0 });
        }
      }
    }
    const parked = live.filter((v) => (v as any).parked).length;
    if (parked < this.maxParked) {
      const lanes = this.net.near(P.x, P.z, 160).filter((l) => this.net.lanes[l].cls >= 6);
      if (lanes.length) {
        const ln = this.net.lanes[this.rng.pick(lanes)]; const s = this.rng.next() * ln.len; const at = RoadNet.at(ln.pts, s);
        const d = Math.hypot(at.x - P.x, at.z - P.z);
        // pull right onto the edge of the carriageway
        const rx = -Math.cos(at.yaw), rz = Math.sin(at.yaw);
        const x = at.x + rx * 1.4, z = at.z + rz * 1.4;
        const clear = live.every((v) => { const t = v.body.translation(); return Math.hypot(t.x - x, t.z - z) > 8; });
        if (d > 50 && d < 160 && clear) this.addVehicle(this.rng.pick(['sedan', 'sedan', 'hatch', 'jeep', 'danfo'] as VehicleKind[]), { x, y: 0.1, z }, at.yaw, true);
      }
    }
  }

  // ---------------------------------------------------------------- NPC brains
  private think(a: Actor, dt: number) {
    const b = this.brains.get(a.id); if (!b) { if (a.role !== 'driver') a.cmd = emptyCommand(); return; }
    const c = emptyCommand(); c.yaw = a.yaw;
    const me = this.local;
    if (a.ko! > 0) { a.ko! -= dt; a.cmd = c; return; }
    // hear gunshots: most people run, area boys get curious, police get angry
    for (const n of this.noises) if (n.by !== a.id && dist3(n.pos, a.pos) < n.r * 0.8 && this.time - n.t < 0.2) {
      if (a.role === 'police') { b.kind = 'police'; }
      else if (a.role === 'area' && this.rng.chance(0.4) && n.by === 0) { b.kind = 'fight'; b.target = n.by; }
      else if (b.kind !== 'fight') { b.kind = 'flee'; b.from = { ...n.pos }; b.t = this.rng.range(6, 12); a.fear = 1; }
    }
    const goTo = (x: number, z: number, run: boolean) => { const dx = x - a.pos.x, dz = z - a.pos.z, l = Math.hypot(dx, dz) || 1; c.mx = dx / l; c.mz = dz / l; c.sprint = run; c.yaw = Math.atan2(dx, dz); };
    switch (b.kind) {
      case 'citizen': this.hooks.citizenThink?.(a, b, c, dt); break;
      case 'idle': b.t -= dt; if (b.t <= 0) { b.kind = 'walk'; b.t = this.rng.range(8, 30); } break;
      case 'walk': {
        const w = this.net.walks[b.walk]; if (!w) { b.kind = 'idle'; break; }
        b.s += dt * 1.3 * b.dir;
        if (b.s < 0 || b.s > w.len) {
          // pick a connected walk near the end
          const end = RoadNet.at(w.pts, Math.max(0, Math.min(w.len, b.s)));
          const opts = this.net.nearWalks(end.x, end.z, 12).filter((i) => i !== b.walk);
          if (opts.length) { b.walk = this.rng.pick(opts); const nw = this.net.walks[b.walk]; const pr = RoadNet.project(nw.pts, end.x, end.z); b.s = pr.s; b.dir = pr.s < nw.len / 2 ? 1 : -1; }
          else b.dir *= -1;
        }
        const t = RoadNet.at(this.net.walks[b.walk].pts, Math.max(0, Math.min(this.net.walks[b.walk].len, b.s + b.dir * 1.5)));
        goTo(t.x, t.z, false); c.mx *= 0.48; c.mz *= 0.48; // stroll
        b.t -= dt; if (b.t <= 0 && this.rng.chance(0.2)) { b.kind = 'idle'; b.t = this.rng.range(2, 8); } else if (b.t <= 0) b.t = this.rng.range(8, 30);
        break;
      }
      case 'flee': {
        const f = b.from ?? me.pos; const dx = a.pos.x - f.x, dz = a.pos.z - f.z, l = Math.hypot(dx, dz) || 1;
        c.mx = dx / l; c.mz = dz / l; c.sprint = true; c.yaw = Math.atan2(c.mx, c.mz);
        b.t -= dt; if (b.t <= 0 || l > 60) { this.calm(a, b); const ws = this.net.nearWalks(a.pos.x, a.pos.z, 20); if (ws.length) { b.walk = ws[0]; b.s = RoadNet.project(this.net.walks[b.walk].pts, a.pos.x, a.pos.z).s; } a.fear = 0; }
        break;
      }
      case 'fight': case 'police': {
        const tgt = this.actors[b.target ?? 0];
        if (!tgt || !tgt.alive) { this.calm(a, b); break; }
        if (b.kind === 'police' && this.wanted <= 0) { this.calm(a, b); const ws = this.net.nearWalks(a.pos.x, a.pos.z, 30); if (ws.length) { b.walk = ws[0]; b.s = 0; } break; }
        const tp = tgt.vehicle !== null ? (() => { const t = this.vehicles[tgt.vehicle!].body.translation(); return { x: t.x, y: t.y, z: t.z }; })() : tgt.pos;
        const d = Math.hypot(tp.x - a.pos.x, tp.z - a.pos.z);
        const w = this.currentWeapon(a);
        const ranged = !!w && WEAPONS[w.id] && WEAPONS[w.id].slot !== 'melee';
        const eye = this.eye(a); const aim = { x: tp.x - eye.x, y: tp.y + 1.2 - eye.y, z: tp.z - eye.z }; const al = Math.hypot(aim.x, aim.y, aim.z) || 1;
        c.yaw = Math.atan2(aim.x, aim.z); c.pitch = Math.asin(aim.y / al); c.aimDir = { x: aim.x / al, y: aim.y / al, z: aim.z / al };
        const los = d < 70 && this.phys.lineOfSight({ ...eye }, { x: tp.x, y: tp.y + 1.2, z: tp.z });
        if (ranged && los && d < 32 && (b.kind !== 'police' || this.wanted >= 2)) {
          c.aim = true; if (this.rng.chance(dt * (a.role === 'police' ? 0.9 + this.wanted * 0.15 : 0.7))) c.fire = true;
          if (d > 14) goTo(tp.x, tp.z, false), c.mx *= 0.4, c.mz *= 0.4;
        } else if (d > 1.4) { goTo(tp.x, tp.z, d > 6); c.yaw = Math.atan2(tp.x - a.pos.x, tp.z - a.pos.z); }
        else { if (a.fireCd <= 0) c.fire = true; }
        // police at wahala 1 try to arrest instead of shoot
        if (b.kind === 'police' && this.wanted === 1 && d < 1.8 && tgt.role === 'player' && tgt.vehicle === null) { this.busted += dt; if (this.busted > 2.5) this.arrest(); }
        a.slot = a.inv.primary ? 0 : a.inv.secondary ? 1 : 2;
        break;
      }
      case 'ko': break;
    }
    a.cmd = c;
  }
  private arrest() {
    this.busted = 0;
    const fine = Math.min(this.cash, 5000 + this.wanted * 5000);
    this.cash -= fine; this.wanted = 0;
    this.events.push({ t: 'announce', title: 'BUSTED', sub: `Settlement at the station: ₦${fine.toLocaleString()}. Abeg, go home.`, tone: 'danger' });
    for (const a of this.actors) if (a.role === 'police' && a.alive) { const b = this.brains.get(a.id); if (b) this.calm(a, b); }
  }

  // ---------------------------------------------------------------- traffic driving
  private drive(v: Vehicle, dt: number) {
    const d = this.drivers.get(v.id); const drv = this.actors[v.seats[0]!];
    if (!d) { drv.cmd = emptyCommand(); return; }
    let ln = this.net.lanes[d.lane]; if (!ln) { drv.cmd = emptyCommand(); return; }
    const p = v.body.translation(); const r = v.body.rotation();
    const pr = RoadNet.project(ln.pts, p.x, p.z); d.s = pr.s;
    if (d.s > ln.len - 6) {
      if (ln.next.length) { const nx = this.rng.pick(ln.next); d.lane = nx; ln = this.net.lanes[nx]; d.s = RoadNet.project(ln.pts, p.x, p.z).s; d.speed = ln.speed * this.rng.range(0.75, 1.05) * this.trafficSlow; }
      else { this.removeLater(v); drv.cmd = emptyCommand(); return; }
    }
    const speed = v.ctrl.currentVehicleSpeed();
    const look = Math.max(6, Math.abs(speed) * 0.9 + 4);
    const tgt = RoadNet.at(ln.pts, Math.min(ln.len, d.s + look));
    // potholes ahead: Lagos drivers weave, then crawl through what they cannot dodge
    let slow = 1;
    const ahead = RoadNet.at(ln.pts, Math.min(ln.len, d.s + 10));
    const holes = this.opts.potholes(ahead.x, ahead.z, 6);
    if (holes.length) { const h = holes[0]; const rx = -Math.cos(ahead.yaw), rz = Math.sin(ahead.yaw); const side = (h.x - ahead.x) * rx + (h.z - ahead.z) * rz; d.lateral += (side > 0 ? -1 : 1) * dt * 1.5; slow = 0.55; }
    else d.lateral *= Math.exp(-dt * 0.8);
    d.lateral = Math.max(-1.3, Math.min(1.3, d.lateral));
    const rx = -Math.cos(tgt.yaw), rz = Math.sin(tgt.yaw);
    const tx = tgt.x + rx * d.lateral, tz = tgt.z + rz * d.lateral;
    // steering: angle between heading and target in vehicle space
    const fw = rotate({ x: 0, y: 0, z: 1 }, r);
    const want = Math.atan2(tx - p.x, tz - p.z), have = Math.atan2(fw.x, fw.z);
    let err = want - have; while (err > Math.PI) err -= Math.PI * 2; while (err < -Math.PI) err += Math.PI * 2;
    // anything in front? brake for cars, people and the player
    let block = 99;
    const fx = fw.x, fz = fw.z;
    for (const o of this.liveVehicles()) {
      if (o === v) continue; const t = o.body.translation(); const dx = t.x - p.x, dz = t.z - p.z; const along = dx * fx + dz * fz; const side = Math.abs(dx * fz - dz * fx);
      if (along > 0 && along < 22 && side < 2.2) block = Math.min(block, along - VEHICLES[o.kind].size[2] / 2 - VEHICLES[v.kind].size[2] / 2);
    }
    for (const a of this.actors) {
      if (!a.alive || a.vehicle !== null || (a as any)._gone) continue; const dx = a.pos.x - p.x, dz = a.pos.z - p.z; const along = dx * fx + dz * fz; const side = Math.abs(dx * fz - dz * fx);
      if (along > 0 && along < 14 && side < 1.6) { block = Math.min(block, along - VEHICLES[v.kind].size[2] / 2); if (a.role === 'player' && along < 9) d.honk = 1; }
    }
    let target = d.speed * slow * (1 - Math.min(0.6, Math.abs(err) * 0.8));
    if (block < 12) target = Math.min(target, Math.max(0, (block - 2.5) * 0.9));
    const c = emptyCommand();
    c.mx = -Math.max(-1, Math.min(1, err * 1.8)); // steer (sim negates mx)
    if (speed < target - 0.5) c.mz = Math.min(1, (target - speed) * 0.35 + 0.2);
    else if (speed > target + 1) c.jump = true;
    if (target < 0.3 && speed < 0.5) { c.jump = true; d.wait += dt; if (d.wait > 2.5) d.honk = 1; } else d.wait = 0;
    c.sprint = d.honk > 0 && v.kind === 'danfo';
    d.honk = Math.max(0, d.honk - dt);
    if (Math.abs(speed) < 0.3 && c.mz > 0) { d.stuck += dt; if (d.stuck > 8) this.removeLater(v); } else d.stuck = 0;
    drv.cmd = c; drv.yaw = have;
  }
  private removeLater(v: Vehicle) { (v as any)._remove = true; }

  // ---------------------------------------------------------------- actors
  currentWeapon(a: Actor): WeaponItem | null { return a.slot === 0 ? a.inv.primary : a.slot === 1 ? a.inv.secondary : a.inv.melee; }
  eye(a: Actor): Vec3 { return { x: a.pos.x, y: a.pos.y + (a.crouch ? EYE_CROUCH : EYE), z: a.pos.z }; }
  aimDir(a: Actor): Vec3 { if (a.cmd.aimDir) return a.cmd.aimDir; const cp = Math.cos(a.pitch); return { x: Math.sin(a.yaw) * cp, y: Math.sin(a.pitch), z: Math.cos(a.yaw) * cp }; }

  private updateActor(a: Actor, dt: number) {
    const cmd = a.cmd, prev = a.prevCmd;
    const pressed = (k: keyof Command) => !!cmd[k] && !prev[k];
    a.fireCd = Math.max(0, a.fireCd - dt);
    a.recoil *= Math.exp(-8 * dt);
    a.yaw = cmd.yaw; a.pitch = cmd.pitch;
    if (a.role === 'player' && pressed('interact')) this.interact(a);
    if (a.vehicle !== null) { a.anim = 'drive'; a.speed = 0; if (a.seat > 0 && a.role !== 'player') return; if (a.seat > 0) this.combat(a, dt, pressed('reload'), pressed('fire')); return; }
    if (cmd.slot >= 0 && cmd.slot !== a.slot) { const t = cmd.slot as 0 | 1 | 2; if (t === 2 || (t === 0 ? a.inv.primary : a.inv.secondary)) { a.slot = t; a.reloadT = 0; a.fireCd = 0.3; } }
    if (pressed('heal') && a.healT <= 0 && a.hp < a.maxHp && a.inv.count('bandage')) { a.healKind = 'bandage'; a.healT = 2.5; }
    if (a.healT > 0) { a.healT -= dt; if (cmd.fire || cmd.sprint) { a.healT = 0; a.healKind = null; } else if (a.healT <= 0 && a.healKind) { if (a.inv.take(a.healKind, 1)) a.hp = Math.min(a.maxHp, a.hp + 30); a.healKind = null; } }
    this.moveActor(a, dt);
    this.combat(a, dt, pressed('reload'), pressed('fire'));
    if (a.role === 'player') this.autoPickup(a);
    // slow health regen out of combat
    if (this.time - a.lastHurt > 10 && a.hp < a.maxHp * 0.5) a.hp = Math.min(a.maxHp * 0.5, a.hp + dt * 2);
  }

  private moveActor(a: Actor, dt: number) {
    const cmd = a.cmd; const w = this.currentWeapon(a);
    a.crouch = cmd.crouch;
    a.aiming = cmd.aim;
    const moving = Math.hypot(cmd.mx, cmd.mz) > 0.05;
    a.sprinting = cmd.sprint && moving && !a.aiming && !a.crouch && a.healT <= 0;
    let speed = a.crouch ? PLAYER.crouch : a.aiming ? PLAYER.aimMove : a.sprinting ? PLAYER.sprint : PLAYER.jog;
    if (w && WEAPONS[w.id]) speed *= weaponStats(w).moveMult;
    if (a.healT > 0) speed = Math.min(speed, PLAYER.walk);
    if (a.ko! > 0) speed = 0;
    if ((a as any)._phone) speed = Math.min(speed, PLAYER.walk * 0.85);
    let jumped = false;
    if (a.mantleT > 0) {
      a.mantleT -= dt; const tgt = (a as any)._mantleTo as Vec3; const k = Math.min(1, dt * 7);
      a.pos = { x: a.pos.x + (tgt.x - a.pos.x) * k, y: a.pos.y + (tgt.y - a.pos.y) * Math.min(1, dt * 10), z: a.pos.z + (tgt.z - a.pos.z) * k }; a.vy = 0; a.anim = 'mantle';
      a.body.setNextKinematicTranslation({ x: a.pos.x, y: a.pos.y + CAP_HALF + CAP_R, z: a.pos.z }); return;
    }
    if (a.grounded && cmd.jump && !a.prevCmd.jump) { if (!this.tryMantle(a)) { a.vy = PLAYER.jump; jumped = true; } else return; }
    a.vy -= PLAYER.gravity * dt;
    const decay = Math.exp(-5 * dt); a.ext.x *= decay; a.ext.z *= decay; a.ext.y *= decay;
    const desired = { x: cmd.mx * speed * dt + a.ext.x * dt, y: a.vy * dt + a.ext.y * dt, z: cmd.mz * speed * dt + a.ext.z * dt };
    this.ctrl.computeColliderMovement(a.collider, desired, undefined, MOVE_FILTER);
    const m = this.ctrl.computedMovement();
    const vyBefore = a.vy;
    a.pos.x += m.x; a.pos.y += m.y; a.pos.z += m.z;
    const wasGrounded = a.grounded; a.grounded = this.ctrl.computedGrounded();
    if (a.grounded && a.vy < 0) { if (!wasGrounded && vyBefore < -15) this.damageActor(a, (-vyBefore - 15) * 7, null, false, 'the fall'); a.vy = 0; }
    if (!a.grounded && desired.y > 0 && m.y < desired.y * 0.5) a.vy = Math.min(a.vy, 0);
    if (a.pos.y < -20) { a.pos.y = 1; a.vy = 0; }
    a.body.setNextKinematicTranslation({ x: a.pos.x, y: a.pos.y + CAP_HALF + CAP_R, z: a.pos.z });
    a.speed = Math.hypot(m.x, m.z) / dt;
    if (!a.grounded && (jumped || a.vy > 1)) a.anim = 'jump';
    else if (!a.grounded && a.vy < -4) a.anim = 'fall';
    else if (a.healT > 0) a.anim = 'heal';
    else if (a.crouch) a.anim = a.speed > 0.3 ? 'crouchWalk' : 'crouch';
    else if (a.speed > 5.2) a.anim = 'sprint';
    else if (a.speed > 2.8) a.anim = 'jog';
    else if (a.speed > 0.3) a.anim = 'walk';
    else a.anim = 'idle';
    if (a.grounded && a.speed > 0.8) {
      const stride = a.sprinting ? 0.3 : a.crouch ? 0.6 : 0.42;
      if (this.time - a.lastStep > stride) { a.lastStep = this.time; this.events.push({ t: 'step', actor: a.id, at: { ...a.pos }, loud: a.sprinting, surface: 'concrete' }); }
    }
  }
  private tryMantle(a: Actor) {
    const mx = a.cmd.mx, mz = a.cmd.mz, l = Math.hypot(mx, mz);
    const dx = l > 0.2 ? mx / l : Math.sin(a.yaw), dz = l > 0.2 ? mz / l : Math.cos(a.yaw);
    const chest = this.phys.ray({ x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z }, { x: dx, y: 0, z: dz }, 0.95, groups(0xffff, G.WORLD | G.VEHICLE), a.collider);
    if (!chest) return false;
    const probe = { x: a.pos.x + dx * (chest.t + 0.45), y: a.pos.y + 2.3, z: a.pos.z + dz * (chest.t + 0.45) };
    const down = this.phys.ray(probe, { x: 0, y: -1, z: 0 }, 2.3, groups(0xffff, G.WORLD | G.VEHICLE)); if (!down) return false;
    const h = down.point.y - a.pos.y; if (h < 0.45 || h > 2.15) return false;
    if (this.phys.ray({ x: probe.x, y: down.point.y + 0.05, z: probe.z }, { x: 0, y: 1, z: 0 }, 1.7, groups(0xffff, G.WORLD | G.VEHICLE))) return false;
    (a as any)._mantleTo = { x: probe.x, y: down.point.y + 0.02, z: probe.z }; a.mantleT = 0.45; return true;
  }

  // ---------------------------------------------------------------- combat
  private combat(a: Actor, dt: number, reloadPressed: boolean, firePressed: boolean) {
    const w = this.currentWeapon(a); if (!w) return;
    if ((w.id as string) === 'fists' || w.id === 'machete') {
      if ((firePressed || (a.bot && a.cmd.fire)) && a.fireCd <= 0) {
        const fists = (w.id as string) === 'fists';
        this.melee(a, fists ? 14 : 48, fists ? 1.5 : 2.2, fists ? 0.42 : 0.75, fists ? 'Fists' : 'Cutlass');
      }
      return;
    }
    const st = weaponStats(w); const stack = AMMO_STACK[st.ammo]!;
    if (a.reloadT > 0) { a.reloadT -= dt; if (a.reloadT <= 0) { const need = st.mag - w.mag; w.mag += a.inv.take(stack, need); } return; }
    if ((reloadPressed || (w.mag === 0 && a.cmd.fire)) && w.mag < st.mag && a.inv.count(stack) > 0) { a.reloadT = a.reloadTotal = st.reload; this.events.push({ t: 'reload', actor: a.id }); return; }
    const trigger = st.auto ? a.cmd.fire : (firePressed || (a.bot && a.cmd.fire));
    if (!trigger || a.fireCd > 0 || w.mag <= 0 || a.healT > 0 || a.sprinting) return;
    a.fireCd = 60 / st.rpm; w.mag--; a.lastShot = this.time; a.recoil += st.recoil;
    this.noises.push({ pos: { ...a.pos }, r: st.noise, t: this.time, by: a.id });
    if (a.role === 'player') this.crime('shooting', this.wanted < 2 ? 1 : 0, a.pos);
    const eye = this.eye(a); const dir = this.aimDir(a);
    const spread = (a.aiming ? st.adsSpread : st.hipSpread) * (a.speed > 1 ? 1.6 : 1) * (a.bot ? 3.2 : 1) + (a.bot ? 0.02 : 0);
    for (let p = 0; p < st.pellets; p++) this.hitscan(a, eye, this.jitter(dir, spread), st, w, p === 0);
  }
  private jitter(d: Vec3, s: number): Vec3 {
    if (s <= 0) return d;
    const r = s * Math.sqrt(this.rng.next()), th = this.rng.next() * Math.PI * 2;
    const up = Math.abs(d.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const rx = { x: up.y * d.z - up.z * d.y, y: up.z * d.x - up.x * d.z, z: up.x * d.y - up.y * d.x }; const rl = Math.hypot(rx.x, rx.y, rx.z); rx.x /= rl; rx.y /= rl; rx.z /= rl;
    const ry = { x: d.y * rx.z - d.z * rx.y, y: d.z * rx.x - d.x * rx.z, z: d.x * rx.y - d.y * rx.x };
    const o = { x: d.x + (rx.x * Math.cos(th) + ry.x * Math.sin(th)) * r, y: d.y + (rx.y * Math.cos(th) + ry.y * Math.sin(th)) * r, z: d.z + (rx.z * Math.cos(th) + ry.z * Math.sin(th)) * r };
    const l = Math.hypot(o.x, o.y, o.z); return { x: o.x / l, y: o.y / l, z: o.z / l };
  }
  private hitscan(a: Actor, eye: Vec3, d: Vec3, st: ReturnType<typeof weaponStats>, w: WeaponItem, emit: boolean) {
    const exclude = a.vehicle !== null ? this.vehicles[a.vehicle].collider : a.collider;
    const hit = this.phys.ray(eye, d, st.maxRange, undefined, exclude, (c) => c.handle !== a.collider.handle);
    const to = hit ? hit.point : { x: eye.x + d.x * st.maxRange, y: eye.y + d.y * st.maxRange, z: eye.z + d.z * st.maxRange };
    let kind: 'world' | 'flesh' | 'metal' | 'none' = hit ? 'world' : 'none';
    if (hit) {
      const fall = hit.t <= st.range ? 1 : Math.max(0.45, 1 - ((hit.t - st.range) / (st.maxRange - st.range)) * 0.55);
      const owner = this.ownerOf(hit.collider);
      if (owner?.kind === 'actor') { const t = this.actors[owner.id]; const head = to.y > t.pos.y + (t.crouch ? 1.0 : 1.48); this.damageActor(t, st.damage * fall * (head ? st.headMult : 1), a, head, st.name); kind = 'flesh'; }
      else if (owner?.kind === 'vehicle') { this.damageVehicle(this.vehicles[owner.id], st.damage * fall, to, a.id); kind = 'metal'; }
      else if (hit.tag?.mat === 'metal') kind = 'metal';
    }
    if (emit || st.pellets > 1) this.events.push({ t: 'shot', actor: a.id, weapon: w.id, from: eye, to, suppressed: false, hit: kind, normal: hit?.normal ? { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } : undefined });
  }
  private melee(a: Actor, dmg: number, range: number, cd: number, label: string) {
    a.fireCd = cd; this.events.push({ t: 'melee', actor: a.id });
    const f = { x: Math.sin(a.yaw), z: Math.cos(a.yaw) };
    for (const t of this.actors) {
      if (t === a || !t.alive || t.vehicle !== null || (t as any)._gone) continue;
      const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > range + 0.4 || Math.abs(t.pos.y - a.pos.y) > 1.8) continue;
      if ((dx * f.x + dz * f.z) / (d || 1) < 0.4) continue;
      this.damageActor(t, dmg * this.rng.range(0.8, 1.2), a, false, label);
      t.ext.x += (dx / (d || 1)) * 5; t.ext.z += (dz / (d || 1)) * 5;
      if (label === 'Fists' && t.hp < 35 && t.hp > 0 && this.rng.chance(0.45)) t.ko = 4; // knocked down, not dead
    }
  }
  damageActor(t: Actor, dmg: number, by: Actor | null, head: boolean, label: string) {
    if (!t.alive || dmg <= 0) return;
    let armorHit = false;
    if (t.inv.armor && t.inv.armor.hp > 0 && by) { const ab = Math.min(t.inv.armor.hp, dmg * 0.7); t.inv.armor.hp -= ab; dmg -= ab; armorHit = true; if (t.inv.armor.hp <= 0) t.inv.armor = null; }
    t.hp -= dmg; t.lastHurt = this.time;
    if (by) this.events.push({ t: 'hit', target: t.id, targetKind: 'actor', by: by.id, dmg, head, at: this.eye(t), armor: armorHit });
    this.events.push({ t: 'hurt', actor: t.id, dmg, from: by ? { ...by.pos } : null });
    // reactions
    if (by && t.role !== 'player') {
      const b = this.brains.get(t.id);
      if (b && this.hooks.onHurt?.(t, by, dmg, b)) { /* the society system decided how this citizen reacts */ }
      else if (b) { const brave = t.role === 'police' || t.role === 'area' || (t.role === 'ped' && this.rng.chance(0.3)); if (brave) { b.kind = t.role === 'police' ? 'police' : 'fight'; b.target = by.id; } else { b.kind = 'flee'; b.from = { ...by.pos }; b.t = 10; } }
      if (by.role === 'player') this.crime(t.role === 'police' ? 'police' : 'assault', t.role === 'police' ? 2 : this.wanted === 0 ? 1 : 0, by.pos);
    }
    if (t.hp <= 0) this.kill(t, by, label, head);
  }
  private kill(t: Actor, by: Actor | null, label: string, head: boolean) {
    t.alive = false; t.hp = 0; t.anim = 'dead'; (t as any)._diedAt = this.time;
    if (by && by !== t) by.kills++;
    this.events.push({ t: 'kill', victim: t.id, victimName: t.name, killer: by?.id ?? null, killerName: by?.name ?? label, weapon: label, head });
    if (by?.role === 'player') this.crime(t.role === 'police' ? 'police' : 'murder', 2, t.pos);
    if (t.cash && t.cash > 0) this.dropItem({ kind: 'stack', type: 'contraband', count: 1, value: t.cash }, { x: t.pos.x + 0.5, y: t.pos.y + 0.05, z: t.pos.z });
    if (t.inv.primary) this.dropItem(t.inv.primary, { x: t.pos.x - 0.5, y: t.pos.y + 0.05, z: t.pos.z });
    if (t.inv.secondary) this.dropItem(t.inv.secondary, { x: t.pos.x, y: t.pos.y + 0.05, z: t.pos.z + 0.5 });
    const st = t.inv.primary ? AMMO_STACK[WEAPONS[t.inv.primary.id].ammo] : t.inv.secondary ? AMMO_STACK[WEAPONS[t.inv.secondary.id].ammo] : null;
    if (st) this.dropItem({ kind: 'stack', type: st, count: 30 }, { x: t.pos.x, y: t.pos.y + 0.05, z: t.pos.z - 0.5 });
    if (t.vehicle !== null) this.exitVehicle(t);
    t.collider.setEnabled(false);
    if (t.role === 'player') {
      this.events.push({ t: 'announce', title: 'WASTED', sub: 'General Hospital took ₦10,000 and patched you up.', tone: 'danger' });
      setTimeout(() => this.respawnPlayer(), 3500);
    }
  }
  respawnPlayer() {
    const a = this.local; a.alive = true; a.hp = a.maxHp; a.collider.setEnabled(true); a.anim = 'idle';
    this.cash = Math.max(0, this.cash - 10000); this.wanted = 0;
  }
  dropItem(item: Item, pos: Vec3) { const l: Loot = { id: this.nextId++, item, pos: { ...pos }, taken: false, bob: this.rng.next() * 6 }; this.loot.push(l); return l; }
  private autoPickup(a: Actor) {
    for (const l of this.loot) {
      if (l.taken || dist3(a.pos, l.pos) > 1.4) continue;
      const it = l.item;
      if (it.kind === 'stack' && it.type === 'contraband') { this.cash += it.value ?? 0; l.taken = true; this.events.push({ t: 'cash', actor: a.id, amount: it.value ?? 0 }); }
      else if (it.kind === 'stack') { const left = a.inv.addStack(it.type, it.count); if (left < it.count) { it.count = left; if (!left) l.taken = true; this.events.push({ t: 'pickup', actor: a.id, label: it.type, rarity: 'common' }); } }
      else if (it.kind === 'weapon') {
        const slot = WEAPONS[it.id].slot;
        if (slot === 'primary' && !a.inv.primary) { a.inv.primary = it; a.slot = 0; l.taken = true; this.events.push({ t: 'pickup', actor: a.id, label: WEAPONS[it.id].name, rarity: 'rare' }); }
        else if (slot === 'secondary' && !a.inv.secondary) { a.inv.secondary = it; a.slot = 1; l.taken = true; this.events.push({ t: 'pickup', actor: a.id, label: WEAPONS[it.id].name, rarity: 'rare' }); }
      } else if (it.kind === 'armor' && !a.inv.armor) { a.inv.armor = it; l.taken = true; }
    }
    if (this.loot.length > 200) this.loot = this.loot.filter((l) => !l.taken);
  }
  private interact(a: Actor) {
    if (a.vehicle !== null) { this.exitVehicle(a); return; }
    let best: Vehicle | null = null, bd = 3.6;
    for (const v of this.liveVehicles()) { if (v.destroyed) continue; const p = v.body.translation(); const d = Math.hypot(p.x - a.pos.x, p.z - a.pos.z) - VEHICLES[v.kind].size[2] * 0.25; if (d < bd && Math.abs(p.y - a.pos.y) < 2.5) { bd = d; best = v; } }
    if (best) this.enterVehicle(a, best);
  }

  // ---------------------------------------------------------------- vehicles
  private syncSeats() {
    for (const a of this.actors) {
      if (a.vehicle === null || (a as any)._gone) continue;
      const v = this.vehicles[a.vehicle]; const p = v.body.translation(), r = v.body.rotation();
      const w = rotate(seatOffset(v.kind, a.seat), r);
      a.pos = { x: p.x + w.x, y: p.y + w.y - 0.9, z: p.z + w.z };
      a.body.setTranslation({ x: a.pos.x, y: a.pos.y + 1, z: a.pos.z }, true);
    }
  }
  private updateVehicle(v: Vehicle, dt: number) {
    if ((v as any)._remove && !v.seats.some((s) => s !== null && this.actors[s].role === 'player')) { this.removeVehicle(v); return; }
    const def = VEHICLES[v.kind];
    const doors = (v as any).doors as number[]; for (let i = 0; i < 4; i++) doors[i] = Math.max(0, doors[i] - dt * 0.9);
    if (v.destroyed) { v.ctrl.updateVehicle(dt); return; }
    const driver = v.seats[0] !== null ? this.actors[v.seats[0]!] : null;
    let throttle = 0, steer = 0, brake = 0;
    if (driver && driver.alive) { throttle = driver.cmd.mz; steer = -driver.cmd.mx; if (driver.cmd.jump) brake = def.brake; v.horn = driver.cmd.sprint && driver.role !== 'player' ? 1 : driver.role === 'player' && driver.cmd.sprint && v.kind === 'danfo' ? 1 : 0; }
    else brake = (v as any).parked ? def.brake * 2 : def.brake * 0.3;
    const speed = v.ctrl.currentVehicleSpeed();
    if (throttle !== 0 && Math.sign(throttle) !== Math.sign(speed) && Math.abs(speed) > 1.5) { brake = def.brake; throttle = 0; }
    const engineK = Math.max(0.15, v.engine / def.engine);
    const flat = v.tires.filter((t) => t <= 0).length;
    const top = def.topSpeed * (1 - flat * 0.18) * (v.engine <= 0 ? 0 : 1);
    if (v.fuel <= 0 || v.engine <= 0) throttle = 0;
    let force = throttle * def.engineForce * engineK; if (Math.abs(speed) > top) force = 0; if (throttle < 0) force *= 0.55;
    v.fuel = Math.max(0, v.fuel - Math.abs(throttle) * def.fuelBurn * dt * 0.2);
    const steerAmt = steer * def.maxSteer * (1 - Math.min(0.6, Math.abs(speed) / (def.topSpeed * 1.3)));
    v.steer += (steerAmt - v.steer) * Math.min(1, dt * 8); v.throttle = throttle;
    const rwd = v.kind === 'sedan' || v.kind === 'jeep' || v.kind === 'police' || v.kind === 'danfo';
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      v.ctrl.setWheelSteering(i, front ? v.steer : 0);
      v.ctrl.setWheelEngineForce(i, (front && rwd) || (!front && !rwd && v.kind !== 'okada' && v.kind !== 'keke') ? 0 : force);
      v.ctrl.setWheelBrake(i, brake);
      v.ctrl.setWheelFrictionSlip(i, (v.kind === 'okada' ? 3.2 : 2.2) * (v.tires[i] <= 0 ? 0.35 : 1) * (1 - 0.25 * ((this as any).wet ?? 0)));
    }
    v.ctrl.updateVehicle(dt, undefined, groups(G.VEHICLE, G.WORLD | G.SHIELD));
    v.wheelSteer = v.steer; for (let i = 0; i < 4; i++) v.wheelSpin[i] = v.ctrl.wheelRotation(i) ?? 0;
    const r = v.body.rotation(); const up = rotate({ x: 0, y: 1, z: 0 }, r);
    const k = (v.kind === 'okada' ? 9 : 1.6) * def.mass; const av = v.body.angvel();
    const lean = v.kind === 'okada' ? v.steer * Math.min(1, Math.abs(speed) / 10) * 0.45 : 0;
    const fw = rotate({ x: 0, y: 0, z: 1 }, r); const fl = Math.hypot(fw.x, fw.z) || 1; const right = { x: fw.z / fl, z: -fw.x / fl };
    const target = { x: right.x * Math.sin(lean), y: Math.cos(lean), z: right.z * Math.sin(lean) };
    const cross = { x: up.y * target.z - up.z * target.y, z: up.x * target.y - up.y * target.x };
    v.body.applyTorqueImpulse({ x: (cross.x * k - av.x * def.mass * 0.4) * dt, y: 0, z: (cross.z * k - av.z * def.mass * 0.4) * dt }, true);
    // potholes: each wheel that drops into one jolts the body and chews the tyre
    const p = v.body.translation(); const sp = Math.abs(speed);
    if (sp > 2) {
      const holes = this.opts.potholes(p.x, p.z, Math.max(def.size[2], 3));
      if (holes.length) {
        const wl: [number, number][] = [[-def.track / 2, def.wheelBase / 2], [def.track / 2, def.wheelBase / 2], [-def.track / 2, -def.wheelBase / 2], [def.track / 2, -def.wheelBase / 2]];
        wl.forEach(([wx, wz], i) => {
          const wp = rotate({ x: wx, y: 0, z: wz }, r); const x = p.x + wp.x, z = p.z + wp.z;
          for (const h of holes) {
            if (Math.hypot(h.x - x, h.z - z) > h.r * 0.85) continue;
            const key = v.id * 4 + i; if ((this.potholeCd.get(key) ?? 0) > this.time) continue;
            this.potholeCd.set(key, this.time + 0.35);
            const j = Math.min(1, h.depth * 4) * Math.min(1.5, sp / 10);
            v.body.applyImpulseAtPoint({ x: 0, y: -def.mass * 1.6 * j, z: 0 }, { x, y: p.y, z }, true);
            v.body.applyImpulse({ x: -fw.x * def.mass * 0.35 * j, y: 0, z: -fw.z * def.mass * 0.35 * j }, true);
            v.tires[i] = Math.max(0, v.tires[i] - j * 6);
            this.events.push({ t: 'pothole', vehicle: v.id, at: { x, y: 0, z }, strength: j, wet: (this as any).water ?? 0 });
            break;
          }
        });
      }
    }
    // run people over
    if (sp > 5) {
      const reach = Math.max(def.size[0], def.size[2]) / 2 + 0.4;
      for (const a of this.actors) {
        if (!a.alive || a.vehicle !== null || (a as any)._gone) continue;
        const local = rotate(sub(a.pos, p), { x: -r.x, y: -r.y, z: -r.z, w: r.w });
        if (Math.abs(local.x) < def.size[0] / 2 + 0.4 && Math.abs(local.z) < def.size[2] / 2 + 0.4 && Math.abs(local.y + 0.5) < 1.6 && dist3(a.pos, p) < reach + 1) {
          const by = driver ?? (v.lastDriver !== null ? this.actors[v.lastDriver] : null);
          this.damageActor(a, sp * 3.2, by && by !== a ? by : null, false, def.name);
          const f2 = rotate({ x: 0, y: 0, z: Math.sign(speed) }, r); a.ext.x += f2.x * sp * 0.9; a.ext.z += f2.z * sp * 0.9; a.vy = 4;
        }
      }
    }
    if (v.engine <= 0 || v.bodyHp <= 0) { v.fireT += dt; if (v.fireT > 5) this.destroyVehicle(v); }
  }
  damageVehicle(v: Vehicle, dmg: number, at: Vec3, by: number) {
    if (v.destroyed) return;
    const def = VEHICLES[v.kind]; const p = v.body.translation(), r = v.body.rotation();
    const local = rotate(sub(at, p), { x: -r.x, y: -r.y, z: -r.z, w: r.w }); const hz = def.size[2] / 2;
    let part: 'tire' | 'engine' | 'fuel' | 'body' = 'body';
    const wi = [[-1, 1], [1, 1], [-1, -1], [1, -1]].findIndex(([sx, sz]) => Math.abs(local.x - (sx * def.track) / 2) < def.wheelRadius + 0.25 && Math.abs(local.z - (sz * def.wheelBase) / 2) < def.wheelRadius + 0.25 && local.y < -def.size[1] / 2 + def.wheelRadius * 2.4);
    if (wi >= 0) { part = 'tire'; v.tires[wi] = Math.max(0, v.tires[wi] - dmg); }
    else if (local.z > hz * 0.45) { part = 'engine'; v.engine = Math.max(0, v.engine - dmg); v.bodyHp -= dmg * 0.3; }
    else if (local.z < -hz * 0.55 && local.y < 0) { part = 'fuel'; v.fuel = Math.max(0, v.fuel - dmg * 0.15); v.bodyHp -= dmg * 0.5; }
    else v.bodyHp -= dmg;
    this.events.push({ t: 'vehicleHit', vehicle: v.id, part, at: { ...at } });
    for (const id of v.seats) if (id !== null && this.rng.chance(0.18)) this.damageActor(this.actors[id], dmg * 0.5, this.actors[by], false, 'gunfire');
    const d = this.drivers.get(v.id); if (d) { d.speed *= 1.4; }
  }
  private destroyVehicle(v: Vehicle) {
    v.destroyed = true; v.engine = 0; v.bodyHp = 0;
    for (const id of [...v.seats]) if (id !== null) this.exitVehicle(this.actors[id]);
    const p = v.body.translation();
    this.events.push({ t: 'explosion', at: { x: p.x, y: p.y, z: p.z }, radius: 8 });
    for (const a of this.actors) if (a.alive && !(a as any)._gone) { const d = dist3(a.pos, p); if (d < 8) this.damageActor(a, 130 * (1 - d / 8), v.lastDriver !== null ? this.actors[v.lastDriver] : null, false, 'explosion'); }
  }
}
