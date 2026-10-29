"""Review screenshots of every admin screen. Run under the shared browser lock:
  flock /tmp/hl-browser.lock timeout 900 python3 admin/tools/shots.py [base_url] [out_dir] [only,names]
Needs the dev stub on :8787 and vite (or the built admin) on the base url."""
import json, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5225/'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/wt/admin/shots_review'
ONLY = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else None
SRV = 'http://localhost:8787'
req = urllib.request.Request(SRV + '/api/admin/auth/login', data=json.dumps({'email': 'owner@hustlelife.dev', 'password': 'hustle-admin-2026'}).encode(), headers={'content-type': 'application/json'})
TOKEN = json.load(urllib.request.urlopen(req))['token']

def api(path):
    r = urllib.request.Request(SRV + '/api/admin' + path, headers={'authorization': 'Bearer ' + TOKEN})
    return json.load(urllib.request.urlopen(r))

def want(n): return ONLY is None or n in ONLY

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page(); logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text[:300]) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERR ' + str(e)[:500]))
    if want('login'):
        pg.goto(BASE); time.sleep(2.5); pg.screenshot(path=f'{OUT}/01-login.png')
    pg.goto(BASE); pg.evaluate("([t,s]) => { localStorage.setItem('hl-admin-token', t); localStorage.setItem('hl-admin-server', s); }", [TOKEN, SRV])

    def shot(name, hash_, wait=2.5, act=None, full=False):
        if not want(name): return
        pg.goto(BASE + hash_.split('#')[0]); pg.evaluate("h => { location.hash = h; }", hash_.split('#')[1] if '#' in hash_ else '/')
        pg.reload(); time.sleep(wait)
        if act: act()
        pg.screenshot(path=f'{OUT}/{name}.png', full_page=full); print('shot', name)

    shot('02-liveops', '#/ops')
    shot('03-map-overview', '#/map', wait=14)
    # parcel inspect: zoom to a sample parcel, click it
    plots = api('/map/plots')['plots']
    owned = [x for x in plots if x['ownerId']]
    tgt = owned[0] if owned else plots[0]
    def parcel_act():
        pg.evaluate("([x,z]) => window.__adminMap.flyTo(x, z, 420)", [tgt['x'], tgt['z']]); time.sleep(10)
        pg.evaluate("([x,z]) => { const m = window.__adminMap; const hit = m.parcelAt(x, z); if (hit) m.onPick(hit); }", [tgt['x'], tgt['z']]); time.sleep(2)
    shot('04-parcel-inspect', '#/map', wait=10, act=parcel_act)
    pls = api('/players?limit=5')
    pid = pls['players'][0]['id'] if 'players' in pls else pls['items'][0]['id']
    shot('05-players', '#/players')
    def ban():
        pg.get_by_text('Ban', exact=False).first.click(); time.sleep(1)
    shot('06-player-ban', f'#/players/{pid}', act=ban)
    shot('07-store', '#/store/items')
    shot('08-economy', '#/economy')
    shot('09-reports', '#/reports')
    shot('10-content-missions', '#/content/missions')
    mis = api('/content/missions')['doc']['items'][0]['id']
    def graph():
        pg.get_by_text('Step graph', exact=False).first.click(); time.sleep(1.5)
    shot('11-mission-graph', f'#/content/missions/{mis}', act=graph)
    shot('12-skill-tree', '#/content/skills?view=tree', wait=3)
    rid = api('/content/routes')['doc']['items'][0]['id']
    def rmap():
        pg.get_by_text('Map', exact=True).first.click(); time.sleep(12)
    shot('13-route-editor', f'#/content/routes/{rid}', act=rmap)
    shot('14-system', '#/system')
    print('\n'.join(logs[:30]))
    b.close()
