// Converts the FlightGear airliner models (AC3D, GPL-2.0) into compact glTF
// binaries (.glb) for the browser, plus the data needed to repaint them.
//
//   node tools/convert-aircraft.mjs            (sources in tools/.cache/fg/<type>/)
//
// For each type it writes to assets/models/<type>/:
//   model.glb   geometry in SkyVision's frame (nose +Z, up +Y, left wing +X,
//               metres, origin on the ground under the main gear), merged per
//               material; landing-gear legs and engine fans as separate nodes
//   *.png       textures (downscaled to at most 2048 px)
//   paint-cat.png / paint-pos.png
//               for the livery texture: which part each texel belongs to
//               (body / tail / wing / engine ...) and where it is on the
//               aircraft (distance along, height). The runtime painter uses
//               these to paint liveries in "side view" and wrap them exactly
//               onto the model, whatever the UV layout.
//   layout.json anchors (wing tips, tail, cockpit eye, gear pivots, fans,
//               window rows) used for lights, cameras and animation
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { readAC } from './ac3d.mjs';

const SRC = 'tools/.cache/fg';
const OUT = 'assets/models';
const MAX_TEXTURE = 2048;

const GEAR = /gear|Gear|MLG|NLG|[Ww]heel|tyre|strut|\.arm\d|arm\d\.|scissor|SideStay|LockStay|Compressor|BaseRod|lgdoor|main\.door|nosegrdoor|gear_cover|\.hyd1|Cylinder\.0(00|02|12)|lhwgdoor|rhwgdoor|innerbgdoor|gearbay/;
const FAN = /^fan[._]|^fan2_|^FanLEAP[LR]$|^nosecone\.|^cone_eng/;

const MODELS = {
  a320: {
    sources: ['a320/A320-216.ac', 'a320/CFMLEAP1A.ac'],
    textureMap: { 'engine-leap1a.png': 'CFM-LEAP-white.png' },
    paintTextures: ['Fuse-Main.png', 'CFM-LEAP-white.png'],
    drop: /Placards|WingtipFence|^Rat$|RatSpinner|RatDoor[LR]\.Inner|NurbsPath|FanSpinning|ULD45/,
    glass: /^Windsheild$/,
  },
  a350: {
    sources: ['a350/A350-900.ac'],
    textureMap: {},
    paintTextures: ['a350xwb.png'],
    drop: /^wing\.text$|^fan2_eng/,
    glass: /^Windshield/,
    windows: /^cabin\.windows$/,
  },
  a380: {
    sources: ['a380/a380.ac', 'a380/trent900.ac'],
    textureMap: { 'Liveries/F-WWDD.png': 'blank.png' },
    paintTextures: ['blank.png'],
    drop: /^shadow$|^Box01$|^static_disc/,
    glass: /^windscreen$/,
  },
};

// ---- paint categories (per triangle) -------------------------------------
const CAT = { none: 0, body: 1, tail: 2, wing: 3, stab: 4, winglet: 5, engine: 6, gear: 7, other: 8 };

function paintCategory(name, centroid, dims) {
  if (/Inner/.test(name)) return CAT.other;
  if (/^Pylon|^pylon/.test(name)) return CAT.wing;
  if (/Engine|Nacelle|eng\.reverser|fancowl|^cowl\d|^reverse$/.test(name)) return CAT.engine;
  if (/Intake|Exhaust|intake|bypass|Nozzle|cascade|rim/.test(name)) return CAT.other;
  if (/Sharklet|winglet|navglass\.sharklet/.test(name)) return CAT.winglet;
  if (/vstab|Rudder|rudder/.test(name)) return CAT.tail;
  if (/Hstab|hstab|stabilizer|Elevator|elevator|^elev\d|^tips$/.test(name)) return CAT.stab;
  if (/[Ww]ing|Slat|slat|Flap|flap|Aileron|aileron|Spoiler|spoiler|^sb\d|Fairing[LR]\d|leading|trailing|slot|^tip[LR]|FTF|LightWing/.test(name)) return CAT.wing;
  if (GEAR.test(name)) return CAT.body;
  // The fin is often part of the fuselage mesh: anything clearly above the cabin roof in the rear half.
  if (centroid[1] > dims.cabinTop + 0.25 && centroid[2] < -dims.length * 0.2 && Math.abs(centroid[0]) < 1.6) return CAT.tail;
  return CAT.body;
}

