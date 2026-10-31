import { useState } from 'preact/hooks';
import { api, qs } from '../api';
import { go, useCan } from '../session';
import { Badge, Btn, ErrorBox, Field, Icon, Loading, Modal, Panel, Stat, Tabs, confirm, errMsg, fmt, initials, toast, toastErr, useDebounced, useFetch } from '../ui';
import type { ChatReport, PlayerDetail, PlayerRow, PurchaseRow, Sanction, SanctionKind } from '@srv/types';

const STATUS_BADGE: Record<string, [string, string]> = { ok: ['', 'Active'], banned: ['bad', 'Banned'], suspended: ['warn', 'Suspended'], muted: ['pur', 'Muted'] };
const FILTERS: [string, string][] = [['all', 'All'], ['online', 'Online'], ['banned', 'Banned'], ['suspended', 'Suspended'], ['muted', 'Muted']];

export function Players() {
  const [q, setQ] = useState(''); const [status, setStatus] = useState('all'); const [sort, setSort] = useState('lastSeen'); const [dir, setDir] = useState<'asc' | 'desc'>('desc'); const [page, setPage] = useState(0);
  const dq = useDebounced(q, 250); const PER = 40;
  const res = useFetch<{ rows: PlayerRow[]; total: number }>(() => api.get('/players' + qs({ q: dq, status, sort, dir, limit: PER, offset: page * PER })), [dq, status, sort, dir, page]);
  const th = (k: string, label: string, num = false) => <th class={'sortable ' + (num ? 'num' : '')} onClick={() => { if (sort === k) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir('desc'); } setPage(0); }}>{label}{sort === k ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>;
  const total = res.data?.total ?? 0;
  return (
    <div class="col gap-lg">
      <div class="pageh"><div><h1>Players</h1><div class="sub">{fmt.n(total)} matching accounts</div></div></div>
      <div class="row wrap">
        <div style="position:relative;width:340px"><input class="input" style="padding-left:34px;height:38px" placeholder="Search name, email or account id" value={q} onInput={(e) => { setQ((e.target as HTMLInputElement).value); setPage(0); }} /><span style="position:absolute;left:10px;top:10px;color:var(--dim)"><Icon n="search" s={17} /></span></div>
        <div class="seg">{FILTERS.map(([k, l]) => <button key={k} class={status === k ? 'on' : ''} onClick={() => { setStatus(k); setPage(0); }}>{l}</button>)}</div>
      </div>
      {res.error ? <ErrorBox e={res.error} retry={res.reload} /> : !res.data ? <Loading /> : (
        <div class="tblwrap"><table class="tbl"><thead><tr>{th('name', 'Player')}{th('level', 'Level', true)}{th('cash', 'Cash', true)}{th('bank', 'Bank', true)}{th('plots', 'Plots', true)}{th('spent', 'Spent (NGN)', true)}{th('lastSeen', 'Last seen')}<th>Status</th></tr></thead>
          <tbody>{res.data.rows.map((p) => (<tr key={p.id} class="click" onClick={() => go('players/' + p.id)}>
            <td><div class="row"><div class="avatar" style="width:30px;height:30px;font-size:12px">{initials(p.name)}</div><div><div style="font-weight:600">{p.name} {p.online && <span class="dot on" title="Online" />}</div><div class="dim mono" style="font-size:11.5px">{p.id}{p.reports > 0 ? ` | ${p.reports} report${p.reports > 1 ? 's' : ''}` : ''}</div></div></div></td>
            <td class="num">{p.level}</td><td class="num">{fmt.naira(p.cash)}</td><td class="num">{fmt.naira(p.bank)}</td><td class="num">{p.plots}</td><td class="num">{p.spent ? fmt.naira(p.spent) : <span class="dim">-</span>}</td>
            <td class="mut">{p.online ? 'online now' : fmt.ago(p.lastSeen)}</td><td><Badge kind={STATUS_BADGE[p.status][0]}>{STATUS_BADGE[p.status][1]}</Badge></td></tr>))}
            {res.data.rows.length === 0 && <tr><td colSpan={8} class="empty">No players match</td></tr>}</tbody></table></div>)}
      {total > PER && <div class="row"><Btn kind="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Btn><span class="mut">Page {page + 1} of {Math.ceil(total / PER)}</span><Btn kind="sm" disabled={(page + 1) * PER >= total} onClick={() => setPage(page + 1)}>Next</Btn></div>}
    </div>
  );
}

export function PlayerPage({ id }: { id: string }) {
  const can = useCan(); const [tab, setTab] = useState('overview'); const [dlg, setDlg] = useState<null | 'sanction' | 'unban' | 'economy' | 'reset' | 'kick'>(null); const [sk, setSk] = useState<SanctionKind>('ban');
  const res = useFetch<PlayerDetail>(() => api.get('/players/' + encodeURIComponent(id)), [id]);
  if (res.error) return <div class="col"><Btn kind="sm" icon="arrow" onClick={() => go('players')}>Back to players</Btn><ErrorBox e={res.error} retry={res.reload} /></div>;
  const p = res.data; if (!p) return <Loading />;
  const active = p.sanctions.filter((s) => !s.revokedAt && (s.expiresAt === null || s.expiresAt > Date.now()));
  const banned = active.some((s) => s.kind === 'ban'), susp = active.some((s) => s.kind === 'suspend'), muted = active.some((s) => s.kind === 'mute');
  const open = (k: SanctionKind) => { setSk(k); setDlg('sanction'); };
  const done = () => { setDlg(null); res.reload(); };
  return (
    <div class="col gap-lg">
      <div class="row"><a href="#/players" class="mut">&larr; All players</a></div>
      <div class="row wrap" style="gap:18px;align-items:flex-start">
        <div class="avatar" style="width:64px;height:64px;font-size:24px">{initials(p.name)}</div>
        <div class="grow"><div class="row wrap"><h1>{p.name}</h1>{p.online ? <Badge kind="good">online</Badge> : <Badge>offline</Badge>}{banned && <Badge kind="bad">banned</Badge>}{susp && <Badge kind="warn">suspended</Badge>}{muted && <Badge kind="pur">muted</Badge>}</div>
          <div class="mut mono" style="margin-top:2px">{p.id} | {p.email ?? 'no email'} | joined {fmt.day(p.createdAt)} | last seen {p.online ? 'now' : fmt.ago(p.lastSeen)}{p.ip ? ` | ${p.ip}` : ''}</div></div>
        <div class="row wrap">
          {p.x !== null && <Btn icon="pin" onClick={() => go(`map?x=${p.x}&z=${p.z}&player=${p.id}`)}>Show on map</Btn>}
          {can('players.moderate') && <>{p.online && <Btn icon="kick" onClick={() => setDlg('kick')}>Kick</Btn>}<Btn icon="mute" kind="warn" disabled={muted} onClick={() => open('mute')}>Mute</Btn><Btn icon="ban" kind="warn" disabled={susp || banned} onClick={() => open('suspend')}>Suspend</Btn>{active.length > 0 ? <Btn kind="pri" icon="check" onClick={() => setDlg('unban')}>Lift sanctions</Btn> : <Btn icon="ban" kind="danger" onClick={() => open('ban')}>Ban</Btn>}</>}
        </div>
      </div>
      {active.map((s) => <div key={s.id} class="callout bad row"><Icon n="ban" /><div class="grow"><b>{s.kind.toUpperCase()}</b> {fmt.until(s.expiresAt)}, since {fmt.date(s.createdAt)} by {s.issuedBy}. Reason: {s.reason}</div></div>)}
      <div class="grid g4"><Stat k="Cash" v={fmt.naira(p.cash)} /><Stat k="Bank" v={fmt.naira(p.bank)} /><Stat k="Level" v={p.level} s={`${fmt.n(p.xp)} xp`} tone="teal" /><Stat k="Lifetime spend" v={fmt.naira(p.purchases.filter((x) => x.status === 'paid' && x.currency === 'NGN').reduce((a, b) => a + b.amount, 0))} s={`${p.purchases.length} orders`} /></div>
      <Tabs cur={tab} on={setTab} tabs={[['overview', 'Overview'], ['items', 'Inventory and vehicles'], ['plots', `Plots (${p.plots.length})`], ['purchases', `Purchases (${p.purchases.length})`], ['safety', `Sanctions and reports (${p.sanctions.length + p.reports.length})`], ['body', 'Body and luck'], ['notes', `Notes (${p.notes.length})`]]} />
      {tab === 'overview' && <Overview p={p} can={can} openEco={() => setDlg('economy')} openReset={() => setDlg('reset')} />}
      {tab === 'items' && <ItemsTab p={p} />}
      {tab === 'plots' && <PlotsTab p={p} />}
      {tab === 'purchases' && <PurchaseTable rows={p.purchases} />}
      {tab === 'safety' && <SafetyTab p={p} />}
      {tab === 'notes' && <NotesTab p={p} reload={res.reload} />}
      {tab === 'body' && <BodyTab id={p.id} can={can} />}
      {dlg === 'sanction' && <SanctionDialog p={p} kind={sk} onClose={() => setDlg(null)} done={done} />}
      {dlg === 'unban' && <UnbanDialog p={p} active={active} onClose={() => setDlg(null)} done={done} />}
      {dlg === 'economy' && <EconomyDialog p={p} onClose={() => setDlg(null)} done={done} />}
      {dlg === 'reset' && <ResetDialog p={p} onClose={() => setDlg(null)} done={done} />}
      {dlg === 'kick' && <KickDialog p={p} onClose={() => setDlg(null)} done={done} />}
    </div>
  );
}

function Overview({ p, can, openEco, openReset }: { p: PlayerDetail; can: (x: any) => boolean; openEco: () => void; openReset: () => void }) {
  const skills = Object.entries(p.skills);
  return (
    <div class="grid g2">
      <Panel title="Account state">
        <dl class="kv"><dt>Position</dt><dd class="mono">{p.x !== null ? `${Math.round(p.x)}, ${Math.round(p.z!)}` : 'unknown'}</dd><dt>Device</dt><dd>{p.device ?? '-'}</dd><dt>IP</dt><dd class="mono">{p.ip ?? '-'}</dd><dt>Missions</dt><dd>{Object.entries((p.state.missions as Record<string, string>) ?? {}).map(([k, v]) => <Badge key={k} kind="teal">{k} {v}</Badge>)}{!p.state.missions && '-'}</dd></dl>
        <div class="row wrap">{can('players.economy') && <Btn icon="gift" onClick={openEco}>Grant or remove</Btn>}{can('players.reset') && <Btn kind="danger" icon="undo" onClick={openReset}>Reset</Btn>}</div>
      </Panel>
      <Panel title="Skills">
        {skills.length ? <div class="col gap-sm">{skills.map(([k, v]) => <div class="row" key={k}><span class="mono grow">{k}</span><span class="row gap-sm">{[1, 2, 3, 4, 5].map((i) => <span key={i} style={`width:14px;height:6px;border-radius:3px;background:${i <= v ? 'var(--teal)' : 'rgba(255,255,255,.1)'}`} />)}</span></div>)}</div> : <div class="dim">No skills learned</div>}
      </Panel>
    </div>
  );
}
function ItemsTab({ p }: { p: PlayerDetail }) {
  return (<div class="grid g2"><Panel title="Inventory" flush><table class="tbl"><thead><tr><th>Item</th><th class="num">Qty</th></tr></thead><tbody>{p.inventory.map((i) => <tr key={i.id}><td class="mono">{i.id}</td><td class="num">{i.qty}</td></tr>)}{!p.inventory.length && <tr><td colSpan={2} class="empty">Empty</td></tr>}</tbody></table></Panel>
    <Panel title="Vehicles" flush><table class="tbl"><thead><tr><th>Vehicle</th><th>Plate</th><th class="num">Value</th><th>Flags</th></tr></thead><tbody>{p.vehicles.map((v) => <tr key={v.id}><td><span style={`display:inline-block;width:10px;height:10px;border-radius:3px;background:${v.color ?? '#555'};margin-right:8px`} />{v.model}</td><td class="mono">{v.plate ?? '-'}</td><td class="num">{fmt.naira(v.value)}</td><td>{v.registered && <Badge kind="good">registered</Badge>} {v.stolen && <Badge kind="bad">stolen</Badge>}</td></tr>)}{!p.vehicles.length && <tr><td colSpan={4} class="empty">No vehicles</td></tr>}</tbody></table></Panel></div>);
}
function PlotsTab({ p }: { p: PlayerDetail }) {
  return (<div class="tblwrap"><table class="tbl"><thead><tr><th>Parcel</th><th>Zone</th><th class="num">Area m2</th><th class="num">Value</th><th>Flags</th><th /></tr></thead><tbody>{p.plots.map((pl) => <tr key={pl.id}><td class="mono">{pl.id}{pl.name ? ` (${pl.name})` : ''}</td><td>{pl.zone}</td><td class="num">{fmt.n(pl.area)}</td><td class="num">{fmt.naira(pl.price)}</td><td>{pl.flags.map((f) => <Badge key={f} kind="warn">{f}</Badge>)}</td><td class="right"><Btn kind="sm" icon="pin" onClick={() => go(`map?x=${pl.x}&z=${pl.z}&plot=${pl.id}`)}>On map</Btn></td></tr>)}{!p.plots.length && <tr><td colSpan={6} class="empty">Owns no parcels</td></tr>}</tbody></table></div>);
}
export function PurchaseTable({ rows }: { rows: PurchaseRow[] }) {
  return (<div class="tblwrap"><table class="tbl"><thead><tr><th>Order</th><th>Item</th><th class="num">Amount</th><th>Provider</th><th>Date</th><th>Status</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td class="mono">{r.id}</td><td>{r.itemName ?? r.itemId}{r.promo && <> <Badge kind="pur">{r.promo}</Badge></>}</td><td class="num">{fmt.money(r.amount, r.currency)}</td><td>{r.provider}</td><td class="mut">{fmt.date(r.createdAt)}</td><td><Badge kind={r.status === 'paid' ? 'good' : r.status === 'refunded' ? 'warn' : 'bad'}>{r.status}</Badge></td></tr>)}{!rows.length && <tr><td colSpan={6} class="empty">No purchases</td></tr>}</tbody></table></div>);
}
function SafetyTab({ p }: { p: PlayerDetail }) {
  return (<div class="grid g2"><Panel title="Sanction history" flush><table class="tbl"><thead><tr><th>Type</th><th>Reason</th><th>When</th><th>State</th></tr></thead><tbody>{p.sanctions.map((s: Sanction) => { const act = !s.revokedAt && (s.expiresAt === null || s.expiresAt > Date.now()); return <tr key={s.id}><td><Badge kind={s.kind === 'ban' ? 'bad' : s.kind === 'suspend' ? 'warn' : 'pur'}>{s.kind}</Badge></td><td>{s.reason}<div class="dim" style="font-size:11.5px">by {s.issuedBy}</div></td><td class="mut">{fmt.date(s.createdAt)}</td><td>{act ? <Badge kind="bad">active, {fmt.until(s.expiresAt)}</Badge> : s.revokedAt ? <span class="dim">lifted by {s.revokedBy}<br />{s.revokeReason}</span> : <span class="dim">expired</span>}</td></tr>; })}{!p.sanctions.length && <tr><td colSpan={4} class="empty">Clean record</td></tr>}</tbody></table></Panel>
    <Panel title="Reports against this player" flush><table class="tbl"><thead><tr><th>Message</th><th>From</th><th>Status</th></tr></thead><tbody>{p.reports.map((r: ChatReport) => <tr key={r.id}><td><div>{r.message}</div><div class="dim" style="font-size:11.5px">{r.channel} chat | {fmt.ago(r.createdAt)}</div></td><td>{r.reporterName ?? r.reporterId}</td><td><Badge kind={r.status === 'open' ? 'warn' : ''}>{r.status}</Badge></td></tr>)}{!p.reports.length && <tr><td colSpan={3} class="empty">No reports</td></tr>}</tbody></table></Panel></div>);
}
function NotesTab({ p, reload }: { p: PlayerDetail; reload: () => void }) {
  const [t, setT] = useState('');
  const add = async () => { try { await api.post(`/players/${p.id}/note`, { text: t }); setT(''); reload(); } catch (e) { toastErr(e); } };
  return (<div class="col" style="max-width:720px"><div class="row"><input class="input" placeholder="Internal note, visible to staff only" value={t} onInput={(e) => setT((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && t.trim().length > 1 && add()} /><Btn kind="pri" disabled={t.trim().length < 2} onClick={add}>Add note</Btn></div>
    {p.notes.map((n) => <div class="callout" key={n.id}><div>{n.text}</div><div class="dim" style="font-size:11.5px;margin-top:4px">{n.by} | {fmt.date(n.ts)}</div></div>)}{!p.notes.length && <div class="dim">No notes yet</div>}</div>);
}

const REASONS: Record<SanctionKind, string[]> = { ban: ['Cheating or exploiting a bug', 'Chargeback or payment fraud', 'Real-money trading or account selling', 'Hate speech or threats'], suspend: ['Harassment in chat', 'Griefing other players', 'Suspected exploit, under review'], mute: ['Spam in chat', 'Abusive language', 'Advertising outside the game'] };
const DURS: [string, number | null][] = [['1 hour', 60], ['24 hours', 1440], ['3 days', 4320], ['7 days', 10080], ['30 days', 43200], ['Permanent', null]];
export function SanctionDialog({ p, kind: k0, onClose, done }: { p: { id: string; name: string }; kind: SanctionKind; onClose: () => void; done: () => void }) {
  const [kind, setKind] = useState<SanctionKind>(k0); const [mins, setMins] = useState<number | null>(k0 === 'ban' ? null : k0 === 'mute' ? 1440 : 4320); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const pick = (kk: SanctionKind) => { setKind(kk); if (kk !== 'ban' && mins === null) setMins(1440); };
  const submit = async () => { setBusy(true); setErr(''); try { const r = await api.post(`/players/${p.id}/sanction`, { kind, reason, minutes: mins }); toast(`${p.name}: ${kind} applied${r.kicked ? ' and kicked from the game' : ''}`, 'good'); done(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return (
    <Modal title={`Sanction ${p.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind={kind === 'ban' ? 'danger' : 'warn'} disabled={busy || reason.trim().length < 5} onClick={submit}>{kind === 'ban' ? 'Ban player' : kind === 'suspend' ? 'Suspend player' : 'Mute player'}</Btn></>}>
      <Field label="Action"><div class="seg" style="align-self:flex-start">{([['ban', 'Ban'], ['suspend', 'Suspend'], ['mute', 'Mute']] as [SanctionKind, string][]).map(([k, l]) => <button key={k} class={kind === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>)}</div></Field>
      <div class="callout">{kind === 'ban' ? 'Banned players are removed from the game and cannot sign in until the ban is lifted or expires.' : kind === 'suspend' ? 'Suspended players are kicked now and blocked from signing in until the time is up.' : 'Muted players can keep playing but cannot send chat messages.'}</div>
      <Field label="Duration"><div class="row wrap">{DURS.filter(([, m]) => kind === 'ban' || m !== null).map(([l, m]) => <button key={l} class={'btn sm ' + (mins === m ? 'pri' : '')} onClick={() => setMins(m)}>{l}</button>)}</div></Field>
      <Field label="Reason" help="Shown to the player and saved in the audit log." err={err}><textarea class="input" value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} placeholder="What did they do?" autofocus /></Field>
      <div class="row wrap gap-sm">{REASONS[kind].map((r) => <button key={r} class="btn sm ghost" onClick={() => setReason(r)}>{r}</button>)}</div>
    </Modal>
  );
}
function UnbanDialog({ p, active, onClose, done }: { p: PlayerDetail; active: Sanction[]; onClose: () => void; done: () => void }) {
  const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const go2 = async () => { try { await api.post(`/players/${p.id}/unban`, { reason }); toast('Sanctions lifted', 'good'); done(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal title={`Lift sanctions on ${p.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="pri" disabled={reason.trim().length < 3} onClick={go2}>Lift {active.length} sanction{active.length > 1 ? 's' : ''}</Btn></>}>{active.map((s) => <div key={s.id} class="callout"><b>{s.kind}</b>: {s.reason}</div>)}<Field label="Why are you lifting it?" err={err}><input class="input" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} autofocus /></Field></Modal>;
}
function KickDialog({ p, onClose, done }: { p: PlayerDetail; onClose: () => void; done: () => void }) {
  const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const go2 = async () => { try { await api.post(`/players/${p.id}/kick`, { reason }); toast(`${p.name} kicked`, 'good'); done(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal title={`Kick ${p.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="warn" disabled={reason.trim().length < 3} onClick={go2}>Kick now</Btn></>}><div class="callout">They are disconnected immediately and can sign straight back in.</div><Field label="Message they see" err={err}><input class="input" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} autofocus /></Field></Modal>;
}
function EconomyDialog({ p, onClose, done }: { p: PlayerDetail; onClose: () => void; done: () => void }) {
  const [op, setOp] = useState<'grant' | 'remove'>('grant'); const [kind, setKind] = useState('cash'); const [amount, setAmount] = useState('100000'); const [itemId, setItemId] = useState(''); const [qty, setQty] = useState('1'); const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const go2 = async () => { try { await api.post(`/players/${p.id}/economy`, { op, kind, amount: Number(amount), itemId, qty: Number(qty), reason }); toast(`${op === 'grant' ? 'Granted' : 'Removed'} for ${p.name}`, 'good'); done(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <Modal title={`Grant or remove for ${p.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind={op === 'grant' ? 'pri' : 'danger'} disabled={reason.trim().length < 5} onClick={go2}>{op === 'grant' ? 'Grant' : 'Remove'}</Btn></>}>
      <div class="row"><div class="seg"><button class={op === 'grant' ? 'on' : ''} onClick={() => setOp('grant')}>Grant</button><button class={op === 'remove' ? 'on' : ''} onClick={() => setOp('remove')}>Remove</button></div>
        <select class="input" style="width:160px" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)}><option value="cash">Cash</option><option value="bank">Bank balance</option><option value="xp">XP</option><option value="item">Item</option></select></div>
      {kind === 'item' ? <div class="form"><Field label="Item id"><input class="input mono" placeholder="tool.spanner" value={itemId} onInput={(e) => setItemId((e.target as HTMLInputElement).value)} /></Field><Field label="Quantity"><input class="input" type="number" min="1" value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)} /></Field></div>
        : <Field label="Amount" help={`Current ${kind}: ${kind === 'xp' ? fmt.n(p.xp) : fmt.naira(kind === 'bank' ? p.bank : p.cash)}`}><input class="input" type="number" min="1" value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} /></Field>}
      <Field label="Reason" help="Required. Saved in the audit log." err={err}><input class="input" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} placeholder="Compensation for lost vehicle after crash bug" /></Field>
    </Modal>
  );
}
function ResetDialog({ p, onClose, done }: { p: PlayerDetail; onClose: () => void; done: () => void }) {
  const [scope, setScope] = useState('progress'); const [reason, setReason] = useState(''); const [conf, setConf] = useState(''); const [err, setErr] = useState('');
  const go2 = async () => { if (!(await confirm({ title: 'Reset this account?', danger: true, ok: 'Reset', body: <div>This cannot be undone. Scope: <b>{scope}</b></div> }))) return; try { await api.post(`/players/${p.id}/reset`, { scope, reason, confirm: conf }); toast('Reset done', 'good'); done(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <Modal title={`Reset ${p.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="danger" disabled={reason.trim().length < 5 || conf !== p.name} onClick={go2}>Reset</Btn></>}>
      <Field label="What to reset"><select class="input" value={scope} onChange={(e) => setScope((e.target as HTMLSelectElement).value)}><option value="progress">Progress (level, xp, skills, missions)</option><option value="cash">Cash and bank</option><option value="inventory">Inventory</option><option value="vehicles">Vehicles</option><option value="position">Position (back to Oshodi)</option><option value="full">Everything and release their plots (owner only)</option></select></Field>
      <Field label="Reason"><input class="input" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} /></Field>
      <Field label={`Type the player name (${p.name}) to confirm`} err={err}><input class="input" value={conf} onInput={(e) => setConf((e.target as HTMLInputElement).value)} /></Field>
    </Modal>
  );
}

/** the hidden side of a player: luck, karma, illnesses (including what they only carry), traits, hospital debt */
function BodyTab({ id, can }: { id: string; can: (x: any) => boolean }) {
  const b = useFetch<any>(() => api.get('/world/body/' + encodeURIComponent(id)), [id]); const [k, setK] = useState('');
  const post = async (body: unknown, msg: string) => { try { await api.post('/world/body/' + encodeURIComponent(id), body); toast(msg, 'good'); b.reload(); } catch (e) { toastErr(e); } };
  const d = b.data; if (!d) return <Loading />;
  const edit = can('players.economy');
  return (<div class="col gap">
    <div class="grid g4"><Stat k="Luck now" v={d.luck} s="hidden, -100 to 100" tone={d.luck >= 0 ? 'teal' : 'red'} /><Stat k="Karma" v={Math.round(d.karma)} s="good and bad deeds" /><Stat k="Hospital debt" v={fmt.naira(d.debt)} s={d.stripped ? 'sent out in underwear' : ''} /><Stat k="Deaths" v={d.deaths} /></div>
    <div class="grid g2">
      <Panel title="Illness" flush><table class="tbl"><thead><tr><th>Illness</th><th>State</th><th>Since</th></tr></thead><tbody>{d.ill.map((i: any) => <tr key={i.id}><td>{i.id}</td><td>{i.carrier ? <Badge kind="warn">carrier, no symptoms</Badge> : <Badge kind="bad">sick, level {i.sev}</Badge>}</td><td class="mut">{fmt.ago(i.at)}</td></tr>)}{!d.ill.length && <tr><td colSpan={3} class="empty">Healthy</td></tr>}</tbody></table>
        {edit && <div class="row gap wrap" style="padding:10px"><Btn kind="sm" onClick={() => post({ cure: true }, 'Cured')}>Cure all</Btn>{['flu', 'apollo', 'malaria'].map((x) => <Btn kind="sm" key={x} onClick={() => post({ infect: x }, `Gave ${x}`)}>Give {x}</Btn>)}<Btn kind="sm" onClick={() => post({ infect: 'flu', carrier: true }, 'Flu carrier')}>Flu carrier</Btn></div>}</Panel>
      <Panel title="Traits and karma">
        <div>{d.traits.length ? d.traits.map((t: string) => <Badge key={t} kind={d.fixed.includes(t) ? 'good' : ''}>{t}{d.fixed.includes(t) ? ' (fixed)' : ''}</Badge>) : <span class="mut">No negative traits</span>}</div>
        {edit && <div class="row gap" style="margin-top:10px"><input placeholder="Set karma" value={k} onInput={(e) => setK((e.target as HTMLInputElement).value)} /><Btn kind="sm" onClick={() => post({ karma: Number(k) }, 'Karma set')}>Set</Btn>{d.debt > 0 && <Btn kind="sm" onClick={() => post({ debt: 0 }, 'Debt cleared')}>Clear debt</Btn>}{d.stripped && <Btn kind="sm" onClick={() => post({ dress: true }, 'Clothes back')}>Give clothes back</Btn>}</div>}
        <table class="tbl" style="margin-top:10px"><tbody>{d.log.map((l: any, i: number) => <tr key={i}><td class="mut">{fmt.ago(l.at)}</td><td>{l.why}</td><td class="num">{l.delta > 0 ? '+' : ''}{Math.round(l.delta * 10) / 10}</td></tr>)}</tbody></table>
      </Panel>
    </div></div>);
}
