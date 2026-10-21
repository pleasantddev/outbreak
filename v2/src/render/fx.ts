// Visual effects: tracers, muzzle flash, impacts, blood, explosions, rain, the Heart beam, extraction flares, zone wall.
import * as THREE from 'three';
import { bloodTexture } from './props';
import { shared } from './materials';
import type { Vec3 } from '../sim/types';

interface Particle { pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; size: number; color: THREE.Color; grav: number; drag: number }

function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class ParticleSystem {
  max: number; list: Particle[] = []; points: THREE.Points; geo: THREE.BufferGeometry;
  constructor(max: number, blending: THREE.Blending, scene: THREE.Scene) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 4), 4));
    this.geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(max), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softDot() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); }`,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(p: Partial<Particle> & { pos: THREE.Vector3 }) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ vel: new THREE.Vector3(), life: 1, max: 1, size: 0.2, color: new THREE.Color(1, 1, 1), grav: 0, drag: 1, ...p, pos: p.pos.clone() });
  }
  update(dt: number) {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute, col = this.geo.getAttribute('color') as THREE.BufferAttribute, size = this.geo.getAttribute('size') as THREE.BufferAttribute;
    let n = 0;
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y -= p.grav * dt; p.vel.multiplyScalar(Math.exp(-p.drag * dt)); p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      pos.setXYZ(n, p.pos.x, p.pos.y, p.pos.z);
      col.setXYZW(n, p.color.r, p.color.g, p.color.b, Math.min(1, k * 1.5));
      size.setX(n, p.size * (1.4 - k * 0.4));
      n++;
    }
    this.list = this.list.filter((p) => p.life > 0);
    this.geo.setDrawRange(0, n);
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
  }
}

export class Fx {
  scene: THREE.Scene;
  sparks: ParticleSystem; smoke: ParticleSystem; blood: ParticleSystem;
  tracers: { line: THREE.Line; life: number }[] = [];
  tracerMat = new THREE.LineBasicMaterial({ color: 0xffd090, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  flashes: { mesh: THREE.Mesh; light: THREE.PointLight | null; life: number }[] = [];
  flashGeo = new THREE.SphereGeometry(0.12, 8, 6);
  flashMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  lightPool: THREE.PointLight[] = [];
  decals: THREE.InstancedMesh; decalIdx = 0;
  rain: THREE.LineSegments; rainOn = true;
  heartBeam: THREE.Mesh; heartCore: THREE.Mesh; heartLight: THREE.PointLight;
  extractions: THREE.Group[] = [];
  zoneWall: THREE.Mesh;
  corruption: THREE.Mesh[] = [];
  pings: { mesh: THREE.Mesh; life: number }[] = [];
  shieldMeshes = new Map<number, THREE.Mesh>();
  grenadeMeshes = new Map<number, THREE.Mesh>();

  constructor(scene: THREE.Scene, quality: 'low' | 'medium' | 'high') {
    this.scene = scene;
    this.sparks = new ParticleSystem(600, THREE.AdditiveBlending, scene);
    this.smoke = new ParticleSystem(500, THREE.NormalBlending, scene);
    this.blood = new ParticleSystem(500, THREE.NormalBlending, scene);
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffb060, 0, 14, 2); scene.add(l); this.lightPool.push(l); }
    const dmat = new THREE.MeshStandardMaterial({ map: bloodTexture(), transparent: true, depthWrite: false, roughness: 0.2, polygonOffset: true, polygonOffsetFactor: -3 });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dmat, 160);
    this.decals.count = 0; this.decals.frustumCulled = false;
    scene.add(this.decals);

    // rain streaks around the camera
    const N = quality === 'high' ? 5000 : quality === 'medium' ? 2800 : 1200;
    const rp = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 60, y = Math.random() * 30, z = (Math.random() - 0.5) * 60; rp.set([x, y, z, x + 0.05, y - 0.7, z], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    const rmat = new THREE.LineBasicMaterial({ color: 0x8890a0, transparent: true, opacity: 0.28, depthWrite: false });
    rmat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shared.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y = mod(transformed.y - uTime * 22.0, 30.0) - 6.0;`);
    };
    this.rain = new THREE.LineSegments(rg, rmat);
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    // the Heart: a pillar of red light visible across the whole city
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.time, uOn: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uOn;
        void main(){ float edge = 1.0 - abs(vUv.x - 0.5) * 2.0; float pulse = 0.6 + 0.4 * sin(uTime * 3.0 - vUv.y * 20.0);
          float a = pow(edge, 3.0) * (1.0 - vUv.y) * pulse * uOn; gl_FragColor = vec4(vec3(1.0, 0.08, 0.04) * 2.5, a * 0.8); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.heartBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 260, 16, 1, true).translate(0, 130, 0), beamMat);
    this.heartBeam.visible = false; this.heartBeam.frustumCulled = false;
    scene.add(this.heartBeam);
    this.heartCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 2), new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1010, emissiveIntensity: 5, roughness: 0.3 }));
    this.heartCore.visible = false; scene.add(this.heartCore);
    this.heartLight = new THREE.PointLight(0xff1a10, 0, 30, 1.5); scene.add(this.heartLight);

    // the collapse: a wall of red fog
    const wallMat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.time },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
      fragmentShader: `varying vec2 vUv; varying vec3 vW; uniform float uTime;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        void main(){ float a = (1.0 - vUv.y) * (0.35 + 0.35 * n(vec2(vUv.x * 80.0, vUv.y * 6.0 - uTime * 0.6)));
          gl_FragColor = vec4(0.6, 0.02, 0.02, a * 0.65); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 70, 96, 1, true).translate(0, 30, 0), wallMat);
    this.zoneWall.visible = false; this.zoneWall.frustumCulled = false;
    scene.add(this.zoneWall);
  }

  shot(from: Vec3, to: Vec3, muzzle: THREE.Vector3 | null, suppressed: boolean, hit: string, normal?: Vec3) {
    const a = muzzle ?? new THREE.Vector3(from.x, from.y, from.z), b = new THREE.Vector3(to.x, to.y, to.z);
    if (!suppressed || Math.random() < 0.3) {
      const g = new THREE.BufferGeometry().setFromPoints([a.clone().lerp(b, 0.05), b]);
      const line = new THREE.Line(g, this.tracerMat); line.frustumCulled = false;
      this.scene.add(line); this.tracers.push({ line, life: 0.06 });
    }
    if (muzzle && !suppressed) {
      const m = new THREE.Mesh(this.flashGeo, this.flashMat); m.position.copy(muzzle); m.scale.setScalar(0.8 + Math.random() * 0.8);
      this.scene.add(m);
      const light = this.lightPool.find((l) => l.intensity === 0) ?? null;
      if (light) { light.position.copy(muzzle); light.intensity = 9; light.color.setHex(0xffb060); }
      this.flashes.push({ mesh: m, light, life: 0.05 });
    }
    if (hit === 'world' || hit === 'metal') {
      const n = normal ? new THREE.Vector3(normal.x, normal.y, normal.z) : new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < (hit === 'metal' ? 8 : 4); i++) this.sparks.emit({ pos: b, vel: n.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4)), life: 0.25, max: 0.25, size: 0.06, color: new THREE.Color(1, 0.7, 0.3), grav: 12 });
      for (let i = 0; i < 3; i++) this.smoke.emit({ pos: b, vel: n.clone().multiplyScalar(0.8).add(new THREE.Vector3((Math.random() - 0.5), Math.random(), (Math.random() - 0.5))), life: 0.8, max: 0.8, size: 0.35, color: new THREE.Color(0.25, 0.22, 0.2), drag: 2 });
    }
    if (hit === 'flesh') this.bloodBurst(b, a.clone().sub(b).normalize().negate(), 1);
  }
  bloodBurst(at: THREE.Vector3, dir: THREE.Vector3, amount: number, gore = true) {
    if (!gore) return;
    for (let i = 0; i < 10 * amount; i++) this.blood.emit({ pos: at, vel: dir.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), life: 0.6, max: 0.6, size: 0.1 + Math.random() * 0.1, color: new THREE.Color(0.35, 0.0, 0.0), grav: 14, drag: 1 });
    if (Math.random() < 0.6 * amount) this.decal(new THREE.Vector3(at.x + dir.x * 1.2, 0, at.z + dir.z * 1.2), 0.6 + Math.random() * 1.0);
  }
  decal(at: THREE.Vector3, size: number, groundY?: number) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(at.x, (groundY ?? at.y) + 0.03, at.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.random() * 6)), new THREE.Vector3(size, size, 1));
    this.decals.setMatrixAt(this.decalIdx % 160, m);
    this.decalIdx++;
    this.decals.count = Math.min(160, this.decalIdx);
    this.decals.instanceMatrix.needsUpdate = true;
  }
  explosion(at: Vec3, r: number) {
    const p = new THREE.Vector3(at.x, at.y + 0.5, at.z);
    for (let i = 0; i < 60; i++) this.sparks.emit({ pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 20, Math.random() * 14, (Math.random() - 0.5) * 20), life: 0.6 + Math.random() * 0.5, max: 1, size: 0.25 + Math.random() * 0.4, color: new THREE.Color(1, 0.5 + Math.random() * 0.3, 0.15), grav: 9, drag: 1.5 });
    for (let i = 0; i < 40; i++) this.smoke.emit({ pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6), life: 3 + Math.random() * 2, max: 5, size: 2 + Math.random() * 2.5, color: new THREE.Color(0.08, 0.07, 0.07), drag: 0.8 });
    const l = this.lightPool[0]; l.position.copy(p); l.intensity = 80; l.distance = r * 5; l.color.setHex(0xff7020);
    this.decal(p, r * 0.6, at.y);
  }
  abilityFx(kind: string, at: Vec3, dir: Vec3) {
    const p = new THREE.Vector3(at.x, at.y, at.z), d = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const col = kind === 'force' ? new THREE.Color(0.6, 0.75, 1) : kind === 'shadow' ? new THREE.Color(0.4, 0.2, 1) : new THREE.Color(0.8, 0.75, 0.7);
    for (let i = 0; i < 60; i++) {
      const spread = new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.2);
      const v = kind === 'force' ? d.clone().add(spread).multiplyScalar(14 + Math.random() * 8) : new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3);
      this.sparks.emit({ pos: p, vel: v, life: 0.5, max: 0.5, size: 0.18, color: col, drag: 3 });
    }
  }
  ping(at: Vec3, color: number) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.position.set(at.x, at.y + 0.2, at.z); this.scene.add(m); this.pings.push({ mesh: m, life: 1.6 });
  }
  setExtractions(sites: { p: [number, number, number]; r: number }[], open: boolean) {
    if (open && !this.extractions.length) {
      for (const s of sites) {
        const g = new THREE.Group(); g.position.set(s.p[0], s.p[1], s.p[2]);
        const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.4, s.r, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x30ffb0, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        ring.position.y = 0.15; g.add(ring);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 90, 12, 1, true).translate(0, 45, 0), new THREE.MeshBasicMaterial({ color: 0x20ff90, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        g.add(col);
        const l = new THREE.PointLight(0x40ffa0, 12, 22, 1.6); l.position.y = 2; g.add(l);
        this.scene.add(g); this.extractions.push(g);
      }
    }
  }
  setCorruption(list: { x: number; z: number; r: number }[]) {
    while (this.corruption.length < list.length) {
      const c = list[this.corruption.length];
      const m = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, 14, 64, 1, true).translate(0, 6, 0), (this.zoneWall.material as THREE.ShaderMaterial).clone());
      m.position.set(c.x, 0, c.z); m.frustumCulled = false;
      this.scene.add(m); this.corruption.push(m);
      for (let i = 0; i < 40; i++) this.smoke.emit({ pos: new THREE.Vector3(c.x + (Math.random() - 0.5) * c.r, 1, c.z + (Math.random() - 0.5) * c.r), vel: new THREE.Vector3(0, 0.3, 0), life: 6, max: 6, size: 6, color: new THREE.Color(0.3, 0.02, 0.02) });
    }
  }

  update(dt: number, cam: THREE.Vector3, heart: { active: boolean; pos: Vec3; carried: boolean }, zone: { active: boolean; cx: number; cz: number; r: number }, corr: { x: number; z: number; r: number }[], time: number) {
    this.sparks.update(dt); this.smoke.update(dt); this.blood.update(dt);
    for (const t of this.tracers) { t.life -= dt; if (t.life <= 0) { this.scene.remove(t.line); t.line.geometry.dispose(); } }
    this.tracers = this.tracers.filter((t) => t.life > 0);
    for (const f of this.flashes) { f.life -= dt; if (f.life <= 0) { this.scene.remove(f.mesh); if (f.light) f.light.intensity = 0; } }
    this.flashes = this.flashes.filter((f) => f.life > 0);
    const l0 = this.lightPool[0]; if (l0.intensity > 10) l0.intensity *= Math.exp(-dt * 6); else if (l0.intensity > 9.5) l0.intensity = 0;
    for (const p of this.pings) { p.life -= dt; p.mesh.scale.setScalar(1 + (1.6 - p.life) * 12); (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / 1.6; if (p.life <= 0) this.scene.remove(p.mesh); }
    this.pings = this.pings.filter((p) => p.life > 0);
    this.rain.position.set(cam.x, cam.y - 8, cam.z);
    this.rain.visible = this.rainOn;
    (this.heartBeam.material as THREE.ShaderMaterial).uniforms.uOn.value = heart.active ? 1 : 0;
    this.heartBeam.visible = heart.active;
    this.heartCore.visible = heart.active && !heart.carried;
    this.heartLight.intensity = heart.active ? 18 + Math.sin(time * 6) * 6 : 0;
    if (heart.active) {
      this.heartBeam.position.set(heart.pos.x, heart.pos.y, heart.pos.z);
      this.heartCore.position.set(heart.pos.x, heart.pos.y + 0.3 + Math.sin(time * 2) * 0.12, heart.pos.z);
      this.heartCore.rotation.y += dt; this.heartCore.scale.setScalar(1 + Math.max(0, Math.sin(time * 6)) * 0.25);
      this.heartLight.position.set(heart.pos.x, heart.pos.y + 1.2, heart.pos.z);
      if (Math.random() < dt * 25) this.sparks.emit({ pos: new THREE.Vector3(heart.pos.x, heart.pos.y + 0.5, heart.pos.z), vel: new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2), life: 1.2, max: 1.2, size: 0.12, color: new THREE.Color(1, 0.1, 0.05), drag: 0.5 });
    }
    this.zoneWall.visible = zone.active;
    if (zone.active) { this.zoneWall.position.set(zone.cx, -5, zone.cz); this.zoneWall.scale.set(zone.r, 1, zone.r); }
    this.setCorruption(corr);
    for (const e of this.extractions) { e.children[0].rotation.y += dt * 0.5; }
  }

  syncShields(list: { id: number; pos: Vec3; yaw: number; w?: number }[]) {
    const alive = new Set(list.map((s) => s.id));
    for (const [id, m] of this.shieldMeshes) if (!alive.has(id)) { this.scene.remove(m); this.shieldMeshes.delete(id); for (let i = 0; i < 20; i++) this.sparks.emit({ pos: m.position, vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6), life: 0.5, max: 0.5, size: 0.1, color: new THREE.Color(0.9, 0.8, 0.6), grav: 10 }); }
    for (const s of list) {
      if (this.shieldMeshes.has(s.id)) continue;
      const w = (s as any).w ?? 1.6;
      const g = new THREE.BoxGeometry(w * 2, 2.3, 0.3);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6a625a, roughness: 0.6, metalness: 0.9 }));
      m.position.set(s.pos.x, s.pos.y + 1.15, s.pos.z); m.rotation.y = s.yaw; m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m); this.shieldMeshes.set(s.id, m);
      for (let i = 0; i < 30; i++) this.smoke.emit({ pos: m.position, vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3), life: 1.2, max: 1.2, size: 1, color: new THREE.Color(0.2, 0.18, 0.15), drag: 2 });
    }
  }
  syncGrenades(list: { id: number; pos: Vec3 }[]) {
    const alive = new Set(list.map((g) => g.id));
    for (const [id, m] of this.grenadeMeshes) if (!alive.has(id)) { this.scene.remove(m); this.grenadeMeshes.delete(id); }
    for (const g of list) {
      let m = this.grenadeMeshes.get(g.id);
      if (!m) { m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a3020, roughness: 0.6, metalness: 0.4 })); this.scene.add(m); this.grenadeMeshes.set(g.id, m); }
      m.position.set(g.pos.x, g.pos.y, g.pos.z);
    }
  }
}
