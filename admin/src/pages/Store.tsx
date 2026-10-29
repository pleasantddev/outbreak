import { useMemo, useState } from 'preact/hooks';
import { api, qs } from '../api';
import { AreaChart, BarChart } from '../charts';
import { go, useCan } from '../session';
import { Badge, Btn, ErrorBox, Field, Loading, Modal, Panel, Seg, Stat, Tabs, Switch, confirm, errMsg, fmt, toast, toastErr, useDebounced, useFetch } from '../ui';
import { IssueList, SaveBar, useContent, type Content } from '../editors/shared';
import type { PurchaseRow } from '@srv/types';

const TYPES = ['currency', 'bundle', 'cosmetic', 'boost', 'pass'];
const now = () => Date.now();
const win = (it: any) => { const f = it.from ?? it.availableFrom, t = it.to ?? it.availableTo; const a = f ? Date.parse(f) : -Infinity, b = t ? Date.parse(t) : Infinity; return !it.enabled ? 'off' : now() < a ? 'scheduled' : now() > b ? 'ended' : 'live'; };
const WB: Record<string, string> = { live: 'good', scheduled: 'teal', ended: '', off: '' };
const grantText = (g: any) => g ? [g.cash ? fmt.naira(g.cash) + ' cash' : '', ...(g.items ?? []).map((i: any) => `${i.qty}x ${i.id}`), ...(g.cosmetics ?? []), g.boost ? `${g.boost.xp}x xp ${g.boost.days}d` : '', g.pass ? 'pass ' + g.pass : ''].filter(Boolean).join(', ') : '';

export function Store({ tab }: { tab: string }) {
  const c = useContent('iap'); const can = useCan();
  const t = ['items', 'promos', 'sales', 'ledger', 'revenue'].includes(tab) ? tab : 'items';
  return (
    <div class="col gap-lg">
      <div class="pageh"><div><h1>Store and in-app purchases</h1><div class="sub">Items, prices in naira and dollars, promo codes, sales windows, the purchase ledger and revenue.</div></div></div>
      <Tabs cur={t} on={(k) => go('store/' + k)} tabs={[['items', 'Store items'], ['promos', 'Promo codes'], ['sales', 'Sales'], ['ledger', 'Purchase ledger'], ['revenue', 'Revenue']]} />
      {(t === 'items' || t === 'promos' || t === 'sales') && (c.loading && !c.doc ? <Loading /> : !c.doc ? <ErrorBox e={c.error} retry={c.reload} /> : (<>
        {t === 'items' && <Items c={c} edit={can('store.edit')} />}
        {t === 'promos' && <Promos c={c} edit={can('store.edit')} />}
        {t === 'sales' && <Sales c={c} edit={can('store.edit')} />}
        <IssueList issues={c.issues} />
        {can('store.edit') ? <SaveBar c={c} /> : <div class="callout">Your role can view but not edit the store.</div>}</>))}
      {t === 'ledger' && <Ledger can={can('store.refund')} names={new Map((c.doc?.items ?? []).map((i) => [i.id, i.name ?? i.id]))} />}
      {t === 'revenue' && <Revenue names={new Map((c.doc?.items ?? []).map((i) => [i.id, i.name ?? i.id]))} />}
    </div>
  );
}

function bestSale(items: any[], id: string) { return items.filter((s) => s.type === 'sale' && win(s) === 'live' && (s.itemIds ?? []).includes(id)).sort((a, b) => b.percentOff - a.percentOff)[0]; }

