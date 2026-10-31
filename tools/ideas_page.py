"""Build docs/ideas.html (the founder's ideas board) from docs/IDEAS.md and the brief 3 checklist in docs/BACKLOG.md."""
import re, html, pathlib, datetime
root = pathlib.Path(__file__).resolve().parent.parent
md = (root / 'docs/IDEAS.md').read_text()
bl = (root / 'docs/BACKLOG.md').read_text()
sections, cur = [], None
for line in md.splitlines():
    if line.startswith('## '):
        cur = {'name': line[3:].strip(), 'items': [], 'bullets': []}; sections.append(cur); continue
    m = re.match(r'^(\d+)\.\s+\*\*(.+?)\*\*\s*(.*)$', line)
    if m and cur is not None:
        body = m.group(3); why = ''; size = ''; status = 'idea'
        w = re.search(r'Why:\s*(.+?)(?:\s+Size\s+([SML])\.)', body)
        s = re.search(r'Size\s+([SML])\.', body); st = re.search(r'Status:\s*([a-z ]+)\.?\s*$', body)
        pitch = body.split(' Why:')[0].strip()
        if w: why = w.group(1).strip()
        if s: size = s.group(1)
        if st: status = st.group(1).strip()
        cur['items'].append({'n': m.group(1), 'title': m.group(2).rstrip('.'), 'pitch': pitch, 'why': why, 'size': size, 'status': status}); continue
    if line.startswith('- ') and cur is not None: cur['bullets'].append(line[2:].strip())
# brief 3 checklist: lanes and items
b3 = bl.split('## Founder brief 3', 1)[1].split('## Earlier backlog', 1)[0] if '## Founder brief 3' in bl else ''
lanes, lane = [], None
for line in b3.splitlines():
    if line.startswith('### '): lane = {'name': line[4:].split('(')[0].strip(), 'items': []}; lanes.append(lane); continue
    m = re.match(r'^- \[( |x)\]\s+(.*)$', line)
    if m and lane is not None: lane['items'].append({'done': m.group(1) == 'x', 'text': m.group(2)}); continue
    if lane and lane['items'] and line.startswith('      '): lane['items'][-1]['text'] += ' ' + line.strip()
LANE_NAME = {'LEAD': 'Lead engineer', 'SPORTS': 'Sports and property', 'IDEAS': 'Ideas and Oshodi'}
e = html.escape
def card(it):
    st = it['status'].lower(); size = {'S': 'Small', 'M': 'Medium', 'L': 'Large'}.get(it['size'], '')
    return f'''<article class="idea" data-status="{e(st)}"><header><span class="no">{e(it['n'])}</span><h3>{e(it['title'])}</h3></header>
<p class="pitch">{e(it['pitch'])}</p>{f'<p class="why"><b>Why it fits</b> {e(it["why"])}</p>' if it['why'] else ''}
<footer><span class="pill st-{e(st.replace(" ", "-"))}">{e(st)}</span>{f'<span class="size">{size} build</span>' if size else ''}</footer></article>'''
idea_secs = [s for s in sections if s['items']]
counts = {}
for s in idea_secs:
    for it in s['items']: counts[it['status']] = counts.get(it['status'], 0) + 1
total = sum(len(s['items']) for s in idea_secs)
next_up = next((s['bullets'] for s in sections if s['bullets']), [])
def short(t):
    t = re.sub(r'\s*\(in progress[^)]*\)', '', t); t = re.sub(r'\s+', ' ', t)
    head = t.split(':')[0] if ':' in t[:60] else t.split('.')[0]
    return head.strip()
