import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, cfg } from '../api';
import { AdminMap, ownerColor, type CircleItem, type LineItem, type ParcelState, type PinItem, type Picked } from '../map/AdminMap';
import { go, useCan } from '../session';
import { Badge, Btn, Field, Icon, confirm, errMsg, fmt, toast, toastErr, useDebounced } from '../ui';
import type { LivePlayer, PlotRec } from '@srv/types';
import { SanctionDialog } from './Players';

// layer catalogue: key, label, colour, kind of overlay
const POI_CATS: Record<string, [string, number]> = { bank: ['Banks', 0xe8c44a], atm: ['ATMs', 0xe8c44a], lga: ['LGA offices', 0x3ddc97], mechanic: ['Mechanic villages and workshops', 0xff8a4c], station: ['Train stations', 0x2de0c8], busStation: ['Bus stations', 0x5eb3ff], market: ['Markets', 0xd17bff], hospital: ['Hospitals and clinics', 0xff6b8b], pharmacy: ['Pharmacies', 0xff9ab0], police: ['Police', 0x6aa8ff], fuel: ['Fuel stations', 0xf5b84a], school: ['Schools', 0x7ee0ff], hotel: ['Hotels', 0x9b7be8], worship: ['Worship', 0xc9b27a], carWash: ['Car washes', 0x5eb3ff], ferry: ['Ferry points', 0x5eb3ff], airport: ['Airport', 0xcbd5e1] };
const DEFAULT_ON = new Set(['bank', 'lga', 'mechanic', 'station', 'busStation', 'market', 'police', 'airport']);
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const ROUTE_COL: Record<string, number> = { danfo: 0xf5c542, okada: 0x3ddc97, keke: 0xff8a4c, delivery: 0x5eb3ff, haulage: 0xd17bff };

interface Layer { key: string; label: string; color: number; count?: number }

