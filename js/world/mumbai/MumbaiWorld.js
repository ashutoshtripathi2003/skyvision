import * as THREE from 'three';
import { loadMumbaiData } from './MumbaiData.js';
import { createMumbaiTerrain, urbanCoverage, groundColor } from './MumbaiTerrain.js';
import { createMumbaiCity } from './MumbaiCity.js';
import { createMumbaiAirports } from './MumbaiAirports.js';
import { RunwayAids } from '../RunwayAids.js';
import { createWorldMap } from '../WorldMap.js';
import { AIRLINER } from '../../flight/FlightModel.js';

// "Real World: Mumbai" - built at runtime from real map + elevation data.
// Returns the same world interface as SkyVisionWorld so the flight logic,
// cameras and HUD work unchanged.
export async function loadMumbaiWorld(onProgress = () => {}) {
  onProgress('Loading map data');
  const data = await loadMumbaiData();
  await nextFrame();

  onProgress('Building terrain and roads');
  const coverage = urbanCoverage(data);
  const group = new THREE.Group();
  group.name = 'Mumbai';
  group.add(createMumbaiTerrain(data, coverage));
  await nextFrame();

  onProgress(`Building ${data.cityBuildings.count.toLocaleString()} city buildings`);
  group.add(createMumbaiCity(data));
  await nextFrame();

  onProgress('Building airports and parking the fleet');
  const { group: airportGroup, towerEyes } = createMumbaiAirports(data);
  group.add(airportGroup);

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

  return {
    id: 'mumbai',
    name: 'Mumbai Region',
    group,
    aids,
    airports,
    runways,
    performance: AIRLINER,
    aircraftScale: 1.4,
    glideSlope: 3,
    navScale: 4,
    mapRange: 14000,
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
}

// Yield to the browser between heavy steps so the loading screen can update
// (a timer rather than requestAnimationFrame, so it also progresses in a background tab).
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 30));
