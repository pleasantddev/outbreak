// The Golden Palm casino: blackjack, roulette and slots, a bar, a cashier cage, bouncers at the door.
import * as THREE from 'three';
import type { GameCtx } from '../registry';
import type { Actor } from '../../sim/types';
import type { Venue } from '../life/venue';
import type { Thing } from '../life/index';
import { addMoodlet } from '../life/needs';
import { Builder, canvasTex, M, box, cyl } from './build';
import { CasinoGames } from './games';
import { sfx } from './sfx';

export const CASINO_ORIGIN = new THREE.Vector3(32000, 0, 36000);

function carpet() {
  return canvasTex(256, 256, (x) => {
    x.fillStyle = '#5a0f1c'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const cx = i * 64 + 32, cy = j * 64 + 32; x.strokeStyle = '#c9a227'; x.lineWidth = 3; x.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const r = k % 2 ? 12 : 26; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } x.closePath(); x.stroke(); x.fillStyle = '#1c3d6e'; x.beginPath(); x.arc(cx, cy, 6, 0, Math.PI * 2); x.fill(); }
    x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 1; for (let i = 0; i < 256; i += 8) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke(); }
  }, 6);
}
function felt(col = '#0f6b4b') { return canvasTex(256, 128, (x) => { x.fillStyle = col; x.fillRect(0, 0, 256, 128); x.strokeStyle = '#ffe082'; x.lineWidth = 2; x.beginPath(); x.arc(128, 0, 100, 0.25, Math.PI - 0.25); x.stroke(); x.fillStyle = 'rgba(255,224,130,.8)'; x.font = '700 12px Rajdhani'; x.textAlign = 'center'; x.fillText('BLACKJACK PAYS 3 TO 2', 128, 70); }); }

