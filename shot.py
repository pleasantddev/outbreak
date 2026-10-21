import sys, time
from playwright.sync_api import sync_playwright
url, out, wait = sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 20
acts = sys.argv[4] if len(sys.argv) > 4 else ''
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width":1280,"height":720})
    logs=[]; pg.on("console", lambda m: logs.append(m.type+': '+m.text[:300])); pg.on("pageerror", lambda e: logs.append("ERR "+str(e)[:400]))
    pg.goto(url); time.sleep(wait)
    for a in acts.split(';'):
        if not a: continue
        k, d = a.split(':'); 
        if k == 'wait': time.sleep(float(d)); continue
        pg.keyboard.down(k); time.sleep(float(d)); pg.keyboard.up(k)
    print(pg.evaluate("window.__hl ? JSON.stringify({fps: window.__hl.fps, t: window.__hl.atmo.timeString(), w: window.__hl.atmo.weatherLabel}) : 'no hl'"))
    pg.screenshot(path=out, timeout=120000)
    print('\n'.join([l for l in logs if 'ERR' in l or l.startswith('error')][:15]))
    b.close()
