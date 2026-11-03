import test from 'node:test';
import assert from 'node:assert/strict';
import { latLonToVector3, interpolateGreatCircleArc, generateSphereMesh } from './globe.ts';

test('latLonToVector3 produces unit length vector', () => {
  const v = latLonToVector3(0, 0); // Equator at prime meridian
  const len = Math.hypot(v[0], v[1], v[2]);
  assert.ok(Math.abs(len - 1.0) < 1e-5);
  assert.equal(v[0], 1);
  assert.equal(v[1], 0);
  assert.equal(v[2], 0);

  const northPole = latLonToVector3(90, 0);
  assert.equal(northPole[2], 1);
});

test('interpolateGreatCircleArc produces parabolic altitude arc above globe', () => {
  const tokyo: [number, number] = [35.6762, 139.6503];
  const sf: [number, number] = [37.7749, -122.4194];

  const points = interpolateGreatCircleArc(tokyo, sf, 20, 0.25);
  assert.equal(points.length, 21);

  // Endpoints are on surface (radius = 1.0)
  const rStart = Math.hypot(points[0][0], points[0][1], points[0][2]);
  const rEnd = Math.hypot(points[20][0], points[20][1], points[20][2]);
  assert.ok(Math.abs(rStart - 1.0) < 1e-4);
  assert.ok(Math.abs(rEnd - 1.0) < 1e-4);

  // Midpoint is elevated above surface (radius ~ 1.25)
  const rMid = Math.hypot(points[10][0], points[10][1], points[10][2]);
  assert.ok(rMid > 1.20 && rMid <= 1.26, `Expected midpoint elevation ~1.25, got ${rMid}`);
});

test('generateSphereMesh creates valid sphere buffers', () => {
  const sphere = generateSphereMesh(16, 16);
  assert.ok(sphere.positions.length > 0);
  assert.equal(sphere.positions.length, sphere.normals.length);
  assert.equal(sphere.indices.length, 16 * 16 * 6);
});
