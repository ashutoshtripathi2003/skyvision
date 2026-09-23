import * as THREE from 'three';
import { seededRandom } from '../utils/MathUtils.js';
import { HIGHWAY_Z } from './Road.js';

// Individually modelled trees around the home airport (the wider landscape
// and its forests come from world/Terrain.js and world/Scenery.js).
const TREE_COUNT = 90;

export function createEnvironment() {
  const group = new THREE.Group();
  group.name = 'Environment';
  group.add(createTrees());
  return group;
}

// Trees must stay out of the airfield, the runway's approach/departure path and the highway.
function isClearForTree(x, z) {
  const inAirfield = x > -45 && x < 225 && z > -160 && z < 205;
  const underFlightPath = Math.abs(x) < 50;
  const onHighway = x > 200 && Math.abs(z - HIGHWAY_Z) < 20;
  return !inAirfield && !underFlightPath && !onHighway;
}

const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.45, 3, 6);
const canopyGeometry = new THREE.ConeGeometry(2.4, 6, 8);
const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4423 });
const canopyMaterials = [0x2e6b1f, 0x3a7d2a, 0x285e1c].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
);

function createTrees() {
  const group = new THREE.Group();
  const rand = seededRandom(1234);
  let placed = 0;
  while (placed < TREE_COUNT) {
    const x = -300 + rand() * 700;
    const z = -420 + rand() * 820;
    if (!isClearForTree(x, z)) continue;
    const tree = createTree(canopyMaterials[placed % canopyMaterials.length]);
    tree.position.set(x, 0, z);
    tree.scale.setScalar(0.8 + rand() * 0.9); // uniform scaling gives size variety
    tree.rotation.y = rand() * Math.PI * 2;
    group.add(tree);
    placed++;
  }
  return group;
}

function createTree(canopyMaterial) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.position.y = 1.5;
  const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
  canopy.position.y = 5.8;
  trunk.castShadow = canopy.castShadow = true;
  tree.add(trunk, canopy);
  return tree;
}
