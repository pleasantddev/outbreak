// One race: grid, countdown, laps, pickups, items, traffic, slipstream, shunts, finish order. The same class runs
// offline races on the client, the authoritative copy on the room server, and the headless tests. Cars are driven
// locally (this machine's player), by AI, or remotely (state arrives over the network and is only observed here).
import { Track, type TrackData } from './track';
import { carById, type CarDef, type Livery } from './cars';
import { newCar, stepCar, collideCars, idleInput, type CarInput, type CarState, type CarEvent } from './car';
import { Traffic, TRAFFIC_KINDS, type TrafficPose } from './traffic';
import { AiDriver, makePersonas, type AiLevel, type AiPersona } from './ai';
import { rollItem, ITEMS, HAZARD_R, type ItemId, type Hazard, type HazardKind } from './items';
import { clamp } from './math';

export type RaceMode = 'rush' | 'street' | 'stunt' | 'trial';
export type Weather = 'clear' | 'harmattan' | 'rain';
export type TimeOfDay = 'morning' | 'noon' | 'dusk' | 'night';

export interface RaceConfig {
  track: string; laps: number; mode: RaceMode; traffic: number; aiLevel: AiLevel; catchUp: boolean;
  seed: number; weather: Weather; time: TimeOfDay; stuntTime: number; finishGrace: number;
  /** online: how long humans get after an AI takes the flag first (unset offline, where the race waits for you) */
  aiFinishGrace?: number;
  /** hard stop in race seconds, so a room can never be held hostage by a car that never finishes */
  maxTime?: number;
}
export const defaultRaceConfig = (track: string, laps: number): RaceConfig => ({
  track, laps, mode: 'rush', traffic: 1, aiLevel: 'normal', catchUp: true, seed: 1, weather: 'clear', time: 'dusk', stuntTime: 120, finishGrace: 30,
});

export interface Entrant { id: string; name: string; carId: string; livery: Livery; human: boolean; crew?: string; level?: number }

export type RaceEvent =
  | (CarEvent & { car: number })
  | { t: 'countdown'; n: number }
  | { t: 'go' }
  | { t: 'launch'; car: number; quality: 'perfect' | 'good' | 'bogged' }
  | { t: 'lap'; car: number; lap: number; time: number; final: boolean }
  | { t: 'finish'; car: number; place: number; time: number }
  | { t: 'place'; car: number; from: number; to: number }
  | { t: 'pickup'; car: number; bag: number }
  | { t: 'item'; car: number; item: ItemId }
  | { t: 'useItem'; car: number; item: ItemId }
  | { t: 'hazard'; id: number; kind: HazardKind; owner: number; x: number; y: number; z: number; s: number; d: number; target: number }
  | { t: 'hazardGone'; id: number; burst: boolean; x: number; y: number; z: number }
  | { t: 'hit'; car: number; by: number; kind: HazardKind | 'horn' | 'danfo' }
  | { t: 'dodge'; car: number }
  | { t: 'horn'; car: number; x: number; y: number; z: number }
  | { t: 'blackout'; car: number; victims: number[] }
  | { t: 'nearMiss'; car: number; oncoming: boolean; kind: string }
  | { t: 'trafficHit'; car: number; impact: number; kind: string; x: number; y: number; z: number; smashed: boolean }
  | { t: 'bump'; car: number; other: number; impact: number; x: number; y: number; z: number }
  | { t: 'shunt'; car: number; victim: number }
  | { t: 'slip'; car: number }
  | { t: 'brt'; car: number }
  | { t: 'style'; car: number; points: number; label: string }
  | { t: 'done' };

export interface RaceStats { drift: number; air: number; tricks: number; nearMiss: number; shunts: number; hits: number; itemsUsed: number; topSpeed: number; style: number; walls: number }
export interface RaceCar {
  idx: number; entrant: Entrant; def: CarDef; c: CarState;
  control: 'local' | 'ai' | 'remote';
  ai: AiDriver | null; autopilot: AiDriver | null; persona: AiPersona | null;
  input: CarInput; itemWas: boolean; launch: number; boggedT: number;
  stats: RaceStats;
  nearCool: Map<number, number>; trafficCool: number;
  lastHitBy: number; lastHitT: number; prevS: number; slipOn: boolean; brtOn: boolean;
  /** a local car handed to the autopilot; the scripted playtests use it to reach results and replays */
  autoDrive?: boolean;
}
interface Bag { row: number; s: number; d: number; x: number; y: number; z: number; respawn: number }

export interface RemoteSnap {
  x: number; y: number; z: number; h: number; vx: number; vy: number; vz: number;
  drifting: boolean; driftTier: number; boostT: number; nitro: boolean; grounded: boolean; spinT: number; danfoT: number; pitch: number; roll: number;
}

const DT_MAX = 1 / 20;

