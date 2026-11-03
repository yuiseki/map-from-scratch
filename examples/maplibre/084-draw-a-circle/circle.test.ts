import assert from 'node:assert/strict';
import test from 'node:test';
import { mercX, mercY } from './circle.ts';

test('circle outlines use Web Mercator coordinates for their geographic vertices', () => {
  assert.deepEqual([mercX(0), mercY(0)], [0.5, 0.5]);
  assert.equal(mercX(-180), 0);
  assert.equal(mercX(180), 1);
  assert.ok(mercY(40) < 0.5);
});