// ---- helpers ------------------------------------------------------------------
function readPNG(file) { return PNG.sync.read(fs.readFileSync(file)); }

function downscale(png, max) {
  let { width, height, data } = png;
  while (width > max || height > max) {
    const w = width >> 1; const h = height >> 1;
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      const i = (a, b) => ((y * 2 + b) * width + (x * 2 + a)) * 4 + c;
      out[(y * w + x) * 4 + c] = (data[i(0, 0)] + data[i(1, 0)] + data[i(0, 1)] + data[i(1, 1)] + 2) >> 2;
    }
    width = w; height = h; data = out;
  }
  const p = new PNG({ width, height });
  data.copy(p.data);
  return p;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Vertex normals: smooth surfaces average the face normals of all faces sharing a
// position (within a crease angle), flat surfaces use the face normal.
function computeNormals(positions, smooth, creaseDeg = 55) {
  const n = positions.length / 9;
  const faceN = [];
  for (let t = 0; t < n; t++) {
    const p = (k) => [positions[t * 9 + k * 3], positions[t * 9 + k * 3 + 1], positions[t * 9 + k * 3 + 2]];
    const c = cross(sub(p(1), p(0)), sub(p(2), p(0)));
    faceN.push(c); // area-weighted
  }
  const normals = new Float32Array(n * 9);
  if (!smooth) {
    for (let t = 0; t < n; t++) { const f = norm(faceN[t]); for (let k = 0; k < 3; k++) normals.set(f, t * 9 + k * 3); }
    return normals;
  }
  const key = (i) => `${Math.round(positions[i] * 1000)},${Math.round(positions[i + 1] * 1000)},${Math.round(positions[i + 2] * 1000)}`;
  const groups = new Map();
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const kk = key(t * 9 + k * 3);
    if (!groups.has(kk)) groups.set(kk, []);
    groups.get(kk).push(t);
  }
  const cosC = Math.cos((creaseDeg * Math.PI) / 180);
  for (let t = 0; t < n; t++) {
    const ft = norm(faceN[t]);
    for (let k = 0; k < 3; k++) {
      const faces = groups.get(key(t * 9 + k * 3));
      let s = [0, 0, 0];
      faces.forEach((f) => {
        const nf = norm(faceN[f]);
        if (nf[0] * ft[0] + nf[1] * ft[1] + nf[2] * ft[2] >= cosC) s = [s[0] + faceN[f][0], s[1] + faceN[f][1], s[2] + faceN[f][2]];
      });
      normals.set(len(s) > 0 ? norm(s) : ft, t * 9 + k * 3);
    }
  }
  return normals;
}

// ---- GLB writer -------------------------------------------------------------------
function writeGLB(file, { nodes, meshes, materials, textures }) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [];
  const accessors = [];
  const addView = (typed, target) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf);
    byteLength += buf.length;
    return bufferViews.length - 1;
  };
  const addAccessor = (typed, type, componentType, count, extra = {}) => {
    const view = addView(typed, componentType === 5125 ? 34963 : 34962);
    accessors.push({ bufferView: view, componentType, count, type, ...extra });
    return accessors.length - 1;
  };
  const gltfMeshes = meshes.map((m) => ({
    name: m.name,
    primitives: m.primitives.map((p) => {
      const count = p.positions.length / 3;
      const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.positions.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p.positions[i + a]); max[a] = Math.max(max[a], p.positions[i + a]); }
      return {
        attributes: {
          POSITION: addAccessor(p.positions, 'VEC3', 5126, count, { min, max }),
          NORMAL: addAccessor(p.normals, 'VEC3', 5126, count),
          TEXCOORD_0: addAccessor(p.uvs, 'VEC2', 5126, count),
        },
        indices: addAccessor(p.indices, 'SCALAR', 5125, p.indices.length),
        material: p.material,
      };
    }),
  }));
  const json = {
    asset: { version: '2.0', generator: 'SkyVision convert-aircraft.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: gltfMeshes,
    materials,
    textures: textures.map((t, i) => ({ source: i, sampler: 0 })),
    images: textures.map((t) => ({ uri: t })),
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  if (!textures.length) { delete json.textures; delete json.images; delete json.samplers; }
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  let bin = Buffer.concat(chunks);
  bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jh, jsonBuf, bh, bin]));
}

