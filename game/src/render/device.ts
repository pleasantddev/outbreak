// Picks a starting graphics tier from the GPU and device, so a mid-range phone or an old laptop does not start on a
// tier it cannot run. The player's own choice in Settings always wins over this guess.
import type { Quality } from './engine';

export interface DeviceGuess { quality: Quality; gpu: string; mobile: boolean; reason: string }

/** The GPU's name from a throwaway WebGL context. Empty if the browser hides it. Never throws. */
export function readGpu(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

export function guessQuality(gpuIn?: string): DeviceGuess {
  const gpu = (gpuIn ?? readGpu()).toLowerCase();
  const nav = navigator as Navigator & { deviceMemory?: number };
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const ua = navigator.userAgent.toLowerCase();
  const mobile = /android|iphone|ipad|mobile/.test(ua) || (touch && Math.min(screen.width, screen.height) < 820);
  const mem = nav.deviceMemory ?? 8;
  const has = (re: RegExp) => re.test(gpu);
  let quality: Quality = 'medium';
  let reason = 'default';
  if (has(/swiftshader|llvmpipe|software|basic render/)) { quality = 'low'; reason = 'software renderer'; }
  else if (mobile) {
    // recent flagship-class phone GPUs can take Medium; everything else starts on Low
    const strong = has(/adreno.*(7[3-9]\d|8\d\d)|apple gpu|immortalis|mali-g7[1-9]\d/) && mem >= 6;
    quality = strong ? 'medium' : 'low';
    reason = strong ? 'recent phone gpu' : 'phone';
  }
  else if (has(/rtx|rx\s?[67]\d00|radeon pro w|arc a7|apple m[2-9]/)) { quality = 'high'; reason = 'fast gpu'; }
  else if (has(/intel.*(hd|uhd) graphics|iris\(tm\) graphics [56]\d\d|radeon pro [45]\d\d|radeon r9 m|gma|mali|adreno/)) { quality = 'low'; reason = 'older or integrated gpu'; }
  else if (has(/iris xe|iris plus|apple m1|radeon.*graphics|geforce/)) { quality = 'medium'; reason = 'mid gpu'; }
  if (mem <= 4 && quality !== 'low') { quality = 'low'; reason += ', little memory'; }
  return { quality, gpu, mobile, reason };
}
