// Server authoritative money and land. Every change to cash, bank or plot ownership goes through here, inside one SQLite
// transaction, and is written to tx_log. The client never tells the server what it has; it asks, and the server answers.
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError } from './auth.ts';
import type { ContentStore } from './content.ts';
import { plotPriceOf, withdrawNet } from '../../v2/src/net/rules.ts';

export interface Wallet { cash: number; bank: number }
export interface PlayerRow { account_id: string; cash: number; bank: number; x: number | null; y: number | null; z: number | null; vehicles: string; skills: string; missions: string; blobs: string; play_seconds: number; updated_at: number }
export interface PlotRow { id: string; owner_id: string; pts: string | null; price: number; bought_at: number; cx: number | null; cz: number | null }
export interface PlotRec { id: string; cx: number; cz: number; area: number; zone: string; rich: number; price: number }

const ZONES = ['vacant', 'residential', 'commercial', 'industrial', 'institution', 'unfinished'];
const MAX_MONEY = 9_000_000_000_000; // stays inside JS safe integers with room to spare

/** The map's plots (id, centre, area, zone, price) loaded from plots.bin, built by tools/build-plots.ts. */
export class PlotIndex {
  map = new Map<string, PlotRec>();
  loaded = false;
  load(file: string) {
    if (!existsSync(file)) return 0;
    const b = readFileSync(file); if (b.length < 8 || b.toString('latin1', 0, 4) !== 'HLPX') return 0;
    const n = b.readUInt32LE(4); let o = 8;
    for (let i = 0; i < n; i++) {
      const l = b[o++]; const id = b.toString('utf8', o, o + l); o += l;
      const cx = b.readFloatLE(o), cz = b.readFloatLE(o + 4), area = b.readFloatLE(o + 8), zone = ZONES[b[o + 12]] ?? 'residential', rich = b[o + 13] / 255, price = b.readUInt32LE(o + 14); o += 18;
      this.map.set(id, { id, cx, cz, area, zone, rich, price });
    }
    this.loaded = this.map.size > 0; return this.map.size;
  }
  static encode(recs: PlotRec[]): Buffer {
    const parts: Buffer[] = []; const head = Buffer.alloc(8); head.write('HLPX', 0, 'latin1'); head.writeUInt32LE(recs.length, 4); parts.push(head);
    for (const r of recs) {
      const id = Buffer.from(r.id, 'utf8'); const rec = Buffer.alloc(1 + id.length + 18); rec[0] = id.length; id.copy(rec, 1);
      const o = 1 + id.length; rec.writeFloatLE(r.cx, o); rec.writeFloatLE(r.cz, o + 4); rec.writeFloatLE(r.area, o + 8); rec[o + 12] = Math.max(0, ZONES.indexOf(r.zone)); rec[o + 13] = Math.round(r.rich * 255); rec.writeUInt32LE(Math.min(0xffffffff, r.price), o + 14);
      parts.push(rec);
    }
    return Buffer.concat(parts);
  }
}

export interface EconEvents {
  wallet: [{ accountId: string; cash: number; bank: number; why: string }];
  plot: [{ id: string; ownerId: string | null; ownerName: string | null }];
  flag: [{ accountId: string; kind: string; detail: unknown }];
}

/** pay table when content/economy.json has no wages block yet (matches the hustles in hustle.ts) */
const DEFAULT_WAGES: Record<string, { pay: number; minSeconds: number }> = {
  delivery: { pay: 3500, minSeconds: 20 }, danfo: { pay: 6000, minSeconds: 25 }, parcel: { pay: 30000, minSeconds: 30 },
};

export class Economy extends EventEmitter {
  readonly plots = new PlotIndex();
  private jobs = new Map<string, { id: string; at: number }>();
  private earned = new Map<string, { t: number; sum: number }>();

  constructor(private db: DB, private cfg: Config, private content: ContentStore, private log: { warn: (...a: unknown[]) => void; info: (...a: unknown[]) => void }) {
    super();
    const n = this.plots.load(cfg.plotsFile);
    if (n) log.info(`plot index loaded: ${n} plots`); else log.warn('no plots.bin: plot prices are checked against the formula, not the map (run npm run build-plots)');
  }

