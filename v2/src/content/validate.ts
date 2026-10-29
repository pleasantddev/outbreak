// Content checker for places, missions, events, routes and skills. Pure TypeScript with no DOM, so the vitest and the
// admin panel can both call it. Errors mean the game would break or show a dead end; warnings are suspicious but playable.
import { FACTIONS, STAT_KEYS, type Cond, type EventDef, type Fx, type MissionDef, type PlaceDef, type PlaceRef, type RouteDef, type SkillDef, type StepDef } from './schema';
import { projector } from './game';

export interface Issue { level: 'error' | 'warn'; where: string; msg: string }
export interface Bundle { places: PlaceDef[]; missions: MissionDef[]; events: EventDef[]; routes: RouteDef[]; skills: SkillDef[] }
export interface Manifest { origin: { lat: number; lon: number }; regionSize: number; regions: Record<string, unknown> }

const VEHICLES = new Set(['okada', 'danfo', 'suv', 'sedan', 'hatch', 'jeep', 'police', 'keke']);
const WEAPONS = new Set(['pistol', 'smg', 'ar', 'shotgun', 'sniper', 'machete', 'fists']);
const ROLES = new Set(['area', 'ped', 'police']);
const ID = /^[a-z0-9_]+$/;
const PLACE_KINDS = new Set(['park', 'market', 'bank', 'station', 'junction', 'church', 'mosque', 'school', 'hospital', 'police', 'fuel', 'mechanic', 'shop', 'food', 'bar', 'office', 'estate', 'bridge', 'jetty', 'landmark', 'street', 'compound', 'stop']);
const CATS = new Set(['story', 'transport', 'delivery', 'trade', 'crime', 'community', 'racing', 'mechanic', 'land', 'student', 'police', 'rescue']);
const WEATHER = new Set(['clear', 'hot', 'harmattan', 'fog', 'rain', 'storm']);

/** Every step type's outgoing edges. 'flow' means the next element of the steps array (or an explicit next). */
export function edgesOf(st: StepDef, nextId: string | undefined): { targets: string[]; flow: boolean } {
  const t: string[] = []; const a = st as any; let flow = true;
  if (st.type === 'end') return { targets: [], flow: false };
  if (st.type === 'choice') { flow = false; for (const o of a.options ?? []) { if (o.next) t.push(o.next); if (o.roll) { t.push(o.roll.ok, o.roll.bad); } } }
  else if (st.type === 'branch') { flow = false; for (const c of a.cases ?? []) t.push(c.next); t.push(a.else); }
  else if (st.type === 'call') { flow = false; t.push(a.answer, a.decline); }
  else if (st.next) { t.push(st.next); flow = false; }
  for (const k of ['onTimeout', 'onFail', 'onSpot', 'onWalk', 'onBroke']) if (a[k]) t.push(a[k]);
  if (flow && nextId) t.push(nextId);
  return { targets: t.filter(Boolean), flow };
}

export function placeRefs(st: StepDef): PlaceRef[] {
  const a = st as any; const out: PlaceRef[] = [];
  for (const k of ['to', 'at', 'from', 'provide']) if (a[k] !== undefined && typeof a[k] !== 'number') out.push(a[k]);
  if (Array.isArray(a.places)) out.push(...a.places);
  if (Array.isArray(a.checkpoints)) out.push(...a.checkpoints);
  if (Array.isArray(a.guards)) for (const g of a.guards) out.push(g.at);
  return out.filter((x) => x !== undefined && x !== null);
}

