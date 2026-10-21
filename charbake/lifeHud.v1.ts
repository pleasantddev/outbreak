// HustleLife HUD: San Andreas small. Clock, cash, health, armour and wahala stars top right, a round radar
// bottom left, weapon and ammo, subtitles, prompts, and the phone in the hand, GTA V style.
import type { SimEvent } from '../sim/types';
import type { LifeSim } from '../sim/life';
import type { RoadNet } from '../world/roadnet';
import type { Plot } from '../world/plots';

const css = `
#hlhud{position:fixed;inset:0;pointer-events:none;font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;color:#fff;z-index:5;user-select:none}
.o{text-shadow:-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,2px 2px 0 #000,0 2px 0 #000,2px 0 0 #000,-2px 0 0 #000,0 -2px 0 #000}
#tr{position:absolute;right:max(24px,env(safe-area-inset-right));top:max(16px,env(safe-area-inset-top));display:flex;flex-direction:column;align-items:flex-end;gap:2px}
#clock{font-family:Anton,Impact,sans-serif;font-size:38px;line-height:1;letter-spacing:1px}
#sub2{font-size:15px;font-weight:700;opacity:.92}
#money{font-family:Anton,Impact,sans-serif;font-size:32px;line-height:1.05;color:#5fd36e;letter-spacing:1px}
.bar{width:150px;height:8px;background:rgba(0,0,0,.55);border:2px solid #000;margin-top:3px}
.bar>i{display:block;height:100%;transition:width .2s}
#stars{display:flex;gap:3px;margin-top:3px;font-family:Anton,Impact,sans-serif;font-size:22px}
#stars b{color:rgba(255,255,255,.16)} #stars b.on{color:#ffcf3a} #stars.flash b.on{animation:fl .5s steps(2) infinite}
@keyframes fl{50%{color:#fff}}
#wpn{position:absolute;right:max(24px,env(safe-area-inset-right));top:178px;text-align:right;font-family:Anton,Impact,sans-serif;font-size:22px;letter-spacing:1px}
#wpn small{display:block;font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700;opacity:.85}
#radar{position:absolute;left:max(22px,env(safe-area-inset-left));bottom:max(20px,env(safe-area-inset-bottom));width:min(180px,26vw);height:min(180px,26vw);border-radius:50%;border:4px solid #000;box-shadow:0 0 0 2px rgba(255,255,255,.22)}
#area{position:absolute;left:max(22px,env(safe-area-inset-left));bottom:calc(max(20px,env(safe-area-inset-bottom)) + min(180px,26vw) + 12px);font-family:Anton,Impact,sans-serif;font-size:20px;letter-spacing:1px;opacity:.95}
#subs{position:absolute;left:50%;transform:translateX(-50%);bottom:15%;width:min(760px,86vw);text-align:center;font-size:25px;font-weight:700;line-height:1.2}
#subs .who{color:#ffcf3a}
#help{position:absolute;left:max(22px,env(safe-area-inset-left));top:max(16px,env(safe-area-inset-top));max-width:340px;background:rgba(0,0,0,.72);padding:11px 15px;font-size:18px;font-weight:600;line-height:1.25;display:none}
#help kbd{font-family:Anton,Impact,sans-serif;font-size:16px;background:#fff;color:#000;padding:0 6px;margin:0 2px}
#title{position:absolute;left:0;right:0;bottom:26%;text-align:center;font-family:Anton,Impact,sans-serif;font-size:54px;letter-spacing:2px;color:#f2c14e;opacity:0;transition:opacity .6s}
#title small{display:block;font-family:'Barlow Condensed',sans-serif;font-size:23px;font-weight:700;color:#fff;letter-spacing:0}
#title.danger{color:#e2463c}
#flash{position:absolute;right:max(24px,env(safe-area-inset-right));top:148px;font-family:Anton,Impact,sans-serif;font-size:26px;opacity:0;transition:opacity .4s}
#prompt{position:absolute;left:50%;top:62%;transform:translateX(-50%);font-size:19px;font-weight:700;background:rgba(0,0,0,.55);padding:5px 12px;display:none}
#prompt kbd{font-family:Anton,Impact,sans-serif;background:#fff;color:#000;padding:0 6px;margin-right:6px}
#xhair{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px #000;display:none}
#phone{position:absolute;right:max(34px,env(safe-area-inset-right));bottom:-520px;width:min(220px,32vh);aspect-ratio:9/18.6;border-radius:30px;background:linear-gradient(145deg,#3a3a40,#121214 40%,#0a0a0b);padding:7px;box-shadow:0 18px 40px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.12);transform:rotate(-4deg);transform-origin:100% 100%;transition:bottom .35s cubic-bezier(.2,.8,.2,1);pointer-events:auto}
#phone.up{bottom:max(18px,env(safe-area-inset-bottom))}
#scr{position:relative;width:100%;height:100%;border-radius:24px;overflow:hidden;color:#fff;background:linear-gradient(180deg,rgba(10,14,30,.15),rgba(10,14,30,.55)),radial-gradient(120% 60% at 70% 105%,#f08a3c 0%,#b8435a 38%,#3b2a5c 70%,#141a33 100%)}
#scr:before{content:'';position:absolute;left:0;right:0;bottom:0;height:34%;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 70' preserveAspectRatio='none'%3E%3Cpath fill='%230b0d18' d='M0 70V44h8v-9h6v9h5V28h9v16h4v-6h7v-14h10v20h5v-8h6v14h3V18h11v26h4v-8h8v8h5V30h8v14h6v-6h5v-14h10v20h4V34h8v10h6v-9h7v9h5V22h9v22h4v-5h6v31z'/%3E%3C/svg%3E") bottom/100% 100% no-repeat;opacity:.95}
#scr .isl{position:absolute;top:7px;left:50%;width:64px;height:17px;margin-left:-32px;background:#000;border-radius:10px;z-index:3}
#scr .st{position:relative;display:flex;justify-content:space-between;padding:7px 16px 0;font-size:12px;font-weight:700}
#scr .big{position:relative;padding:20px 0 0;text-align:center;font-size:50px;font-weight:600;line-height:1;letter-spacing:-1px}
#scr .small{position:relative;text-align:center;font-size:12px;font-weight:600;opacity:.8;letter-spacing:.4px;text-transform:uppercase}
#apps{position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:13px 4px;padding:22px 12px 0}
#apps button{background:none;border:none;color:#fff;font-family:inherit;font-size:11px;font-weight:600;display:flex;flex-direction:column;align-items:center;gap:5px;padding:0;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.6)}
#apps button span{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.25);transition:transform .12s}
#apps button span svg{width:23px;height:23px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#apps button.sel span{transform:scale(1.12);box-shadow:0 0 0 2px #fff,0 4px 12px rgba(0,0,0,.4)}
#appview{position:absolute;inset:0;background:#f4f1ea;color:#141414;display:none;flex-direction:column;z-index:4}
#appview h3{margin:0;padding:32px 14px 9px;font-size:23px;font-weight:700;background:var(--ac,#141414);color:#fff}
#appview .list{padding:8px 9px;display:flex;flex-direction:column;gap:7px;overflow:auto;flex:1}
#appview .row{background:#fff;border-radius:12px;padding:9px 11px;font-size:12.5px;font-weight:500;line-height:1.25;box-shadow:0 1px 2px rgba(0,0,0,.08);pointer-events:auto}
#appview .row b{display:block;font-size:14px;font-weight:700;margin-bottom:2px}
#appview .row.sel{outline:2px solid #141414}
#appview .row button{margin-top:6px;background:#141414;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-family:inherit;font-weight:700;font-size:12px;pointer-events:auto;cursor:pointer}
#appview canvas{width:100%;border-radius:10px;background:#d9d2c3}
#appview .back{margin:6px auto 10px;width:96px;height:5px;background:#141414;border:none;border-radius:3px;padding:0;pointer-events:auto;cursor:pointer}
#tc{position:fixed;inset:0;z-index:4;pointer-events:none}
#tc .tb{position:absolute;width:66px;height:66px;border-radius:50%;border:2px solid rgba(255,255,255,.65);background:rgba(0,0,0,.32);color:#fff;font-family:Anton,Impact,sans-serif;font-size:15px;display:flex;align-items:center;justify-content:center;pointer-events:auto;letter-spacing:.5px}
#tc .tb.down{background:rgba(255,255,255,.35)}
#joy-base{position:fixed;left:0;top:0;width:120px;height:120px;border-radius:50%;border:2px solid rgba(255,255,255,.4);background:rgba(0,0,0,.18);transform:translate(-999px,-999px);pointer-events:none;z-index:4}
#joy-knob{position:fixed;left:0;top:0;width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.75);transform:translate(-999px,-999px);pointer-events:none;z-index:4}
#boot{position:fixed;inset:0;z-index:20;background:#0a0708;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;color:#f4efe6;font-family:'Barlow Condensed',Arial,sans-serif}
#boot h1{margin:0;font-family:Anton,Impact,sans-serif;font-weight:400;font-size:min(120px,18vw);letter-spacing:2px;line-height:.9}
#boot h1 em{font-style:normal;color:#f2c14e}
#boot .load{width:min(360px,70vw);height:6px;background:#2a2224}
#boot .load i{display:block;height:100%;width:0;background:#f2c14e;transition:width .3s}
#boot p{margin:0;font-size:20px;font-weight:600;opacity:.8}
#boot .cr{position:absolute;bottom:14px;left:16px;right:16px;text-align:center;font-size:12px;opacity:.45;font-family:Arial,sans-serif}
#boot button{pointer-events:auto;background:#f2c14e;color:#0a0708;border:none;padding:14px 34px;font-family:Anton,Impact,sans-serif;font-size:26px;letter-spacing:1px;cursor:pointer;display:none}
@media (max-width:760px){#clock{font-size:26px}#money{font-size:22px}#sub2{font-size:11px}.bar{width:100px;height:6px}#stars{font-size:15px}#wpn{top:152px;font-size:15px}#wpn small{font-size:11px}#title{font-size:30px;bottom:34%}#title small{font-size:15px}#subs{font-size:16px;bottom:30%}#help{font-size:12px;max-width:52vw;padding:7px 9px}#help kbd{font-size:11px}#area{font-size:14px}#flash{top:100px;font-size:18px}}
#boot .keys{font-size:15px;opacity:.6;text-align:center;max-width:560px;line-height:1.5}
`;
const ic = (d: string) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
export const APPS: [string, string, string][] = [
  ['Map', ic('M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14'), 'linear-gradient(160deg,#4fc06a,#1f8a4c)'],
  ['Hustles', ic('M4 8h16v11H4zM9 8V5h6v3M4 13h16'), 'linear-gradient(160deg,#f6c453,#d98a12)'],
  ['Texts', ic('M4 5h16v11H10l-5 4v-4H4z'), 'linear-gradient(160deg,#59a8ff,#1f62d6)'],
  ['Land', ic('M3 20h18M5 20V10l7-5 7 5v10M10 20v-5h4v5'), 'linear-gradient(160deg,#c77dff,#7b2cbf)'],
  ['Bank', ic('M3.5 7.5h17v12h-17zM3.5 7.5 15 4.5v3M15.5 13.5h3'), 'linear-gradient(160deg,#3a3a3e,#151517)'],
  ['Weather', ic('M7 18h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.8 11 3.5 3.5 0 0 0 7 18z'), 'linear-gradient(160deg,#7cc4ff,#3a86e0)'],
  ['Roads', ic('M12 3v4M12 10v4M12 17v4M5 21 8 3M19 21 16 3'), 'linear-gradient(160deg,#ff8a5c,#d1452c)'],
  ['Contacts', ic('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5'), 'linear-gradient(160deg,#9aa3ad,#59616b)'],
  ['Settings', ic('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .2-1.3-1.3.2-2-3-1-1 2h-1.8l-1-2-3 1 .2 2L6 7.2 4 7l-1 3 2 1v1.8l-2 1 1 3 2-.2 1.3 1.3-.2 2 3 1 1-2h1.8l1 2 3-1-.2-2 1.3-1.3 2 .2 1-3-2-1z'), 'linear-gradient(160deg,#70757c,#3a3d42)'],
];

