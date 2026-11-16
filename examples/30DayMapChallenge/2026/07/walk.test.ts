import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWalkGraph, calculateWalkshed, clipRoadWays, encodeWalkSegments, isWalkable, type RoadWay } from './walk.ts';

const way = (highway: string, coordinates: [number, number][], tags: Partial<RoadWay> = {}): RoadWay => ({ highway, coordinates, ...tags });

test('pedestrian access rules keep footways, exclude private roads, and honor an explicit foot ban', () => {
  assert.equal(isWalkable(way('footway', [[0, 0], [10, 0]])), true);
  assert.equal(isWalkable(way('motorway', [[0, 0], [10, 0]])), false);
  assert.equal(isWalkable(way('residential', [[0, 0], [10, 0]], { access: 'private' })), false);
  assert.equal(isWalkable(way('residential', [[0, 0], [10, 0]], { access: 'private', foot: 'yes' })), true);
  assert.equal(isWalkable(way('footway', [[0, 0], [10, 0]], { foot: 'no' })), false);
});

test('walk graph connects shared OSM vertices and reaches branches within a time budget', () => {
  const graph = buildWalkGraph([
    way('residential', [[0, 0], [50, 0], [100, 0]]),
    way('footway', [[50, 0], [50, 10]]),
  ]);
  const result = calculateWalkshed(graph, [0, 0], 1, 1);
  assert.equal(result.nodeCount, 4);
  assert.equal(result.reachedNodeCount, 3);
  assert.equal(result.segments.some((edge) => edge.highway === 'footway' && edge.reachable && edge.endSeconds === 60), true);
  assert.deepEqual(result.bounds, { minX: 0, minY: 0, maxX: 100, maxY: 10 });
});

test('a road crossing the time limit is clipped at the reachable point', () => {
  const graph = buildWalkGraph([way('residential', [[0, 0], [100, 0]])]);
  const result = calculateWalkshed(graph, [0, 0], 1, 1);
  assert.equal(result.segments.length, 2);
  assert.deepEqual(result.segments[0]!.from, [0, 0]);
  assert.deepEqual(result.segments[0]!.to, [60, 0]);
  assert.equal(result.segments[0]!.endSeconds, 60);
  assert.equal(result.segments[0]!.reachable, true);
  assert.equal(result.segments[1]!.reachable, false);
});

test('roads crossing the bake extent are clipped before building the local graph', () => {
  const clipped = clipRoadWays([way('residential', [[-10, 5], [10, 5], [20, 5]])], { minX: 0, minY: 0, maxX: 15, maxY: 10 });
  assert.deepEqual(clipped.map((w) => w.coordinates), [[[0, 5], [10, 5]], [[10, 5], [15, 5]]]);
});

test('W10M stores aligned quantized road segments and reserves 255 for unreachable lines', () => {
  const graph = buildWalkGraph([way('residential', [[0, 0], [100, 0]])]);
  const result = calculateWalkshed(graph, [0, 0], 1, 1);
  const encoded = encodeWalkSegments(result.segments, { minX: 0, minY: 0, maxX: 100, maxY: 10 }, 60);
  const view = new DataView(encoded);
  assert.equal(String.fromCharCode(...new Uint8Array(encoded, 0, 4)), 'W10M');
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint16(44, true), 0);
  assert.equal(view.getUint16(48, true), 39321);
  assert.equal(view.getUint8(52), 0);
  assert.equal(view.getUint8(64), 255);
  assert.equal(encoded.byteLength, 44 + 2 * 12);
});

test('isolated roads do not enter the origin walkshed', () => {
  const graph = buildWalkGraph([
    way('residential', [[0, 0], [10, 0]]),
    way('residential', [[1000, 1000], [1010, 1000]]),
  ]);
  const result = calculateWalkshed(graph, [0, 0], 20, 1);
  assert.equal(result.segments.filter((edge) => edge.reachable).length, 1);
  assert.equal(result.segments.filter((edge) => !edge.reachable).length, 1);
});
