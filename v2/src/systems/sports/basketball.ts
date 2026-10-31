// Half-court 3v3, streetball rules with a 2K feel: 2s and 3s, first to 21 or the clock. The hoop is at z = 0 end,
// the check spot at the top of the key. Shots use a timing meter: release in the green and it is wet. The ball flies
// a real arc to the rim; misses bounce off rim and board and land where anyone can rebound.
import { angDiff, clamp, r1, type PadIn, type SimPlayer, type SportSim } from './types';
import { BB_TARGET, MATCH_MS } from '../../net/sports';

const G = 9.8, BR = 0.12, RIM = { x: 0, y: 3.05, z: 1.575 }, BOARD_Z = 1.2, ARC = 6.75;
const SPEED = 4.6, SPRINT = 6.3, ACC = 20, METER_T = 0.8, GOOD: [number, number] = [0.78, 0.92];
type Mode = 'check' | 'play' | 'shot' | 'loose' | 'over';
interface BP extends SimPlayer { stun: number; jump: number; charge: number; shooting: boolean; cd: number; aiT: number; spot: number }

export class Basketball implements SportSim {
  sport = 'basketball' as const; players: BP[] = []; ball = { x: 0, y: 1, z: 10, vx: 0, vy: 0, vz: 0 };
  score: [number, number] = [0, 0]; clock: number; over = false; banner = 'CHECK BALL'; bannerT = 1.5; events: string[] = [];
  control = new Map<string, number>(); L = 15; W = 14; owner = -1; offense: 0 | 1 = 0; private mode: Mode = 'check'; private modeT = 1.5;
  private shot: { by: number; make: boolean; pts: number; t: number; T: number; blocked: boolean } | null = null; private dribT = 0; private lastShooter = -1;
  constructor(humans: { id: string; name: string; side: 0 | 1 }[], names: [string[], string[]], private rand: () => number = Math.random) {
    this.clock = MATCH_MS.basketball / 1000;
    for (const team of [0, 1] as const) for (let k = 0; k < 3; k++) this.players.push({ x: 0, z: 8, vx: 0, vz: 0, face: Math.PI, team, anim: 'idle', human: null, name: names[team][k] ?? `P${k}`, num: [3, 23, 30][k], stun: 0, jump: 0, charge: 0, shooting: false, cd: 0, aiT: 0, spot: k });
    for (const side of [0, 1] as const) humans.filter((h) => h.side === side).forEach((h, i) => { const idx = side * 3 + (i % 3); this.players[idx].human = h.id; this.players[idx].name = h.name; this.control.set(h.id, idx); });
    this.check(0);
  }
  private spots: [number, number][] = [[0, 8.2], [-5.4, 4.6], [5.6, 3.2]];
  private check(team: 0 | 1) {
    this.offense = team; this.mode = 'check'; this.modeT = 1.2; this.shot = null; this.ball = { x: 0, y: 1, z: 10, vx: 0, vy: 0, vz: 0 };
    const off = this.players.filter((p) => p.team === team), def = this.players.filter((p) => p.team !== team);
    off.forEach((p, k) => { const [x, z] = k === 0 ? [0, 10] : this.spots[k]; p.x = x; p.z = z; p.vx = p.vz = 0; p.face = Math.PI; p.charge = 0; p.shooting = false; p.stun = 0; });
    def.forEach((p, k) => { const m = off[k]; p.x = m.x * 0.85; p.z = m.z - 1.3; p.face = 0; p.vx = p.vz = 0; p.charge = 0; p.stun = 0; });
    this.owner = this.players.indexOf(off[0]); this.banner = 'CHECK BALL'; this.bannerT = 1.2;
  }
  meter(who: string) { const i = this.control.get(who); if (i === undefined) return null; const p = this.players[i]; return p.charge > 0 ? { v: Math.min(1, p.charge / METER_T), good: GOOD } : null; }
  private dHoop(p: { x: number; z: number }) { return Math.hypot(p.x - RIM.x, p.z - RIM.z); }

