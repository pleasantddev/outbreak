# intshot.py: enter venue interiors from the console and take a screenshot of each.
# usage: intshot.py url out_dir hour venue[,venue...] [w h]
import sys, time, os
from playwright.sync_api import sync_playwright
url, out, hour, names = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4].split(',')
w, h = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (960, 540)
os.makedirs(out, exist_ok=True)
CAMS = {'power': (0, 2.8, 2.0, 0, 2.2, 14), 'home': (1.2, 2.3, 3.4, 4.0, 0.7, 6.6), 'casino': (0, 2.2, 0.6, 0, 1.2, 10)}
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": w, "height": h}); logs = []
    pg.on("pageerror", lambda e: logs.append("ERR " + str(e)[:400]))
    pg.goto(url); t0 = time.time()
    while time.time() - t0 < 400:
        time.sleep(2)
        try:
            if pg.evaluate("!!(window.__hl && window.__life && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    print('ready', f'{time.time()-t0:.0f}s', flush=True)
    pg.evaluate("""(hr) => { const a = window.__hl.view.atmo; if (!a.__frozen) { const o = a.update.bind(a); a.update = (dt, f, c) => o(dt, f, c, 0); a.__frozen = true; } a.hour = hr; a.envT = 99; const sim = window.__hl.sim; sim.cash = 999999; sim.maxPeds = 0; sim.maxTraffic = 0; sim.maxParked = 0;
      const cv = window.__hl.view.renderer.domElement; document.querySelectorAll('body > *').forEach((e) => { if (e !== cv && !e.contains(cv) && e.tagName !== 'SCRIPT') e.style.display = 'none'; }); }""", hour)
    for n0 in names:
        n, _, opt = n0.partition(':')
        if opt == 'off': pg.evaluate("() => { const P = window.__power; P.frame = () => {}; P.set({ on: '0'.repeat(72), gen: 0, load: 0, collapse: true }); }")
        pg.evaluate("(n) => { const L = window.__life; if (n === 'home') L.enter(); else L.enterVenue(L.venues.get(n)); }", n)
        f0 = pg.evaluate('window.__w.frames')
        t1 = time.time()
        while time.time() - t1 < 150 and pg.evaluate('window.__w.frames') < f0 + 30: time.sleep(1)
        if opt == 'lantern': pg.evaluate("() => { const L = window.__life; const k = L.lot.lights[0].clone(); k.color.setHex(0xffc27a); k.intensity = 5.5; k.distance = 6.5; k.decay = 1.7; k.visible = true; k.position.set(2.8, 0.5, 4.0); L.lot.group.add(k); }"); time.sleep(6)
        cam = CAMS.get(n)
        if cam: pg.evaluate("([n, c]) => { const L = window.__life; const O = (n === 'home' ? L.lot : L.venues.get(n).lot).group.position; window.__hl.view.debugCam = { x: O.x + c[0], y: c[1], z: O.z + c[2], tx: O.x + c[3], ty: c[4], tz: O.z + c[5], fov: 70 }; }", [n, cam]); time.sleep(5)
        pg.screenshot(path=f"{out}/{n0.replace(':','_')}.png", timeout=180000); print(n0, flush=True)
    print('\n'.join(logs[:6])); b.close()
