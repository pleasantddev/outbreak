// Multiplayer. Turned on with ?server=ws://host:port (remembered); without it this system does nothing and the game is the
// offline single player build.
//   init   sign in (before the lobby), pull wallet, land and saved progress from the account
//   start  open the socket when the player presses PLAY, resume the last position
//   step   report own position at 15 Hz, ship cash changes, push changed save keys to the account
//   frame  draw the other players and their cars, shared time of day, badge and chat
import type { GameCtx, GameSystem } from './registry';
import { ApiError, net } from '../net/client';
import { NetUi, accountPanel, notice, signInCard } from '../net/ui';
import { EMOTE_CLIP, RemoteWorld } from '../net/remote';
import { EMOTES, F, VF, VKINDS, ANIMS, WEAPON_WIRE, type StateMsg, type VehState } from '../net/protocol';
import { WEATHER_ORDER } from '../render/sky';
import { TILE } from '../world/streamer';

/** save keys the host game keeps in the account's wallet and land tables, never as blobs */
const OWNED_BY_SERVER = new Set(['cash', 'bank', 'owned', 'ownedPts', 'model']);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let ui: NetUi | null = null; let remote: RemoteWorld | null = null; let started = false;
let seq = 0, sendAcc = 0, lastSentAt = 0, lastSent: StateMsg | null = null, lastPos: { x: number; z: number } | null = null;
let fireUntil = 0, blobAt = 0, badgeAt = 0, timeAt = 0, healthAt = 0;
const pushed = new Map<string, string>();

async function ensureSession() {
  try { if (await net.resume()) return; }
  catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      notice('Account banned', e.message, [{ label: 'Sign out', fn: async () => { await net.logout(); location.reload(); } }, { label: 'Play offline', fn: () => goOffline() }]);
      await new Promise(() => {}); // stay here
    }
  }
  await signInCard(net);
}
function goOffline() { const u = new URL(location.href); u.searchParams.set('server', 'off'); location.href = u.toString(); }

async function pullAccount(ctx: GameCtx) {
  net.getCash = () => ctx.sim.cash; net.onCash = (c) => { ctx.sim.cash = c; }; (window as any).__net = net;
  const [w, plots, st] = await Promise.all([
    net.api<{ cash: number; bank: number }>('GET', '/api/me/wallet'),
    net.api<{ items: { id: string; pts: number[] | null }[] }>('GET', '/api/me/plots').catch(() => ({ items: [] })),
    net.api<Record<string, unknown>>('GET', '/api/me/state').catch(() => ({} as Record<string, unknown>)),
  ]);
  if (net.local) {
    net.local.owned = plots.items.map((p) => p.id); net.local.ownedPts = {};
    for (const p of plots.items) if (p.pts) net.local.ownedPts[p.id] = p.pts;
    for (const p of plots.items) net.plotOwners.set(p.id, { owner: net.account?.id ?? '', name: net.name || null });
  }
  net.setWallet(w.cash, w.bank);
  // other systems keep their progress in ctx.save; the account is where it now lives
  for (const [k, v] of Object.entries(st)) { if (OWNED_BY_SERVER.has(k) || k === 'pos') continue; ctx.save[k] = v; pushed.set(k, JSON.stringify(v)); }
}

function flush(ctx: GameCtx, force = false) {
  if (!net.active) return;
  for (const [k, v] of Object.entries(ctx.save)) {
    if (OWNED_BY_SERVER.has(k) || k === 'pos' || v === undefined) continue;
    let j: string; try { j = JSON.stringify(v); } catch { continue; }
    if (j.length > 600_000) continue;
    if (pushed.get(k) === j && !force) continue;
    pushed.set(k, j); void net.putState(k, v);
  }
}

// ------------------------------------------------------------------------------------------ reporting our own state
function nightOf(h: number) { return h < 5.2 || h > 19.6 ? 1 : h < 6.7 ? (6.7 - h) / 1.5 : h > 18.4 ? (h - 18.4) / 1.2 : 0; }

