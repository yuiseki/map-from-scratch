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

test('a region (in radians, as 3D Tiles gives it) gets a sphere around its middle reaching its corners', () => {
  // 0.1 deg by 0.1 deg around 35.65N: 9.05 km east-west by 11.1 km
  // north-south, so half the diagonal is about 7.16 km.
  const r = Math.PI / 180;
  const sphere = regionSphere([139.7 * r, 35.6 * r, 139.8 * r, 35.7 * r, 0, 120]);
  assert.ok(sphere.radius > 7100 && sphere.radius < 7230, `radius ${sphere.radius}`);
  const middle = at(139.75, 35.65, 60);
  assert.ok(Math.hypot(...sphere.center.map((v, i) => v - middle[i])) < 1, `center ${sphere.center}`);
});
