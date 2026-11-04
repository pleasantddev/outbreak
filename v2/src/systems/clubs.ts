// The three parody clubs in the open world (world/clubs.ts builds them): work the decks and play from a Naija crate
// streamed from Audius, cleared player songs and our own house grooves; work a pole stage (athletic, clothed, paid by
// the house); buy a drink; spray money on whoever is working; shut the whole club down. The Clubs phone app shows what
// is on tonight, and My Music lets you upload songs you own and pay to put them in club rotation. At night a bouncer
// works every door: cover for a wristband, staff walk in free to work, nobody gets in wearing underwear. VIP tables
// come with bottle service and your name on the table. Online the server
// decides everything (server/src/clubs.ts); offline the same numbers run on the save so single player still works.
import * as THREE from 'three';
import type { GameCtx, GameSystem, GoalPoint } from './registry';
import { net } from '../net/client';
import type { ClubView } from '../net/protocol';
import { CLUBS, type ClubDef } from '../world/clubs';
import { registerApp } from '../ui/lifeHud';
import { lifeSystem, type Thing } from './life';
import { addMoodlet } from './life/needs';
import { earn, spend } from './money';
import { payApi } from './pay';
import { Overlay, h, addCss } from './featureKit';
import { clubMix } from './leisure/sfx';
import {
  AUDIUS_APP, AUDIUS_QUERIES, CLUB_RULES, DECK_REACH, HOUSE_SET, POLE_REACH, PROMO_DAYS, SHUTDOWN_MIN, SONG_MAX_BYTES, SONG_MAX_SECS, SONG_MIN_SECS, SPRAY_NOTES,
  clubHours, dayCap, isClubNight, isClub, promoQuote, shiftPay, type ClubId, type ClubTrack,
  BOTTLE_GAP_MS, BOTTLE_PRICE, COVER, DRESS_CODE, NO_BAND, VIP_MIN, VIP_PRICE, coverFor, nightOf, type PassKind,
} from '../net/clubs';

