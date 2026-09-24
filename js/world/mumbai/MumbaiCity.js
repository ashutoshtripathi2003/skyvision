import * as THREE from 'three';
import { buildingTexture, facadeTexture } from '../../utils/Textures.js';
import { registerEmissive } from '../../lighting/LightRegistry.js';

// Real building footprints (OpenStreetMap bounding boxes) drawn as instanced
// boxes. The city is split into a grid of chunks so the renderer can skip
// (frustum-cull) the chunks that are off screen. Two materials: low-rise
// buildings and glass towers (taller than 45 m).
//
// Texture coordinates are computed in the vertex shader from each instance's
// size, so windows repeat once per real floor (~3.3 m) and window bay instead of
// one texture being stretched over a whole building. Roofs get a plain concrete
// colour, and many low-rise roofs carry the black water tanks typical of Indian
// cities.
const CHUNKS_X = 10;
const CHUNKS_Z = 7;
const TOWER_HEIGHT = 45;
const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

const LOW_RISE_COLORS = [0xeae4d8, 0xdcd3c3, 0xe8dcc6, 0xcfd6d9, 0xe6c9b8, 0xd9e0cf, 0xf2efe8, 0xc9b9a6, 0xe9d7a8, 0xd6e2e8].map((c) => new THREE.Color(c));
const TOWER_COLORS = [0x9fb4c4, 0xb7c3cc, 0x8ea5b8, 0xc9d2d8, 0xa9b8a8, 0x7f95a8].map((c) => new THREE.Color(c));

// tileW / tileH: metres covered by one copy of the texture (bays x floors).
function scaleUVsByInstance(material, tileW, tileH) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRoof;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_INSTANCING
          float faceWidth = abs( normal.x ) > 0.5 ? length( instanceMatrix[2].xyz ) : length( instanceMatrix[0].xyz );
          float faceHeight = length( instanceMatrix[1].xyz );
          vRoof = abs( normal.y ) > 0.5 ? 1.0 : 0.0;
          vec2 wallUv = uv * vec2( max( 1.0, floor( faceWidth / ${tileW.toFixed(1)} + 0.5 ) ), max( 1.0, floor( faceHeight / ${tileH.toFixed(1)} + 0.5 ) ) );
          vec2 roofUv = vec2( 0.02, 0.98 ); // a patch of plain wall colour
          vec2 buildingUv = mix( wallUv, roofUv, vRoof );
          #ifdef USE_MAP
            vMapUv = buildingUv;
          #endif
          #ifdef USE_EMISSIVEMAP
            vEmissiveMapUv = buildingUv;
          #endif
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRoof;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= mix( 1.0, 0.66, vRoof );');
  };
}

export function createMumbaiCity(data) {
  const wrap = (t) => { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  const lowRise = new THREE.MeshStandardMaterial({
    map: wrap(buildingTexture({ seed: 3 })), emissive: 0xffffff,
    emissiveMap: wrap(buildingTexture({ lit: true, seed: 3 })), emissiveIntensity: 0, roughness: 0.85,
  });
  const towers = new THREE.MeshStandardMaterial({
    map: wrap(facadeTexture({ columns: 3, rows: 8, seed: 5 })), emissive: 0xffffff,
    emissiveMap: wrap(facadeTexture({ columns: 3, rows: 8, lit: true, seed: 5 })), emissiveIntensity: 0,
    roughness: 0.3, metalness: 0.45,
  });
  scaleUVsByInstance(lowRise, 17, 19.5); // texture = 5 bays x 6 floors
  scaleUVsByInstance(towers, 9.5, 29);   // texture = 3 bays x 8 floors
  registerEmissive(lowRise, 0.75);
  registerEmissive(towers, 1.0);
  const tankMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6 });

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0); // base at y = 0 so scale.y is the building height
  const tank = new THREE.CylinderGeometry(0.5, 0.5, 1, 7, 1);
  tank.translate(0, 0.5, 0);

  const { minX, minZ, maxX, maxZ } = data.bounds;
  const chunkW = (maxX - minX) / CHUNKS_X;
  const chunkD = (maxZ - minZ) / CHUNKS_Z;
  const buckets = Array.from({ length: CHUNKS_X * CHUNKS_Z * 2 }, () => []);
  const { data: b, count } = data.cityBuildings;
  for (let k = 0; k < count; k++) {
    const x = b[k * 5];
    const z = b[k * 5 + 1];
    const ci = Math.min(CHUNKS_X - 1, Math.max(0, Math.floor((x - minX) / chunkW)));
    const cj = Math.min(CHUNKS_Z - 1, Math.max(0, Math.floor((z - minZ) / chunkD)));
    // Glass towers: tall AND slender (big-footprint sheds with a tall height tag stay plain).
    const tall = b[k * 5 + 4] / 10 >= TOWER_HEIGHT && (b[k * 5 + 2] / 10) * (b[k * 5 + 3] / 10) < 4000 ? 1 : 0;
    buckets[(cj * CHUNKS_X + ci) * 2 + tall].push(k);
  }

  const group = new THREE.Group();
  group.name = 'City';
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const hash = (k) => { let h = Math.imul(k ^ (k >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
  buckets.forEach((list, index) => {
    if (list.length === 0) return;
    const tall = index % 2 === 1;
    const mesh = new THREE.InstancedMesh(geometry, tall ? towers : lowRise, list.length);
    const tanks = [];
    list.forEach((k, i) => {
      const x = b[k * 5];
      const z = b[k * 5 + 1];
      const w = b[k * 5 + 2] / 10;
      const d = b[k * 5 + 3] / 10;
      const h = b[k * 5 + 4] / 10;
      const y = data.heightAt(x, z) - 0.5;
      // Model matrix = translation to the footprint centre x non-uniform scale (width, height, depth).
      matrix.makeScale(w, h, d).setPosition(x, y, z);
      mesh.setMatrixAt(i, matrix);
      const palette = tall ? TOWER_COLORS : LOW_RISE_COLORS;
      color.copy(palette[k % palette.length]).multiplyScalar(0.9 + hash(k) * 0.18); // weathering: each one a little different
      mesh.setColorAt(i, color);
      if (!tall && !IS_TOUCH && w * d > 60 && hash(k * 7 + 1) < 0.45) tanks.push([x + (hash(k + 3) - 0.5) * w * 0.5, y + h, z + (hash(k + 5) - 0.5) * d * 0.5]);
    });
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    group.add(mesh);
    if (tanks.length) {
      const t = new THREE.InstancedMesh(tank, tankMaterial, tanks.length);
      tanks.forEach(([x, y, z], i) => t.setMatrixAt(i, matrix.makeScale(1.6, 1.4, 1.6).setPosition(x, y, z)));
      t.computeBoundingSphere();
      group.add(t);
    }
  });
  return group;
}
