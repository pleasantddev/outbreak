// All sound is synthesised live with Web Audio, so nothing needs licensing and the download stays small: engines per
// car type through a virtual gearbox, tyres, wind, impacts, items (the agbero horn, the NEPA power cut), traffic
// honks, crowd, and procedural Afrobeats and Amapiano style music with log drum bass.
import type { EngineSound } from '../shared/cars';

export interface AudioPrefs { master: number; music: number; sfx: number; engine: number; muted: boolean }
export const defaultAudioPrefs = (): AudioPrefs => ({ master: 0.8, music: 0.55, sfx: 0.8, engine: 0.75, muted: false });

const ENGINE_SPEC: Record<EngineSound, { cyl: number; idle: number; red: number; gears: number; grit: number; base: number; whine?: boolean; turbo?: boolean; diesel?: boolean }> = {
  v8: { cyl: 8, idle: 850, red: 7000, gears: 6, grit: 0.55, base: 1 },
  turbo4: { cyl: 4, idle: 950, red: 7800, gears: 6, grit: 0.35, base: 1.15, turbo: true },
  v6: { cyl: 6, idle: 800, red: 6800, gears: 6, grit: 0.4, base: 1 },
  diesel: { cyl: 4, idle: 700, red: 4600, gears: 5, grit: 0.7, base: 0.75, diesel: true, turbo: true },
  twostroke: { cyl: 2, idle: 1600, red: 9500, gears: 4, grit: 0.8, base: 1.4 },
  v12: { cyl: 12, idle: 900, red: 8800, gears: 7, grit: 0.25, base: 1.1 },
  electric: { cyl: 0, idle: 0, red: 0, gears: 1, grit: 0, base: 1, whine: true },
};

class EngineVoice {
  out: GainNode;
  private oscA: OscillatorNode; private oscB: OscillatorNode; private sub: OscillatorNode;
  private shaper: WaveShaperNode; private filt: BiquadFilterNode; private body: BiquadFilterNode;
  private noise: AudioBufferSourceNode; private noiseGain: GainNode; private noiseFilt: BiquadFilterNode;
  private whistle: OscillatorNode | null = null; private whistleGain: GainNode | null = null;
  private gainA: GainNode; private gainB: GainNode; private gainSub: GainNode;
  rpm = 900; gear = 1; private shiftT = 0;
  panner: PannerNode | null = null;

  constructor(private ac: AudioContext, dest: AudioNode, public spec: typeof ENGINE_SPEC[EngineSound], noiseBuf: AudioBuffer, positional: boolean) {
    this.out = ac.createGain(); this.out.gain.value = 0;
    this.oscA = ac.createOscillator(); this.oscA.type = spec.whine ? 'sine' : 'sawtooth';
    this.oscB = ac.createOscillator(); this.oscB.type = spec.whine ? 'triangle' : 'square';
    this.sub = ac.createOscillator(); this.sub.type = 'sine';
    this.gainA = ac.createGain(); this.gainB = ac.createGain(); this.gainSub = ac.createGain();
    this.gainA.gain.value = 0.5; this.gainB.gain.value = spec.whine ? 0.25 : 0.22; this.gainSub.gain.value = spec.whine ? 0.05 : 0.35;
    this.shaper = ac.createWaveShaper();
    const curve = new Float32Array(1024); const k = 2 + spec.grit * 18;
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    this.shaper.curve = curve;
    this.filt = ac.createBiquadFilter(); this.filt.type = 'lowpass'; this.filt.Q.value = 3;
    this.body = ac.createBiquadFilter(); this.body.type = 'peaking'; this.body.frequency.value = 180 * spec.base; this.body.gain.value = 6; this.body.Q.value = 1.2;
    this.noise = ac.createBufferSource(); this.noise.buffer = noiseBuf; this.noise.loop = true;
    this.noiseFilt = ac.createBiquadFilter(); this.noiseFilt.type = 'bandpass'; this.noiseFilt.Q.value = 1.4;
    this.noiseGain = ac.createGain(); this.noiseGain.gain.value = 0;
    this.oscA.connect(this.gainA).connect(this.shaper);
    this.oscB.connect(this.gainB).connect(this.shaper);
    this.sub.connect(this.gainSub).connect(this.filt);
    this.shaper.connect(this.filt);
    this.noise.connect(this.noiseFilt).connect(this.noiseGain).connect(this.filt);
    this.filt.connect(this.body).connect(this.out);
    if (spec.turbo || spec.whine) {
      this.whistle = ac.createOscillator(); this.whistle.type = 'sine';
      this.whistleGain = ac.createGain(); this.whistleGain.gain.value = 0;
      this.whistle.connect(this.whistleGain).connect(this.out);
      this.whistle.start();
    }
    if (positional) {
      this.panner = ac.createPanner(); this.panner.panningModel = 'equalpower'; this.panner.distanceModel = 'inverse'; this.panner.refDistance = 8; this.panner.rolloffFactor = 1.4;
      this.out.connect(this.panner).connect(dest);
    } else this.out.connect(dest);
    this.oscA.start(); this.oscB.start(); this.sub.start(); this.noise.start(Math.random() * 2);
  }

