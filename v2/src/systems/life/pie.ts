// The interaction pie: tap/click/E on anything and its actions fan out around it. Keys 1-8, mouse, touch,
// gamepad stick + A. Esc / B / moving closes it.
export interface PieItem { id: string; label: string; hint?: string; cost?: number; disabled?: string }

const css = `
#pie{position:fixed;inset:0;z-index:9;pointer-events:none;display:none}
#pie.on{display:block}
#pie .dim{position:absolute;inset:0;background:radial-gradient(circle at var(--x) var(--y),rgba(5,7,12,.0) 0,rgba(5,7,12,.45) 260px);pointer-events:auto}
#pie .hub{position:absolute;transform:translate(-50%,-50%);width:120px;height:120px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  background:radial-gradient(circle,rgba(20,24,38,.92),rgba(12,14,24,.8));border:1px solid rgba(255,255,255,.14);box-shadow:0 10px 40px rgba(0,0,0,.45);font-family:Inter,sans-serif;color:#f3f5f8;pointer-events:none}
#pie .hub b{font-size:13.5px;font-weight:800;line-height:1.15;padding:0 10px} #pie .hub span{font-size:10.5px;color:#9ba3b4;margin-top:3px}
#pie .it{position:absolute;transform:translate(-50%,-50%) scale(.6);opacity:0;transition:transform .22s cubic-bezier(.2,1.4,.4,1),opacity .18s;min-width:132px;max-width:180px;padding:9px 13px 9px 34px;border-radius:16px;
  background:rgba(14,16,26,.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.12);color:#f3f5f8;font-family:Inter,sans-serif;pointer-events:auto;cursor:pointer;text-align:left;box-shadow:0 8px 22px rgba(0,0,0,.35)}
#pie.on .it{transform:translate(-50%,-50%) scale(1);opacity:1}
#pie .it b{display:block;font-size:13px;font-weight:700} #pie .it i{font-style:normal;font-size:11px;color:#2de0c8;font-weight:600} #pie .it em{font-style:normal;font-size:11px;color:#ffc53d;margin-left:6px;font-weight:700}
#pie .it .k{position:absolute;left:9px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:6px;background:rgba(255,255,255,.1);font:700 11px Rajdhani,Inter,sans-serif;display:flex;align-items:center;justify-content:center;color:#cfd5e1}
#pie .it.sel,#pie .it:hover{background:linear-gradient(180deg,rgba(139,92,246,.9),rgba(109,62,240,.9));border-color:rgba(255,255,255,.35)}
#pie .it.off{opacity:.45;cursor:default} #pie .it.off:hover{background:rgba(14,16,26,.82)} #pie .it .why{display:block;font-size:10.5px;color:#ff8a94}
`;

export class Pie {
  el: HTMLElement; private items: PieItem[] = []; private sel = 0; private cb: ((id: string) => void) | null = null; open = false;
  constructor() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this.el = document.createElement('div'); this.el.id = 'pie'; document.body.appendChild(this.el);
  }
  show(title: string, sub: string, items: PieItem[], at: { x: number; y: number }, cb: (id: string) => void) {
    this.items = items; this.cb = cb; this.sel = items.findIndex((i) => !i.disabled); if (this.sel < 0) this.sel = 0;
    const W = innerWidth, H = innerHeight; const x = Math.max(170, Math.min(W - 170, at.x)), y = Math.max(150, Math.min(H - 150, at.y));
    const n = items.length; const R = Math.min(150, 96 + n * 9);
    this.el.innerHTML = `<div class="dim" style="--x:${x}px;--y:${y}px"></div><div class="hub" style="left:${x}px;top:${y}px"><b>${title}</b><span>${sub}</span></div>` +
      items.map((it, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2; const px = x + Math.cos(a) * R * 1.35, py = y + Math.sin(a) * R;
        return `<div class="it${it.disabled ? ' off' : ''}${i === this.sel ? ' sel' : ''}" data-i="${i}" style="left:${px}px;top:${py}px;transition-delay:${i * 22}ms"><span class="k">${i + 1}</span><b>${it.label}</b>${it.hint ? `<i>${it.hint}</i>` : ''}${it.cost ? `<em>₦${it.cost.toLocaleString()}</em>` : ''}${it.disabled ? `<span class="why">${it.disabled}</span>` : ''}</div>`;
      }).join('');
    this.el.querySelectorAll('.it').forEach((d) => d.addEventListener('pointerup', (e) => { e.stopPropagation(); this.pick(+(d as HTMLElement).dataset.i!); }));
    this.el.querySelector('.dim')!.addEventListener('pointerup', () => this.close());
    this.el.classList.remove('on'); void this.el.offsetWidth; this.el.classList.add('on'); this.open = true;
  }
  close() { this.el.classList.remove('on'); this.open = false; this.cb = null; setTimeout(() => { if (!this.open) this.el.innerHTML = ''; }, 200); }
  pick(i: number) { const it = this.items[i]; if (!it || it.disabled) return; const cb = this.cb; this.close(); cb?.(it.id); }
  move(d: number) { if (!this.items.length) return; for (let k = 0; k < this.items.length; k++) { this.sel = (this.sel + d + this.items.length) % this.items.length; if (!this.items[this.sel].disabled) break; } this.el.querySelectorAll('.it').forEach((x, i) => x.classList.toggle('sel', i === this.sel)); }
  confirm() { this.pick(this.sel); }
}
