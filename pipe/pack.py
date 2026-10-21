# Packs the corridor into 2 km region files (gzip binary) for streaming, plus a manifest and the pothole field.
# Map data (c) OpenStreetMap contributors, ODbL 1.0.
import pickle, math, struct, gzip, json, os, re, time, random, collections
import numpy as np
from shapely.geometry import Polygon, LineString, Point, box
from shapely.strtree import STRtree
t0 = time.time()
d = pickle.load(open('/home/claude/hl/pipe/raw.pkl', 'rb'))
B = pickle.load(open('/home/claude/hl/pipe/blocks.pkl', 'rb'))
OUT = '/home/claude/hl/v2/public/world'; os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.startswith('r') and f.endswith('.wasm'): os.remove(os.path.join(OUT, f))
LAT0, LON0 = d['origin']; KX = math.cos(math.radians(LAT0)) * 111320.0; KZ = 110574.0
def P(lon, lat): return ((lon - LON0) * KX, -(lat - LAT0) * KZ)
lon0, lat0, lon1, lat1 = d['bbox']
X0, Z0 = P(lon0, lat1); X1, Z1 = P(lon1, lat0)
RS = 2000.0
rx0, rz0, rx1, rz1 = math.floor(X0 / RS), math.floor(Z0 / RS), math.floor(X1 / RS), math.floor(Z1 / RS)
print('world', round(X0), round(Z0), round(X1), round(Z1), 'regions', (rx1 - rx0 + 1) * (rz1 - rz0 + 1))
rkey = lambda x, z: (math.floor(x / RS), math.floor(z / RS))
def inside_corr(x, z): return X0 <= x <= X1 and Z0 <= z <= Z1

CLS = {'motorway': 1, 'trunk': 2, 'primary': 3, 'secondary': 4, 'tertiary': 5, 'unclassified': 6, 'residential': 7, 'living_street': 7, 'service': 8, 'motorway_link': 9, 'trunk_link': 9, 'primary_link': 10, 'secondary_link': 10, 'tertiary_link': 10, 'busway': 11, 'track': 12, 'footway': 13, 'path': 13, 'pedestrian': 13, 'steps': 14, 'construction': 15, 'road': 7}
PAVED_HINT = {'asphalt', 'paved', 'concrete', 'paving_stones', 'concrete:plates', 'sett', 'interlock'}
UNPAVED = {'unpaved', 'dirt', 'ground', 'earth', 'gravel', 'sand', 'compacted', 'laterite', 'mud', 'fine_gravel'}
def h01(n, salt=0):
    x = (n * 2654435761 + salt * 97531) & 0xffffffff; x ^= x >> 15; x = (x * 2246822519) & 0xffffffff; x ^= x >> 13; return x / 4294967295.0

# ---------- strings
strings, sidx = [], {}
def S(s):
    if not s: return 0xffff
    s = s[:60]
    if s not in sidx: sidx[s] = len(strings); strings.append(s)
    return sidx[s]

# ---------- roads
roads = []
for r in d['roads']:
    c = CLS.get(r['hw'])
    if not c: continue
    lanes = 0
    try: lanes = int(float((r['lanes'] or '0').split(';')[0]))
    except: pass
    surf = (r['surface'] or '').lower()
    unp = surf in UNPAVED or (surf not in PAVED_HINT and c in (7, 8, 12) and h01(r['id'], 3) < (0.42 if c == 7 else 0.25 if c == 8 else 0.9))
    if c == 12: unp = True
    flags = (1 if r['oneway'] in ('yes', '1', 'true', '-1') else 0) | (2 if r['bridge'] and r['bridge'] != 'no' else 0) | (4 if r['tunnel'] and r['tunnel'] != 'no' else 0) | (8 if r['junction'] == 'roundabout' else 0) | (16 if unp else 0) | (32 if r['oneway'] == '-1' else 0)
    try: layer = int(float(r['layer'] or 0))
    except: layer = 0
    roads.append({'id': r['id'], 'c': c, 'lanes': lanes, 'flags': flags, 'layer': max(-5, min(5, layer)), 'name': r['name'], 'pts': r['pts']})
print('roads', len(roads))

