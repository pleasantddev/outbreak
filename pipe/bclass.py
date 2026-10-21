# Classifies every building (kind, storeys, height, roof, colours) with context from landuse and the road network.
# Runs in chunks so the 1.3 million footprints fit in memory. Writes bclass.pkl.
import numpy as np, shapely, pickle, os, time, gc
from shapely.geometry import Polygon, LineString
from shapely.strtree import STRtree
from common import *

AK = {'residential': 1, 'commercial': 2, 'retail': 2, 'industrial': 3, 'school': 4, 'university': 4, 'college': 4, 'hospital': 5, 'marketplace': 6, 'religious': 7, 'place_of_worship': 7, 'park': 8, 'grass': 8, 'pitch': 9, 'fuel': 10, 'parking': 11, 'bus_station': 12, 'farmland': 13, 'scrub': 14, 'wood': 14, 'forest': 14, 'grassland': 14, 'cemetery': 15, 'landfill': 16, 'brownfield': 17, 'construction': 17, 'military': 18, 'swimming_pool': 19, 'sports_centre': 9, 'stadium': 9, 'platform': 20, 'wetland': 21, 'aerodrome': 22, 'railway': 23, 'police': 24, 'garden': 8, 'village_green': 8, 'golf_course': 8, 'playground': 8, 'track': 9, 'clinic': 5}
AREA_KEYS = ('amenity', 'leisure', 'landuse', 'natural', 'public_transport', 'aeroway')
KEEP = ('amenity', 'shop', 'office', 'name', 'building', 'sport', 'operator', 'brand', 'tourism', 'aeroway', 'railway', 'public_transport', 'craft', 'leisure', 'religion', 'ref', 'man_made')
HERE = os.path.dirname(os.path.abspath(__file__))

def area_kind(t):
    for key in AREA_KEYS:
        if key in t and t[key] in AK: return AK[t[key]]
    if t.get('shop') in ('mall',): return 2
    return 0

def geom_of(b):
    try:
        p = Polygon(b['pts'])
        if not p.is_valid: p = shapely.make_valid(p)
        if p.geom_type != 'Polygon':
            parts = [g for g in shapely.get_parts(p) if g.geom_type == 'Polygon']
            p = max(parts, key=lambda g: g.area) if parts else Polygon()
    except Exception:
        p = Polygon()
    return p

def build_ctx(d):
    apolys, akind = [], []
    for a in d['areas']:
        k = area_kind(a['tags'])
        if not k or len(a['pts']) < 3: continue
        try:
            p = Polygon(a['pts'])
            if not p.is_valid: p = p.buffer(0)
            if p.geom_type != 'Polygon' or p.area < 20: continue
        except Exception: continue
        apolys.append(p); akind.append(k)
    major = [LineString(r['pts']) for r in d['roads'] if CLS.get(r['hw'], 99) in (1, 2, 3, 4, 9, 10) and len(r['pts']) > 1]
    return {'at': STRtree(apolys) if apolys else None, 'aarea': np.array([p.area for p in apolys]), 'akind': akind, 'mt': STRtree(major) if major else None}

