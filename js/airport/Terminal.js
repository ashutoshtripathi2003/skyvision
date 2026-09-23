import * as THREE from 'three';
import { facadeTexture, concreteTexture, textTexture } from '../utils/Textures.js';
import { registerEmissive, registerLamp, createLamp } from '../lighting/LightRegistry.js';
import { GATE_Z } from './Taxiway.js';

// Passenger terminal: a glass box with a flattened barrel-vault roof, a lit
// name sign, jet bridges to each gate and floodlight masts over the apron.
export const TERMINAL = { x: 103, z: -35, depth: 30, length: 86, height: 12 };
const FRONT_X = TERMINAL.x - TERMINAL.depth / 2; // airside face (x = 88)

export function createTerminal() {
  const group = new THREE.Group();
  group.name = 'Terminal';

  group.add(createBody());
  group.add(createRoof());
  group.add(createNameSign());
  GATE_Z.forEach((z) => group.add(createJetBridge(z)));
  group.add(createFloodlights());
  return group;
}

function createBody() {
  const glass = new THREE.MeshStandardMaterial({
    map: facadeTexture({ columns: 32, rows: 3 }),
    emissive: 0xffffff,
    emissiveMap: facadeTexture({ columns: 32, rows: 3, lit: true }),
    emissiveIntensity: 0,
    roughness: 0.25, metalness: 0.4,
  });
  registerEmissive(glass, 1.3);
  const wall = new THREE.MeshStandardMaterial({ map: concreteTexture(2, 1), color: 0xe4e1da });
  const roofDeck = new THREE.MeshStandardMaterial({ color: 0x8c9197 });

  // BoxGeometry face order: +x, -x, +y, -y, +z, -z -> both long sides are glass.
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(TERMINAL.depth, TERMINAL.height, TERMINAL.length),
    [glass, glass, roofDeck, roofDeck, wall, wall],
  );
  body.position.set(TERMINAL.x, TERMINAL.height / 2, TERMINAL.z);
  body.castShadow = true;
  body.receiveShadow = true;
  return body;
}

// A half-cylinder rotated to lie along Z, then scaled down vertically (scale.z
// is applied in the cylinder's local frame, which becomes world Y after the
// rotation) to get a shallow curved roof.
function createRoof() {
  const radius = TERMINAL.depth / 2 + 2;
  const geometry = new THREE.CylinderGeometry(radius, radius, TERMINAL.length + 4, 40, 1, false, Math.PI / 2, Math.PI);
  const material = new THREE.MeshStandardMaterial({
    color: 0xc9d1d8, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide,
  });
  const roof = new THREE.Mesh(geometry, material);
  roof.rotation.x = Math.PI / 2;
  roof.scale.set(1, 1, 0.25);
  roof.position.set(TERMINAL.x, TERMINAL.height, TERMINAL.z);
  roof.castShadow = true;
  return roof;
}

function createNameSign() {
  const texture = textTexture('SKYVISION INTERNATIONAL AIRPORT', {
    width: 1024, height: 96, background: '#0d2a4a', color: '#ffffff',
    font: 'bold 58px "Segoe UI", Arial, sans-serif',
  });
  const material = new THREE.MeshStandardMaterial({
    map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.1,
  });
  registerEmissive(material, 1.2, 0.1);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(40, 3.75), material);
  sign.rotation.y = -Math.PI / 2; // plane normal +Z rotated to face -X (the apron)
  sign.position.set(FRONT_X - 0.2, TERMINAL.height - 2, TERMINAL.z);
  return sign;
}

// Jet bridge from the terminal to the parked aircraft's front door.
// Its length and yaw come from the vector between the two end points:
// translation to the midpoint + rotation by atan2(dx, dz).
function createJetBridge(gateZ) {
  const group = new THREE.Group();
  const start = new THREE.Vector3(FRONT_X, 3, gateZ - 9);
  const end = new THREE.Vector3(79.5, 3, gateZ - 2.6);
  const delta = new THREE.Vector3().subVectors(end, start);
  const length = delta.length();

  const material = new THREE.MeshStandardMaterial({ color: 0xd7dbe0, metalness: 0.3, roughness: 0.5 });
  const tunnel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, length), material);
  tunnel.position.copy(start).addScaledVector(delta, 0.5);
  tunnel.rotation.y = Math.atan2(delta.x, delta.z);
  tunnel.castShadow = true;

  const cab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 3.2), material);
  cab.position.copy(end);
  cab.rotation.y = tunnel.rotation.y;
  cab.castShadow = true;

  const leg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 1.7, 8),
    new THREE.MeshStandardMaterial({ color: 0x555a60 }),
  );
  leg.position.set(end.x + 1.5, 0.85, end.z - 1);

  group.add(tunnel, cab, leg);
  return group;
}

// Floodlight masts: real SpotLights (off by day) that light the apron at night.
function createFloodlights() {
  const group = new THREE.Group();
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x70767d });
  const masts = [
    { x: 84, z: -84, aim: [62, -45] },
    { x: 84, z: 10, aim: [62, -15] },
    { x: 84, z: 72, aim: [66, 100] },
  ];
  masts.forEach(({ x, z, aim }) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 22, 8), poleMaterial);
    pole.position.set(x, 11, z);
    pole.castShadow = true;

    const head = createLamp(0xfff0c8, { glowSize: 8, scale: 3 });
    head.position.set(x, 22.3, z);

    const spot = new THREE.SpotLight(0xffe8c0, 0, 0, Math.PI / 4, 0.6, 2);
    spot.position.set(x, 22, z);
    spot.target.position.set(aim[0], 0, aim[1]);
    registerLamp(spot, 2600);

    group.add(pole, head, spot, spot.target);
  });
  return group;
}