export function MapPage({ focus }: { focus: URLSearchParams }) {
  const can = useCan(); const host = useRef<HTMLDivElement>(null); const mapRef = useRef<AdminMap | null>(null);
  const [ready, setReady] = useState(false); const [status, setStatus] = useState(''); const [cam, setCam] = useState({ x: 0, z: 0, dist: 0, near: false, regions: 0 });
  const [on, setOn] = useState<Record<string, boolean>>(() => ({ parcels: true, players: true, missions: true, routes: true, events: true, potholes: false, factions: true, shops: true, skyline: true, buildings: true, outlines: true, ...Object.fromEntries(Object.keys(POI_CATS).map((k) => [`poi:${k}`, DEFAULT_ON.has(k)])) }));
  const [parcelMode, setParcelMode] = useState<'status' | 'owner' | 'zone'>('status'); const [sel, setSel] = useState<Picked | null>(null); const [hover, setHover] = useState<{ p: Picked; x: number; y: number } | null>(null);
  const [plots, setPlots] = useState<PlotRec[]>([]); const [live, setLive] = useState<LivePlayer[]>([]); const [overrides, setOverrides] = useState<Record<string, any>>({}); const [pois, setPois] = useState<[string, string | null, number, number][]>([]);
  const [content, setContent] = useState<Record<string, any[]>>({}); const [potholes, setPotholes] = useState<any[]>([]); const [q, setQ] = useState(''); const dq = useDebounced(q, 120); const [showLayers, setShowLayers] = useState(true);
  const results = useMemo(() => (mapRef.current && dq ? mapRef.current.search(dq) : []), [dq, ready]);
  const [sanction, setSanction] = useState<{ id: string; name: string } | null>(null);

  // ---- engine lifetime
  useEffect(() => {
    const m = new AdminMap(host.current!, cfg.worldUrl); mapRef.current = m; (window as any).__adminMap = m;
    m.onPick = (p) => { setSel(p); m.highlight(p); }; m.onCamera = (c) => setCam((o) => (Math.abs(o.x - c.x) + Math.abs(o.z - c.z) + Math.abs(o.dist - c.dist) < 1 && o.regions === c.regions ? o : c)); m.onStatus = setStatus;
    m.setHover((p, x, y) => setHover(p ? { p, x, y } : null));
    m.init().then(() => setReady(true)).catch((e) => setStatus('Map failed to start: ' + errMsg(e)));
    return () => { m.dispose(); mapRef.current = null; (window as any).__adminMap = null; };
  }, []);

  // ---- data
  const load = async () => {
    try { const r = await api.get('/map/plots'); setPlots(r.plots); } catch (e) { toastErr(e); }
    try { const r = await api.get('/map/pois'); setOverrides(Object.fromEntries(r.overrides.map((o: any) => [o.id, o]))); } catch { /* optional */ }
    const kinds = ['missions', 'routes', 'events', 'npcs', 'shops']; const out: Record<string, any[]> = {};
    await Promise.all(kinds.map(async (k) => { try { out[k] = (await api.get(`/content/${k}`)).doc.items; } catch { out[k] = []; } })); setContent(out);
  };
  useEffect(() => { load(); fetch('./map/pois.json').then((r) => r.json()).then(setPois).catch(() => {}); fetch(cfg.worldUrl + 'potholes.json').then((r) => r.json()).then((j) => setPotholes(j.reports ?? [])).catch(() => {}); }, []);
  useEffect(() => { let alive = true; const t = async () => { try { const r = await api.get('/map/live'); if (alive) setLive(r.players); } catch { /* ignore */ } }; t(); const i = setInterval(t, 3000); return () => { alive = false; clearInterval(i); }; }, []);

  // ---- push data into the engine
  const m = mapRef.current;
  useEffect(() => { if (!m || !ready) return; const st = new Map<string, ParcelState>(); const pins: PinItem[] = [];
    for (const p of plots) { const s: ParcelState = { status: p.ownerId ? 'owned' : p.forSale ? 'forsale' : 'vacant', ownerId: p.ownerId, ownerName: p.ownerName, price: p.price, flags: p.flags }; if (!p.ownerId && !p.forSale && !p.flags.length) continue; st.set(p.id, s); const flagged = p.flags.length > 0; pins.push({ id: p.id, x: p.x, z: p.z, size: 7, color: flagged ? 0xff5d73 : p.ownerId ? (parcelMode === 'owner' ? ownerColor(p.ownerId).getHex() : 0x2de0c8) : 0xf5b84a, label: p.name ?? undefined, data: { plot: p } }); }
    m.setParcelStates(st); m.setPins('parcels', pins, { size: 7, order: 1 }); m.setLayerVisible('parcels', on.parcels); }, [m, ready, plots, parcelMode]);
  useEffect(() => { if (!m || !ready) return; m.setParcelMode(parcelMode); }, [m, ready, parcelMode]);
  useEffect(() => { if (!m || !ready) return; m.setPins('players', live.map((p) => ({ id: p.id, x: p.x, z: p.z, size: 15, color: 0xffffff, label: p.name, data: { player: p } })), { size: 15, labels: true, order: 6 }); m.setLayerVisible('players', on.players); }, [m, ready, live]);
  useEffect(() => { if (!m || !ready) return;
    const groups = new Map<string, PinItem[]>(); pois.forEach((p, i) => { const id = 'poi:' + i; const ov = overrides[id]; if (ov?.hidden) return; const cat = ov?.type ?? p[0]; if (!POI_CATS[cat]) return; const arr = groups.get(cat) ?? []; arr.push({ id, x: ov?.x ?? p[2], z: ov?.z ?? p[3], label: ov?.name ?? p[1] ?? undefined, color: POI_CATS[cat][1], size: 9, data: { cat, name: ov?.name ?? p[1], base: p[1], overridden: !!ov } }); groups.set(cat, arr); });
    for (const [id, ov] of Object.entries(overrides)) if (ov.custom && !id.startsWith('poi:')) { const cat = ov.type ?? 'bank'; const arr = groups.get(cat) ?? []; arr.push({ id, x: ov.x, z: ov.z, label: ov.name, color: POI_CATS[cat]?.[1] ?? 0xffffff, size: 11, data: { cat, name: ov.name, custom: true } }); groups.set(cat, arr); }
    for (const k of Object.keys(POI_CATS)) { m.setPins('poi:' + k, groups.get(k) ?? [], { size: 9, labels: k === 'lga' || k === 'mechanic' || k === 'airport', order: 2 }); m.setLayerVisible('poi:' + k, !!on['poi:' + k]); } }, [m, ready, pois, overrides]);
  useEffect(() => { if (!m || !ready) return; const ms: any[] = content.missions ?? [];
    m.setPins('missions', ms.filter((x) => typeof x.giver?.x === 'number').map((x) => ({ id: x.id, x: x.giver.x, z: x.giver.z, size: 14, color: 0xffd45e, label: x.giver.name ?? x.title, data: { mission: x } })), { size: 14, labels: true, order: 5 }); m.setLayerVisible('missions', on.missions);
    const routeOf = (r: any) => (r.points ?? r.waypoints ?? r.path ?? []).map((p: any) => (Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x, z: p.z }));
    m.setLines('routes', (content.routes ?? []).map((r: any): LineItem => ({ id: r.id, points: routeOf(r), color: ROUTE_COL[r.kind] ?? 0xf5c542, width: 5, label: r.name, data: { route: r } })), { labels: true }); m.setLayerVisible('routes', on.routes);
    m.setLines('missionroutes', ms.filter((x) => x.routeId).map((x): LineItem => { const r = (content.routes ?? []).find((q: any) => q.id === x.routeId); return { id: x.id + ':route', points: r ? routeOf(r) : [], color: 0xffd45e, width: 3, dashed: true, label: x.title, data: { mission: x } }; }), {}); m.setLayerVisible('missionroutes', on.missions);
    m.setCircles('events', (content.events ?? []).filter((e: any) => e.at && typeof e.at.x === 'number').map((e: any): CircleItem => ({ id: e.id, x: e.at.x, z: e.at.z, r: e.at.r ?? 150, color: 0xff8a4c, label: e.name, data: { event: e } })), { labels: true }); m.setLayerVisible('events', on.events);
    m.setCircles('factions', (content.npcs ?? []).filter((f: any) => f.territory?.center).map((f: any): CircleItem => ({ id: f.id, x: f.territory.center.x, z: f.territory.center.z, r: f.territory.radius ?? 300, color: parseInt((f.color ?? '#8b5cf6').slice(1), 16), label: f.name, data: { faction: f }, fill: 0.11 })), { labels: true }); m.setLayerVisible('factions', on.factions);
    m.setPins('shops', (content.shops ?? []).filter((s: any) => typeof s.x === 'number').map((s: any) => ({ id: s.id, x: s.x, z: s.z, size: 11, color: 0x2de0c8, label: s.name, data: { shop: s } })), { size: 11, labels: true, order: 4 }); m.setLayerVisible('shops', on.shops); }, [m, ready, content]);
  useEffect(() => { if (!m || !ready || !m.store?.manifest) return; const t = setInterval(() => { if (!m.store?.manifest) return; clearInterval(t); m.setPins('potholes', potholes.map((p: any, i: number) => { const pr = m.store.project(p.lat, p.lon); return { id: 'ph' + i, x: pr.x, z: pr.z, size: 8 + (p.severity ?? 1) * 2, color: 0xff5d73, label: p.name, data: { pothole: p } }; }), { size: 10, order: 3 }); m.setLayerVisible('potholes', on.potholes); }, 400); return () => clearInterval(t); }, [m, ready, potholes]);
  useEffect(() => { if (!m || !ready) return; for (const k of Object.keys(on)) { if (k === 'skyline' || k === 'parcels' || k.startsWith('poi:') || ['players', 'missions', 'routes', 'events', 'potholes', 'factions', 'shops'].includes(k)) m.setLayerVisible(k, on[k]); } m.setLayerVisible('missionroutes', on.missions); m.setBuildings(on.buildings); m.setParcelLines(on.outlines); }, [m, ready, on]);

  // ---- focus links (?x=&z=&player=&plot=)
  useEffect(() => { if (!m || !ready) return; const x = Number(focus.get('x')), z = Number(focus.get('z')); if (focus.has('x') && Number.isFinite(x) && Number.isFinite(z)) { m.flyTo(x, z, focus.get('plot') ? 450 : 700); const pid = focus.get('player'); const pl = focus.get('plot'); setTimeout(() => { if (pid) { const p = live.find((q) => q.id === pid); const pk: Picked = { kind: 'pin', layer: 'players', id: pid, x: p?.x ?? x, z: p?.z ?? z, label: p?.name, data: { player: p ?? { id: pid, name: pid } } }; setSel(pk); m.highlight(pk); } else if (pl) { const rec = plots.find((q) => q.id === pl); if (rec) { const pk: Picked = { kind: 'pin', layer: 'parcels', id: rec.id, x: rec.x, z: rec.z, label: rec.name ?? rec.id, data: { plot: rec } }; setSel(pk); m.highlight(pk); } } }, 1000); } }, [m, ready, focus.toString(), plots.length]);

  const layers: Layer[] = [
    { key: 'parcels', label: 'Parcels', color: 0x2de0c8, count: plots.length }, { key: 'players', label: 'Live players', color: 0xffffff, count: live.length }, { key: 'missions', label: 'Mission givers and routes', color: 0xffd45e, count: (content.missions ?? []).length }, { key: 'routes', label: 'Routes', color: 0xf5c542, count: (content.routes ?? []).length },
    { key: 'events', label: 'Events', color: 0xff8a4c, count: (content.events ?? []).filter((e: any) => e.at).length }, { key: 'factions', label: 'Factions and territories', color: 0x8b5cf6, count: (content.npcs ?? []).filter((f: any) => f.territory).length }, { key: 'shops', label: 'Shops', color: 0x2de0c8, count: (content.shops ?? []).length }, { key: 'potholes', label: 'Potholes (reports)', color: 0xff5d73, count: potholes.length },
  ];
  const poiCount = (k: string) => pois.filter((p) => p[0] === k).length;
  const pickResult = (r: { n: string; k: string; x: number; z: number }) => { setQ(''); m?.flyTo(r.x, r.z, r.k === 'road' ? 1500 : r.k.startsWith('poi:place') ? 2500 : 700); const pk: Picked = { kind: 'ground', layer: 'search', id: r.n, x: r.x, z: r.z, label: r.n, data: { place: r } }; setSel(pk); m?.highlight(pk); };
  const doPick = (p: Picked | null) => { setSel(p); m?.highlight(p); };

  return (
    <div class="mapwrap" ref={host}>
      <div class="hud tl col" style="gap:8px;z-index:6">
        <div class="search"><input class="input" placeholder="Search a place, road or landmark" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />{results.length > 0 && <div class="glass results">{results.map((r, i) => <button key={i} onClick={() => pickResult(r)}><Icon n="pin" s={15} /><span class="grow">{r.n}</span><span class="dim" style="font-size:11px">{r.k.replace('poi:', '').replace('place:', '')}</span></button>)}</div>}</div>
        {showLayers ? (
          <div class="glass layers"><div class="row"><h3 class="grow">Layers</h3><Btn kind="ghost sm icon" onClick={() => setShowLayers(false)}>&minus;</Btn></div>
            {layers.map((l) => <label class="layer" key={l.key}><input type="checkbox" checked={!!on[l.key]} onChange={(e) => setOn({ ...on, [l.key]: (e.target as HTMLInputElement).checked })} /><span class="sw" style={`background:${hex(l.color)}`} />{l.label}<span class="n">{l.count ?? ''}</span></label>)}
            {on.parcels && <div class="row" style="margin:4px 0 8px 22px"><div class="seg">{([['status', 'Status'], ['owner', 'Owner'], ['zone', 'Zone']] as const).map(([k, t]) => <button key={k} class={parcelMode === k ? 'on' : ''} onClick={() => setParcelMode(k)}>{t}</button>)}</div></div>}
            <h3 style="margin-top:10px">Places</h3>
            {Object.entries(POI_CATS).map(([k, [lbl, c]]) => <label class="layer" key={k}><input type="checkbox" checked={!!on['poi:' + k]} onChange={(e) => setOn({ ...on, ['poi:' + k]: (e.target as HTMLInputElement).checked })} /><span class="sw" style={`background:${hex(c)}`} />{lbl}<span class="n">{poiCount(k)}</span></label>)}
            <h3 style="margin-top:10px">Detail</h3>
            {([['skyline', 'Skyline (tall buildings)'], ['buildings', '3D buildings (close up)'], ['outlines', 'Parcel outlines (close up)']] as const).map(([k, t]) => <label class="layer" key={k}><input type="checkbox" checked={!!on[k]} onChange={(e) => setOn({ ...on, [k]: (e.target as HTMLInputElement).checked })} />{t}</label>)}
          </div>) : <Btn onClick={() => setShowLayers(true)} icon="map">Layers</Btn>}
      </div>
      {sel && <div class="hud tr glass inspect"><Inspector sel={sel} can={can} plots={plots} content={content} live={live} overrides={overrides} map={m} onClose={() => doPick(null)} reload={load} onSanction={(p) => setSanction(p)} /></div>}
      <div class="hud bl col" style="gap:8px">
        {status && <div class="callout warn" style="max-width:420px">{status}</div>}
        <div class="glass mapstat"><span>x <b class="mono">{Math.round(cam.x)}</b> z <b class="mono">{Math.round(cam.z)}</b></span><span>height <b>{cam.dist > 1000 ? (cam.dist / 1000).toFixed(1) + ' km' : Math.round(cam.dist) + ' m'}</b></span><span>{cam.near ? <>close-up <b>{cam.regions}</b> regions</> : 'whole-map view'}</span><span class="dim">drag: pan | right-drag: rotate | wheel: zoom | WASD fly</span></div>
      </div>
      <div class="hud br row" style="gap:8px"><Btn kind="glass" onClick={() => m?.fitAll()} icon="map">Whole map</Btn><Btn onClick={() => m?.flyTo(0, 0, 2200)}>Oshodi</Btn><Btn onClick={() => { m?.controls.target && m?.setView(m.controls.target.x, m.controls.target.z, Math.max(300, cam.dist), 0.05); }}>Top down</Btn></div>
      {hover && !sel?.id.startsWith(hover.p.id) && <div class="glass" style={`position:absolute;left:${hover.x + 14}px;top:${hover.y + 10}px;padding:5px 9px;font-size:12px;z-index:7;pointer-events:none`}>{hover.p.label ?? hover.p.id}<span class="dim"> {hover.p.layer.replace('poi:', '')}</span></div>}
      {!ready && <div class="login" style="position:absolute;inset:0;z-index:9"><div class="empty"><span class="spin" /><div style="margin-top:10px">Loading the Lagos map</div></div></div>}
      {sanction && <SanctionDialog p={sanction} kind="mute" onClose={() => setSanction(null)} done={() => setSanction(null)} />}
    </div>
  );
}