function Items({ c, edit }: { c: Content; edit: boolean }) {
  const [sel, setSel] = useState<any | null>(null); const [isNew, setIsNew] = useState(false); const [f, setF] = useState('all');
  const all = c.doc!.items; const rows = all.map((it, i) => ({ it, i })).filter(({ it }) => !['promo', 'sale'].includes(it.type) && (f === 'all' || it.type === f)).sort((a, b) => (a.it.sort ?? 0) - (b.it.sort ?? 0));
  const errs = (i: number) => c.issues.filter((x) => x.path.startsWith(`items[${i}]`) && x.level === 'error').length;
  const dup = (it: any) => { let n = 2; while (all.some((x) => x.id === it.id + '-copy' + n)) n++; const d = { ...structuredClone(it), id: it.id + '-copy' + n, name: it.name + ' (copy)', enabled: false }; c.add(d); setSel(d); setIsNew(false); };
  return (<>
    <div class="row wrap"><Seg cur={f} on={setF} opts={[['all', 'All'], ...TYPES.map((t) => [t, t] as [string, string])]} /><div class="grow" />{edit && <Btn kind="pri" icon="plus" onClick={() => { setSel({ id: '', type: 'currency', name: '', desc: '', priceNGN: 1000, priceUSD: 1.99, grants: { cash: 100000 }, enabled: true, sort: all.length + 1, tag: '' }); setIsNew(true); }}>New item</Btn>}</div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Item</th><th>Type</th><th class="num">NGN</th><th class="num">USD</th><th>Gives</th><th>Status</th><th style="width:150px" /></tr></thead><tbody>
      {rows.map(({ it, i }) => { const sale = bestSale(all, it.id); const st = win(it); return (<tr key={it.id} class="click" onClick={() => { setSel(it); setIsNew(false); }}>
        <td><div style="font-weight:600">{it.name}{it.tag && <> <Badge kind="pur">{it.tag}</Badge></>}{errs(i) > 0 && <> <Badge kind="bad">{errs(i)} error</Badge></>}</div><div class="dim mono" style="font-size:11.5px">{it.id}</div></td>
        <td><Badge>{it.type}</Badge></td>
        <td class="num">{sale ? <><s class="dim">{fmt.naira(it.priceNGN)}</s><br /><b style="color:var(--good)">{fmt.naira(Math.round(it.priceNGN * (1 - sale.percentOff / 100)))}</b></> : fmt.naira(it.priceNGN)}</td>
        <td class="num">{sale ? <><s class="dim">{fmt.usd(it.priceUSD)}</s><br /><b style="color:var(--good)">{fmt.usd(Math.round(it.priceUSD * (1 - sale.percentOff / 100) * 100) / 100)}</b></> : fmt.usd(it.priceUSD ?? 0)}</td>
        <td class="mut" style="max-width:280px;font-size:12.5px">{grantText(it.grants)}</td>
        <td><Badge kind={WB[st]}>{st}</Badge>{sale && <> <Badge kind="warn">-{sale.percentOff}%</Badge></>}</td>
        <td class="right" onClick={(e) => e.stopPropagation()}>{edit && <div class="row" style="justify-content:flex-end"><Switch on={!!it.enabled} onChange={(v) => c.update(it.id, (x) => ({ ...x, enabled: v }))} /><Btn kind="ghost sm icon" icon="dup" title="Duplicate" onClick={() => dup(it)} /><Btn kind="ghost sm icon" icon="trash" title="Delete" onClick={async () => { if (await confirm({ title: `Delete ${it.name}?`, danger: true, ok: 'Delete', body: <div>Players who already bought it keep it. Sales and promos that mention it will show an error until you fix them.</div> })) c.remove(it.id); }} /></div>}</td></tr>); })}
      {!rows.length && <tr><td colSpan={7} class="empty">No items</td></tr>}</tbody></table></div>
    {sel && <ItemModal it={sel} isNew={isNew} edit={edit} ids={new Set(all.map((x) => x.id))} onClose={() => setSel(null)} onSave={(v) => { if (isNew) c.add(v); else c.update(sel.id, () => v); setSel(null); }} />}
  </>);
}

