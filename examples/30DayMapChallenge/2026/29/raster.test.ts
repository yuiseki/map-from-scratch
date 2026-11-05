import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceTileRanges, splitRangeTiles, pixelWindowForBounds, pixelAtCoordinate, assembleWindow, elevationColor, serializeRasterView, parseRasterView } from './raster.ts';

const tiles = [
  { x: 0, y: 0, index: 0, offset: 100, byteCount: 2 },
  { x: 1, y: 0, index: 1, offset: 102, byteCount: 3 },
  { x: 0, y: 1, index: 2, offset: 120, byteCount: 1 },
];

test('coalesces adjacent compressed tile ranges without including gaps', () => {
  const spans = coalesceTileRanges(tiles);
  assert.deepEqual(spans.map(s => [s.start, s.end, s.tiles.map(t => t.index)]), [
    [100, 104, [0, 1]], [120, 120, [2]],
  ]);
});

test('splits one bounded range response back into its exact tile byte slices', () => {
  const [span] = coalesceTileRanges(tiles);
  const slices = splitRangeTiles(span!, new Uint8Array([1, 2, 3, 4, 5]));
  assert.deepEqual([...slices.get(0)!], [1, 2]);
  assert.deepEqual([...slices.get(1)!], [3, 4, 5]);
  assert.throws(() => splitRangeTiles(span!, new Uint8Array([1])), /length/i);
});

test('maps geographic bounds and pointer coordinates into north-up raster pixels', () => {
  const transform = [-180, 1 / 120, 0, 90, 0, -1 / 120] as const;
  assert.deepEqual(pixelWindowForBounds(transform, 43200, 21600, [138, 33, 147, 43]), { x: 38160, y: 5640, width: 1080, height: 1200 });
  assert.deepEqual(pixelAtCoordinate(transform, 43200, 21600, 138, 43), { x: 38160, y: 5640 });
  assert.equal(pixelAtCoordinate(transform, 43200, 21600, -181, 0), null);
});

test('assembles a raster window from decoded tiles and samples Float32 values', () => {
  const source = new Map<number, Float32Array>([
    [0, new Float32Array([1, 2, 3, 4])],
    [1, new Float32Array([5, 6, 7, 8])],
    [2, new Float32Array([9, 10, 11, 12])],
    [3, new Float32Array([13, 14, 15, 16])],
  ]);
  const result = assembleWindow({ width: 4, height: 4, tileWidth: 2, tileHeight: 2, columns: 2 }, { x: 1, y: 1, width: 2, height: 2 }, source);
  assert.deepEqual([...result], [4, 7, 10, 13]);
});

test('uses transparent nodata and distinct diverging colours around sea level', () => {
  assert.equal(elevationColor(-99999)[3], 0);
  assert.deepEqual(elevationColor(-5000), [36, 107, 141, 255]);
  assert.deepEqual(elevationColor(5000), [211, 176, 112, 255]);
});

test('round-trips serialized view state while rejecting invalid bounds', () => {
  const view = { bounds: [138, 33, 147, 43] as [number, number, number, number], selected: { lon: 141.2, lat: 38.1, value: -5234.75 } };
  assert.deepEqual(parseRasterView(serializeRasterView(view)), view);
  assert.throws(() => parseRasterView('{"bounds":[1,2,0,4]}'), /bounds/i);
});
