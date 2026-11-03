import assert from 'node:assert/strict';
import test from 'node:test';
import { constrainMercatorCenter, minZoomForMercatorBounds } from './bounds.ts';

const bounds = { west: 0.2, east: 0.4, north: 0.3, south: 0.5 };

test('restricted camera keeps the viewport inside bounds when it can fit', () => {
  const center = constrainMercatorCenter(0.9, -0.2, 4, 800, 600, bounds);
  const halfWidth = 800 / (2 * 256 * 2 ** 4);
  const halfHeight = 600 / (2 * 256 * 2 ** 4);
  assert.ok(center.x >= bounds.west + halfWidth && center.x <= bounds.east - halfWidth);
  assert.ok(center.y >= bounds.north + halfHeight && center.y <= bounds.south - halfHeight);
});

test('restricted camera centers bounds on axes where viewport is larger', () => {
  const center = constrainMercatorCenter(9, -9, 1, 800, 600, bounds);
  assert.ok(Math.abs(center.x - 0.3) < 1e-12);
  assert.ok(Math.abs(center.y - 0.4) < 1e-12);
});

test('minimum zoom fits both viewport dimensions within the bounds', () => {
  const zoom = minZoomForMercatorBounds(bounds, 800, 600);
  const scale = 256 * 2 ** zoom;
  assert.ok(scale * (bounds.east - bounds.west) >= 800 - 1e-8);
  assert.ok(scale * (bounds.south - bounds.north) >= 600 - 1e-8);
});
