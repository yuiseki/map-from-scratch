import assert from 'node:assert/strict';
import test from 'node:test';
import { VectorExportMap } from './map.ts';

test('vector export projects its center and finds station coordinates', () => {
  const map = Object.create(VectorExportMap.prototype) as VectorExportMap;
  Object.assign(map, {
    canvas: { width: 800, height: 600 }, dpr: 1, zoom: 10,
    center: { lon: 6.13, lat: 49.8 },
    data: { title: '', boundary: [], rails: [], stations: [
      { name: 'Central', pos: [0.5, 0.4] },
    ] },
  });
  const mx = (map.center.lon + 180) / 360;
  const my = (1 - Math.log(Math.tan(Math.PI / 4 + map.center.lat * Math.PI / 360)) / Math.PI) / 2;
  assert.deepEqual(map.screenPos(mx, my), [400, 300]);
  assert.deepEqual(map.stationScreen('Central'), map.screenPos(0.5, 0.4));
  assert.equal(map.stationScreen('Missing'), null);
});
