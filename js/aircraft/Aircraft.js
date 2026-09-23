import * as THREE from 'three';
import { windowStripTexture, glowTexture, textTexture } from '../utils/Textures.js';
import { LIVERIES } from './Liveries.js';

// Airliner built only from primitives. Local frame: nose points +Z, up is +Y,
// the left wing is +X, and y = 0 is the ground under the wheels.
//
//   root (Group)  <- translation + yaw/pitch/roll applied here each frame
//    |- fuselage, nose (scaled sphere), tail cone, windows, cheatline
//    |- wings / stabilisers (2D shapes extruded to 3D; right side = mirror, scale.x = -1)
//    |- engines, landing gear (rotates up to retract), lights

const FUSE_Y = 3.2;
const R = 1.6;
const DIHEDRAL = 0.07;
const TITLE_ANGLE = Math.asin(1.0 / R); // titles sit 1 m above the fuselage centre line

const titleTextures = new Map();
function titleTexture(livery) {
  if (!titleTextures.has(livery.title)) {
    titleTextures.set(livery.title, textTexture(livery.title, {
      width: 1024, height: 128, background: 'rgba(0,0,0,0)', color: livery.titleColor,
      font: `${livery.titleFont} 86px "Segoe UI", Arial, sans-serif`,
    }));
  }
  return titleTextures.get(livery.title);
}

// Accepts a livery key ('indigo'), a livery object, or a plain tail colour (number).
function resolveLivery(livery) {
  if (typeof livery === 'string') return LIVERIES[livery] || LIVERIES.skyvision;
  if (typeof livery === 'number') return { ...LIVERIES.skyvision, tail: livery, cheat: livery, title: null };
  return livery || LIVERIES.skyvision;
}

const geometryCache = {};
function cached(key, build) {
  if (!geometryCache[key]) geometryCache[key] = build();
  return geometryCache[key];
}

function extrudedShape(points, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(([x, y]) => shape.lineTo(x, y));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
}

