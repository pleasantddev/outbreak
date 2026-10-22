// One executor per step type. enter() sets the scene, tick() runs at 60 Hz and returns what to do next:
// nothing (carry on), 'next', a step id, 'fail' or 'win'. The runtime (missions.ts) does the bookkeeping.
import type { MissionsSystem } from './missions';
import type { Exec, Goal, Pt, Run } from './missionsCore';
import type { ChoiceStep, ChaseStep, EscortStep, EvadeStep, FightStep, GotoStep, HackStep, CallStep, DeliverStep, PickupStep, RaceStep, RouteStep, SneakStep, StayStep, TailStep, TalkStep, TapStep, TradeStep, VehicleStep, VisitStep, WaitStep, BranchStep, EndStep, FoeDef, StepDef } from '../content/schema';
import { emptyCommand, type Actor, type Vehicle } from '../sim/types';
import { RoadNet } from '../world/roadnet';
import { VEHICLES, type VehicleKind } from '../data/balance';

type M = MissionsSystem;
const goal = (r: Run, p: Pt, kind: Goal['kind'] = 'goal', minor = false) => { r.goal = { ...p, kind, minor }; };
const need = (m: M, r: Run, ref: any, prefer: 'foot' | 'road' = 'foot'): Pt | null => {
  const p = m.place(ref, prefer);
  if (!p) { console.warn('[missions] unresolved place', ref, 'in', r.def.id); m.finish(r, 'fail', 'This hustle points at a place that does not exist.'); }
  return p;
};
const kindName = (k: VehicleKind) => VEHICLES[k].name;
const speedOf = (v: Vehicle | null) => (v ? Math.abs(v.ctrl.currentVehicleSpeed()) : 0);
const defeated = (a: Actor) => !a.alive || (a as any)._gone || (a.ko ?? 0) > 0.4;

/** Find a vehicle of one of the kinds for the player to take. Sets the goal marker on it. Returns the player's own if already in one. */
function vehicleHunt(m: M, r: Run, kinds: VehicleKind[], provide?: any): Vehicle | 'mine' | null {
  const mine = m.myVehicle(); if (mine && kinds.includes(mine.kind)) { if (!r.vehicles.includes(mine)) { (mine as any)._keep = true; r.vehicles.push(mine); } return 'mine'; }
  const s = r.s; s.vt = (s.vt ?? 0) - 1 / 60;
  if (s.vt <= 0 || !s.v || (s.v as any).gone) {
    s.vt = 0.5; const P = m.P; let best: Vehicle | null = null, bd = 600;
    for (const v of m.ctx.sim.liveVehicles()) { if (v.destroyed || !kinds.includes(v.kind) || (v.seats[0] !== null && v.seats[0] !== 0)) continue; const t = v.body.translation(); const d = Math.hypot(t.x - P.x, t.z - P.z); if (d < bd) { bd = d; best = v; } }
    s.v = best;
    if (!best) {
      if (provide && m.dist(m.place(provide, 'road') ?? { x: 1e9, z: 1e9 }) < 160) { s.v = m.provideVehicle(r, kinds[0], provide); }
      else if (!provide && r.st > 1.5 && !s.spawned) { s.spawned = true; const yaw = m.me.yaw; s.v = m.provideVehicle(r, kinds[0], { x: m.P.x + Math.sin(yaw) * 32, z: m.P.z + Math.cos(yaw) * 32 }); }
    }
  }
  const v = s.v as Vehicle | null;
  if (v && !(v as any).gone) { const t = v.body.translation(); r.goal = { x: t.x, z: t.z, r: 3, name: kindName(v.kind), kind: 'vehicle' }; }
  else if (provide) { const p = m.place(provide, 'road'); if (p) goal(r, p, 'vehicle'); }
  return null;
}

function walkRunner(m: M, a: Actor, s: { walk: number; s: number; dir: number; pause: number; stuck: number; last: { x: number; z: number } }, from: { x: number; z: number }, sprint: boolean, dt: number) {
  const net = m.ctx.sim.net; const c = emptyCommand();
  if (s.pause > 0) { s.pause -= dt; a.cmd = c; c.yaw = a.yaw; return; }
  const pick = () => {
    let best = -1, bs = 0, bd = -1;
    for (const id of net.nearWalks(a.pos.x, a.pos.z, 26)) {
      const w = net.walks[id]; const pr = RoadNet.project(w.pts, a.pos.x, a.pos.z); if (pr.d > 20 || w.len < 12) continue;
      for (const dir of [1, -1]) { const e = RoadNet.at(w.pts, Math.max(0, Math.min(w.len, pr.s + dir * 30))); const d = Math.hypot(e.x - from.x, e.z - from.z) + Math.random() * 14; if (d > bd) { bd = d; best = id; bs = dir; } }
    }
    if (best >= 0) { s.walk = best; s.dir = bs; s.s = RoadNet.project(net.walks[best].pts, a.pos.x, a.pos.z).s; }
  };
  if (s.walk < 0 || !net.walks[s.walk]) pick();
  const w = net.walks[s.walk]; if (!w) { a.cmd = c; return; }
  const pr = RoadNet.project(w.pts, a.pos.x, a.pos.z); s.s = pr.s;
  if ((s.dir > 0 && s.s > w.len - 3) || (s.dir < 0 && s.s < 3) || pr.d > 14) { pick(); }
  const t = RoadNet.at(w.pts, Math.max(0, Math.min(w.len, s.s + s.dir * 4)));
  const dx = t.x - a.pos.x, dz = t.z - a.pos.z, l = Math.hypot(dx, dz) || 1; c.mx = dx / l; c.mz = dz / l; c.sprint = sprint; c.yaw = Math.atan2(dx, dz); a.cmd = c;
  if (Math.hypot(a.pos.x - s.last.x, a.pos.z - s.last.z) < 0.02) s.stuck += dt; else { s.stuck = 0; s.last = { x: a.pos.x, z: a.pos.z }; }
  if (s.stuck > 1.2) { s.stuck = 0; s.walk = -1; }
}
function followActor(a: Actor, tx: number, tz: number, run: boolean) {
  const c = emptyCommand(); const dx = tx - a.pos.x, dz = tz - a.pos.z, d = Math.hypot(dx, dz);
  if (d > 3.2) { c.mx = dx / d; c.mz = dz / d; c.sprint = run || d > 14; if (d < 6 && !run) { c.mx *= 0.6; c.mz *= 0.6; } }
  c.yaw = Math.atan2(dx, dz); a.cmd = c;
}

