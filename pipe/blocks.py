# City blocks: the faces of the road + rail + canal + shoreline graph, minus open water. Output is a list of
# shapely polygons (WKB) that parcels.py cuts into properties.
import pickle, math, time, os, sys
import numpy as np, shapely
from shapely.geometry import LineString, Polygon, box
from shapely.strtree import STRtree
from common import SPLIT
HERE = os.path.dirname(os.path.abspath(__file__))
t0 = time.time()
d = pickle.load(open(os.path.join(HERE, 'raw.pkl'), 'rb'))
lines = [LineString(r['pts']) for r in d['roads'] if r['hw'] in SPLIT and r.get('bridge') in (None, 'no') and r.get('tunnel') in (None, 'no') and len(r['pts']) >= 2]
nroad = len(lines)
lines += [LineString(r['pts']) for r in d['rail'] if r['railway'] in ('rail', 'narrow_gauge') and r.get('bridge') in (None, 'no') and r.get('tunnel') in (None, 'no') and not r.get('service') and not r['closed'] and len(r['pts']) >= 2]
lines += [LineString(w['pts']) for w in d['water'] if w['line'] and w['kind'] in ('canal', 'river')]
# shoreline of every big water body
water = []
for w in d['water']:
    if w['line'] or w['kind'] == 'wetland' or len(w['pts']) < 3: continue
    p = Polygon(w['pts'], w['holes'])
    if not p.is_valid: p = p.buffer(0)
    if p.area < 8000: continue
    water.append(p)
    for ring in [p.exterior] + list(p.interiors): lines.append(LineString(ring.coords))
print('lines', len(lines), 'roads', nroad, 'water polys', len(water), f'{time.time()-t0:.0f}s', flush=True)
LAT0, LON0 = d['origin']; KX = math.cos(math.radians(LAT0)) * 111320.0; KZ = 110574.0
lon0, lat0, lon1, lat1 = d['bbox']
corr = box((lon0 - LON0) * KX, -(lat1 - LAT0) * KZ, (lon1 - LON0) * KX, -(lat0 - LAT0) * KZ)
# only keep line parts inside the corridor (plus margin) so polygonize stays small
big = corr.buffer(60)
lines = [g for g in (l.intersection(big) for l in lines) if not g.is_empty]
flat = []
for g in lines:
    flat.extend(shapely.get_parts(g) if g.geom_type != 'LineString' else [g])
flat = [g for g in flat if g.geom_type == 'LineString' and g.length > 0.2]
noded = shapely.union_all(shapely.GeometryCollection(flat), grid_size=0.05)
print('noded', f'{time.time()-t0:.0f}s', flush=True)
polys = list(shapely.get_parts(shapely.polygonize(shapely.get_parts(noded))))
print('raw faces', len(polys), f'{time.time()-t0:.0f}s', flush=True)
wt = STRtree(water) if water else None
blocks = []
for p in polys:
    if not p.is_valid: p = p.buffer(0)
    if p.area < 40 or not p.intersects(corr): continue
    if wt is not None:
        hit = wt.query(p)
        if len(hit):
            w = shapely.union_all([water[i] for i in hit])
            # a face whose interior is mostly water is open water
            if p.intersection(w).area > 0.5 * p.area: continue
            p = p.difference(w)
    for g in shapely.get_parts(p):
        if g.geom_type == 'Polygon' and g.area >= 40: blocks.append(g)
print('blocks', len(blocks), 'area km2', round(sum(b.area for b in blocks) / 1e6, 1), f'{time.time()-t0:.0f}s', flush=True)
pickle.dump({'blocks': [shapely.to_wkb(b) for b in blocks], 'corr': list(corr.exterior.coords)}, open(os.path.join(HERE, 'blocks.pkl'), 'wb'))
print(f'done {time.time()-t0:.0f}s')
