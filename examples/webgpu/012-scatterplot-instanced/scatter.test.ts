import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePoints, mercatorToScreen, weightToColor, circleCoverage } from './scatter.ts';

test('decodePoints parses 16-byte Float32Array records', () => {
  const count = 3;
  const buf = new ArrayBuffer(count * 16);
  const view = new Float32Array(buf);
  // Point 0:
  view[0] = 0.25;  // mercator x
  view[1] = 0.35;  // mercator y
  view[2] = 1.0;   // weight
  view[3] = 0.0;   // spare

  // Point 1:
  view[4] = 0.50;
  view[5] = 0.50;
  view[6] = 2.0;
  view[7] = 0.0;

  // Point 2:
  view[8] = 0.75;
  view[9] = 0.85;
  view[10] = 1.5;
  view[11] = 0.0;

  const points = decodePoints(buf);
  assert.equal(points.length, count);
  assert.ok(Math.abs(points[0].x - 0.25) < 1e-6);
  assert.ok(Math.abs(points[0].y - 0.35) < 1e-6);
  assert.equal(points[0].weight, 1.0);

  assert.ok(Math.abs(points[1].x - 0.50) < 1e-6);
  assert.equal(points[1].weight, 2.0);
});

test('decodePoints rejects buffers whose length is not a multiple of 16', () => {
  const invalidBuf = new ArrayBuffer(25);
  assert.throws(() => decodePoints(invalidBuf), /buffer length must be a multiple of 16/);
});

test('mercatorToScreen correctly maps center to view center', () => {
  const center: [number, number] = [0.5, 0.5];
  const zoom = 10;
  const screen = mercatorToScreen(0.5, 0.5, center, zoom, 1280, 800);
  assert.equal(screen.x, 640);
  assert.equal(screen.y, 400);

  // An offset of 1 / (256 * 2^10) should correspond to 1 pixel
  const worldPx = 256 * Math.pow(2, zoom);
  const offset = 1 / worldPx;
  const offsetScreen = mercatorToScreen(0.5 + offset, 0.5, center, zoom, 1280, 800);
  assert.equal(Math.round(offsetScreen.x), 641);
});

test('weightToColor assigns blue for weight 1 and amber for weight 2', () => {
  const c1 = weightToColor(1.0);
  // Blue: r < 0.3, b > 0.8
  assert.ok(c1[0] < 0.3 && c1[2] > 0.8);

  const c2 = weightToColor(2.0);
  // Amber / Orange: r > 0.8, g > 0.5, b < 0.4
  assert.ok(c2[0] > 0.8 && c2[1] > 0.5 && c2[2] < 0.4);
});

test('circleCoverage evaluates analytic antialiasing curve', () => {
  const radius = 10.0;
  const smooth = 1.0;

  // Fully inside: coverage = 1
  assert.equal(circleCoverage(5.0, radius, smooth), 1.0);

  // Exactly at boundary: coverage ~ 0.5
  const edge = circleCoverage(10.0, radius, smooth);
  assert.ok(edge >= 0.0 && edge <= 0.6);

  // Outside smooth boundary: coverage = 0
  assert.equal(circleCoverage(11.5, radius, smooth), 0.0);
});
