// Your room is yours to arrange. Z at home: "Arrange the room". Walk to a piece and press E to lift it, it follows you
// (green where it fits, red where it would hit something), R or the list turns it, E puts it down. The OjaHome app
// sells more (a rug, plants, a rechargeable lantern that works through NEPA, a sofa, a shelf, a mirror, a speaker, an
// AC that eats units, wall art) and repaints the walls or lays new carpet. Guests see your layout (it travels with the
// invite). A guest you invite as interior designer can rearrange it too: their moves reach you and you keep them.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import { lifeSystem, type Thing } from './index';
import { DEFS, type SmartDef } from './objects';
import type { Placed } from './home';
import { plaster, lino, wood, ankara, tiles } from './tex';
import { addMoodlet } from './needs';
import { spend } from '../money';
import { net } from '../../net/client';
import { registerApp } from '../../ui/lifeHud';
import { career } from '../careers/ranks';
import { RAPIER, G, groups } from '../../sim/physics';

export interface RoomSave { v: 1; pos: Record<string, [number, number, number]>; extra: { uid: string; def: string; x: number; z: number; yaw: number }[]; wall: string | null; floor: string | null }
const ROOM = { x0: 1.05, z0: 3.55, x1: 4.55, z1: 6.95 };
const MOVABLE = new Set(['bed', 'wardrobe', 'tv', 'chair', 'fan', 'table', 'poster', 'rug', 'plant', 'lantern', 'sofa', 'shelf', 'mirror', 'speaker', 'ac', 'art']);
const WALLS: [string, string, number][] = [['#9cc3d5', 'Sky blue (original)', 0], ['#e8dcc4', 'Cream', 15_000], ['#c9e4c5', 'Mint', 15_000], ['#f2c6a0', 'Peach', 15_000], ['#d9c2e8', 'Lilac', 15_000], ['#f4f1ea', 'Clean white', 15_000], ['#7a8f6b', 'Army green', 15_000]];
const FLOORS: [string, string, number][] = [['lino', 'Old carpet (original)', 0], ['wood', 'Wood-look vinyl', 25_000], ['tiles', 'Floor tiles', 45_000], ['ankara', 'Ankara rug carpet', 30_000]];
const M = (c: number | string, r = 0.8, m = 0, map?: THREE.Texture) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, map: map ?? null });
const bx = (g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
const cy = (g: THREE.Group, r0: number, r1: number, h: number, x: number, y: number, z: number, m: THREE.Material, seg = 14) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };

