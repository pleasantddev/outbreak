# elevdump.py base_url out.json x,z x,z ... : teleports to each point, waits for the tiles, and dumps every bridge road (name, cls, layer, pts, elev) loaded around it.
import sys, time, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]; pts = [tuple(map(float, a.split(','))) for a in sys.argv[3:]]
GO = """async ([x, z]) => { const hl = window.__hl, v = hl.view, me = hl.sim.local; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  me.pos = { x, y: 0.05, z }; me.body.setTranslation({ x, y: 1, z }, true);
  let stable = 0, last = -1; for (let i = 0; i < 900 && stable < 8; i++) { v.world.update(x, z, true); await sleep(40); const n = v.world.tiles.size; if (!v.world.job && n === last) stable++; else stable = 0; last = n; }
  const res = []; for (const t of v.world.tiles.values()) for (const r of t.roads) { if (!(r.flags & 2)) continue; res.push({ id: r.id, name: r.name, cls: r.cls, layer: r.layer, flags: r.flags, w: r.width, pts: Array.from(r.pts, (q) => Math.round(q * 10) / 10), elev: r.elev ? Array.from(r.elev, (q) => Math.round(q * 100) / 100) : null }); }
  return res; }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 320, "height": 200}); pg.goto(url); t0 = time.time()
    while time.time() - t0 < 400:
        time.sleep(2)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    seen = {}
    for q in pts:
        r = pg.evaluate(GO, list(q)); print(q, len(r), flush=True)
        for e in r: seen[(e['id'], e['pts'][0], e['pts'][1])] = e
    json.dump(list(seen.values()), open(out, 'w')); print(len(seen), 'bridge roads')
    b.close()
