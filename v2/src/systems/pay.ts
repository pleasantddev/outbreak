// Real money: the Top Up phone app and the one checkout every real-naira purchase uses (rules in net/rules.ts, the
// server side in server/src/payments.ts). Online only. The server prices everything; the game never sends a price.
//   live: Paystack's card / bank / USSD page opens in a new tab; the app waits and asks the server, which verifies.
//   test: a server with no Paystack key shows a test sheet; nothing is charged.
// Other systems (MyAds, club song promotion) call payApi.checkout(sku, meta) and get the settled purchase back.
import type { GameCtx, GameSystem } from './registry';
import { net } from '../net/client';
import { registerApp } from '../ui/lifeHud';

interface Pack { id: string; name: string; desc: string; tag: string; priceNGN: number; wasNGN: number; grants: { cash: number; bank: number }; limit: number }
interface Receipt { ref: string; sku: string; label: string; naira: number; status: string; granted: Record<string, unknown>; at: number; promo: string | null }
interface Pending { ref: string; label: string; naira: number; mode: string; url: string | null; t0: number; resolve?: (r: Receipt | null) => void }
const fmt = (n: number) => '₦' + Math.round(n).toLocaleString();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const GRAD = 'linear-gradient(160deg,#00c3f7,#0b5bd3)';
const STATUS: Record<string, string> = { paid: 'Paid', pending: 'Waiting', failed: 'Not paid', mismatch: 'Under review', refunded: 'Refunded' };
const css = `
#appview .pk{display:flex;align-items:center;gap:12px;background:#fff;border-radius:16px;padding:12px 13px;box-shadow:0 1px 2px rgba(16,24,40,.06)}
#appview .pk .ic{flex:none;width:44px;height:44px;border-radius:12px;background:${GRAD};display:flex;align-items:center;justify-content:center;color:#fff;font:800 15px Inter,sans-serif}
#appview .pk .tx{flex:1;min-width:0} #appview .pk .tx b{display:block;color:#11131a;font-size:14.5px} #appview .pk .tx span{display:block;color:#6b7280;font-size:12.5px}
#appview .pk .tx em{font-style:normal;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#0b5bd3;margin-left:6px}
#appview .pk button{flex:none;border:none;border-radius:999px;background:#11131a;color:#fff;font:700 13px Inter,sans-serif;padding:9px 14px;cursor:pointer;pointer-events:auto}
#appview .pk s{color:#9ca3af;font-size:11px;display:block;text-align:right}
#appview .paysheet{background:#11131a;color:#fff;border-radius:18px;padding:16px;text-align:center}
#appview .paysheet b{color:#fff;font-size:16px;display:block} #appview .paysheet .amt{font:800 30px Inter,sans-serif;margin:8px 0 4px}
#appview .paysheet span{color:#9ca3af;font-size:12.5px;display:block} #appview .paysheet .btn{margin-top:10px}
#appview .paysheet input{display:block;width:100%;box-sizing:border-box;margin:12px 0 2px!important;padding:10px 12px!important;border-radius:12px!important;border:1px solid rgba(255,255,255,.22)!important;background:rgba(255,255,255,.08)!important;color:#fff!important;font:600 14px Inter,sans-serif!important;text-transform:uppercase;text-align:center;letter-spacing:.5px}
#appview .paysheet input::placeholder{text-transform:none;color:#9ca3af;letter-spacing:0;font-weight:500}
#appview .paysheet .ghost{background:transparent!important;border:1px solid rgba(255,255,255,.25)!important}
#appview .rc{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;color:#374151;padding:8px 2px;border-bottom:1px solid #e5e7eb}
#appview .rc b{color:#11131a;font-weight:600} #appview .rc i{font-style:normal;color:#6b7280}
`;

