import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyPopulation,
  cellCenterInPolygon,
  decodeQuarterMesh,
  featureAtScreenPoint,
  includeInArea,
  encodeQuarterMesh,
  populationForMesh,
  projectCellForGpu,
  type CensusCell,
  type PolygonRings,
} from './mesh.ts';

test('decodes the documented 10 digit quarter-mesh code into exact bounds', () => {
  const cell = decodeQuarterMesh('5339451411');
  assert.ok(cell);
  assert.ok(Math.abs(cell.west - 139.675) < 1e-10);
  assert.ok(Math.abs(cell.south - 35.675) < 1e-10);
  assert.ok(Math.abs(cell.east - (139.675 + 11.25 / 3600)) < 1e-10);
  assert.ok(Math.abs(cell.north - (35.675 + 7.5 / 3600)) < 1e-10);
  assert.equal(decodeQuarterMesh('5339451499'), null);
  assert.equal(decodeQuarterMesh('533945141'), null);
});

test('neighboring sub-meshes share exact edges and do not overlap', () => {
  const southwest = decodeQuarterMesh('5339451411');
  const southeast = decodeQuarterMesh('5339451412');
  const northwest = decodeQuarterMesh('5339451413');
  assert.ok(southwest && southeast && northwest);
  assert.equal(southwest.east, southeast.west);
  assert.equal(southwest.north, northwest.south);
  assert.ok(southwest.south < southwest.north);
  assert.ok(southwest.west < southwest.east);
});

test('encoding an interior coordinate round-trips to its exact quarter mesh', () => {
  const code = encodeQuarterMesh(139.676, 35.676);
  assert.equal(code, '5339451411');
  assert.deepEqual(decodeQuarterMesh(code!), decodeQuarterMesh('5339451411'));
});

test('keeps positive, explicit zero and suppressed values as distinct states', () => {
  assert.deepEqual(classifyPopulation('17'), { status: 'count', value: 17 });
  assert.deepEqual(classifyPopulation('0'), { status: 'zero', value: 0 });
  assert.deepEqual(classifyPopulation('*'), { status: 'suppressed', value: null });
  assert.deepEqual(classifyPopulation(''), { status: 'unavailable', value: null });
  assert.deepEqual(classifyPopulation('Y'), { status: 'unavailable', value: null });
  assert.deepEqual(populationForMesh(false, undefined), { status: 'no-row', value: null });
  assert.deepEqual(populationForMesh(true, '*'), { status: 'suppressed', value: null });
  assert.notDeepEqual(populationForMesh(false, undefined), populationForMesh(true, '0'));
});

test('area filtering selects only cells with positive-area intersection', () => {
  const cell = decodeQuarterMesh('5339451411');
  assert.ok(cell);
  assert.equal(includeInArea(cell, [139.675, 35.675, 139.679, 35.679]), true);
  assert.equal(includeInArea(cell, [139.678, 35.675, 139.681, 35.679]), true);
  assert.equal(includeInArea(cell, [cell.east, 35.675, 139.681, 35.679]), false);
  assert.equal(includeInArea(cell, [139.679, 35.675, 139.681, 35.679]), false);
});

test('selected-area inclusion is decided by polygon centroid and excludes holes', () => {
  const cell = decodeQuarterMesh('5339451411');
  assert.ok(cell);
  const outer = [[139.67, 35.67], [139.69, 35.67], [139.69, 35.69], [139.67, 35.69], [139.67, 35.67]] as [number, number][];
  const hole = [[139.675, 35.675], [139.678, 35.675], [139.678, 35.678], [139.675, 35.678], [139.675, 35.675]] as [number, number][];
  assert.equal(cellCenterInPolygon(cell, [outer]), true);
  assert.equal(cellCenterInPolygon(cell, [outer, hole]), false);
});

test('mesh centroid on the transformed municipal boundary is included', () => {
  // Bake transforms JGD2000 EPSG:4612 to the census JGD2011 EPSG:6668 first.
  const boundary = [[[139.75, 35.68], [139.76, 35.68], [139.76, 35.69], [139.75, 35.69], [139.75, 35.68]]] as PolygonRings;
  const edgeCenteredCell = { west: 139.75, east: 139.76, south: 35.675, north: 35.685 };
  assert.equal(cellCenterInPolygon(edgeCenteredCell, boundary), true);
});

test('GPU projection classifies source-backed cells and marks off-screen cells invisible', () => {
  const cell: CensusCell = {
    code: '5339451411',
    bounds: decodeQuarterMesh('5339451411')!,
    status: 'count',
    value: 120,
  };
  const projected = projectCellForGpu(cell, [139.675, 35.675, 139.69, 35.69], 600, 600, [0, 2, 10, 30]);
  assert.equal(projected.visible, true);
  assert.equal(projected.classIndex, 6);
  const hidden = projectCellForGpu(cell, [140, 36, 141, 37], 600, 600, [0, 2, 10, 30]);
  assert.equal(hidden.visible, false);
  assert.equal(hidden.classIndex, 6);
});

test('picking resolves a source feature index from screen-space rectangles', () => {
  const cells: CensusCell[] = [
    { code: 'a', bounds: { west: 0, south: 0, east: 1, north: 1 }, status: 'zero', value: 0 },
    { code: 'b', bounds: { west: 1, south: 0, east: 2, north: 1 }, status: 'suppressed', value: 0 },
  ];
  assert.equal(featureAtScreenPoint(cells, [{ x: 0, y: 0, width: 50, height: 50 }, { x: 50, y: 0, width: 50, height: 50 }], 75, 25), 1);
  assert.equal(featureAtScreenPoint(cells, [{ x: 0, y: 0, width: 50, height: 50 }, { x: 50, y: 0, width: 50, height: 50 }], 50, 25), 1);
  assert.equal(featureAtScreenPoint(cells, [{ x: 0, y: 0, width: 50, height: 50 }, { x: 50, y: 0, width: 50, height: 50 }], 120, 25), -1);
});
