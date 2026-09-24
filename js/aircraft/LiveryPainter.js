import * as THREE from 'three';
import { LIVERIES } from './Liveries.js';

// Repaints the real aircraft models (converted from FlightGear) in our airline
// colours. The converter baked two helper images for every paintable texture:
//
//   *.cat.png  which part of the aircraft each texel belongs to
//              (value = category * 2 + side; 0 = unused texel)
//   *.pos.png  where that texel is on the aircraft: distance along the
//              fuselage and height above the ground (12 bits each)
//
// A livery is drawn once in "side view" (a 2D canvas in metres, one per side,
// so titles read correctly on both sides). For every texel we look up its 3D
// position, sample the side-view picture there and multiply by the shading
// detail of the original texture (panel lines, doors, windows). This wraps the
// livery exactly onto the model, whatever its UV layout - projection texturing
// done once on the CPU.
export const CAT = { body: 1, tail: 2, wing: 3, stab: 4, winglet: 5, engine: 6, gear: 7, other: 8 };
const PPM = 24; // side-view canvas resolution: pixels per metre

const images = new Map();
function loadImage(url) {
  if (!images.has(url)) {
    images.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${url}`));
      img.src = url;
    }));
  }
  return images.get(url);
}

function pixelsOf(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

const rgbOf = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const cssOf = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

// Rows of passenger windows: heights where dark, colourless texels cluster in the cabin.
function findWindowRows(B, C, decode, layout, dark) {
  const { zMin, zRange } = layout.posEncoding;
  const bins = new Float32Array(400); // 5 cm bins
  const z0 = zMin + zRange * 0.3;
  const z1 = zMin + zRange * 0.75;
  // Windows are in the cabin wall: between ~35% and ~92% of the fuselage height.
  const { cabinTop, cabinBottom } = layout.dims;
  const y0 = cabinBottom + (cabinTop - cabinBottom) * 0.35;
  const y1 = cabinTop - (cabinTop - cabinBottom) * 0.08;
  for (let i = 0; i < C.length; i += 4 * 3) {
    if ((C[i] >> 1) !== CAT.body) continue;
    const r = B[i]; const g = B[i + 1]; const b = B[i + 2];
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    if (max > dark || max - min > 30) continue;
    const [z, y] = decode(i);
    if (z < z0 || z > z1 || y < y0 || y > y1) continue;
    bins[Math.min(399, Math.floor(y / 0.05))] += 1;
  }
  const peak = Math.max(...bins);
  if (peak < 60) return [];
  const rows = [];
  for (let k = 0; k < bins.length; k++) {
    if (bins[k] < peak * 0.12) continue;
    let sum = 0; let w = 0; const start = k;
    while (k < bins.length && bins[k] >= peak * 0.06) { sum += bins[k] * (k + 0.5) * 0.05; w += bins[k]; k++; }
    const row = { y: sum / w, lo: start * 0.05, hi: k * 0.05, w };
    const prev = rows[rows.length - 1];
    if (prev && row.lo - prev.hi < 0.5) { // one row split by a gap: merge
      prev.y = (prev.y * prev.w + row.y * row.w) / (prev.w + row.w); prev.hi = row.hi; prev.w += row.w;
    } else rows.push(row);
  }
  return rows.sort((p, q) => q.w - p.w).slice(0, 2)
    .map((r) => ({ y: r.y, half: Math.min(0.35, Math.max(0.14, (r.hi - r.lo) / 2)) }));
}

// Side-view picture of the livery, in metres. side 0 = left (+X), nose on the
// viewer's left; side 1 = right, nose on the viewer's right.
function drawSide(layout, livery, rows, side) {
  const { zMin, zRange, yMax } = layout.posEncoding;
  const zMax = zMin + zRange;
  const W = Math.ceil(zRange * PPM);
  const H = Math.ceil(yMax * PPM);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const X = (z) => (side === 0 ? (zMax - z) : (z - zMin)) * PPM;
  const Y = (y) => (yMax - y) * PPM;
  const { cabinTop, cabinBottom } = layout.dims;
  const hc = cabinTop - cabinBottom;
  const upper = rows.length ? rows.reduce((a, b) => (a.y > b.y ? a : b)) : { y: cabinBottom + hc * 0.6, half: 0.2 };
  const lower = rows.length ? rows.reduce((a, b) => (a.y < b.y ? a : b)) : upper;

  ctx.fillStyle = cssOf(livery.body);
  ctx.fillRect(0, 0, W, H);

  if (livery.belly) { // painted underside, sweeping up gently at the nose and tail
    const top = lower.y - lower.half - hc * 0.16;
    ctx.fillStyle = cssOf(livery.belly);
    ctx.beginPath();
    ctx.moveTo(X(zMax), Y(top - hc * 0.18));
    ctx.quadraticCurveTo(X(zMax - zRange * 0.12), Y(top), X(zMax - zRange * 0.2), Y(top));
    ctx.lineTo(X(zMin + zRange * 0.25), Y(top));
    ctx.quadraticCurveTo(X(zMin + zRange * 0.08), Y(top), X(zMin), Y(top + hc * 0.35));
    ctx.lineTo(X(zMin), Y(0));
    ctx.lineTo(X(zMax), Y(0));
    ctx.closePath();
    ctx.fill();
  }
  if (livery.cheat) { // cheatline under the windows, rising towards the tail
    const y = lower.y - lower.half - hc * 0.07;
    const t = Math.max(0.12, hc * 0.035);
    ctx.fillStyle = cssOf(livery.cheat);
    ctx.beginPath();
    ctx.moveTo(X(zMax - zRange * 0.1), Y(y + t));
    ctx.lineTo(X(zMin + zRange * 0.3), Y(y + t));
    ctx.quadraticCurveTo(X(zMin + zRange * 0.16), Y(y + t), X(zMin + zRange * 0.06), Y(y + hc * 0.45));
    ctx.lineTo(X(zMin + zRange * 0.06), Y(y + hc * 0.45 - t * 2));
    ctx.quadraticCurveTo(X(zMin + zRange * 0.17), Y(y - t), X(zMin + zRange * 0.3), Y(y - t));
    ctx.lineTo(X(zMax - zRange * 0.1), Y(y - t));
    ctx.closePath();
    ctx.fill();
  }
  if (livery.title) { // airline name above the (upper-deck) windows, towards the front
    const room = cabinTop - (upper.y + upper.half) - 0.15;
    const size = Math.max(0.5, Math.min(hc * 0.2, 1.3, room * 0.85)) * PPM;
    ctx.font = `${livery.titleFont} ${size}px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = livery.titleColor;
    ctx.textBaseline = 'middle';
    const y = Y(Math.min(upper.y + upper.half + size / PPM * 0.75, cabinTop - size / PPM * 0.6));
    const anchor = X(zMax - zRange * 0.2);
    ctx.textAlign = side === 0 ? 'left' : 'right';
    ctx.fillText(livery.title, anchor, y, zRange * 0.42 * PPM);
  }
  return ctx.getImageData(0, 0, W, H);
}

