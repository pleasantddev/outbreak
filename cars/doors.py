# Splits each car's body into opening doors with hinges at the front edge, adds a danfo cabin interior,
# and exports game GLBs with nodes: body, door_fl, door_fr, door_rl, door_rr (or door_slide), wheel0..3.
# Front of every car is +z, ground at y=0 (three.js frame). Blender is z-up, so glTF import maps three (x,y,z) -> blender (x,-z,y).
import bpy, bmesh, json, sys, math
from mathutils import Vector, Matrix

CARS = {
  # name: (front door z range [zf0, zf1], rear door [zr0, zr1] or None, sill y, top y, side inset fraction, sliding)
  'camry':   dict(front=(0.05, 1.02), rear=(-0.92, 0.05), sill=0.38, top=1.42, slide=False),
  'golf':    dict(front=(-0.10, 1.15), rear=None, sill=0.34, top=1.40, slide=False),
  'civic':   dict(front=(-0.15, 1.00), rear=None, sill=0.34, top=1.30, slide=False),
  'rrsport': dict(front=(0.05, 1.10), rear=(-0.85, 0.05), sill=0.52, top=1.80, slide=False),
  'gclass':  dict(front=(0.05, 1.07), rear=(-0.95, 0.05), sill=0.55, top=1.90, slide=False),
  'hiace':   dict(front=(1.08, 1.98), rear=(-0.45, 1.00), sill=0.45, top=1.86, slide=True),
}

def b2t(v):  # blender -> three
    return Vector((v.x, v.z, -v.y))
def t2b(x, y, z):
    return Vector((x, -z, y))

def process(name):
    cfg = CARS[name]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f'/home/claude/hl/cars/{name}.raw.glb')
    meta = json.load(open(f'/home/claude/hl/cars/{name}.json'))
    W = meta['width']
    body = next(o for o in bpy.data.objects if o.name.startswith('body') and o.type == 'MESH')
    # apply transforms so vertex coords are in object=world space
    bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = body.data
    bm = bmesh.new(); bm.from_mesh(me)
    # cut clean seams with planes (three z == blender -y, three y == blender z)
    cuts = []
    for z in [cfg['front'][0], cfg['front'][1]] + ([cfg['rear'][0], cfg['rear'][1]] if cfg['rear'] else []):
        cuts.append(((0, -z, 0), (0, 1, 0)))
    cuts.append(((0, 0, cfg['sill']), (0, 0, 1)))
    for co, no in cuts:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_inner=False, clear_outer=False)
    bm.faces.ensure_lookup_table()
    doors = {}
    regions = [('fl', 1, cfg['front']), ('fr', -1, cfg['front'])]
    if cfg['rear']:
        if cfg['slide']: regions.append(('slide', -1, cfg['rear']))
        else: regions += [('rl', 1, cfg['rear']), ('rr', -1, cfg['rear'])]
    assign = {}
    for f in bm.faces:
        c = f.calc_center_median(); t = b2t(c)
        if t.y < cfg['sill'] - 0.01 or t.y > cfg['top']: continue
        for key, side, (z0, z1) in regions:
            if not (z0 + 0.005 < t.z < z1 - 0.005): continue
            if side * t.x < W * 0.30: continue
            assign[f.index] = key; break
    # build door meshes from the assigned faces
    for key, side, (z0, z1) in regions:
        idx = [i for i, k in assign.items() if k == key]
        if not idx: continue
        dm = bm.copy()
        dm.faces.ensure_lookup_table()
        keep = set(idx)
        bmesh.ops.delete(dm, geom=[f for f in dm.faces if f.index not in keep], context='FACES')
        mesh = bpy.data.meshes.new(f'door_{key}')
        dm.to_mesh(mesh); dm.free()
        for m in me.materials: mesh.materials.append(m)
        ob = bpy.data.objects.new(f'door_{key}', mesh); bpy.context.collection.objects.link(ob)
        # hinge: front edge (z1), outer x of the door
        xs = [b2t(v.co).x for v in mesh.vertices]
        hx = max(xs) if side > 0 else min(xs)
        hinge = t2b(hx, cfg['sill'], z1) if key != 'slide' else t2b(hx, cfg['sill'], (z0 + z1) / 2)
        for v in mesh.vertices: v.co -= hinge
        ob.location = hinge
        doors[key] = ob
    # remove door faces from the body
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in assign], context='FACES')
    bm.to_mesh(me); bm.free()
    # danfo: add a cabin with benches so the open sliding door shows seats, not a void
    if name == 'hiace':
        seat = bpy.data.materials.new('seat'); seat.use_nodes = True
        seat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.05, 0.04, 1)
        seat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
        floor = bpy.data.materials.new('cabin'); floor.use_nodes = True
        floor.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.12, 0.12, 0.12, 1)
        def box(nm, x, y, z, sx, sy, sz, mat):
            bpy.ops.mesh.primitive_cube_add(size=1, location=t2b(x, y, z))
            o = bpy.context.active_object; o.name = nm; o.scale = (sx, sz, sy); bpy.ops.object.transform_apply(scale=True)
            o.data.materials.append(mat); return o
        parts = [box('floor', 0, 0.52, -0.2, 1.7, 0.04, 3.4, floor)]
        for i, z in enumerate([0.75, -0.05, -0.85, -1.6]):
            parts.append(box(f'bench{i}', 0, 0.82, z, 1.6, 0.12, 0.45, seat))
            parts.append(box(f'back{i}', 0, 1.12, z - 0.2, 1.6, 0.55, 0.08, seat))
        bpy.ops.object.select_all(action='DESELECT')
        for p in parts: p.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]; bpy.ops.object.join(); parts[0].name = 'cabin'
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=f'/home/claude/hl/cars/out/{name}.glb', export_format='GLB', export_apply=False, export_yup=True, export_draco_mesh_compression_enable=False)
    print(name, 'doors', list(doors.keys()), 'faces moved', len(assign))

import os
os.makedirs('/home/claude/hl/cars/out', exist_ok=True)
for n in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else CARS.keys()):
    process(n)
