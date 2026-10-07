// Turns the city data into merged, chunked meshes plus sky, water, fog and the lighting rig.
import * as THREE from 'three';
import type { City, Box, Mat, Light as CityLight } from '../world/cityGen';
import { worldMaterials, TEX_SCALE, shared } from './materials';
import { buildProps } from './props';
import type { Quality } from './engine';

const FACES: { n: [number, number, number]; u: [number, number, number]; v: [number, number, number] }[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

class GeoBuilder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  add(b: Box, scale: number) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(b.rx ?? 0, b.ry, 0, 'YXZ'));
    m.setPosition(b.p[0], b.p[1], b.p[2]);
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const c = new THREE.Color(b.tint ?? 0xffffff).convertSRGBToLinear();
    const tmp = new THREE.Vector3(), un = new THREE.Vector3(), vn = new THREE.Vector3(), nn = new THREE.Vector3();
    const tall = b.s[1] > 0.6;
    for (const f of FACES) {
      const hu = Math.abs(f.u[0] * b.s[0] + f.u[1] * b.s[1] + f.u[2] * b.s[2]);
      const hv = Math.abs(f.v[0] * b.s[0] + f.v[1] * b.s[1] + f.v[2] * b.s[2]);
      const hn = Math.abs(f.n[0] * b.s[0] + f.n[1] * b.s[1] + f.n[2] * b.s[2]);
      if (hu < 0.001 || hv < 0.001) continue;
      // skip faces that are almost certainly buried (bottoms of ground-level slabs)
      if (f.n[1] === -1 && b.p[1] - b.s[1] < 0.02 && !b.rx) continue;
      nn.set(...f.n).applyMatrix3(nm).normalize();
      un.set(...f.u).applyMatrix3(nm).normalize();
      vn.set(...f.v).applyMatrix3(nm).normalize();
      const base = this.pos.length / 3;
      const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [cu, cv] of corners) {
        tmp.set(f.n[0] * hn + f.u[0] * hu * cu + f.v[0] * hv * cv, f.n[1] * hn + f.u[1] * hu * cu + f.v[1] * hv * cv, f.n[2] * hn + f.u[2] * hu * cu + f.v[2] * hv * cv).applyMatrix4(m);
        this.pos.push(tmp.x, tmp.y, tmp.z);
        this.nor.push(nn.x, nn.y, nn.z);
        this.uv.push(tmp.dot(un) / scale, tmp.dot(vn) / scale);
        // fake ambient occlusion: walls darken toward their base, ceilings are dim
        let g = 1;
        if (f.n[1] === 0 && tall) g = cv < 0 ? 0.62 : 1.0;
        if (f.n[1] === -1) g = 0.5;
        this.col.push(c.r * g, c.g * g, c.b * g);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,200,140,0.35)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.18, mid); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const skyVert = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
