# Writes v2/src/data/clubs.json: three big parody clubs, where they stand and where everything inside them is, all in world metres.
# Sites were found by rasterising the OSM extract (buildings, roads, water and landuse, 1 m cells) and looking for free lots with road frontage in
# the Victoria Island / Ikoyi / Lekki side of the map; the rooftop club uses an existing 21-level tower (OSM way 998873752) as its base.
# Everything fictional: names are parodies, nothing here is a real brand. Dancers on the pole stages are clothed, athletic, a job.
#
# Local frame of a ground club: origin at the middle of the front wall, v runs from the street into the club, u runs across (right hand when you walk in).
#   world = C + u * R + v * F,  F = -(sin yaw, cos yaw) (into the club), R = (F.z, -F.x), yaw = the way the door faces (out to the street).
# Poses: yaw is the direction the thing faces, same convention as billboards.json: facing (sin yaw, cos yaw).
import json, math, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)

def frame(cx, cz, yaw):
    F = (-math.sin(yaw), -math.cos(yaw)); R = (F[1], -F[0])
    def W(u, v): return (cx + u * R[0] + v * F[0], cz + u * R[1] + v * F[1])
    return W
def pose(W, u, v, y, face_u, face_v, yaw0):
    """world pose at local (u, v, y), facing toward local point (face_u, face_v)."""
    x, z = W(u, v); fx, fz = W(face_u, face_v); a = math.atan2(fx - x, fz - z)
    return {'x': round(x, 2), 'y': round(y, 2), 'z': round(z, 2), 'yaw': round(a, 3)}

clubs = []
# ------------------------------------------------------------------ ZILOX Superclub: the big one, a black box with LED stripes on Bourdillon Road
W_, D_, yaw = 46.0, 34.0, 0.103; cx_, cz_ = 9628.0, 12034.0
# the site centre is the middle of the lot; the front wall is D/2 toward the road
Fz = (-math.sin(yaw), -math.cos(yaw)); fx_, fz_ = cx_ - Fz[0] * D_ / 2, cz_ - Fz[1] * D_ / 2     # middle of the front wall
W = frame(fx_, fz_, yaw)
floor_c = (0.0, 17.0)
z = {'id': 'zilox', 'name': 'ZILOX Superclub', 'tag': 'Ikoyi, Bourdillon Road (Victoria Island is past the map edge)', 'kind': 'club', 'storeys': 2, 'h': 11.0,
     'x': round(cx_, 1), 'z': round(cz_, 1), 'yaw': yaw, 'w': W_, 'd': D_, 'palette': {'wall': '#14141a', 'neon': '#ff2fa0', 'accent': '#2fd0ff'}}
dx, dz = W(0, -0.4); z['door'] = {'x': round(dx, 2), 'y': 0.0, 'z': round(dz, 2), 'yaw': round(yaw, 3), 'w': 4.0}
z['inside'] = pose(W, 0, 3.5, 0.0, 0, 17, yaw)
z['dj'] = pose(W, 0, D_ - 3.6, 0.7, 0, 0, yaw)
z['djStage'] = {'u': 0, 'v': D_ - 2.8, 'w': 14.0, 'd': 5.0, 'y': 0.7}
z['floor'] = {**pose(W, *floor_c, 0.0, 0, 0, yaw), 'w': 18.0, 'd': 14.0}
z['poles'] = [{'id': f'zilox-p{i + 1}', **pose(W, u, v, 0.5, floor_c[0], floor_c[1], yaw), 'r': 1.4} for i, (u, v) in enumerate([(-12.0, 10.0), (12.0, 10.0), (-12.0, 24.0), (12.0, 24.0)])]
z['bar'] = pose(W, -W_ / 2 + 2.6, 15.0, 0.0, 0, 15, yaw); z['bar']['len'] = 16.0
z['vip'] = [{'id': f'zilox-v{i + 1}', **pose(W, W_ / 2 - 2.6, 6.0 + i * 6.5, 0.0, 0, 6.0 + i * 6.5, yaw)} for i in range(4)]
clubs.append(z)

# ------------------------------------------------------------------ GELE Lounge: smaller VI lounge on Okotie Eboh Street, warm brick and gold
W_, D_, yaw = 30.0, 22.0, 1.472; cx_, cz_ = 9227.0, 11839.0
Fz = (-math.sin(yaw), -math.cos(yaw)); fx_, fz_ = cx_ - Fz[0] * D_ / 2, cz_ - Fz[1] * D_ / 2
W = frame(fx_, fz_, yaw)
g = {'id': 'gele', 'name': 'GELE Lounge', 'tag': 'Ikoyi, Okotie Eboh Street, by the Falomo end', 'kind': 'lounge', 'storeys': 1, 'h': 6.5,
     'x': round(cx_, 1), 'z': round(cz_, 1), 'yaw': yaw, 'w': W_, 'd': D_, 'palette': {'wall': '#7a3b24', 'neon': '#ffb02f', 'accent': '#e8412c'}}