// ---------------------------------------------------------------- things you can buy
const SHOP: (SmartDef & { price: number; blurb: string })[] = [
  { id: 'rug', name: 'Rug', price: 18_000, blurb: 'Soft under your feet.', size: [1.6, 0.02, 1.1], actions: [], build() { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), M(0xffffff, 0.95, 0, ankara('#b23a48', '#f2c14e', 7))); m.rotation.x = -Math.PI / 2; m.position.y = 0.02; m.receiveShadow = true; g.add(m); return g; } },
  { id: 'plant', name: 'Potted plant', price: 9_000, blurb: 'Something alive in the room.', size: [0.45, 1.1, 0.45], actions: [{ id: 'water', label: 'Water the plant', hint: '+Fun', gain: {}, minutes: 0, secs: 6, give: { fun: 6, comfort: 4 }, clip: 'Idle_Loop', spot: [0, 0, 0.6] }],
    build() { const g = new THREE.Group(); cy(g, 0.18, 0.14, 0.32, 0, 0.16, 0, M(0x9a5b3c, 0.7)); for (let i = 0; i < 7; i++) { const l = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 6), M(0x2e7d32, 0.7)); const a = (i / 7) * Math.PI * 2; l.position.set(Math.cos(a) * 0.08, 0.62, Math.sin(a) * 0.08); l.rotation.set(Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35); l.castShadow = true; g.add(l); } return g; } },
  { id: 'lantern', name: 'Rechargeable lantern', price: 12_000, blurb: 'Light when NEPA takes theirs.', size: [0.22, 0.35, 0.22], actions: [{ id: 'switch', label: 'Switch the lantern', hint: 'Light without NEPA', gain: {}, minutes: 0, secs: 2, give: { comfort: 3 }, clip: 'Idle_Loop', spot: [0, 0, 0.5], effect: 'lantern' }],
    build() { const g = new THREE.Group(); cy(g, 0.1, 0.11, 0.05, 0, 0.025, 0, M(0x263238, 0.5)); const glow = cy(g, 0.08, 0.08, 0.2, 0, 0.15, 0, new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd27a, emissiveIntensity: 0.0, roughness: 0.3 })); glow.name = 'glow'; cy(g, 0.1, 0.1, 0.04, 0, 0.27, 0, M(0x263238, 0.5)); const l = new THREE.PointLight(0xffc27a, 0, 6.5, 1.7); l.position.set(0, 0.5, 0); l.name = 'lamp'; g.add(l); return g; } },
  { id: 'sofa', name: 'Two-seater sofa', price: 85_000, blurb: 'For when people visit.', size: [1.5, 0.85, 0.75], solid: true, actions: [{ id: 'sit', label: 'Sit on the sofa', hint: '+Comfort', gain: {}, minutes: 0, secs: 20, give: { comfort: 45 }, fill: 'comfort', clip: 'Sitting_Idle_Loop', spot: [0, 0.05, 0.05], sitting: true }],
    build() { const g = new THREE.Group(); const c = M(0x5d4037, 0.9); bx(g, 1.5, 0.4, 0.75, 0, 0.2, 0, c); bx(g, 1.5, 0.45, 0.16, 0, 0.6, -0.3, c); bx(g, 0.14, 0.25, 0.75, -0.68, 0.5, 0, c); bx(g, 0.14, 0.25, 0.75, 0.68, 0.5, 0, c); bx(g, 0.66, 0.1, 0.6, -0.34, 0.45, 0.04, M(0x795548, 0.95)); bx(g, 0.66, 0.1, 0.6, 0.34, 0.45, 0.04, M(0x795548, 0.95)); return g; } },
  { id: 'shelf', name: 'Bookshelf', price: 32_000, blurb: 'Books, certificates, a framed photo.', size: [0.9, 1.6, 0.32], solid: true, actions: [{ id: 'read', label: 'Read a book', hint: '+Fun', gain: {}, minutes: 0, secs: 25, give: { fun: 14, comfort: 4 }, clip: 'Idle_Loop', spot: [0, 0, 0.6], prop: 'book', pose: 'read' }],
    build() { const g = new THREE.Group(); const w = M(0xffffff, 0.8, 0, wood('#7b5132', 4)); bx(g, 0.9, 1.6, 0.04, 0, 0.8, -0.14, w); for (const y of [0.05, 0.55, 1.05, 1.55]) bx(g, 0.9, 0.04, 0.32, 0, y, 0, w); for (const x of [-0.43, 0.43]) bx(g, 0.04, 1.6, 0.32, x, 0.8, 0, w); for (let s = 0; s < 3; s++) for (let i = 0; i < 9; i++) bx(g, 0.05, 0.3 + Math.random() * 0.08, 0.22, -0.36 + i * 0.08, 0.22 + s * 0.5, 0, M([0xb71c1c, 0x1565c0, 0x2e7d32, 0xf9a825, 0x4e342e][(i + s) % 5], 0.8)); return g; } },
  { id: 'mirror', name: 'Standing mirror', price: 14_000, blurb: 'Check yourself before you go out.', size: [0.5, 1.6, 0.1], actions: [{ id: 'look', label: 'Check yourself out', hint: '+Fun', gain: {}, minutes: 0, secs: 6, give: { fun: 8 }, clip: 'Idle_Loop', spot: [0, 0, 0.8] }],
    build() { const g = new THREE.Group(); bx(g, 0.5, 1.5, 0.05, 0, 0.85, 0, M(0x3e2723, 0.6)); bx(g, 0.42, 1.38, 0.01, 0, 0.85, 0.03, new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.02, metalness: 1 })); bx(g, 0.4, 0.04, 0.3, 0, 0.02, -0.1, M(0x3e2723, 0.6)); return g; } },
  { id: 'speaker', name: 'Bluetooth speaker', price: 22_000, blurb: 'Your playlist, the whole compound hears it.', size: [0.3, 0.45, 0.25], actions: [{ id: 'play', label: 'Play your music', hint: '+Fun +Social', gain: {}, minutes: 0, secs: 30, give: { fun: 22, social: 6 }, clip: 'Idle_Loop', spot: [0, 0, 0.7] }],
    build() { const g = new THREE.Group(); bx(g, 0.3, 0.45, 0.25, 0, 0.225, 0, M(0x212121, 0.5)); for (const y of [0.15, 0.33]) { const s = cy(g, 0.08, 0.08, 0.02, 0, y, 0.13, M(0x424242, 0.3)); s.rotation.x = Math.PI / 2; } return g; } },
  { id: 'ac', name: 'Split AC', price: 260_000, blurb: 'Cold room. Eats your units.', size: [0.9, 0.3, 0.25], actions: [{ id: 'cool', label: 'Turn on the AC', hint: '+Comfort (needs light)', gain: {}, minutes: 0, secs: 30, give: { comfort: 60, energy: 6 }, clip: 'Idle_Loop', spot: [0, 0, 1.2] }],
    build() { const g = new THREE.Group(); bx(g, 0.9, 0.3, 0.22, 0, 2.3, 0, M(0xf5f5f5, 0.4)); bx(g, 0.8, 0.03, 0.02, 0, 2.18, 0.11, M(0xbdbdbd, 0.4)); return g; } },
  { id: 'art', name: 'Wall art', price: 16_000, blurb: 'A painting from the Lekki art market.', size: [0.9, 0.7, 0.04], actions: [],
    build() { const g = new THREE.Group(); bx(g, 0.9, 0.65, 0.03, 0, 1.6, 0, M(0x3e2723, 0.6)); bx(g, 0.8, 0.55, 0.01, 0, 1.6, 0.02, M(0xffffff, 0.9, 0, ankara('#1f4e79', '#e0a526', 31))); return g; } },
];
for (const d of SHOP) if (!DEFS[d.id]) DEFS[d.id] = d;

