// Sky, clouds, weather and time for HustleLife.
// Game clock runs 30x real time (a 48 minute day), seasons follow the real calendar in Lagos, and a real WAT clock
// sits beside it. Clouds are ray marched at reduced resolution and composited into an analytic sky dome.
import * as THREE from 'three';
import { groundShared } from '../world/ground';
import { buildingShared } from '../world/buildings';
import { propShared, setPropNight } from '../world/props';
import { LEVELS, type Level } from './quality';
import { setSignNight } from '../world/signs';

export type WeatherName = 'clear' | 'hot' | 'harmattan' | 'fog' | 'rain' | 'storm';
interface W { label: string; cover: number; dens: number; haze: number; fog: number; tint: [number, number, number]; sun: number; rain: number; wetRate: number; dry: number; dust: number; low: number }
export const WEATHER: Record<WeatherName, W> = {
  clear:     { label: 'Clear',          cover: 0.32, dens: 0.9, haze: 0.15, fog: 0.00045, tint: [0.62, 0.74, 0.9],  sun: 1.0,  rain: 0,   wetRate: 0,    dry: 0.012, dust: 0,    low: 0 },
  hot:       { label: 'Hot and hazy',   cover: 0.18, dens: 0.6, haze: 0.45, fog: 0.0009,  tint: [0.8, 0.8, 0.76],   sun: 1.12, rain: 0,   wetRate: 0,    dry: 0.03,  dust: 0.15, low: 0 },
  harmattan: { label: 'Harmattan haze', cover: 0.06, dens: 0.4, haze: 1.0,  fog: 0.0042,  tint: [0.84, 0.68, 0.5],  sun: 0.62, rain: 0,   wetRate: 0,    dry: 0.05,  dust: 1,    low: 0 },
  fog:       { label: 'Morning fog',    cover: 0.55, dens: 0.7, haze: 0.8,  fog: 0.011,   tint: [0.76, 0.78, 0.8],  sun: 0.4,  rain: 0,   wetRate: 0.004,dry: 0.0,   dust: 0,    low: 1 },
  rain:      { label: 'Rain',           cover: 0.86, dens: 1.6, haze: 0.5,  fog: 0.0028,  tint: [0.5, 0.55, 0.62],  sun: 0.25, rain: 1,   wetRate: 0.03, dry: 0,     dust: 0,    low: 0.3 },
  storm:     { label: 'Thunderstorm',   cover: 0.98, dens: 2.4, haze: 0.6,  fog: 0.0042,  tint: [0.33, 0.37, 0.44], sun: 0.1,  rain: 1.8, wetRate: 0.06, dry: 0,     dust: 0,    low: 0.5 },
};
export const WEATHER_ORDER = Object.keys(WEATHER) as WeatherName[];

export function seasonFor(d: Date) {
  const m = d.getUTCMonth() + 1;
  if (m === 12 || m <= 2) return { name: 'Harmattan', table: { harmattan: 6, fog: 2, clear: 1, hot: 1 } as Partial<Record<WeatherName, number>> };
  if (m <= 4) return { name: 'Hot dry season', table: { hot: 5, clear: 3, harmattan: 1, storm: 1 } };
  if (m === 8) return { name: 'August break', table: { clear: 4, hot: 2, rain: 2 } };
  if (m <= 10) return { name: 'Rainy season', table: { rain: 4, storm: 2, clear: 3, fog: 1 } };
  return { name: 'Dry season', table: { hot: 4, clear: 4, harmattan: 1, rain: 1 } };
}
function pick(t: Partial<Record<WeatherName, number>>): WeatherName { let s = 0; for (const v of Object.values(t)) s += v!; let r = Math.random() * s; for (const [k, v] of Object.entries(t)) { if ((r -= v!) <= 0) return k as WeatherName; } return 'clear'; }

