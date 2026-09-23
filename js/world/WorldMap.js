// Pre-renders a world's ground colours into a small canvas once, so the
// minimap can draw it every frame with a single drawImage + 2D transform.
export function createWorldMap(bounds, pixels, colorAt) {
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const w = pixels;
  const h = Math.max(1, Math.round((pixels * depth) / width));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [r, g, b] = colorAt(bounds.minX + ((i + 0.5) / w) * width, bounds.minZ + ((j + 0.5) / h) * depth);
      const k = (j * w + i) * 4;
      image.data[k] = r;
      image.data[k + 1] = g;
      image.data[k + 2] = b;
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, ...bounds };
}
