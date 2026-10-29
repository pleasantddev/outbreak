// Seed DSL for the HustleLife missions workstream. The JSON in public/content is the source of truth once written;
// this generator only exists to author the first big batch quickly. Re-running build.mjs OVERWRITES the JSON files,
// so do not run it after editing them by hand or in the admin panel.
let uid = 0;
const S = (type) => (...a) => ({ type, a });
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Step builders. Each returns a plain step; ids are filled in by mission(). Last argument is always an options bag. */
const step = (type, body, o = {}) => strip({ ...body, ...o, type });
export const go = (to, text, o) => step('goto', { to, text }, o);
export const goveh = (to, text, vehicle, o) => step('goto', { to, text, on: 'vehicle', vehicle }, o);
export const talk = (npc, to, lines, o) => step('talk', { npc, to, lines }, o);
export const pick = (item, to, text, o) => step('pickup', { item, to, text }, o);
export const drop = (item, to, text, o) => step('deliver', { item, to, text }, o);
export const veh = (kind, provide, text, o) => step('vehicle', { kind: [].concat(kind), provide, text }, o);
export const route = (routeId, text, o) => step('route', { route: routeId, text }, o);
export const visit = (places, text, o) => step('visit', { places, text }, o);
export const ask = (who, prompt, options, o) => step('choice', { who, prompt, options }, o);
export const opt = (text, next, o) => strip({ text, next, ...o });
export const gamble = (text, skill, dc, ok, bad, o = {}) => { const { okFx, badFx, ...rest } = o; return strip({ text, next: ok, roll: strip({ skill, dc, ok, bad, okFx, badFx }), ...rest }); };
export const br = (cases, other, o) => step('branch', { cases: cases.map(([c, n]) => ({ if: c, next: n })), else: other }, o);
export const wait = (secs, text, o) => step('wait', typeof secs === 'number' ? { secs, text } : { ...secs, text }, o);
export const call = (who, line, answer, decline, o) => step('call', { who, line, answer, decline }, o);
export const F = (n, role = 'area', weapon, hp, name) => strip({ n, role, weapon, hp, name });
export const fight = (at, foes, text, o) => step('fight', { at, foes, text }, o);
export const chase = (from, npc, text, o) => step('chase', { from, npc, text }, o);
export const tail = (from, kind, secs, text, o) => step('tail', { from, kind, secs, text }, o);
export const evade = (level, text, o) => step('evade', { level, text }, o);
export const race = (checkpoints, secs, text, o) => step('race', { checkpoints, secs, text }, o);
export const guard = (at, face, range, name) => strip({ at, face, range, name });
export const sneak = (to, guards, text, o) => step('sneak', { to, guards, text }, o);
export const hack = (label, len, secs, text, o) => step('hack', { label, len, secs, text }, o);
export const tap = (label, taps, secs, text, o) => step('tap', { label, taps, secs, text }, o);
export const trade = (npc, at, deal, text, o) => step('trade', { npc, at, ...deal, text }, o);
export const buy = (item, price, label) => ({ buy: strip({ item, price, label }) });
export const sell = (item, price, label) => ({ sell: strip({ item, price, label }) });
export const escort = (npc, from, to, text, o) => step('escort', { npc, from, to, text }, o);
export const stay = (at, secs, text, o) => step('stay', { at, secs, text }, o);
export const win = (title, rewards, o) => step('end', { outcome: 'win', title, rewards }, o);
export const lose = (title, text, o) => step('end', { outcome: 'fail', title, text }, o);

/** Give every step an id (explicit o.id wins), keep references intact. */
function finish(steps, owner) {
  const seen = new Set(); let n = 0;
  return steps.map((s) => {
    n++; const id = s.id ?? `${s.type}${n}`;
    if (seen.has(id)) throw new Error(`${owner}: duplicate step id ${id}`);
    seen.add(id);
    return { id, ...s };
  });
}
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };

/** mission(meta, ...steps). meta: id title arc cat area giver blurb min diff req offer rewards penalty fail repeat legacy tags */
export function mission(m, ...steps) {
  const st = finish(steps, m.id);
  const offer = m.offer ? clean({ board: m.offer.board, call: m.offer.call, giver: m.offer.giver }) : undefined;
  const out = clean({
    id: m.id, title: m.title, arc: m.arc, category: m.cat, area: m.area, giver: m.giver, blurb: m.blurb, minutes: m.min, difficulty: m.diff,
    req: m.req, offer, start: st[0].id, steps: st, rewards: m.rewards, penalty: m.penalty, fail: m.fail, repeat: m.repeat, legacy: m.legacy, tags: m.tags,
  });
  return out;
}
/** event(meta, ...steps). meta: id title blurb weight cooldown once when ambient rewards tags */
export function event(m, ...steps) {
  const st = finish(steps, m.id);
  return clean({ id: m.id, title: m.title, blurb: m.blurb, weight: m.weight ?? 1, cooldown: m.cooldown ?? 600, once: m.once, when: m.when ?? {}, ambient: m.ambient, start: st[0].id, steps: st, rewards: m.rewards, tags: m.tags });
}
export const R = (id, name, mode, vehicle, fare, blurb, stops, o = {}) => clean({
  id, name, mode, vehicle, blurb, fare, stops: stops.map((s) => (typeof s === 'string' ? { place: s } : { place: s[0], ...(s[1] ?? {}) })), loop: o.loop, rush: o.rush, via: o.via, tags: o.tags,
});
export const repeatEvery = (min) => ({ cooldownMin: min });

// ---- skill DSL
export const mod = (stat, mul, add) => clean({ stat, mul, add });
export const perk = (id, name, desc, tier, level, mods, o = {}) => clean({ id, name, desc, tier, level, cost: o.cost, requires: o.requires, mods: [].concat(mods), flag: o.flag });
export const branch = (id, name, desc, ...perks) => ({ id, name, desc, perks });
export const skill = (id, name, blurb, color, icon, trains, perLevel, ...branches) => ({ id, name, blurb, color, icon, maxLevel: 12, xpBase: 40, xpPow: 1.5, perLevel: [].concat(perLevel), branches, trains });
