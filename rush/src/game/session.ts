// One race on screen: builds the track's world, runs the RaceSim at a fixed 60 Hz, interpolates cars for rendering,
// turns race events into sound, effects and callouts, and records a replay.
import * as THREE from 'three';
import { RaceSim, itemsOn, type Entrant, type RaceConfig, type RaceEvent, type RemoteSnap } from '../shared/race';
import type { ResultRow, SnapCar, SnapHazard } from '../shared/protocol';
import type { Track, TrackData } from '../shared/track';
import type { CarInput } from '../shared/car';
import { idleInput } from '../shared/car';
import { carById, CARS, defaultLivery } from '../shared/cars';
import type { WorldView } from '../render/worldView';
import type { TrackView } from '../render/trackView';
import type { Props } from '../render/props';
import { TrafficView } from '../render/traffic3d';
import { HazardView } from '../render/hazards3d';
import { Fx } from '../render/fx';
import { CarModel, seeThroughNear } from '../render/cars3d';
import { ChaseCam } from '../render/camera';
import { setWorldUniforms } from '../render/materials';
import { Hud } from '../ui/hud';
import type { Stage } from './stage';
import { disposeTree } from './stage';
import type { Input } from './input';
import type { AudioEngine } from '../audio/audio';
import { ITEMS, type HazardKind } from '../shared/items';
import { clamp, lerp, wrapAngle } from '../shared/math';

/** Per car: x y z h pitch roll speed flags. Hazards on the road at that moment, when there are any. */
export interface ReplayFrame { t: number; cars: Float32Array; hz?: { id: number; kind: HazardKind; x: number; y: number; z: number; h: number; s: number }[] }
export interface SessionResult { standings: ReturnType<RaceSim['standings']>; playerIdx: number; replay: ReplayFrame[]; trackId: string; bestLap: number; cfg: RaceConfig }

/** What an online race needs from the room connection. The room server is the authority; this machine drives one car. */
export interface NetLink {
  raceNo: number;
  startAt: number;                                           // room clock (ms) at GO
  serverNow: () => number;                                   // room clock now (ms)
  remoteAt: (rt: number, skip: number) => Map<number, RemoteSnap>;
  hazards: () => SnapHazard[];
  drain: () => RaceEvent[];
  self: (idx: number) => SnapCar | null;
  sendState: (rt: number, s: RemoteSnap) => void;
  useItem: () => void;
  online: () => boolean;
}

export interface SessionOptions {
  track: TrackData; cfg: RaceConfig; entrants: Entrant[]; localId: string;
  political: boolean; skipIntro?: boolean;
  onFinish: (r: SessionResult) => void;
  /** set for an online race: the session follows the room and only simulates its own car */
  net?: NetLink | null;
  banner?: string;
  units?: 'kmh' | 'mph';
}

const STEP = 1 / 60;
const INTERP = 0.1;         // other cars are drawn this far in the past so they glide between snapshots
const SEND_EVERY = 0.05;    // our car goes to the room at 20 Hz
// the follower makes these itself from its own simulation, so the room's copies would double up on screen
const LOCAL_ONLY = new Set<RaceEvent['t']>(['lap', 'finish', 'countdown', 'go', 'done', 'launch', 'place']);

export class RaceSession {
  sim: RaceSim;
  track: Track;
  hud: Hud;
  cam: ChaseCam;
  fx: Fx;
  private group = new THREE.Group();
  private world: WorldView; private trackView: TrackView; private props: Props; private trafficView: TrafficView; private hazards: HazardView;
  private models: CarModel[] = [];
  private danfos: (CarModel | null)[] = [];
  private prev: Float32Array; private curr: Float32Array;
  private acc = 0; private t = 0;
  private playerIdx: number;
  private input: CarInput = idleInput();
  paused = false;
  /** Offline only: scripted playtests fast forward a race on slow test machines with this. */
  warp = 1;
  private ended = false; private endT = 0;
  private replay: ReplayFrame[] = []; private recT = 0;
  private flash = 0; private flashCol = new THREE.Color();
  private lightsN = 0;
  private introSkip = false;
  phase: 'intro' | 'countdown' | 'race' | 'finished' = 'intro';
  private lastPlace = 0;
  private trafficHonkT = 2;
  private net: NetLink | null;
  private needSync = false;
  private sendT = 0; private itemWas = false; private itemSentT = 0;
  private hzSeen = new Map<number, number>();
  get netRaceNo() { return this.net?.raceNo ?? -1; }

