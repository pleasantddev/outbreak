// Synthesised sound for venues: chips, cards, reels, wins, room tone, and a live afrobeat / amapiano groove for the
// club built from oscillators and noise (no samples, so nothing to download and nothing to license).
let ac: AudioContext | null = null; let master: GainNode | null = null; let noiseBuf: AudioBuffer | null = null;
function ctx() {
  if (!ac) { const C = (window as any).AudioContext || (window as any).webkitAudioContext; if (!C) return null; ac = new C() as AudioContext; master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
function env(g: GainNode, t: number, a: number, peak: number, dec: number) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
function tone(f: number, t: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, out?: AudioNode, glide?: number) {
  const a = ctx()!; const o = a.createOscillator(); const g = a.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur); env(g, t, 0.005, vol, dur); o.connect(g); g.connect(out ?? master!); o.start(t); o.stop(t + dur + 0.05);
}
function noise(t: number, dur: number, vol: number, hp = 1000, out?: AudioNode, bp?: number) {
  const a = ctx()!; const s = a.createBufferSource(); s.buffer = noiseBuf; const f = a.createBiquadFilter(); f.type = bp ? 'bandpass' : 'highpass'; f.frequency.value = bp ?? hp; if (bp) f.Q.value = 1.2; const g = a.createGain(); env(g, t, 0.002, vol, dur); s.connect(f); f.connect(g); g.connect(out ?? master!); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}

let amb: { stop: () => void } | null = null;
export function sfx(k: string) {
  const a = ctx(); if (!a) return; const t = a.currentTime;
  switch (k) {
    case 'chip': noise(t, 0.05, 0.25, 3000); tone(2400, t, 0.04, 'triangle', 0.08); break;
    case 'card': noise(t, 0.07, 0.18, 1800); break;
    case 'tick': tone(3200, t, 0.02, 'square', 0.03); break;
    case 'reel': tone(180, t, 0.12, 'square', 0.12, undefined, 90); noise(t, 0.06, 0.15, 800); break;
    case 'lever': noise(t, 0.3, 0.12, 400); tone(300, t, 0.25, 'sawtooth', 0.05, undefined, 120); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => { tone(f, t + i * 0.09, 0.35, 'triangle', 0.16); tone(f * 2, t + i * 0.09, 0.2, 'sine', 0.05); }); break;
    case 'lose': tone(330, t, 0.25, 'triangle', 0.12, undefined, 220); tone(247, t + 0.18, 0.4, 'triangle', 0.1, undefined, 160); break;
    case 'cash': [1318, 1760].forEach((f, i) => tone(f, t + i * 0.07, 0.25, 'sine', 0.12)); noise(t, 0.08, 0.1, 5000); break;
    case 'hit': tone(880, t, 0.08, 'triangle', 0.12); break;
    case 'miss': tone(160, t, 0.12, 'sawtooth', 0.06, undefined, 90); break;
    case 'ambCasino': ambStop(); amb = casinoAmb(); break;
    case 'ambClub': ambStop(); amb = groove(); break;
    case 'ambStop': ambStop(); break;
  }
}
function ambStop() { amb?.stop(); amb = null; }

/** a warm room: murmur (band-passed noise), distant chimes from machines, a soft lounge chord pad */
function casinoAmb() {
  const a = ctx()!; const out = a.createGain(); out.gain.value = 0.0001; out.gain.exponentialRampToValueAtTime(0.5, a.currentTime + 1.5); out.connect(master!);
  const s = a.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.7; const g = a.createGain(); g.gain.value = 0.06; s.connect(f); f.connect(g); g.connect(out); s.start();
  const chords = [[220, 277, 330, 415], [196, 247, 294, 370], [174.6, 220, 262, 330], [196, 247, 294, 349]]; let i = 0;
  const pad = () => { const t = a.currentTime; for (const fr of chords[i++ % 4]) { const o = a.createOscillator(); o.type = 'sine'; o.frequency.value = fr; const gg = a.createGain(); gg.gain.setValueAtTime(0.0001, t); gg.gain.linearRampToValueAtTime(0.025, t + 1.2); gg.gain.linearRampToValueAtTime(0.0001, t + 4); o.connect(gg); gg.connect(out); o.start(t); o.stop(t + 4.1); } if (Math.random() < 0.6) [1568, 1976, 2349].forEach((fr, k) => tone(fr, t + 1 + k * 0.08, 0.3, 'sine', 0.015, out)); };
  pad(); const id = setInterval(pad, 4000);
  return { stop: () => { clearInterval(id); out.gain.setTargetAtTime(0.0001, a.currentTime, 0.3); setTimeout(() => { try { s.stop(); } catch { /* */ } out.disconnect(); }, 1500); } };
}

