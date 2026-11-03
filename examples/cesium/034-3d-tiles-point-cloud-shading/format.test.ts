import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeNode, decodeNode, nodeBytes, surfaceSpacing } from './format.ts';

test('a node round-trips positions within one quantisation step and colours exactly', () => {
  const min: [number, number, number] = [-100, 50, 2], max: [number, number, number] = [24, 174, 202];
  const xyz = new Float32Array([-100, 50, 2, 24, 174, 202, 3.3, 77.7, 41.25]);
  const rgb = new Uint8Array([1, 2, 3, 4, 5, 6, 250, 251, 252]);
  const bytes = encodeNode(xyz, rgb, min, max);
  assert.equal(bytes.byteLength, nodeBytes(3));
  const node = decodeNode(bytes.buffer as ArrayBuffer, 3);
  for (let i = 0; i < 9; i++) {
    const a = i % 3, extent = max[a] - min[a];
    const back = min[a] + node.q[i] / 65535 * extent;
    assert.ok(Math.abs(back - xyz[i]) <= extent / 65535, `axis ${a}: ${back} vs ${xyz[i]}`);
  }
  assert.deepEqual([...node.rgb], [...rgb]);
});

test('the quantised corners are 0 and 65535, so the box is the node bounds', () => {
  const node = decodeNode(encodeNode(new Float32Array([0, 0, 0, 10, 20, 30]), new Uint8Array(6), [0, 0, 0], [10, 20, 30]).buffer as ArrayBuffer, 2);
  assert.deepEqual([...node.q], [0, 0, 0, 65535, 65535, 65535]);
});

test('surface spacing is the mean point spacing of points spread over the box footprint', () => {
  // 10,000 points on a 100 m x 100 m footprint: one per square metre.
  assert.equal(surfaceSpacing([0, 0, 0], [100, 100, 40], 10_000), 1);
  assert.equal(surfaceSpacing([0, 0, 0], [200, 50, 0], 2_500), 2);
});
