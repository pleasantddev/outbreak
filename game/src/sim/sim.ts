// The authoritative match simulation. Nothing in here touches rendering; a Node server can run it as-is.
import { RAPIER, Physics, G, groups, MOVE_FILTER, quatYX, type RCollider } from './physics';
import { generateCity, type City, type Site } from '../world/cityGen';
import { Nav } from './nav';
import { Rng } from './rng';
import {
  WEAPONS, ABILITIES, ABILITY_RANK_MULT, ARCHETYPES, PLAYER, VEHICLES, CREATURES, AWAKENING, HEART, TIMELINE, ZONE, CONTRABAND_TARGET,
  type ArchetypeId, type CreatureKind, type VehicleKind, type WeaponId, type AbilityId,
} from '../data/balance';
import type { CharacterLook, Armory } from '../data/cosmetics';
import { OPERATORS, PALETTE, PATTERNS, SKIN_TONES, TOPS, HEADGEAR, HAIRS, WEAPON_SKINS } from '../data/cosmetics';
import { ANNOUNCER } from '../data/copy';
import { Inventory, weaponStats, randomWeapon, AMMO_STACK, ARMOR_HP, itemLabel, itemRarity, type Item, type StackKind, type WeaponItem } from './items';
import { emptyCommand, v3, type Actor, type Command, type Contract, type Creature, type Grenade, type Loot, type Phase, type Shield, type SimEvent, type Vec3, type Vehicle } from './types';
import { BotBrain, CreatureBrain } from './ai';

export interface MatchOptions {
  seed: number; name: string; look: CharacterLook; archetype: ArchetypeId; armory: Armory;
  bots: number; minutes: number; drop: Vec3 | null;
}
export interface Noise { pos: Vec3; r: number; t: number; by: number }
export interface Corruption { name: string; x: number; z: number; r: number }

const EYE = 1.55, EYE_CROUCH = 1.05, CAP_HALF = 0.55, CAP_R = 0.35;
const BOT_NAMES = ['Kunle', 'Ngozi', 'Emeka', 'Bisi', 'Segun', 'Halima', 'Dayo', 'Chidi', 'Funke', 'Yusuf', 'Tobi', 'Ada', 'Femi', 'Kemi', 'Obinna', 'Sade', 'Musa', 'Ifeoma', 'Gbenga', 'Nneka'];

const CONTRACTS: Omit<Contract, 'progress' | 'done' | 'failed'>[] = [
  { id: 'hunter', title: 'THE HUNTER', brief: 'Kill three survivors. Then walk out through any extraction.', goal: 3 },
  { id: 'butcher', title: 'THE BUTCHER', brief: 'Put down twelve of the things in the streets. Then extract.', goal: 12 },
  { id: 'smuggler', title: 'THE SMUGGLER', brief: 'Carry ₦500,000 of contraband to an open extraction.', goal: CONTRABAND_TARGET },
  { id: 'thief', title: 'THE THIEF', brief: 'Hold the Heart for twenty seconds, any way you can. Then extract, with or without it.', goal: 20 },
  { id: 'survivor', title: 'THE SURVIVOR', brief: 'Be alive when the Heart wakes. Never Awaken. Then extract.', goal: 1 },
  { id: 'informant', title: 'THE INFORMANT', brief: 'Shadow {target} for sixty seconds within 35m. Do not kill them. Then extract.', goal: 60 },
];

export class Sim {
  phys = new Physics();
  city: City;
  nav: Nav;
  rng: Rng;
  opts: MatchOptions;
  actors: Actor[] = [];
  creatures: Creature[] = [];
  vehicles: Vehicle[] = [];
  loot: Loot[] = [];
  shields: Shield[] = [];
  grenades: Grenade[] = [];
  events: SimEvent[] = [];
  noises: Noise[] = [];
  brains = new Map<number, BotBrain>();
  cbrains = new Map<number, CreatureBrain>();
  ctrl: any;
  time = 0;
  phase: Phase = 'drop';
  scale = 1;
  night = 0;
  heart = { active: false, pos: v3(), carrier: null as number | null, site: null as Site | null, hold: 0, holdSite: null as Site | null, lastPulse: 0 };
  extractionOpen = false;
  zone = { cx: -40, cz: 0, r: ZONE.startRadius, active: false };
  corruption: Corruption[] = [];
  blackout = new Set<string>();
  winner: number | null = null;
  ended = false;
  private nextId = 1;
  private colliderOwner = new Map<number, { kind: 'actor' | 'creature' | 'vehicle' | 'shield'; id: number }>();

  constructor(opts: MatchOptions) {
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    this.city = generateCity(opts.seed);
    this.nav = new Nav(this.city);
    this.scale = (opts.minutes * 60) / TIMELINE.end;
    this.phys.buildCity(this.city);
    this.ctrl = this.phys.world.createCharacterController(0.03);
    this.ctrl.enableAutostep(0.42, 0.15, false);
    this.ctrl.enableSnapToGround(0.45);
    this.ctrl.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.ctrl.setSlideEnabled(true);
    this.spawnVehicles();
    this.spawnLoot();
    this.spawnActors();
    this.assignContract(this.actors[0]);
    this.zone.cx = -40 + this.rng.range(-90, 90);
    this.zone.cz = this.rng.range(-90, 90);
    this.announce(this.rng.pick(ANNOUNCER.drop), undefined, 'info');
  }

  get local() { return this.actors[0]; }
  t(key: keyof typeof TIMELINE) { return TIMELINE[key] * this.scale; }
  ownerOf(c: RCollider | null | undefined) { return c ? this.colliderOwner.get(c.handle) : undefined; }
  private announce(title: string, sub?: string, tone: 'info' | 'danger' | 'heart' | 'awaken' | 'victory' = 'info') { this.events.push({ t: 'announce', title, sub, tone }); }

