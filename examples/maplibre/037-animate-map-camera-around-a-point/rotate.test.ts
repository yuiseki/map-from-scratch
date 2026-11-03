import assert from 'node:assert/strict';
import test from 'node:test';
import { nextBearing } from './rotate.ts';

test('camera rotation advances by its default step and wraps at 360 degrees', () => {
  assert.equal(nextBearing(0), 0.5);
  assert.equal(nextBearing(359.5), 0);
  assert.equal(nextBearing(120, 30), 150);
});
