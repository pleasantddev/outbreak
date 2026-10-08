// The living backdrop behind the menus. On the main menu your car sits at the kerb beside the start line under the
// skywalk while traffic runs through the interchange, filmed in a few slow hero shots that keep it on the open side
// of the screen. The garage is its own lit workshop, cut to with a quick fade.
import * as THREE from 'three';
import type { Stage, Scenery } from '../game/stage';
import type { TrackData } from '../shared/track';
import { CarModel } from './cars3d';
import { carById, type Livery } from '../shared/cars';
import { Traffic, type TrafficPose } from '../shared/traffic';
import { TrafficView } from './traffic3d';
import { setWorldUniforms } from './materials';
import { GarageSet } from './garageSet';
import { skyReflection } from './atmosphere';
import type { DriverLook } from '../shared/drivers';

export type MenuView = 'city' | 'garage' | 'map';

// shots in track space around the parked car: ds along the road, dd across it, h above it
const SHOTS = [
  { ds: 8.5, dd: 4.4, h: 1.2, fov: 40, dolly: 0.22 },
  { ds: -9.5, dd: 3.4, h: 1.9, fov: 44, dolly: 0.3 },
  { ds: 24, dd: 1.2, h: 3.2, fov: 30, dolly: -0.35 },
  { ds: 3.5, dd: 6.2, h: 0.75, fov: 52, dolly: 0.18 },
];
const SHOT_LEN = 9;
const GARAGE_DROP = 160; // the workshop sits this far below street level, out of sight of everything

export class MenuScene {
  group = new THREE.Group();
  car: CarModel | null = null;
  private carId = '';
  private scen: Scenery;
  private traffic: Traffic; private trafficView: TrafficView; private poses: TrafficPose[] = [];
  private t = 0;
  view: MenuView = 'city';
  private shown: MenuView | null = null;
  private spot = new THREE.Vector3();
  private spotS = 22; private spotD = 0;
  private heading = 0;
  private garage: GarageSet;
  private garagePos = new THREE.Vector3();
  private camPos = new THREE.Vector3(); private camLook = new THREE.Vector3();
  private shot = 0; private shotT = 0;
  private fade: HTMLDivElement;
  spin = true;
  private yawOffset = 0;
  private carYaw = 0;
  private baseLight = { sun: 1, hemi: 1, env: 1 };

  constructor(private stage: Stage, td: TrackData) {
    this.scen = stage.sceneryFor(td);
    const tr = this.scen.track;
    // park the showcase car just past the start line, at the left kerb
    this.spotD = -tr.hwAt(this.spotS) * 0.55;
    const p = tr.pointAt(this.spotS, this.spotD);
    this.spot.set(p.x, p.y + 0.02, p.z);
    this.heading = p.h;
    this.carYaw = this.heading + 0.35;
    this.traffic = new Traffic(tr, 1, 99);
    this.trafficView = new TrafficView(this.traffic.cars, stage.engine.settings.shadows > 0);
    this.group.add(this.trafficView.group);
    this.garage = new GarageSet(stage.engine.settings.shadows > 0);
    this.garagePos.set(this.spot.x, this.spot.y - GARAGE_DROP, this.spot.z);
    this.garage.group.position.copy(this.garagePos);
    // hidden with its lights; three.js caches the shader variants, so only the first visit compiles anything
    this.garage.group.visible = false;
    this.group.add(this.garage.group);
    stage.engine.scene.add(this.group);
    this.fade = document.createElement('div');
    this.fade.className = 'scene-fade';
    document.body.insertBefore(this.fade, document.getElementById('ui'));
    this.applyView(true);
  }

  private get inGarage() { return this.view === 'garage'; }

  /** The player's driver, sat in whichever car the menu shows. */
  private look: DriverLook | undefined;
  setLook(look: DriverLook) { this.look = look; this.car?.setDriver(look); }

  setCar(carId: string, livery: Livery) {
    if (this.car && this.carId === carId) { this.car.applyLivery(livery); return; }
    if (this.car) { this.group.remove(this.car.root); this.car.dispose(); }
    const def = carById(carId);
    this.car = new CarModel(def, livery, { shadows: this.stage.engine.settings.shadows > 0, detail: 2, driver: this.look });
    if (livery.rims !== 'five') this.car.setRims(livery.rims);
    this.group.add(this.car.root);
    this.carId = carId;
    this.placeCar();
  }

  rotate(dx: number) { this.yawOffset += dx; }

  private placeCar() {
    if (!this.car) return;
    const at = this.shown === 'garage' ? this.garagePos : this.spot;
    this.car.root.position.set(at.x, at.y + (this.shown === 'garage' ? 0.1 : 0), at.z);
    this.car.root.rotation.y = this.carYaw;
  }

