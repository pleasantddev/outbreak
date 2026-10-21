# Car seat review: seat.py "<url>" outdir kinds(comma) [w h] [seed]. For each vehicle kind: driver exterior, driver cutaway (section view), cockpit view, passenger shots.
import sys, time, json
from playwright.sync_api import sync_playwright
url, outdir = sys.argv[1], sys.argv[2]; kinds = sys.argv[3].split(',')
w, h = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (960, 540)
seedarg = sys.argv[6] if len(sys.argv) > 6 else '0'
import os; os.makedirs(outdir, exist_ok=True)
SETUP = r"""
(kind, seed, seat) => {
  const s = __hl.sim, v = __hl.view, me = s.local; window.__hl.view.firstPerson = false; v.debugCam = null; v.renderer.clippingPlanes = [];
  // clear previous test cars
  for (const c of s.liveVehicles()) if (c.__test) { s.removeVehicle(c); }
  if (me.vehicle !== null) s.exitVehicle(me, true);
  const base = window.__SEATBASE || (window.__SEATBASE = { x: me.pos.x, z: me.pos.z });
  me.pos = { x: base.x, y: 0.05, z: base.z - 12 }; me.body.setTranslation({ x: base.x, y: 1, z: base.z - 12 }, true);
  const car = s.addVehicle(kind, { x: base.x, y: 0.15, z: base.z }, 0, false); car.__test = true; car.seed = seed; car.locked = false;
  __hl.simulate(0.5);
  // seat 0 gets an NPC if the player wants a passenger seat
  let npc = null;
  if (seat === 0) { s.enterVehicle(me, car, true); }
  else { npc = s.spawnActor('ped', { x: base.x + 3, y: 0.05, z: base.z }); s.enterVehicle(npc, car, true); s.enterVehicle(me, car, false); }
  __hl.simulate(1.2);
  return { kind, seat: me.seat, veh: car.id, cam: v.camera.position.toArray(), carpos: car.body.translation() };
}
"""
CAM = r"""
(mode, off) => {
  const s = __hl.sim, v = __hl.view, me = s.local; const car = s.vehicles[me.vehicle]; const p = car.body.translation(); const r = car.body.rotation();
  const q = { x: r.x, y: r.y, z: r.z, w: r.w };
  const rot = (x, y, z) => { // rotate vector by car quaternion
    const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
    return [ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x]; };
  const seatX = me.pos.x - p.x, seatZ = me.pos.z - p.z; // world offset of the sitter
  v.renderer.clippingPlanes = [];
  if (window.__lamp) window.__lamp.visible = false;
  if (mode === 'ext') { const o = rot(off[0], off[1], off[2]); v.debugCam = { x: p.x + o[0], y: p.y + o[1], z: p.z + o[2], tx: p.x, ty: p.y + 0.5, tz: p.z, fov: 50 }; }
  if (mode === 'side' || mode === 'top') {
    const T = __hl.THREE; const cm = v.cars.get(car.id); const root = cm.m.root; const gy = cm.m.groundY ?? cm.m.offsetY;
    if (window.__ruler) window.__ruler.removeFromParent();
    const g = new T.Group(); g.position.set(0, gy, 0); root.add(g); window.__ruler = g;
    const mat = (c) => new T.LineBasicMaterial({ color: c, depthTest: false, transparent: true });
    const lines = (pts, c) => { const geo = new T.BufferGeometry().setFromPoints(pts); const l = new T.LineSegments(geo, mat(c)); l.renderOrder = 99; l.frustumCulled = false; g.add(l); };
    const label = (txt, x, y, z) => { const c = document.createElement('canvas'); c.width = 64; c.height = 32; const k = c.getContext('2d'); k.fillStyle = '#fff'; k.strokeStyle = '#000'; k.lineWidth = 3; k.font = 'bold 22px sans-serif'; k.strokeText(txt, 2, 24); k.fillText(txt, 2, 24); const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), depthTest: false })); sp.scale.set(0.3, 0.15, 1); sp.position.set(x, y, z); sp.renderOrder = 100; g.add(sp); };
    const X0 = me.pos.x - p.x; const sd = me.seat % 2 === 0 ? 1 : -1;
    const a = [], bb = [];
    if (mode === 'side') {
      for (let y = 0; y <= 2.0001; y += 0.1) { const big = Math.abs(y * 2 - Math.round(y * 2)) < 1e-6; (big ? bb : a).push(new T.Vector3(X0, y, -2.6), new T.Vector3(X0, y, 2.6)); if (big) label(y.toFixed(1), X0, y, 2.5); }
      for (let z = -2.5; z <= 2.5001; z += 0.1) { const big = Math.abs(z * 2 - Math.round(z * 2)) < 1e-6; (big ? bb : a).push(new T.Vector3(X0, 0, z), new T.Vector3(X0, 2.2, z)); if (big) label(z.toFixed(1), X0, 2.25, z); }
      lines(a, 0x445566); lines(bb, 0xffcc33);
      v.renderer.clippingPlanes = [new T.Plane(new T.Vector3(-sd, 0, 0), sd * (p.x + X0) + 0.01)];
      if (!window.__lamp) { window.__lamp = new T.PointLight(0xffffff, 60, 8, 1.5); v.scene.add(window.__lamp); }
      window.__lamp.position.set(me.pos.x + sd * 1.6, me.pos.y + 1.2, me.pos.z); window.__lamp.visible = true;
      v.debugCam = { x: p.x + sd * 28, y: me.pos.y + 0.95, z: me.pos.z, tx: p.x, ty: me.pos.y + 0.95, tz: me.pos.z, fov: 6 };
    } else {
      const cy = off[0];
      for (let x = -1.2; x <= 1.2001; x += 0.1) { const big = Math.abs(x * 2 - Math.round(x * 2)) < 1e-6; (big ? bb : a).push(new T.Vector3(x, cy, -2.6), new T.Vector3(x, cy, 2.6)); if (big) label(x.toFixed(1), x, cy, 2.55); }
      for (let z = -2.5; z <= 2.5001; z += 0.1) { const big = Math.abs(z * 2 - Math.round(z * 2)) < 1e-6; (big ? bb : a).push(new T.Vector3(-1.3, cy, z), new T.Vector3(1.3, cy, z)); if (big) label(z.toFixed(1), -1.3, cy, z); }
      lines(a, 0x445566); lines(bb, 0xffcc33);
      v.renderer.clippingPlanes = [new T.Plane(new T.Vector3(0, -1, 0), p.y + gy + cy)];
      if (!window.__lamp) { window.__lamp = new T.PointLight(0xffffff, 60, 8, 1.5); v.scene.add(window.__lamp); }
      window.__lamp.position.set(p.x, p.y + gy + cy + 2.5, me.pos.z); window.__lamp.visible = true;
      v.debugCam = { x: p.x, y: p.y + gy + 30, z: me.pos.z + 0.01, tx: p.x, ty: p.y + gy, tz: me.pos.z, fov: 7 };
    }
  }
  if (mode === 'cockpit') { v.debugCam = null; v.firstPerson = true; if (window.__ruler) window.__ruler.visible = false; const fw = rot(0, 0, 1); v.cam.yaw = Math.atan2(fw[0], fw[2]); v.cam.pitch = -0.02; }
  if (mode === 'third') { v.debugCam = null; v.firstPerson = false; }
  return 'ok';
}
"""
def wait_frames(n):
    f0 = pg.evaluate("window.__w.frames")
    t0 = time.time()
    while time.time() - t0 < 90 and pg.evaluate("window.__w.frames") < f0 + n: time.sleep(0.5)
