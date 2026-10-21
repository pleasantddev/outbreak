# Front-end screenshots: fresh browser, scripted JS steps with waits, screenshots. usage: front.py url out_prefix steps.json w h [init_storage.json]
import sys, time, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]; steps = json.load(open(sys.argv[3]))
w, h = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (1280, 720)
init = json.load(open(sys.argv[6])) if len(sys.argv) > 6 else {}
touch = w < 1000 and '--touch' in sys.argv
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=False, device_scale_factor=1)
    if init: ctx.add_init_script("for (const [k,v] of Object.entries(%s)) { try { if (localStorage.getItem(k) === null) localStorage.setItem(k, v) } catch(e){} }" % json.dumps(init))
    pg = ctx.new_page()
    logs=[]; pg.on("console", lambda m: (logs.append(m.type+": "+m.text[:300]), print("LOG", m.type, m.text[:200], flush=True))); pg.on("pageerror", lambda e: logs.append("ERR "+str(e)[:800]))
    pg.goto(url); t0=time.time()
    for i, st in enumerate(steps):
        if 'waitfor' in st:
            t1=time.time()
            while time.time()-t1 < st.get('max', 240):
                try:
                    if pg.evaluate(st['waitfor']): break
                except Exception: pass
                if any(l.startswith('ERR') for l in logs): break
                time.sleep(1.5)
            print(i, 'waited', f'{time.time()-t1:.0f}s total {time.time()-t0:.0f}s')
        if 'js' in st:
            try: r = pg.evaluate(st['js']); print(i, 'js ->', str(r)[:400])
            except Exception as e: print(i, 'js error', str(e)[:300])
        if 'keys' in st:
            for k in st['keys']: pg.keyboard.press(k); time.sleep(0.25)
        if 'type' in st: pg.keyboard.type(st['type'], delay=40)
        if 'click' in st:
            try: pg.click(st['click'], timeout=8000)
            except Exception as e: print(i, 'click error', str(e)[:200])
        if 'jsclick' in st: print(i, 'jsclick', pg.evaluate('(s)=>{const e=document.querySelector(s); if(e){e.click(); return 1} return 0}', st['jsclick']))
        if 'wait' in st: time.sleep(st['wait'])
        if st.get('shot'):
            time.sleep(st.get('settle', 2)); pg.screenshot(path=f"{out}_{st['shot']}.png", timeout=900000); print(i, 'shot', st['shot'])
    print('\n'.join([l for l in logs if 'ERR' in l or l.startswith('error') or 'warn' in l][:25]))
    b.close()