function Inspector({ sel, can, plots, content, live, overrides, map, onClose, reload, onSanction }: { sel: Picked; can: (p: any) => boolean; plots: PlotRec[]; content: Record<string, any[]>; live: LivePlayer[]; overrides: Record<string, any>; map: AdminMap | null; onClose: () => void; reload: () => void; onSanction: (p: { id: string; name: string }) => void }) {
  const d = sel.data ?? {}; const head = (t: string, sub?: string) => <div class="row"><div class="grow"><h2>{t}</h2>{sub && <div class="dim mono" style="font-size:11.5px">{sub}</div>}</div><Btn kind="ghost sm icon" icon="x" onClick={onClose} /></div>;
  if (sel.kind === 'parcel' || d.plot) return <ParcelInspector sel={sel} can={can} plots={plots} map={map} onClose={onClose} reload={reload} />;
  if (d.player) { const p = live.find((x) => x.id === d.player.id) ?? d.player; return (<div class="col">{head(p.name, p.id)}<dl class="kv"><dt>Activity</dt><dd>{p.activity ?? 'unknown'}</dd><dt>Level</dt><dd>{p.level ?? '-'}</dd><dt>Position</dt><dd class="mono">{Math.round(p.x ?? sel.x)}, {Math.round(p.z ?? sel.z)}</dd></dl><div class="row wrap"><Btn kind="pri sm" onClick={() => go('players/' + p.id)}>Open profile</Btn>{can('players.moderate') && <Btn kind="sm warn" icon="mute" onClick={() => onSanction({ id: p.id, name: p.name })}>Sanction</Btn>}<Btn kind="sm" onClick={() => map?.flyTo(sel.x, sel.z, 400)}>Zoom in</Btn></div></div>); }
  if (d.mission) { const x = d.mission; return (<div class="col">{head(x.title ?? x.id, x.id)}<dl class="kv"><dt>Giver</dt><dd>{x.giver?.name ?? '-'}</dd><dt>Level</dt><dd>{x.level ?? '-'}</dd><dt>Reward</dt><dd>{x.reward?.cash ? fmt.naira(x.reward.cash) : '-'} {x.reward?.xp ? `| ${x.reward.xp} xp` : ''}</dd><dt>Steps</dt><dd>{x.steps?.length ?? 0}</dd></dl>{x.summary && <div class="mut">{x.summary}</div>}<div class="row"><Btn kind="pri sm" onClick={() => go('content/missions/' + x.id)}>Edit mission</Btn></div></div>); }
  if (d.route) { const x = d.route; return (<div class="col">{head(x.name ?? x.id, x.id)}<dl class="kv"><dt>Kind</dt><dd>{x.kind}</dd><dt>Length</dt><dd>{x.lengthM ? (x.lengthM / 1000).toFixed(1) + ' km' : '-'}</dd><dt>Pay</dt><dd>{x.pay ? fmt.naira(x.pay) : '-'}</dd><dt>Points</dt><dd>{(x.points ?? []).length}</dd></dl>{x.desc && <div class="mut">{x.desc}</div>}<Btn kind="pri sm" onClick={() => go('content/routes/' + x.id)}>Edit route</Btn></div>); }
  if (d.event) { const x = d.event; return (<div class="col">{head(x.name, x.id)}<dl class="kv"><dt>Kind</dt><dd>{x.kind}</dd><dt>Chance</dt><dd>{x.chance}</dd><dt>Duration</dt><dd>{x.duration}s</dd></dl>{x.desc && <div class="mut">{x.desc}</div>}<Btn kind="pri sm" onClick={() => go('content/events/' + x.id)}>Edit event</Btn></div>); }
  if (d.faction) { const x = d.faction; return (<div class="col">{head(x.name, x.id)}<dl class="kv"><dt>Hostile</dt><dd>{x.hostile ? 'Yes' : 'No'}</dd><dt>Strength</dt><dd>{x.strength}</dd><dt>Territory</dt><dd>{x.territory?.radius} m radius</dd></dl>{x.desc && <div class="mut">{x.desc}</div>}<Btn kind="pri sm" onClick={() => go('content/npcs/' + x.id)}>Edit faction</Btn></div>); }
  if (d.shop) { const x = d.shop; return (<div class="col">{head(x.name, x.id)}<dl class="kv"><dt>Kind</dt><dd>{x.kind}</dd><dt>Stock</dt><dd>{(x.stock ?? []).length} items</dd></dl><Btn kind="pri sm" onClick={() => go('content/shops/' + x.id)}>Edit shop</Btn></div>); }
  if (d.pothole) { const x = d.pothole; return (<div class="col">{head(x.name ?? 'Pothole report')}<dl class="kv"><dt>Road</dt><dd>{x.road}</dd><dt>Area</dt><dd>{x.area}</dd><dt>Severity</dt><dd>{x.severity} of 5</dd><dt>Reported</dt><dd>{x.reported}</dd></dl><div class="mut">{x.note}</div></div>); }
  if (d.cat) return <PoiInspector sel={sel} can={can} overrides={overrides} onClose={onClose} reload={reload} />;
  return <GroundInspector sel={sel} can={can} onClose={onClose} reload={reload} map={map} />;
}

