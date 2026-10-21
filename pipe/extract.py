# Reads the corridor OSM extract and writes projected, clipped feature lists (pickle) for the chunker.
# Handles ways and multipolygon relations (lagoon, large buildings, landuse), keeps the tags the renderer uses.
# Map data (c) OpenStreetMap contributors, ODbL 1.0.
import osmium, pickle, math, sys, time, os
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get('HL_OSM', '/home/claude/hlosm/data/corridor.osm.pbf')
LAT0, LON0 = 6.5530, 3.3430          # origin: Oshodi
BBOX = (3.150, 6.445, 3.445, 6.730)  # lon_min, lat_min, lon_max, lat_max
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110574.0
def P(lon, lat): return (round((lon - LON0) * KX, 2), round(-(lat - LAT0) * KZ, 2))
def inb(lon, lat, m=0.004): return BBOX[0]-m <= lon <= BBOX[2]+m and BBOX[1]-m <= lat <= BBOX[3]+m
KEEP_POI = ('amenity','shop','craft','office','public_transport','tourism','leisure','healthcare','place','railway','highway','man_made','historic','religion','emergency','aeroway','barrier')
NODE_TAGS = KEEP_POI + ('name','name:en','operator','brand','cuisine','opening_hours','denomination','sport','shelter','bench','addr:street','atm','ref','network','station','train','level','hoops')
BLD_TAGS = ('building','building:part','building:levels','building:levels:underground','height','roof:shape','roof:levels','roof:height','roof:colour','roof:material','building:colour','building:material','building:min_level','min_height','name','amenity','shop','office','tourism','aeroway','public_transport','railway','operator','brand','man_made','leisure','sport','religion','denomination','craft','healthcare','historic','layer','bridge:support','ref')
AREA_TAGS = ('landuse','leisure','amenity','natural','name','shop','man_made','aeroway','public_transport','place','sport','religion','surface','hoops','lit','fence','craft','operator','brand','tourism','railway','barrier','access','historic','healthcare')
RAIL_TAGS = ('railway','name','gauge','tracks','electrified','service','usage','bridge','tunnel','layer','operator','ref','railway:track_ref','construction','proposed','building','public_transport','platform','public_transport:','train','network','level','man_made','bridge:name','maxspeed','embankment','cutting')
ROAD_TAGS = ('highway','name','ref','lanes','oneway','bridge','tunnel','layer','surface','junction','service','width','maxspeed','lit','sidewalk','bridge:name','man_made','level','lanes:forward','lanes:backward','divider','embankment','cutting')
def sel(t, keys): return {k: t[k] for k in keys if k in t}
def ring_pts(ring):
    out = []
    for n in ring:
        try: out.append((n.lon, n.lat))
        except Exception: return None
    return out