function ItemModal({ it, isNew, edit, ids, onClose, onSave }: { it: any; isNew: boolean; edit: boolean; ids: Set<string>; onClose: () => void; onSave: (v: any) => void }) {
  const [v, setV] = useState<any>(structuredClone(it)); const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val })); const g = v.grants ?? {};
  const setG = (k: string, val: any) => set('grants', { ...g, [k]: val });
  const idErr = !v.id ? 'Required' : isNew && ids.has(v.id) ? 'Already used' : !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v.id) ? 'Letters, digits, . _ : -' : null;
  const rate = v.priceNGN && v.priceUSD ? Math.round(v.priceNGN / v.priceUSD) : 0; const d = (s?: string) => (s ? s.slice(0, 10) : '');
  const items: { id: string; qty: number }[] = g.items ?? [];
  return (
    <Modal wide title={isNew ? 'New store item' : v.name} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn>{edit && <Btn kind="pri" disabled={!!idErr || !v.name} onClick={() => onSave(v)}>{isNew ? 'Add item' : 'Apply'}</Btn>}</>}>
      <div class="form">
        <Field label="Id" err={isNew ? idErr : null} help={isNew ? 'Permanent. Receipts and the ledger refer to it.' : undefined}><input class="input mono" disabled={!isNew || !edit} value={v.id} onInput={(e) => set('id', (e.target as HTMLInputElement).value)} /></Field>
        <Field label="Type"><select class="input" disabled={!edit} value={v.type} onChange={(e) => set('type', (e.target as HTMLSelectElement).value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Name"><input class="input" disabled={!edit} value={v.name} onInput={(e) => set('name', (e.target as HTMLInputElement).value)} /></Field>
        <Field label="Badge text" help="For example popular, new, best value"><input class="input" disabled={!edit} value={v.tag ?? ''} onInput={(e) => set('tag', (e.target as HTMLInputElement).value)} /></Field>
        <Field label="Description" class="full"><input class="input" disabled={!edit} value={v.desc ?? ''} onInput={(e) => set('desc', (e.target as HTMLInputElement).value)} /></Field>
        <Field label="Price in naira"><input class="input" type="number" min="1" step="1" disabled={!edit} value={v.priceNGN} onInput={(e) => set('priceNGN', Number((e.target as HTMLInputElement).value))} /></Field>
        <Field label="Price in dollars" help={rate ? `That is ${fmt.n(rate)} NGN per USD` : ''}><input class="input" type="number" min="0.01" step="0.01" disabled={!edit} value={v.priceUSD} onInput={(e) => set('priceUSD', Number((e.target as HTMLInputElement).value))} /></Field>
        <Field label="Sort order"><input class="input" type="number" disabled={!edit} value={v.sort ?? 0} onInput={(e) => set('sort', Number((e.target as HTMLInputElement).value))} /></Field>
        <Field label="Limit per account" help="0 means unlimited"><input class="input" type="number" min="0" disabled={!edit} value={v.limitPerAccount ?? 0} onInput={(e) => set('limitPerAccount', Number((e.target as HTMLInputElement).value))} /></Field>
        <Field label="Available from"><input class="input" type="date" disabled={!edit} value={d(v.availableFrom)} onInput={(e) => set('availableFrom', (e.target as HTMLInputElement).value || undefined)} /></Field>
        <Field label="Available until"><input class="input" type="date" disabled={!edit} value={d(v.availableTo)} onInput={(e) => set('availableTo', (e.target as HTMLInputElement).value || undefined)} /></Field>
        <div class="full sub-card"><h3 style="margin-bottom:8px">What the player gets</h3><div class="form">
          <Field label="Cash (NGN)"><input class="input" type="number" min="0" disabled={!edit} value={g.cash ?? 0} onInput={(e) => setG('cash', Number((e.target as HTMLInputElement).value) || undefined)} /></Field>
          <Field label="Cosmetics (comma separated ids)"><input class="input mono" disabled={!edit} value={(g.cosmetics ?? []).join(', ')} onInput={(e) => setG('cosmetics', (e.target as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean))} /></Field>
          <div class="full col gap-sm"><label class="mut" style="font:600 11px var(--font);letter-spacing:.1em;text-transform:uppercase">Items</label>{items.map((x, i) => (<div class="row" key={i}><input class="input mono" placeholder="item id" disabled={!edit} value={x.id} onInput={(e) => setG('items', items.map((y, k) => (k === i ? { ...y, id: (e.target as HTMLInputElement).value } : y)))} /><input class="input" style="width:90px" type="number" min="1" disabled={!edit} value={x.qty} onInput={(e) => setG('items', items.map((y, k) => (k === i ? { ...y, qty: Number((e.target as HTMLInputElement).value) } : y)))} />{edit && <Btn kind="ghost sm icon" icon="x" onClick={() => setG('items', items.filter((_, k) => k !== i))} />}</div>))}{edit && <Btn kind="sm" icon="plus" style="align-self:flex-start" onClick={() => setG('items', [...items, { id: '', qty: 1 }])}>Add item</Btn>}</div></div></div>
        <div class="row full"><Switch on={!!v.enabled} disabled={!edit} onChange={(x) => set('enabled', x)} /> <span>On sale in the store</span></div>
      </div>
    </Modal>
  );
}

