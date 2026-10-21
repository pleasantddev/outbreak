import json, struct, sys
def load(p):
    b = open(p,'rb').read(); n = struct.unpack('<I', b[12:16])[0]; return json.loads(b[20:20+n])
def nodes(p):
    j = load(p); return {n.get('name'): n for n in j['nodes']}
