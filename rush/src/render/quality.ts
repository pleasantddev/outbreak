// Graphics settings. Five presets plus Auto, which reads the GPU and memory, then confirms with a short benchmark
// on the loading screen. Every value can be overridden in Settings; dynamic resolution keeps frame time on target.

export type PresetId = 'potato' | 'low' | 'medium' | 'high' | 'ultra';
export interface GraphicsSettings {
  preset: PresetId | 'custom';
  auto: boolean;
  renderScale: number;      // fraction of the device pixel ratio cap
  pixelRatioCap: number;
  dynamicRes: boolean;
  targetFps: 30 | 60 | 120;
  shadows: 0 | 1024 | 2048 | 4096;
  bloom: boolean;
  smaa: boolean;
  motionFx: boolean;        // speed lines, chromatic fringe, camera shake extras
  drawDistance: number;     // metres
  buildingDetail: 0 | 1 | 2;
  props: number;            // 0..1 density of street furniture
  particles: number;        // 0..1
  reflections: boolean;     // sky reflections on the whole city; cars always reflect
  anisotropy: number;
  crowd: boolean;
  showPerf: boolean;
}

export const PRESETS: Record<PresetId, Omit<GraphicsSettings, 'preset' | 'auto' | 'showPerf'>> = {
  potato: { renderScale: 0.6, pixelRatioCap: 1, dynamicRes: true, targetFps: 30, shadows: 0, bloom: false, smaa: false, motionFx: false, drawDistance: 380, buildingDetail: 0, props: 0.25, particles: 0.3, reflections: false, anisotropy: 1, crowd: false },
  low: { renderScale: 0.75, pixelRatioCap: 1, dynamicRes: true, targetFps: 60, shadows: 0, bloom: false, smaa: false, motionFx: false, drawDistance: 520, buildingDetail: 1, props: 0.5, particles: 0.5, reflections: false, anisotropy: 2, crowd: false },
  medium: { renderScale: 0.9, pixelRatioCap: 1.5, dynamicRes: true, targetFps: 60, shadows: 1024, bloom: true, smaa: false, motionFx: true, drawDistance: 750, buildingDetail: 1, props: 0.8, particles: 0.75, reflections: true, anisotropy: 4, crowd: true },
  high: { renderScale: 1, pixelRatioCap: 2, dynamicRes: true, targetFps: 60, shadows: 2048, bloom: true, smaa: true, motionFx: true, drawDistance: 1000, buildingDetail: 2, props: 1, particles: 1, reflections: true, anisotropy: 8, crowd: true },
  ultra: { renderScale: 1, pixelRatioCap: 2.5, dynamicRes: false, targetFps: 120, shadows: 4096, bloom: true, smaa: true, motionFx: true, drawDistance: 1400, buildingDetail: 2, props: 1, particles: 1, reflections: true, anisotropy: 16, crowd: true },
};
export const PRESET_ORDER: PresetId[] = ['potato', 'low', 'medium', 'high', 'ultra'];
export const PRESET_LABEL: Record<PresetId, string> = { potato: 'Potato', low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };

export function settingsFor(preset: PresetId, auto = false): GraphicsSettings {
  return { preset, auto, showPerf: false, ...PRESETS[preset] };
}

export interface DeviceInfo { gpu: string; mobile: boolean; memory: number; cores: number; screen: number; webgl2: boolean }

export function detectDevice(): DeviceInfo {
  let gpu = 'unknown', webgl2 = false;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') as WebGL2RenderingContext | null) ?? (c.getContext('webgl') as WebGLRenderingContext | null);
    webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* no WebGL info */ }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
  return { gpu, mobile, memory: nav.deviceMemory ?? 4, cores: navigator.hardwareConcurrency ?? 4, screen: Math.max(screen.width, screen.height) * (devicePixelRatio || 1), webgl2 };
}

/** First guess from the hardware; the benchmark refines it. */
export function guessPreset(d: DeviceInfo): PresetId {
  const g = d.gpu.toLowerCase();
  if (!d.webgl2) return 'potato';
  if (/swiftshader|llvmpipe|software|basic render/.test(g)) return 'potato';
  if (d.mobile) {
    if (/apple gpu|apple a1[5-9]|apple m/.test(g)) return 'medium';
    if (/adreno.*(7[3-9]\d|8\d\d)|mali-g7[1-9]|mali-g[6-9]\d\d|immortalis|xclipse/.test(g)) return 'medium';
    if (/adreno.*(6[4-9]\d|7[0-2]\d)|mali-g(5[2-9]|6[0-9]|7[0-8])/.test(g)) return 'low';
    return d.memory >= 6 ? 'low' : 'potato';
  }
  if (/rtx|radeon rx [5-7]\d\d\d|radeon pro|apple m[2-9]|arc a7/.test(g)) return 'ultra';
  if (/gtx 1[0-6]|gtx [7-9]\d\d|radeon rx|apple m1|iris xe|arc/.test(g)) return 'high';
  if (/intel.*(uhd|hd)|vega|radeon\(tm\) graphics/.test(g)) return d.memory >= 8 ? 'medium' : 'low';
  return d.memory >= 8 && d.cores >= 8 ? 'high' : 'medium';
}

/** Step a preset up or down by benchmark result (average frame ms at the guessed preset). */
export function refineByBenchmark(p: PresetId, frameMs: number, target: number): PresetId {
  const i = PRESET_ORDER.indexOf(p);
  const budget = 1000 / target;
  if (frameMs > budget * 3) return 'potato';
  if (frameMs > budget * 1.6) return PRESET_ORDER[Math.max(0, i - 2)];
  if (frameMs > budget * 1.1) return PRESET_ORDER[Math.max(0, i - 1)];
  if (frameMs < budget * 0.45 && i < PRESET_ORDER.length - 1) return PRESET_ORDER[i + 1];
  return p;
}

/** Keeps frame time on target by nudging render scale; never above the user's chosen scale. */
export class DynamicResolution {
  scale: number;
  private ema = 16;
  private cool = 0;
  constructor(public max: number, public min = 0.5) { this.scale = max; }
  update(frameMs: number, targetFps: number) {
    this.ema = this.ema * 0.92 + frameMs * 0.08;
    if (this.cool > 0) { this.cool--; return false; }
    const budget = 1000 / targetFps;
    const before = this.scale;
    if (this.ema > budget * 1.12 && this.scale > this.min) this.scale = Math.max(this.min, this.scale - 0.05);
    else if (this.ema < budget * 0.78 && this.scale < this.max) this.scale = Math.min(this.max, this.scale + 0.025);
    if (before !== this.scale) { this.cool = 45; return true; }
    return false;
  }
  get frameMs() { return this.ema; }
}
