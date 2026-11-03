import assert from 'node:assert/strict';
import test from 'node:test';
import { triangleVerticesOnSphere } from './globe.ts';

test('hello-world triangle vertices use unit Cesium sphere coordinates', () => {
  const xyz = triangleVerticesOnSphere(new Int16Array([1000, 0, 0, 1000, -1000, 0]));
  assert.equal(xyz.length, 9);
  for (let i = 0; i < xyz.length; i += 3) {
    assert.ok(Math.abs(Math.hypot(xyz[i], xyz[i + 1], xyz[i + 2]) - 1) < 1e-6);
  }
  const expected = [Math.sin(Math.PI / 18), 0, Math.cos(Math.PI / 18)];
  assert.ok(Array.from({ length: xyz.length / 3 }, (_, i) => [...xyz.slice(i * 3, i * 3 + 3)])
    .some((vertex) => vertex.every((value, axis) => Math.abs(value - expected[axis]) < 1e-6)));
});