# ---------- landuse lookup for buildings
area_polys, area_kind = [], []
AK = {'residential': 1, 'commercial': 2, 'retail': 2, 'industrial': 3, 'school': 4, 'university': 4, 'college': 4, 'hospital': 5, 'marketplace': 6, 'religious': 7, 'place_of_worship': 7, 'park': 8, 'grass': 8, 'pitch': 9, 'fuel': 10, 'parking': 11, 'bus_station': 12, 'farmland': 13, 'scrub': 14, 'wood': 14, 'forest': 14, 'grassland': 14, 'cemetery': 15, 'landfill': 16, 'brownfield': 17, 'construction': 17, 'military': 18, 'swimming_pool': 19, 'sports_centre': 9, 'stadium': 9, 'platform': 20, 'wetland': 21, 'aerodrome': 22, 'railway': 23, 'police': 24}
areas = []
for a in d['areas']:
    t = a['tags']; k = 0
    for key in ('amenity', 'leisure', 'landuse', 'natural', 'public_transport', 'aeroway'):
        if key in t and t[key] in AK: k = AK[t[key]]; break
    if not k or len(a['pts']) < 3: continue
    try:
        p = Polygon(a['pts']);
        if not p.is_valid: p = p.buffer(0)
        if p.geom_type != 'Polygon' or p.area < 20: continue
    except Exception: continue
    areas.append({'k': k, 'name': t.get('name'), 'poly': p})
    area_polys.append(p); area_kind.append(k)
atree = STRtree(area_polys) if area_polys else None
# major roads for "street front" commercial inference
major = [LineString(r['pts']) for r in roads if r['c'] in (1, 2, 3, 4, 9, 10) and len(r['pts']) > 1]
mtree = STRtree(major)
print('areas', len(areas), f'{time.time()-t0:.0f}s')

# ---------- buildings: kind, levels
BK = {'construction': 9, 'constructions': 9, 'church': 6, 'mosque': 7, 'hotel': 4, 'apartments': 3, 'commercial': 2, 'retail': 2, 'industrial': 5, 'warehouse': 5, 'school': 8, 'hospital': 8, 'roof': 10, 'hut': 11, 'shed': 11, 'kiosk': 11, 'garage': 11, 'grandstand': 12}
def poly_area(pts):
    a = 0
    for i in range(len(pts)):
        x1, z1 = pts[i]; x2, z2 = pts[(i + 1) % len(pts)]; a += x1 * z2 - x2 * z1
    return a / 2
bld = []
cent = []
for b in d['bld']:
    pts = b['pts']
    if len(pts) < 3: continue
    A = abs(poly_area(pts))
    if A < 4: continue
    cx = sum(p[0] for p in pts) / len(pts); cz = sum(p[1] for p in pts) / len(pts)
    if not inside_corr(cx, cz): continue
    kind = BK.get(b['b'], 1)  # 1 generic house
    if b['amenity'] == 'place_of_worship': kind = 6
    lv = 0
    try: lv = int(float(b['lv'])) if b['lv'] else 0
    except: lv = 0
    if not lv and b['h']:
        try: lv = max(1, round(float(re.sub('[^0-9.]', '', b['h'])) / 3.2))
        except: pass
    land = 0
    if atree is not None:
        for i in atree.query(Point(cx, cz)):
            if area_polys[i].contains(Point(cx, cz)): land = area_kind[i]; break
    near_major = False
    if A > 25:
        q = mtree.query(Point(cx, cz).buffer(35))
        near_major = any(major[i].distance(Point(cx, cz)) < 35 for i in q)
    r = h01(b['id'], 1)
    if kind == 1:
        if land == 3 or (A > 1500 and not near_major): kind = 5
        elif A < 18: kind = 11
        elif near_major: kind = 2
        elif land in (4, 5): kind = 8
    if not lv:
        if kind == 11: lv = 1
        elif kind == 5: lv = 1
        elif kind == 9: lv = 1 + int(r * 3)
        elif kind == 2: lv = 1 + int(r * 3) + (1 if A > 300 else 0) + (2 if A > 1200 and r > 0.6 else 0)
        elif kind == 8: lv = 1 + int(r * 2)
        elif kind in (6, 7): lv = 1
        else:
            if A < 70: lv = 1
            elif A < 160: lv = 1 if r < 0.6 else 2
            elif A < 400: lv = 1 if r < 0.3 else 2 if r < 0.75 else 3
            else: lv = 2 + int(r * 3)
    lv = max(1, min(40, lv))
    bld.append((cx, cz, kind, lv, pts, b['id'], b['name']))
