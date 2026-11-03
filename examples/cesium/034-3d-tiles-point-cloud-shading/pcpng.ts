// Bake-time reader of GSJ "Point Cloud PNG 1.0" tiles (the mixed tileset
// serves them as lossless WebP; bake.ts turns each into raw pixels with
// gdal_translate first). Every value is a 24-bit integer in the RGB of one
// pixel: a header of field descriptions, then one column per field.
//
//   pixel 0      0x010101 (version 1.0)
//   pixel 1      header length in pixels = first pixel of the x column
//   pixels 2-3   point count (48 bits)
//   pixel 4      field count (unused here)
//   then x, y, z: info pixel (type 3 = signed integer << 20, pixels per value
//                 << 16, offset pixels << 8, signed decimal exponent), then
//                 the offset (signed, 24 or 48 bits)
//   colour       0x110000: one RGB pixel per point
//   subtype      flags << 16 | projection << 8 | order. Projection 1 is web
//                mercator; x and y count 1/2^order of the mercator square.
//
// The layout was read from 23-taito-point-cloud's REQUEST.md and the spec
// archive it links; this is a separate reader that returns mercator
// fractions so the bake can choose its own origin.
export interface MercatorCloud { count: number; mx: Float64Array; my: Float64Array; z: Float32Array; rgb: Uint8Array }

export function decodePointCloudImage(pixels: Uint8Array, width: number, height: number, channels: number): MercatorCloud {
  const capacity = width * height;
  if (pixels.length < capacity * channels || capacity < 14) throw new Error('truncated point cloud image');
  const at = (p: number) => {
    if (p < 0 || p >= capacity) throw new Error('truncated point cloud columns');
    const i = p * channels;
    return pixels[i] * 65536 + pixels[i + 1] * 256 + pixels[i + 2];
  };
  const signed = (p: number, n: number) => {
    const raw = n === 2 ? at(p) * 2 ** 24 + at(p + 1) : at(p), bits = 24 * n;
    return raw >= 2 ** (bits - 1) ? raw - 2 ** bits : raw;
  };
  if (at(0) !== 0x010101) throw new Error('unsupported point cloud PNG version');
  const header = at(1), count = at(2) * 2 ** 24 + at(3);
  let p = 5;
  const field = () => {
    const info = at(p++), n = (info >> 16) & 15, offsetPixels = (info >> 8) & 255, e = info & 255;
    if (info >> 20 !== 3 || n < 1 || n > 2 || offsetPixels > 2) throw new Error('unsupported coordinate field');
    const offset = offsetPixels ? signed(p, offsetPixels) : 0;
    p += offsetPixels;
    return { n, offset, scale: 10 ** -(e < 128 ? e : e - 256) };
  };
  const fx = field(), fy = field(), fz = field();
  if (at(p++) !== 0x110000) throw new Error('point colours are required');
  const subtype = at(p++), order = subtype & 255;
  if (((subtype >> 8) & 255) !== 1) throw new Error('only web mercator point clouds are supported');
  if (p > header) throw new Error('truncated point cloud header');
  const xs = header, ys = xs + count * fx.n, zs = ys + count * fy.n, cs = zs + count * fz.n;
  if (cs + count > capacity) throw new Error('truncated point cloud columns');
  const unit = 1 / 2 ** order;
  const mx = new Float64Array(count), my = new Float64Array(count), z = new Float32Array(count), rgb = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    mx[i] = (signed(xs + i * fx.n, fx.n) + fx.offset) * fx.scale * unit;
    my[i] = (signed(ys + i * fy.n, fy.n) + fy.offset) * fy.scale * unit;
    z[i] = (signed(zs + i * fz.n, fz.n) + fz.offset) * fz.scale;
    const c = (cs + i) * channels;
    rgb[i * 3] = pixels[c]; rgb[i * 3 + 1] = pixels[c + 1]; rgb[i * 3 + 2] = pixels[c + 2];
  }
  return { count, mx, my, z, rgb };
}