const goto: Exec<GotoStep> = {
  enter(m, r, st) { const p = need(m, r, st.to, st.on === 'vehicle' || st.vehicle ? 'road' : 'foot'); if (!p) return; r.text = st.text ?? `Go to ${p.name}${st.vehicle ? ` in a ${kindName(st.vehicle[0])}` : ''}`; },
  tick(m, r, st) {
    const p = m.place(st.to, st.on === 'vehicle' || st.vehicle ? 'road' : 'foot')!; goal(r, p);
    if (m.dist(p) > (st.r ?? p.r)) return;
    const v = m.anyVehicle();
    if (st.on === 'vehicle' && !v) return; if (st.on === 'foot' && v) return;
    if (st.vehicle && !(v && st.vehicle.includes(v.kind))) return;
    return 'next';
  },
};

const talk: Exec<TalkStep> = {
  enter(m, r, st) {
    r.s.phase = st.to ? 'go' : 'say'; r.text = st.text ?? (st.to ? `Talk to ${st.npc}` : '');
    if (st.to) { const p = need(m, r, st.to); if (!p) return; m.npc(r, 'talk', st.npc, st.to, st.look ?? 'ped'); }
    else r.s.left = m.say(st.lines) + 0.5;
  },
  tick(m, r, st, dt) {
    const s = r.s;
    if (s.phase === 'go') {
      const n = r.npcs.get('talk')!; const q = n.actor ? { x: n.actor.pos.x, z: n.actor.pos.z, r: 6, name: st.npc } : { x: n.x, z: n.z, r: 6, name: st.npc };
      goal(r, q); const v = m.anyVehicle();
      if (m.dist(q) <= (st.r ?? 6) && speedOf(v) < 5) { s.phase = 'say'; s.left = m.say(st.lines) + 0.5; r.text = st.text ?? st.npc; }
    } else { s.left -= dt; if (s.left <= 0) return 'next'; }
  },
};

const pickup: Exec<PickupStep> = {
  enter(m, r, st) { const p = need(m, r, st.to); if (!p) return; r.text = st.text ?? `Pick up the ${st.item}`; if (st.npc) m.npc(r, 'pick', st.npc, st.to, 'vendor'); },
  tick(m, r, st) { const p = m.place(st.to)!; goal(r, p); if (m.dist(p) > (st.r ?? p.r)) return; m.fx(r, { giveItem: [st.item] }); return 'next'; },
};
const deliver: Exec<DeliverStep> = {
  enter(m, r, st) { const p = need(m, r, st.to); if (!p) return; r.text = st.text ?? `Deliver the ${st.item}`; if (st.npc) m.npc(r, 'drop', st.npc, st.to, 'ped'); },
  tick(m, r, st) { const p = m.place(st.to)!; goal(r, p); if (m.dist(p) > (st.r ?? p.r)) return; if (speedOf(m.anyVehicle()) > 7) return; m.fx(r, { takeItem: [st.item] }); return 'next'; },
};

const vehicle: Exec<VehicleStep> = {
  enter(m, r, st) { r.text = st.text ?? `Get in a ${st.kind.map(kindName).join(' or ')}`; if (st.provide) { const p = m.place(st.provide, 'road'); if (p) goal(r, p, 'vehicle'); } },
  tick(m, r, st) { const got = vehicleHunt(m, r, st.kind, st.provide); if (got === 'mine') return 'next'; },
};

