# cmp.py labelA labelB : compact before/after table from /tmp/claude-0/probe_<label>_<tier>.json
import json, sys
def load(l, t):
    try: return json.load(open(f'/tmp/claude-0/probe_{l}_{t}.json'))
    except Exception: return {}
labs = sys.argv[1:]
for t in ('low', 'medium', 'high'):
    for pose in ('oshodi', 'dense1', 'dense2'):
        print(f'{t:6} {pose:7}', end='')
        for l in labs:
            d = load(l, t).get(pose)
            if not d: print('  -', end=''); continue
            s, sh = d['scan'], d['scanShadow']
            st = d['stream']; st2 = d['stream2']
            print(f"  | {l}: calls {s['calls']:4} tris {int(s['tris'])//1000:4}k  +shadow {sh['calls']:4}/{int(sh['tris'])//1000}k  cpuR {d['cpuRender']['med']:5.1f} cpuF {d['cpuFrame']['med']:5.1f} kb/f {d['cpuFrame']['kbPerFrame']:5.0f}  stream max {max(st['max'],st2['max']):5.1f} >16:{st['over16']+st2['over16']}", end='')
        print()