export interface PhoneCtx { time: string; real: string; weather: string; season: string; day: number; cash: number; bank: number; plots: { plot: Plot; price: number; owned: boolean; dist: number }[]; jobs: { id: string; title: string; pay: number; desc: string; active: boolean }[]; texts: [string, string][]; potholes: { name: string; road: string; area: string; reported: string; placed: number; source: string }[]; quality: string }

export class LifeHud {
  root: HTMLElement; el = (id: string) => document.getElementById(id)!;
  subQueue: { who: string; text: string; secs: number }[] = []; subT = 0; titleT = 0; flashT = 0; promptT = 0;
  shown = 0; sel = 0; phoneUp = false; appOpen: string | null = null; rowSel = 0;
  ctx: PhoneCtx | null = null;
  onAction?: (app: string, id: string) => void;
  radarCv: HTMLCanvasElement; radarG: CanvasRenderingContext2D;
  constructor(touch: boolean) {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this.root = document.createElement('div'); document.body.appendChild(this.root);
    this.root.innerHTML = `
<div id="boot"><h1>HUSTLE<em>LIFE</em></h1><div class="load"><i id="loadbar"></i></div><p id="loadtxt">Loading Lagos</p><button id="start">TAP OR PRESS ENTER</button>
  <div class="keys" id="keys">WASD move · mouse look · Shift run · Space jump · E or F get in, out, or jack a car · left click punch or shoot · right click aim · R reload · 1 2 3 weapons · T phone · V cockpit view · C crouch · gamepad supported</div>
  <div class="cr">Map data © OpenStreetMap contributors (ODbL) · Vehicles CC BY, Sketchfab artists in cars/CREDITS.json · People and animation CC0 by Quaternius · Textures CC0 by Poly Haven</div></div>
<div id="hlhud">
  <div id="tr"><div id="clock" class="o">07:10</div><div id="sub2" class="o"></div><div id="money" class="o">₦0</div>
    <div class="bar"><i id="hp" style="width:100%;background:#d83b33"></i></div><div class="bar"><i id="ar" style="width:0%;background:#4aa3df"></i></div>
    <div id="stars" class="o"><b>★</b><b>★</b><b>★</b><b>★</b><b>★</b></div></div>
  <div id="wpn" class="o"></div>
  <div id="flash" class="o"></div>
  <div id="area" class="o"></div>
  <canvas id="radar" width="360" height="360"></canvas>
  <div id="help"></div><div id="subs" class="o"></div><div id="title" class="o"></div><div id="prompt"></div><div id="xhair"></div>
  <div id="phone"><div id="scr"><div class="isl"></div><div class="st"><span id="ph-t"></span><span id="ph-b">14%</span></div><div class="big" id="ph-big"></div><div class="small" id="ph-s"></div><div id="apps"></div>
    <div id="appview"><h3 id="av-h"></h3><div class="list" id="av-l"></div><button class="back" id="av-back" aria-label="Home"></button></div></div></div>
</div>
${touch ? `<div id="tc">
  <div class="tb" data-tbtn="fire" style="right:26px;bottom:110px;width:78px;height:78px">HIT</div>
  <div class="tb" data-tbtn="aim" style="right:118px;bottom:150px">AIM</div>
  <div class="tb" data-tbtn="jump" style="right:26px;bottom:24px">JUMP</div>
  <div class="tb" data-tbtn="interact" style="right:118px;bottom:62px">CAR</div>
  <div class="tb" data-tbtn="reload" style="right:200px;bottom:24px;width:54px;height:54px">R</div>
  <div class="tb" data-tbtn="swap" style="right:26px;top:220px;width:54px;height:54px">⇄</div>
  <div class="tb" data-tbtn="phone" style="right:90px;top:220px;width:54px;height:54px;border-radius:14px">☎</div>
  <div class="tb" data-tbtn="crouch" style="right:200px;bottom:96px;width:54px;height:54px">C</div>
</div><div id="joy-base"></div><div id="joy-knob"></div>` : ''}`;
    this.radarCv = this.el('radar') as HTMLCanvasElement; this.radarG = this.radarCv.getContext('2d')!;
    this.renderApps();
    this.el('av-back').onclick = () => this.closeApp();
  }
  setLoad(p: number, txt?: string) { (this.el('loadbar') as HTMLElement).style.width = `${Math.round(p * 100)}%`; if (txt) this.el('loadtxt').textContent = txt; }
  ready(onStart: () => void, auto = false) {
    const b = this.el('start'); b.style.display = 'block'; this.el('loadtxt').textContent = 'Lagos is ready';
    let done = false;
    const go = (e?: Event) => { if (done) return; done = true; e?.preventDefault?.(); this.el('boot').remove(); window.removeEventListener('keydown', k); onStart(); };
    const k = (e: KeyboardEvent) => { if (e.code === 'Enter' || e.code === 'Space') go(); };
    b.addEventListener('click', go); b.addEventListener('pointerup', go); b.addEventListener('touchend', go, { passive: false });
    window.addEventListener('keydown', k); if (auto) go();
  }
  say(who: string, text: string, secs = 3.4) { this.subQueue.push({ who, text, secs }); }
  help(html: string | null) { const h = this.el('help'); if (!html) { h.style.display = 'none'; return; } h.innerHTML = html; h.style.display = 'block'; }
  title(t: string, small?: string, secs = 4, danger = false) { const e = this.el('title'); e.innerHTML = `${t}${small ? `<small>${small}</small>` : ''}`; e.style.opacity = '1'; e.classList.toggle('danger', danger); this.titleT = secs; }
  money(d: number) { const f = this.el('flash'); f.textContent = `${d > 0 ? '+' : '-'}₦${Math.abs(Math.round(d)).toLocaleString()}`; f.style.color = d > 0 ? '#5fd36e' : '#ff5a4f'; f.style.opacity = '1'; this.flashT = 2.2; }
  prompt(html: string | null) { const p = this.el('prompt'); if (!html) { p.style.display = 'none'; return; } p.innerHTML = html; p.style.display = 'block'; }
  event(e: SimEvent) {
    if (e.t === 'announce') this.title(e.title, e.sub, 4.5, e.tone === 'danger');
    if (e.t === 'cash') this.money(e.amount);
    if (e.t === 'crime' && e.kind !== 'cooled') { const st = this.el('stars'); st.classList.add('flash'); setTimeout(() => st.classList.remove('flash'), 2500); }
  }

