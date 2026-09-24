import * as THREE from 'three';
import { createRunway, RUNWAY_CENTER_Z } from './Runway.js';
import { createTaxiways, GATE_Z } from './Taxiway.js';
import { createTerminal } from './Terminal.js';
import { createTower } from './Tower.js';
import { createHangar } from './Hangar.js';
import { createRoads } from './Road.js';
import { createSigns } from './Signs.js';
import { createEnvironment } from './Environment.js';
import { Aircraft } from '../aircraft/Aircraft.js';

// Assembles every static part of the airport into one group (a scene-graph node).
export function createAirport() {
  const group = new THREE.Group();
  group.name = 'Airport';

  group.add(createEnvironment());
  const runway = createRunway(); // built centred on its own origin, then translated into place
  runway.position.z = RUNWAY_CENTER_Z;
  group.add(runway);
  group.add(createTaxiways());
  group.add(createTerminal());
  group.add(createTower());
  group.add(createHangar());
  group.add(createRoads());
  group.add(createSigns());
  group.add(createGateAircraft());

  return group;
}

// A parked A320 at gate 1 (gate 2 is kept free for the player to taxi to): the
// same Aircraft model with another livery and a uniform scale (the model is in
// real metres; the valley is drawn at 1/1.4 of real size).
function createGateAircraft() {
  const group = new THREE.Group();
  const plane = new Aircraft({ type: 'a320', livery: 'akasa' });
  plane.root.scale.setScalar(1 / 1.4);
  plane.root.position.set(72, 0, GATE_Z[0]);
  plane.root.rotation.y = Math.PI / 2; // nose (+Z local) turned to face +X, the terminal
  group.add(plane.root);
  return group;
}
