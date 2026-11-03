import assert from 'node:assert/strict';
import test from 'node:test';
import { triangleVerticesOnSphere } from './globe.ts';

test('vector-layer triangles are converted into finite unit globe vertices', () => {
  const vertices = triangleVerticesOnSphere(new Int16Array([1000, 0, 0, 1000, -1000, 0]));
  assert.ok(vertices.length >= 9 && vertices.length % 3 === 0);
  for (let i = 0; i < vertices.length; i += 3) {
    assert.ok(Math.abs(Math.hypot(vertices[i], vertices[i + 1], vertices[i + 2]) - 1) < 1e-6);
  }
});
