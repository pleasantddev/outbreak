// Content validation shared by the server (on save) and the admin app (before save). Tolerant of unknown fields:
// it only checks the things it recognises, because other workstreams own the exact shapes in schema.ts.
import type { Issue } from './types';

export const CONTENT_KINDS = ['missions', 'events', 'routes', 'skills', 'npcs', 'shops', 'economy', 'iap'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export interface ContentDoc { version: number; items: any[] }

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,79}$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const WORLD = { x0: -22000, x1: 12000, z0: -20500, z1: 12500 };

export function validateContent(kind: string, doc: unknown): Issue[] {
  const out: Issue[] = []; const err = (path: string, msg: string) => out.push({ level: 'error', path, msg }); const warn = (path: string, msg: string) => out.push({ level: 'warn', path, msg });
  if (!isObj(doc)) { err('', 'File must be an object with version and items'); return out; }
  if (!isNum(doc.version)) err('version', 'version must be a number');
  if (!Array.isArray(doc.items)) { err('items', 'items must be an array'); return out; }
  const seen = new Map<string, number>();
  doc.items.forEach((it: any, i: number) => {
    const p = `items[${i}]`;
    if (!isObj(it)) { err(p, 'item must be an object'); return; }
    if (typeof it.id !== 'string' || !it.id) { err(p + '.id', 'id is required (stable string)'); return; }
    if (!ID_RE.test(it.id)) err(p + '.id', `id "${it.id}" may only use letters, digits and . _ : -`);
    if (seen.has(it.id)) err(p + '.id', `duplicate id "${it.id}" (also item ${seen.get(it.id)})`); else seen.set(it.id, i);
  });
  const ids = new Set(seen.keys());
  const V = VALIDATORS[kind as ContentKind]; if (V) V(doc.items, ids, err, warn);
  return out;
}

type Err = (path: string, msg: string) => void;
const nonNeg = (v: any, path: string, err: Err, what = 'value') => { if (v !== undefined && (!isNum(v) || v < 0)) err(path, `${what} must be a number of 0 or more`); };
function checkPos(o: any, path: string, err: Err, warn: Err) {
  if (!isObj(o)) return; const x = o.x ?? o.pos?.x, z = o.z ?? o.pos?.z;
  if (x === undefined && z === undefined) return;
  if (!isNum(x) || !isNum(z)) { err(path, 'position needs numeric x and z'); return; }
  if (x < WORLD.x0 || x > WORLD.x1 || z < WORLD.z0 || z > WORLD.z1) warn(path, `position (${Math.round(x)}, ${Math.round(z)}) is outside the Lagos map`);
}
function cycle(nodes: Map<string, string[]>) {
  const state = new Map<string, number>(); let hit: string | null = null;
  const dfs = (n: string, stack: string[]) => { state.set(n, 1); for (const m of nodes.get(n) ?? []) { if (!nodes.has(m)) continue; if (state.get(m) === 1) { hit = [...stack, n, m].join(' > '); return; } if (!state.get(m)) dfs(m, [...stack, n]); if (hit) return; } state.set(n, 2); };
  for (const n of nodes.keys()) { if (!state.get(n)) dfs(n, []); if (hit) break; } return hit as string | null;
}
/** Outgoing step references of a mission step, whatever the author called them. */
export function stepRefs(s: any): string[] {
  const r: string[] = [];
  for (const k of ['next', 'onSuccess', 'onFail', 'onTimeout', 'goto', 'else', 'then']) { const v = s?.[k]; if (typeof v === 'string' && v) r.push(v); else if (Array.isArray(v)) for (const q of v) if (typeof q === 'string') r.push(q); else if (isObj(q) && typeof q.to === 'string') r.push(q.to); }
  if (Array.isArray(s?.choices)) for (const c of s.choices) if (typeof c?.next === 'string') r.push(c.next);
  if (Array.isArray(s?.branches)) for (const c of s.branches) if (typeof c?.next === 'string') r.push(c.next);
  return r;
}

