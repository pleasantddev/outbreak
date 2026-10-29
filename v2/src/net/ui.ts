// Multiplayer UI: sign-in card, account panel, connection badge, chat. Plain DOM, one injected stylesheet.
import { ApiError, type NetClient } from './client';

const CSS = `
.nt-veil{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;background:radial-gradient(120% 90% at 50% 20%,rgba(30,22,60,.78),rgba(5,6,12,.93));backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font-family:Inter,system-ui,sans-serif;color:#f3f5f8;animation:ntIn .35s ease both}
@keyframes ntIn{from{opacity:0}to{opacity:1}}
.nt-card{width:min(420px,100%);border-radius:24px;padding:26px 24px 20px;background:linear-gradient(160deg,rgba(32,34,50,.96),rgba(14,15,24,.96));border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.07)}
.nt-card h1{margin:0;font:700 34px/1 Oswald,Teko,sans-serif;letter-spacing:.06em;text-transform:uppercase}
.nt-card h1 b{color:#2de0c8;font-weight:700}
.nt-sub{margin:8px 0 18px;color:#9ba3b4;font-size:13.5px;line-height:1.45}
.nt-tabs{display:flex;gap:4px;padding:4px;border-radius:14px;background:rgba(255,255,255,.06);margin-bottom:16px}
.nt-tabs button{flex:1;border:0;border-radius:10px;padding:9px 6px;background:transparent;color:#9ba3b4;font:600 13px Inter,sans-serif;cursor:pointer;transition:.15s}
.nt-tabs button.on{background:linear-gradient(160deg,#8b5cf6,#6d3ef0);color:#fff;box-shadow:0 4px 14px rgba(109,62,240,.4)}
.nt-card label{display:block;margin:0 0 5px;color:#b9c0cf;font:600 11.5px Inter,sans-serif;letter-spacing:.08em;text-transform:uppercase}
.nt-card input{width:100%;box-sizing:border-box;margin:0 0 13px;padding:13px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff;font:500 16px Inter,sans-serif;outline:none;transition:border .15s,box-shadow .15s}
.nt-card input:focus{border-color:#2de0c8;box-shadow:0 0 0 3px rgba(45,224,200,.18)}
.nt-go{width:100%;border:0;border-radius:14px;padding:14px;margin-top:2px;background:linear-gradient(160deg,#2de0c8,#14a994);color:#04120f;font:700 15px Oswald,Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:transform .12s,filter .12s}
.nt-go:hover{filter:brightness(1.08)}.nt-go:active{transform:scale(.985)}.nt-go:disabled{opacity:.55;cursor:wait}
.nt-err{min-height:18px;margin:0 0 10px;color:#ff7a7a;font-size:13px;line-height:1.35}
.nt-foot{display:flex;justify-content:space-between;align-items:center;margin-top:16px;color:#7d8597;font-size:12px;gap:10px}
.nt-foot a{color:#9ba3b4;text-decoration:underline;cursor:pointer}
.nt-srv{display:inline-flex;align-items:center;gap:6px}.nt-srv i{width:8px;height:8px;border-radius:50%;background:#7d8597}.nt-srv.ok i{background:#3ddc84;box-shadow:0 0 8px #3ddc84}.nt-srv.bad i{background:#ff5c5c}
.nt-note{margin:0 0 14px;padding:10px 12px;border-radius:12px;background:rgba(45,224,200,.08);border:1px solid rgba(45,224,200,.2);color:#bfeee8;font-size:12.5px;line-height:1.4}
/* badge */
#nt-badge{position:fixed;right:max(18px,env(safe-area-inset-right));top:calc(max(14px,env(safe-area-inset-top)) + 96px);z-index:6;display:flex;align-items:center;gap:8px;padding:6px 11px;border-radius:999px;background:rgba(14,15,24,.62);border:1px solid rgba(255,255,255,.09);backdrop-filter:blur(8px);color:#cfd5e1;font:600 12px Inter,sans-serif;cursor:pointer;user-select:none}
#nt-badge i{width:8px;height:8px;border-radius:50%;background:#7d8597}#nt-badge.ok i{background:#3ddc84;box-shadow:0 0 8px #3ddc84}#nt-badge.warn i{background:#f6c453}#nt-badge.bad i{background:#ff5c5c}
#nt-badge small{color:#8b93a5;font-weight:500}
#nt-btn{position:fixed;right:max(18px,env(safe-area-inset-right));top:calc(max(8px,env(safe-area-inset-top)) + 106px);z-index:6;padding:8px 14px;border-radius:999px;background:rgba(14,15,24,.7);border:1px solid rgba(255,255,255,.12);color:#fff;font:700 12px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase}
/* chat */
#nt-chat{position:fixed;left:max(18px,env(safe-area-inset-left));bottom:calc(max(16px,env(safe-area-inset-bottom)) + 232px);width:min(380px,56vw);z-index:6;pointer-events:none;font:500 13.5px/1.35 Inter,sans-serif;color:#eef1f6;text-shadow:0 1px 3px rgba(0,0,0,.9)}
#nt-log{display:flex;flex-direction:column;justify-content:flex-end;gap:3px;max-height:190px;overflow:hidden}
#nt-chat.open #nt-log{overflow-y:auto;pointer-events:auto;max-height:260px;padding-right:4px}
.nt-m{padding:3px 9px;border-radius:9px;background:rgba(8,9,15,.46);transition:opacity 1.2s ease;word-break:break-word}
.nt-m.old{opacity:0}#nt-chat.open .nt-m.old{opacity:1}
.nt-m b{font-weight:700;margin-right:5px}.nt-m.global b{color:#f6c453}.nt-m.near b{color:#2de0c8}.nt-m.whisper b{color:#d6a6ff}.nt-m.whisper{font-style:italic}.nt-m.system{color:#9ba3b4}.nt-m.system b{color:#9ba3b4}
.nt-m .ch{font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.65;margin-right:5px}
#nt-in{display:none;width:100%;box-sizing:border-box;margin-top:6px;padding:10px 12px;border-radius:12px;border:1px solid rgba(45,224,200,.5);background:rgba(8,9,15,.85);color:#fff;font:500 14px Inter,sans-serif;outline:none;pointer-events:auto}
#nt-chat.open #nt-in{display:block}
#nt-hint{display:none;margin-top:4px;color:#8b93a5;font-size:11px;pointer-events:none}#nt-chat.open #nt-hint{display:block}
@media (max-width:760px),(max-height:520px){#nt-chat{bottom:calc(max(10px,env(safe-area-inset-bottom)) + 150px);width:min(300px,60vw);font-size:12px}#nt-badge{top:calc(max(8px,env(safe-area-inset-top)) + 70px)}}
.nt-plate{position:fixed;left:0;top:0;z-index:4;pointer-events:none;transform:translate(-50%,-100%);padding:2px 9px;border-radius:999px;background:rgba(8,9,15,.6);color:#fff;font:700 12px Inter,sans-serif;white-space:nowrap;text-shadow:0 1px 2px #000;will-change:transform;display:none}
.nt-plate small{color:#2de0c8;font-weight:700;margin-left:6px}.nt-plate.mod{background:rgba(109,62,240,.7)}.nt-plate.talk{box-shadow:0 0 0 2px rgba(45,224,200,.7)}
`;
let styled = false;
function style() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
const el = <K extends keyof HTMLElementTagNameMap>(t: K, cls = '', html = '') => { const e = document.createElement(t); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
// key-up is left alone for the chat box so a key released while typing still reaches the game's input and is not stuck down
const stopKeys = (e: HTMLElement, up = true) => { for (const ev of up ? ['keydown', 'keyup', 'keypress'] : ['keydown', 'keypress']) e.addEventListener(ev, (x) => x.stopPropagation()); };

/** Sign in or create an account. Resolves when there is a valid session. */
export function signInCard(net: NetClient, opts: { upgrade?: boolean; dismissible?: boolean } = {}): Promise<'ok' | 'cancel'> {
  style();
  return new Promise((resolve) => {
    const veil = el('div', 'nt-veil'); veil.id = 'nt-signin';
    const guestOk = !opts.upgrade;
    veil.innerHTML = `<div class="nt-card" role="dialog" aria-label="Sign in">
      <h1>Hustle<b>Life</b> Online</h1>
      <p class="nt-sub">${opts.upgrade ? 'You are a guest. Add an email or phone number and a password to keep your hustler, your money and your land.' : 'One hustler per account. Your cash, your land and your cars live on the server, so everybody in Lagos sees the same Lagos.'}</p>
      <div class="nt-tabs">${opts.upgrade ? '<button data-t="up" class="on">Save my account</button>' : `<button data-t="in" class="on">Log in</button><button data-t="up">Sign up</button>${guestOk ? '<button data-t="guest">Guest</button>' : ''}`}</div>
      <form id="nt-form" autocomplete="on">
        <div id="nt-fields"><label for="nt-id">Email or phone</label><input id="nt-id" name="username" autocomplete="username" inputmode="email" placeholder="you@example.com or 0803 123 4567" maxlength="120">
        <label for="nt-pw">Password</label><input id="nt-pw" name="password" type="password" autocomplete="current-password" placeholder="At least 8 characters" maxlength="128"></div>
        <div id="nt-guestnote" class="nt-note" style="display:none">Guests can play straight away. Add an email or phone later from the account panel (tap the green dot) and nothing is lost.</div>
        <div class="nt-err" id="nt-err" role="alert"></div>
        <button class="nt-go" id="nt-go" type="submit">Log in</button>
      </form>
      <div class="nt-foot"><span class="nt-srv" id="nt-srv"><i></i><span>${esc(net.server?.label ?? '')}</span></span>${opts.dismissible || opts.upgrade ? '<a id="nt-x">Not now</a>' : '<a id="nt-off">Play offline instead</a>'}</div></div>`;
    document.body.appendChild(veil); stopKeys(veil);
    for (const ev of ['touchstart', 'touchmove', 'touchend']) veil.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    const $ = <T extends HTMLElement>(id: string) => veil.querySelector('#' + id) as T;
    let tab: 'in' | 'up' | 'guest' = opts.upgrade ? 'up' : 'in';
    const idEl = $<HTMLInputElement>('nt-id'), pwEl = $<HTMLInputElement>('nt-pw'), err = $('nt-err'), go = $<HTMLButtonElement>('nt-go');
    const paint = () => {
      veil.querySelectorAll('.nt-tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === (tab === 'up' && opts.upgrade ? 'up' : tab)));
      $('nt-fields').style.display = tab === 'guest' ? 'none' : ''; $('nt-guestnote').style.display = tab === 'guest' ? '' : 'none';
      go.textContent = tab === 'in' ? 'Log in' : tab === 'up' ? (opts.upgrade ? 'Save my account' : 'Create account') : 'Play as guest';
      pwEl.autocomplete = tab === 'in' ? 'current-password' : 'new-password'; err.textContent = '';
    };
    veil.querySelectorAll('.nt-tabs button').forEach((b) => b.addEventListener('click', () => { tab = (b as HTMLElement).dataset.t as typeof tab; paint(); (tab === 'guest' ? go : idEl).focus(); }));
    const done = (r: 'ok' | 'cancel') => { veil.style.opacity = '0'; veil.style.transition = 'opacity .25s'; setTimeout(() => veil.remove(), 260); resolve(r); };
    $('nt-form').addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = ''; go.disabled = true; const label = go.textContent; go.textContent = 'One second…';
      try {
        if (tab === 'guest') await net.guest();
        else if (opts.upgrade) await net.upgrade(idEl.value, pwEl.value);
        else if (tab === 'up') await net.signup(idEl.value, pwEl.value);
        else await net.login(idEl.value, pwEl.value);
        done('ok');
      } catch (ex) {
        err.textContent = ex instanceof ApiError ? (ex.data.code === 'banned' ? `This account is banned: ${ex.message}` : ex.message) : 'Something went wrong. Try again.';
        go.disabled = false; go.textContent = label;
      }
    });
    $('nt-x')?.addEventListener('click', () => done('cancel'));
    $('nt-off')?.addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('server', 'off'); location.href = u.toString(); });
    // is the server there?
    const srv = $('nt-srv');
    net.health().then((h: any) => { srv.classList.add('ok'); srv.querySelector('span')!.textContent = `${net.server!.label} · ${h.online} online`; if (!h.guests) veil.querySelector('[data-t="guest"]')?.remove(); })
      .catch(() => { srv.classList.add('bad'); srv.querySelector('span')!.textContent = `${net.server!.label} · cannot reach`; err.textContent = 'Cannot reach the server right now. You can retry or play offline.'; });
    paint(); setTimeout(() => idEl.focus(), 60);
  });
}

