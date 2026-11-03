import assert from 'node:assert/strict';
import test from 'node:test';
import { easeInOutQuadratic } from './symbol.ts';

test('camera flight easing starts and ends at its target with a symmetric midpoint', () => {
  assert.equal(easeInOutQuadratic(0), 0);
  assert.equal(easeInOutQuadratic(0.25), 0.125);
  assert.equal(easeInOutQuadratic(0.5), 0.5);
  assert.equal(easeInOutQuadratic(0.75), 0.875);
  assert.equal(easeInOutQuadratic(1), 1);
});
