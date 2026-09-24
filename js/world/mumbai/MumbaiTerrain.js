import * as THREE from 'three';
import { detailTexture } from '../../utils/Textures.js';
import { registerEmissive } from '../../lighting/LightRegistry.js';
import { clamp } from '../../utils/MathUtils.js';
import { SEA_LEVEL } from './MumbaiData.js';
import { createWaterMaterial } from '../Water.js';

// Terrain mesh from the real elevation grid, the sea, and the major road network.
const MESH_STEP = 2; // use every 2nd grid sample for the mesh (120 m), full grid for collision

const COLORS = {
  grass: new THREE.Color(0x6f8f4a), airportGrass: new THREE.Color(0x86a25c), forest: new THREE.Color(0x3d6834),
  mangrove: new THREE.Color(0x2c4a2a), urban: new THREE.Color(0xa39b8f), rock: new THREE.Color(0x8b8378),
  seabed: new THREE.Color(0x6b6a55),
};

// Fraction of each 120 m cell covered by building footprints (0..1), used to tint the ground.
export function urbanCoverage(data, cell = 120) {
  const g = data.grid;
  const w = Math.ceil((data.bounds.maxX - g.minX) / cell) + 1;
  const h = Math.ceil((data.bounds.maxZ - g.minZ) / cell) + 1;
  const cover = new Float32Array(w * h);
  const { data: b, count } = data.cityBuildings;
  for (let k = 0; k < count; k++) {
    const i = Math.floor((b[k * 5] - g.minX) / cell);
    const j = Math.floor((b[k * 5 + 1] - g.minZ) / cell);
    if (i >= 0 && j >= 0 && i < w && j < h) cover[j * w + i] += (b[k * 5 + 2] / 10) * (b[k * 5 + 3] / 10);
  }
  for (let i = 0; i < cover.length; i++) cover[i] = Math.min(1, cover[i] / (cell * cell));
  return { cover, w, h, cell, at: (x, z) => {
    const i = Math.floor((x - g.minX) / cell);
    const j = Math.floor((z - g.minZ) / cell);
    return i >= 0 && j >= 0 && i < w && j < h ? cover[j * w + i] : 0;
  } };
}

function pointInPolygon(x, z, flat) {
  let inside = false;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const xi = flat[i]; const zi = flat[i + 1]; const xj = flat[j]; const zj = flat[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function groundColor(data, coverage, x, z, h, target = new THREE.Color()) {
  if (h < SEA_LEVEL) return target.copy(COLORS.seabed);
  const inAirport = data.json.airports.some((a) => pointInPolygon(x, z, a.polygon));
  if (inAirport) return target.copy(COLORS.airportGrass);
  const urban = clamp(coverage.at(x, z) * 3.2, 0, 1);
  target.copy(COLORS.grass);
  const rel = h - (data.baseHeight || 0); // height above the region's base level
  if (rel > 35) target.lerp(COLORS.forest, clamp((rel - 35) / 60, 0, 1));
  if (rel > 260) target.lerp(COLORS.rock, clamp((rel - 260) / 120, 0, 1));
  if (h < 4 && urban < 0.15 && data.isWater(x + 150, z) + data.isWater(x - 150, z) + data.isWater(x, z + 150) + data.isWater(x, z - 150) > 0) {
    target.lerp(COLORS.mangrove, 0.85); // low ground next to water: mangroves line Mumbai's creeks
  }
  return target.lerp(COLORS.urban, urban);
}

export function createMumbaiTerrain(data, coverage) {
  const g = data.grid;
  const cols = Math.floor((g.width - 1) / MESH_STEP) + 1;
  const rows = Math.floor((g.height - 1) / MESH_STEP) + 1;
  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const c = new THREE.Color();
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const v = r * cols + q;
      const x = g.minX + q * MESH_STEP * g.step;
      const z = g.minZ + r * MESH_STEP * g.step;
      const h = data.heights[r * MESH_STEP * g.width + q * MESH_STEP];
      positions.set([x, h < SEA_LEVEL ? Math.min(h, -4) : h, z], v * 3);
      groundColor(data, coverage, x, z, h, c);
      colors.set([c.r, c.g, c.b], v * 3);
      uvs.set([x / 14, z / 14], v * 2);
    }
  }
  const indices = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let q = 0; q < cols - 1; q++) {
      const a = r * cols + q;
      indices.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const map = detailTexture(1);
  const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 1 }));
  terrain.receiveShadow = true;

  // The sea: one large plane at sea level; the terrain dips below it offshore.
  const b = data.bounds;
  const seaSize = b.maxX - b.minX + 60000;
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(seaSize, b.maxZ - b.minZ + 60000),
    createWaterMaterial({ color: 0x0c3446, waveLength: 140, extent: seaSize }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set((b.minX + b.maxX) / 2, SEA_LEVEL - 0.1, (b.minZ + b.maxZ) / 2);
  sea.receiveShadow = true;

  const group = new THREE.Group();
  group.name = 'Mumbai landscape';
  group.add(terrain, sea, createRoads(data));
  return group;
}