function PoiInspector({ sel, can, overrides, onClose, reload }: { sel: Picked; can: (p: any) => boolean; overrides: Record<string, any>; onClose: () => void; reload: () => void }) {
  const d = sel.data; const [name, setName] = useState(d.name ?? ''); const [type, setType] = useState(d.cat); useEffect(() => { setName(d.name ?? ''); setType(d.cat); }, [sel.id]);
  const edit = can('map.edit'); const save = async () => { try { await api.put('/map/pois/' + encodeURIComponent(sel.id), { name: name || d.base || 'Unnamed', type }); toast('POI saved', 'good'); reload(); } catch (e) { toastErr(e); } };
  const reset = async () => { try { await api.del('/map/pois/' + encodeURIComponent(sel.id)); toast('Back to the map data', 'good'); reload(); onClose(); } catch (e) { toastErr(e); } };
  const hide = async () => { if (!(await confirm({ title: 'Hide this place?', ok: 'Hide', body: <div>It disappears from the admin map and the override is logged. The base map data is not changed.</div> }))) return; try { await api.put('/map/pois/' + encodeURIComponent(sel.id), { hidden: true }); reload(); onClose(); } catch (e) { toastErr(e); } };
  return (<div class="col"><div class="row"><div class="grow"><h2>{d.name || 'Unnamed place'}</h2><div class="dim mono" style="font-size:11.5px">{sel.id}</div></div><Btn kind="ghost sm icon" icon="x" onClick={onClose} /></div>
    <dl class="kv"><dt>Type</dt><dd><Badge kind="teal">{POI_CATS[d.cat]?.[0] ?? d.cat}</Badge> {d.custom && <Badge kind="pur">custom</Badge>} {d.overridden && <Badge kind="warn">edited</Badge>}</dd><dt>Position</dt><dd class="mono">{Math.round(sel.x)}, {Math.round(sel.z)}</dd>{d.base && d.base !== d.name && <><dt>Map name</dt><dd>{d.base}</dd></>}</dl>
    {edit && <><Field label="Name"><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field><Field label="Type"><select class="input" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>{Object.entries(POI_CATS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <div class="row wrap"><Btn kind="pri sm" onClick={save}>Save</Btn>{(d.overridden || d.custom) && <Btn kind="sm" onClick={reset}>{d.custom ? 'Delete' : 'Reset to map data'}</Btn>}{!d.custom && <Btn kind="sm danger" onClick={hide}>Hide</Btn>}</div></>}</div>);
}

function GroundInspector({ sel, can, onClose, reload, map }: { sel: Picked; can: (p: any) => boolean; onClose: () => void; reload: () => void; map: AdminMap | null }) {
  const [name, setName] = useState(''); const [type, setType] = useState('market'); const edit = can('map.edit'); const near = useMemo(() => { const p = map?.search(sel.label ?? '', 1)[0]; return p; }, [sel.id]);
  const add = async () => { try { await api.put('/map/pois/' + encodeURIComponent('custom.' + Date.now().toString(36)), { name, type, x: Math.round(sel.x), z: Math.round(sel.z) }); toast('Place added', 'good'); reload(); onClose(); } catch (e) { toastErr(e); } };
  return (<div class="col"><div class="row"><div class="grow"><h2>{sel.label ?? 'Map point'}</h2></div><Btn kind="ghost sm icon" icon="x" onClick={onClose} /></div><dl class="kv"><dt>Position</dt><dd class="mono">{Math.round(sel.x)}, {Math.round(sel.z)}</dd>{sel.data?.place && <><dt>Kind</dt><dd>{String(sel.data.place.k).replace('poi:', '')}</dd></>}</dl>
    {edit && <div class="sub-card col"><h3>Add a place here</h3><Field label="Name"><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field><Field label="Type"><select class="input" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>{Object.entries(POI_CATS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field><Btn kind="pri sm" disabled={!name} onClick={add}>Add place</Btn></div>}
    <div class="dim" style="font-size:12px">Click a pin, a parcel or a route to inspect it. Zoom in for parcels and buildings.</div>{near && null}</div>);
}

function ParcelInspector({ sel, can, plots, map, onClose, reload }: { sel: Picked; can: (p: any) => boolean; plots: PlotRec[]; map: AdminMap | null; onClose: () => void; reload: () => void }) {
  const id = sel.parcel?.id ?? sel.id; const rec = plots.find((p) => p.id === id) ?? sel.data?.plot; const info = sel.parcel ?? map?.findParcel(id)?.parcel;
  const [price, setPrice] = useState(String(rec?.price ?? info?.defaultPrice ?? 0)); const [owner, setOwner] = useState(rec?.ownerId ?? ''); const [forSale, setForSale] = useState(!!rec?.forSale); const [flags, setFlags] = useState((rec?.flags ?? []).join(', ')); const [busy, setBusy] = useState(false);
  useEffect(() => { setPrice(String(rec?.price ?? info?.defaultPrice ?? 0)); setOwner(rec?.ownerId ?? ''); setForSale(!!rec?.forSale); setFlags((rec?.flags ?? []).join(', ')); }, [id, rec?.price, rec?.ownerId, rec?.forSale]);
  const edit = can('players.economy') && can('map.edit'); const ownerName = rec?.ownerName;
  const save = async () => { setBusy(true); try { await api.put('/map/plots/' + encodeURIComponent(id), { price: Number(price), ownerId: owner || null, forSale: owner ? false : forSale, flags: flags.split(',').map((s: any) => s.trim()).filter(Boolean), x: info?.cx ?? sel.x, z: info?.cz ?? sel.z, zone: info?.zone, area: info ? Math.round(info.area) : undefined }); toast('Parcel saved', 'good'); reload(); } catch (e) { toastErr(e); } finally { setBusy(false); } };
  const release = async () => { if (!(await confirm({ title: 'Release this parcel?', danger: true, ok: 'Release', body: <div>{ownerName ?? 'The owner'} loses it. It goes back to vacant stock. Logged in the audit trail.</div> }))) return; setBusy(true); try { await api.put('/map/plots/' + encodeURIComponent(id), { ownerId: null, forSale: false }); toast('Released', 'good'); reload(); } catch (e) { toastErr(e); } finally { setBusy(false); } };
  const status = rec?.ownerId ? 'Owned' : rec?.forSale ? 'For sale' : 'Vacant stock';
  return (
    <div class="col"><div class="row"><div class="grow"><h2>{info?.name ?? rec?.name ?? 'Parcel'}</h2><div class="dim mono" style="font-size:11.5px">{id}</div></div><Btn kind="ghost sm icon" icon="x" onClick={onClose} /></div>
      <div class="row wrap"><Badge kind={rec?.ownerId ? 'teal' : rec?.forSale ? 'warn' : ''}>{status}</Badge>{(rec?.flags ?? []).map((f: string) => <Badge key={f} kind="bad">{f}</Badge>)}{info && <Badge>{info.zone}</Badge>}</div>
      <dl class="kv">{rec?.ownerId && <><dt>Owner</dt><dd><a href={'#/players/' + rec.ownerId}>{ownerName ?? rec.ownerId}</a></dd></>}{info && <><dt>Area</dt><dd>{fmt.n(info.area)} m2</dd><dt>Wealth band</dt><dd>{Math.round(info.rich * 100)}% (drives walls and price)</dd><dt>Base price</dt><dd>{fmt.naira(info.defaultPrice)}</dd></>}<dt>Current price</dt><dd>{fmt.naira(rec?.price ?? info?.defaultPrice)}</dd><dt>Centre</dt><dd class="mono">{Math.round(info?.cx ?? sel.x)}, {Math.round(info?.cz ?? sel.z)}</dd>{info && info.buildings.length > 0 && <><dt>Buildings</dt><dd>{info.buildings.length}{info.buildings.some((b) => b.name) ? ': ' + info.buildings.filter((b) => b.name).map((b) => b.name).slice(0, 3).join(', ') : ''}</dd></>}</dl>
      {!info && <div class="callout" style="font-size:12px">Zoom in to load this parcel's outline and buildings.</div>}
      {edit && <div class="sub-card col"><h3>Edit parcel</h3><Field label="Price (NGN)"><input class="input" type="number" min="0" value={price} onInput={(e) => setPrice((e.target as HTMLInputElement).value)} /></Field><Field label="Owner account id" help="Blank means nobody owns it."><input class="input mono" placeholder="acc_..." value={owner} onInput={(e) => setOwner((e.target as HTMLInputElement).value.trim())} /></Field>
        <div class="row"><label class="row"><input type="checkbox" checked={forSale} disabled={!!owner} onChange={(e) => setForSale((e.target as HTMLInputElement).checked)} /> Listed for sale</label></div><Field label="Flags" help="Comma separated, for example disputed, no-build"><input class="input" value={flags} onInput={(e) => setFlags((e.target as HTMLInputElement).value)} /></Field>
        <div class="row wrap"><Btn kind="pri sm" disabled={busy} onClick={save}>Save parcel</Btn>{rec?.ownerId && <Btn kind="danger sm" disabled={busy} onClick={release}>Release to stock</Btn>}</div></div>}
    </div>
  );
}
void errMsg;
