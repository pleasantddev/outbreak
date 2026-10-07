// Bot players and creatures. Bots only ever emit Commands, exactly like a remote client would.
import { CREATURES, WEAPONS, HEART } from '../data/balance';
import { weaponStats, AMMO_STACK } from './items';
import { emptyCommand, type Actor, type Command, type Creature, type Loot, type Vec3 } from './types';
import type { Sim } from './sim';

type BotGoal = 'loot' | 'fight' | 'heart' | 'hunt' | 'extract' | 'zone' | 'heal' | 'roam' | 'flee';

export class BotBrain {
  sim: Sim; a: Actor; skill: number;
  goal: BotGoal = 'loot';
  path: number[] = []; pathI = 0; pathGoal: Vec3 | null = null; repathT = 0;
  target: { kind: 'actor' | 'creature'; id: number } | null = null;
  perceiveT = 0; engageT = 0; strafe = 1; strafeT = 0; burstT = 0; stuckT = 0; lastPos: Vec3;
  lootTarget: Loot | null = null; roamTo: Vec3 | null = null; thinkT = 0; reaction = 0;
  aimErr = { y: 0, p: 0 };
  badLoot = new Map<number, number>();
  constructor(sim: Sim, a: Actor, skill: number) { this.sim = sim; this.a = a; this.skill = skill; this.lastPos = { ...a.pos }; }

  think(dt: number): Command {
    const s = this.sim, a = this.a;
    const cmd = emptyCommand();
    cmd.yaw = a.yaw; cmd.pitch = 0; cmd.flashlight = a.cmd.flashlight;
    if (a.vehicle !== null) { cmd.interact = !a.prevCmd.interact; return cmd; }

    this.perceiveT -= dt; this.thinkT -= dt; this.repathT -= dt; this.strafeT -= dt;
    if (this.perceiveT <= 0) { this.perceive(); this.perceiveT = 0.25 + (1 - this.skill) * 0.2; }
    if (this.thinkT <= 0) { this.decide(); this.thinkT = 0.5; }

    // stuck detection: jump, then repath
    const moved = Math.hypot(a.pos.x - this.lastPos.x, a.pos.z - this.lastPos.z);
    if (this.wantsMove() && moved < 0.4 * dt * 4) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    this.lastPos = { ...a.pos };

    const tgt = this.targetPos();
    if (tgt && (this.goal === 'fight' || this.target)) {
      this.combat(cmd, tgt, dt);
    } else {
      this.engageT = 0;
      this.follow(cmd);
    }
    if (this.stuckT > 0.8) {
      cmd.jump = !a.prevCmd.jump;
      if (this.stuckT > 2.5) {
        if (this.lootTarget) this.badLoot.set(this.lootTarget.id, s.time + 40);
        this.path = []; this.stuckT = 0; this.repathT = 0; this.roamTo = null; this.lootTarget = null;
      }
    }

    // keep weapon sensible
    if (a.inv.primary && a.slot !== 0 && !(this.target && a.slot === 1 && a.inv.primary.mag === 0)) cmd.slot = 0;
    else if (!a.inv.primary && a.slot !== 1 && a.inv.secondary) cmd.slot = 1;
    const w = s.currentWeapon(a);
    if (w && w.id !== 'machete' && !this.target) { const st = weaponStats(w); if (w.mag < st.mag * 0.5 && a.inv.count(AMMO_STACK[st.ammo]!)) cmd.reload = !a.prevCmd.reload; }
    if (this.goal === 'heal') cmd.heal = true;
    if (a.inv.count('artifact') > 0 && this.target && a.hp < 60) cmd.awaken = true;
    return cmd;
  }

  private wantsMove() { return this.path.length > 0 || this.goal !== 'fight'; }

