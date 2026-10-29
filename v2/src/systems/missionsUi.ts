// On-screen pieces of the mission system: the objective card, choice and offer panels, mini games, the interaction
// prompt, and the 3D markers (pillars of light over objectives, givers, foes and vehicles).
import type * as THREE_NS from 'three';
import type { LifeHud } from '../ui/lifeHud';

export interface ObjectiveView { title: string; text: string; sub?: string; timer?: number; timerWarn?: boolean; step?: [number, number]; reward?: string; tone?: 'mission' | 'event' }
export interface ChoiceView { who?: string; prompt: string; options: { text: string; tag?: string; disabled?: boolean; hint?: string }[]; secs?: number; head?: string; foot?: string; onPick: (i: number) => void }
export interface MiniButton { label: string; key?: string; cb: () => void; cls?: string }
export interface MiniView { title: string; sub?: string; big?: string; bar?: number; time?: string; buttons: MiniButton[]; hint?: string }
export type MarkerKind = 'goal' | 'giver' | 'foe' | 'vehicle' | 'minor';
export interface MarkerSpec { x: number; y: number; z: number; kind: MarkerKind }

const css = `
#mo{position:fixed;right:max(18px,env(safe-area-inset-right));top:150px;width:min(300px,46vw);z-index:7;pointer-events:none;display:none;padding:10px 14px 11px;border-radius:16px;font-family:Inter,system-ui,sans-serif;color:#f3f5f8}
#mo .k{font-size:10.5px;font-weight:800;letter-spacing:1.5px;color:var(--teal,#2de0c8);text-transform:uppercase;display:flex;justify-content:space-between;gap:8px}
#mo.event .k{color:var(--gold,#ffc53d)}
#mo .t{font-size:15px;font-weight:700;line-height:1.28;margin:4px 0 2px;text-shadow:0 1px 2px rgba(0,0,0,.6)}
#mo .s{font-size:12px;color:#cfd5e1;display:flex;justify-content:space-between;gap:8px;align-items:center}
#mo .tm{font-family:Rajdhani,Inter,sans-serif;font-weight:700;font-size:17px;letter-spacing:.4px}
#mo .tm.warn{color:#ff6b78;animation:mfl .6s steps(2) infinite}@keyframes mfl{50%{opacity:.45}}
#mo .dots{display:flex;gap:3px;margin-top:7px}#mo .dots i{height:3px;flex:1;border-radius:2px;background:rgba(255,255,255,.14)}#mo .dots i.on{background:var(--teal,#2de0c8)}
#mc,#mg{position:fixed;left:50%;transform:translateX(-50%);z-index:8;display:none;font-family:Inter,system-ui,sans-serif;color:#f3f5f8;border-radius:20px;padding:16px 18px 14px;width:min(560px,92vw);pointer-events:auto}
#mc{bottom:max(16px,10%)}
#mg{top:50%;transform:translate(-50%,-50%);width:min(440px,92vw);text-align:center}
#mc .who{font-size:11px;font-weight:800;letter-spacing:1.4px;color:var(--teal,#2de0c8);text-transform:uppercase}
#mc .p{font-size:17px;font-weight:600;line-height:1.35;margin:4px 0 10px}
#mc .o{display:flex;gap:10px;align-items:center;width:100%;text-align:left;margin:6px 0 0;padding:11px 13px;border-radius:13px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.07);color:#fff;font:600 14.5px/1.3 Inter,system-ui,sans-serif;cursor:pointer}
#mc .o:hover:not(.dis),#mc .o:focus-visible{background:rgba(45,224,200,.16);border-color:rgba(45,224,200,.5);outline:none}
#mc .o.dis{opacity:.45;cursor:not-allowed}
#mc .o b{flex:0 0 24px;height:24px;border-radius:8px;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;font:700 13px Rajdhani,Inter,sans-serif}
#mc .o span{flex:1}#mc .o em{font-style:normal;font-size:11.5px;color:#9ba3b4;font-weight:600;white-space:nowrap}
#mc .tb{height:3px;border-radius:2px;background:rgba(255,255,255,.12);margin-top:10px;overflow:hidden}#mc .tb i{display:block;height:100%;background:var(--gold,#ffc53d);width:100%}
#mc .ft{font-size:11.5px;color:#9ba3b4;margin-top:8px}
#mg h4{margin:0;font-size:12px;letter-spacing:1.6px;font-weight:800;color:var(--teal,#2de0c8);text-transform:uppercase}
#mg .sub{font-size:14px;color:#cfd5e1;margin:4px 0 10px}
#mg .big{font:700 40px/1.1 Rajdhani,Inter,sans-serif;letter-spacing:6px;margin:6px 0 10px;min-height:44px}
#mg .big .on{color:var(--teal,#2de0c8)}#mg .big .done{opacity:.28}
#mg .bar{height:8px;border-radius:5px;background:rgba(255,255,255,.12);overflow:hidden;margin:6px 0 8px}#mg .bar i{display:block;height:100%;background:linear-gradient(90deg,#2de0c8,#8b5cf6);width:0}
#mg .tm{font:700 20px Rajdhani,Inter,sans-serif;color:#ffd36b}
#mg .row{display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap}
#mg .mb{pointer-events:auto;min-width:64px;padding:13px 16px;border:none;border-radius:13px;font:800 16px Rajdhani,Inter,sans-serif;color:#fff;background:linear-gradient(180deg,#8b5cf6,#6d3ef0);cursor:pointer;box-shadow:0 6px 16px rgba(109,62,240,.4)}
#mg .mb.alt{background:rgba(255,255,255,.1);box-shadow:none}#mg .mb.big2{min-width:180px;padding:18px 26px;font-size:22px}
#mg .mb:active{transform:scale(.95)}
#mg .hint{font-size:11.5px;color:#9ba3b4;margin-top:8px}
#mprompt{position:fixed;left:50%;bottom:34%;transform:translateX(-50%);z-index:7;display:none;padding:9px 16px;border-radius:999px;font:600 14px Inter,system-ui,sans-serif;color:#fff;pointer-events:auto;cursor:pointer}
#mprompt kbd{font-family:Rajdhani,sans-serif;font-weight:700;font-size:13px;background:#fff;color:#0b0d14;border-radius:6px;padding:1px 7px;margin:0 6px 0 0}
@media (max-width:760px),(max-height:520px){#mo{top:118px;width:min(240px,50vw);padding:7px 10px}#mo .t{font-size:12.5px}#mo .s{font-size:11px}#mc{width:min(520px,94vw);padding:11px 12px;bottom:6px}#mc .p{font-size:14px;margin-bottom:6px}#mc .o{padding:8px 10px;font-size:13px;margin-top:4px}#mg{width:min(380px,94vw);padding:12px}#mg .big{font-size:30px}}
`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const COL: Record<MarkerKind, number> = { goal: 0x3ddc84, giver: 0xffc53d, foe: 0xff4d5e, vehicle: 0x59a8ff, minor: 0x9ad7ff };

