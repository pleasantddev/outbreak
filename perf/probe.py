# probe.py url label [w h] [poses]: loads the game, halts the rAF loop, then measures draw calls, triangles (per pass and category),
# JS-side CPU cost of a frame with the GPU draws stubbed out, and streaming task lengths. Writes /tmp/claude-0/probe_<label>.json
import sys, time, json, os
from playwright.sync_api import sync_playwright
url, label = sys.argv[1], sys.argv[2]
w, h = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (640, 360)
HERE = os.path.dirname(os.path.abspath(__file__))
POSES = [
  {"name": "oshodi", "x": 868, "z": -262, "yaw": 0.6},
]
if len(sys.argv) > 5: POSES = json.loads(open(sys.argv[5]).read())
out = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--enable-precise-memory-info","--js-flags=--expose-gc"])
    pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
    logs=[]; pg.on("console", lambda m: logs.append(m.type+': '+m.text[:300])); pg.on("pageerror", lambda e: logs.append("ERR "+str(e)[:500]))
    t0=time.time(); pg.goto(url)
    while time.time()-t0 < 400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    print(label, 'ready', f'{time.time()-t0:.1f}s')
    pg.evaluate(open(os.path.join(HERE, 'probe.js')).read())
    pg.evaluate("window.__P.halt()"); time.sleep(8)
    for pose in POSES:
        r = {}
        pg.evaluate(f"(() => {{ const s = __hl.sim, m = s.local; m.pos = {{x: {pose['x']}, y: 0.05, z: {pose['z']}}}; m.body.setTranslation({{x: {pose['x']}, y: 1, z: {pose['z']}}}, true); m.yaw = {pose.get('yaw',0)}; }})()")
        pg.evaluate(f"__P.settle({pose['x']}, {pose['z']})")
        last, same, t1 = -1, 0, time.time()
        while time.time() - t1 < 120 and same < 4:
            time.sleep(1.5); n = pg.evaluate(f"__P.settle({pose['x']}, {pose['z']})")
            same = same + 1 if n == last else 0; last = n
        pg.evaluate(f"__P.cam({pose['x']}, {pose['z']}, {pose.get('yaw',0)})")
        # a few frames so cars/actors exist
        pg.evaluate("(() => { __hl.simulate(25); })()")
        pg.evaluate("__P.stub(true); for (let i=0;i<4;i++) __hl.view.frame(1/60); __P.stub(false)")
        r['scan'] = pg.evaluate("__P.scan(false)")
        r['scanShadow'] = pg.evaluate("__P.scan(true)")
        r['cpuRender'] = pg.evaluate("__P.cpuRender(12)")
        r['cpuFrame'] = pg.evaluate("__P.cpuFrame(30)")
        r['info'] = pg.evaluate("__P.info()")
        r['top'] = pg.evaluate("__P.top(12)")
        # streaming: jump 420 m east then measure the non-burst catch up
        r['stream'] = pg.evaluate(f"__P.stream({pose['x']+420}, {pose['z']})")
        for _ in range(3):
            time.sleep(1.5); pg.evaluate(f"__P.stream({pose['x']+420}, {pose['z']})")
        r['stream2'] = pg.evaluate(f"__P.stream({pose['x']+420}, {pose['z']-400})")
        out[pose['name']] = r
        print(pose['name'], json.dumps({k: v for k, v in r.items() if k not in ('scan', 'scanShadow', 'top')}))
        print('  top total', r['top']['total'], 'meshes', r['top']['n']); [print('    ', t) for t in r['top']['top'][:8]]
        for nm in ('scan', 'scanShadow'):
            s = r[nm]; print(' ', nm, 'calls', s['calls'], 'tris', int(s['tris']), 'ms', int(s['ms']), 'prog', s['programs'])
            for k, v in sorted(s['cats'].items()): print('   ', k, v['calls'], int(v['tris']))
    print('\n'.join([l for l in logs if 'ERR' in l or l.startswith('error')][:10]))
    os.makedirs('/tmp/claude-0', exist_ok=True)
    json.dump(out, open(f'/tmp/claude-0/probe_{label}.json', 'w'), indent=1)
    b.close()