/** Full screen notice for a kick or a ban, with a way back. */
export function notice(title: string, body: string, actions: { label: string; fn: () => void }[]) {
  style();
  const veil = el('div', 'nt-veil'); veil.style.zIndex = '70';
  veil.innerHTML = `<div class="nt-card"><h1>${esc(title)}</h1><p class="nt-sub" style="margin-bottom:18px">${esc(body)}</p>${actions.map((a, i) => `<button class="nt-go" data-i="${i}" style="margin-top:8px">${esc(a.label)}</button>`).join('')}</div>`;
  veil.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => actions[+(b as HTMLElement).dataset.i!].fn()));
  document.body.appendChild(veil); stopKeys(veil); return veil;
}

export interface ChatSend { (ch: 'near' | 'global', text: string): void }
export class NetUi {
  badge: HTMLElement; chat: HTMLElement; btn: HTMLElement; log: HTMLElement; input: HTMLInputElement;
  open = false; private lines: { el: HTMLElement; at: number }[] = []; private hist: string[] = []; private hi = -1;
  onSend: (raw: string) => void = () => {}; onAccount: () => void = () => {}; onOpenChange: (open: boolean) => void = () => {};
  constructor() {
    style();
    this.badge = el('div'); this.badge.id = 'nt-badge'; this.badge.innerHTML = '<i></i><span>Offline</span><small></small>'; this.badge.title = 'Account'; this.badge.onclick = () => this.onAccount();
    this.chat = el('div'); this.chat.id = 'nt-chat';
    this.chat.innerHTML = '<div id="nt-log"></div><input id="nt-in" maxlength="200" placeholder="Say something. /g global · /w name message · /pay name amount" autocomplete="off" spellcheck="false"><div id="nt-hint">Enter to send · Esc to close · Tab switches global and near</div>';
    this.btn = el('div'); this.btn.id = 'nt-btn'; this.btn.textContent = 'Chat'; this.btn.onclick = () => this.openInput(''); this.btn.style.display = 'none';
    document.body.append(this.badge, this.chat, this.btn);
    this.log = this.chat.querySelector('#nt-log')!; this.input = this.chat.querySelector('#nt-in')!;
    stopKeys(this.input, false);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const t = this.input.value.trim(); if (t) { this.hist.unshift(t); this.hist.length = Math.min(this.hist.length, 30); this.onSend(t); } this.input.value = ''; this.close(); e.preventDefault(); }
      else if (e.key === 'Escape') { this.input.value = ''; this.close(); }
      else if (e.key === 'ArrowUp') { this.hi = Math.min(this.hist.length - 1, this.hi + 1); this.input.value = this.hist[this.hi] ?? ''; e.preventDefault(); }
      else if (e.key === 'ArrowDown') { this.hi = Math.max(-1, this.hi - 1); this.input.value = this.hist[this.hi] ?? ''; e.preventDefault(); }
      else if (e.key === 'Tab') { const v = this.input.value; this.input.value = v.startsWith('/g ') ? v.slice(3) : '/g ' + v; e.preventDefault(); }
    });
    window.addEventListener('keydown', (e) => {
      if (this.open || e.repeat) return; const t = e.target as HTMLElement | null; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.code === 'Enter' && !e.ctrlKey && !e.metaKey && this.canOpen()) { this.openInput(''); e.preventDefault(); }
      else if (e.code === 'Slash' && this.canOpen()) { this.openInput('/'); e.preventDefault(); }
    });
    setInterval(() => this.fade(), 1000);
  }
  /** chat is available once playing: not over a sign-in card, the lobby or the character creator */
  canOpen = () => !this.enabled ? false : !document.querySelector('.nt-veil');
  enabled = false;
  show(on: boolean) { this.enabled = on; this.badge.style.display = on ? 'flex' : 'none'; this.chat.style.display = on ? '' : 'none'; this.btn.style.display = on && matchMedia('(pointer: coarse)').matches ? 'block' : 'none'; }
  openInput(prefill = '') {
    this.open = true; this.chat.classList.add('open'); this.hi = -1; this.input.value = prefill; this.onOpenChange(true);
    if (document.pointerLockElement) document.exitPointerLock();
    setTimeout(() => { this.input.focus(); this.input.setSelectionRange(prefill.length, prefill.length); }, 0);
    for (const l of this.lines) l.el.classList.remove('old'); this.log.scrollTop = this.log.scrollHeight;
  }
  close() { this.open = false; this.chat.classList.remove('open'); this.input.blur(); this.onOpenChange(false); }
  add(ch: 'near' | 'global' | 'whisper' | 'system', from: string, text: string) {
    const m = el('div', `nt-m ${ch}`); m.innerHTML = `${ch === 'global' ? '<span class="ch">G</span>' : ''}${from ? `<b>${esc(from)}</b>` : ''}${esc(text)}`;
    this.log.appendChild(m); this.lines.push({ el: m, at: performance.now() });
    while (this.lines.length > 60) this.lines.shift()!.el.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
  private fade() { const t = performance.now(); for (const l of this.lines) if (t - l.at > 12000 && !this.open) l.el.classList.add('old'); }
  setBadge(kind: 'ok' | 'warn' | 'bad', text: string, sub = '') { this.badge.className = kind; (this.badge.children[1] as HTMLElement).textContent = text; (this.badge.children[2] as HTMLElement).textContent = sub; }
}

