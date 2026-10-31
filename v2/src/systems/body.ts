// The body on the client: what you feel (symptoms on screen, a slower walk), the Health app (chemists, clinics,
// hospitals, opticians, your hospital debt), and what happens when you die: the nearest hospital, a bill, and if you
// cannot pay, out on the street in your underwear. Online the server decides all of it (server/src/body.ts); offline a
// small local version keeps the same rules on the save.
import type { GameCtx, GameSystem, GoalPoint } from './registry';
import { net } from '../net/client';
import { registerApp } from '../ui/lifeHud';
import { TILE } from '../world/streamer';
import type { BodyView } from '../net/protocol';
import { DRUGS, HOSPITAL_BILL, ILLNESSES, SYMPTOM_TEXT, TRAITS, TRAIT_IDS, hospitalKind, worldHours, type DrugId, type Symptom, type TraitId } from '../net/rules';

interface Place { id: string; name: string; kind: string; x: number; z: number }
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SEV = ['', 'mild', 'bad', 'serious'];
const NEAR = 60;

const css = `
#hl-body{position:fixed;inset:0;pointer-events:none;z-index:2}
#hl-body .blur{position:absolute;inset:0;backdrop-filter:blur(2.4px);-webkit-backdrop-filter:blur(2.4px);-webkit-mask-image:radial-gradient(ellipse 62% 58% at 50% 48%,transparent 55%,#000 100%);mask-image:radial-gradient(ellipse 62% 58% at 50% 48%,transparent 55%,#000 100%);opacity:0;transition:opacity 1.2s}
#hl-body .red{position:absolute;inset:0;box-shadow:inset 0 0 140px 30px rgba(200,20,40,.38);opacity:0;transition:opacity 1.5s}
#hl-body .fever{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(255,120,40,.32) 100%);opacity:0;animation:hlfever 3.2s ease-in-out infinite}
#hl-body .weak{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 50%,rgba(0,0,0,.45) 100%);opacity:0;transition:opacity 2s}
@keyframes hlfever{0%,100%{filter:brightness(1)}50%{filter:brightness(1.35)}}
#hl-feel{position:fixed;left:50%;bottom:calc(max(18px,env(safe-area-inset-bottom)) + 120px);transform:translateX(-50%);background:rgba(14,15,24,.72);color:#f2f4f8;font:600 13px Inter,sans-serif;padding:7px 13px;border-radius:999px;pointer-events:none;opacity:0;transition:opacity .4s;z-index:6;white-space:nowrap}
#hl-feel.on{opacity:1}
#appview .hb-sym{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px} #appview .hb-sym span{background:#fee2e2;color:#991b1b;border-radius:999px;padding:3px 9px;font-size:11.5px;font-weight:600}
#appview .hb-drug{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-top:1px solid #eef0f4} #appview .hb-drug:first-of-type{border-top:none}
#appview .hb-drug button{border:none;border-radius:999px;background:#11131a;color:#fff;font:700 12px Inter,sans-serif;padding:7px 12px;cursor:pointer;pointer-events:auto}
#appview .hb-debt{background:linear-gradient(140deg,#3f0d12,#a71d31);color:#fff;border-radius:18px;padding:14px} #appview .hb-debt b{color:#fff;font-size:15px;display:block} #appview .hb-debt .amt{font:800 26px Inter,sans-serif;margin:4px 0}
#appview .hb-debt span{opacity:.8;font-size:12px} #appview .hb-debt button{margin-top:10px;margin-right:6px;border:none;border-radius:999px;background:#fff;color:#a71d31;font:700 12px Inter,sans-serif;padding:8px 13px;cursor:pointer;pointer-events:auto}
`;

class BodyApp {
  v: BodyView = { traits: [], fixed: [], debt: 0, stripped: false, origin: 'regular', deaths: 0, ill: [] };
  places: Place[] = [];
  target: GoalPoint | null = null;
  private el!: HTMLElement; private feel!: HTMLElement; private feelT = 0; private nextFeel = 25; private expoT = 0;
  private dying = false; private said = '';
  constructor(private ctx: GameCtx) {}
  get hud() { return this.ctx.hud; }

