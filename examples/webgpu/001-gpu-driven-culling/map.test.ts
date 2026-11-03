import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFrustumPlanes, mat4LookAt, mat4Multiply, mat4Perspective } from './map.ts';

test('perspective and look-at matrices have expected identity-camera structure', () => {
  const view = mat4LookAt([0, 0, 1], [0, 0, 0], [0, 1, 0]);
  assert.ok(Math.abs(view[14] + 1) < 1e-6);
  const projection = mat4Perspective(Math.PI / 2, 1, 1, 10);
  assert.ok(Math.abs(projection[0] - 1) < 1e-6);
  assert.equal(projection[11], -1);
});

test('identity clip matrix extracts six inward-facing frustum planes', () => {
  const planes = extractFrustumPlanes(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  assert.equal(planes.length, 24);
  assert.deepEqual([...planes.slice(0, 4)], [1, 0, 0, 1]);
  assert.deepEqual([...planes.slice(4, 8)], [-1, 0, 0, 1]);
  assert.deepEqual([...planes.slice(20, 24)], [0, 0, -1, 1]);
  assert.deepEqual([...mat4Multiply(new Float32Array(16).map((_, i) => +(i % 5 === 0)), new Float32Array(16).map((_, i) => +(i % 5 === 0)))],
    [...new Float32Array(16).map((_, i) => +(i % 5 === 0))]);
});
