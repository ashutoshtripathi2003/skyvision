// Builds the real-world region data (Mumbai, Delhi, Bengaluru, Hyderabad,
// Chennai, Kolkata, Goa) used by the real-airport modes.
//
//   node tools/build-region-data.mjs <region>      e.g. mumbai, delhi, goa
//   node tools/build-region-data.mjs all
//
// Sources (downloaded once, cached in tools/.cache/):
//   - OpenStreetMap via the Overpass API: runways, taxiways, aprons, terminals,
//     hangars, aircraft stands, jet bridges, city buildings and major roads.
//     (c) OpenStreetMap contributors, ODbL - the app shows this attribution.
//   - Elevation: AWS Terrain Tiles ("terrarium" PNG encoding), zoom 12 (~38 m/pixel).
//
// Output (assets/data/), per region:
//   <region>.json           - airports, runways, taxiways, aprons, buildings, stands, roads
//   <region>-terrain.bin    - Int16 height grid in decimetres
//   <region>-buildings.bin  - 5 x Int16 per city building: x, z, width, depth (dm), height (dm)
//
// Coordinates: latitude/longitude are projected onto a flat local plane
// (equirectangular projection around the region's origin): x = east metres, z = south metres.

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const OUT = path.join(ROOT, 'assets', 'data');
const CACHE = path.join(ROOT, 'tools', '.cache');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

// Each region: a bounding box around its airport(s); every airport is identified
// by its OpenStreetMap aerodrome boundary (a way, or a multipolygon relation).
// Single-airport regions are ~20 x 20 km centred on the airport.
const around = (lat, lon, dLat = 0.095, dLon = 0.1) => ({ s: lat - dLat, n: lat + dLat, w: lon - dLon, e: lon + dLon });
export const REGIONS = {
  mumbai: {
    origin: { lat: 19.04, lon: 72.955 },
    bbox: { s: 18.93, w: 72.78, n: 19.17, e: 73.13 },
    cachePrefix: '', buildingGrid: 2, maxBuildings: Infinity,
    airports: [
      { id: 'BOM', way: 22826676, name: 'Chhatrapati Shivaji Maharaj International Airport', short: 'Mumbai', minElevation: 8 },
      { id: 'NMI', way: 455547086, name: 'Navi Mumbai International Airport', short: 'Navi Mumbai', minElevation: 8 },
      { id: 'JUH', way: 49794789, name: 'Juhu Aerodrome', short: 'Juhu', minElevation: 4 },
    ],
  },
  delhi: {
    bbox: around(28.5554, 77.0971), buildingGrid: 3, maxBuildings: 130000,
    airports: [{ id: 'DEL', rel: 19597141, name: 'Indira Gandhi International Airport', short: 'Delhi', minElevation: 0 }],
  },
  bengaluru: {
    bbox: around(13.1976, 77.7063), buildingGrid: 3, maxBuildings: 130000,
    airports: [{ id: 'BLR', way: 252746837, name: 'Kempegowda International Airport', short: 'Bengaluru', minElevation: 0 }],
  },
  hyderabad: {
    bbox: around(17.2313, 78.4322), buildingGrid: 3, maxBuildings: 130000,
    airports: [{ id: 'HYD', rel: 10734455, name: 'Rajiv Gandhi International Airport', short: 'Hyderabad', minElevation: 0 }],
  },
  chennai: {
    bbox: around(12.9934, 80.1673), buildingGrid: 3, maxBuildings: 130000,
    airports: [{ id: 'MAA', way: 23633604, name: 'Chennai International Airport', short: 'Chennai', minElevation: 6 }],
  },
  kolkata: {
    bbox: around(22.6564, 88.4448), buildingGrid: 3, maxBuildings: 130000,
    airports: [{ id: 'CCU', way: 64689452, name: 'Netaji Subhash Chandra Bose International Airport', short: 'Kolkata', minElevation: 4 }],
  },
  goa: {
    bbox: around(15.3806, 73.8327), buildingGrid: 3, maxBuildings: 130000,
    airports: [{ id: 'GOI', way: 91549529, name: 'Goa International Airport (Dabolim)', short: 'Goa', minElevation: 20 }],
  },
};

