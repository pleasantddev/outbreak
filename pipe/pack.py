# Packs the corridor into 2 km region files (HLR2, gzip binary) for streaming, plus a manifest and the pothole field.
# Inputs: raw.pkl (extract.py), bclass.pkl (bclass.py), parcels.pkl (parcels.py), data/potholes_reports.json, sites.json.
# Map data (c) OpenStreetMap contributors, ODbL 1.0.
import pickle, math, struct, gzip, json, os, re, time, random, collections
import numpy as np, shapely
from shapely.geometry import Polygon, LineString, Point, box
from shapely.strtree import STRtree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra, connected_components
from common import *
import bclass as BC

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
t0 = time.time()
def log(*a): print(*a, f'{time.time()-t0:.0f}s', flush=True)
d = pickle.load(open(os.path.join(HERE, 'raw.pkl'), 'rb'))
OUT = os.path.join(ROOT, 'v2', 'public', 'world'); os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.wasm') or f == 'manifest.json': os.remove(os.path.join(OUT, f))
LAT0, LON0 = d['origin']; KX = math.cos(math.radians(LAT0)) * 111320.0; KZ = 110574.0
def P(lon, lat): return ((lon - LON0) * KX, -(lat - LAT0) * KZ)
lon0, lat0, lon1, lat1 = d['bbox']
X0, Z0 = P(lon0, lat1); X1, Z1 = P(lon1, lat0)
RS = 2000.0
rx0, rz0, rx1, rz1 = math.floor(X0 / RS), math.floor(Z0 / RS), math.floor(X1 / RS), math.floor(Z1 / RS)
rkey = lambda x, z: (math.floor(x / RS), math.floor(z / RS))
def inside_corr(x, z): return X0 <= x <= X1 and Z0 <= z <= Z1
CORR = box(X0, Z0, X1, Z1)
def sid(bid): return (0x80000000 | (bid - 10_000_000_000)) if bid >= 10_000_000_000 else bid

PAVED_HINT = {'asphalt', 'paved', 'concrete', 'paving_stones', 'concrete:plates', 'sett', 'interlock'}
UNPAVED = {'unpaved', 'dirt', 'ground', 'earth', 'gravel', 'sand', 'compacted', 'laterite', 'mud', 'fine_gravel'}
def isbridge(v): return v not in (None, 'no')

# ---------- strings
strings, sidx = [], {}

# ---------- roads
roads = []
for r in d['roads']:
    c = CLS.get(r['hw'])
    if not c: continue
    if r.get('tunnel') not in (None, 'no'): continue
    lanes = 0
    try: lanes = int(float((r.get('lanes') or '0').split(';')[0]))
    except Exception: pass
    surf = (r.get('surface') or '').lower()
    unp = surf in UNPAVED or (surf not in PAVED_HINT and c in (7, 8, 12) and h01(r['id'], 3) < (0.42 if c == 7 else 0.25 if c == 8 else 0.9))
    if c == 12: unp = True
    br = isbridge(r.get('bridge'))
    flags = (1 if r.get('oneway') in ('yes', '1', 'true', '-1') else 0) | (2 if br else 0) | (8 if r.get('junction') == 'roundabout' else 0) | (16 if unp else 0) | (32 if r.get('oneway') == '-1' else 0)
    try: layer = int(float(r.get('layer') or 0))
    except Exception: layer = 0
    wd = parse_num(r.get('width'))
    roads.append({'id': r['id'], 'c': c, 'lanes': lanes, 'flags': flags, 'layer': max(-5, min(5, layer)), 'name': r.get('name'), 'pts': r['pts'], 'wd': int(min(120, round(wd * 2))) if 0.8 < wd < 60 else 0, 'bridge': br, 'bridge_kind': r.get('bridge')})
log('roads', len(roads))

