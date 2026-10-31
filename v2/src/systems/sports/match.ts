// The match screen: takes over the game renderer with its own scene (the pitch or the court, players built from the
// game's character models, a real ball), reads keyboard, gamepad and touch, steps the sim (offline or as host) or
// follows the host's snapshots (as a guest), and draws a broadcast style HUD.
import * as THREE from 'three';
import type { GameCtx } from '../registry';
import { HumanView, type CharState } from '../../render/humans';
import { emptyPad, type Btn, type PadIn, type SportSim } from './types';
import { Football } from './football';
import { Basketball } from './basketball';

export interface MatchOpts {
  sport: 'football' | 'basketball'; title: string; L: number; W: number; stadium?: boolean;
  /** online: everybody in the fixture; `me` is my account id, `host` runs the sim */
  humans: { id: string; name: string; side: 0 | 1 }[]; me: string; host: string; online: boolean;
  teams: [string, string]; wager?: number;
  send?: (d: unknown) => void; onEnd: (score: [number, number], quit: boolean) => void;
}
const KITS: [number, number, string, string][] = [[0x1f9d55, 0xffffff, '#1f9d55', '#f5f5f5'], [0xd62828, 0x111111, '#d62828', '#141414']];
const NAMES = [['Tobi', 'Emeka', 'Sadiq', 'Jide', 'Kola'], ['Uche', 'Femi', 'Musa', 'Dayo', 'Chuks']];
const css = `
#mx{position:fixed;inset:0;z-index:60;font-family:Inter,system-ui,sans-serif;color:#fff;user-select:none;-webkit-user-select:none;touch-action:none}
#mx .sb{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;align-items:stretch;border-radius:10px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.4);font-weight:800;font-size:17px}
#mx .sb div{padding:7px 12px;background:rgba(10,12,18,.86)} #mx .sb .t0{background:#1f9d55} #mx .sb .t1{background:#d62828} #mx .sb .sc{font-size:20px;min-width:66px;text-align:center;letter-spacing:2px} #mx .sb .ck{background:#f5c518;color:#111;font-variant-numeric:tabular-nums}
#mx .bn{position:absolute;top:30%;left:0;right:0;text-align:center;font:900 64px Oswald,Impact,sans-serif;letter-spacing:3px;text-shadow:0 4px 0 rgba(0,0,0,.35),0 0 30px rgba(0,0,0,.4);pointer-events:none;transition:opacity .2s}
#mx .ev{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:rgba(10,12,18,.72);padding:6px 14px;border-radius:999px;font-size:14px;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis}
#mx .hint{position:absolute;top:62px;left:50%;transform:translateX(-50%);font-size:12px;opacity:.75;background:rgba(0,0,0,.35);padding:4px 10px;border-radius:6px;white-space:nowrap}
#mx .meter{position:absolute;width:90px;height:12px;border-radius:6px;background:rgba(0,0,0,.6);border:2px solid #fff;overflow:hidden;transform:translate(-50%,-50%);display:none}
#mx .meter i{position:absolute;top:0;bottom:0;left:0;background:#fff} #mx .meter b{position:absolute;top:0;bottom:0;background:rgba(73,224,138,.75)}
#mx .tag{position:absolute;transform:translate(-50%,-100%);font-size:11px;font-weight:700;background:rgba(0,0,0,.55);padding:1px 6px;border-radius:4px;white-space:nowrap;pointer-events:none}
#mx .quit{position:absolute;top:14px;left:14px;background:rgba(10,12,18,.7);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:8px 12px;font-weight:700;font-size:13px}
#mx .end{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55)} #mx .end>div{background:#12141c;border-radius:16px;padding:24px 28px;text-align:center;min-width:280px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
#mx .end h2{margin:0 0 6px;font:900 34px Oswald,Impact,sans-serif;letter-spacing:2px} #mx .end button{margin-top:16px;background:#2de0c8;color:#062;border:0;border-radius:10px;padding:12px 22px;font-weight:800;font-size:15px}
#mx .joy{position:absolute;left:0;bottom:0;width:45%;height:60%} #mx .joy .k{position:absolute;width:120px;height:120px;border-radius:50%;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.06);display:none} #mx .joy .k i{position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.45)}
#mx .pad{position:absolute;right:14px;bottom:18px;display:grid;grid-template-columns:repeat(3,72px);gap:10px}
#mx .pad button{width:72px;height:72px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(15,18,28,.6);color:#fff;font-weight:800;font-size:11px;letter-spacing:.5px}
#mx .pad button.on{background:rgba(45,224,200,.55)} #mx .pad .big{background:rgba(214,40,40,.6)}
`;

