# Renders the three loading-screen key art stills from our own game (the crew on a real Lagos street at night).
# usage: python3 keyart.py http://127.0.0.1:5204 [shots=0,1,2] [w=1920] [h=1080] [quality=high]
# Output: v2/public/ui/keyart-N.webp. Re-run after the map data changes so the art matches the world.
import sys, time, os
from playwright.sync_api import sync_playwright
from PIL import Image
base = sys.argv[1]
shots = [int(x) for x in (sys.argv[2] if len(sys.argv) > 2 else '0,1,2').split(',')]
w = int(sys.argv[3]) if len(sys.argv) > 3 else 1920
h = int(sys.argv[4]) if len(sys.argv) > 4 else 1080
q = sys.argv[5] if len(sys.argv) > 5 else 'high'
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v2', 'public', 'ui'); os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    for i in shots:
        b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        pg = b.new_page(viewport={"width": w, "height": h})
        pg.goto(f"{base}/?keyart={i}&q={q}")
        t0 = time.time()
        while time.time() - t0 < 900:
            try:
                if pg.evaluate("!!window.__keyart"): break
            except Exception: pass
            time.sleep(2)
        pg.evaluate("(()=>{const h=__hl; const s=h.stage.site; for(let i=0;i<60;i++) h.view.world.update(s.x,s.z); return h.view.world.tiles.size})()")
        f0 = pg.evaluate("__w.frames")
        while time.time() - t0 < 1500 and pg.evaluate("__w.frames") < f0 + 8: time.sleep(2)
        png = os.path.join(out, f"keyart-{i+1}.png")
        pg.screenshot(path=png, timeout=900000)
        Image.open(png).convert('RGB').save(os.path.join(out, f"keyart-{i+1}.webp"), quality=82, method=6)
        os.remove(png); print('shot', i, f'{time.time()-t0:.0f}s', flush=True)
        b.close()
