// Collapses the many small static boxes of a procedural model (vehicles, weapons) into one mesh per material per
// parent group. Each danfo was ~40 draw calls and each gun ~15; after this they are a handful. Objects in `keep`
// (spinning wheels, lights that change brightness, muzzle points) and everything under them are left untouched, and
// merging happens inside each parent group, so groups that move (a body leaning on its suspension) still move.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function mergeStatic(root: THREE.Object3D, keep: Iterable<THREE.Object3D> = []) {
  const kept = new Set<THREE.Object3D>();
  for (const k of keep) k.traverse((o) => kept.add(o));
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => { if (!kept.has(o)) parents.push(o); });
  for (const parent of parents) {
    const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; meshes: THREE.Mesh[] }>();
    for (const child of parent.children) {
      const m = child as THREE.Mesh;
      if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh) continue;
      if (kept.has(m) || m.children.length || Array.isArray(m.material) || !m.visible) continue;
      const key = `${(m.material as THREE.Material).uuid}|${m.castShadow}|${m.receiveShadow}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat: m.material as THREE.Material, cast: m.castShadow, recv: m.receiveShadow, meshes: [] }));
      b.meshes.push(m);
    }
    for (const b of buckets.values()) {
      if (b.meshes.length < 2) continue;
      const geos: THREE.BufferGeometry[] = [];
      for (const m of b.meshes) {
        m.updateMatrix();
        let g = m.geometry.clone().applyMatrix4(m.matrix);
        if (!g.index) g = g.toNonIndexed();
        // keep only the attributes every primitive has, so they merge
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (g.index === null) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
        geos.push(g);
      }
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
      for (const m of b.meshes) parent.remove(m);
      parent.add(mesh);
      for (const g of geos) g.dispose();
    }
  }
}
