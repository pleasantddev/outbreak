#!/usr/bin/env python3
"""Character LOD bake: charlod.py in.glb out.glb [keep]

Writes a geometry-only GLB (no images, no materials' textures) whose meshes, primitives and skin match the source one to one,
with each skinned primitive decimated to about `keep` of its triangles (default 0.2). The game swaps these geometries onto the
same skinned skeleton for characters beyond ~20 m, so vertex attributes (uv, joints, weights) are copied from the nearest source vertex.
Needs: numpy, scipy, fast-simplification.  No Blender required.
"""
import sys, json, struct
import numpy as np
from scipy.spatial import cKDTree
import fast_simplification as fs

CT = {5126: np.float32, 5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5120: np.int8, 5122: np.int16}
NC = {'MAT4': 16, 'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_glb(path):
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack('<I', d[off:off + 4])[0]
    return j, d[off + 8:off + 8 + bl]


def accessor(j, blob, idx):
    a = j['accessors'][idx]
    bv = j['bufferViews'][a['bufferView']]
    dt = CT[a['componentType']]
    n = NC[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride')
    isz = np.dtype(dt).itemsize * n
    if stride and stride != isz:
        raw = np.frombuffer(blob, dtype=np.uint8, count=a['count'] * stride, offset=start).reshape(a['count'], stride)[:, :isz].copy()
        return raw.view(dt).reshape(a['count'], n)
    return np.frombuffer(blob, dtype=dt, count=a['count'] * n, offset=start).reshape(a['count'], n).copy()


def decimate(P, F, keep):
    """P: (n,3) float32 positions (may hold duplicates across uv seams). Returns new positions and faces."""
    q = np.round(P * 1e4).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    W = P[first]
    Fw = inv[F]
    Fw = Fw[(Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])]
    p2, f2 = fs.simplify(W.astype(np.float32), Fw.astype(np.int32), target_reduction=1.0 - keep, agg=6)
    return p2.astype(np.float32), f2.astype(np.int64)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    keep = float(sys.argv[3]) if len(sys.argv) > 3 else 0.2
    j, blob = read_glb(src)
    out = bytearray()
    accs, views = [], []

    def add(arr, ctype, typ, target=None):
        while len(out) % 4:
            out.append(0)
        views.append({'buffer': 0, 'byteOffset': len(out), 'byteLength': arr.nbytes, **({'target': target} if target else {})})
        out.extend(arr.tobytes())
        a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if typ in ('VEC3', 'SCALAR') and ctype == 5126:
            a['min'] = arr.min(axis=0).tolist() if typ == 'VEC3' else [float(arr.min())]
            a['max'] = arr.max(axis=0).tolist() if typ == 'VEC3' else [float(arr.max())]
        accs.append(a)
        return len(accs) - 1

    tris_in = tris_out = 0
    for m in j['meshes']:
        for p in m['primitives']:
            at = p['attributes']
            P = accessor(j, blob, at['POSITION']).astype(np.float32)
            F = accessor(j, blob, p['indices']).reshape(-1, 3).astype(np.int64)
            tris_in += len(F)
            small = len(F) < 220
            if small:
                newP, newF, src_idx = P, F, np.arange(len(P))
            else:
                newP, newF = decimate(P, F, keep)
                src_idx = cKDTree(P).query(newP)[1]
            tris_out += len(newF)
            na = {}
            for name, ai in at.items():
                arr = accessor(j, blob, ai)
                src_a = j['accessors'][ai]
                arr = arr[src_idx]
                if name == 'POSITION':
                    arr = newP if not small else P
                if name == 'NORMAL':
                    # normals from the nearest source vertex are fine for a distant LOD; renormalise
                    n = np.linalg.norm(arr, axis=1, keepdims=True); n[n == 0] = 1; arr = (arr / n).astype(np.float32)
                if name == 'WEIGHTS_0' and src_a['componentType'] == 5126:
                    s = arr.sum(axis=1, keepdims=True); s[s == 0] = 1; arr = (arr / s).astype(np.float32)
                na[name] = add(np.ascontiguousarray(arr), src_a['componentType'], src_a['type'], 34962)
            idx = newF.astype(np.uint16 if len(newP) < 65535 else np.uint32).reshape(-1)
            p['attributes'] = na
            p['indices'] = add(idx.reshape(-1, 1), 5123 if len(newP) < 65535 else 5125, 'SCALAR', 34963)
            p.pop('extensions', None)

    j['accessors'] = accs
    j['bufferViews'] = views
    j['buffers'] = [{'byteLength': len(out)}]
    for k in ('images', 'textures', 'samplers', 'extensionsUsed', 'extensionsRequired', 'animations'):
        j.pop(k, None)
    for mat in j.get('materials', []):
        for k in list(mat.keys()):
            if k not in ('name', 'doubleSided', 'alphaMode', 'alphaCutoff'):
                mat.pop(k)
    for nd in j['nodes']:
        nd.pop('extensions', None)
    # skins reference inverse bind matrices accessors: carry them over
    # (they were dropped with the old accessor table, so rebuild them from the source)
    j0, blob0 = read_glb(src)
    for s in j['skins']:
        ibm = accessor(j0, blob0, s['inverseBindMatrices']).astype(np.float32)
        s['inverseBindMatrices'] = add(ibm, 5126, 'MAT4')
        accs[-1]['type'] = 'MAT4'
    j['accessors'] = accs
    j['bufferViews'] = views
    j['buffers'] = [{'byteLength': len(out)}]

    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    while len(out) % 4:
        out.append(0)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(bytes(out))
    print(f'{src}: {tris_in} -> {tris_out} tris ({100 * tris_out / max(1, tris_in):.0f}%), {len(out) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
