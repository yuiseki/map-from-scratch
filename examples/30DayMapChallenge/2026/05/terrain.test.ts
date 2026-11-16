import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeElevationGrid, makeGridIndices, type TerrainGrid } from './terrain.ts';

test('FJT1 stores a rectangular elevation grid with reversible quantized endpoints', () => {
  const grid: TerrainGrid = { width: 2, height: 2, elevations: [10, 20, 30, 40] };
  const encoded = encodeElevationGrid(grid);
  const view = new DataView(encoded);
  assert.equal(String.fromCharCode(...new Uint8Array(encoded, 0, 4)), 'FJT1');
  assert.equal(view.getUint16(4, true), 2);
  assert.equal(view.getUint16(6, true), 2);
  assert.equal(view.getFloat32(8, true), 10);
  assert.equal(view.getFloat32(12, true), 40);
  assert.equal(view.getUint32(16, true), 4);
  assert.equal(view.getUint16(20, true), 0);
  assert.equal(view.getUint16(26, true), 65535);
  assert.equal(encoded.byteLength, 28);
});

test('FJT1 rejects missing, non-finite and degenerate elevation grids', () => {
  assert.throws(() => encodeElevationGrid({ width: 2, height: 2, elevations: [1, 2, 3] }), /count/);
  assert.throws(() => encodeElevationGrid({ width: 2, height: 2, elevations: [1, 2, 3, Number.NaN] }), /finite/);
  assert.throws(() => encodeElevationGrid({ width: 1, height: 2, elevations: [1, 2] }), /dimensions/);
});

test('grid indices create two consistently wound triangles for every adjacent cell', () => {
  assert.deepEqual([...makeGridIndices(2, 2)], [0, 2, 1, 1, 2, 3]);
  const large = makeGridIndices(256, 256);
  assert.equal(large.length, 255 * 255 * 6);
  assert.equal(Math.max(...large.slice(-6)), 65535);
});
