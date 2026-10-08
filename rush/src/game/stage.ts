// Everything that lives across races: the renderer, materials, atmosphere, the world database, the terminals.
import * as THREE from 'three';
import { Engine } from '../render/engine';
import { Atmosphere } from '../render/atmosphere';
import { Materials } from '../render/materials';
import { Landmarks } from '../render/landmarks';
import type { GraphicsSettings } from '../render/quality';
import type { WorldData } from '../shared/world';
import type { TrackData } from '../shared/track';
import type { AdConfig } from '../render/props';
import { Props } from '../render/props';
import { WorldView } from '../render/worldView';
import { TrackView } from '../render/trackView';
import { Track } from '../shared/track';
import { routeBlocker } from '../render/clearance';
import { preloadCarAssets } from '../render/carAssets';
import { CARS } from '../shared/cars';

export interface Scenery { trackId: string; track: Track; world: WorldView; trackView: TrackView; props: Props; group: THREE.Group; key: string }

export class Stage {
  mats = new Materials();
  atmos: Atmosphere;
  landmarks: Landmarks | null = null;
  private landmarkDetail = -1;

  constructor(public engine: Engine, public world: WorldData, public tracks: TrackData[], public ads: AdConfig | null) {
    this.atmos = new Atmosphere(engine.scene, engine.renderer);
    this.mats.build(Math.min(engine.maxAniso, engine.settings.anisotropy));
  }

  static async load(canvas: HTMLCanvasElement, settings: GraphicsSettings, progress: (f: number, label: string) => void) {
    progress(0.05, 'Starting the engine');
    const engine = new Engine(canvas, settings);
    progress(0.15, 'Downloading Oshodi');
    const [world, tracks, ads] = await Promise.all([
      fetch('world/oshodi.json').then((r) => r.json()) as Promise<WorldData>,
      fetch('world/tracks.json').then((r) => r.json()) as Promise<TrackData[]>,
      fetch('ads/slots.json').then((r) => r.json()).catch(() => null) as Promise<AdConfig | null>,
    ]);
    // the cars, while the fonts load: bodies arrive compressed and are shared by every car that wears them
    progress(0.45, 'Polishing the cars');
    await Promise.all([
      preloadCarAssets(CARS.flatMap((c) => (c.model ? [c.model] : [])), (d, t) => progress(0.45 + 0.1 * (d / t), 'Polishing the cars')),
      loadFonts(),
    ]);
    progress(0.55, 'Painting the streets');
    await new Promise((r) => setTimeout(r, 0));
    const stage = new Stage(engine, world, tracks, ads);
    progress(0.75, 'Raising the terminals');
    stage.ensureLandmarks();
    progress(0.9, 'Lighting the sky');
    stage.atmos.set('dusk', 'clear', settings.drawDistance, settings.reflections);
    return stage;
  }

  private scenery: Scenery | null = null;
  political = true;

  /** The city dressed for one track. Kept until a different track (or different detail settings) is asked for. */
  sceneryFor(td: TrackData): Scenery {
    const s = this.engine.settings;
    const key = `${td.id}|${s.buildingDetail}|${s.props}|${s.shadows > 0}|${s.crowd}|${this.political}|${s.drawDistance}`;
    if (this.scenery && this.scenery.key === key) return this.scenery;
    this.dropScenery();
    const track = new Track(td);
    const shadows = s.shadows > 0;
    const world = new WorldView(this.world, track, this.mats, { detail: s.buildingDetail, drawDistance: s.drawDistance, shadows });
    const trackView = new TrackView(track, this.mats, { shadows, detail: s.buildingDetail });
    const props = new Props(this.world, track, world.buildingsKept, this.mats, { density: s.props, shadows, political: this.political, crowd: s.crowd, detail: s.buildingDetail }, this.ads);
    const group = new THREE.Group();
    group.add(world.group, trackView.group, props.group);
    this.engine.scene.add(group);
    this.scenery = { trackId: td.id, track, world, trackView, props, group, key };
    return this.scenery;
  }
  dropScenery() {
    if (!this.scenery) return;
    this.engine.scene.remove(this.scenery.group);
    disposeTree(this.scenery.group);
    this.scenery = null;
  }

  private blocker: ReturnType<typeof routeBlocker> | null = null;
  ensureLandmarks() {
    const d = this.engine.settings.buildingDetail;
    if (this.landmarks && this.landmarkDetail === d) return this.landmarks;
    if (this.landmarks) { this.engine.scene.remove(this.landmarks.group); disposeTree(this.landmarks.group); }
    this.blocker ??= routeBlocker(this.tracks);
    this.landmarks = new Landmarks(this.world, this.mats, { detail: d, shadows: this.engine.settings.shadows > 0, blocked: this.blocker });
    this.landmarkDetail = d;
    this.engine.scene.add(this.landmarks.group);
    return this.landmarks;
  }
}

/** Billboards, plates and signs are drawn on canvases, which use whatever font is loaded at that moment. Fonts
 *  only load when something asks for them, so ask explicitly before drawing anything. */
export async function loadFonts() {
  const faces = ['800 100px "Barlow Condensed"', '700 100px "Barlow Condensed"', '600 100px "Barlow Condensed"', '500 100px "Barlow Condensed"', '400 100px "Inter"', '600 100px "Inter"'];
  try { await Promise.all(faces.map((f) => document.fonts.load(f))); } catch { /* fall back to system fonts */ }
  await document.fonts.ready;
}

export function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}
