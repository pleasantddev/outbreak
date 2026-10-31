// Real-money checkouts through Paystack. One flow for everything bought with naira (store packs now; billboards,
// drone shows, blimps and club song promotion register their own products later):
//   start(): the server prices the product (never the client), writes a pending purchase with our own reference and
//            asks Paystack for a hosted checkout page.
//   settle(): Paystack's signed webhook, or a verify call when the player comes back, says the money landed. The row
//            moves pending -> paid -> granted in one transaction, so a webhook and a verify racing each other, or a
//            webhook sent twice, hand over the goods exactly once.
// Test mode (no secret key, not production): no card step; the player confirms a fake payment and the same settle()
// runs. Admin ledger: every row lives in `purchases`, which the admin Store page and /api/pay/ledger read.
import { EventEmitter } from 'node:events';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError } from './auth.ts';
import type { Economy } from './economy.ts';
import type { ContentStore } from './content.ts';
import type { AccountRow } from './accounts.ts';
import { PAY_CURRENCY, PAY_MAX_KOBO, PAY_MIN_KOBO, findPromo, iapCatalog, promoPrice, koboOf, nairaOf, parseSku, payRefOk, type IapItem } from '../../v2/src/net/rules.ts';

export interface Quote { amountKobo: number; label: string; meta?: Record<string, unknown>; promo?: string | null }
export interface PurchaseRec { id: string; accountId: string; sku: string; kind: string; amountKobo: number; currency: string; status: string; ref: string; label: string; meta: Record<string, unknown>; promo: string | null; providerRef: string | null; granted: Record<string, unknown>; createdAt: number; paidAt: number | null }
export interface PayProduct {
  /** price it on the server; throw HttpError to refuse (sold out, board taken, bad input) */
  quote(account: AccountRow, id: string, meta: Record<string, unknown>): Quote | Promise<Quote>;
  /** hand over what was bought; returns a record of it. Runs once per purchase, inside the settle transaction. */
  fulfil(p: PurchaseRec): Record<string, unknown>;
}
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
const PAYSTACK = 'https://api.paystack.co';
const PENDING_TTL = 24 * 3600_000;

