// Web Mercator in unit square coordinates (x east 0..1 from 180 W, y south
// 0..1 from 85.05 N) and the two-byte height encoding of the baked images.
// Shared by bake.ts (Node) and the renderer.

export const mercX = (lon: number): number => (lon + 180) / 360;
export const mercY = (lat: number): number => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
export const lonOfX = (x: number): number => x * 360 - 180;
export const latOfY = (y: number): number => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** [west, north, east, south] in degrees of tile z/x/y. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  return [lonOfX(x / n), latOfY(y / n), lonOfX((x + 1) / n), latOfY((y + 1) / n)];
}

// Height in the baked WebP: v = R * 256 + G, h = v * HEIGHT_STEP - HEIGHT_OFFSET.
// Mapterhorn's Terrarium B byte (1/256 m) is noise for a 117 m grid and made
// the lossless WebP much larger; a quarter metre keeps the lowland hillshade
// free of terraces (bake.ts records the sizes).
export const HEIGHT_STEP = 0.25;
export const HEIGHT_OFFSET = 500;

export function encodeHeight(h: number): [number, number] {
  const v = Math.max(0, Math.min(65535, Math.round((h + HEIGHT_OFFSET) / HEIGHT_STEP)));
  return [v >> 8, v & 255];
}

export const decodeHeight = (r: number, g: number): number => (r * 256 + g) * HEIGHT_STEP - HEIGHT_OFFSET;

export const decodeTerrarium = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;

export function heightsFromRGBA(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = decodeHeight(rgba[4 * i], rgba[4 * i + 1]);
  return out;
}
