import assert from 'node:assert/strict';
import test from 'node:test';
import { fitMercatorLine } from './line.ts';

test('LineString camera centers the route and fits it inside the padded viewport', () => {
  const view = fitMercatorLine(0.2, 0.1, 0.3, 0.3, 1000, 800, 20);
  assert.deepEqual([view.x, view.y], [0.25, 0.2]);
  assert.ok(Math.abs(view.zoom - Math.log2(3800 / 256)) < 1e-12);
});

test('LineString fitting honors the minimum and maximum zoom', () => {
  assert.equal(fitMercatorLine(0, 0, 10, 10, 800, 600, 20).zoom, 1);
  assert.equal(fitMercatorLine(0, 0, 1e-7, 1e-7, 800, 600, 20).zoom, 20);
});
