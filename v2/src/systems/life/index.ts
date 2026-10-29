// The life sim: needs that run on game time, smart objects with actions, the interaction pie, your first room
// (a Sims-style lot with a cutaway camera), people you can gist with, and the consequences of neglect.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import type { Command, Actor } from '../../sim/types';
import { RAPIER, G, groups } from '../../sim/physics';
import { freshNeeds, decay, moodOf, addMoodlet, NEEDS, type NeedsState, type Need } from './needs';
import { DEFS, propMesh, type LifeAction } from './objects';
import { buildHome, HOME_ORIGIN, type Lot, type Placed } from './home';
import type { Venue, Door } from './venue';
import { Pie, type PieItem } from './pie';
import { LifeUi } from './ui';
import { RT } from '../societyRuntime';
import { fullStory } from '../societyModel';
import type { HumanView } from '../../render/humans';

export interface Thing { id: string; name: string; x: number; z: number; yaw: number; y?: number; actions: LifeAction[]; kind: 'object' | 'door' | 'npc' | 'self'; actor?: Actor; placed?: Placed; open?: () => void; reach?: number; verb?: string }
interface Running { a: LifeAction; thing: Thing; phase: 'walk' | 'do'; t: number; walkT: number; path: { x: number; z: number }[]; best: number; bestT: number; spot: { x: number; z: number; y: number; yaw: number }; prop?: THREE.Object3D }
interface Save { needs: NeedsState; food: number; fan: boolean; door: { x: number; z: number; yaw: number } | null; inside: boolean; tips: string[]; pantry: number; at?: string | null; vdoors?: Record<string, Door> }

const CAP = 0.9; // capsule centre above the feet
const wrapA = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

class Life {
  S!: Save; lot!: Lot; pie = new Pie(); ui = new LifeUi();
  run: Running | null = null; lastHour = -1; started = false; doorObj: THREE.Group | null = null; fanBlades: THREE.Object3D | null = null;
  near: Thing | null = null; private saveT = 0; private warnT: Record<string, number> = {}; private bodies: any[] = [];
  private talkWith: Actor | null = null;
  /** Sims-style clock speed chosen by the player (1, 3, 8); actions like sleep multiply on top */
  speed = 1;
  venues = new Map<string, Venue>(); private vdoorT = 3; private vdoorObj = new Map<string, THREE.Group>();
  /** other systems add interactables in the street (vendors, pay toilets, clubs) */
  providers: (() => Thing[])[] = [];
  constructor(public ctx: GameCtx) {}

