import assert from 'node:assert/strict';
import test from 'node:test';
import { cellAtPixel, mapRect } from './renderer.ts';
import { aggregateContributions, type CollaborationMap } from './collaboration.ts';

function emptyMap(): CollaborationMap {
  const map = aggregateContributions({ type: 'FeatureCollection', features: [] },
    { west: 139.696, south: 35.65, east: 139.706, north: 35.66 }, 24);
  return map;
}

test('map view keeps local ground distances in proportion and remains inside the viewport', () => {
  const data = emptyMap();
  for (const [width, height] of [[1280, 800], [1920, 1080], [390, 844]]) {
    const rect = mapRect(width, height, data);
    const expected = (data.bounds.east - data.bounds.west) * Math.cos((data.bounds.north + data.bounds.south) / 2 * Math.PI / 180)
      / (data.bounds.north - data.bounds.south);
    assert.ok(Math.abs(rect.width / rect.height - expected) < 1e-10);
    assert.ok(rect.width > 0 && rect.height > 0);
    assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
  }
});

test('cell hit testing includes west/north edges and excludes the east/south outside edges', () => {
  const rect = { x: 20, y: 30, width: 240, height: 240 };
  assert.deepEqual(cellAtPixel(20, 30, rect, 24), { x: 0, y: 0 });
  assert.deepEqual(cellAtPixel(259.9, 269.9, rect, 24), { x: 23, y: 23 });
  assert.equal(cellAtPixel(260, 150, rect, 24), null);
  assert.equal(cellAtPixel(150, 270, rect, 24), null);
  assert.equal(cellAtPixel(19.9, 150, rect, 24), null);
});
