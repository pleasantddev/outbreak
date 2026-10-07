// Profile (stats, records, badges, friend code), first-run onboarding, and the friends list.
import type { App, Screen } from '../../app/app';
import { el, acts, esc, naira } from '../dom';
import { topbar, mainMenu } from './main';
import { level, saveProfile, friendCode } from '../../app/profile';
import { fmtTime } from '../hud';
import { PRESET_LABEL } from '../../render/quality';
import { UI_ICON } from '../icons';

const COLORS = ['#f6c514', '#ff2d8a', '#39d0ff', '#39ff14', '#ff6a00', '#a678ff', '#ffffff', '#e5322d'];
const CREWS = ['Oshodi Kings', 'Ikeja Night Runners', 'Mushin Motorworks', 'Isolo Drift Club', 'Ilupeju Iron', 'Agege Express', 'Surulere Sliders', 'Yaba Tech'];

function badges(app: App) {
  const s = app.profile.stats;
  return [
    ['First Win', s.wins >= 1], ['Podium Regular', s.podiums >= 10], ['Gbedu Master', s.drift >= 600], ['Near Miss King', s.nearMiss >= 200],
    ['Stunt Lord', s.tricks >= 50], ['Shunt Specialist', s.shunts >= 25], ['Marathon', s.km >= 100], ['Online Racer', s.online >= 5],
  ] as [string, boolean][];
}

export function profileScreen(app: App): Screen {
  const p = app.profile, lv = level(p);
  const recs = app.stage!.tracks.map((t) => [t.name, p.records[t.id]] as [string, number | undefined]).filter(([, v]) => v);
  const node = el(`<div class="screen">
    ${topbar('Profile', '', app)}
    <div class="split">
      <div class="scroll panel" style="padding:16px; display:flex; flex-direction:column; gap:14px">
        <div class="row"><div class="avatar" style="background:${p.color}; width:64px; height:64px; font-size:1.8em">${esc(p.name.slice(0, 2).toUpperCase())}</div>
          <div><div class="h2">${esc(p.name)}</div><div class="mute">${esc(p.crew)}</div></div></div>
        <div class="field"><label>Name</label><div class="row"><input class="input" maxlength="16" value="${esc(p.name)}" data-input="name" style="flex:1"><button class="btn small" data-act="saveName"><span>Save</span></button></div></div>
        <div class="field"><span class="lab">Crew</span><div class="seg">${CREWS.map((c) => `<button class="${c === p.crew ? 'on' : ''}" data-act="crew" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>
        <div class="field"><span class="lab">Colour</span><div class="swatches">${COLORS.map((c) => `<button class="swatch ${c === p.color ? 'sel' : ''}" style="background:${c}" data-act="color" data-v="${c}" aria-label="${c}"></button>`).join('')}</div></div>
        <div class="field"><span class="lab">Friend code</span><div class="row"><span class="h3 mono" style="letter-spacing:.06em">${friendCode(p)}</span><span class="spacer"></span><button class="icon-btn" data-act="copy" aria-label="Copy">${UI_ICON.copy}</button></div></div>
      </div>
      <div class="scroll" style="display:flex; flex-direction:column; gap:12px">
        <div class="panel" style="padding:16px">
          <div class="row"><div class="h3">Level ${lv.level}</div><span class="spacer"></span><span class="mute small">${lv.into.toLocaleString()} / ${lv.need.toLocaleString()} XP</span></div>
          <div class="xpbar" style="width:100%; height:8px; margin-top:8px"><i style="width:${(lv.into / lv.need) * 100}%"></i></div>
          <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); margin-top:14px">
            ${[['Races', p.stats.races], ['Wins', p.stats.wins], ['Podiums', p.stats.podiums], ['Drift time', `${Math.round(p.stats.drift)}s`], ['Near misses', p.stats.nearMiss], ['Clean tricks', p.stats.tricks], ['Shunts', p.stats.shunts], ['Distance', `${p.stats.km.toFixed(1)} km`], ['Wallet', naira(p.naira)]].map(([k, v]) => `<div><div class="small mute">${k}</div><div class="h3">${v}</div></div>`).join('')}
          </div>
        </div>
        <div class="panel" style="padding:16px"><div class="h3" style="margin-bottom:8px">Lap records</div>
          ${recs.length ? `<table class="list"><tbody>${recs.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="mono">${fmtTime(v!)}</td></tr>`).join('')}</tbody></table>` : '<div class="mute">Set a lap time in any race and it shows up here.</div>'}
        </div>
        <div class="panel" style="padding:16px"><div class="h3" style="margin-bottom:8px">Badges</div>
          <div class="row" style="flex-wrap:wrap">${badges(app).map(([n, ok]) => `<span class="tag ${ok ? '' : 'dark'}">${ok ? '★ ' : ''}${n}</span>`).join('')}</div>
        </div>
      </div>
    </div>
  </div>`);
  acts(node, {
    back: () => app.back(),
    saveName: () => { const v = (node.querySelector('[data-input=name]') as HTMLInputElement).value.trim().replace(/[^\w .-]/g, '').slice(0, 16); if (v.length < 2) { app.toast('Names need at least two letters'); return; } p.name = v; saveProfile(p); app.toast('Saved'); app.refresh(); },
    crew: (t) => { p.crew = t.dataset.v!; saveProfile(p); app.refresh(); },
    color: (t) => { p.color = t.dataset.v!; saveProfile(p); app.refresh(); },
    copy: () => { void navigator.clipboard?.writeText(friendCode(p)).then(() => app.toast('Friend code copied')).catch(() => app.toast(friendCode(p))); },
  });
  return { el: node, view: 'city' };
}

