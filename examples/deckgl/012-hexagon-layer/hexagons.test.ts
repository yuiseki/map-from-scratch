import assert from 'node:assert/strict';
import test from 'node:test';
import { hexRound, hexagonMesh } from './hexagons.ts';

test('axial hex rounding returns integer coordinates on the cube-coordinate plane', () => {
  const [q, r] = hexRound(1.8, -0.2);
  assert.equal(q, 2);
  assert.ok(Math.abs(r) < 1e-12);
  assert.equal(Number.isInteger(-q - r), true);
  assert.deepEqual(hexRound(0, 0), [0, 0]);
  // Rounding each axis alone gives (0, 0), off the plane q + r + s = 0; the
  // axis with the largest error is recomputed from the other two.
  assert.deepEqual(hexRound(0.4, 0.45), [0, 1]);
});

test('instanced hex mesh has six top faces and six shaded side faces', () => {
  const mesh = hexagonMesh();
  assert.equal(mesh.length, 6 * 9 * 4);
  const vertexStride = 4;
  assert.deepEqual([...mesh.slice(0, vertexStride)], [0, 0, 1, 1]);
  assert.ok([...mesh].every(Number.isFinite));
});
