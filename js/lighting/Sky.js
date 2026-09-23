import * as THREE from 'three';
import { seededRandom } from '../utils/MathUtils.js';

// A gradient sky dome plus a star field. The dome is re-centred on the camera
// every frame and drawn first without depth testing, so it always sits
// "infinitely far away" behind the scene.

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 groundColor;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform float sunSize;
  varying vec3 vDirection;
  void main() {
    vec3 dir = normalize(vDirection);
    float h = dir.y;
    vec3 color = h > 0.0
      ? mix(horizonColor, topColor, pow(h, 0.55))
      : mix(horizonColor, groundColor, clamp(-h * 6.0, 0.0, 1.0));
    float d = max(dot(dir, normalize(sunDirection)), 0.0);
    color += sunColor * (smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.6, d) + pow(d, 64.0) * 0.25);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const DAY = {
  top: new THREE.Color(0x3d7fd9), horizon: new THREE.Color(0xcfe6ff), ground: new THREE.Color(0x9fb8a0),
  sun: new THREE.Color(0xfff2d0), sunSize: 0.0016, sunDir: new THREE.Vector3(0.55, 0.6, 0.35),
};
const NIGHT = {
  top: new THREE.Color(0x02040c), horizon: new THREE.Color(0x14203a), ground: new THREE.Color(0x05070c),
  sun: new THREE.Color(0xc8d8ff), sunSize: 0.0009, sunDir: new THREE.Vector3(-0.5, 0.55, -0.45),
};

export class Sky {
  constructor(scene) {
    this.uniforms = {
      topColor: { value: DAY.top.clone() },
      horizonColor: { value: DAY.horizon.clone() },
      groundColor: { value: DAY.ground.clone() },
      sunDirection: { value: DAY.sunDir.clone() },
      sunColor: { value: DAY.sun.clone() },
      sunSize: { value: DAY.sunSize },
    };

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader, fragmentShader,
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      }),
    );
    dome.renderOrder = -2;

    this.stars = this.createStars();
    this.group = new THREE.Group();
    this.group.add(dome, this.stars);
    scene.add(this.group);
  }

  createStars() {
    const rand = seededRandom(99);
    const positions = [];
    for (let i = 0; i < 1500; i++) {
      const theta = rand() * Math.PI * 2;
      const y = 0.08 + rand() * 0.92; // upper hemisphere only
      const r = Math.sqrt(1 - y * y);
      positions.push(Math.cos(theta) * r * 1400, y * 1400, Math.sin(theta) * r * 1400);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false,
    });
    const stars = new THREE.Points(geometry, material);
    stars.renderOrder = -1;
    return stars;
  }

  // k: 0 = day, 1 = night
  setNightFactor(k) {
    const u = this.uniforms;
    u.topColor.value.lerpColors(DAY.top, NIGHT.top, k);
    u.horizonColor.value.lerpColors(DAY.horizon, NIGHT.horizon, k);
    u.groundColor.value.lerpColors(DAY.ground, NIGHT.ground, k);
    u.sunColor.value.lerpColors(DAY.sun, NIGHT.sun, k);
    u.sunDirection.value.lerpVectors(DAY.sunDir, NIGHT.sunDir, k);
    u.sunSize.value = DAY.sunSize + (NIGHT.sunSize - DAY.sunSize) * k;
    this.stars.material.opacity = Math.max(0, k * 1.2 - 0.2);
  }

  get horizonColor() {
    return this.uniforms.horizonColor.value;
  }

  follow(camera) {
    this.group.position.copy(camera.position);
  }
}
