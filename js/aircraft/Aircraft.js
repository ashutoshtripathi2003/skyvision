import * as THREE from 'three';
import { glowTexture } from '../utils/Textures.js';
import { LIVERIES } from './Liveries.js';
import { AIRCRAFT_TYPES } from './AircraftTypes.js';
import { fuselageTextures } from './LiveryTexture.js';
import { registerEmissive } from '../lighting/LightRegistry.js';

// Procedural airliner (A320 / A350 / A380) built from the real dimensions in
// AircraftTypes.js. Model frame: nose +Z, up +Y, left wing +X, origin on the
// ground under the main gear, units = metres.
//
//   root (Group)  <- translation + yaw/pitch/roll (+ scale) applied each frame
//    |- fuselage: rings of vertices lofted along Z (nose curve, parallel body, upswept tail)
//    |- wings / stabilisers / fin: airfoil cross-sections lofted from root to tip;
//    |  the right side is the left side mirrored (scale.x = -1)
//    |- engines: lathe-turned nacelles with fan, spinner and exhaust cone, on pylons
//    |- landing gear legs (rotate up to retract) with 2, 4 or 6-wheel bogies
//    |- navigation / beacon / strobe lights and a landing spotlight

const SEGMENTS = 40;
const AIRFOIL = [ // normalised chord position (0 = leading edge) and thickness (fraction of max)
  [0, 0], [0.02, 0.38], [0.08, 0.72], [0.2, 0.95], [0.35, 1], [0.55, 0.85], [0.75, 0.52], [1, 0.06],
  [0.75, -0.3], [0.55, -0.45], [0.35, -0.5], [0.2, -0.46], [0.08, -0.36], [0.02, -0.2],
];

function resolveLivery(livery) {
  if (typeof livery === 'string') return LIVERIES[livery] || LIVERIES.skyvision;
  if (typeof livery === 'number') return { ...LIVERIES.skyvision, tail: livery, cheat: livery, title: null, name: `c${livery}` };
  return livery || LIVERIES.skyvision;
}

// ---- geometry helpers ------------------------------------------------------

