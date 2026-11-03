import assert from 'node:assert/strict';
import test from 'node:test';
import { interpolateCoordinates } from './morph.ts';

test('orthographic to equirectangular morph is continuous and bounded', () => {
  assert.deepEqual(interpolateCoordinates([0.2, 0.3], [0.8, 0.7], 0), [0.2, 0.3]);
  assert.deepEqual(interpolateCoordinates([0.2, 0.3], [0.8, 0.7], 1), [0.8, 0.7]);
  const middle = interpolateCoordinates([0.2, 0.3], [0.8, 0.7], 0.5);
  assert.ok(Math.abs(middle[0] - 0.5) < 1e-12 && Math.abs(middle[1] - 0.5) < 1e-12);
  assert.deepEqual(interpolateCoordinates([0.2, 0.3], [0.8, 0.7], -1), [0.2, 0.3]);
  assert.deepEqual(interpolateCoordinates([0.2, 0.3], [0.8, 0.7], 1.5), [0.8, 0.7]);
});
