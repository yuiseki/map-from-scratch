import assert from 'node:assert/strict';
import test from 'node:test';
import { triangleVerticesOnSphere } from './globe.ts';

test('map-pin globe uses unit sphere positions for base map triangles', () => {
  const xyz = triangleVerticesOnSphere(new Int16Array([1000, 0, 0, 1000, -1000, 0]));
  assert.equal(xyz.length, 9);
  const expected = [Math.sin(Math.PI / 18), 0, Math.cos(Math.PI / 18)];
  assert.ok(Array.from({ length: xyz.length / 3 }, (_, i) => [...xyz.slice(i * 3, i * 3 + 3)])
    .some((vertex) => vertex.every((value, axis) => Math.abs(value - expected[axis]) < 1e-6)));
});
