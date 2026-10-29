import { useState } from 'preact/hooks';
import { api, cfg, qs, saveConfig } from '../api';
import { session } from '../session';
import { Badge, Btn, ErrorBox, Field, Loading, Modal, Panel, Switch, errMsg, fmt, toast, toastErr, useDebounced, useFetch } from '../ui';
import { ROLES, ROLE_LABEL, ROLE_PERMS, type AdminUser, type AuditRow, type Role } from '@srv/types';

export function Audit() {
  const [actor, setActor] = useState(''); const [action, setAction] = useState(''); const [target, setTarget] = useState(''); const dA = useDebounced(actor), dT = useDebounced(target); const [open, setOpen] = useState<AuditRow | null>(null);
  const res = useFetch<{ rows: AuditRow[] }>(() => api.get('/audit' + qs({ actor: dA, action, target: dT, limit: 150 })), [dA, action, dT]);
  const kind = (a: string) => (a.startsWith('player.ban') || a.includes('suspend') || a.includes('reset') || a.includes('refund') || a.includes('rollback') ? 'bad' : a.includes('login_failed') ? 'warn' : a.startsWith('content') || a.startsWith('flag') || a.startsWith('maintenance') ? 'pur' : 'teal');
  return (
    <div class="col gap-lg">
      <div class="pageh"><div><h1>Audit log</h1><div class="sub">Every change made in this panel, who made it and from where. Entries cannot be edited or deleted here.</div></div></div>
      <div class="row wrap"><input class="input" style="width:220px" placeholder="Staff email" value={actor} onInput={(e) => setActor((e.target as HTMLInputElement).value)} /><select class="input" style="width:200px" value={action} onChange={(e) => setAction((e.target as HTMLSelectElement).value)}><option value="">All actions</option>{['auth', 'player', 'content', 'plot', 'poi', 'purchase', 'flag', 'announce', 'maintenance', 'staff', 'report'].map((a) => <option key={a} value={a}>{a}</option>)}</select><input class="input" style="width:260px" placeholder="Search target or summary" value={target} onInput={(e) => setTarget((e.target as HTMLInputElement).value)} /></div>
      {res.error ? <ErrorBox e={res.error} retry={res.reload} /> : !res.data ? <Loading /> : <div class="tblwrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>What happened</th><th>IP</th></tr></thead><tbody>
        {res.data.rows.map((r) => <tr key={r.id} class="click" onClick={() => setOpen(r)}><td class="mut nowrap">{fmt.date(r.ts)}</td><td>{r.actorEmail}<div class="dim" style="font-size:11.5px">{r.actorRole}</div></td><td><Badge kind={kind(r.action)}>{r.action}</Badge></td><td style="max-width:520px">{r.summary}</td><td class="mono dim">{r.ip}</td></tr>)}
        {!res.data.rows.length && <tr><td colSpan={5} class="empty">No entries</td></tr>}</tbody></table></div>}
      {open && <Modal wide title={`${open.action} #${open.id}`} onClose={() => setOpen(null)}><div class="callout">{open.summary}</div><div class="grid g2"><div><h3>Before</h3><pre class="mono panel" style="padding:10px;overflow:auto;max-height:320px;margin:6px 0 0">{open.before ? JSON.stringify(open.before, null, 2) : 'none'}</pre></div><div><h3>After</h3><pre class="mono panel" style="padding:10px;overflow:auto;max-height:320px;margin:6px 0 0">{open.after ? JSON.stringify(open.after, null, 2) : 'none'}</pre></div></div></Modal>}
    </div>
  );
}

