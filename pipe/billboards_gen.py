# Writes v2/src/data/billboards.json: every sellable billboard face in the city, Oshodi Transport Interchange first, then the main roads and rooftops.
# Inputs: the corridor OSM extract (same projection as pipe/extract.py, same min-area rectangle as world/geo.ts obb()) and pipe/bridge_elev.json
# (real deck heights, dumped from the running game by elevdump.py so boards on bridges sit on the deck the game draws).
# Fields: id (stable, prefixed by road: osh- tmb- eko- ikr- aow- aln- ikj- via- lek- isl-), x, y, z (centre of the visible face, world metres),
# yaw (the face points along (sin yaw, 0, cos yaw)), w, h (metres), place, slots (1 static, 3 rotating LED), tier (prime / standard / street),
# mount (pole / roof / wall / bridge) and base (y of the foot of the structure).
# Map data (c) OpenStreetMap contributors, ODbL 1.0.
import osmium, math, json, os, re, random
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SRC = os.environ.get('HL_OSM', '/home/claude/hlosm/data/corridor.osm.pbf')
LAT0, LON0 = 6.5530, 3.3430
KX = math.cos(math.radians(LAT0)) * 111320.0; KZ = 110574.0
def P(lon, lat): return ((lon - LON0) * KX, -(lat - LAT0) * KZ)
T_FLOORS = [6.4, 9.6, 12.8, 16.0]; T_ROOF = 19.2     # keep in step with world/oshodi.ts
FLOOR, PLINTH = 3.1, 0.45                            # keep in step with world/buildings.ts

def obb(p):
    n = len(p); best = None
    for i in range(n):
        j = (i + 1) % n; ang = math.atan2(p[j][1] - p[i][1], p[j][0] - p[i][0]); c, s = math.cos(ang), math.sin(ang)
        xs = [x * c + z * s for x, z in p]; zs = [-x * s + z * c for x, z in p]
        x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs); a = (x1 - x0) * (z1 - z0)
        if best is None or a < best[0]:
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            best = (a, ang, mx * c - mz * s, mx * s + mz * c, (x1 - x0) / 2, (z1 - z0) / 2)
    _, ang, cx, cz, hl, hw = best
    if hw > hl: ang += math.pi / 2; hl, hw = hw, hl
    return ang, cx, cz, hl, hw

NAMES = {'tmb': r'^Third Mainland Bridge$', 'eko': r'^Eko Bridge$', 'ikr': r'^Ikorodu Road$', 'aow': r'^Apapa-Oworonshoki Expressway$', 'aln': r'^Allen Avenue$',
         'ikj': r'^Obafemi Awolowo Way$', 'via': r'^(Bourdillon Road|Alfred Rewane Road|Falomo Bridge|Ikoyi Road|New Marina Road)$'}
