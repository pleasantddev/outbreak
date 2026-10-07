// Particles and skid marks. One instanced quad system covers tyre smoke, laterite dust, drift sparks in the three
// Gbedu colours, boost flames, rain spray, sachet bursts, pothole grit, rocket trails and finish confetti.
import * as THREE from 'three';

const vert = /* glsl */ `
attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSize; // size, rotation
varying vec4 vCol; varying vec2 vUv;
void main() {
  vUv = uv; vCol = iCol;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSize.y), s = sin(iSize.y);
  vec2 p = position.xy * iSize.x;
  mv.xy += vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  gl_Position = projectionMatrix * mv;
}`;
const frag = /* glsl */ `
varying vec4 vCol; varying vec2 vUv;
uniform float uSoft;
void main() {
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  float a = mix(1.0 - smoothstep(0.85, 1.0, d), 1.0 - smoothstep(0.0, 1.0, d), uSoft);
  gl_FragColor = vec4(vCol.rgb, vCol.a * a);
  if (gl_FragColor.a < 0.004) discard;
}`;

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; grow: number; r: number; g: number; b: number; a: number; drag: number; grav: number; rot: number; spin: number }

class Pool {
  mesh: THREE.Mesh;
  private ps: P[] = [];
  private iPos: THREE.InstancedBufferAttribute; private iCol: THREE.InstancedBufferAttribute; private iSize: THREE.InstancedBufferAttribute;
  constructor(public max: number, blending: THREE.Blending, soft: number) {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos); g.setAttribute('iCol', this.iCol); g.setAttribute('iSize', this.iSize);
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending, uniforms: { uSoft: { value: soft } }, toneMapped: false });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
  }
  add(p: P) { if (this.ps.length < this.max) this.ps.push(p); else this.ps[(Math.random() * this.max) | 0] = p; }
  update(dt: number) {
    const ps = this.ps;
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.grav * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.grav > 0) { p.y = 0.02; p.vy *= -0.3; }
      p.size += p.grow * dt; p.rot += p.spin * dt;
      const t = p.life / p.max;
      this.iPos.setXYZ(n, p.x, p.y, p.z);
      this.iCol.setXYZW(n, p.r, p.g, p.b, p.a * Math.min(1, t * 2.2));
      this.iSize.setXY(n, p.size, p.rot);
      ps[n++] = p;
    }
    ps.length = n;
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
    this.iPos.needsUpdate = true; this.iCol.needsUpdate = true; this.iSize.needsUpdate = true;
  }
}

export const GBEDU_COLORS = [[1, 0.85, 0.2], [1, 0.45, 0.05], [1, 0.18, 0.62]];

