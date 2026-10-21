// HustleLife entry: boot, the streamed corridor, the sim at 60 Hz, the view at display rate, HUD, phone, hustles, land.
import * as THREE from 'three';
import { initPhysics } from './sim/physics';
import { LifeSim } from './sim/life';
import { emptyCommand, type Command } from './sim/types';
import { HumanAssets, HumanView, ROSTER, ROSTER_IDS, type RosterId } from './render/humans';
import { LifeView } from './render/lifeView';
import { preloadCars } from './render/cars';
import { LifeHud, type PhoneCtx, type ParcelInfo } from './ui/lifeHud';
import { Input } from './input/input';
import { RegionStore, type Pothole } from './world/region';
import { loadTexSet } from './world/texsets';
import { TILE } from './world/streamer';
import { plotPrice, type Plot } from './world/plots';
import { RoadNet } from './world/roadnet';
import { RoadGraph } from './world/roadgraph';
import { RouteGuide } from './world/routeguide';
import { RouteLine } from './render/routeline';
import { seatEye } from './render/seating';
import { WEAPONS } from './data/balance';
import { weaponStats, AMMO_STACK } from './sim/items';
import { audio } from './audio/audio';
import { WEATHER_ORDER, type WeatherName } from './render/sky';
import type { CharacterLook } from './data/cosmetics';
import { Governor, LEVELS, PRESET_LEVEL, detectDevice, loadPref, savePref, type Pref, type Tier } from './render/quality';
import { PerfHud } from './render/perfhud';

const q = new URLSearchParams(location.search);
const touchDev = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// Quality: ?q=low|medium|high|auto forces a preset for this session, otherwise the saved choice, otherwise auto-detect.
const urlQ = q.get('q') as Pref | null;
let pref: Pref = urlQ === 'low' || urlQ === 'medium' || urlQ === 'high' || urlQ === 'auto' ? urlQ : loadPref();
const device = detectDevice();
const startLevel = pref === 'auto' ? device.level : PRESET_LEVEL[pref as Tier];
const tierOf = (lv: number): Tier => (lv <= 1 ? 'high' : lv <= 3 ? 'medium' : 'low');
const quality: Tier = tierOf(startLevel);
console.info(`[hl] quality ${pref} -> rung ${startLevel} ${LEVELS[startLevel].name} (${device.gpu}; ${device.reason})`);
document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;touch-action:none';
const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block'; document.body.appendChild(canvas);
const hud = new LifeHud(touchDev);
const save = (() => { try { return JSON.parse(localStorage.getItem('hustlelife') ?? '{}'); } catch { return {}; } })();
const persist = (o: any) => { try { localStorage.setItem('hustlelife', JSON.stringify(o)); } catch { /* private mode */ } };
const state: { bank: number; owned: string[]; ownedPts: Record<string, number[]>; model: string } = { bank: save.bank ?? 0, owned: save.owned ?? [], ownedPts: save.ownedPts ?? {}, model: save.model ?? 'survivor' };

const PLAYER_LOOK: CharacterLook = { name: 'You', body: 'male', skin: 1, hair: 'buzzed', beard: false, top: 'tee', topPattern: 'solid', topColor: '#e8e0d0', topAccent: '#141414', pants: 'solid', pantsColor: '#1e2b3a', shoes: '#141414', head: 'none', vest: false, backpack: false, scars: 0, facePaint: 'none', model: 'survivor' } as CharacterLook;
const LOOKS: Record<string, Partial<CharacterLook>> = {
  survivor: { body: 'male', topColor: '#2c3a2a', topAccent: '#141414', pantsColor: '#1e2b3a', shoes: '#141414', topPattern: 'solid' },
  rogue: { body: 'male', topColor: '#1d1f24', pantsColor: '#2a2622', shoes: '#2a1d14' },
  trooper: { body: 'male' },
  girl: { body: 'female', topColor: '#b0332a', topAccent: '#e8c34a', pantsColor: '#141414', shoes: '#e8e0d0', topPattern: 'ankara_sun' },
  farah: { body: 'female', topColor: '#d9a441', topAccent: '#355070', pantsColor: '#1e2b3a', shoes: '#5a3d2b', topPattern: 'ankara_wave' },
};
Object.assign(PLAYER_LOOK, LOOKS[state.model] ?? {}, { model: state.model });

let sim: LifeSim, view: LifeView, input: Input, store: RegionStore, gov: Governor;
const perfHud = new PerfHud(() => view, () => gov);
let started = false; let acc = 0; let last = performance.now();
const jobs: PhoneCtx['jobs'] = [];
let activeJob: { id: string; title: string; pay: number; stage: 0 | 1; a: { x: number; z: number }; b: { x: number; z: number }; t: number; needCar: boolean } | null = null;
const texts: [string, string][] = [['Unknown', 'Welcome to Lagos. Shine your eye.'], ['Mama Put', 'You still owe me ₦500 for the rice. I dey wait.'], ['Conductor Sule', 'If you wan work, come Oshodi park. Shout the route, collect the money, no steal.']];
let potholeReports: any = null;
let tileDue = 0;

// potholes are looked up through a coarse grid built from the loaded regions
let phGrid = new Map<string, Pothole[]>(); let phRegions = 0;
function potholesNear(x: number, z: number, r: number): Pothole[] {
  if (store.regions.size !== phRegions) { phGrid = new Map(); for (const reg of store.regions.values()) for (const p of reg.potholes) { const k = `${Math.floor(p.x / 20)},${Math.floor(p.z / 20)}`; if (!phGrid.has(k)) phGrid.set(k, []); phGrid.get(k)!.push(p); } phRegions = store.regions.size; }
  const out: Pothole[] = [];
  for (let i = Math.floor((x - r) / 20); i <= Math.floor((x + r) / 20); i++) for (let j = Math.floor((z - r) / 20); j <= Math.floor((z + r) / 20); j++) for (const p of phGrid.get(`${i},${j}`) ?? []) if (Math.hypot(p.x - x, p.z - z) < r) out.push(p);
  return out;
}

