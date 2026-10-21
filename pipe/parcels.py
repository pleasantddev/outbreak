# Parcels: one purchasable property per real property.
#  1. big land claims (markets, schools, estates, factories, terminals) become one parcel each,
#  2. closed walls and fences that enclose buildings become compounds,
#  3. every remaining building (grouped with its outbuildings) gets the part of its block nearest to it
#     (Voronoi of the footprint outlines, limited to a compound-sized reach around the building),
#  4. slivers are merged into a neighbour, and only land with no building is cut into vacant plots (18 x 36 m).
# Output: parcels.pkl and bclass.pkl. Plot ids are derived from OSM ids / rounded coordinates, so they are stable.
import pickle, math, time, os, sys, collections
import numpy as np, shapely
from shapely.geometry import LineString, Polygon, MultiPolygon, Point, box
from shapely.strtree import STRtree
from shapely import affinity
from multiprocessing import Pool
from common import *
import bclass

HERE = os.path.dirname(os.path.abspath(__file__))
t0 = time.time()
def log(*a): print(*a, f'{time.time()-t0:.0f}s', flush=True)
d = pickle.load(open(os.path.join(HERE, 'raw.pkl'), 'rb'))
B = pickle.load(open(os.path.join(HERE, 'blocks.pkl'), 'rb'))
LAT0, LON0 = d['origin']
lon0, lat0, lon1, lat1 = d['bbox']
KX = math.cos(math.radians(LAT0)) * 111320.0; KZ = 110574.0
corr = box((lon0 - LON0) * KX, -(lat1 - LAT0) * KZ, (lon1 - LON0) * KX, -(lat0 - LAT0) * KZ)
def sid(bid): return (0x80000000 | (bid - 10_000_000_000)) if bid >= 10_000_000_000 else bid

# ---- buildings (slim: classified by bclass.py, geometry kept as WKB and rebuilt per face)
C = pickle.load(open(os.path.join(HERE, 'bclass.pkl'), 'rb'))
KIND = C['kind']; AREA = C['area']; IDS = C['ids']; WKB = C['wkb']; RX = C['rx']; RZ = C['rz']; NAMES = C['names']
NB = len(WKB)
valid = AREA >= 4
rep_pts = shapely.points(RX, RZ)
faces = [shapely.from_wkb(w) for w in B['blocks']]
ftree = STRtree(faces)
ii, jj = ftree.query(rep_pts, predicate='within')
bface = np.full(NB, -1, dtype=np.int64); bface[ii] = jj
face_blds = collections.defaultdict(list)
for i in np.nonzero((bface >= 0) & valid)[0]: face_blds[int(bface[i])].append(int(i))
log('faces', len(faces), 'buildings placed', int(((bface >= 0) & valid).sum()), 'unplaced', int(((bface < 0) & valid).sum()))
_gc = {}
def geo(i):
    g = _gc.get(i)
    if g is None:
        g = shapely.from_wkb(WKB[i]); _gc[i] = g
    return g
def repp(i): return Point(RX[i], RZ[i])

# ---- roads for the inset
rl, rw = [], []
for r in d['roads']:
    c = CLS.get(r['hw'])
    if not c or r.get('bridge') not in (None, 'no') or r.get('tunnel') not in (None, 'no') or len(r['pts']) < 2: continue
    try: ln = int(float((r.get('lanes') or '0').split(';')[0]))
    except Exception: ln = 0
    one = r.get('oneway') in ('yes', '1', 'true', '-1')
    try: wd = parse_num(r.get('width')) or None
    except Exception: wd = None
    rl.append(LineString(r['pts'])); rw.append(half_width(c, ln, one, wd) + verge(c) + 0.3)
rtree = STRtree(rl)
# frontage roads (where vacant plots may exist)
frontage_lines = [rl[i] for i, r in enumerate([r for r in d['roads'] if CLS.get(r['hw']) and r.get('bridge') in (None, 'no') and r.get('tunnel') in (None, 'no') and len(r['pts']) >= 2]) if CLS.get(r['hw'], 99) <= 8]
ftree_r = STRtree(frontage_lines)

