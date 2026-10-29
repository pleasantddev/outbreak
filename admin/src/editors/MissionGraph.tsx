import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { Badge, Btn, Field, Panel, confirm, toast } from '../ui';
import { ObjectForm } from './FormEditor';
import { schemaFor, type FieldDef } from './schema';
import type { Content } from './shared';
import type { Issue } from '@srv/types';

const W = 204, HEAD = 28, BODY = 50, ROW = 22;
const TYPE_COLOR: Record<string, string> = { talk: '#5eb3ff', goto: '#2de0c8', collect: '#f5b84a', deliver: '#2de0c8', drive: '#8b5cf6', fight: '#ff5d73', wait: '#9ba3b4', choice: '#d17bff', skillcheck: '#f5b84a', event: '#ff8a4c', buy: '#3ddc97', complete: '#3ddc97', fail: '#ff5d73' };
const STEP_TYPES = ['talk', 'goto', 'collect', 'deliver', 'drive', 'fight', 'wait', 'choice', 'skillcheck', 'event', 'buy', 'complete', 'fail'];
const LINK_KEYS = ['next', 'onSuccess', 'onFail', 'onTimeout', 'goto', 'else', 'then'];
const KEY_COLOR: Record<string, string> = { next: '#2de0c8', onSuccess: '#3ddc97', onFail: '#ff5d73', onTimeout: '#f5b84a' };

interface Port { key: string; label: string; to: string | null; set: (step: any, to: string | undefined) => any }
function portsOf(s: any): Port[] {
  const out: Port[] = [];
  for (const k of LINK_KEYS) if (typeof s[k] === 'string') out.push({ key: k, label: k, to: s[k], set: (st, to) => { const n = { ...st }; if (to === undefined) delete n[k]; else n[k] = to; return n; } });
  for (const arr of ['choices', 'branches'] as const) if (Array.isArray(s[arr])) s[arr].forEach((c: any, i: number) => out.push({ key: `${arr}.${i}`, label: String(c.label ?? c.text ?? `choice ${i + 1}`).slice(0, 26), to: c.next ?? null, set: (st, to) => { const n = { ...st, [arr]: st[arr].map((x: any, j: number) => (j === i ? (to === undefined ? (({ next, ...r }) => r)(x) : { ...x, next: to }) : x)) }; return n; } }));
  return out;
}
const terminal = (s: any) => s.type === 'complete' || s.type === 'fail';
const nodeH = (s: any) => HEAD + BODY + Math.max(1, portsOf(s).length + (terminal(s) ? 0 : 1)) * ROW + 6;

function autoLayout(steps: any[], entry: string) {
  const pos: Record<string, { x: number; y: number }> = {}; const depth = new Map<string, number>(); const q = [entry]; depth.set(entry, 0);
  const byId = new Map(steps.map((s) => [s.id, s]));
  while (q.length) { const id = q.shift()!; const s = byId.get(id); if (!s) continue; for (const p of portsOf(s)) if (p.to && byId.has(p.to) && !depth.has(p.to)) { depth.set(p.to, depth.get(id)! + 1); q.push(p.to); } }
  let extra = Math.max(0, ...depth.values()) + 1; for (const s of steps) if (!depth.has(s.id)) depth.set(s.id, extra++);
  const cols = new Map<number, string[]>(); for (const [id, d] of depth) cols.set(d, [...(cols.get(d) ?? []), id]);
  for (const [d, ids] of cols) { let y = 40; for (const id of ids) { pos[id] = { x: 40 + d * 290, y }; y += nodeH(byId.get(id)) + 40; } }
  return pos;
}