export function Staff() {
  const res = useFetch<{ users: AdminUser[] }>(() => api.get('/staff')); const [add, setAdd] = useState(false); const [pw, setPw] = useState<AdminUser | null>(null); const me = session.get().user;
  const patch = async (u: AdminUser, p: object) => { try { await api.patch('/staff/' + u.id, p); res.reload(); } catch (e) { toastErr(e); } };
  return (
    <div class="col gap-lg">
      <div class="pageh"><div><h1>Staff</h1><div class="sub">Who can sign in to this panel, and what each role may do.</div></div><div class="grow" /><Btn kind="pri" icon="plus" onClick={() => setAdd(true)}>Add staff</Btn></div>
      {res.error ? <ErrorBox e={res.error} retry={res.reload} /> : !res.data ? <Loading /> : <div class="tblwrap"><table class="tbl"><thead><tr><th>Name</th><th>Role</th><th>Last sign in</th><th>Active</th><th /></tr></thead><tbody>{res.data.users.map((u) => (<tr key={u.id}><td><b>{u.name}</b>{u.id === me?.id && <> <Badge kind="teal">you</Badge></>}<div class="dim">{u.email}</div></td>
        <td><select class="input sm" style="width:170px" value={u.role} disabled={u.id === me?.id} onChange={(e) => patch(u, { role: (e.target as HTMLSelectElement).value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td><td class="mut">{fmt.ago(u.lastLogin)}</td><td><Switch on={!u.disabled} disabled={u.id === me?.id} onChange={(v) => patch(u, { disabled: !v })} /></td><td class="right"><Btn kind="sm" onClick={() => setPw(u)}>Reset password</Btn></td></tr>))}</tbody></table></div>}
      <Panel title="What each role can do" flush><table class="tbl"><thead><tr><th>Permission</th>{ROLES.map((r) => <th key={r} class="num">{ROLE_LABEL[r]}</th>)}</tr></thead><tbody>{Array.from(new Set(Object.values(ROLE_PERMS).flat())).map((p) => <tr key={p}><td class="mono">{p}</td>{ROLES.map((r) => <td key={r} class="num">{ROLE_PERMS[r].includes(p) ? <span style="color:var(--teal)">&#10003;</span> : <span class="dim">-</span>}</td>)}</tr>)}</tbody></table></Panel>
      {add && <AddStaff onClose={() => setAdd(false)} done={() => { setAdd(false); res.reload(); }} />}
      {pw && <ResetPw u={pw} onClose={() => setPw(null)} />}
    </div>
  );
}
function AddStaff({ onClose, done }: { onClose: () => void; done: () => void }) {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [role, setRole] = useState<Role>('moderator'); const [password, setPassword] = useState(''); const [err, setErr] = useState('');
  const go = async () => { try { await api.post('/staff', { email, name, role, password }); toast('Staff added. They must change the password at first sign in.', 'good'); done(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal title="Add staff" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="pri" disabled={!email || !name || !password} onClick={go}>Create</Btn></>}><Field label="Name"><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autofocus /></Field><Field label="Email"><input class="input" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></Field><Field label="Role"><select class="input" value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field><Field label="Temporary password" help="At least 10 characters with a number." err={err}><input class="input mono" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} /></Field></Modal>;
}
function ResetPw({ u, onClose }: { u: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState(''); const [err, setErr] = useState('');
  const go = async () => { try { await api.post(`/staff/${u.id}/password`, { password }); toast('Password reset, all their sessions ended', 'good'); onClose(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal title={`Reset password for ${u.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="pri" disabled={!password} onClick={go}>Reset</Btn></>}><Field label="New temporary password" err={err}><input class="input mono" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} autofocus /></Field></Modal>;
}

export function Settings() {
  const [srv, setSrv] = useState(cfg.serverUrl); const [world, setWorld] = useState(cfg.worldUrl); const [cur, setCur] = useState(''); const [next, setNext] = useState('');
  const changePw = async () => { try { const r = await api.post('/auth/password', { current: cur, next }); (await import('../api')).token.set(r.token); toast('Password changed', 'good'); setCur(''); setNext(''); } catch (e) { toastErr(e); } };
  return (
    <div class="col gap-lg" style="max-width:720px">
      <div class="pageh"><div><h1>Settings</h1></div></div>
      <Panel title="Connection"><div class="col"><Field label="Game server URL" help="Where /api/admin lives. Empty means the same host that serves this page."><input class="input mono" value={srv} placeholder="https://api.example.com" onInput={(e) => setSrv((e.target as HTMLInputElement).value)} /></Field>
        <Field label="World data URL" help="Folder holding the game's manifest.json and world packs (the game's /world/ folder). Used by the 3D map for close-up detail."><input class="input mono" value={world} onInput={(e) => setWorld((e.target as HTMLInputElement).value)} /></Field>
        <div class="row"><Btn kind="pri" onClick={() => { saveConfig(srv, world); toast('Saved. Reloading.'); setTimeout(() => location.reload(), 400); }}>Save and reload</Btn><span class="dim">Stored in this browser. For a hosted build, edit config.json next to index.html instead.</span></div></div></Panel>
      <Panel title="Your password"><div class="col"><Field label="Current password"><input class="input" type="password" value={cur} onInput={(e) => setCur((e.target as HTMLInputElement).value)} /></Field><Field label="New password" help="At least 10 characters with a number."><input class="input" type="password" value={next} onInput={(e) => setNext((e.target as HTMLInputElement).value)} /></Field><div><Btn kind="pri" disabled={!cur || !next} onClick={changePw}>Change password</Btn></div></div></Panel>
    </div>
  );
}
