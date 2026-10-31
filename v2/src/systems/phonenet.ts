// The phone network on your phone: Contacts (your number and public ID to share, add people by number or ID),
// Messages (real texts between players, stored on the server and delivered when they come online; the city's NPCs
// still text you too), and Phone (dial a number or a contact; the call itself is a voice link, systems/voice.ts).
import type { GameCtx, GameSystem } from './registry';
import { net } from '../net/client';
import { registerApp } from '../ui/lifeHud';
import { voice } from './voice';

interface Contact { id: string; name: string; number: string; publicId: string; player: string | null; online: boolean }
interface Thread { other: string; body: string; at: number; mine: number; unread: number; name: string | null; saved: string | null; number: string }
interface Msg { id: number; from_id: string; body: string; at: number }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const when = (t: number) => { const d = Date.now() - t; if (d < 60_000) return 'now'; if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`; if (d < 86_400_000) return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const css = `
#appview .me-card{background:linear-gradient(135deg,#1f2937,#111827);color:#fff;border-radius:18px;padding:14px 15px}
#appview .me-card b{color:#fff;font-size:16px} #appview .me-card .num{font:700 20px Inter,sans-serif;letter-spacing:.5px;margin:6px 0 2px;color:#fff} #appview .me-card span{color:#9ca3af;font-size:12px}
#appview .cell{display:flex;align-items:center;gap:11px;background:#fff;border-radius:16px;padding:10px 12px;box-shadow:0 1px 2px rgba(16,24,40,.06);pointer-events:auto;cursor:pointer}
#appview .cell .av{flex:none;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 15px Inter,sans-serif;color:#fff;position:relative}
#appview .cell .av i{position:absolute;right:0;bottom:0;width:11px;height:11px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 2px #fff}
#appview .cell .tx{flex:1;min-width:0} #appview .cell .tx b{display:block;font-size:14px;color:#11131a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #appview .cell .tx span{display:block;font-size:12.5px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#appview .cell .rt{text-align:right;font-size:11px;color:#9ca3af} #appview .cell .rt u{display:inline-block;margin-top:4px;min-width:18px;height:18px;border-radius:9px;background:#18a34a;color:#fff;font:700 11px/18px Inter;text-decoration:none;text-align:center;padding:0 5px;box-sizing:border-box}
#appview .cell .act{display:flex;gap:6px} #appview .cell .act button{width:34px;height:34px;border-radius:50%;border:none;background:#eef0f4;cursor:pointer;display:flex;align-items:center;justify-content:center}
#appview .cell .act svg{width:17px;height:17px;fill:none;stroke:#11131a;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#appview .chat{display:flex;flex-direction:column;gap:4px;padding:4px 2px}
#appview .bub{max-width:80%;padding:8px 12px;border-radius:18px;font-size:13.5px;line-height:1.35;word-wrap:break-word}
#appview .bub.me{align-self:flex-end;background:#18a34a;color:#fff;border-bottom-right-radius:6px} #appview .bub.them{align-self:flex-start;background:#fff;color:#11131a;border-bottom-left-radius:6px;box-shadow:0 1px 2px rgba(16,24,40,.06)}
#appview .bub small{display:block;font-size:10px;opacity:.65;margin-top:2px}
#appview .composer{position:sticky;bottom:0;display:flex;gap:6px;padding:8px 0 2px;background:#f2f3f7}
#appview .composer input{margin:0!important;border-radius:20px!important;background:#fff!important}
#appview .composer button{flex:none;width:40px;height:40px;border-radius:50%;border:none;background:var(--ac,#18a34a);display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto}
#appview .composer svg{width:18px;height:18px;fill:#fff}
#appview .dial{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:8px 18px}
#appview .dial button{aspect-ratio:1;border-radius:50%;border:none;background:#fff;font:400 24px Inter,sans-serif;color:#11131a;box-shadow:0 1px 2px rgba(16,24,40,.08);cursor:pointer;pointer-events:auto}
#appview .dial .go{background:#22c55e;color:#fff} #appview .typed{text-align:center;font:600 24px Inter,sans-serif;color:#11131a;min-height:32px;letter-spacing:1px;padding-top:6px}
#appview .callbar{background:#11131a;color:#fff;border-radius:18px;padding:14px;text-align:center} #appview .callbar b{color:#fff;font-size:17px} #appview .callbar .btn{background:#ef4444!important;margin-top:10px}
`;
const PALETTE = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const tint = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
const ICON = { msg: 'M4 5h16v11H9l-5 4z', call: 'M6 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 4 5a2 2 0 0 1 2-2z', del: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13' };
const svg = (d: string) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;

class PhoneNetApp {
  me: { number: string; publicId: string } | null = null; contacts: Contact[] = []; threads: Thread[] = []; open: { id: string; name: string; msgs: Msg[] } | null = null;
  typed = ''; private call: { callId: string; peer: number; name: string; state: 'calling' | 'live' } | null = null; unread = 0;
  constructor(private ctx: GameCtx) {}
  get hud() { return this.ctx.hud; }
  init() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    // Messages replaces the old NPC-only Texts app; Phone dials; Contacts is rendered here first, society appends NPCs
    registerApp('Phone', '', '', () => this.phoneHtml()); registerApp('Messages', '', '', () => this.messagesHtml());
    this.hud.appRenderers['Contacts'] = () => this.contactsHtml();
    this.hud.appBack['Messages'] = () => { if (this.open) { this.open = null; void this.refreshThreads(); return true; } return false; };
    this.hud.appBack['Phone'] = () => { if (this.typed) { this.typed = ''; return true; } return false; };
    (window as any).__phonenet = this;
  }
  start() {
    const w = net.welcome as any; if (w?.phone) { this.me = { number: w.phone.number, publicId: w.phone.publicId }; this.setUnread(w.phone.unread ?? 0); }
    net.on('welcome', (w2: any) => { if (w2.phone) { this.me = { number: w2.phone.number, publicId: w2.phone.publicId }; this.setUnread(w2.phone.unread ?? 0); } });
    net.on('msg', (m: any) => this.incoming(m));
    net.on('call', (m: any) => this.onCall(m));
    // the app view reads clicks on cells and buttons through data attributes; wire them after each render
    new MutationObserver(() => this.wire()).observe(document.getElementById('av-l') ?? document.body, { childList: true, subtree: false });
  }
  private setUnread(n: number) { this.unread = n; this.hud.badges['Messages'] = n; if (!this.hud.appOpen) this.hud.renderApps(); }
  private async refreshContacts() { if (!net.active) return; const r = await net.act('contacts.list'); if (r.ok) { this.contacts = (r as any).list; this.redraw('Contacts'); this.redraw('Phone'); } }
  private async refreshThreads() { if (!net.active) return; const r = await net.act('msg.threads'); if (r.ok) { this.threads = (r as any).list; this.setUnread(this.threads.reduce((s, t) => s + t.unread, 0)); this.redraw('Messages'); } }
  private redraw(app: string) { if (this.hud.appOpen === app) this.hud.refreshApp(); }

  // ---------------------------------------------------------------- Contacts
  private contactsHtml() {
    if (!net.active) return `<div class="row"><b>Your phone is not on the network</b>Play online to get a number and text other players.</div>`;
    void this.refreshContacts();
    const me = this.me; const name = this.ctx.profile?.name ?? 'You';
    const card = `<div class="me-card"><b>${esc(name)}</b><div class="num">${me ? me.number.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3') : '...'}</div><span>Player ID ${me?.publicId ?? '...'} · share either one</span></div>`;
    const add = `<div class="row"><b>Add someone</b>Their number, player ID, or exact name.<input id="pn-add" placeholder="0809 123 4567 or HL-ABC123" autocomplete="off"><input id="pn-name" placeholder="Save as (optional)" autocomplete="off"><button class="btn" data-pn="add">Save contact</button></div>`;
    const list = this.contacts.map((c) => `<div class="cell"><div class="av" style="background:${tint(c.id)}">${initials(c.name)}${c.online ? '<i></i>' : ''}</div><div class="tx"><b>${esc(c.name)}</b><span>${c.number.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3')}${c.player && c.player !== c.name ? ` · ${esc(c.player)}` : ''}</span></div>
      <div class="act"><button data-pn="text:${c.id}:${esc(c.name)}" aria-label="Text">${svg(ICON.msg)}</button><button data-pn="call:${c.id}:${esc(c.name)}" aria-label="Call">${svg(ICON.call)}</button><button data-pn="del:${c.id}" aria-label="Remove">${svg(ICON.del)}</button></div></div>`).join('');
    return card + add + (list || `<div class="row"><b>No contacts yet</b>Meet people on the street and swap numbers.</div>`);
  }
  // ---------------------------------------------------------------- Messages
  private messagesHtml() {
    if (this.open) {
      const o = this.open; const meId = net.account?.id;
      const bubbles = o.msgs.map((m) => `<div class="bub ${m.from_id === meId ? 'me' : 'them'}">${esc(m.body)}<small>${when(m.at)}</small></div>`).join('');
      setTimeout(() => { const l = document.getElementById('av-l'); if (l) l.scrollTop = l.scrollHeight; (document.getElementById('pn-msg') as HTMLInputElement | null)?.focus(); }, 30);
      return `<div class="row" style="padding:9px 12px"><b style="margin:0">${esc(o.name)}</b></div><div class="chat">${bubbles || '<div class="row">Say hello.</div>'}</div>
        <div class="composer"><input id="pn-msg" placeholder="Message" autocomplete="off" maxlength="500"><button data-pn="send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg></button></div>`;
    }
    void this.refreshThreads();
    const npc = (this.ctx as any).phoneTexts?.() as [string, string][] | undefined;
    const rows = this.threads.map((t) => { const nm = t.saved ?? t.name ?? t.number; return `<div class="cell" data-pn="open:${t.other}:${esc(nm)}"><div class="av" style="background:${tint(t.other)}">${initials(nm)}</div><div class="tx"><b>${esc(nm)}</b><span>${t.mine ? 'You: ' : ''}${esc(t.body)}</span></div><div class="rt">${when(t.at)}${t.unread ? `<br><u>${t.unread}</u>` : ''}</div></div>`; }).join('');
    const npcRows = (this.hud.ctx?.texts ?? npc ?? []).map(([w, t]) => `<div class="cell"><div class="av" style="background:#6b7280">${initials(w)}</div><div class="tx"><b>${esc(w)}</b><span>${esc(t)}</span></div></div>`).join('');
    return (net.active ? rows || `<div class="row"><b>No chats yet</b>Text someone from Contacts.</div>` : '') + npcRows;
  }
  private async openThread(id: string, name: string) {
    this.open = { id, name, msgs: [] }; this.redraw('Messages');
    const r = await net.act('msg.thread', { with: id }); if (r.ok && this.open?.id === id) { this.open.msgs = (r as any).list; this.redraw('Messages'); void this.refreshThreads(); }
  }
  private async sendMsg() {
    const o = this.open; const inp = document.getElementById('pn-msg') as HTMLInputElement | null; const body = inp?.value.trim(); if (!o || !body) return;
    const r = await net.act('msg.send', { to: o.id, body }); if (!r.ok) { this.hud.toast('Messages', r.err ?? 'Not sent.', 'var(--red)', 'msg', 3); return; }
    const m = (r as any).msg; o.msgs.push({ id: m.id, from_id: net.account?.id ?? '', body: m.body, at: m.at }); this.redraw('Messages');
  }
  private incoming(m: { id: number; from: string; fromName: string; body: string; at: number }) {
    if (this.open?.id === m.from) { this.open.msgs.push({ id: m.id, from_id: m.from, body: m.body, at: m.at }); this.redraw('Messages'); void net.act('msg.thread', { with: m.from }); return; }
    const saved = this.contacts.find((c) => c.id === m.from)?.name ?? m.fromName;
    this.hud.toast(saved, m.body.length > 90 ? m.body.slice(0, 88) + '…' : m.body, 'linear-gradient(160deg,#6fe28a,#18a34a)', 'msg', 5);
    this.setUnread(this.unread + 1); void this.refreshThreads();
  }
  // ---------------------------------------------------------------- Phone and calls
  private phoneHtml() {
    if (this.call) return `<div class="callbar"><b>${esc(this.call.name)}</b><div style="opacity:.7;margin-top:4px">${this.call.state === 'calling' ? 'Calling…' : 'On the line'}</div><button class="btn" data-pn="hang">End call</button></div>`;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
    const recent = this.contacts.slice(0, 6).map((c) => `<div class="cell" data-pn="call:${c.id}:${esc(c.name)}"><div class="av" style="background:${tint(c.id)}">${initials(c.name)}${c.online ? '<i></i>' : ''}</div><div class="tx"><b>${esc(c.name)}</b><span>${c.online ? 'Online' : 'Offline'}</span></div></div>`).join('');
    if (net.active && !this.contacts.length) void this.refreshContacts();
    return `<div class="typed">${this.typed.replace(/^(\d{4})(\d{3})(\d+)$/, '$1 $2 $3') || '&nbsp;'}</div><div class="dial">${keys.map((k) => `<button data-pn="key:${k}">${k}</button>`).join('')}<span></span><button class="go" data-pn="dial" aria-label="Call">${svg(ICON.call).replace('<svg', '<svg style="width:26px;height:26px;stroke:#fff;fill:none;stroke-width:2"')}</button><span></span></div>${recent}`;
  }
  private async startCall(id: string, name: string) {
    if (!net.active) { this.hud.toast('Phone', 'No network. Play online to call people.', 'var(--red)', 'msg', 3); return; }
    if (this.call) return;
    const r = await net.act('call.start', { to: id }); if (!r.ok) { this.hud.toast('Phone', r.err ?? 'The call did not go through.', 'var(--red)', 'msg', 3.5); return; }
    this.call = { callId: (r as any).callId, peer: (r as any).peer, name, state: 'calling' }; this.hud.openAppByName('Phone'); voice.ring(true);
  }
  private onCall(m: { kind: string; callId: string; from: string; fromAccount: string; peer: number }) {
    if (m.kind === 'ring') {
      const nm = this.contacts.find((c) => c.id === m.fromAccount)?.name ?? m.from;
      this.hud.call(nm, 'Incoming call', () => { void net.act('call.answer', { callId: m.callId, accept: true }); this.call = { callId: m.callId, peer: m.peer, name: nm, state: 'live' }; voice.startCall(m.peer); this.hud.openAppByName('Phone'); },
        () => void net.act('call.answer', { callId: m.callId, accept: false }), 20);
      return;
    }
    if (!this.call || this.call.callId !== m.callId) return;
    if (m.kind === 'accepted') { this.call.state = 'live'; voice.ring(false); voice.startCall(m.peer); }
    if (m.kind === 'declined' || m.kind === 'ended') { voice.ring(false); voice.endCall(); this.hud.toast('Phone', m.kind === 'declined' ? `${this.call.name} declined.` : 'Call ended.', 'var(--pur)', 'msg', 2.5); this.call = null; }
    this.redraw('Phone');
  }
  private hang() { const k = this.call; if (!k) return; void net.act('call.end', { callId: k.callId }); voice.ring(false); voice.endCall(); this.call = null; this.redraw('Phone'); }

