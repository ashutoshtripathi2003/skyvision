import * as THREE from 'three';
import { asphaltTexture, textTexture } from '../utils/Textures.js';
import { createLamp, registerEmissive } from '../lighting/LightRegistry.js';
import { seededRandom } from '../utils/MathUtils.js';

// Landside: a rectangular loop road around the car park, running past the back
// of the terminal, plus an access highway heading east.
export const ROAD_LOOP = { minX: 125, maxX: 205, minZ: -105, maxZ: 20, width: 10 };
export const HIGHWAY_Z = -40;
const HIGHWAY_END_X = 900;

const white = new THREE.MeshStandardMaterial({ color: 0xeeeeee });

export function createRoads() {
  const group = new THREE.Group();
  group.name = 'Roads';
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(1, 12), color: 0x7a7a7e, roughness: 0.95 });

  const { minX, maxX, minZ, maxZ, width } = ROAD_LOOP;
  const loopW = maxX - minX;
  const loopL = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  // Four straight segments form the loop (west, east, north, south).
  [
    [width, loopL + width, minX, cz],
    [width, loopL + width, maxX, cz],
    [loopW + width, width, cx, minZ],
    [loopW + width, width, cx, maxZ],
  ].forEach(([w, l, x, z]) => group.add(roadSlab(w, l, x, z, asphalt)));
  group.add(roadSlab(HIGHWAY_END_X - maxX, 12, (maxX + HIGHWAY_END_X) / 2, HIGHWAY_Z, asphalt));

  group.add(dashedLine(minX, minZ, minX, maxZ));
  group.add(dashedLine(maxX, minZ, maxX, maxZ));
  group.add(dashedLine(minX, minZ, maxX, minZ));
  group.add(dashedLine(minX, maxZ, maxX, maxZ));
  group.add(dashedLine(maxX + 6, HIGHWAY_Z, 600, HIGHWAY_Z));

  group.add(createCarPark());
  group.add(createStreetLights());
  group.add(createWelcomeSign());
  return group;
}

function roadSlab(width, length, x, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, length), material);
  mesh.position.set(x, 0.04, z);
  mesh.receiveShadow = true;
  return mesh;
}

// Dashed white line between two points on an axis-aligned road.
function dashedLine(x1, z1, x2, z2) {
  const group = new THREE.Group();
  const alongX = z1 === z2;
  const length = alongX ? x2 - x1 : z2 - z1;
  const geometry = alongX ? new THREE.BoxGeometry(3, 0.02, 0.25) : new THREE.BoxGeometry(0.25, 0.02, 3);
  for (let d = 6; d < length - 6; d += 7) {
    const dash = new THREE.Mesh(geometry, white);
    dash.position.set(alongX ? x1 + d : x1, 0.09, alongX ? z1 : z1 + d);
    group.add(dash);
  }
  return group;
}

function createCarPark() {
  const group = new THREE.Group();
  const lot = { minX: 136, maxX: 194, minZ: -94, maxZ: 9 };
  const surface = new THREE.Mesh(
    new THREE.BoxGeometry(lot.maxX - lot.minX, 0.06, lot.maxZ - lot.minZ),
    new THREE.MeshStandardMaterial({ map: asphaltTexture(4, 6), color: 0x6e6e72 }),
  );
  surface.position.set((lot.minX + lot.maxX) / 2, 0.03, (lot.minZ + lot.maxZ) / 2);
  surface.receiveShadow = true;
  group.add(surface);

  const rand = seededRandom(42);
  const colors = [0xc0392b, 0x2e86de, 0xf5f6fa, 0x222f3e, 0xf6b93b, 0x7f8c8d, 0x10ac84];
  const stallGeometry = new THREE.BoxGeometry(0.15, 0.02, 5);
  // Rows of stalls facing each other across a driving aisle.
  [lot.minZ + 6, lot.minZ + 30, lot.minZ + 54, lot.minZ + 78].forEach((rowZ) => {
    for (let x = lot.minX + 3; x <= lot.maxX - 3; x += 3) {
      const stripe = new THREE.Mesh(stallGeometry, white);
      stripe.position.set(x, 0.07, rowZ);
      group.add(stripe);
      if (x < lot.maxX - 4 && rand() > 0.45) {
        const car = createParkedCar(colors[Math.floor(rand() * colors.length)]);
        car.position.set(x + 1.5, 0, rowZ);
        group.add(car);
      }
    }
  });
  return group;
}

const carGeometry = {
  body: new THREE.BoxGeometry(1.8, 0.8, 4.2),
  cabin: new THREE.BoxGeometry(1.6, 0.6, 2.2),
};
const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2833, metalness: 0.5, roughness: 0.2 });
const carMaterials = new Map();

function createParkedCar(color) {
  if (!carMaterials.has(color)) {
    carMaterials.set(color, new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.4 }));
  }
  const car = new THREE.Group();
  const body = new THREE.Mesh(carGeometry.body, carMaterials.get(color));
  body.position.y = 0.65;
  const cabin = new THREE.Mesh(carGeometry.cabin, cabinMaterial);
  cabin.position.set(0, 1.35, -0.2);
  body.castShadow = cabin.castShadow = true;
  car.add(body, cabin);
  return car;
}

function createStreetLights() {
  const group = new THREE.Group();
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x5c636a });
  const poleGeometry = new THREE.CylinderGeometry(0.12, 0.18, 8, 6);
  const positions = [];
  const { minX, maxX, minZ, maxZ, width } = ROAD_LOOP;
  const off = width / 2 + 1.2;
  for (let z = minZ + 10; z <= maxZ - 10; z += 25) positions.push([minX + off, z], [maxX + off, z]);
  for (let x = minX + 25; x < maxX; x += 25) positions.push([x, minZ - off], [x, maxZ + off]);
  for (let x = maxX + 30; x < 500; x += 40) positions.push([x, HIGHWAY_Z - 8]);

  positions.filter(([x, z]) => !(x > maxX && Math.abs(z - HIGHWAY_Z) < 7)).forEach(([x, z]) => {
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.set(x, 4, z);
    pole.castShadow = true;
    const lamp = createLamp(0xffc98a, { glowSize: 5, scale: 1.6 });
    lamp.position.set(x, 8.2, z);
    group.add(pole, lamp);
  });
  return group;
}

function createWelcomeSign() {
  const texture = textTexture('WELCOME TO SKYVISION', {
    width: 1024, height: 160, background: '#0d2a4a', color: '#ffffff',
    font: 'bold 84px "Segoe UI", Arial, sans-serif', border: '#ffd400',
  });
  const face = new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.05 });
  registerEmissive(face, 0.9, 0.05);
  const frame = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });
  const group = new THREE.Group();
  // Text on both the +z and -z faces so it reads from either side of the highway.
  const board = new THREE.Mesh(new THREE.BoxGeometry(24, 3.75, 0.5), [frame, frame, frame, frame, face, face]);
  board.position.y = 6;
  board.castShadow = true;
  [-9, 9].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.5, 0.5), frame);
    leg.position.set(x, 2.25, 0);
    group.add(leg);
  });
  group.add(board);
  group.position.set(250, 0, HIGHWAY_Z + 14);
  return group;
}
