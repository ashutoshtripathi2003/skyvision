import * as THREE from 'three';
import { taxiSignTexture, textTexture, windsockTexture } from '../utils/Textures.js';
import { registerEmissive, registerAnimator } from '../lighting/LightRegistry.js';

// Airfield signage and the windsock.
export function createSigns() {
  const group = new THREE.Group();
  group.name = 'Signs';

  // Mandatory/location signs at the runway holding points (both faces printed).
  group.add(taxiSign(taxiSignTexture('A1', '36-18'), 20, 108));
  group.add(taxiSign(taxiSignTexture('A2', '18-36'), 20, -108));
  group.add(taxiSign(textTexture('A', {
    width: 256, height: 128, background: '#111', color: '#ffd400',
    font: 'bold 90px "Segoe UI", Arial, sans-serif',
  }), 31, 0, 2));

  group.add(createWindsock(-24, 70));
  return group;
}

// A sign board on two legs. The board is built facing +Z/-Z and then rotated
// 90 deg about Y so its faces point along the taxiway at taxiing aircraft.
function taxiSign(texture, x, z, width = 4) {
  const face = new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.05 });
  registerEmissive(face, 0.8, 0.05);
  const frame = new THREE.MeshStandardMaterial({ color: 0x222222 });

  const group = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(width, 1, 0.3), [frame, frame, frame, frame, face, face]);
  board.position.y = 1.2;
  board.castShadow = true;
  [-width / 2 + 0.3, width / 2 - 0.3].forEach((lx) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), frame);
    leg.position.set(lx, 0.4, 0);
    group.add(leg);
  });
  group.add(board);
  group.rotation.y = Math.PI / 2;
  group.position.set(x, 0, z);
  return group;
}

// A cone on a pole. Its yaw sways with a sine wave (wind direction) and the
// sock droops a little via a small rotation about its own X axis.
export function createWindsock(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.12, 7, 8),
    new THREE.MeshStandardMaterial({ color: 0xdddddd }),
  );
  pole.position.y = 3.5;
  pole.castShadow = true;
  group.add(pole);

  const pivot = new THREE.Group();
  pivot.position.y = 6.8;
  group.add(pivot);

  const sock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.55, 3.5, 16, 1, true),
    new THREE.MeshStandardMaterial({ map: windsockTexture(), side: THREE.DoubleSide }),
  );
  sock.rotation.x = Math.PI / 2; // lay the cylinder horizontally, wide end at the pole
  sock.position.z = 1.9;
  sock.castShadow = true;
  pivot.add(sock);

  registerAnimator((elapsed) => {
    pivot.rotation.y = 0.9 + Math.sin(elapsed * 0.7) * 0.25;
    pivot.rotation.x = 0.12 + Math.sin(elapsed * 2.3) * 0.04;
  });
  return group;
}
