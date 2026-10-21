# Split the office scan collection into unique static people, centre each, decimate, darken skin tones for Lagos, 1K textures.
import bpy, bmesh, colorsys
import numpy as np
from mathutils import Vector, Matrix
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/home/claude/hl/v2/public/devm/office.glb')
keep = ['10-001', '10-002', '10-003', '10-004', '10-005', '10-006', '10-010']
groups = {}
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        continue
    k = next((k for k in keep if f'x {k}_' in o.name), None)
    if k is None or len(o.data.polygons) < 100:
        bpy.data.objects.remove(o, do_unlink=True); continue
    groups.setdefault(k, []).append(o)
# bake every parent transform (Sketchfab root: cm scale, z-up rotation) into the meshes before dropping the empties
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        if o.data.users > 1:
            o.data = o.data.copy()
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
out = []
done_imgs = set()
for i, k in enumerate(keep):
    objs = groups[k]
    for o in objs:
        o.select_set(True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    co = np.empty(len(o.data.vertices) * 3, dtype=np.float32); o.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    bb = [Vector(co.min(0)), Vector(co.max(0))]
    cx = (bb[0].x + bb[1].x) / 2; cy = (bb[0].y + bb[1].y) / 2; zmin = bb[0].z
    o.data.transform(Matrix.Translation((-cx, -cy, -zmin)))
    n = len(o.data.polygons)
    mod = o.modifiers.new('d', 'DECIMATE'); mod.ratio = 16000 / n
    bpy.ops.object.modifier_apply(modifier='d')
    o.name = f'person{i}'
    o.location = (0, 0, 0)
    for m in o.data.materials:
        for nd in m.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image and nd.image.name not in done_imgs:
                im = nd.image; done_imgs.add(im.name)
                if max(im.size) > 1024:
                    im.scale(1024, 1024)
                px = np.array(im.pixels[:], dtype=np.float32).reshape(-1, 4)
                r, g, b = px[:, 0], px[:, 1], px[:, 2]
                mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
                sat = (mx - mn) / np.maximum(mx, 1e-4)
                skin = (r > g) & (g > b) & (sat > 0.18) & (sat < 0.62) & (mx > 0.25) & ((r - g) / np.maximum(mx - mn, 1e-4) > 0.35)
                # darken skin toward a deep brown while keeping its shading
                lum = (0.3 * r + 0.59 * g + 0.11 * b)
                tgt = np.stack([lum * 0.42, lum * 0.25, lum * 0.16], -1)
                px[skin, :3] = tgt[skin]
                im.pixels[:] = px.ravel()
                im.update()
                print('skin px', im.name, round(skin.mean(), 3))
    out.append(o)
    print('person', i, n, '->', len(o.data.polygons), 'h', round(bb[1].z - zmin, 2))
bpy.ops.object.select_all(action='DESELECT')
for o in out:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath='/home/claude/hl/charbake/out/office.glb', export_format='GLB', use_selection=True, export_image_format='WEBP', export_image_quality=85)
