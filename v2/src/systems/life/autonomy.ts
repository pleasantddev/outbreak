// Free will, Sims style: leave your character alone at home for a while and they look after themselves, picking the
// object action that best answers their most urgent need. Any input takes control back. Toggle with the dock button.
import type { GameSystem } from '../registry';
import type { Command } from '../../sim/types';
import { lifeSystem } from './index';
import { NEED_INFO, type Need } from './needs';

let idle = 0; let on = true; let toastT = 0;
export const autonomySystem: GameSystem = {
  id: 'autonomy',
  init(ctx) { on = (ctx.save.autonomy as boolean | undefined) ?? true; (window as any).__autonomy = { get on() { return on; }, set on(v: boolean) { on = v; ctx.save.autonomy = v; ctx.persist(); } }; },
  filterCommand(_ctx, c: Command) { if (Math.hypot(c.mx, c.mz) > 0.2 || c.fire || c.jump || c.interact) idle = 0; },
  frame(ctx, dt) {
    const L = lifeSystem.api; if (!L || !on) return; idle += dt; toastT -= dt;
    if (L.run || L.isBusy() || !L.S.inside || L.venue || idle < 22 || ctx.sim.local.vehicle !== null) return;
    const v = L.needs.v; let worst: Need | null = null, wv = 55;
    for (const k of Object.keys(v) as Need[]) if (v[k] < wv) { wv = v[k]; worst = k; }
    if (!worst) return;
    // the best object action for that need, avoiding anything that costs money
    let best: { a: any; t: any; g: number } | null = null;
    for (const t of (L as any).things() as any[]) { if (t.kind !== 'object') continue; for (const a of t.actions) { if (a.cost || (a.when === 'hasFood' && L.S.food <= 0) || !(L as any).allowed(a)) continue; const g = (a.gain?.[worst] ?? 0) * (a.fill === worst ? 1.3 : 1); if (g > (best?.g ?? 0)) best = { a, t, g }; } }
    if (!best) return; idle = 0; L.begin(best.a, best.t);
    if (toastT <= 0) { toastT = 60; ctx.hud.toast('Free will', `${NEED_INFO[worst].low}. ${best.a.label}.`, 'linear-gradient(160deg,#8b5cf6,#6d3ef0)', 'msg', 3); }
  },
};
