// The app shell: splash, loading, the screen stack, the render loop, settings application, and the hand-off between
// the menu backdrop and a race. Keyboard, gamepad and touch all drive the menus.
import '../ui/styles.css';
import { Stage } from '../game/stage';
import { RaceSession, type SessionResult, type NetLink } from '../game/session';
import { MenuScene, type MenuView } from '../render/menuScene';
import { AudioEngine } from '../audio/audio';
import { Input, TouchControls } from '../game/input';
import { loadProfile, saveProfile, type Profile, setPreset } from './profile';
import { detectDevice, guessPreset, refineByBenchmark, PRESET_LABEL, PRESETS, type GraphicsSettings, type PresetId } from '../render/quality';
import { defaultRaceConfig, type Entrant, type RaceConfig } from '../shared/race';
import { normaliseCode, type RaceStart, type ResultRow } from '../shared/protocol';
import type { TrackData } from '../shared/track';
import { splashScreen } from '../ui/screens/splash';
import { mainMenu } from '../ui/screens/main';
import { resultsScreen, pauseScreen, testDrive } from '../ui/screens/raceflow';
import { routeParams } from './route';
import { buildDesigns, designTrackId } from './designs';
import { onlineResults, multiplayer, joinRoom } from '../ui/screens/online';
import { ReplayPlayer } from '../game/replay';
import { NetClient } from '../net/client';

export interface Screen { el: HTMLElement; view?: MenuView; onBack?: () => boolean | void; onLeave?: () => void; onFrame?: (dt: number) => void; keepMenu?: boolean }
export type ScreenFn = (app: App) => Screen;

export class App {
  profile: Profile;
  stage: Stage | null = null;
  audio: AudioEngine;
  input: Input;
  touch: TouchControls | null = null;
  ui: HTMLElement;
  canvas: HTMLCanvasElement;
  menu: MenuScene | null = null;
  session: RaceSession | null = null;
  replay: ReplayPlayer | null = null;
  net: NetClient;
  private stack: { fn: ScreenFn; screen: Screen }[] = [];
  private perfEl: HTMLDivElement | null = null;
  private padRepeat = 0; private padPrev: Record<string, boolean> = {};
  isTouch: boolean;
  lastResult: SessionResult | null = null;
  lastRace: { track: TrackData; cfg: RaceConfig; entrants: Entrant[] } | null = null;
  onRaceEnd: ((r: SessionResult) => void) | null = null;
  /** a room code from an invite link (?room=LAGOS-1234), joined once the player is past the splash */
  pendingInvite: string;