export function buildCasino(): { venue: Omit<Venue, 'things'>; seats: { id: string; game: 'blackjack' | 'roulette' | 'slots' | 'bar'; x: number; z: number; yaw: number; label: string }[]; staff: { x: number; z: number; yaw: number; role: string; clip: string }[] } {
  const B = new Builder(CASINO_ORIGIN); const W = 11, D = 16;
  B.floor(-W, 0, W, D, M(0xffffff, 0.95, { map: carpet() }));
  B.floor(-3, -3, 3, 0, M(0x2b2b2b, 0.6)); // entrance mat
  const wallM = M(0x1d1420, 0.85); const goldM = M(0xc9a227, 0.35, { metalness: 0.8 });
  B.room(-W, 0, W, D, wallM, { side: 's', at: W, w: 2.4 });
  for (const z of [0.02, D - 0.02]) B.neon(0, 3.1, z + (z < 1 ? 0.08 : -0.08), 2 * W - 0.4, 0.05, 0xffc93c);
  B.neon(-W + 0.08, 3.1, D / 2, 0.05, 0.05, 0xffc93c).scale.set(1, 1, 1);
  B.sign('GOLDEN PALM', 0, 2.55, D - 0.1, Math.PI, 6, '#ffd54f');
  // blackjack tables
  const seats: ReturnType<typeof buildCasino>['seats'] = []; const staff: ReturnType<typeof buildCasino>['staff'] = [];
  const bj = (x: number, z: number) => {
    const t = new THREE.Group(); t.position.set(x, 0, z);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.1, 32, 1, false, -Math.PI / 2, Math.PI), M(0xffffff, 0.9, { map: felt() })); top.position.y = 0.86; top.rotation.y = Math.PI; t.add(top);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.06, 8, 32, Math.PI), M(0x3b2414, 0.5)); rail.rotation.x = -Math.PI / 2; rail.rotation.z = Math.PI; rail.position.y = 0.92; t.add(rail);
    t.add(box(2.8, 0.1, 0.12, M(0x3b2414, 0.5), 0, 0.88, 0)); t.add(cyl(0.35, 0.45, 0.82, M(0x2b1a10, 0.6), 0, 0.41, -0.4));
    for (let i = 0; i < 4; i++) { const c = cyl(0.03, 0.03, 0.04 + (i % 2) * 0.03, M([0xe53935, 0x1e88e5, 0x43a047, 0x212121][i], 0.4), -0.6 + i * 0.12, 0.93, 0.15, 12); t.add(c); }
    B.solid(t, 2.9, 1.5, 0.9); const lamp = B.light(x, 2.6, z - 0.5, 0xfff1c9, 6, 5);
    void lamp;
    for (let i = 0; i < 3; i++) { const a = -0.9 + i * 0.9; const sx = x + Math.sin(a) * 1.85, sz = z - Math.cos(a) * 1.85; const st = cyl(0.22, 0.18, 0.06, M(0x7b1f1f, 0.6), sx, 0.62, sz); B.add(st); B.add(cyl(0.04, 0.04, 0.6, goldM, sx, 0.3, sz, 8)); if (i === 1) seats.push({ id: 'bj' + x, game: 'blackjack', x: sx, z: sz, yaw: a, label: 'Blackjack table' }); }
    staff.push({ x, z: z + 0.55, yaw: Math.PI, role: 'Dealer', clip: 'Idle_Loop' });
  };
  bj(-6, 6); bj(-6, 11.2);
  // roulette
  { const t = new THREE.Group(); t.position.set(1.5, 0, 9); t.add(box(3.6, 0.1, 1.5, M(0x0f6b4b, 0.9), 0, 0.86, 0)); t.add(box(3.7, 0.08, 1.6, M(0x3b2414, 0.5), 0, 0.8, 0)); t.add(box(3.2, 0.8, 1.1, M(0x2b1a10, 0.6), 0, 0.4, 0));
    const wheel = new THREE.Group(); wheel.position.set(-1.25, 0.95, 0); const bowl = cyl(0.5, 0.42, 0.14, M(0x4e2a12, 0.4), 0, 0, 0, 37); wheel.add(bowl);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 37), new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (x) => { for (let i = 0; i < 37; i++) { x.beginPath(); x.moveTo(128, 128); x.arc(128, 128, 128, (i / 37) * Math.PI * 2, ((i + 1) / 37) * Math.PI * 2); x.fillStyle = i === 0 ? '#2e7d32' : i % 2 ? '#c62828' : '#151515'; x.fill(); } x.fillStyle = '#c9a227'; x.beginPath(); x.arc(128, 128, 40, 0, Math.PI * 2); x.fill(); }), roughness: 0.4 })); disc.position.y = 0.075; disc.name = 'spin'; wheel.add(disc); t.add(wheel);
    t.add(box(2.0, 0.005, 0.9, M(0xffffff, 0.9, { map: canvasTex(256, 96, (x) => { x.fillStyle = '#0f6b4b'; x.fillRect(0, 0, 256, 96); for (let i = 0; i < 36; i++) { const c = i % 12, r = (i / 12) | 0; x.fillStyle = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(i + 1) ? '#b71c1c' : '#111'; x.fillRect(8 + c * 20, 8 + r * 26, 18, 24); x.fillStyle = '#fff'; x.font = '700 11px Rajdhani'; x.fillText(String(i + 1), 12 + c * 20, 25 + r * 26); } }) }), 0.45, 0.915, 0));
    B.solid(t, 3.7, 1.6, 0.9); B.light(1.5, 2.6, 9, 0xfff1c9, 7, 5);
    seats.push({ id: 'roulette', game: 'roulette', x: 1.9, z: 7.6, yaw: 0, label: 'Roulette' }); staff.push({ x: 1.5, z: 10.25, yaw: Math.PI, role: 'Croupier', clip: 'Idle_Loop' });
    (B.g as any).userData.wheel = disc;
  }
  // slots along the east wall
  for (let i = 0; i < 7; i++) {
    const z = 2.6 + i * 1.6; const m = new THREE.Group(); m.position.set(W - 0.55, 0, z); m.rotation.y = -Math.PI / 2;
    m.add(box(0.9, 1.5, 0.6, M(0x2a2a3a, 0.4, { metalness: 0.6 }), 0, 0.75, 0)); const scr = box(0.62, 0.42, 0.02, new THREE.MeshBasicMaterial({ color: [0xff5252, 0x40c4ff, 0xffd740, 0x69f0ae][i % 4], toneMapped: false }), 0, 1.15, 0.31); scr.name = 'scr'; m.add(scr);
    m.add(box(0.9, 0.22, 0.5, new THREE.MeshBasicMaterial({ color: 0xffc93c, toneMapped: false }), 0, 1.62, 0.02)); m.add(cyl(0.02, 0.02, 0.4, goldM, 0.5, 1.05, 0.1, 6));
    B.solid(m, 0.6, 0.9, 1.6); seats.push({ id: 'slot' + i, game: 'slots', x: W - 1.45, z, yaw: Math.PI / 2, label: 'Slot machine' });
  }
  // bar
  { const bar = new THREE.Group(); bar.position.set(-6.5, 0, 1.6); bar.add(box(5, 1.05, 0.7, M(0x3b2414, 0.4), 0, 0.52, 0)); bar.add(box(5.1, 0.06, 0.8, M(0x111111, 0.2, { metalness: 0.4 }), 0, 1.07, 0)); B.solid(bar, 5, 0.7, 1.1);
    const shelf = new THREE.Group(); shelf.position.set(-6.5, 0, 0.2); for (let r = 0; r < 3; r++) { shelf.add(box(4.6, 0.04, 0.25, goldM, 0, 1.3 + r * 0.45, 0)); for (let i = 0; i < 12; i++) shelf.add(cyl(0.04, 0.045, 0.3, M([0x6d4c41, 0x1b5e20, 0xb71c1c, 0xe0e0e0][(i + r) % 4], 0.15, { transparent: true, opacity: 0.85 }), -2.1 + i * 0.38, 1.47 + r * 0.45, 0, 8)); } B.add(shelf);
    B.neon(-6.5, 3.0, 0.1, 4.6, 0.05, 0xff3dbb); B.light(-6.5, 2.5, 1.4, 0xff7ad9, 5, 6);
    seats.push({ id: 'bar', game: 'bar', x: -6.5, z: 2.6, yaw: Math.PI, label: 'The bar' }); staff.push({ x: -6.5, z: 0.95, yaw: 0, role: 'Barman', clip: 'Idle_Loop' });
  }
  // cashier cage
  { const cage = new THREE.Group(); cage.position.set(6.5, 0, 14.6); cage.add(box(3.6, 1.1, 0.6, M(0x3b2414, 0.4), 0, 0.55, 0)); for (let i = 0; i < 10; i++) cage.add(box(0.03, 1.4, 0.03, goldM, -1.7 + i * 0.38, 1.8, 0.25)); B.solid(cage, 3.6, 0.6, 2.5); staff.push({ x: 6.5, z: 15.3, yaw: Math.PI, role: 'Cashier', clip: 'Idle_Loop' }); }
  staff.push({ x: -1.9, z: 0.9, yaw: Math.PI, role: 'Bouncer', clip: 'Idle_FoldArms_Loop' }, { x: 1.9, z: 0.9, yaw: Math.PI, role: 'Bouncer', clip: 'Idle_FoldArms_Loop' });
  // chandeliers and fill light
  for (const [x, z] of [[-4, 4], [4, 4], [-4, 11], [4, 11], [0, 7.5]]) { B.add(cyl(0.4, 0.15, 0.3, new THREE.MeshBasicMaterial({ color: 0xfff3c4, toneMapped: false }), x, 3.15, z, 12)); B.light(x, 2.9, z, 0xffe0a8, 5, 9); }
  const lot = B.lot({ x: 0, z: 1.6, yaw: 0 }, [{ name: 'Casino floor', x0: -W, z0: 0, x1: W, z1: D }], 0x2a0d12);
  return { venue: { id: 'casino', title: 'GOLDEN PALM', sub: 'Casino and lounge · 18+ in spirit, 16+ in game', lot, door: null, blip: '#ffc93c', label: 'Enter the casino', fee: 0, cam: { d: 10.5, pitch: 0.95 } }, seats, staff };
}