export function validateContent(b: Bundle, manifest?: Manifest): Issue[] {
  const out: Issue[] = []; const err = (where: string, msg: string) => out.push({ level: 'error', where, msg }); const warn = (where: string, msg: string) => out.push({ level: 'warn', where, msg });
  const dup = (kind: string, ids: string[]) => { const seen = new Set<string>(); for (const id of ids) { if (!ID.test(id)) err(`${kind}:${id}`, 'id must be lowercase letters, digits and underscores'); if (seen.has(id)) err(`${kind}:${id}`, 'duplicate id'); seen.add(id); } };
  dup('place', b.places.map((p) => p.id)); dup('mission', b.missions.map((p) => p.id)); dup('event', b.events.map((p) => p.id)); dup('route', b.routes.map((p) => p.id)); dup('skill', b.skills.map((p) => p.id));
  const places = new Map(b.places.map((p) => [p.id, p])); const missions = new Map(b.missions.map((m) => [m.id, m])); const routes = new Map(b.routes.map((r) => [r.id, r])); const skills = new Map(b.skills.map((s) => [s.id, s]));
  const project = manifest ? projector(manifest.origin) : null;
  const inMap = (lat: number, lon: number) => { if (!manifest || !project) return true; const w = project(lat, lon); const s = manifest.regionSize; return `${Math.floor(w.x / s)},${Math.floor(w.z / s)}` in manifest.regions; };

  // ---- places
  for (const p of b.places) {
    const w = `place:${p.id}`;
    if (!p.name) err(w, 'missing name'); if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) { err(w, 'bad coordinates'); continue; }
    if (p.lat < 6.3 || p.lat > 6.8 || p.lon < 3.0 || p.lon > 3.7) err(w, `coordinates ${p.lat},${p.lon} are not in Lagos`);
    else if (!inMap(p.lat, p.lon)) err(w, 'outside the map regions that exist');
    if (p.kind && !PLACE_KINDS.has(p.kind)) err(w, `unknown kind ${p.kind}`);
    if (p.r !== undefined && (p.r < 3 || p.r > 80)) warn(w, 'radius outside 3 to 80 m');
  }
  const refOk = (where: string, ref: PlaceRef | undefined) => {
    if (ref === undefined || ref === null) { err(where, 'missing place'); return; }
    if (typeof ref === 'string') { if (!places.has(ref)) err(where, `unknown place "${ref}"`); return; }
    if (!Number.isFinite(ref.lat) || !Number.isFinite(ref.lon)) err(where, 'bad inline place'); else if (!inMap(ref.lat, ref.lon)) err(where, 'inline place outside the map');
  };
  const condOk = (where: string, c: Cond | undefined) => {
    if (!c) return;
    for (const k of Object.keys(c.skill ?? {})) if (!skills.has(k)) err(where, `unknown skill "${k}"`);
    for (const k of Object.keys(c.rep ?? {})) if (!(k in FACTIONS)) err(where, `unknown faction "${k}"`);
    for (const id of [...(c.after ?? []), ...(c.notAfter ?? [])]) if (!missions.has(id)) err(where, `unknown mission "${id}"`);
    for (const v of c.vehicle ?? []) if (!VEHICLES.has(v)) err(where, `unknown vehicle "${v}"`);
    for (const wv of c.weather ?? []) if (!WEATHER.has(wv)) err(where, `unknown weather "${wv}"`);
    if (c.roll && !skills.has(c.roll.skill)) err(where, `unknown skill "${c.roll.skill}"`);
    if (c.hours && (c.hours.length !== 2 || c.hours.some((h) => h < 0 || h > 24))) err(where, 'hours must be two numbers 0 to 24');
  };
  const fxOk = (where: string, f: Fx | undefined) => {
    if (!f) return;
    for (const k of Object.keys(f.skillXp ?? {})) if (!skills.has(k)) err(where, `unknown skill "${k}"`);
    for (const k of Object.keys(f.rep ?? {})) if (!(k in FACTIONS)) err(where, `unknown faction "${k}"`);
    for (const id of [f.offerMission, f.startMission]) if (id && !missions.has(id)) err(where, `unknown mission "${id}"`);
    if (f.weather && !WEATHER.has(f.weather)) err(where, `unknown weather "${f.weather}"`);
    if (f.wanted !== undefined && (f.wanted < 0 || f.wanted > 5)) err(where, 'wanted must be 0 to 5');
    if (f.cash !== undefined && !Number.isFinite(f.cash)) err(where, 'bad cash');
  };
  const noDash = (where: string, v: unknown) => { const walk = (x: unknown) => { if (typeof x === 'string') { if (x.includes('—')) err(where, `em dash in text: "${x.slice(0, 40)}"`); } else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); }; walk(v); };

  // ---- step graphs, shared by missions and events
  const graph = (kind: string, id: string, steps: StepDef[], start: string, mustWin: boolean) => {
    const w = `${kind}:${id}`;
    if (!steps.length) { err(w, 'no steps'); return; }
    const idx = new Map<string, number>(); steps.forEach((s, i) => { if (!s.id) err(w, `step ${i} has no id`); else if (idx.has(s.id)) err(w, `duplicate step id "${s.id}"`); idx.set(s.id, i); });
    if (!idx.has(start)) { err(w, `start step "${start}" does not exist`); return; }
    const adj = new Map<string, string[]>(); let falls = 0;
    steps.forEach((s, i) => {
      const nextId = steps[i + 1]?.id; const e = edgesOf(s, nextId);
      if (e.flow && !nextId) falls++;
      for (const t of e.targets) if (!idx.has(t)) err(`${w}/${s.id}`, `points at missing step "${t}"`);
      adj.set(s.id, e.targets.filter((t) => idx.has(t)));
      const sw = `${w}/${s.id}`;
      for (const r of placeRefs(s)) refOk(sw, r);
      fxOk(sw, s.fx); fxOk(sw, s.done);
      const a = s as any;
      if (s.type === 'route') { const rd = routes.get(a.route); if (!rd) err(sw, `unknown route "${a.route}"`); else if (a.skip !== undefined && a.skip >= rd.stops.length) err(sw, 'skip is past the last stop'); }
      if (s.type === 'vehicle') for (const k of a.kind ?? []) if (!VEHICLES.has(k)) err(sw, `unknown vehicle "${k}"`);
      if (s.type === 'goto' && a.vehicle) for (const k of a.vehicle) if (!VEHICLES.has(k)) err(sw, `unknown vehicle "${k}"`);
      if (s.type === 'tail' && !VEHICLES.has(a.kind)) err(sw, `unknown vehicle "${a.kind}"`);
      if (s.type === 'race' && a.vehicle) for (const k of a.vehicle) if (!VEHICLES.has(k)) err(sw, `unknown vehicle "${k}"`);
      const foes = [...(a.foes ?? []), ...(a.ambush ?? []), ...((a.waves ?? []).flat?.() ?? [])];
      for (const f of foes) { if (f.weapon && !WEAPONS.has(f.weapon)) err(sw, `unknown weapon "${f.weapon}"`); if (f.role && !ROLES.has(f.role)) err(sw, `unknown role "${f.role}"`); if (!(f.n >= 1 && f.n <= 12)) err(sw, 'foe count must be 1 to 12'); }
      if (s.type === 'choice') {
        if (!a.options?.length) err(sw, 'choice has no options'); else if (a.options.length > 4) err(sw, 'choice has more than 4 options (keys 1 to 4)');
        for (const o of a.options ?? []) { condOk(sw, o.if); fxOk(sw, o.fx); if (o.roll) { if (!skills.has(o.roll.skill)) err(sw, `unknown skill "${o.roll.skill}"`); fxOk(sw, o.roll.okFx); fxOk(sw, o.roll.badFx); } }
      }
      if (s.type === 'branch') for (const c of a.cases ?? []) condOk(sw, c.if);
      if (s.type === 'tap' && a.skill && !skills.has(a.skill)) err(sw, `unknown skill "${a.skill}"`);
      if (s.type === 'end' && a.rewards) fxOk(sw, a.rewards);
      if (s.timer !== undefined && s.timer <= 0) err(sw, 'timer must be positive');
      if (s.type === 'talk' && !(a.lines?.length)) err(sw, 'talk has no lines');
    });
    // reachability from start, and can every reachable step still reach an end?
    const seen = new Set<string>(); const stack = [start]; while (stack.length) { const x = stack.pop()!; if (seen.has(x)) continue; seen.add(x); for (const t of adj.get(x) ?? []) stack.push(t); }
    for (const s of steps) if (!seen.has(s.id)) err(`${w}/${s.id}`, 'unreachable step');
    const rev = new Map<string, string[]>(); for (const [k, ts] of adj) for (const t of ts) { if (!rev.has(t)) rev.set(t, []); rev.get(t)!.push(k); }
    const ends = steps.filter((s) => s.type === 'end' || (edgesOf(s, steps[steps.indexOf(s) + 1]?.id).flow && !steps[steps.indexOf(s) + 1]));
    const good = new Set<string>(); const q = ends.map((s) => s.id); while (q.length) { const x = q.pop()!; if (good.has(x)) continue; good.add(x); for (const p of rev.get(x) ?? []) q.push(p); }
    for (const id of seen) if (!good.has(id)) err(`${w}/${id}`, 'dead end: no path from here reaches an end step');
    if (mustWin && !steps.some((s) => s.type === 'end' && (s as any).outcome === 'win' && seen.has(s.id))) err(w, 'no reachable win end');
    if (falls) warn(w, `${falls} step(s) fall off the end of the list (counts as a win)`);
    // items that are delivered or needed must be handed out somewhere
    const given = new Set<string>(); for (const s of steps) { const a = s as any; if (s.type === 'pickup') given.add(a.item); if (s.type === 'trade' && a.buy) given.add(a.buy.item); for (const f of [s.fx, s.done, a.rewards]) for (const g of f?.giveItem ?? []) given.add(g); for (const o of a.options ?? []) for (const g of [...(o.fx?.giveItem ?? []), ...(o.roll?.okFx?.giveItem ?? []), ...(o.roll?.badFx?.giveItem ?? [])]) given.add(g); }
    for (const s of steps) { const a = s as any; if (s.type === 'deliver' && !given.has(a.item)) err(`${w}/${s.id}`, `delivers "${a.item}" but nothing ever hands it over`); if (s.type === 'trade' && a.sell && !given.has(a.sell.item)) warn(`${w}/${s.id}`, `sells "${a.sell.item}" that is never obtained`); }
  };

  // ---- missions
  const legacy = new Map<string, string>();
  for (const m of b.missions) {
    const w = `mission:${m.id}`;
    if (!m.title || !m.blurb || !m.giver) err(w, 'needs title, blurb and giver');
    if (!CATS.has(m.category)) err(w, `unknown category "${m.category}"`);
    if (!(m.difficulty >= 1 && m.difficulty <= 5)) err(w, 'difficulty must be 1 to 5'); if (!(m.minutes > 0 && m.minutes <= 30)) err(w, 'minutes must be 1 to 30');
    if (!m.rewards || (m.rewards.cash ?? 0) < 0) err(w, 'needs rewards');
    condOk(w, m.req); fxOk(w, m.rewards); fxOk(w, m.penalty);
    if (m.offer?.giver) refOk(w + '/giver', m.offer.giver.at);
    if (m.legacy) { if (legacy.has(m.legacy)) err(w, `legacy id "${m.legacy}" already used by ${legacy.get(m.legacy)}`); legacy.set(m.legacy, m.id); }
    if (m.repeat && !(m.repeat.cooldownMin >= 0)) err(w, 'bad repeat');
    if (m.req?.after?.includes(m.id)) err(w, 'requires itself');
    graph('mission', m.id, m.steps, m.start, true);
    noDash(w, m);
  }
  for (const k of ['delivery', 'danfo', 'parcel']) if (!legacy.has(k)) err('missions', `no mission has legacy id "${k}" (startJob would break)`);
  // requirement cycles
  const state = new Map<string, number>(); const dfs = (id: string, path: string[]) => { const s = state.get(id); if (s === 1) { err(`mission:${id}`, `requirement cycle: ${[...path, id].join(' > ')}`); return; } if (s === 2) return; state.set(id, 1); for (const a of missions.get(id)?.req?.after ?? []) if (missions.has(a)) dfs(a, [...path, id]); state.set(id, 2); };
  for (const m of b.missions) dfs(m.id, []);

  // ---- events
  for (const e of b.events) {
    const w = `event:${e.id}`;
    if (!e.title || !e.blurb) err(w, 'needs title and blurb'); if (!(e.weight > 0)) err(w, 'weight must be positive'); if (!(e.cooldown >= 0)) err(w, 'bad cooldown');
    for (const p of e.when.near ?? []) refOk(w + '/when', p);
    if (e.when.near && !e.when.near.length) err(w, 'near is empty');
    for (const wv of e.when.weather ?? []) if (!WEATHER.has(wv)) err(w, `unknown weather "${wv}"`);
    for (const v of e.when.vehicle ?? []) if (!VEHICLES.has(v)) err(w, `unknown vehicle "${v}"`);
    fxOk(w, e.rewards); graph('event', e.id, e.steps, e.start, false); noDash(w, e);
  }
  // ---- routes
  for (const r of b.routes) {
    const w = `route:${r.id}`;
    if (r.stops.length < 2) err(w, 'needs at least 2 stops'); if (!VEHICLES.has(r.vehicle)) err(w, `unknown vehicle "${r.vehicle}"`); if (!(r.fare > 0)) err(w, 'fare must be positive');
    for (const s of r.stops) refOk(w, s.place); noDash(w, r);
  }
  // ---- skills
  const perks = new Map<string, { s: SkillDef; branch: string; level: number }>();
  for (const s of b.skills) {
    const w = `skill:${s.id}`;
    for (const m of s.perLevel) if (!(m.stat in STAT_KEYS)) err(w, `unknown stat "${m.stat}"`);
    for (const br of s.branches) for (const p of br.perks) {
      const pw = `${w}/${p.id}`; if (!ID.test(p.id)) err(pw, 'bad perk id'); if (perks.has(p.id)) err(pw, 'duplicate perk id'); perks.set(p.id, { s, branch: br.id, level: p.level });
      if (p.level > s.maxLevel) err(pw, 'perk level is above the skill max'); if (!p.mods.length) err(pw, 'perk changes nothing');
      for (const m of p.mods) { if (!(m.stat in STAT_KEYS)) err(pw, `unknown stat "${m.stat}"`); if (m.mul === undefined && m.add === undefined) err(pw, 'mod has neither add nor mul'); const d = STAT_KEYS[m.stat]; if (d && d.kind === 'add' && m.mul !== undefined) warn(pw, `${m.stat} is an additive stat; mul is ignored`); }
    }
    noDash(w, s);
  }
  for (const s of b.skills) for (const br of s.branches) for (const p of br.perks) for (const r of p.requires ?? []) { const q = perks.get(r); if (!q) err(`skill:${s.id}/${p.id}`, `requires unknown perk "${r}"`); else if (q.s.id !== s.id) err(`skill:${s.id}/${p.id}`, 'requires a perk from another skill'); else if (q.level > p.level) warn(`skill:${s.id}/${p.id}`, 'requires a perk of higher level'); }
  return out;
}

/** What a mission or event needs from the world, for tools that want a quick summary. */
export function summarize(b: Bundle) {
  const types: Record<string, number> = {}; for (const m of [...b.missions, ...b.events]) for (const s of m.steps) types[s.type] = (types[s.type] ?? 0) + 1;
  return { places: b.places.length, missions: b.missions.length, events: b.events.length, routes: b.routes.length, skills: b.skills.length, perks: b.skills.reduce((a, s) => a + s.branches.reduce((x, br) => x + br.perks.length, 0), 0), stepTypes: types };
}
