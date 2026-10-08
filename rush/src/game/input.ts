// Keyboard, gamepad and touch, merged into one CarInput. Nobody drives for the player: the car only goes when they
// press the gas. Every binding can be changed in Settings.
import { idleInput, type CarInput } from '../shared/car';
import { clamp } from '../shared/math';

export type Action = 'throttle' | 'brake' | 'left' | 'right' | 'drift' | 'nitro' | 'item' | 'look' | 'respawn' | 'pause' | 'camera';
export const DEFAULT_KEYS: Record<Action, string[]> = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  drift: ['Space'], nitro: ['ShiftLeft', 'ShiftRight'], item: ['KeyE', 'KeyX', 'Enter'], look: ['KeyC'], respawn: ['KeyR'], pause: ['Escape', 'KeyP'], camera: ['KeyV'],
};
export const ACTION_LABEL: Record<Action, string> = {
  throttle: 'Accelerate', brake: 'Brake / reverse', left: 'Steer left', right: 'Steer right', drift: 'Drift (Gbedu)', nitro: 'Fuel boost', item: 'Use item', look: 'Look back', respawn: 'Call the tow truck', pause: 'Pause', camera: 'Change camera',
};

/** controlsV: bumped when the defaults change in a way old saves should pick up (2: no auto accelerate, no assist,
 *  arrow pads). autoAccel stays only so old saves still parse; nothing reads it. */
export interface InputPrefs { keys: Record<Action, string[]>; autoAccel: boolean; steerAssist: number; touchLayout: 'arrows' | 'stick'; vibration: boolean; invertAirPitch: boolean; controlsV?: number }
export const defaultInputPrefs = (_touch: boolean): InputPrefs => ({ keys: structuredClone(DEFAULT_KEYS), autoAccel: false, steerAssist: 0, touchLayout: 'arrows', vibration: true, invertAirPitch: false, controlsV: 2 });

export class Input {
  private down = new Set<string>();
  private pressedOnce = new Set<Action>();
  private steer = 0;
  private lockT = 0;
  touch: TouchControls | null = null;
  enabled = true;
  lastDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';

