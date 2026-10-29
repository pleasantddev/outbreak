import { useState } from 'preact/hooks';
import { api } from '../api';
import { AreaChart } from '../charts';
import { useCan } from '../session';
import { Badge, Btn, Field, Loading, Modal, Panel, Stat, Switch, confirm, errMsg, fmt, toast, toastErr, useFetch, useInterval } from '../ui';
import type { Announcement, Flag, Maintenance, OpsStatus } from '@srv/types';

export function LiveOps() {
  const can = useCan();
  const st = useFetch<OpsStatus>(() => api.get('/ops/status')); const ser = useFetch<{ series: { ts: number; online: number }[] }>(() => api.get('/ops/series'));
  const fl = useFetch<{ flags: Flag[] }>(() => api.get('/ops/flags')); const an = useFetch<{ rows: Announcement[] }>(() => api.get('/ops/announcements'));
  useInterval(() => { st.reload(); ser.reload(); }, 15000);
  const s = st.data; if (!s) return <Loading />;
  const pts = (ser.data?.series ?? []).filter((_, i, a) => a.length < 120 || i % Math.ceil(a.length / 120) === 0);
  return (
    <div class="col gap-lg">
      <div class="grid g4">
        <Stat k="Online now" v={s.online} s={`${s.connections} connections`} tone="teal" />
        <Stat k="Peak, 24 hours" v={s.peak24h} s={`${fmt.n(s.accounts)} accounts total`} />
        <Stat k="Uptime" v={fmt.dur(s.uptimeSec)} s={`v${s.version}`} />
        <Stat k="Revenue, 30 days" v={fmt.naira(s.revenue30d.NGN)} s={`plus ${fmt.usd(s.revenue30d.USD)} in USD`} />
      </div>
      <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
        <div class="col gap-lg">
          <Panel title="Players online, last 24 hours" actions={<span class="mut" style="font-size:12px">server tick {s.tickMs} ms | memory {s.memoryMb} MB | db {s.dbMb} MB</span>}>
            {pts.length > 1 ? <AreaChart labels={pts.map((p) => new Date(p.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))} series={[{ name: 'Online', data: pts.map((p) => p.online) }]} /> : <div class="empty">Collecting data. A point is stored every minute.</div>}
          </Panel>
          <FlagsPanel flags={fl.data?.flags ?? []} reload={fl.reload} edit={can('liveops.edit')} />
        </div>
        <div class="col gap-lg">
          <MaintenancePanel m={s.maintenance} reload={st.reload} edit={can('maintenance.toggle')} />
          <AnnouncePanel rows={an.data?.rows ?? []} reload={an.reload} edit={can('liveops.edit')} />
        </div>
      </div>
    </div>
  );
}

function MaintenancePanel({ m, reload, edit }: { m: Maintenance; reload: () => void; edit: boolean }) {
  const [msg, setMsg] = useState(m.message || 'HustleLife is getting an update. Back in about 20 minutes.'); const [staff, setStaff] = useState(m.allowStaff);
  const toggle = async (on: boolean) => {
    if (on && !(await confirm({ title: 'Turn maintenance mode on?', danger: true, ok: 'Turn on', body: <div class="col"><div>New logins are blocked and players see this message:</div><div class="callout">{msg}</div></div> }))) return;
    try { await api.put('/ops/maintenance', { enabled: on, message: msg, allowStaff: staff }); toast(on ? 'Maintenance is ON' : 'Maintenance is off', on ? '' : 'good'); reload(); } catch (e) { toastErr(e); }
  };
  return (
    <Panel title="Maintenance mode" actions={<Badge kind={m.enabled ? 'bad' : 'good'}>{m.enabled ? 'ON' : 'off'}</Badge>}>
      <div class="col">
        <Field label="Message players see"><textarea class="input" value={msg} disabled={!edit} onInput={(e) => setMsg((e.target as HTMLTextAreaElement).value)} /></Field>
        <div class="row"><Switch on={staff} onChange={setStaff} disabled={!edit} /><span>Let staff accounts still sign in</span></div>
        <div class="row"><Btn kind={m.enabled ? 'pri' : 'danger'} disabled={!edit} onClick={() => toggle(!m.enabled)}>{m.enabled ? 'Turn maintenance off' : 'Turn maintenance on'}</Btn>{!edit && <span class="dim">Needs the maintenance permission</span>}</div>
      </div>
    </Panel>
  );
}

