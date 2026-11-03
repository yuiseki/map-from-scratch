import assert from 'node:assert/strict';
import test from 'node:test';
import { mercX, mercY } from './map.ts';

test('interactive map starts from the normalized Web Mercator coordinate system', () => {
  assert.deepEqual([mercX(0), mercY(0)], [0.5, 0.5]);
  assert.equal(mercX(-180), 0);
  assert.equal(mercX(180), 1);
});
