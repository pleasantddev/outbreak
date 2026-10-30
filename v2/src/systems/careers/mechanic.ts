// Roadside mechanic. Workshops sit by the road near mechanic POIs: a tarp, a car on a jack, tools, Oga Mechanic.
// Work a shift: a customer describes the wahala in their own words, you diagnose it, choose genuine or fake parts,
// then do the job (tighten each bolt in the sweet spot). Fake parts pay more today and come back to bite you.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import type { Actor } from '../../sim/types';
import { lifeSystem, type Thing } from '../life';
import { addMoodlet } from '../life/needs';
import { halfWidth } from '../../world/roadspec';
import { M, box, cyl } from '../leisure/build';
import { sfx } from '../leisure/sfx';
import { earn, spend } from '../money';

interface Fault { id: string; label: string; symptoms: string[]; part: string; partCost: number; labour: number; bolts: number }
const FAULTS: Fault[] = [
  { id: 'brakes', label: 'Worn brake pads', symptoms: ['When I press brake e dey shout like goat. Kiiiii!', 'The brake dey vibrate, and the car no dey stop quick.'], part: 'brake pads', partCost: 9000, labour: 6000, bolts: 3 },
  { id: 'battery', label: 'Weak battery', symptoms: ['Every morning I must push am before e start.', 'If I off engine, e no go start again. Lights dey dim.'], part: 'battery', partCost: 38000, labour: 3000, bolts: 2 },
  { id: 'plugs', label: 'Bad spark plugs', symptoms: ['The engine dey jerk, e dey cough like old man.', 'E dey drink fuel anyhow, and e dey misfire for hill.'], part: 'spark plugs', partCost: 7000, labour: 5000, bolts: 4 },
  { id: 'radiator', label: 'Leaking radiator', symptoms: ['Smoke dey comot for bonnet after small traffic.', 'The temperature needle dey go red, and water dey drop under the car.'], part: 'radiator hose', partCost: 6500, labour: 7000, bolts: 3 },
  { id: 'tyre', label: 'Bad shock absorber', symptoms: ['Every pothole, the car dey bounce like trampoline.', 'E dey knock knock for front when road no smooth.'], part: 'shock absorber', partCost: 22000, labour: 9000, bolts: 4 },
  { id: 'belt', label: 'Worn fan belt', symptoms: ['E dey make squeaking noise when I start am.', 'The AC no dey cold and battery light dey blink.'], part: 'fan belt', partCost: 5000, labour: 4000, bolts: 2 },
  { id: 'oil', label: 'Overdue oil change', symptoms: ['The oil light don dey show since last month.', 'Engine dey make tick tick sound, e no smooth again.'], part: 'engine oil', partCost: 12000, labour: 3500, bolts: 1 },
];
const OWNERS = ['Mrs Adebayo', 'Pastor Emeka', 'Alhaji Bello', 'Chioma', 'Uncle Femi', 'Aunty Bisi', 'Mr Okafor', 'Kunle the Uber guy', 'Madam Ngozi'];
const css = `
#mech{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translate(-50%,20px);opacity:0;pointer-events:none;transition:.2s;z-index:9;width:min(540px,94vw);border-radius:22px;padding:16px 18px;background:rgba(18,16,12,.92);border:1px solid rgba(255,193,7,.25);backdrop-filter:blur(16px);font-family:Inter,sans-serif;color:#f3f5f8}
#mech.on{opacity:1;transform:translate(-50%,0);pointer-events:auto} #mech h4{margin:0 0 4px;font:800 18px Rajdhani,Inter;letter-spacing:1px;color:#ffc107} #mech p{margin:0 0 12px;font-size:13.5px;color:#e5e2da;line-height:1.45}
#mech .opts{display:grid;grid-template-columns:1fr 1fr;gap:8px} #mech button{padding:11px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;font:700 13px Inter;cursor:pointer;text-align:left} #mech button:hover{border-color:#ffc107}
#mech button i{display:block;font-style:normal;font-size:11px;color:#a8a29e;font-weight:600;margin-top:2px} #mech .dial{position:relative;height:28px;border-radius:14px;background:#0c0a09;border:1px solid #44403c;overflow:hidden;margin:10px 0}
#mech .zone{position:absolute;top:0;bottom:0;background:linear-gradient(90deg,#ca8a04,#facc15)} #mech .nd{position:absolute;top:-3px;bottom:-3px;width:4px;background:#fff;box-shadow:0 0 8px #fff} #mech .bolts{display:flex;gap:6px} #mech .bolts span{width:22px;height:22px;border-radius:50%;background:#44403c;border:2px solid #78716c} #mech .bolts span.ok{background:#16a34a;border-color:#4ade80} #mech .bolts span.bad{background:#b91c1c;border-color:#f87171}
`;
interface Shop { x: number; z: number; yaw: number; g: THREE.Group | null; oga: Actor | null; car: any }
const pick = <T>(l: T[]) => l[(Math.random() * l.length) | 0];

