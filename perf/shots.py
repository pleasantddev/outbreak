# shots.py url out_prefix [w h dsf] : in-game review shots from fixed debug cameras (street level, rooftop, driving view, night)
import sys, time, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
w, h = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (960, 540)
dsf = float(sys.argv[5]) if len(sys.argv) > 5 else 1
SHOTS = json.loads(sys.argv[6]) if len(sys.argv) > 6 else [
  {"n": "oshodi", "x": 868, "z": -262, "yaw": 0.6, "t": 15},
  {"n": "dense", "x": 1000, "z": 3000, "yaw": 1.0, "t": 16.5},
  {"n": "dusk", "x": 868, "z": -262, "yaw": 2.4, "t": 18.4},
  {"n": "night", "x": 1000, "z": 3000, "yaw": 0.2, "t": 21.5},
]
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=dsf)
    logs=[]; pg.on("console", lambda m: logs.append(m.type+': '+m.text[:300])); pg.on("pageerror", lambda e: logs.append("ERR "+str(e)[:500]))
    t0=time.time(); pg.goto(url)
    while time.time()-t0 < 400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    for s in SHOTS:
        pg.evaluate(f"(() => {{ const h = __hl, m = h.sim.local; m.pos = {{x: {s['x']}, y: 0.05, z: {s['z']}}}; m.body.setTranslation({{x: {s['x']}, y: 1, z: {s['z']}}}, true); h.view.atmo.lockedWeather = true; h.view.atmo.setWeather('clear'); h.view.atmo.hour = {s.get('t',15)}; }})()")
        last, same = -1, 0
        for _ in range(40):
            n = pg.evaluate(f"(() => {{ for (let i = 0; i < 40; i++) __hl.view.world.update({s['x']}, {s['z']}, true); return __hl.view.world.tiles.size; }})()")
            time.sleep(1.5); same = same + 1 if n == last else 0; last = n
            if same >= 3: break
        pg.evaluate("__hl.simulate(15)")
        yaw = s.get('yaw', 0); hh = s.get('h', 2.4); back = s.get('back', 7)
        pg.evaluate(f"(() => {{ const dx = Math.sin({yaw}), dz = Math.cos({yaw}); __hl.view.debugCam = {{ x: {s['x']} - dx * {back}, y: {hh}, z: {s['z']} - dz * {back}, tx: {s['x']} + dx * 25, ty: 1.6, tz: {s['z']} + dz * 25 }}; }})()")
        f0 = pg.evaluate("__w.frames")
        t1 = time.time()
        while pg.evaluate("__w.frames") < f0 + 4 and time.time() - t1 < 240: time.sleep(1)
        pg.screenshot(path=f"{out}_{s['n']}.png", timeout=240000); print('shot', s['n'], f'{time.time()-t0:.0f}s', flush=True)
    print('\n'.join([l for l in logs if 'ERR' in l or l.startswith('error')][:10]))
    b.close()
