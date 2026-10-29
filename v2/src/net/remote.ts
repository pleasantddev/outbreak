// Other players: people and cars from the server's snapshots, drawn with the same HumanView and car builders the sim uses.
// They are visuals only (plus a kinematic collider for nearby cars), so offline code paths never see them.
import * as THREE from 'three';
import { HumanView, type CharState, type HumanAssets, type SeatTarget } from '../render/humans';
import { buildCar, poseCar, type CarModel } from '../render/cars';
import { seatTarget } from '../render/seating';
import { BASE_LOOKS, lookFor } from '../profile';
import { audio } from '../audio/audio';
import { VEHICLES, type VehicleKind, type WeaponId } from '../data/balance';
import type { CharacterLook } from '../data/cosmetics';
import { RAPIER, G, groups } from '../sim/physics';
import type { LifeSim } from '../sim/life';
import type { LifeView } from '../render/lifeView';
import { ANIMS, EMOTES, F, VF, VKINDS, WEAPON_WIRE, unpackDoors, unpackPitch, unpackQ, unpackSteer, unpackYaw, type PlayerEnt, type SnapResult, type VehEnt, type WhoInfo } from './protocol';

export const EMOTE_CLIP: Record<(typeof EMOTES)[number], { clip: string; secs: number }> = {
  wave: { clip: 'Idle_Rail_Call', secs: 3 }, dance: { clip: 'Dance_Loop', secs: 9 }, phone: { clip: 'Idle_TalkingPhone_Loop', secs: 7 },
  no: { clip: 'Idle_No_Loop', secs: 2.5 }, talk: { clip: 'Idle_Talking_Loop', secs: 5 }, arms: { clip: 'Idle_FoldArms_Loop', secs: 6 },
};

interface PS { t: number; x: number; y: number; z: number; yaw: number; pitch: number; speed: number; anim: number; flags: number; weapon: number; veh: number; seat: number }
interface VS { t: number; x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; steer: number; doors: [number, number, number, number]; vflags: number; vspeed: number; driver: number }
interface RP {
  id: number; buf: PS[]; view: HumanView | null; plate: HTMLElement; who?: WhoInfo; weapon: WeaponId | null;
  emote: { clip: string; until: number } | null; talkUntil: number; fireAt: number; fireHeld: boolean; acc: number; skip: number;
  moveYaw: number; seat?: SeatTarget; lastX: number; lastZ: number; speed: number; interval: number; built: boolean; hidden: boolean;
}
interface RC {
  id: number; buf: VS[]; kind: VehicleKind; seed: number; m: CarModel | null; loading: boolean; spin: number; interval: number; dead: boolean;
  body: any; lastHorn: number; lastX: number; lastZ: number;
}
const NEUTRAL: CharacterLook = { name: 'Player', body: 'male', skin: 1, hair: 'buzzed', beard: false, top: 'tee', topPattern: 'solid', topColor: '#e8e0d0', topAccent: '#141414', pants: 'solid', pantsColor: '#1e2b3a', shoes: '#141414', head: 'none', vest: false, backpack: false, scars: 0, facePaint: 'none', model: 'survivor' } as CharacterLook;
const MAX_HUMANS = 28, HUMAN_RANGE = 170, PLATE_RANGE = 48, COLLIDE_RANGE = 90;
const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();

/** the two samples either side of render time rt, and how far between them. Holds the last sample when rt is past it. */
function pick<T extends { t: number }>(buf: T[], rt: number): [T, T, number] {
  const n = buf.length; const last = buf[n - 1];
  if (n === 1 || rt >= last.t) return [last, last, 0];
  if (rt <= buf[0].t) return [buf[0], buf[0], 0];
  let i = n - 2; while (i > 0 && buf[i].t > rt) i--;
  const a = buf[i], b = buf[i + 1]; return [a, b, (rt - a.t) / Math.max(1, b.t - a.t)];
}
function trim<T extends { t: number }>(buf: T[], rt: number) { while (buf.length > 3 && buf[1].t < rt - 400) buf.shift(); while (buf.length > 40) buf.shift(); }