def classify_chunk(ctx, blds, bg):
    n = len(blds)
    arr = np.array(bg, dtype=object)
    area = shapely.area(arr)
    cent = shapely.centroid(arr)
    cx = shapely.get_x(cent); cz = shapely.get_y(cent)
    pts = shapely.points(cx, cz)
    land = np.zeros(n, dtype=np.int16)
    if ctx['at'] is not None:
        ii, jj = ctx['at'].query(pts, predicate='within')
        order = np.argsort(-ctx['aarea'][jj])
        for i, j in zip(ii[order], jj[order]): land[i] = ctx['akind'][j]
    near_major = np.zeros(n, dtype=bool)
    if ctx['mt'] is not None:
        ii, jj = ctx['mt'].query(pts, predicate='dwithin', distance=35)
        near_major[np.unique(ii)] = True
    kind = np.zeros(n, dtype=np.uint8); lv = np.zeros(n, dtype=np.uint8); hdm = np.zeros(n, dtype=np.uint16)
    roof = np.zeros(n, dtype=np.uint8); wcol = [None] * n; rcol = [None] * n
    for i, b in enumerate(blds):
        t = b['t']; A = float(area[i]); bid = b['id']
        k = building_kind(t)
        r = h01(bid, 1)
        if k == 0:
            k = 1
            if land[i] == 3 or (A > 1500 and not near_major[i]): k = 5
            elif A < 18: k = 11
            elif near_major[i] and A > 25: k = 2
            elif land[i] in (4, 5): k = 8
            elif land[i] in (6,) and A > 40: k = 2
            elif land[i] == 2 and A > 60: k = 2
        l0 = explicit_levels(t)
        l = l0
        if not l:
            if k == 11: l = 1
            elif k == 5: l = 1
            elif k == 9: l = 1 + int(r * 3)
            elif k == 2: l = 1 + int(r * 3) + (1 if A > 300 else 0) + (2 if A > 1200 and r > 0.6 else 0)
            elif k == 8: l = 1 + int(r * 2)
            elif k in (6, 7): l = 1
            elif k == 13: l = 2 + int(r * 2)
            elif k == 14: l = 2
            elif k == 15: l = 1
            elif k == 16: l = 1 + int(r * 2)
            elif k == 4: l = 3 + int(r * 4)
            elif k == 3: l = 3 + int(r * 4) + (2 if A > 700 else 0)
            else:
                if A < 70: l = 1
                elif A < 160: l = 1 if r < 0.6 else 2
                elif A < 400: l = 1 if r < 0.3 else 2 if r < 0.75 else 3
                else: l = 2 + int(r * 3)
        l = max(1, min(60, l))
        h = 0.0
        if t.get('height'):
            h = parse_num(t['height'])
            if h <= 0 or h > 400: h = 0.0
        if h > 0:
            hdm[i] = min(65000, int(round(h * 10)))
            if not l0: l = max(1, min(60, int(round(h / 3.2))))
        kind[i] = k; lv[i] = l; roof[i] = roof_of(t)
        wcol[i] = parse_colour(t.get('building:colour')); rcol[i] = parse_colour(t.get('roof:colour'))
    return {'kind': kind, 'lv': lv, 'hdm': hdm, 'roof': roof, 'wcol': wcol, 'rcol': rcol, 'area': area, 'cx': cx, 'cz': cz, 'land': land}

if __name__ == '__main__':
    t0 = time.time()
    d = pickle.load(open(os.path.join(HERE, 'raw.pkl'), 'rb'))
    ctx = build_ctx(d)
    blds = pickle.load(open(os.path.join(HERE, 'bld.pkl'), 'rb'))
    n = len(blds); print('loaded', n, f'{time.time()-t0:.0f}s', flush=True)
    out = {k: [] for k in ('kind', 'lv', 'hdm', 'roof', 'area', 'cx', 'cz', 'land', 'rx', 'rz')}
    wcol, rcol, wkb, ids, names, tags = [], [], [], [], [], []
    CH = 100000
    for s in range(0, n, CH):
        chunk = blds[s:s + CH]
        bg = [geom_of(b) for b in chunk]
        c = classify_chunk(ctx, chunk, bg)
        for k in ('kind', 'lv', 'hdm', 'roof', 'area', 'cx', 'cz', 'land'): out[k].append(c[k])
        rep = shapely.point_on_surface(np.array(bg, dtype=object))
        out['rx'].append(shapely.get_x(rep)); out['rz'].append(shapely.get_y(rep))
        wcol.extend(c['wcol']); rcol.extend(c['rcol'])
        wkb.extend(shapely.to_wkb(g) for g in bg)
        ids.extend(b['id'] for b in chunk); names.extend(b['t'].get('name') for b in chunk)
        for b in chunk:
            t = b['t']
            tags.append({k: t[k] for k in KEEP if k in t} if any(k in t for k in ('amenity', 'shop', 'office', 'tourism', 'aeroway', 'railway', 'public_transport', 'craft', 'sport', 'man_made', 'leisure')) else None)
        blds[s:s + CH] = [None] * len(chunk)
        del bg, chunk, c; gc.collect()
        print('chunk', s // CH, f'{time.time()-t0:.0f}s', flush=True)
    R = {k: np.concatenate(v) for k, v in out.items()}
    R['wcol'] = wcol; R['rcol'] = rcol; R['wkb'] = wkb; R['ids'] = np.array(ids, dtype=np.int64); R['names'] = names; R['tags'] = tags
    pickle.dump(R, open(os.path.join(HERE, 'bclass.pkl'), 'wb'), protocol=4)
    print('bclass done', n, f'{time.time()-t0:.0f}s')
