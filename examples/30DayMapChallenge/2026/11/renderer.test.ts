import assert from 'node:assert/strict';
import test from 'node:test';
import { channelAt, projectLocation } from './renderer.ts';

test('channel selection uses the same top-left grid coordinates for road and rail', () => {
  const grid = { width: 2, height: 2, roads: new Uint16Array([10, 20, 30, 40]), rails: new Uint16Array([1, 2, 3, 4]) };
  assert.deepEqual(channelAt(grid, 0.1, 0.1), { road: 10, rail: 1 });
  assert.deepEqual(channelAt(grid, 0.9, 0.9), { road: 40, rail: 4 });
  assert.deepEqual(channelAt(grid, 1, 1), { road: 40, rail: 4 });
});

test('known places use the same Web Mercator y fraction as the baked OSM lines', () => {
  const bounds = { west: 139.55, east: 139.92, south: 35.52, north: 35.82 };
  const point = projectLocation(139.7005, 35.6896, bounds);
  assert.ok(Math.abs(point.x - (139.7005 - bounds.west) / (bounds.east - bounds.west)) < 1e-12);
  const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  assert.ok(Math.abs(point.y - (mercatorY(bounds.north) - mercatorY(35.6896)) / (mercatorY(bounds.north) - mercatorY(bounds.south))) < 1e-12);
});
