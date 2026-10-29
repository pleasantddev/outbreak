import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { Btn, Field, Switch } from '../ui';
import { blankValue, type FieldDef } from './schema';
import type { Issue } from '@srv/types';

const refCache = new Map<string, Promise<string[]>>();
export const invalidateRefs = (kind?: string) => (kind ? refCache.delete(kind) : refCache.clear());
export function useRefIds(kind: string | undefined) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => { if (!kind) return; let p = refCache.get(kind); if (!p) { p = api.get(`/content/${kind}`).then((r) => (r.doc.items as any[]).map((i) => i.id)).catch(() => []); refCache.set(kind, p); } p.then(setIds); }, [kind]);
  return ids;
}

interface P { fields: FieldDef[]; value: any; onChange: (v: any) => void; issues?: Issue[]; base?: string; disabled?: boolean; ownKind?: string }
const num = (e: Event) => { const v = (e.target as HTMLInputElement).value; return v === '' ? undefined : Number(v); };

/** Renders a form for an object from field definitions. Keys the schema does not know are left untouched. */
export function ObjectForm({ fields, value, onChange, issues = [], base = '', disabled, ownKind }: P) {
  const set = (k: string, v: any) => { const n = { ...value }; if (v === undefined) delete n[k]; else n[k] = v; onChange(n); };
  return (<div class="form">{fields.map((f) => { const path = base ? `${base}.${f.key}` : f.key; const errs = issues.filter((i) => i.path === path || i.path.startsWith(path + '.') || i.path.startsWith(path + '[')); const e = errs.find((x) => x.level === 'error') ?? errs[0];
    return <Cell key={f.key} f={f} v={value?.[f.key]} set={(v) => set(f.key, v)} err={e ? e.msg : null} issues={issues} path={path} disabled={disabled} ownKind={ownKind} />; })}</div>);
}

function Cell({ f, v, set, err, issues, path, disabled, ownKind }: { f: FieldDef; v: any; set: (v: any) => void; err: string | null; issues: Issue[]; path: string; disabled?: boolean; ownKind?: string }) {
  const full = f.wide || f.type === 'object' || f.type === 'array' || f.type === 'json' || f.type === 'text' || f.type === 'stringlist' || f.type === 'reflist';
  const refIds = useRefIds(f.type === 'ref' || f.type === 'reflist' ? (f.ref ?? ownKind) : undefined);
  const lbl = f.label + (f.unit ? ` (${f.unit})` : '');
  const body = (() => {
    switch (f.type) {
      case 'string': return <input class={'input' + (err ? ' bad' : '')} disabled={disabled} value={v ?? ''} onInput={(e) => set((e.target as HTMLInputElement).value)} />;
      case 'text': return <textarea class="input" disabled={disabled} value={v ?? ''} onInput={(e) => set((e.target as HTMLTextAreaElement).value)} />;
      case 'number': return <input class={'input' + (err ? ' bad' : '')} type="number" step="any" min={f.min} max={f.max} disabled={disabled} value={v ?? ''} onInput={(e) => set(num(e))} />;
      case 'boolean': return <div class="row"><Switch on={!!v} disabled={disabled} onChange={set} /><span class="mut">{v ? 'Yes' : 'No'}</span></div>;
      case 'enum': return <select class="input" disabled={disabled} value={v ?? ''} onChange={(e) => set((e.target as HTMLSelectElement).value)}>{!f.options?.includes(v) && v !== undefined && <option value={v}>{String(v)}</option>}{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>;
      case 'color': return <div class="row"><input type="color" disabled={disabled} value={v ?? '#888888'} onInput={(e) => set((e.target as HTMLInputElement).value)} style="width:40px;height:34px;border:none;background:none;padding:0" /><input class="input mono" disabled={disabled} value={v ?? ''} onInput={(e) => set((e.target as HTMLInputElement).value)} /></div>;
      case 'date': return <input class="input" type="date" disabled={disabled} value={(v ?? '').slice(0, 10)} onInput={(e) => set((e.target as HTMLInputElement).value || undefined)} />;
      case 'pos': return <div class="row"><input class="input" type="number" placeholder="x" disabled={disabled} value={v?.x ?? ''} onInput={(e) => set({ ...v, x: num(e) ?? 0 })} /><input class="input" type="number" placeholder="z" disabled={disabled} value={v?.z ?? ''} onInput={(e) => set({ ...v, z: num(e) ?? 0 })} />{v && 'r' in v && <input class="input" type="number" placeholder="radius" title="radius" disabled={disabled} value={v.r ?? ''} onInput={(e) => set({ ...v, r: num(e) ?? 0 })} />}</div>;
      case 'numberlist': return <input class="input mono" disabled={disabled} value={(v ?? []).join(', ')} onInput={(e) => set((e.target as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n)))} />;
      case 'stringlist': return <TagList v={v ?? []} set={set} disabled={disabled} />;
      case 'ref': return <><input class="input mono" list={'ref-' + path} disabled={disabled} value={v ?? ''} onInput={(e) => set((e.target as HTMLInputElement).value || undefined)} /><datalist id={'ref-' + path}>{refIds.map((i) => <option key={i} value={i} />)}</datalist></>;
      case 'reflist': return <TagList v={v ?? []} set={set} disabled={disabled} suggest={refIds} />;
      case 'object': return <div class="sub-card"><ObjectForm fields={f.children ?? []} value={v ?? {}} onChange={set} issues={issues} base={path} disabled={disabled} ownKind={ownKind} /></div>;
      case 'array': return <ArrayEditor f={f} v={v ?? []} set={set} issues={issues} path={path} disabled={disabled} ownKind={ownKind} />;
      default: return <JsonCell v={v} set={set} disabled={disabled} />;
    }
  })();
  return <Field label={lbl} help={f.help} err={err} class={full ? 'full' : ''}>{body}</Field>;
}

