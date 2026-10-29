import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { api, cfg, loadConfig, saveConfig } from './api';
import { Boundary, Btn, ConfirmHost, Field, Icon, Loading, Toasts, errMsg, fmt, initials, toast, useFetch, useInterval } from './ui';
import { adopt, go, logout, restore, useRoute, useSession } from './session';
import { can, ROLE_LABEL, type OpsStatus, type Perm } from '@srv/types';
import { LiveOps } from './pages/LiveOps';
import { MapPage } from './pages/MapPage';
import { Players, PlayerPage } from './pages/Players';
import { Reports } from './pages/Reports';
import { Economy } from './pages/Economy';
import { Store } from './pages/Store';
import { ContentPage } from './pages/Content';
import { Audit, Staff, Settings } from './pages/System';

const NAV: { grp: string; items: { to: string; label: string; icon: string; perm: Perm; badge?: 'reports' }[] }[] = [
  { grp: 'Operate', items: [{ to: 'ops', label: 'Live ops', icon: 'pulse', perm: 'liveops.view' }, { to: 'map', label: '3D map', icon: 'map', perm: 'map.view' }] },
  { grp: 'Players', items: [{ to: 'players', label: 'Players', icon: 'users', perm: 'players.view' }, { to: 'reports', label: 'Chat reports', icon: 'flag', perm: 'reports.view', badge: 'reports' }] },
  { grp: 'Money', items: [{ to: 'economy', label: 'Economy', icon: 'coin', perm: 'economy.view' }, { to: 'store', label: 'Store and IAP', icon: 'bag', perm: 'store.view' }] },
  { grp: 'Game script', items: [{ to: 'content/missions', label: 'Missions', icon: 'graph', perm: 'content.view' }, { to: 'content/events', label: 'Events', icon: 'cal', perm: 'content.view' }, { to: 'content/routes', label: 'Routes', icon: 'route', perm: 'content.view' }, { to: 'content/skills', label: 'Skills', icon: 'tree', perm: 'content.view' }, { to: 'content/npcs', label: 'NPCs and factions', icon: 'users', perm: 'content.view' }, { to: 'content/shops', label: 'Shops', icon: 'bag', perm: 'content.view' }] },
  { grp: 'System', items: [{ to: 'audit', label: 'Audit log', icon: 'log', perm: 'audit.view' }, { to: 'staff', label: 'Staff', icon: 'shield', perm: 'staff.manage' }, { to: 'settings', label: 'Settings', icon: 'tool', perm: 'map.view' }] },
];
const TITLES: Record<string, string> = { ops: 'Live ops', map: 'Lagos map', players: 'Players', reports: 'Chat reports', economy: 'Economy', store: 'Store and IAP', content: 'Game script', audit: 'Audit log', staff: 'Staff', settings: 'Settings' };

function Shell() {
  const { user } = useSession(); const r = useRoute(); const page = r.parts[0] ?? 'ops';
  const st = useFetch<OpsStatus | null>(() => (can(user!.role, 'liveops.view') ? api.get('/ops/status') : Promise.resolve(null)), []);
  useInterval(st.reload, 20000);
  const s = st.data;
  useEffect(() => { document.title = `${TITLES[page] ?? 'Admin'} | HustleLife Admin`; }, [page]);
  const onPage = (to: string) => (to.includes('/') ? r.parts.join('/').startsWith(to) : r.parts[0] === to);
  let view;
  switch (page) {
    case 'ops': view = <LiveOps />; break;
    case 'map': view = <MapPage focus={r.query} />; break;
    case 'players': view = r.parts[1] ? <PlayerPage id={r.parts[1]} /> : <Players />; break;
    case 'reports': view = <Reports />; break;
    case 'economy': view = <Economy />; break;
    case 'store': view = <Store tab={r.parts[1] ?? 'items'} />; break;
    case 'content': view = <ContentPage kind={r.parts[1] ?? 'missions'} id={r.parts[2]} />; break;
    case 'audit': view = <Audit />; break;
    case 'staff': view = <Staff />; break;
    case 'settings': view = <Settings />; break;
    default: view = <LiveOps />;
  }
  return (
    <div class="shell">
      <aside class="side">
        <div class="brand"><div class="logo">H</div><span>HUSTLELIFE<small>Admin</small></span></div>
        <nav class="nav">
          {NAV.map((g) => { const items = g.items.filter((i) => can(user!.role, i.perm)); return items.length ? (<div key={g.grp}><div class="grp">{g.grp}</div>{items.map((i) => (<a key={i.to} href={'#/' + i.to} class={onPage(i.to) ? 'on' : ''}><Icon n={i.icon} /><span>{i.label}</span>{i.badge === 'reports' && s && s.openReports > 0 && <b class="cnt alert">{s.openReports}</b>}</a>))}</div>) : null; })}
        </nav>
        <div class="me"><div class="avatar">{initials(user!.name)}</div><div class="grow"><div style="font-weight:600;line-height:1.2">{user!.name}</div><div class="dim" style="font-size:11.5px">{ROLE_LABEL[user!.role]}</div></div><Btn kind="ghost sm icon" icon="out" title="Sign out" onClick={logout} /></div>
      </aside>
      <div class="main">
        <header class="top">
          <div class="title">{TITLES[page] ?? 'Admin'}</div><div class="grow" />
          {s?.maintenance.enabled && <span class="env mnt">MAINTENANCE ON</span>}
          {s?.simulated && <span class="env sim" title="This server is the local stand-in with demo data">DEMO DATA</span>}
          {s && <span class="env"><span class={'dot ' + (s.online > 0 ? 'on' : '')} /> {s.online} online</span>}
          <span class="env mono" title="Server URL">{cfg.serverUrl || location.host}</span>
        </header>
        <Boundary key={r.parts.join('/')}><div class={'page' + (page === 'map' ? ' flush' : '')} style={page === 'content' ? 'display:flex;flex-direction:column' : ''}>{view}</div></Boundary>
      </div>
    </div>
  );
}

