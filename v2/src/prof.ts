// A frame profiler for finding what is slow. Off unless the page has ?prof; then window.__prof.report() lists the
// average milliseconds per frame spent in each part (sim, each system, render, HUD), and window.__prof.spikes() lists the
// slow frames (over 40 ms) with what took the time in each. Costs one branch when off.
export const prof = {
  on: typeof location !== 'undefined' && new URLSearchParams(location.search).has('prof'),
  acc: new Map<string, number>(), cur: new Map<string, number>(), frames: 0, t0: 0, last: 0,
  times: [] as number[], slow: [] as { ms: number; at: number; parts: [string, number][] }[],
  /** time a call under a name */
  t<T>(name: string, f: () => T): T { if (!this.on) return f(); const a = performance.now(); try { return f(); } finally { const d = performance.now() - a; this.acc.set(name, (this.acc.get(name) ?? 0) + d); this.cur.set(name, (this.cur.get(name) ?? 0) + d); } },
  frame() {
    if (!this.on) return; this.frames++; const now = performance.now();
    if (this.last) {
      const ms = now - this.last; this.times.push(ms); if (this.times.length > 5000) this.times.shift();
      if (ms > 40 && this.slow.length < 200) this.slow.push({ ms: Math.round(ms), at: Math.round(now / 1000), parts: [...this.cur.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => [k, Math.round(v * 10) / 10]) });
    }
    this.last = now; this.cur.clear();
  },
  reset() { this.acc.clear(); this.cur.clear(); this.frames = 0; this.times = []; this.slow = []; this.last = 0; },
  report(top = 30) { const n = Math.max(1, this.frames); return [...this.acc.entries()].map(([k, v]) => [k, +(v / n).toFixed(3)] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, top); },
  /** frame time percentiles (ms) and how many frames were slow */
  dist() { const s = [...this.times].sort((a, b) => a - b); const p = (q: number) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0); return { n: s.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), max: Math.round(s[s.length - 1] ?? 0), over33: s.filter((x) => x > 33).length, over50: s.filter((x) => x > 50).length }; },
  spikes() { return this.slow; },
};
if (typeof window !== 'undefined') (window as any).__prof = prof;
