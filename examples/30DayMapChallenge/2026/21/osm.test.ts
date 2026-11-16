import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpatialIndex, classifyOsmTags, clipSegment, decodeOsmFeatures, encodeOsmFeatures, fitExtent, hitTest, querySpatialIndex,
  project3857, type OSMFeature,
} from './osm.ts';

const feature: OSMFeature = {
  table: 'planet_osm_polygon', id: -19862716n, category: 'green', geometry: { type: 'polygon', parts: [[
    [20, 20], [80, 20], [80, 80], [20, 80], [20, 20],
  ]], polygonRingEnds: [1] }, tags: { leisure: 'park', name: 'Yoyogi Park', boundary: 'yes' },
};

test('projects EPSG:3857 positions into a top-left screen viewport and inverts exactly', () => {
  const view = fitExtent({ xmin: 0, ymin: 0, xmax: 100, ymax: 100 }, 200, 100, 0.9);
  const screen = project3857([25, 75], view);
  assert.deepEqual(screen, [75.45, 25.45]);
  const map = view.toMap(screen);
  assert.ok(Math.abs(map[0] - 25) < 1e-12 && Math.abs(map[1] - 75) < 1e-12);
});

test('extent fitting rejects invalid/empty viewports and keeps a stable scale', () => {
  assert.throws(() => fitExtent({ xmin: 1, ymin: 1, xmax: 1, ymax: 2 }, 100, 100), /extent/);
  assert.throws(() => fitExtent({ xmin: 0, ymin: 0, xmax: 10, ymax: 10 }, 0, 100), /viewport/);
  const view = fitExtent({ xmin: 0, ymin: 0, xmax: 200, ymax: 100 }, 100, 100, 1);
  assert.equal(view.scale, 0.49);
});

test('spatial index returns every overlapping feature once in source order', () => {
  const bounds = Array.from({ length: 100 }, (_, i) => ({ xmin: i * 10, ymin: i * 3, xmax: i * 10 + 4, ymax: i * 3 + 5 }));
  const index = buildSpatialIndex(bounds, 4);
  const query = { xmin: 203, ymin: 57, xmax: 446, ymax: 119 };
  const expected = bounds.flatMap((box, i) => box.xmin <= query.xmax && box.xmax >= query.xmin && box.ymin <= query.ymax && box.ymax >= query.ymin ? [i] : []);
  assert.deepEqual(querySpatialIndex(index, query), expected);
  assert.deepEqual(querySpatialIndex(buildSpatialIndex([]), query), []);
  assert.throws(() => buildSpatialIndex([{ xmin: 2, ymin: 0, xmax: 1, ymax: 1 }]), /bounds/);
});

test('clips line segments to the map rectangle and rejects disjoint segments', () => {
  const extent = { xmin: 0, ymin: 0, xmax: 10, ymax: 10 };
  assert.deepEqual(clipSegment([-5, 5], [15, 5], extent), [[0, 5], [10, 5]]);
  assert.equal(clipSegment([-5, -1], [15, -1], extent), null);
});

test('feature encoding preserves source table, signed relation id, exact tags and geometry', () => {
  const decoded = decodeOsmFeatures(encodeOsmFeatures([feature]));
  assert.deepEqual(decoded, [feature]);
  assert.throws(() => decodeOsmFeatures(new Uint8Array([0, 1, 2])), /header/);
});

test('feature encoding preserves OSM IDs beyond JavaScript safe integers exactly', () => {
  const exactId = 9_007_199_254_741_337n;
  assert.equal(decodeOsmFeatures(encodeOsmFeatures([{ ...feature, id: exactId }]))[0]!.id, exactId);
});

test('classification uses source OSM tags while retaining the original tag map', () => {
  assert.equal(classifyOsmTags('planet_osm_roads', { highway: 'primary' }), 'road');
  assert.equal(classifyOsmTags('planet_osm_line', { railway: 'rail' }), 'railway');
  assert.equal(classifyOsmTags('planet_osm_polygon', { building: 'apartments' }), 'building');
  assert.equal(classifyOsmTags('planet_osm_polygon', { leisure: 'park' }), 'green');
  assert.equal(classifyOsmTags('planet_osm_polygon', { natural: 'water' }), 'water');
  assert.equal(classifyOsmTags('planet_osm_point', { amenity: 'library' }), 'public-place');
  assert.equal(classifyOsmTags('planet_osm_point', { name: 'Unnamed thing' }), null);
});

test('hit testing returns the topmost polygon/line/point feature and ignores misses', () => {
  const point: OSMFeature = { table: 'planet_osm_point', id: 123n, category: 'public-place', geometry: { type: 'point', parts: [[[50, 50]]] }, tags: { amenity: 'library' } };
  const line: OSMFeature = { table: 'planet_osm_roads', id: 456n, category: 'road', geometry: { type: 'line', parts: [[[0, 50], [100, 50]]] }, tags: { highway: 'primary' } };
  assert.equal(hitTest([feature, line, point], [50, 50], 4), point);
  assert.equal(hitTest([feature, line], [50, 50], 4), line);
  assert.equal(hitTest([line], [50, 51], 4), line);
  assert.equal(hitTest([feature], [5, 5], 4), null);
});

test('polygon hit testing respects holes and every island in a multipolygon', () => {
  const multipolygon: OSMFeature = {
    ...feature,
    geometry: { type: 'polygon', parts: [
      [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
      [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]],
      [[150, 0], [200, 0], [200, 50], [150, 50], [150, 0]],
    ], polygonRingEnds: [2, 3] },
  };
  assert.equal(hitTest([multipolygon], [20, 20], 1), multipolygon);
  assert.equal(hitTest([multipolygon], [50, 50], 1), null);
  assert.equal(hitTest([multipolygon], [175, 25], 1), multipolygon);
  assert.deepEqual(decodeOsmFeatures(encodeOsmFeatures([multipolygon]))[0]!.geometry.polygonRingEnds, [2, 3]);
});
