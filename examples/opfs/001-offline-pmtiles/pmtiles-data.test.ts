import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDirectory, zxyToTileId } from './pmtiles-data.ts';

test('OPFS PMTiles Hilbert ids visit a zoom-one world in Hilbert order', () => {
  assert.deepEqual([
    zxyToTileId(1, 0, 0), zxyToTileId(1, 0, 1),
    zxyToTileId(1, 1, 1), zxyToTileId(1, 1, 0),
  ], [1, 2, 3, 4]);
});

test('OPFS directory decoder applies delta ids and consecutive offset shorthand', () => {
  const directory = parseDirectory(Uint8Array.from([2, 1, 2, 1, 0, 5, 3, 11, 0]));
  assert.deepEqual([...directory.entries()], [[1, { offset: 10, length: 5 }], [3, { offset: 15, length: 3 }]]);
});