  // ---------------------------------------------------------------- clicks
  private wire() {
    const L = document.getElementById('av-l'); if (!L) return;
    L.querySelectorAll<HTMLElement>('[data-pn]').forEach((el) => { if ((el as any)._pn) return; (el as any)._pn = 1; el.addEventListener('click', (e) => { e.stopPropagation(); void this.act(el.dataset.pn!); }); });
    const mi = document.getElementById('pn-msg') as HTMLInputElement | null; if (mi && !(mi as any)._pn) { (mi as any)._pn = 1; mi.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void this.sendMsg(); } }); }
  }
  private async act(a: string) {
    const [op, id, ...rest] = a.split(':'); const name = rest.join(':');
    if (op === 'add') { const q = (document.getElementById('pn-add') as HTMLInputElement)?.value; const n = (document.getElementById('pn-name') as HTMLInputElement)?.value; const r = await net.act('contacts.add', { q, name: n || undefined }); this.hud.toast('Contacts', r.ok ? `${(r as any).who.saved} saved.` : (r.err ?? 'Not found.'), r.ok ? 'linear-gradient(160deg,#b9c2cc,#6b7480)' : 'var(--red)', 'msg', 3); if (r.ok) void this.refreshContacts(); return; }
    if (op === 'del') { await net.act('contacts.remove', { id }); void this.refreshContacts(); return; }
    if (op === 'text' || op === 'open') { if (op === 'text') this.hud.openAppByName('Messages'); void this.openThread(id, name); return; }
    if (op === 'call') { void this.startCall(id, name); return; }
    if (op === 'send') { void this.sendMsg(); return; }
    if (op === 'hang') { this.hang(); return; }
    if (op === 'key') { if (this.typed.length < 14) this.typed += id; this.redraw('Phone'); return; }
    if (op === 'dial') { const q = this.typed; if (!q) return; const r = await net.act('phone.lookup', { q }); if (!r.ok) { this.hud.toast('Phone', 'The number you dialled does not exist.', 'var(--red)', 'msg', 3); return; } this.typed = ''; void this.startCall((r as any).who.id, (r as any).who.name); }
  }
}
let P: PhoneNetApp | null = null;
export const phoneNetSystem: GameSystem & { get api(): PhoneNetApp | null } = { id: 'phonenet', get api() { return P; }, init(ctx) { P = new PhoneNetApp(ctx); P.init(); }, start() { P?.start(); } };
