import assert from 'node:assert/strict';
import test from 'node:test';
import { scatterRadiusPixels } from './map.ts';

test('scatterplot point radius is fixed in ground metres for every weight', () => {
  assert.equal(scatterRadiusPixels(1, 40.75, 12), scatterRadiusPixels(2, 40.75, 12));
});

test('scatterplot radius doubles at the next zoom level', () => {
  const radius = scatterRadiusPixels(1, 40.75, 12);
  assert.ok(Math.abs(scatterRadiusPixels(1, 40.75, 13) - radius * 2) < 1e-10);
});