function TagList({ v, set, disabled, suggest }: { v: string[]; set: (v: string[]) => void; disabled?: boolean; suggest?: string[] }) {
  const [t, setT] = useState(''); const add = () => { const s = t.trim(); if (s && !v.includes(s)) set([...v, s]); setT(''); };
  return (<div class="col gap-sm"><div class="row wrap gap-sm">{v.map((x) => <span key={x} class="badge teal" style="padding:3px 6px 3px 10px">{x}{!disabled && <button class="btn ghost sm icon" style="width:18px;height:18px;height:18px" onClick={() => set(v.filter((y) => y !== x))}>&times;</button>}</span>)}{!v.length && <span class="dim">none</span>}</div>
    {!disabled && <div class="row"><input class="input sm" list={suggest ? 'tl-' + suggest.length : undefined} placeholder="Type and press Enter" value={t} onInput={(e) => setT((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />{suggest && <datalist id={'tl-' + suggest.length}>{suggest.map((i) => <option key={i} value={i} />)}</datalist>}<Btn kind="sm" onClick={add}>Add</Btn></div>}</div>);
}
function ArrayEditor({ f, v, set, issues, path, disabled, ownKind }: { f: FieldDef; v: any[]; set: (v: any[]) => void; issues: Issue[]; path: string; disabled?: boolean; ownKind?: string }) {
  const item = f.item ?? { key: '#', label: 'Entry', type: 'json' as const };
  const move = (i: number, d: number) => { const n = [...v]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; set(n); };
  return (<div class="col gap-sm">{v.map((x, i) => (<div class="sub-card" key={i}><div class="row" style="margin-bottom:8px"><b class="grow mut">{item.label} {i + 1}{x && typeof x === 'object' && (x.id || x.name || x.label) ? `: ${x.id ?? x.name ?? x.label}` : ''}</b>{!disabled && <><Btn kind="ghost sm icon" onClick={() => move(i, -1)}>&uarr;</Btn><Btn kind="ghost sm icon" onClick={() => move(i, 1)}>&darr;</Btn><Btn kind="ghost sm icon" icon="trash" onClick={() => set(v.filter((_, k) => k !== i))} /></>}</div>
    {item.type === 'object' ? <ObjectForm fields={item.children ?? []} value={x} onChange={(nv) => set(v.map((y, k) => (k === i ? nv : y)))} issues={issues} base={`${path}[${i}]`} disabled={disabled} ownKind={ownKind} /> : <JsonCell v={x} set={(nv) => set(v.map((y, k) => (k === i ? nv : y)))} disabled={disabled} />}</div>))}
    {!disabled && <Btn kind="sm" icon="plus" style="align-self:flex-start" onClick={() => set([...v, blankValue(item)])}>Add {item.label.toLowerCase()}</Btn>}</div>);
}
function JsonCell({ v, set, disabled }: { v: any; set: (v: any) => void; disabled?: boolean }) {
  const [t, setT] = useState(JSON.stringify(v, null, 1)); const [bad, setBad] = useState(false);
  return <textarea class={'input mono' + (bad ? ' bad' : '')} disabled={disabled} style="min-height:80px" value={t} onInput={(e) => { const s = (e.target as HTMLTextAreaElement).value; setT(s); try { set(JSON.parse(s)); setBad(false); } catch { setBad(true); } }} />;
}
