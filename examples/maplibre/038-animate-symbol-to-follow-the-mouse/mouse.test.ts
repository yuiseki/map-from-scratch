import assert from 'node:assert/strict';
import test from 'node:test';
import { screenToLngLatInLayout } from './mouse.ts';

test('mouse screen coordinates invert the fitted world projection', () => {
  assert.deepEqual(screenToLngLatInLayout(500, 300, 1000, 0, -200), [0, 0]);
  assert.deepEqual(screenToLngLatInLayout(0, -200, 1000, 0, -200), [-180, 85.048]);
  assert.deepEqual(screenToLngLatInLayout(1000, 800, 1000, 0, -200), [180, -85.048]);
});
