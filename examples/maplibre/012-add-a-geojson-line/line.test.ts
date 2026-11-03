import assert from 'node:assert/strict';
import test from 'node:test';
import { tileKey, wrappedTileX } from './line.ts';

test('raster tile x wraps in both directions at the antimeridian', () => {
  assert.equal(wrappedTileX(0, 8), 0);
  assert.equal(wrappedTileX(8, 8), 0);
  assert.equal(wrappedTileX(-1, 8), 7);
  assert.equal(wrappedTileX(17, 8), 1);
});

test('tile keys preserve z/x/y address order', () => {
  assert.equal(tileKey(12, 2048, 1362), '12/2048/1362');
});
