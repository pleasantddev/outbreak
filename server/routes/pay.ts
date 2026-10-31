// Real-money checkouts (src/payments.ts). The game calls start, opens Paystack's page (or the test sheet), then polls status.
import type { Api } from '../src/api.ts';
import { reply } from '../src/api.ts';
import { pub } from '../src/payments.ts';

export function register(api: Api) {
  const pay = api.payments;
  api.get('/api/pay/config', () => pay.publicConfig());
  api.post('/api/pay/start', async (req) => pay.start(req.account!, req.body.sku, req.body.meta), { auth: 'user', rate: { limit: 20, windowMs: 60_000 } });
  api.get('/api/pay/mine', (req) => ({ items: pay.mine(req.account!.id) }), { auth: 'user' });
  api.get('/api/pay/ledger', (req) => pay.ledger({ status: req.query.status || undefined, limit: Number(req.query.limit) || 100, before: req.query.before ? Number(req.query.before) : undefined }), { auth: 'admin' });
  api.get('/api/pay/status/:ref', async (req) => pub(await pay.status(req.account!.id, req.params.ref)), { auth: 'user', rate: { limit: 120, windowMs: 60_000 } });
  api.post('/api/pay/status/:ref/test-complete', (req) => pub(pay.testComplete(req.account!.id, req.params.ref)), { auth: 'user', rate: { limit: 20, windowMs: 60_000 } });
  api.post('/api/pay/status/:ref/cancel', (req) => pub(pay.cancel(req.account!.id, req.params.ref)), { auth: 'user' });
  // Paystack calls this; always 200 for a good signature so it stops retrying, 401 otherwise
  api.post('/api/pay/paystack/webhook', (req) => {
    const r = pay.webhook(req.rawBody ?? '', req.headers['x-paystack-signature']);
    return r.ok ? { ok: true } : reply(401, { error: r.why });
  }, { rawBody: true, bodyLimit: 64 * 1024, rate: { limit: 600, windowMs: 60_000 } });
}