async function boot() {
  hud.setLoad(0.05, 'Starting physics');
  await initPhysics();
  store = new RegionStore('world/'); await store.init();
  hud.setLoad(0.12, 'Reading the map of Lagos');
  potholeReports = await (await fetch('world/potholes.json')).json();
  const spawn = q.get('lat') ? store.project(+q.get('lat')!, +q.get('lon')!) : { x: +(q.get('x') ?? -38), z: +(q.get('z') ?? 52) };
  await store.around(spawn.x, spawn.z, 900);
  hud.setLoad(0.3, 'Loading people');
  const assets = new HumanAssets(); await assets.load((f) => hud.setLoad(0.3 + f * 0.3));
  hud.setLoad(0.62, 'Loading textures and cars');
  const size = quality === 'low' ? 512 : 1024;
  const [tg, tw] = await Promise.all([loadTexSet('g', 8, size), loadTexSet('w', 8, size), preloadCars()]);
  sim = new LifeSim({ seed: (Math.random() * 1e9) | 0, name: 'You', look: PLAYER_LOOK, spawn, quality, potholes: potholesNear });
  sim.cash = save.cash ?? 1850;
  view = new LifeView(canvas, sim, assets, store, tg, tw, quality, { hour: q.get('t') ? +q.get('t')! : undefined, weather: (q.get('w') as WeatherName) ?? undefined, level: startLevel });
  routeLine = new RouteLine(view.scene, startLevel >= 4 ? 36 : 72);
  gov = new Governor(pref, startLevel, { level: (l) => view.applyLevel(l, gov.scale), scale: (s) => view.setRenderScale(s) });
  view.applyLevel(startLevel, 1); gov.scale = 1;
  view.onTile = (t, built) => { if (built) sim.net.addRoads(t.roads); else sim.removeTile(t.key); };
  view.cam.yaw = Math.PI * 0.85;
  input = new Input(canvas, touchDev ? 'on' : 'off');
  hud.setLoad(0.75, 'Building Oshodi');
  // build the ground under the player before letting them in
  for (let i = 0; i < 60 && view.world.tiles.size < 9; i++) { view.world.update(spawn.x, spawn.z, true); await new Promise((r) => setTimeout(r, 0)); hud.setLoad(0.75 + 0.2 * Math.min(1, view.world.tiles.size / 9)); }
  // stand on a real walkway near the requested spot
  let best: { x: number; z: number } | null = null, bd = 1e9;
  for (const id of sim.net.nearWalks(spawn.x, spawn.z, 120)) { const w = sim.net.walks[id]; const pr = RoadNet.project(w.pts, spawn.x, spawn.z); if (pr.d < bd) { bd = pr.d; best = RoadNet.at(w.pts, pr.s); } }
  if (best) { const me = sim.local; me.pos = { x: best.x, y: 0.05, z: best.z }; me.body.setTranslation({ x: best.x, y: 1, z: best.z }, true); }
  syncColliders(true);
  // the danfo that dropped you, still parked at the kerb with its engine knocking
  { const lanes = sim.net.near(sim.local.pos.x, sim.local.pos.z, 40); let bl: any = null, bd2 = 1e9;
    for (const id of lanes) { const l = sim.net.lanes[id]; const pr = RoadNet.project(l.pts, sim.local.pos.x, sim.local.pos.z); if (pr.d < bd2) { bd2 = pr.d; bl = { l, s: pr.s }; } }
    if (bl) { const at = RoadNet.at(bl.l.pts, Math.min(bl.l.len - 1, bl.s + 6)); const v = sim.addVehicle('danfo', { x: at.x, y: 0.1, z: at.z }, at.yaw, true); (v as any).locked = false; const cd = sim.spawnActor('ped', { x: at.x + 1.5, y: 0.05, z: at.z }, undefined, 'Conductor'); void cd; } }
  hud.setLoad(0.97, 'Compiling shaders');
  { const t0 = performance.now(); await view.precompile(); console.info(`[hl] precompile ${Math.round(performance.now() - t0)} ms, ${view.renderer.info.programs?.length ?? 0} programs`); }
  hud.setLoad(1);
  try { hud.pickCharacter(await thumbs(assets), state.model, (id) => setPlayerModel(id)); } catch (e) { console.warn('thumbs', e); }
  makeJobs();
  hud.onAction = onPhoneAction;
  hud.onBuy = (id) => { buyPlot(id); };
  bindLandmap();
  (window as any).__hl = { sim, view, hud, state, gov, perf: perfHud, THREE, graph, guide, store, startJob, get fps() { return fps; }, landmap: () => toggleLandmap(), call: () => offerCall('Conductor Sule', 'delivery', 'Test call'), job: (id: string) => startJob(id), pick: (id: string) => setPlayerModel(id),
    // test hook: run the sim without rendering, holding a command
    simulate(secs: number, patch: Partial<Command> & { pulse?: string[] } = {}) { for (let i = 0; i < secs * 60; i++) { const c: any = { ...emptyCommand(), yaw: sim.local.yaw, ...patch }; for (const k of patch.pulse ?? []) c[k] = Math.floor(i / 12) % 2 === 0; sim.setCommand(0, c); sim.step(1 / 60); if (i % 30 === 0) { view.world.update(sim.local.pos.x, sim.local.pos.z, true); syncColliders(true); } } view.handleEvents(sim.events, hud); sim.events.length = 0; },
    stoppedCar() { const m = sim.local.pos; return sim.liveVehicles().filter((v) => Math.abs(v.ctrl.currentVehicleSpeed()) < 2 && v.kind !== 'okada').sort((a, b) => { const pa = a.body.translation(), pb = b.body.translation(); return Math.hypot(pa.x - m.x, pa.z - m.z) - Math.hypot(pb.x - m.x, pb.z - m.z); })[0]; },
    nearestCar() { let b: any = null, bd = 1e9; for (const v of sim.liveVehicles()) { const p = v.body.translation(); const d = Math.hypot(p.x - sim.local.pos.x, p.z - sim.local.pos.z); if (d < bd) { bd = d; b = v; } } return b; },
  };
  (window as any).__w = { get tiles() { return view.world.tiles.size; }, frames: 0 };
  requestAnimationFrame(loop);
  hud.ready(() => { started = true; audio.init(); intro(); }, q.has('auto'));
}

