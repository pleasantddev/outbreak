# City blocks from the road graph, then Lagos-standard plots (18 m x 36 m) inside each block.
import pickle, math, time, numpy as np, shapely
from shapely.geometry import LineString, Polygon, Point, box
from shapely import affinity
from shapely.strtree import STRtree
t0 = time.time()
d = pickle.load(open('/home/claude/hl/pipe/raw.pkl', 'rb'))
SPLIT = {'motorway','trunk','primary','secondary','tertiary','unclassified','residential','living_street','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link','busway','road'}
lines = [LineString(r['pts']) for r in d['roads'] if r['hw'] in SPLIT and not r['bridge'] and not r['tunnel'] and len(r['pts']) >= 2]
lines += [LineString(r['pts']) for r in d['rail'] if r['kind'] == 'rail' and not r['bridge']]
lines += [LineString(w['pts']) for w in d['water'] if w['line'] and w['kind'] in ('canal', 'river')]
print('split lines', len(lines))
noded = shapely.union_all(shapely.GeometryCollection(lines), grid_size=0.05)
print('noded', f'{time.time()-t0:.0f}s')
polys = list(shapely.get_parts(shapely.polygonize(shapely.get_parts(noded))))
print('raw faces', len(polys), f'{time.time()-t0:.0f}s')
# clip faces to the corridor (projected bbox)
LAT0, LON0 = d['origin']; KX = math.cos(math.radians(LAT0)) * 111320.0; KZ = 110574.0
lon0, lat0, lon1, lat1 = d['bbox']
corr = box((lon0 - LON0) * KX, -(lat1 - LAT0) * KZ, (lon1 - LON0) * KX, -(lat0 - LAT0) * KZ)
blocks = []
for p in polys:
    if not p.is_valid: p = p.buffer(0)
    if p.area < 60: continue
    if not p.intersects(corr): continue
    blocks.append(p)
print('blocks', len(blocks), 'area km2', sum(b.area for b in blocks) / 1e6)
pickle.dump({'blocks': [list(b.exterior.coords)[:-1] for b in blocks if b.geom_type == 'Polygon'], 'corr': list(corr.exterior.coords)}, open('/home/claude/hl/pipe/blocks.pkl', 'wb'))
print(f'done {time.time()-t0:.0f}s')

# ---- inset every block by the carriageway and verge of the roads around it, so plots start at the kerb line
from shapely.strtree import STRtree
CLS = {'motorway': 1, 'trunk': 2, 'primary': 3, 'secondary': 4, 'tertiary': 5, 'unclassified': 6, 'residential': 7, 'living_street': 7, 'service': 8, 'motorway_link': 9, 'trunk_link': 9, 'primary_link': 10, 'secondary_link': 10, 'tertiary_link': 10, 'busway': 11, 'track': 12, 'road': 7}
def lanes_of(c, lanes, one):
    if lanes: return min(8, lanes)
    return {1: 3 if one else 6, 2: 3 if one else 4, 3: 2 if one else 4, 4: 2, 5: 2, 9: 1, 10: 1, 11: 1, 6: 2}.get(c, 1)
def half_width(c, lanes, one):
    if c == 7: return 2.9
    if c == 8: return 1.9
    if c == 12: return 1.7
    if c == 11: return 2.0
    return max(2.8, lanes_of(c, lanes, one) * 3.3 / 2 + (0.6 if c <= 2 else 0.2))
def verge(c):
    if c <= 4 or c in (9, 10): return 4.6
    if c in (5, 6): return 2.4
    if c == 7: return 1.2
    return 0.6
rl, rw = [], []
for r in d['roads']:
    c = CLS.get(r['hw'])
    if not c or r['bridge'] or r['tunnel'] or len(r['pts']) < 2: continue
    try: ln = int(float((r['lanes'] or '0').split(';')[0]))
    except: ln = 0
    one = r['oneway'] in ('yes', '1', 'true', '-1')
    rl.append(LineString(r['pts'])); rw.append(half_width(c, ln, one) + verge(c) + 0.3)
tree = STRtree(rl)
inset = []
t1 = time.time()
for k, bpts in enumerate(pickle.load(open('/home/claude/hl/pipe/blocks.pkl', 'rb'))['blocks']):
    P = Polygon(bpts)
    if not P.is_valid: P = P.buffer(0)
    near = tree.query(P.buffer(12))
    if len(near):
        cut = shapely.union_all([rl[i].buffer(rw[i], cap_style='flat' if False else 'round', quad_segs=2) for i in near])
        Q = P.difference(cut)
    else: Q = P
    for g in getattr(Q, 'geoms', [Q]):
        if g.geom_type == 'Polygon' and g.area > 80:
            g = g.simplify(0.4)
            if g.geom_type == 'Polygon' and g.area > 80: inset.append(list(g.exterior.coords)[:-1])
print('inset blocks', len(inset), f'{time.time()-t1:.0f}s')
pickle.dump({'blocks': inset}, open('/home/claude/hl/pipe/blocks.pkl', 'wb'))
