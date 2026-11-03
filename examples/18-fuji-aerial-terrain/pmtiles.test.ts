import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directory, find, tileId } from './pmtiles.ts';

test('PMTiles directory reconstructs tile ids and implicit consecutive tile offsets', () => {
  const entries = directory(Uint8Array.of(2, 1, 2, 1, 0, 4, 6, 1, 0));
  assert.deepEqual(entries, [
    { id: 1, run: 1, length: 4, offset: 0 },
    { id: 3, run: 0, length: 6, offset: 4 },
  ]);
  assert.equal(find(entries, 3), entries[1]);
  assert.equal(find(entries, 99), entries[1]);
  assert.equal(find(entries, 0), null);
});

test('regional archive tile addressing is unique and Hilbert ordered', () => {
  const ids = Array.from({ length: 16 }, (_, i) => tileId(2, i % 4, Math.floor(i / 4)));
  assert.equal(new Set(ids).size, 16);
  assert.deepEqual([tileId(1, 0, 0), tileId(1, 0, 1), tileId(1, 1, 1), tileId(1, 1, 0)], [1, 2, 3, 4]);
});
