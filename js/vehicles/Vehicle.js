import * as THREE from 'three';
import { createFlashingLamp } from '../lighting/LightRegistry.js';

// Ground vehicle models built from boxes and cylinders. Front of every vehicle is +Z.

const wheelGeometry = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 12);
const tyreMaterial = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2833, metalness: 0.5, roughness: 0.2 });

function box(w, h, l, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function addWheels(group, halfTrack, zPositions, radius = 0.45) {
  zPositions.forEach((z) => {
    [-1, 1].forEach((side) => {
      const wheel = new THREE.Mesh(wheelGeometry, tyreMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.scale.set(radius / 0.45, 1, radius / 0.45);
      wheel.position.set(side * halfTrack, radius, z);
      group.add(wheel);
    });
  });
}

function finish(group) {
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

// Amber rotating beacon that every airside vehicle carries.
function addBeacon(group, y, z) {
  const beacon = createFlashingLamp(0xffa000, 3.5);
  beacon.group.position.set(0, y, z);
  group.add(beacon.group);
  group.userData.beacon = beacon;
}

export function createBus() {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0x1f5fbf, metalness: 0.2, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  group.add(box(2.6, 1.4, 11, paint, 0, 1.3, 0));
  group.add(box(2.6, 1.3, 11, white, 0, 2.65, 0));
  group.add(box(2.65, 0.8, 10.2, glassMaterial, 0, 2.6, -0.2)); // side window band
  group.add(box(2.3, 1.1, 0.1, glassMaterial, 0, 2.5, 5.52));   // windscreen
  addWheels(group, 1.2, [-3.5, 3.5]);
  return finish(group);
}

export function createFuelTruck() {
  const group = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 });
  const tank = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.5, roughness: 0.35 });
  group.add(box(2.4, 2.2, 2.4, red, 0, 1.55, 3.2));                // cab
  group.add(box(2.2, 0.8, 0.1, glassMaterial, 0, 2.1, 4.42));      // windscreen
  group.add(box(2.4, 0.4, 8, red, 0, 0.75, -0.6));                 // chassis
  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 5.6, 20), tank);
  cylinder.rotation.x = Math.PI / 2; // tank axis along Z
  cylinder.position.set(0, 2.1, -1.6);
  group.add(cylinder);
  addWheels(group, 1.1, [3, -2.5, -3.8]);
  addBeacon(group, 2.8, 3.2);
  return finish(group);
}

export function createBaggageTug() {
  const group = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.5 });
  group.add(box(1.6, 0.8, 2.6, yellow, 0, 0.75, 0));
  group.add(box(1.4, 0.9, 0.9, glassMaterial, 0, 1.55, -0.4));
  addWheels(group, 0.75, [0.8, -0.8], 0.35);
  addBeacon(group, 2.1, -0.4);
  return finish(group);
}

export function createBaggageCart() {
  const group = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x5d6d7e });
  const bags = [0x2c3e50, 0x8e44ad, 0x27ae60, 0xd35400].map((c) => new THREE.MeshStandardMaterial({ color: c }));
  group.add(box(1.5, 0.2, 2.4, frame, 0, 0.6, 0));
  for (let i = 0; i < 4; i++) {
    group.add(box(0.6, 0.45, 0.8, bags[i], i % 2 ? 0.35 : -0.35, 0.95, i < 2 ? 0.5 : -0.5));
  }
  addWheels(group, 0.7, [0.8, -0.8], 0.3);
  return finish(group);
}