const NOISE = /* glsl */ `
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h13(i), h13(i+vec3(1,0,0)), f.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), f.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), f.x), f.y), f.z); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n2(vec2 x){ vec2 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f); return mix(mix(h12(i), h12(i+vec2(1,0)), f.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), f.x), f.y); }
`;
const SKYFN = /* glsl */ `
uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunCol; uniform float uHaze; uniform float uNight; uniform vec3 uTint;
vec3 skyColor(vec3 d){
  float y = d.y;
  float hz = pow(1.0 - clamp(y, 0.0, 1.0), 3.5 - uHaze * 2.0);
  vec3 c = mix(uZenith, uHorizon, hz);
  if (y < 0.0) c = mix(uHorizon, uGround, smoothstep(0.0, -0.25, y));
  float mu = dot(d, uSunDir);
  float mie = pow(max(mu, 0.0), 8.0) * 0.35 + pow(max(mu, 0.0), 64.0) * 0.9;
  c += uSunCol * mie * (0.4 + uHaze * 0.8) * (1.0 - uNight);
  c = mix(c, uTint * dot(c, vec3(0.33)) * 1.4, uHaze * 0.35);
  return c;
}`;

const cloudVS = `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const cloudFS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uCam; uniform float uTime; uniform float uCover; uniform float uDens; uniform vec2 uWind; uniform float uSteps; uniform float uFrame; uniform float uLow;
${NOISE}
${SKYFN}
const float BASE = 1500.0, TOP = 3300.0;
float weather(vec2 p){ return n2(p * 0.00022 + uWind * 0.00022) * 0.62 + n2(p * 0.0007 + 3.1 + uWind * 0.0004) * 0.38; }
float density(vec3 p, bool cheap){
  float h = (p.y - BASE) / (TOP - BASE);
  if (h < 0.0 || h > 1.0) return 0.0;
  float w = weather(p.xz);
  float cov = clamp(w - (1.0 - uCover) * 0.95, 0.0, 1.0) / max(uCover * 0.95, 0.05);
  float prof = smoothstep(0.0, 0.08, h) * smoothstep(1.0, mix(0.55, 0.25, uCover), h);
  float shape = cov * prof;
  if (shape <= 0.001) return 0.0;
  vec3 q = p * 0.0011 + vec3(uWind.x, -uTime * 0.01, uWind.y) * 0.0011;
  float n = n3(q) * 0.55 + n3(q * 2.3) * 0.3;
  if (!cheap) n += n3(q * 6.1) * 0.15;
  float d = clamp(shape * 1.6 - (1.0 - n) * (0.95 - h * 0.25), 0.0, 1.0);
  return d * uDens;
}
float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
void main(){
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 v = uInvProj * ndc; v /= v.w;
  vec3 dir = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  if (dir.y < 0.015) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); return; }
  float t0 = (BASE - uCam.y) / dir.y, t1 = (TOP - uCam.y) / dir.y;
  t1 = min(t1, t0 + 9000.0);
  float steps = uSteps; float dt = (t1 - t0) / steps;
  float jit = fract(h12(gl_FragCoord.xy + uFrame * 7.13) + uFrame * 0.618);
  float T = 1.0; vec3 L = vec3(0.0);
  float mu = dot(dir, uSunDir);
  float phase = mix(hg(mu, 0.6), hg(mu, -0.2), 0.35) * 4.0;
  vec3 amb = mix(uHorizon, uZenith, 0.6) * 0.9;
  for (float i = 0.0; i < 48.0; i++) {
    if (i >= steps || T < 0.03) break;
    vec3 p = uCam + dir * (t0 + (i + jit) * dt);
    float d = density(p, false);
    if (d > 0.001) {
      float od = 0.0;
      for (float j = 1.0; j <= 4.0; j++) od += density(p + uSunDir * j * 110.0, true);
      float light = exp(-od * 1.1) * (1.0 - exp(-od * 2.2)) * 2.0 + exp(-od * 0.35) * 0.25;
      float h = (p.y - BASE) / (TOP - BASE);
      vec3 col = uSunCol * light * phase * (1.0 - uNight * 0.92) + amb * (0.35 + 0.65 * h);
      float a = 1.0 - exp(-d * dt * 0.012);
      L += T * a * col; T *= 1.0 - a;
    }
  }
  // distance haze on far clouds
  float far = smoothstep(2500.0, 16000.0, t0);
  vec3 hz = skyColor(vec3(dir.x, max(dir.y, 0.02), dir.z));
  L = mix(L, hz * (1.0 - T), far * 0.85);
  gl_FragColor = vec4(L, 1.0 - T);
}`;