  /** speed in m/s, top speed, throttle 0..1, boosting */
  update(speed: number, top: number, throttle: number, boost: boolean, airborne: boolean, dt: number, vol: number) {
    const s = this.spec, t = this.ac.currentTime;
    // a phone may only get here ten times a second: glide across the gap to the next update instead of stepping
    const tc = (base: number) => Math.max(base, dt * 0.7);
    let freq: number, load = throttle;
    if (s.whine) {
      const f = 120 + (speed / top) * 1400;
      freq = f;
      this.oscA.frequency.setTargetAtTime(f, t, tc(0.05)); this.oscB.frequency.setTargetAtTime(f * 1.5, t, tc(0.05)); this.sub.frequency.setTargetAtTime(f * 0.25, t, tc(0.05));
      this.filt.frequency.setTargetAtTime(2400 + f, t, tc(0.05));
      this.whistleGain!.gain.setTargetAtTime(0.04 + throttle * 0.06, t, tc(0.05)); this.whistle!.frequency.setTargetAtTime(f * 3.02, t, tc(0.05));
      this.out.gain.setTargetAtTime((0.12 + 0.5 * (speed / top) * (0.5 + throttle * 0.5)) * vol, t, tc(0.06));
      return;
    }
    // a virtual gearbox: each gear covers a slice of the speed range, rpm climbs then drops on the shift
    const r = Math.min(1.05, speed / top);
    const g = Math.min(s.gears, 1 + Math.floor(r * s.gears * 0.999));
    if (g !== this.gear) { this.shiftT = 0.12; this.gear = g; }
    const lo = (g - 1) / s.gears, hi = g / s.gears;
    const inGear = (r - lo) / (hi - lo);
    let target = speed < 1 ? s.idle + throttle * (s.red - s.idle) * 0.35 : s.idle * 1.6 + inGear * (s.red - s.idle * 1.6) * 0.92;
    if (airborne) target = Math.min(s.red, this.rpm + throttle * 3000);
    if (this.shiftT > 0) { this.shiftT -= dt; target *= 0.82; load *= 0.3; }
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 9 : 5));
    freq = (this.rpm / 60) * (s.cyl / 2) * s.base;
    this.oscA.frequency.setTargetAtTime(freq, t, tc(0.02));
    this.oscB.frequency.setTargetAtTime(freq * 0.5 * 1.004, t, tc(0.02));
    this.sub.frequency.setTargetAtTime(freq * 0.5, t, tc(0.02));
    this.filt.frequency.setTargetAtTime(500 + freq * (2.2 + load * 3.5), t, tc(0.03));
    this.noiseFilt.frequency.setTargetAtTime(Math.min(4000, 300 + freq * 2), t, tc(0.03));
    this.noiseGain.gain.setTargetAtTime((s.diesel ? 0.35 : 0.12) * (0.3 + load), t, tc(0.05));
    if (this.whistleGain && this.whistle) { this.whistleGain.gain.setTargetAtTime((boost ? 0.05 : 0.015) * load * (this.rpm / s.red), t, tc(0.08)); this.whistle.frequency.setTargetAtTime(3000 + (this.rpm / s.red) * 4500, t, tc(0.08)); }
    this.out.gain.setTargetAtTime((0.16 + 0.32 * load + 0.12 * (this.rpm / s.red)) * vol, t, tc(0.04));
    void freq;
  }

  setPosition(x: number, y: number, z: number) {
    if (!this.panner) return;
    const t = this.ac.currentTime;
    this.panner.positionX.setTargetAtTime(x, t, 0.08); this.panner.positionY.setTargetAtTime(y, t, 0.08); this.panner.positionZ.setTargetAtTime(z, t, 0.08);
  }

  stop() { const t = this.ac.currentTime; this.out.gain.setTargetAtTime(0, t, 0.1); setTimeout(() => { try { this.oscA.stop(); this.oscB.stop(); this.sub.stop(); this.noise.stop(); this.whistle?.stop(); } catch { /* already stopped */ } this.out.disconnect(); }, 400); }
}