  constructor(private stage: Stage, private ui: HTMLElement, private audio: AudioEngine, private inp: Input, private opts: SessionOptions) {
    const s = stage.engine.settings;
    stage.political = opts.political;
    const scen = stage.sceneryFor(opts.track);
    this.track = scen.track;
    this.net = opts.net ?? null;
    // online, the countdown is whatever is left on the room clock (negative when joining a race already running)
    const countdown = this.net ? (this.net.startAt - this.net.serverNow()) / 1000 : 3.6;
    this.sim = new RaceSim(opts.track, opts.cfg, opts.entrants, { authority: !this.net, local: [opts.localId], countdown });
    if (this.net && countdown < -0.25) this.needSync = true;
    this.playerIdx = this.sim.cars.findIndex((c) => c.entrant.id === opts.localId);
    const shadows = s.shadows > 0;
    stage.ensureLandmarks();
    stage.atmos.set(opts.cfg.time, opts.cfg.weather, s.drawDistance, s.reflections);
    this.world = scen.world; this.trackView = scen.trackView; this.props = scen.props;
    // no power-ups in this race, no bags on the road
    if (this.trackView.bags) this.trackView.bags.visible = itemsOn(opts.cfg);
    this.trafficView = new TrafficView(this.sim.traffic.cars, shadows);
    this.fx = new Fx(s.particles);
    this.hazards = new HazardView(this.track, this.fx);
    this.group.add(this.trafficView.group, this.fx.group, this.hazards.group);
    stage.engine.scene.add(this.group);
    for (const rc of this.sim.cars) {
      const m = new CarModel(rc.def, rc.entrant.livery, { shadows, detail: rc.idx === this.playerIdx ? 2 : 1 });
      if (rc.entrant.livery.rims !== 'five') m.setRims(rc.entrant.livery.rims);
      this.group.add(m.root);
      this.models.push(m);
      this.danfos.push(null);
    }
    // compile the see-through versions of the rivals' materials now, not the first time one slips under the camera
    this.models.forEach((m, i) => { if (i !== this.playerIdx) m.fade(0.5); });
    stage.engine.renderer.compile(stage.engine.scene, stage.engine.camera);
    this.models.forEach((m) => m.fade(1));
    stage.engine.renderer.compile(stage.engine.scene, stage.engine.camera);
    const n = this.sim.cars.length;
    this.prev = new Float32Array(n * 6); this.curr = new Float32Array(n * 6);
    this.capture(this.curr); this.prev.set(this.curr);
    this.cam = new ChaseCam(stage.engine.camera);
    this.cam.motion = s.motionFx;
    // never film through a barrier: pull the camera in along the line to the car until it is back over the road
    let hint: { path: number; i: number } | undefined;
    this.cam.clamp = (c, p) => {
      const limit = Math.max(0.6, (c.q?.outside ?? 0) + 1);
      const q = this.track.query(p.x, p.y, p.z, hint);
      hint = { path: q.path, i: q.i };
      if (q.outside <= limit) return;
      let lo = 0, hi = 1;
      for (let k = 0; k < 6; k++) {
        const m = (lo + hi) / 2;
        const qq = this.track.query(c.x + (p.x - c.x) * m, p.y, c.z + (p.z - c.z) * m, hint);
        if (qq.outside <= limit) lo = m; else hi = m;
      }
      p.x = c.x + (p.x - c.x) * lo; p.z = c.z + (p.z - c.z) * lo;
      p.y = Math.max(p.y, c.y + 1.4 + (1 - lo) * 1.6);
    };
    const pc = this.sim.cars[this.playerIdx].c;
    this.cam.snapTo(pc);
    this.hud = new Hud(ui, this.track, this.playerIdx, opts.units ?? 'kmh');
    this.hud.show(false);
    if (opts.skipIntro || this.net) { this.beginCountdown(); if (opts.banner) this.hud.call(opts.banner, 'info', opts.track.name); }
    else this.cam.startIntro(opts.track.intro, (sx) => { const p = this.track.pointAt(sx); return new THREE.Vector3(p.x, p.y + 1, p.z); });
    // engines: ours, plus the three opponents nearest the grid slot
    audio.setPlayerEngine(this.sim.cars[this.playerIdx].def.sound);
    audio.setOpponents(this.sim.cars.filter((c) => c.idx !== this.playerIdx).slice(0, 3).map((c) => c.def.sound));
    audio.music_('race', 0);
    this.trackView.setLights(0, false);
  }

