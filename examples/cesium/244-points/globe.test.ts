import assert from 'node:assert/strict';
import test from 'node:test';
import { triangleVerticesOnSphere } from './globe.ts';

test('point-cloud globe produces finite unit vectors for triangle vertices', () => {
  const xyz = triangleVerticesOnSphere(new Int16Array([1000, 0, 0, 1000, -1000, 0]));
  assert.equal(xyz.length, 9);
  for (let i = 0; i < xyz.length; i += 3) {
    assert.ok(Number.isFinite(xyz[i]) && Number.isFinite(xyz[i + 1]) && Number.isFinite(xyz[i + 2]));
    assert.ok(Math.abs(Math.hypot(xyz[i], xyz[i + 1], xyz[i + 2]) - 1) < 1e-6);
  }
});
