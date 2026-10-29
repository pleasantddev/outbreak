import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { Badge, Btn, Icon, Loading, Modal, confirm, errMsg, fmt, toast, toastErr } from '../ui';
import { hasErrors, validateContent, type ContentDoc } from '@srv/validate';
import type { ContentVersion, Issue } from '@srv/types';

export interface Content {
  kind: string; doc: ContentDoc | null; version: number; dirty: boolean; issues: Issue[]; loading: boolean; error: string | null; saving: boolean;
  setDoc: (d: ContentDoc) => void; setItems: (items: any[]) => void; update: (id: string, fn: (it: any) => any) => void; add: (it: any) => void; remove: (id: string) => void; reload: () => Promise<void>; save: (note?: string) => Promise<boolean>; discard: () => void;
}
/** Loads one content file into an editable draft. Validation runs locally on every change using the same rules as the server. */
export function useContent(kind: string): Content {
  const [base, setBase] = useState<ContentDoc | null>(null); const [doc, setDocState] = useState<ContentDoc | null>(null); const [version, setVersion] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  const reload = useCallback(async () => { setLoading(true); setError(null); try { const r = await api.get(`/content/${kind}`); setBase(r.doc); setDocState(structuredClone(r.doc)); setVersion(r.version); } catch (e) { setError(errMsg(e)); } finally { setLoading(false); } }, [kind]);
  useEffect(() => { setBase(null); setDocState(null); reload(); }, [kind]); // eslint-disable-line
  const issues = useMemo(() => (doc ? validateContent(kind, doc) : []), [doc, kind]);
  const dirty = useMemo(() => !!doc && !!base && JSON.stringify(doc) !== JSON.stringify(base), [doc, base]);
  useEffect(() => { if (!dirty) return; const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f); }, [dirty]);
  const setItems = (items: any[]) => setDocState((d) => (d ? { ...d, items } : d));
  const save = async (note = '') => {
    if (!doc) return false; if (hasErrors(issues)) { toast('Fix the errors first', 'bad'); return false; }
    setSaving(true);
    try { const r = await api.put(`/content/${kind}`, { doc, baseVersion: version, note }); setBase(structuredClone(doc)); setVersion(r.version); toast(r.changed ? `Saved ${kind} as version ${r.version}` : 'No changes to save', 'good'); return true; }
    catch (e) { if (e instanceof ApiError && e.status === 409) { toast(e.message, 'bad'); } else toastErr(e); return false; } finally { setSaving(false); }
  };
  return {
    kind, doc, version, dirty, issues, loading, error, saving, reload, save,
    setDoc: (d) => setDocState(d), setItems,
    update: (id, fn) => setDocState((d) => (d ? { ...d, items: d.items.map((x) => (x.id === id ? fn(structuredClone(x)) : x)) } : d)),
    add: (it) => setDocState((d) => (d ? { ...d, items: [...d.items, it] } : d)),
    remove: (id) => setDocState((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== id) } : d)),
    discard: () => base && setDocState(structuredClone(base)),
  };
}

export function IssueList({ issues, max = 12, onPick }: { issues: Issue[]; max?: number; onPick?: (path: string) => void }) {
  if (!issues.length) return null; const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  return (<div class="issues">{sorted.slice(0, max).map((i, k) => (<div key={k} class={'issue ' + i.level} onClick={() => onPick?.(i.path)} style={onPick ? 'cursor:pointer' : ''}><b>{i.level === 'error' ? 'Error' : 'Warning'}</b><span class="p">{i.path || 'file'}</span><span>{i.msg}</span></div>))}{issues.length > max && <div class="dim" style="padding:2px 10px">and {issues.length - max} more</div>}</div>);
}

export function SaveBar({ c, extra }: { c: Content; extra?: any }) {
  const [note, setNote] = useState(''); const [hist, setHist] = useState(false);
  const errs = c.issues.filter((i) => i.level === 'error').length, warns = c.issues.length - errs;
  return (<>
    <div class="sticky-bar">
      <Badge kind={c.dirty ? 'warn' : 'good'}>{c.dirty ? 'Unsaved changes' : `Saved, version ${c.version}`}</Badge>
      {errs > 0 && <Badge kind="bad">{errs} error{errs > 1 ? 's' : ''}</Badge>}{warns > 0 && <Badge kind="warn">{warns} warning{warns > 1 ? 's' : ''}</Badge>}
      {extra}<div class="grow" />
      {c.dirty && <input class="input sm" style="width:240px" placeholder="What did you change? (optional)" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />}
      <Btn kind="sm" icon="hist" onClick={() => setHist(true)}>History</Btn>
      {c.dirty && <Btn kind="sm" icon="undo" onClick={async () => { if (await confirm({ title: 'Discard all unsaved changes?', danger: true, ok: 'Discard' })) c.discard(); }}>Discard</Btn>}
      <Btn kind="pri sm" icon="save" disabled={!c.dirty || c.saving || errs > 0} onClick={async () => { if (await c.save(note)) setNote(''); }}>{c.saving ? 'Saving...' : 'Save changes'}</Btn>
    </div>
    {hist && <HistoryModal c={c} onClose={() => setHist(false)} />}
  </>);
}