function intro() {
  hud.title('HUSTLE LIFE', 'Oshodi, Lagos', 5);
  hud.say('Conductor', 'Oshodi! Oshodi! Last stop, everybody come down!');
  hud.say('You', 'Na here? Ehen. Lagos, I don land.');
  setTimeout(() => hud.toast('Unknown', 'Open your phone with T. Hustles pay. Land is the real money. Press M for the land map.', 'linear-gradient(160deg,#59a8ff,#1f62d6)', 'msg', 7), 6500);
  setTimeout(() => offerCall('Conductor Sule', 'delivery', 'Guy, buka near the park get food wey must reach customer sharp sharp. You fit run am?'), 15000);
  hud.help(touchDev ? '<b>Lagos.</b> Left thumb walks, drag right side to look. <kbd>CAR</kbd> gets in or jacks any car near you. <kbd>☎</kbd> is your phone.' : '<b>Lagos.</b> <kbd>T</kbd> phone · <kbd>E</kbd> car (walk up to any car, even one with a driver) · <kbd>LMB</kbd> punch · <kbd>RMB</kbd> aim · <kbd>M</kbd> land map · <kbd>V</kbd> cockpit.');
  setTimeout(() => hud.help(null), 12000);
}

function syncColliders(force = false) {
  tileDue -= 1; if (!force && tileDue > 0) return; tileDue = 20;
  const me = sim.local; const P = me.vehicle !== null ? sim.vehicles[me.vehicle].body.translation() : me.pos;
  for (const t of view.world.tiles.values()) {
    const cx = t.x0 + TILE / 2, cz = t.z0 + TILE / 2; const d = Math.max(Math.abs(cx - P.x), Math.abs(cz - P.z));
    if (d < TILE * 1.25) sim.addTile(t.key, t.col); else if (d > TILE * 1.9 && sim.hasTile(t.key)) sim.removeTile(t.key);
  }
}

// ---------------------------------------------------------------- hustles
function makeJobs() {
  jobs.length = 0;
  jobs.push({ id: 'delivery', title: 'Food delivery', pay: 3500, desc: 'Pick up jollof from a buka and drop it off before it gets cold. Any car or okada.', active: false });
  jobs.push({ id: 'danfo', title: 'Danfo run', pay: 6000, desc: 'Drive a danfo to the next park. Find one, jack it if you must.', active: false });
  jobs.push({ id: 'parcel', title: 'Parcel, no questions', pay: 30000, desc: 'Pick up a parcel and get it across town. Police will be interested. Raises wahala.', active: false });
}
function walkPointAround(x: number, z: number, r0: number, r1: number) {
  for (let i = 0; i < 40; i++) {
    const ws = sim.net.nearWalks(x, z, r1); if (!ws.length) break;
    const w = sim.net.walks[ws[(Math.random() * ws.length) | 0]]; const p = RoadNet.at(w.pts, Math.random() * w.len);
    const d = Math.hypot(p.x - x, p.z - z); if (d > r0 && d < r1) return { x: p.x, z: p.z };
  }
  return { x: x + r0, z };
}
function startJob(id: string) {
  const j = jobs.find((x) => x.id === id); if (!j) return;
  const me = sim.local; const a = walkPointAround(me.pos.x, me.pos.z, 60, 220); const b = walkPointAround(a.x, a.z, 350, 700);
  activeJob = { id, title: j.title, pay: j.pay, stage: 0, a, b, t: id === 'delivery' ? 240 : id === 'danfo' ? 300 : 360, needCar: id === 'danfo' };
  jobs.forEach((x) => (x.active = x.id === id));
  loadRouteRegions(me.pos.x, me.pos.z, b.x, b.z); guide.clear();
  hud.title(j.title.toUpperCase(), 'Go to the green marker on the radar.', 4);
  if (id === 'parcel') { sim.wanted = Math.max(sim.wanted, 1); sim.lastSeen = sim.time; }
}
function tickJob(dt: number) {
  if (!activeJob) return;
  const me = sim.local; const P = me.vehicle !== null ? sim.vehicles[me.vehicle].body.translation() : me.pos;
  activeJob.t -= dt;
  if (activeJob.t <= 0) { hud.title('HUSTLE FAILED', 'Too slow. Lagos waits for nobody.', 4, true); activeJob = null; jobs.forEach((x) => (x.active = false)); return; }
  const tgt = activeJob.stage === 0 ? activeJob.a : activeJob.b;
  const d = Math.hypot(tgt.x - P.x, tgt.z - P.z);
  if (activeJob.needCar && activeJob.stage === 1 && !(me.vehicle !== null && sim.vehicles[me.vehicle].kind === 'danfo')) return;
  if (d < 6) {
    if (activeJob.stage === 0) { activeJob.stage = 1; hud.title('PICKED UP', `Now deliver it. ${Math.round(activeJob.t)}s left.`, 3); audio.ui('click'); }
    else { sim.cash += activeJob.pay; hud.money(activeJob.pay); hud.title('HUSTLE DONE', `+₦${activeJob.pay.toLocaleString()}`, 3); activeJob = null; jobs.forEach((x) => (x.active = false)); persist({ ...state, cash: sim.cash }); }
  }
}

