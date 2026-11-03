import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMapPoint } from './map.ts';

test('marker projection places the camera center at the viewport center', () => {
  assert.deepEqual(projectMapPoint(12, 55, 12, 55, 8, 800, 600), { x: 400, y: 300 });
});

test('marker projection moves east right and north upward', () => {
  const point = projectMapPoint(13, 56, 12, 55, 4, 800, 600);
  assert.ok(point.x > 400);
  assert.ok(point.y < 300);
});
