import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCensusCells, serializeCensusCells, type CensusCell } from './mesh.ts';

test('serialized census cells retain raw values, status distinctions and source flags', () => {
  const cells: CensusCell[] = [
    { code: '5339451411', bounds: { west: 139.675, south: 35.675, east: 139.678125, north: 35.677083333333336 }, status: 'count', value: 9, rawValue: '9', source: { prefecture: '13', table: 'T001142', field: 'T001142004', HTKSYORI: '0', HTKSAKI: null, GASSAN: null } },
    { code: '5339451412', bounds: { west: 139.678125, south: 35.675, east: 139.68125, north: 35.677083333333336 }, status: 'zero', value: 0, rawValue: '0', source: { prefecture: '13', table: 'T001142', field: 'T001142004', HTKSYORI: '0', HTKSAKI: null, GASSAN: null } },
    { code: '5339451413', bounds: { west: 139.675, south: 35.677083333333336, east: 139.678125, north: 35.67916666666667 }, status: 'suppressed', value: null, rawValue: '*', source: { prefecture: '13', table: 'T001142', field: 'T001142004', HTKSYORI: '2', HTKSAKI: '5339451414', GASSAN: '' } },
    { code: '5339451414', bounds: { west: 139.678125, south: 35.677083333333336, east: 139.68125, north: 35.67916666666667 }, status: 'no-row', value: null, rawValue: null, source: null },
  ];
  const restored = parseCensusCells(serializeCensusCells(cells));
  assert.deepEqual(restored, cells);
  assert.notEqual(restored[2].status, restored[3].status);
  assert.equal(restored[2].rawValue, '*');
  assert.equal(restored[2].source?.HTKSYORI, '2');
});

test('serialized cell validation rejects changed geometry or a suppression converted to zero', () => {
  const cell: CensusCell = {
    code: '5339451411',
    bounds: { west: 0, south: 0, east: 1, north: 1 },
    status: 'suppressed', value: 0, rawValue: '*', source: null,
  };
  assert.throws(() => parseCensusCells(JSON.stringify([cell])), /mesh bounds/);
  const decoded = { ...cell, bounds: { west: 139.675, south: 35.675, east: 139.678125, north: 35.677083333333336 }, status: 'zero' };
  assert.throws(() => parseCensusCells(JSON.stringify([decoded])), /raw value/);
});
