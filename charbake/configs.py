import re
CH = '/home/claude/hl/chars_in/'
TX = '/home/claude/hl/charbake/tex/'
FING = ['index', 'middle', 'ring', 'pinky', 'thumb']


def ue_map(names):
    """UE4 / UE5 mannequin naming is nearly UAL already. UE5 has five spine bones: 1,3,5 carry the joints."""
    m = {'pelvis': 'pelvis', 'neck_01': 'neck_01', 'Head': 'head'}
    if 'spine_05' in names:
        m.update(spine_01='spine_01', spine_02='spine_03', spine_03='spine_05')
    else:
        m.update(spine_01='spine_01', spine_02='spine_02', spine_03='spine_03')
    for s in 'lr':
        for b in ['clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball']:
            m[f'{b}_{s}'] = f'{b}_{s}'
        for f in FING:
            for i in (1, 2, 3):
                m[f'{f}_0{i}_{s}'] = f'{f}_0{i}_{s}'
    return m


UE5_MERGE = {'spine_02': 'spine_01', 'spine_04': 'spine_02', 'neck_02': 'neck_01'}


def farah_map(names):
    def find(base):
        for n in names:
            if re.fullmatch(base + r'_\d+', n):
                return n
        return None
    m = {'pelvis': find('Pelvis'), 'spine_01': find('Waist'), 'spine_02': find('Spine01'), 'spine_03': find('Spine02'),
         'neck_01': find('NeckTwist01'), 'Head': find('Head')}
    side = {'l': 'L', 'r': 'R'}
    part = {'clavicle': 'Clavicle', 'upperarm': 'Upperarm', 'lowerarm': 'Forearm', 'hand': 'Hand', 'thigh': 'Thigh', 'calf': 'Calf', 'foot': 'Foot', 'ball': 'ToeBase'}
    fing = {'index': 'Index', 'middle': 'Mid', 'ring': 'Ring', 'pinky': 'Pinky', 'thumb': 'Thumb'}
    for s, S in side.items():
        for u, f in part.items():
            m[f'{u}_{s}'] = find(f'{S}_{f}')
        for u, f in fing.items():
            for i in (1, 2, 3):
                m[f'{u}_0{i}_{s}'] = find(f'{S}_{f}{i}')
    return {k: v for k, v in m.items() if v}


# ------------------------------------------------------------------ materials
def trooper_mats(meshes, pbr):
    top = pbr('Trooper_Top', base=TX + 'trooper_top_base.png', nor=TX + 'trooper_top_nor.png', orm=TX + 'trooper_top_orm.png', emi=TX + 'trooper_top_emi.png', emi_strength=2.0)
    bot = pbr('Trooper_Bottom', base=TX + 'trooper_bottom_base.png', nor=TX + 'trooper_bottom_nor.png', orm=TX + 'trooper_bottom_orm.png', emi=TX + 'trooper_bottom_emi.png', emi_strength=2.0)
    for m in meshes:
        for s in m.material_slots:
            s.material = top if s.material and s.material.name.startswith('03') else bot


def flat_mats(table):
    """Untextured sources: one tuned PBR material per source material name until the texture sets arrive."""
    def f(meshes, pbr):
        made = {}
        for m in meshes:
            for s in m.material_slots:
                n = s.material.name if s.material else 'none'
                key = next((k for k in table if n.startswith(k)), None)
                if key is None:
                    continue
                if key not in made:
                    c, r, mt = table[key]
                    made[key] = pbr(key, color=c, rough=r, metal=mt)
                s.material = made[key]
    return f


SURVIVOR = {'Head': ((0.09, 0.045, 0.028), 0.5, 0), 'Body2': ((0.09, 0.045, 0.028), 0.5, 0), 'Arms': ((0.09, 0.045, 0.028), 0.5, 0),
            'Jacket': ((0.045, 0.05, 0.04), 0.8, 0), 'Jeans': ((0.03, 0.045, 0.08), 0.85, 0), 'Shoes': ((0.05, 0.045, 0.04), 0.6, 0),
            'Backpack': ((0.16, 0.12, 0.08), 0.85, 0), 'Gloves': ((0.03, 0.03, 0.03), 0.7, 0), 'Mouth': ((0.35, 0.12, 0.12), 0.4, 0),
            'Body_Arkit': ((0.05, 0.025, 0.015), 0.1, 0)}