/** 112 bpm amapiano-flavoured groove: four-on-the-floor kick, shaker 16ths, rim on 2 and 4, a log-drum bass line
 *  (pitched sine with a fast pitch drop), and a jazzy electric-piano chord stab. Swaps patterns every 8 bars. */
export const beat = { bpm: 112, onBeat: null as ((n: number) => void) | null, step: 0 };
function groove() {
  const a = ctx()!; const out = a.createGain(); out.gain.value = 0.0001; out.gain.exponentialRampToValueAtTime(0.75, a.currentTime + 1); out.connect(master!);
  const comp = a.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.connect(out);
  const spb = 60 / beat.bpm / 4; let next = a.currentTime + 0.1; let step = 0; let bar = 0;
  const LOG = [[0, 55], [3, 55], [6, 65.4], [10, 49], [12, 55], [14, 73.4]]; const LOG2 = [[0, 49], [2, 49], [7, 58.3], [8, 49], [11, 65.4], [14, 55]];
  const CH = [[261.6, 311.1, 392, 466.2], [233.1, 293.7, 349.2, 440], [207.7, 261.6, 311.1, 392], [233.1, 293.7, 349.2, 415.3]];
  const logdrum = (t: number, f: number) => { const o = a.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f * 2.02, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); const g = a.createGain(); env(g, t, 0.004, 0.55, 0.32); const o2 = a.createOscillator(); o2.type = 'triangle'; o2.frequency.setValueAtTime(f * 3, t); const g2 = a.createGain(); env(g2, t, 0.002, 0.08, 0.07); o.connect(g); o2.connect(g2); g.connect(comp); g2.connect(comp); o.start(t); o.stop(t + 0.4); o2.start(t); o2.stop(t + 0.12); };
  const kick = (t: number) => { tone(130, t, 0.22, 'sine', 0.6, comp, 42); };
  const tick = () => {
    while (next < a.currentTime + 0.12) {
      const s = step % 16; const t = next;
      if (s % 4 === 0) kick(t);
      noise(t, 0.03, s % 2 ? 0.05 : 0.08, 7000, comp);
      if (s === 4 || s === 12) { noise(t, 0.05, 0.16, 0, comp, 1800); tone(820, t, 0.03, 'square', 0.03, comp); }
      for (const [st, f] of (bar % 8 < 4 ? LOG : LOG2)) if (st === s) logdrum(t, f);
      if (s === 0 || s === 7 || (s === 10 && bar % 2)) for (const f of CH[bar % 4]) { const o = a.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const g = a.createGain(); env(g, t, 0.01, 0.035, 0.45); o.connect(g); g.connect(comp); o.start(t); o.stop(t + 0.5); }
      if (s % 4 === 0) { const n = step; setTimeout(() => beat.onBeat?.(n / 4), Math.max(0, (t - a.currentTime) * 1000)); }
      next += spb; step++; beat.step = step; if (s === 15) bar++;
    }
  };
  const id = setInterval(tick, 25);
  return { stop: () => { clearInterval(id); out.gain.setTargetAtTime(0.0001, a.currentTime, 0.25); setTimeout(() => out.disconnect(), 1500); } };
}
export function audioTime() { return ctx()?.currentTime ?? 0; }
