import assert from 'node:assert/strict';
import test from 'node:test';
import { TangramMap } from './map.ts';

test('simple Tangram map places its geographic center at the canvas center', () => {
  const map = Object.create(TangramMap.prototype) as TangramMap;
  Object.assign(map, { canvas: { width: 800, height: 600 }, dpr: 1, zoom: 3, center: { lon: 0, lat: 20 } });
  assert.deepEqual(map.getScreenCoords(0, 20), { x: 400, y: 300 });
  const east = map.getScreenCoords(45, 20);
  assert.ok(Math.abs(east.x - (400 + 256)) < 1e-9);
  assert.ok(Math.abs(east.y - 300) < 1e-9);
});
