// In-world route guide: glowing chevrons that flow along the road surface toward the active job, plus a beacon at the goal.
// One instanced mesh and one cylinder: two draw calls, no textures, no per-frame allocation.
import * as THREE from 'three';

const STEP = 4.5;

export class RouteLine {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private beam: THREE.Mesh; private ring: THREE.Mesh;
  private max: number;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private s = new THREE.Vector3(); private c = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, max = 72) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    // two arms of a flat chevron pointing +z, lying on the XZ plane
    const v = new Float32Array([-1.0, 0, -0.6, 0, 0, 0.5, 0, 0, 0, -1.0, 0, -1.1, 0, 0, 0.5, 1.0, 0, -0.6, 1.0, 0, -1.1, 0, 0, 0]);
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    // vertices: 0 A, 1 B, 2 E, 3 F, 4 B', 5 C, 6 D, 7 E'
    g.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, toneMapped: false, fog: false });
    this.mesh = new THREE.InstancedMesh(g, mat, max); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.group.add(this.mesh);

    const bm = new THREE.MeshBasicMaterial({ color: 0x2de0c8, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 90, 20, 1, true), bm); this.beam.position.y = 45; this.beam.visible = false; this.beam.frustumCulled = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.5, 32).rotateX(-Math.PI / 2), bm.clone()); this.ring.position.y = 0.1; this.ring.visible = false;
    this.group.add(this.beam, this.ring);
    scene.add(this.group); this.group.visible = false;
  }

  setBudget(n: number) { this.max = Math.max(8, Math.min(this.mesh.instanceMatrix.count, n)); }

  /** remaining: x,z pairs from the traveller onward; goal: world position of the objective or null. */
  update(time: number, remaining: number[] | null, goal: { x: number; z: number } | null, y = 0.07, onFoot = false) {
    if (!goal) { this.group.visible = false; return; }
    this.group.visible = true;
    const t = time;
    // beacon
    const bx = goal.x, bz = goal.z; this.beam.visible = this.ring.visible = true;
    this.beam.position.x = this.ring.position.x = bx; this.beam.position.z = this.ring.position.z = bz;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.1 * Math.sin(t * 2.2);
    const rs = 1 + 0.25 * ((t * 0.8) % 1); this.ring.scale.set(rs, 1, rs); (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - ((t * 0.8) % 1));
    // chevrons
    let n = 0;
    if (remaining && remaining.length >= 4) {
      const step = onFoot ? 3 : STEP, lead = onFoot ? 2 : 6, phase = (t * (onFoot ? 2.2 : 5)) % step;
      let seg = 0, segStart = 0; const cnt = remaining.length / 2 - 1;
      let ax = remaining[0], az = remaining[1], bx2 = remaining[2], bz2 = remaining[3], L = Math.hypot(bx2 - ax, bz2 - az);
      for (let i = 0; i < this.max; i++) {
        const sd = lead + phase + i * step;
        while (sd - segStart > L && seg < cnt - 1) {
          segStart += L; seg++; ax = remaining[seg * 2]; az = remaining[seg * 2 + 1]; bx2 = remaining[seg * 2 + 2]; bz2 = remaining[seg * 2 + 3]; L = Math.hypot(bx2 - ax, bz2 - az);
        }
        if (sd - segStart > L + 0.01) break; // past the end of the route
        const f = L > 1e-4 ? (sd - segStart) / L : 0; const dx = bx2 - ax, dz = bz2 - az;
        this.p.set(ax + dx * f, y, az + dz * f);
        this.q.setFromAxisAngle(this.up, Math.atan2(dx, dz));
        const fade = Math.max(0, 1 - (sd - lead) / (this.max * step)); const pulse = 0.65 + 0.35 * Math.sin(sd * 0.5 - t * 6);
        const sc = onFoot ? 0.55 : 0.95; this.s.set(sc, 1, sc);
        this.m.compose(this.p, this.q, this.s); this.mesh.setMatrixAt(n, this.m);
        const k = 0.9 * fade * pulse; this.c.setRGB(0.08 * k, 0.9 * k, 0.78 * k); this.mesh.setColorAt(n, this.c);
        n++;
      }
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() { this.group.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.beam.geometry.dispose(); this.ring.geometry.dispose(); }
}