ROGUE = {'Head': ((0.09, 0.045, 0.028), 0.5, 0), 'LeatherA': ((0.07, 0.06, 0.055), 0.55, 0), 'LeatherB': ((0.06, 0.04, 0.028), 0.6, 0),
         'Cloth': ((0.1, 0.1, 0.11), 0.9, 0), 'Metal': ((0.5, 0.5, 0.52), 0.35, 1)}

GIRL = {'body_skin': ((0.12, 0.06, 0.038), 0.5, 0), 'head_eyes': ((0.04, 0.02, 0.012), 0.15, 0), 'head': ((0.12, 0.06, 0.038), 0.5, 0),
        'hair': ((0.012, 0.009, 0.008), 0.75, 0), 'body': ((0.35, 0.08, 0.06), 0.85, 0)}


def drop_material(names):
    import bpy, bmesh
    def post(meshes, arm, J):
        for m in meshes:
            idx = [i for i, s in enumerate(m.material_slots) if s.material and s.material.name.split('.')[0] in names]
            if not idx:
                continue
            bm = bmesh.new(); bm.from_mesh(m.data)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in idx], context='FACES')
            bm.to_mesh(m.data); bm.free()
        return meshes
    return post


CONFIGS = {
    'trooper': dict(src=CH + 'trooper_SK.fbx', jmap=ue_map, merge={}, tris_default=None, materials=trooper_mats),
    'survivor': dict(src=CH + 'd49a17d7-survival_character.fbx', jmap=ue_map, merge=UE5_MERGE, drop=['Hair', 'Eyebrows', 'Eyeleash', 'Backpack'],
                     tris={'Body3': 14000, 'Jacket': 7000, 'Shoes': 3000, 'Jeans': 3500, 'Mouth1': 1200, 'Gloves': 1600}, materials=flat_mats(SURVIVOR)),
    'rogue': dict(src=CH + '358afaa9-rogue_all.fbx', jmap=ue_map, merge=UE5_MERGE, tris_default=3000, materials=flat_mats(ROGUE)),
    'girl': dict(src=CH + '751e15ce-girl.blend', jmap=ue_map, merge={}, height=1.66, materials=flat_mats(GIRL), post=drop_material({'eyelashes'})),
    'farah': dict(src='/home/claude/hl/v2/public/devm/farah.glb', jmap=farah_map, merge={}, tris_default=None, height=1.70, proxy=True, cull_stretch=2.2, post_proxy=lambda a, ms, J: borrow_weights(a, ms, J, ['Object_14']),
                  drop=['Object_18', 'Object_22'], post=lambda ms, a, J: farah_post(ms, a, J)),
}


def darken_skin_image(im, k=(0.5, 0.3, 0.2)):
    import numpy as np
    px = np.array(im.pixels[:], dtype=np.float32).reshape(-1, 4)
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    hue_ok = (r >= g) & (g >= b * 0.92)
    skin = hue_ok & (sat > 0.1) & (sat < 0.8) & (mx > 0.18)
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    w = np.clip((sat - 0.1) / 0.08, 0, 1) * skin
    for i in range(3):
        px[:, i] = px[:, i] * (1 - w) + lum * k[i] * 1.05 * w
    # blue irises to dark brown, and soften the lipstick
    blue = (b > r + 0.04) & (b > g)
    for i, kk in enumerate((0.55, 0.33, 0.2)):
        px[blue, i] = lum[blue] * kk * 1.2
    red = (r > g * 1.6) & (r > b * 1.4) & (sat > 0.45)
    px[red, 0] *= 0.62; px[red, 1] *= 0.7; px[red, 2] *= 0.75
    im.pixels[:] = px.ravel(); im.update()
    return float(skin.mean())


def base_image(mat):
    for l in mat.node_tree.links:
        if l.to_socket.name == 'Base Color' and l.from_node.type == 'TEX_IMAGE':
            return l.from_node.image
    return None


