import assert from 'node:assert/strict';
import test from 'node:test';
import { colorForMag, radiusForMag, STOPS } from './map.ts';

test('magnitude color and radius use endpoint values and interpolate between stops', () => {
  assert.deepEqual(colorForMag(1), [...STOPS[0].color]);
  assert.deepEqual(colorForMag(6), [...STOPS[2].color]);
  assert.deepEqual(colorForMag(2), [149, 122, 131]);
  assert.equal(radiusForMag(2), 4.5);
});

test('magnitude styling clamps below and above the configured range', () => {
  assert.deepEqual(colorForMag(-5), [...STOPS[0].color]);
  assert.deepEqual(colorForMag(12), [...STOPS[2].color]);
  assert.equal(radiusForMag(-5), 3);
  assert.equal(radiusForMag(12), 14);
});