const visit: Exec<VisitStep> = {
  enter(m, r, st) {
    r.s.left = st.places.map((_, i) => i); r.s.n = st.places.length; r.text = st.text ?? 'Make the rounds';
    st.places.forEach((p, i) => { if (st.npcs?.[i]) m.npc(r, 'v' + i, st.npcs[i], p, 'vendor'); });
  },
  tick(m, r, st) {
    const left: number[] = r.s.left; const pts = left.map((i) => ({ i, p: m.place(st.places[i])! })).filter((x) => x.p);
    if (!pts.length) return 'next';
    pts.sort((a, b) => m.dist(a.p) - m.dist(b.p));
    goal(r, pts[0].p); r.extra = pts.slice(1).map((x) => ({ ...x.p, kind: 'goal' as const, minor: true }));
    r.text = `${st.text ?? 'Make the rounds'} (${r.s.n - left.length}/${r.s.n})`;
    for (const x of pts) if (m.dist(x.p) <= (st.r ?? x.p.r)) { left.splice(left.indexOf(x.i), 1); m.fx(r, st.each); m.ctx.hud.toast(`${r.s.n - left.length} of ${r.s.n}`, x.p.name, 'linear-gradient(160deg,#f6c453,#d98a12)', 'pin', 2.5); break; }
    if (!left.length) return 'next';
  },
};

const choice: Exec<ChoiceStep> = {
  enter(m, r, st) {
    r.text = st.text ?? 'Decide'; r.s.pick = undefined;
    const opts = st.options.map((o) => {
      const why = m.why(r, o.if); const dis = !!why;
      const tag = o.roll ? `${m.sk.def(o.roll.skill)?.name ?? o.roll.skill} ${Math.round(m.sk.rollChance(o.roll.skill, o.roll.dc) * 100)}%` : undefined;
      return { text: o.text, tag, disabled: dis, hint: dis ? (o.lockedHint ?? why ?? undefined) : undefined };
    });
    m.ui.choice({ who: st.who, prompt: st.prompt, options: opts, secs: st.secs, foot: st.secs ? 'Decide quick.' : undefined, onPick: (i) => { r.s.pick = i; } });
  },
  tick(m, r, st) {
    const i = r.s.pick as number | undefined; if (i === undefined) return;
    const idx = i < 0 ? st.fallback ?? 0 : i; const o = st.options[idx];
    m.fx(r, o.fx);
    if (o.roll) {
      const ok = Math.random() < m.sk.rollChance(o.roll.skill, o.roll.dc);
      m.fx(r, ok ? o.roll.okFx : o.roll.badFx);
      m.ctx.hud.toast(ok ? 'It worked' : 'It did not work', `${m.sk.def(o.roll.skill)?.name ?? o.roll.skill} check`, ok ? '#22c55e' : 'var(--red)', 'star' as any, 2.5);
      m.sk.addXp(o.roll.skill, ok ? 6 : 2, true);
      return ok ? o.roll.ok : o.roll.bad;
    }
    return o.next;
  },
};

const branch: Exec<BranchStep> = {
  tick(m, r, st) { for (const c of st.cases) if (m.cond(r, c.if)) return c.next; return st.else; },
};

const wait: Exec<WaitStep> = {
  enter(m, r, st) { r.s.left = st.secs ?? 0; r.s.h0 = m.hour; if (st.at) need(m, r, st.at); r.text = st.text ?? (st.untilHour !== undefined ? `Wait until ${String(st.untilHour).padStart(2, '0')}:00` : 'Wait'); },
  tick(m, r, st, dt) {
    if (st.at) { const p = m.place(st.at)!; goal(r, p); }
    if (st.untilHour !== undefined) {
      const span = (st.untilHour - r.s.h0 + 24) % 24; const gone = (m.hour - r.s.h0 + 24) % 24; r.s.timeLeft = Math.max(0, (span - gone) * 120);
      if (gone >= span || gone > 20) return 'next'; return;
    }
    r.s.left -= dt; r.s.timeLeft = Math.max(0, r.s.left); if (r.s.left <= 0) return 'next';
  },
};

const call: Exec<CallStep> = {
  enter(m, r, st) {
    r.text = st.text ?? `${st.who} is calling`; r.s.res = undefined; r.s.t0 = 0;
    const ring = () => m.ctx.hud.call(st.who, 'Incoming call · Y answer · N decline', () => { r.s.res = 'yes'; }, () => { r.s.res = 'no'; }, st.ringSecs ?? 14);
    if (m.ctx.hud.ringing) r.s.defer = true; else ring();
    r.s.ring = ring;
  },
  tick(m, r, st, dt) {
    if (r.s.defer && !m.ctx.hud.ringing) { r.s.defer = false; r.s.ring(); }
    if (r.s.res === 'yes') { r.s.res = 'talk'; r.s.left = m.say(st.lines ?? [[st.who, st.line]]) + 0.4; }
    else if (r.s.res === 'talk') { r.s.left -= dt; if (r.s.left <= 0) return st.answer; }
    else if (r.s.res === 'no') return st.decline;
  },
};

