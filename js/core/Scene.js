import * as THREE from 'three';
import { createAirport } from '../airport/Airport.js';
import { createTerrain } from '../world/Terrain.js';
import { createScenery } from '../world/Scenery.js';
import { createSkyVisionAirfields } from '../world/Airfields.js';
import { createSkyVisionWorld } from '../world/SkyVisionWorld.js';

// Scene graph root:
//   scene
//    |- sky dome + stars          (added by LightingManager, never clipped)
//    |- lights                    (added by LightingManager)
//    |- SkyVision world group     (everything the clipping demo can cut)
//    |    |- landscape (height-field terrain + lake), scenery (instanced forests + town)
//    |    |- home airport, destination airfields, PAPI lights + target beacons
//    |    |- vehicles, main aircraft (added in main.js)
//    |- Mumbai world group        (loaded on demand from real map data, see world/mumbai/)
export function createScene() {
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  world.name = 'SkyVision world';
  world.add(createTerrain());
  world.add(createScenery());
  world.add(createAirport());
  const aids = createSkyVisionAirfields(world);
  scene.add(world);
  return { scene, world, skyVision: createSkyVisionWorld(world, aids) };
}