print('buildings kept', len(bld), f'{time.time()-t0:.0f}s')

# ---------- potholes: reported clusters snapped to the named road + background wear
rep = json.load(open('/home/claude/hl/data/potholes_reports.json'))
def lonlat_to(lat, lon): return P(lon, lat)
named = [(r, LineString(r['pts'])) for r in roads if len(r['pts']) > 1 and r['c'] <= 10 or (r['c'] in (7, 8) and r['name'])]
ntree = STRtree([g for _, g in named])
potholes = []  # (x, z, radius, depth, reportIndex)
rng = random.Random(2026)
report_out = []
for ri, R in enumerate(rep['reports']):
    x, z = lonlat_to(R['lat'], R['lon'])
    rad = R.get('radius', 200)
    pat = re.compile(R['match'], re.I) if R.get('match') else None
    wide = [named[i] for i in ntree.query(Point(x, z).buffer(3000))]
    pick = [c for c in wide if pat and c[0]['name'] and pat.search(c[0]['name'])]
    if pick:
        best = min(pick, key=lambda c: c[1].distance(Point(x, z)))
        cp = best[1].interpolate(best[1].project(Point(x, z)))
        moved = Point(x, z).distance(cp)
        x, z = cp.x, cp.y
        pick = [c for c in pick if c[1].distance(Point(x, z)) < rad + 30]
    else:
        moved = 0
        cand = [named[i] for i in ntree.query(Point(x, z).buffer(rad + 250))]
        pick = sorted(cand, key=lambda c: (c[1].distance(Point(x, z)), c[0]['c']))[:3]
    if not pick: report_out.append({**R, 'placed': 0}); continue
    sev = R.get('severity', 2)
    year = 2026 if str(R.get('reported', '')).startswith('2026') else 2025 if str(R.get('reported', '')).startswith('2025') else 2020
    n = {3: 34, 2: 18, 1: 7}[sev] * (1.0 if year == 2026 else 0.7 if year == 2025 else 0.45)
    n = int(n * min(3.0, max(0.6, rad / 200)))
    placed = 0; tries = 0
    while placed < n and tries < n * 30:
        tries += 1
        rr, g = pick[rng.randrange(len(pick))]
        s = rng.random() * g.length
        p = g.interpolate(s)
        if p.distance(Point(x, z)) > rad: continue
        p2 = g.interpolate(min(g.length, s + 0.5)); tx, tz = p2.x - p.x, p2.y - p.y; tl = math.hypot(tx, tz) or 1
        lanes = rr['lanes'] or (4 if rr['c'] <= 3 else 2)
        half = max(2.5, lanes * 3.3 / 2) * (0.5 if rr['flags'] & 1 == 0 and rr['c'] > 3 else 0.9)
        off = (rng.random() * 2 - 1) * half * 0.85
        px, pz = p.x - tz / tl * off, p.y + tx / tl * off
        size = 0.35 + rng.random() ** 2 * (2.6 if sev == 3 else 1.6)
        depth = 0.06 + rng.random() * (0.22 if sev == 3 else 0.14)
        potholes.append((px, pz, size, depth, ri)); placed += 1
        # craters spawn satellites
        if size > 1.6 and rng.random() < 0.7:
            for _ in range(rng.randrange(1, 4)):
                a = rng.random() * 6.283; dd = size * (0.9 + rng.random())
                potholes.append((px + math.cos(a) * dd, pz + math.sin(a) * dd, 0.3 + rng.random() * 0.8, 0.05 + rng.random() * 0.1, ri))
    report_out.append({**R, 'placed': placed, 'snap_m': round(moved), 'x': round(x, 1), 'z': round(z, 1), 'road_used': sorted({c[0]['name'] or '' for c in pick})[:3]})
nrep = len(potholes)
# background wear on paved roads (unreported but plausible): rate per km by class
RATE = {3: 1.2, 4: 1.6, 5: 2.2, 6: 2.4, 7: 3.0, 8: 1.0, 10: 0.8}
for r in roads:
    if r['flags'] & 16 or r['flags'] & 2: continue
    rate = RATE.get(r['c'])
    if not rate or len(r['pts']) < 2: continue
    g = LineString(r['pts']); n = np.random.default_rng(r['id']).poisson(rate * g.length / 1000)
    for _ in range(n):
        s = rng.random() * g.length; p = g.interpolate(s)
        cx, cz = p.x, p.y
        if not inside_corr(cx, cz): continue
        potholes.append((cx + (rng.random() - 0.5) * 3, cz + (rng.random() - 0.5) * 3, 0.25 + rng.random() ** 3 * 1.2, 0.04 + rng.random() * 0.08, 255))
