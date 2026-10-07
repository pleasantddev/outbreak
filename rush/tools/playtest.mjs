// Full-flow playtest in headless Chromium. Drives the real UI with the keyboard and mouse, races with a small bot
// that only presses keys, and saves screenshots plus a JSON report.
//   node tools/playtest.mjs <baseUrl> <outdir> [solo|online|all] [w] [h]
// The base URL should be the room server (npm run server after npm run build), so online play is tested too.
import { chromium } from 'playwright';
import fs from 'node:fs';

const [,, base = 'http://localhost:8787', outdir = 'playtest', which = 'all', W = '1280', H = '720', PRESET = ''] = process.argv;
fs.mkdirSync(outdir, { recursive: true });
const report = { errors: [], steps: [], perf: [] };
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

async function newPlayer(tag, query = '') {
  const ctx = await browser.newContext({ viewport: { width: +W, height: +H } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { report.errors.push(`[${tag}] ${m.type()}: ${m.text().slice(0, 300)}`); } });
  p.on('pageerror', (e) => report.errors.push(`[${tag}] pageerror: ${e.message}`));
  await p.goto(`${base}/${query}`);
  await p.waitForFunction('window.__rushReady === true', null, { timeout: 240000 });
  return p;
}
const shot = async (p, name) => { await p.screenshot({ path: `${outdir}/${name}.png` }); report.steps.push(name); console.log('shot', name); };
const click = (p, sel) => p.locator(sel).first().click();
const perf = (p) => p.evaluate(() => { const e = window.__app.stage.engine.perf; return { fps: e.fps, ms: +e.ms.toFixed(1), calls: e.calls, tris: e.tris, w: e.w, h: e.h, preset: window.__app.stage.engine.settings.preset }; });

/** Press keys toward the road ahead until the race ends or time runs out. Returns the last state seen. */
async function drive(p, seconds, tag) {
  await p.keyboard.down('KeyW');
  let held = '', last = null, nitroT = 0, itemT = 0, stuckSince = 0, towT = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const st = await p.evaluate(() => {
      const s = window.__app.session; if (!s) return { gone: true };
      const c = s.player.c; if (!c.q) return { phase: s.phase };
      const look = 12 + Math.max(0, c.vf) * 0.35;
      const a = s.track.pointAt(c.q.sMain + look, c.q.d * 0.4);
      let err = Math.atan2(a.x - c.x, a.z - c.z) - c.h;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      return { err, phase: s.phase, lap: c.lap, place: c.place, v: c.vf, fin: c.finished, item: c.item, fuel: c.fuel, wall: c.q.outside };
    });
    last = st;
    if (st.gone || st.phase === 'finished') break;
    if (st.phase === 'intro') { await p.keyboard.press('Space'); continue; }
    const want = st.err > 0.04 ? 'KeyA' : st.err < -0.04 ? 'KeyD' : '';
    if (want !== held) { if (held) await p.keyboard.up(held); if (want) await p.keyboard.down(want); held = want; }
    // lift only for tight corners at speed, burn Fuel on the straights, fire items when we have them
    if (Math.abs(st.err) > 0.6 && st.v > 22) await p.keyboard.up('KeyW'); else await p.keyboard.down('KeyW');
    if (st.fuel > 0.5 && Math.abs(st.err) < 0.08 && Date.now() - nitroT > 3000) { nitroT = Date.now(); await p.keyboard.down('ShiftLeft'); setTimeout(() => p.keyboard.up('ShiftLeft').catch(() => {}), 900); }
    if (st.item && Date.now() - itemT > 2500) { itemT = Date.now(); await p.keyboard.down('KeyE'); setTimeout(() => p.keyboard.up('KeyE').catch(() => {}), 160); }
    // wedged against something or pointing the wrong way for a while: call the tow truck, like a player would
    const stuck = st.phase === 'race' && (Math.abs(st.v) < 2 || Math.abs(st.err) > 2.2);
    if (stuck) { stuckSince = stuckSince || Date.now(); if (Date.now() - stuckSince > 3500 && Date.now() - towT > 6000) { towT = Date.now(); stuckSince = 0; await p.keyboard.press('KeyR'); report.tows = (report.tows ?? 0) + 1; } }
    else stuckSince = 0;
  }
  if (held) await p.keyboard.up(held);
  await p.keyboard.up('KeyW');
  console.log(tag, 'drive end', JSON.stringify(last));
  return last;
}

