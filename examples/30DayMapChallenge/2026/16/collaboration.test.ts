import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateContributions, type ContributionCollection } from './collaboration.ts';

const bounds = { west: 139.696, south: 35.65, east: 139.706, north: 35.66 };
const feature = (lon: number, lat: number, timestamp: string, kind: string, geometry: boolean = true) => ({
  type: 'Feature',
  geometry: geometry ? { type: 'Point', coordinates: [lon, lat] } : null,
  properties: { '@timestamp': timestamp, [`@${kind}`]: true, '@osmId': 'way/private-id', '@contributionChangesetId': 1234 },
});

test('aggregates only located contributions into their calendar month and spatial cell', () => {
  const input = {
    type: 'FeatureCollection',
    features: [
      feature(bounds.west, bounds.north, '2025-01-01T00:00:00Z', 'creation'),
      feature(bounds.east, bounds.south, '2025-01-20T00:00:00Z', 'tagChange'),
      feature(139.702, 35.654, '2025-07-01T00:00:00Z', 'geometryChange'),
      feature(139.702, 35.654, '2025-07-02T00:00:00Z', 'deletion', false),
      feature(139.702, 35.654, '2024-12-31T23:59:59Z', 'creation'),
      feature(139.71, 35.654, '2025-02-01T00:00:00Z', 'creation'),
    ],
  } as ContributionCollection;

  const result = aggregateContributions(input, bounds, 4);
  assert.equal(result.inputFeatures, 6);
  assert.equal(result.mappedFeatures, 3);
  assert.equal(result.unmappedNoGeometry, 1);
  assert.equal(result.unmappedOutsideYear, 1);
  assert.equal(result.unmappedOutsideBounds, 1);
  assert.deepEqual(result.cells.find((cell) => cell.x === 0 && cell.y === 0)?.months[0], {
    total: 1, creation: 1, geometryChange: 0, tagChange: 0, deletion: 0, other: 0,
  });
  assert.deepEqual(result.cells.find((cell) => cell.x === 3 && cell.y === 3)?.months[0], {
    total: 1, creation: 0, geometryChange: 0, tagChange: 1, deletion: 0, other: 0,
  });
  assert.deepEqual(result.cells.find((cell) => cell.x === 2 && cell.y === 2)?.months[6], {
    total: 1, creation: 0, geometryChange: 1, tagChange: 0, deletion: 0, other: 0,
  });
});

test('cumulative totals include all located edit types through the selected month', () => {
  const result = aggregateContributions({
    type: 'FeatureCollection',
    features: [
      feature(139.7, 35.654, '2025-01-15T12:00:00Z', 'creation'),
      feature(139.7, 35.654, '2025-03-15T12:00:00Z', 'geometryChange'),
      feature(139.7, 35.654, '2025-03-16T12:00:00Z', 'tagChange'),
    ],
  } as ContributionCollection, bounds, 8);
  assert.deepEqual(result.monthlyTotals.map((month) => month.total).slice(0, 4), [1, 0, 2, 0]);
  assert.equal(result.cumulativeTotal(0), 1);
  assert.equal(result.cumulativeTotal(1), 1);
  assert.equal(result.cumulativeTotal(2), 3);
  assert.equal(result.cumulativeTotal(11), 3);
});

test('rejects malformed bounds, grid resolution, coordinate and timestamp inputs', () => {
  assert.throws(() => aggregateContributions({ type: 'FeatureCollection', features: [] }, { ...bounds, east: bounds.west }, 4), /bounds/);
  assert.throws(() => aggregateContributions({ type: 'FeatureCollection', features: [] }, bounds, 1), /grid/);
  assert.throws(() => aggregateContributions({ type: 'FeatureCollection', features: [feature(Number.NaN, 35.65, '2025-01-02T00:00:00Z', 'creation')] } as ContributionCollection, bounds, 4), /coordinate/);
  assert.throws(() => aggregateContributions({ type: 'FeatureCollection', features: [feature(139.7, 35.655, 'bad-date', 'creation')] } as ContributionCollection, bounds, 4), /timestamp/);
});