  get player() { return this.sim.cars[this.playerIdx]; }

  skipIntro() { if (this.phase === 'intro') this.introSkip = true; }

  private beginCountdown() {
    this.phase = 'countdown';
    this.cam.mode = 'chase';
    this.cam.snapTo(this.player.c);
    this.hud.show(true);
  }

  private capture(out: Float32Array) {
    this.sim.cars.forEach((rc, i) => { const c = rc.c; out.set([c.x, c.y, c.z, c.h, c.pitch, c.roll], i * 6); });
  }

  /** Advance and draw one frame. */
  frame(dt: number) {
    if (this.net) { this.netFrame(dt); return; }
    if (this.paused) { this.render(dt, 1); return; }
    this.t += dt;
    if (this.phase === 'intro') {
      if (this.inp.pressed('item') || this.inp.pressed('drift') || this.introSkip) this.cam.mode = 'chase';
      if (this.cam.introDone) this.beginCountdown();
      this.render(dt, 1);
      return;
    }
    // the sim only starts counting down once the intro is over
    const airborne = !this.player.c.grounded;
    this.input = this.inp.read(dt, airborne, this.steerAssist());
    if (this.inp.pressed('camera')) { this.cam.mode = this.cam.mode === 'hood' ? 'chase' : this.cam.far ? 'hood' : 'chase'; if (this.cam.mode === 'chase') this.cam.far = !this.cam.far; }
    if (this.inp.pressed('respawn') && this.sim.racing && this.player.c.respawnT <= 0) { this.player.c.respawnT = 0.9; }
    this.acc += dt * this.warp;
    const most = 5 * this.warp;
    let steps = 0;
    while (this.acc >= STEP && steps < most) {
      this.prev.set(this.curr);
      this.sim.step(STEP, { [this.opts.localId]: this.input });
      this.capture(this.curr);
      this.handle(this.sim.drainEvents());
      this.acc -= STEP; steps++;
      this.recT += STEP;
      if (this.recT >= 0.05) { this.recT = 0; this.record(); }
    }
    if (steps === most) this.acc = 0;
    if (this.sim.phase === 'racing' && this.phase === 'countdown') this.phase = 'race';
    this.render(dt, clamp(this.acc / STEP, 0, 1));
    if (this.ended) {
      this.endT += dt;
      if (this.endT > 4.5 && this.sim.phase !== 'done') this.sim.end();
      if (this.sim.phase === 'done' && this.endT > 4.5) this.finish();
    }
  }

  // ------------------------------------------------------------------------------------------- online

  /** One frame of an online race. The local clock is held to the room clock; other cars come from snapshots. */
  private netFrame(dt: number) {
    const net = this.net!;
    this.t += dt;
    const target = (net.serverNow() - net.startAt) / 1000;
    // a gap is skipped, not simulated. Our car stays ours unless the gap was long enough for the room's AI stand-in
    // to take over (it does after 8 s of silence); then we pick the car up from where the room has it.
    const behind = target - this.sim.time;
    if (behind > 6) { this.sim.time = target - STEP; this.needSync = true; }
    else if (behind > 0.75) this.sim.time = target - STEP;
    if (this.needSync && !this.trySync()) { this.render(dt, 1); return; }
    const airborne = !this.player.c.grounded;
    this.input = this.inp.read(dt, airborne, this.steerAssist());
    if (this.inp.pressed('camera')) { this.cam.mode = this.cam.mode === 'hood' ? 'chase' : this.cam.far ? 'hood' : 'chase'; if (this.cam.mode === 'chase') this.cam.far = !this.cam.far; }
    if (this.inp.pressed('respawn') && this.sim.racing && this.player.c.respawnT <= 0) this.player.c.respawnT = 0.9;
    // items are asked for, never used locally: the room rolls, fires and judges them
    const me = this.player.c;
    this.itemSentT = Math.max(0, this.itemSentT - dt);
    if (this.input.item && !this.itemWas && me.item && me.itemRoll <= 0 && this.sim.racing && !me.finished && me.danfoT <= 0 && this.itemSentT <= 0) { net.useItem(); this.itemSentT = 0.35; }
    this.itemWas = this.input.item;
    let steps = 0;
    // up to half a second of catch-up per frame: the sim is cheap, so even a slow phone stays on the room clock
    while (this.sim.time + STEP <= target + 1e-6 && steps < 30) {
      this.prev.set(this.curr);
      for (const [i, snap] of net.remoteAt(this.sim.time - INTERP, this.playerIdx)) if (this.sim.cars[i]?.control === 'remote') this.sim.setRemote(i, snap);
      this.sim.step(STEP, { [this.opts.localId]: this.input });
      this.capture(this.curr);
      this.handle(this.sim.drainEvents());
      steps++;
      this.recT += STEP;
      if (this.recT >= 0.05) { this.recT = 0; this.record(); }
    }
    // the room's decisions: item grants, hazards, hits, pickups
    const evs = net.drain();
    if (evs.length) {
      for (const e of evs) this.sim.applyAuthorityEvent(e);
      // a hit on our own car is re-emitted by the local sim when it is applied, so only other cars' hits show here
      this.handle(evs.filter((e) => !LOCAL_ONLY.has(e.t) && !(e.t === 'hit' && e.car === this.playerIdx)));
      this.handle(this.sim.drainEvents());
    }
    this.syncHazards();
    this.sendT += dt;
    if (this.sendT >= SEND_EVERY && net.online() && !this.reported) { this.sendT = 0; net.sendState(this.sim.time, this.sim.snapOf(this.playerIdx)); }
    if (this.sim.phase === 'racing' && this.phase === 'countdown') this.phase = 'race';
    // draw between the last two steps by how far the room clock has run past the newest one
    this.render(dt, clamp((target - this.sim.time) / STEP, 0, 1));
  }

