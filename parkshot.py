# parkshot.py: find motor parks near a point and shoot the nearest ones.
# usage: parkshot.py url outdir x z hour [n]
import sys, time, os, json
from playwright.sync_api import sync_playwright
url, out, x, z, hour = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
n = int(sys.argv[6]) if len(sys.argv) > 6 else 2
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 960, "height": 540}); logs = []
    pg.on("pageerror", lambda e: logs.append("ERR " + str(e)[:400])); pg.on("console", lambda m: logs.append(m.type + ': ' + m.text[:200]) if m.type == 'error' else None)
    pg.goto(url); t0 = time.time()
    while time.time() - t0 < 400:
        time.sleep(2)
        try:
            if pg.evaluate("!!(window.__hl && window.__agbero && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    print('ready', f'{time.time()-t0:.0f}s', flush=True)
    pg.evaluate("""(a) => { const hl = window.__hl, v = hl.view, at = v.atmo; if (!at.__frozen) { const o = at.update.bind(at); at.update = (dt, f, c) => o(dt, f, c, 0); at.__frozen = true; } at.hour = a.hour; at.envT = 99;
      hl.sim.maxPeds = 0; hl.sim.maxTraffic = 0; hl.sim.maxParked = 0; const cv = v.renderer.domElement; document.querySelectorAll('body > *').forEach((e) => { if (e !== cv && !e.contains(cv) && e.tagName !== 'SCRIPT') e.style.display = 'none'; });
      const me = hl.sim.local; me.pos = { x: a.x, y: 0.05, z: a.z }; me.body.setTranslation({ x: a.x, y: 1, z: a.z }, true); }""", {"x": x, "z": z, "hour": hour})
    parks = []
    for i in range(60):
        pg.evaluate("([x, z]) => { window.__hl.view.world.update(x, z, true); }", [x, z]); time.sleep(1.5)
        parks = pg.evaluate("() => [...window.__agbero.parks.values()].map((p) => ({ id: p.id, x: p.x, z: p.z, site: p.site ? { x: p.site.x, z: p.site.z, ang: p.site.ang, hl: p.site.hl, hw: p.site.hw } : null, name: p.name }))")
        if parks: break
    parks.sort(key=lambda q: (q['x'] - x) ** 2 + (q['z'] - z) ** 2); print(json.dumps(parks[:5]), flush=True)
    for i, pk in enumerate(parks[:n]):
        s = pk['site'] or {'x': pk['x'], 'z': pk['z'], 'ang': 0, 'hl': 10, 'hw': 6}
        pg.evaluate("""async (a) => { const hl = window.__hl, v = hl.view, me = hl.sim.local; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          me.pos = { x: a.x, y: 0.05, z: a.z }; me.body.setTranslation({ x: a.x, y: 1, z: a.z }, true);
          let st = 0, last = -1; for (let k = 0; k < 600 && st < 8; k++) { v.world.update(a.x, a.z, true); await sleep(40); const n = v.world.tiles.size; if (!v.world.job && n === last) st++; else st = 0; last = n; }
          const f0 = window.__w.frames; while (window.__w.frames < f0 + 80) await sleep(100);
          const ex = a.x + Math.cos(a.ang + 0.9) * 15, ez = a.z + Math.sin(a.ang + 0.9) * 15; const dx = a.x - ex, dz = a.z - ez; const L = Math.hypot(dx, dz);
          v.debugCam = { x: ex, y: 3.2, z: ez, tx: a.x, ty: 1.2, tz: a.z, fov: 62 }; v.atmo.shadowDirty = true; }""", {"x": s['x'], "z": s['z'], "ang": s['ang']})
        f0 = pg.evaluate("window.__w.frames"); t1 = time.time()
        while time.time() - t1 < 120 and pg.evaluate("window.__w.frames") < f0 + 8: time.sleep(1)
        pg.screenshot(path=f"{out}/park{i}.png", timeout=180000); print('shot', i, pk['name'], flush=True)
    print('\n'.join(logs[:8])); b.close()
