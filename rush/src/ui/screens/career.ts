// Career: four cups from rookie to Lagos legend. The same rivals follow you through a cup, points add up across
// the races, and a podium pays out.
import type { App, Screen } from '../../app/app';
import { el, acts, esc, naira, laps } from '../dom';
import { topbar } from './main';
import { defaultRaceConfig, type RaceConfig, type TimeOfDay } from '../../shared/race';
import type { AiLevel } from '../../shared/ai';
import { AI_LEVELS } from '../../shared/ai';
import { carById } from '../../shared/cars';
import { quickEntrants } from '../../game/session';
import { currentCar, level, saveProfile } from '../../app/profile';
import { drawTrackThumb } from '../trackart';
import { makePersonas } from '../../shared/ai';

export interface Cup { id: string; name: string; blurb: string; unlock: number; ai: AiLevel; traffic: number; time: TimeOfDay; races: { track: string; laps: number }[]; prize: number }
export const CUPS: Cup[] = [
  { id: 'rookie', name: 'Oshodi Rookie Cup', blurb: 'Three easy races to learn the roads around the interchange.', unlock: 1, ai: 'easy', traffic: 1, time: 'morning', races: [{ track: 'oshodi', laps: 1 }, { track: 'terminal', laps: 2 }, { track: 'expressway', laps: 1 }], prize: 8000 },
  { id: 'interchange', name: 'Interchange Cup', blurb: 'Every route run backwards. The corners come at you from the other side.', unlock: 3, ai: 'normal', traffic: 1, time: 'dusk', races: [{ track: 'terminal-rev', laps: 2 }, { track: 'oshodi-rev', laps: 1 }, { track: 'expressway-rev', laps: 2 }], prize: 15000 },
  { id: 'masters', name: 'Expressway Masters', blurb: 'Rush hour traffic and rivals who brake late.', unlock: 6, ai: 'hard', traffic: 2, time: 'noon', races: [{ track: 'expressway', laps: 2 }, { track: 'grand', laps: 1 }, { track: 'terminal', laps: 3 }], prize: 30000 },
  { id: 'legend', name: 'Lagos Legend Cup', blurb: 'Night racing against the best drivers in the city. Four races, no mercy.', unlock: 9, ai: 'lagos', traffic: 2, time: 'night', races: [{ track: 'grand', laps: 1 }, { track: 'oshodi', laps: 2 }, { track: 'terminal-rev', laps: 3 }, { track: 'expressway-rev', laps: 2 }], prize: 60000 },
];
const POINTS = [15, 12, 10, 8, 6, 5, 4, 3, 2, 1, 0, 0];
let selected = 'rookie';

interface CupState { results: number[]; points: number; done: boolean; table?: Record<string, number> }

function cupState(app: App, id: string): CupState {
  const c = app.profile.career[id] as CupState | undefined;
  return c ?? { results: [], points: 0, done: false, table: {} };
}

