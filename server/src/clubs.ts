// The three parody clubs on the server: who is on the decks and the pole stages, what is playing, the house paying
// its workers by the minute (more when the room is full, capped per day), spraying money on the DJ and the dancers,
// shutting a club down for the night, and songs players upload, attest they own, and pay real money to promote into
// club rotation (sku 'song:<id>' through the one Paystack checkout). Poses come from v2/src/data/clubs.json, the same
// data the client builds the clubs from. Pole stage work is athletic and clothed: a job, never sexual.
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError } from './auth.ts';
import type { Economy } from './economy.ts';
import type { Payments, PurchaseRec } from './payments.ts';
import type { AccountRow } from './accounts.ts';
import { lagosDay } from '../../v2/src/net/rules.ts';
import {
  CLUB_IDS, CLUB_RULES, CLUB_REACH, DECK_REACH, HOUSE_SET, POLE_REACH, SHUTDOWN_MIN, SONG_ARTIST_MAX, SONG_DAY_UPLOADS, SONG_KEEP, SONG_MAX_BYTES, SONG_MAX_SECS,
  SONG_MIN_SECS, SONG_TITLE_MAX, SPRAY_GAP_MS, SPRAY_NOTES, audioKind, cleanSongText, cleanTrack, clubHours, dayCap, isClub, promoQuote, shiftPay, sprayNet,
  BOTTLE_GAP_MS, BOTTLE_PRICE, DOOR_REACH, DRESS_CODE, NO_BAND, VIP_MIN, VIP_PRICE, coverFor, nightOf,
  type ClubId, type ClubTrack, type PassKind,
} from '../../v2/src/net/clubs.ts';

interface Pose { x: number; y: number; z: number }
interface ClubPlace { id: ClubId; floor: Pose; dj: Pose; poles: (Pose & { id: string })[]; roof: number | null; door: Pose; vip: (Pose & { id: string })[] }
export interface Table { by: string; name: string; until: number; lastBottle: number; bottles: number }
export interface Post { accountId: string; name: string; since: number; paidTo: number; earned: number }
export interface Pos { x: number; y?: number; z: number }
interface Live { id: ClubId; dj: Post | null; poles: Record<string, Post>; track: ClubTrack | null; shutdown: { by: string; name: string; until: number } | null; crowd: number; lastTrack: number; house: number; vip: Record<string, Table> }
export interface SongRow { id: string; account_id: string; title: string; artist: string; mime: string; bytes: number; secs: number; status: string; note: string | null; plays: number; attest_at: number; created_at: number }
interface PromoRow { id: number; song_id: string; account_id: string; club: string; start_at: number; end_at: number; price_kobo: number; status: string; payment_ref: string | null; created_at: number }
const DAY = 86_400_000;
const EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

