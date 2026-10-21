# regress.py url: scripted playthrough: spawn, walk, take a job, jack a car, drive the GPS route to the marker, LANDMAP, phone.
import sys, time, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 640, "height": 360}); logs=[]
    pg.on("console", lambda m: logs.append(m.type+': '+m.text[:300])); pg.on("pageerror", lambda e: logs.append("ERR "+str(e)[:500]))
    t0=time.time(); pg.goto(url)
    while time.time()-t0 < 400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    print('spawn ok', round(time.time()-t0), 's;', pg.evaluate("({x: __hl.sim.local.pos.x|0, z: __hl.sim.local.pos.z|0, alive: __hl.sim.local.alive, tiles: __hl.view.world.tiles.size})"))
    print('walk:', pg.evaluate("(() => { const m = __hl.sim.local, x = m.pos.x, z = m.pos.z; __hl.simulate(3, { mz: 1 }); return Math.round(Math.hypot(m.pos.x - x, m.pos.z - z) * 10) / 10 + ' m in 3 s'; })()"))
    pg.evaluate("__hl.job('delivery')")
    for i in range(60):
        time.sleep(1)
        if pg.evaluate("__hl.guide.remaining.length > 4"): break
    print('job route:', pg.evaluate("({ pts: __hl.guide.remaining.length / 2, left: Math.round(__hl.guide.left), lost: __hl.guide.lost, mode: __hl.guide.mode, ms: __hl.guide.lastMs })"))
    # jack the nearest car
    print('jack:', pg.evaluate("""(() => { const s = __hl.sim, me = s.local; const car = __hl.stoppedCar() || __hl.nearestCar(); if (!car) return 'no car'; const p = car.body.translation(); me.pos = { x: p.x + 2.2, y: 0.05, z: p.z }; me.body.setTranslation({ x: p.x + 2.2, y: 1, z: p.z }, true);
      const ok = s.enterVehicle(me, car, true); __hl.simulate(0.5); return { ok, kind: car.kind, inCar: me.vehicle !== null, seat: me.seat }; })()"""))
    time.sleep(3)
    print('route as driver:', pg.evaluate("({ pts: __hl.guide.remaining.length / 2, left: Math.round(__hl.guide.left), mode: __hl.guide.mode, computes: __hl.guide.computes })"))
    # pursuit controller along the route
    drive = """() => { const s = __hl.sim, me = s.local, g = __hl.guide; if (me.vehicle === null) return 'not in car'; const v = s.vehicles[me.vehicle]; const t = v.body.translation(), r = v.body.rotation(); g.update(0.25, t.x, t.z, 'drive', g.goal);
      const fw = { x: 2 * (r.x * r.z + r.w * r.y), z: 1 - 2 * (r.x * r.x + r.y * r.y) }; const have = Math.atan2(fw.x, fw.z);
      const p = g.remaining; let tx = p[p.length - 2], tz = p[p.length - 1]; for (let i = 2; i < p.length; i += 2) { if (Math.hypot(p[i] - t.x, p[i + 1] - t.z) > 13) { tx = p[i]; tz = p[i + 1]; break; } }
      let err = Math.atan2(tx - t.x, tz - t.z) - have; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
      const sp = Math.abs(v.ctrl.currentVehicleSpeed()); const want = Math.abs(err) > 0.7 ? 5 : 12; const mz = sp < want ? 0.8 : 0; const brake = sp > want + 3;
      __hl.simulate(0.25, { mx: Math.max(-1, Math.min(1, -err * 1.8)), mz, jump: brake }); return Math.round(g.left); }"""
    start = pg.evaluate("Math.round(__hl.guide.left)"); last = start; t1 = time.time(); stuck = 0
    for i in range(400):
        left = pg.evaluate(f"({drive})()")
        if left == 'not in car' or left is None: print('left car', left); break
        if left < 20: break
        stuck = stuck + 1 if abs(left - last) < 1 else 0; last = left
        if time.time() - t1 > 240: break
    print('drive: route left', start, '->', left, 'm after', i + 1, 'steps;', pg.evaluate("({ speed: Math.round(Math.abs(__hl.sim.vehicles[__hl.sim.local.vehicle]?.ctrl.currentVehicleSpeed() ?? 0) * 3.6), computes: __hl.guide.computes })"))
    time.sleep(4)
    print('job stage after arrival:', pg.evaluate("__hl.hud && document.querySelector('#title, .title')?.textContent?.slice(0, 40)"))
    print('landmap:', pg.evaluate("(() => { __hl.landmap(); const a = __hl.hud.landmapOn; __hl.landmap(); return 'on=' + a + ' off=' + !__hl.hud.landmapOn; })()"))
    print('phone:', pg.evaluate("(() => { const a = __hl.hud.togglePhone(true); __hl.hud.togglePhone(false); return 'up=' + a; })()"))
    print('\n'.join([l for l in logs if l.startswith('ERR') or l.startswith('error')][:10]) or 'no page errors')
    b.close()
