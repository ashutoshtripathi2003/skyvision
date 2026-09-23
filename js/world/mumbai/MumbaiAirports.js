import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRunway } from '../../airport/Runway.js';
import { createTower, TOWER } from '../../airport/Tower.js';
import { createWindsock } from '../../airport/Signs.js';
import { createLampBatch, registerEmissive } from '../../lighting/LightRegistry.js';
import { asphaltTexture, concreteTexture, facadeTexture, buildingTexture } from '../../utils/Textures.js';
import { seededRandom } from '../../utils/MathUtils.js';
import { createFleet } from '../../aircraft/Fleet.js';
import { FLEET_MIX } from '../../aircraft/Liveries.js';
import { AIRCRAFT_TYPES } from '../../aircraft/AircraftTypes.js';
import { ribbon, ribbonGeometry, densify } from './MumbaiTerrain.js';

// Builds CSMIA (Mumbai), Navi Mumbai and Juhu from real OpenStreetMap geometry:
// every polygon / polyline below comes straight from the map data, converted
// from latitude/longitude to local metres by the data build script.

const toPairs = (flat) => {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const [a, b] = [pts[0], pts[pts.length - 1]];
  if (pts.length > 2 && a[0] === b[0] && a[1] === b[1]) pts.pop(); // drop the closing duplicate
  return pts;
};

function shapeFrom(pts) {
  const shape = new THREE.Shape();
  // Shape space is XY; world Z maps to -Y so that rotating by -90 deg about X lands it on the ground.
  shape.moveTo(pts[0][0], -pts[0][1]);
  pts.slice(1).forEach(([x, z]) => shape.lineTo(x, -z));
  return shape;
}

function segmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function pointInPolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Split an ExtrudeGeometry into its caps (roof/floor) and its side walls, so each gets its own material.
function splitExtrusion(geometry) {
  const [caps, sides] = geometry.groups;
  const slice = (group) => {
    const g = new THREE.BufferGeometry();
    ['position', 'normal', 'uv'].forEach((name) => {
      const attr = geometry.attributes[name];
      g.setAttribute(name, new THREE.BufferAttribute(
        attr.array.slice(group.start * attr.itemSize, (group.start + group.count) * attr.itemSize), attr.itemSize,
      ));
    });
    return g;
  };
  return { caps: slice(caps), sides: slice(sides) };
}

export function createMumbaiAirports(data) {
  const json = data.json;
  const group = new THREE.Group();
  group.name = 'Mumbai airports';
  const airportPolys = new Map(json.airports.map((a) => [a.id, toPairs(a.polygon)]));
  const airportAt = (x, z) => json.airports.find((a) => pointInPolygon(x, z, airportPolys.get(a.id))) || json.airports[0];

  group.add(createAprons(json));
  group.add(createTaxiways(json));
  group.add(createRunways(json));
  group.add(createAirportBuildings(json));
  group.add(createJetBridges(json, airportAt));
  const { towers, towerEyes } = createTowers(json, airportPolys);
  group.add(towers);
  group.add(createApronLights(json));
  json.windsocks.forEach(([x, z]) => {
    const sock = createWindsock(x, z);
    sock.position.y = airportAt(x, z).y;
    group.add(sock);
  });
  const stands = describeStands(json);
  group.add(createParkedFleet(stands));
  return { group, towerEyes, stands };
}

// Stand list for the taxi-to-gate logic: how much room each stand has (distance
// to the nearest neighbouring stand = the wingspan it can take) and whether it
// is a "contact" stand at a jet bridge.
function describeStands(json) {
  const bridgeEnds = json.jetBridges.flatMap((f) => [[f[0], f[1]], [f[f.length - 2], f[f.length - 1]]]);
  const count = {};
  return json.stands.map((s, i) => ({
    x: s.x, y: s.y, z: s.z, heading: s.heading, airport: s.airport,
    name: s.ref || String((count[s.airport] = (count[s.airport] || 0) + 1)),
    spacing: json.stands.reduce((best, o, j) => (j === i ? best : Math.min(best, Math.hypot(o.x - s.x, o.z - s.z))), Infinity),
    contact: bridgeEnds.some(([x, z]) => Math.hypot(x - s.x, z - s.z) < 45),
    occupied: false,
  }));
}