// ---------------------------------------------------------------- land
function nearbyPlots(): PhoneCtx['plots'] {
  const me = sim.local; const out: PhoneCtx['plots'] = [];
  for (const list of view.world.plots.values()) for (const p of list) {
    const d = Math.hypot(p.cx - me.pos.x, p.cz - me.pos.z); if (d > 400) continue;
    out.push({ plot: p, price: plotPrice(p, p.cx, p.cz), owned: state.owned.includes(p.id), dist: d });
  }
  return out.sort((a, b) => a.dist - b.dist);
}
function onPhoneAction(app: string, id: string) {
  if (app === 'Hustles') { if (id.startsWith('cancel:')) { activeJob = null; jobs.forEach((x) => (x.active = false)); } else startJob(id); }
  if (app === 'Landmap') { if (!hud.landmapOn) toggleLandmap(); if (id) selectPlot(id); return; }
  if (app === 'Land') {
    const p = nearbyPlots().find((x) => x.plot.id === id); if (!p) return;
    const total = p.price; const pay = Math.min(sim.cash + state.bank, total);
    if (pay < total) { hud.title('NOT ENOUGH MONEY', `You need ₦${total.toLocaleString()}. Hustle more.`, 3, true); return; }
    let left = total; const fromBank = Math.min(state.bank, left); state.bank -= fromBank; left -= fromBank; sim.cash -= left;
    state.owned.push(p.plot.id); state.ownedPts[p.plot.id] = p.plot.pts.map((v) => Math.round(v * 10) / 10);
    hud.title('LAND IS YOURS', `${Math.round(p.plot.area)} m² · Survey plan and C of O are next.`, 4); persist({ ...state, cash: sim.cash });
  }
  if (app === 'Bank') {
    if (id === 'deposit') { const a = Math.min(10000, sim.cash); sim.cash -= a; state.bank += a; }
    if (id === 'withdraw') { const a = Math.min(10000, state.bank); state.bank -= a; sim.cash += Math.round(a * 0.985); }
    persist({ ...state, cash: sim.cash });
  }
  if (app === 'Settings') {
    if (id === 'weather') { view.atmo.cycleWeather(); }
    if (id === 'hour') view.atmo.hour = (view.atmo.hour + 1) % 24;
    if (id === 'quality') {
      const order: Pref[] = ['auto', 'high', 'medium', 'low']; pref = order[(order.indexOf(pref) + 1) % order.length]; savePref(pref);
      const lv = pref === 'auto' ? device.level : PRESET_LEVEL[pref as Tier];
      gov.setPref(pref, lv); view.applyLevel(lv, 1); view.world.update(sim.local.pos.x, sim.local.pos.z);
    }
  }
  hud.refreshApp();
}

// ---------------------------------------------------------------- input
let firstPersonPressed = false;
let route: number[] | null = null, parcelT = 0, street = '';

// ---------------------------------------------------------------- GPS: A* over the road graph (world/roadgraph.ts), followed by world/routeguide.ts
const graph = new RoadGraph(); const guide = new RouteGuide(graph); let routeLine: RouteLine | null = null; let graphT = 0;
/** Regions between you and the objective may not be loaded yet: ask for the ones along the way. */
function loadRouteRegions(x0: number, z0: number, x1: number, z1: number) {
  const n = Math.min(6, Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 900)));
  for (let i = 0; i <= n; i++) { const t = i / n; void store.around(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 250); }
}
function streetName(x: number, z: number) { let best = '', bd = 1e9; for (const id of sim.net.near(x, z, 40)) { const l = sim.net.lanes[id]; if (!l.road.name) continue; const pr = RoadNet.project(l.pts, x, z); if (pr.d < bd) { bd = pr.d; best = l.road.name; } } return best; }
function temperature() { const h = view.atmo.hour; const wl = view.atmo.weatherLabel.toLowerCase(); return 25 + 7 * Math.max(0, Math.sin(((h - 8) / 12) * Math.PI)) - (/rain|storm/.test(wl) ? 3.5 : 0) - (/harmattan/.test(wl) && (h < 8 || h > 20) ? 4 : 0); }