function Promos({ c, edit }: { c: Content; edit: boolean }) {
  const all = c.doc!.items; const rows = all.map((it, i) => ({ it, i })).filter(({ it }) => it.type === 'promo'); const [sel, setSel] = useState<any>(null); const [isNew, setIsNew] = useState(false);
  const store = all.filter((x) => !['promo', 'sale'].includes(x.type));
  return (<>
    <div class="row">{edit && <Btn kind="pri" icon="plus" onClick={() => { setSel({ id: '', type: 'promo', name: '', code: '', percentOff: 10, appliesTo: ['*'], maxUses: 1000, perAccount: 1, enabled: true }); setIsNew(true); }}>New promo code</Btn>}</div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Code</th><th>Discount</th><th>Applies to</th><th>Window</th><th class="num">Max uses</th><th>Status</th><th /></tr></thead><tbody>
      {rows.map(({ it }) => (<tr key={it.id} class="click" onClick={() => { setSel(it); setIsNew(false); }}><td><b class="mono" style="color:var(--teal)">{it.code}</b><div class="dim" style="font-size:12px">{it.name}</div></td><td>{it.percentOff ? it.percentOff + '% off' : fmt.naira(it.amountOffNGN) + ' off'}</td><td class="mut">{(it.appliesTo ?? ['*'])[0] === '*' ? 'Everything' : (it.appliesTo ?? []).length + ' items'}</td><td class="mut" style="font-size:12.5px">{it.from ? it.from.slice(0, 10) : 'any time'} to {it.to ? it.to.slice(0, 10) : 'no end'}</td><td class="num">{fmt.n(it.maxUses)}</td><td><Badge kind={WB[win(it)]}>{win(it)}</Badge></td>
        <td class="right" onClick={(e) => e.stopPropagation()}>{edit && <div class="row" style="justify-content:flex-end"><Switch on={!!it.enabled} onChange={(v) => c.update(it.id, (x) => ({ ...x, enabled: v }))} /><Btn kind="ghost sm icon" icon="trash" onClick={async () => { if (await confirm({ title: `Delete code ${it.code}?`, danger: true, ok: 'Delete' })) c.remove(it.id); }} /></div>}</td></tr>))}
      {!rows.length && <tr><td colSpan={7} class="empty">No promo codes</td></tr>}</tbody></table></div>
    {sel && <PromoModal it={sel} isNew={isNew} edit={edit} store={store} ids={new Set(all.map((x) => x.id))} onClose={() => setSel(null)} onSave={(v) => { if (isNew) c.add(v); else c.update(sel.id, () => v); setSel(null); }} />}
  </>);
}
function PromoModal({ it, isNew, edit, store, ids, onClose, onSave }: { it: any; isNew: boolean; edit: boolean; store: any[]; ids: Set<string>; onClose: () => void; onSave: (v: any) => void }) {
  const [v, setV] = useState<any>(structuredClone(it)); const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val })); const all = (v.appliesTo ?? ['*'])[0] === '*'; const code = (v.code ?? '').toUpperCase(); const id = isNew ? 'promo.' + code : v.id;
  const err = !code ? null : !/^[A-Z0-9_-]{3,24}$/.test(code) ? '3 to 24 characters: A-Z, 0-9, _ -' : isNew && ids.has(id) ? 'Code already exists' : null;
  return (<Modal title={isNew ? 'New promo code' : 'Promo ' + it.code} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn>{edit && <Btn kind="pri" disabled={!code || !!err} onClick={() => onSave({ ...v, id, code })}>{isNew ? 'Add code' : 'Apply'}</Btn>}</>}>
    <div class="form"><Field label="Code" err={err}><input class="input mono" disabled={!isNew || !edit} value={v.code} onInput={(e) => set('code', (e.target as HTMLInputElement).value.toUpperCase())} /></Field><Field label="Label"><input class="input" disabled={!edit} value={v.name ?? ''} onInput={(e) => set('name', (e.target as HTMLInputElement).value)} /></Field>
      <Field label="Percent off"><input class="input" type="number" min="1" max="100" disabled={!edit} value={v.percentOff ?? ''} onInput={(e) => set('percentOff', Number((e.target as HTMLInputElement).value) || undefined)} /></Field><Field label="Or naira off" help="Used when percent is empty"><input class="input" type="number" min="0" disabled={!edit} value={v.amountOffNGN ?? ''} onInput={(e) => set('amountOffNGN', Number((e.target as HTMLInputElement).value) || undefined)} /></Field>
      <Field label="Max uses in total"><input class="input" type="number" min="1" disabled={!edit} value={v.maxUses ?? 0} onInput={(e) => set('maxUses', Number((e.target as HTMLInputElement).value))} /></Field><Field label="Uses per account"><input class="input" type="number" min="1" disabled={!edit} value={v.perAccount ?? 1} onInput={(e) => set('perAccount', Number((e.target as HTMLInputElement).value))} /></Field>
      <Field label="Starts"><input class="input" type="date" disabled={!edit} value={(v.from ?? '').slice(0, 10)} onInput={(e) => set('from', (e.target as HTMLInputElement).value || undefined)} /></Field><Field label="Ends"><input class="input" type="date" disabled={!edit} value={(v.to ?? '').slice(0, 10)} onInput={(e) => set('to', (e.target as HTMLInputElement).value || undefined)} /></Field>
      <div class="full col gap-sm"><div class="row"><Switch on={all} disabled={!edit} onChange={(x) => set('appliesTo', x ? ['*'] : [])} /> <span>Applies to every store item</span></div>{!all && <div class="row wrap gap-sm">{store.map((s) => { const on = (v.appliesTo ?? []).includes(s.id); return <button key={s.id} class={'btn sm ' + (on ? 'pri' : '')} disabled={!edit} onClick={() => set('appliesTo', on ? v.appliesTo.filter((x: string) => x !== s.id) : [...(v.appliesTo ?? []), s.id])}>{s.name}</button>; })}</div>}</div></div></Modal>);
}

