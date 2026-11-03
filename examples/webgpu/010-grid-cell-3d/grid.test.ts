import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnitCubeMesh, decodeGridCells, gridToWorld, treeDensityColor } from './grid.ts';

test('gridToWorld maps integer cell indices to meters centered on cell', () => {
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
  const c0 = treeDensityColor(0, 100);
  const cMid = treeDensityColor(50, 100);
  const cMax = treeDensityColor(100, 100);

  assert.equal(c0.length, 4);
  assert.equal(cMax.length, 4);
  assert.ok(c0[3] > 0);
  assert.ok(cMax[3] > 0);
  // High density should have more blue/cyan than low density
  assert.ok(cMax[2] > c0[2]);
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