function createAprons(json) {
  const geometries = json.aprons.map((apron) => {
    const g = new THREE.ShapeGeometry(shapeFrom(toPairs(apron.p)));
    g.rotateX(-Math.PI / 2);
    g.translate(0, apron.y + 0.05, 0);
    return g;
  });
  // OpenStreetMap maps only some of the aprons, so every stand also gets a
  // concrete pad: an 80 x 107 m rectangle rotated to the stand heading, reaching
  // back from the nose stop mark to well beyond the tail. Neighbouring pads merge
  // into continuous aprons.
  json.stands.forEach((s) => {
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const corners = [[-40, 12], [40, 12], [40, -95], [-40, -95]].map(([side, along]) => [
      s.x + fx * along - fz * side, s.z + fz * along + fx * side,
    ]);
    const g = new THREE.ShapeGeometry(shapeFrom(corners));
    g.rotateX(-Math.PI / 2);
    g.translate(0, s.y + 0.045, 0);
    geometries.push(g);
  });
  const texture = concreteTexture(1, 1);
  texture.repeat.set(1 / 25, 1 / 25); // shape UVs are in metres: one concrete slab texture per 25 m
  const mesh = new THREE.Mesh(mergeGeometries(geometries), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }));
  mesh.receiveShadow = true;
  return mesh;
}

function createTaxiways(json) {
  const surface = { positions: [], uvs: [], indices: [] };
  const centre = { positions: [], uvs: [], indices: [] };
  const edgeLamps = [];
  json.taxiways.forEach((t) => {
    const pts = densify(t.p, 40);
    ribbon(pts, t.w, () => t.y + 0.07, surface);
    ribbon(pts, 0.7, () => t.y + 0.1, centre);
    // Blue edge lights at every (densified, <= 40 m) point on both sides.
    for (let k = 0; k < pts.length / 2 - 1; k++) {
      const x0 = pts[k * 2]; const z0 = pts[k * 2 + 1];
      const x1 = pts[k * 2 + 2]; const z1 = pts[k * 2 + 3];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 25) continue;
      const nx = -(z1 - z0) / len * (t.w / 2 + 1.5);
      const nz = (x1 - x0) / len * (t.w / 2 + 1.5);
      edgeLamps.push([x0 + nx, t.y + 0.4, z0 + nz], [x0 - nx, t.y + 0.4, z0 - nz]);
    }
  });
  const group = new THREE.Group();
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(1, 1), color: 0x9a9a9e, roughness: 0.95 });
  const taxi = new THREE.Mesh(ribbonGeometry(surface), asphalt);
  taxi.receiveShadow = true;
  const line = new THREE.Mesh(ribbonGeometry(centre), new THREE.MeshStandardMaterial({ color: 0xffc814, roughness: 0.8 }));
  group.add(taxi, line, createLampBatch(0x3a6bff, edgeLamps, { size: 0.35, glowSize: 5 }));
  return group;
}

function createRunways(json) {
  const group = new THREE.Group();
  const perAirport = new Map();
  [...json.runways].sort((a, b) => b.length - a.length).forEach((r) => {
    const index = perAirport.get(r.airport) || 0;
    perAirport.set(r.airport, index + 1);
    const runway = createRunway({
      length: r.length, width: r.width, designators: r.designators,
      approachEnds: r.length > 1500 ? ['near', 'far'] : [], endLights: 'green',
      yOffset: index * 0.04, // crossing runways: the shorter one sits 4 cm higher so they don't flicker
    });
    runway.position.set(r.x, r.y, r.z);
    runway.rotation.y = r.rotation;
    group.add(runway);
  });
  return group;
}

