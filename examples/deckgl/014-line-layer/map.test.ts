import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeLineData } from './map.ts';

test('binary migration lines decode normalized endpoints and signed flow', () => {
  const buffer = new ArrayBuffer(22);
  const view = new DataView(buffer);
  view.setUint32(6, 1, true);
  view.setUint16(10, 0, true); view.setUint16(12, 65535, true);
  view.setUint16(14, 32768, true); view.setUint16(16, 16384, true);
  view.setInt32(18, -1234, true);
  assert.deepEqual(decodeLineData(buffer), [{ sx: 0, sy: 1, tx: 32768 / 65535, ty: 16384 / 65535, v: -1234 }]);
});

test('binary migration line decoder supports an empty dataset', () => {
  const buffer = new ArrayBuffer(10);
  assert.deepEqual(decodeLineData(buffer), []);
});