const VALIDATORS: Partial<Record<ContentKind, (items: any[], ids: Set<string>, err: Err, warn: Err) => void>> = {
  missions(items, ids, err, warn) {
    items.forEach((m, i) => {
      const p = `items[${i}]`; if (!isObj(m)) return;
      if (m.title !== undefined && typeof m.title !== 'string') err(p + '.title', 'title must be text');
      checkPos(m.giver, p + '.giver', err, warn); checkPos(m.start, p + '.start', err, warn);
      if (isObj(m.reward)) { for (const k of ['cash', 'xp']) if (typeof m.reward[k] !== 'object') nonNeg(m.reward[k], `${p}.reward.${k}`, err, k); }
      for (const q of m.requires ?? m.prereq ?? []) if (typeof q === 'string' && !ids.has(q) && /^m[._-]/.test(q)) warn(p + '.requires', `requires unknown mission "${q}"`);
      if (Array.isArray(m.steps)) {
        const sid = new Map<string, number>(); m.steps.forEach((s: any, k: number) => { if (!isObj(s) || typeof s.id !== 'string') { err(`${p}.steps[${k}]`, 'step needs a string id'); return; } if (sid.has(s.id)) err(`${p}.steps[${k}].id`, `duplicate step id "${s.id}"`); sid.set(s.id, k); });
        const edges = new Map<string, string[]>();
        m.steps.forEach((s: any, k: number) => { if (!isObj(s) || !s.id) return; const refs = stepRefs(s); edges.set(s.id, refs); for (const r of refs) if (!sid.has(r) && r !== 'end' && r !== 'complete' && r !== 'fail') err(`${p}.steps[${k}]`, `step "${s.id}" points at missing step "${r}"`); checkPos(s.at ?? s.target ?? s, `${p}.steps[${k}]`, err, warn); });
        const first = m.entry ?? m.startStep ?? m.steps[0]?.id;
        if (first && !sid.has(first)) err(p + '.entry', `entry step "${first}" does not exist`);
        if (first && sid.has(first)) { const reach = new Set<string>(); const go = (n: string) => { if (reach.has(n)) return; reach.add(n); for (const r of edges.get(n) ?? []) go(r); }; go(first); for (const s of sid.keys()) if (!reach.has(s)) warn(p + '.steps', `step "${s}" can never be reached`); }
        if (m.steps.length === 0) warn(p + '.steps', 'mission has no steps');
      }
    });
  },
  skills(items, ids, err, warn) {
    const edges = new Map<string, string[]>();
    items.forEach((s, i) => {
      const p = `items[${i}]`; if (!isObj(s)) return;
      const req: string[] = Array.isArray(s.requires) ? s.requires.filter((q: any) => typeof q === 'string') : typeof s.requires === 'string' ? [s.requires] : typeof s.parent === 'string' ? [s.parent] : [];
      edges.set(s.id, req);
      for (const r of req) if (!ids.has(r)) err(p + '.requires', `requires unknown skill "${r}"`);
      nonNeg(s.cost, p + '.cost', err, 'cost'); nonNeg(s.maxRank ?? s.ranks, p + '.maxRank', err, 'ranks'); nonNeg(s.level, p + '.level', err, 'level');
      if (Array.isArray(s.modes)) { const mid = new Set<string>(); s.modes.forEach((q: any, k: number) => { if (!isObj(q) || typeof q.id !== 'string') err(`${p}.modes[${k}]`, 'mode needs an id'); else if (mid.has(q.id)) err(`${p}.modes[${k}].id`, `duplicate mode "${q.id}"`); else mid.add(q.id); }); }
    });
    const c = cycle(edges); if (c) err('items', `skill requirements loop: ${c}`);
  },
  routes(items, _ids, err, warn) {
    items.forEach((r, i) => {
      const p = `items[${i}]`; if (!isObj(r)) return;
      const pts = r.points ?? r.waypoints ?? r.path;
      if (pts === undefined) { warn(p, 'route has no points'); return; }
      if (!Array.isArray(pts) || pts.length < 2) { err(p + '.points', 'a route needs at least 2 points'); return; }
      pts.forEach((q: any, k: number) => { const x = Array.isArray(q) ? q[0] : q?.x, z = Array.isArray(q) ? q[1] : q?.z; if (!isNum(x) || !isNum(z)) err(`${p}.points[${k}]`, 'point needs numeric x and z'); else if (x < WORLD.x0 || x > WORLD.x1 || z < WORLD.z0 || z > WORLD.z1) warn(`${p}.points[${k}]`, 'point is outside the Lagos map'); });
      nonNeg(r.fare, p + '.fare', err, 'fare'); nonNeg(r.pay, p + '.pay', err, 'pay');
    });
  },
  events(items, _ids, err, warn) {
    items.forEach((e, i) => {
      const p = `items[${i}]`; if (!isObj(e)) return;
      nonNeg(e.weight, p + '.weight', err, 'weight'); nonNeg(e.cooldown, p + '.cooldown', err, 'cooldown'); nonNeg(e.duration, p + '.duration', err, 'duration');
      if (e.chance !== undefined && (!isNum(e.chance) || e.chance < 0 || e.chance > 1)) err(p + '.chance', 'chance must be between 0 and 1');
      checkPos(e.at ?? e, p, err, warn);
    });
  },
  npcs(items, _ids, err) {
    items.forEach((n, i) => { const p = `items[${i}]`; if (!isObj(n)) return; if (n.weight !== undefined) nonNeg(n.weight, p + '.weight', err, 'weight'); if (n.wage !== undefined) nonNeg(n.wage, p + '.wage', err, 'wage'); });
  },
  shops(items, _ids, err, warn) {
    items.forEach((s, i) => {
      const p = `items[${i}]`; if (!isObj(s)) return;
      nonNeg(s.price, p + '.price', err, 'price'); nonNeg(s.priceNGN, p + '.priceNGN', err, 'price');
      if (Array.isArray(s.stock)) s.stock.forEach((q: any, k: number) => { if (isObj(q)) nonNeg(q.price, `${p}.stock[${k}].price`, err, 'price'); });
      checkPos(s, p, err, warn);
    });
  },
  economy(items, _ids, err, warn) {
    items.forEach((e, i) => {
      const p = `items[${i}]`; if (!isObj(e)) return;
      if (!('value' in e)) { warn(p, 'no value field'); return; }
      if (typeof e.value === 'number') {
        if (!Number.isFinite(e.value)) err(p + '.value', 'value must be a finite number');
        if (isNum(e.min) && e.value < e.min) err(p + '.value', `${e.value} is below the minimum ${e.min}`);
        if (isNum(e.max) && e.value > e.max) err(p + '.value', `${e.value} is above the maximum ${e.max}`);
        if (isNum(e.min) && isNum(e.max) && e.min > e.max) err(p + '.min', 'min is above max');
        if (e.integer === true && !Number.isInteger(e.value)) err(p + '.value', 'must be a whole number');
        if (/(price|wage|fee|cost|tax|fine|rent|salary)/i.test(e.id) && e.value < 0) err(p + '.value', 'money values cannot be negative');
      }
    });
  },
  iap(items, ids, err, warn) {
    const codes = new Map<string, string>();
    items.forEach((it, i) => {
      const p = `items[${i}]`; if (!isObj(it)) return; const t = it.type ?? 'item';
      if (!['currency', 'bundle', 'cosmetic', 'boost', 'pass', 'promo', 'sale', 'item'].includes(t)) warn(p + '.type', `unknown type "${t}"`);
      if (t === 'promo') {
        if (typeof it.code !== 'string' || !/^[A-Z0-9_-]{3,24}$/.test(it.code)) err(p + '.code', 'code must be 3 to 24 characters: A-Z, 0-9, _ or -');
        else if (codes.has(it.code)) err(p + '.code', `code ${it.code} already used by ${codes.get(it.code)}`); else codes.set(it.code, it.id);
        if (!isNum(it.percentOff) && !isNum(it.amountOffNGN)) err(p, 'promo needs percentOff or amountOffNGN');
        if (isNum(it.percentOff) && (it.percentOff <= 0 || it.percentOff > 100)) err(p + '.percentOff', 'percent must be 1 to 100');
      } else if (t === 'sale') {
        if (!isNum(it.percentOff) || it.percentOff <= 0 || it.percentOff > 90) err(p + '.percentOff', 'sale percent must be 1 to 90');
        for (const q of it.itemIds ?? []) if (!ids.has(q)) err(p + '.itemIds', `unknown store item "${q}"`);
      } else {
        if (!isNum(it.priceNGN) || it.priceNGN <= 0) err(p + '.priceNGN', 'price in NGN must be above 0');
        else if (!Number.isInteger(it.priceNGN)) err(p + '.priceNGN', 'NGN price must be a whole number');
        if (!isNum(it.priceUSD) || it.priceUSD <= 0) err(p + '.priceUSD', 'price in USD must be above 0');
        else if (Math.round(it.priceUSD * 100) !== it.priceUSD * 100 && Math.abs(Math.round(it.priceUSD * 100) - it.priceUSD * 100) > 1e-6) err(p + '.priceUSD', 'USD price can have at most 2 decimals');
        if (isNum(it.priceNGN) && isNum(it.priceUSD) && it.priceUSD > 0) { const rate = it.priceNGN / it.priceUSD; if (rate < 300 || rate > 4000) warn(p, `NGN and USD prices imply ${Math.round(rate)} NGN per USD, which looks off`); }
        if (!it.name) warn(p + '.name', 'no display name');
        if (it.grants !== undefined && !isObj(it.grants)) err(p + '.grants', 'grants must be an object');
        for (const k of ['cash', 'gems', 'bank']) if (isObj(it.grants)) nonNeg(it.grants[k], `${p}.grants.${k}`, err, k);
      }
      if (it.from && it.to && Date.parse(it.from) >= Date.parse(it.to)) err(p, 'window start must be before its end');
      if (it.availableFrom && it.availableTo && Date.parse(it.availableFrom) >= Date.parse(it.availableTo)) err(p, 'availability window start must be before its end');
      for (const k of ['from', 'to', 'availableFrom', 'availableTo']) if (it[k] && Number.isNaN(Date.parse(it[k]))) err(`${p}.${k}`, 'not a valid date');
    });
  },
};

export const hasErrors = (i: Issue[]) => i.some((x) => x.level === 'error');