function spawnWave(m: M, r: Run, at: Pt, foes: FoeDef[]): Actor[] {
  const out: Actor[] = [];
  for (const f of foes) for (let i = 0; i < f.n; i++) { const q = m.walkPoint(at.x, at.z, 3, 14); out.push(m.spawnFoe(r, q.x, q.z, f)); }
  return out;
}
const fight: Exec<FightStep> = {
  enter(m, r, st) { need(m, r, st.at); r.s.foes = [] as Actor[]; r.s.wave = -1; r.s.hold = st.hold ?? 0; r.text = st.text ?? 'Find the trouble'; },
  tick(m, r, st, dt) {
    const p = m.place(st.at)!; const s = r.s;
    if (s.wave < 0) {
      goal(r, p, 'foe'); if (m.dist(p) > 105) return;
      s.wave = 0; s.foes = spawnWave(m, r, p, st.foes); s.since = 0; r.text = st.text ?? 'Beat them down'; m.ctx.hud.toast('Wahala', 'They don see you. Fight or run.', 'var(--red)', 'siren', 3);
    }
    const foes: Actor[] = s.foes; s.since += dt;
    for (const a of foes) if (defeated(a) && !(a as any)._done) { (a as any)._done = true; if (a.alive) m.ctx.sim.script(a, 'flee', 0); }
    const alive = foes.filter((a) => !(a as any)._done);
    r.extra = alive.slice(0, 6).map((a) => ({ x: a.pos.x, z: a.pos.z, r: 3, name: a.name, kind: 'foe' as const, minor: true }));
    goal(r, { ...p, r: 60 }, 'foe', true);
    if (st.hold) {
      s.hold -= dt; r.s.timeLeft = Math.max(0, s.hold); r.text = st.text ?? `Hold out (${Math.ceil(Math.max(0, s.hold))}s)`;
      if (st.waves && s.wave < st.waves.length && (alive.length === 0 || s.since > 20)) { s.foes = [...foes, ...spawnWave(m, r, p, st.waves[s.wave])]; s.wave++; s.since = 0; }
      if (s.hold <= 0 && alive.length <= 1) return 'next'; return;
    }
    if (alive.length === 0) {
      if (st.waves && s.wave < st.waves.length) { s.foes = spawnWave(m, r, p, st.waves[s.wave]); s.wave++; s.since = 0; m.ctx.hud.toast('More of them', 'Reinforcement dey come.', 'var(--red)', 'siren', 2.5); return; }
      return 'next';
    }
    r.text = `${st.text ?? 'Beat them down'} (${alive.length} left)`;
  },
};

const chase: Exec<ChaseStep> = {
  enter(m, r, st) { need(m, r, st.from); r.s.walk = { walk: -1, s: 0, dir: 1, pause: 0, stuck: 0, last: { x: 0, z: 0 } }; r.s.far = 0; r.text = st.text ?? `Catch ${st.npc ?? 'the runner'}`; r.s.nt = 3; },
  tick(m, r, st, dt) {
    const s = r.s; const p = m.place(st.from)!; const P = m.P;
    if (!s.a) {
      goal(r, p); if (m.dist(p) > 70) return;
      const q = m.snapPoint(p.x, p.z, 'foot'); const a = m.ctx.sim.spawnActor('ped', { x: q.x, y: 0.05, z: q.z }, undefined, st.npc ?? 'Runner');
      m.ctx.sim.script(a, 'free'); r.actors.push(a); s.a = a; s.hp0 = a.hp; s.trig = false; m.say([[st.npc ?? 'Runner', 'Haba! Who be this one?']]);
      return;
    }
    const a: Actor = s.a; goal(r, { x: a.pos.x, z: a.pos.z, r: 3, name: a.name }, 'foe');
    const d = Math.hypot(a.pos.x - P.x, a.pos.z - P.z);
    if (!a.alive || (a.ko ?? 0) > 0.3 || a.hp < s.hp0 - 1 || d < (st.caughtR ?? 2.6)) { a.cmd = emptyCommand(); (a as any)._script = false; m.ctx.sim.script(a, 'idle'); if (a.alive) a.ko = Math.max(a.ko ?? 0, 3); return 'next'; }
    // it stops now and then to catch its breath: a determined player will close in
    s.nt -= dt; if (s.nt <= 0 && s.walk.pause <= 0) { s.nt = 5 + Math.random() * 5; if (d > 8) s.walk.pause = 0.5 + Math.random() * 0.5; }
    walkRunner(m, a, s.walk, P, (st.speed ?? 1) >= 1, dt);
    s.far = d > (st.escapeD ?? 120) ? s.far + dt : 0;
    if (s.far > 6) return st.onTimeout ?? 'fail';
    r.text = st.text ?? `Catch ${a.name}`;
  },
};

const tail: Exec<TailStep> = {
  enter(m, r, st) { need(m, r, st.from, 'road'); r.s.ok = 0; r.s.lost = 0; r.text = st.text ?? 'Find the car'; },
  tick(m, r, st, dt) {
    const s = r.s; const p = m.place(st.from, 'road')!;
    if (!s.v) {
      goal(r, p, 'vehicle'); if (m.dist(p) > 90) return;
      const v = m.ctx.sim.spawnTraffic(st.kind, p.x, p.z, 1.15); if (!v) return; s.v = v; r.vehicles.push(v); r.text = st.text ?? `Stay on the ${kindName(st.kind)}, not too close`; return;
    }
    const v: Vehicle = s.v; if ((v as any).gone || v.destroyed) { return s.ok > st.secs * 0.6 ? 'next' : 'fail'; }
    const t = v.body.translation(); const d = Math.hypot(t.x - m.P.x, t.z - m.P.z);
    goal(r, { x: t.x, z: t.z, r: 3, name: kindName(st.kind) }, 'vehicle');
    const lo = st.minD ?? 9, hi = st.maxD ?? 70;
    if (d >= lo && d <= hi) { s.ok += dt; s.lost = 0; } else if (d > hi) s.lost += dt;
    r.s.timeLeft = Math.max(0, st.secs - s.ok);
    r.text = d < lo ? 'Too close, they go notice you. Drop back.' : d > hi ? 'You are losing them. Close the gap.' : `Keep them in sight (${Math.ceil(st.secs - s.ok)}s)`;
    if (s.lost > 9) return 'fail';
    if (s.ok >= st.secs) return 'next';
  },
};

