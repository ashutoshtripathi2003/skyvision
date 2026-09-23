import * as THREE from 'three';
import { AIRFIELDS, toRunwayLocal } from './AirfieldData.js';
import { detailTexture } from '../utils/Textures.js';
import { clamp, lerp } from '../utils/MathUtils.js';

// Height-field terrain. One analytic function heightAt(x, z) is used both to
// build the mesh (vertex y values) and for collision, so what you see is what
// you hit. Heights come from fractal value noise, then every airfield is
// flattened and the lake basin is carved out.

export const TERRAIN_SIZE = 16000;
const SEGMENTS = 256;
export const WATER_LEVEL = -1.5;
export const LAKE = { x: 3500, z: -3900, rx: 700, rz: 450 };

// Extra hand-placed peaks around the mountain airstrip (x, z, height, radius).
const PEAKS = [
  [-3700, -3200, 320, 380], [-2300, -4600, 360, 420], [-3900, -4700, 420, 520],
  [-2000, -3300, 220, 300], [-4600, -3600, 300, 450], [-3200, -5600, 380, 600],
];

// ---- value noise ---------------------------------------------------------
function hash(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v); // bilinear interpolation of lattice values
}

// Fractal Brownian motion: several octaves of noise, each twice the frequency and half the amplitude.
function fbm(x, z, octaves) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

const smooth01 = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

function naturalHeight(x, z) {
  const distHome = Math.hypot(x - 80, z);
  const farFactor = smooth01((distHome - 1400) / 2600);
  const westFactor = smooth01((800 - x) / 3000); // big mountains only in the west

  const rolling = fbm(x / 800, z / 800, 4) * 30;
  const hills = fbm(x / 1700 + 7.1, z / 1700 - 3.3, 4) * 140 * farFactor;
  const ridge = Math.pow(fbm(x / 2400 + 11.3, z / 2400 - 4.7, 5), 2.2) * 800 * farFactor * westFactor;

  let h = rolling + hills + ridge;
  for (const [px, pz, ph, pr] of PEAKS) {
    const d2 = (x - px) ** 2 + (z - pz) ** 2;
    h += ph * Math.exp(-d2 / (2 * pr * pr)); // Gaussian bump
  }
  return h;
}

const CORRIDOR_GRADIENT = Math.tan((3.2 * Math.PI) / 180);

export function heightAt(x, z) {
  let h = naturalHeight(x, z);
  for (const f of AIRFIELDS) {
    const d = Math.hypot(x - f.x, z - f.z);
    const mask = 1 - smooth01((d - f.flatInner) / (f.flatOuter - f.flatInner));
    h = lerp(h, f.y, mask);

    // Approach/departure corridors: off each runway end the ground is kept
    // below a 3.2 deg slope so a normal approach never hits a ridge.
    if (f.home) continue;
    const local = toRunwayLocal(f, x, z);
    const along = Math.abs(local.z) - f.length / 2;
    if (along > 0 && along < 4000) {
      const ceiling = f.y + along * CORRIDOR_GRADIENT - 10;
      const outside = smooth01((Math.abs(local.x) - 220) / 260);
      if (h > ceiling) h = lerp(ceiling, h, outside);
    }
  }
  const lake = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  const lakeMask = 1 - smooth01((lake - 0.7) / 0.35);
  return lerp(h, -14, lakeMask);
}

export function isOverLake(x, z) {
  return Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz) < 1.02 && heightAt(x, z) < WATER_LEVEL;
}

// Surface slope as the Y component of the normal (1 = flat, 0 = vertical cliff).
export function slopeAt(x, z) {
  const e = 8;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return new THREE.Vector3(-dx, 2 * e, -dz).normalize().y;
}

// ---- mesh ----------------------------------------------------------------
const COLORS = {
  grass: new THREE.Color(0x5f9447), meadow: new THREE.Color(0x7aa152), forest: new THREE.Color(0x3f6b33),
  rock: new THREE.Color(0x8a8378), snow: new THREE.Color(0xf2f4f7), sand: new THREE.Color(0xc9b98a),
};

export function createTerrain() {
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2); // XY plane -> XZ ground plane
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geometry.computeVertexNormals();

  // Vertex colours chosen from height and slope (grass -> forest -> rock -> snow).
  const normals = geometry.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    const flatness = normals.getY(i);
    c.copy(COLORS.grass).lerp(COLORS.meadow, clamp(fbm(pos.getX(i) / 300, pos.getZ(i) / 300, 2) * 1.6 - 0.5, 0, 1));
    if (h > 120) c.lerp(COLORS.forest, clamp((h - 120) / 150, 0, 1));
    if (flatness < 0.86 || h > 380) c.lerp(COLORS.rock, clamp(Math.max((0.86 - flatness) * 6, (h - 380) / 120), 0, 1));
    if (h > 560) c.lerp(COLORS.snow, clamp((h - 560) / 90, 0, 1));
    const lakeDist = Math.hypot((pos.getX(i) - LAKE.x) / LAKE.rx, (pos.getZ(i) - LAKE.z) / LAKE.rz);
    if (lakeDist < 1.12) c.lerp(COLORS.sand, 0.75); // lake shore and bed
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, map: detailTexture(TERRAIN_SIZE / 14), roughness: 1,
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.name = 'Terrain';
  terrain.receiveShadow = true;

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(LAKE.rx * 2.4, LAKE.rz * 2.4),
    new THREE.MeshStandardMaterial({ color: 0x2c6f93, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.93 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, WATER_LEVEL, LAKE.z);
  water.receiveShadow = true;

  const group = new THREE.Group();
  group.name = 'Landscape';
  group.add(terrain, water);
  return group;
}