class Decor {
  R!: RoomSave; private edit = false; private carry: { p: Placed; x: number; z: number; yaw: number; ok: boolean; was: [number, number, number] } | null = null;
  private keyH = (e: KeyboardEvent) => this.key(e); private applied: RoomSave | null = null; designerFor: string | null = null;
  constructor(private ctx: GameCtx) {}
  get L() { return lifeSystem.api; }
  init() {
    const s = this.ctx.save.room as RoomSave | undefined; this.R = s && s.v === 1 ? s : { v: 1, pos: {}, extra: [], wall: null, floor: null };
    registerApp('OjaHome', 'M4 10h16v10H4zM2 10l10-6 10 6M9 14h6', 'linear-gradient(160deg,#fb7185,#be123c)', () => this.html());
    addEventListener('keydown', this.keyH, true); (window as any).__decor = this;
  }
  start() {
    const L = this.L; if (!L) return; this.apply(this.R);
    L.selfItems.push(() => (L.S.inside && !L.venue && (!L.guest || this.designerFor) ? [...(this.carry ? [{ id: 'decor:turn', label: 'Turn it', hint: 'A quarter turn' }] : []), { id: 'decor:arrange', label: this.edit ? 'Finish arranging' : 'Arrange the room', hint: this.designerFor ? 'As their designer' : 'Move, turn, decorate' }] : []));
    L.selfPick.push((id) => { if (id === 'decor:arrange') this.toggleEdit(); if (id === 'decor:turn' && this.carry) this.turn(); });
    L.providers.push(() => this.things());
    L.onBegin.push((a) => { if (a.effect === 'lantern') this.lantern(); });
    net.on('room', (m: any) => this.remote(m));
  }
  private save() { this.ctx.save.room = this.R; this.ctx.persist(); }
  private pkey(p: Placed) { const same = this.L!.lot.placed.filter((q) => q.def === p.def); return `${p.def}:${same.indexOf(p)}`; }

