// NIN at the Local Government secretariats: queue, form, passport photo, fingerprints, an issued card in the phone Wallet.
// The same desk registers your cars to your name (needs the NIN and proof of purchase or papers).
import type { GameCtx, GameSystem } from './registry';
import { Overlay, h, fmt, spend, say, toast, fee, stateOf, hash32, rng32, loadShops, uses, bus, shopItems } from './featureKit';
import { initSites, siteHooks, type ResolvedSite } from './featureSites';
import { fleet, kindName, type OwnedCar } from './garageFleet';
import { lgaCode, stdPlate, STD_RE } from './garagePlates';
import { registerApp } from '../ui/lifeHud';

export interface Nin { number: string; name: string; dob: string; gender: string; state: string; lga: string; phone: string; address: string; photo: string; issued: number; office: string }
interface IdState { nin: Nin | null }
let st: IdState;

const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const hasNin = () => !!st?.nin;
export const getNin = () => st?.nin ?? null;

/** Eleven digits, stable for a person and different per person. */
function makeNumber(name: string, dob: string, lga: string) {
  const r = rng32(hash32(name + dob + lga)); let s = String(1 + Math.floor(r() * 9)); for (let i = 0; i < 10; i++) s += Math.floor(r() * 10); return s;
}
export const spaced = (n: string) => `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;

// ------------------------------------------------------------------------------------------------ the card
export function drawCard(n: Nin, w = 800): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * 0.63); const g = c.getContext('2d')!; const k = w / 800;
  g.scale(k, k); const W = 800, H = 504;
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0b7a47'); bg.addColorStop(0.55, '#e9f5ec'); bg.addColorStop(1, '#0b7a47');
  g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, W, H, 34); g.fill();
  // guilloche
  g.save(); g.beginPath(); g.roundRect(0, 0, W, H, 34); g.clip(); g.strokeStyle = 'rgba(10,122,69,.18)'; g.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) { g.beginPath(); for (let x = 0; x <= W; x += 8) { const y = 250 + Math.sin(x * 0.02 + i * 0.5) * (40 + i * 6) + Math.cos(x * 0.045 - i) * 14; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  g.restore();
  g.fillStyle = '#064d2b'; g.fillRect(0, 0, W, 78);
  g.fillStyle = '#fff'; g.font = '700 25px Oswald, "Arial Narrow", sans-serif'; g.textBaseline = 'middle'; g.fillText('FEDERAL REPUBLIC OF NIGERIA', 106, 28);
  g.font = '600 18px Oswald, "Arial Narrow", sans-serif'; g.fillStyle = '#bfeed3'; g.fillText('NATIONAL IDENTITY CARD · HUSTLE LIFE', 106, 56);
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(54, 14); g.lineTo(84, 24); g.lineTo(84, 46); g.quadraticCurveTo(84, 62, 54, 70); g.quadraticCurveTo(24, 62, 24, 46); g.lineTo(24, 24); g.closePath(); g.fill();
  g.fillStyle = '#0b7a47'; g.fillRect(24, 36, 60, 8); g.fillStyle = '#fff'; g.fillRect(24, 44, 60, 6); g.fillStyle = '#0b7a47'; g.fillRect(24, 50, 60, 8);
  const img = new Image(); img.src = n.photo; const drawPhoto = () => { g.save(); g.beginPath(); g.roundRect(36, 110, 214, 268, 14); g.clip(); g.fillStyle = '#cfd8d3'; g.fillRect(36, 110, 214, 268); if (img.complete && img.naturalWidth) g.drawImage(img, 36, 110, 214, 268); g.restore(); g.strokeStyle = '#064d2b'; g.lineWidth = 4; g.beginPath(); g.roundRect(36, 110, 214, 268, 14); g.stroke(); };
  drawPhoto(); img.onload = drawPhoto;
  const fld = (lab: string, val: string, x: number, y: number, big = false) => { g.fillStyle = '#4b5a52'; g.font = '600 14px Inter, sans-serif'; g.fillText(lab.toUpperCase(), x, y); g.fillStyle = '#0c1a13'; g.font = `700 ${big ? 26 : 22}px Oswald, "Arial Narrow", sans-serif`; g.fillText(val, x, y + 26); };
  fld('Surname / Name', n.name.toUpperCase(), 276, 120, true); fld('Date of birth', n.dob, 276, 182); fld('Sex', n.gender, 470, 182); fld('State of origin', n.state, 276, 242); fld('LGA of enrolment', n.lga, 276, 302);
  g.fillStyle = '#4b5a52'; g.font = '600 14px Inter, sans-serif'; g.fillText('NIN', 36, 410);
  g.fillStyle = '#064d2b'; g.font = '700 46px Rajdhani, Oswald, sans-serif'; g.fillText(spaced(n.number), 36, 446);
  // a made-up matrix code, seeded by the number
  const r = rng32(hash32(n.number)); const qx = 640, qy = 316, qs = 112; g.fillStyle = '#fff'; g.fillRect(qx - 6, qy - 6, qs + 12, qs + 12); g.fillStyle = '#0c1a13';
  for (let i = 0; i < 21; i++) for (let j = 0; j < 21; j++) { const eye = (i < 7 && j < 7) || (i > 13 && j < 7) || (i < 7 && j > 13); if (eye ? (i % 6 === 0 || j % 6 === 0 || (i % 6 > 1 && i % 6 < 5 && j % 6 > 1 && j % 6 < 5 && (i < 7 || i > 13) ) ) : r() < 0.48) g.fillRect(qx + (i * qs) / 21, qy + (j * qs) / 21, qs / 21 + 0.6, qs / 21 + 0.6); }
  g.fillStyle = '#4b5a52'; g.font = '600 13px Inter, sans-serif'; g.fillText('Issued ' + new Date(n.issued).toLocaleDateString('en-NG'), 560, 470);
  return c;
}

// ------------------------------------------------------------------------------------------------ passport photo
let shotReq: ((url: string) => void) | null = null; let shotWait = 0; let shotCrop = { cx: 0.5, cy: 0.5 };
function takeShot(ctx: GameCtx): Promise<string> {
  return new Promise((res) => { shotWait = 4; shotReq = res; void ctx; });
}
function poseCam(ctx: GameCtx, pose: number) {
  const me = ctx.sim.local; const yaw = me.yaw + (pose === 1 ? 0.5 : pose === 2 ? -0.5 : 0);
  const fx = Math.sin(yaw), fz = Math.cos(yaw); const d = 1.05;
  ctx.view.debugCam = { x: me.pos.x + fx * d, y: me.pos.y + 1.62, z: me.pos.z + fz * d, tx: me.pos.x, ty: me.pos.y + 1.6, tz: me.pos.z, fov: 40 };
}
function grabFace(ctx: GameCtx): string {
  const cv = ctx.view.renderer.domElement; const W = cv.width, H = cv.height; const ch = H * 0.82, cw = ch * 0.8;
  const out = document.createElement('canvas'); out.width = 240; out.height = 300; const g = out.getContext('2d')!;
  g.fillStyle = '#cfd8d3'; g.fillRect(0, 0, 240, 300);
  g.drawImage(cv, W * shotCrop.cx - cw / 2, H * shotCrop.cy - ch / 2, cw, ch, 0, 0, 240, 300);
  return out.toDataURL('image/jpeg', 0.85);
}

// ------------------------------------------------------------------------------------------------ the LGA desk
function openDesk(ctx: GameCtx, s: ResolvedSite) {
  const lga = s.def.lga ?? 'Lagos';
  const ov = new Overlay(ctx, { title: `${lga} Local Government`, sub: 'NIN enrolment · vehicle registry · licences', icon: 'id', width: 680 }).open();
  let tab: 'nin' | 'veh' = 'nin';
  const draw = () => {
    ov.body.innerHTML = '';
    const tabs = h('div', { class: 'fk-tabs', style: 'margin-bottom:12px' },
      h('button', { class: 'fk-tab' + (tab === 'nin' ? ' on' : ''), text: 'National ID (NIN)', onclick: () => { tab = 'nin'; draw(); } }),
      h('button', { class: 'fk-tab' + (tab === 'veh' ? ' on' : ''), text: 'Vehicle registry', onclick: () => { tab = 'veh'; draw(); } }));
    ov.body.append(tabs);
    if (tab === 'nin') ninTab(ctx, ov, s, draw); else vehTab(ctx, ov, s, draw);
  };
  draw();
}

function ninTab(ctx: GameCtx, ov: Overlay, s: ResolvedSite, redraw: () => void) {
  const n = st.nin;
  if (n) {
    ov.body.append(h('div', { class: 'fk-sec', text: 'Your card' }), h('div', { style: 'text-align:center' }, Object.assign(drawCard(n, 560), { style: 'max-width:100%;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.5)' })),
      h('p', { style: 'color:var(--mut);font-size:13px;line-height:1.5;text-align:center', text: 'It is also in the Wallet app on your phone. Show it where people ask.' }));
    return;
  }
  ov.body.append(
    h('div', { class: 'fk-sec', text: 'No NIN yet' }),
    h('p', { style: 'font-size:14px;line-height:1.55;color:#dfe4ee;margin:0 0 12px', text: 'Without a NIN you cannot register a car, report it stolen, or do much of anything official in Lagos. Enrolment takes a queue ticket, a form, a passport photo and your ten fingers.' }),
    h('div', { class: 'fk-row', style: 'flex-wrap:wrap' }, h('span', { class: 'fk-chip y', text: 'Fee ' + fmt(fee('nin', 500)) }), h('span', { class: 'fk-chip', text: 'Queue: free, slow' })),
    h('div', { style: 'margin-top:16px' }, h('button', { class: 'fk-btn green', text: 'Take a ticket', onclick: () => { ov.close(); enrol(ctx, s); } })));
}

function vehTab(ctx: GameCtx, ov: Overlay, s: ResolvedSite, redraw: () => void) {
  const me = ctx.sim.local; const mine = me.vehicle !== null ? ctx.sim.vehicles[me.vehicle] : null;
  const near = fleet.cars.filter((c) => { const p = fleet.posOf(c); return c.status === 'ok' && (Math.hypot(p.x - s.x, p.z - s.z) < 90 || fleet.vehicleOf(c) === mine); });
  const code = lgaCode(s.def.lga ?? '');
  ov.body.append(h('div', { class: 'fk-sec', text: 'Register a car to your name' }));
  if (!near.length) { ov.body.append(h('p', { style: 'color:var(--mut);font-size:14px;line-height:1.5', text: 'No car of yours is within reach of this desk. Drive it here (a car you only jacked is not yours until it has papers: buy a car at a mechanic village car mart or get papers from the mechanic).' })); }
  for (const c of near) {
    const proof = c.receipt ? 'receipt' : c.papers ? 'papers' : null; const price = fleet.priceReg();
    const why = !st.nin ? 'Needs a NIN first' : c.reg ? '' : !proof ? 'No proof of purchase. Buy papers from a mechanic.' : '';
    const card = h('div', { class: 'fk-tile', style: 'cursor:default;margin-bottom:10px' },
      h('div', { class: 'fk-row' }, h('b', { text: `${c.name}  ·  ${c.plate}` }), h('div', { style: 'flex:1' }),
        h('span', { class: 'fk-chip ' + (c.reg ? 'g' : 'y'), text: c.reg ? 'Registered' : 'Not registered' })),
      h('span', { text: c.reg ? `Registered to NIN ${spaced(c.reg.nin)} at ${c.reg.lga}. Papers: ${c.reg.docs === 'receipt' ? 'receipt' : 'mechanic papers'}.` : `Proof: ${proof === 'receipt' ? 'receipt from the car mart' : proof === 'papers' ? 'mechanic papers' : 'none'}. Fee ${fmt(price)}${code ? `. Plate becomes ${code} xxx xx.` : ''}` }),
      c.reg ? null : h('div', { class: 'fk-row', style: 'margin-top:6px' }, h('button', { class: 'fk-btn sm green', text: 'Register  ' + fmt(price), disabled: !!why, onclick: () => {
        if (!spend(ctx, price, 'registration')) return;
        if (!c.custom && code && !c.plate.startsWith(code)) { const p = stdPlate(c.seed * 17 + 3, code); fleet.setPlate(c, p, false); }
        fleet.register(c, st.nin!.number, s.def.lga ?? 'Lagos', proof as 'receipt' | 'papers');
        toast(ctx, 'Registered', `${c.plate} is now in your name. You can report it stolen from your phone.`, 'ok'); redraw();
      } }), why ? h('span', { class: 'fk-chip r', text: why }) : null));
    ov.body.append(card);
  }
}

// ------------------------------------------------------------------------------------------------ enrolment wizard
function enrol(ctx: GameCtx, s: ResolvedSite) {
  const lga = s.def.lga ?? 'Lagos'; const prof = ctx.profile;
  const data = { name: (prof?.name ?? 'You').replace(/_/g, ' '), day: 12, month: 4, year: 1999, gender: 'Male', state: 'Lagos', phone: '', address: '', photo: '', pose: 0 };
  let step = 0; let skipped = false; let paid = false;
  const ov = new Overlay(ctx, { title: 'NIN enrolment', sub: `${lga} LGA`, icon: 'id', width: 600, closable: true, onClose: () => { ctx.view.debugCam = null; clearInterval(timer); } });
  ov.open(); let timer = 0 as any;
  const steps = ['Queue', 'Form', 'Photo', 'Fingers', 'Card'];
  const stepper = () => h('div', { class: 'fk-row', style: 'margin-bottom:14px;gap:6px' }, ...steps.map((t, i) => h('span', { class: 'fk-chip ' + (i === step ? 'g' : i < step ? 'p' : ''), text: `${i + 1} ${t}` })));
  const view = () => { ov.body.innerHTML = ''; ov.foot.innerHTML = ''; ov.foot.style.display = 'none'; ov.body.append(stepper()); [queue, form, photo, prints, issue][step](); };
  const queue = () => {
    const mine = 30 + Math.floor(Math.random() * 40); let serving = mine - 8 - Math.floor(Math.random() * 6);
    const bar = h('div', { class: 'fk-bar' }, h('i', { style: 'width:0%' })); const txt = h('b', { style: 'font-size:22px;font-family:Rajdhani,sans-serif', text: '' });
    const upd = () => { txt.textContent = `Now serving ${serving}  ·  your ticket ${mine}`; (bar.firstChild as HTMLElement).style.width = Math.min(100, (100 * (serving - (mine - 14))) / 14) + '%'; };
    upd();
    const go = () => { clearInterval(timer); step = 1; view(); };
    timer = setInterval(() => { serving++; upd(); if (serving >= mine) go(); }, 650);
    const skip = h('button', { class: 'fk-btn ghost', text: `Give the officer "small something"  ${fmt(fee('nin-skip', 3500))}`, onclick: () => {
      if (!spend(ctx, fee('nin-skip', 3500), 'the officer')) return; skipped = true;
      if (Math.random() < 0.25) { say('Officer: "Ehn, that one na for the table. The chair is extra." Another ' + fmt(2000), 3); if (!spend(ctx, 2000, 'the chair')) { skipped = false; return; } }
      go();
    } });
    ov.body.append(h('div', { class: 'fk-sec', text: 'Queue' }), h('div', { style: 'text-align:center;padding:14px 0' }, txt), bar,
      h('p', { style: 'color:var(--mut);font-size:13px;line-height:1.5;margin-top:14px', text: 'The officer calls numbers when he feels like it. You can wait, or you can make the file find its way to the top.' }), h('div', { style: 'margin-top:8px' }, skip));
  };
  const form = () => {
    const err = h('div', { style: 'color:#ffb0b8;font-size:13px;min-height:18px;margin-top:8px' });
    const inp = (label: string, key: 'name' | 'phone' | 'address', ph = '', mode = 'text') => h('label', { class: 'fk-field' }, label, Object.assign(h('input', { class: 'fk-in', value: (data as any)[key], placeholder: ph, inputmode: mode, autocomplete: 'off', oninput: (e: Event) => ((data as any)[key] = (e.target as HTMLInputElement).value) })));
    const sel = (label: string, opts: (string | number)[], key: 'day' | 'month' | 'year' | 'gender' | 'state', lab?: (v: any, i: number) => string) => h('label', { class: 'fk-field' }, label, h('select', { class: 'fk-in', onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; (data as any)[key] = typeof (data as any)[key] === 'number' ? +v : v; } }, ...opts.map((o, i) => h('option', { value: String(o), selected: String((data as any)[key]) === String(o) ? true : undefined, text: lab ? lab(o, i) : String(o) }))));
    ov.body.append(h('div', { class: 'fk-sec', text: 'Enrolment form' }),
      h('div', { class: 'fk-grid', style: 'grid-template-columns:1fr 1fr' },
        h('div', { style: 'grid-column:1/3' }, inp('Full name', 'name', 'As on your documents')),
        sel('Day', Array.from({ length: 31 }, (_, i) => i + 1), 'day'), sel('Month', Array.from({ length: 12 }, (_, i) => i + 1), 'month', (v) => MONTHS[v - 1]),
        sel('Year', Array.from({ length: 70 }, (_, i) => 2008 - i), 'year'), sel('Sex', ['Male', 'Female'], 'gender'),
        sel('State of origin', STATES, 'state'), inp('Phone', 'phone', '0803 000 0000', 'tel'),
        h('div', { style: 'grid-column:1/3' }, inp('Home address', 'address', 'House number and street'))), err,
      h('div', { style: 'margin-top:12px' }, h('button', { class: 'fk-btn', text: 'Next: photo', onclick: () => {
        const nm = data.name.trim().replace(/\s+/g, ' ');
        if (nm.length < 3 || !/^[\p{L} .'-]+$/u.test(nm)) return void (err.textContent = 'Put your real name, letters only.');
        if (!/^0[789][01]\d{8}$/.test(data.phone.replace(/\s|-/g, ''))) return void (err.textContent = 'Phone must be an 11 digit Nigerian number, like 08031234567.');
        if (data.address.trim().length < 6) return void (err.textContent = 'Address is too short, oga.');
        data.name = nm; step = 2; view();
      } })));
  };
  const photo = () => {
    ov.root.classList.add('clear'); ov.card.style.cssText += ';position:absolute;right:max(14px,env(safe-area-inset-right));top:50%;transform:translateY(-50%);width:min(380px,calc(100vw - 28px))';
    ctx.view.debugCam = null; poseCam(ctx, data.pose);
    const prev = h('div', { style: 'text-align:center;margin:8px 0' }); const show = () => { prev.innerHTML = ''; if (data.photo) prev.append(Object.assign(new Image(), { src: data.photo, style: 'width:150px;height:187px;border-radius:12px;border:2px solid var(--teal);object-fit:cover' })); else prev.append(h('div', { style: 'height:187px;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:13px', text: 'Look at the camera' })); }; show();
    const pose = (i: number, t: string) => h('button', { class: 'fk-tab' + (data.pose === i ? ' on' : ''), text: t, onclick: () => { data.pose = i; poseCam(ctx, i); view(); } });
    ov.body.append(h('div', { class: 'fk-sec', text: 'Passport photo' }), h('div', { class: 'fk-tabs' }, pose(0, 'Straight'), pose(1, 'Turn left'), pose(2, 'Turn right')), prev,
      h('div', { class: 'fk-row' }, h('button', { class: 'fk-btn', text: data.photo ? 'Retake' : 'Capture', onclick: async () => { const fl = h('div', { style: 'position:fixed;inset:0;background:#fff;z-index:70;opacity:.9;transition:opacity .4s;pointer-events:none' }); document.body.append(fl); setTimeout(() => (fl.style.opacity = '0'), 60); setTimeout(() => fl.remove(), 500); data.photo = await takeShot(ctx); show(); view(); } }),
        data.photo ? h('button', { class: 'fk-btn green', text: 'Next: fingers', onclick: () => { ctx.view.debugCam = null; ov.root.classList.remove('clear'); ov.card.style.cssText = ov.card.style.cssText.replace(/;position:absolute.*$/, ''); step = 3; view(); } }) : null));
  };
  const prints = () => {
    const done = new Set<number>(); const names = ['L5', 'L4', 'L3', 'L2', 'L1', 'R1', 'R2', 'R3', 'R4', 'R5'];
    const grid = h('div', { class: 'fk-grid', style: 'grid-template-columns:repeat(5,1fr)' });
    const next = h('button', { class: 'fk-btn green', text: 'Next: pay and print', disabled: true, onclick: () => { step = 4; view(); } });
    names.forEach((n, i) => { const b = h('button', { class: 'fk-tile', style: 'align-items:center;padding:14px 4px;text-align:center', onclick: () => { if (done.has(i)) return; b.style.opacity = '.6'; b.querySelector('span')!.textContent = 'scanning'; setTimeout(() => { done.add(i); b.classList.add('on'); b.querySelector('span')!.textContent = 'done'; b.style.opacity = '1'; if (done.size === 10) next.removeAttribute('disabled'); }, 350); } }, h('b', { text: n }), h('span', { text: 'tap' })); grid.append(b); });
    ov.body.append(h('div', { class: 'fk-sec', text: 'Fingerprints' }), h('p', { style: 'color:var(--mut);font-size:13px', text: 'Press each finger on the glass until it says done.' }), grid, h('div', { class: 'fk-row', style: 'margin-top:12px' }, h('button', { class: 'fk-btn ghost', text: 'Scan all', onclick: () => { names.forEach((_, i) => (grid.children[i] as HTMLElement).click()); } }), next));
  };
  const issue = () => {
    const price = fee('nin', 500);
    ov.body.append(h('div', { class: 'fk-sec', text: 'Pay and collect' }), h('p', { style: 'font-size:14px;line-height:1.5', text: `Enrolment fee ${fmt(price)}${skipped ? '. Queue skipped.' : ''}` }),
      h('button', { class: 'fk-btn green', text: 'Pay ' + fmt(price), onclick: () => {
        if (paid || !spend(ctx, price, 'NIN enrolment')) return; paid = true;
        const dob = `${String(data.day).padStart(2, '0')} ${MONTHS[data.month - 1]} ${data.year}`;
        const nin: Nin = { number: makeNumber(data.name, dob, lga), name: data.name, dob, gender: data.gender === 'Male' ? 'M' : 'F', state: data.state, lga, phone: data.phone, address: data.address, photo: data.photo, issued: Date.now(), office: s.def.name };
        st.nin = nin; ctx.persist(); bus.emit('nin:issued', nin);
        ov.body.innerHTML = ''; ov.body.append(h('div', { class: 'fk-sec', text: 'Issued' }), h('div', { style: 'text-align:center' }, Object.assign(drawCard(nin, 520), { style: 'max-width:100%;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.5)' })), h('p', { style: 'text-align:center;color:var(--mut);font-size:13px', text: 'Saved to the Wallet app on your phone.' }), h('div', { style: 'text-align:center;margin-top:8px' }, h('button', { class: 'fk-btn', text: 'Done', onclick: () => ov.close() })));
        toast(ctx, 'NIN issued', spaced(nin.number) + '. Your Wallet has the card.', 'ok', 7);
      } }));
  };
  view();
}

// ------------------------------------------------------------------------------------------------ wallet app
function walletHtml(): string {
  const row = (b: string, s: string, btn?: [string, string]) => `<div class="row"><b>${b}</b>${s}${btn ? `<br><button class="btn" data-app="Wallet" data-id="${btn[0]}">${btn[1]}</button>` : ''}</div>`;
  let html = '';
  const n = st.nin;
  if (n) { const url = drawCard(n, 520).toDataURL('image/jpeg', 0.9); html += `<div class="row" style="padding:6px"><img src="${url}" style="width:100%;border-radius:10px;display:block"><b style="margin-top:6px">NIN ${spaced(n.number)}</b>Enrolled at ${n.office}</div>`; }
  else html += row('No NIN', 'Get one at any Local Government secretariat. Look for the green and white kiosk.');
  for (const c of fleet.cars) html += row(`${c.name} · ${c.plate}`, c.status === 'chopped' ? 'Stripped for parts.' : c.reg ? `Registered ${new Date(c.reg.at).toLocaleDateString('en-NG')} · ${c.reg.docs === 'receipt' ? 'receipt' : 'mechanic papers'}` : `Not registered. ${c.receipt ? 'Receipt on file.' : c.papers ? 'Papers on file.' : 'No papers.'}`);
  if (!fleet.cars.length) html += row('Car papers', 'Nothing here yet.');
  return html;
}

export const identity: GameSystem = {
  id: 'identity',
  async init(ctx) {
    await loadShops(); st = stateOf<IdState>(ctx, 'identity', { nin: null });
    registerApp('Wallet', 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l2-3h12M17 13h4', 'linear-gradient(160deg,#34d27a,#0b7a47)', () => walletHtml());
    initSites(ctx); siteHooks.lga = (c, s) => openDesk(c, s);
    (window as any).__hlId = { get nin() { return st.nin; }, open: (id: string) => { const s = (window as any).__hlSites.find((x: any) => x.def.id === id); if (s) openDesk(ctx, s); } };
  },
  frame(ctx) {
    if (shotReq) { if (--shotWait <= 0) { const r = shotReq; shotReq = null; const me = ctx.sim.local; const head = new ctx.THREE.Vector3(me.pos.x, me.pos.y + 1.62, me.pos.z).project(ctx.view.camera); shotCrop = { cx: head.x * 0.5 + 0.5, cy: -head.y * 0.5 + 0.5 }; r(grabFace(ctx)); } }
  },
  onAction(ctx, app, id) { void ctx; void app; void id; return false; },
};
void kindName; void STD_RE; void shopItems;
