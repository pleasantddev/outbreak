// Sky, sun, fog and reflections for each time of day and weather. Lagos sits six degrees north of the equator, so
// the noon sun is nearly overhead; harmattan swaps blue sky for a flat dusty haze.
import * as THREE from 'three';
import type { TimeOfDay, Weather } from '../shared/race';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const skyFrag = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform float uSunSize; uniform float uHaze; uniform float uClouds; uniform float uTime; uniform float uStars; uniform vec3 uCloudColor;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.08, h));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 64.0) * 0.5) * (1.0 - uHaze * 0.5);
  col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.6, sd) * (1.0 - uHaze * 0.7) * 3.0;
  // clouds: a flat layer projected onto the dome
  if (h > 0.0 && uClouds > 0.0) {
    vec2 cp = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = smoothstep(0.52 - uClouds * 0.3, 0.85, fbm(cp));
    vec3 cc = uCloudColor * (0.75 + 0.35 * fbm(cp * 2.0 + 5.0)) + uSunColor * pow(sd, 4.0) * 0.25;
    col = mix(col, cc, c * smoothstep(0.0, 0.12, h) * 0.92);
  }
  if (uStars > 0.0 && h > 0.0) {
    vec2 sp = floor(d.xz / (h + 0.3) * 260.0);
    float st = step(0.996, hash(sp)) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(sp + 3.0) * 30.0));
    col += vec3(st) * uStars * smoothstep(0.05, 0.4, h);
  }
  col = mix(col, uHorizon, uHaze * (1.0 - smoothstep(0.0, 0.5, h)) * 0.85);
  gl_FragColor = vec4(col, 1.0);
}`;

export interface AtmosPreset {
  top: number; horizon: number; ground: number; sunColor: number; sunInt: number; sunElev: number; sunAz: number;
  hemiSky: number; hemiGround: number; hemiInt: number; fog: number; fogNear: number; fogFar: number;
  haze: number; clouds: number; cloudColor: number; stars: number; night: number; exposure: number;
}

const TIMES: Record<TimeOfDay, AtmosPreset> = {
  morning: { top: 0x5d9be0, horizon: 0xf3d2a6, ground: 0x6a5a48, sunColor: 0xffd6a0, sunInt: 2.6, sunElev: 0.32, sunAz: 1.35, hemiSky: 0xbcd4f0, hemiGround: 0x8a6a4a, hemiInt: 1.0, fog: 0xe8d4b8, fogNear: 200, fogFar: 1.15, haze: 0.25, clouds: 0.45, cloudColor: 0xfff2e2, stars: 0, night: 0, exposure: 1.0 },
  noon: { top: 0x3f86de, horizon: 0xcfe2f2, ground: 0x7a6650, sunColor: 0xfff6ea, sunInt: 3.4, sunElev: 1.25, sunAz: 0.4, hemiSky: 0xcfe2ff, hemiGround: 0x9a7a5a, hemiInt: 1.15, fog: 0xc9dbe8, fogNear: 260, fogFar: 1.25, haze: 0.12, clouds: 0.55, cloudColor: 0xffffff, stars: 0, night: 0, exposure: 0.95 },
  dusk: { top: 0x2a3a78, horizon: 0xff9a5a, ground: 0x3a2a26, sunColor: 0xff9050, sunInt: 2.3, sunElev: 0.12, sunAz: -1.25, hemiSky: 0x8a7ab8, hemiGround: 0x5a3a2a, hemiInt: 0.85, fog: 0xd88a68, fogNear: 120, fogFar: 0.9, haze: 0.35, clouds: 0.5, cloudColor: 0xff9e8a, stars: 0.05, night: 0.45, exposure: 1.05 },
  night: { top: 0x050914, horizon: 0x1c2438, ground: 0x08080a, sunColor: 0x8aa4ff, sunInt: 0.35, sunElev: 0.9, sunAz: 2.2, hemiSky: 0x2a3a66, hemiGround: 0x140e0c, hemiInt: 0.45, fog: 0x10141e, fogNear: 90, fogFar: 0.75, haze: 0.2, clouds: 0.25, cloudColor: 0x2a3040, stars: 1, night: 1, exposure: 1.15 },
};

function weatherize(p: AtmosPreset, w: Weather): AtmosPreset {
  const o = { ...p };
  const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
  if (w === 'harmattan') {
    // fine Saharan dust: flat beige sky, a dim orange disc of a sun, short sight lines
    const t = p.night > 0.9 ? 0.4 : 0.85;
    o.top = mix(p.top, 0xc9b28a, t); o.horizon = mix(p.horizon, 0xd8c09a, t); o.fog = mix(p.fog, p.night > 0.9 ? 0x2a241c : 0xcdb48c, t);
    o.sunColor = mix(p.sunColor, 0xffb070, 0.5); o.sunInt *= 0.7; o.hemiInt *= 1.05; o.haze = 0.85; o.clouds = 0.05; o.fogNear = 40; o.fogFar = 0.42;
    o.hemiSky = mix(p.hemiSky, 0xd8c4a0, 0.6); o.stars *= 0.2;
  } else if (w === 'rain') {
    o.top = mix(p.top, 0x3a4048, 0.85); o.horizon = mix(p.horizon, 0x6a7078, 0.8); o.fog = mix(p.fog, p.night > 0.9 ? 0x101418 : 0x707880, 0.8);
    o.sunInt *= 0.35; o.hemiInt *= 0.9; o.haze = 0.6; o.clouds = 1; o.cloudColor = mix(p.cloudColor, 0x50565e, 0.8); o.fogNear = 60; o.fogFar = 0.55; o.stars = 0;
    o.night = Math.max(o.night, 0.35);
  }
  return o;
}

export class Atmosphere {
  sky: THREE.Mesh;
  sun = new THREE.DirectionalLight(0xffffff, 2);
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  preset!: AtmosPreset;
  night = 0;
  wet = 0;
  time: TimeOfDay = 'dusk';
  weather: Weather = 'clear';
  private skyMat: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private sunTarget = new THREE.Object3D();
  sunDir = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSunSize: { value: 0.0006 },
        uHaze: { value: 0 }, uClouds: { value: 0.4 }, uTime: { value: 0 }, uStars: { value: 0 }, uCloudColor: { value: new THREE.Color() },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.scale.setScalar(2000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky, this.sun, this.hemi, this.sunTarget);
    this.sun.target = this.sunTarget;
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  set(time: TimeOfDay, weather: Weather, drawDistance: number, reflections: boolean) {
    this.time = time; this.weather = weather;
    const p = weatherize(TIMES[time], weather);
    this.preset = p;
    this.night = p.night;
    this.wet = weather === 'rain' ? 1 : 0;
    const u = this.skyMat.uniforms;
    u.uTop.value.set(p.top); u.uHorizon.value.set(p.horizon); u.uGround.value.set(p.ground); u.uSunColor.value.set(p.sunColor);
    u.uHaze.value = p.haze; u.uClouds.value = p.clouds; u.uStars.value = p.stars; u.uCloudColor.value.set(p.cloudColor);
    u.uSunSize.value = time === 'night' ? 0.0004 : 0.0008;
    this.sunDir.set(Math.cos(p.sunAz) * Math.cos(p.sunElev), Math.sin(p.sunElev), Math.sin(p.sunAz) * Math.cos(p.sunElev)).normalize();
    u.uSunDir.value.copy(this.sunDir);
    this.sun.color.set(p.sunColor); this.sun.intensity = p.sunInt;
    this.hemi.color.set(p.hemiSky); this.hemi.groundColor.set(p.hemiGround); this.hemi.intensity = p.hemiInt;
    const far = Math.max(220, drawDistance * p.fogFar);
    this.scene.fog = new THREE.Fog(p.fog, Math.min(p.fogNear, far * 0.4), far);
    this.scene.background = null;
    this.renderer.toneMappingExposure = p.exposure;
    this.buildEnv(reflections);
  }

  private buildEnv(on: boolean) {
    this.envRT?.dispose();
    this.envRT = null;
    if (!on) { this.scene.environment = null; return; }
    const envScene = new THREE.Scene();
    const sky = new THREE.Mesh(this.sky.geometry, this.skyMat);
    sky.scale.setScalar(100);
    envScene.add(sky);
    // a hint of a city skyline in the reflections so paint does not mirror an empty horizon
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(90, 90, 14, 48, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.preset.fog).multiplyScalar(0.45), side: THREE.BackSide }));
    ring.position.y = 2;
    envScene.add(ring);
    this.envRT = this.pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this.night > 0.9 ? 0.35 : 0.85;
  }

  /** Keep the sun's shadow box centred on the action. */
  follow(x: number, y: number, z: number, shadowSize: number, mapSize: number, t: number) {
    this.sky.position.set(x, 0, z);
    this.skyMat.uniforms.uTime.value = t;
    const d = 160;
    this.sun.position.set(x + this.sunDir.x * d, y + this.sunDir.y * d, z + this.sunDir.z * d);
    this.sunTarget.position.set(x, y, z);
    if (mapSize > 0) {
      this.sun.castShadow = true;
      const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
      if (cam.right !== shadowSize || this.sun.shadow.mapSize.x !== mapSize) {
        cam.left = -shadowSize; cam.right = shadowSize; cam.top = shadowSize; cam.bottom = -shadowSize; cam.near = 10; cam.far = 400;
        cam.updateProjectionMatrix();
        this.sun.shadow.mapSize.set(mapSize, mapSize);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
        this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
      }
      // snap to texels so shadows do not shimmer as the camera moves
      const texel = (shadowSize * 2) / mapSize;
      this.sun.position.x = Math.round(this.sun.position.x / texel) * texel;
      this.sun.position.z = Math.round(this.sun.position.z / texel) * texel;
      this.sunTarget.position.x = this.sun.position.x - this.sunDir.x * d;
      this.sunTarget.position.z = this.sun.position.z - this.sunDir.z * d;
    } else this.sun.castShadow = false;
  }
}
