import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMercator } from './map.ts';
test('replacement map clamps polar coordinates to finite Web Mercator values', () => {
  const north = projectMercator(0, 90), south = projectMercator(0, -90);
  assert.ok(north.every(Number.isFinite) && south.every(Number.isFinite));
  assert.ok(north[1] < 0.001 && south[1] > 0.999);
});
