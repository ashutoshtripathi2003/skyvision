import * as THREE from 'three';

// Paints the fuselage "skin" onto a canvas that is wrapped around the fuselage
// with UV coordinates: u = along the aircraft (tail 0 -> nose 1),
// v = around it (0 = top, 0.25 = left side, 0.5 = belly, 0.75 = right side).
// A second canvas holds only the lit windows, used as the emissive map at night.
const W = 2048;
const H = 512;
const cache = new Map();

const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

export function fuselageTextures(spec, livery) {
  const key = `${spec.short}|${livery.name}|${livery.tail}|${livery.title}`;
  if (cache.has(key)) return cache.get(key);

  const f = spec.fuselage;
  const length = f.noseZ - f.tailZ;
  const circumference = 2 * Math.PI * f.radius * (1 + f.stretchY) / 2;
  const x = (zFromNose) => ((length - zFromNose) / length) * W;           // metres from the nose -> canvas x
  const alongX = (frac) => frac * W;                                       // fraction tail->nose -> canvas x
  // Around-angle for a point at height h above the centre line on the left (+X) or right (-X) side.
  const aroundAt = (h, side) => {
    const theta = Math.acos(Math.max(-1, Math.min(1, h / (f.radius * f.stretchY))));
    return side > 0 ? theta / (2 * Math.PI) : 1 - theta / (2 * Math.PI);
  };
  const y = (around) => (1 - around) * H;                                  // canvas y (texture is flipped vertically)
  const metresAround = (m) => (m / circumference) * H;
  const metresAlong = (m) => (m / length) * W;

  const skin = document.createElement('canvas');
  skin.width = W;
  skin.height = H;
  const ctx = skin.getContext('2d');
  const lit = document.createElement('canvas');
  lit.width = W;
  lit.height = H;
  const lctx = lit.getContext('2d');
  lctx.fillStyle = '#000';
  lctx.fillRect(0, 0, W, H);

  // Base colour and a slightly darker belly.
  ctx.fillStyle = css(livery.body);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120,130,140,0.18)';
  ctx.fillRect(0, y(0.62), W, y(0.38) - y(0.62));

  const deckHeights = spec.windows.decks === 2
    ? [-0.05 * f.radius * f.stretchY, 0.56 * f.radius * f.stretchY]
    : [0.3 * f.radius];
  const cheatHeight = deckHeights[0] - 0.42 * f.radius * f.stretchY * (spec.windows.decks === 2 ? 0.5 : 1);

  [1, -1].forEach((side) => {
    // Cheatline (livery stripe) below the main-deck windows.
    const cy = y(aroundAt(cheatHeight, side));
    ctx.fillStyle = css(livery.cheat);
    ctx.fillRect(alongX(0.1), cy - metresAround(0.22), alongX(0.8), metresAround(0.44));

    // Passenger windows, skipping the doors. Positions are fractions from tail (0) to nose (1).
    deckHeights.forEach((h, deck) => {
      const wy = y(aroundAt(h, side));
      const from = spec.windows.from;
      const to = deck === 1 ? spec.windows.to - 0.03 : spec.windows.to;
      for (let a = from; a < to; a += spec.windows.pitch / length) {
        if (spec.doors.some((d) => Math.abs(a - d) * length < 1.1)) continue;
        const wx = alongX(a);
        const ww = metresAlong(0.26);
        const wh = metresAround(0.36);
        ctx.fillStyle = '#1c2633';
        roundRect(ctx, wx - ww / 2, wy - wh / 2, ww, wh, ww * 0.4);
        lctx.fillStyle = Math.random() > 0.15 ? '#ffd69a' : '#3a2a10';
        roundRect(lctx, wx - ww / 2, wy - wh / 2, ww, wh, ww * 0.4);
      }
    });

    // Door outlines.
    ctx.strokeStyle = 'rgba(60,70,85,0.55)';
    ctx.lineWidth = 2;
    spec.doors.forEach((d) => {
      const dx = alongX(d);
      const top = y(aroundAt(deckHeights[0] + 1.3, side));
      const bottom = y(aroundAt(deckHeights[0] - 0.75, side));
      const t = Math.min(top, bottom);
      ctx.strokeRect(dx - metresAlong(0.45), t, metresAlong(0.9), Math.abs(bottom - top));
    });

    // Cockpit windows: dark panes high on the nose.
    const cockpitZ = f.noseLength * 0.55;
    const cx = x(cockpitZ);
    const top = y(aroundAt(f.radius * f.stretchY * 0.75, side));
    const bottom = y(aroundAt(f.radius * f.stretchY * 0.42, side));
    if (spec.cockpitMask) {
      ctx.fillStyle = '#0b0f14'; // A350's black "mask" around the cockpit windows
      ctx.fillRect(cx - metresAlong(2.4), Math.min(top, bottom) - 6, metresAlong(3.2), Math.abs(bottom - top) + 12);
    }
    ctx.fillStyle = '#15202c';
    for (let pane = 0; pane < 3; pane++) {
      const px = cx - metresAlong(0.2 + pane * 0.62);
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px - metresAlong(0.5), top);
      ctx.lineTo(px - metresAlong(0.6), bottom);
      ctx.lineTo(px + metresAlong(0.05), bottom);
      ctx.closePath();
      ctx.fill();
    }
    lctx.fillStyle = '#3a4a60';
    lctx.fillRect(cx - metresAlong(1.9), Math.min(top, bottom), metresAlong(1.8), Math.abs(bottom - top));

    // Airline title above the windows. The left side is seen with the nose on the
    // viewer's left, so it is painted rotated 180 degrees to read correctly.
    if (livery.title) {
      const titleHeight = deckHeights[deckHeights.length - 1] + 0.55 * f.radius * f.stretchY * (spec.windows.decks === 2 ? 0.45 : 0.85);
      const ty = y(aroundAt(titleHeight, side));
      const tx = alongX(0.62);
      const size = Math.min(metresAround(f.radius * 0.5), 64);
      ctx.save();
      ctx.translate(tx, ty);
      if (side > 0) ctx.rotate(Math.PI);
      ctx.fillStyle = livery.titleColor;
      ctx.font = `${livery.titleFont} ${size}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxWidth = alongX(0.42);
      ctx.fillText(livery.title, 0, 0, maxWidth);
      ctx.restore();
    }
  });

  const map = new THREE.CanvasTexture(skin);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const emissiveMap = new THREE.CanvasTexture(lit);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  const result = { map, emissiveMap };
  cache.set(key, result);
  return result;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