export class Casino {
  games: CasinoGames; venue: Venue; seats: ReturnType<typeof buildCasino>['seats']; staff: ReturnType<typeof buildCasino>['staff'];
  private people: Actor[] = []; private streak = 0; private wheel: THREE.Object3D | null;
  constructor(private ctx: GameCtx, private life: { needs: any; doAction: (a: any) => void; ui: any }) {
    const b = buildCasino(); this.seats = b.seats; this.staff = b.staff; this.wheel = (b.venue.lot.group as any).userData.wheel ?? null;
    this.venue = { ...b.venue, things: () => this.things(), enter: () => this.enter(), exit: () => this.exit(), frame: (dt) => this.frame(dt), refuse: () => this.refuse() };
    this.games = new CasinoGames({ get: () => ctx.sim.cash, add: (n) => { ctx.sim.cash += n; ctx.sim.events.push({ t: 'cash', actor: ctx.sim.local.id, amount: n } as any); } }, (g, r) => this.result(g, r));
    this.games.setSfx(sfx);
  }
  private refuse() { const h = this.ctx.view.atmo.hour; if (h >= 6 && h < 14) return 'Golden Palm opens 2pm till 6am.'; if (this.ctx.sim.wanted >= 2) return 'Bouncer: "Police dey find you. Go away."'; return null; }
  private things(): Thing[] {
    const O = CASINO_ORIGIN; return this.seats.map((s) => ({ id: 'casino:' + s.id, name: s.label, x: O.x + s.x, z: O.z + s.z, yaw: s.yaw, actions: [], kind: 'object' as const, reach: 1.8, verb: s.game === 'bar' ? 'Order a drink' : `Play ${s.game}`, open: () => this.use(s.game) }));
  }
  private use(g: string) {
    const c = this.ctx; if (g === 'bar') { if (c.sim.cash < 1500) { c.hud.toast('Bar', 'Cocktail na ₦1,500.', 'var(--red)', 'cash'); return; } c.sim.cash -= 1500; this.life.needs.v.fun = Math.min(100, this.life.needs.v.fun + 10); this.life.needs.v.bladder = Math.max(0, this.life.needs.v.bladder - 10); this.life.doAction({ id: 'drink', label: 'Chapman at the bar', gain: { social: 30, fun: 20 }, minutes: 15, clip: 'Consume', spot: [0, 0, 0], moodlet: ['lounge', 'Feeling classy', 5, 3] }); return; }
    c.setModal(true); c.input.releasePointer(); const close = () => c.setModal(false);
    if (g === 'blackjack') this.games.blackjack(close); else if (g === 'roulette') this.games.roulette(close); else this.games.slots(close);
  }
  private result(_g: string, r: { net: number; big?: boolean }) {
    const n = this.life.needs; n.v.fun = Math.min(100, n.v.fun + 3);
    this.streak = r.net < 0 ? Math.min(0, this.streak) - 1 : r.net > 0 ? Math.max(0, this.streak) + 1 : this.streak;
    if (r.big) { addMoodlet(n, 'bigwin', 'Won big at the casino', 15, 6); this.ctx.hud.title('BIG WIN', '', 2.5); }
    if (this.streak <= -5) { addMoodlet(n, 'chasing', 'Chasing losses', -10, 4); if (this.streak === -5) this.ctx.hud.toast('Small advice', 'Five losses straight. The house always wins in the end. Maybe go home.', 'linear-gradient(160deg,#fb923c,#c2410c)', 'msg', 5); }
    if (this.streak >= 3) addMoodlet(n, 'hot', 'On a hot streak', 8, 2);
  }
  private enter() {
    const c = this.ctx; const O = CASINO_ORIGIN; this.people = [];
    for (const s of this.staff) { const lk = c.sim.randomLook(); if (s.role === 'Bouncer') Object.assign(lk, { body: 'male', top: 'tee', topPattern: 'solid', topColor: '#141414', pantsColor: '#141414', model: 'rogue' }); else Object.assign(lk, { topPattern: 'solid', topColor: s.role === 'Barman' ? '#f5f5f5' : '#7b1f1f', topAccent: '#141414' });
      const a = c.sim.spawnActor('vendor', { x: O.x + s.x, y: 0.05, z: O.z + s.z }, lk, s.role); a.yaw = s.yaw; Object.assign(a as any, { _script: true, _keep: true, _vendor: true, act: { clip: s.clip, yaw: s.yaw } }); this.people.push(a); }
    // punters at the tables and machines
    const spots = this.seats.filter((s) => s.game !== 'bar').sort(() => Math.random() - 0.5).slice(0, 6);
    for (const s of spots) { const a = c.sim.spawnActor('ped', { x: O.x + s.x + (Math.random() - 0.5) * 0.6, y: 0.05, z: O.z + s.z }, undefined, undefined); a.yaw = s.yaw; Object.assign(a as any, { _script: true, _keep: true, act: { clip: Math.random() < 0.5 ? 'Idle_Loop' : 'Idle_FoldArms_Loop', yaw: s.yaw } }); this.people.push(a); }
    sfx('ambCasino');
  }
  private exit() { for (const a of this.people) if (!(a as any)._gone) this.ctx.sim.removeActor(a); this.people = []; sfx('ambStop'); }
  private frame(dt: number) { if (this.wheel) this.wheel.rotation.y += dt * 0.6; }
}
