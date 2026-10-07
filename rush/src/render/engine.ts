// Renderer, post-processing and frame pacing. The quality settings decide the pixel budget, shadows and effects;
// dynamic resolution trims the pixel count when a phone starts to struggle.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset,
  ChromaticAberrationEffect, Effect, BlendFunction,
} from 'postprocessing';
import { DynamicResolution, type GraphicsSettings } from './quality';

const nanGuardFrag = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  bool ok = c.r >= 0.0 && c.r < 60000.0 && c.g >= 0.0 && c.g < 60000.0 && c.b >= 0.0 && c.b < 60000.0;
  outputColor = ok ? inputColor : vec4(0.0, 0.0, 0.0, 1.0);
}`;

// Speed and story effects in one pass: radial streaks at speed, a NEPA blackout that leaves only the headlights,
// a flash for hits, and a gentle warm grade.
const fxFrag = /* glsl */ `
uniform float uSpeed;
uniform float uBlackout;
uniform float uFlash;
uniform float uTime;
uniform vec3 uFlashColor;
uniform float uDesat;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  vec2 q = uv - vec2(0.5, 0.46);
  float r = length(q * vec2(1.6, 1.0));
  // speed streaks: thin lines flowing out from the centre, bright at the head and fading behind it. The lanes are
  // narrow and only the middle third of a lane lights, so a streak is a few pixels wide and a tenth of the screen long
  if (uSpeed > 0.01) {
    float a = atan(q.y, q.x) * 90.0;
    float lane = floor(a);
    float h = hash(vec2(lane, 3.7));
    float across = abs(fract(a) - 0.5) * 2.0;
    float flow = fract(r * 1.4 - uTime * (2.4 + h * 2.5) + h);
    float streak = smoothstep(0.82, 1.0, flow) * smoothstep(0.4, 0.0, across) * step(0.9, h) * smoothstep(0.35, 0.8, r);
    c += vec3(1.0, 0.97, 0.9) * streak * uSpeed * 0.45;
    c *= 1.0 - uSpeed * 0.18 * smoothstep(0.45, 1.1, r);
  }
  // blackout: the world goes dark except a headlight wedge in front of the car
  if (uBlackout > 0.001) {
    vec2 hp = (uv - vec2(0.5, 0.18)) * vec2(1.0, 1.4);
    float cone = smoothstep(0.42, 0.08, length(hp)) * smoothstep(-0.05, 0.2, uv.y - 0.12);
    float flicker = 0.92 + 0.08 * sin(uTime * 43.0) * sin(uTime * 7.0);
    c *= mix(1.0, mix(0.04, 1.0, cone) * flicker, uBlackout);
  }
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(l), uDesat);
  c += uFlashColor * uFlash;
  outputColor = vec4(c, inputColor.a);
}`;

export class RushFx extends Effect {
  constructor() {
    super('RushFx', fxFrag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uSpeed', new THREE.Uniform(0)], ['uBlackout', new THREE.Uniform(0)], ['uFlash', new THREE.Uniform(0)], ['uTime', new THREE.Uniform(0)],
        ['uFlashColor', new THREE.Uniform(new THREE.Color(1, 1, 1))], ['uDesat', new THREE.Uniform(0)],
      ]),
    });
  }
  set(name: 'uSpeed' | 'uBlackout' | 'uFlash' | 'uTime' | 'uDesat', v: number) { (this.uniforms.get(name) as THREE.Uniform).value = v; }
  flashColor(c: THREE.ColorRepresentation) { ((this.uniforms.get('uFlashColor') as THREE.Uniform).value as THREE.Color).set(c); }
}

export interface PerfSample { fps: number; ms: number; calls: number; tris: number; scale: number; w: number; h: number }

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer | null = null;
  fx = new RushFx();
  bloom: BloomEffect | null = null;
  chroma: ChromaticAberrationEffect | null = null;
  settings: GraphicsSettings;
  dyn: DynamicResolution;
  perf: PerfSample = { fps: 60, ms: 16, calls: 0, tris: 0, scale: 1, w: 0, h: 0 };
  private last = performance.now();
  private fpsAcc = 0; private fpsN = 0; private fpsT = 0;
  // a canvas resize wipes its drawing buffer, so it waits for the start of the next frame and is drawn straight after;
  // resizing after a frame is drawn hands the browser a blank canvas to show
  private resizeDue = false;
  private onResize = () => { this.resizeDue = true; };
  maxAniso: number;

  constructor(public canvas: HTMLCanvasElement, settings: GraphicsSettings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false, preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 2400);
    this.dyn = new DynamicResolution(settings.renderScale);
    this.apply(settings);
    window.addEventListener('resize', this.onResize);
  }

  /** Rebuild the pipeline for new settings. Cheap enough to call from the settings screen live. */
  apply(s: GraphicsSettings) {
    this.settings = s;
    this.dyn.max = s.renderScale;
    this.dyn.scale = Math.min(this.dyn.scale, s.renderScale);
    if (!s.dynamicRes) this.dyn.scale = s.renderScale;
    this.renderer.shadowMap.enabled = s.shadows > 0;
    this.camera.far = s.drawDistance * 1.6 + 400;
    this.camera.updateProjectionMatrix();
    this.composer?.dispose();
    this.composer = null; this.bloom = null; this.chroma = null;
    const usePost = s.bloom || s.smaa || s.motionFx;
    if (usePost) {
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // scrub NaN and Inf before anything blurs them: bloom would smear one bad pixel across the whole frame
      if (s.bloom) this.composer.addPass(new EffectPass(this.camera, new Effect('NanGuard', nanGuardFrag)));
      const effects: Effect[] = [];
      if (s.smaa) effects.push(new SMAAEffect({ preset: SMAAPreset.MEDIUM }));
      if (s.bloom) { this.bloom = new BloomEffect({ intensity: 0.9, luminanceThreshold: 0.82, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.72 }); effects.push(this.bloom); }
      effects.push(this.fx);
      effects.push(new VignetteEffect({ offset: 0.32, darkness: 0.5 }));
      effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
      this.composer.addPass(new EffectPass(this.camera, ...effects));
      if (s.motionFx) {
        this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.35 });
        this.composer.addPass(new EffectPass(this.camera, this.chroma));
      }
    } else {
      this.renderer.toneMapping = THREE.AgXToneMapping;
      this.renderer.toneMappingExposure = 1;
    }
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.settings.pixelRatioCap) * this.dyn.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.perf.w = Math.round(w * pr); this.perf.h = Math.round(h * pr); this.perf.scale = this.dyn.scale;
  }

  /** Render one frame and return the real elapsed seconds since the previous one. */
  frame(): number {
    const now = performance.now();
    // the game never steps more than 0.1 s at once, but the frame counter reports what the player really gets
    const raw = Math.min(2, (now - this.last) / 1000);
    const dt = Math.min(0.1, raw);
    this.last = now;
    this.fx.set('uTime', now / 1000);
    if (this.resizeDue) { this.resizeDue = false; this.resize(); }
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    this.perf.calls = info.calls; this.perf.tris = info.triangles;
    this.fpsAcc += raw; this.fpsN++; this.fpsT += raw;
    if (this.fpsT > 0.5) { this.perf.fps = Math.round(this.fpsN / this.fpsAcc); this.perf.ms = (this.fpsAcc / this.fpsN) * 1000; this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0; }
    if (this.settings.dynamicRes && this.dyn.update(dt * 1000, this.settings.targetFps)) this.resizeDue = true;
    return dt;
  }

  /** Average frame time of the current scene, for the Auto preset and the Settings benchmark. Each frame is closed
   *  with a one pixel read back: gl.finish() returns early in Chrome, a read back cannot return until the GPU has
   *  drawn everything before it. Stops after maxMs of measured frames so a slow phone is not kept waiting. */
  async benchmark(frames = 40, maxMs = 2500): Promise<number> {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    const sync = () => { this.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    const draw = () => { if (this.composer) this.composer.render(1 / 60); else this.renderer.render(this.scene, this.camera); };
    // the first frame compiles shaders and uploads textures, which says nothing about steady play
    draw(); sync();
    let total = 0, n = 0;
    while (n < frames && (n < 4 || total < maxMs)) {
      sync(); // drain anything the app drew while we yielded
      const t = performance.now();
      draw(); sync();
      total += performance.now() - t; n++;
      if (n % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return total / n;
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
