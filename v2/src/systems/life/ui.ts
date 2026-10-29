// Needs dock (bottom centre), the running-action chip with its progress and cancel, the needs detail sheet,
// a black fade for doors, and the sleep overlay.
import { NEEDS, NEED_INFO, moodLabel, moodColor, type NeedsState } from './needs';

const css = `
#ndock{position:fixed;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:9px;padding:7px 12px 7px 7px;border-radius:999px;
  background:rgba(12,14,22,.56);border:1px solid rgba(255,255,255,.09);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);box-shadow:0 8px 24px rgba(0,0,0,.28);
  font-family:Inter,sans-serif;color:#f3f5f8;pointer-events:auto;cursor:pointer;user-select:none}
#ndock .mood{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 11px Rajdhani,Inter,sans-serif;color:#0b0d14;transition:background .6s}
#ndock .ml{font-size:12px;font-weight:700;min-width:64px}
#ndock .nd{position:relative;width:24px;height:24px}
#ndock .nd svg.ic{position:absolute;inset:5px;width:14px;height:14px;fill:none;stroke:#e9edf5;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
#ndock .nd svg.ring{position:absolute;inset:0;transform:rotate(-90deg)}
#ndock .nd.low{animation:npulse 1s ease-in-out infinite} @keyframes npulse{50%{transform:scale(1.15)}}
#nchip{position:fixed;left:50%;bottom:calc(max(14px,env(safe-area-inset-bottom)) + 56px);transform:translateX(-50%);z-index:6;display:none;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-radius:14px;
  background:rgba(12,14,22,.7);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(12px);font-family:Inter,sans-serif;color:#f3f5f8;pointer-events:auto;min-width:220px}
#nchip.on{display:flex} #nchip b{font-size:13px;flex:1} #nchip .bar{position:absolute;left:10px;right:44px;bottom:5px;height:3px;border-radius:2px;background:rgba(255,255,255,.1);overflow:hidden}
#nchip .bar i{display:block;height:100%;background:linear-gradient(90deg,#2de0c8,#8b5cf6);width:0}
#nchip button{width:28px;height:28px;border-radius:9px;border:none;background:rgba(255,255,255,.1);color:#fff;font:700 14px Inter;cursor:pointer}
#nsheet{position:fixed;left:50%;bottom:calc(max(14px,env(safe-area-inset-bottom)) + 58px);transform:translate(-50%,10px);opacity:0;pointer-events:none;transition:.2s;z-index:7;width:min(360px,92vw);padding:14px 16px;border-radius:20px;
  background:rgba(12,14,22,.86);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(16px);font-family:Inter,sans-serif;color:#f3f5f8}
#nsheet.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
#nsheet h4{margin:0 0 10px;font-size:15px;font-weight:800;display:flex;justify-content:space-between} #nsheet h4 span{font-size:12px;font-weight:700}
#nsheet .r{display:grid;grid-template-columns:20px 74px 1fr 30px;gap:8px;align-items:center;font-size:12px;margin:5px 0;color:#cfd5e1}
#nsheet .r svg{width:15px;height:15px;fill:none;stroke:#e9edf5;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#nsheet .r .b{height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden} #nsheet .r .b i{display:block;height:100%;border-radius:3px}
#nsheet .ml{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px} #nsheet .ml span{font-size:11px;font-weight:600;padding:4px 9px;border-radius:999px;background:rgba(255,255,255,.07)}
#nsheet .ml span.p{color:#9ff0c2} #nsheet .ml span.n{color:#ffb0b8}
#nfade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:8;transition:opacity .28s}
#nsleep{position:fixed;inset:0;z-index:5;pointer-events:none;opacity:0;transition:opacity .8s;background:radial-gradient(ellipse at center,rgba(10,12,30,.0) 30%,rgba(6,8,22,.75) 100%);display:flex;align-items:flex-start;justify-content:center}
#nsleep.on{opacity:1} #nsleep b{margin-top:16vh;font:600 15px Inter;letter-spacing:3px;color:#cfd8ff;opacity:.85}
@media (max-width:760px),(max-height:520px){#ndock{gap:5px;padding:5px 8px 5px 5px}#ndock .ml{display:none}#ndock .mood{width:28px;height:28px}#ndock .nd{width:20px;height:20px}#ndock .nd svg.ic{inset:4px;width:12px;height:12px}
  #ndock{bottom:auto;top:calc(max(14px,env(safe-area-inset-top)) + 92px);left:auto;right:max(14px,env(safe-area-inset-right));transform:none;flex-direction:column}
  #nchip{bottom:auto;top:max(14px,env(safe-area-inset-top))} #nsheet{bottom:auto;top:30%}}
`;
const icon = (d: string, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const col = (v: number) => (v > 60 ? '#49e08a' : v > 35 ? '#facc15' : v > 18 ? '#fb923c' : '#ff4d5e');

export class LifeUi {
  dock: HTMLElement; chip: HTMLElement; sheet: HTMLElement; fade: HTMLElement; sleep: HTMLElement;
  onCancel?: () => void;
  constructor() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    const mk = (id: string, html = '') => { const d = document.createElement('div'); d.id = id; d.innerHTML = html; document.body.appendChild(d); return d; };
    this.dock = mk('ndock', `<div class="mood" id="nmood">0</div><span class="ml" id="nml">Fine</span>` + NEEDS.map((n) => `<div class="nd" id="nd-${n}" title="${NEED_INFO[n].label}"><svg class="ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2.4"/><circle id="nr-${n}" cx="12" cy="12" r="10.5" fill="none" stroke="#49e08a" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="66 66"/></svg>${icon(NEED_INFO[n].icon)}</div>`).join(''));
    this.chip = mk('nchip', `<b id="nchip-t"></b><button id="nchip-x" aria-label="Stop">✕</button><div class="bar"><i id="nchip-p"></i></div>`);
    this.sheet = mk('nsheet');
    this.fade = mk('nfade'); this.sleep = mk('nsleep', '<b>SLEEPING</b>');
    this.dock.style.display = 'none';
    this.dock.addEventListener('pointerup', (e) => { e.stopPropagation(); this.sheet.classList.toggle('on'); });
    (this.chip.querySelector('#nchip-x') as HTMLElement).addEventListener('pointerup', (e) => { e.stopPropagation(); this.onCancel?.(); });
  }
  show(on: boolean) { this.dock.style.display = on ? 'flex' : 'none'; if (!on) { this.sheet.classList.remove('on'); this.chip.classList.remove('on'); } }
  update(s: NeedsState, mood: number) {
    const m = document.getElementById('nmood')!; m.style.background = moodColor(mood); m.textContent = (mood > 0 ? '+' : '') + Math.round(mood);
    document.getElementById('nml')!.textContent = moodLabel(mood);
    for (const n of NEEDS) {
      const v = s.v[n]; const r = document.getElementById('nr-' + n)!; r.setAttribute('stroke-dasharray', `${(v / 100) * 66} 66`); r.setAttribute('stroke', col(v));
      document.getElementById('nd-' + n)!.classList.toggle('low', v < 18);
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