export class Clubs extends EventEmitter {
  places: ClubPlace[] = [];
  live = new Map<ClubId, Live>();
  private paid = new Map<string, number>(); // `${acct}:${job}:${day}` -> naira paid by the house today
  private lastSpray = new Map<string, number>();
  /** wristbands: `${acct}:${club}:${night}` -> guest (paid cover or came in free) or staff (here to work) */
  private passes = new Map<string, PassKind>();
  readonly dir: string;
  constructor(private db: DB, private econ: Economy, private pay: Payments | null, dataDir: string, file = resolve(import.meta.dirname, '../../v2/src/data/clubs.json')) {
    super();
    this.dir = join(dataDir, 'songs'); mkdirSync(this.dir, { recursive: true });
    let raw: any[] = []; try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { raw = []; }
    for (const c of raw) if (isClub(c.id)) this.places.push({ id: c.id, floor: c.floor, dj: c.dj, poles: c.poles ?? [], roof: c.kind === 'rooftop' ? Number(c.roofY) : null, door: c.door, vip: c.vip ?? [] });
    for (const id of CLUB_IDS) this.live.set(id, { id, dj: null, poles: {}, track: null, shutdown: null, crowd: 0, lastTrack: 0, house: 0, vip: {} });
    // promotion is sold through the one checkout: sku 'song:<songId>' with { club, days } in meta
    pay?.register('song', { quote: (a, id, meta) => this.quotePromo(a, id, meta), fulfil: (p) => this.promoPaid(p) });
  }
  place(id: ClubId) { return this.places.find((p) => p.id === id); }
  private club(id: unknown) { if (!isClub(id)) throw new HttpError(404, 'No club by that name.'); return this.live.get(id)!; }
  /** the rooftop is 65 m up: being under it on the street is not being in it */
  private near(p: Pos, at: Pose, r: number, roof: number | null) { if (roof !== null && p.y !== undefined && Math.abs(p.y - roof) > 8) return false; return Math.hypot(p.x - at.x, p.z - at.z) <= r; }
  inClub(id: ClubId, p: Pos) { const pl = this.place(id); return !!pl && this.near(p, pl.floor, CLUB_REACH, pl.roof); }
  /** which club, if any, a position is in */
  whereIs(p: Pos): ClubId | null { for (const pl of this.places) if (this.near(p, pl.floor, CLUB_REACH, pl.roof)) return pl.id; return null; }
  private posts(L: Live) { const o: { job: 'dj' | 'pole'; key: string; post: Post }[] = []; if (L.dj) o.push({ job: 'dj', key: 'dj', post: L.dj }); for (const [k, p] of Object.entries(L.poles)) o.push({ job: 'pole', key: k, post: p }); return o; }
  /** the account's current shift anywhere */
  shiftOf(acct: string) { for (const L of this.live.values()) for (const s of this.posts(L)) if (s.post.accountId === acct) return { club: L.id, ...s }; return null; }

  view(id: ClubId, now = Date.now()) {
    const L = this.live.get(id)!; const sh = L.shutdown && L.shutdown.until > now ? L.shutdown : null;
    return { id, dj: L.dj ? { id: L.dj.accountId, name: L.dj.name, since: L.dj.since } : null, poles: Object.fromEntries(Object.entries(L.poles).map(([k, p]) => [k, { id: p.accountId, name: p.name }])),
      track: L.track, shutdown: sh, crowd: L.crowd, cover: coverFor(id, clubHours(now), !!sh),
      vip: Object.fromEntries(Object.entries(L.vip).filter(([, t]) => t.until > now).map(([k, t]) => [k, { id: t.by, name: t.name, until: t.until }])) };
  }
  views(now = Date.now()) { return CLUB_IDS.map((id) => this.view(id, now)); }
  private changed(id: ClubId) { this.emit('club', this.view(id)); }

