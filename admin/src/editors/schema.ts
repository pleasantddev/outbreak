// Schema model for the content forms. Three layers, later ones win:
//  1. inferred from the data itself (so any shape gets a usable form, even before schema.ts catches up)
//  2. generated from v2/src/content/schema.ts by tools/gen-schema.ts (src/generated/schema.json)
//  3. curated hints below (labels, enums, references to other content files)
import generated from '../generated/schema.json';

export type FType = 'string' | 'text' | 'number' | 'boolean' | 'enum' | 'stringlist' | 'numberlist' | 'pos' | 'object' | 'array' | 'json' | 'color' | 'ref' | 'reflist' | 'date';
export interface FieldDef { key: string; label: string; type: FType; options?: string[]; children?: FieldDef[]; item?: FieldDef; ref?: string; help?: string; min?: number; max?: number; optional?: boolean; wide?: boolean; unit?: string }

const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v);

function inferValue(key: string, vals: any[]): FieldDef {
  const v = vals.find((x) => x !== undefined && x !== null); const base = { key, label: humanize(key), optional: vals.some((x) => x === undefined) };
  if (v === undefined) return { ...base, type: 'json' };
  if (typeof v === 'boolean') return { ...base, type: 'boolean' };
  if (typeof v === 'number') return { ...base, type: 'number' };
  if (typeof v === 'string') { const long = vals.some((x) => typeof x === 'string' && (x.length > 70 || x.includes('\n'))); if (/^#[0-9a-f]{6}$/i.test(v) && /color|colour/i.test(key)) return { ...base, type: 'color' }; if (/^\d{4}-\d\d-\d\d/.test(v) && /(from|to|start|end|date|until)/i.test(key)) return { ...base, type: 'date' }; return { ...base, type: long ? 'text' : 'string', wide: long }; }
  if (Array.isArray(v)) {
    const flat = vals.filter(Array.isArray).flat();
    if (flat.every((x) => typeof x === 'string')) return { ...base, type: 'stringlist', wide: true };
    if (flat.every((x) => typeof x === 'number')) return { ...base, type: 'numberlist' };
    if (flat.every(isObj)) return { ...base, type: 'array', wide: true, item: { key: '#', label: 'Entry', type: 'object', children: inferObject(flat) } };
    return { ...base, type: 'json', wide: true };
  }
  if (isObj(v)) {
    const objs = vals.filter(isObj); const keys = new Set(objs.flatMap(Object.keys));
    if ([...keys].every((k) => ['x', 'z', 'r', 'y'].includes(k)) && keys.has('x') && keys.has('z')) return { ...base, type: 'pos' };
    return { ...base, type: 'object', wide: true, children: inferObject(objs) };
  }
  return { ...base, type: 'json' };
}
function inferObject(objs: any[]): FieldDef[] {
  const keys: string[] = []; for (const o of objs) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k);
  return keys.map((k) => inferValue(k, objs.map((o) => o[k])));
}

type Hint = Partial<FieldDef> & { children?: Record<string, Partial<FieldDef>> };
/** Curated hints by content kind. Keys that do not exist in the data are ignored; missing ones are added when `add` is set. */
const HINTS: Record<string, { order?: string[]; fields: Record<string, Hint>; add?: string[] }> = {
  missions: { order: ['id', 'title', 'summary', 'giver', 'level', 'requires', 'repeatable', 'tags', 'reward', 'routeId'], fields: { requires: { type: 'reflist', ref: 'missions' }, routeId: { type: 'ref', ref: 'routes' }, summary: { type: 'text', wide: true }, giver: { type: 'object' } } },
  skills: { order: ['id', 'tree', 'name', 'desc', 'tier', 'requires', 'cost', 'maxRank', 'level', 'effects', 'modes'], fields: { requires: { type: 'reflist', ref: 'skills' }, tree: { type: 'string' }, tier: { type: 'number', min: 1, max: 9 } } },
  events: { order: ['id', 'name', 'kind', 'desc', 'weight', 'chance', 'duration', 'cooldown', 'at', 'hours', 'season', 'effects'], fields: { kind: { type: 'enum', options: ['street', 'weather', 'economy', 'transport', 'crowd', 'city', 'crime', 'social'] }, chance: { type: 'number', min: 0, max: 1 }, desc: { type: 'text', wide: true } } },
  routes: { order: ['id', 'name', 'kind', 'desc', 'pay', 'lengthM', 'stops', 'points'], fields: { kind: { type: 'enum', options: ['danfo', 'okada', 'keke', 'delivery', 'haulage', 'walk', 'other'] }, points: { type: 'json' }, desc: { type: 'text', wide: true } } },
  npcs: { order: ['id', 'type', 'name', 'faction', 'color', 'weight', 'hp', 'wage', 'home', 'territory', 'dialog'], fields: { type: { type: 'enum', options: ['archetype', 'faction'] }, faction: { type: 'ref', ref: 'npcs' }, color: { type: 'color' } } },
  shops: { order: ['id', 'name', 'kind', 'x', 'z', 'stock'], fields: { kind: { type: 'enum', options: ['paint', 'plates', 'trackers', 'electronics', 'decor', 'food', 'clothes', 'fuel', 'other'] } } },
};

const gen = generated as Record<string, FieldDef[]>;
const singular = (k: string) => k.replace(/ies$/, 'y').replace(/s$/, '');

export function schemaFor(kind: string, items: any[]): FieldDef[] {
  const inferred = inferObject(items.length ? items : [{ id: '' }]);
  const byKey = new Map(inferred.map((f) => [f.key, f]));
  for (const g of gen[kind] ?? gen[singular(kind)] ?? []) { const cur = byKey.get(g.key); byKey.set(g.key, { ...(cur ?? {}), ...g, children: g.children ?? cur?.children, item: g.item ?? cur?.item }); }
  const h = HINTS[kind];
  if (h) for (const [k, hint] of Object.entries(h.fields)) { const cur = byKey.get(k); if (cur) byKey.set(k, { ...cur, ...hint, children: cur.children } as FieldDef); }
  const fields = [...byKey.values()];
  const order = h?.order ?? ['id', 'name', 'title'];
  fields.sort((a, b) => { const ia = order.indexOf(a.key), ib = order.indexOf(b.key); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib); });
  return fields.map((f) => (f.key === 'id' ? { ...f, type: 'string' as FType, label: 'Id' } : f));
}

export function blank(fields: FieldDef[]): any {
  const o: any = {};
  for (const f of fields) { if (f.optional && f.key !== 'id') continue; o[f.key] = blankValue(f); }
  return o;
}
export function blankValue(f: FieldDef): any {
  switch (f.type) { case 'number': return 0; case 'boolean': return false; case 'stringlist': case 'reflist': case 'numberlist': case 'array': return []; case 'object': return blank(f.children ?? []); case 'pos': return { x: 0, z: 0 }; case 'enum': return f.options?.[0] ?? ''; default: return ''; }
}
