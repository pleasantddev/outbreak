// The living backdrop behind the menus: your car on a turntable beside the start line under the skywalk, traffic
// moving through the interchange, and a camera that drifts between a wide city shot and a close garage shot.
import * as THREE from 'three';
import type { Stage, Scenery } from '../game/stage';
import type { TrackData } from '../shared/track';
import { CarModel } from './cars3d';
import { carById, type Livery } from '../shared/cars';
import { Traffic, type TrafficPose } from '../shared/traffic';
import { TrafficView } from './traffic3d';
import { setWorldUniforms } from './materials';
import { GeoBuilder } from './geom';

export type MenuView = 'city' | 'garage' | 'map';

export class MenuScene {
  group = new THREE.Group();
  car: CarModel | null = null;
  private carId = '';
  private scen: Scenery;
  private traffic: Traffic; private trafficView: TrafficView; private poses: TrafficPose[] = [];
  private t = 0;
  view: MenuView = 'city';
  private spot = new THREE.Vector3();
  private heading = 0;
  private camPos = new THREE.Vector3(); private camLook = new THREE.Vector3();
  private turntable: THREE.Mesh;
  spin = true;
  private yawOffset = 0;

  constructor(private stage: Stage, td: TrackData) {
    this.scen = stage.sceneryFor(td);
    const tr = this.scen.track;
    // park the showcase car just past the start line, on the left side of the road
    const p = tr.pointAt(22, -tr.hwAt(22) * 0.35);
    this.spot.set(p.x, p.y + 0.06, p.z);
    this.heading = p.h;
    const g = new GeoBuilder();
    g.setColor([0.16, 0.16, 0.18]); g.cylinder(0, 0, 0, 3.6, 0.12, 48, true);
    g.setColor([0.96, 0.77, 0.08]); g.cylinder(0, 0.0, 0, 3.75, 0.1, 48, false);
    this.turntable = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }));
    this.turntable.position.copy(this.spot);
    this.turntable.receiveShadow = true;
    this.group.add(this.turntable);
    this.traffic = new Traffic(tr, 1, 99);
    this.trafficView = new TrafficView(this.traffic.cars, stage.engine.settings.shadows > 0);
    this.group.add(this.trafficView.group);
    stage.engine.scene.add(this.group);
    this.camPos.set(this.spot.x - 30, this.spot.y + 18, this.spot.z - 30);
    this.camLook.copy(this.spot);
  }

  setCar(carId: string, livery: Livery) {
    if (this.car && this.carId === carId) { this.car.applyLivery(livery); return; }
    if (this.car) { this.group.remove(this.car.root); this.car.dispose(); }
    const def = carById(carId);
    this.car = new CarModel(def, livery, { shadows: this.stage.engine.settings.shadows > 0, detail: 2 });
    if (livery.rims !== 'five') this.car.setRims(livery.rims);
    this.car.root.position.copy(this.spot);
    this.car.root.position.y += 0.12;
    this.car.root.rotation.y = this.heading + 0.6;
    this.group.add(this.car.root);
    this.carId = carId;
  }

  rotate(dx: number) { this.yawOffset += dx; }

  frame(dt: number) {
    const st = this.stage, eng = st.engine;
    this.t += dt;
    setWorldUniforms(st.atmos.night, st.atmos.wet, this.t);
    this.scen.props.setNight(st.atmos.night);
    this.traffic.poses(this.t, this.poses);
    this.trafficView.update(this.poses);
    this.scen.trackView.updateBags(this.t, () => true);
    this.scen.props.updateCrowd(this.t);
    st.landmarks?.update(this.t);
    if (this.car) {
      if (this.spin) this.car.root.rotation.y += dt * (this.view === 'garage' ? 0.25 : 0.12);
      this.car.root.rotation.y += this.yawOffset; this.yawOffset *= 0;
      this.car.pose(dt, 0, 0, 0, 0, false, st.atmos.night, false);
      this.turntable.rotation.y = this.car.root.rotation.y;
    }
    // camera targets per view
    const want = new THREE.Vector3(), look = new THREE.Vector3();
    const s = this.spot;
    if (this.view === 'garage') {
      const a = this.heading + Math.PI * 0.75 + Math.sin(this.t * 0.15) * 0.25;
      want.set(s.x + Math.sin(a) * 7.2, s.y + 1.9, s.z + Math.cos(a) * 7.2);
      look.set(s.x - Math.cos(this.heading) * 1.4, s.y + 0.7, s.z + Math.sin(this.heading) * 1.4);
    } else if (this.view === 'map') {
      want.set(s.x - 120, s.y + 210, s.z - 160); look.set(40, 0, 20);
    } else {
      // slow orbit that keeps the terminals and the skywalk in frame, with the car in the foreground
      const a = this.t * 0.035 + 2.2;
      want.set(s.x + Math.sin(a) * 26, s.y + 7 + Math.sin(this.t * 0.11) * 2.5, s.z + Math.cos(a) * 26);
      look.set(s.x + Math.sin(a + 2.4) * 30, s.y + 9, s.z + Math.cos(a + 2.4) * 30);
      look.lerp(s, 0.45);
    }
    const k = 1 - Math.exp(-dt * 1.6);
    this.camPos.lerp(want, k); this.camLook.lerp(look, k);
    eng.camera.position.copy(this.camPos);
    eng.camera.lookAt(this.camLook);
    eng.camera.fov += ((this.view === 'garage' ? 42 : 55) - eng.camera.fov) * k;
    eng.camera.updateProjectionMatrix();
    st.atmos.follow(s.x, s.y, s.z, 60, eng.settings.shadows, this.t);
    this.scen.world.update(this.camPos.x, this.camPos.z);
    eng.frame();
  }

  dispose() {
    this.stage.engine.scene.remove(this.group);
    if (this.car) this.car.dispose();
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
  }
}