  /** Put our car where the room last saw it (joining mid race, back from a dropout). False until a snapshot arrives. */
  private trySync() {
    const snap = this.net!.self(this.playerIdx);
    if (!snap) return false;
    const rc = this.player;
    this.sim.setRemote(this.playerIdx, snap.s);
    const c = rc.c;
    c.raceDist = snap.rd; c.lap = snap.lap; c.finished = snap.fin; c.place = snap.place;
    if (c.q) rc.prevS = c.q.sMain;
    c.respawnT = 0; c.spinT = 0; c.yawRate = 0;
    if (c.finished && !this.ended) { this.ended = true; this.cam.orbit(); }
    this.capture(this.curr); this.prev.set(this.curr);
    this.cam.snapTo(c);
    this.needSync = false;
    return true;
  }
  /** Called when the room resends the race we are already in (our line dropped and came back). */
  resync() { this.needSync = true; }

  /** Rockets fly on the room's clock; take their positions from the latest snapshot, and catch any we missed. */
  private syncHazards() {
    const hz = this.net!.hazards();
    const now = this.t;
    const live = new Set<number>();
    for (const h of hz) {
      live.add(h.id);
      let mine = this.sim.hazards.find((x) => x.id === h.id);
      if (!mine) { mine = { id: h.id, kind: h.k, owner: -1, x: h.x, y: h.y, z: h.z, h: h.h, s: h.s, d: h.d, vs: 0, target: -1, life: 30, armed: 0 }; this.sim.hazards.push(mine); }
      mine.x = h.x; mine.y = h.y; mine.z = h.z; mine.h = h.h; mine.s = h.s; mine.d = h.d;
      if (!this.hzSeen.has(h.id)) this.hzSeen.set(h.id, now);
    }
    // gone from the room for a while without a hazardGone reaching us: drop it
    this.sim.hazards = this.sim.hazards.filter((h) => { if (live.has(h.id)) return true; const seen = this.hzSeen.get(h.id); if (seen === undefined) { this.hzSeen.set(h.id, now); return true; } return now - seen < 0.6; });
  }

  /** The room's results arrived: this race is over, whatever our own view of it says. */
  netFinish(rows: ResultRow[]) {
    if (this.reported) return;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const base = this.sim.standings();
    const standings = base.map((s) => {
      const r = byId.get(s.id);
      return r ? { ...s, place: r.place, finished: r.time !== null, time: r.time, bestLap: r.bestLap ?? s.bestLap } : s;
    }).sort((a, b) => a.place - b.place);
    this.reported = true;
    this.phase = 'finished';
    this.hud.show(false);
    if (!this.ended) { this.ended = true; this.cam.orbit(); }
    this.opts.onFinish({ standings, playerIdx: this.playerIdx, replay: this.replay, trackId: this.opts.track.id, bestLap: this.player.c.bestLap, cfg: this.opts.cfg });
  }

