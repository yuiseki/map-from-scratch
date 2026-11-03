import assert from 'node:assert/strict';
import test from 'node:test';
import { fitMercatorBounds } from './fit.ts';

test('bounding-box camera centers the bounds and chooses the largest fit zoom', () => {
  const view = fitMercatorBounds(0.2, 0.3, 0.4, 0.5, 800, 600);
  assert.ok(Math.abs(view.x - 0.3) < 1e-12);
  assert.ok(Math.abs(view.y - 0.4) < 1e-12);
  assert.ok(Math.abs(view.zoom - Math.log2(3000 / 256)) < 1e-12);
});

test('bounding-box zoom stays within camera limits', () => {
  assert.equal(fitMercatorBounds(0, 0, 10, 10, 800, 600).zoom, 1);
  assert.equal(fitMercatorBounds(0, 0, 0.000001, 0.000001, 800, 600).zoom, 20);
});
