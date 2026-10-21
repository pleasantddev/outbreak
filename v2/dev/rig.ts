import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
const q = new URLSearchParams(location.search);
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement, antialias: true }); r.setSize(innerWidth, innerHeight, false);
r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true;
const s = new THREE.Scene(); s.background = new THREE.Color(0x9aa4b0);
s.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture; s.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xfff2e0, 2.5); sun.position.set(3, 6, 5); sun.castShadow = true; s.add(sun);
const fl = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x6d6a64, roughness: 0.9 })); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; s.add(fl);
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 500);
(window as any).__w = { tiles: 0, frames: 0 };
const L = new GLTFLoader();
const anims = (q.get('anims') ?? 'A_TPose,Walk_Loop,Pistol_Aim_Neutral,Jog_Fwd_Loop').split(',');
const at = +(q.get('at') ?? 0.3);
Promise.all([L.loadAsync(q.get('f')!), L.loadAsync('/assets/anim/ual1.glb'), L.loadAsync('/assets/anim/ual2.glb')]).then(([g, a1, a2]) => {
  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of [...a1.animations, ...a2.animations]) clips.set(c.name, c);
  g.scene.updateMatrixWorld(true);
  const pel = g.scene.getObjectByName('pelvis')!; const hip = new THREE.Vector3().setFromMatrixPosition(pel.matrixWorld).y;
  const k = hip / 0.949;
  const fix = (c: THREE.AnimationClip) => {
    const t = c.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position').map((t) => t.clone());
    for (const tr of t) if (tr.name === 'pelvis.position') for (let i = 0; i < tr.values.length; i++) tr.values[i] *= k;
    return new THREE.AnimationClip(c.name, c.duration, t);
  };
  const n = anims.length, sp = 1.1;
  anims.forEach((name, i) => {
    const m = skClone(g.scene); m.position.x = (i - (n - 1) / 2) * sp; s.add(m);
    m.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; const mt = o.material; if (q.get('renorm') && /Cloth/.test(mt.name)) { o.geometry = o.geometry.clone(); o.geometry.deleteAttribute('normal'); o.geometry.computeVertexNormals(); mt.color.set(0xffffff); } if (mt.transparent || mt.alphaTest > 0) { mt.transparent = false; mt.alphaTest = 0.5; mt.depthWrite = true; mt.alphaToCoverage = true; } } });
    const c = clips.get(name); if (c && name !== 'rest') { const mx = new THREE.AnimationMixer(m); mx.clipAction(fix(c)).play(); mx.update(at * c.duration); }
  });
  const yaw = +(q.get('yaw') ?? 0) * Math.PI / 180, zoom = +(q.get('zoom') ?? 1);
  const w = n * sp, h = 2; const d = Math.max(w / (innerWidth / innerHeight), h) * 1.15 / Math.tan(15 * Math.PI / 180) / 2 / zoom;
  const cy = +(q.get('cy') ?? 0.95);
  cam.position.set(Math.sin(yaw) * d, cy, Math.cos(yaw) * d); cam.lookAt(0, cy, 0);
  console.log('hip', hip.toFixed(3), 'mats', [...new Set((() => { const a: string[] = []; g.scene.traverse((o: any) => o.isMesh && a.push(o.material.name)); return a; })())].join(','));
  (window as any).__w.tiles = 1;
});
const loop = () => { r.render(s, cam); (window as any).__w.frames++; requestAnimationFrame(loop); }; loop();
