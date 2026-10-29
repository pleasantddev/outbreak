import { Component, type ComponentChildren, type JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiError } from './api';

const P: Record<string, string> = {
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14', users: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 20c0-3.5 3.6-6 8-6s8 2.5 8 6', coin: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9 10c0-1.5 1.3-2 3-2s3 .7 3 2-1.3 1.6-3 2-3 .6-3 2 1.3 2 3 2 3-.5 3-2', bag: 'M5 8h14l-1 12H6zM9 8a3 3 0 016 0', doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6', pulse: 'M3 12h4l3-8 4 16 3-8h4', log: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', out: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9', search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18', check: 'M5 12l5 5 9-10', dup: 'M8 8h11v11H8zM5 16V5h11', trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13', save: 'M5 4h12l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6', undo: 'M9 7L4 12l5 5M4 12h10a6 6 0 010 8', hist: 'M4 12a8 8 0 108-8 8 8 0 00-6 3M4 4v4h4M12 8v4l3 2', ban: 'M12 3a9 9 0 100 18 9 9 0 000-18zM6 6l12 12', gift: 'M4 10h16v10H4zM2 7h20v3H2zM12 7v13M12 7c-3 0-5-1-4-3s4 0 4 3zM12 7c3 0 5-1 4-3s-4 0-4 3z', kick: 'M5 4h8v16H5zM13 12h8M18 9l3 3-3 3', mute: 'M11 5L6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6', flag: 'M5 21V4M5 4h12l-2 4 2 4H5', bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4', tool: 'M14 6a4 4 0 005 5l-9 9-3-3 9-9a4 4 0 00-2-2z', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z', route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h6a4 4 0 000-8H10a3 3 0 010-6h6', graph: 'M6 5h5v4H6zM13 15h5v4h-5zM6 15h5v4H6zM8.5 9v6M11 17h2M16 15V9h-5', tree: 'M12 3v6M12 9H6v5M12 9h6v5M6 14v6M18 14v6', cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', code: 'M9 7l-5 5 5 5M15 7l5 5-5 5', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z', down: 'M12 4v12M7 11l5 5 5-5M5 20h14', up: 'M12 20V8M7 13l5-5 5 5M5 4h14', arrow: 'M5 12h14M13 6l6 6-6 6', pin: 'M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12zM12 11a2 2 0 100-4 2 2 0 000 4z', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3', refresh: 'M20 12a8 8 0 11-3-6.2M20 4v5h-5',
};
export const Icon = ({ n, s = 18 }: { n: keyof typeof P | string; s?: number }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d={P[n] ?? P.doc} /></svg>);