  private perceive() {
    const s = this.sim, a = this.a, eye = s.eye(a);
    let best: { kind: 'actor' | 'creature'; id: number; d: number } | null = null;
    for (const o of s.actors) {
      if (o === a || !o.alive) continue;
      const d = Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z);
      const range = o.heart || o.awakenT > 0 ? 120 : 75;
      if (d > range) continue;
      if (o.shadowT > 0 && d > 4) continue;
      if (!s.phys.lineOfSight(eye, s.eye(o))) continue;
      const score = d * (o.heart ? 0.5 : 1);
      if (!best || score < best.d) best = { kind: 'actor', id: o.id, d: score };
    }
    for (const c of s.creatures) {
      if (!c.alive || c.state === 'frozen') continue;
      const d = Math.hypot(c.pos.x - a.pos.x, c.pos.z - a.pos.z);
      if (d > 22 || (c.target !== a.id && d > 12)) continue;
      if (!s.phys.lineOfSight(eye, { x: c.pos.x, y: c.pos.y + 1.2, z: c.pos.z })) continue;
      const score = d * 1.3;
      if (!best || score < best.d) best = { kind: 'creature', id: c.id, d: score };
    }
    // hearing: turn toward recent gunfire nearby
    if (!best) {
      const n = s.noises.find((n) => n.by !== a.id && Math.hypot(n.pos.x - a.pos.x, n.pos.z - a.pos.z) < n.r * 0.6);
      if (n && this.goal !== 'extract' && this.goal !== 'heart') this.roamTo = { ...n.pos };
    }
    const prev = this.target?.id;
    this.target = best ? { kind: best.kind, id: best.id } : null;
    if (this.target && this.target.id !== prev) { this.reaction = 0.25 + (1 - this.skill) * 0.5; this.aimErr = { y: (Math.random() - 0.5) * 0.25, p: (Math.random() - 0.5) * 0.15 }; }
  }

  private decide() {
    const s = this.sim, a = this.a;
    const hasHeal = a.inv.count('bandage') + a.inv.count('medkit') > 0;
    if (a.heart) { this.goal = s.extractionOpen ? 'extract' : 'flee'; return; }
    if (s.zone.active && Math.hypot(a.pos.x - s.zone.cx, a.pos.z - s.zone.cz) > s.zone.r - 15) { this.goal = 'zone'; return; }
    if (s.corruption.some((c) => Math.hypot(a.pos.x - c.x, a.pos.z - c.z) < c.r)) { this.goal = 'zone'; return; }
    if (a.hp < 45 && hasHeal && !this.target) { this.goal = 'heal'; return; }
    if (this.target) { this.goal = 'fight'; return; }
    if (s.heart.active) {
      const d = Math.hypot(s.heart.pos.x - a.pos.x, s.heart.pos.z - a.pos.z);
      if (s.heart.carrier === null && (d < 260 || this.skill > 0.6)) { this.goal = 'heart'; return; }
      if (s.heart.carrier !== null && (this.skill > 0.45 || d < 120)) { this.goal = 'hunt'; return; }
    }
    if (!a.inv.primary || a.inv.freeSlots() > 1 || !a.inv.armor) { this.goal = 'loot'; return; }
    this.goal = 'roam';
  }

  private targetPos(): Vec3 | null {
    if (!this.target) return null;
    const s = this.sim;
    if (this.target.kind === 'actor') { const o = s.actors[this.target.id]; return o && o.alive ? { x: o.pos.x, y: o.pos.y + (o.crouch ? 1.0 : 1.35), z: o.pos.z } : null; }
    const c = s.creatures.find((c) => c.id === this.target!.id);
    return c && c.alive ? { x: c.pos.x, y: c.pos.y + 1.1, z: c.pos.z } : null;
  }

  private combat(cmd: Command, tgt: Vec3, dt: number) {
    const s = this.sim, a = this.a;
    this.engageT += dt;
    const eye = s.eye(a);
    const dx = tgt.x - eye.x, dy = tgt.y - eye.y, dz = tgt.z - eye.z;
    const d = Math.hypot(dx, dz);
    // aim error shrinks the longer we stay engaged
    const settle = Math.max(0.15, 1 - this.engageT * (0.4 + this.skill));
    const yaw = Math.atan2(dx, dz) + this.aimErr.y * settle;
    const pitch = Math.atan2(dy, d) + this.aimErr.p * settle;
    cmd.yaw = yaw; cmd.pitch = pitch;
    const cp = Math.cos(pitch);
    cmd.aimDir = { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: Math.cos(yaw) * cp };
    const w = s.currentWeapon(a);
    const st = w ? weaponStats(w) : null;
    const melee = !w || w.id === 'machete' || a.awakenT > 0;
    this.reaction -= dt;
    // strafe and pick range by weapon
    if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0.6 + Math.random() * 1.2; }
    const ideal = melee ? 1.2 : st!.range * 0.8;
    const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) }, right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    let mvF = d > ideal + 6 ? 1 : d < ideal - 4 && !melee ? -0.6 : 0;
    if (this.target?.kind === 'creature' && d < 5 && !melee) mvF = -1;
    const strafeAmt = melee ? 0 : this.skill > 0.4 ? 0.8 : 0.4;
    cmd.mx = fwd.x * mvF + right.x * this.strafe * strafeAmt;
    cmd.mz = fwd.z * mvF + right.z * this.strafe * strafeAmt;
    const l = Math.hypot(cmd.mx, cmd.mz); if (l > 1) { cmd.mx /= l; cmd.mz /= l; }
    cmd.aim = !melee && d > 10;
    cmd.crouch = !melee && this.skill > 0.6 && d > 25 && Math.sin(this.engageT * 0.7) > 0.4;
    if (this.reaction <= 0) {
      if (melee) cmd.fire = d < 2.6;
      else if (st) {
        if (st.auto) { this.burstT -= dt; if (this.burstT < -0.35) this.burstT = 0.25 + this.skill * 0.4; cmd.fire = this.burstT > 0 && d < st.maxRange; }
        else cmd.fire = !a.prevCmd.fire && d < st.maxRange && Math.random() < 0.35 + this.skill * 0.4;
      }
    }
    // abilities
    const ab0 = a.inv.abilities[0];
    if (ab0 && ab0.cd <= 0) {
      if (ab0.id === 'force' && d < 8) cmd.ability1 = true;
      if (ab0.id === 'shadow' && a.hp < 45) cmd.ability1 = true;
      if (ab0.id === 'metal' && a.lastHurt > s.time - 0.5 && d > 15) cmd.ability1 = true;
    }
    if (a.inv.count('frag') && d > 8 && d < 22 && Math.random() < dt * 0.15) cmd.throwFrag = true;
    // out of sight for a while: give up
    if (this.engageT > 25) this.target = null;
  }

  private destination(): Vec3 | null {
    const s = this.sim, a = this.a;
    switch (this.goal) {
      case 'heart': return { ...s.heart.pos };
      case 'hunt': return s.heart.carrier !== null ? { ...s.actors[s.heart.carrier].pos } : null;
      case 'extract': {
        let best: Vec3 | null = null, bd = 1e9;
        for (const e of s.city.extractions) { const d = Math.hypot(e.p[0] - a.pos.x, e.p[2] - a.pos.z); if (d < bd) { bd = d; best = { x: e.p[0], y: e.p[1], z: e.p[2] }; } }
        return best;
      }
      case 'flee': {
        // move away from the nearest threat toward the middle of the city
        return { x: s.zone.cx + Math.sin(this.a.id) * 80, y: 0, z: s.zone.cz + Math.cos(this.a.id) * 80 };
      }
      case 'zone': {
        const c = s.corruption.find((c) => Math.hypot(a.pos.x - c.x, a.pos.z - c.z) < c.r);
        if (c) { const dx = a.pos.x - c.x, dz = a.pos.z - c.z, l = Math.hypot(dx, dz) || 1; return { x: c.x + (dx / l) * (c.r + 20), y: 0, z: c.z + (dz / l) * (c.r + 20) }; }
        return { x: s.zone.cx, y: 0, z: s.zone.cz };
      }
      case 'heal': return null;
      case 'loot': {
        if (!this.lootTarget || this.lootTarget.taken) this.lootTarget = this.pickLoot();
        if (this.lootTarget) return { ...this.lootTarget.pos };
        return this.roam();
      }
      default: return this.roamTo ?? this.roam();
    }
  }
  private roam(): Vec3 {
    const s = this.sim;
    if (!this.roamTo || Math.hypot(this.roamTo.x - this.a.pos.x, this.roamTo.z - this.a.pos.z) < 3) {
      const id = s.nav.randomNode(() => s.rng.next(), (n) => (n.kind === 'room' || n.kind === 'roof' || n.kind === 'open') && Math.hypot(n.p[0] - this.a.pos.x, n.p[2] - this.a.pos.z) < 160 && (!s.zone.active || Math.hypot(n.p[0] - s.zone.cx, n.p[2] - s.zone.cz) < s.zone.r * 0.8));
      this.roamTo = s.nav.pos(id);
    }
    return this.roamTo;
  }
  private pickLoot(): Loot | null {
    const s = this.sim, a = this.a;
    let best: Loot | null = null, bs = 1e9;
    for (const l of s.loot) {
      if (l.taken || (this.badLoot.get(l.id) ?? 0) > s.time) continue;
      const d = Math.hypot(l.pos.x - a.pos.x, l.pos.z - a.pos.z) + Math.abs(l.pos.y - a.pos.y) * 2;
      if (d > 70) continue;
      let want = 1;
      if (l.item.kind === 'weapon') want = !a.inv.primary && WEAPONS[l.item.id].slot === 'primary' ? 0.25 : 3;
      if (l.item.kind === 'armor') want = !a.inv.armor || a.inv.armor.level < l.item.level ? 0.5 : 4;
      if (l.item.kind === 'stack' && l.item.type === 'artifact') want = 0.3;
      const sc = d * want;
      if (sc < bs) { bs = sc; best = l; }
    }
    return best;
  }

  private follow(cmd: Command) {
    const s = this.sim, a = this.a;
    const dest = this.destination();
    if (this.goal === 'heal' || !dest) { cmd.heal = this.goal === 'heal'; return; }
    const destMoved = !this.pathGoal || Math.hypot(dest.x - this.pathGoal.x, dest.z - this.pathGoal.z) > 6;
    if (this.repathT <= 0 && (destMoved || this.pathI >= this.path.length)) {
      const vis = (p: Vec3, q: Vec3) => s.phys.lineOfSight(p, q);
      this.path = s.nav.path(s.nav.nearestVisible(a.pos, vis), s.nav.nearestVisible(dest, vis));
      this.pathI = 0; this.pathGoal = { ...dest }; this.repathT = 1.5;
    }
    let p: Vec3 = dest;
    while (this.pathI < this.path.length) {
      const n = s.nav.pos(this.path[this.pathI]);
      if (Math.hypot(n.x - a.pos.x, n.z - a.pos.z) < 1.3 && Math.abs(n.y - a.pos.y) < 1.8) this.pathI++;
      else { p = n; break; }
    }
    const dx = p.x - a.pos.x, dz = p.z - a.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.6 && this.pathI >= this.path.length) {
      // arrived: pick up what we came for, or grab the Heart
      if (this.lootTarget && !this.lootTarget.taken && Math.hypot(this.lootTarget.pos.x - a.pos.x, this.lootTarget.pos.z - a.pos.z) < 2) { s.pickup(a, this.lootTarget, true); this.lootTarget = null; }
      if (this.goal === 'heart' && s.heart.carrier === null && Math.hypot(s.heart.pos.x - a.pos.x, s.heart.pos.z - a.pos.z) < 2.4) cmd.interact = !a.prevCmd.interact;
      return;
    }
    cmd.mx = dx / (d || 1); cmd.mz = dz / (d || 1);
    cmd.yaw = Math.atan2(dx, dz);
    cmd.sprint = d > 6 && this.goal !== 'roam';
    if (this.goal === 'heart' && Math.hypot(s.heart.pos.x - a.pos.x, s.heart.pos.z - a.pos.z) < 2.4) cmd.interact = !a.prevCmd.interact;
    if (this.lootTarget && !this.lootTarget.taken && Math.hypot(this.lootTarget.pos.x - a.pos.x, this.lootTarget.pos.z - a.pos.z) < 1.8 && Math.abs(this.lootTarget.pos.y - a.pos.y) < 1.5) { s.pickup(a, this.lootTarget, true); this.lootTarget = null; }
  }
}

