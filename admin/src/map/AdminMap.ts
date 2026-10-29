// The admin 3D map engine. One WebGL scene for the whole of Lagos:
//  - far: a baked top-down texture of every region (tools/bake-map.ts) plus the tall-building skyline
//  - near: the game's own region data (v2/src/world/region.ts) built into lighter 3D meshes around the camera:
//    roads, water, parcels (recolourable by ownership), and extruded buildings
//  - overlays: pins, circles and lines for parcels, POIs, mission givers, routes, events, potholes, factions, live players
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { RegionStore } from '@world/region';
import { plotPrice, type Plot } from '@world/plots';
import { buildRegion, ZONES, ZONE_RGB, type ParcelRef, type RegionMeshes } from './regionMesh';

export interface MapMeta { w: number; h: number; bounds: [number, number, number, number]; mpp: number; origin: { lat: number; lon: number }; regionSize: number; poiKinds: Record<string, string> }
export interface PinItem { id: string; x: number; z: number; label?: string; color?: number; size?: number; data?: any }
export interface CircleItem { id: string; x: number; z: number; r: number; color: number; label?: string; data?: any; fill?: number }
export interface LineItem { id: string; points: { x: number; z: number }[]; color: number; width?: number; label?: string; data?: any; dashed?: boolean }
export interface ParcelState { status: 'owned' | 'forsale' | 'vacant'; ownerId?: string | null; ownerName?: string | null; price?: number; flags?: string[]; color?: number }
export interface ParcelInfo { id: string; region: string; zone: string; rich: number; name: string | null; area: number; cx: number; cz: number; defaultPrice: number; buildings: { id: number; name: string | null; kind: number; levels: number }[]; state?: ParcelState }
export type Picked = { kind: 'pin' | 'circle' | 'line' | 'parcel' | 'ground'; layer: string; id: string; x: number; z: number; label?: string; data?: any; parcel?: ParcelInfo };
export type ParcelColorMode = 'status' | 'owner' | 'zone';

const NEAR_DIST = 6500;
const hashHue = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 360) / 360; };
export const ownerColor = (id: string) => new THREE.Color().setHSL(hashHue(id), 0.72, 0.58);

const pinVS = `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=size*uScale; }`;
const pinFS = `varying vec3 vC; uniform float uAlpha; void main(){ vec2 p=gl_PointCoord-0.5; float d=length(p); if(d>0.5) discard; float ring=smoothstep(0.30,0.40,d); vec3 c=mix(vC, vec3(0.03,0.04,0.07), ring*0.85); float a=smoothstep(0.5,0.44,d); gl_FragColor=vec4(c, a*uAlpha); }`;

interface PinLayer { name: string; items: PinItem[]; points: THREE.Points; visible: boolean; labels: boolean; pick: boolean; baseSize: number }
interface CircleLayer { name: string; items: CircleItem[]; group: THREE.Group; visible: boolean; labels: boolean }
interface LineLayer { name: string; items: LineItem[]; group: THREE.Group; visible: boolean; labels: boolean }

export class AdminMap {
  renderer!: THREE.WebGLRenderer; scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(50, 1, 4, 140000); controls!: MapControls;
  meta!: MapMeta; store!: RegionStore; private base!: THREE.Mesh; private towers: THREE.InstancedMesh | null = null;
  private pins = new Map<string, PinLayer>(); private circles = new Map<string, CircleLayer>(); private lines = new Map<string, LineLayer>();
  private regions = new Map<string, RegionMeshes>(); private loading = false; private nearEnabled = true; parcelMode: ParcelColorMode = 'status'; private parcelStates = new Map<string, ParcelState>(); showBuildings = true; showParcelLines = true;
  private mats!: { ground: THREE.Material; flat: THREE.Material; bld: THREE.Material; line: THREE.Material; floor: THREE.Material };
  private places: { n: string; k: string; x: number; z: number; l: string }[] = []; private labelEl: HTMLDivElement; private labelPool: HTMLDivElement[] = [];
  private selRing!: THREE.Points; private selOutline: Line2 | null = null; private hoverCb: ((p: Picked | null, sx: number, sy: number) => void) | null = null;
  private needsRender = true; private raf = 0; private disposed = false; private lastNear = 0; private animT: null | { t0: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; fd: number; td: number } = null;
  onPick: (p: Picked | null) => void = () => {}; onGround: (x: number, z: number, e: MouseEvent) => boolean | void = () => {}; onCamera: (s: { x: number; z: number; dist: number; near: boolean; regions: number }) => void = () => {}; onStatus: (s: string) => void = () => {};
  private keys = new Set<string>(); private edit: null | { points: { x: number; z: number }[]; change: (p: { x: number; z: number }[]) => void; insert: boolean } = null; private dragIdx = -1; private raycaster = new THREE.Raycaster(); private lineMats = new Set<LineMaterial>();
  worldUrl: string;

