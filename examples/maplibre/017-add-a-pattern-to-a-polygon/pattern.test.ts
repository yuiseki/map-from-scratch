import assert from 'node:assert/strict';
import test from 'node:test';
import { tileKey, wrappedTileX } from './pattern.ts';

test('pattern raster base wraps x tile coordinates across the world edge', () => {
  assert.equal(wrappedTileX(-1, 16), 15);
  assert.equal(wrappedTileX(16, 16), 0);
  assert.equal(tileKey(4, wrappedTileX(-1, 16), 3), '4/15/3');
});