export class AudioEngine {
  ac: AudioContext | null = null;
  master!: GainNode; music!: GainNode; sfx!: GainNode; engines!: GainNode;
  private noiseBuf!: AudioBuffer;
  private player: EngineVoice | null = null;
  private others: EngineVoice[] = [];
  private tyre!: { src: AudioBufferSourceNode; gain: GainNode; filt: BiquadFilterNode };
  private wind!: { src: AudioBufferSourceNode; gain: GainNode; filt: BiquadFilterNode };
  private crowd!: { gain: GainNode };
  musicPlayer: MusicPlayer | null = null;
  prefs: AudioPrefs;

  constructor(prefs: AudioPrefs) { this.prefs = prefs; }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ac) { if (this.ac.state === 'suspended') void this.ac.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ac = this.ac = new AC({ latencyHint: 'interactive' });
    this.master = ac.createGain(); this.music = ac.createGain(); this.sfx = ac.createGain(); this.engines = ac.createGain();
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.music.connect(this.master); this.sfx.connect(this.master); this.engines.connect(this.master);
    this.master.connect(comp).connect(ac.destination);
    this.noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loopNoise = (type: BiquadFilterType, f: number, q: number) => {
      const src = ac.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const filt = ac.createBiquadFilter(); filt.type = type; filt.frequency.value = f; filt.Q.value = q;
      const gain = ac.createGain(); gain.gain.value = 0;
      src.connect(filt).connect(gain).connect(this.sfx); src.start(Math.random());
      return { src, gain, filt };
    };
    this.tyre = loopNoise('bandpass', 1400, 6);
    this.wind = loopNoise('lowpass', 600, 0.7);
    const cr = loopNoise('bandpass', 900, 0.6); this.crowd = { gain: cr.gain };
    this.musicPlayer = new MusicPlayer(ac, this.music, this.noiseBuf);
    this.applyPrefs();
  }

  applyPrefs() {
    if (!this.ac) return;
    const p = this.prefs, t = this.ac.currentTime;
    this.master.gain.setTargetAtTime(p.muted ? 0 : p.master, t, 0.05);
    this.music.gain.setTargetAtTime(p.music * 0.7, t, 0.05);
    this.sfx.gain.setTargetAtTime(p.sfx, t, 0.05);
    this.engines.gain.setTargetAtTime(p.engine, t, 0.05);
  }

  setPlayerEngine(sound: EngineSound | null) {
    if (!this.ac) return;
    this.player?.stop(); this.player = null;
    if (sound) this.player = new EngineVoice(this.ac, this.engines, ENGINE_SPEC[sound], this.noiseBuf, false);
  }
  setOpponents(sounds: EngineSound[]) {
    if (!this.ac) return;
    for (const o of this.others) o.stop();
    this.others = sounds.slice(0, 3).map((s) => new EngineVoice(this.ac!, this.engines, ENGINE_SPEC[s], this.noiseBuf, true));
  }
  stopEngines() { this.player?.stop(); this.player = null; for (const o of this.others) o.stop(); this.others = []; }

  /** Per frame car audio. */
  driving(speed: number, top: number, throttle: number, boost: boolean, airborne: boolean, slip: number, dt: number, crowd: number) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.player?.update(speed, top, throttle, boost, airborne, dt, 1);
    this.tyre.gain.gain.setTargetAtTime(Math.min(0.35, slip * 0.4), t, 0.05);
    this.tyre.filt.frequency.setTargetAtTime(900 + slip * 900, t, 0.05);
    this.wind.gain.gain.setTargetAtTime(Math.min(0.25, (speed / 70) ** 2 * 0.3), t, 0.1);
    this.wind.filt.frequency.setTargetAtTime(300 + speed * 25, t, 0.1);
    this.crowd.gain.gain.setTargetAtTime(crowd * 0.12, t, 0.3);
  }
  opponent(i: number, x: number, y: number, z: number, speed: number, top: number, dt = 1 / 60, vol = 0.6) {
    const v = this.others[i];
    if (!v) return;
    v.setPosition(x, y, z);
    v.update(speed, top, 0.8, false, false, dt, vol);
  }
  listener(x: number, y: number, z: number, fx: number, fz: number) {
    if (!this.ac) return;
    const L = this.ac.listener, t = this.ac.currentTime, k = 0.08;
    if (L.positionX) { L.positionX.setTargetAtTime(x, t, k); L.positionY.setTargetAtTime(y, t, k); L.positionZ.setTargetAtTime(z, t, k); L.forwardX.setTargetAtTime(fx, t, k); L.forwardY.setTargetAtTime(0, t, k); L.forwardZ.setTargetAtTime(fz, t, k); L.upY.setTargetAtTime(1, t, k); }
  }

  // ------------------------------------------------------------------------------------------- one shots

  private env(g: GainNode, t: number, a: number, peak: number, d: number) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  private tone(f: number, type: OscillatorType, dur: number, vol: number, when = 0, slideTo?: number, dest?: AudioNode) {
    if (!this.ac) return;
    const t = this.ac.currentTime + when;
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(dest ?? this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  private noiseHit(dur: number, vol: number, f: number, q: number, type: BiquadFilterType = 'bandpass', when = 0, sweepTo?: number) {
    if (!this.ac) return;
    const t = this.ac.currentTime + when;
    const s = this.ac.createBufferSource(); s.buffer = this.noiseBuf;
    const fl = this.ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ac.createGain(); this.env(g, t, 0.004, vol, dur);
    s.connect(fl).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  play(name: string, k = 1) {
    if (!this.ac) return;
    switch (name) {
      case 'count': this.tone(440, 'square', 0.22, 0.18); break;
      case 'go': this.tone(880, 'square', 0.5, 0.2); this.tone(1320, 'sine', 0.5, 0.1); break;
      case 'wall': this.noiseHit(0.18, Math.min(0.6, 0.15 + k * 0.03), 300, 0.8, 'lowpass'); this.tone(70, 'sine', 0.2, Math.min(0.5, k * 0.04), 0, 40); break;
      case 'bump': this.noiseHit(0.12, 0.3, 500, 1, 'lowpass'); this.tone(90, 'sine', 0.12, 0.25, 0, 50); break;
      case 'land': this.noiseHit(0.15, 0.35, 200, 0.7, 'lowpass'); this.tone(60, 'sine', 0.18, 0.35, 0, 35); break;
      case 'boost': this.noiseHit(0.7, 0.32, 300, 1.2, 'bandpass', 0, 3000); this.tone(160, 'sawtooth', 0.5, 0.06, 0, 420); break;
      case 'drift': this.tone(600 + k * 220, 'sine', 0.16, 0.12); this.tone(900 + k * 330, 'sine', 0.16, 0.06, 0.04); break;
      case 'pickup': [0, 0.06, 0.12].forEach((w, i) => this.tone(660 * Math.pow(1.26, i), 'triangle', 0.12, 0.12, w)); break;
      case 'roll': for (let i = 0; i < 8; i++) this.tone(500 + (i % 3) * 120, 'square', 0.04, 0.05, i * 0.11); break;
      case 'item': this.tone(1046, 'triangle', 0.25, 0.14); this.tone(1568, 'sine', 0.3, 0.08, 0.05); break;
      case 'horn': this.agberoHorn(); break;
      case 'rocket': this.noiseHit(0.9, 0.3, 800, 0.8, 'bandpass', 0, 200); this.tone(300, 'sawtooth', 0.6, 0.08, 0, 80); break;
      case 'explode': this.noiseHit(0.8, 0.6, 400, 0.6, 'lowpass', 0, 80); this.tone(55, 'sine', 0.6, 0.5, 0, 30); break;
      case 'splash': this.noiseHit(0.35, 0.35, 2500, 1.5, 'highpass', 0, 600); break;
      case 'pothole': this.tone(50, 'sine', 0.25, 0.6, 0, 28); this.noiseHit(0.2, 0.4, 250, 1, 'lowpass'); break;
      case 'blackout': this.tone(220, 'sawtooth', 1.1, 0.12, 0, 40); this.noiseHit(1.2, 0.12, 120, 1, 'lowpass', 0.2, 40); break;
      case 'danfo': this.agberoHorn(); this.tone(70, 'sawtooth', 1.2, 0.18, 0.1, 55); break;
      case 'okada': for (let i = 0; i < 6; i++) this.tone(180 + i * 23, 'sawtooth', 1.4, 0.035, i * 0.08, 260 + i * 15); break;
      case 'nearMiss': this.noiseHit(0.35, 0.3, 1800, 2, 'bandpass', 0, 500); break;
      case 'traffic': this.honk(); break;
      case 'lap': [523, 659, 784].forEach((f, i) => this.tone(f, 'triangle', 0.2, 0.14, i * 0.09)); break;
      case 'final': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 'square', 0.22, 0.1, i * 0.1)); break;
      case 'finish': [392, 523, 659, 784, 1046].forEach((f, i) => { this.tone(f, 'triangle', 0.6, 0.14, i * 0.12); this.tone(f * 1.5, 'sine', 0.6, 0.05, i * 0.12); }); this.noiseHit(2.4, 0.14, 1200, 0.5, 'bandpass', 0.3); break;
      case 'place': this.tone(k > 0 ? 880 : 330, 'sine', 0.12, 0.1, 0, k > 0 ? 1320 : 220); break;
      case 'ui': this.tone(1200, 'sine', 0.05, 0.06); break;
      case 'uiOk': this.tone(880, 'triangle', 0.08, 0.08); this.tone(1320, 'triangle', 0.1, 0.06, 0.05); break;
      case 'uiBack': this.tone(500, 'triangle', 0.08, 0.07, 0, 380); break;
      case 'respawn': this.tone(330, 'sine', 0.3, 0.1, 0, 660); break;
      case 'slip': this.noiseHit(0.5, 0.12, 800, 1, 'bandpass', 0, 2000); break;
      case 'brt': this.tone(1500, 'sine', 0.08, 0.05); break;
      case 'launch': this.tone(k ? 1200 : 200, k ? 'triangle' : 'sawtooth', 0.3, 0.12); break;
    }
  }

  /** The two-tone danfo horn every Lagos road knows. */
  private agberoHorn() {
    if (!this.ac) return;
    for (const [f, w] of [[392, 0], [494, 0], [392, 0.32], [494, 0.32]] as [number, number][]) {
      const t = this.ac.currentTime + w;
      const o = this.ac.createOscillator(), g = this.ac.createGain(), fl = this.ac.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = f; fl.type = 'bandpass'; fl.frequency.value = 1200; fl.Q.value = 1.5;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.02); g.gain.setValueAtTime(0.16, t + 0.24); g.gain.linearRampToValueAtTime(0, t + 0.3);
      o.connect(fl).connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.32);
    }
  }
  private honk() { const f = 380 + Math.random() * 160; this.tone(f, 'sawtooth', 0.25 + Math.random() * 0.3, 0.05); this.tone(f * 1.26, 'sawtooth', 0.25, 0.03); }

  music_(mode: 'menu' | 'race' | 'results' | 'off', intensity = 0) { this.musicPlayer?.set(mode, intensity); }
}