export class MissionUi {
  private mo: HTMLElement; private mc: HTMLElement; private mg: HTMLElement; private mp: HTMLElement;
  private choiceCb: ((i: number) => void) | null = null; private choiceN = 0; private choiceDis: boolean[] = []; private choiceT = 0; private choiceTot = 0; private choiceBar: HTMLElement | null = null;
  private miniKeys = new Map<string, () => void>(); private promptCb: (() => void) | null = null; private eCb: (() => void) | null = null;
  private miniEls: { sub?: HTMLElement; big?: HTMLElement; bar?: HTMLElement; time?: HTMLElement } = {};
  private pool: { g: THREE_NS.Group; pillar: THREE_NS.Mesh; ring: THREE_NS.Mesh; mats: THREE_NS.MeshBasicMaterial[] }[] = [];
  private t = 0; private root: THREE_NS.Group;
  constructor(private hud: LifeHud, private THREE: typeof THREE_NS, scene: THREE_NS.Scene) {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const mk = (id: string, cls = '') => { const d = document.createElement('div'); d.id = id; d.className = cls; document.body.appendChild(d); return d; };
    this.mo = mk('mo', 'gl'); this.mc = mk('mc', 'gl'); this.mg = mk('mg', 'gl'); this.mp = mk('mprompt', 'gl');
    this.mp.onclick = () => { this.promptCb?.(); }; this.mp.addEventListener('pointerdown', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => this.key(e));
    this.root = new THREE.Group(); this.root.name = 'mission-markers'; scene.add(this.root);
  }

