# Writes v2/src/data/billboards.json: the sellable billboard faces of the Oshodi Transport Interchange.
# Reads the three OSM terminal footprints (amenity=bus_station, Oshodi Transport Interchange) and the footbridges (highway=footway, bridge=yes)
# from the corridor extract, using the same projection as pipe/extract.py and the same min-area rectangle as world/geo.ts obb().
# Face fields: id, x, y, z (centre of the face, world metres), yaw (direction the face points, normal = (sin yaw, cos yaw) in x,z), w, h (metres), place, tier.
# Tiers: prime (big roof boards, slots 3 = rotating LED), standard (terminal walls), street (covered footbridge side panels). slots: 1 static, 3 rotating.
# Map data (c) OpenStreetMap contributors, ODbL 1.0.
import osmium, math, json, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SRC = os.environ.get('HL_OSM', '/home/claude/hlosm/data/corridor.osm.pbf')
LAT0, LON0 = 6.5530, 3.3430
KX = math.cos(math.radians(LAT0)) * 111320.0; KZ = 110574.0
def P(lon, lat): return ((lon - LON0) * KX, -(lat - LAT0) * KZ)
FLOOR_H = [6.4, 9.6, 12.8, 16.0]; ROOF_H = 19.2     # keep in step with world/oshodi.ts (T_FLOORS, T_ROOF)

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

terms, foots = {}, []
class H(osmium.SimpleHandler):
    def way(s, w):
        t = {k.k: k.v for k in w.tags}
        nm = t.get('name', '')
        if nm.startswith('Oshodi Transport Interchange - Terminal'):
            try: terms[nm[-1]] = [P(n.lon, n.lat) for n in w.nodes]
            except Exception: pass
        elif t.get('highway') == 'footway' and t.get('bridge') == 'yes':
            try: pts = [P(n.lon, n.lat) for n in w.nodes]
            except Exception: return
            if any(800 <= x <= 1150 and -460 <= z <= -150 for x, z in pts): foots.append((w.id, int(t.get('layer', '1')), pts))
H().apply_file(SRC, locations=True)

out = []
def face(id, x, y, z, nx, nz, w, h, place, tier, slots=1):
    out.append({'id': id, 'x': round(x, 1), 'y': round(y, 1), 'z': round(z, 1), 'yaw': round(math.atan2(nx, nz), 3), 'w': w, 'h': h, 'place': place, 'slots': slots, 'tier': tier})
for k in sorted(terms):
    ang, cx, cz, hl, hw = obb(terms[k]); ca, sa = math.cos(ang), math.sin(ang)
    lx, lz = (ca, sa), (-sa, ca)      # local axes in x,z
    def at(u, v, y, off):             # point at local (u along the long axis, v across), pushed `off` metres outside the wall on the side of v
        sv = 1 if v > 0 else -1
        return (cx + lx[0] * u + lz[0] * (v + sv * off), y, cz + lx[1] * u + lz[1] * (v + sv * off)), (lz[0] * sv, lz[1] * sv)
    place = f'Oshodi Interchange, Terminal {k}'
    for sv in (-1, 1):
        side = 'north' if False else ('a' if sv < 0 else 'b')
        # roof boards: two back-to-back faces standing on the roof deck near the edge, facing outward
        for i, u in enumerate((-hl * 0.45, hl * 0.45)):
            p, n = at(u, sv * (hw - 3.0), ROOF_H + 4.2, 0.0)
            face(f'osh-t{k}-roof-{side}{i + 1}', p[0], p[1], p[2], n[0], n[1], 24, 7, place + ' roof', 'prime', 3)
        # wall hoardings across the garage floors (floors 3 to 5), two per long side
        for i, u in enumerate((-hl * 0.5, hl * 0.5)):
            p, n = at(u, sv * hw, 11.2, 0.35)
            face(f'osh-t{k}-wall-{side}{i + 1}', p[0], p[1], p[2], n[0], n[1], 18, 6.4, place + ' wall', 'standard')
    for sg, nm in ((-1, 'w'), (1, 'e')):
        p = (cx + lx[0] * (sg * (hl + 0.35)), 11.2, cz + lx[1] * (sg * (hl + 0.35)))
        face(f'osh-t{k}-end-{nm}', p[0], p[1], p[2], lx[0] * sg, lx[1] * sg, 14, 6.4, place + ' end wall', 'standard')
# covered footbridges: side panels on the flat top of each span
for wid, layer, pts in sorted(foots):
    seg = [0.0]
    for i in range(1, len(pts)): seg.append(seg[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    L = seg[-1]; peak = max(1, layer) * 6.4; ramp = min(L * 0.35, 90)
    if L - 2 * ramp < 12: continue
    def pos(s):
        for i in range(1, len(pts)):
            if s <= seg[i] or i == len(pts) - 1:
                t = (s - seg[i - 1]) / ((seg[i] - seg[i - 1]) or 1); x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t; z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t
                dx, dz = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]; l = math.hypot(dx, dz) or 1; return x, z, dx / l, dz / l
    flat = L - 2 * ramp; n = max(1, min(3, int(flat // 14)))
    for i in range(n):
        s = ramp + flat * (i + 0.5) / n; x, z, dx, dz = pos(s); nx, nz = -dz, dx   # left normal
        y = peak + 0.15 + 0.9 + 1.5
        for sd, nm in ((1, 'l'), (-1, 'r')):
            face(f'osh-br{wid}-{i + 1}{nm}', x + nx * sd * 1.45, y, z + nz * sd * 1.45, nx * sd, nz * sd, min(10, flat / n - 2), 3, f'Oshodi Interchange footbridge, layer {layer}', 'street')
json.dump(out, open(os.path.join(ROOT, 'v2', 'src', 'data', 'billboards.json'), 'w'), indent=1)
print(len(out), 'faces', {k: len([o for o in out if o['tier'] == k]) for k in ('prime', 'standard', 'street')})
