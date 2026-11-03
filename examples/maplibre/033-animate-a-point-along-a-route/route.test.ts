import assert from 'node:assert/strict';
import test from 'node:test';
import { nextRouteStep } from './route.ts';

test('route animation advances one point and wraps after its final sample', () => {
  assert.equal(nextRouteStep(0, 3), 1);
  assert.equal(nextRouteStep(2, 3), 3);
  assert.equal(nextRouteStep(3, 3), 0);
});