export class RaceSim {
  track: Track;
  cfg: RaceConfig;
  cars: RaceCar[] = [];
  traffic: Traffic;
  trafficPoses: TrafficPose[] = [];
  hazards: Hazard[] = [];
  bags: Bag[] = [];
  time: number;
  phase: 'countdown' | 'racing' | 'done' = 'countdown';
  events: RaceEvent[] = [];
  finishOrder: number[] = [];
  doneAt = Infinity;
  authority: boolean;
  private nextHazard = 1;
  private carEvents: CarEvent[] = [];
  private bumpOut: { impact: number }[] = [];
  private aiCtxCars: CarState[] = [];

  constructor(data: TrackData, cfg: RaceConfig, entrants: Entrant[], opts: { authority: boolean; local: string[]; countdown?: number }) {
    this.track = new Track(data);
    this.cfg = cfg;
    this.authority = opts.authority;
    this.time = -(opts.countdown ?? 3);
    const trafficDensity = cfg.mode === 'trial' || cfg.mode === 'stunt' ? 0 : cfg.traffic;
    this.traffic = new Traffic(this.track, trafficDensity, cfg.seed);
    const personas = makePersonas(entrants.length, cfg.seed);
    entrants.forEach((e, i) => {
      const slot = data.grid[i % data.grid.length];
      const def = carById(e.carId);
      const c = newCar(i, slot.x, slot.y, slot.z, slot.h, this.track);
      const control: RaceCar['control'] = opts.local.includes(e.id) ? 'local' : !e.human && this.authority ? 'ai' : e.human || !this.authority ? 'remote' : 'ai';
      const persona = e.human ? null : { ...personas[i], name: e.name || personas[i].name };
      if (!e.human && !e.name) e.name = persona!.name;
      if (!e.crew && persona) e.crew = persona.crew;
      const rc: RaceCar = {
        idx: i, entrant: e, def, c, control, persona,
        ai: control === 'ai' ? new AiDriver(this.track, def, persona!, cfg.aiLevel, cfg.seed * 31 + i) : null,
        autopilot: null,
        input: idleInput(), itemWas: false, launch: NaN, boggedT: 0,
        stats: { drift: 0, air: 0, tricks: 0, nearMiss: 0, shunts: 0, hits: 0, itemsUsed: 0, topSpeed: 0, style: 0, walls: 0 },
        nearCool: new Map(), trafficCool: 0, lastHitBy: -1, lastHitT: -99, prevS: c.q!.sMain, slipOn: false, brtOn: false,
      };
      this.cars.push(rc);
    });
    if (cfg.mode === 'rush') {
      data.pickups.forEach((row, ri) => row.d.forEach((d) => {
        const p = this.track.pointAt(row.s, d);
        this.bags.push({ row: ri, s: row.s, d, x: p.x, y: p.y + 1.1, z: p.z, respawn: -99 });
      }));
    }
    this.updatePlaces(true);
  }

  get L() { return this.track.length; }
  get racing() { return this.phase === 'racing'; }
  carById(id: string) { return this.cars.find((c) => c.entrant.id === id); }

