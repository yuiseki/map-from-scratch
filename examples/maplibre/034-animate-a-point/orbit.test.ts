import assert from 'node:assert/strict';
import test from 'node:test';
import { orbitPoint } from './orbit.ts';

test('orbit animation keeps its point on the 20-degree circle around the origin', () => {
  assert.deepEqual(orbitPoint(0), [20, 0]);
  assert.ok(Math.abs(orbitPoint(Math.PI / 2)[0]) < 1e-12);
  assert.ok(Math.abs(orbitPoint(Math.PI / 2)[1] - 20) < 1e-12);
  for (const angle of [0, 0.3, 1.2, Math.PI, 5.1]) {
    const [x, y] = orbitPoint(angle);
    assert.ok(Math.abs(Math.hypot(x, y) - 20) < 1e-12);
  }
});