function createAirportBuildings(json) {
  const facade = facadeTexture({ columns: 4, rows: 2, seed: 11 });
  facade.repeat.set(1 / 16, 1 / 8);
  const facadeLit = facadeTexture({ columns: 4, rows: 2, lit: true, seed: 11 });
  facadeLit.repeat.set(1 / 16, 1 / 8);
  const office = buildingTexture({ seed: 12 });
  office.repeat.set(1 / 14, 1 / 12);
  const officeLit = buildingTexture({ lit: true, seed: 12 });
  officeLit.repeat.set(1 / 14, 1 / 12);

  const materials = {
    terminal: new THREE.MeshStandardMaterial({ map: facade, emissive: 0xffffff, emissiveMap: facadeLit, emissiveIntensity: 0, roughness: 0.3, metalness: 0.35 }),
    hangar: new THREE.MeshStandardMaterial({ color: 0xb9c2ca, metalness: 0.5, roughness: 0.45 }),
    building: new THREE.MeshStandardMaterial({ map: office, emissive: 0xffffff, emissiveMap: officeLit, emissiveIntensity: 0, roughness: 0.8 }),
    roof: new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.6, metalness: 0.2 }),
  };
  registerEmissive(materials.terminal, 1.2);
  registerEmissive(materials.building, 0.7);

  const lists = { terminal: [], hangar: [], building: [], roof: [] };
  json.buildings.forEach((b) => {
    const pts = toPairs(b.p);
    if (pts.length < 3) return;
    const geometry = new THREE.ExtrudeGeometry(shapeFrom(pts), { depth: b.h, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2); // shape XY -> ground plane, extrusion direction -> up (+Y)
    geometry.translate(0, b.y, 0);
    const { caps, sides } = splitExtrusion(geometry);
    const kind = b.kind === 'tower' ? 'building' : b.kind;
    lists[kind].push(sides);
    lists.roof.push(caps);
  });

  const group = new THREE.Group();
  Object.entries(lists).forEach(([kind, list]) => {
    if (list.length === 0) return;
    const mesh = new THREE.Mesh(mergeGeometries(list), materials[kind]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}

// Jet bridges: each polyline segment becomes a box, positioned at the segment
// midpoint and rotated to its direction (translation + rotation per segment).
function createJetBridges(json, airportAt) {
  const boxes = [];
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  json.jetBridges.forEach((flat) => {
    const pts = toPairs(flat);
    const y = airportAt(pts[0][0], pts[0][1]).y + 5;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1) continue;
      const box = new THREE.BoxGeometry(3.2, 3, len);
      q.setFromAxisAngle(up, Math.atan2(x1 - x0, z1 - z0));
      matrix.compose(new THREE.Vector3((x0 + x1) / 2, y, (z0 + z1) / 2), q, new THREE.Vector3(1, 1, 1));
      box.applyMatrix4(matrix);
      boxes.push(box);
    }
  });
  if (boxes.length === 0) return new THREE.Group();
  const mesh = new THREE.Mesh(mergeGeometries(boxes), new THREE.MeshStandardMaterial({ color: 0xd4d8dc, metalness: 0.3, roughness: 0.5 }));
  mesh.castShadow = true;
  return mesh;
}

// OpenStreetMap has no control tower for CSMIA or Navi Mumbai, so each tower is
// placed automatically: the open spot inside the airport boundary closest to the
// terminals that keeps clear of runways, taxiways, aprons and buildings.
function createTowers(json, airportPolys) {
  const group = new THREE.Group();
  const towerEyes = new Map();
  const SCALE = { BOM: 1.9, NMI: 1.6, JUH: 0.8 };
  json.airports.forEach((apt) => {
    const scale = SCALE[apt.id] || 1;
    let spot = json.towers.find((t) => t.airport === apt.id);
    if (!spot) spot = findTowerSpot(json, apt, airportPolys.get(apt.id));
    if (!spot) return;
    const tower = createTower({ x: 0, z: 0 });
    tower.scale.setScalar(scale);
    tower.position.set(spot.x, apt.y, spot.z);
    group.add(tower);
    towerEyes.set(apt.id, new THREE.Vector3(spot.x - 3 * scale, apt.y + (TOWER.cabHeight + 0.5) * scale, spot.z));
  });
  return { towers: group, towerEyes };
}

function findTowerSpot(json, apt, poly) {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const terminals = json.buildings.filter((b) => b.kind === 'terminal' && pointInPolygon(b.p[0], b.p[1], poly));
  const anchor = terminals.length
    ? terminals.reduce((acc, b) => [acc[0] + b.p[0] / terminals.length, acc[1] + b.p[1] / terminals.length], [0, 0])
    : [apt.x, apt.z];
  const runways = json.runways.filter((r) => r.airport === apt.id);
  const taxiSegs = [];
  json.taxiways.forEach((t) => {
    if (!pointInPolygon(t.p[0], t.p[1], poly)) return;
    for (let i = 0; i < t.p.length - 2; i += 2) taxiSegs.push([t.p[i], t.p[i + 1], t.p[i + 2], t.p[i + 3]]);
  });
  const apronPolys = json.aprons.map((a) => toPairs(a.p));
  const buildingPolys = json.buildings.map((b) => toPairs(b.p));

  let best = null;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 50) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 50) {
      if (!pointInPolygon(x, z, poly)) continue;
      const clearOfRunways = runways.every((r) => {
        const c = Math.cos(r.rotation);
        const s = Math.sin(r.rotation);
        const lx = c * (x - r.x) - s * (z - r.z);
        const lz = s * (x - r.x) + c * (z - r.z);
        return Math.abs(lx) > r.width / 2 + 200 || Math.abs(lz) > r.length / 2 + 200;
      });
      if (!clearOfRunways) continue;
      if (taxiSegs.some(([ax, az, bx, bz]) => segmentDistance(x, z, ax, az, bx, bz) < 60)) continue;
      if (apronPolys.some((p) => pointInPolygon(x, z, p)) || buildingPolys.some((p) => pointInPolygon(x, z, p))) continue;
      const score = Math.hypot(x - anchor[0], z - anchor[1]);
      if (!best || score < best.score) best = { x, z, score };
    }
  }
  return best;
}

