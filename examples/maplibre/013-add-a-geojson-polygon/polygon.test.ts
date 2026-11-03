import assert from 'node:assert/strict';
import test from 'node:test';
import { mercX, mercY } from './polygon.ts';

test('polygon coordinates project to the normalized Web Mercator world', () => {
  assert.deepEqual([mercX(0), mercY(0)], [0.5, 0.5]);
  assert.equal(mercX(-180), 0);
  assert.equal(mercX(180), 1);
  assert.ok(mercY(45) < 0.5);
  assert.ok(mercY(-45) > 0.5);
});