// Tail accent: a diagonal stripe or a field of dots, as a function of the
// position on the fin (true = accent colour here).
function tailAccentAt(kind, z, y, zMin, zRange, yMax) {
  const u = (z - zMin) / zRange; // 0 at the tail end
  const v = y / yMax;
  if (kind === 'stripe') {
    const d = (v - 0.55) + (u - 0.1) * 1.4;
    return d > 0 && d < 0.07;
  }
  if (kind === 'dots') {
    const s = 0.9; // metres between dots
    const gz = z / s; const gy = y / s;
    const iz = Math.round(gz); const iy = Math.round(gy);
    const fz = gz - iz; const fy = gy - iy;
    const size = 0.12 + 0.2 * Math.max(0, Math.min(1, (v - 0.45) * 3));
    return fz * fz + fy * fy < size * size && ((((iz + iy) % 3) + 3) % 3) !== 0;
  }
  return false;
}

const painted = new Map();

// Returns { map, emissiveMap } CanvasTextures for one texture of one type in one livery.
export function paintTexture(baseUrl, layout, textureName, liveryKey) {
  const key = `${baseUrl}|${textureName}|${liveryKey}`;
  if (!painted.has(key)) painted.set(key, doPaint(baseUrl, layout, textureName, liveryKey));
  return painted.get(key);
}

