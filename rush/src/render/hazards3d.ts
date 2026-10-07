// What the items look like in the world: burst Pure Water sachets, potholes, Gala rockets with a smoke trail, and
// the okada swarm cutting across the road.
import * as THREE from 'three';
import type { Hazard } from '../shared/items';
import type { Track } from '../shared/track';
import { parkedVehicle } from './traffic3d';
import { canvas, tex } from './textures';
import type { Fx } from './fx';

function sachetTexture() {
  const c = canvas(128), g = c.getContext('2d')!;
  g.fillStyle = 'rgba(235,245,255,0.95)'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1d6ad6'; g.font = '800 30px "Barlow Condensed", sans-serif'; g.textAlign = 'center';
  g.fillText('PURE', 64, 50); g.fillText('WATER', 64, 82);
  g.strokeStyle = '#1d6ad6'; g.lineWidth = 4; g.strokeRect(6, 6, 116, 116);
  return tex(c, { repeat: false });
}
function potholeTexture() {
  const c = canvas(128), g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 10, 64, 64, 62);
  gr.addColorStop(0, 'rgba(10,8,6,1)'); gr.addColorStop(0.55, 'rgba(40,30,22,0.95)'); gr.addColorStop(0.8, 'rgba(70,55,40,0.6)'); gr.addColorStop(1, 'rgba(70,55,40,0)');
  g.fillStyle = gr; g.beginPath();
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2, r = 46 + Math.sin(i * 2.3) * 9 + Math.cos(i * 5.1) * 5; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  g.fill();
  g.fillStyle = 'rgba(90,120,140,0.5)'; g.beginPath(); g.ellipse(58, 66, 18, 10, 0.3, 0, Math.PI * 2); g.fill(); // muddy water
  return tex(c, { repeat: false });
}

export class HazardView {
  group = new THREE.Group();
  private objs = new Map<number, THREE.Object3D>();
  private sachetMat = new THREE.MeshStandardMaterial({ map: sachetTexture(), roughness: 0.2, metalness: 0.05, transparent: true });
  private potholeMat = new THREE.MeshStandardMaterial({ map: potholeTexture(), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -14 });
  private rocketMat = new THREE.MeshStandardMaterial({ color: 0xd8a040, roughness: 0.5 });
  private wrapMat = new THREE.MeshStandardMaterial({ color: 0xd0141c, roughness: 0.4 });

  constructor(private track: Track, private fx: Fx) {}

  private make(h: Hazard): THREE.Object3D {
    const grp = new THREE.Group();
    if (h.kind === 'purewater') {
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), this.sachetMat);
      bag.scale.set(1.2, 0.35, 0.9); bag.position.y = 0.15;
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20), new THREE.MeshStandardMaterial({ color: 0x8ab0d0, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55, depthWrite: false }));
      puddle.rotation.x = -Math.PI / 2; puddle.position.y = 0.1;
      grp.add(bag, puddle);
    } else if (h.kind === 'pothole') {
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), this.potholeMat);
      hole.rotation.x = -Math.PI / 2; hole.position.y = 0.11;
      grp.add(hole);
      for (let i = 0; i < 6; i++) { const ch = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.1), new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 1 })); ch.position.set((Math.random() - 0.5) * 3.4, 0.14, (Math.random() - 0.5) * 3.4); grp.add(ch); }
    } else if (h.kind === 'rocket') {
      // a giant snack roll: pastry body, red wrapper band, little fins
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 1.0, 6, 12), this.rocketMat);
      body.rotation.x = Math.PI / 2;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 14), this.wrapMat);
      band.rotation.x = Math.PI / 2;
      grp.add(body, band);
      for (let i = 0; i < 3; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, 0.3), this.wrapMat); fin.position.set(0, 0, -0.55); fin.rotation.z = (i / 3) * Math.PI * 2; fin.translateY(0.25); grp.add(fin); }
      grp.position.y = 1.0;
    } else if (h.kind === 'okada') {
      // six okadas in a ragged line, crossing from one side of the road to the other
      for (let i = 0; i < 6; i++) {
        const bike = parkedVehicle('okada', [0x1a6ad6, 0xd62a2a, 0x2ab04a, 0xf2a900, 0xffffff, 0x8a2ad6][i]);
        bike.position.set(0, 0, (i - 2.5) * 2.2);
        bike.rotation.y = Math.PI / 2;
        bike.userData.offset = (i % 2) * 1.5 - i * 0.4;
        grp.add(bike);
      }
    }
    return grp;
  }

  sync(hazards: Hazard[], t: number, dt: number) {
    const live = new Set<number>();
    for (const h of hazards) {
      live.add(h.id);
      let o = this.objs.get(h.id);
      if (!o) { o = this.make(h); this.objs.set(h.id, o); this.group.add(o); }
      if (h.kind === 'okada') {
        const p = this.track.pointAt(h.s, 0);
        o.position.set(p.x, p.y, p.z);
        o.rotation.y = p.h;
        // ride across the road over the hazard's life
        const k = Math.sin(t * 2.2);
        o.children.forEach((b) => { b.position.x = (b.userData.offset as number) + k * p.hw * 0.9; });
      } else {
        o.position.x = h.x; o.position.z = h.z;
        o.position.y = h.y + (h.kind === 'rocket' ? 1.0 : 0);
        if (h.kind === 'rocket') {
          o.rotation.y = h.h;
          this.fx.flame(h.x, h.y + 1.0, h.z, Math.sin(h.h), Math.cos(h.h), false);
          this.fx.tyreSmoke(h.x, h.y + 0.8, h.z, 0, 0, 0.8, false);
        }
        if (h.kind === 'purewater') o.rotation.y += dt * 0.2;
      }
    }
    for (const [id, o] of this.objs) if (!live.has(id)) { this.group.remove(o); this.objs.delete(id); }
  }
}