  // ------------------------------------------------------------------------------------------ the door
  private shut(L: Live, now: number) { return !!L.shutdown && L.shutdown.until > now; }
  private key(acct: string, id: ClubId, now: number) { return `${acct}:${id}:${nightOf(clubHours(now))}`; }
  pass(acct: string, id: ClubId, now = Date.now()): PassKind | null { return this.passes.get(this.key(acct, id, now)) ?? null; }
  /** hand a wristband out (tests, admin, a VIP booking) */
  admit(acct: string, id: ClubId, kind: PassKind, now = Date.now()) { const k = this.key(acct, id, now); if (this.passes.get(k) !== 'guest') this.passes.set(k, kind); }
  /** can this person buy, spray and book in here right now? By day and during a shutdown nobody pays at the door */
  guestOk(acct: string, id: ClubId, now = Date.now()) { const L = this.live.get(id)!; return coverFor(id, clubHours(now), this.shut(L, now)) === 0 || this.pass(acct, id, now) === 'guest'; }
  private needGuest(acct: string, id: ClubId, now: number) { if (!this.guestOk(acct, id, now)) throw new HttpError(403, NO_BAND, { code: 'band' }); }
  /** the bouncer: pay cover (cash only, the man at the door does not do transfer), or walk in as staff to work the decks or a stage */
  enter(acct: string, id: unknown, kind: unknown, p: Pos, stripped: boolean, now = Date.now()) {
    const L = this.club(id); const pl = this.place(L.id)!; const want: PassKind = kind === 'staff' ? 'staff' : 'guest';
    const atDoor = Math.hypot(p.x - pl.door.x, p.z - pl.door.z) <= DOOR_REACH || this.inClub(L.id, p);
    if (!atDoor) throw new HttpError(400, 'Talk to the bouncer at the door.');
    if (stripped) throw new HttpError(403, DRESS_CODE, { code: 'dress' });
    const have = this.pass(acct, L.id, now);
    if (have === 'guest' || (have === want)) return { club: L.id, pass: have, paid: 0 };
    const fee = want === 'staff' ? 0 : coverFor(L.id, clubHours(now), this.shut(L, now));
    if (fee) {
      if (this.econ.wallet(acct).cash < fee) throw new HttpError(402, `Cover is ₦${fee.toLocaleString('en-NG')}, cash.`, { code: 'broke' });
      this.econ.adjust(acct, -fee, 0, 'club.cover', { note: CLUB_RULES[L.id].short });
    }
    this.admit(acct, L.id, want, now); return { club: L.id, pass: want, paid: fee };
  }

  // ------------------------------------------------------------------------------------------ VIP tables
  /** book a table for VIP_MIN minutes: the first bottle is on the house, your name is on the table, and the wristband comes with it */
  bookVip(acct: string, name: string, id: unknown, table: unknown, p: Pos, now = Date.now()) {
    const L = this.club(id); const pl = this.place(L.id)!; const t = pl.vip.find((v) => v.id === table); const R = CLUB_RULES[L.id];
    if (!t) throw new HttpError(404, 'No VIP table there.');
    if (!this.inClub(L.id, p)) throw new HttpError(400, 'Come inside to book a table.');
    this.needGuest(acct, L.id, now);
    const held = L.vip[t.id]; if (held && held.until > now) { if (held.by === acct) throw new HttpError(409, 'This table is already yours.'); throw new HttpError(409, `Reserved for ${held.name}.`); }
    if (Object.values(L.vip).some((v) => v.by === acct && v.until > now)) throw new HttpError(409, `You already have a table at ${R.short}.`);
    const price = VIP_PRICE[L.id]; const w = this.econ.wallet(acct);
    if (w.cash + w.bank < price) throw new HttpError(402, `A VIP table at ${R.short} is ₦${price.toLocaleString('en-NG')}.`, { code: 'broke' });
    const c = Math.min(w.cash, price); this.econ.adjust(acct, -c, -(price - c), 'club.vip', { note: R.short });
    L.vip[t.id] = { by: acct, name, until: now + VIP_MIN * 60_000, lastBottle: now, bottles: 1 }; this.admit(acct, L.id, 'guest', now);
    this.changed(L.id); this.emit('vip', { club: L.id, table: t.id, name }); return this.view(L.id, now);
  }
  /** bottle service at your own table: pricey, and the money leaves the economy (the house keeps it) */
  bottle(acct: string, id: unknown, p: Pos, now = Date.now()) {
    const L = this.club(id); const R = CLUB_RULES[L.id];
    const e = Object.entries(L.vip).find(([, v]) => v.by === acct && v.until > now); if (!e) throw new HttpError(403, 'Bottle service is for your own VIP table.');
    if (!this.inClub(L.id, p)) throw new HttpError(400, 'Go back to your table first.');
    const [table, t] = e; if (now - t.lastBottle < BOTTLE_GAP_MS) throw new HttpError(429, 'Waiter: "Your last bottle never finish, oga."');
    const price = BOTTLE_PRICE[L.id]; const w = this.econ.wallet(acct);
    if (w.cash + w.bank < price) throw new HttpError(402, `A bottle here is ₦${price.toLocaleString('en-NG')}.`, { code: 'broke' });
    const c = Math.min(w.cash, price); this.econ.adjust(acct, -c, -(price - c), 'club.bottle', { note: R.short });
    t.lastBottle = now; t.bottles++; this.emit('bottle', { club: L.id, table, name: t.name }); return { club: L.id, table, bottles: t.bottles, price };
  }

