import * as THREE from 'three';
import { heightAt, slopeAt, LAKE } from './Terrain.js';
import { AIRFIELDS } from './AirfieldData.js';
import { seededRandom } from '../utils/MathUtils.js';
import { buildingTexture } from '../utils/Textures.js';
import { registerEmissive } from '../lighting/LightRegistry.js';

// Forests and a town drawn with InstancedMesh: one geometry + one material drawn
// thousands of times in a single draw call, each copy with its own model matrix
// M = T * R * S built by Matrix4.compose(position, rotation, scale).

const TREE_COUNT = 2600;
export const TOWN = { x: 2150, z: -2750, size: 520 };

function nearAirfield(x, z, margin) {
  return AIRFIELDS.some((f) => Math.hypot(x - f.x, z - f.z) < f.flatInner + margin);
}

export function createScenery() {
  const group = new THREE.Group();
  group.name = 'Scenery';
  group.add(createForests());
  group.add(createTown());
  return group;
}

function createForests() {
  const trunkGeometry = new THREE.CylinderGeometry(0.35, 0.5, 3, 5);
  trunkGeometry.translate(0, 1.5, 0);
  const canopyGeometry = new THREE.ConeGeometry(2.6, 7, 6);
  canopyGeometry.translate(0, 6.3, 0);

  const trunks = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshStandardMaterial({ color: 0x5e3d21 }), TREE_COUNT);
  const canopies = new THREE.InstancedMesh(canopyGeometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), TREE_COUNT);

  const rand = seededRandom(2024);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  const shades = [0x2f5e27, 0x3b7030, 0x27502a, 0x4a7b35];

  let placed = 0;
  let attempts = 0;
  while (placed < TREE_COUNT && attempts < TREE_COUNT * 30) {
    attempts++;
    // Cluster trees into forests by sampling around random forest centres.
    const cx = (rand() - 0.5) * 12000;
    const cz = (rand() - 0.5) * 12000;
    for (let k = 0; k < 14 && placed < TREE_COUNT; k++) {
      const x = cx + (rand() - 0.5) * 360;
      const z = cz + (rand() - 0.5) * 360;
      const h = heightAt(x, z);
      if (h < 2 || h > 430) continue;
      if (slopeAt(x, z) < 0.85) continue;
      if (nearAirfield(x, z, 120)) continue;
      if (Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz) < 1.15) continue;
      if (Math.abs(x - TOWN.x) < TOWN.size / 2 + 40 && Math.abs(z - TOWN.z) < TOWN.size / 2 + 40) continue;

      position.set(x, h - 0.3, z);
      rotation.setFromAxisAngle(up, rand() * Math.PI * 2);
      const s = 0.8 + rand() * 1.1;
      scale.set(s, s * (0.85 + rand() * 0.4), s);
      matrix.compose(position, rotation, scale);
      trunks.setMatrixAt(placed, matrix);
      canopies.setMatrixAt(placed, matrix);
      canopies.setColorAt(placed, color.set(shades[placed % shades.length]));
      placed++;
    }
  }
  trunks.count = placed;
  canopies.count = placed;

  const group = new THREE.Group();
  group.add(trunks, canopies);
  return group;
}

function createTown() {
  const COUNT = 140;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0); // pivot at the base so scale.y = building height
  const material = new THREE.MeshStandardMaterial({
    map: buildingTexture({ seed: 8 }),
    emissive: 0xffffff,
    emissiveMap: buildingTexture({ lit: true, seed: 8 }),
    emissiveIntensity: 0,
    roughness: 0.8,
  });
  registerEmissive(material, 0.9);
  const buildings = new THREE.InstancedMesh(geometry, material, COUNT);
  buildings.castShadow = true;
  buildings.receiveShadow = true;

  const rand = seededRandom(77);
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  const palette = [0xe8e2d4, 0xd9c7a7, 0xbfc8cf, 0xe0b8a0, 0xc9d6c0, 0xf0ece4];
  const block = 34;
  const cells = Math.floor(TOWN.size / block);

  let i = 0;
  for (let gx = 0; gx < cells && i < COUNT; gx++) {
    for (let gz = 0; gz < cells && i < COUNT; gz++) {
      if (gx % 4 === 3 || gz % 4 === 3) continue; // leave streets
      const x = TOWN.x - TOWN.size / 2 + gx * block + (rand() - 0.5) * 6;
      const z = TOWN.z - TOWN.size / 2 + gz * block + (rand() - 0.5) * 6;
      const distCentre = Math.hypot(x - TOWN.x, z - TOWN.z) / (TOWN.size / 2);
      const height = 6 + rand() * 12 + Math.max(0, 1 - distCentre) * 38 * rand(); // taller downtown
      matrix.compose(
        new THREE.Vector3(x, heightAt(x, z) - 0.5, z),
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * 0.1),
        new THREE.Vector3(16 + rand() * 10, height, 16 + rand() * 10),
      );
      buildings.setMatrixAt(i, matrix);
      buildings.setColorAt(i, color.set(palette[Math.floor(rand() * palette.length)]));
      i++;
    }
  }
  buildings.count = i;
  return buildings;
}
