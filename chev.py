# chev.py url out.png [walk|drive]: starts a job, waits for the route, and looks along it from behind the player
import sys, time
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 960, "height": 540}); logs=[]; pg.on("pageerror", lambda e: logs.append(str(e)[:300]))
    pg.goto(url); t0=time.time()
    while time.time()-t0 < 400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    pg.evaluate("document.querySelectorAll('body > *:not(canvas)').forEach((e) => (e.style.display = 'none'))")
    pg.evaluate("() => __hl.startJob('delivery')")
    for i in range(80):
        time.sleep(1)
        if pg.evaluate("__hl.guide.remaining.length > 8"): break
    r = pg.evaluate("""() => { const g = __hl.guide, me = __hl.sim.local, v = __hl.view; const p = g.remaining; let k = 2; let tx = p[2*Math.min(3, p.length/2-1)], tz = p[2*Math.min(3, p.length/2-1)+1];
      const dx = tx - p[0], dz = tz - p[1]; const L = Math.hypot(dx, dz) || 1;
      v.debugCam = { x: p[0] - dx/L*7, y: 3.6, z: p[1] - dz/L*7, tx: p[0] + dx/L*22, ty: 0, tz: p[1] + dz/L*22, fov: 62 };
      return { n: p.length/2, left: g.left, p0: [p[0], p[1]], t: [tx, tz] }; }""")
    print(r)
    f0 = pg.evaluate("window.__w.frames"); t0=time.time()
    while time.time()-t0 < 120 and pg.evaluate("window.__w.frames") < f0 + 4: time.sleep(0.5)
    pg.screenshot(path=out, timeout=400000); print('\n'.join(logs[:5])); b.close()