  constructor(public prefs: InputPrefs) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.down.has(e.code)) for (const a of this.actionsFor(e.code)) this.pressedOnce.add(a);
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && this.enabled) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  private actionsFor(code: string) { return (Object.keys(this.prefs.keys) as Action[]).filter((a) => this.prefs.keys[a].includes(code)); }
  private key(a: Action) { return this.prefs.keys[a].some((k) => this.down.has(k)); }

  /** True once per press, for menus and one-shot actions. */
  pressed(a: Action) { const p = this.pressedOnce.has(a); this.pressedOnce.delete(a); return p; }
  clearPressed() { this.pressedOnce.clear(); }

  read(dt: number, airborne: boolean, assist: { curve: number } | null = null): CarInput {
    const inp = idleInput();
    if (!this.enabled) return inp;
    // keyboard: steering ramps so taps are gentle and holds are full lock
    const kl = this.key('left') ? 1 : 0, kr = this.key('right') ? 1 : 0;
    const touchWant = this.touch?.active ? this.touch.state.steerWant : 0;
    const want = clamp(kr - kl + touchWant, -1, 1);
    const rate = want === 0 ? 7 : Math.sign(want) !== Math.sign(this.steer) ? 9 : 4.5;
    this.steer += clamp(want - this.steer, -rate * dt, rate * dt);
    inp.steer = this.steer;
    inp.throttle = this.key('throttle') ? 1 : 0;
    inp.brake = this.key('brake') ? 1 : 0;
    inp.drift = this.key('drift');
    inp.nitro = this.key('nitro');
    // a tap shorter than one frame still counts on slow devices
    inp.item = this.key('item') || this.pressedOnce.has('item');
    this.pressedOnce.delete('item');
    inp.look = this.key('look');
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] ?? 0;
      const dz = Math.abs(ax) < 0.12 ? 0 : (ax - Math.sign(ax) * 0.12) / 0.88;
      const rt = gp.buttons[7]?.value ?? 0, lt = gp.buttons[6]?.value ?? 0;
      const used = Math.abs(dz) > 0 || rt > 0.05 || lt > 0.05 || gp.buttons.some((b) => b.pressed);
      if (!used) continue;
      this.lastDevice = 'gamepad';
      if (Math.abs(dz) > Math.abs(inp.steer)) inp.steer = Math.sign(dz) * Math.pow(Math.abs(dz), 1.4);
      inp.throttle = Math.max(inp.throttle, rt);
      inp.brake = Math.max(inp.brake, lt);
      inp.drift = inp.drift || !!gp.buttons[5]?.pressed || !!gp.buttons[0]?.pressed;
      inp.nitro = inp.nitro || !!gp.buttons[1]?.pressed || !!gp.buttons[2]?.pressed;
      inp.item = inp.item || !!gp.buttons[4]?.pressed || !!gp.buttons[3]?.pressed;
      inp.look = inp.look || !!gp.buttons[11]?.pressed;
      const ay = gp.axes[1] ?? 0;
      if (airborne && Math.abs(ay) > 0.3) inp.airPitch = -ay;
      if (gp.buttons[9]?.pressed) this.pressedOnce.add('pause');
    }
    // touch
    if (this.touch?.active) {
      this.lastDevice = 'touch';
      const t = this.touch.state;
      if (t.steer !== 0 && Math.abs(t.steer) > Math.abs(inp.steer)) inp.steer = t.steer;
      inp.throttle = Math.max(inp.throttle, t.throttle);
      inp.brake = Math.max(inp.brake, t.brake);
      // thumbs are busy: holding a full turn at speed for a moment starts a drift, the way the arrows are meant
      // to be used through a hairpin. The DRIFT pad still works for anyone who wants it on demand.
      this.lockT = Math.abs(inp.steer) > 0.85 && inp.throttle > 0 ? this.lockT + dt : 0;
      inp.drift = inp.drift || t.drift || this.lockT > 0.5;
      inp.nitro = inp.nitro || t.nitro;
      inp.item = inp.item || t.item;
    }
    // steering assist nudges toward the road ahead for players who ask for it
    if (assist && this.prefs.steerAssist > 0 && Math.abs(inp.steer) < 0.5) inp.steer = clamp(inp.steer + assist.curve * this.prefs.steerAssist, -1, 1);
    if (airborne) {
      // in the air, forward and back flip, left and right spin
      const up = this.key('throttle') ? 1 : 0, dn = this.key('brake') ? 1 : 0;
      if (up || dn) inp.airPitch = (up - dn) * (this.prefs.invertAirPitch ? -1 : 1);
    }
    return inp;
  }

  rumble(strength: number, ms: number) {
    if (!this.prefs.vibration) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      const act = (gp as Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => void } })?.vibrationActuator;
      act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 });
    }
    if (this.lastDevice === 'touch' && navigator.vibrate) navigator.vibrate(Math.min(60, ms));
  }
}

/** On-screen thumb controls. Left thumb steers: two arrow pads (the default) or a stick that appears wherever the
 *  thumb lands. Right thumb works the pedals and, above them, drift, Fuel and the item. Pointer events with capture,
 *  so a thumb that slides off a pad never leaves it stuck down, and sliding between gas and brake just works. */
type Pad = 'left' | 'right' | 'throttle' | 'brake' | 'drift' | 'nitro' | 'item';
const ICON: Record<Pad, string> = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 4 8 8-8 8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  throttle: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 21l6-6 6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".5"/></svg>',
  brake: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  drift: '<svg viewBox="0 0 24 24"><path d="M5 17c3-8 9-8 14-10M15 4l4 3-3 4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  nitro: '<svg viewBox="0 0 24 24"><path d="M13 2 5 14h6l-1 8 8-12h-6z" fill="currentColor"/></svg>',
  item: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M9 8V5h6v3" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>',
};
const LABEL: Record<Pad, string> = { left: 'Steer left', right: 'Steer right', throttle: 'Gas', brake: 'Brake', drift: 'Drift', nitro: 'Fuel', item: 'Item' };

export class TouchControls {
  el: HTMLDivElement;
  active = false;
  /** steer is analogue from the stick; steerWant is -1, 0 or 1 from the arrows and is eased like a key */
  state = { steer: 0, steerWant: 0, throttle: 0, brake: 0, drift: false, nitro: false, item: false };
  private held = new Map<number, Pad>();
  private stick: { id: number; x0: number } | null = null;
  private layout: 'arrows' | 'stick' = 'arrows';

