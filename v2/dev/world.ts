import * as THREE from 'three';
import { Atmosphere } from '../src/render/sky';
import { RegionStore } from '../src/world/region';
import { loadTexSet } from '../src/world/texsets';
import { WorldStreamer } from '../src/world/streamer';
import { groundShared } from '../src/world/ground';
const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight, false); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 3000);
const atmo = new Atmosphere(scene, renderer, (q.get('q') as any) ?? 'high', { hour: +(q.get('t') ?? 10), weather: (q.get('w') as any) ?? 'clear' });

const store = new RegionStore('/world/');
(async () => {
  await store.init();
  const quality = (q.get('q') as any) ?? 'high';
  const size = quality === 'low' ? 512 : 1024;
  const [tg, tw] = await Promise.all([loadTexSet('g', 8, size, '/tex/'), loadTexSet('w', 8, size, '/tex/')]);
  const ws = new WorldStreamer(renderer, store, tg, tw, quality);
  scene.add(ws.group);
  let X = +(q.get('x') ?? 0), Z = +(q.get('z') ?? 0);
  if (q.get('lat')) { const p = store.project(+q.get('lat')!, +q.get('lon')!); X = p.x; Z = p.z; }
  const H = +(q.get('h') ?? 2), yaw = THREE.MathUtils.degToRad(+(q.get('yaw') ?? 0)), pitch = THREE.MathUtils.degToRad(+(q.get('pitch') ?? -8));
  camera.position.set(X, H, Z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  const w = window as any; w.__w = { ws, frames: 0 };
  const loop = () => {
    ws.update(X, Z);
    atmo.update(1 / 60, new THREE.Vector3(X, 0, Z), camera, 0);
    if (q.get('water')) groundShared.uWater.value = +q.get('water')!;
    renderer.render(scene, camera);
    w.__w.frames++; w.__w.tiles = ws.tiles.size;
    requestAnimationFrame(loop);
  };
  loop();
})();
