// The only file that reads the game server's own tables (accounts, player_state, plots, bans, purchases, chat_reports).
// Their DDL is NET_DDL in db.ts. If the net workstream's schema differs, adapt the SQL here and nothing else.
import type { SqlDb } from './db';
import type { ChatReport, ItemRec, PlayerDetail, PlayerRow, PlotRec, PurchaseRow, Sanction, SanctionKind, VehicleRec } from './types';

const j = <T>(s: any, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };
export interface LiveHooks {
  online(): { id: string; name: string; x: number; z: number; heading?: number; activity?: string; level?: number }[];
  kick(accountId: string, reason: string): boolean;
  broadcast(msg: { kind: string; message: string; targetIds?: string[] }): number;
  /** Apply a state patch to an online player so it is not overwritten by their next save. Return false when the player is offline. */
  patchOnline?(accountId: string, patch: Record<string, unknown>): boolean;
  onSanction?(accountId: string, s: { kind: SanctionKind; reason: string; expiresAt: number | null }): void;
  onRefund?(p: PurchaseRow): void;
  stats?(): { connections: number; tickMs: number };
}

export class AdminStore {
  constructor(private db: SqlDb, private live: () => LiveHooks | null) {}
  private now() { return Date.now(); }

  // ---- sanctions
  activeSanctions(accountId: string): Sanction[] { const n = this.now(); return this.sanctions(accountId).filter((s) => !s.revokedAt && (s.expiresAt === null || s.expiresAt > n)); }
  sanctions(accountId: string): Sanction[] {
    return this.db.prepare('SELECT * FROM bans WHERE account_id=? ORDER BY created_at DESC').all(accountId).map((r: any) => ({ id: r.id, accountId: r.account_id, kind: r.kind, reason: r.reason, createdAt: r.created_at, expiresAt: r.expires_at ?? null, issuedBy: r.issued_by, revokedAt: r.revoked_at ?? null, revokedBy: r.revoked_by ?? null, revokeReason: r.revoke_reason ?? null }));
  }
  addSanction(accountId: string, kind: SanctionKind, reason: string, minutes: number | null, by: string): Sanction {
    const now = this.now(); const exp = minutes ? now + minutes * 60_000 : null;
    const r = this.db.prepare('INSERT INTO bans(account_id,kind,reason,created_at,expires_at,issued_by) VALUES(?,?,?,?,?,?)').run(accountId, kind, reason, now, exp, by);
    this.live()?.onSanction?.(accountId, { kind, reason, expiresAt: exp });
    return this.sanctions(accountId).find((s) => s.id === Number(r.lastInsertRowid))!;
  }
  revokeSanctions(accountId: string, by: string, reason: string, kind?: SanctionKind): number {
    const act = this.activeSanctions(accountId).filter((s) => !kind || s.kind === kind);
    for (const s of act) this.db.prepare('UPDATE bans SET revoked_at=?, revoked_by=?, revoke_reason=? WHERE id=?').run(this.now(), by, reason, s.id);
    return act.length;
  }
  private statusOf(accountId: string): PlayerRow['status'] { const a = this.activeSanctions(accountId); return a.some((s) => s.kind === 'ban') ? 'banned' : a.some((s) => s.kind === 'suspend') ? 'suspended' : a.some((s) => s.kind === 'mute') ? 'muted' : 'ok'; }

