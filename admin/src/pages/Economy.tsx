import { useMemo, useState } from 'preact/hooks';
import { useCan } from '../session';
import { Badge, Btn, Field, Loading, Modal, Panel, Tabs, confirm, fmt } from '../ui';
import { IssueList, JsonEditor, SaveBar, useContent } from '../editors/shared';

const UNIT_FMT = (v: number, unit?: string) => (unit === 'NGN' ? fmt.naira(v) : unit === 'fraction' ? (v * 100).toFixed(2) + '%' : unit === 'x' ? v + 'x' : fmt.n(v) + (unit ? ' ' + unit : ''));

export function Economy() {
  const can = useCan(); const c = useContent('economy'); const [tab, setTab] = useState('table'); const [q, setQ] = useState(''); const [cat, setCat] = useState('all'); const [adding, setAdding] = useState(false);
  const orig = useMemo(() => new Map<string, any>(), []);
  if (c.loading && !c.doc) return <Loading />; if (!c.doc) return <div class="callout bad">{c.error}</div>;
  const items = c.doc.items; const edit = can('economy.edit');
  const cats = ['all', ...Array.from(new Set(items.map((i) => i.category ?? 'other')))];
  const errAt = (i: number) => c.issues.filter((x) => x.path.startsWith(`items[${i}]`));
  const shown = items.map((it, i) => ({ it, i })).filter(({ it }) => (cat === 'all' || (it.category ?? 'other') === cat) && (!q || (it.id + ' ' + (it.label ?? '')).toLowerCase().includes(q.toLowerCase())));
  void orig;
  return (
    <div class="col gap-lg">
      <div class="pageh"><div><h1>Economy</h1><div class="sub">Prices, wages, sinks and rates the game reads from economy.json. Every save is versioned and logged.</div></div><div class="grow" />{edit && <Btn icon="plus" onClick={() => setAdding(true)}>New value</Btn>}</div>
      <Tabs cur={tab} on={setTab} tabs={[['table', 'Values'], ['json', 'JSON']]} />
      {tab === 'table' && (<>
        <div class="row wrap"><input class="input" style="width:260px" placeholder="Filter values" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} /><div class="seg">{cats.map((k) => <button key={k} class={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{k}</button>)}</div></div>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>Value</th><th style="width:220px">Setting</th><th>Unit</th><th>Allowed range</th><th /></tr></thead><tbody>
          {shown.map(({ it, i }) => { const es = errAt(i); const bad = es.some((x) => x.level === 'error'); const isNum = typeof it.value === 'number'; return (
            <tr key={it.id}><td><div style="font-weight:500">{it.label ?? it.id}</div><div class="dim mono" style="font-size:11.5px">{it.id}</div>{it.help && <div class="dim" style="font-size:12px">{it.help}</div>}{es.map((x, k) => <div key={k} style={`font-size:12px;color:var(--${x.level === 'error' ? 'bad' : 'warn'})`}>{x.msg}</div>)}</td>
              <td>{isNum ? <div class="col gap-sm"><input class={'input mono' + (bad ? ' bad' : '')} type="number" step={it.integer ? 1 : 'any'} disabled={!edit} value={it.value} onInput={(e) => { const v = (e.target as HTMLInputElement).value; c.update(it.id, (x) => ({ ...x, value: v === '' ? NaN : Number(v) })); }} /><span class="dim" style="font-size:11.5px">{Number.isFinite(it.value) ? UNIT_FMT(it.value, it.unit) : ''}</span></div>
                : typeof it.value === 'boolean' ? <div class="row"><input type="checkbox" checked={it.value} disabled={!edit} onChange={(e) => c.update(it.id, (x) => ({ ...x, value: (e.target as HTMLInputElement).checked }))} /> {String(it.value)}</div>
                : typeof it.value === 'string' ? <input class="input" value={it.value} disabled={!edit} onInput={(e) => c.update(it.id, (x) => ({ ...x, value: (e.target as HTMLInputElement).value }))} />
                : <span class="dim">complex, edit in the JSON tab</span>}</td>
              <td class="mut">{it.unit ?? ''}</td><td class="mut mono" style="font-size:12px">{it.min !== undefined || it.max !== undefined ? `${it.min ?? '-inf'} to ${it.max ?? 'inf'}` : 'none'}{it.integer && ' | whole numbers'}</td>
              <td class="right">{edit && <Btn kind="ghost sm icon" icon="trash" title="Delete" onClick={async () => { if (await confirm({ title: `Delete ${it.id}?`, danger: true, ok: 'Delete', body: <div>The game falls back to its built-in default if it cannot find this value.</div> })) c.remove(it.id); }} />}</td></tr>); })}
          {!shown.length && <tr><td colSpan={5} class="empty">Nothing matches</td></tr>}</tbody></table></div></>)}
      {tab === 'json' && <JsonEditor value={c.doc} onApply={(v) => c.setDoc(v)} />}
      <IssueList issues={c.issues.filter((x) => !/^items\[\d+\]/.test(x.path))} />
      {edit ? <SaveBar c={c} /> : <div class="callout">Your role can view but not change the economy.</div>}
      {adding && <NewValue ids={new Set(items.map((x) => x.id))} cats={cats.filter((x) => x !== 'all')} onClose={() => setAdding(false)} onAdd={(it) => { c.add(it); setAdding(false); }} />}
    </div>
  );
}
function NewValue({ ids, cats, onClose, onAdd }: { ids: Set<string>; cats: string[]; onClose: () => void; onAdd: (it: any) => void }) {
  const [id, setId] = useState(''); const [label, setLabel] = useState(''); const [category, setCategory] = useState(cats[0] ?? 'prices'); const [value, setValue] = useState('0'); const [unit, setUnit] = useState('NGN'); const [min, setMin] = useState(''); const [max, setMax] = useState('');
  const err = !id ? null : ids.has(id) ? 'That id already exists' : !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) ? 'Use letters, digits and . _ : -' : null;
  return (<Modal title="New economy value" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="pri" disabled={!id || !!err} onClick={() => onAdd({ id, label: label || id, category, value: Number(value), unit, ...(min !== '' ? { min: Number(min) } : {}), ...(max !== '' ? { max: Number(max) } : {}) })}>Add</Btn></>}>
    <div class="form"><Field label="Id" err={err} class="full"><input class="input mono" placeholder="price.fuel.litre" value={id} onInput={(e) => setId((e.target as HTMLInputElement).value)} autofocus /></Field><Field label="Label" class="full"><input class="input" value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} /></Field>
      <Field label="Category"><input class="input" list="cats" value={category} onInput={(e) => setCategory((e.target as HTMLInputElement).value)} /><datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field><Field label="Unit"><select class="input" value={unit} onChange={(e) => setUnit((e.target as HTMLSelectElement).value)}><option>NGN</option><option>x</option><option>fraction</option><option>seconds</option><option>count</option></select></Field>
      <Field label="Value"><input class="input" type="number" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} /></Field><div class="row"><Field label="Min"><input class="input" type="number" value={min} onInput={(e) => setMin((e.target as HTMLInputElement).value)} /></Field><Field label="Max"><input class="input" type="number" value={max} onInput={(e) => setMax((e.target as HTMLInputElement).value)} /></Field></div></div></Modal>);
}
void Panel; void Badge;