const skyFrag = `
varying vec3 vDir; uniform float uNight; uniform float uTime; uniform vec3 uMoonDir; uniform float uHeart; uniform float uCorrupt;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float hgt = clamp(d.y, -0.2, 1.0);
  // dusk to deep night: a bruised horizon that burns out as the match goes on
  vec3 duskHor = vec3(0.2, 0.035, 0.025), duskZen = vec3(0.02, 0.015, 0.035);
  vec3 nightHor = vec3(0.045, 0.012, 0.015), nightZen = vec3(0.002, 0.003, 0.008);
  vec3 hor = mix(duskHor, nightHor, uNight), zen = mix(duskZen, nightZen, uNight);
  float west = pow(max(0.0, dot(normalize(vec2(d.x, d.z)), normalize(vec2(-1.0, 0.3)))), 3.0) * (1.0 - uNight) * 0.8;
  vec3 col = mix(hor + vec3(0.35, 0.08, 0.02) * west, zen, pow(max(hgt, 0.0), 0.45));
  // city glow from below: sodium haze on the clouds
  col += vec3(0.09, 0.03, 0.012) * exp(-max(hgt, 0.0) * 9.0) * (0.6 + 0.4 * uNight);
  // stars
  vec2 sp = d.xz / (d.y + 0.25) * 140.0;
  float st = step(0.9975, h(floor(sp))) * smoothstep(0.1, 0.4, hgt) * (0.5 + 0.5 * sin(uTime * 2.0 + h(floor(sp)) * 40.0));
  col += vec3(0.8, 0.75, 0.7) * st * uNight * 0.6;
  // blood moon
  float md = dot(d, normalize(uMoonDir));
  float disc = smoothstep(0.9993, 0.9996, md);
  float crater = fbm(d.xy * 90.0) * 0.5 + 0.5;
  vec3 moonCol = mix(vec3(0.9, 0.55, 0.42), vec3(0.75, 0.08, 0.04), uNight) * crater * 1.6;
  col = mix(col, moonCol, disc);
  col += vec3(0.5, 0.08, 0.04) * pow(max(md, 0.0), 120.0) * 0.6 + vec3(0.25, 0.04, 0.02) * pow(max(md, 0.0), 12.0) * 0.25;
  // clouds lit from below by the city and from above by the moon
  vec2 cp = d.xz / max(d.y + 0.08, 0.05) * 1.4 + vec2(uTime * 0.004, uTime * 0.002);
  float cl = smoothstep(0.42, 0.85, fbm(cp));
  vec3 cloudCol = mix(vec3(0.05, 0.02, 0.018), vec3(0.015, 0.01, 0.012), uNight) + vec3(0.12, 0.03, 0.02) * pow(max(md, 0.0), 6.0);
  col = mix(col, cloudCol, cl * smoothstep(-0.05, 0.25, hgt) * 0.92);
  // Heart flare and corruption stain the sky red
  col += vec3(0.35, 0.0, 0.0) * uHeart * exp(-max(hgt, 0.0) * 4.0);
  col = mix(col, col * vec3(1.6, 0.5, 0.45), uCorrupt * 0.5);
  gl_FragColor = vec4(col, 1.0);
}`;

export class WorldView {
  group = new THREE.Group();
  city: City;
  quality: Quality;
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  pool: THREE.PointLight[] = [];
  sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  water: THREE.Mesh;
  fog: THREE.FogExp2;
  glowPoints!: THREE.Points;
  litWindows: THREE.InstancedMesh | null = null;
  private lights: CityLight[];
  private lightRegion: string[];
  private poolTimer = 0;
  private flickerSeed: number[];
  private blackoutApplied = new Set<string>();
  envMap: THREE.Texture | null = null;

