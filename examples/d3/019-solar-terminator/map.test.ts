import assert from 'node:assert/strict';
import test from 'node:test';
import { subsolarPosition } from './map.ts';

test('subsolar position stays on Earth and longitude wraps around the date line', () => {
  for (const hour of [0, 6, 12, 18, 23.99]) {
    const sun = subsolarPosition(hour);
    assert.ok(sun.lon >= -180 && sun.lon < 180);
    assert.ok(sun.lat >= -23.5 && sun.lat <= 23.5);
  }
});

test('subsolar position repeats every 24 UTC hours', () => {
  const today = subsolarPosition(7.25);
  const tomorrow = subsolarPosition(31.25);
  assert.ok(Math.abs(today.lon - tomorrow.lon) < 1e-12);
  assert.ok(Math.abs(today.lat - tomorrow.lat) < 1e-12);
});
