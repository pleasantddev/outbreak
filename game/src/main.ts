// App shell: loading, lobby, drop map, match, results. Fixed 60Hz simulation, render at display rate.
import './ui/styles.css';
import * as THREE from 'three';
import { initPhysics } from './sim/physics';
import { Sim } from './sim/sim';
import { emptyCommand, type Command } from './sim/types';
import { CharacterAssets } from './render/characters';
import { MenuScene } from './render/menuScene';
import { GameView } from './render/gameView';
import { Menu } from './ui/menu';
import { Hud, renderCityMap } from './ui/hud';
import { Input } from './input/input';
import { loadProfile, saveProfile, currentOperator, type Profile } from './data/profile';
import { generateCity } from './world/cityGen';
import { LOADING_TIPS } from './data/copy';
import { ARCHETYPES } from './data/balance';
import { audio } from './audio/audio';
import { disposeMaterials } from './render/materials';

const app = document.getElementById('app')!;
app.className = 'grain';
app.innerHTML = `
  <canvas class="view" id="menuView"></canvas>
  <canvas class="view hidden" id="gameView"></canvas>
  <div id="menu" class="hidden"></div>
  <div id="hud" class="hidden"></div>
  <div id="drop" class="hidden"></div>
  <div id="loading"><div class="h1" style="font-size:54px;letter-spacing:0.14em">NIGHT<span style="color:var(--blood-hi)">FALL</span></div>
    <div class="label" style="margin-top:8px">Season 1 / The Awakening</div><div class="loadbar"><i id="lb"></i></div><div class="tip" id="tip"></div></div>`;
const $ = (id: string) => document.getElementById(id)!;
$('tip').textContent = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];

const profile: Profile = loadProfile();
const assets = new CharacterAssets();
let state: 'loading' | 'menu' | 'drop' | 'match' = 'loading';
let menuScene: MenuScene | null = null;
let menu: Menu | null = null;
let match: Match | null = null;
let last = performance.now();

// exposed for automated playtests
(window as any).NF = { get state() { return state; }, get match() { return match; }, profile };

async function boot() {
  const lb = $('lb');
  await initPhysics();
  lb.style.width = '15%';
  await assets.load((f) => (lb.style.width = `${15 + f * 80}%`));
  lb.style.width = '100%';
  audio.setVolume(profile.settings.volume, profile.settings.music);
  showMenu();
  $('loading').classList.add('hidden');
  requestAnimationFrame(loop);
  (window as any).NF_READY = true;
}

function showMenu() {
  state = 'menu';
  $('menuView').classList.remove('hidden'); $('gameView').classList.add('hidden');
  $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); $('drop').classList.add('hidden');
  menuScene = new MenuScene($('menuView') as HTMLCanvasElement, assets, profile.settings.quality);
  menu = new Menu($('menu'), profile, menuScene, () => showDrop());
}

function showDrop() {
  audio.init();
  state = 'drop';
  const seed = (Math.random() * 1e9) | 0;
  const city = generateCity(seed);
  const map = renderCityMap(city, 1);
  const el = $('drop');
  el.classList.remove('hidden'); $('menu').classList.add('hidden');
  const size = Math.min(window.innerWidth * 0.92, window.innerHeight * 0.68, 720);
  el.innerHTML = `<div style="width:${size}px"><div class="dropinfo"><div><div class="label">Choose where you land</div><div class="h1" style="font-size:26px">Oshodi / ${ARCHETYPES[profile.archetype].name}</div></div><div class="countdown" id="cd">15</div></div>
    <div class="maproot"><canvas id="dropmap" width="720" height="720" style="width:${size}px;height:${size}px"></canvas></div>
    <div style="display:flex;justify-content:space-between;margin-top:12px;gap:10px"><button class="btn" id="dropback">Back</button><div class="tip" id="droptip" style="margin:0;font-size:12px">Tap the map. Hot zones have better loot and more company.</div><button class="btn primary" id="deploy">Deploy</button></div></div>`;
  const cv = $('dropmap') as HTMLCanvasElement, g = cv.getContext('2d')!;
  let drop: { x: number; z: number } | null = null;
  const draw = () => {
    g.drawImage(map, 0, 0, 720, 720);
    g.strokeStyle = 'rgba(255,30,30,0.6)';
    for (const h of city.heartSites) { const x = h.p[0] + 360, z = h.p[2] + 360; g.strokeRect(x - 6, z - 6, 12, 12); }
    g.fillStyle = 'rgba(57,255,176,0.6)';
    for (const e of city.extractions) { g.beginPath(); g.arc(e.p[0] + 360, e.p[2] + 360, 6, 0, Math.PI * 2); g.fill(); }
    if (drop) { g.strokeStyle = '#e8e0d0'; g.lineWidth = 2; g.beginPath(); g.arc(drop.x + 360, drop.z + 360, 12, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(drop.x + 360 - 18, drop.z + 360); g.lineTo(drop.x + 360 + 18, drop.z + 360); g.moveTo(drop.x + 360, drop.z + 360 - 18); g.lineTo(drop.x + 360, drop.z + 360 + 18); g.stroke(); }
  };
  draw();
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 720 - 360, z = ((e.clientY - r.top) / r.height) * 720 - 360;
    if (x > city.water.x0 - 4 || Math.abs(x) > 340 || Math.abs(z) > 340) return;
    drop = { x, z }; draw(); audio.ui('click');
    const reg = city.regions.find((rg) => x >= rg.x0 && x < rg.x1 && z >= rg.z0 && z < rg.z1);
    $('droptip').textContent = `Landing in ${reg?.name ?? 'Oshodi'}.`;
  });
  let left = 15;
  const timer = setInterval(() => { left--; const cd = document.getElementById('cd'); if (cd) cd.textContent = String(left); if (left <= 0) go(); }, 1000);
  const go = () => { clearInterval(timer); startMatch(seed, drop); };
  $('deploy').addEventListener('click', go);
  $('dropback').addEventListener('click', () => { clearInterval(timer); el.classList.add('hidden'); $('menu').classList.remove('hidden'); state = 'menu'; });
}

