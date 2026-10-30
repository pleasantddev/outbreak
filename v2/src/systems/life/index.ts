// The life layer on top of the open world: needs that run on game time, objects you use (bed, sink, toilet, stove),
// a GTA-style interaction list, walk-in interiors (your room, the casino, the club...) loaded on their own like GTA's
// interiors, people you can gist with, and the consequences of neglect. Camera and controls stay third person.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import type { Command, Actor } from '../../sim/types';
import { RAPIER, G, groups } from '../../sim/physics';
import { freshNeeds, decay, moodOf, addMoodlet, NEEDS, type NeedsState, type Need } from './needs';
import { DEFS, propMesh, planOf, type LifeAction } from './objects';
import { buildHome, HOME_ORIGIN, type Lot, type Placed } from './home';
import type { Venue, Door } from './venue';
import { Pie, type PieItem } from './pie';
import { LifeUi } from './ui';
import { RT } from '../societyRuntime';
import { net } from '../../net/client';
import { inInteriorZone } from '../../net/rules';
import { fullStory } from '../societyModel';
import { people } from '../net';
import type { HumanView } from '../../render/humans';

export interface Thing { id: string; name: string; x: number; z: number; yaw: number; y?: number; actions: LifeAction[]; kind: 'object' | 'door' | 'npc' | 'self' | 'player'; actor?: Actor; placed?: Placed; open?: () => void; reach?: number; verb?: string }
interface Running { a: LifeAction; thing: Thing; phase: 'walk' | 'do'; t: number; secs: number; give: Partial<Record<Need, number>>; walkT: number; path: { x: number; z: number }[]; best: number; bestT: number; spot: { x: number; z: number; y: number; yaw: number }; prop?: THREE.Object3D }
interface Save { needs: NeedsState; food: number; fan: boolean; door: { x: number; z: number; yaw: number } | null; inside: boolean; tips: string[]; pantry: number; at?: string | null; vdoors?: Record<string, Door>; seen?: number }

const CAP = 0.9; // capsule centre above the feet
/** where the shared venues are in the world (around Oshodi, where everybody starts) */
// building kinds (world/region.ts BK): house 1, shops 2, flats 3, hotel 4, warehouse 5, institution 8, bank 13
const VENUE_ANCHOR: Record<string, { x: number; z: number; kinds: number[] }> = {
  casino: { x: 1250, z: -560, kinds: [4, 2, 3] }, club: { x: 560, z: -90, kinds: [2, 4, 5] }, joint: { x: 1080, z: -150, kinds: [2, 1, 3] },
  hub: { x: 700, z: -560, kinds: [2, 8, 3] }, bank: { x: 1150, z: -330, kinds: [13, 2, 3] } };
const wrapA = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

class Life {
  S!: Save; lot!: Lot; pie = new Pie(); ui = new LifeUi();
  run: Running | null = null; lastHour = -1; started = false; doorObj: THREE.Group | null = null; fanBlades: THREE.Object3D | null = null;
  near: Thing | null = null; private saveT = 0; private warnT: Record<string, number> = {}; private bodies: any[] = [];
  private talkWith: Actor | null = null;
  /** a short lockout after going through a door so you do not bounce straight back */
  private doorCool = 0;
  venues = new Map<string, Venue>(); private vdoorT = 3; private vdoorObj = new Map<string, THREE.Group>();
  /** other systems add interactables in the street (vendors, pay toilets, clubs) */
  providers: (() => Thing[])[] = [];
  /** a friend's room you were invited to (their street door) and whether you are in it right now */
  invite: { owner: string; name: string; door: Door; until: number } | null = null; guest = false;
  constructor(public ctx: GameCtx) {}

  init() {
    const c = this.ctx;
    const s = c.save.life as Save | undefined;
    this.S = s && s.needs ? Object.assign({ food: 0, fan: false, door: null, inside: false, tips: [], pantry: 0 }, s) as Save : { needs: freshNeeds(), food: 1, fan: false, door: null, inside: false, tips: [], pantry: 0 };
    this.ui.onCancel = () => this.stop(true);
    addEventListener('keydown', (e) => this.key(e));
    (window as any).__life = this;
  }

