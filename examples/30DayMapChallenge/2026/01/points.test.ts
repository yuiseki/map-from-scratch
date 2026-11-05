import assert from 'node:assert/strict';
import test from 'node:test';
import { depthColor, encodePoints, markerRadius, projectPoint } from './points.ts';

test('Equal Earth point projection places east to the right and north above', () => {
  const origin = projectPoint(0, 0, 1200, 800);
  const east = projectPoint(90, 0, 1200, 800);
  const north = projectPoint(0, 60, 1200, 800);
  assert.ok(east[0] > origin[0]);
  assert.ok(north[1] < origin[1]);
  assert.ok(Math.abs(origin[0] - 600) < 1);
  assert.ok(Math.abs(origin[1] - 400) < 1);
});

test('magnitude makes a bounded, monotonically larger point symbol', () => {
  const radii = [4.5, 5, 6, 7, 9].map(markerRadius);
  assert.ok(radii.every((r, i) => i === 0 || r > radii[i - 1]));
  assert.equal(markerRadius(4.5), 2);
  assert.equal(markerRadius(10), 14);
});

test('depth colors distinguish shallow, intermediate, and deep earthquakes', () => {
  assert.equal(depthColor(20), '#ff624d');
  assert.equal(depthColor(70), '#ffc857');
  assert.equal(depthColor(300), '#ffc857');
  assert.equal(depthColor(150), '#ffc857');
  assert.equal(depthColor(500), '#67b7ff');
});

test('GPU point records carry quantized positions, size, and depth class in magnitude order', () => {
  const points = encodePoints([
    { lon: 95.9363, lat: 22.011, magnitude: 7.7, depthKm: 10 },
    { lon: -70, lat: -20, magnitude: 5, depthKm: 180 },
  ]);
  const view = new DataView(points);
  assert.equal(view.getUint32(0, true), 2);
  assert.equal(points.byteLength, 20);
  assert.ok(view.getUint8(4 + 8 + 4) > view.getUint8(4 + 4));
  assert.equal(view.getUint8(4 + 8 + 5), 0);
  assert.equal(view.getUint8(4 + 5), 1);
  const myanmarX = view.getUint16(4 + 8, true) / 65535;
  assert.ok(Math.abs(myanmarX - 0.757) < 0.002);
});
