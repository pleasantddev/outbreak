// The Market app as a trading app: the Eko Exchange (shares of Lagos companies, live charts, buy and sell), stakes in
// other players' shops (buy units, get paid when they empty the till, sell your own units), your portfolio, and the
// street prices. Online the server holds the money (server/src/exchange.ts); offline the same prices run on your save.
import type { GameCtx, GameSystem } from './registry';
import { net } from '../net/client';
import { streetPrices } from './societyUi';
import { EX_MAX_HOLD, TICKER, TICKERS, feeOf, history, quoteOf, type Ticker } from '../net/exchange';

type Tab = 'stocks' | 'shops' | 'mine' | 'street';
interface Hold { sym: string; qty: number; cost: number }
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const naira = (n: number, d = 0) => '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(2)}%`;
const big = (n: number) => n >= 1e12 ? `₦${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `₦${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `₦${(n / 1e6).toFixed(1)}M` : naira(n);
const UP = '#16c784', DN = '#ea3943';
const COL: Record<string, string> = { Transport: '#f5b301', Utilities: '#ffd23f', Banking: '#3b82f6', Consumer: '#f97316', Technology: '#8b5cf6', Energy: '#ef4444', Construction: '#94a3b8', Retail: '#ec4899', Leisure: '#d946ef', Media: '#06b6d4' };

const css = `
#appview:has(.ex),#appview:has(.ex) .list{background:#0d1117} #appview:has(.ex) .nav{background:#0d1117;box-shadow:0 1px 0 #21262d}
#appview .ex{background:#0d1117;margin:-10px -10px -8px;padding:12px 12px 18px;flex:1 0 auto;color:#e6edf3;font-family:Inter,system-ui,sans-serif;box-sizing:border-box}
#appview .ex .top small{display:block;color:#8b949e;font:600 11px Inter;letter-spacing:.5px;text-transform:uppercase}
#appview .ex .top .val{font:800 30px Inter;letter-spacing:-1px;margin:3px 0 1px;color:#fff} #appview .ex .top .chg{font:600 13px Inter}
#appview .ex .tabs{display:flex;gap:4px;background:#161b22;border-radius:12px;padding:3px;margin:12px 0}
#appview .ex .tabs button{flex:1;border:none;background:none;color:#8b949e;font:650 12.5px Inter;padding:8px 2px;border-radius:9px;cursor:pointer;pointer-events:auto}
#appview .ex .tabs button.on{background:#21262d;color:#fff}
#appview .ex .tk{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid #1c2128;cursor:pointer;pointer-events:auto}
#appview .ex .lg{flex:none;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 10px Inter;color:#0d1117}
#appview .ex .tk .nm{flex:1;min-width:0} #appview .ex .tk .nm b{display:block;font-size:14px;color:#e6edf3} #appview .ex .tk .nm span{display:block;font-size:11.5px;color:#8b949e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#appview .ex .tk svg.sp{flex:none;width:56px;height:26px}
#appview .ex .tk .px{flex:none;text-align:right;min-width:74px} #appview .ex .tk .px b{display:block;font:650 13.5px Inter;color:#e6edf3} #appview .ex .tk .px em{display:inline-block;margin-top:3px;font:700 11px Inter;font-style:normal;border-radius:6px;padding:2px 6px;color:#fff}
#appview .ex .hd{display:flex;align-items:center;gap:10px} #appview .ex .hd .lg{width:42px;height:42px;font-size:11px}
#appview .ex .chart{width:100%;height:150px;display:block;margin:10px 0 4px}
#appview .ex .rng{display:flex;gap:6px} #appview .ex .rng button{border:none;background:#161b22;color:#8b949e;font:650 12px Inter;padding:6px 12px;border-radius:8px;cursor:pointer;pointer-events:auto} #appview .ex .rng button.on{background:#21262d;color:#fff}
#appview .ex .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px} #appview .ex .grid div{background:#161b22;border-radius:10px;padding:9px 11px} #appview .ex .grid small{display:block;color:#8b949e;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.4px} #appview .ex .grid b{display:block;color:#e6edf3;font:700 14px Inter;margin-top:2px}
#appview .ex .blurb{color:#8b949e;font-size:12.5px;line-height:1.45;margin-top:12px}
#appview .ex .order{background:#161b22;border-radius:14px;padding:12px;margin-top:12px}
#appview .ex .qty{display:flex;align-items:center;gap:8px} #appview .ex .qty button{width:38px;height:38px;border-radius:10px;border:none;background:#21262d;color:#fff;font:700 18px Inter;cursor:pointer;pointer-events:auto}
#appview .ex .qty input{flex:1;min-width:0;margin:0!important;text-align:center;background:#0d1117!important;border:1px solid #30363d!important;color:#fff!important;font:700 16px Inter!important;border-radius:10px!important;padding:9px!important}
#appview .ex .chips{display:flex;gap:6px;margin-top:8px} #appview .ex .chips button{flex:1;border:none;background:#21262d;color:#c9d1d9;font:650 12px Inter;padding:6px 0;border-radius:8px;cursor:pointer;pointer-events:auto}
#appview .ex .est{display:flex;justify-content:space-between;color:#8b949e;font-size:12px;margin-top:10px} #appview .ex .est b{color:#e6edf3}
#appview .ex .bs{display:flex;gap:8px;margin-top:12px} #appview .ex .bs button{flex:1;border:none;border-radius:12px;padding:13px;font:800 14px Inter;color:#fff;cursor:pointer;pointer-events:auto} #appview .ex .bs .buy{background:${UP}} #appview .ex .bs .sell{background:${DN}} #appview .ex .bs button[disabled]{opacity:.35}
#appview .ex .sec{color:#8b949e;font:700 11px Inter;letter-spacing:.6px;text-transform:uppercase;margin:16px 4px 4px}
#appview .ex .card{background:#161b22;border-radius:14px;padding:12px;margin-top:8px} #appview .ex .card b{color:#e6edf3;font-size:14px} #appview .ex .card span{color:#8b949e;font-size:12px}
#appview .ex .card .row2{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid #21262d}
#appview .ex .card button,#appview .ex .pill{border:none;border-radius:9px;padding:7px 12px;font:700 12px Inter;background:${UP};color:#fff;cursor:pointer;pointer-events:auto}
#appview .ex .card input{margin:0!important;background:#0d1117!important;border:1px solid #30363d!important;color:#fff!important;border-radius:9px!important;padding:7px 9px!important;width:90px!important;font:600 13px Inter!important}
#appview .ex .note{color:#6e7681;font-size:11.5px;text-align:center;margin-top:12px;line-height:1.4}
`;

class ExchangeApp {
  private tab: Tab = 'stocks'; private sel: string | null = null; private range: '1D' | '1W' | '1M' = '1D'; private qty = 10;
  private pressure: Record<string, number> = {}; private pAt = 0; private shops: any = null; private pf: any = null; private busy = false;
  constructor(private ctx: GameCtx) {}
  get hud() { return this.ctx.hud; }
  init() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this.hud.appRenderers['Market'] = () => this.html();
    this.hud.appBack['Market'] = () => { if (this.sel) { this.sel = null; return true; } if (this.tab !== 'stocks') { this.tab = 'stocks'; return true; } return false; };
    new MutationObserver(() => this.wire()).observe(document.getElementById('av-l') ?? document.body, { childList: true });
    // a trading app ticks: redraw every few seconds while it is open (not while you are typing a number)
    window.setInterval(() => { if (this.hud.appOpen === 'Market' && document.activeElement?.tagName !== 'INPUT') this.redraw(); }, 4000);
    (window as any).__exchange = this;
  }
  private now() { return net.active ? net.epochNow : Date.now(); }
  private p(sym: string) { return this.pressure[sym] ?? 1; }
  private q(t: Ticker) { return quoteOf(t, this.now(), this.p(t.sym)); }
  /** holdings: from the server online, from the save offline */
  private holds(): Hold[] { if (net.active) return this.pf?.holdings ?? []; return ((this.ctx.save.ex ??= { h: [] }).h as Hold[]); }
  private async refresh() {
    if (!net.active || Date.now() - this.pAt < 20_000) return; this.pAt = Date.now();
    const [q, pf] = await Promise.all([net.act('ex.quotes'), net.act('ex.portfolio')]);
    if ((q as any).ok) this.pressure = (q as any).pressure; if ((pf as any).ok) this.pf = (pf as any).portfolio;
    this.redraw();
  }
  private redraw() { if (this.hud.appOpen === 'Market') this.hud.refreshApp(); }
  private spark(t: Ticker, w = 56, h = 26, n = 24) {
    const pts = history(t, this.now(), 86_400_000, n, this.p(t.sym)); const lo = Math.min(...pts), hi = Math.max(...pts); const up = pts[pts.length - 1] >= pts[0];
    const d = pts.map((v, i) => `${(i / (n - 1)) * w},${h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)}`).join(' ');
    return `<svg class="sp" viewBox="0 0 ${w} ${h}"><polyline points="${d}" fill="none" stroke="${up ? UP : DN}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }
  private chart(t: Ticker) {
    const span = this.range === '1D' ? 86_400_000 : this.range === '1W' ? 7 * 86_400_000 : 30 * 86_400_000; const n = 80;
    const pts = history(t, this.now(), span, n, this.p(t.sym)); const lo = Math.min(...pts), hi = Math.max(...pts); const up = pts[n - 1] >= pts[0]; const c = up ? UP : DN;
    const W = 300, H = 140; const xy = pts.map((v, i) => [(i / (n - 1)) * W, H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 20)] as [number, number]);
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="exg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
      <path d="${line} L${W} ${H} L0 ${H} Z" fill="url(#exg)"/><path d="${line}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      </svg><div class="est" style="margin-top:0"><span>${this.range} low ${naira(lo, 2)}</span><span>${this.range} high ${naira(hi, 2)}</span></div>`;
  }
  private logo(t: Ticker) { return `<span class="lg" style="background:${COL[t.sector] ?? '#94a3b8'}">${t.sym.slice(0, 4)}</span>`; }
  private worth() { let v = 0, c = 0, day = 0; for (const h of this.holds()) { const t = TICKER.get(h.sym); if (!t) continue; const q = this.q(t); v += q.sell * h.qty; c += h.cost; day += (q.price - q.open) * h.qty; } return { v, c, day }; }

  private html() {
    void this.refresh();
    const w = this.worth(); const cash = this.ctx.sim.cash;
    const top = `<div class="top"><small>Your portfolio</small><div class="val">${naira(Math.round(w.v))}</div><div class="chg" style="color:${w.day >= 0 ? UP : DN}">${w.day >= 0 ? '+' : '−'}${naira(Math.abs(Math.round(w.day)))} today · ${w.c ? pct((w.v - w.c) / w.c) : '+0.00%'} all time</div>
      <div style="color:#8b949e;font-size:12px;margin-top:4px">Cash to trade: ${naira(net.active ? (net.wallet?.bank ?? 0) + cash : cash)}</div></div>`;
    if (this.sel) { const t = TICKER.get(this.sel); if (t) return `<div class="ex">${this.detail(t)}</div>`; }
    const tabs = `<div class="tabs">${([['stocks', 'Stocks'], ['shops', 'Shops'], ['mine', 'Portfolio'], ['street', 'Street']] as [Tab, string][]).map(([k, l]) => `<button class="${this.tab === k ? 'on' : ''}" data-ex="tab:${k}">${l}</button>`).join('')}</div>`;
    let body = '';
    if (this.tab === 'stocks') body = this.stocks();
    else if (this.tab === 'shops') body = this.shopsHtml();
    else if (this.tab === 'mine') body = this.mine();
    else body = this.street();
    return `<div class="ex">${top}${tabs}${body}</div>`;
  }
  private stocks() {
    const rows = TICKERS.map((t) => { const q = this.q(t); return `<div class="tk" data-ex="sel:${t.sym}">${this.logo(t)}<div class="nm"><b>${t.sym}</b><span>${esc(t.name)}</span></div>${this.spark(t)}<div class="px"><b>${naira(q.price, 2)}</b><em style="background:${q.change >= 0 ? UP : DN}">${pct(q.change)}</em></div></div>`; }).join('');
    const movers = [...TICKERS].map((t) => ({ t, c: this.q(t).change })).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 1)[0];
    return `${movers ? `<div class="note" style="text-align:left;margin:0 4px 6px">Biggest mover today: <b style="color:${movers.c >= 0 ? UP : DN}">${movers.t.sym} ${pct(movers.c)}</b></div>` : ''}${rows}<div class="note">Eko Exchange. Prices move all day, every day. 1% brokerage, ₦50 minimum. Real players' orders push prices too.</div>`;
  }
  private detail(t: Ticker) {
    const q = this.q(t); const h = this.holds().find((x) => x.sym === t.sym); const value = Math.round(q.buy * this.qty); const fee = feeOf(value);
    return `<div class="hd">${this.logo(t)}<div><b style="font-size:16px;color:#fff">${t.sym}</b><div style="color:#8b949e;font-size:12px">${esc(t.name)} · ${t.sector}</div></div></div>
      <div class="top" style="margin-top:12px"><div class="val">${naira(q.price, 2)}</div><div class="chg" style="color:${q.change >= 0 ? UP : DN}">${pct(q.change)} today</div></div>
      ${this.chart(t)}<div class="rng">${(['1D', '1W', '1M'] as const).map((r) => `<button class="${this.range === r ? 'on' : ''}" data-ex="rng:${r}">${r}</button>`).join('')}</div>
      <div class="grid"><div><small>Open</small><b>${naira(q.open, 2)}</b></div><div><small>Day range</small><b>${naira(q.low, 0)} to ${naira(q.high, 0)}</b></div><div><small>Market cap</small><b>${big(q.cap)}</b></div><div><small>You own</small><b>${h ? `${h.qty.toLocaleString()} · avg ${naira(h.cost / h.qty, 2)}` : 'None yet'}</b></div></div>
      <div class="blurb">${esc(t.blurb)}</div>
      <div class="order"><div class="qty"><button data-ex="q:-">−</button><input id="ex-q" type="number" min="1" max="${EX_MAX_HOLD}" value="${this.qty}"><button data-ex="q:+">+</button></div>
        <div class="chips">${[10, 100, 1000, 5000].map((n) => `<button data-ex="qs:${n}">${n.toLocaleString()}</button>`).join('')}</div>
        <div class="est"><span>Buy at ${naira(q.buy, 2)} · sell at ${naira(q.sell, 2)}</span></div>
        <div class="est"><span>Cost of ${this.qty.toLocaleString()} with fee</span><b>${naira(value + fee)}</b></div>
        <div class="bs"><button class="buy" data-ex="buy" ${this.busy ? 'disabled' : ''}>Buy</button><button class="sell" data-ex="sell" ${!h || this.busy ? 'disabled' : ''}>Sell</button></div></div>
      <div class="note">${net.active ? 'Paid from your bank first, then cash. Sales go to your bank.' : 'Offline: trades use your cash and live in your save.'}</div>`;
  }
  private shopsHtml() {
    if (!net.active) return `<div class="card"><b>Invest in real players' shops</b><br><span>Buy units of other players' kiosks, POS stands and chemists. When they empty the till you get your share. Play online to see what is on offer.</span></div>`;
    if (!this.shops) { void this.loadShops(); return `<div class="note">Loading the shops…</div>`; }
    const L = this.shops.list as any[]; const mine = this.shops.mine;
    let h = `<div class="sec">On offer</div>` + (L.filter((x) => x.offers.length).map((b) => `<div class="card"><b>${esc(b.label)}</b> <span>· ${esc(b.owner)}</span><br><span>Owner holds ${b.ownerUnits} of 100 units · ${b.investors} investor${b.investors === 1 ? '' : 's'} · paid out ${naira(b.paidWeek)} this week</span>
      ${b.offers.map((o: any) => `<div class="row2"><span>${o.units} unit${o.units > 1 ? 's' : ''} at ${naira(o.price)} each · ${esc(o.name ?? '')}</span><span style="display:flex;gap:6px"><button data-ex="take:${o.id}:1">Buy 1</button>${o.units > 1 ? `<button data-ex="take:${o.id}:${o.units}">All ${o.units}</button>` : ''}</span></div>`).join('')}</div>`).join('') || `<div class="card"><span>Nobody is selling units right now. Shop owners can sell up to 49 units of their own business here.</span></div>`);
    if (mine?.stakes?.length) h += `<div class="sec">Your stakes</div>` + mine.stakes.map((s: any) => `<div class="card"><b>${s.units} units of a ${esc(s.type)}</b><br><span>Paid you ${naira(s.paid)} so far · cost ${naira(Math.round(s.cost))}</span><div class="row2"><span>Sell</span><span style="display:flex;gap:6px"><input id="ex-u-${s.site}" type="number" min="1" max="${s.units}" value="1"><input id="ex-p-${s.site}" type="number" min="1000" step="500" value="5000"><button data-ex="offer:${s.site}">List</button></span></div></div>`).join('');
    const own = this.shops.own as any[] | undefined;
    if (own?.length) h += `<div class="sec">Raise money from your shops</div>` + own.map((b: any) => `<div class="card"><b>Your ${esc(b.type)}</b><br><span>Sell units (up to 49). Buyers pay you now and get their share of the till when you collect.</span><div class="row2"><span>Units, price each</span><span style="display:flex;gap:6px"><input id="ex-u-${b.site}" type="number" min="1" max="49" value="10"><input id="ex-p-${b.site}" type="number" min="1000" step="500" value="5000"><button data-ex="offer:${b.site}">List</button></span></div></div>`).join('');
    if (mine?.offers?.length) h += `<div class="sec">Your offers</div>` + mine.offers.map((o: any) => `<div class="card"><span>${o.units} units at ${naira(o.price)} each</span><div class="row2"><span></span><button style="background:#30363d" data-ex="cancel:${o.id}">Take down</button></div></div>`).join('');
    return h;
  }
  /** what things cost on the street today: the same live economy the ticker shows */
  private street() {
    const d = streetPrices.data?.(); if (!d) return `<div class="note">The city is still waking up.</div>`;
    const line = (h: number[], up: boolean) => { if (h.length < 2) return ''; const lo = Math.min(...h), hi = Math.max(...h); return `<svg class="sp" viewBox="0 0 56 26"><polyline points="${h.map((v, i) => `${((i / (h.length - 1)) * 56).toFixed(1)},${(24 - ((v - lo) / (hi - lo || 1)) * 22).toFixed(1)}`).join(' ')}" fill="none" stroke="${up ? DN : UP}" stroke-width="1.6" stroke-linejoin="round"/></svg>`; };
    let h = `<div class="note" style="text-align:left;margin:0 4px 6px">Prices rising since day 3: <b style="color:${d.infl > 0.05 ? DN : '#e6edf3'}">${(d.infl * 100).toFixed(1)}%</b>. Red means it costs more today.</div>`;
    h += d.rows.map((r) => { const flat = Math.abs(r.change) < 0.004; return `<div class="tk" style="cursor:default"><div class="nm"><b>${esc(r.label)}</b></div>${line(r.hist, r.change > 0)}<div class="px"><b>${naira(r.price)}</b><em style="background:${flat ? '#30363d' : r.change > 0 ? DN : UP}">${flat ? 'level' : pct(r.change)}</em></div></div>`; }).join('');
    if (d.now.length) h += `<div class="sec">Happening now</div>` + d.now.map((n) => `<div class="card"><b>${esc(n.label)}</b><br><span>${esc(n.area)} · ${n.left}</span></div>`).join('');
    if (d.news.length) h += `<div class="sec">Street news</div>` + d.news.map((n) => `<div class="card"><span>${esc(n.when)}</span><br><b style="font-weight:500;font-size:13px">${esc(n.text)}</b></div>`).join('');
    return h;
  }
  private async loadShops() { const [m, b] = await Promise.all([net.act('bx.market'), net.act('biz.mine')]); if ((m as any).ok) this.shops = { list: (m as any).list, mine: (m as any).mine, own: (b as any).ok ? (b as any).list : [] }; else this.shops = { list: [], mine: null, own: [] }; this.redraw(); }
  private mine() {
    const hs = this.holds(); const w = this.worth();
    let h = `<div class="grid" style="margin-top:0"><div><small>Value</small><b>${naira(Math.round(w.v))}</b></div><div><small>Profit</small><b style="color:${w.v - w.c >= 0 ? UP : DN}">${w.v - w.c >= 0 ? '+' : '−'}${naira(Math.abs(Math.round(w.v - w.c)))}</b></div></div>`;
    h += `<div class="sec">Shares</div>` + (hs.map((x) => { const t = TICKER.get(x.sym)!; const q = this.q(t); const v = q.sell * x.qty; return `<div class="tk" data-ex="sel:${x.sym}">${this.logo(t)}<div class="nm"><b>${x.sym} · ${x.qty.toLocaleString()}</b><span>avg ${naira(x.cost / x.qty, 2)}</span></div><div class="px"><b>${naira(Math.round(v))}</b><em style="background:${v >= x.cost ? UP : DN}">${pct((v - x.cost) / (x.cost || 1))}</em></div></div>`; }).join('') || `<div class="note">You own no shares yet. Pick a company under Stocks.</div>`);
    const tr = net.active ? (this.pf?.trades ?? []) : [];
    if (tr.length) h += `<div class="sec">Recent trades</div>` + tr.slice(0, 10).map((t: any) => `<div class="tk" style="cursor:default"><div class="nm"><b style="color:${t.side === 'buy' ? UP : DN}">${t.side === 'buy' ? 'Bought' : 'Sold'} ${t.qty.toLocaleString()} ${t.sym}</b><span>${new Date(t.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div><div class="px"><b>${naira(t.price, 2)}</b></div></div>`).join('');
    return h;
  }

  private wire() {
    const L = document.getElementById('av-l'); if (!L || this.hud.appOpen !== 'Market') return;
    L.querySelectorAll<HTMLElement>('[data-ex]').forEach((el) => { if ((el as any)._ex) return; (el as any)._ex = 1; el.addEventListener('click', (e) => { e.stopPropagation(); void this.act(el.dataset.ex!); }); });
    const qi = document.getElementById('ex-q') as HTMLInputElement | null; if (qi && !(qi as any)._ex) { (qi as any)._ex = 1; qi.addEventListener('change', () => { this.qty = Math.max(1, Math.min(EX_MAX_HOLD, Math.floor(Number(qi.value) || 1))); this.redraw(); }); }
  }
  async act(op: string) {
    const [k, a, b] = op.split(':');
    if (k === 'tab') { this.tab = a as Tab; this.sel = null; if (a === 'shops') { this.shops = null; } if (a === 'mine') this.pAt = 0; }
    else if (k === 'sel') { this.sel = a; this.qty = this.holds().find((x) => x.sym === a)?.qty ?? 10; }
    else if (k === 'rng') this.range = a as any;
    else if (k === 'q') this.qty = Math.max(1, this.qty + (a === '+' ? (this.qty >= 100 ? 10 : 1) : -(this.qty > 100 ? 10 : 1)));
    else if (k === 'qs') this.qty = Number(a);
    else if (k === 'buy' || k === 'sell') { await this.trade(k); return; }
    else if (k === 'take') { const r: any = await net.act('bx.take', { id: Number(a), units: Number(b) }); this.toast(r.ok ? `You bought ${r.units} unit${r.units > 1 ? 's' : ''} for ${naira(r.value)}. You get your share when the owner collects.` : (r.err ?? 'That did not go through.'), !r.ok); this.shops = null; }
    else if (k === 'offer') { const u = Number((document.getElementById('ex-u-' + a) as HTMLInputElement)?.value), p = Number((document.getElementById('ex-p-' + a) as HTMLInputElement)?.value); const r: any = await net.act('bx.offer', { site: a, units: u, price: p }); this.toast(r.ok ? `Listed ${u} units at ${naira(p)} each.` : (r.err ?? 'Could not list them.'), !r.ok); this.shops = null; }
    else if (k === 'cancel') { await net.act('bx.cancel', { id: Number(a) }); this.shops = null; }
    this.redraw();
  }
  private toast(t: string, bad = false) { this.hud.toast('Eko Exchange', t, bad ? 'var(--red)' : `linear-gradient(160deg,${UP},#0b7d52)`, 'cash' as any, 4); }
  private async trade(side: 'buy' | 'sell') {
    const sym = this.sel; if (!sym || this.busy) return; const t = TICKER.get(sym)!; const qty = this.qty;
    if (net.active) {
      this.busy = true; this.redraw();
      const r: any = await net.act('ex.trade', { sym, side, qty }); this.busy = false;
      if (!r.ok) { this.toast(r.err ?? 'The order did not go through.', true); this.redraw(); return; }
      this.toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${qty.toLocaleString()} ${sym} at ${naira(r.trade.price, 2)}. Fee ${naira(r.trade.fee)}.`);
      this.pAt = 0; await this.refresh(); return;
    }
    // offline: the same prices and fees on your save, paid in cash
    const q = this.q(t); const H = this.holds(); const h = H.find((x) => x.sym === sym); const sim = this.ctx.sim;
    if (side === 'buy') { const value = Math.round(q.buy * qty), fee = feeOf(value); if (sim.cash < value + fee) { this.toast('Not enough cash.', true); return; } sim.cash -= value + fee; if (h) { h.qty += qty; h.cost += value + fee; } else H.push({ sym, qty, cost: value + fee }); this.toast(`Bought ${qty.toLocaleString()} ${sym} at ${naira(q.buy, 2)}.`); }
    else { if (!h || h.qty < qty) { this.toast('You do not have that many shares.', true); return; } const value = Math.round(q.sell * qty), fee = feeOf(value); sim.cash += Math.max(0, value - fee); h.cost -= h.cost * (qty / h.qty); h.qty -= qty; if (!h.qty) H.splice(H.indexOf(h), 1); this.toast(`Sold ${qty.toLocaleString()} ${sym} at ${naira(q.sell, 2)}.`); }
    this.ctx.persist(); this.redraw();
  }
}

let X: ExchangeApp | null = null;
export const exchangeSystem: GameSystem = { id: 'exchange', init(ctx) { X = new ExchangeApp(ctx); X.init(); } };