  step(dt: number, pads: Map<string, PadIn>) {
    if (this.over) return; this.bannerT -= dt;
    if (this.mode === 'check') { this.modeT -= dt; if (this.modeT <= 0) this.mode = 'play'; }
    if (this.mode !== 'check') { this.clock -= dt; if (this.clock <= 0 && this.mode !== 'shot') { this.end(); return; } }
    for (const [who, pad] of pads) { // switch to the teammate nearest the ball
      const i = this.control.get(who); if (i === undefined || !pad.press.switch) continue; const me = this.players[i];
      const c = this.players.map((p, j) => ({ p, j })).filter(({ p, j }) => p.team === me.team && j !== i && !p.human).sort((a, b) => Math.hypot(a.p.x - this.ball.x, a.p.z - this.ball.z) - Math.hypot(b.p.x - this.ball.x, b.p.z - this.ball.z))[0];
      if (c) { me.human = null; c.p.human = who; this.control.set(who, c.j); }
    }
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]; p.stun = Math.max(0, p.stun - dt); p.cd = Math.max(0, p.cd - dt); p.jump = Math.max(0, p.jump - dt);
      const pad = p.human ? pads.get(p.human) : undefined; let mx = 0, mz = 0, sprint = false;
      if (this.mode === 'check') { /* set */ }
      else if (p.human) { if (pad) { mx = pad.mx; mz = pad.mz; sprint = pad.sprint; this.humanActs(i, p, pad, dt); } }
      else [mx, mz, sprint] = this.ai(i, p, dt);
      if (p.stun > 0 || p.shooting || p.jump > 0) { mx = mz = 0; }
      const m = Math.hypot(mx, mz); if (m > 1) { mx /= m; mz /= m; }
      const top = (sprint ? SPRINT : SPEED) * (p.charge > 0 ? 0.3 : 1);
      const tx = mx * top, tz = mz * top; const dvx = tx - p.vx, dvz = tz - p.vz; const dl = Math.hypot(dvx, dvz); const a = Math.min(dl, ACC * dt); if (dl > 1e-4) { p.vx += dvx / dl * a; p.vz += dvz / dl * a; }
      p.x = clamp(p.x + p.vx * dt, -7.3, 7.3); p.z = clamp(p.z + p.vz * dt, 0.4, 13.6);
      const sp = Math.hypot(p.vx, p.vz); if (sp > 0.4) p.face = Math.atan2(p.vx, p.vz);
      if (p.charge > 0 || p.shooting) p.face = Math.atan2(RIM.x - p.x, RIM.z - p.z);
      p.y = p.jump > 0 ? Math.sin((1 - p.jump / 0.6) * Math.PI) * 0.75 : p.shooting ? 0.45 : 0;
      p.anim = p.jump > 0 || p.shooting ? 'jump' : sp > 5 ? 'sprint' : sp > 0.5 ? 'jog' : 'idle'; p.clip = undefined;
      if (p.stun > 0) { p.anim = 'emote'; p.clip = 'Hit_Chest'; }
      if (p.charge > 0) { p.anim = 'emote'; p.clip = 'Idle_Loop'; }
    }
    for (let a = 0; a < this.players.length; a++) for (let b = a + 1; b < this.players.length; b++) {
      const A = this.players[a], B = this.players[b]; const dx = B.x - A.x, dz = B.z - A.z; const d = Math.hypot(dx, dz);
      if (d < 0.65 && d > 1e-4) { const k = (0.65 - d) / 2 / d; A.x -= dx * k; A.z -= dz * k; B.x += dx * k; B.z += dz * k; }
    }
    this.ballStep(dt);
  }
  private end() { this.over = true; this.mode = 'over'; this.banner = 'GAME'; this.bannerT = 99; this.events.push(`Game over. ${this.score[0]} : ${this.score[1]}`); }

  private humanActs(i: number, p: BP, pad: PadIn, dt: number) {
    if (this.owner === i && this.mode === 'play') {
      if (pad.hold.shoot) p.charge += dt;
      if (pad.release.shoot && p.charge > 0) { this.release(i, p.charge / METER_T); p.charge = 0; return; }
      if (p.charge > METER_T * 1.35) { this.release(i, 1.35); p.charge = 0; return; } // held too long: a brick
      if (pad.press.pass) { const t = this.pickMate(i, pad.mx, pad.mz); if (t >= 0) this.pass(i, t); }
    } else {
      p.charge = 0;
      if (pad.press.tackle && p.jump <= 0 && p.cd <= 0) this.block(i, p);
      if (pad.press.thru) this.steal(i, p);
    }
  }
  private pickMate(i: number, mx: number, mz: number) {
    const p = this.players[i]; let dx = mx, dz = mz; if (Math.hypot(dx, dz) < 0.2) { dx = Math.sin(p.face); dz = Math.cos(p.face); }
    let best = -1, bs = -1e9; for (let j = 0; j < this.players.length; j++) { const q = this.players[j]; if (j === i || q.team !== p.team) continue; const ox = q.x - p.x, oz = q.z - p.z; const d = Math.hypot(ox, oz) || 1; const s = (ox * dx + oz * dz) / d * 2 - this.guarded(q) * 0.8; if (s > bs) { bs = s; best = j; } }
    return best;
  }
  private guarded(q: SimPlayer) { let g = 0; for (const o of this.players) if (o.team !== q.team) { const d = Math.hypot(o.x - q.x, o.z - q.z); if (d < 2) g = Math.max(g, (2 - d) / 2); } return g; }
  private pass(i: number, t: number) {
    const p = this.players[i], q = this.players[t]; const b = this.ball; const tx = q.x + q.vx * 0.4, tz = q.z + q.vz * 0.4;
    const d = Math.hypot(tx - p.x, tz - p.z) || 1; const T = 0.25 + d / 14; b.x = p.x; b.z = p.z; b.y = 1.3;
    b.vx = (tx - p.x) / T; b.vz = (tz - p.z) / T; b.vy = (1.3 - 1.3 + 0.5 * G * T * T) / T; this.owner = -1; this.mode = 'loose'; p.cd = 0.35; this.lastShooter = -1;
    this.events.push(`${p.name} to ${q.name}`);
  }
  /** let the shot go: v is the meter (0..1, past 1 is late) */
  private release(i: number, v: number) {
    const p = this.players[i]; const d = this.dHoop(p); const three = d > ARC; const pts = three ? 3 : 2;
    let base = d < 1.9 ? 0.86 : three ? 0.4 : 0.66 - (d - 1.9) * 0.035;
    const off = v < GOOD[0] ? GOOD[0] - v : v > GOOD[1] ? v - GOOD[1] : 0; const green = off === 0;
    let pr = green ? Math.max(base + 0.3, three ? 0.82 : 0.9) : base * Math.max(0.1, 1 - off * 3.2);
    let contest = 0; for (const o of this.players) if (o.team !== p.team) { const dd = Math.hypot(o.x - p.x, o.z - p.z); const between = Math.cos(angDiff(Math.atan2(o.x - p.x, o.z - p.z), p.face)) > 0.3; if (dd < 1.6 && between) contest = Math.max(contest, (1.6 - dd) / 1.6); }
    pr *= 1 - contest * (green ? 0.35 : 0.55);
    const make = this.rand() < clamp(pr, 0.02, 0.97);
    p.shooting = true; p.cd = 0.5; this.shot = { by: i, make, pts, t: 0, T: 0.75 + d * 0.06, blocked: false }; this.lastShooter = i;
    const b = this.ball; b.x = p.x + Math.sin(p.face) * 0.3; b.z = p.z + Math.cos(p.face) * 0.3; b.y = 2.25;
    // aim: the middle of the rim for a make, front or back iron for a miss
    const miss = make ? 0 : (this.rand() < 0.5 ? -1 : 1) * (0.22 + this.rand() * 0.12); const side = make ? 0 : (this.rand() - 0.5) * 0.3;
    const dx = RIM.x - b.x, dz = RIM.z - b.z; const dl = Math.hypot(dx, dz) || 1; const tx = RIM.x + dx / dl * miss + side, tz = RIM.z + dz / dl * miss;
    const T = this.shot.T; b.vx = (tx - b.x) / T; b.vz = (tz - b.z) / T; b.vy = (RIM.y + 0.02 - b.y + 0.5 * G * T * T) / T;
    this.owner = -1; this.mode = 'shot';
    this.events.push(green ? `${p.name} lets it fly. Green!` : `${p.name} ${three ? 'from deep' : d < 1.9 ? 'at the rim' : 'pulls up'}`);
    if (d < 1.9) { p.anim = 'jump'; }
  }
  private block(i: number, p: BP) {
    p.jump = 0.6; p.cd = 0.9; const s = this.shot; if (!s || s.t > 0.35 || s.blocked) return;
    const sh = this.players[s.by]; const d = Math.hypot(sh.x - p.x, sh.z - p.z);
    if (d < 1.4 && this.rand() < 0.55) { s.blocked = true; const b = this.ball; b.vx = (this.rand() - 0.5) * 6 + (p.x - sh.x) * -2; b.vz = 3 + this.rand() * 3; b.vy = 1; this.mode = 'loose'; this.shot = null; sh.shooting = false; this.events.push(`REJECTED! ${p.name} sends it back!`); this.banner = 'BLOCKED'; this.bannerT = 1.2; }
  }
  private steal(i: number, p: BP) {
    if (p.cd > 0 || this.owner < 0) return; p.cd = 0.8; const q = this.players[this.owner]; if (q.team === p.team) return;
    const d = Math.hypot(q.x - p.x, q.z - p.z); if (d > 1.3) return;
    if (this.rand() < (Math.hypot(q.vx, q.vz) > 5 ? 0.18 : 0.3)) { this.owner = -1; this.mode = 'loose'; const b = this.ball; b.vx = (p.x - q.x) * 3; b.vz = (p.z - q.z) * 3; b.vy = 1.5; q.stun = 0.4; this.events.push(`${p.name} picks his pocket!`); }
    else p.stun = 0.45; // reached and missed: off balance
  }

  // ---------------------------------------------------------------- the ball
  private ballStep(dt: number) {
    const b = this.ball;
    if (this.owner >= 0) { // dribbling: the ball bounces at the hand
      const p = this.players[this.owner]; this.dribT += dt * (Math.hypot(p.vx, p.vz) > 5 ? 9 : 6.5); const hand = p.face + 0.6;
      b.x = p.x + Math.sin(hand) * 0.42; b.z = p.z + Math.cos(hand) * 0.42; b.y = p.charge > 0 ? 1.6 : BR + Math.abs(Math.cos(this.dribT)) * 0.85; b.vx = p.vx; b.vz = p.vz; b.vy = 0; return;
    }
    const s = this.shot;
    if (s) {
      s.t += dt; if (s.t > 0.3) this.players[s.by].shooting = false;
      b.vy -= G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (s.t >= s.T) {
        const shooter = this.players[s.by];
        if (s.make) { this.score[shooter.team] += s.pts; this.events.push(`${shooter.name} for ${s.pts}! ${this.score[0]} : ${this.score[1]}`); this.banner = s.pts === 3 ? 'SPLASH! +3' : 'BUCKET +2'; this.bannerT = 1.4; b.x = RIM.x; b.z = RIM.z; b.vx = b.vz = 0; b.vy = -2; this.shot = null; this.mode = 'loose';
          if (this.score[shooter.team] >= BB_TARGET) { this.end(); return; }
          this.pendingCheck = { team: shooter.team ? 0 : 1, t: 1.1 };
        } else { // iron: bounce out
          const a = this.rand() * Math.PI * 2; b.vx = Math.sin(a) * 2.5; b.vz = Math.abs(Math.cos(a)) * 2.5 + 0.8; b.vy = 2.2 + this.rand() * 1.6; this.shot = null; this.mode = 'loose'; this.events.push(this.rand() < 0.5 ? 'Off the rim' : 'Clank!');
        }
      }
      return;
    }
    if (this.pendingCheck) { this.pendingCheck.t -= dt; b.vy -= G * dt; b.y = Math.max(BR, b.y + b.vy * dt); if (this.pendingCheck.t <= 0) { const t = this.pendingCheck.team; this.pendingCheck = null; this.check(t as 0 | 1); } return; }
    // loose ball physics: floor, backboard, court edges
    b.vy -= G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y < BR) { b.y = BR; b.vy = Math.abs(b.vy) > 1 ? -b.vy * 0.72 : 0; b.vx *= 0.92; b.vz *= 0.92; }
    if (b.z < BOARD_Z + BR && b.z > BOARD_Z - 0.2 && b.y > 2.9 && b.y < 4.0 && Math.abs(b.x) < 0.9) { b.z = BOARD_Z + BR; b.vz = Math.abs(b.vz) * 0.6; }
    if (Math.abs(b.x) > 7.5 || b.z < 0 || b.z > 14) { // out of bounds: the other side checks it
      const last = this.lastTouchTeam(); this.check(last === 0 ? 1 : 0); this.events.push('Out of bounds'); return;
    }
    // grab it
    if (b.y < 2.6) { let best = -1, bd = 1e9; for (let i = 0; i < this.players.length; i++) { const p = this.players[i]; if (p.stun > 0 || p.cd > 0.2) continue; const reach = 0.7 + (p.jump > 0 ? 0.3 : 0); const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < reach && b.y < 1.9 + (p.y ?? 0) && d < bd) { bd = d; best = i; } }
      if (best >= 0) { const p = this.players[best]; this.owner = best; this.mode = 'play'; this.lastHolder = p.team;
        if (p.team !== this.offense) { this.events.push(`${p.name} with the board. Take it back.`); this.pendingCheck = null; this.check(p.team); } } }
  }
  private pendingCheck: { team: number; t: number } | null = null; private lastHolder: number = 0;
  private lastTouchTeam() { return this.owner >= 0 ? this.players[this.owner].team : this.lastShooter >= 0 ? this.players[this.lastShooter].team : this.lastHolder; }

  // ---------------------------------------------------------------- AI
  private ai(i: number, p: BP, dt: number): [number, number, boolean] {
    const to = (x: number, z: number, r = 1): [number, number, boolean] => { const dx = x - p.x, dz = z - p.z; const d = Math.hypot(dx, dz); if (d < 0.2) return [0, 0, false]; const k = Math.min(1, d / r); return [dx / d * k, dz / d * k, d > 4]; };
    const b = this.ball; const offense = p.team === this.offense;
    if (this.owner === i && this.mode === 'play') {
      p.aiT += dt; const d = this.dHoop(p); const open = 1 - this.guarded(p);
      if (d < 1.8) { this.release(i, 0.82 + (this.rand() - 0.5) * 0.2); return [0, 0, false]; }
      if (p.aiT > 0.6 && open > 0.55 && d < 7.4 && this.rand() < dt * 1.6) { this.release(i, 0.85 + (this.rand() - 0.5) * 0.3); p.aiT = 0; return [0, 0, false]; }
      if (p.aiT > 1.4 && this.guarded(p) > 0.5 && this.rand() < dt * 2) { const t = this.pickMate(i, (this.rand() - 0.5) * 2, -1); if (t >= 0) { this.pass(i, t); p.aiT = 0; return [0, 0, false]; } }
      if (p.aiT > 4) { this.release(i, 0.8 + this.rand() * 0.15); p.aiT = 0; return [0, 0, false]; }
      const lane = this.players.some((o) => o.team !== p.team && Math.hypot(o.x - (p.x + (RIM.x - p.x) * 0.3), o.z - (p.z + (RIM.z - p.z) * 0.3)) < 1.2);
      return lane ? to(p.x + (this.rand() - 0.5) * 3, Math.max(4, p.z), 1) : to(RIM.x, RIM.z + 0.6, 1);
    }
    p.aiT = 0;
    if (this.mode === 'loose' || this.mode === 'shot') { // crash the boards (closest two of each side)
      const rank = this.players.filter((q) => q.team === p.team && !q.human).sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z)).indexOf(p);
      if (rank <= 1 && this.mode === 'loose') return to(b.x + b.vx * 0.3, b.z + b.vz * 0.3, 0.3);
      if (this.mode === 'shot') return to(RIM.x + (p.x - RIM.x) * 0.5, RIM.z + 1.6, 1);
    }
    if (offense) { const [x, z] = this.spots[p.spot % 3]; return to(x, z, 1.2); }
    // defense: stay between your man and the hoop; contest shooters; reach for steals now and then
    const mates = this.players.filter((q) => q.team !== p.team); const man = mates[this.players.filter((q) => q.team === p.team).indexOf(p)] ?? mates[0];
    const mi = this.players.indexOf(man);
    if (mi === this.owner && this.rand() < dt * 0.5) this.steal(i, p);
    if (this.shot && this.shot.by === mi && this.shot.t < 0.2 && p.jump <= 0 && this.rand() < 0.35) this.block(i, p);
    const dl = this.dHoop(man) || 1; const k = Math.min(1.3, dl * 0.25);
    return to(man.x + (RIM.x - man.x) / dl * k, man.z + (RIM.z - man.z) / dl * k, 0.6);
  }

  snap() { return { p: this.players.map((p) => [r1(p.x), r1(p.z), r1(p.face), p.anim, p.clip ?? '', p.human ?? '', r1(p.y ?? 0)]), b: [r1(this.ball.x), r1(this.ball.y), r1(this.ball.z)], s: this.score, c: Math.round(this.clock * 10) / 10, o: this.over ? 1 : 0, bn: this.bannerT > 0 ? this.banner : '', ev: this.events.splice(0) }; }
  apply(s0: unknown) {
    const s = s0 as any; if (!s?.p) return;
    s.p.forEach((a: any[], i: number) => { const p = this.players[i]; if (!p) return; p.vx = (a[0] - p.x) * 15; p.vz = (a[1] - p.z) * 15; p.x = a[0]; p.z = a[1]; p.face = a[2]; p.anim = a[3]; p.clip = a[4] || undefined; p.human = a[5] || null; p.y = a[6]; });
    this.ball.x = s.b[0]; this.ball.y = s.b[1]; this.ball.z = s.b[2]; this.score = s.s; this.clock = s.c; this.over = !!s.o;
    if (s.bn) { this.banner = s.bn; this.bannerT = 1; } this.events.push(...(s.ev ?? []));
    for (const [id] of this.control) { const i = this.players.findIndex((p) => p.human === id); if (i >= 0) this.control.set(id, i); }
  }
}
