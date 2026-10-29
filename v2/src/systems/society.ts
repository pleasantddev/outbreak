// The living city: glue for the Society (population, economy), the world bridge, city events and the UI.
// nemesis.ts is its own system registered right after this one.
import type { GameCtx, GameSystem } from './registry';
import { loadContent } from './societyData';
import { Society } from './societyCore';
import { WorldBridge } from './societyWorld';
import { CityEvents } from './societyEvents';
import { SocietyUi } from './societyUi';
import { RT } from './societyRuntime';

const BUDGET_MS = 1.0;
let ui: SocietyUi | null = null; let saveT = 0; let started = false; let toastCd = 0;
const perf = { frames: 0, total: 0, max: 0, ema: 0, last: 0, over1: 0, startedAt: 0 };

/** what other systems may use: prices, rents, land, news, enemies */
export interface SocietyApi {
  price(id: string): number; prices(): { id: string; label: string; price: number; change: number }[];
  rentMult(x: number, z: number): number; landMult(x: number, z: number): number;
  news(): { t: number; text: string; kind: string }[]; enemies(): { name: string; rank: string; hate: number }[]; allies(): { name: string; rank: string; love: number }[];
  stats(): any; perf: typeof perf; soc: Society | undefined;
}

export const societySystem: GameSystem & { api: SocietyApi } = {
  id: 'society',
  api: {
    price: (id) => RT.soc?.E.p(id) ?? 0,
    prices: () => RT.soc?.E.rows() ?? [],
    rentMult: (x, z) => RT.soc?.E.rentMult(x, z) ?? 1,
    landMult: (x, z) => RT.soc?.E.landMult(x, z) ?? 1,
    news: () => (RT.soc?.E.news ?? []).map((n) => ({ t: n.t, text: n.text, kind: n.kind })),
    enemies: () => (RT.nem?.list() ?? []).filter((x) => x.kind === 'enemy').map((x) => ({ name: x.r.c.first + ' ' + x.r.c.last, rank: RT.soc!.rankName(x.r.c), hate: x.r.hate })),
    allies: () => (RT.nem?.list() ?? []).filter((x) => x.kind === 'ally').map((x) => ({ name: x.r.c.first + ' ' + x.r.c.last, rank: RT.soc!.rankName(x.r.c), love: x.r.love })),
    stats: () => RT.soc ? { ...RT.soc.stats, named: RT.bridge?.minds.size ?? 0, enemies: RT.nem?.list().filter((x) => x.kind === 'enemy').length ?? 0, allies: RT.nem?.list().filter((x) => x.kind === 'ally').length ?? 0, minute: Math.round(RT.soc.minute), events: RT.events?.active.map((e) => e.id) ?? [] } : null,
    perf, get soc() { return RT.soc; },
  },

  async init(ctx: GameCtx) {
    RT.ctx = ctx;
    const C = await loadContent(); if (!C) return;
    let seed = ctx.save.society?.seed; if (typeof seed !== 'number') seed = (Math.random() * 0x7fffffff) | 0;
    const soc = new Society(C, seed); RT.soc = soc; soc.load(ctx.save.society);
    RT.placeName = (x, z) => soc.W.areaName(x, z) || 'Lagos';
    const bridge = new WorldBridge(soc, ctx.sim); RT.bridge = bridge;
    RT.events = new CityEvents(ctx, soc, bridge);
    soc.onNews = (text, kind, _x, _z, hot) => {
      // the important ones also pop up on the phone, but not more than one every 20 real seconds
      if (!hot || toastCd > 0 || !started) return; toastCd = 20;
      ctx.hud.toast(kind === 'crime' ? 'Street news' : kind === 'market' ? 'Market' : 'Lagos', text, kind === 'crime' ? 'linear-gradient(160deg,#ff6b7a,#c2273a)' : 'linear-gradient(160deg,#49e08a,#16895a)', 'msg', 5);
    };
    ui = new SocietyUi(ctx); ui.init();
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyF' || e.repeat || !started || ctx.hud.phoneUp) return;
      const t = (e.target as HTMLElement | null)?.tagName; if (t === 'INPUT' || t === 'TEXTAREA') return;
      RT.nem?.interact();
    });
    window.addEventListener('beforeunload', () => { if (started) flush(ctx); });
    (window as any).__soc = societySystem.api;
  },

  start(ctx: GameCtx) {
    started = true; perf.startedAt = performance.now();
    const h = (window as any).__hl; if (h) h.society = societySystem.api;
    ctx.save.society = RT.soc!.save(); // fixes the seed right away so a reload gives the same city
  },

  frame(ctx: GameCtx, dt: number) {
    const soc = RT.soc; if (!soc || !started) return;
    const t0 = performance.now();
    const at = ctx.view.atmo; const now = at.day * 1440 + at.hour * 60;
    const P = ctx.sim.local.pos;
    soc.update(now, P.x, P.z, ctx.view.world.store.regions.values(), BUDGET_MS);
    RT.bridge!.frame(dt, P); RT.events!.frame(dt);
    toastCd -= dt; ui?.frame(dt);
    saveT += dt; if (saveT > 25) { saveT = 0; flush(ctx); }
    const ms = performance.now() - t0; perf.frames++; perf.total += ms; perf.last = ms; if (ms > perf.max) perf.max = ms; perf.ema += (ms - perf.ema) * 0.02; if (ms > 1.5) perf.over1++;
  },

};

function flush(ctx: GameCtx) {
  if (!RT.soc) return; ctx.save.society = RT.soc.save(); if (RT.nem) ctx.save.nemesis = RT.nem.save(); ctx.persist();
}
