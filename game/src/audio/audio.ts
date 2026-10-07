// Procedural audio. Every sound is synthesized, so there is nothing to license and the download stays small.
import type { WeaponId } from '../data/balance';

type V = { x: number; y: number; z: number };

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode; sfx!: GainNode; music!: GainNode; amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private listener = { x: 0, y: 0, z: 0 };
  private reverb!: ConvolverNode;
  private rain: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private drone: { gain: GainNode; oscs: OscillatorNode[]; filter: BiquadFilterNode } | null = null;
  private engines = new Map<number, { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode; pan: PannerNode }>();
  private gens: { osc: OscillatorNode; gain: GainNode; pan: PannerNode }[] = [];
  private tension = 0;
  private beatT = 0;
  volume = 0.8; musicVol = 0.5;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new AudioContext(); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.volume; this.master.connect(c.destination);
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(this.master);
    this.sfx = c.createGain(); this.sfx.connect(comp);
    this.music = c.createGain(); this.music.gain.value = this.musicVol; this.music.connect(comp);
    this.amb = c.createGain(); this.amb.gain.value = 0.6; this.amb.connect(comp);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // a cheap city-canyon reverb
    this.reverb = c.createConvolver();
    const ir = c.createBuffer(2, c.sampleRate * 2.2, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / x.length, 3.2); }
    this.reverb.buffer = ir;
    const rv = c.createGain(); rv.gain.value = 0.28; this.reverb.connect(rv); rv.connect(comp);
  }
  setVolume(v: number, m: number) { this.volume = v; this.musicVol = m; if (this.ctx) { this.master.gain.value = v; this.music.gain.value = m; } }
  setListener(p: V, yaw: number) {
    if (!this.ctx) return;
    this.listener = p;
    const L = this.ctx.listener;
    const f = { x: Math.sin(yaw), z: Math.cos(yaw) };
    if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = 0; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { (L as any).setPosition(p.x, p.y, p.z); (L as any).setOrientation(f.x, 0, f.z, 0, 1, 0); }
  }
  private panner(p: V | null, ref = 4, roll = 1.2) {
    const c = this.ctx!;
    if (!p) { const g = c.createGain(); g.connect(this.sfx); return g as unknown as AudioNode; }
    const pan = c.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = ref; pan.rolloffFactor = roll; pan.maxDistance = 500;
    pan.positionX.value = p.x; pan.positionY.value = p.y; pan.positionZ.value = p.z;
    pan.connect(this.sfx);
    const send = c.createGain(); send.gain.value = 0.5; pan.connect(send); send.connect(this.reverb);
    return pan;
  }
  private noise(dur: number, out: AudioNode, t0: number, filterType: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.002, decay = dur) {
    const c = this.ctx!;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
    return { f, g };
  }
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, out: AudioNode, t0: number, gain: number, attack = 0.002) {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  gunshot(w: WeaponId, p: V, suppressed: boolean, local: boolean) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const dist = Math.hypot(p.x - this.listener.x, p.z - this.listener.z);
    const out = local ? this.panner(null) : this.panner(p, 6, 0.9);
    const prof: Record<WeaponId, [number, number, number, number]> = { pistol: [2400, 0.18, 0.7, 120], smg: [2800, 0.12, 0.6, 140], ar: [1800, 0.22, 0.9, 90], shotgun: [1100, 0.4, 1.1, 60], sniper: [1400, 0.6, 1.2, 55], machete: [4000, 0.1, 0.2, 400] };
    const [freq, dur, gain, thump] = prof[w];
    if (w === 'machete') { this.noise(0.15, out, t, 'bandpass', 3500, 2, 0.35, 0.01, 0.15); return; }
    const far = Math.min(1, dist / 180);
    if (suppressed) { this.noise(0.12, out, t, 'bandpass', 1400, 1.2, gain * 0.35, 0.001, 0.1); this.tone('square', 300, 80, 0.05, out, t, 0.05); return; }
    this.noise(dur, out, t, 'lowpass', freq * (1 - far * 0.7), 0.8, gain, 0.001, dur);
    this.noise(dur * 0.4, out, t, 'highpass', 3000, 0.7, gain * 0.4 * (1 - far), 0.001, dur * 0.3);
    this.tone('sine', thump * 1.8, thump * 0.5, dur * 0.8, out, t, gain * 0.9);
    // distant crack echoing off the buildings
    if (dist > 40) this.noise(0.8, out, t + 0.05 + dist / 900, 'lowpass', 600, 0.5, gain * 0.2, 0.05, 0.8);
  }
  step(surface: string, p: V, loud: boolean, local: boolean) {
    if (!this.ctx) return;
    const out = local ? this.panner(null) : this.panner(p, 2, 1.6);
    const f = surface === 'woodfloor' || surface === 'planks' ? 700 : surface === 'tiles' ? 2600 : surface === 'mud' ? 400 : ['metal', 'corrugated', 'container', 'rust'].includes(surface) ? 3200 : 1500;
    const g = (loud ? 0.18 : 0.07) * (local ? 0.7 : 1.4);
    this.noise(0.08, out, this.ctx.currentTime, 'bandpass', f * (0.85 + Math.random() * 0.3), 1.8, g, 0.003, 0.07);
    if (['metal', 'corrugated', 'container'].includes(surface)) this.tone('triangle', 900, 600, 0.08, out, this.ctx.currentTime, g * 0.3);
  }
  impact(kind: string, p: V) {
    if (!this.ctx) return;
    const out = this.panner(p, 3, 1.4), t = this.ctx.currentTime;
    if (kind === 'metal') { this.tone('triangle', 2400 + Math.random() * 800, 1600, 0.25, out, t, 0.12); this.noise(0.05, out, t, 'highpass', 4000, 1, 0.15); }
    else if (kind === 'flesh') { this.noise(0.12, out, t, 'lowpass', 500, 1, 0.35, 0.002, 0.12); }
    else this.noise(0.08, out, t, 'bandpass', 1800, 1.5, 0.12, 0.001, 0.08);
  }
  hitmarker(head: boolean) { if (!this.ctx) return; const t = this.ctx.currentTime, out = this.panner(null); this.tone('square', head ? 2200 : 1500, head ? 1800 : 1200, 0.05, out, t, 0.06); }
  explosion(p: V) {
    if (!this.ctx) return;
    const out = this.panner(p, 12, 0.8), t = this.ctx.currentTime;
    this.noise(1.8, out, t, 'lowpass', 900, 0.6, 1.2, 0.004, 1.8);
    this.tone('sine', 120, 28, 1.2, out, t, 1.0);
    this.noise(2.5, out, t + 0.1, 'lowpass', 300, 0.4, 0.35, 0.2, 2.5);
  }
  creature(kind: 'crawler' | 'hollow' | 'stalker', type: 'growl' | 'scream' | 'attack', p: V) {
    if (!this.ctx) return;
    const out = this.panner(p, 3, 1.3), t = this.ctx.currentTime, c = this.ctx;
    const base = kind === 'crawler' ? 220 : kind === 'hollow' ? 110 : 60;
    const dur = type === 'scream' ? 1.2 : type === 'attack' ? 0.35 : 1.6;
    // FM throat: a carrier wobbled by a growling modulator, through a vowel filter
    const car = c.createOscillator(); car.type = 'sawtooth'; car.frequency.value = base * (type === 'scream' ? 3.2 : 1);
    const mod = c.createOscillator(); mod.frequency.value = base * 0.5 + Math.random() * 30;
    const mg = c.createGain(); mg.gain.value = base * (type === 'scream' ? 4 : 1.5);
    mod.connect(mg); mg.connect(car.frequency);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = type === 'scream' ? 1800 : 600; f.Q.value = 3;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(type === 'growl' ? 0.12 : 0.28, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.frequency.exponentialRampToValueAtTime(car.frequency.value * (type === 'scream' ? 0.5 : 0.8), t + dur);
    car.connect(f); f.connect(g); g.connect(out);
    car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
    if (kind === 'stalker' && type !== 'growl') this.noise(dur, out, t, 'highpass', 5000, 2, 0.08, 0.2, dur);
  }
  heartPulse() {
    if (!this.ctx) return;
    const out = this.panner(null), t = this.ctx.currentTime;
    this.tone('sine', 55, 38, 0.35, out, t, 0.9); this.tone('sine', 55, 38, 0.35, out, t + 0.28, 0.6);
    this.noise(2, out, t, 'lowpass', 120, 1, 0.25, 0.5, 2);
  }
  announce(tone: string) {
    if (!this.ctx) return;
    const out = this.panner(null), t = this.ctx.currentTime;
    if (tone === 'heart') { this.tone('sawtooth', 70, 35, 3, out, t, 0.25, 0.4); this.tone('sine', 140, 70, 3, out, t, 0.2, 0.3); }
    else if (tone === 'awaken') { this.tone('sawtooth', 220, 55, 2, out, t, 0.2, 0.05); this.noise(2, out, t, 'bandpass', 900, 4, 0.1, 0.3, 2); }
    else if (tone === 'danger') { this.tone('square', 196, 196, 0.4, out, t, 0.08); this.tone('square', 185, 185, 0.6, out, t + 0.45, 0.08); }
    else if (tone === 'victory') { [261, 329, 392, 523].forEach((f, i) => this.tone('triangle', f, f, 1.2, out, t + i * 0.12, 0.12)); }
    else this.tone('sine', 660, 440, 0.4, out, t, 0.08);
  }
  ui(kind: 'click' | 'hover' | 'pickup' | 'reload' | 'denied' | 'ability' | 'awaken') {
    if (!this.ctx) return;
    const out = this.panner(null), t = this.ctx.currentTime;
    if (kind === 'click') { this.noise(0.04, out, t, 'bandpass', 2400, 3, 0.15, 0.001, 0.04); this.tone('square', 180, 120, 0.06, out, t, 0.05); }
    if (kind === 'hover') this.noise(0.03, out, t, 'highpass', 5000, 1, 0.04, 0.001, 0.03);
    if (kind === 'pickup') { this.tone('triangle', 900, 1300, 0.08, out, t, 0.08); this.noise(0.06, out, t, 'bandpass', 2000, 2, 0.06); }
    if (kind === 'reload') { this.noise(0.05, out, t, 'bandpass', 2600, 4, 0.2); this.noise(0.06, out, t + 0.35, 'bandpass', 1800, 4, 0.25); this.tone('square', 400, 300, 0.03, out, t + 0.6, 0.06); }
    if (kind === 'denied') this.tone('square', 160, 120, 0.15, out, t, 0.08);
    if (kind === 'ability') { this.tone('sawtooth', 120, 600, 0.3, out, t, 0.15); this.noise(0.4, out, t, 'bandpass', 1200, 2, 0.2, 0.01, 0.4); }
    if (kind === 'awaken') { this.tone('sawtooth', 80, 40, 1.5, out, t, 0.35, 0.05); this.tone('square', 160, 30, 1.2, out, t, 0.15); }
  }

  startAmbience() {
    if (!this.ctx || this.rain) return;
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
    const g = c.createGain(); g.gain.value = 0.12;
    src.connect(f); f.connect(g); g.connect(this.amb); src.start();
    this.rain = { src, gain: g, filter: f };
    // the score: a low, detuned, slowly breathing drone
    const df = c.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 380; df.Q.value = 4;
    const dg = c.createGain(); dg.gain.value = 0.0; dg.gain.linearRampToValueAtTime(0.16, c.currentTime + 6);
    const oscs = [55, 55.4, 82.4, 110.3, 41.2].map((fr, i) => { const o = c.createOscillator(); o.type = i % 2 ? 'sawtooth' : 'triangle'; o.frequency.value = fr; o.connect(df); o.start(); return o; });
    const lfo = c.createOscillator(); lfo.frequency.value = 0.05; const lg = c.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(df.frequency); lfo.start();
    df.connect(dg); dg.connect(this.music);
    this.drone = { gain: dg, oscs, filter: df };
  }
  setTension(t: number) { this.tension += (t - this.tension) * 0.02; if (this.drone) this.drone.filter.Q.value = 4 + this.tension * 10; }
  tick(dt: number, lowHp: number, heartActive: boolean) {
    if (!this.ctx) return;
    this.beatT -= dt;
    if (lowHp > 0.01 && this.beatT <= 0) {
      this.beatT = 0.85 - lowHp * 0.35;
      const out = this.panner(null), t = this.ctx.currentTime;
      this.tone('sine', 60, 40, 0.15, out, t, 0.35 * lowHp); this.tone('sine', 60, 40, 0.15, out, t + 0.2, 0.25 * lowHp);
    }
    if (heartActive && Math.random() < dt * 0.06) { const out = this.panner(null); this.noise(3, out, this.ctx.currentTime, 'bandpass', 300 + Math.random() * 300, 8, 0.05, 1, 3); }
    // distant gunfire and screams keep the city alive
    if (Math.random() < dt * 0.05) {
      const a = Math.random() * Math.PI * 2, d = 200 + Math.random() * 200;
      const p = { x: this.listener.x + Math.cos(a) * d, y: 0, z: this.listener.z + Math.sin(a) * d };
      if (Math.random() < 0.6) { const n = 1 + Math.floor(Math.random() * 5); for (let i = 0; i < n; i++) setTimeout(() => this.gunshot('ar', p, false, false), i * 110); }
      else this.creature('hollow', 'scream', p);
    }
  }

  engine(id: number, p: V | null, rpm: number, kind: string) {
    if (!this.ctx) return;
    const c = this.ctx;
    let e = this.engines.get(id);
    if (!p) { if (e) { e.gain.gain.setTargetAtTime(0, c.currentTime, 0.2); setTimeout(() => { e!.osc.stop(); e!.osc2.stop(); }, 800); this.engines.delete(id); } return; }
    if (!e) {
      const osc = c.createOscillator(); osc.type = 'sawtooth';
      const osc2 = c.createOscillator(); osc2.type = 'square';
      const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 500;
      const gain = c.createGain(); gain.gain.value = 0;
      const pan = c.createPanner(); pan.panningModel = 'HRTF'; pan.refDistance = 5; pan.rolloffFactor = 1.2;
      osc.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.sfx);
      osc.start(); osc2.start();
      e = { osc, osc2, gain, filter, pan };
      this.engines.set(id, e);
    }
    const base = kind === 'okada' ? 48 : kind === 'danfo' ? 30 : 36;
    const f = base + rpm * (kind === 'okada' ? 90 : 60);
    e.osc.frequency.setTargetAtTime(f, c.currentTime, 0.05); e.osc2.frequency.setTargetAtTime(f * 0.5, c.currentTime, 0.05);
    e.filter.frequency.setTargetAtTime(300 + rpm * 1400, c.currentTime, 0.05);
    e.gain.gain.setTargetAtTime(0.06 + rpm * 0.09, c.currentTime, 0.1);
    e.pan.positionX.value = p.x; e.pan.positionY.value = p.y; e.pan.positionZ.value = p.z;
  }
  horn(p: V) {
    if (!this.ctx) return;
    const out = this.panner(p, 8, 0.8), t = this.ctx.currentTime;
    this.tone('square', 392, 392, 0.35, out, t, 0.12); this.tone('square', 330, 330, 0.35, out, t, 0.1);
  }
  generators(list: V[]) {
    if (!this.ctx) return;
    const c = this.ctx;
    while (this.gens.length < 3) {
      const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 50 + Math.random() * 8;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      const gain = c.createGain(); gain.gain.value = 0.05;
      const pan = c.createPanner(); pan.panningModel = 'HRTF'; pan.refDistance = 3; pan.rolloffFactor = 1.8;
      osc.connect(f); f.connect(gain); gain.connect(pan); pan.connect(this.amb); osc.start();
      this.gens.push({ osc, gain, pan });
    }
    this.gens.forEach((g, i) => { const p = list[i]; if (p) { g.pan.positionX.value = p.x; g.pan.positionY.value = p.y; g.pan.positionZ.value = p.z; g.gain.gain.value = 0.05; } else g.gain.gain.value = 0; });
  }
  stopAll() {
    for (const [id] of this.engines) this.engine(id, null, 0, '');
    if (this.rain) { this.rain.src.stop(); this.rain = null; }
    if (this.drone) { this.drone.oscs.forEach((o) => o.stop()); this.drone = null; }
    this.gens.forEach((g) => g.osc.stop()); this.gens = [];
  }
}

export const audio = new Audio();