dx, dz = W(0, -0.4); g['door'] = {'x': round(dx, 2), 'y': 0.0, 'z': round(dz, 2), 'yaw': round(yaw, 3), 'w': 3.2}
g['inside'] = pose(W, 0, 3.0, 0.0, 0, 11, yaw)
g['dj'] = pose(W, 6.5, D_ - 2.8, 0.5, 0, 6, yaw)
g['djStage'] = {'u': 6.5, 'v': D_ - 2.2, 'w': 6.0, 'd': 3.6, 'y': 0.5}
g['floor'] = {**pose(W, 0, 12.0, 0.0, 0, 0, yaw), 'w': 12.0, 'd': 9.0}
g['poles'] = [{'id': f'gele-p{i + 1}', **pose(W, u, v, 0.45, 0, 11.0, yaw), 'r': 1.2} for i, (u, v) in enumerate([(-8.0, 15.0), (-8.0, 9.0)])]
g['bar'] = pose(W, W_ / 2 - 2.4, 10.0, 0.0, 0, 10, yaw); g['bar']['len'] = 10.0
g['vip'] = [{'id': f'gele-v{i + 1}', **pose(W, -W_ / 2 + 2.4, 3.5 + i * 5.0, 0.0, 0, 3.5 + i * 5.0, yaw)} for i in range(3)]
clubs.append(g)

# ------------------------------------------------------------------ ORUN Rooftop: open-air club on the roof of a 21-level tower on the Lekki side
# tower footprint (OSM way 998873752): x 11092..11128, z 10649..10678, roof at 0.45 + 21 * 3.1 m. Local frame: v runs along the long axis, u across.
cx_, cz_ = 11110.0, 10663.5; ROOF = round(0.45 + 21 * 3.1, 2); yaw = 0.0   # the lobby door faces +z (the street side, south)
W_, D_ = 30.0, 24.0
def Wr(u, v): return (cx_ + u, cz_ + (v - D_ / 2))   # unrotated: u east, v south, origin at the north-west edge middle... keep it axis aligned
o = {'id': 'orun', 'name': 'ORUN Rooftop', 'tag': 'Ikoyi, east edge of the map (Lekki side), rooftop on a 21-level tower', 'kind': 'rooftop', 'storeys': 21, 'h': ROOF,
     'x': cx_, 'z': cz_, 'yaw': yaw, 'w': W_, 'd': D_, 'roofY': ROOF, 'palette': {'wall': '#1d2a3a', 'neon': '#33e0c4', 'accent': '#ffcf3d'}}
o['door'] = {'x': cx_, 'y': 0.0, 'z': round(cz_ + 14.5 + 0.4, 2), 'yaw': 0.0, 'w': 3.0}                # lobby door at the foot of the tower, south face
o['lift'] = {'from': {'x': cx_, 'z': round(cz_ + 14.5 - 3.0, 2)}, 'to': {'x': cx_, 'y': ROOF, 'z': round(cz_ + 9.0, 2), 'yaw': math.pi}}   # the lead's lift moves players from the lobby spot up to the deck
o['inside'] = {'x': cx_, 'y': ROOF, 'z': round(cz_ + 9.0, 2), 'yaw': math.pi}
Wd = lambda u, v: (round(cx_ + u, 2), round(cz_ + v, 2))
def at(u, v, y, tu, tv): x, z = Wd(u, v); a = math.atan2(tu - u, tv - v); return {'x': x, 'y': round(y, 2), 'z': z, 'yaw': round(a, 3)}
o['dj'] = at(0, -10.0, ROOF + 0.5, 0, 0)
o['djStage'] = {'w': 9.0, 'd': 3.6, 'y': 0.5}   # y is the stage height above the floor, like the ground clubs
o['floor'] = {**at(0, -1.0, ROOF, 0, -10), 'w': 14.0, 'd': 10.0}
o['poles'] = [{'id': f'orun-p{i + 1}', **at(u, v, ROOF + 0.45, 0, -1.0), 'r': 1.3} for i, (u, v) in enumerate([(-9.0, -5.0), (9.0, -5.0), (0.0, 4.0)])]
o['bar'] = {**at(-12.4, 3.0, ROOF, 0, 3.0), 'len': 9.0}
o['vip'] = [{'id': f'orun-v{i + 1}', **at(12.2, -3.0 + i * 5.5, ROOF, 0, -3.0 + i * 5.5)} for i in range(3)]
clubs.append(o)

json.dump(clubs, open(os.path.join(ROOT, 'v2', 'src', 'data', 'clubs.json'), 'w'), indent=1)
print(len(clubs), 'clubs;', sum(len(c['poles']) for c in clubs), 'pole stages')
