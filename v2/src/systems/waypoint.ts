// The waypoint you drop on the city map: the GPS routes to it before anything else, the radar points at it, and a tall
// purple beam stands over it in the world so you can see it from down the road. Arriving clears it.
import type * as THREE_NS from 'three';
import type { GameCtx, GameSystem, GoalPoint } from './registry';

export interface Waypoint { x: number; z: number; label?: string }
let routeAt = 0;
let wp: Waypoint | null = null; let beam: THREE_NS.Mesh | null = null; let ctxRef: GameCtx | null = null;
const listeners = new Set<() => void>();
export const waypoints = {
  get(): Waypoint | null { return wp; },
  set(w: Waypoint | null) {
    wp = w; listeners.forEach((f) => f());
    if (ctxRef && w) {
      // load the streets between here and there so the GPS can find a road route
      const me = ctxRef.sim.local; const P = me.vehicle !== null ? ctxRef.sim.vehicles[me.vehicle].body.translation() : me.pos;
      ctxRef.loadRoute?.(P.x, P.z, w.x, w.z); routeAt = performance.now();
      ctxRef.hud.toast('Waypoint', `${w.label ? w.label + '. ' : ''}Follow the purple line.`, 'linear-gradient(160deg,#c084fc,#7c3aed)', 'msg', 2.5);
    }
  },
  on(f: () => void) { listeners.add(f); return () => listeners.delete(f); },
};

function makeBeam(ctx: GameCtx) {
  const THREE = ctx.THREE;
  const geo = new THREE.CylinderGeometry(1.4, 1.4, 160, 20, 1, true); geo.translate(0, 80, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uT: { value: 0 }, uA: { value: 1 } },
    vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y / 160.0; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uT; uniform float uA; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float rim = 1.0 - abs(dot(vN, vV)); float a = (0.25 + 0.75 * rim) * pow(1.0 - vY, 1.6) * (0.85 + 0.15 * sin(uT * 3.0 - vY * 20.0)) * uA; gl_FragColor = vec4(vec3(0.72, 0.38, 1.0) * 1.6, a * 0.7);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 5; m.name = 'waypoint-beam'; return m;
}

export const waypointSystem: GameSystem = {
  id: 'waypoint',
  init(ctx) { ctxRef = ctx; },
  goal(): GoalPoint | null { return wp ? { x: wp.x, z: wp.z, label: wp.label ?? 'Waypoint' } : null; },
  frame(ctx, dt) {
    const me = ctx.sim.local; const veh = me.vehicle !== null ? ctx.sim.vehicles[me.vehicle].body.translation() : me.pos;
    if (wp && Math.hypot(veh.x - wp.x, veh.z - wp.z) < (me.vehicle !== null ? 30 : 18)) { ctx.hud.toast('Waypoint', 'You have arrived.', 'linear-gradient(160deg,#c084fc,#7c3aed)', 'msg', 2.5); wp = null; listeners.forEach((f) => f()); }
    if (!wp) { if (beam) beam.visible = false; return; }
    if (performance.now() - routeAt > 20_000) { routeAt = performance.now(); ctx.loadRoute?.(veh.x, veh.z, wp.x, wp.z); }
    if (!beam) { beam = makeBeam(ctx); ctx.view.scene.add(beam); }
    const d = Math.hypot(veh.x - wp.x, veh.z - wp.z);
    beam.visible = d < 2400; beam.position.set(wp.x, 0, wp.z);
    const u = (beam.material as THREE_NS.ShaderMaterial).uniforms; u.uT.value += dt; u.uA.value = Math.min(1, Math.max(0.25, (d - 8) / 60));
  },
  blips(_ctx, out) { if (wp) out.push({ x: wp.x, z: wp.z, c: '#b45cff', r: 12 }); },
};