class H:
    def __init__(s):
        s.roads=[]; s.bld=[]; s.areas=[]; s.water=[]; s.rail=[]; s.poi=[]; s.barriers=[]; s.n=0

    def node(s, n):
        t = n.tags
        if not len(t): return
        if not any(k in t for k in KEEP_POI): return
        if t.get('highway') not in (None, 'bus_stop', 'traffic_signals', 'crossing', 'street_lamp', 'speed_camera', 'stop', 'motorway_junction') and 'name' not in t: return
        if not inb(n.location.lon, n.location.lat, 0): return
        d = {k.k: k.v for k in t if k.k in NODE_TAGS}
        s.poi.append({'id': n.id, 'p': P(n.location.lon, n.location.lat), 'tags': d})

    def way(s, w):
        s.n += 1
        t = w.tags
        if not len(t): return
        try:
            pts = [(nd.lon, nd.lat) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(pts) < 2: return
        if not any(inb(lo, la) for lo, la in pts[:: max(1, len(pts)//8)] + [pts[-1]]): return
        xy = [P(lo, la) for lo, la in pts]
        closed = w.nodes[0].ref == w.nodes[-1].ref and len(pts) >= 4
        g = t.get
        if 'highway' in t and not g('area') == 'yes':
            r = {'id': w.id, 'pts': xy, 'nodes': [nd.ref for nd in w.nodes], 'hw': g('highway')}
            r.update({k: g(k) for k in ROAD_TAGS if k != 'highway' and k in t})
            s.roads.append(r)
        elif ('building' in t or 'building:part' in t) and closed:
            s.bld.append({'id': w.id, 'pts': xy[:-1], 'holes': [], 't': sel(t, BLD_TAGS)})
        elif 'railway' in t:
            r = {'id': w.id, 'pts': xy, 'closed': closed}
            r.update({k: g(k) for k in RAIL_TAGS if k in t})
            s.rail.append(r)
        elif 'waterway' in t and not closed:
            s.water.append({'id': w.id, 'pts': xy, 'holes': [], 'kind': g('waterway'), 'name': g('name'), 'line': True})
        elif 'barrier' in t and g('barrier') in ('wall', 'fence', 'retaining_wall', 'gate', 'city_wall', 'hedge'):
            s.barriers.append({'id': w.id, 'pts': xy, 'kind': g('barrier'), 'closed': closed, 'h': g('height'), 'material': g('material')})
        elif closed and (g('natural') in ('water', 'wetland', 'bay') or g('waterway') or g('landuse') in ('reservoir', 'basin')):
            s.water.append({'id': w.id, 'pts': xy[:-1], 'holes': [], 'kind': g('natural') or g('waterway') or g('landuse'), 'name': g('name'), 'line': False})
        elif closed and any(k in t for k in ('landuse', 'leisure', 'amenity', 'natural', 'place', 'shop', 'man_made', 'aeroway', 'public_transport', 'tourism', 'craft', 'healthcare')):
            s.areas.append({'id': w.id, 'pts': xy[:-1], 'holes': [], 'tags': sel(t, AREA_TAGS)})

    def area(s, a):
        if a.from_way(): return
        t = a.tags
        if not len(t): return
        g = t.get
        is_b = 'building' in t or 'building:part' in t
        is_w = g('natural') in ('water', 'wetland', 'bay') or g('landuse') in ('reservoir', 'basin') or ('waterway' in t and g('waterway') in ('riverbank', 'dock'))
        is_a = any(k in t for k in ('landuse', 'leisure', 'amenity', 'natural', 'place', 'shop', 'man_made', 'aeroway', 'public_transport', 'tourism', 'craft', 'healthcare', 'railway'))
        if not (is_b or is_w or is_a): return
        for outer in a.outer_rings():
            pts = ring_pts(outer)
            if not pts or len(pts) < 4: continue
            if not any(inb(lo, la) for lo, la in pts[:: max(1, len(pts)//12)]): continue
            xy = [P(lo, la) for lo, la in pts][:-1]
            holes = []
            for inner in a.inner_rings(outer):
                hp = ring_pts(inner)
                if hp and len(hp) >= 4: holes.append([P(lo, la) for lo, la in hp][:-1])
            rid = a.orig_id()
            if is_b: s.bld.append({'id': 10_000_000_000 + rid, 'pts': xy, 'holes': holes, 't': sel(t, BLD_TAGS)})
            elif is_w: s.water.append({'id': 10_000_000_000 + rid, 'pts': xy, 'holes': holes, 'kind': g('natural') or g('landuse') or g('waterway'), 'name': g('name'), 'line': False})
            else: s.areas.append({'id': 10_000_000_000 + rid, 'pts': xy, 'holes': holes, 'tags': sel(t, AREA_TAGS)})

t0 = time.time(); h = H()
fp = osmium.FileProcessor(SRC).with_locations().with_areas()
for o in fp:
    if o.is_node(): h.node(o)
    elif o.is_way(): h.way(o)
    elif o.is_area(): h.area(o)
print('ways scanned', h.n, 'roads', len(h.roads), 'buildings', len(h.bld), 'areas', len(h.areas), 'water', len(h.water), 'rail', len(h.rail), 'poi', len(h.poi), 'barriers', len(h.barriers), f'{time.time()-t0:.0f}s')
pickle.dump({'origin': (LAT0, LON0), 'bbox': BBOX, 'roads': h.roads, 'areas': h.areas, 'water': h.water, 'rail': h.rail, 'poi': h.poi, 'barriers': h.barriers}, open(os.path.join(HERE, 'raw.pkl'), 'wb'))
pickle.dump(h.bld, open(os.path.join(HERE, 'bld.pkl'), 'wb'))