  /** Switch between the street, the map and the workshop. Every switch is a cut behind a short fade; gliding between
   *  the street and the map view 210 m up took the camera through bridge decks and left it mid air behind the next
   *  screen. */
  private applyView(first = false) {
    const garage = this.inGarage;
    if (!first) { this.fade.classList.remove('go'); void this.fade.offsetWidth; this.fade.classList.add('go'); }
    if (!first && (this.shown === 'garage') === garage) { this.shown = this.view; this.snapCamera(); return; }
    this.shown = this.view;
    this.garage.group.visible = garage;
    // the city stays loaded but is not drawn while we are inside
    this.scen.group.visible = !garage;
    if (this.stage.landmarks) this.stage.landmarks.group.visible = !garage;
    this.trafficView.group.visible = !garage;
    const a = this.stage.atmos;
    if (garage) {
      this.baseLight = { sun: a.sun.intensity, hemi: a.hemi.intensity, env: skyReflection.intensity };
      a.sun.intensity *= 0.25; a.hemi.intensity *= 0.35; a.setReflection(0.6);
      this.carYaw = this.heading + 2.4;
    } else if (!first) {
      a.sun.intensity = this.baseLight.sun; a.hemi.intensity = this.baseLight.hemi; a.setReflection(this.baseLight.env);
      this.carYaw = this.heading + 0.35;
    }
    this.placeCar();
    this.snapCamera();
  }

  private target(want: THREE.Vector3, look: THREE.Vector3): number {
    const cam = this.stage.engine.camera;
    if (this.inGarage) {
      // from the open end of the workshop toward the sign, far enough back that the car sits between the panels
      const g = this.garagePos;
      const a = Math.sin(this.t * 0.1) * 0.32;
      want.set(g.x + Math.sin(a) * 11, g.y + 2.3, g.z + Math.cos(a) * 11);
      look.set(g.x, g.y + 0.8, g.z);
      return 31;
    }
    if (this.view === 'map') {
      const s = this.spot;
      want.set(s.x - 120, s.y + 210, s.z - 160); look.set(40, 0, 20);
      return 55;
    }
    const tr = this.scen.track, sh = SHOTS[this.shot];
    const p = tr.pointAt(this.spotS + sh.ds + this.shotT * sh.dolly, this.spotD + sh.dd + Math.sin(this.t * 0.25) * 0.4);
    want.set(p.x, p.y + sh.h, p.z);
    look.set(this.spot.x, this.spot.y + 0.75, this.spot.z);
    // aim left of the car so it sits on the open right side of the screen, clear of the menu
    const aspect = cam.aspect;
    if (aspect > 1.15) {
      const fx = look.x - want.x, fz = look.z - want.z, dist = Math.hypot(fx, fz) || 1;
      const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(sh.fov) / 2) * aspect);
      const k = dist * 0.3 * Math.tan(hfov / 2);
      look.x += (fz / dist) * k; look.z -= (fx / dist) * k;
    }
    return sh.fov;
  }

  private snapCamera() {
    const want = new THREE.Vector3(), look = new THREE.Vector3();
    const fov = this.target(want, look);
    this.camPos.copy(want); this.camLook.copy(look);
    const cam = this.stage.engine.camera;
    cam.fov = fov; cam.updateProjectionMatrix();
  }

  frame(dt: number) {
    const st = this.stage, eng = st.engine;
    this.t += dt;
    if (this.view !== this.shown) this.applyView();
    setWorldUniforms(st.atmos.night, st.atmos.wet, this.t);
    if (!this.inGarage) {
      this.scen.props.setNight(st.atmos.night);
      this.traffic.poses(this.t, this.poses);
      // nothing drives through the parked car
      for (const p of this.poses) { const dx = p.x - this.spot.x, dz = p.z - this.spot.z; if (dx * dx + dz * dz < 196) p.vis = 0; }
      this.trafficView.update(this.poses);
      if (this.scen.trackView.bags) this.scen.trackView.bags.visible = true;
      this.scen.trackView.updateBags(this.t, () => true);
      this.scen.props.updateCrowd(this.t);
      st.landmarks?.update(this.t);
      this.shotT += dt;
      if (this.shotT > SHOT_LEN && this.view === 'city') { this.shotT = 0; this.shot = (this.shot + 1) % SHOTS.length; this.snapCamera(); }
    } else this.garage.update(this.t);
    if (this.car) {
      if (this.spin && this.inGarage) this.carYaw += dt * 0.22;
      this.carYaw += this.yawOffset; this.yawOffset = 0;
      this.car.root.rotation.y = this.carYaw;
      this.car.pose(dt, 0, 0, 0, 0, false, this.inGarage ? 0 : st.atmos.night, false);
      this.garage.turntable.rotation.y = this.carYaw;
    }
    const want = new THREE.Vector3(), look = new THREE.Vector3();
    const fov = this.target(want, look);
    const k = 1 - Math.exp(-dt * 2.2);
    this.camPos.lerp(want, k); this.camLook.lerp(look, k);
    eng.camera.position.copy(this.camPos);
    eng.camera.lookAt(this.camLook);
    eng.camera.fov += (fov - eng.camera.fov) * k;
    eng.camera.updateProjectionMatrix();
    const focus = this.inGarage ? this.garagePos : this.spot;
    st.atmos.follow(focus.x, focus.y, focus.z, this.inGarage ? 24 : 60, eng.settings.shadows, this.t);
    if (!this.inGarage) this.scen.world.update(this.camPos.x, this.camPos.z);
    eng.frame();
  }

  dispose() {
    // the scenery is shared with races, so leave it visible and the lights as they were
    this.scen.group.visible = true;
    if (this.stage.landmarks) this.stage.landmarks.group.visible = true;
    if (this.shown === 'garage') { const a = this.stage.atmos; a.sun.intensity = this.baseLight.sun; a.hemi.intensity = this.baseLight.hemi; a.setReflection(this.baseLight.env); }
    this.stage.engine.scene.remove(this.group);
    if (this.car) this.car.dispose();
    this.garage.dispose();
    this.trafficView.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.fade.remove();
  }
}
