import * as THREE from 'three';
import { createBus, createFuelTruck, createBaggageTug, createBaggageCart } from './Vehicle.js';

// Each vehicle loops forever along a closed Catmull-Rom spline shaped like a
// rounded rectangle. Per frame: distance += speed * dt, then
//   position = path.getPointAt(u)                    (translation)
//   yaw      = atan2(tangent.x, tangent.z)            (rotation about Y)

function roundedRectPath(minX, maxX, minZ, maxZ, r) {
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const points = [
    [minX + r, minZ], [midX, minZ], [maxX - r, minZ],
    [maxX, minZ + r], [maxX, midZ], [maxX, maxZ - r],
    [maxX - r, maxZ], [midX, maxZ], [minX + r, maxZ],
    [minX, maxZ - r], [minX, midZ], [minX, minZ + r],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  return new THREE.CatmullRomCurve3(points, true, 'centripetal');
}

export class VehicleManager {
  constructor(parent) {
    this.vehicles = [];
    this.tangent = new THREE.Vector3();

    this.add(parent, 'Airport bus', createBus(), roundedRectPath(127.5, 202.5, -102.5, 17.5, 9), 9);
    this.add(parent, 'Fuel truck', createFuelTruck(), roundedRectPath(55, 80, 14, 68, 6), 6);
    this.add(parent, 'Baggage tug', createBaggageTug(), roundedRectPath(56, 85.5, -76, 2, 5), 5,
      [createBaggageCart(), createBaggageCart()]);
  }

  add(parent, name, object, path, speed, trailers = []) {
    const length = path.getLength();
    const vehicle = { name, object, path, speed, length, distance: 0, trailers };
    parent.add(object);
    trailers.forEach((t) => parent.add(t));
    this.vehicles.push(vehicle);
    this.place(object, path, 0);
    return vehicle;
  }

  place(object, path, u) {
    path.getPointAt(u, object.position);
    path.getTangentAt(u, this.tangent);
    object.rotation.y = Math.atan2(this.tangent.x, this.tangent.z);
  }

  update(dt, elapsed, night) {
    this.vehicles.forEach((v) => {
      v.distance = (v.distance + v.speed * dt) % v.length;
      this.place(v.object, v.path, v.distance / v.length);

      // Trailers follow the same path a fixed distance behind.
      v.trailers.forEach((trailer, i) => {
        const d = (v.distance - 3.4 * (i + 1) + v.length) % v.length;
        this.place(trailer, v.path, d / v.length);
      });

      const beacon = v.object.userData.beacon;
      if (beacon) {
        const on = (elapsed * 2 + v.length) % 1 < 0.35;
        beacon.bulb.emissiveIntensity = on ? 3 + 3 * night : 0.2;
        beacon.glow.opacity = on ? 0.25 + 0.75 * night : 0;
      }
    });
  }
}
