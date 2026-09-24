import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { paintTexture } from './LiveryPainter.js';
import { registerEmissive, registerAnimator } from '../lighting/LightRegistry.js';

// Real airliner models (A320neo, A350-900, A380-800) converted from the
// FlightGear GPL models by tools/convert-aircraft.mjs. Each type is loaded once
// (glTF binary + layout.json); every aircraft on screen is a clone that shares
// the geometry. Materials that carry the livery are cloned once per airline and
// get a texture painted by LiveryPainter.js.
const BASE = 'assets/models';
const loader = new GLTFLoader();
const templates = new Map();   // type -> Promise<template>
const liveryMaterials = new Map(); // `${type}|${livery}` -> Promise<Map(original material -> painted clone)>
const materials = new Set();   // every material of every loaded model (for reflections / night)
let environment = null;
let nightFactor = 0;

function tune(material) {
  const kind = material.userData.kind;
  if (kind === 'glass') {
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.FrontSide; // clear when looking out from the cockpit
    material.envMapIntensity = 1.6;
  } else if (kind === 'lightglass') {
    material.transparent = true;
    material.depthWrite = false;
  } else if (kind === 'windows') { // A350: cabin windows are real geometry, lit at night
    material.emissive = new THREE.Color(0xffd699);
    registerEmissive(material, 1.2);
  } else {
    material.envMapIntensity = 0.8;
  }
  if (environment) material.envMap = environment;
  materials.add(material);
}

export function loadModel(type) {
  if (!templates.has(type)) {
    const promise = (async () => {
      const [gltf, layout] = await Promise.all([
        loader.loadAsync(`${BASE}/${type}/model.glb`),
        fetch(`${BASE}/${type}/layout.json`).then((r) => r.json()),
      ]);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        tune(o.material);
      });
      return { type, scene: gltf.scene, layout };
    })();
    promise.catch(() => templates.delete(type)); // allow a retry later
    templates.set(type, promise);
  }
  return templates.get(type);
}

function paintedMaterials(template, liveryKey) {
  const key = `${template.type}|${liveryKey}`;
  if (!liveryMaterials.has(key)) {
    liveryMaterials.set(key, (async () => {
      const base = `${BASE}/${template.type}`;
      const map = new Map();
      const originals = new Set();
      template.scene.traverse((o) => { if (o.isMesh && o.material.userData.paint) originals.add(o.material); });
      for (const original of originals) {
        const painted = await paintTexture(base, template.layout, original.userData.texture, liveryKey);
        const m = original.clone();
        m.map = painted.map;
        if (painted.emissiveMap) {
          m.emissive = new THREE.Color(0xffffff);
          m.emissiveMap = painted.emissiveMap;
          registerEmissive(m, 0.9);
        }
        tune(m);
        map.set(original, m);
      }
      return map;
    })());
  }
  return liveryMaterials.get(key);
}

// A ready-to-use aircraft: { root, gear: {nose, left, right}, fans: [], layout }.
export async function createModelInstance(type, liveryKey) {
  const template = await loadModel(type);
  const painted = await paintedMaterials(template, liveryKey);
  const root = template.scene.clone(true);
  const gear = {};
  const fans = [];
  root.traverse((o) => {
    if (o.isMesh && painted.has(o.material)) o.material = painted.get(o.material);
    if (o.name === 'gear_nose') gear.nose = o;
    if (o.name === 'gear_left') gear.left = o;
    if (o.name === 'gear_right') gear.right = o;
    if (o.name.startsWith('fan_')) fans.push(o);
  });
  return { root, gear, fans, layout: template.layout };
}

// Reflections of the sky on the paint and the cockpit glass.
export function setEnvironment(texture) {
  environment = texture;
  materials.forEach((m) => { m.envMap = texture; m.needsUpdate = true; });
}

// At night the sky is dark, so its reflection must fade too.
registerAnimator((elapsed, k) => {
  if (Math.abs(k - nightFactor) < 0.01) return;
  nightFactor = k;
  materials.forEach((m) => {
    const day = m.userData.kind === 'glass' ? 1.6 : 0.8;
    m.envMapIntensity = day * (1 - 0.85 * k);
  });
});