// ---------------------------------------------------------------- land: parcels, owners, the LANDMAP
const OWNERS = ['Chief Obinna Nwosu', 'Alhaja Kudirat Lawal', 'Mr Segun Afolabi', 'Mama Bisi Ogundele', 'Omo-onile family', 'Engr. Ifeanyi Eze', 'Dr Ronke Salami', 'Bro. Kayode Olatunji', 'Hajia Zainab Garba', 'Lagos State (gazetted)', 'Prime Estates Ltd', 'Pastor Femi Adebayo (church land)'];
function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function plotById(id: string): Plot | null { for (const list of view.world.plots.values()) for (const p of list) if (p.id === id) return p; return null; }
function parcelInfo(p: Plot): ParcelInfo {
  const owned = state.owned.includes(p.id); const hs = hashStr(p.id);
  const zone = p.zone === 'vacant' ? 'Vacant land' : p.zone === 'unfinished' ? 'Uncompleted building' : p.zone === 'commercial' ? 'Shop front' : p.zone === 'industrial' ? 'Warehouse yard' : p.zone === 'institution' ? 'Institutional' : 'Residential';
  const ph = potholesNear(p.cx, p.cz, 90).length; const road = sim.net.near(p.cx, p.cz, 30).length > 0;
  const traits: ParcelInfo['traits'] = [[zone, 'p']];
  traits.push(road ? ['Tarred road access', 'g'] : ['No road frontage', 'r']);
  if (ph > 3) traits.push([`${ph} potholes nearby`, 'r']);
  if (p.rich > 0.6) traits.push(['Better area', 'g']); else if (p.rich < 0.25) traits.push(['Rough area', 'r']);
  if (p.zone === 'vacant' && hs % 3 === 0) traits.push(['Omo-onile wahala', 'r']);
  traits.push(['No C of O yet', '']);
  const price = plotPrice(p, p.cx, p.cz);
  return { id: p.id, title: `${zone} · ${Math.round(p.area)} m²`, area: areaName(p.cx, p.cz) || 'Lagos', owner: owned ? 'You' : OWNERS[hs % OWNERS.length], size: p.area, zone, price, owned, traits,
    stats: [['Size', `${Math.round(p.area)} m²`], ['Buildings', String(p.buildings.length)], ['From Oshodi', `${(Math.hypot(p.cx, p.cz) / 1000).toFixed(1)} km`], ['Rent / yr', `₦${Math.round(price * 0.055 / 1000).toLocaleString()}k`]] };
}
function parcelAt(x: number, z: number): ParcelInfo | null {
  for (const list of view.world.plots.values()) for (const p of list) { if (Math.abs(p.cx - x) > 50 || Math.abs(p.cz - z) > 50) continue; if (inPoly(x, z, p.pts)) return parcelInfo(p); }
  return null;
}
function inPoly(x: number, z: number, p: ArrayLike<number>) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
function buyPlot(id: string) {
  const p = plotById(id); if (!p || state.owned.includes(id)) return;
  const total = plotPrice(p, p.cx, p.cz); if (sim.cash + state.bank < total) { hud.toast('Not enough money', `You need ₦${total.toLocaleString()}. Hustle more, or save in the bank.`, 'var(--red)', 'cash'); return; }
  let left = total; const fromBank = Math.min(state.bank, left); state.bank -= fromBank; left -= fromBank; sim.cash -= left;
  state.owned.push(id); state.ownedPts[id] = Array.from(p.pts).map((v) => Math.round(v * 10) / 10);
  persist({ ...state, cash: sim.cash });
  hud.toast('Land is yours', `${Math.round(p.area)} m² · survey plan and C of O are next.`, 'linear-gradient(160deg,#a78bfa,#6d3ef0)', 'land', 6);
  view.landmap.owned = state.owned; view.landmap.builtAt = { x: 1e9, z: 1e9 };
  hud.landmapPanel(parcelInfo(p), true);
}
function selectPlot(id: string) { const p = plotById(id); if (!p) return; view.landmap.x = p.cx; view.landmap.z = p.cz; view.landmapSelect(Array.from(p.pts)); const info = parcelInfo(p); hud.landmapPanel(info, sim.cash + state.bank >= info.price); }
function toggleLandmap() {
  if (hud.landmapOn) { hud.landmapOpen(false); view.closeLandmap(); input.enabled = true; return; }
  if (hud.phoneUp) { hud.togglePhone(false); view.phoneUp = false; }
  input.releasePointer(); input.enabled = false;
  const me = sim.local; view.openLandmap(me.pos.x, me.pos.z, state.owned); hud.landmapOpen(true); hud.landmapPanel(null);
  const here = parcelAt(me.pos.x, me.pos.z); if (here) selectPlot(here.id);
}
const lmPtrs = new Map<number, { x: number; y: number }>(); let lmMoved = 0, lmPinch = 0;
function bindLandmap() {
  const el = document.getElementById('lm-catch')!;
  document.getElementById('lm-x')!.onclick = () => toggleLandmap();
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); lmPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); lmMoved = 0; lmPinch = 0; });
  el.addEventListener('pointermove', (e) => {
    const pr = lmPtrs.get(e.pointerId); if (!pr) return; const L = view.landmap;
    if (lmPtrs.size === 2) { const [a, b] = [...lmPtrs.values()]; const d0 = Math.hypot(a.x - b.x, a.y - b.y); pr.x = e.clientX; pr.y = e.clientY; const [c, d] = [...lmPtrs.values()]; const d1 = Math.hypot(c.x - d.x, c.y - d.y); if (lmPinch) L.h = Math.max(110, Math.min(900, L.h * (d0 / Math.max(1, d1)))); lmPinch = 1; lmMoved += 99; return; }
    const k = (L.h * 1.5) / innerHeight; L.x -= (e.clientX - pr.x) * k; L.z -= (e.clientY - pr.y) * k; lmMoved += Math.abs(e.clientX - pr.x) + Math.abs(e.clientY - pr.y); pr.x = e.clientX; pr.y = e.clientY;
  });
  const up = (e: PointerEvent) => {
    if (!lmPtrs.has(e.pointerId)) return; lmPtrs.delete(e.pointerId);
    if (lmMoved < 7 && !lmPinch) { const p = view.landmapPick((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); if (p) selectPlot(p.id); else { view.landmapSelect(null); hud.landmapPanel(null); } }
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { const L = view.landmap; L.h = Math.max(110, Math.min(900, L.h * (e.deltaY > 0 ? 1.12 : 0.89))); e.preventDefault(); }, { passive: false });
}
function landmapInput(dt: number, k: Set<string>, pad: ReturnType<typeof gamepad>) {
  const L = view.landmap; const sp = L.h * 1.2 * dt;
  if (k.has('KeyW') || k.has('ArrowUp')) L.z -= sp; if (k.has('KeyS') || k.has('ArrowDown')) L.z += sp; if (k.has('KeyA') || k.has('ArrowLeft')) L.x -= sp; if (k.has('KeyD') || k.has('ArrowRight')) L.x += sp;
  if (k.has('KeyQ') || k.has('Minus')) L.h = Math.min(900, L.h * (1 + dt)); if (k.has('KeyE') || k.has('Equal')) L.h = Math.max(110, L.h * (1 - dt));
  if (k.has('Escape')) toggleLandmap();
  if (pad) { L.x += pad.lx * sp; L.z += pad.ly * sp; L.h = Math.max(110, Math.min(900, L.h * (1 + (pad.lt - pad.rt) * dt))); if (pad.a && !prevPad?.a) { const p = view.landmapPick(0, 0); if (p) selectPlot(p.id); } if (pad.b && !prevPad?.b) toggleLandmap(); }
}

// ---------------------------------------------------------------- calls: work rings your phone
function offerCall(who: string, job: string, line: string) {
  if (activeJob) return;
  hud.call(who, 'Incoming call · Y answer · N decline', () => { hud.say(who, line, 5); const j = jobs.find((x) => x.id === job); setTimeout(() => { startJob(job); if (j) hud.toast('Hustle accepted', `${j.title} · ₦${j.pay.toLocaleString()}. Follow the teal route.`, 'linear-gradient(160deg,#f6c453,#d98a12)', 'pin', 5); }, 1200); },
    () => hud.toast('Missed call', `${who}. Check Hustles on your phone when you are ready.`, 'linear-gradient(160deg,#3a3f52,#151824)', 'phone'));
}
setInterval(() => { if (!started || activeJob || hud.ringing || hud.landmapOn) return; if (Math.random() < 0.5) { const j = [['Mama Put', 'delivery', 'My pikin, take this food go customer for me. I go pay you well.'], ['Conductor Sule', 'danfo', 'My driver no show. Carry the bus go the next park, you go collect your share.'], ['Unknown number', 'parcel', 'I get small package. No ask question. Police dey around so shine your eye.']][Math.floor(Math.random() * 3)]; offerCall(j[0], j[1], j[2]); } }, 150000);

