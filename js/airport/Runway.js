import * as THREE from 'three';
import { asphaltTexture, textTexture } from '../utils/Textures.js';
import { createLampBatch, createFlashingLamp, registerAnimator } from '../lighting/LightRegistry.js';

// Home runway 36/18 runs along the Z axis from z = +120 (south threshold) to
// z = -280. North is -Z, so aircraft take off towards -Z (runway 36).
export const RUNWAY_LENGTH = 400;
export const RUNWAY_WIDTH = 20;
export const RUNWAY_CENTER_Z = -80;

const paint = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });

// Builds a runway in its own local frame (along Z, centred on the origin).
// designators = [number painted at the +Z end, number painted at the -Z end].
// Marking sizes scale with the runway width (a 60 m runway gets 3x markings),
// so the same code draws a 20 m training strip or a real 3.4 km runway.
export function createRunway({
  length = RUNWAY_LENGTH, width = RUNWAY_WIDTH, designators = ['36', '18'],
  approachEnds = ['near'], endLights = 'red', yOffset = 0,
} = {}) {
  const halfL = length / 2;
  const halfW = width / 2;
  const s = width / 20;              // marking scale
  const big = length > 1000;
  const group = new THREE.Group();
  group.name = `Runway ${designators.join('/')}`;
  group.position.y = yOffset;

  group.add(createSurface(length, width));
  group.add(createEdgeLines(length, halfW, s));
  group.add(createCenterline(halfL, s, big));
  const stripeEnd = 6 + 10 * s;
  [1, -1].forEach((end) => {
    group.add(createThresholdStripes(width, end * (halfL - 6 - 5 * s), s));
    group.add(createAimingPoints(end * (halfL - Math.min(length * 0.19, 400)), s));
  });
  group.add(createDesignator(designators[0], halfL - stripeEnd - 14 * s, 0, s));
  group.add(createDesignator(designators[1], -halfL + stripeEnd + 14 * s, Math.PI, s));
  group.add(createRunwayLights(halfL, halfW, endLights, big));
  approachEnds.forEach((end) => group.add(createApproachLights(halfL, end === 'near' ? 1 : -1, s, big)));

  return group;
}

function createSurface(length, width) {
  const material = new THREE.MeshStandardMaterial({
    map: asphaltTexture(Math.max(2, width / 10), length / 10), color: 0x8a8a8e, roughness: 0.95,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, length), material);
  mesh.position.y = 0.05;
  mesh.receiveShadow = true;
  return mesh;
}

function stripe(width, length, x, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.02, length), paint);
  mesh.position.set(x, 0.11, z);
  mesh.receiveShadow = true;
  return mesh;
}

function createEdgeLines(length, halfW, s) {
  const group = new THREE.Group();
  [-1, 1].forEach((side) => group.add(stripe(0.4 * s, length - 4, side * (halfW - 0.5 * s), 0)));
  return group;
}

// Dashed centreline: one dash translated repeatedly along Z.
function createCenterline(halfL, s, big) {
  const group = new THREE.Group();
  const dash = big ? 30 : 8;
  const step = dash + (big ? 20 : 6);
  const start = -halfL + (big ? 120 : 40);
  for (let z = start; z <= halfL - (big ? 120 : 40); z += step) group.add(stripe(0.5 * s, dash, 0, z));
  return group;
}

function createThresholdStripes(width, z, s) {
  const group = new THREE.Group();
  const count = width >= 45 ? 12 : 8;
  const spacing = (width - 2 * s) / count;
  for (let i = 0; i < count; i++) {
    group.add(stripe(spacing * 0.5, 10 * s, -width / 2 + s + spacing * (i + 0.5), z));
  }
  return group;
}

function createAimingPoints(z, s) {
  const group = new THREE.Group();
  [-1, 1].forEach((side) => group.add(stripe(2.2 * s, 14 * s, side * 4.5 * s, z)));
  return group;
}

// Runway number painted flat on the surface. The plane is rotated -90 deg about X
// to lie on the ground, then `spin` (about its own normal) turns it to face
// aircraft arriving from that end.
function createDesignator(label, z, spin, s) {
  const material = new THREE.MeshStandardMaterial({
    map: textTexture(label, {
      width: 256, height: 256, background: 'rgba(0,0,0,0)',
      font: `bold ${label.length > 2 ? 150 : 190}px "Segoe UI", Arial, sans-serif`,
    }),
    transparent: true, roughness: 0.8,
  });
  const size = 9 * Math.min(s, 2.2);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  mesh.rotation.set(-Math.PI / 2, 0, spin);
  mesh.position.set(0, 0.12, z);
  return mesh;
}

// Edge, threshold and end lights, batched by colour (see createLampBatch).
function createRunwayLights(halfL, halfW, endLights, big) {
  const group = new THREE.Group();
  const white = [];
  const green = [];
  const far = [];
  const spacing = big ? 60 : 15;
  for (let z = -halfL + 5; z <= halfL - 5; z += spacing) {
    white.push([-(halfW + 0.8), 0.35, z], [halfW + 0.8, 0.35, z]);
  }
  const step = Math.max(2.5, halfW / 8);
  for (let x = -halfW; x <= halfW + 0.01; x += step) {
    green.push([x, 0.35, halfL + 1]);
    far.push([x, 0.35, -halfL - 1]);
  }
  const lampSize = big ? 0.45 : 0.28;
  const glow = big ? 7 : 2.6;
  group.add(createLampBatch(0xfff4d6, white, { size: lampSize, glowSize: glow }));
  group.add(createLampBatch(0x33ff66, green, { size: lampSize, glowSize: glow }));
  group.add(createLampBatch(endLights === 'red' ? 0xff2a2a : 0x33ff66, far, { size: lampSize, glowSize: glow }));
  return group;
}

// Approach light bars beyond a threshold, with a sequenced "rabbit" strobe
// running towards the runway at night. side = +1 for the +Z end, -1 for the -Z end.
function createApproachLights(halfL, side, s, big) {
  const group = new THREE.Group();
  const bars = big ? 14 : 7;
  const spacing = big ? 30 : 10;
  const lamps = [];
  const strobes = [];
  for (let i = 0; i < bars; i++) {
    const z = side * (halfL + 12 * s + i * spacing);
    for (let k = -2; k <= 2; k++) lamps.push([k * 1.5 * s, 0.5, z]);
    const strobe = createFlashingLamp(0xffffff, big ? 16 : 7);
    strobe.group.position.set(0, 0.9, z);
    group.add(strobe.group);
    strobes.push(strobe);
  }
  group.add(createLampBatch(0xfff4d6, lamps, { size: big ? 0.45 : 0.28, glowSize: big ? 7 : 2.2 }));

  registerAnimator((elapsed, k) => {
    const active = Math.floor(elapsed * 10) % (bars * 2); // one flash per 0.1 s, then a pause
    strobes.forEach((st, i) => {
      const on = k > 0.5 && active === bars - 1 - i;
      st.bulb.emissiveIntensity = on ? 8 : 0;
      st.glow.opacity = on ? 1 : 0;
    });
  });
  return group;
}