async function solo() {
  const p = await newPlayer('solo');
  await shot(p, '01-splash');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
  if (await p.locator('[data-input=name]').count()) {
    await shot(p, '02-onboarding');
    await p.fill('[data-input=name]', 'Tunde');
    await click(p, '[data-act=go]');
    await p.waitForTimeout(900);
  }
  if (PRESET) {
    await click(p, '[data-act=settings]'); await p.waitForTimeout(500);
    await click(p, `[data-act=preset][data-v=${PRESET}]`); await p.waitForTimeout(300);
    await p.keyboard.press('Escape'); await p.waitForTimeout(2500);
  }
  await shot(p, '03-main-menu');
  for (let k = 1; k <= 3; k++) { await p.waitForTimeout(9200); await shot(p, `03-main-menu-${k}`); }
  report.perf.push({ at: 'menu', ...(await perf(p)) });
  await click(p, '[data-act=garage]'); await p.waitForTimeout(2500); await shot(p, '04-garage');
  await click(p, '[data-act=tab][data-v=paint]').catch(() => {}); await p.waitForTimeout(1200); await shot(p, '04-garage-paint');
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  await click(p, '[data-act=lagos]'); await p.waitForTimeout(1500); await shot(p, '05-lagos-map');
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  await click(p, '[data-act=career]'); await p.waitForTimeout(900); await shot(p, '06-career');
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  await click(p, '[data-act=settings]'); await p.waitForTimeout(900); await shot(p, '07-settings');
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  await click(p, '[data-act=race]'); await p.waitForTimeout(900);
  await click(p, '[data-act=seg][data-k=Laps][data-v="1"]'); await p.waitForTimeout(300);
  await click(p, '[data-act=seg][data-k=Opponents][data-v="7"]'); await p.waitForTimeout(300);
  await shot(p, '08-quick-race');
  await click(p, '[data-act=start]');
  await p.waitForTimeout(2500);
  await shot(p, '09-intro');
  await p.keyboard.press('Space');
  await p.waitForTimeout(1200);
  await shot(p, '10-grid');
  // countdown, then race
  await p.waitForFunction(() => window.__app.session && window.__app.session.sim.time > -0.3, null, { timeout: 30000 });
  // drive with real key presses for a while, then let the autopilot bring the car home so results and the
  // replay get tested every run
  const go = drive(p, 45, 'solo');
  await p.waitForTimeout(9000); await shot(p, '11-racing');
  report.perf.push({ at: 'race', ...(await perf(p)) });
  await p.waitForTimeout(12000); await shot(p, '12-racing-later');
  const end = await go;
  report.soloEnd = end;
  // software rendering in a container runs the race far below real time, so hand the car to the autopilot and
  // fast forward; the replay still records every step
  await p.evaluate(() => { const s = window.__app.session; if (s) { s.sim.cars[s.sim.cars.findIndex((c) => c.entrant.id === window.__app.profile.id)].autoDrive = true; s.warp = 12; } });
  await p.waitForFunction(() => document.querySelector('.results'), null, { timeout: 600000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await shot(p, '13-results');
  // replay
  if (await p.locator('[data-act=replay]').count()) {
    await click(p, '[data-act=replay]');
    await p.waitForTimeout(3000); await shot(p, '14-replay-tv');
    await p.keyboard.press('KeyC'); await p.waitForTimeout(1500); await shot(p, '15-replay-chase');
    await p.keyboard.press('KeyC'); await p.waitForTimeout(1500); await shot(p, '16-replay-heli');
    await p.keyboard.press('Escape'); await p.waitForTimeout(1200); await shot(p, '17-back-to-results');
  }
  await p.context().close();
}

async function setPreset(p, preset) {
  if (!preset) return;
  await click(p, '[data-act=settings]'); await p.waitForTimeout(500);
  await click(p, `[data-act=preset][data-v=${preset}]`); await p.waitForTimeout(300);
  await p.keyboard.press('Escape'); await p.waitForTimeout(1200);
}

async function online() {
  const a = await newPlayer('A', PRESET ? `?gfx=${PRESET}` : '');
  await a.keyboard.press('Enter'); await a.waitForTimeout(800);
  if (await a.locator('[data-input=name]').count()) { await a.fill('[data-input=name]', 'Adaeze'); await click(a, '[data-act=go]'); await a.waitForTimeout(800); }

  await click(a, '[data-act=online]'); await a.waitForTimeout(1500);
  await shot(a, '20-multiplayer');
  await click(a, '[data-act=create]'); await a.waitForTimeout(800);
  await click(a, '[data-act=cfg][data-k=laps][data-v="1"]'); await a.waitForTimeout(200);
  await click(a, '[data-act=cfg][data-k=aiFill][data-v="3"]'); await a.waitForTimeout(200);
  await shot(a, '21-create-room');
  await click(a, '[data-act=create]');
  await a.waitForSelector('.lobby-code', { timeout: 15000 });
  const code = (await a.locator('.lobby-code').first().textContent()).trim();
  console.log('room', code);
  // B follows an invite link straight into the room
  const b = await newPlayer('B', `?room=${code}${PRESET ? `&gfx=${PRESET}` : ''}`);
  await b.keyboard.press('Enter'); await b.waitForTimeout(800);
  if (await b.locator('[data-input=name]').count()) { await b.fill('[data-input=name]', 'Kola'); await click(b, '[data-act=go]'); }
  await b.waitForSelector('.lobby-code', { timeout: 20000 });

  await a.waitForTimeout(800);
  await shot(a, '22-lobby-host');
  await shot(b, '23-lobby-guest');
  await click(b, '[data-act=ready]'); await b.waitForTimeout(500);
  await click(a, '[data-act=start]');
  await a.waitForFunction(() => window.__app.session, null, { timeout: 20000 });
  await b.waitForFunction(() => window.__app.session, null, { timeout: 20000 });
  await a.waitForTimeout(1500);
  await shot(a, '24-online-grid');
  await a.waitForFunction(() => window.__app.session && window.__app.session.sim.time > 0, null, { timeout: 30000 });
  const da = drive(a, 300, 'A'), db = drive(b, 300, 'B');
  await a.waitForTimeout(10000);
  await shot(a, '25-online-A'); await shot(b, '26-online-B');
  report.onlineMid = await a.evaluate(() => { const s = window.__app.session; return s ? s.sim.cars.map((r) => ({ n: r.entrant.name, ctl: r.control, x: +r.c.x.toFixed(1), z: +r.c.z.toFixed(1), lap: r.c.lap })) : null; });
  await Promise.all([da, db]);
  await a.waitForSelector('.results', { timeout: 120000 }).catch(() => {});
  await b.waitForSelector('.results', { timeout: 120000 }).catch(() => {});
  await a.waitForTimeout(1500);
  await shot(a, '27-online-results-A'); await shot(b, '28-online-results-B');
  await click(a, '[data-act=lobby]'); await a.waitForTimeout(1500); await shot(a, '29-back-in-lobby');
  await a.context().close(); await b.context().close();
}

try {
  if (which === 'solo' || which === 'all') await solo();
  if (which === 'online' || which === 'all') await online();
} catch (e) {
  report.errors.push(`script: ${e.message}`);
  console.log('FAILED', e);
} finally {
  fs.writeFileSync(`${outdir}/report.json`, JSON.stringify(report, null, 2));
  console.log('errors', report.errors.length);
  for (const e of report.errors.slice(0, 30)) console.log(' ', e);
  await browser.close();
}