# ---- land claims and public land
CLAIM_AMEN = {'school': 4, 'university': 4, 'college': 4, 'hospital': 4, 'clinic': 4, 'marketplace': 2, 'place_of_worship': 4, 'bus_station': 4, 'police': 4, 'fire_station': 4, 'courthouse': 4, 'townhall': 4, 'fuel': 2, 'prison': 4, 'kindergarten': 4}
CLAIM_USE = {'industrial': 3, 'religious': 4, 'military': 4, 'education': 4, 'retail': 2, 'commercial': 2, 'railway': 3}
claims = []   # (poly, zone, name, area, kind-tag)
public = []
for a in d['areas']:
    t = a['tags']
    if len(a['pts']) < 3: continue
    z = 0; kindtag = None
    if t.get('amenity') in CLAIM_AMEN: z = CLAIM_AMEN[t['amenity']]; kindtag = t['amenity']
    elif t.get('landuse') in CLAIM_USE: z = CLAIM_USE[t['landuse']]; kindtag = t['landuse']
    elif t.get('leisure') in ('sports_centre', 'stadium'): z = 4; kindtag = t['leisure']
    elif t.get('shop') == 'mall': z = 2; kindtag = 'mall'
    pub = (t.get('leisure') in ('park', 'pitch', 'playground', 'garden', 'golf_course', 'track', 'nature_reserve', 'swimming_pool') or t.get('natural') in ('wood', 'wetland', 'scrub') and False or t.get('landuse') in ('forest', 'cemetery', 'recreation_ground', 'village_green', 'grass', 'landfill', 'reservoir', 'basin') or t.get('natural') in ('wood', 'wetland') or t.get('amenity') == 'grave_yard')
    if not z and not pub: continue
    try:
        p = Polygon(a['pts'], a.get('holes') or [])
        if not p.is_valid: p = p.buffer(0)
        if p.geom_type != 'Polygon' or p.area < 60: continue
    except Exception: continue
    if pub and not z: public.append(p); continue
    lim = 20000 if kindtag in ('retail', 'commercial') else 160000
    if p.area < 250 or p.area > lim: continue
    claims.append((p, z, t.get('name'), p.area, kindtag))
claims.sort(key=lambda c: c[3])
claim_tree = STRtree([c[0] for c in claims]) if claims else None
public_tree = STRtree(public) if public else None
# fenced compounds
fences = []
for b in d['barriers']:
    if not b['closed'] or b['kind'] not in ('wall', 'fence') or len(b['pts']) < 4: continue
    try:
        p = Polygon(b['pts'])
        if not p.is_valid: p = p.buffer(0)
        if p.geom_type == 'Polygon' and 120 <= p.area <= 20000: fences.append(p)
    except Exception: pass
fence_tree = STRtree(fences) if fences else None
log('claims', len(claims), 'public', len(public), 'fences', len(fences))

ZCODE = {'vacant': 0, 'residential': 1, 'commercial': 2, 'industrial': 3, 'institution': 4, 'unfinished': 5}
def zone_of(kinds):
    ks = set(int(k) for k in kinds)
    if not ks: return 0
    if 5 in ks: return 3
    if ks & {2, 4, 13, 16}: return 2
    if ks & {8, 6, 7, 14, 15, 12}: return 4
    if ks == {9}: return 5
    if ks <= {10, 11} and False: return 2
    return 1
def rich_of(bidx, parcel_area):
    if not bidx: return 0.0
    ar = [float(AREA[i]) for i in bidx]
    big = max(ar); built = sum(ar)
    anchor = min(bidx, key=lambda i: (-AREA[i], int(IDS[i])))
    return min(1.0, (0.45 if big > 220 else 0.1) + (0.25 if len(bidx) <= 2 else 0) + (0.15 if built / max(1, parcel_area) < 0.45 else 0) + h01(int(IDS[anchor]), 9) * 0.25)

