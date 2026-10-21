import sys, time, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]; wait_tiles = int(sys.argv[3]) if len(sys.argv) > 3 else 6; maxwait = float(sys.argv[4]) if len(sys.argv) > 4 else 240
w, h = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (1280, 720)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": w, "height": h})
    logs=[]; pg.on("console", lambda m: logs.append(m.type+': '+m.text[:400])); pg.on("pageerror", lambda e: logs.append("ERR "+str(e)[:600]))
    pg.goto(url); t0 = time.time(); last = -1
    while time.time() - t0 < maxwait:
        time.sleep(3)
        try: st = pg.evaluate("window.__w ? JSON.stringify({t: window.__w.tiles, f: window.__w.frames}) : 'null'")
        except Exception as e: st = str(e)[:100]
        if st != 'null' and json.loads(st)['t'] >= wait_tiles: break
        if any(l.startswith('ERR') for l in logs): break
    print('state', st, f'{time.time()-t0:.0f}s')
    time.sleep(2)
    pg.screenshot(path=out, timeout=180000)
    print("\n".join([l for l in logs if "ERR" in l or l.startswith("error") or "warn" in l or l.startswith("log")][:20]))
    b.close()
