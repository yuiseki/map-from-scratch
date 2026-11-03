import assert from 'node:assert/strict';
import test from 'node:test';
import { multiply, rotateVector, versorBetween } from './versor.ts';

test('versor drag rotates one unit direction onto another', () => {
  const from = [1, 0, 0] as const;
  const to = [0, 1, 0] as const;
  const q = versorBetween(from, to);
  const rotated = rotateVector(q, from);
  assert.ok(Math.abs(rotated[0]) < 1e-6);
  assert.ok(Math.abs(rotated[1] - 1) < 1e-6);
  assert.ok(Math.abs(rotated[2]) < 1e-6);
  assert.deepEqual(multiply([1, 0, 0, 0], q), q);
});