function snapshotOf(ctx: GameCtx): StateMsg {
  const { sim } = ctx; const me = sim.local; const veh = me.vehicle !== null ? sim.vehicles[me.vehicle] : null;
  const now = performance.now();
  const p = veh ? veh.body.translation() : me.pos;
  let flags = 0;
  if (me.alive && !(me.ko && me.ko > 0)) flags |= F.ALIVE;
  if (me.sprinting) flags |= F.SPRINT; if (me.crouch) flags |= F.CROUCH; if (me.aiming) flags |= F.AIM; if (me.grounded) flags |= F.GROUND; if (me.swimming) flags |= F.SWIM;
  if (now < fireUntil) flags |= F.FIRE; if (ctx.view.phoneUp) flags |= F.PHONE; if (veh && veh.horn) flags |= F.HORN;
  const w = sim.currentWeapon(me); const wi = w ? Math.max(0, (WEAPON_WIRE as readonly string[]).indexOf(w.id)) : 0;
  const ai = Math.max(0, (ANIMS as readonly string[]).indexOf(me.anim));
  let vs: VehState | null = null;
  if (veh) {
    const r = veh.body.rotation(); const night = nightOf(ctx.view.atmo.hour); const driven = veh.seats[0] !== null && !veh.destroyed;
    let vf = 0; if (driven && night > 0.3) vf |= VF.LIGHTS; if (veh.horn) vf |= VF.HORN; if (veh.kind === 'police' && sim.wanted > 0) vf |= VF.SIREN; if (veh.destroyed) vf |= VF.WRECK; if (driven && veh.throttle < 0) vf |= VF.BRAKE; if (driven) vf |= VF.DRIVEN;
    const doors = ((veh as any).doors as number[]) ?? [0, 0, 0, 0];
    vs = { kind: Math.max(0, VKINDS.indexOf(veh.kind as any)), seat: me.seat, seed: ((veh as any).seed ?? 0) >>> 0, x: p.x, y: p.y, z: p.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w, steer: veh.wheelSteer, spin: veh.wheelSpin[0] ?? 0, doors: [doors[0] ?? 0, doors[1] ?? 0, doors[2] ?? 0, doors[3] ?? 0], vflags: vf, vspeed: veh.ctrl.currentVehicleSpeed() };
  }
  return { seq: ++seq & 0xffff, flags, x: veh ? p.x : me.pos.x, y: veh ? p.y : me.pos.y, z: veh ? p.z : me.pos.z, yaw: me.yaw, pitch: me.pitch, speed: Math.hypot(me.speed ?? 0, 0), anim: ai, weapon: wi, veh: vs };
}
function changed(a: StateMsg, b: StateMsg) {
  return a.flags !== b.flags || a.anim !== b.anim || a.weapon !== b.weapon || Math.abs(a.x - b.x) > 0.03 || Math.abs(a.y - b.y) > 0.03 || Math.abs(a.z - b.z) > 0.03 || Math.abs(a.yaw - b.yaw) > 0.01 || Math.abs(a.pitch - b.pitch) > 0.02
    || !!a.veh !== !!b.veh || (!!a.veh && !!b.veh && (a.veh.seat !== b.veh.seat || a.veh.vflags !== b.veh.vflags || Math.abs(a.veh.steer - b.veh.steer) > 0.01 || Math.abs(a.veh.spin - b.veh.spin) > 0.05 || a.veh.doors.some((d, i) => Math.abs(d - b.veh!.doors[i]) > 0.06)));
}
function report(ctx: GameCtx) {
  if (!net.active) return;
  const m = snapshotOf(ctx); const now = performance.now();
  // a jump the player did not walk (respawn, fast travel): tell the server first so it does not call it a hack
  if (lastPos && Math.hypot(m.x - lastPos.x, m.z - lastPos.z) > 45) net.teleported();
  lastPos = { x: m.x, z: m.z };
  if (lastSent && !changed(m, lastSent) && now - lastSentAt < 500) return;
  net.sendState(m); lastSent = m; lastSentAt = now;
}