  // ------------------------------------------------------------ objective card
  setObjective(o: ObjectiveView | null) {
    if (!o) { this.mo.style.display = 'none'; return; }
    this.mo.style.display = 'block'; this.mo.className = 'gl ' + (o.tone ?? 'mission');
    const dots = o.step ? `<div class="dots">${Array.from({ length: o.step[1] }, (_, i) => `<i class="${i < o.step![0] ? 'on' : ''}"></i>`).join('')}</div>` : '';
    const tm = o.timer !== undefined ? `<span class="tm${o.timerWarn ? ' warn' : ''}">${Math.floor(Math.max(0, o.timer) / 60)}:${String(Math.floor(Math.max(0, o.timer) % 60)).padStart(2, '0')}</span>` : '';
    const html = `<div class="k"><span>${esc(o.tone === 'event' ? 'Wahala' : 'Hustle')}</span><span>${o.reward ? esc(o.reward) : ''}</span></div><div class="t">${esc(o.text)}</div><div class="s"><span>${esc(o.sub ?? o.title)}</span>${tm}</div>${dots}`;
    if (html !== (this as any)._moHtml) { this.mo.innerHTML = html; (this as any)._moHtml = html; }
  }
  /** Same card, but only the timer text changes: avoids rebuilding the DOM every frame. */
  setVisible(on: boolean) { const v = on ? '' : 'none'; if (!on) { this.mo.style.visibility = 'hidden'; this.mc.style.visibility = 'hidden'; this.mg.style.visibility = 'hidden'; this.mp.style.visibility = 'hidden'; } else { this.mo.style.visibility = ''; this.mc.style.visibility = ''; this.mg.style.visibility = ''; this.mp.style.visibility = ''; } void v; }

  // ------------------------------------------------------------ choices
  get choosing() { return this.choiceCb !== null; }
  choice(c: ChoiceView) {
    this.choiceCb = c.onPick; this.choiceN = c.options.length; this.choiceDis = c.options.map((o) => !!o.disabled); this.choiceT = c.secs ?? 0; this.choiceTot = c.secs ?? 0;
    this.mc.style.display = 'block';
    this.mc.innerHTML = `${c.head ? `<div class="who">${esc(c.head)}</div>` : c.who ? `<div class="who">${esc(c.who)}</div>` : ''}<div class="p">${esc(c.prompt)}</div>` +
      c.options.map((o, i) => `<button class="o${o.disabled ? ' dis' : ''}" data-i="${i}"><b>${i + 1}</b><span>${esc(o.text)}${o.hint ? `<br><em>${esc(o.hint)}</em>` : ''}</span>${o.tag ? `<em>${esc(o.tag)}</em>` : ''}</button>`).join('') +
      (c.secs ? `<div class="tb"><i></i></div>` : '') + (c.foot ? `<div class="ft">${esc(c.foot)}</div>` : '');
    this.choiceBar = this.mc.querySelector('.tb i');
    this.mc.querySelectorAll('button.o').forEach((b) => ((b as HTMLElement).onclick = () => this.pick(+(b as HTMLElement).dataset.i!)));
  }
  closeChoice() { this.choiceCb = null; this.mc.style.display = 'none'; this.mc.innerHTML = ''; }
  private pick(i: number) { if (!this.choiceCb || this.choiceDis[i]) return; const cb = this.choiceCb; this.closeChoice(); cb(i); }

  // ------------------------------------------------------------ mini games
  get minigame() { return this.mg.style.display === 'block'; }
  miniOpen(v: MiniView) {
    this.miniKeys.clear();
    this.mg.style.display = 'block';
    this.mg.innerHTML = `<h4>${esc(v.title)}</h4><div class="sub"></div><div class="big"></div><div class="bar"><i></i></div><div class="tm"></div><div class="row"></div>${v.hint ? `<div class="hint">${esc(v.hint)}</div>` : ''}`;
    this.miniEls = { sub: this.mg.querySelector('.sub') as HTMLElement, big: this.mg.querySelector('.big') as HTMLElement, bar: this.mg.querySelector('.bar i') as HTMLElement, time: this.mg.querySelector('.tm') as HTMLElement };
    const row = this.mg.querySelector('.row') as HTMLElement;
    for (const b of v.buttons) {
      const el = document.createElement('button'); el.className = 'mb ' + (b.cls ?? ''); el.textContent = b.label; el.onclick = (e) => { e.stopPropagation(); b.cb(); }; row.appendChild(el);
      if (b.key) this.miniKeys.set(b.key, b.cb);
    }
    this.miniSet(v);
  }
  miniSet(v: Partial<MiniView> & { bigHtml?: string }) {
    const e = this.miniEls;
    if (v.sub !== undefined && e.sub) e.sub.textContent = v.sub;
    if (v.big !== undefined && e.big) e.big.textContent = v.big;
    if (v.bigHtml !== undefined && e.big) e.big.innerHTML = v.bigHtml;
    if (v.bar !== undefined && e.bar) e.bar.style.width = `${Math.round(Math.max(0, Math.min(1, v.bar)) * 100)}%`;
    if (v.time !== undefined && e.time) e.time.textContent = v.time;
  }
  miniClose() { this.mg.style.display = 'none'; this.mg.innerHTML = ''; this.miniKeys.clear(); this.miniEls = {}; }