HIDE = "document.querySelectorAll('body > *:not(canvas)').forEach((e) => (e.style.display = 'none'))"
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": w, "height": h})
    logs=[]; pg.on("console", lambda m: logs.append(m.type+': '+m.text[:300])); pg.on("pageerror", lambda e: logs.append("ERR "+str(e)[:500]))
    pg.goto(url); t0=time.time()
    while time.time()-t0 < 400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    print('ready', f'{time.time()-t0:.0f}s'); pg.evaluate(HIDE)
    for kind in kinds:
        for seat in [int(x) for x in os.environ.get('SEATS', '0,1').split(',')]:
            r = pg.evaluate(f"({SETUP})('{kind}', {seedarg}, {seat})"); print(r)
            wait_frames(2)
            for name, mode, off in [m for m in [('ext', 'ext', [4.6, 2.2, -5.2]), ('side', 'side', None), ('top', 'top', [1.15]), ('cockpit', 'cockpit', None)] if m[0] in os.environ.get('MODES', 'ext,side,top,cockpit').split(',')]:
                try: pg.evaluate(f"({CAM})('{mode}', {json.dumps(off)})")
                except Exception as e: print('cam err', str(e)[:200]); continue
                wait_frames(4); pg.screenshot(path=f"{outdir}/{kind}_s{seat}_{name}.png", timeout=400000); print('shot', kind, seat, name)
    print('\n'.join([l for l in logs if 'ERR' in l or l.startswith('error')][:10]))
    b.close()
