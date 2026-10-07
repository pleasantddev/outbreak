// Keyboard, mouse and touch, merged into one per-frame snapshot.
export interface InputFrame {
  mx: number; my: number; lookX: number; lookY: number;
  fire: boolean; aim: boolean; jump: boolean; sprint: boolean; crouch: boolean;
  reload: boolean; interact: boolean; ab1: boolean; ab2: boolean; heal: boolean; awaken: boolean; frag: boolean; flashlight: boolean;
  slot: number; map: boolean; inventory: boolean; pause: boolean; horn: boolean;
}

export class Input {
  keys = new Set<string>();
  private pressed = new Set<string>();
  private lookDX = 0; private lookDY = 0;
  private mouse = [false, false, false];
  private mousePressed = [false, false, false];
  private crouchToggle = false;
  locked = false;
  touch = false;
  // touch state
  joy = { x: 0, y: 0, active: false, id: -1, ox: 0, oy: 0 };
  lookTouch = { id: -1, x: 0, y: 0 };
  tbtn = new Set<string>();
  tpressed = new Set<string>();
  aimToggle = false;
  canvas: HTMLElement;
  enabled = true;
  private handlers: [EventTarget, string, EventListener, any?][] = [];

  constructor(canvas: HTMLElement, touchMode: 'auto' | 'on' | 'off') {
    this.canvas = canvas;
    this.touch = touchMode === 'on' || (touchMode === 'auto' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window));
    const on = (t: EventTarget, ev: string, fn: EventListener, opt?: any) => { t.addEventListener(ev, fn, opt); this.handlers.push([t, ev, fn, opt]); };
    on(window, 'keydown', (e: Event) => {
      const k = (e as KeyboardEvent).code;
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (['Tab', 'Space'].includes(k) && this.enabled) e.preventDefault();
    });
    on(window, 'keyup', (e: Event) => this.keys.delete((e as KeyboardEvent).code));
    on(window, 'blur', () => { this.keys.clear(); this.mouse = [false, false, false]; });
    on(canvas, 'mousedown', (e: Event) => {
      const me = e as MouseEvent;
      if (!this.locked && !this.touch && this.enabled) { canvas.requestPointerLock?.(); }
      this.mouse[me.button] = true; this.mousePressed[me.button] = true;
    });
    on(window, 'mouseup', (e: Event) => { this.mouse[(e as MouseEvent).button] = false; });
    on(window, 'mousemove', (e: Event) => { if (this.locked) { const me = e as MouseEvent; this.lookDX += me.movementX; this.lookDY += me.movementY; } });
    on(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(window, 'wheel', (e: Event) => { if (this.locked) { const d = (e as WheelEvent).deltaY; this.pressed.add(d > 0 ? 'WheelDown' : 'WheelUp'); } }, { passive: true });
    if (this.touch) this.bindTouch(canvas);
  }