const domeVS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const domeFS = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform sampler2D uClouds; uniform vec2 uRes; uniform float uUseClouds; uniform float uStars; uniform float uTime;
${NOISE}
${SKYFN}
void main(){
  vec3 d = normalize(vDir);
  vec3 c = skyColor(d);
  // sun and moon discs
  float mu = dot(d, uSunDir);
  c += uSunCol * smoothstep(0.9996, 0.99985, mu) * 30.0 * (1.0 - uNight);
  vec3 moon = normalize(-uSunDir + vec3(0.25, 0.1, 0.0));
  c += vec3(0.85, 0.9, 1.0) * smoothstep(0.9994, 0.9997, dot(d, moon)) * uNight * 2.5;
  // stars
  if (uStars > 0.01 && d.y > 0.0) { vec3 q = d * 280.0; float s = step(0.9965, h13(floor(q))); c += vec3(s) * uStars * (0.5 + 0.5 * sin(uTime * 3.0 + h13(floor(q)) * 40.0)) * smoothstep(0.0, 0.2, d.y); }
  if (uUseClouds > 0.5) { vec4 cl = texture2D(uClouds, gl_FragCoord.xy / uRes); c = c * (1.0 - cl.a) + cl.rgb; }
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Atmosphere {
  hour = 7.2; day = 3;
  season = seasonFor(new Date());
  cur: W & { name: WeatherName };
  target: WeatherName; lockedWeather = false;
  nextChange = 10;
  sunDir = new THREE.Vector3();
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight;
  dome: THREE.Mesh; domeMat: THREE.ShaderMaterial;
  cloudRT: THREE.WebGLRenderTarget; cloudMat: THREE.ShaderMaterial; cloudScene = new THREE.Scene(); cloudCam = new THREE.Camera();
  envScene = new THREE.Scene(); envDome: THREE.Mesh; pmrem: THREE.PMREMGenerator; envT = 99; env: THREE.Texture | null = null; envRT: THREE.WebGLRenderTarget | null = null; envSize = 0;
  rain: THREE.LineSegments; lightning = 0; thunderQueue: number[] = [];
  water = 0.3; wet = 0;
  frame = 0; cloudScale: number; steps: number;
  wind = new THREE.Vector2(0, 0);
  L: Level; shadowsBuilt: boolean; private cloudEvery = 1; private cloudAge = 99; private cloudDirLast = new THREE.Vector3(0, 0, 0); private cloudPosLast = new THREE.Vector3(1e9, 0, 0);
  private shadowFrame = 0; private pmremSize = 128; private pmremEvery = 5; private rainFrac = 1; private tmpV = new THREE.Vector3(); private tmpV2 = new THREE.Vector3(); private tmpV3 = new THREE.Vector3();
  private tmpSize = new THREE.Vector2(); private tmpV4 = new THREE.Vector3(); private tmpMoon = new THREE.Vector3();
  private k = { zen: new THREE.Color(), hor: new THREE.Color(), tint: new THREE.Color(), a: new THREE.Color(), b: new THREE.Color(), c: new THREE.Color(), sun: new THREE.Color(), fog: new THREE.Color(), white: new THREE.Color(1, 1, 1), flash: new THREE.Color(0.7, 0.75, 0.9) };
  onThunder?: (delay: number, strength: number) => void;
  constructor(public scene: THREE.Scene, public renderer: THREE.WebGLRenderer, level: number, opts: { hour?: number; weather?: WeatherName } = {}) {
    this.L = LEVELS[level]; this.shadowsBuilt = this.L.shadowSize > 0;
    const quality = level <= 1 ? 'high' : level <= 3 ? 'medium' : 'low';
    if (opts.hour !== undefined) this.hour = opts.hour;
    const w = opts.weather ?? pick(this.season.table);
    this.target = w; this.lockedWeather = !!opts.weather;
    this.cur = { ...WEATHER[w], tint: [...WEATHER[w].tint] as [number, number, number], name: w };
    if (w === 'rain' || w === 'storm') { this.water = 0.7; this.wet = 1; }
    this.cloudScale = this.L.cloudScale; this.steps = this.L.cloudSteps; this.cloudEvery = this.L.cloudEvery; this.pmremSize = this.L.pmremSize; this.pmremEvery = this.L.pmremEvery;
    const skyU = () => ({ uSunDir: { value: this.sunDir }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uHaze: { value: 0 }, uNight: { value: 0 }, uTint: { value: new THREE.Color() } });
    const shared = skyU();
    this.cloudRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.cloudMat = new THREE.ShaderMaterial({ vertexShader: cloudVS, fragmentShader: cloudFS, depthTest: false, depthWrite: false,
      uniforms: { ...shared, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uCover: { value: 0.3 }, uDens: { value: 1 }, uWind: { value: this.wind }, uSteps: { value: this.steps }, uFrame: { value: 0 }, uLow: { value: 0 } } });
    const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const q = new THREE.Mesh(tri, this.cloudMat); q.frustumCulled = false; this.cloudScene.add(q);
    this.domeMat = new THREE.ShaderMaterial({ vertexShader: domeVS, fragmentShader: domeFS, side: THREE.BackSide, depthWrite: false, depthTest: true,
      uniforms: { ...shared, uClouds: { value: this.cloudRT.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uUseClouds: { value: 1 }, uStars: { value: 0 }, uTime: { value: 0 } } });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.domeMat); this.dome.scale.setScalar(2500); this.dome.frustumCulled = false; this.dome.renderOrder = -10;
    scene.add(this.dome);
    const envMat = this.domeMat.clone(); envMat.uniforms = { ...this.domeMat.uniforms, uUseClouds: { value: 0 }, uStars: { value: 0 }, uClouds: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 } };
    this.envDome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envMat); this.envScene.add(this.envDome);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sun = new THREE.DirectionalLight(0xffffff, 3); this.sun.castShadow = this.shadowsBuilt;
    this.sun.shadow.autoUpdate = false; // the frame loop decides when the map is redrawn
    const c = this.sun.shadow.camera as THREE.OrthographicCamera; c.near = 1; c.far = 900;
    this.applyLevel(level);
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x5a4636, 1); scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xc8d4e0, 0.0008);
    // rain streaks
    const N = 9000;
    const rp = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 70, y = Math.random() * 34, z = (Math.random() - 0.5) * 70; rp.set([x, y, z, x + 0.05, y - 0.9, z + 0.02], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.rain.frustumCulled = false; scene.add(this.rain);
    this.applyLevel(level);
  }

  /** Moves to another rung of the quality ladder at run time. Nothing here recompiles a shader. */
  applyLevel(level: number) {
    const L = this.L = LEVELS[level];
    this.cloudScale = L.cloudScale; this.steps = L.cloudSteps; this.cloudEvery = L.cloudEvery; this.pmremSize = L.pmremSize; this.pmremEvery = L.pmremEvery; this.rainFrac = L.rain;
    if (this.cloudMat) this.cloudMat.uniforms.uSteps.value = this.steps;
    const sun = this.sun; if (!sun) return;
    const on = L.shadowSize > 0 && this.shadowsBuilt;
    sun.shadow.intensity = on ? 1 : 0;
    this.renderer.shadowMap.autoUpdate = false;
    const size = on ? L.shadowSize : 256;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null as any; } }
    const c = sun.shadow.camera as THREE.OrthographicCamera; const h = L.shadowHalf;
    if (c.right !== h) { c.left = -h; c.right = h; c.top = h; c.bottom = -h; c.updateProjectionMatrix(); }
    this.shadowOn = on;
    if (this.rain) { const n = Math.floor(9000 * this.rainFrac); this.rain.geometry.setDrawRange(0, n * 2); }
    this.envT = 99;
  }
  shadowOn = false;
  /** set by the view: a tile appeared or went away, or something that casts a shadow is moving. The map is only redrawn while one of these (or the sun, or the player) has changed. */
  shadowDirty = true; shadowDynamic = false; private shadowFocus = new THREE.Vector3(1e9, 0, 0); private shadowLd = new THREE.Vector3(0, 1, 0);
  /** shadow map redraws since the page loaded (for the perf overlay and the benchmarks) */
  shadowDraws = 0;

  setWeather(n: WeatherName, lock = true) { this.target = n; this.lockedWeather = lock; }
  cycleWeather() { const i = WEATHER_ORDER.indexOf(this.target); this.setWeather(WEATHER_ORDER[(i + 1) % WEATHER_ORDER.length]); this.envT = 99; }
  get weatherLabel() { return WEATHER[this.target].label; }
  timeString() { const h = Math.floor(this.hour) % 24, m = Math.floor((this.hour % 1) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
  realString() { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' }).format(new Date()); }

  update(dt: number, focus: THREE.Vector3, camera: THREE.PerspectiveCamera, gameSpeed = 30) {
    this.frame++;
    this.hour += (dt * gameSpeed) / 3600;
    if (this.hour >= 24) { this.hour -= 24; this.day++; }
    if (!this.lockedWeather && this.hour > this.nextChange && this.hour < this.nextChange + 0.5) { this.target = pick(this.season.table); this.nextChange = (this.hour + 2.5 + Math.random() * 4) % 24; }
    // blend weather (a few real minutes for a full change)
    const T = WEATHER[this.target]; const k = Math.min(1, dt * 0.06);
    for (const key of ['cover', 'dens', 'haze', 'fog', 'sun', 'rain', 'wetRate', 'dry', 'dust', 'low'] as const) (this.cur as any)[key] += ((T as any)[key] - (this.cur as any)[key]) * k;
    for (let i = 0; i < 3; i++) this.cur.tint[i] += (T.tint[i] - this.cur.tint[i]) * k;
    this.cur.name = this.target;
    const W = this.cur;
    // sun path for Lagos (6.5 N): rises about 06:40, sets about 18:50, passes high in the north-ish sky
    const t = (this.hour - 6.7) / (18.85 - 6.7);
    const elev = Math.sin(Math.PI * t) * 74; const az = 95 + t * 170;
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(az));
    const day = THREE.MathUtils.smoothstep(elev, -5, 12);
    const night = 1 - THREE.MathUtils.smoothstep(elev, -10, 3);
    const golden = THREE.MathUtils.smoothstep(elev, -4, 4) * (1 - THREE.MathUtils.smoothstep(elev, 6, 22));
    // sky palette
    const U = this.domeMat.uniforms;
    const K = this.k;
    const zen = K.zen.setRGB(0.12, 0.3, 0.68).lerp(K.a.setRGB(0.18, 0.22, 0.38), golden * 0.6).lerp(K.b.setRGB(0.006, 0.01, 0.03), night);
    const hor = K.hor.setRGB(0.62, 0.74, 0.88).lerp(K.a.setRGB(1.0, 0.56, 0.3), golden).lerp(K.b.setRGB(0.02, 0.03, 0.06), night);
    const tint = K.tint.setRGB(W.tint[0], W.tint[1], W.tint[2]);
    const grey = (c: THREE.Color, a: number) => { const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; return c.lerp(K.c.setRGB(l, l, l).multiply(tint).multiplyScalar(1.25), a); };
    grey(zen, W.cover * 0.75 + W.haze * 0.4); grey(hor, W.cover * 0.5 + W.haze * 0.55);
    const sunCol = K.sun.setRGB(1, 0.62 + 0.36 * (1 - golden), 0.38 + 0.56 * (1 - golden)).multiplyScalar(day * (0.25 + 0.75 * W.sun));
    U.uZenith.value.copy(zen); U.uHorizon.value.copy(hor); U.uGround.value.copy(hor).multiplyScalar(0.55); U.uSunCol.value.copy(sunCol);
    U.uHaze.value = W.haze; U.uNight.value = night; U.uTint.value.copy(tint);
    U.uStars.value = night * (1 - W.cover) * (1 - W.haze * 0.8); U.uTime.value += dt;
    // clouds pass: the half-res ray march is the costliest sky pass, so it only reruns when the camera has turned,
    // or every few frames to let the wind move them
    this.wind.x += dt * 9; this.wind.y += dt * 4;
    const cm = this.cloudMat.uniforms;
    cm.uCover.value = Math.min(0.99, W.cover); cm.uDens.value = W.dens; cm.uTime.value += dt; cm.uFrame.value = this.frame % 64; cm.uLow.value = W.low;
    camera.updateMatrixWorld();
    const size = this.renderer.getDrawingBufferSize(this.tmpSize);
    const cw = Math.max(32, Math.round(size.x * this.cloudScale)), ch = Math.max(32, Math.round(size.y * this.cloudScale));
    let resized = false;
    if (this.cloudRT.width !== cw || this.cloudRT.height !== ch) { this.cloudRT.setSize(cw, ch); resized = true; }
    U.uRes.value.set(size.x, size.y);
    camera.getWorldDirection(this.tmpV);
    this.cloudAge++;
    const turned = this.tmpV.dot(this.cloudDirLast) < 0.9995;       // about 1.8 degrees
    const moved = this.tmpV2.copy(camera.position).sub(this.cloudPosLast).lengthSq() > 25;
    if (resized || this.cloudAge >= this.cloudEvery || (this.cloudEvery > 1 && turned) || moved || W.rain > 0.1 && this.cloudAge >= 2) {
      this.cloudAge = 0; this.cloudDirLast.copy(this.tmpV); this.cloudPosLast.copy(camera.position);
      cm.uInvProj.value.copy(camera.projectionMatrixInverse); cm.uCamWorld.value.copy(camera.matrixWorld); cm.uCam.value.copy(camera.position);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.cloudRT); this.renderer.render(this.cloudScene, this.cloudCam); this.renderer.setRenderTarget(prev);
    }
    this.dome.position.copy(camera.position);
    // lights
    const cloudShade = 1 - W.cover * 0.55;
    this.sun.color.copy(sunCol).multiplyScalar(1 / Math.max(0.001, day * (0.25 + 0.75 * W.sun)));
    this.sun.intensity = 4.6 * day * W.sun * cloudShade + this.lightning * 8;
    const moonDir = this.tmpV4.copy(this.sunDir).negate().add(this.tmpMoon.set(0.25, 0.1, 0)).normalize();
    if (night > 0.5) { this.sun.color.setRGB(0.6, 0.7, 1.0); this.sun.intensity = 0.35 * (1 - W.cover * 0.8) + this.lightning * 8; }
    const ld = night > 0.5 ? moonDir : this.sunDir;
    // snap the shadow box to whole texels in light space so shadow edges do not crawl while moving
    const tex = this.shadowOn ? (2 * this.L.shadowHalf) / this.sun.shadow.mapSize.x : 1;
    const rt = this.tmpV3.set(0, 1, 0).cross(ld); if (rt.lengthSq() < 1e-6) rt.set(1, 0, 0); rt.normalize();
    const up2 = this.tmpV2.copy(ld).cross(rt);
    const fx = Math.round(focus.dot(rt) / tex) * tex - focus.dot(rt), fy = Math.round(focus.dot(up2) / tex) * tex - focus.dot(up2);
    this.sun.target.position.copy(focus).addScaledVector(rt, fx).addScaledVector(up2, fy);
    this.sun.position.copy(this.sun.target.position).addScaledVector(ld, 400);
    // three only draws a shadow map when the renderer-level flag is set as well as the light's own (autoUpdate is off), so both are raised here
    if (this.shadowOn) {
      const due = this.shadowFrame++ % this.L.shadowEvery === 0;
      const moved = focus.distanceToSquared(this.shadowFocus) > 36 || ld.dot(this.shadowLd) < 0.99998;
      if (due && (this.shadowDirty || this.shadowDynamic || moved)) {
        this.sun.shadow.needsUpdate = true; this.renderer.shadowMap.needsUpdate = true; this.shadowDraws++;
        if (moved || this.shadowDirty) { this.shadowFocus.copy(focus); this.shadowLd.copy(ld); }
        this.shadowDirty = false;
      }
    }
    this.hemi.color.copy(zen).lerp(K.white, 0.25);
    this.hemi.groundColor.setRGB(0.36, 0.28, 0.22).multiplyScalar(0.25 + 0.75 * day);
    this.hemi.intensity = 0.25 + 1.25 * day * (0.6 + 0.4 * W.cover) + night * 0.35 + this.lightning * 3;
    // fog matches the horizon
    const fogC = K.fog.copy(hor).lerp(tint, W.haze * 0.4);
    (this.scene.fog as THREE.FogExp2).color.copy(fogC); (this.scene.fog as THREE.FogExp2).density = W.fog * (1 + night * 0.4);
    this.renderer.toneMappingExposure = 0.55 + night * 0.55;
    // rain, puddles and drying
    this.wet = THREE.MathUtils.clamp(this.wet + (W.rain > 0.1 ? dt * 0.08 * W.rain : -dt * (0.004 + W.dry * 0.2 * day)), 0, 1);
    this.water = THREE.MathUtils.clamp(this.water + dt * (W.wetRate * 0.5) - dt * W.dry * 0.04 * (0.3 + day), 0, 1);
    groundShared.uWet.value = this.wet; groundShared.uWater.value = this.water; groundShared.uRain.value = W.rain; groundShared.uTime.value += dt; groundShared.uDust.value = W.dust;
    buildingShared.uWet.value = this.wet; buildingShared.uNight.value = night; buildingShared.uDust.value = W.dust;
    propShared.uNight.value = night; setPropNight(night); setSignNight(night);
    const rm = this.rain.material as THREE.LineBasicMaterial;
    rm.opacity = Math.min(0.55, W.rain * 0.4); this.rain.visible = W.rain > 0.03;
    if (this.rain.visible) {
      this.rain.position.set(camera.position.x, camera.position.y - 8, camera.position.z);
      const a = (this.rain.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array; const fall = dt * 28; const nmax = Math.floor(9000 * this.rainFrac) * 6;
      for (let i = 0; i < nmax; i += 6) { a[i + 1] -= fall; a[i + 4] -= fall; if (a[i + 1] < 0) { a[i + 1] += 34; a[i + 4] += 34; } }
      const ra = this.rain.geometry.attributes.position as THREE.BufferAttribute; ra.clearUpdateRanges(); ra.addUpdateRange(0, nmax); ra.needsUpdate = true;
    }
    if (this.target === 'storm' && Math.random() < dt * 0.1) { this.lightning = 1; this.onThunder?.(0.6 + Math.random() * 3, 0.6 + Math.random() * 0.4); }
    this.lightning = Math.max(0, this.lightning - dt * 3.5);
    if (this.lightning > 0) U.uZenith.value.lerp(K.flash, this.lightning * 0.5);
    // reflections: a small PMREM of the sky, refreshed slowly (the sky barely changes in 20 game seconds)
    this.envT += dt;
    if (this.envT > this.pmremEvery || this.envSize !== this.pmremSize) {
      this.envT = 0; this.envSize = this.pmremSize; this.envRT?.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 100, { size: this.pmremSize }); this.env = this.envRT.texture; this.scene.environment = this.env;
    }
    this.scene.environmentIntensity = 0.35 + 0.65 * day;
    return { day, night, elev, golden };
  }
}