  init() {
    const c = this.ctx;
    const s = c.save.life as Save | undefined;
    this.S = s && s.needs ? Object.assign({ food: 0, fan: false, door: null, inside: false, tips: [], pantry: 0 }, s) as Save : { needs: freshNeeds(), food: 1, fan: false, door: null, inside: false, tips: [], pantry: 0 };
    this.lot = buildHome(); c.view.scene.add(this.lot.group);
    this.fanBlades = this.lot.placed.find((p) => p.def === 'fan')?.obj.getObjectByName('blades') ?? null;
    // the room is solid: walls and big furniture become static colliders
    const W = c.sim.phys.world; const body = W.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(HOME_ORIGIN.x, 0, HOME_ORIGIN.z));
    for (const b of this.lot.boxes) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b.yaw);
      W.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(groups(G.WORLD, 0xffff)), body);
    }
    this.bodies.push(body);
    this.ui.onCancel = () => this.stop(true);
    this.ui.onSpeed = (v) => { this.speed = v; this.ui.setSpeed(v); };
    addEventListener('keydown', (e) => this.key(e));
    (window as any).__life = this;
  }

  start() {
    this.started = true; this.ui.show(true);
    if (!this.S.door) this.placeDoor(); else this.buildDoor();
    this.lastHour = -1;
    if (this.S.inside) this.enter(false);
    if (this.S.at) { const v = this.venues.get(this.S.at); this.S.at = null; const d = v?.door; if (d) this.teleport(d.x + Math.sin(d.yaw) * 1.4, 0.05, d.z + Math.cos(d.yaw) * 1.4, d.yaw); }
    for (const v of this.venues.values()) this.placeVenueDoor(v);
    const tip = (id: string, title: string, body: string, ms: number) => { if (this.S.tips.includes(id)) return; setTimeout(() => { this.ctx.hud.toast(title, body, 'linear-gradient(160deg,#2de0c8,#139a8a)', 'pin', 7); this.S.tips.push(id); }, ms); };
    tip('home', 'Your room is ready', 'Landlord don give you key. Follow the house pin on the map. Press E near anything to see what you can do with it.', 24000);
    tip('needs', 'Mind yourself', 'The rings at the bottom are your needs. Eat, sleep, bath, gist with people, have fun. Tap them for details.', 52000);
  }

  // ---------------------------------------------------------------- the front door on the street
  private placeDoor() {
    const c = this.ctx; const me = c.sim.local; let best: { x: number; z: number; yaw: number } | null = null, bd = 1e9;
    for (const list of c.view.world.plots.values()) for (const p of list) {
      if (p.zone !== 'residential' || !p.buildings.length) continue;
      const d0 = Math.hypot(p.cx - me.pos.x, p.cz - me.pos.z); if (d0 > 160 || d0 < 25) continue;
      const b = p.buildings[0]; const pts = b.pts; const n = pts.length / 2;
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az); if (L < 3) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2; let nx = -(bz - az) / L, nz = (bx - ax) / L;
        if ((mx - b.cx) * nx + (mz - b.cz) * nz < 0) { nx = -nx; nz = -nz; }
        const d = Math.hypot(mx - me.pos.x, mz - me.pos.z) + (((me.pos.x - mx) * nx + (me.pos.z - mz) * nz) < 0 ? 60 : 0);
        if (d < bd) { bd = d; best = { x: mx + nx * 0.25, z: mz + nz * 0.25, yaw: Math.atan2(nx, nz) }; }
      }
    }
    this.S.door = best ?? { x: me.pos.x + 6, z: me.pos.z, yaw: 0 }; this.buildDoor(); this.persist();
  }
  private buildDoor() {
    const d = this.S.door!; this.doorObj?.removeFromParent();
    const g = new THREE.Group(); const door = DEFS.door.build(); g.add(door);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.3, 0.12), new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.7 })); frame.position.set(0, 1.12, -0.04); g.add(frame);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 40), new THREE.MeshBasicMaterial({ color: 0x2de0c8, transparent: true, opacity: 0.7, side: THREE.DoubleSide, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.05, 0.9); ring.name = 'ring'; g.add(ring);
    g.position.set(d.x, 0, d.z); g.rotation.y = d.yaw; this.ctx.view.scene.add(g); this.doorObj = g;
  }

  // ---------------------------------------------------------------- inside / outside
  get inside() { return this.S.inside || !!this.S.at; }
  get venue() { return this.S.at ? this.venues.get(this.S.at) ?? null : null; }
  /** register an interior entered from a door on the street */
  addVenue(v: Venue) {
    this.venues.set(v.id, v); const c = this.ctx; c.view.scene.add(v.lot.group);
    const O = v.lot.group.position; const W = c.sim.phys.world; const body = W.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(O.x, 0, O.z));
    for (const b of v.lot.boxes) { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b.yaw); W.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(groups(G.WORLD, 0xffff)), body); }
    if (this.started) this.placeVenueDoor(v);
  }
  /** each venue gets a front door on a commercial building a little way from home, saved so it stays put */
  private placeVenueDoor(v: Venue) {
    const c = this.ctx; const saved = (this.S.vdoors ??= {})[v.id]; if (saved) { v.door = saved; this.buildVenueDoor(v); return; }
    const home = this.S.door ?? { x: c.sim.local.pos.x, z: c.sim.local.pos.z }; const taken = Object.values(this.S.vdoors);
    let best: Door | null = null, bs = -1e9; const want = v.id === 'casino' ? 520 : v.id === 'club' ? 420 : 300;
    for (const list of c.view.world.plots.values()) for (const p of list) {
      if (p.zone !== 'commercial' || !p.buildings.length) continue; const d0 = Math.hypot(p.cx - home.x, p.cz - home.z); if (d0 < 120 || d0 > 1400) continue;
      if (taken.some((t) => Math.hypot(t.x - p.cx, t.z - p.cz) < 120)) continue;
      const b = p.buildings[0]; const pts = b.pts; const n = pts.length / 2; let edge: Door | null = null, el = 0;
      for (let i = 0; i < n; i++) { const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1]; const L = Math.hypot(bx - ax, bz - az); if (L < 6 || L < el) continue; let nx = -(bz - az) / L, nz = (bx - ax) / L; const mx = (ax + bx) / 2, mz = (az + bz) / 2; if ((mx - b.cx) * nx + (mz - b.cz) * nz < 0) { nx = -nx; nz = -nz; } el = L; edge = { x: mx + nx * 0.25, z: mz + nz * 0.25, yaw: Math.atan2(nx, nz) }; }
      if (!edge) continue; const score = -Math.abs(d0 - want) + el * 3 + (p.rich ?? 0) * 200; if (score > bs) { bs = score; best = edge; }
    }
    if (!best) return; this.S.vdoors[v.id] = best; v.door = best; this.buildVenueDoor(v); this.persist();
  }
  private buildVenueDoor(v: Venue) {
    const d = v.door!; this.vdoorObj.get(v.id)?.removeFromParent(); const g = new THREE.Group();
    const col = new THREE.Color(v.blip);
    { const dm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 0.1), new THREE.MeshStandardMaterial({ color: 0x0d0d12, roughness: 0.3, metalness: 0.6 })); dm.position.set(0, 1.3, 0.02); g.add(dm); }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 0.14), new THREE.MeshBasicMaterial({ color: col, toneMapped: false })); frame.position.set(0, 2.68, 0.06); g.add(frame);
    for (const x of [-1.25, 1.25]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.7, 0.14), new THREE.MeshBasicMaterial({ color: col, toneMapped: false })); s.position.set(x, 1.33, 0.06); g.add(s); }
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const k = cv.getContext('2d')!; k.font = '900 64px Rajdhani, Inter, sans-serif'; k.textAlign = 'center'; k.textBaseline = 'middle'; k.shadowColor = v.blip; k.shadowBlur = 24; k.fillStyle = v.blip; k.fillText(v.title, 256, 66);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })); sign.position.set(0, 3.5, 0.12); g.add(sign);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.75, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide, toneMapped: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.05, 1.0); ring.name = 'ring'; g.add(ring);
    const l = new THREE.PointLight(col, 6, 9, 1.8); l.position.set(0, 3, 1.2); g.add(l);
    g.position.set(d.x, 0, d.z); g.rotation.y = d.yaw; this.ctx.view.scene.add(g); this.vdoorObj.set(v.id, g); v.doorMesh = g;
  }
  enterVenue(v: Venue) {
    const c = this.ctx; const why = v.refuse?.(); if (why) { c.hud.toast(v.title, why, 'var(--red)', 'msg', 3.5); return; }
    if (v.fee) { if (c.sim.cash < v.fee) { c.hud.toast(v.title, `Gate fee na ₦${v.fee.toLocaleString()}. Your pocket no reach.`, 'var(--red)', 'cash', 3.5); return; } c.sim.cash -= v.fee; c.sim.events.push({ t: 'cash', actor: c.sim.local.id, amount: -v.fee }); }
    this.ui.black(() => { const O = v.lot.group.position, s = v.lot.spawn; this.S.at = v.id; const rm = v.lot.rooms[0]; const fy = rm ? Math.atan2((rm.x0 + rm.x1) / 2 - s.x, (rm.z0 + rm.z1) / 2 - s.z) : s.yaw; this.teleport(O.x + s.x, 0.02, O.z + s.z, fy); c.view.cam.yaw = fy; v.enter?.(); c.hud.title(v.title, v.sub, 2.5); });
  }
  exitVenue() {
    const v = this.venue; if (!v) return; this.stop(true);
    this.ui.black(async () => { v.exit?.(); this.S.at = null; const d = v.door!; this.teleport(d.x + Math.sin(d.yaw) * 1.4, 0.05, d.z + Math.cos(d.yaw) * 1.4, d.yaw); for (let i = 0; i < 12; i++) { this.ctx.view.world.update(d.x, d.z, true); await new Promise((r) => setTimeout(r, 0)); } this.ctx.view.cam.yaw = d.yaw; });
  }
  enter(fade = true) {
    const go = () => {
      const s = this.lot.spawn; this.S.inside = true;
      this.teleport(HOME_ORIGIN.x + s.x, 0.02, HOME_ORIGIN.z + s.z, s.yaw);
      this.ctx.hud.title('HOME', 'Room 4, Bello Compound', 2.5); this.persist();
    };
    if (fade) this.ui.black(go); else go();
  }
  exit() {
    this.ui.black(async () => {
      const d = this.S.door!; this.S.inside = false;
      this.teleport(d.x + Math.sin(d.yaw) * 1.3, 0.05, d.z + Math.cos(d.yaw) * 1.3, d.yaw);
      for (let i = 0; i < 12; i++) { this.ctx.view.world.update(d.x, d.z, true); await new Promise((r) => setTimeout(r, 0)); }
      this.ctx.view.cam.yaw = d.yaw; this.persist();
    });
  }
  private teleport(x: number, y: number, z: number, yaw: number) {
    const me = this.ctx.sim.local; me.pos = { x, y, z }; me.vy = 0; me.yaw = yaw; me.body.setTranslation({ x, y: y + CAP, z }, true);
  }

  // ---------------------------------------------------------------- what is around me
  private things(): Thing[] {
    const out: Thing[] = []; const me = this.ctx.sim.local;
    const V = this.venue;
    if (V) {
      const O = V.lot.group.position, e = V.lot.spawn; out.push({ id: 'exit', name: 'Exit', x: O.x + e.x, z: O.z + e.z - 0.9, yaw: Math.PI, actions: [{ id: 'vout', label: 'Go outside', gain: {}, minutes: 0, clip: 'Idle_Loop', spot: [0, 0, 0] }], kind: 'door', reach: 1.8 });
      for (const t of V.things?.() ?? []) out.push(t);
    } else if (this.S.inside) {
      for (const p of this.lot.placed) { const d = DEFS[p.def]; if (!d.actions.length) continue; out.push({ id: p.def, name: d.name, x: HOME_ORIGIN.x + p.x, z: HOME_ORIGIN.z + p.z, yaw: p.yaw, actions: d.actions, kind: 'object', placed: p }); }
      const e = this.lot.exit; out.push({ id: 'exit', name: 'Front door', x: HOME_ORIGIN.x + 0, z: HOME_ORIGIN.z + 0.1, yaw: Math.PI, actions: [{ id: 'out', label: 'Go outside', gain: {}, minutes: 0, clip: 'Idle_Loop', spot: [0, 0, 0] }], kind: 'door' }); void e;
    } else if (this.S.door) {
      const d = this.S.door; out.push({ id: 'home', name: 'Your house', x: d.x, z: d.z, yaw: d.yaw, actions: [{ id: 'in', label: 'Go inside', gain: {}, minutes: 0, clip: 'Idle_Loop', spot: [0, 0, 0] }], kind: 'door' });
    }
    if (!this.inside) for (const v of this.venues.values()) if (v.door && Math.abs(v.door.x - me.pos.x) < 5 && Math.abs(v.door.z - me.pos.z) < 5) out.push({ id: 'venue', name: v.title, x: v.door.x, z: v.door.z, yaw: v.door.yaw, actions: [{ id: 'vin:' + v.id, label: v.label ?? `Enter ${v.title}`, gain: {}, minutes: 0, clip: 'Idle_Loop', spot: [0, 0, 0] }], kind: 'door', reach: 2.6 });
    for (const a of this.ctx.sim.actors) {
      if (a === me || !a.alive || a.vehicle !== null || (a as any)._gone || (a as any)._vendor || a.role === 'police') continue;
      if (Math.abs(a.pos.x - me.pos.x) > 3 || Math.abs(a.pos.z - me.pos.z) > 3) continue;
      out.push({ id: 'npc', name: a.name, x: a.pos.x, z: a.pos.z, yaw: a.yaw, actions: [], kind: 'npc', actor: a });
    }
    if (!this.inside) for (const p of this.providers) for (const t of p()) if (Math.abs(t.x - me.pos.x) < 6 && Math.abs(t.z - me.pos.z) < 6) out.push(t);
    return out;
  }
  private pickNear(): Thing | null {
    const me = this.ctx.sim.local; if (me.vehicle !== null || !me.alive) return null;
    let best: Thing | null = null, bs = 1e9;
    for (const t of this.things()) {
      const dx = t.x - me.pos.x, dz = t.z - me.pos.z, d = Math.hypot(dx, dz);
      const reach = t.reach ? t.reach : t.kind === 'door' ? 2.2 : t.kind === 'npc' ? 2.4 : 1.9 + Math.max(...(DEFS[t.id]?.size ?? [0, 0, 0])) * 0.5;
      if (d > reach) continue;
      const facing = d < 0.6 ? 1 : (dx * Math.sin(me.yaw) + dz * Math.cos(me.yaw)) / d;
      const s = d - facing * 0.8 + (t.kind === 'npc' ? 0.4 : 0);
      if (facing > -0.2 && s < bs) { bs = s; best = t; }
    }
    return best;
  }

  // ---------------------------------------------------------------- the pie
  private openPie(t: Thing | null) {
    const c = this.ctx; const me = c.sim.local; c.input.releasePointer();
    if (!t) { this.pieSelf(); return; }
    if (t.open) { t.open(); return; }
    if (t.kind === 'door') { const a = t.actions[0]; if (a.id.startsWith('vin:')) this.enterVenue(this.venues.get(a.id.slice(4))!); else if (a.id === 'vout') this.exitVenue(); else a.id === 'in' ? this.enter() : this.exit(); return; }
    if (t.kind === 'npc') { this.pieNpc(t); return; }
    const items: PieItem[] = t.actions.filter((a) => this.allowed(a)).map((a) => ({ id: a.id, label: a.label, hint: a.effect === 'cook3' && this.S.pantry > 0 ? `Uses market foodstuff (${this.S.pantry} left)` : a.hint, cost: a.effect === 'cook3' && this.S.pantry > 0 ? undefined : a.cost, disabled: a.cost && c.sim.cash < a.cost && !(a.effect === 'cook3' && this.S.pantry > 0) ? 'No money' : a.when === 'hasFood' && this.S.food <= 0 ? 'Nothing inside' : undefined }));
    if (!items.length) return;
    this.pie.show(t.name, t.id === 'cooler' ? `${this.S.food} plate${this.S.food === 1 ? '' : 's'} of food` : 'What you wan do?', items, this.screenOf(t.x, 1.1, t.z), (id) => { const a = t.actions.find((x) => x.id === id)!; this.begin(a, t); });
    void me;
  }
  private allowed(a: LifeAction) {
    const h = this.ctx.view.atmo.hour;
    if (a.when === 'tired') return this.S.needs.v.energy < 75 || h > 20 || h < 6;
    if (a.when === 'evening') return h > 16 || h < 1;
    return true;
  }
  private pieSelf() {
    const items: PieItem[] = [
      { id: 'call', label: 'Call somebody', hint: '+Social' }, { id: 'scroll', label: 'Scroll social media', hint: '+Fun' },
      { id: 'game', label: 'Play Ludo on phone', hint: '+Fun' }, { id: 'needs', label: 'How I dey?', hint: 'Needs and mood' },
    ];
    if (!this.inside && this.S.door) items.push({ id: 'home', label: 'Go home', hint: 'GPS to your room' });
    const phone = (label: string, gain: Partial<Record<Need, number>>, minutes: number): LifeAction => ({ id: 'phone', label, gain, minutes, clip: 'Idle_TalkingPhone_Loop', spot: [0, 0, 0], prop: 'phone', pose: 'phone' });
    this.pie.show('You', 'Phone in hand', items, { x: innerWidth / 2, y: innerHeight / 2 }, (id) => {
      const me = this.ctx.sim.local; const self: Thing = { id: 'self', name: 'You', x: me.pos.x, z: me.pos.z, yaw: me.yaw, actions: [], kind: 'self' };
      if (id === 'call') this.begin({ ...phone('Calling your people', { social: 22, fun: 4 }, 25), clip: 'Idle_TalkingPhone_Loop', pose: undefined }, self);
      if (id === 'scroll') this.begin({ ...phone('Scrolling', { fun: 16 }, 20), clip: 'Idle_Loop' }, self);
      if (id === 'game') this.begin({ ...phone('Playing Ludo', { fun: 24 }, 25), clip: 'Idle_Loop' }, self);
      if (id === 'needs') this.ui.sheet.classList.add('on');
      if (id === 'home') this.ctx.hud.toast('GPS', 'Follow the house pin on your map.', 'linear-gradient(160deg,#2de0c8,#139a8a)', 'pin', 4);
    });
  }
  private pieNpc(t: Thing) {
    const a = t.actor!; const cit = a.cid !== undefined ? RT.soc?.get(a.cid) : undefined; const name = cit ? `${cit.first} ${cit.last}` : a.name;
    const occ = cit && RT.soc ? RT.soc.C.occ[cit.occ]?.label : undefined;
    const items: PieItem[] = [
      { id: 'chat', label: 'Gist', hint: '+Social' }, { id: 'joke', label: 'Crack a joke', hint: '+Social +Fun' },
      { id: 'compliment', label: 'Hail them', hint: '+Social' }, { id: 'ask', label: 'Ask about their life', hint: 'Learn their story' },
      { id: 'tip', label: 'Dash them ₦500', hint: 'They go remember', cost: 500, disabled: this.ctx.sim.cash < 500 ? 'No money' : undefined },
      { id: 'insult', label: 'Insult them', hint: '+Fun, risky' },
    ];
    this.pie.show(name, occ ?? 'Somebody for street', items, this.screenOf(a.pos.x, 1.7, a.pos.z), (id) => this.social(a, id, name));
  }
  private social(a: Actor, id: string, name: string) {
    const c = this.ctx; const me = c.sim.local; const cit = a.cid !== undefined ? RT.soc?.get(a.cid) : undefined;
    const face = Math.atan2(a.pos.x - me.pos.x, a.pos.z - me.pos.z);
    const lines: Record<string, string[]> = {
      chat: ['How far, how body?', 'This Lagos sun no get mercy o.', 'You hear wetin happen for Oshodi yesterday?', 'Na hustle we dey, God dey.'],
      joke: ['Why danfo no dey stop? Because conductor never finish him sentence!', 'My landlord increase rent because the sun shine for the house.', 'NEPA bring light, the whole street shout like Super Eagles score.'],
      compliment: ['Your shoe clean die!', 'You get better spirit sha.', 'Correct person!'],
      insult: ['See your head like Agege bread.', 'You dey smell like Ojuelegba gutter.', 'Who dress you this morning?'],
    };
    const reply: Record<string, string[]> = {
      chat: ['We dey manage o, how your side?', 'Abeg no remind me, my body dey pepper.', 'Lagos no dey carry last.'], joke: ['Hahaha! You no well!', 'Ehn ehn, you funny sha.', 'Comot for here, I no fit laugh again.'],
      compliment: ['Thank you jare, you too dey shine.', 'Ah, you sabi talk.', 'God bless you.'], insult: ['Your papa!', 'Say that again make I see.', 'Na your mates dey jaye for Lekki.'],
    };
    const pick = (l: string[]) => l[(Math.random() * l.length) | 0];
    const npcName = cit?.nick ? `${cit.first} "${cit.nick}"` : name;
    if (id === 'ask') { const story = cit && RT.soc ? fullStory(RT.soc.C, cit) : 'Na Lagos I born, Lagos I go die. Wetin you wan know?'; c.hud.say(npcName, story.length > 220 ? story.slice(0, 217) + '...' : story, 7); this.S.needs.v.social = Math.min(100, this.S.needs.v.social + 6); return; }
    if (id === 'tip') { c.sim.cash -= 500; c.sim.events.push({ t: 'cash', actor: me.id, amount: -500 }); if (cit && RT.nem) RT.nem.remember(cit, 'tipped', a.pos); c.hud.say(npcName, pick(['God go bless you!', 'Ah, my person!', 'You try well well.']), 3); addMoodlet(this.S.needs, 'generous', 'Felt generous', 5, 3); return; }
    const mins = id === 'chat' ? 10 : id === 'joke' ? 5 : 3;
    const gain: Partial<Record<Need, number>> = id === 'chat' ? { social: 120 } : id === 'joke' ? { social: 150, fun: 120 } : id === 'compliment' ? { social: 160 } : { fun: 150, social: -60 };
    c.hud.say('You', pick(lines[id]), 3); setTimeout(() => c.hud.say(npcName, pick(reply[id]), 3.4), 1600);
    if (id === 'insult') {
      if (cit && RT.nem) RT.nem.remember(cit, 'hurt', a.pos, 'insulted', 0.35);
      if (a.role === 'area' || Math.random() < 0.25) { const b = c.sim.brainOf(a.id); if (b) { b.kind = 'fight'; b.target = me.id; (b as any).t = 20; } a.hostile = 1; return; }
    }
    // both stop and talk
    this.talkWith = a; (a as any)._script = true; a.cmd = { ...a.cmd, mx: 0, mz: 0, sprint: false, fire: false };
    (a as any).act = { clip: id === 'joke' ? 'Idle_Talking_Loop' : 'Idle_Talking_Loop', yaw: wrapA(face + Math.PI) };
    this.begin({ id: 'talk', label: id === 'chat' ? `Gisting with ${npcName.split(' ')[0]}` : id === 'joke' ? 'Cracking jokes' : id === 'insult' ? 'Trading words' : 'Hailing', gain, minutes: mins, clip: 'Idle_Talking_Loop', spot: [0, 0, 0] },
      { id: 'self', name: 'You', x: me.pos.x, z: me.pos.z, yaw: face, actions: [], kind: 'self' });
  }

  // ---------------------------------------------------------------- running an action
  begin(a: LifeAction, t: Thing) {
    this.stop(false);
    const c = this.ctx;
    if (a.effect === 'cook3' && this.S.pantry > 0) { this.S.pantry--; a = { ...a, cost: 0 }; }
    if (a.cost) { if (c.sim.cash < a.cost) { c.hud.toast('No money', `You need ₦${a.cost.toLocaleString()}.`, 'var(--red)', 'cash'); return; } c.sim.cash -= a.cost; c.sim.events.push({ t: 'cash', actor: c.sim.local.id, amount: -a.cost }); }
    if (a.effect === 'eat1') this.S.food = Math.max(0, this.S.food - 1);
    let spot: Running['spot'];
    if (t.kind === 'self') spot = { x: c.sim.local.pos.x, z: c.sim.local.pos.z, y: c.sim.local.pos.y, yaw: t.yaw };
    else { const [lx, lz, ly] = a.spot; const cs = Math.cos(t.yaw), sn = Math.sin(t.yaw); spot = { x: t.x + lx * cs + lz * sn, z: t.z - lx * sn + lz * cs, y: a.y ?? 0.02, yaw: wrapA(t.yaw + ly) }; }
    this.run = { a, thing: t, phase: t.kind === 'self' ? 'do' : 'walk', t: 0, walkT: 0, spot, path: this.route(spot), best: 1e9, bestT: 0 };
    if (this.run.phase === 'do') this.arrive();
  }
  private arrive() {
    const r = this.run!; const me = this.ctx.sim.local; r.phase = 'do';
    this.teleport(r.spot.x, r.spot.y, r.spot.z, r.spot.yaw);
    (me as any).act = { clip: r.a.clip, hold: r.a.hold, speed: r.a.speed, yaw: r.spot.yaw };
    if (r.a.prop || r.a.pose) (me as any).actPose = (v: HumanView, dt: number) => this.pose(v, dt);
    if (r.a.sleeping) this.ui.sleeping(true);
    if (r.a.effect === 'fan') { this.S.fan = !this.S.fan; this.ctx.hud.toast('Fan', this.S.fan ? 'Breeze dey blow now.' : 'Fan off.', 'linear-gradient(160deg,#42a5f5,#1565c0)', 'msg', 2.5); }
  }
  stop(cancelled: boolean) {
    const r = this.run; if (!r) return; const c = this.ctx; const me = c.sim.local;
    this.run = null; (me as any).act = undefined; (me as any).actPose = undefined; this.ui.sleeping(false); this.ui.action(null);
    r.prop?.removeFromParent();
    if (r.phase === 'do' && (r.a.y ?? 0) > 0.2) { const t = r.thing; const back = 1.0; this.teleport(t.x + Math.sin(t.yaw) * back, 0.02, t.z + Math.cos(t.yaw) * back, t.yaw); }
    if (this.talkWith) { (this.talkWith as any)._script = false; (this.talkWith as any).act = undefined; this.talkWith = null; }
    if (!cancelled && r.phase === 'do') {
      if (r.a.moodlet) addMoodlet(this.S.needs, ...r.a.moodlet);
      if (r.a.effect === 'cook3') { this.S.food += 3; c.hud.toast('Food ready', 'Stew and rice for three plates. It dey the cooler.', 'linear-gradient(160deg,#ff8a5c,#d1452c)', 'msg', 4); }
      if (r.a.effect === 'cook1') { this.S.food += 1; c.hud.toast('Noodles ready', 'One plate dey the cooler.', 'linear-gradient(160deg,#ff8a5c,#d1452c)', 'msg', 3); }
      if (r.a.effect === 'study') (c.systems.get('skills') as any)?.addXp?.('charm', 15);
      if (r.a.effect === 'outfit') this.changeOutfit();
      if (r.a.sleeping && r.a.id === 'sleep') c.hud.title('GOOD MORNING', c.view.atmo.timeString(), 2.5);
    }
    this.persist();
  }
  changeOutfit() {
    const c = this.ctx; const me = c.sim.local; const pal = ['#2c3a2a', '#b0332a', '#1e2b3a', '#d9a441', '#e8e0d0', '#355070', '#141414', '#5b1a16'];
    const look: any = me.look; look.topColor = pal[(pal.indexOf(look.topColor) + 1) % pal.length]; look.topPattern = Math.random() < 0.4 ? 'ankara_wave' : 'solid';
    const v = c.view.actors.get(me.id); if (v) { v.view.dispose(); c.view.actors.delete(me.id); }
    addMoodlet(this.S.needs, 'newfit', 'Fresh fit', 6, 4);
  }
  /** brushing, phone, eating: arm and hand poses with a prop in the hand */
  private pose(v: HumanView, _dt: number) {
    const r = this.run; if (!r) return; const hand = v.bones.get('hand_r'); if (!hand) return;
    if (r.a.prop && !r.prop) { r.prop = propMesh(r.a.prop); hand.add(r.prop); r.prop.position.set(-0.05, 0.02, 0.03); r.prop.rotation.set(0, 0, Math.PI / 2); }
    if (r.a.pose === 'brush' || r.a.pose === 'wash' || r.a.pose === 'phone' || r.a.pose === 'read') {
      const q = v.root.getWorldQuaternion(new THREE.Quaternion()); const t = performance.now() / 1000;
      const aim = (name: string, dir: THREE.Vector3, k: number) => {
        const bone = v.bones.get(name); if (!bone) return; bone.updateWorldMatrix(true, false);
        const qw = bone.getWorldQuaternion(new THREE.Quaternion()); const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(qw).normalize();
        const delta = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().applyQuaternion(q).normalize());
        const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert(); bone.quaternion.slerp(pq.multiply(delta.multiply(qw)), k); bone.updateWorldMatrix(false, true);
      };
      if (r.a.pose === 'brush') { aim('upperarm_r', new THREE.Vector3(-0.2, -0.55, 0.6), 1); aim('lowerarm_r', new THREE.Vector3(0.75, 0.95 + Math.sin(t * 18) * 0.12, 0.25), 1); aim('Head', new THREE.Vector3(0, 1, 0.12), 0.6); }
      else if (r.a.pose === 'wash') { aim('upperarm_r', new THREE.Vector3(-0.1, -0.6, 0.7), 1); aim('lowerarm_r', new THREE.Vector3(0.6, 0.9, 0.3 + Math.sin(t * 6) * 0.1), 1); aim('upperarm_l', new THREE.Vector3(0.1, -0.6, 0.7), 1); aim('lowerarm_l', new THREE.Vector3(-0.6, 0.9, 0.3 + Math.cos(t * 6) * 0.1), 1); aim('Head', new THREE.Vector3(0, 0.8, 0.5), 0.7); }
      else { aim('upperarm_r', new THREE.Vector3(-0.15, -1, 0.3), 1); aim('lowerarm_r', new THREE.Vector3(0.45, 0.6, 1), 1); aim('hand_r', new THREE.Vector3(0.3, 0.8, 0.7), 1); aim('Head', new THREE.Vector3(0.05, 1, 0.45), 0.6); }
    }
  }

  /** inside the house: go through doors instead of walls (corridor spine at x=0, doors as waypoints) */
  private route(to: { x: number; z: number }) {
    if (!this.S.inside) return [];
    const me = this.ctx.sim.local; const O = HOME_ORIGIN;
    const roomOf = (x: number, z: number) => { const lx = x - O.x, lz = z - O.z; for (const r of this.lot.rooms) if (lx >= r.x0 - 0.05 && lx <= r.x1 + 0.05 && lz >= r.z0 - 0.05 && lz <= r.z1 + 0.05) return r.name; return 'Corridor'; };
    const doors: Record<string, [number, number][]> = { 'Your room': [[1.6, 5.25], [0.3, 5.25]], Bathroom: [[-0.55, 14.6], [-0.55, 13.4]], Toilet: [[0.55, 14.6], [0.55, 13.4]], Corridor: [] };
    const a = roomOf(me.pos.x, me.pos.z), b = roomOf(to.x, to.z); if (a === b) return [];
    const pts: [number, number][] = [...doors[a]];
    pts.push(...[...doors[b]].reverse());
    return pts.map(([x, z]) => ({ x: O.x + x, z: O.z + z }));
  }
  step() { const r = this.run; if (r && r.phase === 'walk') r.walkT += 1 / 60; }

  // ---------------------------------------------------------------- per tick
  filterCommand(c: Command) {
    const me = this.ctx.sim.local;
    if (this.pie.open) { c.mx = c.mz = 0; c.interact = false; c.fire = false; c.jump = false; return; }
    const r = this.run; const wantMove = Math.hypot(c.mx, c.mz) > 0.35 || c.jump;
    if (r && wantMove && (r.phase === 'do' || r.walkT > 0.4)) { this.stop(true); return; }
    if (c.interact && !r) { const t = this.pickNear(); const carNear = this.ctx.sim.liveVehicles().some((v) => { const p = v.body.translation(); return Math.hypot(p.x - me.pos.x, p.z - me.pos.z) < 3.2; }); if (t && (!carNear || t.kind !== 'npc')) { c.interact = false; this.openPie(t); return; } if (!t && !carNear && me.vehicle === null) { c.interact = false; this.openPie(null); return; } }
    if (!r) { if (this.S.needs.v.energy < 10) c.sprint = false; return; }
    if (r.phase === 'walk') {
      while (r.path.length && Math.hypot(r.path[0].x - me.pos.x, r.path[0].z - me.pos.z) < 0.35) r.path.shift();
      const w = r.path[0] ?? r.spot; const dx = w.x - me.pos.x, dz = w.z - me.pos.z, d = Math.hypot(dx, dz);
      const fd = Math.hypot(r.spot.x - me.pos.x, r.spot.z - me.pos.z);
      if (fd < r.best - 0.05) { r.best = fd; r.bestT = r.walkT; }
      const blocked = r.walkT - r.bestT > 0.8 && !r.path.length && fd < 1.6; // furniture in the way of the last step: just settle in
      if ((!r.path.length && d < 0.22) || blocked || r.walkT > 12) { this.arrive(); c.mx = c.mz = 0; return; }
      c.mx = (dx / d) * Math.min(1, 0.35 + d); c.mz = (dz / d) * Math.min(1, 0.35 + d); c.sprint = false; c.yaw = Math.atan2(dx, dz); c.interact = false;
      return;
    }
    c.mx = c.mz = 0; c.sprint = false; c.jump = false; c.interact = false; c.fire = false; c.aim = false;
    // hold the pose exactly where it belongs
    const s = r.spot; if (Math.abs(me.pos.x - s.x) > 0.02 || Math.abs(me.pos.z - s.z) > 0.02 || Math.abs(me.pos.y - s.y) > 0.05) this.teleport(s.x, s.y, s.z, s.yaw);
  }
  frame(dt: number) {
    const c = this.ctx; if (!this.started) return; const me = c.sim.local;
    { const r0 = this.run; const danger = c.sim.wanted > 0 || me.vehicle !== null || !me.alive; if (danger && this.speed !== 1) { this.speed = 1; this.ui.setSpeed(1); } c.view.timeScale = (r0 && r0.phase === 'do' && r0.a.ff ? r0.a.ff : 1) * this.speed; }
    const h = c.view.atmo.hour + c.view.atmo.day * 24; if (this.lastHour < 0) this.lastHour = h;
    let dh = h - this.lastHour; this.lastHour = h; if (dh < 0 || dh > 2) dh = 0;
    const r = this.run;
    const active: Partial<Record<Need, number>> = {};
    if (r && r.phase === 'do') for (const [k, v] of Object.entries(r.a.gain)) active[k as Need] = (v ?? 0) + (this.S.fan && this.S.inside && k === 'comfort' ? 4 : 0);
    if (this.S.fan && this.S.inside && !active.comfort) active.comfort = 2;
    const speed = Math.hypot(me.ext?.x ?? 0, 0) || me.speed || 0;
    decay(this.S.needs, dh, active, { sleeping: !!(r?.phase === 'do' && r.a.sleeping), sitting: !!(r?.phase === 'do' && r.a.sitting) || me.vehicle !== null, moving: speed });
    if (r && r.phase === 'do') {
      r.t += dh * 60; const p = r.a.minutes ? r.t / r.a.minutes : 1;
      this.ui.action(r.a.label, Math.min(1, r.a.fill ? Math.max(p, this.S.needs.v[r.a.fill] / 100) : p));
      if (r.t >= r.a.minutes || (r.a.fill && this.S.needs.v[r.a.fill] >= 99) || (r.a.sleeping && r.a.id === 'sleep' && this.S.needs.v.energy >= 99 && c.view.atmo.hour > 5 && c.view.atmo.hour < 12)) this.stop(false);
    } else if (r) this.ui.action(r.a.label, 0);
    this.consequences(dh);
    const mood = moodOf(this.S.needs); this.ui.update(this.S.needs, mood);
    if (this.fanBlades && this.S.fan) this.fanBlades.rotation.z += dt * 18;
    this.venue?.frame?.(dt);
    this.vdoorT -= dt; if (this.vdoorT <= 0) { this.vdoorT = 5; if (!this.inside) for (const v of this.venues.values()) if (!v.door) this.placeVenueDoor(v); }
    for (const g of this.vdoorObj.values()) { const r = g.getObjectByName('ring'); if (r) r.scale.setScalar(1 + Math.sin(performance.now() / 300) * 0.06); }
    const ring = this.doorObj?.getObjectByName('ring'); if (ring) { (ring as THREE.Mesh).scale.setScalar(1 + Math.sin(performance.now() / 300) * 0.06); }
    this.near = this.run || this.pie.open ? null : this.pickNear();
    this.saveT += dt; if (this.saveT > 15) { this.saveT = 0; this.persist(); }
  }
  private consequences(dh: number) {
    if (dh <= 0) return; const c = this.ctx; const n = this.S.needs; const me = c.sim.local;
    const warn = (k: string, title: string, body: string, every = 1.5) => { if ((this.warnT[k] ?? -99) + every > n.hours) return; this.warnT[k] = n.hours; c.hud.toast(title, body, 'linear-gradient(160deg,#fb923c,#c2410c)', 'msg', 4.5); };
    if (n.v.bladder <= 0 && !this.run?.a.sleeping) { n.v.bladder = 70; n.v.hygiene = 0; addMoodlet(n, 'accident', 'Embarrassed', -25, 5); c.hud.toast('Ah! Disgrace!', 'You no reach toilet. Everybody see am. Go baff.', 'var(--red)', 'msg', 6); }
    else if (n.v.bladder < 15) warn('bladder', 'Find toilet', 'Your bladder wan burst. Find toilet or pay toilet sharp sharp.');
    if (n.v.hunger <= 0) { me.hp = Math.max(1, me.hp - 6 * dh); addMoodlet(n, 'starving', 'Starving', -30, 1); warn('starve', 'You dey starve', 'Your body dey weak. Chop something now.', 1); }
    else if (n.v.hunger < 18) { addMoodlet(n, 'hungry', 'Hungry', -10, 1); warn('hunger', 'Belle dey shout', 'Find mama put, buka or cook something.'); }
    if (n.v.energy < 12) { addMoodlet(n, 'exhausted', 'Exhausted', -18, 1); warn('energy', 'You don tire', 'Go sleep. You no fit run like this.'); }
    if (n.v.hygiene < 18) addMoodlet(n, 'smelly', 'Smelly', -10, 1);
    if (n.v.social < 15) addMoodlet(n, 'lonely', 'Lonely', -8, 1);
    if (n.v.fun < 15) addMoodlet(n, 'bored', 'Bored stiff', -8, 1);
    if (n.v.comfort < 12) addMoodlet(n, 'sore', 'Body pain', -6, 1);
  }

  // ---------------------------------------------------------------- camera: Sims cutaway when inside
  preRender() {
    const c = this.ctx; const V = this.venue; const lot = V ? V.lot : this.lot;
    c.view.indoor = this.inside;
    if (!this.inside || c.sim.local.vehicle !== null) { for (const w of this.lot.walls) this.wallFull(w, true); return; }
    const me = c.sim.local; const cam = c.view.camera; const yaw = c.view.cam.yaw; const pitch = V?.cam?.pitch ?? 0.92, d = V?.cam?.d ?? 7.4; const O = lot.group.position;
    const tx = me.pos.x, ty = me.pos.y + 0.9, tz = me.pos.z;
    cam.position.set(tx - Math.sin(yaw) * Math.cos(pitch) * d, ty + Math.sin(pitch) * d, tz - Math.cos(yaw) * Math.cos(pitch) * d);
    cam.lookAt(tx, ty, tz); cam.updateMatrixWorld();
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (const w of lot.walls) {
      const wx = O.x + w.cx - tx, wz = O.z + w.cz - tz;
      const along = wx * fx + wz * fz;
      this.wallFull(w, along > 0.6 && Math.hypot(wx, wz) < (V ? 30 : 9));
    }
  }
  private wallFull(w: Lot['walls'][number], full: boolean) {
    const s = full ? 1 : 0.16; if (Math.abs(w.mesh.scale.y - s) < 1e-3) return;
    w.mesh.scale.y = s; w.mesh.position.y = (w.full * s) / 2;
  }

  // ---------------------------------------------------------------- input, prompt, misc
  private key(e: KeyboardEvent) {
    if (e.code === 'BracketRight' || e.code === 'BracketLeft') { const L = [1, 3, 8]; const i = Math.max(0, Math.min(2, L.indexOf(this.speed) + (e.code === 'BracketRight' ? 1 : -1))); this.speed = L[i]; this.ui.setSpeed(this.speed); return; }
    if (!this.pie.open) return;
    if (e.code === 'Escape' || e.code === 'Backspace') { this.pie.close(); e.preventDefault(); }
    const n = +e.key; if (n >= 1 && n <= 9) { this.pie.pick(n - 1); e.preventDefault(); }
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'KeyD' || e.code === 'KeyS') this.pie.move(1);
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'KeyA' || e.code === 'KeyW') this.pie.move(-1);
    if (e.code === 'Enter' || e.code === 'Space') { this.pie.confirm(); e.preventDefault(); }
  }
  prompt(): string | null {
    if (this.run || this.pie.open) return null; const t = this.near; if (!t) return null;
    if (t.kind === 'door') return `<kbd>E</kbd>${t.actions[0].label}`;
    if (t.kind === 'npc') return `<kbd>E</kbd>Talk to ${t.name}`;
    if (t.verb) return `<kbd>E</kbd>${t.verb}`;
    return `<kbd>E</kbd>${t.name}`;
  }
  private screenOf(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.ctx.view.camera);
    return v.z > 1 ? { x: innerWidth / 2, y: innerHeight / 2 } : { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }
  blips(out: { x: number; z: number; c: string; r?: number }[]) { if (this.inside) return; if (this.S.door) out.push({ x: this.S.door.x, z: this.S.door.z, c: '#2de0c8', r: 10 }); for (const v of this.venues.values()) if (v.door) out.push({ x: v.door.x, z: v.door.z, c: v.blip, r: 9 }); }
  persist() { this.ctx.save.life = this.S; this.ctx.persist(); }
  get needs() { return this.S.needs; }
  /** other systems (food vendors, toilets, clubs) run actions through the same runner */
  doAction(a: LifeAction, at?: { name: string; x: number; z: number; yaw: number }) {
    const me = this.ctx.sim.local; const t: Thing = at ? { id: 'ext', name: at.name, x: at.x, z: at.z, yaw: at.yaw, actions: [a], kind: 'object' } : { id: 'self', name: 'You', x: me.pos.x, z: me.pos.z, yaw: me.yaw, actions: [a], kind: 'self' };
    this.begin(a, t);
  }
  isBusy() { return !!this.run || this.pie.open; }
}

let L: Life | null = null;
export const lifeSystem: GameSystem & { get api(): Life | null } = {
  id: 'life',
  get api() { return L; },
  init(ctx) { L = new Life(ctx); L.init(); },
  start() { L?.start(); },
  filterCommand(_ctx, c) { L?.filterCommand(c); },
  step() { L?.step(); },
  frame(_ctx, dt) { L?.frame(dt); },
  preRender() { L?.preRender(); },
  prompt() { return L?.prompt() ?? null; },
  blips(_ctx, out) { L?.blips(out); },
};
export { NEEDS };