// ---------------------------------------------------------------- choose your hustler
async function thumbs(assets: HumanAssets) {
  const W = 256, H = 320; const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setSize(W, H, false); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
  const out: { id: string; name: string; blurb: string; img: string }[] = [];
  for (const id of ROSTER_IDS) {
    const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a2018, 1.4)); const key = new THREE.DirectionalLight(0xfff0dc, 2.6); key.position.set(1.5, 2.5, 3); sc.add(key); const rim = new THREE.DirectionalLight(0x8b5cf6, 2.2); rim.position.set(-2, 2, -2); sc.add(rim);
    const look = { ...PLAYER_LOOK, ...(LOOKS[id] ?? {}), model: id } as CharacterLook; const v = new HumanView(assets, look, 0);
    v.root.rotation.y = 0; sc.add(v.root);
    v.update(0.6, { anim: 'idle', speed: 0, moveYaw: 0, aimYaw: 0.25, pitch: 0, aiming: false, armed: false, weapon: null, firing: false, reloading: false, melee: false, dead: false, driving: false, shadow: 0, awaken: 0, hit: 0, cast: false, healing: false }, 0);
    v.root.rotation.y = 0.25; v.root.updateMatrixWorld(true);
    const head = v.bones.get('Head'); const hy = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.6;
    const cam = new THREE.PerspectiveCamera(28, W / H, 0.05, 20); cam.position.set(0.22, hy - 0.08, 1.75); cam.lookAt(0, hy - 0.32, 0);
    r.render(sc, cam); out.push({ id, name: ROSTER[id as RosterId].name, blurb: ROSTER[id as RosterId].blurb, img: r.domElement.toDataURL('image/webp', 0.9) });
    v.dispose(); await new Promise((res) => setTimeout(res, 0));
  }
  r.dispose(); r.forceContextLoss();
  return out;
}
function setPlayerModel(id: string) {
  state.model = id; persist({ ...state, cash: sim.cash });
  Object.assign(sim.local.look, LOOKS[id] ?? {}, { model: id });
  const v = view.actors.get(sim.local.id); if (v) { v.view.dispose(); view.actors.delete(sim.local.id); }
}
function gamepad() {
  const pads = navigator.getGamepads?.() ?? []; const gp = [...pads].find((p) => p && p.connected); if (!gp) return null;
  const ax = (i: number) => (Math.abs(gp.axes[i] ?? 0) > 0.15 ? gp.axes[i] : 0); const b = (i: number) => !!gp.buttons[i]?.pressed; const v = (i: number) => gp.buttons[i]?.value ?? 0;
  return { lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3), a: b(0), b: b(1), x: b(2), y: b(3), lb: b(4), rb: b(5), lt: v(6), rt: v(7), back: b(8), start: b(9), up: b(12), down: b(13), left: b(14), right: b(15), r3: b(11) };
}
let prevPad: ReturnType<typeof gamepad> = null;
function command(f: ReturnType<Input['frame']>, aimDir: THREE.Vector3, pad: ReturnType<typeof gamepad>): Command {
  const c = emptyCommand(); const me = sim.local; const cam = view.cam;
  let mx = f.mx, my = f.my;
  if (pad) { if (Math.abs(pad.lx) > 0.01) mx = pad.lx; if (Math.abs(pad.ly) > 0.01) my = -pad.ly; }
  if (me.vehicle !== null) { c.mx = mx; c.mz = pad && (pad.rt > 0.05 || pad.lt > 0.05) ? pad.rt - pad.lt : my; }
  else {
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
    let x = rx * mx + fx * my, z = rz * mx + fz * my; const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
    c.mx = x; c.mz = z;
  }
  c.yaw = Math.atan2(aimDir.x, aimDir.z); c.pitch = Math.asin(Math.max(-1, Math.min(1, aimDir.y))); c.aimDir = { x: aimDir.x, y: aimDir.y, z: aimDir.z };
  c.sprint = f.sprint || !!pad?.a && me.vehicle === null; c.crouch = f.crouch; c.jump = f.jump || (!!pad?.x && me.vehicle === null) || (me.vehicle !== null && !!pad?.b);
  c.aim = f.aim || (me.vehicle === null && (pad?.lt ?? 0) > 0.4); c.fire = f.fire || (me.vehicle === null && (pad?.rt ?? 0) > 0.4);
  c.reload = f.reload || (!!pad?.b && !prevPad?.b && me.vehicle === null); c.interact = f.interact || (!!pad?.y && !prevPad?.y); c.heal = f.heal;
  if (f.slot >= 0 && f.slot <= 2) c.slot = f.slot;
  else if (f.slot === 99 || (pad?.rb && !prevPad?.rb)) { const order = [2, 1, 0].filter((i) => i === 2 || (i === 0 ? me.inv.primary : me.inv.secondary)); c.slot = order[(order.indexOf(me.slot) + 1) % order.length]; }
  if (view.phoneUp && me.vehicle === null) { c.sprint = false; c.fire = false; c.aim = false; }
  (me as any)._phone = view.phoneUp;
  return c;
}

