// Shared materials. Buildings, roads and the race surface are standard PBR materials with small shader additions:
// atlas tiling and night windows for facades, painted and faded markings for roads, wet sheen when it rains.
import * as THREE from 'three';
import * as T from './textures';

export interface MatContext { aniso: number; night: number; wet: number }

const uniformsShared = {
  uNight: { value: 0 },
  uWet: { value: 0 },
  uTime: { value: 0 },
};
export function setWorldUniforms(night: number, wet: number, time: number) {
  uniformsShared.uNight.value = night; uniformsShared.uWet.value = wet; uniformsShared.uTime.value = time;
}

const NOISE_GLSL = /* glsl */ `
float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rHash(i), rHash(i + vec2(1, 0)), f.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), f.x), f.y); }
`;

export class Materials {
  facade!: THREE.MeshStandardMaterial;
  roofTin!: THREE.MeshStandardMaterial;
  roofFlat!: THREE.MeshStandardMaterial;
  road!: THREE.MeshStandardMaterial;
  track!: THREE.MeshStandardMaterial;
  ground!: THREE.MeshStandardMaterial;
  grass!: THREE.MeshStandardMaterial;
  paving!: THREE.MeshStandardMaterial;
  concrete!: THREE.MeshStandardMaterial;
  concreteDark!: THREE.MeshStandardMaterial;
  kerb!: THREE.MeshStandardMaterial;
  hazardStripe!: THREE.MeshStandardMaterial;
  glassT3!: THREE.MeshPhysicalMaterial;
  perforated!: THREE.MeshStandardMaterial;
  louvres!: THREE.MeshStandardMaterial;
  steel!: THREE.MeshStandardMaterial;
  steelLight!: THREE.MeshStandardMaterial;
  whiteRoof!: THREE.MeshStandardMaterial;
  blueFence!: THREE.MeshStandardMaterial;
  meshRail!: THREE.MeshStandardMaterial;
  rail!: THREE.MeshStandardMaterial;
  ballast!: THREE.MeshStandardMaterial;
  wood!: THREE.MeshStandardMaterial;
  vertexLit!: THREE.MeshStandardMaterial;
  emissive!: THREE.MeshBasicMaterial;
  textures: Record<string, THREE.Texture> = {};