  start() {
    this.buildLot();
    net.on('social', (m: any) => this.onSocial(m));
    this.started = true; this.ui.show(true);
    if (!this.S.door) this.placeDoor(); else this.buildDoor();
    if (this.S.seen) { const off = Math.min(600, (Date.now() - this.S.seen) / 60000); if (off > 1) decay(this.S.needs, off * 0.25, {}, { sleeping: true, sitting: false, moving: 0 }); for (const k of NEEDS) this.S.needs.v[k] = Math.max(25, this.S.needs.v[k]); }
    if (this.S.inside) this.enter(false);
    if (this.S.at) { const v = this.venues.get(this.S.at); this.S.at = null; const d = v?.door; if (d) this.teleport(d.x + Math.sin(d.yaw) * 1.4, 0.05, d.z + Math.cos(d.yaw) * 1.4, d.yaw); }
    for (const v of this.venues.values()) this.placeVenueDoor(v);
    const tip = (id: string, title: string, body: string, ms: number) => { if (this.S.tips.includes(id)) return; setTimeout(() => { this.ctx.hud.toast(title, body, 'linear-gradient(160deg,#2de0c8,#139a8a)', 'pin', 7); this.S.tips.push(id); }, ms); };
    tip('home', 'Your room is ready', 'Landlord don give you key. Follow the house pin on the map and walk in the door. Press E at anything to use it.', 24000);
    tip('needs', 'Mind yourself', 'The small rings under your map are your needs. Eat, sleep, bath, gist, have fun. Tap them for details, Z for your own menu.', 52000);
  }