const evade: Exec<EvadeStep> = {
  enter(m, r, st) { m.fx(r, { wanted: st.level }); m.ctx.sim.lastSeen = m.ctx.sim.time; r.s.clear = 0; r.text = st.text ?? 'Lose the police'; },
  tick(m, r, st, dt) { if (m.ctx.sim.wanted > 0) { r.s.clear = 0; return; } r.s.clear += dt; if (r.s.clear >= (st.secs ?? 2)) return 'next'; },
};

const race: Exec<RaceStep> = {
  enter(m, r, st) { r.s.i = 0; r.s.left = st.secs; r.s.go = !st.vehicle; r.text = st.text ?? 'Race'; for (const c of st.checkpoints) if (!need(m, r, c, 'road')) return; },
  tick(m, r, st, dt) {
    const s = r.s;
    if (!s.go) { const got = vehicleHunt(m, r, st.vehicle!, undefined); if (got !== 'mine') { r.text = `Get in a ${st.vehicle!.map(kindName).join(' or ')} to start`; return; } s.go = true; m.ctx.hud.title('GO GO GO', 'Checkpoints in order. Beat the clock.', 2); }
    s.left -= dt; s.timeLeft = Math.max(0, s.left);
    const p = m.place(st.checkpoints[s.i], 'road')!; goal(r, p); const nx = st.checkpoints[s.i + 1]; r.extra = nx ? [{ ...m.place(nx, 'road')!, kind: 'goal', minor: true }] : [];
    r.text = st.text ?? `Checkpoint ${s.i + 1} of ${st.checkpoints.length}`;
    if (m.dist(p) <= (st.r ?? Math.max(p.r, 22))) { s.i++; if (s.i >= st.checkpoints.length) { if (st.par && s.left >= st.par) m.setFlag(r, '~par'); return 'next'; } m.ctx.hud.toast('Checkpoint', `${s.i} of ${st.checkpoints.length}`, '#22c55e', 'pin', 1.6); }
    if (s.left <= 0) return st.onTimeout ?? 'fail';
  },
};

const sneak: Exec<SneakStep> = {
  enter(m, r, st) { need(m, r, st.to); r.s.guards = []; r.text = st.text ?? 'Stay out of sight'; },
  tick(m, r, st, dt) {
    const s = r.s; const to = m.place(st.to)!; const P = m.P; goal(r, to);
    if (!s.guards.length || s.guards.length < st.guards.length) {
      for (let i = s.guards.length; i < st.guards.length; i++) {
        const g = m.place(st.guards[i].at); if (!g || m.dist(g) > 125) continue;
        const q = m.snapPoint(g.x, g.z, 'foot'); const a = m.ctx.sim.spawnActor('ped', { x: q.x, y: 0.05, z: q.z }, undefined, st.guards[i].name ?? 'Guard');
        m.ctx.sim.script(a, 'free'); r.actors.push(a); s.guards[i] = { a, def: st.guards[i], ph: Math.random() * 6 };
      }
    }
    const night = m.hour < 6 || m.hour > 19 ? 0.82 : 1; const me = m.me;
    r.extra = [];
    for (const g of s.guards as { a: Actor; def: any; ph: number }[]) {
      if (!g) continue; const a = g.a; const face = ((g.def.face ?? 0) * Math.PI) / 180; g.ph += dt;
      const c = emptyCommand(); c.yaw = face + Math.sin(g.ph * 0.8) * 0.8; a.cmd = c;
      const dx = P.x - a.pos.x, dz = P.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d < 70) r.extra.push({ x: a.pos.x, z: a.pos.z, r: 3, name: a.name, kind: 'foe', minor: true });
      const range = (g.def.range ?? 20) * (me.crouch ? 0.55 : 1) * (me.sprinting ? 1.35 : 1) * m.sk.stat('stealth.detect') * night * (m.me.vehicle !== null ? 1.2 : 1);
      if (d > range && d > 2.5) continue;
      const fwdx = Math.sin(c.yaw), fwdz = Math.cos(c.yaw); const dot = (dx * fwdx + dz * fwdz) / (d || 1);
      if (d > 2.5 && dot < Math.cos(1.0)) continue;
      const eye = { x: a.pos.x, y: a.pos.y + 1.5, z: a.pos.z };
      if (d > 2.5 && !m.ctx.sim.phys.lineOfSight(eye, { x: P.x, y: P.y + 1.2, z: P.z })) continue;
      m.ctx.hud.title('SPOTTED', 'Somebody saw you.', 2.5, true); m.sk.addXp('stealth', 2, true); return st.onSpot ?? 'fail';
    }
    r.text = `${st.text ?? 'Stay out of sight'}${me.crouch ? '' : ' (crouch to stay hidden)'}`;
    if (m.dist(to) <= (st.r ?? to.r)) { m.sk.addXp('stealth', 12); return 'next'; }
  },
};