  // -------------------------------------------------------------------------------- player rows
  ensurePlayer(accountId: string): PlayerRow {
    let p = one<PlayerRow>(this.db, 'SELECT * FROM players WHERE account_id=?', accountId);
    if (!p) {
      run(this.db, 'INSERT OR IGNORE INTO players(account_id,cash,bank,updated_at) VALUES(?,?,0,?)', accountId, this.cfg.startCash, Date.now());
      p = one<PlayerRow>(this.db, 'SELECT * FROM players WHERE account_id=?', accountId)!;
      this.logTx(accountId, 'start', this.cfg.startCash, 0, p.cash, p.bank, null, 'starting cash');
    }
    return p;
  }
  wallet(accountId: string): Wallet { const p = this.ensurePlayer(accountId); return { cash: p.cash, bank: p.bank }; }
  private logTx(accountId: string, kind: string, dCash: number, dBank: number, cash: number, bank: number, ref: string | null, note: string | null) {
    run(this.db, 'INSERT INTO tx_log(account_id,at,kind,cash_delta,bank_delta,cash_after,bank_after,ref,note) VALUES(?,?,?,?,?,?,?,?,?)', accountId, Date.now(), kind, dCash, dBank, cash, bank, ref, note);
  }
  history(accountId: string, limit = 100, before?: number) {
    return all<{ id: number; at: number; kind: string; cash_delta: number; bank_delta: number; cash_after: number; bank_after: number; ref: string | null; note: string | null }>(this.db,
      'SELECT id,at,kind,cash_delta,bank_delta,cash_after,bank_after,ref,note FROM tx_log WHERE account_id=@a AND (@b IS NULL OR id<@b) ORDER BY id DESC LIMIT @l', { a: accountId, b: before ?? null, l: Math.min(500, limit) });
  }

  /**
   * The one place money moves. Fails (HttpError 402) instead of going negative unless `clamp` is set, which takes what is there.
   * `why` is pushed to the player's client with the new balance.
   */
  adjust(accountId: string, dCash: number, dBank: number, kind: string, o: { ref?: string; note?: string; clamp?: boolean; silent?: boolean } = {}): Wallet {
    if (!Number.isFinite(dCash) || !Number.isFinite(dBank)) throw new HttpError(400, 'Bad amount.');
    dCash = Math.trunc(dCash); dBank = Math.trunc(dBank);
    const out = this.db.transaction(() => {
      const p = this.ensurePlayer(accountId);
      if (o.clamp) { dCash = Math.max(dCash, -p.cash); dBank = Math.max(dBank, -p.bank); }
      const cash = p.cash + dCash, bank = p.bank + dBank;
      if (cash < 0 || bank < 0) throw new HttpError(402, 'Not enough money.', { code: 'broke' });
      if (cash > MAX_MONEY || bank > MAX_MONEY) throw new HttpError(400, 'Amount too large.');
      run(this.db, 'UPDATE players SET cash=?, bank=?, updated_at=? WHERE account_id=?', cash, bank, Date.now(), accountId);
      this.logTx(accountId, kind, dCash, dBank, cash, bank, o.ref ?? null, o.note ?? null);
      return { cash, bank };
    })();
    if (!o.silent) this.emit('wallet', { accountId, cash: out.cash, bank: out.bank, why: kind });
    return out;
  }
  /** Gifts from the game itself (admin grants, IAP fulfilment, rewards). */
  grant(accountId: string, cash: number, kind: string, ref?: string, note?: string) { return this.adjust(accountId, cash, 0, kind, { ref, note }); }