export function MissionGraph({ c, mission, edit, onChange, issues }: { c: Content; mission: any; edit: boolean; onChange: (m: any) => void; issues: Issue[] }) {
  const steps: any[] = mission.steps ?? []; const entry: string = mission.entry ?? steps[0]?.id;
  const [layout, setLayout] = useState<Record<string, { x: number; y: number }>>({}); const [sel, setSel] = useState<string | null>(steps[0]?.id ?? null); const [view, setView] = useState({ x: 20, y: 10, k: 1 });
  const [drag, setDrag] = useState<null | { from: string; port: Port | null; x: number; y: number }>(null); const [menu, setMenu] = useState<null | { from: string; to: string; x: number; y: number }>(null);
  const box = useRef<HTMLDivElement>(null); const loaded = useRef('');
  useEffect(() => { if (loaded.current === mission.id) return; loaded.current = mission.id; setLayout({}); api.get(`/layouts/missions/${mission.id}`).then((r) => { setLayout(r.layout ?? {}); }).catch(() => {}); }, [mission.id]);
  const pos = useMemo(() => { const auto = autoLayout(steps, entry); return Object.fromEntries(steps.map((s) => [s.id, layout[s.id] ?? auto[s.id] ?? { x: 40, y: 40 }])); }, [steps, layout, entry]);
  const saveT = useRef<any>(); const persist = (l: typeof layout) => { clearTimeout(saveT.current); saveT.current = setTimeout(() => api.put(`/layouts/missions/${mission.id}`, { layout: l }).catch(() => {}), 700); };
  const setStep = (id: string, ns: any) => onChange({ ...mission, steps: steps.map((s) => (s.id === id ? ns : s)) });
  const stepFields: FieldDef[] = useMemo(() => { const f = schemaFor('mission-step', steps); return f.map((x) => (x.key === 'type' ? { ...x, type: 'enum' as const, options: Array.from(new Set([...STEP_TYPES, ...steps.map((s) => s.type)])) } : x)).filter((x) => !['next', 'onSuccess', 'onFail', 'onTimeout', 'goto', 'else', 'then'].includes(x.key) || false); }, [steps]);
  const toGraph = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }; };

  const onNodeDown = (e: PointerEvent, id: string) => {
    if ((e.target as HTMLElement).closest('.port')) return; e.stopPropagation(); setSel(id); setMenu(null); if (!edit) return;
    const start = toGraph(e); const p0 = pos[id]; const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId); let cur = layout;
    const mv = (ev: PointerEvent) => { const g = toGraph(ev); cur = { ...cur, ...Object.fromEntries(steps.map((s) => [s.id, cur[s.id] ?? pos[s.id]])), [id]: { x: Math.round(p0.x + g.x - start.x), y: Math.round(p0.y + g.y - start.y) } }; setLayout(cur); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); persist(cur); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };
  const onBgDown = (e: PointerEvent) => {
    setSel(null); setMenu(null); const sx = e.clientX, sy = e.clientY, v0 = view; const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => setView({ ...v0, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy }); const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = box.current!.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const k = Math.max(0.35, Math.min(1.6, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); setView({ k, x: mx - ((mx - view.x) / view.k) * k, y: my - ((my - view.y) / view.k) * k }); };
  useEffect(() => { const el = box.current; if (!el) return; const f = (e: WheelEvent) => onWheel(e); el.addEventListener('wheel', f, { passive: false }); return () => el.removeEventListener('wheel', f); });

  const startLink = (e: PointerEvent, from: string, port: Port | null) => {
    e.stopPropagation(); e.preventDefault(); if (!edit) return; const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId); const g = toGraph(e); setDrag({ from, port, x: g.x, y: g.y });
    const mv = (ev: PointerEvent) => { const p = toGraph(ev); setDrag({ from, port, x: p.x, y: p.y }); };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); const p = toGraph(ev); setDrag(null);
      const hit = steps.find((s) => s.id !== from && p.x >= pos[s.id].x - 6 && p.x <= pos[s.id].x + W + 6 && p.y >= pos[s.id].y && p.y <= pos[s.id].y + nodeH(s));
      if (!hit) { if (port && !hit) { /* dropped on empty space: remove the link */ const s = steps.find((x) => x.id === from)!; if (Math.hypot(p.x - g.x, p.y - g.y) > 20) setStep(from, port.set(s, undefined)); } return; }
      const s = steps.find((x) => x.id === from)!;
      if (port) { setStep(from, port.set(s, hit.id)); return; }
      const free = ['next', 'onSuccess', 'onFail'].filter((k) => typeof s[k] !== 'string'); const rect = box.current!.getBoundingClientRect();
      if (s.type === 'choice') { setStep(from, { ...s, choices: [...(s.choices ?? []), { label: 'New choice', next: hit.id }] }); return; }
      if (free.length === 1 || (!free.length)) { setStep(from, { ...s, [free[0] ?? 'next']: hit.id }); return; }
      setMenu({ from, to: hit.id, x: ev.clientX - rect.left, y: ev.clientY - rect.top });
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };
  const addStep = (type: string) => {
    let n = steps.length + 1; while (steps.some((s) => s.id === 's' + n)) n++; const id = 's' + n; const r = box.current!.getBoundingClientRect(); const ns: any = { id, type, text: 'New step' };
    if (type === 'choice') ns.choices = [{ label: 'Option A' }, { label: 'Option B' }]; if (type === 'skillcheck') { ns.skill = ''; ns.dc = 2; } if (terminal({ type })) ns.text = type === 'complete' ? 'Mission complete' : 'Mission failed';
    const p = { x: Math.round((r.width / 2 - view.x) / view.k - W / 2 + (n % 3) * 20), y: Math.round((r.height / 2 - view.y) / view.k - 60) };
    onChange({ ...mission, steps: [...steps, ns] }); const l = { ...layout, ...Object.fromEntries(steps.map((s) => [s.id, layout[s.id] ?? pos[s.id]])), [id]: p }; setLayout(l); persist(l); setSel(id);
  };
  const delStep = async (id: string) => {
    if (!(await confirm({ title: `Delete step ${id}?`, danger: true, ok: 'Delete', body: <div>Links pointing at it are removed.</div> }))) return;
    let ns = steps.filter((s) => s.id !== id).map((s) => { let n = s; for (const p of portsOf(s)) if (p.to === id) n = p.set(n, undefined); return n; });
    onChange({ ...mission, steps: ns, entry: entry === id ? ns[0]?.id : mission.entry }); setSel(null);
  };
  const renameStep = (id: string, nid: string) => {
    if (!nid || steps.some((s) => s.id === nid)) { toast('That id is already used', 'bad'); return; }
    const ns = steps.map((s) => { let n = s.id === id ? { ...s, id: nid } : s; for (const p of portsOf(n)) if (p.to === id) n = p.set(n, nid); return n; });
    onChange({ ...mission, steps: ns, entry: entry === id ? nid : mission.entry }); setLayout((l) => { const { [id]: v, ...r } = l; return v ? { ...r, [nid]: v } : l; }); setSel(nid);
  };
  const stepErr = (id: string) => issues.some((i) => i.level === 'error' && i.msg.includes(`"${id}"`));
  const edges: { a: string; b: string; key: string; x1: number; y1: number; x2: number; y2: number; col: string; label: string }[] = [];
  for (const s of steps) portsOf(s).forEach((p, i) => { if (!p.to || !pos[p.to]) return; const t = steps.find((x) => x.id === p.to)!; void t; edges.push({ a: s.id, b: p.to, key: p.key, x1: pos[s.id].x + W, y1: pos[s.id].y + HEAD + BODY + i * ROW + ROW / 2, x2: pos[p.to].x, y2: pos[p.to].y + 14, col: p.key.startsWith('choices') ? '#d17bff' : KEY_COLOR[p.key] ?? '#9ba3b4', label: p.label }); });
  const bez = (x1: number, y1: number, x2: number, y2: number) => { const d = Math.max(50, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`; };
  const cur = steps.find((s) => s.id === sel);
  return (
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:stretch;height:calc(100vh - 330px);min-height:480px">
      <div class="col" style="min-width:0;min-height:0">
        <div class="row wrap">{edit && <><span class="mut" style="font-size:12px">Add step:</span>{['talk', 'goto', 'collect', 'drive', 'fight', 'choice', 'skillcheck', 'wait', 'complete', 'fail'].map((t) => <button key={t} class="btn sm" onClick={() => addStep(t)}><i style={`width:8px;height:8px;border-radius:50%;background:${TYPE_COLOR[t]}`} />{t}</button>)}</>}<div class="grow" /><Btn kind="sm" onClick={() => { const l = autoLayout(steps, entry); setLayout(l); persist(l); setView({ x: 20, y: 10, k: 1 }); }}>Auto layout</Btn><Btn kind="sm" onClick={() => setView({ x: 20, y: 10, k: 1 })}>Reset view</Btn></div>
        <div class="graph" ref={box} onPointerDown={onBgDown}>
          <div style={`position:absolute;left:0;top:0;transform:translate(${view.x}px,${view.y}px) scale(${view.k});transform-origin:0 0`}>
            <svg style="position:absolute;left:0;top:0;width:4000px;height:3000px;overflow:visible;pointer-events:none"><defs>{['#2de0c8', '#3ddc97', '#ff5d73', '#f5b84a', '#d17bff', '#9ba3b4'].map((c2) => <marker key={c2} id={'ar' + c2.slice(1)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill={c2} /></marker>)}</defs>
              {edges.map((e, i) => <g key={i}><path d={bez(e.x1, e.y1, e.x2, e.y2)} fill="none" stroke={e.col} stroke-width="2" opacity=".85" marker-end={`url(#ar${e.col.slice(1)})`} /></g>)}
              {drag && <path d={bez(pos[drag.from].x + W, drag.port ? pos[drag.from].y + HEAD + BODY + portsOf(steps.find((s) => s.id === drag.from)).findIndex((p) => p.key === drag.port!.key) * ROW + ROW / 2 : pos[drag.from].y + nodeH(steps.find((s) => s.id === drag.from)) - ROW / 2, drag.x, drag.y)} fill="none" stroke="#2de0c8" stroke-width="2" stroke-dasharray="6 5" />}</svg>
            {steps.map((s) => { const ps = portsOf(s); const h = nodeH(s); const col = TYPE_COLOR[s.type] ?? '#9ba3b4'; return (
              <div key={s.id} class={'gnode' + (sel === s.id ? ' sel' : '') + (s.id === entry ? ' entry' : '')} style={`left:${pos[s.id].x}px;top:${pos[s.id].y}px;width:${W}px;height:${h}px;${stepErr(s.id) ? 'border-color:var(--bad)' : ''}`} onPointerDown={(e) => onNodeDown(e as any, s.id)}>
                <div class="gh" style={`background:${col}22;color:${col}`}>{s.type}<span class="grow" /><span class="mono" style="opacity:.7;text-transform:none;letter-spacing:0">{s.id}</span></div>
                <div class="gb" style={`height:${BODY}px`}>{s.text ?? s.title ?? ''}</div>
                {ps.map((p, i) => <div key={p.key} style={`position:absolute;left:0;right:0;top:${HEAD + BODY + i * ROW}px;height:${ROW}px;display:flex;align-items:center;justify-content:flex-end;padding-right:14px;font-size:11px;color:${p.key.startsWith('choices') ? '#d17bff' : KEY_COLOR[p.key] ?? '#9ba3b4'}`}>{p.label}{!p.to && <span class="dim">&nbsp;(unlinked)</span>}<div class="port" style={`top:4px;border-color:${p.key.startsWith('choices') ? '#d17bff' : KEY_COLOR[p.key] ?? '#9ba3b4'}`} onPointerDown={(e) => startLink(e as any, s.id, p)} /></div>)}
                {!terminal(s) && <div style={`position:absolute;left:0;right:0;top:${HEAD + BODY + ps.length * ROW}px;height:${ROW}px;display:flex;align-items:center;justify-content:flex-end;padding-right:14px;font-size:11px;color:var(--dim)`}>drag to link<div class="port" style="top:4px;border-style:dashed" onPointerDown={(e) => startLink(e as any, s.id, null)} /></div>}
                <div class="port in" onPointerDown={(e) => e.stopPropagation()} />
              </div>); })}
          </div>
          {menu && <div class="glass" style={`position:absolute;left:${menu.x}px;top:${menu.y}px;padding:6px;z-index:6`}>{['next', 'onSuccess', 'onFail'].filter((k) => typeof steps.find((s) => s.id === menu.from)?.[k] !== 'string').map((k) => <div key={k}><button class="btn sm ghost" onClick={() => { const s = steps.find((x) => x.id === menu.from)!; setStep(menu.from, { ...s, [k]: menu.to }); setMenu(null); }}>Link as {k}</button></div>)}</div>}
          <div class="dim" style="position:absolute;left:10px;bottom:8px;font-size:11.5px;pointer-events:none">Drag nodes to move. Drag the dot on a node's right edge onto another node to link. Scroll to zoom, drag the background to pan.</div>
        </div>
      </div>
      <div style="overflow:auto;min-height:0">{!cur ? <Panel title="Step"><div class="dim">Pick a step in the graph.</div></Panel> : (
        <Panel title={`Step ${cur.id}`} actions={<>{cur.id !== entry && edit && <Btn kind="sm" onClick={() => onChange({ ...mission, entry: cur.id })}>Set as start</Btn>}{edit && <Btn kind="sm danger icon" icon="trash" onClick={() => delStep(cur.id)} />}</>}>
          <div class="col">{cur.id === entry && <Badge kind="teal">Start step</Badge>}
            <Field label="Step id"><input class="input mono" disabled={!edit} value={cur.id} onChange={(e) => renameStep(cur.id, (e.target as HTMLInputElement).value.trim())} /></Field>
            <ObjectForm fields={stepFields.filter((f) => f.key !== 'id')} value={cur} onChange={(n) => setStep(cur.id, n)} disabled={!edit} ownKind="missions" />
            <div class="dim" style="font-size:12px">Links ({portsOf(cur).map((p) => `${p.label} to ${p.to ?? 'nothing'}`).join(', ') || 'none'}) are changed by dragging in the graph.</div>
          </div></Panel>)}</div>
    </div>
  );
}