  // ------------------------------------------------------------------------------------------ shifts
  takeDecks(acct: string, name: string, id: unknown, p: Pos, now = Date.now()) {
    const L = this.club(id); const pl = this.place(L.id)!;
    if (!this.near(p, pl.dj, DECK_REACH, pl.roof)) throw new HttpError(400, 'Go up to the DJ booth first.');
    if (L.dj && L.dj.accountId !== acct) throw new HttpError(409, `${L.dj.name} is on the decks. Wait your turn.`);
    const cur = this.shiftOf(acct); if (cur && !(cur.club === L.id && cur.job === 'dj')) this.endShift(acct);
    if (!L.dj) { L.dj = { accountId: acct, name, since: now, paidTo: now, earned: 0 }; L.lastTrack = 0; this.changed(L.id); }
    return this.view(L.id);
  }
  takePole(acct: string, name: string, id: unknown, pole: unknown, p: Pos, stripped: boolean, now = Date.now()) {
    const L = this.club(id); const pl = this.place(L.id)!; const st = pl.poles.find((q) => q.id === pole);
    if (!st) throw new HttpError(404, 'No pole stage there.');
    if (stripped) throw new HttpError(403, 'Manager: "Go and dress first. This is a stage, not a bathroom."');
    if (!this.near(p, st, POLE_REACH + 1, pl.roof)) throw new HttpError(400, 'Stand by the stage first.');
    const held = L.poles[st.id]; if (held && held.accountId !== acct) throw new HttpError(409, `${held.name} is on that stage.`);
    const cur = this.shiftOf(acct); if (cur && !(cur.club === L.id && cur.key === st.id)) this.endShift(acct);
    if (!held) { L.poles[st.id] = { accountId: acct, name, since: now, paidTo: now, earned: 0 }; this.changed(L.id); }
    return this.view(L.id);
  }
  /** end whatever shift the account is on; returns what the house paid for it */
  endShift(acct: string, now = Date.now()) {
    const s = this.shiftOf(acct); if (!s) return null; const L = this.live.get(s.club)!;
    this.payPost(L, s.job, s.post, now);
    if (s.job === 'dj') L.dj = null; else delete L.poles[s.key];
    this.changed(L.id); return { club: L.id, job: s.job, earned: s.post.earned };
  }
  private payPost(L: Live, job: 'dj' | 'pole', post: Post, now: number) {
    const mins = Math.min(1.5, (now - post.paidTo) / 60_000); post.paidTo = now; if (mins <= 0) return 0;
    const day = lagosDay(now); const k = `${post.accountId}:${job}:${day}`; const sofar = this.paid.get(k) ?? 0;
    const n = Math.min(Math.round(shiftPay(job, L.crowd, clubHours(now)) * mins), dayCap(job) - sofar); if (n <= 0) return 0;
    this.paid.set(k, sofar + n); post.earned += n;
    this.econ.adjust(post.accountId, n, 0, job === 'dj' ? 'club.dj' : 'club.pole', { note: CLUB_RULES[L.id].short, silent: true });
    return n;
  }
  /** every few seconds from the hub: count the room, pay the shifts, drop workers who walked off or logged out, run the house set */
  tick(online: Map<string, Pos>, now = Date.now()) {
    for (const L of this.live.values()) {
      const pl = this.place(L.id); if (!pl) continue;
      let crowd = 0; for (const p of online.values()) if (this.near(p, pl.floor, CLUB_REACH, pl.roof)) crowd++;
      const was = L.crowd; L.crowd = crowd; let dirty = Math.abs(was - crowd) > 0;
      for (const s of this.posts(L)) {
        const p = online.get(s.post.accountId);
        const at = s.job === 'dj' ? pl.dj : pl.poles.find((q) => q.id === s.key)!;
        if (!p || !this.near(p, at, (s.job === 'dj' ? DECK_REACH : POLE_REACH) + 2, pl.roof)) { this.payPost(L, s.job, s.post, now); if (s.job === 'dj') L.dj = null; else delete L.poles[s.key]; this.emit('ended', s.post.accountId, L.id, s.job, s.post.earned); dirty = true; continue; }
        this.payPost(L, s.job, s.post, now);
      }
      if (L.shutdown && L.shutdown.until <= now) { L.shutdown = null; dirty = true; }
      for (const [k, t] of Object.entries(L.vip)) if (t.until <= now) { delete L.vip[k]; dirty = true; }
      // nobody on the decks: the house set, with paid promotions dropped in between
      if (!L.dj && (!L.track || now > L.track.at + L.track.secs * 1000)) { L.track = this.nextHouse(L, now); dirty = true; }
      if (dirty) this.changed(L.id);
    }
    if (this.passes.size > 20_000) { const n = nightOf(clubHours(now)); for (const k of this.passes.keys()) if (!k.endsWith(`:${n}`)) this.passes.delete(k); }
    if (this.paid.size > 20_000) { const d = lagosDay(now); for (const k of this.paid.keys()) if (!k.endsWith(d)) this.paid.delete(k); }
  }
  private nextHouse(L: Live, now: number): ClubTrack {
    const promo = this.promoted(L.id, now);
    if (promo.length && L.house % 2 === 0) {
      const s = promo[Math.floor(Math.random() * promo.length)]; L.house++;
      run(this.db, 'UPDATE songs SET plays = plays + 1 WHERE id=?', s.id);
      return { src: 'song', id: s.id, title: s.title, artist: s.artist, secs: s.secs, at: now, promo: true };
    }
    const h = HOUSE_SET[L.house++ % HOUSE_SET.length]; return { src: 'house', id: h.id, title: h.title, artist: h.artist, secs: h.secs, at: now };
  }
  play(acct: string, id: unknown, raw: unknown, now = Date.now()) {
    const L = this.club(id); if (L.dj?.accountId !== acct) throw new HttpError(403, 'Only the DJ on the decks can change the song.');
    if (now - L.lastTrack < 6000) throw new HttpError(429, 'Let the song breathe small.');
    const t = cleanTrack(raw, now); if (!t) throw new HttpError(400, 'That track cannot play here.');
    if (t.src === 'song') {
      const s = this.song(t.id); if (!s || s.status !== 'approved') throw new HttpError(403, 'That song has not been cleared for clubs yet.');
      t.title = s.title; t.artist = s.artist; t.secs = s.secs; t.promo = this.promoted(L.id, now).some((x) => x.id === s.id);
      run(this.db, 'UPDATE songs SET plays = plays + 1 WHERE id=?', s.id);
    }
    if (t.src === 'house') { const h = HOUSE_SET.find((x) => x.id === t.id); if (!h) throw new HttpError(400, 'No house track by that name.'); Object.assign(t, { title: h.title, artist: h.artist, secs: h.secs }); }
    t.by = L.dj.name; L.track = t; L.lastTrack = now; this.changed(L.id); return this.view(L.id);
  }