// Fuselage: a ring of vertices per section; each section has a radius, a centre
// height and a vertical stretch. UVs: u along the body, v around it.
function fuselageGeometry(f) {
  const sections = []; // each: z, half-width rx, half-height ry, centre height cy
  const N = 14;
  const R = f.radius;
  const Ry = f.radius * f.stretchY;
  for (let i = 0; i <= N; i++) {                    // nose: blunt curve from a point to full radius
    const t = i / N;
    const k = Math.sqrt(1 - (1 - t) ** 2.3);
    sections.push({ z: f.noseZ - t * f.noseLength, rx: R * k, ry: Ry * k, cy: f.centreY - 0.16 * R * (1 - t) ** 2 });
  }
  sections.push({ z: f.tailZ + f.tailLength, rx: R, ry: Ry, cy: f.centreY });
  // Tail cone: the top line stays almost straight while the belly sweeps up
  // towards the APU exhaust (the typical airliner "upswept" tail).
  const endY = f.centreY + f.tailRise;
  const endR = 0.07 * Ry;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const top = f.centreY + Ry + (endY + endR - f.centreY - Ry) * t ** 1.7;
    const bottom = f.centreY - Ry + (endY - endR - f.centreY + Ry) * t ** 0.95;
    sections.push({
      z: f.tailZ + f.tailLength * (1 - t), rx: R * (1 - 0.9 * t ** 1.35), ry: (top - bottom) / 2, cy: (top + bottom) / 2,
    });
  }
  sections.push({ z: f.tailZ - 0.01, rx: 0.001, ry: 0.001, cy: endY });

  const positions = [];
  const uvs = [];
  const indices = [];
  const length = f.noseZ - f.tailZ;
  sections.forEach((s) => {
    for (let k = 0; k <= SEGMENTS; k++) {
      const theta = (k / SEGMENTS) * Math.PI * 2;  // 0 = top, PI/2 = left (+X), PI = belly
      positions.push(s.rx * Math.sin(theta), s.cy + s.ry * Math.cos(theta), s.z);
      uvs.push((s.z - f.tailZ) / length, k / SEGMENTS);
    }
  });
  const ring = SEGMENTS + 1;
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < SEGMENTS; k++) {
      const a = i * ring + k;
      const b = a + ring;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// Loft an airfoil through a list of stations. Each station: leading-edge point,
// chord (along -Z) and thickness; `normal` is the thickness direction.
function loftGeometry(stations, normal) {
  const positions = [];
  const indices = [];
  const n = AIRFOIL.length;
  stations.forEach((s) => {
    AIRFOIL.forEach(([c, t]) => {
      positions.push(
        s.le.x + normal.x * t * s.chord * s.thick * 0.5,
        s.le.y + normal.y * t * s.chord * s.thick * 0.5,
        s.le.z - c * s.chord,
      );
    });
  });
  for (let i = 0; i < stations.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const a = i * n + k;
      const b = i * n + ((k + 1) % n);
      const c = a + n;
      const d = b + n;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Tip cap (fan of triangles).
  const last = (stations.length - 1) * n;
  for (let k = 1; k < n - 1; k++) indices.push(last, last + k, last + k + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  g.setIndex(indices);
  const flat = g.toNonIndexed(); // flat-ish shading keeps the trailing edge crisp
  flat.computeVertexNormals();
  return flat;
}

function nacelleGeometry(n) {
  // Profile (radius, distance from the intake lip), turned 360 degrees by LatheGeometry.
  const L = n.length;
  const points = [
    [n.inlet, 0], [n.radius * 0.97, L * 0.12], [n.radius, L * 0.35], [n.radius * 0.96, L * 0.62],
    [n.radius * 0.8, L * 0.86], [n.exhaust, L],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(points, 32);
  g.rotateX(-Math.PI / 2); // lathe axis Y -> the engine points along +Z (front at z = 0, rear at z = -L)
  return g;
}

// ---- the aircraft -----------------------------------------------------------

export class Aircraft {
  constructor({ livery = 'skyvision', withLights = false, type = 'a320' } = {}) {
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ'; // yaw, then pitch, then roll - like a real aircraft
    this.withLights = withLights;
    this.landingLightOn = false;
    this.materials = {
      body: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.15, roughness: 0.38, emissive: 0xffffff, emissiveIntensity: 0 }),
      wing: new THREE.MeshStandardMaterial({ color: 0xd4d9df, metalness: 0.35, roughness: 0.42, side: THREE.DoubleSide }),
      tail: new THREE.MeshStandardMaterial({ color: 0x1f5fbf, metalness: 0.2, roughness: 0.42, side: THREE.DoubleSide }),
      engine: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.3, roughness: 0.35, side: THREE.DoubleSide }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.75, roughness: 0.3 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x20262e, metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
    };
    registerEmissive(this.materials.body, 0.9); // cabin windows glow at night
    this.setType(type, livery);
  }

  // (Re)build the whole model for an aircraft type. The root object stays the
  // same, so everything holding a reference to it keeps working.
  setType(type, livery = this.liveryKey) {
    this.type = type;
    this.spec = AIRCRAFT_TYPES[type] || AIRCRAFT_TYPES.a320;
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); // free the old type's GPU buffers
    while (this.root.children.length) this.root.remove(this.root.children[0]);
    this.gear = [];
    this.lights = null;

    this.buildFuselage();
    this.buildWings();
    this.buildTail();
    this.buildEngines();
    this.buildGear();
    if (this.withLights) this.buildLights();
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const f = this.spec.fuselage;
    this.cockpitEye = new THREE.Vector3(0, f.centreY + f.radius * f.stretchY * 0.5, f.noseZ - f.noseLength * 0.42);
    this.applyLivery(livery);
  }

  add(geometry, material, position = [0, 0, 0], rotation = null, scale = null) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    if (scale) mesh.scale.set(...scale);
    this.root.add(mesh);
    return mesh;
  }

  buildFuselage() {
    const f = this.spec.fuselage;
    this.add(fuselageGeometry(f), this.materials.body);
    // Belly fairing where the wing joins the body: a flattened, stretched sphere.
    const w = this.spec.wing.stations[0];
    this.add(new THREE.SphereGeometry(1, 24, 12), this.materials.wing,
      [0, f.centreY - f.radius * f.stretchY * 0.72, w[1] - w[2] * 0.45], null,
      [f.radius * 0.92, f.radius * 0.42, w[2] * 0.62]);
  }

  wingStations() {
    const wing = this.spec.wing;
    const stations = wing.stations.map(([x, le, chord, dy, thick]) => ({
      le: new THREE.Vector3(x, wing.rootY + dy, le), chord, thick,
    }));
    const tip = stations[stations.length - 1];
    const tipSpec = wing.tip;
    if (tipSpec.type === 'sharklet') {
      // A320 "sharklet": a winglet swept up and back from the tip.
      stations.push({ le: tip.le.clone().add(new THREE.Vector3(0.35, 0.35, -0.2)), chord: tip.chord * 0.9, thick: 0.1 });
      stations.push({ le: tip.le.clone().add(new THREE.Vector3(0.7, tipSpec.height, -1.1)), chord: tipSpec.chord * 0.55, thick: 0.08 });
    } else if (tipSpec.type === 'curved') {
      // A350: the outer wing curves smoothly upwards.
      stations.push({ le: tip.le.clone().add(new THREE.Vector3(tipSpec.length * 0.55, tipSpec.rise * 0.22, -1.2)), chord: tip.chord * 0.75, thick: 0.09 });
      stations.push({ le: tip.le.clone().add(new THREE.Vector3(tipSpec.length, tipSpec.rise, -2.8)), chord: tip.chord * 0.35, thick: 0.08 });
    } else {
      // A380: small wingtip fence (up part).
      stations.push({ le: tip.le.clone().add(new THREE.Vector3(0.15, tipSpec.height, -0.8)), chord: tipSpec.chord * 0.7, thick: 0.08 });
    }
    return stations;
  }

  buildWings() {
    const stations = this.wingStations();
    const geometry = loftGeometry(stations, new THREE.Vector3(0, 1, 0));
    this.add(geometry, this.materials.wing);
    const right = this.add(geometry, this.materials.wing);
    right.scale.x = -1; // reflection: the right wing is the left wing mirrored in the x = 0 plane

    const main = this.spec.wing.stations[this.spec.wing.stations.length - 1];
    this.wingTip = new THREE.Vector3(main[0] + 0.2, this.spec.wing.rootY + main[3] + 0.1, main[1] - main[2] * 0.5);

    // Flap-track fairings: small canoe shapes under the trailing edge.
    const [root, kink, tipSt] = this.spec.wing.stations;
    [0.3, 0.6, 0.85].forEach((t) => {
      const a = t < 0.35 ? root : kink;
      const b = t < 0.35 ? kink : tipSt;
      const u = t < 0.35 ? t / 0.35 : (t - 0.35) / 0.65;
      const x = a[0] + (b[0] - a[0]) * u;
      const le = a[1] + (b[1] - a[1]) * u;
      const chord = a[2] + (b[2] - a[2]) * u;
      const y = this.spec.wing.rootY + a[3] + (b[3] - a[3]) * u;
      [1, -1].forEach((side) => {
        this.add(new THREE.ConeGeometry(0.22 * chord / 4, chord * 0.55, 8), this.materials.wing,
          [side * x, y - 0.25, le - chord * 0.85], [-Math.PI / 2, 0, 0]);
      });
    });
  }

  buildTail() {
    const s = this.spec;
    const f = s.fuselage;
    const stab = s.stabiliser.stations.map(([x, le, chord]) => ({
      le: new THREE.Vector3(x, s.stabiliser.y + (x > 1 ? x * 0.08 : 0), le), chord, thick: 0.1,
    }));
    const stabGeometry = loftGeometry(stab, new THREE.Vector3(0, 1, 0));
    this.add(stabGeometry, this.materials.wing);
    this.add(stabGeometry, this.materials.wing).scale.x = -1;

    // Vertical fin: stations stacked upwards, thickness sideways (x).
    const fin = s.fin;
    const baseY = f.centreY + f.tailRise * 0.45 + f.radius * f.stretchY * 0.55;
    const finStations = [
      { le: new THREE.Vector3(0, baseY - 0.8, fin.rootZ + 0.8), chord: fin.rootChord + 1.2, thick: 0.11 },
      { le: new THREE.Vector3(0, baseY, fin.rootZ), chord: fin.rootChord, thick: 0.11 },
      { le: new THREE.Vector3(0, baseY + fin.height, fin.tipZ), chord: fin.tipChord, thick: 0.1 },
    ];
    this.add(loftGeometry(finStations, new THREE.Vector3(1, 0, 0)), this.materials.tail);
    this.tailLightPos = new THREE.Vector3(0, f.centreY + f.tailRise, f.tailZ - 0.1);
  }

  buildEngines() {
    const n = this.spec.nacelle;
    const nacelle = nacelleGeometry(n);
    const fan = new THREE.CircleGeometry(n.inlet * 0.96, 32);
    const spinner = new THREE.ConeGeometry(n.inlet * 0.28, n.inlet * 0.6, 20);
    spinner.rotateX(Math.PI / 2); // cone tip forward (+Z)
    const plug = new THREE.ConeGeometry(n.exhaust * 0.75, n.length * 0.22, 16);
    plug.rotateX(-Math.PI / 2);   // exhaust cone pointing aft (-Z)
    const intake = new THREE.CylinderGeometry(n.inlet, n.inlet * 0.97, n.length * 0.12, 32, 1, true);
    intake.rotateX(Math.PI / 2);

    const wing = this.spec.wing;
    this.spec.engines.forEach((e) => {
      [1, -1].forEach((side) => {
        const x = side * e.x;
        const front = e.z + n.length / 2;
        this.add(nacelle, this.materials.engine, [x, e.y, front]);
        this.add(intake, this.materials.dark, [x, e.y, front - n.length * 0.06]);
        this.add(fan, this.materials.metal, [x, e.y, front - n.length * 0.12]);
        this.add(spinner, this.materials.dark, [x, e.y, front - n.length * 0.12 + n.inlet * 0.3]);
        this.add(plug, this.materials.metal, [x, e.y, front - n.length - n.length * 0.08]);
        // Pylon from the top of the nacelle up into the wing.
        const kink = wing.stations[1];
        const tipSt = wing.stations[2];
        const dy = e.x <= kink[0] ? kink[3] * (e.x / kink[0]) : kink[3] + (tipSt[3] - kink[3]) * ((e.x - kink[0]) / (tipSt[0] - kink[0]));
        const wingY = wing.rootY + dy;
        const height = Math.max(0.6, wingY - (e.y + n.radius) + 0.5);
        this.add(new THREE.BoxGeometry(0.35 * n.radius, height, n.length * 0.85), this.materials.wing,
          [x, e.y + n.radius + height / 2 - 0.25, e.z - n.length * 0.1]);
      });
    });
  }

  // Each gear leg is a group pivoting at its top. Retracting = rotating the
  // group 90 deg about X and hiding it once folded away.
  buildGear() {
    const s = this.spec;
    const f = s.fuselage;
    const strut = new THREE.CylinderGeometry(0.14, 0.14, 1, 10);
    const makeLeg = (x, z, top, wheelRadius, rows, perRow, spacing) => {
      const leg = new THREE.Group();
      leg.position.set(x, top, z);
      const length = top - wheelRadius;
      const s1 = new THREE.Mesh(strut, this.materials.metal);
      s1.scale.set(wheelRadius * 1.6, length, wheelRadius * 1.6); // unit cylinder stretched to the leg length
      s1.position.y = -length / 2;
      leg.add(s1);
      const wheel = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelRadius * 0.62, 18);
      if (rows > 1) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, spacing * (rows - 1) + 0.4), this.materials.metal);
        beam.position.y = -length;
        leg.add(beam);
      }
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < perRow; k++) {
          const w = new THREE.Mesh(wheel, this.materials.tyre);
          w.rotation.z = Math.PI / 2; // axle along X
          const across = perRow === 1 ? 0 : (k - (perRow - 1) / 2) * wheelRadius * 1.35;
          w.position.set(across, -length, (r - (rows - 1) / 2) * spacing);
          leg.add(w);
        }
      }
      this.root.add(leg);
      this.gear.push(leg);
    };
    const bodyBottom = f.centreY - f.radius * f.stretchY;
    makeLeg(0, s.gear.nose.z, bodyBottom + 0.3, s.gear.nose.radius, 1, s.gear.nose.wheels, 0);
    s.gear.main.forEach((m) => {
      [1, -1].forEach((side) => {
        makeLeg(side * m.x, m.z, Math.max(bodyBottom + 0.5, s.wing.rootY - 0.2), m.radius, m.rows, 2, m.radius * 2.25);
      });
    });
  }

  // extension: 1 = gear down, 0 = fully retracted
  setGearExtension(extension) {
    this.gear.forEach((leg) => {
      leg.rotation.x = (1 - extension) * (Math.PI / 2);
      leg.visible = extension > 0.03;
    });
  }

  applyLivery(livery) {
    const l = resolveLivery(livery);
    this.liveryKey = livery;
    this.livery = l;
    const m = this.materials;
    const { map, emissiveMap } = fuselageTextures(this.spec, l);
    m.body.map = map;
    m.body.emissiveMap = emissiveMap;
    m.body.needsUpdate = true;
    m.tail.color.set(l.tail);
    m.engine.color.set(l.engine);
  }

  buildLights() {
    const lamp = (color, size, position) => {
      const bulb = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0 });
      const glow = new THREE.SpriteMaterial({
        map: glowTexture(), color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), bulb);
      mesh.position.copy(position);
      const sprite = new THREE.Sprite(glow);
      sprite.scale.set(size, size, 1);
      sprite.position.copy(position);
      this.root.add(mesh, sprite);
      return { bulb, glow };
    };
    const f = this.spec.fuselage;
    const tip = this.wingTip;
    const mirror = (v) => new THREE.Vector3(-v.x, v.y, v.z);
    this.lights = {
      navLeft: lamp(0xff2020, 3, tip),                 // red on the left wing tip
      navRight: lamp(0x20ff40, 3, mirror(tip)),        // green on the right
      tail: lamp(0xffffff, 2.5, this.tailLightPos),
      beacon: lamp(0xff2020, 4, new THREE.Vector3(0, f.centreY + f.radius * f.stretchY + 0.15, 0)),
      beaconLow: lamp(0xff2020, 4, new THREE.Vector3(0, f.centreY - f.radius * f.stretchY - 0.15, -2)),
      strobeL: lamp(0xffffff, 6, tip.clone().add(new THREE.Vector3(0.1, 0, 0.6))),
      strobeR: lamp(0xffffff, 6, mirror(tip).add(new THREE.Vector3(-0.1, 0, 0.6))),
    };
    this.landingLight = new THREE.SpotLight(0xfff4e0, 0, 220, Math.PI / 7, 0.5, 1.5);
    this.landingLight.position.set(0, f.centreY - f.radius * 0.7, this.spec.gear.nose.z + 1);
    this.landingLight.target.position.set(0, 0, this.spec.gear.nose.z + 70);
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
    const lowOn = (elapsed + 0.6) % 1.2 < 0.15;
    set(this.lights.beaconLow, lowOn ? 6 : 0.1, lowOn ? 0.4 + 0.6 * k : 0);
    const t = elapsed % 1.6;
    const strobeOn = t < 0.06 || (t > 0.16 && t < 0.22);
    set(this.lights.strobeL, strobeOn ? 8 : 0, strobeOn ? 0.3 + 0.7 * k : 0);
    set(this.lights.strobeR, strobeOn ? 8 : 0, strobeOn ? 0.3 + 0.7 * k : 0);
    this.landingLight.intensity = this.landingLightOn ? k * 2500 : 0;
  }
}
