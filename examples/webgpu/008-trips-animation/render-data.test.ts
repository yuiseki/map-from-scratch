import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeBuildingVertices, decodeTripSegments } from './render-data.ts';

test('building upload data converts packed coordinates and byte shade to floats', () => {
  const buffer = new ArrayBuffer(40);
  const view = new DataView(buffer, 32);
  view.setUint16(0, 11, true); view.setUint16(2, 22, true); view.setUint16(4, 33, true);
  view.setUint8(6, 128);
  const decoded = decodeBuildingVertices({ buffer, count: 1 });
  assert.deepEqual([...decoded.slice(0, 3)], [11, 22, 33]);
  assert.ok(Math.abs(decoded[3] - 128 / 255) < 1e-7);
});

test('trip upload data expands adjacent 24-bit points into GPU segment records', () => {
  const buffer = new ArrayBuffer(52);
  const view = new DataView(buffer, 32);
  const record = (offset: number, x: number, y: number, time: number, vendor: number, gap: number) => {
    view.setUint8(offset, x & 255); view.setUint8(offset + 1, (x >>> 8) & 255); view.setUint8(offset + 2, x >>> 16);
    view.setUint8(offset + 3, y & 255); view.setUint8(offset + 4, (y >>> 8) & 255); view.setUint8(offset + 5, y >>> 16);
    view.setUint16(offset + 6, time, true); view.setUint8(offset + 8, vendor); view.setUint8(offset + 9, gap);
  };
  record(0, 0x123456, 0xabcdef, 12, 1, 0);
  record(10, 0x010203, 0x040506, 34, 0, 1);
  assert.deepEqual([...decodeTripSegments({ buffer, count: 2 })], [0x123456, 0xabcdef, 12, 0x010203, 0x040506, 34, 1, 0]);
});