interface Row { id: string; account_id: string; sku: string; kind: string; amount_minor: number; currency: string; provider: string | null; provider_ref: string | null; status: string; granted: string; created_at: number; updated_at: number; item_id: string | null; amount: number; ref: string | null; promo: string | null; label: string | null; meta: string; paid_at: number | null }
const rec = (r: Row): PurchaseRec => ({ id: r.id, accountId: r.account_id, sku: r.sku, kind: r.kind, amountKobo: r.amount_minor, currency: r.currency, status: r.status, ref: r.ref ?? r.id, label: r.label ?? r.sku, meta: safeJson(r.meta), promo: r.promo, providerRef: r.provider_ref, granted: safeJson(r.granted), createdAt: r.created_at, paidAt: r.paid_at });
function safeJson(s: string | null): Record<string, unknown> { try { const v = JSON.parse(s ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }

export class Payments extends EventEmitter {
  readonly products = new Map<string, PayProduct>();
  /** swapped in tests */
  fetch: Fetch = (u, i) => fetch(u, i) as never;

  constructor(private db: DB, private cfg: Config, private economy: Economy, private content: ContentStore, private log: { warn: (...a: unknown[]) => void; info: (...a: unknown[]) => void; error?: (...a: unknown[]) => void }) {
    super();
    if (this.mode === 'test') log.warn('payments: TEST MODE. Checkouts are fake and grant goods without money. Set PAYSTACK_SECRET_KEY for real payments.');
    else if (this.mode === 'off') log.warn('payments: off (no PAYSTACK_SECRET_KEY and PAY_TEST is off).');
    this.register('iap', {
      quote: (a, id, meta) => {
        const items = this.iapItems(); const now = Date.now(); const it = iapCatalog(items, now).find((x) => x.id === id);
        if (!it) throw new HttpError(404, 'That pack is not on sale.');
        const bought = (where: string, ...p: unknown[]) => one<{ n: number }>(this.db, `SELECT COUNT(*) n FROM purchases WHERE status='paid' AND ${where}`, ...p)!.n;
        if (it.limit && bought('account_id=? AND sku=?', a.id, `iap:${id}`) >= it.limit) throw new HttpError(409, 'You don buy this one already. Na one per person.', { code: 'limit' });
        let price = it.priceNGN; let promo: string | null = null;
        if (meta.promo) {
          const p = findPromo(items, meta.promo, id, now);
          if (!p) throw new HttpError(400, 'That code no work for this pack.', { code: 'promo' });
          if (p.perAccount && bought('account_id=? AND promo=?', a.id, p.code) >= p.perAccount) throw new HttpError(409, 'You don use that code already.', { code: 'promo' });
          if (p.maxUses && bought('promo=?', p.code) >= p.maxUses) throw new HttpError(409, 'That code don finish.', { code: 'promo' });
          price = promoPrice(p, price); promo = p.code!;
        }
        return { amountKobo: koboOf(price), label: it.name, promo, meta: { grants: it.grants } };
      },
      fulfil: (p) => {
        const g = (p.meta.grants ?? {}) as { cash?: number; bank?: number };
        const cash = Math.max(0, Math.floor(g.cash ?? 0)), bank = Math.max(0, Math.floor(g.bank ?? 0));
        if (cash || bank) this.economy.adjust(p.accountId, cash, bank, 'iap', { ref: p.ref, note: p.label });
        return { cash, bank };
      },
    });
  }

  get mode(): 'live' | 'test' | 'off' { return this.cfg.paystackSecret ? 'live' : this.cfg.payTest ? 'test' : 'off'; }
  register(kind: string, p: PayProduct) { if (!/^[a-z]{2,12}$/.test(kind)) throw new Error(`bad product kind ${kind}`); this.products.set(kind, p); }
  iapItems(): IapItem[] { return (this.content.read('iap')?.items ?? []) as IapItem[]; }
  catalog() { return iapCatalog(this.iapItems(), Date.now()); }
  publicConfig() { return { mode: this.mode, publicKey: this.cfg.paystackPublic || null, currency: PAY_CURRENCY, packs: this.mode === 'off' ? [] : this.catalog() }; }

  // ------------------------------------------------------------------------------------------ checkout
  async start(account: AccountRow, skuRaw: unknown, metaRaw: unknown): Promise<{ ref: string; amountKobo: number; label: string; mode: string; authorizationUrl: string | null; accessCode: string | null; publicKey: string | null }> {
    if (this.mode === 'off') throw new HttpError(503, 'Payments are not switched on yet.', { code: 'pay_off' });
    const sku = parseSku(skuRaw); if (!sku) throw new HttpError(400, 'Bad product.');
    const prod = this.products.get(sku.kind); if (!prod) throw new HttpError(404, 'We no sell that one.');
    const meta = metaRaw && typeof metaRaw === 'object' && !Array.isArray(metaRaw) ? (metaRaw as Record<string, unknown>) : {};
    if (JSON.stringify(meta).length > 4000) throw new HttpError(400, 'Too much detail on the order.');
    const open = one<{ n: number }>(this.db, "SELECT COUNT(*) n FROM purchases WHERE account_id=? AND status='pending' AND created_at>?", account.id, Date.now() - 3600_000)!.n;
    if (open >= 8) throw new HttpError(429, 'You have too many unfinished payments. Finish one or wait small.');
    const q = await prod.quote(account, sku.id, meta);
    const amountKobo = Math.round(q.amountKobo);
    if (!Number.isFinite(amountKobo) || amountKobo < PAY_MIN_KOBO || amountKobo > PAY_MAX_KOBO) throw new HttpError(400, 'That price is outside what we take in one payment.');
    const ref = 'hl_' + randomBytes(15).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(20, '0').slice(0, 20);
    const now = Date.now(); const label = String(q.label).slice(0, 120);
    const keep = { ...meta, ...(q.meta ?? {}) };
    run(this.db, `INSERT INTO purchases(id,account_id,sku,kind,amount_minor,currency,provider,status,granted,created_at,updated_at,item_id,amount,ref,promo,label,meta)
      VALUES(?,?,?,?,?,?,?,'pending','{}',?,?,?,?,?,?,?,?)`, ref, account.id, `${sku.kind}:${sku.id}`, sku.kind, amountKobo, PAY_CURRENCY, this.mode === 'live' ? 'paystack' : 'test', now, now, `${sku.kind}:${sku.id}`, nairaOf(amountKobo), ref, q.promo ?? null, label, JSON.stringify(keep));
    if (this.mode === 'test') return { ref, amountKobo, label, mode: 'test', authorizationUrl: null, accessCode: null, publicKey: null };
    try {
      const r = await this.paystack('POST', '/transaction/initialize', {
        email: account.email ?? `${account.id}@players.hustlelife.ng`, amount: String(amountKobo), currency: PAY_CURRENCY, reference: ref,
        ...(this.cfg.payCallbackUrl ? { callback_url: this.cfg.payCallbackUrl } : {}),
        metadata: { accountId: account.id, sku: `${sku.kind}:${sku.id}`, cancel_action: this.cfg.payCallbackUrl || undefined },
      });
      if (!r?.status || !r.data?.authorization_url) throw new Error(r?.message ?? 'no checkout url');
      run(this.db, "UPDATE purchases SET meta=json_set(meta,'$.accessCode',?), updated_at=? WHERE id=?", String(r.data.access_code ?? ''), Date.now(), ref);
      return { ref, amountKobo, label, mode: 'live', authorizationUrl: r.data.authorization_url, accessCode: r.data.access_code ?? null, publicKey: this.cfg.paystackPublic || null };
    } catch (e) {
      run(this.db, "UPDATE purchases SET status='failed', updated_at=? WHERE id=?", Date.now(), ref);
      this.log.warn('paystack initialize failed', ref, e);
      throw new HttpError(502, 'Paystack no answer. Try again in a minute.', { code: 'pay_gateway' });
    }
  }

  get(ref: string): PurchaseRec | null { const r = one<Row>(this.db, 'SELECT * FROM purchases WHERE ref=?', ref); return r ? rec(r) : null; }

  /** the player's view of one checkout; asks Paystack when it is still pending (the player came back from the card page) */
  async status(accountId: string, ref: unknown): Promise<PurchaseRec> {
    if (!payRefOk(ref)) throw new HttpError(400, 'Bad reference.');
    let p = this.get(ref); if (!p || p.accountId !== accountId) throw new HttpError(404, 'No such payment.');
    if (p.status === 'pending' && this.mode === 'live') {
      try {
        const r = await this.paystack('GET', `/transaction/verify/${encodeURIComponent(ref)}`);
        const d = r?.data;
        if (d?.status === 'success') p = this.settle(ref, Number(d.amount), String(d.currency), String(d.id ?? ''));
        else if (d && ['failed', 'abandoned', 'reversed'].includes(d.status) && Date.now() - p.createdAt > 30 * 60_000) p = this.fail(ref, d.status);
      } catch (e) { this.log.warn('paystack verify failed', ref, e); }
    }
    if (p.status === 'pending' && Date.now() - p.createdAt > PENDING_TTL) p = this.fail(ref, 'expired');
    return p;
  }

  /** test mode only: pretend the card went through */
  testComplete(accountId: string, ref: unknown): PurchaseRec {
    if (this.mode !== 'test') throw new HttpError(403, 'Test payments are off on this server.');
    if (!payRefOk(ref)) throw new HttpError(400, 'Bad reference.');
    const p = this.get(ref); if (!p || p.accountId !== accountId) throw new HttpError(404, 'No such payment.');
    return this.settle(ref, p.amountKobo, p.currency, `test_${ref}`);
  }
  cancel(accountId: string, ref: unknown): PurchaseRec {
    if (!payRefOk(ref)) throw new HttpError(400, 'Bad reference.');
    const p = this.get(ref); if (!p || p.accountId !== accountId) throw new HttpError(404, 'No such payment.');
    // a live checkout may still be paid on Paystack's page; only test checkouts and old ones can be dropped here
    if (p.status === 'pending' && (this.mode !== 'live' || Date.now() - p.createdAt > PENDING_TTL)) return this.fail(ref, 'cancelled');
    return p;
  }

  /** Paystack's webhook: the signature is an HMAC-SHA512 of the raw body with the secret key */
  webhook(raw: string, signature: unknown): { ok: boolean; why?: string } {
    if (!this.cfg.paystackSecret) return { ok: false, why: 'no key' };
    const want = createHmac('sha512', this.cfg.paystackSecret).update(raw).digest();
    let got: Buffer; try { got = Buffer.from(String(signature ?? ''), 'hex'); } catch { return { ok: false, why: 'bad signature' }; }
    if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, why: 'bad signature' };
    let ev: any; try { ev = JSON.parse(raw); } catch { return { ok: false, why: 'bad body' }; }
    if (ev?.event !== 'charge.success') return { ok: true, why: 'ignored' };
    const d = ev.data ?? {}; const ref = String(d.reference ?? '');
    if (!payRefOk(ref) || !this.get(ref)) return { ok: true, why: 'unknown reference' };
    if (d.status && d.status !== 'success') return { ok: true, why: 'not success' };
    this.settle(ref, Number(d.amount), String(d.currency), String(d.id ?? ''));
    return { ok: true };
  }

  /** money arrived: check it matches, mark it paid and hand over the goods, once */
  settle(ref: string, paidKobo: number, currency: string, providerRef: string): PurchaseRec {
    let granted: PurchaseRec | null = null;
    const out = this.db.transaction(() => {
      const r = one<Row>(this.db, 'SELECT * FROM purchases WHERE ref=?', ref); if (!r) throw new HttpError(404, 'No such payment.');
      if (r.status !== 'pending' && r.status !== 'failed') return rec(r); // already settled (or refunded): nothing to do
      const now = Date.now();
      if (currency !== r.currency || !Number.isFinite(paidKobo) || paidKobo < r.amount_minor) {
        run(this.db, "UPDATE purchases SET status='mismatch', provider_ref=?, updated_at=? WHERE id=?", providerRef, now, r.id);
        this.emit('flag', { accountId: r.account_id, kind: 'pay.mismatch', detail: { ref, paidKobo, currency, want: r.amount_minor } });
        return rec(one<Row>(this.db, 'SELECT * FROM purchases WHERE id=?', r.id)!);
      }
      run(this.db, "UPDATE purchases SET status='paid', provider_ref=?, paid_at=?, updated_at=? WHERE id=? AND status IN ('pending','failed')", providerRef, now, now, r.id);
      const p = rec(one<Row>(this.db, 'SELECT * FROM purchases WHERE id=?', r.id)!);
      const prod = this.products.get(p.kind);
      const g = prod ? prod.fulfil(p) : { note: 'no product handler; grant by hand' };
      // admin "paid" means the money is in; granted is kept in its own column
      run(this.db, 'UPDATE purchases SET granted=?, updated_at=? WHERE id=?', JSON.stringify(g), Date.now(), r.id);
      granted = rec(one<Row>(this.db, 'SELECT * FROM purchases WHERE id=?', r.id)!);
      return granted;
    })();
    if (granted) { this.log.info(`payment ${ref} settled: ${(granted as PurchaseRec).sku} ₦${nairaOf((granted as PurchaseRec).amountKobo)}`); this.emit('purchase', granted); }
    return out;
  }
  private fail(ref: string, why: string): PurchaseRec {
    run(this.db, "UPDATE purchases SET status='failed', meta=json_set(meta,'$.failed',?), updated_at=? WHERE ref=? AND status='pending'", why, Date.now(), ref);
    return this.get(ref)!;
  }

  // ------------------------------------------------------------------------------------------ ledger
  mine(accountId: string, limit = 30) { return all<Row>(this.db, 'SELECT * FROM purchases WHERE account_id=? AND ref IS NOT NULL ORDER BY created_at DESC LIMIT ?', accountId, Math.min(100, limit)).map(rec).map(pub); }
  ledger(o: { status?: string; limit?: number; before?: number } = {}) {
    const rows = all<Row & { name: string | null }>(this.db, `SELECT u.*, p.name FROM purchases u LEFT JOIN profiles p ON p.account_id=u.account_id
      WHERE u.ref IS NOT NULL AND (@s IS NULL OR u.status=@s) AND (@b IS NULL OR u.created_at<@b) ORDER BY u.created_at DESC LIMIT @l`, { s: o.status ?? null, b: o.before ?? null, l: Math.min(500, o.limit ?? 100) });
    const tot = all<{ status: string; n: number; kobo: number }>(this.db, "SELECT status, COUNT(*) n, COALESCE(SUM(amount_minor),0) kobo FROM purchases WHERE ref IS NOT NULL GROUP BY status");
    return { mode: this.mode, items: rows.map((r) => ({ ...rec(r), player: r.name })), totals: Object.fromEntries(tot.map((t) => [t.status, { count: t.n, naira: nairaOf(t.kobo) }])) };
  }

  private async paystack(method: string, path: string, body?: unknown): Promise<any> {
    const r = await this.fetch(PAYSTACK + path, { method, headers: { Authorization: `Bearer ${this.cfg.paystackSecret}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`paystack ${r.status}: ${j?.message ?? ''}`);
    return j;
  }
}

/** what a player may see of a purchase */
export const pub = (p: PurchaseRec) => ({ ref: p.ref, sku: p.sku, label: p.label, naira: nairaOf(p.amountKobo), status: p.status, granted: p.status === 'paid' ? p.granted : {}, at: p.createdAt, paidAt: p.paidAt, promo: p.promo });
