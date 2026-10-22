// F3 overlay: frame time, render scale, quality rung, draw calls and memory. Costs nothing while hidden.
import type { Governor } from './quality';
import { LEVELS } from './quality';
import type { LifeView } from './lifeView';

export class PerfHud {
  private el: HTMLDivElement; private on = false; private t = 0;
  constructor(private view: () => LifeView | undefined, private gov: () => Governor | undefined) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#9cf;background:rgba(0,0,0,.62);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre;display:none';
    document.body.appendChild(this.el);
    addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); this.toggle(); } });
    if (new URLSearchParams(location.search).has('perf')) this.toggle(true);
  }
  toggle(v = !this.on) { this.on = v; this.el.style.display = v ? 'block' : 'none'; }
  get visible() { return this.on; }
  update(dt: number) {
    if (!this.on) return; this.t -= dt; if (this.t > 0) return; this.t = 0.5;
    const v = this.view(), g = this.gov(); if (!v) return; const I = v.renderer.info; const mem = (performance as any).memory;
    const L = LEVELS[v.level];
    this.el.textContent = [
      `${g ? g.fps.toFixed(0) : '?'} fps  ${g ? g.ft.toFixed(1) : '?'} ms  mode ${g ? g.pref : '?'}`,
      `rung ${v.level} ${L.name}  dpr ${v.renderer.getPixelRatio().toFixed(2)} (native)  ${v.renderer.domElement.width}x${v.renderer.domElement.height}`,
      `calls ${I.render.calls}  tris ${(I.render.triangles / 1000).toFixed(0)}k  prog ${I.programs?.length ?? 0}`,
      `geo ${I.memory.geometries}  tex ${I.memory.textures}  tiles ${v.world.tiles.size}  actors ${v.actors.size}  cars ${v.cars.size}`,
      mem ? `heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '',
      ...(g ? g.log.slice(-4).map((l) => `${l.t}s ${l.msg}`) : []),
    ].filter(Boolean).join('\n');
  }
}
