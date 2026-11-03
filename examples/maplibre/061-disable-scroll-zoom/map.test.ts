import assert from 'node:assert/strict';
import test from 'node:test';
import { wheelZoomTarget } from './map.ts';

test('enabled wheel zoom advances inward or outward by one quarter level', () => {
  assert.equal(wheelZoomTarget(4, -1), 4.25);
  assert.equal(wheelZoomTarget(4, 1), 3.75);
  assert.equal(wheelZoomTarget(4, 0), 3.75);
});