function Login({ needsSeed, onBack }: { needsSeed: boolean; onBack: () => void }) {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [name, setName] = useState(''); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [srv, setSrv] = useState(cfg.serverUrl); const [adv, setAdv] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { saveConfig(srv, cfg.worldUrl); const r = needsSeed ? await api.post('/auth/seed', { setupCode: code, email, name, password: pw }) : await api.post('/auth/login', { email, password: pw }); adopt(r); toast(needsSeed ? 'Owner account created' : 'Welcome back, ' + r.user.name, 'good'); if (!location.hash) go('ops'); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <div class="login"><form class="panel card" onSubmit={submit}>
      <div class="logo">H</div>
      <h1>{needsSeed ? 'Create the owner' : 'Admin sign in'}</h1>
      <div class="sub">{needsSeed ? 'First run. The setup code is printed in the server log.' : 'HustleLife control room. Every change you make is logged.'}</div>
      <div class="col">
        {needsSeed && <Field label="Your name"><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} required /></Field>}
        <Field label="Email"><input class="input" type="email" autocomplete="username" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} required autofocus /></Field>
        <Field label="Password" help={needsSeed ? 'At least 10 characters with a number.' : undefined}><input class="input" type="password" autocomplete={needsSeed ? 'new-password' : 'current-password'} value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} required /></Field>
        {needsSeed && <Field label="Setup code"><input class="input mono" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} required /></Field>}
        {adv && <Field label="Server URL" help="Leave empty when the admin is served by the game server."><input class="input mono" placeholder="https://api.hustlelife.example" value={srv} onInput={(e) => setSrv((e.target as HTMLInputElement).value)} /></Field>}
        {err && <div class="callout bad">{err}</div>}
        <Btn kind="pri" type="submit" disabled={busy} style="height:40px;justify-content:center">{busy ? 'Working...' : needsSeed ? 'Create owner and sign in' : 'Sign in'}</Btn>
        <div class="row"><button type="button" class="btn ghost sm" onClick={() => setAdv(!adv)}>{adv ? 'Hide' : 'Server settings'}</button><div class="grow" />{err.startsWith('Cannot reach') && <button type="button" class="btn ghost sm" onClick={onBack}><Icon n="refresh" s={14} /> Retry</button>}</div>
      </div>
    </form></div>
  );
}

function App() {
  const s = useSession(); const [boot, setBoot] = useState<{ needsSeed: boolean } | null | 'err'>(null);
  const check = () => { setBoot(null); api.get('/health').then((h) => setBoot({ needsSeed: h.needsSeed })).catch(() => setBoot({ needsSeed: false })); };
  useEffect(() => { loadConfig().then(() => restore()).then(check); }, []);
  if (!s.ready || boot === null) return <div class="login"><Loading /></div>;
  return <><Boundary>{s.user ? <Shell /> : <Login needsSeed={(boot as any).needsSeed} onBack={check} />}</Boundary><Toasts /><ConfirmHost /></>;
}
render(<App />, document.getElementById('app')!);
void fmt;