// ------------------------------------------------------------------------------------------- music

/** A small step sequencer: log drum bass, kick, claps, shakers, jazzy chords and pads, at Amapiano and Afrobeats tempos. */
class MusicPlayer {
  private mode: 'menu' | 'race' | 'results' | 'off' = 'off';
  private intensity = 0;
  private nextT = 0; private step = 0; private bar = 0;
  private timer: number | null = null;
  private bus: GainNode;
  private song = 0;
  constructor(private ac: AudioContext, dest: AudioNode, private noise: AudioBuffer) {
    this.bus = ac.createGain(); this.bus.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    this.bus.connect(comp).connect(dest);
  }
  set(mode: 'menu' | 'race' | 'results' | 'off', intensity: number) {
    this.intensity = intensity;
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (mode === 'off') return;
    this.song = (this.song + 1) % 3;
    this.nextT = this.ac.currentTime + 0.1; this.step = 0; this.bar = 0;
    this.timer = window.setInterval(() => this.schedule(), 50);
  }
  private get bpm() { return this.mode === 'race' ? 118 : this.mode === 'results' ? 112 : 108; }
  private schedule() {
    const spb = 60 / this.bpm / 4; // sixteenth notes
    const now = this.ac.currentTime;
    // the page stalled (a heavy frame, a tab switch): skip the beats we missed rather than play them in a heap
    while (this.nextT < now - 0.02) { this.nextT += spb; this.step = (this.step + 1) % 16; if (this.step === 0) this.bar++; }
    // half a second ahead: a slow phone frame can hold up this timer far longer than a few milliseconds
    while (this.nextT < now + 0.5) {
      this.playStep(this.step, this.nextT, spb);
      this.nextT += spb * (this.step % 2 ? 0.92 : 1.08); // swing
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }
  private chordRoot(): number { const prog = [[0, 5, 3, 7], [0, 8, 3, 10], [0, 3, 5, 10]][this.song]; return prog[this.bar % 4]; }
  private playStep(s: number, t: number, spb: number) {
    const race = this.mode === 'race';
    const base = 55 * Math.pow(2, (this.chordRoot() + (this.song === 1 ? 2 : 0)) / 12);
    // kick: four on the floor in races, sparse in menus
    if (race ? s % 4 === 0 : s === 0 || s === 10) this.kick(t);
    // clap and rim on two and four
    if (s === 4 || s === 12) this.clap(t, 0.22);
    if (s === 7 || s === 15) this.rim(t);
    // shakers on sixteenths with accents
    this.shaker(t, s % 4 === 2 ? 0.07 : 0.035);
    // log drum: the plucky sliding bass of Amapiano
    const logPattern = this.song === 0 ? [0, 3, 6, 10, 11, 14] : this.song === 1 ? [0, 2, 7, 10, 13] : [0, 5, 8, 11, 14];
    if (logPattern.includes(s)) this.logDrum(t, base * (s === 10 || s === 11 ? 1.5 : s > 12 ? 2 : 1), spb * 2.2);
    // chords on the off beats
    if (s === 2 || s === 10 || (race && s === 6)) this.chord(t, base * 4, spb * (race ? 1.5 : 3));
    // pad and lead in races, climbing with intensity
    if (race && s === 0 && this.bar % 2 === 0) this.pad(t, base * 2, spb * 32);
    if (race && this.intensity > 0.5 && [0, 3, 6, 8, 11].includes(s) && this.bar % 4 >= 2) this.lead(t, base * 8 * [1, 1.189, 1.335, 1.498, 1.782][(s + this.bar) % 5], spb * 1.2);
  }
  private kick(t: number) { const o = this.ac.createOscillator(), g = this.ac.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); g.gain.setValueAtTime(0.85, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.32); }
  private noiseNote(t: number, dur: number, vol: number, type: BiquadFilterType, f: number, q = 1) { const s = this.ac.createBufferSource(); s.buffer = this.noise; const fl = this.ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = this.ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(fl).connect(g).connect(this.bus); s.start(t, Math.random()); s.stop(t + dur + 0.02); }
  private clap(t: number, v: number) { for (const d of [0, 0.012, 0.024]) this.noiseNote(t + d, 0.12, v, 'bandpass', 1500, 1.2); }
  private rim(t: number) { const o = this.ac.createOscillator(), g = this.ac.createGain(); o.type = 'triangle'; o.frequency.value = 1700; g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.06); }
  private shaker(t: number, v: number) { this.noiseNote(t, 0.05, v, 'highpass', 7000, 0.7); }
  private logDrum(t: number, f: number, dur: number) {
    const o = this.ac.createOscillator(), g = this.ac.createGain(), sh = this.ac.createWaveShaper(), fl = this.ac.createBiquadFilter();
    const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = (i / 255) * 2 - 1; curve[i] = Math.tanh(x * 3); } sh.curve = curve;
    o.type = 'sine'; o.frequency.setValueAtTime(f * 1.9, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    fl.type = 'lowpass'; fl.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(sh).connect(fl).connect(g).connect(this.bus); o.start(t); o.stop(t + dur + 0.02);
  }
  private chord(t: number, root: number, dur: number) {
    const minor7 = [0, 3, 7, 10, 14];
    for (const iv of minor7) {
      const o = this.ac.createOscillator(), g = this.ac.createGain(), fl = this.ac.createBiquadFilter();
      o.type = 'triangle'; o.frequency.value = root * Math.pow(2, iv / 12);
      fl.type = 'lowpass'; fl.frequency.value = 2200;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(fl).connect(g).connect(this.bus); o.start(t); o.stop(t + dur + 0.02);
    }
  }
  private pad(t: number, root: number, dur: number) {
    for (const iv of [0, 7, 15]) {
      const o = this.ac.createOscillator(), g = this.ac.createGain(), fl = this.ac.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = root * Math.pow(2, iv / 12) * (1 + (Math.random() - 0.5) * 0.004);
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(400, t); fl.frequency.linearRampToValueAtTime(1400, t + dur * 0.5); fl.frequency.linearRampToValueAtTime(500, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.025 + this.intensity * 0.02, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(fl).connect(g).connect(this.bus); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  private lead(t: number, f: number, dur: number) {
    const o = this.ac.createOscillator(), g = this.ac.createGain(), fl = this.ac.createBiquadFilter();
    o.type = 'square'; o.frequency.value = f;
    fl.type = 'bandpass'; fl.frequency.value = f * 1.5; fl.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(fl).connect(g).connect(this.bus); o.start(t); o.stop(t + dur + 0.02);
  }
}
