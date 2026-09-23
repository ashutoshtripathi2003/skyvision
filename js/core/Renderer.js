import * as THREE from 'three';

export function createRenderer(canvas) {
  // Logarithmic depth keeps z-buffer precision across a 0.3 m .. 14 km view range.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // film-like response to bright light
  renderer.toneMappingExposure = 1.0;
  return renderer;
}
