// Society UI: the price ticker, the Market and Street phone apps, floating tags on people who know you, and the F prompt.
import { registerPhoneApp } from '../ui/lifeHud';
import type { GameCtx } from './registry';
import { RT } from './societyRuntime';
import { ACT_NAMES, fullStory, nameOf, ST, type Citizen } from './societyModel';
import type { NemRec } from './nemesis';

const css = `
#soc-tick{display:flex;align-items:center;gap:8px;height:28px;padding:0 12px;border-radius:999px;font-size:12.5px;font-weight:600;color:#dfe4ee;pointer-events:none;white-space:nowrap;max-width:min(46vw,360px);overflow:hidden}
#soc-tick b{font-family:Rajdhani,Inter,sans-serif;font-size:16px;color:#fff;letter-spacing:.2px}
#soc-tick .up{color:#ff9aa4} #soc-tick .dn{color:#9ff0c2} #soc-tick .sep{opacity:.35}
#soc-plates{position:fixed;inset:0;pointer-events:none;z-index:6;font-family:Inter,system-ui,sans-serif}
.soc-plate{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:1px;white-space:nowrap;will-change:transform;text-shadow:0 1px 3px rgba(0,0,0,.9)}
.soc-plate b{font-family:Oswald,Rajdhani,sans-serif;font-weight:600;font-size:14px;letter-spacing:.07em;text-transform:uppercase;padding:2px 9px 1px;border-radius:6px;background:rgba(8,10,16,.55);border:1px solid rgba(255,255,255,.14)}
.soc-plate i{font-style:normal;font-family:Teko,Rajdhani,sans-serif;font-weight:600;font-size:13px;letter-spacing:.14em}
.soc-plate.e b{color:#ffc4ca;border-color:rgba(255,77,94,.6)} .soc-plate.e i{color:#ff7a88}
.soc-plate.a b{color:#c9f7da;border-color:rgba(73,224,138,.55)} .soc-plate.a i{color:#49e08a}
#soc-prompt{position:fixed;left:50%;bottom:22%;transform:translateX(-50%);display:none;z-index:6;pointer-events:none;padding:7px 14px;border-radius:12px;background:rgba(12,14,22,.72);border:1px solid rgba(255,255,255,.12);font:600 14px Inter,system-ui,sans-serif;color:#fff}
#soc-prompt kbd{font-family:Rajdhani,sans-serif;background:rgba(255,255,255,.16);border-radius:5px;padding:0 6px;margin-right:6px}
#appview .row .pl{display:flex;justify-content:space-between;gap:6px;font-weight:500;font-size:12px;padding:1.5px 0;align-items:center}
#appview .row .pl span{color:#c9cfdb} #appview .row .pl em{font-style:normal;font-weight:700;color:#fff}
#appview .row .pl em small{font-weight:700;font-size:10.5px;margin-left:5px}
#appview .row .pl em small.up{color:#ff9aa4} #appview .row .pl em small.dn{color:#9ff0c2} #appview .row .pl em small.fl{color:#8d95a6}
#appview .row svg.sp{width:34px;height:11px;margin-left:6px;vertical-align:middle;fill:none;stroke:#8d95a6;stroke-width:1.4}
#appview .row .tag{display:inline-block;font-size:9.5px;letter-spacing:.1em;font-weight:800;padding:1px 6px;border-radius:5px;margin-left:6px;vertical-align:1px}
#appview .row .tag.e{background:rgba(255,77,94,.2);color:#ff9aa4} #appview .row .tag.a{background:rgba(73,224,138,.18);color:#9ff0c2} #appview .row .tag.b{background:rgba(255,197,61,.18);color:#ffd77a}
#appview .row .meta{font-size:11.5px;color:#9ba3b4;margin:1px 0 3px} #appview .row .hist{font-size:11.5px;color:#c9cfdb;line-height:1.35;margin-top:3px}
#appview .row .hist div{padding-left:9px;text-indent:-9px} #appview .row .hist div:before{content:'\\2022\\00a0';color:#6d7587}
#appview .row .story{font-size:11px;font-style:italic;color:#8d95a6;margin-top:4px;line-height:1.3}
#appview .row .meter{height:5px;border-radius:5px;background:rgba(255,255,255,.1);overflow:hidden;margin:4px 0} #appview .row .meter i{display:block;height:100%;border-radius:5px}
#appview .row.nem.e{border-color:rgba(255,77,94,.35)} #appview .row.nem.a{border-color:rgba(73,224,138,.3)}
#appview .sec{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#7f8799;font-weight:800;padding:4px 4px 0}
`;
const fmt = (n: number) => '₦' + Math.round(n).toLocaleString();
const pct = (v: number) => (Math.abs(v) < 0.004 ? '<small class="fl">level</small>' : v > 0 ? `<small class="up">▲${(v * 100).toFixed(1)}%</small>` : `<small class="dn">▼${(-v * 100).toFixed(1)}%</small>`);
const spark = (h: number[]) => { if (h.length < 2) return ''; const lo = Math.min(...h), hi = Math.max(...h), r = hi - lo || 1; return `<svg class="sp" viewBox="0 0 34 11"><polyline points="${h.map((v, i) => `${((i / (h.length - 1)) * 34).toFixed(1)},${(10 - ((v - lo) / r) * 9).toFixed(1)}`).join(' ')}"/></svg>`; };
const ago = (mins: number) => { const m = Math.max(0, Math.round(mins)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const clock = (min: number) => { const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = Math.floor(min % 60); return `Day ${d} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class SocietyUi {
  private tick!: HTMLElement; private plates!: HTMLElement; private prompt!: HTMLElement; private tickI = 0; private tickT = 0; private promptT = 0; private seen = new Map<number, HTMLElement>(); private v = { x: 0, y: 0, z: 0 };
  constructor(private ctx: GameCtx) {}
  init() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    this.tick = document.createElement('div'); this.tick.id = 'soc-tick'; this.tick.className = 'gl'; document.getElementById('tr')?.appendChild(this.tick);
    this.plates = document.createElement('div'); this.plates.id = 'soc-plates'; document.body.appendChild(this.plates);
    this.prompt = document.createElement('div'); this.prompt.id = 'soc-prompt'; document.body.appendChild(this.prompt);
    registerPhoneApp('Market', 'M4 19V9M10 19V5M16 19v-8M22 19H2M19 5l-3 3', 'linear-gradient(160deg,#49e08a,#16895a)', () => this.marketHtml());
    registerPhoneApp('Street', 'M7 11V7.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v4m0-3.5a1.5 1.5 0 0 1 3 0V12m0-2a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-3a1.5 1.5 0 0 1 3 0', 'linear-gradient(160deg,#ff6b7a,#c2273a)', () => this.streetHtml());
    registerPhoneApp('Contacts', '', '', () => this.contactsHtml(), 'append');
  }

  // ---------------------------------------------------------------- ticker
  frame(dt: number) {
    const soc = RT.soc; if (!soc) return; this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = 4; const rows = soc.E.rows().filter((r) => soc.C.goods.find((g) => 'good.' + r.id === g.id)?.ticker !== false);
      const fuel = rows.find((r) => r.id === 'fuel'); const rest = rows.filter((r) => r.id !== 'fuel'); const r2 = rest[this.tickI++ % Math.max(1, rest.length)];
      const part = (r: typeof fuel) => r ? `${r.id === 'fuel' ? 'Petrol' : r.label} <b>${fmt(r.price)}</b> <span class="${r.change > 0.004 ? 'up' : r.change < -0.004 ? 'dn' : ''}">${r.change > 0.004 ? '▲' : r.change < -0.004 ? '▼' : ''}</span>` : '';
      this.tick.innerHTML = `${part(fuel)}<span class="sep">|</span>${part(r2)}`;
    }
    this.plateFrame(dt); this.promptT -= dt; if (this.promptT <= 0) { this.promptT = 0.15; this.promptFrame(); }
  }
  private promptFrame() {
    const n = RT.nem; const hud = this.ctx.hud; if (!n || hud.phoneUp || hud.landmapOn) { this.prompt.style.display = 'none'; return; }
    const t = n.target(); if (!t) { this.prompt.style.display = 'none'; return; }
    const o = n.options(t); const nm = t.c.first;
    const txt = o === 'rob' ? `Rob ${nm}` : o === 'help' ? `Help ${nm} up` : o === 'tip' ? `Give ${nm} ₦500` : o === 'greet' ? `Greet ${nm}` : '';
    if (!txt) { this.prompt.style.display = 'none'; return; }
    this.prompt.innerHTML = `<kbd>F</kbd>${esc(txt)}`; this.prompt.style.display = 'block';
  }

  // ---------------------------------------------------------------- tags above enemies and allies
  private plateFrame(_dt: number) {
    const n = RT.nem; const sim = this.ctx.sim; const cam = this.ctx.view.camera; if (!n) return;
    const me = sim.local; const use = new Set<number>();
    for (const a of sim.actors) {
      if (a.cid === undefined || !a.alive || (a as any)._gone) continue; const r = n.recs.get(a.cid); if (!r) continue;
      const kind = n.isEnemy(r) ? 'e' : n.isAlly(r) ? 'a' : ''; if (!kind) continue;
      const d = Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z); if (d > 38) continue;
      const vis = this.ctx.view.actors.get(a.id); const pos = vis ? vis.view.root.position : a.pos;
      this.v.x = pos.x; this.v.y = pos.y + 2.1; this.v.z = pos.z;
      const p = new this.ctx.THREE.Vector3(this.v.x, this.v.y, this.v.z).project(cam); if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) continue;
      let el = this.seen.get(a.id);
      if (!el) { el = document.createElement('div'); el.className = 'soc-plate ' + kind; this.plates.appendChild(el); this.seen.set(a.id, el); }
      const html = `<b>${esc(r.c.nick ? `${r.c.first} "${r.c.nick}"` : nameOf(r.c))}</b><i>${esc(RT.soc!.rankName(r.c))}${kind === 'e' ? ' • ENEMY' : ' • FRIEND'}</i>`;
      if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; el.className = 'soc-plate ' + kind; }
      el.style.transform = `translate(${((p.x * 0.5 + 0.5) * innerWidth).toFixed(0)}px,${((-p.y * 0.5 + 0.5) * innerHeight).toFixed(0)}px) translate(-50%,-100%)`; use.add(a.id);
    }
    for (const [id, el] of this.seen) if (!use.has(id)) { el.remove(); this.seen.delete(id); }
  }

  // ---------------------------------------------------------------- phone: Market
  private marketHtml() {
    const soc = RT.soc; if (!soc) return '<div class="row"><b>Market</b>The city is still waking up.</div>';
    const E = soc.E; const rows = E.rows();
    let h = `<div class="sec">Prices today</div><div class="row">${rows.map((r) => `<div class="pl"><span>${r.label}${spark(r.hist)}</span><em>${fmt(r.price)}${pct(r.change)}</em></div>`).join('')}</div>`;
    const now = RT.events?.now() ?? [];
    if (now.length) h += `<div class="sec">Happening now</div>` + now.map((n) => `<div class="row"><b>${esc(n.label)}</b>${esc(n.area)} · ${n.minsLeft > 90 ? Math.round(n.minsLeft / 60) + ' h left' : n.minsLeft + ' min left'}</div>`).join('');
    const sh = [...E.shocks.keys()].map((k) => soc.C.shocks.get(k)?.label).filter(Boolean);
    const m = E.macro;
    h += `<div class="sec">The economy</div><div class="row"><div class="pl"><span>Citizens modelled</span><em>${soc.stats.citizens.toLocaleString()}</em></div><div class="pl"><span>Struggling</span><em>${Math.round(m.poor * 100)}%</em></div><div class="pl"><span>Street crime</span><em>${m.crime < 0.15 ? 'low' : m.crime < 0.35 ? 'moderate' : 'high'}</em></div><div class="pl"><span>Inflation since day 3</span><em>${((E.infl - 1) * 100).toFixed(1)}%</em></div>${sh.length ? `<div class="meta">Shocks: ${esc(sh.join(', '))}</div>` : ''}</div>`;
    const land = E.landRows((x, z) => soc.W.areaName(x, z), 4);
    if (land.length) h += `<div class="sec">Land and rent</div><div class="row">${land.map((l) => `<div class="pl"><span>${esc(l.name)}</span><em>x${l.v.toFixed(2)}</em></div>`).join('')}</div>`;
    h += `<div class="sec">News</div>` + (E.news.slice(0, 7).map((n) => `<div class="row"><div class="meta">${clock(n.t)}</div>${esc(n.text)}</div>`).join('') || '<div class="row">Quiet day.</div>');
    return h;
  }

  // ---------------------------------------------------------------- phone: Street (enemies and allies)
  card(r: NemRec, kind: 'enemy' | 'ally') {
    const soc = RT.soc!, n = RT.nem!; const c: Citizen = r.c;
    const hist = r.mem.slice(-3).reverse().map((m) => `<div>${esc(n.memText(m, c))}</div>`).join('');
    const status = c.st === ST.DEAD ? (r.revive ? 'Dead, for now' : 'Dead') : c.st === ST.JAILED ? 'In custody' : c.st === ST.HOSPITAL ? 'In hospital' : ACT_NAMES[c.act];
    const lvl = kind === 'enemy' ? r.hate : r.love;
    const extra = [r.wins ? `Beat you ${r.wins}x` : '', r.returned ? `Came back ${r.returned}x` : '', r.betrayed ? 'Sold you out' : ''].filter(Boolean).join(' · ');
    return `<div class="row nem ${kind === 'enemy' ? 'e' : 'a'}"><b>${esc(c.nick ? `${c.first} "${c.nick}" ${c.last}` : nameOf(c))}<span class="tag ${kind === 'enemy' ? 'e' : 'a'}">${kind === 'enemy' ? 'ENEMY' : 'FRIEND'}</span></b>
      <div class="meta">${esc(soc.rankName(c))}${c.fac ? ' · ' + esc(soc.facLabel(c)) : ''} · ${esc(soc.C.occ[c.occ].label)}</div>
      <div class="meter"><i style="width:${Math.round(lvl * 100)}%;background:${kind === 'enemy' ? '#ff4d5e' : '#49e08a'}"></i></div>
      <div class="hist">${hist}</div>${extra ? `<div class="meta">${esc(extra)}</div>` : ''}
      <div class="meta">${status}${r.lastMin ? ' · last seen ' + esc(r.lastPlace || c.area) + ', ' + ago(soc.minute - r.lastMin) : ''}</div>
      <div class="story">${esc(fullStory(soc.C, c).slice(0, 170))}</div></div>`;
  }
  private streetHtml() {
    const n = RT.nem, soc = RT.soc; if (!n || !soc) return '<div class="row"><b>Street</b>Nobody knows you yet. That will change.</div>';
    const list = n.list(); const en = list.filter((x) => x.kind === 'enemy'), al = list.filter((x) => x.kind === 'ally');
    let h = `<div class="row"><b>Who knows you</b>${en.length} enemies · ${al.length} friends · ${n.recs.size} people remember your face.</div>`;
    if (en.length) h += `<div class="sec">Enemies</div>` + en.map((x) => this.card(x.r, 'enemy')).join('');
    if (al.length) h += `<div class="sec">Friends</div>` + al.map((x) => this.card(x.r, 'ally')).join('');
    if (!list.length) h += `<div class="row">Hit somebody, help somebody, take somebody's okada. Lagos will remember.</div>`;
    return h;
  }
  private contactsHtml() {
    const n = RT.nem; if (!n) return ''; const l = n.list(); if (!l.length) return '';
    return `<div class="row"><b>Street contacts</b>${l.filter((x) => x.kind === 'enemy').length} enemies and ${l.filter((x) => x.kind === 'ally').length} friends know you. Open Street for their names.</div>`;
  }
}
