import * as THREE from 'three';
import { Sky } from './Sky.js';
import { applyNightFactor } from './LightRegistry.js';
import { lerp } from '../utils/MathUtils.js';

// Scene lighting model:
//   HemisphereLight  - ambient light (sky colour from above, ground bounce from below)
//   DirectionalLight - the sun by day / moon by night; the only shadow caster
//   + every lamp registered in LightRegistry (runway, terminal, floodlights, aircraft)
// Day/night is a single factor `night` (0..1) that blends all of them.

const TRANSITION_SPEED = 0.8; // full day<->night blend in ~1.25 s
const SHADOW_CENTER = new THREE.Vector3(50, 0, 0);

const DAY = {
  hemiSky: new THREE.Color(0xdbeaff), hemiGround: new THREE.Color(0x5a6b45), hemi: 1.1,
  sunColor: new THREE.Color(0xfff1dc), sun: 2.6, sunPos: new THREE.Vector3(160, 220, 100),
};
const NIGHT = {
  hemiSky: new THREE.Color(0x2a3a66), hemiGround: new THREE.Color(0x0b0d12), hemi: 0.35,
  sunColor: new THREE.Color(0x9fb4ff), sun: 0.35, sunPos: new THREE.Vector3(-150, 200, -120),
};

export class LightingManager {
  constructor(scene, { shadowMapSize = 2048 } = {}) {
    this.scene = scene;
    this.night = 0;       // current blend value
    this.targetNight = 0; // 0 = DAY, 1 = NIGHT

    this.shadowCenter = SHADOW_CENTER.clone();
    this.sky = new Sky(scene);
    scene.fog = new THREE.Fog(this.sky.horizonColor.clone(), 900, 8500);

    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);

    this.sun = new THREE.DirectionalLight(DAY.sunColor, DAY.sun);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera; // orthographic volume that "sees" shadow casters
    cam.left = -230; cam.right = 230; cam.top = 230; cam.bottom = -230;
    cam.near = 10; cam.far = 700;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.4;
    this.sun.target.position.copy(SHADOW_CENTER);

    scene.add(this.hemi, this.sun, this.sun.target);
    this.update(0, 0);
  }

  // The shadow map only covers a 460 m square, so it is moved to follow the
  // aircraft in Fly Yourself mode (null = back to the home airport).
  setShadowFocus(position) {
    this.shadowCenter.copy(position || SHADOW_CENTER);
    this.shadowCenter.y = position ? Math.max(0, position.y - 60) : 0;
  }

  get isNight() {
    return this.targetNight === 1;
  }

  toggleDayNight() {
    this.targetNight = this.targetNight === 1 ? 0 : 1;
  }

  update(dt, elapsed) {
    const step = TRANSITION_SPEED * dt;
    this.night += Math.max(-step, Math.min(step, this.targetNight - this.night));
    const k = this.night;

    this.hemi.intensity = lerp(DAY.hemi, NIGHT.hemi, k);
    this.hemi.color.lerpColors(DAY.hemiSky, NIGHT.hemiSky, k);
    this.hemi.groundColor.lerpColors(DAY.hemiGround, NIGHT.hemiGround, k);

    this.sun.intensity = lerp(DAY.sun, NIGHT.sun, k);
    this.sun.color.lerpColors(DAY.sunColor, NIGHT.sunColor, k);
    this.sun.position.lerpVectors(DAY.sunPos, NIGHT.sunPos, k).add(this.shadowCenter);
    this.sun.target.position.copy(this.shadowCenter);

    this.sky.setNightFactor(k);
    this.scene.fog.color.copy(this.sky.horizonColor);

    applyNightFactor(k, elapsed, dt);
  }
}
