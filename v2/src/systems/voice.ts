// Voice. Players near you are heard the way people are heard on a street: loud up close, fading out by about 25 m,
// coming from where they stand (HRTF panning from the camera). Phone calls are a voice link at full volume however far
// apart you are. Police and LASTMA on duty share a walkie-talkie channel per zone: full volume, a radio band-pass, a
// squelch click when someone keys up. WebRTC peer to peer (audio only), the server only relays the handshake and
// only between players who may talk (near each other, on a call, same radio channel). Push to talk: hold V, or the
// mic button on touch; open mic can be switched on in Settings. Your mic is never opened until you ask for it.
import * as THREE from 'three';
import type { GameCtx, GameSystem } from './registry';
import { net } from '../net/client';

const NEAR = 3, FAR = 25, MAX_PEERS = 8, LINK_R = 32; const FWD = new THREE.Vector3();
interface Peer { id: number; pc: RTCPeerConnection; gain: GainNode | null; pan: PannerNode | null; el: HTMLAudioElement; radio: boolean; call: boolean; level: AnalyserNode | null; polite: boolean; making: boolean; ignore: boolean; sender: RTCRtpSender | null }

class Voice {
  private peers = new Map<number, Peer>(); private ac: AudioContext | null = null; private mic: MediaStream | null = null; private track: MediaStreamTrack | null = null;
  ptt = false; openMic = false; private callPeer: number | null = null; radio: string | null = null; private radioMates = new Set<number>();
  private t = 0; private btn: HTMLElement | null = null; private ringOsc: { stop: () => void } | null = null; muted = new Set<number>();
  constructor(private ctx: GameCtx) {}
  init() {
    addEventListener('keydown', (e) => { if (e.code === 'KeyV' && !e.repeat && !(e.target as HTMLElement)?.matches?.('input,textarea')) void this.talk(true); });
    addEventListener('keyup', (e) => { if (e.code === 'KeyV') void this.talk(false); });
    (window as any).__voice = this;
  }
  start() {
    net.on('rtc', (m: any) => void this.signal(m.from, m.data, !!m.radio, !!m.call));
    net.on('closed', () => this.dropAll());
    // touch: a mic button by the utility row
    const tc = document.getElementById('tcrow'); if (tc) { const b = document.createElement('div'); b.className = 'tb sq'; b.dataset.tbtnx = 'mic'; b.dataset.ui = '1'; b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4"/></svg>'; b.style.cssText = 'position:relative'; b.addEventListener('touchstart', (e) => { e.preventDefault(); void this.talk(true); }, { passive: false }); b.addEventListener('touchend', () => void this.talk(false)); tc.appendChild(b); this.btn = b; }
  }
  private audio() { if (!this.ac) this.ac = new AudioContext(); if (this.ac.state === 'suspended') void this.ac.resume(); return this.ac; }
  /** open the mic once, on the first push to talk (the browser asks the player) */
  private async ensureMic() {
    if (this.track) return true;
    try { this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); this.track = this.mic.getAudioTracks()[0]; this.track.enabled = false;
      for (const p of this.peers.values()) this.attachMic(p); return true; }
    catch { this.ctx.hud.toast('Voice', 'Mic blocked. Allow the microphone for this site to talk.', 'var(--red)', 'msg', 4); return false; }
  }
  private attachMic(p: Peer) { if (!this.track || !this.mic) return; if (p.sender) { void p.sender.replaceTrack(this.track); return; } p.sender = p.pc.addTrack(this.track, this.mic); }
  async talk(on: boolean) {
    if (!net.active) return; this.audio();
    if (on && !(await this.ensureMic())) return; this.ptt = on; this.applyMic();
    if (on && this.radio) this.click();
    this.btn?.classList.toggle('down', on);
  }
  private applyMic() { if (this.track) this.track.enabled = this.ptt || this.openMic || this.callPeer !== null; }
  setOpenMic(v: boolean) { this.openMic = v; if (v) void this.ensureMic().then(() => this.applyMic()); else this.applyMic(); }