export class Fx {
  group = new THREE.Group();
  smoke: Pool; glow: Pool;
  skids: Skids;
  density = 1;
  constructor(private budget: number) {
    this.smoke = new Pool(Math.round(900 * budget) + 100, THREE.NormalBlending, 1);
    this.glow = new Pool(Math.round(900 * budget) + 100, THREE.AdditiveBlending, 0.6);
    this.skids = new Skids(Math.round(2400 * Math.max(0.3, budget)));
    this.group.add(this.smoke.mesh, this.glow.mesh, this.skids.mesh);
    this.density = budget;
  }
  private chance(p: number) { return Math.random() < p * this.density; }
  private P(o: Partial<P>): P { const p: P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, max: 1, size: 1, grow: 0, r: 1, g: 1, b: 1, a: 1, drag: 1, grav: 0, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 2, ...o }; p.max = p.life; return p; }

  tyreSmoke(x: number, y: number, z: number, vx: number, vz: number, amount: number, dusty: boolean) {
    if (!this.chance(amount)) return;
    const c = dusty ? [0.62, 0.42, 0.3] : [0.75, 0.75, 0.74];
    this.smoke.add(this.P({ x: x + (Math.random() - 0.5) * 0.4, y: y + 0.25, z: z + (Math.random() - 0.5) * 0.4, vx: vx * 0.2 + (Math.random() - 0.5), vy: 0.8 + Math.random(), vz: vz * 0.2 + (Math.random() - 0.5), life: 1.4 + Math.random(), size: 0.8, grow: 2.4, r: c[0], g: c[1], b: c[2], a: 0.32, drag: 1.6 }));
  }
  sparks(x: number, y: number, z: number, tier: number, vx: number, vz: number) {
    if (tier <= 0 || !this.chance(0.9)) return;
    const c = GBEDU_COLORS[Math.min(2, tier - 1)];
    for (let i = 0; i < 2; i++) this.glow.add(this.P({ x, y: y + 0.1, z, vx: -vx * 0.15 + (Math.random() - 0.5) * 6, vy: 1 + Math.random() * 3, vz: -vz * 0.15 + (Math.random() - 0.5) * 6, life: 0.25 + Math.random() * 0.25, size: 0.16 + tier * 0.03, r: c[0], g: c[1], b: c[2], a: 1, drag: 2, grav: 14 }));
  }
  flame(x: number, y: number, z: number, dx: number, dz: number, blue: boolean) {
    if (!this.chance(0.95)) return;
    const c = blue ? [0.3, 0.55, 1] : [1, 0.55, 0.15];
    this.glow.add(this.P({ x, y, z, vx: -dx * 9 + (Math.random() - 0.5), vy: (Math.random() - 0.3), vz: -dz * 9 + (Math.random() - 0.5), life: 0.12 + Math.random() * 0.08, size: 0.45, grow: -1.5, r: c[0], g: c[1], b: c[2], a: 0.9, drag: 4 }));
  }
  dust(x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n * this.density; i++) this.smoke.add(this.P({ x, y: y + 0.3, z, vx: (Math.random() - 0.5) * 5, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 5, life: 1.2 + Math.random(), size: 1, grow: 2.2, r: 0.6, g: 0.42, b: 0.3, a: 0.4, drag: 1.8 }));
  }
  burst(x: number, y: number, z: number, color: [number, number, number], n: number, speed = 6, glow = false) {
    const pool = glow ? this.glow : this.smoke;
    for (let i = 0; i < n * this.density; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      pool.add(this.P({ x, y: y + 0.4, z, vx: Math.cos(a) * speed * Math.cos(e), vy: Math.sin(e) * speed, vz: Math.sin(a) * speed * Math.cos(e), life: 0.5 + Math.random() * 0.6, size: glow ? 0.3 : 0.5, grow: glow ? 0 : 1.2, r: color[0], g: color[1], b: color[2], a: 0.9, drag: 2.2, grav: glow ? 9 : 4 }));
    }
  }
  explosion(x: number, y: number, z: number) {
    this.burst(x, y, z, [1, 0.6, 0.2], 22, 8, true);
    for (let i = 0; i < 14 * this.density; i++) this.smoke.add(this.P({ x, y: y + 0.6, z, vx: (Math.random() - 0.5) * 6, vy: 1 + Math.random() * 4, vz: (Math.random() - 0.5) * 6, life: 1.4 + Math.random(), size: 1.4, grow: 3, r: 0.2, g: 0.18, b: 0.17, a: 0.6, drag: 1.5 }));
  }
  confetti(x: number, y: number, z: number) {
    const cols: [number, number, number][] = [[0, 0.53, 0.32], [1, 1, 1], [1, 0.78, 0.05], [1, 0.18, 0.6]];
    for (let i = 0; i < 120 * this.density; i++) { const c = cols[i % 4]; this.glow.add(this.P({ x: x + (Math.random() - 0.5) * 8, y: y + 6 + Math.random() * 3, z: z + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 2, vy: -1 - Math.random(), vz: (Math.random() - 0.5) * 2, life: 3 + Math.random() * 2, size: 0.18, r: c[0], g: c[1], b: c[2], a: 1, drag: 0.6, grav: 0.6, spin: 8 })); }
  }
  rain(cx: number, cy: number, cz: number, amount: number) {
    for (let i = 0; i < 6 * amount * this.density; i++) this.smoke.add(this.P({ x: cx + (Math.random() - 0.5) * 40, y: cy + 10 + Math.random() * 8, z: cz + (Math.random() - 0.5) * 40, vx: 0.5, vy: -26, vz: 0.3, life: 0.6, size: 0.05, r: 0.75, g: 0.8, b: 0.88, a: 0.45, drag: 0 }));
  }
  spray(x: number, y: number, z: number, vx: number, vz: number) {
    if (!this.chance(0.7)) return;
    this.smoke.add(this.P({ x, y: y + 0.2, z, vx: vx * 0.3 + (Math.random() - 0.5) * 2, vy: 0.6 + Math.random(), vz: vz * 0.3 + (Math.random() - 0.5) * 2, life: 0.7, size: 0.7, grow: 2.5, r: 0.85, g: 0.88, b: 0.9, a: 0.18, drag: 2 }));
  }
  update(dt: number) { this.smoke.update(dt); this.glow.update(dt); this.skids.fade(dt); }
}

/** Dark tyre marks laid as short quads in a ring buffer. */
export class Skids {
  mesh: THREE.Mesh;
  private pos: Float32Array; private alpha: Float32Array;
  private head = 0;
  private last = new Map<string, { x: number; y: number; z: number }>();
  constructor(private max: number) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const idx: number[] = [];
    for (let i = 0; i < max; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -20,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.03,0.03,0.035, vA * 0.55); }',
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
  }
  /** Extend the mark for one wheel (key) to a new point. */
  mark(key: string, x: number, y: number, z: number, strength: number) {
    const prev = this.last.get(key);
    this.last.set(key, { x, y, z });
    if (!prev || strength <= 0.02) return;
    const dx = x - prev.x, dz = z - prev.z, l = Math.hypot(dx, dz);
    if (l < 0.05 || l > 4) return;
    const nx = (-dz / l) * 0.13, nz = (dx / l) * 0.13;
    const i = this.head; this.head = (this.head + 1) % this.max;
    const b = i * 12, yy = Math.max(prev.y, y) + 0.09;
    this.pos.set([prev.x - nx, yy, prev.z - nz, prev.x + nx, yy, prev.z + nz, x + nx, yy, z + nz, x - nx, yy, z - nz], b);
    this.alpha.set([strength, strength, strength, strength], i * 4);
    const g = this.mesh.geometry as THREE.BufferGeometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
  lift(key: string) { this.last.delete(key); }
  /** Wipe every mark (a replay seek, a new race on the same scene). */
  clear() {
    this.alpha.fill(0); this.last.clear(); this.head = 0;
    ((this.mesh.geometry as THREE.BufferGeometry).attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
  fade(dt: number) {
    // marks persist; only the very oldest fade as the ring wraps, which happens naturally
    void dt;
  }
}