  constructor() {
    this.isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
    this.profile = loadProfile(this.isTouch);
    this.ui = document.getElementById('ui')!;
    this.canvas = document.getElementById('gl') as HTMLCanvasElement;
    this.audio = new AudioEngine(this.profile.settings.audio);
    this.input = new Input(this.profile.settings.input);
    this.net = new NetClient(this);
    this.pendingInvite = normaliseCode(new URLSearchParams(location.search).get('room') ?? '');
    this.applyAccess();
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.session && !this.session.paused) this.pause(); });
    window.addEventListener('beforeunload', () => saveProfile(this.profile, true));
  }

  // ------------------------------------------------------------------------------------------- boot

  async boot() {
    this.show(splashScreen, true);
    // ?gfx=potato|low|medium|high|ultra forces a preset: handy for support ("try ?gfx=low") and for testing
    const forced = new URLSearchParams(location.search).get('gfx');
    if (forced && forced in PRESETS) { setPreset(this.profile, forced as PresetId, false); this.profile.settings.deviceChecked = true; }
    const settings = this.profile.settings.graphics;
    if (!this.profile.settings.deviceChecked || settings.auto) {
      const dev = detectDevice();
      const guess = guessPreset(dev);
      if (!this.profile.settings.deviceChecked) setPreset(this.profile, guess, true);
    }
    try {
      this.stage = await Stage.load(this.canvas, this.profile.settings.graphics, (f, l) => this.emitProgress(f, l));
    } catch (err) {
      this.emitProgress(1, 'Could not start the 3D engine on this device');
      console.error(err);
      return;
    }
    // routes drawn in the race designer race offline next to the official ones
    try { this.stage.tracks.push(...(await buildDesigns(this.stage.world))); } catch (err) { console.warn('designs not loaded', err); }
    this.emitProgress(0.96, 'Warming up');
    this.menu = new MenuScene(this.stage, this.stage.tracks[0]);
    const car = this.profile.garage.find((g) => g.carId === this.profile.current) ?? this.profile.garage[0];
    this.menu.setLook(this.profile.look);
    this.menu.setCar(car.carId, car.livery);
    // Auto preset: time a few frames of the real scene and step the preset up or down once
    if (this.profile.settings.graphics.auto && !this.profile.settings.deviceChecked) {
      this.menu.frame(0.016);
      const ms = await this.stage.engine.benchmark(24);
      const next = refineByBenchmark(this.profile.settings.graphics.preset as never, ms, this.profile.settings.graphics.targetFps);
      if (next !== this.profile.settings.graphics.preset) { setPreset(this.profile, next, true); this.applyGraphics(); }
      this.profile.settings.deviceChecked = true;
      saveProfile(this.profile);
      console.log(`auto graphics: ${ms.toFixed(1)} ms per frame, preset ${PRESET_LABEL[next]}`);
    }
    this.emitProgress(1, 'Ready');
    (window as unknown as { __rushReady: boolean }).__rushReady = true;
    this.loop();
    // ?test=<design> (or #test.<design>) comes from the designer's Test drive button: straight onto the grid
    const test = routeParams().get('test');
    if (test) {
      const id = designTrackId(test);
      if (this.stage.tracks.some((t) => t.id === id)) testDrive(this, id);
      else this.toast('That design does not build. Open it in the designer to see why.');
    }
  }

  private emitProgress(f: number, label: string) { window.dispatchEvent(new CustomEvent('rush-progress', { detail: { f, label } })); }

  private last = performance.now();
  private loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.pollPad(dt);
    this.net.tick(dt);
    if (this.session) this.session.frame(dt);
    else if (this.replay) this.replay.frame(dt);
    else if (this.menu) this.menu.frame(dt);
    this.top?.screen.onFrame?.(dt);
    if (this.perfEl && this.stage) { const p = this.stage.engine.perf; this.perfEl.textContent = `${p.fps} FPS  ${p.ms.toFixed(1)} ms  ${p.calls} calls  ${(p.tris / 1000).toFixed(0)}k tris  ${p.w}x${p.h} @${(p.scale * 100).toFixed(0)}%  ${this.stage.engine.settings.preset}`; }
    requestAnimationFrame(this.loop);
  };

  // ------------------------------------------------------------------------------------------- screens

  get top() { return this.stack[this.stack.length - 1]; }

  show(fn: ScreenFn, replace = false) {
    const prev = this.top;
    if (prev) { prev.screen.onLeave?.(); const el = prev.screen.el; el.classList.add('out'); setTimeout(() => el.remove(), 220); }
    if (replace) this.stack.length = 0;
    else if (prev && !replace) { /* keep it on the stack */ }
    const screen = fn(this);
    this.stack.push({ fn, screen });
    this.ui.appendChild(screen.el);
    if (this.menu && screen.view) this.menu.view = screen.view;
    requestAnimationFrame(() => this.focusFirst());
    return screen;
  }
  go(fn: ScreenFn) { this.audio.play('uiOk'); return this.show(fn); }
  back() {
    const cur = this.top;
    if (!cur || this.stack.length <= 1) return;
    if (cur.screen.onBack?.() === false) return;
    this.audio.play('uiBack');
    cur.screen.onLeave?.();
    cur.screen.el.classList.add('out'); setTimeout(() => cur.screen.el.remove(), 220);
    this.stack.pop();
    const prev = this.top;
    // rebuild the previous screen so it reflects any changes made in the one we leave
    const fresh = prev.fn(this);
    prev.screen.el.remove();
    prev.screen = fresh;
    this.ui.appendChild(fresh.el);
    if (this.menu && fresh.view) this.menu.view = fresh.view;
    requestAnimationFrame(() => this.focusFirst());
  }
  home() { while (this.stack.length > 1) { const s = this.stack.pop()!; s.screen.onLeave?.(); s.screen.el.remove(); } const t = this.top; if (t?.fn !== mainMenu) this.show(mainMenu, true); else { const f = t.fn(this); t.screen.el.remove(); t.screen = f; this.ui.appendChild(f.el); if (this.menu && f.view) this.menu.view = f.view; } }
  /** Re-render the current screen in place (state changed). Not a navigation, so onLeave is not called. */
  refresh() {
    const t = this.top; if (!t) return;
    const scrollers = Array.from(t.screen.el.querySelectorAll<HTMLElement>('.scroll')).map((s) => s.scrollTop);
    const focusAct = (document.activeElement as HTMLElement | null)?.dataset;
    const f = t.fn(this);
    f.el.style.animation = 'none';
    t.screen.el.replaceWith(f.el); t.screen = f;
    f.el.querySelectorAll<HTMLElement>('.scroll').forEach((s, i) => { s.scrollTop = scrollers[i] ?? 0; });
    if (focusAct?.act) {
      const sel = `[data-act="${focusAct.act}"]${focusAct.v ? `[data-v="${CSS.escape(focusAct.v)}"]` : ''}${focusAct.id ? `[data-id="${CSS.escape(focusAct.id)}"]` : ''}${focusAct.k ? `[data-k="${CSS.escape(focusAct.k)}"]` : ''}`;
      (f.el.querySelector(sel) as HTMLElement | null)?.focus({ preventScroll: true });
    }
  }

  toast(msg: string, ms = 2200) {
    const t = document.createElement('div'); t.className = 'toast panel'; t.textContent = msg;
    this.ui.appendChild(t); setTimeout(() => t.remove(), ms);
  }

  modal(html: string, bind: (el: HTMLElement, close: () => void) => void) {
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<div class="modal panel" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    this.ui.appendChild(back);
    bind(back.querySelector('.modal')!, close);
    requestAnimationFrame(() => (back.querySelector('button, input') as HTMLElement | null)?.focus());
    return close;
  }

  private focusFirst() {
    if (this.isTouch) return;
    const el = this.top?.screen.el.querySelector<HTMLElement>('[data-autofocus], nav button, .card, .btn');
    el?.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------------------------------- input for menus

  private onKey(e: KeyboardEvent) {
    if (!this.stage || this.replay) return; // the replay player has its own keys
    const tag = (document.activeElement as HTMLElement)?.tagName;
    if (this.session) {
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.session.phase !== 'finished') { e.preventDefault(); if (this.session.paused) this.resume(); else this.pause(); }
      if (this.session.phase === 'intro' && (e.code === 'Space' || e.code === 'Enter')) this.session.skipIntro();
      return;
    }
    if (tag === 'INPUT' || tag === 'SELECT') { if (e.code === 'Escape') (document.activeElement as HTMLElement).blur(); return; }
    if (e.code === 'Escape' || e.code === 'Backspace') { e.preventDefault(); if (document.querySelector('.modal-back')) document.querySelector('.modal-back')!.remove(); else this.back(); return; }
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] }[e.code];
    if (dir) { e.preventDefault(); this.moveFocus(dir[0], dir[1]); }
  }

  moveFocus(dx: number, dy: number) {
    const root = (document.querySelector('.modal-back .modal') as HTMLElement) ?? this.top?.screen.el;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, [tabindex="0"]')).filter((el) => el.offsetParent !== null);
    const cur = document.activeElement as HTMLElement;
    if (!items.includes(cur)) { items[0]?.focus(); return; }
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best: HTMLElement | null = null, bs = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
      const along = x * dx + y * dy;
      if (along <= 4) continue;
      const across = Math.abs(x * dy - y * dx);
      const score = along + across * 2.2;
      if (score < bs) { bs = score; best = el; }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); this.audio.play('ui'); }
  }

  private pollPad(dt: number) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p) => p && p.connected);
    if (!gp) return;
    const btn = (i: number) => !!gp.buttons[i]?.pressed;
    const edge = (name: string, on: boolean) => { const was = this.padPrev[name]; this.padPrev[name] = on; return on && !was; };
    if (this.session) {
      if (edge('start', btn(9))) { if (this.session.paused) this.resume(); else this.pause(); }
      if (this.session.phase === 'intro' && edge('a', btn(0))) this.session.skipIntro();
      if (!this.session.paused) return;
    }
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
    const dx = btn(15) || ax > 0.6 ? 1 : btn(14) || ax < -0.6 ? -1 : 0, dy = btn(13) || ay > 0.6 ? 1 : btn(12) || ay < -0.6 ? -1 : 0;
    this.padRepeat -= dt;
    if ((dx || dy) && this.padRepeat <= 0) { this.moveFocus(dx, dy); this.padRepeat = 0.18; }
    if (!dx && !dy) this.padRepeat = 0;
    if (edge('a', btn(0))) (document.activeElement as HTMLElement)?.click();
    if (edge('b', btn(1))) { if (this.session?.paused) this.resume(); else this.back(); }
  }

  // ------------------------------------------------------------------------------------------- settings

  applyGraphics() {
    if (!this.stage) return;
    const s = this.profile.settings.graphics;
    this.stage.engine.apply(s);
    this.stage.atmos.set(this.stage.atmos.time, this.stage.atmos.weather, s.drawDistance, s.reflections);
    if (s.showPerf && !this.perfEl) { this.perfEl = document.createElement('div'); this.perfEl.className = 'perf'; document.body.appendChild(this.perfEl); }
    if (!s.showPerf && this.perfEl) { this.perfEl.remove(); this.perfEl = null; }
    saveProfile(this.profile);
  }
  /** Settings that need the city rebuilt (detail, props, shadows) take effect on the next race or menu return. */
  rebuildScenery() {
    if (!this.stage) return;
    this.stage.ensureLandmarks();
    if (this.menu && !this.session) {
      this.menu.dispose();
      this.menu = new MenuScene(this.stage, this.stage.tracks[0]);
      const car = this.profile.garage.find((g) => g.carId === this.profile.current) ?? this.profile.garage[0];
      this.menu.setCar(car.carId, car.livery);
      this.menu.view = this.top?.screen.view ?? 'city';
    }
  }
  applyAccess() {
    const a = this.profile.settings.access;
    document.documentElement.classList.toggle('cb-safe', a.cbSafe);
    document.documentElement.classList.toggle('reduce-motion', a.reduceMotion);
    document.documentElement.classList.toggle('high-contrast', a.highContrast);
    document.documentElement.style.setProperty('--ui-scale', String(a.uiScale));
  }
  graphics(): GraphicsSettings { return this.profile.settings.graphics; }

  // ------------------------------------------------------------------------------------------- races

  startRace(track: TrackData, cfg: RaceConfig, entrants: Entrant[], onEnd: (r: SessionResult) => void, net: NetLink | null = null, banner = '') {
    if (!this.stage) return;
    this.lastRace = { track, cfg, entrants: structuredClone(entrants) };
    this.onRaceEnd = onEnd;
    for (const s of this.stack) { s.screen.onLeave?.(); s.screen.el.remove(); }
    this.stack.length = 0;
    this.menu?.dispose(); this.menu = null;
    this.replay?.dispose(); this.replay = null;
    this.input.enabled = true;
    if (this.isTouch) { if (!this.touch) this.touch = new TouchControls(this.ui); this.touch.show(true); document.documentElement.classList.add('touch-on'); }
    this.session = new RaceSession(this.stage, this.ui, this.audio, this.input, {
      track, cfg, entrants, localId: net ? this.net.you : this.profile.id, political: this.profile.settings.gameplay.political, skipIntro: this.profile.settings.gameplay.skipIntro,
      onFinish: (r) => this.finishRace(r), net, banner, units: this.profile.settings.gameplay.units,
    });
    const cam = this.profile.settings.gameplay.camera;
    if (cam === 'far') this.session.cam.far = true; else if (cam === 'hood') this.session.cam.mode = 'hood';
  }

  private finishRace(r: SessionResult) {
    this.lastResult = r;
    this.touch?.show(false); document.documentElement.classList.remove('touch-on');
    const cb = this.onRaceEnd;
    // keep the finished race on screen behind the results, camera orbiting the car
    this.show(this.session?.online ? onlineResults : resultsScreen, true);
    cb?.(r);
  }

  // ------------------------------------------------------------------------------------------- online races

  /** The room started a race (or resent the one we are in after a reconnect). */
  startOnline(race: RaceStart) {
    if (!this.stage) return;
    if (this.session && this.session.netRaceNo === race.raceNo) { this.session.resync(); return; }
    const me = race.entrants.find((e) => e.id === this.net.you);
    if (!me) return; // joined while this one was running: watching from the lobby, in for the next
    const td = this.stage.tracks.find((t) => t.id === race.cfg.track) ?? this.stage.tracks[0];
    const cfg: RaceConfig = { ...defaultRaceConfig(td.id, race.cfg.laps), mode: race.cfg.mode, traffic: race.cfg.traffic, aiLevel: race.cfg.aiLevel, time: race.cfg.time, weather: race.cfg.weather, seed: race.seed, finishGrace: 25 };
    const entrants: Entrant[] = race.entrants.map((e) => ({ ...e, livery: { ...e.livery } }));
    this.rememberPlayers(entrants);
    document.querySelector('.modal-back')?.remove();
    if (this.session) { this.session.dispose(); this.session = null; }
    const room = this.net.room;
    const banner = room && room.config.races > 1 ? `RACE ${race.raceNo} OF ${room.config.races}` : 'ONLINE RACE';
    this.startRace(td, cfg, entrants, () => {}, this.net.link(race), banner);
  }

  /** The room's final word on a race. */
  onlineResults(rows: ResultRow[]) {
    if (this.session?.online) this.session.netFinish(rows);
  }

  leaveOnline() {
    this.net.leave();
    this.leaveRace();
    this.show(mainMenu, true);
    this.show(multiplayer);
  }

  private rememberPlayers(entrants: Entrant[]) {
    const p = this.profile, now = Date.now();
    for (const e of entrants) {
      if (!e.human || e.id === this.net.you) continue;
      p.recent = p.recent.filter((r) => r.id !== e.id);
      p.recent.unshift({ id: e.id, name: e.name, crew: e.crew, at: now });
    }
    p.recent = p.recent.slice(0, 24);
    saveProfile(p);
  }

  /** Called once the player is through the splash: follow an invite link straight into its room. */
  consumeInvite() {
    const code = this.pendingInvite;
    if (!code) return;
    this.pendingInvite = '';
    history.replaceState(null, '', location.pathname);
    this.show(multiplayer);
    this.show(joinRoom);
    this.net.joinRoom(code);
    this.toast(`Joining ${code}`);
  }

  leaveRace() {
    this.session?.dispose(); this.session = null;
    this.replay?.dispose(); this.replay = null;
    this.touch?.show(false); document.documentElement.classList.remove('touch-on');
    if (this.stage && !this.menu) {
      this.menu = new MenuScene(this.stage, this.stage.tracks[0]);
      const car = this.profile.garage.find((g) => g.carId === this.profile.current) ?? this.profile.garage[0];
      this.menu.setCar(car.carId, car.livery);
      this.stage.atmos.set('dusk', 'clear', this.graphics().drawDistance, this.graphics().reflections);
    }
    this.audio.music_('menu', 0);
  }

  pause() { if (!this.session || this.session.phase === 'finished') return; this.session.setPaused(true); this.input.enabled = false; this.touch?.show(false); this.show(pauseScreen); }
  resume() { if (!this.session) return; const t = this.top; if (t) { t.screen.el.remove(); this.stack.pop(); } this.session.setPaused(false); this.input.enabled = true; if (this.isTouch) this.touch?.show(true); }

  watchReplay() {
    if (!this.lastResult || !this.stage || !this.lastRace) return;
    const r = this.lastResult;
    for (const s of this.stack) { s.screen.onLeave?.(); s.screen.el.remove(); }
    this.stack.length = 0;
    this.session?.dispose(); this.session = null;
    this.menu?.dispose(); this.menu = null;
    const track = this.stage.tracks.find((t) => t.id === r.trackId)!;
    // back out of the replay to the same results (already paid, so nothing is granted twice)
    this.replay = new ReplayPlayer(this.stage, this.ui, track, r, this.lastRace.entrants, () => { this.replay?.dispose(); this.replay = null; this.leaveRace(); this.show(resultsScreen, true); });
  }
}

export function boot() {
  const app = new App();
  (window as unknown as { __app: App }).__app = app;
  void app.boot();
}