# ---------- rails
rails = []
for r in d['rail']:
    rw = r['railway']
    if r.get('tunnel') not in (None, 'no') and rw != 'platform': continue
    if rw in ('construction', 'proposed', 'signal', 'buffer_stop', 'switch', 'crossing', 'level_crossing'): continue
    if rw == 'platform' or rw == 'platform_edge': kind = 6
    elif rw == 'station': kind = 7
    elif rw in ('disused', 'abandoned'): kind = 5
    elif rw in ('light_rail', 'subway', 'tram', 'monorail'): kind = 3
    elif rw == 'narrow_gauge': kind = 2
    elif rw == 'rail': kind = 1 if (r.get('gauge') or '') in ('1435', '1432', '1437') else 2
    else: continue
    try: gauge = int(float((r.get('gauge') or '0').split(';')[0]))
    except Exception: gauge = 0
    if gauge == 0: gauge = 1435 if kind == 1 else 1067 if kind in (2, 5) else 1435
    br = isbridge(r.get('bridge')) and kind in (1, 2, 3, 5)
    try: layer = int(float(r.get('layer') or 0))
    except Exception: layer = 0
    if kind == 3 and layer >= 2 and r.get('bridge') in ('viaduct', 'yes'): br = True
    svc = r.get('service')
    flags = (1 if br else 0) | (4 if svc else 0) | (8 if r['closed'] else 0) | (16 if (r.get('electrified') or 'no') != 'no' else 0)
    rails.append({'id': r['id'], 'kind': kind, 'flags': flags, 'gauge': gauge, 'name': r.get('name'), 'pts': r['pts'], 'layer': layer, 'bridge': br, 'bridge_kind': r.get('bridge'), 'service': svc})
log('rails', len(rails), collections.Counter(r['kind'] for r in rails))

# ---------- water
water_polys = []
bigwater = []
for w in d['water']:
    if w['line'] or len(w['pts']) < 3: continue
    p = Polygon(w['pts'], w['holes'])
    if not p.is_valid: p = p.buffer(0)
    if p.is_empty: continue
    p = p.simplify(1.5)
    water_polys.append((w, p))
    if p.area > 100000 and w['kind'] in ('water', 'riverbank'): bigwater.append(p)
lagoon = shapely.union_all(bigwater) if bigwater else None
if lagoon is not None: shapely.prepare(lagoon)

