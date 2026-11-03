import assert from 'node:assert/strict';
import test from 'node:test';
import { mercX, mercY } from './static-map.ts';

test('static map uses the same world coordinates without requiring interactions', () => {
  assert.deepEqual([mercX(0), mercY(0)], [0.5, 0.5]);
  assert.ok(mercY(40) < 0.5);
  assert.ok(mercY(-40) > 0.5);
});