const hack: Exec<HackStep> = {
  enter(m, r, st) { if (st.at) need(m, r, st.at); r.s.phase = st.at ? 'go' : 'play'; r.text = st.text ?? (st.at ? `Go to ${m.place(st.at)?.name}` : st.label); },
  tick(m, r, st, dt) {
    const s = r.s;
    if (s.phase === 'go') { const p = m.place(st.at)!; goal(r, p); if (m.dist(p) > p.r) return; s.phase = 'play'; }
    if (s.phase === 'play') {
      const len = Math.max(3, Math.min(9, Math.round((st.len ?? 5) + m.sk.stat('hack.len')))); s.code = Array.from({ length: len }, () => 1 + Math.floor(Math.random() * 4)); s.i = 0;
      s.left = (st.secs ?? 14) + m.sk.stat('hack.secs'); s.tot = s.left; s.phase = 'run'; r.text = st.text ?? st.label;
      const press = (k: number) => { if (s.phase !== 'run') return; if (s.code[s.i] === k) { s.i++; if (s.i >= s.code.length) s.phase = 'win'; } else { s.left -= 1.6; m.ctx.hud.toast('Wrong', 'Time penalty', 'var(--red)', 'siren', 0.8); } };
      m.ui.miniOpen({ title: st.label, sub: 'Enter the code. Keys 1 to 4 or tap.', hint: 'Wrong key costs time.', buttons: [1, 2, 3, 4].map((k) => ({ label: String(k), key: `Digit${k}`, cb: () => press(k) })) });
      for (let k = 1; k <= 4; k++) (m.ui as any).miniKeys.set(`Numpad${k}`, () => press(k));
      return;
    }
    if (s.phase === 'run') {
      s.left -= dt; s.timeLeft = Math.max(0, s.left);
      m.ui.miniSet({ bigHtml: s.code.map((c: number, j: number) => `<span class="${j < s.i ? 'done' : j === s.i ? 'on' : ''}">${c}</span>`).join(' '), bar: s.i / s.code.length, time: `${Math.max(0, s.left).toFixed(1)}s` });
      if (s.left <= 0) { m.ui.miniClose(); m.ctx.hud.title('LOCKED OUT', 'The terminal shut you out.', 2.5, true); m.sk.addXp('hack', 3, true); return st.onFail ?? 'fail'; }
    }
    if (s.phase === 'win') { m.ui.miniClose(); m.sk.addXp('hack', 14); m.ctx.hud.toast('Access granted', st.label, '#22c55e', 'star' as any, 2.5); return 'next'; }
  },
};

const tap: Exec<TapStep> = {
  enter(m, r, st) { if (st.at) need(m, r, st.at); r.s.phase = st.at ? 'go' : 'play'; r.text = st.text ?? (st.at ? `Go to ${m.place(st.at)?.name}` : st.label); },
  tick(m, r, st, dt) {
    const s = r.s;
    if (s.phase === 'go') { const p = m.place(st.at)!; goal(r, p); if (m.dist(p) > p.r) return; s.phase = 'play'; }
    if (s.phase === 'play') {
      s.need = Math.max(3, Math.round(st.taps * (st.skill === 'mech' ? m.sk.stat('mech.repair') : 1))); s.n = 0; s.left = st.secs; s.phase = 'run'; r.text = st.text ?? st.label;
      const hit = () => { if (s.phase === 'run') s.n++; };
      m.ui.miniOpen({ title: st.label, sub: `Press E or tap fast. ${s.need} to go.`, buttons: [{ label: 'E  PUSH', key: 'KeyE', cb: hit, cls: 'big2' }] });
      (m.ui as any).miniKeys.set('Space', hit);
      return;
    }
    if (s.phase === 'run') {
      s.left -= dt; s.timeLeft = Math.max(0, s.left); m.ui.miniSet({ big: `${s.n} / ${s.need}`, bar: s.n / s.need, time: `${Math.max(0, s.left).toFixed(1)}s` });
      const pay = () => { if (st.perTap) { const c = Math.round(Math.min(s.n, s.need) * st.perTap * m.sk.stat('fare.mult')); if (c) m.fx(r, { cash: c }); } };
      if (s.n >= s.need) { m.ui.miniClose(); pay(); if (st.skill) m.sk.addXp(st.skill, 10); return 'next'; }
      if (s.left <= 0) { m.ui.miniClose(); pay(); m.ctx.hud.title('TOO SLOW', 'You lost the moment.', 2.5, true); return st.onFail ?? 'fail'; }
    }
  },
};

