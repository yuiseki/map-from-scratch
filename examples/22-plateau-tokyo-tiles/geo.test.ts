import assert from 'node:assert/strict';
import { test } from 'node:test';
import { at, ecef, local, normal, regionSphere } from './geo.ts';

test('Tokyo origin maps to local zero and nearby longitude, latitude and height map to ENU axes', () => {
  const origin = at(139.76712, 35.68124);
  assert.ok(origin.every((v) => Math.abs(v) < 1e-7));
  const east = at(139.76722, 35.68124);
  const north = at(139.76712, 35.68134);
  const above = at(139.76712, 35.68124, 12);
  assert.ok(east[0] > 8 && east[0] < 10);
  assert.ok(Math.abs(east[1]) < 0.02);
  assert.ok(north[1] > 10 && north[1] < 12);
  assert.ok(Math.abs(north[0]) < 0.02);
  assert.ok(Math.abs(above[2] - 12) < 1e-7);
});

test('ECEF conversion and ENU normal rotation preserve expected axes', () => {
  const xyz = ecef(0, 0, 0);
  assert.ok(Math.abs(xyz[0] - 6378137) < 1e-6);
  const radial = normal(Math.cos(35.68124 * Math.PI / 180) * Math.cos(139.76712 * Math.PI / 180), Math.cos(35.68124 * Math.PI / 180) * Math.sin(139.76712 * Math.PI / 180), Math.sin(35.68124 * Math.PI / 180));
  assert.ok(Math.abs(radial[0]) < 1e-10 && Math.abs(radial[1]) < 1e-10);
  assert.ok(Math.abs(radial[2] - 1) < 1e-10);
  const p = ecef(139.76712 * Math.PI / 180, 35.68124 * Math.PI / 180, 0);
  assert.ok(local(...p).every((v) => Math.abs(v) < 1e-7));
});

test('region bounding sphere contains all eight transformed region corners', () => {
  const region: [number, number, number, number, number, number] = [139.7, 35.6, 139.8, 35.7, 0, 120];
  const sphere = regionSphere(region);
  assert.ok(sphere.radius > 0);
  for (const lon of [region[0], region[2]]) for (const lat of [region[1], region[3]]) for (const h of [region[4], region[5]]) {
    const p = local(...ecef(lon, lat, h));
    const d = Math.hypot(p[0] - sphere.center[0], p[1] - sphere.center[1], p[2] - sphere.center[2]);
    assert.ok(d <= sphere.radius + 1e-8);
  }
});
