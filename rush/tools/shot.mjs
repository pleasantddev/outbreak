// Screenshot helper: node tools/shot.mjs <url> <outdir> <views.json> [w] [h]
// views: [{ "name": "t3", "cam": [x,y,z], "at": [x,y,z], "fov": 60, "time": "noon", "weather": "clear" }]
import { chromium } from 'playwright';
import fs from 'node:fs';
const [,, url, outdir, viewsFile, w = '1280', h = '720'] = process.argv;
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
fs.mkdirSync(outdir, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 400)));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(url);
await p.waitForFunction('window.__ready', null, { timeout: 180000 });
for (const v of views) {
  if (v.time) await p.evaluate(([t, wx]) => window.__atmos(t, wx), [v.time, v.weather ?? 'clear']);
  if (v.cam) await p.evaluate(([c, a, f]) => window.__cam(c, a, f), [v.cam, v.at, v.fov ?? 62]);
  await p.waitForTimeout(v.wait ?? 2500);
  await p.screenshot({ path: `${outdir}/${v.name}.png` });
  const perf = await p.evaluate(() => window.__perf && window.__perf());
  console.log('shot', v.name, JSON.stringify(perf));
}
await b.close();
