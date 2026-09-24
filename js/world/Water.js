import * as THREE from 'three';
import { registerAnimator } from '../lighting/LightRegistry.js';
import { getSkyEnvironment, onSkyEnvironment } from '../lighting/Environment.js';

// Animated water: a physically-based material whose surface normals come from
// a procedurally generated, seamlessly tiling wave normal map. Two copies of the
// map scroll in different directions (the second through a small shader patch),
// so the waves never look like a single sliding picture. The sky reflection
// (environment map) and the sun's specular highlight do the rest.
let waveNormals = null;

function makeWaveNormals(size = 256) {
  // Height field = sum of sine waves with integer wave numbers, so it tiles.
  const waves = [];
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let k = 0; k < 18; k++) {
    const kx = Math.round((rand() - 0.5) * 16);
    const ky = Math.round((rand() - 0.5) * 16);
    if (kx === 0 && ky === 0) continue;
    waves.push({ kx, ky, a: 1 / Math.hypot(kx, ky), p: rand() * Math.PI * 2 });
  }
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      waves.forEach((w) => { v += w.a * Math.sin(((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.p); });
      h[y * size + x] = v;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Normal from the slope of the height field (central differences).
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// waveLength: metres covered by one tile of the wave pattern.
export function createWaterMaterial({ color = 0x1f5a73, waveLength = 90, extent = 1000 } = {}) {
  if (!waveNormals) waveNormals = makeWaveNormals();
  const normalMap = waveNormals.clone();
  normalMap.needsUpdate = true;
  normalMap.repeat.set(extent / waveLength, extent / waveLength);
  const material = new THREE.MeshStandardMaterial({
    color, roughness: 0.14, metalness: 0.0, normalMap, normalScale: new THREE.Vector2(0.3, 0.3),
    envMapIntensity: 0.55,
  });
  const time = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    // Second, larger and slower wave layer, scrolling the other way.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float waterTime;')
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
        vec3 mapN2 = texture2D( normalMap, vNormalMapUv * 0.37 + vec2( -waterTime * 0.011, waterTime * 0.007 ) ).xyz * 2.0 - 1.0;
        mapN = normalize( vec3( ( mapN.xy + mapN2.xy ) * normalScale, mapN.z * mapN2.z ) );
        normal = normalize( tbn * mapN );
      `);
  };
  const env = getSkyEnvironment();
  if (env) material.envMap = env;
  onSkyEnvironment((tex) => { material.envMap = tex; material.needsUpdate = true; });
  registerAnimator((elapsed, k) => {
    time.value = elapsed;
    normalMap.offset.set(elapsed * 0.012, elapsed * 0.009);
    material.envMapIntensity = 0.55 * (1 - 0.85 * k); // no bright sky to reflect at night
  });
  return material;
}