  private steerAssist() {
    const c = this.player.c;
    if (!c.q) return null;
    const ahead = this.track.pointAt(c.q.sMain + 14, 0);
    const err = wrapAngle(Math.atan2(ahead.x - c.x, ahead.z - c.z) - c.h);
    return { curve: clamp(-err * 1.6, -1, 1) };
  }

  private record() {
    const n = this.sim.cars.length;
    const a = new Float32Array(n * 8);
    this.sim.cars.forEach((rc, i) => { const c = rc.c; a.set([c.x, c.y, c.z, c.h, c.pitch, c.roll, c.vf, (c.drifting ? 1 : 0) | (c.boostT > 0 || c.nitroOn ? 2 : 0) | (c.danfoT > 0 ? 4 : 0) | (c.driftTier << 4)], i * 8); });
    const hz = this.sim.hazards.length ? this.sim.hazards.map((h) => ({ id: h.id, kind: h.kind, x: h.x, y: h.y, z: h.z, h: h.h, s: h.s })) : undefined;
    this.replay.push({ t: this.sim.time, cars: a, hz });
    if (this.replay.length > 20 * 60 * 8) this.replay.shift();
  }

  private reported = false;
  private finish() {
    if (this.reported) return;
    this.reported = true;
    this.phase = 'finished';
    // the results screen takes over; the orbiting car stays on screen behind it, the HUD does not
    this.hud.show(false);
    this.opts.onFinish({ standings: this.sim.standings(), playerIdx: this.playerIdx, replay: this.replay, trackId: this.opts.track.id, bestLap: this.player.c.bestLap, cfg: this.opts.cfg });
  }

  // ------------------------------------------------------------------------------------------- events