  // -------------------------------------------------------------------------------- bank
  deposit(accountId: string, amount: number): Wallet {
    amount = this.amount(amount);
    const w = this.wallet(accountId); if (amount > w.cash) amount = w.cash; if (amount <= 0) throw new HttpError(402, 'Nothing to deposit.');
    return this.adjust(accountId, -amount, amount, 'bank.deposit');
  }
  /** Withdrawals cost 1.5 percent, same as the single player bank. */
  withdraw(accountId: string, amount: number): Wallet {
    amount = this.amount(amount);
    const w = this.wallet(accountId); if (amount > w.bank) amount = w.bank; if (amount <= 0) throw new HttpError(402, 'Nothing in the bank.');
    return this.adjust(accountId, withdrawNet(amount), -amount, 'bank.withdraw', { note: `fee ${amount - withdrawNet(amount)}` });
  }
  transfer(fromId: string, toId: string, amount: number, note = ''): { from: Wallet; to: Wallet } {
    amount = this.amount(amount);
    if (fromId === toId) throw new HttpError(400, 'You cannot pay yourself.');
    if (amount < 1) throw new HttpError(400, 'Amount must be at least 1.');
    return this.db.transaction(() => {
      const from = this.adjust(fromId, -amount, 0, 'transfer.out', { ref: toId, note, silent: true });
      const to = this.adjust(toId, amount, 0, 'transfer.in', { ref: fromId, note, silent: true });
      this.emit('wallet', { accountId: fromId, ...from, why: 'transfer.out' }); this.emit('wallet', { accountId: toId, ...to, why: 'transfer.in' });
      return { from, to };
    })();
  }
  private amount(a: unknown) { const n = Math.floor(Number(a)); if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Bad amount.'); return n; }

  // -------------------------------------------------------------------------------- land (global ownership)
  plotRow(id: string) { return one<PlotRow & { owner_name: string | null }>(this.db, 'SELECT p.*, f.name AS owner_name FROM plots p LEFT JOIN profiles f ON f.account_id=p.owner_id WHERE p.id=?', id); }
  plotsOf(accountId: string) { return all<PlotRow>(this.db, 'SELECT * FROM plots WHERE owner_id=?', accountId); }
  plotsIn(minx: number, minz: number, maxx: number, maxz: number, limit = 5000) {
    return all<{ id: string; owner_id: string; owner_name: string | null; cx: number; cz: number; pts: string | null }>(this.db,
      'SELECT p.id,p.owner_id,f.name AS owner_name,p.cx,p.cz,p.pts FROM plots p LEFT JOIN profiles f ON f.account_id=p.owner_id WHERE p.cx BETWEEN ? AND ? AND p.cz BETWEEN ? AND ? LIMIT ?', minx, maxx, minz, maxz, limit);
  }
  allPlots(limit = 100000) { return all<{ id: string; owner_id: string; owner_name: string | null; cx: number; cz: number }>(this.db, 'SELECT p.id,p.owner_id,f.name AS owner_name,p.cx,p.cz FROM plots p LEFT JOIN profiles f ON f.account_id=p.owner_id LIMIT ?', limit); }

  /**
   * Buy a plot: price comes from the map index when we have one, otherwise from the formula using the client's reported
   * geometry (bounded). Bank money is spent first, like the single player build. Fails if anyone already owns it.
   */
  buyPlot(accountId: string, id: unknown, claim: { cx?: number; cz?: number; area?: number; zone?: string; rich?: number; pts?: number[] } = {}) {
    if (typeof id !== 'string' || id.length < 2 || id.length > 64 || !/^[\w.\-:]+$/.test(id)) throw new HttpError(400, 'Bad plot id.');
    let rec = this.plots.map.get(id); let price: number;
    if (rec) price = rec.price;
    else {
      if (this.plots.loaded && !this.cfg.trustClientPlotPrice) throw new HttpError(404, 'No such plot on the map.');
      const cx = Number(claim.cx), cz = Number(claim.cz), area = Number(claim.area), rich = Math.max(0, Math.min(1, Number(claim.rich ?? 0.3)));
      if (![cx, cz, area].every(Number.isFinite) || area < 30 || area > 400000) throw new HttpError(400, 'Plot details are missing.');
      const b = this.cfg.mapBounds; if (cx < b[0] || cx > b[2] || cz < b[1] || cz > b[3]) throw new HttpError(400, 'That plot is outside Lagos.');
      const zone = ZONES.includes(String(claim.zone)) ? String(claim.zone) : 'residential';
      price = Math.max(1_500_000, plotPriceOf(area, zone, rich, cx, cz));
      rec = { id, cx, cz, area, zone, rich, price };
    }
    const result = this.db.transaction(() => {
      if (this.plotRow(id)) throw new HttpError(409, 'Somebody already owns that land.', { code: 'owned' });
      const p = this.ensurePlayer(accountId);
      if (p.cash + p.bank < price) throw new HttpError(402, `You need ₦${price.toLocaleString('en-NG')}.`, { code: 'broke', price });
      const fromBank = Math.min(p.bank, price); const fromCash = price - fromBank;
      const w = this.adjust(accountId, -fromCash, -fromBank, 'plot.buy', { ref: id, note: `${Math.round(rec!.area)} m2 ${rec!.zone}`, silent: true });
      const pts = Array.isArray(claim.pts) && claim.pts.length >= 6 && claim.pts.length <= 400 && claim.pts.every((v) => Number.isFinite(v)) ? JSON.stringify(claim.pts.map((v) => Math.round(v * 10) / 10)) : null;
      run(this.db, 'INSERT INTO plots(id,owner_id,pts,price,bought_at,cx,cz) VALUES(?,?,?,?,?,?,?)', id, accountId, pts, price, Date.now(), rec!.cx, rec!.cz);
      return w;
    })();
    const name = one<{ name: string }>(this.db, 'SELECT name FROM profiles WHERE account_id=?', accountId)?.name ?? null;
    this.emit('wallet', { accountId, ...result, why: 'plot.buy' });
    this.emit('plot', { id, ownerId: accountId, ownerName: name });
    return { wallet: result, price, id };
  }
  /** Admin: take land back or hand it over. */
  setPlotOwner(id: string, ownerId: string | null) {
    if (ownerId === null) run(this.db, 'DELETE FROM plots WHERE id=?', id);
    else { const rec = this.plots.map.get(id); run(this.db, 'INSERT INTO plots(id,owner_id,price,bought_at,cx,cz) VALUES(?,?,0,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id', id, ownerId, Date.now(), rec?.cx ?? null, rec?.cz ?? null); }
    const name = ownerId ? one<{ name: string }>(this.db, 'SELECT name FROM profiles WHERE account_id=?', ownerId)?.name ?? null : null;
    this.emit('plot', { id, ownerId, ownerName: name });
  }

  // -------------------------------------------------------------------------------- earning
  wages(): Record<string, { pay: number; minSeconds: number }> {
    const doc = this.content.read('economy') as { items?: { id: string; kind?: string; pay?: number; minSeconds?: number; wage?: number }[] } | null;
    const w = { ...DEFAULT_WAGES };
    for (const it of doc?.items ?? []) {
      const pay = it.pay ?? it.wage;
      if ((it.kind === 'wage' || it.kind === 'job') && typeof pay === 'number' && pay > 0) w[it.id] = { pay, minSeconds: it.minSeconds ?? 20 };
    }
    return w;
  }
  startJob(accountId: string, id: string) {
    if (typeof id !== 'string' || id.length > 40) throw new HttpError(400, 'Bad job.');
    this.jobs.set(accountId, { id, at: Date.now() });
  }
  /** Pays the table rate once, if the job was started and enough time passed to have actually done it. */
  finishJob(accountId: string, id: string, bonusFactor = 1) {
    const j = this.jobs.get(accountId);
    const w = this.wages()[id];
    if (!j || j.id !== id) throw new HttpError(400, 'No such hustle in progress.', { code: 'no_job' });
    if (!w) throw new HttpError(400, 'Unknown hustle.');
    const secs = (Date.now() - j.at) / 1000;
    if (secs < w.minSeconds) { this.flag(accountId, 'job-too-fast', { id, secs }); throw new HttpError(400, 'That was too quick. Hustle properly.', { code: 'too_fast' }); }
    this.jobs.delete(accountId);
    const pay = Math.round(w.pay * Math.max(0.5, Math.min(1.5, bonusFactor)));
    this.noteIncome(accountId, pay);
    return this.adjust(accountId, pay, 0, 'job.pay', { ref: id, note: `${Math.round(secs)}s` });
  }
  /**
   * Cash the local simulation changed by itself (fines, wasted cash, loot picked up). Losses are accepted; gains are
   * accepted only for the reasons in `GAIN_REASONS` and only up to a per minute cap, so a hacked client cannot print money.
   */
  clientDelta(accountId: string, d: number, why: string): Wallet {
    d = Math.trunc(d); if (!Number.isFinite(d) || d === 0) return this.wallet(accountId);
    if (d < 0) return this.adjust(accountId, d, 0, 'client.spend', { note: why.slice(0, 40), clamp: true });
    if (!GAIN_REASONS.includes(why)) { this.flag(accountId, 'unsanctioned-gain', { d, why }); return this.wallet(accountId); }
    const cap = GAIN_CAP_PER_MIN;
    const e = this.earned.get(accountId); const now = Date.now();
    const cur = !e || now - e.t > 60000 ? { t: now, sum: 0 } : e;
    if (cur.sum + d > cap) { this.flag(accountId, 'gain-cap', { d, why, sum: cur.sum }); this.earned.set(accountId, cur); return this.wallet(accountId); }
    cur.sum += d; this.earned.set(accountId, cur);
    return this.adjust(accountId, d, 0, 'client.gain', { note: why.slice(0, 40) });
  }
  private noteIncome(accountId: string, n: number) {
    const e = this.earned.get(accountId); const now = Date.now();
    const cur = !e || now - e.t > 3600_000 ? { t: now, sum: 0 } : e; cur.sum += n; this.earned.set(accountId, cur);
    if (cur.sum > 900_000) this.flag(accountId, 'income-high', { perHour: cur.sum });
  }

  /** Buy a catalogue item at the server's price (content/shops.json or economy.json items with a price). */
  shopBuy(accountId: string, sku: unknown, qty = 1) {
    if (typeof sku !== 'string' || sku.length > 60) throw new HttpError(400, 'Bad item.');
    qty = Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));
    let price: number | null = null; let name = sku;
    for (const kind of ['shops', 'economy'] as const) {
      const doc = this.content.read(kind) as { items?: { id: string; price?: number; name?: string; title?: string }[] } | null;
      const it = doc?.items?.find((x) => x.id === sku);
      if (it && typeof it.price === 'number' && it.price >= 0) { price = it.price; name = it.name ?? it.title ?? sku; break; }
    }
    if (price === null) throw new HttpError(404, 'That item is not for sale.');
    const total = price * qty;
    const w = this.adjust(accountId, -total, 0, 'shop.buy', { ref: sku, note: `${qty} x ${name}` });
    return { wallet: w, price, qty, total, sku };
  }

  flag(accountId: string, kind: string, detail: unknown) {
    run(this.db, 'INSERT INTO cheat_flags(at,account_id,kind,detail) VALUES(?,?,?,?)', Date.now(), accountId, kind, JSON.stringify(detail ?? null).slice(0, 500));
    this.emit('flag', { accountId, kind, detail });
  }
  flags(accountId?: string, limit = 100) {
    return all<{ id: number; at: number; account_id: string; kind: string; detail: string }>(this.db, 'SELECT * FROM cheat_flags WHERE (@a IS NULL OR account_id=@a) ORDER BY id DESC LIMIT @l', { a: accountId ?? null, l: Math.min(500, limit) });
  }

  // -------------------------------------------------------------------------------- player blobs
  state(accountId: string) {
    const p = this.ensurePlayer(accountId);
    const parse = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };
    return { vehicles: parse(p.vehicles), skills: parse(p.skills), missions: parse(p.missions), blobs: parse(p.blobs) as Record<string, unknown> };
  }
  /** Keys the server owns and a client may never write: money and land live in their own tables. */
  static readonly RESERVED_KEYS = new Set(['cash', 'bank', 'owned', 'ownedPts', 'model', '__proto__', 'constructor', 'prototype']);
  putState(accountId: string, key: unknown, value: unknown) {
    if (typeof key !== 'string' || !/^[\w.\-]{1,40}$/.test(key) || Economy.RESERVED_KEYS.has(key)) throw new HttpError(400, 'Bad state key.');
    const json = JSON.stringify(value ?? null); if (json.length > 256 * 1024) throw new HttpError(413, 'State too large.');
    this.ensurePlayer(accountId);
    const col = key === 'vehicles' || key === 'skills' || key === 'missions' ? key : null;
    if (col) run(this.db, `UPDATE players SET ${col}=?, updated_at=? WHERE account_id=?`, json, Date.now(), accountId);
    else {
      const row = one<{ blobs: string }>(this.db, 'SELECT blobs FROM players WHERE account_id=?', accountId)!;
      let b: Record<string, unknown> = {}; try { b = JSON.parse(row.blobs); } catch { /* reset */ }
      if (Object.keys(b).length >= 64 && !(key in b)) throw new HttpError(413, 'Too many state keys.');
      if (value === null || value === undefined) delete b[key]; else b[key] = value;
      const out = JSON.stringify(b); if (out.length > 1024 * 1024) throw new HttpError(413, 'State too large.');
      run(this.db, 'UPDATE players SET blobs=?, updated_at=? WHERE account_id=?', out, Date.now(), accountId);
    }
  }
  savePosition(accountId: string, x: number, y: number, z: number, addSeconds = 0) {
    run(this.db, 'UPDATE players SET x=?, y=?, z=?, play_seconds=play_seconds+?, updated_at=? WHERE account_id=?', x, y, z, Math.round(addSeconds), Date.now(), accountId);
  }
  lastPosition(accountId: string) { const p = this.ensurePlayer(accountId); return p.x === null || p.z === null ? null : { x: p.x, y: p.y ?? 0, z: p.z }; }
}

export const GAIN_REASONS = ['loot', 'pickup', 'sale', 'mission', 'reward'];
export const GAIN_CAP_PER_MIN = 25_000;