  // ---------------------------------------------------------------- links
  private ice() { return ((net.welcome as any)?.ice as RTCIceServer[] | undefined) ?? [{ urls: 'stun:stun.l.google.com:19302' }]; }
  private link(id: number, opts: { radio?: boolean; call?: boolean } = {}) {
    let p = this.peers.get(id); if (p) { p.radio ||= !!opts.radio; p.call ||= !!opts.call; return p; }
    const pc = new RTCPeerConnection({ iceServers: this.ice() }); const el = new Audio(); el.autoplay = true; el.muted = true; // Chrome needs the element for WebRTC audio to flow into Web Audio
    p = { id, pc, gain: null, pan: null, el, radio: !!opts.radio, call: !!opts.call, level: null, polite: net.myId > id, making: false, ignore: false, sender: null };
    const peer = p; this.peers.set(id, p);
    pc.addTransceiver('audio', { direction: 'sendrecv' }); this.attachMic(p);
    pc.onicecandidate = (e) => { if (e.candidate) void net.act('rtc', { to: id, data: { ice: e.candidate.toJSON() } }); };
    pc.onnegotiationneeded = async () => { try { peer.making = true; await pc.setLocalDescription(); void net.act('rtc', { to: id, data: { sdp: pc.localDescription } }); } catch { /* retried on next change */ } finally { peer.making = false; } };
    pc.ontrack = (e) => { const ac = this.audio(); const stream = e.streams[0] ?? new MediaStream([e.track]); el.srcObject = stream;
      const src = ac.createMediaStreamSource(stream); const gain = ac.createGain(); gain.gain.value = 0; const an = ac.createAnalyser(); an.fftSize = 256;
      if (peer.radio && !peer.call) { const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.9; const sh = ac.createWaveShaper(); sh.curve = this.crunch(); src.connect(bp).connect(sh).connect(gain); }
      else if (peer.call) src.connect(gain);
      else { const pan = ac.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'linear'; pan.refDistance = NEAR; pan.maxDistance = FAR; pan.rolloffFactor = 1; src.connect(pan).connect(gain); peer.pan = pan; }
      gain.connect(ac.destination); src.connect(an); peer.gain = gain; peer.level = an; };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(id); };
    return p;
  }
  /** perfect negotiation (both sides may offer; the polite one yields) */
  private async signal(from: number, data: any, radio: boolean, call: boolean) {
    const p = this.link(from, { radio, call }); const pc = p.pc;
    try {
      if (data?.sdp) {
        const offer = data.sdp.type === 'offer'; const collide = offer && (p.making || pc.signalingState !== 'stable');
        p.ignore = !p.polite && collide; if (p.ignore) return;
        await pc.setRemoteDescription(data.sdp);
        if (offer) { await pc.setLocalDescription(); void net.act('rtc', { to: from, data: { sdp: pc.localDescription } }); }
      } else if (data?.ice) { try { await pc.addIceCandidate(data.ice); } catch (e) { if (!p.ignore) throw e; } }
    } catch { /* a dropped handshake gets redone on the next pass */ }
  }
  private drop(id: number) { const p = this.peers.get(id); if (!p) return; try { p.pc.close(); } catch { /* */ } p.el.srcObject = null; p.gain?.disconnect(); this.peers.delete(id); }
  private dropAll() { for (const id of [...this.peers.keys()]) this.drop(id); }

  // ---------------------------------------------------------------- calls and radio
  startCall(peer: number) { this.callPeer = peer; const p = this.link(peer, { call: true }); p.call = true; this.applyMic(); void this.ensureMic().then(() => { this.attachMic(p); this.applyMic(); }); }
  endCall() { const id = this.callPeer; this.callPeer = null; this.applyMic(); if (id !== null) { const p = this.peers.get(id); if (p) p.call = false; } }
  /** join a walkie-talkie channel (police:ikeja); everybody on it hears you when you key up */
  async joinRadio(channel: string | null) {
    if (!net.active) return; const r = await net.act('radio.join', { channel }); if (!r.ok) return; this.radio = channel; this.radioMates = new Set(((r as any).members ?? []).map((m: any) => m.id));
    for (const id of this.radioMates) this.link(id, { radio: true });
  }
  private crunch() { const n = 256, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = Math.tanh(x * 2.2); } return c; }
  private click() { const ac = this.audio(); const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = 2400; g.gain.setValueAtTime(0.06, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.06); o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.07); }
  ring(on: boolean) {
    this.ringOsc?.stop(); this.ringOsc = null; if (!on) return; const ac = this.audio(); let alive = true; const beep = () => { if (!alive) return; const t = ac.currentTime; for (const f of [440, 480]) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.025, t); g.gain.setValueAtTime(0, t + 1.6); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 1.7); } setTimeout(beep, 4000); };
    beep(); this.ringOsc = { stop: () => { alive = false; } };
  }

  // ---------------------------------------------------------------- every frame: who to link, how loud
  frame(dt: number) {
    if (!net.active) { if (this.peers.size) this.dropAll(); return; }
    const remote = (window as any).__net?.remote; const cam = this.ctx.view.camera; const ac = this.ac;
    if (ac) { const L = ac.listener; const f = cam.getWorldDirection(FWD); const p = cam.position;
      if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; } }
    // volumes and speaking rings
    for (const p of this.peers.values()) {
      const rp = remote?.players.get(p.id); const s = rp?.buf[rp.buf.length - 1];
      if (p.gain) { const muted = this.muted.has(p.id); let v = 0; if (p.call || p.radio) v = 1; else if (s) { const me = this.ctx.sim.local.pos; const d = Math.hypot(s.x - me.x, s.z - me.z); v = d <= NEAR ? 1 : d >= FAR ? 0 : 1 - (d - NEAR) / (FAR - NEAR); if (p.pan) { p.pan.positionX.value = s.x; p.pan.positionY.value = (s.y ?? 0) + 1.6; p.pan.positionZ.value = s.z; } }
        p.gain.gain.setTargetAtTime(muted ? 0 : v, ac!.currentTime, 0.08); }
      if (p.level && rp) { const a = new Uint8Array(p.level.fftSize); p.level.getByteTimeDomainData(a); let m = 0; for (const x of a) m = Math.max(m, Math.abs(x - 128)); if (m > 10) remote.said(p.id); }
    }
    this.t -= dt; if (this.t > 0) return; this.t = 1.5;
    // keep links to the nearest few players (the server only shows us players in our space), plus call and radio
    const me = this.ctx.sim.local.pos; const near: { id: number; d: number }[] = [];
    if (remote) for (const [id, rp] of remote.players) { const s = rp.buf[rp.buf.length - 1]; if (!s) continue; const d = Math.hypot(s.x - me.x, s.z - me.z); if (d < LINK_R) near.push({ id, d }); }
    near.sort((a, b) => a.d - b.d); const want = new Set(near.slice(0, MAX_PEERS).map((n) => n.id)); if (this.callPeer !== null) want.add(this.callPeer); for (const id of this.radioMates) want.add(id);
    for (const id of want) if (!this.peers.has(id) && net.myId < id) this.link(id); // the lower id starts it, the other answers
    for (const [id, p] of this.peers) if (!want.has(id) && !p.call && !p.radio) this.drop(id);
  }
}
let V: Voice | null = null;
export const voiceSystem: GameSystem & { get api(): Voice | null } = { id: 'voice', get api() { return V; }, init(ctx) { V = new Voice(ctx); V.init(); }, start() { V?.start(); }, frame(_c, dt) { V?.frame(dt); } };
/** for other systems (calls, police radio) */
export const voice = {
  startCall: (peer: number) => V?.startCall(peer), endCall: () => V?.endCall(), ring: (on: boolean) => V?.ring(on),
  joinRadio: (ch: string | null) => V?.joinRadio(ch), talk: (on: boolean) => V?.talk(on), setOpenMic: (v: boolean) => V?.setOpenMic(v),
};
