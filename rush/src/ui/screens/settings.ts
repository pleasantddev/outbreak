// Settings: graphics presets and every advanced switch, audio, controls with rebinding, accessibility, gameplay,
// and Credits, the one place the game names its map data source and licences.
import type { App, Screen } from '../../app/app';
import { el, acts, esc } from '../dom';
import { topbar } from './main';
import { saveProfile, setPreset } from '../../app/profile';
import { PRESET_ORDER, PRESET_LABEL, refineByBenchmark, detectDevice, guessPreset, type PresetId } from '../../render/quality';
import { ACTION_LABEL, DEFAULT_KEYS, type Action } from '../../game/input';

let tab: 'graphics' | 'audio' | 'controls' | 'access' | 'gameplay' | 'about' = 'graphics';
let needsRebuild = false;

const sw = (on: boolean, act: string, key: string) => `<button class="switch ${on ? 'on' : ''}" data-act="${act}" data-k="${key}" role="switch" aria-checked="${on}" aria-label="${key}"></button>`;
const toggle = (t: string, sub: string, on: boolean, act: string, key: string) => `<div class="toggle"><div class="t">${t}${sub ? `<small>${sub}</small>` : ''}</div>${sw(on, act, key)}</div>`;
const slider = (t: string, key: string, v: number, min: number, max: number, step: number, fmt: (v: number) => string) => `<div class="toggle"><div class="t">${t} <small data-out="${key}">${fmt(v)}</small></div><input class="slider" style="max-width:220px" type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-slider="${key}"></div>`;
const keyName = (c: string) => c.replace('Key', '').replace('Arrow', '').replace('Left', ' L').replace('Right', ' R').replace('Space', 'SPACE');