  /** Your room is a private interior, GTA Online apartment style: every account gets its own slot far from the city,
   *  so in multiplayer nobody else's room sits on top of yours. Shared venues (casino, club...) are one instance. */
  /** where an account's room sits in the interior zone (the server keeps rooms apart by account, so a shared slot is harmless) */
  static slotOf(id: string) { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } const slot = (h >>> 0) % 400; return new THREE.Vector3(30000 + (slot % 20) * 150, 0, 30000 + Math.floor(slot / 20) * 150); }
  private ownOrigin = new THREE.Vector3(); private homeBody: any = null;
  /** move the room (mesh, colliders, everything placed in it) to another slot: yours, or the friend's you are visiting */
  private placeLot(o: THREE.Vector3) { HOME_ORIGIN.copy(o); this.lot.group.position.copy(o); this.homeBody?.setTranslation({ x: o.x, y: 0, z: o.z }, true); }
  private buildLot() {
    const c = this.ctx; this.ownOrigin = Life.slotOf(c.profile?.accountId || c.profile?.name || 'local'); HOME_ORIGIN.copy(this.ownOrigin);
    this.lot = buildHome(); c.view.scene.add(this.lot.group);
    this.fanBlades = this.lot.placed.find((p) => p.def === 'fan')?.obj.getObjectByName('blades') ?? null;
    const W = c.sim.phys.world; const body = W.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(HOME_ORIGIN.x, 0, HOME_ORIGIN.z));
    for (const b of this.lot.boxes) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b.yaw);
      W.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(groups(G.WORLD, 0xffff)), body);
    }
    this.addCeil(body, this.lot); this.bodies.push(body); this.homeBody = body;
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
    this.addCeil(body, v.lot);
    if (this.started) this.placeVenueDoor(v);
  }
  /** a lid on every interior so the camera stays inside like it would in a real building */
  private addCeil(body: any, lot: Lot) { const c = lot.ceil; if (!c) return; this.ctx.sim.phys.world.createCollider(RAPIER.ColliderDesc.cuboid((c.x1 - c.x0) / 2, 0.1, (c.z1 - c.z0) / 2).setTranslation((c.x0 + c.x1) / 2, c.y + 0.1, (c.z0 + c.z1) / 2).setCollisionGroups(groups(G.WORLD, 0xffff)), body); }
  /** Every venue has a fixed anchor in the world. Its door goes on the best building face near the anchor, computed
   *  only from map data, so every player in the session finds the casino in the same place. */
  private placeVenueDoor(v: Venue) {
    const c = this.ctx; const A = VENUE_ANCHOR[v.id]; if (!A) return;
    const taken = [...this.venues.values()].filter((o) => o !== v && o.door).map((o) => o.door!);
    let best: Door | null = null, bs = -1e9;
    for (const r of c.store.regions.values()) for (const b of r.buildings) {
      if (b.dead || Math.abs(b.cx - A.x) > 600 || Math.abs(b.cz - A.z) > 600) continue;
      const pref = A.kinds.indexOf(b.kind); if (pref < 0 || b.area < 120) continue;
      const pts = b.pts; const n = pts.length / 2;
      for (let i = 0; i < n; i++) { const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1]; const L = Math.hypot(bx - ax, bz - az); if (L < 7) continue;
        let nx = -(bz - az) / L, nz = (bx - ax) / L; const mx = (ax + bx) / 2, mz = (az + bz) / 2; if ((mx - b.cx) * nx + (mz - b.cz) * nz < 0) { nx = -nx; nz = -nz; }
        if (taken.some((t) => Math.hypot(t.x - mx, t.z - mz) < 60)) continue;
        const score = -Math.hypot(mx - A.x, mz - A.z) - pref * 120 + Math.min(L, 30) * 2 + Math.min(b.area, 2500) / 40;
        if (score > bs) { bs = score; best = { x: mx + nx * 0.25, z: mz + nz * 0.25, yaw: Math.atan2(nx, nz) }; } }
    }
    if (!best) return; v.door = best; this.buildVenueDoor(v);
  }
  /** Map footprints and the drawn/colliding walls can differ by a metre or two (declutter trims them), so once the
   *  walls near a door exist, cast a ray at the building and sit the door exactly on the real wall. */
  private snapDoor(d: Door): Door | null {
    const ph = this.ctx.sim.phys; const nx = Math.sin(d.yaw), nz = Math.cos(d.yaw);
    for (const off of [0, -1.2, 1.2]) {
      const ox = d.x + nx * 7 + nz * off, oz = d.z + nz * 7 - nx * off;
      const hit = ph.ray({ x: ox, y: 1.2, z: oz }, { x: -nx, y: 0, z: -nz }, 14, groups(0xffff, G.WORLD));
      if (hit && hit.t > 1) return { x: hit.point.x - nz * off + nx * 0.06, z: hit.point.z + nx * off + nz * 0.06, yaw: d.yaw };
    }
    return null;
  }
  private snapT = 0; private snapped = new Set<string>();
  private snapDoors() {
    const me = this.ctx.sim.local; const todo: [string, Door, (d: Door) => void][] = [];
    if (this.S.door && !this.snapped.has('home')) todo.push(['home', this.S.door, (d) => { this.S.door = d; this.buildDoor(); this.persist(); }]);
    for (const v of this.venues.values()) if (v.door && !this.snapped.has(v.id)) todo.push([v.id, v.door, (d) => { v.door = d; this.buildVenueDoor(v); }]);
    for (const [id, d, set] of todo) { if (Math.hypot(d.x - me.pos.x, d.z - me.pos.z) > 120) continue; const s = this.snapDoor(d); if (s) { this.snapped.add(id); if (Math.hypot(s.x - d.x, s.z - d.z) > 0.05) set(s); } }
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
    this.ui.black(async () => { if (!(await this.door(v.id))) return; const O = v.lot.group.position, s = v.lot.spawn; this.S.at = v.id; this.doorCool = 1.2; const jx = (Math.random() - 0.5) * 1.6; this.teleport(O.x + s.x + jx, 0.02, O.z + s.z + Math.random() * 0.6, s.yaw); c.view.cam.yaw = s.yaw; c.view.cam.pitch = -0.12; v.enter?.(); c.hud.title(v.title, v.sub, 2.5); });
  }
  exitVenue() {
    const v = this.venue; if (!v) return; this.stop(true);
    this.ui.black(async () => { if (!(await this.door(null))) return; v.exit?.(); this.S.at = null; this.doorCool = 1.2; const d = v.door!; this.teleport(d.x + Math.sin(d.yaw) * 1.4, 0.05, d.z + Math.cos(d.yaw) * 1.4, d.yaw); for (let i = 0; i < 12; i++) { this.ctx.view.world.update(d.x, d.z, true); await new Promise((r) => setTimeout(r, 0)); } this.ctx.view.cam.yaw = d.yaw; });
  }
  enter(fade = true) {
    const go = async () => {
      if (!(await this.door('home'))) return;
      const s = this.lot.spawn; this.S.inside = true; this.doorCool = 1.2; this.ctx.view.cam.yaw = s.yaw; this.ctx.view.cam.pitch = -0.12;
      this.teleport(HOME_ORIGIN.x + s.x, 0.02, HOME_ORIGIN.z + s.z, s.yaw);
      this.ctx.hud.title('HOME', 'Room 4, Bello Compound', 2.5); this.persist();
    };
    if (fade) this.ui.black(go); else void go();
  }
  exit() {
    this.ui.black(async () => {
      if (!(await this.door(null))) return;
      const d = this.guest && this.invite ? this.invite.door : this.S.door!; this.S.inside = false; this.doorCool = 1.2;
      if (this.guest) { this.guest = false; this.placeLot(this.ownOrigin); }
      this.teleport(d.x + Math.sin(d.yaw) * 1.3, 0.05, d.z + Math.cos(d.yaw) * 1.3, d.yaw);
      for (let i = 0; i < 12; i++) { this.ctx.view.world.update(d.x, d.z, true); await new Promise((r) => setTimeout(r, 0)); }
      this.ctx.view.cam.yaw = d.yaw; this.persist();
    });
  }
  /** the server put us back on the other side of a door (it refused the hop): make the life state match the body */
  private resync() {
    const me = this.ctx.sim.local; if (!inInteriorZone(me.pos.x, me.pos.z)) { this.S.at = null; this.S.inside = false; return; }
    if (Math.hypot(me.pos.x - HOME_ORIGIN.x, me.pos.z - HOME_ORIGIN.z) < 60) { this.S.inside = true; this.S.at = null; return; }
    for (const v of this.venues.values()) { const O = v.lot.group.position; if (Math.hypot(me.pos.x - O.x, me.pos.z - O.z) < 60) { this.S.at = v.id; return; } }
  }
  /** online, ask the server before moving between the street and an interior (it judges the jump) */
  private async door(into: string | null) {
    if (!net.active) return true;
    const r = await net.act('door', { into }); if (!r.ok) { this.ctx.hud.toast('Door', r.err ?? 'Try again.', 'var(--red)', 'msg', 2.5); this.doorCool = 1.5; }
    return r.ok;
  }
  private teleport(x: number, y: number, z: number, yaw: number) {
    const me = this.ctx.sim.local; me.pos = { x, y, z }; me.vy = 0; me.yaw = yaw; me.body.setTranslation({ x, y: y + CAP, z }, true);
  }

  // ---------------------------------------------------------------- what is around me
  private things(): Thing[] {
    const out: Thing[] = []; const me = this.ctx.sim.local;
    const V = this.venue;
    if (V) {
      const O = V.lot.group.position, e = V.lot.exit; out.push({ id: 'exit', name: 'Exit', x: O.x + e.x, z: O.z + e.z + 0.9, yaw: Math.PI, actions: [{ id: 'vout', label: 'Go outside', gain: {}, minutes: 0, clip: 'Idle_Loop', spot: [0, 0, 0] }], kind: 'door', reach: 1.6 });
      for (const t of V.things?.() ?? []) out.push(t);
    } else if (this.S.inside) {
      for (const p of this.lot.placed) { const d = DEFS[p.def]; if (!d.actions.length) continue; out.push({ id: p.def, name: d.name, x: HOME_ORIGIN.x + p.x, z: HOME_ORIGIN.z + p.z, yaw: p.yaw, actions: d.actions, kind: 'object', placed: p }); }
      const e = this.lot.exit; out.push({ id: 'exit', name: 'Front door', x: HOME_ORIGIN.x + e.x, z: HOME_ORIGIN.z + e.z + 1.0, yaw: Math.PI, actions: [{ id: 'out', label: 'Go outside', gain: {}, minutes: 0, clip: 'Idle_Loop', spot: [0, 0, 0] }], kind: 'door', reach: 1.6 });
    } else if (this.S.door) {
      const iv = this.invite; if (iv && iv.until > Date.now() && Math.abs(iv.door.x - me.pos.x) < 6 && Math.abs(iv.door.z - me.pos.z) < 6) out.push({ id: 'visit', name: `${iv.name}'s room`, x: iv.door.x, z: iv.door.z, yaw: iv.door.yaw, actions: [{ id: 'visit', label: `Visit ${iv.name}`, gain: {}, minutes: 0, clip: 'Idle_Loop', spot: [0, 0, 0] }], kind: 'door' });
      const d = this.S.door; out.push({ id: 'home', name: 'Your house', x: d.x, z: d.z, yaw: d.yaw, actions: [{ id: 'in', label: 'Go inside', gain: {}, minutes: 0, clip: 'Idle_Loop', spot: [0, 0, 0] }], kind: 'door' });
    }
    if (!this.inside) for (const v of this.venues.values()) if (v.door && Math.abs(v.door.x - me.pos.x) < 5 && Math.abs(v.door.z - me.pos.z) < 5) out.push({ id: 'venue', name: v.title, x: v.door.x, z: v.door.z, yaw: v.door.yaw, actions: [{ id: 'vin:' + v.id, label: v.label ?? `Enter ${v.title}`, gain: {}, minutes: 0, clip: 'Idle_Loop', spot: [0, 0, 0] }], kind: 'door', reach: 2.6 });
    // real people first: other players standing near you
    for (const p of people.near(me.pos.x, me.pos.z, 2.8)) out.push({ id: 'player', name: p.name, x: p.x, z: p.z, yaw: 0, actions: [], kind: 'player', verb: `Meet ${p.name}`, reach: 2.8, open: () => this.piePlayer(p) });
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
    if (t.kind === 'door') { const a = t.actions[0]; if (a.id.startsWith('vin:')) this.enterVenue(this.venues.get(a.id.slice(4))!); else if (a.id === 'vout') this.exitVenue(); else if (a.id === 'visit') this.visit(); else a.id === 'in' ? this.enter() : this.exit(); return; }
    if (t.kind === 'npc') { this.pieNpc(t); return; }
    const items: PieItem[] = t.actions.filter((a) => this.allowed(a)).map((a) => ({ id: a.id, label: a.label, hint: a.effect === 'cook3' && this.S.pantry > 0 ? `Uses market foodstuff (${this.S.pantry} left)` : a.hint, cost: a.effect === 'cook3' && this.S.pantry > 0 ? undefined : a.cost, disabled: a.cost && c.sim.cash < a.cost && !(a.effect === 'cook3' && this.S.pantry > 0) ? 'No money' : a.when === 'hasFood' && this.S.food <= 0 ? 'Nothing inside' : undefined }));
    if (!items.length) return;
    if (items.length === 1 && !items[0].disabled) { this.begin(t.actions.find((x) => x.id === items[0].id)!, t); return; } // one thing to do: just do it
    this.pie.show(t.name, t.id === 'cooler' ? `${this.S.food} plate${this.S.food === 1 ? '' : 's'} of food` : 'Choose', items, this.screenOf(t.x, 1.1, t.z), (id) => { const a = t.actions.find((x) => x.id === id)!; this.begin(a, t); });
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
    this.pie.show('You', 'Your phone and your mood', items, { x: innerWidth / 2, y: innerHeight / 2 }, (id) => {
      const me = this.ctx.sim.local; const self: Thing = { id: 'self', name: 'You', x: me.pos.x, z: me.pos.z, yaw: me.yaw, actions: [], kind: 'self' };
      if (id === 'call') this.begin({ ...phone('Calling your people', { social: 22, fun: 4 }, 25), clip: 'Idle_TalkingPhone_Loop', pose: undefined }, self);
      if (id === 'scroll') this.begin({ ...phone('Scrolling', { fun: 16 }, 20), clip: 'Idle_Loop' }, self);
      if (id === 'game') this.begin({ ...phone('Playing Ludo', { fun: 24 }, 25), clip: 'Idle_Loop' }, self);
      if (id === 'needs') this.ui.sheet.classList.add('on');
      if (id === 'home') this.ctx.hud.toast('GPS', 'Follow the house pin on your map.', 'linear-gradient(160deg,#2de0c8,#139a8a)', 'pin', 4);
    });
  }
  // ---------------------------------------------------------------- real people (online)
  private piePlayer(p: { id: number; name: string; level: number }) {
    const c = this.ctx; const me = c.sim.local; const cash = c.sim.cash;
    const items: PieItem[] = [
      { id: 'hail', label: 'Hail them', hint: '+Social' }, { id: 'gist', label: 'Gist', hint: '+Social' },
      { id: 'pay1', label: 'Send ₦1,000', cost: 1000, disabled: cash < 1000 ? 'No money' : undefined },
      { id: 'pay5', label: 'Send ₦5,000', cost: 5000, disabled: cash < 5000 ? 'No money' : undefined },
    ];
    if (this.S.door && !this.guest && !this.venue) items.push({ id: 'invite', label: 'Invite to my room', hint: this.S.inside ? 'They walk in your door' : 'Then walk them home' });
    const pick = (l: string[]) => l[(Math.random() * l.length) | 0];
    const self = (): Thing => ({ id: 'self', name: 'You', x: me.pos.x, z: me.pos.z, yaw: me.yaw, actions: [], kind: 'self' });
    this.pie.show(p.name, `Level ${p.level} · a real person`, items, { x: innerWidth / 2, y: innerHeight / 2 }, async (id) => {
      if (id === 'hail' || id === 'gist') {
        people.emote(c, id === 'hail' ? 'wave' : 'talk'); void net.act('social.greet', { to: p.id });
        c.hud.say('You', pick(id === 'hail' ? ['How far!', 'My guy!', 'Ehen, na you?', 'Odogwu!'] : ['Wetin dey happen?', 'Gist me na.', 'You don hear wetin happen for Oshodi?']), 2.6);
        if (id === 'hail') { this.S.needs.v.social = Math.min(100, this.S.needs.v.social + 8); addMoodlet(this.S.needs, 'hailed', `Hailed ${p.name}`, 3, 4); return; }
        this.begin({ id: 'talk', label: `Gisting with ${p.name}`, gain: { social: 150, fun: 30 }, minutes: 10, clip: 'Idle_Talking_Loop', spot: [0, 0, 0] }, self()); return;
      }
      if (id === 'pay1' || id === 'pay5') {
        const amount = id === 'pay1' ? 1000 : 5000; const r = await net.act('cash.transfer', { to: p.name, amount });
        if (r.ok) { c.hud.toast('Sent', `₦${amount.toLocaleString()} to ${p.name}.`, 'linear-gradient(160deg,#59d98e,#14a05a)', 'cash', 3.5); addMoodlet(this.S.needs, 'generous', 'Felt generous', 4, 6); }
        else c.hud.toast('Transfer', r.err ?? 'It did not go.', 'var(--red)', 'msg', 3.5);
        return;
      }
      if (id === 'invite') {
        const r = await net.act('social.invite', { to: p.id, door: this.S.door });
        c.hud.toast('Invite', r.ok ? `${p.name} has your address. ${this.S.inside ? 'They can walk in.' : 'Go home and they can follow you in.'}` : (r.err ?? 'It did not go.'), r.ok ? 'linear-gradient(160deg,#2de0c8,#139a8a)' : 'var(--red)', 'pin', 4.5);
      }
    });
  }
  private onSocial(m: { kind: string; from: string; fromId: number; owner?: string; door?: Door }) {
    const c = this.ctx;
    if (m.kind === 'greet') { c.hud.toast(m.from, 'hailed you. Hail them back!', 'linear-gradient(160deg,#2de0c8,#139a8a)', 'msg', 4); this.S.needs.v.social = Math.min(100, this.S.needs.v.social + 4); return; }
    if (m.kind === 'invite' && m.owner && m.door) {
      const inv = { owner: m.owner, name: m.from, door: m.door, until: Date.now() + 15 * 60_000 };
      c.hud.call(m.from, 'Come chill for my room', () => { this.invite = inv; c.hud.toast('Invite', `${m.from}'s door is the yellow pin on your map. Walk in when they are home.`, 'linear-gradient(160deg,#f59e0b,#b45309)', 'pin', 6); }, undefined, 20);
      return;
    }
    if (m.kind === 'evict' && this.guest) { c.hud.toast(m.from, 'left the room, so you follow them out.', 'var(--pur)', 'msg', 4); this.exit(); }
  }
  /** walk into the room of someone who invited you: their slot, their furniture; the server checks the invite */
  private visit() {
    const iv = this.invite; if (!iv || this.run) return;
    this.ui.black(async () => {
      if (!(await this.door('home:' + iv.owner))) return;
      this.guest = true; this.placeLot(Life.slotOf(iv.owner));
      const s = this.lot.spawn; this.S.inside = true; this.doorCool = 1.2; this.ctx.view.cam.yaw = s.yaw; this.ctx.view.cam.pitch = -0.12;
      this.teleport(HOME_ORIGIN.x + s.x, 0.02, HOME_ORIGIN.z + s.z, s.yaw);
      this.ctx.hud.title(`${iv.name}'s room`.toUpperCase(), 'You are a guest. Behave yourself.', 2.5);
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
    this.run = { a, thing: t, phase: t.kind === 'self' ? 'do' : 'walk', t: 0, walkT: 0, spot, path: this.route(spot), best: 1e9, bestT: 0, ...planOf(a) };
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
      if (r.a.sleeping && r.a.id === 'sleep') c.hud.toast('Rested', 'You feel better. The city did not wait for you.', 'linear-gradient(160deg,#6366f1,#312e81)', 'msg', 3);
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
    if (c.interact && !r) { const t = this.pickNear(); const carNear = this.ctx.sim.liveVehicles().some((v) => { const p = v.body.translation(); return Math.hypot(p.x - me.pos.x, p.z - me.pos.z) < 3.2; }); if (t && (!carNear || t.kind !== 'npc')) { c.interact = false; this.openPie(t); return; } }
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
    c.view.timeScale = 1; // one shared world clock: nothing a player does speeds it up
    if (inInteriorZone(me.pos.x, me.pos.z) !== this.inside) this.resync();
    this.doorCool = Math.max(0, this.doorCool - dt); if (!this.doorCool && !this.run && !this.pie.open && me.vehicle === null && me.alive) this.walkThrough();
    const dh = Math.min(dt, 0.25) / 60; // real minutes this frame
    const r = this.run;
    const active: Partial<Record<Need, number>> = {};
    if (r && r.phase === 'do') for (const [k, v] of Object.entries(r.give)) active[k as Need] = ((v ?? 0) / Math.max(1, r.secs)) * 60;
    if (this.S.fan && this.S.inside) active.comfort = (active.comfort ?? 0) + 0.8;
    const speed = me.speed || 0;
    decay(this.S.needs, dh, active, { sleeping: !!(r?.phase === 'do' && r.a.sleeping), sitting: !!(r?.phase === 'do' && r.a.sitting) || me.vehicle !== null, moving: speed });
    if (r && r.phase === 'do') {
      r.t += Math.min(dt, 0.25); const p = r.t / r.secs;
      this.ui.action(r.a.label, Math.min(1, r.a.fill ? Math.max(p, this.S.needs.v[r.a.fill] / 100) : p));
      if (r.t >= r.secs || (r.a.fill && this.S.needs.v[r.a.fill] >= 99.5)) this.stop(false);
    } else if (r) this.ui.action(r.a.label, 0);
    this.consequences(dh);
    const mood = moodOf(this.S.needs); this.ui.update(this.S.needs, mood);
    if (this.fanBlades && this.S.fan) this.fanBlades.rotation.z += dt * 18;
    this.venue?.frame?.(dt);
    this.snapT -= dt; if (this.snapT <= 0 && !this.inside) { this.snapT = 1; this.snapDoors(); }
    this.vdoorT -= dt; if (this.vdoorT <= 0) { this.vdoorT = 2; if (!this.inside) for (const v of this.venues.values()) if (!v.door) this.placeVenueDoor(v); }
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

  // ---------------------------------------------------------------- interiors keep the normal third person camera
  preRender() {
    const c = this.ctx; const ins = this.inside && c.sim.local.vehicle === null;
    c.view.indoor = ins; (c.view.cam as any).indoor = ins;
  }
  /** walk into a doorway and you are through it; the cut hides the interior loading, like GTA */
  private walkThrough() {
    const me = this.ctx.sim.local; const mv = Math.hypot(me.cmd?.mx ?? 0, me.cmd?.mz ?? 0); if (mv < 0.3) return; const fx = me.cmd.mx / mv, fz = me.cmd.mz / mv;
    /** inside radius r of (x, z) and walking roughly along (wx, wz) */
    const hit = (x: number, z: number, wx: number, wz: number, r = 0.85) => Math.hypot(x - me.pos.x, z - me.pos.z) <= r && fx * wx + fz * wz > 0.35;
    const V = this.venue;
    if (V) { const O = V.lot.group.position, e = V.lot.exit; if (hit(O.x + e.x, O.z + e.z, 0, -1, 1.2)) this.exitVenue(); return; }
    if (this.S.inside) { const e = this.lot.exit; if (hit(HOME_ORIGIN.x + e.x, HOME_ORIGIN.z + e.z, 0, -1, 1.2)) this.exit(); return; }
    const iv = this.invite; if (iv && iv.until > Date.now() && hit(iv.door.x + Math.sin(iv.door.yaw) * 0.6, iv.door.z + Math.cos(iv.door.yaw) * 0.6, -Math.sin(iv.door.yaw), -Math.cos(iv.door.yaw), 1.1)) { this.doorCool = 3; this.visit(); return; }
    const d = this.S.door; if (d && hit(d.x + Math.sin(d.yaw) * 0.6, d.z + Math.cos(d.yaw) * 0.6, -Math.sin(d.yaw), -Math.cos(d.yaw), 1.1)) { const b = (this.ctx.systems.get('bills') as any)?.api; if (b && !b.canEnterHome()) { this.doorCool = 4; return; } this.enter(); return; }
    for (const v of this.venues.values()) { const vd = v.door; if (!vd || v.fee) continue; if (hit(vd.x + Math.sin(vd.yaw) * 0.45, vd.z + Math.cos(vd.yaw) * 0.45, -Math.sin(vd.yaw), -Math.cos(vd.yaw), 1.2)) { const why = v.refuse?.(); if (why) { this.ctx.hud.toast(v.title, why, 'var(--red)', 'msg', 3.5); this.doorCool = 4; return; } this.enterVenue(v); return; } }
  }

  // ---------------------------------------------------------------- input, prompt, misc
  private key(e: KeyboardEvent) {
    if (e.code === 'KeyZ' && !e.repeat && !this.pie.open && !this.run && this.started && this.ctx.sim.local.vehicle === null && !(document.activeElement instanceof HTMLInputElement)) { this.ctx.input.releasePointer(); this.pieSelf(); return; }
    if (!this.pie.open) return;
    if (e.code === 'Escape' || e.code === 'Backspace') { this.pie.close(); e.preventDefault(); }
    const n = +e.key; if (n >= 1 && n <= 9) { this.pie.pick(n - 1); e.preventDefault(); }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.pie.move(1);
    if (e.code === 'ArrowUp' || e.code === 'KeyW') this.pie.move(-1);
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE' || e.code === 'KeyF') { this.pie.confirm(); e.preventDefault(); }
  }
  prompt(): string | null {
    if (this.run || this.pie.open) return null; const t = this.near; if (!t) return null;
    if (t.kind === 'door') return t.actions[0].id.startsWith('vin:') && !this.venues.get(t.actions[0].id.slice(4))?.fee ? `Walk in · ${t.name}` : `<kbd>E</kbd>${t.actions[0].label}`;
    if (t.kind === 'npc') return `<kbd>E</kbd>Talk to ${t.name}`;
    if (t.verb) return `<kbd>E</kbd>${t.verb}`;
    return `<kbd>E</kbd>${t.name}`;
  }
  private screenOf(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.ctx.view.camera);
    return v.z > 1 ? { x: innerWidth / 2, y: innerHeight / 2 } : { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }
  blips(out: { x: number; z: number; c: string; r?: number }[]) { if (this.inside) return; if (this.S.door) out.push({ x: this.S.door.x, z: this.S.door.z, c: '#2de0c8', r: 10 }); if (this.invite && this.invite.until > Date.now()) out.push({ x: this.invite.door.x, z: this.invite.door.z, c: '#ffc53d', r: 10 }); for (const v of this.venues.values()) { const p = v.door ?? VENUE_ANCHOR[v.id]; if (p) out.push({ x: p.x, z: p.z, c: v.blip, r: 9 }); } }
  persist() { this.S.seen = Date.now(); this.ctx.save.life = this.guest ? { ...this.S, inside: false } : this.S; this.ctx.persist(); }
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
