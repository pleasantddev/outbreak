# dump.py url kind:seed,... : prints per-mesh bbox in car space (ground y=0, z from wheelbase centre)
import sys, time, json
from playwright.sync_api import sync_playwright
url=sys.argv[1]; specs=sys.argv[2].split(',')
JS=r"""
(kind, seed) => {
  const T=__hl.THREE, s=__hl.sim, v=__hl.view, me=s.local;
  for (const c of s.liveVehicles()) if (c.__test) s.removeVehicle(c);
  if (me.vehicle !== null) s.exitVehicle(me, true);
  const base = window.__SEATBASE || (window.__SEATBASE = { x: me.pos.x, z: me.pos.z });
  const car = s.addVehicle(kind, { x: base.x, y: 0.15, z: base.z }, 0, false); car.__test=true; car.seed=seed; __hl.simulate(1.5);
  return car.id;
}"""
DUMP=r"""
(id) => {
  const T=__hl.THREE, v=__hl.view; const cm=v.cars.get(id); if(!cm||!cm.m) return 'nomodel';
  const root=cm.m.root; root.updateMatrixWorld(true); const inv=new T.Matrix4().copy(root.matrixWorld).invert();
  const out=[]; const off=cm.m.offsetY;
  root.traverse(o=>{ if(!o.isMesh) return; const g=o.geometry; g.computeBoundingBox(); const b=g.boundingBox.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inv,o.matrixWorld));
    const m=Array.isArray(o.material)?o.material[0]:o.material; let n=o.name||''; let p=o.parent; while(p&&p!==root&&!n) { n=p.name; p=p.parent; }
    out.push([n,m.name||'',m.color?m.color.getHexString():'',+b.min.x.toFixed(2),+b.max.x.toFixed(2),+(b.min.y-off).toFixed(2),+(b.max.y-off).toFixed(2),+b.min.z.toFixed(2),+b.max.z.toFixed(2)]); });
  return out;
}"""
with sync_playwright() as p:
    b=p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg=b.new_page(viewport={"width":640,"height":360}); pg.goto(url); t0=time.time()
    while time.time()-t0<400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    for sp in specs:
        k,sd=sp.split(':'); id=pg.evaluate(f"({JS})('{k}',{sd})"); time.sleep(4)
        r=pg.evaluate(f"({DUMP})({id})"); print('==',sp)
        if isinstance(r,str): print(r); continue
        for row in r:
            if row[1] in ('glass','rubber','wheel','hubcaps','brake_lights','chrome','bottom_black') or 'wheel' in row[0]: continue
            print(' %-12s %-14s #%s x[%5.2f,%5.2f] y[%5.2f,%5.2f] z[%5.2f,%5.2f]'%tuple(row))
    b.close()