  // ---------------------------------------------------------------- layout: build extras, move pieces, paint
  /** make the room look like `room` (yours, or the owner's while you visit) */
  apply(room: RoomSave) {
    const L = this.L; if (!L) return; const lot = L.lot; this.applied = room;
    // extras: remove the ones not in this layout, add the missing
    for (const p of [...lot.placed]) if ((p as any).uid && !room.extra.some((e) => e.uid === (p as any).uid)) this.removePiece(p);
    for (const e of room.extra) if (!lot.placed.some((p) => (p as any).uid === e.uid)) this.addPiece(e.def, e.x, e.z, e.yaw, e.uid);
    // base pieces: saved spots, or back to where the landlord left them
    for (const p of lot.placed) { if ((p as any).uid || !MOVABLE.has(p.def)) continue; const k = this.pkey(p); (p as any).home ??= [p.x, p.z, p.yaw]; const v = room.pos[k] ?? (p as any).home; this.move(p, v[0], v[1], v[2]); }
    for (const e of room.extra) { const p = lot.placed.find((q) => (q as any).uid === e.uid); if (p) this.move(p, e.x, e.z, e.yaw); }
    const m = lot.mats; if (m) {
      const wc = room.wall ?? '#9cc3d5'; if ((m.room as any)._c !== wc) { m.room.map = plaster(wc, 4); m.room.needsUpdate = true; (m.room as any)._c = wc; }
      const fl = room.floor ?? 'lino'; if ((m.floor as any)._f !== fl) { m.floor.map = fl === 'wood' ? wood('#8d6748', 9) : fl === 'tiles' ? tiles('#e8e2d6', '#c8bfae', 8) : fl === 'ankara' ? ankara('#7b2d26', '#d8a03a', 11) : lino(9); m.floor.map!.repeat.set(2, 2); m.floor.needsUpdate = true; (m.floor as any)._f = fl; }
    }
  }
  private addPiece(def: string, x: number, z: number, yaw: number, uid: string) {
    const L = this.L!; const d = DEFS[def]; if (!d) return; const o = d.build(); o.position.set(x, 0, z); o.rotation.y = yaw; L.lot.group.add(o);
    const p: Placed = { def, x, z, yaw, obj: o }; (p as any).uid = uid; L.lot.placed.push(p);
    if (d.solid && L.homeBody) { const col = this.ctx.sim.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(d.size[0] / 2, d.size[1] / 2, d.size[2] / 2).setTranslation(x, d.size[1] / 2, z).setCollisionGroups(groups(G.WORLD, 0xffff)), L.homeBody); L.furn.set(p, col); }
    return p;
  }
  private removePiece(p: Placed) { const L = this.L!; p.obj.removeFromParent(); L.lot.placed.splice(L.lot.placed.indexOf(p), 1); const col = L.furn.get(p); if (col) { this.ctx.sim.phys.world.removeCollider(col, true); L.furn.delete(p); } }
  private move(p: Placed, x: number, z: number, yaw: number) {
    p.x = x; p.z = z; p.yaw = yaw; p.obj.position.set(x, p.obj.position.y, z); p.obj.rotation.y = yaw;
    const col = this.L!.furn.get(p); if (col) { const d = DEFS[p.def]; const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw); col.setTranslationWrtParent({ x, y: d.size[1] / 2, z }); col.setRotationWrtParent({ x: q.x, y: q.y, z: q.z, w: q.w }); }
  }
  /** does a piece fit there: inside the room, not on top of another solid piece */
  private fits(p: Placed, x: number, z: number, yaw: number) {
    const d = DEFS[p.def]; const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)); const hw = (d.size[0] * c + d.size[2] * s) / 2, hd = (d.size[0] * s + d.size[2] * c) / 2;
    if (x - hw < ROOM.x0 || x + hw > ROOM.x1 || z - hd < ROOM.z0 || z + hd > ROOM.z1) return false;
    if (p.def === 'rug' || p.def === 'poster' || p.def === 'art' || p.def === 'ac') return true; // floor and wall things go anywhere in the room
    for (const q of this.L!.lot.placed) {
      if (q === p || !MOVABLE.has(q.def) || q.def === 'rug' || q.def === 'poster' || q.def === 'art' || q.def === 'ac') continue; const e = DEFS[q.def];
      const c2 = Math.abs(Math.cos(q.yaw)), s2 = Math.abs(Math.sin(q.yaw)); const qw = (e.size[0] * c2 + e.size[2] * s2) / 2, qd = (e.size[0] * s2 + e.size[2] * c2) / 2;
      if (Math.abs(x - q.x) < hw + qw - 0.02 && Math.abs(z - q.z) < hd + qd - 0.02) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- arranging
  private toggleEdit() {
    this.edit = !this.edit; if (!this.edit && this.carry) this.drop(true);
    this.ctx.hud.help?.(this.edit ? 'Arranging: walk to a piece and press E to lift it. R turns it, E puts it down, Esc puts it back. Z to finish.' : null);
    if (!this.edit) this.ctx.hud.toast('Room', 'Done arranging.', 'linear-gradient(160deg,#fb7185,#be123c)', 'msg', 2.5);
  }
  private things(): Thing[] {
    const L = this.L; if (!L || !this.edit || !L.S.inside) return [];
    const O = L.lot.group.position; const out: Thing[] = [];
    if (this.carry) { const me = this.ctx.sim.local; out.push({ id: 'drop', name: 'Put it here', x: me.pos.x, z: me.pos.z, yaw: 0, actions: [], kind: 'object', reach: 3, verb: this.carry.ok ? 'Put it here' : 'It does not fit here', open: () => this.drop(false) }); return out; }
    for (const p of L.lot.placed) if (MOVABLE.has(p.def)) out.push({ id: 'lift', name: DEFS[p.def].name, x: O.x + p.x, z: O.z + p.z, yaw: p.yaw, actions: [], kind: 'object', reach: 1.8, verb: `Lift the ${DEFS[p.def].name.toLowerCase()}`, open: () => this.lift(p) });
    return out;
  }
  private lift(p: Placed) { this.carry = { p, x: p.x, z: p.z, yaw: p.yaw, ok: true, was: [p.x, p.z, p.yaw] }; const col = this.L!.furn.get(p); col?.setEnabled?.(false); }
  private turn() { if (this.carry) this.carry.yaw += Math.PI / 2; }
  private drop(cancel: boolean) {
    const k = this.carry; if (!k) return; const L = this.L!; this.carry = null;
    const [x, z, yaw] = cancel || !k.ok ? k.was : [k.x, k.z, k.yaw]; this.move(k.p, x, z, yaw); L.furn.get(k.p)?.setEnabled?.(true); this.tint(k.p, null);
    if (cancel || !k.ok) { if (!cancel) this.ctx.hud.toast('Room', 'It does not fit there. Put back.', 'var(--red)', 'msg', 2.5); return; }
    this.record(k.p);
  }
  /** keep the new spot: in your own save, or (as a designer) send it to the owner */
  private record(p: Placed) {
    const target = this.applied ?? this.R; const uid = (p as any).uid as string | undefined;
    if (uid) { const e = target.extra.find((q) => q.uid === uid); if (e) { e.x = p.x; e.z = p.z; e.yaw = p.yaw; } } else target.pos[this.pkey(p)] = [p.x, p.z, p.yaw];
    if (this.designerFor) { void net.act('room.edit', { room: target }); career.add('designer', 0.2); return; }
    if (target === this.R) { this.save(); if (net.active) void net.act('room.edit', { room: this.R }); const L = this.L!; addMoodlet(L.needs, 'tidy', 'Room the way you like it', 4, 8); }
  }
  private tint(p: Placed, ok: boolean | null) { p.obj.traverse((o: any) => { if (!o.isMesh || !o.material?.emissive) return; if (ok === null) { if (o.userData._e !== undefined) { o.material.emissive.setHex(o.userData._e); delete o.userData._e; } return; } if (o.userData._e === undefined) o.userData._e = o.material.emissive.getHex(); o.material.emissive.setHex(ok ? 0x0f5132 : 0x6b0f1a); }); }
  private key(e: KeyboardEvent) {
    if (!this.carry) return;
    if (e.code === 'KeyR') { this.turn(); e.preventDefault(); e.stopPropagation(); }
    if (e.code === 'Escape') { this.drop(true); e.preventDefault(); e.stopPropagation(); }
  }
  frame() {
    const k = this.carry; if (!k) return; const L = this.L; if (!L || !L.S.inside) { this.drop(true); return; }
    const me = this.ctx.sim.local; const O = L.lot.group.position; const ahead = 1.0 + DEFS[k.p.def].size[2] / 2;
    const x = Math.round((me.pos.x - O.x + Math.sin(me.yaw) * ahead) * 10) / 10, z = Math.round((me.pos.z - O.z + Math.cos(me.yaw) * ahead) * 10) / 10;
    k.x = x; k.z = z; k.ok = this.fits(k.p, x, z, k.yaw); k.p.obj.position.set(x, k.p.obj.position.y, z); k.p.obj.rotation.y = k.yaw; this.tint(k.p, k.ok);
  }
  private lantern() { const L = this.L; const p = L?.lot.placed.find((q) => q.def === 'lantern'); if (!p) return; const l = p.obj.getObjectByName('lamp') as THREE.PointLight | undefined; const g = p.obj.getObjectByName('glow') as THREE.Mesh | undefined; const on = !(l && l.intensity > 0); if (l) l.intensity = on ? 5.5 : 0; if (g) (g.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.4 : 0; }

  // ---------------------------------------------------------------- visiting and designers
  /** the room layout to send with an invite */
  layout() { return this.R; }
  /** visiting: show the owner's layout; leaving: your own again */
  showOwner(room: RoomSave | null, designer: boolean) { this.designerFor = designer && room ? 'owner' : null; this.apply(room ?? this.R); if (!room) { this.edit = false; this.carry = null; } }
  /** a designer moved something in my room (or the owner's room I am visiting): apply, and keep it if it is mine */
  private remote(m: { room: RoomSave; by: string; mine: boolean }) {
    if (!m.room || m.room.v !== 1) return; this.apply(m.room);
    if (m.mine) { this.R = m.room; this.save(); this.ctx.hud.toast('Designer', `${m.by} rearranged your room.`, 'linear-gradient(160deg,#fb7185,#be123c)', 'msg', 3); }
  }

  // ---------------------------------------------------------------- the OjaHome app
  private html() {
    const own = (id: string) => this.R.extra.some((e) => e.def === id);
    const items = SHOP.map((d) => `<div class="row"><b>${d.name} · ₦${d.price.toLocaleString()}</b>${d.blurb}${own(d.id) ? ' <span style="opacity:.6">(you have one)</span>' : ''}<br><button class="btn" data-app="OjaHome" data-id="buy:${d.id}">Buy and deliver</button></div>`).join('');
    const walls = WALLS.map(([c, n, p]) => `<button class="btn" data-app="OjaHome" data-id="wall:${c}" style="border-left:14px solid ${c}">${n}${p ? ` ₦${p / 1000}k` : ''}</button>`).join(' ');
    const floors = FLOORS.map(([f, n, p]) => `<button class="btn" data-app="OjaHome" data-id="floor:${f}">${n}${p ? ` ₦${p / 1000}k` : ''}</button>`).join(' ');
    return `<div class="row"><b>Paint the walls</b>${walls}</div><div class="row"><b>The floor</b>${floors}</div>${items}<div class="row"><b>Arrange it yourself</b>At home, press Z and choose Arrange the room. Or invite a player as your interior designer.</div>`;
  }
  onAction(app: string, id: string) {
    if (app !== 'OjaHome') return false; const c = this.ctx; const L = this.L; if (!L) return true;
    const [op, arg] = [id.split(':')[0], id.slice(id.indexOf(':') + 1)];
    if (op === 'buy') { const d = SHOP.find((x) => x.id === arg)!; if (!spend(c, d.price)) { c.hud.toast('OjaHome', 'Payment declined.', 'var(--red)', 'cash', 3); return true; }
      // delivered to a free spot in your room
      let spot: [number, number] = [2.8, 5.2]; const tmp: Placed = { def: d.id, x: 0, z: 0, yaw: 0, obj: new THREE.Group() };
      for (let k = 0; k < 40; k++) { const x = ROOM.x0 + 0.4 + Math.random() * (ROOM.x1 - ROOM.x0 - 0.8), z = ROOM.z0 + 0.4 + Math.random() * (ROOM.z1 - ROOM.z0 - 0.8); if (this.fits(tmp, x, z, 0)) { spot = [x, z]; break; } }
      this.R.extra.push({ uid: `${d.id}-${Date.now().toString(36)}`, def: d.id, x: spot[0], z: spot[1], yaw: 0 }); if (!L.guest) this.apply(this.R); this.save();
      c.hud.toast('OjaHome', `${d.name} delivered to your room. Z at home to arrange it.`, 'linear-gradient(160deg,#fb7185,#be123c)', 'cash', 4); return true; }
    if (op === 'wall' || op === 'floor') { const row = (op === 'wall' ? WALLS : FLOORS).find((r) => r[0] === arg)!; if (row[2] && !spend(c, row[2])) { c.hud.toast('OjaHome', 'Payment declined.', 'var(--red)', 'cash', 3); return true; }
      if (op === 'wall') this.R.wall = arg; else this.R.floor = arg; if (!L.guest) this.apply(this.R); this.save(); addMoodlet(L.needs, 'decor', 'New look at home', 6, 12);
      c.hud.toast('OjaHome', op === 'wall' ? 'The painter has done your walls.' : 'New floor laid.', 'linear-gradient(160deg,#fb7185,#be123c)', 'msg', 3.5); return true; }
    return true;
  }
}
let D: Decor | null = null;
export const decorSystem: GameSystem & { get api(): Decor | null } = {
  id: 'decor', get api() { return D; },
  init(ctx) { D = new Decor(ctx); D.init(); }, start() { D?.start(); }, frame() { D?.frame(); },
  onAction(_c, app, id) { return D?.onAction(app, id) ?? false; },
};
