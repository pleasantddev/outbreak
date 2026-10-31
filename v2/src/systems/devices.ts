// Phones as things you own, on the client: the size and shape of the phone in your hand (a small phone runs fewer
// apps, a tablet is big), cracks on the glass, the Phones app to switch, buy, fix and clean, repairing another
// player's screen for money, and, for repairers who kept a copy, what their clone can see. The server decides all of
// it (server/src/devices.ts).
import type { GameCtx, GameSystem, GoalPoint } from './registry';
import { net } from '../net/client';
import { registerApp } from '../ui/lifeHud';
import { BASIC_APPS, CRACK_NAMES, PHONE_CLEAN_PRICE, PHONE_MODELS, REPAIR_SHARE, type PhoneModelId } from '../net/rules';

interface Dev { id: string; model: PhoneModelId; crack: number; active: boolean }
interface Clone { device: string; owner: string; name: string; model: PhoneModelId; live: boolean; since: number }
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
const repairPrice = (d: Dev) => Math.round(PHONE_MODELS[d.model].price * REPAIR_SHARE[d.crack] / 100) * 100;

class DevicesApp {
  phones: Dev[] = [{ id: 'local', model: 'gidi', crack: 0, active: true }];
  clones: Clone[] = [];
  private shops: { name: string; x: number; z: number }[] = [];
  private view: { s: 'home' } | { s: 'clone'; device: string; with?: string; data?: any } = { s: 'home' };
  private price = 5000; private keep = false; private said = '';
  target: GoalPoint | null = null;
  constructor(private ctx: GameCtx) {}
  get hud() { return this.ctx.hud; }
  init() {
    registerApp('Phones', '', '', () => this.html());
    this.hud.appBack['Phones'] = () => { if (this.view.s !== 'home') { this.view = { s: 'home' }; return true; } return false; };
    new MutationObserver(() => this.wire()).observe(document.getElementById('av-l') ?? document.body, { childList: true });
    (window as any).__devices = this;
    void (async () => { try { const j = await (await fetch('content/places.json')).json(); this.shops = (j.items as any[]).filter((p) => p.kind === 'phones').map((p) => ({ name: p.name, ...this.ctx.store.project(p.lat, p.lon) })); } catch { /* none */ } })();
  }
  start() {
    const w = net.welcome as any; if (w?.phones) this.set(w.phones); else this.apply();
    net.on('welcome', (w2: any) => { if (w2?.phones) this.set(w2.phones); });
    net.on('phones' as any, (m: any) => { const was = this.cur().crack; this.set(m.list); if (this.cur().crack > was) this.hud.toast('Phone', `Your screen: ${CRACK_NAMES[this.cur().crack].toLowerCase()}.`, 'var(--red)', 'msg', 3.5); });
    net.on('devoffer' as any, (m: any) => {
      this.hud.call(m.fromName, `Fix your screen for ${naira(m.price)}?`, () => void this.accept(m.id), () => {}, 25);
    });
  }
  cur() { return this.phones.find((p) => p.active) ?? this.phones[0]; }
  set(list: Dev[]) { if (Array.isArray(list) && list.length) this.phones = list; this.apply(); if (this.hud.appOpen === 'Phones') this.hud.refreshApp(); }
  /** the phone in your hand decides its size, its shape and which apps it can run */
  private apply() {
    const d = this.cur(); const m = PHONE_MODELS[d.model];
    this.hud.setDevice({ scale: m.scale, tablet: d.model === 'tab', small: !!m.basic, crack: d.crack, basic: m.basic ? (n) => BASIC_APPS.includes(n) : undefined });
  }
  private nearShop() { const me = this.ctx.sim.local.pos; return this.shops.some((s) => Math.hypot(s.x - me.x, s.z - me.z) < 80); }
  private nearPlayers() {
    const me = this.ctx.sim.local.pos; const out: { id: number; name: string; d: number }[] = [];
    for (const [id, e] of net.known) { if (id === net.myId) continue; const d = Math.hypot((e as any).x - me.x, (e as any).z - me.z); if (d < 6) out.push({ id, name: net.who.get(id)?.name ?? 'Player', d }); }
    return out.sort((a, b) => a.d - b.d);
  }
  private hackLevel() { return ((this.ctx.systems.get('skills') as any)?.level?.('hack') ?? 1) as number; }
  /** a hard knock (a fall, a crash, a beating) may crack the glass */
  knock(hard: number) { if (net.active) void net.act('dev.drop', { hard }).then((r: any) => { if (r?.phones) { this.set(r.phones); this.hud.toast('Phone', `It fell. ${CRACK_NAMES[this.cur().crack]}.`, 'var(--red)', 'msg', 3); } }); }