function startMatch(seed: number, drop: { x: number; z: number } | null) {
  $('drop').classList.add('hidden');
  $('loading').classList.remove('hidden');
  ($('lb') as HTMLElement).style.width = '40%';
  $('tip').textContent = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
  setTimeout(() => {
    menuScene?.dispose(); menuScene = null; menu = null;
    disposeMaterials();
    $('menu').classList.add('hidden'); $('menuView').classList.add('hidden');
    $('gameView').classList.remove('hidden'); $('hud').classList.remove('hidden');
    match = new Match(seed, drop);
    $('loading').classList.add('hidden');
    state = 'match';
  }, 60);
}

function endMatch() {
  if (!match) return;
  const me = match.sim.local;
  const place = me.placement || 1;
  profile.matches++; profile.kills += me.kills;
  if (me.won) profile.wins++;
  profile.xp += Math.round(me.kills * 60 + me.creatureKills * 10 + (me.won ? 600 : Math.max(0, (13 - place) * 18)) + match.sim.time / 5);
  profile.naira += me.kills * 1500 + (me.won ? 15000 : 0) + me.inv.contrabandValue() / 10;
  saveProfile(profile);
  match.dispose(); match = null;
  showMenu();
}

class Match {
  sim: Sim; view: GameView; hud: Hud; input: Input;
  acc = 0; paused = false;
  private deadShown = false;
  private lastSlot = 1;
  constructor(seed: number, drop: { x: number; z: number } | null) {
    const op = currentOperator(profile);
    this.sim = new Sim({ seed, name: profile.callsign || op.name, look: op.look, archetype: profile.archetype, armory: profile.armory, bots: 11, minutes: profile.settings.matchMinutes, drop: drop ? { x: drop.x, y: 0, z: drop.z } : null });
    const canvas = $('gameView') as HTMLCanvasElement;
    this.view = new GameView(canvas, this.sim, assets, profile.settings.quality, profile.armory);
    this.view.gore = profile.settings.gore;
    this.view.cam.sens = profile.settings.sensitivity; this.view.cam.invertY = profile.settings.invertY; this.view.cam.baseFov = profile.settings.fov;
    this.view.cam.yaw = this.sim.local.yaw;
    this.input = new Input(canvas, profile.settings.touchControls);
    this.hud = new Hud($('hud'), this.sim, this.input.touch);
    this.hud.showFps = profile.settings.showFps;
    this.hud.setCamera(this.view.engine.camera);
    this.hud.onLeave = () => endMatch();
    this.hud.onResume = () => { this.paused = false; };
    audio.init(); audio.startAmbience();
  }

