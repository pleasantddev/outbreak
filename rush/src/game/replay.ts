// Race replay: the recorded car poses played back over the same city, with broadcast style trackside cameras,
// a helicopter view, chase and bonnet views, a scrub bar and playback speeds. Traffic is a pure function of the
// race seed and time, so the replay rebuilds it exactly instead of storing it.
import * as THREE from 'three';
import type { TrackData, Track } from '../shared/track';
import type { Entrant } from '../shared/race';
import type { CarState } from '../shared/car';
import { carById, defaultLivery } from '../shared/cars';
import { Traffic, type TrafficPose } from '../shared/traffic';
import { CarModel } from '../render/cars3d';
import { TrafficView } from '../render/traffic3d';
import { ChaseCam } from '../render/camera';
import { Fx } from '../render/fx';
import { setWorldUniforms } from '../render/materials';
import type { Stage, Scenery } from './stage';
import { disposeTree } from './stage';
import type { SessionResult, ReplayFrame } from './session';
import { el, acts, esc } from '../ui/dom';
import { fmtTime } from '../ui/hud';
import { clamp, expDecay, lerp, wrapAngle } from '../shared/math';

type CamKind = 'tv' | 'heli' | 'chase' | 'hood';
const CAM_LABEL: Record<CamKind, string> = { tv: 'TV', heli: 'Heli', chase: 'Chase', hood: 'Bonnet' };
const CAM_ORDER: CamKind[] = ['tv', 'chase', 'heli', 'hood'];
const SPEEDS = [0.25, 0.5, 1, 2];
const PER_CAR = 8;

export class ReplayPlayer {
  private group = new THREE.Group();
  private scen: Scenery;
  private track: Track;
  private models: CarModel[] = [];
  private danfos: (CarModel | null)[] = [];
  private fx: Fx;
  private traffic: Traffic | null;
  private trafficView: TrafficView | null;
  private trafficPoses: TrafficPose[] = [];
  private frames: ReplayFrame[];
  private t: number; private t0: number; private t1: number;
  private playing = true; private speedIdx = 2;
  private focus: number;
  private camKind: CamKind = 'tv';
  private chase: ChaseCam;
  private tvPts: { p: THREE.Vector3; s: number }[] = [];
  private tvAt = -1; private tvHold = 0;
  private look = new THREE.Vector3(); private heliPos = new THREE.Vector3();
  private fake: CarState;
  private ui: HTMLElement;
  private range: HTMLInputElement; private timeEl: HTMLElement; private nameEl: HTMLElement; private playEl: HTMLElement; private speedEl: HTMLElement; private camEl: HTMLElement;
  private scrubbing = false;
  private wall = 0;
  private keyFn = (e: KeyboardEvent) => this.onKey(e);

