import assert from 'node:assert/strict';
import test from 'node:test';
import { TangramHighwaysMap } from './map.ts';

test('highway map converts Mercator world coordinates to canvas pixels', () => {
  const map = Object.create(TangramHighwaysMap.prototype) as TangramHighwaysMap;
  Object.assign(map, { canvas: { width: 640, height: 480 }, dpr: 1, zoom: 8, center: { lon: 0, lat: 0 } });
  assert.deepEqual(map.getScreenCoords(0.5, 0.5), { x: 320, y: 240 });
  assert.deepEqual(map.getScreenCoords(0.5 + 1 / (256 * 2 ** 8), 0.5), { x: 321, y: 240 });
});
