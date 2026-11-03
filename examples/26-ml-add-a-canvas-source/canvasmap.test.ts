import assert from 'node:assert/strict';
import test from 'node:test';
import { merc, stops } from './canvasmap.ts';

test('Mercator projection maps the origin and clamps latitude at the world limit', () => {
  assert.deepEqual(merc(0, 0), [0.5, 0.5]);
  assert.equal(merc(180, 0)[0], 1);
  assert.deepEqual(merc(0, 90), merc(0, 85.0511));
  assert.deepEqual(merc(0, -90), merc(0, -85.0511));
});

test('style stops interpolate between zooms and clamp beyond the endpoints', () => {
  const s = [0, 2, 4, 10, 8, 18];
  assert.equal(stops(-1, s), 2);
  assert.equal(stops(2, s), 6);
  assert.equal(stops(6, s), 14);
  assert.equal(stops(20, s), 18);
});
