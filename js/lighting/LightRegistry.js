import * as THREE from 'three';
import { glowTexture } from '../utils/Textures.js';
import { lerp } from '../utils/MathUtils.js';

// Anything that should change between DAY and NIGHT registers itself here while
// the scene is being built. LightingManager then calls applyNightFactor(k) every
// frame with k = 0 (day) ... 1 (night), so the switch is one smooth blend.

const emissives = []; // { material, day, night }
const glows = [];     // { material, day, night }  (sprite halo opacity)
const lamps = [];     // { light, day, night }      (real THREE.Light intensity)
const animators = []; // (elapsedSeconds, k, dt) => void

export function registerEmissive(material, night, day = 0) {
  emissives.push({ material, day, night });
}

export function registerGlow(material, night = 1, day = 0) {
  glows.push({ material, day, night });
}

export function registerLamp(light, night, day = 0) {
  lamps.push({ light, day, night });
}

export function registerAnimator(fn) {
  animators.push(fn);
}

export function applyNightFactor(k, elapsed, dt) {
  emissives.forEach((e) => { e.material.emissiveIntensity = lerp(e.day, e.night, k); });
  glows.forEach((g) => { g.material.opacity = lerp(g.day, g.night, k); });
  lamps.forEach((l) => { l.light.intensity = lerp(l.day, l.night, k); });
  animators.forEach((fn) => fn(elapsed, k, dt));
}

// ---- Lamp fixtures (runway, taxiway, street lights) ----------------------
// One shared geometry + one material pair per colour keeps draw cost low.

const fixtureGeometry = new THREE.SphereGeometry(0.28, 8, 6);
const fixtureCache = new Map();

function fixtureMaterials(color) {
  if (!fixtureCache.has(color)) {
    const bulb = new THREE.MeshStandardMaterial({
      color: 0x333333, emissive: color, emissiveIntensity: 0.2,
    });
    const glow = new THREE.SpriteMaterial({
      map: glowTexture(), color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    registerEmissive(bulb, 4, 0.2);
    registerGlow(glow, 0.95, 0);
    fixtureCache.set(color, { bulb, glow });
  }
  return fixtureCache.get(color);
}

export function createLamp(color, { glowSize = 3, scale = 1 } = {}) {
  const { bulb, glow } = fixtureMaterials(color);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(fixtureGeometry, bulb);
  mesh.scale.setScalar(scale);
  const sprite = new THREE.Sprite(glow);
  sprite.scale.set(glowSize, glowSize, 1);
  group.add(mesh, sprite);
  return group;
}

// Many identical lamps drawn in two draw calls: an InstancedMesh for the bulbs
// and a Points cloud (one glow sprite per point) for the halos. Used for the
// hundreds of lights along real-size runways and taxiways.
const glowPointMaterials = new Map();

export function createLampBatch(color, positions, { size = 0.28, glowSize = 3 } = {}) {
  const group = new THREE.Group();
  if (positions.length === 0) return group;
  const { bulb } = fixtureMaterials(color);
  const bulbs = new THREE.InstancedMesh(fixtureGeometry, bulb, positions.length);
  const m = new THREE.Matrix4();
  const s = size / 0.28;
  positions.forEach(([x, y, z], i) => bulbs.setMatrixAt(i, m.makeScale(s, s, s).setPosition(x, y, z)));
  bulbs.computeBoundingSphere();

  const key = `${color}-${glowSize}`;
  if (!glowPointMaterials.has(key)) {
    const material = new THREE.PointsMaterial({
      map: glowTexture(), color, size: glowSize, sizeAttenuation: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    registerGlow(material, 0.95, 0);
    glowPointMaterials.set(key, material);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions.flat(), 3));
  const glows = new THREE.Points(geometry, glowPointMaterials.get(key));
  group.add(bulbs, glows);
  return group;
}

// A lamp with its own materials, for lights that flash independently.
export function createFlashingLamp(color, glowSize = 4) {
  const bulb = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: color, emissiveIntensity: 0 });
  const glow = new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(fixtureGeometry, bulb));
  const sprite = new THREE.Sprite(glow);
  sprite.scale.set(glowSize, glowSize, 1);
  group.add(sprite);
  return { group, bulb, glow };
}