function applyFix(ctx: GameCtx, f: { x: number; y: number; z: number; why: string }) {
  const { sim } = ctx; const me = sim.local; const veh = me.vehicle !== null ? sim.vehicles[me.vehicle] : null;
  if (veh) { veh.body.setTranslation({ x: f.x, y: f.y + 0.6, z: f.z }, true); veh.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
  else { me.pos.x = f.x; me.pos.y = f.y; me.pos.z = f.z; me.body.setTranslation({ x: f.x, y: f.y + 0.95, z: f.z }, true); }
  lastPos = { x: f.x, z: f.z }; lastSent = null;
  ctx.hud.toast('Moved back', 'The server put you back where it last saw you.', 'var(--red)', 'cash' as any, 2.5);
}

async function resumeAt(ctx: GameCtx, p: { x: number; y: number; z: number }) {
  const { sim, view, hud } = ctx; const me = sim.local;
  if (!Number.isFinite(p.x + p.y + p.z) || Math.hypot(p.x - me.pos.x, p.z - me.pos.z) < 40) return;
  hud.title('BACK IN LAGOS', 'Finding your spot', 3);
  try { await view.world.store.around(p.x, p.z, 900); } catch { return; }
  const has = () => { for (const t of view.world.tiles.values()) if (p.x >= t.x0 && p.x < t.x0 + TILE && p.z >= t.z0 && p.z < t.z0 + TILE) return true; return false; };
  for (let i = 0; i < 150 && !has(); i++) { view.world.update(p.x, p.z, true); await sleep(16); }
  me.pos.x = p.x; me.pos.y = p.y; me.pos.z = p.z; me.body.setTranslation({ x: p.x, y: p.y + 0.95, z: p.z }, true);
  lastPos = { x: p.x, z: p.z }; lastSent = null; net.teleported();
}

// ------------------------------------------------------------------------------------------ chat
function sys(text: string) { ui?.add('system', '', text); }
function handleChat(ctx: GameCtx, raw: string) {
  const t = raw.trim(); if (!t) return;
  if (!net.active) { sys('Not connected right now.'); return; }
  if (t[0] === '/') {
    const [cmd, ...rest] = t.slice(1).split(/\s+/); const c = cmd.toLowerCase(); const tail = t.slice(1 + cmd.length).trim();
    if (c === 'g' || c === 'global' || c === 'all') { if (tail) net.send({ t: 'chat', ch: 'global', text: tail }); return; }
    if (c === 'w' || c === 'whisper' || c === 'pm' || c === 'msg') {
      // names can contain spaces: /w "Chief Obinna" hello, or /w Tunde hello
      const m = /^"([^"]+)"\s+(.+)$/.exec(tail) ?? /^(\S+)\s+(.+)$/.exec(tail);
      if (!m) { sys('Use /w name message'); return; } net.send({ t: 'whisper', to: m[1], text: m[2] }); return;
    }
    if (c === 'pay' || c === 'give') {
      const m = /^"([^"]+)"\s+([\d,._]+)$/.exec(tail) ?? /^(\S+)\s+([\d,._]+)$/.exec(tail);
      if (!m) { sys('Use /pay name amount'); return; }
      const amount = Math.floor(Number(m[2].replace(/[,_]/g, '')));
      void net.transfer(m[1], amount).then((a) => { if (a.ok) { sys(`Sent ₦${amount.toLocaleString()} to ${m[1]}.`); ctx.hud.money(-amount); } else sys(a.err ?? 'Could not send that.'); });
      return;
    }
    if (c === 'e' || c === 'emote' || (EMOTES as readonly string[]).includes(c)) {
      const name = (EMOTES as readonly string[]).includes(c) ? c : rest[0]?.toLowerCase();
      if (!name || !(EMOTES as readonly string[]).includes(name)) { sys(`Emotes: ${EMOTES.map((e) => '/' + e).join(' ')}`); return; }
      doEmote(ctx, name as (typeof EMOTES)[number]); return;
    }
    if (c === 'help' || c === '?') { sys('/g global · /w name msg · /pay name amount · /wave /dance /phone /no /talk /arms'); return; }
    sys('Unknown command. Try /help'); return;
  }
  net.send({ t: 'chat', ch: 'near', text: t });
}
function doEmote(ctx: GameCtx, name: (typeof EMOTES)[number]) {
  net.send({ t: 'emote', id: name });
  const def = EMOTE_CLIP[name]; (ctx.sim.local as any).emote = { clip: def.clip, until: performance.now() + def.secs * 1000 };
}

