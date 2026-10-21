# Shared constants and building classification for the HustleLife map pipeline.
import re, math

CLS = {'motorway': 1, 'trunk': 2, 'primary': 3, 'secondary': 4, 'tertiary': 5, 'unclassified': 6, 'residential': 7, 'living_street': 7, 'service': 8, 'motorway_link': 9, 'trunk_link': 9, 'primary_link': 10, 'secondary_link': 10, 'tertiary_link': 10, 'busway': 11, 'track': 12, 'footway': 13, 'path': 13, 'pedestrian': 13, 'steps': 14, 'construction': 15, 'road': 7, 'cycleway': 13}
SPLIT = {'motorway','trunk','primary','secondary','tertiary','unclassified','residential','living_street','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link','busway','road'}

def lanes_of(c, lanes, one):
    if lanes: return min(8, lanes)
    return {1: 3 if one else 6, 2: 3 if one else 4, 3: 2 if one else 4, 4: 2, 5: 2, 9: 1, 10: 1, 11: 1, 6: 2}.get(c, 1)
def half_width(c, lanes, one, width=None):
    if width:
        return max(1.2, min(30.0, width / 2.0))
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

def h01(n, salt=0):
    x = (int(n) * 2654435761 + salt * 97531) & 0xffffffff; x ^= x >> 15; x = (x * 2246822519) & 0xffffffff; x ^= x >> 13; return x / 4294967295.0

def parse_num(v):
    if v is None: return 0.0
    m = re.search(r'-?\d+(?:[.,]\d+)?', str(v))
    if not m: return 0.0
    try: return float(m.group(0).replace(',', '.'))
    except Exception: return 0.0

# building kinds (must match v2/src/world/region.ts BK)
BK = dict(house=1, shops=2, flats=3, hotel=4, warehouse=5, church=6, mosque=7, institution=8, unfinished=9, canopy=10, shed=11, stand=12, bank=13, terminal=14, station=15, market=16)
KIND_MAP = {'construction': 9, 'constructions': 9, 'church': 6, 'chapel': 6, 'cathedral': 6, 'temple': 6, 'mosque': 7, 'hotel': 4, 'motel': 4, 'hostel': 4, 'apartments': 3, 'dormitory': 3, 'commercial': 2, 'retail': 2, 'supermarket': 2, 'office': 2, 'kiosk': 11, 'industrial': 5, 'warehouse': 5, 'factory': 5, 'hangar': 5, 'manufacture': 5, 'school': 8, 'university': 8, 'college': 8, 'kindergarten': 8, 'hospital': 8, 'clinic': 8, 'government': 8, 'public': 8, 'civic': 8, 'roof': 10, 'carport': 10, 'canopy': 10, 'hut': 11, 'shed': 11, 'garage': 11, 'garages': 11, 'service': 11, 'container': 11, 'cabin': 11, 'grandstand': 12, 'stadium': 12, 'train_station': 15, 'transportation': 14}
ROOF = {'flat': 0, 'gabled': 1, 'hipped': 2, 'pyramidal': 3, 'skillion': 4, 'dome': 5, 'half-hipped': 2, 'gambrel': 1, 'round': 5, 'mansard': 2, 'saltbox': 1}
COLORS = {'white': (240,240,235), 'grey': (150,150,150), 'gray': (150,150,150), 'black': (40,40,40), 'red': (170,50,40), 'blue': (50,90,170), 'green': (60,130,70), 'yellow': (230,200,70), 'brown': (120,85,55), 'beige': (225,210,175), 'cream': (240,230,200), 'orange': (230,140,50), 'pink': (230,160,170), 'silver': (190,190,195), 'tan': (200,170,130), 'maroon': (110,30,30), 'purple': (110,70,140), 'terracotta': (180,100,70), 'lightgrey': (200,200,200), 'darkgrey': (90,90,90), 'lightblue': (150,190,230), 'cyan': (60,180,200), 'gold': (210,170,60)}
def parse_colour(v):
    if not v: return None
    v = v.strip().lower()
    if v.startswith('#'):
        h = v[1:]
        if len(h) == 3: h = ''.join(c * 2 for c in h)
        if len(h) == 6:
            try: return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
            except Exception: return None
        return None
    return COLORS.get(v.replace(' ', ''))

def building_kind(t):
    """Explicit kind from tags, or 0 for 'generic, decide by context'."""
    b = t.get('building') or 'yes'
    if t.get('amenity') == 'bank' or t.get('office') == 'financial' and 'bank' in (t.get('name') or '').lower(): return BK['bank']
    if t.get('amenity') == 'bus_station' or t.get('aeroway') == 'terminal': return BK['terminal']
    if b == 'train_station' or t.get('railway') in ('station', 'halt') or (t.get('public_transport') == 'station' and t.get('railway')): return BK['station']
    if t.get('amenity') == 'place_of_worship' or b in ('church', 'chapel', 'cathedral', 'temple', 'mosque'):
        if b in ('mosque',) or t.get('religion') == 'muslim': return BK['mosque']
        return BK['church']
    if t.get('amenity') in ('school', 'university', 'college', 'hospital', 'clinic', 'kindergarten', 'courthouse', 'police', 'fire_station', 'townhall'): return BK['institution']
    if t.get('amenity') == 'marketplace' or t.get('shop') in ('mall', 'department_store'): return BK['market']
    if t.get('tourism') in ('hotel', 'motel', 'guest_house', 'hostel'): return BK['hotel']
    if t.get('shop') in ('car_repair', 'car_parts', 'tyres', 'car'): return BK['shed'] if b in ('yes', 'shed', 'garage', 'service') else KIND_MAP.get(b, 0)
    return KIND_MAP.get(b, 0)

def roof_of(t):
    return ROOF.get((t.get('roof:shape') or '').lower(), 0)

def explicit_levels(t):
    lv = 0
    try:
        v = t.get('building:levels')
        if v: lv = int(round(parse_num(v)))
    except Exception: lv = 0
    if lv <= 0 and t.get('height'):
        h = parse_num(t.get('height'))
        if h > 0: lv = max(1, int(round(h / 3.2)))
    return lv