  private handle(evs: RaceEvent[]) {
    const me = this.playerIdx;
    const a = this.audio, hud = this.hud;
    for (const e of evs) {
      const mine = 'car' in e && e.car === me;
      switch (e.t) {
        case 'countdown': hud.countdown(e.n); a.play('count'); this.lightsN = 4 - e.n; this.trackView.setLights(Math.min(5, (4 - e.n) * 2 - 1), false); break;
        case 'go': hud.countdown('GO'); a.play('go'); this.trackView.setLights(5, true); break;
        case 'launch': if (mine) { hud.call(e.quality === 'perfect' ? 'PERFECT START' : e.quality === 'good' ? 'GOOD START' : 'BOGGED DOWN', e.quality === 'bogged' ? 'bad' : 'good'); a.play('launch', e.quality === 'bogged' ? 0 : 1); if (e.quality !== 'bogged') this.cam.kick(1); } break;
        case 'driftTier': if (mine) a.play('drift', e.tier); break;
        case 'driftBoost': if (mine) { a.play('boost'); this.cam.kick(0.6 + e.tier * 0.25); this.inp.rumble(0.3, 120); } break;
        case 'wall': if (mine) { a.play('wall', e.impact); this.cam.shake(Math.min(0.35, e.impact * 0.02)); this.inp.rumble(Math.min(1, e.impact / 20), 140); } this.fx.sparks(e.x, e.y + 0.3, e.z, 1, 0, 0); break;
        case 'land': if (mine) { a.play('land'); this.cam.shake(0.12 + Math.min(0.2, e.airT * 0.1)); if (e.grade === 'crash') hud.call('CRASH LANDING', 'bad'); } this.fx.dust(this.sim.cars[e.car].c.x, this.sim.cars[e.car].c.y, this.sim.cars[e.car].c.z, 6); break;
        case 'respawn': if (mine) { a.play('respawn'); hud.call('TOW TRUCK', 'info', 'Back on the road'); } break;
        case 'lap': if (mine) { a.play(e.final ? 'final' : 'lap'); hud.call(e.final ? 'FINAL LAP' : `LAP ${e.lap}`, 'info', this.player.c.lastLap ? `${this.player.c.lastLap.toFixed(2)}s` : ''); if (e.final) a.music_('race', 1); } break;
        case 'finish': if (mine) { const p = e.place; a.play('finish'); hud.call(p === 1 ? 'YOU WIN!' : `FINISHED ${p}${['TH', 'ST', 'ND', 'RD'][p % 10 > 3 || [11, 12, 13].includes(p % 100) ? 0 : p % 10]}`, p <= 3 ? 'good' : 'info', p === 1 ? 'Oshodi is yours' : ''); this.fx.confetti(this.player.c.x, this.player.c.y, this.player.c.z); this.ended = true; this.cam.orbit(); } break;
        case 'place': if (mine) { a.play('place', e.to < e.from ? 1 : -1); } break;
        case 'pickup': if (mine) a.play('pickup'); break;
        case 'item': if (mine) { hud.itemRoll(); a.play('roll'); setTimeout(() => { a.play('item'); hud.call(ITEMS[e.item].name.toUpperCase(), 'info', ITEMS[e.item].hint); }, 1100); } break;
        case 'useItem': {
          const snd: Record<string, string> = { purewater: 'splash', pothole: 'pothole', horn: 'horn', rocket: 'rocket', genboost: 'boost', blackout: 'blackout', danfo: 'danfo', okada: 'okada' };
          if (mine || e.item === 'horn' || e.item === 'blackout' || e.item === 'okada') a.play(snd[e.item]);
          break;
        }
        case 'hazardGone': if (e.burst) { this.fx.explosion(e.x, e.y, e.z); a.play('explode'); } break;
        case 'hit': if (mine) {
          const msg: Record<string, string> = { purewater: 'SLIPPED ON PURE WATER', pothole: 'POTHOLE!', rocket: 'GALA ROCKET HIT', okada: 'OKADA SWARM!', horn: 'AGBERO HORN', danfo: 'FLATTENED BY A DANFO' };
          hud.call(msg[e.kind] ?? 'HIT', 'bad'); this.cam.shake(0.3); this.inp.rumble(0.8, 260); this.flashOn(0xff3020, 0.25);
          a.play(e.kind === 'pothole' ? 'pothole' : e.kind === 'purewater' ? 'splash' : 'explode');
        } else if (e.by === me) { hud.style('HIT', 50); }
          break;
        case 'dodge': if (mine) hud.call('DODGED!', 'good'); break;
        case 'horn': this.fx.burst(e.x, e.y + 0.5, e.z, [1, 0.8, 0.3], 30, 10, true); break;
        case 'blackout': if (e.victims.includes(me)) { a.play('blackout'); hud.call('NEPA TAKE LIGHT!', 'bad'); } else if (e.car === me) hud.call('LIGHTS OUT AHEAD', 'good'); break;
        case 'nearMiss': if (mine) a.play('nearMiss'); break;
        case 'trafficHit': if (mine) { a.play('wall', e.impact); if (Math.random() < 0.7) setTimeout(() => a.play('traffic'), 150); this.cam.shake(Math.min(0.3, e.impact * 0.02)); if (e.smashed) hud.style('SMASH', 30); } break;
        case 'bump': if (e.car === me || e.other === me) { a.play('bump'); this.cam.shake(Math.min(0.2, e.impact * 0.015)); } break;
        case 'shunt': if (mine) hud.call('SHUNT!', 'good', '+FUEL'); break;
        case 'slip': if (mine) { a.play('slip'); hud.style('SLIPSTREAM', 0); } break;
        case 'brt': if (mine) { a.play('brt'); hud.style('BRT LANE', 0); } break;
        case 'style': if (mine) hud.style(e.label, e.points); break;
        case 'spin': if (mine) this.cam.shake(0.15); break;
        case 'done': this.ended = true; if (this.endT < 4.5) this.endT = 4.5; break;
      }
    }
  }

  private flashOn(c: number, a: number) { this.flash = a; this.flashCol.set(c); this.stage.engine.fx.flashColor(c); }

  // ------------------------------------------------------------------------------------------- drawing

