import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTiffHeader, parseIfd, planTiles, readTiffRasterMetadata, type ParsedIfd, type TiffTag } from './cog.ts';

function classicTiffFixture() {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 3, true);
  for (const [i, tag, value] of [[0, 256, 512], [1, 257, 256], [2, 322, 256]] as const) {
    const at = 10 + i * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, 3, true);
    view.setUint32(at + 4, 1, true);
    view.setUint16(at + 8, value, true);
  }
  view.setUint32(46, 0, true);
  return bytes;
}

test('parses classic TIFF headers and inline SHORT fields, rejecting unsupported formats', () => {
  const bytes = classicTiffFixture();
  const header = parseTiffHeader(bytes);
  assert.deepEqual(header, { littleEndian: true, firstIfdOffset: 8 });
  const ifd = parseIfd(bytes, 8, true);
  assert.equal(ifd.tags.get(256)?.values[0], 512);
  assert.equal(ifd.tags.get(257)?.values[0], 256);
  const bigTiff = new Uint8Array(16);
  bigTiff.set([0x49, 0x49, 43, 0]);
  assert.throws(() => parseTiffHeader(bigTiff), /classic TIFF/i);
  assert.throws(() => parseIfd(bytes, 63), /outside/i);
});

test('plans only intersecting tiles and rejects missing or out-of-file index entries', () => {
  const plan = planTiles({
    width: 512, height: 512, tileWidth: 256, tileHeight: 256,
    tileOffsets: [100, 200, 300, 400], tileByteCounts: [10, 20, 30, 40], totalLength: 1000,
  }, { x: 255, y: 2, width: 3, height: 2 });
  assert.deepEqual(plan.map(tile => tile.index), [0, 1]);
  assert.deepEqual(plan.map(tile => [tile.offset, tile.byteCount]), [[100, 10], [200, 20]]);
  assert.throws(() => planTiles({
    width: 512, height: 512, tileWidth: 256, tileHeight: 256,
    tileOffsets: [100], tileByteCounts: [10], totalLength: 1000,
  }, { x: 255, y: 2, width: 3, height: 2 }), /index/i);
  assert.throws(() => planTiles({
    width: 256, height: 256, tileWidth: 256, tileHeight: 256,
    tileOffsets: [995], tileByteCounts: [10], totalLength: 1000,
  }, { x: 0, y: 0, width: 1, height: 1 }), /outside/i);
});

function rasterIfd(overrides: Map<number, TiffTag> = new Map()): ParsedIfd {
  const tags = new Map<number, TiffTag>([
    [256, { type: 3, count: 1, values: [43200] }], [257, { type: 3, count: 1, values: [21600] }],
    [258, { type: 3, count: 1, values: [32] }], [259, { type: 3, count: 1, values: [8] }],
    [277, { type: 3, count: 1, values: [1] }], [284, { type: 3, count: 1, values: [1] }],
    [317, { type: 3, count: 1, values: [3] }], [322, { type: 3, count: 1, values: [256] }],
    [323, { type: 3, count: 1, values: [256] }], [339, { type: 3, count: 1, values: [3] }],
    [324, { type: 4, count: 14365, values: Array.from({ length: 14365 }, (_, i) => 100 + i * 2) }],
    [325, { type: 4, count: 14365, values: Array(14365).fill(1) }],
    [33550, { type: 12, count: 3, values: [1 / 120, 1 / 120, 1] }],
    [33922, { type: 12, count: 6, values: [0, 0, 0, -180, 90, 0] }],
    [42113, { type: 2, count: 8, values: [], text: '-99999' }],
  ]);
  for (const [key, value] of overrides) tags.set(key, value);
  return { tags, nextIfdOffset: 0 };
}

test('validates official raster dimensions, compression, predictor, transform, nodata and full tile index', () => {
  const metadata = readTiffRasterMetadata(rasterIfd(), 1_000_000);
  assert.equal(metadata.width, 43200);
  assert.equal(metadata.height, 21600);
  assert.equal(metadata.compression, 8);
  assert.equal(metadata.predictor, 3);
  assert.deepEqual(metadata.transform, [-180, 1 / 120, 0, 90, 0, -1 / 120]);
  assert.equal(metadata.nodata, -99999);
  assert.equal(metadata.tileOffsets.length, 14365);
  assert.throws(() => readTiffRasterMetadata(rasterIfd(new Map([[259, { type: 3, count: 1, values: [5] }]])), 1_000_000), /supported NOAA/i);
});
