import * as THREE from 'three';
import { AIRFIELDS, runwayDesignators } from './AirfieldData.js';
import { heightAt, isOverLake, slopeAt, TERRAIN_SIZE, WATER_LEVEL } from './Terrain.js';
import { TOWN } from './Scenery.js';
import { towerEyeFor, GLIDE_SLOPE_DEG } from './Airfields.js';
import { createWorldMap } from './WorldMap.js';
import { TOWER } from '../airport/Tower.js';
import { TRAINER } from '../flight/FlightModel.js';
import { TaxiGraph } from '../flight/Taxi.js';
import { createClouds } from './Clouds.js';
import { TAXI_NETWORK, STANDS } from '../airport/Taxiway.js';

// The fictional SkyVision valley (home airport + Lakeview + Summit) described
// with the common world interface used by the flight logic, cameras and HUD.
export function createSkyVisionWorld(group, aids) {
  const airports = AIRFIELDS.map((f) => ({
    id: f.id, name: f.name, short: f.short, x: f.x, y: f.y, z: f.z,
    towerEye: f.home ? new THREE.Vector3(TOWER.x - 3, TOWER.cabHeight + 0.5, TOWER.z) : towerEyeFor(f),
  }));
  const runways = AIRFIELDS.map((f) => {
    const designators = runwayDesignators(f);
    return {
      id: `${f.id}-${designators[0]}`, airport: f.id, x: f.x, y: f.y, z: f.z,
      rotation: f.rotation, length: f.length, width: f.width, designators,
    };
  });

  const half = TERRAIN_SIZE / 2.3;
  group.add(createClouds({ minX: -half, maxX: half, minZ: -half, maxZ: half }, { count: 40, base: 950, top: 1800 }));
  const map = createWorldMap({ minX: -half, maxX: half, minZ: -half, maxZ: half }, 256, (x, z) => {
    const h = heightAt(x, z);
    if (h < WATER_LEVEL) return [60, 140, 200];
    if (Math.abs(x - TOWN.x) < TOWN.size / 2 && Math.abs(z - TOWN.z) < TOWN.size / 2) return [196, 188, 170];
    if (h > 520) return [230, 232, 236];
    if (h > 300) return [128, 122, 112];
    const t = Math.min(1, Math.max(0, h / 300));
    return [72 + t * 20, 118 - t * 30, 58 - t * 10];
  });

  return {
    id: 'skyvision',
    name: 'SkyVision Valley',
    group,
    aids,
    airports,
    runways,
    performance: TRAINER,
    aircraftScale: 1,
    taxiGraph: new TaxiGraph(TAXI_NETWORK),
    stands: STANDS,
    glideSlope: GLIDE_SLOPE_DEG,
    navScale: 1,
    mapRange: 4200,
    finalDistance: 2000,
    fog: { near: 900, far: 8500 },
    cameraFar: 14000,
    heightAt,
    isWater: isOverLake,
    slopeAt,
    obstacleAt: null,
    map,
    attribution: null,
  };
}
