import assert from 'node:assert/strict';
import test from 'node:test';
import { attributionRect } from './attribution.ts';

test('attribution box keeps its fixed dimensions and margin in each selected corner', () => {
  assert.deepEqual(attributionRect(800, 600, 'top-left'), { x: 12, y: 12, width: 222, height: 28 });
  assert.deepEqual(attributionRect(800, 600, 'top-right'), { x: 566, y: 12, width: 222, height: 28 });
  assert.deepEqual(attributionRect(800, 600, 'bottom-left'), { x: 12, y: 560, width: 222, height: 28 });
  assert.deepEqual(attributionRect(800, 600, 'bottom-right'), { x: 566, y: 560, width: 222, height: 28 });
});