def parts_of(g):
    if g.is_empty: return []
    return [p for p in shapely.get_parts(g) if p.geom_type == 'Polygon' and not p.is_empty]
def biggest(g):
    ps = parts_of(g)
    return max(ps, key=lambda p: p.area) if ps else None
def clean(g):
    if g is None or g.is_empty: return g
    if not g.is_valid: g = shapely.make_valid(g)
    return g

def voronoi_alloc(groups, domain):
    """groups: list of polygons. Returns list of the domain part nearest to each group."""
    pts = []; own = []
    for gi, g in enumerate(groups):
        gg = shapely.segmentize(g, 3.0)
        for ring in [gg.exterior] + list(gg.interiors):
            c = np.asarray(ring.coords)[:-1]
            pts.append(c); own.append(np.full(len(c), gi))
    P = np.vstack(pts); O = np.concatenate(own)
    key = np.round(P, 2)
    _, uniq = np.unique(key, axis=0, return_index=True)
    P = P[uniq]; O = O[uniq]
    if len(P) < 2:
        return [domain] * len(groups)
    env = box(*domain.bounds).buffer(50)
    cells = shapely.voronoi_polygons(shapely.multipoints(P), extend_to=env)
    cells = list(shapely.get_parts(cells))
    ct = STRtree(cells)
    ci, pj = ct.query(shapely.points(P), predicate='within')
    # point k -> cell ci
    owner_cells = collections.defaultdict(list)
    for c, p in zip(ci, pj): owner_cells[int(O[p])].append(cells[int(c)])
    out = []
    for gi in range(len(groups)):
        cl = owner_cells.get(gi)
        if not cl: out.append(Polygon()); continue
        u = shapely.union_all(cl)
        out.append(u.intersection(domain))
    return out

def subdivide(poly, uid_prefix):
    """Cut a vacant polygon into ~18 x 36 m plots aligned to its long axis."""
    mrr = shapely.minimum_rotated_rectangle(poly)
    if mrr.geom_type != 'Polygon': return []
    c = list(mrr.exterior.coords)
    e0 = (c[1][0] - c[0][0], c[1][1] - c[0][1]); e1 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    ed = e0 if math.hypot(*e0) >= math.hypot(*e1) else e1
    ang = math.degrees(math.atan2(ed[1], ed[0]))
    origin = (mrr.centroid.x, mrr.centroid.y)
    rp = affinity.rotate(poly, -ang, origin=origin)
    x0, z0, x1, z1 = rp.bounds
    L, W = x1 - x0, z1 - z0
    cols = max(1, round(L / 18.0)); rows = max(1, round(W / 36.0))
    cw, ch = L / cols, W / rows
    kept = []; small = []
    for i in range(cols):
        for j in range(rows):
            cell = box(x0 + i * cw, z0 + j * ch, x0 + (i + 1) * cw, z0 + (j + 1) * ch)
            pc = biggest(rp.intersection(cell))
            if pc is None: continue
            if pc.area >= 0.5 * 648 and pc.area >= 0.45 * cw * ch: kept.append(pc)
            elif pc.area >= 60: small.append(pc)
    for s in small:
        best = None; bl = 0
        for k, kp in enumerate(kept):
            l = kp.boundary.intersection(s.buffer(0.3)).length
            if l > bl: bl = l; best = k
        if best is not None and bl > 3: kept[best] = clean(shapely.union_all([kept[best], s]))
    outp = []
    for kp in kept:
        kp = biggest(kp)
        if kp is None: continue
        outp.append(affinity.rotate(kp, ang, origin=origin))
    return outp