export class CreatureBrain {
  sim: Sim; c: Creature; perceiveT = Math.random() * 0.3; growlT = 2 + Math.random() * 6;
  constructor(sim: Sim, c: Creature) { this.sim = sim; this.c = c; }

  update(dt: number) {
    const s = this.sim, c = this.c, def = CREATURES[c.kind];
    const night = 1 + (def.nightMult - 1) * s.night;
    c.atkCd = Math.max(0, c.atkCd - dt);
    this.perceiveT -= dt; this.growlT -= dt;
    const stun = (c as any)._stun as number | undefined;
    if (stun !== undefined) { (c as any)._stun = stun - dt; if (stun - dt <= 0) { (c as any)._stun = undefined; c.state = 'chase'; } s.moveCreature(c, { x: 0, z: 0 }, 0, dt); c.anim = 'frozen'; return; }
    if (this.perceiveT <= 0) { this.perceive(); this.perceiveT = 0.25; }
    if (this.growlT <= 0) { this.growlT = 4 + Math.random() * 8; s.events.push({ t: 'creatureSound', id: c.id, kind: c.state === 'chase' ? 'scream' : 'growl', at: { ...c.pos } }); }

    // stalkers lock up while a flashlight holds them
    if (c.kind === 'stalker' && c.lit > 0) { c.state = 'frozen'; c.anim = 'frozen'; s.moveCreature(c, { x: 0, z: 0 }, 0, dt); return; }
    if (c.state === 'frozen' && c.kind === 'stalker') c.state = 'chase';

    const t = c.target !== null ? s.actors[c.target] : null;
    if (c.state === 'chase' && t && t.alive) {
      const tp = t.pos;
      const dx = tp.x - c.pos.x, dz = tp.z - c.pos.z, d = Math.hypot(dx, dz);
      if (d < def.attackRange && Math.abs(tp.y - c.pos.y) < 1.8) {
        c.anim = 'attack';
        s.moveCreature(c, { x: dx / d * 0.01, z: dz / d * 0.01 }, 0.5, dt);
        if (c.atkCd <= 0) {
          c.atkCd = def.attackCd;
          if (t.vehicle === null) s.damageActor(t, def.damage * night, null, false, def.name, true);
          s.events.push({ t: 'creatureSound', id: c.id, kind: 'attack', at: { ...c.pos } });
        }
        return;
      }
      // direct steering when close and visible, otherwise the nav graph
      let dir = { x: dx / (d || 1), z: dz / (d || 1) };
      const sameLevel = Math.abs(tp.y - c.pos.y) < 1.6;
      if (!(d < 14 && sameLevel)) {
        c.pathT -= dt;
        if (c.pathT <= 0 || !c.path.length) { const vis = (p: Vec3, q: Vec3) => s.phys.lineOfSight(p, q); c.path = s.nav.path(s.nav.nearestVisible(c.pos, vis), s.nav.nearestVisible(tp, vis), 2500); c.pathT = 1.2; }
        while (c.path.length) {
          const n = s.nav.pos(c.path[0]);
          if (Math.hypot(n.x - c.pos.x, n.z - c.pos.z) < 1.2 && Math.abs(n.y - c.pos.y) < 1.8) c.path.shift(); else { const l = Math.hypot(n.x - c.pos.x, n.z - c.pos.z) || 1; dir = { x: (n.x - c.pos.x) / l, z: (n.z - c.pos.z) / l }; break; }
        }
      }
      const speed = def.speed * night * (t.heart ? 1.1 : 1);
      s.moveCreature(c, dir, speed, dt);
      c.anim = speed > 4 ? 'run' : 'walk';
      // stuck: hop
      if (c.speed < speed * 0.25) { c.stuck += dt; if (c.stuck > 0.7 && c.vy === 0) { c.vy = 6; c.stuck = 0; c.path = []; } } else c.stuck = 0;
      if (d > def.sight * 2.5) { c.state = 'wander'; c.target = null; }
      return;
    }
    if (c.state === 'idle') { s.moveCreature(c, { x: 0, z: 0 }, 0, dt); c.anim = 'idle'; return; }
    // wander
    if (!c.wanderTo || Math.hypot(c.wanderTo.x - c.pos.x, c.wanderTo.z - c.pos.z) < 1.5) {
      const n = s.nav.nearest({ x: c.pos.x + (Math.random() - 0.5) * 40, y: c.pos.y, z: c.pos.z + (Math.random() - 0.5) * 40 }, 30);
      c.wanderTo = n >= 0 ? s.nav.pos(n) : { ...c.pos };
    }
    const dx = c.wanderTo.x - c.pos.x, dz = c.wanderTo.z - c.pos.z, d = Math.hypot(dx, dz) || 1;
    s.moveCreature(c, { x: dx / d, z: dz / d }, def.speed * 0.3, dt);
    c.anim = 'walk';
    if (c.speed < 0.2) { c.stuck += dt; if (c.stuck > 2) { c.wanderTo = null; c.stuck = 0; } }
  }

