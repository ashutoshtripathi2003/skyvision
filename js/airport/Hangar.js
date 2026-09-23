import * as THREE from 'three';
import { textTexture } from '../utils/Textures.js';
import { registerEmissive, registerLamp } from '../lighting/LightRegistry.js';

// Maintenance hangar with an arched roof, open towards the apron (-X).
// The aircraft starts just outside its door and parks inside after landing.
export const HANGAR = { x: 105, z: 100, depth: 34, width: 36, wallHeight: 6 };
const FRONT_X = HANGAR.x - HANGAR.depth / 2; // 88
const BACK_X = HANGAR.x + HANGAR.depth / 2;  // 122
const RADIUS = HANGAR.width / 2;
const ARCH_SCALE = 0.55;

export function createHangar() {
  const group = new THREE.Group();
  group.name = 'Hangar';

  const metal = new THREE.MeshStandardMaterial({
    color: 0xb9c2ca, metalness: 0.55, roughness: 0.45, side: THREE.DoubleSide,
  });
  const wall = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.7, side: THREE.DoubleSide });
  const floor = new THREE.MeshStandardMaterial({ color: 0xbfbfbb, roughness: 0.9 });

  const shadowed = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; };

  // Floor slab
  const slab = new THREE.Mesh(new THREE.BoxGeometry(HANGAR.depth, 0.1, HANGAR.width), floor);
  slab.position.set(HANGAR.x, 0.05, HANGAR.z);
  slab.receiveShadow = true;
  group.add(slab);

  // Side and back walls
  [-1, 1].forEach((side) => {
    const w = shadowed(new THREE.Mesh(new THREE.BoxGeometry(HANGAR.depth, HANGAR.wallHeight, 0.5), wall));
    w.position.set(HANGAR.x, HANGAR.wallHeight / 2, HANGAR.z + side * RADIUS);
    group.add(w);
  });
  const back = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.5, HANGAR.wallHeight, HANGAR.width), wall));
  back.position.set(BACK_X, HANGAR.wallHeight / 2, HANGAR.z);
  group.add(back);

  // Arched roof: half of an open cylinder, rotated 90 deg about Z so its axis
  // runs along X, then squashed vertically with a non-uniform scale.
  const roof = shadowed(new THREE.Mesh(
    new THREE.CylinderGeometry(RADIUS, RADIUS, HANGAR.depth, 40, 1, true, 0, Math.PI),
    metal,
  ));
  roof.rotation.z = Math.PI / 2;
  roof.scale.x = ARCH_SCALE; // local X becomes world Y after the rotation
  roof.position.set(HANGAR.x, HANGAR.wallHeight, HANGAR.z);
  group.add(roof);

  // Back gable: a half-disc with the same vertical squash.
  const gable = shadowed(new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 40, 0, Math.PI), wall));
  gable.rotation.y = Math.PI / 2;
  gable.scale.y = ARCH_SCALE;
  gable.position.set(BACK_X, HANGAR.wallHeight, HANGAR.z);
  group.add(gable);

  group.add(createDoorBeam());
  group.add(createFuelDepot());

  // Warm light inside the hangar at night.
  const inside = new THREE.PointLight(0xffe2b0, 0, 60, 2);
  inside.position.set(HANGAR.x + 4, 12, HANGAR.z);
  registerLamp(inside, 900);
  group.add(inside);

  return group;
}

function createDoorBeam() {
  const texture = textTexture('HANGAR 1', {
    width: 512, height: 64, background: '#1d2733', color: '#ffd400',
    font: 'bold 44px "Segoe UI", Arial, sans-serif',
  });
  const signMaterial = new THREE.MeshStandardMaterial({
    map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.1,
  });
  registerEmissive(signMaterial, 1, 0.1);
  const beamMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2733 });
  // Face order +x, -x, +y, -y, +z, -z: the text goes on the -x face (towards the apron).
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 1.8, 26),
    [beamMaterial, signMaterial, beamMaterial, beamMaterial, beamMaterial, beamMaterial],
  );
  beam.position.set(FRONT_X, 12.2, HANGAR.z);
  beam.castShadow = true;
  return beam;
}

function createFuelDepot() {
  const group = new THREE.Group();
  const tankMaterial = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, metalness: 0.3, roughness: 0.5 });
  const bandMaterial = new THREE.MeshStandardMaterial({ color: 0xd62828 });
  [62, 71].forEach((z) => {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 5, 24), tankMaterial);
    tank.position.set(116, 2.5, z);
    tank.castShadow = true;
    tank.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.55, 3.55, 0.6, 24), bandMaterial);
    band.position.set(116, 3.6, z);
    group.add(tank, band);
  });
  return group;
}
