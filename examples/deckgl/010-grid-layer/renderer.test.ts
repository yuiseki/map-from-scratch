import assert from 'node:assert/strict';
import test from 'node:test';
import { gridSizes } from './renderer.ts';

test('tree grid levels descend by powers of two from regional to local detail', () => {
  assert.deepEqual([...gridSizes], [2048, 1024, 512, 256, 128, 64, 32, 16]);
  assert.ok(gridSizes.every((size, i) => i === 0 || gridSizes[i - 1] === size * 2));
});
