# Builds the wall texture packs (w_{diff,nor,arm}_{512,1024}.wasm, HLT1 packs of WebP layers) from the Poly Haven CC0 2k set.
# The painted layers are "flattened": the low-frequency colour is divided out so a building's colour comes from its palette, not from
# blotches in the photo, and only the grain, hairline cracks and trowel marks are left (this is what removed the camouflage look).
# usage: python3 pipe/build_walltex.py /home/claude/hlosm/tex v2/public/tex
import sys, io, struct, os
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

src, out = sys.argv[1], sys.argv[2]
# (poly haven id, mode, amount) ; mode: raw keeps the photo, flat divides the low frequencies out per channel, amount = how much of the detail contrast survives
LAYERS = [
    ('painted_plaster_wall', 'flat', 0.55),   # 0 paint
    ('damaged_plaster', 'raw', 0),            # 1 worn paint (peeling to brick, the shader tames it)
    ('plastered_wall_04', 'flat', 0.6),       # 2 plaster
    ('concrete_block_wall', 'flat', 1.0),     # 3 bare sandcrete block (block lines stay)
    ('brick_wall_10', 'raw', 0),              # 4 face brick
    ('dirty_concrete', 'flat', 0.45),         # 5 concrete
    ('corrugated_iron_02', 'raw', 0),         # 6 zinc / aluminium roofing
    ('roof_tiles_14', 'raw', 0),              # 7 clay tiles
    ('rusty_corrugated_iron', 'raw', 0),      # 8 rusted roofing
    ('dirty_tiles', 'raw', 0),                # 9 wall tile cladding
    ('rusted_shutter', 'raw', 0),             # 10 shutters and gates
]

def load(name, m):
    return Image.open(os.path.join(src, f'{name}_{m}_2k.jpg')).convert('RGB')

def flat(im, amount):
    a = np.asarray(im, dtype=np.float32) / 255.0
    sig = a.shape[0] / 7.0
    low = np.stack([gaussian_filter(a[..., c], sig, mode='wrap') for c in range(3)], -1)
    hi = a / np.maximum(low, 0.04)
    hi = 1.0 + (hi - 1.0) * amount
    # keep a little of the original hue so it does not turn plastic, then bring the mean to 0.86 (paint tints multiply this)
    out = np.clip(hi * 0.86, 0, 1)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8))

def pack(images, path, q):
    blobs = []
    for im in images:
        b = io.BytesIO(); im.save(b, 'WEBP', quality=q, method=4); blobs.append(b.getvalue())
    head = 6 + 8 * len(blobs); off = head; table = b''
    for bl in blobs: table += struct.pack('<II', off, len(bl)); off += len(bl)
    with open(path, 'wb') as f: f.write(b'HLT1' + struct.pack('<H', len(blobs)) + table + b''.join(blobs))
    print(path, len(blobs), off // 1024, 'kB')

for size in (512, 1024):
    for m, key, q in (('diff', 'diff', 84), ('nor', 'nor_gl', 88), ('arm', 'arm', 84)):
        ims = []
        for name, mode, amt in LAYERS:
            im = load(name, key)
            if m == 'diff' and mode == 'flat': im = flat(im, amt)
            ims.append(im.resize((size, size), Image.LANCZOS))
        pack(ims, os.path.join(out, f'w_{m}_{size}.wasm'), q)