def simplify_pts(p, tol=0.5):
    p = p.simplify(tol)
    if p.geom_type != 'Polygon' or p.is_empty: p = biggest(p)
    if p is None: return None
    c = list(p.exterior.coords)[:-1]
    if len(c) < 3: return None
    return [(round(x, 1), round(z, 1)) for x, z in c][:120]

def process_face(fi):
    out = []
    _gc.clear()
    F = faces[fi]
    Bl = face_blds.get(fi, [])
    # inset (carriageway, kerb and drain)
    near = rtree.query(F.buffer(12))
    Q = F
    if len(near):
        cut = shapely.union_all([rl[i].buffer(rw[i], quad_segs=2) for i in near])
        Q = F.difference(cut)
    Q = clean(Q)
    if Bl:
        Bu = shapely.union_all([geo(i).buffer(0.3) for i in Bl])
        D = clean(shapely.union_all([Q, Bu]))
    else:
        D = Q
    if D.is_empty: return out
    # public land is not for sale
    if public_tree is not None:
        hit = public_tree.query(F)
        if len(hit):
            pu = shapely.union_all([public[i] for i in hit])
            keep_b = shapely.union_all([geo(i).buffer(0.5) for i in Bl]) if Bl else None
            D2 = D.difference(pu)
            D = clean(D2 if keep_b is None else shapely.union_all([D2, keep_b.intersection(D)]))
    remaining = set(Bl)
    taken = []   # parcels made so far: dict(poly, bidx, zone, name, kind)
    # 1. land claims
    if claim_tree is not None:
        for k in claim_tree.query(F):
            if k >= len(claims): continue
            p, z, name, ar, kt = claims[int(k)]
            cp = clean(p.intersection(D))
            cp = biggest(cp) if not cp.is_empty else None
            if cp is None or cp.area < 250: continue
            if cp.area < 0.5 * p.area and not any(geo(i).representative_point().within(cp) for i in remaining): continue
            inside = [i for i in remaining if repp(i).within(cp)]
            taken.append({'poly': cp, 'b': inside, 'zone': z, 'name': name, 'kind': 'L'})
            remaining -= set(inside); D = clean(D.difference(cp))
            if D.is_empty: break
    # 2. fenced compounds
    if fence_tree is not None and remaining and not D.is_empty:
        cand = sorted((fences[int(k)] for k in fence_tree.query(F)), key=lambda p: p.area)
        for p in cand:
            inside = [i for i in remaining if repp(i).within(p)]
            if not inside: continue
            cp = biggest(clean(p.intersection(D)))
            if cp is None or cp.area < 120: continue
            taken.append({'poly': cp, 'b': inside, 'zone': None, 'name': None, 'kind': 'B'})
            remaining -= set(inside); D = clean(D.difference(cp))
    # 3. remaining buildings: group outbuildings with the main building, then Voronoi
    rem = sorted(remaining, key=lambda i: (-AREA[i], int(IDS[i])))
    groups = []   # list of lists of building idx
    if rem:
        anchors = [i for i in rem if AREA[i] >= 28 or KIND[i] in (2, 13, 14, 15, 12)]
        anchor_set = set(anchors)
        owner = {}
        gl = []
        if anchors:
            atree = STRtree([geo(i) for i in anchors])
        for i in rem:
            if i in anchor_set:
                # a small ancillary next to a much bigger house joins it
                if AREA[i] < 60 and KIND[i] in (1, 11, 10) and len(anchors) > 1:
                    cand = [anchors[int(k)] for k in atree.query(geo(i).buffer(7))]
                    cand = [c for c in cand if c != i and AREA[c] > 3.0 * AREA[i] and KIND[c] in (1, 3, 8, 2) and geo(c).distance(geo(i)) < 7]
                    if cand:
                        owner[i] = min(cand, key=lambda c: geo(c).distance(geo(i))); continue
                owner[i] = i
        for i in rem:
            if i in owner: continue
            # small building: nearest anchor within 15 m, else a kiosk parcel of its own when big enough
            best = None; bd = 15.0
            if anchors:
                for k in atree.query(geo(i).buffer(15)):
                    c = anchors[int(k)]
                    dd = geo(c).distance(geo(i))
                    if dd < bd: bd = dd; best = c
            if best is not None: owner[i] = best
            elif AREA[i] >= 9: owner[i] = i
        # resolve chains (ancillary of an ancillary)
        def root(i):
            seen = 0
            while owner.get(i, i) != i and seen < 6: i = owner[i]; seen += 1
            return i
        gm = collections.defaultdict(list)
        for i in rem:
            if i in owner: gm[root(i)].append(i)
        # overlapping footprints are one building
        roots = list(gm.keys())
        parent = {r: r for r in roots}
        def find(x):
            while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
            return x
        if len(roots) > 1:
            rt = STRtree([geo(r) for r in roots])
            for a, r in enumerate(roots):
                for k in rt.query(geo(r)):
                    if k <= a: continue
                    r2 = roots[int(k)]
                    if geo(r).intersection(geo(r2)).area > 0.5: parent[find(r2)] = find(r)
        merged = collections.defaultdict(list)
        for r in roots: merged[find(r)].extend(gm[r])
        groups = list(merged.values())
    gparcels = []
    if groups and not D.is_empty:
        gunion = []
        for g in groups:
            u = shapely.union_all([geo(i) for i in g])
            u = biggest(u.buffer(0.2)) or biggest(u)
            gunion.append(u)
        cells = voronoi_alloc(gunion, D) if len(groups) > 1 else [D]
        for g, u, cell in zip(groups, gunion, cells):
            A = sum(float(AREA[i]) for i in g)
            R = min(14.0, max(5.5, 0.45 * math.sqrt(A) + 3.5))
            reach = u.buffer(R, join_style='mitre', mitre_limit=2.0)
            pp = clean(cell.intersection(reach))
            pp = clean(shapely.union_all([pp, u]))
            # the piece that holds the building; fragments fall back to the leftover
            pb = None
            for q in parts_of(pp):
                if q.intersects(u) and (pb is None or q.area > pb.area): pb = q
            if pb is None: continue
            gparcels.append({'poly': pb, 'b': g, 'zone': None, 'name': None, 'kind': 'B'})
    taken.extend(gparcels)
    # 4. leftover: slivers merge into neighbours, the rest becomes vacant plots
    if taken:
        used = shapely.union_all([t['poly'] for t in taken])
        left = clean(D.difference(used.buffer(0.01)))
    else: left = D
    vac = []
    if not left.is_empty:
        # vacant plots only in the frontage zone
        fl = ftree_r.query(F.buffer(5))
        zone_f = shapely.union_all([frontage_lines[int(k)].buffer(95) for k in fl]) if len(fl) else None
        for comp in parts_of(left):
            if comp.area < 40: continue
            core = comp.buffer(-2.6, join_style='mitre').buffer(2.6, join_style='mitre') if comp.area > 120 else Polygon()
            core = clean(core.intersection(comp)) if not core.is_empty else core
            rest = clean(comp.difference(core)) if not core.is_empty else comp
            # slivers to the neighbour with the longest shared edge
            for s in parts_of(rest):
                if s.area < 6: continue
                best = None; bl = 0
                sb = s.buffer(0.6)
                for t in taken:
                    l = t['poly'].boundary.intersection(sb).length
                    if l > bl: bl = l; best = t
                if best is not None and bl > 2.5 and s.area < 900: best['poly'] = biggest(clean(shapely.union_all([best['poly'], s]))) or best['poly']
            for cp in parts_of(core):
                if cp.area < 300: continue
                if zone_f is not None: cp2 = clean(cp.intersection(zone_f))
                else: cp2 = Polygon()
                for q in parts_of(cp2):
                    if q.area < 330: continue
                    vac.extend(subdivide(q, 'V'))
    # write out
    for t in taken:
        poly = t['poly']
        if poly is None or poly.is_empty: continue
        bidx = t['b']
        kinds = [KIND[i] for i in bidx]
        zone = t['zone'] if t['zone'] is not None else zone_of(kinds)
        if t['kind'] == 'L' and bidx:
            zb = zone_of(kinds)
            if zone == 4 or zb in (3, 4): zone = zone if zone == 4 else zb
            elif zone == 2 and zb == 3: zone = 3
        sp = simplify_pts(poly)
        if not sp: continue
        c = poly.centroid
        if t['kind'] == 'B' and bidx:
            anchor = min(bidx, key=lambda i: (-AREA[i], int(IDS[i])))
            pid = f"B{sid(int(IDS[anchor]))}"
        else:
            pid = f"L{round(c.x)}_{round(c.y)}"
        name = t['name']
        if not name and bidx:
            nm = [NAMES[i] for i in sorted(bidx, key=lambda i: -AREA[i]) if NAMES[i]]
            name = nm[0] if nm else None
        out.append({'id': pid, 'pts': sp, 'zone': zone, 'rich': round(rich_of(bidx, poly.area), 3), 'bids': [sid(int(IDS[i])) for i in bidx], 'name': name, 'area': round(poly.area, 1), 'cx': round(c.x, 1), 'cz': round(c.y, 1), 'claim': t['kind'] == 'L'})
    for v in vac:
        sp = simplify_pts(v)
        if not sp: continue
        c = v.centroid
        out.append({'id': f"V{round(c.x)}_{round(c.y)}", 'pts': sp, 'zone': 0, 'rich': 0.0, 'bids': [], 'name': None, 'area': round(v.area, 1), 'cx': round(c.x, 1), 'cz': round(c.y, 1), 'claim': False})
    return out

