import { useMemo, useState } from 'preact/hooks';
import { go, useCan } from '../session';
import { Badge, Btn, ErrorBox, Field, Icon, Loading, Modal, Seg, Tabs, confirm, toast } from '../ui';
import { IssueList, JsonEditor, SaveBar, useContent, type Content } from '../editors/shared';
import { ObjectForm, invalidateRefs } from '../editors/FormEditor';
import { blank, schemaFor } from '../editors/schema';
import { MissionGraph } from '../editors/MissionGraph';
import { SkillTree } from '../editors/SkillTree';
import { RouteEditor } from '../editors/RouteEditor';
import { PlaceEditor } from '../editors/PlaceEditor';

const LABEL: Record<string, [string, string]> = { missions: ['Missions', 'Story and side jobs. Each mission is a graph of steps.'], events: ['Events', 'Things that happen in the city: weather, checkpoints, strikes, crowds.'], routes: ['Routes', 'Bus, okada and delivery lines drawn on the real road network.'], skills: ['Skills', 'Skill trees, ranks and skill modes.'], npcs: ['NPCs and factions', 'Archetypes, named characters and the territories factions hold.'], shops: ['Shops', 'What each shop sells and where it stands.'] };
export const titleOf = (it: any) => it?.title ?? it?.name ?? it?.label ?? it?.id ?? '';
const groupKey = (items: any[]) => ['type', 'tree', 'kind', 'category'].find((k) => items.some((i) => typeof i[k] === 'string'));

export function ContentPage({ kind, id }: { kind: string; id?: string }) {
  const can = useCan(); const c = useContent(kind); const edit = can('content.edit');
  const [q, setQ] = useState(''); const [grp, setGrp] = useState('all'); const [mode, setMode] = useState('form'); const [dlg, setDlg] = useState<null | 'new'>(null); const [view, setView] = useState('tree');
  const items = c.doc?.items ?? []; const gk = useMemo(() => groupKey(items), [items.length]); const groups = gk ? ['all', ...Array.from(new Set(items.map((i) => i[gk]).filter(Boolean)))] : [];
  const fields = useMemo(() => schemaFor(kind, items), [kind, items.length === 0, c.doc && c.doc.items[0] ? Object.keys(c.doc.items[0]).join() : '']);
  if (c.loading && !c.doc) return <Loading />; if (!c.doc) return <ErrorBox e={c.error} retry={c.reload} />;
  const cur = items.find((i) => i.id === id); const idx = cur ? items.indexOf(cur) : -1; const meta = LABEL[kind] ?? [kind, ''];
  const list = items.filter((i) => (grp === 'all' || !gk || i[gk] === grp) && (!q || (i.id + ' ' + titleOf(i)).toLowerCase().includes(q.toLowerCase())));
  const issuesFor = (i: number) => c.issues.filter((x) => x.path.startsWith(`items[${i}]`));
  const pick = (i: any) => go(`content/${kind}/${encodeURIComponent(i.id)}`);
  const dup = () => { if (!cur) return; let n = 2; while (items.some((x) => x.id === cur.id + '-copy' + n)) n++; const d = structuredClone(cur); d.id = cur.id + '-copy' + n; if (d.title) d.title += ' (copy)'; else if (d.name) d.name += ' (copy)'; c.add(d); toast('Duplicated as ' + d.id); pick(d); };
  const del = async () => {
    if (!cur) return; const refs = items.filter((o) => o.id !== cur.id && JSON.stringify(o).includes(`"${cur.id}"`));
    if (!(await confirm({ title: `Delete ${titleOf(cur)}?`, danger: true, ok: 'Delete', body: <div class="col"><div>Removed when you save. Version history keeps a copy.</div>{refs.length > 0 && <div class="callout warn">Still mentioned by {refs.length} other {kind} entr{refs.length > 1 ? 'ies' : 'y'}: {refs.slice(0, 6).map((r) => r.id).join(', ')}{refs.length > 6 ? '...' : ''}</div>}</div> }))) return;
    c.remove(cur.id); go(`content/${kind}`); invalidateRefs(kind);
  };
  const apply = (nv: any) => c.update(cur.id, () => nv);
  const tabs: [string, string][] = [['form', 'Form']]; if (kind === 'missions') tabs.push(['graph', 'Step graph']); if (kind === 'routes') tabs.push(['map', 'Route on map']); if (kind === 'npcs' || kind === 'shops' || kind === 'events') tabs.push(['place', 'Place on map']); tabs.push(['json', 'JSON']);
  const m = tabs.some(([k]) => k === mode) ? mode : 'form';
  return (
    <>
      <div class="pageh" style="margin-bottom:12px"><div><h1>{meta[0]}</h1><div class="sub">{meta[1]} {items.length} entries.</div></div><div class="grow" />
        {kind === 'skills' && <Seg cur={view} on={setView} opts={[['tree', 'Tree view'], ['list', 'List view']]} />}
        {edit && <Btn kind="pri" icon="plus" onClick={() => setDlg('new')}>New {kind === 'npcs' ? 'NPC or faction' : kind.replace(/s$/, '')}</Btn>}</div>
      {kind === 'skills' && view === 'tree' ? (
        <div style="flex:1;min-height:0;display:flex;flex-direction:column"><SkillTree c={c} edit={edit} fields={fields} sel={id} onSel={(i) => go(`content/${kind}/${encodeURIComponent(i)}`)} /><SaveBar c={c} /></div>
      ) : (<>
        <div class="split" style="flex:1;min-height:0">
          <div class="panel col" style="gap:0;min-height:0;overflow:hidden">
            <div style="padding:10px;border-bottom:1px solid var(--line)" class="col gap-sm"><input class="input" placeholder={`Search ${kind}`} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />{groups.length > 2 && <div class="row wrap gap-sm">{groups.map((g) => <button key={g} class={'btn sm ' + (grp === g ? 'pri' : 'ghost')} onClick={() => setGrp(g)}>{g}</button>)}</div>}</div>
            <div class="list grow">{list.map((i) => { const k = items.indexOf(i); const es = issuesFor(k).filter((x) => x.level === 'error').length; return (<div key={i.id} class={'item ' + (i.id === id ? 'on' : '')} onClick={() => pick(i)}><div class="row"><span class="t grow">{titleOf(i)}</span>{es > 0 && <Badge kind="bad">{es}</Badge>}{gk && i[gk] && <span class="dim" style="font-size:11px">{String(i[gk])}</span>}</div><span class="s">{i.id}</span></div>); })}{!list.length && <div class="empty">Nothing here</div>}</div>
          </div>
          <div style="min-height:0;overflow:auto;display:flex;flex-direction:column;gap:14px;padding-right:4px">
            {!cur ? <div class="empty panel" style="padding:80px 20px">Pick an entry on the left{edit ? ', or create a new one.' : '.'}</div> : (<>
              <div class="row wrap"><div class="grow"><h2 style="font-size:20px">{titleOf(cur)}</h2><div class="mono dim">{cur.id}</div></div>{edit && <><Btn kind="sm" icon="dup" onClick={dup}>Duplicate</Btn><Btn kind="sm danger" icon="trash" onClick={del}>Delete</Btn></>}</div>
              <Tabs cur={m} on={setMode} tabs={tabs} />
              <IssueList issues={issuesFor(idx).map((x) => ({ ...x, path: x.path.replace(`items[${idx}]`, '') || 'item' }))} />
              {m === 'form' && <div class="panel" style="padding:18px"><ObjectForm fields={fields} value={cur} onChange={apply} issues={issuesFor(idx).map((x) => ({ ...x, path: x.path.replace(`items[${idx}].`, '').replace(`items[${idx}]`, '') }))} disabled={!edit} ownKind={kind} /></div>}
              {m === 'graph' && <MissionGraph c={c} mission={cur} edit={edit} onChange={apply} issues={issuesFor(idx)} />}
              {m === 'map' && <RouteEditor route={cur} edit={edit} onChange={apply} />}
              {m === 'place' && <PlaceEditor item={cur} kind={kind} edit={edit} onChange={apply} />}
              {m === 'json' && <JsonEditor value={cur} onApply={(v) => { if (v && typeof v === 'object' && !Array.isArray(v)) { if (v.id !== cur.id) { toast('Change the id with care: references to the old id will break', 'bad'); } c.update(cur.id, () => v); if (v.id !== cur.id) go(`content/${kind}/${encodeURIComponent(v.id)}`); } }} />}
            </>)}
          </div>
        </div>
        {edit ? <SaveBar c={c} /> : <div class="callout" style="margin-top:12px">Your role can view but not edit game content.</div>}
        <IssueList issues={c.issues.filter((x) => !/^items\[\d+\]/.test(x.path))} /></>)}
      {dlg === 'new' && <NewItem c={c} kind={kind} fields={fields} onClose={() => setDlg(null)} onMake={(it) => { c.add(it); setDlg(null); pick(it); setMode('form'); }} />}
    </>
  );
}

