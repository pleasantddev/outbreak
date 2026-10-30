// Interaction menu, GTA style: a compact list on the left of the screen for whatever you are facing. W/S or the
// arrows to move, E / Enter / Space to choose, Backspace / Esc to close, number keys as shortcuts, tap on mobile.
// (Kept the old class name so callers did not change.)
export interface PieItem { id: string; label: string; hint?: string; cost?: number; disabled?: string }

const css = `
#pie{position:fixed;left:max(22px,env(safe-area-inset-left));top:24%;z-index:9;width:min(330px,80vw);display:none;font-family:Inter,sans-serif;color:#f3f5f8;pointer-events:auto;user-select:none}
#pie.on{display:block;animation:piein .14s ease-out} @keyframes piein{from{opacity:0;transform:translateX(-10px)}}
#pie .hd{padding:12px 14px 10px;background:linear-gradient(135deg,rgba(139,92,246,.95),rgba(76,29,149,.95));border-radius:12px 12px 0 0}
#pie .hd b{display:block;font:800 18px Rajdhani,Inter,sans-serif;letter-spacing:.6px;text-transform:uppercase;line-height:1.1} #pie .hd span{display:block;font-size:11.5px;color:rgba(255,255,255,.75);margin-top:2px}
#pie .ls{background:rgba(8,10,16,.84);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:0 0 12px 12px;padding:4px 0;max-height:52vh;overflow:auto}
#pie .it{display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer}
#pie .it .k{width:16px;font:700 11px Rajdhani,Inter;color:#6b7280} #pie .it b{flex:1;font-size:13.5px;font-weight:600} #pie .it i{font-style:normal;font-size:11px;color:#9ba3b4}
#pie .it em{font-style:normal;font-size:12px;color:#ffc53d;font-weight:700}
#pie .it.sel{background:#f3f5f8;color:#0b0d14} #pie .it.sel i{color:#4b5563} #pie .it.sel .k{color:#4b5563} #pie .it.sel em{color:#92400e}
#pie .it.off{opacity:.42;cursor:default} #pie .it .why{font-size:11px;color:#ff8a94}
#pie .ft{display:flex;gap:12px;padding:7px 14px 2px;font-size:10.5px;color:#9ba3b4} #pie .ft kbd{font:700 10px Rajdhani,Inter;padding:1px 5px;border-radius:4px;background:rgba(255,255,255,.12);color:#e5e7eb;margin-right:3px}
`;

export class Pie {
  el: HTMLElement; private items: PieItem[] = []; private sel = 0; private cb: ((id: string) => void) | null = null; open = false; openedAt = 0;
  constructor() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this.el = document.createElement('div'); this.el.id = 'pie'; document.body.appendChild(this.el);
  }
  show(title: string, sub: string, items: PieItem[], _at: { x: number; y: number }, cb: (id: string) => void) {
    this.items = items; this.cb = cb; this.sel = items.findIndex((i) => !i.disabled); if (this.sel < 0) this.sel = 0;
    this.el.innerHTML = `<div class="hd"><b>${title}</b><span>${sub}</span></div><div class="ls">` +
      items.map((it, i) => `<div class="it${it.disabled ? ' off' : ''}${i === this.sel ? ' sel' : ''}" data-i="${i}"><span class="k">${i + 1}</span><b>${it.label}${it.disabled ? `<span class="why"> · ${it.disabled}</span>` : ''}</b>${it.hint ? `<i>${it.hint}</i>` : ''}${it.cost ? `<em>₦${it.cost.toLocaleString()}</em>` : ''}</div>`).join('') +
      `<div class="ft"><span><kbd>E</kbd>Select</span><span><kbd>W/S</kbd>Move</span><span><kbd>Esc</kbd>Back</span></div></div>`;
    this.el.querySelectorAll('.it').forEach((d) => {
      d.addEventListener('pointerup', (e) => { e.stopPropagation(); this.pick(+(d as HTMLElement).dataset.i!); });
      d.addEventListener('pointerenter', () => { const i = +(d as HTMLElement).dataset.i!; if (!this.items[i]?.disabled) { this.sel = i; this.mark(); } });
    });
    this.el.classList.remove('on'); void this.el.offsetWidth; this.el.classList.add('on'); this.open = true; this.openedAt = performance.now();
  }
  private mark() { this.el.querySelectorAll('.it').forEach((x, i) => x.classList.toggle('sel', i === this.sel)); }
  close() { this.el.classList.remove('on'); this.open = false; this.cb = null; }
  pick(i: number) { const it = this.items[i]; if (!it || it.disabled) return; const cb = this.cb; this.close(); cb?.(it.id); }
  move(d: number) { if (!this.items.length) return; for (let k = 0; k < this.items.length; k++) { this.sel = (this.sel + d + this.items.length) % this.items.length; if (!this.items[this.sel].disabled) break; } this.mark(); }
  confirm() { if (performance.now() - this.openedAt < 180) return; this.pick(this.sel); }
}