  /** Advance by dt seconds. Inputs are keyed by entrant id and only read for local cars. */
  step(dt: number, inputs: Record<string, CarInput> = {}) {
    dt = Math.min(dt, DT_MAX);
    const prevT = this.time;
    this.time += dt;
    const t = this.time;
    if (this.phase === 'countdown') {
      for (const n of [3, 2, 1]) if (prevT < -n + 1e-9 && t >= -n) this.events.push({ t: 'countdown', n });
      if (t >= 0) { this.phase = 'racing'; this.events.push({ t: 'go' }); this.launches(); }
    }
    const racing = this.phase === 'racing';
    this.traffic.poses(Math.max(0, t), this.trafficPoses);
    this.aiCtxCars.length = 0;
    for (const rc of this.cars) this.aiCtxCars.push(rc.c);
    const humanDists = this.cars.filter((r) => r.entrant.human).map((r) => r.c.raceDist);

    for (const rc of this.cars) {
      if (rc.control === 'remote') continue;
      const c = rc.c;
      let inp: CarInput;
      if (rc.control === 'local') inp = { ...(inputs[rc.entrant.id] ?? idleInput()) };
      else inp = rc.input;
      // countdown: remember when the throttle went down for the launch
      if (!racing && this.phase === 'countdown') {
        if (rc.control === 'ai' && Number.isNaN(rc.launch)) rc.launch = -0.2 - ((rc.idx * 7919 + this.cfg.seed) % 100) / 100;
        else if (rc.control === 'local') { if (inp.throttle > 0.5) { if (Number.isNaN(rc.launch)) rc.launch = t; } else rc.launch = NaN; }
      }
      // AI and autopilot (Danfo Mode, or the cool-down lap after the flag)
      const pilot = rc.control === 'ai' ? rc.ai : c.danfoT > 0 || c.finished || rc.autoDrive ? this.autopilotFor(rc) : null;
      let wantItem = rc.control === 'local' ? inp.item : false;
      if (c.danfoT > 0) wantItem = false;
      if (pilot) {
        let gap = 0, best = Infinity;
        for (const h of humanDists) { const g = c.raceDist - h; if (Math.abs(g) < best) { best = Math.abs(g); gap = g; } }
        const r = pilot.drive(c, { time: t, dt, cars: this.aiCtxCars, self: rc.idx, place: c.place, count: this.cars.length, hazards: this.hazards, traffic: this.trafficPoses, humanGap: gap, catchUp: this.cfg.catchUp && rc.control === 'ai', racing }, c.itemRoll > 0 ? null : (c.item as ItemId | null), rc.control === 'ai' ? rc.input : inp);
        if (rc.control === 'ai') { inp = rc.input; wantItem = r.useItem; if (c.finished) inp.throttle *= 0.6; }
        else if (c.finished && c.danfoT <= 0) { inp.throttle *= 0.55; inp.item = false; }
      }
      if (rc.boggedT > 0) { rc.boggedT -= dt; inp.throttle = Math.min(inp.throttle, 0.25); }
      // items
      if (this.authority && racing && wantItem && !rc.itemWas && c.item && c.itemRoll <= 0 && !c.finished) this.useItem(rc);
      rc.itemWas = rc.control === 'local' ? inp.item : wantItem;
      if (c.itemRoll > 0) c.itemRoll = Math.max(0, c.itemRoll - dt);
      this.carEvents.length = 0;
      stepCar(c, inp, rc.def, this.track, dt, t, this.carEvents, racing);
      for (const ev of this.carEvents) this.onCarEvent(rc, ev);
      rc.stats.topSpeed = Math.max(rc.stats.topSpeed, c.vf);
      if (c.drifting) { rc.stats.drift += dt; if (this.cfg.mode === 'stunt') this.addStyle(rc, dt * 60 * (1 + c.driftTier), ''); }
      if (!c.grounded) rc.stats.air += dt;
    }

    this.boostStrips();
    this.carContacts();
    this.trafficContacts(t, dt);
    if (this.authority) { this.updateHazards(dt); this.updateBags(); }
    this.slipstream(dt);
    this.progress();
    this.updatePlaces(false);
    // followers never end a race on their own view of it; the room's results do
    if (this.authority) this.checkEnd();
  }

  private autopilotFor(rc: RaceCar) {
    if (!rc.autopilot) rc.autopilot = new AiDriver(this.track, rc.def, { name: rc.entrant.name, crew: '', pace: 1, aggression: 0.9, lane: 0, drifter: false }, 'hard', rc.idx + 991);
    return rc.autopilot;
  }

  private launches() {
    for (const rc of this.cars) {
      if (rc.control === 'remote') continue;
      const l = rc.launch;
      if (Number.isNaN(l)) continue;
      if (l >= -0.6) { rc.c.boostT = Math.max(rc.c.boostT, 1.0); this.events.push({ t: 'launch', car: rc.idx, quality: 'perfect' }); }
      else if (l >= -1.4) { rc.c.boostT = Math.max(rc.c.boostT, 0.35); this.events.push({ t: 'launch', car: rc.idx, quality: 'good' }); }
      else { rc.boggedT = 0.7; this.events.push({ t: 'launch', car: rc.idx, quality: 'bogged' }); }
    }
  }

  private onCarEvent(rc: RaceCar, ev: CarEvent) {
    this.events.push({ ...ev, car: rc.idx } as RaceEvent);
    const stunt = this.cfg.mode === 'stunt';
    if (ev.t === 'land') {
      if (ev.grade === 'clean') {
        rc.stats.tricks += ev.tricks;
        const pts = Math.round(ev.airT * 120 + ev.tricks * 500);
        if (pts > 60) this.addStyle(rc, stunt ? pts : pts * 0.25, ev.tricks ? `${ev.tricks > 1 ? `${ev.tricks}x ` : ''}TRICK` : 'AIR');
      } else if (ev.grade === 'crash' && stunt) this.addStyle(rc, -200, 'CRASH');
    }
    if (ev.t === 'driftBoost') this.addStyle(rc, stunt ? 150 * ev.tier : 25 * ev.tier, ev.tier >= 3 ? 'GBEDU MAX' : ev.tier === 2 ? 'GBEDU' : 'DRIFT');
    if (ev.t === 'wall') {
      rc.stats.walls++;
      // a big wall hit right after contact counts as a shunt for whoever pushed us
      if (ev.impact > 9 && this.time - rc.lastHitT < 0.9 && rc.lastHitBy >= 0) {
        const by = this.cars[rc.lastHitBy];
        if (by.control !== 'remote') { by.c.fuel = Math.min(1, by.c.fuel + 0.25); }
        by.stats.shunts++;
        this.events.push({ t: 'shunt', car: by.idx, victim: rc.idx });
        this.addStyle(by, this.cfg.mode === 'stunt' ? 400 : 120, 'SHUNT');
        rc.lastHitBy = -1;
      }
    }
  }