let fps = 60, frames = 0, fpsT = 0;
function loop(t: number) {
  const rawDt = t - last; const dt = Math.min(0.1, rawDt / 1000); last = t;
  if (gov && started && document.visibilityState === 'visible') gov.tick(rawDt, t); else if (gov) gov.reset();
  perfHud.update(dt);
  frames++; fpsT += dt; if (fpsT > 1) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  const phoneBtn = (input as any).tpressed?.has?.('phone');
  const f = input.frame(); const pad = gamepad();
  const k = (input as any).keys as Set<string>;
  const pressedT = (input as any)._t = k.has('KeyT') && !(input as any)._tPrev; (input as any)._tPrev = k.has('KeyT');
  if (started && (pressedT || phoneBtn || (pad?.lb && !prevPad?.lb) || (pad?.up && !prevPad?.up && !hud.phoneUp))) { view.phoneUp = hud.togglePhone(); if (view.phoneUp) { hud.ctx = phoneCtx(); input.releasePointer(); } }
  if (hud.phoneUp) {
    const kp = (code: string) => k.has(code) && !(input as any)['_p' + code]; for (const c of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Backspace']) { const was = (input as any)['_p' + c]; (input as any)['_p' + c] = k.has(c); if (!was && k.has(c)) { if (c === 'ArrowLeft') hud.phoneNav(-1, 0); if (c === 'ArrowRight') hud.phoneNav(1, 0); if (c === 'ArrowUp') hud.phoneNav(0, -1); if (c === 'ArrowDown') hud.phoneNav(0, 1); if (c === 'Enter') hud.phoneSelect(); if (c === 'Backspace') { hud.phoneBack(); view.phoneUp = hud.phoneUp; } } } void kp;
    if (pad) { if (pad.left && !prevPad?.left) hud.phoneNav(-1, 0); if (pad.right && !prevPad?.right) hud.phoneNav(1, 0); if (pad.up && !prevPad?.up) hud.phoneNav(0, -1); if (pad.down && !prevPad?.down) hud.phoneNav(0, 1); if (pad.a && !prevPad?.a) hud.phoneSelect(); if (pad.b && !prevPad?.b) { hud.phoneBack(); view.phoneUp = hud.phoneUp; } }
    if (Math.random() < dt * 2) { hud.ctx = phoneCtx(); if (hud.appOpen === 'Map') drawPhoneMap(); }
  }
  if (started && (f.map || (pad?.y && hud.landmapOn && !prevPad?.y))) toggleLandmap();
  if (hud.landmapOn) landmapInput(dt, k, pad);
  if (hud.ringing) { if (k.has('KeyY') || (pad?.a && !prevPad?.a)) hud.answer(true); else if (k.has('KeyN') || (pad?.b && !prevPad?.b)) hud.answer(false); }
  if (k.has('KeyV') && !firstPersonPressed) view.firstPerson = !view.firstPerson; firstPersonPressed = k.has('KeyV');
  if (pad?.r3 && !prevPad?.r3) view.firstPerson = !view.firstPerson;
  if (pad?.back && !prevPad?.back) view.atmo.cycleWeather();
  const lookX = f.lookX + (pad ? pad.rx * 900 * dt : 0), lookY = f.lookY + (pad ? pad.ry * 650 * dt : 0);
  const aiming = started && (f.aim || (pad?.lt ?? 0) > 0.4) && sim.local.alive && sim.local.vehicle === null && !view.phoneUp;
  const camInfo = view.cam.update(dt, sim as any, started ? lookX : 0, started ? lookY : 0, aiming);
  if (view.firstPerson && sim.local.vehicle !== null) cockpit();
  if (started && !hud.landmapOn) {
    const cmd = command(f, camInfo.aimDir, pad);
    acc += Math.min(dt, 0.1); let steps = 0;
    while (acc >= 1 / 60 && steps < 4) {
      sim.setCommand(0, cmd); sim.step(1 / 60);
      cmd.interact = false; cmd.reload = false; cmd.heal = false;
      acc -= 1 / 60; steps++;
    }
    view.handleEvents(sim.events, hud); sim.events.length = 0;
    tickJob(dt);
  }
  syncColliders();
  view.phoneUp = hud.phoneUp;
  view.frame(dt);
  if (started) {
    const me = sim.local; const w = sim.currentWeapon(me);
    const st = w && w.id !== 'fists' && WEAPONS[w.id].slot !== 'melee' ? weaponStats(w) : null;
    const ammo = st ? `${w!.mag} / ${me.inv.count(AMMO_STACK[st.ammo]!)}` : '';
    const P = me.vehicle !== null ? sim.vehicles[me.vehicle].body.translation() : me.pos;
    const veh = me.vehicle !== null ? sim.vehicles[me.vehicle] : null; const ms = veh ? veh.ctrl.currentVehicleSpeed() : 0; const kmh = Math.abs(ms) * 3.6;
    const gearN = Math.min(5, 1 + Math.floor(kmh / 30)); const rpm = !veh ? 0 : kmh < 1 ? 0.12 : 0.18 + 0.78 * ((kmh - (gearN - 1) * 30) / 30);
    const wk = !w || w.id === 'fists' ? 'none' : WEAPONS[w.id].slot === 'melee' ? 'melee' : 'gun';
    if (Math.random() < dt * 3) street = streetName(P.x, P.z);
    hud.update(dt, sim, { time: view.atmo.timeString(), real: view.atmo.realString(), weather: view.atmo.weatherLabel, temp: temperature(), area: areaName(P.x, P.z), street, weapon: w && w.id !== 'fists' ? WEAPONS[w.id].name : '', weaponKind: wk, mag: st ? String(w!.mag) : '', ammo: st ? String(me.inv.count(AMMO_STACK[st.ammo]!)) : '', aiming, inCar: me.vehicle !== null, bank: state.bank, kmh, gear: ms < -0.6 ? 'R' : kmh < 1 ? 'N' : String(gearN), rpm });
    void ammo;
    let note: string | null = null; const jobTg = activeJob ? (activeJob.stage === 0 ? activeJob.a : activeJob.b) : null;
    if (jobTg) {
      graphT -= dt; if (graphT <= 0) graphT = graph.sync(store.regions.values()) ? 0.15 : 0.6;
      guide.update(dt, P.x, P.z, me.vehicle !== null ? 'drive' : 'walk', jobTg);
      route = guide.remaining.length >= 4 ? guide.remaining : null;
      if (guide.lost) note = 'No road route yet'; else if (guide.next) { const n = guide.next, d = n.dist >= 1000 ? `${(n.dist / 1000).toFixed(1)} km` : `${Math.round(n.dist / 10) * 10} m`; note = n.dir === 'arrive' ? `${d} to go` : `${n.dir === 'uturn' ? 'U-turn' : n.dir === 'left' ? 'Turn left' : 'Turn right'} in ${d}`; }
    } else { if (guide.goal) guide.clear(); route = null; }
    routeLine?.update(view.time, jobTg ? guide.remaining : null, jobTg, 0.07, me.vehicle === null);
    parcelT -= dt; if (parcelT <= 0 && me.vehicle === null) { parcelT = 0.4; hud.parcel(parcelAt(me.pos.x, me.pos.z)); } else if (me.vehicle !== null) hud.parcel(null);
    const blips: { x: number; z: number; c: string; r?: number }[] = [];
    if (activeJob) { const tg = activeJob.stage === 0 ? activeJob.a : activeJob.b; blips.push({ x: tg.x, z: tg.z, c: '#3ddc84', r: 11 }); }
    for (const a of sim.actors) if (a.alive && a.role === 'police' && !(a as any)._gone) blips.push({ x: a.pos.x, z: a.pos.z, c: '#3b6cff', r: 6 });
    hud.drawRadar(sim.net, P.x, P.z, view.cam.yaw + Math.PI, blips, potholesNear(P.x, P.z, 160), state.owned.map((id) => state.ownedPts[id]).filter(Boolean), route, note);
    // prompts
    let pr: string | null = null;
    if (me.vehicle === null) for (const v of sim.liveVehicles()) { const p = v.body.translation(); if (Math.hypot(p.x - me.pos.x, p.z - me.pos.z) < 4) { pr = v.seats[0] !== null ? '<kbd>E</kbd>Jack this car' : (v as any).locked ? '<kbd>E</kbd>Break in' : '<kbd>E</kbd>Get in'; break; } }
    else pr = null;
    hud.prompt(pr);
    if (Math.random() < dt * 0.2) persist({ ...state, cash: sim.cash });
  }
  prevPad = pad;
  (window as any).__w.frames++;
  requestAnimationFrame(loop);
}

/** Cockpit camera: sit in the driver's seat and see the real interior. */
const eyeTmp = new THREE.Vector3();
function cockpit() {
  const me = sim.local; const v = sim.vehicles[me.vehicle!]; const p = v.body.translation(), r = v.body.rotation();
  const qn = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  const cm = view.cars.get(v.id)?.m;
  if (cm && seatEye(cm, me.seat, p, r, eyeTmp)) view.camera.position.copy(eyeTmp);
  else { const seat = new THREE.Vector3(me.seat % 2 === 0 ? 0.37 : -0.37, v.kind === 'okada' || v.kind === 'keke' ? 0.95 : v.kind === 'danfo' ? 0.75 : 0.62, v.kind === 'danfo' ? 1.45 : -0.3).applyQuaternion(qn); view.camera.position.set(p.x + seat.x, p.y + seat.y, p.z + seat.z); }
  const look = new THREE.Vector3(Math.sin(view.cam.yaw) * Math.cos(view.cam.pitch), Math.sin(view.cam.pitch), Math.cos(view.cam.yaw) * Math.cos(view.cam.pitch));
  view.camera.lookAt(view.camera.position.clone().add(look));
}

function areaName(x: number, z: number) {
  let best = '', bd = 1e9;
  for (const r of store.regions.values()) for (const p of r.pois) if (p.kind >= 30 && p.kind <= 35 && p.name) { const d = Math.hypot(p.x - x, p.z - z) * (p.kind === 30 || p.kind === 31 ? 1.6 : 1); if (d < bd) { bd = d; best = p.name; } }
  return best;
}
function phoneCtx(): PhoneCtx {
  return { time: view.atmo.timeString(), real: view.atmo.realString(), weather: view.atmo.weatherLabel, season: view.atmo.season.name, day: view.atmo.day, cash: sim.cash, bank: state.bank, plots: nearbyPlots(), jobs, texts, potholes: (potholeReports?.reports ?? []).map((r: any) => ({ name: r.name, road: r.road || (r.road_used ?? []).filter(Boolean).join(', '), area: r.area, reported: r.reported, placed: r.placed ?? 0, source: r.source })), quality: qualityLabel() };
}
function qualityLabel() {
  const name = pref === 'auto' ? 'Auto' : pref[0].toUpperCase() + pref.slice(1);
  return `${name} · ${LEVELS[view.level].name} · ${Math.round(gov.fps)} fps · ${Math.round(view.renderScale * 100)}% resolution`;
}
function drawPhoneMap() {
  const cv = document.getElementById('pmap') as HTMLCanvasElement | null; if (!cv) return; const g = cv.getContext('2d')!; const me = sim.local; const S = 0.18;
  g.fillStyle = '#d9d2c3'; g.fillRect(0, 0, 400, 400); g.save(); g.translate(200, 200); g.translate(-me.pos.x * S, -me.pos.z * S);
  for (const reg of store.regions.values()) for (const r of reg.roads) { if (r.cls > 8) continue; g.strokeStyle = r.cls <= 4 ? '#e0a92a' : '#fff'; g.lineWidth = r.cls <= 4 ? 3 : 1.4; g.beginPath(); for (let k = 0; k < r.pts.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, r.pts[k] * S, r.pts[k + 1] * S); g.stroke(); }
  g.fillStyle = '#c0392b'; for (const reg of store.regions.values()) for (const p of reg.potholes) if (p.report !== 255) g.fillRect(p.x * S - 1, p.z * S - 1, 2.5, 2.5);
  for (const id of state.owned) { const pts = state.ownedPts[id]; if (!pts) continue; g.fillStyle = '#9b4dff'; g.beginPath(); for (let k = 0; k < pts.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, pts[k] * S, pts[k + 1] * S); g.fill(); }
  if (activeJob) { const tg = activeJob.stage === 0 ? activeJob.a : activeJob.b; g.fillStyle = '#1fbf5f'; g.beginPath(); g.arc(tg.x * S, tg.z * S, 6, 0, 6.28); g.fill(); }
  g.fillStyle = '#111'; g.beginPath(); g.arc(me.pos.x * S, me.pos.z * S, 5, 0, 6.28); g.fill(); g.restore();
}
void WEATHER_ORDER;

boot().catch((e) => { console.error(e); hud.setLoad(1, 'Could not start: ' + (e?.message ?? e)); });