  private command(f: ReturnType<Input['frame']>, aimDir: THREE.Vector3): Command {
    const c = emptyCommand();
    const me = this.sim.local, cam = this.view.cam;
    if (me.vehicle !== null) { c.mx = f.mx; c.mz = f.my; }
    else {
      const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
      const rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
      let mx = rx * f.mx + fx * f.my, mz = rz * f.mx + fz * f.my;
      const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
      c.mx = mx; c.mz = mz;
    }
    c.yaw = Math.atan2(aimDir.x, aimDir.z); c.pitch = Math.asin(Math.max(-1, Math.min(1, aimDir.y)));
    c.aimDir = { x: aimDir.x, y: aimDir.y, z: aimDir.z };
    c.sprint = f.sprint; c.crouch = f.crouch; c.jump = f.jump; c.aim = f.aim; c.fire = f.fire;
    c.reload = f.reload; c.interact = f.interact; c.ability1 = f.ab1; c.ability2 = f.ab2; c.heal = f.heal; c.awaken = f.awaken; c.throwFrag = f.frag;
    c.flashlight = f.flashlight ? !me.cmd.flashlight : me.cmd.flashlight;
    if (me.vehicle !== null) { if (f.slot >= 0 && f.slot <= 2) c.slot = f.slot; else if (f.slot >= 104) c.slot = f.slot - 101; }
    else if (f.slot === 99) { const order = [0, 1, 2].filter((i) => i === 2 || (i === 0 ? me.inv.primary : me.inv.secondary)); c.slot = order[(order.indexOf(me.slot) + 1) % order.length]; }
    else if (f.slot >= 0 && f.slot <= 2) c.slot = f.slot;
    if (this.hud.pendingDrop >= 0) { c.dropIndex = this.hud.pendingDrop; this.hud.pendingDrop = -1; }
    void this.lastSlot;
    return c;
  }

  frame(dt: number) {
    const f = this.input.frame();
    if (f.pause) { this.hud.toggle('pause'); this.paused = this.hud.overlay === 'pause'; if (this.paused) this.input.releasePointer(); }
    if (f.map) this.hud.toggle('map');
    if (f.inventory) { this.hud.toggle('inventory'); if (this.hud.overlay === 'inventory') this.input.releasePointer(); }
    const blocked = this.hud.overlay === 'pause' || this.hud.overlay === 'inventory' || this.hud.overlay === 'end';
    this.input.enabled = !blocked;
    const look = blocked ? { x: 0, y: 0 } : { x: f.lookX, y: f.lookY };
    const aiming = !blocked && f.aim && this.sim.local.alive;
    const camInfo = this.view.cam.update(dt, this.sim, look.x, look.y, aiming);
    if (!this.paused) {
      const cmd = blocked ? emptyCommand() : this.command(f, camInfo.aimDir);
      if (blocked) { cmd.yaw = this.sim.local.yaw; cmd.flashlight = this.sim.local.cmd.flashlight; }
      this.acc += Math.min(dt, 0.1);
      let steps = 0;
      while (this.acc >= 1 / 60 && steps < 4) {
        this.sim.setCommand(0, cmd);
        this.sim.step(1 / 60);
        // edge-triggered buttons should only fire on the first sub-step
        cmd.interact = false; cmd.reload = false; cmd.ability1 = false; cmd.ability2 = false; cmd.heal = false; cmd.awaken = false; cmd.throwFrag = false; cmd.dropIndex = -1;
        this.acc -= 1 / 60; steps++;
      }
      this.view.handleEvents(this.sim.events, this.hud);
      this.sim.events.length = 0;
    }
    this.view.frame(this.paused ? 0 : dt);
    const me = this.sim.local;
    audio.setListener(this.view.engine.camera.position, this.view.cam.yaw);
    audio.tick(dt, me.alive ? Math.max(0, 1 - me.hp / 35) : 0, this.sim.heart.active);
    audio.generators(this.sim.city.props.filter((p) => p.type === 'generator' && Math.hypot(p.p[0] - me.pos.x, p.p[2] - me.pos.z) < 40).slice(0, 3).map((p) => ({ x: p.p[0], y: 1, z: p.p[2] })));
    this.hud.update(dt, this.view.cam.yaw, camInfo.scoped, this.input.locked);
    if ((!me.alive || me.won || this.sim.ended) && !this.deadShown) { this.deadShown = true; setTimeout(() => this.hud.showEnd(), me.won || this.sim.ended ? 2500 : 1800); this.input.releasePointer(); }
  }
  dispose() { this.input.dispose(); audio.stopAll(); this.view.dispose(); disposeMaterials(); $('hud').innerHTML = ''; }
}

function loop(t: number) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  if (state === 'menu' && menuScene) menuScene.frame(dt);
  if (state === 'match' && match) match.frame(dt);
  requestAnimationFrame(loop);
}

boot().catch((e) => { console.error(e); $('tip').textContent = `Failed to start: ${e?.message ?? e}`; });
