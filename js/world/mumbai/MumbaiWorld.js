import * as THREE from 'three';
import { loadMumbaiData } from './MumbaiData.js';
import { createMumbaiTerrain, urbanCoverage, groundColor } from './MumbaiTerrain.js';
import { createMumbaiCity } from './MumbaiCity.js';
import { createMumbaiAirports } from './MumbaiAirports.js';
import { RunwayAids } from '../RunwayAids.js';
import { createWorldMap } from '../WorldMap.js';
import { AIRLINER } from '../../flight/FlightModel.js';
import { TaxiGraph } from '../../flight/Taxi.js';
import { REGIONS } from '../Regions.js';
import { createClouds } from '../Clouds.js';
import { AirTraffic } from '../AirTraffic.js';

// A real-world region (Mumbai, Bengaluru, Chennai, Goa) - built at runtime from
// real map + elevation data. Returns the same world interface as SkyVisionWorld
// so the flight logic, cameras and HUD work unchanged.
export function loadMumbaiWorld(onProgress) {
  return loadRegionWorld('mumbai', onProgress);
}

export async function loadRegionWorld(regionId, onProgress = () => {}) {
  const region = REGIONS[regionId];
  onProgress(`Loading ${region.name} map data`);
  const data = await loadMumbaiData('assets/data/', regionId);
  await nextFrame();

  onProgress('Building terrain and roads');
  const coverage = urbanCoverage(data);
  const group = new THREE.Group();
  group.name = region.name;
  group.add(createMumbaiTerrain(data, coverage));
  await nextFrame();

  onProgress(`Building ${data.cityBuildings.count.toLocaleString()} city buildings`);
  group.add(createMumbaiCity(data));
  await nextFrame();

  onProgress('Building airports and parking the fleet');
  const { group: airportGroup, towerEyes, stands, fleetLOD } = createMumbaiAirports(data);
  group.add(airportGroup);
  group.add(createClouds(data.bounds, { seed: regionId.length * 97 + 11 }));

  const airports = data.json.airports.map((a) => ({
    id: a.id, name: a.name, short: a.short, x: a.x, y: a.y, z: a.z, iata: a.iata,
    towerEye: towerEyes.get(a.id) || null,
  }));
  const runways = data.json.runways.map((r) => ({ ...r }));
  const aids = new RunwayAids(group, runways, airports, { glideSlope: 3, spread: 0.33, offset: 330, scale: 2.2 });

  await nextFrame();
  onProgress('Drawing the minimap');
  const color = new THREE.Color();
  const map = createWorldMap(data.bounds, 480, (x, z) => {
    const h = data.heightAt(x, z);
    if (h < 0.3) return [38, 92, 128];
    groundColor(data, coverage, x, z, h, color);
    return [color.r * 255, color.g * 255, color.b * 255];
  });

  const world = {
    id: regionId,
    name: region.name,
    group,
    aids,
    airports,
    runways,
    performance: AIRLINER,
    aircraftScale: 1.4,        // 1.4 = a real-size A320 (the models are drawn at aircraftScale / 1.4)
    aircraftTypes: true,       // A320 / A350 / A380 can be chosen here
    taxiGraph: new TaxiGraph(data.json.taxiways.map((t) => t.p)),
    stands,
    // Every frame: swap the parked aircraft nearest the camera for detailed
    // models, and move the AI traffic.
    update: (dt, cameraPosition, { player, elapsed, night }) => {
      fleetLOD.update(dt, cameraPosition);
      world.traffic.update(dt, player, elapsed, night);
    },
    glideSlope: 3,
    navScale: 4,
    mapRange: region.mapRange || 12000,
    finalDistance: 7000,
    fog: { near: 3000, far: 32000 },
    cameraFar: 60000,
    heightAt: data.heightAt,
    isWater: data.isWater,
    slopeAt: data.slopeAt,
    obstacleAt: data.obstacleAt,
    map,
    attribution: data.json.attribution,
  };
  world.traffic = new AirTraffic(world, group);
  return world;
}

// Yield to the browser between heavy steps so the loading screen can update
// (a timer rather than requestAnimationFrame, so it also progresses in a background tab).
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 30));
