import * as THREE from 'three';
import { asphaltTexture, concreteTexture } from '../utils/Textures.js';
import { createLamp } from '../lighting/LightRegistry.js';
import { RUNWAY_WIDTH } from './Runway.js';

// Airside ground layout (x = east, z = south):
//   Taxiway A   : parallel to the runway at x = 40
//   Connector A1: z = +100, joins runway south end to taxiway A and the apron
//   Connector A2: z = -100, joins runway north end to taxiway A
//   Apron       : concrete area x 45..88 in front of the terminal and hangar
export const TAXIWAY_A_X = 40;
export const CONNECTOR_A1_Z = 100;
export const CONNECTOR_A2_Z = -100;
export const APRON = { minX: 45, maxX: 88, minZ: -88, maxZ: 122 };
export const GATE_Z = [-55, -15];

const TAXI_WIDTH = 10;
const yellow = new THREE.MeshStandardMaterial({ color: 0xffc814, roughness: 0.8 });

function slab(width, length, x, z, material, y = 0.04) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, length), material);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  return mesh;
}

function line(width, length, x, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.02, length), yellow);
  mesh.position.set(x, 0.1, z);
  return mesh;
}

export function createTaxiways() {
  const group = new THREE.Group();
  group.name = 'Taxiways';

  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(2, 20), color: 0x9a9a9e, roughness: 0.95 });
  const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(8, 38), roughness: 0.9 });

  const lengthA = CONNECTOR_A1_Z - CONNECTOR_A2_Z + TAXI_WIDTH;
  const a1Length = APRON.minX - RUNWAY_WIDTH / 2;
  const a2Length = TAXIWAY_A_X - RUNWAY_WIDTH / 2 + TAXI_WIDTH / 2;

  group.add(slab(TAXI_WIDTH, lengthA, TAXIWAY_A_X, 0, asphalt));
  group.add(slab(a1Length, TAXI_WIDTH, RUNWAY_WIDTH / 2 + a1Length / 2, CONNECTOR_A1_Z, asphalt));
  group.add(slab(a2Length, TAXI_WIDTH, RUNWAY_WIDTH / 2 + a2Length / 2, CONNECTOR_A2_Z, asphalt));

  const apronW = APRON.maxX - APRON.minX;
  const apronL = APRON.maxZ - APRON.minZ;
  group.add(slab(apronW, apronL, APRON.minX + apronW / 2, APRON.minZ + apronL / 2, concrete, 0.03));

  group.add(createCenterlines());
  group.add(createHoldShortMarkings(CONNECTOR_A1_Z));
  group.add(createHoldShortMarkings(CONNECTOR_A2_Z));
  group.add(createStandMarkings());
  group.add(createEdgeLights());
  return group;
}

function createCenterlines() {
  const group = new THREE.Group();
  group.add(line(0.35, CONNECTOR_A1_Z - CONNECTOR_A2_Z, TAXIWAY_A_X, 0));
  group.add(line(APRON.minX + 30 - RUNWAY_WIDTH / 2, 0.35, (RUNWAY_WIDTH / 2 + APRON.minX + 30) / 2, CONNECTOR_A1_Z));
  group.add(line(TAXIWAY_A_X - RUNWAY_WIDTH / 2, 0.35, (TAXIWAY_A_X + RUNWAY_WIDTH / 2) / 2, CONNECTOR_A2_Z));
  return group;
}

// Two solid + two dashed yellow lines across the taxiway: "stop here before the runway".
function createHoldShortMarkings(z) {
  const group = new THREE.Group();
  const x = RUNWAY_WIDTH / 2 + 8;
  [0, 0.6].forEach((dx) => group.add(line(0.25, TAXI_WIDTH - 1, x + dx, z)));
  [1.4, 2.0].forEach((dx) => {
    for (let dz = -TAXI_WIDTH / 2 + 1; dz < TAXI_WIDTH / 2 - 1; dz += 1.6) {
      group.add(line(0.25, 0.9, x + dx, z + dz + 0.45));
    }
  });
  return group;
}

// Lead-in lines guiding aircraft to each gate, with a stop bar near the terminal.
function createStandMarkings() {
  const group = new THREE.Group();
  GATE_Z.forEach((z) => {
    group.add(line(APRON.maxX - APRON.minX - 6, 0.3, (APRON.minX + APRON.maxX - 6) / 2, z));
    group.add(line(0.5, 6, APRON.maxX - 4.5, z));
  });
  return group;
}

// Blue edge lights along taxiway A.
function createEdgeLights() {
  const group = new THREE.Group();
  for (let z = CONNECTOR_A2_Z + 12; z <= CONNECTOR_A1_Z - 12; z += 20) {
    [-1, 1].forEach((side) => {
      const lamp = createLamp(0x3a6bff, { glowSize: 2.2, scale: 0.8 });
      lamp.position.set(TAXIWAY_A_X + side * (TAXI_WIDTH / 2 + 0.6), 0.3, z);
      group.add(lamp);
    });
  }
  return group;
}
