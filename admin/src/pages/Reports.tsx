import { useState } from 'preact/hooks';
import { api, qs } from '../api';
import { useCan } from '../session';
import { Badge, Btn, ErrorBox, Field, Loading, Modal, Seg, errMsg, fmt, toast, useFetch } from '../ui';
import { SanctionDialog } from './Players';
import type { ChatReport } from '@srv/types';

export function Reports() {
  const can = useCan(); const [status, setStatus] = useState('open'); const [cur, setCur] = useState<ChatReport | null>(null);
  const res = useFetch<{ rows: ChatReport[]; total: number }>(() => api.get('/reports' + qs({ status })), [status]);
  return (
    <div class="col gap-lg">
      <div class="pageh"><div><h1>Chat reports</h1><div class="sub">What players flagged in chat. Read the context, then act.</div></div><div class="grow" /><Seg cur={status} on={setStatus} opts={[['open', 'Open'], ['actioned', 'Actioned'], ['dismissed', 'Dismissed'], ['all', 'All']]} /></div>
      {res.error ? <ErrorBox e={res.error} retry={res.reload} /> : !res.data ? <Loading /> : (
        <div class="tblwrap"><table class="tbl"><thead><tr><th>Reported message</th><th>Against</th><th>Reporter</th><th>Channel</th><th>When</th><th>Status</th></tr></thead><tbody>
          {res.data.rows.map((r) => <tr key={r.id} class="click" onClick={() => setCur(r)}><td style="max-width:420px">{r.message}</td><td><a href={'#/players/' + r.targetId} onClick={(e) => e.stopPropagation()}>{r.targetName ?? r.targetId}</a></td><td>{r.reporterName ?? r.reporterId}</td><td><Badge>{r.channel}</Badge></td><td class="mut">{fmt.ago(r.createdAt)}</td><td><Badge kind={r.status === 'open' ? 'warn' : r.status === 'actioned' ? 'good' : ''}>{r.status}</Badge></td></tr>)}
          {res.data.rows.length === 0 && <tr><td colSpan={6} class="empty">Nothing here. Quiet day.</td></tr>}</tbody></table></div>)}
      {cur && <ReportModal r={cur} can={can('reports.resolve')} canMod={can('players.moderate')} onClose={() => setCur(null)} done={() => { setCur(null); res.reload(); }} />}
    </div>
  );
}
function ReportModal({ r, can, canMod, onClose, done }: { r: ChatReport; can: boolean; canMod: boolean; onClose: () => void; done: () => void }) {
  const [note, setNote] = useState(''); const [sanc, setSanc] = useState(false);
  const resolve = async (status: 'actioned' | 'dismissed') => { try { await api.post(`/reports/${r.id}/resolve`, { status, note }); toast('Report ' + status, 'good'); done(); } catch (e) { toast(errMsg(e), 'bad'); } };
  return (<>
    <Modal wide title={`Report #${r.id}`} onClose={onClose} footer={can && r.status === 'open' ? <><Btn onClick={() => resolve('dismissed')} disabled={note.trim().length < 2}>Dismiss</Btn><Btn kind="pri" onClick={() => resolve('actioned')} disabled={note.trim().length < 2}>Mark actioned</Btn></> : undefined}>
      <div class="grid g2"><div class="callout"><div class="dim">Against</div><b>{r.targetName ?? r.targetId}</b> <a href={'#/players/' + r.targetId} onClick={onClose}>open profile</a></div><div class="callout"><div class="dim">Reported by</div><b>{r.reporterName ?? r.reporterId}</b> in {r.channel} chat, {fmt.date(r.createdAt)}</div></div>
      <div class="panel" style="padding:12px 14px;font-family:var(--mono);font-size:12.5px;line-height:1.7">{(r.context ?? []).map((l, i) => <div key={i} class="mut">{l}</div>)}<div style="color:var(--warn)">{r.message}</div></div>
      {r.status !== 'open' ? <div class="callout">{r.status} by {r.resolvedBy}: {r.resolution}</div> : <>
        <Field label="Resolution note"><input class="input" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} placeholder="Muted for 24h / not a violation" /></Field>
        {canMod && <div class="row"><Btn kind="warn" icon="mute" onClick={() => setSanc(true)}>Sanction the player</Btn><span class="dim">then mark the report actioned</span></div>}</>}
    </Modal>
    {sanc && <SanctionDialog p={{ id: r.targetId, name: r.targetName ?? r.targetId }} kind="mute" onClose={() => setSanc(false)} done={() => setSanc(false)} />}
  </>);
}
