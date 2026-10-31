// MyAds on the server: the board inventory, quotes, orders, moderation, the live feed every client renders,
// and impressions (one count per real player per ad per Lagos day, plus total sightings).
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError } from './auth.ts';
import type { Payments, PurchaseRec } from './payments.ts';
import type { AccountRow } from './accounts.ts';
import { AD_DAYS, BLIMPS, DRONE_SPOTS, DRONE_TEXT_MAX, adPixels, adQuote, lagosDay, lagosDayStart, type AdBoard, type AdKind } from '../../v2/src/net/rules.ts';

export interface AdRow { id: number; account_id: string; kind: AdKind; board_id: string | null; upload_id: string | null; text: string | null; color: string | null; place: string | null; start_at: number; end_at: number; price_kobo: number; status: string; payment_ref: string | null; note: string | null; created_at: number }
const HOLD_MS = 45 * 60_000; // an unpaid order keeps its slot this long (Paystack's page can take a while)
const DAY = 86_400_000;
const COLORS = ['#ffffff', '#ffd23f', '#3ddc84', '#4fc3f7', '#ff5d8f', '#b388ff', '#ff8a3d'];

/** read the image size from the file header (PNG, JPEG, WebP) without decoding */
export function imageSize(b: Buffer): { mime: string; w: number; h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { mime: 'image/png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]; const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const f = b.toString('ascii', 12, 16);
    if (f === 'VP8 ') return { mime: 'image/webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (f === 'VP8L') { const v = b.readUInt32LE(21); return { mime: 'image/webp', w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (f === 'VP8X') return { mime: 'image/webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  return null;
}

export class Ads extends EventEmitter {
  boards: AdBoard[] = [];
  private byId = new Map<string, AdBoard>();
  private sightings = new Map<string, number>(); // `${ad}:${account}` -> last counted
  private lastFeed = '';
  readonly dir: string;
  constructor(private db: DB, private pay: Payments, dataDir: string, boardsFile = resolve(import.meta.dirname, '../../v2/src/data/billboards.json')) {
    super();
    this.dir = join(dataDir, 'uploads'); mkdirSync(this.dir, { recursive: true });
    try { this.setBoards(JSON.parse(readFileSync(boardsFile, 'utf8'))); } catch { this.setBoards([]); }
    // sold through the one checkout: sku 'ad:new' with the order in meta; the server prices it and holds the slot
    pay.register('ad', { quote: (a, id, meta) => this.quoteOrder(a, id, meta), fulfil: (p) => this.paid(p) });
  }
  setBoards(list: AdBoard[]) { this.boards = list.filter((b) => b && b.id && b.w > 0 && b.h > 0); this.byId = new Map(this.boards.map((b) => [b.id, b])); }
  board(id: string) { return this.byId.get(id); }
  private slots(kind: AdKind, board?: string | null) { return kind === 'board' ? (this.byId.get(board ?? '')?.slots ?? 1) : kind === 'blimp' ? BLIMPS : 1; }
  /** ads that hold a slot in [from, to) */
  private holding(kind: AdKind, key: string | null, from: number, to: number) {
    const col = kind === 'board' ? 'board_id' : 'place';
    return all<AdRow>(this.db, `SELECT * FROM ads WHERE kind=? AND ${kind === 'blimp' ? "1=1" : `${col}=?`} AND start_at < ? AND end_at > ? AND (status IN ('review','approved') OR (status='unpaid' AND created_at > ?))`,
      ...(kind === 'blimp' ? [kind, to, from, Date.now() - HOLD_MS] : [kind, key, to, from, Date.now() - HOLD_MS]));
  }
  free(kind: AdKind, key: string | null, from: number, to: number) { return this.holding(kind, key, from, to).length < this.slots(kind, key); }
  /** first day from `day` on which a run of `days` fits */
  nextFree(kind: AdKind, key: string | null, days = 1, day = lagosDay(Date.now())) {
    let s = lagosDayStart(day);
    for (let k = 0; k < 120; k++, s += DAY) if (this.free(kind, key, s, s + days * DAY)) return lagosDay(s);
    return null;
  }
  inventory() {
    const today = lagosDay(Date.now());
    return this.boards.map((b) => ({ ...b, slots: b.slots ?? 1, px: adPixels(b), day: adQuote('board', 1, { board: b }).day, nextFree: this.nextFree('board', b.id, 1, today) }));
  }
  quote(kind: AdKind, days: number, key?: string) {
    if (kind === 'board') { const b = this.byId.get(key ?? ''); if (!b) throw new HttpError(404, 'That billboard is not on the list.'); return adQuote('board', days, { board: b }); }
    if (kind === 'drone') { if (!DRONE_SPOTS.some((s) => s.id === key)) throw new HttpError(400, 'Pick a place for the show.'); return adQuote('drone', days, { spot: key }); }
    if (kind === 'blimp') return adQuote('blimp', days);
    throw new HttpError(400, 'Unknown ad type.');
  }
  /** save an uploaded picture; boards check the shape against the board */
  saveUpload(accountId: string, dataUrl: string, kind = 'ad') {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
    if (!m) throw new HttpError(400, 'Send a PNG, JPEG or WebP picture.');
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > 3_000_000) throw new HttpError(413, 'That picture is over 3 MB. Export it smaller.');
    const sz = imageSize(buf); if (!sz || sz.mime !== m[1]) throw new HttpError(400, 'That file is not a picture we can read.');
    if (sz.w < 64 || sz.h < 32 || sz.w > 4096 || sz.h > 4096) throw new HttpError(400, 'The picture size is out of range.');
    const n = one<{ n: number }>(this.db, 'SELECT COUNT(*) n FROM uploads WHERE account_id=? AND created_at > ?', accountId, Date.now() - DAY)!.n;
    if (n >= 40) throw new HttpError(429, 'That is enough uploads for today.');
    const id = randomBytes(12).toString('hex'); const ext = sz.mime.split('/')[1];
    writeFileSync(join(this.dir, `${id}.${ext}`), buf);
    run(this.db, 'INSERT INTO uploads(id, account_id, kind, mime, bytes, name, created_at) VALUES(?,?,?,?,?,?,?)', id, accountId, kind, sz.mime, buf.length, `${sz.w}x${sz.h}`, Date.now());
    return { id, mime: sz.mime, w: sz.w, h: sz.h, bytes: buf.length };
  }
  upload(id: string) { return one<{ id: string; account_id: string; mime: string; name: string }>(this.db, 'SELECT * FROM uploads WHERE id=?', id); }
  uploadFile(u: { id: string; mime: string }) { const f = join(this.dir, `${u.id}.${u.mime.split('/')[1]}`); return existsSync(f) ? f : null; }
  /** may this picture be shown to anyone? only once an ad using it was approved */
  isPublic(uploadId: string) { return !!one(this.db, "SELECT 1 FROM ads WHERE upload_id=? AND status='approved'", uploadId); }

  /** price an order and hold its slot (called by payments.start for sku 'ad:new'); the ad row waits as 'unpaid' */
  quoteOrder(acct: AccountRow, id: string, b: Record<string, unknown>) {
    if (id !== 'new') throw new HttpError(404, 'Unknown ad order.');
    const kind = String(b?.kind ?? '') as AdKind; const days = Math.round(Number(b?.days)); const start = String(b?.start ?? lagosDay(Date.now()));
    if (!(AD_DAYS as readonly number[]).includes(days)) throw new HttpError(400, `Pick ${AD_DAYS.join(', ')} days.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || lagosDayStart(start) < lagosDayStart(lagosDay(Date.now())) || lagosDayStart(start) > Date.now() + 90 * DAY) throw new HttpError(400, 'Pick a start date from today up to three months ahead.');
    const from = lagosDayStart(start), to = from + days * DAY;
    let key: string | null = null, upload: string | null = null, text: string | null = null, color: string | null = null, label = '';
    if (kind === 'board' || kind === 'blimp') {
      const u = this.upload(String(b?.upload ?? '')); if (!u || u.account_id !== acct.id) throw new HttpError(400, 'Upload your picture first.');
      upload = u.id; const [w, h] = u.name.split('x').map(Number);
      if (kind === 'board') {
        const bd = this.byId.get(String(b?.board ?? '')); if (!bd) throw new HttpError(404, 'That billboard is not on the list.');
        const want = bd.w / bd.h;
        if (Math.abs(w / h - want) / want > 0.04) throw new HttpError(400, `This board needs a ${adPixels(bd).w} x ${adPixels(bd).h} picture. Yours is ${w} x ${h}.`);
        key = bd.id; label = `Billboard: ${bd.place}`;
      } else { if (Math.abs(w / h - 4) / 4 > 0.05) throw new HttpError(400, 'Blimp banners are 4 to 1, for example 1600 x 400.'); label = 'Blimp banner'; }
    } else if (kind === 'drone') {
      key = String(b?.place ?? ''); const spot = DRONE_SPOTS.find((s) => s.id === key); if (!spot) throw new HttpError(400, 'Pick a place for the show.');
      text = String(b?.text ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
      if (!text || text.length > DRONE_TEXT_MAX) throw new HttpError(400, `Write 1 to ${DRONE_TEXT_MAX} letters for the sky.`);
      if (!/^[A-Z0-9 !?.,'&@#:+\-₦]+$/.test(text)) throw new HttpError(400, 'Drones can draw letters, numbers and simple marks only.');
      color = COLORS.includes(String(b?.color)) ? String(b.color) : COLORS[0]; label = `Drone show over ${spot.name}`;
    } else throw new HttpError(400, 'Unknown ad type.');
    if (!this.free(kind, kind === 'blimp' ? null : key, from, to)) throw new HttpError(409, kind === 'board' ? 'Someone has that board for some of those days. Try another start date.' : kind === 'drone' ? 'That sky is booked for some of those days.' : 'All the blimps are booked for some of those days.');
    const q = this.quote(kind, days, key ?? undefined);
    const ad = run(this.db, 'INSERT INTO ads(account_id, kind, board_id, upload_id, text, color, place, start_at, end_at, price_kobo, status, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      acct.id, kind, kind === 'board' ? key : null, upload, text, color, kind === 'drone' ? key : null, from, to, q.total * 100, 'unpaid', Date.now());
    return { amountKobo: q.total * 100, label: `${label}, ${days} ${kind === 'drone' ? 'night' : 'day'}${days > 1 ? 's' : ''} from ${start}`, meta: { adId: Number(ad.lastInsertRowid) } };
  }
  /** the money landed (inside the payments transaction): the ad goes to review */
  private paid(p: PurchaseRec) {
    const ad = this.get(Number(p.meta.adId)); if (!ad) return { note: 'ad row missing; refund by hand' };
    if (ad.status !== 'unpaid') return { adId: ad.id, status: ad.status };
    // a slow payer can lose the hold; keep the ad but tell the reviewer
    const others = this.holding(ad.kind, ad.kind === 'board' ? ad.board_id : ad.kind === 'drone' ? ad.place : null, ad.start_at, ad.end_at).filter((x) => x.id !== ad.id && x.status !== 'unpaid');
    const clash = others.length >= this.slots(ad.kind, ad.board_id);
    run(this.db, "UPDATE ads SET status='review', payment_ref=?, note=? WHERE id=?", p.ref, clash ? 'Paid after the hold ran out and the slot is now taken: move the dates or refund' : null, ad.id);
    this.emit('note', ad.account_id, 'MyAds', 'Payment received. Your ad is with the review team and goes up once it is approved.');
    return { adId: ad.id };
  }
  get(id: number) { return one<AdRow>(this.db, 'SELECT * FROM ads WHERE id=?', id) ?? null; }
  /** moderation: approve puts it up on its dates; reject refunds the money */
  async review(id: number, decision: 'approve' | 'reject', note = '') {
    const ad = this.get(id); if (!ad) throw new HttpError(404, 'No such ad.');
    if (ad.status !== 'review') throw new HttpError(409, `This ad is ${ad.status}, not waiting for review.`);
    if (decision === 'approve') {
      run(this.db, "UPDATE ads SET status='approved', note=? WHERE id=?", note || null, id);
      this.emit('note', ad.account_id, 'MyAds', ad.start_at <= Date.now() ? 'Your ad is approved and live now.' : `Your ad is approved. It goes up on ${lagosDay(ad.start_at)}.`);
    } else {
      const r = ad.payment_ref ? await this.pay.refund(ad.payment_ref, note || 'Ad not approved') : { ok: true, status: 'none' };
      run(this.db, "UPDATE ads SET status='rejected', note=? WHERE id=?", (note || 'Not approved') + (r.ok ? '' : ' (refund needs a manual check)'), id);
      this.emit('note', ad.account_id, 'MyAds', `Your ad was not approved${note ? `: ${note}` : '.'} ${r.ok ? 'Your money is on its way back.' : 'We will refund you by hand.'}`);
    }
    this.pushFeed(true);
    return this.get(id)!;
  }
  queue(status = 'review') { return all<AdRow & { owner: string | null }>(this.db, 'SELECT a.*, f.name owner FROM ads a LEFT JOIN profiles f ON f.account_id=a.account_id WHERE a.status=? ORDER BY a.created_at LIMIT 200', status); }
  /** what every client draws right now */
  live(now = Date.now()) {
    return all<AdRow>(this.db, "SELECT * FROM ads WHERE status='approved' AND start_at <= ? AND end_at > ? ORDER BY id", now, now)
      .map((a) => ({ id: a.id, kind: a.kind, board: a.board_id, img: a.upload_id ? `/api/uploads/${a.upload_id}` : null, text: a.text, color: a.color, place: a.place, until: a.end_at }));
  }
  /** emit 'feed' when the live set changed (called every minute and after a review) */
  pushFeed(force = false) { const l = this.live(); const k = JSON.stringify(l.map((a) => a.id)); if (force || k !== this.lastFeed) { this.lastFeed = k; this.emit('feed', l); } return l; }
  /** a player saw these ads on screen */
  seen(accountId: string, ids: unknown) {
    if (!Array.isArray(ids)) return 0;
    const now = Date.now(); const day = lagosDay(now); let n = 0;
    const live = new Map(all<{ id: number; account_id: string }>(this.db, "SELECT id, account_id FROM ads WHERE status='approved' AND start_at <= ? AND end_at > ?", now, now).map((a) => [a.id, a.account_id]));
    for (const raw of ids.slice(0, 60)) {
      const id = Number(raw); const owner = live.get(id); if (!owner || owner === accountId) continue; // your own views do not count
      run(this.db, 'INSERT OR IGNORE INTO ad_views(ad_id, account_id, day) VALUES(?,?,?)', id, accountId, day);
      const k = `${id}:${accountId}`; if ((this.sightings.get(k) ?? 0) > now - 5 * 60_000) continue;
      this.sightings.set(k, now); n++;
      run(this.db, 'INSERT INTO ad_daily(ad_id, day, sightings) VALUES(?,?,1) ON CONFLICT(ad_id, day) DO UPDATE SET sightings = sightings + 1', id, day);
    }
    if (this.sightings.size > 50_000) for (const [k, t] of this.sightings) if (t < now - 5 * 60_000) this.sightings.delete(k);
    return n;
  }
  /** an owner's campaigns with reach per day */
  mine(accountId: string) {
    const list = all<AdRow>(this.db, "SELECT * FROM ads WHERE account_id=? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 50", accountId);
    return list.map((a) => {
      const days = all<{ day: string; people: number }>(this.db, 'SELECT day, COUNT(*) people FROM ad_views WHERE ad_id=? GROUP BY day ORDER BY day', a.id);
      const sight = new Map(all<{ day: string; sightings: number }>(this.db, 'SELECT day, sightings FROM ad_daily WHERE ad_id=?', a.id).map((d) => [d.day, d.sightings]));
      const total = one<{ n: number }>(this.db, 'SELECT COUNT(DISTINCT account_id) n FROM ad_views WHERE ad_id=?', a.id)!.n;
      const now = Date.now(); const state = a.status === 'approved' ? (now < a.start_at ? 'scheduled' : now >= a.end_at ? 'ended' : 'live') : a.status;
      return { id: a.id, kind: a.kind, board: a.board_id, place: a.place, text: a.text, color: a.color, img: a.upload_id ? `/api/uploads/${a.upload_id}` : null, start: lagosDay(a.start_at), end: lagosDay(a.end_at - 1), naira: a.price_kobo / 100, status: state, note: a.note, payment: a.payment_ref,
        reach: total, days: days.map((d) => ({ day: d.day, people: d.people, sightings: sight.get(d.day) ?? 0 })) };
    });
  }
}
