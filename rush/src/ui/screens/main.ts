import type { App, Screen } from '../../app/app';
import { el, acts, esc, naira } from '../dom';
import { level } from '../../app/profile';
import { UI_ICON } from '../icons';
import { quickRace } from './raceflow';
import { garageScreen } from './garage';
import { lagosMap } from './lagos';
import { multiplayer } from './online';
import { OFFLINE } from '../../app/route';
import { careerScreen } from './career';
import { profileScreen } from './profile';
import { settingsScreen } from './settings';

const SLOGANS = ['NO KING AS GOD', "GOD'S TIME IS THE BEST", 'NO CONDITION IS PERMANENT', 'EKO O NI BAJE', 'IGWEBUIKE', 'SANNU A HANKALI', 'HOLD YOUR CHANGE', 'SHINE YOUR EYE', 'WE MOVE'];

export function playerCard(app: App) {
  const p = app.profile, lv = level(p);
  return `<button class="player-card panel" data-act="profile" aria-label="Profile">
    <div class="avatar" style="background:${p.color}">${esc(p.name.slice(0, 2).toUpperCase())}</div>
    <div class="who"><div class="name">${esc(p.name)}</div><div class="small mute">${esc(p.crew)}</div>
    <div class="row small"><span>LVL ${lv.level}</span><span class="spacer"></span>${naira(p.naira)}</div>
    <div class="xpbar"><i style="width:${Math.round((lv.into / lv.need) * 100)}%"></i></div></div>
  </button>`;
}

export function mainMenu(app: App): Screen {
  const items: [string, string, string][] = [
    ['race', 'RACE', 'Quick race on the streets of Oshodi'],
    ['garage', 'GARAGE', 'Paint, wraps, rims and new rides'],
    ['lagos', 'LAGOS', 'The map, the routes, the landmarks'],
    ['online', 'MULTIPLAYER', OFFLINE ? 'Needs the race server, not in this copy' : 'Quick match, private rooms, your crew'],
    ['career', 'CAREER', 'Cups from rookie to Lagos legend'],
    ['profile', 'PROFILE', 'Your stats, records and crew'],
  ];
  const node = el(`<div class="screen menu">
    <div class="side">
      <div class="logo small"><div class="l1">LAGOS</div><div class="l2">RUSH</div><div class="bar stripes"></div></div>
      <nav>${items.map(([k, t, d], i) => `<button data-act="${k}" ${i === 0 ? 'data-autofocus' : ''}><span>${t}</span><small>${d}</small></button>`).join('')}</nav>
      <div class="foot">
        ${playerCard(app)}
        <button class="icon-btn" data-act="settings" aria-label="Settings">${UI_ICON.gear}</button>
        <div class="attrib">All brands in the game are fictional. No real money anywhere. Credits in Settings.</div>
      </div>
    </div>
    <div class="slogan hide-sm"><span class="danfo-slogan">${SLOGANS[Math.floor(Math.random() * SLOGANS.length)]}</span></div>
  </div>`);
  acts(node, {
    race: () => app.go(quickRace),
    garage: () => app.go(garageScreen),
    lagos: () => app.go(lagosMap),
    online: () => app.go(multiplayer),
    career: () => app.go(careerScreen),
    profile: () => app.go(profileScreen),
    settings: () => app.go(settingsScreen),
  });
  // hovering moves the yellow bar with the mouse as well as keyboard focus
  node.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => b.addEventListener('mouseenter', () => { if (!app.isTouch) b.focus({ preventScroll: true }); }));
  app.audio.music_('menu', 0);
  return { el: node, view: 'city' };
}

export function topbar(title: string, sub = '', app?: App) {
  return `<div class="topbar">
    <button class="icon-btn" data-act="back" aria-label="Back">${UI_ICON.back}</button>
    <div class="title"><div class="h2">${title}</div>${sub ? `<div class="small mute">${sub}</div>` : ''}</div>
    ${app ? `<div class="wallet"><span class="lvl">LVL ${level(app.profile).level}</span>${naira(app.profile.naira)}</div>` : ''}
  </div>`;
}