class Pay {
  packs: Pack[] = []; mode: 'live' | 'test' | 'off' | '' = ''; mine: Receipt[] = []; pending: Pending | null = null; confirm: Pack | null = null;
  private pollT = 0; private loaded = 0; private busy = false;
  constructor(private ctx: GameCtx) {}
  get hud() { return this.ctx.hud; }
  init() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    registerApp('Top Up', 'M3 7h18v10H3zM3 11h18M7 15h3', GRAD, () => this.html());
    this.hud.appBack['Top Up'] = () => { if (this.confirm) { this.confirm = null; return true; } return false; };
    (window as any).__pay = this;
  }
  start() {
    // Paystack sends the player back to the game with ?reference=hl_...
    const ref = new URLSearchParams(location.search).get('reference') ?? new URLSearchParams(location.search).get('trxref');
    if (ref && /^hl_[a-z0-9]{20}$/.test(ref)) {
      const clean = () => { try { const u = new URL(location.href); u.searchParams.delete('reference'); u.searchParams.delete('trxref'); history.replaceState(null, '', u.toString()); } catch { /* ignore */ } };
      const go = () => { this.pending = { ref, label: 'Your payment', naira: 0, mode: 'live', url: null, t0: Date.now() }; void this.poll(); clean(); };
      if (net.active) go(); else net.on('welcome', () => { if (!this.pending) go(); });
    }
  }
  private async load(force = false) {
    if (!net.active || (!force && Date.now() - this.loaded < 60_000)) return; this.loaded = Date.now();
    try {
      const c = await net.api<{ mode: 'live' | 'test' | 'off'; packs: Pack[] }>('GET', '/api/pay/config', undefined, false); this.mode = c.mode; this.packs = c.packs;
      this.mine = (await net.api<{ items: Receipt[] }>('GET', '/api/pay/mine')).items;
    } catch { this.mode = 'off'; }
    this.redraw();
  }
  private redraw() { if (this.hud.appOpen === 'Top Up') this.hud.refreshApp(); }
  private toast(title: string, body: string, bad = false) { this.hud.toast(title, body, bad ? 'var(--red)' : GRAD, 'cash' as any, 4); }

  /** start a real-money checkout for any product; resolves with the receipt once paid, or null if it did not go through */
  checkout(sku: string, meta: Record<string, unknown> = {}): Promise<Receipt | null> {
    if (!net.active) { this.toast('Top Up', 'You need to be online to pay with real money.', true); return Promise.resolve(null); }
    if (this.busy) return Promise.resolve(null);
    if (this.pending) { this.toast('Top Up', 'Finish the payment you started first.', true); this.hud.openAppByName('Top Up'); return Promise.resolve(null); }
    this.busy = true;
    // open the tab inside the tap, before any await, or the browser blocks it as a pop up
    const tab = this.mode === 'live' ? window.open('about:blank', '_blank') : null;
    return new Promise((resolve) => {
      net.api<{ ref: string; amountKobo: number; label: string; mode: string; authorizationUrl: string | null }>('POST', '/api/pay/start', { sku, meta })
        .then((r) => {
          this.pending = { ref: r.ref, label: r.label, naira: r.amountKobo / 100, mode: r.mode, url: r.authorizationUrl, t0: Date.now(), resolve };
          if (r.authorizationUrl) { if (tab) tab.location.href = r.authorizationUrl; else window.open(r.authorizationUrl, '_blank'); void this.poll(); }
          else tab?.close();
          this.hud.openAppByName('Top Up'); this.redraw();
        })
        .catch((e: any) => { tab?.close(); this.toast('Top Up', e?.message ?? 'Could not start the payment.', true); resolve(null); })
        .finally(() => { this.busy = false; });
    });
  }
  private async poll() {
    const p = this.pending; if (!p) return;
    try {
      const r = await net.api<Receipt>('GET', `/api/pay/status/${p.ref}`);
      if (r.status !== 'pending') { this.finish(r); return; }
    } catch { /* keep waiting */ }
    if (Date.now() - p.t0 > 20 * 60_000) { this.toast('Top Up', 'We are still waiting on Paystack. If you paid, it will land on its own.'); this.pending = null; p.resolve?.(null); this.redraw(); return; }
    window.clearTimeout(this.pollT); this.pollT = window.setTimeout(() => void this.poll(), 4000);
  }
  private finish(r: Receipt) {
    const p = this.pending; this.pending = null; window.clearTimeout(this.pollT);
    if (r.status === 'paid') this.toast('Payment received', `${r.label} is yours.`);
    else if (r.status === 'mismatch') this.toast('Top Up', 'The amount did not match. Support will check it.', true);
    else this.toast('Top Up', 'The payment did not go through. You were not charged.', true);
    p?.resolve?.(r.status === 'paid' ? r : null); this.loaded = 0; void this.load(true); this.redraw();
  }

  private html() {
    if (!net.active) return `<div class="row"><b>Top Up needs the network</b>Play online to buy with real money. Your single player save is not touched.</div>`;
    void this.load();
    const p = this.pending;
    if (p) {
      const test = p.mode === 'test';
      return `<div class="paysheet"><b>${esc(p.label)}</b><div class="amt">${p.naira ? fmt(p.naira) : '...'}</div>
        <span>${test ? 'Test server: no card, no real money. Tap Pay to finish.' : 'Paystack opened in a new tab. Pay there, then come back here. This page updates by itself.'}</span>
        ${test ? `<button class="btn" data-app="Top Up" data-id="testpay">Pay ${p.naira ? fmt(p.naira) : ''}</button>` : `<button class="btn" data-app="Top Up" data-id="check">I don pay, check am</button>${p.url ? ` <button class="btn ghost" data-app="Top Up" data-id="reopen">Open Paystack again</button>` : ''}`}
        <br><button class="btn ghost" data-app="Top Up" data-id="drop">${test ? 'Cancel' : 'Hide'}</button></div>`;
    }
    if (this.confirm) {
      const k = this.confirm;
      return `<div class="paysheet"><b>${esc(k.name)}</b><div class="amt">${fmt(k.priceNGN)}</div><span>${esc(k.desc || `${fmt(k.grants.cash)} in your hand.`)}</span>
        <input id="pay-promo" placeholder="Promo code (optional)" autocomplete="off">
        <button class="btn" data-app="Top Up" data-id="go:${k.id}">${this.mode === 'test' ? 'Continue (test)' : 'Pay with Paystack'}</button><br><button class="btn ghost" data-app="Top Up" data-id="back">Back</button>
        <span style="margin-top:8px">${this.mode === 'test' ? 'Test server: nothing is charged.' : 'Card, bank transfer or USSD through Paystack. This is real money. Game cash you don spend no dey come back.'}</span></div>`;
    }
    if (this.mode === 'off') return `<div class="row"><b>Top Up is not open yet</b>The store go open soon. Keep hustling.</div>`;
    const packs = this.packs.map((k) => `<div class="pk"><div class="ic">₦</div><div class="tx"><b>${esc(k.name)}${k.tag ? `<em>${esc(k.tag)}</em>` : ''}</b><span>${fmt(k.grants.cash + k.grants.bank)} game money</span></div>
      <div>${k.wasNGN ? `<s>${fmt(k.wasNGN)}</s>` : ''}<button data-app="Top Up" data-id="pick:${k.id}">${fmt(k.priceNGN)}</button></div></div>`).join('');
    const rc = this.mine.slice(0, 8).map((r) => `<div class="rc"><b>${esc(r.label)}</b><i>${new Date(r.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${fmt(r.naira)} · ${STATUS[r.status] ?? r.status}</i></div>`).join('');
    const head = this.mode === 'test' ? `<div class="row"><b>Test store</b>This server has no Paystack key, so nothing here costs real money.</div>` : '';
    return head + (packs || `<div class="row"><b>Loading the store</b>One moment.</div>`) + (rc ? `<div class="row"><b>Your receipts</b>${rc}</div>` : '');
  }
  onAction(app: string, id: string) {
    if (app !== 'Top Up') return false;
    const [op, arg] = [id.split(':')[0], id.slice(id.indexOf(':') + 1)];
    if (op === 'pick') { this.confirm = this.packs.find((k) => k.id === arg) ?? null; this.redraw(); }
    else if (op === 'back') { this.confirm = null; this.redraw(); }
    else if (op === 'go') {
      const promo = ((document.getElementById('pay-promo') as HTMLInputElement | null)?.value ?? '').trim().toUpperCase();
      this.confirm = null; void this.checkout(`iap:${arg}`, promo ? { promo } : {});
    } else if (op === 'testpay' && this.pending) {
      const ref = this.pending.ref;
      net.api<Receipt>('POST', `/api/pay/status/${ref}/test-complete`, {}).then((r) => this.finish(r)).catch((e: any) => this.toast('Top Up', e?.message ?? 'Try again.', true));
    } else if (op === 'check') { window.clearTimeout(this.pollT); void this.poll(); this.toast('Top Up', 'Checking with Paystack...'); }
    else if (op === 'reopen' && this.pending?.url) window.open(this.pending.url, '_blank');
    else if (op === 'drop' && this.pending) {
      const p = this.pending;
      if (p.mode === 'test') void net.api('POST', `/api/pay/status/${p.ref}/cancel`, {}).catch(() => undefined);
      // a live payment can still land after this; the server credits it when Paystack confirms
      this.pending = null; window.clearTimeout(this.pollT); p.resolve?.(null); this.redraw();
    }
    return true;
  }
}

let P: Pay | null = null;
export const payApi = { checkout: (sku: string, meta?: Record<string, unknown>) => P?.checkout(sku, meta) ?? Promise.resolve(null) };
export const paySystem: GameSystem & { get api(): Pay | null } = {
  id: 'pay', get api() { return P; },
  init(ctx) { P = new Pay(ctx); P.init(); },
  start() { P?.start(); },
  onAction(_c, app, id) { return P?.onAction(app, id) ?? false; },
};
