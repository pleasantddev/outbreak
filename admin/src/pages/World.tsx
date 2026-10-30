// The game world: the power grid (every feeder, live, force on/off/back to the plan, collapse or restore the national
// grid, set generation) and the businesses on Lagos shop fronts (till, stock, wages owed, repossess).
// Wear rates live in Game script > Tuning (content/tuning.json) and reach every client live.
import { useState } from 'preact/hooks';
import { api } from '../api';
import { useCan } from '../session';
import { Badge, Btn, Loading, Panel, Stat, confirm, fmt, toast, toastErr, useFetch, useInterval } from '../ui';

interface FeederRow { i: number; name: string; load: number; band: 'A' | 'B' | 'C'; on: boolean; planned: boolean; op: { on: boolean; by: string; until: number } | null; forced: { on: boolean; until: number } | null }
interface Board { on: string; gen: number; load: number; collapse: boolean; hour: number; feeders: FeederRow[]; genScale: number; bands: Record<string, number> }
interface BizRow { site: string; owner_id: string; owner_name: string | null; type: string; stock: number; till: number; debt: number; bought_at: number; log: string }

export function World() {
  const can = useCan(); const edit = can('liveops.edit'); const money = can('economy.edit');
  const g = useFetch<Board>(() => api.get('/world/grid')); const b = useFetch<{ list: BizRow[] }>(() => api.get('/world/businesses'));
  useInterval(() => g.reload(), 5000);
  const [sel, setSel] = useState<number | null>(null);
  const post = async (body: unknown, msg: string) => { try { await api.post('/world/grid', body); toast(msg, 'good'); g.reload(); } catch (e) { toastErr(e); } };
  const d = g.data; if (!d) return <Loading />;
  const f = sel !== null ? d.feeders.find((x) => x.i === sel) ?? null : null;
  const tiles = []; for (let j = 0; j < 8; j++) for (let i = 0; i < 9; i++) { const id = i + j * 9; const x = d.feeders.find((q) => q.i === id);
    tiles.push(x ? (
      <button key={id} onClick={() => setSel(sel === id ? null : id)} title={`${x.name} · ${x.load} MW · Band ${x.band}`}
        style={`text-align:left;border-radius:8px;padding:6px 7px;min-height:52px;cursor:pointer;font-size:11px;line-height:1.25;border:1px solid ${sel === id ? 'var(--teal)' : 'rgba(255,255,255,.08)'};background:${x.on ? 'rgba(250,204,21,.18)' : 'rgba(255,255,255,.03)'};color:inherit`}>
        <b style={`display:block;font-size:11.5px;color:${x.on ? '#fde68a' : 'inherit'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`}>{x.name}</b>
        {x.load} MW · {x.band}{x.forced ? ' · forced' : x.op ? ` · ${x.op.by}` : ''}
      </button>) : <div key={id} />); }
  const lit = d.feeders.filter((x) => x.on).length;
  return (
    <div class="col gap-lg">
      <div class="grid g4">
        <Stat k="Feeders with light" v={`${lit} / ${d.feeders.length}`} s={d.collapse ? 'NATIONAL GRID COLLAPSED' : `game hour ${Math.floor(d.hour)}:00`} tone={d.collapse ? 'red' : 'teal'} />
        <Stat k="Load" v={`${fmt.n(d.load)} MW`} s="what is switched on" />
        <Stat k="Generation" v={`${fmt.n(d.gen)} MW`} s={`${Math.round(d.genScale * 100)}% of the day's gas supply`} />
        <Stat k="Plan" v={`A ${d.bands.A}h · B ${d.bands.B}h · C ${d.bands.C}h`} s="hours of light a day by band" />
      </div>
      <Panel title="Power grid" actions={edit && <div class="row gap">
        <Btn kind="sm" onClick={() => post({ genScale: Math.max(0, d.genScale - 0.1) }, 'Generation down')}>Gen −10%</Btn>
        <Btn kind="sm" onClick={() => post({ genScale: Math.min(2, d.genScale + 0.1) }, 'Generation up')}>Gen +10%</Btn>
        {d.collapse ? <Btn kind="sm" onClick={() => post({ collapse: 0 }, 'Grid restored')}>Restore grid</Btn>
          : <Btn kind="sm danger" onClick={async () => { if (await confirm({ title: 'Collapse the national grid?', body: 'Every feeder goes dark for 2 game hours (4 real minutes). Every player sees it.', ok: 'Collapse it', danger: true })) post({ collapse: 2 }, 'Grid collapsed'); }}>Collapse grid</Btn>}
        <Btn kind="sm" onClick={() => post({ feeder: 'all', on: null }, 'All feeders back on the plan')}>All back to plan</Btn>
      </div>}>
        <div style="display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:5px">{tiles}</div>
        {f && <div class="callout row" style="margin-top:12px;gap:10px;flex-wrap:wrap">
          <b>{f.name}</b><Badge kind={f.on ? 'good' : ''}>{f.on ? 'light' : 'dark'}</Badge><span class="mut">Band {f.band} · {f.load} MW · plan says {f.planned ? 'on' : 'off'} now{f.op ? ` · switched by ${f.op.by}` : ''}{f.forced ? ' · forced by admin' : ''}</span>
          <div class="grow" />
          {edit && <><Btn kind="sm" onClick={() => post({ feeder: f.i, on: true, hours: 24 }, `${f.name} forced ON`)}>Force on 24h</Btn>
            <Btn kind="sm" onClick={() => post({ feeder: f.i, on: false, hours: 24 }, `${f.name} forced OFF`)}>Force off 24h</Btn>
            <Btn kind="sm" onClick={() => post({ feeder: f.i, on: null }, `${f.name} back on the plan`)}>Back to plan</Btn></>}
        </div>}
      </Panel>
      <Panel title="Businesses" actions={<span class="mut" style="font-size:12px">{b.data?.list.length ?? 0} shops owned</span>} flush>
        {!b.data ? <Loading /> : !b.data.list.length ? <div class="empty">No player owns a shop yet.</div> : (
          <table class="tbl"><thead><tr><th>Owner</th><th>Trade</th><th>Site</th><th>Till</th><th>Stock</th><th>Wages owed</th><th>Bought</th><th /></tr></thead>
            <tbody>{b.data.list.map((r) => (<tr key={r.site}>
              <td><a href={`#/players/${r.owner_id}`}>{r.owner_name ?? r.owner_id.slice(0, 8)}</a></td><td>{r.type}</td><td class="mono">{r.site}</td>
              <td>{fmt.naira(r.till)}</td><td>{Math.round(r.stock)}%</td><td>{r.debt ? <Badge kind="bad">{fmt.naira(r.debt)}</Badge> : '-'}</td><td>{new Date(r.bought_at).toLocaleDateString('en-GB')}</td>
              <td>{money && <div class="row gap">
                <Btn kind="sm" onClick={async () => { try { await api.post(`/world/businesses/${encodeURIComponent(r.site)}`, { stock: 100, debt: 0 }); toast('Restocked and wages cleared', 'good'); b.reload(); } catch (e) { toastErr(e); } }}>Restock</Btn>
                <Btn kind="sm danger" onClick={async () => { if (!(await confirm({ title: `Repossess ${r.owner_name ?? 'this'}'s ${r.type}?`, body: 'The shop goes back to SHOP TO LET. No refund.', ok: 'Repossess', danger: true }))) return; try { await api.post(`/world/businesses/${encodeURIComponent(r.site)}`, { repossess: true }); toast('Repossessed', 'good'); b.reload(); } catch (e) { toastErr(e); } }}>Repossess</Btn>
              </div>}</td></tr>))}</tbody></table>)}
      </Panel>
    </div>
  );
}