export class RemoteWorld {
  players = new Map<number, RP>(); cars = new Map<number, RC>(); who = new Map<number, WhoInfo>();
  private tmpV = new THREE.Vector3(); private hidden = false;
  /** how far behind the server's clock remote things are drawn, ms */
  delay = 110; shown = 0; night = 0;
  onNameClick: ((name: string) => void) | null = null;
  private plateLayer: HTMLElement;

  constructor(private view: LifeView, private sim: LifeSim, private assets: HumanAssets, private now: () => number, private myId: () => number) {
    this.plateLayer = document.createElement('div'); this.plateLayer.id = 'nt-plates'; this.plateLayer.style.cssText = 'position:fixed;inset:0;z-index:4;pointer-events:none;overflow:hidden';
    document.body.appendChild(this.plateLayer);
  }

  setWho(list: WhoInfo[]) { for (const w of list) { this.who.set(w.id, w); const p = this.players.get(w.id); if (p) this.applyWho(p, w); } }
  private applyWho(p: RP, w: WhoInfo) {
    const changed = !p.who || p.who.model !== w.model || p.who.skin !== w.skin || p.who.outfit !== w.outfit; p.who = w;
    p.plate.className = 'nt-plate' + (w.role && w.role !== 'user' ? ' mod' : '');
    p.plate.innerHTML = ''; p.plate.append(document.createTextNode(w.name)); const lv = document.createElement('small'); lv.textContent = `Lv ${w.level}`; p.plate.append(lv);
    if (changed && p.view) { p.view.dispose(); p.view = null; p.built = false; }
  }

  onSnapshot(r: SnapResult) {
    const me = this.myId();
    for (const e of r.changed) {
      if (e.k === 0) {
        if (e.id === me) continue;
        const p = this.player(e.id); const t = r.time;
        const last = p.buf[p.buf.length - 1]; if (last && t < last.t) continue;
        if (last) p.interval = p.interval * 0.8 + Math.min(400, t - last.t) * 0.2;
        const s: PS = { t, x: e.X / 100, y: e.Y / 100, z: e.Z / 100, yaw: unpackYaw(e.yaw), pitch: unpackPitch(e.pitch), speed: e.speed / 4, anim: e.anim, flags: e.flags, weapon: e.weapon, veh: e.veh, seat: e.seat };
        if (last && last.t === t) p.buf[p.buf.length - 1] = s; else p.buf.push(s);
      } else {
        const c = this.car(e); const t = r.time;
        const last = c.buf[c.buf.length - 1]; if (last && t < last.t) continue;
        if (last) c.interval = c.interval * 0.8 + Math.min(400, t - last.t) * 0.2;
        const s: VS = { t, x: e.X / 100, y: e.Y / 100, z: e.Z / 100, qx: unpackQ(e.qx), qy: unpackQ(e.qy), qz: unpackQ(e.qz), qw: unpackQ(e.qw), steer: unpackSteer(e.steer), doors: unpackDoors(e.doors), vflags: e.vflags, vspeed: e.vspeed / 100, driver: e.driver };
        if (last && last.t === t) c.buf[c.buf.length - 1] = s; else c.buf.push(s);
      }
    }
    for (const id of r.removed) this.drop(id);
  }
  private player(id: number): RP {
    let p = this.players.get(id); if (p) return p;
    const plate = document.createElement('div'); plate.className = 'nt-plate'; plate.textContent = this.who.get(id)?.name ?? '…'; this.plateLayer.appendChild(plate);
    p = { id, buf: [], view: null, plate, weapon: null, emote: null, talkUntil: 0, fireAt: 0, fireHeld: false, acc: 0, skip: 0, moveYaw: 0, lastX: 0, lastZ: 0, speed: 0, interval: 66, built: false, hidden: false };
    this.players.set(id, p); const w = this.who.get(id); if (w) this.applyWho(p, w);
    return p;
  }
  private car(e: VehEnt): RC {
    let c = this.cars.get(e.id); if (c) return c;
    c = { id: e.id, buf: [], kind: VKINDS[e.kind] ?? 'sedan', seed: e.seed, m: null, loading: false, spin: 0, interval: 66, dead: false, body: null, lastHorn: 0, lastX: 0, lastZ: 0 };
    this.cars.set(e.id, c); return c;
  }
  private drop(id: number) {
    if (id & 0x8000) {
      const c = this.cars.get(id); if (!c) return; c.dead = true; c.m?.root.removeFromParent(); this.killBody(c); audio.engine(100000 + (id & 0x7fff), null, 0, 'suv'); this.cars.delete(id);
    } else {
      const p = this.players.get(id); if (!p) return; p.view?.dispose(); p.plate.remove(); this.players.delete(id);
    }
  }
  clear() { for (const id of [...this.players.keys()]) this.drop(id); for (const id of [...this.cars.keys()]) this.drop(id); }

