import assert from 'node:assert/strict';
import test from 'node:test';
import { LuxembourgRailMap } from './map.ts';

test('Luxembourg map projects its Mercator center to the canvas center', () => {
  const map = Object.create(LuxembourgRailMap.prototype) as LuxembourgRailMap;
  Object.assign(map, {
    canvas: { width: 800, height: 600 }, dpr: 1, zoom: 10,
    center: { lon: 6.13, lat: 49.8 },
  });
  const mx = (map.center.lon + 180) / 360;
  const my = (1 - Math.log(Math.tan(Math.PI / 4 + map.center.lat * Math.PI / 360)) / Math.PI) / 2;
  assert.deepEqual(map.getScreenCoords(mx, my), { x: 400, y: 300 });
  const east = map.getScreenCoords(mx + 1 / (256 * 2 ** map.zoom), my);
  assert.deepEqual(east, { x: 401, y: 300 });
});
