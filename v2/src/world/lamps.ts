// Street light pools for the facade and ground shaders: the nearest lamps are passed as uniforms, so sodium light falls on the road, the walls and the
// pavement without one point light (paid by every lit pixel) per lamp.
import * as THREE from 'three';

export const MAX_LAMPS = 12;
export const lampShared = { uLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, 0, 0, 0)) } };

/** GLSL: lampLight(world position, world normal) returns the warm light arriving from the lamps (multiply by albedo). */
export const LAMP_GLSL = /* glsl */ `
uniform vec4 uLamps[${MAX_LAMPS}];
vec3 lampLight(vec3 P, vec3 N){
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    vec4 L = uLamps[i]; if (L.w <= 0.001) break;
    vec3 d = vec3(L.x, 8.4, L.z) - P; float r2 = dot(d, d);
    float fall = smoothstep(26.0 * 26.0, 5.0 * 5.0, r2);
    float ndl = max(dot(N, d * inversesqrt(r2)), 0.0);
    // a sodium lamp throws a cone down and out: weaker towards the horizon
    float cone = smoothstep(0.1, 0.6, normalize(d).y);
    acc += vec3(1.0, 0.64, 0.32) * (L.w * fall * ndl * (0.3 + 0.7 * cone) / (1.0 + r2 * 0.02));
  }
  return acc;
}`;

/** About one lamp in ten is solar and stays lit when its feeder is off. Same hash on the GPU (props.ts) so a lamp head and its light pool agree. */
export function solarLamp(x: number, z: number) { const v = Math.sin(Math.floor(x / 8) * 12.9898 + Math.floor(z / 8) * 78.233) * 43758.5453; return v - Math.floor(v) < 0.1; }
export const SOLAR_GLSL = /* glsl */ `float solarLamp(vec2 p){ return step(fract(sin(dot(floor(p / 8.0), vec2(12.9898, 78.233))) * 43758.5453), 0.1); }`;
