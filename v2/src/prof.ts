// A frame profiler for finding what is slow. Off unless the page has ?prof; then window.__prof.report() lists the
// average milliseconds per frame spent in each part (sim, each system, render, HUD). Costs one branch when off.
export const prof = {
  on: typeof location !== 'undefined' && new URLSearchParams(location.search).has('prof'),
  acc: new Map<string, number>(), frames: 0, t0: 0,
  /** time a call under a name */
  t<T>(name: string, f: () => T): T { if (!this.on) return f(); const a = performance.now(); try { return f(); } finally { this.acc.set(name, (this.acc.get(name) ?? 0) + performance.now() - a); } },
  frame() { if (this.on) this.frames++; },
  reset() { this.acc.clear(); this.frames = 0; },
  report(top = 30) { const n = Math.max(1, this.frames); return [...this.acc.entries()].map(([k, v]) => [k, +(v / n).toFixed(3)] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, top); },
};
if (typeof window !== 'undefined') (window as any).__prof = prof;
