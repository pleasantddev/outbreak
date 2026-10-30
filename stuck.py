# stuck.py: count blocked events along the walk graph and the drive lanes in 6 neighbourhoods.
# usage: stuck.py url out.json [radius] [place,place,...]
# A walker (circle r=0.35) and a car (circle r=1.1) are slid along every sidewalk polyline / lane centreline near each place; every
# maximal run of blocked samples is one "stuck event". Colliders are exactly what the sim gets: building prisms, walls, poles.
import sys, time, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
R = float(sys.argv[3]) if len(sys.argv) > 3 else 330
PLACES = {'oshodi': (904, -335), 'ilupeju': (1891, -197), 'mushin': (-79, 974), 'ikeja': (-965, -1688), 'ojota': (4024, -3751), 'agege': (-1861, -7349)}
only = sys.argv[4].split(',') if len(sys.argv) > 4 else list(PLACES)
PROBE = r"""async (c) => { const hl = window.__hl, v = hl.view, me = hl.sim.local; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  me.pos = { x: c.x, y: 0.05, z: c.z }; me.body.setTranslation({ x: c.x, y: 1, z: c.z }, true);
  let stable = 0, last = -1;
  for (let i = 0; i < 1200 && stable < 10; i++) { v.world.update(c.x, c.z, true); await sleep(30); const n = v.world.tiles.size; if (!v.world.job && n === last) stable++; else stable = 0; last = n; }
  const net = hl.sim.net, RN = net.constructor; const R = c.R;
  // spatial hash of colliders
  const CELL = 16, grid = new Map(); const add = (k, o) => { let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(o); };
  const bb = (x0, z0, x1, z1, o) => { for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) add(i * 100000 + j, o); };
  const all = { hulls: 0, walls: 0, poles: 0, wallM: 0 };
  for (const t of v.world.tiles.values()) {
    for (const h of t.col.hulls) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let k = 0; k < h.pts.length; k += 2) { x0 = Math.min(x0, h.pts[k]); x1 = Math.max(x1, h.pts[k]); z0 = Math.min(z0, h.pts[k + 1]); z1 = Math.max(z1, h.pts[k + 1]); } bb(x0 - 1, z0 - 1, x1 + 1, z1 + 1, { t: 'hull', p: h.pts, id: 0 }); all.hulls++; }
    for (const w of t.col.walls) { bb(Math.min(w.ax, w.bx) - 1, Math.min(w.az, w.bz) - 1, Math.max(w.ax, w.bx) + 1, Math.max(w.az, w.bz) + 1, { t: 'wall', w }); all.walls++; all.wallM += Math.hypot(w.bx - w.ax, w.bz - w.az); }
    for (let i = 0; i < t.col.poles.length; i += 3) { const x = t.col.poles[i], z = t.col.poles[i + 1], r = t.col.poles[i + 2]; bb(x - 1, z - 1, x + 1, z + 1, { t: 'pole', x, z, r }); all.poles++; }
  }
  const segD = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); return Math.hypot(ax + dx * t - x, az + dz * t - z); };
  const inPoly = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const hit = (x, z, r) => { const l = grid.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL)); if (!l) return null;
    for (const o of l) {
      if (o.t === 'pole') { if (Math.hypot(x - o.x, z - o.z) < o.r + r) return 'pole'; }
      else if (o.t === 'wall') { const w = o.w; if (segD(x, z, w.ax, w.az, w.bx, w.bz) < 0.12 + r) return 'wall'; }
      else { if (inPoly(x, z, o.p)) return 'hull'; const p = o.p; for (let k = 0; k < p.length; k += 2) { const j = (k + 2) % p.length; if (segD(x, z, p[k], p[k + 1], p[j], p[j + 1]) < r) return 'hull'; } }
    } return null; };
  const probe = (list, r, step) => { let meters = 0, events = 0, blockedM = 0; const causes = {}, where = [];
    for (const pts of list) { let run = false, runCause = '';
      for (let q = 0; q < pts.length - 2; q += 2) { const ax = pts[q], az = pts[q + 1], bx = pts[q + 2], bz = pts[q + 3]; const L = Math.hypot(bx - ax, bz - az); const n = Math.max(1, Math.ceil(L / step));
        for (let s = 0; s < n; s++) { const x = ax + (bx - ax) * s / n, z = az + (bz - az) * s / n; if (Math.hypot(x - c.x, z - c.z) > R) { run = false; continue; } meters += L / n;
          const h = hit(x, z, r); if (h) { blockedM += L / n; if (!run) { events++; causes[h] = (causes[h] || 0) + 1; if (where.length < 400) where.push([Math.round(x), Math.round(z), h]); } run = true; } else run = false; } } }
    return { meters: Math.round(meters), events, blockedM: Math.round(blockedM), causes, where }; };
  const walks = [], lanes = [];
  for (const id of net.nearWalks(c.x, c.z, R + 80)) walks.push(net.walks[id].pts);
  for (const id of net.near(c.x, c.z, R + 80)) lanes.push(net.lanes[id].pts);
  const W = probe(walks, 0.35, 0.5), Ln = probe(lanes, 1.1, 1.5);
  // compound walls inside a road corridor (carriageway + verge): wall midpoints closer than hw+verge*0.6 to a drivable lane centre
  let wallInRoad = 0, wallsNear = 0;
  for (const t of v.world.tiles.values()) for (const w of t.col.walls) { const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2; if (Math.hypot(mx - c.x, mz - c.z) > R) continue; wallsNear++;
    for (const id of net.near(mx, mz, 14)) { const l = net.lanes[id]; if (RN.project(l.pts, mx, mz).d < 2.2) { wallInRoad++; break; } } }
  return { all, walk: W, lane: Ln, wallsNear, wallInRoad, tiles: v.world.tiles.size }; }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 480, "height": 270})
    logs = []; pg.on("pageerror", lambda e: logs.append("ERR " + str(e)[:400]))
    pg.goto(url); t0 = time.time()
    while time.time() - t0 < 400:
        time.sleep(2)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    pg.evaluate("() => { const hl = window.__hl; hl.sim.maxPeds = 0; hl.sim.maxTraffic = 0; hl.sim.maxParked = 0; }")
    res = {}
    for k in only:
        x, z = PLACES[k]; r = pg.evaluate(PROBE, {'x': x, 'z': z, 'R': R}); res[k] = r
        print(f"{k:8s} walk {r['walk']['meters']}m events {r['walk']['events']} {r['walk']['causes']} | lane {r['lane']['meters']}m events {r['lane']['events']} {r['lane']['causes']} | walls {r['wallsNear']} inRoad {r['wallInRoad']} | colliders {r['all']}", flush=True)
    tot = lambda f: sum(f(v) for v in res.values())
    print('TOTAL walk events', tot(lambda v: v['walk']['events']), 'lane events', tot(lambda v: v['lane']['events']), 'walls', tot(lambda v: v['wallsNear']), 'wallsInRoad', tot(lambda v: v['wallInRoad']))
    json.dump(res, open(out, 'w'))
    print('\n'.join(logs[:5])); b.close()