# ---------- bridge elevation (roads and rails share one graph; ground nodes are where bridges descend)
def kq(x, z): return (int(round(x * 2)), int(round(z * 2)))
def compute_elev():
    ways = []  # (kind, ref, pts, layer, bridge_kind)
    for r in roads:
        if r['bridge']: ways.append(('r', r, r['pts'], r['layer'], r['bridge_kind']))
    for r in rails:
        if r['bridge']: ways.append(('l', r, r['pts'], r['layer'], r['bridge_kind']))
    if not ways: return
    ground = set()
    glines = []
    for r in roads:
        if not r['bridge'] and r['c'] <= 10:
            for p in r['pts']: ground.add(kq(*p))
            glines.append(LineString(r['pts']))
    for r in rails:
        if not r['bridge'] and r['kind'] in (1, 2, 3, 5) and not (r['flags'] & 8):
            for p in r['pts']: ground.add(kq(*p))
            glines.append(LineString(r['pts']))
    gt = STRtree(glines)
    wlines = [LineString(w['pts']) for w in d['water'] if w['line'] and w['kind'] in ('canal', 'river', 'drain', 'stream') and len(w['pts']) > 1]
    wtree = STRtree(wlines)
    nid = {}; edges = []; nodeway = collections.defaultdict(set)
    def N(p):
        k = kq(*p)
        if k not in nid: nid[k] = len(nid)
        return nid[k]
    wcap = []
    for wi, (kd, ref, pts, layer, bk) in enumerate(ways):
        ls = LineString(pts)
        cap = 0.0
        # what does it cross
        hit = gt.query(ls)
        cr = any(ls.crosses(glines[int(i)]) for i in hit)
        if cr: cap = max(cap, 6.4)
        if lagoon is not None and ls.intersects(lagoon) and ls.intersection(lagoon).length > 250: cap = max(cap, 14.0)
        else:
            wh = wtree.query(ls)
            if any(ls.crosses(wlines[int(i)]) for i in wh): cap = max(cap, 2.6)
        if layer >= 2: cap = max(cap, 6.4 * layer)
        if bk == 'viaduct': cap = max(cap, 6.0 if kd == 'r' else 7.5)
        wcap.append(cap)
        prev = None
        for p in pts:
            n = N(p); nodeway[n].add(wi)
            if prev is not None and prev != n:
                edges.append((prev, n, math.hypot(p[0] - pp[0], p[1] - pp[1])))
            prev = n; pp = p
    n = len(nid)
    rows = [e[0] for e in edges] + [e[1] for e in edges]; cols = [e[1] for e in edges] + [e[0] for e in edges]; w = [e[2] for e in edges] * 2
    G = coo_matrix((w, (rows, cols)), shape=(n, n)).tocsr()
    srcs = [i for k, i in nid.items() if k in ground]
    # bridge ends with no ground road attached still descend
    deg = np.asarray((G > 0).sum(axis=1)).ravel()
    for i in range(n):
        if deg[i] <= 1 and i not in srcs: srcs.append(i)
    dist = dijkstra(G, directed=False, indices=srcs, min_only=True) if srcs else np.full(n, 0.0)
    ncomp, lab = connected_components(G, directed=False)
    comp_cap = collections.defaultdict(float)
    for wi, (kd, ref, pts, layer, bk) in enumerate(ways):
        comp_cap[lab[N(pts[0])]] = max(comp_cap[lab[N(pts[0])]], wcap[wi])
    for wi, (kd, ref, pts, layer, bk) in enumerate(ways):
        cap = comp_cap[lab[N(pts[0])]] or (1.5 if layer >= 1 else 1.0)
        ys = []
        for p in pts:
            dd = dist[N(p)]
            if not np.isfinite(dd): dd = 0
            ys.append(max(0.2, min(cap, 0.055 * dd + 0.15)))
        ref['elev'] = [int(round(y * 10)) for y in ys]
    log('bridge ways', len(ways), 'components', len(comp_cap))
compute_elev()

# ---------- buildings
BCL = pickle.load(open(os.path.join(HERE, 'bclass.pkl'), 'rb'))
log('bclass loaded', len(BCL['kind']))
KIND = BCL['kind']; LV = BCL['lv']; HDM = BCL['hdm']; ROOFS = BCL['roof']; AREAS = BCL['area']; CX = BCL['cx']; CZ = BCL['cz']; IDS = BCL['ids']; NAMES = BCL['names']

# ---------- areas
AREA_SPORT = {'basketball': 1, 'soccer': 2, 'football': 2, 'tennis': 3, 'athletics': 4, 'volleyball': 5, 'cricket': 6, 'multi': 7, 'swimming': 8, 'futsal': 2, 'handball': 5, 'netball': 1, 'running': 4}
areas = []
for a in d['areas']:
    t = a['tags']; k = BC.area_kind(t)
    if not k or len(a['pts']) < 3: continue
    try:
        p = Polygon(a['pts'])
        if not p.is_valid: p = p.buffer(0)
        if p.geom_type != 'Polygon' or p.area < 20: continue
    except Exception: continue
    sub = 0
    if k == 9: sub = AREA_SPORT.get((t.get('sport') or '').split(';')[0], 0)
    areas.append({'k': k, 'sub': sub, 'name': t.get('name'), 'poly': p, 'tags': t})
# hand-placed sites (mechanic villages and similar) that OSM does not map as areas
SITES = os.path.join(HERE, 'sites.json')
if os.path.exists(SITES):
    for s in json.load(open(SITES)):
        pts = [P(lo, la) for la, lo in s['poly']]
        areas.append({'k': s['kind'], 'sub': 0, 'name': s['name'], 'poly': Polygon(pts), 'tags': {}})