  constructor(private stage: Stage, parent: HTMLElement, td: TrackData, private result: SessionResult, private entrants: Entrant[], private onExit: () => void) {
    const s = stage.engine.settings;
    this.scen = stage.sceneryFor(td);
    this.track = this.scen.track;
    stage.ensureLandmarks();
    stage.atmos.set(result.cfg.time, result.cfg.weather, s.drawDistance, s.reflections);
    this.frames = result.replay;
    this.t0 = Math.max(this.frames[0]?.t ?? 0, -1.2);
    this.t1 = this.frames[this.frames.length - 1]?.t ?? 0;
    this.t = this.t0;
    this.focus = result.playerIdx;
    const shadows = s.shadows > 0;
    entrants.forEach((e, i) => {
      const m = new CarModel(carById(e.carId), e.livery, { shadows, detail: i === this.focus ? 2 : 1 });
      if (e.livery.rims !== 'five') m.setRims(e.livery.rims);
      this.group.add(m.root);
      this.models.push(m); this.danfos.push(null);
    });
    const density = result.cfg.mode === 'trial' || result.cfg.mode === 'stunt' ? 0 : result.cfg.traffic;
    this.traffic = density > 0 ? new Traffic(this.track, density, result.cfg.seed) : null;
    this.trafficView = this.traffic ? new TrafficView(this.traffic.cars, shadows) : null;
    if (this.trafficView) this.group.add(this.trafficView.group);
    this.fx = new Fx(s.particles);
    this.group.add(this.fx.group);
    stage.engine.scene.add(this.group);
    this.chase = new ChaseCam(stage.engine.camera);
    this.chase.motion = false;
    this.fake = { x: 0, y: 0, z: 0, h: 0, vx: 0, vy: 0, vz: 0, drifting: false, grounded: true, yawRate: 0 } as unknown as CarState;
    this.buildTvCams();
    this.ui = el(`<div class="replay-ui">
      <div class="replay-tag">REPLAY</div>
      <div class="replay-bar panel">
        <button class="btn ghost small icon-btn" data-act="play" aria-label="Play or pause"><span>II</span></button>
        <input type="range" min="0" max="1000" value="0" aria-label="Replay position">
        <span class="mono small rp-time">0:00.000</span>
        <button class="btn ghost small" data-act="speed" aria-label="Playback speed"><span>1x</span></button>
        <button class="btn ghost small" data-act="cam" aria-label="Camera"><span>TV</span></button>
        <button class="btn ghost small icon-btn" data-act="prev" aria-label="Previous driver"><span>&lt;</span></button>
        <span class="rp-name small"></span>
        <button class="btn ghost small icon-btn" data-act="next" aria-label="Next driver"><span>&gt;</span></button>
        <button class="btn small" data-act="exit"><span>Exit</span></button>
      </div>
    </div>`);
    this.range = this.ui.querySelector('input')!;
    this.timeEl = this.ui.querySelector('.rp-time')!; this.nameEl = this.ui.querySelector('.rp-name')!;
    this.playEl = this.ui.querySelector('[data-act="play"] span')!; this.speedEl = this.ui.querySelector('[data-act="speed"] span')!; this.camEl = this.ui.querySelector('[data-act="cam"] span')!;
    this.range.addEventListener('input', () => { this.scrubbing = true; this.seek(this.t0 + (this.t1 - this.t0) * (+this.range.value / 1000)); });
    this.range.addEventListener('change', () => { this.scrubbing = false; });
    acts(this.ui, {
      play: () => this.togglePlay(),
      speed: () => { this.speedIdx = (this.speedIdx + 1) % SPEEDS.length; this.syncUi(); },
      cam: () => this.cycleCam(),
      prev: () => this.cycleFocus(-1),
      next: () => this.cycleFocus(1),
      exit: () => this.onExit(),
    });
    parent.appendChild(this.ui);
    window.addEventListener('keydown', this.keyFn);
    this.syncUi();
    this.place(this.t, 0);
    this.snapCam();
  }

  // ------------------------------------------------------------------------------------------- controls