function Sales({ c, edit }: { c: Content; edit: boolean }) {
  const all = c.doc!.items; const rows = all.filter((it) => it.type === 'sale').sort((a, b) => (a.from ?? '').localeCompare(b.from ?? '')); const store = all.filter((x) => !['promo', 'sale'].includes(x.type)); const [sel, setSel] = useState<any>(null); const [isNew, setIsNew] = useState(false);
  return (<>
    <div class="row">{edit && <Btn kind="pri" icon="plus" onClick={() => { setSel({ id: '', type: 'sale', name: '', percentOff: 20, itemIds: [], from: new Date().toISOString().slice(0, 10), to: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), enabled: true }); setIsNew(true); }}>New sale</Btn>}</div>
    <div class="grid g2">{rows.map((it) => { const st = win(it); return (<div key={it.id} class="panel" style="padding:16px;cursor:pointer" onClick={() => { setSel(it); setIsNew(false); }}><div class="row"><h2 class="grow" style="font-size:16px">{it.name}</h2><Badge kind={WB[st]}>{st}</Badge></div><div style="font:700 34px var(--head);color:var(--warn)">-{it.percentOff}%</div><div class="mut">{it.from?.slice(0, 10)} to {it.to?.slice(0, 10)}</div><div class="row wrap gap-sm" style="margin-top:8px">{(it.itemIds ?? []).map((i: string) => <Badge key={i} kind={store.some((s) => s.id === i) ? '' : 'bad'}>{store.find((s) => s.id === i)?.name ?? i}</Badge>)}</div>
      {edit && <div class="row" style="margin-top:10px" onClick={(e) => e.stopPropagation()}><Switch on={!!it.enabled} onChange={(v) => c.update(it.id, (x) => ({ ...x, enabled: v }))} /><div class="grow" /><Btn kind="ghost sm icon" icon="trash" onClick={async () => { if (await confirm({ title: `Delete ${it.name}?`, danger: true, ok: 'Delete' })) c.remove(it.id); }} /></div>}</div>); })}
      {!rows.length && <div class="empty">No sales scheduled</div>}</div>
    {sel && <SaleModal it={sel} isNew={isNew} edit={edit} store={store} ids={new Set(all.map((x) => x.id))} onClose={() => setSel(null)} onSave={(v) => { if (isNew) c.add(v); else c.update(sel.id, () => v); setSel(null); }} />}
  </>);
}
function SaleModal({ it, isNew, edit, store, ids, onClose, onSave }: { it: any; isNew: boolean; edit: boolean; store: any[]; ids: Set<string>; onClose: () => void; onSave: (v: any) => void }) {
  const [v, setV] = useState<any>(structuredClone(it)); const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val })); const slug = (v.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); const id = isNew ? 'sale.' + slug : v.id; const err = isNew && ids.has(id) ? 'A sale with this name exists' : null;
  return (<Modal title={isNew ? 'New sale' : v.name} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn>{edit && <Btn kind="pri" disabled={!slug || !!err} onClick={() => onSave({ ...v, id })}>{isNew ? 'Add sale' : 'Apply'}</Btn>}</>}>
    <div class="form"><Field label="Name" err={err} class="full"><input class="input" disabled={!edit} value={v.name} onInput={(e) => set('name', (e.target as HTMLInputElement).value)} /></Field><Field label="Percent off"><input class="input" type="number" min="1" max="90" disabled={!edit} value={v.percentOff} onInput={(e) => set('percentOff', Number((e.target as HTMLInputElement).value))} /></Field><div />
      <Field label="Starts"><input class="input" type="date" disabled={!edit} value={(v.from ?? '').slice(0, 10)} onInput={(e) => set('from', (e.target as HTMLInputElement).value)} /></Field><Field label="Ends"><input class="input" type="date" disabled={!edit} value={(v.to ?? '').slice(0, 10)} onInput={(e) => set('to', (e.target as HTMLInputElement).value)} /></Field>
      <div class="full col gap-sm"><label class="mut" style="font:600 11px var(--font);letter-spacing:.1em;text-transform:uppercase">Items on sale</label><div class="row wrap gap-sm">{store.map((s) => { const on = (v.itemIds ?? []).includes(s.id); return <button key={s.id} class={'btn sm ' + (on ? 'pri' : '')} disabled={!edit} onClick={() => set('itemIds', on ? v.itemIds.filter((x: string) => x !== s.id) : [...(v.itemIds ?? []), s.id])}>{s.name}</button>; })}</div></div></div></Modal>);
}

