import test from 'node:test';
import assert from 'node:assert/strict';
import { windTowardVector, buildIllustrativePlume, decodeSmellData } from './smell.ts';

test('converts a meteorological wind-from bearing into a map-space downwind vector', () => {
  const vector = windTowardVector(337.5, 1000);
  assert.ok(Math.abs(vector.east - 382.683) < 0.01);
  assert.ok(Math.abs(vector.north + 923.880) < 0.01);
  assert.ok(Math.abs(Math.hypot(vector.east, vector.north) - 1000) < 1e-9);
});

test('builds a plume fan with its origin at the source and explicit finite bounds', () => {
  const plume = buildIllustrativePlume({ east: 120, north: -80 }, 157.5, 5000, 0.12, 250);
  assert.deepEqual(plume[0], { east: 120, north: -80 });
  assert.equal(plume.length, 5);
  assert.ok(plume.every((point) => Number.isFinite(point.east) && Number.isFinite(point.north)));
  assert.ok(Math.max(...plume.map((point) => point.east)) > 1900);
  assert.ok(Math.min(...plume.map((point) => point.north)) < -4500);
  assert.throws(() => buildIllustrativePlume({ east: 0, north: 0 }, 0, 0, 0.12, 250), /positive/);
});

test('decodes and rejects malformed source and wind data', () => {
  const data = decodeSmellData({
    observation: { station: 'Tokyo', stationLon: 139.75, stationLat: 35.69, observedAt: '2026-11-04T18:00:00+09:00', fromDegrees: 337.5, fromLabel: '北北西', speedMps: 1.9, sourceUrl: 'https://example.invalid/jma' },
    sources: [{ id: 'way/23690250', name: '芝浦水再生センター', lon: 139.744069, lat: 35.634596, kind: 'wastewater_candidate', outline: [] }],
    roads: [], waterways: [], bounds: { west: 139.68, east: 139.82, south: 35.56, north: 35.73 },
    plume: { lengthM: 5000, spreadRatio: 0.12, sourceHalfWidthM: 250 },
  });
  assert.equal(data.sources.length, 1);
  assert.equal(data.observation.speedMps, 1.9);
  assert.throws(() => decodeSmellData({ observation: {}, sources: [] }), /observation/);
  assert.throws(() => decodeSmellData({ ...data, sources: [{ ...data.sources[0]!, lat: 95 }] }), /latitude/);
});
