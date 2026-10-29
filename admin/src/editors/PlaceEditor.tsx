import { useEffect, useRef, useState } from 'preact/hooks';
import { cfg } from '../api';
import { AdminMap } from '../map/AdminMap';
import { Badge, Btn } from '../ui';

type Spot = { label: string; get: (i: any) => { x: number; z: number; r?: number } | null; set: (i: any, x: number, z: number) => any; color: number; radius?: (i: any) => number | undefined };
const SPOTS: Spot[] = [
  { label: 'Location', get: (i) => (typeof i.x === 'number' && typeof i.z === 'number' ? { x: i.x, z: i.z } : null), set: (i, x, z) => ({ ...i, x, z }), color: 0x2de0c8 },
  { label: 'Event area', get: (i) => (i.at && typeof i.at.x === 'number' ? { x: i.at.x, z: i.at.z, r: i.at.r } : null), set: (i, x, z) => ({ ...i, at: { ...i.at, x, z } }), color: 0xff8a4c },
  { label: 'Mission giver', get: (i) => (i.giver && typeof i.giver.x === 'number' ? { x: i.giver.x, z: i.giver.z } : null), set: (i, x, z) => ({ ...i, giver: { ...i.giver, x, z } }), color: 0xffd45e },
  { label: 'Territory centre', get: (i) => (i.territory?.center ? { x: i.territory.center.x, z: i.territory.center.z, r: i.territory.radius } : null), set: (i, x, z) => ({ ...i, territory: { ...i.territory, center: { x, z } } }), color: 0x8b5cf6 },
  { label: 'Home', get: (i) => (i.home && typeof i.home.x === 'number' ? { x: i.home.x, z: i.home.z } : null), set: (i, x, z) => ({ ...i, home: { ...i.home, x, z } }), color: 0xffffff },
];

/** Puts a single item (shop, event, giver, territory, home) on the 3D map. Click the map to move the active spot. */
export function PlaceEditor({ item, kind, edit, onChange }: { item: any; kind: string; edit: boolean; onChange: (i: any) => void }) {
  const host = useRef<HTMLDivElement>(null); const mapRef = useRef<AdminMap | null>(null); const [ready, setReady] = useState(false);
  const avail = SPOTS.filter((s) => s.get(item)); const options = kind === 'shops' ? [SPOTS[0]] : kind === 'events' ? [SPOTS[1]] : kind === 'npcs' ? [SPOTS[3], SPOTS[4]] : kind === 'missions' ? [SPOTS[2]] : avail.length ? avail : [SPOTS[0]];
  const [act, setAct] = useState(0); const spot = options[Math.min(act, options.length - 1)]; const itemRef = useRef(item); itemRef.current = item; const spotRef = useRef(spot); spotRef.current = spot; const editRef = useRef(edit); editRef.current = edit;
  useEffect(() => {
    const m = new AdminMap(host.current!, cfg.worldUrl); mapRef.current = m;
    m.onGround = (x, z) => { if (!editRef.current) return false; onChange(spotRef.current.set(itemRef.current, Math.round(x), Math.round(z))); return true; };
    m.init().then(() => setReady(true)).catch(() => {});
    return () => { m.dispose(); mapRef.current = null; };
  }, []);
  const jumped = useRef('');
  useEffect(() => {
    const m = mapRef.current; if (!m || !ready) return; const pins: any[] = [], circ: any[] = [];
    for (const s of options) { const g = s.get(item); if (!g) continue; pins.push({ id: s.label, x: g.x, z: g.z, size: s === spot ? 20 : 14, color: s.color, label: s.label }); if (g.r) circ.push({ id: s.label, x: g.x, z: g.z, r: g.r, color: s.color, fill: 0.14 }); }
    m.setPins('item', pins, { labels: true, order: 20 }); m.setCircles('item', circ, {});
    const g = spot.get(item); if (g && jumped.current !== item.id + spot.label) { jumped.current = item.id + spot.label; m.flyTo(g.x, g.z, g.r ? Math.max(600, g.r * 3) : 500); } else if (!g && jumped.current !== item.id + 'none') { jumped.current = item.id + 'none'; m.flyTo(0, 0, 2500); }
  }, [ready, item, act]);
  const g = spot.get(item);
  return (
    <div class="panel" style="padding:0;overflow:hidden">
      <div class="row wrap" style="padding:10px 14px;border-bottom:1px solid var(--line)">
        {options.length > 1 && <div class="seg">{options.map((o, i) => <button key={o.label} class={act === i ? 'on' : ''} onClick={() => setAct(i)}>{o.label}</button>)}</div>}
        {g ? <Badge kind="teal">{spot.label}: {Math.round(g.x)}, {Math.round(g.z)}{g.r ? ` | radius ${g.r} m` : ''}</Badge> : <Badge kind="warn">{spot.label} not placed yet</Badge>}<div class="grow" />
        {g && <Btn kind="sm" onClick={() => mapRef.current?.flyTo(g.x, g.z, 400)}>Zoom to it</Btn>}</div>
      <div ref={host} style="height:480px;position:relative">{!ready && <div class="empty" style="position:absolute;inset:0"><span class="spin" /></div>}</div>
      <div class="dim" style="padding:8px 14px;font-size:12px">{edit ? `Click anywhere on the map to set the ${spot.label.toLowerCase()}.` : 'View only.'}</div>
    </div>
  );
}