export function settingsScreen(app: App): Screen {
  const p = app.profile, g = p.settings.graphics, a = p.settings.audio, inp = p.settings.input, acc = p.settings.access, gp = p.settings.gameplay;
  let body = '';
  if (tab === 'graphics') body = `
    <div class="field"><span class="lab">Preset</span><div class="seg">
      <button class="${g.auto ? 'on' : ''}" data-act="preset" data-v="auto">Auto</button>
      ${PRESET_ORDER.map((id) => `<button class="${!g.auto && g.preset === id ? 'on' : ''}" data-act="preset" data-v="${id}">${PRESET_LABEL[id]}</button>`).join('')}
    </div></div>
    <div class="small mute">Auto picks a preset from your GPU and a quick benchmark. Dynamic resolution then keeps the frame rate steady on busy laps.</div>
    <div class="row"><button class="btn ghost small" data-act="bench"><span>Run benchmark</span></button><span class="small mute" data-bench></span></div>
    <div class="h3" style="margin-top:8px">Advanced</div>
    <div class="small mute">Shadows, building detail, props, crowd and draw distance rebuild the city, so they apply when you leave this screen.</div>
    ${slider('Render scale', 'renderScale', g.renderScale, 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
    ${toggle('Dynamic resolution', 'Lowers resolution briefly when the frame rate dips', g.dynamicRes, 'gfx', 'dynamicRes')}
    <div class="toggle"><div class="t">Target frame rate</div><div class="seg">${[30, 60, 120].map((f) => `<button class="${g.targetFps === f ? 'on' : ''}" data-act="fps" data-v="${f}">${f}</button>`).join('')}</div></div>
    <div class="toggle"><div class="t">Shadows</div><div class="seg">${[[0, 'Off'], [1024, 'Low'], [2048, 'High'], [4096, 'Ultra']].map(([v, l]) => `<button class="${g.shadows === v ? 'on' : ''}" data-act="shadows" data-v="${v}">${l}</button>`).join('')}</div></div>
    <div class="toggle"><div class="t">Building detail<small>Parapets, roofs, water tanks, awnings</small></div><div class="seg">${[[0, 'Low'], [1, 'Medium'], [2, 'High']].map(([v, l]) => `<button class="${g.buildingDetail === v ? 'on' : ''}" data-act="detail" data-v="${v}">${l}</button>`).join('')}</div></div>
    ${slider('Draw distance', 'drawDistance', g.drawDistance, 300, 1400, 50, (v) => `${v} m`)}
    ${slider('Street props', 'props', g.props, 0.2, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
    ${slider('Particles', 'particles', g.particles, 0.2, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
    ${toggle('Bloom', 'Glow on lights and boosts', g.bloom, 'gfx', 'bloom')}
    ${toggle('Anti-aliasing', 'Smoother edges (SMAA)', g.smaa, 'gfx', 'smaa')}
    ${toggle('Speed effects', 'Streaks, colour fringe and camera shake at speed', g.motionFx, 'gfx', 'motionFx')}
    ${toggle('City reflections', 'Sky reflections on buildings and roads. Cars always reflect', g.reflections, 'gfx', 'reflections')}
    ${toggle('Crowds', 'Spectators at the start and the hairpins', g.crowd, 'gfx', 'crowd')}
    ${toggle('Performance overlay', 'FPS, frame time, draw calls and resolution', g.showPerf, 'gfx', 'showPerf')}`;
  else if (tab === 'audio') body = `
    ${slider('Master', 'master', a.master, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
    ${slider('Music', 'music', a.music, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
    ${slider('Effects', 'sfx', a.sfx, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
    ${slider('Engines', 'engine', a.engine, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
    ${toggle('Mute everything', '', a.muted, 'audio', 'muted')}`;
  else if (tab === 'controls') body = `
    <div class="h3">Keyboard</div>
    ${(Object.keys(DEFAULT_KEYS) as Action[]).map((k) => `<div class="toggle"><div class="t">${ACTION_LABEL[k]}</div><button class="btn ghost small" data-act="rebind" data-k="${k}"><span>${inp.keys[k].map(keyName).join(' / ')}</span></button></div>`).join('')}
    <div class="row" style="margin-top:6px"><button class="btn ghost small" data-act="resetKeys"><span>Reset keys</span></button></div>
    <div class="h3" style="margin-top:10px">Gamepad</div>
    <div class="small mute">Right trigger accelerates, left trigger brakes. Left stick steers and flips in the air. A or RB drifts, B or X burns Fuel, Y or LB uses your item, Start pauses.</div>
    <div class="h3" style="margin-top:10px">Touch and assists</div>
    <div class="toggle"><div class="t">Touch steering<small>Arrow pads, or a stick that appears under your thumb</small></div><div class="seg">${([['arrows', 'Arrows'], ['stick', 'Stick']] as const).map(([v, l]) => `<button class="${inp.touchLayout === v ? 'on' : ''}" data-act="touchLayout" data-v="${v}">${l}</button>`).join('')}</div></div>
    ${slider('Steering assist', 'steerAssist', inp.steerAssist, 0, 0.8, 0.05, (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`))}
    ${toggle('Vibration', 'Rumble on hits and landings', inp.vibration, 'input', 'vibration')}
    ${toggle('Invert flips', 'Swap forward and back flips in the air', inp.invertAirPitch, 'input', 'invertAirPitch')}`;
  else if (tab === 'access') body = `
    ${toggle('Colour-blind safe HUD', 'Blue and orange instead of green and red', acc.cbSafe, 'access', 'cbSafe')}
    ${toggle('Reduce motion', 'Fewer animations in menus; no speed effects', acc.reduceMotion, 'access', 'reduceMotion')}
    ${toggle('High contrast', 'Solid panels and brighter secondary text', acc.highContrast, 'access', 'highContrast')}
    ${slider('Interface size', 'uiScale', acc.uiScale, 0.85, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`)}
    <div class="small mute">Steering assist and touch steering live under Controls.</div>`;
  else if (tab === 'gameplay') body = `
    <div class="toggle"><div class="t">Speed units</div><div class="seg">${[['kmh', 'km/h'], ['mph', 'mph']].map(([v, l]) => `<button class="${gp.units === v ? 'on' : ''}" data-act="units" data-v="${v}">${l}</button>`).join('')}</div></div>
    <div class="toggle"><div class="t">Camera</div><div class="seg">${[['near', 'Chase'], ['far', 'Far chase'], ['hood', 'Hood']].map(([v, l]) => `<button class="${gp.camera === v ? 'on' : ''}" data-act="camera" data-v="${v}">${l}</button>`).join('')}</div></div>
    ${toggle('Skip race intro', 'Go straight to the grid', gp.skipIntro, 'gameplay', 'skipIntro')}
    ${toggle('Campaign posters', 'Election fliers pasted on walls and barriers around the streets', gp.political, 'gameplay', 'political')}`;
  else body = `
    <div class="h3">Lagos Rush 0.1</div>
    <div class="small" style="line-height:1.6">
      <p>Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style="color:var(--yellow)">OpenStreetMap contributors</a>, ODbL 1.0; the map data derived from it is available under the same licence.</p>
      <p>Every maker, brand, billboard and shop name in the game is invented.</p>
      <p>There is no real money anywhere in this version. Naira in the game is play money that can't be bought, sold or cashed out.</p>
      <p>Fonts: Barlow Condensed, Inter and JetBrains Mono under the SIL Open Font License. Rendering with three.js (MIT) and postprocessing (zlib). All sound is synthesised live.</p>
      <p>Your save stays on this device. Online rooms only see your racing name, crew, car and lap data.</p>
    </div>`;
  const node = el(`<div class="screen" style="background:rgba(11,11,13,0.78)">
    ${topbar('Settings')}
    <div class="tabs">${(['graphics', 'audio', 'controls', 'access', 'gameplay', 'about'] as const).map((t) => `<button class="${tab === t ? 'on' : ''}" data-act="tab" data-v="${t}">${t === 'access' ? 'Accessibility' : t === 'about' ? 'Credits' : t}</button>`).join('')}</div>
    <div class="scroll panel" style="padding:4px 16px 16px; flex:1; max-width:860px">${body}</div>
  </div>`);
  const gfx = () => { p.settings.graphics.preset = 'custom'; p.settings.graphics.auto = false; app.applyGraphics(); };
  acts(node, {
    back: () => app.back(),
    tab: (t) => { tab = t.dataset.v as typeof tab; app.refresh(); },
    preset: (t) => {
      const v = t.dataset.v!;
      if (v === 'auto') setPreset(p, guessPreset(detectDevice()), true); else setPreset(p, v as PresetId, false);
      needsRebuild = true; app.applyGraphics(); app.refresh();
    },
    gfx: (t) => { const k = t.dataset.k as 'dynamicRes' | 'bloom' | 'smaa' | 'motionFx' | 'reflections' | 'crowd' | 'showPerf'; (g as unknown as Record<string, boolean>)[k] = !g[k]; if (k === 'crowd') needsRebuild = true; if (k === 'showPerf') app.applyGraphics(); else gfx(); app.refresh(); },
    fps: (t) => { g.targetFps = +t.dataset.v! as 30 | 60 | 120; gfx(); app.refresh(); },
    shadows: (t) => { g.shadows = +t.dataset.v! as 0 | 1024 | 2048 | 4096; needsRebuild = true; gfx(); app.refresh(); },
    detail: (t) => { g.buildingDetail = +t.dataset.v! as 0 | 1 | 2; needsRebuild = true; gfx(); app.refresh(); },
    bench: async () => {
      const out = node.querySelector('[data-bench]') as HTMLElement; out.textContent = 'Measuring...';
      const ms = await app.stage!.engine.benchmark(40);
      const cur = g.preset === 'custom' ? 'medium' : g.preset;
      const rec = refineByBenchmark(cur as PresetId, ms, g.targetFps);
      out.textContent = `${ms.toFixed(1)} ms per frame. Suggested: ${PRESET_LABEL[rec]}.`;
    },
    audio: (t) => { const k = t.dataset.k as 'muted'; a[k] = !a[k]; app.audio.applyPrefs(); saveProfile(p); app.refresh(); },
    input: (t) => { const k = t.dataset.k as 'vibration' | 'invertAirPitch'; inp[k] = !inp[k]; saveProfile(p); app.refresh(); },
    touchLayout: (t) => { inp.touchLayout = t.dataset.v as 'arrows' | 'stick'; app.touch?.setLayout(inp.touchLayout); saveProfile(p); app.refresh(); },
    access: (t) => { const k = t.dataset.k as 'cbSafe' | 'reduceMotion' | 'highContrast'; acc[k] = !acc[k]; if (k === 'reduceMotion' && acc.reduceMotion) { g.motionFx = false; app.applyGraphics(); } app.applyAccess(); saveProfile(p); app.refresh(); },
    gameplay: (t) => { const k = t.dataset.k as 'skipIntro' | 'political'; gp[k] = !gp[k]; if (k === 'political') needsRebuild = true; saveProfile(p); app.refresh(); },
    units: (t) => { gp.units = t.dataset.v as 'kmh' | 'mph'; saveProfile(p); app.refresh(); },
    camera: (t) => { gp.camera = t.dataset.v as 'near' | 'far' | 'hood'; saveProfile(p); app.refresh(); },
    resetKeys: () => { inp.keys = structuredClone(DEFAULT_KEYS); saveProfile(p); app.refresh(); },
    rebind: (t) => {
      const k = t.dataset.k as Action;
      (t.querySelector('span') as HTMLElement).textContent = 'Press a key...';
      const h = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); window.removeEventListener('keydown', h, true); if (e.code !== 'Escape') { inp.keys[k] = [e.code]; saveProfile(p); } app.refresh(); };
      window.addEventListener('keydown', h, true);
    },
  });
  node.querySelectorAll<HTMLInputElement>('[data-slider]').forEach((s) => s.addEventListener('input', () => {
    const k = s.dataset.slider!, v = +s.value;
    const out = node.querySelector(`[data-out="${k}"]`) as HTMLElement | null;
    if (k in g) { (g as unknown as Record<string, number>)[k] = v; if (k === 'drawDistance' || k === 'props') needsRebuild = true; gfx(); if (out) out.textContent = k === 'drawDistance' ? `${v} m` : `${Math.round(v * 100)}%`; }
    else if (k in a) { (a as unknown as Record<string, number>)[k] = v; app.audio.applyPrefs(); saveProfile(p); if (out) out.textContent = `${Math.round(v * 100)}%`; }
    else if (k === 'steerAssist') { inp.steerAssist = v; saveProfile(p); if (out) out.textContent = v === 0 ? 'Off' : `${Math.round(v * 100)}%`; }
    else if (k === 'uiScale') { acc.uiScale = v; app.applyAccess(); saveProfile(p); if (out) out.textContent = `${Math.round(v * 100)}%`; }
  }));
  return { el: node, onLeave: () => { if (needsRebuild) { needsRebuild = false; app.stage!.political = p.settings.gameplay.political; app.rebuildScenery(); } } };
}
export { esc };
