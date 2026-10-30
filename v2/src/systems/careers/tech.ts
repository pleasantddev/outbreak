// Tech bro life: Hub 32, a co-working space. Take a desk, open the gig board and do remote work for dollars:
// hunt the bug in a code snippet, type out a deploy under pressure, or survive a pitch meeting with a founder who is
// building "Uber for jollof". Pays in USD at the street rate; burns energy; trains the Hack skill.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from '../registry';
import type { Venue } from '../life/venue';
import type { Thing } from '../life/index';
import { lifeSystem } from '../life';
import { addMoodlet } from '../life/needs';
import { Builder, canvasTex, M, box, cyl } from '../leisure/build';
import { sfx } from '../leisure/sfx';
import { earn } from '../money';
import { career } from './ranks';

export const HUB_ORIGIN = new THREE.Vector3(36000, 0, 36000);

/** snippets with exactly one bug; `bug` is the 0-based line and `why` explains it */
const BUGS: { lang: string; lines: string[]; bug: number; why: string }[] = [
  { lang: 'ts', lines: ['function total(items: number[]) {', '  let sum = 0;', '  for (let i = 0; i <= items.length; i++) {', '    sum += items[i];', '  }', '  return sum;', '}'], bug: 2, why: 'Off by one: <= reads past the end and adds undefined.' },
  { lang: 'ts', lines: ['async function getUser(id: string) {', '  const res = fetch(`/api/users/${id}`);', '  if (!res.ok) throw new Error("failed");', '  return res.json();', '}'], bug: 1, why: 'Missing await: res is a Promise, so res.ok is undefined.' },
  { lang: 'py', lines: ['def average(xs):', '    if not xs:', '        return 0', '    total = sum(xs)', '    return total / len(xs) - 1'], bug: 4, why: 'The - 1 skews every average.' },
  { lang: 'ts', lines: ['const prices = { rice: 3200, beans: 2800 };', 'function priceOf(item: string) {', '  return prices.item ?? 0;', '}'], bug: 2, why: 'prices.item looks up a key literally named "item"; use prices[item].' },
  { lang: 'js', lines: ['button.addEventListener("click", () => {', '  count++;', '  label.textContent = count;', '});', 'let count = 0;', 'button.click();'], bug: 4, why: 'count is declared after it is used; let is in the temporal dead zone when the handler first fires.' },
  { lang: 'sql', lines: ['SELECT name, phone', 'FROM customers', 'WHERE city = "Lagos"', '  AND balance > 0', 'ORDER BY balance DESC', 'LIMIT -10;'], bug: 5, why: 'LIMIT cannot be negative.' },
  { lang: 'ts', lines: ['function isAdult(age: number) {', '  if (age = 18) return true;', '  return age > 18;', '}'], bug: 1, why: 'Assignment instead of comparison: = should be ===.' },
  { lang: 'py', lines: ['def greet(names=[]):', '    names.append("guest")', '    return ", ".join(names)', '', 'print(greet())', 'print(greet())'], bug: 0, why: 'Mutable default argument: the same list grows on every call.' },
  { lang: 'ts', lines: ['const users = await db.users.findMany();', 'for (const u of users) {', '  const orders = await db.orders.find({ userId: u.id });', '  u.orderCount = orders.length;', '}', 'return users;'], bug: 2, why: 'N+1 queries: one database call per user. Fetch the counts in one query.' },
  { lang: 'js', lines: ['const sorted = [10, 9, 100, 1].sort();', 'console.log(sorted[0]);', '// expected 1, then 9, 10, 100'], bug: 0, why: 'Default sort compares strings: "10" < "9". Pass (a, b) => a - b.' },
  { lang: 'ts', lines: ['function safeDivide(a: number, b: number) {', '  if (b === 0) return null;', '  return a / b;', '}', 'const share = safeDivide(profit, partners).toFixed(2);'], bug: 4, why: 'safeDivide can return null, and null.toFixed crashes.' },
  { lang: 'css', lines: ['.card {', '  display: flex;', '  justify-content: centre;', '  align-items: center;', '}'], bug: 2, why: 'CSS is American: center, not centre.' },
];
const DEPLOY = ['git pull --rebase', 'npm ci', 'npm run test', 'npm run build', 'git tag v2.4.1', 'git push origin main --tags', 'kubectl rollout restart deploy/api', 'curl -s https://status.example.com'];
const PITCH: { q: string; a: [string, number][] }[] = [
  { q: '"We are Uber for jollof. Think: rice, but on-demand." Thoughts?', a: [['Love it. Who is the customer and what do they pay today?', 2], ['This will change Africa.', 0], ['Jollof is already on-demand. It is called Mama Put.', 1]] },
  { q: '"Can we launch in two weeks? Investors are watching."', a: [['Two weeks for a demo, six for something people can rely on.', 2], ['Yes, no wahala.', -1], ['Only if we skip testing.', 0]] },
  { q: '"Should we build our own payment rails?"', a: [['No. Use an existing processor and focus on the product.', 2], ['Yes, blockchain.', -1], ['Maybe later, after product-market fit.', 1]] },
  { q: '"The app is slow on cheap Android phones."', a: [['Cut the bundle size, cache, and test on a real low-end phone.', 2], ['Tell users to buy iPhone.', -1], ['Add a loading animation.', 0]] },
  { q: '"Our burn rate is high but vibes are immaculate."', a: [['Vibes do not pay salaries. Let us cut the AWS bill first.', 2], ['Vibes are a moat.', -1], ['Raise another round.', 0]] },
];
const css = `
#tech{position:fixed;inset:0;z-index:10;display:none;align-items:center;justify-content:center;background:rgba(5,8,14,.6);font-family:Inter,sans-serif;color:#e6edf3}
#tech.on{display:flex} #tech .win{width:min(640px,95vw);border-radius:16px;overflow:hidden;background:#0d1117;border:1px solid #30363d;box-shadow:0 30px 80px rgba(0,0,0,.6)}
#tech .bar{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#161b22;border-bottom:1px solid #30363d;font:600 12px Inter} #tech .bar i{width:11px;height:11px;border-radius:50%;display:inline-block} #tech .bar b{margin-left:8px} #tech .bar .x{margin-left:auto;background:none;border:none;color:#8b949e;font:700 15px Inter;cursor:pointer}
#tech .bd{padding:16px} #tech h4{margin:0 0 4px;font-size:16px} #tech p{margin:0 0 12px;font-size:13px;color:#8b949e}
#tech .gigs{display:grid;gap:8px} #tech .gig{display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;background:#161b22;border:1px solid #30363d;cursor:pointer;text-align:left;color:#e6edf3;font-family:Inter} #tech .gig:hover{border-color:#58a6ff}
#tech .gig b{display:block;font-size:13.5px} #tech .gig span{font-size:12px;color:#8b949e} #tech .gig em{margin-left:auto;font-style:normal;font:700 15px Rajdhani,Inter;color:#3fb950}
#tech pre{margin:0;padding:10px 0;background:#0d1117;border:1px solid #30363d;border-radius:10px;font:13px/1.65 ui-monospace,Menlo,Consolas,monospace;counter-reset:ln}
#tech pre div{padding:0 12px;cursor:pointer;white-space:pre;overflow:hidden;text-overflow:ellipsis} #tech pre div:hover{background:#1f2937} #tech pre div::before{counter-increment:ln;content:counter(ln);display:inline-block;width:22px;color:#484f58;margin-right:10px;text-align:right}
#tech pre div.bad{background:rgba(248,81,73,.18)} #tech pre div.good{background:rgba(63,185,80,.18)}
#tech .term{background:#010409;border:1px solid #30363d;border-radius:10px;padding:12px;font:13px/1.7 ui-monospace,Menlo,Consolas,monospace;min-height:150px} #tech .term .ok{color:#3fb950} #tech .term .cur{color:#e6edf3} #tech .term .ghost{color:#484f58}
#tech input{width:100%;margin-top:10px;padding:10px 12px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;font:14px ui-monospace,Menlo,Consolas,monospace;outline:none} #tech input:focus{border-color:#58a6ff}
#tech .opts{display:grid;gap:8px} #tech .opts button{padding:11px 12px;border-radius:10px;border:1px solid #30363d;background:#161b22;color:#e6edf3;font:600 13px Inter;text-align:left;cursor:pointer} #tech .opts button:hover{border-color:#58a6ff}
#tech .res{margin-top:12px;font-size:13px} #tech .timer{float:right;font:700 14px Rajdhani,Inter;color:#d29922}
`;

