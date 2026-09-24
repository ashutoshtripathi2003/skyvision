import * as THREE from 'three';
import { registerAnimator } from '../lighting/LightRegistry.js';

// Scattered cumulus clouds: each cloud is a cluster of soft "puff" billboards
// (quads that always face the camera). All puffs of all clouds are ONE instanced
// draw call: per-instance attributes give each puff its centre, size and
// brightness; the vertex shader turns the quad towards the camera using the
// camera's right and up vectors from the view matrix. The whole field drifts
// with the wind and wraps around the region.
function puffTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // A few overlapping radial gradients = a soft, lumpy puff.
  const blobs = [[64, 70, 50], [44, 62, 34], [86, 60, 36], [60, 46, 32], [74, 82, 30]];
  blobs.forEach(([x, y, r]) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// bounds: region extent in metres; count: number of clouds.
export function createClouds(bounds, { count = 45, base = 1300, top = 2600, seed = 11 } = {}) {
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const width = bounds.maxX - bounds.minX + 16000;
  const depth = bounds.maxZ - bounds.minZ + 16000;
  const x0 = bounds.minX - 8000;
  const z0 = bounds.minZ - 8000;
  const offsets = [];
  const sizes = [];
  const shades = [];
  for (let c = 0; c < count; c++) {
    const cx = x0 + rand() * width;
    const cz = z0 + rand() * depth;
    const cy = base + rand() * (top - base);
    const scale = 700 + rand() * 1300; // cloud size (m)
    const puffs = 14 + Math.floor(rand() * 12);
    for (let p = 0; p < puffs; p++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * scale * 0.55;
      const up = rand() * rand(); // most puffs low down: a flat base, a heaped top
      offsets.push(cx + Math.cos(a) * r, cy + up * scale * 0.45, cz + Math.sin(a) * r * 0.75);
      sizes.push(scale * (0.35 + rand() * 0.35) * (1 - up * 0.3));
      shades.push(0.72 + up * 0.28); // darker undersides, bright tops
    }
  }
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
  geometry.setAttribute('size', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 1));
  geometry.setAttribute('shade', new THREE.InstancedBufferAttribute(new Float32Array(shades), 1));
  geometry.instanceCount = sizes.length;

  const uniforms = {
    map: { value: puffTexture() },
    time: { value: 0 },
    wind: { value: new THREE.Vector2(6, 2.5) }, // m/s
    area: { value: new THREE.Vector4(x0, z0, width, depth) },
    light: { value: new THREE.Color(1, 1, 1) },
    fogColor: { value: new THREE.Color(0xbfd6e6) },
    fogFar: { value: 30000 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      #include <common>
      attribute vec3 offset;
      attribute float size;
      attribute float shade;
      uniform float time;
      uniform vec2 wind;
      uniform vec4 area;
      varying vec2 vUv;
      varying float vShade;
      varying float vDistance;
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec3 centre = offset;
        // drift with the wind, wrapping around the area
        centre.x = area.x + mod(centre.x - area.x + wind.x * time, area.z);
        centre.z = area.y + mod(centre.z - area.y + wind.y * time, area.w);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = centre + (right * position.x + up * position.y) * size;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        vDistance = -mv.z;
        vUv = uv;
        vShade = shade;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      uniform sampler2D map;
      uniform vec3 light;
      uniform vec3 fogColor;
      uniform float fogFar;
      varying vec2 vUv;
      varying float vShade;
      varying float vDistance;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec4 t = texture2D(map, vUv);
        vec3 colour = light * vShade;
        float fog = smoothstep(fogFar * 0.35, fogFar, vDistance);
        float nearFade = smoothstep(40.0, 260.0, vDistance); // fade out when flying through a cloud
        gl_FragColor = vec4(mix(colour, fogColor, fog), t.a * 0.6 * nearFade * (1.0 - fog));
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = 'Clouds';

  const day = new THREE.Color(1, 1, 1);
  const night = new THREE.Color(0.045, 0.05, 0.07);
  registerAnimator((elapsed, k) => {
    uniforms.time.value = elapsed;
    uniforms.light.value.copy(day).lerp(night, k);
  });
  // Keep the cloud fog in step with the scene fog.
  mesh.onBeforeRender = (renderer, scene) => {
    if (scene.fog) { uniforms.fogColor.value.copy(scene.fog.color); uniforms.fogFar.value = scene.fog.far * 1.6; }
  };
  return mesh;
}
