// Needs as small cores under the minimap (Red Dead style), the running-action strip, the needs detail sheet,
// a black fade for doors, and the sleep overlay.
import { NEEDS, NEED_INFO, moodLabel, moodColor, type NeedsState } from './needs';

const css = `
#ncores{display:flex;align-items:center;gap:5px;margin-top:7px;pointer-events:auto;cursor:pointer;user-select:none}
#ncores .mood{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 10px Rajdhani,Inter,sans-serif;color:#0b0d14;transition:background .6s;box-shadow:0 2px 6px rgba(0,0,0,.4)}
#ncores .nd{position:relative;width:22px;height:22px;opacity:.62;transition:opacity .3s,transform .3s}
#ncores .nd.mid{opacity:.85} #ncores .nd.low{opacity:1;animation:npulse 1s ease-in-out infinite}
#ncores .nd svg.ic{position:absolute;inset:5px;width:12px;height:12px;fill:none;stroke:#e9edf5;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}
#ncores .nd svg.ring{position:absolute;inset:0;transform:rotate(-90deg)}
@keyframes npulse{50%{transform:scale(1.18)}}
#nchip{position:fixed;left:50%;bottom:calc(max(16px,env(safe-area-inset-bottom)) + 18px);transform:translateX(-50%);z-index:6;display:none;align-items:center;gap:10px;padding:7px 8px 9px 14px;border-radius:12px;
  background:rgba(8,10,16,.72);font-family:Inter,sans-serif;color:#f3f5f8;pointer-events:auto;min-width:220px}
#nchip.on{display:flex} #nchip b{font-size:13px;font-weight:600;flex:1} #nchip .bar{position:absolute;left:12px;right:44px;bottom:5px;height:3px;border-radius:2px;background:rgba(255,255,255,.1);overflow:hidden}
#nchip .bar i{display:block;height:100%;background:#f3f5f8;width:0} #nchip em{font-style:normal;font-size:11px;color:#9ba3b4;margin-right:4px}
#nchip button{width:26px;height:26px;border-radius:8px;border:none;background:rgba(255,255,255,.1);color:#fff;font:700 13px Inter;cursor:pointer}
#nsheet{position:fixed;left:max(18px,env(safe-area-inset-left));bottom:calc(max(16px,env(safe-area-inset-bottom)) + 250px);opacity:0;pointer-events:none;transform:translateY(8px);transition:.2s;z-index:7;width:min(300px,86vw);padding:13px 15px;border-radius:16px;
  background:rgba(8,10,16,.86);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(14px);font-family:Inter,sans-serif;color:#f3f5f8}
#nsheet.on{opacity:1;transform:none;pointer-events:auto}
#nsheet h4{margin:0 0 9px;font-size:14px;font-weight:800;display:flex;justify-content:space-between} #nsheet h4 span{font-size:12px;font-weight:700}
#nsheet .r{display:grid;grid-template-columns:18px 70px 1fr 26px;gap:8px;align-items:center;font-size:12px;margin:5px 0;color:#cfd5e1}
#nsheet .r svg{width:14px;height:14px;fill:none;stroke:#e9edf5;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#nsheet .r .b{height:5px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden} #nsheet .r .b i{display:block;height:100%;border-radius:3px}
#nsheet .ml{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px} #nsheet .ml span{font-size:11px;font-weight:600;padding:4px 9px;border-radius:999px;background:rgba(255,255,255,.07)}
#nsheet .ml span.p{color:#9ff0c2} #nsheet .ml span.n{color:#ffb0b8}
#nfade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:8;transition:opacity .25s}
#nsleep{position:fixed;inset:0;z-index:5;pointer-events:none;opacity:0;transition:opacity .8s;background:radial-gradient(ellipse at center,rgba(10,12,30,.0) 30%,rgba(6,8,22,.75) 100%);display:flex;align-items:flex-start;justify-content:center}
#nsleep.on{opacity:1} #nsleep b{margin-top:16vh;font:600 15px Inter;letter-spacing:3px;color:#cfd8ff;opacity:.85}
@media (max-width:760px),(max-height:520px){#ncores{gap:3px}#ncores .nd{width:18px;height:18px}#ncores .nd svg.ic{inset:4px;width:10px;height:10px}#ncores .mood{width:20px;height:20px}#nsheet{bottom:auto;top:20%}}
`;
const icon = (d: string, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const col = (v: number) => (v > 60 ? '#49e08a' : v > 35 ? '#facc15' : v > 18 ? '#fb923c' : '#ff4d5e');

export class LifeUi {
  dock: HTMLElement; chip: HTMLElement; sheet: HTMLElement; fade: HTMLElement; sleep: HTMLElement;
  onCancel?: () => void;
  constructor() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    const mk = (id: string, html = '') => { const d = document.createElement('div'); d.id = id; d.innerHTML = html; document.body.appendChild(d); return d; };
    this.dock = document.createElement('div'); this.dock.id = 'ncores';
    this.dock.innerHTML = `<div class="mood" id="nmood">0</div>` + NEEDS.map((n) => `<div class="nd" id="nd-${n}" title="${NEED_INFO[n].label}"><svg class="ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="rgba(0,0,0,.45)" stroke="rgba(255,255,255,.14)" stroke-width="2.4"/><circle id="nr-${n}" cx="12" cy="12" r="10.5" fill="none" stroke="#e9edf5" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="66 66"/></svg>${icon(NEED_INFO[n].icon)}</div>`).join('');
    (document.getElementById('mm') ?? document.body).appendChild(this.dock);
    this.chip = mk('nchip', `<b id="nchip-t"></b><em>move to stop</em><button id="nchip-x" aria-label="Stop">✕</button><div class="bar"><i id="nchip-p"></i></div>`);
    this.sheet = mk('nsheet');
    this.fade = mk('nfade'); this.sleep = mk('nsleep', '<b>SLEEPING</b>');
    this.dock.style.display = 'none';
    this.dock.addEventListener('pointerup', (e) => { e.stopPropagation(); this.sheet.classList.toggle('on'); });
    (this.chip.querySelector('#nchip-x') as HTMLElement).addEventListener('pointerup', (e) => { e.stopPropagation(); this.onCancel?.(); });
  }
  show(on: boolean) { this.dock.style.display = on ? 'flex' : 'none'; if (!on) { this.sheet.classList.remove('on'); this.chip.classList.remove('on'); } }
  update(s: NeedsState, mood: number) {
    const m = document.getElementById('nmood')!; m.style.background = moodColor(mood); m.textContent = (mood > 0 ? '+' : '') + Math.round(mood); m.title = moodLabel(mood);
    for (const n of NEEDS) {
      const v = s.v[n]; const r = document.getElementById('nr-' + n)!; r.setAttribute('stroke-dasharray', `${(v / 100) * 66} 66`); r.setAttribute('stroke', col(v));
      const nd = document.getElementById('nd-' + n)!; nd.classList.toggle('low', v < 18); nd.classList.toggle('mid', v >= 18 && v < 40);
    }
    if (this.sheet.classList.contains('on')) {
      this.sheet.innerHTML = `<h4>How you dey <span style="color:${moodColor(mood)}">${moodLabel(mood)}</span></h4>` +
        NEEDS.map((n) => `<div class="r">${icon(NEED_INFO[n].icon, '')}<span>${NEED_INFO[n].label}</span><div class="b"><i style="width:${s.v[n]}%;background:${col(s.v[n])}"></i></div><span>${Math.round(s.v[n])}</span></div>`).join('') +
        `<div class="ml">${s.moodlets.map((x) => `<span class="${x.mood >= 0 ? 'p' : 'n'}">${x.label} ${x.mood > 0 ? '+' : ''}${x.mood}</span>`).join('') || '<span>Nothing special today</span>'}</div>`;
    }
  }
  action(label: string | null, p = 0) {
    this.chip.classList.toggle('on', !!label); if (!label) return;
    document.getElementById('nchip-t')!.textContent = label; (document.getElementById('nchip-p') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
  }
  async black(fn: () => void | Promise<void>) { this.fade.style.opacity = '1'; await new Promise((r) => setTimeout(r, 300)); await fn(); await new Promise((r) => setTimeout(r, 120)); this.fade.style.opacity = '0'; }
  sleeping(on: boolean) { this.sleep.classList.toggle('on', on); }
}