  init() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this.el = document.createElement('div'); this.el.id = 'hl-body'; this.el.innerHTML = '<div class="blur"></div><div class="red"></div><div class="fever"></div><div class="weak"></div>'; document.body.appendChild(this.el);
    this.feel = document.createElement('div'); this.feel.id = 'hl-feel'; document.body.appendChild(this.feel);
    registerApp('Health', '', '', () => this.html());
    new MutationObserver(() => this.wire()).observe(document.getElementById('av-l') ?? document.body, { childList: true });
    // death: the hospital takes over from the sim's old "pay 10k and stand up"
    this.ctx.sim.hooks.onPlayerDeath = () => { void this.hospital(); return true; };
    (window as any).__body = this;
    void this.loadPlaces();
  }
  start() {
    if (!net.active) this.offlineInit();
    const w = net.welcome as any; if (w?.body) this.set(w.body);
    net.on('welcome', (w2: any) => { if (w2?.body) this.set(w2.body); });
    net.on('body', (m: any) => { const was = this.v.ill.length; this.set(m); if (m.collapse) void this.collapse(); else if (this.v.ill.length > was) this.say('You do not feel well. Check Health on your phone.', 5); });
  }
  private offlineInit() {
    const S = (this.ctx.save.body ??= {}) as Partial<BodyView>;
    if (!S.traits) { const r = Math.random(); const pool = [...TRAIT_IDS]; S.traits = []; for (let i = 0; i < (r < 0.3 ? 0 : r < 0.82 ? 1 : 2); i++) S.traits.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]); S.fixed = []; S.debt = 0; S.stripped = false; S.deaths = 0; this.ctx.persist(); }
    this.set({ ...this.v, ...S, ill: [] } as BodyView);
  }
  set(v: BodyView) {
    this.v = { ...this.v, ...v };
    const me = this.ctx.view.actors?.get(this.ctx.sim.local.id) as any; me?.view?.setStripped?.(this.v.stripped);
    if (this.hud.appOpen === 'Health') this.hud.refreshApp();
  }
  private async loadPlaces() {
    try {
      const r = await fetch('content/places.json'); const j = await r.json();
      const want = new Set(['hospital', 'clinic', 'pharmacy', 'optician', 'market', 'shop']);
      this.places = (j.items as any[]).filter((p) => want.has(p.kind)).map((p) => { const w = this.ctx.store.project(p.lat, p.lon); return { id: p.id, name: p.name, kind: p.kind, x: w.x, z: w.z }; });
    } catch { /* no places: the app still works, without directions */ }
  }
  private nearest(kinds: string[], max = Infinity) {
    const me = this.ctx.sim.local.pos; let best: Place | null = null, bd = max;
    for (const p of this.places) if (kinds.includes(p.kind)) { const d = Math.hypot(p.x - me.x, p.z - me.z); if (d < bd) { bd = d; best = p; } }
    return best ? { ...best, d: bd } : null;
  }
  private has(t: TraitId) { return this.v.traits.includes(t) && !this.v.fixed.includes(t); }
  private symptoms(): Set<Symptom> { const s = new Set<Symptom>(); for (const i of this.v.ill) for (const x of i.symptoms) s.add(x); return s; }

  // ------------------------------------------------------------------------------------------ how you feel
  /** a slower walk when sick or a slow walker; no sprinting when it is bad */
  filterCommand(c: import('../sim/types').Command) {
    let k = this.has('slow') ? 0.93 : 1; let worst = 0;
    for (const i of this.v.ill) { if (!i.eased) k *= i.walk; worst = Math.max(worst, i.sev); }
    if (k < 0.999) { c.mx *= k; c.mz *= k; }
    if (worst >= 2 || (this.has('breath') && Math.random() < 0.02)) c.sprint = false;
  }
  frame(dt: number) {
    const sym = this.symptoms(); const alive = this.ctx.sim.local.alive;
    const set = (cls: string, on: number) => { const e = this.el.querySelector<HTMLElement>('.' + cls)!; const v = String(on); if (e.style.opacity !== v) e.style.opacity = v; };
    set('blur', this.has('myopia') ? 1 : sym.has('redeyes') ? 0.7 : 0);
    set('red', sym.has('redeyes') ? 1 : 0);
    set('fever', sym.has('fever') && alive ? 0.9 : 0);
    set('weak', sym.has('weak') || this.v.ill.some((i) => i.sev >= 2) ? 0.8 : 0);
    // now and then, the body says something
    this.feelT -= dt; if (this.feelT <= 0) this.feel.classList.remove('on');
    this.nextFeel -= dt;
    if (this.nextFeel <= 0 && sym.size && alive) {
      this.nextFeel = 30 + Math.random() * 40; const pick = [...sym][Math.floor(Math.random() * sym.size)];
      this.say(({ cough: '*cough cough*', sneeze: 'Achoo!', cramps: 'Your stomach turns...', runs: 'You need a toilet. Now.', fever: 'Your body is burning', chills: 'You are shivering', redeyes: 'Your eyes itch', headache: 'Your head is banging', pain: 'A sharp pain in your belly', weak: 'You feel weak' } as Record<Symptom, string>)[pick], 3);
    }
    // what the day exposes you to; the server rolls the dice (and only for this player)
    this.expoT -= dt; if (this.expoT <= 0) { this.expoT = 45; this.exposures(); }
  }
  say(t: string, secs = 3) { this.feel.textContent = t; this.feel.classList.add('on'); this.feelT = secs; }
  private exposures() {
    if (!net.active || !this.ctx.sim.local.alive) return;
    const h = worldHours(net.epochNow) % 24; const life = (window as any).__life; const inside = !!life?.S?.at || !!life?.S?.home;
    const send = (kind: string) => void net.act('body.exposure', { kind }).then((r: any) => { if (r?.body) this.set(r.body); });
    if ((h >= 19 || h < 6) && !inside) send('mosquito');
    if (this.ctx.view.atmo.cur?.name === 'harmattan' && !inside) send('harmattan');
    const hunger = life?.S?.needs?.v?.hunger; if (typeof hunger === 'number' && hunger < 8) send('hungry');
  }
  /** called by the vendors when you eat street food */
  ate() { if (net.active) void net.act('body.exposure', { kind: 'street_food' }).then((r: any) => { if (r?.body) this.set(r.body); }); }

  // ------------------------------------------------------------------------------------------ death and the hospital
  private async hospital() {
    if (this.dying) return; this.dying = true;
    const { hud, sim } = this.ctx;
    hud.title('WASTED', 'Someone called an ambulance', 3.5, true);
    await sleep(3500);
    try {
      const pos = sim.local.pos;
      if (net.active) {
        const r: any = await net.act('body.died', {});
        if (!r.ok) { sim.respawnPlayer(); return; }
        this.set(r.body); await this.moveTo(r.hospital.x + 4, r.hospital.z + 4);
        sim.revive(); if (r.stripped) this.strip();
        hud.title(String(r.hospital.name).toUpperCase(), r.stripped ? `You could not pay ${naira(r.bill)}. They kept what you had. You owe ${naira(r.debt)}.` : `Bill paid: ${naira(r.bill)}. Get well soon.`, 6, !!r.stripped);
        if (r.stripped) hud.toast('Hospital', `You are outside in your underwear. Half of what you earn goes to the hospital until the ${naira(r.debt)} is paid. Okrika clothes at any market: ₦3,500.`, 'var(--red)', 'msg', 9);
        return;
      }
      // offline: the same rules on the save
      const h = this.nearestTo(pos.x, pos.z); const bill = HOSPITAL_BILL[hospitalKind(h?.name ?? '')];
      const S = this.ctx.save.body as BodyView; const have = sim.cash; let stripped = false;
      if (have >= bill) sim.cash -= bill; else { sim.cash = 0; S.debt = (S.debt ?? 0) + bill - have; S.stripped = stripped = true; }
      S.deaths = (S.deaths ?? 0) + 1; this.ctx.persist(); this.set({ ...this.v, ...S });
      if (h) await this.moveTo(h.x + 4, h.z + 4);
      sim.revive(); if (stripped) this.strip();
      hud.title((h?.name ?? 'General Hospital').toUpperCase(), stripped ? `You could not pay ${naira(bill)}. You owe ${naira(S.debt)}.` : `Bill paid: ${naira(bill)}.`, 6, stripped);
    } catch { sim.respawnPlayer(); }
    finally { this.dying = false; }
  }
  private nearestTo(x: number, z: number) { let best: Place | null = null, bd = Infinity; for (const p of this.places) if (p.kind === 'hospital') { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } } return best; }
  /** jump to a far point once its streets have loaded (the same dance as the resume-where-you-left-off code) */
  private async moveTo(x: number, z: number) {
    const { view, sim } = this.ctx; const me = sim.local;
    try { await view.world.store.around(x, z, 900); } catch { /* go anyway */ }
    const has = () => { for (const t of view.world.tiles.values()) if (x >= t.x0 && x < t.x0 + TILE && z >= t.z0 && z < t.z0 + TILE) return true; return false; };
    for (let i = 0; i < 150 && !has(); i++) { view.world.update(x, z, true); await sleep(16); }
    me.pos.x = x; me.pos.y = 0.05; me.pos.z = z; me.vy = 0; me.body.setTranslation({ x, y: 1, z }, true);
  }
  /** they took everything: weapons, armour, what was in your bag, and your clothes */
  private strip() {
    const me = this.ctx.sim.local; me.inv.primary = null; me.inv.secondary = null; me.inv.armor = null; me.inv.backpack.fill(null);
    const v = this.ctx.view.actors?.get(me.id) as any; v?.view?.setStripped?.(true);
  }
  private async collapse() { this.say('Everything goes black...', 4); await sleep(2500); const me = this.ctx.sim.local; if (me.alive) { me.hp = 0; me.alive = false; void this.hospital(); } }

  // ------------------------------------------------------------------------------------------ the Health app
  private html() {
    const v = this.v; const out: string[] = [];
    if (v.debt > 0) out.push(`<div class="hb-debt"><b>Hospital debt</b><div class="amt">${naira(v.debt)}</div><span>Half of what you earn goes to it until it is paid.</span><br><button data-hb="pay:all">Pay what I can</button><button data-hb="pay:10000">Pay ₦10,000</button></div>`);
    if (v.stripped) { const m = this.nearest(['market', 'shop'], 120); out.push(`<div class="row"><b>You are in your underwear</b>The hospital kept your clothes. Any market stall sells okrika clothes for ₦3,500.${m ? `<br><button class="btn" data-hb="dress">Buy okrika clothes (₦3,500)</button>` : `<br><button class="btn" data-hb="go:market">Nearest market</button>`}</div>`); }
    if (!v.ill.length) out.push(`<div class="row"><b>How you feel</b>You feel fine. Eat well, sleep, and keep away from people who are coughing.</div>`);
    for (const i of v.ill) out.push(`<div class="row"><b>${i.name ? esc(i.name) : 'Something is not right'}</b>${SEV[i.sev]}${i.eased ? ', eased by the drugs for now' : ''}<div class="hb-sym">${i.symptoms.map((s) => `<span>${SYMPTOM_TEXT[s]}</span>`).join('')}</div>${i.drug ? `<div style="margin-top:6px">The doctor said: ${esc(DRUGS[i.drug].name)}.</div>` : ''}</div>`);
    // what is around you
    const chem = this.nearest(['pharmacy', 'clinic', 'hospital'], NEAR), clinic = this.nearest(['clinic', 'hospital'], NEAR), hosp = this.nearest(['hospital'], 90), opt = this.nearest(['optician'], NEAR);
    if (chem) out.push(`<div class="row"><b>${esc(chem.name)}</b>Over the counter. The right drug clears a mild illness; the wrong one wastes your money.${(Object.keys(DRUGS) as DrugId[]).map((d) => `<div class="hb-drug"><span>${DRUGS[d].name} · ${naira(DRUGS[d].price)}</span><button data-hb="drug:${d}">Buy</button></div>`).join('')}</div>`);
    if (clinic) { const k = clinic.kind === 'hospital' ? 1.5 : 1; out.push(`<div class="row"><b>${esc(clinic.name)}</b>A doctor can tell you what you have. The lab test also finds what you carry without feeling it.<br><button class="btn" data-hb="see:${clinic.kind}">See a doctor (${naira(3000 * k)})</button><button class="btn" data-hb="test:${clinic.kind}">Full lab test (${naira(8000 * k)})</button>${v.ill.some((i) => i.name) ? `<button class="btn" data-hb="treat:${clinic.kind}">Treat what they found</button>` : ''}</div>`); }
    if (hosp && this.has('breath')) out.push(`<div class="row"><b>Inhaler</b>For your short breath. ${naira(TRAITS.breath.fix!.price)}.<br><button class="btn" data-hb="fix:breath">Get an inhaler</button></div>`);
    if (opt && this.has('myopia')) out.push(`<div class="row"><b>${esc(opt.name)}</b>Glasses for your short sight. ${naira(TRAITS.myopia.fix!.price)}.<br><button class="btn" data-hb="glasses">Get glasses</button></div>`);
    if (!chem && !clinic) out.push(`<div class="row"><b>Find help</b>Chemists sit by every market. Clinics and hospitals cost more but know what they are doing.<br><button class="btn" data-hb="go:pharmacy">Nearest chemist</button><button class="btn" data-hb="go:clinic">Nearest clinic</button><button class="btn" data-hb="go:hospital">Nearest hospital</button></div>`);
    const tr = v.traits.map((t) => `<div style="margin-top:6px"><b style="display:inline;font-size:13px">${TRAITS[t].name}</b>${v.fixed.includes(t) ? ' (sorted)' : ''}: ${TRAITS[t].says}${TRAITS[t].fix && !v.fixed.includes(t) ? ` ${TRAITS[t].fix!.name} help${TRAITS[t].fix!.where === 'optician' ? ' (opticians in Ikeja)' : ' (any hospital)'}.` : ''}</div>`).join('');
    out.push(`<div class="row"><b>Your body</b>${tr || 'Nothing holding you back.'}</div>`);
    if (this.said) out.unshift(`<div class="row" style="background:#ecfdf5"><b>Doctor</b>${esc(this.said)}</div>`);
    return out.join('');
  }
  private wire() {
    const L = document.getElementById('av-l'); if (!L || this.hud.appOpen !== 'Health') return;
    L.querySelectorAll<HTMLElement>('[data-hb]').forEach((el) => { if ((el as any)._hb) return; (el as any)._hb = 1; el.addEventListener('click', (e) => { e.stopPropagation(); void this.act(el.dataset.hb!); }); });
  }
  async act(op: string) {
    const [k, a] = [op.split(':')[0], op.slice(op.indexOf(':') + 1)];
    if (k === 'go') { const p = this.nearest(a === 'clinic' ? ['clinic', 'hospital'] : a === 'pharmacy' ? ['pharmacy'] : a === 'market' ? ['market'] : ['hospital']); if (p) { this.target = { x: p.x, z: p.z, label: p.name }; this.hud.toast('Health', `GPS set: ${p.name}, ${(p.d / 1000).toFixed(1)} km.`, 'linear-gradient(160deg,#ff6b6b,#d61f3f)', 'msg', 3); } return; }
    if (!net.active) { this.hud.toast('Health', 'Chemists and clinics need you online for now.', 'var(--red)', 'msg', 3); return; }
    let r: any;
    if (k === 'drug') r = await net.act('body.treat', { where: 'pharmacy', drug: a });
    else if (k === 'see' || k === 'test' || k === 'treat') r = await net.act('body.treat', { where: a === 'hospital' ? 'hospital' : 'clinic', op: k });
    else if (k === 'fix') r = await net.act('body.treat', { where: 'hospital', op: 'fix', drug: a });
    else if (k === 'glasses') r = await net.act('body.treat', { where: 'optician' });
    else if (k === 'pay') r = await net.act('body.paydebt', { amount: a === 'all' ? Math.max(0, this.ctx.sim.cash) : Number(a) });
    else if (k === 'dress') r = await net.act('body.dress');
    if (!r) return;
    if (!r.ok) { this.hud.toast('Health', r.err ?? 'That did not work.', 'var(--red)', 'msg', 3.5); return; }
    this.said = r.said ?? ''; if (r.body) this.set(r.body);
    if (k === 'dress') this.hud.toast('Market', 'Okrika, but it fits. You are dressed again.', 'linear-gradient(160deg,#ffcf5a,#d97706)', 'msg', 3.5);
    this.hud.refreshApp();
  }
}

let B: BodyApp | null = null;
export const bodyApi = { ate: () => B?.ate(), get state() { return B?.v ?? null; } };
export const bodySystem: GameSystem = {
  id: 'body',
  init(ctx) { B = new BodyApp(ctx); B.init(); },
  start() { B?.start(); },
  frame(_c, dt) { B?.frame(dt); },
  filterCommand(_c, c) { B?.filterCommand(c); },
  goal() { const t = B?.target; if (!t || !B) return null; const me = (window as any).__life?.ctx?.sim?.local?.pos; if (me && Math.hypot(me.x - t.x, me.z - t.z) < 30) { B.target = null; return null; } return t; },
};
