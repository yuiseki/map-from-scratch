import assert from 'node:assert/strict';
import test from 'node:test';
import { packCloudVertices } from './render-data.ts';

test('point-cloud GPU vertex packer interleaves float positions and byte colors', () => {
  const packed = packCloudVertices({
    count: 2,
    positions: new Float32Array([1.25, -2.5, 3, 4, 5, 6]),
    colors: new Uint8Array([10, 20, 30, 40, 50, 60]),
  });
  assert.equal(packed.byteLength, 32);
  assert.deepEqual([...new Float32Array(packed, 0, 3)], [1.25, -2.5, 3]);
  assert.deepEqual([...new Uint8Array(packed, 12, 4)], [10, 20, 30, 0]);
  assert.deepEqual([...new Float32Array(packed, 16, 3)], [4, 5, 6]);
  assert.deepEqual([...new Uint8Array(packed, 28, 4)], [40, 50, 60, 0]);
});
