import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWeightedPoints } from '../011-heatmap-layer/weighted-points.ts';

test('screen grid accepts its baked header and exposes point count and weights', () => {
  const buffer = new ArrayBuffer(38);
  const view = new DataView(buffer);
  view.setUint32(0, 0x31304753, true); view.setUint32(4, 1, true); view.setUint32(24, 9, true);
  const grid = parseWeightedPoints(buffer, 0x31304753, 'screen grid');
  assert.equal(grid.count, 1);
  assert.equal(grid.totalWeight, 9);
  assert.deepEqual(grid.bounds, [0, 0, 0, 0]);
});