  private addStyle(rc: RaceCar, pts: number, label: string) {
    rc.stats.style += pts;
    if (label) this.events.push({ t: 'style', car: rc.idx, points: Math.round(pts), label });
  }

  // ------------------------------------------------------------------------------------------- items

  /** Fire the item this car holds. Only the authority calls this. */
  useItem(rc: RaceCar) {
    const c = rc.c, id = c.item as ItemId, q = c.q!;
    rc.stats.itemsUsed++;
    this.events.push({ t: 'useItem', car: rc.idx, item: id });
    switch (id) {
      case 'purewater': case 'pothole': {
        const s = q.sMain - 5.5;
        this.spawnHazard(id, rc.idx, s, clamp(q.d, -q.hw + 1, q.hw - 1), 0, -1, 25);
        break;
      }
      case 'horn': {
        this.events.push({ t: 'horn', car: rc.idx, x: c.x, y: c.y, z: c.z });
        for (const o of this.cars) {
          if (o === rc) continue;
          const dx = o.c.x - c.x, dz = o.c.z - c.z, d = Math.hypot(dx, dz);
          if (d > 10 || Math.abs(o.c.y - c.y) > 3) continue;
          this.applyHit(o, 'horn', rc.idx, dx / (d || 1), dz / (d || 1));
        }
        this.hazards = this.hazards.filter((h) => {
          const near = Math.hypot(h.x - c.x, h.z - c.z) < 11 && h.kind !== 'okada';
          if (near) this.events.push({ t: 'hazardGone', id: h.id, burst: true, x: h.x, y: h.y, z: h.z });
          return !near;
        });
        break;
      }
      case 'rocket': {
        const target = this.cars.find((o) => o.c.place === c.place - 1);
        this.spawnHazard('rocket', rc.idx, q.sMain + 3, q.d, Math.max(c.vf + 26, 62), target ? target.idx : -1, 6);
        break;
      }
      case 'genboost': c.boostT = Math.max(c.boostT, 1.05); break;
      case 'blackout': {
        const victims = this.cars.filter((o) => o.c.place < c.place && !o.c.finished).map((o) => o.idx);
        for (const v of victims) { const o = this.cars[v]; if (o.control !== 'remote') o.c.blackoutT = 3.6; }
        this.events.push({ t: 'blackout', car: rc.idx, victims });
        break;
      }
      case 'danfo': c.danfoT = 5.5; break;
      case 'okada': {
        const leader = this.cars.find((o) => o.c.place === 1 && o !== rc && !o.c.finished);
        if (leader && leader.c.q) this.spawnHazard('okada', rc.idx, leader.c.q.sMain + 55, 0, 0, leader.idx, 4);
        break;
      }
    }
    c.itemCharges -= 1;
    if (c.itemCharges <= 0) { c.item = null; c.itemCharges = 0; }
  }

  private spawnHazard(kind: HazardKind, owner: number, s: number, d: number, vs: number, target: number, life: number) {
    const L = this.L;
    s = ((s % L) + L) % L;
    const p = this.track.pointAt(s, d);
    const hz: Hazard = { id: this.nextHazard++, kind, owner, x: p.x, y: p.y, z: p.z, h: p.h, s, d, vs, target, life, armed: kind === 'rocket' ? 0.4 : 1.2 };
    this.hazards.push(hz);
    this.events.push({ t: 'hazard', id: hz.id, kind, owner, x: hz.x, y: hz.y, z: hz.z, s, d, target });
  }

  /** Apply an item hit. Local and AI cars react here; a remote car's own machine applies it from the event. */
  applyHit(rc: RaceCar, kind: HazardKind | 'horn' | 'danfo', by: number, nx = 0, nz = 0) {
    const c = rc.c;
    if (c.ghostT > 0 || c.respawnT > 0) return false;
    if (c.danfoT > 0 && kind !== 'okada') return false;
    rc.lastHitBy = by; rc.lastHitT = this.time;
    if (by >= 0 && by !== rc.idx) this.cars[by].stats.hits++;
    if (rc.control === 'remote') { this.events.push({ t: 'hit', car: rc.idx, by, kind }); return true; }
    this.events.push({ t: 'hit', car: rc.idx, by, kind });
    switch (kind) {
      case 'purewater': c.spinT = 0.75; c.spinDir = (c.id + Math.floor(this.time * 10)) % 2 ? 1 : -1; c.vx *= 0.75; c.vz *= 0.75; break;
      case 'pothole': c.vx *= 0.62; c.vz *= 0.62; if (c.grounded) { c.grounded = false; c.vy = 4.5; c.airT = 0; c.spinAcc = 0; c.flipAcc = 0; } break;
      case 'rocket': c.spinT = 1.0; c.spinDir = 1; c.vx *= 0.5; c.vz *= 0.5; if (c.grounded) { c.grounded = false; c.vy = 5; c.airT = 0; c.spinAcc = 0; c.flipAcc = 0; } break;
      case 'okada': c.spinT = 1.3; c.spinDir = -1; c.vx *= 0.45; c.vz *= 0.45; break;
      case 'horn': c.vx += nx * 9; c.vz += nz * 9; if (c.boostT <= 0) { c.spinT = Math.max(c.spinT, 0.25); } break;
      case 'danfo': c.spinT = 1.0; c.spinDir = 1; c.vx *= 0.4; c.vz *= 0.4; break;
    }
    c.drifting = false; c.driftTier = 0;
    return true;
  }