// Floodlight masts around the aprons (instanced poles + batched lamps).
function createApronLights(json) {
  const lamps = [];
  const poles = [];
  json.aprons.forEach((apron) => {
    const pts = toPairs(apron.p);
    let carry = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let d = 90 - carry; d < len; d += 90) {
        const t = d / len;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        poles.push([x, apron.y, z]);
        lamps.push([x, apron.y + 25, z]);
      }
      carry = (carry + len) % 90;
    }
  });
  const group = new THREE.Group();
  const pole = new THREE.CylinderGeometry(0.35, 0.5, 25, 6);
  pole.translate(0, 12.5, 0);
  const mesh = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x70767d }), poles.length);
  const m = new THREE.Matrix4();
  poles.forEach(([x, y, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x, y, z)));
  mesh.computeBoundingSphere();
  group.add(mesh, createLampBatch(0xffe7b8, lamps, { size: 1.2, glowSize: 26 }));
  return group;
}

// Parked airliners at the real stands, in Indian airline colours. The models are
// real size (1 unit = 1 m), so the type is chosen by the room at each stand:
// A320s anywhere, A350s (65 m span) and A380s (80 m span) only at wide stands.
function createParkedFleet(stands) {
  const rand = seededRandom(2026);
  const occupancy = { BOM: 0.72, NMI: 0.5 };
  const pick = (mix) => {
    const total = Object.values(mix).reduce((a, b) => a + b, 0);
    let r = rand() * total;
    for (const [key, w] of Object.entries(mix)) { r -= w; if (r <= 0) return key; }
    return Object.keys(mix)[0];
  };
  const placements = [];
  stands.forEach((s) => {
    const mix = FLEET_MIX[s.airport];
    if (!mix || rand() > occupancy[s.airport]) return;
    let livery = pick(mix);
    let type = 'a320';
    if (s.spacing > 82 && rand() < 0.35) { type = 'a380'; livery = 'skyvision'; }
    else if (s.spacing > 62 && (livery === 'airindia' || rand() < 0.25)) { type = 'a350'; livery = 'airindia'; }
    s.occupied = true;
    // The stand point is where the nose wheel stops; the aircraft origin (main gear) is behind it.
    const back = AIRCRAFT_TYPES[type].gear.nose.z + 1;
    placements.push({
      x: s.x - Math.sin(s.heading) * back, y: s.y, z: s.z - Math.cos(s.heading) * back,
      heading: s.heading, scale: 1, livery, type,
    });
  });
  return createFleet(placements);
}
