# seatcheck.py url kind:seed,... : fills every seat of each vehicle with NPCs, lets a few frames render, and measures the pose numerically
import sys, time, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]; specs = sys.argv[2].split(',')
SETUP = r"""
([kind, seed]) => {
  const s = __hl.sim, v = __hl.view, me = s.local;
  for (const c of s.liveVehicles()) if (c.__test) s.removeVehicle(c);
  if (me.vehicle !== null) s.exitVehicle(me, true);
  const base = window.__SEATBASE || (window.__SEATBASE = { x: me.pos.x, z: me.pos.z });
  me.pos = { x: base.x + 30, y: 0.05, z: base.z }; me.body.setTranslation({ x: base.x + 30, y: 1, z: base.z }, true);
  const car = s.addVehicle(kind, { x: base.x, y: 0.15, z: base.z }, 0.0, false); car.__test = true; car.seed = seed; car.locked = false; __hl.simulate(0.3);
  const n = car.seats.length; for (let i = 0; i < n; i++) { const npc = s.spawnActor('ped', { x: base.x + 3 + i, y: 0.05, z: base.z + 3 }); s.enterVehicle(npc, car, i === 0); }
  v.debugCam = { x: base.x + 7, y: 3.5, z: base.z + 7, tx: base.x, ty: 1, tz: base.z, fov: 40 };
  return { id: car.id, n };
}"""
CHECK = r"""
(id) => {
  const s = __hl.sim, v = __hl.view, T = __hl.THREE; const out = [];
  const cm = v.cars.get(id)?.m; if (!cm) return 'nomodel';
  for (const a of s.actors) {
    if (a.vehicle !== id) continue; const av = v.actors.get(a.id); if (!av || !av.seat) { out.push({ seat: a.seat, err: 'noseat' }); continue; }
    const hv = av.view, t = av.seat; hv.root.updateMatrixWorld(true);
    const P = (n) => hv.bones.get(n).getWorldPosition(new T.Vector3());
    const r = { seat: a.seat, pose: t.pose, scale: +hv.root.scale.x.toFixed(2) };
    r.pelvisErr = +P('pelvis').distanceTo(t.hip).toFixed(3);
    r.headTopMinusRoof = +(P('Head').y + 0.2 - t.roof).toFixed(2);
    if (t.hands) r.hands = [P('hand_l').distanceTo(t.hands[0]), P('hand_r').distanceTo(t.hands[1])].map((x) => +x.toFixed(3));
    if (t.feet) r.feet = [P('foot_l').distanceTo(t.feet[0]), P('foot_r').distanceTo(t.feet[1])].map((x) => +x.toFixed(3));
    const kl = P('calf_l'), kr = P('calf_r'); r.kneeY = [+(kl.y - t.hip.y).toFixed(2), +(kr.y - t.hip.y).toFixed(2)];
    out.push(r);
  }
  return out;
}"""
def wait_frames(pg, n):
    f0 = pg.evaluate("window.__w.frames"); t0 = time.time()
    while time.time() - t0 < 240 and pg.evaluate("window.__w.frames") < f0 + n: time.sleep(0.5)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 480, "height": 270}); logs=[]; pg.on("pageerror", lambda e: logs.append(str(e)[:300]))
    pg.goto(url); t0 = time.time()
    while time.time() - t0 < 500:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    print('ready', round(time.time() - t0))
    for sp in specs:
        k, sd = sp.split(':'); info = pg.evaluate(f"({SETUP})(['{k}', {sd}])")
        t1 = time.time()
        while time.time() - t1 < 120 and not pg.evaluate(f"!!__hl.view.cars.get({info['id']})?.m"): time.sleep(0.5)
        wait_frames(pg, 4); time.sleep(1)
        r = pg.evaluate(f"({CHECK})({info['id']})")
        print('==', sp, 'seats', info['n'])
        if isinstance(r, str): print(r); continue
        for x in sorted(r, key=lambda z: z['seat']): print(' ', json.dumps(x))
    print('\n'.join(logs[:5])); b.close()
