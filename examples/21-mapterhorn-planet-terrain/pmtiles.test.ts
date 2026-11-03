import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directory, find, tileId } from './pmtiles.ts';

test('regional PMTiles directories preserve run entries and offset deltas', () => {
  const entries = directory(Uint8Array.of(2, 1, 2, 1, 0, 4, 6, 1, 0));
  assert.deepEqual(entries, [
    { id: 1, run: 1, length: 4, offset: 0 },
    { id: 3, run: 0, length: 6, offset: 4 },
  ]);
  assert.equal(find(entries, 1), entries[0]);
  assert.equal(find(entries, 2), entries[0]);
  assert.equal(find(entries, 3), entries[1]);
  assert.equal(find(entries, 0), null);
});

test('PMTiles z/x/y addresses use distinct Hilbert tile ids', () => {
  const ids = Array.from({ length: 64 }, (_, i) => tileId(3, i % 8, Math.floor(i / 8)));
  assert.equal(new Set(ids).size, 64);
  assert.deepEqual([tileId(1, 0, 0), tileId(1, 0, 1), tileId(1, 1, 1), tileId(1, 1, 0)], [1, 2, 3, 4]);
});
