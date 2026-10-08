// Quick race setup, the pause menu and the results screen.
import type { App, Screen } from '../../app/app';
import { el, acts, esc, naira, laps } from '../dom';
import { topbar } from './main';
import { mainMenu } from './main';
import { garageScreen } from './garage';
import { settingsScreen } from './settings';
import { drawTrackThumb } from '../trackart';
import { defaultRaceConfig, type RaceConfig, type RaceMode, type TimeOfDay, type Weather } from '../../shared/race';
import type { AiLevel } from '../../shared/ai';
import { AI_LEVELS } from '../../shared/ai';
import { carById } from '../../shared/cars';
import { quickEntrants } from '../../game/session';
import { currentCar, saveProfile, level } from '../../app/profile';
import { raceReward, levelFromXp, type Reward } from '../../shared/economy';
import type { SessionResult } from '../../game/session';
import { fmtTime } from '../hud';
import { designIdOf } from '../../app/designs';
import { goRoute } from '../../app/route';
import type { TrackData } from '../../shared/track';

export const MODES: { id: RaceMode; name: string; d: string }[] = [
  { id: 'rush', name: 'Rush Race', d: 'Items, traffic and Fuel. The full Lagos experience.' },
  { id: 'street', name: 'Street Race', d: 'No items. Traffic, Fuel and shunts decide it.' },
  { id: 'stunt', name: 'Stunt Run', d: 'Two minutes. Airtime, tricks, drifts and near misses for points.' },
  { id: 'trial', name: 'Time Trial', d: 'Just you and your ghost against the clock.' },
];
export const TIMES: [TimeOfDay, string][] = [['morning', 'Morning'], ['noon', 'Noon'], ['dusk', 'Dusk'], ['night', 'Night']];
export const WEATHERS: [Weather, string][] = [['clear', 'Clear'], ['harmattan', 'Harmattan'], ['rain', 'Rain']];

interface QuickState { track: string; mode: RaceMode; laps: number; opponents: number; ai: AiLevel; traffic: number; time: TimeOfDay; weather: Weather }
let qs: QuickState | null = null;

export function seg<T extends string | number>(name: string, options: [T, string][], value: T) {
  return `<div class="field"><span class="lab">${name}</span><div class="seg" data-seg="${name}">${options.map(([v, l]) => `<button class="${v === value ? 'on' : ''}" data-act="seg" data-k="${name}" data-v="${v}">${l}</button>`).join('')}</div></div>`;
}

export function trackCards(app: App, selected: string, act = 'track', filter: (t: TrackData) => boolean = () => true) {
  return app.stage!.tracks.filter(filter).map((t) => `<button class="card ${t.id === selected ? 'sel' : ''}" data-act="${act}" data-id="${t.id}">
      <canvas class="mini" data-thumb="${t.id}"></canvas>
      <div class="k">${esc(t.name)}</div>
      <div class="d">${esc(t.tagline)}</div>
      <div class="meta"><span class="tag dark">${(t.length / 1000).toFixed(2)} KM</span><span class="tag dark">${laps(t.laps)}</span>${t.reverse ? '<span class="tag pink">REVERSE</span>' : ''}${t.custom ? '<span class="tag green">YOUR DESIGN</span>' : ''}<span class="tag dark">PAR ${t.par.toFixed(0)}s</span></div>
    </button>`).join('');
}
export function paintThumbs(app: App, root: HTMLElement) {
  requestAnimationFrame(() => root.querySelectorAll<HTMLCanvasElement>('canvas[data-thumb]').forEach((c) => { const t = app.stage!.tracks.find((x) => x.id === c.dataset.thumb); if (t) drawTrackThumb(c, t); }));
}

