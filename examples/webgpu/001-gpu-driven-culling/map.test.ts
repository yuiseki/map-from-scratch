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
});

// Column-major: element (row, col) is m[col * 4 + row].
const translate = (x: number, y: number, z: number) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
const scale = (s: number) => new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);

test('mat4Multiply(a, b) applies b first, then a', () => {
  // scale(2) * translate(1, 0, 0) moves by 1 and then doubles: the offset is 2.
  assert.deepEqual([...mat4Multiply(scale(2), translate(1, 0, 0)).slice(12, 15)], [2, 0, 0]);
  assert.deepEqual([...mat4Multiply(translate(1, 0, 0), scale(2)).slice(12, 15)], [1, 0, 0]);
});

test('planes of a real view-projection keep what the camera sees', () => {
  // Camera at z = 5 looking at the origin, 90 degree field of view, near 1, far 10.
  const vp = mat4Multiply(mat4Perspective(Math.PI / 2, 1, 1, 10), mat4LookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]));
  const planes = extractFrustumPlanes(vp);
  const inside = ([x, y, z]: number[]) => [0, 1, 2, 3, 4, 5].every((i) =>
    planes[i * 4] * x + planes[i * 4 + 1] * y + planes[i * 4 + 2] * z + planes[i * 4 + 3] >= 0);
  assert.equal(inside([0, 0, 0]), true);
  assert.equal(inside([3, 2, 0]), true);
  // Near the left edge the half-width is the depth: 7 at z = -2, 4 at z = 1.
  assert.equal(inside([-6.5, 0, -2]), true);
  assert.equal(inside([-4.5, 0, 1]), false);
  for (const p of [[6, 0, 0], [-6, 0, 0], [0, 6, 0], [0, -6, 0], [0, 0, 4.5], [0, 0, -6]]) assert.equal(inside(p), false, String(p));
});