  // ---------------------------------------------------------------- phone
  renderApps() { this.el('apps').innerHTML = APPS.map(([n, svg, c], i) => `<button data-i="${i}" class="${i === this.sel ? 'sel' : ''}"><span style="background:${c}">${svg}</span>${n}</button>`).join(''); [...this.el('apps').children].forEach((b) => ((b as HTMLElement).onclick = () => { this.sel = +(b as HTMLElement).dataset.i!; this.openApp(); })); }
  togglePhone(on?: boolean) { this.phoneUp = on ?? !this.phoneUp; this.el('phone').classList.toggle('up', this.phoneUp); if (!this.phoneUp) this.closeApp(); return this.phoneUp; }
  phoneNav(dx: number, dy: number) {
    if (this.appOpen) { const rows = this.el('av-l').querySelectorAll('.row'); if (!rows.length) return; this.rowSel = (this.rowSel + dy + rows.length) % rows.length; rows.forEach((r, i) => r.classList.toggle('sel', i === this.rowSel)); (rows[this.rowSel] as HTMLElement).scrollIntoView({ block: 'nearest' }); return; }
    this.sel = (this.sel + dx + dy * 3 + APPS.length) % APPS.length; this.renderApps();
  }
  phoneSelect() {
    if (!this.appOpen) { this.openApp(); return; }
    const rows = this.el('av-l').querySelectorAll('.row'); const b = rows[this.rowSel]?.querySelector('button') as HTMLButtonElement | null; b?.click();
  }
  phoneBack() { if (this.appOpen) this.closeApp(); else this.togglePhone(false); }
  openApp() {
    const [name, , color] = APPS[this.sel]; this.appOpen = name; this.rowSel = 0;
    this.el('appview').style.setProperty('--ac', color); this.el('av-h').textContent = name;
    this.refreshApp(); this.el('appview').style.display = 'flex';
  }
  refreshApp() {
    const name = this.appOpen; if (!name) return; const L = this.el('av-l'); const c = this.ctx; if (!c) return;
    const row = (b: string, s: string, btn?: [string, string, string]) => `<div class="row"><b>${b}</b>${s}${btn ? `<br><button data-app="${btn[0]}" data-id="${btn[1]}">${btn[2]}</button>` : ''}</div>`;
    let html = '';
    if (name === 'Hustles') html = c.jobs.map((j) => row(`${j.title} · ₦${j.pay.toLocaleString()}`, j.desc, j.active ? ['Hustles', 'cancel:' + j.id, 'Drop it'] : ['Hustles', j.id, 'Take it'])).join('') || row('Nothing now', 'Check back when the city wakes up.');
    else if (name === 'Texts') html = c.texts.map(([w, t]) => row(w, t)).join('');
    else if (name === 'Bank') html = row('Cash in hand', `₦${c.cash.toLocaleString()}`) + row('Account', `₦${c.bank.toLocaleString()}`, ['Bank', 'deposit', 'Deposit ₦10,000']) + row('Withdraw', 'Any POS stand on the street will do. Small charge.', ['Bank', 'withdraw', 'Withdraw ₦10,000']);
    else if (name === 'Weather') html = row('Now', `${c.weather}, ${c.season}`) + row('Game time', `${c.time} · day ${c.day}`) + row('Lagos time', `${c.real} WAT`) + row('Potholes', 'Rain fills them. Sun and harmattan dry them. Drive accordingly.');
    else if (name === 'Land') html = c.plots.slice(0, 12).map((p) => row(`${p.owned ? 'YOURS · ' : ''}${p.plot.zone === 'vacant' ? 'Empty plot' : p.plot.zone === 'unfinished' ? 'Uncompleted building' : 'Built plot'} · ${Math.round(p.plot.area)} m²`, `${Math.round(p.dist)} m away · ₦${p.price.toLocaleString()}`, p.owned ? undefined : ['Land', p.plot.id, 'Buy (C of O extra)'])).join('') || row('No plots loaded nearby', 'Walk into a neighbourhood.');
    else if (name === 'Roads') html = row('Pothole reports', 'From news reports and residents, 2023 to October 2026. The game snaps each report to the named road.') + c.potholes.map((p) => row(`${p.name}`, `${p.road} · ${p.area}<br>Reported ${p.reported} · ${p.placed} potholes placed`)).join('');
    else if (name === 'Contacts') html = row('Mama Put', 'Under the bridge, Oshodi') + row('Conductor Sule', 'Oshodi park') + row('Baba Landlord', 'Sells land. Asks no questions. Charges for C of O.');
    else if (name === 'Settings') html = row('Graphics', `Quality: ${c.quality}`, ['Settings', 'quality', 'Change']) + row('Weather', 'Cycle the weather (testing)', ['Settings', 'weather', 'Next']) + row('Time', 'Jump one hour', ['Settings', 'hour', '+1 hour']);
    else html = `<canvas id="pmap" width="400" height="400"></canvas>` + row('Legend', 'Yellow: roads · Red dots: reported potholes · Purple: your land · Green: hustle');
    L.innerHTML = html;
    L.querySelectorAll('button[data-app]').forEach((b) => ((b as HTMLElement).onclick = () => this.onAction?.((b as HTMLElement).dataset.app!, (b as HTMLElement).dataset.id!)));
    L.querySelectorAll('.row').forEach((r, i) => r.classList.toggle('sel', i === this.rowSel));
  }
  closeApp() { this.appOpen = null; this.el('appview').style.display = 'none'; }

