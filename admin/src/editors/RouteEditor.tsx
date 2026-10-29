import { useEffect, useRef, useState } from 'preact/hooks';
import { cfg } from '../api';
import { AdminMap } from '../map/AdminMap';
import { Badge, Btn } from '../ui';

type Pt = { x: number; z: number };
const toPts = (r: any): Pt[] => (r.points ?? r.waypoints ?? r.path ?? []).map((p: any) => (Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x, z: p.z })).filter((p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.z));
const lenOf = (pts: Pt[]) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);

/** Draws a route on the 3D map. Click adds a point, drag moves one, alt-click removes one. */
export function RouteEditor({ route, edit, onChange }: { route: any; edit: boolean; onChange: (r: any) => void }) {
  const host = useRef<HTMLDivElement>(null); const mapRef = useRef<AdminMap | null>(null); const [ready, setReady] = useState(false); const [insert, setInsert] = useState(false);
  const pts = toPts(route); const routeRef = useRef(route); routeRef.current = route; const key = useRef(''); const field = route.points ? 'points' : route.waypoints ? 'waypoints' : route.path ? 'path' : 'points';
  useEffect(() => {
    const m = new AdminMap(host.current!, cfg.worldUrl); mapRef.current = m; m.init().then(() => { setReady(true); const p = toPts(routeRef.current); if (p.length) { const xs = p.map((q) => q.x), zs = p.map((q) => q.z); const w = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)); m.flyTo((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, Math.max(500, w * 1.1)); } else m.flyTo(0, 0, 2500); }).catch(() => {});
    return () => { m.dispose(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const m = mapRef.current; if (!m || !ready) return; const k = JSON.stringify(pts) + edit;
    if (key.current === k) return; key.current = k;
    const change = (np: Pt[]) => { const r = routeRef.current; key.current = JSON.stringify(np) + edit; onChange({ ...r, [field]: np, lengthM: Math.round(lenOf(np)) }); };
    if (edit) m.setEditPath({ points: pts, change, insert }); else { m.setEditPath(null); m.setLines('route', [{ id: 'r', points: pts, color: 0xf5c542, width: 5 }]); }
  }, [ready, JSON.stringify(pts), edit]);
  useEffect(() => { mapRef.current?.setEditInsert(insert); }, [insert, ready]);
  const set = (np: Pt[]) => onChange({ ...route, [field]: np, lengthM: Math.round(lenOf(np)) });
  return (
    <div class="panel" style="padding:0;overflow:hidden">
      <div class="row wrap" style="padding:10px 14px;border-bottom:1px solid var(--line)"><Badge kind="teal">{pts.length} points</Badge><Badge>{(lenOf(pts) / 1000).toFixed(2)} km straight lines</Badge>{route.lengthM ? <Badge kind="pur">stored length {(route.lengthM / 1000).toFixed(1)} km</Badge> : null}<div class="grow" />
        {edit && <><label class="row"><input type="checkbox" checked={insert} onChange={(e) => setInsert((e.target as HTMLInputElement).checked)} /> Insert between points</label><Btn kind="sm" disabled={!pts.length} onClick={() => set(pts.slice(0, -1))}>Undo last</Btn><Btn kind="sm" disabled={pts.length < 2} onClick={() => set([...pts].reverse())}>Reverse</Btn><Btn kind="sm danger" disabled={!pts.length} onClick={() => set([])}>Clear</Btn></>}
        <Btn kind="sm" onClick={() => { if (pts.length) mapRef.current?.flyTo(pts[0].x, pts[0].z, 600); }}>Go to start</Btn></div>
      <div ref={host} style="height:520px;position:relative">{!ready && <div class="empty" style="position:absolute;inset:0"><span class="spin" /></div>}</div>
      <div class="dim" style="padding:8px 14px;font-size:12px">{edit ? 'Click the map to add a point. Drag a point to move it. Alt-click a point to remove it. Green is the start, red the end.' : 'Your role can view this route but not edit it.'}</div>
    </div>
  );
}