  build(aniso: number) {
    const A = (c: T.Canvas, srgb = true) => T.tex(c, { aniso, srgb });
    const asph = T.asphalt(1024, 3);
    const asphMap = A(asph.map), asphRough = A(asph.rough, false), asphNorm = A(asph.normal, false);
    const atlas = T.facadeAtlas(2048, 11);
    const facadeMap = T.tex(atlas.col, { aniso, repeat: false });
    const facadeMask = T.tex(atlas.mask, { aniso: 1, repeat: false, srgb: false });
    const tin = T.corrugated(512, 6);
    this.textures = { asphMap, facadeMap, facadeMask };

    this.facade = new THREE.MeshStandardMaterial({ map: facadeMap, roughness: 0.92, metalness: 0, vertexColors: true });
    this.facade.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = uniformsShared.uNight; sh.uniforms.uMask = { value: facadeMask }; sh.uniforms.uWet = uniformsShared.uWet;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec2 cell; attribute float seed; varying vec2 vCell; varying vec2 vRaw; varying float vSeed; varying float vY;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
vCell = cell; vRaw = uv; vSeed = seed; vY = (modelMatrix * vec4(position, 1.0)).y;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uNight; uniform sampler2D uMask; uniform float uWet; varying vec2 vCell; varying vec2 vRaw; varying float vSeed; varying float vY;
${NOISE_GLSL}`)
        .replace('#include <map_fragment>', `
vec2 fr = fract(vRaw);
vec2 auv = (vCell + 0.012 + fr * 0.976) / 8.0;
vec2 gdx = dFdx(vRaw) / 8.0, gdy = dFdy(vRaw) / 8.0;
vec4 tcol = textureGrad(map, auv, gdx, gdy);
vec3 msk = textureGrad(uMask, auv, gdx, gdy).rgb;
vec3 paint = vColor.rgb;
// sun-faded paint and rain streaks, different on every building
float grime = rNoise(vRaw * vec2(0.7, 0.35) + vSeed * 7.0) * 0.5 + rNoise(vRaw * vec2(3.0, 0.6) + vSeed) * 0.5;
paint *= mix(0.78, 1.04, grime);
vec3 base = mix(tcol.rgb, tcol.rgb * paint, msk.r);
// splash band of red earth at the foot of every wall
base = mix(base, base * vec3(0.72, 0.52, 0.4), smoothstep(0.7, 0.0, vY) * 0.55);
diffuseColor.rgb *= base;`)
        .replace('#include <color_fragment>', '')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float cellId = floor(vRaw.x) * 7.13 + floor(vRaw.y) * 19.7 + vSeed * 131.0;
float lit = step(0.52, rHash(vec2(cellId, vSeed))) * uNight;
vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.88, 1.0), step(0.75, rHash(vec2(vSeed, cellId + 3.0))));
totalEmissiveRadiance += warm * msk.g * lit * 1.6;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.15, msk.g * 0.85);`);
    };

    const tinMap = A(tin.map), tinNorm = A(tin.normal, false);
    this.roofTin = new THREE.MeshStandardMaterial({ map: tinMap, normalMap: tinNorm, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.55, metalness: 0.55, vertexColors: true });
    this.roofFlat = new THREE.MeshStandardMaterial({ map: A(T.concrete(512, 21, '#8a8680')), roughness: 0.95, vertexColors: true });

    const roadShader = (sh: THREE.WebGLProgramParametersWithUniforms, race: boolean) => {
      sh.uniforms.uWet = uniformsShared.uWet; sh.uniforms.uNight = uniformsShared.uNight;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 lane; varying vec4 vLane; varying vec2 vWorld;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
vLane = lane; vWorld = (modelMatrix * vec4(position, 1.0)).xz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uWet; uniform float uNight; varying vec4 vLane; varying vec2 vWorld;
${NOISE_GLSL}`)
        .replace('#include <map_fragment>', `
vec4 tcol = texture2D(map, vWorld / 9.0);
vec3 base = tcol.rgb;
// lane: x = lateral metres, y = half width, z = lanes, w = flags (1 two way, 2 fade near junction ends)
float lat = vLane.x, hw = vLane.y;
float fade = clamp(vLane.w, 0.0, 1.0);
float wear = smoothstep(0.25, 0.75, rNoise(vWorld * 0.35)) * 0.6 + 0.4;
float paintA = 0.0; vec3 paintC = vec3(0.92, 0.9, 0.84);
float edge = smoothstep(0.08, 0.03, abs(abs(lat) - (hw - 0.45)));
paintA = max(paintA, edge);
${race ? `
// race surface: centre dashes plus chevron hints come from geometry; add tyre rubber in the racing groove
float dash = step(0.5, fract(vLane.z / 9.0));
float centre = smoothstep(0.1, 0.05, abs(lat)) * dash;
paintA = max(paintA, centre * 0.9);
float groove = smoothstep(hw * 0.6, 0.0, abs(lat - sin(vLane.z * 0.004) * hw * 0.3));
base *= 1.0 - groove * 0.18;` : `
float lanes = max(1.0, vLane.z);
float lw = (hw * 2.0 - 1.0) / lanes;
float k = (lat + hw - 0.5) / lw;
float divider = smoothstep(0.06, 0.02, abs(fract(k + 0.5) - 0.5) * lw) * step(0.5, k) * step(k, lanes - 0.5);
float along = dot(vWorld, vec2(0.7071, 0.7071));
divider *= step(0.45, fract(along / 8.0));
paintA = max(paintA, divider * 0.85);`}
paintA *= wear * fade;
base = mix(base, paintC, paintA);
// dusty edges where the asphalt meets laterite
base = mix(base, base * vec3(1.18, 0.95, 0.78), smoothstep(hw - 1.6, hw, abs(lat)) * 0.5);
diffuseColor.rgb *= base;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float puddle = smoothstep(0.55, 0.7, rNoise(vWorld * 0.08)) * uWet;
roughnessFactor = mix(roughnessFactor, 0.08, max(uWet * 0.55, puddle));
diffuseColor.rgb *= 1.0 - uWet * 0.35 - puddle * 0.2;`);
    };

    this.road = new THREE.MeshStandardMaterial({ map: asphMap, roughnessMap: asphRough, normalMap: asphNorm, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.9, metalness: 0 });
    this.road.onBeforeCompile = (sh) => roadShader(sh, false);
    this.road.polygonOffset = true; this.road.polygonOffsetFactor = -1; this.road.polygonOffsetUnits = -2;
    this.track = new THREE.MeshStandardMaterial({ map: asphMap, roughnessMap: asphRough, normalMap: asphNorm, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.85, metalness: 0 });
    this.track.onBeforeCompile = (sh) => roadShader(sh, true);
    this.track.polygonOffset = true; this.track.polygonOffsetFactor = -2; this.track.polygonOffsetUnits = -6;

    const lat = A(T.laterite(512, 3)); lat.repeat.set(1, 1);
    this.ground = new THREE.MeshStandardMaterial({ map: lat, roughness: 1 });
    this.grass = new THREE.MeshStandardMaterial({ map: A(T.grass(512, 4)), roughness: 1 });
    this.paving = new THREE.MeshStandardMaterial({ map: A(T.paving(512, 5)), roughness: 0.9 });
    const conc = A(T.concrete(512, 2));
    this.concrete = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.88, side: THREE.DoubleSide });
    this.concreteDark = new THREE.MeshStandardMaterial({ map: A(T.concrete(512, 9, '#7d7a74')), roughness: 0.9 });
    this.kerb = new THREE.MeshStandardMaterial({ map: A(T.stripes('#f0f0ea', '#151515', 4)), roughness: 0.7, side: THREE.DoubleSide });
    this.hazardStripe = new THREE.MeshStandardMaterial({ map: A(T.stripes('#f2c230', '#141414', 5)), roughness: 0.6 });
    const gl = T.curtainGlass(512, 7);
    this.glassT3 = new THREE.MeshPhysicalMaterial({ map: A(gl.map), roughness: 0.06, metalness: 0.6, envMapIntensity: 1.4, clearcoat: 0.5 });
    this.perforated = new THREE.MeshStandardMaterial({ map: A(T.perforated(512, 8)), roughness: 0.45, metalness: 0.55 });
    this.louvres = new THREE.MeshStandardMaterial({ map: A(T.louvres(256, 9)), roughness: 0.5, metalness: 0.6 });
    this.steel = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.45, metalness: 0.75, side: THREE.DoubleSide });
    this.steelLight = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.8 });
    this.whiteRoof = new THREE.MeshStandardMaterial({ color: 0xe8ecee, roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide });
    this.blueFence = new THREE.MeshStandardMaterial({ color: 0x1f4fa8, roughness: 0.6, metalness: 0.3 });
    const railTex = T.tex(T.meshPanel('#2a5ab8'), { aniso });
    this.meshRail = new THREE.MeshStandardMaterial({ map: railTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 });
    this.rail = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.3, metalness: 0.9 });
    this.ballast = new THREE.MeshStandardMaterial({ map: A(T.concrete(256, 31, '#6a645c')), roughness: 1 });
    this.wood = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.85 });
    this.vertexLit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide });
    this.emissive = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  }
}
