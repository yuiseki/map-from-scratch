import assert from 'node:assert/strict';
import test from 'node:test';
import { mercX, mercY } from './polygon.ts';

test('hover polygon coordinates project with longitude increasing right and latitude decreasing down', () => {
  assert.deepEqual([mercX(0), mercY(0)], [0.5, 0.5]);
  assert.ok(mercX(90) > mercX(-90));
  assert.ok(mercY(45) < mercY(-45));
});
