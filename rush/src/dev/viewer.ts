// Developer viewer: renders the world, a track, the landmarks and a line of cars from a camera given in the URL.
// ?dev=world&track=terminal&cam=x,y,z&at=x,y,z&time=dusk&weather=clear&q=high
import * as THREE from 'three';
import { Engine } from '../render/engine';
import { Atmosphere } from '../render/atmosphere';
import { Materials, setWorldUniforms } from '../render/materials';
import { WorldView } from '../render/worldView';
import { Landmarks } from '../render/landmarks';
import { TrackView } from '../render/trackView';
import { CarModel } from '../render/cars3d';
import { settingsFor, type PresetId } from '../render/quality';
import { Track, type TrackData } from '../shared/track';
import type { WorldData } from '../shared/world';
import { CARS, defaultLivery } from '../shared/cars';
import { Props, type AdConfig } from '../render/props';

export async function runViewer(params: URLSearchParams) {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
  const q = (params.get('q') ?? 'high') as PresetId;
  const settings = settingsFor(q);
  const engine = new Engine(canvas, settings);
  const t0 = performance.now();
  const [world, tracks]: [WorldData, TrackData[]] = await Promise.all([fetch('/world/oshodi.json').then((r) => r.json()), fetch('/world/tracks.json').then((r) => r.json())]);
  const td = tracks.find((t) => t.id === (params.get('track') ?? 'terminal')) ?? tracks[0];
  const track = new Track(td);
  await document.fonts.ready;
  const mats = new Materials();
  mats.build(Math.min(engine.maxAniso, settings.anisotropy));
  const atmos = new Atmosphere(engine.scene, engine.renderer);
  atmos.set((params.get('time') ?? 'dusk') as any, (params.get('weather') ?? 'clear') as any, settings.drawDistance, settings.reflections);
  const wv = new WorldView(world, track, mats, { detail: settings.buildingDetail, drawDistance: settings.drawDistance, shadows: settings.shadows > 0 });
  engine.scene.add(wv.group);
  const lm = new Landmarks(world, mats, { detail: settings.buildingDetail, shadows: settings.shadows > 0 });
  engine.scene.add(lm.group);
  const tv = new TrackView(track, mats, { shadows: settings.shadows > 0, detail: settings.buildingDetail });
  engine.scene.add(tv.group);
  // &props=1 dresses the streets too: billboards, the giant house boards, fliers, signs, lights, crowds
  let props: Props | null = null;
  if (params.get('props')) {
    const ads = await fetch('/ads/slots.json').then((r) => r.json()).catch(() => null) as AdConfig | null;
    props = new Props(world, track, wv.buildingsKept, mats, { density: settings.props, shadows: settings.shadows > 0, political: true, crowd: settings.crowd, detail: settings.buildingDetail }, ads);
    engine.scene.add(props.group);
  }
  // a grid of every car on the start grid
  const cars: CarModel[] = [];
  CARS.forEach((def, i) => {
    const slot = td.grid[i];
    const lv = defaultLivery(def);
    if (i === 1) { lv.wrap = 'naija'; }
    if (i === 3) { lv.wrap = 'stripes'; lv.wrapColor = '#ffffff'; lv.rims = 'mesh'; }
    if (i === 6) { lv.wrap = 'fire'; lv.rims = 'turbine'; lv.glow = '#00e5ff'; }
    if (i === 7) { lv.finish = 'pearl'; lv.rims = 'split'; }
    if (i === 4) { lv.wrap = 'ankara'; lv.wrapColor = '#d0141c'; }
    const m = new CarModel(def, lv, { shadows: settings.shadows > 0, detail: 2 });
    if (lv.rims !== 'five') m.setRims(lv.rims);
    m.root.position.set(slot.x, slot.y + 0.02, slot.z);
    m.root.rotation.y = slot.h;
    engine.scene.add(m.root);
    cars.push(m);
  });
  console.log(`build ${(performance.now() - t0).toFixed(0)} ms; buildings ${wv.stats.buildings} removed ${wv.stats.removed} pushed ${wv.stats.pushed}`);
  const cam = (params.get('cam') ?? '60,12,-30').split(',').map(Number);
  const at = (params.get('at') ?? '80,2,30').split(',').map(Number);
  engine.camera.position.set(cam[0], cam[1], cam[2]);
  engine.camera.lookAt(at[0], at[1], at[2]);
  if (params.get('fov')) { engine.camera.fov = +params.get('fov')!; engine.camera.updateProjectionMatrix(); }
  const light = params.get('lights');
  if (light) tv.setLights(+light, light === '6');
  let t = 0;
  const loop = () => {
    const dt = engine.frame();
    t += dt;
    setWorldUniforms(atmos.night, atmos.wet, t);
    atmos.follow(engine.camera.position.x, 0, engine.camera.position.z, 90, settings.shadows, t);
    wv.update(engine.camera.position.x, engine.camera.position.z);
    lm.update(t);
    tv.updateBags(t, () => true);
    props?.setNight(atmos.night); props?.updateCrowd(t);
    for (const c of cars) c.pose(dt, 0, 0, 0, 0, false, atmos.night, false);
    requestAnimationFrame(loop);
  };
  loop();
  (window as any).__cam = (c: number[], a: number[], fov = 62) => { engine.camera.position.set(c[0], c[1], c[2]); engine.camera.lookAt(a[0], a[1], a[2]); engine.camera.fov = fov; engine.camera.updateProjectionMatrix(); };
  (window as any).__atmos = (time: string, weather: string) => atmos.set(time as any, weather as any, settings.drawDistance, settings.reflections);
  (window as any).__ready = true;
  (window as any).__perf = () => engine.perf;
  (window as any).__scene = engine.scene;
  (window as any).__engine = engine;
  (window as any).__THREE = THREE;
  (window as any).__spots = () => ({ giant: props?.giantSpots ?? [], fliers: props?.flierSpots ?? [] });
}
