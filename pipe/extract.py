# Reads the corridor OSM extract and writes projected, clipped feature lists (pickle) for the chunker.
# Map data (c) OpenStreetMap contributors, ODbL 1.0.
import osmium, pickle, math, sys, time
SRC = '/home/claude/hlosm/data/corridor.osm.pbf'
LAT0, LON0 = 6.5530, 3.3430          # origin: Oshodi interchange
BBOX = (3.150, 6.500, 3.400, 6.730)  # lon_min, lat_min, lon_max, lat_max
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110574.0
def P(lon, lat): return (round((lon - LON0) * KX, 2), round(-(lat - LAT0) * KZ, 2))
def inb(lon, lat, m=0.004): return BBOX[0]-m <= lon <= BBOX[2]+m and BBOX[1]-m <= lat <= BBOX[3]+m
KEEP_POI = ('amenity','shop','craft','office','public_transport','tourism','leisure','healthcare','place','railway','highway','man_made','historic','religion')
class H(osmium.SimpleHandler):
    def __init__(s):
        super().__init__(); s.roads=[]; s.bld=[]; s.areas=[]; s.water=[]; s.rail=[]; s.poi=[]; s.barriers=[]; s.n=0
    def node(s, n):
        t = n.tags
        if not len(t): return
        if not any(k in t for k in KEEP_POI): return
        if t.get('highway') not in (None, 'bus_stop', 'traffic_signals', 'crossing', 'street_lamp', 'speed_camera', 'stop') : 
            if 'name' not in t: return
        if not inb(n.location.lon, n.location.lat, 0): return
        s.poi.append({'id': n.id, 'p': P(n.location.lon, n.location.lat), 'tags': {k.k: k.v for k in t if k.k in KEEP_POI or k.k in ('name','name:en','operator','brand','cuisine','opening_hours','denomination','sport','shelter','bench','addr:street')}})
    def way(s, w):
        s.n += 1
        t = w.tags
        try:
            pts = [(nd.lon, nd.lat) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(pts) < 2: return
        if not any(inb(lo, la) for lo, la in pts[:: max(1, len(pts)//8)] + [pts[-1]]): return
        xy = [P(lo, la) for lo, la in pts]
        closed = w.nodes[0].ref == w.nodes[-1].ref and len(pts) >= 4
        g = lambda k: t.get(k)
        if 'highway' in t and not t.get('area') == 'yes':
            s.roads.append({'id': w.id, 'pts': xy, 'nodes': [nd.ref for nd in w.nodes], 'hw': g('highway'), 'name': g('name') or g('ref'), 'lanes': g('lanes'), 'oneway': g('oneway'), 'bridge': g('bridge'), 'tunnel': g('tunnel'), 'layer': g('layer'), 'surface': g('surface'), 'junction': g('junction'), 'service': g('service')})
        elif ('building' in t or 'building:part' in t) and closed:
            s.bld.append({'id': w.id, 'pts': xy[:-1], 'b': g('building') or 'yes', 'lv': g('building:levels'), 'h': g('height'), 'roof': g('roof:shape'), 'rlv': g('roof:levels'), 'name': g('name'), 'amenity': g('amenity'), 'shop': g('shop'), 'min': g('min_height')})
        elif 'railway' in t:
            s.rail.append({'id': w.id, 'pts': xy, 'kind': g('railway'), 'name': g('name'), 'bridge': g('bridge')})
        elif 'waterway' in t and not closed:
            s.water.append({'id': w.id, 'pts': xy, 'kind': g('waterway'), 'name': g('name'), 'line': True})
        elif 'barrier' in t and g('barrier') in ('wall', 'fence', 'retaining_wall', 'gate'):
            s.barriers.append({'id': w.id, 'pts': xy, 'kind': g('barrier')})
        elif closed and (g('natural') in ('water', 'wetland') or g('waterway') or g('landuse') in ('reservoir', 'basin')):
            s.water.append({'id': w.id, 'pts': xy[:-1], 'kind': g('natural') or g('waterway') or g('landuse'), 'name': g('name'), 'line': False})
        elif closed and any(k in t for k in ('landuse', 'leisure', 'amenity', 'natural', 'place', 'shop', 'man_made', 'aeroway', 'public_transport')):
            s.areas.append({'id': w.id, 'pts': xy[:-1], 'tags': {k.k: k.v for k in t if k.k in ('landuse','leisure','amenity','natural','name','shop','man_made','aeroway','public_transport','place','sport','religion')}})
t0 = time.time(); h = H(); h.apply_file(SRC, locations=True, idx='flex_mem')
print('ways scanned', h.n, 'roads', len(h.roads), 'buildings', len(h.bld), 'areas', len(h.areas), 'water', len(h.water), 'rail', len(h.rail), 'poi', len(h.poi), 'barriers', len(h.barriers), f'{time.time()-t0:.0f}s')
pickle.dump({'origin': (LAT0, LON0), 'bbox': BBOX, 'roads': h.roads, 'bld': h.bld, 'areas': h.areas, 'water': h.water, 'rail': h.rail, 'poi': h.poi, 'barriers': h.barriers}, open('/home/claude/hl/pipe/raw.pkl', 'wb'))
