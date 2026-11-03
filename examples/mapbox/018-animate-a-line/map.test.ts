import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceLineProgress } from './map.ts';

test('animated line reveals more route until the complete line is visible', () => {
  assert.equal(advanceLineProgress(0, 0.005), 0.005);
  assert.equal(advanceLineProgress(0.995, 0.005), 1);
});

test('animated line returns to the start after progress passes one', () => {
  assert.equal(advanceLineProgress(1, 0.005), 0);
});