  // ------------------------------------------------------------------------------------------ money in the room
  spray(acct: string, name: string, id: unknown, to: unknown, amount: unknown, p: Pos, now = Date.now()) {
    const L = this.club(id); if (!this.inClub(L.id, p)) throw new HttpError(400, 'You have to be in the club to spray.');
    this.needGuest(acct, L.id, now);
    const n = Number(amount); if (!(SPRAY_NOTES as readonly number[]).includes(n)) throw new HttpError(400, 'Pick a bundle.');
    if ((this.lastSpray.get(acct) ?? 0) > now - SPRAY_GAP_MS) throw new HttpError(429, 'Easy. One bundle at a time.');
    const target = String(to ?? 'floor'); let tgt: Post | null = null;
    if (target !== 'floor') { tgt = L.dj?.accountId === target ? L.dj : Object.values(L.poles).find((q) => q.accountId === target) ?? null; if (!tgt) throw new HttpError(404, 'They are not working here right now.'); if (tgt.accountId === acct) throw new HttpError(400, 'You cannot spray yourself.'); }
    if (this.econ.wallet(acct).cash < n) throw new HttpError(402, 'Not enough cash on you. Nobody sprays transfer.', { code: 'broke' });
    this.lastSpray.set(acct, now);
    this.db.transaction(() => {
      this.econ.adjust(acct, -n, 0, 'club.spray', { note: `${CLUB_RULES[L.id].short} ${tgt ? tgt.name : 'floor'}` });
      if (tgt) this.econ.adjust(tgt.accountId, sprayNet(n), 0, 'club.sprayed', { note: name });
    })();
    if (tgt) tgt.earned += sprayNet(n);
    const ev = { club: L.id, from: name, fromId: acct, to: tgt ? tgt.name : null, toId: tgt?.accountId ?? null, amount: n };
    this.emit('spray', ev); return ev;
  }
  shutdown(acct: string, name: string, id: unknown, p: Pos, now = Date.now()) {
    const L = this.club(id); const r = CLUB_RULES[L.id];
    if (!this.inClub(L.id, p)) throw new HttpError(400, 'You have to be inside to shut it down.');
    this.needGuest(acct, L.id, now);
    if (L.shutdown && L.shutdown.until > now) throw new HttpError(409, `${L.shutdown.name} already shut ${r.short} down tonight.`);
    const w = this.econ.wallet(acct); if (w.cash + w.bank < r.shutdown) throw new HttpError(402, `Shutting down ${r.short} costs ₦${r.shutdown.toLocaleString('en-NG')}.`, { code: 'broke' });
    const c = Math.min(w.cash, r.shutdown); this.econ.adjust(acct, -c, -(r.shutdown - c), 'club.shutdown', { note: r.short });
    L.shutdown = { by: acct, name, until: now + SHUTDOWN_MIN * 60_000 }; this.changed(L.id);
    this.emit('shutdown', { club: L.id, name, until: L.shutdown.until }); return this.view(L.id);
  }
  /** the bar: a guest's wristband at night, free while a shutdown holds */
  buyDrink(acct: string, p: Pos, now = Date.now()) {
    const where = this.whereIs(p); if (!where) throw new HttpError(400, 'Find the bar inside a club.');
    this.needGuest(acct, where, now); const price = this.barPrice(where, now);
    if (price) { if (this.econ.wallet(acct).cash < price) throw new HttpError(402, 'Not enough cash for a drink.', { code: 'broke' }); this.econ.adjust(acct, -price, 0, 'club.bar', { note: where }); }
    return { club: where, price };
  }
  /** free drinks while a shutdown holds */
  barPrice(id: ClubId, now = Date.now()) { const L = this.live.get(id)!; return L.shutdown && L.shutdown.until > now ? 0 : CLUB_RULES[id].bar; }