export const fmt = {
  n: (v: number | null | undefined) => (v === null || v === undefined ? '-' : Math.round(v).toLocaleString('en-NG')),
  naira: (v: number | null | undefined) => (v === null || v === undefined ? '-' : '₦' + Math.round(v).toLocaleString('en-NG')),
  usd: (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  money: (v: number, c: string) => (c === 'USD' ? fmt.usd(v) : fmt.naira(v)),
  date: (t: number | null | undefined) => (t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'),
  day: (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'),
  ago: (t: number | null | undefined) => { if (!t) return 'never'; const s = Math.max(0, (Date.now() - t) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago'; return fmt.day(t); },
  dur: (sec: number) => { const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; },
  until: (t: number | null) => (t === null ? 'permanent' : t < Date.now() ? 'expired' : 'in ' + fmt.dur((t - Date.now()) / 1000)),
};
export const initials = (n: string) => n.split(/[\s._]+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?';

// ---- toasts
type T = { id: number; msg: string; kind: 'good' | 'bad' | '' };
let toasts: T[] = []; let tid = 0; const tl = new Set<() => void>();
export function toast(msg: string, kind: T['kind'] = '') { const id = ++tid; toasts = [...toasts, { id, msg, kind }]; tl.forEach((f) => f()); setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); tl.forEach((f) => f()); }, kind === 'bad' ? 6500 : 3200); }
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
export const toastErr = (e: unknown) => toast(errMsg(e), 'bad');
export function Toasts() { const [, set] = useState(0); useEffect(() => { const f = () => set((x) => x + 1); tl.add(f); return () => void tl.delete(f); }, []); return <div class="toasts">{toasts.map((t) => <div key={t.id} class={'toast ' + t.kind}>{t.msg}</div>)}</div>; }

// ---- basics
export const Btn = ({ kind = '', icon, children, ...r }: { kind?: string; icon?: string; children?: ComponentChildren } & JSX.HTMLAttributes<HTMLButtonElement>) => (<button {...(r as any)} class={'btn ' + kind + ' ' + ((r as any).class ?? '')}>{icon && <Icon n={icon} s={15} />}{children}</button>);
export const Badge = ({ kind = '', children }: { kind?: string; children?: ComponentChildren }) => <span class={'badge ' + kind}>{children}</span>;
export const Panel = ({ title, actions, children, class: c = '', flush }: { title?: ComponentChildren; actions?: ComponentChildren; children?: ComponentChildren; class?: string; flush?: boolean }) => (<section class={'panel ' + c}>{(title || actions) && <div class="hd"><h2>{title}</h2><div class="grow" />{actions}</div>}<div class={flush ? '' : 'bd'}>{children}</div></section>);
export const Stat = ({ k, v, s, tone }: { k: string; v: ComponentChildren; s?: ComponentChildren; tone?: string }) => (<div class="panel stat"><div class="k">{k}</div><div class="v" style={tone ? `color:var(--${tone})` : ''}>{v}</div>{s && <div class="s">{s}</div>}</div>);
export const Field = ({ label, help, err, children, class: c = '' }: { label?: string; help?: string; err?: string | null; children?: ComponentChildren; class?: string }) => (<div class={'field ' + c}>{label && <label>{label}</label>}{children}{err ? <div class="err">{err}</div> : help ? <div class="help">{help}</div> : null}</div>);
export const Switch = ({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (<label class="switch"><input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} /><i /></label>);
export const Tabs = ({ tabs, cur, on }: { tabs: [string, string][]; cur: string; on: (k: string) => void }) => (<div class="tabs">{tabs.map(([k, l]) => <button key={k} class={cur === k ? 'on' : ''} onClick={() => on(k)}>{l}</button>)}</div>);
export const Seg = ({ opts, cur, on }: { opts: [string, string][]; cur: string; on: (k: string) => void }) => (<div class="seg">{opts.map(([k, l]) => <button key={k} class={cur === k ? 'on' : ''} onClick={() => on(k)}>{l}</button>)}</div>);
export const Spinner = () => <span class="spin" />;
export const Loading = () => <div class="empty"><Spinner /></div>;
export const ErrorBox = ({ e, retry }: { e: unknown; retry?: () => void }) => (<div class="callout bad row"><span class="grow">{errMsg(e)}</span>{retry && <Btn kind="sm" onClick={retry}>Retry</Btn>}</div>);

export function Modal({ title, onClose, children, footer, wide }: { title: ComponentChildren; onClose: () => void; children?: ComponentChildren; footer?: ComponentChildren; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (<div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div class={'modal ' + (wide ? 'wide' : '')} role="dialog" aria-modal="true"><div class="hd"><h2 class="grow">{title}</h2><Btn kind="ghost sm icon" icon="x" onClick={onClose} aria-label="Close" /></div><div class="bd">{children}</div>{footer && <div class="ft">{footer}</div>}</div></div>);
}
/** Confirm dialog; resolves true/false. Optionally needs a typed phrase. */
let confirmHost: ((o: ConfirmOpts) => Promise<boolean>) | null = null;
interface ConfirmOpts { title: string; body?: ComponentChildren; ok?: string; danger?: boolean; type?: string }
export const confirm = (o: ConfirmOpts) => (confirmHost ? confirmHost(o) : Promise.resolve(window.confirm(o.title)));
export function ConfirmHost() {
  const [s, set] = useState<{ o: ConfirmOpts; res: (v: boolean) => void } | null>(null); const [typed, setTyped] = useState('');
  useEffect(() => { confirmHost = (o) => new Promise((res) => { setTyped(''); set({ o, res }); }); return () => { confirmHost = null; }; }, []);
  if (!s) return null; const done = (v: boolean) => { s.res(v); set(null); }; const need = s.o.type;
  return (<Modal title={s.o.title} onClose={() => done(false)} footer={<><Btn onClick={() => done(false)}>Cancel</Btn><Btn kind={s.o.danger ? 'danger' : 'pri'} disabled={!!need && typed !== need} onClick={() => done(true)}>{s.o.ok ?? 'Confirm'}</Btn></>}>
    {s.o.body}{need && <Field label={`Type "${need}" to confirm`}><input class="input" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} autofocus /></Field>}</Modal>);
}

// ---- data
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<unknown>(null); const [loading, setLoading] = useState(true); const seq = useRef(0);
  const run = useCallback(() => { const my = ++seq.current; setLoading(true); fn().then((d) => { if (my === seq.current) { setData(d); setError(null); setLoading(false); } }).catch((e) => { if (my === seq.current) { setError(e); setLoading(false); } }); }, deps); // eslint-disable-line
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, set: setData };
}
export function useInterval(fn: () => void, ms: number) { const f = useRef(fn); f.current = fn; useEffect(() => { const t = setInterval(() => f.current(), ms); return () => clearInterval(t); }, [ms]); }
export function useDebounced<T>(v: T, ms = 250) { const [d, set] = useState(v); useEffect(() => { const t = setTimeout(() => set(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

export class Boundary extends Component<{ children?: ComponentChildren }, { err: Error | null }> {
  state = { err: null as Error | null };
  componentDidCatch(e: Error) { this.setState({ err: e }); }
  render() { return this.state.err ? <div class="page"><div class="callout bad">Something broke on this screen: {this.state.err.message}<div style="margin-top:8px"><Btn onClick={() => this.setState({ err: null })}>Try again</Btn></div></div></div> : this.props.children; }
}
