import { useMemo, useState } from 'preact/hooks';
import { Badge, Btn, Field, Modal, Panel, confirm, toast } from '../ui';
import { ObjectForm } from './FormEditor';
import type { FieldDef } from './schema';
import type { Content } from './shared';

const NW = 170, NH = 64, GX = 26, GY = 56;
const reqs = (s: any): string[] => (Array.isArray(s.requires) ? s.requires : typeof s.requires === 'string' ? [s.requires] : typeof s.parent === 'string' ? [s.parent] : []);

function layoutTree(nodes: any[]) {
  const byId = new Map(nodes.map((n) => [n.id, n])); const tier = new Map<string, number>();
  const depth = (n: any, seen = new Set<string>()): number => { if (tier.has(n.id)) return tier.get(n.id)!; if (seen.has(n.id)) return 1; seen.add(n.id); const ps = reqs(n).map((r) => byId.get(r)).filter(Boolean); const d = typeof n.tier === 'number' ? n.tier : ps.length ? Math.max(...ps.map((p) => depth(p, seen))) + 1 : 1; tier.set(n.id, d); return d; };
  for (const n of nodes) depth(n);
  const rows = new Map<number, any[]>(); for (const n of nodes) rows.set(tier.get(n.id)!, [...(rows.get(tier.get(n.id)!) ?? []), n]);
  const xi = new Map<string, number>(); const maxT = Math.max(1, ...rows.keys()); let maxW = 1; for (const r of rows.values()) maxW = Math.max(maxW, r.length);
  for (let t = 1; t <= maxT; t++) {
    const r = rows.get(t) ?? []; r.sort((a, b) => { const ba = reqs(a).map((q) => xi.get(q)).filter((v): v is number => v !== undefined), bb = reqs(b).map((q) => xi.get(q)).filter((v): v is number => v !== undefined); const ma = ba.length ? ba.reduce((x, y) => x + y, 0) / ba.length : 1e3, mb = bb.length ? bb.reduce((x, y) => x + y, 0) / bb.length : 1e3; return ma - mb; });
    const off = (maxW - r.length) / 2; r.forEach((n, i) => xi.set(n.id, off + i));
  }
  const pos = new Map<string, { x: number; y: number }>(); for (const n of nodes) pos.set(n.id, { x: 16 + xi.get(n.id)! * (NW + GX), y: 16 + (tier.get(n.id)! - 1) * (NH + GY) });
  return { pos, w: 32 + maxW * (NW + GX) - GX, h: 32 + maxT * (NH + GY) - GY, tier };
}

