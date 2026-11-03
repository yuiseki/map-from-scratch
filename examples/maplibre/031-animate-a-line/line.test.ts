import assert from 'node:assert/strict';
import test from 'node:test';
import { sineLinePoints } from './line.ts';

test('animated sine route precomputes 361 points and breaks across the antimeridian', () => {
  const points = sineLinePoints();
  assert.equal(points.length, 361);
  assert.equal(points[0][0], 0.5);
  assert.ok(Math.abs(points[0][1] - 0.5) < 1e-12);
  assert.equal(points[180][0], 1);
  assert.ok(points[181][0] < 0.01);
  assert.equal(points[360][0], points[0][0]);
  assert.ok(Math.abs(points[360][1] - points[0][1]) < 1e-12);
  assert.ok(points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
});