export function quickRace(app: App): Screen {
  const tracks = app.stage!.tracks;
  qs = qs ?? { track: tracks[0].id, mode: 'rush', laps: tracks[0].laps, opponents: 11, ai: 'normal', traffic: 1, time: 'dusk', weather: 'clear' };
  const s = qs;
  const car = currentCar(app.profile), def = carById(car.carId);
  const node = el(`<div class="screen">
    ${topbar('Quick Race', 'Pick a route, set the rules, go', app)}
    <div class="split">
      <div class="scroll"><div class="cards" style="grid-template-columns:1fr">${trackCards(app, s.track)}</div></div>
      <div class="scroll panel" style="padding:16px; display:flex; flex-direction:column; gap:14px">
        ${seg('Mode', MODES.map((m) => [m.id, m.name] as [RaceMode, string]), s.mode)}
        <div class="small mute">${MODES.find((m) => m.id === s.mode)!.d}</div>
        ${s.mode !== 'stunt' ? seg('Laps', [1, 2, 3, 4, 5].map((n) => [n, String(n)] as [number, string]), s.laps) : ''}
        ${s.mode !== 'trial' ? seg('Opponents', [3, 5, 7, 11].map((n) => [n, String(n)] as [number, string]), s.opponents) : ''}
        ${s.mode !== 'trial' ? seg('Rivals', (Object.keys(AI_LEVELS) as AiLevel[]).map((k) => [k, AI_LEVELS[k].label] as [AiLevel, string]), s.ai) : ''}
        ${s.mode === 'rush' || s.mode === 'street' ? seg('Traffic', [[0, 'Off'], [1, 'Light'], [2, 'Rush hour'], [3, 'Go slow']] as [number, string][], s.traffic) : ''}
        ${seg('Time', TIMES, s.time)}
        ${seg('Weather', WEATHERS, s.weather)}
        <div class="row" style="margin-top:auto; padding-top:8px; border-top:1px solid var(--line)">
          <div><div class="small mute">YOUR CAR</div><div class="h3">${esc(def.name)}</div></div>
          <span class="spacer"></span>
          <button class="btn ghost small" data-act="garage"><span>Change</span></button>
        </div>
        <button class="btn" data-act="start" data-autofocus><span>Start race</span></button>
      </div>
    </div>
  </div>`);
  paintThumbs(app, node);
  acts(node, {
    back: () => app.back(),
    track: (t) => { s.track = t.dataset.id!; const td = tracks.find((x) => x.id === s.track)!; s.laps = td.laps; app.refresh(); },
    seg: (t) => {
      const k = t.dataset.k!, v = t.dataset.v!;
      if (k === 'Mode') s.mode = v as RaceMode; else if (k === 'Laps') s.laps = +v; else if (k === 'Opponents') s.opponents = +v; else if (k === 'Rivals') s.ai = v as AiLevel; else if (k === 'Traffic') s.traffic = +v; else if (k === 'Time') s.time = v as TimeOfDay; else if (k === 'Weather') s.weather = v as Weather;
      app.refresh();
    },
    garage: () => app.go(garageScreen),
    start: () => launchQuick(app),
  });
  return { el: node, view: 'city' };
}

/** Straight onto the grid of a route from the designer, with a full field so the route gets a proper test. */
export function testDrive(app: App, trackId: string) {
  const td = app.stage!.tracks.find((t) => t.id === trackId);
  if (!td) return;
  qs = { track: td.id, mode: 'rush', laps: Math.min(td.laps, 2), opponents: 7, ai: 'normal', traffic: 1, time: 'dusk', weather: 'clear' };
  launchQuick(app);
}

export function launchQuick(app: App) {
  const s = qs!;
  const td = app.stage!.tracks.find((t) => t.id === s.track)!;
  const cfg: RaceConfig = { ...defaultRaceConfig(td.id, s.laps), mode: s.mode, traffic: s.mode === 'trial' || s.mode === 'stunt' ? 0 : s.traffic, aiLevel: s.ai, time: s.time, weather: s.weather, seed: Math.floor(Math.random() * 1e9) };
  const car = currentCar(app.profile);
  const me = { id: app.profile.id, name: app.profile.name, carId: car.carId, livery: car.livery, human: true, crew: app.profile.crew, level: level(app.profile).level, look: app.profile.look };
  const count = s.mode === 'trial' ? 1 : s.opponents + 1;
  const entrants = count === 1 ? [me] : quickEntrants(me, count, cfg.seed % 97, carById(car.carId).cls);
  app.startRace(td, cfg, entrants, () => {});
}

// ------------------------------------------------------------------------------------------- pause