# sports pitches mapped as buildings (leisure=pitch + building=yes): draw them as pitches, not as boxes
SKIP_B = set()
for i, t in enumerate(BCL['tags']):
    if not t or 'sport' not in t: continue
    sp = AREA_SPORT.get(t['sport'].split(';')[0], 0)
    if not sp or sp in (4, 6, 8) or t.get('leisure') not in ('pitch', 'sports_centre', None): continue
    if t.get('leisure') != 'pitch' and not t.get('building'): continue
    g = shapely.from_wkb(BCL['wkb'][i])
    if g.geom_type != 'Polygon' or g.area < 40 or g.area > 6000: continue
    if t.get('leisure') == 'pitch': SKIP_B.add(i)
    areas.append({'k': 9, 'sub': sp, 'name': t.get('name'), 'poly': g, 'tags': t})
log('pitch buildings', len(SKIP_B))
log('areas', len(areas))

# ---------- POIs
PK = {'bus_stop': 1, 'fuel': 2, 'marketplace': 3, 'school': 4, 'hospital': 5, 'clinic': 5, 'pharmacy': 6, 'bank': 7, 'restaurant': 8, 'fast_food': 8, 'cafe': 8, 'bar': 9, 'pub': 9, 'nightclub': 9, 'place_of_worship': 10, 'police': 11, 'car_repair': 12, 'car_parts': 12, 'tyres': 12, 'mechanic': 12, 'supermarket': 13, 'convenience': 13, 'mall': 13, 'hotel': 14, 'traffic_signals': 15, 'station': 16, 'halt': 16, 'bus_station': 17, 'street_lamp': 18, 'atm': 19, 'car_wash': 20, 'ferry_terminal': 21}
pois = []
for p in d['poi']:
    t = p['tags']; k = 0
    for key in ('highway', 'amenity', 'shop', 'craft', 'railway', 'tourism', 'public_transport'):
        if key in t and t[key] in PK: k = PK[t[key]]; break
    if t.get('place'): k = 30 + {'city': 0, 'town': 1, 'suburb': 2, 'neighbourhood': 3, 'quarter': 3, 'village': 4, 'hamlet': 5, 'locality': 5}.get(t['place'], 5)
    if not k: k = 99 if t.get('name') else 0
    if not k: continue
    pois.append((p['p'][0], p['p'][1], k, t.get('name') or t.get('brand') or t.get('operator')))
log('pois', len(pois))

# ---------- bank branches: a bank node claims the building it stands in (or the closest within 25 m); otherwise a small branch is added
from scipy.spatial import cKDTree
_tree = cKDTree(np.c_[CX, CZ]); EXTRA = []; _claimed = set(); _nb = [0, 0, 0]
_rl = [LineString(r['pts']) for r in roads if r['c'] <= 8 and len(r['pts']) > 1]; _rt = shapely.STRtree(_rl) if _rl else None
for x, z, k, name in pois:
    if k != 7 or not inside_corr(x, z): continue
    pt = Point(x, z); best = None; bd = 1e9
    for ci in _tree.query_ball_point([x, z], 30):
        if AREAS[ci] < 25 or AREAS[ci] > 2500 or ci in _claimed: continue
        g = shapely.from_wkb(BCL['wkb'][ci]); dd = 0.0 if g.contains(pt) else g.distance(pt)
        if dd < bd: bd = dd; best = ci
    if best is not None and bd <= 25:
        _claimed.add(best); KIND[best] = 13
        if name and not NAMES[best]: NAMES[best] = name
        if LV[best] < 1: LV[best] = 1
        _nb[0 if bd == 0 else 1] += 1; continue
    ang = 0.0
    if _rt is not None:
        ni = _rt.nearest(pt); ln = _rl[int(ni)]; q = ln.project(pt); a0 = ln.interpolate(max(0, q - 1)); a1 = ln.interpolate(q + 1); ang = math.atan2(a1.y - a0.y, a1.x - a0.x)
    c, s_ = math.cos(ang), math.sin(ang); hl, hw = 6.5, 4.5
    ring = [(x + lx * c - lz * s_, z + lx * s_ + lz * c) for lx, lz in ((-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw))]
    EXTRA.append({'kind': 13, 'lv': 1, 'ring': ring, 'name': name, 'id': 0x7ff00000 + len(EXTRA), 'x': x, 'z': z}); _nb[2] += 1