  // ------------------------------------------------------------ prompt ("E Talk to ...")
  prompt(html: string | null, cb?: () => void) {
    if (!html) { this.mp.style.display = 'none'; this.promptCb = null; this.eCb = null; return; }
    if (this.mp.innerHTML !== html) this.mp.innerHTML = html;
    this.mp.style.display = 'block'; this.promptCb = cb ?? null; this.eCb = cb ?? null;
  }
  private key(e: KeyboardEvent) {
    if (e.repeat && e.code !== 'KeyE') return;
    if (this.choiceCb) { const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code); if (m) { const i = +m[1] - 1; if (i < this.choiceN) { this.pick(i); e.preventDefault(); } } return; }
    if (this.minigame) { const cb = this.miniKeys.get(e.code); if (cb) { cb(); e.preventDefault(); } return; }
    if (e.code === 'KeyE' && !e.repeat && this.eCb && !this.hud.phoneUp && !this.hud.landmapOn) this.eCb();
  }

  // ------------------------------------------------------------ 3D markers
  private build() {
    const T = this.THREE;
    const mats = [new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, fog: false, side: T.DoubleSide, blending: T.AdditiveBlending }), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, fog: false, side: T.DoubleSide, blending: T.AdditiveBlending })];
    const pillar = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 90, 14, 1, true), mats[0]); pillar.position.y = 45; pillar.renderOrder = 20; pillar.frustumCulled = false;
    const ring = new T.Mesh(new T.RingGeometry(1.2, 1.55, 40).rotateX(-Math.PI / 2), mats[1]); ring.position.y = 0.12; ring.renderOrder = 21; ring.frustumCulled = false;
    const g = new T.Group(); g.add(pillar, ring); g.visible = false; this.root.add(g);
    return { g, pillar, ring, mats };
  }
  setMarkers(list: MarkerSpec[], px: number, pz: number) {
    while (this.pool.length < Math.min(14, list.length)) this.pool.push(this.build());
    for (let i = 0; i < this.pool.length; i++) {
      const m = this.pool[i]; const s = list[i];
      if (!s) { m.g.visible = false; continue; }
      m.g.visible = true; m.g.position.set(s.x, s.y, s.z);
      const c = COL[s.kind]; m.mats[0].color.setHex(c); m.mats[1].color.setHex(c);
      const d = Math.hypot(s.x - px, s.z - pz); const minor = s.kind === 'minor' || s.kind === 'foe';
      // far markers get a wider, brighter beam so they read from across the city
      const w = minor ? 0.6 : Math.max(1, Math.min(7, d / 120));
      m.pillar.scale.set(w, minor ? 0.18 : 1, w); m.pillar.position.y = minor ? 8 : 45;
      const sc = (s.kind === 'goal' ? 4.2 : minor ? 1.5 : 2.6) * (1 + 0.1 * Math.sin(this.t * 4 + i)); m.ring.scale.setScalar(sc * (s.kind === 'goal' ? 1 : 1) * Math.max(1, Math.min(2.6, d / 220)));
      m.mats[0].opacity = (minor ? 0.25 : 0.3) * (d < 14 ? 0.5 : 1);
    }
  }
  update(dt: number) { this.t += dt; if (this.choiceT > 0 && this.choiceBar) { this.choiceT -= dt; this.choiceBar.style.width = `${Math.max(0, (this.choiceT / this.choiceTot) * 100)}%`; if (this.choiceT <= 0 && this.choiceCb) { const cb = this.choiceCb; const fb = (this as any)._fallback as number; this.closeChoice(); void fb; cb(-1); } } }
}
