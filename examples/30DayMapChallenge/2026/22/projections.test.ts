import test from 'node:test';
import assert from 'node:assert/strict';
import { project, projectSegment, screenPoint, PROJECTION_NAMES, type ProjectionName, type Point } from './projections.ts';

function requirePoint(name: ProjectionName, longitude: number, latitude: number): Point {
  const point = project(name, longitude, latitude);
  if (!point) throw new Error(`${name} unexpectedly clipped ${longitude},${latitude}`);
  return point;
}

test('four distinct global projections are available', () => {
  assert.deepEqual(PROJECTION_NAMES, ['Equirectangular', 'Mercator', 'Equal Earth', 'Winkel Tripel']);
  const values = PROJECTION_NAMES.map((name) => requirePoint(name, 50, 60));
  assert.equal(new Set(values.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`)).size, 4);
});

test('all projections put the prime meridian and equator at the origin', () => {
  for (const name of PROJECTION_NAMES) assert.deepEqual(project(name, 0, 0), [0, 0]);
});

test('symmetric projections reflect across the equator and central meridian', () => {
  for (const name of PROJECTION_NAMES) {
    const east = requirePoint(name, 37, 42);
    const west = requirePoint(name, -37, 42);
    const south = requirePoint(name, 37, -42);
    assert.ok(Math.abs(east[0] + west[0]) < 1e-10, `${name} x symmetry`);
    assert.ok(Math.abs(east[1] - west[1]) < 1e-10, `${name} y symmetry`);
    assert.ok(Math.abs(east[0] - south[0]) < 1e-10, `${name} east/west y reflection`);
    assert.ok(Math.abs(east[1] + south[1]) < 1e-10, `${name} north/south symmetry`);
  }
});

test('Mercator clips at its finite latitude limit and preserves its known scale', () => {
  const north = project('Mercator', 0, 90);
  const limit = project('Mercator', 0, 85.05112878);
  assert.ok(north && limit);
  assert.ok(Math.abs(north[1] - limit[1]) < 1e-8);
  assert.ok(Math.abs(limit[1] - Math.PI) < 1e-7);
  assert.equal(project('Mercator', 0, 90, false), null);
});

test('all projections have finite coordinates on their global boundary and reject invalid input', () => {
  for (const name of PROJECTION_NAMES) {
    for (const longitude of [-180, 180]) for (const latitude of [-90, 90]) {
      const output = project(name, longitude, latitude);
      assert.ok(output && output.every(Number.isFinite), `${name} at ${longitude},${latitude}`);
    }
    assert.equal(project(name, 0, 90.01), null);
    assert.equal(project(name, Number.NaN, 0), null);
  }
});

test('Equal Earth has its documented equal-area coefficient and finite polar edge', () => {
  const equator = project('Equal Earth', 40, 0)!;
  assert.ok(Math.abs(equator[0] - (2 * Math.sqrt(3) / 3.0) * (1 / 1.340264) * 40 * Math.PI / 180) < 1e-9);
  for (const latitude of [-90, -89, 89, 90]) {
    const p = project('Equal Earth', 180, latitude);
    assert.ok(p && p.every(Number.isFinite));
  }
  const longitude = 23, latitude = 41, delta = 0.00001;
  const east = project('Equal Earth', longitude + delta, latitude)!;
  const west = project('Equal Earth', longitude - delta, latitude)!;
  const north = project('Equal Earth', longitude, latitude + delta)!;
  const south = project('Equal Earth', longitude, latitude - delta)!;
  const radianStep = 2 * delta * Math.PI / 180;
  const dxdlambda = (east[0] - west[0]) / radianStep;
  const dydlambda = (east[1] - west[1]) / radianStep;
  const dxdphi = (north[0] - south[0]) / radianStep;
  const dydphi = (north[1] - south[1]) / radianStep;
  const areaJacobian = dxdlambda * dydphi - dydlambda * dxdphi;
  assert.ok(Math.abs(areaJacobian - Math.cos(latitude * Math.PI / 180)) < 1e-6,
    `Equal Earth Jacobian ${areaJacobian} should equal spherical area factor ${Math.cos(latitude * Math.PI / 180)}`);
});

test('segments crossing the antimeridian split instead of bridging the map', () => {
  const parts = projectSegment('Equal Earth', [[170, 10], [-170, 15]]);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((part) => part.length >= 2));
  assert.ok(parts[0]!.at(-1)![0] > 0);
  assert.ok(parts[1]![0]![0] < 0);
});

test('screen transform centers projected origin and rejects non-finite coordinates', () => {
  assert.deepEqual(screenPoint([0, 0], { width: 1000, height: 600, scale: 100 }), [500, 300]);
  assert.equal(screenPoint([Infinity, 0], { width: 1000, height: 600, scale: 100 }), null);
});
