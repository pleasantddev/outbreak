import { useRef, useState } from 'preact/hooks';

export interface Pt { label: string; v: number }
const nice = (m: number) => { if (m <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(m))); const f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
const short = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k' : String(Math.round(v * 10) / 10));

/** Area/line chart with hover read-out. series are drawn on the same axis. */
export function AreaChart({ series, h = 180, fmtV = short, colors = ['#2de0c8', '#8b5cf6'], labels }: { series: { name: string; data: number[] }[]; h?: number; fmtV?: (v: number) => string; colors?: string[]; labels: string[] }) {
  const W = 720, pad = { l: 44, r: 10, t: 10, b: 22 }; const [hov, setHov] = useState<number | null>(null); const ref = useRef<SVGSVGElement>(null);
  const n = labels.length; const max = nice(Math.max(1, ...series.flatMap((s) => s.data))); const iw = W - pad.l - pad.r, ih = h - pad.t - pad.b;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * iw), y = (v: number) => pad.t + ih - (v / max) * ih;
  const move = (e: MouseEvent) => { const r = ref.current!.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHov(Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / iw) * (n - 1))))); };
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max); const step = Math.max(1, Math.ceil(n / 7));
  return (
    <div style="position:relative">
      <svg ref={ref} class="chart" viewBox={`0 0 ${W} ${h}`} width="100%" style={`height:${h}px;display:block`} onMouseMove={move} onMouseLeave={() => setHov(null)}>
        <defs>{series.map((_, i) => (<linearGradient id={`ag${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color={colors[i]} stop-opacity=".32" /><stop offset="1" stop-color={colors[i]} stop-opacity="0" /></linearGradient>))}</defs>
        {ticks.map((t) => (<g key={t}><line class="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} /><text x={pad.l - 6} y={y(t) + 3.5} text-anchor="end">{fmtV(t)}</text></g>))}
        {labels.map((l, i) => i % step === 0 && <text key={i} x={x(i)} y={h - 6} text-anchor="middle">{l}</text>)}
        {series.map((s, i) => { const d = s.data.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(''); return (<g key={i}><path d={`${d}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={`url(#ag${i})`} /><path d={d} fill="none" stroke={colors[i]} stroke-width="2" stroke-linejoin="round" /></g>); })}
        {hov !== null && (<g><line x1={x(hov)} x2={x(hov)} y1={pad.t} y2={pad.t + ih} stroke="rgba(255,255,255,.25)" />{series.map((s, i) => <circle key={i} cx={x(hov)} cy={y(s.data[hov])} r="4" fill="#0b0d15" stroke={colors[i]} stroke-width="2" />)}</g>)}
      </svg>
      {hov !== null && (<div class="glass" style={`position:absolute;top:4px;${x(hov) > W * 0.6 ? 'right:' + (100 - (x(hov) / W) * 100 + 2) + '%' : 'left:' + ((x(hov) / W) * 100 + 2) + '%'};padding:6px 10px;font-size:12px;pointer-events:none`}><div class="dim">{labels[hov]}</div>{series.map((s, i) => <div key={i}><i style={`display:inline-block;width:8px;height:8px;border-radius:2px;background:${colors[i]};margin-right:6px`} />{s.name}: <b>{fmtV(s.data[hov])}</b></div>)}</div>)}
    </div>
  );
}

export function BarChart({ data, h = 180, fmtV = short, color = '#8b5cf6', labels }: { data: number[]; labels: string[]; h?: number; fmtV?: (v: number) => string; color?: string }) {
  const W = 720, pad = { l: 44, r: 10, t: 10, b: 22 }; const [hov, setHov] = useState<number | null>(null);
  const max = nice(Math.max(1, ...data)); const iw = W - pad.l - pad.r, ih = h - pad.t - pad.b; const bw = iw / data.length; const step = Math.max(1, Math.ceil(data.length / 8));
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${h}`} width="100%" style={`height:${h}px;display:block`} onMouseLeave={() => setHov(null)}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => { const yy = pad.t + ih - f * ih; return (<g key={f}><line class="grid" x1={pad.l} x2={W - pad.r} y1={yy} y2={yy} /><text x={pad.l - 6} y={yy + 3.5} text-anchor="end">{fmtV(f * max)}</text></g>); })}
      {data.map((v, i) => { const bh = (v / max) * ih; return (<g key={i} onMouseEnter={() => setHov(i)}><rect x={pad.l + i * bw + bw * 0.14} y={pad.t + ih - bh} width={bw * 0.72} height={Math.max(0, bh)} rx="2" fill={color} opacity={hov === null || hov === i ? 1 : 0.45} />{i % step === 0 && <text x={pad.l + i * bw + bw / 2} y={h - 6} text-anchor="middle">{labels[i]}</text>}</g>); })}
      {hov !== null && <text x={Math.min(W - 60, pad.l + hov * bw + bw / 2)} y={pad.t + 10} text-anchor="middle" style="fill:#e9ecf4;font-weight:600">{labels[hov]}: {fmtV(data[hov])}</text>}
    </svg>
  );
}

export function Sparkline({ data, color = '#2de0c8', h = 40, w = 160 }: { data: number[]; color?: string; h?: number; w?: number }) {
  if (data.length < 2) return null; const max = Math.max(1, ...data), min = Math.min(...data);
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${((i / (data.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / (max - min || 1)) * (h - 6)).toFixed(1)}`).join('');
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}><path d={d} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" /></svg>;
}
