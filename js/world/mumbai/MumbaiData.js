// Loads a pre-built real-world region (see tools/build-region-data.mjs) and
// provides the queries the flight logic needs: terrain height, water, slope and
// building obstacles.

export const SEA_LEVEL = 0.3;
const OBSTACLE_CELL = 30;

export async function loadMumbaiData(base = 'assets/data/', region = 'mumbai') {
  const get = (file, type) => fetch(`${base}${file}`).then((r) => {
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return type === 'json' ? r.json() : r.arrayBuffer();
  });
  const [json, terrain, buildings] = await Promise.all([
    get(`${region}.json`, 'json'), get(`${region}-terrain.bin`), get(`${region}-buildings.bin`),
  ]);
  return createMumbaiData(json, new Int16Array(terrain), new Int16Array(buildings));
}

export function createMumbaiData(json, terrainDm, buildingsDm) {
  const g = json.grid;
  const heights = new Float32Array(terrainDm.length);
  for (let i = 0; i < terrainDm.length; i++) heights[i] = terrainDm[i] / 10;
  const maxX = g.minX + (g.width - 1) * g.step;
  const maxZ = g.minZ + (g.height - 1) * g.step;

  const sample = (i, j) => heights[Math.min(g.height - 1, Math.max(0, j)) * g.width + Math.min(g.width - 1, Math.max(0, i))];

  // Bilinear interpolation inside the grid cell containing (x, z).
  function heightAt(x, z) {
    const fx = (x - g.minX) / g.step;
    const fz = (z - g.minZ) / g.step;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = sample(i, j);
    const b = sample(i + 1, j);
    const c = sample(i, j + 1);
    const d = sample(i + 1, j + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  function slopeAt(x, z) {
    const e = g.step;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    return (2 * e) / Math.hypot(dx, 2 * e, dz);
  }

  const isWater = (x, z) => heightAt(x, z) < SEA_LEVEL;

  // City buildings: 5 Int16 values each (x, z in metres; width, depth, height in decimetres).
  const count = buildingsDm.length / 5;
  const cityBuildings = { count, data: buildingsDm };

  // Obstacle grid: highest roof (absolute height) in every 30 m cell, built by
  // rasterising each building's footprint rectangle into the cells it covers.
  const ow = Math.ceil((maxX - g.minX) / OBSTACLE_CELL) + 1;
  const oh = Math.ceil((maxZ - g.minZ) / OBSTACLE_CELL) + 1;
  const roofs = new Float32Array(ow * oh);
  for (let k = 0; k < count; k++) {
    const x = buildingsDm[k * 5];
    const z = buildingsDm[k * 5 + 1];
    const hw = buildingsDm[k * 5 + 2] / 20;
    const hd = buildingsDm[k * 5 + 3] / 20;
    const top = heightAt(x, z) + buildingsDm[k * 5 + 4] / 10;
    const i0 = Math.max(0, Math.floor((x - hw - g.minX) / OBSTACLE_CELL));
    const i1 = Math.min(ow - 1, Math.floor((x + hw - g.minX) / OBSTACLE_CELL));
    const j0 = Math.max(0, Math.floor((z - hd - g.minZ) / OBSTACLE_CELL));
    const j1 = Math.min(oh - 1, Math.floor((z + hd - g.minZ) / OBSTACLE_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) roofs[j * ow + i] = Math.max(roofs[j * ow + i], top);
    }
  }
  function obstacleAt(x, z) {
    const i = Math.floor((x - g.minX) / OBSTACLE_CELL);
    const j = Math.floor((z - g.minZ) / OBSTACLE_CELL);
    if (i < 0 || j < 0 || i >= ow || j >= oh) return 0;
    return roofs[j * ow + i];
  }

  // Base level of the land (10th percentile above sea): plateau regions such as
  // Bengaluru (~900 m) are coloured by height above this, not above sea level.
  const land = [];
  for (let i = 0; i < heights.length; i += 7) if (heights[i] > SEA_LEVEL) land.push(heights[i]);
  land.sort((a, b) => a - b);
  const baseHeight = land.length ? Math.max(0, land[Math.floor(land.length * 0.1)] - 5) : 0;

  return {
    json, grid: g, heights, baseHeight, bounds: { minX: g.minX, minZ: g.minZ, maxX, maxZ },
    heightAt, slopeAt, isWater, obstacleAt, cityBuildings,
  };
}