  private updateHazards(dt: number) {
    const keep: Hazard[] = [];
    for (const hz of this.hazards) {
      hz.life -= dt; hz.armed -= dt;
      let gone = hz.life <= 0, burst = false;
      if (hz.kind === 'rocket' && !gone) {
        const tgt = hz.target >= 0 ? this.cars[hz.target] : null;
        hz.s = (hz.s + hz.vs * dt) % this.L;
        if (tgt && tgt.c.q && !tgt.c.finished) {
          hz.d += clamp(tgt.c.q.d - hz.d, -9 * dt, 9 * dt);
          const g = this.track.gap(hz.s, tgt.c.q.sMain);
          if (g < 2.2 && g > -4 && Math.abs(tgt.c.q.d - hz.d) < 2.4) {
            if (tgt.c.drifting && tgt.c.driftTier >= 1) { this.events.push({ t: 'dodge', car: tgt.idx }); this.addStyle(tgt, 80, 'DODGED'); }
            else this.applyHit(tgt, 'rocket', hz.owner);
            gone = true; burst = true;
          }
        }
        const p = this.track.pointAt(hz.s, hz.d);
        hz.x = p.x; hz.y = p.y; hz.z = p.z; hz.h = p.h;
      } else if (!gone) {
        for (const rc of this.cars) {
          if (rc.idx === hz.owner && hz.armed > 0) continue;
          const c = rc.c;
          if (!c.q) continue;
          if (hz.kind === 'okada') {
            const g = this.track.gap(hz.s, c.q.sMain);
            if (Math.abs(g) < 2.6 && c.grounded && (rc.idx === hz.target || c.place <= 3)) { if (this.applyHit(rc, 'okada', hz.owner)) gone = true; }
            continue;
          }
          const dx = c.x - hz.x, dz = c.z - hz.z;
          if (dx * dx + dz * dz > (HAZARD_R[hz.kind] + 0.6) ** 2 || Math.abs(c.y - hz.y) > 1.6 || !c.grounded) continue;
          if (this.applyHit(rc, hz.kind, hz.owner)) { if (hz.kind === 'purewater') { gone = true; burst = true; } else { hz.armed = 99; hz.life = Math.min(hz.life, 6); } }
        }
      }
      if (gone) this.events.push({ t: 'hazardGone', id: hz.id, burst, x: hz.x, y: hz.y, z: hz.z });
      else keep.push(hz);
    }
    this.hazards = keep;
  }

  private updateBags() {
    for (let bi = 0; bi < this.bags.length; bi++) {
      const b = this.bags[bi];
      if (b.respawn > this.time) continue;
      for (const rc of this.cars) {
        const c = rc.c;
        if (!c.q || c.respawnT > 0 || c.finished) continue;
        if (Math.abs(this.track.gap(c.q.sMain, b.s)) > 2.6 || Math.abs(c.q.d - b.d) > 2.0 || Math.abs(c.y + 0.6 - b.y) > 2.6) continue;
        b.respawn = this.time + 3.5;
        this.events.push({ t: 'pickup', car: rc.idx, bag: bi });
        if (!c.item) {
          const item = rollItem(c.place, this.cars.length, this.cfg.seed, rc.idx, bi, Math.max(0, c.lap));
          this.grantItem(rc, item);
        }
        break;
      }
    }
  }

  grantItem(rc: RaceCar, item: ItemId) {
    rc.c.item = item; rc.c.itemCharges = ITEMS[item].charges; rc.c.itemRoll = 1.1;
    this.events.push({ t: 'item', car: rc.idx, item });
  }

  // ------------------------------------------------------------------------------------------- contacts

  private boostStrips() {
    for (const rc of this.cars) {
      if (rc.control === 'remote') continue;
      const c = rc.c, q = c.q;
      if (!q || q.path !== 0 || !c.grounded) { rc.brtOn = false; continue; }
      let on = false;
      for (const b of this.track.data.boosts) {
        const g = this.track.gap(b.s, q.sMain);
        if (g >= 0 && g <= b.len && Math.abs(q.d - b.d) < b.w / 2 + 0.4) { on = true; break; }
      }
      if (on) { c.boostT = Math.max(c.boostT, 0.35); c.fuel = Math.min(1, c.fuel + 0.0025); if (!rc.brtOn) this.events.push({ t: 'brt', car: rc.idx }); }
      rc.brtOn = on;
    }
  }