  private perceive() {
    const s = this.sim, c = this.c, def = CREATURES[c.kind];
    const head = { x: c.pos.x, y: c.pos.y + 1.5, z: c.pos.z };
    // flashlights pin stalkers in place
    if (c.kind === 'stalker') {
      c.lit = 0;
      for (const a of s.actors) {
        if (!a.alive || !a.flashlight) continue;
        const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        if (d > 28) continue;
        const f = { x: Math.sin(a.yaw), z: Math.cos(a.yaw) };
        if ((dx * f.x + dz * f.z) / (d || 1) > 0.92 && s.phys.lineOfSight(s.eye(a), head)) { c.lit = 1; break; }
      }
    }
    let best: number | null = null, bd = 1e9;
    for (const a of s.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z);
      const carrierPull = a.heart && d < HEART.creatureAggroRadius;
      const range = a.shadowT > 0 ? 3 : carrierPull ? HEART.creatureAggroRadius : def.sight * (c.state === 'idle' ? 0.55 : 1);
      if (d > range) continue;
      if (!carrierPull && d > 6 && !s.phys.lineOfSight(head, s.eye(a))) continue;
      const score = d * (a.heart ? 0.4 : 1);
      if (score < bd) { bd = score; best = a.id; }
    }
    if (best === null) {
      const n = s.noises.find((n) => Math.hypot(n.pos.x - c.pos.x, n.pos.z - c.pos.z) < Math.min(n.r, def.hearing) && n.by >= 0);
      if (n && s.actors[n.by]?.alive) best = n.by;
    }
    if (best !== null) {
      if (c.target !== best && c.state !== 'chase') s.events.push({ t: 'creatureSound', id: c.id, kind: 'scream', at: { ...c.pos } });
      c.target = best; c.state = 'chase';
    }
  }
}
