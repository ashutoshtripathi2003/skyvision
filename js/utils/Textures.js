import * as THREE from 'three';
import { seededRandom } from './MathUtils.js';

// All textures are generated at runtime on a 2D canvas, so the project needs
// no image files and every texture can be explained as "pixels we drew".

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toTexture(canvas, repeatX = 1, repeatY = 1) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  return texture;
}

// Base colour plus per-pixel random noise and soft blotches.
function noiseCanvas(size, [r, g, b], variance, blotchColors, seed) {
  const rand = seededRandom(seed);
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (rand() - 0.5) * variance;
    image.data[i * 4] = r + n;
    image.data[i * 4 + 1] = g + n;
    image.data[i * 4 + 2] = b + n;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  blotchColors.forEach((color) => {
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, 4 + rand() * 18, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  return canvas;
}

export function grassTexture(repeat) {
  const canvas = noiseCanvas(256, [88, 140, 64], 34,
    ['rgba(60,110,45,0.25)', 'rgba(120,160,80,0.2)'], 7);
  return toTexture(canvas, repeat, repeat);
}

// Neutral light-grey noise: multiplied with the terrain's vertex colours to add fine detail.
export function detailTexture(repeat) {
  const canvas = noiseCanvas(256, [226, 226, 226], 46,
    ['rgba(170,170,170,0.22)', 'rgba(255,255,255,0.18)'], 31);
  return toTexture(canvas, repeat, repeat);
}

export function asphaltTexture(repeatX, repeatY) {
  const canvas = noiseCanvas(256, [58, 58, 62], 26, ['rgba(30,30,32,0.18)'], 11);
  return toTexture(canvas, repeatX, repeatY);
}

export function concreteTexture(repeatX, repeatY) {
  const canvas = noiseCanvas(256, [168, 168, 162], 18, ['rgba(120,120,115,0.12)'], 23);
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(90,90,90,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 256, 256); // expansion joints between slabs
  return toTexture(canvas, repeatX, repeatY);
}

// Glass curtain wall. `lit` = true draws the night version used as an emissive map.
export function facadeTexture({ columns, rows, lit = false, seed = 3 }) {
  const rand = seededRandom(seed);
  const cellW = 32;
  const cellH = 48;
  const canvas = makeCanvas(columns * cellW, rows * cellH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = lit ? '#000' : '#9aa7b0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < rows; r++) {
      if (lit) {
        ctx.fillStyle = rand() > 0.25 ? '#ffd48a' : '#2a2a2a';
      } else {
        const shade = 70 + Math.floor(rand() * 30);
        ctx.fillStyle = `rgb(${shade - 20},${shade + 20},${shade + 55})`;
      }
      ctx.fillRect(c * cellW + 3, r * cellH + 3, cellW - 6, cellH - 6);
    }
  }
  return toTexture(canvas);
}

// Town building walls: light render with rows of windows (lit = night emissive version).
export function buildingTexture({ lit = false, seed = 5 } = {}) {
  const rand = seededRandom(seed);
  const canvas = makeCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = lit ? '#000' : '#ece7dd';
  ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 5; col++) {
      if (lit) ctx.fillStyle = rand() > 0.45 ? '#ffcf80' : '#000';
      else ctx.fillStyle = '#56687a';
      ctx.fillRect(8 + col * 24, 8 + row * 20, 12, 11);
    }
  }
  return toTexture(canvas);
}

export function textTexture(text, {
  width = 512, height = 128, background = '#10151c', color = '#ffffff',
  font = 'bold 72px "Segoe UI", Arial, sans-serif', border = null,
} = {}) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, width - 8, height - 8);
  }
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + 4);
  const texture = toTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

// Taxiway sign: black/yellow location panel + red/white runway panel.
export function taxiSignTexture(location, runway) {
  const canvas = makeCanvas(512, 128);
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 76px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 200, 128);
  ctx.fillStyle = '#ffd400';
  ctx.fillText(location, 100, 68);
  ctx.fillStyle = '#c8102e';
  ctx.fillRect(200, 0, 312, 128);
  ctx.fillStyle = '#fff';
  ctx.fillText(runway, 356, 68);
  const texture = toTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

// Transparent strip of passenger windows for the aircraft fuselage.
export function windowStripTexture() {
  const canvas = makeCanvas(1024, 32);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b2533';
  for (let x = 20; x < 1000; x += 34) {
    ctx.beginPath();
    ctx.roundRect(x, 6, 16, 20, 6);
    ctx.fill();
  }
  const texture = toTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

// Orange/white banded windsock.
export function windsockTexture() {
  const canvas = makeCanvas(256, 64);
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#ff6a00' : '#ffffff';
    ctx.fillRect((i * 256) / 5, 0, 256 / 5, 64);
  }
  return toTexture(canvas);
}

let glowTextureCache = null;

// Soft radial gradient used by additive sprites to fake the halo around a lamp.
export function glowTexture() {
  if (glowTextureCache) return glowTextureCache;
  const canvas = makeCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  glowTextureCache = new THREE.CanvasTexture(canvas);
  return glowTextureCache;
}
