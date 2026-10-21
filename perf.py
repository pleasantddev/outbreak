# Perf probe: perf.py url steps.json [w h]. Like play.py but prints js results in full and tolerates long evals.
import sys, time, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]; steps = json.load(open(sys.argv[2]))
w, h = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (960, 540)
out = sys.argv[5] if len(sys.argv) > 5 else '/tmp/perf'
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--enable-precise-memory-info"])
    pg = b.new_page(viewport={"width": w, "height": h})
    logs=[]; pg.on("console", lambda m: logs.append(m.type+': '+m.text[:600])); pg.on("pageerror", lambda e: logs.append("ERR "+str(e)[:800]))
    t0=time.time(); pg.goto(url)
    while time.time()-t0 < 400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
        if any(l.startswith('ERR') for l in logs): break
    print('ready', f'{time.time()-t0:.1f}s')
    for i, st in enumerate(steps):
        if 'js' in st:
            try: r = pg.evaluate(st['js']); print(i, 'js ->', r if isinstance(r,str) else json.dumps(r))
            except Exception as e: print(i, 'js error', str(e)[:500])
        if 'wait' in st: time.sleep(st['wait'])
        if st.get('shot'):
            time.sleep(st.get('settle', 2)); pg.screenshot(path=f"{out}_{st['shot']}.png", timeout=180000); print(i, 'shot', st['shot'])
    print('\n'.join([l for l in logs if 'ERR' in l or l.startswith('error') or l.startswith('warn') or 'PERF' in l][:30]))
    b.close()