export function SkillTree({ c, edit, fields, sel, onSel }: { c: Content; edit: boolean; fields: FieldDef[]; sel?: string; onSel: (id: string) => void }) {
  const items = c.doc!.items; const trees = useMemo(() => { const m = new Map<string, any[]>(); for (const s of items) m.set(s.tree ?? 'general', [...(m.get(s.tree ?? 'general') ?? []), s]); return [...m.entries()]; }, [items]);
  const [add, setAdd] = useState<null | string>(null); const cur = items.find((i) => i.id === sel);
  const del = async () => { if (!cur) return; const dep = items.filter((o) => reqs(o).includes(cur.id)); if (!(await confirm({ title: `Delete ${cur.name}?`, danger: true, ok: 'Delete', body: dep.length ? <div class="callout warn">{dep.map((d) => d.name).join(', ')} require it. Their requirement is removed too.</div> : undefined }))) return; c.setItems(items.filter((i) => i.id !== cur.id).map((o) => (reqs(o).includes(cur.id) ? { ...o, requires: reqs(o).filter((r) => r !== cur.id) } : o))); onSel(''); };
  return (
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 360px;flex:1;min-height:0;align-items:stretch">
      <div class="col" style="overflow:auto;min-height:0;gap:14px">
        {trees.map(([name, nodes]) => { const L = layoutTree(nodes); return (
          <div key={name} class="panel" style="flex:none"><div class="hd" style="padding-bottom:6px"><h2>{name}</h2><Badge>{nodes.length} skills</Badge><Badge kind="pur">{nodes.reduce((a, n) => a + (n.cost ?? 0) * (n.maxRank ?? 1), 0)} points to max</Badge><div class="grow" />{edit && <Btn kind="sm" icon="plus" onClick={() => setAdd(name)}>Add skill</Btn>}</div>
            <div style="overflow:auto;padding:8px 8px 14px"><div style={`position:relative;width:${L.w}px;height:${L.h}px;margin:0 auto`}>
              <svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">{nodes.flatMap((n) => reqs(n).map((r) => { const a = L.pos.get(r), b = L.pos.get(n.id); if (!a || !b) return null; const x1 = a.x + NW / 2, y1 = a.y + NH, x2 = b.x + NW / 2, y2 = b.y, my = (y1 + y2) / 2; return <path key={r + n.id} d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`} fill="none" stroke={sel === n.id || sel === r ? '#2de0c8' : 'rgba(155,163,180,.45)'} stroke-width="2" />; }))}</svg>
              {nodes.map((n) => { const p = L.pos.get(n.id)!; const ext = reqs(n).filter((r) => !nodes.some((x) => x.id === r) && items.some((x) => x.id === r)); const miss = reqs(n).filter((r) => !items.some((x) => x.id === r)); return (
                <div key={n.id} class={'tnode' + (sel === n.id ? ' sel' : '')} style={`left:${p.x}px;top:${p.y}px;width:${NW}px;height:${NH}px;${miss.length ? 'border-color:var(--bad)' : ''}`} onClick={() => onSel(n.id)}>
                  <div class="nm">{n.name ?? n.id}</div><div class="ms"><span>tier {L.tier.get(n.id)}</span><span>cost {n.cost ?? 0}</span><span>rank {n.maxRank ?? 1}</span>{n.level ? <span>lv {n.level}</span> : null}</div>
                  <div class="ms">{(n.modes ?? []).length > 0 && <Badge kind="pur">{n.modes.length} modes</Badge>}{ext.length > 0 && <Badge kind="warn">needs other tree</Badge>}{miss.length > 0 && <Badge kind="bad">missing req</Badge>}</div></div>); })}
            </div></div></div>); })}
        {edit && <div><Btn icon="plus" onClick={() => setAdd('__new__')}>New tree</Btn></div>}
      </div>
      <div style="overflow:auto;min-height:0">{!cur ? <Panel title="Skill"><div class="dim">Pick a skill in a tree to edit its cost, ranks, requirements and modes.</div></Panel> : (
        <Panel title={cur.name ?? cur.id} actions={edit && <Btn kind="sm danger icon" icon="trash" onClick={del} />}>
          <div class="col"><div class="mono dim">{cur.id}</div><ObjectForm fields={fields.filter((f) => f.key !== 'id')} value={cur} onChange={(n) => c.update(cur.id, () => n)} issues={c.issues.filter((i) => i.path.startsWith(`items[${items.indexOf(cur)}]`)).map((i) => ({ ...i, path: i.path.replace(`items[${items.indexOf(cur)}].`, '') }))} disabled={!edit} ownKind="skills" />
            {c.issues.filter((i) => i.path.startsWith(`items[${items.indexOf(cur)}]`)).length === 0 && <div class="dim" style="font-size:12px">Requirements decide where a skill sits: no requirements puts it at the top of its tree.</div>}</div></Panel>)}</div>
      {add && <AddSkill c={c} tree={add === '__new__' ? '' : add} newTree={add === '__new__'} onClose={() => setAdd(null)} onMake={(s) => { c.add(s); setAdd(null); onSel(s.id); }} />}
    </div>
  );
}

function AddSkill({ c, tree: t0, newTree, onClose, onMake }: { c: Content; tree: string; newTree: boolean; onClose: () => void; onMake: (s: any) => void }) {
  const [tree, setTree] = useState(t0); const [name, setName] = useState(''); const [parent, setParent] = useState('');
  const inTree = c.doc!.items.filter((s) => (s.tree ?? 'general') === tree); const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); const id = `skill.${(tree || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${slug}`; const taken = c.doc!.items.some((s) => s.id === id);
  return <Modal title={newTree ? 'New skill tree' : `Add skill to ${tree}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="pri" disabled={!name || !tree || taken} onClick={() => { if (taken) { toast('Id exists', 'bad'); return; } onMake({ id, tree, name, desc: '', tier: parent ? (inTree.find((s) => s.id === parent)?.tier ?? 1) + 1 : 1, requires: parent ? [parent] : [], cost: 1, maxRank: 1 }); }}>{newTree ? 'Create tree with first skill' : 'Add skill'}</Btn></>}>
    {newTree && <Field label="Tree name"><input class="input" value={tree} onInput={(e) => setTree((e.target as HTMLInputElement).value)} autofocus /></Field>}
    <Field label="Skill name" err={taken ? 'A skill with this id already exists' : null} help={`Id will be ${id}`}><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autofocus={!newTree} /></Field>
    {!newTree && <Field label="Requires"><select class="input" value={parent} onChange={(e) => setParent((e.target as HTMLSelectElement).value)}><option value="">Nothing (top of the tree)</option>{inTree.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
  </Modal>;
}