def farah_post(meshes, arm, J):
    import bpy, bmesh
    from mathutils import Vector
    done = set()
    for m in meshes:
        for s in m.material_slots:
            mat = s.material
            if not mat or mat.name in done:
                continue
            done.add(mat.name)
            # Sketchfab left every material alpha-blended, which breaks depth sorting on the face. Clip instead.
            mat.blend_method = 'CLIP' if hasattr(mat, 'blend_method') else None
            try:
                mat.alpha_threshold = 0.5
            except Exception:
                pass
            if 'Merge1' in mat.name or 'Scalp' in mat.name:
                im = base_image(mat)
                if im is not None and im.name not in done:
                    done.add(im.name)
                    if max(im.size) > 2048:
                        im.scale(2048, 2048)
                    print('[bake] skin px', im.name, round(darken_skin_image(im), 3))
    body = next(m for m in meshes if m.name == 'Object_14')
    shoulder = J['upperarm_l'].x; elbow = J['lowerarm_l'].x
    waist = J['pelvis'].z + 0.075; neck = J['neck_01'].z - 0.045; ankle = J['foot_l'].z + 0.035
    def region(co):
        ax = abs(co.x)
        if co.z < J['ball_l'].z + 0.07 and ax < 0.3:
            return 'Shoes'
        if ankle < co.z < waist and ax < 0.3:
            return 'Cloth_Bottom'
        if waist <= co.z < neck and ax <= shoulder + 0.02:
            return 'Cloth_Top'
        if ax > shoulder and ax < shoulder + 0.4 * (elbow - shoulder) and co.z > J['upperarm_l'].z - 0.12:
            return 'Cloth_Top'
        return None
    out = list(meshes)
    for name, off, col in [('Cloth_Top', 0.004, (0.5, 0.2, 0.05)), ('Cloth_Bottom', 0.005, (0.05, 0.06, 0.1)), ('Shoes', 0.006, (0.04, 0.035, 0.03))]:
        bm = bmesh.new(); bm.from_mesh(body.data)
        keep = [f for f in bm.faces if all(region(v.co) == name for v in f.verts)]
        dele = [f for f in bm.faces if f not in set(keep)]
        bmesh.ops.delete(bm, geom=dele, context='FACES')
        bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=14)
        bm.normal_update()
        for v in bm.verts:
            v.co += v.normal * off
        if name in ('Cloth_Top', 'Cloth_Bottom'):
            # fabric drapes: morphological open then close of the front surface removes small bumps and fills creases
            import numpy as np
            from scipy.spatial import cKDTree
            bm.normal_update()
            zlo = J['pelvis'].z - 0.12 if name == 'Cloth_Bottom' else -1e9
            front = [v for v in bm.verts if v.normal.y < -0.35 and v.co.z > zlo]
            if front:
                P = np.array([(v.co.x, v.co.z) for v in front]); Y = np.array([v.co.y for v in front])
                T = cKDTree(P)
                def morph(Y, r, f):
                    return np.array([f(Y[idx]) for idx in T.query_ball_point(P, r)])
                ro, rc = (0.055, 0.08) if name == 'Cloth_Top' else (0.03, 0.06)
                Y2 = morph(morph(Y, ro, np.max), ro, np.min)      # open: bumps go
                Y3 = morph(morph(Y2, rc, np.min), rc, np.max)     # close: creases fill
                print('[bake] drape', name, len(front), 'moved', float(np.abs(Y3 - Y).mean()), float(np.abs(Y3 - Y).max()))
                for v, y in zip(front, Y3):
                    v.co.y = y
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
        bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        for an in [a.name for a in me.attributes if 'normal' in a.name.lower()]:
            me.attributes.remove(me.attributes[an])
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except Exception as ex:
            pass
        print('[bake] custom normals left', me.has_custom_normals)
        me.shade_smooth()
        for vg in body.vertex_groups:
            ob.vertex_groups.new(name=vg.name)
        mat = bpy.data.materials.new(name); mat.use_nodes = True
        p = mat.node_tree.nodes['Principled BSDF']; p.inputs['Base Color'].default_value = (*col, 1); p.inputs['Roughness'].default_value = 0.85
        me.materials.clear(); me.materials.append(mat)
        out.append(ob)
        print('[bake] garment', name, len(me.polygons))
    # the skin under the clothes goes, so nothing pokes through when limbs bend
    bm = bmesh.new(); bm.from_mesh(body.data)
    gone = [f for f in bm.faces if all(region(v.co) is not None for v in f.verts)]
    bmesh.ops.delete(bm, geom=gone, context='FACES'); bm.to_mesh(body.data); bm.free()
    return out


