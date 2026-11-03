import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeWorldGeometry } from './map.ts';

test('world geometry restores delta coordinates, triangle indices and ring edges', () => {
  const bytes = new ArrayBuffer(48);
  const view = new DataView(bytes);
  [3, 3, 1].forEach((v, i) => view.setUint32(i * 4, v, true));
  [100, 7, 7, 5, 4, 8, 200, 4, 8].forEach((v, i) => view.setUint16(12 + i * 2, v, true));
  view.setUint32(32, 3, true);
  [0, 1, 1].forEach((v, i) => view.setUint32(36 + i * 4, v, true));

  const geometry = decodeWorldGeometry(bytes);
  assert.deepEqual([...geometry.pos], [100, 5, 107, 9, 114, 17]);
  assert.deepEqual([...geometry.ids], [200, 4, 8]);
  assert.deepEqual([...geometry.idx], [0, 1, 2, 0, 1, 1, 2, 2, 0]);
  assert.equal(geometry.nt, 3);
  assert.equal(geometry.nr, 1);
});
