import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const q = new URLSearchParams(location.search);
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement, antialias: true }); r.setSize(innerWidth, innerHeight, false);
r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true;
const s = new THREE.Scene(); s.background = new THREE.Color(0x8aa0b8);
s.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(5, 10, 6); sun.castShadow = true; s.add(sun);
const g = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x777777 })); g.receiveShadow = true; s.add(g);
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
const names = (q.get('cars') ?? 'camry,golf,civic,rrsport,gclass,hiace').split(',');
const open = +(q.get('open') ?? 1);
const L = new GLTFLoader(); let done = 0;
names.forEach((n, i) => L.load(`/cars/${n}.wasm`, (gl) => {
  const m = gl.scene; m.position.set((i % 3) * 5.5 - 5.5, 0, Math.floor(i / 3) * 6.5);
  m.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  m.traverse((o) => {
    if (!/^door_(fl|fr|rl|rr|slide)$/.test(o.name)) return;
    const k = o.name.slice(5);
    if (k === 'slide') o.position.z -= 0.95 * open, o.position.x -= 0.12 * open;
    else o.rotation.y = (k.endsWith('l') ? -1 : 1) * 1.1 * open * +(q.get('sgn') ?? 1);
    o.traverse((c: any) => { if (c.isMesh && q.get('mark')) { c.material = new THREE.MeshBasicMaterial({ color: k.endsWith('l') ? 0x00ff00 : 0xff00ff }); } });
  });
  s.add(m); done++;
}));
cam.position.set(+(q.get('cx') ?? 9), +(q.get('cy') ?? 5), +(q.get('cz') ?? 14)); if (q.get('top')) cam.up.set(0, 0, -1); cam.lookAt(q.get('top') ? +(q.get('cx') ?? 0) : 0, q.get('top') ? 0 : 0.8, q.get('top') ? +(q.get('cz') ?? 0) : 3);
(window as any).__w = { get tiles() { return done; }, frames: 0 };
const loop = () => { r.render(s, cam); (window as any).__w.frames++; requestAnimationFrame(loop); }; loop();
