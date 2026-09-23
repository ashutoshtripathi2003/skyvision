import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Aircraft } from './Aircraft.js';

// Parked aircraft drawn with instancing. For each livery one Aircraft is built,
// every mesh is "baked" into aircraft space (its world matrix applied to the
// vertices) and merged into one geometry per material. Each parked copy is then
// just one model matrix M = T * R * S in an InstancedMesh.

// A mirrored part (scale.x = -1) has its triangles wound the other way round;
// swap two corners of every triangle so its faces point outwards again.
function flipWinding(geometry) {
  Object.values(geometry.attributes).forEach((attr) => {
    const { array, itemSize } = attr;
    for (let t = 0; t < attr.count; t += 3) {
      for (let k = 0; k < itemSize; k++) {
        const a = (t + 1) * itemSize + k;
        const b = (t + 2) * itemSize + k;
        [array[a], array[b]] = [array[b], array[a]];
      }
    }
    attr.needsUpdate = true;
  });
}

function bakeTemplate(livery) {
  const plane = new Aircraft({ livery });
  plane.root.updateMatrixWorld(true);
  const byMaterial = new Map();
  plane.root.traverse((o) => {
    if (!o.isMesh) return;
    let visible = true;
    o.traverseAncestors((a) => { if (!a.visible) visible = false; });
    if (!o.visible || !visible) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    Object.keys(g.attributes).forEach((name) => {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    });
    g.clearGroups();
    g.applyMatrix4(o.matrixWorld);
    if (o.matrixWorld.determinant() < 0) flipWinding(g);
    if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
    byMaterial.get(o.material).push(g);
  });
  return [...byMaterial].map(([material, list]) => ({ material, geometry: mergeGeometries(list, false) }));
}

// placements: [{ x, y, z, heading, scale, livery }]
export function createFleet(placements) {
  const group = new THREE.Group();
  group.name = 'Parked fleet';
  const byLivery = new Map();
  placements.forEach((p) => {
    if (!byLivery.has(p.livery)) byLivery.set(p.livery, []);
    byLivery.get(p.livery).push(p);
  });

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  byLivery.forEach((list, livery) => {
    bakeTemplate(livery).forEach(({ material, geometry }) => {
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((p, i) => {
        position.set(p.x, p.y, p.z);
        rotation.setFromAxisAngle(up, p.heading);
        scale.setScalar(p.scale);
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
  });
  return group;
}
