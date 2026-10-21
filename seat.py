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
  if (mode === 'ext') { const o = rot(off[0], off[1], off[2]); v.debugCam = { x: p.x + o[0], y: p.y + o[1], z: p.z + o[2], tx: p.x, ty: p.y + 0.5, tz: p.z, fov: 50 }; }
  if (mode === 'cut') {
    const T = __hl.THREE; const side = (me.seat % 2 === 0) ? 1 : -1; const lat = rot(1, 0, 0); const sx = lat[0] * side, sz = lat[2] * side;
    const n = new T.Vector3(-sx, 0, -sz); // keeps the half toward the car centre, hides the outer half (door side)
    v.renderer.clippingPlanes = [new T.Plane(n, -(n.x * me.pos.x + n.z * me.pos.z) - 0.0)];
    v.debugCam = { x: me.pos.x + sx * off[0], y: me.pos.y + off[1], z: me.pos.z + sz * off[0], tx: me.pos.x, ty: me.pos.y + 0.6, tz: me.pos.z, fov: 40 };
  }
  if (mode === 'cockpit') { v.debugCam = null; v.firstPerson = true; }
  if (mode === 'third') { v.debugCam = null; v.firstPerson = false; }
  return 'ok';
}
"""
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
    print('ready', f'{time.time()-t0:.0f}s')
    for kind in kinds:
        for seat in (0, 1):
            r = pg.evaluate(f"({SETUP})('{kind}', {seedarg}, {seat})"); print(r)
            time.sleep(1)
            for name, mode, off in [('ext', 'ext', [4.6, 2.2, -5.2]), ('cut', 'cut', [4.2, 0.35, 0]), ('cockpit', 'cockpit', None)]:
                try: pg.evaluate(f"({CAM})('{mode}', {json.dumps(off)})")
                except Exception as e: print('cam err', str(e)[:200]); continue
                time.sleep(2.5); pg.screenshot(path=f"{outdir}/{kind}_s{seat}_{name}.png", timeout=180000); print('shot', kind, seat, name)
    print('\n'.join([l for l in logs if 'ERR' in l or l.startswith('error')][:10]))
    b.close()