// ------------------------------------------------------------------------------------------ the system
export const netSystem: GameSystem = {
  id: 'net',

  async init(ctx) {
    if (!net.serverMode) return;
    ui = new NetUi();
    await ensureSession();
    try { await pullAccount(ctx); }
    catch (e) {
      notice('Cannot load your account', e instanceof Error ? e.message : 'The server did not answer.', [{ label: 'Try again', fn: () => location.reload() }, { label: 'Sign out', fn: async () => { await net.logout(); location.reload(); } }]);
      await new Promise(() => {});
    }
    ui.onSend = (raw) => handleChat(ctx, raw);
    ui.onAccount = () => { void accountPanel(net); };
    ui.setBadge('warn', 'Signed in', net.account?.guest ? 'guest' : '');
  },

  start(ctx) {
    if (!net.serverMode || !ui) return;
    started = true; ui.show(true);
    remote = new RemoteWorld(ctx.view, ctx.sim, ctx.view.assets, () => net.serverNow, () => net.myId);
    (window as any).__net = { net, get remote() { return remote; } };

    net.on('snapshot', (r: any) => remote?.onSnapshot(r));
    net.on('who', (l: any) => remote?.setWho(l));
    net.on('chat', (m: any) => { ui!.add(m.ch, m.ch === 'system' ? '' : m.from, m.text); if (m.fromId) remote?.said(m.fromId); });
    net.on('emote', (m: any) => remote?.emote(m.id, m.e));
    net.on('fix', (m: any) => applyFix(ctx, m));
    net.on('toast', (m: any) => ctx.hud.toast(m.title, m.body, 'linear-gradient(160deg,#59d98e,#14a05a)', 'cash' as any, 5));
    net.on('wallet', (m: any) => { if (m.why && /^(admin|iap|grant|refund)/.test(m.why)) ctx.hud.toast('Wallet updated', `Cash ₦${m.cash.toLocaleString()} · Bank ₦${m.bank.toLocaleString()}`, 'linear-gradient(160deg,#59d98e,#14a05a)', 'cash' as any, 4); });
    net.on('plot', (m: any) => { ctx.view.landmap.builtAt = { x: 1e9, z: 1e9 }; if (m.owner && m.owner !== net.account?.id && m.ownerName && ctx.hud.landmapOn) ui!.add('system', '', `${m.ownerName} bought a plot.`); });
    net.on('kick', (reason: string) => { notice('Disconnected', reason, [{ label: 'Sign in again', fn: async () => { await net.logout(); location.reload(); } }, { label: 'Play offline', fn: () => goOffline() }]); });
    net.on('closed', (code: number) => { remote?.clear(); lastSent = null; if (net.state === 'reconnecting') ui!.setBadge('warn', 'Reconnecting', ''); else if (!document.querySelector('.nt-veil')) ui!.setBadge('bad', 'Offline', ''); void code; });
    net.on('welcome', (w: any) => {
      remote?.clear(); lastSent = null; ui!.setBadge('ok', 'Online', `${w.online} playing`);
      if (w.motd) sys(w.motd);
    });

    void (async () => {
      for (let tries = 0; tries < 4; tries++) {
        try {
          const w = await net.connect();
          ui!.add('system', '', 'You are in shared Lagos. Enter to chat. /help for commands.');
          if (w.state?.pos) await resumeAt(ctx, w.state.pos as any);
          return;
        } catch (e) {
          if (net.state === 'closed') return; // a kick already put up its own message
          await sleep(1200 * (tries + 1));
        }
      }
      notice('Cannot reach the server', 'The game could not connect to the online world.', [{ label: 'Try again', fn: () => location.reload() }, { label: 'Play offline', fn: () => goOffline() }]);
    })();
  },

  step(ctx, dt) {
    if (!started || !net.serverMode) return;
    net.watchCash();
    sendAcc += dt; if (sendAcc >= 1 / 15) { sendAcc = 0; report(ctx); }
  },

  frame(ctx, dt) {
    if (!started || !net.serverMode) return;
    const now = performance.now();
    if (remote) remote.night = nightOf(ctx.view.atmo.hour);
    remote?.update(dt);
    net.tickMeter();
    if (now - badgeAt > 1000 && ui) {
      badgeAt = now;
      if (net.active) ui.setBadge(net.rtt > 250 ? 'warn' : 'ok', 'Online', `${net.online} · ${Math.round(net.rtt)} ms`);
    }
    if (now - healthAt > 30000 && net.active) { healthAt = now; net.health().then((h: any) => { net.online = h.online; }).catch(() => {}); }
    // one clock for everybody: time of day and weather come from the server's calendar
    if (now - timeAt > 2000 && net.active) {
      timeAt = now; const e = net.epochNow / 1000; const A = ctx.view.atmo;
      const hour = (7.2 + (e * 30) / 3600) % 24;
      let d = hour - A.hour; if (d > 12) d -= 24; if (d < -12) d += 24;
      if (Math.abs(d) > 0.03) A.hour = hour;
      const slot = Math.floor(net.epochNow / (18 * 60_000)); const w = WEATHER_ORDER[(Math.imul(slot, 2654435761) >>> 0) % WEATHER_ORDER.length];
      if (A.target !== w) A.setWeather(w);
    }
    if (now - blobAt > 8000) { blobAt = now; flush(ctx); }
  },

  onEvent(ctx, e) {
    if (!started || !net.serverMode) return;
    if ((e.t === 'shot' || e.t === 'melee') && (e as any).actor === ctx.sim.local.id) fireUntil = performance.now() + 220;
  },
};