  private bindTouch(el: HTMLElement) {
    const opt = { passive: false };
    const start = (e: Event) => {
      const te = e as TouchEvent;
      for (const t of Array.from(te.changedTouches)) {
        const target = t.target as HTMLElement;
        const btn = target.closest?.('[data-tbtn]') as HTMLElement | null;
        if (btn) { const id = btn.dataset.tbtn!; this.tbtn.add(id); this.tpressed.add(id); btn.classList.add('down'); (btn as any)._tid = t.identifier; e.preventDefault(); continue; }
        if (t.clientX < window.innerWidth * 0.42 && this.joy.id < 0) { this.joy = { x: 0, y: 0, active: true, id: t.identifier, ox: t.clientX, oy: t.clientY }; this.showJoy(t.clientX, t.clientY, 0, 0); }
        else if (this.lookTouch.id < 0) this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        e.preventDefault();
      }
    };
    const move = (e: Event) => {
      const te = e as TouchEvent;
      for (const t of Array.from(te.changedTouches)) {
        if (t.identifier === this.joy.id) {
          let dx = (t.clientX - this.joy.ox) / 60, dy = (t.clientY - this.joy.oy) / 60;
          const l = Math.hypot(dx, dy); if (l > 1.25) { dx /= l / 1.25; dy /= l / 1.25; }
          this.joy.x = dx; this.joy.y = dy; this.showJoy(this.joy.ox, this.joy.oy, dx, dy);
        } else if (t.identifier === this.lookTouch.id) {
          this.lookDX += (t.clientX - this.lookTouch.x) * 2.2; this.lookDY += (t.clientY - this.lookTouch.y) * 2.2;
          this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY;
        } else {
          // dragging on the fire button also steers the camera, as in CODM
          const b = document.querySelector(`[data-tbtn].down`) as any;
          if (b && b._tid === t.identifier && (b.dataset.tbtn === 'fire' || b.dataset.tbtn === 'fireL')) {
            if (b._lx !== undefined) { this.lookDX += (t.clientX - b._lx) * 2.2; this.lookDY += (t.clientY - b._ly) * 2.2; }
            b._lx = t.clientX; b._ly = t.clientY;
          }
        }
      }
      e.preventDefault();
    };
    const end = (e: Event) => {
      const te = e as TouchEvent;
      for (const t of Array.from(te.changedTouches)) {
        if (t.identifier === this.joy.id) { this.joy = { x: 0, y: 0, active: false, id: -1, ox: 0, oy: 0 }; this.showJoy(-999, -999, 0, 0); }
        if (t.identifier === this.lookTouch.id) this.lookTouch.id = -1;
        document.querySelectorAll('[data-tbtn].down').forEach((b: any) => { if (b._tid === t.identifier) { b.classList.remove('down'); this.tbtn.delete(b.dataset.tbtn); b._lx = undefined; } });
      }
    };
    const root = el.parentElement ?? document.body;
    const on = (t: EventTarget, ev: string, fn: EventListener) => { t.addEventListener(ev, fn, opt); this.handlers.push([t, ev, fn, opt]); };
    on(root, 'touchstart', start); on(root, 'touchmove', move); on(root, 'touchend', end); on(root, 'touchcancel', end);
  }
  private showJoy(x: number, y: number, dx: number, dy: number) {
    const base = document.getElementById('joy-base'), knob = document.getElementById('joy-knob');
    if (!base || !knob) return;
    base.style.transform = `translate(${x - 60}px, ${y - 60}px)`;
    knob.style.transform = `translate(${x - 26 + dx * 48}px, ${y - 26 + dy * 48}px)`;
  }

  frame(): InputFrame {
    const k = (c: string) => this.keys.has(c), p = (c: string) => this.pressed.has(c) || this.tpressed.has(c);
    const tb = (c: string) => this.tbtn.has(c);
    if (p('KeyC') || p('ControlLeft') || this.tpressed.has('crouch')) this.crouchToggle = !this.crouchToggle;
    if (this.tpressed.has('aim')) this.aimToggle = !this.aimToggle;
    let mx = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0), my = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    if (this.joy.active) { mx = this.joy.x; my = -this.joy.y; }
    const joyMag = Math.hypot(this.joy.x, this.joy.y);
    let slot = -1;
    if (p('Digit1')) slot = 0; if (p('Digit2')) slot = 1; if (p('Digit3')) slot = 2;
    if (p('WheelUp') || p('WheelDown') || this.tpressed.has('swap')) slot = 99;
    for (let i = 4; i <= 6; i++) if (p(`Digit${i}`)) slot = 100 + i;
    const f: InputFrame = {
      mx, my, lookX: this.lookDX, lookY: this.lookDY,
      fire: this.mouse[0] || tb('fire') || tb('fireL'), aim: this.mouse[2] || this.aimToggle,
      jump: k('Space') || tb('jump'), sprint: k('ShiftLeft') || joyMag > 1.05, crouch: this.crouchToggle,
      reload: p('KeyR'), interact: p('KeyE') || p('KeyF'), ab1: p('KeyQ'), ab2: p('KeyX'), heal: p('KeyH'), awaken: p('KeyV'), frag: p('KeyG'),
      flashlight: p('KeyL'), slot, map: p('KeyM'), inventory: p('Tab') || p('KeyI'), pause: p('Escape') || p('KeyP'), horn: k('ShiftLeft') || tb('horn'),
    };
    for (const id of ['reload', 'interact', 'ab1', 'ab2', 'heal', 'awaken', 'frag', 'flashlight', 'map', 'inventory', 'pause'] as const) if (this.tpressed.has(id)) (f as any)[id] = true;
    this.pressed.clear(); this.tpressed.clear(); this.mousePressed = [false, false, false];
    this.lookDX = 0; this.lookDY = 0;
    return f;
  }
  releasePointer() { if (document.pointerLockElement) document.exitPointerLock(); }
  dispose() { for (const [t, ev, fn, opt] of this.handlers) t.removeEventListener(ev, fn, opt); this.releasePointer(); }
}