export class MatchScreen {
  sim: SportSim; scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  private views: HumanView[] = []; private ballMesh: THREE.Mesh; private ring: THREE.Mesh; private shadowBlob: THREE.Mesh;
  private ui: HTMLDivElement; private keys = new Set<string>(); private prevHold: Partial<Record<Btn, boolean>> = {}; private touchHold: Partial<Record<Btn, boolean>> = {};
  private joy = { x: 0, z: 0, id: -1, ox: 0, oy: 0 }; private acc = 0; private sendT = 0; private remote = new Map<string, PadIn>(); private lastPad: PadIn = emptyPad();
  private evText = ''; private evT = 0; private ended = false; private camX = 0; private camZ = 0; private tags: HTMLDivElement[] = []; private handlers: [EventTarget, string, EventListener][] = [];
  private isHost: boolean;
  constructor(private ctx: GameCtx, public o: MatchOpts) {
    this.isHost = !o.online || o.host === o.me;
    const hs = o.online ? o.humans : [{ id: 'me', name: ctx.profile?.name || 'You', side: 0 as const }];
    this.sim = o.sport === 'football' ? new Football(o.L, o.W, hs, NAMES as [string[], string[]]) : new Basketball(hs, NAMES as [string[], string[]]);
    if (!o.online) o.me = 'me';
    this.build(); this.ballMesh = this.makeBall(); this.scene.add(this.ballMesh);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 32), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthWrite: false })); this.ring.rotation.x = -Math.PI / 2; this.scene.add(this.ring);
    this.shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false })); this.shadowBlob.rotation.x = -Math.PI / 2; this.scene.add(this.shadowBlob);
    const assets = ctx.view.assets;
    this.sim.players.forEach((p, i) => {
      const lk: any = ctx.sim.randomLook(); const kit = KITS[p.team];
      Object.assign(lk, { top: 'tee', topPattern: 'solid', topColor: kit[2], topAccent: kit[3], pants: 'solid', pantsColor: kit[3], head: 'none', backpack: false, vest: false });
      if (o.sport === 'football' && (p as any).role === 0) Object.assign(lk, { topColor: p.team ? '#f59e0b' : '#7c3aed' });
      const v = new HumanView(assets, lk, i * 3.1); v.setShadow(1); this.scene.add(v.root); this.views.push(v);
      const t = document.createElement('div'); t.className = 'tag'; this.tags.push(t);
    });
    this.ui = document.createElement('div'); this.ui.id = 'mx'; this.ui.innerHTML = `<style>${css}</style>
      <div class="sb"><div class="t0">${esc(o.teams[0])}</div><div class="sc">0 : 0</div><div class="t1">${esc(o.teams[1])}</div><div class="ck">0:00</div></div>
      <div class="hint">${o.sport === 'football' ? 'WASD move · Shift sprint · J pass · I through ball · K hold to shoot · L tackle · Q switch' : 'WASD move · Shift sprint · J pass · K hold, release in the green · L block · I steal · Q switch'}</div>
      <div class="bn"></div><div class="ev"></div><div class="meter"><b></b><i></i></div>
      <button class="quit">${o.online ? 'Leave match' : 'Quit'}</button>
      <div class="end"><div><div style="opacity:.7;font-size:13px">${esc(o.title)}</div><h2></h2><div class="res" style="font-size:15px"></div><button>Continue</button></div></div>
      ${ctx.input.touch ? `<div class="joy"><div class="k"><i></i></div></div><div class="pad">${this.padHtml()}</div>` : ''}`;
    for (const t of this.tags) this.ui.appendChild(t);
    document.body.appendChild(this.ui);
    (this.ui.querySelector('.quit') as HTMLElement).onclick = () => this.finish(true);
    (this.ui.querySelector('.end button') as HTMLElement).onclick = () => this.close();
    this.bindInput();
    ctx.setModal(true, true); ctx.hud.root.style.display = 'none';
  }
  private padHtml() {
    const b = this.o.sport === 'football' ? [['switch', 'SWITCH'], ['thru', 'THROUGH'], ['sprint', 'SPRINT'], ['tackle', 'TACKLE'], ['pass', 'PASS'], ['shoot', 'SHOOT']] : [['switch', 'SWITCH'], ['thru', 'STEAL'], ['sprint', 'SPRINT'], ['tackle', 'BLOCK'], ['pass', 'PASS'], ['shoot', 'SHOOT']];
    return b.map(([id, l]) => `<button data-b="${id}" class="${id === 'shoot' ? 'big' : ''}">${l}</button>`).join('');
  }

  // ---------------------------------------------------------------- the place
  private build() {
    const s = this.scene, o = this.o; const night = (() => { const h = this.ctx.view.atmo.hour; return h >= 18.5 || h < 6.3; })();
    s.background = new THREE.Color(night ? 0x0b1020 : 0x9cc9ea); s.fog = new THREE.Fog(s.background.getHex(), 60, 220);
    s.add(new THREE.HemisphereLight(night ? 0x8090c0 : 0xdfeeff, 0x3a3328, night ? 0.9 : 1.5));
    const sun = new THREE.DirectionalLight(night ? 0xfff2d8 : 0xfff1d6, night ? 1.6 : 2.4); sun.position.set(-20, 40, 18); sun.castShadow = true;
    const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = -35; sc.right = 35; sc.top = 25; sc.bottom = -25; sc.far = 120; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; s.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x6d6a5f, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; s.add(ground);
    { // a ring of compound walls, bungalows and flats around the place, so it reads as a street pitch in Lagos
      const cols = [0xd9c9a8, 0xc7b08a, 0xe8dcc4, 0xb7c4c9, 0xd4a373, 0xa9b18f]; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const R = o.sport === 'football' ? o.L / 2 + 22 : 22;
      for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2 + rnd() * 0.1; const w = 8 + rnd() * 10, h = 4 + rnd() * (rnd() < 0.3 ? 14 : 5), d = 7 + rnd() * 6;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.95 })); const rr = R + rnd() * 10;
        m.position.set(Math.cos(a) * rr * 1.3, h / 2, (o.sport === 'football' ? 0 : 7) + Math.sin(a) * rr); m.rotation.y = -a; m.castShadow = true; m.receiveShadow = true; if (Math.sin(a) > 0.55) continue; s.add(m);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.3, d + 0.6), new THREE.MeshStandardMaterial({ color: 0x7a3b22, roughness: 0.8 })); roof.position.set(m.position.x, h + 0.15, m.position.z); roof.rotation.y = -a; s.add(roof); }
    }
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.2 });
    const fence = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; s.add(b); return b; };
    if (o.sport === 'football') {
      const L = o.L, W = o.W;
      const turf = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ map: pitchTex(L, W), roughness: 0.95 })); turf.rotation.x = -Math.PI / 2; turf.receiveShadow = true; s.add(turf);
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(L + 6, W + 6), new THREE.MeshStandardMaterial({ color: 0x2f6b2c, roughness: 1 })); apron.rotation.x = -Math.PI / 2; apron.position.y = -0.01; apron.receiveShadow = true; s.add(apron);
      for (const sd of [-1, 1]) { // goals: posts, bar and a net box
        const gx = sd * L / 2; for (const z of [-2, 2]) box(0.1, 2, 0.1, white, gx, 1, z); box(0.1, 0.1, 4.1, white, gx, 2, 0);
        const net = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, wireframe: true });
        const nb = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2, 4, 6, 10, 20), net); nb.position.set(gx + sd * 0.55, 1, 0); s.add(nb);
      }
      // the cage: boards and mesh all round, like every 5-a-side in Lagos
      const board = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.6 });
      for (const sd of [-1, 1]) { box(L, 0.9, 0.08, board, 0, 0.45, sd * (W / 2 + 0.05)); const f = new THREE.Mesh(new THREE.PlaneGeometry(L, 5), fence); f.position.set(0, 3.4, sd * (W / 2 + 0.05)); s.add(f);
        for (const z of [-1, 1]) { box(0.08, 0.9, W / 2 - 2, board, sd * (L / 2 + 0.05), 0.45, z * (W / 4 + 1)); } const fe = new THREE.Mesh(new THREE.PlaneGeometry(W, 5), fence); fe.rotation.y = Math.PI / 2; fe.position.set(sd * (L / 2 + 1.2), 3.4, 0); s.add(fe); }
      const pole = new THREE.MeshStandardMaterial({ color: 0x444a52, metalness: 0.6, roughness: 0.4 });
      for (const [x, z] of [[-L / 2 - 1.5, -W / 2 - 1.5], [L / 2 + 1.5, -W / 2 - 1.5], [-L / 2 - 1.5, W / 2 + 1.5], [L / 2 + 1.5, W / 2 + 1.5]]) {
        box(0.2, 11, 0.2, pole, x, 5.5, z); const lamp = box(1.6, 0.5, 0.3, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: night ? 0xfff6dd : 0x222222, emissiveIntensity: night ? 2 : 1 }), x, 11, z); lamp.lookAt(0, 0, 0);
        if (night) { const sp = new THREE.SpotLight(0xfff3dd, 260, 70, 0.9, 0.5, 1.4); sp.position.set(x, 11, z); sp.target.position.set(x * 0.2, 0, z * 0.2); s.add(sp, sp.target); }
      }
      if (o.stadium) { const seat = new THREE.MeshStandardMaterial({ color: 0x2a5bd7, roughness: 0.8 }); for (let k = 0; k < 6; k++) box(L + 20, 0.5, 1.4, seat, 0, 0.6 + k * 0.7, -W / 2 - 6 - k * 1.4); }
      else { const wall = new THREE.MeshStandardMaterial({ color: 0xd8cbb3, roughness: 0.95 }); box(L + 30, 3, 0.3, wall, 0, 1.5, -W / 2 - 10); }
    } else {
      const court = new THREE.Mesh(new THREE.PlaneGeometry(15, 14), new THREE.MeshStandardMaterial({ map: courtTex(), roughness: 0.85 })); court.rotation.x = -Math.PI / 2; court.position.set(0, 0.005, 7); court.receiveShadow = true; s.add(court);
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(21, 19), new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 1 })); apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0.0, 7); apron.receiveShadow = true; s.add(apron);
      const pole = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.6, roughness: 0.4 });
      box(0.2, 3.4, 0.2, pole, 0, 1.7, 0.1); box(0.15, 0.15, 1.1, pole, 0, 3.35, 0.65);
      box(1.8, 1.05, 0.05, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), 0, 3.45, 1.2);
      box(0.59, 0.45, 0.06, new THREE.MeshStandardMaterial({ color: 0xd62828 }), 0, 3.3, 1.21).scale.set(1, 1, 0.3);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 8, 24), new THREE.MeshStandardMaterial({ color: 0xff6a00, metalness: 0.4 })); rim.rotation.x = Math.PI / 2; rim.position.set(0, 3.05, 1.575); s.add(rim);
      const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.14, 0.42, 12, 3, true), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.7 })); net.position.set(0, 2.84, 1.575); s.add(net);
      for (const sd of [-1, 1]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(19, 4), fence); f.rotation.y = Math.PI / 2; f.position.set(sd * 9.5, 2, 7); s.add(f); }
      const f2 = new THREE.Mesh(new THREE.PlaneGeometry(19, 4), fence); f2.position.set(0, 2, -2); s.add(f2);
      const wall = new THREE.MeshStandardMaterial({ color: 0xc9b99c, roughness: 0.95 }); box(40, 4, 0.3, wall, 0, 2, -6);
      if (night) for (const x of [-9, 9]) { box(0.15, 7, 0.15, pole, x, 3.5, 2); const sp = new THREE.SpotLight(0xfff3dd, 160, 40, 0.9, 0.5, 1.4); sp.position.set(x, 7, 2); sp.target.position.set(0, 0, 7); s.add(sp, sp.target); }
    }
  }
  private makeBall() {
    const fb = this.o.sport === 'football'; const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const k = cv.getContext('2d')!;
    k.fillStyle = fb ? '#f5f5f5' : '#d4621a'; k.fillRect(0, 0, 128, 64);
    if (fb) { k.fillStyle = '#151515'; for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) { k.beginPath(); const x = i * 16 + (j % 2) * 8, y = 10 + j * 22; for (let a = 0; a < 5; a++) { const t = a / 5 * Math.PI * 2; k.lineTo(x + Math.cos(t) * 5, y + Math.sin(t) * 5); } k.fill(); } }
    else { k.strokeStyle = '#1a0d05'; k.lineWidth = 2; for (const x of [32, 64, 96]) { k.beginPath(); k.moveTo(x, 0); k.lineTo(x, 64); k.stroke(); } k.beginPath(); k.moveTo(0, 32); k.lineTo(128, 32); k.stroke(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.SphereGeometry(fb ? 0.11 : 0.12, 20, 14), new THREE.MeshStandardMaterial({ map: tex, roughness: fb ? 0.45 : 0.7 })); m.castShadow = true; return m;
  }

  // ---------------------------------------------------------------- input
  private bindInput() {
    const on = (t: EventTarget, ev: string, f: EventListener, opt?: any) => { t.addEventListener(ev, f, opt); this.handlers.push([t, ev, f]); };
    on(window, 'keydown', (e) => { const k = (e as KeyboardEvent).code; this.keys.add(k); if (k === 'Space' || k === 'Tab') e.preventDefault(); });
    on(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code)); on(window, 'blur', () => this.keys.clear());
    const joy = this.ui.querySelector('.joy') as HTMLElement | null; const knob = joy?.querySelector('.k') as HTMLElement | null;
    if (joy && knob) {
      on(joy, 'pointerdown', (e) => { const p = e as PointerEvent; this.joy.id = p.pointerId; this.joy.ox = p.clientX; this.joy.oy = p.clientY; knob.style.display = 'block'; knob.style.left = p.clientX - 60 + 'px'; knob.style.top = p.clientY - joy.getBoundingClientRect().top - 60 + 'px'; joy.setPointerCapture(p.pointerId); });
      on(joy, 'pointermove', (e) => { const p = e as PointerEvent; if (p.pointerId !== this.joy.id) return; let dx = (p.clientX - this.joy.ox) / 50, dy = (p.clientY - this.joy.oy) / 50; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } this.joy.x = dx; this.joy.z = dy; (knob.firstElementChild as HTMLElement).style.transform = `translate(${dx * 35}px,${dy * 35}px)`; });
      const up = (e: Event) => { if ((e as PointerEvent).pointerId !== this.joy.id) return; this.joy.id = -1; this.joy.x = this.joy.z = 0; knob.style.display = 'none'; };
      on(joy, 'pointerup', up); on(joy, 'pointercancel', up);
    }
    this.ui.querySelectorAll('.pad button').forEach((b) => {
      const id = (b as HTMLElement).dataset.b as Btn | 'sprint';
      on(b, 'pointerdown', (e) => { e.preventDefault(); (this.touchHold as any)[id] = true; b.classList.add('on'); });
      const up = () => { (this.touchHold as any)[id] = false; b.classList.remove('on'); }; on(b, 'pointerup', up); on(b, 'pointerleave', up); on(b, 'pointercancel', up);
    });
  }
  private readPad(): PadIn {
    const k = this.keys; const gp = navigator.getGamepads?.()?.find((g) => g && g.connected) ?? null;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0), mz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (this.joy.id >= 0) { mx = this.joy.x; mz = this.joy.z; }
    const gb = (i: number) => !!gp?.buttons[i]?.pressed;
    if (gp && Math.hypot(gp.axes[0], gp.axes[1]) > 0.2) { mx = gp.axes[0]; mz = gp.axes[1]; }
    const hold: Partial<Record<Btn, boolean>> = {
      pass: k.has('KeyJ') || !!this.touchHold.pass || gb(0), thru: k.has('KeyI') || !!this.touchHold.thru || gb(3), shoot: k.has('KeyK') || k.has('Space') || !!this.touchHold.shoot || gb(1),
      tackle: k.has('KeyL') || !!this.touchHold.tackle || gb(2), switch: k.has('KeyQ') || !!this.touchHold.switch || gb(4),
    };
    const press: Partial<Record<Btn, boolean>> = {}, release: Partial<Record<Btn, boolean>> = {};
    for (const b of Object.keys(hold) as Btn[]) { if (hold[b] && !this.prevHold[b]) press[b] = true; if (!hold[b] && this.prevHold[b]) release[b] = true; }
    this.prevHold = hold;
    // the camera looks across the pitch, so the screen is the pitch: right is +x, up is -z
    return { mx, mz, sprint: k.has('ShiftLeft') || k.has('ShiftRight') || !!(this.touchHold as any).sprint || gb(7) || gb(5), hold, press, release };
  }
  /** merge presses between network sends so a quick tap is never lost */
  private mergePad(a: PadIn, b: PadIn): PadIn { return { mx: b.mx, mz: b.mz, sprint: b.sprint, hold: b.hold, press: { ...a.press, ...b.press }, release: { ...a.release, ...b.release } }; }

  /** a guest's input arrives (host only) */
  onRemote(from: string, d: any) {
    if (d?.pad) { const prev = this.remote.get(from); const p = d.pad as PadIn; this.remote.set(from, prev ? this.mergePad(prev, p) : p); }
    if (d?.snap && !this.isHost) this.sim.apply(d.snap);
  }

  // ---------------------------------------------------------------- every frame
  frame(dt: number) {
    if (this.ended) return;
    const pad = this.readPad(); const me = this.o.me;
    if (this.isHost) {
      this.acc += Math.min(dt, 0.1); let first = true;
      while (this.acc >= 1 / 60) {
        const pads = new Map<string, PadIn>(); pads.set(me, first ? pad : { ...pad, press: {}, release: {} });
        for (const [id, p] of this.remote) { pads.set(id, p); this.remote.set(id, { ...p, press: {}, release: {} }); }
        this.sim.step(1 / 60, pads); this.acc -= 1 / 60; first = false;
      }
      if (this.o.online) { this.sendT -= dt; if (this.sendT <= 0) { this.sendT = 1 / 15; this.o.send?.({ snap: this.sim.snap() }); } }
    } else {
      this.lastPad = this.mergePad(this.lastPad, pad); this.sendT -= dt;
      if (this.sendT <= 0) { this.sendT = 1 / 20; this.o.send?.({ pad: this.lastPad }); this.lastPad = { ...pad, press: {}, release: {} }; }
      const p = this.sim.players; for (const q of p) { q.x += q.vx * dt * 0.5; q.z += q.vz * dt * 0.5; } // light extrapolation between snapshots
    }
    this.render(dt);
    if (this.sim.over && !this.ended) this.finish(false);
  }
  private render(dt: number) {
    const S = this.sim; const me = this.sim.control.get(this.o.me) ?? -1;
    S.players.forEach((p, i) => {
      const v = this.views[i]; const sp = Math.hypot(p.vx, p.vz);
      v.root.position.set(p.x, p.y ?? 0, p.z);
      const st: CharState = { anim: p.anim, clip: p.clip, speed: sp, moveYaw: p.face, aimYaw: p.face, pitch: 0, aiming: false, armed: false, weapon: null, firing: false, reloading: false, melee: false, dead: false, driving: false, shadow: 1, awaken: 1, hit: 0, cast: false, healing: false, faceYaw: p.face };
      v.update(dt, st, performance.now() / 1000);
    });
    const b = S.ball; this.ballMesh.position.set(b.x, b.y, b.z); this.ballMesh.rotation.x += (b.vz || 0) * dt * 6; this.ballMesh.rotation.z -= (b.vx || 0) * dt * 6;
    this.shadowBlob.position.set(b.x, 0.02, b.z); this.shadowBlob.scale.setScalar(Math.max(0.4, 1 - b.y * 0.12));
    if (me >= 0) { const p = S.players[me]; this.ring.visible = true; this.ring.position.set(p.x, 0.03, p.z); } else this.ring.visible = false;
    // broadcast camera: across the pitch, panning with the ball
    const cam = this.cam; cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
    if (this.o.sport === 'football') {
      const lim = Math.max(0, this.o.L / 2 - 9); this.camX += (THREE.MathUtils.clamp(b.x, -lim, lim) - this.camX) * Math.min(1, dt * 3);
      const far = innerWidth < innerHeight ? 1.6 : 1; this.camZ += (THREE.MathUtils.clamp(b.z, -4, 4) * 0.4 - this.camZ) * Math.min(1, dt * 2); cam.position.set(this.camX, 9.5 * far, this.o.W / 2 + 10.5 * far + this.camZ); cam.lookAt(this.camX, 0, this.camZ + 0.5);
    } else { this.camX += (b.x * 0.35 - this.camX) * Math.min(1, dt * 3); const far = innerWidth < innerHeight ? 1.35 : 1; cam.position.set(this.camX, 7.5 * far, 18.5 * far); cam.lookAt(this.camX * 0.5, 1.2, 5.2); }
    const r = this.ctx.view.renderer; const au = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = true; r.render(this.scene, cam); r.shadowMap.autoUpdate = au;
    // HUD
    const q = (s: string) => this.ui.querySelector(s) as HTMLElement;
    q('.sc').textContent = `${S.score[0]} : ${S.score[1]}`;
    const c = Math.max(0, S.clock); q('.ck').textContent = this.o.sport === 'football' ? `${String(Math.floor((240 - c) / 6)).padStart(2, '0')}'` : `${Math.floor(c / 60)}:${String(Math.floor(c % 60)).padStart(2, '0')}`;
    const bn = q('.bn'); bn.textContent = S.bannerT > 0 ? S.banner : ''; bn.style.opacity = S.bannerT > 0 ? '1' : '0';
    if (S.events.length) { this.evText = S.events[S.events.length - 1]; S.events.length = 0; this.evT = 3.5; } this.evT -= dt;
    const ev = q('.ev'); ev.textContent = this.evText; ev.style.display = this.evT > 0 && this.evText ? 'block' : 'none';
    const proj = (x: number, y: number, z: number) => { const v = new THREE.Vector3(x, y, z).project(cam); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, ok: v.z < 1 }; };
    const mt = q('.meter'); const m = this.sim.meter(this.o.me);
    if (m && me >= 0) { const p = S.players[me]; const s = proj(p.x, 2.3, p.z); mt.style.display = 'block'; mt.style.left = s.x + 'px'; mt.style.top = s.y + 'px'; (mt.querySelector('i') as HTMLElement).style.width = `${m.v * 100}%`; const g = mt.querySelector('b') as HTMLElement; g.style.left = `${m.good[0] * 100}%`; g.style.width = `${(m.good[1] - m.good[0]) * 100}%`; } else mt.style.display = 'none';
    S.players.forEach((p, i) => { const t = this.tags[i]; const show = !!p.human || i === me; if (!show) { t.style.display = 'none'; return; } const s = proj(p.x, 2.05, p.z); t.style.display = s.ok ? 'block' : 'none'; t.style.left = s.x + 'px'; t.style.top = s.y + 'px'; t.textContent = i === me ? 'YOU' : p.name; t.style.background = p.team ? 'rgba(214,40,40,.8)' : 'rgba(31,157,85,.8)'; });
  }
  private finish(quit: boolean) {
    if (this.ended) return; this.ended = true; const S = this.sim; const side = this.o.online ? (this.o.humans.find((h) => h.id === this.o.me)?.side ?? 0) : 0;
    const [a, b] = S.score; const mine = side ? b : a, theirs = side ? a : b;
    const end = this.ui.querySelector('.end') as HTMLElement; end.style.display = 'flex';
    (end.querySelector('h2') as HTMLElement).textContent = quit ? 'YOU LEFT' : mine > theirs ? 'YOU WIN!' : mine < theirs ? 'YOU LOSE' : 'DRAW';
    (end.querySelector('.res') as HTMLElement).innerHTML = `${esc(this.o.teams[0])} <b>${a} : ${b}</b> ${esc(this.o.teams[1])}${quit && this.o.online ? '<br><span style="opacity:.7">Leaving a live match forfeits your stake.</span>' : ''}${!quit && this.o.wager ? '<br><span style="opacity:.7">The server settles the stakes once everybody reports.</span>' : ''}`;
    this.o.onEnd([a, b], quit);
  }
  close() {
    for (const [t, ev, f] of this.handlers) t.removeEventListener(ev, f); this.handlers = [];
    this.ui.remove(); for (const v of this.views) v.dispose();
    this.scene.traverse((o: any) => { o.geometry?.dispose?.(); if (o.material && !(o as any).isSkinnedMesh) { o.material.map?.dispose?.(); o.material.dispose?.(); } });
    this.ctx.setModal(false, true); this.ctx.hud.root.style.display = ''; this.ended = true; this.closed = true;
  }
  closed = false;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function pitchTex(L: number, W: number) {
  const s = 24, cv = document.createElement('canvas'); cv.width = Math.round(L * s); cv.height = Math.round(W * s); const k = cv.getContext('2d')!;
  for (let i = 0; i < 12; i++) { k.fillStyle = i % 2 ? '#3f8f3a' : '#479e41'; k.fillRect(i * cv.width / 12, 0, cv.width / 12 + 1, cv.height); }
  k.strokeStyle = 'rgba(255,255,255,.92)'; k.lineWidth = 3; const X = (x: number) => (x + L / 2) * s, Z = (z: number) => (z + W / 2) * s;
  k.strokeRect(X(-L / 2) + 2, 2, cv.width - 4, cv.height - 4); k.beginPath(); k.moveTo(X(0), 0); k.lineTo(X(0), cv.height); k.stroke();
  k.beginPath(); k.arc(X(0), Z(0), 3 * s, 0, Math.PI * 2); k.stroke(); k.fillStyle = '#fff'; k.beginPath(); k.arc(X(0), Z(0), 4, 0, Math.PI * 2); k.fill();
  for (const sd of [-1, 1]) { k.beginPath(); k.arc(X(sd * L / 2), Z(0), 6 * s, sd < 0 ? -Math.PI / 2 : Math.PI / 2, sd < 0 ? Math.PI / 2 : Math.PI * 1.5); k.stroke(); k.beginPath(); k.arc(X(sd * (L / 2 - 6)), Z(0), 4, 0, Math.PI * 2); k.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function courtTex() {
  const s = 40, cv = document.createElement('canvas'); cv.width = 15 * s; cv.height = 14 * s; const k = cv.getContext('2d')!;
  k.fillStyle = '#2f6db0'; k.fillRect(0, 0, cv.width, cv.height); const X = (x: number) => (x + 7.5) * s, Z = (z: number) => z * s;
  k.fillStyle = '#c4453a'; k.fillRect(X(-2.45), Z(0), 4.9 * s, 5.8 * s);
  k.strokeStyle = '#fff'; k.lineWidth = 4; k.strokeRect(2, 2, cv.width - 4, cv.height - 4); k.strokeRect(X(-2.45), Z(0), 4.9 * s, 5.8 * s);
  k.beginPath(); k.arc(X(0), Z(5.8), 1.8 * s, 0, Math.PI); k.stroke();
  const th = Math.acos(6.6 / 6.75), zc = 1.575 + Math.sin(th) * 6.75;
  for (const sd of [-1, 1]) { k.beginPath(); k.moveTo(X(sd * 6.6), 0); k.lineTo(X(sd * 6.6), Z(zc)); k.stroke(); }
  k.beginPath(); k.arc(X(0), Z(1.575), 6.75 * s, th, Math.PI - th, false); k.stroke();
  k.beginPath(); k.arc(X(0), Z(14), 1.8 * s, Math.PI, 0); k.stroke();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
