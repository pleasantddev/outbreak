// Keyboard, gamepad and touch, merged into one CarInput. Touch players get big thumb zones and auto-accelerate by
// default; every binding can be changed in Settings.
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

export interface InputPrefs { keys: Record<Action, string[]>; autoAccel: boolean; steerAssist: number; touchLayout: 'buttons' | 'tilt'; vibration: boolean; invertAirPitch: boolean }
export const defaultInputPrefs = (touch: boolean): InputPrefs => ({ keys: structuredClone(DEFAULT_KEYS), autoAccel: touch, steerAssist: touch ? 0.35 : 0, touchLayout: 'buttons', vibration: true, invertAirPitch: false });

export class Input {
  private down = new Set<string>();
  private pressedOnce = new Set<Action>();
  private steer = 0;
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
    const want = kr - kl;
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
      if (t.steer !== 0) inp.steer = t.steer;
      inp.throttle = Math.max(inp.throttle, t.throttle);
      inp.brake = Math.max(inp.brake, t.brake);
      inp.drift = inp.drift || t.drift;
      inp.nitro = inp.nitro || t.nitro;
      inp.item = inp.item || t.item;
    }
    if (this.prefs.autoAccel && inp.brake < 0.1) inp.throttle = Math.max(inp.throttle, 1);
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

/** On-screen thumb controls: steer on the left, pedals and actions on the right. */
export class TouchControls {
  el: HTMLDivElement;
  active = false;
  state = { steer: 0, throttle: 0, brake: 0, drift: false, nitro: false, item: false };
  private steerTouch: number | null = null;
  private steerX0 = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.el.innerHTML = `
      <div class="t-steer" data-k="steer"><div class="t-knob"></div><span>STEER</span></div>
      <div class="t-right">
        <button class="t-btn t-item" data-k="item" aria-label="Use item">ITEM</button>
        <button class="t-btn t-nitro" data-k="nitro" aria-label="Fuel boost">FUEL</button>
        <button class="t-btn t-drift" data-k="drift" aria-label="Drift">DRIFT</button>
        <button class="t-btn t-brake" data-k="brake" aria-label="Brake">BRAKE</button>
        <button class="t-btn t-gas" data-k="throttle" aria-label="Accelerate">GAS</button>
      </div>`;
    parent.appendChild(this.el);
    const steerEl = this.el.querySelector('.t-steer') as HTMLElement, knob = this.el.querySelector('.t-knob') as HTMLElement;
    steerEl.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; this.steerTouch = t.identifier; this.steerX0 = t.clientX; this.active = true; e.preventDefault(); }, { passive: false });
    steerEl.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === this.steerTouch) {
        const dx = clamp((t.clientX - this.steerX0) / 70, -1, 1);
        this.state.steer = dx; knob.style.transform = `translateX(${dx * 46}px)`;
      }
      e.preventDefault();
    }, { passive: false });
    const endSteer = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) if (t.identifier === this.steerTouch) { this.steerTouch = null; this.state.steer = 0; knob.style.transform = ''; } };
    steerEl.addEventListener('touchend', endSteer); steerEl.addEventListener('touchcancel', endSteer);
    this.el.querySelectorAll<HTMLElement>('.t-btn').forEach((b) => {
      const k = b.dataset.k as 'throttle' | 'brake' | 'drift' | 'nitro' | 'item';
      const set = (on: boolean) => { if (k === 'throttle' || k === 'brake') this.state[k] = on ? 1 : 0; else this.state[k] = on; b.classList.toggle('on', on); };
      b.addEventListener('touchstart', (e) => { set(true); this.active = true; e.preventDefault(); }, { passive: false });
      b.addEventListener('touchend', (e) => { set(false); e.preventDefault(); });
      b.addEventListener('touchcancel', () => set(false));
    });
  }
  show(on: boolean) { this.el.style.display = on ? '' : 'none'; }
}
