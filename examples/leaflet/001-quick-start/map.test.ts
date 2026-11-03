import assert from 'node:assert/strict';
import test from 'node:test';
import { circleRadiusPixels } from './map.ts';

test('quick-start circle radius scales linearly with ground distance', () => {
  const oneKm = circleRadiusPixels(1000, 51.508, 13);
  assert.ok(Math.abs(oneKm - 2 * circleRadiusPixels(500, 51.508, 13)) < 1e-10);
});

test('quick-start circle radius doubles with each zoom level', () => {
  const z13 = circleRadiusPixels(500, 51.508, 13);
  assert.ok(Math.abs(circleRadiusPixels(500, 51.508, 14) - z13 * 2) < 1e-10);
});
