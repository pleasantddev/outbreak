# Bench: bench.py "<url>" label [w h] [secs]. Instruments the running game, walks the player forward through streaming,
# and prints per-subsystem CPU ms/frame, draw calls, triangles, tile build ms, heap churn. Works on old and new code.
import sys, time, json
from playwright.sync_api import sync_playwright
url, label = sys.argv[1], sys.argv[2]
w, h = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (480, 270)
secs = float(sys.argv[5]) if len(sys.argv) > 5 else 40
INSTR = r"""
(() => {
  const v = __hl.view, sim = __hl.sim, r = v.renderer, I = r.info; I.autoReset = false;
  const S = window.__B = { frames: 0, calls: 0, tris: 0, sec: {}, maxFrame: 0, tiles: [], heapUp: 0, lastHeap: 0, shot: 0, last: performance.now(), gaps: [] };
  const wrap = (obj, name, key) => { const o = obj[name]; if (!o || o.__w) return; const f = function (...a) { const t = performance.now(); const x = o.apply(this, a); const e = performance.now() - t; const q = S.sec[key] || (S.sec[key] = { ms: 0, n: 0, max: 0 }); q.ms += e; q.n++; if (e > q.max) q.max = e; return x; }; f.__w = true; obj[name] = f; };
  wrap(v, 'frame', 'view.frame'); wrap(v.world, 'update', 'world.update'); wrap(v.world, 'buildTile', 'world.buildTile'); wrap(v.atmo, 'update', 'atmo.update'); wrap(v.fx, 'update', 'fx.update'); wrap(sim, 'step', 'sim.step'); wrap(sim.phys, 'step', 'phys.step');
  wrap(v, 'updateCrowd', 'crowd');
  wrap(v.composer, 'render', 'composer.render');
  const av = [...v.actors.values()][0]; if (av) wrap(Object.getPrototypeOf(av.view), 'update', 'human.update');
  const oc = v.composer.render; v.composer.render = function (dt) { I.reset(); const x = oc.call(this, dt); S.frames++; S.calls += I.render.calls; S.tris += I.render.triangles; const n = performance.now(); S.gaps.push(n - S.last); S.last = n; const hp = performance.memory ? performance.memory.usedJSHeapSize : 0; if (hp > S.lastHeap && S.lastHeap) S.heapUp += hp - S.lastHeap; S.lastHeap = hp; return x; };
  if (__hl.hud && __hl.hud.drawRadar) wrap(__hl.hud, 'drawRadar', 'hud.drawRadar'); if (__hl.hud && __hl.hud.update) wrap(__hl.hud, 'update', 'hud.update');
  // walk forward in sim time while the real loop renders
  window.__walk = setInterval(() => { try { sim.local.yaw = 0.6; __hl.simulate(0.5, { mz: 1, sprint: true, yaw: 0.6 }); } catch (e) {} }, 500);
  return 'instrumented';
})()
"""
COLLECT = r"""
(() => { clearInterval(window.__walk); const S = window.__B, v = __hl.view, I = v.renderer.info; const sec = {}; for (const k in S.sec) { const q = S.sec[k]; sec[k] = { perFrameMs: +(q.ms / Math.max(1, S.frames)).toFixed(3), calls: q.n, avgMs: +(q.ms / Math.max(1, q.n)).toFixed(2), maxMs: +q.max.toFixed(1) }; }
  return { frames: S.frames, callsPerFrame: +(S.calls / Math.max(1, S.frames)).toFixed(1), trisPerFrame: Math.round(S.tris / Math.max(1, S.frames)), sections: sec, heapAllocKBperFrame: +(S.heapUp / 1024 / Math.max(1, S.frames)).toFixed(1), geoms: I.memory.geometries, textures: I.memory.textures, programs: I.programs.length, tiles: v.world.tiles.size, actors: v.actors.size, cars: v.cars.size, heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), pos: [__hl.sim.local.pos.x | 0, __hl.sim.local.pos.z | 0] }; })()
"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--enable-precise-memory-info"])
    pg = b.new_page(viewport={"width": w, "height": h})
    logs=[]; pg.on("console", lambda m: logs.append(m.type+': '+m.text[:300])); pg.on("pageerror", lambda e: logs.append("ERR "+str(e)[:500]))
    t0=time.time(); pg.goto(url)
    while time.time()-t0 < 400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    print(label, 'ready', f'{time.time()-t0:.1f}s')
    time.sleep(4)
    print(pg.evaluate(INSTR))
    time.sleep(secs)
    res = pg.evaluate(COLLECT)
    print(json.dumps(res, indent=1))
    json.dump(res, open(f'/tmp/bench_{label}.json', 'w'))
    print('\n'.join([l for l in logs if 'ERR' in l or l.startswith('error')][:10]))
    b.close()