  // ------------------------------------------------------------------------------------------ songs
  saveSong(acct: string, b: { data?: unknown; title?: unknown; artist?: unknown; secs?: unknown; attest?: unknown }, now = Date.now()) {
    if (b.attest !== true) throw new HttpError(400, 'Tick the box to say you own this song or have the right to share it.');
    const title = cleanSongText(b.title, SONG_TITLE_MAX), artist = cleanSongText(b.artist, SONG_ARTIST_MAX);
    if (!title || !artist) throw new HttpError(400, 'Give the song a title and an artist name.');
    const m = /^data:audio\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data ?? '')); if (!m) throw new HttpError(400, 'Send an MP3, OGG or M4A file.');
    const buf = Buffer.from(m[1], 'base64'); if (buf.length > SONG_MAX_BYTES) throw new HttpError(413, 'That song is over 8 MB. Export it at 192 kbps or lower.');
    const mime = audioKind(buf); if (!mime) throw new HttpError(400, 'That file is not audio we can play. Use MP3, OGG or M4A.');
    const secs = Math.round(Number(b.secs)); if (!(secs >= SONG_MIN_SECS && secs <= SONG_MAX_SECS)) throw new HttpError(400, 'Songs run from 30 seconds to 10 minutes.');
    const today = one<{ n: number }>(this.db, 'SELECT COUNT(*) n FROM songs WHERE account_id=? AND created_at > ?', acct, now - DAY)!.n;
    if (today >= SONG_DAY_UPLOADS) throw new HttpError(429, 'That is enough uploads for today.');
    const kept = one<{ n: number }>(this.db, "SELECT COUNT(*) n FROM songs WHERE account_id=? AND status != 'deleted'", acct)!.n;
    if (kept >= SONG_KEEP) throw new HttpError(409, 'Your library is full. Delete a song first.');
    const id = 'sg_' + randomBytes(6).toString('hex');
    writeFileSync(join(this.dir, `${id}.${EXT[mime]}`), buf);
    run(this.db, 'INSERT INTO songs(id, account_id, title, artist, mime, bytes, secs, status, attest_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id, acct, title, artist, mime, buf.length, secs, 'review', now, now);
    return this.songView(this.song(id)!);
  }
  song(id: string) { return one<SongRow>(this.db, 'SELECT * FROM songs WHERE id=?', String(id)) ?? null; }
  songFile(s: SongRow) { const f = join(this.dir, `${s.id}.${EXT[s.mime] ?? 'mp3'}`); return existsSync(f) ? f : null; }
  /** who may hear the file: the owner and staff always, everyone once it is cleared */
  canHear(s: SongRow, acct: AccountRow | null) { return s.status === 'approved' || (!!acct && (acct.id === s.account_id || acct.role !== 'player')); }
  private songView(s: SongRow, now = Date.now()) {
    const promos = all<PromoRow>(this.db, "SELECT * FROM song_promos WHERE song_id=? AND status='paid' AND end_at > ? ORDER BY end_at", s.id, now);
    return { id: s.id, title: s.title, artist: s.artist, secs: s.secs, status: s.status, note: s.note, plays: s.plays, url: `/api/songs/${s.id}/audio`, promos: promos.map((p) => ({ club: p.club, until: p.end_at })) };
  }
  mine(acct: string) { return all<SongRow>(this.db, "SELECT * FROM songs WHERE account_id=? AND status != 'deleted' ORDER BY created_at DESC", acct).map((s) => this.songView(s)); }
  remove(acct: string, id: unknown) { const s = this.song(String(id)); if (!s || s.account_id !== acct) throw new HttpError(404, 'Not your song.'); run(this.db, "UPDATE songs SET status='deleted' WHERE id=?", s.id); return this.mine(acct); }
  /** songs with a paid promotion running in this club now */
  promoted(club: ClubId, now = Date.now()) {
    return all<SongRow>(this.db, "SELECT DISTINCT s.* FROM song_promos p JOIN songs s ON s.id=p.song_id WHERE p.status='paid' AND p.start_at <= ? AND p.end_at > ? AND (p.club=? OR p.club='all') AND s.status='approved'", now, now, club);
  }
  /** the DJ crate: every cleared song, promoted ones for this club first */
  crate(club: ClubId, now = Date.now()) {
    const pro = new Set(this.promoted(club, now).map((s) => s.id));
    return all<SongRow & { owner: string | null }>(this.db, "SELECT s.*, f.name owner FROM songs s LEFT JOIN profiles f ON f.account_id=s.account_id WHERE s.status='approved' ORDER BY s.plays DESC LIMIT 200")
      .map((s) => ({ id: s.id, title: s.title, artist: s.artist, secs: s.secs, owner: s.owner, promo: pro.has(s.id), url: `/api/songs/${s.id}/audio` }))
      .sort((a, b) => Number(b.promo) - Number(a.promo));
  }
  queue(status = 'review') { return all<SongRow & { owner: string | null }>(this.db, 'SELECT s.*, f.name owner FROM songs s LEFT JOIN profiles f ON f.account_id=s.account_id WHERE s.status=? ORDER BY s.created_at LIMIT 200', status); }
  /** moderation: a rejected song's paid promotions are refunded */
  async review(id: string, decision: 'approve' | 'reject', note = '') {
    const s = this.song(id); if (!s) throw new HttpError(404, 'No such song.');
    if (decision === 'approve') { run(this.db, "UPDATE songs SET status='approved', note=? WHERE id=?", note || null, id); this.emit('note', s.account_id, 'My Music', `"${s.title}" is cleared. DJs can play it in every club now.`); }
    else {
      run(this.db, "UPDATE songs SET status='rejected', note=? WHERE id=?", note || 'Not cleared', id);
      for (const p of all<PromoRow>(this.db, "SELECT * FROM song_promos WHERE song_id=? AND status='paid'", id)) {
        const r = p.payment_ref && this.pay ? await this.pay.refund(p.payment_ref, note || 'Song not cleared') : { ok: false };
        run(this.db, "UPDATE song_promos SET status=? WHERE id=?", r.ok ? 'refunded' : 'refund_due', p.id);
      }
      this.emit('note', s.account_id, 'My Music', `"${s.title}" was not cleared${note ? `: ${note}` : '.'}`);
    }
    return this.song(id)!;
  }
  private quotePromo(a: AccountRow, id: string, meta: Record<string, unknown>) {
    const s = this.song(id); if (!s || s.account_id !== a.id || s.status === 'deleted') throw new HttpError(404, 'That song is not in your library.');
    if (s.status !== 'approved') throw new HttpError(409, 'Wait until the song is cleared, then promote it.');
    const club = meta?.club === 'all' ? 'all' : isClub(meta?.club) ? meta.club as ClubId : null; if (!club) throw new HttpError(400, 'Pick a club, or all of them.');
    const q = promoQuote(club, Math.round(Number(meta?.days))); if (!q) throw new HttpError(400, 'Pick 1, 3, 7, 14 or 30 days.');
    const r = run(this.db, 'INSERT INTO song_promos(song_id, account_id, club, start_at, end_at, price_kobo, status, created_at) VALUES(?,?,?,?,?,?,?,?)', s.id, a.id, club, 0, 0, q.total * 100, 'unpaid', Date.now());
    return { amountKobo: q.total * 100, label: `Club rotation: "${s.title}" in ${club === 'all' ? 'every club' : CLUB_RULES[club].short}, ${q.days} day${q.days > 1 ? 's' : ''}`, meta: { promoId: Number(r.lastInsertRowid), days: q.days } };
  }
  /** the money landed: the run starts now (stacking after any run already going for that song and club) */
  private promoPaid(p: PurchaseRec) {
    const pr = one<PromoRow>(this.db, 'SELECT * FROM song_promos WHERE id=?', Number(p.meta.promoId)); if (!pr) return { note: 'promo row missing; refund by hand' };
    if (pr.status !== 'unpaid') return { promoId: pr.id, status: pr.status };
    const now = Date.now(); const days = Math.round(Number(p.meta.days)) || 1;
    const last = one<{ e: number | null }>(this.db, "SELECT MAX(end_at) e FROM song_promos WHERE song_id=? AND club=? AND status='paid'", pr.song_id, pr.club)?.e ?? 0;
    const start = Math.max(now, last ?? 0);
    run(this.db, "UPDATE song_promos SET status='paid', start_at=?, end_at=?, payment_ref=? WHERE id=?", start, start + days * DAY, p.ref, pr.id);
    return { promoId: pr.id, until: start + days * DAY };
  }
}