// ---- conversion -------------------------------------------------------------------
function convert(type) {
  const cfg = MODELS[type];
  const outDir = path.join(OUT, type);
  fs.mkdirSync(outDir, { recursive: true });
  let materialsAC = [];
  let meshes = [];
  const seen = new Set();
  cfg.sources.forEach((src) => {
    const { materials, meshes: ms } = readAC(fs.readFileSync(path.join(SRC, src), 'utf8'));
    const base = materialsAC.length;
    materialsAC = materialsAC.concat(materials);
    ms.forEach((m) => {
      if (cfg.drop.test(m.name)) return;
      const sig = `${m.name}|${m.positions.length}|${m.positions.slice(0, 3).map((v) => v.toFixed(3))}`;
      if (seen.has(sig)) return; // some files contain every part twice
      seen.add(sig);
      m.materials = m.materials.map((i) => i + base);
      if (m.texture && cfg.textureMap[m.texture]) m.texture = cfg.textureMap[m.texture];
      if (m.texture) m.texture = path.basename(m.texture);
      meshes.push(m);
    });
  });

  // FlightGear frame (x aft, y up, z right-wing... here z = left) -> ours: (x, y, z) = (acZ, acY - ground, -(acX - gearX))
  const wheels = meshes.filter((m) => /[Ww]heel|tyres/.test(m.name));
  let ground = Infinity; let nose = Infinity;
  wheels.forEach((m) => { for (let i = 0; i < m.positions.length; i += 3) { ground = Math.min(ground, m.positions[i + 1]); } });
  meshes.forEach((m) => { for (let i = 0; i < m.positions.length; i += 3) nose = Math.min(nose, m.positions[i]); });
  // Main gear = wheels well aft of the nose; its fore-aft centre is the origin.
  let gMin = Infinity; let gMax = -Infinity;
  wheels.forEach((m) => {
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i];
      if (x - nose > 0.35 * 70 * 0 + 20 || x - nose > 15) { gMin = Math.min(gMin, x); gMax = Math.max(gMax, x); }
    }
  });
  const gearX = (gMin + gMax) / 2;
  const toOurs = (p, i) => [p[i + 2], p[i + 1] - ground, -(p[i] - gearX)];
  meshes.forEach((m) => {
    const p = m.positions;
    const out = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) out.set(toOurs(p, i), i);
    m.positions = out;
  });

  // Overall dimensions.
  const all = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  meshes.forEach((m) => { for (let i = 0; i < m.positions.length; i += 3) for (let a = 0; a < 3; a++) { all.min[a] = Math.min(all.min[a], m.positions[i + a]); all.max[a] = Math.max(all.max[a], m.positions[i + a]); } });
  const length = all.max[2] - all.min[2];
  // Cabin roof height: highest fuselage vertex near the middle of the aircraft.
  let cabinTop = 0; let cabinBottom = Infinity; let cabinHalfWidth = 0;
  meshes.filter((m) => /^[Ff]uselage/.test(m.name)).forEach((m) => {
    for (let i = 0; i < m.positions.length; i += 3) {
      const [x, y, z] = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
      if (z > all.min[2] + length * 0.35 && z < all.max[2] - length * 0.2) { // cabin: clear of the fin and the nose
        cabinTop = Math.max(cabinTop, y); cabinBottom = Math.min(cabinBottom, y); cabinHalfWidth = Math.max(cabinHalfWidth, Math.abs(x));
      }
    }
  });
  const dims = { length, cabinTop, cabinBottom, cabinHalfWidth, min: all.min, max: all.max };

  // Node assignment: gear legs (nose / left / right), engine fans, body.
  const groupOf = (m) => {
    if (FAN.test(m.name)) return 'fan';
    if (GEAR.test(m.name)) {
      let cx = 0; let cz = 0; const n = m.positions.length / 3;
      for (let i = 0; i < m.positions.length; i += 3) { cx += m.positions[i]; cz += m.positions[i + 2]; }
      cx /= n; cz /= n;
      if (cz > length * 0.2) return 'gear_nose';
      if (/gearbay|innerbgdoor/.test(m.name)) return 'body';
      return cx > 0 ? 'gear_left' : 'gear_right';
    }
    return 'body';
  };

  // Fans: cluster by position into engines.
  const fanClusters = [];
  meshes.filter((m) => groupOf(m) === 'fan').forEach((m) => {
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < m.positions.length; i += 3) for (let a = 0; a < 3; a++) { b.min[a] = Math.min(b.min[a], m.positions[i + a]); b.max[a] = Math.max(b.max[a], m.positions[i + a]); }
    const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    let cl = fanClusters.find((k) => Math.hypot(k.centre[0] - c[0], k.centre[1] - c[1]) < 1.5);
    if (!cl) { cl = { centre: c, meshes: [], radius: 0 }; fanClusters.push(cl); }
    cl.radius = Math.max(cl.radius, (b.max[1] - b.min[1]) / 2);
    if (/^fan|^Fan/.test(m.name)) cl.centre = [c[0], c[1], cl.centre[2]];
    cl.meshes.push(m);
    m.fan = cl;
  });
  fanClusters.forEach((cl, i) => { cl.name = `fan_${i}`; });

  // Materials: one glTF material per (AC material, texture, two-sided, glass).
  const gltfMaterials = [];
  const materialKey = new Map();
  const textures = [];
  const materialFor = (acIndex, texture, twoSided, glass) => {
    const key = `${acIndex}|${texture}|${twoSided}|${glass}`;
    if (materialKey.has(key)) return materialKey.get(key);
    const ac = materialsAC[acIndex] || { rgb: [1, 1, 1], trans: 0, shi: 32, name: '' };
    const rgb = ac.rgb || [1, 1, 1];
    const m = { name: `${ac.name}${texture ? `:${texture}` : ''}`, pbrMetallicRoughness: {}, extras: {} };
    const lightGlass = /glass\.(red|green|white)/.test(ac.name);
    if (glass === 'windows') {
      m.pbrMetallicRoughness = { baseColorFactor: [0.05, 0.07, 0.09, 1], metallicFactor: 0.3, roughnessFactor: 0.15 };
      m.extras.kind = 'windows';
    } else if (glass || (/glass/.test(ac.name) && !lightGlass)) {
      m.pbrMetallicRoughness = { baseColorFactor: [0.03, 0.05, 0.07, 0.92], metallicFactor: 0.2, roughnessFactor: 0.05 };
      m.alphaMode = 'BLEND';
      m.extras.kind = 'glass';
    } else if (lightGlass) {
      m.pbrMetallicRoughness = { baseColorFactor: [rgb[0], rgb[1], rgb[2], 0.45], metallicFactor: 0, roughnessFactor: 0.1 };
      m.alphaMode = 'BLEND';
      m.extras.kind = 'lightglass';
    } else {
      const alpha = ac.trans > 0 ? Math.max(0.15, 1 - ac.trans) : 1;
      m.pbrMetallicRoughness = {
        baseColorFactor: [rgb[0], rgb[1], rgb[2], alpha],
        metallicFactor: /chrome|metal/i.test(ac.name) ? 0.8 : 0.15,
        roughnessFactor: Math.max(0.25, 1 - Math.min(ac.shi || 0, 128) / 150),
      };
      if (alpha < 1) m.alphaMode = 'BLEND';
      if (texture) {
        let ti = textures.indexOf(texture);
        if (ti < 0) { textures.push(texture); ti = textures.length - 1; }
        m.pbrMetallicRoughness.baseColorTexture = { index: ti };
        m.extras.texture = texture;
        if (cfg.paintTextures.includes(texture)) m.extras.paint = true;
      }
    }
    if (twoSided) m.doubleSided = true;
    gltfMaterials.push(m);
    materialKey.set(key, gltfMaterials.length - 1);
    return gltfMaterials.length - 1;
  };

  // Build primitives: per node, per material; vertices de-duplicated.
  const nodeGroups = new Map(); // name -> Map(material -> {pos, nrm, uv})
  const paintTris = new Map();  // texture -> [{uv:[6], pos:[9], cat, side}]
  meshes.forEach((m) => {
    const node = m.fan ? m.fan.name : groupOf(m);
    const normals = computeNormals(m.positions, m.smooth);
    const glass = cfg.glass.test(m.name) ? 'glass' : (cfg.windows && cfg.windows.test(m.name) ? 'windows' : false);
    const nTris = m.positions.length / 9;
    for (let t = 0; t < nTris; t++) {
      const mat = materialFor(m.materials[t], m.texture, m.twoSided, glass);
      if (!nodeGroups.has(node)) nodeGroups.set(node, new Map());
      const g = nodeGroups.get(node);
      if (!g.has(mat)) g.set(mat, { pos: [], nrm: [], uv: [] });
      const b = g.get(mat);
      for (let k = 0; k < 3; k++) {
        const i = t * 9 + k * 3;
        b.pos.push(m.positions[i], m.positions[i + 1], m.positions[i + 2]);
        b.nrm.push(normals[i], normals[i + 1], normals[i + 2]);
        b.uv.push(m.uvs[(t * 3 + k) * 2], 1 - m.uvs[(t * 3 + k) * 2 + 1]);
      }
      if (m.texture && cfg.paintTextures.includes(m.texture)) {
        const P = m.positions.slice(t * 9, t * 9 + 9);
        const c = [(P[0] + P[3] + P[6]) / 3, (P[1] + P[4] + P[7]) / 3, (P[2] + P[5] + P[8]) / 3];
        if (!paintTris.has(m.texture)) paintTris.set(m.texture, []);
        paintTris.get(m.texture).push({
          uv: m.uvs.slice(t * 6, t * 6 + 6), pos: Array.from(P),
          cat: paintCategory(m.name, c, dims), side: c[0] >= 0 ? 0 : 1,
        });
      }
    }
  });

  // Node hierarchy: root -> body, gear groups (pivot at their top), fans (pivot at the hub).
  const gltfMeshes = [];
  const nodes = [{ name: `${type}`, children: [] }];
  const gearInfo = {};
  nodeGroups.forEach((mats, name) => {
    // bbox of this node
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    mats.forEach((v) => { for (let i = 0; i < v.pos.length; i += 3) for (let a = 0; a < 3; a++) { b.min[a] = Math.min(b.min[a], v.pos[i + a]); b.max[a] = Math.max(b.max[a], v.pos[i + a]); } });
    let pivot = [0, 0, 0];
    if (name.startsWith('gear_')) {
      pivot = [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2];
      gearInfo[name] = { pivot, min: b.min, max: b.max };
    } else if (name.startsWith('fan_')) {
      const cl = fanClusters.find((c) => c.name === name);
      pivot = [cl.centre[0], cl.centre[1], (b.min[2] + b.max[2]) / 2];
    }
    const primitives = [];
    mats.forEach((v, material) => {
      // de-duplicate vertices
      const map = new Map(); const pos = []; const nrm = []; const uv = []; const idx = [];
      for (let i = 0; i < v.pos.length / 3; i++) {
        const key = `${v.pos[i * 3].toFixed(4)},${v.pos[i * 3 + 1].toFixed(4)},${v.pos[i * 3 + 2].toFixed(4)},${v.nrm[i * 3].toFixed(3)},${v.nrm[i * 3 + 1].toFixed(3)},${v.nrm[i * 3 + 2].toFixed(3)},${v.uv[i * 2].toFixed(5)},${v.uv[i * 2 + 1].toFixed(5)}`;
        let id = map.get(key);
        if (id === undefined) {
          id = pos.length / 3; map.set(key, id);
          pos.push(v.pos[i * 3] - pivot[0], v.pos[i * 3 + 1] - pivot[1], v.pos[i * 3 + 2] - pivot[2]);
          nrm.push(v.nrm[i * 3], v.nrm[i * 3 + 1], v.nrm[i * 3 + 2]);
          uv.push(v.uv[i * 2], v.uv[i * 2 + 1]);
        }
        idx.push(id);
      }
      primitives.push({ positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uv), indices: new Uint32Array(idx), material });
    });
    gltfMeshes.push({ name, primitives });
    nodes.push({ name, mesh: gltfMeshes.length - 1, translation: pivot });
    nodes[0].children.push(nodes.length - 1);
  });

  // Textures: copy (downscaled) into the output folder.
  const texDirs = cfg.sources.map((s) => path.join(SRC, path.dirname(s)));
  const findTex = (t) => texDirs.map((d) => path.join(d, t)).find((f) => fs.existsSync(f));
  const texSizes = {};
  textures.forEach((t) => {
    const f = findTex(t);
    if (!f) { console.warn(`  missing texture ${t}`); return; }
    const png = downscale(readPNG(f), MAX_TEXTURE);
    texSizes[t] = [png.width, png.height];
    fs.writeFileSync(path.join(outDir, t), PNG.sync.write(png));
  });

  writeGLB(path.join(outDir, 'model.glb'), { nodes, meshes: gltfMeshes, materials: gltfMaterials, textures });

  // Paint maps for the livery textures.
  const paint = {};
  paintTris.forEach((tris, tex) => {
    if (!texSizes[tex]) return;
    const [W, H] = texSizes[tex];
    const cat = new Uint8Array(W * H);
    const posMap = new Float32Array(W * H * 3);
    tris.forEach(({ uv, pos, cat: c, side }) => {
      const px = [0, 1, 2].map((k) => [(((uv[k * 2] % 1) + 1) % 1) * W, (1 - (((uv[k * 2 + 1] % 1) + 1) % 1)) * H]);
      // Keep triangles whose UVs don't wrap across the texture edge.
      const xs = px.map((p) => p[0]); const ys = px.map((p) => p[1]);
      if (Math.max(...xs) - Math.min(...xs) > W * 0.5 || Math.max(...ys) - Math.min(...ys) > H * 0.5) return;
      const minX = Math.max(0, Math.floor(Math.min(...xs))); const maxX = Math.min(W - 1, Math.ceil(Math.max(...xs)));
      const minY = Math.max(0, Math.floor(Math.min(...ys))); const maxY = Math.min(H - 1, Math.ceil(Math.max(...ys)));
      const [a, b2, c2] = px;
      const det = (b2[0] - a[0]) * (c2[1] - a[1]) - (c2[0] - a[0]) * (b2[1] - a[1]);
      if (Math.abs(det) < 1e-9) return;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const qx = x + 0.5; const qy = y + 0.5;
        const w1 = ((qx - a[0]) * (c2[1] - a[1]) - (c2[0] - a[0]) * (qy - a[1])) / det;
        const w2 = ((b2[0] - a[0]) * (qy - a[1]) - (qx - a[0]) * (b2[1] - a[1])) / det;
        const w0 = 1 - w1 - w2;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const i = y * W + x;
        cat[i] = c * 2 + side + 0; // even = left, odd = right; 0 = empty
        if (cat[i] === 0) cat[i] = 1;
        for (let k = 0; k < 3; k++) posMap[i * 3 + k] = w0 * pos[k] + w1 * pos[3 + k] + w2 * pos[6 + k];
      }
    });
    // Dilate 3 px so texture filtering at island edges finds painted texels.
    for (let pass = 0; pass < 3; pass++) {
      const src = cat.slice();
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (src[i]) continue;
        for (const d of [-1, 1, -W, W]) if (src[i + d]) { cat[i] = src[i + d]; posMap.copyWithin(i * 3, (i + d) * 3, (i + d) * 3 + 3); break; }
      }
    }
    const catPng = new PNG({ width: W, height: H });
    const posPng = new PNG({ width: W, height: H });
    const zMin = all.min[2]; const zRange = length; const yMax = all.max[1];
    for (let i = 0; i < W * H; i++) {
      catPng.data[i * 4] = cat[i]; catPng.data[i * 4 + 1] = cat[i]; catPng.data[i * 4 + 2] = cat[i]; catPng.data[i * 4 + 3] = 255;
      const s = Math.max(0, Math.min(4095, Math.round(((posMap[i * 3 + 2] - zMin) / zRange) * 4095)));
      const h = Math.max(0, Math.min(4095, Math.round((posMap[i * 3 + 1] / yMax) * 4095)));
      posPng.data[i * 4] = s >> 4; posPng.data[i * 4 + 1] = ((s & 15) << 4) | (h >> 8); posPng.data[i * 4 + 2] = h & 255; posPng.data[i * 4 + 3] = 255;
    }
    const baseName = tex.replace(/\.png$/i, '');
    fs.writeFileSync(path.join(outDir, `${baseName}.cat.png`), PNG.sync.write(catPng));
    fs.writeFileSync(path.join(outDir, `${baseName}.pos.png`), PNG.sync.write(posPng));
    paint[tex] = { cat: `${baseName}.cat.png`, pos: `${baseName}.pos.png`, size: [W, H] };
  });

  // Anchors for lights and cameras.
  const wingVerts = meshes.filter((m) => paintCategory(m.name, [0, 0, 0], dims) === CAT.wing && !GEAR.test(m.name));
  let tip = [0, 0, 0];
  wingVerts.forEach((m) => { for (let i = 0; i < m.positions.length; i += 3) if (m.positions[i] > tip[0]) tip = [m.positions[i], m.positions[i + 1], m.positions[i + 2]]; });
  let tail = [0, 0, Infinity];
  meshes.filter((m) => /^[Ff]uselage/.test(m.name)).forEach((m) => { for (let i = 0; i < m.positions.length; i += 3) if (m.positions[i + 2] < tail[2] && Math.abs(m.positions[i]) < 0.5) tail = [0, m.positions[i + 1], m.positions[i + 2]]; });
  const glassMesh = meshes.filter((m) => cfg.glass.test(m.name));
  let eye = [0.5, cabinTop - 1.2, all.max[2] - 3];
  if (glassMesh.length) {
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    glassMesh.forEach((m) => { for (let i = 0; i < m.positions.length; i += 3) for (let a = 0; a < 3; a++) { b.min[a] = Math.min(b.min[a], m.positions[i + a]); b.max[a] = Math.max(b.max[a], m.positions[i + a]); } });
    // Captain's eye: left seat, a little below the top of the windscreen, level
    // with the rear third of the cockpit windows.
    eye = [0.5, b.max[1] - 0.32, b.min[2] + (b.max[2] - b.min[2]) * 0.3];
  }

  // Window rows from a separate window mesh, if the model has one (A350).
  let windowRows = null;
  if (cfg.windows) {
    // the most common vertex height of the window mesh = the row of cabin windows
    const ys = [];
    meshes.filter((m) => cfg.windows.test(m.name)).forEach((m) => { for (let i = 0; i < m.positions.length; i += 3) ys.push(m.positions[i + 1]); });
    if (ys.length) {
      ys.sort((p, q) => p - q);
      const mid = ys[Math.floor(ys.length / 2)];
      windowRows = [{ y: mid, half: 0.26 }];
    }
  }

  const layout = {
    windowRows,
    type,
    source: cfg.sources,
    dims: { length, span: all.max[0] - all.min[0], height: all.max[1], min: all.min, max: all.max, cabinTop, cabinBottom, cabinHalfWidth },
    posEncoding: { zMin: all.min[2], zRange: length, yMax: all.max[1] },
    anchors: {
      wingTip: tip, tail, eye,
      beaconTop: [0, cabinTop + 0.1, 0], beaconBottom: [0, cabinBottom - 0.1, -2],
      noseGear: gearInfo.gear_nose ? gearInfo.gear_nose.pivot : [0, 1, length * 0.35],
    },
    gear: gearInfo,
    fans: fanClusters.map((c) => ({ name: c.name, centre: c.centre, radius: c.radius })),
    paint,
  };
  fs.writeFileSync(path.join(outDir, 'layout.json'), JSON.stringify(layout, null, 1));
  const tris = [...nodeGroups.values()].reduce((s, mats) => s + [...mats.values()].reduce((a, v) => a + v.pos.length / 9, 0), 0);
  console.log(`${type}: ${meshes.length} parts, ${tris} triangles, ${gltfMaterials.length} materials, nodes ${[...nodeGroups.keys()].join(' ')}`);
  console.log(`  length ${length.toFixed(2)} span ${(all.max[0] - all.min[0]).toFixed(2)} height ${all.max[1].toFixed(2)} cabin ${cabinBottom.toFixed(2)}..${cabinTop.toFixed(2)} ±${cabinHalfWidth.toFixed(2)} glb ${(fs.statSync(path.join(outDir, 'model.glb')).size / 1e6).toFixed(2)} MB`);
}

const only = process.argv[2];
Object.keys(MODELS).filter((t) => !only || t === only).forEach(convert);