  private render(dt: number, alpha: number) {
    const st = this.stage, eng = st.engine;
    const night = st.atmos.night;
    setWorldUniforms(night, st.atmos.wet, this.t);
    this.props.setNight(night);
    const me = this.player.c;
    const top = this.player.def.topSpeed;
    this.sim.cars.forEach((rc, i) => {
      const c = rc.c;
      const o = i * 6;
      const P = this.prev, C = this.curr;
      const x = lerp(P[o], C[o], alpha), y = lerp(P[o + 1], C[o + 1], alpha), z = lerp(P[o + 2], C[o + 2], alpha);
      const h = P[o + 3] + wrapAngle(C[o + 3] - P[o + 3]) * alpha;
      let model = this.models[i];
      // Danfo Mode: the car becomes a big yellow bus for a few seconds
      if (c.danfoT > 0) {
        if (!this.danfos[i]) { const def = carById('danfo'); const lv = defaultLivery(def); this.danfos[i] = new CarModel(def, lv, { shadows: false, detail: 1 }); this.danfos[i]!.root.scale.setScalar(1.25); this.group.add(this.danfos[i]!.root); }
        model.root.visible = false; model = this.danfos[i]!; model.root.visible = true;
      } else if (this.danfos[i]) { this.danfos[i]!.root.visible = false; this.models[i].root.visible = true; }
      const lift = c.respawnT > 0 ? Math.sin(Math.min(1, (0.9 - c.respawnT) / 0.9) * Math.PI) * 3 : 0;
      model.root.position.set(x, y + lift, z);
      model.root.rotation.y = h;
      model.root.visible = !(c.ghostT > 0 && Math.floor(this.t * 12) % 2 === 0);
      const steer = i === this.playerIdx ? this.input.steer : rc.input.steer;
      const braking = (i === this.playerIdx ? this.input.brake : rc.input.brake) > 0.2 && c.vf > 2;
      model.pose(dt, c.vf, steer, c.roll + (c.drifting ? -c.driftDir * 0.04 : 0), c.grounded ? 0 : c.pitch, braking, night, c.nitroOn);
      this.effects(rc.idx, x, y, z, h, c, dt);
    });
    // traffic, hazards, bags
    this.trafficView.update(this.sim.trafficPoses);
    this.hazards.sync(this.sim.hazards, this.t, dt);
    this.trackView.updateBags(this.t, (i) => !!this.sim.bags[i] && this.sim.bags[i].respawn <= this.sim.time);
    this.props.updateCrowd(this.t);
    st.landmarks?.update(this.t);
    this.fx.update(dt);
    if (st.atmos.wet > 0) this.fx.rain(me.x + me.vx * 0.6, me.y, me.z + me.vz * 0.6, 1);
    // camera and post effects
    const boosting = me.boostT > 0 || me.nitroOn || me.danfoT > 0;
    if (this.phase !== 'intro') this.cam.update(dt, me, top, this.input.look, boosting);
    else this.cam.update(dt, me, top, false, false);
    seeThroughNear(eng.camera, this.models.map((m, i) => (this.danfos[i]?.root.visible ? this.danfos[i]! : m)), this.playerIdx, this.cam.mode === 'chase');
    const sp = clamp(Math.hypot(me.vx, me.vz) / top, 0, 1.3);
    eng.fx.set('uSpeed', eng.settings.motionFx && this.phase !== 'intro' ? clamp((sp - 0.55) * 2.2, 0, 1) * (boosting ? 1 : 0.6) : 0);
    eng.fx.set('uBlackout', clamp(me.blackoutT / 0.5, 0, 1) * (me.blackoutT > 0 ? 1 : 0));
    this.flash = Math.max(0, this.flash - dt * 1.5);
    eng.fx.set('uFlash', this.flash);
    if (eng.chroma) eng.chroma.offset.set(sp * 0.0014 * (boosting ? 2 : 1), 0);
    st.atmos.follow(eng.camera.position.x, me.y, eng.camera.position.z, 70, eng.settings.shadows, this.t);
    this.world.update(eng.camera.position.x, eng.camera.position.z);
    // audio
    const slip = me.grounded ? clamp(Math.abs(me.vr) / 8 + (me.drifting ? 0.5 : 0), 0, 1) : 0;
    const crowd = clamp(1 - Math.min(me.q ? Math.abs(this.track.gap(0, me.q.sMain)) : 999, 200) / 200, 0, 1);
    this.audio.driving(Math.hypot(me.vx, me.vz), top, this.input.throttle, boosting, !me.grounded, slip, dt, crowd);
    this.audio.listener(eng.camera.position.x, eng.camera.position.y, eng.camera.position.z, Math.sin(me.h), Math.cos(me.h));
    const others = this.sim.cars.filter((r) => r.idx !== this.playerIdx).sort((a, b) => Math.hypot(a.c.x - me.x, a.c.z - me.z) - Math.hypot(b.c.x - me.x, b.c.z - me.z)).slice(0, 3);
    others.forEach((r, k) => this.audio.opponent(k, r.c.x, r.c.y, r.c.z, Math.hypot(r.c.vx, r.c.vz), r.def.topSpeed));
    this.trafficHonkT -= dt;
    if (this.trafficHonkT <= 0) { this.trafficHonkT = 3 + Math.random() * 6; if (this.sim.trafficPoses.length && this.sim.racing) this.audio.play('traffic'); }
    // HUD
    if (this.phase !== 'intro') this.hud.update(this.sim, dt, Math.hypot(me.vx, me.vz) * 3.6);
    eng.frame();
  }

