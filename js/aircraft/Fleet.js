import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Aircraft } from './Aircraft.js';

const IS_TOUCH_DEVICE = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

// Parked aircraft drawn with instancing. For each type + livery one Aircraft is built,
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

function bakeTemplate(type, livery) {
  const plane = new Aircraft({ type, livery, realModel: false });
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

// placements: [{ x, y, z, heading, scale, livery, type }]  (type: a320 | a350 | a380)
export function createFleet(placements) {
  const group = new THREE.Group();
  group.name = 'Parked fleet';
  const byTemplate = new Map();
  placements.forEach((p) => {
    const key = `${p.type || 'a320'}|${p.livery}`;
    if (!byTemplate.has(key)) byTemplate.set(key, { type: p.type || 'a320', livery: p.livery, list: [] });
    byTemplate.get(key).list.push(p);
  });

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  byTemplate.forEach(({ type, livery, list }) => {
    bakeTemplate(type, livery).forEach(({ material, geometry }) => {
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((p, i) => {
        position.set(p.x, p.y, p.z);
        rotation.setFromAxisAngle(up, p.heading);
        scale.setScalar(p.scale);
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
        (p.instances ||= []).push({ mesh, index: i, matrix: matrix.clone() });
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
  });
  group.userData.lod = new FleetLOD(placements, group);
  return group;
}

// Level of detail for the parked fleet. Far away, every parked aircraft is an
// instance of the simple built-in model (a few draw calls for the whole fleet).
// The few closest to the camera are swapped for the detailed real-aircraft
// model: their instance is hidden (scaled to zero) and a full Aircraft object
// is placed there instead. Checked twice a second.
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class FleetLOD {
  constructor(placements, parent, { count = IS_TOUCH_DEVICE ? 3 : 8, range = IS_TOUCH_DEVICE ? 450 : 800 } = {}) {
    this.placements = placements;
    this.parent = parent;
    this.count = count;
    this.range = range;
    this.detailed = new Map(); // placement -> Aircraft
    this.timer = 0;
  }

  setInstanceVisible(p, visible) {
    (p.instances || []).forEach(({ mesh, index, matrix }) => {
      mesh.setMatrixAt(index, visible ? matrix : HIDDEN);
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  update(dt, cameraPosition) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const near = this.placements
      .map((p) => ({ p, d: Math.hypot(p.x - cameraPosition.x, p.y - cameraPosition.y, p.z - cameraPosition.z) }))
      .filter((e) => e.d < this.range)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.count)
      .map((e) => e.p);
    const wanted = new Set(near);
    this.detailed.forEach((plane, p) => {
      if (wanted.has(p)) return;
      plane.root.visible = false;
      this.setInstanceVisible(p, true);
      this.detailed.delete(p);
      p.cached = plane; // keep it for next time the camera comes close
    });
    near.forEach((p) => {
      if (this.detailed.has(p)) return;
      let plane = p.cached;
      if (!plane) {
        plane = new Aircraft({ type: p.type || 'a320', livery: p.livery });
        plane.root.position.set(p.x, p.y, p.z);
        plane.root.rotation.y = p.heading;
        plane.root.scale.setScalar(p.scale);
        this.parent.add(plane.root);
      }
      this.detailed.set(p, plane);
      // Swap only once the detailed model is ready, so nothing pops out of existence.
      const swap = () => {
        if (this.detailed.get(p) !== plane) return;
        plane.root.visible = true;
        this.setInstanceVisible(p, false);
      };
      if (plane.model) swap();
      else { plane.root.visible = false; plane.modelPromise.then(() => { if (plane.model) swap(); }); }
    });
  }
}