  constructor(parent: HTMLElement, layout: 'arrows' | 'stick' = 'arrows') {
    this.el = document.createElement('div');
    this.el.className = 'touch';
    const pad = (k: Pad, cls = '') => `<div class="t-pad k-${k} ${cls}" data-k="${k}" role="button" aria-label="${LABEL[k]}">${ICON[k]}${k === 'left' || k === 'right' ? '' : `<span>${LABEL[k]}</span>`}</div>`;
    this.el.innerHTML = `
      <div class="t-arrows">${pad('left')}${pad('right')}</div>
      <div class="t-stickzone"><div class="t-stick"><div class="t-knob"></div></div></div>
      <div class="t-acts">${pad('item', 'small')}${pad('drift', 'small')}${pad('nitro', 'small')}</div>
      <div class="t-pedals">${pad('brake')}${pad('throttle')}</div>`;
    parent.appendChild(this.el);
    this.setLayout(layout);
    // one handler for every pad: a pointer belongs to whichever pad is under it right now
    const padAt = (x: number, y: number): Pad | null => {
      const t = document.elementFromPoint(x, y)?.closest('.t-pad') as HTMLElement | null;
      return t && this.el.contains(t) ? (t.dataset.k as Pad) : null;
    };
    const refresh = () => {
      const on = new Set(this.held.values());
      this.state.throttle = on.has('throttle') ? 1 : 0;
      this.state.brake = on.has('brake') ? 1 : 0;
      this.state.drift = on.has('drift'); this.state.nitro = on.has('nitro'); this.state.item = on.has('item');
      this.state.steerWant = (on.has('right') ? 1 : 0) - (on.has('left') ? 1 : 0);
      this.el.querySelectorAll<HTMLElement>('.t-pad').forEach((p) => p.classList.toggle('on', on.has(p.dataset.k as Pad)));
    };
    const zone = this.el.querySelector('.t-stickzone') as HTMLElement, stickEl = this.el.querySelector('.t-stick') as HTMLElement, knob = this.el.querySelector('.t-knob') as HTMLElement;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.active = true;
      const target = e.target as HTMLElement;
      if (this.layout === 'stick' && zone.contains(target) && !this.stick) {
        this.stick = { id: e.pointerId, x0: e.clientX };
        stickEl.style.left = `${e.clientX}px`; stickEl.style.top = `${e.clientY}px`; stickEl.classList.add('on');
      } else {
        const k = padAt(e.clientX, e.clientY);
        if (!k) return;
        this.held.set(e.pointerId, k);
        refresh();
      }
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (this.stick && e.pointerId === this.stick.id) {
        const dx = clamp((e.clientX - this.stick.x0) / 56, -1, 1);
        this.state.steer = dx; knob.style.transform = `translateX(${dx * 34}px)`;
        e.preventDefault(); return;
      }
      if (!this.held.has(e.pointerId)) return;
      const k = padAt(e.clientX, e.clientY);
      if (k && k !== this.held.get(e.pointerId)) { this.held.set(e.pointerId, k); refresh(); }
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (this.stick && e.pointerId === this.stick.id) { this.stick = null; this.state.steer = 0; knob.style.transform = ''; stickEl.classList.remove('on'); }
      if (this.held.delete(e.pointerId)) refresh();
    };
    this.el.addEventListener('pointerdown', down, { passive: false });
    this.el.addEventListener('pointermove', move, { passive: false });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.el.addEventListener(ev, up);
    // a long press must never open the text menu or select anything
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setLayout(layout: 'arrows' | 'stick') {
    this.layout = layout;
    this.el.classList.toggle('stick-mode', layout === 'stick');
  }

  /** Let go of everything: on pause, on a new race, when the page is hidden. */
  release() {
    this.held.clear(); this.stick = null;
    Object.assign(this.state, { steer: 0, steerWant: 0, throttle: 0, brake: 0, drift: false, nitro: false, item: false });
    this.el.querySelectorAll('.on').forEach((n) => n.classList.remove('on'));
  }

  show(on: boolean) { this.el.style.display = on ? '' : 'none'; if (!on) this.release(); }
}
