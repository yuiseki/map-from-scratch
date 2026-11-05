import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyValue,
  decodeQuarterMesh,
  enumerateMeshLattice,
  materializeNullCells,
  type GeographicBounds,
} from './nullmap.ts';

test('classification keeps missing rows, suppressed values, zero, and positive counts distinct', () => {
  assert.equal(classifyValue(undefined), 'missing');
  assert.equal(classifyValue('*'), 'suppressed');
  assert.equal(classifyValue('0'), 'zero');
  assert.equal(classifyValue('12'), 'positive');
  assert.throws(() => classifyValue(' 0'), /invalid/);
  assert.throws(() => classifyValue('Y'), /invalid/);
});

test('a decoded 250 m quarter mesh has the JIS dimensions and Tokyo location', () => {
  const cell = decodeQuarterMesh('5339456712');
  assert.ok(cell.longitude >= 139.7 && cell.longitude <= 139.8);
  assert.ok(cell.latitude >= 35.7 && cell.latitude <= 35.8);
  assert.ok(Math.abs((cell.north - cell.south) - 0.125 / 60) < 1e-10);
  assert.ok(Math.abs((cell.east - cell.west) - 0.1875 / 60) < 1e-10);
});

test('the expected lattice has unique quarter-mesh codes and is clipped by cell centers', () => {
  const oneCell = decodeQuarterMesh('5339456712');
  const bounds: GeographicBounds = {
    west: oneCell.west, east: oneCell.east,
    south: oneCell.south, north: oneCell.north,
  };
  const lattice = enumerateMeshLattice(bounds);
  assert.equal(lattice.length, 1);
  assert.equal(lattice[0]?.code, '5339456712');
  assert.deepEqual(new Set(lattice.map((cell) => cell.code)).size, lattice.length);
});

test('materialization fills only absent lattice codes as missing and preserves source states', () => {
  const anchor = decodeQuarterMesh('5339456712');
  const bounds: GeographicBounds = {
    west: anchor.west, east: anchor.east + 0.1875 / 60,
    south: anchor.south, north: anchor.north,
  };
  const lattice = enumerateMeshLattice(bounds);
  assert.equal(lattice.length, 2);
  const cells = materializeNullCells(bounds, [
    { code: lattice[0]!.code, rawValue: '0' },
    { code: lattice[1]!.code, rawValue: '*' },
  ]);
  assert.deepEqual(cells.map((cell) => cell.status), ['zero', 'suppressed']);

  const withAbsent = materializeNullCells(bounds, [{ code: lattice[0]!.code, rawValue: '8' }]);
  assert.deepEqual(withAbsent.map((cell) => cell.status), ['positive', 'missing']);
  assert.equal(withAbsent[1]?.value, null);
  assert.throws(() => materializeNullCells(bounds, [
    { code: lattice[0]!.code, rawValue: '1' },
    { code: lattice[0]!.code, rawValue: '2' },
  ]), /duplicate/);
});
