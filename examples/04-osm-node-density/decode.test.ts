import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeDensityData } from './decode.ts';

test('density decoder cumulatively restores coordinates and scatters Morton order by stride', () => {
  const bytes = new ArrayBuffer(40 + 5 * 4);
  const view = new DataView(bytes);
  view.setUint32(0, 5, true);
  [1, 2, 3, 4].forEach((v, i) => view.setFloat64(8 + i * 8, v, true));
  [1, 2, 3, 4, 5].forEach((v, i) => view.setUint16(40 + i * 2, v, true));
  [10, 20, 30, 40, 50].forEach((v, i) => view.setUint16(50 + i * 2, v, true));

  const decoded = decodeDensityData(bytes, 2);
  assert.equal(decoded.count, 5);
  assert.deepEqual([...decoded.bbox], [1, 2, 3, 4]);
  assert.deepEqual([...decoded.positions], [1, 10, 6, 60, 15, 150, 3, 30, 10, 100]);
});

test('density coordinate deltas wrap at 16 bits', () => {
  const bytes = new ArrayBuffer(44);
  const view = new DataView(bytes);
  view.setUint32(0, 1, true);
  view.setUint16(40, 65535, true);
  view.setUint16(42, 2, true);
  assert.deepEqual([...decodeDensityData(bytes, 1).positions], [65535, 2]);
});