function Ledger({ can, names }: { can: boolean; names: Map<string, string> }) {
  const [status, setStatus] = useState('all'); const [q, setQ] = useState(''); const [page, setPage] = useState(0); const dq = useDebounced(q, 250); const [ref, setRef] = useState<PurchaseRow | null>(null); const PER = 30;
  const res = useFetch<{ rows: PurchaseRow[]; total: number }>(() => api.get('/store/purchases' + qs({ status, q: dq, limit: PER, offset: page * PER })), [status, dq, page]);
  return (<>
    <div class="row wrap"><input class="input" style="width:300px" placeholder="Search order, item, player or provider reference" value={q} onInput={(e) => { setQ((e.target as HTMLInputElement).value); setPage(0); }} /><Seg cur={status} on={(k) => { setStatus(k); setPage(0); }} opts={[['all', 'All'], ['paid', 'Paid'], ['refunded', 'Refunded'], ['failed', 'Failed']]} /><div class="grow" /><span class="mut">{fmt.n(res.data?.total ?? 0)} orders</span></div>
    {res.error ? <ErrorBox e={res.error} retry={res.reload} /> : !res.data ? <Loading /> : <div class="tblwrap"><table class="tbl"><thead><tr><th>Order</th><th>Player</th><th>Item</th><th class="num">Amount</th><th>Provider</th><th>Date</th><th>Status</th><th /></tr></thead><tbody>
      {res.data.rows.map((r) => (<tr key={r.id}><td class="mono">{r.id}<div class="dim" style="font-size:11px">{r.ref}</div></td><td><a href={'#/players/' + r.accountId}>{r.accountName ?? r.accountId}</a></td><td>{names.get(r.itemId) ?? r.itemId}{r.promo && <> <Badge kind="pur">{r.promo}</Badge></>}</td><td class="num">{fmt.money(r.amount, r.currency)}</td><td>{r.provider}</td><td class="mut">{fmt.date(r.createdAt)}</td><td><Badge kind={r.status === 'paid' ? 'good' : r.status === 'refunded' ? 'warn' : 'bad'}>{r.status}</Badge>{r.refundReason && <div class="dim" style="font-size:11.5px">{r.refundReason}</div>}</td><td class="right">{can && r.status === 'paid' && <Btn kind="sm" onClick={() => setRef(r)}>Refund</Btn>}</td></tr>))}
      {!res.data.rows.length && <tr><td colSpan={8} class="empty">No orders match</td></tr>}</tbody></table></div>}
    {(res.data?.total ?? 0) > PER && <div class="row"><Btn kind="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Btn><span class="mut">Page {page + 1} of {Math.ceil(res.data!.total / PER)}</span><Btn kind="sm" disabled={(page + 1) * PER >= res.data!.total} onClick={() => setPage(page + 1)}>Next</Btn></div>}
    {ref && <RefundModal r={ref} onClose={() => setRef(null)} done={() => { setRef(null); res.reload(); }} />}
  </>);
}
function RefundModal({ r, onClose, done }: { r: PurchaseRow; onClose: () => void; done: () => void }) {
  const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const go2 = async () => { try { const x = await api.post(`/store/purchases/${r.id}/refund`, { reason }); toast(x.note ?? 'Refunded', 'good'); done(); } catch (e) { setErr(errMsg(e)); } };
  return (<Modal title={`Refund ${r.id}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="danger" disabled={reason.trim().length < 5} onClick={go2}>Refund {fmt.money(r.amount, r.currency)}</Btn></>}>
    <div class="callout warn">This marks the order refunded in the ledger. Money goes back through {r.provider}: until the payment webhook is connected, send that refund from the {r.provider} dashboard too (ref {r.ref ?? 'none'}).</div><Field label="Reason" err={err}><input class="input" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} autofocus /></Field></Modal>);
}

function Revenue({ names }: { names: Map<string, string> }) {
  const [days, setDays] = useState('30'); const res = useFetch<any>(() => api.get('/store/revenue?days=' + days), [days]);
  const d = res.data; const lab = useMemo(() => (d?.series ?? []).map((s: any) => s.date.slice(5)), [d]);
  if (res.error) return <ErrorBox e={res.error} retry={res.reload} />; if (!d) return <Loading />;
  const t = d.totals; const maxItem = Math.max(1, ...d.byItem.map((i: any) => i.NGN + i.USD * 1500));
  return (<div class="col gap-lg">
    <div class="row"><Seg cur={days} on={setDays} opts={[['7', '7 days'], ['30', '30 days'], ['90', '90 days']]} /></div>
    <div class="grid g4"><Stat k="Naira revenue" v={fmt.naira(t.NGN)} s={`${fmt.naira(t.refundedNGN)} refunded`} tone="teal" /><Stat k="Dollar revenue" v={fmt.usd(t.USD)} s={`${fmt.usd(t.refundedUSD)} refunded`} /><Stat k="Paid orders" v={fmt.n(t.orders)} s={`${t.payers} paying players`} /><Stat k="Per paying player" v={fmt.naira(t.payers ? t.NGN / t.payers : 0)} s="naira only" /></div>
    <Panel title="Naira revenue per day"><AreaChart labels={lab} series={[{ name: 'Naira', data: d.series.map((s: any) => s.NGN) }]} fmtV={(v) => '₦' + (v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v))} /></Panel>
    <div class="grid g2"><Panel title="Orders per day"><BarChart labels={lab} data={d.series.map((s: any) => s.orders)} /></Panel><Panel title="Dollar revenue per day"><BarChart labels={lab} data={d.series.map((s: any) => s.USD)} color="#2de0c8" fmtV={(v) => '$' + Math.round(v)} /></Panel></div>
    <Panel title="Best sellers" flush><table class="tbl"><thead><tr><th>Item</th><th class="num">Orders</th><th class="num">NGN</th><th class="num">USD</th><th style="width:30%" /></tr></thead><tbody>{d.byItem.map((i: any) => (<tr key={i.itemId}><td>{names.get(i.itemId) ?? i.itemId}</td><td class="num">{i.orders}</td><td class="num">{fmt.naira(i.NGN)}</td><td class="num">{fmt.usd(i.USD)}</td><td><div style={`height:8px;border-radius:4px;background:linear-gradient(90deg,var(--teal),var(--pur));width:${((i.NGN + i.USD * 1500) / maxItem) * 100}%`} /></td></tr>))}</tbody></table></Panel>
  </div>);
}
void toastErr;