def fix_cross_weights(meshes):
    """Some sources were auto-weighted with the hands resting on the thighs, so hip skin follows the thumbs.
    Where a vertex mixes hand/forearm bones with torso/leg bones, keep only the side carrying more weight."""
    import re
    D = re.compile(r'(Forearm|Hand|Thumb|Index|Mid|Ring|Pinky|lowerarm|hand_|thumb|index|middle|ring|pinky)', re.I)
    B = re.compile(r'(Thigh|Calf|Foot|Toe|Knee|Pelvis|Hip|Waist|Spine|thigh|calf|foot|ball|pelvis|spine)', re.I)
    fixed = 0
    for m in meshes:
        cls = {vg.index: ('D' if D.search(vg.name) else 'B' if B.search(vg.name) else None) for vg in m.vertex_groups}
        for v in m.data.vertices:
            sd = sum(g.weight for g in v.groups if cls.get(g.group) == 'D'); sb = sum(g.weight for g in v.groups if cls.get(g.group) == 'B')
            if sd > 0.001 and sb > 0.001:
                lose = 'D' if sb >= sd else 'B'
                for g in v.groups:
                    if cls.get(g.group) == lose:
                        g.weight = 0.0
                fixed += 1
    print('[bake] cross-weight fixes', fixed)


def fix_cross_geo(arm, meshes):
    """Geometric version: decide per vertex whether it is hand/forearm or hip/leg by radius-normalised distance
    to the bone segments, then drop the other side's weights (or give it the nearest bone of its side)."""
    import re, numpy as np
    from mathutils import Vector
    W = arm.matrix_world
    bones = {b.name: b for b in arm.data.bones}
    def head(n): return np.array(W @ bones[n].head_local)
    def kid(b):
        for c in b.children:
            if 'scaleCompensation' in c.name:
                for cc in c.children:
                    if not re.search('Twist|Share', cc.name): return cc
            elif not re.search('Twist|Share', c.name): return c
        return None
    segs = []  # (bone, cls, a, b, r)
    rules = [(r'^[LR]_Forearm_\d+$', 'D', 0.04), (r'^[LR]_Hand_\d+$', 'D', 0.03), (r'^[LR]_(Thumb|Index|Mid|Ring|Pinky)[123]_\d+$', 'D', 0.012),
             (r'^[LR]_Thigh_\d+$', 'B', 0.085), (r'^[LR]_Calf_\d+$', 'B', 0.055), (r'^[LR]_Foot_\d+$', 'B', 0.04),
             (r'^(Pelvis|Waist|Spine01)_\d+$', 'B', 0.14)]
    for n, b in bones.items():
        for rx, cl, r in rules:
            if re.match(rx, n):
                k = kid(b); a = head(n)
                e = head(k.name) if k else a + (a - head(b.parent.parent.name if b.parent and 'scale' in b.parent.name else b.parent.name)) * 0.8
                segs.append((n, cl, a, e, r))
    def segd(P, a, e):
        ab = e - a; t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
        return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
    fixed = 0
    for m in meshes:
        co = np.array([tuple(m.matrix_world @ v.co) for v in m.data.vertices])
        dD = np.full(len(co), 1e9); dB = np.full(len(co), 1e9); nD = [None] * len(co); nB = [None] * len(co)
        bestD = np.full(len(co), -1); bestB = np.full(len(co), -1)
        for i, (n, cl, a, e, r) in enumerate(segs):
            d = segd(co, a, e) / r
            if cl == 'D':
                upd = d < dD; dD[upd] = d[upd]; bestD[upd] = i
            else:
                upd = d < dB; dB[upd] = d[upd]; bestB[upd] = i
        D = re.compile(r'(Forearm|Hand|Thumb|Index|Mid|Ring|Pinky)'); B = re.compile(r'(Thigh|Calf|Foot|Toe|Knee|Pelvis|Hip|Waist|Spine01)')
        cls = {vg.index: ('D' if D.search(vg.name) else 'B' if B.search(vg.name) else None) for vg in m.vertex_groups}
        for v in m.data.vertices:
            i = v.index
            if dD[i] > 3 or dB[i] > 3:
                continue
            want = 'D' if dD[i] < dB[i] else 'B'
            has = {cls.get(g.group) for g in v.groups if g.weight > 0.001}
            if ('D' in has and 'B' in has) or (has and want not in has and ({'D', 'B'} & has)):
                for g in v.groups:
                    if cls.get(g.group) in ('D', 'B') and cls.get(g.group) != want:
                        g.weight = 0.0
                if not any(g.weight > 0.001 for g in v.groups):
                    bn = segs[bestD[i] if want == 'D' else bestB[i]][0]
                    vg = m.vertex_groups.get(bn) or m.vertex_groups.new(name=bn)
                    vg.add([i], 1.0, 'REPLACE')
                fixed += 1
    print('[bake] geo cross fixes', fixed, 'segs', len(segs))


