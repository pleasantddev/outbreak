# Scripted playtest: run JS steps against window.__hl, screenshot after each. usage: play.py url out_prefix steps.json
import sys, time, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]; steps = json.load(open(sys.argv[3]))
w, h = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (960, 540)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": w, "height": h})
    logs=[]; pg.on("console", lambda m: logs.append(m.type+': '+m.text[:400])); pg.on("pageerror", lambda e: logs.append("ERR "+str(e)[:800]))
    pg.goto(url); t0=time.time()
    while time.time()-t0 < 300:
        time.sleep(2)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
        if any(l.startswith('ERR') for l in logs): break
    print('ready', f'{time.time()-t0:.0f}s')
    for i, st in enumerate(steps):
        if 'js' in st:
            try: r = pg.evaluate(st['js']); print(i, 'js ->', str(r)[:300])
            except Exception as e: print(i, 'js error', str(e)[:300])
        if 'keys' in st:
            for k, d in st['keys']: pg.keyboard.down(k); time.sleep(d); pg.keyboard.up(k)
        if 'wait' in st: time.sleep(st['wait'])
        if st.get('shot'):
            time.sleep(st.get('settle', 3)); pg.screenshot(path=f"{out}_{st['shot']}.png", timeout=180000); print(i, 'shot', st['shot'])
    print('\n'.join([l for l in logs if 'ERR' in l or l.startswith('error')][:20]))
    b.close()
