import assert from 'node:assert/strict';
import test from 'node:test';
import { splitViewport } from './comparison.ts';

test('comparison gives both projections equal, non-overlapping panels', () => {
  assert.deepEqual(splitViewport(1001, 600), [[0, 0, 500, 600], [501, 0, 500, 600]]);
});
