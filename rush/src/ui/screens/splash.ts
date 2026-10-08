import type { App, Screen } from '../../app/app';
import { el } from '../dom';
import { mainMenu } from './main';
import { onboarding } from './profile';

const TIPS = [
  '<b>GBEDU</b> Hold drift through a corner and steer into it. Let go when the sparks turn pink for the biggest boost.',
  '<b>FUEL</b> Near misses, drifts, airtime and slipstream fill your Fuel. Burn it on the straights.',
  '<b>BRT LANES</b> The red bus lanes are open on race day. Drive on them for free speed.',
  '<b>GHANA MUST GO</b> Drive through the floating bags for an item. Back of the pack gets the big ones.',
  '<b>LAUNCH</b> Hit the gas just before the lights go green for a perfect start. Too early and you bog down.',
  '<b>TOW TRUCK</b> Fell off a bridge? Hold on, the tow truck puts you back on the road.',
  '<b>STUNTS</b> In the air, steer to spin and pitch to flip. Land straight for a boost.',
];

export function splashScreen(app: App): Screen {
  const node = el(`<div class="screen splash">
    <div class="logo"><div class="l1">LAGOS</div><div class="l2">RUSH</div><div class="bar stripes"></div></div>
    <div class="load"><div class="track"><div class="fill"></div></div><div class="label">Starting</div></div>
    <div class="press" style="display:none">PRESS ANY KEY OR TAP</div>
    <div class="tip">${TIPS[Math.floor(Math.random() * TIPS.length)]}</div>
  </div>`);
  const fill = node.querySelector('.fill') as HTMLElement, label = node.querySelector('.label') as HTMLElement, press = node.querySelector('.press') as HTMLElement;
  let ready = false;
  const onProg = (e: Event) => {
    const { f, label: l } = (e as CustomEvent).detail;
    fill.style.width = `${Math.round(f * 100)}%`; label.textContent = l;
    if (f >= 1 && l === 'Ready') { ready = true; node.querySelector<HTMLElement>('.load')!.style.display = 'none'; press.style.display = ''; }
  };
  window.addEventListener('rush-progress', onProg);
  const go = () => {
    if (!ready) return;
    app.audio.unlock();
    app.audio.music_('menu', 0);
    window.removeEventListener('keydown', go); node.removeEventListener('pointerdown', go);
    app.show(app.profile.onboarded ? mainMenu : onboarding, true);
    if (app.profile.onboarded) app.consumeInvite();
  };
  window.addEventListener('keydown', go);
  node.addEventListener('pointerdown', go);
  return { el: node, view: 'city', onLeave: () => { window.removeEventListener('rush-progress', onProg); window.removeEventListener('keydown', go); } };
}