  // ---------------------------------------------------------------- spawning
  private makeCapsule(pos: Vec3, member: number) {
    const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + CAP_HALF + CAP_R, pos.z));
    const collider = this.phys.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAP_HALF, CAP_R).setCollisionGroups(groups(member, G.WORLD | G.SHIELD)), body);
    return { body, collider };
  }

  private spawnActors() {
    const total = 1 + this.opts.bots;
    const usedSpawn: Vec3[] = [];
    for (let i = 0; i < total; i++) {
      const bot = i > 0;
      let pos: Vec3;
      if (!bot && this.opts.drop) pos = this.groundAt(this.opts.drop.x, this.opts.drop.z);
      else {
        let tries = 0;
        do {
          const p = this.rng.pick(this.city.spawns);
          pos = { x: p[0] + this.rng.range(-2, 2), y: p[1] + 0.1, z: p[2] + this.rng.range(-2, 2) };
        } while (tries++ < 40 && usedSpawn.some((u) => Math.hypot(u.x - pos.x, u.z - pos.z) < 70));
      }
      usedSpawn.push(pos);
      const archetype: ArchetypeId = bot ? this.rng.pick(['scout', 'hunter', 'enforcer', 'runner'] as ArchetypeId[]) : this.opts.archetype;
      const arch = ARCHETYPES[archetype];
      const look = bot ? this.randomLook(i) : this.opts.look;
      const { body, collider } = this.makeCapsule(pos, G.ACTOR);
      const inv = new Inventory(arch.backpackSlots, archetype === 'runner');
      // everyone lands with a sidearm and their archetype ability; the primary is found in the city
      const skinOf = (id: WeaponId) => (bot ? this.rng.pick(WEAPON_SKINS).id : this.opts.armory[id]?.skin ?? 'factory');
      inv.secondary = { kind: 'weapon', id: 'pistol', mag: 12, att: bot ? {} : { ...this.attFromArmory('pistol') }, skin: skinOf('pistol') };
      inv.secondary.mag = weaponStats(inv.secondary).mag;
      inv.melee.skin = skinOf('machete');
      inv.addStack('ammo_light', 36);
      inv.addStack('bandage', 2);
      inv.abilities[0] = { id: arch.ability, rank: 0, cd: 0 };
      if (arch.startArmor) inv.armor = { kind: 'armor', level: 1, hp: arch.startArmor };
      const a: Actor = {
        id: i, name: bot ? BOT_NAMES[(i * 7 + this.opts.seed) % BOT_NAMES.length] : this.opts.name, bot, alive: true, look, archetype,
        pos, vy: 0, yaw: this.rng.range(0, Math.PI * 2), pitch: 0, ext: v3(), body, collider,
        hp: PLAYER.hp, maxHp: PLAYER.hp, inv, slot: 1, fireCd: 0, reloadT: 0, reloadTotal: 0, healT: 0, healKind: null,
        crouch: false, sprinting: false, aiming: false, grounded: true, swimming: false, mantleT: 0,
        vehicle: null, seat: -1, shadowT: 0, awakenT: 0, heart: false, flashlight: true,
        lastHurt: -99, lastShot: -99, lastStep: 0, lastPing: 0, anim: 'idle', speed: 0, recoil: 0,
        contract: null, kills: 0, creatureKills: 0, damageDealt: 0, placement: 0, killedBy: null, won: null, extracting: 0, usedAwakening: false,
        cmd: emptyCommand(), prevCmd: emptyCommand(),
      };
      this.actors.push(a);
      this.colliderOwner.set(collider.handle, { kind: 'actor', id: i });
      if (bot) this.brains.set(i, new BotBrain(this, a, 0.35 + this.rng.next() * 0.5));
    }
  }
  private attFromArmory(id: WeaponId) {
    const l = this.opts.armory[id]; if (!l) return {};
    const att: WeaponItem['att'] = {};
    if (l.optic) att.optic = l.optic; if (l.muzzle) att.muzzle = l.muzzle; if (l.mag) att.mag = l.mag; if (l.grip) att.grip = l.grip;
    return att;
  }
  private randomLook(i: number): CharacterLook {
    const r = this.rng;
    if (r.chance(0.3)) { const o = r.pick(OPERATORS); return { ...o.look, topColor: r.pick(PALETTE) }; }
    const body = r.chance(0.45) ? 'female' : 'male';
    return {
      name: `Bot${i}`, body, skin: r.int(0, SKIN_TONES.length - 1),
      hair: body === 'female' ? r.pick(['buns', 'long', 'buzzedfemale'] as const) : r.pick(['none', 'buzzed', 'simpleparted'] as const), beard: body === 'male' && r.chance(0.5),
      top: r.pick(TOPS).id, topPattern: r.pick(PATTERNS).id, topColor: r.pick(PALETTE), topAccent: r.pick(PALETTE),
      pants: r.pick(['solid', 'solid', 'camo_urban', 'camo_night'] as const), pantsColor: r.pick(PALETTE), shoes: r.pick(PALETTE),
      head: r.pick(HEADGEAR).id, vest: r.chance(0.4), backpack: r.chance(0.5), scars: r.next(), facePaint: r.pick(['none', 'none', 'tribal', 'ash', 'skull'] as const),
    };
    void HAIRS;
  }

  private spawnVehicles() {
    for (const s of this.city.vehicles) this.addVehicle(s.kind, { x: s.p[0], y: s.p[1], z: s.p[2] }, s.ry);
  }
  addVehicle(kind: VehicleKind, p: Vec3, ry: number) {
    const def = VEHICLES[kind];
    const [sx, sy, sz] = def.size;
    const body = this.phys.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y + 0.6, p.z).setRotation(quatYX(ry)).setLinearDamping(0.12).setAngularDamping(kind === 'okada' ? 2.5 : 0.8).setCcdEnabled(true));
    const hy = sy / 2 - 0.25;
    const collider = this.phys.world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, hy, sz / 2).setTranslation(0, hy * 0.2, 0)
        .setMassProperties(def.mass, { x: 0, y: -0.45, z: 0 }, { x: def.mass * 0.6, y: def.mass * 0.8, z: def.mass * 0.4 }, { w: 1, x: 0, y: 0, z: 0 })
        .setCollisionGroups(groups(G.VEHICLE, G.WORLD | G.VEHICLE | G.SHIELD)).setFriction(0.4), body);
    const ctrl = this.phys.world.createVehicleController(body);
    ctrl.indexUpAxis = 1;
    (ctrl as any).setIndexForwardAxis = 2;
    const wy = -hy + 0.05;
    const wheels: [number, number][] = [[-def.track / 2, def.wheelBase / 2], [def.track / 2, def.wheelBase / 2], [-def.track / 2, -def.wheelBase / 2], [def.track / 2, -def.wheelBase / 2]];
    wheels.forEach(([wx, wz], i) => {
      ctrl.addWheel({ x: wx, y: wy, z: wz }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.32, def.wheelRadius);
      ctrl.setWheelSuspensionStiffness(i, kind === 'okada' ? 38 : 26);
      ctrl.setWheelSuspensionCompression(i, 2.4);
      ctrl.setWheelSuspensionRelaxation(i, 2.9);
      ctrl.setWheelMaxSuspensionForce(i, def.mass * 60);
      ctrl.setWheelMaxSuspensionTravel(i, 0.3);
      ctrl.setWheelFrictionSlip(i, kind === 'okada' ? 3.2 : 2.2);
      ctrl.setWheelSideFrictionStiffness(i, 1.0);
    });
    const v: Vehicle = {
      id: this.vehicles.length, kind, body, ctrl, collider, seats: new Array(def.seats).fill(null), bodyHp: def.body, engine: def.engine,
      tires: [def.tire, def.tire, def.tire, def.tire], fuel: def.fuel * this.rng.range(0.4, 1), fireT: 0, destroyed: false, throttle: 0, steer: 0, horn: 0, lastDriver: null,
      wheelSpin: [0, 0, 0, 0], wheelSteer: 0,
    };
    this.vehicles.push(v);
    this.colliderOwner.set(collider.handle, { kind: 'vehicle', id: v.id });
    return v;
  }

  private spawnLoot() {
    for (const s of this.city.loot) {
      if (!this.rng.chance(s.indoor ? 0.62 : 0.4)) continue;
      const item = this.rollItem(s.tier);
      this.dropItem(item, { x: s.p[0] + this.rng.range(-0.6, 0.6), y: s.p[1] + 0.05, z: s.p[2] + this.rng.range(-0.6, 0.6) });
      // weapons come with some ammo nearby
      if (item.kind === 'weapon') { const st = AMMO_STACK[WEAPONS[item.id].ammo]; if (st) this.dropItem({ kind: 'stack', type: st, count: st === 'ammo_shells' ? 12 : st === 'ammo_sniper' ? 10 : 45 }, { x: s.p[0] + 0.7, y: s.p[1] + 0.05, z: s.p[2] }); }
    }
    // two Awakening artifacts per match, always on high floors or rooftops
    const high = this.city.loot.filter((l) => l.tier === 3);
    for (let i = 0; i < 2 && high.length; i++) { const s = this.rng.pick(high); this.dropItem({ kind: 'stack', type: 'artifact', count: 1 }, { x: s.p[0], y: s.p[1] + 0.05, z: s.p[2] }); }
  }
  rollItem(tier: number): Item {
    const r = this.rng.next();
    if (r < 0.26) return randomWeapon(this.rng, tier, this.rng.pick(WEAPON_SKINS).id);
    if (r < 0.48) { const t = this.rng.pick(['ammo_light', 'ammo_heavy', 'ammo_shells', 'ammo_sniper', 'ammo_heavy', 'ammo_light'] as StackKind[]); return { kind: 'stack', type: t, count: t === 'ammo_shells' ? 12 : t === 'ammo_sniper' ? 8 : 40 }; }
    if (r < 0.62) return { kind: 'stack', type: this.rng.chance(0.75) ? 'bandage' : 'medkit', count: 1 };
    if (r < 0.72) return { kind: 'armor', level: (Math.min(3, Math.max(1, tier + (this.rng.chance(0.25) ? 1 : 0) - (this.rng.chance(0.3) ? 1 : 0)))) as 1 | 2 | 3, hp: 0 };
    if (r < 0.82) return { kind: 'stack', type: 'contraband', count: 1, value: this.rng.pick([20000, 50000, 50000, 100000, 150000]) };
    if (r < 0.88) return { kind: 'stack', type: 'frag', count: 1 };
    if (r < 0.93) return { kind: 'shard', ability: this.rng.pick(['force', 'shadow', 'metal'] as AbilityId[]) };
    return { kind: 'stack', type: this.rng.chance(0.5) ? 'repair' : 'fuel', count: 1 };
  }
  dropItem(item: Item, pos: Vec3) {
    if (item.kind === 'armor' && !item.hp) item.hp = ARMOR_HP[item.level];
    const l: Loot = { id: this.nextId++, item, pos: { ...pos }, taken: false, bob: this.rng.next() * 6 };
    this.loot.push(l);
    return l;
  }

  private assignContract(a: Actor) {
    const pool = CONTRACTS.filter((c) => c.id !== 'informant' || this.actors.length > 2);
    const c = this.rng.pick(pool);
    const contract: Contract = { ...c, progress: 0, done: false, failed: false };
    if (c.id === 'informant') {
      const t = this.rng.pick(this.actors.filter((x) => x.id !== a.id));
      contract.target = t.id;
      contract.brief = c.brief.replace('{target}', t.name);
    }
    a.contract = contract;
  }

  spawnCreature(kind: CreatureKind, p: Vec3, state: Creature['state'] = 'wander') {
    const def = CREATURES[kind];
    const { body, collider } = this.makeCapsule(p, G.CREATURE);
    const c: Creature = {
      id: this.nextId++, kind, alive: true, pos: { ...p }, vy: 0, yaw: this.rng.range(0, 6.28), hp: def.hp, maxHp: def.hp, body, collider,
      state, target: null, targetCreature: false, atkCd: 0, seen: 0, path: [], pathT: 0, wanderTo: null, deadT: 0, anim: 'idle', speed: 0, lit: 0, stuck: 0, lastPos: { ...p },
    };
    this.creatures.push(c);
    this.colliderOwner.set(collider.handle, { kind: 'creature', id: c.id });
    this.cbrains.set(c.id, new CreatureBrain(this, c));
    return c;
  }

  groundAt(x: number, z: number, fromY = 60): Vec3 {
    const hit = this.phys.ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }, fromY + 20, groups(0xffff, G.WORLD));
    return { x, y: hit ? hit.point.y + 0.05 : 0.1, z };
  }

  // ---------------------------------------------------------------- main step
  setCommand(id: number, cmd: Command) { const a = this.actors[id]; if (a) { a.prevCmd = a.cmd; a.cmd = cmd; } }

  step(dt: number) {
    if (this.ended) { this.phys.step(); return; }
    this.time += dt;
    this.updateMatch(dt);
    for (const [id, brain] of this.brains) { const a = this.actors[id]; if (a.alive) this.setCommand(id, brain.think(dt)); }
    for (const a of this.actors) if (a.alive) this.updateActor(a, dt);
    for (const v of this.vehicles) this.updateVehicle(v, dt);
    this.updateCreatures(dt);
    this.updateGrenades(dt);
    this.updateShields(dt);
    this.phys.step();
    this.syncSeats();
    this.noises = this.noises.filter((n) => this.time - n.t < 2.5);
  }

  // ---------------------------------------------------------------- match flow
  private updateMatch(dt: number) {
    const t = this.time;
    this.night = Math.min(1, 0.55 + 0.45 * (t / this.t('heart')));
    const setPhase = (p: Phase) => { if (this.phase !== p) { this.phase = p; this.onPhase(p); } };
    if (t >= this.t('collapse')) setPhase('collapse');
    else if (t >= this.t('extraction')) setPhase('extraction');
    else if (t >= this.t('heart')) setPhase('heart');
    else if (t >= this.t('corruption')) setPhase('corruption');
    else if (t >= this.t('survival')) setPhase('survival');

    // shrinking zone
    if (this.zone.active) {
      const a = this.t('collapse'), b = this.t('end');
      const k = Math.min(1, (t - a) / (b - a));
      this.zone.r = ZONE.startRadius + (ZONE.finalRadius - ZONE.startRadius) * k;
      if (t > b) this.zone.r = Math.max(0, ZONE.finalRadius - (t - b) * 0.8);
    }
    const zoneDps = ZONE.dps[Math.min(3, Math.floor(((t - this.t('collapse')) / (this.t('end') - this.t('collapse') + 1)) * 4))] ?? 1;
    for (const a of this.actors) {
      if (!a.alive) continue;
      if (this.zone.active && Math.hypot(a.pos.x - this.zone.cx, a.pos.z - this.zone.cz) > this.zone.r) this.damageActor(a, zoneDps * dt, null, false, 'The Collapse');
      for (const c of this.corruption) if (Math.hypot(a.pos.x - c.x, a.pos.z - c.z) < c.r) this.damageActor(a, 1.5 * dt, null, false, 'Corruption');
      // regen and contract tracking
      if (a.heart) a.hp = Math.min(a.maxHp, a.hp + HEART.hpBonus * 0 + PLAYER.carrierRegen * dt);
      if (a.awakenT > 0) a.hp = Math.min(a.maxHp, a.hp + AWAKENING.regen * dt);
      this.trackContract(a, dt);
    }

    // Heart pulses and extraction
    if (this.heart.active) {
      if (this.heart.carrier !== null) {
        const c = this.actors[this.heart.carrier];
        this.heart.pos = { ...c.pos };
        if (t - this.heart.lastPulse > HEART.pingEvery) { this.heart.lastPulse = t; this.events.push({ t: 'ping', kind: 'heart', at: { ...c.pos }, actor: c.id }, { t: 'heartPulse' }); }
        if (this.extractionOpen) {
          const site = this.city.extractions.find((e) => Math.hypot(e.p[0] - c.pos.x, e.p[2] - c.pos.z) < e.r && Math.abs(e.p[1] - c.pos.y) < 4);
          if (site) {
            if (this.heart.holdSite !== site) { this.heart.holdSite = site; this.announce(`${c.name.toUpperCase()} IS EXTRACTING`, site.name, 'heart'); }
            this.heart.hold += dt;
            if (this.heart.hold >= HEART.holdTime) this.finish(c.id, 'heart');
          } else { this.heart.hold = Math.max(0, this.heart.hold - HEART.decay * dt); if (this.heart.hold === 0) this.heart.holdSite = null; }
        }
      } else if (t - this.heart.lastPulse > HEART.pingEvery) { this.heart.lastPulse = t; this.events.push({ t: 'heartPulse' }); }
    }
    // contract extraction (local player only; bots do not hold contracts)
    const me = this.local;
    if (this.extractionOpen && me.alive && me.contract?.done && !me.won) {
      const inSite = this.city.extractions.some((e) => Math.hypot(e.p[0] - me.pos.x, e.p[2] - me.pos.z) < e.r && Math.abs(e.p[1] - me.pos.y) < 4);
      me.extracting = inSite ? me.extracting + dt : Math.max(0, me.extracting - dt);
      if (me.contract.id === 'smuggler' && inSite) me.contract.progress = me.inv.contrabandValue();
      if (me.extracting >= HEART.contractHold) {
        me.won = 'contract';
        this.events.push({ t: 'announce', title: 'CONTRACT FULFILLED', sub: 'You slipped out of Lagos.', tone: 'victory' });
        me.alive = false; me.placement = 1;
        this.removeFromWorld(me);
      }
    }

    // last one standing
    const alive = this.actors.filter((a) => a.alive);
    if (t > 20 && alive.length === 1 && !this.ended) this.finish(alive[0].id, 'survivor');
    if (t > 20 && alive.length === 0 && !this.ended) this.finish(null, 'none');

    // awakened pings
    for (const a of alive) if (a.awakenT > 0 && t - a.lastPing > AWAKENING.pingEvery) { a.lastPing = t; this.events.push({ t: 'ping', kind: 'awakened', at: { ...a.pos }, actor: a.id }); }
  }

  private onPhase(p: Phase) {
    if (p === 'survival') this.announce(this.rng.pick(ANNOUNCER.survival), undefined, 'info');
    if (p === 'corruption') {
      const pool = this.city.regions.filter((r) => ['Mainland Estates', 'Central Oshodi', 'Lagoon Edge', 'Airport Road'].includes(r.name));
      for (const r of this.rng.shuffle([...pool]).slice(0, 2)) {
        const x = this.rng.range(Math.max(r.x0, -300) + 40, Math.min(r.x1, 270) - 40), z = this.rng.range(Math.max(r.z0, -330) + 40, Math.min(r.z1, 330) - 40);
        this.corruption.push({ name: r.name, x, z, r: this.rng.range(45, 70) });
      }
      const c = this.corruption[0];
      this.announce('THE CITY IS CHANGING', ANNOUNCER.corruption[0].replace('{district}', c?.name ?? 'mainland'), 'danger');
      const bo = this.rng.pick(this.city.regions).name;
      this.blackout.add(bo);
      this.events.push({ t: 'blackout', region: bo });
    }
    if (p === 'heart') {
      const site = this.rng.pick(this.city.heartSites);
      this.heart.active = true; this.heart.site = site; this.heart.pos = { x: site.p[0], y: site.p[1] + 0.6, z: site.p[2] }; this.heart.lastPulse = this.time;
      this.announce(ANNOUNCER.heart, ANNOUNCER.heartSub.replace('{site}', site.name), 'heart');
      this.events.push({ t: 'heartPulse' });
      for (const a of this.actors) if (a.alive && a.contract?.id === 'survivor' && !a.usedAwakening) { a.contract.progress = 1; a.contract.done = true; }
    }
    if (p === 'extraction') { this.extractionOpen = true; this.announce(ANNOUNCER.extraction, ANNOUNCER.extractionSub, 'heart'); }
    if (p === 'collapse') { this.zone.active = true; this.announce(ANNOUNCER.collapse, 'Get inside the circle.', 'danger'); }
  }

  private finish(winner: number | null, how: 'heart' | 'survivor' | 'none') {
    if (this.ended) return;
    this.ended = true; this.phase = 'ended'; this.winner = winner;
    if (winner !== null) { const w = this.actors[winner]; w.won = how === 'none' ? null : how; w.placement = 1; }
    let place = 2;
    for (const a of this.actors.filter((x) => x.alive && x.id !== winner)) a.placement = place++;
    this.events.push({ t: 'matchEnd', winner, how });
  }

  private trackContract(a: Actor, dt: number) {
    const c = a.contract;
    if (!c || c.done || c.failed) return;
    if (c.id === 'hunter') c.progress = a.kills;
    if (c.id === 'butcher') c.progress = a.creatureKills;
    if (c.id === 'smuggler') c.progress = a.inv.contrabandValue();
    if (c.id === 'thief' && a.heart) c.progress += dt;
    if (c.id === 'informant' && c.target !== undefined) {
      const t = this.actors[c.target];
      if (!t.alive) { if (t.killedBy === a.name) c.failed = true; }
      else if (Math.hypot(t.pos.x - a.pos.x, t.pos.z - a.pos.z) < 35) c.progress += dt;
    }
    if (c.id === 'survivor' && a.usedAwakening) c.failed = true;
    if (c.progress >= c.goal && !c.failed) { c.done = true; if (!a.bot) this.announce('CONTRACT COMPLETE', this.extractionOpen ? 'Reach any extraction and hold it.' : 'Survive until extraction opens.', 'victory'); }
  }

  // ---------------------------------------------------------------- actors
  private updateActor(a: Actor, dt: number) {
    const cmd = a.cmd, prev = a.prevCmd;
    const pressed = (k: keyof Command) => !!cmd[k] && !prev[k];
    a.fireCd = Math.max(0, a.fireCd - dt);
    a.recoil *= Math.exp(-8 * dt);
    a.shadowT = Math.max(0, a.shadowT - dt);
    for (const ab of a.inv.abilities) if (ab) ab.cd = Math.max(0, ab.cd - dt);
    if (pressed('flashlight')) a.flashlight = !a.flashlight;
    if (a.awakenT > 0) {
      a.awakenT -= dt;
      if (a.awakenT <= 0) { a.awakenT = 0; a.maxHp = PLAYER.hp + (a.heart ? HEART.hpBonus : 0); a.hp = Math.min(a.hp, a.maxHp); }
    }
    a.yaw = cmd.yaw; a.pitch = cmd.pitch;

    if (pressed('interact')) this.interact(a);
    if (a.vehicle !== null) { this.vehicleSeatActions(a, dt); return; }

    // slot switching
    if (cmd.slot >= 0 && cmd.slot !== a.slot) {
      const target = cmd.slot as 0 | 1 | 2;
      if (target === 2 || (target === 0 ? a.inv.primary : a.inv.secondary)) { a.slot = target; a.reloadT = 0; a.fireCd = 0.35; }
    }
    if (pressed('awaken') && a.awakenT <= 0 && a.inv.count('artifact') > 0) this.awaken(a);
    if (pressed('heal') && a.healT <= 0 && a.hp < a.maxHp) {
      const kind = a.hp < 50 && a.inv.count('medkit') ? 'medkit' : a.inv.count('bandage') ? 'bandage' : a.inv.count('medkit') ? 'medkit' : null;
      if (kind) { a.healKind = kind; a.healT = kind === 'medkit' ? 5 : 2.5; }
    }
    if (a.healT > 0) {
      a.healT -= dt;
      if (cmd.fire || cmd.sprint) { a.healT = 0; a.healKind = null; }
      else if (a.healT <= 0 && a.healKind) { if (a.inv.take(a.healKind, 1)) a.hp = Math.min(a.maxHp, a.hp + (a.healKind === 'medkit' ? 100 : 25)); a.healKind = null; }
    }
    if (pressed('ability1')) this.useAbility(a, 0);
    if (pressed('ability2')) this.useAbility(a, 1);
    if (pressed('throwFrag') && a.inv.take('frag', 1)) this.throwFrag(a);
    if (cmd.dropIndex >= 0) { const s = a.inv.drop(cmd.dropIndex); if (s) this.dropItem(s, { x: a.pos.x + Math.sin(a.yaw), y: a.pos.y + 0.05, z: a.pos.z + Math.cos(a.yaw) }); }

    this.moveActor(a, dt);
    this.combat(a, dt, pressed('reload'), pressed('fire'));
    this.autoPickup(a);
  }

  private moveActor(a: Actor, dt: number) {
    const cmd = a.cmd;
    const w = this.currentWeapon(a);
    const arch = ARCHETYPES[a.archetype];
    a.crouch = cmd.crouch && !a.swimming;
    a.aiming = cmd.aim && a.awakenT <= 0;
    const moving = Math.hypot(cmd.mx, cmd.mz) > 0.1;
    // sprint is forward-ish only, never while aiming
    const fwdDot = moving ? (cmd.mx * Math.sin(a.yaw) + cmd.mz * Math.cos(a.yaw)) / Math.hypot(cmd.mx, cmd.mz) : 0;
    a.sprinting = cmd.sprint && moving && !a.aiming && !a.crouch && (fwdDot > 0.3 || !cmd.aim) && a.healT <= 0;
    let speed = a.crouch ? PLAYER.crouch : a.aiming ? PLAYER.aimMove : a.sprinting ? PLAYER.sprint * arch.sprintMult : PLAYER.jog;
    if (w) speed *= weaponStats(w).moveMult;
    if (a.heart) speed *= PLAYER.carrierSpeedMult;
    if (a.awakenT > 0) speed *= AWAKENING.speedMult;
    if (a.healT > 0) speed = Math.min(speed, PLAYER.walk);

    const inWater = a.pos.x > this.city.water.x0 && a.pos.y < this.city.water.y - 0.7;
    a.swimming = inWater;

    // mantle in progress: scripted climb over a ledge
    if (a.mantleT > 0) {
      a.mantleT -= dt;
      const tgt = (a as any)._mantleTo as Vec3;
      const k = Math.min(1, dt * 7);
      const next = { x: a.pos.x + (tgt.x - a.pos.x) * k, y: a.pos.y + (tgt.y - a.pos.y) * Math.min(1, dt * 10), z: a.pos.z + (tgt.z - a.pos.z) * k };
      a.pos = next; a.vy = 0; a.anim = 'mantle';
      a.body.setNextKinematicTranslation({ x: a.pos.x, y: a.pos.y + CAP_HALF + CAP_R, z: a.pos.z });
      return;
    }

    let jumped = false;
    if (a.swimming) {
      speed = 2.4;
      const target = this.city.water.y - 1.15;
      a.vy += (target - a.pos.y) * 6 * dt; a.vy *= Math.exp(-3 * dt);
    } else {
      if (a.grounded && cmd.jump && !a.prevCmd.jump) {
        if (!this.tryMantle(a)) { a.vy = PLAYER.jump * (a.awakenT > 0 ? AWAKENING.jumpMult : 1); jumped = true; }
        else return;
      }
      a.vy -= PLAYER.gravity * dt;
    }
    const decay = Math.exp(-5 * dt);
    a.ext.x *= decay; a.ext.z *= decay; a.ext.y *= decay;
    const desired = { x: cmd.mx * speed * dt + a.ext.x * dt, y: a.vy * dt + a.ext.y * dt, z: cmd.mz * speed * dt + a.ext.z * dt };
    this.ctrl.computeColliderMovement(a.collider, desired, undefined, MOVE_FILTER);
    const m = this.ctrl.computedMovement();
    // Awakened climb: pushing into a wall turns into a climb
    if (a.awakenT > 0 && moving) {
      const want = Math.hypot(desired.x, desired.z), got = Math.hypot(m.x, m.z);
      if (want > 0.01 && got < want * 0.35) { a.vy = AWAKENING.climbSpeed; m.y = AWAKENING.climbSpeed * dt; a.anim = 'climb'; }
    }
    const vyBefore = a.vy;
    a.pos.x += m.x; a.pos.y += m.y; a.pos.z += m.z;
    const wasGrounded = a.grounded;
    a.grounded = this.ctrl.computedGrounded();
    if (a.grounded && a.vy < 0) {
      if (!wasGrounded && vyBefore < -15 && !a.swimming && a.awakenT <= 0) this.damageActor(a, (-vyBefore - 15) * 7, null, false, 'the fall');
      a.vy = 0;
    }
    if (!a.grounded && desired.y > 0 && m.y < desired.y * 0.5) a.vy = Math.min(a.vy, 0);
    if (a.pos.y < -30) { const n = this.nav.pos(this.nav.nearest(a.pos, 400)); a.pos = { ...n }; a.vy = 0; }
    a.body.setNextKinematicTranslation({ x: a.pos.x, y: a.pos.y + CAP_HALF + CAP_R, z: a.pos.z });
    a.speed = Math.hypot(m.x, m.z) / dt;

    // animation state and footsteps
    if (a.swimming) a.anim = a.speed > 0.5 ? 'swim' : 'swimIdle';
    else if (!a.grounded && (jumped || a.vy > 1)) a.anim = 'jump';
    else if (!a.grounded && a.vy < -4) a.anim = 'fall';
    else if (a.healT > 0) a.anim = 'heal';
    else if (a.crouch) a.anim = a.speed > 0.3 ? 'crouchWalk' : 'crouch';
    else if (a.speed > 5.2) a.anim = 'sprint';
    else if (a.speed > 2.8) a.anim = 'jog';
    else if (a.speed > 0.3) a.anim = 'walk';
    else a.anim = 'idle';
    if (a.grounded && a.speed > 0.8) {
      const stride = a.sprinting ? 0.3 : a.crouch ? 0.6 : 0.42;
      if (this.time - a.lastStep > stride) {
        a.lastStep = this.time;
        const loud = !a.crouch && (a.sprinting || a.speed > 3) && !(a.archetype === 'scout' && !a.sprinting);
        this.events.push({ t: 'step', actor: a.id, at: { ...a.pos }, loud, surface: this.surfaceUnder(a.pos) });
        if (loud) this.noises.push({ pos: { ...a.pos }, r: a.sprinting ? 22 : 12, t: this.time, by: a.id });
      }
    }
  }

  surfaceUnder(p: Vec3) {
    const hit = this.phys.ray({ x: p.x, y: p.y + 0.3, z: p.z }, { x: 0, y: -1, z: 0 }, 1.2, groups(0xffff, G.WORLD));
    return hit?.tag?.mat ?? 'concrete';
  }

  private tryMantle(a: Actor) {
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    const mx = a.cmd.mx, mz = a.cmd.mz;
    const dx = Math.hypot(mx, mz) > 0.2 ? mx / Math.hypot(mx, mz) : fx, dz = Math.hypot(mx, mz) > 0.2 ? mz / Math.hypot(mx, mz) : fz;
    const chest = this.phys.ray({ x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z }, { x: dx, y: 0, z: dz }, 0.95, groups(0xffff, G.WORLD | G.VEHICLE), a.collider);
    if (!chest) return false;
    const probe = { x: a.pos.x + dx * (chest.t + 0.45), y: a.pos.y + 2.3, z: a.pos.z + dz * (chest.t + 0.45) };
    const down = this.phys.ray(probe, { x: 0, y: -1, z: 0 }, 2.3, groups(0xffff, G.WORLD | G.VEHICLE));
    if (!down) return false;
    const h = down.point.y - a.pos.y;
    if (h < 0.45 || h > 2.05) return false;
    const head = this.phys.ray({ x: probe.x, y: down.point.y + 0.05, z: probe.z }, { x: 0, y: 1, z: 0 }, 1.7, groups(0xffff, G.WORLD | G.VEHICLE));
    if (head) return false;
    (a as any)._mantleTo = { x: probe.x, y: down.point.y + 0.02, z: probe.z };
    a.mantleT = 0.45;
    return true;
  }

  currentWeapon(a: Actor): WeaponItem | null { return a.slot === 0 ? a.inv.primary : a.slot === 1 ? a.inv.secondary : a.inv.melee; }
  eye(a: Actor): Vec3 { return { x: a.pos.x, y: a.pos.y + (a.crouch ? EYE_CROUCH : EYE), z: a.pos.z }; }
  aimDir(a: Actor): Vec3 {
    if (a.cmd.aimDir) return a.cmd.aimDir;
    const cp = Math.cos(a.pitch);
    return { x: Math.sin(a.yaw) * cp, y: Math.sin(a.pitch), z: Math.cos(a.yaw) * cp };
  }

  private combat(a: Actor, dt: number, reloadPressed: boolean, firePressed: boolean) {
    if (a.awakenT > 0) { if (a.cmd.fire && a.fireCd <= 0) this.melee(a, AWAKENING.clawDamage, AWAKENING.clawRange, 0.55, 'Claws'); return; }
    const w = this.currentWeapon(a);
    if (!w) return;
    const st = weaponStats(w);
    if (w.id === 'machete') { if (firePressed && a.fireCd <= 0) this.melee(a, st.damage, st.range, 60 / st.rpm, st.name); return; }
    const stack = AMMO_STACK[st.ammo]!;
    if (a.reloadT > 0) {
      a.reloadT -= dt;
      if (a.reloadT <= 0) { const need = st.mag - w.mag; w.mag += a.inv.take(stack, need); }
      return;
    }
    const wantReload = reloadPressed || (w.mag === 0 && a.cmd.fire);
    if (wantReload && w.mag < st.mag && a.inv.count(stack) > 0) { a.reloadT = a.reloadTotal = st.reload; this.events.push({ t: 'reload', actor: a.id }); return; }
    const trigger = st.auto ? a.cmd.fire : firePressed;
    if (!trigger || a.fireCd > 0 || w.mag <= 0 || a.healT > 0 || a.sprinting) return;
    a.fireCd = 60 / st.rpm;
    w.mag--;
    a.lastShot = this.time;
    a.shadowT = 0;
    a.recoil += st.recoil;
    const suppressed = w.att.muzzle === 'suppressor';
    this.noises.push({ pos: { ...a.pos }, r: st.noise, t: this.time, by: a.id });
    const eye = this.eye(a);
    const dir = this.aimDir(a);
    const moving = a.speed > 1 ? 1.6 : 1;
    const spread = (a.aiming ? st.adsSpread : st.hipSpread) * moving * (a.crouch ? 0.7 : 1);
    for (let p = 0; p < st.pellets; p++) {
      const d = this.jitter(dir, spread);
      this.hitscan(a, eye, d, st, w, suppressed, p === 0);
    }
  }

  private jitter(d: Vec3, s: number): Vec3 {
    if (s <= 0) return d;
    const r = s * Math.sqrt(this.rng.next()), th = this.rng.next() * Math.PI * 2;
    // build an orthonormal basis around d
    const up = Math.abs(d.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const rx = { x: up.y * d.z - up.z * d.y, y: up.z * d.x - up.x * d.z, z: up.x * d.y - up.y * d.x };
    const rl = Math.hypot(rx.x, rx.y, rx.z); rx.x /= rl; rx.y /= rl; rx.z /= rl;
    const ry = { x: d.y * rx.z - d.z * rx.y, y: d.z * rx.x - d.x * rx.z, z: d.x * rx.y - d.y * rx.x };
    const o = { x: d.x + (rx.x * Math.cos(th) + ry.x * Math.sin(th)) * r, y: d.y + (rx.y * Math.cos(th) + ry.y * Math.sin(th)) * r, z: d.z + (rx.z * Math.cos(th) + ry.z * Math.sin(th)) * r };
    const l = Math.hypot(o.x, o.y, o.z);
    return { x: o.x / l, y: o.y / l, z: o.z / l };
  }

  private hitscan(a: Actor, eye: Vec3, d: Vec3, st: ReturnType<typeof weaponStats>, w: WeaponItem, suppressed: boolean, emit: boolean) {
    const exclude = a.vehicle !== null ? this.vehicles[a.vehicle].collider : a.collider;
    const hit = this.phys.ray(eye, d, st.maxRange, undefined, exclude, (c) => c.handle !== a.collider.handle);
    const to = hit ? hit.point : { x: eye.x + d.x * st.maxRange, y: eye.y + d.y * st.maxRange, z: eye.z + d.z * st.maxRange };
    let kind: 'world' | 'flesh' | 'metal' | 'none' = hit ? 'world' : 'none';
    if (hit) {
      const dist = hit.t;
      const fall = dist <= st.range ? 1 : Math.max(0.45, 1 - ((dist - st.range) / (st.maxRange - st.range)) * 0.55);
      const owner = this.ownerOf(hit.collider);
      if (owner?.kind === 'actor') {
        const t = this.actors[owner.id];
        const head = to.y > t.pos.y + (t.crouch ? 1.0 : 1.48);
        this.damageActor(t, st.damage * fall * (head ? st.headMult : 1), a, head, st.name);
        kind = 'flesh';
      } else if (owner?.kind === 'creature') {
        const c = this.creatures.find((x) => x.id === owner.id);
        if (c) { const head = to.y > c.pos.y + 1.45 * CREATURES[c.kind].scale[1]; this.damageCreature(c, st.damage * fall * (head ? st.headMult : 1), a, head, to); }
        kind = 'flesh';
      } else if (owner?.kind === 'vehicle') { this.damageVehicle(this.vehicles[owner.id], st.damage * fall, to, a.id); kind = 'metal'; }
      else if (owner?.kind === 'shield') { const s = this.shields.find((x) => x.id === owner.id); if (s) s.hp -= st.damage; kind = 'metal'; }
      else if (hit.tag?.mat && ['metal', 'container', 'corrugated', 'rust', 'shutter'].includes(hit.tag.mat)) kind = 'metal';
    }
    if (emit || st.pellets > 1) this.events.push({ t: 'shot', actor: a.id, weapon: w.id, from: eye, to, suppressed, hit: kind, normal: hit?.normal ? { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } : undefined });
  }

  private melee(a: Actor, dmg: number, range: number, cd: number, label: string) {
    a.fireCd = cd;
    this.events.push({ t: 'melee', actor: a.id });
    const f = { x: Math.sin(a.yaw), z: Math.cos(a.yaw) };
    for (const t of this.actors) {
      if (t === a || !t.alive || t.vehicle !== null) continue;
      const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > range + 0.4 || Math.abs(t.pos.y - a.pos.y) > 1.8) continue;
      if ((dx * f.x + dz * f.z) / (d || 1) < 0.45) continue;
      this.damageActor(t, dmg, a, false, label);
      t.ext.x += (dx / (d || 1)) * 6; t.ext.z += (dz / (d || 1)) * 6;
    }
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > range + 0.4 || Math.abs(c.pos.y - a.pos.y) > 1.8) continue;
      if ((dx * f.x + dz * f.z) / (d || 1) < 0.45) continue;
      this.damageCreature(c, dmg, a, false, { x: c.pos.x, y: c.pos.y + 1.2, z: c.pos.z });
    }
  }

  damageActor(t: Actor, dmg: number, by: Actor | null, head: boolean, label: string, creature = false) {
    if (!t.alive || dmg <= 0 || t.won) return;
    let armorHit = false;
    if (t.inv.armor && t.inv.armor.hp > 0 && by) {
      const absorbed = Math.min(t.inv.armor.hp, dmg * 0.7);
      t.inv.armor.hp -= absorbed; dmg -= absorbed; armorHit = true;
      if (t.inv.armor.hp <= 0) t.inv.armor = null;
    }
    t.hp -= dmg;
    t.lastHurt = this.time;
    if (t.healT > 0) { t.healT = 0; t.healKind = null; }
    if (by) { by.damageDealt += dmg; this.events.push({ t: 'hit', target: t.id, targetKind: 'actor', by: by.id, dmg, head, at: this.eye(t), armor: armorHit }); }
    // damage over time is batched so the HUD gets one hurt pulse per point, not one per frame
    (t as any)._dot = ((t as any)._dot ?? 0) + dmg;
    if (by || (t as any)._dot >= 4) { this.events.push({ t: 'hurt', actor: t.id, dmg: (t as any)._dot, from: by ? { ...by.pos } : null }); (t as any)._dot = 0; }
    if (t.hp <= 0) this.kill(t, by, label, head, creature);
  }

  private kill(t: Actor, by: Actor | null, label: string, head: boolean, creature = false) {
    t.alive = false; t.hp = 0; t.anim = 'dead';
    t.placement = this.actors.filter((a) => a.alive).length + 1;
    t.killedBy = by ? by.name : creature ? label : label;
    if (by && by !== t) by.kills++;
    this.events.push({ t: 'kill', victim: t.id, victimName: t.name, killer: by?.id ?? null, killerName: by?.name ?? label, weapon: label, head });
    // spill the body's loot
    const spill: Item[] = [];
    if (t.inv.primary) spill.push(t.inv.primary);
    if (t.inv.secondary) spill.push(t.inv.secondary);
    if (t.inv.armor) spill.push(t.inv.armor);
    for (const s of t.inv.backpack) if (s) spill.push(s);
    for (const ab of t.inv.abilities) if (ab && this.rng.chance(0.5)) spill.push({ kind: 'shard', ability: ab.id });
    if (t.awakenT > 0) { spill.push({ kind: 'stack', type: 'core', count: 1 }); this.announce('AN AWAKENED HAS FALLEN', `${by?.name ?? 'Something'} took its core.`, 'awaken'); }
    spill.forEach((it, i) => { const ang = (i / spill.length) * Math.PI * 2; this.dropItem(it, { x: t.pos.x + Math.cos(ang) * 0.9, y: t.pos.y + 0.05, z: t.pos.z + Math.sin(ang) * 0.9 }); });
    if (t.heart) {
      t.heart = false; this.heart.carrier = null; this.heart.hold = 0; this.heart.holdSite = null;
      const g = this.groundAt(t.pos.x, t.pos.z, t.pos.y + 1.5);
      this.heart.pos = { x: g.x, y: (t.swimming ? this.city.water.y + 0.3 : g.y) + 0.6, z: g.z };
      this.announce(ANNOUNCER.heartDropped, `${t.name} fell with it.`, 'heart');
    }
    if (t.vehicle !== null) this.exitVehicle(t);
    this.removeFromWorld(t);
  }
  private removeFromWorld(a: Actor) { a.collider.setEnabled(false); }

  damageCreature(c: Creature, dmg: number, by: Actor | null, head: boolean, at: Vec3) {
    if (!c.alive) return;
    c.hp -= dmg;
    if (by) { by.damageDealt += dmg; this.events.push({ t: 'hit', target: c.id, targetKind: 'creature', by: by.id, dmg, head, at, armor: false }); if (c.state !== 'frozen') { c.target = by.id; c.state = 'chase'; } }
    if (c.hp <= 0) {
      c.alive = false; c.state = 'dead'; c.anim = 'dead'; c.deadT = 0; c.collider.setEnabled(false);
      if (by) by.creatureKills++;
      this.events.push({ t: 'creatureDeath', id: c.id, by: by?.id ?? null });
      if (this.rng.chance(c.kind === 'stalker' ? 0.9 : 0.18)) this.dropItem(c.kind === 'stalker' ? { kind: 'shard', ability: this.rng.pick(['force', 'shadow', 'metal'] as AbilityId[]) } : this.rollItem(1), { ...c.pos, y: c.pos.y + 0.05 });
    }
  }

  // ---------------------------------------------------------------- interaction and loot
  private interact(a: Actor) {
    if (a.vehicle !== null) { this.exitVehicle(a); return; }
    if (this.heart.active && this.heart.carrier === null && dist3(a.pos, this.heart.pos) < 2.6) { this.takeHeart(a); return; }
    const l = this.nearestLoot(a, 2.4);
    if (l) { this.pickup(a, l, true); return; }
    let best: Vehicle | null = null, bd = 4;
    for (const v of this.vehicles) { if (v.destroyed) continue; const p = v.body.translation(); const d = Math.hypot(p.x - a.pos.x, p.z - a.pos.z); if (d < bd && Math.abs(p.y - a.pos.y) < 2.5) { bd = d; best = v; } }
    if (best) this.enterVehicle(a, best);
  }
  takeHeart(a: Actor) {
    a.heart = true; this.heart.carrier = a.id; this.heart.lastPulse = this.time - HEART.pingEvery + 1;
    a.maxHp += HEART.hpBonus; a.hp += HEART.hpBonus;
    this.announce(ANNOUNCER.carrier.replace('{name}', a.name.toUpperCase()), ANNOUNCER.carrierSub, 'heart');
  }
  nearestLoot(a: Actor, r: number) {
    let best: Loot | null = null, bd = r;
    const f = { x: Math.sin(a.yaw), z: Math.cos(a.yaw) };
    for (const l of this.loot) {
      if (l.taken) continue;
      const dx = l.pos.x - a.pos.x, dz = l.pos.z - a.pos.z, dy = l.pos.y - a.pos.y;
      if (Math.abs(dy) > 1.6) continue;
      const d = Math.hypot(dx, dz) - Math.max(0, (dx * f.x + dz * f.z)) * 0.3;
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  private autoPickup(a: Actor) {
    for (const l of this.loot) {
      if (l.taken || l.item.kind !== 'stack') continue;
      if (Math.abs(l.pos.x - a.pos.x) > 1.3 || Math.abs(l.pos.z - a.pos.z) > 1.3 || Math.abs(l.pos.y - a.pos.y) > 1.4) continue;
      const t = l.item.type;
      if (t === 'artifact' || t === 'core') continue; // these are a choice, not an accident
      this.pickup(a, l, false);
    }
  }
  pickup(a: Actor, l: Loot, explicit: boolean) {
    const it = l.item;
    let ok = true;
    if (it.kind === 'stack') {
      if (it.type === 'core') {
        // a core refills both abilities and hardens the wearer
        for (const ab of a.inv.abilities) if (ab) { ab.cd = 0; ab.rank = Math.min(2, ab.rank + 1); }
        a.inv.armor = { kind: 'armor', level: 3, hp: Math.max(a.inv.armor?.hp ?? 0, 75) };
        a.hp = a.maxHp;
      } else {
        const left = a.inv.addStack(it.type, it.count, it.value);
        if (left === it.count) ok = false; else if (left > 0) { it.count = left; this.events.push({ t: 'pickup', actor: a.id, label: itemLabel({ ...it, count: it.count }), rarity: itemRarity(it) }); return; }
      }
    } else if (it.kind === 'weapon') {
      if (!explicit) return;
      const slot = WEAPONS[it.id].slot;
      const key = slot === 'primary' ? 'primary' : 'secondary';
      // your armory skin follows you onto anything you pick up
      if (!a.bot) { it.skin = this.opts.armory[it.id]?.skin ?? it.skin; }
      const old = a.inv[key];
      a.inv[key] = it;
      if (old) this.dropItem(old, { ...l.pos });
      a.slot = key === 'primary' ? 0 : 1; a.reloadT = 0;
    } else if (it.kind === 'armor') {
      if (!explicit && a.inv.armor && a.inv.armor.hp >= it.hp) return;
      const old = a.inv.armor; a.inv.armor = it; if (old) this.dropItem(old, { ...l.pos });
    } else if (it.kind === 'shard') {
      if (!explicit) return;
      const [s0, s1] = a.inv.abilities;
      if (s0 && s0.id === it.ability) s0.rank = Math.min(2, s0.rank + 1);
      else if (s1 && s1.id === it.ability) s1.rank = Math.min(2, s1.rank + 1);
      else if (!s1) a.inv.abilities[1] = { id: it.ability, rank: 0, cd: 0 };
      else { this.dropItem({ kind: 'shard', ability: s1.id }, { ...l.pos }); a.inv.abilities[1] = { id: it.ability, rank: 0, cd: 0 }; }
    }
    if (!ok) return;
    l.taken = true;
    this.events.push({ t: 'pickup', actor: a.id, label: itemLabel(it), rarity: itemRarity(it) });
  }

  // ---------------------------------------------------------------- abilities, awakening, grenades
  private useAbility(a: Actor, i: 0 | 1) {
    const ab = a.inv.abilities[i];
    if (!ab || ab.cd > 0 || a.awakenT > 0) return;
    const def = ABILITIES[ab.id];
    const mult = ABILITY_RANK_MULT[ab.rank];
    ab.cd = def.cooldown / (1 + ab.rank * 0.15);
    const dir = this.aimDir(a);
    const flat = { x: Math.sin(a.yaw), y: 0, z: Math.cos(a.yaw) };
    this.events.push({ t: 'ability', actor: a.id, ability: ab.id, at: this.eye(a), dir });
    if (ab.id === 'force') {
      const range = 10 * mult, cosA = Math.cos(0.75);
      for (const t of this.actors) {
        if (t === a || !t.alive) continue;
        const d = sub(t.pos, a.pos), len = Math.hypot(d.x, d.z);
        if (len > range || Math.abs(d.y) > 4 || (d.x * flat.x + d.z * flat.z) / (len || 1) < cosA) continue;
        const push = (18 * mult) * (1 - len / range * 0.5);
        if (t.vehicle !== null) continue;
        t.ext.x += flat.x * push; t.ext.z += flat.z * push; t.vy = 6;
        this.damageActor(t, 14 * mult, a, false, 'Force');
      }
      for (const c of this.creatures) {
        if (!c.alive) continue;
        const d = sub(c.pos, a.pos), len = Math.hypot(d.x, d.z);
        if (len > range || (d.x * flat.x + d.z * flat.z) / (len || 1) < cosA) continue;
        c.vy = 7; (c as any)._push = { x: flat.x * 20 * mult, z: flat.z * 20 * mult };
        this.damageCreature(c, 30 * mult, a, false, c.pos);
        if (c.kind !== 'stalker') { c.state = 'frozen'; (c as any)._stun = 1.2; }
      }
      for (const v of this.vehicles) {
        const p = v.body.translation(); const d = sub(p, a.pos), len = Math.hypot(d.x, d.z);
        if (len > range || (d.x * flat.x + d.z * flat.z) / (len || 1) < cosA) continue;
        const m = VEHICLES[v.kind].mass;
        v.body.applyImpulse({ x: flat.x * m * 9 * mult, y: m * 4, z: flat.z * m * 9 * mult }, true);
        v.body.applyTorqueImpulse({ x: flat.z * m * 2, y: 0, z: -flat.x * m * 2 }, true);
      }
      for (const s of this.shields) { const d = Math.hypot(s.pos.x - a.pos.x, s.pos.z - a.pos.z); if (d < range) s.hp -= 200; }
      this.noises.push({ pos: { ...a.pos }, r: 40, t: this.time, by: a.id });
    } else if (ab.id === 'shadow') {
      a.shadowT = 4 * mult;
      // dash along movement (or facing)
      const mv = Math.hypot(a.cmd.mx, a.cmd.mz) > 0.2 ? { x: a.cmd.mx, z: a.cmd.mz } : { x: flat.x, z: flat.z };
      const l = Math.hypot(mv.x, mv.z);
      const dashDist = 6.5 * mult;
      for (let k = 0; k < 8; k++) {
        this.ctrl.computeColliderMovement(a.collider, { x: (mv.x / l) * dashDist / 8, y: 0, z: (mv.z / l) * dashDist / 8 }, undefined, MOVE_FILTER);
        const m = this.ctrl.computedMovement(); a.pos.x += m.x; a.pos.y += m.y; a.pos.z += m.z;
      }
      a.body.setNextKinematicTranslation({ x: a.pos.x, y: a.pos.y + CAP_HALF + CAP_R, z: a.pos.z });
    } else if (ab.id === 'metal') {
      const p = { x: a.pos.x + flat.x * 2.4, y: a.pos.y, z: a.pos.z + flat.z * 2.4 };
      const g = this.groundAt(p.x, p.z, a.pos.y + 1.5);
      const hw = 1.6 * mult, hh = 1.15;
      const c = this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(hw, hh, 0.18).setTranslation(g.x, g.y + hh, g.z).setRotation(quatYX(a.yaw)).setCollisionGroups(groups(G.SHIELD, 0xffff)));
      const s: Shield = { id: this.nextId++, pos: { x: g.x, y: g.y, z: g.z }, yaw: a.yaw, hp: 320 * mult, t: 16, collider: c, owner: a.id };
      (s as any).w = hw;
      this.shields.push(s);
      this.colliderOwner.set(c.handle, { kind: 'shield', id: s.id });
    }
  }

  private awaken(a: Actor) {
    a.inv.take('artifact', 1);
    a.awakenT = AWAKENING.duration;
    a.maxHp = PLAYER.hp + AWAKENING.hpBonus + (a.heart ? HEART.hpBonus : 0);
    a.hp = Math.min(a.maxHp, a.hp + AWAKENING.hpBonus);
    a.usedAwakening = true; a.lastPing = this.time - AWAKENING.pingEvery + 0.5;
    a.reloadT = 0; a.healT = 0;
    this.events.push({ t: 'awaken', actor: a.id });
    this.announce(ANNOUNCER.awakened, ANNOUNCER.awakenedSub, 'awaken');
  }

  private throwFrag(a: Actor) {
    const d = this.aimDir(a);
    const e = this.eye(a);
    this.grenades.push({ id: this.nextId++, pos: { x: e.x + d.x * 0.6, y: e.y, z: e.z + d.z * 0.6 }, vel: { x: d.x * 17, y: d.y * 17 + 4.5, z: d.z * 17 }, t: 2.4, owner: a.id });
  }
  private updateGrenades(dt: number) {
    for (const g of this.grenades) {
      g.t -= dt;
      g.vel.y -= 18 * dt;
      const step = { x: g.vel.x * dt, y: g.vel.y * dt, z: g.vel.z * dt };
      const len = Math.hypot(step.x, step.y, step.z);
      if (len > 0) {
        const hit = this.phys.ray(g.pos, { x: step.x / len, y: step.y / len, z: step.z / len }, len + 0.1, groups(0xffff, G.WORLD | G.VEHICLE | G.SHIELD));
        if (hit && hit.normal) {
          const n = hit.normal, dot = g.vel.x * n.x + g.vel.y * n.y + g.vel.z * n.z;
          g.vel = { x: (g.vel.x - 2 * dot * n.x) * 0.45, y: (g.vel.y - 2 * dot * n.y) * 0.45, z: (g.vel.z - 2 * dot * n.z) * 0.45 };
          g.pos = { x: hit.point.x + n.x * 0.05, y: hit.point.y + n.y * 0.05, z: hit.point.z + n.z * 0.05 };
        } else { g.pos.x += step.x; g.pos.y += step.y; g.pos.z += step.z; }
      }
      if (g.t <= 0) this.explode(g.pos, 7.5, 115, this.actors[g.owner]);
    }
    this.grenades = this.grenades.filter((g) => g.t > 0);
  }
  explode(at: Vec3, r: number, dmg: number, by: Actor | null) {
    this.events.push({ t: 'explosion', at: { ...at }, radius: r });
    this.noises.push({ pos: { ...at }, r: 140, t: this.time, by: by?.id ?? -1 });
    const o = { x: at.x, y: at.y + 0.4, z: at.z };
    for (const a of this.actors) {
      if (!a.alive) continue;
      const d = dist3(a.pos, at);
      if (d > r) continue;
      if (a.vehicle === null && !this.phys.lineOfSight(o, this.eye(a))) continue;
      this.damageActor(a, dmg * (1 - d / r), by, false, by ? 'Frag' : 'Explosion');
      const dir = sub(a.pos, at); const l = Math.hypot(dir.x, dir.z) || 1;
      a.ext.x += (dir.x / l) * 14 * (1 - d / r); a.ext.z += (dir.z / l) * 14 * (1 - d / r); a.vy = 5;
    }
    for (const c of this.creatures) { if (!c.alive) continue; const d = dist3(c.pos, at); if (d < r) this.damageCreature(c, dmg * 1.6 * (1 - d / r), by, false, c.pos); }
    for (const v of this.vehicles) {
      if (v.destroyed) continue;
      const p = v.body.translation(); const d = dist3(p, at);
      if (d > r) continue;
      v.bodyHp -= dmg * 2 * (1 - d / r); v.engine -= dmg * (1 - d / r);
      const m = VEHICLES[v.kind].mass, dir = sub(p, at), l = Math.hypot(dir.x, dir.y, dir.z) || 1;
      v.body.applyImpulse({ x: (dir.x / l) * m * 6, y: m * 5, z: (dir.z / l) * m * 6 }, true);
    }
    for (const s of this.shields) if (dist3(s.pos, at) < r) s.hp -= dmg * 2;
  }
  private updateShields(dt: number) {
    for (const s of this.shields) {
      s.t -= dt;
      if (s.t <= 0 || s.hp <= 0) { this.phys.world.removeCollider(s.collider, false); this.colliderOwner.delete(s.collider.handle); }
    }
    this.shields = this.shields.filter((s) => s.t > 0 && s.hp > 0);
  }

  // ---------------------------------------------------------------- vehicles
  private enterVehicle(a: Actor, v: Vehicle) {
    let seat = v.seats.indexOf(null);
    if (seat < 0) {
      // hijack: a slow vehicle's driver gets dragged out
      const sp = v.ctrl.currentVehicleSpeed();
      if (Math.abs(sp) < 3 && v.seats[0] !== null) { const d = this.actors[v.seats[0]]; this.exitVehicle(d); d.ext.x += 4; seat = 0; this.announce('HIJACKED', `${a.name} pulled ${d.name} off the ${VEHICLES[v.kind].name}.`, 'danger'); }
      else return;
    }
    v.seats[seat] = a.id;
    a.vehicle = v.id; a.seat = seat; a.healT = 0; a.reloadT = 0; a.crouch = false;
    a.collider.setEnabled(false);
    if (seat === 0) v.lastDriver = a.id;
    this.events.push({ t: 'enterVehicle', actor: a.id, vehicle: v.id });
  }
  exitVehicle(a: Actor) {
    if (a.vehicle === null) return;
    const v = this.vehicles[a.vehicle];
    v.seats[a.seat] = null;
    const p = v.body.translation(), r = v.body.rotation();
    const side = a.seat % 2 === 0 ? -1 : 1;
    // exit to the side of the vehicle in its local frame
    const right = rotate({ x: side * (VEHICLES[v.kind].size[0] / 2 + 0.8), y: 0, z: 0 }, r);
    const g = this.groundAt(p.x + right.x, p.z + right.z, p.y + 2);
    a.pos = { x: g.x, y: Math.max(g.y, p.y - 0.6), z: g.z };
    a.vehicle = null; a.seat = -1; a.vy = 0;
    a.collider.setEnabled(a.alive);
    a.body.setTranslation({ x: a.pos.x, y: a.pos.y + CAP_HALF + CAP_R, z: a.pos.z }, true);
  }
  private vehicleSeatActions(a: Actor, dt: number) {
    const v = this.vehicles[a.vehicle!];
    a.anim = 'drive'; a.speed = 0;
    if (a.seat > 0 || v.kind === 'okada') {
      // passengers (and okada riders with a sidearm) can shoot
      if (a.seat > 0) { if (a.slot === 2) a.slot = a.inv.secondary ? 1 : 0; this.combat(a, dt, !!a.cmd.reload && !a.prevCmd.reload, !!a.cmd.fire && !a.prevCmd.fire); }
    }
    if (a.cmd.slot >= 0 && a.cmd.slot < v.seats.length && a.cmd.slot !== a.seat && v.seats[a.cmd.slot] === null && Math.abs(v.ctrl.currentVehicleSpeed()) < 2) {
      v.seats[a.seat] = null; v.seats[a.cmd.slot] = a.id; a.seat = a.cmd.slot;
    }
  }
  private syncSeats() {
    for (const a of this.actors) {
      if (a.vehicle === null) continue;
      const v = this.vehicles[a.vehicle];
      const p = v.body.translation(), r = v.body.rotation();
      const off = seatOffset(v.kind, a.seat);
      const w = rotate(off, r);
      a.pos = { x: p.x + w.x, y: p.y + w.y - 0.9, z: p.z + w.z };
      a.body.setTranslation({ x: a.pos.x, y: a.pos.y + 1, z: a.pos.z }, true);
    }
  }
  private updateVehicle(v: Vehicle, dt: number) {
    const def = VEHICLES[v.kind];
    if (v.destroyed) { v.ctrl.updateVehicle(dt); return; }
    const driverId = v.seats[0];
    const driver = driverId !== null ? this.actors[driverId] : null;
    let throttle = 0, steer = 0, brake = 0;
    if (driver && driver.alive) {
      throttle = driver.cmd.mz; steer = -driver.cmd.mx;
      if (driver.cmd.jump) brake = def.brake;
      v.horn = driver.cmd.sprint && v.kind === 'danfo' ? 1 : 0;
    } else brake = def.brake * 0.3;
    const speed = v.ctrl.currentVehicleSpeed();
    if (throttle !== 0 && Math.sign(throttle) !== Math.sign(speed) && Math.abs(speed) > 1.5) { brake = def.brake; throttle = 0; }
    const engineK = Math.max(0.15, v.engine / def.engine);
    const flat = v.tires.filter((t) => t <= 0).length;
    const top = def.topSpeed * (1 - flat * 0.18) * (v.engine <= 0 ? 0 : 1);
    if (v.fuel <= 0 || v.engine <= 0) throttle = 0;
    let force = throttle * def.engineForce * engineK;
    if (Math.abs(speed) > top) force = 0;
    if (throttle < 0) force *= 0.55;
    v.fuel = Math.max(0, v.fuel - Math.abs(throttle) * def.fuelBurn * dt);
    // steering softens with speed so highways stay drivable
    const steerAmt = steer * def.maxSteer * (1 - Math.min(0.6, Math.abs(speed) / (def.topSpeed * 1.3)));
    v.steer += (steerAmt - v.steer) * Math.min(1, dt * 8);
    v.throttle = throttle;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      v.ctrl.setWheelSteering(i, front ? v.steer : 0);
      v.ctrl.setWheelEngineForce(i, front && v.kind !== 'suv' ? 0 : force);
      v.ctrl.setWheelBrake(i, brake);
      v.ctrl.setWheelFrictionSlip(i, (v.kind === 'okada' ? 3.2 : 2.2) * (v.tires[i] <= 0 ? 0.35 : 1));
    }
    v.ctrl.updateVehicle(dt, undefined, groups(G.VEHICLE, G.WORLD | G.SHIELD));
    v.wheelSteer = v.steer;
    for (let i = 0; i < 4; i++) v.wheelSpin[i] = v.ctrl.wheelRotation(i) ?? 0;

    // keep it upright: a self-righting torque, much stronger on the okada
    const r = v.body.rotation();
    const up = rotate({ x: 0, y: 1, z: 0 }, r);
    const k = (v.kind === 'okada' ? 9 : 1.6) * def.mass;
    const av = v.body.angvel();
    const lean = v.kind === 'okada' ? v.steer * Math.min(1, Math.abs(speed) / 10) * 0.45 : 0;
    const fwd = rotate({ x: 0, y: 0, z: 1 }, r);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const right = { x: fwd.z / fl, z: -fwd.x / fl };
    const target = { x: right.x * Math.sin(lean), y: Math.cos(lean), z: right.z * Math.sin(lean) };
    const cross = { x: up.y * target.z - up.z * target.y, y: up.z * target.x - up.x * target.z, z: up.x * target.y - up.y * target.x };
    v.body.applyTorqueImpulse({ x: (cross.x * k - av.x * def.mass * 0.4) * dt, y: 0, z: (cross.z * k - av.z * def.mass * 0.4) * dt }, true);

    // run people over
    const sp = Math.abs(speed);
    if (sp > 5) {
      const p = v.body.translation();
      const reach = Math.max(def.size[0], def.size[2]) / 2 + 0.4;
      for (const a of this.actors) {
        if (!a.alive || a.vehicle !== null) continue;
        const local = rotate(sub(a.pos, p), { x: -r.x, y: -r.y, z: -r.z, w: r.w });
        if (Math.abs(local.x) < def.size[0] / 2 + 0.4 && Math.abs(local.z) < def.size[2] / 2 + 0.4 && Math.abs(local.y + 0.5) < 1.6 && dist3(a.pos, p) < reach + 1) {
          const by = driver ?? (v.lastDriver !== null ? this.actors[v.lastDriver] : null);
          this.damageActor(a, sp * 3.2, by && by !== a ? by : null, false, VEHICLES[v.kind].name);
          const fw = rotate({ x: 0, y: 0, z: Math.sign(speed) }, r);
          a.ext.x += fw.x * sp * 0.9; a.ext.z += fw.z * sp * 0.9; a.vy = 4;
        }
      }
      for (const c of this.creatures) {
        if (!c.alive) continue;
        const local = rotate(sub(c.pos, p), { x: -r.x, y: -r.y, z: -r.z, w: r.w });
        if (Math.abs(local.x) < def.size[0] / 2 + 0.4 && Math.abs(local.z) < def.size[2] / 2 + 0.5 && Math.abs(local.y + 0.5) < 1.6) {
          this.damageCreature(c, sp * 6, driver, false, c.pos); c.vy = 5; v.bodyHp -= sp * 0.6;
        }
      }
    }
    // engine smoke and fire
    if (v.engine <= 0 || v.bodyHp <= 0) {
      v.fireT += dt;
      if (v.fireT > 5) this.destroyVehicle(v);
    }
  }
  damageVehicle(v: Vehicle, dmg: number, at: Vec3, by: number) {
    if (v.destroyed) return;
    const def = VEHICLES[v.kind];
    const p = v.body.translation(), r = v.body.rotation();
    const local = rotate(sub(at, p), { x: -r.x, y: -r.y, z: -r.z, w: r.w });
    let part: 'tire' | 'engine' | 'fuel' | 'body' = 'body';
    const hz = def.size[2] / 2;
    const wheelIdx = [[-1, 1], [1, 1], [-1, -1], [1, -1]].findIndex(([sx, sz]) => Math.abs(local.x - (sx * def.track) / 2) < def.wheelRadius + 0.25 && Math.abs(local.z - (sz * def.wheelBase) / 2) < def.wheelRadius + 0.25 && local.y < -def.size[1] / 2 + def.wheelRadius * 2.4);
    if (wheelIdx >= 0) { part = 'tire'; v.tires[wheelIdx] = Math.max(0, v.tires[wheelIdx] - dmg); }
    else if (local.z > hz * 0.45) { part = 'engine'; v.engine = Math.max(0, v.engine - dmg); v.bodyHp -= dmg * 0.3; }
    else if (local.z < -hz * 0.55 && local.y < 0) { part = 'fuel'; v.fuel = Math.max(0, v.fuel - dmg * 0.15); v.bodyHp -= dmg * 0.5; if (this.rng.chance(0.04)) v.engine = 0; }
    else v.bodyHp -= dmg;
    this.events.push({ t: 'vehicleHit', vehicle: v.id, part, at: { ...at } });
    for (const id of v.seats) if (id !== null && this.rng.chance(0.18)) this.damageActor(this.actors[id], dmg * 0.5, this.actors[by], false, WEAPONS.ar.name);
  }
  private destroyVehicle(v: Vehicle) {
    v.destroyed = true; v.engine = 0; v.bodyHp = 0;
    const p = v.body.translation();
    for (const id of [...v.seats]) if (id !== null) this.exitVehicle(this.actors[id]);
    const by = v.lastDriver !== null ? this.actors[v.lastDriver] : null;
    this.explode({ x: p.x, y: p.y, z: p.z }, 8, 130, by);
  }

  // ---------------------------------------------------------------- creatures
  private updateCreatures(dt: number) {
    // population follows the phase; stalkers only once the night is deep
    const target = { drop: 14, survival: 22, corruption: 32, heart: 38, extraction: 40, collapse: 30, ended: 0 }[this.phase];
    const alive = this.creatures.filter((c) => c.alive);
    const players = this.actors.filter((a) => a.alive);
    if (alive.length < target && players.length && this.rng.chance(dt * 4)) {
      const anchor = this.rng.pick(players);
      const kind: CreatureKind = this.night > 0.8 && alive.filter((c) => c.kind === 'stalker').length < 3 && this.rng.chance(0.18) ? 'stalker' : this.rng.chance(0.55) ? 'hollow' : 'crawler';
      const ang = this.rng.next() * Math.PI * 2, d = this.rng.range(45, 85);
      const n = this.nav.nearest({ x: anchor.pos.x + Math.cos(ang) * d, y: 0, z: anchor.pos.z + Math.sin(ang) * d }, 60);
      if (n >= 0) {
        const p = this.nav.pos(n);
        if (players.every((a) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) > 35)) this.spawnCreature(kind, p, kind === 'hollow' && this.rng.chance(0.6) ? 'idle' : 'wander');
      }
    }
    // extra spawns pour out of corruption zones
    for (const cz of this.corruption) if (this.rng.chance(dt * 0.25) && alive.length < target + 10) {
      const n = this.nav.nearest({ x: cz.x + this.rng.range(-cz.r, cz.r) * 0.6, y: 0, z: cz.z + this.rng.range(-cz.r, cz.r) * 0.6 }, 40);
      if (n >= 0) this.spawnCreature(this.rng.chance(0.6) ? 'crawler' : 'hollow', this.nav.pos(n), 'wander');
    }
    for (const c of this.creatures) {
      if (!c.alive) { c.deadT += dt; continue; }
      const far = players.every((a) => Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z) > 170);
      if (far && players.length) { c.alive = false; c.deadT = 99; c.collider.setEnabled(false); continue; }
      this.cbrains.get(c.id)!.update(dt);
    }
    // forget long-dead bodies
    const gone = this.creatures.filter((c) => !c.alive && c.deadT > 25);
    for (const c of gone) { this.phys.world.removeRigidBody(c.body); this.colliderOwner.delete(c.collider.handle); this.cbrains.delete(c.id); }
    if (gone.length) this.creatures = this.creatures.filter((c) => c.alive || c.deadT <= 25);
  }

  moveCreature(c: Creature, dir: { x: number; z: number }, speed: number, dt: number) {
    const push = (c as any)._push as { x: number; z: number } | undefined;
    c.vy -= PLAYER.gravity * dt;
    const desired = { x: dir.x * speed * dt + (push?.x ?? 0) * dt, y: c.vy * dt, z: dir.z * speed * dt + (push?.z ?? 0) * dt };
    if (push) { push.x *= Math.exp(-5 * dt); push.z *= Math.exp(-5 * dt); if (Math.hypot(push.x, push.z) < 0.3) (c as any)._push = undefined; }
    this.ctrl.computeColliderMovement(c.collider, desired, undefined, groups(G.CREATURE, G.WORLD | G.VEHICLE | G.SHIELD));
    const m = this.ctrl.computedMovement();
    c.pos.x += m.x; c.pos.y += m.y; c.pos.z += m.z;
    if (this.ctrl.computedGrounded() && c.vy < 0) c.vy = 0;
    if (c.pos.y < -30) { c.alive = false; c.collider.setEnabled(false); }
    c.body.setNextKinematicTranslation({ x: c.pos.x, y: c.pos.y + CAP_HALF + CAP_R, z: c.pos.z });
    c.speed = Math.hypot(m.x, m.z) / dt;
    if (Math.hypot(dir.x, dir.z) > 0.1) c.yaw = Math.atan2(dir.x, dir.z);
  }
}

// ---------------------------------------------------------------- math helpers
export function dist3(a: Vec3, b: Vec3) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
export function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function rotate(v: Vec3, q: { x: number; y: number; z: number; w: number }): Vec3 {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y, iy = q.w * v.y + q.z * v.x - q.x * v.z, iz = q.w * v.z + q.x * v.y - q.y * v.x, iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return { x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x };
}
export function seatOffset(kind: VehicleKind, seat: number): Vec3 {
  if (kind === 'okada') return seat === 0 ? { x: 0, y: 0.55, z: 0.05 } : { x: 0, y: 0.62, z: -0.45 };
  if (kind === 'danfo') { const rows = [[-0.45, 1.25], [0.45, 1.25], [-0.5, 0.1], [0.5, 0.1], [-0.5, -1.1], [0.5, -1.1]]; const [x, z] = rows[seat]; return { x, y: 0.35, z }; }
  const rows = [[-0.42, 0.35], [0.42, 0.35], [-0.42, -0.75], [0.42, -0.75]]; const [x, z] = rows[seat]; return { x, y: 0.3, z };
}
