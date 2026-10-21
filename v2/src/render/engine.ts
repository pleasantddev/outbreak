// Renderer, post-processing and the "bloody darkness" grade.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, NoiseEffect, ChromaticAberrationEffect,
  ToneMappingEffect, ToneMappingMode, SMAAEffect, BlendFunction, Effect,
} from 'postprocessing';

const gradeFrag = /* glsl */ `
uniform float uHurt;
uniform float uLow;
uniform float uCorrupt;
uniform float uHeart;
uniform float uAwake;
uniform float uTime;
uniform float uFlash;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // split tone: shadows lean cold teal, highlights lean sodium and blood
  vec3 shadowTint = vec3(0.86, 0.95, 1.05);
  vec3 highTint = vec3(1.08, 0.96, 0.86);
  c *= mix(shadowTint, highTint, smoothstep(0.05, 0.6, l));
  // crush blacks, keep the reds
  c = max(c - 0.006, 0.0) * 1.03;
  float sat = 0.86 - uLow * 0.6;
  c = mix(vec3(l), c, sat);
  c.r += c.r * 0.06;

  vec2 q = uv - 0.5;
  float edge = length(q * vec2(1.25, 1.0));
  // hurt: blood seeping in from the edges
  float n = vnoise(uv * 7.0 + uTime * 0.05) * 0.6 + vnoise(uv * 21.0) * 0.4;
  float blood = smoothstep(0.75 - uHurt * 0.45 - uLow * 0.25, 1.05, edge + n * 0.25);
  c = mix(c, vec3(0.32, 0.0, 0.01) * (0.6 + 0.4 * n), blood * clamp(uHurt + uLow * 0.8, 0.0, 1.0));
  // low health heartbeat throb
  c *= 1.0 - uLow * 0.25 * (0.5 + 0.5 * sin(uTime * 7.5)) * smoothstep(0.3, 0.9, edge);
  // corruption: red cast and swimming noise
  c = mix(c, c * vec3(1.4, 0.45, 0.4) + vec3(0.05, 0.0, 0.0), uCorrupt * 0.55);
  // Heart pulse: a shockwave of red from the centre
  float ring = smoothstep(0.08, 0.0, abs(edge - uHeart * 1.2)) * (1.0 - uHeart);
  c += vec3(0.6, 0.02, 0.02) * ring;
  // Awakened monster vision: everything cold, living heat stays red
  c = mix(c, vec3(l * 0.5, l * 0.15, l * 0.2) + vec3(0.02, 0.0, 0.03), uAwake * 0.55);
  c += vec3(1.0, 0.9, 0.8) * uFlash;
  outputColor = vec4(c, inputColor.a);
}`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFrag, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uHurt', new THREE.Uniform(0)], ['uLow', new THREE.Uniform(0)], ['uCorrupt', new THREE.Uniform(0)],
        ['uHeart', new THREE.Uniform(0)], ['uAwake', new THREE.Uniform(0)], ['uTime', new THREE.Uniform(0)], ['uFlash', new THREE.Uniform(0)],
      ]),
    });
  }
  set(name: string, v: number) { (this.uniforms.get(name) as THREE.Uniform).value = v; }
}

export type Quality = 'low' | 'medium' | 'high';

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  grade = new GradeEffect();
  bloom: BloomEffect;
  chroma: ChromaticAberrationEffect;
  quality: Quality;
  private resizeObs: () => void;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 900);
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({ intensity: 1.35, luminanceThreshold: 0.62, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0004), radialModulation: true, modulationOffset: 0.35 });
    const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.78 });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: true });
    noise.blendMode.opacity.value = 0.38;
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const effects: Effect[] = [this.bloom, tone, this.grade, vignette, noise];
    if (quality !== 'low') effects.unshift(new SMAAEffect());
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    this.composer.addPass(new EffectPass(this.camera, this.chroma));
    this.resizeObs = () => this.resize();
    window.addEventListener('resize', this.resizeObs);
    this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  render(dt: number) { this.composer.render(dt); }
  dispose() {
    window.removeEventListener('resize', this.resizeObs);
    this.composer.dispose();
    this.renderer.dispose();
  }
}