  emote(id: number, name: string) {
    const p = this.players.get(id); const def = (EMOTE_CLIP as any)[name] as { clip: string; secs: number } | undefined; if (!p || !def) return;
    p.emote = { clip: def.clip, until: performance.now() + def.secs * 1000 };
  }
  said(id: number) { const p = this.players.get(id); if (p) p.talkUntil = performance.now() + 4000; }
  nearest(x: number, z: number, r = 12): { id: number; name: string } | null {
    let best: RP | null = null, bd = r * r;
    for (const p of this.players.values()) { const s = p.buf[p.buf.length - 1]; if (!s) continue; const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = p; } }
    return best ? { id: best.id, name: best.who?.name ?? '' } : null;
  }
  /** for the minimap */
  blips(): { x: number; z: number; name: string }[] { const out: { x: number; z: number; name: string }[] = []; for (const p of this.players.values()) { const s = p.buf[p.buf.length - 1]; if (s) out.push({ x: s.x, z: s.z, name: p.who?.name ?? '' }); } return out; }
  setVisible(v: boolean) { this.hidden = !v; this.plateLayer.style.display = v ? '' : 'none'; }

  // ------------------------------------------------------------------------------------------ per frame
  update(dt: number) {
    const cam = this.view.camera; const camP = cam.position; const nowS = this.now(); const nowP = performance.now();
    cam.updateMatrixWorld();
    // cars first: people seated in them need the car's pose
    const carPose = new Map<number, { x: number; y: number; z: number; q: THREE.Quaternion; s: VS }>();
    for (const c of this.cars.values()) {
      if (!c.buf.length) continue;
      const rt = nowS - Math.max(this.delay, c.interval * 1.8); trim(c.buf, rt);
      const [a, b, k] = pick(c.buf, rt);
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
      qa.set(a.qx, a.qy, a.qz, a.qw); qb.set(b.qx, b.qy, b.qz, b.qw); const q = qa.clone().slerp(qb, k);
      const dist = Math.hypot(x - camP.x, z - camP.z);
      carPose.set(c.id, { x, y, z, q, s: b });
      if (dist > 320 || this.hidden) { if (c.m) c.m.root.visible = false; audio.engine(100000 + (c.id & 0x7fff), null, 0, 'suv'); this.killBody(c); continue; }
      if (!c.m) {
        if (!c.loading) { c.loading = true; buildCar(c.kind, c.seed).then((m) => { if (c.dead) return; c.m = m; c.loading = false; this.view.scene.add(m.root); }).catch(() => { c.loading = false; }); }
        continue;
      }
      const m = c.m; m.root.visible = true; m.root.position.set(x, y, z); m.root.quaternion.copy(q);
      const sp = b.vspeed; c.spin += (sp / (VEHICLES[c.kind].wheelRadius || 0.35)) * dt;
      // doors: the server sends the opening of each; poseCar wants the same 0..1 values
      poseCar(m, [c.spin, c.spin, c.spin, c.spin], b.steer, b.doors);
      const night = this.night; const lit = (b.vflags & VF.LIGHTS) !== 0; const driven = (b.vflags & VF.DRIVEN) !== 0;
      for (const h of m.headlights) h.emissiveIntensity = lit || driven ? (night > 0.3 ? 8 : 0.6) : 0;
      for (const br of m.brake) br.emissiveIntensity = (b.vflags & VF.BRAKE) ? 6 : driven && night > 0.3 ? 2 : 0;
      const siren = (m.root as any).siren; if (siren && (b.vflags & VF.SIREN)) { const f = Math.sin(this.view.time * 14) > 0; siren[0].emissiveIntensity = f ? 8 : 0; siren[1].emissiveIntensity = f ? 0 : 8; }
      const ek = c.kind === 'keke' || c.kind === 'okada' ? 'okada' : c.kind === 'danfo' ? 'danfo' : 'suv';
      if (driven && dist < 80) audio.engine(100000 + (c.id & 0x7fff), { x, y, z }, Math.min(1, Math.abs(sp) / VEHICLES[c.kind].topSpeed + 0.1), ek);
      else audio.engine(100000 + (c.id & 0x7fff), null, 0, ek);
      if ((b.vflags & VF.HORN) && nowP - c.lastHorn > 380 && dist < 90) { c.lastHorn = nowP; audio.horn({ x, y, z }); }
      this.collide(c, x, y, z, q, dist);
    }

    // people
    const near = [...this.players.values()].map((p) => ({ p, s: p.buf[p.buf.length - 1] })).filter((o) => o.s).map((o) => ({ ...o, d: Math.hypot(o.s.x - camP.x, o.s.z - camP.z) })).sort((a, b) => a.d - b.d);
    let built = 0, shown = 0;
    for (let i = 0; i < near.length; i++) {
      const { p, d } = near[i];
      const rt = nowS - Math.max(this.delay, p.interval * 1.8); trim(p.buf, rt);
      const [a, b, k] = pick(p.buf, rt);
      let x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
      const yaw = a.yaw + wrap(b.yaw - a.yaw) * k, pitch = a.pitch + (b.pitch - a.pitch) * k;
      // discrete fields come from the newer sample once we are past halfway
      const cur = k > 0.5 ? b : a;
      const inCar = cur.veh !== 0 ? carPose.get(cur.veh) : undefined;
      if (inCar) { x = inCar.x; y = inCar.y; z = inCar.z; }
      const dist = Math.hypot(x - camP.x, z - camP.z);
      const mx = x - p.lastX, mz = z - p.lastZ;
      if (mx * mx + mz * mz > 0.0004) p.moveYaw = Math.atan2(mx, mz);
      p.speed = p.speed * 0.8 + (Math.hypot(mx, mz) / Math.max(dt, 1e-3)) * 0.2; p.lastX = x; p.lastZ = z;
      const visible = !this.hidden && dist < HUMAN_RANGE && i < MAX_HUMANS + 8;
      if (!visible) { if (p.view) p.view.root.visible = false; p.plate.style.display = 'none'; continue; }
      if (!p.view) {
        if (built >= 2) { p.plate.style.display = 'none'; continue; } // spread the cost of building people over frames
        const w = p.who; const look = lookFor({ name: w?.name ?? 'Player', model: (w?.model as any) ?? 'survivor', skin: w?.skin ?? 1, outfit: w?.outfit ?? 'street' }, NEUTRAL);
        if (!((look.model as string) in BASE_LOOKS)) look.model = 'survivor' as any;
        try { p.view = new HumanView(this.assets, look, p.id * 7.3); } catch { continue; }
        this.view.scene.add(p.view.root); p.view.root.position.set(x, y, z); p.built = true; built++;
      }
      const v = p.view;
      v.root.visible = true; shown++;
      v.setLod(dist > (v.lodOn ? 18 : 24));
      const alive = (cur.flags & F.ALIVE) !== 0;
      const wid = WEAPON_WIRE[cur.weapon] as WeaponId | undefined; const weapon: WeaponId | null = wid && wid !== 'fists' ? wid : null;
      v.setWeapon(weapon);
      v.root.position.set(x, y, z);
      let anim: string = ANIMS[cur.anim] ?? 'idle'; let clip: string | undefined;
      if (!alive) anim = 'dead';
      else if (cur.veh) anim = 'drive';
      else if (p.emote && nowP < p.emote.until && (anim === 'idle' || anim === 'walk' && p.speed < 0.3)) { anim = 'emote'; clip = p.emote.clip; }
      else if (p.emote && nowP >= p.emote.until) p.emote = null;
      if (p.emote && (anim !== 'emote' && anim !== 'drive' && p.speed > 1)) p.emote = null;
      const fireFlag = (cur.flags & F.FIRE) !== 0; let firing = false;
      if (fireFlag && alive) { if (!p.fireHeld || nowP - p.fireAt > (weapon === 'smg' ? 90 : weapon === 'ar' ? 110 : 320)) { firing = true; p.fireAt = nowP; if (weapon && dist < 120) audio.gunshot(weapon as any, { x, y: y + 1.4, z }, false, false); } }
      p.fireHeld = fireFlag;
      const st: CharState = {
        anim, speed: cur.veh ? 0 : Math.max(p.speed, cur.speed * 0.6), moveYaw: p.moveYaw, aimYaw: yaw, pitch, aiming: (cur.flags & F.AIM) !== 0 || firing, armed: !!weapon && weapon !== 'machete', weapon,
        firing, reloading: false, melee: !weapon || weapon === 'machete', dead: !alive, driving: !!cur.veh, shadow: 0, awaken: 0, hit: 0, cast: false, healing: false, clip,
      };
      if (anim === 'jog' || anim === 'walk' || anim === 'sprint') st.speed = Math.max(st.speed, anim === 'sprint' ? 6 : anim === 'jog' ? 4 : 1.8);
      if (cur.veh && inCar) {
        const cm = this.cars.get(cur.veh)?.m;
        if (cm) { const t = seatTarget(cm, cur.seat, { x: inCar.x, y: inCar.y, z: inCar.z }, inCar.q, p.seat); if (t) { p.seat = t; st.seat = t; st.aimYaw = t.yaw; } }
        else { v.root.visible = false; }
      } else p.seat = undefined;
      p.acc += dt; const every = cur.veh ? 1 : dist < 28 ? 1 : dist < 55 ? 2 : dist < 95 ? 4 : 8;
      if (++p.skip >= every || firing || p.acc > 0.25) { v.update(p.acc, st, this.view.time); p.acc = 0; p.skip = 0; }
      // name plate
      if (dist < PLATE_RANGE && alive) {
        this.tmpV.set(x, y + (cur.flags & F.CROUCH ? 1.55 : 2.15), z).project(cam);
        if (this.tmpV.z < 1 && Math.abs(this.tmpV.x) < 1.1 && Math.abs(this.tmpV.y) < 1.1) {
          const sx = (this.tmpV.x * 0.5 + 0.5) * window.innerWidth, sy = (-this.tmpV.y * 0.5 + 0.5) * window.innerHeight;
          p.plate.style.display = 'block'; p.plate.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-100%) scale(${Math.max(0.7, 1 - dist / 140).toFixed(2)})`;
          p.plate.classList.toggle('talk', nowP < p.talkUntil);
        } else p.plate.style.display = 'none';
      } else p.plate.style.display = 'none';
    }
    this.shown = shown;
  }

  // ------------------------------------------------------------------------------------------ cars you can bump into
  private collide(c: RC, x: number, y: number, z: number, q: THREE.Quaternion, dist: number) {
    if (dist > COLLIDE_RANGE) { this.killBody(c); return; }
    const w = this.sim.phys.world;
    if (!c.body) {
      try {
        const [sx, sy, sz] = VEHICLES[c.kind].size; const hy = sy / 2 - 0.25;
        const body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
        const col = w.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, hy, sz / 2).setTranslation(0, hy * 0.2, 0).setCollisionGroups(groups(G.VEHICLE, G.WORLD | G.VEHICLE | G.SHIELD)).setFriction(0.4), body);
        this.sim.phys.tag(col, { kind: 'world', id: -1, mat: 'metal' }); c.body = { body, col };
      } catch { return; }
    }
    c.body.body.setNextKinematicTranslation({ x, y, z }); c.body.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }
  private killBody(c: RC) {
    if (!c.body) return;
    try { this.sim.phys.tags.delete(c.body.col.handle); this.sim.phys.world.removeRigidBody(c.body.body); } catch { /* world gone */ }
    c.body = null;
  }
}
