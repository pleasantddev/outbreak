// 5-a-side football in a cage, FIFA style. Team 0 attacks +x. One keeper and four outfield players a side; humans
// drive one footballer each, AI runs the rest. Ball: a real ball (gravity, bounce, rolling friction, cage walls, nets).
// Runs on the host (or offline); guests get snapshots.
import { angDiff, clamp, r1, type PadIn, type SimPlayer, type SportSim } from './types';
import { MATCH_MS } from '../../net/sports';

const G = 9.8, BR = 0.11, GOAL_W = 4, GOAL_H = 2, NET_D = 1.1;
const JOG = 5.0, SPRINT = 7.2, ACC = 22;
type Mode = 'play' | 'kickoff' | 'goal' | 'over';

interface FP extends SimPlayer { role: number; stun: number; kickCd: number; tackleCd: number; charge: number; aiT: number; slide: number; celebrate: number }

export class Football implements SportSim {
  sport = 'football' as const; players: FP[] = []; ball = { x: 0, y: BR, z: 0, vx: 0, vy: 0, vz: 0 };
  score: [number, number] = [0, 0]; clock: number; over = false; banner = 'KICK OFF'; bannerT = 2; events: string[] = [];
  control = new Map<string, number>(); owner = -1; private mode: Mode = 'kickoff'; private modeT = 2; private kickTeam: 0 | 1 = 0; private lastTouch = -1; private passTo = -1;
  constructor(public L: number, public W: number, humans: { id: string; name: string; side: 0 | 1 }[], names: [string[], string[]], private rand: () => number = Math.random) {
    this.clock = MATCH_MS.football / 1000;
    for (const team of [0, 1] as const) for (let role = 0; role < 5; role++) this.players.push({ x: 0, z: 0, vx: 0, vz: 0, face: team ? -Math.PI / 2 : Math.PI / 2, team, anim: 'idle', human: null, name: names[team][role] ?? `P${role}`, num: [1, 4, 7, 11, 9][role], role, stun: 0, kickCd: 0, tackleCd: 0, charge: 0, aiT: 0, slide: 0, celebrate: 0 });
    // humans take the outfield shirts, forwards first
    const order = [4, 2, 3, 1];
    for (const side of [0, 1] as const) humans.filter((h) => h.side === side).forEach((h, i) => { const idx = side * 5 + order[i % 4]; this.players[idx].human = h.id; this.players[idx].name = h.name; this.control.set(h.id, idx); });
    this.reset(0);
  }
  private home(p: FP): [number, number] {
    const s = p.team ? -1 : 1, L = this.L, W = this.W; const bx = this.ball.x * 0.35;
    const spots: [number, number][] = [[-L / 2 + 0.9, 0], [-L * 0.28, 0], [-L * 0.06, -W * 0.28], [-L * 0.06, W * 0.28], [L * 0.2, 0]];
    const [x, z] = spots[p.role]; if (p.role === 0) return [x * s, clamp(this.ball.z * 0.45, -GOAL_W / 2 + 0.3, GOAL_W / 2 - 0.3)];
    return [clamp(x * s + bx, -L / 2 + 2, L / 2 - 2), z * s];
  }
  private reset(kick: 0 | 1) {
    this.kickTeam = kick; this.ball = { x: 0, y: BR, z: 0, vx: 0, vy: 0, vz: 0 }; this.owner = -1; this.passTo = -1;
    for (const p of this.players) { const s = p.team ? -1 : 1; const [hx, hz] = this.home(p); p.x = Math.min(-1.5, hx * s) * s; p.z = hz; p.vx = p.vz = 0; p.face = p.team ? -Math.PI / 2 : Math.PI / 2; p.stun = 0; p.charge = 0; p.slide = 0; p.celebrate = 0; }
    const k = this.players[kick * 5 + 4]; k.x = kick ? 0.4 : -0.4; k.z = 0; this.mode = 'kickoff'; this.modeT = 1.6;
  }
  meter(who: string) { const i = this.control.get(who); if (i === undefined) return null; const p = this.players[i]; return p.charge > 0 ? { v: Math.min(1, p.charge), good: [0.55, 0.85] as [number, number] } : null; }

