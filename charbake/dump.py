import bpy, sys, json
from mathutils import Vector
path = sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.read_factory_settings(use_empty=True)
if path.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=path)
elif path.endswith('.fbx'):
    bpy.ops.import_scene.fbx(filepath=path)
else:
    bpy.ops.import_scene.gltf(filepath=path)
for o in bpy.data.objects:
    if o.type == 'ARMATURE':
        print('ARM', o.name, 'scale', tuple(round(s,3) for s in o.scale), 'rot', tuple(round(r,3) for r in o.rotation_euler), len(o.data.bones))
        for b in o.data.bones:
            h = o.matrix_world @ b.head_local; t = o.matrix_world @ b.tail_local
            print('  B', b.name, '<', b.parent.name if b.parent else '-', 'h', tuple(round(x,3) for x in h), 't', tuple(round(x,3) for x in t))
for o in bpy.data.objects:
    if o.type == 'MESH':
        mats = [m.name if m else None for m in o.data.materials]
        tex = []
        for m in o.data.materials:
            if m and m.use_nodes:
                for n in m.node_tree.nodes:
                    if n.type == 'TEX_IMAGE' and n.image: tex.append((n.image.name, n.image.size[:], n.image.filepath))
        print('MESH', o.name, 'tris', sum(len(p.vertices)-2 for p in o.data.polygons), 'mats', mats, 'vg', len(o.vertex_groups), 'parent', o.parent.name if o.parent else None, 'tex', tex[:6])
