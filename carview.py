# Car interior rulers: carview.py "<url>" outdir kind:seed,kind:seed ... [w h]. Side cut at the driver's x and a top cut, with a metre grid in car space (ground y=0, z from wheelbase centre).
import sys, time, json, os
from playwright.sync_api import sync_playwright
url, outdir = sys.argv[1], sys.argv[2]; specs = sys.argv[3].split(',')
w, h = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (1100, 620)
os.makedirs(outdir, exist_ok=True)
JS = r"""
(kind, seed, mode, cutX, cutY) => {
  const T = __hl.THREE, s = __hl.sim, v = __hl.view, me = s.local;
  for (const c of s.liveVehicles()) if (c.__test) s.removeVehicle(c);
  if (me.vehicle !== null) s.exitVehicle(me, true);
  const base = window.__SEATBASE || (window.__SEATBASE = { x: me.pos.x, z: me.pos.z });
  me.pos = { x: base.x + 20, y: 0.05, z: base.z - 12 }; me.body.setTranslation({ x: base.x + 20, y: 1, z: base.z - 12 }, true);
  const car = s.addVehicle(kind, { x: base.x, y: 0.15, z: base.z }, 0, false); car.__test = true; car.seed = seed; car.locked = false; __hl.simulate(1.5);
  window.__car = car; return car.id;
}
"""
VIEW = r"""
(mode, cutX, cutY) => {
  const T = __hl.THREE, s = __hl.sim, v = __hl.view; const car = window.__car; const cm = v.cars.get(car.id); if (!cm || !cm.m) return 'no model';
  const root = cm.m.root; const p = car.body.translation();
  document.querySelectorAll('body > *:not(canvas)').forEach((e) => (e.style.display = 'none'));
  if (window.__ruler) window.__ruler.removeFromParent();
  const g = new T.Group(); g.position.set(0, cm.m.offsetY, 0); root.add(g); window.__ruler = g;
  const mat = (c) => new T.LineBasicMaterial({ color: c, depthTest: false, transparent: true });
  const lines = (pts, c) => { const geo = new T.BufferGeometry().setFromPoints(pts); const l = new T.LineSegments(geo, mat(c)); l.renderOrder = 99; l.frustumCulled = false; g.add(l); };
  const label = (txt, x, y, z) => { const c = document.createElement('canvas'); c.width = 64; c.height = 32; const k = c.getContext('2d'); k.fillStyle = '#fff'; k.font = 'bold 22px sans-serif'; k.fillText(txt, 2, 24); const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), depthTest: false })); sp.scale.set(0.3, 0.15, 1); sp.position.set(x, y, z); sp.renderOrder = 100; g.add(sp); };
  const X0 = cutX;
  if (mode === 'side') {
    const a = [], b = [];
    for (let y = 0; y <= 2.0001; y += 0.1) { const big = Math.abs(y * 2 - Math.round(y * 2)) < 1e-6; (big ? b : a).push(new T.Vector3(X0, y, -2.6), new T.Vector3(X0, y, 2.6)); if (big) label(y.toFixed(1), X0, y, 2.55); }
    for (let z = -2.5; z <= 2.5001; z += 0.1) { const big = Math.abs(z * 2 - Math.round(z * 2)) < 1e-6; (big ? b : a).push(new T.Vector3(X0, 0, z), new T.Vector3(X0, 2.2, z)); if (big) label(z.toFixed(1), X0, 2.25, z); }
    lines(a, 0x445566); lines(b, 0xffcc33);
    v.renderer.clippingPlanes = [new T.Plane(new T.Vector3(-1, 0, 0), X0 + 0.005)];
    v.debugCam = { x: p.x + 28, y: p.y + cm.m.offsetY + 1.0, z: p.z, tx: p.x, ty: p.y + cm.m.offsetY + 1.0, tz: p.z, fov: 11 };
  } else if (mode === 'top') {
    const a = [], b = [];
    for (let x = -1.2; x <= 1.2001; x += 0.1) { const big = Math.abs(x * 2 - Math.round(x * 2)) < 1e-6; (big ? b : a).push(new T.Vector3(x, cutY, -2.6), new T.Vector3(x, cutY, 2.6)); if (big) label(x.toFixed(1), x, cutY, 2.6); }
    for (let z = -2.5; z <= 2.5001; z += 0.1) { const big = Math.abs(z * 2 - Math.round(z * 2)) < 1e-6; (big ? b : a).push(new T.Vector3(-1.3, cutY, z), new T.Vector3(1.3, cutY, z)); if (big) label(z.toFixed(1), -1.3, cutY, z); }
    lines(a, 0x445566); lines(b, 0xffcc33);
    v.renderer.clippingPlanes = [new T.Plane(new T.Vector3(0, -1, 0), cutY + cm.m.offsetY + 0.0 + p.y * 0 + 0.0)];
    // plane in world: keep y <= cutY above ground; ground at world y = p.y + offsetY
    v.renderer.clippingPlanes = [new T.Plane(new T.Vector3(0, -1, 0), p.y + cm.m.offsetY + cutY)];
    v.debugCam = { x: p.x, y: p.y + cm.m.offsetY + 30, z: p.z + 0.01, tx: p.x, ty: p.y + cm.m.offsetY, tz: p.z, fov: 11 };
  }
  return 'ok';
}
"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": w, "height": h})
    pg.goto(url); t0=time.time()
    while time.time()-t0 < 400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    print('ready')
    for sp in specs:
        kind, seed = sp.split(':'); name = sys.argv[6] if False else sp.replace(':', '_')
        pg.evaluate(f"({JS})('{kind}', {seed})"); time.sleep(3)
        for mode, cx, cy in [('side', 0.40, 0), ('top', 0, 0.95)]:
            r = pg.evaluate(f"({VIEW})('{mode}', {cx}, {cy})"); time.sleep(3); pg.screenshot(path=f"{outdir}/{name}_{mode}.png", timeout=180000); print(sp, mode, r)
    b.close()