  private onKey(e: KeyboardEvent) {
    const k = e.code;
    if (k === 'Space' || k === 'KeyK') { e.preventDefault(); this.togglePlay(); }
    else if (k === 'KeyC') this.cycleCam();
    else if (k === 'ArrowLeft' || k === 'KeyJ') { e.preventDefault(); this.seek(this.t - 5); }
    else if (k === 'ArrowRight' || k === 'KeyL') { e.preventDefault(); this.seek(this.t + 5); }
    else if (k === 'ArrowUp') { e.preventDefault(); this.cycleFocus(-1); }
    else if (k === 'ArrowDown') { e.preventDefault(); this.cycleFocus(1); }
    else if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); this.onExit(); }
  }
  private togglePlay() { if (!this.playing && this.t >= this.t1 - 0.05) this.seek(this.t0); this.playing = !this.playing; this.syncUi(); }
  private cycleCam() { this.camKind = CAM_ORDER[(CAM_ORDER.indexOf(this.camKind) + 1) % CAM_ORDER.length]; this.tvAt = -1; this.snapCam(); this.syncUi(); }
  private cycleFocus(d: number) {
    const n = this.entrants.length;
    this.focus = (this.focus + d + n) % n;
    this.tvAt = -1;
    this.snapCam(); this.syncUi();
  }
  private seek(t: number) {
    this.t = clamp(t, this.t0, this.t1);
    this.tvAt = -1;
    this.fx.skids.clear();
    this.place(this.t, 0);
    this.snapCam();
    this.syncUi();
  }
  private syncUi() {
    this.playEl.textContent = this.playing ? 'II' : '>';
    this.speedEl.textContent = `${SPEEDS[this.speedIdx]}x`;
    this.camEl.textContent = CAM_LABEL[this.camKind];
    const e = this.entrants[this.focus];
    const place = this.result.standings.find((s) => s.idx === this.focus)?.place ?? 0;
    this.nameEl.innerHTML = `<b>${place || ''}</b> ${esc(e?.name ?? '')}`;
    if (!this.scrubbing) this.range.value = String(Math.round(((this.t - this.t0) / Math.max(0.01, this.t1 - this.t0)) * 1000));
    this.timeEl.textContent = fmtTime(Math.max(0, this.t));
  }

  // ------------------------------------------------------------------------------------------- playback

  /** Index of the last frame at or before time t. */
  private frameAt(t: number) {
    const f = this.frames;
    let lo = 0, hi = f.length - 1;
    if (t <= f[0].t) return 0;
    if (t >= f[hi].t) return hi;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f[mid].t <= t) lo = mid; else hi = mid; }
    return lo;
  }

  /** Pose every car at time t. Returns nothing; also drives the effects when dt > 0. */
  private place(t: number, dt: number) {
    if (!this.frames.length) return;
    const i = this.frameAt(t);
    const A = this.frames[i], B = this.frames[Math.min(this.frames.length - 1, i + 1)];
    const span = B.t - A.t;
    const f = span > 1e-5 ? clamp((t - A.t) / span, 0, 1) : 0;
    const night = this.stage.atmos.night;
    const n = this.entrants.length;
    for (let k = 0; k < n; k++) {
      const o = k * PER_CAR;
      const a = A.cars, b = B.cars;
      if (o + 7 >= a.length) continue;
      const x = lerp(a[o], b[o], f), y = lerp(a[o + 1], b[o + 1], f), z = lerp(a[o + 2], b[o + 2], f);
      const h = a[o + 3] + wrapAngle(b[o + 3] - a[o + 3]) * f;
      const pitch = lerp(a[o + 4], b[o + 4], f), roll = lerp(a[o + 5], b[o + 5], f), vf = lerp(a[o + 6], b[o + 6], f);
      const flags = (f < 0.5 ? a : b)[o + 7] | 0;
      const drifting = !!(flags & 1), boosting = !!(flags & 2), danfo = !!(flags & 4), tier = flags >> 4;
      let model = this.models[k];
      if (danfo) {
        if (!this.danfos[k]) { const def = carById('danfo'); const m = new CarModel(def, defaultLivery(def), { shadows: false, detail: 1 }); m.root.scale.setScalar(1.25); this.group.add(m.root); this.danfos[k] = m; }
        model.root.visible = false; model = this.danfos[k]!; model.root.visible = true;
      } else if (this.danfos[k]) { this.danfos[k]!.root.visible = false; model.root.visible = true; }
      model.root.position.set(x, y, z);
      model.root.rotation.y = h;
      const steer = clamp(wrapAngle(b[o + 3] - a[o + 3]) / Math.max(0.01, span) * -0.35, -1, 1);
      const accel = span > 1e-5 ? (b[o + 6] - a[o + 6]) / span : 0;
      model.pose(Math.max(dt, 1e-3), vf, steer, roll + (drifting ? 0.04 : 0), pitch, accel < -6 && vf > 2, night, boosting && vf > 30);
      if (k === this.focus) {
        const vx = span > 1e-5 ? (b[o] - a[o]) / span : 0, vz = span > 1e-5 ? (b[o + 2] - a[o + 2]) / span : 0;
        const fc = this.fake as unknown as Record<string, number | boolean>;
        fc.x = x; fc.y = y; fc.z = z; fc.h = h; fc.vx = vx; fc.vz = vz; fc.drifting = drifting; fc.grounded = Math.abs(pitch) < 0.25;
        fc.yawRate = span > 1e-5 ? -wrapAngle(b[o + 3] - a[o + 3]) / span : 0;
      }
      if (dt > 0) this.effects(k, x, y, z, h, vf, drifting, tier, boosting);
    }
    if (this.traffic && this.trafficView) { this.traffic.poses(Math.max(0, t), this.trafficPoses); this.trafficView.update(this.trafficPoses); }
  }

  private effects(k: number, x: number, y: number, z: number, h: number, vf: number, drifting: boolean, tier: number, boosting: boolean) {
    const fx = this.fx, def = carById(this.entrants[k].carId).shape;
    const fxv = Math.sin(h), fzv = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
    const rearZ = -def.wheelbase / 2, half = def.track / 2;
    const vx = fxv * vf, vz = fzv * vf;
    [[-half, rearZ], [half, rearZ]].forEach(([lx, lz], w) => {
      const wx = x + rx * lx + fxv * lz, wz = z + rz * lx + fzv * lz;
      const key = `r${k}:${w}`;
      if (drifting) { fx.skids.mark(key, wx, y, wz, 0.5 + tier * 0.15); fx.tyreSmoke(wx, y, wz, vx, vz, 0.4, false); if (tier > 0) fx.sparks(wx, y, wz, tier, vx, vz); }
      else fx.skids.lift(key);
      if (this.stage.atmos.wet > 0 && vf > 10) fx.spray(wx, y, wz, vx, vz);
    });
    if (boosting) {
      const ex = x - fxv * (def.length / 2 + 0.1), ez = z - fzv * (def.length / 2 + 0.1);
      fx.flame(ex + rx * 0.35, y + 0.35, ez + rz * 0.35, fxv, fzv, false);
      fx.flame(ex - rx * 0.35, y + 0.35, ez - rz * 0.35, fxv, fzv, false);
    }
  }

  // ------------------------------------------------------------------------------------------- cameras

  /** Trackside positions every ~70 m, alternating sides, set back past the kerb and raised like a broadcast rig. */
  private buildTvCams() {
    const L = this.track.length;
    let side = 1;
    for (let s = 20; s < L; s += 70) {
      const hw = this.track.hwAt(s);
      const p = this.track.pointAt(s, side * (hw + 7 + ((s * 13) % 6)), 0, false);
      this.tvPts.push({ p: new THREE.Vector3(p.x, p.y + 3.5 + ((s * 7) % 5), p.z), s });
      side = -side;
    }
  }

  private pickTv(c: CarState) {
    // the next camera ahead of the car along the track, within reach
    const q = this.track.query(c.x, c.y, c.z);
    let best = -1, bd = Infinity;
    this.tvPts.forEach((cam, i) => {
      const g = this.track.gap(q.sMain, cam.s);
      if (g < -25 || g > 110) return;
      const d = Math.abs(g - 35);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  private snapCam() {
    const c = this.fake;
    if (this.camKind === 'chase' || this.camKind === 'hood') { this.chase.mode = this.camKind === 'hood' ? 'hood' : 'chase'; this.chase.snapTo(c); }
    this.look.set(c.x, c.y + 0.8, c.z);
    this.heliPos.set(c.x - Math.sin(c.h) * 28, c.y + 24, c.z - Math.cos(c.h) * 28);
  }

  private updateCam(dt: number) {
    const cam = this.stage.engine.camera, c = this.fake;
    if (this.camKind === 'chase' || this.camKind === 'hood') { this.chase.update(Math.max(dt, 1e-3), c, carById(this.entrants[this.focus].carId).topSpeed, false, false); return; }
    if (this.camKind === 'heli') {
      const want = new THREE.Vector3(c.x - Math.sin(c.h) * 28, c.y + 24, c.z - Math.cos(c.h) * 28);
      this.heliPos.x = expDecay(this.heliPos.x, want.x, 1.2, dt); this.heliPos.y = expDecay(this.heliPos.y, want.y, 1.2, dt); this.heliPos.z = expDecay(this.heliPos.z, want.z, 1.2, dt);
      cam.position.copy(this.heliPos);
      this.look.set(expDecay(this.look.x, c.x, 6, dt), expDecay(this.look.y, c.y, 6, dt), expDecay(this.look.z, c.z, 6, dt));
      cam.lookAt(this.look);
      cam.fov = 42; cam.updateProjectionMatrix();
      return;
    }
    // TV: hold a trackside camera until the car has gone past it, then cut to the next
    this.tvHold -= dt;
    const cur = this.tvAt >= 0 ? this.tvPts[this.tvAt].p : null;
    const far = cur ? Math.hypot(cur.x - c.x, cur.z - c.z) : Infinity;
    let behind = false;
    if (cur) { const dx = cur.x - c.x, dz = cur.z - c.z; behind = dx * Math.sin(c.h) + dz * Math.cos(c.h) < -18; }
    if (!cur || far > 120 || (behind && this.tvHold <= 0)) {
      const next = this.pickTv(c);
      if (next >= 0 && next !== this.tvAt) { this.tvAt = next; this.tvHold = 1.2; this.look.set(c.x, c.y + 0.8, c.z); }
    }
    const p = this.tvAt >= 0 ? this.tvPts[this.tvAt].p : new THREE.Vector3(c.x + 12, c.y + 5, c.z + 12);
    cam.position.copy(p);
    this.look.set(expDecay(this.look.x, c.x, 9, dt), expDecay(this.look.y, c.y + 0.7, 9, dt), expDecay(this.look.z, c.z, 9, dt));
    cam.lookAt(this.look);
    // zoom so the car fills a similar slice of the frame at any distance
    const d = Math.max(4, cam.position.distanceTo(this.look));
    cam.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(7.5 / d)), 9, 62);
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------------------------------- frame

  frame(dt: number) {
    if (!this.frames.length) { this.onExit(); return; }
    this.wall += dt;
    const step = this.playing && !this.scrubbing ? dt * SPEEDS[this.speedIdx] : 0;
    if (step > 0) {
      this.t += step;
      if (this.t >= this.t1) { this.t = this.t1; this.playing = false; }
    }
    this.place(this.t, step);
    const st = this.stage, eng = st.engine;
    setWorldUniforms(st.atmos.night, st.atmos.wet, this.wall);
    this.scen.props.setNight(st.atmos.night);
    this.scen.props.updateCrowd(this.wall);
    st.landmarks?.update(this.wall);
    this.fx.update(step);
    if (st.atmos.wet > 0) this.fx.rain(this.fake.x, this.fake.y, this.fake.z, 1);
    this.updateCam(dt);
    st.atmos.follow(eng.camera.position.x, this.fake.y, eng.camera.position.z, 70, eng.settings.shadows, this.wall);
    this.scen.world.update(eng.camera.position.x, eng.camera.position.z);
    if ((this.wall * 10 | 0) % 2 === 0) this.syncUi();
    eng.frame();
  }

  dispose() {
    window.removeEventListener('keydown', this.keyFn);
    this.ui.remove();
    this.stage.engine.scene.remove(this.group);
    disposeTree(this.group);
    for (const m of this.models) m.dispose();
    for (const d of this.danfos) d?.dispose();
  }
}