const trade: Exec<TradeStep> = {
  enter(m, r, st) { r.s.phase = st.at ? 'go' : 'ask'; if (st.at) { need(m, r, st.at); m.npc(r, 'trade', st.npc ?? 'Trader', st.at, 'vendor'); } r.text = st.text ?? (st.at ? `Go to ${st.npc ?? m.place(st.at)?.name}` : 'Do the deal'); },
  tick(m, r, st) {
    const s = r.s; const deal = st.buy ?? st.sell!; const buying = !!st.buy;
    if (s.phase === 'go') { const n = r.npcs.get('trade')!; const q = n.actor ? { x: n.actor.pos.x, z: n.actor.pos.z, r: 5, name: n.name } : { x: n.x, z: n.z, r: 5, name: n.name }; goal(r, q); if (m.dist(q) > 6 || speedOf(m.anyVehicle()) > 5) return; s.phase = 'ask'; }
    if (s.phase === 'ask') {
      if (s.price === undefined) { s.price = Math.round(deal.price * m.sk.stat(buying ? 'trade.buy' : 'trade.sell')); s.haggled = false; }
      const label = deal.label ?? deal.item; const who = st.npc ?? 'Trader';
      const opts = [{ text: buying ? `Pay ₦${s.price.toLocaleString()}` : `Take ₦${s.price.toLocaleString()}`, tag: undefined as string | undefined, disabled: false, hint: undefined as string | undefined }];
      if (st.haggle && !s.haggled) opts.push({ text: buying ? 'Haggle the price down' : 'Push for a better price', tag: `Trading ${Math.round(m.sk.rollChance('trade', 3) * 100)}%`, disabled: false, hint: undefined });
      opts.push({ text: 'Walk away', tag: undefined, disabled: false, hint: undefined });
      s.phase = 'wait'; s.pick = undefined; r.text = st.text ?? (buying ? `Buy ${label}` : `Sell ${label}`);
      m.ui.choice({ who, prompt: buying ? `${label}: ₦${s.price.toLocaleString()}. You wan buy or you dey look?` : `I go give you ₦${s.price.toLocaleString()} for the ${label}.`, options: opts, onPick: (i) => { s.pick = i; } });
      s.opts = opts.length;
    }
    if (s.phase === 'wait' && s.pick !== undefined) {
      const i = s.pick as number; s.pick = undefined; const hag = st.haggle && !s.haggled; const label = deal.label ?? deal.item;
      const isWalk = i === (hag ? 2 : 1) || i < 0;
      if (i === 0) {
        if (buying) { if (m.ctx.sim.cash < s.price) { m.ctx.hud.toast('No be small money', `You need ₦${s.price.toLocaleString()}.`, 'var(--red)', 'cash', 3); if (st.onBroke) return st.onBroke; s.phase = 'ask'; return; } m.fx(r, { cash: -s.price, giveItem: [deal.item] }); }
        else m.fx(r, { cash: s.price, takeItem: [deal.item] });
        m.sk.addXp('trade', 8); m.ctx.hud.toast(buying ? 'Deal' : 'Sold', label, '#22c55e', 'cash', 2.5); return 'next';
      }
      if (hag && i === 1) {
        s.haggled = true; const ok = Math.random() < m.sk.rollChance('trade', 3);
        s.price = Math.round(s.price * (buying ? (ok ? 0.8 : 1.1) : ok ? 1.2 : 0.9)); m.sk.addXp('trade', ok ? 12 : 3, true);
        m.ctx.hud.toast(ok ? 'He blinked first' : 'He no gree', ok ? 'Better price.' : 'Price move the wrong way.', ok ? '#22c55e' : 'var(--red)', 'star' as any, 2.5); s.phase = 'ask'; return;
      }
      if (isWalk) { return st.onWalk ?? 'fail'; }
    }
  },
};

const escort: Exec<EscortStep> = {
  enter(m, r, st) { need(m, r, st.from); need(m, r, st.to); m.npc(r, 'esc', st.npc, st.from, 'ped', false); r.s.joined = false; r.s.far = 0; r.s.amb = false; r.text = st.text ?? `Meet ${st.npc}`; },
  tick(m, r, st, dt) {
    const s = r.s; const n = r.npcs.get('esc')!; const a = n.actor; const P = m.P; const to = m.place(st.to)!;
    if (!a) { goal(r, m.place(st.from)!); return; }
    if (!a.alive || (a.ko ?? 0) > 0.4) { m.ctx.hud.title('THEY GOT HIM', `${st.npc} is down.`, 3, true); return 'fail'; }
    const d = Math.hypot(a.pos.x - P.x, a.pos.z - P.z);
    if (!s.joined) { goal(r, { x: a.pos.x, z: a.pos.z, r: 4, name: st.npc }); if (d < 5) { s.joined = true; s.start = { x: a.pos.x, z: a.pos.z }; m.say([[st.npc, 'Let us go. Abeg, no leave me.']]); } return; }
    goal(r, to); r.text = st.text ?? `Take ${st.npc} to ${to.name}`;
    followActor(a, P.x, P.z, false);
    s.far = d > 70 ? s.far + dt : 0; if (s.far > 15) return 'fail';
    if (st.ambush && !s.amb) { const tot = Math.hypot(to.x - s.start.x, to.z - s.start.z); const done = Math.hypot(a.pos.x - s.start.x, a.pos.z - s.start.z); if (done > tot * 0.45) { s.amb = true; for (const f of st.ambush) for (let i = 0; i < f.n; i++) { const q = m.walkPoint(a.pos.x, a.pos.z, 12, 24); m.spawnFoe(r, q.x, q.z, f); } m.ctx.hud.title('AMBUSH', 'Cover him!', 2.5, true); } }
    const dd = Math.hypot(a.pos.x - to.x, a.pos.z - to.z);
    if (dd <= (st.r ?? to.r + 4) && m.dist(to) < 30) return 'next';
  },
};