def work(chunk):
    res = []
    for fi in chunk:
        try: res.extend(process_face(fi))
        except Exception as e:
            print('face fail', fi, repr(e)[:200], flush=True)
    return res

if __name__ == '__main__':
    order = sorted(range(len(faces)), key=lambda i: -(len(face_blds.get(i, [])) + faces[i].area / 5e4))
    only = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    if only: order = order[:only] if only > 0 else order
    chunks = [order[k::64] for k in range(64)]
    parcels = []
    with Pool(2) as pool:
        for n, res in enumerate(pool.imap_unordered(work, chunks)):
            parcels.extend(res); log('chunk', n, 'parcels', len(parcels))
    # unique ids
    seen = collections.Counter();
    for p in parcels:
        seen[p['id']] += 1
        if seen[p['id']] > 1: p['id'] = p['id'] + 'x' + str(seen[p['id']])
    placed = set()
    for p in parcels: placed.update(p['bids'])
    # orphans: buildings that no face or parcel took
    orphans = []
    for i in np.nonzero(valid)[0]:
        s = sid(int(IDS[i]))
        if s in placed or AREA[i] < 12: continue
        pp = shapely.from_wkb(WKB[i]).buffer(2.5, join_style='mitre')
        sp = simplify_pts(pp)
        if not sp: continue
        c = pp.centroid
        orphans.append({'id': f'B{s}', 'pts': sp, 'zone': zone_of([KIND[i]]), 'rich': round(rich_of([int(i)], pp.area), 3), 'bids': [s], 'name': NAMES[i], 'area': round(pp.area, 1), 'cx': round(c.x, 1), 'cz': round(c.y, 1), 'claim': False})
    parcels.extend(orphans)
    log('parcels', len(parcels), 'orphans', len(orphans))
    zc = collections.Counter(p['zone'] for p in parcels)
    log('zones', dict(zc), 'built', sum(1 for p in parcels if p['bids']), 'vacant', sum(1 for p in parcels if not p['bids']))
    pickle.dump(parcels, open(os.path.join(HERE, 'parcels.pkl'), 'wb'))