  constructor(city: City, scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: Quality) {
    this.city = city;
    this.quality = quality;
    this.lights = city.lights;
    this.lightRegion = this.lights.map((l) => city.regions.find((r) => l.p[0] >= r.x0 && l.p[0] < r.x1 && l.p[2] >= r.z0 && l.p[2] < r.z1)?.name ?? '');
    this.flickerSeed = this.lights.map(() => Math.random() * 100);
    scene.add(this.group);
    this.buildGeometry();
    buildProps(city, this.group, quality);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uNight: { value: 0.6 }, uTime: shared.time, uMoonDir: { value: new THREE.Vector3(-0.5, 0.42, -0.6) }, uHeart: { value: 0 }, uCorrupt: { value: 0 } },
    }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    // environment reflections come from the sky itself, so wet streets mirror the blood moon
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene(); envScene.add(this.sky.clone());
    this.envMap = pm.fromScene(envScene, 0.04).texture;
    scene.environment = this.envMap;
    pm.dispose();

    this.fog = new THREE.FogExp2(0x0d0709, 0.0125);
    scene.fog = this.fog;
    scene.background = new THREE.Color(0x020103);

    this.moon = new THREE.DirectionalLight(0x9aa8d8, 0.55);
    this.moon.position.set(-60, 90, -70);
    this.moon.castShadow = quality !== 'low';
    const sm = quality === 'high' ? 2048 : 1024;
    this.moon.shadow.mapSize.set(sm, sm);
    const sc = this.moon.shadow.camera as THREE.OrthographicCamera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 300;
    this.moon.shadow.bias = -0.0008; this.moon.shadow.normalBias = 0.04;
    scene.add(this.moon, this.moon.target);
    this.hemi = new THREE.HemisphereLight(0x2a2f48, 0x1a0c08, 0.32);
    scene.add(this.hemi);

    const n = quality === 'high' ? 22 : quality === 'medium' ? 14 : 8;
    for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xff9a3c, 0, 20, 1.6); l.castShadow = false; this.pool.push(l); scene.add(l); }

    // lamp glows: one draw call for every light in the city
    const gp = new Float32Array(this.lights.length * 3), gc = new Float32Array(this.lights.length * 3);
    this.lights.forEach((l, i) => { gp.set(l.p, i * 3); const c = new THREE.Color(l.color); gc.set([c.r, c.g, c.b], i * 3); });
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    gg.setAttribute('color', new THREE.BufferAttribute(gc, 3));
    this.glowPoints = new THREE.Points(gg, new THREE.PointsMaterial({ size: 1.3, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false }));
    this.glowPoints.frustumCulled = false;
    this.group.add(this.glowPoints);

    // light pools on the ground under sodium lamps: cheap bounce light that sells the wet street
    const sodium = this.lights.filter((l) => l.kind === 'sodium' || l.kind === 'fire');
    const poolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: glowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.35)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.3, fog: true, color: 0xffffff,
    }), sodium.length);
    const m4 = new THREE.Matrix4();
    sodium.forEach((l, i) => {
      const s = l.kind === 'fire' ? 9 : 16;
      const groundY = l.p[1] > 6 && Math.abs(l.p[2] - city.flyover.z) < 8 && l.p[0] > city.flyover.x0 && l.p[0] < city.flyover.x1 ? city.flyover.y + 0.05 : 0.05;
      m4.makeScale(s, 1, s).setPosition(l.p[0], (l.kind === 'fire' ? 0.06 : groundY) + 0.02, l.p[2]);
      poolMesh.setMatrixAt(i, m4);
      poolMesh.setColorAt(i, new THREE.Color(l.color));
    });
    poolMesh.renderOrder = 2;
    this.group.add(poolMesh);

    // the lagoon: dark, oily and reflective
    const wm = new THREE.MeshStandardMaterial({ color: 0x050a0c, roughness: 0.08, metalness: 0.2, envMapIntensity: 1.2 });
    wm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shared.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; uniform float uTime;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float t = uTime * 0.6; vec2 p = vW.xz;
          float dx = sin(p.x * 0.7 + t) * 0.06 + sin(p.x * 2.3 + p.y * 1.7 + t * 1.7) * 0.03 + sin(p.y * 4.1 - t * 2.1) * 0.015;
          float dz = cos(p.y * 0.8 - t * 0.8) * 0.06 + cos(p.x * 1.9 - p.y * 2.6 + t * 1.3) * 0.03;
          normal = normalize(normal + vec3(dx, 0.0, dz)); }`);
    };
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(city.water.x1 - city.water.x0, city.water.z1 - city.water.z0, 1, 1).rotateX(-Math.PI / 2), wm);
    this.water.position.set((city.water.x0 + city.water.x1) / 2, city.water.y, 0);
    this.water.receiveShadow = true;
    this.group.add(this.water);
    // open sea beyond the playable edge so the horizon never shows void
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x030405 }));
    outer.position.y = -6; this.group.add(outer);
  }

  private buildGeometry() {
    const mats = worldMaterials(this.quality);
    const chunks = new Map<string, Map<Mat, GeoBuilder>>();
    const CH = 96;
    for (const b of this.city.boxes) {
      if (!b.vis) continue;
      const key = `${Math.floor(b.p[0] / CH)},${Math.floor(b.p[2] / CH)}`;
      const big = b.s[0] > CH || b.s[2] > CH;
      const k = big ? 'big' : key;
      let m = chunks.get(k); if (!m) { m = new Map(); chunks.set(k, m); }
      let gb = m.get(b.mat); if (!gb) { gb = new GeoBuilder(); m.set(b.mat, gb); }
      gb.add(b, TEX_SCALE[b.mat]);
    }
    for (const [, m] of chunks) for (const [mat, gb] of m) {
      const mesh = new THREE.Mesh(gb.build(), mats[mat]);
      mesh.receiveShadow = true;
      mesh.castShadow = !['road', 'mud', 'sidewalk', 'tiles', 'woodfloor'].includes(mat);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
  }

  update(dt: number, cam: THREE.Vector3, focus: THREE.Vector3, night: number, blackout: Set<string>, heartFlare: number, corrupt: number, time: number) {
    shared.time.value = time;
    this.sky.position.copy(cam);
    this.sky.material.uniforms.uNight.value = night;
    this.sky.material.uniforms.uHeart.value = heartFlare;
    this.sky.material.uniforms.uCorrupt.value = corrupt;
    this.moon.position.set(focus.x - 60, focus.y + 90, focus.z - 70);
    this.moon.target.position.copy(focus);
    this.moon.intensity = 0.65 - night * 0.3;
    this.moon.color.setHSL(0.62 - night * 0.6, 0.35 + night * 0.2, 0.7);
    this.hemi.intensity = 0.5 - night * 0.18;
    const fogCol = new THREE.Color().setRGB(0.05 + corrupt * 0.12, 0.022, 0.03).lerp(new THREE.Color(0.012, 0.008, 0.01), night * 0.6);
    this.fog.color.copy(fogCol);
    this.fog.density = 0.009 + night * 0.006 + corrupt * 0.01;

    // blackouts kill the lamps in a district
    for (const r of blackout) if (!this.blackoutApplied.has(r)) {
      this.blackoutApplied.add(r);
      const col = this.glowPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
      this.lights.forEach((_, i) => { if (this.lightRegion[i] === r) col.setXYZ(i, 0, 0, 0); });
      col.needsUpdate = true;
    }

    // assign the pooled real lights to the nearest lamps
    this.poolTimer -= dt;
    if (this.poolTimer <= 0) {
      this.poolTimer = 0.2;
      const cand: [number, number][] = [];
      this.lights.forEach((l, i) => {
        if (blackout.has(this.lightRegion[i]) && l.kind !== 'fire') return;
        const d = Math.hypot(l.p[0] - focus.x, l.p[1] - focus.y, l.p[2] - focus.z);
        if (d < 70) cand.push([d, i]);
      });
      cand.sort((a, b) => a[0] - b[0]);
      this.pool.forEach((pl, k) => { (pl as any)._idx = cand[k]?.[1] ?? -1; });
    }
    for (const pl of this.pool) {
      const i = (pl as any)._idx as number;
      if (i === undefined || i < 0) { pl.intensity = 0; pl.visible = false; continue; }
      const l = this.lights[i];
      pl.visible = true;
      pl.position.set(l.p[0], l.p[1], l.p[2]);
      pl.color.setHex(l.color);
      pl.distance = l.range;
      let f = 1;
      if (l.flicker) {
        const s = this.flickerSeed[i];
        f = l.kind === 'fire' ? 0.75 + 0.25 * Math.sin(time * 13 + s) * Math.sin(time * 7.3 + s * 2) : (Math.sin(time * 23 + s) > 0.92 || Math.sin(time * 3.1 + s) > 0.97 ? 0.1 : 1);
      }
      pl.intensity = l.intensity * f * (1 + night * 0.15);
    }
  }
}
