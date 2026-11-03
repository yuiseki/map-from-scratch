import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { encodeGrayPng, rasterizePolygons, type LandPolygons } from './land-mask.ts';

test('rasterizes a normalized polygon into expected top-origin pixels', () => {
  const polygons = [[[[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]]]] as unknown as LandPolygons;
  const image = rasterizePolygons(polygons, 4, 4);
  assert.deepEqual([...image], [
    0,0,0,0,
    0,255,255,0,
    0,255,255,0,
    0,0,0,0,
  ]);
});

test('even-odd filling keeps a polygon hole transparent', () => {
  const polygons = [[
    [[0.125,0.125],[0.875,0.125],[0.875,0.875],[0.125,0.875],[0.125,0.125]],
    [[0.375,0.375],[0.625,0.375],[0.625,0.625],[0.375,0.625],[0.375,0.375]],
  ]] as unknown as LandPolygons;
  const image = rasterizePolygons(polygons, 8, 8);
  assert.equal(image[3 * 8 + 3], 0);
  assert.equal(image[2 * 8 + 2], 255);
});

test('encodes grayscale data as a decodable PNG image', () => {
  const png = encodeGrayPng(2, 2, new Uint8Array([0, 255, 64, 128]));
  assert.deepEqual([...png.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  const chunks: Uint8Array[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
    const name = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    if (name === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const compressed = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  assert.deepEqual([...inflateSync(compressed)], [0,0,255,0,64,128]);
});