terms, foots, roads, tall = {}, [], {k: [] for k in NAMES}, []
bgrid = {}   # 50 m cells of building bounding boxes, to keep pole feet clear of buildings
class H(osmium.SimpleHandler):
    def way(s, w):
        t = {k.k: k.v for k in w.tags}; nm = t.get('name', '')
        if nm.startswith('Oshodi Transport Interchange - Terminal'):
            try: terms[nm[-1]] = [P(n.lon, n.lat) for n in w.nodes]
            except Exception: pass
            return
        if t.get('highway') == 'footway' and t.get('bridge') == 'yes':
            try: pts = [P(n.lon, n.lat) for n in w.nodes]
            except Exception: return
            if any(800 <= x <= 1150 and -460 <= z <= -150 for x, z in pts): foots.append((w.id, int(t.get('layer', '1')), pts))
            return
        if 'highway' in t and t['highway'] in ('motorway', 'trunk', 'primary', 'secondary', 'motorway_link'):
            for k, rx in NAMES.items():
                if re.search(rx, nm):
                    try: roads[k].append({'id': w.id, 'hw': t['highway'], 'bridge': t.get('bridge') is not None and t.get('bridge') != 'no', 'oneway': t.get('oneway'), 'p': [P(n.lon, n.lat) for n in w.nodes]})
                    except Exception: pass
        elif 'building' in t:
            try:
                bp = [P(n.lon, n.lat) for n in w.nodes]; bb = (min(a for a, b in bp), max(a for a, b in bp), min(b for a, b in bp), max(b for a, b in bp))
                for cx_ in range(int(bb[0] // 50), int(bb[1] // 50) + 1):
                    for cz_ in range(int(bb[2] // 50), int(bb[3] // 50) + 1): bgrid.setdefault((cx_, cz_), []).append(bb)
            except Exception: pass
            try: lv = int(float(t.get('building:levels', '0').split(';')[0]))
            except Exception: lv = 0
            if lv >= 10:
                try: pts = [P(n.lon, n.lat) for n in w.nodes]
                except Exception: return
                try: ht = float(t['height'].split()[0]) if 'height' in t else 0
                except Exception: ht = 0
                tall.append({'id': w.id, 'lv': lv, 'h': ht, 'p': pts})
H().apply_file(SRC, locations=True)

ELEV = json.load(open(os.path.join(HERE, 'bridge_elev.json')))   # [{id,name,cls,layer,flags,w,pts,elev}] straight from the game
def deck_at(x, z, maxd=4.0):
    """deck top (m) at a point, from the dumped elevation of the nearest bridge road, or None."""
    best = None
    for r in ELEV:
        if not r.get('elev'): continue
        p = r['pts']
        for k in range(len(p) // 2 - 1):
            ax, az, bx, bz = p[k * 2], p[k * 2 + 1], p[k * 2 + 2], p[k * 2 + 3]; dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz or 1
            t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / L2)); d = math.hypot(ax + dx * t - x, az + dz * t - z)
            if d < maxd and (best is None or d < best[0]): best = (d, r['elev'][k] + (r['elev'][k + 1] - r['elev'][k]) * t + 0.15)
    return best[1] if best else None

out = []; used = set()
def face(id, x, y, z, nx, nz, w, h, place, tier, slots, mount, base):
    assert id not in used, id; used.add(id)
    out.append({'id': id, 'x': round(x, 1), 'y': round(y, 1), 'z': round(z, 1), 'yaw': round(math.atan2(nx, nz), 3), 'w': w, 'h': h, 'place': place, 'slots': slots, 'tier': tier, 'mount': mount, 'base': round(base, 1)})

# ---------------------------------------------------------------- Oshodi Transport Interchange
for k in sorted(terms):
    ang, cx, cz, hl, hw = obb(terms[k]); ca, sa = math.cos(ang), math.sin(ang)
    lx, lz = (ca, sa), (-sa, ca)
    def at(u, v, y, off):
        sv = 1 if v > 0 else -1
        return (cx + lx[0] * u + lz[0] * (v + sv * off), y, cz + lx[1] * u + lz[1] * (v + sv * off)), (lz[0] * sv, lz[1] * sv)
    place = f'Oshodi Interchange, Terminal {k}'
    for sv in (-1, 1):
        side = 'a' if sv < 0 else 'b'
        for i, u in enumerate((-hl * 0.45, hl * 0.45)):
            p, n = at(u, sv * (hw - 3.0), T_ROOF + 4.2, 0.0)
            face(f'osh-t{k}-roof-{side}{i + 1}', p[0], p[1], p[2], n[0], n[1], 24, 7, place + ' roof', 'prime', 3, 'roof', T_ROOF)
        for i, u in enumerate((-hl * 0.5, hl * 0.5)):
            p, n = at(u, sv * hw, 11.2, 0.35)
            face(f'osh-t{k}-wall-{side}{i + 1}', p[0], p[1], p[2], n[0], n[1], 18, 6.4, place + ' wall', 'standard', 1, 'wall', T_FLOORS[0])
    for sg, nm in ((-1, 'w'), (1, 'e')):
        p = (cx + lx[0] * (sg * (hl + 0.35)), 11.2, cz + lx[1] * (sg * (hl + 0.35)))
        face(f'osh-t{k}-end-{nm}', p[0], p[1], p[2], lx[0] * sg, lx[1] * sg, 14, 6.4, place + ' end wall', 'standard', 1, 'wall', T_FLOORS[0])
# covered footbridges: side panels on the flat top of each span, heights from the game's own deck profile
FOOT_SLOPE = 0.18   # keep in step with world/region.ts footbridgeProfile
def foot_profile(pts, layer):
    sc = [0.0]
    for i in range(1, len(pts)): sc.append(sc[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    L = sc[-1]; cap = 12.8 if layer >= 3 else 6.0
    return [min(cap, FOOT_SLOPE * min(s_, L - s_) + 0.15) for s_ in sc]
for wid, layer, pts in sorted(foots):
    rp = [c for p in pts for c in p]; n = len(pts)
    ys = foot_profile(pts, layer); top = max(ys)
    if top < 4 or len(pts) < 3: continue   # a two-point way is a straight ramp in the game: no flat deck to put a panel on
    seg = [0.0]
    for i in range(1, n): seg.append(seg[-1] + math.hypot(rp[i * 2] - rp[i * 2 - 2], rp[i * 2 + 1] - rp[i * 2 - 1]))
    flat = [i for i in range(n) if ys[i] >= top * 0.85]
    if len(flat) < 2: continue
    s0, s1 = seg[flat[0]], seg[flat[-1]]; span = s1 - s0
    if span < 12: continue
    cnt = max(1, min(3, int(span // 14)))
    def pos(s):
        for i in range(1, n):
            if s <= seg[i] or i == n - 1:
                t = (s - seg[i - 1]) / ((seg[i] - seg[i - 1]) or 1); x = rp[i * 2 - 2] + (rp[i * 2] - rp[i * 2 - 2]) * t; z = rp[i * 2 - 1] + (rp[i * 2 + 1] - rp[i * 2 - 1]) * t
                dx, dz = rp[i * 2] - rp[i * 2 - 2], rp[i * 2 + 1] - rp[i * 2 - 1]; l = math.hypot(dx, dz) or 1
                return x, z, dx / l, dz / l, ys[i - 1] + (ys[i] - ys[i - 1]) * t
    for i in range(cnt):
        s = s0 + span * (i + 0.5) / cnt; x, z, dx, dz, y = pos(s); nx, nz = -dz, dx
        for sd, nm in ((1, 'l'), (-1, 'r')):
            face(f'osh-br{wid}-{i + 1}{nm}', x + nx * sd * 1.45, y + 0.15 + 0.9 + 1.5, z + nz * sd * 1.45, nx * sd, nz * sd, min(10, span / cnt - 2), 3, f'Oshodi Interchange footbridge, layer {layer}', 'street', 1, 'bridge', y + 0.15)

# ---------------------------------------------------------------- main roads: unipoles beside the carriageway, facing oncoming traffic
rnd = random.Random(7)
SIDE = {'motorway': 9.0, 'trunk': 8.0, 'primary': 7.5, 'secondary': 6.5, 'motorway_link': 6.0}
buildings = []   # footprints near candidates, filled by a second pass
def seg_len(p): return [0.0] + [sum(math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) for i in range(1, k + 1)) for k in range(1, len(p))]
def along(p, s):
    cum = seg_len(p)
    for i in range(1, len(p)):
        if s <= cum[i]:
            t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) or 1); dx, dz = p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]; l = math.hypot(dx, dz) or 1
            return p[i - 1][0] + dx * t, p[i - 1][1] + dz * t, dx / l, dz / l
    return None
def clear(x, z, m=3.0):
    return not any(b[0] - m <= x <= b[1] + m and b[2] - m <= z <= b[3] + m for b in bgrid.get((int(x // 50), int(z // 50)), []))
def candidates(group, n, place, tier, w, h, slots, skip=lambda w_: False, bridge_only=None, ground_only=False, region=None, side=1):
    """n spots spread over the group's ways. Returns candidate dicts; the caller picks the first n that clear buildings."""
    ways = [r for r in roads[group] if not skip(r) and (bridge_only is None or r['bridge'] == bridge_only) and not (ground_only and r['bridge'])]
    ways = [r for r in ways if region is None or any(region[0] <= x <= region[1] and region[2] <= z <= region[3] for x, z in r['p'])]
    cum = [(r, seg_len(r['p'])[-1]) for r in ways]; total = sum(l for _, l in cum); cands = []
    if not total: return cands
    for j in range(n * 6):
        s = (j + 0.5) / (n * 6) * total; acc = 0
        for r, l in cum:
            if s <= acc + l:
                q = along(r['p'], s - acc);
                if q is None: break
                x, z, dx, dz = q
                if region and not (region[0] <= x <= region[1] and region[2] <= z <= region[3]): break
                rx, rz = -dz * side, dx * side; off = SIDE.get(r['hw'], 6.5) + (0 if not r['bridge'] else -3.5)
                a = math.radians(18); nx = -dx * math.cos(a) - rx * math.sin(a); nz = -dz * math.cos(a) - rz * math.sin(a)
                px, pz = x + rx * off, z + rz * off
                base = 0.0
                if r['bridge']:
                    base = deck_at(x, z)
                    if base is None: break
                cands.append({'x': px, 'z': pz, 'nx': nx, 'nz': nz, 'base': base, 'bridge': r['bridge'], 'way': r['id']}); break
            acc += l
    return cands
PLAN = [  # group, prefix, count, place, tier, w, h, slots, kwargs
    ('tmb', 'tmb', 6, 'Third Mainland Bridge', 'prime', 14, 5, 3, dict(bridge_only=True)),
    ('eko', 'eko', 4, 'Eko Bridge', 'prime', 14, 5, 3, dict(bridge_only=True)),
    ('ikr', 'ikr', 8, 'Ikorodu Road', 'standard', 12, 4, 1, dict(ground_only=True)),
    ('aow', 'aow', 6, 'Apapa-Oworonshoki Expressway', 'prime', 14, 5, 3, dict(ground_only=True, region=(-3100, 5700, -800, 12700))),
    ('aln', 'aln', 4, 'Allen Avenue, Ikeja', 'standard', 10, 3.5, 1, dict(ground_only=True)),
    ('ikj', 'ikj', 3, 'Obafemi Awolowo Way, Ikeja', 'street', 8, 3, 1, dict(ground_only=True)),
    ('via', 'via', 5, 'Marina to Ikoyi (Marina, Ikoyi Road, Bourdillon)', 'standard', 12, 4, 1, dict(ground_only=True)),
]
for g, pre, n, place, tier, w, h, slots, kw in PLAN:
    cs = [c for c in candidates(g, n, place, tier, w, h, slots, **kw) if clear(c['x'], c['z'])]
    step = max(1, len(cs) // n)
    cs = cs[::step][:n] if len(cs) >= n else cs
    for i, c in enumerate(cs):
        pole = 9.0 if tier == 'prime' else 7.0 if tier == 'standard' else 4.8
        face(f'{pre}-{i + 1:02d}', c['x'], c['base'] + pole + h / 2, c['z'], c['nx'], c['nz'], w, h, place, tier, slots, 'pole', c['base'])

# ---------------------------------------------------------------- rooftops: Lagos Island (isl-) and the Ikoyi / Victoria Island / Lekki side (lek-)
def rooftop(group_pre, region, n, place, w, h):
    bs = [b for b in tall if region[0] <= sum(p[0] for p in b['p']) / len(b['p']) <= region[1] and region[2] <= sum(p[1] for p in b['p']) / len(b['p']) <= region[3]]
    bs.sort(key=lambda b: -(b['h'] or b['lv'] * FLOOR)); k = 0
    for b in bs:
        if k >= n: break
        if len(b['p']) < 4: continue
        ang, cx, cz, hl, hw = obb(b['p'])
        if hw < 8: continue
        top = b['h'] if b['h'] > 0 else PLINTH + b['lv'] * FLOOR
        ca, sa = math.cos(ang), math.sin(ang); nrm = (-sa, ca)
        for sv in (1, -1):
            face(f'{group_pre}-{k + 1:02d}{"ab"[0 if sv > 0 else 1]}', cx + nrm[0] * sv * (hw - 1.5), top + 3.2 + h / 2, cz + nrm[1] * sv * (hw - 1.5), nrm[0] * sv, nrm[1] * sv, w, h, place, 'prime', 3, 'roof', top)
        k += 1
rooftop('isl', (4300, 6300, 10400, 11900), 5, 'Lagos Island rooftop', 16, 6)
rooftop('lek', (9000, 11300, 10000, 12000), 4, 'Ikoyi and Lekki-side rooftop', 16, 6)

json.dump(out, open(os.path.join(ROOT, 'v2', 'src', 'data', 'billboards.json'), 'w'), indent=1)
by = {}
for o in out: by[o['id'].split('-')[0]] = by.get(o['id'].split('-')[0], 0) + 1
print(len(out), 'faces', by)