export function pauseScreen(app: App): Screen {
  const s = app.session!;
  const online = s.online;
  const node = el(`<div class="screen pause">
    <div style="margin-top:8vh; display:flex; flex-direction:column; gap:20px; align-items:center">
      <div class="h1">${online ? 'MENU' : 'PAUSED'}</div>
      <div class="mute">${esc(s.track.data.name)} . LAP ${Math.max(1, Math.min(s.sim.cfg.laps, s.player.c.lap))}/${s.sim.cfg.laps} . ${s.player.c.place}${['TH', 'ST', 'ND', 'RD'][s.player.c.place % 10] ?? 'TH'}</div>
      ${online ? '<div class="small mute">Online races keep going. Your car coasts until you come back.</div>' : ''}
      <nav>
        <button class="btn" data-act="resume" data-autofocus><span>Resume</span></button>
        ${online ? '' : '<button class="btn ghost" data-act="restart"><span>Restart</span></button>'}
        <button class="btn ghost" data-act="settings"><span>Settings</span></button>
        <button class="btn ghost" data-act="quit"><span>${online ? 'Leave the room' : 'Quit to menu'}</span></button>
      </nav>
    </div>
  </div>`);
  acts(node, {
    resume: () => app.resume(),
    restart: () => { const lr = app.lastRace!; app.session?.dispose(); app.session = null; app.startRace(lr.track, { ...lr.cfg }, lr.entrants, app.onRaceEnd ?? (() => {})); },
    settings: () => app.show(settingsScreen),
    quit: () => { if (online) app.leaveOnline(); else { app.leaveRace(); app.show(mainMenu, true); } },
  });
  return { el: node, keepMenu: true, onBack: () => { app.resume(); return false; } };
}

// ------------------------------------------------------------------------------------------- results

const settled = new WeakMap<object, { reward: Reward; levelUp: number; newRecord: boolean }>();

/** Pay out a finished race once, however many times its results screen is drawn. Play money only. */
export function settleRace(app: App, r: SessionResult, online: boolean) {
  const done = settled.get(r);
  if (done) return done;
  const p = app.profile;
  const me = r.standings.find((x) => x.idx === r.playerIdx)!;
  const td = app.stage!.tracks.find((t) => t.id === r.trackId)!;
  const prevRecord = p.records[r.trackId] ?? 0;
  const newRecord = !!r.bestLap && (!prevRecord || r.bestLap < prevRecord);
  const reward = raceReward({ place: me.place, count: r.standings.length, mode: r.cfg.mode, finished: me.finished, drift: me.stats.drift, air: me.stats.air, tricks: me.stats.tricks, nearMiss: me.stats.nearMiss, shunts: me.stats.shunts, hits: me.stats.hits, laps: r.cfg.laps, trackLen: td.length, online, bestLapRecord: newRecord && r.standings.length > 1 });
  const before = levelFromXp(p.xp).level;
  p.naira += reward.naira; p.xp += reward.xp;
  const levelUp = levelFromXp(p.xp).level - before;
  p.stats.races++; if (me.place === 1 && r.standings.length > 1) p.stats.wins++; if (me.place <= 3 && r.standings.length > 1) p.stats.podiums++;
  p.stats.drift += me.stats.drift; p.stats.nearMiss += me.stats.nearMiss; p.stats.tricks += me.stats.tricks; p.stats.shunts += me.stats.shunts; p.stats.km += (Math.max(0, me.dist) / 1000);
  if (newRecord) p.records[r.trackId] = r.bestLap;
  saveProfile(p);
  const out = { reward, levelUp, newRecord };
  settled.set(r, out);
  return out;
}

export function rewardPanel(app: App, reward: Reward, levelUp: number, newRecord: boolean, bestLap: number) {
  return `<div class="panel" style="padding:16px">
    <div class="h3" style="margin-bottom:6px">Rewards</div>
    ${reward.lines.map((l, i) => `<div class="reward-line" style="animation-delay:${0.1 + i * 0.12}s"><span>${esc(l.label)}</span><span>${naira(l.naira)} <span class="mute small">+${l.xp} XP</span></span></div>`).join('')}
    <div class="reward-line" style="border:0; font:800 italic 1.5em var(--font-d)"><span>TOTAL</span><span>${naira(reward.naira)} <span class="small">+${reward.xp} XP</span></span></div>
    ${levelUp > 0 ? `<div class="levelup tag pink" style="font-size:1.2em">LEVEL UP: ${level(app.profile).level}</div>` : ''}
    ${newRecord ? `<div class="tag green" style="margin-top:8px">NEW LAP RECORD ${fmtTime(bestLap)}</div>` : ''}
  </div>`;
}