log('bank branches: in building', _nb[0], 'nearest building', _nb[1], 'synthetic', _nb[2])

# ---------- potholes (reported clusters snapped to the named road, plus background wear)
rep = json.load(open(os.path.join(ROOT, 'data', 'potholes_reports.json')))
named = [(r, LineString(r['pts'])) for r in roads if len(r['pts']) > 1 and not r['bridge'] and (r['c'] <= 10 or (r['c'] in (7, 8) and r['name']))]
ntree = STRtree([g for _, g in named])
potholes = []
rng = random.Random(2026)
report_out = []
for ri, R in enumerate(rep['reports']):
    x, z = P(R['lon'], R['lat'])
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
        if size > 1.6 and rng.random() < 0.7:
            for _ in range(rng.randrange(1, 4)):
                a = rng.random() * 6.283; dd = size * (0.9 + rng.random())
                potholes.append((px + math.cos(a) * dd, pz + math.sin(a) * dd, 0.3 + rng.random() * 0.8, 0.05 + rng.random() * 0.1, ri))
    report_out.append({**R, 'placed': placed, 'snap_m': round(moved), 'x': round(x, 1), 'z': round(z, 1), 'road_used': sorted({c[0]['name'] or '' for c in pick})[:3]})
nrep = len(potholes)
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
log('potholes reported', nrep, 'background', len(potholes) - nrep)
json.dump({'compiled': rep['compiled'], 'reports': report_out, 'outside_current_map': rep['outside_current_map'], 'excluded': rep['excluded']}, open(f'{OUT}/potholes.json', 'w'), indent=1)

# ---------- parcels
PARCELS = pickle.load(open(os.environ.get('HL_PARCELS') or os.path.join(HERE, 'parcels.pkl'), 'rb'))
log('parcels', len(PARCELS))

# ---------- bucket everything by region
reg = collections.defaultdict(lambda: {'roads': [], 'bld': [], 'parcels': [], 'areas': [], 'water': [], 'rail': [], 'poi': [], 'ph': []})
def regions_touching(pts, margin=60):
    xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
    a = rkey(min(xs) - margin, min(zs) - margin); b = rkey(max(xs) + margin, max(zs) + margin)
    for i in range(a[0], b[0] + 1):
        for j in range(a[1], b[1] + 1):
            if rx0 <= i <= rx1 and rz0 <= j <= rz1: yield (i, j)
for r in roads:
    pts = r['pts']
    for k in range(0, len(pts) - 1, 120):
        seg = pts[k:k + 121]
        el = r['elev'][k:k + 121] if r.get('elev') else None
        for key in regions_touching(seg): reg[key]['roads'].append((r, seg, el))
for r in rails:
    for key in regions_touching(r['pts'], 30): reg[key]['rail'].append(r)
for pc in PARCELS:
    if inside_corr(pc['cx'], pc['cz']): reg[rkey(pc['cx'], pc['cz'])]['parcels'].append(pc)
for a in areas:
    for key in regions_touching(list(a['poly'].exterior.coords), 0): reg[key]['areas'].append(a)
for w, p in water_polys:
    for key in regions_touching(list(p.exterior.coords), 0): reg[key]['water'].append((w, p))
for w in d['water']:
    if w['line']:
        for key in regions_touching(w['pts'], 0): reg[key]['water'].append((w, None))
for p in pois:
    if inside_corr(p[0], p[1]): reg[rkey(p[0], p[1])]['poi'].append(p)
for ph in potholes: reg[rkey(ph[0], ph[1])]['ph'].append(ph)
nb = 0
valid = np.nonzero((AREAS >= 4) & (CX >= X0) & (CX <= X1) & (CZ >= Z0) & (CZ <= Z1))[0]
for i in valid:
    if int(i) in SKIP_B: continue
    reg[rkey(CX[i], CZ[i])]['bld'].append(int(i)); nb += 1