print('potholes reported', nrep, 'background', len(potholes) - nrep, f'{time.time()-t0:.0f}s')
json.dump({'compiled': rep['compiled'], 'reports': report_out, 'outside_current_map': rep['outside_current_map'], 'excluded': rep['excluded']}, open(f'{OUT}/potholes.json', 'w'), indent=1)

# ---------- POIs
PK = {'bus_stop': 1, 'fuel': 2, 'marketplace': 3, 'school': 4, 'hospital': 5, 'clinic': 5, 'pharmacy': 6, 'bank': 7, 'atm': 7, 'restaurant': 8, 'fast_food': 8, 'cafe': 8, 'bar': 9, 'pub': 9, 'nightclub': 9, 'place_of_worship': 10, 'police': 11, 'car_repair': 12, 'car_parts': 12, 'mechanic': 12, 'supermarket': 13, 'convenience': 13, 'mall': 13, 'hotel': 14, 'traffic_signals': 15, 'station': 16, 'bus_station': 17, 'street_lamp': 18}
pois = []
for p in d['poi']:
    t = p['tags']; k = 0
    for key in ('highway', 'amenity', 'shop', 'craft', 'railway', 'tourism', 'public_transport'):
        if key in t and t[key] in PK: k = PK[t[key]]; break
    if t.get('place'): k = 30 + {'city': 0, 'town': 1, 'suburb': 2, 'neighbourhood': 3, 'quarter': 3, 'village': 4, 'hamlet': 5, 'locality': 5}.get(t['place'], 5)
    if not k: k = 99 if t.get('name') else 0
    if not k: continue
    pois.append((p['p'][0], p['p'][1], k, t.get('name')))
print('pois', len(pois))

# ---------- regions
reg = collections.defaultdict(lambda: {'roads': [], 'bld': [], 'blocks': [], 'areas': [], 'water': [], 'rail': [], 'poi': [], 'ph': []})
def regions_touching(pts, margin=60):
    xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
    a = rkey(min(xs) - margin, min(zs) - margin); b = rkey(max(xs) + margin, max(zs) + margin)
    for i in range(a[0], b[0] + 1):
        for j in range(a[1], b[1] + 1):
            if rx0 <= i <= rx1 and rz0 <= j <= rz1: yield (i, j)
for r in roads:
    # split long roads into pieces of <= 120 points so a region only carries what touches it
    pts = r['pts']
    for k in range(0, len(pts) - 1, 120):
        seg = pts[k:k + 121]
        for key in regions_touching(seg): reg[key]['roads'].append((r, seg))
for b in bld: reg[rkey(b[0], b[1])]['bld'].append(b)
for bl in B['blocks']:
    cx = sum(p[0] for p in bl) / len(bl); cz = sum(p[1] for p in bl) / len(bl)
    if inside_corr(cx, cz): reg[rkey(cx, cz)]['blocks'].append(bl)
for a in areas:
    for key in regions_touching(list(a['poly'].exterior.coords), 0): reg[key]['areas'].append(a)
for w in d['water']:
    for key in regions_touching(w['pts'], 0): reg[key]['water'].append(w)
for r in d['rail']:
    for key in regions_touching(r['pts'], 0): reg[key]['rail'].append(r)
for p in pois:
    if inside_corr(p[0], p[1]): reg[rkey(p[0], p[1])]['poi'].append(p)
for ph in potholes: reg[rkey(ph[0], ph[1])]['ph'].append(ph)