const REGION_ID = process.argv[2] || 'mumbai';
if (REGION_ID !== 'all' && !REGIONS[REGION_ID]) throw new Error(`unknown region ${REGION_ID}: ${Object.keys(REGIONS).join(', ')}`);
let REGION; let ORIGIN; let BBOX; let AIRPORTS; let M_PER_DEG_LON; let PREFIX;
function selectRegion(id) {
  REGION = REGIONS[id];
  BBOX = REGION.bbox;
  ORIGIN = REGION.origin || { lat: (BBOX.s + BBOX.n) / 2, lon: (BBOX.w + BBOX.e) / 2 };
  AIRPORTS = REGION.airports;
  M_PER_DEG_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
  PREFIX = REGION.cachePrefix ?? `${id}-`;
}
const GRID_STEP = 60;
const DEM_ZOOM = 12;

const M_PER_DEG_LAT = 110574;
const project = (lat, lon) => [(lon - ORIGIN.lon) * M_PER_DEG_LON, -(lat - ORIGIN.lat) * M_PER_DEG_LAT];
const unproject = (x, z) => [ORIGIN.lat - z / M_PER_DEG_LAT, ORIGIN.lon + x / M_PER_DEG_LON];
const round1 = (v) => Math.round(v * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEADERS = { 'User-Agent': 'SkyVision-CG-student-project/1.0 (educational)', Accept: 'application/json' };

// ---------------------------------------------------------------- Overpass
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function overpass(label, query, attempts = 12) {
  const file = path.join(CACHE, `${PREFIX}${label}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      process.stdout.write(`  ${label}: ${new URL(url).host} (try ${attempt + 1})... `);
      const res = await fetch(url, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const text = await res.text();
      if (!res.ok || text.startsWith('<')) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(text);
      if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(json.remark.slice(0, 80));
      fs.writeFileSync(file, text);
      console.log(`${json.elements.length} elements`);
      return json;
    } catch (err) {
      console.log(`failed (${err.message})`);
      await sleep(8000 + attempt * 4000);
    }
  }
  throw new Error(`Overpass query "${label}" failed repeatedly`);
}

// ---------------------------------------------------------------- geometry helpers
const geomToXZ = (geometry) => geometry.map((p) => project(p.lat, p.lon));
const flat = (points) => points.flatMap(([x, z]) => [round1(x), round1(z)]);

function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToPolygon(x, z, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j];
    const [bx, bz] = poly[i];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

// A multipolygon's outline can be split over several ways; join them end to end
// (reversing pieces where needed) until each ring closes.
function stitchRings(pieces) {
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  const pool = pieces.map((p) => [...p]);
  const rings = [];
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (grew && !same(ring[0], ring[ring.length - 1])) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        const end = ring[ring.length - 1];
        if (same(end, s[0])) ring = ring.concat(s.slice(1));
        else if (same(end, s[s.length - 1])) ring = ring.concat([...s].reverse().slice(1));
        else if (same(ring[0], s[s.length - 1])) ring = s.concat(ring.slice(1));
        else if (same(ring[0], s[0])) ring = [...s].reverse().concat(ring.slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

const centroid = (poly) => {
  let x = 0;
  let z = 0;
  poly.forEach(([px, pz]) => { x += px; z += pz; });
  return [x / poly.length, z / poly.length];
};

function parseHeight(tags, fallback) {
  const h = parseFloat(tags.height);
  if (Number.isFinite(h) && h > 0) return h;
  const levels = parseFloat(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return levels * 3.3;
  return fallback;
}

// Deterministic hash so default heights are stable between runs.
const hash01 = (n) => {
  let h = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------- terrain
async function loadTile(x, y) {
  const file = path.join(CACHE, `dem-${DEM_ZOOM}-${x}-${y}.png`);
  if (!fs.existsSync(file)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_ZOOM}/${x}/${y}.png`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`DEM tile ${x}/${y}: HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return PNG.sync.read(fs.readFileSync(file));
}

const n = 2 ** DEM_ZOOM;
const lonToPx = (lon) => ((lon + 180) / 360) * n * 256;
const latToPx = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256;
};

async function buildTerrain() {
  console.log('Elevation tiles');
  const tx0 = Math.floor(lonToPx(BBOX.w) / 256);
  const tx1 = Math.floor(lonToPx(BBOX.e) / 256);
  const ty0 = Math.floor(latToPx(BBOX.n) / 256);
  const ty1 = Math.floor(latToPx(BBOX.s) / 256);
  const tiles = new Map();
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) tiles.set(`${tx},${ty}`, await loadTile(tx, ty));
  }
  console.log(`  ${tiles.size} tiles`);

  const elevationAtPx = (px, py) => {
    const tile = tiles.get(`${Math.floor(px / 256)},${Math.floor(py / 256)}`);
    if (!tile) return 0;
    const ix = Math.min(255, Math.max(0, Math.floor(px) % 256));
    const iy = Math.min(255, Math.max(0, Math.floor(py) % 256));
    const i = (iy * 256 + ix) * 4;
    return tile.data[i] * 256 + tile.data[i + 1] + tile.data[i + 2] / 256 - 32768;
  };
  // Bilinear interpolation between the four surrounding DEM pixels.
  const elevation = (lat, lon) => {
    const px = lonToPx(lon) - 0.5;
    const py = latToPx(lat) - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const a = elevationAtPx(x0, y0);
    const b = elevationAtPx(x0 + 1, y0);
    const c = elevationAtPx(x0, y0 + 1);
    const d = elevationAtPx(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };

  const [minX] = project(BBOX.n, BBOX.w);
  const [maxX] = project(BBOX.n, BBOX.e);
  const minZ = project(BBOX.n, BBOX.w)[1];
  const maxZ = project(BBOX.s, BBOX.w)[1];
  const width = Math.floor((maxX - minX) / GRID_STEP) + 1;
  const height = Math.floor((maxZ - minZ) / GRID_STEP) + 1;
  const heights = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const [lat, lon] = unproject(minX + i * GRID_STEP, minZ + j * GRID_STEP);
      heights[j * width + i] = elevation(lat, lon);
    }
  }
  return { minX, minZ, width, height, step: GRID_STEP, heights };
}

// Airports sit on flat ground: inside the boundary the grid is set to the
// airport elevation, and blended back to the natural terrain over 400 m.
function flattenAirports(grid, airports) {
  const BLEND = 400;
  airports.forEach((apt) => {
    const xs = apt.polygon.map((p) => p[0]);
    const zs = apt.polygon.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - BLEND - grid.minX) / grid.step));
    const i1 = Math.min(grid.width - 1, Math.ceil((Math.max(...xs) + BLEND - grid.minX) / grid.step));
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - BLEND - grid.minZ) / grid.step));
    const j1 = Math.min(grid.height - 1, Math.ceil((Math.max(...zs) + BLEND - grid.minZ) / grid.step));

    const inside = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = grid.minX + i * grid.step;
        const z = grid.minZ + j * grid.step;
        if (pointInPolygon(x, z, apt.polygon)) inside.push(grid.heights[j * grid.width + i]);
      }
    }
    inside.sort((a, b) => a - b);
    const median = inside.length ? inside[Math.floor(inside.length / 2)] : 5;
    apt.y = round1(Math.max(apt.ele ?? median, apt.minElevation));

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = grid.minX + i * grid.step;
        const z = grid.minZ + j * grid.step;
        const k = j * grid.width + i;
        if (pointInPolygon(x, z, apt.polygon)) { grid.heights[k] = apt.y; continue; }
        const d = distanceToPolygon(x, z, apt.polygon);
        if (d < BLEND) {
          const t = d / BLEND;
          const s = t * t * (3 - 2 * t);
          grid.heights[k] = apt.y + (grid.heights[k] - apt.y) * s;
        }
      }
    }
  });
}

// ---------------------------------------------------------------- runways
function compassOf(ux, uz) {
  return ((Math.atan2(ux, -uz) * 180) / Math.PI + 360) % 360;
}

function buildRunways(elements, airport) {
  const ways = elements.filter((e) => e.type === 'way' && e.tags?.aeroway === 'runway' && e.geometry);
  let mains = ways.filter((w) => w.tags.runway !== 'displaced_threshold' && w.tags.ref);
  if (mains.length === 0) {
    // Runways mapped without a "ref" (e.g. Goa): use the longest open centrelines;
    // their designators are worked out from the heading below.
    const pathLength = (w) => geomToXZ(w.geometry).reduce((sum, p, i, pts) => (i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
    const open = (w) => !(w.geometry[0].lat === w.geometry[w.geometry.length - 1].lat && w.geometry[0].lon === w.geometry[w.geometry.length - 1].lon);
    const ranked = ways.filter(open).map((w) => [w, pathLength(w)]).sort((x, y) => y[1] - x[1]);
    if (ranked.length) mains = ranked.filter(([, l]) => l >= ranked[0][1] * 0.7).map(([w]) => w);
  }
  const extras = ways.filter((w) => !mains.includes(w));
  const runways = [];
  const seen = new Set();

  mains.forEach((main) => {
    const pts = geomToXZ(main.geometry);
    const a = pts[0];
    const b = pts[pts.length - 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const key = main.tags.ref || String(main.id);
    if (seen.has(key)) return;
    seen.add(key);

    // Include collinear displaced-threshold segments in the paved length.
    let tMin = 0;
    let tMax = len;
    extras.forEach((w) => {
      const q = geomToXZ(w.geometry);
      const off = q.map(([x, z]) => Math.abs((x - a[0]) * -uz + (z - a[1]) * ux));
      if (Math.max(...off) > 40) return;
      q.forEach(([x, z]) => {
        const t = (x - a[0]) * ux + (z - a[1]) * uz;
        tMin = Math.min(tMin, t);
        tMax = Math.max(tMax, t);
      });
    });

    const center = [a[0] + ux * (tMin + tMax) / 2, a[1] + uz * (tMin + tMax) / 2];
    const hdg = compassOf(ux, uz);
    const near = Math.round(hdg / 10) || 36;
    let labels = [String(near).padStart(2, '0'), String(((near + 17) % 36) + 1).padStart(2, '0')];
    const refParts = key.split('/').map((s) => s.trim());
    if (refParts.length === 2) {
      const num = (s) => parseInt(s, 10);
      const diff = (s) => Math.abs(((num(s) * 10 - hdg + 540) % 360) - 180);
      labels = diff(refParts[0]) < diff(refParts[1]) ? refParts : [refParts[1], refParts[0]];
    }
    const width = parseFloat(main.tags.width) || (len > 2500 ? 60 : len > 1500 ? 45 : 30);
    runways.push({
      id: `${airport.id}-${labels[0]}`,
      airport: airport.id,
      ref: key,
      x: round1(center[0]),
      z: round1(center[1]),
      // local -Z runs from the first node towards the last node
      rotation: Math.round(Math.atan2(-ux, -uz) * 10000) / 10000,
      length: Math.round(tMax - tMin),
      width,
      designators: labels,
    });
  });
  return runways;
}

// ---------------------------------------------------------------- main
async function buildRegion(id) {
  selectRegion(id);
  console.log(`\n=== ${id}`);
  console.log('OpenStreetMap: airports');
  const ref = (a) => (a.rel ? `rel(${a.rel})` : `way(${a.way})`);
  const areaDefs = AIRPORTS.map((a, i) => `${ref(a)};map_to_area->.a${i};`).join('');
  const aeroSel = AIRPORTS.map((_, i) => `
    way["aeroway"~"^(runway|taxiway|taxilane|apron|terminal|hangar|parking_position|jet_bridge|tower)$"](area.a${i});
    relation["aeroway"="apron"](area.a${i});
    node["aeroway"~"^(parking_position|tower|windsock)$"](area.a${i});
    way["building"](area.a${i});`).join('');
  // Mumbai (cached) used "area" queries; the newer regions use a plain bounding
  // box around the airport, which the Overpass servers answer far more reliably,
  // and keep only what lies inside the airport boundary afterwards.
  const c = { lat: (BBOX.s + BBOX.n) / 2, lon: (BBOX.w + BBOX.e) / 2 };
  const box = `${c.lat - 0.05},${c.lon - 0.055},${c.lat + 0.05},${c.lon + 0.055}`;
  const airportQuery = REGION.cachePrefix === ''
    ? `[out:json][timeout:240];${areaDefs}(${aeroSel}
    ${AIRPORTS.map((a) => `${ref(a)};`).join('')});out geom;`
    : `[out:json][timeout:240];(
    way["aeroway"~"^(runway|taxiway|taxilane|apron|terminal|hangar|parking_position|jet_bridge|tower)$"](${box});
    relation["aeroway"="apron"](${box});
    node["aeroway"~"^(parking_position|tower|windsock)$"](${box});
    way["building"]["aeroway"](${box});
    way["building"~"^(terminal|hangar|transportation|industrial|warehouse|office|commercial)$"](${box});
    ${AIRPORTS.map((a) => `${ref(a)};`).join('')});out geom;`;
  const airportsData = await overpass('airports', airportQuery);

  console.log('OpenStreetMap: major roads');
  const roadsData = await overpass('roads', `[out:json][timeout:240];
    way["highway"~"^(motorway|trunk|primary|secondary)$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});out geom tags;`);

  console.log('OpenStreetMap: city buildings (bounding boxes)');
  const buildingChunks = [];
  const g = REGION.buildingGrid;
  const quads = [];
  for (let row = 0; row < g; row++) {
    for (let col = 0; col < g; col++) {
      const s = BBOX.s + ((BBOX.n - BBOX.s) * row) / g;
      const w = BBOX.w + ((BBOX.e - BBOX.w) * col) / g;
      quads.push([s, w, s + (BBOX.n - BBOX.s) / g, w + (BBOX.e - BBOX.w) / g]);
    }
  }
  // A tile the servers keep timing out on (a dense city) is split into four smaller ones.
  async function buildingTile(label, [s, w, n, e], depth = 0) {
    try {
      return [await overpass(label, `[out:json][timeout:300];way["building"](${s},${w},${n},${e});out bb tags;`, depth < 2 ? 4 : 10)];
    } catch (err) {
      if (depth >= 2) throw err;
      console.log(`  ${label}: splitting into 4 smaller tiles`);
      const ms = (s + n) / 2;
      const mw = (w + e) / 2;
      const parts = [];
      for (const [k, box] of [[s, w, ms, mw], [s, mw, ms, e], [ms, w, n, mw], [ms, mw, n, e]].entries()) {
        parts.push(...await buildingTile(`${label}-${k}`, box, depth + 1));
      }
      return parts;
    }
  }
  for (const [i, q] of quads.entries()) {
    buildingChunks.push(...await buildingTile(`buildings-${i}`, q));
  }

  // ---- airports
  const els = airportsData.elements;
  const airports = AIRPORTS.map((def) => {
    const way = def.rel
      ? els.find((e) => e.type === 'relation' && e.id === def.rel)
      : els.find((e) => e.type === 'way' && e.id === def.way);
    // A relation's boundary: the largest outer ring stitched from its member ways.
    const polygon = def.rel
      ? stitchRings(way.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry))
        .map(geomToXZ).sort((a, b) => b.length - a.length)[0]
      : geomToXZ(way.geometry);
    const [cx, cz] = centroid(polygon);
    const ele = parseFloat(way.tags.ele);
    return {
      ...def, iata: way.tags.iata || null, icao: way.tags.icao || null,
      x: round1(cx), z: round1(cz), ele: Number.isFinite(ele) ? ele : null, polygon,
    };
  });
  const airportOf = (x, z) => airports.find((a) => pointInPolygon(x, z, a.polygon)) ||
    airports.reduce((best, a) => (Math.hypot(x - a.x, z - a.z) < Math.hypot(x - best.x, z - best.z) ? a : best));

  if (REGION.cachePrefix !== '') {
    const near = (x, z, margin) => airports.some((a) => pointInPolygon(x, z, a.polygon) || distanceToPolygon(x, z, a.polygon) < margin);
    const keep = (e) => {
      if (AIRPORTS.some((a) => e.id === (a.rel || a.way))) return true;
      const [x, z] = e.type === 'node' ? project(e.lat, e.lon)
        : e.geometry ? project(e.geometry[0].lat, e.geometry[0].lon)
          : e.members && e.members.find((m) => m.geometry) ? project(e.members.find((m) => m.geometry).geometry[0].lat, e.members.find((m) => m.geometry).geometry[0].lon)
            : [Infinity, Infinity];
      return near(x, z, e.tags && e.tags.aeroway === 'runway' ? 50 : 150);
    };
    const before = els.length;
    const kept = els.filter(keep);
    els.length = 0;
    els.push(...kept);
    console.log(`  kept ${els.length} of ${before} airport map elements inside the boundary`);
  }

  const grid = await buildTerrain();
  flattenAirports(grid, airports);

  const runways = [];
  airports.forEach((apt) => {
    const mine = els.filter((e) => e.geometry && e.tags?.aeroway === 'runway'
      && airportOf(...project(e.geometry[0].lat, e.geometry[0].lon)) === apt);
    runways.push(...buildRunways(mine, apt).map((r) => ({ ...r, y: apt.y })));
  });

  const taxiways = els.filter((e) => e.type === 'way' && /^(taxiway|taxilane)$/.test(e.tags?.aeroway) && e.geometry)
    .map((e) => {
      const pts = geomToXZ(e.geometry);
      return {
        w: parseFloat(e.tags.width) || (e.tags.aeroway === 'taxilane' ? 14 : 23),
        y: airportOf(...pts[0]).y,
        p: flat(pts),
      };
    });

  const aprons = [];
  els.filter((e) => e.tags?.aeroway === 'apron').forEach((e) => {
    const rings = e.type === 'relation' && e.members
      ? stitchRings(e.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry)).map(geomToXZ)
      : e.geometry ? [geomToXZ(e.geometry)] : [];
    rings.forEach((ring) => aprons.push({ y: airportOf(...ring[0]).y, p: flat(ring) }));
  });

  const airportBuildings = els.filter((e) => e.type === 'way' && e.geometry && e.geometry.length > 3
    && (e.tags?.building || /^(terminal|hangar|tower)$/.test(e.tags?.aeroway)))
    .map((e) => {
      const pts = geomToXZ(e.geometry);
      const kind = e.tags.aeroway === 'terminal' || e.tags.building === 'terminal' ? 'terminal'
        : e.tags.aeroway === 'hangar' || e.tags.building === 'hangar' ? 'hangar'
          : e.tags.aeroway === 'tower' || e.tags.man_made === 'tower' ? 'tower' : 'building';
      const fallback = { terminal: 26, hangar: 22, tower: 30, building: 9 + hash01(e.id) * 8 }[kind];
      let h = parseHeight(e.tags, fallback);
      if (kind === 'terminal') h = Math.max(h, 24);
      return { kind, name: e.tags.name || null, h: round1(h), y: airportOf(...pts[0]).y, p: flat(pts) };
    });

  // Aircraft stands: the lead-in line ends at the stop point; the nose points
  // toward the end closest to a terminal / jet bridge.
  const bridges = els.filter((e) => e.tags?.aeroway === 'jet_bridge' && e.geometry).map((e) => geomToXZ(e.geometry));
  const terminalPoints = airportBuildings.filter((b) => b.kind === 'terminal').map((b) => {
    const pts = [];
    for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
    return centroid(pts);
  });
  const anchorPoints = [...bridges.map((b) => b[0]), ...bridges.map((b) => b[b.length - 1]), ...terminalPoints];
  const nearestAnchor = (x, z) => anchorPoints.reduce((best, p) => Math.min(best, Math.hypot(x - p[0], z - p[1])), Infinity);

  const stands = [];
  els.filter((e) => e.type === 'way' && e.tags?.aeroway === 'parking_position' && e.geometry).forEach((e) => {
    const pts = geomToXZ(e.geometry);
    let a = pts[0];
    let b = pts[pts.length - 1];
    if (nearestAnchor(...a) < nearestAnchor(...b)) [a, b] = [b, a];
    const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const apt = airportOf(...b);
    stands.push({ x: round1(b[0]), z: round1(b[1]), y: apt.y, heading: Math.round(heading * 1000) / 1000, airport: apt.id, ref: e.tags.ref || null });
  });
  els.filter((e) => e.type === 'node' && e.tags?.aeroway === 'parking_position').forEach((e) => {
    const [x, z] = project(e.lat, e.lon);
    if (stands.some((s) => Math.hypot(s.x - x, s.z - z) < 45)) return;
    // No lead-in line: face the nearest terminal.
    const target = terminalPoints.reduce((best, p) => (!best || Math.hypot(x - p[0], z - p[1]) < Math.hypot(x - best[0], z - best[1]) ? p : best), null);
    const heading = target ? Math.atan2(target[0] - x, target[1] - z) : 0;
    const apt = airportOf(x, z);
    stands.push({ x: round1(x), z: round1(z), y: apt.y, heading: Math.round(heading * 1000) / 1000, airport: apt.id, ref: e.tags.ref || null });
  });

  // Airports with no gates in the map data (e.g. Chennai): one gate per jet
  // bridge. The aircraft parks nose-in, square to the terminal wall nearest to
  // the bridge's outer end, with its front left door at the bridge.
  airports.forEach((apt) => {
    if (stands.some((st) => st.airport === apt.id)) return;
    const walls = [];
    airportBuildings.filter((b) => b.kind === 'terminal' && airportOf(b.p[0], b.p[1]) === apt).forEach((b) => {
      for (let i = 0; i + 3 < b.p.length; i += 2) walls.push([b.p[i], b.p[i + 1], b.p[i + 2], b.p[i + 3]]);
    });
    if (!walls.length) return;
    let n = 0;
    bridges.filter((br) => airportOf(...br[0]) === apt).forEach((br) => {
      // outer end = the end farther from any terminal wall
      const wallDistance = ([x, z]) => walls.reduce((best, [ax, az, bx, bz]) => {
        const dx = bx - ax; const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        const px = ax + t * dx; const pz = az + t * dz;
        const d = Math.hypot(x - px, z - pz);
        return d < best.d ? { d, px, pz } : best;
      }, { d: Infinity });
      const a = br[0]; const b = br[br.length - 1];
      const end = wallDistance(a).d > wallDistance(b).d ? a : b;
      const wall = wallDistance(end);
      if (wall.d > 120) return;
      const heading = Math.atan2(wall.px - end[0], wall.pz - end[1]); // nose towards the terminal
      // the door is on the aircraft's left: the centreline is ~2.5 m to its right
      const x = end[0] - Math.cos(heading) * 2.5;
      const z = end[1] + Math.sin(heading) * 2.5;
      if (stands.some((st) => Math.hypot(st.x - x, st.z - z) < 30)) return; // twin bridges at one gate
      n++;
      stands.push({ x: round1(x), z: round1(z), y: apt.y, heading: Math.round(heading * 1000) / 1000, airport: apt.id, ref: `B${n}` });
    });
    console.log(`  ${apt.id}: no gates in the map data, ${n} made from jet bridges`);
  });

  const towers = els.filter((e) => e.tags?.aeroway === 'tower').map((e) => {
    const [x, z] = e.type === 'node' ? project(e.lat, e.lon) : centroid(geomToXZ(e.geometry));
    return { x: round1(x), z: round1(z), airport: airportOf(x, z).id, h: parseHeight(e.tags, 0) };
  });
  const windsocks = els.filter((e) => e.type === 'node' && e.tags?.aeroway === 'windsock')
    .map((e) => { const [x, z] = project(e.lat, e.lon); return [round1(x), round1(z)]; });

  // ---- roads
  const roadClass = { motorway: 0, trunk: 1, primary: 2, secondary: 3 };
  const roads = roadsData.elements.filter((e) => e.geometry).map((e) => ({
    c: roadClass[e.tags.highway],
    b: e.tags.bridge && e.tags.bridge !== 'no' ? 1 : 0,
    p: geomToXZ(e.geometry).flatMap(([x, z]) => [Math.round(x), Math.round(z)]),
  }));

  // ---- city buildings -> binary
  const seenIds = new Set();
  let cityRows = [];
  buildingChunks.forEach((chunk) => chunk.elements.forEach((e) => {
    if (!e.bounds || seenIds.has(e.id)) return;
    seenIds.add(e.id);
    const [x0, z0] = project(e.bounds.maxlat, e.bounds.minlon);
    const [x1, z1] = project(e.bounds.minlat, e.bounds.maxlon);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    if (airports.some((a) => pointInPolygon(cx, cz, a.polygon))) return; // airport buildings are modelled separately
    const w = Math.min(250, Math.max(3, x1 - x0));
    const d = Math.min(250, Math.max(3, z1 - z0));
    const area = w * d;
    const r = hash01(e.id);
    const fallback = area > 4000 ? 10 + r * 6 : area > 800 ? 12 + r * 22 : 5 + r * 12;
    const h = Math.min(320, parseHeight(e.tags || {}, fallback));
    cityRows.push([Math.round(cx), Math.round(cz), Math.round(w * 10), Math.round(d * 10), Math.round(h * 10)]);
  }));
  // Very dense regions: keep the biggest buildings (footprint x height), which shape the skyline.
  if (cityRows.length > REGION.maxBuildings) {
    cityRows = cityRows.sort((a, b) => b[2] * b[3] * b[4] - a[2] * a[3] * a[4]).slice(0, REGION.maxBuildings);
  }
  const cityBuffer = new Int16Array(cityRows.length * 5);
  cityRows.forEach((row, i) => cityBuffer.set(row.map((v) => Math.max(-32768, Math.min(32767, v))), i * 5));
  fs.writeFileSync(path.join(OUT, `${id}-buildings.bin`), Buffer.from(cityBuffer.buffer));

  // ---- terrain -> binary (decimetres)
  const terrainBuffer = new Int16Array(grid.heights.length);
  grid.heights.forEach((h, i) => { terrainBuffer[i] = Math.max(-32768, Math.min(32767, Math.round(h * 10))); });
  fs.writeFileSync(path.join(OUT, `${id}-terrain.bin`), Buffer.from(terrainBuffer.buffer));

  const data = {
    attribution: 'Map data © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles (SRTM and others).',
    origin: ORIGIN,
    grid: { minX: round1(grid.minX), minZ: round1(grid.minZ), width: grid.width, height: grid.height, step: grid.step },
    region: id,
    airports: airports.map(({ polygon, way, rel, minElevation, ele, ...a }) => ({ ...a, polygon: flat(polygon) })),
    runways, taxiways, aprons, buildings: airportBuildings, stands, towers, windsocks,
    jetBridges: bridges.map((b) => flat(b)), roads,
    cityBuildingCount: cityRows.length,
  };
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(data));

  console.log('\nDone:');
  console.log(`  airports ${airports.map((a) => `${a.id}@${a.y}m`).join(', ')}`);
  runways.forEach((r) => console.log(`  runway ${r.airport} ${r.designators.join('/')} ${r.length} x ${r.width} m`));
  console.log(`  taxiways ${taxiways.length}, aprons ${aprons.length}, airport buildings ${airportBuildings.length}, stands ${stands.length}, jet bridges ${bridges.length}`);
  console.log(`  roads ${roads.length}, city buildings ${cityRows.length}, terrain grid ${grid.width} x ${grid.height}`);
  for (const f of [`${id}.json`, `${id}-terrain.bin`, `${id}-buildings.bin`]) {
    console.log(`  ${f}: ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KB`);
  }
}

async function main() {
  const ids = REGION_ID === 'all' ? Object.keys(REGIONS) : [REGION_ID];
  for (const id of ids) await buildRegion(id);
}

main().catch((err) => { console.error(err); process.exit(1); });