interface Crate { src: ClubTrack['src']; id: string; title: string; artist: string; secs: number; promo?: boolean; owner?: string | null }
interface MySong { id: string; title: string; artist: string; secs: number; status: string; note: string | null; plays: number; url: string; promos: { club: string; until: number }[] }
interface Shift { club: ClubId; job: 'dj' | 'pole'; key: string; since: number; earned: number }
const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
const short = (n: number) => n >= 1e6 ? `₦${+(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `₦${Math.round(n / 1e3)}k` : naira(n);
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const GRAD = 'linear-gradient(160deg,#ff4fd8,#3b0764)';
const HEAR = 48; // metres: how far the music carries
const CSS = `
.cl-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.cl-tabs button{font:700 12.5px Inter;border:1px solid var(--line);background:rgba(255,255,255,.06);color:#fff;border-radius:999px;padding:7px 12px;cursor:pointer}
.cl-tabs button.on{background:linear-gradient(180deg,#ff4fd8,#a21caf);border-color:transparent}
.cl-now{display:flex;align-items:center;gap:12px;padding:12px;border-radius:16px;background:linear-gradient(120deg,rgba(255,79,216,.18),rgba(59,7,100,.35));border:1px solid rgba(255,79,216,.35);margin-bottom:12px}
.cl-now .disc{width:46px;height:46px;border-radius:50%;background:radial-gradient(circle,#ff4fd8 0 18%,#111 19% 100%);box-shadow:0 0 0 3px rgba(255,255,255,.08);animation:clspin 2.4s linear infinite;flex:none}
@keyframes clspin{to{transform:rotate(360deg)}}
.cl-now b{display:block;font-size:15px}.cl-now span{font-size:12px;color:var(--mut)}
.cl-list{display:flex;flex-direction:column;gap:6px;max-height:min(46vh,420px);overflow:auto}
.cl-tr{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--line)}
.cl-tr .t{flex:1;min-width:0}.cl-tr .t b{display:block;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cl-tr .t span{font-size:11.5px;color:var(--mut)}
.cl-tr.on{border-color:#ff4fd8}
.cl-notes{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.cl-who{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.cl-who button{text-align:left}
`;

class ClubsLife {
  views = new Map<ClubId, ClubView>();
  shift: Shift | null = null;
  target: GoalPoint | null = null;
  private audio: HTMLAudioElement | null = null; private audioKey = ''; private failed = new Set<string>(); private blobs = new Map<string, string>();
  private crate: { audius: Crate[]; cleared: Crate[]; mine: MySong[]; loaded: number; audiusErr: boolean } = { audius: [], cleared: [], mine: [], loaded: 0, audiusErr: false };
  private panel: Overlay | null = null; private tab: 'naija' | 'cleared' | 'mine' | 'house' = 'naija'; private q = '';
  private npcs = new Map<ClubId, { list: any[]; dj: any | null; poles: Map<string, any> }>();
  private fx: { group: THREE.Group; notes: { m: THREE.Mesh; v: THREE.Vector3; t: number }[] } | null = null;
  private lamps: THREE.PointLight[] = [];
  private seenShutdown = new Set<string>(); private payT = 0; private tickT = 0; private app: { s: 'home' } | { s: 'music' } = { s: 'home' }; private said = '';
  private upload: { file: File | null; title: string; artist: string; attest: boolean; busy: boolean } = { file: null, title: '', artist: '', attest: false, busy: false };
  private promoPick = new Map<string, { club: ClubId | 'all'; days: number }>();
  /** wristbands this Lagos night, online as the server said, offline on the save */
  private bands = new Map<string, PassKind>();
  private fading: { a: HTMLAudioElement; v: number } | null = null; private fadeIn = 1; private baseVol = 0;
  private bounced = 0; private bouncers = new Map<ClubId, any>();
  constructor(private ctx: GameCtx) {}
  get life() { return lifeSystem.api; }
  /** the offline save: shifts paid today and a DJ's last song */
  private get S(): { paid: Record<string, number>; track: Record<string, ClubTrack | null>; bands?: Record<string, PassKind>; vip?: Record<string, { club: ClubId; table: string; until: number; last: number }> } { return ((this.ctx.save as any).clubs ??= { paid: {}, track: {} }); }
  private now() { return net.active ? net.epochNow : Date.now(); }

  init() {
    addCss('clubs', CSS);
    registerApp('Clubs', '', '', () => this.appHtml());
    this.ctx.hud.appBack['Clubs'] = () => { if (this.app.s !== 'home') { this.app = { s: 'home' }; return true; } return false; };
    new MutationObserver(() => this.wire()).observe(document.getElementById('av-l') ?? document.body, { childList: true });
    for (const c of CLUBS) if (isClub(c.id)) this.views.set(c.id, { id: c.id, dj: null, poles: {}, track: null, shutdown: null, crowd: 0 });
    (window as any).__clubs = this;
  }
  start() {
    this.life?.providers.push(() => this.things());
    const take = (list: ClubView[] | undefined) => { for (const v of list ?? []) if (isClub(v.id)) this.views.set(v.id, v); this.syncShift(); };
    take((net.welcome as any)?.clubs);
    net.on('welcome', (w: any) => take(w?.clubs));
    net.on('club', (m: any) => { if (m?.club && isClub(m.club.id)) { this.views.set(m.club.id, m.club); this.syncShift(); this.redraw(); } });
    net.on('spray', (m: any) => this.burst(m.club, m.toId, m.amount));
    net.on('clubfx', (m: any) => { if (!isClub(m?.club)) return; const t = this.def(m.club).vip.find((v) => v.id === m.table); if (t) this.sparkle(m.club, t); if (m.kind === 'vip' && this.nearest()?.d! < 40) this.ctx.hud.toast(CLUB_RULES[m.club as ClubId].short, `${m.name} just took a VIP table. Bottles dey come.`, GRAD, 'msg', 3); });
    // two coloured lights follow you into whichever club you are in, so people on the floor are not black shapes
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffffff, 0, 24, 1.4); this.lamps.push(l); this.ctx.view.scene.add(l); }
  }
  private light() {
    const near = this.nearest(); const on = !!near && near.d < 40;
    this.lamps.forEach((l, i) => {
      if (!on) { l.intensity = 0; return; } const c = near!.c; const f = c.floor; const s = Math.sin(f.yaw), co = Math.cos(f.yaw); const lu = (i ? 1 : -1) * f.w * 0.25;
      l.position.set(f.x + co * lu, f.y + 4.2, f.z - s * lu); l.color.set(i ? c.palette.neon : c.palette.accent); l.intensity = 9;
    });
  }
  private redraw() { if (this.panel?.isOpen) this.drawPanel(); if (this.ctx.hud.appOpen === 'Clubs') this.ctx.hud.refreshApp(); }
  /** the server ended our shift (walked off, logged in elsewhere): drop the dance */
  private syncShift() {
    if (!net.active || !this.shift) return; const v = this.views.get(this.shift.club); const me = net.account?.id;
    const still = this.shift.job === 'dj' ? v?.dj?.id === me : v?.poles[this.shift.key]?.id === me;
    if (!still) this.stopShift(false);
  }

  // ------------------------------------------------------------------------------------------ where things are
  private def(id: ClubId) { return CLUBS.find((c) => c.id === id)!; }
  private roofOk(c: ClubDef, y: number) { return c.kind !== 'rooftop' || Math.abs(y - (c.roofY ?? 0)) < 8; }
  /** the club the player is in or next to, and how far from the floor */
  private nearest(): { c: ClubDef; d: number } | null {
    const me = this.ctx.sim.local.pos; let best: { c: ClubDef; d: number } | null = null;
    for (const c of CLUBS) { if (!isClub(c.id)) continue; const dy = c.kind === 'rooftop' ? Math.abs(me.y - (c.roofY ?? 0)) : 0; const d = Math.hypot(me.x - c.floor.x, me.z - c.floor.z, dy > 6 ? dy : 0); if (!best || d < best.d) best = { c, d }; }
    return best;
  }
  private things(): Thing[] {
    const me = this.ctx.sim.local.pos; const out: Thing[] = []; const mine = net.account?.id ?? 'me';
    for (const c of CLUBS) {
      if (!isClub(c.id)) continue; const id = c.id as ClubId;
      // the lift to ORUN: lobby door at the foot of the tower, and the top of the lift on the deck
      if (c.kind === 'rooftop' && c.lift) {
        if (Math.hypot(me.x - c.door.x, me.z - c.door.z) < 6 && me.y < 10) out.push({ id: `club:${id}:up`, name: 'Lift', x: c.door.x, z: c.door.z, yaw: 0, actions: [], kind: 'object', reach: 3, verb: `Take the lift up to ${CLUB_RULES[id].short}`, open: () => void this.lift(c, true) });
        if (Math.hypot(me.x - c.lift.to.x, me.z - c.lift.to.z) < 6 && this.roofOk(c, me.y)) out.push({ id: `club:${id}:down`, name: 'Lift', x: c.lift.to.x, z: c.lift.to.z, y: c.lift.to.y, yaw: 0, actions: [], kind: 'object', reach: 2.5, verb: 'Take the lift down', open: () => void this.lift(c, false) });
      }
      // the bouncer at the door (the ORUN one stands in the lobby by the lift)
      if (Math.hypot(me.x - c.door.x, me.z - c.door.z) < 9 && me.y < 10) { const fee = this.coverNow(id); const b = this.band(id); out.push({ id: `club:${id}:door`, name: 'Bouncer', x: c.door.x, z: c.door.z, yaw: 0, actions: [], kind: 'object', reach: 6, verb: b === 'guest' ? 'Wristband on' : fee ? `Talk to the bouncer (cover ${naira(fee)})` : 'Talk to the bouncer', open: () => this.doorPanel(id) }); }
      if (Math.hypot(me.x - c.floor.x, me.z - c.floor.z) > 30 || !this.roofOk(c, me.y)) continue;
      const v = this.views.get(id)!; const onShift = this.shift?.club === id;
      out.push({ id: `club:${id}:dj`, name: 'DJ booth', x: c.dj.x, z: c.dj.z, y: c.dj.y, yaw: c.dj.yaw, actions: [], kind: 'object', reach: DECK_REACH,
        verb: this.shift?.job === 'dj' && onShift ? 'Open the decks' : v.dj && v.dj.id !== mine ? `${v.dj.name} is on the decks` : 'Take the decks (paid shift)', open: () => void this.decks(id) });
      for (const p of c.poles) {
        const w = v.poles[p.id]; const me2 = this.shift?.key === p.id;
        out.push({ id: `club:${id}:${p.id}`, name: 'Pole stage', x: p.x, z: p.z, y: p.y, yaw: p.yaw, actions: [], kind: 'object', reach: POLE_REACH,
          verb: me2 ? 'Step off the stage' : w && w.id !== mine ? `${w.name} is on this stage` : 'Work the pole stage (paid shift)', open: () => void (me2 ? this.leave() : this.pole(id, p.id)) });
      }
      const vip = this.vipOf(id); const mineT = this.myTable(id);
      for (const t of c.vip) {
        const held = vip[t.id]; const me3 = mineT === t.id;
        out.push({ id: `club:${id}:${t.id}`, name: 'VIP table', x: t.x, z: t.z, y: t.y, yaw: t.yaw, actions: [], kind: 'object', reach: 2.6,
          verb: me3 ? `Order a bottle (${short(BOTTLE_PRICE[id])})` : held ? `Reserved for ${held.name}` : mineT ? 'You have a table already' : `Book this VIP table (${short(VIP_PRICE[id])})`,
          open: () => void (me3 ? this.bottle(id) : held || mineT ? null : this.bookVip(id, t.id)) });
      }
      const bar = this.barPrice(id);
      out.push({ id: `club:${id}:bar`, name: 'Bar', x: c.bar.x, z: c.bar.z, y: c.bar.y, yaw: c.bar.yaw, actions: [], kind: 'object', reach: 3, verb: bar ? `Buy a drink (${naira(bar)})` : 'Free drink tonight', open: () => void this.drink(id) });
      out.push({ id: `club:${id}:floor`, name: 'Dance floor', x: c.floor.x, z: c.floor.z, y: c.floor.y, yaw: c.floor.yaw, actions: [], kind: 'object', reach: Math.max(c.floor.w, c.floor.d) / 2, verb: 'Spray money / shut it down', open: () => this.sprayPanel(id) });
    }
    return out;
  }
  // ------------------------------------------------------------------------------------------ the door
  private night() { return nightOf(net.active ? clubHours(this.now()) : this.ctx.view.atmo.hour); }
  private shutNow(id: ClubId) { const v = this.views.get(id); return !!v?.shutdown && v.shutdown.until > this.now(); }
  /** cover at the door right now: the server's rule on the shared clock online, the local clock offline */
  coverNow(id: ClubId) { return coverFor(id, net.active ? clubHours(this.now()) : this.ctx.view.atmo.hour, this.shutNow(id)); }
  band(id: ClubId): PassKind | null { const k = `${id}:${this.night()}`; return net.active ? this.bands.get(k) ?? null : this.S.bands?.[k] ?? null; }
  private setBand(id: ClubId, kind: PassKind) { const k = `${id}:${this.night()}`; if (net.active) this.bands.set(k, kind); else { const b = (this.S.bands ??= {}); for (const x of Object.keys(b)) if (!x.endsWith(`:${this.night()}`)) delete b[x]; if (b[k] !== 'guest') b[k] = kind; } }
  /** in here as a paying guest (or the door is open anyway) */
  guest(id: ClubId) { return this.coverNow(id) === 0 || this.band(id) === 'guest'; }
  private canEnter(id: ClubId) { return this.coverNow(id) === 0 || !!this.band(id) || this.shift?.club === id; }
  private stripped() { return !!(this.ctx.save as any).body?.stripped; }
  /** local frame of a ground club: u across, v front (door side, negative) to back */
  private local(c: ClubDef, x: number, z: number) { const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw); const dx = x - c.x, dz = z - c.z; return { u: dx * fz - dz * fx, v: dx * fx + dz * fz }; }
  /** a step outside the door, facing the club */
  private outside(c: ClubDef) { const dx = c.door.x - c.inside.x, dz = c.door.z - c.inside.z; const L = Math.hypot(dx, dz) || 1; return { x: c.door.x + (dx / L) * 2.6, z: c.door.z + (dz / L) * 2.6, yaw: Math.atan2(-dx, -dz) }; }
  private doorPanel(id: ClubId) {
    const R = CLUB_RULES[id]; const fee = this.coverNow(id); const have = this.band(id);
    const o = new Overlay(this.ctx, { title: `${R.short} door`, sub: fee ? `Cover tonight: ${naira(fee)} cash. ${naira(this.ctx.sim.cash)} on you.` : this.shutNow(id) ? 'Somebody shut the club down. The door is free tonight.' : 'The door is open. Cover starts at 9pm.', width: 420 });
    const line = h('div', { style: 'font-size:13px;line-height:1.45;color:var(--mut);margin-bottom:10px', text: have === 'guest' ? 'You have a wristband. Go in and enjoy.' : this.stripped() ? DRESS_CODE : fee ? 'Bouncer: "Wristband na for the night. You fit come out come back, nobody go charge you again."' : 'Bouncer: "Enter, the place never full yet."' });
    o.body.append(line);
    const row = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
    if (have !== 'guest' && fee) row.append(h('button', { class: 'fk-btn green', text: `Pay cover (${naira(fee)})`, onclick: () => { o.close(); void this.enter(id, 'guest'); } }));
    if (!have && fee) row.append(h('button', { class: 'fk-btn ghost', text: 'I am here to work (staff)', onclick: () => { o.close(); void this.enter(id, 'staff'); } }));
    row.append(h('button', { class: 'fk-btn ghost', text: 'Close', onclick: () => o.close() }));
    o.body.append(row); o.open();
  }
  private async enter(id: ClubId, kind: PassKind) {
    if (net.active) { const r = await this.act('club.enter', { club: id, kind }); if (!r) return false; this.setBand(id, r.pass); if (r.paid) this.ctx.hud.toast(CLUB_RULES[id].short, `Wristband on. ${naira(r.paid)} at the door.`, GRAD, 'cash', 3); else this.ctx.hud.toast(CLUB_RULES[id].short, kind === 'staff' ? 'Staff band on. The decks and the stages are inside.' : 'Wristband on.', GRAD, 'msg', 3); return true; }
    if (this.stripped()) { this.ctx.hud.toast('Bouncer', DRESS_CODE, 'var(--red)', 'msg', 4); return false; }
    const fee = kind === 'staff' ? 0 : this.coverNow(id);
    if (fee && !spend(this.ctx, fee)) { this.ctx.hud.toast('Bouncer', `Cover is ${naira(fee)}, cash. Go to the ATM first.`, 'var(--red)', 'cash', 3.5); return false; }
    this.setBand(id, kind); this.ctx.hud.toast(CLUB_RULES[id].short, fee ? `Wristband on. ${naira(fee)} at the door.` : kind === 'staff' ? 'Staff band on. The decks and the stages are inside.' : 'Wristband on.', GRAD, fee ? 'cash' : 'msg', 3);
    return true;
  }
  /** a server refusal that means "go to the door": open the door panel instead of a dead end */
  private noBand(r: any, id: ClubId) { if (r?.code === 'band' || String(r?.err ?? '').startsWith('Bouncer: "Wristband')) { this.doorPanel(id); return true; } return false; }
  /** the soft gate: walk through a ground club's door at night without a band and the bouncer walks you back out */
  private gate() {
    const me = this.ctx.sim.local.pos; if (this.ctx.sim.local.vehicle || me.y > 4) return;
    for (const c of CLUBS) {
      if (!isClub(c.id) || c.kind === 'rooftop') continue; const id = c.id as ClubId;
      const { u, v } = this.local(c, me.x, me.z); if (Math.abs(u) > c.w / 2 || v < -c.d / 2 + 0.6 || v > c.d / 2) continue;
      const ok = this.canEnter(id) && !(this.stripped() && !this.band(id) && this.coverNow(id) > 0);
      if (ok) continue;
      const o = this.outside(c); this.place(o.x, 0.1, o.z, o.yaw);
      if (performance.now() - this.bounced > 4000) { this.bounced = performance.now(); this.ctx.hud.toast('Bouncer', this.stripped() ? DRESS_CODE : NO_BAND, 'var(--red)', 'msg', 3.5); this.doorPanel(id); }
    }
  }
  /** a bouncer in black at every door at night (and in the ORUN lobby) */
  private doormen() {
    const me = this.ctx.sim.local.pos; const hour = this.ctx.view.atmo.hour; const on = isClubNight(hour) || hour >= 20;
    for (const c of CLUBS) {
      if (!isClub(c.id)) continue; const id = c.id as ClubId; const near = on && Math.hypot(me.x - c.door.x, me.z - c.door.z) < 70 && me.y < 20; const b = this.bouncers.get(id);
      if (!near) { if (b) { this.ctx.sim.removeActor(b); this.bouncers.delete(id); } continue; }
      if (b) continue;
      const o = this.outside(c); const dx = c.door.x - o.x, dz = c.door.z - o.z; const L = Math.hypot(dx, dz) || 1; const side = 1.9; const px = o.x - (dz / L) * side, pz = o.z + (dx / L) * side;
      const lk = this.ctx.sim.randomLook(); Object.assign(lk, { body: 'male', top: 'tee', topPattern: 'solid', topColor: '#0b0b0d', pants: 'solid', pantsColor: '#0b0b0d', head: 'none' });
      this.bouncers.set(id, this.spawn(px, 0, pz, o.yaw + Math.PI, { clip: 'Idle_Loop' }, lk, 'Bouncer'));
    }
  }

  // ------------------------------------------------------------------------------------------ VIP
  private vipOf(id: ClubId) { if (net.active) return this.views.get(id)?.vip ?? {}; const out: Record<string, { id: string; name: string; until: number }> = {}; const t = this.S.vip?.[id]; if (t && t.until > Date.now()) out[t.table] = { id: 'me', name: this.ctx.profile?.name ?? 'You', until: t.until }; return out; }
  private myTable(id: ClubId) { const mine = net.account?.id ?? 'me'; return Object.entries(this.vipOf(id)).find(([, t]) => t.id === mine)?.[0] ?? null; }
  private async bookVip(id: ClubId, table: string) {
    const R = CLUB_RULES[id]; const price = VIP_PRICE[id];
    if (net.active) { const r: any = await net.act('club.vip', { club: id, table }); if (!r?.ok) { if (!this.noBand(r, id)) this.ctx.hud.toast('VIP', r?.err ?? 'That did not work.', 'var(--red)', 'msg', 3.5); return; } this.views.set(id, r.club); }
    else {
      if (!this.guest(id)) { this.doorPanel(id); return; }
      if (this.myTable(id)) { this.ctx.hud.toast('VIP', `You already have a table at ${R.short}.`, 'var(--red)', 'msg', 3); return; }
      if (!spend(this.ctx, price)) { this.ctx.hud.toast('VIP', `A VIP table at ${R.short} is ${naira(price)}.`, 'var(--red)', 'cash', 3.5); return; }
      (this.S.vip ??= {})[id] = { club: id, table, until: Date.now() + VIP_MIN * 60_000, last: Date.now() };
    }
    const t = this.def(id).vip.find((v) => v.id === table)!; this.sit(t); this.sparkle(id, t);
    const n = this.life?.needs; if (n) { n.v.social = Math.min(100, n.v.social + 20); n.v.fun = Math.min(100, n.v.fun + 15); addMoodlet(n, 'vip', 'Big man at the VIP table', 18, 6); }
    this.ctx.hud.title('VIP TABLE', `${R.short} · your name is on the table for ${VIP_MIN} minutes. First bottle is on the house.`, 3.5);
  }
  private async bottle(id: ClubId) {
    const R = CLUB_RULES[id]; const price = BOTTLE_PRICE[id]; const table = this.myTable(id); if (!table) return;
    if (net.active) { const r = await this.act('club.bottle', { club: id }); if (!r) return; }
    else {
      const t = this.S.vip![id]!; if (Date.now() - t.last < BOTTLE_GAP_MS) { this.ctx.hud.toast('VIP', 'Waiter: "Your last bottle never finish, oga."', 'var(--red)', 'msg', 3); return; }
      if (!spend(this.ctx, price)) { this.ctx.hud.toast('VIP', `A bottle here is ${naira(price)}.`, 'var(--red)', 'cash', 3); return; } t.last = Date.now();
    }
    this.sparkle(id, this.def(id).vip.find((v) => v.id === table)!);
    const n = this.life?.needs; if (n) { n.v.fun = Math.min(100, n.v.fun + 10); n.v.social = Math.min(100, n.v.social + 10); n.v.bladder = Math.max(0, n.v.bladder - 12); addMoodlet(n, 'bottle', 'Bottle service', 10, 4); }
    this.ctx.hud.toast(R.short, `Bottle on the way with sparklers. ${naira(price)}.`, GRAD, 'cash', 3);
  }
  /** sit on the sofa behind your table */
  private sit(t: { x: number; y: number; z: number; yaw: number }) { const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw); this.place(t.x - fx * 0.45, t.y + 0.02, t.z - fz * 0.45, t.yaw); (this.ctx.sim.local as any).act = { clip: 'Sitting_Idle_Loop', yaw: t.yaw }; }

  private barPrice(id: ClubId) { const v = this.views.get(id); return v?.shutdown && v.shutdown.until > this.now() ? 0 : CLUB_RULES[id].bar; }
  private place(x: number, y: number, z: number, yaw: number) {
    const me = this.ctx.sim.local; me.pos = { x, y, z }; me.vy = 0; me.yaw = yaw; me.body.setTranslation({ x, y: y + 0.9, z }, true); this.ctx.view.cam.yaw = yaw;
  }
  private async lift(c: ClubDef, up: boolean) {
    const id = c.id as ClubId;
    if (up && (!this.canEnter(id) || (this.stripped() && this.coverNow(id) > 0))) { this.ctx.hud.toast('Bouncer', this.stripped() ? DRESS_CODE : NO_BAND, 'var(--red)', 'msg', 3.5); this.doorPanel(id); return; }
    if (net.active) await net.act('tp');
    const L = c.lift!; if (up) { this.place(L.to.x, L.to.y + 0.1, L.to.z, L.to.yaw); this.ctx.hud.title(CLUB_RULES[c.id as ClubId].short, '21 floors up. Lagos at your feet.', 2.5); }
    else this.place(c.door.x, 0.05, c.door.z + 1.6, 0);
  }

  // ------------------------------------------------------------------------------------------ shifts
  private async act(a: string, args: Record<string, unknown> = {}) { const r: any = await net.act(a, args); if (!r?.ok) this.ctx.hud.toast(a.startsWith('club.spray') ? 'Spray' : 'Club', r?.err ?? 'That did not work.', 'var(--red)', 'msg', 3.5); return r?.ok ? r : null; }
  private async decks(id: ClubId) {
    if (this.shift?.job === 'dj' && this.shift.club === id) { this.openPanel(); return; }
    if (net.active) { if (!(await this.act('club.decks', { club: id }))) return; }
    else { if (this.shift) this.stopShift(true); const v = this.views.get(id)!; v.dj = { id: 'me', name: this.ctx.profile?.name ?? 'You', since: Date.now() }; }
    this.shift = { club: id, job: 'dj', key: 'dj', since: Date.now(), earned: 0 };
    const d = this.def(id).dj; this.place(d.x, d.y, d.z, d.yaw); (this.ctx.sim.local as any).act = { clip: 'Idle_Rail_Loop', yaw: d.yaw };
    this.ctx.hud.title('ON THE DECKS', `${CLUB_RULES[id].short} · the house pays by the minute, more when the room is full`, 3);
    this.openPanel();
  }
  private async pole(id: ClubId, key: string) {
    if (net.active) { if (!(await this.act('club.pole', { club: id, pole: key }))) return; }
    else { if (this.shift) this.stopShift(true); const v = this.views.get(id)!; v.poles[key] = { id: 'me', name: this.ctx.profile?.name ?? 'You' }; this.removeNpcPole(id, key); }
    this.shift = { club: id, job: 'pole', key, since: Date.now(), earned: 0 };
    const p = this.def(id).poles.find((q) => q.id === key)!; const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    this.place(p.x + fx * 0.7, p.y + 0.02, p.z + fz * 0.7, p.yaw); (this.ctx.sim.local as any).act = { clip: 'Dance_Loop', speed: 1.1, yaw: p.yaw };
    this.ctx.hud.title('STAGE SHIFT', 'Athletic stage work. Paid by the minute, sprays are yours. Walk off to end the shift.', 3.5);
  }
  async leave() { if (net.active) { const r = await this.act('club.leave'); if (r?.ended) this.ctx.hud.toast('Shift over', `This shift paid ${naira(r.ended.earned)}.`, GRAD, 'cash', 3.5); } this.stopShift(true); }
  private stopShift(local: boolean) {
    const s = this.shift; if (!s) return; this.shift = null; (this.ctx.sim.local as any).act = undefined; this.panel?.close();
    if (!net.active && local) { const v = this.views.get(s.club)!; if (s.job === 'dj') v.dj = null; else delete v.poles[s.key]; this.ctx.hud.toast('Shift over', `This shift paid ${naira(s.earned)}.`, GRAD, 'cash', 3.5); }
    // step down off the decks or the stage, back onto the floor
    const c = this.def(s.club); const f = c.floor; const me = this.ctx.sim.local.pos;
    if (s.job === 'dj' || Math.hypot(me.x - f.x, me.z - f.z) < 30) { const at = s.job === 'dj' ? c.dj : c.poles.find((p) => p.id === s.key)!; const fx = Math.sin(at.yaw), fz = Math.cos(at.yaw); this.place(at.x + fx * (s.job === 'dj' ? 4.6 : 2.2), f.y + 0.05, at.z + fz * (s.job === 'dj' ? 4.6 : 2.2), at.yaw); }
  }
  /** offline the house pays here, by the same rule as the server */
  private payLocal(dt: number) {
    const s = this.shift; if (!s || net.active) return; this.payT += dt; if (this.payT < 15) return; const mins = this.payT / 60; this.payT = 0;
    const day = String(Math.floor(clubHours(Date.now()) / 24)); const k = `${s.job}:${day}`; const sofar = this.S.paid[k] ?? 0;
    const crowd = this.npcs.get(s.club)?.list.length ?? 0;
    const n = Math.min(Math.round(shiftPay(s.job, Math.round(crowd / 2), this.ctx.view.atmo.hour) * mins), dayCap(s.job) - sofar); if (n <= 0) return;
    this.S.paid[k] = sofar + n; s.earned += n; earn(this.ctx, n, 'work');
  }

  // ------------------------------------------------------------------------------------------ the bar, spraying, shutdowns
  private async drink(id: ClubId) {
    let price = this.barPrice(id);
    if (net.active) { const r: any = await net.act('club.bar'); if (!r?.ok) { if (!this.noBand(r, id)) this.ctx.hud.toast('Club', r?.err ?? 'That did not work.', 'var(--red)', 'msg', 3.5); return; } price = r.price; }
    else if (!this.guest(id)) { this.doorPanel(id); return; }
    else if (price && !spend(this.ctx, price)) { this.ctx.hud.toast('Bar', `A drink here is ${naira(price)}.`, 'var(--red)', 'cash', 3); return; }
    const n = this.life?.needs; if (n) { n.v.fun = Math.min(100, n.v.fun + 8); n.v.social = Math.min(100, n.v.social + 6); n.v.bladder = Math.max(0, n.v.bladder - 10); addMoodlet(n, 'clubdrink', price ? 'Drinks at the club' : 'Free drinks, somebody shut it down', price ? 4 : 8, 3); }
    this.ctx.hud.toast('Bar', price ? `Chilled one for ${naira(price)}. Enjoy.` : 'On the big boss tonight. Cheers!', GRAD, 'cash', 2.5);
  }
  private sprayPanel(id: ClubId) {
    if (!this.guest(id)) { this.ctx.hud.toast('Bouncer', NO_BAND, 'var(--red)', 'msg', 3); this.doorPanel(id); return; }
    const v = this.views.get(id)!; const c = this.def(id); const R = CLUB_RULES[id]; const mine = net.account?.id ?? 'me';
    type T = { id: string; name: string; what: string };
    const targets: T[] = [];
    if (v.dj && v.dj.id !== mine) targets.push({ id: v.dj.id, name: v.dj.name, what: 'on the decks' });
    for (const [k, p] of Object.entries(v.poles)) if (p.id !== mine) targets.push({ id: p.id, name: p.name, what: `stage ${c.poles.findIndex((q) => q.id === k) + 1}` });
    if (!net.active) { const N = this.npcs.get(id); if (N?.dj && !v.dj) targets.push({ id: 'npc:dj', name: 'DJ Kaypee', what: 'on the decks' }); for (const k of N?.poles.keys() ?? []) targets.push({ id: `npc:${k}`, name: `Dancer on stage ${c.poles.findIndex((q) => q.id === k) + 1}`, what: 'working the pole' }); }
    targets.push({ id: 'floor', name: 'The whole floor', what: 'make it rain on everybody' });
    let pick = targets[0].id;
    const o = new Overlay(this.ctx, { title: `Spray at ${R.short}`, sub: `${naira(this.ctx.sim.cash)} cash on you. The house keeps 10%.`, width: 440 });
    const who = h('div', { class: 'cl-who' }); const notes = h('div', { class: 'cl-notes' });
    const drawWho = () => { who.replaceChildren(...targets.map((t) => h('button', { class: 'fk-tile' + (t.id === pick ? ' on' : ''), onclick: () => { pick = t.id; drawWho(); } }, h('b', { text: t.name }), h('span', { text: t.what })))); };
    drawWho();
    for (const n of SPRAY_NOTES) notes.append(h('button', { class: 'fk-btn green', text: short(n), onclick: () => void this.spray(id, pick, n).then(() => o.setTitle(`Spray at ${R.short}`, `${naira(this.ctx.sim.cash)} cash on you. The house keeps 10%.`)) }));
    o.body.append(h('div', { class: 'fk-sec', text: 'Who' }), who, h('div', { class: 'fk-sec', text: 'How much' }), notes);
    const sh = v.shutdown && v.shutdown.until > this.now() ? v.shutdown : null;
    o.body.append(h('div', { class: 'fk-sec', text: 'Shut it down' }), h('div', { style: 'font-size:12.5px;color:var(--mut);margin-bottom:8px;line-height:1.4', text: sh ? `${sh.name} already shut ${R.short} down. Drinks are free till ${new Date(sh.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : `Buy out the whole club for ${SHUTDOWN_MIN} minutes. Drinks free for everybody, and all of Lagos hears your name. ${naira(R.shutdown)}${net.active ? ', cash first, then bank' : ' cash'}.` }),
      sh ? '' : h('button', { class: 'fk-btn red', text: `Shut down ${R.short} (${short(R.shutdown)})`, onclick: () => { o.close(); void this.shutdown(id); } }));
    o.open();
  }
  private async spray(id: ClubId, to: string, n: number) {
    if (net.active) { const r = await this.act('club.spray', { club: id, to, amount: n }); if (!r) return; return; }
    if (!spend(this.ctx, n)) { this.ctx.hud.toast('Spray', 'Not enough cash on you.', 'var(--red)', 'cash', 3); return; }
    const sh = this.shift; void sh; this.burst(id, to.startsWith('npc:') ? to.slice(4) : to, n);
    const n2 = this.life?.needs; if (n2) addMoodlet(n2, 'sprayed', 'Made it rain', n >= 20000 ? 10 : 5, 3);
  }
  private async shutdown(id: ClubId) {
    const R = CLUB_RULES[id];
    if (net.active) { if (!(await this.act('club.shutdown', { club: id }))) return; }
    else { if (!spend(this.ctx, R.shutdown)) { this.ctx.hud.toast('Shut down', `You need ${naira(R.shutdown)} cash on you.`, 'var(--red)', 'cash', 3.5); return; } this.views.get(id)!.shutdown = { by: 'me', name: this.ctx.profile?.name ?? 'You', until: Date.now() + SHUTDOWN_MIN * 60_000 }; }
    const n = this.life?.needs; if (n) addMoodlet(n, 'shutdown', 'Shut the club down', 25, 8);
    this.burst(id, 'floor', 100000);
  }

  // ------------------------------------------------------------------------------------------ the DJ panel
  private openPanel() {
    if (!this.shift || this.shift.job !== 'dj') return;
    this.panel?.close(); this.panel = new Overlay(this.ctx, { title: 'The decks', sub: CLUB_RULES[this.shift.club].name, width: 560 });
    this.drawPanel(); this.panel.open(); void this.loadCrate();
  }
  private drawPanel() {
    const o = this.panel; const s = this.shift; if (!o || !s) return; const v = this.views.get(s.club)!; const t = this.trackOf(s.club);
    const now = h('div', { class: 'cl-now' }, h('div', { class: 'disc' }), h('div', { style: 'flex:1;min-width:0' }, h('b', { text: t ? t.title : 'Nothing yet' }), h('span', { text: t ? `${t.artist}${t.src === 'audius' ? ' · Audius' : t.src === 'song' ? ' · player upload' : ' · house groove'}` : 'Pick a song. The room is waiting.' })),
      h('div', { style: 'text-align:right;font-size:12px;color:var(--mut)' }, h('div', { text: `${v.crowd || (this.npcs.get(s.club)?.list.length ?? 0)} in the room` }), h('div', { text: `${naira(s.earned)} this shift` })));
    const tabs = h('div', { class: 'cl-tabs' }, ...([['naija', 'Naija set'], ['cleared', 'Player songs'], ['mine', 'My songs'], ['house', 'House']] as const).map(([k, l]) => h('button', { class: this.tab === k ? 'on' : '', text: l, onclick: () => { this.tab = k; this.drawPanel(); } })));
    const search = h('input', { class: 'fk-in', placeholder: 'Search the crate', value: this.q, oninput: (e: Event) => { this.q = (e.target as HTMLInputElement).value; list.replaceChildren(...this.rows(t)); } });
    const list = h('div', { class: 'cl-list' }, ...this.rows(t));
    o.body.replaceChildren(now, tabs, this.tab === 'naija' ? h('div', { style: 'margin-bottom:8px' }, search) : '', list);
    o.foot.style.display = 'flex'; o.foot.replaceChildren(h('span', { style: 'flex:1;font-size:12px;color:var(--mut)', text: isClubNight(this.ctx.view.atmo.hour) ? 'Night shift: full pay.' : 'Day shift: the room is quiet till 9pm, pay is lower.' }), h('button', { class: 'fk-btn ghost', text: 'Close', onclick: () => o.close() }), h('button', { class: 'fk-btn red', text: 'Step off the decks', onclick: () => void this.leave() }));
  }
  private rows(cur: ClubTrack | null): HTMLElement[] {
    let items: Crate[] = this.tab === 'naija' ? this.crate.audius : this.tab === 'cleared' ? this.crate.cleared : this.tab === 'mine' ? this.crate.mine.filter((m) => m.status === 'approved').map((m) => ({ src: 'song' as const, id: m.id, title: m.title, artist: m.artist, secs: m.secs })) : HOUSE_SET.map((x) => ({ src: 'house' as const, ...x }));
    if (this.tab === 'naija' && this.q.trim()) { const q = this.q.trim().toLowerCase(); items = items.filter((x) => (x.title + ' ' + x.artist).toLowerCase().includes(q)); }
    if (!items.length) {
      const msg = this.tab === 'naija' ? (this.crate.audiusErr ? 'Audius is not answering right now. Play a house groove or a player song.' : this.crate.loaded ? 'Nothing matches that.' : 'Loading the Naija crate from Audius…')
        : this.tab === 'cleared' ? (net.active ? 'No player songs cleared yet.' : 'Player songs come from the server. Play online to dig in.') : this.tab === 'mine' ? 'Upload your own songs in the Clubs app on your phone. Once cleared they show here.' : '';
      return [h('div', { style: 'padding:14px;color:var(--mut);font-size:13px', text: msg })];
    }
    return items.slice(0, 120).map((x) => h('div', { class: 'cl-tr' + (cur && cur.id === x.id ? ' on' : '') },
      h('div', { class: 't' }, h('b', { text: x.title }), h('span', { text: `${x.artist} · ${mmss(x.secs)}${x.promo ? ' · promoted' : ''}${x.owner ? ` · ${x.owner}` : ''}` })),
      h('button', { class: 'fk-btn sm', text: cur && cur.id === x.id ? 'Playing' : 'Play', disabled: !!(cur && cur.id === x.id), onclick: () => void this.play(x) })));
  }
  private async play(x: Crate) {
    const s = this.shift; if (!s) return; const t = { src: x.src, id: x.id, title: x.title, artist: x.artist, secs: x.secs };
    if (net.active) { const r = await this.act('club.play', { club: s.club, track: t }); if (!r) return; this.views.set(s.club, r.club); }
    else this.S.track[s.club] = { ...t, at: Date.now(), by: this.ctx.profile?.name ?? 'You' };
    const n = this.life?.needs; if (n) n.v.fun = Math.min(100, n.v.fun + 2);
    this.drawPanel();
  }
  private async loadCrate(force = false) {
    if (!force && Date.now() - this.crate.loaded < 10 * 60_000 && this.crate.audius.length) return;
    if (net.active && this.shift) { const r: any = await net.act('club.crate', { club: this.shift.club }); if (r?.ok) { this.crate.cleared = r.list.map((s: any) => ({ src: 'song', ...s })); this.crate.mine = r.mine; } }
    try {
      const got = await Promise.all(AUDIUS_QUERIES.slice(0, 6).map((q) => fetch(`https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=${AUDIUS_APP}`).then((r) => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] }))));
      const seen = new Set<string>(); const out: Crate[] = [];
      for (const j of got) for (const t of (j?.data ?? []) as any[]) {
        if (!t?.id || seen.has(t.id) || t.is_streamable === false || !(t.duration >= 60 && t.duration <= SONG_MAX_SECS) || !/^[A-Za-z0-9]{1,16}$/.test(t.id)) continue;
        seen.add(t.id); out.push({ src: 'audius', id: t.id, title: String(t.title ?? '').slice(0, 60), artist: String(t.user?.name ?? '').slice(0, 40), secs: Math.round(t.duration) });
      }
      this.crate.audius = out; this.crate.audiusErr = !out.length;
    } catch { this.crate.audiusErr = true; }
    this.crate.loaded = Date.now(); this.drawPanel();
  }

  // ------------------------------------------------------------------------------------------ music in the room
  private trackOf(id: ClubId): ClubTrack | null {
    if (net.active) return this.views.get(id)?.track ?? null;
    const t = this.S.track[id]; if (t && this.views.get(id)?.dj && Date.now() < t.at + t.secs * 1000) return t;
    const slot = Math.floor(Date.now() / 240_000); const hh = HOUSE_SET[slot % HOUSE_SET.length]; return { src: 'house', ...hh, at: slot * 240_000 };
  }
  private songUrl(id: string) { return `${net.server?.http ?? ''}/api/songs/${id}/audio`; }
  private music(dt: void) {
    void dt; const near = this.nearest(); const inside = (this.life as any)?.inside || (this.life as any)?.venue;
    const d = near && !inside ? near.d : 1e9; const vol = d < 9 ? 1 : Math.max(0, 1 - (d - 9) / HEAR) ** 1.6;
    const t = near && vol > 0.01 ? this.trackOf(near.c.id as ClubId) : null;
    const key = t && t.src !== 'house' ? `${t.src}:${t.id}` : '';
    if (!t || !key || this.failed.has(key)) { this.stopAudio(); clubMix(t ? vol : 0); return; }
    clubMix(0);
    if (this.audioKey !== key) {
      // the DJ mixes: the old song fades out under the new one over a couple of seconds
      if (this.audio && !this.audio.paused) { this.dropFade(); this.fading = { a: this.audio, v: this.audio.volume }; this.audio = null; this.audioKey = ''; this.fadeIn = 0; } else { this.stopAudio(); this.fadeIn = 1; }
      const a = new Audio(); a.preload = 'auto'; a.crossOrigin = 'anonymous'; this.audio = a; this.audioKey = key;
      a.onerror = () => { this.failed.add(key); this.stopAudio(); };
      a.src = t.src === 'audius' ? `https://api.audius.co/v1/tracks/${t.id}/stream?app_name=${AUDIUS_APP}` : this.songUrl(t.id);
    }
    const a = this.audio!; this.baseVol = Math.min(1, vol * 0.9); a.volume = this.baseVol * this.fadeIn;
    const want = Math.max(0, (this.now() - t.at) / 1000);
    if (a.readyState >= 1 && Number.isFinite(a.duration) && want < a.duration && Math.abs(a.currentTime - want) > 4) { try { a.currentTime = want; } catch { /* not seekable yet */ } }
    if (a.paused) void a.play().catch(() => { /* waits for a tap */ });
  }
  private static FADE = 2.5;
  private dropFade() { const f = this.fading; if (!f) return; f.a.pause(); f.a.removeAttribute('src'); f.a.load(); this.fading = null; }
  /** crossfade: the outgoing song ramps down while the incoming one ramps up */
  private fade(dt: number) {
    if (this.fadeIn < 1) { this.fadeIn = Math.min(1, this.fadeIn + dt / ClubsLife.FADE); if (this.audio) this.audio.volume = this.baseVol * this.fadeIn; }
    const f = this.fading; if (!f) return; f.v -= dt / ClubsLife.FADE; if (f.v <= 0) { this.dropFade(); return; } f.a.volume = Math.max(0, Math.min(1, f.v));
  }
  private stopAudio() { this.dropFade(); if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = null; } this.audioKey = ''; }

  // ------------------------------------------------------------------------------------------ the room: NPC crowd, a house DJ, dancers, money in the air
  private crowd() {
    const me = this.ctx.sim.local.pos; const hour = this.ctx.view.atmo.hour; const night = isClubNight(hour) || hour >= 19;
    for (const c of CLUBS) {
      if (!isClub(c.id)) continue; const id = c.id as ClubId; const d = Math.hypot(me.x - c.floor.x, me.z - c.floor.z); const here = d < 60 && this.roofOk(c, me.y);
      let N = this.npcs.get(id);
      if (!here) { if (N) { for (const a of [...N.list, N.dj, ...N.poles.values()]) if (a && !a._gone) this.ctx.sim.removeActor(a); this.npcs.delete(id); } continue; }
      if (!N) {
        N = { list: [], dj: null, poles: new Map() }; this.npcs.set(id, N);
        const n = night ? (c.kind === 'club' ? 14 : 9) : 3; const f = c.floor; const s = Math.sin(f.yaw), co = Math.cos(f.yaw);
        for (let i = 0; i < n; i++) { const lu = (Math.random() - 0.5) * f.w * 0.8, lv = (Math.random() - 0.5) * f.d * 0.8; N.list.push(this.spawn(f.x + s * lv + co * lu, f.y + 0.1, f.z + co * lv - s * lu, Math.random() * 6.28, { clip: 'Dance_Loop', speed: 0.8 + Math.random() * 0.45 })); }
      }
      const v = this.views.get(id)!;
      // a house DJ when no player is on the decks
      if (!v.dj && !N.dj) { const lk = this.ctx.sim.randomLook(); Object.assign(lk, { head: 'cap', topColor: '#111111', topPattern: 'solid' }); N.dj = this.spawn(c.dj.x, c.dj.y, c.dj.z, c.dj.yaw, { clip: 'Idle_Rail_Loop' }, lk, 'DJ'); }
      if (v.dj && N.dj) { this.ctx.sim.removeActor(N.dj); N.dj = null; }
      // dancers on the free stages at night: clothed stage outfits, athletic work
      for (const p of c.poles) {
        const held = !!v.poles[p.id]; const npc = N.poles.get(p.id);
        if (night && !held && !npc) { const lk = this.ctx.sim.randomLook(); Object.assign(lk, { body: 'female', top: 'tee', topPattern: 'solid', topColor: c.palette.neon, pants: 'solid', pantsColor: '#141414' }); const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw); N.poles.set(p.id, this.spawn(p.x + fx * 0.6, p.y + 0.02, p.z + fz * 0.6, p.yaw, { clip: 'Dance_Loop', speed: 1.15 }, lk, 'Dancer')); }
        if (held && npc) this.removeNpcPole(id, p.id);
      }
    }
  }
  private removeNpcPole(id: ClubId, key: string) { const N = this.npcs.get(id); const a = N?.poles.get(key); if (a) { this.ctx.sim.removeActor(a); N!.poles.delete(key); } }
  private spawn(x: number, y: number, z: number, yaw: number, act: any, look?: any, name?: string) {
    const a = this.ctx.sim.spawnActor((name ? 'vendor' : 'ped') as any, { x, y: y + 0.05, z }, look, name); a.yaw = yaw; Object.assign(a as any, { _script: true, _keep: true, act: { ...act, yaw } });
    a.body.setTranslation({ x, y: y + 0.95, z }, true); return a;
  }
  /** naira notes fluttering down on whoever got sprayed */
  burst(id: ClubId, to: string | null, amount: number) {
    const c = this.def(id); if (!c) return; const me = this.ctx.sim.local.pos; if (Math.hypot(me.x - c.floor.x, me.z - c.floor.z) > 70) return;
    let at: { x: number; y: number; z: number } = c.floor;
    if (to && to !== 'floor') { const v = this.views.get(id)!; if (to === 'dj' || v.dj?.id === to) at = c.dj; else { const k = Object.entries(v.poles).find(([, p]) => p.id === to)?.[0] ?? to; const p = c.poles.find((q) => q.id === k); if (p) at = p; } }
    if (!this.fx) { const g = new THREE.Group(); this.ctx.view.scene.add(g); this.fx = { group: g, notes: [] }; }
    const n = amount >= 100000 ? 60 : amount >= 20000 ? 32 : amount >= 5000 ? 16 : 8; const geo = new THREE.PlaneGeometry(0.16, 0.08);
    for (let i = 0; i < n && this.fx.notes.length < 220; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: amount >= 20000 ? 0x7fd37f : 0xc9a3e6, side: THREE.DoubleSide, toneMapped: false }));
      m.position.set(at.x + (Math.random() - 0.5) * 1.6, at.y + 2.2 + Math.random() * 1.2, at.z + (Math.random() - 0.5) * 1.6); m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      this.fx.group.add(m); this.fx.notes.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.6 - Math.random() * 0.5, (Math.random() - 0.5) * 0.6), t: 2.4 + Math.random() });
    }
  }
  /** sparklers rising off a VIP table: a bottle is on its way */
  sparkle(id: ClubId, t: { x: number; y: number; z: number }) {
    const me = this.ctx.sim.local.pos; if (Math.hypot(me.x - t.x, me.z - t.z) > 70) return; void id;
    if (!this.fx) { const g = new THREE.Group(); this.ctx.view.scene.add(g); this.fx = { group: g, notes: [] }; }
    const geo = new THREE.PlaneGeometry(0.06, 0.06);
    for (let i = 0; i < 40 && this.fx.notes.length < 260; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: i % 3 ? 0xffd25a : 0xfff4c2, side: THREE.DoubleSide, toneMapped: false }));
      m.position.set(t.x + (Math.random() - 0.5) * 0.5, t.y + 0.9, t.z + (Math.random() - 0.5) * 0.5);
      this.fx.group.add(m); this.fx.notes.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.9, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 0.9), t: 0.9 + Math.random() * 0.8 });
    }
  }
  private fxStep(dt: number) {
    const F = this.fx; if (!F) return;
    for (const p of F.notes) { p.t -= dt; p.m.position.addScaledVector(p.v, dt); p.m.rotation.x += dt * 4; p.m.rotation.y += dt * 3; p.v.x = Math.sin(p.t * 5) * 0.4; }
    for (const p of F.notes.filter((q) => q.t <= 0)) { F.group.remove(p.m); (p.m.material as THREE.Material).dispose(); }
    F.notes = F.notes.filter((q) => q.t > 0);
  }

  frame(dt: number) {
    this.fxStep(dt); this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = 0.5; this.music(); this.crowd(); this.light(); this.doormen();
      // a shutdown in the club you are in: the room goes up
      const near = this.nearest();
      if (near && near.d < 30) { const v = this.views.get(near.c.id as ClubId); const sh = v?.shutdown; if (sh && sh.until > this.now() && !this.seenShutdown.has(`${v!.id}:${sh.until}`)) { this.seenShutdown.add(`${v!.id}:${sh.until}`); this.ctx.hud.title(`${CLUB_RULES[v!.id].short} DON SHUT DOWN`, `${sh.name} bought the whole club. Drinks are free.`, 4); this.burst(v!.id, 'floor', 100000); } }
      if (!net.active) for (const v of this.views.values()) if (v.shutdown && v.shutdown.until < Date.now()) v.shutdown = null;
    }
    this.gate(); this.fade(dt);
    this.payLocal(dt);
    // keep the shift pose: the DJ behind the decks, the dancer on the stage
    const s = this.shift; if (s) { const me = this.ctx.sim.local as any; if (!me.act) me.act = s.job === 'dj' ? { clip: 'Idle_Rail_Loop', yaw: me.yaw } : { clip: 'Dance_Loop', speed: 1.1, yaw: me.yaw }; }
  }
  /** moving ends a pole shift (you walked off the stage); the DJ can turn and wave but walking off ends it too */
  filterCommand(c: { mx: number; mz: number; jump: boolean }) {
    const me = this.ctx.sim.local as any; if (!this.shift && me.act?.clip === 'Sitting_Idle_Loop' && (this.nearest()?.d ?? 99) < 40 && (Math.abs(c.mx) + Math.abs(c.mz) > 0.3 || c.jump)) me.act = undefined;
    if (!this.shift || this.panel?.isOpen) return;
    if (Math.abs(c.mx) + Math.abs(c.mz) > 0.3 || c.jump) void this.leave();
  }

  // ------------------------------------------------------------------------------------------ the Clubs phone app: tonight in Lagos, My Music
  private appHtml() {
    if (this.app.s === 'music') return this.musicHtml();
    const out: string[] = [];
    if (this.said) out.push(`<div class="row" style="background:#fdf2ff">${esc(this.said)}</div>`);
    out.push(`<div style="font:700 11px Inter;color:#8a8f9c;text-transform:uppercase;letter-spacing:.6px;margin:2px 4px">Tonight in Lagos</div>`);
    for (const c of CLUBS) {
      if (!isClub(c.id)) continue; const v = this.views.get(c.id as ClubId)!; const t = this.trackOf(c.id as ClubId); const R = CLUB_RULES[c.id as ClubId];
      const sh = v.shutdown && v.shutdown.until > this.now() ? v.shutdown : null; const workers = Object.values(v.poles).length;
      out.push(`<div class="row"><b>${esc(R.name)}${sh ? ' · SHUT DOWN' : ''}</b>${esc(c.tag.split(',')[0])}<br>
        ${t ? `Now playing: ${esc(t.title)} by ${esc(t.artist)}<br>` : ''}${v.dj ? `On the decks: ${esc(v.dj.name)}. ` : 'House DJ on the decks. '}${workers ? `${workers} on the stages. ` : ''}${v.crowd ? `${v.crowd} players inside.` : ''}
        ${sh ? `<br>${esc(sh.name)} bought out the club. Drinks free till ${new Date(sh.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : `<br>Cover ${naira(COVER[c.id as ClubId])} from 9pm. Drinks ${naira(R.bar)}. VIP table ${short(VIP_PRICE[c.id as ClubId])}. Shut it down for ${short(R.shutdown)}.`}${(() => { const n = Object.keys(this.vipOf(c.id as ClubId)).length; return n ? `<br>${n} VIP table${n > 1 ? 's' : ''} booked tonight.` : ''; })()}
        <br><button class="btn" data-cl="go:${c.id}">Take me there</button></div>`);
    }
    out.push(`<div class="row"><b>Work the clubs</b>Take the decks or a pole stage at any club. The house pays by the minute, more when the room is full, and anybody can spray you. Pole stage work is athletic and the outfit stays on. At night, tell the bouncer you are staff and you walk in free.</div>`);
    out.push(`<div class="cell" data-cl="music"><div class="tx"><b>My Music</b><span>Upload your own songs and pay to get them into club rotation</span></div></div>`);
    return out.join('');
  }
  private musicHtml() {
    if (!net.active) return `<div class="row"><b>My Music</b>Uploading and promoting songs needs the server. Play online to use it.</div>`;
    if (!this.crate.mine.length && !this.upload.busy && !(this as any)._mineAsked) { (this as any)._mineAsked = true; void this.loadMine(); }
    const u = this.upload; const out: string[] = [];
    if (this.said) out.push(`<div class="row" style="background:#fdf2ff">${esc(this.said)}</div>`);
    out.push(`<div class="row"><b>Upload a song</b>MP3, OGG or M4A, up to 8 MB, 30 seconds to 10 minutes. Only upload songs you made or have the right to share. Our team listens before DJs can play it.
      <input id="cl-file" type="file" accept="audio/mpeg,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.ogg,.m4a">
      <input id="cl-title" placeholder="Song title" maxlength="60" value="${esc(u.title)}"><input id="cl-artist" placeholder="Artist name" maxlength="40" value="${esc(u.artist || this.ctx.profile?.name || '')}">
      <label style="display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-size:12.5px"><input type="checkbox" id="cl-attest" ${u.attest ? 'checked' : ''} style="width:auto;margin:2px 0 0"> I made this song or own the rights to it, and I let HustleLife play it in clubs.</label>
      <button class="btn" data-cl="upload" ${u.busy ? 'disabled' : ''}>${u.busy ? 'Uploading…' : 'Upload'}</button></div>`);
    for (const s of this.crate.mine) {
      const pick = this.promoPick.get(s.id) ?? { club: 'zilox', days: 3 }; const q = promoQuote(pick.club, pick.days);
      const status = s.status === 'approved' ? 'Cleared for clubs' : s.status === 'review' ? 'Waiting for review' : `Not cleared${s.note ? `: ${esc(s.note)}` : ''}`;
      out.push(`<div class="row"><b>${esc(s.title)}</b>${esc(s.artist)} · ${mmss(s.secs)} · ${status} · ${s.plays} play${s.plays === 1 ? '' : 's'}
        ${s.promos.length ? `<br>In rotation: ${s.promos.map((p) => `${p.club === 'all' ? 'every club' : CLUB_RULES[p.club as ClubId]?.short ?? p.club} till ${new Date(p.until).toLocaleDateString([], { day: 'numeric', month: 'short' })}`).join(', ')}` : ''}
        <br><button class="btn" data-cl="hear:${s.id}" style="background:#11131a">Listen</button>
        ${s.status === 'approved' ? `<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${(['zilox', 'gele', 'orun', 'all'] as const).map((k) => `<button class="btn" data-cl="pclub:${s.id}:${k}" style="flex:none;${pick.club === k ? '' : 'background:#6b7280'}">${k === 'all' ? 'All clubs' : CLUB_RULES[k].short}</button>`).join('')}</div>
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${PROMO_DAYS.map((d) => `<button class="btn" data-cl="pdays:${s.id}:${d}" style="flex:none;${pick.days === d ? '' : 'background:#6b7280'}">${d}d</button>`).join('')}</div>
          <button class="btn" data-cl="promote:${s.id}">Promote for ${q ? naira(q.total) : '?'} (real money)</button>` : ''}
        <button class="btn" data-cl="del:${s.id}" style="background:#7f1d1d">Delete</button></div>`);
    }
    return out.join('');
  }
  private async loadMine() { try { const r = await net.api<{ list: MySong[] }>('GET', '/api/songs/mine'); this.crate.mine = r.list; } catch { /* offline */ } if (this.ctx.hud.appOpen === 'Clubs') this.ctx.hud.refreshApp(); }
  private wire() {
    const L = document.getElementById('av-l'); if (!L || this.ctx.hud.appOpen !== 'Clubs') return;
    L.querySelectorAll<HTMLElement>('[data-cl]').forEach((el) => { if ((el as any)._cl) return; (el as any)._cl = 1; el.addEventListener('click', (e) => { e.stopPropagation(); void this.appAct(el.dataset.cl!); }); });
    const f = L.querySelector<HTMLInputElement>('#cl-file'); if (f && !(f as any)._cl) { (f as any)._cl = 1; f.addEventListener('change', () => { this.upload.file = f.files?.[0] ?? null; const t = L.querySelector<HTMLInputElement>('#cl-title'); if (t && !t.value && this.upload.file) t.value = this.upload.file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 60); }); }
  }
  private readForm() {
    const g = (id: string) => document.getElementById(id) as HTMLInputElement | null;
    this.upload.title = g('cl-title')?.value ?? this.upload.title; this.upload.artist = g('cl-artist')?.value ?? this.upload.artist; this.upload.attest = !!g('cl-attest')?.checked;
  }
  private async appAct(op: string) {
    const [k, a, b] = op.split(':'); this.said = ''; this.readForm();
    if (k === 'go') { const c = this.def(a as ClubId); this.target = { x: c.kind === 'rooftop' ? c.door.x : c.floor.x, z: c.kind === 'rooftop' ? c.door.z + 2 : c.floor.z, label: CLUB_RULES[a as ClubId].name }; this.ctx.hud.toast('Clubs', `GPS set: ${CLUB_RULES[a as ClubId].name}.`, GRAD, 'msg', 3); return; }
    if (k === 'music') { this.app = { s: 'music' }; this.ctx.hud.refreshApp(); return; }
    if (k === 'pclub' || k === 'pdays') { const p = this.promoPick.get(a) ?? { club: 'zilox' as ClubId | 'all', days: 3 }; if (k === 'pclub') p.club = b as ClubId | 'all'; else p.days = Number(b); this.promoPick.set(a, p); this.ctx.hud.refreshApp(); return; }
    if (k === 'hear') { void this.preview(a); return; }
    if (k === 'del') { const r: any = await net.act('songs.remove', { id: a }); if (r?.ok) this.crate.mine = r.list; this.ctx.hud.refreshApp(); return; }
    if (k === 'promote') {
      const p = this.promoPick.get(a) ?? { club: 'zilox', days: 3 }; const s = this.crate.mine.find((x) => x.id === a);
      const rc = await payApi.checkout(`song:${a}`, { club: p.club, days: p.days });
      if (rc) { this.ctx.hud.toast('My Music', `"${s?.title ?? 'Your song'}" is in rotation. DJs see it first and the house drops it between sets.`, GRAD, 'cash', 4.5); await this.loadMine(); }
      return;
    }
    if (k === 'upload') await this.doUpload();
  }
  private async doUpload() {
    const u = this.upload; const f = u.file;
    if (!f) { this.said = 'Pick a song file first.'; this.ctx.hud.refreshApp(); return; }
    if (!u.attest) { this.said = 'Tick the box to say the song is yours to share.'; this.ctx.hud.refreshApp(); return; }
    if (f.size > SONG_MAX_BYTES) { this.said = 'That file is over 8 MB. Export it at 192 kbps or lower.'; this.ctx.hud.refreshApp(); return; }
    u.busy = true; this.ctx.hud.refreshApp();
    try {
      const url = URL.createObjectURL(f); const secs = await new Promise<number>((res) => { const a = new Audio(); a.preload = 'metadata'; a.onloadedmetadata = () => res(a.duration); a.onerror = () => res(0); a.src = url; setTimeout(() => res(0), 8000); }); URL.revokeObjectURL(url);
      if (!(secs >= SONG_MIN_SECS && secs <= SONG_MAX_SECS)) throw new Error(secs ? 'Songs run from 30 seconds to 10 minutes.' : 'Your browser could not read that file. Try an MP3.');
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsDataURL(f); });
      const fixed = data.replace(/^data:(audio\/x-m4a|audio\/mp3|audio\/aac|video\/mp4|application\/octet-stream);/, 'data:audio/mpeg;');
      await net.api('POST', '/api/songs', { data: fixed, title: u.title, artist: u.artist || this.ctx.profile?.name, secs: Math.round(secs), attest: true });
      this.said = 'Uploaded. Our team will listen and clear it for clubs, usually within a day.'; this.upload = { file: null, title: '', artist: u.artist, attest: false, busy: false };
      await this.loadMine();
    } catch (e: any) { this.said = e?.message ?? 'Upload failed.'; }
    u.busy = false; this.ctx.hud.refreshApp();
  }
  /** play your own song on the phone (fetched with your sign-in, so songs still in review work too) */
  private async preview(id: string) {
    let src = this.blobs.get(id);
    if (!src) { try { const r = await fetch(this.songUrl(id), { headers: net.token ? { Authorization: `Bearer ${net.token}` } : {} }); if (!r.ok) throw new Error(); src = URL.createObjectURL(await r.blob()); this.blobs.set(id, src); } catch { this.ctx.hud.toast('My Music', 'Could not load that song.', 'var(--red)', 'msg', 3); return; } }
    const a = (this as any)._pv as HTMLAudioElement | undefined; if (a) { a.pause(); if (a.src === src) { (this as any)._pv = undefined; return; } }
    const p = new Audio(src); (this as any)._pv = p; void p.play().catch(() => {});
  }
}

let C: ClubsLife | null = null;
export const clubsSystem: GameSystem & { get api(): ClubsLife | null } = {
  id: 'clubs',
  get api() { return C; },
  init(ctx) { C = new ClubsLife(ctx); C.init(); },
  start() { C?.start(); },
  frame(_ctx, dt) { C?.frame(dt); },
  filterCommand(_ctx, c) { C?.filterCommand(c); },
  goal() { const t = C?.target; if (!t || !C) return null; const me = (window as any).__life?.ctx?.sim?.local?.pos; if (me && Math.hypot(me.x - t.x, me.z - t.z) < 25) { C.target = null; return null; } return t; },
};