class Mechanic {
  shops: Shop[] = []; private el!: HTMLElement; private scanT = 1; private job: { f: Fault; owner: string; step: number; fake: boolean; good: number; shop: Shop; jobs: number; earned: number } | null = null; private dial: { t: number; z0: number; w: number; speed: number; raf: number } | null = null;
  comeback: { owner: string; t: number }[] = [];
  constructor(private ctx: GameCtx) {}
  get life() { return lifeSystem.api!; }
  init() { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); this.el = document.createElement('div'); this.el.id = 'mech'; document.body.appendChild(this.el); this.life.providers.push(() => this.things());
    addEventListener('keydown', (e) => { if (!this.job) return; if (this.dial && (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter')) { this.strike(); e.preventDefault(); e.stopPropagation(); } const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code); if (n >= 0) { (this.el.querySelectorAll('[data-i]')[n] as HTMLElement | undefined)?.click(); e.preventDefault(); e.stopPropagation(); } if (e.code === 'Escape') this.end(); }, true);
    (window as any).__mech = this; }
  private scan() {
    const c = this.ctx; const me = c.sim.local; if (this.life.inside) return;
    for (const r of c.store.regions.values()) for (const p of r.pois) {
      if (p.kind !== 12 || Math.abs(p.x - me.pos.x) > 200 || Math.abs(p.z - me.pos.z) > 200) continue; if (this.shops.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 60)) continue;
      let best: { x: number; z: number; yaw: number } | null = null, bd = 50;
      for (const rr of c.store.regions.values()) for (const rd of rr.roads) { if (rd.cls > 9 || rd.flags & 4) continue; for (let i = 0; i < rd.pts.length - 2; i += 2) { const ax = rd.pts[i], az = rd.pts[i + 1], bx = rd.pts[i + 2], bz = rd.pts[i + 3]; const L = Math.hypot(bx - ax, bz - az); if (L < 12) continue; const t = Math.max(0, Math.min(L, ((p.x - ax) * (bx - ax) + (p.z - az) * (bz - az)) / L)); const qx = ax + ((bx - ax) / L) * t, qz = az + ((bz - az) / L) * t; const d = Math.hypot(p.x - qx, p.z - qz); if (d < bd) { bd = d; const nx = -(bz - az) / L, nz = (bx - ax) / L; const s = (p.x - qx) * nx + (p.z - qz) * nz > 0 ? 1 : -1; const off = halfWidth(rd) + 4.5; best = { x: qx + nx * s * off, z: qz + nz * s * off, yaw: Math.atan2(-nx * s, -nz * s) }; } } }
      if (best) this.shops.push({ ...best, g: null, oga: null, car: null });
    }
  }
  private dress(s: Shop) {
    const g = new THREE.Group(); const tarp = new THREE.Mesh(new THREE.PlaneGeometry(7, 5), M(0x1565c0, 0.9, { side: THREE.DoubleSide })); tarp.rotation.x = -Math.PI / 2 + 0.08; tarp.position.y = 2.9; g.add(tarp);
    for (const [x, z] of [[-3.4, -2.4], [3.4, -2.4], [-3.4, 2.4], [3.4, 2.4]]) g.add(cyl(0.05, 0.05, 2.9 + (z > 0 ? -0.2 : 0.2), M(0x6d4c41, 0.8), x, 1.45, z, 6));
    const bench = box(2.2, 0.08, 0.7, M(0x5d4037, 0.8), -2.3, 0.85, -1.7); g.add(bench); for (let i = 0; i < 6; i++) g.add(box(0.25, 0.06, 0.06, M(0x9e9e9e, 0.3, { metalness: 0.8 }), -3 + i * 0.28, 0.92, -1.7));
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.12, 8, 16), M(0x111111, 0.9)); t.rotation.x = Math.PI / 2; t.position.set(2.6, 0.12 + i * 0.24, -1.8); g.add(t); }
    g.add(cyl(0.3, 0.3, 0.9, M(0xb71c1c, 0.6), 3.0, 0.45, 1.6, 12)); // oil drum
    const sign = (() => { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const k = cv.getContext('2d')!; k.fillStyle = '#ffc107'; k.fillRect(0, 0, 512, 128); k.fillStyle = '#111'; k.font = '900 46px Inter'; k.textAlign = 'center'; k.fillText('GOD DEY AUTO REPAIRS', 256, 80); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide })); })(); sign.position.set(0, 2.5, 2.5); g.add(sign);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(s.x, 0, s.z); g.rotation.y = s.yaw; this.ctx.view.scene.add(g); s.g = g;
  }
  frame(dt: number) {
    const c = this.ctx; const me = c.sim.local; this.scanT -= dt; if (this.scanT <= 0) { this.scanT = 4; this.scan(); }
    for (const s of this.shops) {
      const d = Math.hypot(s.x - me.pos.x, s.z - me.pos.z);
      if (d < 140 && !s.g) this.dress(s); if (s.g) s.g.visible = d < 160 && !this.life.inside;
      const h = c.view.atmo.hour; const open = h >= 7 && h < 19;
      if (open && d < 60 && !this.life.inside && (!s.oga || (s.oga as any)._gone)) { const a = c.sim.spawnActor('vendor', { x: s.x - Math.sin(s.yaw) * 1.5, y: 0.05, z: s.z - Math.cos(s.yaw) * 1.5 }, undefined, 'Oga Mechanic'); Object.assign(a as any, { _script: true, _keep: true, _vendor: true, act: { clip: 'Fixing_Kneeling', yaw: s.yaw + 1.2 } }); s.oga = a; }
      if ((!open || d > 100) && s.oga && !(s.oga as any)._gone && this.job?.shop !== s) { c.sim.removeActor(s.oga); s.oga = null; }
    }
    // a customer you sold fake parts to comes back angry
    for (const cb of [...this.comeback]) { cb.t -= dt; if (cb.t <= 0) { this.comeback.splice(this.comeback.indexOf(cb), 1); c.hud.toast(cb.owner, 'Call: "The part you put for my car don spoil! I dey come your shop. You go refund me!"', 'var(--red)', 'msg', 6); c.sim.cash = Math.max(0, c.sim.cash - 8000); addMoodlet(this.life.needs, 'caught', 'Customer caught the fake part', -8, 6); } }
  }
  private things(): Thing[] { return this.shops.filter((s) => s.g && s.oga).map((s) => ({ id: 'mech', name: 'God Dey Auto Repairs', x: s.x, z: s.z, yaw: s.yaw, actions: [], kind: 'object' as const, reach: 4, verb: 'Work a shift at the workshop', open: () => this.begin(s) })); }
  private begin(s: Shop) { const c = this.ctx; c.setModal(true); this.job = { f: pick(FAULTS), owner: pick(OWNERS), step: 0, fake: false, good: 0, shop: s, jobs: 0, earned: 0 }; c.hud.say('Oga Mechanic', 'My apprentice! Customer dey wait. Make we see wetin you sabi.', 3); (c.sim.local as any).act = { clip: 'Fixing_Kneeling', yaw: s.yaw }; this.diagnose(); }
  private diagnose() {
    const j = this.job!; const opts = [j.f, ...FAULTS.filter((f) => f !== j.f).sort(() => Math.random() - 0.5).slice(0, 3)].sort(() => Math.random() - 0.5);
    this.el.innerHTML = `<h4>${j.owner.toUpperCase()}</h4><p>"${pick(j.f.symptoms)}"</p><div class="opts">${opts.map((f, i) => `<button data-i="${i}">${f.label}<i>${i + 1}</i></button>`).join('')}</div>`; this.el.classList.add('on');
    this.el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { const f = opts[+(b as HTMLElement).dataset.i!]; if (f === j.f) { sfx('hit'); this.parts(); } else { sfx('miss'); this.ctx.hud.say('Oga Mechanic', `${f.label}? Na wetin you dey learn? Listen to the customer well.`, 3.5); j.good -= 1; this.parts(); } }));
  }
  private parts() {
    const j = this.job!; const genuine = j.f.partCost, fake = Math.round(j.f.partCost * 0.35 / 50) * 50;
    this.el.innerHTML = `<h4>PARTS · ${j.f.part.toUpperCase()}</h4><p>Customer pays ₦${(genuine + j.f.labour).toLocaleString()} for parts and labour. You buy the part. The fake one is cheaper, but customers come back when they spoil.</p><div class="opts"><button data-i="0">Genuine part<i>₦${genuine.toLocaleString()} · 1</i></button><button data-i="1">"Tokunbo" (fake) part<i>₦${fake.toLocaleString()} · 2</i></button></div>`;
    this.el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { j.fake = (b as HTMLElement).dataset.i === '1'; this.bolts(); }));
  }
  private bolts() {
    const j = this.job!; let done = 0; const res: boolean[] = []; const lvl = ((this.ctx.systems.get('skills') as any)?.level?.('mech') ?? 1) as number;
    const next = () => {
      if (done >= j.f.bolts) return this.payout(res);
      const w = Math.min(0.3, 0.12 + lvl * 0.015); const z0 = 0.1 + Math.random() * (0.8 - w);
      this.el.innerHTML = `<h4>FIX IT · ${j.f.part.toUpperCase()}</h4><p>Tighten each one in the yellow. Space, E or tap.</p><div class="bolts">${Array.from({ length: j.f.bolts }, (_, i) => `<span class="${i < res.length ? (res[i] ? 'ok' : 'bad') : ''}"></span>`).join('')}</div><div class="dial" id="md"><div class="zone" style="left:${z0 * 100}%;width:${w * 100}%"></div><div class="nd" id="mn"></div></div>`;
      this.el.querySelector('#md')!.addEventListener('pointerdown', () => this.strike());
      this.dial = { t: 0, z0, w, speed: 1.2 + done * 0.25, raf: 0 }; const loop = () => { const d = this.dial; if (!d) return; d.t += 1 / 60 * d.speed; const x = (Math.sin(d.t * 2.6 - Math.PI / 2) + 1) / 2; const n = this.el.querySelector('#mn') as HTMLElement | null; if (n) n.style.left = `calc(${x * 100}% - 2px)`; d.raf = requestAnimationFrame(loop); }; loop();
      (this as any)._hit = (ok: boolean) => { res.push(ok); done++; sfx(ok ? 'hit' : 'miss'); next(); };
    };
    next();
  }
  private strike() { const d = this.dial; if (!d) return; cancelAnimationFrame(d.raf); this.dial = null; const x = (Math.sin(d.t * 2.6 - Math.PI / 2) + 1) / 2; (this as any)._hit(x >= d.z0 && x <= d.z0 + d.w); }
  private payout(res: boolean[]) {
    const c = this.ctx; const j = this.job!; const q = res.filter(Boolean).length / res.length + j.good * 0.3; const bill = j.f.partCost + j.f.labour; const cost = j.fake ? Math.round(j.f.partCost * 0.35 / 50) * 50 : j.f.partCost;
    const paid = q < 0.4 ? Math.round(bill * 0.5) : bill; const share = Math.round((paid - cost) * 0.6 / 50) * 50; // Oga takes his cut
    if (share > 0) earn(c, share, 'work'); else spend(c, -share); sfx(share > 0 ? 'cash' : 'lose'); j.jobs++; j.earned += share;
    (c.systems.get('skills') as any)?.addXp?.('mech', Math.round(12 + q * 25)); if (j.fake && Math.random() < 0.45) this.comeback.push({ owner: j.owner, t: 90 + Math.random() * 240 });
    this.life.needs.v.energy = Math.max(0, this.life.needs.v.energy - 6); this.life.needs.v.hygiene = Math.max(0, this.life.needs.v.hygiene - 8);
    this.el.innerHTML = `<h4>${q >= 0.99 ? 'NEAT JOB' : q >= 0.5 ? 'E GO DO' : 'OGA IS NOT HAPPY'}</h4><p>${j.owner} paid ₦${paid.toLocaleString()}. After the part and Oga's cut, you keep <b style="color:#facc15">₦${share.toLocaleString()}</b>.${j.fake ? ' You used a fake part. Pray it holds.' : ''}</p><div class="opts"><button data-i="0">Next customer<i>1</i></button><button data-i="1">Close for today<i>2 · ${j.jobs} jobs, ₦${j.earned.toLocaleString()}</i></button></div>`;
    this.el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { if ((b as HTMLElement).dataset.i === '0') { j.f = pick(FAULTS); j.owner = pick(OWNERS); j.good = 0; j.fake = false; this.diagnose(); } else this.end(); }));
  }
  end() { if (!this.job) return; if (this.dial) cancelAnimationFrame(this.dial.raf); this.dial = null; this.job = null; this.el.classList.remove('on'); this.ctx.setModal(false); (this.ctx.sim.local as any).act = undefined; addMoodlet(this.life.needs, 'worked', 'Honest day of work', 3, 3); }
  blips(out: { x: number; z: number; c: string; r?: number }[]) { for (const s of this.shops) if (s.g) out.push({ x: s.x, z: s.z, c: '#ffc107', r: 5 }); }
}
let K: Mechanic | null = null;
export const mechanicSystem: GameSystem = { id: 'mechanic', init(ctx) { K = new Mechanic(ctx); K.init(); }, frame(_c, dt) { K?.frame(dt); }, blips(_c, out) { K?.blips(out); } };
