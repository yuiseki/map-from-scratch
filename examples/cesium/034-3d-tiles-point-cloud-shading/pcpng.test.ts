import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePointCloudImage } from './pcpng.ts';

// A hand-built Point Cloud PNG 1.0 image: header, then column-major x, y, z
// and colour, as the GSJ "mixed" tiles lay them out (x and y one pixel each
// with a 2-pixel offset, z one pixel in centimetres, RGB colour).
function image(points: { x: number; y: number; zcm: number; rgb: [number, number, number] }[], order: number, xOffset: number, yOffset: number) {
  const px: number[] = [];
  const s24 = (v: number) => (v < 0 ? v + 2 ** 24 : v);
  const s48 = (v: number) => { const u = v < 0 ? v + 2 ** 48 : v; return [Math.floor(u / 2 ** 24), u % 2 ** 24]; };
  px.push(0x010101, 0, 0, points.length, 4);
  px.push(3 << 20 | 1 << 16 | 2 << 8 | 0, ...s48(xOffset));
  px.push(3 << 20 | 1 << 16 | 2 << 8 | 0, ...s48(yOffset));
  px.push(3 << 20 | 1 << 16 | 0 << 8 | 2);
  px.push(0x110000, 12 << 16 | 1 << 8 | order);
  px[1] = px.length;
  for (const p of points) px.push(s24(p.x));
  for (const p of points) px.push(s24(p.y));
  for (const p of points) px.push(s24(p.zcm));
  for (const p of points) px.push(p.rgb[0] << 16 | p.rgb[1] << 8 | p.rgb[2]);
  const width = 8, height = Math.ceil(px.length / width);
  const rgba = new Uint8Array(width * height * 4);
  px.forEach((v, i) => { rgba[i * 4] = v >> 16; rgba[i * 4 + 1] = (v >> 8) & 255; rgba[i * 4 + 2] = v & 255; rgba[i * 4 + 3] = 255; });
  return { rgba, width, height };
}

test('decodes mercator position, height in metres and colour of each point', () => {
  const order = 26;
  const { rgba, width, height } = image([
    { x: 1000, y: -2000, zcm: 1234, rgb: [10, 20, 30] },
    { x: -5, y: 7, zcm: -50, rgb: [200, 100, 0] },
  ], order, 40_000_000, 20_000_000);
  const cloud = decodePointCloudImage(rgba, width, height, 4);
  assert.equal(cloud.count, 2);
  assert.equal(cloud.mx[0], (40_000_000 + 1000) / 2 ** order);
  assert.equal(cloud.my[0], (20_000_000 - 2000) / 2 ** order);
  assert.equal(cloud.mx[1], (40_000_000 - 5) / 2 ** order);
  assert.ok(Math.abs(cloud.z[0] - 12.34) < 1e-6);
  assert.ok(Math.abs(cloud.z[1] + 0.5) < 1e-6);
  assert.deepEqual([...cloud.rgb], [10, 20, 30, 200, 100, 0]);
});

test('reads 3-band images (no alpha) with the same layout', () => {
  const { rgba, width, height } = image([{ x: 3, y: 4, zcm: 100, rgb: [1, 2, 3] }], 20, 0, 0);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
  const cloud = decodePointCloudImage(rgb, width, height, 3);
  assert.equal(cloud.mx[0], 3 / 2 ** 20);
  assert.ok(Math.abs(cloud.z[0] - 1) < 1e-6);
});

test('rejects an image that is not Point Cloud PNG 1.0', () => {
  const { rgba, width, height } = image([{ x: 0, y: 0, zcm: 0, rgb: [0, 0, 0] }], 20, 0, 0);
  rgba[0] = 2;
  assert.throws(() => decodePointCloudImage(rgba, width, height, 4), /version/);
});

test('rejects columns that run past the image', () => {
  const { rgba, width, height } = image([{ x: 0, y: 0, zcm: 0, rgb: [0, 0, 0] }], 20, 0, 0);
  rgba[3 * 4 + 2] = 200; // count = 200 points in a 16-pixel image
  assert.throws(() => decodePointCloudImage(rgba, width, height, 4), /truncated/);
});