  private effects(i: number, x: number, y: number, z: number, h: number, c: RaceSession['player']['c'], dt: number) {
    const fx = this.fx;
    const fxv = Math.sin(h), fzv = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
    const def = this.sim.cars[i].def.shape;
    const rearZ = -def.wheelbase / 2, half = def.track / 2;
    const wheels = [[-half, rearZ], [half, rearZ]].map(([lx, lz]) => [x + rx * lx + fxv * lz, z + rz * lx + fzv * lz]);
    const sliding = c.grounded && (c.drifting || Math.abs(c.vr) > 3.5 || c.spinT > 0);
    const offRoad = c.q ? c.q.outside > -0.6 : false;
    wheels.forEach(([wx, wz], k) => {
      const key = `${i}:${k}`;
      if (sliding) { fx.skids.mark(key, wx, y, wz, clamp(Math.abs(c.vr) / 10 + (c.drifting ? 0.45 : 0), 0, 1)); fx.tyreSmoke(wx, y, wz, c.vx, c.vz, c.drifting ? 0.5 : 0.3, offRoad); }
      else fx.skids.lift(key);
      if (c.drifting && c.driftTier > 0) fx.sparks(wx, y, wz, c.driftTier, c.vx, c.vz);
      if (offRoad && c.grounded && Math.hypot(c.vx, c.vz) > 8 && Math.random() < 0.4) fx.tyreSmoke(wx, y, wz, c.vx, c.vz, 0.6, true);
      if (this.stage.atmos.wet > 0 && Math.hypot(c.vx, c.vz) > 10) fx.spray(wx, y, wz, c.vx, c.vz);
    });
    if (c.boostT > 0 || c.nitroOn) {
      const ex = x - fxv * (def.length / 2 + 0.1), ez = z - fzv * (def.length / 2 + 0.1);
      fx.flame(ex + rx * 0.35, y + 0.35, ez + rz * 0.35, fxv, fzv, c.nitroOn);
      fx.flame(ex - rx * 0.35, y + 0.35, ez - rz * 0.35, fxv, fzv, c.nitroOn);
    }
    void dt;
  }

  /** Offline the race freezes; online it cannot, so pausing only takes the controls away. */
  setPaused(p: boolean) {
    this.paused = p; this.inp.clearPressed();
    if (this.net) return;
    if (p) this.audio.music_('menu', 0); else this.audio.music_('race', this.player.c.lap === this.sim.cfg.laps ? 1 : 0);
  }
  get online() { return !!this.net; }

  dispose() {
    this.audio.stopEngines();
    this.stage.engine.scene.remove(this.group);
    disposeTree(this.group);
    for (const m of this.models) m.dispose();
    for (const d of this.danfos) d?.dispose();
    this.hud.dispose();
    this.stage.engine.fx.set('uSpeed', 0); this.stage.engine.fx.set('uBlackout', 0); this.stage.engine.fx.set('uFlash', 0);
    this.trackView.setLights(0, false);
  }
}

export function quickEntrants(player: Entrant, count: number, seed: number, classOf: string): Entrant[] {
  // AI picks cars near the player's class so the race is close
  const pool = CARS.filter((c) => c.cls === classOf || classOf === 'any');
  const list: Entrant[] = [];
  for (let i = 0; i < count - 1; i++) {
    const def = pool[(i * 7 + seed) % pool.length] ?? CARS[i % CARS.length];
    const lv = defaultLivery(def, `LAG ${(100 + ((i * 37 + seed) % 900)).toString()}`);
    if (i % 3 === 1) { lv.wrap = (['stripes', 'naija', 'fire', 'checker', 'ankara', 'adire'] as const)[(i + seed) % 6]; lv.wrapColor = ['#ffffff', '#111111', '#f6c514'][i % 3]; }
    lv.paint = ['#d0141c', '#0d4fa8', '#e6b11e', '#1b8a3a', '#101418', '#e8e2d6', '#ff6a00', '#7a2bd9', '#00a6a6', '#c8ccd0', '#ff2d8a'][(i * 5 + seed) % 11];
    lv.rims = (['five', 'mesh', 'multi', 'turbine', 'dish', 'split'] as const)[(i + seed) % 6];
    list.push({ id: `ai${i}`, name: '', carId: def.id, livery: lv, human: false });
  }
  // the player starts mid pack, the way arcade racers put you in the fight from the off
  const at = Math.min(list.length, Math.floor(count * 0.6));
  list.splice(at, 0, player);
  return list;
}
