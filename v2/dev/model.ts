import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const q = new URLSearchParams(location.search);
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement, antialias: true }); r.setSize(innerWidth, innerHeight, false);
r.toneMapping = THREE.ACESFilmicToneMapping;
const s = new THREE.Scene(); s.background = new THREE.Color(0x9aa4b0);
s.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 6, 5); s.add(sun);
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 500);
(window as any).__w = { tiles: 0, frames: 0 };
new GLTFLoader().load(q.get('f')!, (g) => {
  const m = g.scene; s.add(m);
  if (q.get('anim') && g.animations.length) { const mx = new THREE.AnimationMixer(m); mx.clipAction(g.animations[+(q.get('anim')!)] ?? g.animations[0]).play(); mx.update(+(q.get('at') ?? 0.5)); }
  const box = new THREE.Box3().setFromObject(m); const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const d = Math.max(sz.x, sz.y) * 1.25 / Math.tan(15 * Math.PI / 180) / 2;
  const yaw = +(q.get('yaw') ?? 0) * Math.PI / 180;
  cam.position.set(c.x + Math.sin(yaw) * d, c.y, c.z + Math.cos(yaw) * d); cam.lookAt(c);
  console.log('box', JSON.stringify({ min: box.min.toArray().map((v) => +v.toFixed(2)), max: box.max.toArray().map((v) => +v.toFixed(2)) }), 'anims', g.animations.map((a) => a.name + ':' + a.duration.toFixed(1)).join(','));
  (window as any).__w.tiles = 1;
});
const loop = () => { r.render(s, cam); (window as any).__w.frames++; requestAnimationFrame(loop); }; loop();
