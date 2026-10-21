# route.py url outdir: graph stats, A* timings on random pairs, and a screenshot of an active job route
import sys, time, json, os
from playwright.sync_api import sync_playwright
url, outdir = sys.argv[1], sys.argv[2]; os.makedirs(outdir, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 960, "height": 540}); logs=[]; pg.on("pageerror", lambda e: logs.append(str(e)[:300]))
    pg.goto(url); t0=time.time()
    while time.time()-t0 < 400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    print('ready', round(time.time()-t0))
    r = pg.evaluate("""() => {
      const h = __hl, g = h.graph; let worst = 0, tot = 0; const t0 = performance.now(); while (true) { const a = performance.now(); const more = g.sync(h.store.regions.values()); const d = performance.now() - a; worst = Math.max(worst, d); if (!more) break; } const syncMs = performance.now() - t0;
      const me = h.sim.local; const out = { regions: h.store.regions.size, syncMs: +syncMs.toFixed(1), worstSlice: +worst.toFixed(1), stats: g.stats(), runs: [] };
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 24; i++) {
        const a = [me.pos.x + (rnd() - 0.5) * 1800, me.pos.z + (rnd() - 0.5) * 1800], c = [me.pos.x + (rnd() - 0.5) * 1800, me.pos.z + (rnd() - 0.5) * 1800];
        const mode = i % 3 === 2 ? 'walk' : 'drive'; const t1 = performance.now(); const p = g.route(a[0], a[1], c[0], c[1], mode); const ms = performance.now() - t1;
        out.runs.push({ mode, straight: Math.round(Math.hypot(a[0]-c[0], a[1]-c[1])), len: p ? Math.round(p.len) : null, pts: p ? p.pts.length / 2 : 0, ms: +ms.toFixed(1) });
      }
      return out; }""")
    print(json.dumps({k: v for k, v in r.items() if k != 'runs'}))
    import statistics; rat=[x['len']/max(x['straight'],1) for x in r['runs'] if x['len']]; print('median detour', round(statistics.median(rat),2), 'mean', round(sum(rat)/len(rat),2))
    ok = [x for x in r['runs'] if x['len']]; print('routes found', len(ok), 'of', len(r['runs']))
    for x in r['runs']: print(x)
    # a real job
    pg.evaluate("() => { __hl.startJob('delivery'); }"); time.sleep(3)
    pg.evaluate("() => { const h=__hl; h.sim.local.pos; }")
    for i in range(60):
        time.sleep(1)
        st = pg.evaluate("() => ({ lost: __hl.guide.lost, left: Math.round(__hl.guide.left), n: __hl.guide.remaining.length/2, comp: __hl.guide.computes, ms: +__hl.guide.lastMs.toFixed(1), next: __hl.guide.next })")
        if st['n'] > 2 or i > 40: break
    print(st)
    f0 = pg.evaluate("window.__w.frames"); t0=time.time()
    while time.time()-t0 < 60 and pg.evaluate("window.__w.frames") < f0 + 3: time.sleep(0.5)
    pg.screenshot(path=f"{outdir}/route_job.png", timeout=400000)
    print('\n'.join(logs[:5]))
    b.close()
