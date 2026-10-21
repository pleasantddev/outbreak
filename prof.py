# prof.py url kind:seed,... [xlo xhi]: ASCII side profile (z across, y up) of interior vertices in an x slab (driver side +x)
import sys, time
from playwright.sync_api import sync_playwright
url=sys.argv[1]; specs=sys.argv[2].split(','); xlo=float(sys.argv[3]) if len(sys.argv)>3 else 0.25; xhi=float(sys.argv[4]) if len(sys.argv)>4 else 0.6
JS=r"""
(kind, seed) => {
  const s=__hl.sim, me=s.local;
  for (const c of s.liveVehicles()) if (c.__test) s.removeVehicle(c);
  if (me.vehicle !== null) s.exitVehicle(me, true);
  const base = window.__SEATBASE || (window.__SEATBASE = { x: me.pos.x, z: me.pos.z });
  const car = s.addVehicle(kind, { x: base.x, y: 0.15, z: base.z }, 0, false); car.__test=true; car.seed=seed; __hl.simulate(1.5); return car.id;
}"""
PROF=r"""
([id, xlo, xhi]) => {
  const T=__hl.THREE, v=__hl.view; const cm=v.cars.get(id); if(!cm||!cm.m) return null;
  const root=cm.m.root; root.updateMatrixWorld(true); const inv=new T.Matrix4().copy(root.matrixWorld).invert(); const off=cm.m.groundY ?? cm.m.offsetY;
  const out=[]; const p=new T.Vector3(); const mm=new T.Matrix4();
  root.traverse(o=>{ if(!o.isMesh) return; const m=Array.isArray(o.material)?o.material[0]:o.material; const n=(m.name||'').toLowerCase(); if(/glass|rubber|^wheel|hubcap|tire|tyre/.test(n)) return; if (m.transparent && m.opacity<0.9) return;
    mm.multiplyMatrices(inv,o.matrixWorld); const a=o.geometry.attributes.position; const idx=o.geometry.index;
    const pts=[]; for(let i=0;i<a.count;i++){ p.fromBufferAttribute(a,i).applyMatrix4(mm); pts.push(p.x,p.y-off,p.z); }
    // also sample triangle midpoints and edge midpoints for sparse meshes
    if(idx){ for(let i=0;i<idx.count;i+=3){ const A=idx.getX(i),B=idx.getX(i+1),C=idx.getX(i+2); for(const [u,w] of [[A,B],[B,C],[C,A]]) pts.push((pts[u*3]+pts[w*3])/2,(pts[u*3+1]+pts[w*3+1])/2,(pts[u*3+2]+pts[w*3+2])/2); } }
    for(let i=0;i<pts.length;i+=3){ const x=pts[i]; if(x>=xlo&&x<=xhi) out.push(pts[i+1],pts[i+2]); } });
  return out;
}"""
with sync_playwright() as p:
    b=p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg=b.new_page(viewport={"width":480,"height":270}); pg.goto(url); t0=time.time()
    while time.time()-t0<400:
        time.sleep(1)
        try:
            if pg.evaluate("!!(window.__hl && window.__w && window.__w.frames > 1)"): break
        except Exception: pass
    for sp in specs:
        k,sd=sp.split(':'); id=pg.evaluate(f"({JS})('{k}',{sd})")
        r=None
        for _ in range(40):
            time.sleep(1.5); r=pg.evaluate(f"({PROF})([{id},{xlo},{xhi}])")
            if r: break
        print('==',sp,'x in',xlo,xhi,'(z: left=rear -> right=front; rows y high->low, 5cm cells)')
        if not r: print('no model'); continue
        zlo,zhi=-2.5,2.5; W=int((zhi-zlo)/0.05); H=34; y0=0.1
        grid=[[0]*W for _ in range(H)]
        for i in range(0,len(r),2):
            y,z=r[i],r[i+1]; c=int((z-zlo)/0.05); rr=int((y-y0)/0.05)
            if 0<=c<W and 0<=rr<H: grid[rr][c]+=1
        print('      '+''.join(('|' if abs((zlo+i*0.05)%0.5)<0.026 or abs((zlo+i*0.05)%0.5-0.5)<0.026 else ' ') for i in range(W)))
        for rr in range(H-1,-1,-1):
            print('%4.2f  '%(y0+rr*0.05)+''.join('#' if c>3 else ('+' if c>0 else '.') for c in grid[rr]))
        print('      z from -2.5, markers every 0.5: '+' '.join('%.1f'%(zlo+0.5*i) for i in range(11)))
    b.close()
