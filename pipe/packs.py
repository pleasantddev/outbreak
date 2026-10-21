# Bundles region files into 4 km packs and texture sets into one file per map, so the artifact ships ~100 files.
import os, json, struct, glob, collections
W = '/home/claude/hl/v2/public/world'
man = json.load(open(f'{W}/manifest.json'))
groups = collections.defaultdict(list)
for k, meta in man['regions'].items():
    i, j = map(int, k.split(','))
    groups[(i // 2, j // 2)].append((i, j, meta))
for f in glob.glob(f'{W}/p*_*.wasm'): os.remove(f)
for (I, J), items in groups.items():
    blobs = [(i, j, open(f"{W}/{m['f']}", 'rb').read()) for i, j, m in items]
    head = b'HLP1' + struct.pack('<H', len(blobs)); off = 4 + 2 + len(blobs) * 12
    body = b''
    for i, j, b in blobs:
        head += struct.pack('<hhII', i, j, off + len(body), len(b)); body += b
    fn = f'p{I}_{J}.wasm'; open(f'{W}/{fn}', 'wb').write(head + body)
    for i, j, b in blobs:
        e = man['regions'][f'{i},{j}']; e['pack'] = fn
for f in glob.glob(f'{W}/r*_*.wasm'): os.remove(f)
json.dump(man, open(f'{W}/manifest.json', 'w'))
print('packs', len(groups))
T = '/home/claude/hl/v2/public/tex'
for grp in ('g', 'w'):
    for m in ('diff', 'nor', 'arm'):
        for sz in (1024, 512):
            files = [f'{T}/{grp}{k}_{m}_{sz}.webp' for k in range(8)]
            data = [open(f, 'rb').read() for f in files]
            head = b'HLT1' + struct.pack('<H', len(data)); off = 6 + len(data) * 8; body = b''
            for d in data: head += struct.pack('<II', off + len(body), len(d)); body += d
            open(f'{T}/{grp}_{m}_{sz}.wasm', 'wb').write(head + body)
for f in glob.glob(f'{T}/*.webp'):
    if not os.path.basename(f).startswith('g0_'): os.remove(f)
print('tex', sorted(os.listdir(T)))
