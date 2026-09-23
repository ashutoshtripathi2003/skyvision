import * as THREE from 'three';
import { registerEmissive, registerAnimator, createFlashingLamp } from '../lighting/LightRegistry.js';

// Air-traffic-control tower built from stacked cylinders. An 8-sided cylinder
// gives the octagonal glass cab. The radar on top rotates continuously and a
// red obstruction light blinks: both are simple per-frame rotations/toggles.
export const TOWER = { x: 105, z: 45, cabHeight: 34 };

// Built at the local origin; the home tower is placed at TOWER, other airfields place their own.
export function createTower({ x = TOWER.x, z = TOWER.z } = {}) {
  const group = new THREE.Group();
  group.name = 'ControlTower';
  group.position.set(x, 0, z);

  const concrete = new THREE.MeshStandardMaterial({ color: 0xdedbd4, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.5, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x5f8fa8, metalness: 0.6, roughness: 0.15,
    emissive: 0x8cffc8, emissiveIntensity: 0,
  });
  registerEmissive(glass, 0.9);

  const add = (geometry, material, y) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  add(new THREE.BoxGeometry(12, 6, 12), concrete, 3);                        // base building
  add(new THREE.CylinderGeometry(2.2, 2.9, 26, 20), concrete, 6 + 13);       // shaft
  add(new THREE.CylinderGeometry(5.2, 4.2, 1.2, 8), dark, 31.6);             // cab floor
  add(new THREE.CylinderGeometry(5.0, 4.4, 4, 8, 1), glass, 34.2);           // glass cab
  add(new THREE.CylinderGeometry(5.8, 5.2, 0.9, 8), dark, 36.6);             // roof
  add(new THREE.CylinderGeometry(0.12, 0.12, 5, 6), dark, 39.5);             // antenna mast

  const radar = new THREE.Group();
  radar.position.y = 37.8;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 0.25), dark);
  arm.position.z = 0.9;
  arm.castShadow = true;
  radar.add(arm);
  group.add(radar);

  const beacon = createFlashingLamp(0xff2020, 5);
  beacon.group.position.y = 42.2;
  group.add(beacon.group);

  registerAnimator((elapsed, k, dt) => {
    radar.rotation.y += dt * 1.6; // rotation about the Y axis
    const on = Math.floor(elapsed * 1.2) % 2 === 0;
    beacon.bulb.emissiveIntensity = on ? 3 + 3 * k : 0.2;
    beacon.glow.opacity = on ? 0.3 + 0.7 * k : 0;
  });

  return group;
}