  // ---- players
  listPlayers(o: { q?: string; status?: string; sort?: string; dir?: 'asc' | 'desc'; limit?: number; offset?: number; onlineOnly?: boolean }): { rows: PlayerRow[]; total: number } {
    const online = new Map((this.live()?.online() ?? []).map((p) => [p.id, p]));
    const where: string[] = []; const args: any[] = [];
    if (o.q) { where.push('(a.name LIKE ? OR a.email LIKE ? OR a.id LIKE ?)'); const q = `%${o.q.replace(/[%_]/g, '')}%`; args.push(q, q, q); }
    const all = this.db.prepare(`SELECT a.id,a.email,a.name,a.created_at,a.last_seen, s.json AS st,
      (SELECT COUNT(*) FROM plots p WHERE p.owner_id=a.id) AS plots,
      (SELECT COALESCE(SUM(amount),0) FROM purchases u WHERE u.account_id=a.id AND u.status='paid' AND u.currency='NGN') AS spent,
      (SELECT COUNT(*) FROM chat_reports r WHERE r.target_id=a.id) AS reports
      FROM accounts a LEFT JOIN player_state s ON s.account_id=a.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).all(...args);
    let rows: PlayerRow[] = all.map((r: any) => { const st = j<any>(r.st, {}); return { id: r.id, email: r.email ?? null, name: r.name, createdAt: r.created_at, lastSeen: r.last_seen ?? null, online: online.has(r.id), cash: st.cash ?? 0, bank: st.bank ?? 0, level: st.level ?? 1, plots: r.plots, status: this.statusOf(r.id), spent: r.spent, reports: r.reports }; });
    if (o.status && o.status !== 'all') rows = rows.filter((r) => (o.status === 'online' ? r.online : r.status === o.status));
    if (o.onlineOnly) rows = rows.filter((r) => r.online);
    const key = (o.sort ?? 'lastSeen') as keyof PlayerRow; const dir = o.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => { const x = a[key] as any ?? 0, y = b[key] as any ?? 0; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir; });
    const total = rows.length; const off = o.offset ?? 0; rows = rows.slice(off, off + Math.min(200, o.limit ?? 50));
    return { rows, total };
  }
  getPlayer(id: string): PlayerDetail | null {
    const a = this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id); if (!a) return null;
    const st = j<any>(this.db.prepare('SELECT json FROM player_state WHERE account_id=?').get(id)?.json, {});
    const live = this.live()?.online().find((p) => p.id === id);
    return {
      id: a.id, email: a.email ?? null, name: a.name, createdAt: a.created_at, lastSeen: a.last_seen ?? null, online: !!live, ip: a.ip ?? null, device: a.device ?? null,
      state: st, cash: st.cash ?? 0, bank: st.bank ?? 0, level: st.level ?? 1, xp: st.xp ?? 0, x: live?.x ?? st.x ?? null, z: live?.z ?? st.z ?? null,
      inventory: (st.inventory ?? []) as ItemRec[], vehicles: (st.vehicles ?? []) as VehicleRec[], skills: st.skills ?? {},
      plots: this.plotsOf(id), sanctions: this.sanctions(id), purchases: this.purchases({ accountId: id, limit: 100 }).rows,
      reports: this.reports({ target: id }).rows, notes: this.db.prepare('SELECT id,ts,by,text FROM admin_notes WHERE account_id=? ORDER BY ts DESC').all(id),
    };
  }
  /** Read-modify-write the player's saved state. Online players are patched through the live hook so their next save does not undo it. */
  patchState(id: string, fn: (st: any) => void): { st: any; viaLive: boolean } {
    const row = this.db.prepare('SELECT json FROM player_state WHERE account_id=?').get(id); const st = j<any>(row?.json, {}); const before = JSON.stringify(st);
    fn(st);
    this.db.prepare('INSERT INTO player_state(account_id,json) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET json=excluded.json').run(id, JSON.stringify(st));
    const viaLive = this.live()?.patchOnline?.(id, st) ?? false; void before;
    return { st, viaLive };
  }
  addNote(id: string, by: string, text: string) { this.db.prepare('INSERT INTO admin_notes(account_id,ts,by,text) VALUES(?,?,?,?)').run(id, this.now(), by, text); }
  rename(id: string, name: string) { this.db.prepare('UPDATE accounts SET name=? WHERE id=?').run(name, id); }

  // ---- plots
  private plotRow(r: any): PlotRec { return { id: r.id, ownerId: r.owner_id ?? null, ownerName: r.owner_name ?? null, x: r.x, z: r.z, price: r.price, forSale: !!r.for_sale, flags: j<string[]>(r.flags, []), name: r.name ?? null, zone: r.zone ?? null, area: r.area ?? null }; }
  plotsOf(owner: string): PlotRec[] { return this.db.prepare('SELECT p.*, a.name AS owner_name FROM plots p LEFT JOIN accounts a ON a.id=p.owner_id WHERE p.owner_id=? ORDER BY p.price DESC').all(owner).map((r: any) => this.plotRow(r)); }
  /** Every parcel that is not plain vacant stock: owned, for sale, or flagged. The map draws these over the base parcels. */
  plots(): PlotRec[] { return this.db.prepare('SELECT p.*, a.name AS owner_name FROM plots p LEFT JOIN accounts a ON a.id=p.owner_id').all().map((r: any) => this.plotRow(r)); }
  getPlot(id: string): PlotRec | null { const r = this.db.prepare('SELECT p.*, a.name AS owner_name FROM plots p LEFT JOIN accounts a ON a.id=p.owner_id WHERE p.id=?').get(id); return r ? this.plotRow(r) : null; }
  upsertPlot(p: Partial<PlotRec> & { id: string }) {
    const cur = this.getPlot(p.id);
    if (!cur) { if (typeof p.x !== 'number' || typeof p.z !== 'number') throw new Error('x and z needed to create a parcel record'); this.db.prepare('INSERT INTO plots(id,owner_id,price,for_sale,x,z,flags,name,zone,area) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.id, p.ownerId ?? null, p.price ?? 0, p.forSale ? 1 : 0, p.x, p.z, JSON.stringify(p.flags ?? []), p.name ?? null, p.zone ?? null, p.area ?? null); return this.getPlot(p.id)!; }
    const n = { ...cur, ...p };
    this.db.prepare('UPDATE plots SET owner_id=?, price=?, for_sale=?, flags=?, name=? WHERE id=?').run(n.ownerId ?? null, n.price, n.forSale ? 1 : 0, JSON.stringify(n.flags ?? []), n.name ?? null, p.id);
    return this.getPlot(p.id)!;
  }

  // ---- purchases
  private pRow(r: any): PurchaseRow { return { id: r.id, accountId: r.account_id, accountName: r.account_name ?? undefined, itemId: r.item_id, amount: r.amount, currency: r.currency, status: r.status, provider: r.provider, ref: r.ref ?? null, promo: r.promo ?? null, createdAt: r.created_at, refundedAt: r.refunded_at ?? null, refundReason: r.refund_reason ?? null }; }
  purchases(o: { accountId?: string; status?: string; q?: string; from?: number; to?: number; limit?: number; offset?: number }): { rows: PurchaseRow[]; total: number } {
    const w: string[] = []; const a: any[] = [];
    if (o.accountId) { w.push('u.account_id=?'); a.push(o.accountId); }
    if (o.status && o.status !== 'all') { w.push('u.status=?'); a.push(o.status); }
    if (o.q) { w.push('(u.id LIKE ? OR u.item_id LIKE ? OR u.ref LIKE ? OR c.name LIKE ?)'); const q = `%${o.q}%`; a.push(q, q, q, q); }
    if (o.from) { w.push('u.created_at>=?'); a.push(o.from); } if (o.to) { w.push('u.created_at<?'); a.push(o.to); }
    const W = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const total = this.db.prepare(`SELECT COUNT(*) c FROM purchases u LEFT JOIN accounts c ON c.id=u.account_id ${W}`).get(...a).c as number;
    const rows = this.db.prepare(`SELECT u.*, c.name AS account_name FROM purchases u LEFT JOIN accounts c ON c.id=u.account_id ${W} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`).all(...a, Math.min(500, o.limit ?? 50), o.offset ?? 0).map((r: any) => this.pRow(r));
    return { rows, total };
  }
  getPurchase(id: string) { const r = this.db.prepare('SELECT u.*, c.name AS account_name FROM purchases u LEFT JOIN accounts c ON c.id=u.account_id WHERE u.id=?').get(id); return r ? this.pRow(r) : null; }
  refund(id: string, reason: string): PurchaseRow | null {
    const p = this.getPurchase(id); if (!p || p.status !== 'paid') return null;
    this.db.prepare("UPDATE purchases SET status='refunded', refunded_at=?, refund_reason=? WHERE id=?").run(this.now(), reason, id);
    const n = this.getPurchase(id)!; this.live()?.onRefund?.(n); return n;
  }
  revenue(days: number) {
    const since = this.now() - days * 86400_000;
    const rows = this.db.prepare("SELECT created_at,amount,currency,status,item_id FROM purchases WHERE created_at>=? AND status IN ('paid','refunded','chargeback')").all(since) as any[];
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    const series = new Map<string, { date: string; NGN: number; USD: number; refundedNGN: number; refundedUSD: number; orders: number }>();
    for (let i = days - 1; i >= 0; i--) { const d = day(this.now() - i * 86400_000); series.set(d, { date: d, NGN: 0, USD: 0, refundedNGN: 0, refundedUSD: 0, orders: 0 }); }
    const byItem = new Map<string, { itemId: string; NGN: number; USD: number; orders: number }>();
    for (const r of rows) {
      const s = series.get(day(r.created_at)); if (!s) continue; const cur = r.currency as 'NGN' | 'USD';
      if (r.status === 'paid') { s[cur] += r.amount; s.orders++; const b = byItem.get(r.item_id) ?? { itemId: r.item_id, NGN: 0, USD: 0, orders: 0 }; b[cur] += r.amount; b.orders++; byItem.set(r.item_id, b); }
      else if (cur === 'NGN') s.refundedNGN += r.amount; else s.refundedUSD += r.amount;
    }
    const tot = { NGN: 0, USD: 0, refundedNGN: 0, refundedUSD: 0, orders: 0 }; for (const s of series.values()) { tot.NGN += s.NGN; tot.USD += s.USD; tot.refundedNGN += s.refundedNGN; tot.refundedUSD += s.refundedUSD; tot.orders += s.orders; }
    const payers = (this.db.prepare("SELECT COUNT(DISTINCT account_id) c FROM purchases WHERE created_at>=? AND status='paid'").get(since) as any).c as number;
    return { days, series: [...series.values()], byItem: [...byItem.values()].sort((a, b) => b.NGN + b.USD * 1500 - (a.NGN + a.USD * 1500)).slice(0, 12), totals: { ...tot, payers } };
  }

  // ---- reports
  private rRow(r: any): ChatReport { return { id: r.id, reporterId: r.reporter_id, reporterName: r.reporter_name ?? undefined, targetId: r.target_id, targetName: r.target_name ?? undefined, channel: r.channel, message: r.message, context: j<string[]>(r.context, []), createdAt: r.created_at, status: r.status, resolution: r.resolution ?? null, resolvedBy: r.resolved_by ?? null }; }
  reports(o: { status?: string; target?: string; limit?: number }): { rows: ChatReport[]; total: number } {
    const w: string[] = []; const a: any[] = []; if (o.status && o.status !== 'all') { w.push('r.status=?'); a.push(o.status); } if (o.target) { w.push('r.target_id=?'); a.push(o.target); }
    const W = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const rows = this.db.prepare(`SELECT r.*, a.name AS reporter_name, t.name AS target_name FROM chat_reports r LEFT JOIN accounts a ON a.id=r.reporter_id LEFT JOIN accounts t ON t.id=r.target_id ${W} ORDER BY r.created_at DESC LIMIT ?`).all(...a, o.limit ?? 100).map((r: any) => this.rRow(r));
    return { rows, total: (this.db.prepare(`SELECT COUNT(*) c FROM chat_reports r ${W}`).get(...a) as any).c };
  }
  getReport(id: number) { const r = this.db.prepare('SELECT r.*, a.name AS reporter_name, t.name AS target_name FROM chat_reports r LEFT JOIN accounts a ON a.id=r.reporter_id LEFT JOIN accounts t ON t.id=r.target_id WHERE r.id=?').get(id); return r ? this.rRow(r) : null; }
  resolveReport(id: number, status: 'actioned' | 'dismissed', note: string, by: string) { this.db.prepare('UPDATE chat_reports SET status=?, resolution=?, resolved_by=? WHERE id=?').run(status, note, by, id); return this.getReport(id); }

  // ---- counters for the ops page
  counts() {
    const q = (s: string, ...a: any[]) => (this.db.prepare(s).get(...a) as any).c as number; const n = this.now();
    const since = n - 30 * 86400_000;
    const rev = this.db.prepare("SELECT currency, SUM(amount) s FROM purchases WHERE status='paid' AND created_at>=? GROUP BY currency").all(since) as any[];
    return {
      accounts: q('SELECT COUNT(*) c FROM accounts'),
      bannedNow: q("SELECT COUNT(DISTINCT account_id) c FROM bans WHERE kind IN ('ban','suspend') AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)", n),
      openReports: q("SELECT COUNT(*) c FROM chat_reports WHERE status='open'"),
      revenue30d: { NGN: rev.find((r) => r.currency === 'NGN')?.s ?? 0, USD: rev.find((r) => r.currency === 'USD')?.s ?? 0 },
    };
  }
}