async function doPaint(baseUrl, layout, textureName, liveryKey) {
  const livery = LIVERIES[liveryKey] || LIVERIES.skyvision;
  const info = layout.paint[textureName];
  const [baseImg, catImg, posImg] = await Promise.all([
    loadImage(`${baseUrl}/${textureName}`), loadImage(`${baseUrl}/${info.cat}`), loadImage(`${baseUrl}/${info.pos}`),
  ]);
  const W = baseImg.naturalWidth;
  const H = baseImg.naturalHeight;
  const B = pixelsOf(baseImg);
  const C = pixelsOf(catImg);
  const P = pixelsOf(posImg);
  const { zMin, zRange, yMax } = layout.posEncoding;
  const zMax = zMin + zRange;
  const decode = (i) => {
    const s = (P[i] << 4) | (P[i + 1] >> 4);
    const h = ((P[i + 1] & 15) << 8) | P[i + 2];
    return [zMin + (s / 4095) * zRange, (h / 4095) * yMax];
  };


  // Reference brightness of the original paint (bright, colourless texels of the body).
  let ref = 235;
  {
    const lums = [];
    for (let i = 0; i < C.length; i += 4 * 17) {
      if ((C[i] >> 1) !== CAT.body) continue;
      const max = Math.max(B[i], B[i + 1], B[i + 2]); const min = Math.min(B[i], B[i + 1], B[i + 2]);
      if (max - min < 25 && max > 120) lums.push(max);
    }
    if (lums.length > 50) { lums.sort((a, b) => a - b); ref = lums[Math.floor(lums.length * 0.8)]; }
  }

  const dark = Math.min(125, ref * 0.5); // "dark" = window glass / black marks
  const rows = layout.windowRows || findWindowRows(B, C, decode, layout, dark);
  const sides = [drawSide(layout, livery, rows, 0), drawSide(layout, livery, rows, 1)];
  const sideW = sides[0].width;
  const sideH = sides[0].height;

  // Per-texel pass. Written without temporary arrays: ~4 million texels per texture.
  const [eR, eG, eB] = rgbOf(livery.engine);
  const [tR, tG, tB] = rgbOf(livery.tail);
  const accent = livery.tailAccent;
  const [aR, aG, aB] = accent ? rgbOf(accent.color) : [0, 0, 0];
  const out = new Uint8ClampedArray(B.length);
  const emis = new Uint8ClampedArray(B.length);
  const cockpitZone = zMax - zRange * 0.14;
  const radomeZone = zMax - Math.max(1.2, zRange * 0.03);
  const cabinStart = zMin + zRange * 0.08;
  const rowY = rows.map((r) => r.y);
  const rowHalf = rows.map((r) => r.half + 0.05);
  const zScale = zRange / 4095;
  const yScale = yMax / 4095;
  const left = sides[0].data;
  const right = sides[1].data;
  let lit = 0;

  for (let i = 0; i < B.length; i += 4) {
    out[i + 3] = B[i + 3];
    emis[i + 3] = 255;
    const c = C[i];
    const r = B[i]; const g = B[i + 1]; const b = B[i + 2];
    const cat = c >> 1;
    if (c === 0 || cat === CAT.other) { out[i] = r; out[i + 1] = g; out[i + 2] = b; continue; }
    const side = c & 1;
    const z = zMin + ((P[i] << 4) | (P[i + 1] >> 4)) * zScale;
    const y = (((P[i + 1] & 15) << 8) | P[i + 2]) * yScale;
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const neutral = max - min < 34;
    // Shading detail kept from the original: only colourless texels (panel lines,
    // doors, windows). Coloured paint (primer, old logos, old titles) is painted over.
    let shade = neutral ? Math.min(1.06, Math.max(0.03, max / ref)) : 1;
    let window = false;
    if (neutral && max < dark && z < cockpitZone && z > cabinStart) {
      for (let k = 0; k < rowY.length; k++) if (Math.abs(y - rowY[k]) < rowHalf[k]) window = true;
    }
    let R = r; let G = g; let Bl = b;
    if (cat === CAT.body) {
      // Very dark marks outside the window rows and the cockpit (old registrations,
      // a black primer radome) are painted over too.
      if (z > radomeZone || (neutral && max < dark * 0.8 && !window && z < cockpitZone)) shade = 1;
      let sx = Math.round(side === 0 ? (zMax - z) * PPM : (z - zMin) * PPM);
      let sy = Math.round((yMax - y) * PPM);
      sx = sx < 0 ? 0 : (sx >= sideW ? sideW - 1 : sx);
      sy = sy < 0 ? 0 : (sy >= sideH ? sideH - 1 : sy);
      const k = (sy * sideW + sx) * 4;
      const src = side === 0 ? left : right;
      R = src[k]; G = src[k + 1]; Bl = src[k + 2];
    } else if (cat === CAT.tail) {
      R = tR; G = tG; Bl = tB;
      if (accent && tailAccentAt(accent.kind, z, y, zMin, zRange, yMax)) { R = aR; G = aG; Bl = aB; }
      if (!(neutral && max > 60 && max < 200)) shade = 1; // keep only mid-grey panel / rudder hinge lines
    } else if (cat === CAT.winglet) {
      R = tR; G = tG; Bl = tB;
    } else if (cat === CAT.engine) {
      R = eR; G = eG; Bl = eB;
    } else if (cat === CAT.wing || cat === CAT.stab) {
      R = 200; G = 204; Bl = 208;
    } else {
      shade = 1;
    }
    out[i] = R * shade; out[i + 1] = G * shade; out[i + 2] = Bl * shade;

    if (window && ((Math.floor(z * 2.1) * 7919 + side * 31) % 11) !== 0) { // lit cabin windows at night
      emis[i] = 255; emis[i + 1] = 214; emis[i + 2] = 150;
      lit++;
    }
  }

  const toTexture = (data) => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
    const t = new THREE.CanvasTexture(canvas);
    t.flipY = false; // glTF texture convention
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { map: toTexture(out), emissiveMap: lit > 0 ? toTexture(emis) : null, rows };
}