function diffSummary(a: any[], b: any[]) {
  const ma = new Map(a.map((x) => [x.id, JSON.stringify(x)])), mb = new Map(b.map((x) => [x.id, JSON.stringify(x)]));
  const added = [...mb.keys()].filter((k) => !ma.has(k)), removed = [...ma.keys()].filter((k) => !mb.has(k)), changed = [...mb.keys()].filter((k) => ma.has(k) && ma.get(k) !== mb.get(k));
  return { added, removed, changed };
}
export function HistoryModal({ c, onClose }: { c: Content; onClose: () => void }) {
  const [vers, setVers] = useState<ContentVersion[] | null>(null); const [sel, setSel] = useState<number | null>(null); const [body, setBody] = useState<ContentDoc | null>(null);
  useEffect(() => { api.get(`/content/${c.kind}/versions`).then((r) => { setVers(r.versions); }).catch(toastErr); }, []);
  useEffect(() => { if (sel === null) return; setBody(null); api.get(`/content/${c.kind}/versions/${sel}`).then((r) => setBody(r.doc)).catch(toastErr); }, [sel]);
  const d = body && c.doc ? diffSummary(c.doc.items, body.items) : null;
  const rollback = async () => {
    if (sel === null) return; if (!(await confirm({ title: `Roll ${c.kind} back to version ${sel}?`, ok: 'Roll back', danger: true, body: <div>This saves a new version that is a copy of v{sel}. Nothing is lost, you can roll forward again.{c.dirty && <div class="callout warn" style="margin-top:8px">You have unsaved changes. They will be replaced.</div>}</div> }))) return;
    try { await api.post(`/content/${c.kind}/rollback`, { version: sel }); toast(`Rolled back to v${sel}`, 'good'); await c.reload(); onClose(); } catch (e) { toastErr(e); }
  };
  return (
    <Modal wide title={`History of ${c.kind}`} onClose={onClose} footer={<><Btn onClick={onClose}>Close</Btn><Btn kind="danger" disabled={sel === null || sel === c.version} onClick={rollback}>Roll back to v{sel ?? '?'}</Btn></>}>
      {!vers ? <Loading /> : (
        <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start">
          <div class="tblwrap" style="max-height:420px"><table class="tbl"><thead><tr><th>Ver</th><th>Saved</th><th>By</th><th class="num">Items</th></tr></thead><tbody>{vers.map((v) => (<tr key={v.version} class="click" style={sel === v.version ? 'background:rgba(45,224,200,.08)' : ''} onClick={() => setSel(v.version)}><td class="mono">v{v.version}{v.version === c.version && <> <Badge kind="teal">live</Badge></>}</td><td class="mut">{fmt.date(v.savedAt)}{v.note && <div class="dim" style="font-size:11.5px">{v.note}</div>}</td><td class="mut">{v.by.split('@')[0]}</td><td class="num">{v.items}</td></tr>))}</tbody></table></div>
          <div class="col">{sel === null ? <div class="dim">Pick a version to compare it with what is live.</div> : !d ? <Loading /> : (<>
            <h3>Version {sel} compared to {c.dirty ? 'your draft' : `v${c.version}`}</h3>
            {!d.added.length && !d.removed.length && !d.changed.length ? <div class="callout good">Identical.</div> : <div class="col gap-sm">
              {d.removed.length > 0 && <div><div class="diff-add">Items in v{sel} that the current file does not have ({d.removed.length}) would come back</div><div class="mono dim">{d.removed.slice(0, 20).join(', ')}</div></div>}
              {d.added.length > 0 && <div><div class="diff-del">Items added since v{sel} ({d.added.length}) would be removed</div><div class="mono dim">{d.added.slice(0, 20).join(', ')}</div></div>}
              {d.changed.length > 0 && <div><div style="color:var(--warn)">Items edited since v{sel} ({d.changed.length}) would revert</div><div class="mono dim">{d.changed.slice(0, 30).join(', ')}</div></div>}</div>}</>)}</div>
        </div>)}
    </Modal>
  );
}

/** Raw JSON editor, the fallback for any shape the forms do not know. Applies only when the JSON parses. */
export function JsonEditor({ value, onApply, rows = 26, label }: { value: unknown; onApply: (v: any) => void; rows?: number; label?: string }) {
  const text0 = useMemo(() => JSON.stringify(value, null, 2), [value]); const [text, setText] = useState(text0); const [err, setErr] = useState<string | null>(null); const last = useRef(text0);
  useEffect(() => { if (text0 !== last.current) { last.current = text0; setText(text0); setErr(null); } }, [text0]);
  const change = (t: string) => { setText(t); try { const v = JSON.parse(t); setErr(null); last.current = JSON.stringify(v, null, 2); onApply(v); } catch (e) { setErr((e as Error).message); } };
  return (<div class="col gap-sm" style="min-height:0">{label && <h3>{label}</h3>}<textarea class={'input mono' + (err ? ' bad' : '')} style="min-height:200px;height:100%;tab-size:2;white-space:pre" rows={rows} spellcheck={false} value={text} onInput={(e) => change((e.target as HTMLTextAreaElement).value)} />{err ? <div class="err" style="color:var(--bad)">Not applied yet, invalid JSON: {err}</div> : <div class="dim" style="font-size:12px">Valid JSON. Changes apply as you type.</div>}</div>);
}
export { Icon };