  step(dt: number, pads: Map<string, PadIn>) {
    if (this.over) return;
    this.bannerT -= dt;
    if (this.mode === 'goal') { this.modeT -= dt; this.ballPhys(dt); for (const p of this.players) { p.vx *= 0.9; p.vz *= 0.9; p.anim = p.celebrate > 0 ? 'emote' : 'idle'; p.clip = p.celebrate > 0 ? 'Dance_Loop' : undefined; } if (this.modeT <= 0) this.reset(this.kickTeam); return; }
    if (this.mode === 'kickoff') { this.modeT -= dt; if (this.modeT <= 0) { this.mode = 'play'; this.owner = this.kickTeam * 5 + 4; } }
    else { this.clock -= dt; if (this.clock <= 0) { this.clock = 0; this.over = true; this.mode = 'over'; this.banner = 'FULL TIME'; this.bannerT = 99; this.events.push(`Full time. ${this.score[0]} : ${this.score[1]}`); return; } }
    // switch: the controller jumps to the teammate nearest the ball (only when nobody else on the team is human there)
    for (const [who, pad] of pads) {
      const i = this.control.get(who); if (i === undefined || !pad.press.switch) continue; const me = this.players[i];
      const cand = this.players.map((p, j) => ({ p, j })).filter(({ p, j }) => p.team === me.team && j !== i && !p.human && p.role !== 0).sort((a, b) => this.dBall(a.p) - this.dBall(b.p))[0];
      if (cand) { this.players[i].human = null; cand.p.human = who; this.control.set(who, cand.j); }
    }
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]; p.kickCd = Math.max(0, p.kickCd - dt); p.tackleCd = Math.max(0, p.tackleCd - dt); p.stun = Math.max(0, p.stun - dt); p.slide = Math.max(0, p.slide - dt);
      const pad = p.human ? pads.get(p.human) : undefined;
      let mx = 0, mz = 0, sprint = false;
      if (this.mode === 'kickoff') { /* hold positions */ }
      else if (p.human && pad) { mx = pad.mx; mz = pad.mz; sprint = pad.sprint; this.humanActs(i, p, pad); }
      else if (p.human && !pad) { /* human not sending yet: stand */ }
      else [mx, mz, sprint] = this.ai(i, p, dt);
      if (p.stun > 0 && p.slide <= 0) { mx = mz = 0; }
      const m = Math.hypot(mx, mz); if (m > 1) { mx /= m; mz /= m; }
      const top = (sprint ? SPRINT : JOG) * (this.owner === i ? 0.88 : 1);
      if (p.slide > 0) { p.vx *= 1 - dt * 1.8; p.vz *= 1 - dt * 1.8; }
      else { const tx = mx * top, tz = mz * top; const dvx = tx - p.vx, dvz = tz - p.vz; const dl = Math.hypot(dvx, dvz); const a = Math.min(dl, ACC * dt); if (dl > 1e-4) { p.vx += (dvx / dl) * a; p.vz += (dvz / dl) * a; } }
      p.x = clamp(p.x + p.vx * dt, -this.L / 2 + 0.3, this.L / 2 - 0.3); p.z = clamp(p.z + p.vz * dt, -this.W / 2 + 0.3, this.W / 2 - 0.3);
      const sp = Math.hypot(p.vx, p.vz); if (sp > 0.4 && p.slide <= 0) p.face = Math.atan2(p.vx, p.vz);
      if (p.celebrate > 0) p.celebrate -= dt;
      p.anim = p.slide > 0 ? 'emote' : sp > 5.6 ? 'sprint' : sp > 0.6 ? 'jog' : 'idle'; p.clip = p.slide > 0 ? 'Slide_Loop' : undefined;
      if (p.stun > 0 && p.slide <= 0) { p.anim = 'emote'; p.clip = 'Hit_Knockback'; }
    }
    // bodies push apart
    for (let a = 0; a < this.players.length; a++) for (let b = a + 1; b < this.players.length; b++) {
      const A = this.players[a], B = this.players[b]; const dx = B.x - A.x, dz = B.z - A.z; const d = Math.hypot(dx, dz);
      if (d < 0.7 && d > 1e-4) { const k = (0.7 - d) / 2 / d; A.x -= dx * k; A.z -= dz * k; B.x += dx * k; B.z += dz * k; }
    }
    this.dribble(dt); this.ballPhys(dt); this.pickup();
  }
  private dBall(p: SimPlayer) { return Math.hypot(p.x - this.ball.x, p.z - this.ball.z); }
  private goalX(team: number) { return team ? -this.L / 2 : this.L / 2; }

  // ---------------------------------------------------------------- what a human does with the buttons
  private humanActs(i: number, p: FP, pad: PadIn) {
    const has = this.owner === i;
    if (has) {
      if (pad.hold.shoot) p.charge = Math.min(1.15, p.charge + 1 / 60 * 1.1);
      if (pad.release.shoot && p.charge > 0) { this.shoot(i, p.charge, pad.mz); p.charge = 0; return; }
      if (pad.press.pass) { const t = this.pickMate(i, pad.mx, pad.mz); if (t >= 0) this.pass(i, t, false); return; }
      if (pad.press.thru) { const t = this.pickMate(i, pad.mx, pad.mz, true); if (t >= 0) this.pass(i, t, true); return; }
    } else {
      p.charge = 0;
      if (pad.press.tackle || pad.press.pass) this.tackle(i, p, !!pad.press.tackle && (pad.sprint || Math.hypot(p.vx, p.vz) > 6));
    }
  }
  /** teammate best placed in the direction you are pushing (or facing) */
  private pickMate(i: number, mx: number, mz: number, ahead = false) {
    const p = this.players[i]; let dx = mx, dz = mz; if (Math.hypot(dx, dz) < 0.2) { dx = Math.sin(p.face); dz = Math.cos(p.face); }
    const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl; let best = -1, bs = -1e9; const fwd = p.team ? -1 : 1;
    for (let j = 0; j < this.players.length; j++) {
      const q = this.players[j]; if (j === i || q.team !== p.team) continue;
      const ox = q.x - p.x, oz = q.z - p.z; const d = Math.hypot(ox, oz); if (d < 1.5 || d > 32) continue;
      const cos = (ox * dx + oz * dz) / d; const s = cos * 3 - d * 0.05 + (ahead ? (ox * fwd) * 0.08 : 0) - this.pressure(q) * 0.6;
      if (s > bs) { bs = s; best = j; }
    }
    return best;
  }
  private pressure(q: SimPlayer) { let n = 0; for (const o of this.players) if (o.team !== q.team) { const d = Math.hypot(o.x - q.x, o.z - q.z); if (d < 3) n += (3 - d) / 3; } return n; }
  private pass(i: number, t: number, thru: boolean) {
    const p = this.players[i], q = this.players[t]; const fwd = q.team ? -1 : 1;
    let tx = q.x + q.vx * 0.6, tz = q.z + q.vz * 0.6; if (thru) { tx = clamp(q.x + fwd * 5, -this.L / 2 + 1, this.L / 2 - 1); tz = q.z * 0.8; }
    const dx = tx - this.ball.x, dz = tz - this.ball.z; const d = Math.hypot(dx, dz) || 1;
    const v = clamp(Math.sqrt(2 * 2.6 * d) + 3.5, 7, 22); const err = (this.rand() - 0.5) * 0.06 * (1 + this.pressure(p));
    const ang = Math.atan2(dx, dz) + err; this.kick(i, Math.sin(ang) * v, thru && d > 12 ? 2.6 : 0.3, Math.cos(ang) * v);
    this.passTo = t; this.events.push(`${p.name} ${thru ? 'plays it through to' : 'passes to'} ${q.name}`);
  }
  private shoot(i: number, power: number, aimZ: number) {
    const p = this.players[i]; const gx = this.goalX(p.team); const over = Math.max(0, power - 0.95) * 6; const pr = this.pressure(p);
    const corner = Math.abs(aimZ) > 0.3 ? Math.sign(aimZ) : (this.rand() < 0.5 ? -1 : 1);
    const tz = corner * (GOAL_W / 2 - 0.45) + (this.rand() - 0.5) * (0.8 + pr * 1.6 + Math.abs(power - 0.7) * 2.4);
    const dx = gx - this.ball.x, dz = tz - this.ball.z; const d = Math.hypot(dx, dz) || 1;
    const v = 13 + clamp(power, 0, 1.15) * 15; const vy = 1.2 + power * power * 4.2 + over * 3 + d * 0.06;
    this.kick(i, dx / d * v, vy, dz / d * v); p.anim = 'emote'; this.events.push(`${p.name} shoots!`);
  }
  private kick(i: number, vx: number, vy: number, vz: number) { const b = this.ball; b.vx = vx; b.vy = vy; b.vz = vz; b.y = Math.max(b.y, BR + 0.02); this.players[i].kickCd = 0.3; this.lastTouch = i; this.owner = -1; }
  private tackle(i: number, p: FP, slide: boolean) {
    if (p.tackleCd > 0 || p.stun > 0) return; p.tackleCd = slide ? 1.1 : 0.6;
    if (slide) { const s = Math.hypot(p.vx, p.vz) || 1; p.vx = p.vx / s * 8.5; p.vz = p.vz / s * 8.5; p.slide = 0.55; p.stun = 0.9; }
    const o = this.owner; if (o < 0) return; const q = this.players[o]; if (q.team === p.team) return;
    const d = Math.hypot(q.x - p.x, q.z - p.z); if (d > (slide ? 2.6 : 1.6)) return;
    const front = Math.cos(angDiff(Math.atan2(q.x - p.x, q.z - p.z), p.face)) > 0.2;
    if (this.rand() < (slide ? 0.62 : 0.5) * (front ? 1 : 0.6)) {
      this.owner = -1; const a = p.face + (this.rand() - 0.5) * 1.2; this.ball.vx = Math.sin(a) * 6; this.ball.vz = Math.cos(a) * 6; this.ball.vy = 0.6; q.stun = 0.5; q.kickCd = 0.4; this.lastTouch = i;
      this.events.push(`${p.name} wins it off ${q.name}`);
    } else if (!slide) p.stun = 0.35;
  }

  // ---------------------------------------------------------------- the ball
  private dribble(dt: number) {
    if (this.owner < 0) return; const p = this.players[this.owner]; const b = this.ball;
    const sp = Math.hypot(p.vx, p.vz); const lead = 0.5 + sp * 0.07; const tx = p.x + Math.sin(p.face) * lead, tz = p.z + Math.cos(p.face) * lead;
    b.vx = (tx - b.x) / Math.max(dt, 1e-3) * 0.35 + p.vx * 0.65; b.vz = (tz - b.z) / Math.max(dt, 1e-3) * 0.35 + p.vz * 0.65; b.vy = 0; b.y = BR;
  }
  private ballPhys(dt: number) {
    const b = this.ball; const hl = this.L / 2, hw = this.W / 2;
    if (this.owner < 0 || this.mode !== 'play') { b.vy -= G * dt; const sp = Math.hypot(b.vx, b.vz); if (b.y <= BR + 0.01 && sp > 0) { const f = Math.max(0, sp - 2.4 * dt) / sp; b.vx *= f; b.vz *= f; } b.vx *= 1 - 0.08 * dt; b.vz *= 1 - 0.08 * dt; }
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y < BR) { b.y = BR; b.vy = Math.abs(b.vy) > 1.2 ? -b.vy * 0.5 : 0; }
    if (b.y > 6) { b.y = 6; b.vy = -Math.abs(b.vy) * 0.5; } // the cage roof net
    if (Math.abs(b.z) > hw - BR) { b.z = Math.sign(b.z) * (hw - BR); b.vz = -b.vz * 0.6; }
    const inMouth = Math.abs(b.z) < GOAL_W / 2 - BR && b.y < GOAL_H - BR;
    if (Math.abs(b.x) > hl - BR) {
      if (this.mode === 'play' && inMouth && Math.abs(b.x) > hl + BR) { this.goal(b.x > 0 ? 0 : 1); }
      else if (!inMouth && Math.abs(b.x) < hl + 0.3) { b.x = Math.sign(b.x) * (hl - BR); b.vx = -b.vx * 0.6; if (Math.abs(b.z) < GOAL_W / 2 + 0.2 && b.y < GOAL_H + 0.2) this.events.push('Off the woodwork!'); }
    }
    if (Math.abs(b.x) > hl + NET_D - BR) { b.x = Math.sign(b.x) * (hl + NET_D - BR); b.vx = -b.vx * 0.15; b.vz *= 0.3; }
    if (Math.abs(b.x) > hl) { b.z = clamp(b.z, -GOAL_W / 2 + BR, GOAL_W / 2 - BR); b.y = Math.min(b.y, GOAL_H - BR); }
  }
  private goal(team: 0 | 1) {
    this.score[team]++; this.mode = 'goal'; this.modeT = 3.2; this.kickTeam = team ? 0 : 1; this.owner = -1;
    const by = this.lastTouch >= 0 ? this.players[this.lastTouch] : null; const og = by && by.team !== team;
    this.banner = og ? 'OWN GOAL!' : 'GOAL!'; this.bannerT = 3;
    this.events.push(og ? `Own goal by ${by!.name}. Wahala!` : `GOAL! ${by?.name ?? 'Somebody'} don score! ${this.score[0]} : ${this.score[1]}`);
    for (const p of this.players) if (p.team === team) p.celebrate = 3;
  }
  private pickup() {
    if (this.mode !== 'play' || this.owner >= 0) return; const b = this.ball; if (b.y > 1.0) return;
    let best = -1, bd = 1e9;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]; if (p.kickCd > 0 || (p.stun > 0 && p.slide <= 0)) continue;
      const reach = p.role === 0 && Math.abs(p.x - this.goalX(p.team ? 0 : 1)) < 3 ? 1.3 : p.slide > 0 ? 1.1 : 0.75;
      const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < reach && d < bd) { best = i; bd = d; }
    }
    if (best < 0) return; const p = this.players[best]; const sp = Math.hypot(b.vx, b.vz);
    if (p.role === 0 && sp > 8) { // keeper save: harder the faster it comes
      if (this.rand() < clamp(1.15 - sp / 30, 0.25, 0.9)) { this.owner = best; this.lastTouch = best; this.events.push(`Big save from ${p.name}!`); p.anim = 'emote'; p.clip = 'Roll'; return; }
      b.vx *= -0.35; b.vz += (this.rand() - 0.5) * 6; p.kickCd = 0.5; this.events.push(`${p.name} parries it!`); return;
    }
    if (sp > 15 && this.rand() < 0.5) { b.vx *= 0.4; b.vz *= 0.4; p.kickCd = 0.2; return; } // a hard ball bounces off you
    this.owner = best; this.lastTouch = best; this.passTo = -1;
  }

  // ---------------------------------------------------------------- AI
  private ai(i: number, p: FP, dt: number): [number, number, boolean] {
    const b = this.ball; const myGoal = this.goalX(p.team ? 0 : 1), theirGoal = this.goalX(p.team);
    const to = (x: number, z: number, slowR = 1): [number, number, boolean] => { const dx = x - p.x, dz = z - p.z; const d = Math.hypot(dx, dz); if (d < 0.25) return [0, 0, false]; const k = Math.min(1, d / slowR); return [dx / d * k, dz / d * k, d > 6]; };
    if (p.role === 0) {
      if (this.owner === i) { p.aiT += dt; if (p.aiT > 1.2) { p.aiT = 0; const t = this.pickMate(i, theirGoal > 0 ? 1 : -1, 0); if (t >= 0) this.pass(i, t, false); } return [0, 0, false]; }
      p.aiT = 0; const coming = (b.vx * (myGoal - b.x)) > 0 && Math.hypot(b.vx, b.vz) > 6;
      const tz = coming ? clamp(b.z + b.vz * Math.abs((myGoal - b.x) / (b.vx || 1)), -GOAL_W / 2, GOAL_W / 2) : clamp(b.z * 0.45, -GOAL_W / 2 + 0.3, GOAL_W / 2 - 0.3);
      const near = Math.abs(b.x - myGoal) < 5 && this.owner < 0 && !coming;
      return near ? to(b.x, b.z) : to(myGoal - Math.sign(myGoal) * 0.9, tz, 0.5);
    }
    if (this.owner === i) {
      p.aiT -= dt; const dGoal = Math.hypot(theirGoal - p.x, p.z);
      const front = this.players.filter((o) => o.team !== p.team && o.role !== 0 && (o.x - p.x) * Math.sign(theirGoal) > 0 && Math.hypot(o.x - p.x, o.z - p.z) < 2.6).length;
      if (dGoal < 11 && this.rand() < dt * 1.8) { this.shoot(i, 0.55 + this.rand() * 0.3, 0); return [0, 0, false]; }
      if ((front && this.rand() < dt * 3) || p.aiT < -3.5) { p.aiT = 0; const t = this.pickMate(i, Math.sign(theirGoal), (this.rand() - 0.5) * 1.5, true); if (t >= 0) { this.pass(i, t, this.rand() < 0.3); return [0, 0, false]; } }
      const dz = Math.abs(p.z) > this.W * 0.3 ? -Math.sign(p.z) * 0.4 : (this.rand() - 0.5) * 0.3; return [Math.sign(theirGoal), dz, dGoal > 8];
    }
    if (this.passTo === i && this.owner < 0) return to(b.x + b.vx * 0.3, b.z + b.vz * 0.3); // run onto the pass
    const own = this.owner >= 0 ? this.players[this.owner] : null;
    if (own && own.team === p.team) { const [hx, hz] = this.home(p); return to(clamp(hx + Math.sign(theirGoal) * 4, -this.L / 2 + 2, this.L / 2 - 2), hz, 2); }
    // defending or loose ball: the closest two hunt it, the rest hold shape
    const rank = this.players.filter((q) => q.team === p.team && q.role !== 0 && !q.human).sort((a, c) => this.dBall(a) - this.dBall(c)).indexOf(p);
    if (rank === 0 || (rank === 1 && own)) {
      if (own && rank === 0 && this.dBall(p) < 1.4 && p.tackleCd <= 0 && this.rand() < dt * 3) this.tackle(i, p, false);
      if (rank === 1) return to((b.x + myGoal) / 2, b.z * 0.6, 2);
      return to(b.x + b.vx * 0.2, b.z + b.vz * 0.2, 0.5);
    }
    const [hx, hz] = this.home(p); return to(hx, hz, 2);
  }

  // ---------------------------------------------------------------- online
  snap() { return { p: this.players.map((p) => [r1(p.x), r1(p.z), r1(p.face), p.anim, p.clip ?? '', p.human ?? '']), b: [r1(this.ball.x), r1(this.ball.y), r1(this.ball.z)], s: this.score, c: Math.round(this.clock * 10) / 10, o: this.over ? 1 : 0, bn: this.bannerT > 0 ? this.banner : '', ev: this.events.splice(0) }; }
  apply(s0: unknown) {
    const s = s0 as any; if (!s?.p) return;
    s.p.forEach((a: any[], i: number) => { const p = this.players[i]; if (!p) return; p.vx = (a[0] - p.x) * 15; p.vz = (a[1] - p.z) * 15; p.x = a[0]; p.z = a[1]; p.face = a[2]; p.anim = a[3]; p.clip = a[4] || undefined; p.human = a[5] || null; });
    this.ball.x = s.b[0]; this.ball.y = s.b[1]; this.ball.z = s.b[2]; this.score = s.s; this.clock = s.c; this.over = !!s.o;
    if (s.bn) { this.banner = s.bn; this.bannerT = 1; } this.events.push(...(s.ev ?? []));
    for (const [id] of this.control) { const i = this.players.findIndex((p) => p.human === id); if (i >= 0) this.control.set(id, i); }
  }
}
