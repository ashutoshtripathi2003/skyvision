import * as THREE from 'three';
import { AIRFIELDS, runwayDesignators, fromRunwayLocal } from './AirfieldData.js';
import { RunwayAids } from './RunwayAids.js';
import { createRunway } from '../airport/Runway.js';
import { createTower } from '../airport/Tower.js';
import { createWindsock } from '../airport/Signs.js';
import { registerEmissive } from '../lighting/LightRegistry.js';
import { asphaltTexture, concreteTexture, facadeTexture, textTexture } from '../utils/Textures.js';

// SkyVision valley airfields. The home airport's buildings come from
// js/airport/*; the destination airfields get a compact set built here.
// Everything is modelled in runway-local space and the whole group is placed
// with one translation + rotation (see AirfieldData.js).
export const GLIDE_SLOPE_DEG = 4;

export function createSkyVisionAirfields(parent) {
  AIRFIELDS.filter((f) => !f.home).forEach((field) => {
    const group = new THREE.Group();
    group.name = `Airfield ${field.id}`;
    group.position.set(field.x, field.y, field.z);
    group.rotation.y = field.rotation;
    group.add(buildFacilities(field));
    parent.add(group);
  });
  return new RunwayAids(parent, AIRFIELDS, AIRFIELDS, { glideSlope: GLIDE_SLOPE_DEG, spread: 0.6, offset: 60 });
}

// Tower eye position (world) for the TOWER camera at a destination airfield.
export function towerEyeFor(field) {
  if (field.home) return null;
  const local = towerLocal(field);
  const w = fromRunwayLocal(field, local.x - 3, local.z);
  return new THREE.Vector3(w.x, field.y + 34.5, w.z);
}

function towerLocal(field) {
  return { x: field.width / 2 + 100, z: 58 };
}

function buildFacilities(field) {
  const group = new THREE.Group();
  const halfW = field.width / 2;

  group.add(createRunway({
    length: field.length, width: field.width,
    designators: runwayDesignators(field), approachEnds: ['near', 'far'], endLights: 'green',
  }));

  // Connector taxiway + apron
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(1, 4), color: 0x9a9a9e, roughness: 0.95 });
  const connector = new THREE.Mesh(new THREE.BoxGeometry(36, 0.08, 12), asphalt);
  connector.position.set(halfW + 18, 0.04, 0);
  connector.receiveShadow = true;
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(52, 0.08, 120),
    new THREE.MeshStandardMaterial({ map: concreteTexture(5, 12), roughness: 0.9 }),
  );
  apron.position.set(halfW + 36 + 26, 0.03, 0);
  apron.receiveShadow = true;
  group.add(connector, apron);

  // Terminal
  const glass = new THREE.MeshStandardMaterial({
    map: facadeTexture({ columns: 24, rows: 2, seed: field.x }),
    emissive: 0xffffff,
    emissiveMap: facadeTexture({ columns: 24, rows: 2, lit: true, seed: field.x }),
    emissiveIntensity: 0, roughness: 0.3, metalness: 0.3,
  });
  registerEmissive(glass, 1.2);
  const wall = new THREE.MeshStandardMaterial({ color: 0xe2ddd3 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x7f8891 });
  const terminal = new THREE.Mesh(new THREE.BoxGeometry(18, 9, 72), [glass, glass, roof, roof, wall, wall]);
  terminal.position.set(halfW + 100, 4.5, -10);
  terminal.castShadow = terminal.receiveShadow = true;
  group.add(terminal);

  const signTexture = textTexture(field.name.toUpperCase(), {
    width: 1024, height: 96, background: '#0d2a4a', color: '#ffffff',
    font: 'bold 54px "Segoe UI", Arial, sans-serif',
  });
  const signMaterial = new THREE.MeshStandardMaterial({
    map: signTexture, emissive: 0xffffff, emissiveMap: signTexture, emissiveIntensity: 0.1,
  });
  registerEmissive(signMaterial, 1.2, 0.1);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(40, 3.75), signMaterial);
  sign.rotation.y = -Math.PI / 2;
  sign.position.set(halfW + 90.8, 11, -10);
  group.add(sign);

  const tl = towerLocal(field);
  group.add(createTower({ x: tl.x, z: tl.z }));
  group.add(createWindsock(-(halfW + 30), -field.length / 4));
  return group;
}
