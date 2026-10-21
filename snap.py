# Deterministic render-cost snapshot at fixed places: snap.py "<url>" label [w h]. Prints draw calls / triangles per composer.render, programs, textures.
import sys, time, json
from playwright.sync_api import sync_playwright
url, label = sys.argv[1], sys.argv[2]
w, h = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (480, 270)
INSTR = r"""
(() => { const v = __hl.view, I = v.renderer.info; I.autoReset = false;
  window.__SN = { n: 0, calls: 0, tris: 0, lastCalls: 0, lastTris: 0, passes: [] };
  const oc = v.composer.render; v.composer.render = function (dt) { I.reset(); const x = oc.call(this, dt); const S = window.__SN; S.n++; S.lastCalls = I.render.calls; S.lastTris = I.render.triangles; return x; };
  const st = v.world.store; const cells = new Map();
  for (const reg of st.regions.values()) for (const b of reg.buildings) { const k = Math.floor(b.cx / 250) + ',' + Math.floor(b.cz / 250); cells.set(k, (cells.get(k) || 0) + 1); }
  const arr = [...cells.entries()].map(([k, n]) => { const [i, j] = k.split(',').map(Number); return { x: (i + .5) * 250, z: (j + .5) * 250, n }; }).filter(c => Math.hypot(c.x, c.z) < 2500).sort((a, b) => b.n - a.n);
  window.__PLACES = [{ name: 'spawn', x: -38, z: 52 }, { name: 'dense', x: arr[0].x, z: arr[0].z, n: arr[0].n }, { name: 'mid', x: arr[Math.floor(arr.length / 2)].x, z: arr[Math.floor(arr.length / 2)].z, n: arr[Math.floor(arr.length / 2)].n }, { name: 'sparse', x: arr[arr.length - 1].x, z: arr[arr.length - 1].z, n: arr[arr.length - 1].n }];
  return JSON.stringify(window.__PLACES); })()
"""
GO = r"""
(async (i) => { const P = window.__PLACES[i], sim = __hl.sim, v = __hl.view;
  // find a walkway near the place so we stand somewhere real
  await v.world.store.around(P.x, P.z, 1200);
  let best = null, bd = 1e9; const lanes = sim.net.nearWalks(P.x, P.z, 400);
  for (const id of lanes) { const w = sim.net.walks[id]; for (let q = 0; q < w.pts.length; q += 2) { const d = Math.hypot(w.pts[q] - P.x, w.pts[q + 1] - P.z); if (d < bd) { bd = d; best = [w.pts[q], w.pts[q + 1]]; } } }
  const x = best ? best[0] : P.x, z = best ? best[1] : P.z;
  sim.local.pos = { x, y: 0.05, z }; sim.local.body.setTranslation({ x, y: 1, z }, true);
  for (let k = 0; k < 400; k++) { v.world.update(x, z); await new Promise(r => setTimeout(r, 0)); if (k > 30 && k % 20 === 0) { const t = v.world.tiles.size; await new Promise(r => setTimeout(r, 200)); if (t === v.world.tiles.size) break; } }
  __hl.simulate(4);
  await new Promise(r => setTimeout(r, 6000));
  const S = window.__SN; const n0 = S.n; await new Promise(r => setTimeout(r, 7000));
  const I = v.renderer.info;
  return { place: P.name, at: [x | 0, z | 0], bldgs: P.n, tiles: v.world.tiles.size, calls: S.lastCalls, tris: S.lastTris, frames: S.n - n0, programs: I.programs.length, textures: I.memory.textures, geoms: I.memory.geometries, actors: v.actors.size, cars: v.cars.size };
})
"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": w, "height": h})
    logs=[]; pg.on("pageerror", lambda e: logs.append("ERR "+str(e)[:500]))
    t0=time.time(); pg.goto(url)
    while time.time()-t0 < 400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    time.sleep(3)
    print(pg.evaluate(INSTR))
    res = []
    for i in range(4):
        r = pg.evaluate(f"({GO})({i})"); print(json.dumps(r)); res.append(r)
    json.dump(res, open(f'/tmp/snap_{label}.json', 'w'))
    print('\n'.join(logs[:5]))
    b.close()