export function careerScreen(app: App): Screen {
  const p = app.profile, lvl = level(p).level;
  const cup = CUPS.find((c) => c.id === selected)!;
  const st = cupState(app, cup.id);
  const personas = makePersonas(11, cup.id.length * 101 + 7);
  const table = Object.entries(st.table ?? {}).sort((a, b) => b[1] - a[1]);
  const node = el(`<div class="screen">
    ${topbar('Career', 'Cups from rookie to Lagos legend', app)}
    <div class="split">
      <div class="scroll"><div class="cards" style="grid-template-columns:1fr">
        ${CUPS.map((c) => { const s = cupState(app, c.id); const locked = lvl < c.unlock; return `<button class="card ${c.id === selected ? 'sel' : ''} ${locked ? 'locked' : ''}" data-act="cup" data-id="${c.id}">
          <div class="row"><div class="k">${esc(c.name)}</div><span class="spacer"></span>${s.done ? '<span class="tag green">DONE</span>' : locked ? `<span class="tag dark">LVL ${c.unlock}</span>` : s.results.length ? `<span class="tag">${s.results.length}/${c.races.length}</span>` : ''}</div>
          <div class="d">${esc(c.blurb)}</div>
          <div class="meta"><span class="tag dark">${AI_LEVELS[c.ai].label.toUpperCase()}</span><span class="tag dark">${c.races.length} RACES</span><span class="price">${naira(c.prize)}</span></div>
        </button>`; }).join('')}
      </div></div>
      <div class="scroll panel" style="padding:16px; display:flex; flex-direction:column; gap:14px">
        <div class="h2">${esc(cup.name)}</div>
        <div class="cards">${cup.races.map((r, i) => { const td = app.stage!.tracks.find((t) => t.id === r.track)!; const done = st.results[i]; return `<div class="card ${i === st.results.length && !st.done ? 'sel' : ''}"><canvas class="mini" data-thumb="${td.id}"></canvas><div class="k">${i + 1}. ${esc(td.name)}</div><div class="meta"><span class="tag dark">${laps(r.laps)}</span>${done ? `<span class="tag ${done <= 3 ? 'green' : 'dark'}">${done}${['TH', 'ST', 'ND', 'RD'][done % 10] ?? 'TH'}</span>` : ''}</div></div>`; }).join('')}</div>
        ${table.length ? `<div><div class="h3" style="margin-bottom:6px">Cup standings</div><table class="list"><tbody>${table.map(([id, pts], i) => `<tr class="${id === p.id ? 'me' : ''}"><td>${i + 1}</td><td>${esc(id === p.id ? p.name : personas[+id.replace('ai', '')]?.name ?? id)}</td><td class="mono">${pts} pts</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="bottombar">
          ${st.results.length && !st.done ? '<button class="btn ghost small" data-act="reset"><span>Restart cup</span></button>' : ''}
          ${lvl < cup.unlock ? `<span class="tag dark">REACH LEVEL ${cup.unlock}</span>` : st.done ? '<button class="btn" data-act="reset"><span>Race it again</span></button>' : `<button class="btn" data-act="go" data-autofocus><span>${st.results.length ? 'Next race' : 'Start cup'}</span></button>`}
        </div>
      </div>
    </div>
  </div>`);
  requestAnimationFrame(() => node.querySelectorAll<HTMLCanvasElement>('canvas[data-thumb]').forEach((c) => { const t = app.stage!.tracks.find((x) => x.id === c.dataset.thumb); if (t) drawTrackThumb(c, t); }));
  acts(node, {
    back: () => app.back(),
    cup: (t) => { selected = t.dataset.id!; app.refresh(); },
    reset: () => { delete p.career[cup.id]; saveProfile(p); app.refresh(); },
    go: () => startCupRace(app, cup),
  });
  return { el: node, view: 'city' };
}

function startCupRace(app: App, cup: Cup) {
  const p = app.profile;
  const st = cupState(app, cup.id);
  const race = cup.races[st.results.length];
  const td = app.stage!.tracks.find((t) => t.id === race.track)!;
  const cfg: RaceConfig = { ...defaultRaceConfig(td.id, race.laps), aiLevel: cup.ai, traffic: cup.traffic, time: cup.time, weather: 'clear', seed: cup.id.length * 1000 + st.results.length * 17 + 3 };
  const car = currentCar(p);
  const me = { id: p.id, name: p.name, carId: car.carId, livery: car.livery, human: true, crew: p.crew, look: p.look };
  const entrants = quickEntrants(me, 12, cup.id.length * 101 + 7, carById(car.carId).cls);
  // keep rival names stable across the cup
  const personas = makePersonas(11, cup.id.length * 101 + 7);
  entrants.forEach((e) => { if (!e.human) e.name = personas[+e.id.replace('ai', '')]?.name ?? e.name; });
  app.startRace(td, cfg, entrants, (r) => {
    const me2 = r.standings.find((s) => s.idx === r.playerIdx)!;
    const s = cupState(app, cup.id);
    s.results.push(me2.place);
    s.table = s.table ?? {};
    for (const row of r.standings) s.table[row.id] = (s.table[row.id] ?? 0) + (POINTS[row.place - 1] ?? 0);
    s.points = s.table[p.id] ?? 0;
    if (s.results.length >= cup.races.length) {
      s.done = true;
      const pos = Object.entries(s.table).sort((a, b) => b[1] - a[1]).findIndex(([id]) => id === p.id) + 1;
      const prize = pos === 1 ? cup.prize : pos === 2 ? Math.round(cup.prize * 0.6) : pos === 3 ? Math.round(cup.prize * 0.35) : 0;
      p.naira += prize;
      setTimeout(() => app.toast(pos <= 3 ? `${cup.name}: you finished ${pos}${['TH', 'ST', 'ND', 'RD'][pos]}. Prize ${'₦'}${prize.toLocaleString()}` : `${cup.name} complete. Finished ${pos}th overall.`, 4500), 1200);
    }
    p.career[cup.id] = s as never;
    saveProfile(p);
  });
}
