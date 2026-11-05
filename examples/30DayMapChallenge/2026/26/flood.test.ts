import assert from 'node:assert/strict';
import test from 'node:test';
import {
  depthLabel,
  depthRankOrder,
  featureAt,
  projectLocal,
  serializeFloodMap,
  validateFloodMap,
  wheelZoomFactor,
  type FloodMap,
} from './flood.ts';

const fixture: FloodMap = {
  schema: 1,
  category: 'maximum',
  crs: 'EPSG:6668',
  bounds: [139.79, 35.7, 139.85, 35.76],
  origin: [139.82, 35.73],
  features: [
    { id: 'river-a-1', river: '荒川', manager: '関東地方整備局', depthClass: 3, rawDepth: 3, bounds: [139.80, 35.71, 139.81, 35.72], pickPoint: [139.805, 35.715],
      polygons: [[[[139.80, 35.71], [139.81, 35.71], [139.81, 35.72], [139.80, 35.72]]]] },
    { id: 'river-a-unknown', river: '荒川', manager: '関東地方整備局', depthClass: null, rawDepth: null, bounds: [139.83, 35.71, 139.84, 35.72], pickPoint: [139.835, 35.715],
      polygons: [[[[139.83, 35.71], [139.84, 35.71], [139.84, 35.72], [139.83, 35.72]]]] },
  ],
};

test('maximum-scale depth classes preserve source rank and metre intervals', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(depthLabel), [
    '0–<0.5 m', '0.5–<3 m', '3–<5 m', '5–<10 m', '10–<20 m', '≥20 m',
  ]);
  assert.equal(depthLabel(null), 'Unknown');
  assert.deepEqual(depthRankOrder, [1, 2, 3, 4, 5, 6]);
});

test('JGD2011 longitude/latitude is projected to a local, north-up metre frame', () => {
  const p = projectLocal([139.83, 35.74], fixture.origin);
  assert.ok(p[0] > 900 && p[0] < 910);
  assert.ok(p[1] < -1100 && p[1] > -1120);
  assert.deepEqual(projectLocal(fixture.origin, fixture.origin), [0, 0]);
});

test('wheel zoom normalizes pixel, line, and page deltas and bounds extreme events', () => {
  assert.equal(wheelZoomFactor(10, 0), wheelZoomFactor(10 / 16, 1));
  assert.equal(wheelZoomFactor(1, 2, 16, 800), wheelZoomFactor(800, 0));
  assert.ok(wheelZoomFactor(-10, 0) > 1);
  assert.ok(wheelZoomFactor(10, 0) < 1);
  assert.equal(wheelZoomFactor(10000, 0), wheelZoomFactor(180, 0));
  assert.throws(() => wheelZoomFactor(1, 3), /Invalid wheel delta/);
});

test('unknown depth remains distinct from zero and is not ranked as measured inundation', () => {
  assert.equal(fixture.features[1]!.depthClass, null);
  const invalidZero = structuredClone(fixture);
  invalidZero.features[0]!.depthClass = 0;
  invalidZero.features[0]!.rawDepth = 0;
  assert.throws(() => validateFloodMap(invalidZero), /depth class/);
});

test('serialization preserves geometry, source fields, and unknown values', () => {
  const json = serializeFloodMap(fixture);
  const restored = JSON.parse(json) as FloodMap;
  validateFloodMap(restored);
  assert.deepEqual(restored, fixture);
});

test('baked coordinates must be clipped to the declared selection bbox', () => {
  validateFloodMap(fixture);
  const outside = structuredClone(fixture);
  outside.features[0]!.polygons[0]![0]![0] = [139.78, 35.71];
  assert.throws(() => validateFloodMap(outside), /outside selection bounds/);
  const badBounds = structuredClone(fixture);
  badBounds.features[0]!.bounds = [139.801, 35.71, 139.81, 35.72];
  assert.throws(() => validateFloodMap(badBounds), /bounds do not enclose geometry/);
});

test('feature picking honors polygon holes and returns no feature outside inundation', () => {
  const map = structuredClone(fixture);
  map.features[0]!.polygons[0]!.push([
    [139.803, 35.713], [139.807, 35.713], [139.807, 35.717], [139.803, 35.717],
  ]);
  assert.equal(featureAt(map.features, [139.801, 35.715])?.id, 'river-a-1');
  assert.equal(featureAt(map.features, [139.805, 35.715]), null);
  assert.equal(featureAt(map.features, [139.835, 35.715])?.id, 'river-a-unknown');
  assert.equal(featureAt(map.features, [139.825, 35.715]), null);
});

test('picking checks every multipolygon component and follows the visible deeper-rank order', () => {
  const map = structuredClone(fixture);
  map.features[1]!.id = 'river-a-deeper';
  map.features[1]!.depthClass = 5;
  map.features[1]!.rawDepth = 5;
  map.features[1]!.bounds = [139.80, 35.71, 139.84, 35.72];
  map.features[1]!.polygons.push([[
    [139.80, 35.71], [139.81, 35.71], [139.81, 35.72], [139.80, 35.72],
  ]]);
  validateFloodMap(map);
  assert.equal(featureAt(map.features, [139.805, 35.715])?.id, 'river-a-deeper');
  assert.equal(featureAt(map.features, [139.835, 35.715])?.id, 'river-a-deeper');
});