const stay: Exec<StayStep> = {
  enter(m, r, st) { need(m, r, st.at); r.s.left = st.secs; r.text = st.text ?? 'Hold position'; },
  tick(m, r, st, dt) {
    const s = r.s; const p = m.place(st.at)!; goal(r, p);
    if (m.dist(p) <= (st.r ?? Math.max(p.r, 14))) { s.left -= dt; r.text = `${st.text ?? 'Hold position'} (${Math.ceil(Math.max(0, s.left))}s)`; } else if (st.strict) { s.left = st.secs; r.text = `${st.text ?? 'Hold position'}: get back to the spot`; }
    s.timeLeft = undefined; if (s.left <= 0) return 'next';
  },
};

const end: Exec<EndStep> = {
  enter(m, r, st) { r.text = st.text ?? (st.outcome === 'win' ? 'Done' : 'Failed'); r.s.d = 0; },
  tick(m, r, st, dt) { r.s.d += dt; if (r.s.d > 0.2) return st.outcome; },
};

const route: Exec<RouteStep> = {
  enter(m, r, st) {
    const def = m.content.route.get(st.route); if (!def) { console.warn('[missions] unknown route', st.route); m.finish(r, 'fail', 'Unknown route'); return; }
    let stops = [...def.stops]; if (st.reverse) stops.reverse(); if (st.stops) stops = stops.slice(0, st.stops);
    r.s.def = def; r.s.stops = stops; r.s.i = 0; r.s.phase = 'drive'; r.s.pax = [] as Actor[]; r.s.dwell = 0; r.s.total = 0; r.text = st.text ?? def.name;
    for (const sp of stops) if (!need(m, r, sp.place, 'road')) return;
  },
  tick(m, r, st, dt) {
    const s = r.s; const def = s.def; const v = m.myVehicle();
    if (!v || v.kind !== def.vehicle) { const got = vehicleHunt(m, r, [def.vehicle], undefined); if (got !== 'mine') { r.text = `Get a ${kindName(def.vehicle)} for the ${def.name} run`; return; } return; }
    const stop = s.stops[s.i]; const p = m.place(stop.place, 'road')!; goal(r, p);
    r.text = `${def.name}: ${stop.label ?? p.name} (${s.i + 1}/${s.stops.length})`;
    const sp = speedOf(v);
    if (s.phase === 'drive') {
      if (m.dist(p) < Math.max(p.r, 14) + 6) { s.phase = 'dwell'; s.dwell = stop.dwell ?? 3; boardPeople(m, r, v, s, s.i === 0, s.i === s.stops.length - 1); r.text = `${stop.label ?? p.name}: hold still while they board`; }
    } else {
      if (m.dist(p) > Math.max(p.r, 14) + 22) { s.phase = 'drive'; return; }
      if (sp > 2.8) { r.text = 'Stop, let people get down and enter'; return; }
      s.dwell -= dt; if (s.dwell > 0) return;
      const last = s.i === s.stops.length - 1; const out = alightPeople(m, r, v, s, last);
      const rush = def.rush && (def.rush[0] <= def.rush[1] ? m.hour >= def.rush[0] && m.hour < def.rush[1] : m.hour >= def.rush[0] || m.hour < def.rush[1]) ? 1.3 : 1;
      const fare = Math.round(out * (stop.fare ?? def.fare) * (st.fareMult ?? 1) * rush * m.sk.stat('fare.mult'));
      if (fare > 0) { m.fx(r, { cash: fare }); m.ctx.hud.toast(`${out} commuter${out > 1 ? 's' : ''} paid`, `+₦${fare.toLocaleString()}${rush > 1 ? ' (rush hour)' : ''}`, '#22c55e', 'cash', 2.5); s.total += fare; }
      m.sk.addXp(def.vehicle === 'okada' || def.vehicle === 'keke' ? 'ride' : 'drive', 2.5, true);
      s.i++; s.phase = 'drive';
      if (s.i >= s.stops.length) { r.s.hideName = false; return 'next'; }
    }
  },
};
function boardPeople(m: M, r: Run, v: Vehicle, s: any, first: boolean, last: boolean) {
  if (last) return; const sim = m.ctx.sim; const free = v.seats.map((x, i) => (i > 0 && x === null ? i : -1)).filter((i) => i > 0).length;
  const n = Math.min(free, first ? 2 + Math.floor(Math.random() * 3) : Math.floor(Math.random() * 3)); const t = v.body.translation();
  for (let i = 0; i < n; i++) { const a = sim.spawnActor('ped', { x: t.x + 2.5 + i * 0.6, y: 0.05, z: t.z }, undefined, 'Commuter'); sim.script(a, 'free'); if (sim.enterVehicle(a, v, false)) { s.pax.push(a); r.actors.push(a); } else { sim.script(a, 'idle'); } }
}
function alightPeople(m: M, r: Run, v: Vehicle, s: any, last: boolean): number {
  const sim = m.ctx.sim; const pax: Actor[] = s.pax.filter((a: Actor) => a.alive && a.vehicle === v.id); let n = last ? pax.length : Math.min(pax.length, Math.floor(Math.random() * (pax.length + 1)));
  const out = pax.slice(0, n); for (const a of out) { sim.exitVehicle(a); sim.script(a, 'idle'); (a as any)._keep = false; s.pax.splice(s.pax.indexOf(a), 1); }
  return n;
}

export const STEPS: Record<StepDef['type'], Exec<any>> = { goto, talk, pickup, deliver, vehicle, route, visit, choice, branch, wait, call, fight, chase, tail, evade, race, sneak, hack, tap, trade, escort, stay, end };