// ---- roads ----------------------------------------------------------------
// Each road is a polyline turned into a flat ribbon: every point is offset
// sideways by half the road width along the perpendicular of its direction.
const ROAD_WIDTH = [22, 17, 12, 9];

export function ribbon(points, width, yAt, out, { uvScale = 0.1 } = {}) {
  const n = points.length / 2;
  if (n < 2) return;
  let dist = 0;
  let prev = null;
  for (let k = 0; k < n; k++) {
    const x = points[k * 2];
    const z = points[k * 2 + 1];
    const i0 = Math.max(0, k - 1);
    const i1 = Math.min(n - 1, k + 1);
    let dx = points[i1 * 2] - points[i0 * 2];
    let dz = points[i1 * 2 + 1] - points[i0 * 2 + 1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const px = -dz * width / 2; // perpendicular to the direction of travel
    const pz = dx * width / 2;
    if (prev) dist += Math.hypot(x - prev[0], z - prev[1]);
    prev = [x, z];
    const y = yAt(x, z);
    const base = out.positions.length / 3;
    out.positions.push(x - px, y, z - pz, x + px, y, z + pz);
    out.uvs.push(0, dist * uvScale, 1, dist * uvScale);
    if (k > 0) out.indices.push(base - 2, base - 1, base, base - 1, base + 1, base); // counter-clockwise seen from above
  }
}

export function ribbonGeometry(out) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(out.uvs, 2));
  geometry.setIndex(out.indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Split long segments so the ribbon can follow the terrain.
export function densify(points, maxSegment) {
  const out = [];
  for (let k = 0; k < points.length / 2 - 1; k++) {
    const x0 = points[k * 2]; const z0 = points[k * 2 + 1];
    const x1 = points[k * 2 + 2]; const z1 = points[k * 2 + 3];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / maxSegment));
    for (let s = 0; s < steps; s++) out.push(x0 + ((x1 - x0) * s) / steps, z0 + ((z1 - z0) * s) / steps);
  }
  out.push(points[points.length - 2], points[points.length - 1]);
  return out;
}

function createRoads(data) {
  const out = { positions: [], uvs: [], indices: [] };
  const inAirport = (x, z) => data.json.airports.some((a) => pointInPolygon(x, z, a.polygon));
  data.json.roads.forEach((road) => {
    if (inAirport(road.p[0], road.p[1])) return;
    const pts = densify(road.p, 60);
    const yAt = road.b
      ? (x, z) => Math.max(data.heightAt(x, z) + 1.5, 9) // bridges: a deck above the water
      : (x, z) => Math.max(data.heightAt(x, z), SEA_LEVEL) + 1.2;
    ribbon(pts, ROAD_WIDTH[road.c], yAt, out);
  });
  const material = new THREE.MeshStandardMaterial({
    color: 0x3d3f44, roughness: 0.9, emissive: 0xffa24a, emissiveIntensity: 0,
  });
  registerEmissive(material, 0.16); // street lighting makes the road network glow at night
  const roads = new THREE.Mesh(ribbonGeometry(out), material);
  roads.receiveShadow = true;
  return roads;
}
