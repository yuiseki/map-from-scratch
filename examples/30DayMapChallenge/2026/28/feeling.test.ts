import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cellBounds,
  cellGreenShare,
  cellIndexAt,
  greenShareBand,
  GREEN_CLASS_CODES,
  pickCell,
  projectLocal,
  serializeGreenMap,
  validateGreenMap,
  type GreenMap,
} from './feeling.ts';

const sample: GreenMap = {
  schema: 1,
  source: 'ESA WorldCover 2021 v200',
  crs: 'EPSG:4326',
  grid: { west: 139.5, north: 36, step: 1 / 1200, firstRow: 288, rows: 2, firstCol: 192, cols: 2 },
  cells: [
    [100, 0, 60, 0, 20, 0, 10, 0, 0, 10, 0, 0, 0],
    [100, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0],
    [50, 50, 10, 0, 10, 0, 20, 10, 0, 0, 0, 0, 0],
    [0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
};

test('WorldCover green proxy uses only tree, shrub, grass, and herbaceous wetland classes', () => {
  assert.deepEqual(GREEN_CLASS_CODES, [10, 20, 30, 90]);
  assert.equal(cellGreenShare(sample.cells[0]!), 0.8);
  assert.equal(cellGreenShare(sample.cells[1]!), 0);
  assert.equal(cellGreenShare(sample.cells[2]!), 0.4);
});

test('ordered green-share bands distinguish exact boundaries and NoData', () => {
  assert.deepEqual([0, 0.01, 0.1, 0.1001, 0.25, 0.5, 0.75, 1, null].map(greenShareBand), [0, 1, 1, 2, 2, 3, 4, 5, 6]);
  assert.throws(() => greenShareBand(1.01), /between 0 and 1/);
});

test('zero valid pixels are no-data, not a zero-green cell', () => {
  assert.equal(cellGreenShare(sample.cells[3]!), null);
  const invalid = structuredClone(sample);
  invalid.cells[3]![0] = 0;
  invalid.cells[3]![1] = 0;
  assert.throws(() => validateGreenMap(invalid), /nodata/);
});

test('source counts, row-major AOI selection, and dimensions are validated', () => {
  validateGreenMap(sample);
  const duplicate = structuredClone(sample);
  duplicate.cells.pop();
  assert.throws(() => validateGreenMap(duplicate), /cell count/);
  const overfull = structuredClone(sample);
  overfull.cells[0]![2] = 101;
  assert.throws(() => validateGreenMap(overfull), /pixel count/);
  const invalidSum = structuredClone(sample);
  invalidSum.cells[0]![2] = 59;
  assert.throws(() => validateGreenMap(invalidSum), /sum/);
});

test('grid transform gives correct north-up geographic bounds and cell centers', () => {
  const b = cellBounds(sample.grid, sample.grid.firstRow, sample.grid.firstCol);
  assert.ok(Math.abs(b.west - (139.5 + 192 / 1200)) < 1e-12);
  assert.ok(Math.abs(b.north - (36 - 288 / 1200)) < 1e-12);
  assert.ok(Math.abs((b.east - b.west) - 1 / 1200) < 1e-12);
  assert.ok(Math.abs((b.north - b.south) - 1 / 1200) < 1e-12);
  const center: [number, number] = [(b.west + b.east) / 2, (b.south + b.north) / 2];
  assert.deepEqual(cellIndexAt(sample, center), { row: 0, col: 0, index: 0 });
});

test('local map projection keeps north up and corrects longitude scale at Tokyo latitude', () => {
  const origin: [number, number] = [139.745, 35.69];
  const east = projectLocal([139.755, 35.69], origin);
  const north = projectLocal([139.745, 35.70], origin);
  assert.ok(east[0] > 900 && east[0] < 910);
  assert.equal(east[1], 0);
  assert.equal(north[0], 0);
  assert.ok(north[1] < -1100 && north[1] > -1110);
});

test('cell picking preserves original ESA per-class counts and outside areas return null', () => {
  const bounds = cellBounds(sample.grid, sample.grid.firstRow, sample.grid.firstCol + 1);
  const picked = pickCell(sample, [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2]);
  assert.deepEqual(picked?.counts, { 10: 0, 20: 0, 30: 0, 40: 0, 50: 100, 60: 0, 70: 0, 80: 0, 90: 0, 95: 0, 100: 0 });
  assert.equal(picked?.greenShare, 0);
  assert.equal(pickCell(sample, [150, 40]), null);
});

test('serialization retains cell pixels and no-data semantics', () => {
  const json = serializeGreenMap(sample);
  const restored = JSON.parse(json) as GreenMap;
  validateGreenMap(restored);
  assert.deepEqual(restored, sample);
});
