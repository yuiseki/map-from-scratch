import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClusterLevels, clusterRadius, decodeClusterPoints } from './cluster-data.ts';

function fixture(): ArrayBuffer {
  const buffer = new ArrayBuffer(16 + 2 * 16);
  const view = new DataView(buffer);
  view.setUint32(0, 0x31305145, true);
  view.setUint32(4, 2, true);
  [[0.1, 0.2, 5, 1], [0.11, 0.21, NaN, 0]].forEach(([x, y, mag, tsunami], i) => {
    const at = 16 + i * 16;
    view.setFloat32(at, x, true);
    view.setFloat32(at + 4, y, true);
    view.setFloat32(at + 8, mag, true);
    view.setUint32(at + 12, tsunami, true);
  });
  return buffer;
}

test('earthquake records decode little-endian coordinates, magnitude and tsunami flag', () => {
  const points = decodeClusterPoints(fixture());
  assert.equal(points.length, 2);
  assert.ok(Math.abs(points[0].x - 0.1) < 1e-7);
  assert.ok(Math.abs(points[0].y - 0.2) < 1e-7);
  assert.equal(points[0].mag, 5);
  assert.equal(points[0].tsunami, true);
  assert.ok(Number.isNaN(points[1].mag));
  assert.equal(points[1].tsunami, false);
});

test('earthquake decoder rejects a wrong signature and truncated record bytes', () => {
  const badMagic = fixture();
  new DataView(badMagic).setUint32(0, 0, true);
  assert.throws(() => decodeClusterPoints(badMagic), /invalid earthquake data/);
  assert.throws(() => decodeClusterPoints(fixture().slice(0, 31)), /truncated earthquake data/);
});

test('zoom levels aggregate points into cell centroids and keep a final unclustered level', () => {
  const points = [
    { x: 0.1, y: 0.2, mag: 4, tsunami: false },
    { x: 0.11, y: 0.21, mag: 5, tsunami: true },
    { x: 0.8, y: 0.8, mag: 3, tsunami: false },
  ];
  const levels = buildClusterLevels(points, 0);
  assert.equal(levels.length, 2);
  assert.equal(levels[0].length, 2);
  assert.ok(Math.abs(levels[0][0].x - 0.105) < 1e-12);
  assert.ok(Math.abs(levels[0][0].y - 0.205) < 1e-12);
  assert.equal(levels[0][0].count, 2);
  assert.equal(levels[0][0].first, 0);
  assert.deepEqual(levels[0][1], { x: 0.8, y: 0.8, count: 1, first: 2 });
  assert.deepEqual(levels[1].map(({ count, first }) => [count, first]), [[1, 0], [1, 1], [1, 2]]);
});

test('cluster marker radius follows the count thresholds', () => {
  assert.deepEqual([1, 2, 99, 100, 749, 750].map(clusterRadius), [5, 20, 20, 30, 30, 40]);
});