function NewItem({ c, kind, fields, onClose, onMake }: { c: Content; kind: string; fields: ReturnType<typeof schemaFor>; onClose: () => void; onMake: (it: any) => void }) {
  const prefix = { missions: 'm.', events: 'ev.', routes: 'route.', skills: 'skill.', npcs: 'npc.', shops: 'shop.' }[kind] ?? ''; const [id, setId] = useState(prefix); const [name, setName] = useState('');
  const ids = new Set(c.doc!.items.map((i) => i.id)); const err = id === prefix ? null : ids.has(id) ? 'That id is taken' : !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) ? 'Letters, digits and . _ : -' : null;
  const make = () => { const b = blank(fields); b.id = id; const nk = 'title' in b ? 'title' : 'name' in b ? 'name' : 'label' in b ? 'label' : null; if (nk) b[nk] = name; else b.name = name; if (kind === 'missions' && !b.steps) { b.entry = 's1'; b.steps = [{ id: 's1', type: 'talk', text: 'First step', next: 'end' }, { id: 'end', type: 'complete', text: 'Done' }]; } if (kind === 'routes' && !b.points) b.points = []; onMake(b); };
  return <Modal title={`New ${kind.replace(/s$/, '')}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="pri" disabled={!name || id === prefix || !!err} onClick={make}>Create</Btn></>}><Field label="Name"><input class="input" value={name} autofocus onInput={(e) => { const v = (e.target as HTMLInputElement).value; setName(v); if (id === prefix || id === prefix + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) setId(prefix + v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')); }} /></Field><Field label="Id" err={err} help="Stable. Other entries and player saves refer to it, so do not rename it later."><input class="input mono" value={id} onInput={(e) => setId((e.target as HTMLInputElement).value)} /></Field></Modal>;
}
void Icon;
