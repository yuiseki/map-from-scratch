import assert from 'node:assert/strict';
import test from 'node:test';
import { mercX, mercY } from './polygon.ts';

test('button-colored polygon map uses normalized Web Mercator coordinates', () => {
  assert.deepEqual([mercX(0), mercY(0)], [0.5, 0.5]);
  assert.equal(mercX(-180), 0);
  assert.equal(mercX(180), 1);
  assert.ok(mercY(45) < 0.5 && mercY(-45) > 0.5);
});