  constructor(private el: HTMLElement, worldUrl: string, private assetBase = './map/') {
    this.worldUrl = worldUrl; this.labelEl = document.createElement('div'); this.labelEl.className = 'labels';
  }

  async init() {
    const el = this.el; const canvas = document.createElement('canvas'); el.appendChild(canvas); el.appendChild(this.labelEl);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x07080d); this.scene.fog = new THREE.Fog(0x07080d, 30000, 110000);
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1c2a, 0.95)); const sun = new THREE.DirectionalLight(0xfff1dc, 1.35); sun.position.set(-0.5, 1, 0.65); this.scene.add(sun);
    this.mats = { ground: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false }), flat: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), bld: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), line: new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }), floor: new THREE.MeshBasicMaterial({ color: 0x0a0d14 }) };
    this.meta = await (await fetch(this.assetBase + 'meta.json')).json();
    this.store = new RegionStore(this.worldUrl); this.store.init().then(() => { this.requestNear(); this.onStatus(''); }).catch(() => this.onStatus('World data not reachable at ' + this.worldUrl + ': close-up detail is off. Set the world URL in Settings.'));
    await this.buildBase();
    // pins for the selected object
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1], 3)); sg.setAttribute('size', new THREE.Float32BufferAttribute([34], 1));
    this.selRing = new THREE.Points(sg, this.pinMaterial(1)); this.selRing.visible = false; this.selRing.renderOrder = 50; this.scene.add(this.selRing);
    const [bx0, bz0, bx1, bz1] = this.meta.bounds; this.controls = new MapControls(this.camera, canvas); this.controls.enableDamping = true; this.controls.dampingFactor = 0.12; this.controls.screenSpacePanning = false; this.controls.maxPolarAngle = Math.PI * 0.47; this.controls.minDistance = 70; this.controls.maxDistance = 70000; this.controls.zoomToCursor = true; this.controls.zoomSpeed = 1.2;
    this.controls.target.set(0, 0, -2500); this.camera.position.set(0, 22000, 16000); void bx0; void bz0; void bx1; void bz1;
    this.controls.addEventListener('change', () => { this.needsRender = true; });
    this.bindInput(canvas); const ro = new ResizeObserver(() => this.resize()); ro.observe(el); (this as any)._ro = ro; this.resize();
    const loop = () => { if (this.disposed) return; this.raf = requestAnimationFrame(loop); this.frame(); }; loop();
  }

  private async buildBase() {
    const tex = await new THREE.TextureLoader().loadAsync(this.assetBase + 'base.webp'); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const [bx0, bz0, bx1] = this.meta.bounds; const bz1 = bz0 + this.meta.h * this.meta.mpp; const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([bx0, 0, bz0, bx1, 0, bz0, bx1, 0, bz1, bx0, 0, bz1], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2)); g.setIndex([0, 2, 1, 0, 3, 2]);
    this.base = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, fog: false })); this.base.position.y = -0.6; this.scene.add(this.base);
    // skyline of tall buildings, instanced
    try {
      const buf = await (await fetch(this.assetBase + 'towers.bin')).arrayBuffer(); const n = new DataView(buf).getUint32(0, true); const f = new Float32Array(buf, 4, n * 6);
      const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x8e9ac0 }), n); const o = new THREE.Object3D();
      for (let i = 0; i < n; i++) { o.position.set(f[i * 6], 0, f[i * 6 + 1]); o.rotation.set(0, -f[i * 6 + 4], 0); o.scale.set(Math.max(6, f[i * 6 + 2]), f[i * 6 + 5], Math.max(6, f[i * 6 + 3])); o.updateMatrix(); m.setMatrixAt(i, o.matrix); }
      m.frustumCulled = false; this.towers = m; this.scene.add(m);
    } catch { /* skyline is optional */ }
    fetch(this.assetBase + 'places.json').then((r) => r.json()).then((p: [string, string, number, number][]) => { this.places = p.map(([n, k, x, z]) => ({ n, k, x, z, l: n.toLowerCase() })); this.needsRender = true; }).catch(() => {});
  }

  // ---------- overlays
  private pinMaterial(scale = 1) { return new THREE.ShaderMaterial({ vertexShader: pinVS, fragmentShader: pinFS, transparent: true, depthTest: false, depthWrite: false, uniforms: { uScale: { value: scale * Math.min(window.devicePixelRatio, 2) }, uAlpha: { value: 1 } } }); }
  setPins(name: string, items: PinItem[], o: { size?: number; labels?: boolean; pick?: boolean; visible?: boolean; order?: number } = {}) {
    const old = this.pins.get(name); if (old) { this.scene.remove(old.points); old.points.geometry.dispose(); }
    const pos = new Float32Array(items.length * 3), col = new Float32Array(items.length * 3), size = new Float32Array(items.length); const c = new THREE.Color();
    items.forEach((it, i) => { pos.set([it.x, 6, it.z], i * 3); c.setHex(it.color ?? 0x2de0c8); col.set([c.r, c.g, c.b], i * 3); size[i] = it.size ?? o.size ?? 9; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const pts = new THREE.Points(g, old ? (old.points.material as THREE.Material) : this.pinMaterial()); pts.frustumCulled = false; pts.renderOrder = 20 + (o.order ?? 0); pts.visible = o.visible ?? old?.visible ?? true; this.scene.add(pts);
    this.pins.set(name, { name, items, points: pts, visible: pts.visible, labels: o.labels ?? old?.labels ?? false, pick: o.pick ?? true, baseSize: o.size ?? 9 }); this.needsRender = true;
  }
  setCircles(name: string, items: CircleItem[], o: { labels?: boolean; visible?: boolean } = {}) {
    const old = this.circles.get(name); if (old) { this.scene.remove(old.group); old.group.traverse((x) => { const m = x as THREE.Mesh; m.geometry?.dispose(); }); }
    const group = new THREE.Group(); group.visible = o.visible ?? old?.visible ?? true;
    for (const it of items) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(it.r, 56).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: it.color, transparent: true, opacity: it.fill ?? 0.14, depthWrite: false, side: THREE.DoubleSide })); disc.position.set(it.x, 0.9, it.z); disc.renderOrder = 8; group.add(disc);
      const pts: number[] = []; for (let k = 0; k <= 64; k++) { const a = (k / 64) * Math.PI * 2; pts.push(it.x + Math.cos(a) * it.r, 1.2, it.z + Math.sin(a) * it.r); }
      group.add(this.line2(pts, it.color, 2, false, 9));
    }
    this.scene.add(group); this.circles.set(name, { name, items, group, visible: group.visible, labels: o.labels ?? old?.labels ?? false }); this.needsRender = true;
  }
  setLines(name: string, items: LineItem[], o: { labels?: boolean; visible?: boolean } = {}) {
    const old = this.lines.get(name); if (old) { this.scene.remove(old.group); old.group.traverse((x) => { const m = x as THREE.Mesh; m.geometry?.dispose(); }); }
    const group = new THREE.Group(); group.visible = o.visible ?? old?.visible ?? true;
    for (const it of items) { if (it.points.length < 2) continue; const pts: number[] = []; for (const p of it.points) pts.push(p.x, 7, p.z); group.add(this.line2(pts, it.color, it.width ?? 4, !!it.dashed, 30)); }
    this.scene.add(group); this.lines.set(name, { name, items, group, visible: group.visible, labels: o.labels ?? old?.labels ?? false }); this.needsRender = true;
  }
  private line2(pts: number[], color: number, width: number, dashed: boolean, order: number) {
    const g = new LineGeometry(); g.setPositions(pts); const m = new LineMaterial({ color, linewidth: width, transparent: true, depthTest: false, dashed, dashSize: 40, gapSize: 30 }); m.resolution.set(this.el.clientWidth, this.el.clientHeight); this.lineMats.add(m);
    const l = new Line2(g, m); if (dashed) l.computeLineDistances(); l.renderOrder = order; l.frustumCulled = false; return l;
  }
  setLayerVisible(name: string, v: boolean) { const p = this.pins.get(name); if (p) { p.visible = v; p.points.visible = v; } const c = this.circles.get(name); if (c) { c.visible = v; c.group.visible = v; } const l = this.lines.get(name); if (l) { l.visible = v; l.group.visible = v; } if (name === 'skyline' && this.towers) this.towers.visible = v; this.needsRender = true; }
  setLayerLabels(name: string, v: boolean) { const p = this.pins.get(name); if (p) p.labels = v; const c = this.circles.get(name); if (c) c.labels = v; const l = this.lines.get(name); if (l) l.labels = v; this.needsRender = true; }
  setNearDetail(v: boolean) { this.nearEnabled = v; this.requestNear(); this.needsRender = true; }
  setBuildings(v: boolean) { this.showBuildings = v; for (const r of this.regions.values()) if (r.buildingMesh) r.buildingMesh.visible = v; this.needsRender = true; }
  setParcelLines(v: boolean) { this.showParcelLines = v; for (const r of this.regions.values()) if (r.parcelLines) r.parcelLines.visible = v; this.needsRender = true; }
  setParcelStates(m: Map<string, ParcelState>) { this.parcelStates = m; for (const r of this.regions.values()) this.paintRegion(r); this.needsRender = true; }
  setParcelMode(mode: ParcelColorMode) { this.parcelMode = mode; for (const r of this.regions.values()) this.paintRegion(r); this.needsRender = true; }
  private paintRegion(r: RegionMeshes) {
    if (!r.parcelMesh) return; const col = r.parcelMesh.geometry.getAttribute('color') as THREE.BufferAttribute; const c = new THREE.Color();
    for (const p of r.parcels) {
      const st = this.parcelStates.get(p.id); let hex = ZONE_RGB[p.zone] ?? ZONE_RGB[1]; c.setHex(hex); let k = 1;
      if (this.parcelMode !== 'zone' && st) {
        if (st.flags?.length) c.setHex(0xff5d73); else if (st.status === 'forsale') c.setHex(0xf5b84a); else if (st.status === 'owned') { if (this.parcelMode === 'owner' && st.ownerId) c.copy(ownerColor(st.ownerId)); else c.setHex(0x2de0c8); }
        k = 1; if (st.status === 'owned' && this.parcelMode === 'status') k = 0.85;
      } else if (this.parcelMode !== 'zone') { c.setHex(hex); k = 1; }
      c.multiplyScalar(k); for (let i = 0; i < p.vCount; i++) col.setXYZ(p.vStart + i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  // ---------- selection, camera
  highlight(p: Picked | null) {
    if (this.selOutline) { this.scene.remove(this.selOutline); this.selOutline.geometry.dispose(); this.selOutline = null; }
    if (!p) { this.selRing.visible = false; this.needsRender = true; return; }
    this.selRing.position.set(p.x, 0, p.z); this.selRing.visible = p.kind !== 'ground' || true;
    if (p.kind === 'parcel' && p.parcel) { const reg = [...this.regions.values()].flatMap((r) => r.parcels).find((q) => q.id === p.parcel!.id); if (reg) { const pts: number[] = []; const n = reg.pts.length / 2; for (let i = 0; i <= n; i++) pts.push(reg.pts[(i % n) * 2], 1.2, reg.pts[(i % n) * 2 + 1]); this.selOutline = this.line2(pts, 0xffffff, 3, false, 60); this.scene.add(this.selOutline); } }
    this.needsRender = true;
  }
  flyTo(x: number, z: number, dist = 900, tilt = 0.9) {
    const from = this.controls.target.clone(), to = new THREE.Vector3(x, 0, z); const fd = this.camera.position.distanceTo(this.controls.target);
    this.animT = { t0: performance.now(), dur: 900, from, to, fd, td: dist }; void tilt; this.needsRender = true;
  }
  setView(x: number, z: number, dist: number, polar = 0.9) { this.controls.target.set(x, 0, z); this.camera.position.set(x, Math.cos(polar) * dist, z + Math.sin(polar) * dist); this.controls.update(); this.requestNear(); this.needsRender = true; }
  fitAll() { this.flyTo(-4500, -3800, 42000); }
  search(q: string, limit = 12) {
    const s = q.trim().toLowerCase(); if (s.length < 2) return []; const out: { n: string; k: string; x: number; z: number; score: number }[] = [];
    for (const p of this.places) { const i = p.l.indexOf(s); if (i < 0) continue; const rank = p.k === 'road' ? 3 : p.k.startsWith('poi:place') ? 0 : 1; out.push({ n: p.n, k: p.k, x: p.x, z: p.z, score: (i === 0 ? 0 : 5) + rank * 2 + p.n.length * 0.02 }); }
    out.sort((a, b) => a.score - b.score); const seen = new Set<string>(); return out.filter((r) => { const k = r.n + r.k; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
  }
  setHover(cb: (p: Picked | null, sx: number, sy: number) => void) { this.hoverCb = cb; }
  setEditPath(e: null | { points: { x: number; z: number }[]; change: (p: { x: number; z: number }[]) => void; insert?: boolean }) {
    this.edit = e ? { points: e.points, change: e.change, insert: !!e.insert } : null;
    if (e) { this.setPins('__edit', e.points.map((p, i) => ({ id: String(i), x: p.x, z: p.z, size: i === 0 || i === e.points.length - 1 ? 18 : 13, color: i === 0 ? 0x3ddc97 : i === e.points.length - 1 ? 0xff5d73 : 0xffffff })), { pick: false, order: 30 }); this.setLines('__editline', [{ id: 'e', points: e.points, color: 0xffffff, width: 3 }]); }
    else { this.setPins('__edit', [], { pick: false }); this.setLines('__editline', []); }
  }
  setEditInsert(v: boolean) { if (this.edit) this.edit.insert = v; }

  // ---------- input
  private bindInput(canvas: HTMLCanvasElement) {
    let down: { x: number; y: number; t: number; btn: number } | null = null; let moved = false;
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), btn: e.button }; moved = false; this.animT = null;
      if (this.edit && e.button === 0) { const i = this.nearestEditHandle(e); if (i >= 0) { if (e.altKey || e.metaKey) { const pts = this.edit.points.filter((_, k) => k !== i); this.edit.change(pts); down = null; return; } this.dragIdx = i; this.controls.enabled = false; canvas.setPointerCapture(e.pointerId); } }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) moved = true;
      if (this.dragIdx >= 0 && this.edit) { const g = this.groundAt(e); if (g) { const pts = this.edit.points.map((p, k) => (k === this.dragIdx ? { x: Math.round(g.x), z: Math.round(g.z) } : p)); this.edit.points = pts; this.edit.change(pts); } return; }
      if (!down && this.hoverCb) { this.hoverThrottle(e); }
    });
    const up = (e: PointerEvent) => {
      if (this.dragIdx >= 0) { this.dragIdx = -1; this.controls.enabled = true; down = null; return; }
      if (!down) return; const d = down; down = null; if (moved || performance.now() - d.t > 450 || d.btn !== 0) return;
      this.click(e);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKeyUp);
  }
  private onKey = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.closest('input,textarea,select')) return; const k = e.key.toLowerCase(); if ('wasdqe'.includes(k) && k.length === 1) { this.keys.add(k); this.animT = null; e.preventDefault(); } };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
  private ndc(e: { clientX: number; clientY: number }) { const r = this.renderer.domElement.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  groundAt(e: { clientX: number; clientY: number }) { const n = this.ndc(e); this.raycaster.setFromCamera(new THREE.Vector2(n.x, n.y), this.camera); const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); const v = new THREE.Vector3(); return this.raycaster.ray.intersectPlane(pl, v) ? v : null; }
  private project(x: number, y: number, z: number, out: THREE.Vector3) { out.set(x, y, z).project(this.camera); const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight; return { sx: (out.x * 0.5 + 0.5) * w, sy: (-out.y * 0.5 + 0.5) * h, vis: out.z > -1 && out.z < 1 }; }
  private nearestEditHandle(e: PointerEvent) { if (!this.edit) return -1; const n = this.ndc(e); const v = new THREE.Vector3(); let best = -1, bd = 16; this.edit.points.forEach((p, i) => { const s = this.project(p.x, 6, p.z, v); const d = Math.hypot(s.sx - n.sx, s.sy - n.sy); if (s.vis && d < bd) { bd = d; best = i; } }); return best; }
  private hoverT = 0; private hoverThrottle(e: PointerEvent) { const t = performance.now(); if (t - this.hoverT < 60) return; this.hoverT = t; const n = this.ndc(e); const hit = this.pickScreen(n.sx, n.sy, false); this.renderer.domElement.style.cursor = hit ? 'pointer' : this.edit ? 'crosshair' : 'grab'; this.hoverCb?.(hit, n.sx, n.sy); }
  /** Nearest pin/line/circle under a screen point. Parcels and buildings are tested separately (they need a ground point). */
  pickScreen(sx: number, sy: number, includeGround: boolean): Picked | null {
    const v = new THREE.Vector3(); let best: Picked | null = null; let bd = 14;
    for (const L of this.pins.values()) { if (!L.visible || !L.pick) continue; const maxd = Math.max(8, L.baseSize * 0.7 + 4); for (const it of L.items) { const s = this.project(it.x, 6, it.z, v); if (!s.vis) continue; const d = Math.hypot(s.sx - sx, s.sy - sy); if (d < Math.min(bd, maxd + 2)) { bd = d; best = { kind: 'pin', layer: L.name, id: it.id, x: it.x, z: it.z, label: it.label, data: it.data }; } } }
    if (best) return best;
    bd = 10; const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const L of this.lines.values()) { if (!L.visible || L.name.startsWith('__')) continue; for (const it of L.items) { for (let k = 0; k < it.points.length - 1; k++) { const p = it.points[k], q = it.points[k + 1]; const A = this.project(p.x, 7, p.z, a), B = this.project(q.x, 7, q.z, b); if (!A.vis && !B.vis) continue; const dx = B.sx - A.sx, dy = B.sy - A.sy, L2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((sx - A.sx) * dx + (sy - A.sy) * dy) / L2)); const d = Math.hypot(A.sx + dx * t - sx, A.sy + dy * t - sy); if (d < bd) { bd = d; best = { kind: 'line', layer: L.name, id: it.id, x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, label: it.label, data: it.data }; } } } }
    if (best) return best;
    if (includeGround) {
      const g = this.groundAt({ clientX: sx + this.renderer.domElement.getBoundingClientRect().left, clientY: sy + this.renderer.domElement.getBoundingClientRect().top }); if (g) {
        let bc: CircleItem | null = null, bl = ''; for (const L of this.circles.values()) { if (!L.visible) continue; for (const c of L.items) if (Math.hypot(c.x - g.x, c.z - g.z) <= c.r && (!bc || c.r < bc.r)) { bc = c; bl = L.name; } }
        if (bc) return { kind: 'circle', layer: bl, id: bc.id, x: bc.x, z: bc.z, label: bc.label, data: bc.data };
      }
    }
    return null;
  }
  private click(e: PointerEvent) {
    const n = this.ndc(e); const g = this.groundAt(e);
    if (this.edit && g) { if (this.nearestEditHandle(e) < 0) { const p = { x: Math.round(g.x), z: Math.round(g.z) }; let pts = [...this.edit.points]; if (this.edit.insert && pts.length >= 2) { let bi = 0, bd = Infinity; for (let i = 0; i < pts.length - 1; i++) { const A = pts[i], B = pts[i + 1]; const dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.z - A.z) * dz) / L2)); const d = Math.hypot(A.x + dx * t - p.x, A.z + dz * t - p.z); if (d < bd) { bd = d; bi = i; } } pts.splice(bi + 1, 0, p); } else pts.push(p); this.edit.points = pts; this.edit.change(pts); } return; }
    if (g && this.onGround(g.x, g.z, e) === true) return;
    const hit = this.pickScreen(n.sx, n.sy, true); if (hit) { this.onPick(hit); return; }
    if (!g) { this.onPick(null); return; }
    const parcel = this.pickParcel(e);
    if (parcel) { this.onPick(parcel); return; }
    this.onPick({ kind: 'ground', layer: 'ground', id: 'ground', x: g.x, z: g.z });
  }
  private pickParcel(e: { clientX: number; clientY: number }): Picked | null {
    const n = this.ndc(e); this.raycaster.setFromCamera(new THREE.Vector2(n.x, n.y), this.camera); const meshes: THREE.Object3D[] = []; for (const r of this.regions.values()) if (r.group.visible && r.parcelMesh) meshes.push(r.parcelMesh);
    const hits = this.raycaster.intersectObjects(meshes, false); const h = hits[0]; if (!h || h.faceIndex == null) return null;
    const reg = [...this.regions.values()].find((r) => r.parcelMesh === h.object)!; const p = reg.parcels[reg.pTri[h.faceIndex]]; if (!p) return null; return { kind: 'parcel', layer: 'parcels', id: p.id, x: p.cx, z: p.cz, label: p.name ?? p.id, parcel: this.parcelInfo(reg, p) };
  }
  private parcelInfo(reg: RegionMeshes, p: ParcelRef): ParcelInfo {
    const byId = new Map(reg.buildings.map((b) => [b.id, b])); const blds = p.bids.map((id) => byId.get(id) ?? this.store.bldById.get(id)).filter(Boolean).map((b: any) => ({ id: b.id, name: b.name ?? null, kind: b.kind, levels: b.levels }));
    const zone = ZONES[p.zone] ?? 'residential'; return { id: p.id, region: reg.key, zone, rich: p.rich, name: p.name, area: p.area, cx: p.cx, cz: p.cz, defaultPrice: plotPrice({ area: p.area, zone: zone as Plot['zone'], rich: p.rich } as Plot, p.cx, p.cz), buildings: blds, state: this.parcelStates.get(p.id) };
  }
  /** Finds a parcel by id among loaded regions (used to open "show on map" links). */
  findParcel(id: string): Picked | null { for (const r of this.regions.values()) { const p = r.parcels.find((q) => q.id === id); if (p) return { kind: 'parcel', layer: 'parcels', id: p.id, x: p.cx, z: p.cz, label: p.name ?? p.id, parcel: this.parcelInfo(r, p) }; } return null; }
  parcelAt(x: number, z: number): Picked | null {
    for (const r of this.regions.values()) for (const p of r.parcels) { if (Math.abs(p.cx - x) > 120 || Math.abs(p.cz - z) > 120) continue; let c = false; const n = p.pts.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p.pts[i * 2], zi = p.pts[i * 2 + 1], xj = p.pts[j * 2], zj = p.pts[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } if (c) return { kind: 'parcel', layer: 'parcels', id: p.id, x: p.cx, z: p.cz, label: p.name ?? p.id, parcel: this.parcelInfo(r, p) }; }
    return null;
  }

  // ---------- near LOD streaming
  private requestNear() { this.lastNear = 0; }
  private async streamNear() {
    if (this.loading || !this.store?.manifest) return; const t = this.controls.target; const dist = this.camera.position.distanceTo(t); const near = this.nearEnabled && dist < NEAR_DIST;
    for (const r of this.regions.values()) r.group.visible = near && this.inView(r);
    if (!near) return;
    const S = this.meta.regionSize; const R = Math.max(1500, dist * 0.8); const want: { i: number; j: number; d: number }[] = [];
    for (let i = Math.floor((t.x - R) / S); i <= Math.floor((t.x + R) / S); i++) for (let j = Math.floor((t.z - R) / S); j <= Math.floor((t.z + R) / S); j++) { if (!this.store.has(i, j)) continue; const cx = (i + 0.5) * S, cz = (j + 0.5) * S; want.push({ i, j, d: Math.hypot(cx - t.x, cz - t.z) }); }
    want.sort((a, b) => a.d - b.d); const MAXR = 9; const top = want.slice(0, MAXR); const keep = new Set(top.map((w) => `${w.i},${w.j}`));
    for (const [k, r] of this.regions) if (!keep.has(k) && this.regions.size > MAXR + 3) { this.scene.remove(r.group); r.dispose(); this.regions.delete(k); this.store.regions.delete(k); }
    const next = top.find((w) => !this.regions.has(`${w.i},${w.j}`)); if (!next) { for (const r of this.regions.values()) r.group.visible = keep.has(r.key); return; }
    this.loading = true;
    try {
      const reg = await this.store.load(next.i, next.j); if (!reg || this.disposed) return; await new Promise((r) => setTimeout(r, 0));
      const m = buildRegion(reg, this.mats); const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2), this.mats.floor); floor.position.set((next.i + 0.5) * S, -0.05, (next.j + 0.5) * S); floor.renderOrder = 0; m.group.add(floor);
      if (m.buildingMesh) m.buildingMesh.visible = this.showBuildings; if (m.parcelLines) m.parcelLines.visible = this.showParcelLines; this.paintRegion(m); this.scene.add(m.group); this.regions.set(m.key, m); this.needsRender = true; this.lastNear = 0;
    } catch (err) { this.onStatus('Could not load region: ' + (err as Error).message); this.lastNear = performance.now() + 4000; } finally { this.loading = false; }
  }
  private inView(r: RegionMeshes) { return true || r; }
  get loadedRegions() { return this.regions.size; }
  get parcelsLoaded() { let n = 0; for (const r of this.regions.values()) n += r.parcels.length; return n; }

  // ---------- frame
  private resize() { const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); for (const m of this.lineMats) m.resolution.set(w, h); this.needsRender = true; }
  private lastT = performance.now();
  private frame() {
    const now = performance.now(); const dt = Math.min(0.1, (now - this.lastT) / 1000); this.lastT = now; const dist = this.camera.position.distanceTo(this.controls.target);
    if (this.animT) { const a = this.animT; const k = Math.min(1, (now - a.t0) / a.dur); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; const dir = this.camera.position.clone().sub(this.controls.target).normalize(); if (dir.y < 0.35) dir.y = 0.35; dir.normalize(); const tgt = a.from.clone().lerp(a.to, e); const d = a.fd + (a.td - a.fd) * e; this.controls.target.copy(tgt); this.camera.position.copy(tgt).addScaledVector(dir, d); if (k >= 1) this.animT = null; this.needsRender = true; }
    if (this.keys.size) {
      const sp = dist * 0.9 * dt; const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); const right = new THREE.Vector3(-fwd.z, 0, fwd.x); const mv = new THREE.Vector3();
      if (this.keys.has('w')) mv.add(fwd); if (this.keys.has('s')) mv.sub(fwd); if (this.keys.has('d')) mv.add(right); if (this.keys.has('a')) mv.sub(right); mv.multiplyScalar(sp);
      const off = this.camera.position.clone().sub(this.controls.target); if (this.keys.has('e')) this.camera.position.sub(off.multiplyScalar(0.9 * dt)); if (this.keys.has('q')) this.camera.position.add(off.multiplyScalar(0.9 * dt));
      this.camera.position.add(mv); this.controls.target.add(mv); this.needsRender = true;
    }
    if (this.controls.update()) this.needsRender = true;
    this.camera.near = Math.max(3, dist * 0.02); this.camera.far = 140000; this.camera.updateProjectionMatrix();
    (this.scene.fog as THREE.Fog).near = dist * 3; (this.scene.fog as THREE.Fog).far = dist * 9 + 30000;
    if (now - this.lastNear > 300) { this.lastNear = now; void this.streamNear(); }
    if (this.needsRender) { this.needsRender = false; this.renderNow(); }
  }
  /** Scales the pin sprites with distance so they stay readable from the whole-map view down to street level. */
  renderNow() {
    const dist = this.camera.position.distanceTo(this.controls.target); const scale = Math.max(0.85, Math.min(1.35, 1.5 - dist / 40000));
    for (const L of this.pins.values()) (L.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale * Math.min(window.devicePixelRatio, 2);
    (this.selRing.material as THREE.ShaderMaterial).uniforms.uScale.value = Math.min(window.devicePixelRatio, 2);
    this.renderer.render(this.scene, this.camera); this.updateLabels(dist);
    const t = this.controls.target; this.onCamera({ x: t.x, z: t.z, dist, near: dist < NEAR_DIST, regions: this.regions.size });
  }
  private updateLabels(dist: number) {
    const cands: { n: string; x: number; z: number; cls: string; pri: number }[] = [];
    const PL: Record<string, [number, number]> = { 'poi:place:city': [1e9, 0], 'poi:place:town': [30000, 1], 'poi:place:suburb': [15000, 2], 'poi:place:neighbourhood': [7000, 3], 'poi:place:village': [9000, 3], 'poi:place:hamlet': [4500, 4] };
    for (const p of this.places) { const c = PL[p.k]; if (c && dist < c[0]) cands.push({ n: p.n, x: p.x, z: p.z, cls: 'place', pri: c[1] }); }
    for (const L of this.pins.values()) if (L.visible && L.labels && dist < 6000) for (const it of L.items) if (it.label) cands.push({ n: it.label, x: it.x, z: it.z, cls: 'pin', pri: 0.5 });
    for (const L of this.circles.values()) if (L.visible && L.labels) for (const it of L.items) if (it.label) cands.push({ n: it.label, x: it.x, z: it.z, cls: 'circ', pri: 0.4 });
    for (const L of this.lines.values()) if (L.visible && L.labels && !L.name.startsWith('__')) for (const it of L.items) if (it.label && it.points.length) { const m = it.points[(it.points.length / 2) | 0]; cands.push({ n: it.label, x: m.x, z: m.z, cls: 'line', pri: 0.3 }); }
    const v = new THREE.Vector3(); const W = this.el.clientWidth, H = this.el.clientHeight; const placed: [number, number, number, number][] = []; let used = 0; cands.sort((a, b) => a.pri - b.pri);
    for (const c of cands) {
      if (used >= 70) break; const s = this.project(c.x, 8, c.z, v); if (!s.vis || s.sx < -20 || s.sx > W + 20 || s.sy < 0 || s.sy > H) continue; const w = c.n.length * 6.4 + 10, h = 16; let hit = false; for (const q of placed) if (Math.abs(q[0] - s.sx) < (q[2] + w) / 2 && Math.abs(q[1] - s.sy) < (q[3] + h) / 2) { hit = true; break; } if (hit) continue; placed.push([s.sx, s.sy, w, h]);
      let el = this.labelPool[used]; if (!el) { el = document.createElement('div'); el.className = 'lbl'; this.labelEl.appendChild(el); this.labelPool[used] = el; }
      el.textContent = c.n; el.style.display = ''; el.style.transform = `translate(${s.sx.toFixed(0)}px,${(s.sy - (c.cls === 'place' ? 0 : 14)).toFixed(0)}px) translate(-50%,-50%)`; el.style.left = '0'; el.style.top = '0'; el.style.fontSize = c.cls === 'place' && c.pri <= 1 ? '13px' : '11px'; el.style.fontWeight = c.cls === 'place' && c.pri <= 1 ? '700' : '600'; el.style.color = c.cls === 'place' ? '#c9d3ea' : '#fff'; el.style.letterSpacing = c.cls === 'place' && c.pri <= 1 ? '.08em' : '0'; el.style.textTransform = c.cls === 'place' && c.pri <= 1 ? 'uppercase' : 'none'; used++;
    }
    for (let i = used; i < this.labelPool.length; i++) this.labelPool[i].style.display = 'none';
  }
  dispose() { this.disposed = true; cancelAnimationFrame(this.raf); window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKeyUp); (this as any)._ro?.disconnect(); this.controls?.dispose(); for (const r of this.regions.values()) r.dispose(); this.renderer?.dispose(); this.renderer?.domElement.remove(); this.labelEl.remove(); }
}