class TechHub {
  venue: Venue; private el!: HTMLElement; private desks: { x: number; z: number; yaw: number }[] = []; private people: any[] = []; private rate = 1550; private done = 0;
  constructor(private ctx: GameCtx) {
    const B = new Builder(HUB_ORIGIN); const W = 9, D = 12;
    B.floor(-W, 0, W, D, M(0xffffff, 0.8, { map: canvasTex(256, 256, (x) => { x.fillStyle = '#b08d5b'; x.fillRect(0, 0, 256, 256); for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#a07f50' : '#bb9866'; x.fillRect(0, i * 16, 256, 15); } }, 4) }));
    B.room(-W, 0, W, D, M(0xf2f2ee, 0.9), { side: 's', at: W, w: 2 }); B.sign('HUB 32', 0, 2.6, D - 0.1, Math.PI, 4, '#58a6ff', 'rgba(0,0,0,0)');
    B.neon(-W + 0.08, 2.9, D / 2, 0.04, 0.04, 0x58a6ff);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) {
      const x = -6 + i * 3.4, z = 4 + r * 4; const desk = new THREE.Group(); desk.position.set(x, 0, z);
      desk.add(box(2.6, 0.05, 1.0, M(0xf5f5f5, 0.5), 0, 0.75, 0)); for (const sx of [-1.2, 1.2]) desk.add(box(0.05, 0.75, 0.9, M(0x333333, 0.4, { metalness: 0.6 }), sx, 0.37, 0));
      for (const side of [-0.6, 0.6]) { const lap = new THREE.Group(); lap.position.set(side, 0.78, 0.05); lap.add(box(0.36, 0.02, 0.25, M(0xb0b4b8, 0.3, { metalness: 0.7 }), 0, 0, 0)); const scr = box(0.36, 0.24, 0.015, new THREE.MeshBasicMaterial({ color: [0x58a6ff, 0x3fb950, 0xd2a8ff, 0xffa657][(i + r + (side > 0 ? 1 : 0)) % 4], toneMapped: false }), 0, 0.13, -0.12); scr.rotation.x = -0.25; lap.add(scr); desk.add(lap); }
      desk.add(cyl(0.05, 0.04, 0.12, M(0xffffff, 0.4), 1.0, 0.84, -0.2, 10));
      B.solid(desk, 2.6, 1.0, 0.8);
      for (const side of [-0.6, 0.6]) { const ch = new THREE.Group(); ch.position.set(x + side, 0, z + 0.8); ch.add(box(0.5, 0.08, 0.5, M(0x222831, 0.6), 0, 0.46, 0)); ch.add(box(0.5, 0.55, 0.06, M(0x222831, 0.6), 0, 0.78, 0.24)); ch.add(cyl(0.04, 0.04, 0.42, M(0x666, 0.3), 0, 0.22, 0, 6)); B.add(ch); this.desks.push({ x: x + side, z: z + 0.8, yaw: Math.PI }); }
    }
    // kitchen corner with a coffee machine, a ping pong table, bean bags
    B.solid(box(3, 0.95, 0.65, M(0x2d333b, 0.5), W - 1.6, 0.47, D - 0.5), 3, 0.65, 0.95); B.add(box(0.35, 0.45, 0.35, M(0x111111, 0.3, { metalness: 0.5 }), W - 1.0, 1.17, D - 0.5));
    const pp = new THREE.Group(); pp.position.set(5.5, 0, 2.3); pp.add(box(2.7, 0.05, 1.5, M(0x1565c0, 0.5), 0, 0.76, 0)); pp.add(box(0.02, 0.15, 1.5, M(0xffffff, 0.5), 0, 0.85, 0)); B.solid(pp, 2.7, 1.5, 0.8);
    for (const [x, z, c] of [[-7.5, 10.5, 0xff7043], [-6.2, 11, 0x26a69a], [-7.8, 9, 0xffca28]] as number[][]) { const bb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), M(c, 0.9)); bb.position.set(x, 0.32, z); bb.scale.set(1, 0.65, 1); B.add(bb); }
    for (const [x, z] of [[-4, 3], [3, 3], [-4, 9], [3, 9]]) { B.light(x, 2.8, z, 0xf4f8ff, 6, 9); B.add(box(1.4, 0.04, 0.2, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), x, 3.0, z)); }
    const lot = B.lot({ x: 0, z: 1.6, yaw: 0 }, [{ name: 'Hub', x0: -W, z0: 0, x1: W, z1: D }], 0xf2f2ee);
    this.venue = { id: 'hub', title: 'HUB 32', sub: 'Co-working · Wi-Fi that works (mostly)', lot, door: null, blip: '#58a6ff', label: 'Enter Hub 32 (day pass ₦3,000)', fee: 3000, cam: { d: 10, pitch: 0.95 }, things: () => this.things(), enter: () => this.enter(), exit: () => this.exit(), refuse: () => { const h = this.ctx.view.atmo.hour; return h < 7 || h >= 23 ? 'Hub 32 opens 7am till 11pm.' : null; } };
  }
  init() { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); this.el = document.createElement('div'); this.el.id = 'tech'; document.body.appendChild(this.el); (window as any).__hub = this; }
  get life() { return lifeSystem.api!; }
  private things(): Thing[] { const O = HUB_ORIGIN; return this.desks.map((d, i) => ({ id: 'desk' + i, name: 'Hot desk', x: O.x + d.x, z: O.z + d.z, yaw: d.yaw, actions: [], kind: 'object' as const, reach: 1.4, verb: 'Open the gig board', open: () => this.board() })); }
  private enter() { const c = this.ctx; const O = HUB_ORIGIN; this.people = []; const seats = [...this.desks].sort(() => Math.random() - 0.5).slice(0, 7); for (const d of seats) { const a = c.sim.spawnActor('ped', { x: O.x + d.x, y: 0.05, z: O.z + d.z }); a.yaw = d.yaw; Object.assign(a as any, { _script: true, _keep: true, act: { clip: 'Sitting_Idle_Loop', yaw: d.yaw } }); this.people.push(a); } this.rate = Math.round(1450 + Math.random() * 250); }
  private exit() { for (const a of this.people) if (!a._gone) this.ctx.sim.removeActor(a); this.people = []; this.close(); }
  private hack() { return ((this.ctx.systems.get('skills') as any)?.level?.('hack') ?? 1) as number; }
  private shell(title: string, body: string) { this.el.innerHTML = `<div class="win"><div class="bar"><i style="background:#ff5f56"></i><i style="background:#ffbd2e"></i><i style="background:#27c93f"></i><b>${title}</b><button class="x">✕</button></div><div class="bd">${body}</div></div>`; this.el.classList.add('on'); this.el.querySelector('.x')!.addEventListener('click', () => this.close()); }
  close() { if (!this.el.classList.contains('on')) return; this.el.classList.remove('on'); this.el.innerHTML = ''; this.ctx.setModal(false); (this.ctx.sim.local as any).act = undefined; }
  board() {
    const c = this.ctx; c.setModal(true); c.input.releasePointer(); const lvl = this.hack(); const usd = (b: number) => Math.round(b * (1 + lvl * 0.08));
    const gigs: [string, string, string, number, () => void][] = [
      ['bug', 'Bug bounty: find the broken line', 'Read the snippet, click the bug. 3 rounds.', usd(25), () => this.bugHunt(usd(25))],
      ['deploy', 'Night deploy for a fintech', 'Type the commands exactly, against the clock.', usd(35), () => this.deploy(usd(35))],
      ['pitch', 'Advisory call with a founder', 'Give advice that will not sink the company.', usd(50), () => this.pitch(usd(50))],
    ];
    this.shell('gigboard.dev', `<h4>Remote gigs</h4><p>Paid in dollars at today's rate, ₦${this.rate.toLocaleString()}/$. Hack level ${lvl}. Each gig costs energy.</p><div class="gigs">${gigs.map(([id, t, s, p]) => `<button class="gig" data-g="${id}"><div><b>${t}</b><span>${s}</span></div><em>$${p}</em></button>`).join('')}</div>`);
    this.el.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => gigs.find((g) => g[0] === (b as HTMLElement).dataset.g)![4]()));
    const me = c.sim.local; (me as any).act = { clip: 'Sitting_Idle_Loop', yaw: Math.PI };
  }
  private pay(usd: number, quality: number, what: string) {
    const c = this.ctx; const n = Math.round(usd * quality * this.rate * career.mult('tech') / 50) * 50; const L = this.life; career.add('tech');
    L.needs.v.energy = Math.max(0, L.needs.v.energy - 7); L.needs.v.fun = Math.min(100, L.needs.v.fun + (quality > 0.6 ? 8 : -4));
    if (n > 0) { earn(c, n, 'work'); sfx('cash'); }
    (c.systems.get('skills') as any)?.addXp?.('hack', Math.round(10 + quality * 30)); this.done++;
    if (quality >= 0.99) addMoodlet(L.needs, 'shipped', 'Shipped it', 8, 4); if (quality < 0.4) addMoodlet(L.needs, 'imposter', 'Imposter syndrome', -6, 3);
    if (this.done === 3) addMoodlet(L.needs, 'grind', 'Deep in the grind', 4, 3);
    return `<div class="res">${what} You earned <b style="color:#3fb950">₦${n.toLocaleString()}</b> ($${Math.round(usd * quality)}).</div><div class="gigs" style="margin-top:10px"><button class="gig" data-a="back"><b>Back to the gig board</b></button></div>`;
  }
  private wireBack() { this.el.querySelector('[data-a=back]')?.addEventListener('click', () => this.board()); }
  private bugHunt(usd: number) {
    const set = [...BUGS].sort(() => Math.random() - 0.5).slice(0, 3); let i = 0, right = 0; const t0 = performance.now();
    const show = (note = '') => {
      const b = set[i]; this.shell(`review.${b.lang}`, `<span class="timer" id="tt"></span><h4>Round ${i + 1} of 3</h4><p>${note || 'One line is wrong. Click it.'}</p><pre>${b.lines.map((l, k) => `<div data-l="${k}">${l.replace(/</g, '&lt;') || ' '}</div>`).join('')}</pre>`);
      this.el.querySelectorAll('[data-l]').forEach((d) => d.addEventListener('click', () => {
        const k = +(d as HTMLElement).dataset.l!; const ok = k === b.bug; if (ok) right++; d.classList.add(ok ? 'good' : 'bad'); if (!ok) this.el.querySelector(`[data-l="${b.bug}"]`)!.classList.add('good'); sfx(ok ? 'hit' : 'miss');
        (this.el.querySelector('p') as HTMLElement).innerHTML = `${ok ? '✅' : '❌'} ${b.why}`;
        setTimeout(() => { i++; if (i < set.length) show(); else { const secs = (performance.now() - t0) / 1000; const q = right / 3 * (secs < 40 ? 1.15 : 1); this.shell('payout', `<h4>${right}/3 bugs found in ${Math.round(secs)}s</h4>` + this.pay(usd, Math.min(1.15, q), right === 3 ? 'Clean sweep.' : right ? 'Partial bounty.' : 'The client is not impressed.')); this.wireBack(); } }, 1700);
      }, { once: true }));
    };
    show();
  }
  private deploy(usd: number) {
    const cmds = [...DEPLOY]; let k = 0; const limit = 50 + this.hack() * 3; const t0 = performance.now(); let typos = 0;
    const draw = () => { this.shell('bash · prod-deploy', `<span class="timer" id="tt">${limit}s</span><h4>Deploy the release</h4><p>Type each command exactly and press Enter.</p><div class="term">${cmds.map((c, i) => `<div class="${i < k ? 'ok' : i === k ? 'cur' : 'ghost'}">$ ${c}${i < k ? '  ✓' : ''}</div>`).join('')}</div><input id="ti" autocomplete="off" spellcheck="false" placeholder="${cmds[k] ?? ''}">`);
      const inp = this.el.querySelector('#ti') as HTMLInputElement; inp.focus();
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key !== 'Enter') return; if (inp.value.trim() === cmds[k]) { k++; sfx('hit'); if (k >= cmds.length) return finish(); draw(); } else { typos++; sfx('miss'); inp.value = ''; inp.placeholder = 'Typo. ' + cmds[k]; } });
    };
    const tick = setInterval(() => { const left = Math.max(0, limit - (performance.now() - t0) / 1000); const t = this.el.querySelector('#tt'); if (t) t.textContent = `${Math.ceil(left)}s`; if (left <= 0) finish(); }, 250);
    const finish = () => { clearInterval(tick); const q = (k / cmds.length) * Math.max(0.5, 1 - typos * 0.06); this.shell('payout', `<h4>${k === cmds.length ? 'Deployed. Nobody got paged.' : 'Deploy stalled at step ' + (k + 1)}</h4>` + this.pay(usd, q, typos ? `${typos} typo${typos > 1 ? 's' : ''}.` : 'Flawless.')); this.wireBack(); };
    draw();
  }
  private pitch(usd: number) {
    const qs = [...PITCH].sort(() => Math.random() - 0.5).slice(0, 3); let i = 0, score = 0;
    const show = () => { const q = qs[i]; const opts = [...q.a].sort(() => Math.random() - 0.5); this.shell('meet · founder sync', `<h4>Question ${i + 1} of 3</h4><p>${q.q}</p><div class="opts">${opts.map(([t], k) => `<button data-o="${k}">${t}</button>`).join('')}</div>`);
      this.el.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', () => { score += opts[+(b as HTMLElement).dataset.o!][1]; i++; if (i < qs.length) show(); else { const q = Math.max(0, score / 6); this.shell('payout', `<h4>${q > 0.8 ? 'The founder wants you on retainer.' : q > 0.4 ? 'Useful call, they said.' : 'They have stopped replying to your emails.'}</h4>` + this.pay(usd, q, '')); this.wireBack(); } })); };
    show();
  }
}

let H: TechHub | null = null;
export const techSystem: GameSystem = {
  id: 'tech',
  init(ctx) { H = new TechHub(ctx); H.init(); lifeSystem.api?.addVenue(H.venue); },
};