  // ------------------------------------------------------------------------------------------ the app
  private html() {
    if (this.view.s === 'clone') return this.cloneHtml();
    const out: string[] = []; const shop = this.nearShop(); const online = net.active;
    if (this.said) out.push(`<div class="row" style="background:#eef6ff">${esc(this.said)}</div>`);
    out.push(`<div class="ad-sec" style="font:700 11px Inter;color:#8a8f9c;text-transform:uppercase;letter-spacing:.6px;margin:2px 4px">Your phones</div>`);
    for (const d of this.phones) {
      const m = PHONE_MODELS[d.model];
      out.push(`<div class="row${d.active ? ' sel' : ''}"><b>${m.name}${d.active ? ' · in your hand' : ''}</b>${m.kind}. ${CRACK_NAMES[d.crack]}.${m.basic ? ' Runs the basics only.' : ''}<br>
        ${!d.active && online ? `<button class="btn" data-dv="use:${d.id}">Use this one</button>` : ''}
        ${d.crack && shop ? `<button class="btn" data-dv="fix:${d.id}">Fix the screen (${naira(repairPrice(d))})</button>` : ''}
        ${shop ? `<button class="btn" data-dv="clean:${d.id}" style="background:#11131a">Clean it (${naira(PHONE_CLEAN_PRICE)})</button>` : ''}</div>`);
    }
    if (shop) out.push(`<div class="row"><b>For sale here</b>${(Object.keys(PHONE_MODELS) as PhoneModelId[]).map((k) => { const m = PHONE_MODELS[k]; return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #eef0f4"><span><b style="display:inline;font-size:13px">${m.name}</b> · ${m.kind}<br><span style="font-size:11.5px;color:#8a8f9c">${m.blurb}</span></span><button class="btn" data-dv="buy:${k}" style="flex:none">${naira(m.price)}</button></div>`; }).join('')}</div>`);
    else out.push(`<div class="row"><b>Buy, fix or clean a phone</b>Computer Village in Ikeja has every model and the best repairers. The phone stalls at Oshodi do it too. A cleaned phone is wiped of anything someone else put on it.<br><button class="btn" data-dv="go">Nearest phone shop</button></div>`);
    // fixing other people's phones
    const near = online ? this.nearPlayers() : [];
    if (near.length) out.push(`<div class="row"><b>Fix someone's screen</b>Stand next to them, set your price, they say yes or no.<input id="dv-price" type="number" min="500" step="500" value="${this.price}">${this.hackLevel() >= 3 ? `<label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:12.5px"><input type="checkbox" id="dv-keep" ${this.keep ? 'checked' : ''} style="width:auto;margin:0"> Keep a copy of their phone (they will not know)</label>` : ''}
      ${near.map((p) => `<button class="btn" data-dv="offer:${p.id}">${esc(p.name)}</button>`).join('')}</div>`);
    if (this.clones.length) out.push(`<div class="row"><b>Copies you kept</b>A copy works while they keep using that phone.${this.clones.map((c) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid #eef0f4"><span>${esc(c.name)} · ${PHONE_MODELS[c.model].name}${c.live ? '' : ' · gone quiet'}</span>${c.live ? `<button class="btn" data-dv="open:${c.device}" style="flex:none">Open</button>` : ''}</div>`).join('')}</div>`);
    if (online && !this.clones.length && this.hackLevel() >= 3) void this.loadClones();
    return out.join('');
  }
  private cloneHtml() {
    const v = this.view as { s: 'clone'; device: string; with?: string; data?: any }; const c = this.clones.find((x) => x.device === v.device);
    if (!v.data) { void this.cloneLoad(); return `<div class="row">Opening ${esc(c?.name ?? '')}'s phone…</div>`; }
    if (v.with) {
      const th = (v.data.thread ?? []) as { from_id: string; body: string; at: number }[];
      return `<div class="row"><b>${esc(c?.name ?? '')}'s chat</b>They see nothing of this.</div><div class="chat">${th.map((m) => `<div class="bub ${m.from_id === c?.owner ? 'me' : 'them'}">${esc(m.body)}</div>`).join('')}</div>
        <div class="composer"><input id="dv-msg" placeholder="Text as ${esc(c?.name ?? '')}" maxlength="500"><button data-dv="csend" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg></button></div>`;
    }
    const ts = (v.data.threads ?? []) as { other: string; body: string; name: string | null; saved: string | null; number: string }[];
    return `<div class="row"><b>${esc(c?.name ?? '')}'s phone</b>Their chats, their contacts, their bank app.<br><button class="btn" data-dv="locate">Where are they?</button><button class="btn" data-dv="steal" style="background:#7f1d1d">Move ₦50,000 out</button></div>
      ${ts.map((t) => `<div class="cell" data-dv="cread:${t.other}"><div class="tx"><b>${esc(t.saved ?? t.name ?? t.number)}</b><span>${esc(t.body)}</span></div></div>`).join('') || '<div class="row">No chats yet.</div>'}`;
  }
  private async loadClones() { const r: any = await net.act('dev.list'); if (r?.ok && r.clones?.length) { this.clones = r.clones; if (this.hud.appOpen === 'Phones') this.hud.refreshApp(); } }
  private async cloneLoad() {
    const v = this.view as any; const r: any = await net.act('clone.read', v.with ? { device: v.device, with: v.with } : { device: v.device });
    if (!r.ok) { this.hud.toast('Phones', r.err ?? 'Nothing.', 'var(--red)', 'msg', 3); this.view = { s: 'home' }; } else v.data = r;
    this.hud.refreshApp();
  }
  private wire() {
    const L = document.getElementById('av-l'); if (!L || this.hud.appOpen !== 'Phones') return;
    L.querySelectorAll<HTMLElement>('[data-dv]').forEach((el) => { if ((el as any)._dv) return; (el as any)._dv = 1; el.addEventListener('click', (e) => { e.stopPropagation(); void this.act(el.dataset.dv!); }); });
  }
  private async accept(id: string) { const r: any = await net.act('dev.accept', { offer: id }); if (!r.ok) { this.hud.toast('Phone', r.err ?? 'It did not go through.', 'var(--red)', 'msg', 3); return; } this.set(r.phones); this.hud.toast('Phone', 'Good as new.', 'linear-gradient(160deg,#9aa7b8,#2e3746)', 'msg', 3); }
  async act(op: string) {
    const [k, a] = [op.split(':')[0], op.slice(op.indexOf(':') + 1)]; this.said = '';
    const pr = document.getElementById('dv-price') as HTMLInputElement | null; if (pr) this.price = Math.max(500, Number(pr.value) || 5000);
    const kp = document.getElementById('dv-keep') as HTMLInputElement | null; if (kp) this.keep = kp.checked;
    if (k === 'go') { const me = this.ctx.sim.local.pos; const s = [...this.shops].sort((p, q) => Math.hypot(p.x - me.x, p.z - me.z) - Math.hypot(q.x - me.x, q.z - me.z))[0]; if (s) { this.target = { x: s.x, z: s.z, label: s.name }; this.hud.toast('Phones', `GPS set: ${s.name}.`, 'linear-gradient(160deg,#9aa7b8,#2e3746)', 'msg', 3); } return; }
    if (!net.active) { this.hud.toast('Phones', 'Play online to buy, switch or fix phones.', 'var(--red)', 'msg', 3); return; }
    let r: any = null;
    if (k === 'use') r = await net.act('dev.use', { id: a });
    else if (k === 'buy') r = await net.act('dev.buy', { model: a });
    else if (k === 'fix') r = await net.act('dev.repair', { id: a });
    else if (k === 'clean') { r = await net.act('dev.clean', { id: a }); if (r.ok) this.said = r.found ? 'The shop found something on it that should not be there, and wiped it. Whoever put it there has lost it.' : 'Wiped and clean.'; }
    else if (k === 'offer') { r = await net.act('dev.offer', { to: Number(a), price: this.price, clone: this.keep }); if (r.ok) this.said = 'Offer sent. Wait for them to say yes.'; }
    else if (k === 'open') { this.view = { s: 'clone', device: a }; this.hud.refreshApp(); return; }
    else if (k === 'cread') { const v = this.view as any; this.view = { s: 'clone', device: v.device, with: a }; this.hud.refreshApp(); return; }
    else if (k === 'csend') { const v = this.view as any; const b = (document.getElementById('dv-msg') as HTMLInputElement)?.value; if (!b) return; r = await net.act('clone.send', { device: v.device, to: v.with, body: b }); if (r.ok) { v.data = null; } }
    else if (k === 'locate') { const v = this.view as any; r = await net.act('clone.locate', { device: v.device }); if (r.ok) { if (r.at) { this.target = { x: r.at.x, z: r.at.z, label: 'Their phone' }; this.said = r.inside ? 'Inside somewhere. GPS set to the door.' : 'GPS set to where their phone is.'; } else this.said = 'Their phone is off.'; } }
    else if (k === 'steal') { const v = this.view as any; r = await net.act('clone.steal', { device: v.device, amount: 50000 }); if (r.ok) this.said = `Moved ${naira(r.took)}.`; }
    if (!r) return;
    if (!r.ok) { this.hud.toast('Phones', r.err ?? 'That did not work.', 'var(--red)', 'msg', 3.5); return; }
    if (r.phones) this.set(r.phones); else this.hud.refreshApp();
  }
}

let A: DevicesApp | null = null;
export const devicesSystem: GameSystem = {
  id: 'devices',
  init(ctx) { A = new DevicesApp(ctx); A.init(); },
  start() { A?.start(); },
  // a big hit on the player can crack the glass
  onEvent(ctx, e) { if (e.t === 'hurt' && e.actor === ctx.sim.local.id && e.dmg >= 25) A?.knock(e.dmg / 30); },
  goal() { const t = A?.target; if (!t || !A) return null; const me = (window as any).__life?.ctx?.sim?.local?.pos; if (me && Math.hypot(me.x - t.x, me.z - t.z) < 30) { A.target = null; return null; } return t; },
};