export function onboarding(app: App): Screen {
  const p = app.profile;
  const touch = app.isTouch;
  const node = el(`<div class="screen" style="align-items:center; justify-content:center; background:rgba(11,11,13,0.75)">
    <div class="panel scroll" style="padding:22px; width:min(560px,100%); display:flex; flex-direction:column; gap:16px; max-height:100%">
      <div class="logo small"><div class="l1">LAGOS</div><div class="l2">RUSH</div><div class="bar stripes"></div></div>
      <div class="h3">Welcome to Oshodi. What do they call you?</div>
      <input class="input" maxlength="16" value="${esc(p.name)}" data-input="name" data-autofocus>
      <div class="field"><span class="lab">Pick a crew</span><div class="seg">${CREWS.slice(0, 6).map((c) => `<button class="${c === p.crew ? 'on' : ''}" data-act="crew" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>
      <div class="panel" style="padding:12px; background:var(--ink2)">
        <div class="h3" style="margin-bottom:6px">How to drive</div>
        ${touch ? `<div class="small">Steer with the pad on the left. The car accelerates for you. <b>DRIFT</b> charges Gbedu through corners, <b>FUEL</b> burns your nitro, <b>ITEM</b> fires what you picked up.</div>`
          : `<div class="small"><b>W A S D</b> or arrows to drive. <b>SPACE</b> to drift and charge Gbedu, release for a boost. <b>SHIFT</b> burns Fuel. <b>E</b> uses your item. <b>C</b> looks back. In the air, steer to spin and press up or down to flip. A gamepad works too.</div>`}
      </div>
      <div class="small mute">We set graphics to <b>${PRESET_LABEL[(p.settings.graphics.preset === 'custom' ? 'medium' : p.settings.graphics.preset)]}</b> for this device. Change it any time in Settings.</div>
      <button class="btn" data-act="go"><span>Let's go</span></button>
    </div>
  </div>`);
  acts(node, {
    crew: (t) => { p.crew = t.dataset.v!; node.querySelectorAll('[data-act=crew]').forEach((b) => b.classList.toggle('on', b === t)); },
    go: () => {
      const v = (node.querySelector('[data-input=name]') as HTMLInputElement).value.trim().replace(/[^\w .-]/g, '').slice(0, 16);
      if (v.length >= 2) p.name = v;
      p.onboarded = true; saveProfile(p, true);
      app.show(mainMenu, true);
      app.consumeInvite();
    },
  });
  return { el: node, view: 'city' };
}
