// MyAds moderation. Every paid ad waits here until a person approves it; turning one down refunds the advertiser
// through Paystack. The money itself is in the Store page's ledger (purchases, sku ad:new).
import { useState } from 'preact/hooks';
import { api, qs } from '../api';
import { useCan } from '../session';
import { Badge, Btn, Loading, Panel, Seg, Stat, toast, toastErr, useFetch } from '../ui';

interface AdRow { id: number; account_id: string; owner: string | null; kind: 'board' | 'drone' | 'blimp'; board_id: string | null; upload_id: string | null; text: string | null; color: string | null; place: string | null; start_at: number; end_at: number; price_kobo: number; status: string; payment_ref: string | null; note: string | null; created_at: number }
const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const naira = (k: number) => '₦' + Math.round(k / 100).toLocaleString('en-NG');

function Picture({ id }: { id: string }) {
  const p = useFetch<{ dataUrl: string; size: string }>(() => api.get(`/world/uploads/${id}`), [id]);
  if (!p.data) return <div class="muted" style="height:80px;display:flex;align-items:center">loading picture…</div>;
  return <div><img src={p.data.dataUrl} style="max-width:100%;max-height:220px;border-radius:8px;display:block;background:#000" alt="" /><div class="muted" style="font-size:11px;margin-top:3px">{p.data.size} px</div></div>;
}

function AdCard({ a, onDone }: { a: AdRow; onDone: () => void }) {
  const can = useCan(); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !note.trim()) { toast('Say why. The advertiser sees your note.', 'bad'); return; }
    setBusy(true); try { await api.post(`/world/ads/${a.id}`, { decision, note }); toast(decision === 'approve' ? 'Approved' : 'Rejected and refunded', 'good'); onDone(); } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  const what = a.kind === 'board' ? `Billboard ${a.board_id}` : a.kind === 'drone' ? `Drone show over ${a.place}` : 'Blimp banner';
  return (
    <div class="panel" style="padding:12px">
      <div class="row gap" style="align-items:flex-start">
        <div style="flex:1;min-width:0">
          <b>{what}</b> <Badge>{a.status}</Badge>
          <div class="muted" style="font-size:12px;margin-top:4px">{a.owner ?? a.account_id} · {day(a.start_at)} to {day(a.end_at - 1)} · {naira(a.price_kobo)} · ref {a.payment_ref}</div>
          {a.kind === 'drone' && <div style={`margin-top:10px;padding:14px;border-radius:8px;background:#05070d;color:${a.color ?? '#fff'};font:900 20px Inter,sans-serif;letter-spacing:2px;text-align:center`}>{a.text}</div>}
          {a.upload_id && <div style="margin-top:10px"><Picture id={a.upload_id} /></div>}
          {a.note && <div class="muted" style="margin-top:6px">Note: {a.note}</div>}
        </div>
      </div>
      {a.status === 'review' && can('reports.resolve') && (
        <div class="row gap" style="margin-top:10px">
          <input class="grow" placeholder="Note to the advertiser (needed to reject)" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
          <Btn kind="sm" disabled={busy} onClick={() => decide('approve')}>Approve</Btn>
          <Btn kind="sm danger" disabled={busy} onClick={() => decide('reject')}>Reject and refund</Btn>
        </div>
      )}
    </div>
  );
}

export function Ads() {
  const [st, setSt] = useState('review');
  const q = useFetch<{ list: AdRow[]; boards: number }>(() => api.get('/world/ads' + qs({ status: st })), [st]);
  const live = q.data && st === 'approved' ? q.data.list.filter((a) => a.start_at <= Date.now() && a.end_at > Date.now()).length : null;
  return (
    <div class="col gap-lg">
      <div class="grid g4">
        <Stat k="Waiting for review" v={st === 'review' && q.data ? q.data.list.length : '·'} s="paid ads that are not up yet" tone="teal" />
        <Stat k="Billboards for sale" v={q.data?.boards ?? '·'} s="from v2/src/data/billboards.json" />
        <Stat k="Up right now" v={live ?? '·'} s="open the Approved tab to count" />
        <Stat k="Money" v="Store page" s="every payment is in the Store ledger (sku ad:new)" />
      </div>
      <Panel title="MyAds" actions={<Seg opts={[['review', 'To review'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['unpaid', 'Unpaid']]} cur={st} on={setSt} />}>
        {!q.data ? <Loading /> : q.data.list.length ? <div class="col gap">{q.data.list.map((a) => <AdCard key={a.id} a={a} onDone={() => q.reload()} />)}</div> : <div class="empty">Nothing here.</div>}
      </Panel>
    </div>
  );
}
