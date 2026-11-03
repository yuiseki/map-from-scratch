import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceToSegment, pointInRing } from './map.ts';

test('GeoJSON line hit distance projects onto the segment and clamps to its endpoints', () => {
  assert.equal(distanceToSegment(5, 3, 0, 0, 10, 0), 3);
  assert.equal(distanceToSegment(-2, 0, 0, 0, 10, 0), 2);
  assert.ok(Math.abs(distanceToSegment(5, 0, 2, 2, 2, 2) - Math.sqrt(13)) < 1e-12);
});

test('GeoJSON polygon hit test handles interior, exterior and boundary crossings', () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInRing(5, 5, ring), true);
  assert.equal(pointInRing(12, 5, ring), false);
  assert.equal(pointInRing(-1, 11, ring), false);
});