def borrow_weights(proxy, meshes, J0, targets, donor=CH + '751e15ce-girl.blend'):
    """Replace broken skin weights with a well-weighted donor body posed into the same stance."""
    import bpy, sys
    sys.path.insert(0, '/home/claude/hl/charbake')
    import bake as B
    new = B.import_any(donor)
    g_arm = next(o for o in new if o.type == 'ARMATURE')
    g_mesh = next(o for o in new if o.type == 'MESH' and any(md.type == 'ARMATURE' for md in o.modifiers))
    for o in new:
        if o not in (g_arm, g_mesh):
            bpy.data.objects.remove(o, do_unlink=True)
    g_arm.data.bones['head'].name = 'Head'
    names = {b.name for b in g_arm.data.bones}
    jm = {u: (s if s != 'head' else 'Head') for u, s in ue_map(names | {'head'}).items()}
    jm = {u: s for u, s in jm.items() if s in names}
    B.remap_groups(g_mesh, B.weight_map(g_arm, jm, {}))
    # scale and place the donor on our pelvis, then pose it into our stance
    bpy.context.view_layer.update()
    gp = g_arm.matrix_world @ g_arm.data.bones['pelvis'].head_local
    k = J0['pelvis'].z / gp.z if abs(gp.z) > 1e-6 else 1.0
    g_arm.scale = g_arm.scale * k
    bpy.context.view_layer.update()
    gp = g_arm.matrix_world @ g_arm.data.bones['pelvis'].head_local
    g_arm.location = g_arm.location + (J0['pelvis'] - gp)
    bpy.context.view_layer.update()
    B.pose_to_ual(g_arm, {u: u for u in J0 if u in names or u == 'Head'}, J0)
    bpy.context.view_layer.update()
    import bmesh, re
    ARM = re.compile(r'^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_')
    def arm_frac(obj):
        isarm = {vg.index: bool(ARM.match(vg.name)) for vg in obj.vertex_groups}
        out = []
        for v in obj.data.vertices:
            t = sum(g.weight for g in v.groups); a = sum(g.weight for g in v.groups if isarm.get(g.group))
            out.append(a / t if t > 0 else 0.0)
        return out
    # donors split into arm and body halves so a hand resting on a hip cannot hand its weights across
    ga = arm_frac(g_mesh)
    donors = {}
    for part in ('arm', 'body'):
        d = g_mesh.copy(); d.data = g_mesh.data.copy(); bpy.context.scene.collection.objects.link(d)
        bm = bmesh.new(); bm.from_mesh(d.data)
        kill = [f for f in bm.faces if (sum(ga[v.index] for v in f.verts) / len(f.verts) > 0.5) != (part == 'arm')]
        bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(d.data); bm.free()
        donors[part] = d
    bpy.context.view_layer.update()
    for m in meshes:
        if m.name not in targets:
            continue
        fa = graph_classes(m, arm_frac(m))
        names0 = {vg.index: vg.name for vg in m.vertex_groups}
        orig = [[(names0[g.group], g.weight) for g in v.groups] for v in m.data.vertices]
        m.vertex_groups.clear()
        for vg in g_mesh.vertex_groups:
            m.vertex_groups.new(name=vg.name)
        for part in ('body',):
            mk = m.vertex_groups.new(name='_mask_' + part)
            mk.add([i for i, f in enumerate(fa) if (f > 0.5) == (part == 'arm')], 1.0, 'REPLACE')
            mod = m.modifiers.new('xfer', 'DATA_TRANSFER')
            mod.object = donors[part]; mod.use_vert_data = True; mod.data_types_verts = {'VGROUP_WEIGHTS'}
            mod.vert_mapping = 'POLYINTERP_NEAREST'; mod.layers_vgroup_select_src = 'ALL'; mod.layers_vgroup_select_dst = 'NAME'
            mod.vertex_group = mk.name
            bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = m; m.select_set(True)
            bpy.ops.object.modifier_move_to_index(modifier='xfer', index=0)
            bpy.ops.object.modifier_apply(modifier='xfer')
        m.vertex_groups.remove(m.vertex_groups['_mask_body'])
        # arm-side vertices keep their own (good) arm weights, minus anything below the chest
        KEEP = re.compile(r'^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_|^spine_03$|^neck_01$')
        for i, f in enumerate(fa):
            if f <= 0.5:
                continue
            ws = [(n, w) for n, w in orig[i] if KEEP.match(n) and w > 1e-4]
            s = sum(w for _, w in ws) or 1.0
            for vg in m.vertex_groups:
                vg.remove([i])
            for n, w in ws:
                (m.vertex_groups.get(n) or m.vertex_groups.new(name=n)).add([i], w / s, 'REPLACE')
        print('[bake] borrowed weights onto', m.name, len(m.vertex_groups), 'arm verts', sum(1 for f in fa if f > 0.5))
    for d in donors.values():
        bpy.data.objects.remove(d, do_unlink=True)
    bpy.data.objects.remove(g_mesh, do_unlink=True); bpy.data.objects.remove(g_arm, do_unlink=True)


