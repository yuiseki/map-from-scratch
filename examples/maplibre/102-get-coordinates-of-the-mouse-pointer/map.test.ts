import assert from 'node:assert/strict';
import test from 'node:test';
import { mercX, mercY, screenToLngLat } from './map.ts';

test('pointer at viewport center reports the map center', () => {
  const center = screenToLngLat(400, 300, 800, 600, mercX(-74.5), mercY(40), 5);
  assert.ok(Math.abs(center[0] + 74.5) < 1e-10);
  assert.ok(Math.abs(center[1] - 40) < 1e-10);
});

test('pointer longitude wraps across world copies and latitude clamps at the poles', () => {
  const acrossDateLine = screenToLngLat(400, 300, 800, 600, mercX(190), mercY(0), 3);
  assert.ok(Math.abs(acrossDateLine[0] + 170) < 1e-10);
  assert.ok(Math.abs(screenToLngLat(400, -10000, 800, 600, 0.5, 0.5, 3)[1] - 85.0511287798) < 1e-8);
});
