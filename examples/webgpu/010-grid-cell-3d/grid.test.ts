import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnitCubeMesh, decodeGridCells, gridToWorld, treeDensityColor } from './grid.ts';

test('gridToWorld maps integer cell indices to meters at the cell corner', () => {
  assert.deepEqual(gridToWorld(0, 0, 100), [0, 0]);
  assert.deepEqual(gridToWorld(5, -3, 200), [1000, -600]);
});

test('createUnitCubeMesh generates 30 vertices with correct normal components', () => {
  const mesh = createUnitCubeMesh();
  assert.equal(mesh.length, 30 * 6); // 30 vertices * 6 floats (pos: 3, normal: 3)

  // Verify top surface vertices have normal [0, 0, 1]
  for (let i = 0; i < 6; i++) {
    const nx = mesh[i * 6 + 3];
    const ny = mesh[i * 6 + 4];
    const nz = mesh[i * 6 + 5];
    assert.equal(nx, 0);
    assert.equal(ny, 0);
    assert.equal(nz, 1);
  }
});

test('treeDensityColor maps count to smooth gradient and non-zero alpha', () => {
  assert.deepEqual(treeDensityColor(0, 100), [0.2, 0.4, 0.3, 0.8]); // empty cell
  const c1 = treeDensityColor(1, 100);
  const cMid = treeDensityColor(50, 100);
  const cMax = treeDensityColor(100, 100);

  // The top of the log scale is the last stop of the gradient.
  [0.29, 0.13, 0.95, 0.92].forEach((v, i) => assert.ok(Math.abs(cMax[i] - v) < 1e-9, `cMax[${i}]`));
  // Blue grows with density through the middle of the gradient.
  assert.ok(c1[2] < cMid[2] && cMid[2] < cMax[2]);
  assert.ok(c1[3] > 0);
  // No jumps at the stops: neighbouring counts get nearly the same colour.
  // From 10 up the log scale moves less than 0.01 per count, across both stops.
  for (let n = 10; n < 100000; n++) {
    const a = treeDensityColor(n, 100000), b = treeDensityColor(n + 1, 100000);
    assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 0.05), `count ${n}`);
  }
});

test('decodeGridCells parses GC01 binary buffer correctly', () => {
  const cellCount = 2;
  const cellSize = 256;
  const buffer = new ArrayBuffer(12 + cellCount * 8);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // 'GC01'
  u8[0] = 71; u8[1] = 67; u8[2] = 48; u8[3] = 49;
  view.setUint32(4, cellCount, true);
  view.setUint32(8, cellSize, true);

  // Cell 0: ix=10, iy=-5, count=42, quantile=3
  view.setInt16(12, 10, true);
  view.setInt16(14, -5, true);
  view.setUint16(16, 42, true);
  view.setUint16(18, 3, true);

  // Cell 1: ix=-2, iy=8, count=120, quantile=5
  view.setInt16(20, -2, true);
  view.setInt16(22, 8, true);
  view.setUint16(24, 120, true);
  view.setUint16(26, 5, true);

  const decoded = decodeGridCells(buffer);
  assert.equal(decoded.count, 2);
  assert.equal(decoded.size, 256);
  assert.equal(decoded.cells.length, 2);
  assert.deepEqual(decoded.cells[0], { ix: 10, iy: -5, count: 42, quantile: 3 });
  assert.deepEqual(decoded.cells[1], { ix: -2, iy: 8, count: 120, quantile: 5 });
});
