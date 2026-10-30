// Money from the life and career systems. Offline it is just sim.cash. Online the server owns the wallet: earnings are
// sent with their source and the server accepts them within per-source limits (net/rules.ts EARN_RULES); spending can
// stay local because the cash watcher ships losses as deltas. Gambling never comes through here (casino runs server side).
import type { GameCtx } from './registry';
import { net } from '../net/client';

export type EarnWhy = 'fare' | 'work' | 'street' | 'race' | 'bet' | 'hustle' | 'reward' | 'sale';
export function earn(ctx: GameCtx, n: number, why: EarnWhy) {
  n = Math.round(n); if (!(n > 0)) return;
  ctx.sim.events.push({ t: 'cash', actor: ctx.sim.local.id, amount: n } as any);
  if (net.active) { void net.act('cash.delta', { d: n, why }); return; }
  ctx.sim.cash += n;
}
export function spend(ctx: GameCtx, n: number): boolean {
  n = Math.round(n); if (n <= 0) return true; if (ctx.sim.cash < n) return false;
  ctx.sim.cash -= n; ctx.sim.events.push({ t: 'cash', actor: ctx.sim.local.id, amount: -n } as any); return true;
}
export const online = () => net.active;
