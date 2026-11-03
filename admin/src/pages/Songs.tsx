// Club songs. Players upload songs and tick that they made them or own the rights; nothing plays in a club until a
// person here has listened. Turning a song down refunds any paid club promotion through Paystack.
import { useState } from 'preact/hooks';
import { api, qs } from '../api';
import { useCan } from '../session';
import { Badge, Btn, Loading, Panel, Seg, Stat, toast, toastErr, useFetch } from '../ui';

interface SongRow { id: string; account_id: string; owner: string | null; title: string; artist: string; mime: string; bytes: number; secs: number; status: string; note: string | null; plays: number; attest_at: number; created_at: number }
interface ClubV { id: string; dj: { name: string } | null; track: { title: string; artist: string; src: string } | null; shutdown: { name: string; until: number } | null; crowd: number; poles: Record<string, { name: string }> }
const when = (t: number) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Player({ id }: { id: string }) {
  const [on, setOn] = useState(false);
  const p = useFetch<{ dataUrl: string } | null>(() => (on ? api.get(`/world/songs/${id}/audio`) : Promise.resolve(null)), [id, on]);
  if (!on) return <Btn kind="sm ghost" onClick={() => setOn(true)}>Load and listen</Btn>;
  if (!p.data) return <div class="muted">loading song…</div>;
  return <audio controls src={p.data.dataUrl} style="width:100%" />;
}

function SongCard({ s, onDone }: { s: SongRow; onDone: () => void }) {
  const can = useCan(); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !note.trim()) { toast('Say why. The artist sees your note.', 'bad'); return; }
    setBusy(true); try { await api.post(`/world/songs/${s.id}`, { decision, note }); toast(decision === 'approve' ? 'Cleared for clubs' : 'Turned down', 'good'); onDone(); } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  return (
    <div class="panel" style="padding:12px">
      <b>{s.title}</b> <span class="muted">by {s.artist}</span> <Badge>{s.status}</Badge>
      <div class="muted" style="font-size:12px;margin:4px 0 8px">{s.owner ?? s.account_id} · {mmss(s.secs)} · {(s.bytes / 1e6).toFixed(1)} MB · {s.mime} · uploaded {when(s.created_at)} · owner ticked the rights box {when(s.attest_at)} · {s.plays} plays</div>
      <Player id={s.id} />
      {s.note && <div class="muted" style="margin-top:6px">Note: {s.note}</div>}
      {s.status !== 'rejected' && can('reports.resolve') && (
        <div class="row gap" style="margin-top:10px">
          <input class="grow" placeholder="Note to the artist (needed to turn it down)" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
          {s.status === 'review' && <Btn kind="sm" disabled={busy} onClick={() => decide('approve')}>Clear for clubs</Btn>}
          <Btn kind="sm danger" disabled={busy} onClick={() => decide('reject')}>Turn down and refund</Btn>
        </div>
      )}
    </div>
  );
}

export function Songs() {
  const [st, setSt] = useState('review');
  const q = useFetch<{ list: SongRow[]; clubs: ClubV[] }>(() => api.get('/world/songs' + qs({ status: st })), [st]);
  return (
    <div class="col gap-lg">
      <div class="grid g4">
        {(q.data?.clubs ?? []).map((c) => <Stat key={c.id} k={c.id.toUpperCase()} v={c.crowd} s={`${c.dj ? `DJ ${c.dj.name}` : 'house DJ'}${c.track ? ` · ${c.track.title}` : ''}${c.shutdown ? ` · shut down by ${c.shutdown.name}` : ''}`} tone={c.shutdown ? 'teal' : undefined} />)}
        <Stat k="Money" v="Store page" s="song promotions are sku song:<id> in the Store ledger" />
      </div>
      <Panel title="Club songs" actions={<Seg opts={[['review', 'To listen'], ['approved', 'Cleared'], ['rejected', 'Turned down']]} cur={st} on={setSt} />}>
        {!q.data ? <Loading /> : q.data.list.length ? <div class="col gap">{q.data.list.map((s) => <SongCard key={s.id} s={s} onDone={() => q.reload()} />)}</div> : <div class="empty">Nothing here.</div>}
      </Panel>
    </div>
  );
}