  private carContacts() {
    const n = this.cars.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const A = this.cars[i], B = this.cars[j];
      const ra = A.control === 'remote', rb = B.control === 'remote';
      if (ra && rb) continue;
      this.bumpOut.length = 0;
      const imp = collideCars(A.c, B.c, A.def.mass, B.def.mass, this.bumpOut, !ra, !rb);
      if (imp <= 0) continue;
      if (imp > 4) {
        this.events.push({ t: 'bump', car: i, other: j, impact: imp, x: (A.c.x + B.c.x) / 2, y: (A.c.y + B.c.y) / 2 + 0.6, z: (A.c.z + B.c.z) / 2 });
        // whoever was moving into the other gets the credit for a shunt that follows
        const av = A.c.vx * (B.c.x - A.c.x) + A.c.vz * (B.c.z - A.c.z), bv = B.c.vx * (A.c.x - B.c.x) + B.c.vz * (A.c.z - B.c.z);
        const [att, vic] = av > bv ? [A, B] : [B, A];
        vic.lastHitBy = att.idx; vic.lastHitT = this.time;
        if (att.control !== 'remote') att.c.fuel = Math.min(1, att.c.fuel + imp * 0.006);
      }
      if (A.c.danfoT > 0 && B.c.danfoT <= 0) this.applyHit(B, 'danfo', i);
      if (B.c.danfoT > 0 && A.c.danfoT <= 0) this.applyHit(A, 'danfo', j);
    }
  }

  private trafficContacts(t: number, dt: number) {
    if (!this.trafficPoses.length) return;
    for (const rc of this.cars) {
      if (rc.control === 'remote') continue;
      const c = rc.c, q = c.q;
      if (!q || c.respawnT > 0) continue;
      rc.trafficCool = Math.max(0, rc.trafficCool - dt);
      for (const tp of this.trafficPoses) {
        if (tp.vis < 0.35) continue;
        const g = this.track.gap(q.sMain, tp.s);
        if (g < -16 || g > 16) continue;
        if (Math.abs(c.y - tp.y) > 2.6) continue;
        const kd = TRAFFIC_KINDS[tp.kind];
        const fx = Math.sin(tp.h), fz = Math.cos(tp.h), rx = -Math.cos(tp.h), rz = Math.sin(tp.h);
        const hl = kd.len / 2, hw = kd.w / 2;
        let hit = false, minSide = Infinity, alongMin = Infinity;
        for (const off of [-1.05, 1.05]) {
          const px = c.x + Math.sin(c.h) * off - tp.x, pz = c.z + Math.cos(c.h) * off - tp.z;
          const u = px * fx + pz * fz, w = px * rx + pz * rz;
          const cu = clamp(u, -hl, hl), cw = clamp(w, -hw, hw);
          const du = u - cu, dw = w - cw, dist = Math.hypot(du, dw);
          minSide = Math.min(minSide, dist); alongMin = Math.min(alongMin, Math.abs(u));
          if (dist >= 1.0) continue;
          let nxl: number, nzl: number;
          if (dist > 1e-4) { nxl = (du * fx + dw * rx) / dist; nzl = (du * fz + dw * rz) / dist; }
          else { const sg = w >= 0 ? 1 : -1; nxl = rx * sg; nzl = rz * sg; }
          const pen = 1.0 - dist;
          c.x += nxl * pen; c.z += nzl * pen;
          const tvx = fx * tp.v, tvz = fz * tp.v;
          const vn = (c.vx - tvx) * nxl + (c.vz - tvz) * nzl;
          if (vn < 0) {
            hit = true;
            const impact = -vn;
            const smashed = c.danfoT > 0;
            if (!smashed) {
              c.vx -= 1.3 * vn * nxl; c.vz -= 1.3 * vn * nzl;
              const keep = kd.heavy ? 0.6 : 0.8;
              c.vx *= keep; c.vz *= keep;
              if (impact > 7 && c.boostT <= 0 && c.ghostT <= 0) { c.spinT = Math.max(c.spinT, 0.45 + Math.min(0.5, impact * 0.02)); c.spinDir = w >= 0 ? -1 : 1; c.drifting = false; c.driftTier = 0; }
            }
            if (rc.trafficCool <= 0 && (impact > 2.5 || smashed)) { this.events.push({ t: 'trafficHit', car: rc.idx, impact, kind: tp.kind, x: c.x, y: c.y + 0.6, z: c.z, smashed }); rc.trafficCool = 0.5; }
          }
        }
        // near miss: close alongside at a big speed difference, once per vehicle per pass
        if (!hit && minSide > 0.25 && minSide < 1.9 && alongMin < hl + 1.2) {
          const rel = Math.abs((c.vx - fx * tp.v) * fx + (c.vz - fz * tp.v) * fz);
          const cool = rc.nearCool.get(tp.id) ?? 0;
          if (rel > 13 && cool < t) {
            const oncoming = c.vx * fx + c.vz * fz < 0;
            rc.nearCool.set(tp.id, t + 2.5);
            c.fuel = Math.min(1, c.fuel + (oncoming ? 0.08 : 0.05));
            rc.stats.nearMiss++;
            this.events.push({ t: 'nearMiss', car: rc.idx, oncoming, kind: tp.kind });
            this.addStyle(rc, this.cfg.mode === 'stunt' ? (oncoming ? 300 : 200) : oncoming ? 40 : 25, oncoming ? 'ONCOMING' : 'NEAR MISS');
          }
        }
      }
    }
  }

  private slipstream(dt: number) {
    for (const rc of this.cars) {
      if (rc.control === 'remote') continue;
      const c = rc.c, q = c.q;
      if (!q) continue;
      let behindSomeone = false;
      if (c.vf > 24 && c.grounded) {
        for (const o of this.cars) {
          if (o === rc || !o.c.q) continue;
          const g = this.track.gap(q.sMain, o.c.q.sMain);
          if (g > 2.5 && g < 16 && Math.abs(o.c.q.d - q.d) < 1.7 && Math.abs(o.c.y - c.y) < 2) { behindSomeone = true; break; }
        }
      }
      c.slipT = behindSomeone ? c.slipT + dt : Math.max(0, c.slipT - dt * 2);
      if (c.slipT > 0.6) { c.fuel = Math.min(1, c.fuel + 0.035 * dt); if (!rc.slipOn) { rc.slipOn = true; this.events.push({ t: 'slip', car: rc.idx }); } }
      else rc.slipOn = false;
    }
  }

  // ------------------------------------------------------------------------------------------- race state

  private progress() {
    const L = this.L;
    for (const rc of this.cars) {
      const c = rc.c;
      if (!c.q) continue;
      const s = c.q.sMain;
      const delta = this.track.gap(rc.prevS, s);
      rc.prevS = s;
      if (Math.abs(delta) > 45) continue; // a teleport, never progress
      c.raceDist += delta;
      if (this.phase !== 'racing' || c.finished) continue;
      if (this.cfg.mode === 'stunt') continue;
      const lap = Math.floor(c.raceDist / L) + 1;
      if (lap > c.lap && c.raceDist >= 0) {
        if (c.lap >= 1) {
          c.lastLap = this.time - c.lapStart;
          if (!c.bestLap || c.lastLap < c.bestLap) c.bestLap = c.lastLap;
        }
        c.lapStart = this.time;
        c.lap = lap;
        if (lap > this.cfg.laps) {
          c.finished = true; c.finishTime = this.time;
          this.finishOrder.push(rc.idx);
          c.place = this.finishOrder.length;
          this.events.push({ t: 'finish', car: rc.idx, place: c.place, time: this.time });
        } else if (lap >= 2) this.events.push({ t: 'lap', car: rc.idx, lap, time: this.time, final: lap === this.cfg.laps });
      }
      // checkpoints inside the lap, for split times
      const into = c.raceDist - (c.lap - 1) * L;
      let cp = 0;
      for (const s0 of this.track.data.checkpoints) if (into >= s0) cp++;
      c.cp = cp;
    }
  }

  private updatePlaces(initial: boolean) {
    const order = [...this.cars].sort((a, b) => {
      if (this.cfg.mode === 'stunt') return b.stats.style - a.stats.style;
      const fa = a.c.finished, fb = b.c.finished;
      if (fa && fb) return a.c.finishTime - b.c.finishTime;
      if (fa !== fb) return fa ? -1 : 1;
      return b.c.raceDist - a.c.raceDist;
    });
    order.forEach((rc, i) => {
      const place = i + 1;
      if (!initial && rc.c.place !== place && rc.entrant.human && this.phase === 'racing') this.events.push({ t: 'place', car: rc.idx, from: rc.c.place, to: place });
      rc.c.place = place;
    });
  }

  private checkEnd() {
    if (this.phase !== 'racing') return;
    if (this.cfg.mode === 'stunt') {
      if (this.time >= this.cfg.stuntTime) this.end();
      return;
    }
    // the race waits for the people in it: grace starts when the first of them finishes, not when an AI does.
    // Online, an AI winner starts a longer clock too, and a hard cap stops a race that would never end.
    const humans = this.cars.filter((c) => c.entrant.human);
    const pool = humans.length ? humans : this.cars;
    if (pool.every((c) => c.c.finished)) this.doneAt = Math.min(this.doneAt, this.time + 2.5);
    let firstHuman = Infinity;
    for (const c of pool) if (c.c.finished) firstHuman = Math.min(firstHuman, c.c.finishTime);
    if (firstHuman < Infinity) this.doneAt = Math.min(this.doneAt, firstHuman + this.cfg.finishGrace);
    if (this.cfg.aiFinishGrace !== undefined && this.finishOrder.length) this.doneAt = Math.min(this.doneAt, this.cars[this.finishOrder[0]].c.finishTime + this.cfg.aiFinishGrace);
    if (this.time >= this.doneAt || (this.cfg.maxTime !== undefined && this.time >= this.cfg.maxTime)) this.end();
  }

  end() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.updatePlaces(true);
    this.events.push({ t: 'done' });
  }

  /** Final standings: finished cars by time, then everyone else by distance. */
  standings() {
    return [...this.cars].sort((a, b) => a.c.place - b.c.place).map((rc) => ({
      idx: rc.idx, id: rc.entrant.id, name: rc.entrant.name, human: rc.entrant.human, carId: rc.def.id, place: rc.c.place,
      finished: rc.c.finished, time: rc.c.finished ? rc.c.finishTime : null, bestLap: rc.c.bestLap || null,
      dist: rc.c.raceDist, style: Math.round(rc.stats.style), stats: { ...rc.stats },
    }));
  }

  // ------------------------------------------------------------------------------------------- network glue

  /** An AI takes the wheel of a car whose driver left or went quiet (the authority only). */
  takeOver(idx: number) {
    const rc = this.cars[idx];
    if (!rc || rc.control === 'ai' || rc.control === 'local') return;
    rc.control = 'ai';
    rc.ai = new AiDriver(this.track, rc.def, { name: rc.entrant.name, crew: rc.entrant.crew ?? '', pace: 0.97, aggression: 0.4, lane: 0, drifter: true }, this.cfg.aiLevel === 'easy' ? 'normal' : this.cfg.aiLevel, this.cfg.seed + idx * 13);
    rc.prevS = rc.c.q?.sMain ?? rc.prevS;
  }
  /** The driver is back: hand the car to their machine again. */
  release(idx: number) {
    const rc = this.cars[idx];
    if (!rc || rc.control !== 'ai' || !rc.entrant.human) return;
    rc.control = 'remote'; rc.ai = null;
  }

  /** Observe a remote car: state comes from its owner's machine (already validated or interpolated). */
  setRemote(idx: number, s: RemoteSnap) {
    const c = this.cars[idx].c;
    c.x = s.x; c.y = s.y; c.z = s.z; c.h = s.h; c.vx = s.vx; c.vy = s.vy; c.vz = s.vz;
    c.drifting = s.drifting; c.driftTier = s.driftTier; c.boostT = s.boostT; c.nitroOn = s.nitro; c.grounded = s.grounded;
    c.spinT = s.spinT; c.danfoT = s.danfoT; c.pitch = s.pitch; c.roll = s.roll;
    const q = this.track.query(c.x, c.y, c.z, c.hint);
    c.hint = { path: q.path, i: q.i }; c.q = q;
    c.vf = c.vx * Math.sin(c.h) + c.vz * Math.cos(c.h);
  }

  snapOf(idx: number): RemoteSnap {
    const c = this.cars[idx].c;
    return { x: c.x, y: c.y, z: c.z, h: c.h, vx: c.vx, vy: c.vy, vz: c.vz, drifting: c.drifting, driftTier: c.driftTier, boostT: c.boostT, nitro: c.nitroOn, grounded: c.grounded, spinT: c.spinT, danfoT: c.danfoT, pitch: c.pitch, roll: c.roll };
  }

  /** Followers (clients of a room) apply the authority's item and hazard decisions through this. */
  applyAuthorityEvent(ev: RaceEvent) {
    switch (ev.t) {
      case 'item': { const rc = this.cars[ev.car]; if (rc) { rc.c.item = ev.item; rc.c.itemCharges = ITEMS[ev.item].charges; rc.c.itemRoll = 1.1; } break; }
      // Danfo contact is judged by each driver's own machine from what it sees, so the room's echo is skipped
      case 'hit': { const rc = this.cars[ev.car]; if (rc && rc.control === 'local' && ev.kind !== 'danfo') this.applyHit(rc, ev.kind, ev.by); break; }
      case 'hazard': {
        if (this.hazards.some((h) => h.id === ev.id)) break;
        this.hazards.push({ id: ev.id, kind: ev.kind, owner: ev.owner, x: ev.x, y: ev.y, z: ev.z, h: 0, s: ev.s, d: ev.d, vs: 0, target: ev.target, life: 30, armed: 0 });
        break;
      }
      case 'hazardGone': this.hazards = this.hazards.filter((h) => h.id !== ev.id); break;
      case 'pickup': { const b = this.bags[ev.bag]; if (b) b.respawn = this.time + 3.5; break; }
      case 'useItem': { const rc = this.cars[ev.car]; if (rc && rc.control === 'local') { rc.c.itemCharges -= 1; if (rc.c.itemCharges <= 0) { rc.c.item = null; rc.c.itemCharges = 0; } if (ev.item === 'genboost') rc.c.boostT = Math.max(rc.c.boostT, 1.05); if (ev.item === 'danfo') rc.c.danfoT = 5.5; } break; }
      case 'blackout': for (const v of ev.victims) { const rc = this.cars[v]; if (rc && rc.control === 'local') rc.c.blackoutT = 3.6; } break;
    }
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}
