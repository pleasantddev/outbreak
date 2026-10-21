# Character bake: puts any humanoid onto the UAL skeleton so one animation library drives everyone.
# 1. pose the source rig into the UAL T-pose (swing-align every limb segment, plus palm twist)
# 2. bake that pose into the meshes
# 3. copy the UAL armature and move its joints onto the source joints (bone orientations stay UAL's)
# 4. remap and merge vertex groups onto UAL bone names, decimate, build materials, export GLB
# usage: python3 bake.py <name>
import bpy, sys, re, math, json, os
from mathutils import Vector, Matrix, Quaternion

sys.path.insert(0, os.path.dirname(__file__))
from configs import CONFIGS

UAL = '/home/claude/hl/v2/public/assets/chars/male.glb'
OUT = '/home/claude/hl/charbake/out'

FING = ['index', 'middle', 'ring', 'pinky', 'thumb']
CHAIN = [('spine_01', 'spine_02'), ('spine_02', 'spine_03'), ('spine_03', 'neck_01'), ('neck_01', 'Head')]
for s in 'lr':
    CHAIN += [(f'clavicle_{s}', f'upperarm_{s}'), (f'upperarm_{s}', f'lowerarm_{s}'), (f'lowerarm_{s}', f'hand_{s}'), (f'hand_{s}', f'middle_01_{s}')]
    for f in FING:
        CHAIN += [(f'{f}_01_{s}', f'{f}_02_{s}'), (f'{f}_02_{s}', f'{f}_03_{s}')]
    CHAIN += [(f'thigh_{s}', f'calf_{s}'), (f'calf_{s}', f'foot_{s}'), (f'foot_{s}', f'ball_{s}')]
CHILD = dict(CHAIN)


def log(*a):
    print('[bake]', *a, flush=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_any(path):
    before = set(bpy.data.objects)
    if path.endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path, use_anim=False)
    elif path.endswith('.blend'):
        with bpy.data.libraries.load(path) as (src, dst):
            dst.objects = list(src.objects)
        for o in dst.objects:
            if o is not None:
                bpy.context.scene.collection.objects.link(o)
    else:
        bpy.ops.import_scene.gltf(filepath=path, bone_heuristic='BLENDER')
    return [o for o in bpy.data.objects if o not in before]


def template():
    new = import_any(UAL)
    arm = next(o for o in new if o.type == 'ARMATURE')
    for o in new:
        if o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
    arm.name = 'UAL'
    joints = {b.name: (arm.matrix_world @ b.head_local).copy() for b in arm.data.bones}
    return arm, joints


def wjoint(arm, name):
    return arm.matrix_world @ arm.pose.bones[name].head


def rotate_pb(arm, pb, rq, pivot):
    A = arm.matrix_world
    R3 = A.to_3x3().normalized()
    Ra = R3.inverted() @ rq.to_matrix() @ R3
    piv = A.inverted() @ pivot
    M = Matrix.Translation(piv) @ Ra.to_4x4() @ Matrix.Translation(-piv)
    pb.matrix = M @ pb.matrix
    bpy.context.view_layer.update()


