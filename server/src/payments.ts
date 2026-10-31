// Real money, through Paystack. Every naira a player pays (ads, drone shows, blimps, song promotion) starts here:
// initialize() makes a pending payment and asks Paystack for a checkout; the player pays in Paystack's own window;
// verify() (called by the game when the window closes, and by Paystack's webhook) confirms it with Paystack and
// fulfils the purchase exactly once. With no PAYSTACK_SECRET_KEY in the environment the server runs in test mode:
// no money moves and a test payment can be completed from the game, so everything can be built and tried first.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError } from './auth.ts';

export interface PaymentRow { reference: string; account_id: string; amount_kobo: number; currency: string; purpose: string; meta: string; status: string; created_at: number; paid_at: number | null }
type Fulfil = (row: PaymentRow, meta: any) => void;
const API = 'https://api.paystack.co';

export class Payments {
  private handlers = new Map<string, Fulfil>();
  constructor(private db: DB, private log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }, private env = process.env) {}
  get secret() { return this.env.PAYSTACK_SECRET_KEY || ''; }
  get publicKey() { return this.env.PAYSTACK_PUBLIC_KEY || ''; }
  get live() { return !!this.secret; }
  /** what to do once a purpose is paid (ads.ts registers 'ad', music registers 'promo', ...) */
  on(purpose: string, f: Fulfil) { this.handlers.set(purpose, f); }
  async initialize(accountId: string, email: string, naira: number, purpose: string, meta: Record<string, unknown>, callbackUrl?: string) {
    if (!this.handlers.has(purpose)) throw new HttpError(400, 'Unknown purchase.');
    const kobo = Math.round(naira * 100); if (!Number.isFinite(kobo) || kobo < 100 * 100 || kobo > 100_000_000 * 100) throw new HttpError(400, 'Bad amount.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Enter a valid email for your receipt.');
    const reference = `HL-${purpose.toUpperCase()}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    run(this.db, 'INSERT INTO payments(reference, account_id, amount_kobo, purpose, meta, status, created_at) VALUES(?,?,?,?,?,?,?)', reference, accountId, kobo, purpose, JSON.stringify(meta), 'pending', Date.now());
    if (!this.live) return { reference, test: true, amount: kobo / 100 };
    const r = await fetch(`${API}/transaction/initialize`, { method: 'POST', headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, amount: kobo, currency: 'NGN', reference, callback_url: callbackUrl, metadata: { purpose, accountId, ...meta } }) });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j?.status) { run(this.db, "UPDATE payments SET status='failed', provider_data=? WHERE reference=?", JSON.stringify(j ?? {}), reference); throw new HttpError(502, j?.message ?? 'Paystack did not answer. Try again.'); }
    return { reference, test: false, amount: kobo / 100, authorizationUrl: j.data.authorization_url as string, accessCode: j.data.access_code as string, publicKey: this.publicKey };
  }
  /** confirm with Paystack (or accept a test completion) and fulfil once */
  async verify(reference: string, opts: { testComplete?: boolean; accountId?: string } = {}) {
    const row = one<PaymentRow>(this.db, 'SELECT * FROM payments WHERE reference=?', reference); if (!row) throw new HttpError(404, 'No such payment.');
    if (opts.accountId && row.account_id !== opts.accountId) throw new HttpError(403, 'Not your payment.');
    if (row.status === 'paid') return { status: 'paid' as const, row };
    if (!this.live) {
      if (!opts.testComplete) return { status: row.status as string, row };
      if (this.env.PAYSTACK_TEST_MODE === 'off') throw new HttpError(403, 'Test payments are switched off.');
      return this.markPaid(row, { test: true });
    }
    const r = await fetch(`${API}/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${this.secret}` } });
    const j: any = await r.json().catch(() => null); const d = j?.data;
    if (!d) return { status: row.status, row };
    if (d.status === 'success' && Number(d.amount) === row.amount_kobo && (d.currency ?? 'NGN') === row.currency) return this.markPaid(row, { id: d.id, channel: d.channel, paid_at: d.paid_at });
    if (d.status === 'failed' || d.status === 'abandoned') run(this.db, 'UPDATE payments SET status=? WHERE reference=? AND status=?', d.status, reference, 'pending');
    return { status: d.status as string, row };
  }
  private markPaid(row: PaymentRow, data: unknown) {
    const changed = run(this.db, "UPDATE payments SET status='paid', paid_at=?, provider_data=? WHERE reference=? AND status!='paid'", Date.now(), JSON.stringify(data), row.reference).changes;
    const paid = { ...row, status: 'paid', paid_at: Date.now() };
    if (changed) { try { this.handlers.get(row.purpose)?.(paid, JSON.parse(row.meta || '{}')); this.log.info(`payment ${row.reference} paid: ${row.purpose} ₦${row.amount_kobo / 100}`); } catch (e) { this.log.warn('fulfil failed', row.reference, e); } }
    return { status: 'paid' as const, row: paid };
  }
  /** Paystack's webhook: the signature is an HMAC-SHA512 of the raw body with the secret key */
  async webhook(raw: string, signature: string | undefined) {
    if (!this.live) throw new HttpError(400, 'Payments are in test mode.');
    const want = createHmac('sha512', this.secret).update(raw).digest('hex');
    if (!signature || want.length !== signature.length || !timingSafeEqual(Buffer.from(want), Buffer.from(signature))) throw new HttpError(401, 'Bad signature.');
    const ev = JSON.parse(raw); if (ev?.event === 'charge.success' && ev.data?.reference) await this.verify(String(ev.data.reference));
    return { ok: true };
  }
  /** give the money back (an ad we turned down). Test payments just flip to refunded. */
  async refund(reference: string, why: string) {
    const row = one<PaymentRow>(this.db, 'SELECT * FROM payments WHERE reference=?', reference); if (!row || row.status !== 'paid') return { ok: false, status: row?.status ?? 'missing' };
    if (this.live) {
      const r = await fetch(`${API}/refund`, { method: 'POST', headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction: reference, merchant_note: why.slice(0, 200) }) });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j?.status) { this.log.warn('refund failed', reference, j?.message); return { ok: false, status: 'refund_failed', message: j?.message as string | undefined }; }
    }
    run(this.db, "UPDATE payments SET status='refunded' WHERE reference=?", reference);
    return { ok: true, status: 'refunded' };
  }
  history(accountId: string) { return all<PaymentRow>(this.db, 'SELECT * FROM payments WHERE account_id=? ORDER BY created_at DESC LIMIT 50', accountId); }
  ledger(limit = 200) { return all<PaymentRow & { owner_name: string | null }>(this.db, 'SELECT p.*, f.name AS owner_name FROM payments p LEFT JOIN profiles f ON f.account_id=p.account_id ORDER BY p.created_at DESC LIMIT ?', limit); }
}