export const ordinal = (n: number) => `${n}<small style="font-size:0.4em">${['TH', 'ST', 'ND', 'RD'][n % 10 > 3 || [11, 12, 13].includes(n % 100) ? 0 : n % 10]}</small>`;

export function resultsScreen(app: App): Screen {
  const r = app.lastResult!;
  const me = r.standings.find((x) => x.idx === r.playerIdx)!;
  const td = app.stage!.tracks.find((t) => t.id === r.trackId)!;
  const { reward, levelUp, newRecord } = settleRace(app, r, false);
  const stunt = r.cfg.mode === 'stunt';
  const lead = r.standings[0];
  const rows = r.standings.map((s) => `<tr class="${s.idx === r.playerIdx ? 'me' : ''}"><td>${s.place}</td><td>${esc(s.name)}</td><td class="hide-sm">${esc(carById(s.carId).name)}</td><td class="mono">${stunt ? s.style.toLocaleString() : s.finished ? (s.idx === lead.idx ? fmtTime(s.time!) : `+${(s.time! - (lead.time ?? 0)).toFixed(3)}`) : `+${((lead.dist - s.dist) / 1000).toFixed(2)} km`}</td><td class="mono hide-sm">${s.bestLap ? fmtTime(s.bestLap) : '-'}</td></tr>`).join('');
  const node = el(`<div class="screen results">
    <div class="split results-split">
      <div class="scroll" style="display:flex; flex-direction:column; gap:14px">
        <div><span class="tag">${esc(td.name)}</span> <span class="tag dark">${esc(r.cfg.mode.toUpperCase())}</span></div>
        <div class="podium-place">${me.finished || stunt ? ordinal(me.place) : 'DNF'}</div>
        <div class="h3">${me.place === 1 ? 'Oshodi is yours.' : me.place <= 3 ? 'On the podium. Not bad at all.' : 'Shake it off. Run it back.'}</div>
        <div class="panel" style="padding:12px 14px">
          <table class="list"><thead><tr><th>#</th><th>Driver</th><th class="hide-sm">Car</th><th>${stunt ? 'Score' : 'Time'}</th><th class="hide-sm">Best</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
      </div>
      <div class="scroll" style="display:flex; flex-direction:column; gap:12px; justify-self:end; width:min(420px,100%)">
        ${rewardPanel(app, reward, levelUp, newRecord, r.bestLap)}
        <button class="btn" data-act="rematch" data-autofocus><span>Rematch</span></button>
        <button class="btn ghost" data-act="replay"><span>Watch replay</span></button>
        <div class="row"><button class="btn ghost small" data-act="garage"><span>Garage</span></button><button class="btn ghost small" data-act="menu"><span>Main menu</span></button>${designIdOf(td.id) ? '<button class="btn ghost small" data-act="designer"><span>Edit route</span></button>' : ''}</div>
      </div>
    </div>
  </div>`);
  acts(node, {
    designer: () => goRoute('designer', designIdOf(td.id)!),
    rematch: () => { const lr = app.lastRace!; app.session?.dispose(); app.session = null; app.startRace(lr.track, { ...lr.cfg, seed: Math.floor(Math.random() * 1e9) }, lr.entrants, app.onRaceEnd ?? (() => {})); },
    replay: () => { app.watchReplay(); for (const s of [node]) s.remove(); },
    garage: () => { app.leaveRace(); app.show(mainMenu, true); app.show(garageScreen); },
    menu: () => { app.leaveRace(); app.show(mainMenu, true); },
  });
  app.audio.music_('results', 0);
  return { el: node, onBack: () => { app.leaveRace(); app.show(mainMenu, true); return false; } };
}
