import * as THREE from 'three';
import { buildingTexture, facadeTexture } from '../../utils/Textures.js';
import { registerEmissive } from '../../lighting/LightRegistry.js';

// ~126,000 real building footprints (OpenStreetMap bounding boxes) drawn as
// instanced boxes. The city is split into a grid of chunks so the renderer can
// skip (frustum-cull) the chunks that are off screen. Two materials: low-rise
// buildings and glass towers (taller than 45 m).
const CHUNKS_X = 10;
const CHUNKS_Z = 7;
const TOWER_HEIGHT = 45;

const LOW_RISE_COLORS = [0xeae4d8, 0xdcd3c3, 0xe8dcc6, 0xcfd6d9, 0xe6c9b8, 0xd9e0cf, 0xf2efe8, 0xc9b9a6].map((c) => new THREE.Color(c));
const TOWER_COLORS = [0x9fb4c4, 0xb7c3cc, 0x8ea5b8, 0xc9d2d8, 0xa9b8a8].map((c) => new THREE.Color(c));

export function createMumbaiCity(data) {
  const lowRise = new THREE.MeshStandardMaterial({
    map: buildingTexture({ seed: 3 }), emissive: 0xffffff,
    emissiveMap: buildingTexture({ lit: true, seed: 3 }), emissiveIntensity: 0, roughness: 0.85,
  });
  const towers = new THREE.MeshStandardMaterial({
    map: facadeTexture({ columns: 3, rows: 8, seed: 5 }), emissive: 0xffffff,
    emissiveMap: facadeTexture({ columns: 3, rows: 8, lit: true, seed: 5 }), emissiveIntensity: 0,
    roughness: 0.35, metalness: 0.35,
  });
  registerEmissive(lowRise, 0.75);
  registerEmissive(towers, 1.0);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0); // base at y = 0 so scale.y is the building height

  const { minX, minZ, maxX, maxZ } = data.bounds;
  const chunkW = (maxX - minX) / CHUNKS_X;
  const chunkD = (maxZ - minZ) / CHUNKS_Z;
  const buckets = Array.from({ length: CHUNKS_X * CHUNKS_Z * 2 }, () => []);
  const { data: b, count } = data.cityBuildings;
  for (let k = 0; k < count; k++) {
    const x = b[k * 5];
    const z = b[k * 5 + 1];
    const ci = Math.min(CHUNKS_X - 1, Math.max(0, Math.floor((x - minX) / chunkW)));
    const cj = Math.min(CHUNKS_Z - 1, Math.max(0, Math.floor((z - minZ) / chunkD)));
    const tall = b[k * 5 + 4] / 10 >= TOWER_HEIGHT ? 1 : 0;
    buckets[(cj * CHUNKS_X + ci) * 2 + tall].push(k);
  }

  const group = new THREE.Group();
  group.name = 'Mumbai city';
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  buckets.forEach((list, index) => {
    if (list.length === 0) return;
    const tall = index % 2 === 1;
    const mesh = new THREE.InstancedMesh(geometry, tall ? towers : lowRise, list.length);
    list.forEach((k, i) => {
      const x = b[k * 5];
      const z = b[k * 5 + 1];
      const w = b[k * 5 + 2] / 10;
      const d = b[k * 5 + 3] / 10;
      const h = b[k * 5 + 4] / 10;
      // Model matrix = translation to the footprint centre x non-uniform scale (width, height, depth).
      matrix.makeScale(w, h, d).setPosition(x, data.heightAt(x, z) - 0.5, z);
      mesh.setMatrixAt(i, matrix);
      const palette = tall ? TOWER_COLORS : LOW_RISE_COLORS;
      mesh.setColorAt(i, color.copy(palette[k % palette.length]));
    });
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}
