import assert from 'node:assert/strict';
import test from 'node:test';
import { equirectangularScreenPosition } from './map.ts';

test('equirectangular world projection maps the geographic bounds to canvas edges', () => {
  assert.deepEqual(equirectangularScreenPosition(-180, 90, 360, 180), [0, 0]);
  assert.deepEqual(equirectangularScreenPosition(180, -90, 360, 180), [360, 180]);
});

test('equator and prime meridian map to the canvas center', () => {
  assert.deepEqual(equirectangularScreenPosition(0, 0, 800, 600), [400, 300]);
});