for k, e in enumerate(EXTRA):
    if inside_corr(e['x'], e['z']): reg[rkey(e['x'], e['z'])]['bld'].append(-1 - k); nb += 1
log('bucketed buildings', nb, 'regions', len(reg))

def q16(v): return max(-32767, min(32767, int(round(v * 10))))
def i32(v): return int(round(v * 10))
WK = {'drain': 1, 'ditch': 1, 'stream': 2, 'canal': 3, 'river': 4, 'water': 5, 'wetland': 6, 'reservoir': 5, 'basin': 5, 'bay': 5, 'riverbank': 4, 'dock': 5}
def encode_id(pid, S):
    if pid[0] == 'B' and pid[1:].isdigit() and int(pid[1:]) < 2**31 - 1: return 0, int(pid[1:]), 0
    m = re.fullmatch(r'([LV])(-?\d+)_(-?\d+)', pid)
    if m: return (1 if m.group(1) == 'L' else 2), int(m.group(2)), int(m.group(3))
    return 3, S(pid), 0

manifest = {'version': 2, 'origin': {'lat': LAT0, 'lon': LON0}, 'regionSize': RS, 'bounds': [X0, Z0, X1, Z1], 'regions': {}, 'attribution': 'Map data (c) OpenStreetMap contributors, ODbL 1.0', 'osm_timestamp': '2026-10-20'}
total = 0
for (i, j), R in sorted(reg.items()):
    ox, oz = (i + 0.5) * RS, (j + 0.5) * RS
    rb = box(i * RS - 5, j * RS - 5, (i + 1) * RS + 5, (j + 1) * RS + 5)
    wb = box(i * RS - 40, j * RS - 40, (i + 1) * RS + 40, (j + 1) * RS + 40)
    loc = {}; lstr = []
    def LS(s):
        if not s: return 0xffff
        s = s[:60]
        if s not in loc: loc[s] = len(lstr); lstr.append(s)
        return loc[s]
    body = bytearray()
    body += struct.pack('<I', len(R['roads']))
    for r, seg, el in R['roads']:
        body += struct.pack('<BBBbHHI', r['c'], min(255, r['lanes']), r['flags'], r['layer'], LS(r['name']), len(seg), r['id'] & 0xffffffff)
        body += struct.pack('<B', r['wd'])
        for x, z in seg: body += struct.pack('<ii', i32(x - ox), i32(z - oz))
        if r['flags'] & 2:
            body += struct.pack(f'<{len(seg)}h', *(el or [10] * len(seg)))
    body += struct.pack('<I', len(R['bld']))
    for bi in R['bld']:
        if bi < 0:
            e = EXTRA[-1 - bi]; ring = np.asarray(e['ring'])
            body += struct.pack('<BBBBHBHI', 13, 1, len(ring), 0, 0, 0, LS(e['name']), e['id'])
            for x, z in ring: body += struct.pack('<hh', q16(x - ox), q16(z - oz))
            continue
        g = shapely.from_wkb(BCL['wkb'][bi])
        ring = np.asarray(g.exterior.coords)[:-1] if g.geom_type == 'Polygon' else np.zeros((0, 2))
        if len(ring) > 60:
            gs = g.simplify(0.2)
            if gs.geom_type == 'Polygon' and not gs.is_empty: ring = np.asarray(gs.exterior.coords)[:-1]
        ring = ring[:250]
        wc = BCL['wcol'][bi]; rc = BCL['rcol'][bi]
        cf = (1 if wc else 0) | (2 if rc else 0)
        body += struct.pack('<BBBBHBHI', int(KIND[bi]), int(LV[bi]), len(ring), int(ROOFS[bi]), int(HDM[bi]), cf, LS(NAMES[bi]), sid(int(IDS[bi])) & 0xffffffff)
        for x, z in ring: body += struct.pack('<hh', q16(x - ox), q16(z - oz))
        if wc: body += bytes(wc)
        if rc: body += bytes(rc)
    body += struct.pack('<I', len(R['parcels']))
    for pc in R['parcels']:
        idt, a, b = encode_id(pc['id'], LS)
        pts = pc['pts'][:120]
        body += struct.pack('<BiiBBBHH', idt, a, b, pc['zone'], min(255, int(pc['rich'] * 255)), len(pts), LS(pc['name']), len(pc['bids']))
        if pc['bids']: body += struct.pack(f"<{len(pc['bids'])}I", *[sid(x) & 0xffffffff for x in pc['bids']])
        for x, z in pts: body += struct.pack('<hh', q16(x - ox), q16(z - oz))
    al = []
    for a in R['areas']:
        g = a['poly'].intersection(rb)
        for gg in getattr(g, 'geoms', [g]):
            if gg.geom_type == 'Polygon' and gg.area > 10: al.append((a['k'], a['sub'], a['name'], list(gg.exterior.coords)[:-1]))
    body += struct.pack('<I', len(al))
    for k, sub, name, pts in al:
        pts = pts[:4000]
        body += struct.pack('<BBHH', k, sub, LS(name), len(pts))
        for x, z in pts: body += struct.pack('<hh', q16(x - ox), q16(z - oz))
    wl = []
    for w, p in R['water']:
        if p is None:
            wl.append((WK.get(w['kind'], 2), 1, w['name'], [w['pts'][:4000]]))
        else:
            g = shapely.clip_by_rect(p, i * RS - 40, j * RS - 40, (i + 1) * RS + 40, (j + 1) * RS + 40)
            for gg in getattr(g, 'geoms', [g]):
                if gg.geom_type == 'Polygon' and gg.area > 15:
                    rings = [list(gg.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in gg.interiors if Polygon(r).area > 15]
                    wl.append((WK.get(w['kind'], 5), 0, w['name'], rings))
    body += struct.pack('<I', len(wl))
    for k, ln, name, rings in wl:
        body += struct.pack('<BBHB', k, ln, LS(name), len(rings))
        for ring in rings:
            body += struct.pack('<H', len(ring))
            for x, z in ring: body += struct.pack('<ii', i32(x - ox), i32(z - oz))
    body += struct.pack('<I', len(R['rail']))
    for rv in R['rail']:
        pts = rv['pts'][:4000]
        body += struct.pack('<BBHHH', rv['kind'], rv['flags'], rv['gauge'], LS(rv['name']), len(pts))
        for x, z in pts: body += struct.pack('<ii', i32(x - ox), i32(z - oz))
        if rv['flags'] & 1: body += struct.pack(f'<{len(pts)}h', *(rv.get('elev') or [60] * len(pts))[:len(pts)])
    body += struct.pack('<I', len(R['poi']))
    for x, z, k, name in R['poi']: body += struct.pack('<BHhh', k, LS(name), q16(x - ox), q16(z - oz))
    body += struct.pack('<I', len(R['ph']))
    for x, z, s, dp, ri in R['ph']: body += struct.pack('<hhBBB', q16(x - ox), q16(z - oz), min(255, int(s * 40)), min(255, int(dp * 400)), ri)
    head = bytearray(b'HLR2') + struct.pack('<hhH', i, j, len(lstr))
    for s in lstr:
        e = s.encode('utf8'); head += struct.pack('<H', len(e)) + e
    blob = gzip.compress(bytes(head + body), 6)
    fn = f'r{i}_{j}.wasm'
    open(f'{OUT}/{fn}', 'wb').write(blob)
    total += len(blob)
    manifest['regions'][f'{i},{j}'] = {'f': fn, 'b': len(R['bld']), 'r': len(R['roads']), 'kb': round(len(blob) / 1024), 'p': len(R['parcels'])}
    print('region', i, j, 'bld', len(R['bld']), 'parcels', len(R['parcels']), 'kb', round(len(blob) / 1024), f'{time.time()-t0:.0f}s', flush=True)
json.dump(manifest, open(f'{OUT}/manifest.json', 'w'))
log('regions written', len(reg), 'total MB', round(total / 1e6, 1))
