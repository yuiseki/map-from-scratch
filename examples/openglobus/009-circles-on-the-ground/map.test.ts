import assert from 'node:assert/strict';
import test from 'node:test';
import { CirclesMap } from './map.ts';

function mapAt(zoom: number): CirclesMap {
  const map = Object.create(CirclesMap.prototype) as CirclesMap;
  Object.assign(map, {
    canvas: { width: 800, height: 600 }, dpr: 1, zoom, center: { lon: 0, lat: 0 },
    circles: [{ name: 'unit', lon: 0, lat: 0, radiusM: 1, color: '#ffffff',
      ring: [[0.5, 0.5], [0.5, 0.51], [0.51, 0.5], [0.5, 0.49]] }],
  });
  return map;
}

test('circle screen radius derives from projected ring points and scales with zoom', () => {
  const radius = mapAt(2).circleRadiusPx('unit');
  assert.ok(Math.abs(radius - 5.12) < 1e-10);
  assert.ok(Math.abs(mapAt(3).circleRadiusPx('unit') - radius * 2) < 1e-10);
});

test('unknown circle names have no rendered radius', () => {
  assert.equal(mapAt(2).circleRadiusPx('missing'), 0);
});