def q16(v): return max(-32767, min(32767, int(round(v * 10))))
manifest = {'origin': {'lat': LAT0, 'lon': LON0}, 'regionSize': RS, 'bounds': [X0, Z0, X1, Z1], 'regions': {}, 'attribution': 'Map data (c) OpenStreetMap contributors, ODbL 1.0', 'osm_timestamp': '2026-10-16'}
total = 0
for (i, j), R in sorted(reg.items()):
    ox, oz = (i + 0.5) * RS, (j + 0.5) * RS
    rb = box(i * RS - 5, j * RS - 5, (i + 1) * RS + 5, (j + 1) * RS + 5)
    out = bytearray(); w = out.extend
    loc = {}; lstr = []
    def LS(s):
        if not s: return 0xffff
        s = s[:60]
        if s not in loc: loc[s] = len(lstr); lstr.append(s)
        return loc[s]
    body = bytearray()
    # roads (int32 dm relative to region centre)
    body += struct.pack('<I', len(R['roads']))
    for r, seg in R['roads']:
        body += struct.pack('<BBBbHH', r['c'], min(255, r['lanes']), r['flags'], r['layer'], LS(r['name']), len(seg))
        body += struct.pack(f'<I', r['id'] & 0xffffffff)
        for x, z in seg: body += struct.pack('<ii', int(round((x - ox) * 10)), int(round((z - oz) * 10)))
    # buildings
    body += struct.pack('<I', len(R['bld']))
    for cx, cz, kind, lv, pts, bid, name in R['bld']:
        pts = pts[:250]
        body += struct.pack('<BBBH', kind, lv, len(pts), LS(name)); body += struct.pack('<I', bid & 0xffffffff)
        for x, z in pts: body += struct.pack('<hh', q16(x - ox), q16(z - oz))
    # blocks
    body += struct.pack('<I', len(R['blocks']))
    for bl in R['blocks']:
        bl = bl[:2000]
        body += struct.pack('<H', len(bl))
        for x, z in bl: body += struct.pack('<ii', int(round((x - ox) * 10)), int(round((z - oz) * 10)))
    # areas (clipped)
    al = []
    for a in R['areas']:
        g = a['poly'].intersection(rb)
        for gg in getattr(g, 'geoms', [g]):
            if gg.geom_type == 'Polygon' and gg.area > 10: al.append((a['k'], a['name'], list(gg.exterior.coords)[:-1]))
    body += struct.pack('<I', len(al))
    for k, name, pts in al:
        pts = pts[:4000]
        body += struct.pack('<BHH', k, LS(name), len(pts))
        for x, z in pts: body += struct.pack('<hh', q16(x - ox), q16(z - oz))
    # water: lines and polys
    body += struct.pack('<I', len(R['water']))
    WK = {'drain': 1, 'ditch': 1, 'stream': 2, 'canal': 3, 'river': 4, 'water': 5, 'wetland': 6, 'reservoir': 5, 'basin': 5}
    for wv in R['water']:
        pts = wv['pts'][:4000]
        body += struct.pack('<BBHH', WK.get(wv['kind'], 2), 1 if wv['line'] else 0, LS(wv['name']), len(pts))
        for x, z in pts: body += struct.pack('<ii', int(round((x - ox) * 10)), int(round((z - oz) * 10)))
    # rail
    body += struct.pack('<I', len(R['rail']))
    for rv in R['rail']:
        pts = rv['pts']
        body += struct.pack('<BBHH', {'rail': 1, 'platform': 2}.get(rv['kind'], 3), 1 if rv['bridge'] else 0, LS(rv['name']), len(pts))
        for x, z in pts: body += struct.pack('<ii', int(round((x - ox) * 10)), int(round((z - oz) * 10)))
    # pois
    body += struct.pack('<I', len(R['poi']))
    for x, z, k, name in R['poi']: body += struct.pack('<BHhh', k, LS(name), q16(x - ox), q16(z - oz))
    # potholes
    body += struct.pack('<I', len(R['ph']))
    for x, z, s, dp, ri in R['ph']: body += struct.pack('<hhBBB', q16(x - ox), q16(z - oz), min(255, int(s * 40)), min(255, int(dp * 400)), ri)
    head = bytearray(b'HLR1') + struct.pack('<hhH', i, j, len(lstr))
    for s in lstr:
        e = s.encode('utf8'); head += struct.pack('<H', len(e)) + e
    blob = gzip.compress(bytes(head + body), 6)
    fn = f'r{i}_{j}.wasm'
    open(f'{OUT}/{fn}', 'wb').write(blob)
    total += len(blob)
    manifest['regions'][f'{i},{j}'] = {'f': fn, 'b': len(R['bld']), 'r': len(R['roads']), 'kb': round(len(blob) / 1024)}
json.dump(manifest, open(f'{OUT}/manifest.json', 'w'))
print('regions written', len(reg), 'total MB', round(total / 1e6, 1), f'{time.time()-t0:.0f}s')