export class Aircraft {
  constructor({ livery = 'skyvision', withLights = false } = {}) {
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ'; // yaw, then pitch, then roll - like a real aircraft
    this.gear = [];
    this.lights = null;
    this.landingLightOn = false;

    this.materials = {
      body: new THREE.MeshStandardMaterial({ color: 0xf4f6f8, metalness: 0.15, roughness: 0.4 }),
      livery: new THREE.MeshStandardMaterial({ color: 0x1f5fbf, metalness: 0.2, roughness: 0.45 }),
      engine: new THREE.MeshStandardMaterial({ color: 0x8e979f, metalness: 0.45, roughness: 0.35 }),
      cheat: new THREE.MeshStandardMaterial({ color: 0x1f5fbf, metalness: 0.2, roughness: 0.45 }),
      title: new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.5, depthWrite: false }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1b2533, metalness: 0.3, roughness: 0.3 }),
      grey: new THREE.MeshStandardMaterial({ color: 0x8e979f, metalness: 0.6, roughness: 0.35 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
    };

    this.buildFuselage();
    this.buildWings();
    this.buildTail();
    this.buildEngines();
    this.buildGear();
    this.buildTitles();
    if (withLights) this.buildLights();
    this.applyLivery(livery);

    this.root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
  }

  add(geometry, material, position, rotation, scale) {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    if (scale) mesh.scale.set(...scale);
    this.root.add(mesh);
    return mesh;
  }

  buildFuselage() {
    const m = this.materials;
    // Cylinder is built along Y; rotating 90 deg about X lays it along Z.
    this.add(cached('fuse', () => new THREE.CylinderGeometry(R, R, 20, 28)), m.body,
      [0, FUSE_Y, 1], [Math.PI / 2, 0, 0]);
    // Nose: a sphere stretched along Z by non-uniform scaling.
    this.add(cached('nose', () => new THREE.SphereGeometry(R, 28, 16)), m.body,
      [0, FUSE_Y, 11], null, [1, 1, 1.9]);
    // Tail cone: a cone pointed backwards and tilted slightly up.
    this.add(cached('tailcone', () => new THREE.ConeGeometry(R, 6.5, 28)), m.body,
      [0, FUSE_Y + 0.25, -12.2], [-Math.PI / 2 + 0.1, 0, 0]);
    // Cockpit windscreen
    this.add(cached('screen', () => new THREE.BoxGeometry(1.6, 0.4, 1.1)), m.dark,
      [0, FUSE_Y + 1.18, 12.1], [0.42, 0, 0]);

    // Passenger windows + livery cheatline: flat strips on both sides.
    const windows = new THREE.MeshBasicMaterial({ map: windowStripTexture(), transparent: true });
    [-1, 1].forEach((side) => {
      const strip = this.add(cached('win', () => new THREE.PlaneGeometry(17, 0.5)), windows,
        [side * 1.56, FUSE_Y + 0.4, 1.5], [0, side * Math.PI / 2, 0]);
      strip.castShadow = false;
      this.add(cached('cheat', () => new THREE.PlaneGeometry(22, 0.35)), m.cheat,
        [side * 1.61, FUSE_Y - 0.15, 0.5], [0, side * Math.PI / 2, 0]);
    });
  }

  // Airline name on both sides of the forward fuselage. Each title is a plane in a
  // wrapper group rotated about the fuselage axis so it lies on the curved skin.
  buildTitles() {
    this.titles = [];
    [1, -1].forEach((side) => {
      const wrapper = new THREE.Group();
      wrapper.position.set(0, FUSE_Y, 4);
      wrapper.rotation.z = side * TITLE_ANGLE;
      const title = new THREE.Mesh(cached('title', () => new THREE.PlaneGeometry(10, 1.25)), this.materials.title);
      title.position.x = side * (R + 0.03);
      title.rotation.y = side * Math.PI / 2;
      title.castShadow = false;
      wrapper.add(title);
      this.root.add(wrapper);
      this.titles.push(title);
    });
  }

  applyLivery(livery) {
    const l = resolveLivery(livery);
    this.livery = l;
    const m = this.materials;
    m.body.color.set(l.body);
    m.livery.color.set(l.tail);
    m.engine.color.set(l.engine);
    m.cheat.color.set(l.cheat);
    m.title.map = l.title ? titleTexture(l) : null;
    m.title.needsUpdate = true;
    this.titles.forEach((t) => { t.visible = Boolean(l.title); });
  }

  buildWings() {
    // Swept trapezoid planform in 2D (x = span, y = forward), extruded 0.35 m thick.
    const wingGeometry = cached('wing', () => extrudedShape(
      [[0, 2.6], [12, -2.2], [12, -3.8], [0, -3.2]], 0.35));
    [1, -1].forEach((side) => {
      const wrapper = new THREE.Group();
      wrapper.position.set(0, FUSE_Y - 0.6, 1);
      wrapper.rotation.z = side * DIHEDRAL; // wing tips tilted up (dihedral)
      const wing = new THREE.Mesh(wingGeometry, this.materials.body);
      wing.rotation.x = Math.PI / 2;       // shape XY plane -> horizontal XZ plane
      wing.scale.x = side;                 // side = -1 mirrors the left wing into the right wing
      wrapper.add(wing);
      this.root.add(wrapper);
      if (side === 1) this.leftWingTip = wrapper; else this.rightWingTip = wrapper;
    });
  }

  buildTail() {
    const stabGeometry = cached('stab', () => extrudedShape(
      [[0, 1.6], [5.2, -1.2], [5.2, -2.3], [0, -1.8]], 0.25));
    [1, -1].forEach((side) => {
      const stab = new THREE.Mesh(stabGeometry, this.materials.body);
      stab.rotation.x = Math.PI / 2;
      stab.scale.x = side;
      stab.position.set(0, FUSE_Y + 0.5, -12.4);
      this.root.add(stab);
    });
    // Vertical fin: shape drawn in (forward, up) and rotated so it stands upright.
    const fin = new THREE.Mesh(
      cached('fin', () => extrudedShape([[2.6, 0], [-1.6, 5.8], [-3.6, 5.8], [-4.4, 0]], 0.3)),
      this.materials.livery,
    );
    fin.rotation.y = -Math.PI / 2;
    fin.position.set(0.15, FUSE_Y + 0.7, -11.2);
    this.root.add(fin);
  }

  buildEngines() {
    const m = this.materials;
    [-1, 1].forEach((side) => {
      this.add(cached('engine', () => new THREE.CylinderGeometry(0.8, 0.65, 3.4, 20)), m.engine,
        [side * 5, FUSE_Y - 1.65, 3.6], [Math.PI / 2, 0, 0]);
      this.add(cached('intake', () => new THREE.CircleGeometry(0.72, 20)), m.dark,
        [side * 5, FUSE_Y - 1.65, 5.32]);
      this.add(cached('pylon', () => new THREE.BoxGeometry(0.25, 0.8, 2.4)), m.grey,
        [side * 5, FUSE_Y - 0.9, 3.4]);
    });
  }

  // Each gear leg is a group pivoting at its top. Retracting = rotating the
  // group 90 deg about X and hiding it once folded away.
  buildGear() {
    const WHEEL_R = 0.45;
    const strut = cached('strut', () => new THREE.CylinderGeometry(0.12, 0.12, 1, 8));
    const wheel = cached('wheel', () => new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.35, 16));
    const legs = [[0, 8.5, 1.7], [1.9, -0.6, 2.35], [-1.9, -0.6, 2.35]]; // x, z, pivot height
    legs.forEach(([x, z, top]) => {
      const leg = new THREE.Group();
      leg.position.set(x, top, z);
      const length = top - WHEEL_R;
      const s = new THREE.Mesh(strut, this.materials.grey);
      s.scale.y = length;          // unit-height cylinder stretched to the leg length
      s.position.y = -length / 2;
      leg.add(s);
      [-0.22, 0.22].forEach((dx) => {
        const w = new THREE.Mesh(wheel, this.materials.tyre);
        w.rotation.z = Math.PI / 2; // wheel axle along X
        w.position.set(dx, -length, 0);
        leg.add(w);
      });
      this.root.add(leg);
      this.gear.push(leg);
    });
  }

  // extension: 1 = gear down, 0 = fully retracted
  setGearExtension(extension) {
    this.gear.forEach((leg) => {
      leg.rotation.x = (1 - extension) * (Math.PI / 2);
      leg.visible = extension > 0.03;
    });
  }

  buildLights() {
    const lamp = (color, size, parent, position) => {
      const bulb = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0 });
      const glow = new THREE.SpriteMaterial({
        map: glowTexture(), color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(cached('bulb', () => new THREE.SphereGeometry(0.18, 8, 6)), bulb);
      mesh.position.set(...position);
      const sprite = new THREE.Sprite(glow);
      sprite.scale.set(size, size, 1);
      sprite.position.set(...position);
      parent.add(mesh, sprite);
      return { bulb, glow };
    };

    this.lights = {
      navLeft: lamp(0xff2020, 3, this.leftWingTip, [12.1, 0, -3.0]),   // red on the left
      navRight: lamp(0x20ff40, 3, this.rightWingTip, [-12.1, 0, -3.0]), // green on the right
      tail: lamp(0xffffff, 2.5, this.root, [0, FUSE_Y + 0.3, -15.4]),
      beacon: lamp(0xff2020, 4, this.root, [0, FUSE_Y + R + 0.1, -1]),
      strobeL: lamp(0xffffff, 6, this.leftWingTip, [12.2, 0.05, -2.2]),
      strobeR: lamp(0xffffff, 6, this.rightWingTip, [-12.2, 0.05, -2.2]),
    };

    this.landingLight = new THREE.SpotLight(0xfff4e0, 0, 160, Math.PI / 7, 0.5, 1.5);
    this.landingLight.position.set(0, FUSE_Y - 0.8, 12);
    this.landingLight.target.position.set(0, 0, 60);
    this.root.add(this.landingLight, this.landingLight.target);
  }

  // Called every frame with the current night factor k (0 day .. 1 night).
  updateLights(elapsed, k) {
    if (!this.lights) return;
    const set = (light, intensity, glowOpacity) => {
      light.bulb.emissiveIntensity = intensity;
      light.glow.opacity = glowOpacity;
    };
    const steady = 1 + 3 * k;
    set(this.lights.navLeft, steady, k);
    set(this.lights.navRight, steady, k);
    set(this.lights.tail, steady, k * 0.8);

    const beaconOn = elapsed % 1.2 < 0.15;
    set(this.lights.beacon, beaconOn ? 6 : 0.1, beaconOn ? 0.4 + 0.6 * k : 0);

    const t = elapsed % 1.6;
    const strobeOn = t < 0.06 || (t > 0.16 && t < 0.22);
    set(this.lights.strobeL, strobeOn ? 8 : 0, strobeOn ? 0.3 + 0.7 * k : 0);
    set(this.lights.strobeR, strobeOn ? 8 : 0, strobeOn ? 0.3 + 0.7 * k : 0);

    this.landingLight.intensity = this.landingLightOn ? k * 2500 : 0;
  }
}