def graph_classes(m, fa):
    """Arm or body per vertex by surface distance from confident seeds, so a palm lying on a hip
    still counts as arm (it connects to the body only through the shoulder)."""
    import numpy as np
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    n = len(m.data.vertices)
    co = np.empty(n * 3, dtype=np.float64); m.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    e = np.empty(len(m.data.edges) * 2, dtype=np.int64); m.data.edges.foreach_get('vertices', e); e = e.reshape(-1, 2)
    w = np.linalg.norm(co[e[:, 0]] - co[e[:, 1]], axis=1) + 1e-6
    G = coo_matrix((np.r_[w, w], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
    fa = np.array(fa)
    zs = co[:, 2]; h = zs.max() - zs.min()
    arm_seed = np.where((fa > 0.97) & (zs > zs.min() + 0.62 * h))[0]  # upper arms, safely above any hip
    body_seed = np.where((fa < 0.03))[0]
    da = dijkstra(G, indices=arm_seed, min_only=True) if len(arm_seed) else np.full(n, np.inf)
    db = dijkstra(G, indices=body_seed, min_only=True) if len(body_seed) else np.full(n, np.inf)
    # confident vertices keep their own class; the contested ones go to whichever seed set is nearer along the skin
    out = np.where(fa > 0.97, 1.0, np.where(fa < 0.03, 0.0, (da < db).astype(float)))
    # a confident-arm vertex that the skin says is body (thigh skin weighted to a thumb) flips back
    out = np.where((fa > 0.97) & (db + 1e-9 < da * 0.25), 0.0, out)
    print('[bake] graph classes: arm', int(out.sum()), 'contested', int(((fa >= 0.03) & (fa <= 0.97)).sum()))
    return list(out)
