import assert from 'node:assert/strict';
import test from 'node:test';
import { pointHit } from './point.ts';

test('draggable point hit test uses the circular 14-pixel interaction radius', () => {
  assert.equal(pointHit(0, 0, 0, 0), true);
  assert.equal(pointHit(14, 0, 0, 0), true);
  assert.equal(pointHit(0, -14, 0, 0), true);
  assert.equal(pointHit(14.01, 0, 0, 0), false);
});
