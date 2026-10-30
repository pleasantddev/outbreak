// Ground shader: reads a tile's road field and paints asphalt, faded markings, kerbs, walkways, open drains,
// laterite, grass, compounds and potholes that fill with water when it rains. PBR through MeshStandardMaterial.
import * as THREE from 'three';
import type { TexSet } from './texsets';
import { lampShared, LAMP_GLSL } from './lamps';

export const groundShared = {
  uWet: { value: 0 },      // surface wetness 0..1 (rain)
  uWater: { value: 0.25 }, // how full potholes and drains are 0..1 (slow: fills in rain, dries in sun and harmattan)
  uTime: { value: 0 },
  uRain: { value: 0 },
  uDust: { value: 0 },     // harmattan dust film
};

const common = /* glsl */ `
uniform sampler2D uField; uniform sampler2D uDetail; uniform vec3 uTile;
uniform highp sampler2DArray uGD; uniform highp sampler2DArray uGN; uniform highp sampler2DArray uGA;
uniform float uWet; uniform float uWater; uniform float uTime; uniform float uRain; uniform float uDust;
varying vec3 vWP;
float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ return gn(p) * 0.55 + gn(p * 2.03 + 7.1) * 0.28 + gn(p * 4.1 + 3.3) * 0.17; }
struct Surf { vec3 col; vec3 nrm; float rough; float ao; float wetk; };
vec3 tsN(vec3 t){ vec3 n = t * 2.0 - 1.0; return normalize(vec3(n.x, n.z, -n.y)); }
Surf sampleL(float layer, vec2 uv){
  Surf s; vec3 a = texture(uGA, vec3(uv, layer)).rgb;
  s.col = texture(uGD, vec3(uv, layer)).rgb; s.nrm = tsN(texture(uGN, vec3(uv, layer)).rgb); s.ao = a.r; s.rough = a.g; s.wetk = 1.0; return s;
}
Surf mixS(Surf a, Surf b, float k){ Surf s; s.col = mix(a.col, b.col, k); s.nrm = normalize(mix(a.nrm, b.nrm, k)); s.rough = mix(a.rough, b.rough, k); s.ao = mix(a.ao, b.ao, k); s.wetk = mix(a.wetk, b.wetk, k); return s; }
float vergeOf(float cls){ return (cls <= 4.0 || cls == 9.0 || cls == 10.0) ? 4.6 : (cls == 5.0 || cls == 6.0) ? 2.4 : cls == 7.0 ? 1.2 : 0.6; }
Surf ground(vec3 wp, out float waterOut){
  vec2 uv = (wp.xz - uTile.xy) / uTile.z;
  vec4 F = texture(uField, uv); vec4 D = texture(uDetail, uv);
  float e = F.r, lat = F.g, s = F.b, code = F.a;
  float cls = mod(code, 16.0), unp = mod(floor(code / 16.0), 2.0), one = mod(floor(code / 32.0), 2.0), lanes = max(1.0, floor(code / 64.0));
  float cov = D.r * 4.0, ph = D.g, pid = D.b, surf = floor(D.a * 255.0 + 0.5);
  vec2 w = vec2(wp.x, -wp.z);
  float macro = fbm(w * 0.045), micro = fbm(w * 0.6);
  // ---------------- open ground
  Surf soil = sampleL(3.0, w / 3.2);
  { float l = dot(soil.col, vec3(0.3, 0.59, 0.11)); soil.col = mix(vec3(l), soil.col, 0.55) * vec3(1.05, 0.95, 0.85); }
  soil.col *= mix(0.72, 1.1, macro);
  Surf dust = sampleL(7.0, w / 3.5); dust.col = mix(dust.col, vec3(0.55, 0.47, 0.38), 0.45);
  soil = mixS(soil, dust, smoothstep(0.35, 0.75, fbm(w * 0.03 + 21.0)) * 0.6);
  Surf grass = sampleL(4.0, w / 4.5);
  grass.col *= vec3(0.86, 0.98, 0.78) * mix(0.75, 1.1, micro);
  float gmask = smoothstep(0.52, 0.72, fbm(w * 0.09 + 11.0));
  Surf g = soil; float lagoon = 0.0;
  if (surf < 10.0) g = mixS(soil, grass, gmask * 0.85);
  else if (surf < 25.0) g = mixS(grass, soil, smoothstep(0.62, 0.8, macro) * 0.6);
  else if (surf < 35.0) g = mixS(grass, soil, 0.25);
  else if (surf < 50.0) { g = mixS(grass, soil, 0.35); g.col *= 0.8; }
  else if (surf < 65.0) g = sampleL(7.0, w / 3.0);
  else if (surf < 80.0) { g = mixS(sampleL(1.0, w / 4.0), soil, 0.35); g.col *= 0.85; }
  else if (surf < 95.0) { g = mixS(soil, sampleL(7.0, w / 2.5), smoothstep(0.45, 0.6, fbm(w * 0.06 + 5.0)) * 0.8); g.col = mix(g.col, vec3(0.64, 0.56, 0.47), 0.3); }
  else if (surf < 110.0) g = sampleL(6.0, w / 2.4);
  else if (surf < 130.0) g = sampleL(1.0, w / 4.0);
  else if (surf < 150.0) g = sampleL(5.0, w / 3.0);
  else if (surf < 190.0) { g = soil; g.col = mix(g.col, vec3(0.78, 0.66, 0.52), 0.4); }
  else if (surf < 215.0) { g = soil; g.col = vec3(0.06, 0.11, 0.1); lagoon = 1.0; }
  else { // mechanic village: packed earth soaked in engine oil
    g = mixS(soil, sampleL(5.0, w / 3.0), 0.5); float oil = smoothstep(0.38, 0.62, fbm(w * 0.22 + 31.0));
    g.col = mix(g.col * 0.7, vec3(0.045, 0.04, 0.035), oil * 0.85); g.rough = mix(g.rough, 0.3, oil); }
  g.wetk = 1.2;
  float water = lagoon;
  Surf o = g;
  bool road = e < 60.0;
  if (road) {
    float vg = vergeOf(cls);
    if (e < 0.0) {
      // ---------------- carriageway
      if (cls == 13.0 || cls == 14.0) { o = sampleL(2.0, w / 2.0); }
      else if (unp > 0.5 || cls == 12.0) {
        o = mixS(soil, sampleL(5.0, w / 3.0), 0.25 + 0.4 * smoothstep(0.55, 0.8, macro));
        float hw = abs(lat) - e;
        float rut = smoothstep(0.55, 0.0, abs(abs(lat) - hw * 0.42));
        o.col *= 1.0 - rut * 0.18; o.rough = mix(o.rough, 0.95, 0.5);
        water = max(water, smoothstep(0.62, 0.78, fbm(w * 0.18 + 3.0)) * rut * uWater * 1.4);
      } else {
        Surf asph = sampleL(0.0, w / 4.0);
        Surf old = sampleL(1.0, w / 4.5);
        float wear = (cls >= 7.0) ? 0.55 + 0.45 * macro : smoothstep(0.55, 0.85, macro) * 0.7;
        o = mixS(asph, old, wear);
        o.col *= mix(0.82, 1.06, fbm(w * 0.02 + 5.0));
        // tyre polish in the wheel paths of busy roads
        if (cls <= 6.0) { float lw = 3.3; float pos = mod(lat + 100.0 * lw, lw) / lw; float track = smoothstep(0.18, 0.0, abs(pos - 0.28)) + smoothstep(0.18, 0.0, abs(pos - 0.72)); o.col *= 1.0 - track * 0.08; o.rough -= track * 0.12; }
        // ---------------- markings (faded, broken)
        if ((cls <= 6.0 || cls == 9.0 || cls == 10.0) && cov < 1.2) {
          float hw = abs(lat) - e;
          float paint = 0.0; vec3 pc = vec3(0.92, 0.91, 0.86);
          float aa = fwidth(lat) * 1.2 + 0.01;
          if (cls <= 5.0 || cls == 9.0) {
            paint += 1.0 - smoothstep(0.06 - aa, 0.06 + aa, abs(e + 0.45));
          }
          if (one < 0.5 && lanes >= 2.0 && cls != 7.0) {
            float dash = cls <= 3.0 ? 1.0 : step(fract(s / 9.0), 0.5);
            paint += (1.0 - smoothstep(0.07 - aa, 0.07 + aa, abs(lat))) * dash;
          }
          float perDir = one > 0.5 ? lanes : floor(lanes / 2.0);
          if (perDir >= 2.0) {
            float lw = (one > 0.5 ? 2.0 * hw : hw) / perDir;
            float base = one > 0.5 ? lat + hw : abs(lat);
            float k = base / lw; float fk = abs(fract(k + 0.5) - 0.5) * lw;
            float inner = step(0.6, k) * step(k, perDir - 0.6);
            paint += (1.0 - smoothstep(0.06 - aa, 0.06 + aa, fk)) * inner * step(fract(s / 9.0), 0.35);
          }
          paint = clamp(paint, 0.0, 1.0) * smoothstep(0.25, 0.6, fbm(w * 0.7 + 2.0)) * (0.55 + 0.45 * smoothstep(0.3, 0.7, macro));
          if (cls <= 2.0) pc = mix(pc, vec3(0.92, 0.74, 0.2), step(0.0, -e - 0.3) * (1.0 - step(0.0, -e - 0.6)));
          o.col = mix(o.col, pc, paint * 0.85); o.rough = mix(o.rough, 0.55, paint);
        }
        // ---------------- potholes
        if (ph > 0.01) {
          Surf cr = mixS(sampleL(3.0, w / 1.5), sampleL(5.0, w / 2.0), 0.5);
          cr.col *= 0.55;
          float rim = smoothstep(0.0, 0.25, ph) * (1.0 - smoothstep(0.25, 0.6, ph));
          o = mixS(o, cr, smoothstep(0.02, 0.3, ph));
          o.col *= 1.0 - rim * 0.25;
          vec2 gph = vec2(dFdx(ph), dFdy(ph)) / max(fwidth(wp.xz), vec2(0.001)) * 0.6;
          o.nrm = normalize(o.nrm + vec3(gph.x, 0.0, gph.y) * 3.0);
          float fill = clamp(uWater * (0.7 + 0.6 * pid), 0.0, 1.0);
          water = max(water, smoothstep(1.0 - fill, 1.0 - fill + 0.06, ph));
        }
      }
    } else if (e < vg) {
      // ---------------- verge: kerb, walkway, open drain
      if (vg > 4.0) {
        if (e < 0.28) { o = sampleL(7.0, w / 1.5); o.col = mix(o.col, mod(floor(s / 1.0), 2.0) > 0.5 ? vec3(0.9, 0.78, 0.2) : vec3(0.08), 0.55 * smoothstep(0.3, 0.6, macro)); o.nrm = normalize(vec3(0.0, 1.0, 0.0) + vec3(0.0, 0.0, 0.0)); }
        else if (e < vg - 1.05) { o = sampleL(2.0, w / 2.2); o.col *= mix(0.8, 1.05, micro); }
        else if (e < vg - 0.15) { o = sampleL(7.0, w / 1.2); float x = (e - (vg - 1.05)) / 0.9; float depthLook = sin(x * 3.14159); o.col *= 0.35 + 0.3 * (1.0 - depthLook); o.ao *= 0.5; water = max(water, step(0.3, x) * step(x, 0.7) * smoothstep(0.1, 0.4, uWater + 0.15)); }
        else { o = sampleL(7.0, w / 1.2); }
      } else if (vg > 2.0) {
        if (e < 0.2) { o = sampleL(7.0, w / 1.5); }
        else if (e < 1.4) { o = sampleL(2.0, w / 2.2); }
        else if (e < 2.2) { o = sampleL(7.0, w / 1.2); float x = (e - 1.4) / 0.8; o.col *= 0.4 + 0.3 * (1.0 - sin(x * 3.14159)); water = max(water, step(0.35, x) * step(x, 0.65) * smoothstep(0.1, 0.4, uWater + 0.1)); }
        else o = mixS(g, sampleL(7.0, w / 1.2), 0.4);
      } else if (vg > 1.0 && unp < 0.5) {
        float x = e / 0.9;
        if (x < 1.0) { o = sampleL(7.0, w / 1.2); o.col *= 0.55 + 0.35 * abs(x - 0.5) * 2.0; water = max(water, (1.0 - smoothstep(0.0, 0.2, abs(x - 0.5))) * uWater); }
      }
    }
  }
  // wet season puddles on hard surfaces, and the general darkening
  float pud = smoothstep(0.62, 0.72, fbm(w * 0.11 + 9.0)) * smoothstep(0.35, 0.9, uWet);
  if (road && e < 0.0) water = max(water, pud * 0.9);
  float wet = uWet * o.wetk;
  o.col *= mix(1.0, 0.58, clamp(wet, 0.0, 1.0));
  o.rough = mix(o.rough, 0.25, clamp(wet * 0.75, 0.0, 1.0));
  // harmattan dust film
  o.col = mix(o.col, vec3(0.62, 0.5, 0.38), uDust * 0.25);
  // standing water: murky brown mirror with rain rings
  if (water > 0.02) {
    vec3 wc = lagoon > 0.5 ? mix(vec3(0.045, 0.1, 0.095), vec3(0.11, 0.19, 0.16), fbm(w * 0.04 + uTime * 0.01)) : vec3(0.10, 0.085, 0.06);
    float ring = 0.0;
    if (uRain > 0.05) { vec2 cell = floor(w * 2.0); vec2 f = fract(w * 2.0) - 0.5; float ph2 = fract(gh(cell) + uTime * 0.9); ring = smoothstep(0.05, 0.0, abs(length(f) - ph2 * 0.5)) * (1.0 - ph2) * uRain; }
    o.col = mix(o.col, wc, water * 0.9);
    o.rough = mix(o.rough, 0.03, water);
    o.nrm = normalize(mix(o.nrm, vec3(0.0, 1.0, 0.0), water) + vec3(ring * 0.3, 0.0, ring * 0.2));
    if (lagoon > 0.5) { vec2 rp = w * 0.12 + vec2(uTime * 0.04, uTime * 0.03); float fz = 1.0 / (1.0 + length(vWP - cameraPosition) * 0.004); o.nrm = normalize(vec3(((gn(rp) - 0.5) * 0.16 + (gn(rp * 3.1 - uTime * 0.08) - 0.5) * 0.06) * fz, 1.0, ((gn(rp + 17.0) - 0.5) * 0.16 + (gn(rp * 2.7 + 5.0) - 0.5) * 0.06) * fz)); o.rough = 0.06; }
  }
  waterOut = water;
  return o;
}`;

export function makeGroundMaterial(tex: TexSet) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = { uField: { value: null as THREE.Texture | null }, uDetail: { value: null as THREE.Texture | null }, uTile: { value: new THREE.Vector3() }, uGD: { value: tex.diff }, uGN: { value: tex.nor }, uGA: { value: tex.arm }, ...groundShared, ...lampShared };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + common + LAMP_GLSL + '\nSurf GS; float GW;')
      .replace('#include <map_fragment>', 'GS = ground(vWP, GW); diffuseColor.rgb = GS.col;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(GS.rough, 0.03, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(GS.nrm, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= GS.ao; reflectedLight.indirectSpecular *= mix(GS.ao, 1.0, GW);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += lampLight(vWP, GS.nrm) * diffuseColor.rgb * (1.0 - GW * 0.7);');
  };
  m.customProgramCacheKey = () => 'hl-ground';
  (m as any).hlUniforms = uniforms;
  return m;
}
