import assert from 'node:assert/strict';
import test from 'node:test';
import { BillboardMap } from './map.ts';

test('billboard coordinates project around the camera center in CSS pixels', () => {
  const map = Object.create(BillboardMap.prototype) as BillboardMap;
  Object.assign(map, { canvas: { width: 800, height: 600 }, dpr: 1, zoom: 2, center: { lon: 0, lat: 0 } });
  assert.deepEqual(map.getScreenCoords(0, 0), { x: 400, y: 300 });
  const east = map.getScreenCoords(10, 0);
  assert.ok(east.x > 400);
  assert.equal(east.y, 300);
});