def pose_to_ual(arm, jmap, ualJ):
    """Swing each mapped segment so it points the same way as in the UAL rest pose."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    for (u, c) in CHAIN:
        if u not in jmap or c not in jmap:
            continue
        pb = arm.pose.bones[jmap[u]]
        j0, j1 = wjoint(arm, jmap[u]), wjoint(arm, jmap[c])
        if (j1 - j0).length < 1e-5:
            log('zero segment', u, c); continue
        cur = (j1 - j0).normalized()
        tgt = (ualJ[c] - ualJ[u]).normalized()
        rq = cur.rotation_difference(tgt)
        if math.degrees(rq.angle) > 60:
            log('big swing', u, round(math.degrees(rq.angle)))
        rotate_pb(arm, pb, rq, j0)
        if u.startswith('hand_'):
            s = u[-1]
            if f'index_01_{s}' in jmap and f'pinky_01_{s}' in jmap:
                d = tgt
                a = wjoint(arm, jmap[f'pinky_01_{s}']) - wjoint(arm, jmap[f'index_01_{s}'])
                b = ualJ[f'pinky_01_{s}'] - ualJ[f'index_01_{s}']
                a = (a - d * a.dot(d)).normalized(); b = (b - d * b.dot(d)).normalized()
                ang = math.atan2(a.cross(b).dot(d), a.dot(b))
                rotate_pb(arm, pb, Quaternion(d, ang), wjoint(arm, jmap[u]))
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_meshes(meshes, arm):
    out = []
    for m in meshes:
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = m
        m.select_set(True)
        if m.data.shape_keys:
            bpy.ops.object.shape_key_remove(all=True)
        for mod in list(m.modifiers):
            if mod.type == 'ARMATURE':
                mod.object = arm
                bpy.ops.object.modifier_apply(modifier=mod.name)
            else:
                m.modifiers.remove(mod)
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        out.append(m)
    return out


def cull_stretch(meshes, rest, limit):
    """Drop faces that bridge limbs in the source pose (they tear into sheets once the arms come up)."""
    import numpy as np, bmesh
    for m in meshes:
        r = rest[m.name]
        co = np.empty(len(m.data.vertices) * 3, dtype=np.float32); m.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        h = r[:, 2].max() - r[:, 2].min()
        bm = bmesh.new(); bm.from_mesh(m.data)
        bad = []
        for f in bm.faces:
            vs = [v.index for v in f.verts]
            for a, b in zip(vs, vs[1:] + vs[:1]):
                l0 = np.linalg.norm(r[a] - r[b]); l1 = np.linalg.norm(co[a] - co[b])
                if l1 > limit * max(l0, 1e-6) and l1 > 0.02 * h:
                    bad.append(f); break
        if bad:
            bmesh.ops.delete(bm, geom=bad, context='FACES')
            # shards left floating after the cut go too
            seen = set(); small = []
            for f in bm.faces:
                if f.index in seen:
                    continue
                isl = [f]; seen.add(f.index); k = 0
                while k < len(isl):
                    for e in isl[k].edges:
                        for g in e.link_faces:
                            if g.index not in seen:
                                seen.add(g.index); isl.append(g)
                    k += 1
                if len(isl) < 60:
                    small += isl
            bmesh.ops.delete(bm, geom=small, context='FACES')
            bm.to_mesh(m.data)
        bm.free()
        log('cull', m.name, len(bad))


def weight_map(arm, jmap, extra):
    """Every source bone -> a UAL bone: the joint map, explicit merges, otherwise the nearest mapped ancestor."""
    rev = {v: k for k, v in jmap.items()}
    rev.update(extra)
    wm = {}
    for b in arm.data.bones:
        p = b
        while p is not None and p.name not in rev:
            p = p.parent
        wm[b.name] = rev[p.name] if p is not None else 'pelvis'
    return wm


def remap_groups(m, wm):
    idx = {vg.index: wm.get(vg.name) for vg in m.vertex_groups}
    acc = {}
    for v in m.data.vertices:
        d = {}
        for g in v.groups:
            t = idx.get(g.group)
            if t and g.weight > 1e-4:
                d[t] = d.get(t, 0.0) + g.weight
        if not d:
            d = {'pelvis': 1.0}
        s = sum(d.values())
        for t, w in d.items():
            acc.setdefault(t, {}).setdefault(round(w / s, 3), []).append(v.index)
    m.vertex_groups.clear()
    for t, buckets in acc.items():
        vg = m.vertex_groups.new(name=t)
        for w, ids in buckets.items():
            vg.add(ids, w, 'REPLACE')


def build_armature(tpl, ualJ, J, scale):
    arm = tpl.copy(); arm.data = tpl.data.copy(); arm.name = 'Armature'
    bpy.context.scene.collection.objects.link(arm)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = arm; arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    rest = {b.name: (b.head.copy(), b.tail.copy(), b.roll) for b in eb}
    for b in eb:
        b.use_connect = False
    order = []
    def walk(b):
        order.append(b.name)
        for c in b.children:
            walk(c)
    for b in eb:
        if b.parent is None:
            walk(b)
    head, ratio = {}, {}
    for n in order:
        b = eb[n]; h0, t0, roll = rest[n]
        if n in J:
            h = J[n].copy()
        elif b.parent is None:
            h = h0 * scale
        else:
            p = b.parent.name
            h = head[p] + (h0 - rest[p][0]) * ratio[p]
        c = CHILD.get(n)
        if c and c in J and n in J:
            ratio[n] = (J[c] - J[n]).length / max(1e-4, (ualJ[c] - ualJ[n]).length)
        else:
            ratio[n] = ratio.get(b.parent.name, scale) if b.parent is not None else scale
        head[n] = h
        b.head = h; b.tail = h + (t0 - h0) * ratio[n]; b.roll = roll
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def bind(meshes, arm):
    for m in meshes:
        m.parent = arm
        mod = m.modifiers.new('Armature', 'ARMATURE'); mod.object = arm


def decimate(m, tris):
    cur = sum(len(p.vertices) - 2 for p in m.data.polygons)
    if tris and cur > tris * 1.05:
        mod = m.modifiers.new('Dec', 'DECIMATE'); mod.ratio = tris / cur; mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.modifier_move_to_index(modifier='Dec', index=0)
        bpy.ops.object.modifier_apply(modifier='Dec')
        log('decimate', m.name, cur, '->', sum(len(p.vertices) - 2 for p in m.data.polygons))


# ------------------------------------------------------------------ materials
def img(path, size, non_color=False):
    im = bpy.data.images.load(path, check_existing=True)
    if size and max(im.size) > size:
        im.scale(size, size)
    if non_color:
        im.colorspace_settings.name = 'Non-Color'
    return im


def pbr(name, base=None, color=(0.5, 0.5, 0.5), rough=0.6, metal=0.0, nor=None, orm=None, emi=None, emi_strength=1.0, alpha=None, size=2048, blend=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links
    b = N['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if base:
        t = N.new('ShaderNodeTexImage'); t.image = img(base, size)
        L.new(t.outputs['Color'], b.inputs['Base Color'])
        if alpha == 'base':
            L.new(t.outputs['Alpha'], b.inputs['Alpha'])
    if alpha and alpha != 'base':
        t = N.new('ShaderNodeTexImage'); t.image = img(alpha, size, True)
        L.new(t.outputs['Color'], b.inputs['Alpha'])
    if alpha:
        m.blend_method = blend or 'HASHED'
    if nor:
        t = N.new('ShaderNodeTexImage'); t.image = img(nor, size, True)
        nm = N.new('ShaderNodeNormalMap'); L.new(t.outputs['Color'], nm.inputs['Color']); L.new(nm.outputs['Normal'], b.inputs['Normal'])
    if orm:
        t = N.new('ShaderNodeTexImage'); t.image = img(orm, size, True)
        sp = N.new('ShaderNodeSeparateColor'); L.new(t.outputs['Color'], sp.inputs['Color'])
        L.new(sp.outputs['Green'], b.inputs['Roughness']); L.new(sp.outputs['Blue'], b.inputs['Metallic'])
    if emi:
        t = N.new('ShaderNodeTexImage'); t.image = img(emi, 1024)
        L.new(t.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = emi_strength
    return m


def export(name, arm, meshes):
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    for m in meshes:
        m.select_set(True)
    path = f'{OUT}/{name}.glb'
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=False, export_skins=True,
                              export_morph=False, export_image_format='WEBP', export_image_quality=88, export_yup=True, export_apply=False)
    log('exported', path, os.path.getsize(path) // 1024, 'KB', 'tris', sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes))


def proxy_rig(src, meshes, jmap, merge):
    """Rigs with scale-compensation helpers shear when posed. Bake the mesh at rest, then rebuild a clean
    skeleton with UAL names on the rest joints and move the weights over to it."""
    J0 = {u: (src.matrix_world @ src.pose.bones[s].head).copy() for u, s in jmap.items()}
    wm = weight_map(src, jmap, merge)
    for m in meshes:
        bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = m; m.select_set(True)
        for mod in list(m.modifiers):
            if mod.type == 'ARMATURE':
                bpy.ops.object.modifier_apply(modifier=mod.name)
            else:
                m.modifiers.remove(mod)
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        remap_groups(m, wm)
    bpy.data.objects.remove(src, do_unlink=True)
    ad = bpy.data.armatures.new('proxy'); arm = bpy.data.objects.new('proxy', ad)
    bpy.context.scene.collection.objects.link(arm)
    bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = arm; arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    parent = {'spine_01': 'pelvis', 'spine_02': 'spine_01', 'spine_03': 'spine_02', 'neck_01': 'spine_03', 'Head': 'neck_01'}
    for s in 'lr':
        parent.update({f'clavicle_{s}': 'spine_03', f'upperarm_{s}': f'clavicle_{s}', f'lowerarm_{s}': f'upperarm_{s}', f'hand_{s}': f'lowerarm_{s}',
                       f'thigh_{s}': 'pelvis', f'calf_{s}': f'thigh_{s}', f'foot_{s}': f'calf_{s}', f'ball_{s}': f'foot_{s}'})
        for f in FING:
            parent.update({f'{f}_01_{s}': f'hand_{s}', f'{f}_02_{s}': f'{f}_01_{s}', f'{f}_03_{s}': f'{f}_02_{s}'})
    eb = ad.edit_bones
    for u, h in J0.items():
        b = eb.new(u); b.head = h
        c = CHILD.get(u)
        b.tail = J0[c] if c in J0 and (J0[c] - h).length > 1e-4 else h + Vector((0, 0, 0.05 * (1 if h.z > 0 else -1) or 0.05))
        if (b.tail - b.head).length < 1e-4:
            b.tail = h + Vector((0, 0, 0.05))
    for u in J0:
        p = parent.get(u)
        if p and p in J0:
            eb[u].parent = eb[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    for m in meshes:
        m.parent = arm
        mod = m.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
    return arm, {u: u for u in J0}


def run(name):
    cfg = CONFIGS[name]
    reset()
    tpl, ualJ = template()
    new = import_any(cfg['src'])
    src = next(o for o in new if o.type == 'ARMATURE')
    meshes = [o for o in new if o.type == 'MESH' and o.name not in cfg.get('drop', []) and (o.parent is src or any(md.type == 'ARMATURE' for md in o.modifiers))]
    if src.parent is not None:
        mw = src.matrix_world.copy(); src.parent = None; src.matrix_world = mw
    for o in new:
        if o.type not in ('ARMATURE',) and o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    names = {b.name for b in src.data.bones}
    jmap = {u: s for u, s in cfg['jmap'](names).items() if s in names}
    log('mapped', len(jmap), 'joints; missing', [u for u in ualJ if u not in jmap and 'leaf' not in u and u != 'root'])
    if cfg.get('pre'):
        cfg['pre'](src, meshes)
    if cfg.get('proxy'):
        src, jmap = proxy_rig(src, meshes, jmap, cfg.get('merge', {}))
        if cfg.get('post_proxy'):
            cfg['post_proxy'](src, meshes, {u: (src.matrix_world @ src.data.bones[u].head_local).copy() for u in jmap})
    rest = {}
    if cfg.get('cull_stretch'):
        import numpy as np
        for m in meshes:
            co = np.empty(len(m.data.vertices) * 3, dtype=np.float32); m.data.vertices.foreach_get('co', co)
            co = co.reshape(-1, 3); M = np.array(m.matrix_world)
            rest[m.name] = co @ M[:3, :3].T + M[:3, 3]
    pose_to_ual(src, jmap, ualJ)
    J = {u: wjoint(src, s).copy() for u, s in jmap.items()}
    wm = weight_map(src, jmap, cfg.get('merge', {}))
    meshes = bake_meshes(meshes, src)
    if rest:
        cull_stretch(meshes, rest, cfg['cull_stretch'])
    # recentre on the pelvis, feet on the ground, optional height normalise
    zmin = min((m.matrix_world @ Vector(c)).z for m in meshes for c in m.bound_box)
    zmax = max((m.matrix_world @ Vector(c)).z for m in meshes for c in m.bound_box)
    off = Vector((J['pelvis'].x, J['pelvis'].y, zmin))
    k = cfg['height'] / (zmax - zmin) if cfg.get('height') else 1.0
    T = Matrix.Scale(k, 4) @ Matrix.Translation(-off)
    for m in meshes:
        m.data.transform(T)
    for u in J:
        J[u] = T @ J[u]
    log('height', round((zmax - zmin) * k, 3), 'scale', round(k, 3))
    for m in meshes:
        remap_groups(m, wm)
    bpy.data.objects.remove(src, do_unlink=True)
    hscale = (J['pelvis'].z) / ualJ['pelvis'].z
    arm = build_armature(tpl, ualJ, J, hscale)
    bpy.data.objects.remove(tpl, do_unlink=True)
    if cfg.get('post'):
        meshes = cfg['post'](meshes, arm, J) or meshes
    for m in meshes:
        decimate(m, cfg.get('tris', {}).get(m.name, cfg.get('tris_default')))
    bind(meshes, arm)
    if cfg.get('materials'):
        cfg['materials'](meshes, pbr)
    cap = cfg.get('tex', 2048)
    for im in bpy.data.images:
        if im.size[0] > cap or im.size[1] > cap:
            f = cap / max(im.size); im.scale(max(1, int(im.size[0] * f)), max(1, int(im.size[1] * f)))
    meta = {'hip': J['pelvis'].z, 'height': max((Vector(c)).z for m in meshes for c in m.bound_box), 'mats': sorted({s.material.name for m in meshes for s in m.material_slots if s.material})}
    json.dump(meta, open(f'{OUT}/{name}.json', 'w'))
    export(name, arm, meshes)


if __name__ == '__main__':
    run(sys.argv[-1])