/** Account panel: who you are, upgrade a guest, sign out. */
export function accountPanel(net: NetClient): Promise<void> {
  style();
  return new Promise((resolve) => {
    const a = net.account; const veil = el('div', 'nt-veil'); veil.style.zIndex = '65';
    veil.innerHTML = `<div class="nt-card"><h1>Account</h1><p class="nt-sub">${esc(net.name || 'Hustler')} · ${a?.guest ? 'Guest account' : esc(a?.email ?? a?.phone ?? '')}<br>${net.server ? esc(net.server.label) : ''} · ${Math.round(net.rtt)} ms · ${net.online} online</p>
      ${a?.guest ? '<button class="nt-go" id="ac-up">Save my account</button>' : ''}<button class="nt-go" id="ac-out" style="margin-top:10px;background:linear-gradient(160deg,#3a3f52,#222536);color:#fff">Sign out</button><button class="nt-go" id="ac-x" style="margin-top:10px;background:transparent;color:#9ba3b4;border:1px solid rgba(255,255,255,.14)">Back to Lagos</button></div>`;
    document.body.appendChild(veil); stopKeys(veil);
    if (document.pointerLockElement) document.exitPointerLock();
    const close = () => { veil.remove(); resolve(); };
    veil.querySelector('#ac-x')!.addEventListener('click', close);
    veil.querySelector('#ac-up')?.addEventListener('click', async () => { veil.style.display = 'none'; await signInCard(net, { upgrade: true }); close(); });
    veil.querySelector('#ac-out')!.addEventListener('click', async () => { await net.logout(); location.reload(); });
  });
}
