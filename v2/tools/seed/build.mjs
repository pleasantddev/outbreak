// node tools/seed/build.mjs   (from v2/)   Writes public/content/{places,routes,skills,missions,events}.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { PLACES } from './places.mjs';
import { ROUTES } from './routes.mjs';
import { SKILLS } from './skills.mjs';
const groups = [];
for (const f of ['m_transport', 'm_delivery', 'm_trade', 'm_mechanic', 'm_land', 'm_police', 'm_bank', 'm_racing', 'm_crime', 'm_community', 'm_student']) {
  try { const mod = await import(`./${f}.mjs`); groups.push(...Object.values(mod).flat()); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
}
let EVENTS = []; try { EVENTS = (await import('./events.mjs')).EVENTS; } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
const out = new URL('../../public/content/', import.meta.url);
mkdirSync(out, { recursive: true });
const w = (name, items) => writeFileSync(new URL(name + '.json', out), JSON.stringify({ version: 1, items }, null, 1) + '\n');
w('places', PLACES); w('routes', ROUTES); w('skills', SKILLS); w('missions', groups); w('events', EVENTS);
console.log({ places: PLACES.length, routes: ROUTES.length, skills: SKILLS.length, missions: groups.length, events: EVENTS.length });