  // ---------------------------------------------------------------- per frame
  update(dt: number, sim: LifeSim, s: { time: string; real: string; weather: string; area: string; weapon: string; ammo: string; aiming: boolean; inCar: boolean }) {
    this.el('clock').textContent = s.time;
    this.el('sub2').textContent = `Lagos ${s.real} · ${s.weather}`;
    const cash = sim.cash;
    if (this.shown !== cash) { this.shown += Math.sign(cash - this.shown) * Math.max(1, Math.round(Math.abs(cash - this.shown) * dt * 6)); if (Math.abs(cash - this.shown) < 2) this.shown = cash; }
    this.el('money').textContent = `₦${Math.round(this.shown).toLocaleString()}`;
    const me = sim.local;
    (this.el('hp') as HTMLElement).style.width = `${Math.max(0, (me.hp / me.maxHp) * 100)}%`;
    (this.el('ar') as HTMLElement).style.width = `${me.inv.armor ? me.inv.armor.hp : 0}%`;
    [...this.el('stars').children].forEach((b, i) => b.classList.toggle('on', i < sim.wanted));
    this.el('wpn').innerHTML = s.weapon ? `${s.weapon}<small>${s.ammo}</small>` : '';
    this.el('area').textContent = s.area;
    (this.el('xhair') as HTMLElement).style.display = s.aiming && !s.inCar ? 'block' : 'none';
    this.el('ph-t').textContent = s.time; this.el('ph-big').textContent = s.time; this.el('ph-s').textContent = `${s.weather}`;
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.el('subs').innerHTML = ''; }
    if (this.subT <= 0 && this.subQueue.length) { const n = this.subQueue.shift()!; this.el('subs').innerHTML = `<span class="who">${n.who}:</span> ${n.text}`; this.subT = n.secs; }
    if (this.titleT > 0) { this.titleT -= dt; if (this.titleT <= 0) this.el('title').style.opacity = '0'; }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.el('flash').style.opacity = '0'; }
  }
  drawRadar(net: RoadNet, px: number, pz: number, heading: number, blips: { x: number; z: number; c: string; r?: number }[], potholes: { x: number; z: number }[], owned: number[][]) {
    const g = this.radarG, W = 360, R = 180, S = 1.35; // pixels per metre
    g.save(); g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#5b6b55'; g.fillRect(0, 0, W, W);
    g.translate(R, R); g.rotate(heading); g.translate(-px * S, -pz * S);
    for (const o of owned) { g.fillStyle = 'rgba(160,80,220,0.55)'; g.beginPath(); for (let k = 0; k < o.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, o[k] * S, o[k + 1] * S); g.closePath(); g.fill(); }
    const lanes = net.near(px, pz, 260);
    const done = new Set<number>();
    for (const id of lanes) {
      const l = net.lanes[id]; if (done.has(l.road.id)) continue; done.add(l.road.id);
      g.strokeStyle = l.cls <= 4 ? '#e8d27a' : '#d9d5c8'; g.lineWidth = l.cls <= 4 ? 10 : 6; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); const p = l.road.pts; for (let k = 0; k < p.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, p[k] * S, p[k + 1] * S); g.stroke();
    }
    g.fillStyle = '#c0392b'; for (const h of potholes) { g.beginPath(); g.arc(h.x * S, h.z * S, 2.2, 0, 6.28); g.fill(); }
    for (const b of blips) { g.fillStyle = b.c; g.strokeStyle = '#000'; g.lineWidth = 3; g.beginPath(); g.arc(b.x * S, b.z * S, b.r ?? 9, 0, 6.28); g.fill(); g.stroke(); }
    g.restore();
    // player arrow and north
    g.save(); g.translate(R, R); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -14); g.lineTo(10, 12); g.lineTo(0, 6); g.lineTo(-10, 12); g.closePath(); g.fill(); g.stroke(); g.restore();
    const nx = R + Math.sin(heading) * (R - 22), ny = R - Math.cos(heading) * (R - 22);
    g.fillStyle = '#000'; g.beginPath(); g.arc(nx, ny, 15, 0, 6.28); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 20px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', nx, ny + 1);
  }
}
