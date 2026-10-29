# lookshot.py: take a list of camera shots in one browser session.
# usage: lookshot.py base_url shots.json out_dir [w h] [--info]
# shots.json: [{name, x, z, yaw, h, pitch, fov, hour, wait}] ; yaw radians (0 = looking +z), h = camera height m, pitch = degrees down
# The page url should carry ?auto=1&q=low|medium|high&w=clear (weather is set by the url so it does not have to blend).
import sys, time, json, os
from playwright.sync_api import sync_playwright
url, shots_f, out = sys.argv[1], sys.argv[2], sys.argv[3]
w, h = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 and sys.argv[4].isdigit() else (1280, 720)
shots = json.load(open(shots_f)); os.makedirs(out, exist_ok=True)
SETUP = """() => { const hl = window.__hl, v = hl.view, a = v.atmo;
  if (!a.__frozen) { const o = a.update.bind(a); a.update = (dt, f, c) => o(dt, f, c, 0); a.__frozen = true; }
  v.renderer.info.autoReset = false; const hh = document.getElementById('hlhud'); if (hh) hh.style.display = 'none'; document.querySelectorAll('body > div').forEach((e) => { if (!e.querySelector('canvas')) e.style.display = 'none'; });
  hl.sim.maxPeds = 0; hl.sim.maxTraffic = 0; hl.sim.maxParked = 0; v.applyLevel = (function (f) { return function (l) { f.call(v, l); hl.sim.maxPeds = 0; hl.sim.maxTraffic = 0; hl.sim.maxParked = 0; }; })(v.applyLevel); return true; }"""
GO = """async (s) => { const hl = window.__hl, v = hl.view, a = v.atmo, me = hl.sim.local; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  me.pos = { x: s.x, y: 0.05, z: s.z }; me.body.setTranslation({ x: s.x, y: 1, z: s.z }, true);
  if (s.hour !== undefined) { a.hour = s.hour; a.envT = 99; }
  hl.view.gov && 0;
  let stable = 0, last = -1;
  for (let i = 0; i < 900 && stable < 8; i++) { v.world.update(s.x, s.z, true); await sleep(40); const n = v.world.tiles.size; if (!v.world.job && n === last) stable++; else stable = 0; last = n; }
  const dy = Math.tan((s.pitch ?? 8) * Math.PI / 180), yaw = s.yaw ?? 0;
  const eye = { x: s.x + (s.ox ?? 0), y: s.h ?? 1.7, z: s.z + (s.oz ?? 0) };
  v.debugCam = { x: eye.x, y: eye.y, z: eye.z, tx: eye.x + Math.sin(yaw) * 20, ty: eye.y - dy * 20, tz: eye.z + Math.cos(yaw) * 20, fov: s.fov ?? 65 };
  a.shadowDirty = true; return { tiles: v.world.tiles.size, hour: a.hour }; }"""
INFO = """async () => { const hl = window.__hl, v = hl.view; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const f0 = window.__w.frames; while (window.__w.frames < f0 + 3) await sleep(100);
  v.renderer.info.reset(); const f1 = window.__w.frames; while (window.__w.frames < f1 + 1) await sleep(20);
  const i = v.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, progs: i.programs?.length ?? 0, level: v.level }; }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": w, "height": h})
    logs = []; pg.on("console", lambda m: logs.append(m.type + ': ' + m.text[:300])); pg.on("pageerror", lambda e: logs.append("ERR " + str(e)[:600]))
    pg.goto(url); t0 = time.time()
    while time.time() - t0 < 400:
        time.sleep(2)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    print('ready', f'{time.time()-t0:.0f}s'); pg.evaluate(SETUP)
    res = {}
    for s in shots:
        t1 = time.time(); r = pg.evaluate(GO, s)
        time.sleep(s.get('wait', 2.5)); inf = pg.evaluate(INFO)
        pg.screenshot(path=f"{out}/{s['name']}.png", timeout=180000)
        res[s['name']] = inf; print(s['name'], r, inf, f'{time.time()-t1:.0f}s', flush=True)
    json.dump(res, open(f"{out}/info.json", 'w'), indent=1)
    print('\n'.join([l for l in logs if l.startswith('ERR') or l.startswith('error')][:10]))
    b.close()