function AnnouncePanel({ rows, reload, edit }: { rows: Announcement[]; reload: () => void; edit: boolean }) {
  const [message, setMessage] = useState(''); const [kind, setKind] = useState('info'); const [minutes, setMinutes] = useState('30'); const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); try { const r = await api.post('/ops/announce', { message, kind, minutes: Number(minutes) || null }); toast(`Sent to ${r.delivered} online players`, 'good'); setMessage(''); reload(); } catch (e) { toastErr(e); } finally { setBusy(false); } };
  return (
    <Panel title="Broadcast to players">
      <div class="col">
        <Field label="Message" help={`${message.length}/280. Shows as a banner in game and on the title screen until it expires.`}><textarea class="input" maxLength={280} placeholder="Double XP weekend starts tonight at 8pm. Dey your zone!" value={message} disabled={!edit} onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)} /></Field>
        <div class="row"><Field label="Style"><select class="input" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)}><option value="info">Info</option><option value="warn">Warning</option><option value="event">Event</option></select></Field><Field label="Show for (minutes)"><input class="input" type="number" min="1" max="1440" value={minutes} onInput={(e) => setMinutes((e.target as HTMLInputElement).value)} /></Field></div>
        <Btn kind="pri" icon="bell" disabled={!edit || busy || message.trim().length < 3} onClick={send}>Send announcement</Btn>
      </div>
      {rows.length > 0 && <div class="col gap-sm" style="margin-top:16px;max-height:200px;overflow:auto">{rows.slice(0, 8).map((a) => (<div key={a.id} class="callout" style="padding:7px 10px"><div class="row"><Badge kind={a.kind === 'warn' ? 'warn' : a.kind === 'event' ? 'pur' : 'teal'}>{a.kind}</Badge><span class="dim" style="font-size:11.5px">{fmt.ago(a.ts)} by {a.by}</span></div><div style="margin-top:4px">{a.message}</div></div>))}</div>}
    </Panel>
  );
}

function FlagsPanel({ flags, reload, edit }: { flags: Flag[]; reload: () => void; edit: boolean }) {
  const [adding, setAdding] = useState(false);
  const save = async (f: Partial<Flag> & { key: string }) => { try { await api.put('/ops/flags/' + f.key, f); reload(); } catch (e) { toastErr(e); } };
  return (
    <Panel title="Feature flags" actions={edit && <Btn kind="sm" icon="plus" onClick={() => setAdding(true)}>New flag</Btn>} flush>
      <table class="tbl"><thead><tr><th>Flag</th><th>Audience</th><th style="width:210px">Rollout</th><th>Updated</th><th style="width:60px">On</th></tr></thead>
        <tbody>{flags.map((f) => (<tr key={f.key}><td><div class="mono">{f.key}</div><div class="dim" style="font-size:12px">{f.description}</div></td>
          <td><select class="input sm" value={f.audience} disabled={!edit} onChange={(e) => save({ key: f.key, audience: (e.target as HTMLSelectElement).value as Flag['audience'] })}><option value="all">Everyone</option><option value="staff">Staff only</option><option value="beta">Beta testers</option></select></td>
          <td><div class="row"><input type="range" min="0" max="100" step="5" value={f.rollout} disabled={!edit} style="flex:1;accent-color:var(--teal)" onChange={(e) => save({ key: f.key, rollout: Number((e.target as HTMLInputElement).value) })} /><span class="mono" style="width:38px;text-align:right">{f.rollout}%</span></div></td>
          <td class="dim" style="font-size:12px">{fmt.ago(f.updatedAt)}<br />{f.updatedBy.split('@')[0]}</td>
          <td><Switch on={f.enabled} disabled={!edit} onChange={(v) => save({ key: f.key, enabled: v })} /></td></tr>))}
          {flags.length === 0 && <tr><td colSpan={5} class="empty">No flags yet</td></tr>}</tbody></table>
      {adding && <NewFlag onClose={() => setAdding(false)} done={() => { setAdding(false); reload(); }} />}
    </Panel>
  );
}
function NewFlag({ onClose, done }: { onClose: () => void; done: () => void }) {
  const [key, setKey] = useState(''); const [desc, setDesc] = useState(''); const [err, setErr] = useState('');
  const go = async () => { try { await api.put('/ops/flags/' + key, { enabled: false, rollout: 100, description: desc }); done(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal title="New feature flag" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="pri" disabled={!key} onClick={go}>Create (off)</Btn></>}><Field label="Key" help="lowercase, for example events.flood" err={err}><input class="input mono" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} autofocus /></Field><Field label="What it controls"><input class="input" value={desc} onInput={(e) => setDesc((e.target as HTMLInputElement).value)} /></Field></Modal>;
}