lane_html = ''.join(f'''<section class="lane"><h3>{e(LANE_NAME.get(l['name'], l['name'].title()))}</h3><ul>{''.join(f'<li class="{"done" if i["done"] else ""}"><span class="tick" aria-hidden="true"></span><span>{e(short(i["text"]))}</span></li>' for i in l['items'])}</ul></section>''' for l in lanes)
built = sum(1 for l in lanes for i in l['items'] if i['done']); allb = sum(len(l['items']) for l in lanes)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%d %b %Y, %H:%M UTC')
page = f'''<title>HustleLife Ideas Board</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap">
<style>
/* Layout: a danfo-yellow masthead band, the build checklist as three lanes, then idea cards in section groups. */
:root {{
  --bg: #f6f4ee; --ink: #16180f; --mut: #5f6253; --line: #dedbcd; --card: #fffdf7;
  --danfo: #f2b705; --danfo-ink: #1b1600; --leaf: #1f7a4d; --brick: #b4441c; --night: #1d2a24;
  --display: "Bricolage Grotesque", "Arial Narrow", system-ui, sans-serif; --body: "Public Sans", system-ui, -apple-system, sans-serif; --mono: "JetBrains Mono", ui-monospace, monospace;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg: #121410; --ink: #eceadf; --mut: #a5a796; --line: #2c2f26; --card: #1a1d17; --danfo: #f2b705; --danfo-ink: #1b1600; --leaf: #4fbf86; --brick: #e2774e; --night: #0d120f; color-scheme: dark }} }}
:root[data-theme="dark"] {{ --bg: #121410; --ink: #eceadf; --mut: #a5a796; --line: #2c2f26; --card: #1a1d17; --danfo: #f2b705; --danfo-ink: #1b1600; --leaf: #4fbf86; --brick: #e2774e; --night: #0d120f; color-scheme: dark }}
* {{ box-sizing: border-box }}
body {{ background: var(--bg); color: var(--ink); font: 400 15px/1.55 var(--body); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 0 48px }}
.wrap {{ max-width: 1120px; margin: 0 auto }}
.mast {{ margin: 0 calc(-1 * max(16px, env(safe-area-inset-left, 0px))); padding: 34px max(16px, env(safe-area-inset-left, 0px)) 26px; background: var(--danfo); color: var(--danfo-ink); background-image: repeating-linear-gradient(90deg, transparent 0 46px, rgba(0,0,0,.07) 46px 50px) }}
.mast .wrap {{ display: grid; gap: 10px }}
.kicker {{ font: 500 12px var(--mono); letter-spacing: .12em; text-transform: uppercase }}
h1 {{ font: 800 clamp(34px, 6vw, 62px)/0.95 var(--display); margin: 0; letter-spacing: -.01em; text-wrap: balance }}
.mast p {{ margin: 0; max-width: 62ch; font-weight: 500 }}
.stats {{ display: flex; flex-wrap: wrap; gap: 8px 18px; font: 500 12.5px var(--mono); margin-top: 6px }}
h2 {{ font: 800 24px/1.1 var(--display); margin: 34px 0 12px; text-wrap: balance }}
.lanes {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px }}
.lane {{ background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; min-width: 0 }}
.lane h3 {{ margin: 0 0 8px; font: 700 13px var(--body); text-transform: uppercase; letter-spacing: .08em; color: var(--mut) }}
.lane ul {{ list-style: none; margin: 0; padding: 0; display: grid; gap: 7px }}
.lane li {{ display: grid; grid-template-columns: 16px 1fr; gap: 8px; align-items: start; font-size: 14px }}
.tick {{ width: 14px; height: 14px; margin-top: 4px; border-radius: 4px; border: 2px solid var(--line) }}
.lane li.done .tick {{ background: var(--leaf); border-color: var(--leaf) }} .lane li.done span:last-child {{ color: var(--mut); text-decoration: line-through; text-decoration-color: var(--line) }}
.filters {{ display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 4px }}
.filters button {{ font: 600 13px var(--body); padding: 7px 13px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer }}
.filters button[aria-pressed="true"] {{ background: var(--night); color: #fff; border-color: var(--night) }}
.filters button:focus-visible, .idea:focus-visible {{ outline: 3px solid var(--danfo); outline-offset: 2px }}
.group h2 {{ display: flex; align-items: baseline; gap: 10px }} .group h2 small {{ font: 500 12px var(--mono); color: var(--mut) }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px }}
.idea {{ background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; display: grid; gap: 8px; align-content: start; min-width: 0 }}
.idea header {{ display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: baseline }}
.idea .no {{ font: 500 12px var(--mono); color: var(--brick) }}
.idea h3 {{ margin: 0; font: 700 17px/1.25 var(--display); text-wrap: balance }}
.idea p {{ margin: 0 }} .pitch {{ font-size: 14.5px }} .why {{ font-size: 13.5px; color: var(--mut) }} .why b {{ color: var(--ink); font-weight: 600 }}
.idea footer {{ display: flex; gap: 8px; align-items: center; margin-top: 2px }}
.pill {{ font: 600 11.5px var(--body); text-transform: uppercase; letter-spacing: .06em; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--mut) }}
.pill.st-building {{ border-color: var(--danfo); color: var(--ink); background: color-mix(in srgb, var(--danfo) 22%, transparent) }}
.pill.st-shipped {{ border-color: var(--leaf); color: var(--leaf) }}
.size {{ font: 500 12px var(--mono); color: var(--mut) }}
.next {{ background: var(--night); color: #eef0e6; border-radius: 12px; padding: 16px 18px; display: grid; gap: 6px }} .next h3 {{ margin: 0; font: 700 15px var(--display); color: var(--danfo) }} .next ul {{ margin: 0; padding-left: 18px }}
.foot {{ margin-top: 34px; color: var(--mut); font-size: 12.5px }}
@media (prefers-reduced-motion: no-preference) {{ .idea {{ transition: transform .15s }} .idea:hover {{ transform: translateY(-2px) }} }}
</style>
<div class="mast"><div class="wrap">
<span class="kicker">HustleLife · Lagos · founder's board</span>
<h1>HustleLife Ideas Board</h1>
<p>New ideas from the team in the spirit of your briefs, and what is being built right now. The ideas teammate keeps adding to it; ideas move to building and shipped as they land.</p>
<div class="stats"><span>{total} ideas</span><span>{counts.get("building", 0)} building</span><span>{counts.get("shipped", 0)} shipped</span><span>Brief 3: {built} of {allb} done</span><span>Updated {stamp}</span></div>
</div></div>
<div class="wrap">
<h2>Being built from your 31 October brief</h2>
<div class="lanes">{lane_html}</div>
{f'<h2>The ideas teammate is on</h2><div class="next"><ul>{"".join(f"<li>{e(b)}</li>" for b in next_up)}</ul></div>' if next_up else ''}
<h2>Ideas</h2>
<div class="filters" role="group" aria-label="Filter ideas by status">
<button type="button" data-f="all" aria-pressed="true">All</button><button type="button" data-f="idea" aria-pressed="false">Ideas</button><button type="button" data-f="building" aria-pressed="false">Building</button><button type="button" data-f="shipped" aria-pressed="false">Shipped</button>
</div>
{"".join(f'<section class="group"><h2>{e(s["name"])} <small>{len(s["items"])}</small></h2><div class="grid">{"".join(card(it) for it in s["items"])}</div></section>' for s in idea_secs)}
<p class="foot">Rules every idea respects: 16+, no nudity, no real brand logos, parody names for real places and clubs, crime is satire and never a how-to, and music only where we have the right to play it.</p>
</div>
<script>
const bs = document.querySelectorAll('.filters button');
bs.forEach((b) => b.addEventListener('click', () => {{
  bs.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  const f = b.dataset.f; document.querySelectorAll('.idea').forEach((c) => {{ c.hidden = f !== 'all' && c.dataset.status !== f; }});
  document.querySelectorAll('.group').forEach((g) => {{ g.hidden = ![...g.querySelectorAll('.idea')].some((c) => !c.hidden); }});
}}));
</script>
'''
(root / 'docs/ideas.html').write_text(page)
print('ideas', total, 'lanes', len(lanes), 'brief items', allb)
