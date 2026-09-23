import * as THREE from 'three';
import { createFlashingLamp } from '../lighting/LightRegistry.js';
import { fromRunwayLocal } from './AirfieldData.js';
import { lerp } from '../utils/MathUtils.js';

// Landing aids for any set of runways:
//  - PAPI: four lights beside each runway end. Each unit shows white when the
//    aircraft is above that unit's angle and red below it, so on the ideal
//    glide path the pilot sees two white + two red.
//  - Beacon: a tall translucent light pillar over the mission's target airport.
const WHITE = new THREE.Color(0xfff6e6);
const RED = new THREE.Color(0xff2020);

export class RunwayAids {
  // runways: [{ x, y, z, rotation, length, width }], airports: [{ id, x, y, z }]
  constructor(parent, runways, airports, { glideSlope = 4, spread = 0.6, offset = 60, scale = 1 } = {}) {
    this.papis = [];
    this.beacons = new Map();
    this.target = null;
    const angles = [glideSlope + 1.5 * spread, glideSlope + 0.5 * spread, glideSlope - 0.5 * spread, glideSlope - 1.5 * spread];
    const housingGeometry = new THREE.BoxGeometry(1.6 * scale, 0.9 * scale, 0.9 * scale);
    const housingMaterial = new THREE.MeshStandardMaterial({ color: 0x30343a });

    runways.forEach((runway) => {
      const group = new THREE.Group();
      group.position.set(runway.x, runway.y, runway.z);
      group.rotation.y = runway.rotation;
      const halfL = runway.length / 2;
      const halfW = runway.width / 2;
      const off = Math.min(offset, runway.length * 0.2);
      // Landing towards -Z (from the +Z end): pilot's left is -X. Landing towards +Z: left is +X.
      [[halfL - off, -1], [-halfL + off, 1]].forEach(([z, side]) => {
        const lamps = angles.map((angle, i) => {
          const x = side * (halfW + 7 * scale + i * 2.6 * scale);
          const housing = new THREE.Mesh(housingGeometry, housingMaterial);
          housing.position.set(x, 0.45 * scale, z);
          const lamp = createFlashingLamp(0xffffff, 5 * scale);
          lamp.group.position.set(x, scale, z);
          lamp.group.scale.setScalar(scale);
          group.add(housing, lamp.group);
          const w = fromRunwayLocal(runway, x, z);
          return { ...lamp, angle, world: new THREE.Vector3(w.x, runway.y + scale, w.z) };
        });
        this.papis.push(lamps);
      });
      parent.add(group);
    });

    airports.forEach((airport) => {
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(9 * scale, 9 * scale, 1400 * Math.max(1, scale), 20, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x55e0ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide, fog: false,
        }),
      );
      beacon.position.set(airport.x, airport.y + 700 * Math.max(1, scale), airport.z);
      beacon.visible = false;
      parent.add(beacon);
      this.beacons.set(airport.id, beacon);
    });
    this.fadeStart = 1500 * scale;
  }

  setTarget(id) {
    this.target = id;
    this.beacons.forEach((beacon, key) => { beacon.visible = key === id; });
  }

  update(aircraftPosition, night) {
    this.papis.forEach((lamps) => {
      lamps.forEach((lamp) => {
        const dx = aircraftPosition.x - lamp.world.x;
        const dz = aircraftPosition.z - lamp.world.z;
        // Elevation angle from this PAPI unit up to the aircraft.
        const angle = (Math.atan2(aircraftPosition.y - lamp.world.y, Math.hypot(dx, dz)) * 180) / Math.PI;
        const color = angle > lamp.angle ? WHITE : RED;
        lamp.bulb.emissive.copy(color);
        lamp.bulb.emissiveIntensity = 3;
        lamp.glow.color.copy(color);
        lamp.glow.opacity = lerp(0.55, 1, night);
      });
    });

    // The target beacon fades out as you get close so it doesn't block the runway.
    if (this.target) {
      const beacon = this.beacons.get(this.target);
      if (!beacon) return;
      const d = Math.hypot(aircraftPosition.x - beacon.position.x, aircraftPosition.z - beacon.position.z);
      beacon.material.opacity = 0.28 * Math.min(1, Math.max(0, (d - this.fadeStart) / this.fadeStart));
    }
  }
}
