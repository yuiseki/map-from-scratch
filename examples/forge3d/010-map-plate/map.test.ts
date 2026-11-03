import assert from 'node:assert/strict';
import test from 'node:test';
import { MapPlate } from './map.ts';

test('map plate corrects the raster aspect for longitude shrinkage', () => {
  const plate = Object.create(MapPlate.prototype) as MapPlate;
  Object.assign(plate, { dem: { bounds: [138, 35, 139, 36] } });
  const aspect = (plate as unknown as { groundAspect: () => number }).groundAspect();
  assert.ok(Math.abs(aspect - 110.57 / (111.32 * Math.cos(35.5 * Math.PI / 180))) < 1e-12);
});

test('map plate uses a square fallback before DEM metadata is loaded', () => {
  const plate = Object.create(MapPlate.prototype) as MapPlate;
  Object.assign(plate, { dem: null });
  assert.equal((plate as unknown as { groundAspect: () => number }).groundAspect(), 1);
});
